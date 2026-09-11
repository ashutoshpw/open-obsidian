import {createRequire} from "node:module";
import {createHash} from "node:crypto";
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
type CdpResponse = {id?: number; result?: {result?: {value?: unknown}; data?: string; exceptionDetails?: unknown}; error?: {message?: string}};
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
    launch_intent_hydrated_renderer: boolean;
    renderer_keyboard_save: boolean;
    renderer_unicode_input: boolean;
    renderer_mode_switch: boolean;
    renderer_local_retrieval_boundary: boolean;
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
  // A bounded fixed range avoids asking the kernel for an ephemeral port when
  // the shared development host has exhausted its ephemeral allocation pool.
  const firstPort = 28_000 + ((process.pid + Date.now()) % 900);
  for (let attempt = 0; attempt < 900; attempt += 1) {
    const port = 28_000 + ((firstPort - 28_000 + attempt) % 900);
    const server = createServer();
    const available = await new Promise<boolean>((resolvePromise) => {
      const onError = (): void => resolvePromise(false);
      server.once("error", onError);
      server.listen(port, "127.0.0.1", () => resolvePromise(true));
    });
    if (!available) {
      server.close();
      continue;
    }
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    return port;
  }
  throw new Error("Could not allocate a local CDP port in the bounded range 28000-28899");
}

async function startXvfb(): Promise<{display: string; process: Child | null}> {
  if (platform() !== "linux" || process.env.DISPLAY) return {display: process.env.DISPLAY ?? "", process: null};
  const probe = Bun.spawnSync(["sh", "-lc", "command -v Xvfb"], {stdout: "pipe", stderr: "pipe"});
  if (probe.exitCode !== 0) throw new Error("Electron vault audit requires DISPLAY or Xvfb on Linux");
  const firstDisplay = (process.pid + Date.now()) % 700;
  for (let attempt = 0; attempt < 700; attempt += 1) {
    const display = `:${100 + ((firstDisplay + attempt) % 700)}`;
    const xvfb = Bun.spawn(["Xvfb", display, "-screen", "0", "1280x720x24", "-nolisten", "tcp"], {stdout: "pipe", stderr: "pipe"});
    await Bun.sleep(250);
    if (xvfb.exitCode === null) return {display, process: xvfb};
    await xvfb.exited;
  }
  throw new Error("Xvfb could not start on any display in the bounded range :100-:799");
}

async function stopProcess(child: Child | null): Promise<void> {
  if (!child) return;
  if (platform() === "win32" && child.pid) {
    Bun.spawnSync(["taskkill", "/PID", String(child.pid), "/T", "/F"], {stdout: "ignore", stderr: "ignore"});
  } else {
    child.kill();
  }
  await Promise.race([child.exited, Bun.sleep(3_000)]);
}

