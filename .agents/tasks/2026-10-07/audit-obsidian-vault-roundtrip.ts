import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {lstat, mkdir, readFile, readdir, readlink, realpath, writeFile} from "node:fs/promises";
import {createWriteStream} from "node:fs";
import {join, relative, resolve, sep} from "node:path";
import {spawn, type ChildProcess} from "node:child_process";

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
const obsidianAsset = requiredEnv("OBSIDIAN_RELEASE_ASSET");
const obsidianSourcePlatform = requiredEnv("OBSIDIAN_SOURCE_PLATFORM");
const seedMarkdownPath = "Nested Ω/space note.md";
const seedMarkdown = "\uFEFF---\r\ntitle: Original CRLF note\r\nunknown_nested:\r\n  keep: [true, 7, 'opaque']\r\n---\r\n\r\nOriginal bytes stay untouched.\r\n";
const workspaceStateAllowlist = [".obsidian/workspace.json", ".obsidian/workspace-mobile.json"];
const startedAt = new Date().toISOString();

const report: Record<string, unknown> = {
  schema_version: 1,
  milestone: "R2.6.49-C01.2-01/03-cross-platform-reference-roundtrip",
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
  vault_snapshots: {},
  openobsidian_app_data: {},
  workspace_state_allowlist: workspaceStateAllowlist,
  acceptance_limits: [
    "The run proves the read-only startup and reopen workflow on the recorded runner platform only; other operating systems require their own passing artifact.",
    "This run does not certify editing, all product C01 flows, or general plugin/theme compatibility.",
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
    if (!match) throw new Error(`Could not read ${key} from Obsidian folder picker geometry`);
    return Number(match[1]);
  };
  const windowX = readGeometry("X");
  const windowY = readGeometry("Y");
  const windowWidth = readGeometry("WIDTH");
  const windowHeight = readGeometry("HEIGHT");
  const clickX = Math.round(windowX + windowWidth * 0.956);
  const clickY = Math.round(windowY + windowHeight * 0.969);
  xdotool("mousemove", "--sync", String(clickX), String(clickY));
  xdotool("click", "1");
  return {window_x: windowX, window_y: windowY, window_width: windowWidth, window_height: windowHeight, click_x: clickX, click_y: clickY};
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
  const windowId = execFileSync("swift", ["-e", script], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim().split(/\s+/).at(-1);
  if (!windowId || !/^\d+$/.test(windowId)) throw new Error("Could not identify OpenObsidian's macOS window for screenshot capture");
  const pngPath = join(reportDirectory, filename);
  execFileSync("screencapture", ["-x", `-l${windowId}`, pngPath], {stdio: "ignore"});
  return pngPath;
}

async function clickFirstRunOpenButton(connection: DevToolsConnection): Promise<void> {
  const visible = await connection.evaluateJson<{matched: boolean; buttons: string[]}>(`(() => {
    const buttons = [...document.querySelectorAll('button,[role="button"]')];
    const summary = buttons.map((button) => (button.innerText || button.textContent || '').trim()).filter(Boolean);
    const target = buttons.find((button) => (button.innerText || button.textContent || '').trim() === 'Open');
    return {matched:Boolean(target),buttons:summary};
  })()`);
  (report.obsidian_authoring as Record<string, unknown>).first_run_buttons = visible.buttons;
  if (!visible.matched) throw new Error(`Could not find Obsidian's exact Open button; visible button labels=${visible.buttons.join(" | ")}`);
  // Electron's native folder picker blocks the renderer thread while it is open, so
  // dispatch the click without waiting for Runtime.evaluate's response.
  connection.send("Runtime.evaluate", {
    expression: `(() => [...document.querySelectorAll('button,[role="button"]')]
      .find((button) => (button.innerText || button.textContent || '').trim() === 'Open')?.click())()`,
    returnByValue: true,
  });
}

async function finishVaultDirectorySelection(connection: DevToolsConnection, port: number, pickerEvidence: Record<string, unknown>): Promise<DevToolsConnection> {
  const vaultTarget = await waitForPageTarget(
    port,
    (candidate) => typeof candidate.url === "string" && candidate.url.startsWith("app://obsidian.md/") && !candidate.url.includes("/starter.html"),
    "Obsidian vault renderer after folder selection",
  );
  const pageTargets = await readPageTargets(port);
  const authoring = report.obsidian_authoring as Record<string, unknown>;
  authoring.folder_picker = {
    ...pickerEvidence,
    page_targets_after_folder_selection: pageTargets.map(({id, title, url, type}) => ({id, title, url, type})),
    vault_renderer_target: {id: vaultTarget.id ?? null, title: vaultTarget.title ?? "", url: vaultTarget.url ?? ""},
  };
  connection.close();
  connection = await connectTarget(vaultTarget);

  const isVaultLoaded = (body: string) => body.includes("C01.2 Roundtrip Fixture") && !body.includes("Open folder as vault") && !body.includes("Create new vault");
  const body = await waitForRenderer(connection, "document.body?.innerText ?? ''", isVaultLoaded, "Obsidian to open the selected folder", 45_000);
  authoring.selected_vault_text = body.slice(0, 2_000);
  authoring.selected_vault_in_ui = true;
  return connection;
}

async function chooseVaultDirectoryLinux(connection: DevToolsConnection, port: number): Promise<DevToolsConnection> {
  const initialWindowId = activeWindowId();
  const initialTitle = activeWindowTitle();
  await clickFirstRunOpenButton(connection);
  const pickerWindow = await waitFor("Obsidian folder picker", async () => {
    await delay(250);
    return {windowId: activeWindowId(), title: activeWindowTitle()};
  }, (value) => value.windowId.length > 0 && value.windowId !== initialWindowId, 20_000).catch(() => ({windowId: activeWindowId(), title: activeWindowTitle()}));
  (report.obsidian_authoring as Record<string, unknown>).folder_picker = {
    initial_window_id: initialWindowId,
    initial_window_title: initialTitle,
    picker_window_id: pickerWindow.windowId,
    picker_window_title: pickerWindow.title,
  };
  const pickerScreenshots = [await captureDesktopScreenshot("obsidian-folder-picker-initial.png")];

  xdotool("key", "ctrl+l");
  xdotool("type", "--clearmodifiers", "--delay", "2", vaultRoot);
  pickerScreenshots.push(await captureDesktopScreenshot("obsidian-folder-picker-path-entered.png"));
  const pickerStillActive = () => activeWindowId() === pickerWindow.windowId;
  const openButtonClick = clickWindowOpenButton(pickerWindow.windowId);
  await delay(1_000);
  pickerScreenshots.push(await captureDesktopScreenshot("obsidian-folder-picker-after-open-click.png"));
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
  (report.obsidian_authoring as Record<string, unknown>).folder_picker_closed = true;

  return await finishVaultDirectorySelection(connection, port, {
    initial_window_id: initialWindowId,
    initial_window_title: initialTitle,
    picker_window_id: pickerWindow.windowId,
    picker_window_title: pickerWindow.title,
    open_button_click: openButtonClick,
    picker_screenshots: pickerScreenshots.map((path) => relative(reportDirectory, path)),
    picker_closed: true,
  });
}

async function chooseVaultDirectoryMacOS(connection: DevToolsConnection, port: number): Promise<DevToolsConnection> {
  await clickFirstRunOpenButton(connection);
  await delay(1_000);
  const pickerScreenshots = [await captureDesktopScreenshot("obsidian-folder-picker-initial.png")];
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
  execFileSync("osascript", ["-e", script, vaultRoot], {stdio: "ignore"});
  await delay(1_000);
  pickerScreenshots.push(await captureDesktopScreenshot("obsidian-folder-picker-after-path.png"));
  return await finishVaultDirectorySelection(connection, port, {
    interaction: "macOS Open panel: Go to Folder (Command-Shift-G), enter the fixture path, and confirm folder selection",
    picker_screenshots: pickerScreenshots.map((path) => relative(reportDirectory, path)),
  });
}

async function chooseVaultDirectoryWindows(connection: DevToolsConnection, port: number): Promise<DevToolsConnection> {
  await clickFirstRunOpenButton(connection);
  await delay(1_000);
  const pickerScreenshots = [await captureDesktopScreenshot("obsidian-folder-picker-initial.png")];
  const script = `
    $ErrorActionPreference = "Stop"
    $shell = New-Object -ComObject WScript.Shell
    Start-Sleep -Milliseconds 500
    $shell.SendKeys("^l")
    Start-Sleep -Milliseconds 300
    $shell.SendKeys($env:OBSIDIAN_PICKER_VAULT_PATH)
    Start-Sleep -Milliseconds 300
    $shell.SendKeys("{ENTER}")
    Start-Sleep -Milliseconds 750
    $shell.SendKeys("%s")
    Start-Sleep -Milliseconds 500
    $shell.SendKeys("{ENTER}")
  `;
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    env: {...process.env, OBSIDIAN_PICKER_VAULT_PATH: vaultRoot},
    stdio: "ignore",
  });
  await delay(1_000);
  pickerScreenshots.push(await captureDesktopScreenshot("obsidian-folder-picker-after-path.png"));
  return await finishVaultDirectorySelection(connection, port, {
    interaction: "Windows folder picker: navigate to the fixture path and confirm Select Folder",
    picker_screenshots: pickerScreenshots.map((path) => relative(reportDirectory, path)),
  });
}

