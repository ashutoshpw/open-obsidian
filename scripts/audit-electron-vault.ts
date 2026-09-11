import {createRequire} from "node:module";
import {createServer} from "node:net";
import {arch, platform, tmpdir} from "node:os";
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, readFileSync as readJsonFile, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {snapshotVault} from "../src/core/vault.js";
import {asArray, asRecord} from "./json.js";

const root = resolve(import.meta.dir, "..");
const electronBinary = createRequire(import.meta.url)("electron") as string;
const fixture = readJson(join(root, "fixtures/electron-vault-roundtrip.json"));
const startupTimeoutMs = 20_000;
const evaluationTimeoutMs = 8_000;
const outputLimit = 8_192;

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readJson(path: string): JsonRecord {
  return JSON.parse(readJsonFile(path, "utf8")) as JsonRecord;
}

type JsonRecord = Record<string, unknown>;
type CdpTarget = {type?: string; url?: string; webSocketDebuggerUrl?: string};
type CdpResponse = {id?: number; result?: {result?: {value?: unknown}; exceptionDetails?: unknown}; error?: {message?: string}};
type Child = ReturnType<typeof Bun.spawn>;

export type ElectronVaultAuditReport = {
  schema_version: 1;
  status: "passed";
  command: "bun run audit:electron-vault";
  environment: {platform: NodeJS.Platform; architecture: string; electron_version: string; display: string};
  fixture_id: string;
  checks: {
    launch: boolean;
    existing_vault_opened: boolean;
    read_only_scan: boolean;
    read_preserved_bytes: boolean;
    revision_aware_write: boolean;
    unrelated_binary_preserved: boolean;
    process_restart: boolean;
    reopen_read: boolean;
    app_data_outside_vault: boolean;
    remote_contact_avoided: boolean;
  };
  details: JsonRecord;
  limitations: string[];
};

function asObject(value: unknown, label: string): JsonRecord {
  const object = asRecord(value);
  if (!object) throw new Error(`${label} did not return an object`);
  return object;
}

function requireCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function appendOutput(current: string, chunk: Uint8Array | string): string {
  const value = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  return `${current}${value}`.slice(-outputLimit);
}

function readChildOutput(child: Child): {get: () => string} {
  let output = "";
  const consume = async (stream: ReadableStream<Uint8Array> | null): Promise<void> => {
    if (!stream) return;
    const reader = stream.getReader();
    while (true) {
      const next = await reader.read();
      if (next.done) return;
      output = appendOutput(output, next.value);
    }
  };
  if (child.stdout && typeof child.stdout !== "number") void consume(child.stdout);
  if (child.stderr && typeof child.stderr !== "number") void consume(child.stderr);
  return {get: () => output};
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  if (!port) throw new Error("Could not allocate a local CDP port");
  return port;
}

async function startXvfb(): Promise<{display: string; process: Child | null}> {
  if (platform() !== "linux" || process.env.DISPLAY) return {display: process.env.DISPLAY ?? "", process: null};
  const probe = Bun.spawnSync(["sh", "-lc", "command -v Xvfb"], {stdout: "pipe", stderr: "pipe"});
  if (probe.exitCode !== 0) throw new Error("Electron vault audit requires DISPLAY or Xvfb on Linux");
  const display = `:${100 + (process.pid % 700)}`;
  const xvfb = Bun.spawn(["Xvfb", display, "-screen", "0", "1280x720x24", "-nolisten", "tcp"], {stdout: "pipe", stderr: "pipe"});
  await Bun.sleep(250);
  if (xvfb.exitCode !== null) throw new Error(`Xvfb failed to start on ${display}`);
  return {display, process: xvfb};
}

async function stopProcess(child: Child | null): Promise<void> {
  if (!child) return;
  child.kill();
  await Promise.race([child.exited, Bun.sleep(3_000)]);
}