async function removeTemporaryDirectory(path: string): Promise<void> {
  const attempts = platform() === "win32" ? 12 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      rmSync(path, {recursive: true, force: true});
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (platform() !== "win32" || !["EBUSY", "ENOTEMPTY", "EPERM"].includes(code ?? "") || attempt === attempts - 1) throw error;
      await Bun.sleep(250);
    }
  }
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

  async captureScreenshot(): Promise<{data: string}> {
    const id = this.nextId++;
    const response = new Promise<CdpResponse>((resolveResponse, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Electron CDP screenshot exceeded ${evaluationTimeoutMs}ms`));
      }, evaluationTimeoutMs);
      this.pending.set(id, (value) => {
        clearTimeout(timer);
        resolveResponse(value);
      });
    });
    this.socket.send(JSON.stringify({id, method: "Page.captureScreenshot", params: {format: "png"}}));
    const result = await response;
    if (result.error?.message) throw new Error(result.error.message);
    const data = result.result?.data;
    if (typeof data !== "string" || data.length === 0) throw new Error("Electron CDP returned no screenshot data");
    return {data};
  }

  close(): void {
    this.socket.close();
  }
}

async function pageTarget(port: number, output: () => string, urlFragment = "renderer/index.html"): Promise<CdpTarget> {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json() as CdpTarget[];
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl && target.url?.includes(urlFragment));
      if (page) return page;
    } catch {
      // Electron is still starting. The bounded deadline below reports a useful failure.
    }
    await Bun.sleep(100);
  }
  throw new Error(`Electron renderer did not become available: ${output()}`);
}

async function waitForPageTarget(port: number, output: () => string, urlFragment: string): Promise<CdpTarget> {
  return pageTarget(port, output, urlFragment);
}

async function launchRenderer(userData: string, display: string, launchArguments: string[] = []): Promise<{child: Child; output: () => string; client: CdpClient; port: number; stop: () => Promise<void>}> {
  const port = await freePort();
  const child = Bun.spawn([electronBinary, "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, ".", ...launchArguments], {
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
        return {child, output: output.get, client, port, stop: async () => {client.close(); await stopProcess(child);}};
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

async function waitForRenderer<T>(client: CdpClient, expression: string, predicate: (value: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + startupTimeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await client.evaluate<T>(expression);
    if (predicate(last)) return last;
    await Bun.sleep(100);
  }
  throw new Error(`Electron renderer did not reach ${label}: ${JSON.stringify(last)}`);
}

function fixtureStringList(key: string): string[] {
  return asArray(fixture[key]).map(string).filter(Boolean);
}

export function validateElectronVaultFixture(): {phases: number; paths: number; assertions: number} {
  requireCondition(fixture.schema_version === 1, "Electron vault fixture schema_version must be 1");
  requireCondition(string(fixture.id) === "fixture:electron-vault-roundtrip", "Electron vault fixture id is invalid");
  requireCondition(fixtureStringList("phases").length === 7, "Electron vault fixture phases are incomplete");
  requireCondition(fixtureStringList("paths").includes("Note.md"), "Electron vault fixture must include Note.md");
  requireCondition(fixtureStringList("assertions").length >= 8, "Electron vault fixture assertions are incomplete");
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

type ElectronUiFixture = {
  vaultRoot: string;
  userData: string;
  originalNote: Uint8Array;
  editedNote: Uint8Array;
};

type ScreenshotTrace = {bytes: number; sha256: string};

type ElectronThemeTrace = {
  mainDarkPreview: boolean;
  mainLightPreview: boolean;
  mainScreenshot: boolean;
  popoutPreview: boolean;
  popoutScreenshot: boolean;
  details: JsonRecord;
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

function createElectronUiFixture(): ElectronUiFixture {
  const vaultRoot = mkdtempSync(join(tmpdir(), "openobsidian-electron-ui-vault-"));
  const userData = mkdtempSync(join(tmpdir(), "openobsidian-electron-ui-user-"));
  const originalNote = Buffer.from("# UI fixture\nOriginal\n", "utf8");
  const editedNote = Buffer.from("# UI fixture\nEdited through keyboard save · नमस्ते · مرحبا · 東京 · 🌍\n", "utf8");
  mkdirSync(join(vaultRoot, ".obsidian"));
  mkdirSync(join(vaultRoot, ".obsidian", "themes"));
  mkdirSync(join(vaultRoot, ".obsidian", "snippets"));
  writeFileSync(join(vaultRoot, "Note.md"), originalNote);
  writeFileSync(join(vaultRoot, ".obsidian", "appearance.json"), `${JSON.stringify({cssTheme: "Minimal", mode: "dark", enabledCssSnippets: ["focus"], baseFontSize: 16})}\n`);
  writeFileSync(join(vaultRoot, ".obsidian", "themes", "Minimal.css"), [
    "body.theme-light { --fixture-surface: #f5f7fb; --fixture-ink: #172033; background: var(--fixture-surface); color: var(--fixture-ink); }",
    "body.theme-dark { --fixture-surface: #1d2230; --fixture-ink: #edf1ff; background: var(--fixture-surface); color: var(--fixture-ink); }",
    ".workspace { background: var(--fixture-surface); color: var(--fixture-ink); }",
    ".workspace-leaf .view-header { border-bottom: 1px solid currentColor; }",
    ".workspace-leaf-content.view-content { min-height: 120px; }",
    ".nav-files-container .nav-file { color: var(--fixture-ink); }",
    ".titlebar { min-height: 20px; }",
    ".status-bar { font-size: 11px; }",
    "body.mod-popout { --fixture-popout: 1; }",
    ".app-shell :focus-visible { outline: 2px solid #bb86fc; outline-offset: 2px; }",
  ].join("\n"));
  writeFileSync(join(vaultRoot, ".obsidian", "snippets", "focus.css"), ".app-shell button:focus-visible, body.mod-popout textarea:focus-visible { outline: 2px solid #7dd3fc; outline-offset: 2px; }");
  return {vaultRoot, userData, originalNote, editedNote};
}

type ElectronUiTrace = {
  launchIntentHydrated: boolean;
  keyboardSave: boolean;
  unicodeInput: boolean;
  modeSwitch: boolean;
  localRetrievalBoundary: boolean;
  initial: JsonRecord;
  savedStatus: string;
  retrievalMeta: string;
  theme: ElectronThemeTrace;
};

type ElectronUiInitial = {path: string; disabled: boolean; value: string; direction: string};
type ElectronUiInput = {focused: boolean; value: string; dirtyStatus: string};

type AppearanceState = {mode: string; applied: number; safety: string; controlsDisabled: boolean};

function screenshotTrace(data: string): ScreenshotTrace {
  const bytes = Buffer.from(data, "base64");
  return {bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex")};
}

async function runThemeTrace(runtime: Awaited<ReturnType<typeof launchRenderer>>, vaultRoot: string): Promise<ElectronThemeTrace> {
  const mainAppearance = `(() => ({
    mode: document.querySelector('.app-shell')?.getAttribute('data-openobsidian-theme-mode') ?? '',
    applied: document.querySelectorAll('style[data-openobsidian-style]').length,
    safety: document.querySelector('#appearance-safety')?.textContent ?? '',
    controlsDisabled: document.querySelector('#appearance-mode')?.disabled ?? true,
  }))()`;
  const dark = await waitForRenderer<AppearanceState>(runtime.client, mainAppearance, (value) => value.mode === "dark" && value.applied >= 2 && value.safety.includes("safe preview") && !value.controlsDisabled, "dark theme preview");
  const darkScreenshot = screenshotTrace((await runtime.client.captureScreenshot()).data);
  await runtime.client.evaluate(`(() => {
    const control = document.querySelector('#appearance-mode');
    if (!(control instanceof HTMLSelectElement)) throw new Error('Appearance mode control is unavailable');
    control.value = 'light';
    control.dispatchEvent(new Event('change', {bubbles: true}));
  })()`);
  const light = await waitForRenderer<AppearanceState>(runtime.client, mainAppearance, (value) => value.mode === "light" && value.applied >= 2 && value.safety.includes("safe preview"), "light theme preview");
  const lightScreenshot = screenshotTrace((await runtime.client.captureScreenshot()).data);
  let popoutClient: CdpClient | null = null;
  let popoutState: JsonRecord = {};
  let popoutScreenshot: ScreenshotTrace | null = null;
  try {
    const opened = asObject(await runtime.client.evaluate(`window.openObsidian.openPopout(${JSON.stringify({vaultRoot, relativePath: "Note.md"})})`), "openPopout");
    const target = await waitForPageTarget(runtime.port, runtime.output, "popout.html");
    popoutClient = await CdpClient.connect(target.webSocketDebuggerUrl!);
    popoutState = await waitForRenderer<JsonRecord>(popoutClient, `(() => ({
      mode: document.body?.dataset.openobsidianThemeMode ?? '',
      path: document.querySelector('#popout-path')?.textContent ?? '',
      editorDisabled: document.querySelector('#popout-editor')?.disabled ?? true,
      applied: document.querySelectorAll('style[data-openobsidian-style]').length,
      status: document.querySelector('#appearance-status')?.textContent ?? '',
    }))()`, (value) => value.mode === "dark" && value.path === "Note.md" && value.editorDisabled === false && Number(value.applied) >= 2 && String(value.status).includes("safe preview"), "popout theme preview");
    popoutScreenshot = screenshotTrace((await popoutClient.captureScreenshot()).data);
    return {
      mainDarkPreview: dark.mode === "dark" && dark.applied >= 2 && !dark.controlsDisabled,
      mainLightPreview: light.mode === "light" && light.applied >= 2,
      mainScreenshot: darkScreenshot.bytes > 0 && lightScreenshot.bytes > 0 && darkScreenshot.sha256 !== lightScreenshot.sha256,
      popoutPreview: popoutState.mode === "dark" && popoutState.path === "Note.md" && popoutState.editorDisabled === false && Number(popoutState.applied) >= 2,
      popoutScreenshot: popoutScreenshot.bytes > 0,
      details: {dark, light, dark_screenshot: darkScreenshot, light_screenshot: lightScreenshot, opened, popout: popoutState, popout_screenshot: popoutScreenshot},
    };
  } finally {
    popoutClient?.close();
  }
}

async function runUiProcess(fixtureData: ElectronUiFixture, display: string): Promise<ElectronUiTrace> {
  const runtime = await launchRenderer(fixtureData.userData, display, [`--vault=${fixtureData.vaultRoot}`, "--open=Note.md"]);
  try {
    const initial = await waitForRenderer<ElectronUiInitial>(
      runtime.client,
      "(() => { const editor = document.querySelector('#note-editor'); return {path: document.querySelector('#editor-path')?.textContent ?? '', disabled: editor?.disabled ?? true, value: editor?.value ?? '', direction: document.documentElement.dir}; })()",
      (value) => value.path === "Note.md" && value.disabled === false && value.value.includes("Original"),
      "launch-intent hydration",
    );
    requireCondition(initial.path === "Note.md" && initial.disabled === false, "Launch intent did not hydrate the visible editor");
    const state = await runtime.client.evaluate<ElectronUiInput>(`(() => {
      const editor = document.querySelector('#note-editor');
      if (!(editor instanceof HTMLTextAreaElement)) throw new Error('Visible note editor is unavailable');
      editor.focus();
      editor.value = ${JSON.stringify(new TextDecoder().decode(fixtureData.editedNote))};
      editor.dispatchEvent(new Event('input', {bubbles: true}));
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 's', ctrlKey: true, bubbles: true}));
      return {focused: document.activeElement === editor, value: editor.value, dirtyStatus: document.querySelector('#status')?.textContent ?? ''};
    })()`);
    requireCondition(state.focused === true, "Keyboard save fixture lost focus from the visible editor");
    requireCondition(state.value === new TextDecoder().decode(fixtureData.editedNote), "Unicode renderer input was not retained in the editor");
    const savedStatus = await waitForRenderer<string>(runtime.client, "document.querySelector('#status')?.textContent ?? ''", (value) => value.startsWith("Saved Note.md"), "keyboard save");
    const modeSwitch = await runtime.client.evaluate<boolean>(`(() => {
      const live = document.querySelector('[data-editor-mode="live-preview"]');
      const source = document.querySelector('[data-editor-mode="source"]');
      if (!(live instanceof HTMLButtonElement) || !(source instanceof HTMLButtonElement)) return false;
      live.click();
      const preview = document.querySelector('#note-preview');
      const previewVisible = !(preview instanceof HTMLElement) || !preview.hidden;
      source.click();
      return previewVisible && document.querySelector('#note-editor')?.hidden === false;
    })()`);
    await runtime.client.evaluate(`(() => {
      const open = document.querySelector('#open-retrieval');
      const query = document.querySelector('#retrieval-query');
      const form = document.querySelector('#retrieval-form');
      if (!(open instanceof HTMLButtonElement) || !(query instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) throw new Error('Visible retrieval controls are unavailable');
      open.click();
      query.value = 'Original';
      form.dispatchEvent(new SubmitEvent('submit', {bubbles: true, cancelable: true}));
    })()`);
    const retrievalMeta = await waitForRenderer<string>(runtime.client, "document.querySelector('#retrieval-meta')?.textContent ?? ''", (value) => value.includes('provider destination: none') && value.includes('embedding: deterministic-hash-v1') && value.includes('local source-only answer'), "local retrieval boundary");
    const theme = await runThemeTrace(runtime, fixtureData.vaultRoot);
    requireCondition(Object.entries(theme).filter(([key]) => key !== "details").every(([, value]) => value === true), `Electron theme trace failed: ${JSON.stringify(theme)}`);
    return {
      launchIntentHydrated: initial.path === "Note.md" && initial.disabled === false,
      keyboardSave: savedStatus.startsWith("Saved Note.md"),
      unicodeInput: state.value === new TextDecoder().decode(fixtureData.editedNote),
      modeSwitch,
      localRetrievalBoundary: retrievalMeta.includes("provider destination: none") && retrievalMeta.includes("embedding: deterministic-hash-v1") && retrievalMeta.includes("local source-only answer"),
      initial,
      savedStatus,
      retrievalMeta,
      theme,
    };
  } finally {
    await runtime.stop();
  }
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

function buildElectronReport(fixtureData: ElectronFixture, display: string, first: FirstProcessTrace, second: JsonRecord, ui: ElectronUiTrace): ElectronVaultAuditReport {
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
    launch_intent_hydrated_renderer: ui.launchIntentHydrated,
    renderer_keyboard_save: ui.keyboardSave,
    renderer_unicode_input: ui.unicodeInput,
    renderer_mode_switch: ui.modeSwitch,
    renderer_local_retrieval_boundary: ui.localRetrievalBoundary,
    renderer_theme_dark_preview: ui.theme.mainDarkPreview,
    renderer_theme_light_preview: ui.theme.mainLightPreview,
    renderer_theme_screenshots: ui.theme.mainScreenshot,
    popout_theme_preview: ui.theme.popoutPreview,
    popout_theme_screenshot: ui.theme.popoutScreenshot,
  };
  requireCondition(Object.entries(checks).every(([, value]) => value), `Electron audit checks failed: ${JSON.stringify(checks)}`);
  return {
    schema_version: 1,
    status: "passed",
    command: "bun run audit:electron-vault",
    environment: {platform: platform(), architecture: arch(), electron_version: string(readJson(join(root, "node_modules/electron/package.json")).version) || "unknown", display: display || "native"},
    fixture_id: string(fixture.id),
    checks,
    details: {vault_file_count: first.summary.fileCount, first_revision: first.read.revision, edited_revision: first.written.revision, before_sha256: fixtureData.before.sha256, after_sha256: snapshotVault(fixtureData.vaultRoot).sha256, renderer: ui},
    limitations: [
      "This is a disposable packaged Electron trace on the current host; reference Obsidian reopen behavior and human accessibility/input review remain separate gates.",
      "The trace proves the local broker and renderer boundary only; it does not certify unchanged plugin lifecycle, OS isolation, signing, publication or release readiness.",
      "No personal vault was accessed; the selected /home/ashutosh/Obsidian vault was not used.",
    ],
  };
}

export async function runElectronVaultAudit(): Promise<ElectronVaultAuditReport> {
  validateElectronVaultFixture();
  const fixtureData = createElectronFixture();
  const uiFixture = createElectronUiFixture();
  let displayRuntime: {display: string; process: Child | null} = {display: "", process: null};
  try {
    displayRuntime = await startXvfb();
    const ui = await runUiProcess(uiFixture, displayRuntime.display);
    const first = await runFirstProcess(fixtureData, displayRuntime.display);
    const second = await exerciseProcess(fixtureData.vaultRoot, fixtureData.userData, displayRuntime.display, fixtureData.editedNote);
    requireCondition(readFileSync(join(uiFixture.vaultRoot, "Note.md")).equals(Buffer.from(uiFixture.editedNote)), "Renderer keyboard save did not persist the edited note");
    return buildElectronReport(fixtureData, displayRuntime.display, first, second, ui);
  } finally {
    await stopProcess(displayRuntime.process);
    await removeTemporaryDirectory(fixtureData.vaultRoot);
    await removeTemporaryDirectory(fixtureData.userData);
    await removeTemporaryDirectory(uiFixture.vaultRoot);
    await removeTemporaryDirectory(uiFixture.userData);
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
