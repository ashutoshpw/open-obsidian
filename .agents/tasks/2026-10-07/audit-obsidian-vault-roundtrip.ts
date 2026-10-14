import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {lstat, mkdir, readFile, readdir, readlink, realpath, rename, unlink, writeFile} from "node:fs/promises";
import {createWriteStream} from "node:fs";
import {basename, dirname, join, relative, resolve, sep} from "node:path";
import {spawn, type ChildProcess} from "node:child_process";
import {isDeepStrictEqual} from "node:util";

type CdpTarget = {
  id?: string;
  type?: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};

type CdpResponse = {
  id?: number;
  result?: Record<string, unknown>;
  error?: {message?: string};
};

type SnapshotEntry = {
  path: string;
  kind: "file" | "directory" | "symlink" | "other";
  bytes?: number;
  sha256?: string;
  target?: string;
};

const reportDirectory = resolve(requiredEnv("OBSIDIAN_REPORT_DIRECTORY"));
const workDirectory = resolve(requiredEnv("OBSIDIAN_ROUNDTRIP_WORK_DIRECTORY"));
const vaultRoot = join(workDirectory, "C01.2 Roundtrip Fixture");
const canvasVaultName = "C06 Canvas Reference Fixture";
const canvasVaultRoot = join(workDirectory, canvasVaultName);
const basesVaultName = "C07 Bases Direction Reference Fixture";
const basesVaultRoot = join(workDirectory, basesVaultName);
const obsidianBinary = resolve(requiredEnv("OBSIDIAN_BINARY"));
const openObsidianBinary = resolve(requiredEnv("OPENOBSIDIAN_BINARY"));
const obsidianVersion = requiredEnv("OBSIDIAN_RELEASE_VERSION");
const obsidianSha256 = requiredEnv("OBSIDIAN_RELEASE_SHA256");
const sourceSha = process.env.GITHUB_SHA ?? "unknown";
const runId = process.env.GITHUB_RUN_ID ?? "unknown";
const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? "unknown";
const attachmentPath = "Assets/roundtrip image.png";
const noteMarker = "Authored by pinned Obsidian through its editor on GitHub Actions.";
const noteEmbed = "![[Assets/roundtrip image.png]]";
const noteContents = `${noteMarker}\n\n${noteEmbed}\n`;
const canvasPath = "C06 Reference.canvas";
const canvasMarker = "Canvas text card";
const canvasEditedText = "Canvas text card edited in OpenObsidian CI";
const canvasNotePath = "Notes/Canvas text card.md";
const canvasTargetPath = "Notes/Target.md";
const canvasTargetMarkdown = "# Heading\n\nTarget for the C06 Canvas fixture subpath. ^block-id\n";
const canvasTargetText = "Target for the C06 Canvas fixture subpath.";
const canvasTargetMarkdownBytes = Buffer.from(canvasTargetMarkdown, "utf8");
const basesDirectionFixturePaths = [
  "Ascending.base",
  "Descending.base",
  "Invalid Direction.base",
  "Omitted Direction.base",
  "Notes/01-zulu-first.md",
  "Notes/02-alpha-first.md",
  "Notes/03-bravo-first.md",
  "Notes/04-zulu-second.md",
  "Notes/05-alpha-second.md",
  "Notes/06-bravo-second.md",
];
const omittedBasesDirection = "OMITTED";
const invalidBasesDirection = "SIDEWAYS";
const normalizedInvalidBasesDirection = Buffer.from(
  "views:\n  - type: table\n    name: C07 group direction SIDEWAYS\n",
  "utf8",
);
const normalizedInvalidBasesDirectionSha256 = "6db35053b1d4aa0aca718364f906cd8820193c635ba002958f953d1aa03548cc";
const obsidianAsset = requiredEnv("OBSIDIAN_RELEASE_ASSET");
const obsidianSourcePlatform = requiredEnv("OBSIDIAN_SOURCE_PLATFORM");
const seedMarkdownPath = "Nested Ω/space note.md";
const seedMarkdown = "\uFEFF---\r\ntitle: Original CRLF note\r\nunknown_nested:\r\n  keep: [true, 7, 'opaque']\r\n---\r\n\r\nOriginal bytes stay untouched.\r\n";
const externalRefreshMarkdownPath = "After refresh.md";
const externalRenamedMarkdownPath = "After refresh renamed.md";
const externalRefreshMarkdown = "\uFEFF---\r\ntitle: External refresh note\r\nunknown_nested:\r\n  keep: [true, 13, 'external']\r\n---\r\n\r\nExternal note source stays exact.\r\n";
const externalRefreshMarkdownBytes = Buffer.from(externalRefreshMarkdown, "utf8");
const externalRefreshMarker = "External note source stays exact.";
const externalEditedMarkdown = "\uFEFF---\r\ntitle: External in-place edit\r\nunknown_nested:\r\n  keep: [true, 29, 'updated']\r\n---\r\n\r\nExternal note source updated by in-place edit.\r\n";
const externalEditedMarkdownBytes = Buffer.from(externalEditedMarkdown, "utf8");
const externalEditedMarker = "External note source updated by in-place edit.";
const workspaceStateAllowlist = [".obsidian/workspace.json", ".obsidian/workspace-mobile.json"];
const startedAt = new Date().toISOString();
const macOSWindowIds = new Map<number, string>();

const report: Record<string, unknown> = {
  schema_version: 1,
  milestone: "R2.8.76-C01.2-reference-app-external-note-rename-refresh",
  included_milestone_sections: [{
    milestone: "R2.8.106-C07.2-reference-rewrite-and-reopen-capture",
    report_path: "bases_group_direction_reference",
  }],
  status: "pending",
  started_at: startedAt,
  source_sha: sourceSha,
  runner_os: process.env.RUNNER_OS ?? "unknown",
  runner_image: process.env.ImageOS ?? process.env.OBSIDIAN_RUNNER_IMAGE ?? "unknown",
  runner_image_version: process.env.ImageVersion ?? "unknown",
  workflow_run_id: runId,
  workflow_run_attempt: runAttempt,
  reference_application: {
    product: "Obsidian Desktop",
    version: obsidianVersion,
    asset: obsidianAsset,
    sha256: obsidianSha256,
    ...(process.platform === "linux" ? {appimage_sha256: obsidianSha256} : {}),
    source_platform: obsidianSourcePlatform,
    runner_architecture: process.arch,
    fixture_authoring: "Open the generated vault in the pinned desktop app, create a new note with its editor action, and insert the seed text through the renderer keyboard input protocol.",
  },
  fixture: {
    privacy: "Generated synthetic data only; no personal vault content or credentials.",
    vault_path: "$RUNNER_TEMP/openobsidian-c01-roundtrip/C01.2 Roundtrip Fixture",
    seed_markdown_path: seedMarkdownPath,
    authored_note_path: null,
    attachment_path: attachmentPath,
    content_hashes: {},
  },
  obsidian_authoring: {status: "pending"},
  openobsidian_open: {status: "pending"},
  obsidian_reopen: {status: "pending"},
  canvas_reference_reopen: {
    status: "pending",
    text_edit: {status: "pending"},
    note_creation: {status: "pending"},
  },
  bases_group_direction_reference: {
    status: "pending",
    milestone: "R2.8.106-C07.2-reference-rewrite-and-reopen-capture",
    capture_scope: "Record pinned Obsidian behavior, including its exact unsupported-view source rewrite; Rust fixture reconciliation and byte-preserving parity acceptance are separate.",
    application: "Pinned Obsidian Desktop 1.14.4",
    explicit_direction_expectation: "Record rendered ASC/DESC group and row order without judging it against a Rust or preset expectation; reconcile the captured result in the follow-up parity milestone.",
    omitted_direction_expectation: "The pinned app rejects the tested native-YAML groupBy mapping when direction is omitted with `groupBy` must be a object; capture the settled exact-file error state on first open and reopen, record no group or row order, and do not infer a default.",
    workspace_restore_expectation: "After each session captures all four direction cases, make the supported ASC view active before shutdown. Keep the original source hashes immutable. At any post-open source-hash checkpoint, record only the exact known Invalid Direction.base normalization (122 to 62 bytes, groupBy removed) as pinned-app behavior; fail for any other change. If it occurs, restore only that generated file from its recorded seed after shutdown and before the reopened session, record the reseed, then capture the four original cases again.",
    source_preservation_expectation: "A source rewrite by pinned Obsidian is reported as a reference-app mutation, never as Rust source-preservation success. Rust parse/encode preservation remains a separate strict requirement.",
    fixture_paths_to_observe: basesDirectionFixturePaths,
    omitted_direction: omittedBasesDirection,
    invalid_direction: invalidBasesDirection,
  },
  vault_snapshots: {},
  openobsidian_app_data: {},
  workspace_state_allowlist: workspaceStateAllowlist,
  acceptance_limits: [
    "The run proves read-only startup, source preview and close, external note creation, in-place edit, and rename followed by explicit UI refresh and preview, native image-embed resolution and external attachment removal followed by refresh/re-resolution, plus explicit Canvas text-card note preview/review/confirmation before first-open and reopened-vault visibility, native folder-picker selection and cancellation, and Obsidian reopen on the recorded runner platform only; other operating systems require their own passing artifact.",
    "The deliberate external note creation, in-place note edit, attachment removal, and note rename each establish a new baseline; all subsequent no-op operations must preserve the latest applicable baseline exactly.",
    "The Canvas check uses a dedicated reference-compatible fixture and fresh Obsidian profile, edits one native text card with no write before explicit save, verifies the saved JSON differs only at that selected card's text while preserving sibling nodes and edges, creates one Markdown note afterward with the edited text-card bytes, exposes the edited text and referenced block content, and checks the edited Canvas and note after first-open and reopened-vault sessions. The codec's rich unknown-field fixture remains covered by Rust tests and is not opened by Obsidian. This does not certify every Canvas workflow or cross-platform behavior beyond the recorded runner.",
    "The C07 reference probe opens synthetic Bases files with explicit ASC and DESC, omitted direction, and an unsupported direction. For ASC and DESC it captures every rendered group and file row from all Bases table roots on first open and reopen, including the null-value group containing the .base files, without judging observed ordering against preset expectations. For the tested omitted-direction native-YAML mapping, it captures the settled exact-file parse rejection (`groupBy` must be a object) and records no group or row order; it does not infer a default. The unsupported direction remains a capture-only observation. Before each shutdown, the probe explicitly restores ASC. It retains the original source hash baseline and reports Obsidian's exact 62-byte Invalid Direction.base rewrite if it occurs at any post-open source-hash checkpoint; the generated file is reseeded between sessions so the reopened view is captured from the original fixture, with that harness action reported. This reference-app mutation is not evidence that Rust preserves the source. Interpretation and Rust fixture reconciliation belong to the follow-up parity milestone.",
    "This run does not certify all product C01 flows or general plugin/theme compatibility.",
  ],
};

class DevToolsConnection {
  private nextId = 0;
  private readonly pending = new Map<number, {resolve(value: CdpResponse): void; reject(error: Error): void}>();

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      let message: CdpResponse;
      try {
        message = JSON.parse(String(event.data)) as CdpResponse;
      } catch {
        return;
      }
      if (typeof message.id !== "number") return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message ?? "Chrome DevTools Protocol request failed"));
      else request.resolve(message);
    });
    socket.addEventListener("close", () => {
      for (const request of this.pending.values()) request.reject(new Error("DevTools connection closed"));
      this.pending.clear();
    });
  }

  static async connect(url: string): Promise<DevToolsConnection> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolveOpen, rejectOpen) => {
      const timer = setTimeout(() => rejectOpen(new Error("Timed out connecting to Obsidian DevTools")), 15_000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolveOpen();
      }, {once: true});
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        rejectOpen(new Error("Could not connect to Obsidian DevTools"));
      }, {once: true});
    });
    return new DevToolsConnection(socket);
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<CdpResponse> {
    const id = ++this.nextId;
    return new Promise<CdpResponse>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error(`Timed out waiting for DevTools method ${method}`));
      }, 20_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolveRequest(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectRequest(error);
        },
      });
      this.socket.send(JSON.stringify({id, method, params}));
    });
  }

  send(method: string, params: Record<string, unknown> = {}): void {
    const id = ++this.nextId;
    this.socket.send(JSON.stringify({id, method, params}));
  }

  async evaluateJson<T>(expression: string): Promise<T> {
    const response = await this.request("Runtime.evaluate", {
      expression: `JSON.stringify(${expression})`,
      returnByValue: true,
      awaitPromise: true,
    });
    const value = (response.result?.result as {value?: unknown} | undefined)?.value;
    if (typeof value !== "string") {
      const exception = response.result?.exceptionDetails as {text?: string} | undefined;
      throw new Error(`Obsidian renderer evaluation returned no JSON value: ${exception?.text ?? "unknown error"}`);
    }
    return JSON.parse(value) as T;
  }

  async evaluate(expression: string): Promise<unknown> {
    const response = await this.request("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    const exception = response.result?.exceptionDetails as {text?: string} | undefined;
    if (exception) throw new Error(`Obsidian renderer evaluation failed: ${exception.text ?? "unknown error"}`);
    return (response.result?.result as {value?: unknown} | undefined)?.value;
  }

  close(): void {
    this.socket.close();
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required GitHub Actions environment variable ${name} is missing`);
  return value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function saveReport(): Promise<void> {
  await mkdir(reportDirectory, {recursive: true});
  await writeFile(join(reportDirectory, "obsidian-vault-roundtrip-report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

async function waitFor<T>(label: string, read: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await delay(500);
  }
  const serializedLast = JSON.stringify(last);
  throw new Error(`Timed out waiting for ${label}; last value=${(serializedLast ?? String(last)).slice(0, 2_000)}`);
}

type OpenObsidianRefreshDiagnostics = {
  requests: Array<{source: string; line: number}>;
  consumedResults: Array<{succeeded: boolean; entries: number | null; line: number}>;
  receiverStates: Array<{busy: boolean; line: number}>;
};

function openObsidianRefreshActivityChanged(
  before: OpenObsidianRefreshDiagnostics,
  after: OpenObsidianRefreshDiagnostics,
): boolean {
  return before.requests.length !== after.requests.length
    || before.consumedResults.length !== after.consumedResults.length;
}

async function readOpenObsidianRefreshDiagnostics(
  logPath = join(reportDirectory, "openobsidian.log"),
): Promise<OpenObsidianRefreshDiagnostics> {
  const log = await readFile(logPath, "utf8").catch(() => "");
  const diagnostics: OpenObsidianRefreshDiagnostics = {requests: [], consumedResults: [], receiverStates: []};
  for (const [line, value] of log.split(/\r?\n/).entries()) {
    const request = value.match(/OpenObsidian CI vault refresh request: source=([a-z_]+)/);
    if (request) diagnostics.requests.push({source: request[1] ?? "unknown", line});
    const consumed = value.match(/OpenObsidian CI vault refresh result consumed: succeeded=(true|false)(?:, entries=(\d+))?/);
    if (consumed) diagnostics.consumedResults.push({
      succeeded: consumed[1] === "true",
      entries: consumed[2] === undefined ? null : Number(consumed[2]),
      line,
    });
    const receiverState = value.match(/OpenObsidian CI UI state: .*vault_refresh_receiver=(true|false)/);
    if (receiverState) diagnostics.receiverStates.push({busy: receiverState[1] === "true", line});
  }
  return diagnostics;
}

async function waitForOpenObsidianRefreshIdle(
  previousRequestCount: number,
  expectedEntries: number,
  requireManualRequest: boolean,
  logPath = join(reportDirectory, "openobsidian.log"),
): Promise<OpenObsidianRefreshDiagnostics & {settled_for_ms: number}> {
  let settledSince: number | null = null;
  return await waitFor(
    requireManualRequest
      ? "OpenObsidian to finish the explicit manual note-list refresh"
      : "OpenObsidian watcher refreshes to settle before the manual refresh",
    async () => {
      const diagnostics = await readOpenObsidianRefreshDiagnostics(logPath);
      const latestRequest = diagnostics.requests.at(-1);
      const latestResult = diagnostics.consumedResults.at(-1);
      const receiverBusy = diagnostics.receiverStates.at(-1)?.busy ?? false;
      const latestRequestConsumed = !latestRequest || Boolean(latestResult && latestResult.line > latestRequest.line);
      const newManualRequest = diagnostics.requests.some((request, index) => (
        index >= previousRequestCount && request.source === "manual_button"
      ));
      const latestResultHasExpectedEntries = latestResult?.succeeded === true && latestResult.entries === expectedEntries;
      const ready = !receiverBusy
        && latestRequestConsumed
        && (!requireManualRequest || (newManualRequest && latestResultHasExpectedEntries));
      if (ready) settledSince ??= Date.now();
      else settledSince = null;
      return {...diagnostics, settled_for_ms: settledSince === null ? 0 : Date.now() - settledSince};
    },
    (diagnostics) => diagnostics.settled_for_ms >= 750,
    30_000,
  );
}

async function clickManualRefreshUntilRequested(
  child: ChildProcess,
  windowId: string,
  previousRequestCount: number,
): Promise<string> {
  const clickActions: string[] = [];
  let lastClickAt = 0;
  const result = await waitFor(
    "OpenObsidian to receive the explicit manual note-list refresh",
    async () => {
      const diagnostics = await readOpenObsidianRefreshDiagnostics();
      const manualRequest = diagnostics.requests.find((request, index) => (
        index >= previousRequestCount && request.source === "manual_button"
      ));
      if (manualRequest) return {diagnostics, manualRequest};

      const latestRequest = diagnostics.requests.at(-1);
      const latestResult = diagnostics.consumedResults.at(-1);
      const receiverBusy = diagnostics.receiverStates.at(-1)?.busy ?? false;
      const latestRequestConsumed = !latestRequest || Boolean(latestResult && latestResult.line > latestRequest.line);
      if (
        !receiverBusy
        && latestRequestConsumed
        && clickActions.length < 4
        && Date.now() - lastClickAt >= 500
      ) {
        clickActions.push(await invokeNativeAccessibleControl(
          child,
          windowId,
          "Refresh note list",
          "Markdown files found",
          true,
        ));
        lastClickAt = Date.now();
      }
      return {diagnostics, manualRequest: null};
    },
    (value) => value.manualRequest !== null,
    30_000,
  );
  return clickActions.at(-1) ?? `Manual refresh request observed at log line ${result.manualRequest?.line ?? "unknown"}`;
}

async function waitForDevToolsVersion(port: number): Promise<{Browser?: string; "Protocol-Version"?: string}> {
  const value = await waitFor<{Browser?: string; "Protocol-Version"?: string} | null>(`Obsidian DevTools port ${port}`, async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (!response.ok) return null;
      return await response.json() as {Browser?: string; "Protocol-Version"?: string};
    } catch {
      return null;
    }
  }, (candidate) => candidate !== null);
  if (!value) throw new Error(`Obsidian DevTools did not start on port ${port}`);
  return value;
}

async function readPageTargets(port: number): Promise<CdpTarget[]> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) return [];
    return await response.json() as CdpTarget[];
  } catch {
    return [];
  }
}

async function waitForPageTarget(port: number, predicate: (target: CdpTarget) => boolean = () => true, label = `Obsidian page target on port ${port}`): Promise<CdpTarget> {
  const value = await waitFor<CdpTarget | null>(label, async () => {
    try {
      const targets = await readPageTargets(port);
      return targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl && predicate(target)) ?? null;
    } catch {
      return null;
    }
  }, (candidate) => candidate !== null);
  if (!value) throw new Error(`Obsidian did not expose a page target on port ${port}`);
  return value;
}

async function connectTarget(target: CdpTarget): Promise<DevToolsConnection> {
  if (!target.webSocketDebuggerUrl) throw new Error("Obsidian page target did not expose its DevTools WebSocket");
  const connection = await DevToolsConnection.connect(target.webSocketDebuggerUrl);
  await connection.request("Page.enable");
  await connection.request("Runtime.enable");
  return connection;
}

async function connectObsidian(port: number): Promise<{connection: DevToolsConnection; browserVersion: string; target: CdpTarget}> {
  const version = await waitForDevToolsVersion(port);
  const target = await waitForPageTarget(port);
  const connection = await connectTarget(target);
  return {connection, browserVersion: version.Browser ?? "unknown", target};
}

function launchLogged(command: string, args: string[], logPath: string, env: NodeJS.ProcessEnv): ChildProcess {
  const log = createWriteStream(logPath, {flags: "a"});
  const child = spawn(command, args, {env, stdio: ["ignore", "pipe", "pipe"]});
  child.stdout?.pipe(log, {end: false});
  child.stderr?.pipe(log, {end: false});
  child.once("close", () => log.end());
  return child;
}

async function waitForExit(child: ChildProcess, timeoutMs = 20_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolveExit, rejectExit) => {
    const timer = setTimeout(() => rejectExit(new Error(`Process ${child.pid ?? "unknown"} did not exit within ${timeoutMs} ms`)), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}

async function stopProcess(child: ChildProcess | undefined, connection?: DevToolsConnection): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    connection?.close();
    return;
  }
  if (connection) {
    try {
      await connection.request("Browser.close");
    } catch {
      connection.close();
    }
  }
  if (!connection) child.kill("SIGTERM");
  try {
    await waitForExit(child, 15_000);
  } catch {
    child.kill("SIGTERM");
    try {
      await waitForExit(child, 5_000);
    } catch {
      child.kill("SIGKILL");
      await waitForExit(child, 5_000).catch(() => undefined);
    }
  }
  connection?.close();
}

function xdotool(...args: string[]): void {
  execFileSync("xdotool", args, {stdio: "ignore"});
}

function clickWindowOpenButton(windowId: string): {window_x: number; window_y: number; window_width: number; window_height: number; click_x: number; click_y: number} {
  const geometryOutput = execFileSync("xdotool", ["getwindowgeometry", "--shell", windowId], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
  const readGeometry = (key: string): number => {
    const match = geometryOutput.match(new RegExp(`^${key}=(\\d+)$`, "m"));
    if (!match) throw new Error(`Could not read ${key} from native folder picker geometry`);
    return Number(match[1]);
  };
  const windowX = readGeometry("X");
  const windowY = readGeometry("Y");
  const windowWidth = readGeometry("WIDTH");
  const windowHeight = readGeometry("HEIGHT");
  const clickX = Math.round(windowX + windowWidth * 0.953);
  const clickY = Math.round(windowY + windowHeight * 0.915);
  xdotool("mousemove", "--sync", String(clickX), String(clickY));
  xdotool("click", "1");
  return {window_x: windowX, window_y: windowY, window_width: windowWidth, window_height: windowHeight, click_x: clickX, click_y: clickY};
}

async function clickOpenVaultButtonLinux(windowId: string, applicationLogPath: string): Promise<{window_x: number; window_y: number; window_width: number; window_height: number; click_x: number; click_y: number; focused_window_before_activation: string; focused_window_after_activation: string; pointer_before_click: string; egui_action_event: string; keyboard_fallback: false}> {
  const geometryOutput = execFileSync("xdotool", ["getwindowgeometry", "--shell", windowId], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
  const readGeometry = (key: string): number => {
    const match = geometryOutput.match(new RegExp(`^${key}=(\\d+)$`, "m"));
    if (!match) throw new Error(`Could not read ${key} from OpenObsidian window geometry`);
    return Number(match[1]);
  };
  const windowX = readGeometry("X");
  const windowY = readGeometry("Y");
  const windowWidth = readGeometry("WIDTH");
  const windowHeight = readGeometry("HEIGHT");
  const clickX = Math.round(windowX + windowWidth * 0.045);
  const clickY = Math.round(windowY + windowHeight * 0.085);
  const focusedWindowBeforeActivation = x11InteractionState().focused_window_id;
  xdotool("windowraise", windowId);
  xdotool("windowfocus", "--sync", windowId);
  await delay(250);
  const focusedWindowAfterActivation = x11InteractionState().focused_window_id;
  const pointerBeforeClick = x11InteractionState().pointer;
  const activationLogBefore = await readFile(applicationLogPath, "utf8");
  const activationCountBefore = activationLogBefore.split("OpenObsidian CI action: Open vault click received").length - 1;
  xdotool("mousemove", "--sync", String(clickX), String(clickY));
  await delay(100);
  xdotool("click", "1");
  const eguiActionEvent = await waitFor(
    "OpenObsidian to receive the Linux Open vault click",
    async () => {
      const currentLog = await readFile(applicationLogPath, "utf8");
      const actionLines = currentLog
        .split(/\r?\n/)
        .filter((line) => line.includes("OpenObsidian CI action: Open vault click received"));
      return actionLines.length > activationCountBefore ? actionLines.at(-1) ?? null : null;
    },
    (line) => line !== null,
    5_000,
  );
  if (!eguiActionEvent) throw new Error(`Linux click did not activate Open vault; X11 focus=${focusedWindowAfterActivation}; pointer=${pointerBeforeClick}`);
  return {
    window_x: windowX,
    window_y: windowY,
    window_width: windowWidth,
    window_height: windowHeight,
    click_x: clickX,
    click_y: clickY,
    focused_window_before_activation: focusedWindowBeforeActivation,
    focused_window_after_activation: focusedWindowAfterActivation,
    pointer_before_click: pointerBeforeClick,
    egui_action_event: eguiActionEvent,
    keyboard_fallback: false,
  };
}

type X11WindowDescription = {window_id: string; title: string; window_class: string; geometry: string};

function x11WindowInventory(): X11WindowDescription[] {
  let output: string;
  try {
    output = execFileSync("xdotool", ["search", "--onlyvisible", "--name", "."], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === 1
    ) {
      return [];
    }
    throw error;
  }
  return output.split(/\r?\n/).filter((windowId) => /^\d+$/.test(windowId)).map((windowId) => {
    const read = (args: string[]): string => {
      try {
        return execFileSync("xdotool", args, {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
      } catch {
        return "";
      }
    };
    const title = read(["getwindowname", windowId]);
    const windowClass = read(["getwindowclassname", windowId]);
    const geometry = read(["getwindowgeometry", "--shell", windowId]).split(/\r?\n/)
      .filter((line) => /^(X|Y|WIDTH|HEIGHT)=/.test(line))
      .join(",");
    return {window_id: windowId, title, window_class: windowClass, geometry};
  });
}

function x11InteractionState(): {focused_window_id: string; focused_window_title: string; pointer: string} {
  const read = (args: string[]): string => {
    try {
      return execFileSync("xdotool", args, {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
    } catch {
      return "unavailable";
    }
  };
  const focusedWindowId = read(["getwindowfocus"]);
  return {
    focused_window_id: focusedWindowId,
    focused_window_title: /^\d+$/.test(focusedWindowId) ? read(["getwindowname", focusedWindowId]) : "unavailable",
    pointer: read(["getmouselocation", "--shell"]),
  };
}

async function clickOpenVaultButtonMacOS(child: ChildProcess): Promise<string> {
  const positionScript = `on run argv
    tell application "System Events"
      set targetProcess to first process whose unix id is (item 1 of argv as integer)
      set frontmost of targetProcess to true
      set windowPosition to position of window 1 of targetProcess
      return (item 1 of windowPosition as integer) & "," & (item 2 of windowPosition as integer)
    end tell
  end run`;
  const position = execFileSync("osascript", ["-e", positionScript, String(child.pid ?? -1)], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
  const coordinates = position.match(/\d+/g)?.map(Number) ?? [];
  if (coordinates.length < 2) throw new Error(`Could not read the OpenObsidian window position for a native click: ${position}`);
  const clickX = coordinates[0] + 36;
  const clickY = coordinates[1] + 83;
  const swiftPath = join(workDirectory, "openobsidian-click.swift");
  await writeFile(swiftPath, `import AppKit
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3,
      let x = Double(CommandLine.arguments[1]),
      let y = Double(CommandLine.arguments[2]) else {
    fatalError("Expected screen x and y coordinates")
}
let point = CGPoint(x: x, y: y)
for type in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else {
        fatalError("Could not create a mouse event")
    }
    event.post(tap: .cghidEventTap)
    if type == .leftMouseDown { Thread.sleep(forTimeInterval: 0.08) }
}
`);
  execFileSync("swift", [swiftPath, String(clickX), String(clickY)], {stdio: "ignore"});
  return `Sent a macOS mouse click to the visible Open vault control at (${clickX}, ${clickY}).`;
}

async function clickMacOSNativePickerOpenButton(child: ChildProcess): Promise<string> {
  const boundsScript = `on run argv
    tell application "System Events"
      set targetProcess to first process whose unix id is (item 1 of argv as integer)
      set pickerWindow to first window of targetProcess whose name is "Open"
      set pickerPosition to position of pickerWindow
      set pickerSize to size of pickerWindow
      return (item 1 of pickerPosition as integer) & "," & (item 2 of pickerPosition as integer) & "," & (item 1 of pickerSize as integer) & "," & (item 2 of pickerSize as integer)
    end tell
  end run`;
  const bounds = execFileSync("osascript", ["-e", boundsScript, String(child.pid ?? -1)], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
  const coordinates = bounds.match(/-?\d+/g)?.map(Number) ?? [];
  if (coordinates.length < 4) throw new Error(`Could not read the native macOS Open panel bounds: ${bounds}; windows=${macOSApplicationWindowDescriptions(child)}`);
  const [windowX, windowY, windowWidth, windowHeight] = coordinates;
  const clickX = windowX + windowWidth - 57;
  const clickY = windowY + windowHeight - 32;
  const swiftPath = join(workDirectory, "openobsidian-picker-click.swift");
  await writeFile(swiftPath, `import AppKit
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3,
      let x = Double(CommandLine.arguments[1]),
      let y = Double(CommandLine.arguments[2]) else {
    fatalError("Expected screen x and y coordinates")
}
let point = CGPoint(x: x, y: y)
for type in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else {
        fatalError("Could not create a mouse event")
    }
    event.post(tap: .cghidEventTap)
    if type == .leftMouseDown { Thread.sleep(forTimeInterval: 0.08) }
}
`);
  execFileSync("swift", [swiftPath, String(clickX), String(clickY)], {stdio: "ignore"});
  return `Clicked the native macOS Open button at (${clickX}, ${clickY}) using panel bounds ${bounds}.`;
}

function activeWindowTitle(): string {
  try {
    return execFileSync("xdotool", ["getwindowfocus", "getwindowname"], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
  } catch {
    return "";
  }
}

function activeWindowId(): string {
  try {
    return execFileSync("xdotool", ["getwindowfocus"], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
  } catch {
    return "";
  }
}

function macOSApplicationWindowDescriptions(child: ChildProcess): string {
  const script = `on run argv
    tell application "System Events"
      set targetProcess to first process whose unix id is (item 1 of argv as integer)
      set windowDescriptions to {}
      try
        repeat with candidateWindow in windows of targetProcess
          try
            set candidateRole to role of candidateWindow as text
          on error
            set candidateRole to "window"
          end try
          try
            set candidateName to name of candidateWindow as text
          on error
            set candidateName to ""
          end try
          set end of windowDescriptions to candidateRole & ":" & candidateName
          try
            repeat with candidateSheet in sheets of candidateWindow
              try
                set candidateSheetName to name of candidateSheet as text
              on error
                set candidateSheetName to ""
              end try
              set end of windowDescriptions to "AXSheet:" & candidateSheetName
            end repeat
          end try
        end repeat
      on error errorMessage
        set end of windowDescriptions to "accessibility error:" & errorMessage
      end try
      return windowDescriptions as text
    end tell
  end run`;
  return execFileSync("osascript", ["-e", script, String(child.pid ?? -1)], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
}

function macOSNativePickerVisibleInAccessibility(descriptions: string): boolean {
  if (/AXSheet:/i.test(descriptions) || /open.{0,40}vault/i.test(descriptions)) return true;
  const windows = descriptions.match(/(?:AXWindow|standard window|dialog):/gi) ?? [];
  return windows.length > 1;
}

type WindowsTopLevelWindow = {
  name: string;
  class_name: string;
  process_id: number;
  native_window_handle: number;
  is_offscreen: boolean;
};

function windowsTopLevelWindowInventory(): WindowsTopLevelWindow[] {
  const script = `
    $ErrorActionPreference = "Stop"
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $elements = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition
    )
    $windows = @()
    foreach ($element in $elements) {
      try {
        $current = $element.Current
        $name = [string]$current.Name
        $className = [string]$current.ClassName
        $processId = [int]$current.ProcessId
        $handle = [int]$current.NativeWindowHandle
        $isOffscreen = [bool]$current.IsOffscreen
        if ($name -or $className -or $handle -ne 0) {
          $windows += [PSCustomObject]@{
            name = $name
            class_name = $className
            process_id = $processId
            native_window_handle = $handle
            is_offscreen = $isOffscreen
          }
        }
      } catch {}
    }
    ConvertTo-Json -InputObject @($windows) -Depth 3 -Compress
  `;
  const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
  if (!output || output === "null") return [];
  const value = JSON.parse(output) as WindowsTopLevelWindow | WindowsTopLevelWindow[];
  return Array.isArray(value) ? value : [value];
}

function windowsOpenVaultControlInventory(processId: number): unknown {
  const script = `
    $ErrorActionPreference = "Stop"
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $application = Get-Process -Id $env:OPENOBSIDIAN_WINDOW_PROCESS_ID -ErrorAction SilentlyContinue
    if ($null -eq $application -or $application.MainWindowHandle -eq 0) {
      $application = Get-Process -Name "openobsidian" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    }
    if ($null -eq $application -or $application.MainWindowHandle -eq 0) { throw "OpenObsidian did not expose its main window handle" }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($application.MainWindowHandle)
    $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $controls = @()
    foreach ($element in $elements) {
      try {
        $current = $element.Current
        $name = [string]$current.Name
        $automationId = [string]$current.AutomationId
        $controlType = [string]$current.ControlType.ProgrammaticName
        if ($name -or $automationId -or $controlType -match "Button") {
          $bounds = $current.BoundingRectangle
          $controls += [PSCustomObject]@{
            name = $name
            automation_id = $automationId
            control_type = $controlType
            class_name = [string]$current.ClassName
            is_enabled = [bool]$current.IsEnabled
            is_offscreen = [bool]$current.IsOffscreen
            bounds = "$($bounds.Left),$($bounds.Top),$($bounds.Width),$($bounds.Height)"
          }
        }
      } catch {}
    }
    ConvertTo-Json -InputObject @($controls) -Depth 4 -Compress
  `;
  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      env: {...process.env, OPENOBSIDIAN_WINDOW_PROCESS_ID: String(processId)},
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return output ? JSON.parse(output) : [];
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {error: detail};
  }
}

function isNewWindowsNativePicker(windowDescription: WindowsTopLevelWindow, previousHandles: Set<number>, applicationPid: number): boolean {
  if (windowDescription.is_offscreen || previousHandles.has(windowDescription.native_window_handle)) return false;
  return windowDescription.process_id === applicationPid ||
    /open|folder|browse|select|choose/i.test(`${windowDescription.name} ${windowDescription.class_name}`) ||
    windowDescription.class_name === "#32770";
}

async function waitForRenderer(connection: DevToolsConnection, expression: string, predicate: (value: string) => boolean, label: string, timeoutMs = 120_000): Promise<string> {
  return await waitFor(label, async () => await connection.evaluateJson<string>(expression), predicate, timeoutMs);
}

async function captureObsidianScreenshot(connection: DevToolsConnection, filename: string): Promise<void> {
  const response = await connection.request("Page.captureScreenshot", {format: "png", captureBeyondViewport: false});
  const base64 = response.result?.data as string | undefined;
  if (!base64) throw new Error("Obsidian did not return a renderer screenshot");
  await writeFile(join(reportDirectory, filename), Buffer.from(base64, "base64"));
}

async function captureX11Screenshot(filename: string): Promise<string> {
  const xwdPath = join(reportDirectory, filename.replace(/\.png$/i, ".xwd"));
  const pngPath = join(reportDirectory, filename);
  execFileSync("xwd", ["-root", "-silent", "-out", xwdPath], {stdio: "ignore"});
  execFileSync("convert", [xwdPath, pngPath], {stdio: "ignore"});
  return pngPath;
}

async function captureDesktopScreenshot(filename: string): Promise<string> {
  if (process.platform === "linux") return await captureX11Screenshot(filename);
  const pngPath = join(reportDirectory, filename);
  if (process.platform === "darwin") {
    execFileSync("screencapture", ["-x", pngPath], {stdio: "ignore"});
    return pngPath;
  }
  const script = `
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save($env:OBSIDIAN_SCREENSHOT_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
  `;
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    env: {...process.env, OBSIDIAN_SCREENSHOT_PATH: pngPath},
    stdio: "ignore",
  });
  return pngPath;
}

async function captureX11WindowScreenshot(windowId: string, filename: string): Promise<string> {
  const xwdPath = join(reportDirectory, filename.replace(/\.png$/i, ".xwd"));
  const pngPath = join(reportDirectory, filename);
  execFileSync("xwd", ["-id", windowId, "-silent", "-out", xwdPath], {stdio: "ignore"});
  execFileSync("convert", [xwdPath, pngPath], {stdio: "ignore"});
  return pngPath;
}

async function captureMacOSWindowScreenshot(processId: number, filename: string): Promise<string> {
  let windowId = macOSWindowIds.get(processId);
  if (!windowId) {
    const script = `
      import CoreGraphics
      import Foundation

      let targetProcessId = ${processId}
      let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
      let targetWindow = windows.first { window in
        (window[kCGWindowOwnerPID as String] as? Int) == targetProcessId &&
        (window[kCGWindowLayer as String] as? Int) == 0
      }
      guard let windowNumber = targetWindow?[kCGWindowNumber as String] else {
        fputs("OpenObsidian did not expose an on-screen macOS window\\n", stderr)
        exit(1)
      }
      print(windowNumber)
    `;
    windowId = execFileSync("swift", ["-e", script], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim().split(/\s+/).at(-1);
    if (!windowId || !/^\d+$/.test(windowId)) throw new Error("Could not identify OpenObsidian's macOS window for screenshot capture");
    macOSWindowIds.set(processId, windowId);
  }
  const pngPath = join(reportDirectory, filename);
  execFileSync("screencapture", ["-x", `-l${windowId}`, pngPath], {stdio: "ignore"});
  return pngPath;
}

async function captureWindowsWindowScreenshot(processId: number, filename: string): Promise<{
  pngPath: string;
  window_id: string;
  title: string;
  geometry: string;
}> {
  const pngPath = join(reportDirectory, filename);
  const script = `
    $ErrorActionPreference = "Stop"
    Add-Type -AssemblyName System.Drawing
    Add-Type -TypeDefinition @'
      using System;
      using System.Runtime.InteropServices;
      public struct OpenObsidianWindowRect {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
      }
      public static class OpenObsidianWindowCapture {
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out OpenObsidianWindowRect rect);
      }
'@
    $application = Get-Process -Id $env:OPENOBSIDIAN_WINDOW_PROCESS_ID -ErrorAction SilentlyContinue
    if ($null -eq $application -or $application.MainWindowHandle -eq 0) {
      $application = Get-Process -Name "openobsidian" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    }
    if ($null -eq $application -or $application.MainWindowHandle -eq 0) {
      throw "Could not find the OpenObsidian main window for process $env:OPENOBSIDIAN_WINDOW_PROCESS_ID"
    }
    $bounds = New-Object OpenObsidianWindowRect
    if (-not [OpenObsidianWindowCapture]::GetWindowRect($application.MainWindowHandle, [ref]$bounds)) {
      throw "Could not read the OpenObsidian main window bounds"
    }
    $width = $bounds.Right - $bounds.Left
    $height = $bounds.Bottom - $bounds.Top
    if ($width -le 0 -or $height -le 0) {
      throw "OpenObsidian reported invalid window bounds: $($bounds.Left),$($bounds.Top),$width,$height"
    }
    $bitmap = [System.Drawing.Bitmap]::new($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
      $bitmap.Save($env:OBSIDIAN_SCREENSHOT_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
    [ordered]@{
      window_id = $application.MainWindowHandle.ToInt64().ToString()
      title = $application.MainWindowTitle
      geometry = "x=$($bounds.Left) y=$($bounds.Top) width=$width height=$height"
    } | ConvertTo-Json -Compress
  `;
  const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    env: {...process.env, OBSIDIAN_SCREENSHOT_PATH: pngPath, OPENOBSIDIAN_WINDOW_PROCESS_ID: String(processId)},
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const window = JSON.parse(output) as {window_id: string; title: string; geometry: string};
  return {pngPath, ...window};
}

async function prepareScreenshotForOcr(imagePath: string): Promise<string> {
  const ocrImagePath = join(reportDirectory, "openobsidian-vault-window-ocr.png");
  const imageMagick = process.platform === "linux" ? "convert" : "magick";
  execFileSync(imageMagick, [imagePath, "-colorspace", "Gray", "-level", "0%,15%", "-resize", "200%", ocrImagePath], {stdio: "ignore"});
  return ocrImagePath;
}

async function readScreenshotOcr(imagePath: string): Promise<string> {
  const ocrImagePath = await prepareScreenshotForOcr(imagePath);
  const pageSegmentationModes = process.platform === "darwin" || process.platform === "win32" ? ["11", "6"] : ["6"];
  return runTesseractOcr(ocrImagePath, pageSegmentationModes);
}

async function readNativeFolderPickerOcr(imagePath: string): Promise<string> {
  if (process.platform !== "darwin") return await readScreenshotOcr(imagePath);
  const ocrImagePath = join(reportDirectory, "openobsidian-vault-picker-cancel-open-ocr.png");
  execFileSync("magick", [imagePath, "-gravity", "center", "-crop", "90%x75%+0+0", "+repage", "-colorspace", "Gray", "-level", "0%,35%", "-resize", "250%", ocrImagePath], {stdio: "ignore"});
  const pageSegmentationModes = ["11", "6"];
  return runTesseractOcr(ocrImagePath, pageSegmentationModes);
}

function runTesseractOcr(imagePath: string, pageSegmentationModes: string[]): string {
  const tesseract = process.platform === "win32" ? "tesseract.exe" : "tesseract";
  return pageSegmentationModes.map((mode) => execFileSync(tesseract, [imagePath, "stdout", "--psm", mode], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim()).filter(Boolean).join("\n");
}

function runTesseractTsv(imagePath: string, pageSegmentationMode = "6"): string {
  const tesseract = process.platform === "win32" ? "tesseract.exe" : "tesseract";
  return execFileSync(tesseract, [imagePath, "stdout", "--psm", pageSegmentationMode, "tsv"], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
}

function ocrTokenMatches(token: string, expected: string): boolean {
  if (token === expected) return true;
  if (Math.abs(token.length - expected.length) > 1) return false;

  let previous = Array.from({length: expected.length + 1}, (_, index) => index);
  for (let tokenIndex = 1; tokenIndex <= token.length; tokenIndex += 1) {
    const current = [tokenIndex];
    for (let expectedIndex = 1; expectedIndex <= expected.length; expectedIndex += 1) {
      current.push(Math.min(
        (current[expectedIndex - 1] ?? 0) + 1,
        (previous[expectedIndex] ?? 0) + 1,
        (previous[expectedIndex - 1] ?? 0) + Number(token[tokenIndex - 1] !== expected[expectedIndex - 1]),
      ));
    }
    previous = current;
  }
  return previous[expected.length] <= 1;
}

function ocrTextContainsPhrase(text: string, phrase: string): boolean {
  const normalizedText = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalizedPhrase = phrase.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalizedText.includes(normalizedPhrase);
}

function canvasFormFieldLabelsVisible(text: string): boolean {
  return ocrTextContainsFuzzyPhrase(text, "Canvas path")
    && ocrTextContainsFuzzyPhrase(text, "Text card ID")
    && ocrTextContainsFuzzyPhrase(text, "New markdown path");
}

function editDistanceWithinLimit(left: string, right: string, limit: number): boolean {
  if (Math.abs(left.length - right.length) > limit) return false;

  let previous = Array.from({length: right.length + 1}, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current.push(Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + Number(left[leftIndex - 1] !== right[rightIndex - 1]),
      ));
    }
    previous = current;
  }
  return (previous[right.length] ?? Number.POSITIVE_INFINITY) <= limit;
}

function ocrTextContainsFuzzyPhrase(text: string, phrase: string, maxEdits = 2): boolean {
  const normalizedPhrase = phrase.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalizedPhrase) return false;
  const minimumLength = Math.max(1, normalizedPhrase.length - maxEdits);
  const maximumLength = normalizedPhrase.length + maxEdits;

  for (const line of text.split(/\r?\n/)) {
    const normalizedLine = line.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (let length = minimumLength; length <= maximumLength; length += 1) {
      for (let start = 0; start + length <= normalizedLine.length; start += 1) {
        if (editDistanceWithinLimit(normalizedLine.slice(start, start + length), normalizedPhrase, maxEdits)) {
          return true;
        }
      }
    }
  }
  return false;
}

function ocrTextContainsFuzzyPhraseAcrossLines(text: string, phrase: string, maxEdits = 1): boolean {
  return ocrTextContainsFuzzyPhrase(text.replace(/\r?\n/g, " "), phrase, maxEdits);
}

function ocrTextContainsRefreshedMarkdownCount(text: string, count: number): boolean {
  const status = "notelistrefreshed";
  const markdownCountLabel = "markdownfilesfound";
  const expectedCount = String(count);
  const statusMinLength = Math.max(1, status.length - 2);
  const statusMaxLength = status.length + 2;
  const labelMinLength = Math.max(1, markdownCountLabel.length - 2);
  const labelMaxLength = markdownCountLabel.length + 2;

  for (const line of text.split(/\r?\n/)) {
    const normalizedLine = line.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (let statusLength = statusMinLength; statusLength <= statusMaxLength; statusLength += 1) {
      for (let statusStart = 0; statusStart + statusLength <= normalizedLine.length; statusStart += 1) {
        const candidateStatus = normalizedLine.slice(statusStart, statusStart + statusLength);
        if (!editDistanceWithinLimit(candidateStatus, status, 2)) continue;

        const afterStatus = normalizedLine.slice(statusStart + statusLength);
        if (!afterStatus.startsWith(expectedCount)) continue;
        const afterCount = afterStatus.slice(expectedCount.length);
        if (/^[0-9]/.test(afterCount)) continue;

        for (
          let labelLength = labelMinLength;
          labelLength <= Math.min(labelMaxLength, afterCount.length);
          labelLength += 1
        ) {
          if (
            editDistanceWithinLimit(afterCount.slice(0, labelLength), markdownCountLabel, 2)
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function windowsSelectionConfirmsPath(action: unknown, expectedPath: string): boolean {
  if (typeof action !== "string") return false;
  try {
    const selection = JSON.parse(action) as {
      action?: unknown;
      control_type?: unknown;
      name?: unknown;
    };
    return selection.name === expectedPath
      && selection.control_type === "ControlType.RadioButton"
      && selection.action === "SelectionItemPattern.Select";
  } catch {
    return false;
  }
}

function windowsSelectorDismissConfirmsClosed(action: unknown): boolean {
  if (typeof action !== "string") return false;
  try {
    const dismissal = JSON.parse(action) as {
      action?: unknown;
      control_type?: unknown;
      name?: unknown;
      target_option_visible_after_dismissal?: unknown;
    };
    return dismissal.name === "Note to inspect"
      && dismissal.control_type === "ControlType.Button"
      && dismissal.action === "WScript.Shell.SendKeys(Escape)"
      && dismissal.target_option_visible_after_dismissal === false;
  } catch {
    return false;
  }
}

async function dismissWindowsNoteSelectorMenu(child: ChildProcess, expectedPath: string): Promise<string> {
  const processId = child.pid;
  if (!processId) throw new Error("OpenObsidian did not expose its process id for Windows note selector dismissal");
  const script = `
    $ErrorActionPreference = "Stop"
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $processId = [int]$env:OPENOBSIDIAN_WINDOW_PROCESS_ID
    $expectedPath = $env:OPENOBSIDIAN_EXPECTED_NOTE_PATH.Replace([string][char]92, "/")
    $shell = New-Object -ComObject WScript.Shell
    if (-not $shell.AppActivate($processId)) { throw "Could not focus OpenObsidian before dismissing the expanded note selector" }
    Start-Sleep -Milliseconds 100
    $shell.SendKeys("{ESC}")
    Start-Sleep -Milliseconds 150
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $condition = [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
      $processId
    )
    $selector = $null
    $targetOptionVisible = $false
    $deadline = [DateTime]::UtcNow.AddSeconds(3)
    do {
      $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
      $targetOptionVisible = $false
      foreach ($element in $elements) {
        try {
          $current = $element.Current
          $normalizedName = $current.Name.Replace([string][char]92, "/")
          if ($current.ControlType.ProgrammaticName -eq "ControlType.Button" -and $current.Name -eq "Note to inspect") {
            $selector = $element
          }
          if ($current.ControlType.ProgrammaticName -eq "ControlType.RadioButton" -and
              $normalizedName -eq $expectedPath -and -not $current.IsOffscreen) {
            $targetOptionVisible = $true
          }
        } catch {}
      }
      if ($targetOptionVisible) {
        Start-Sleep -Milliseconds 100
      }
    } while ($targetOptionVisible -and [DateTime]::UtcNow -lt $deadline)
    if ($null -eq $selector) { throw "UI Automation did not expose the Note to inspect button" }
    if ($targetOptionVisible) { throw "Escape did not dismiss the expanded note selector" }
    [pscustomobject]@{
      name = $selector.Current.Name
      control_type = $selector.Current.ControlType.ProgrammaticName
      action = "WScript.Shell.SendKeys(Escape)"
      target_option_visible_after_dismissal = $targetOptionVisible
    } | ConvertTo-Json -Compress
  `;
  try {
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENOBSIDIAN_WINDOW_PROCESS_ID: String(processId),
        OPENOBSIDIAN_EXPECTED_NOTE_PATH: expectedPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {stderr?: Buffer | string; stdout?: Buffer | string};
    const output = [failure.stdout, failure.stderr].filter(Boolean).map(String).join("\n").trim();
    throw new Error(`Could not dismiss the expanded Windows note selector through its UI Automation button: ${output || failure.message}`);
  }
}

function nativeFolderPickerVisibleInOcr(text: string): boolean {
  const compact = text.toLowerCase().replace(/[^a-z]/g, "");
  if (compact.includes("openanexistingvault") || compact.includes("openexistingvault")) return true;

  const tokens = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const hasCancel = tokens.some((token) => ocrTokenMatches(token, "cancel"));
  const hasPickerAction = ["open", "select", "choose"].some((expected) =>
    tokens.some((token) => ocrTokenMatches(token, expected))
  );
  return hasCancel && hasPickerAction;
}

type VaultDirectoryOptions = {
  targetRoot?: string;
  reporter?: Record<string, unknown>;
  screenshotPrefix?: string;
};

function vaultPickerScreenshotName(prefix: string, filename: string): string {
  return prefix.length > 0 ? `${prefix}-${filename}` : filename;
}

async function clickFirstRunOpenButton(
  connection: DevToolsConnection,
  reporter: Record<string, unknown> = report.obsidian_authoring as Record<string, unknown>,
): Promise<void> {
  const visible = await connection.evaluateJson<{matched: boolean; buttons: string[]}>(`(() => {
    const buttons = [...document.querySelectorAll('button,[role="button"]')];
    const summary = buttons.map((button) => (button.innerText || button.textContent || '').trim()).filter(Boolean);
    const target = buttons.find((button) => (button.innerText || button.textContent || '').trim() === 'Open');
    return {matched:Boolean(target),buttons:summary};
  })()`);
  reporter.first_run_buttons = visible.buttons;
  if (!visible.matched) throw new Error(`Could not find Obsidian's exact Open button; visible button labels=${visible.buttons.join(" | ")}`);
  // Electron's native folder picker blocks the renderer thread while it is open, so
  // dispatch the click without waiting for Runtime.evaluate's response.
  connection.send("Runtime.evaluate", {
    expression: `(() => [...document.querySelectorAll('button,[role="button"]')]
      .find((button) => (button.innerText || button.textContent || '').trim() === 'Open')?.click())()`,
    returnByValue: true,
  });
}

async function finishVaultDirectorySelection(
  connection: DevToolsConnection,
  port: number,
  pickerEvidence: Record<string, unknown>,
  options: VaultDirectoryOptions = {},
): Promise<DevToolsConnection> {
  const targetRoot = options.targetRoot ?? vaultRoot;
  const reporter = options.reporter ?? report.obsidian_authoring as Record<string, unknown>;
  const targetVaultName = basename(targetRoot);
  const vaultTarget = await waitForPageTarget(
    port,
    (candidate) => typeof candidate.url === "string" && candidate.url.startsWith("app://obsidian.md/") && !candidate.url.includes("/starter.html"),
    "Obsidian vault renderer after folder selection",
  );
  const pageTargets = await readPageTargets(port);
  reporter.folder_picker = {
    ...pickerEvidence,
    page_targets_after_folder_selection: pageTargets.map(({id, title, url, type}) => ({id, title, url, type})),
    vault_renderer_target: {id: vaultTarget.id ?? null, title: vaultTarget.title ?? "", url: vaultTarget.url ?? ""},
  };
  connection.close();
  connection = await connectTarget(vaultTarget);

  const isVaultLoaded = (body: string) => body.includes(targetVaultName) && !body.includes("Open folder as vault") && !body.includes("Create new vault");
  const body = await waitForRenderer(connection, "document.body?.innerText ?? ''", isVaultLoaded, `Obsidian to open the selected ${targetVaultName} folder`, 45_000);
  reporter.selected_vault_text = body.slice(0, 2_000);
  reporter.selected_vault_in_ui = true;
  return connection;
}

async function chooseVaultDirectoryLinux(connection: DevToolsConnection, port: number, options: VaultDirectoryOptions = {}): Promise<DevToolsConnection> {
  const targetRoot = options.targetRoot ?? vaultRoot;
  const reporter = options.reporter ?? report.obsidian_authoring as Record<string, unknown>;
  const screenshotPrefix = options.screenshotPrefix ?? "";
  const initialWindowId = activeWindowId();
  const initialTitle = activeWindowTitle();
  await clickFirstRunOpenButton(connection, reporter);
  const pickerWindow = await waitFor("Obsidian folder picker", async () => {
    await delay(250);
    return {windowId: activeWindowId(), title: activeWindowTitle()};
  }, (value) => value.windowId.length > 0 && value.windowId !== initialWindowId, 20_000).catch(() => ({windowId: activeWindowId(), title: activeWindowTitle()}));
  reporter.folder_picker = {
    initial_window_id: initialWindowId,
    initial_window_title: initialTitle,
    picker_window_id: pickerWindow.windowId,
    picker_window_title: pickerWindow.title,
  };
  const pickerScreenshots = [await captureDesktopScreenshot(vaultPickerScreenshotName(screenshotPrefix, "obsidian-folder-picker-initial.png"))];

  xdotool("key", "ctrl+l");
  xdotool("type", "--clearmodifiers", "--delay", "2", targetRoot);
  pickerScreenshots.push(await captureDesktopScreenshot(vaultPickerScreenshotName(screenshotPrefix, "obsidian-folder-picker-path-entered.png")));
  const pickerStillActive = () => activeWindowId() === pickerWindow.windowId;
  const openButtonClick = clickWindowOpenButton(pickerWindow.windowId);
  await delay(1_000);
  pickerScreenshots.push(await captureDesktopScreenshot(vaultPickerScreenshotName(screenshotPrefix, "obsidian-folder-picker-after-open-click.png")));
  if (pickerStillActive()) {
    xdotool("key", "Return");
    await delay(1_000);
  }
  if (pickerStillActive()) {
    xdotool("key", "alt+o");
    await delay(1_000);
  }
  if (pickerStillActive()) {
    xdotool("key", "Return");
    await delay(1_000);
  }
  if (pickerStillActive()) {
    await waitFor("Obsidian folder picker to close", async () => activeWindowId(), (windowId) => windowId !== pickerWindow.windowId, 15_000);
  }
  reporter.folder_picker_closed = true;

  return await finishVaultDirectorySelection(connection, port, {
    initial_window_id: initialWindowId,
    initial_window_title: initialTitle,
    picker_window_id: pickerWindow.windowId,
    picker_window_title: pickerWindow.title,
    open_button_click: openButtonClick,
    picker_screenshots: pickerScreenshots.map((path) => relative(reportDirectory, path)),
    picker_closed: true,
  }, options);
}

async function chooseVaultDirectoryMacOS(connection: DevToolsConnection, port: number, options: VaultDirectoryOptions = {}): Promise<DevToolsConnection> {
  const targetRoot = options.targetRoot ?? vaultRoot;
  const reporter = options.reporter ?? report.obsidian_authoring as Record<string, unknown>;
  const screenshotPrefix = options.screenshotPrefix ?? "";
  await clickFirstRunOpenButton(connection, reporter);
  await delay(1_000);
  const pickerScreenshots = [await captureDesktopScreenshot(vaultPickerScreenshotName(screenshotPrefix, "obsidian-folder-picker-initial.png"))];
  const script = `on run argv
    tell application "System Events"
      keystroke "g" using {command down, shift down}
      delay 0.5
      keystroke (item 1 of argv)
      delay 0.5
      key code 36
      delay 1
      key code 36
    end tell
  end run`;
  execFileSync("osascript", ["-e", script, targetRoot], {stdio: "ignore"});
  await delay(1_000);
  pickerScreenshots.push(await captureDesktopScreenshot(vaultPickerScreenshotName(screenshotPrefix, "obsidian-folder-picker-after-path.png")));
  return await finishVaultDirectorySelection(connection, port, {
    interaction: "macOS Open panel: Go to Folder (Command-Shift-G), enter the fixture path, and confirm folder selection",
    picker_screenshots: pickerScreenshots.map((path) => relative(reportDirectory, path)),
  }, options);
}

async function chooseVaultDirectoryWindows(connection: DevToolsConnection, port: number, options: VaultDirectoryOptions = {}): Promise<DevToolsConnection> {
  const targetRoot = options.targetRoot ?? vaultRoot;
  const reporter = options.reporter ?? report.obsidian_authoring as Record<string, unknown>;
  const screenshotPrefix = options.screenshotPrefix ?? "";
  await clickFirstRunOpenButton(connection, reporter);
  await delay(1_000);
  const pickerScreenshots = [await captureDesktopScreenshot(vaultPickerScreenshotName(screenshotPrefix, "obsidian-folder-picker-initial.png"))];
  const script = `
    $ErrorActionPreference = "Stop"
    $shell = New-Object -ComObject WScript.Shell
    Start-Sleep -Milliseconds 500
    $shell.SendKeys("^l")
    Start-Sleep -Milliseconds 300
    $shell.SendKeys($env:OBSIDIAN_PICKER_VAULT_PATH)
    Start-Sleep -Milliseconds 300
    $shell.SendKeys("{ENTER}")
  `;
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    env: {...process.env, OBSIDIAN_PICKER_VAULT_PATH: targetRoot},
    stdio: "ignore",
  });
  await delay(750);
  pickerScreenshots.push(await captureDesktopScreenshot(vaultPickerScreenshotName(screenshotPrefix, "obsidian-folder-picker-after-path.png")));
  const selectionScript = `
    $ErrorActionPreference = "Stop"
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $pickerCondition = [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      "Open folder as vault"
    )
    $picker = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $pickerCondition)
    if ($null -eq $picker) {
      $topLevel = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
      $names = @($topLevel | ForEach-Object { $_.Current.Name }) -join " | "
      throw "Could not find the Obsidian folder picker window; top-level windows=$names"
    }
    $buttonCondition = [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Button
    )
    $buttons = $picker.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
    $selectFolderNameCondition = [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      "Select Folder"
    )
    $selectFolderCondition = [System.Windows.Automation.AndCondition]::new($buttonCondition, $selectFolderNameCondition)
    $selectFolder = $picker.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $selectFolderCondition)
    if ($null -eq $selectFolder) {
      $selectFolder = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $selectFolderCondition)
    }
    if ($null -eq $selectFolder) {
      $labels = @($buttons | ForEach-Object { $_.Current.Name }) -join " | "
      $shell = New-Object -ComObject WScript.Shell
      $activated = $shell.AppActivate($picker.Current.Name)
      Start-Sleep -Milliseconds 250
      $shell.SendKeys("{ENTER}")
      Write-Output "Select Folder was absent from the picker and desktop UIA trees; AppActivate=$activated for $($picker.Current.Name), then pressed Enter. Picker buttons=$labels"
    } else {
      try {
        $selectFolder.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        Write-Output "Invoked native button: $($selectFolder.Current.Name)"
      } catch {
        $selectFolder.SetFocus()
        $shell = New-Object -ComObject WScript.Shell
        $shell.SendKeys("{ENTER}")
        Write-Output "Focused and pressed Enter on $($selectFolder.Current.Name); InvokePattern failed: $($_.Exception.Message)"
      }
    }
  `;
  let selectionResult: string;
  try {
    selectionResult = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", selectionScript], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {stderr?: Buffer | string; stdout?: Buffer | string};
    const output = [failure.stdout, failure.stderr].filter(Boolean).map(String).join("\n").trim();
    throw new Error(`Windows native folder selection failed: ${output || failure.message}`);
  }
  await delay(1_000);
  pickerScreenshots.push(await captureDesktopScreenshot(vaultPickerScreenshotName(screenshotPrefix, "obsidian-folder-picker-after-select.png")));
  return await finishVaultDirectorySelection(connection, port, {
    interaction: "Windows folder picker: navigate to the fixture path and invoke Select Folder through UI Automation, with focused Enter fallback",
    selection_result: selectionResult,
    picker_screenshots: pickerScreenshots.map((path) => relative(reportDirectory, path)),
  }, options);
}

async function chooseVaultDirectory(connection: DevToolsConnection, port: number, options: VaultDirectoryOptions = {}): Promise<DevToolsConnection> {
  if (process.platform === "linux") return await chooseVaultDirectoryLinux(connection, port, options);
  if (process.platform === "darwin") return await chooseVaultDirectoryMacOS(connection, port, options);
  if (process.platform === "win32") return await chooseVaultDirectoryWindows(connection, port, options);
  throw new Error(`Unsupported Obsidian folder picker platform ${process.platform}`);
}

async function chooseRestrictedMode(
  connection: DevToolsConnection,
  reporter: Record<string, unknown> = report.obsidian_authoring as Record<string, unknown>,
  vaultName = "C01.2 Roundtrip Fixture",
  expectedEditorText = noteMarker,
): Promise<void> {
  const readTrustState = async () => await connection.evaluateJson<{body: string; buttons: string[]; editor: string}>(`(() => {
    const buttons = [...document.querySelectorAll('button,[role="button"]')];
    return {
      body: document.body?.innerText ?? '',
      buttons: buttons.map((button) => (button.innerText || button.textContent || '').trim()).filter(Boolean),
      editor: [...document.querySelectorAll('[contenteditable="true"]')].map((element) => element.innerText ?? '').join('\\n'),
    };
  })()`);
  const state = await waitFor(
    "the reopened fixture vault trust decision",
    readTrustState,
    (value) => value.buttons.includes("Browse vault in Restricted Mode")
      || (!value.body.includes("Do you trust the author of this vault?")
        && (value.editor.includes(expectedEditorText) || value.body.includes(vaultName))),
    30_000,
  );
  const restrictedModeLabel = "Browse vault in Restricted Mode";
  reporter.trust_prompt_buttons = state.buttons;
  if (!state.buttons.includes(restrictedModeLabel)) {
    if (state.body.includes("Do you trust the author of this vault?")) {
      throw new Error("Obsidian displayed the vault trust prompt without its Restricted Mode button");
    }
    reporter.restricted_mode_selected = false;
    return;
  }

  connection.send("Runtime.evaluate", {
    expression: `(() => [...document.querySelectorAll('button,[role="button"]')]
      .find((button) => (button.innerText || button.textContent || '').trim() === '${restrictedModeLabel}')?.click())()`,
    returnByValue: true,
  });
  const body = await waitForRenderer(connection, "document.body?.innerText ?? ''", (value) => !value.includes("Do you trust the author of this vault?") && value.includes(vaultName), `Obsidian to browse ${vaultName} in Restricted Mode`, 30_000);
  reporter.restricted_mode_selected = true;
  reporter.restricted_mode_text = body.slice(0, 2_000);
}

function readCanvasReferenceFixtureBytes(): Buffer {
  const document = {
    nodes: [
      {
        id: "text-1",
        type: "text",
        x: 10,
        y: 20,
        width: 320,
        height: 140,
        text: canvasMarker,
        color: "1",
      },
      {
        id: "file-1",
        type: "file",
        x: 370,
        y: 20,
        width: 240,
        height: 150,
        file: canvasTargetPath,
        subpath: "#^block-id",
        color: "2",
      },
      {
        id: "group-1",
        type: "group",
        x: 10,
        y: 220,
        width: 620,
        height: 260,
        label: "Reference group",
        children: ["text-1", "file-1"],
        background: "Assets/group-background.png",
        backgroundStyle: "cover",
      },
    ],
    edges: [],
  };
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
}

async function createCanvasReferenceFixture(): Promise<{bytes: number; sha256: string}> {
  await mkdir(join(canvasVaultRoot, "Notes"), {recursive: true});
  await mkdir(join(canvasVaultRoot, "Assets"), {recursive: true});
  await mkdir(join(canvasVaultRoot, ".obsidian"), {recursive: true});
  await mkdir(join(canvasVaultRoot, ".obsidian", "plugins"), {recursive: true});
  await mkdir(join(canvasVaultRoot, ".obsidian", "themes"), {recursive: true});
  const canvasBytes = readCanvasReferenceFixtureBytes();
  const files: Record<string, Buffer> = {
    [canvasPath]: canvasBytes,
    [canvasTargetPath]: canvasTargetMarkdownBytes,
    "Assets/group-background.png": await readFile(resolve("assets/openobsidian-icon.png")),
    ".obsidian/app.json": await readFile(join(vaultRoot, ".obsidian", "app.json")),
    ".obsidian/appearance.json": await readFile(join(vaultRoot, ".obsidian", "appearance.json")),
    ".obsidian/community-plugins.json": await readFile(join(vaultRoot, ".obsidian", "community-plugins.json")),
    ".obsidian/core-plugins.json": await readFile(join(vaultRoot, ".obsidian", "core-plugins.json")),
  };
  for (const [path, bytes] of Object.entries(files)) await writeFile(join(canvasVaultRoot, path), bytes);
  const canvasHash = createHash("sha256").update(canvasBytes).digest("hex");
  await writeFile(join(reportDirectory, "canvas-reference-seed.canvas"), canvasBytes);
  const canvasReport = report.canvas_reference_reopen as Record<string, unknown>;
  canvasReport.vault_name = canvasVaultName;
  canvasReport.vault_path = "$RUNNER_TEMP/openobsidian-c01-roundtrip/C06 Canvas Reference Fixture";
  canvasReport.fixture_profile = "Reference-compatible known-field Canvas document; the Rust codec's unknown-field fixture remains in fixtures/c06-canvas.json and is not opened by Obsidian.";
  canvasReport.path = canvasPath;
  canvasReport.marker = canvasMarker;
  canvasReport.target_path = canvasTargetPath;
  canvasReport.target_subpath = "#^block-id";
  canvasReport.seeded_files = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }]));
  canvasReport.source_before_first_open = {bytes: canvasBytes.length, sha256: canvasHash};
  return {bytes: canvasBytes.length, sha256: canvasHash};
}

function basesDirectionDefinition(direction: string): Buffer {
  const label = direction === omittedBasesDirection ? "omitted" : direction;
  const directionLine = direction === omittedBasesDirection ? "" : `      direction: ${direction}\n`;
  const viewName = `C07 group direction ${label}`;
  return Buffer.from(
    `views:\n  - type: table\n    name: ${viewName}\n    groupBy:\n      property: team\n${directionLine}`,
    "utf8",
  );
}

async function createBasesDirectionFixture(): Promise<Record<string, {bytes: number; sha256: string}>> {
  await mkdir(join(basesVaultRoot, "Notes"), {recursive: true});
  await mkdir(join(basesVaultRoot, ".obsidian"), {recursive: true});
  await mkdir(join(basesVaultRoot, ".obsidian", "plugins"), {recursive: true});
  await mkdir(join(basesVaultRoot, ".obsidian", "themes"), {recursive: true});
  const files: Record<string, Buffer> = {
    "Ascending.base": basesDirectionDefinition("ASC"),
    "Descending.base": basesDirectionDefinition("DESC"),
    "Omitted Direction.base": basesDirectionDefinition(omittedBasesDirection),
    "Invalid Direction.base": basesDirectionDefinition(invalidBasesDirection),
    "Notes/01-zulu-first.md": Buffer.from("---\nteam: Zulu\n---\n\nSynthetic C07 first Zulu row.\n", "utf8"),
    "Notes/02-alpha-first.md": Buffer.from("---\nteam: Alpha\n---\n\nSynthetic C07 first Alpha row.\n", "utf8"),
    "Notes/03-bravo-first.md": Buffer.from("---\nteam: Bravo\n---\n\nSynthetic C07 first Bravo row.\n", "utf8"),
    "Notes/04-zulu-second.md": Buffer.from("---\nteam: Zulu\n---\n\nSynthetic C07 second Zulu row.\n", "utf8"),
    "Notes/05-alpha-second.md": Buffer.from("---\nteam: Alpha\n---\n\nSynthetic C07 second Alpha row.\n", "utf8"),
    "Notes/06-bravo-second.md": Buffer.from("---\nteam: Bravo\n---\n\nSynthetic C07 second Bravo row.\n", "utf8"),
    ".obsidian/app.json": await readFile(join(vaultRoot, ".obsidian", "app.json")),
    ".obsidian/appearance.json": await readFile(join(vaultRoot, ".obsidian", "appearance.json")),
    ".obsidian/community-plugins.json": await readFile(join(vaultRoot, ".obsidian", "community-plugins.json")),
    ".obsidian/core-plugins.json": await readFile(join(vaultRoot, ".obsidian", "core-plugins.json")),
  };
  for (const [path, bytes] of Object.entries(files)) {
    const destination = join(basesVaultRoot, path);
    await mkdir(dirname(destination), {recursive: true});
    await writeFile(destination, bytes);
  }

  const sourceHashes = Object.fromEntries(Object.entries(files)
    .filter(([path]) => path.endsWith(".base") || path.endsWith(".md"))
    .map(([path, bytes]) => [path, {
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }]));
  const basesReport = report.bases_group_direction_reference as Record<string, unknown>;
  basesReport.vault_name = basesVaultName;
  basesReport.vault_path = "$RUNNER_TEMP/openobsidian-c01-roundtrip/C07 Bases Direction Reference Fixture";
  basesReport.source_hashes_before_open = sourceHashes;
  basesReport.note_order_by_path = [
    {path: "Notes/01-zulu-first.md", group: "Zulu"},
    {path: "Notes/02-alpha-first.md", group: "Alpha"},
    {path: "Notes/03-bravo-first.md", group: "Bravo"},
    {path: "Notes/04-zulu-second.md", group: "Zulu"},
    {path: "Notes/05-alpha-second.md", group: "Alpha"},
    {path: "Notes/06-bravo-second.md", group: "Bravo"},
  ];
  basesReport.fixture_paths_to_observe = basesDirectionFixturePaths;
  basesReport.reference_app_asset_sha256 = obsidianSha256;
  for (const [path, bytes] of Object.entries(files)) {
    await writeFile(join(reportDirectory, `bases-direction-${basename(path).replaceAll(".", "-")}.seed`), bytes);
  }
  return sourceHashes;
}

async function assertBasesDirectionSourceHashes(
  expected: Record<string, {bytes: number; sha256: string}>,
  stage: string,
  allowKnownReferenceRewrite = false,
  capturedBytes?: Record<string, Buffer>,
  unexpectedMismatches?: string[],
): Promise<Record<string, {bytes: number; sha256: string}>> {
  const observed: Record<string, {bytes: number; sha256: string}> = {};
  for (const [path, baseline] of Object.entries(expected)) {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(basesVaultRoot, path));
    } catch (error) {
      const basesReport = report.bases_group_direction_reference as Record<string, unknown>;
      basesReport.reference_app_source_preservation_passed = false;
      const message = `Could not read C07 source ${path} ${stage}: ${error instanceof Error ? error.message : String(error)}`;
      if (unexpectedMismatches) {
        unexpectedMismatches.push(message);
        continue;
      }
      throw new Error(message);
    }
    if (capturedBytes) capturedBytes[path] = bytes;
    const actual = {
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    observed[path] = actual;
    if (actual.bytes !== baseline.bytes || actual.sha256 !== baseline.sha256) {
      const artifactPath = `bases-direction-source-changed-${stage.replaceAll(/[^a-z0-9-]/gi, "-")}-${basename(path)}`;
      await writeFile(join(reportDirectory, artifactPath), bytes);
      const isKnownReferenceRewrite = allowKnownReferenceRewrite
        && path === "Invalid Direction.base"
        && actual.bytes === normalizedInvalidBasesDirection.length
        && actual.sha256 === normalizedInvalidBasesDirectionSha256
        && bytes.equals(normalizedInvalidBasesDirection);
      if (isKnownReferenceRewrite) continue;
      const basesReport = report.bases_group_direction_reference as Record<string, unknown>;
      basesReport.reference_app_source_preservation_passed = false;
      const mismatch = `Obsidian changed C07 source ${path} ${stage}: expected ${baseline.bytes} bytes / ${baseline.sha256}, got ${actual.bytes} bytes / ${actual.sha256}`;
      if (unexpectedMismatches) {
        unexpectedMismatches.push(mismatch);
        continue;
      }
      throw new Error(mismatch);
    }
  }
  return observed;
}

async function recordBasesDirectionReferenceRewrite(
  expected: Record<string, {bytes: number; sha256: string}>,
  observed: Record<string, {bytes: number; sha256: string}>,
  bytes: Buffer,
  session: "first_open" | "reopen",
  stage: string,
): Promise<boolean> {
  const path = "Invalid Direction.base";
  const baseline = expected[path];
  const actual = observed[path];
  if (actual.bytes === baseline.bytes && actual.sha256 === baseline.sha256) return false;

  if (actual.bytes !== normalizedInvalidBasesDirection.length
    || actual.sha256 !== normalizedInvalidBasesDirectionSha256
    || bytes.length !== actual.bytes
    || createHash("sha256").update(bytes).digest("hex") !== actual.sha256
    || !bytes.equals(normalizedInvalidBasesDirection)) {
    throw new Error(`Pinned Obsidian C07 reference mutation did not match the recorded normalization at ${stage}`);
  }
  const artifactPath = `bases-direction-source-changed-${stage.replaceAll(/[^a-z0-9-]/gi, "-")}-${basename(path)}`;
  const basesReport = report.bases_group_direction_reference as Record<string, unknown>;
  const observations = (basesReport.source_rewrite_observations ?? []) as Array<Record<string, unknown>>;
  const priorObservation = observations.find((item) => {
    const after = item.after as {bytes?: number; sha256?: string} | undefined;
    return item.session === session && item.path === path && after?.sha256 === actual.sha256;
  });
  if (priorObservation) {
    const checkpoints = (priorObservation.checkpoints ?? [priorObservation.first_observed_stage ?? priorObservation.stage]) as string[];
    if (!checkpoints.includes(stage)) checkpoints.push(stage);
    priorObservation.checkpoints = checkpoints;
    await saveReport();
    return true;
  }
  const observation = {
    session,
    first_observed_stage: stage,
    checkpoints: [stage],
    path,
    source_preserved: false,
    before: baseline,
    after: actual,
    exact_bytes: bytes.toString("utf8"),
    artifact: artifactPath,
  };
  observations.push(observation);
  basesReport.source_rewrite_observations = observations;
  basesReport.reference_app_source_preservation_passed = false;
  if (basesReport.source_rewrite_first_detected_at === undefined) {
    basesReport.source_rewrite_first_detected_at = {session, stage, path};
  }
  await saveReport();
  return true;
}

async function createFixture(): Promise<void> {
  await mkdir(join(vaultRoot, "Nested Ω"), {recursive: true});
  await mkdir(join(vaultRoot, "Assets"), {recursive: true});
  await mkdir(join(vaultRoot, ".opaque"), {recursive: true});
  await mkdir(join(vaultRoot, ".obsidian", "themes", "CI Minimal"), {recursive: true});
  await mkdir(join(vaultRoot, ".obsidian", "plugins", "disabled-fixture"), {recursive: true});

  const files: Record<string, Buffer> = {
    [seedMarkdownPath]: Buffer.from(seedMarkdown, "utf8"),
    "Assets/roundtrip image.png": await readFile(resolve("assets/openobsidian-icon.png")),
    ".opaque/unknown.bin": Buffer.from([0x00, 0x7f, 0xff, 0x4f, 0x4f, 0x42, 0x01, 0x02, 0x00, 0x10]),
    ".obsidian/app.json": Buffer.from('{"newFileLocation":"root","defaultViewMode":"source","unknown_roundtrip_setting":{"keep":[true,7,"opaque"]}}\n'),
    ".obsidian/appearance.json": Buffer.from('{"accentColor":"#8b5cf6","unknownAppearanceSetting":"preserve-me"}\n'),
    ".obsidian/community-plugins.json": Buffer.from("[]\n"),
    ".obsidian/themes/CI Minimal/manifest.json": Buffer.from('{"name":"CI Minimal","version":"1.0.0","minAppVersion":"1.0.0","author":"OpenObsidian CI fixture","authorUrl":"","description":"Synthetic, disabled round-trip fixture theme."}\n'),
    ".obsidian/themes/CI Minimal/theme.css": Buffer.from(".theme-dark { --background-primary: #171717; }\n"),
    ".obsidian/plugins/disabled-fixture/manifest.json": Buffer.from('{"id":"disabled-fixture","name":"Disabled fixture data","version":"1.0.0","minAppVersion":"1.0.0","description":"Synthetic disabled fixture; never enabled or executed."}\n'),
    ".obsidian/plugins/disabled-fixture/data.json": Buffer.from('{"unknown_plugin_value":{"keep":"opaque"}}\n'),
    ".obsidian/plugins/disabled-fixture/main.js": Buffer.from("// Deliberately disabled; fixture data only.\n"),
  };
  for (const [path, bytes] of Object.entries(files)) await writeFile(join(vaultRoot, path), bytes);
  const hashes = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }]));
  (report.fixture as Record<string, unknown>).content_hashes = hashes;
  (report.fixture as Record<string, unknown>).provenance = {
    authored_by: "GitHub Actions fixture generator plus pinned Obsidian Desktop UI",
    generator_source_sha: sourceSha,
    reference_app_version: obsidianVersion,
    reference_asset: obsidianAsset,
    reference_asset_sha256: obsidianSha256,
    ...(process.platform === "linux" ? {reference_appimage_sha256: obsidianSha256} : {}),
    source_platform: obsidianSourcePlatform,
    contains_personal_data: false,
    execution_policy: "No local application launch or local validation was used.",
  };
}

async function snapshotTree(root: string): Promise<SnapshotEntry[]> {
  const entries: SnapshotEntry[] = [];
  async function visit(directory: string): Promise<void> {
    const children = await readdir(directory, {withFileTypes: true});
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const child of children) {
      const absolutePath = join(directory, child.name);
      const relativePath = relative(root, absolutePath).split(sep).join("/");
      const metadata = await lstat(absolutePath);
      if (child.isSymbolicLink()) {
        entries.push({path: relativePath, kind: "symlink", target: await readlink(absolutePath)});
      } else if (child.isDirectory()) {
        entries.push({path: relativePath, kind: "directory"});
        await visit(absolutePath);
      } else if (child.isFile()) {
        const bytes = await readFile(absolutePath);
        entries.push({
          path: relativePath,
          kind: "file",
          bytes: metadata.size,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      } else {
        entries.push({path: relativePath, kind: "other"});
      }
    }
  }
  await visit(root);
  entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  return entries;
}

async function readSnapshotTextFiles(root: string, snapshot: SnapshotEntry[], matchesPath: (path: string) => boolean): Promise<Array<{path: string; bytes: number; sha256: string; content: string}>> {
  const files = snapshot.filter((entry) => entry.kind === "file" && matchesPath(entry.path));
  return await Promise.all(files.map(async (entry) => ({
    path: entry.path,
    bytes: entry.bytes ?? 0,
    sha256: entry.sha256 ?? "",
    content: await readFile(join(root, entry.path), "utf8"),
  })));
}

function changedPaths(before: SnapshotEntry[], after: SnapshotEntry[]): Array<{path: string; before?: SnapshotEntry; after?: SnapshotEntry}> {
  const oldByPath = new Map(before.map((entry) => [entry.path, entry]));
  const newByPath = new Map(after.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...oldByPath.keys(), ...newByPath.keys()])].sort((left, right) => left.localeCompare(right, "en"));
  return paths.flatMap((path) => {
    const oldEntry = oldByPath.get(path);
    const newEntry = newByPath.get(path);
    return JSON.stringify(oldEntry) === JSON.stringify(newEntry) ? [] : [{path, before: oldEntry, after: newEntry}];
  });
}

function ensureExactSnapshot(before: SnapshotEntry[], after: SnapshotEntry[], label: string): void {
  const changes = changedPaths(before, after);
  if (changes.length > 0) throw new Error(`${label} changed ${changes.length} vault path(s): ${JSON.stringify(changes).slice(0, 6_000)}`);
}

function countMarkdownFiles(snapshot: SnapshotEntry[]): number {
  return snapshot.filter((entry) => entry.kind === "file" && entry.path.toLowerCase().endsWith(".md")).length;
}

function ensureAppDataChangesAreMacEframeUiStateOnly(
  changes: Array<{path: string; before?: SnapshotEntry; after?: SnapshotEntry}>,
  eframeFiles: Array<{path: string; bytes: number; sha256: string; content: string}>,
  label: string,
  forbiddenPaths: string[],
): void {
  const unexpected = changes.filter((change) => (
    process.platform !== "darwin"
    || change.path !== "app.ron"
    || change.after?.kind !== "file"
  ));
  if (unexpected.length > 0) {
    throw new Error(label + " changed app-data paths outside macOS eframe UI state: " + JSON.stringify(unexpected).slice(0, 6_000));
  }

  const appRon = eframeFiles.find((file) => file.path === "app.ron");
  if (changes.some((change) => change.path === "app.ron") && !appRon) {
    throw new Error(label + " changed app.ron but the resulting eframe state file could not be read");
  }
  if (process.platform === "darwin" && appRon) {
    if (!/(?:^|[\s({,\[])"?window"?\s*:/.test(appRon.content) || !/(?:^|[\s({,\[])"?egui"?\s*:/.test(appRon.content)) {
      throw new Error(label + " app.ron did not contain the expected eframe window and egui state");
    }
    if (forbiddenPaths.some((path) => path.length > 0 && appRon.content.includes(path))) {
      throw new Error(label + " app.ron contains a vault or app-data path");
    }
  }
}

async function validateCanvasNoteCreationAppDataTransaction(
  before: SnapshotEntry[],
  after: SnapshotEntry[],
  changes: Array<{path: string; before?: SnapshotEntry; after?: SnapshotEntry}>,
  appDataRoot: string,
  canonicalAppDataRoot: string,
  canvasVaultRoot: string,
  notePath: string,
  noteBytes: Buffer,
  noteSha256: string,
): Promise<{vault_data_id: string; operation_id: string; journal_rows: number; recovery_bytes: number}> {
  if (createHash("sha256").update(noteBytes).digest("hex") !== noteSha256) {
    throw new Error("Canvas note creation expected bytes do not match their reported revision");
  }
  const vaultDataId = createHash("sha256").update(resolve(canvasVaultRoot)).digest("hex").slice(0, 24);
  const vaultDataPrefix = `vaults/${vaultDataId}`;
  const markerPath = `${vaultDataPrefix}/.openobsidian-vault-data`;
  const beforeMarker = before.find((entry) => entry.path === markerPath);
  const afterMarker = after.find((entry) => entry.path === markerPath);
  if (beforeMarker?.kind !== "file" || JSON.stringify(beforeMarker) !== JSON.stringify(afterMarker)) {
    throw new Error(`Canvas note creation changed or lacked its selected-vault app-data marker: ${markerPath}`);
  }
  const markerBytes = await readFile(join(appDataRoot, markerPath));
  if (!markerBytes.equals(Buffer.from("openobsidian-vault-data-v1\n", "utf8"))) {
    throw new Error(`Canvas note creation found an unexpected selected-vault app-data marker at ${markerPath}`);
  }

  const eframeChanges = changes.filter((change) => change.path === "app.ron");
  const eframeFilesAfter = await readSnapshotTextFiles(
    appDataRoot,
    after,
    (path) => path.toLowerCase().endsWith(".ron"),
  );
  ensureAppDataChangesAreMacEframeUiStateOnly(
    eframeChanges,
    eframeFilesAfter,
    "OpenObsidian app data after explicit Canvas note creation",
    [canvasVaultRoot, resolve(canvasVaultRoot), appDataRoot, canonicalAppDataRoot],
  );

  const journalPath = `${vaultDataPrefix}/journal.jsonl`;
  const recoveryDirectoryPath = `${vaultDataPrefix}/recovery`;
  if (before.some((entry) => entry.path === journalPath || entry.path === recoveryDirectoryPath)) {
    throw new Error("Canvas note creation app-data baseline already contains a journal or recovery directory for the selected vault");
  }
  const outOfScope = changes.filter((change) => (
    change.path !== "app.ron" && change.path !== vaultDataPrefix && !change.path.startsWith(`${vaultDataPrefix}/`)
  ));
  if (outOfScope.length > 0) {
    throw new Error(`Canvas note creation changed app-data paths outside the selected vault transaction: ${JSON.stringify(outOfScope).slice(0, 6_000)}`);
  }

  const journalBytes = await readFile(join(appDataRoot, journalPath));
  const journalEntry = after.find((entry) => entry.path === journalPath);
  if (journalEntry?.kind !== "file"
    || journalEntry.bytes !== journalBytes.length
    || journalEntry.sha256 !== createHash("sha256").update(journalBytes).digest("hex")) {
    throw new Error("Canvas note creation journal bytes do not match its app-data snapshot");
  }
  const journalText = journalBytes.toString("utf8");
  if (!journalText.endsWith("\n")) throw new Error("Canvas note creation journal is missing its final record delimiter");
  const journalRecordsText = journalText.replace(/\r?\n$/, "");
  const journalLines = journalRecordsText.split(/\r?\n/);
  if (journalLines.length !== 2 || journalLines.some((line) => line.trim().length === 0)) {
    throw new Error(`Canvas note creation journal must contain exactly two non-empty records: ${journalText.slice(0, 2_000)}`);
  }
  const journalRows = journalLines.map((line) => JSON.parse(line) as Record<string, unknown>);
  const expectedJournalKeys = ["error", "expected_revision", "id", "next_revision", "operation", "recorded_at", "relative_path", "state"].sort();
  if (journalRows.length !== 2 || journalRows.some((row) => (
    JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(expectedJournalKeys)
  ))) {
    throw new Error(`Canvas note creation journal must contain exactly two complete create records: ${journalText.slice(0, 2_000)}`);
  }
  const [prepared, committed] = journalRows;
  if (!prepared || !committed) throw new Error("Canvas note creation journal is missing a prepared or committed record");
  const operationId = typeof prepared?.id === "string" ? prepared.id : "";
  const validTimestamp = (value: unknown): value is string => (
    typeof value === "string" && /^\d{10,}$/.test(value) && Number.isSafeInteger(Number(value))
  );
  if (!/^\d+-\d+-\d+$/.test(operationId)
    || committed?.id !== operationId
    || prepared?.operation !== "create"
    || committed?.operation !== "create"
    || prepared?.state !== "prepared"
    || committed?.state !== "committed"
    || prepared?.relative_path !== notePath
    || committed?.relative_path !== notePath
    || prepared?.expected_revision !== null
    || committed?.expected_revision !== null
    || prepared?.next_revision !== noteSha256
    || committed?.next_revision !== noteSha256
    || prepared?.error !== null
    || committed?.error !== null
    || !validTimestamp(prepared?.recorded_at)
    || !validTimestamp(committed?.recorded_at)
    || Number(committed.recorded_at) < Number(prepared.recorded_at)) {
    throw new Error(`Canvas note creation journal records did not match the confirmed destination and bytes: ${journalText.slice(0, 2_000)}`);
  }

  const incomingName = `${operationId}-incoming`;
  const recoveryBytesPath = `${recoveryDirectoryPath}/${incomingName}.bin`;
  const recoveryManifestPath = `${recoveryDirectoryPath}/${incomingName}.json`;
  const expectedTransactionPaths = new Set([journalPath, recoveryDirectoryPath, recoveryBytesPath, recoveryManifestPath]);
  const transactionChanges = changes.filter((change) => change.path !== "app.ron");
  if (transactionChanges.length !== expectedTransactionPaths.size
    || transactionChanges.some((change) => !expectedTransactionPaths.has(change.path) || change.before !== undefined)) {
    throw new Error(`Canvas note creation app data contained an unexpected selected-vault delta: ${JSON.stringify(transactionChanges).slice(0, 6_000)}`);
  }
  const recoveryDirectory = after.find((entry) => entry.path === recoveryDirectoryPath);
  if (recoveryDirectory?.kind !== "directory") {
    throw new Error(`Canvas note creation recovery directory is missing: ${recoveryDirectoryPath}`);
  }

  const recoveryBytes = await readFile(join(appDataRoot, recoveryBytesPath));
  const recoveryBytesEntry = after.find((entry) => entry.path === recoveryBytesPath);
  if (recoveryBytesEntry?.kind !== "file"
    || !recoveryBytes.equals(noteBytes)
    || recoveryBytesEntry.bytes !== recoveryBytes.length
    || recoveryBytesEntry.sha256 !== noteSha256
    || createHash("sha256").update(recoveryBytes).digest("hex") !== noteSha256) {
    throw new Error("Canvas note creation recovery bytes do not match the confirmed note or app-data snapshot");
  }

  const manifestBytes = await readFile(join(appDataRoot, recoveryManifestPath));
  const manifestEntry = after.find((entry) => entry.path === recoveryManifestPath);
  if (manifestEntry?.kind !== "file"
    || manifestEntry.bytes !== manifestBytes.length
    || manifestEntry.sha256 !== createHash("sha256").update(manifestBytes).digest("hex")) {
    throw new Error("Canvas note creation recovery manifest does not match its app-data snapshot");
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as Record<string, unknown>;
  const expectedManifestKeys = ["bytes", "captured_at", "current_revision", "expected_revision", "id", "path", "relative_path", "revision"].sort();
  const expectedIncomingPath = join(canonicalAppDataRoot, recoveryBytesPath);
  const normalizeRecoveryPath = (value: string): string => {
    const slashNormalized = value.replace(/\\/g, "/");
    return process.platform === "win32"
      ? slashNormalized.replace(/^\/\/\?\//, "").toLowerCase()
      : slashNormalized;
  };
  if (JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(expectedManifestKeys)
    || manifest.id !== incomingName
    || manifest.relative_path !== notePath
    || manifest.revision !== noteSha256
    || manifest.bytes !== noteBytes.length
    || typeof manifest.path !== "string"
    || normalizeRecoveryPath(manifest.path) !== normalizeRecoveryPath(expectedIncomingPath)
    || !validTimestamp(manifest.captured_at)
    || manifest.expected_revision !== null
    || manifest.current_revision !== null) {
    throw new Error(`Canvas note creation recovery manifest did not match the confirmed transaction: ${manifestBytes.toString("utf8").slice(0, 2_000)}`);
  }

  return {
    vault_data_id: vaultDataId,
    operation_id: operationId,
    journal_rows: journalRows.length,
    recovery_bytes: recoveryBytes.length,
  };
}

async function createObsidianProfile(
  profileDirectory: string,
  port: number,
  logFilename = port === 9222 ? "obsidian-author.log" : "obsidian-reopen.log",
): Promise<ChildProcess> {
  await mkdir(profileDirectory, {recursive: true});
  const homeRoot = join(profileDirectory, "home");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
  };
  const args: string[] = [];
  if (process.platform === "linux") {
    env.HOME = homeRoot;
    env.XDG_CONFIG_HOME = join(profileDirectory, "config");
    env.XDG_CACHE_HOME = join(profileDirectory, "cache");
    env.XDG_DATA_HOME = join(profileDirectory, "data");
    args.push("--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage");
  } else if (process.platform === "win32") {
    env.HOME = homeRoot;
    env.USERPROFILE = homeRoot;
    env.APPDATA = join(profileDirectory, "appdata-roaming");
    env.LOCALAPPDATA = join(profileDirectory, "appdata-local");
    // Windows folder pickers open the profile's Desktop by default; create it so
    // the native picker does not block automation with a missing-location dialog.
    await mkdir(join(homeRoot, "Desktop"), {recursive: true});
  }
  // Keep the GitHub-hosted macOS user's ephemeral login keychain available to Electron safeStorage.
  // Pointing HOME at a new temp directory produces a blocking "Keychain Not Found" native dialog.
  args.push(
    "--remote-allow-origins=*",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${join(profileDirectory, "user-data")}`,
  );
  return launchLogged(obsidianBinary, args, join(reportDirectory, logFilename), env);
}

async function authorFixtureThroughObsidian(child: ChildProcess): Promise<{connection: DevToolsConnection; browserVersion: string; notePath: string}> {
  if (child.exitCode !== null) throw new Error(`Pinned Obsidian exited before authoring (code ${child.exitCode})`);
  let {connection, browserVersion, target} = await connectObsidian(9222);
  const authoring = report.obsidian_authoring as Record<string, unknown>;
  authoring.devtools_browser = browserVersion;
  authoring.first_target = {title: target.title ?? "", url: target.url ?? ""};
  const firstRunBody = await waitForRenderer(connection, "document.body?.innerText ?? ''", (body) => body.includes("Open folder as vault"), "Obsidian's first-run vault screen");
  authoring.first_run_text = firstRunBody.slice(0, 2_000);
  await captureObsidianScreenshot(connection, "obsidian-first-run.png");
  connection = await chooseVaultDirectory(connection, 9222);
  await chooseRestrictedMode(connection);
  await captureObsidianScreenshot(connection, "obsidian-vault-restricted-mode.png");

  const newNoteButtons = await connection.evaluateJson<{labels: string[]; found: boolean}>(`(() => {
    const buttons = [...document.querySelectorAll('button,[role="button"]')];
    const labels = buttons.map((button) => (button.innerText || button.textContent || '').trim()).filter(Boolean);
    return {labels, found: buttons.some((button) => (button.innerText || button.textContent || '').trim().startsWith('New note'))};
  })()`);
  authoring.new_note_action_buttons = newNoteButtons.labels;
  if (!newNoteButtons.found) throw new Error("Obsidian did not expose its visible New note action after Restricted Mode opened the vault");
  authoring.new_note_action = "DOM click on Obsidian's visible New note button";
  connection.send("Runtime.evaluate", {
    expression: `(() => [...document.querySelectorAll('button,[role="button"]')]
      .find((button) => (button.innerText || button.textContent || '').trim().startsWith('New note'))?.click())()`,
    returnByValue: true,
  });
  await delay(750);
  await captureObsidianScreenshot(connection, "obsidian-new-note-action.png");

  const editor = await waitFor("Obsidian Markdown editor to become available", async () => await connection.evaluateJson<{
    count: number;
    active: boolean;
    active_tag: string | null;
    active_class: string;
    editable_elements: Array<{tag: string; class_name: string; aria_label: string | null; text: string; active: boolean}>;
    markdown_editor: {class_name: string; x: number; y: number; width: number; height: number} | null;
  }>(`(() => {
    const editors = [...document.querySelectorAll('[contenteditable="true"]')];
    const active = document.activeElement;
    const markdownEditor = document.querySelector('.cm-content[contenteditable="true"]');
    const rect = markdownEditor?.getBoundingClientRect();
    return {
      count: editors.length,
      active: editors.some((element) => element === active || element.contains(active)),
      active_tag: active?.tagName ?? null,
      active_class: typeof active?.className === 'string' ? active.className : '',
      editable_elements: editors.map((element) => ({
        tag: element.tagName,
        class_name: typeof element.className === 'string' ? element.className : '',
        aria_label: element.getAttribute('aria-label'),
        text: (element.textContent ?? '').slice(0, 100),
        active: element === active || element.contains(active),
      })),
      markdown_editor: markdownEditor && rect ? {
        class_name: typeof markdownEditor.className === 'string' ? markdownEditor.className : '',
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      } : null,
    };
  })()`), (value) => {
    (report.obsidian_authoring as Record<string, unknown>).last_editor_state = value;
    return value.markdown_editor !== null;
  }, 30_000);
  authoring.editor_after_new_note = editor;
  const clickX = Math.max(1, editor.markdown_editor!.x + 12);
  const clickY = Math.max(1, editor.markdown_editor!.y + 12);
  await connection.request("Input.dispatchMouseEvent", {type: "mouseMoved", x: clickX, y: clickY});
  await connection.request("Input.dispatchMouseEvent", {type: "mousePressed", x: clickX, y: clickY, button: "left", clickCount: 1});
  await connection.request("Input.dispatchMouseEvent", {type: "mouseReleased", x: clickX, y: clickY, button: "left", clickCount: 1});
  const editorFocus = await connection.evaluateJson<{markdown_editor_active: boolean; active_tag: string | null; active_class: string}>(`(() => {
    const markdownEditor = document.querySelector('.cm-content[contenteditable="true"]');
    const active = document.activeElement;
    return {
      markdown_editor_active: Boolean(markdownEditor && (markdownEditor === active || markdownEditor.contains(active))),
      active_tag: active?.tagName ?? null,
      active_class: typeof active?.className === 'string' ? active.className : '',
    };
  })()`);
  authoring.editor_focus_after_click = editorFocus;
  if (!editorFocus.markdown_editor_active) throw new Error(`Could not focus Obsidian's Markdown editor: ${JSON.stringify(editorFocus)}`);
  await captureObsidianScreenshot(connection, "obsidian-markdown-editor-focused.png");
  const inserted = await connection.request("Input.insertText", {text: noteContents});
  if (inserted.error) throw new Error(`Could not insert synthetic note content into Obsidian: ${inserted.error.message ?? "unknown error"}`);
  await captureObsidianScreenshot(connection, "obsidian-note-content-entered.png");

  const notePath = await waitFor("Obsidian to persist the new Markdown note", async () => {
    const entries = await snapshotTree(vaultRoot);
    for (const entry of entries) {
      if (entry.kind !== "file" || !entry.path.toLocaleLowerCase("en").endsWith(".md")) continue;
      const contents = await readFile(join(vaultRoot, entry.path), "utf8");
      if (contents.includes(noteMarker) && contents.includes(noteEmbed)) return entry.path;
    }
    return null;
  }, (value) => value !== null, 45_000).then((value) => {
    if (!value) throw new Error("Obsidian's new note was not persisted");
    return value;
  });

  await captureObsidianScreenshot(connection, "obsidian-authored-note.png");
  authoring.status = "passed";
  authoring.note_path = notePath;
  authoring.note_sha256 = createHash("sha256").update(await readFile(join(vaultRoot, notePath))).digest("hex");
  authoring.note_bytes = (await readFile(join(vaultRoot, notePath))).length;
  authoring.attachment_path_in_note = noteContents.includes(attachmentPath);
  authoring.markdown_saved_by_reference_editor = true;
  (report.fixture as Record<string, unknown>).authored_note_path = notePath;
  await saveReport();
  return {connection, browserVersion, notePath};
}

async function focusOpenObsidian(child: ChildProcess): Promise<void> {
  if (process.platform === "linux") return;
  if (process.platform === "darwin") {
    const script = `tell application "System Events" to set frontmost of first process whose unix id is ${child.pid ?? -1} to true`;
    execFileSync("osascript", ["-e", script], {stdio: "ignore"});
    return;
  }
  const script = `
    Add-Type -TypeDefinition @'
      using System;
      using System.Runtime.InteropServices;
      public static class OpenObsidianWindow {
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
      }
'@
    $application = Get-Process -Id ${child.pid ?? -1} -ErrorAction SilentlyContinue
    if ($null -eq $application -or $application.MainWindowHandle -eq 0) {
      $application = Get-Process -Name "openobsidian" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    }
    if ($null -ne $application -and $application.MainWindowHandle -ne 0) {
      [OpenObsidianWindow]::ShowWindow($application.MainWindowHandle, 9) | Out-Null
      [OpenObsidianWindow]::SetForegroundWindow($application.MainWindowHandle) | Out-Null
    }
  `;
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {stdio: "ignore"});
}

async function clickOpenVaultButton(
  child: ChildProcess,
  windowId: string,
  applicationLogPath: string,
  screenshotName = "openobsidian-vault-picker-cancel-click.png",
  reportTarget: Record<string, unknown> = report.openobsidian_open as Record<string, unknown>,
): Promise<string> {
  await focusOpenObsidian(child);
  if (process.platform === "linux") {
    const clicked = await clickOpenVaultButtonLinux(windowId, applicationLogPath);
    await delay(500);
    const screenshot = await captureDesktopScreenshot(screenshotName);
    reportTarget.picker_cancel_click_screenshot = relative(reportDirectory, screenshot);
    return `Activated OpenObsidian (focus ${clicked.focused_window_before_activation} -> ${clicked.focused_window_after_activation}), clicked (${clicked.click_x}, ${clicked.click_y}), and confirmed the egui Open vault action; window=${clicked.window_x},${clicked.window_y},${clicked.window_width},${clicked.window_height}; pointer_before_click=${clicked.pointer_before_click}; egui_action_event=${clicked.egui_action_event}; keyboard_fallback=${clicked.keyboard_fallback}.`;
  }
  if (process.platform === "darwin") {
    const script = `on run argv
      tell application "System Events"
        set targetProcess to first process whose unix id is (item 1 of argv as integer)
        set frontmost of targetProcess to true
        try
          set openVaultButton to missing value
          repeat with candidate in entire contents of window 1 of targetProcess
            try
              if role of candidate is "AXButton" and name of candidate is "Open vault" then
                set openVaultButton to candidate
                exit repeat
              end if
            end try
          end repeat
          if openVaultButton is not missing value then
            click openVaultButton
            return "Invoked the Open vault button from the window's nested accessibility tree."
          end if
          return "The nested accessibility tree did not expose Open vault."
        on error errorMessage
          return "Accessibility lookup failed: " & errorMessage
        end try
      end tell
    end run`;
    const interaction = execFileSync("osascript", ["-e", script, String(child.pid ?? -1)], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
    return interaction.includes("Invoked the Open vault button") ? interaction : await clickOpenVaultButtonMacOS(child);
  }
  if (process.platform === "win32") {
    const script = `
      $ErrorActionPreference = "Stop"
      Add-Type -AssemblyName UIAutomationClient
      Add-Type -AssemblyName UIAutomationTypes
      $application = Get-Process -Id ${child.pid ?? -1} -ErrorAction SilentlyContinue
      if ($null -eq $application -or $application.MainWindowHandle -eq 0) {
        $application = Get-Process -Name "openobsidian" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
      }
      if ($null -eq $application -or $application.MainWindowHandle -eq 0) { throw "OpenObsidian did not expose its main window handle" }
      $root = [System.Windows.Automation.AutomationElement]::FromHandle($application.MainWindowHandle)
      $buttonType = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Button
      )
      $buttonName = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::NameProperty,
        "Open vault"
      )
      $button = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.AndCondition]::new($buttonType, $buttonName))
      $deadline = [DateTime]::UtcNow.AddSeconds(10)
      $isEnabled = $false
      $bounds = $null
      $lastState = "not found"
      $stateTransitions = @()
      while ([DateTime]::UtcNow -lt $deadline) {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($application.MainWindowHandle)
        $button = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.AndCondition]::new($buttonType, $buttonName))
        if ($null -ne $button) {
          try {
            $current = $button.Current
            $isEnabled = [bool]$current.IsEnabled
            $bounds = $current.BoundingRectangle
            $observedState = "found; IsEnabled=$isEnabled; bounds=$($bounds.Left),$($bounds.Top),$($bounds.Width),$($bounds.Height)"
          } catch {
            $observedState = "stale UI Automation element: $($_.Exception.Message)"
            $isEnabled = $false
          }
        } else {
          $observedState = "not found"
          $isEnabled = $false
        }
        if ($observedState -ne $lastState) {
          $stateTransitions += ([DateTime]::UtcNow.ToString('HH:mm:ss.fffZ') + ":" + $observedState)
          $lastState = $observedState
        }
        if ($isEnabled) { break }
        Start-Sleep -Milliseconds 250
      }
      if ($null -eq $button) {
        Write-Output "Open vault was not exposed through UI Automation after polling; state_transitions=$($stateTransitions -join ' | ')"
        return
      }
      $invoked = $false
      $invokeFailure = "UI Automation continued to report IsEnabled=$isEnabled after polling"
      if ($isEnabled) {
        try {
          $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
          $invoked = $true
          Write-Output "Invoked the Open vault accessibility button after UI Automation polling; IsEnabled=$isEnabled; bounds=$($bounds.Left),$($bounds.Top),$($bounds.Width),$($bounds.Height); state_transitions=$($stateTransitions -join ' | ')"
        } catch {
          $invokeFailure = $_.Exception.Message
        }
      }
      if (-not $invoked) {
          Add-Type -TypeDefinition @'
            using System;
            using System.Runtime.InteropServices;
            public static class OpenObsidianMouse {
              [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
              [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
            }
'@
          if ($bounds.Width -le 0 -or $bounds.Height -le 0) { throw "Open vault has no clickable UI Automation bounds; IsEnabled=$isEnabled; state_transitions=$($stateTransitions -join ' | '); InvokePattern failed: $invokeFailure" }
          $clickX = [int][Math]::Round($bounds.Left + ($bounds.Width / 2))
          $clickY = [int][Math]::Round($bounds.Top + ($bounds.Height / 2))
          [OpenObsidianMouse]::SetCursorPos($clickX, $clickY) | Out-Null
          Start-Sleep -Milliseconds 250
          [OpenObsidianMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
          Start-Sleep -Milliseconds 120
          [OpenObsidianMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
          Write-Output "Moved the pointer to Open vault, waited 250 ms, and held a screen click; IsEnabled=$isEnabled; bounds=$($bounds.Left),$($bounds.Top),$($bounds.Width),$($bounds.Height); state_transitions=$($stateTransitions -join ' | '); InvokePattern result: $invokeFailure"
      }
    `;
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
  }
  throw new Error(`Unsupported OpenObsidian folder picker platform ${process.platform}`);
}

async function selectOpenObsidianVaultFromNativePicker(
  child: ChildProcess,
  window: {window_id: string},
  applicationLogPath: string,
  targetRoot = vaultRoot,
  reportTarget: Record<string, unknown> = report.openobsidian_open as Record<string, unknown>,
  screenshotPrefix = "openobsidian",
): Promise<Record<string, unknown>> {
  const screenshots: string[] = [];
  const openReport = reportTarget;
  const screenshot = (name: string) => `${screenshotPrefix}-${name}.png`;
  await focusOpenObsidian(child);
  if (process.platform === "linux") xdotool("windowfocus", "--sync", window.window_id);
  screenshots.push(relative(reportDirectory, await captureDesktopScreenshot(screenshot("vault-picker-home"))));

  const openButtonInteraction = await clickOpenVaultButton(
    child,
    window.window_id,
    applicationLogPath,
    screenshot("vault-picker-cancel-click"),
    reportTarget,
  );

  await delay(750);
  screenshots.push(relative(reportDirectory, await captureDesktopScreenshot(screenshot("native-folder-picker"))));
  const pickerWindowId = process.platform === "linux" ? activeWindowId() : null;
  const pickerWindowTitle = process.platform === "linux" ? activeWindowTitle() : "native platform folder picker";
  let pathEntryInteraction: string;
  let folderSelectionInteraction: string;

  if (process.platform === "linux") {
    if (!pickerWindowId || pickerWindowId === window.window_id) throw new Error(`OpenObsidian native folder picker did not become active; title=${pickerWindowTitle}`);
    xdotool("windowraise", pickerWindowId);
    xdotool("windowfocus", "--sync", pickerWindowId);
    await delay(250);
    xdotool("key", "ctrl+l");
    await delay(500);
    screenshots.push(relative(reportDirectory, await captureDesktopScreenshot(screenshot("native-folder-location-entry"))));
    xdotool("mousemove", "--window", pickerWindowId, "400", "22");
    xdotool("click", "1");
    xdotool("key", "ctrl+a");
    xdotool("key", "BackSpace");
    await delay(250);
    const clearedLocationScreenshot = await captureDesktopScreenshot(screenshot("native-folder-location-entry-cleared"));
    screenshots.push(relative(reportDirectory, clearedLocationScreenshot));
    const clearedLocationOcr = await readScreenshotOcr(clearedLocationScreenshot);
    execFileSync("xclip", ["-selection", "clipboard", "-loops", "1", "-in"], {input: targetRoot, stdio: ["pipe", "ignore", "ignore"]});
    xdotool("key", "ctrl+v");
    await delay(500);
    const enteredPathScreenshot = await captureDesktopScreenshot(screenshot("native-folder-path-entered"));
    screenshots.push(relative(reportDirectory, enteredPathScreenshot));
    const enteredPathOcr = await readScreenshotOcr(enteredPathScreenshot);
    openReport.linux_folder_selection_location_entry_after_clear_ocr = clearedLocationOcr.slice(0, 2_000);
    openReport.linux_folder_selection_location_entry_ocr = enteredPathOcr.slice(0, 2_000);
    openReport.linux_folder_selection_location_entry_contains_fixture_path = enteredPathOcr.includes(targetRoot);
    await saveReport();
    pathEntryInteraction = "Focused and cleared the Ctrl+L location entry, then pasted the full absolute fixture path from the CI clipboard.";
    const clicked = clickWindowOpenButton(pickerWindowId);
    folderSelectionInteraction = `Clicked the native folder dialog confirmation at (${clicked.click_x}, ${clicked.click_y}) after entering the fixture path.`;
    await delay(750);
    screenshots.push(relative(reportDirectory, await captureDesktopScreenshot(screenshot("native-folder-path-opened"))));
    if (activeWindowId() === pickerWindowId) {
      openReport.linux_folder_selection_interaction = folderSelectionInteraction;
      openReport.linux_folder_selection_click = clicked;
      openReport.linux_folder_selection_screenshots = screenshots.slice();
      await saveReport();
      throw new Error(`The native Linux folder picker remained visible after its confirmation button click; window=${pickerWindowTitle}; click=${JSON.stringify(clicked)}`);
    }
  } else if (process.platform === "darwin") {
    const pickerAccessibility = await waitFor(
      "native macOS folder picker to become visible",
      async () => {
        try {
          return macOSApplicationWindowDescriptions(child);
        } catch {
          return null;
        }
      },
      (descriptions) => descriptions !== null && macOSNativePickerVisibleInAccessibility(descriptions),
      15_000,
    );
    if (!pickerAccessibility) throw new Error(`The native macOS folder picker did not appear before path entry; accessibility windows=${macOSApplicationWindowDescriptions(child)}`);
    reportTarget.native_picker_accessibility_windows = pickerAccessibility;
    await saveReport();
    screenshots.push(relative(reportDirectory, await captureDesktopScreenshot(screenshot("native-folder-picker-ready"))));
    const pathScript = `on run argv
      tell application "System Events"
        set targetProcess to first process whose unix id is (item 1 of argv as integer)
        set frontmost of targetProcess to true
        keystroke "g" using {command down, shift down}
        delay 0.75
        keystroke (item 2 of argv)
        delay 0.5
        key code 36
        delay 1
      end tell
    end run`;
    execFileSync("osascript", ["-e", pathScript, String(child.pid ?? -1), targetRoot], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
    await delay(500);
    screenshots.push(relative(reportDirectory, await captureDesktopScreenshot(screenshot("native-folder-path-entered"))));
    reportTarget.native_picker_screenshots = screenshots.slice();
    await saveReport();
    folderSelectionInteraction = await clickMacOSNativePickerOpenButton(child);
    await delay(500);
    screenshots.push(relative(reportDirectory, await captureDesktopScreenshot(screenshot("native-folder-path-selected"))));
    reportTarget.native_picker_screenshots = screenshots.slice();
    await saveReport();
    pathEntryInteraction = "Used Command-Shift-G with the full absolute fixture path; the native Open button was clicked using the Open panel's accessible bounds.";
  } else {
    const pathScript = `
      $ErrorActionPreference = "Stop"
      $shell = New-Object -ComObject WScript.Shell
      $shell.SendKeys("^l")
      Start-Sleep -Milliseconds 300
      $shell.SendKeys($env:OPENOBSIDIAN_PICKER_VAULT_PATH)
      Start-Sleep -Milliseconds 300
      $shell.SendKeys("{ENTER}")
    `;
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", pathScript], {
      env: {...process.env, OPENOBSIDIAN_PICKER_VAULT_PATH: targetRoot},
      stdio: "ignore",
    });
    screenshots.push(relative(reportDirectory, await captureDesktopScreenshot(screenshot("native-folder-path-entered"))));
    const selectScript = `
      $ErrorActionPreference = "Stop"
      Add-Type -AssemblyName UIAutomationClient
      Add-Type -AssemblyName UIAutomationTypes
      $root = [System.Windows.Automation.AutomationElement]::RootElement
      $buttonType = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Button
      )
      $buttonNames = @("Select Folder", "Select", "Open")
      $selected = $null
      foreach ($name in $buttonNames) {
        $nameCondition = [System.Windows.Automation.PropertyCondition]::new(
          [System.Windows.Automation.AutomationElement]::NameProperty,
          $name
        )
        $selected = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.AndCondition]::new($buttonType, $nameCondition))
        if ($null -ne $selected) { break }
      }
      if ($null -ne $selected) {
        $selected.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        Write-Output "Invoked native folder selection button: $($selected.Current.Name)"
      } else {
        Add-Type -TypeDefinition @'
          using System;
          using System.Runtime.InteropServices;
          [StructLayout(LayoutKind.Sequential)] public struct OpenObsidianPickerRect { public int Left; public int Top; public int Right; public int Bottom; }
          public static class OpenObsidianPickerNative {
            [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
            [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out OpenObsidianPickerRect rectangle);
            [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
            [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extraInfo);
          }
'@
        $dialog = [OpenObsidianPickerNative]::GetForegroundWindow()
        if ($dialog -eq [IntPtr]::Zero) { throw "Could not find the foreground native folder picker window" }
        $rectangle = New-Object OpenObsidianPickerRect
        if (-not [OpenObsidianPickerNative]::GetWindowRect($dialog, [ref]$rectangle)) { throw "Could not read the native folder picker window bounds" }
        $dialogWidth = $rectangle.Right - $rectangle.Left
        $dialogHeight = $rectangle.Bottom - $rectangle.Top
        if ($dialogWidth -lt 500 -or $dialogHeight -lt 400) { throw "Foreground window is not the native folder picker: $($dialogWidth)x$($dialogHeight)" }
        $clickX = $rectangle.Left + [int]($dialogWidth * 0.72)
        $clickY = $rectangle.Top + [int]($dialogHeight * 0.936)
        if (-not [OpenObsidianPickerNative]::SetCursorPos($clickX, $clickY)) { throw "Could not move the pointer to the native folder picker button" }
        [OpenObsidianPickerNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 100
        [OpenObsidianPickerNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
        Write-Output "The picker did not expose its Select Folder button; clicked the visible button at ($clickX, $clickY)."
      }
    `;
    folderSelectionInteraction = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", selectScript], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
    pathEntryInteraction = "Ctrl+L location entry with the full absolute fixture path.";
  }

  await delay(1_000);
  screenshots.push(relative(reportDirectory, await captureDesktopScreenshot(screenshot("vault-picker-selected"))));
  return {
    open_button_interaction: openButtonInteraction,
    picker_window_id: pickerWindowId,
    picker_window_title: pickerWindowTitle,
    path_entry_interaction: pathEntryInteraction,
    folder_selection_interaction: folderSelectionInteraction,
    screenshots,
    selected_path: `$RUNNER_TEMP/openobsidian-c01-roundtrip/${relative(workDirectory, targetRoot).split(sep).join("/")}`,
  };
}

async function cancelOpenObsidianNativePicker(
  child: ChildProcess,
  window: {window_id: string},
  appDataRoot: string,
  appDataSnapshotBeforePickerOpen: SnapshotEntry[],
  vaultRoot: string,
  canonicalVault: string,
  expectedMarkdownCount: number,
): Promise<Record<string, unknown>> {
  const screenshots: string[] = [];
  const linuxWindowsBefore = process.platform === "linux" ? x11WindowInventory() : null;
  const windowsBefore = process.platform === "win32" ? windowsTopLevelWindowInventory() : null;
  const openReport = report.openobsidian_open as Record<string, unknown>;
  if (linuxWindowsBefore) openReport.picker_cancel_x11_windows_before = linuxWindowsBefore;
  if (process.platform === "linux") openReport.picker_cancel_x11_input_before = x11InteractionState();
  if (windowsBefore) openReport.picker_cancel_windows_before = windowsBefore;
  const openButtonInteraction = await clickOpenVaultButton(
    child,
    window.window_id,
    join(reportDirectory, "openobsidian.log"),
  );
  openReport.picker_cancel_open_button_interaction = openButtonInteraction;
  if (process.platform === "win32") {
    const screenshot = await captureDesktopScreenshot("openobsidian-vault-picker-cancel-click.png");
    openReport.picker_cancel_click_screenshot = relative(reportDirectory, screenshot);
  }
  if (process.platform === "linux") {
    openReport.picker_cancel_x11_windows_after_click = x11WindowInventory();
    openReport.picker_cancel_x11_input_after_click = x11InteractionState();
  }
  if (process.platform === "win32") openReport.picker_cancel_windows_after_click = windowsTopLevelWindowInventory();
  await saveReport();
  let pickerWindowId: string | null = null;
  let pickerWindowTitle = "native platform folder picker";
  let cancellationInteraction: string;
  let pickerOpenOcr: string | null = null;
  let pickerAccessibilityWindows: string | null = null;
  let remainingMacAccessibilityWindows: string | null = null;
  let windowsPicker: WindowsTopLevelWindow | null = null;
  let remainingWindows: WindowsTopLevelWindow[] | null = null;
  let linuxWindowsAfterEscape: X11WindowDescription[] | null = null;
  let appDataSnapshotBeforeCancel: SnapshotEntry[] = [];
  let appDataChangesOnPickerOpen: Array<{path: string; before?: SnapshotEntry; after?: SnapshotEntry}> = [];
  let eframePersistenceFilesBeforeCancel: Array<{path: string; bytes: number; sha256: string; content: string}> = [];
  const captureAppDataBaselineBeforeCancel = async (): Promise<void> => {
    const snapshot = await snapshotTree(appDataRoot);
    const eframeFiles = await readSnapshotTextFiles(appDataRoot, snapshot, (path) => path.toLowerCase().endsWith(".ron"));
    const changes = changedPaths(appDataSnapshotBeforePickerOpen, snapshot);
    ensureAppDataChangesAreMacEframeUiStateOnly(
      changes,
      eframeFiles,
      "OpenObsidian app data while opening native picker",
      [vaultRoot, canonicalVault, appDataRoot],
    );
    appDataSnapshotBeforeCancel = snapshot;
    appDataChangesOnPickerOpen = changes;
    eframePersistenceFilesBeforeCancel = eframeFiles;
    const appDataReport = report.openobsidian_app_data as Record<string, unknown>;
    appDataReport.snapshot_before_picker_cancellation = snapshot;
    appDataReport.changes_on_picker_open = changes;
    appDataReport.eframe_persistence_files_before_cancellation = eframeFiles;
    appDataReport.eframe_app_ron_present_before_cancellation = snapshot.some(
      (entry) => entry.kind === "file" && entry.path === "app.ron",
    );
    await saveReport();
  };
  if (process.platform === "linux") {
    const previousWindowIds = new Set((linuxWindowsBefore ?? []).map((candidate) => candidate.window_id));
    const picker = await waitFor("new X11 native folder picker window", async () => {
      const candidates = x11WindowInventory().filter((candidate) => candidate.window_id !== window.window_id && !previousWindowIds.has(candidate.window_id));
      return candidates[0] ?? null;
    }, (candidate) => candidate !== null, 10_000);
    if (!picker) throw new Error(`OpenObsidian did not create a new X11 folder-picker window; before=${JSON.stringify(linuxWindowsBefore)}; after=${JSON.stringify(x11WindowInventory())}`);
    xdotool("windowraise", picker.window_id);
    xdotool("windowfocus", "--sync", picker.window_id);
    await delay(300);
    pickerWindowId = picker.window_id;
    pickerWindowTitle = picker.title;
    screenshots.push(relative(reportDirectory, await captureDesktopScreenshot("openobsidian-vault-picker-cancel-open.png")));
    await captureAppDataBaselineBeforeCancel();
    xdotool("key", "Escape");
    linuxWindowsAfterEscape = await waitFor("X11 native folder picker to close after Escape", async () => x11WindowInventory(), (windows) => !windows.some((candidate) => candidate.window_id === picker.window_id), 10_000);
    cancellationInteraction = `Raised X11 picker window ${picker.window_id} (${picker.title}) and sent Escape.`;
    openReport.picker_cancel_x11_windows_after_escape = linuxWindowsAfterEscape;
  } else if (process.platform === "darwin") {
    await delay(1_000);
    const pickerScreenshot = await captureDesktopScreenshot("openobsidian-vault-picker-cancel-open.png");
    screenshots.push(relative(reportDirectory, pickerScreenshot));
    pickerOpenOcr = await readNativeFolderPickerOcr(pickerScreenshot);
    const accessibilityWindows = macOSApplicationWindowDescriptions(child);
    pickerAccessibilityWindows = accessibilityWindows;
    pickerWindowTitle = accessibilityWindows;
    if (!nativeFolderPickerVisibleInOcr(pickerOpenOcr) && !macOSNativePickerVisibleInAccessibility(accessibilityWindows)) {
      throw new Error(`The native macOS Open panel was not visible before Escape; OCR=${JSON.stringify(pickerOpenOcr.slice(0, 2_000))}; accessibility windows=${JSON.stringify(accessibilityWindows)}`);
    }
    await captureAppDataBaselineBeforeCancel();
    const script = `tell application "System Events" to key code 53`;
    execFileSync("osascript", ["-e", script], {stdio: "ignore"});
    cancellationInteraction = "Sent Escape to the native macOS Open panel.";
  } else if (process.platform === "win32") {
    const previousHandles = new Set((windowsBefore ?? []).map((candidate) => candidate.native_window_handle));
    const applicationPid = child.pid ?? -1;
    windowsPicker = await waitFor("new Windows native folder-picker window", async () => {
      const candidates = windowsTopLevelWindowInventory().filter((candidate) => isNewWindowsNativePicker(candidate, previousHandles, applicationPid));
      return candidates[0] ?? null;
    }, (candidate) => candidate !== null, 15_000).catch(() => null);
    if (!windowsPicker) throw new Error(`OpenObsidian did not expose a new Windows native folder-picker window; before=${JSON.stringify(windowsBefore)}; after=${JSON.stringify(windowsTopLevelWindowInventory())}; OpenObsidian UI Automation controls=${JSON.stringify(windowsOpenVaultControlInventory(applicationPid))}`);
    pickerWindowId = String(windowsPicker.native_window_handle);
    pickerWindowTitle = `${windowsPicker.name} (${windowsPicker.class_name})`;
    const focusScript = `
      $ErrorActionPreference = "Stop"
      Add-Type -TypeDefinition @'
        using System;
        using System.Runtime.InteropServices;
        public static class OpenObsidianPickerWindow {
          [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
        }
'@
      $shell = New-Object -ComObject WScript.Shell
      $activated = [OpenObsidianPickerWindow]::SetForegroundWindow([IntPtr]${windowsPicker.native_window_handle})
      if (-not $activated) { $activated = $shell.AppActivate(${windowsPicker.process_id}) }
      if (-not $activated) { throw "Could not focus the detected Windows folder picker" }
      Start-Sleep -Milliseconds 300
      Write-Output "Focused native picker by handle=${windowsPicker.native_window_handle}; process=${windowsPicker.process_id}"
    `;
    const focusedPicker = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", focusScript], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
    const pickerScreenshot = await captureDesktopScreenshot("openobsidian-vault-picker-cancel-open.png");
    screenshots.push(relative(reportDirectory, pickerScreenshot));
    pickerOpenOcr = await readNativeFolderPickerOcr(pickerScreenshot);
    await captureAppDataBaselineBeforeCancel();
    const script = `
      $ErrorActionPreference = "Stop"
      $shell = New-Object -ComObject WScript.Shell
      if (-not $shell.AppActivate(${windowsPicker.process_id})) { throw "Could not focus the detected native folder picker" }
      Start-Sleep -Milliseconds 300
      $shell.SendKeys("{ESC}")
      Write-Output "Sent Escape to the native Windows folder picker."
    `;
    const escapeResult = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
    cancellationInteraction = `${focusedPicker}; ${escapeResult}`;
    remainingWindows = await waitFor("Windows native folder picker to close after Escape", async () => windowsTopLevelWindowInventory(), (windows) => !windows.some((candidate) => candidate.native_window_handle === windowsPicker?.native_window_handle), 10_000);
  } else {
    throw new Error(`Unsupported OpenObsidian folder picker platform ${process.platform}`);
  }

  await delay(1_000);
  const cancelledScreenshot = await captureDesktopScreenshot("openobsidian-vault-picker-cancelled.png");
  screenshots.push(relative(reportDirectory, cancelledScreenshot));
  const cancelledOcr = await readScreenshotOcr(cancelledScreenshot);
  if (process.platform === "darwin") remainingMacAccessibilityWindows = macOSApplicationWindowDescriptions(child);
  if (process.platform === "darwin" && (nativeFolderPickerVisibleInOcr(cancelledOcr) || (remainingMacAccessibilityWindows !== null && macOSNativePickerVisibleInAccessibility(remainingMacAccessibilityWindows)))) {
    throw new Error(`The native folder picker remained visible after Escape; OCR=${JSON.stringify(cancelledOcr.slice(0, 2_000))}; accessibility windows=${remainingMacAccessibilityWindows ?? "unavailable"}`);
  }
  if (process.platform === "win32" && remainingWindows?.some((candidate) => candidate.native_window_handle === windowsPicker?.native_window_handle)) {
    throw new Error(`The native Windows folder picker remained visible after Escape; windows=${JSON.stringify(remainingWindows)}`);
  }
  const restoredWindow = await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-vault-after-picker-cancelled");
  const restoredVaultVisible = restoredWindow.ocrText.toLowerCase().includes("roundtrip fixture");
  const expectedNoteCountVisible = ocrTextContainsRefreshedMarkdownCount(restoredWindow.ocrText, expectedMarkdownCount);
  if (!restoredVaultVisible || !expectedNoteCountVisible) {
    throw new Error(`OpenObsidian did not restore the active vault after picker cancellation; OCR=${JSON.stringify(restoredWindow.ocrText.slice(0, 2_000))}`);
  }

  return {
    open_button_interaction: openButtonInteraction,
    picker_window_id: pickerWindowId,
    picker_window_title: pickerWindowTitle,
    cancellation_interaction: cancellationInteraction,
    screenshots,
    picker_open_verified: true,
    picker_open_screen_ocr: pickerOpenOcr,
    picker_open_accessibility_windows: pickerAccessibilityWindows,
    picker_closed_verified: true,
    picker_closed_accessibility_windows: remainingMacAccessibilityWindows,
    picker_open_windows: windowsPicker,
    picker_closed_windows: remainingWindows,
    picker_closed_x11_windows: linuxWindowsAfterEscape,
    app_data_snapshot_before_cancel: appDataSnapshotBeforeCancel,
    app_data_changes_on_picker_open: appDataChangesOnPickerOpen,
    eframe_persistence_files_before_cancel: eframePersistenceFilesBeforeCancel,
    cancelled_screen_ocr: process.platform === "linux" ? null : cancelledOcr.slice(0, 2_000),
    restored_vault_visible: restoredVaultVisible,
    expected_markdown_count_visible: expectedNoteCountVisible,
    restored_ui_ocr: restoredWindow.ocrText.slice(0, 2_000),
  };
}

async function captureOpenObsidianScreenshot(
  windowId: string,
  child: ChildProcess,
  prefix = "openobsidian-vault",
  reportTarget: Record<string, unknown> = report.openobsidian_open as Record<string, unknown>,
): Promise<{pngPath: string; windowPngPath: string; ocrPngPath: string; ocrText: string; windowGeometry?: string}> {
  await focusOpenObsidian(child);
  const pngPath = await captureDesktopScreenshot(`${prefix}.png`);
  const windowsCapture = process.platform === "win32"
    ? await captureWindowsWindowScreenshot(child.pid ?? -1, `${prefix}-window.png`)
    : null;
  const windowPngPath = process.platform === "linux"
    ? await captureX11WindowScreenshot(windowId, `${prefix}-window.png`)
    : process.platform === "darwin"
      ? await captureMacOSWindowScreenshot(child.pid ?? -1, `${prefix}-window.png`)
      : windowsCapture?.pngPath ?? pngPath;
  if (windowsCapture) {
    reportTarget.native_window = {
      window_id: windowsCapture.window_id,
      title: windowsCapture.title,
      geometry: windowsCapture.geometry,
    };
  }
  const ocrPngPath = await prepareScreenshotForOcr(windowPngPath);
  const tesseract = process.platform === "win32" ? "tesseract.exe" : "tesseract";
  const pageSegmentationModes = process.platform === "darwin" || process.platform === "win32" ? ["11", "6"] : ["6"];
  const ocrText = pageSegmentationModes.map((mode) => execFileSync(tesseract, [ocrPngPath, "stdout", "--psm", mode], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim()).filter(Boolean).join("\n");
  return {pngPath, windowPngPath, ocrPngPath, ocrText, ...(windowsCapture ? {windowGeometry: windowsCapture.geometry} : {})};
}

async function withSourcePaneOcr<T extends {ocrPngPath: string; windowPngPath: string}>(capture: T): Promise<T & {
  sourcePaneOcrText: string;
  sourcePaneLabelVisible: boolean;
  sourcePaneOcrCropPath: string | null;
  sourcePaneOcrCropBounds: Record<string, unknown> | null;
}> {
  const sourcePane = await readSourcePaneOcr(capture.windowPngPath, capture.ocrPngPath);
  return {
    ...capture,
    sourcePaneOcrText: sourcePane.text,
    sourcePaneLabelVisible: sourcePane.labelVisible,
    sourcePaneOcrCropPath: sourcePane.cropPath,
    sourcePaneOcrCropBounds: sourcePane.cropBounds,
  };
}

type OcrWordBounds = {text: string; left: number; top: number; width: number; height: number};

function findOcrPhraseBounds(tsv: string, phrase: string, minimumTop = 0, lastMatch = false): OcrWordBounds | null {
  const expected = phrase.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const words: OcrWordBounds[] = [];
  for (const line of tsv.split(/\r?\n/).slice(1)) {
    const columns = line.split("\t");
    if (columns[0] !== "5" || columns.length < 12) continue;
    const text = (columns[11] ?? "").trim();
    if (!text) continue;
    const [left, top, width, height] = columns.slice(6, 10).map(Number);
    if (![left, top, width, height].every(Number.isFinite)) continue;
    words.push({text, left, top, width, height});
  }
  const normalized = words.map((word) => word.text.toLowerCase().replace(/[^a-z0-9]/g, ""));
  let selected: OcrWordBounds | null = null;
  for (let start = 0; expected.length > 0 && start + expected.length <= words.length; start += 1) {
    if (!expected.every((token, offset) => ocrTokenMatches(normalized[start + offset] ?? "", token))) continue;
    const match = words.slice(start, start + expected.length);
    const left = Math.min(...match.map((word) => word.left));
    const top = Math.min(...match.map((word) => word.top));
    const right = Math.max(...match.map((word) => word.left + word.width));
    const bottom = Math.max(...match.map((word) => word.top + word.height));
    if (top < minimumTop) continue;
    const bounds = {text: match.map((word) => word.text).join(" "), left, top, width: right - left, height: bottom - top};
    if (!lastMatch) return bounds;
    selected = bounds;
  }
  return selected;
}

function findOcrJoinedPhraseBoundsCandidates(tsv: string, phrase: string, minimumTop = 0, maxEdits = 1): OcrWordBounds[] {
  const expected = phrase.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!expected) return [];

  const wordsByLine = new Map<string, OcrWordBounds[]>();
  for (const line of tsv.split(/\r?\n/).slice(1)) {
    const columns = line.split("\t");
    if (columns[0] !== "5" || columns.length < 12) continue;
    const text = (columns[11] ?? "").trim();
    if (!text) continue;
    const [left, top, width, height] = columns.slice(6, 10).map(Number);
    if (![left, top, width, height].every(Number.isFinite)) continue;
    const lineId = columns.slice(1, 5).join(":");
    const words = wordsByLine.get(lineId) ?? [];
    words.push({text, left, top, width, height});
    wordsByLine.set(lineId, words);
  }

  const exactMatches = new Map<string, OcrWordBounds>();
  const approximateMatches = new Map<string, OcrWordBounds>();
  for (const words of wordsByLine.values()) {
    for (let start = 0; start < words.length; start += 1) {
      let normalized = "";
      for (let end = start; end < words.length; end += 1) {
        normalized += words[end]!.text.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (normalized.length > expected.length + maxEdits) break;
        const isExact = normalized === expected;
        if (!isExact && !editDistanceWithinLimit(normalized, expected, maxEdits)) continue;

        const match = words.slice(start, end + 1);
        const left = Math.min(...match.map((word) => word.left));
        const top = Math.min(...match.map((word) => word.top));
        if (top < minimumTop) continue;
        const right = Math.max(...match.map((word) => word.left + word.width));
        const bottom = Math.max(...match.map((word) => word.top + word.height));
        const bounds = {text: match.map((word) => word.text).join(" "), left, top, width: right - left, height: bottom - top};
        const matches = isExact ? exactMatches : approximateMatches;
        matches.set(`${left}:${top}:${right}:${bottom}`, bounds);
      }
    }
  }
  return [...(exactMatches.size > 0 ? exactMatches : approximateMatches).values()];
}

function findOcrJoinedPhraseBounds(tsv: string, phrase: string, minimumTop = 0, maxEdits = 1, lastMatch = false): OcrWordBounds | null {
  const matches = findOcrJoinedPhraseBoundsCandidates(tsv, phrase, minimumTop, maxEdits);
  return lastMatch ? matches.at(-1) ?? null : matches[0] ?? null;
}

async function pngDimensions(path: string): Promise<{width: number; height: number}> {
  const bytes = await readFile(path);
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") throw new Error(`Could not read PNG dimensions from ${path}`);
  return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
}

async function readSourcePaneOcr(windowImagePath: string, ocrImagePath: string): Promise<{
  text: string;
  cropPath: string | null;
  labelVisible: boolean;
  cropBounds: Record<string, unknown> | null;
}> {
  const tsv = runTesseractTsv(ocrImagePath);
  const sourceLabel = findOcrPhraseBounds(tsv, "Original Markdown source");
  if (!sourceLabel) return {text: "", cropPath: null, labelVisible: false, cropBounds: null};

  const windowDimensions = await pngDimensions(windowImagePath);
  const ocrDimensions = await pngDimensions(ocrImagePath);
  const scaleX = windowDimensions.width / ocrDimensions.width;
  const scaleY = windowDimensions.height / ocrDimensions.height;
  const sourceTop = sourceLabel.top + sourceLabel.height + 6;
  const previewLabel = findOcrPhraseBounds(tsv, "Markdown preview", sourceTop);
  const cropBounds: Record<string, unknown> = {
    source_label_bounds_ocr_image: sourceLabel,
    markdown_preview_label_bounds_ocr_image: previewLabel,
    window_image_dimensions: windowDimensions,
    ocr_image_dimensions: ocrDimensions,
    ocr_to_window_scale: {x: scaleX, y: scaleY},
    crop_source: "original_window_screenshot",
  };
  const sourceLabelValid = sourceLabel.left >= 0
    && sourceLabel.top >= 0
    && sourceLabel.width > 0
    && sourceLabel.height > 0
    && sourceLabel.left + sourceLabel.width <= ocrDimensions.width
    && sourceLabel.top + sourceLabel.height <= ocrDimensions.height;
  const previewLabelValid = Boolean(previewLabel
    && previewLabel.left >= 0
    && previewLabel.top >= 0
    && previewLabel.width > 0
    && previewLabel.height > 0
    && previewLabel.left + previewLabel.width <= ocrDimensions.width
    && previewLabel.top + previewLabel.height <= ocrDimensions.height
    && previewLabel.top > sourceTop);
  if (!sourceLabelValid || !previewLabelValid || !Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    return {
      text: "",
      cropPath: null,
      labelVisible: true,
      cropBounds: {
        ...cropBounds,
        crop_error: !sourceLabelValid
          ? "source_label_bounds_invalid"
          : !previewLabelValid
            ? "markdown_preview_label_missing_or_out_of_order"
            : "invalid_image_scale",
      },
    };
  }
  const left = Math.max(0, Math.min(windowDimensions.width - 1, Math.round((sourceLabel.left - 12) * scaleX)));
  const top = Math.max(0, Math.min(windowDimensions.height - 1, Math.round(sourceTop * scaleY)));
  const bottom = Math.min(windowDimensions.height, Math.round((previewLabel?.top ?? sourceTop) * scaleY));
  const width = windowDimensions.width - left;
  const height = bottom - top;
  if (left < 0 || top < 0 || width <= 0 || height <= 0
    || left + width > windowDimensions.width || top + height > windowDimensions.height) {
    return {
      text: "",
      cropPath: null,
      labelVisible: true,
      cropBounds: {
        ...cropBounds,
        crop_error: "window_crop_rectangle_invalid",
        window_crop_rectangle: {left, top, width, height},
      },
    };
  }
  const cropPath = join(reportDirectory, "openobsidian-source-pane-ocr-" + Date.now() + ".png");
  const imageMagick = process.platform === "linux" ? "convert" : "magick";
  const cropGeometry = width + "x" + height + "+" + left + "+" + top;
  execFileSync(imageMagick, [
    windowImagePath,
    "-crop",
    cropGeometry,
    "+repage",
    "-colorspace",
    "Gray",
    "-resize",
    "300%",
    cropPath,
  ], {stdio: "ignore"});
  return {
    text: runTesseractOcr(cropPath, ["6"]),
    cropPath,
    labelVisible: true,
    cropBounds: {
      ...cropBounds,
      window_crop_rectangle: {left, top, width, height},
    },
  };
}

function macOSOpenObsidianWindowBounds(child: ChildProcess): {x: number; y: number; width: number; height: number} {
  const script = `on run argv
    tell application "System Events"
      set targetProcess to first process whose unix id is (item 1 of argv as integer)
      set windowPosition to position of window 1 of targetProcess
      set windowSize to size of window 1 of targetProcess
      return (item 1 of windowPosition as integer) & "," & (item 2 of windowPosition as integer) & "," & (item 1 of windowSize as integer) & "," & (item 2 of windowSize as integer)
    end tell
  end run`;
  const value = execFileSync("osascript", ["-e", script, String(child.pid ?? -1)], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
  const bounds = value.match(/-?\d+/g)?.map(Number) ?? [];
  if (bounds.length < 4 || bounds[2] <= 0 || bounds[3] <= 0) throw new Error(`Could not read OpenObsidian's visible macOS window bounds: ${value}`);
  return {x: bounds[0] ?? 0, y: bounds[1] ?? 0, width: bounds[2] ?? 0, height: bounds[3] ?? 0};
}

async function clickVisibleOpenObsidianControl(
  child: ChildProcess,
  windowId: string,
  controlName: string,
  accessibilityFailure: string,
  fallbackAnchorPhrase?: string,
): Promise<string> {
  const capture = await captureOpenObsidianScreenshot(windowId, child, "openobsidian-control-target");
  const tesseract = process.platform === "win32" ? "tesseract.exe" : "tesseract";
  const windowOcrSource = {kind: "window" as const, ocrPath: capture.ocrPngPath, imagePath: capture.windowPngPath, candidates: [] as string[]};
  const ocrSources: Array<{kind: "window" | "desktop"; ocrPath: string; imagePath: string; candidates: string[]}> = process.platform === "darwin"
    ? []
    : [windowOcrSource];
  if (process.platform === "darwin") {
    const desktopOcrPath = join(reportDirectory, "openobsidian-control-target-desktop-ocr.png");
    execFileSync("magick", [capture.pngPath, "-colorspace", "Gray", "-level", "0%,15%", "-resize", "200%", desktopOcrPath], {stdio: "ignore"});
    ocrSources.push({kind: "desktop", ocrPath: desktopOcrPath, imagePath: capture.pngPath, candidates: []});
  }
  let bounds: OcrWordBounds | null = null;
  let ocrSource = ocrSources[0]!;
  let ocrSize = await pngDimensions(ocrSource.ocrPath);
  for (const source of ocrSources) {
    source.candidates = ["11", "6"].map((mode) => execFileSync(tesseract, [source.ocrPath, "stdout", "--psm", mode, "tsv"], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}));
    const targetBounds = source.candidates.map((candidate) => findOcrPhraseBounds(candidate, controlName)).find(Boolean) ?? null;
    if (targetBounds) {
      bounds = targetBounds;
      ocrSource = source;
      ocrSize = await pngDimensions(source.ocrPath);
      break;
    }
  }
  let clickDescription = `OCR label ${JSON.stringify(bounds?.text ?? controlName)}`;
  let xFraction: number;
  let yFraction: number;
  if (!bounds) {
    const anchorPhrase = controlName === "Read note source preview"
      ? "Read up to 16 KiB"
      : controlName === "Close source preview"
        ? fallbackAnchorPhrase ?? "Source"
      : controlName === "Refresh note list"
        ? fallbackAnchorPhrase ?? "Markdown files found"
        : controlName === "Note to inspect"
          ? fallbackAnchorPhrase ?? "Previous note"
        : fallbackAnchorPhrase ?? null;
    let anchor: OcrWordBounds | null = null;
    if (anchorPhrase) {
      for (const source of ocrSources) {
        anchor = source.candidates.map((candidate) => findOcrPhraseBounds(candidate, anchorPhrase)).find(Boolean) ?? null;
        if (anchor) {
          ocrSource = source;
          ocrSize = await pngDimensions(source.ocrPath);
          break;
        }
      }
    }
    if (!anchorPhrase || !anchor) {
      const candidates = ocrSources.flatMap((source) => source.candidates);
      const detectedWords = candidates.map((candidate) => candidate.split(/\r?\n/).slice(1).map((line) => line.split("\t")[11]?.trim()).filter(Boolean).join(" ")).join(" | ");
      throw new Error(`Accessibility failed (${accessibilityFailure}); OCR could not locate ${JSON.stringify(controlName)} or anchor ${JSON.stringify(anchorPhrase)}; detected words=${JSON.stringify(detectedWords.slice(0, 2_000))}; OCR=${JSON.stringify(capture.ocrText.slice(0, 2_000))}`);
    }
    const imageSize = await pngDimensions(ocrSource.imagePath);
    const scaleX = ocrSize.width / imageSize.width;
    const scaleY = ocrSize.height / imageSize.height;
    if (controlName === "Refresh note list") {
      xFraction = (anchor.left - 58 * scaleX) / ocrSize.width;
      yFraction = (anchor.top + anchor.height / 2) / ocrSize.height;
    } else if (controlName === "Note to inspect") {
      xFraction = anchorPhrase === "Nested"
        ? (anchor.left - 55 * scaleX) / ocrSize.width
        : (anchor.left + anchor.width + 55 * scaleX) / ocrSize.width;
      yFraction = (anchor.top + anchor.height / 2) / ocrSize.height;
    } else if (controlName === "Previous note") {
      xFraction = (anchor.left - 155 * scaleX) / ocrSize.width;
      yFraction = (anchor.top + anchor.height / 2) / ocrSize.height;
    } else if (controlName === "Next note") {
      xFraction = (anchor.left + anchor.width + 55 * scaleX) / ocrSize.width;
      yFraction = (anchor.top + anchor.height / 2) / ocrSize.height;
    } else if (controlName === "Review and confirm note creation") {
      xFraction = (anchor.left + 100 * scaleX) / ocrSize.width;
      yFraction = (anchor.top + 77 * scaleY) / ocrSize.height;
    } else {
      let verticalControlOffset = 18;
      if (controlName === "Preview note creation") verticalControlOffset = 90;
      if (process.platform === "darwin" && controlName === "Read note source preview") verticalControlOffset = 28;
      if (controlName === "Close source preview") {
        verticalControlOffset = anchorPhrase === "Note source preview" ? 70 : 28;
        if (process.platform === "darwin" && anchorPhrase === "Note source preview") verticalControlOffset = 86;
      }
      xFraction = (anchor.left + 75 * scaleX) / ocrSize.width;
      yFraction = (anchor.top + verticalControlOffset * scaleY) / ocrSize.height;
    }
    clickDescription = `OCR layout anchor ${JSON.stringify(anchor.text)} for ${JSON.stringify(controlName)}`;
  } else {
    xFraction = (bounds.left + bounds.width / 2) / ocrSize.width;
    yFraction = (bounds.top + bounds.height / 2) / ocrSize.height;
  }
  if (!Number.isFinite(xFraction) || !Number.isFinite(yFraction)
    || xFraction < 0 || xFraction > 1 || yFraction < 0 || yFraction > 1) {
    throw new Error(`OCR mapped ${JSON.stringify(controlName)} outside the captured OpenObsidian window`);
  }
  let interaction: string;

  if (process.platform === "linux") {
    const geometry = execFileSync("xdotool", ["getwindowgeometry", "--shell", windowId], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
    const read = (key: string): number => Number(geometry.match(new RegExp(`^${key}=(\\d+)$`, "m"))?.[1] ?? NaN);
    const width = read("WIDTH");
    const height = read("HEIGHT");
    if (!(width > 0 && height > 0)) throw new Error(`Could not read Linux OpenObsidian window size for OCR click: ${geometry}`);
    const x = Math.round(xFraction * width);
    const y = Math.round(yFraction * height);
    xdotool("windowfocus", "--sync", windowId);
    xdotool("mousemove", "--sync", "--window", windowId, String(x), String(y));
    xdotool("mousedown", "1");
    await delay(80);
    xdotool("mouseup", "1");
    interaction = `xdotool clicked ${clickDescription} at window coordinates (${x}, ${y}) in ${windowId}`;
  } else if (process.platform === "darwin") {
    const swiftPath = join(workDirectory, "openobsidian-native-control-click.swift");
    await writeFile(swiftPath, `import AppKit
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3,
      let xFraction = Double(CommandLine.arguments[1]),
      let yFraction = Double(CommandLine.arguments[2]) else {
    fatalError("Expected desktop OCR click fractions")
}
guard NSScreen.screens.count == 1 else {
    fatalError("Desktop OCR click mapping requires the single-display macOS CI screen")
}
let displayBounds = CGDisplayBounds(CGMainDisplayID())
guard displayBounds.width > 0, displayBounds.height > 0 else {
    fatalError("Could not read the main macOS display bounds in Quartz coordinates")
}
guard (0.0...1.0).contains(xFraction), (0.0...1.0).contains(yFraction) else {
    fatalError("Desktop OCR click fractions fall outside the single-display screenshot")
}
let point = CGPoint(
    x: displayBounds.origin.x + CGFloat(xFraction) * displayBounds.width,
    y: displayBounds.origin.y + CGFloat(yFraction) * displayBounds.height
)
for type in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else {
        fatalError("Could not create a mouse event")
    }
    event.post(tap: .cghidEventTap)
    if type == .leftMouseDown { Thread.sleep(forTimeInterval: 0.08) }
}
print("\(point.x),\(point.y)")
`);
    const quartzPoint = execFileSync("swift", [swiftPath, String(xFraction), String(yFraction)], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
    interaction = `CoreGraphics clicked ${clickDescription} at desktop fractions (${xFraction}, ${yFraction}), mapped to Quartz screen coordinates (${quartzPoint})`;
  } else if (process.platform === "win32") {
    const geometry = capture.windowGeometry?.match(/x=(-?\d+) y=(-?\d+) width=(\d+) height=(\d+)/);
    if (!geometry) throw new Error(`Could not read OpenObsidian window geometry for OCR click: ${capture.windowGeometry ?? "unavailable"}`);
    const [, xText, yText, widthText, heightText] = geometry;
    const x = Math.round(Number(xText) + xFraction * Number(widthText));
    const y = Math.round(Number(yText) + yFraction * Number(heightText));
    const script = `
      $ErrorActionPreference = "Stop"
      Add-Type -TypeDefinition @'
        using System;
        using System.Runtime.InteropServices;
        public static class OpenObsidianOcrControlClick {
          [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
          [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
        }
'@
      if (-not [OpenObsidianOcrControlClick]::SetCursorPos(${x}, ${y})) { throw "Could not move the pointer to the OCR matched control" }
      Start-Sleep -Milliseconds 80
      [OpenObsidianOcrControlClick]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 60
      [OpenObsidianOcrControlClick]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
      Write-Output "Clicked OCR matched control at (${x}, ${y})."
    `;
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
    interaction = `${output} ${clickDescription}`;
  } else {
    throw new Error(`OCR control activation is not configured for ${process.platform}`);
  }
  return `Visible OCR fallback after accessibility failure ${JSON.stringify(accessibilityFailure)}; ${interaction}; screenshot=${relative(reportDirectory, capture.windowPngPath)}`;
}

async function invokeNativeAccessibleControl(
  child: ChildProcess,
  windowId: string,
  controlName: string,
  fallbackAnchorPhrase?: string,
  waitUntilEnabled = false,
): Promise<string> {
  const processId = child.pid;
  if (!processId) throw new Error("OpenObsidian did not expose its process id for native accessibility automation");

  if (controlName === "Refresh note list" && waitUntilEnabled && process.platform !== "win32") {
    return await clickVisibleOpenObsidianControl(
      child,
      windowId,
      controlName,
      `${process.platform} accessibility does not expose the egui refresh control`,
      fallbackAnchorPhrase,
    );
  }

  if (controlName === "Preview note creation" && waitUntilEnabled && process.platform === "linux") {
    return await clickLinuxCanvasNotePreviewFromCiGeometry(windowId);
  }

  if (controlName === "Preview note creation" && waitUntilEnabled && process.platform === "darwin") {
    return await clickMacOsCanvasNotePreviewFromCiGeometry(child);
  }

  const canvasTextEditAction = controlName === "Load Canvas text card"
    ? "load"
    : controlName === "Save Canvas text"
      ? "save"
      : null;
  if (canvasTextEditAction && waitUntilEnabled && process.platform === "linux") {
    return await clickLinuxCanvasTextEditButtonFromCiGeometry(windowId, canvasTextEditAction);
  }
  if (canvasTextEditAction && waitUntilEnabled && process.platform === "darwin") {
    return await clickMacOsCanvasTextEditButtonFromCiGeometry(child, canvasTextEditAction);
  }

  const canvasNoteAction = controlName === "Review and confirm note creation"
    ? "review"
    : controlName === "Confirm and create note"
      ? "confirm"
      : null;
  if (canvasNoteAction && waitUntilEnabled && process.platform === "linux") {
    return await clickLinuxCanvasNoteReviewOrConfirmFromCiGeometry(windowId, canvasNoteAction);
  }
  if (canvasNoteAction && waitUntilEnabled && process.platform === "darwin") {
    return await clickMacOsCanvasNoteReviewOrConfirmFromCiGeometry(child, canvasNoteAction);
  }

  if (process.platform === "linux") {
    const script = `
import json
import sys
import time
import pyatspi

process_id = int(sys.argv[1])
target_name = sys.argv[2]
deadline = time.monotonic() + 5
last_names = []
while time.monotonic() < deadline:
    desktop = pyatspi.Registry.getDesktop(0)
    pending = [desktop]
    seen = set()
    while pending:
        accessible = pending.pop()
        try:
            name = accessible.getName() or ""
            role = accessible.getRoleName() or ""
            try:
                owner_pid = accessible.get_process_id()
            except Exception:
                owner_pid = None
            if owner_pid == process_id and name:
                last_names.append({"name": name, "role": role})
                if name == target_name:
                    actions = accessible.queryAction()
                    for index in range(actions.nActions):
                        action_name = actions.getName(index)
                        if action_name.lower() in ("click", "press", "activate", "open"):
                            actions.doAction(index)
                            print(json.dumps({"name": name, "role": role, "action": action_name}))
                            sys.exit(0)
                    raise RuntimeError("target control exposes no click/press/activate action")
            child_count = accessible.getChildCount()
            for index in range(child_count):
                child_accessible = accessible.getChildAtIndex(index)
                try:
                    identity = child_accessible.get_hash()
                except Exception:
                    identity = id(child_accessible)
                if identity not in seen:
                    seen.add(identity)
                    pending.append(child_accessible)
        except RuntimeError:
            raise
        except Exception:
            continue
    time.sleep(0.25)
print(json.dumps({"error": "accessible control was not found", "target": target_name, "process_id": process_id, "visible_names": last_names[-80:]}), file=sys.stderr)
sys.exit(1)
`;
    try {
      return execFileSync("python3", ["-c", script, String(processId), controlName], {
        encoding: "utf8",
        env: {...process.env, OPENOBSIDIAN_WINDOW_PROCESS_ID: String(processId)},
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {stderr?: Buffer | string; stdout?: Buffer | string};
      const output = [failure.stdout, failure.stderr].filter(Boolean).map(String).join("\n").trim();
      return await clickVisibleOpenObsidianControl(child, windowId, controlName, `Linux AT-SPI: ${output || failure.message}`, fallbackAnchorPhrase);
    }
  }

  if (process.platform === "darwin") {
    const script = `on run argv
      set processId to (item 1 of argv) as integer
      set targetName to item 2 of argv
      tell application "System Events"
        set targetProcess to first process whose unix id is processId
        set frontmost of targetProcess to true
        set visibleNames to {}
        repeat with candidate in entire contents of window 1 of targetProcess
          try
            set candidateName to name of candidate as text
            set candidateRole to role of candidate as text
            if candidateName is not "" then set end of visibleNames to candidateRole & ":" & candidateName
            if candidateName is targetName then
              try
                perform action "AXPress" of candidate
                return "AXPress|" & candidateRole & "|" & candidateName
              on error pressError
                try
                  click candidate
                  return "click|" & candidateRole & "|" & candidateName & "|" & pressError
                on error clickError
                  error "Found " & candidateRole & " " & candidateName & " but activation failed: " & pressError & "; " & clickError
                end try
              end try
            end if
          end try
        end repeat
        error "Accessible control not found: " & targetName & "; observed=" & (visibleNames as text)
      end tell
    end run`;
    try {
      return execFileSync("osascript", ["-e", script, String(processId), controlName], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {stderr?: Buffer | string; stdout?: Buffer | string};
      const output = [failure.stdout, failure.stderr].filter(Boolean).map(String).join("\n").trim();
      return await clickVisibleOpenObsidianControl(child, windowId, controlName, `macOS Accessibility: ${output || failure.message}`, fallbackAnchorPhrase);
    }
  }

  if (process.platform === "win32") {
    const script = `
      $ErrorActionPreference = "Stop"
      Add-Type -AssemblyName UIAutomationClient
      Add-Type -AssemblyName UIAutomationTypes
      $processId = [int]$env:OPENOBSIDIAN_WINDOW_PROCESS_ID
      $targetName = $env:OPENOBSIDIAN_ACCESSIBLE_CONTROL_NAME
      $root = [System.Windows.Automation.AutomationElement]::RootElement
      $processCondition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
        $processId
      )
      $visibleNames = @()
      $waitForEnabled = $env:OPENOBSIDIAN_WAIT_FOR_ENABLED_CONTROL -eq "1"
      $deadline = [DateTime]::UtcNow.AddSeconds(30)
      do {
        $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $processCondition)
        foreach ($element in $elements) {
          try {
            $current = $element.Current
            if ($current.Name) { $visibleNames += "$($current.ControlType.ProgrammaticName):$($current.Name)" }
            if ($current.Name -ne $targetName) { continue }
            $enabledBeforeActivation = [bool]$current.IsEnabled
            if ($waitForEnabled -and -not $enabledBeforeActivation) { continue }
            try {
              $element.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern).ScrollIntoView()
            } catch {}
            $method = $null
            try {
              $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
              $method = "InvokePattern.Invoke"
            } catch {
              try {
                $toggle = $element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
                if ($toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::Off) {
                  $toggle.Toggle()
                  $method = "TogglePattern.Toggle"
                }
              } catch {}
            }
            if (-not $method) {
              try {
                $expand = $element.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
                if ($expand.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed) {
                  $expand.Expand()
                  $method = "ExpandCollapsePattern.Expand"
                }
              } catch {}
            }
            if (-not $method) {
              try {
                $element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
                $method = "SelectionItemPattern.Select"
              } catch {}
            }
            if (-not $method) { throw "Control was found but exposes no usable UI Automation activation pattern" }
            $enabledAfterActivation = $null
            try { $enabledAfterActivation = [bool]$element.Current.IsEnabled } catch {}
            [pscustomobject]@{
              name = $current.Name
              control_type = $current.ControlType.ProgrammaticName
              action = $method
              is_enabled = $enabledBeforeActivation
              is_enabled_before_activation = $enabledBeforeActivation
              is_enabled_after_activation = $enabledAfterActivation
              is_offscreen = [bool]$current.IsOffscreen
            } | ConvertTo-Json -Compress
            exit 0
          } catch {
            if ($_.Exception.Message -like "Control was found*") { throw }
          }
        }
        if (-not $waitForEnabled) { break }
        if ([DateTime]::UtcNow -ge $deadline) {
          throw "Timed out waiting for enabled control: $targetName; observed=$($visibleNames -join ' | ')"
        }
        Start-Sleep -Milliseconds 250
      } while ($true)
      throw "Accessible control not found: $targetName; observed=$($visibleNames -join ' | ')"
    `;
    try {
      return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
        encoding: "utf8",
        env: {
          ...process.env,
          OPENOBSIDIAN_WINDOW_PROCESS_ID: String(processId),
          OPENOBSIDIAN_ACCESSIBLE_CONTROL_NAME: controlName,
          OPENOBSIDIAN_WAIT_FOR_ENABLED_CONTROL: waitUntilEnabled ? "1" : "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {stderr?: Buffer | string; stdout?: Buffer | string};
      const output = [failure.stdout, failure.stderr].filter(Boolean).map(String).join("\n").trim();
      if (waitUntilEnabled && output.includes("Timed out waiting for enabled control")) throw new Error(output);
      return await clickVisibleOpenObsidianControl(child, windowId, controlName, `Windows UI Automation: ${output || failure.message}`, fallbackAnchorPhrase);
    }
  }

  throw new Error(`Native accessibility automation is not configured for ${process.platform}`);
}

async function runReferenceSourcePreview(
  child: ChildProcess,
  window: {window_id: string},
  appDataRoot: string,
  vaultBaseline: SnapshotEntry[],
): Promise<void> {
  const open = report.openobsidian_open as Record<string, unknown>;
  const previewReport: Record<string, unknown> = {
    status: "in_progress",
    selected_note_path: seedMarkdownPath,
    expected_source_sha256: vaultBaseline.find((entry) => entry.path === seedMarkdownPath)?.sha256 ?? null,
    expected_source_marker: "Original bytes stay untouched.",
  };
  open.source_preview = previewReport;

  const vaultBefore = await snapshotTree(vaultRoot);
  ensureExactSnapshot(vaultBaseline, vaultBefore, "OpenObsidian vault before reference source preview");
  const appDataBefore = await snapshotTree(appDataRoot);
  const canonicalVaultRoot = await realpath(vaultRoot);
  const canonicalAppDataRoot = await realpath(appDataRoot);
  const forbiddenPersistencePaths = [vaultRoot, canonicalVaultRoot, appDataRoot, canonicalAppDataRoot];
  previewReport.vault_snapshot_before = vaultBefore;
  previewReport.app_data_snapshot_before = appDataBefore;
  previewReport.app_data_change_policy = "App data remains byte-identical except macOS app.ron eframe window/egui UI-state persistence, which is inspected for vault and app-data paths.";

  previewReport.expand_preview_action = await invokeNativeAccessibleControl(child, window.window_id, "Note source preview");
  await delay(500);
  previewReport.read_source_action = await invokeNativeAccessibleControl(child, window.window_id, "Read note source preview");

  const visiblePreview = await waitFor("OpenObsidian to display the selected reference source", async () => {
    await delay(350);
    const capture = await withSourcePaneOcr(await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-source-preview"));
    previewReport.preview_screen_ocr = capture.ocrText.slice(0, 4_000);
    previewReport.preview_source_pane_ocr = capture.sourcePaneOcrText.slice(0, 4_000);
    previewReport.preview_source_pane_crop = capture.sourcePaneOcrCropPath
      ? relative(reportDirectory, capture.sourcePaneOcrCropPath)
      : null;
    previewReport.preview_source_pane_crop_bounds = capture.sourcePaneOcrCropBounds;
    return capture;
  }, (capture) => ocrTextContainsFuzzyPhraseAcrossLines(capture.sourcePaneOcrText, "Original bytes stay untouched", 1), 30_000);
  previewReport.preview_screenshot = relative(reportDirectory, visiblePreview.pngPath);
  previewReport.preview_window_screenshot = relative(reportDirectory, visiblePreview.windowPngPath);
  previewReport.source_marker_visible = ocrTextContainsFuzzyPhraseAcrossLines(visiblePreview.sourcePaneOcrText, "Original bytes stay untouched", 1);

  const vaultAfterPreview = await snapshotTree(vaultRoot);
  const appDataAfterPreview = await snapshotTree(appDataRoot);
  const vaultChangesAfterPreview = changedPaths(vaultBefore, vaultAfterPreview);
  const appDataChangesAfterPreview = changedPaths(appDataBefore, appDataAfterPreview);
  const eframeFilesAfterPreview = await readSnapshotTextFiles(appDataRoot, appDataAfterPreview, (path) => path.toLowerCase().endsWith(".ron"));
  previewReport.vault_snapshot_after_preview = vaultAfterPreview;
  previewReport.app_data_snapshot_after_preview = appDataAfterPreview;
  previewReport.vault_changes_after_preview = vaultChangesAfterPreview;
  previewReport.app_data_changes_after_preview = appDataChangesAfterPreview;
  previewReport.eframe_persistence_files_after_preview = eframeFilesAfterPreview;
  previewReport.vault_unchanged_after_preview = vaultChangesAfterPreview.length === 0;
  previewReport.app_data_unchanged_after_preview = appDataChangesAfterPreview.length === 0;
  await saveReport();
  ensureExactSnapshot(vaultBefore, vaultAfterPreview, "OpenObsidian reference source preview");
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataChangesAfterPreview,
    eframeFilesAfterPreview,
    "OpenObsidian app data during reference source preview",
    forbiddenPersistencePaths,
  );
  previewReport.app_data_change_policy_passed_after_preview = true;

  previewReport.close_preview_action = await invokeNativeAccessibleControl(
    child,
    window.window_id,
    "Close source preview",
    process.platform === "linux" ? "Note source preview" : "Source Nested",
  );
  const closedPreview = await waitFor("OpenObsidian to close the reference source preview", async () => {
    await delay(350);
    const capture = await withSourcePaneOcr(await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-source-preview-closed"));
    previewReport.closed_screen_ocr = capture.ocrText.slice(0, 4_000);
    return capture;
  }, (capture) => !capture.sourcePaneLabelVisible
    && !ocrTextContainsFuzzyPhraseAcrossLines(capture.ocrText, "Original bytes stay untouched", 1), 30_000);
  previewReport.closed_screenshot = relative(reportDirectory, closedPreview.pngPath);
  previewReport.preview_closed = true;

  const vaultAfterClose = await snapshotTree(vaultRoot);
  const appDataAfterClose = await snapshotTree(appDataRoot);
  const vaultChangesAfterClose = changedPaths(vaultBefore, vaultAfterClose);
  const appDataChangesAfterClose = changedPaths(appDataBefore, appDataAfterClose);
  const eframeFilesAfterClose = await readSnapshotTextFiles(appDataRoot, appDataAfterClose, (path) => path.toLowerCase().endsWith(".ron"));
  previewReport.vault_snapshot_after_close = vaultAfterClose;
  previewReport.app_data_snapshot_after_close = appDataAfterClose;
  previewReport.vault_changes_after_close = vaultChangesAfterClose;
  previewReport.app_data_changes_after_close = appDataChangesAfterClose;
  previewReport.eframe_persistence_files_after_close = eframeFilesAfterClose;
  previewReport.vault_unchanged_after_close = vaultChangesAfterClose.length === 0;
  previewReport.app_data_unchanged_after_close = appDataChangesAfterClose.length === 0;
  await saveReport();
  ensureExactSnapshot(vaultBefore, vaultAfterClose, "OpenObsidian reference preview close");
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataChangesAfterClose,
    eframeFilesAfterClose,
    "OpenObsidian app data after reference preview close",
    forbiddenPersistencePaths,
  );
  previewReport.app_data_change_policy_passed_after_close = true;
  previewReport.status = "passed";
  await saveReport();
}

async function selectFirstNoteWithPreviousButton(
  child: ChildProcess,
  windowId: string,
  targetPath: string,
  sortedNotePaths: string[],
): Promise<string> {
  if (sortedNotePaths[0] !== targetPath) {
    throw new Error(`Previous-note selector fallback requires ${targetPath} to sort first; actual paths=${JSON.stringify(sortedNotePaths)}`);
  }
  if (process.platform === "linux" || process.platform === "darwin") {
    if (sortedNotePaths[1] !== seedMarkdownPath) {
      throw new Error(`Previous-note selector fallback requires ${seedMarkdownPath} to be immediately after ${targetPath}; actual paths=${JSON.stringify(sortedNotePaths)}`);
    }
    return await invokeNativeAccessibleControl(child, windowId, "Previous note", "Nested");
  }
  if (process.platform === "win32") {
    const script = `
      $ErrorActionPreference = "Stop"
      $shell = New-Object -ComObject WScript.Shell
      if (-not $shell.AppActivate(${child.pid ?? -1})) { throw "Could not focus OpenObsidian before keyboard inspector selection" }
      Start-Sleep -Milliseconds 100
      $shell.SendKeys("{HOME}")
      Start-Sleep -Milliseconds 100
      $shell.SendKeys("{ENTER}")
      Write-Output "Keyboard selected the first inspector menu option (${targetPath}) with Home and Enter."
    `;
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }
  throw new Error(`Keyboard inspector selection is not configured for ${process.platform}`);
}

async function clickLinuxNoteNavigationButtonFromCiGeometry(
  windowId: string,
  direction: "previous" | "next",
): Promise<string> {
  const controlName = direction === "previous" ? "Previous note" : "Next note";
  const diagnosticPrefix = `OpenObsidian CI ${direction}-note input:`;
  const bounds = await readOpenObsidianCiButtonBounds(controlName, diagnosticPrefix);
  const x = Math.round(((bounds.left + bounds.right) / 2) * bounds.pixelsPerPoint);
  const y = Math.round(((bounds.top + bounds.bottom) / 2) * bounds.pixelsPerPoint);
  xdotool("windowfocus", "--sync", windowId);
  xdotool("mousemove", "--sync", "--window", windowId, String(x), String(y));
  xdotool("mousedown", "1");
  await delay(80);
  xdotool("mouseup", "1");
  return `xdotool clicked ${controlName} from CI response geometry at window coordinates (${x}, ${y}); ${bounds.diagnostic}`;
}

async function clickMacOsNoteNavigationButtonFromCiGeometry(
  child: ChildProcess,
  direction: "previous" | "next",
): Promise<string> {
  await focusOpenObsidian(child);
  const window = macOSOpenObsidianWindowBounds(child);
  const macOSRunnerTitlebarHeightPoints = 32;
  await postMacOsPointerEvent(window.x + 5, window.y + macOSRunnerTitlebarHeightPoints + 5, false);
  const controlName = direction === "previous" ? "Previous note" : "Next note";
  const diagnosticPrefix = `OpenObsidian CI ${direction}-note input:`;
  const bounds = await readOpenObsidianCiButtonBounds(controlName, diagnosticPrefix);
  const x = Math.round(window.x + (bounds.left + bounds.right) / 2);
  const y = Math.round(window.y + macOSRunnerTitlebarHeightPoints + (bounds.top + bounds.bottom) / 2);
  await postMacOsPointerEvent(x, y, true);
  return `CoreGraphics clicked ${controlName} at screen point (${x}, ${y}) from egui response geometry; window=${JSON.stringify(window)}; ${bounds.diagnostic}`;
}

async function clickLinuxResolveButtonFromCiGeometry(windowId: string, authoredNotePath: string): Promise<string> {
  xdotool("windowfocus", "--sync", windowId);
  xdotool("mousemove", "--sync", "--window", windowId, "1", "1");
  const bounds = await readOpenObsidianCiButtonBounds(
    "Resolve link status",
    "OpenObsidian CI resolve-link-status input:",
    authoredNotePath,
  );
  const x = Math.round(((bounds.left + bounds.right) / 2) * bounds.pixelsPerPoint);
  const y = Math.round(((bounds.top + bounds.bottom) / 2) * bounds.pixelsPerPoint);
  xdotool("mousemove", "--sync", "--window", windowId, String(x), String(y));
  xdotool("mousedown", "1");
  await delay(80);
  xdotool("mouseup", "1");
  return `xdotool clicked Resolve link status from CI response geometry at window coordinates (${x}, ${y}); ${bounds.diagnostic}`;
}

async function readOpenObsidianCiButtonBounds(
  controlName: string,
  diagnosticPrefix: string,
  expectedSelectedPath?: string,
  diagnosticLogPath = join(reportDirectory, "openobsidian.log"),
  afterLineCount?: number,
): Promise<{diagnostic: string; left: number; top: number; right: number; bottom: number; pixelsPerPoint: number}> {
  const relevantLines = (lines: string[]) => lines
    .filter((line) => line.trim().length > 0)
    .slice(afterLineCount ?? 0);
  const diagnosticLines = await waitFor(
    `OpenObsidian to report the enabled ${controlName} button bounds`,
    async () => (await readFile(diagnosticLogPath, "utf8").catch(() => "")).split(/\r?\n/),
    (lines) => relevantLines(lines).some((line) => line.startsWith(diagnosticPrefix)
      && line.includes("enabled=true")
      && line.includes("pixels_per_point=")
      && (expectedSelectedPath === undefined || line.includes(`selected=${expectedSelectedPath}`))),
    5_000,
  );
  const diagnostic = [...relevantLines(diagnosticLines)].reverse().find((line) => (
    line.startsWith(diagnosticPrefix)
    && line.includes("enabled=true")
    && line.includes("pixels_per_point=")
    && (expectedSelectedPath === undefined || line.includes(`selected=${expectedSelectedPath}`))
  ));
  const geometry = diagnostic?.match(/response_rect=\[\[(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\]\s+-\s+\[(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\]\], pixels_per_point=(\d+(?:\.\d+)?)/);
  if (!diagnostic || !geometry) {
    throw new Error(`OpenObsidian did not report usable ${controlName} button bounds: ${diagnostic ?? "missing diagnostic"}`);
  }
  const bounds = {
    diagnostic,
    left: Number(geometry[1]),
    top: Number(geometry[2]),
    right: Number(geometry[3]),
    bottom: Number(geometry[4]),
    pixelsPerPoint: Number(geometry[5]),
  };
  if (!(bounds.pixelsPerPoint > 0) || !(bounds.right > bounds.left) || !(bounds.bottom > bounds.top)) {
    throw new Error(`OpenObsidian reported invalid ${controlName} button geometry: ${diagnostic}`);
  }
  return bounds;
}

async function clickLinuxCanvasNotePreviewFromCiGeometry(windowId: string): Promise<string> {
  const controlName = "Preview note creation";
  const diagnosticPrefix = "OpenObsidian CI canvas-note-preview input:";
  const diagnosticLogPath = join(reportDirectory, "openobsidian-canvas-note-create.log");
  xdotool("windowfocus", "--sync", windowId);
  const afterLineCount = (await readFile(diagnosticLogPath, "utf8").catch(() => ""))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length;
  xdotool("mousemove", "--sync", "--window", windowId, "1", "1");
  const bounds = await readOpenObsidianCiButtonBounds(
    controlName,
    diagnosticPrefix,
    undefined,
    diagnosticLogPath,
    afterLineCount,
  );
  const x = Math.round(((bounds.left + bounds.right) / 2) * bounds.pixelsPerPoint);
  const y = Math.round(((bounds.top + bounds.bottom) / 2) * bounds.pixelsPerPoint);
  xdotool("mousemove", "--sync", "--window", windowId, String(x), String(y));
  xdotool("mousedown", "1");
  await delay(80);
  xdotool("mouseup", "1");
  return `xdotool clicked ${controlName} from CI response geometry at window coordinates (${x}, ${y}); ${bounds.diagnostic}`;
}

async function clickMacOsCanvasNotePreviewFromCiGeometry(child: ChildProcess): Promise<string> {
  await focusOpenObsidian(child);
  const window = macOSOpenObsidianWindowBounds(child);
  const macOSRunnerTitlebarHeightPoints = 32;
  const controlName = "Preview note creation";
  const diagnosticPrefix = "OpenObsidian CI canvas-note-preview input:";
  const diagnosticLogPath = join(reportDirectory, "openobsidian-canvas-note-create.log");
  const afterLineCount = (await readFile(diagnosticLogPath, "utf8").catch(() => ""))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length;
  await postMacOsPointerEvent(window.x + 5, window.y + macOSRunnerTitlebarHeightPoints + 5, false);
  const bounds = await readOpenObsidianCiButtonBounds(
    controlName,
    diagnosticPrefix,
    undefined,
    diagnosticLogPath,
    afterLineCount,
  );
  const x = Math.round(window.x + (bounds.left + bounds.right) / 2);
  const y = Math.round(window.y + macOSRunnerTitlebarHeightPoints + (bounds.top + bounds.bottom) / 2);
  await postMacOsPointerEvent(x, y, true);
  return `CoreGraphics clicked ${controlName} at screen point (${x}, ${y}) from egui response geometry; window=${JSON.stringify(window)}; ${bounds.diagnostic}`;
}

async function clickLinuxCanvasTextEditButtonFromCiGeometry(
  windowId: string,
  action: "load" | "save",
): Promise<string> {
  const controlName = action === "load" ? "Load Canvas text card" : "Save Canvas text";
  const diagnosticPrefix = `OpenObsidian CI canvas-text-edit-${action} input:`;
  const diagnosticLogPath = join(reportDirectory, "openobsidian-canvas-text-edit.log");
  xdotool("windowfocus", "--sync", windowId);
  const afterLineCount = (await readFile(diagnosticLogPath, "utf8").catch(() => ""))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length;
  xdotool("mousemove", "--sync", "--window", windowId, "1", "1");
  const bounds = await readOpenObsidianCiButtonBounds(
    controlName,
    diagnosticPrefix,
    undefined,
    diagnosticLogPath,
    afterLineCount,
  );
  const x = Math.round(((bounds.left + bounds.right) / 2) * bounds.pixelsPerPoint);
  const y = Math.round(((bounds.top + bounds.bottom) / 2) * bounds.pixelsPerPoint);
  xdotool("mousemove", "--sync", "--window", windowId, String(x), String(y));
  xdotool("mousedown", "1");
  await delay(80);
  xdotool("mouseup", "1");
  return `xdotool clicked ${controlName} from CI response geometry at window coordinates (${x}, ${y}); ${bounds.diagnostic}`;
}

async function clickMacOsCanvasTextEditButtonFromCiGeometry(
  child: ChildProcess,
  action: "load" | "save",
): Promise<string> {
  await focusOpenObsidian(child);
  const window = macOSOpenObsidianWindowBounds(child);
  const macOSRunnerTitlebarHeightPoints = 32;
  const controlName = action === "load" ? "Load Canvas text card" : "Save Canvas text";
  const diagnosticPrefix = `OpenObsidian CI canvas-text-edit-${action} input:`;
  const diagnosticLogPath = join(reportDirectory, "openobsidian-canvas-text-edit.log");
  const afterLineCount = (await readFile(diagnosticLogPath, "utf8").catch(() => ""))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length;
  await postMacOsPointerEvent(window.x + 5, window.y + macOSRunnerTitlebarHeightPoints + 5, false);
  const bounds = await readOpenObsidianCiButtonBounds(
    controlName,
    diagnosticPrefix,
    undefined,
    diagnosticLogPath,
    afterLineCount,
  );
  const x = Math.round(window.x + (bounds.left + bounds.right) / 2);
  const y = Math.round(window.y + macOSRunnerTitlebarHeightPoints + (bounds.top + bounds.bottom) / 2);
  await postMacOsPointerEvent(x, y, true);
  return `CoreGraphics clicked ${controlName} at screen point (${x}, ${y}) from egui response geometry; window=${JSON.stringify(window)}; ${bounds.diagnostic}`;
}

async function clickLinuxCanvasNoteReviewOrConfirmFromCiGeometry(
  windowId: string,
  action: "review" | "confirm",
): Promise<string> {
  const controlName = action === "review" ? "Review and confirm note creation" : "Confirm and create note";
  const diagnosticPrefix = `OpenObsidian CI canvas-note-${action} input:`;
  const diagnosticLogPath = join(reportDirectory, "openobsidian-canvas-note-create.log");
  xdotool("windowfocus", "--sync", windowId);
  const afterLineCount = (await readFile(diagnosticLogPath, "utf8").catch(() => ""))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length;
  xdotool("mousemove", "--sync", "--window", windowId, "1", "1");
  const bounds = await readOpenObsidianCiButtonBounds(
    controlName,
    diagnosticPrefix,
    undefined,
    diagnosticLogPath,
    afterLineCount,
  );
  const x = Math.round(((bounds.left + bounds.right) / 2) * bounds.pixelsPerPoint);
  const y = Math.round(((bounds.top + bounds.bottom) / 2) * bounds.pixelsPerPoint);
  xdotool("mousemove", "--sync", "--window", windowId, String(x), String(y));
  xdotool("mousedown", "1");
  await delay(80);
  xdotool("mouseup", "1");
  return `xdotool clicked ${controlName} from CI response geometry at window coordinates (${x}, ${y}); ${bounds.diagnostic}`;
}

async function clickMacOsCanvasNoteReviewOrConfirmFromCiGeometry(
  child: ChildProcess,
  action: "review" | "confirm",
): Promise<string> {
  await focusOpenObsidian(child);
  const window = macOSOpenObsidianWindowBounds(child);
  const macOSRunnerTitlebarHeightPoints = 32;
  const controlName = action === "review" ? "Review and confirm note creation" : "Confirm and create note";
  const diagnosticPrefix = `OpenObsidian CI canvas-note-${action} input:`;
  const diagnosticLogPath = join(reportDirectory, "openobsidian-canvas-note-create.log");
  const afterLineCount = (await readFile(diagnosticLogPath, "utf8").catch(() => ""))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length;
  await postMacOsPointerEvent(window.x + 5, window.y + macOSRunnerTitlebarHeightPoints + 5, false);
  const bounds = await readOpenObsidianCiButtonBounds(
    controlName,
    diagnosticPrefix,
    undefined,
    diagnosticLogPath,
    afterLineCount,
  );
  const x = Math.round(window.x + (bounds.left + bounds.right) / 2);
  const y = Math.round(window.y + macOSRunnerTitlebarHeightPoints + (bounds.top + bounds.bottom) / 2);
  await postMacOsPointerEvent(x, y, true);
  return `CoreGraphics clicked ${controlName} at screen point (${x}, ${y}) from egui response geometry; window=${JSON.stringify(window)}; ${bounds.diagnostic}`;
}

async function clickMacOsResolveButtonFromCiGeometry(child: ChildProcess, authoredNotePath: string): Promise<string> {
  await focusOpenObsidian(child);
  const window = macOSOpenObsidianWindowBounds(child);
  // Move the pointer once so egui emits fresh bounds for the newly selected note.
  const macOSRunnerTitlebarHeightPoints = 32;
  await postMacOsPointerEvent(window.x + 5, window.y + macOSRunnerTitlebarHeightPoints + 5, false);
  const diagnosticPrefix = "OpenObsidian CI resolve-link-status input:";
  const bounds = await readOpenObsidianCiButtonBounds("Resolve link status", diagnosticPrefix, authoredNotePath);
  const x = Math.round(window.x + (bounds.left + bounds.right) / 2);
  // egui coordinates start below the macOS title bar; AppKit/CGEvent coordinates are screen points.
  const y = Math.round(window.y + macOSRunnerTitlebarHeightPoints + (bounds.top + bounds.bottom) / 2);
  await postMacOsPointerEvent(x, y, true);
  return `CoreGraphics clicked Resolve link status at screen point (${x}, ${y}) from egui response geometry; window=${JSON.stringify(window)}; ${bounds.diagnostic}`;
}

async function postMacOsPointerEvent(x: number, y: number, click: boolean): Promise<void> {
  const swiftPath = join(workDirectory, "openobsidian-native-control-click.swift");
  const eventTypes = click ? "[CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp]" : "[CGEventType.mouseMoved]";
  await writeFile(swiftPath, `import AppKit
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3,
      let x = Double(CommandLine.arguments[1]),
      let y = Double(CommandLine.arguments[2]) else {
    fatalError("Expected screen x and y coordinates")
}
let point = CGPoint(x: x, y: y)
for type in ${eventTypes} {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else {
        fatalError("Could not create mouse event")
    }
    event.post(tap: .cghidEventTap)
    if type == .leftMouseDown { Thread.sleep(forTimeInterval: 0.08) }
}
`);
  execFileSync("swift", [swiftPath, String(x), String(y)], {stdio: "ignore"});
}

async function selectReferenceNoteForEmbedResolution(
  child: ChildProcess,
  windowId: string,
  currentPath: string,
  targetPath: string,
  sortedNotePaths: string[],
): Promise<Record<string, unknown>> {
  const currentIndex = sortedNotePaths.indexOf(currentPath);
  const targetIndex = sortedNotePaths.indexOf(targetPath);
  if (currentIndex < 0 || targetIndex < 0) {
    throw new Error(`Reference note selection requires current and target paths in the refreshed list; current=${currentPath}, target=${targetPath}, paths=${JSON.stringify(sortedNotePaths)}`);
  }
  if (currentPath === targetPath) {
    throw new Error(`Reference image-embed resolution must switch notes before selecting ${targetPath}`);
  }

  if (process.platform === "win32") {
    const openMenuScreenshot = await captureOpenObsidianScreenshot(
      windowId,
      child,
      "openobsidian-authored-image-note-selector",
    );
    const selectionAction = await invokeNativeAccessibleControl(child, windowId, targetPath, undefined, true);
    if (!windowsSelectionConfirmsPath(selectionAction, targetPath)) {
      throw new Error(`Windows UI Automation did not confirm exact authored-note selection: ${selectionAction}`);
    }
    const dismissAction = await dismissWindowsNoteSelectorMenu(child, targetPath);
    if (!windowsSelectorDismissConfirmsClosed(dismissAction)) {
      throw new Error(`Windows UI Automation did not dismiss the selector after confirming ${targetPath}: ${dismissAction}`);
    }
    return {
      strategy: "windows_ui_automation_exact_path_from_expanded_selector",
      expanded_selector_screenshot: relative(reportDirectory, openMenuScreenshot.pngPath),
      target_path_visible_by_ocr: ocrTextContainsPhrase(openMenuScreenshot.ocrText, targetPath),
      selection_action: selectionAction,
      selector_dismiss_action: dismissAction,
      exact_selected_path: targetPath,
    };
  }

  const previousSteps = (currentIndex - targetIndex + sortedNotePaths.length) % sortedNotePaths.length;
  const nextSteps = (targetIndex - currentIndex + sortedNotePaths.length) % sortedNotePaths.length;
  const direction = previousSteps <= nextSteps ? "previous" : "next";
  const stepCount = Math.min(previousSteps, nextSteps);
  const selectedPaths: string[] = [];
  const actions: string[] = [];
  let selectedIndex = currentIndex;
  for (let step = 0; step < stepCount; step += 1) {
    const nextIndex = direction === "previous"
      ? (selectedIndex - 1 + sortedNotePaths.length) % sortedNotePaths.length
      : (selectedIndex + 1) % sortedNotePaths.length;
    const selectedPath = sortedNotePaths[nextIndex];
    if (!selectedPath) throw new Error(`Reference note navigation produced no path at index ${nextIndex}`);
    const source = `${direction}_button`;
    const navigationControl = direction === "previous" ? "Previous note" : "Next note";
    const navigationAction = process.platform === "linux"
      ? await clickLinuxNoteNavigationButtonFromCiGeometry(windowId, direction)
      : process.platform === "darwin"
      ? await clickMacOsNoteNavigationButtonFromCiGeometry(child, direction)
        : await invokeNativeAccessibleControl(
          child,
          windowId,
          navigationControl,
          sortedNotePaths[selectedIndex],
        );
    actions.push(navigationAction);
    const expectedLog = `OpenObsidian CI note navigation: source=${source}, selected=${selectedPath}`;
    const navigationLog = await waitFor(
      `OpenObsidian to select ${selectedPath} through the ${direction} note button`,
      async () => (await readFile(join(reportDirectory, "openobsidian.log"), "utf8").catch(() => "")).split(/\r?\n/),
      (lines) => lines.includes(expectedLog),
      15_000,
    );
    selectedPaths.push(navigationLog.find((line) => line === expectedLog) ?? "");
    selectedIndex = nextIndex;
  }
  if (sortedNotePaths[selectedIndex] !== targetPath) {
    throw new Error(`Reference note navigation stopped at ${sortedNotePaths[selectedIndex] ?? "<none>"}; expected ${targetPath}`);
  }
  return {
    strategy: `${direction}_button`,
    actions,
    selected_paths: selectedPaths,
    exact_selected_path: targetPath,
  };
}

async function runReferenceExternalNoteRefresh(
  child: ChildProcess,
  window: {window_id: string},
  appDataRoot: string,
  vaultBaseline: SnapshotEntry[],
): Promise<SnapshotEntry[]> {
  const open = report.openobsidian_open as Record<string, unknown>;
  const refreshReport: Record<string, unknown> = {
    status: "in_progress",
    note_path: externalRefreshMarkdownPath,
    note_bytes: externalRefreshMarkdownBytes.length,
    note_sha256: createHash("sha256").update(externalRefreshMarkdownBytes).digest("hex"),
    expected_source_marker: externalRefreshMarker,
  };
  open.external_note_refresh = refreshReport;

  const refreshRequestCountBeforeCreation = (await readOpenObsidianRefreshDiagnostics()).requests.length;
  const vaultBeforeCreation = await snapshotTree(vaultRoot);
  ensureExactSnapshot(vaultBaseline, vaultBeforeCreation, "OpenObsidian vault before deliberate external note creation");
  const appDataBeforeCreation = await snapshotTree(appDataRoot);
  await writeFile(join(vaultRoot, externalRefreshMarkdownPath), externalRefreshMarkdownBytes, {flag: "wx"});

  const vaultAfterCreation = await snapshotTree(vaultRoot);
  const changesFromExternalCreation = changedPaths(vaultBeforeCreation, vaultAfterCreation);
  const expectedNoteSha256 = createHash("sha256").update(externalRefreshMarkdownBytes).digest("hex");
  if (
    changesFromExternalCreation.length !== 1
    || changesFromExternalCreation[0]?.path !== externalRefreshMarkdownPath
    || changesFromExternalCreation[0]?.after?.kind !== "file"
    || changesFromExternalCreation[0]?.after?.bytes !== externalRefreshMarkdownBytes.length
    || changesFromExternalCreation[0]?.after?.sha256 !== expectedNoteSha256
  ) {
    throw new Error(`External note creation changed unexpected vault entries: ${JSON.stringify(changesFromExternalCreation).slice(0, 6_000)}`);
  }
  const expectedMarkdownCount = countMarkdownFiles(vaultAfterCreation);
  if (expectedMarkdownCount !== countMarkdownFiles(vaultBaseline) + 1) {
    throw new Error(`External note creation produced ${expectedMarkdownCount} Markdown files; expected exactly one additional note`);
  }
  const appDataAfterCreation = await snapshotTree(appDataRoot);
  ensureExactSnapshot(appDataBeforeCreation, appDataAfterCreation, "OpenObsidian app data during deliberate external note creation");
  refreshReport.vault_snapshot_before_creation = vaultBeforeCreation;
  refreshReport.vault_snapshot_after_creation = vaultAfterCreation;
  refreshReport.vault_changes_from_external_creation = changesFromExternalCreation;
  refreshReport.expected_markdown_count_after_refresh = expectedMarkdownCount;
  refreshReport.app_data_snapshot_before_creation = appDataBeforeCreation;
  refreshReport.app_data_snapshot_after_creation = appDataAfterCreation;
  refreshReport.app_data_unchanged_during_external_creation = true;
  const vaultSnapshots = report.vault_snapshots as Record<string, unknown>;
  vaultSnapshots.before_external_note_creation = vaultBeforeCreation;
  vaultSnapshots.after_external_note_creation = vaultAfterCreation;
  await writeFile(join(reportDirectory, "vault-after-external-note-creation.json"), `${JSON.stringify(vaultAfterCreation, null, 2)}\n`);
  await saveReport();

  if (process.platform !== "win32") await delay(2_000);
  const settledWatcherRefresh = await waitForOpenObsidianRefreshIdle(
    refreshRequestCountBeforeCreation,
    expectedMarkdownCount,
    false,
  );
  refreshReport.watcher_refresh_settled_before_manual = {
    settled_for_ms: settledWatcherRefresh.settled_for_ms,
    latest_receiver_busy: settledWatcherRefresh.receiverStates.at(-1)?.busy ?? false,
    latest_consumed_result: settledWatcherRefresh.consumedResults.at(-1) ?? null,
  };
  const refreshRequestCountBeforeManual = settledWatcherRefresh.requests.length;
  refreshReport.refresh_action = await clickManualRefreshUntilRequested(
    child,
    window.window_id,
    refreshRequestCountBeforeManual,
  );
  const settledManualRefresh = await waitForOpenObsidianRefreshIdle(
    refreshRequestCountBeforeManual,
    expectedMarkdownCount,
    true,
  );
  refreshReport.manual_refresh_diagnostics = {
    action_request: settledManualRefresh.requests.at(-1) ?? null,
    result: settledManualRefresh.consumedResults.at(-1) ?? null,
    receiver_busy_after_result: settledManualRefresh.receiverStates.at(-1)?.busy ?? false,
    settled_for_ms: settledManualRefresh.settled_for_ms,
  };
  const refreshedList = await waitFor("OpenObsidian to finish refreshing its note list after external creation", async () => {
    await delay(350);
    const capture = await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-after-external-note-refresh");
    refreshReport.refresh_screen_ocr = capture.ocrText.slice(0, 4_000);
    return capture;
  }, (capture) => ocrTextContainsRefreshedMarkdownCount(capture.ocrText, expectedMarkdownCount), 30_000);
  refreshReport.refreshed_list_screenshot = relative(reportDirectory, refreshedList.pngPath);
  refreshReport.refreshed_list_window_screenshot = relative(reportDirectory, refreshedList.windowPngPath);
  refreshReport.refreshed_markdown_count_visible = true;

  if (process.platform === "win32") {
    refreshReport.open_note_selector_action = await invokeNativeAccessibleControl(
      child,
      window.window_id,
      "Note to inspect",
      "Nested",
    );
    const visibleMenu = await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-external-note-selector");
    refreshReport.selector_menu_screen_ocr = visibleMenu.ocrText.slice(0, 4_000);
    refreshReport.selector_menu_screenshot = relative(reportDirectory, visibleMenu.pngPath);
  } else {
    const selectorBefore = await captureOpenObsidianScreenshot(
      window.window_id,
      child,
      "openobsidian-external-note-selector-before",
    );
    refreshReport.selector_before_screen_ocr = selectorBefore.ocrText.slice(0, 4_000);
    refreshReport.selector_before_screenshot = relative(reportDirectory, selectorBefore.pngPath);
  }
  const sortedNotePaths = vaultAfterCreation
    .filter((entry) => entry.kind === "file" && entry.path.toLowerCase().endsWith(".md"))
    .map((entry) => entry.path)
    .sort();
  if (process.platform === "linux" || process.platform === "darwin") {
    refreshReport.select_external_note_action = await selectFirstNoteWithPreviousButton(
      child,
      window.window_id,
      externalRefreshMarkdownPath,
      sortedNotePaths,
    );
  } else {
    refreshReport.select_external_note_action = await invokeNativeAccessibleControl(child, window.window_id, externalRefreshMarkdownPath);
  }
  refreshReport.external_note_visible_in_selector = true;
  const selectedByWindowsUiAutomation = process.platform === "win32"
    && windowsSelectionConfirmsPath(refreshReport.select_external_note_action, externalRefreshMarkdownPath);
  refreshReport.external_note_selected_by_exact_windows_uia = selectedByWindowsUiAutomation;
  let selectedByPreviousButton = false;
  if (process.platform === "linux" || process.platform === "darwin") {
    const expectedNavigationLog = `OpenObsidian CI note navigation: source=previous_button, selected=${externalRefreshMarkdownPath}`;
    const navigationLog = await waitFor(
      "OpenObsidian to apply the Previous note button selection",
      async () => (await readFile(join(reportDirectory, "openobsidian.log"), "utf8").catch(() => "")).split(/\r?\n/),
      (lines) => lines.includes(expectedNavigationLog),
      15_000,
    );
    refreshReport.previous_note_selection_diagnostic = navigationLog.find((line) => line === expectedNavigationLog);
    selectedByPreviousButton = true;
  }
  refreshReport.external_note_selected_by_previous_button = selectedByPreviousButton;
  const selectedNote = await waitFor("OpenObsidian to select the externally added note", async () => {
    await delay(350);
    const capture = await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-external-note-selected");
    refreshReport.selected_note_screen_ocr = capture.ocrText.slice(0, 4_000);
    return capture;
  }, (capture) => selectedByWindowsUiAutomation || selectedByPreviousButton
    || ocrTextContainsPhrase(capture.ocrText, externalRefreshMarkdownPath)
    || ocrTextContainsFuzzyPhrase(capture.ocrText, externalRefreshMarkdownPath), 15_000);
  refreshReport.selected_note_screenshot = relative(reportDirectory, selectedNote.pngPath);
  refreshReport.external_note_selected = true;

  refreshReport.read_source_action = await invokeNativeAccessibleControl(child, window.window_id, "Read note source preview");
  const visiblePreview = await waitFor("OpenObsidian to preview the externally added note source", async () => {
    await delay(350);
    const capture = await withSourcePaneOcr(await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-external-note-source-preview"));
    refreshReport.preview_screen_ocr = capture.ocrText.slice(0, 4_000);
    refreshReport.preview_source_pane_ocr = capture.sourcePaneOcrText.slice(0, 4_000);
    refreshReport.preview_source_pane_crop = capture.sourcePaneOcrCropPath
      ? relative(reportDirectory, capture.sourcePaneOcrCropPath)
      : null;
    refreshReport.preview_source_pane_crop_bounds = capture.sourcePaneOcrCropBounds;
    return capture;
  }, (capture) => ocrTextContainsFuzzyPhraseAcrossLines(capture.sourcePaneOcrText, externalRefreshMarker, 1), 30_000);
  refreshReport.preview_screenshot = relative(reportDirectory, visiblePreview.pngPath);
  refreshReport.preview_window_screenshot = relative(reportDirectory, visiblePreview.windowPngPath);
  refreshReport.external_source_marker_visible = true;

  const canonicalVaultRoot = await realpath(vaultRoot);
  const canonicalAppDataRoot = await realpath(appDataRoot);
  const forbiddenPersistencePaths = [vaultRoot, canonicalVaultRoot, appDataRoot, canonicalAppDataRoot];
  const vaultAfterPreview = await snapshotTree(vaultRoot);
  const appDataAfterPreview = await snapshotTree(appDataRoot);
  const vaultChangesAfterPreview = changedPaths(vaultAfterCreation, vaultAfterPreview);
  const appDataChangesAfterPreview = changedPaths(appDataAfterCreation, appDataAfterPreview);
  const eframeFilesAfterPreview = await readSnapshotTextFiles(appDataRoot, appDataAfterPreview, (path) => path.toLowerCase().endsWith(".ron"));
  refreshReport.vault_snapshot_after_preview = vaultAfterPreview;
  refreshReport.vault_changes_after_preview = vaultChangesAfterPreview;
  refreshReport.app_data_snapshot_after_preview = appDataAfterPreview;
  refreshReport.app_data_changes_after_preview = appDataChangesAfterPreview;
  refreshReport.eframe_persistence_files_after_preview = eframeFilesAfterPreview;
  await saveReport();
  ensureExactSnapshot(vaultAfterCreation, vaultAfterPreview, "OpenObsidian external note refresh and source preview");
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataChangesAfterPreview,
    eframeFilesAfterPreview,
    "OpenObsidian external note refresh and source preview app data",
    forbiddenPersistencePaths,
  );
  refreshReport.vault_unchanged_after_preview = true;
  refreshReport.app_data_change_policy_passed_after_preview = true;

  const originalSourceMarkerVisible = ocrTextContainsFuzzyPhraseAcrossLines(visiblePreview.sourcePaneOcrText, externalRefreshMarker, 1);
  const editReport: Record<string, unknown> = {
    status: "in_progress",
    note_path: externalRefreshMarkdownPath,
    previous_note_bytes: externalRefreshMarkdownBytes.length,
    previous_note_sha256: createHash("sha256").update(externalRefreshMarkdownBytes).digest("hex"),
    expected_note_bytes: externalEditedMarkdownBytes.length,
    expected_note_sha256: createHash("sha256").update(externalEditedMarkdownBytes).digest("hex"),
    expected_source_marker: externalEditedMarker,
    original_source_marker_visible_before_edit: originalSourceMarkerVisible,
    source_preview_open_before_edit: true,
  };
  refreshReport.external_in_place_edit = editReport;
  if (!originalSourceMarkerVisible) {
    throw new Error("OpenObsidian did not visibly preview the original note source before the deliberate external edit");
  }

  const settledRefreshBeforeEdit = await waitForOpenObsidianRefreshIdle(
    0,
    expectedMarkdownCount,
    false,
  );
  editReport.previous_refresh_settled_before_edit = {
    settled_for_ms: settledRefreshBeforeEdit.settled_for_ms,
    latest_receiver_busy: settledRefreshBeforeEdit.receiverStates.at(-1)?.busy ?? false,
    latest_consumed_result: settledRefreshBeforeEdit.consumedResults.at(-1) ?? null,
  };
  const refreshRequestCountBeforeEdit = settledRefreshBeforeEdit.requests.length;
  const vaultBeforeEdit = await snapshotTree(vaultRoot);
  ensureExactSnapshot(vaultAfterCreation, vaultBeforeEdit, "OpenObsidian vault before deliberate external note edit");
  const noteBeforeEdit = vaultBeforeEdit.find((entry) => entry.path === externalRefreshMarkdownPath && entry.kind === "file");
  const originalNoteSha256 = createHash("sha256").update(externalRefreshMarkdownBytes).digest("hex");
  if (
    !noteBeforeEdit
    || noteBeforeEdit.bytes !== externalRefreshMarkdownBytes.length
    || noteBeforeEdit.sha256 !== originalNoteSha256
  ) {
    throw new Error("The external note does not match the original source bytes before the in-place edit");
  }
  const appDataBeforeEdit = await snapshotTree(appDataRoot);
  await writeFile(join(vaultRoot, externalRefreshMarkdownPath), externalEditedMarkdownBytes);

  const vaultAfterEdit = await snapshotTree(vaultRoot);
  const changesFromExternalEdit = changedPaths(vaultBeforeEdit, vaultAfterEdit);
  const editedNoteSha256 = createHash("sha256").update(externalEditedMarkdownBytes).digest("hex");
  const editedNote = vaultAfterEdit.find((entry) => entry.path === externalRefreshMarkdownPath && entry.kind === "file");
  if (
    changesFromExternalEdit.length !== 1
    || changesFromExternalEdit[0]?.path !== externalRefreshMarkdownPath
    || changesFromExternalEdit[0]?.before?.sha256 !== originalNoteSha256
    || changesFromExternalEdit[0]?.after?.kind !== "file"
    || changesFromExternalEdit[0]?.after?.bytes !== externalEditedMarkdownBytes.length
    || changesFromExternalEdit[0]?.after?.sha256 !== editedNoteSha256
    || !editedNote
    || editedNote.bytes !== externalEditedMarkdownBytes.length
    || editedNote.sha256 !== editedNoteSha256
  ) {
    throw new Error("The deliberate external note edit did not change exactly the expected note bytes: " + JSON.stringify(changesFromExternalEdit).slice(0, 6_000));
  }
  const markdownCountAfterEdit = countMarkdownFiles(vaultAfterEdit);
  if (markdownCountAfterEdit !== expectedMarkdownCount) {
    throw new Error("The external in-place edit changed the Markdown file count from " + expectedMarkdownCount + " to " + markdownCountAfterEdit);
  }
  const appDataAfterEdit = await snapshotTree(appDataRoot);
  ensureExactSnapshot(appDataBeforeEdit, appDataAfterEdit, "OpenObsidian app data during deliberate external note edit");
  editReport.vault_snapshot_before_edit = vaultBeforeEdit;
  editReport.vault_snapshot_after_edit = vaultAfterEdit;
  editReport.vault_changes_from_external_edit = changesFromExternalEdit;
  editReport.markdown_count_before_edit = expectedMarkdownCount;
  editReport.markdown_count_after_edit = markdownCountAfterEdit;
  editReport.app_data_snapshot_before_edit = appDataBeforeEdit;
  editReport.app_data_snapshot_after_edit = appDataAfterEdit;
  editReport.app_data_unchanged_during_external_edit = true;
  vaultSnapshots.before_external_note_edit = vaultBeforeEdit;
  vaultSnapshots.after_external_note_edit = vaultAfterEdit;
  await writeFile(join(reportDirectory, "vault-after-external-note-edit.json"), JSON.stringify(vaultAfterEdit, null, 2) + "\n");
  await saveReport();

  if (process.platform !== "win32") await delay(2_000);
  const settledWatcherRefreshAfterEdit = await waitForOpenObsidianRefreshIdle(
    refreshRequestCountBeforeEdit,
    markdownCountAfterEdit,
    false,
  );
  editReport.watcher_refresh_settled_before_manual = {
    settled_for_ms: settledWatcherRefreshAfterEdit.settled_for_ms,
    latest_receiver_busy: settledWatcherRefreshAfterEdit.receiverStates.at(-1)?.busy ?? false,
    latest_consumed_result: settledWatcherRefreshAfterEdit.consumedResults.at(-1) ?? null,
  };
  const refreshRequestCountBeforeManualEdit = settledWatcherRefreshAfterEdit.requests.length;
  editReport.refresh_action = await clickManualRefreshUntilRequested(
    child,
    window.window_id,
    refreshRequestCountBeforeManualEdit,
  );
  const settledManualRefreshAfterEdit = await waitForOpenObsidianRefreshIdle(
    refreshRequestCountBeforeManualEdit,
    markdownCountAfterEdit,
    true,
  );
  editReport.manual_refresh_diagnostics = {
    action_request: settledManualRefreshAfterEdit.requests.at(-1) ?? null,
    result: settledManualRefreshAfterEdit.consumedResults.at(-1) ?? null,
    receiver_busy_after_result: settledManualRefreshAfterEdit.receiverStates.at(-1)?.busy ?? false,
    settled_for_ms: settledManualRefreshAfterEdit.settled_for_ms,
  };
  const editedRefresh = await waitFor(
    "OpenObsidian to clear the stale source preview after the external note edit",
    async () => {
      await delay(350);
      const capture = await withSourcePaneOcr(await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-after-external-note-edit-refresh"));
      editReport.refresh_screen_ocr = capture.ocrText.slice(0, 4_000);
      editReport.refresh_source_pane_ocr = capture.sourcePaneOcrText.slice(0, 4_000);
      editReport.refresh_source_pane_crop = capture.sourcePaneOcrCropPath
        ? relative(reportDirectory, capture.sourcePaneOcrCropPath)
        : null;
      editReport.refresh_source_pane_crop_bounds = capture.sourcePaneOcrCropBounds;
      return capture;
    },
    (capture) => (
      ocrTextContainsRefreshedMarkdownCount(capture.ocrText, markdownCountAfterEdit)
      && !capture.sourcePaneLabelVisible
      && !ocrTextContainsFuzzyPhraseAcrossLines(capture.ocrText, externalRefreshMarker, 1)
      && !ocrTextContainsFuzzyPhraseAcrossLines(capture.ocrText, externalEditedMarker, 1)
    ),
    30_000,
  );
  editReport.refresh_screenshot = relative(reportDirectory, editedRefresh.pngPath);
  editReport.refresh_window_screenshot = relative(reportDirectory, editedRefresh.windowPngPath);
  editReport.stale_source_marker_absent_after_refresh = true;
  editReport.updated_source_marker_absent_before_repreview = true;
  const selectedEditedNoteVisible = ocrTextContainsPhrase(editedRefresh.ocrText, externalRefreshMarkdownPath)
    || ocrTextContainsFuzzyPhrase(editedRefresh.ocrText, externalRefreshMarkdownPath);
  editReport.selected_note_path_ocr_confirmation_after_refresh = selectedEditedNoteVisible;
  const expectedSelectionAfterRefresh = `OpenObsidian CI vault refresh selection applied: selected=${externalRefreshMarkdownPath}`;
  const refreshSelectionLog = await waitFor(
    "OpenObsidian to retain the externally edited note selection after refresh",
    async () => (await readFile(join(reportDirectory, "openobsidian.log"), "utf8").catch(() => "")).split(/\r?\n/),
    (lines) => lines.includes(expectedSelectionAfterRefresh),
    15_000,
  );
  editReport.selected_note_path_retained_after_refresh = true;
  editReport.selection_after_refresh_diagnostic = refreshSelectionLog.find((line) => line === expectedSelectionAfterRefresh);
  editReport.selection_after_refresh_screenshot = relative(reportDirectory, editedRefresh.windowPngPath);
  editReport.refreshed_markdown_count_visible = true;
  editReport.stale_preview_cleared = true;

  editReport.read_updated_source_action = await invokeNativeAccessibleControl(
    child,
    window.window_id,
    "Read note source preview",
    externalRefreshMarkdownPath,
  );
  const updatedPreview = await waitFor(
    "OpenObsidian to preview the externally edited note source",
    async () => {
      await delay(350);
      const capture = await withSourcePaneOcr(await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-external-note-edited-source-preview"));
      editReport.updated_preview_screen_ocr = capture.ocrText.slice(0, 4_000);
      editReport.updated_preview_source_pane_ocr = capture.sourcePaneOcrText.slice(0, 4_000);
      editReport.updated_preview_source_pane_crop = capture.sourcePaneOcrCropPath
        ? relative(reportDirectory, capture.sourcePaneOcrCropPath)
        : null;
      editReport.updated_preview_source_pane_crop_bounds = capture.sourcePaneOcrCropBounds;
      return capture;
    },
    (capture) => ocrTextContainsFuzzyPhraseAcrossLines(capture.sourcePaneOcrText, externalEditedMarker, 1)
      && !ocrTextContainsFuzzyPhraseAcrossLines(capture.sourcePaneOcrText, externalRefreshMarker, 1),
    30_000,
  );
  editReport.updated_preview_screenshot = relative(reportDirectory, updatedPreview.pngPath);
  editReport.updated_preview_window_screenshot = relative(reportDirectory, updatedPreview.windowPngPath);
  editReport.updated_source_marker_visible = true;
  editReport.original_source_marker_absent_from_updated_preview = true;

  const vaultAfterUpdatedPreview = await snapshotTree(vaultRoot);
  const appDataAfterUpdatedPreview = await snapshotTree(appDataRoot);
  const vaultChangesAfterUpdatedPreview = changedPaths(vaultAfterEdit, vaultAfterUpdatedPreview);
  const appDataChangesAfterUpdatedPreview = changedPaths(appDataBeforeEdit, appDataAfterUpdatedPreview);
  const eframeFilesAfterUpdatedPreview = await readSnapshotTextFiles(
    appDataRoot,
    appDataAfterUpdatedPreview,
    (path) => path.toLowerCase().endsWith(".ron"),
  );
  editReport.vault_snapshot_after_updated_preview = vaultAfterUpdatedPreview;
  editReport.vault_changes_after_updated_preview = vaultChangesAfterUpdatedPreview;
  editReport.app_data_snapshot_after_updated_preview = appDataAfterUpdatedPreview;
  editReport.app_data_changes_after_updated_preview = appDataChangesAfterUpdatedPreview;
  editReport.eframe_persistence_files_after_updated_preview = eframeFilesAfterUpdatedPreview;
  await saveReport();
  ensureExactSnapshot(vaultAfterEdit, vaultAfterUpdatedPreview, "OpenObsidian updated external note source preview");
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataChangesAfterUpdatedPreview,
    eframeFilesAfterUpdatedPreview,
    "OpenObsidian updated external note source preview app data",
    forbiddenPersistencePaths,
  );
  editReport.vault_unchanged_after_updated_preview = true;
  editReport.app_data_change_policy_passed_after_updated_preview = true;
  await saveReport();

  refreshReport.close_preview_action = await invokeNativeAccessibleControl(
    child,
    window.window_id,
    "Close source preview",
    "Note source preview",
  );
  editReport.close_preview_action = refreshReport.close_preview_action;
  const closedPreview = await waitFor("OpenObsidian to close the externally edited note preview", async () => {
    await delay(350);
    const capture = await withSourcePaneOcr(await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-external-note-edited-preview-closed"));
    refreshReport.closed_screen_ocr = capture.ocrText.slice(0, 4_000);
    return capture;
  }, (capture) => !capture.sourcePaneLabelVisible
    && !ocrTextContainsFuzzyPhraseAcrossLines(capture.ocrText, externalRefreshMarker, 1)
    && !ocrTextContainsFuzzyPhraseAcrossLines(capture.ocrText, externalEditedMarker, 1), 30_000);
  refreshReport.closed_screenshot = relative(reportDirectory, closedPreview.pngPath);
  refreshReport.preview_closed = true;
  editReport.preview_closed = true;

  const vaultAfterClose = await snapshotTree(vaultRoot);
  const appDataAfterClose = await snapshotTree(appDataRoot);
  const vaultChangesAfterClose = changedPaths(vaultAfterEdit, vaultAfterClose);
  const appDataChangesAfterClose = changedPaths(appDataBeforeEdit, appDataAfterClose);
  const eframeFilesAfterClose = await readSnapshotTextFiles(appDataRoot, appDataAfterClose, (path) => path.toLowerCase().endsWith(".ron"));
  refreshReport.vault_snapshot_after_close = vaultAfterClose;
  refreshReport.vault_changes_after_close = vaultChangesAfterClose;
  refreshReport.app_data_snapshot_after_close = appDataAfterClose;
  refreshReport.app_data_changes_after_close = appDataChangesAfterClose;
  refreshReport.eframe_persistence_files_after_close = eframeFilesAfterClose;
  await saveReport();
  ensureExactSnapshot(vaultAfterEdit, vaultAfterClose, "OpenObsidian external note preview close");
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataChangesAfterClose,
    eframeFilesAfterClose,
    "OpenObsidian external note preview close app data",
    forbiddenPersistencePaths,
  );
  refreshReport.vault_unchanged_after_close = true;
  refreshReport.app_data_change_policy_passed_after_close = true;
  editReport.vault_snapshot_after_close = vaultAfterClose;
  editReport.vault_changes_after_close = vaultChangesAfterClose;
  editReport.app_data_snapshot_after_close = appDataAfterClose;
  editReport.app_data_changes_after_close = appDataChangesAfterClose;
  editReport.eframe_persistence_files_after_close = eframeFilesAfterClose;
  editReport.vault_unchanged_after_close = true;
  editReport.app_data_change_policy_passed_after_close = true;
  editReport.status = "passed";
  refreshReport.status = "passed";
  await saveReport();
  return vaultAfterEdit;
}

async function runReferenceImageEmbedResolution(
  child: ChildProcess,
  window: {window_id: string},
  appDataRoot: string,
  vaultBaseline: SnapshotEntry[],
): Promise<void> {
  const open = report.openobsidian_open as Record<string, unknown>;
  const fixture = report.fixture as Record<string, unknown>;
  const authoredNotePath = fixture.authored_note_path;
  if (typeof authoredNotePath !== "string" || authoredNotePath.length === 0) {
    throw new Error("The pinned Obsidian authoring step did not record the authored note path");
  }
  const noteEntry = vaultBaseline.find((entry) => entry.path === authoredNotePath && entry.kind === "file");
  const attachmentEntry = vaultBaseline.find((entry) => entry.path === attachmentPath && entry.kind === "file");
  if (!noteEntry?.sha256 || !attachmentEntry?.sha256) {
    throw new Error(`The Obsidian-authored note or image attachment is missing from the read-only baseline: note=${authoredNotePath}, attachment=${attachmentPath}`);
  }
  const authoredNoteReport = report.obsidian_authoring as Record<string, unknown>;
  if (authoredNoteReport.note_sha256 !== noteEntry.sha256) {
    throw new Error(`The authored note hash changed before reference image-embed resolution: report=${String(authoredNoteReport.note_sha256)}, baseline=${noteEntry.sha256}`);
  }

  const resolutionReport: Record<string, unknown> = {
    status: "in_progress",
    selected_note_path: authoredNotePath,
    selected_note_sha256: noteEntry.sha256,
    attachment_path: attachmentPath,
    attachment_sha256: attachmentEntry.sha256,
    expected_embed_source: noteEmbed,
    expected_link_status: "Resolved",
    expected_embed_disposition: "image",
  };
  open.reference_image_embed_resolution = resolutionReport;

  const vaultBefore = await snapshotTree(vaultRoot);
  ensureExactSnapshot(vaultBaseline, vaultBefore, "OpenObsidian vault before native image-embed resolution");
  const appDataBefore = await snapshotTree(appDataRoot);
  resolutionReport.vault_snapshot_before = vaultBefore;
  resolutionReport.app_data_snapshot_before = appDataBefore;
  await saveReport();

  const sortedNotePaths = vaultBaseline
    .filter((entry) => entry.kind === "file" && entry.path.toLowerCase().endsWith(".md"))
    .map((entry) => entry.path)
    .sort();
  const noteSelection = await selectReferenceNoteForEmbedResolution(
    child,
    window.window_id,
    externalRefreshMarkdownPath,
    authoredNotePath,
    sortedNotePaths,
  );
  resolutionReport.note_selection = noteSelection;
  resolutionReport.exact_authored_note_selected = noteSelection.exact_selected_path === authoredNotePath;
  await delay(350);
  const selectedNote = await captureOpenObsidianScreenshot(
    window.window_id,
    child,
    "openobsidian-authored-image-note-selected",
  );
  resolutionReport.selected_note_screen_ocr = selectedNote.ocrText.slice(0, 4_000);
  resolutionReport.authored_note_path_visible_by_ocr = ocrTextContainsPhrase(selectedNote.ocrText, authoredNotePath);
  resolutionReport.selected_note_screenshot = relative(reportDirectory, selectedNote.pngPath);
  resolutionReport.selected_note_window_screenshot = relative(reportDirectory, selectedNote.windowPngPath);

  const invokeResolveLinkStatus = async (): Promise<string> => process.platform === "linux"
    ? await clickLinuxResolveButtonFromCiGeometry(window.window_id, authoredNotePath)
    : process.platform === "darwin"
      ? await clickMacOsResolveButtonFromCiGeometry(child, authoredNotePath)
      : await invokeNativeAccessibleControl(child, window.window_id, "Resolve link status", authoredNotePath);
  resolutionReport.resolve_link_status_action = await invokeResolveLinkStatus();
  const expectedSummary = `OpenObsidian CI link resolution: source=${authoredNotePath}, total=1, resolved=1, unresolved=0, ambiguous=0, external=0, embed_roots=1, truncated=false`;
  const expectedReference = `OpenObsidian CI link reference: source=${authoredNotePath}, kind=Embed, raw=${JSON.stringify(noteEmbed)}, status=Resolved, target=${attachmentPath}`;
  const expectedEmbedPrefix = `OpenObsidian CI note embed: source=${authoredNotePath}, index=0, raw=${JSON.stringify(noteEmbed)}, status=Resolved, target=${attachmentPath}, disposition=image, revision_sha256=${attachmentEntry.sha256}, `;
  let diagnostics = await waitFor(
    "OpenObsidian to resolve the authored image embed against the exact vault attachment",
    async () => (await readFile(join(reportDirectory, "openobsidian.log"), "utf8").catch(() => "")).split(/\r?\n/),
    (lines) => lines.includes(expectedSummary)
      && lines.includes(expectedReference)
    && lines.some((line) => line.startsWith(expectedEmbedPrefix)),
    30_000,
  );

  // A watcher refresh can be logged just after its earlier idle check settles.
  // Refresh completion clears link results, so the visual-proof loop below also
  // watches for a newer refresh and restores the result before retrying the proof.
  let latestResolutionLine = diagnostics.lastIndexOf(expectedSummary);
  let resolutionRetryCount = 0;
  const retryAfterWatcherRefresh = async (
    settledRefresh: Awaited<ReturnType<typeof waitForOpenObsidianRefreshIdle>>,
  ): Promise<boolean> => {
    const watcherRequest = settledRefresh.requests.filter((request) => (
      request.source === "watcher_reconciliation" && request.line > latestResolutionLine
    )).at(-1);
    const latestRequest = settledRefresh.requests.at(-1);
    const latestResult = settledRefresh.consumedResults.at(-1);
    const receiverBusy = settledRefresh.receiverStates.at(-1)?.busy ?? false;
    if (!watcherRequest || !latestRequest || !latestResult || latestResult.line <= latestRequest.line || receiverBusy) {
      return false;
    }
    if (!latestResult.succeeded || latestResult.entries !== countMarkdownFiles(vaultBaseline)) {
      throw new Error(`OpenObsidian watcher refresh after image resolution returned an unexpected result: ${JSON.stringify(latestResult)}`);
    }
    resolutionReport.post_resolution_watcher_refresh = {
      request: watcherRequest,
      consumed_result: latestResult,
      receiver_busy: receiverBusy,
      settled_for_ms: settledRefresh.settled_for_ms,
    };

    const previousLogLineCount = (await readFile(join(reportDirectory, "openobsidian.log"), "utf8").catch(() => "")).split(/\r?\n/).length;
    const retryAction = await invokeResolveLinkStatus();
    diagnostics = await waitFor(
      "OpenObsidian to restore the resolved image-embed result after vault reconciliation",
      async () => (await readFile(join(reportDirectory, "openobsidian.log"), "utf8").catch(() => "")).split(/\r?\n/),
      (lines) => {
        const summaryLine = lines.lastIndexOf(expectedSummary);
        const retryLines = lines.slice(summaryLine);
        return summaryLine >= previousLogLineCount - 1
          && retryLines.includes(expectedReference)
          && retryLines.some((line) => line.startsWith(expectedEmbedPrefix));
      },
      30_000,
    );
    latestResolutionLine = diagnostics.lastIndexOf(expectedSummary);
    resolutionRetryCount += 1;
    resolutionReport.resolve_link_status_retry_action = retryAction;
    resolutionReport.resolution_retry_count = resolutionRetryCount;
    await saveReport();
    return true;
  };

  await delay(2_000);
  const settledRefresh = await waitForOpenObsidianRefreshIdle(
    0,
    countMarkdownFiles(vaultBaseline),
    false,
  );
  await retryAfterWatcherRefresh(settledRefresh);
  const embedDiagnostic = diagnostics.filter((line) => line.startsWith(expectedEmbedPrefix)).at(-1);
  const imageDetails = embedDiagnostic?.match(/dimensions=(\d+)x(\d+), decoded_rgba_bytes=(\d+), alt=(.+)$/);
  if (!embedDiagnostic || !imageDetails) {
    throw new Error(`OpenObsidian did not report decoded image dimensions and accessible alt text: ${embedDiagnostic ?? "missing image diagnostic"}`);
  }
  const imageWidth = Number(imageDetails[1]);
  const imageHeight = Number(imageDetails[2]);
  const decodedRgbaBytes = Number(imageDetails[3]);
  const imageAltText = JSON.parse(imageDetails[4] ?? "null") as unknown;
  if (
    imageWidth < 1
    || imageHeight < 1
    || decodedRgbaBytes !== imageWidth * imageHeight * 4
    || imageAltText !== "Vault image attachment"
  ) {
    throw new Error(`OpenObsidian's native image result did not match its bounded RGBA/alt-text contract: ${embedDiagnostic}`);
  }
  resolutionReport.link_resolution_diagnostic = expectedSummary;
  resolutionReport.link_reference_diagnostic = expectedReference;
  resolutionReport.note_embed_diagnostic = embedDiagnostic;
  resolutionReport.decoded_image = {
    width: imageWidth,
    height: imageHeight,
    rgba_bytes: decodedRgbaBytes,
    revision_sha256_matches_attachment: true,
    alt_text: imageAltText,
  };

  type ResolvedImageCapture = Awaited<ReturnType<typeof captureOpenObsidianScreenshot>>;
  let rendered: ResolvedImageCapture | null = null;
  let lastRenderedCapture: ResolvedImageCapture | null = null;
  const renderedDeadline = Date.now() + 30_000;
  while (Date.now() < renderedDeadline) {
    await delay(350);
    const capture = await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-resolved-image-embed");
    lastRenderedCapture = capture;
    const visualProofMatches = (
      ocrTextContainsFuzzyPhrase(capture.ocrText, `Link status refreshed for ${authoredNotePath}`)
      && ocrTextContainsFuzzyPhrase(capture.ocrText, "Resolved: 1")
      && ocrTextContainsFuzzyPhrase(capture.ocrText, `Vault image: ${attachmentPath}`)
    );

    const refreshState = await readOpenObsidianRefreshDiagnostics();
    const staleWatcherRequest = refreshState.requests.some((request) => (
      request.source === "watcher_reconciliation" && request.line > latestResolutionLine
    ));
    if (staleWatcherRequest) {
      if (resolutionRetryCount >= 3) {
        resolutionReport.last_visual_proof_screen_ocr = capture.ocrText.slice(0, 4_000);
        resolutionReport.last_visual_proof_screenshot = relative(reportDirectory, capture.pngPath);
        await saveReport();
        throw new Error(`OpenObsidian logged another watcher refresh after ${resolutionRetryCount} image-resolution retries; refusing to accept visual proof from before the refresh`);
      }
      const settledAfterStaleRefresh = await waitForOpenObsidianRefreshIdle(
        0,
        countMarkdownFiles(vaultBaseline),
        false,
      );
      if (!await retryAfterWatcherRefresh(settledAfterStaleRefresh)) {
        throw new Error("OpenObsidian logged a watcher refresh after image resolution but its settled state could not be verified");
      }
      continue;
    }
    if (visualProofMatches) {
      rendered = capture;
      break;
    }
  }
  if (!rendered) {
    if (lastRenderedCapture) {
      resolutionReport.last_visual_proof_screen_ocr = lastRenderedCapture.ocrText.slice(0, 4_000);
      resolutionReport.last_visual_proof_screenshot = relative(reportDirectory, lastRenderedCapture.pngPath);
      await saveReport();
    }
    throw new Error(`Timed out waiting for OpenObsidian to show resolved link status and the image attachment in its native window; retries=${resolutionRetryCount}; last OCR=${JSON.stringify(lastRenderedCapture?.ocrText.slice(0, 2_000) ?? "no screenshot captured")}`);
  }
  resolutionReport.result_screen_ocr = rendered.ocrText.slice(0, 4_000);
  resolutionReport.result_screenshot = relative(reportDirectory, rendered.pngPath);
  resolutionReport.result_window_screenshot = relative(reportDirectory, rendered.windowPngPath);
  resolutionReport.link_status_visible = true;
  resolutionReport.resolved_count_visible = true;
  resolutionReport.image_attachment_visible = true;

  const vaultAfter = await snapshotTree(vaultRoot);
  const appDataAfter = await snapshotTree(appDataRoot);
  const vaultChanges = changedPaths(vaultBefore, vaultAfter);
  const appDataChanges = changedPaths(appDataBefore, appDataAfter);
  const eframeFilesAfter = await readSnapshotTextFiles(appDataRoot, appDataAfter, (path) => path.toLowerCase().endsWith(".ron"));
  resolutionReport.vault_snapshot_after = vaultAfter;
  resolutionReport.vault_changes = vaultChanges;
  resolutionReport.app_data_snapshot_after = appDataAfter;
  resolutionReport.app_data_changes = appDataChanges;
  resolutionReport.eframe_persistence_files_after = eframeFilesAfter;
  await saveReport();
  ensureExactSnapshot(vaultBefore, vaultAfter, "OpenObsidian native image-embed link resolution");
  const canonicalVaultRoot = await realpath(vaultRoot);
  const canonicalAppDataRoot = await realpath(appDataRoot);
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataChanges,
    eframeFilesAfter,
    "OpenObsidian app data during native image-embed link resolution",
    [vaultRoot, canonicalVaultRoot, appDataRoot, canonicalAppDataRoot],
  );
  resolutionReport.vault_unchanged = true;
  resolutionReport.app_data_change_policy_passed = true;
  resolutionReport.status = "passed";
  await saveReport();
}

async function runReferenceImageAttachmentRemoval(
  child: ChildProcess,
  window: {window_id: string},
  appDataRoot: string,
  vaultBaseline: SnapshotEntry[],
): Promise<SnapshotEntry[]> {
  const open = report.openobsidian_open as Record<string, unknown>;
  const fixture = report.fixture as Record<string, unknown>;
  const authoredNotePath = fixture.authored_note_path;
  if (typeof authoredNotePath !== "string" || authoredNotePath.length === 0) {
    throw new Error("The pinned Obsidian authoring step did not record the authored note path before attachment removal");
  }
  const noteEntry = vaultBaseline.find((entry) => entry.path === authoredNotePath && entry.kind === "file");
  const attachmentEntry = vaultBaseline.find((entry) => entry.path === attachmentPath && entry.kind === "file");
  if (!noteEntry?.sha256 || !attachmentEntry?.sha256) {
    throw new Error(`The authored note or its attachment is missing before external removal: note=${authoredNotePath}, attachment=${attachmentPath}`);
  }

  const removalReport: Record<string, unknown> = {
    status: "in_progress",
    selected_note_path: authoredNotePath,
    selected_note_sha256: noteEntry.sha256,
    attachment_path: attachmentPath,
    attachment_sha256_before_removal: attachmentEntry.sha256,
    expected_embed_source: noteEmbed,
    expected_link_status_after_refresh: "Unresolved",
    expected_embed_disposition_after_refresh: "not_rendered",
  };
  open.reference_image_attachment_removal = removalReport;

  const refreshRequestCountBeforeRemoval = (await readOpenObsidianRefreshDiagnostics()).requests.length;
  const vaultBeforeRemoval = await snapshotTree(vaultRoot);
  ensureExactSnapshot(vaultBaseline, vaultBeforeRemoval, "OpenObsidian vault before deliberate external image-attachment removal");
  const appDataBeforeRemoval = await snapshotTree(appDataRoot);
  removalReport.vault_snapshot_before_external_removal = vaultBeforeRemoval;
  removalReport.app_data_snapshot_before_external_removal = appDataBeforeRemoval;
  await saveReport();

  await unlink(join(vaultRoot, attachmentPath));
  const vaultAfterExternalRemoval = await snapshotTree(vaultRoot);
  const vaultChangesFromExternalRemoval = changedPaths(vaultBeforeRemoval, vaultAfterExternalRemoval);
  if (
    vaultChangesFromExternalRemoval.length !== 1
    || vaultChangesFromExternalRemoval[0]?.path !== attachmentPath
    || vaultChangesFromExternalRemoval[0]?.before?.sha256 !== attachmentEntry.sha256
    || vaultChangesFromExternalRemoval[0]?.after !== undefined
  ) {
    throw new Error(`External attachment removal changed unexpected vault entries: ${JSON.stringify(vaultChangesFromExternalRemoval).slice(0, 6_000)}`);
  }
  const noteAfterRemoval = await readFile(join(vaultRoot, authoredNotePath));
  const noteAfterRemovalSha256 = createHash("sha256").update(noteAfterRemoval).digest("hex");
  if (noteAfterRemovalSha256 !== noteEntry.sha256 || !noteAfterRemoval.includes(Buffer.from(noteEmbed, "utf8"))) {
    throw new Error(`External attachment removal changed the Obsidian-authored note or its embed source: ${authoredNotePath}`);
  }
  const appDataAfterExternalRemoval = await snapshotTree(appDataRoot);
  ensureExactSnapshot(appDataBeforeRemoval, appDataAfterExternalRemoval, "Separate OpenObsidian app data during deliberate external image-attachment removal");
  const expectedMarkdownCount = countMarkdownFiles(vaultAfterExternalRemoval);
  removalReport.vault_snapshot_after_external_removal = vaultAfterExternalRemoval;
  removalReport.vault_changes_from_external_removal = vaultChangesFromExternalRemoval;
  removalReport.note_sha256_after_removal = noteAfterRemovalSha256;
  removalReport.note_embed_source_preserved = true;
  removalReport.expected_markdown_count_after_refresh = expectedMarkdownCount;
  removalReport.app_data_snapshot_after_external_removal = appDataAfterExternalRemoval;
  removalReport.app_data_unchanged_during_external_removal = true;
  const vaultSnapshots = report.vault_snapshots as Record<string, unknown>;
  vaultSnapshots.before_external_attachment_removal = vaultBeforeRemoval;
  vaultSnapshots.after_external_attachment_removal = vaultAfterExternalRemoval;
  await writeFile(join(reportDirectory, "vault-after-external-attachment-removal.json"), `${JSON.stringify(vaultAfterExternalRemoval, null, 2)}\n`);
  await saveReport();

  if (process.platform !== "win32") await delay(2_000);
  const settledWatcherRefresh = await waitForOpenObsidianRefreshIdle(
    refreshRequestCountBeforeRemoval,
    expectedMarkdownCount,
    false,
  );
  removalReport.watcher_refresh_settled_before_manual = {
    settled_for_ms: settledWatcherRefresh.settled_for_ms,
    latest_receiver_busy: settledWatcherRefresh.receiverStates.at(-1)?.busy ?? false,
    latest_consumed_result: settledWatcherRefresh.consumedResults.at(-1) ?? null,
  };
  const refreshRequestCountBeforeManual = settledWatcherRefresh.requests.length;
  removalReport.refresh_action = await clickManualRefreshUntilRequested(
    child,
    window.window_id,
    refreshRequestCountBeforeManual,
  );
  const settledManualRefresh = await waitForOpenObsidianRefreshIdle(
    refreshRequestCountBeforeManual,
    expectedMarkdownCount,
    true,
  );
  removalReport.manual_refresh_diagnostics = {
    action_request: settledManualRefresh.requests.at(-1) ?? null,
    result: settledManualRefresh.consumedResults.at(-1) ?? null,
    receiver_busy_after_result: settledManualRefresh.receiverStates.at(-1)?.busy ?? false,
    settled_for_ms: settledManualRefresh.settled_for_ms,
  };

  const refreshed = await waitFor("OpenObsidian to refresh after external image-attachment removal", async () => {
    await delay(350);
    const capture = await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-after-external-attachment-removal-refresh");
    removalReport.refresh_screen_ocr = capture.ocrText.slice(0, 4_000);
    return capture;
  }, (capture) => ocrTextContainsRefreshedMarkdownCount(capture.ocrText, expectedMarkdownCount), 30_000);
  removalReport.refreshed_markdown_count_visible = true;
  removalReport.refresh_screenshot = relative(reportDirectory, refreshed.pngPath);
  removalReport.refresh_window_screenshot = relative(reportDirectory, refreshed.windowPngPath);
  const staleResolvedCountVisible = refreshed.ocrText.split(/\r?\n/).some((line) => (
    /(?:^|[^a-z])resolved\s*:?\s*1(?:$|[^0-9])/i.test(line)
  ));
  const staleImageVisible = ocrTextContainsFuzzyPhrase(refreshed.ocrText, `Vault image: ${attachmentPath}`);
  removalReport.stale_resolved_count_visible_after_refresh = staleResolvedCountVisible;
  removalReport.stale_image_visible_after_refresh = staleImageVisible;
  if (staleResolvedCountVisible || staleImageVisible) {
    throw new Error(`OpenObsidian retained stale resolved-image output after refresh: ${JSON.stringify(refreshed.ocrText.slice(0, 2_000))}`);
  }

  const resolveAction = process.platform === "linux"
    ? await clickLinuxResolveButtonFromCiGeometry(window.window_id, authoredNotePath)
    : process.platform === "darwin"
      ? await clickMacOsResolveButtonFromCiGeometry(child, authoredNotePath)
      : await invokeNativeAccessibleControl(child, window.window_id, "Resolve link status", authoredNotePath);
  removalReport.resolve_link_status_action = resolveAction;
  const expectedSummary = `OpenObsidian CI link resolution: source=${authoredNotePath}, total=1, resolved=0, unresolved=1, ambiguous=0, external=0, embed_roots=1, truncated=false`;
  const expectedReference = `OpenObsidian CI link reference: source=${authoredNotePath}, kind=Embed, raw=${JSON.stringify(noteEmbed)}, status=Unresolved, target=<none>`;
  const expectedEmbed = `OpenObsidian CI note embed: source=${authoredNotePath}, index=0, raw=${JSON.stringify(noteEmbed)}, status=Unresolved, target=<none>, disposition=not_rendered`;
  let diagnostics = await waitFor(
    "OpenObsidian to report the externally removed authored attachment as unresolved",
    async () => (await readFile(join(reportDirectory, "openobsidian.log"), "utf8").catch(() => "")).split(/\r?\n/),
    (lines) => lines.includes(expectedSummary) && lines.includes(expectedReference) && lines.includes(expectedEmbed),
    30_000,
  );
  await delay(2_000);
  const settledResolutionRefresh = await waitForOpenObsidianRefreshIdle(
    0,
    expectedMarkdownCount,
    false,
  );
  const initialResolutionLine = diagnostics.findIndex((line) => line === expectedSummary);
  const refreshAfterInitialResolution = settledResolutionRefresh.requests.some((request) => (
    request.source === "watcher_reconciliation" && request.line > initialResolutionLine
  ));
  if (refreshAfterInitialResolution) {
    removalReport.post_resolution_watcher_refresh = {
      request: settledResolutionRefresh.requests.find((request) => (
        request.source === "watcher_reconciliation" && request.line > initialResolutionLine
      )) ?? null,
      consumed_result: settledResolutionRefresh.consumedResults.at(-1) ?? null,
      receiver_busy: settledResolutionRefresh.receiverStates.at(-1)?.busy ?? false,
    };
    const previousLogLineCount = diagnostics.length;
    removalReport.resolve_link_status_retry_action = process.platform === "linux"
      ? await clickLinuxResolveButtonFromCiGeometry(window.window_id, authoredNotePath)
      : process.platform === "darwin"
        ? await clickMacOsResolveButtonFromCiGeometry(child, authoredNotePath)
        : await invokeNativeAccessibleControl(child, window.window_id, "Resolve link status", authoredNotePath);
    diagnostics = await waitFor(
      "OpenObsidian to restore the unresolved image-embed result after vault reconciliation",
      async () => (await readFile(join(reportDirectory, "openobsidian.log"), "utf8").catch(() => "")).split(/\r?\n/),
      (lines) => {
        const retryLines = lines.slice(previousLogLineCount);
        return retryLines.includes(expectedSummary)
          && retryLines.includes(expectedReference)
          && retryLines.includes(expectedEmbed);
      },
      30_000,
    );
  }
  removalReport.link_resolution_diagnostic = diagnostics.find((line) => line === expectedSummary);
  removalReport.link_reference_diagnostic = diagnostics.find((line) => line === expectedReference);
  removalReport.note_embed_diagnostic = diagnostics.find((line) => line === expectedEmbed);
  removalReport.unresolved_target_is_absent = true;
  removalReport.embed_is_not_rendered = true;

  const unresolved = await waitFor("OpenObsidian to display the unresolved attachment with no stale image", async () => {
    await delay(350);
    return await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-external-attachment-unresolved");
  }, (capture) => (
    ocrTextContainsFuzzyPhrase(capture.ocrText, `Link status refreshed for ${authoredNotePath}`)
    && ocrTextContainsFuzzyPhrase(capture.ocrText, "Unresolved: 1")
    && ocrTextContainsFuzzyPhrase(capture.ocrText, "Not rendered: no matching Markdown note or vault attachment was found")
    && !ocrTextContainsFuzzyPhrase(capture.ocrText, `Vault image: ${attachmentPath}`)
  ), 30_000);
  removalReport.unresolved_screen_ocr = unresolved.ocrText.slice(0, 4_000);
  removalReport.unresolved_screenshot = relative(reportDirectory, unresolved.pngPath);
  removalReport.unresolved_window_screenshot = relative(reportDirectory, unresolved.windowPngPath);
  removalReport.unresolved_count_visible = true;
  removalReport.missing_attachment_message_visible = true;
  removalReport.stale_image_absent = true;

  const vaultAfterResolution = await snapshotTree(vaultRoot);
  const appDataAfterResolution = await snapshotTree(appDataRoot);
  const vaultChangesAfterResolution = changedPaths(vaultAfterExternalRemoval, vaultAfterResolution);
  const appDataChangesAfterResolution = changedPaths(appDataAfterExternalRemoval, appDataAfterResolution);
  const eframeFilesAfterResolution = await readSnapshotTextFiles(appDataRoot, appDataAfterResolution, (path) => path.toLowerCase().endsWith(".ron"));
  removalReport.vault_snapshot_after_resolution = vaultAfterResolution;
  removalReport.vault_changes_after_resolution = vaultChangesAfterResolution;
  removalReport.app_data_snapshot_after_resolution = appDataAfterResolution;
  removalReport.app_data_changes_after_resolution = appDataChangesAfterResolution;
  removalReport.eframe_persistence_files_after_resolution = eframeFilesAfterResolution;
  await saveReport();
  ensureExactSnapshot(vaultAfterExternalRemoval, vaultAfterResolution, "OpenObsidian refresh and unresolved image-embed report after external attachment removal");
  const canonicalVaultRoot = await realpath(vaultRoot);
  const canonicalAppDataRoot = await realpath(appDataRoot);
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataChangesAfterResolution,
    eframeFilesAfterResolution,
    "OpenObsidian app data after external attachment removal and re-resolution",
    [vaultRoot, canonicalVaultRoot, appDataRoot, canonicalAppDataRoot],
  );
  removalReport.vault_unchanged_after_external_removal = true;
  removalReport.app_data_change_policy_passed = true;
  removalReport.status = "passed";
  await saveReport();
  return vaultAfterExternalRemoval;
}

async function runReferenceExternalNoteRename(
  child: ChildProcess,
  window: {window_id: string},
  appDataRoot: string,
  vaultBaseline: SnapshotEntry[],
): Promise<SnapshotEntry[]> {
  const open = report.openobsidian_open as Record<string, unknown>;
  const fixture = report.fixture as Record<string, unknown>;
  const authoredNotePath = fixture.authored_note_path;
  if (typeof authoredNotePath !== "string" || authoredNotePath.length === 0) {
    throw new Error("The Obsidian-authored note path is missing before external note rename");
  }
  const oldNote = vaultBaseline.find((entry) => entry.path === externalRefreshMarkdownPath && entry.kind === "file");
  const expectedSha256 = createHash("sha256").update(externalEditedMarkdownBytes).digest("hex");
  if (!oldNote || oldNote.bytes !== externalEditedMarkdownBytes.length || oldNote.sha256 !== expectedSha256) {
    throw new Error("The externally edited note does not match its exact expected bytes before rename");
  }
  if (vaultBaseline.some((entry) => entry.path === externalRenamedMarkdownPath)) {
    throw new Error("The external note rename destination already exists in the vault baseline");
  }

  const renameReport: Record<string, unknown> = {
    status: "in_progress",
    old_path: externalRefreshMarkdownPath,
    new_path: externalRenamedMarkdownPath,
    note_bytes: externalEditedMarkdownBytes.length,
    note_sha256: expectedSha256,
    expected_source_marker: externalEditedMarker,
    expected_markdown_count: countMarkdownFiles(vaultBaseline),
    note_source_preview_open_before_rename: false,
  };
  open.external_note_rename = renameReport;
  await saveReport();

  const vaultBeforePreview = await snapshotTree(vaultRoot);
  ensureExactSnapshot(vaultBaseline, vaultBeforePreview, "OpenObsidian vault before selecting the note for external rename");
  const appDataBeforePreview = await snapshotTree(appDataRoot);
  const sortedNotePaths = vaultBaseline
    .filter((entry) => entry.kind === "file" && entry.path.toLowerCase().endsWith(".md"))
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right, "en"));
  if (process.platform === "win32") {
    renameReport.open_note_selector_action = await invokeNativeAccessibleControl(
      child,
      window.window_id,
      "Note to inspect",
      authoredNotePath,
    );
  }
  renameReport.select_note_action = await selectReferenceNoteForEmbedResolution(
    child,
    window.window_id,
    authoredNotePath,
    externalRefreshMarkdownPath,
    sortedNotePaths,
  );
  renameReport.exact_external_note_selected_before_rename = true;
  renameReport.read_source_action = await invokeNativeAccessibleControl(
    child,
    window.window_id,
    "Read note source preview",
    externalRefreshMarkdownPath,
  );
  const previewBeforeRename = await waitFor(
    "OpenObsidian to display the externally edited note source before rename",
    async () => {
      await delay(350);
      const capture = await withSourcePaneOcr(await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-external-note-before-rename"));
      renameReport.preview_screen_ocr = capture.ocrText.slice(0, 4_000);
      renameReport.preview_source_pane_ocr = capture.sourcePaneOcrText.slice(0, 4_000);
      renameReport.preview_source_pane_crop = capture.sourcePaneOcrCropPath
        ? relative(reportDirectory, capture.sourcePaneOcrCropPath)
        : null;
      renameReport.preview_source_pane_crop_bounds = capture.sourcePaneOcrCropBounds;
      return capture;
    },
    (capture) => ocrTextContainsFuzzyPhraseAcrossLines(capture.sourcePaneOcrText, externalEditedMarker, 1),
    30_000,
  );
  renameReport.preview_screenshot = relative(reportDirectory, previewBeforeRename.pngPath);
  renameReport.preview_window_screenshot = relative(reportDirectory, previewBeforeRename.windowPngPath);
  renameReport.source_marker_visible_before_rename = true;
  renameReport.note_source_preview_open_before_rename = true;

  const vaultAfterPreview = await snapshotTree(vaultRoot);
  const appDataAfterPreview = await snapshotTree(appDataRoot);
  ensureExactSnapshot(vaultBeforePreview, vaultAfterPreview, "OpenObsidian note source preview before external rename");
  const previewAppDataChanges = changedPaths(appDataBeforePreview, appDataAfterPreview);
  const previewEframeFiles = await readSnapshotTextFiles(appDataRoot, appDataAfterPreview, (path) => path.toLowerCase().endsWith(".ron"));
  const canonicalVaultRoot = await realpath(vaultRoot);
  const canonicalAppDataRoot = await realpath(appDataRoot);
  ensureAppDataChangesAreMacEframeUiStateOnly(
    previewAppDataChanges,
    previewEframeFiles,
    "OpenObsidian app data while previewing the note before external rename",
    [vaultRoot, canonicalVaultRoot, appDataRoot, canonicalAppDataRoot],
  );
  renameReport.vault_snapshot_before_preview = vaultBeforePreview;
  renameReport.vault_snapshot_after_preview = vaultAfterPreview;
  renameReport.vault_unchanged_after_preview = true;
  renameReport.app_data_snapshot_before_preview = appDataBeforePreview;
  renameReport.app_data_snapshot_after_preview = appDataAfterPreview;
  renameReport.app_data_changes_after_preview = previewAppDataChanges;
  renameReport.app_data_change_policy_passed_after_preview = true;
  await saveReport();

  const settledBeforeRename = await waitForOpenObsidianRefreshIdle(
    0,
    countMarkdownFiles(vaultBaseline),
    false,
  );
  const requestCountBeforeRename = settledBeforeRename.requests.length;
  const vaultBeforeRename = await snapshotTree(vaultRoot);
  ensureExactSnapshot(vaultBaseline, vaultBeforeRename, "OpenObsidian vault immediately before external note rename");
  const appDataBeforeRename = await snapshotTree(appDataRoot);
  const oldNoteBytes = await readFile(join(vaultRoot, externalRefreshMarkdownPath));
  if (!oldNoteBytes.equals(externalEditedMarkdownBytes)) {
    throw new Error("The note source preview does not match the exact expected bytes immediately before external rename");
  }

  await rename(join(vaultRoot, externalRefreshMarkdownPath), join(vaultRoot, externalRenamedMarkdownPath));
  const vaultAfterRename = await snapshotTree(vaultRoot);
  const changesFromExternalRename = changedPaths(vaultBeforeRename, vaultAfterRename);
  const oldPathChange = changesFromExternalRename.find((change) => change.path === externalRefreshMarkdownPath);
  const newPathChange = changesFromExternalRename.find((change) => change.path === externalRenamedMarkdownPath);
  const renamedEntry = vaultAfterRename.find((entry) => entry.path === externalRenamedMarkdownPath && entry.kind === "file");
  if (
    changesFromExternalRename.length !== 2
    || !oldPathChange
    || oldPathChange.before?.sha256 !== expectedSha256
    || oldPathChange.after !== undefined
    || !newPathChange
    || newPathChange.before !== undefined
    || !newPathChange.after
    || newPathChange.after.kind !== "file"
    || newPathChange.after.bytes !== externalEditedMarkdownBytes.length
    || newPathChange.after.sha256 !== expectedSha256
    || !renamedEntry
    || renamedEntry.bytes !== externalEditedMarkdownBytes.length
    || renamedEntry.sha256 !== expectedSha256
    || vaultAfterRename.some((entry) => entry.path === externalRefreshMarkdownPath)
  ) {
    throw new Error("The external note rename did not move only the expected path while preserving bytes: " + JSON.stringify(changesFromExternalRename).slice(0, 6_000));
  }
  const markdownCountAfterRename = countMarkdownFiles(vaultAfterRename);
  const expectedMarkdownCount = countMarkdownFiles(vaultBaseline);
  if (markdownCountAfterRename !== expectedMarkdownCount) {
    throw new Error("The external note rename changed the Markdown count from " + expectedMarkdownCount + " to " + markdownCountAfterRename);
  }
  const appDataAfterRename = await snapshotTree(appDataRoot);
  ensureExactSnapshot(appDataBeforeRename, appDataAfterRename, "Separate OpenObsidian app data during deliberate external note rename");
  renameReport.vault_snapshot_before_external_rename = vaultBeforeRename;
  renameReport.vault_snapshot_after_external_rename = vaultAfterRename;
  renameReport.vault_changes_from_external_rename = changesFromExternalRename;
  renameReport.old_path_absent_after_rename = true;
  renameReport.new_path_bytes_match_old_path = true;
  renameReport.markdown_count_after_rename = markdownCountAfterRename;
  renameReport.app_data_snapshot_before_external_rename = appDataBeforeRename;
  renameReport.app_data_snapshot_after_external_rename = appDataAfterRename;
  renameReport.app_data_unchanged_during_external_rename = true;
  const vaultSnapshots = report.vault_snapshots as Record<string, unknown>;
  vaultSnapshots.before_external_note_rename = vaultBeforeRename;
  vaultSnapshots.after_external_note_rename = vaultAfterRename;
  await writeFile(join(reportDirectory, "vault-after-external-note-rename.json"), JSON.stringify(vaultAfterRename, null, 2) + "\n");
  await saveReport();

  if (process.platform !== "win32") await delay(2_000);
  const settledWatcherRefresh = await waitForOpenObsidianRefreshIdle(
    requestCountBeforeRename,
    expectedMarkdownCount,
    false,
  );
  renameReport.watcher_refresh_settled_before_manual = {
    settled_for_ms: settledWatcherRefresh.settled_for_ms,
    latest_receiver_busy: settledWatcherRefresh.receiverStates.at(-1)?.busy ?? false,
    latest_consumed_result: settledWatcherRefresh.consumedResults.at(-1) ?? null,
  };
  const requestCountBeforeManual = settledWatcherRefresh.requests.length;
  renameReport.refresh_action = await clickManualRefreshUntilRequested(
    child,
    window.window_id,
    requestCountBeforeManual,
  );
  const settledManualRefresh = await waitForOpenObsidianRefreshIdle(
    requestCountBeforeManual,
    expectedMarkdownCount,
    true,
  );
  renameReport.manual_refresh_diagnostics = {
    action_request: settledManualRefresh.requests.at(-1) ?? null,
    result: settledManualRefresh.consumedResults.at(-1) ?? null,
    receiver_busy_after_result: settledManualRefresh.receiverStates.at(-1)?.busy ?? false,
    settled_for_ms: settledManualRefresh.settled_for_ms,
  };

  const sortedPathsAfterRename = vaultAfterRename
    .filter((entry) => entry.kind === "file" && entry.path.toLowerCase().endsWith(".md"))
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right, "en"));
  const expectedFallbackPath = sortedPathsAfterRename[0];
  if (expectedFallbackPath !== externalRenamedMarkdownPath) {
    throw new Error("The renamed note must be the first sorted fixture note for deterministic refresh fallback; first=" + String(expectedFallbackPath));
  }
  const refreshScreenshot = await waitFor(
    "OpenObsidian to clear the stale preview and select the renamed path after refresh",
    async () => {
      await delay(350);
      const capture = await withSourcePaneOcr(await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-after-external-note-rename-refresh"));
      renameReport.refresh_screen_ocr = capture.ocrText.slice(0, 4_000);
      renameReport.refresh_source_pane_ocr = capture.sourcePaneOcrText.slice(0, 4_000);
      renameReport.refresh_source_pane_crop = capture.sourcePaneOcrCropPath
        ? relative(reportDirectory, capture.sourcePaneOcrCropPath)
        : null;
      renameReport.refresh_source_pane_crop_bounds = capture.sourcePaneOcrCropBounds;
      return capture;
    },
    (capture) => (
      ocrTextContainsRefreshedMarkdownCount(capture.ocrText, expectedMarkdownCount)
      && !capture.sourcePaneLabelVisible
      && !ocrTextContainsFuzzyPhraseAcrossLines(capture.ocrText, externalEditedMarker, 1)
    ),
    30_000,
  );
  renameReport.refresh_screenshot = relative(reportDirectory, refreshScreenshot.pngPath);
  renameReport.refresh_window_screenshot = relative(reportDirectory, refreshScreenshot.windowPngPath);
  renameReport.stale_preview_cleared_after_rename = true;
  renameReport.refreshed_markdown_count_visible = true;
  const expectedSelectionAfterRename = "OpenObsidian CI vault refresh selection applied: selected=" + expectedFallbackPath;
  const refreshSelectionLog = await waitFor(
    "OpenObsidian to apply its exact fallback selection after the external note rename",
    async () => (await readFile(join(reportDirectory, "openobsidian.log"), "utf8").catch(() => "")).split(/\r?\n/),
    (lines) => lines.includes(expectedSelectionAfterRename),
    15_000,
  );
  renameReport.expected_fallback_path = expectedFallbackPath;
  renameReport.selection_after_refresh_diagnostic = refreshSelectionLog.find((line) => line === expectedSelectionAfterRename);
  renameReport.exact_renamed_path_selected_after_refresh = true;

  renameReport.read_renamed_source_action = await invokeNativeAccessibleControl(
    child,
    window.window_id,
    "Read note source preview",
    externalRenamedMarkdownPath,
  );
  const renamedPreview = await waitFor(
    "OpenObsidian to preview the same source bytes through the renamed note path",
    async () => {
      await delay(350);
      const capture = await withSourcePaneOcr(await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-renamed-note-source-preview"));
      renameReport.renamed_preview_screen_ocr = capture.ocrText.slice(0, 4_000);
      renameReport.renamed_preview_source_pane_ocr = capture.sourcePaneOcrText.slice(0, 4_000);
      renameReport.renamed_preview_source_pane_crop = capture.sourcePaneOcrCropPath
        ? relative(reportDirectory, capture.sourcePaneOcrCropPath)
        : null;
      renameReport.renamed_preview_source_pane_crop_bounds = capture.sourcePaneOcrCropBounds;
      return capture;
    },
    (capture) => ocrTextContainsFuzzyPhraseAcrossLines(capture.sourcePaneOcrText, externalEditedMarker, 1),
    30_000,
  );
  renameReport.renamed_preview_screenshot = relative(reportDirectory, renamedPreview.pngPath);
  renameReport.renamed_preview_window_screenshot = relative(reportDirectory, renamedPreview.windowPngPath);
  renameReport.renamed_source_marker_visible = true;

  const vaultAfterRenamedPreview = await snapshotTree(vaultRoot);
  const appDataAfterRenamedPreview = await snapshotTree(appDataRoot);
  ensureExactSnapshot(vaultAfterRename, vaultAfterRenamedPreview, "OpenObsidian preview of the externally renamed note");
  const appDataChangesAfterRenamedPreview = changedPaths(appDataAfterRename, appDataAfterRenamedPreview);
  const eframeFilesAfterRenamedPreview = await readSnapshotTextFiles(
    appDataRoot,
    appDataAfterRenamedPreview,
    (path) => path.toLowerCase().endsWith(".ron"),
  );
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataChangesAfterRenamedPreview,
    eframeFilesAfterRenamedPreview,
    "OpenObsidian app data after previewing the externally renamed note",
    [vaultRoot, canonicalVaultRoot, appDataRoot, canonicalAppDataRoot],
  );
  renameReport.vault_snapshot_after_renamed_preview = vaultAfterRenamedPreview;
  renameReport.vault_unchanged_after_renamed_preview = true;
  renameReport.app_data_snapshot_after_renamed_preview = appDataAfterRenamedPreview;
  renameReport.app_data_changes_after_renamed_preview = appDataChangesAfterRenamedPreview;
  renameReport.app_data_change_policy_passed_after_renamed_preview = true;
  await saveReport();

  renameReport.close_preview_action = await invokeNativeAccessibleControl(
    child,
    window.window_id,
    "Close source preview",
    "Note source preview",
  );
  const closedPreview = await waitFor(
    "OpenObsidian to close the renamed note source preview",
    async () => {
      await delay(350);
      const capture = await withSourcePaneOcr(await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-renamed-note-preview-closed"));
      renameReport.closed_screen_ocr = capture.ocrText.slice(0, 4_000);
      return capture;
    },
    (capture) => !capture.sourcePaneLabelVisible
      && !ocrTextContainsFuzzyPhraseAcrossLines(capture.ocrText, externalEditedMarker, 1),
    30_000,
  );
  renameReport.closed_screenshot = relative(reportDirectory, closedPreview.pngPath);
  renameReport.preview_closed = true;

  const vaultAfterClose = await snapshotTree(vaultRoot);
  const appDataAfterClose = await snapshotTree(appDataRoot);
  ensureExactSnapshot(vaultAfterRename, vaultAfterClose, "OpenObsidian close after external note rename");
  const appDataChangesAfterClose = changedPaths(appDataAfterRename, appDataAfterClose);
  const eframeFilesAfterClose = await readSnapshotTextFiles(appDataRoot, appDataAfterClose, (path) => path.toLowerCase().endsWith(".ron"));
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataChangesAfterClose,
    eframeFilesAfterClose,
    "OpenObsidian app data after closing the externally renamed note preview",
    [vaultRoot, canonicalVaultRoot, appDataRoot, canonicalAppDataRoot],
  );
  renameReport.vault_snapshot_after_close = vaultAfterClose;
  renameReport.vault_unchanged_after_close = true;
  renameReport.app_data_snapshot_after_close = appDataAfterClose;
  renameReport.app_data_changes_after_close = appDataChangesAfterClose;
  renameReport.app_data_change_policy_passed_after_close = true;
  renameReport.status = "passed";
  await saveReport();
  return vaultAfterRename;
}

async function runOpenObsidian(noOpBaseline: SnapshotEntry[]): Promise<SnapshotEntry[]> {
  const userConfigRoot = join(workDirectory, "openobsidian-user-config");
  const homeRoot = join(workDirectory, "openobsidian-home");
  const localDataRoot = join(workDirectory, "openobsidian-local-data");
  const appEnv: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: homeRoot,
  };
  let appDataRoot: string;
  if (process.platform === "win32") {
    appEnv.APPDATA = userConfigRoot;
    appEnv.LOCALAPPDATA = localDataRoot;
    appEnv.USERPROFILE = homeRoot;
    appDataRoot = join(userConfigRoot, "OpenObsidian");
  } else if (process.platform === "darwin") {
    appDataRoot = join(homeRoot, "Library", "Application Support", "OpenObsidian");
  } else {
    appEnv.XDG_CONFIG_HOME = userConfigRoot;
    appEnv.XDG_CACHE_HOME = join(workDirectory, "openobsidian-cache");
    appEnv.XDG_DATA_HOME = join(workDirectory, "openobsidian-data");
    appEnv.LIBGL_ALWAYS_SOFTWARE = "1";
    appEnv.WGPU_BACKEND = "gl";
    appDataRoot = join(userConfigRoot, "OpenObsidian");
  }
  await mkdir(homeRoot, {recursive: true});
  await mkdir(join(homeRoot, "Desktop"), {recursive: true});
  const child = launchLogged(openObsidianBinary, [], join(reportDirectory, "openobsidian.log"), appEnv);
  (report.openobsidian_open as Record<string, unknown>).pid = child.pid ?? null;
  try {
    await delay(1_000);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`OpenObsidian exited before rendering the selected vault (code=${child.exitCode}, signal=${child.signalCode})`);
    }
    let window: {window_id: string; title: string; geometry: string};
    if (process.platform === "linux") {
      const x11Window = await waitFor("OpenObsidian window to become visible", async () => {
        try {
          const output = execFileSync("xdotool", ["search", "--onlyvisible", "--name", "OpenObsidian"], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
          const windowId = output.trim().split(/\s+/).filter(Boolean).at(-1);
          if (!windowId) return null;
          const title = execFileSync("xdotool", ["getwindowname", windowId], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
          const geometry = execFileSync("xdotool", ["getwindowgeometry", "--shell", windowId], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
          return {window_id: windowId, title, geometry};
        } catch {
          return null;
        }
      }, (value) => value !== null, 30_000);
      if (!x11Window) throw new Error("OpenObsidian did not expose a visible X11 window");
      window = x11Window;
      (report.openobsidian_open as Record<string, unknown>).x11_window = x11Window;
      try {
        xdotool("windowfocus", "--sync", window.window_id);
      } catch {
        // Direct per-window capture below still works if Xvfb has no window manager.
      }
    } else {
      window = {window_id: String(child.pid ?? "unknown"), title: "OpenObsidian main window", geometry: "native window bounds captured during screenshot"};
      (report.openobsidian_open as Record<string, unknown>).native_window = window;
    }
    const open = report.openobsidian_open as Record<string, unknown>;
    const expectedInitialMarkdownCount = countMarkdownFiles(noOpBaseline);
    open.folder_picker = await selectOpenObsidianVaultFromNativePicker(
      child,
      window,
      join(reportDirectory, "openobsidian.log"),
    );
    let renderAttempt = 0;
    await waitFor("OpenObsidian to render the selected vault and note count", async () => {
      await delay(1_000);
      const captured = await captureOpenObsidianScreenshot(window.window_id, child);
      renderAttempt += 1;
      open.screenshot = "openobsidian-vault.png";
      open.window_screenshot = "openobsidian-vault-window.png";
      open.ocr_screenshot = relative(reportDirectory, captured.ocrPngPath).split(sep).join("/");
      open.screen_ocr = captured.ocrText;
      open.render_attempts = renderAttempt;
      return captured;
    }, (candidate) => (
      candidate.ocrText.toLowerCase().includes("roundtrip fixture")
      && new RegExp(`${expectedInitialMarkdownCount}\\s+Markdown files found`, "i").test(candidate.ocrText)
    ), 30_000);
    const initialAppData = await snapshotTree(appDataRoot);
    const canonicalVault = await realpath(vaultRoot);
    const canonicalAppData = await realpath(appDataRoot);
    const relativeAppData = relative(canonicalVault, canonicalAppData);
    if (relativeAppData === "" || (!relativeAppData.startsWith(`..${sep}`) && relativeAppData !== ".." && !relativeAppData.startsWith(sep))) {
      throw new Error("OpenObsidian's managed application data directory is inside the selected vault");
    }
    (report.openobsidian_open as Record<string, unknown>).status = "passed";
    (report.openobsidian_open as Record<string, unknown>).selected_vault_visible = true;
    (report.openobsidian_open as Record<string, unknown>).expected_markdown_count_visible = true;
    (report.openobsidian_app_data as Record<string, unknown>).root = `$RUNNER_TEMP/openobsidian-c01-roundtrip/${relative(workDirectory, appDataRoot).split(sep).join("/")}`;
    (report.openobsidian_app_data as Record<string, unknown>).canonical_root_is_outside_vault = true;
    (report.openobsidian_app_data as Record<string, unknown>).snapshot_after_startup = initialAppData;
    await saveReport();

    await runReferenceSourcePreview(child, window, appDataRoot, noOpBaseline);
    const vaultBaselineAfterExternalNoteEdit = await runReferenceExternalNoteRefresh(child, window, appDataRoot, noOpBaseline);
    const expectedMarkdownCountAfterExternalCreation = countMarkdownFiles(vaultBaselineAfterExternalNoteEdit);
    open.expected_markdown_count_after_external_refresh = expectedMarkdownCountAfterExternalCreation;
    open.expected_markdown_count_after_external_note_edit = expectedMarkdownCountAfterExternalCreation;
    await runReferenceImageEmbedResolution(child, window, appDataRoot, vaultBaselineAfterExternalNoteEdit);
    const vaultBaselineAfterAttachmentRemoval = await runReferenceImageAttachmentRemoval(
      child,
      window,
      appDataRoot,
      vaultBaselineAfterExternalNoteEdit,
    );
    const vaultBaselineAfterExternalNoteRename = await runReferenceExternalNoteRename(
      child,
      window,
      appDataRoot,
      vaultBaselineAfterAttachmentRemoval,
    );
    open.expected_markdown_count_after_external_note_rename = countMarkdownFiles(vaultBaselineAfterExternalNoteRename);
    const appDataBaselineAfterPickerCancellation = await runOpenObsidianPickerCancellation(
      child,
      window,
      appDataRoot,
      vaultBaselineAfterExternalNoteRename,
      initialAppData,
      expectedMarkdownCountAfterExternalCreation,
    );
    await delay(2_000);
    await stopProcess(child);
    const afterVault = await snapshotTree(vaultRoot);
    ensureExactSnapshot(vaultBaselineAfterExternalNoteRename, afterVault, "OpenObsidian no-op open, external note refresh, image attachment removal, note rename, picker cancellation, and close");
    const afterAppData = await snapshotTree(appDataRoot);
    const appDataChangesAfterClose = changedPaths(appDataBaselineAfterPickerCancellation, afterAppData);
    const eframePersistenceFilesAfterClose = await readSnapshotTextFiles(appDataRoot, afterAppData, (path) => path.toLowerCase().endsWith(".ron"));
    ensureAppDataChangesAreMacEframeUiStateOnly(
      appDataChangesAfterClose,
      eframePersistenceFilesAfterClose,
      "OpenObsidian app data after picker cancellation and close",
      [vaultRoot, canonicalVault, appDataRoot],
    );
    (report.vault_snapshots as Record<string, unknown>).after_openobsidian = afterVault;
    (report.vault_snapshots as Record<string, unknown>).after_picker_cancellation_close = afterVault;
    (report.openobsidian_app_data as Record<string, unknown>).snapshot_after_close = afterAppData;
    (report.openobsidian_app_data as Record<string, unknown>).snapshot_after_picker_cancellation_close = afterAppData;
    (report.openobsidian_app_data as Record<string, unknown>).changes_after_picker_baseline_and_close = appDataChangesAfterClose;
    (report.openobsidian_app_data as Record<string, unknown>).eframe_persistence_files_after_picker_baseline_and_close = eframePersistenceFilesAfterClose;
    const appDataChangesFromStartupThroughCancellation = changedPaths(initialAppData, appDataBaselineAfterPickerCancellation);
    (report.openobsidian_app_data as Record<string, unknown>).changes_from_startup_through_picker_cancellation = appDataChangesFromStartupThroughCancellation;
    (report.openobsidian_app_data as Record<string, unknown>).unchanged_after_initial_startup = appDataChangesFromStartupThroughCancellation.length === 0;
    (report.openobsidian_app_data as Record<string, unknown>).unchanged_after_picker_baseline_and_close = appDataChangesAfterClose.length === 0;
    const cancellation = open.folder_picker_cancel as Record<string, unknown>;
    cancellation.vault_snapshot_unchanged_after_close = true;
    cancellation.app_data_snapshot_unchanged_after_close = appDataChangesAfterClose.length === 0;
    cancellation.app_data_changes_after_close = appDataChangesAfterClose;
    cancellation.eframe_persistence_files_after_close = eframePersistenceFilesAfterClose;
    cancellation.app_data_changes_after_close_only_eframe_ui_state = true;
    cancellation.vault_snapshot_after_close = afterVault;
    cancellation.app_data_snapshot_after_close = afterAppData;
    await saveReport();
    return afterVault;
  } finally {
    await stopProcess(child).catch(() => undefined);
  }
}

async function runOpenObsidianPickerCancellation(
  child: ChildProcess,
  window: {window_id: string},
  appDataRoot: string,
  vaultBeforeCancellation: SnapshotEntry[],
  appDataBeforeCancellation: SnapshotEntry[],
  expectedMarkdownCount: number,
): Promise<SnapshotEntry[]> {
  const open = report.openobsidian_open as Record<string, unknown>;
  await delay(1_500);
  const startupScreen = await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-vault-before-picker-cancel");
  if (
    !startupScreen.ocrText.toLowerCase().includes("roundtrip fixture")
    || !ocrTextContainsRefreshedMarkdownCount(startupScreen.ocrText, expectedMarkdownCount)
  ) {
    throw new Error(`OpenObsidian did not display the active vault before picker cancellation; OCR=${JSON.stringify(startupScreen.ocrText.slice(0, 2_000))}`);
  }

  const canonicalVault = await realpath(vaultRoot);
  const canonicalAppData = await realpath(appDataRoot);
  const relativeAppData = relative(canonicalVault, canonicalAppData);
  if (relativeAppData === "" || (!relativeAppData.startsWith(`..${sep}`) && relativeAppData !== ".." && !relativeAppData.startsWith(sep))) {
    throw new Error("OpenObsidian's managed application data directory is inside the selected vault");
  }
  const vaultSnapshotBeforeCancel = await snapshotTree(vaultRoot);
  const appDataSnapshotBeforePickerOpen = await snapshotTree(appDataRoot);
  const eframeFilesBeforePickerOpen = await readSnapshotTextFiles(appDataRoot, appDataSnapshotBeforePickerOpen, (path) => path.toLowerCase().endsWith(".ron"));
  const appDataStartupChanges = changedPaths(appDataBeforeCancellation, appDataSnapshotBeforePickerOpen);
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataStartupChanges,
    eframeFilesBeforePickerOpen,
    "OpenObsidian startup before native picker open",
    [vaultRoot, canonicalVault, appDataRoot],
  );
  const unexpectedAppDataStartupChanges = appDataStartupChanges.filter((change) => (
    process.platform !== "darwin" || change.path !== "app.ron" || change.after?.kind !== "file"
  ));
  const appDataReport = report.openobsidian_app_data as Record<string, unknown>;
  appDataReport.snapshot_before_picker_open = appDataSnapshotBeforePickerOpen;
  appDataReport.startup_persistence_changes = appDataStartupChanges;
  appDataReport.eframe_persistence_files_before_picker_open = eframeFilesBeforePickerOpen;
  await saveReport();
  ensureExactSnapshot(vaultBeforeCancellation, vaultSnapshotBeforeCancel, "OpenObsidian vault before picker cancellation");
  if (unexpectedAppDataStartupChanges.length > 0) {
    throw new Error(`OpenObsidian app data changed before picker cancellation outside eframe app.ron persistence: ${JSON.stringify(unexpectedAppDataStartupChanges).slice(0, 6_000)}`);
  }

  const pickerCancellation = await cancelOpenObsidianNativePicker(
    child,
    window,
    appDataRoot,
    appDataSnapshotBeforePickerOpen,
    vaultRoot,
    canonicalVault,
    expectedMarkdownCount,
  );
  const appDataSnapshotBeforeCancel = pickerCancellation.app_data_snapshot_before_cancel as SnapshotEntry[];
  const appRonFilesBeforeCancel = pickerCancellation.eframe_persistence_files_before_cancel as Array<{path: string; bytes: number; sha256: string; content: string}>;
  const appDataChangesOnPickerOpen = pickerCancellation.app_data_changes_on_picker_open as Array<{path: string; before?: SnapshotEntry; after?: SnapshotEntry}>;
  appDataReport.snapshot_before_picker_cancellation = appDataSnapshotBeforeCancel;
  appDataReport.changes_on_picker_open = appDataChangesOnPickerOpen;
  appDataReport.eframe_persistence_files_before_cancellation = appRonFilesBeforeCancel;
  await saveReport();
  const vaultAfterCancellation = await snapshotTree(vaultRoot);
  const appDataAfterCancellation = await snapshotTree(appDataRoot);
  const appRonFilesAfterCancel = await readSnapshotTextFiles(appDataRoot, appDataAfterCancellation, (path) => path.toLowerCase().endsWith(".ron"));
  const vaultChangesAfterCancel = changedPaths(vaultSnapshotBeforeCancel, vaultAfterCancellation);
  const appDataChangesAfterCancel = changedPaths(appDataSnapshotBeforeCancel, appDataAfterCancellation);
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataChangesAfterCancel,
    appRonFilesAfterCancel,
    "OpenObsidian app data after native picker cancellation",
    [vaultRoot, canonicalVault, appDataRoot],
  );

  open.folder_picker_cancel = {
    active_session: true,
    startup_vault_visible: true,
    startup_markdown_count_visible: true,
    startup_screen_ocr: startupScreen.ocrText.slice(0, 2_000),
    ...pickerCancellation,
    vault_snapshot_unchanged_after_cancel: vaultChangesAfterCancel.length === 0,
    app_data_snapshot_unchanged_after_cancel: appDataChangesAfterCancel.length === 0,
    app_data_changes_after_cancel_only_eframe_ui_state: true,
    app_data_changes_on_picker_open: appDataChangesOnPickerOpen,
    vault_changes_after_cancel: vaultChangesAfterCancel,
    app_data_changes_after_cancel: appDataChangesAfterCancel,
    eframe_persistence_files_before_cancel: appRonFilesBeforeCancel,
    eframe_persistence_files_after_cancel: appRonFilesAfterCancel,
    vault_snapshot_before_cancel: vaultSnapshotBeforeCancel,
    vault_snapshot_after_cancel: vaultAfterCancellation,
    app_data_snapshot_before_cancel: appDataSnapshotBeforeCancel,
    app_data_snapshot_after_cancel: appDataAfterCancellation,
  };
  (report.vault_snapshots as Record<string, unknown>).after_picker_cancellation = vaultAfterCancellation;
  (report.openobsidian_app_data as Record<string, unknown>).snapshot_after_picker_cancellation = appDataAfterCancellation;
  await saveReport();
  ensureExactSnapshot(vaultSnapshotBeforeCancel, vaultAfterCancellation, "OpenObsidian native picker cancellation");
  return appDataAfterCancellation;
}

async function reopenInObsidian(
  child: ChildProcess,
  notePath: string,
  expectedAttachmentPresent: boolean,
  externalNotePath: string,
): Promise<DevToolsConnection> {
  if (child.exitCode !== null) throw new Error(`Pinned Obsidian exited before reopen (code ${child.exitCode})`);
  const {connection, browserVersion, target} = await connectObsidian(9223);
  const reopen = report.obsidian_reopen as Record<string, unknown>;
  reopen.devtools_browser = browserVersion;
  reopen.first_target = {title: target.title ?? "", url: target.url ?? ""};
  await chooseRestrictedMode(connection, reopen);
  const trustPromptHidden = await connection.evaluateJson<boolean>(
    "!(document.body?.innerText ?? '').includes('Do you trust the author of this vault?')",
  );
  reopen.trust_prompt_hidden = trustPromptHidden;
  if (!trustPromptHidden) throw new Error("Obsidian's first-run trust prompt still covers the reopened vault");
  const notePathJson = JSON.stringify(notePath);
  const readVisible = async () => await connection.evaluateJson<{
    body: string;
    editor: string;
    title: string;
    paths: string[];
  }>(`(() => ({
    body: document.body?.innerText ?? '',
    editor: [...document.querySelectorAll('[contenteditable="true"]')].map((element) => element.innerText ?? '').join('\\n'),
    title: document.title,
    paths: [...document.querySelectorAll('[data-path]')].map((element) => element.getAttribute('data-path') || '')
  }))()`);
  let visible = await waitFor("Obsidian to reopen the authored vault note", readVisible, (value) => value.editor.includes(noteMarker), 45_000).catch(() => null);

  if (!visible) {
    await connection.evaluate(`(() => {
      const target = [...document.querySelectorAll('[data-path]')].find((element) => element.getAttribute('data-path') === ${notePathJson});
      target?.click();
      return Boolean(target);
    })()`);
    visible = await waitFor("Obsidian's file explorer to open the authored note", readVisible, (value) => value.editor.includes(noteMarker), 30_000);
  }

  if (!visible.paths.includes(notePath)) {
    visible = await waitFor(
      "Obsidian's file explorer to expose the authored note path",
      readVisible,
      (value) => value.paths.includes(notePath),
      20_000,
    );
  }

  const authoredNoteVisible = visible;
  visible = await waitFor(
    "Obsidian to list the external note after reopening the vault",
    readVisible,
    (value) => value.paths.includes(externalNotePath),
    20_000,
  );
  if (externalNotePath !== externalRefreshMarkdownPath && visible.paths.includes(externalRefreshMarkdownPath)) {
    throw new Error("Obsidian still lists the old external note path after the rename");
  }
  const externalNoteAfterReopen = await readFile(join(vaultRoot, externalNotePath));
  const externalNoteSha256 = createHash("sha256").update(externalNoteAfterReopen).digest("hex");
  if (!externalNoteAfterReopen.equals(externalEditedMarkdownBytes)) {
    throw new Error("Obsidian reopen changed the externally edited note bytes at " + externalNotePath);
  }

  reopen.editor_text = authoredNoteVisible.editor.slice(0, 2_000);
  reopen.visible_vault_text = authoredNoteVisible.body.slice(0, 4_000);
  reopen.final_file_tree_paths = authoredNoteVisible.paths;
  await captureObsidianScreenshot(connection, "obsidian-reopened-vault.png");
  reopen.screenshot = "obsidian-reopened-vault.png";

  const externalNoteSelectionAction = await connection.evaluateJson<boolean>(
    "(() => { const target = [...document.querySelectorAll('[data-path]')].find((element) => element.getAttribute('data-path') === "
      + JSON.stringify(externalNotePath)
      + "); target?.click(); return Boolean(target); })()",
  );
  if (!externalNoteSelectionAction) {
    throw new Error("Obsidian did not expose the externally edited note for selection after reopen");
  }
  const externalEditedNoteVisible = await waitFor(
    "Obsidian to render the externally edited note after reopening the vault",
    readVisible,
    (value) => value.paths.includes(externalNotePath)
      && value.editor.includes(externalEditedMarker)
      && !value.body.includes("Do you trust the author of this vault?"),
    20_000,
  );

  const noteSource = await readFile(join(vaultRoot, notePath), "utf8");
  const attachmentLinkPersistedInSource = noteSource.includes(noteEmbed);
  if (!attachmentLinkPersistedInSource) {
    throw new Error(`Reopened Obsidian note source does not retain the expected attachment link ${attachmentPath}`);
  }

  const attachmentFolderJson = JSON.stringify(attachmentPath.split("/")[0]);
  if (expectedAttachmentPresent && !visible.paths.includes(attachmentPath)) {
    await connection.evaluate(`(() => {
      const folder = [...document.querySelectorAll('[data-path]')].find((element) => element.getAttribute('data-path') === ${attachmentFolderJson});
      folder?.click();
    })()`);
    await delay(500);
  }
  const pathsAfterExpand = await connection.evaluateJson<string[]>(`[...document.querySelectorAll('[data-path]')].map((element) => element.getAttribute('data-path') || '')`);
  const exactAttachmentListed = pathsAfterExpand.includes(attachmentPath);
  const attachmentPathVisibleInRenderedNote = visible.editor.includes(attachmentPath);
  if (expectedAttachmentPresent && !exactAttachmentListed && !attachmentPathVisibleInRenderedNote) {
    throw new Error(`Obsidian does not display attachment path ${attachmentPath} in either the file explorer or the reopened note; paths=${JSON.stringify(pathsAfterExpand).slice(0, 2_000)}`);
  }
  if (!expectedAttachmentPresent && exactAttachmentListed) {
    throw new Error(`Obsidian unexpectedly restored externally removed attachment ${attachmentPath}`);
  }

  const selectedVaultNameVisible = visible.title.includes("Roundtrip Fixture") || visible.body.includes("Roundtrip Fixture");
  if (!selectedVaultNameVisible) {
    throw new Error(`Obsidian did not visibly identify the reopened vault name; title=${JSON.stringify(visible.title)} body=${JSON.stringify(visible.body.slice(0, 2_000))}`);
  }
  reopen.selected_vault_name_visible = selectedVaultNameVisible;
  reopen.selected_vault_restored = authoredNoteVisible.editor.includes(noteMarker) && authoredNoteVisible.paths.includes(notePath);
  reopen.note_path = notePath;
  reopen.note_path_visible_in_file_explorer = true;
  reopen.attachment_path = attachmentPath;
  reopen.attachment_path_expected_present = expectedAttachmentPresent;
  reopen.attachment_link_persisted_in_note_source = attachmentLinkPersistedInSource;
  reopen.attachment_path_visible_in_file_explorer = exactAttachmentListed;
  reopen.attachment_path_visible_in_editor_text = attachmentPathVisibleInRenderedNote;
  reopen.attachment_remains_absent_after_reopen = !expectedAttachmentPresent && !exactAttachmentListed;
  reopen.external_note_path = externalNotePath;
  reopen.external_note_path_visible_in_file_explorer = visible.paths.includes(externalNotePath);
  reopen.external_old_path_absent_after_rename = externalNotePath === externalRefreshMarkdownPath
    || !visible.paths.includes(externalRefreshMarkdownPath);
  reopen.external_note_source_marker_visible_after_reopen = externalEditedNoteVisible.editor.includes(externalEditedMarker);
  reopen.external_note_trust_prompt_hidden = !externalEditedNoteVisible.body.includes("Do you trust the author of this vault?");
  reopen.external_note_source_bytes_match_external_edit = externalNoteAfterReopen.equals(externalEditedMarkdownBytes);
  reopen.external_note_bytes = externalNoteAfterReopen.length;
  reopen.external_note_sha256 = externalNoteSha256;
  reopen.external_note_source_unchanged = true;
  await captureObsidianScreenshot(connection, "obsidian-reopened-external-note.png");
  reopen.external_note_screenshot = "obsidian-reopened-external-note.png";

  reopen.status = "reference_checks_passed";
  return connection;
}

async function verifyCanvasReferenceVisible(
  connection: DevToolsConnection,
  expectedCanvas: {bytes: number; sha256: string},
  screenshot: string,
  label: string,
): Promise<{body: string; editor: string; title: string; paths: string[]; bytes: number; sha256: string}> {
  const readVisible = async () => await connection.evaluateJson<{
    body: string;
    editor: string;
    title: string;
    paths: string[];
  }>(`(() => ({
    body: document.body?.innerText ?? '',
    editor: [...document.querySelectorAll('[contenteditable="true"]')].map((element) => element.innerText ?? '').join('\\n'),
    title: document.title,
    paths: [...document.querySelectorAll('[data-path]')].map((element) => element.getAttribute('data-path') || '')
  }))()`);
  let visible = await waitFor(
    `${label}: Obsidian to list the reference Canvas path`,
    readVisible,
    (value) => value.paths.includes(canvasPath),
    45_000,
  );
  const expectedCanvasContentVisible = (value: {body: string; paths: string[]}) => value.paths.includes(canvasPath)
    && value.body.includes(canvasMarker)
    && value.body.includes(canvasTargetText)
    && !value.body.includes("Do you trust the author of this vault?");
  if (!expectedCanvasContentVisible(visible)) {
    const selectionAction = await connection.evaluateJson<boolean>(`(() => {
      const target = [...document.querySelectorAll('[data-path]')]
        .find((element) => element.getAttribute('data-path') === ${JSON.stringify(canvasPath)});
      target?.click();
      return Boolean(target);
    })()`);
    if (!selectionAction) {
      throw new Error(`${label}: Obsidian did not expose ${canvasPath} for selection`);
    }
    visible = await waitFor(
      `${label}: Obsidian to render the Canvas marker and path`,
      readVisible,
      expectedCanvasContentVisible,
      30_000,
    );
  }
  if (!expectedCanvasContentVisible(visible)) {
    throw new Error(`${label}: Obsidian did not visibly render ${canvasMarker} and the ${canvasTargetPath} block subpath at ${canvasPath}`);
  }
  if (visible.body.includes("Unable to find")) {
    throw new Error(`${label}: Obsidian could not resolve the Canvas file subpath: ${visible.body.slice(0, 2_000)}`);
  }
  const bytes = await readFile(join(canvasVaultRoot, canvasPath));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== expectedCanvas.bytes || sha256 !== expectedCanvas.sha256) {
    await writeFile(join(reportDirectory, "canvas-reference-before-shutdown-check.canvas"), bytes);
    throw new Error(`${label}: Obsidian changed Canvas fixture bytes before shutdown at ${canvasPath}`);
  }
  await captureObsidianScreenshot(connection, screenshot);
  return {...visible, bytes: bytes.length, sha256};
}

async function assertCanvasReferenceSource(
  byteBaseline: {bytes: number; sha256: string},
  expectedDocument: unknown,
  stage: string,
): Promise<{
  bytes: number;
  sha256: string;
  byte_identical_to_baseline: boolean;
  semantic_content_matches_expected: true;
}> {
  // Obsidian may canonicalize Canvas JSON whitespace on shutdown. OpenObsidian's
  // preview/create checks stay byte-exact; this reference-app boundary checks data.
  const bytes = await readFile(join(canvasVaultRoot, canvasPath));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let actualDocument: unknown;
  try {
    actualDocument = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    const evidenceFilename = stage.includes("first")
      ? "canvas-reference-after-first-close.canvas"
      : "canvas-reference-after-reopen-close.canvas";
    await writeFile(join(reportDirectory, evidenceFilename), bytes);
    throw new Error(`Obsidian left invalid Canvas JSON after ${stage}: ${error instanceof Error ? error.message : "unknown JSON parse error"}`);
  }
  if (!isDeepStrictEqual(actualDocument, expectedDocument)) {
    const evidenceFilename = stage.includes("first")
      ? "canvas-reference-after-first-close.canvas"
      : "canvas-reference-after-reopen-close.canvas";
    await writeFile(join(reportDirectory, evidenceFilename), bytes);
    throw new Error(`Obsidian changed the expected Canvas data after ${stage}; got ${bytes.length} bytes / ${sha256}`);
  }
  return {
    bytes: bytes.length,
    sha256,
    byte_identical_to_baseline: bytes.length === byteBaseline.bytes && sha256 === byteBaseline.sha256,
    semantic_content_matches_expected: true,
  };
}

async function assertCanvasCreatedNoteSource(expectedBytes: Buffer, stage: string): Promise<{bytes: number; sha256: string}> {
  const bytes = await readFile(join(canvasVaultRoot, canvasNotePath));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const expectedSha256 = createHash("sha256").update(expectedBytes).digest("hex");
  if (!bytes.equals(expectedBytes)) {
    const filename = stage.includes("first") ? "canvas-note-after-first-obsidian-close.md" : "canvas-note-after-reopen-obsidian-close.md";
    await writeFile(join(reportDirectory, filename), bytes);
    throw new Error(`Obsidian changed the created Canvas note after ${stage}: expected ${expectedBytes.length} bytes / ${expectedSha256}, got ${bytes.length} bytes / ${sha256}`);
  }
  return {bytes: bytes.length, sha256};
}

async function verifyCanvasCreatedNoteVisible(
  connection: DevToolsConnection,
  screenshot: string,
  label: string,
): Promise<{
  body: string;
  editor: string;
  title: string;
  paths: string[];
  active_file_path: string | null;
  active_tree_path: string | null;
  active_view_type: string | null;
  active_view_is_markdown: boolean;
  active_view_text: string;
}> {
  const readVisible = async () => await connection.evaluateJson<{
    body: string;
    editor: string;
    title: string;
    paths: string[];
    active_file_path: string | null;
    active_tree_path: string | null;
    active_view_type: string | null;
    active_view_is_markdown: boolean;
    active_view_text: string;
  }>(`(() => ({
    body: document.body?.innerText ?? '',
    editor: [...document.querySelectorAll('[contenteditable="true"]')].map((element) => element.innerText ?? '').join('\\n'),
    title: document.title,
    paths: [...document.querySelectorAll('[data-path]')].map((element) => element.getAttribute('data-path') || ''),
    active_file_path: window.app?.workspace?.getActiveFile?.()?.path
      ?? window.app?.workspace?.activeLeaf?.view?.file?.path
      ?? null,
    active_tree_path: [...document.querySelectorAll('[data-path].is-active')]
      .map((element) => element.getAttribute('data-path') || '')
      .find(Boolean)
      ?? null,
    active_view_type: window.app?.workspace?.activeLeaf?.view?.getViewType?.()
      ?? document.querySelector('.workspace-leaf.mod-active')?.getAttribute('data-type')
      ?? null,
    active_view_is_markdown: Boolean(
      window.app?.workspace?.activeLeaf?.view?.getViewType?.() === 'markdown'
      || document.querySelector('.workspace-leaf.mod-active')?.querySelector('.markdown-source-view, .markdown-preview-view')
    ),
    active_view_text: (() => {
      const leaf = document.querySelector('.workspace-leaf.mod-active');
      const content = leaf?.querySelector('.cm-content[contenteditable="true"], .markdown-preview-view');
      return content?.innerText ?? '';
    })()
  }))()`);
  let visible = await readVisible();
  const notesFolder = canvasNotePath.split("/")[0] ?? "Notes";
  if (!visible.paths.includes(canvasNotePath) && visible.paths.includes(notesFolder)) {
    await connection.evaluate(`(() => {
      const folder = [...document.querySelectorAll('[data-path]')]
        .find((element) => element.getAttribute('data-path') === ${JSON.stringify(notesFolder)});
      folder?.click();
    })()`);
    visible = await waitFor(
      `${label}: Obsidian to expand the Notes folder`,
      readVisible,
      (value) => value.paths.includes(canvasNotePath),
      10_000,
    );
  }
  const selected = await connection.evaluateJson<boolean>(`(() => {
    const target = [...document.querySelectorAll('[data-path]')]
      .find((element) => element.getAttribute('data-path') === ${JSON.stringify(canvasNotePath)});
    target?.click();
    return Boolean(target);
  })()`);
  if (!selected) throw new Error(`${label}: Obsidian did not expose ${canvasNotePath} for selection`);
  visible = await waitFor(
    `${label}: Obsidian to render the explicitly created note`,
    readVisible,
    (value) => value.paths.includes(canvasNotePath)
      && (value.active_file_path === canvasNotePath || value.active_tree_path === canvasNotePath)
      && value.active_view_is_markdown
      && value.active_view_text.includes(canvasMarker)
      && !value.body.includes("Do you trust the author of this vault?"),
    30_000,
  );
  if (!visible.paths.includes(canvasNotePath)
    || (visible.active_file_path !== canvasNotePath && visible.active_tree_path !== canvasNotePath)
    || !visible.active_view_is_markdown
    || !visible.active_view_text.includes(canvasMarker)) {
    throw new Error(label + ": Obsidian did not make the created Markdown file the active rendered note; active_file_path="
      + JSON.stringify(visible.active_file_path)
      + ", active_tree_path=" + JSON.stringify(visible.active_tree_path)
      + ", active_view_type=" + JSON.stringify(visible.active_view_type)
      + ", active_view_text=" + JSON.stringify(visible.active_view_text.slice(0, 2_000)));
  }
  await captureObsidianScreenshot(connection, screenshot);
  return visible;
}

function normalizeVisibleInputOcr(value: string): string {
  return value.toLowerCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s*([/\\._-])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function canvasInputOcrMatches(text: string, controlName: string, expectedValue: string): boolean {
  const expected = normalizeVisibleInputOcr(expectedValue);
  const expectsMarkdownExtension = controlName === "New Markdown path" && /\.md$/i.test(expectedValue);
  const expectedWithoutMarkdownDot = expectsMarkdownExtension
    ? normalizeVisibleInputOcr(expectedValue.replace(/\.md$/i, "md"))
    : "";
  const expectedWithObservedFinalGlyphMisread = expectsMarkdownExtension
    ? expectedWithoutMarkdownDot.replace(/md$/i, "mq")
    : "";
  return text.split(/\r?\n/).some((line) => {
    const observed = normalizeVisibleInputOcr(line.replace(/^[\[\](){}|]+/, ""));
    if (observed === expected) return true;
    if (!expectsMarkdownExtension) return false;
    // On macOS the enlarged field crop can drop the dot and read the final d as q.
    // Keep the expected directory/name intact and accept only these observed suffix
    // variants when clipboard readback verifies the exact value. Empty-clipboard
    // fallback requires a literal normalized OCR line instead.
    const observedWithoutSpaceBeforeMisreadSuffix = observed.replace(/\s+mq$/i, "mq");
    return observed === expectedWithoutMarkdownDot
      || observedWithoutSpaceBeforeMisreadSuffix === expectedWithObservedFinalGlyphMisread;
  });
}

function canvasInputOcrHasExactLine(text: string, expectedValue: string): boolean {
  const expected = expectedValue.replace(/\s+/g, " ").trim();
  return text.split(/\r?\n/).some((line) =>
    line.replace(/^[\[\](){}|]+/, "").replace(/\s+/g, " ").trim() === expected
  );
}

type CanvasInputFieldLayout = {
  imagePath: string;
  ocrImagePath: string;
  imageDimensions: {width: number; height: number};
  ocrDimensions: {width: number; height: number};
  labelBoundsOcr: OcrWordBounds;
  labelBoundsImage: OcrWordBounds;
  fieldTextBoundsOcr: OcrWordBounds | null;
  fieldCenter: {x: number; y: number};
  fieldPositionSource: "visible-field-text-ocr" | "label-offset-fallback";
  fieldTextOcrSource: "full-screenshot-ocr" | "focused-raw-crop" | "label-offset-fallback";
  fieldSearchCrop: {
    rawCropPath: string;
    ocrCropPath: string;
    cropBounds: {left: number; top: number; width: number; height: number};
    rawCropDimensions: {width: number; height: number};
    ocrCropDimensions: {width: number; height: number};
    rawToOcrScale: {x: number; y: number};
    attempts: Array<{
      pageSegmentationMode: string;
      text: string;
      candidates: OcrWordBounds[];
      matchingCandidates: OcrWordBounds[];
    }>;
  } | null;
  cropBounds: {left: number; top: number; width: number; height: number};
  coordinateSpace: "window" | "desktop";
};

function canvasInputLabelXOffset(controlName: string): number {
  if (controlName === "Canvas path") return 183;
  if (controlName === "Text card ID") return 146;
  if (controlName === "New Markdown path") return -415;
  if (controlName === "Canvas edit path") return 220;
  if (controlName === "Canvas edit text-card ID") return 240;
  if (controlName === "Canvas text draft") return 280;
  throw new Error(`No Canvas input layout is configured for ${controlName}`);
}

function canvasInputCropWidth(controlName: string): number {
  if (controlName === "Canvas path") return 220;
  if (controlName === "Text card ID") return 150;
  if (controlName === "New Markdown path") return 220;
  if (controlName === "Canvas edit path") return 250;
  if (controlName === "Canvas edit text-card ID") return 220;
  if (controlName === "Canvas text draft") return 520;
  throw new Error(`No Canvas input crop is configured for ${controlName}`);
}

const canvasInputHintValues: Readonly<Record<string, string>> = {
  "Canvas path": "Boards/Idea.canvas",
  "Text card ID": "text-card-id",
  "New Markdown path": "Notes/Created.md",
  "Canvas edit path": "Boards/Idea.canvas",
  "Canvas edit text-card ID": "text-card-id",
  "Canvas text draft": canvasMarker,
};

function canvasInputExpectedRegion(
  label: OcrWordBounds,
  controlName: string,
  scaleX: number,
  scaleY: number,
): {left: number; right: number; top: number; bottom: number} {
  const expectedCenterX = label.left / scaleX + canvasInputLabelXOffset(controlName);
  const labelCenterY = label.top + label.height / 2;
  const expectedCenterY = labelCenterY + (controlName === "New Markdown path" ? 22 * scaleY : 0);
  return {
    left: (expectedCenterX - canvasInputCropWidth(controlName) / 2) * scaleX,
    right: (expectedCenterX + canvasInputCropWidth(controlName) / 2) * scaleX,
    top: expectedCenterY - 16 * scaleY,
    bottom: expectedCenterY + 16 * scaleY,
  };
}

async function findCanvasInputTextInFocusedRawCrop(
  imagePath: string,
  label: OcrWordBounds,
  controlName: string,
  targetFieldText: string,
  scaleX: number,
  scaleY: number,
  imageDimensions: {width: number; height: number},
): Promise<{
  candidate: OcrWordBounds | null;
  search: NonNullable<CanvasInputFieldLayout["fieldSearchCrop"]>;
}> {
  const expectedRegion = canvasInputExpectedRegion(label, controlName, scaleX, scaleY);
  const left = Math.max(0, Math.floor(expectedRegion.left / scaleX));
  const top = Math.max(0, Math.floor(expectedRegion.top / scaleY));
  const right = Math.min(imageDimensions.width, Math.ceil(expectedRegion.right / scaleX));
  const bottom = Math.min(imageDimensions.height, Math.ceil(expectedRegion.bottom / scaleY));
  const cropBounds = {left, top, width: right - left, height: bottom - top};
  if (cropBounds.width <= 0 || cropBounds.height <= 0) {
    throw new Error(`The focused ${controlName} OCR crop is outside the screenshot: crop=${JSON.stringify(cropBounds)}; image=${imageDimensions.width}x${imageDimensions.height}`);
  }

  const fileSafeName = controlName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const rawCropPath = join(reportDirectory, `openobsidian-canvas-field-search-${fileSafeName}-${Date.now()}-raw.png`);
  const ocrCropPath = join(reportDirectory, `openobsidian-canvas-field-search-${fileSafeName}-${Date.now()}-ocr.png`);
  const imageMagick = process.platform === "linux" ? "convert" : "magick";
  execFileSync(imageMagick, [imagePath, "-crop", `${cropBounds.width}x${cropBounds.height}+${left}+${top}`, "+repage", rawCropPath], {stdio: "ignore"});
  execFileSync(imageMagick, [rawCropPath, "-colorspace", "Gray", "-resize", "400%", "-contrast-stretch", "1%x3%", ocrCropPath], {stdio: "ignore"});

  const rawCropDimensions = await pngDimensions(rawCropPath);
  const ocrCropDimensions = await pngDimensions(ocrCropPath);
  const cropScaleX = ocrCropDimensions.width / rawCropDimensions.width;
  const cropScaleY = ocrCropDimensions.height / rawCropDimensions.height;
  if (!(cropScaleX > 0 && cropScaleY > 0 && Number.isFinite(cropScaleX) && Number.isFinite(cropScaleY))) {
    throw new Error(`Could not map the focused ${controlName} OCR crop to its original screenshot rectangle`);
  }

  const attempts: NonNullable<CanvasInputFieldLayout["fieldSearchCrop"]>["attempts"] = [];
  const search: NonNullable<CanvasInputFieldLayout["fieldSearchCrop"]> = {
    rawCropPath: relative(reportDirectory, rawCropPath),
    ocrCropPath: relative(reportDirectory, ocrCropPath),
    cropBounds,
    rawCropDimensions,
    ocrCropDimensions,
    rawToOcrScale: {x: cropScaleX, y: cropScaleY},
    attempts,
  };
  for (const pageSegmentationMode of ["7", "6"]) {
    const tsv = runTesseractTsv(ocrCropPath, pageSegmentationMode);
    const candidates = findOcrJoinedPhraseBoundsCandidates(tsv, targetFieldText, 0, 1);
    const mappedCandidates = candidates.map((candidate): OcrWordBounds => ({
      text: candidate.text,
      left: (left + candidate.left / cropScaleX) * scaleX,
      top: (top + candidate.top / cropScaleY) * scaleY,
      width: candidate.width / cropScaleX * scaleX,
      height: candidate.height / cropScaleY * scaleY,
    }));
    const matchingCandidates = mappedCandidates.filter((candidate) =>
      canvasInputCandidateMatchesLabel(candidate, label, controlName, scaleX, scaleY)
    );
    const text = tsv.split(/\r?\n/).slice(1)
      .filter((line) => line.split("\t")[0] === "5")
      .map((line) => (line.split("\t")[11] ?? "").trim())
      .filter(Boolean)
      .join(" ");
    attempts.push({pageSegmentationMode, text, candidates: mappedCandidates, matchingCandidates});
    if (matchingCandidates.length === 1) return {candidate: matchingCandidates[0]!, search};
  }
  return {candidate: null, search};
}

function canvasInputCandidateMatchesLabel(
  candidate: OcrWordBounds,
  label: OcrWordBounds,
  controlName: string,
  scaleX: number,
  scaleY: number,
): boolean {
  const labelCenterY = label.top + label.height / 2;
  const expectedRegion = canvasInputExpectedRegion(label, controlName, scaleX, scaleY);
  const candidateRight = candidate.left + candidate.width;
  const candidateCenterX = candidate.left + candidate.width / 2;
  const candidateCenterY = candidate.top + candidate.height / 2;
  const centerInConfiguredFieldRegion = candidateCenterX >= expectedRegion.left
    && candidateCenterX <= expectedRegion.right
    && candidateCenterY >= expectedRegion.top
    && candidateCenterY <= expectedRegion.bottom;
  if (!centerInConfiguredFieldRegion) return false;

  if (controlName === "New Markdown path") {
    const labelLeft = label.left;
    const labelCenter = labelCenterY;
    return candidateRight <= labelLeft + 4 * scaleX
      && candidate.top >= label.top + label.height - 4 * scaleY
      && candidateCenterY > labelCenter + label.height * 0.35;
  }

  const labelRight = label.left + label.width;
  const sameRowTolerance = Math.max(8 * scaleY, Math.max(label.height, candidate.height) * 0.75);
  return candidate.left >= labelRight - 4 * scaleX
    && Math.abs(candidateCenterY - labelCenterY) <= sameRowTolerance
    && candidateCenterX >= labelRight - 4 * scaleX;
}

async function locateCanvasTextInput(
  capture: Awaited<ReturnType<typeof captureOpenObsidianScreenshot>>,
  controlName: string,
  expectedInputValue?: string,
): Promise<CanvasInputFieldLayout> {
  const coordinateSpace = process.platform === "darwin" ? "desktop" : "window";
  const imagePath = coordinateSpace === "desktop" ? capture.pngPath : capture.windowPngPath;
  const ocrImagePath = coordinateSpace === "desktop"
    ? join(reportDirectory, `openobsidian-canvas-desktop-ocr-${Date.now()}.png`)
    : capture.ocrPngPath;
  if (coordinateSpace === "desktop") {
    execFileSync("magick", [imagePath, "-colorspace", "Gray", "-level", "0%,15%", "-resize", "200%", ocrImagePath], {stdio: "ignore"});
  }
  const imageDimensions = await pngDimensions(imagePath);
  const ocrDimensions = await pngDimensions(ocrImagePath);
  const scaleX = ocrDimensions.width / imageDimensions.width;
  const scaleY = ocrDimensions.height / imageDimensions.height;
  if (!(scaleX > 0 && scaleY > 0 && Number.isFinite(scaleX) && Number.isFinite(scaleY))) {
    throw new Error(`Could not map the ${controlName} label from OCR pixels to the screenshot`);
  }

  const tsvCandidates = [runTesseractTsv(ocrImagePath, "6"), runTesseractTsv(ocrImagePath, "11")];
  const labelPhrases = controlName.includes("text-card")
    ? [
      controlName,
      controlName.replace("text-card", "text card"),
      controlName.replace("text-card", "textcard"),
    ]
    : [controlName];
  const targetFieldText = controlName === "Canvas text draft"
    ? undefined
    : expectedInputValue ?? canvasInputHintValues[controlName];
  let labelBoundsOcr: OcrWordBounds | null = null;
  let fieldSearchLabelBoundsOcr: OcrWordBounds | null = null;
  let fieldTextBoundsOcr: OcrWordBounds | null = null;
  let fieldTextOcrSource: CanvasInputFieldLayout["fieldTextOcrSource"] = "label-offset-fallback";
  let fieldSearchCrop: CanvasInputFieldLayout["fieldSearchCrop"] = null;
  let fieldSearchFailure = "";
  for (const tsv of tsvCandidates) {
    // The instruction above the form repeats these labels. Bound the search below its
    // opening words so OCR cannot mistake the instruction for a field label.
    const instructionBounds = findOcrPhraseBounds(tsv, "Enter a", 0)
      ?? findOcrPhraseBounds(tsv, "Preview and confirm", 0)
      ?? findOcrPhraseBounds(tsv, "Load one", 0);
    if (!instructionBounds) continue;
    const candidateFormRowMinimumTop = instructionBounds.top + instructionBounds.height;
    let candidateLabelBounds: OcrWordBounds | null = null;
    for (const labelPhrase of labelPhrases) {
      candidateLabelBounds = findOcrPhraseBounds(tsv, labelPhrase, candidateFormRowMinimumTop, true);
      candidateLabelBounds ??= findOcrJoinedPhraseBounds(tsv, labelPhrase, candidateFormRowMinimumTop, 1);
      if (candidateLabelBounds) break;
    }
    if (!candidateLabelBounds) continue;
    const locatedCandidateLabelBounds = candidateLabelBounds;
    fieldSearchLabelBoundsOcr ??= locatedCandidateLabelBounds;

    const fieldTextCandidates = coordinateSpace === "desktop" && targetFieldText
      ? findOcrJoinedPhraseBoundsCandidates(tsv, targetFieldText, candidateFormRowMinimumTop, 1)
        .filter((candidate) => canvasInputCandidateMatchesLabel(candidate, locatedCandidateLabelBounds, controlName, scaleX, scaleY))
      : [];
    if (coordinateSpace === "desktop" && targetFieldText && fieldTextCandidates.length !== 1) {
      fieldSearchFailure = `Could not uniquely locate the ${controlName} field text in its label-relative OCR region: candidate_count=${fieldTextCandidates.length}; candidates=${JSON.stringify(fieldTextCandidates)}; label=${JSON.stringify(locatedCandidateLabelBounds)}; screenshot=${relative(reportDirectory, imagePath)}`;
      continue;
    }
    labelBoundsOcr = locatedCandidateLabelBounds;
    fieldTextBoundsOcr = fieldTextCandidates[0] ?? null;
    if (fieldTextBoundsOcr) fieldTextOcrSource = "full-screenshot-ocr";
    break;
  }
  if (coordinateSpace === "desktop" && targetFieldText && !fieldTextBoundsOcr && fieldSearchLabelBoundsOcr) {
    const focusedSearch = await findCanvasInputTextInFocusedRawCrop(
      imagePath,
      fieldSearchLabelBoundsOcr,
      controlName,
      targetFieldText,
      scaleX,
      scaleY,
      imageDimensions,
    );
    fieldSearchCrop = focusedSearch.search;
    if (focusedSearch.candidate) {
      labelBoundsOcr = fieldSearchLabelBoundsOcr;
      fieldTextBoundsOcr = focusedSearch.candidate;
      fieldTextOcrSource = "focused-raw-crop";
    } else {
      fieldSearchFailure = `Could not uniquely locate the ${controlName} field text in its label-relative OCR region: full_screenshot=${fieldSearchFailure || "no unique match"}; focused_crop=${JSON.stringify(fieldSearchCrop)}`;
    }
  }
  if (!labelBoundsOcr) {
    if (fieldSearchFailure) throw new Error(fieldSearchFailure);
    throw new Error(`Could not locate the visible ${controlName} label for screenshot-based input targeting: ${relative(reportDirectory, imagePath)}`);
  }
  // macOS AX often omits egui text fields even when they have a labelled_by
  // relationship. Use OCR bounds of the visible placeholder before entry and
  // of the exact field value during readback instead of estimating the field
  // position from a fixed offset. Constrain every match to the configured
  // field region relative to this label and reject missing or ambiguous hits.
  const labelBoundsImage = {
    text: labelBoundsOcr.text,
    left: Math.round(labelBoundsOcr.left / scaleX),
    top: Math.round(labelBoundsOcr.top / scaleY),
    width: Math.max(1, Math.round(labelBoundsOcr.width / scaleX)),
    height: Math.max(1, Math.round(labelBoundsOcr.height / scaleY)),
  };
  const rowOffset = controlName === "New Markdown path" ? 22 : controlName === "Canvas text draft" ? 66 : 0;
  const centerX = fieldTextBoundsOcr
    ? Math.round((fieldTextBoundsOcr.left + fieldTextBoundsOcr.width / 2) / scaleX)
    : Math.round(labelBoundsImage.left + canvasInputLabelXOffset(controlName));
  const centerY = fieldTextBoundsOcr
    ? Math.round((fieldTextBoundsOcr.top + fieldTextBoundsOcr.height / 2) / scaleY)
    : Math.round(labelBoundsImage.top + labelBoundsImage.height / 2 + rowOffset);
  const cropWidth = canvasInputCropWidth(controlName);
  const cropHeight = controlName === "Canvas text draft" ? 72 : 32;
  const cropBounds = {
    left: Math.max(0, Math.min(imageDimensions.width - 1, Math.round(centerX - cropWidth / 2))),
    top: Math.max(0, Math.min(imageDimensions.height - 1, Math.round(centerY - cropHeight / 2))),
    width: 0,
    height: 0,
  };
  cropBounds.width = Math.min(cropWidth, imageDimensions.width - cropBounds.left);
  cropBounds.height = Math.min(cropHeight, imageDimensions.height - cropBounds.top);
  if (centerX < 0 || centerX >= imageDimensions.width || centerY < 0 || centerY >= imageDimensions.height
    || cropBounds.width <= 0 || cropBounds.height <= 0) {
    throw new Error(`The measured ${controlName} field center is outside the screenshot: center=(${centerX},${centerY}), image=${imageDimensions.width}x${imageDimensions.height}`);
  }
  return {
    imagePath,
    ocrImagePath,
    imageDimensions,
    ocrDimensions,
    labelBoundsOcr,
    labelBoundsImage,
    fieldTextBoundsOcr,
    fieldCenter: {x: centerX, y: centerY},
    fieldPositionSource: fieldTextBoundsOcr ? "visible-field-text-ocr" : "label-offset-fallback",
    fieldTextOcrSource: fieldTextBoundsOcr ? fieldTextOcrSource : "label-offset-fallback",
    fieldSearchCrop,
    cropBounds,
    coordinateSpace,
  };
}

async function readCanvasInputScreenshotValue(
  capture: Awaited<ReturnType<typeof captureOpenObsidianScreenshot>>,
  controlName: string,
  expectedValue: string,
): Promise<{exact: boolean; exactLine: boolean; text: string; cropPath: string; layout: CanvasInputFieldLayout}> {
  const layout = await locateCanvasTextInput(capture, controlName, expectedValue);
  const cropPath = join(reportDirectory, `openobsidian-canvas-input-${controlName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}-ocr.png`);
  const {left, top, width, height} = layout.cropBounds;
  const imageMagick = process.platform === "linux" ? "convert" : "magick";
  execFileSync(imageMagick, [
    layout.imagePath,
    "-crop",
    `${width}x${height}+${left}+${top}`,
    "+repage",
    "-colorspace",
    "Gray",
    "-resize",
    "400%",
    "-contrast-stretch",
    "1%x3%",
    cropPath,
  ], {stdio: "ignore"});
  const text = runTesseractOcr(cropPath, ["7", "6"]);
  const exact = canvasInputOcrMatches(text, controlName, expectedValue);
  const exactLine = canvasInputOcrHasExactLine(text, expectedValue);
  return {exact, exactLine, text, cropPath, layout};
}

async function clickMacOSDesktopFraction(xFraction: number, yFraction: number): Promise<string> {
  if (!(Number.isFinite(xFraction) && Number.isFinite(yFraction)
    && xFraction >= 0 && xFraction <= 1 && yFraction >= 0 && yFraction <= 1)) {
    throw new Error(`macOS Canvas field click fractions fall outside the captured desktop: (${xFraction},${yFraction})`);
  }
  const swiftPath = join(workDirectory, "openobsidian-canvas-input-click.swift");
  await writeFile(swiftPath, `import AppKit
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3,
      let xFraction = Double(CommandLine.arguments[1]),
      let yFraction = Double(CommandLine.arguments[2]) else {
    fatalError("Expected desktop click fractions")
}
guard NSScreen.screens.count == 1 else {
    fatalError("Canvas field click mapping requires the single-display macOS CI screen")
}
let displayBounds = CGDisplayBounds(CGMainDisplayID())
guard displayBounds.width > 0, displayBounds.height > 0 else {
    fatalError("Could not read the main macOS display bounds")
}
let point = CGPoint(
    x: displayBounds.origin.x + CGFloat(xFraction) * displayBounds.width,
    y: displayBounds.origin.y + CGFloat(yFraction) * displayBounds.height
)
for type in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else {
        fatalError("Could not create mouse event")
    }
    event.post(tap: .cghidEventTap)
    if type == .leftMouseDown { Thread.sleep(forTimeInterval: 0.08) }
}
print("\\(point.x),\\(point.y)")
`);
  const point = execFileSync("swift", [swiftPath, String(xFraction), String(yFraction)], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
  return `CoreGraphics clicked the OCR-positioned Canvas input at desktop fractions (${xFraction}, ${yFraction}), Quartz point (${point})`;
}

async function replaceLinuxOpenObsidianTextInputWithKeyboard(
  child: ChildProcess,
  windowId: string,
  controlName: string,
  value: string,
  logPath = join(reportDirectory, "openobsidian-canvas-note-create.log"),
): Promise<string> {
  const fileSafeName = controlName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const maximumAttempts = 3;
  let lastFailure = "no field-position attempt completed";
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    await waitForOpenObsidianRefreshIdle(0, 0, false, logPath);
    const refreshBeforeCapture = await readOpenObsidianRefreshDiagnostics(logPath);
    const before = await captureOpenObsidianScreenshot(windowId, child, `openobsidian-canvas-input-${fileSafeName}-before`);
    const layout = await locateCanvasTextInput(before, controlName);
    const labelOcrFound = Boolean(layout.labelBoundsOcr);
    const screenshotSize = await pngDimensions(before.windowPngPath);
    const geometry = execFileSync("xdotool", ["getwindowgeometry", "--shell", windowId], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
    const readGeometry = (key: string): number => Number(geometry.match(new RegExp(`^${key}=(\\d+)$`, "m"))?.[1] ?? NaN);
    const windowWidth = readGeometry("WIDTH");
    const windowHeight = readGeometry("HEIGHT");
    if (!(windowWidth > 0 && windowHeight > 0 && screenshotSize.width > 0 && screenshotSize.height > 0)) {
      throw new Error(`Could not map Linux Canvas input coordinates for ${controlName}: geometry=${geometry.trim()}; screenshot=${screenshotSize.width}x${screenshotSize.height}`);
    }
    if (!labelOcrFound) {
      throw new Error(`Linux screenshot did not show the ${controlName} label before text entry: screenshot=${relative(reportDirectory, before.windowPngPath)}`);
    }
    if (screenshotSize.width !== 800 || screenshotSize.height !== 600 || windowWidth !== 800 || windowHeight !== 600) {
      throw new Error(`Linux Canvas field coordinates require the captured 800x600 CI layout: window=${windowWidth}x${windowHeight}; screenshot=${screenshotSize.width}x${screenshotSize.height}`);
    }

    // Positioning takes OCR time. If the watcher refreshes during that interval,
    // its status line can move the form after the screenshot; discard those bounds.
    const refreshBeforeClick = await readOpenObsidianRefreshDiagnostics(logPath);
    if (openObsidianRefreshActivityChanged(refreshBeforeCapture, refreshBeforeClick)
      || (refreshBeforeClick.receiverStates.at(-1)?.busy ?? false)) {
      lastFailure = `vault refresh changed the form layout before attempt ${attempt}`;
      continue;
    }

    // X follows the label-to-field layout; Y follows the label itself so optional status
    // messages above the form cannot move the click onto the adjacent input row.
    const clickX = Math.round(layout.fieldCenter.x * windowWidth / screenshotSize.width);
    const clickY = Math.round(layout.fieldCenter.y * windowHeight / screenshotSize.height);
    try {
      xdotool("windowfocus", "--sync", windowId);
      xdotool("mousemove", "--sync", "--window", windowId, String(clickX), String(clickY));
      xdotool("click", "--clearmodifiers", "1");
      xdotool("key", "--clearmodifiers", "ctrl+a");
      execFileSync("xdotool", ["type", "--clearmodifiers", "--delay", "1", value], {stdio: "ignore"});
    } catch (error) {
      const failure = error as NodeJS.ErrnoException;
      throw new Error(`Linux keyboard entry failed for ${controlName}: code=${failure.code ?? "unknown"}; syscall=${failure.syscall ?? "unknown"}; click=(${clickX},${clickY})`);
    }

    let clipboardReadback = "";
    let clipboardReadbackError = "";
    let verificationAttempts = 0;
    for (verificationAttempts = 1; verificationAttempts <= 5; verificationAttempts += 1) {
      xdotool("key", "--clearmodifiers", "ctrl+a");
      xdotool("key", "--clearmodifiers", "ctrl+c");
      await delay(100);
      try {
        clipboardReadback = execFileSync("xclip", ["-selection", "clipboard", "-o"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 2_000,
        });
        clipboardReadbackError = "";
      } catch (error) {
        const failure = error as NodeJS.ErrnoException;
        clipboardReadbackError = `code=${failure.code ?? "unknown"}; syscall=${failure.syscall ?? "unknown"}`;
      }
      if (clipboardReadback === value) break;
      await delay(150);
    }
    xdotool("key", "--clearmodifiers", "Right");
    const verification = await captureOpenObsidianScreenshot(
      windowId,
      child,
      `openobsidian-canvas-input-${fileSafeName}-readback`,
    );
    let visualReadback: Awaited<ReturnType<typeof readCanvasInputScreenshotValue>> | undefined;
    let visualReadbackError = "";
    try {
      visualReadback = await readCanvasInputScreenshotValue(verification, controlName, value);
    } catch (error) {
      visualReadbackError = error instanceof Error ? error.message : "unknown screenshot OCR error";
    }
    const refreshAfterVerification = await readOpenObsidianRefreshDiagnostics(logPath);
    const refreshChangedDuringInput = openObsidianRefreshActivityChanged(refreshBeforeClick, refreshAfterVerification)
      || (refreshAfterVerification.receiverStates.at(-1)?.busy ?? false);
    if (clipboardReadback === value && !refreshChangedDuringInput) {
      return JSON.stringify({
        name: controlName,
        action: "focused the OCR-positioned field, then Ctrl+A and keyboard entry",
        exact_readback: true,
        clipboard_exact: true,
        readback_source: "X11 clipboard after selecting and copying the focused field; screenshot and optional field crop retained as visual evidence",
        readback_ocr: visualReadback?.text ?? "",
        visual_ocr_exact: visualReadback?.exact ?? false,
        visual_ocr_is_diagnostic: true,
        visual_readback_error: visualReadbackError || null,
        expected_length: value.length,
        readback_length: clipboardReadback.length,
        click_x: clickX,
        click_y: clickY,
        position_source: "fresh visible label bounds after a stable vault-refresh window",
        ocr_label_found: labelOcrFound,
        readback_attempts: verificationAttempts,
        position_attempts: attempt,
        before_screenshot: relative(reportDirectory, before.windowPngPath),
        readback_screenshot: relative(reportDirectory, verification.windowPngPath),
        readback_crop: visualReadback ? relative(reportDirectory, visualReadback.cropPath) : null,
        readback_crop_bounds: visualReadback?.layout.cropBounds ?? null,
      });
    }
    lastFailure = `clipboard_length=${clipboardReadback.length}; clipboard_exact=${clipboardReadback === value}; clipboard_error=${clipboardReadbackError || "none"}; crop_ocr=${JSON.stringify(visualReadback?.text ?? "")}; visual_readback_error=${visualReadbackError || "none"}; visual_exact=${visualReadback?.exact ?? false}; refresh_changed=${refreshChangedDuringInput}; click=(${clickX},${clickY}); verification_attempts=${Math.min(verificationAttempts, 5)}; before=${relative(reportDirectory, before.windowPngPath)}; screenshot=${relative(reportDirectory, verification.windowPngPath)}; crop=${visualReadback ? relative(reportDirectory, visualReadback.cropPath) : "unavailable"}`;
  }

  throw new Error(`Linux clipboard readback and field screenshot did not confirm the exact ${controlName} value after ${maximumAttempts} fresh-position attempts: expected_length=${value.length}; ${lastFailure}`);
}

async function replaceMacOSOpenObsidianTextInputWithKeyboard(
  child: ChildProcess,
  windowId: string,
  controlName: string,
  value: string,
  logPath = join(reportDirectory, "openobsidian-canvas-note-create.log"),
): Promise<string> {
  const fileSafeName = controlName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const maximumPositionAttempts = controlName === "Canvas text draft" ? 1 : 3;
  const requiresBlankFieldProbe = controlName !== "Canvas text draft";
  let before: Awaited<ReturnType<typeof captureOpenObsidianScreenshot>> | undefined;
  let layout: CanvasInputFieldLayout | undefined;
  let click = "";
  let lastPositionFailure = "no field-position attempt completed";
  let initialFieldValueLength: number | null = null;
  if (requiresBlankFieldProbe) {
    const probeScript = `on run argv
      set processId to (item 1 of argv) as integer
      tell application "System Events"
        set targetProcess to first process whose unix id is processId
        set frontmost of targetProcess to true
        keystroke "a" using {command down}
        delay 0.1
        keystroke "c" using {command down}
        delay 0.1
      end tell
    end run`;
    for (let attempt = 1; attempt <= maximumPositionAttempts; attempt += 1) {
      await waitForOpenObsidianRefreshIdle(0, 0, false, logPath);
      const refreshBeforeCapture = await readOpenObsidianRefreshDiagnostics(logPath);
      const attemptBefore = await captureOpenObsidianScreenshot(windowId, child, `openobsidian-canvas-input-${fileSafeName}-before`);
      const attemptLayout = await locateCanvasTextInput(attemptBefore, controlName);
      const refreshBeforeClick = await readOpenObsidianRefreshDiagnostics(logPath);
      if (openObsidianRefreshActivityChanged(refreshBeforeCapture, refreshBeforeClick)
        || (refreshBeforeClick.receiverStates.at(-1)?.busy ?? false)) {
        lastPositionFailure = `vault refresh changed the form layout before positioning attempt ${attempt}`;
        continue;
      }
      const attemptClick = await clickMacOSDesktopFraction(
        attemptLayout.fieldCenter.x / attemptLayout.imageDimensions.width,
        attemptLayout.fieldCenter.y / attemptLayout.imageDimensions.height,
      );
      await delay(120);
      execFileSync("pbcopy", [], {input: "", stdio: ["pipe", "ignore", "ignore"]});
      execFileSync("osascript", ["-e", probeScript, String(child.pid ?? -1)], {stdio: "ignore"});
      const initialFieldValue = execFileSync("pbpaste", [], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2_000,
      });
      initialFieldValueLength = initialFieldValue.length;
      if (initialFieldValue !== "") {
        lastPositionFailure = `clicked field was not blank (initial_readback_length=${initialFieldValue.length}); position_source=${attemptLayout.fieldPositionSource}; click=${attemptClick}; screenshot=${relative(reportDirectory, attemptBefore.pngPath)}`;
        continue;
      }
      before = attemptBefore;
      layout = attemptLayout;
      click = attemptClick;
      break;
    }
    if (!before || !layout) {
      throw new Error(`macOS could not establish a blank ${controlName} field before typing after ${maximumPositionAttempts} fresh-position attempts: ${lastPositionFailure}`);
    }
  } else {
    await waitForOpenObsidianRefreshIdle(0, 0, false, logPath);
    before = await captureOpenObsidianScreenshot(windowId, child, `openobsidian-canvas-input-${fileSafeName}-before`);
    layout = await locateCanvasTextInput(before, controlName);
    click = await clickMacOSDesktopFraction(
      layout.fieldCenter.x / layout.imageDimensions.width,
      layout.fieldCenter.y / layout.imageDimensions.height,
    );
    await delay(120);
  }
  if (!before || !layout) throw new Error(`Could not position the macOS ${controlName} input`);
  const pasteScript = `on run argv
    set processId to (item 1 of argv) as integer
    tell application "System Events"
      set targetProcess to first process whose unix id is processId
      set frontmost of targetProcess to true
      keystroke "a" using {command down}
      delay 0.1
      keystroke "v" using {command down}
      delay 0.1
      key code 124
    end tell
  end run`;
  const copyFieldScript = `on run argv
    set processId to (item 1 of argv) as integer
    tell application "System Events"
      set targetProcess to first process whose unix id is processId
      set frontmost of targetProcess to true
      keystroke "a" using {command down}
      delay 0.1
      keystroke "c" using {command down}
    end tell
  end run`;
  execFileSync("pbcopy", [], {input: value, stdio: ["pipe", "ignore", "ignore"]});
  execFileSync("osascript", ["-e", pasteScript, String(child.pid ?? -1)], {stdio: "ignore"});
  await delay(150);
  // Clear the value used for paste before copying the field back, so the
  // following pbpaste result can only come from the focused field selection.
  execFileSync("pbcopy", [], {input: "", stdio: ["pipe", "ignore", "ignore"]});
  execFileSync("osascript", ["-e", copyFieldScript, String(child.pid ?? -1)], {stdio: "ignore"});
  await waitForOpenObsidianRefreshIdle(0, 0, false, logPath);
  let clipboardReadback = "";
  let clipboardReadbackError = "";
  try {
    clipboardReadback = execFileSync("pbpaste", [], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    });
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    clipboardReadbackError = `code=${failure.code ?? "unknown"}; syscall=${failure.syscall ?? "unknown"}`;
  }
  const verification = await captureOpenObsidianScreenshot(
    windowId,
    child,
    `openobsidian-canvas-input-${fileSafeName}-readback`,
  );
  let visualReadback: Awaited<ReturnType<typeof readCanvasInputScreenshotValue>> | undefined;
  let visualReadbackError = "";
  try {
    visualReadback = await readCanvasInputScreenshotValue(verification, controlName, value);
  } catch (error) {
    visualReadbackError = error instanceof Error ? error.message : "unknown screenshot OCR error";
  }
  // Confirm the visible value in the label-relative field crop even when the
  // clipboard returns the expected value. This ties readback to the requested
  // control instead of proving only that some focused field was copied.
  const exactVisualFieldReadback = controlName !== "Canvas text draft"
    && visualReadback?.layout.fieldPositionSource === "visible-field-text-ocr"
    && visualReadback?.exact === true;
  if (controlName !== "Canvas text draft" && !exactVisualFieldReadback) {
    throw new Error(`macOS ${controlName} field crop did not visually confirm the exact value in its label-relative OCR region: expected=${JSON.stringify(value)}; crop_ocr=${JSON.stringify(visualReadback?.text ?? "")}; visual_readback_error=${visualReadbackError || "none"}; click=${click}; crop=${visualReadback ? relative(reportDirectory, visualReadback.cropPath) : "unavailable"}; screenshot=${relative(reportDirectory, verification.pngPath)}`);
  }
  // egui can display the exact value even when macOS does not return its
  // selection through pbpaste. Accept that fallback only when the fresh
  // label-relative crop contains one literal, case-preserving line.
  const exactVisualFieldFallback = controlName !== "Canvas text draft"
    && clipboardReadback === ""
    && clipboardReadbackError === ""
    && visualReadback?.exactLine === true;
  if (clipboardReadback !== value && !exactVisualFieldFallback) {
    throw new Error(`macOS clipboard readback did not confirm the exact ${controlName} value: expected_length=${value.length}; actual_length=${clipboardReadback.length}; clipboard_error=${clipboardReadbackError || "none"}; crop_ocr=${JSON.stringify(visualReadback?.text ?? "")}; visual_readback_error=${visualReadbackError || "none"}; click=${click}; crop=${visualReadback ? relative(reportDirectory, visualReadback.cropPath) : "unavailable"}; screenshot=${relative(reportDirectory, verification.pngPath)}`);
  }
  return JSON.stringify({
    name: controlName,
    action: "focused the OCR-positioned field, Cmd+A and clipboard paste, then copied the selected field for readback",
    exact_readback: true,
    clipboard_exact: clipboardReadback === value,
    readback_source: clipboardReadback === value
      ? "macOS clipboard after selecting and copying the focused field"
      : "exact OCR line from a fresh field-text-anchored capture after clipboard readback was empty",
    readback_ocr: visualReadback?.text ?? "",
    visual_ocr_exact: visualReadback?.exact ?? false,
    visual_ocr_exact_line: visualReadback?.exactLine ?? false,
    clipboard_readback_error: clipboardReadbackError || null,
    expected_length: value.length,
    readback_length: clipboardReadback.length,
    initial_field_value_length: initialFieldValueLength,
    position_source: layout.fieldPositionSource,
    field_text_ocr_source: layout.fieldTextOcrSource,
    field_search_crop: layout.fieldSearchCrop,
    label_bounds_ocr: layout.labelBoundsOcr,
    field_text_bounds_ocr: layout.fieldTextBoundsOcr,
    field_center_image: layout.fieldCenter,
    screenshot_dimensions: layout.imageDimensions,
    ocr_dimensions: layout.ocrDimensions,
    click,
    before_screenshot: relative(reportDirectory, before.pngPath),
    readback_screenshot: relative(reportDirectory, verification.pngPath),
    readback_crop: visualReadback ? relative(reportDirectory, visualReadback.cropPath) : null,
    readback_crop_bounds: visualReadback?.layout.cropBounds ?? null,
    readback_field_text_ocr_source: visualReadback?.layout.fieldTextOcrSource ?? null,
    readback_field_search_crop: visualReadback?.layout.fieldSearchCrop ?? null,
    readback_label_bounds_ocr: visualReadback?.layout.labelBoundsOcr ?? null,
    readback_field_text_bounds_ocr: visualReadback?.layout.fieldTextBoundsOcr ?? null,
    readback_screenshot_dimensions: visualReadback?.layout.imageDimensions ?? null,
  });
}

async function replaceOpenObsidianTextInput(
  child: ChildProcess,
  windowId: string,
  controlName: string,
  value: string,
  logPath = join(reportDirectory, "openobsidian-canvas-note-create.log"),
): Promise<string> {
  await waitForOpenObsidianRefreshIdle(0, 0, false, logPath);
  const processId = child.pid;
  if (!processId) throw new Error("OpenObsidian did not expose its process id for Canvas text entry");
  if (process.platform === "linux") {
    const script = `
import json
import sys
import time
import pyatspi

process_id = int(sys.argv[1])
target_name = sys.argv[2]
hint_value = sys.argv[3]
replacement = sys.argv[4]
deadline = time.monotonic() + 20
last_matches = []
while time.monotonic() < deadline:
    pending = [pyatspi.Registry.getDesktop(0)]
    seen = set()
    while pending:
        accessible = pending.pop()
        try:
            name = accessible.getName() or ""
            role = accessible.getRoleName() or ""
            try:
                owner_pid = accessible.get_process_id()
            except Exception:
                owner_pid = None
            if owner_pid == process_id:
                try:
                    editable = accessible.queryEditableText()
                    text = accessible.queryText()
                    current = text.getText(0, text.getCharacterCount())
                    if name != target_name and current != hint_value:
                        raise RuntimeError("editable field did not match its label or visible hint")
                    last_matches.append({"name": name, "role": role, "value_length": len(current)})
                    editable.setTextContents(replacement)
                    time.sleep(0.15)
                    text = accessible.queryText()
                    current = text.getText(0, text.getCharacterCount())
                    if current != replacement:
                        raise RuntimeError("editable text value did not match after replacement")
                    print(json.dumps({"name": name, "role": role, "action": "EditableText.setTextContents", "exact_readback": True, "expected_length": len(replacement), "readback_length": len(current)}))
                    sys.exit(0)
                except Exception:
                    pass
            child_count = accessible.getChildCount()
            for index in range(child_count):
                child_accessible = accessible.getChildAtIndex(index)
                try:
                    identity = child_accessible.get_hash()
                except Exception:
                    identity = id(child_accessible)
                if identity not in seen:
                    seen.add(identity)
                    pending.append(child_accessible)
        except Exception:
            continue
    time.sleep(0.25)
print(json.dumps({"error": "editable accessible field was not found", "target": target_name, "process_id": process_id, "matching_roles": last_matches[-20:]}), file=sys.stderr)
sys.exit(1)
`;
    try {
      const hintValue = canvasInputHintValues[controlName];
      if (hintValue === undefined) throw new Error(`No visible Linux Canvas hint is configured for ${controlName}`);
      const output = execFileSync("python3", ["-c", script, String(processId), controlName, hintValue, value], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      await delay(250);
      return output;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {stderr?: Buffer | string; stdout?: Buffer | string};
      const output = [failure.stdout, failure.stderr].filter(Boolean).map(String).join("\n").trim();
      try {
        return await replaceLinuxOpenObsidianTextInputWithKeyboard(child, windowId, controlName, value, logPath);
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "unknown keyboard fallback error";
        throw new Error(`Could not set the accessible OpenObsidian ${controlName} field: ${output || failure.message}; screenshot-verified keyboard fallback failed: ${fallbackMessage}`);
      }
    }
  } else if (process.platform === "darwin") {
    const hintValue = canvasInputHintValues[controlName];
    if (hintValue === undefined) throw new Error(`No visible macOS Canvas hint is configured for ${controlName}`);
    const script = `on run argv
      set processId to (item 1 of argv) as integer
      set targetName to item 2 of argv
      set hintValue to item 3 of argv
      set replacement to item 4 of argv
      tell application "System Events"
        set targetProcess to first process whose unix id is processId
        set frontmost of targetProcess to true
        set matchingFields to {}
        set fieldInventory to ""
        repeat with candidate in entire contents of window 1 of targetProcess
          try
            set candidateRole to role of candidate as text
            if candidateRole is "AXTextField" or candidateRole is "AXTextArea" then
              set candidateName to ""
              set candidateValue to value of candidate as text
              try
                set candidateName to name of candidate as text
              end try
              set fieldInventory to fieldInventory & "[role=" & candidateRole & ",name=" & candidateName & ",value=" & candidateValue & "]"
              if candidateName is targetName or candidateValue is hintValue then set end of matchingFields to candidate
            end if
          end try
        end repeat
        if (count of matchingFields) is not 1 then error "Could not uniquely resolve the labeled " & targetName & " field by its label or visible hint; matching_fields=" & (count of matchingFields) & "; fields=" & fieldInventory
        set targetField to item 1 of matchingFields
        set targetRole to role of targetField as text
        set value of targetField to replacement
        delay 0.15
        if (value of targetField as text) is not replacement then error "Accessible value did not match after replacement for " & targetName
        return targetRole & ".setValue|" & targetName & "|exact_readback=true"
      end tell
    end run`;
    try {
      const output = execFileSync("osascript", ["-e", script, String(processId), controlName, hintValue, value], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
      await delay(250);
      return JSON.stringify({
        name: controlName,
        action: output,
        exact_readback: true,
        readback_source: "macOS accessibility value",
        expected_length: value.length,
        readback_length: value.length,
        label_or_hint_match: hintValue,
      });
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {stderr?: Buffer | string; stdout?: Buffer | string};
      const output = [failure.stdout, failure.stderr].filter(Boolean).map(String).join("\n").trim();
      try {
        const fallback = await replaceMacOSOpenObsidianTextInputWithKeyboard(child, windowId, controlName, value, logPath);
        return JSON.stringify({
          name: controlName,
          accessibility_lookup_failure: output || failure.message,
          fallback: JSON.parse(fallback),
        });
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "unknown keyboard fallback error";
        throw new Error(`Could not set the macOS OpenObsidian ${controlName} field by AX value or OCR-positioned keyboard fallback: ${output || failure.message}; fallback failed: ${fallbackMessage}`);
      }
    }
  } else if (process.platform === "win32") {
    const script = `
      $ErrorActionPreference = "Stop"
      Add-Type -AssemblyName UIAutomationClient
      Add-Type -AssemblyName UIAutomationTypes
      Add-Type -AssemblyName System.Windows.Forms
      $processId = [int]$env:OPENOBSIDIAN_WINDOW_PROCESS_ID
      $targetName = $env:OPENOBSIDIAN_ACCESSIBLE_CONTROL_NAME
      $hintValue = $env:OPENOBSIDIAN_CANVAS_INPUT_HINT
      $replacement = $env:OPENOBSIDIAN_CANVAS_TEXT_ENTRY
      $root = [System.Windows.Automation.AutomationElement]::RootElement
      $processCondition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
        $processId
      )
      $deadline = [DateTime]::UtcNow.AddSeconds(20)
      do {
        $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $processCondition)
        foreach ($element in $elements) {
          try {
            $current = $element.Current
            if ($current.ControlType -ne [System.Windows.Automation.ControlType]::Edit) { continue }
            $pattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($current.Name -ne $targetName -and [string]$pattern.Current.Value -cne $hintValue) { continue }
            if ($pattern.Current.IsReadOnly) { throw "The accessible edit field is read-only: $targetName" }
            $pattern.SetValue($replacement)
            Start-Sleep -Milliseconds 150
            $actual = [string]$pattern.Current.Value
            $initialReadbackLength = $actual.Length
            $clipboardFallback = -not [string]::Equals($actual, $replacement, [System.StringComparison]::Ordinal)
            $readbackPolls = 1
            $clipboardSet = $false
            $clipboardVerified = $false
            $focusSet = $false
            $hasKeyboardFocus = $false
            $selectAllSent = $false
            $pasteSent = $false
            if ($clipboardFallback) {
              $clipboardFailureType = "none"
              $clipboardFailureMessage = "none"
              $clipboardApartmentState = [System.Threading.Thread]::CurrentThread.ApartmentState.ToString()
              $clipboardReadbackLength = -1
              $clipboardFirstDifferenceIndex = -1
              try {
                [System.Windows.Forms.Clipboard]::SetText($replacement, [System.Windows.Forms.TextDataFormat]::UnicodeText)
                $clipboardSet = $true
                $clipboardReadback = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::UnicodeText)
                $clipboardReadbackLength = $clipboardReadback.Length
                $clipboardVerified = [string]::Equals([string]$clipboardReadback, $replacement, [System.StringComparison]::Ordinal)
                if (-not $clipboardVerified) {
                  $clipboardFirstDifferenceIndex = 0
                  $clipboardCommonLength = [Math]::Min($clipboardReadbackLength, $replacement.Length)
                  while ($clipboardFirstDifferenceIndex -lt $clipboardCommonLength -and [string]::Equals([string]$clipboardReadback[$clipboardFirstDifferenceIndex], [string]$replacement[$clipboardFirstDifferenceIndex], [System.StringComparison]::Ordinal)) {
                    $clipboardFirstDifferenceIndex++
                  }
                  if ($clipboardFirstDifferenceIndex -eq $clipboardCommonLength -and $clipboardReadbackLength -eq $replacement.Length) { $clipboardFirstDifferenceIndex = -1 }
                  throw "Unicode clipboard readback did not exactly match the replacement"
                }
                $element.SetFocus()
                $focusSet = $true
                Start-Sleep -Milliseconds 120
                try { $hasKeyboardFocus = [bool]$element.Current.HasKeyboardFocus } catch { $hasKeyboardFocus = $false }
                [System.Windows.Forms.SendKeys]::SendWait("^a")
                $selectAllSent = $true
                Start-Sleep -Milliseconds 120
                [System.Windows.Forms.SendKeys]::SendWait("^v")
                $pasteSent = $true
              } catch {
                $clipboardFailureType = $_.Exception.GetType().Name
                $clipboardFailureMessage = $_.Exception.Message
                throw "OpenObsidian clipboard fallback failed for '$targetName' (expected_length=$($replacement.Length); initial_readback_length=$initialReadbackLength; clipboard_apartment_state=$clipboardApartmentState; clipboard_set=$clipboardSet; clipboard_verified=$clipboardVerified; clipboard_readback_length=$clipboardReadbackLength; clipboard_first_difference_index=$clipboardFirstDifferenceIndex; focus_set=$focusSet; has_keyboard_focus=$hasKeyboardFocus; select_all_sent=$selectAllSent; paste_sent=$pasteSent; error_type=$clipboardFailureType; error_message=$clipboardFailureMessage)"
              }
              $pasteDeadline = [DateTime]::UtcNow.AddSeconds(10)
              do {
                Start-Sleep -Milliseconds 50
                $readbackPolls++
                try { $actual = [string]$pattern.Current.Value } catch { $actual = "" }
                if ([string]::Equals($actual, $replacement, [System.StringComparison]::Ordinal)) { break }
              } while ([DateTime]::UtcNow -lt $pasteDeadline)
              $firstDifferenceIndex = 0
              $commonLength = [Math]::Min($actual.Length, $replacement.Length)
              while ($firstDifferenceIndex -lt $commonLength -and $actual[$firstDifferenceIndex] -ceq $replacement[$firstDifferenceIndex]) {
                $firstDifferenceIndex++
              }
              if ($firstDifferenceIndex -eq $commonLength -and $actual.Length -eq $replacement.Length) { $firstDifferenceIndex = -1 }
              if (-not [string]::Equals($actual, $replacement, [System.StringComparison]::Ordinal)) {
                throw "OpenObsidian exact readback failed for '$targetName' after clipboard paste (expected_length=$($replacement.Length); actual_length=$($actual.Length); first_difference_index=$firstDifferenceIndex; clipboard_apartment_state=$clipboardApartmentState; clipboard_set=$clipboardSet; clipboard_verified=$clipboardVerified; clipboard_readback_length=$clipboardReadbackLength; clipboard_first_difference_index=$clipboardFirstDifferenceIndex; focus_set=$focusSet; has_keyboard_focus=$hasKeyboardFocus; select_all_sent=$selectAllSent; paste_sent=$pasteSent; clipboard_fallback=true; polls=$readbackPolls)"
              }
            }
            [pscustomobject]@{
              name = $targetName
              action = if ($clipboardFallback) { "ValuePattern.SetValue + focused Ctrl+A and Unicode clipboard paste" } else { "ValuePattern.SetValue" }
              exact_readback = $true
              clipboard_fallback = $clipboardFallback
              clipboard_apartment_state = if ($clipboardFallback) { $clipboardApartmentState } else { "not_used" }
              clipboard_set = $clipboardSet
              clipboard_verified = $clipboardVerified
              focus_set = $focusSet
              has_keyboard_focus = $hasKeyboardFocus
              select_all_sent = $selectAllSent
              paste_sent = $pasteSent
              expected_length = $replacement.Length
              readback_length = $actual.Length
              readback_polls = $readbackPolls
            } | ConvertTo-Json -Compress
            exit 0
          } catch {
            if ($_.Exception.Message -like "The accessible edit field is read-only:*" -or $_.Exception.Message -like "OpenObsidian clipboard fallback failed*" -or $_.Exception.Message -like "OpenObsidian exact readback failed*" ) { throw }
          }
        }
        Start-Sleep -Milliseconds 250
      } while ([DateTime]::UtcNow -lt $deadline)
      throw "Accessible editable field was not found: $targetName"
    `;
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-STA", "-Command", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENOBSIDIAN_WINDOW_PROCESS_ID: String(processId),
        OPENOBSIDIAN_ACCESSIBLE_CONTROL_NAME: controlName,
        OPENOBSIDIAN_CANVAS_INPUT_HINT: canvasInputHintValues[controlName] ?? "",
        OPENOBSIDIAN_CANVAS_TEXT_ENTRY: value,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    await delay(250);
    return output;
  } else {
    throw new Error(`Canvas text entry is not configured for ${process.platform}`);
  }
}

type CanvasReferenceDocument = {
  nodes: Array<Record<string, unknown>>;
  edges: unknown[];
  [key: string]: unknown;
};

function canvasReferenceDocumentsWithEditedText(text: string): {
  seed: CanvasReferenceDocument;
  edited: CanvasReferenceDocument;
} {
  const seed = JSON.parse(readCanvasReferenceFixtureBytes().toString("utf8")) as CanvasReferenceDocument;
  const edited = JSON.parse(readCanvasReferenceFixtureBytes().toString("utf8")) as CanvasReferenceDocument;
  const selectedNode = edited.nodes.find((node) => node.id === "text-1" && node.type === "text");
  if (!selectedNode || selectedNode.text !== canvasMarker) {
    throw new Error("The Canvas editor fixture does not contain the expected text-1 source card");
  }
  selectedNode.text = text;
  return {seed, edited};
}

function canvasDocumentMatchesExpectedTextEdit(actual: unknown, expected: CanvasReferenceDocument): boolean {
  return isDeepStrictEqual(actual, expected);
}

async function runOpenObsidianCanvasTextEdit(
  seedSnapshot: SnapshotEntry[],
  expectedSeedCanvas: {bytes: number; sha256: string},
  seedDocument: CanvasReferenceDocument,
  expectedEditedDocument: CanvasReferenceDocument,
): Promise<{snapshot: SnapshotEntry[]; canvas: {bytes: number; sha256: string}}> {
  const canvasReport = report.canvas_reference_reopen as Record<string, unknown>;
  const editReport = canvasReport.text_edit as Record<string, unknown>;
  const snapshots = report.vault_snapshots as Record<string, unknown>;
  const logPath = join(reportDirectory, "openobsidian-canvas-text-edit.log");
  const userConfigRoot = join(workDirectory, "openobsidian-canvas-edit-user-config");
  const homeRoot = join(workDirectory, "openobsidian-canvas-edit-home");
  const localDataRoot = join(workDirectory, "openobsidian-canvas-edit-local-data");
  const appEnv: NodeJS.ProcessEnv = {...process.env, HOME: homeRoot};
  let appDataRoot: string;
  if (process.platform === "win32") {
    appEnv.APPDATA = userConfigRoot;
    appEnv.LOCALAPPDATA = localDataRoot;
    appEnv.USERPROFILE = homeRoot;
    appDataRoot = join(userConfigRoot, "OpenObsidian");
  } else if (process.platform === "darwin") {
    appDataRoot = join(homeRoot, "Library", "Application Support", "OpenObsidian");
  } else {
    appEnv.XDG_CONFIG_HOME = userConfigRoot;
    appEnv.XDG_CACHE_HOME = join(workDirectory, "openobsidian-canvas-edit-cache");
    appEnv.XDG_DATA_HOME = join(workDirectory, "openobsidian-canvas-edit-data");
    appEnv.LIBGL_ALWAYS_SOFTWARE = "1";
    appEnv.WGPU_BACKEND = "gl";
    appDataRoot = join(userConfigRoot, "OpenObsidian");
  }
  await mkdir(join(homeRoot, "Desktop"), {recursive: true});
  editReport.status = "running";
  editReport.source_canvas_path = canvasPath;
  editReport.source_text_node_id = "text-1";
  editReport.edited_text = canvasEditedText;
  editReport.accessible_labels = [
    "Edit Canvas text card",
    "Canvas edit path",
    "Canvas edit text-card ID",
    "Load Canvas text card",
    "Canvas text draft",
    "Save Canvas text",
    "Reload Canvas",
    "Cancel Canvas edit",
  ];
  editReport.save_policy = "The selected card is loaded into a draft; the vault must remain byte- and snapshot-identical until Save Canvas text is explicitly activated.";
  const screenshots: Record<string, string> = {};
  let child: ChildProcess | undefined;
  let window: {window_id: string; title: string; geometry: string} | undefined;
  try {
    child = launchLogged(openObsidianBinary, [], logPath, appEnv);
    editReport.pid = child.pid ?? null;
    await delay(1_000);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`OpenObsidian exited before Canvas text editing (code=${child.exitCode}, signal=${child.signalCode})`);
    }
    if (process.platform === "linux") {
      const x11Window = await waitFor("OpenObsidian Canvas text-edit window to become visible", async () => {
        try {
          const output = execFileSync("xdotool", ["search", "--onlyvisible", "--name", "OpenObsidian"], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
          const windowId = output.trim().split(/\s+/).filter(Boolean).at(-1);
          if (!windowId) return null;
          const title = execFileSync("xdotool", ["getwindowname", windowId], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
          const geometry = execFileSync("xdotool", ["getwindowgeometry", "--shell", windowId], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
          return {window_id: windowId, title, geometry};
        } catch {
          return null;
        }
      }, (value) => value !== null, 30_000);
      if (!x11Window) throw new Error("OpenObsidian did not expose a visible Canvas text-edit window");
      window = x11Window;
      xdotool("windowfocus", "--sync", window.window_id);
    } else {
      window = {window_id: String(child.pid ?? "unknown"), title: "OpenObsidian Canvas text-edit window", geometry: "native window bounds captured during screenshot"};
    }
    editReport.window = window;
    editReport.native_picker = await selectOpenObsidianVaultFromNativePicker(
      child,
      window,
      logPath,
      canvasVaultRoot,
      editReport,
      "openobsidian-canvas-text-edit",
    );
    const initialMarkdownCount = countMarkdownFiles(seedSnapshot);
    const opened = await waitFor("OpenObsidian to render the Canvas text-edit fixture vault", async () => {
      await delay(750);
      return await captureOpenObsidianScreenshot(window!.window_id, child!, "openobsidian-canvas-text-edit-selected", editReport);
    }, (capture) => ocrTextContainsFuzzyPhrase(capture.ocrText, canvasVaultName, 1)
      && new RegExp(`${initialMarkdownCount}\\s+Markdown files found`, "i").test(capture.ocrText), 30_000);
    screenshots.vault_selected = relative(reportDirectory, opened.windowPngPath);
    editReport.selected_vault_visible = true;
    editReport.markdown_count_before_edit = initialMarkdownCount;

    const canonicalVault = await realpath(canvasVaultRoot);
    const canonicalAppData = await realpath(appDataRoot);
    const relativeAppData = relative(canonicalVault, canonicalAppData);
    if (relativeAppData === "" || (!relativeAppData.startsWith(`..${sep}`) && relativeAppData !== ".." && !relativeAppData.startsWith(sep))) {
      throw new Error("OpenObsidian's Canvas text-edit application data directory is inside the selected vault");
    }
    editReport.app_data_root = `$RUNNER_TEMP/openobsidian-c01-roundtrip/${relative(workDirectory, appDataRoot).split(sep).join("/")}`;
    editReport.app_data_canonical_root_is_outside_vault = true;

    const beforeEdit = await snapshotTree(canvasVaultRoot);
    ensureExactSnapshot(seedSnapshot, beforeEdit, "Canvas vault before native text-card edit");
    const canvasBytesBefore = await readFile(join(canvasVaultRoot, canvasPath));
    const seedHash = createHash("sha256").update(canvasBytesBefore).digest("hex");
    if (canvasBytesBefore.length !== expectedSeedCanvas.bytes || seedHash !== expectedSeedCanvas.sha256) {
      throw new Error("OpenObsidian changed the Canvas source before native text-card edit");
    }
    if (beforeEdit.some((entry) => entry.path === canvasNotePath)) {
      throw new Error(`Canvas note destination already exists before native text-card edit: ${canvasNotePath}`);
    }
    editReport.vault_snapshot_before_edit = beforeEdit;
    editReport.canvas_bytes_before_edit = {bytes: canvasBytesBefore.length, sha256: seedHash};
    editReport.destination_absent_before_edit = true;

    const settledRefreshBeforeCanvasEditor = await waitForOpenObsidianRefreshIdle(
      0,
      initialMarkdownCount,
      false,
      logPath,
    );
    editReport.refresh_diagnostics_before_editor = {
      requests: settledRefreshBeforeCanvasEditor.requests,
      consumed_results: settledRefreshBeforeCanvasEditor.consumedResults,
      receiver_states: settledRefreshBeforeCanvasEditor.receiverStates,
      settled_for_ms: settledRefreshBeforeCanvasEditor.settled_for_ms,
    };

    const interactions: Record<string, string> = {};
    editReport.interactions = interactions;
    interactions.expand_canvas_text_edit = await invokeNativeAccessibleControl(
      child,
      window.window_id,
      "Edit Canvas text card",
      undefined,
      true,
    );
    const expandedForm = await waitFor(
      "OpenObsidian to expose the native Canvas text-edit fields",
      async () => await captureOpenObsidianScreenshot(window!.window_id, child!, "openobsidian-canvas-text-edit-expanded-form", editReport),
      (capture) => ocrTextContainsFuzzyPhrase(capture.ocrText, "Canvas edit path", 2)
        && ocrTextContainsFuzzyPhrase(capture.ocrText, "Canvas edit text-card ID", 2),
      30_000,
    );
    screenshots.expanded_form = relative(reportDirectory, expandedForm.windowPngPath);
    editReport.expanded_form_ocr = expandedForm.ocrText.slice(0, 4_000);

    const canvasPathReadback = await replaceOpenObsidianTextInput(child, window.window_id, "Canvas edit path", canvasPath, logPath);
    const textCardIdReadback = await replaceOpenObsidianTextInput(child, window.window_id, "Canvas edit text-card ID", "text-1", logPath);
    interactions.canvas_path = canvasPathReadback;
    interactions.text_card_id = textCardIdReadback;
    const inputReadbackEntries = [
      ["Canvas edit path", canvasPathReadback],
      ["Canvas edit text-card ID", textCardIdReadback],
    ] as Array<[string, string]>;
    const inputReadbacks = Object.fromEntries(inputReadbackEntries.map(([name, value]) => {
      try {
        const parsed = JSON.parse(value as string) as {exact_readback?: boolean; fallback?: {exact_readback?: boolean}};
        return [name, {exact_readback: parsed.exact_readback === true || parsed.fallback?.exact_readback === true, interaction: parsed}];
      } catch {
        return [name, {exact_readback: false, interaction: value}];
      }
    }));
    editReport.field_value_readbacks = inputReadbacks;
    const unverifiedInputs = Object.entries(inputReadbacks)
      .filter(([, result]) => !(result as {exact_readback?: boolean}).exact_readback)
      .map(([name]) => name);
    if (unverifiedInputs.length > 0) throw new Error(`Canvas edit inputs did not provide exact field-value readbacks: ${unverifiedInputs.join(", ")}`);

    const afterInput = await snapshotTree(canvasVaultRoot);
    ensureExactSnapshot(beforeEdit, afterInput, "Canvas path and text-card ID entry must not write to the vault");
    if ((await readFile(join(canvasVaultRoot, canvasPath))).compare(canvasBytesBefore) !== 0
      || afterInput.some((entry) => entry.path === canvasNotePath)) {
      throw new Error("Entering native Canvas edit inputs wrote to the vault or changed its Canvas source");
    }
    editReport.vault_snapshot_after_input = afterInput;
    editReport.no_write_during_input = true;

    await waitForOpenObsidianRefreshIdle(0, initialMarkdownCount, false, logPath);
    interactions.load = await invokeNativeAccessibleControl(child, window.window_id, "Load Canvas text card", undefined, true);
    const loadedDraft = await waitFor(
      "OpenObsidian to load the selected Canvas text-card draft",
      async () => await captureOpenObsidianScreenshot(window!.window_id, child!, "openobsidian-canvas-text-edit-loaded", editReport),
      (capture) => ocrTextContainsPhrase(capture.ocrText, "Canvas text draft")
        && ocrTextContainsPhrase(capture.ocrText, "Canvas text loaded")
        && capture.ocrText.includes(canvasMarker),
      30_000,
    );
    screenshots.loaded = relative(reportDirectory, loadedDraft.windowPngPath);
    editReport.loaded_ocr = loadedDraft.ocrText.slice(0, 4_000);
    const afterLoad = await snapshotTree(canvasVaultRoot);
    ensureExactSnapshot(afterInput, afterLoad, "Loading the Canvas text-card draft must not write to the vault");
    if ((await readFile(join(canvasVaultRoot, canvasPath))).compare(canvasBytesBefore) !== 0
      || afterLoad.some((entry) => entry.path === canvasNotePath)) {
      throw new Error("Loading the native Canvas text-card draft wrote to the vault or changed its source");
    }
    editReport.vault_snapshot_after_load = afterLoad;
    editReport.no_write_during_load = true;

    const draftReadback = await replaceOpenObsidianTextInput(child, window.window_id, "Canvas text draft", canvasEditedText, logPath);
    interactions.canvas_text_draft = draftReadback;
    let parsedDraftReadback: {exact_readback?: boolean; fallback?: {exact_readback?: boolean}};
    try {
      parsedDraftReadback = JSON.parse(draftReadback) as {exact_readback?: boolean; fallback?: {exact_readback?: boolean}};
    } catch {
      parsedDraftReadback = {};
    }
    editReport.draft_readback_exact = parsedDraftReadback.exact_readback === true || parsedDraftReadback.fallback?.exact_readback === true;
    if (!editReport.draft_readback_exact) {
      throw new Error("The native Canvas text draft did not provide an exact field-value readback");
    }
    const afterDraft = await snapshotTree(canvasVaultRoot);
    ensureExactSnapshot(afterLoad, afterDraft, "Editing the Canvas draft must not write to the vault before Save Canvas text");
    if ((await readFile(join(canvasVaultRoot, canvasPath))).compare(canvasBytesBefore) !== 0
      || afterDraft.some((entry) => entry.path === canvasNotePath)) {
      throw new Error("Editing the Canvas text draft wrote to the vault before explicit save");
    }
    editReport.vault_snapshot_after_draft = afterDraft;
    editReport.no_write_before_save = true;

    interactions.save = await invokeNativeAccessibleControl(child, window.window_id, "Save Canvas text", undefined, true);
    const savedCanvasBytes = await waitFor("OpenObsidian to save the selected Canvas text card", async () => {
      try {
        const bytes = await readFile(join(canvasVaultRoot, canvasPath));
        let document: unknown;
        try {
          document = JSON.parse(bytes.toString("utf8")) as unknown;
        } catch {
          return null;
        }
        return canvasDocumentMatchesExpectedTextEdit(document, expectedEditedDocument) ? bytes : null;
      } catch {
        return null;
      }
    }, (bytes) => bytes !== null, 15_000);
    if (!savedCanvasBytes) throw new Error("Saving the Canvas text draft did not produce the exact expected Canvas document");
    const savedCanvasHash = createHash("sha256").update(savedCanvasBytes).digest("hex");
    let savedDocument: unknown;
    try {
      savedDocument = JSON.parse(savedCanvasBytes.toString("utf8")) as unknown;
    } catch (error) {
      throw new Error(`Saved Canvas text edit was not valid JSON: ${error instanceof Error ? error.message : "unknown parse error"}`);
    }
    if (!canvasDocumentMatchesExpectedTextEdit(savedDocument, expectedEditedDocument)) {
      await writeFile(join(reportDirectory, "canvas-text-edit-incorrect-output.canvas"), savedCanvasBytes);
      throw new Error("Saved Canvas JSON did not equal the seed document with only text-1.text changed");
    }
    const afterSave = await snapshotTree(canvasVaultRoot);
    const saveChanges = changedPaths(afterDraft, afterSave);
    if (saveChanges.length !== 1 || saveChanges[0]?.path !== canvasPath
      || saveChanges[0]?.before?.kind !== "file" || saveChanges[0]?.after?.kind !== "file") {
      throw new Error(`Saving Canvas text changed paths beyond the selected Canvas file: ${JSON.stringify(saveChanges).slice(0, 4_000)}`);
    }
    if (afterSave.some((entry) => entry.path === canvasNotePath)
      || countMarkdownFiles(afterSave) !== countMarkdownFiles(afterDraft)) {
      throw new Error("Saving the native Canvas text card created or changed a Markdown note");
    }
    const allNonTargetDataPreserved = isDeepStrictEqual(savedDocument, expectedEditedDocument)
      && expectedEditedDocument.nodes.some((node) => node.id === "file-1")
      && expectedEditedDocument.nodes.some((node) => node.id === "group-1")
      && isDeepStrictEqual(expectedEditedDocument.nodes.filter((node) => node.id !== "text-1"), seedDocument.nodes.filter((node) => node.id !== "text-1"))
      && isDeepStrictEqual(expectedEditedDocument.edges, seedDocument.edges);
    if (!allNonTargetDataPreserved) {
      throw new Error("Saving the Canvas edit changed a sibling node, an edge, or other non-target document data");
    }
    editReport.status = "passed";
    editReport.interactions = interactions;
    editReport.screenshots = screenshots;
    editReport.vault_snapshot_after_save = afterSave;
    editReport.vault_changes_from_explicit_save = saveChanges;
    editReport.canvas_bytes_after_save = {bytes: savedCanvasBytes.length, sha256: savedCanvasHash};
    editReport.saved_document_matches_only_selected_text_change = true;
    editReport.selected_node_other_fields_preserved = true;
    editReport.sibling_nodes_and_edges_preserved = true;
    editReport.all_unselected_canvas_fields_preserved = true;
    editReport.no_markdown_created = true;
    snapshots.canvas_text_edit_before = beforeEdit;
    snapshots.canvas_text_edit_after = afterSave;
    await writeFile(join(reportDirectory, "canvas-text-edit-before.json"), `${JSON.stringify(beforeEdit, null, 2)}\n`);
    await writeFile(join(reportDirectory, "canvas-text-edit-after.json"), `${JSON.stringify(afterSave, null, 2)}\n`);
    await writeFile(join(reportDirectory, "canvas-text-edit-source-before.canvas"), canvasBytesBefore);
    await writeFile(join(reportDirectory, "canvas-text-edit-source-after.canvas"), savedCanvasBytes);
    editReport.artifacts = {
      openobsidian_log: "openobsidian-canvas-text-edit.log",
      before_snapshot: "canvas-text-edit-before.json",
      after_snapshot: "canvas-text-edit-after.json",
      source_before: "canvas-text-edit-source-before.canvas",
      source_after: "canvas-text-edit-source-after.canvas",
    };
    await saveReport();

    await delay(1_000);
    await stopProcess(child);
    child = undefined;
    const afterClose = await snapshotTree(canvasVaultRoot);
    ensureExactSnapshot(afterSave, afterClose, "OpenObsidian close after native Canvas text edit");
    const closedBytes = await readFile(join(canvasVaultRoot, canvasPath));
    if (closedBytes.compare(savedCanvasBytes) !== 0 || afterClose.some((entry) => entry.path === canvasNotePath)) {
      throw new Error("OpenObsidian changed the saved Canvas edit on close or created a Markdown note");
    }
    editReport.vault_snapshot_after_close = afterClose;
    editReport.canvas_bytes_after_close = {bytes: closedBytes.length, sha256: createHash("sha256").update(closedBytes).digest("hex")};
    editReport.vault_unchanged_after_close = true;
    await saveReport();
    return {
      snapshot: afterClose,
      canvas: {bytes: closedBytes.length, sha256: createHash("sha256").update(closedBytes).digest("hex")},
    };
  } catch (error) {
    editReport.status = "failed";
    editReport.error = error instanceof Error ? error.message : String(error);
    editReport.screenshots = screenshots;
    await saveReport();
    throw error;
  } finally {
    await stopProcess(child).catch(() => undefined);
  }
}

async function runOpenObsidianCanvasNoteCreation(
  seedSnapshot: SnapshotEntry[],
  expectedCanvas: {bytes: number; sha256: string},
  expectedText: string,
): Promise<SnapshotEntry[]> {
  const canvasReport = report.canvas_reference_reopen as Record<string, unknown>;
  const noteReport = canvasReport.note_creation as Record<string, unknown>;
  const snapshots = report.vault_snapshots as Record<string, unknown>;
  const expectedNoteBytes = Buffer.from(expectedText, "utf8");
  const expectedNoteSha256 = createHash("sha256").update(expectedNoteBytes).digest("hex");
  const userConfigRoot = join(workDirectory, "openobsidian-canvas-user-config");
  const homeRoot = join(workDirectory, "openobsidian-canvas-home");
  const localDataRoot = join(workDirectory, "openobsidian-canvas-local-data");
  const appEnv: NodeJS.ProcessEnv = {...process.env, HOME: homeRoot};
  let appDataRoot: string;
  if (process.platform === "win32") {
    appEnv.APPDATA = userConfigRoot;
    appEnv.LOCALAPPDATA = localDataRoot;
    appEnv.USERPROFILE = homeRoot;
    appDataRoot = join(userConfigRoot, "OpenObsidian");
  } else if (process.platform === "darwin") {
    appDataRoot = join(homeRoot, "Library", "Application Support", "OpenObsidian");
  } else {
    appEnv.XDG_CONFIG_HOME = userConfigRoot;
    appEnv.XDG_CACHE_HOME = join(workDirectory, "openobsidian-canvas-cache");
    appEnv.XDG_DATA_HOME = join(workDirectory, "openobsidian-canvas-data");
    appEnv.LIBGL_ALWAYS_SOFTWARE = "1";
    appEnv.WGPU_BACKEND = "gl";
    appDataRoot = join(userConfigRoot, "OpenObsidian");
  }
  await mkdir(join(homeRoot, "Desktop"), {recursive: true});
  noteReport.status = "running";
  noteReport.source_canvas_path = canvasPath;
  noteReport.source_text_node_id = "text-1";
  noteReport.output_path = canvasNotePath;
  noteReport.expected_note_bytes = expectedNoteBytes.length;
  noteReport.expected_note_sha256 = expectedNoteSha256;
  noteReport.expected_note_text = expectedText;
  noteReport.body_is_exact_canvas_text = true;
  noteReport.accessible_labels = [
    "Create note from Canvas text card",
    "Canvas path",
    "Text card ID",
    "New Markdown path",
    "Preview note creation",
    "Review and confirm note creation",
    "Confirm and create note",
  ];
  const screenshots: Record<string, string> = {};
  let child: ChildProcess | undefined;
  let window: {window_id: string; title: string; geometry: string} | undefined;
  try {
    child = launchLogged(openObsidianBinary, [], join(reportDirectory, "openobsidian-canvas-note-create.log"), appEnv);
    noteReport.pid = child.pid ?? null;
    await delay(1_000);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`OpenObsidian exited before Canvas note creation (code=${child.exitCode}, signal=${child.signalCode})`);
    }
    if (process.platform === "linux") {
      const x11Window = await waitFor("OpenObsidian Canvas note-creation window to become visible", async () => {
        try {
          const output = execFileSync("xdotool", ["search", "--onlyvisible", "--name", "OpenObsidian"], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
          const windowId = output.trim().split(/\s+/).filter(Boolean).at(-1);
          if (!windowId) return null;
          const title = execFileSync("xdotool", ["getwindowname", windowId], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
          const geometry = execFileSync("xdotool", ["getwindowgeometry", "--shell", windowId], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
          return {window_id: windowId, title, geometry};
        } catch {
          return null;
        }
      }, (value) => value !== null, 30_000);
      if (!x11Window) throw new Error("OpenObsidian did not expose a visible Canvas note-creation window");
      window = x11Window;
      xdotool("windowfocus", "--sync", window.window_id);
    } else {
      window = {window_id: String(child.pid ?? "unknown"), title: "OpenObsidian Canvas note-creation window", geometry: "native window bounds captured during screenshot"};
    }
    noteReport.window = window;
    noteReport.native_picker = await selectOpenObsidianVaultFromNativePicker(
      child,
      window,
      join(reportDirectory, "openobsidian-canvas-note-create.log"),
      canvasVaultRoot,
      noteReport,
      "openobsidian-canvas-note-create",
    );
    const initialMarkdownCount = countMarkdownFiles(seedSnapshot);
    const opened = await waitFor("OpenObsidian to render the Canvas fixture vault", async () => {
      await delay(750);
      return await captureOpenObsidianScreenshot(window!.window_id, child!, "openobsidian-canvas-note-create-selected", noteReport);
    }, (capture) => ocrTextContainsFuzzyPhrase(capture.ocrText, canvasVaultName, 1)
      && new RegExp(`${initialMarkdownCount}\\s+Markdown files found`, "i").test(capture.ocrText), 30_000);
    screenshots.vault_selected = relative(reportDirectory, opened.windowPngPath);
    noteReport.selected_vault_visible = true;
    noteReport.markdown_count_before_creation = initialMarkdownCount;
    const canonicalVault = await realpath(canvasVaultRoot);
    const canonicalAppData = await realpath(appDataRoot);
    const relativeAppData = relative(canonicalVault, canonicalAppData);
    if (relativeAppData === "" || (!relativeAppData.startsWith(`..${sep}`) && relativeAppData !== ".." && !relativeAppData.startsWith(sep))) {
      throw new Error("OpenObsidian's Canvas note-creation application data directory is inside the selected vault");
    }
    noteReport.app_data_root = `$RUNNER_TEMP/openobsidian-c01-roundtrip/${relative(workDirectory, appDataRoot).split(sep).join("/")}`;
    noteReport.app_data_canonical_root_is_outside_vault = true;
    const appDataBeforeCreation = await snapshotTree(appDataRoot);
    noteReport.app_data_snapshot_before_creation = appDataBeforeCreation;

    const noteBefore = await snapshotTree(canvasVaultRoot);
    ensureExactSnapshot(seedSnapshot, noteBefore, "Canvas vault before native note-creation preview");
    const canvasBytesBefore = await readFile(join(canvasVaultRoot, canvasPath));
    if (canvasBytesBefore.length !== expectedCanvas.bytes || createHash("sha256").update(canvasBytesBefore).digest("hex") !== expectedCanvas.sha256) {
      throw new Error("OpenObsidian changed the Canvas source before note creation");
    }
    if (noteBefore.some((entry) => entry.path === canvasNotePath)) {
      throw new Error(`Canvas note destination already exists before explicit confirmation: ${canvasNotePath}`);
    }
    noteReport.vault_snapshot_before_preview = noteBefore;
    noteReport.destination_absent_before_confirmation = true;

    const interactions: Record<string, string> = {};
    noteReport.interactions = interactions;
    interactions.expand_canvas_creation = await invokeNativeAccessibleControl(
      child,
      window.window_id,
      "Create note from Canvas text card",
      undefined,
      true,
    );
    const expandedForm = await waitFor(
      "OpenObsidian to expose the Canvas note-creation fields",
      async () => await captureOpenObsidianScreenshot(window!.window_id, child!, "openobsidian-canvas-note-create-expanded-form", noteReport),
      (capture) => ocrTextContainsPhrase(capture.ocrText, "Canvas path")
        && ocrTextContainsPhrase(capture.ocrText, "Text card ID")
        && ocrTextContainsPhrase(capture.ocrText, "New Markdown path"),
      30_000,
    );
    screenshots.expanded_form = relative(reportDirectory, expandedForm.windowPngPath);
    noteReport.expanded_form_ocr = expandedForm.ocrText.slice(0, 4_000);
    const canvasPathReadback = await replaceOpenObsidianTextInput(child, window!.window_id, "Canvas path", canvasPath);
    const textCardIdReadback = await replaceOpenObsidianTextInput(child, window!.window_id, "Text card ID", "text-1");
    const markdownPathReadback = await replaceOpenObsidianTextInput(child, window!.window_id, "New Markdown path", canvasNotePath);
    interactions.canvas_path = canvasPathReadback;
    interactions.text_card_id = textCardIdReadback;
    interactions.new_markdown_path = markdownPathReadback;
    const readbackEntries = [
      ["Canvas path", canvasPathReadback],
      ["Text card ID", textCardIdReadback],
      ["New Markdown path", markdownPathReadback],
    ] as Array<[string, string]>;
    const fieldReadbacks = Object.fromEntries(readbackEntries.map(([name, result]) => {
      try {
        const parsed = JSON.parse(result) as {exact_readback?: boolean; fallback?: {exact_readback?: boolean}};
        const exactReadback = parsed.exact_readback === true || parsed.fallback?.exact_readback === true;
        return [name, {exact_readback: exactReadback, interaction: parsed}];
      } catch {
        return [name, {exact_readback: false, interaction: result}];
      }
    }));
    noteReport.field_value_readbacks = fieldReadbacks;
    const unverifiedFields = Object.entries(fieldReadbacks).filter(([, result]) => !(result as {exact_readback?: boolean}).exact_readback).map(([name]) => name);
    if (unverifiedFields.length > 0) throw new Error(`Canvas form inputs did not provide exact field-value readbacks: ${unverifiedFields.join(", ")}`);
    const ready = await captureOpenObsidianScreenshot(window!.window_id, child!, "openobsidian-canvas-note-create-form", noteReport);
    if (!canvasFormFieldLabelsVisible(ready.ocrText)) {
      throw new Error(`Canvas note-creation form labels were not visible after exact field-value readback: ${JSON.stringify(ready.ocrText.slice(0, 2_000))}`);
    }
    screenshots.form = relative(reportDirectory, ready.windowPngPath);
    noteReport.form_ocr = ready.ocrText.slice(0, 4_000);
    const afterForm = await snapshotTree(canvasVaultRoot);
    ensureExactSnapshot(noteBefore, afterForm, "Canvas note-creation form must not write to the vault");
    if ((await readFile(join(canvasVaultRoot, canvasPath))).compare(canvasBytesBefore) !== 0
      || afterForm.some((entry) => entry.path === canvasNotePath)) {
      throw new Error("Entering Canvas note-creation form values wrote to the vault or changed the source Canvas");
    }
    noteReport.vault_snapshot_after_form = afterForm;
    noteReport.no_write_during_form_entry = true;

    interactions.preview = await invokeNativeAccessibleControl(
      child,
      window.window_id,
      "Preview note creation",
      "Create note from Canvas text card",
      true,
    );
    const preview = await waitFor(
      "OpenObsidian to show the exact Canvas text-card preview",
      async () => await captureOpenObsidianScreenshot(window!.window_id, child!, "openobsidian-canvas-note-create-preview", noteReport),
      (capture) => capture.ocrText.includes(canvasMarker)
        && (capture.ocrText.includes("Exact note body")
          || capture.ocrText.includes("Review and confirm note creation"))
        && capture.ocrText.includes(canvasNotePath)
        && capture.ocrText.includes(canvasPath),
      30_000,
    );
    screenshots.preview = relative(reportDirectory, preview.windowPngPath);
    noteReport.preview_ocr = preview.ocrText.slice(0, 4_000);
    const afterPreview = await snapshotTree(canvasVaultRoot);
    ensureExactSnapshot(noteBefore, afterPreview, "Canvas note-creation preview must not write to the vault");
    if ((await readFile(join(canvasVaultRoot, canvasPath))).compare(canvasBytesBefore) !== 0) {
      throw new Error("Canvas note-creation preview changed the source Canvas bytes");
    }
    if (afterPreview.some((entry) => entry.path === canvasNotePath)) {
      throw new Error("Canvas note-creation preview wrote the Markdown destination before confirmation");
    }
    noteReport.vault_snapshot_after_preview = afterPreview;
    noteReport.no_write_during_preview = true;

    interactions.review = await invokeNativeAccessibleControl(
      child,
      window.window_id,
      "Review and confirm note creation",
      "Exact note body",
      true,
    );
    const review = await waitFor(
      "OpenObsidian to show the final Canvas note-creation confirmation",
      async () => await captureOpenObsidianScreenshot(window!.window_id, child!, "openobsidian-canvas-note-create-review", noteReport),
      (capture) => capture.ocrText.includes(canvasMarker)
        && capture.ocrText.includes(canvasNotePath)
        && ocrTextContainsFuzzyPhrase(capture.ocrText, "from this Canvas text card", 1),
      30_000,
    );
    screenshots.review = relative(reportDirectory, review.windowPngPath);
    noteReport.review_ocr = review.ocrText.slice(0, 4_000);
    const afterReview = await snapshotTree(canvasVaultRoot);
    ensureExactSnapshot(afterPreview, afterReview, "Canvas note-creation review must not write to the vault");
    if (afterReview.some((entry) => entry.path === canvasNotePath)) {
      throw new Error("Canvas note-creation review wrote the Markdown destination before explicit confirmation");
    }
    noteReport.vault_snapshot_after_review = afterReview;
    noteReport.no_write_during_review = true;

    interactions.confirm = await invokeNativeAccessibleControl(child, window.window_id, "Confirm and create note", undefined, true);
    const confirmedBytes = await waitFor("OpenObsidian to create the confirmed Canvas note", async () => {
      try {
        return await readFile(join(canvasVaultRoot, canvasNotePath));
      } catch {
        return null;
      }
    }, (bytes) => bytes !== null, 15_000);
    if (confirmedBytes === null) {
      throw new Error(`OpenObsidian did not create the confirmed Canvas note at ${canvasNotePath}`);
    }
    if (!confirmedBytes.equals(expectedNoteBytes)) {
      await writeFile(join(reportDirectory, "canvas-note-creation-incorrect-output.md"), confirmedBytes);
      throw new Error(`Created Canvas note bytes differ from the exact text card body: expected ${expectedNoteBytes.length} bytes / ${expectedNoteSha256}, got ${confirmedBytes.length} bytes / ${createHash("sha256").update(confirmedBytes).digest("hex")}`);
    }
    const afterCreate = await snapshotTree(canvasVaultRoot);
    const createChanges = changedPaths(afterReview, afterCreate);
    if (createChanges.length !== 1 || createChanges[0]?.path !== canvasNotePath || createChanges[0]?.before !== undefined || createChanges[0]?.after?.kind !== "file") {
      throw new Error(`Explicit Canvas note creation changed unexpected vault paths: ${JSON.stringify(createChanges).slice(0, 4_000)}`);
    }
    const canvasBytesAfter = await readFile(join(canvasVaultRoot, canvasPath));
    const canvasHashAfter = createHash("sha256").update(canvasBytesAfter).digest("hex");
    if (canvasBytesAfter.length !== expectedCanvas.bytes || canvasHashAfter !== expectedCanvas.sha256) {
      await writeFile(join(reportDirectory, "canvas-note-creation-changed-source.canvas"), canvasBytesAfter);
      throw new Error("Explicit Canvas note creation changed the Canvas source bytes");
    }
    noteReport.status = "passed";
    noteReport.confirmation_interaction = interactions.confirm;
    noteReport.interactions = interactions;
    noteReport.screenshots = screenshots;
    noteReport.expected_note_body_sha256 = expectedNoteSha256;
    noteReport.created_note_bytes = confirmedBytes.length;
    noteReport.created_note_sha256 = createHash("sha256").update(confirmedBytes).digest("hex");
    noteReport.created_note_matches_exact_canvas_text = true;
    noteReport.vault_changes_from_explicit_creation = createChanges;
    noteReport.canvas_bytes_before_creation = {bytes: canvasBytesBefore.length, sha256: expectedCanvas.sha256};
    noteReport.canvas_bytes_after_creation = {bytes: canvasBytesAfter.length, sha256: canvasHashAfter};
    noteReport.canvas_unchanged = true;
    noteReport.vault_snapshot_after_creation = afterCreate;
    snapshots.canvas_note_creation_before = noteBefore;
    snapshots.canvas_note_creation_after = afterCreate;
    await writeFile(join(reportDirectory, "canvas-note-creation-before.json"), `${JSON.stringify(noteBefore, null, 2)}\n`);
    await writeFile(join(reportDirectory, "canvas-note-creation-after.json"), `${JSON.stringify(afterCreate, null, 2)}\n`);
    await writeFile(join(reportDirectory, "canvas-note-creation-source.canvas"), canvasBytesAfter);
    await writeFile(join(reportDirectory, "canvas-note-creation-note.md"), confirmedBytes);
    noteReport.artifacts = {
      openobsidian_log: "openobsidian-canvas-note-create.log",
      before_snapshot: "canvas-note-creation-before.json",
      after_snapshot: "canvas-note-creation-after.json",
      source_canvas_bytes: "canvas-note-creation-source.canvas",
      created_note_bytes: "canvas-note-creation-note.md",
    };
    await saveReport();

    await delay(1_000);
    await stopProcess(child);
    child = undefined;
    const afterClose = await snapshotTree(canvasVaultRoot);
    ensureExactSnapshot(afterCreate, afterClose, "OpenObsidian close after Canvas note creation");
    if ((await readFile(join(canvasVaultRoot, canvasPath))).compare(canvasBytesBefore) !== 0) {
      throw new Error("OpenObsidian changed the Canvas source after note creation when closing");
    }
    noteReport.vault_snapshot_after_close = afterClose;
    const appDataAfterCreation = await snapshotTree(appDataRoot);
    const appDataChangesFromCreation = changedPaths(appDataBeforeCreation, appDataAfterCreation);
    const eframeFilesAfterCreation = await readSnapshotTextFiles(
      appDataRoot,
      appDataAfterCreation,
      (path) => path.toLowerCase().endsWith(".ron"),
    );
    noteReport.app_data_snapshot_after_creation = appDataAfterCreation;
    noteReport.app_data_changes_from_creation = appDataChangesFromCreation;
    noteReport.eframe_persistence_files_after_creation = eframeFilesAfterCreation;
    await saveReport();
    const transactionValidation = await validateCanvasNoteCreationAppDataTransaction(
      appDataBeforeCreation,
      appDataAfterCreation,
      appDataChangesFromCreation,
      appDataRoot,
      canonicalAppData,
      canvasVaultRoot,
      canvasNotePath,
      expectedNoteBytes,
      expectedNoteSha256,
    );
    noteReport.app_data_creation_transaction_validation = transactionValidation;
    noteReport.app_data_change_policy_passed = true;
    noteReport.vault_unchanged_after_close = true;
    await saveReport();
    return afterClose;
  } catch (error) {
    noteReport.status = "failed";
    noteReport.error = error instanceof Error ? error.message : String(error);
    noteReport.screenshots = screenshots;
    await saveReport();
    throw error;
  } finally {
    await stopProcess(child).catch(() => undefined);
  }
}

async function runCanvasReferenceProbe(): Promise<void> {
  const profileDirectory = join(workDirectory, "canvas-obsidian-profile");
  const canvasReport = report.canvas_reference_reopen as Record<string, unknown>;
  const snapshots = report.vault_snapshots as Record<string, unknown>;
  canvasReport.status = "running";
  let firstProcess: ChildProcess | undefined;
  let firstConnection: DevToolsConnection | undefined;
  let secondProcess: ChildProcess | undefined;
  let secondConnection: DevToolsConnection | undefined;
  try {
    const seedCanvas = await createCanvasReferenceFixture();
    const {seed: seedDocument, edited: expectedEditedDocument} = canvasReferenceDocumentsWithEditedText(canvasEditedText);
    const seedSnapshot = await snapshotTree(canvasVaultRoot);
    snapshots.canvas_reference_seed = seedSnapshot;
    const textEdit = await runOpenObsidianCanvasTextEdit(
      seedSnapshot,
      seedCanvas,
      seedDocument,
      expectedEditedDocument,
    );
    const expectedCanvas = textEdit.canvas;
    const editedSnapshot = textEdit.snapshot;
    snapshots.canvas_reference_after_native_text_edit = editedSnapshot;
    canvasReport.source_after_native_text_edit = expectedCanvas;
    canvasReport.edited_text = canvasEditedText;
    const expectedCreatedNoteBytes = Buffer.from(canvasEditedText, "utf8");
    const postCreateBaseline = await runOpenObsidianCanvasNoteCreation(editedSnapshot, expectedCanvas, canvasEditedText);
    snapshots.canvas_reference_after_native_note_creation = postCreateBaseline;
    canvasReport.note_creation_baseline_includes_created_note = postCreateBaseline.some((entry) => (
      entry.path === canvasNotePath
      && entry.kind === "file"
      && entry.bytes === expectedCreatedNoteBytes.length
      && entry.sha256 === createHash("sha256").update(expectedCreatedNoteBytes).digest("hex")
    ));
    if (!canvasReport.note_creation_baseline_includes_created_note) {
      throw new Error("The post-creation Canvas vault baseline does not contain the exact new Markdown note");
    }
    const noteBeforeFirstOpen = await assertCanvasCreatedNoteSource(expectedCreatedNoteBytes, "before the first Obsidian open");
    firstProcess = await createObsidianProfile(profileDirectory, 9224, "obsidian-canvas-first-open.log");
    const first = await connectObsidian(9224);
    firstConnection = first.connection;
    const firstSession: Record<string, unknown> = {
      devtools_browser: first.browserVersion,
      first_target: {title: first.target.title ?? "", url: first.target.url ?? ""},
      source_before_open: expectedCanvas,
      created_note_source_before_open: noteBeforeFirstOpen,
    };
    canvasReport.first_session = firstSession;
    const firstRunBody = await waitForRenderer(
      firstConnection,
      "document.body?.innerText ?? ''",
      (body) => body.includes("Open folder as vault"),
      "Obsidian's first-run Canvas reference vault screen",
    );
    firstSession.first_run_text = firstRunBody.slice(0, 2_000);
    await captureObsidianScreenshot(firstConnection, "obsidian-canvas-first-run.png");
    firstConnection = await chooseVaultDirectory(firstConnection, 9224, {
      targetRoot: canvasVaultRoot,
      reporter: canvasReport,
      screenshotPrefix: "obsidian-canvas",
    });
    await chooseRestrictedMode(firstConnection, firstSession, canvasVaultName, canvasMarker);
    const firstView = await verifyCanvasReferenceVisible(
      firstConnection,
      expectedCanvas,
      "obsidian-canvas-first-open.png",
      "Canvas reference first open",
    );
    firstSession.canvas_view = {
      marker_visible_in_body: firstView.body.includes(canvasMarker),
      edited_text_visible_in_body: firstView.body.includes(canvasEditedText),
      path_visible_in_file_explorer: firstView.paths.includes(canvasPath),
      target_subpath_content_visible: firstView.body.includes(canvasTargetText),
      target_subpath_resolution_error_absent: !firstView.body.includes("Unable to find"),
      title: firstView.title,
      body: firstView.body.slice(0, 4_000),
      bytes: firstView.bytes,
      sha256: firstView.sha256,
      screenshot: "obsidian-canvas-first-open.png",
    };
    if (!firstView.body.includes(canvasEditedText)) {
      throw new Error("Obsidian's first open did not render the text saved by the native Canvas editor");
    }
    const firstCreatedNoteView = await verifyCanvasCreatedNoteVisible(
      firstConnection,
      "obsidian-canvas-created-note-first-open.png",
      "Canvas-created Markdown note first open",
    );
    const firstCreatedNoteSource = await assertCanvasCreatedNoteSource(expectedCreatedNoteBytes, "during the first Obsidian open");
    firstSession.created_note_view = {
      path: canvasNotePath,
      path_visible_in_file_explorer: firstCreatedNoteView.paths.includes(canvasNotePath),
      active_file_path: firstCreatedNoteView.active_file_path,
      active_tree_path: firstCreatedNoteView.active_tree_path,
      active_view_type: firstCreatedNoteView.active_view_type,
      active_view_is_markdown: firstCreatedNoteView.active_view_is_markdown,
      exact_text_card_body_visible: firstCreatedNoteView.active_view_text.includes(canvasEditedText),
      title: firstCreatedNoteView.title,
      body: firstCreatedNoteView.body.slice(0, 2_000),
      editor: firstCreatedNoteView.editor.slice(0, 2_000),
      active_view_text: firstCreatedNoteView.active_view_text.slice(0, 2_000),
      source_bytes: firstCreatedNoteSource.bytes,
      source_sha256: firstCreatedNoteSource.sha256,
      screenshot: "obsidian-canvas-created-note-first-open.png",
    };
    if (!firstSession.created_note_view || !firstCreatedNoteView.paths.includes(canvasNotePath)
      || (firstCreatedNoteView.active_file_path !== canvasNotePath && firstCreatedNoteView.active_tree_path !== canvasNotePath)
      || !firstCreatedNoteView.active_view_is_markdown
      || !firstCreatedNoteView.active_view_text.includes(canvasEditedText)) {
      throw new Error("Obsidian's first open did not activate and render the explicitly created Canvas text-card Markdown note");
    }
    await delay(2_000);
    await stopProcess(firstProcess, firstConnection);
    firstProcess = undefined;
    firstConnection = undefined;

    const afterFirstClose = await snapshotTree(canvasVaultRoot);
    snapshots.canvas_reference_after_first_close = afterFirstClose;
    const firstCloseCanvas = await assertCanvasReferenceSource(expectedCanvas, expectedEditedDocument, "the first Obsidian shutdown");
    const firstCloseNote = await assertCanvasCreatedNoteSource(expectedCreatedNoteBytes, "the first Obsidian shutdown");
    firstSession.created_note_source_after_close = firstCloseNote;
    const firstCloseChanges = changedPaths(postCreateBaseline, afterFirstClose);
    const firstCloseUnexpectedChanges = firstCloseChanges.filter((change) => (
      change.path !== canvasPath && !workspaceStateAllowlist.includes(change.path)
    ));
    if (firstCloseUnexpectedChanges.length > 0) {
      throw new Error(`Canvas reference first open changed unapproved vault content: ${JSON.stringify(firstCloseUnexpectedChanges).slice(0, 6_000)}`);
    }
    snapshots.canvas_reference_first_open_vault_changes = firstCloseChanges;
    firstSession.source_after_close = firstCloseCanvas;
    firstSession.vault_changes_during_obsidian_session = firstCloseChanges;

    const beforeSecondOpen = afterFirstClose;
    snapshots.canvas_reference_before_second_open = beforeSecondOpen;
    const noteBeforeSecondOpen = await assertCanvasCreatedNoteSource(expectedCreatedNoteBytes, "before the reopened Obsidian session");
    secondProcess = await createObsidianProfile(profileDirectory, 9225, "obsidian-canvas-reopen.log");
    const second = await connectObsidian(9225);
    secondConnection = second.connection;
    const secondSession: Record<string, unknown> = {
      devtools_browser: second.browserVersion,
      first_target: {title: second.target.title ?? "", url: second.target.url ?? ""},
      source_before_reopen: firstCloseCanvas,
      created_note_source_before_reopen: noteBeforeSecondOpen,
    };
    canvasReport.second_session = secondSession;
    await chooseRestrictedMode(secondConnection, secondSession, canvasVaultName, canvasMarker);
    const secondView = await verifyCanvasReferenceVisible(
      secondConnection,
      firstCloseCanvas,
      "obsidian-canvas-reopened.png",
      "Canvas reference reopen",
    );
    secondSession.canvas_view = {
      marker_visible_in_body: secondView.body.includes(canvasMarker),
      edited_text_visible_in_body: secondView.body.includes(canvasEditedText),
      path_visible_in_file_explorer: secondView.paths.includes(canvasPath),
      target_subpath_content_visible: secondView.body.includes(canvasTargetText),
      target_subpath_resolution_error_absent: !secondView.body.includes("Unable to find"),
      title: secondView.title,
      body: secondView.body.slice(0, 4_000),
      bytes: secondView.bytes,
      sha256: secondView.sha256,
      screenshot: "obsidian-canvas-reopened.png",
    };
    if (!secondView.body.includes(canvasEditedText)) {
      throw new Error("Obsidian's reopened session did not render the text saved by the native Canvas editor");
    }
    const secondCreatedNoteView = await verifyCanvasCreatedNoteVisible(
      secondConnection,
      "obsidian-canvas-created-note-reopened.png",
      "Canvas-created Markdown note reopen",
    );
    const secondCreatedNoteSource = await assertCanvasCreatedNoteSource(expectedCreatedNoteBytes, "during the reopened Obsidian session");
    secondSession.created_note_view = {
      path: canvasNotePath,
      path_visible_in_file_explorer: secondCreatedNoteView.paths.includes(canvasNotePath),
      active_file_path: secondCreatedNoteView.active_file_path,
      active_tree_path: secondCreatedNoteView.active_tree_path,
      active_view_type: secondCreatedNoteView.active_view_type,
      active_view_is_markdown: secondCreatedNoteView.active_view_is_markdown,
      exact_text_card_body_visible: secondCreatedNoteView.active_view_text.includes(canvasEditedText),
      title: secondCreatedNoteView.title,
      body: secondCreatedNoteView.body.slice(0, 2_000),
      editor: secondCreatedNoteView.editor.slice(0, 2_000),
      active_view_text: secondCreatedNoteView.active_view_text.slice(0, 2_000),
      source_bytes: secondCreatedNoteSource.bytes,
      source_sha256: secondCreatedNoteSource.sha256,
      screenshot: "obsidian-canvas-created-note-reopened.png",
    };
    if (!secondCreatedNoteView.paths.includes(canvasNotePath)
      || (secondCreatedNoteView.active_file_path !== canvasNotePath && secondCreatedNoteView.active_tree_path !== canvasNotePath)
      || !secondCreatedNoteView.active_view_is_markdown
      || !secondCreatedNoteView.active_view_text.includes(canvasEditedText)) {
      throw new Error("Obsidian's reopened session did not activate and render the explicitly created Canvas text-card Markdown note");
    }
    await delay(2_000);
    await stopProcess(secondProcess, secondConnection);
    secondProcess = undefined;
    secondConnection = undefined;

    const afterSecondClose = await snapshotTree(canvasVaultRoot);
    snapshots.canvas_reference_after_reopen = afterSecondClose;
    const secondCloseCanvas = await assertCanvasReferenceSource(firstCloseCanvas, expectedEditedDocument, "the reopened Obsidian shutdown");
    const secondCloseNote = await assertCanvasCreatedNoteSource(expectedCreatedNoteBytes, "the reopened Obsidian shutdown");
    secondSession.created_note_source_after_close = secondCloseNote;
    const reopenChanges = changedPaths(beforeSecondOpen, afterSecondClose);
    const allowedReferenceChanges = reopenChanges.filter((change) => (
      workspaceStateAllowlist.includes(change.path) || change.path === canvasPath
    ));
    const unexpectedChanges = reopenChanges.filter((change) => (
      !workspaceStateAllowlist.includes(change.path) && change.path !== canvasPath
    ));
    if (unexpectedChanges.length > 0) {
      throw new Error(`Canvas reference reopen changed unapproved vault content: ${JSON.stringify(unexpectedChanges).slice(0, 6_000)}`);
    }
    snapshots.canvas_reference_reopen_changes = allowedReferenceChanges;
    canvasReport.source_after_reopen = secondCloseCanvas;
    canvasReport.source_semantics_preserved_after_both_shutdowns = firstCloseCanvas.semantic_content_matches_expected
      && secondCloseCanvas.semantic_content_matches_expected;
    canvasReport.edited_text_visible_on_first_open = firstView.body.includes(canvasEditedText);
    canvasReport.edited_text_visible_after_reopen = secondView.body.includes(canvasEditedText);
    canvasReport.edited_byte_representation_preserved_after_first_shutdown = firstCloseCanvas.byte_identical_to_baseline;
    canvasReport.second_shutdown_bytes_match_first_close = secondCloseCanvas.byte_identical_to_baseline;
    canvasReport.first_close_canvas_bytes = firstCloseCanvas.bytes;
    canvasReport.first_close_canvas_sha256 = firstCloseCanvas.sha256;
    canvasReport.second_close_canvas_bytes = secondCloseCanvas.bytes;
    canvasReport.second_close_canvas_sha256 = secondCloseCanvas.sha256;
    canvasReport.marker_visible_after_reopen = secondView.body.includes(canvasMarker);
    canvasReport.path_visible_after_reopen = secondView.paths.includes(canvasPath);
    canvasReport.target_subpath_content_visible_after_reopen = secondView.body.includes(canvasTargetText);
    canvasReport.created_note_path = canvasNotePath;
    canvasReport.created_note_body_bytes = expectedCreatedNoteBytes.length;
    canvasReport.created_note_body_sha256 = createHash("sha256").update(expectedCreatedNoteBytes).digest("hex");
    canvasReport.created_note_visible_on_first_open = firstCreatedNoteView.paths.includes(canvasNotePath)
      && (firstCreatedNoteView.active_file_path === canvasNotePath || firstCreatedNoteView.active_tree_path === canvasNotePath)
      && firstCreatedNoteView.active_view_is_markdown
      && firstCreatedNoteView.active_view_text.includes(canvasEditedText);
    canvasReport.created_note_visible_after_reopen = secondCreatedNoteView.paths.includes(canvasNotePath)
      && (secondCreatedNoteView.active_file_path === canvasNotePath || secondCreatedNoteView.active_tree_path === canvasNotePath)
      && secondCreatedNoteView.active_view_is_markdown
      && secondCreatedNoteView.active_view_text.includes(canvasEditedText);
    canvasReport.created_note_bytes_unchanged_after_both_shutdowns = firstCloseNote.sha256 === secondCloseNote.sha256
      && firstCloseNote.bytes === secondCloseNote.bytes
      && firstCloseNote.sha256 === createHash("sha256").update(expectedCreatedNoteBytes).digest("hex");
    canvasReport.reopen_vault_changes = allowedReferenceChanges;
    canvasReport.status = "passed";
  } catch (error) {
    canvasReport.status = "failed";
    canvasReport.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await stopProcess(firstProcess, firstConnection).catch(() => undefined);
    await stopProcess(secondProcess, secondConnection).catch(() => undefined);
  }
}

type BasesDirectionViewObservation = {
  requested_file_path: string;
  selection_succeeded: boolean;
  active_file_path: string | null;
  active_view_type: string | null;
  title: string;
  body: string;
  group_order_from_rendered_rows: string[];
  row_order_by_group_from_dom: Record<string, string[]>;
  rendered_file_paths: string[];
  unscoped_fixture_link_paths: string[];
  group_row_candidates: string[];
  table_root_class: string | null;
  visible_group_heading_count: number;
  visible_group_row_candidate_count: number;
  unmapped_group_heading_count: number;
  unmapped_group_row_candidate_count: number;
  unmapped_data_row_candidate_count: number;
  visible_data_row_candidate_count: number;
  visible_bases_row_candidate_count: number;
  table_row_diagnostics: Array<{
    kind: string;
    group_label: string | null;
    file_path: string | null;
    raw_path: string | null;
    has_file_link: boolean;
    source_scope: string;
    in_table: boolean;
    text: string;
    cell_texts: string[];
    class_name: string;
    top: number;
  }>;
  bases_dom_candidates: Array<{tag: string; class_name: string; role: string | null; text: string; top: number}>;
  notices: string[];
  previous_active_file_path: string | null;
  previous_active_view_type: string | null;
  previous_body: string;
  previous_notices: string[];
  state_transition_observed: boolean;
  state_settled: boolean;
  state_samples: BasesDirectionStateSample[];
  screenshot: string;
};

type BasesDirectionGroupCapture = Pick<
  BasesDirectionViewObservation,
  | "group_order_from_rendered_rows"
  | "row_order_by_group_from_dom"
  | "unmapped_group_heading_count"
  | "unmapped_group_row_candidate_count"
  | "unmapped_data_row_candidate_count"
>;

function hasCompleteBasesFixturePathSet(
  state: Pick<BasesDirectionViewObservation, "row_order_by_group_from_dom">,
): boolean {
  const observed = Object.values(state.row_order_by_group_from_dom).flat();
  const expected = new Set(basesDirectionFixturePaths);
  const observedSet = new Set(observed);
  return observed.length === expected.size
    && observedSet.size === expected.size
    && [...expected].every((path) => observedSet.has(path));
}

function hasCompleteBasesGroupCapture(state: BasesDirectionGroupCapture): boolean {
  return state.group_order_from_rendered_rows.length > 0
    && state.group_order_from_rendered_rows.every((group) => {
      const normalized = group.trim().toLowerCase();
      return normalized !== "" && normalized !== "(unparsed group)" && normalized !== "team";
    })
    && state.unmapped_group_heading_count === 0
    && state.unmapped_group_row_candidate_count === 0
    && state.unmapped_data_row_candidate_count === 0
    && hasCompleteBasesFixturePathSet(state);
}

function hasExpectedOmittedGroupDirectionParseError(
  state: BasesDirectionViewObservation | BasesDirectionVisibleState,
  basePath: string,
  viewName: string,
): boolean {
  const expectedMessage = `"groupBy" must be a object in view "${viewName}"`;
  return state.active_file_path === basePath
    && state.active_view_type === "bases"
    && state.body.includes("Unable to parse your base file:")
    && state.body.includes(expectedMessage)
    && state.group_order_from_rendered_rows.length === 0
    && Object.keys(state.row_order_by_group_from_dom).length === 0
    && state.rendered_file_paths.length === 0
    && state.bases_dom_candidates.some((candidate) => candidate.class_name.includes("bases-error")
      && candidate.text.includes(expectedMessage));
}

type BasesDirectionVisibleState = Omit<
  BasesDirectionViewObservation,
  "previous_active_file_path" | "previous_active_view_type" | "previous_body" | "previous_notices" | "state_transition_observed" | "state_settled" | "state_samples" | "screenshot"
>;

type BasesDirectionStateSample = Pick<
  BasesDirectionVisibleState,
  | "active_file_path"
  | "active_view_type"
  | "title"
  | "body"
  | "group_order_from_rendered_rows"
  | "row_order_by_group_from_dom"
  | "rendered_file_paths"
  | "unscoped_fixture_link_paths"
  | "group_row_candidates"
  | "table_root_class"
  | "visible_group_heading_count"
  | "visible_group_row_candidate_count"
  | "unmapped_group_heading_count"
  | "unmapped_group_row_candidate_count"
  | "unmapped_data_row_candidate_count"
  | "visible_data_row_candidate_count"
  | "visible_bases_row_candidate_count"
  | "table_row_diagnostics"
  | "bases_dom_candidates"
  | "notices"
>;

async function verifyBasesDirectionVisible(
  connection: DevToolsConnection,
  direction: "ASC" | "DESC" | "OMITTED" | "SIDEWAYS",
  stage: string,
): Promise<BasesDirectionViewObservation> {
  const basePath = direction === "ASC"
    ? "Ascending.base"
    : direction === "DESC"
      ? "Descending.base"
      : direction === omittedBasesDirection
        ? "Omitted Direction.base"
        : "Invalid Direction.base";
  const label = direction === omittedBasesDirection ? "omitted" : direction;
  const viewName = `C07 group direction ${label}`;
  const unsupportedDirection = direction === invalidBasesDirection;
  const omittedDirection = direction === omittedBasesDirection;
  const fixturePaths = JSON.stringify(basesDirectionFixturePaths);
  const readVisible = async () => await connection.evaluateJson<BasesDirectionVisibleState>(`(() => {
    const fixturePaths = ${fixturePaths};
    const view = window.app?.workspace?.activeLeaf?.view;
    const root = document.querySelector('.workspace-leaf.mod-active') ?? document.body;
    const body = root?.innerText ?? '';
    const tableSelector = '.bases-table, [role="table"], table';
    const tableRoots = root ? [...root.querySelectorAll(tableSelector)] : [];
    const table = tableRoots[0] ?? null;
    const tableForElement = (element) => {
      const owner = element.closest(tableSelector);
      return owner && root.contains(owner) ? owner : null;
    };
    const isInBasesTable = (element) => Boolean(tableForElement(element));
    const isVisibleElement = (element) => {
      const style = window.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0;
    };
    const normalizeText = (text) => text.replace(/\\s+/g, ' ').trim();
    const textOf = (element) => normalizeText(element?.innerText || element?.textContent || '');
    const rowSelector = '.bases-tr, .bases-row, .bases-table-row, tr, [role="row"], li, [role="listitem"]';
    const linkSelector = 'a[data-href], [data-href], a[data-path], [data-path], a.internal-link, .internal-link';
    const classTokensFor = (element) => [...(element.classList || [])].map((name) => name.toLowerCase());
    const hasKnownBasesRowClass = (element) => classTokensFor(element)
      .some((name) => ['bases-tr', 'bases-row', 'bases-table-row'].includes(name));
    const hasBasesGroupHeadingClass = (element) => classTokensFor(element)
      .some((name) => ['bases-group-heading', 'bases-group-header'].includes(name));
    const hasBasesGroupRowClass = (element) => classTokensFor(element).includes('bases-group-row');
    const hasKnownBasesGroupClass = (element) => hasBasesGroupHeadingClass(element) || hasBasesGroupRowClass(element);
    const hasKnownBasesHeaderClass = (element) => classTokensFor(element).some((name) => name.startsWith('bases-')
      && !name.startsWith('bases-group-')
      && (name.includes('header') || name.includes('thead') || name === 'bases-th' || name.includes('column-header')));
    const pathByDisplayName = new Map(fixturePaths.flatMap((path) => {
      const filename = path.split('/').at(-1) || path;
      const withoutExtension = filename.replace(/\\.(?:md|base)$/i, '');
      return [[filename.toLowerCase(), path], [withoutExtension.toLowerCase(), path]];
    }));
    const normalizePath = (path) => path.trim()
      .split(String.fromCharCode(92)).join('/')
      .split('/')
      .filter((part) => part && part !== '.')
      .join('/');
    const fixturePathFor = (rawPath, linkText) => {
      for (const candidate of [rawPath, linkText]) {
        if (!candidate) continue;
        const normalized = normalizePath(candidate);
        const exactPath = fixturePaths.find((path) => path.toLowerCase() === normalized.toLowerCase());
        if (exactPath) return exactPath;
        const basename = normalized.split('/').at(-1) || '';
        const lowerBasename = basename.toLowerCase();
        const withoutExtension = lowerBasename.endsWith('.md')
          ? lowerBasename.slice(0, -3)
          : lowerBasename.endsWith('.base')
            ? lowerBasename.slice(0, -5)
            : lowerBasename;
        const alias = pathByDisplayName.get(lowerBasename) || pathByDisplayName.get(withoutExtension);
        if (alias) return alias;
      }
      return null;
    };
    const visibleLinksFor = (element) => [...new Set([
      ...(element.matches?.(linkSelector) ? [element] : []),
      ...element.querySelectorAll(linkSelector),
    ])].filter(isVisibleElement);
    const linkPathFor = (link) => fixturePathFor(
      link.getAttribute('data-href') || link.getAttribute('data-path') || null,
      textOf(link),
    );
    const isExcludedRegion = (element) => Boolean(element.closest('.view-header, header, .bases-toolbar, [role="toolbar"], [role="alert"], .notice, .modal-container'));
    const visibleRootRows = root
      ? [...root.querySelectorAll(rowSelector)].filter((row) => isVisibleElement(row) && !isExcludedRegion(row))
      : [];
    const rawRows = tableRoots.length === 0
      ? visibleRootRows
      : [...new Set(tableRoots.flatMap((tableRoot) => [...tableRoot.querySelectorAll(rowSelector)]))]
        .filter((row) => isVisibleElement(row) && !isExcludedRegion(row));
    const hasNestedRowCandidate = (row) => visibleRootRows.some((candidate) => candidate !== row && row.contains(candidate));
    const rowOwnerFor = (element) => {
      const owner = element.closest(rowSelector);
      return owner && root.contains(owner) ? owner : null;
    };
    const visibleGroupClassElements = root
      ? [...root.querySelectorAll('[class]')].filter((element) => isVisibleElement(element)
        && !isExcludedRegion(element)
        && hasKnownBasesGroupClass(element))
      : [];
    const visibleGroupMarkers = visibleGroupClassElements.filter((element) => {
      const nestedGroupMarker = visibleGroupClassElements.some((candidate) => candidate !== element
        && element.contains(candidate));
      if (hasBasesGroupHeadingClass(element)) return !nestedGroupMarker;
      return hasBasesGroupRowClass(element) && !nestedGroupMarker;
    });
    const visibleDataCellsFor = (row) => [...row.querySelectorAll('.bases-td, td, [role="cell"], [role="gridcell"]')]
      .filter((cell) => cell.closest(rowSelector) === row
        && isVisibleElement(cell)
        && cell.tagName.toLowerCase() !== 'th'
        && cell.getAttribute('role') !== 'columnheader');
    const cellTextsFor = (row) => {
      const semanticCells = [...row.querySelectorAll('.bases-td, td, [role="cell"], [role="gridcell"]')]
        .filter((cell) => cell.closest(rowSelector) === row && isVisibleElement(cell));
      const cells = semanticCells.length > 0
        ? semanticCells
        : [...row.children].filter(isVisibleElement);
      return cells.map(textOf).filter(Boolean);
    };
    const hasTeamGroupLabel = (row) => {
      const cellTexts = cellTextsFor(row);
      if (cellTexts.some((text) => /\\bteam\\s+\\S+/i.test(text))) return true;
      return cellTexts.some((text, index) => text.toLowerCase() === 'team' && Boolean(cellTexts[index + 1]));
    };
    const isHeaderOnlyRow = (row) => {
      if (row.closest('thead') || row.getAttribute('role') === 'columnheader' || hasKnownBasesHeaderClass(row)) return true;
      const cells = [...row.querySelectorAll('th, td, [role="columnheader"], [role="cell"], [role="gridcell"]')]
        .filter((cell) => cell.closest(rowSelector) === row && isVisibleElement(cell));
      return cells.length > 0 && cells.every((cell) => cell.tagName.toLowerCase() === 'th'
        || cell.getAttribute('role') === 'columnheader');
    };
    const groupRowCandidateElements = new Set(visibleGroupMarkers.map((marker) => rowOwnerFor(marker) || marker));
    for (const row of visibleRootRows) {
      const hasFileLink = visibleLinksFor(row).length > 0;
      const hasFilePathText = cellTextsFor(row).some((text) => fixturePathFor(null, text));
      const looksLikeGroupRow = !hasFileLink && !hasFilePathText && hasTeamGroupLabel(row);
      const isStructuralHeader = row.closest('thead')
        || row.getAttribute('role') === 'columnheader'
        || hasKnownBasesHeaderClass(row);
      if (!groupRowCandidateElements.has(row)
        && !hasNestedRowCandidate(row)
        && !isStructuralHeader
        && looksLikeGroupRow) {
        groupRowCandidateElements.add(row);
      }
    }
    const dataRowCandidateElements = new Set(rawRows.filter((row) => {
      if (isHeaderOnlyRow(row) || groupRowCandidateElements.has(row)) return false;
      if (hasNestedRowCandidate(row)) return false;
      const hasFixtureLink = visibleLinksFor(row).some((link) => linkPathFor(link));
      const hasVisibleDataCell = visibleDataCellsFor(row).length > 0;
      return hasKnownBasesRowClass(row)
        || (isInBasesTable(row) && hasVisibleDataCell)
        || hasFixtureLink;
    }));
    const visibleFixtureLinks = root
      ? [...root.querySelectorAll(linkSelector)].filter((link) => isVisibleElement(link)
        && !isExcludedRegion(link)
        && linkPathFor(link))
      : [];
    const unscopedFixtureLinkPaths = visibleFixtureLinks.filter((link) => {
      if ([...dataRowCandidateElements, ...groupRowCandidateElements].some((row) => row === link || row.contains(link))) return false;
      const owner = rowOwnerFor(link);
      const inTable = isInBasesTable(link);
      const hasExplicitRowOwner = Boolean(owner && (hasKnownBasesRowClass(owner)
        || owner.matches('tr, [role="row"], li, [role="listitem"]')));
      return !inTable && !hasExplicitRowOwner;
    }).map(linkPathFor).filter(Boolean);
    for (const link of visibleFixtureLinks) {
      if ([...dataRowCandidateElements, ...groupRowCandidateElements].some((row) => row === link || row.contains(link))) continue;
      const owner = rowOwnerFor(link);
      if (owner && isHeaderOnlyRow(owner)) continue;
      const inTable = isInBasesTable(link);
      const hasExplicitRowOwner = Boolean(owner && (hasKnownBasesRowClass(owner)
        || owner.matches('tr, [role="row"], li, [role="listitem"]')));
      const inExcludedRegion = isExcludedRegion(link);
      if (inExcludedRegion || (!inTable && !hasExplicitRowOwner)) continue;
      dataRowCandidateElements.add(owner || link);
    }
    const tableRows = [...new Set([...groupRowCandidateElements, ...dataRowCandidateElements])];
    const groupLabelFor = (row, cellTexts, heading) => {
      const candidates = [textOf(heading), ...cellTexts, textOf(row)]
        .filter(Boolean);
      for (const candidate of candidates) {
        const parts = candidate.split(/\\s+/).filter(Boolean);
        const keyIndex = parts.findIndex((part) => part.toLowerCase() === 'team');
        if (keyIndex >= 0 && parts[keyIndex + 1]) return parts.slice(keyIndex + 1).join(' ');
      }
      for (let index = 0; index < cellTexts.length - 1; index += 1) {
        if (cellTexts[index].toLowerCase() === 'team') return cellTexts[index + 1];
      }
      return textOf(heading) || null;
    };
    const rowRecords = tableRows.map((element, index) => {
      const bounds = element.getBoundingClientRect();
      const cellTexts = cellTextsFor(element);
      const heading = hasKnownBasesGroupClass(element)
        ? element
        : [...element.querySelectorAll('[class]')].find(hasKnownBasesGroupClass) || null;
      const groupLabel = groupLabelFor(element, cellTexts, heading);
      const isGroup = groupRowCandidateElements.has(element);
      const links = visibleLinksFor(element);
      const resolvedPaths = [...new Set(links.map(linkPathFor).filter(Boolean))];
      const textPath = cellTexts.map((text) => fixturePathFor(null, text)).find(Boolean) || null;
      const filePath = isGroup
        ? null
        : resolvedPaths.length === 1
          ? resolvedPaths[0]
          : (hasKnownBasesRowClass(element) || isInBasesTable(element)) && resolvedPaths.length === 0
            ? textPath
            : null;
      const link = links[0] || (element.matches?.(linkSelector) ? element : null);
      const rawPath = link?.getAttribute('data-href')
        || link?.getAttribute('data-path')
        || null;
      const inTable = isInBasesTable(element);
      return {
        element,
        index,
        kind: isGroup ? 'group' : dataRowCandidateElements.has(element) && filePath ? 'file' : 'other',
        group_label: isGroup ? groupLabel : null,
        file_path: isGroup || !dataRowCandidateElements.has(element) ? null : filePath,
        raw_path: rawPath,
        has_file_link: links.length > 0,
        source_scope: inTable
          ? 'table'
          : (hasKnownBasesRowClass(element) || element.matches('tr, [role="row"], li, [role="listitem"]') ? 'explicit-row' : 'table-link'),
        in_table: inTable,
        text: textOf(element),
        cell_texts: cellTexts,
        class_name: element.getAttribute('class') || '',
        top: bounds.top,
      };
    }).sort((left, right) => left.top - right.top || left.index - right.index);
    const isParsedGroupLabel = (label) => Boolean(label && label.trim()
      && label.toLowerCase() !== 'team'
      && label !== '(unparsed group)');
    const mappedGroupHeadingRows = new Set();
    const unmappedGroupHeadingCount = visibleGroupMarkers.filter((headingElement) => {
      const matches = rowRecords.filter((row) => (row.element === headingElement || row.element.contains(headingElement))
        && row.kind === 'group'
        && isParsedGroupLabel(row.group_label));
      if (matches.length !== 1 || mappedGroupHeadingRows.has(matches[0]?.element)) return true;
      mappedGroupHeadingRows.add(matches[0].element);
      return false;
    }).length;
    const unmappedGroupRowCandidateCount = [...groupRowCandidateElements].filter((candidate) => {
      const matches = rowRecords.filter((row) => row.element === candidate
        && row.kind === 'group'
        && isParsedGroupLabel(row.group_label));
      return matches.length !== 1;
    }).length;
    const unmappedDataRowCandidateCount = [...dataRowCandidateElements].filter((candidate) => {
      const matches = rowRecords.filter((row) => row.element === candidate
        && row.kind === 'file'
        && Boolean(row.file_path));
      return matches.length !== 1;
    }).length;
    const groupOrder = [];
    const rowOrderByGroup = {};
    const renderedFilePaths = [];
    let activeGroup = null;
    for (const row of rowRecords) {
      if (row.kind === 'group') {
        activeGroup = row.group_label || '(unparsed group)';
        groupOrder.push(activeGroup);
        rowOrderByGroup[activeGroup] = rowOrderByGroup[activeGroup] || [];
      } else if (row.kind === 'file' && row.file_path) {
        renderedFilePaths.push(row.file_path);
        if (activeGroup && (table === null || row.in_table)) {
          rowOrderByGroup[activeGroup].push(row.file_path);
        } else if (!row.in_table) {
          activeGroup = null;
        }
      }
    }
    const visibleBasesDomElements = [...(root?.querySelectorAll('[class*="bases"], [role="table"], [role="row"], table, tr') || [])]
      .filter(isVisibleElement);
    const visibleBasesRowCandidateCount = groupRowCandidateElements.size + dataRowCandidateElements.size;
    const basesDomCandidates = visibleBasesDomElements
      .slice(0, 80)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        class_name: element.getAttribute('class') || '',
        role: element.getAttribute('role') || null,
        text: textOf(element).slice(0, 160),
        top: element.getBoundingClientRect().top,
      }));
    const notices = [...new Set([...document.querySelectorAll('.notice, .modal-container, [role="alert"]')]
      .map((element) => (element.innerText || element.textContent || '').trim())
      .filter(Boolean))];
    return {
      requested_file_path: ${JSON.stringify(basePath)},
      selection_succeeded: view?.file?.path === ${JSON.stringify(basePath)},
      active_file_path: view?.file?.path ?? null,
      active_view_type: view?.getViewType?.() ?? null,
      title: document.title,
      body,
      group_order_from_rendered_rows: groupOrder,
      row_order_by_group_from_dom: rowOrderByGroup,
      rendered_file_paths: renderedFilePaths,
      unscoped_fixture_link_paths: unscopedFixtureLinkPaths,
      group_row_candidates: groupOrder,
      table_root_class: table?.getAttribute('class') || null,
      visible_group_heading_count: visibleGroupMarkers.length,
      visible_group_row_candidate_count: groupRowCandidateElements.size,
      unmapped_group_heading_count: unmappedGroupHeadingCount,
      unmapped_group_row_candidate_count: unmappedGroupRowCandidateCount,
      unmapped_data_row_candidate_count: unmappedDataRowCandidateCount,
      visible_data_row_candidate_count: dataRowCandidateElements.size,
      visible_bases_row_candidate_count: visibleBasesRowCandidateCount,
      table_row_diagnostics: rowRecords.map(({kind, group_label, file_path, raw_path, has_file_link, source_scope, in_table, text, cell_texts, class_name, top}) => ({
        kind, group_label, file_path, raw_path, has_file_link, source_scope, in_table, text, cell_texts, class_name, top,
      })),
      bases_dom_candidates: basesDomCandidates,
      notices,
    };
  })()`);

  let beforeSelection: BasesDirectionVisibleState = {
    requested_file_path: basePath,
    selection_succeeded: false,
    active_file_path: null,
    active_view_type: null,
    title: "",
    body: "",
    group_order_from_rendered_rows: [],
    row_order_by_group_from_dom: {},
    rendered_file_paths: [],
    unscoped_fixture_link_paths: [],
    group_row_candidates: [],
    table_root_class: null,
    visible_group_heading_count: 0,
    visible_group_row_candidate_count: 0,
    unmapped_group_heading_count: 0,
    unmapped_group_row_candidate_count: 0,
    visible_bases_row_candidate_count: 0,
    unmapped_data_row_candidate_count: 0,
    visible_data_row_candidate_count: 0,
    table_row_diagnostics: [],
    bases_dom_candidates: [],
    notices: [],
  };
  let visible: BasesDirectionVisibleState = beforeSelection;
  let stateTransitionObserved = false;
  let stateSettled = false;
  const stateSamples: BasesDirectionStateSample[] = [];
  const recordStateSample = (state: BasesDirectionVisibleState) => {
    const sample: BasesDirectionStateSample = {
      active_file_path: state.active_file_path,
      active_view_type: state.active_view_type,
      title: state.title,
      body: state.body.slice(0, 6_000),
      group_order_from_rendered_rows: state.group_order_from_rendered_rows,
      row_order_by_group_from_dom: state.row_order_by_group_from_dom,
      rendered_file_paths: state.rendered_file_paths,
      unscoped_fixture_link_paths: state.unscoped_fixture_link_paths,
      group_row_candidates: state.group_row_candidates,
      table_root_class: state.table_root_class,
      visible_group_heading_count: state.visible_group_heading_count,
      visible_group_row_candidate_count: state.visible_group_row_candidate_count,
      unmapped_group_heading_count: state.unmapped_group_heading_count,
      unmapped_group_row_candidate_count: state.unmapped_group_row_candidate_count,
      visible_bases_row_candidate_count: state.visible_bases_row_candidate_count,
      unmapped_data_row_candidate_count: state.unmapped_data_row_candidate_count,
      visible_data_row_candidate_count: state.visible_data_row_candidate_count,
      table_row_diagnostics: state.table_row_diagnostics,
      bases_dom_candidates: state.bases_dom_candidates,
      notices: state.notices,
    };
    if (stateSamples.length === 0 || !isDeepStrictEqual(stateSamples[stateSamples.length - 1], sample)) {
      stateSamples.push(sample);
    }
  };
  const persistProbeFailure = async (state: BasesDirectionVisibleState, error: unknown): Promise<void> => {
    const screenshot = `obsidian-bases-${direction.toLowerCase()}-${stage}-failure.png`;
    let screenshotError: string | undefined;
    try {
      await captureObsidianScreenshot(connection, screenshot);
    } catch (captureError) {
      screenshotError = captureError instanceof Error ? captureError.message : String(captureError);
    }
    const failureObservation: BasesDirectionViewObservation & {probe_error: string; screenshot_error?: string} = {
      ...state,
      body: state.body.slice(0, 6_000),
      previous_active_file_path: beforeSelection.active_file_path,
      previous_active_view_type: beforeSelection.active_view_type,
      previous_body: beforeSelection.body.slice(0, 6_000),
      previous_notices: beforeSelection.notices,
      state_transition_observed: state.active_file_path !== beforeSelection.active_file_path
        || state.active_view_type !== beforeSelection.active_view_type
        || state.title !== beforeSelection.title
        || state.body !== beforeSelection.body
        || !isDeepStrictEqual(state.notices, beforeSelection.notices),
      state_settled: stateSettled,
      state_samples: stateSamples,
      screenshot,
      probe_error: error instanceof Error ? error.message : String(error),
      ...(screenshotError ? {screenshot_error: screenshotError} : {}),
    };
    const basesReport = report.bases_group_direction_reference as Record<string, unknown>;
    const observationKey = unsupportedDirection
      ? stage === "first-open"
        ? "invalid_direction_observation_on_first_open"
        : "invalid_direction_observation_after_reopen"
      : `${stage.replaceAll(/[^a-z0-9]+/gi, "_")}_${direction.toLowerCase()}_failure_observation`;
    basesReport[observationKey] = failureObservation;
    if (unsupportedDirection) {
      basesReport.invalid_direction_probe_error = error instanceof Error ? error.message : String(error);
    }
    await saveReport();
  };
  try {
    beforeSelection = await readVisible();
    visible = beforeSelection;
    const visiblePaths = await waitFor(
      `${stage}: Obsidian to list ${basePath}`,
      async () => await connection.evaluateJson<string[]>(`[...document.querySelectorAll('[data-path]')].map((element) => element.getAttribute('data-path') || '')`),
      (paths) => paths.includes(basePath),
      45_000,
    );
    if (!visiblePaths.includes(basePath)) throw new Error(`${stage}: Obsidian did not list ${basePath}`);
    beforeSelection = await readVisible();
    visible = beforeSelection;
    const clicked = await connection.evaluateJson<boolean>(`(() => {
      const target = [...document.querySelectorAll('[data-path]')]
        .find((element) => element.getAttribute('data-path') === ${JSON.stringify(basePath)});
      target?.click();
      return Boolean(target);
    })()`);
    if (!clicked) throw new Error(`${stage}: Obsidian did not expose ${basePath} for selection`);
  } catch (error) {
    const lastState = await readVisible().catch(() => visible);
    recordStateSample(lastState);
    await persistProbeFailure(lastState, error);
    throw error;
  }
  if (unsupportedDirection || omittedDirection) {
    try {
      visible = beforeSelection;
      let stableFingerprint = JSON.stringify(visible);
      let stableSamples = 0;
      const settleDeadline = Date.now() + 45_000;
      const noTransitionDeadline = Date.now() + 8_000;
      while (Date.now() < settleDeadline) {
        await delay(500);
        const next = await readVisible();
        recordStateSample(next);
        const nextFingerprint = JSON.stringify(next);
        if (nextFingerprint === stableFingerprint) {
          stableSamples += 1;
        } else {
          stableFingerprint = nextFingerprint;
          stableSamples = 0;
        }
        visible = next;
        const targetSelected = next.active_file_path === basePath;
        const expectedOmittedParseError = omittedDirection
          && hasExpectedOmittedGroupDirectionParseError(next, basePath, viewName);
        const visibleStateChanged = next.active_file_path !== beforeSelection.active_file_path
          || next.active_view_type !== beforeSelection.active_view_type
          || next.title !== beforeSelection.title
          || next.body !== beforeSelection.body
          || !isDeepStrictEqual(next.notices, beforeSelection.notices);
        const isReady = omittedDirection
          ? expectedOmittedParseError
          : targetSelected || visibleStateChanged || Date.now() >= noTransitionDeadline;
        if (stableSamples >= 3 && isReady) {
          break;
        }
      }
      stateTransitionObserved = visible.active_file_path !== beforeSelection.active_file_path
        || visible.active_view_type !== beforeSelection.active_view_type
        || visible.title !== beforeSelection.title
        || visible.body !== beforeSelection.body
        || !isDeepStrictEqual(visible.notices, beforeSelection.notices);
      stateSettled = stableSamples >= 3;
      if (omittedDirection && !stateSettled) {
        throw new Error(`${stage}: omitted-direction parse error did not settle; samples=${JSON.stringify(stateSamples).slice(0, 8_000)}`);
      }
      if (omittedDirection && !hasExpectedOmittedGroupDirectionParseError(visible, basePath, viewName)) {
        throw new Error(`${stage}: Obsidian did not show the pinned omitted-direction groupBy parse error for the selected ${basePath}; state=${JSON.stringify(visible).slice(0, 8_000)}`);
      }
      // SIDEWAYS is a capture-only probe: preserve partial or empty fallback
      // observations without imposing the supported directions' full fixture set.
      if (visible.unmapped_group_heading_count > 0
        || visible.unmapped_group_row_candidate_count > 0
        || visible.unmapped_data_row_candidate_count > 0) {
        throw new Error(`${stage}: invalid-direction view exposed group or file rows that did not map one-to-one to rendered records; state=${JSON.stringify(visible).slice(0, 8_000)}`);
      }
    } catch (error) {
      const afterSelection = await readVisible().catch(() => visible);
      recordStateSample(afterSelection);
      await persistProbeFailure(afterSelection, error);
      throw error;
    }
  } else {
    visible = beforeSelection;
    try {
      let viewReady = false;
      const viewDeadline = Date.now() + 45_000;
      while (Date.now() < viewDeadline) {
        visible = await readVisible();
        recordStateSample(visible);
        viewReady = visible.active_file_path === basePath
          && visible.active_view_type === "bases"
          && visible.body.includes(viewName)
          && hasCompleteBasesGroupCapture(visible);
        if (viewReady) break;
        await delay(500);
      }
      if (!viewReady) {
        throw new Error(`${stage}: Obsidian did not expose the ${direction} Bases view; last state=${JSON.stringify(visible).slice(0, 8_000)}`);
      }
      let stableFingerprint = JSON.stringify(visible);
      let stableSamples = 0;
      const settleDeadline = Date.now() + 45_000;
      while (Date.now() < settleDeadline && stableSamples < 3) {
        await delay(500);
        const next = await readVisible();
        recordStateSample(next);
        const nextFingerprint = JSON.stringify(next);
        if (nextFingerprint === stableFingerprint) {
          stableSamples += 1;
        } else {
          stableFingerprint = nextFingerprint;
          stableSamples = 0;
        }
        visible = next;
      }
      stateTransitionObserved = visible.active_file_path !== beforeSelection.active_file_path
        || visible.active_view_type !== beforeSelection.active_view_type
        || visible.title !== beforeSelection.title
        || visible.body !== beforeSelection.body
        || !isDeepStrictEqual(visible.notices, beforeSelection.notices);
      stateSettled = stableSamples >= 3;
      if (!stateSettled) {
        throw new Error(`${stage}: ${direction} Bases view did not settle; samples=${JSON.stringify(stateSamples).slice(0, 8_000)}`);
      }
      if (!hasCompleteBasesGroupCapture(visible)) {
        throw new Error(`${stage}: settled ${direction} Bases view lost complete group or fixture-path capture; state=${JSON.stringify(visible).slice(0, 8_000)}`);
      }
      if (visible.active_file_path !== basePath || visible.active_view_type !== "bases") {
        throw new Error(`${stage}: ${basePath} did not open as a Bases view: ${JSON.stringify({path: visible.active_file_path, type: visible.active_view_type})}`);
      }
    } catch (error) {
      const lastState = await readVisible().catch(() => visible);
      recordStateSample(lastState);
      await persistProbeFailure(lastState, error);
      throw error;
    }
  }
  if (!unsupportedDirection && (visible.active_file_path !== basePath || visible.active_view_type !== "bases")) {
    throw new Error(`${stage}: ${basePath} did not open as a Bases view: ${JSON.stringify({path: visible.active_file_path, type: visible.active_view_type})}`);
  }
  if (!unsupportedDirection && !omittedDirection && (visible.active_view_type !== "bases" || !visible.body.includes(viewName))) {
    throw new Error(`${stage}: Obsidian did not render the ${direction} Bases view: ${JSON.stringify({path: visible.active_file_path, type: visible.active_view_type, body: visible.body.slice(0, 3_000)})}`);
  }
  const screenshot = `obsidian-bases-${direction.toLowerCase()}-${stage}.png`;
  await captureObsidianScreenshot(connection, screenshot);
  return {
    ...visible,
    body: visible.body.slice(0, 6_000),
    previous_active_file_path: beforeSelection.active_file_path,
    previous_active_view_type: beforeSelection.active_view_type,
    previous_body: beforeSelection.body.slice(0, 6_000),
    previous_notices: beforeSelection.notices,
    state_transition_observed: stateTransitionObserved,
    state_settled: stateSettled,
    state_samples: stateSamples,
    screenshot,
  };
}

async function runBasesDirectionReferenceProbe(): Promise<void> {
  const profileDirectory = join(workDirectory, "bases-direction-obsidian-profile");
  const basesReport = report.bases_group_direction_reference as Record<string, unknown>;
  const snapshots = report.vault_snapshots as Record<string, unknown>;
  basesReport.status = "running";
  let firstProcess: ChildProcess | undefined;
  let firstConnection: DevToolsConnection | undefined;
  let secondProcess: ChildProcess | undefined;
  let secondConnection: DevToolsConnection | undefined;
  let sourceHashes: Record<string, {bytes: number; sha256: string}> | undefined;
  let reopenSeedSnapshot: SnapshotEntry[] | undefined;
  const readActiveBasesWorkspaceView = async (connection: DevToolsConnection) => await connection.evaluateJson<{
    active_file_path: string | null;
    active_view_type: string | null;
    title: string;
    body: string;
  }>(`(() => {
    const view = window.app?.workspace?.activeLeaf?.view;
    const root = document.querySelector('.workspace-leaf.mod-active') ?? document.body;
    return {
      active_file_path: view?.file?.path ?? null,
      active_view_type: view?.getViewType?.() ?? null,
      title: document.title,
      body: (root?.innerText ?? '').slice(0, 6_000),
    };
  })()`);
  try {
    sourceHashes = await createBasesDirectionFixture();
    basesReport.source_rewrite_observations = [];
    basesReport.reference_app_source_preservation_passed = null;
    const checkReferenceSourceHashes = async (
      stage: string,
      session: "first_open" | "reopen",
    ): Promise<Record<string, {bytes: number; sha256: string}>> => {
      const capturedBytes: Record<string, Buffer> = {};
      const unexpectedMismatches: string[] = [];
      const observed = await assertBasesDirectionSourceHashes(sourceHashes!, stage, true, capturedBytes, unexpectedMismatches);
      const invalidDirectionHash = observed["Invalid Direction.base"];
      const invalidDirectionBytes = capturedBytes["Invalid Direction.base"];
      if (invalidDirectionHash && invalidDirectionBytes) {
        await recordBasesDirectionReferenceRewrite(
          sourceHashes!,
          observed,
          invalidDirectionBytes,
          session,
          stage,
        );
      }
      if (unexpectedMismatches.length > 0) throw new Error(unexpectedMismatches.join("; "));
      return observed;
    };
    const seedSnapshot = await snapshotTree(basesVaultRoot);
    snapshots.bases_direction_seed = seedSnapshot;
    basesReport.first_open_source_hashes = await assertBasesDirectionSourceHashes(sourceHashes, "before-first-open");
    await saveReport();

    firstProcess = await createObsidianProfile(profileDirectory, 9226, "obsidian-bases-direction-first-open.log");
    const first = await connectObsidian(9226);
    firstConnection = first.connection;
    const firstSession: Record<string, unknown> = {
      devtools_browser: first.browserVersion,
      first_target: {title: first.target.title ?? "", url: first.target.url ?? ""},
      source_hashes_before_open: sourceHashes,
    };
    basesReport.first_session = firstSession;
    const firstRunBody = await waitForRenderer(
      firstConnection,
      "document.body?.innerText ?? ''",
      (body) => body.includes("Open folder as vault"),
      "Obsidian's first-run C07 Bases reference vault screen",
    );
    firstSession.first_run_text = firstRunBody.slice(0, 2_000);
    await captureObsidianScreenshot(firstConnection, "obsidian-bases-direction-first-run.png");
    firstConnection = await chooseVaultDirectory(firstConnection, 9226, {
      targetRoot: basesVaultRoot,
      reporter: basesReport,
      screenshotPrefix: "obsidian-bases-direction",
    });
    await chooseRestrictedMode(firstConnection, firstSession, basesVaultName, "Synthetic C07 group-direction fixture.");

    const firstViews: Record<string, BasesDirectionViewObservation> = {};
    const firstViewSourceHashes: Record<string, Record<string, {bytes: number; sha256: string}>> = {};
    firstSession.views = firstViews;
    firstSession.source_hashes_after_each_view = firstViewSourceHashes;
    for (const direction of ["ASC", "DESC", omittedBasesDirection, invalidBasesDirection] as const) {
      firstViews[direction] = await verifyBasesDirectionVisible(firstConnection, direction, `first-open`);
      await saveReport();
      firstViewSourceHashes[direction] = await checkReferenceSourceHashes(
        `first-open-${direction.toLowerCase()}`,
        "first_open",
      );
      await saveReport();
    }
    firstSession.source_hashes_after_views = await checkReferenceSourceHashes("first-open-before-shutdown", "first_open");
    firstSession.workspace_reset_before_shutdown = await verifyBasesDirectionVisible(
      firstConnection,
      "ASC",
      "first-open-shutdown-restore",
    );
    const firstResetHashes = await checkReferenceSourceHashes("first-open-after-shutdown-restore", "first_open");
    firstSession.source_hashes_after_workspace_reset = firstResetHashes;
    await saveReport();
    await delay(2_000);
    await stopProcess(firstProcess, firstConnection);
    firstProcess = undefined;
    firstConnection = undefined;

    const afterFirstClose = await snapshotTree(basesVaultRoot);
    snapshots.bases_direction_after_first_close = afterFirstClose;
    const firstCloseHashes = await checkReferenceSourceHashes("first-shutdown", "first_open");
    const firstCloseRewriteObserved = firstCloseHashes["Invalid Direction.base"].sha256
      === normalizedInvalidBasesDirectionSha256;
    const firstCloseChanges = changedPaths(seedSnapshot, afterFirstClose);
    const firstCloseUnexpectedChanges = firstCloseChanges.filter((change) => {
      if (workspaceStateAllowlist.includes(change.path)) return false;
      const isRecordedReferenceRewrite = firstCloseRewriteObserved
        && change.path === "Invalid Direction.base"
        && change.after?.bytes === normalizedInvalidBasesDirection.length
        && change.after?.sha256 === normalizedInvalidBasesDirectionSha256;
      return !isRecordedReferenceRewrite;
    });
    if (firstCloseUnexpectedChanges.length > 0) {
      throw new Error(`C07 Bases first open changed unapproved vault content: ${JSON.stringify(firstCloseUnexpectedChanges).slice(0, 6_000)}`);
    }
    snapshots.bases_direction_first_open_changes = firstCloseChanges;
    basesReport.first_shutdown_source_hashes = firstCloseHashes;
    firstSession.vault_changes_during_obsidian_session = firstCloseChanges;
    await saveReport();

    const invalidDirectionSeedPath = join(reportDirectory, "bases-direction-Invalid Direction-base.seed");
    const invalidDirectionSeedBytes = await readFile(invalidDirectionSeedPath);
    const invalidDirectionBeforeReseed = firstCloseHashes["Invalid Direction.base"];
    const reseededInvalidDirection = invalidDirectionBeforeReseed.bytes !== sourceHashes["Invalid Direction.base"].bytes
      || invalidDirectionBeforeReseed.sha256 !== sourceHashes["Invalid Direction.base"].sha256;
    if (reseededInvalidDirection) {
      await writeFile(join(basesVaultRoot, "Invalid Direction.base"), invalidDirectionSeedBytes);
    }
    const sourceHashesBeforeReopen = await assertBasesDirectionSourceHashes(
      sourceHashes,
      "before-reopen-after-reference-fixture-reseed",
    );
    basesReport.source_reseed_before_reopen = {
      performed_by_probe: reseededInvalidDirection,
      reason: "Restore the synthetic unsupported-direction seed after recording Obsidian's exact reference rewrite so the reopened observation reads the original test input.",
      path: "Invalid Direction.base",
      before: invalidDirectionBeforeReseed,
      after: sourceHashesBeforeReopen["Invalid Direction.base"],
      seed_artifact: "bases-direction-Invalid Direction-base.seed",
    };
    reopenSeedSnapshot = await snapshotTree(basesVaultRoot);
    snapshots.bases_direction_reopen_seed = reopenSeedSnapshot;
    await saveReport();

    secondProcess = await createObsidianProfile(profileDirectory, 9227, "obsidian-bases-direction-reopen.log");
    const second = await connectObsidian(9227);
    secondConnection = second.connection;
    const secondSession: Record<string, unknown> = {
      devtools_browser: second.browserVersion,
      first_target: {title: second.target.title ?? "", url: second.target.url ?? ""},
      source_hashes_before_reopen: sourceHashesBeforeReopen,
      reopened_fixture_seed_snapshot: reopenSeedSnapshot,
    };
    basesReport.second_session = secondSession;
    await chooseRestrictedMode(secondConnection, secondSession, basesVaultName, "Synthetic C07 group-direction fixture.");
    secondSession.workspace_view_immediately_after_startup = await readActiveBasesWorkspaceView(secondConnection);
    const workspaceStartupScreenshot = "obsidian-bases-direction-workspace-startup-state.png";
    secondSession.workspace_startup_screenshot = workspaceStartupScreenshot;
    await captureObsidianScreenshot(secondConnection, workspaceStartupScreenshot);
    await saveReport();
    secondSession.source_hashes_immediately_after_startup = await checkReferenceSourceHashes(
      "reopen-workspace-immediately-after-startup",
      "reopen",
    );
    await saveReport();
    const restoredWorkspaceView = await waitFor(
      "R2.8.106: Obsidian to restore the supported ASC view before reopened capture",
      async () => await readActiveBasesWorkspaceView(secondConnection),
      (state) => state.active_file_path === "Ascending.base" && state.active_view_type === "bases",
      45_000,
    );
    secondSession.workspace_restored_view_at_startup = restoredWorkspaceView;
    const supportedRestoreScreenshot = "obsidian-bases-direction-supported-view-restored.png";
    secondSession.workspace_restore_screenshot = supportedRestoreScreenshot;
    await captureObsidianScreenshot(secondConnection, supportedRestoreScreenshot);
    secondSession.source_hashes_after_workspace_restore = await checkReferenceSourceHashes("reopen-workspace-restore", "reopen");
    await saveReport();

    const reopenedViews: Record<string, BasesDirectionViewObservation> = {};
    const reopenedViewSourceHashes: Record<string, Record<string, {bytes: number; sha256: string}>> = {};
    secondSession.views = reopenedViews;
    secondSession.source_hashes_after_each_view = reopenedViewSourceHashes;
    for (const direction of ["ASC", "DESC", omittedBasesDirection, invalidBasesDirection] as const) {
      reopenedViews[direction] = await verifyBasesDirectionVisible(secondConnection, direction, `reopen`);
      await saveReport();
      reopenedViewSourceHashes[direction] = await checkReferenceSourceHashes(
        `reopen-${direction.toLowerCase()}`,
        "reopen",
      );
      await saveReport();
    }
    secondSession.source_hashes_after_views = await checkReferenceSourceHashes("reopen-before-shutdown", "reopen");
    secondSession.workspace_reset_before_shutdown = await verifyBasesDirectionVisible(
      secondConnection,
      "ASC",
      "reopen-shutdown-restore",
    );
    const secondResetHashes = await checkReferenceSourceHashes("reopen-after-shutdown-restore", "reopen");
    secondSession.source_hashes_after_workspace_reset = secondResetHashes;
    await saveReport();
    await delay(2_000);
    await stopProcess(secondProcess, secondConnection);
    secondProcess = undefined;
    secondConnection = undefined;

    const afterSecondClose = await snapshotTree(basesVaultRoot);
    snapshots.bases_direction_after_reopen = afterSecondClose;
    const secondCloseHashes = await checkReferenceSourceHashes("reopen-shutdown", "reopen");
    const reopenChanges = changedPaths(reopenSeedSnapshot ?? afterFirstClose, afterSecondClose);
    const reopenRewriteObserved = secondCloseHashes["Invalid Direction.base"].bytes !== sourceHashes["Invalid Direction.base"].bytes
      || secondCloseHashes["Invalid Direction.base"].sha256 !== sourceHashes["Invalid Direction.base"].sha256;
    const reopenUnexpectedChanges = reopenChanges.filter((change) => {
      if (workspaceStateAllowlist.includes(change.path)) return false;
      const isRecordedReferenceRewrite = reopenRewriteObserved
        && change.path === "Invalid Direction.base"
        && change.after?.bytes === normalizedInvalidBasesDirection.length
        && change.after?.sha256 === normalizedInvalidBasesDirectionSha256;
      return !isRecordedReferenceRewrite;
    });
    if (reopenUnexpectedChanges.length > 0) {
      throw new Error(`C07 Bases reopen changed unapproved vault content: ${JSON.stringify(reopenUnexpectedChanges).slice(0, 6_000)}`);
    }
    snapshots.bases_direction_reopen_changes = reopenChanges;
    basesReport.second_shutdown_source_hashes = secondCloseHashes;
    const sourceRewriteObservations = basesReport.source_rewrite_observations as Array<Record<string, unknown>>;
    const noReferenceSourceRewriteObserved = sourceRewriteObservations.length === 0;
    const finalSourceHashesMatchSeed = isDeepStrictEqual(sourceHashes, secondCloseHashes);
    basesReport.source_hashes_unchanged_across_both_sessions = noReferenceSourceRewriteObserved && finalSourceHashesMatchSeed;
    basesReport.reference_app_source_preservation_passed = basesReport.source_hashes_unchanged_across_both_sessions;
    basesReport.source_hashes_unchanged_except_known_reference_rewrite = Object.entries(secondCloseHashes).every(([path, actual]) => {
      const baseline = sourceHashes?.[path];
      return Boolean(baseline && ((actual.bytes === baseline.bytes && actual.sha256 === baseline.sha256)
        || (path === "Invalid Direction.base"
          && actual.bytes === normalizedInvalidBasesDirection.length
          && actual.sha256 === normalizedInvalidBasesDirectionSha256)));
    });
    const allDirections = ["ASC", "DESC", omittedBasesDirection, invalidBasesDirection] as const;
    const supportedDirections = ["ASC", "DESC"] as const;
    basesReport.group_order_by_direction_on_first_open = Object.fromEntries(
      allDirections.map((direction) => [direction, firstViews[direction].group_order_from_rendered_rows]),
    );
    basesReport.group_order_by_direction_after_reopen = Object.fromEntries(
      allDirections.map((direction) => [direction, reopenedViews[direction].group_order_from_rendered_rows]),
    );
    basesReport.row_order_by_group_on_first_open = Object.fromEntries(
      allDirections.map((direction) => [direction, firstViews[direction].row_order_by_group_from_dom]),
    );
    basesReport.row_order_by_group_after_reopen = Object.fromEntries(
      allDirections.map((direction) => [direction, reopenedViews[direction].row_order_by_group_from_dom]),
    );
    basesReport.group_order_stable_across_reopen = isDeepStrictEqual(
      Object.fromEntries(supportedDirections.map((direction) => [direction, firstViews[direction].group_order_from_rendered_rows])),
      Object.fromEntries(supportedDirections.map((direction) => [direction, reopenedViews[direction].group_order_from_rendered_rows])),
    );
    basesReport.row_order_stable_across_reopen = isDeepStrictEqual(
      Object.fromEntries(supportedDirections.map((direction) => [direction, firstViews[direction].row_order_by_group_from_dom])),
      Object.fromEntries(supportedDirections.map((direction) => [direction, reopenedViews[direction].row_order_by_group_from_dom])),
    );
    const fixturePathSetCaptured = (view: BasesDirectionViewObservation): boolean => {
      return hasCompleteBasesFixturePathSet(view);
    };
    const groupCaptureComplete = (view: BasesDirectionViewObservation): boolean => hasCompleteBasesGroupCapture(view);
    basesReport.fixture_path_set_captured_on_first_open = Object.fromEntries(
      supportedDirections.map((direction) => [direction, fixturePathSetCaptured(firstViews[direction])]),
    );
    basesReport.fixture_path_set_captured_after_reopen = Object.fromEntries(
      supportedDirections.map((direction) => [direction, fixturePathSetCaptured(reopenedViews[direction])]),
    );
    basesReport.complete_group_capture_on_first_open = Object.fromEntries(
      supportedDirections.map((direction) => [direction, groupCaptureComplete(firstViews[direction])]),
    );
    basesReport.complete_group_capture_after_reopen = Object.fromEntries(
      supportedDirections.map((direction) => [direction, groupCaptureComplete(reopenedViews[direction])]),
    );
    const comparableObservation = (view: BasesDirectionViewObservation) => ({
      requested_file_path: view.requested_file_path,
      selection_succeeded: view.selection_succeeded,
      active_file_path: view.active_file_path,
      active_view_type: view.active_view_type,
      state_settled: view.state_settled,
      body: view.body,
      group_order: view.group_order_from_rendered_rows,
      row_order_by_group: view.row_order_by_group_from_dom,
      rendered_file_paths: view.rendered_file_paths,
      unscoped_fixture_link_paths: view.unscoped_fixture_link_paths,
      visible_group_heading_count: view.visible_group_heading_count,
      visible_group_row_candidate_count: view.visible_group_row_candidate_count,
      unmapped_group_heading_count: view.unmapped_group_heading_count,
      unmapped_group_row_candidate_count: view.unmapped_group_row_candidate_count,
      unmapped_data_row_candidate_count: view.unmapped_data_row_candidate_count,
      visible_data_row_candidate_count: view.visible_data_row_candidate_count,
      visible_bases_row_candidate_count: view.visible_bases_row_candidate_count,
      notices: view.notices,
    });
    basesReport.complete_observations_stable_across_reopen = isDeepStrictEqual(
      Object.fromEntries(allDirections.map((direction) => [direction, comparableObservation(firstViews[direction])])),
      Object.fromEntries(allDirections.map((direction) => [direction, comparableObservation(reopenedViews[direction])])),
    );
    basesReport.omitted_direction_observation_on_first_open = firstViews[omittedBasesDirection];
    basesReport.omitted_direction_observation_after_reopen = reopenedViews[omittedBasesDirection];
    basesReport.omitted_direction_parse_error_on_first_open = hasExpectedOmittedGroupDirectionParseError(
      firstViews[omittedBasesDirection],
      "Omitted Direction.base",
      "C07 group direction omitted",
    );
    basesReport.omitted_direction_parse_error_after_reopen = hasExpectedOmittedGroupDirectionParseError(
      reopenedViews[omittedBasesDirection],
      "Omitted Direction.base",
      "C07 group direction omitted",
    );
    const comparableOmittedParseError = (view: BasesDirectionViewObservation) => ({
      requested_file_path: view.requested_file_path,
      selection_succeeded: view.selection_succeeded,
      active_file_path: view.active_file_path,
      active_view_type: view.active_view_type,
      state_settled: view.state_settled,
      expected_parse_error: hasExpectedOmittedGroupDirectionParseError(
        view,
        "Omitted Direction.base",
        "C07 group direction omitted",
      ),
      body: view.body,
      group_order: view.group_order_from_rendered_rows,
      row_order_by_group: view.row_order_by_group_from_dom,
      rendered_file_paths: view.rendered_file_paths,
      table_root_class: view.table_root_class,
      visible_group_heading_count: view.visible_group_heading_count,
      visible_group_row_candidate_count: view.visible_group_row_candidate_count,
      unmapped_group_heading_count: view.unmapped_group_heading_count,
      unmapped_group_row_candidate_count: view.unmapped_group_row_candidate_count,
      unmapped_data_row_candidate_count: view.unmapped_data_row_candidate_count,
      visible_data_row_candidate_count: view.visible_data_row_candidate_count,
      visible_bases_row_candidate_count: view.visible_bases_row_candidate_count,
      error_dom_candidates: view.bases_dom_candidates
        .filter((candidate) => candidate.class_name.includes("bases-error"))
        .map(({tag, class_name, role, text}) => ({tag, class_name, role, text})),
      notices: view.notices,
    });
    basesReport.omitted_direction_parse_error_stable_across_reopen = isDeepStrictEqual(
      comparableOmittedParseError(firstViews[omittedBasesDirection]),
      comparableOmittedParseError(reopenedViews[omittedBasesDirection]),
    );
    basesReport.invalid_direction_observation_on_first_open = firstViews[invalidBasesDirection];
    basesReport.invalid_direction_observation_after_reopen = reopenedViews[invalidBasesDirection];
    if (!basesReport.source_hashes_unchanged_except_known_reference_rewrite
      || !basesReport.group_order_stable_across_reopen
      || !basesReport.row_order_stable_across_reopen
      || !Object.values(basesReport.fixture_path_set_captured_on_first_open as Record<string, boolean>).every(Boolean)
      || !Object.values(basesReport.fixture_path_set_captured_after_reopen as Record<string, boolean>).every(Boolean)
      || !Object.values(basesReport.complete_group_capture_on_first_open as Record<string, boolean>).every(Boolean)
      || !Object.values(basesReport.complete_group_capture_after_reopen as Record<string, boolean>).every(Boolean)
      || !basesReport.complete_observations_stable_across_reopen
      || !basesReport.omitted_direction_parse_error_on_first_open
      || !basesReport.omitted_direction_parse_error_after_reopen
      || !basesReport.omitted_direction_parse_error_stable_across_reopen
      || firstViews[omittedBasesDirection].active_file_path !== "Omitted Direction.base"
      || firstViews[omittedBasesDirection].active_view_type !== "bases"
      || !firstViews[omittedBasesDirection].state_settled
      || reopenedViews[omittedBasesDirection].active_file_path !== "Omitted Direction.base"
      || reopenedViews[omittedBasesDirection].active_view_type !== "bases"
      || !reopenedViews[omittedBasesDirection].state_settled
      || firstViews[invalidBasesDirection].requested_file_path !== "Invalid Direction.base"
      || reopenedViews[invalidBasesDirection].requested_file_path !== "Invalid Direction.base"
      || firstViews[invalidBasesDirection].active_file_path !== "Invalid Direction.base"
      || reopenedViews[invalidBasesDirection].active_file_path !== "Invalid Direction.base"
      || !firstViews[invalidBasesDirection].selection_succeeded
      || !reopenedViews[invalidBasesDirection].selection_succeeded
      || !firstViews[invalidBasesDirection].state_settled
      || !reopenedViews[invalidBasesDirection].state_settled) {
      throw new Error("C07 Bases first-open/reopen capture assertions failed");
    }
    basesReport.capture_status = "completed";
    basesReport.status = basesReport.reference_app_source_preservation_passed === true
      ? "passed"
      : "captured-reference-mutation";
    report.reference_capture_summary = {
      status: "completed",
      c07_capture_status: basesReport.status,
      reference_app_source_preservation_passed: basesReport.reference_app_source_preservation_passed,
      source_rewrite_observation_count: (basesReport.source_rewrite_observations as unknown[]).length,
      interpretation: "C07.2 reference capture completed. A passing capture records pinned-app behavior and does not establish Rust source-preservation parity.",
    };
    await saveReport();
  } catch (error) {
    basesReport.status = "failed";
    basesReport.error = error instanceof Error ? error.message : String(error);
    if (sourceHashes) {
      try {
        const failureBytes: Record<string, Buffer> = {};
        const failureMismatches: string[] = [];
        const failureHashes = await assertBasesDirectionSourceHashes(
          sourceHashes,
          "failure",
          true,
          failureBytes,
          failureMismatches,
        );
        basesReport.source_hashes_after_failure = failureHashes;
        const invalidDirectionHash = failureHashes["Invalid Direction.base"];
        const invalidDirectionSnapshot = failureBytes["Invalid Direction.base"];
        if (invalidDirectionHash && invalidDirectionSnapshot) {
          await recordBasesDirectionReferenceRewrite(
            sourceHashes,
            failureHashes,
            invalidDirectionSnapshot,
            secondProcess || secondConnection ? "reopen" : "first_open",
            "failure",
          );
        }
        if (failureMismatches.length > 0) {
          basesReport.source_preservation_failure = failureMismatches.join("; ");
        }
      } catch (sourceError) {
        basesReport.source_preservation_failure = sourceError instanceof Error ? sourceError.message : String(sourceError);
      }
    }
    await saveReport();
    throw error;
  } finally {
    await stopProcess(firstProcess, firstConnection).catch(() => undefined);
    await stopProcess(secondProcess, secondConnection).catch(() => undefined);
  }
}

async function run(): Promise<void> {
  await mkdir(reportDirectory, {recursive: true});
  await mkdir(workDirectory, {recursive: true});
  await createFixture();
  await saveReport();

  let authorProcess: ChildProcess | undefined;
  let authorConnection: DevToolsConnection | undefined;
  let reopenProcess: ChildProcess | undefined;
  let reopenConnection: DevToolsConnection | undefined;
  try {
    authorProcess = await createObsidianProfile(join(workDirectory, "obsidian-profile"), 9222);
    const authored = await authorFixtureThroughObsidian(authorProcess);
    authorConnection = authored.connection;
    await delay(2_000);
    await stopProcess(authorProcess, authorConnection);
    authorProcess = undefined;
    authorConnection = undefined;

    const beforeRust = await snapshotTree(vaultRoot);
    (report.vault_snapshots as Record<string, unknown>).before_openobsidian = beforeRust;
    (report.obsidian_authoring as Record<string, unknown>).closed_before_baseline = true;
    (report.fixture as Record<string, unknown>).authored_note_path = authored.notePath;
    await writeFile(join(reportDirectory, "vault-before-openobsidian.json"), `${JSON.stringify(beforeRust, null, 2)}\n`);
    await saveReport();

    await runOpenObsidian(beforeRust);
    const expectedBeforeObsidianReopen = await snapshotTree(vaultRoot);
    (report.vault_snapshots as Record<string, unknown>).expected_before_obsidian_reopen = expectedBeforeObsidianReopen;
    await writeFile(join(reportDirectory, "vault-after-openobsidian.json"), `${JSON.stringify(report.vault_snapshots && (report.vault_snapshots as Record<string, unknown>).after_openobsidian, null, 2)}\n`);
    await writeFile(join(reportDirectory, "vault-before-obsidian-reopen.json"), `${JSON.stringify(expectedBeforeObsidianReopen, null, 2)}\n`);

    reopenProcess = await createObsidianProfile(join(workDirectory, "obsidian-profile"), 9223);
    const expectedAttachmentPresent = expectedBeforeObsidianReopen.some((entry) => entry.path === attachmentPath && entry.kind === "file");
    reopenConnection = await reopenInObsidian(
      reopenProcess,
      authored.notePath,
      expectedAttachmentPresent,
      externalRenamedMarkdownPath,
    );
    await delay(2_000);
    await stopProcess(reopenProcess, reopenConnection);
    reopenProcess = undefined;
    reopenConnection = undefined;

    const afterReopen = await snapshotTree(vaultRoot);
    const reopenChanges = changedPaths(expectedBeforeObsidianReopen, afterReopen);
    const allowedChanges = reopenChanges.filter((change) => workspaceStateAllowlist.includes(change.path));
    const unapprovedChanges = reopenChanges.filter((change) => !workspaceStateAllowlist.includes(change.path));
    if (unapprovedChanges.length > 0) {
      throw new Error(`Obsidian reopen changed non-workspace vault content: ${JSON.stringify(unapprovedChanges).slice(0, 6_000)}`);
    }
    (report.vault_snapshots as Record<string, unknown>).after_obsidian_reopen = afterReopen;
    (report.vault_snapshots as Record<string, unknown>).reference_workspace_state_changes = allowedChanges;
    (report.vault_snapshots as Record<string, unknown>).non_workspace_paths_unchanged_after_reopen = true;
    (report.obsidian_reopen as Record<string, unknown>).workspace_state_changes = allowedChanges;
    (report.obsidian_reopen as Record<string, unknown>).status = "passed";
    await writeFile(join(reportDirectory, "vault-after-obsidian-reopen.json"), `${JSON.stringify(afterReopen, null, 2)}\n`);
    await writeFile(join(reportDirectory, "vault-reopen-workspace-changes.json"), `${JSON.stringify(allowedChanges, null, 2)}\n`);

    await runCanvasReferenceProbe();
    await runBasesDirectionReferenceProbe();

    report.status = "passed";
    report.completed_at = new Date().toISOString();
  } finally {
    await stopProcess(authorProcess, authorConnection).catch(() => undefined);
    await stopProcess(reopenProcess, reopenConnection).catch(() => undefined);
    await saveReport();
  }
}

try {
  await run();
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.message : String(error);
  report.completed_at = new Date().toISOString();
  console.error(`Obsidian vault round-trip acceptance failed: ${String(report.error)}`);
} finally {
  await saveReport();
}

const referenceCaptureSummary = report.reference_capture_summary as Record<string, unknown> | undefined;
const captureMessage = referenceCaptureSummary
  ? `; C07 reference capture=${String(referenceCaptureSummary.status)}; source preservation=${String(referenceCaptureSummary.reference_app_source_preservation_passed)}`
  : "";
console.log(`Obsidian vault round-trip acceptance: ${String(report.status)}${captureMessage}; report=${join(reportDirectory, "obsidian-vault-roundtrip-report.json")}`);
if (report.status !== "passed") process.exit(1);