class CdpClient {
  private readonly socket: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, (response: CdpResponse) => void>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.onmessage = (event) => {
      const response = JSON.parse(String(event.data)) as CdpResponse;
      if (response.id === undefined) return;
      const resolveResponse = this.pending.get(response.id);
      if (!resolveResponse) return;
      this.pending.delete(response.id);
      resolveResponse(response);
    };
  }

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolvePromise, reject) => {
      socket.onopen = () => resolvePromise();
      socket.onerror = () => reject(new Error("Could not connect to the Electron CDP target"));
    });
    return new CdpClient(socket);
  }

  async evaluate<T>(expression: string): Promise<T> {
    const id = this.nextId++;
    const response = new Promise<CdpResponse>((resolveResponse, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Electron CDP evaluation exceeded ${evaluationTimeoutMs}ms`));
      }, evaluationTimeoutMs);
      this.pending.set(id, (value) => {
        clearTimeout(timer);
        resolveResponse(value);
      });
    });
    this.socket.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression, awaitPromise: true, returnByValue: true}}));
    const result = await response;
    if (result.error?.message) throw new Error(result.error.message);
    if (result.result?.exceptionDetails) throw new Error(`Electron evaluation failed: ${JSON.stringify(result.result.exceptionDetails)}`);
    return result.result?.result?.value as T;
  }

  close(): void {
    this.socket.close();
  }
}

async function pageTarget(port: number, output: () => string): Promise<CdpTarget> {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json() as CdpTarget[];
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl && target.url?.includes("renderer/index.html"));
      if (page) return page;
    } catch {
      // Electron is still starting. The bounded deadline below reports a useful failure.
    }
    await Bun.sleep(100);
  }
  throw new Error(`Electron renderer did not become available: ${output()}`);
}

async function launchRenderer(userData: string, display: string): Promise<{child: Child; output: () => string; client: CdpClient; stop: () => Promise<void>}> {
  const port = await freePort();
  const child = Bun.spawn([electronBinary, "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, "."], {
    cwd: root,
    env: display ? {...process.env, DISPLAY: display} : process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = readChildOutput(child);
  try {
    const target = await pageTarget(port, output.get);
    const client = await CdpClient.connect(target.webSocketDebuggerUrl!);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await client.evaluate<boolean>("Boolean(window.openObsidian)")) {
        return {child, output: output.get, client, stop: async () => {client.close(); await stopProcess(child);}};
      }
      await Bun.sleep(100);
    }
    client.close();
    throw new Error("OpenObsidian preload did not become available");
  } catch (error) {
    await stopProcess(child);
    throw error;
  }
}

function fixtureStringList(key: string): string[] {
  return asArray(fixture[key]).map(string).filter(Boolean);
}

export function validateElectronVaultFixture(): {phases: number; paths: number; assertions: number} {
  requireCondition(fixture.schema_version === 1, "Electron vault fixture schema_version must be 1");
  requireCondition(string(fixture.id) === "fixture:electron-vault-roundtrip", "Electron vault fixture id is invalid");
  requireCondition(fixtureStringList("phases").length === 6, "Electron vault fixture phases are incomplete");
  requireCondition(fixtureStringList("paths").includes("Note.md"), "Electron vault fixture must include Note.md");
  requireCondition(fixtureStringList("assertions").length >= 4, "Electron vault fixture assertions are incomplete");
  return {phases: fixtureStringList("phases").length, paths: fixtureStringList("paths").length, assertions: fixtureStringList("assertions").length};
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function decoded(value: unknown, label: string): Uint8Array {
  requireCondition(typeof value === "string", `${label} did not return base64 bytes`);
  return new Uint8Array(Buffer.from(value, "base64"));
}

async function exerciseProcess(rootPath: string, userData: string, display: string, expectedBytes: Uint8Array): Promise<JsonRecord> {
  const runtime = await launchRenderer(userData, display);
  try {
    const summary = asObject(await runtime.client.evaluate(`window.openObsidian.openVault(${JSON.stringify(rootPath)})`), "openVault");
    const read = asObject(await runtime.client.evaluate("window.openObsidian.readFile('Note.md')"), "readFile");
    const bytes = decoded(read.base64, "readFile");
    requireCondition(Buffer.from(bytes).equals(Buffer.from(expectedBytes)), "Electron read changed the note bytes");
    return {summary, read, output: runtime.output()};
  } finally {
    await runtime.stop();
  }
}

type ElectronFixture = {
  vaultRoot: string;
  userData: string;
  originalNote: Uint8Array;
  editedNote: Uint8Array;
  originalBinary: Uint8Array;
  before: ReturnType<typeof snapshotVault>;
};

type FirstProcessTrace = {
  summary: JsonRecord;
  read: JsonRecord;
  written: JsonRecord;
  afterOpen: ReturnType<typeof snapshotVault>;
};

function createElectronFixture(): ElectronFixture {
  const vaultRoot = mkdtempSync(join(tmpdir(), "openobsidian-electron-vault-"));
  const userData = mkdtempSync(join(tmpdir(), "openobsidian-electron-user-"));
  const originalNote = Buffer.from("\uFEFF# Electron fixture\r\nOriginal\r\n", "utf8");
  const editedNote = Buffer.from("\uFEFF# Electron fixture\r\nEdited through IPC\r\n", "utf8");
  const originalBinary = Buffer.from([0, 255, 7, 10, 128]);
  mkdirSync(join(vaultRoot, "assets"));
  mkdirSync(join(vaultRoot, ".obsidian"));
  writeFileSync(join(vaultRoot, "Note.md"), originalNote);
  writeFileSync(join(vaultRoot, "assets", "blob.bin"), originalBinary);
  writeFileSync(join(vaultRoot, ".obsidian", "app.json"), '{"theme":"minimal"}\n');
  return {vaultRoot, userData, originalNote, editedNote, originalBinary, before: snapshotVault(vaultRoot)};
}

async function runFirstProcess(fixtureData: ElectronFixture, display: string): Promise<FirstProcessTrace> {
  const runtime = await launchRenderer(fixtureData.userData, display);
  try {
    const summary = asObject(await runtime.client.evaluate(`window.openObsidian.openVault(${JSON.stringify(fixtureData.vaultRoot)})`), "openVault");
    const files = await runtime.client.evaluate<unknown>("window.openObsidian.listFiles()");
    const read = asObject(await runtime.client.evaluate("window.openObsidian.readFile('Note.md')"), "readFile");
    requireCondition(Buffer.from(decoded(read.base64, "readFile")).equals(Buffer.from(fixtureData.originalNote)), "Initial Electron read was not byte-preserving");
    const afterOpen = snapshotVault(fixtureData.vaultRoot);
    requireCondition(afterOpen.sha256 === fixtureData.before.sha256, "Read-only Electron open changed the vault");
    const written = asObject(await runtime.client.evaluate(`window.openObsidian.writeFile({relativePath:'Note.md',expectedRevision:${JSON.stringify(read.revision)},base64:${JSON.stringify(base64(fixtureData.editedNote))}})`), "writeFile");
    const reopened = asObject(await runtime.client.evaluate("window.openObsidian.readFile('Note.md')"), "reopen read");
    requireCondition(Buffer.from(decoded(reopened.base64, "reopen read")).equals(Buffer.from(fixtureData.editedNote)), "Electron reopen did not return the edited bytes");
    requireCondition(asArray(files).some((entry) => asRecord(entry)?.relativePath === "Note.md"), "Electron file listing omitted Note.md");
    return {summary, read, written, afterOpen};
  } finally {
    await runtime.stop();
  }
}

function buildElectronReport(fixtureData: ElectronFixture, display: string, first: FirstProcessTrace, second: JsonRecord): ElectronVaultAuditReport {
  const secondSummary = asObject(second.summary, "reopen summary");
  const checks = {
    launch: true,
    existing_vault_opened: first.summary.root === fixtureData.vaultRoot && first.summary.fileCount === 3,
    read_only_scan: first.summary.unchanged === true && first.afterOpen.sha256 === fixtureData.before.sha256,
    read_preserved_bytes: Buffer.from(decoded(first.read.base64, "readFile")).equals(Buffer.from(fixtureData.originalNote)),
    revision_aware_write: typeof first.written.revision === "string" && first.written.revision.length === 64 && first.written.revision !== first.read.revision,
    unrelated_binary_preserved: Buffer.from(readFileSync(join(fixtureData.vaultRoot, "assets", "blob.bin"))).equals(Buffer.from(fixtureData.originalBinary)),
    process_restart: secondSummary.root === fixtureData.vaultRoot && secondSummary.unchanged === true,
    reopen_read: Buffer.from(decoded(asObject(second.read, "restart read").base64, "restart read")).equals(Buffer.from(fixtureData.editedNote)),
    app_data_outside_vault: !readdirSync(fixtureData.vaultRoot).includes(".openobsidian-data"),
    remote_contact_avoided: asRecord(secondSummary.git)?.remoteContacted === false,
  };
  requireCondition(Object.entries(checks).every(([, value]) => value), `Electron audit checks failed: ${JSON.stringify(checks)}`);
  return {
    schema_version: 1,
    status: "passed",
    command: "bun run audit:electron-vault",
    environment: {platform: platform(), architecture: arch(), electron_version: string(readJson(join(root, "node_modules/electron/package.json")).version) || "unknown", display: display || "native"},
    fixture_id: string(fixture.id),
    checks,
    details: {vault_file_count: first.summary.fileCount, first_revision: first.read.revision, edited_revision: first.written.revision, before_sha256: fixtureData.before.sha256, after_sha256: snapshotVault(fixtureData.vaultRoot).sha256},
    limitations: [
      "This is a disposable Linux packaged Electron trace; macOS and Windows interactive launches, reference Obsidian reopen behavior and human accessibility/input review remain separate gates.",
      "The trace proves the local broker and renderer boundary only; it does not certify unchanged plugin lifecycle, OS isolation, signing, publication or release readiness.",
      "No personal vault was accessed; the selected /home/ashutosh/Obsidian vault was not used.",
    ],
  };
}

export async function runElectronVaultAudit(): Promise<ElectronVaultAuditReport> {
  validateElectronVaultFixture();
  const fixtureData = createElectronFixture();
  let displayRuntime: {display: string; process: Child | null} = {display: "", process: null};
  try {
    displayRuntime = await startXvfb();
    const first = await runFirstProcess(fixtureData, displayRuntime.display);
    const second = await exerciseProcess(fixtureData.vaultRoot, fixtureData.userData, displayRuntime.display, fixtureData.editedNote);
    return buildElectronReport(fixtureData, displayRuntime.display, first, second);
  } finally {
    await stopProcess(displayRuntime.process);
    rmSync(fixtureData.vaultRoot, {recursive: true, force: true});
    rmSync(fixtureData.userData, {recursive: true, force: true});
  }
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(await runElectronVaultAudit(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({schema_version: 1, status: "failed", command: "bun run audit:electron-vault", error: error instanceof Error ? error.message : String(error)}));
    process.exit(1);
  }
}