async function chooseVaultDirectory(connection: DevToolsConnection, port: number): Promise<DevToolsConnection> {
  if (process.platform === "linux") return await chooseVaultDirectoryLinux(connection, port);
  if (process.platform === "darwin") return await chooseVaultDirectoryMacOS(connection, port);
  if (process.platform === "win32") return await chooseVaultDirectoryWindows(connection, port);
  throw new Error(`Unsupported Obsidian folder picker platform ${process.platform}`);
}

async function chooseRestrictedMode(connection: DevToolsConnection): Promise<void> {
  const authoring = report.obsidian_authoring as Record<string, unknown>;
  const state = await connection.evaluateJson<{body: string; buttons: string[]}>(`(() => {
    const buttons = [...document.querySelectorAll('button,[role="button"]')];
    return {
      body: document.body?.innerText ?? '',
      buttons: buttons.map((button) => (button.innerText || button.textContent || '').trim()).filter(Boolean),
    };
  })()`);
  const restrictedModeLabel = "Browse vault in Restricted Mode";
  authoring.trust_prompt_buttons = state.buttons;
  if (!state.buttons.includes(restrictedModeLabel)) {
    if (state.body.includes("Do you trust the author of this vault?")) {
      throw new Error("Obsidian displayed the vault trust prompt without its Restricted Mode button");
    }
    authoring.restricted_mode_selected = false;
    return;
  }

  connection.send("Runtime.evaluate", {
    expression: `(() => [...document.querySelectorAll('button,[role="button"]')]
      .find((button) => (button.innerText || button.textContent || '').trim() === '${restrictedModeLabel}')?.click())()`,
    returnByValue: true,
  });
  const body = await waitForRenderer(connection, "document.body?.innerText ?? ''", (value) => !value.includes("Do you trust the author of this vault?") && value.includes("C01.2 Roundtrip Fixture"), "Obsidian to browse the fixture in Restricted Mode", 30_000);
  authoring.restricted_mode_selected = true;
  authoring.restricted_mode_text = body.slice(0, 2_000);
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

async function createObsidianProfile(profileDirectory: string, port: number): Promise<ChildProcess> {
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
  return launchLogged(obsidianBinary, args, join(reportDirectory, port === 9222 ? "obsidian-author.log" : "obsidian-reopen.log"), env);
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

async function captureOpenObsidianScreenshot(windowId: string, child: ChildProcess): Promise<{pngPath: string; windowPngPath: string; ocrText: string}> {
  await focusOpenObsidian(child);
  const pngPath = await captureDesktopScreenshot("openobsidian-vault.png");
  const windowPngPath = process.platform === "linux"
    ? await captureX11WindowScreenshot(windowId, "openobsidian-vault-window.png")
    : process.platform === "darwin"
      ? await captureMacOSWindowScreenshot(child.pid ?? -1, "openobsidian-vault-window.png")
      : pngPath;
  const tesseract = process.platform === "win32" ? "tesseract.exe" : "tesseract";
  const pageSegmentationModes = process.platform === "darwin" ? ["11", "6"] : ["6"];
  const ocrText = pageSegmentationModes.map((mode) => execFileSync(tesseract, [windowPngPath, "stdout", "--psm", mode], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim()).filter(Boolean).join("\n");
  return {pngPath, windowPngPath, ocrText};
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
  const child = launchLogged(openObsidianBinary, ["--open-vault", vaultRoot], join(reportDirectory, "openobsidian.log"), appEnv);
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
      window = {window_id: String(child.pid ?? "unknown"), title: "platform desktop screenshot", geometry: "full virtual screen"};
      (report.openobsidian_open as Record<string, unknown>).native_window = window;
    }
    const open = report.openobsidian_open as Record<string, unknown>;
    let renderAttempt = 0;
    await waitFor("OpenObsidian to render the selected vault and note count", async () => {
      await delay(1_000);
      const captured = await captureOpenObsidianScreenshot(window.window_id, child);
      renderAttempt += 1;
      open.screenshot = "openobsidian-vault.png";
      open.window_screenshot = "openobsidian-vault-window.png";
      open.screen_ocr = captured.ocrText;
      open.render_attempts = renderAttempt;
      return captured;
    }, (candidate) => candidate.ocrText.toLowerCase().includes("roundtrip fixture") && /2\s+Markdown files found/i.test(candidate.ocrText), 30_000);
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

    await delay(2_000);
    await stopProcess(child);
    const afterVault = await snapshotTree(vaultRoot);
    ensureExactSnapshot(noOpBaseline, afterVault, "OpenObsidian no-op open/close");
    const afterAppData = await snapshotTree(appDataRoot);
    ensureExactSnapshot(initialAppData, afterAppData, "OpenObsidian app data after startup");
    (report.vault_snapshots as Record<string, unknown>).after_openobsidian = afterVault;
    (report.openobsidian_app_data as Record<string, unknown>).snapshot_after_close = afterAppData;
    (report.openobsidian_app_data as Record<string, unknown>).unchanged_after_initial_startup = true;
    return afterVault;
  } finally {
    await stopProcess(child).catch(() => undefined);
  }
}

async function reopenInObsidian(child: ChildProcess, notePath: string): Promise<DevToolsConnection> {
  if (child.exitCode !== null) throw new Error(`Pinned Obsidian exited before reopen (code ${child.exitCode})`);
  const {connection, browserVersion, target} = await connectObsidian(9223);
  const reopen = report.obsidian_reopen as Record<string, unknown>;
  reopen.devtools_browser = browserVersion;
  reopen.first_target = {title: target.title ?? "", url: target.url ?? ""};
  const notePathJson = JSON.stringify(notePath);
  let visible = await waitFor("Obsidian to reopen the authored vault note", async () => await connection.evaluateJson<{
    body: string;
    editor: string;
    title: string;
    paths: string[];
  }>(`(() => ({
    body: document.body?.innerText ?? '',
    editor: [...document.querySelectorAll('[contenteditable="true"]')].map((element) => element.innerText ?? '').join('\\n'),
    title: document.title,
    paths: [...document.querySelectorAll('[data-path]')].map((element) => element.getAttribute('data-path') || '')
  }))()`), (value) => value.editor.includes(noteMarker), 45_000).catch(() => null);

  if (!visible) {
    await connection.evaluate(`(() => {
      const target = [...document.querySelectorAll('[data-path]')].find((element) => element.getAttribute('data-path') === ${notePathJson});
      target?.click();
      return Boolean(target);
    })()`);
    visible = await waitFor("Obsidian's file explorer to open the authored note", async () => await connection.evaluateJson<{
      body: string;
      editor: string;
      title: string;
      paths: string[];
    }>(`(() => ({
      body: document.body?.innerText ?? '',
      editor: [...document.querySelectorAll('[contenteditable="true"]')].map((element) => element.innerText ?? '').join('\\n'),
      title: document.title,
      paths: [...document.querySelectorAll('[data-path]')].map((element) => element.getAttribute('data-path') || '')
    }))()`), (value) => value.editor.includes(noteMarker), 30_000);
  }

  if (!visible.paths.includes(notePath)) {
    throw new Error(`Obsidian file explorer does not expose authored note path ${notePath}; paths=${JSON.stringify(visible.paths).slice(0, 2_000)}`);
  }

  const noteSource = await readFile(join(vaultRoot, notePath), "utf8");
  const attachmentLinkPersistedInSource = noteSource.includes(noteEmbed);
  if (!attachmentLinkPersistedInSource) {
    throw new Error(`Reopened Obsidian note source does not retain the expected attachment link ${attachmentPath}`);
  }

  const attachmentFolderJson = JSON.stringify(attachmentPath.split("/")[0]);
  if (!visible.paths.includes(attachmentPath)) {
    await connection.evaluate(`(() => {
      const folder = [...document.querySelectorAll('[data-path]')].find((element) => element.getAttribute('data-path') === ${attachmentFolderJson});
      folder?.click();
    })()`);
    await delay(500);
  }
  const pathsAfterExpand = await connection.evaluateJson<string[]>(`[...document.querySelectorAll('[data-path]')].map((element) => element.getAttribute('data-path') || '')`);
  const exactAttachmentListed = pathsAfterExpand.includes(attachmentPath);
  const attachmentPathVisibleInRenderedNote = visible.editor.includes(attachmentPath);
  if (!exactAttachmentListed && !attachmentPathVisibleInRenderedNote) {
    throw new Error(`Obsidian does not display attachment path ${attachmentPath} in either the file explorer or the reopened note; paths=${JSON.stringify(pathsAfterExpand).slice(0, 2_000)}`);
  }

  const selectedVaultNameVisible = visible.title.includes("Roundtrip Fixture") || visible.body.includes("Roundtrip Fixture");
  if (!selectedVaultNameVisible) {
    throw new Error(`Obsidian did not visibly identify the reopened vault name; title=${JSON.stringify(visible.title)} body=${JSON.stringify(visible.body.slice(0, 2_000))}`);
  }
  reopen.status = "passed";
  reopen.selected_vault_name_visible = selectedVaultNameVisible;
    reopen.selected_vault_restored = visible.editor.includes(noteMarker) && visible.paths.includes(notePath);
  reopen.note_path = notePath;
  reopen.note_path_visible_in_file_explorer = true;
  reopen.attachment_path = attachmentPath;
  reopen.attachment_link_persisted_in_note_source = attachmentLinkPersistedInSource;
  reopen.attachment_path_visible_in_file_explorer = exactAttachmentListed;
  reopen.attachment_path_visible_in_editor_text = attachmentPathVisibleInRenderedNote;
  reopen.editor_text = visible.editor.slice(0, 2_000);
  reopen.visible_vault_text = visible.body.slice(0, 4_000);
  reopen.final_file_tree_paths = pathsAfterExpand;
  await captureObsidianScreenshot(connection, "obsidian-reopened-vault.png");
  reopen.screenshot = "obsidian-reopened-vault.png";
  return connection;
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
    await writeFile(join(reportDirectory, "vault-after-openobsidian.json"), `${JSON.stringify(report.vault_snapshots && (report.vault_snapshots as Record<string, unknown>).after_openobsidian, null, 2)}\n`);

    reopenProcess = await createObsidianProfile(join(workDirectory, "obsidian-profile"), 9223);
    reopenConnection = await reopenInObsidian(reopenProcess, authored.notePath);
    await delay(2_000);
    await stopProcess(reopenProcess, reopenConnection);
    reopenProcess = undefined;
    reopenConnection = undefined;

    const afterReopen = await snapshotTree(vaultRoot);
    const reopenChanges = changedPaths(beforeRust, afterReopen);
    const allowedChanges = reopenChanges.filter((change) => workspaceStateAllowlist.includes(change.path));
    const unapprovedChanges = reopenChanges.filter((change) => !workspaceStateAllowlist.includes(change.path));
    if (unapprovedChanges.length > 0) {
      throw new Error(`Obsidian reopen changed non-workspace vault content: ${JSON.stringify(unapprovedChanges).slice(0, 6_000)}`);
    }
    (report.vault_snapshots as Record<string, unknown>).after_obsidian_reopen = afterReopen;
    (report.vault_snapshots as Record<string, unknown>).reference_workspace_state_changes = allowedChanges;
    (report.vault_snapshots as Record<string, unknown>).non_workspace_paths_unchanged_after_reopen = true;
    (report.obsidian_reopen as Record<string, unknown>).workspace_state_changes = allowedChanges;
    await writeFile(join(reportDirectory, "vault-after-obsidian-reopen.json"), `${JSON.stringify(afterReopen, null, 2)}\n`);
    await writeFile(join(reportDirectory, "vault-reopen-workspace-changes.json"), `${JSON.stringify(allowedChanges, null, 2)}\n`);

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

console.log(`Obsidian vault round-trip acceptance: ${String(report.status)}; report=${join(reportDirectory, "obsidian-vault-roundtrip-report.json")}`);
if (report.status !== "passed") process.exit(1);
