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
const macOSWindowIds = new Map<number, string>();

const report: Record<string, unknown> = {
  schema_version: 1,
  milestone: "R2.6.63/R2.6.65-C01.2-native-folder-picker-roundtrip-and-cancel",
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
    "The run proves the read-only startup, native folder-picker selection and cancellation, and reopen workflow on the recorded runner platform only; other operating systems require their own passing artifact.",
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

function clickOpenVaultButtonLinux(windowId: string): {window_x: number; window_y: number; window_width: number; window_height: number; click_x: number; click_y: number; focused_window_before_click: string} {
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
  const focusedWindowBeforeClick = execFileSync("xdotool", ["getwindowfocus"], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
  xdotool(
    "mousemove", "--sync", String(clickX), String(clickY),
    "mousedown", "1", "sleep", "0.12", "mouseup", "1",
  );
  return {
    window_x: windowX,
    window_y: windowY,
    window_width: windowWidth,
    window_height: windowHeight,
    click_x: clickX,
    click_y: clickY,
    focused_window_before_click: focusedWindowBeforeClick,
  };
}

type X11WindowDescription = {window_id: string; title: string; window_class: string; geometry: string};

function x11WindowInventory(): X11WindowDescription[] {
  const output = execFileSync("xdotool", ["search", "--onlyvisible", "--name", "."], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
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
  if (process.platform === "darwin" || process.platform === "win32") {
    execFileSync("magick", [imagePath, "-colorspace", "Gray", "-level", "0%,35%", "-resize", "200%", ocrImagePath], {stdio: "ignore"});
    return ocrImagePath;
  }
  return imagePath;
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
  `;
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    env: {...process.env, OBSIDIAN_PICKER_VAULT_PATH: vaultRoot},
    stdio: "ignore",
  });
  await delay(750);
  pickerScreenshots.push(await captureDesktopScreenshot("obsidian-folder-picker-after-path.png"));
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
  pickerScreenshots.push(await captureDesktopScreenshot("obsidian-folder-picker-after-select.png"));
  return await finishVaultDirectorySelection(connection, port, {
    interaction: "Windows folder picker: navigate to the fixture path and invoke Select Folder through UI Automation, with focused Enter fallback",
    selection_result: selectionResult,
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

async function clickOpenVaultButton(child: ChildProcess, windowId: string): Promise<string> {
  await focusOpenObsidian(child);
  if (process.platform === "linux") {
    xdotool("windowraise", windowId);
    xdotool("windowfocus", "--sync", windowId);
    await delay(500);
    const clicked = clickOpenVaultButtonLinux(windowId);
    await delay(500);
    const screenshot = await captureDesktopScreenshot("openobsidian-vault-picker-cancel-click.png");
    (report.openobsidian_open as Record<string, unknown>).picker_cancel_click_screenshot = relative(reportDirectory, screenshot);
    return `Held an X11 primary click on OpenObsidian at (${clicked.click_x}, ${clicked.click_y}); window=${clicked.window_x},${clicked.window_y},${clicked.window_width},${clicked.window_height}; focused_window_before_click=${clicked.focused_window_before_click}.`;
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
          [OpenObsidianMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
          Start-Sleep -Milliseconds 80
          [OpenObsidianMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
          Write-Output "Sent a screen click to Open vault after UI Automation polling; IsEnabled=$isEnabled; bounds=$($bounds.Left),$($bounds.Top),$($bounds.Width),$($bounds.Height); state_transitions=$($stateTransitions -join ' | '); InvokePattern result: $invokeFailure"
      }
    `;
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
  }
  throw new Error(`Unsupported OpenObsidian folder picker platform ${process.platform}`);
}

async function selectOpenObsidianVaultFromNativePicker(child: ChildProcess, window: {window_id: string}): Promise<Record<string, unknown>> {
  const screenshots: string[] = [];
  await focusOpenObsidian(child);
  if (process.platform === "linux") xdotool("windowfocus", "--sync", window.window_id);
  screenshots.push(relative(reportDirectory, await captureDesktopScreenshot("openobsidian-vault-picker-home.png")));

  const openButtonInteraction = await clickOpenVaultButton(child, window.window_id);

  await delay(750);
  screenshots.push(relative(reportDirectory, await captureDesktopScreenshot("openobsidian-native-folder-picker.png")));
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
    screenshots.push(relative(reportDirectory, await captureDesktopScreenshot("openobsidian-native-folder-location-entry.png")));
    xdotool("mousemove", "--window", pickerWindowId, "400", "22");
    xdotool("click", "1");
    xdotool("key", "ctrl+a");
    xdotool("key", "BackSpace");
    await delay(250);
    const clearedLocationScreenshot = await captureDesktopScreenshot("openobsidian-native-folder-location-entry-cleared.png");
    screenshots.push(relative(reportDirectory, clearedLocationScreenshot));
    const clearedLocationOcr = await readScreenshotOcr(clearedLocationScreenshot);
    execFileSync("xclip", ["-selection", "clipboard", "-loops", "1", "-in"], {input: vaultRoot, stdio: ["pipe", "ignore", "ignore"]});
    xdotool("key", "ctrl+v");
    await delay(500);
    const enteredPathScreenshot = await captureDesktopScreenshot("openobsidian-native-folder-path-entered.png");
    screenshots.push(relative(reportDirectory, enteredPathScreenshot));
    const enteredPathOcr = await readScreenshotOcr(enteredPathScreenshot);
    const openReport = report.openobsidian_open as Record<string, unknown>;
    openReport.linux_folder_selection_location_entry_after_clear_ocr = clearedLocationOcr.slice(0, 2_000);
    openReport.linux_folder_selection_location_entry_ocr = enteredPathOcr.slice(0, 2_000);
    openReport.linux_folder_selection_location_entry_contains_fixture_path = enteredPathOcr.includes(vaultRoot);
    await saveReport();
    pathEntryInteraction = "Focused and cleared the Ctrl+L location entry, then pasted the full absolute fixture path from the CI clipboard.";
    const clicked = clickWindowOpenButton(pickerWindowId);
    folderSelectionInteraction = `Clicked the native folder dialog confirmation at (${clicked.click_x}, ${clicked.click_y}) after entering the fixture path.`;
    await delay(750);
    screenshots.push(relative(reportDirectory, await captureDesktopScreenshot("openobsidian-native-folder-path-opened.png")));
    if (activeWindowId() === pickerWindowId) {
      const openReport = report.openobsidian_open as Record<string, unknown>;
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
    (report.openobsidian_open as Record<string, unknown>).native_picker_accessibility_windows = pickerAccessibility;
    await saveReport();
    screenshots.push(relative(reportDirectory, await captureDesktopScreenshot("openobsidian-native-folder-picker-ready.png")));
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
    execFileSync("osascript", ["-e", pathScript, String(child.pid ?? -1), vaultRoot], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
    await delay(500);
    screenshots.push(relative(reportDirectory, await captureDesktopScreenshot("openobsidian-native-folder-path-entered.png")));
    (report.openobsidian_open as Record<string, unknown>).native_picker_screenshots = screenshots.slice();
    await saveReport();
    folderSelectionInteraction = await clickMacOSNativePickerOpenButton(child);
    await delay(500);
    screenshots.push(relative(reportDirectory, await captureDesktopScreenshot("openobsidian-native-folder-path-selected.png")));
    (report.openobsidian_open as Record<string, unknown>).native_picker_screenshots = screenshots.slice();
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
      env: {...process.env, OPENOBSIDIAN_PICKER_VAULT_PATH: vaultRoot},
      stdio: "ignore",
    });
    screenshots.push(relative(reportDirectory, await captureDesktopScreenshot("openobsidian-native-folder-path-entered.png")));
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
  screenshots.push(relative(reportDirectory, await captureDesktopScreenshot("openobsidian-vault-picker-selected.png")));
  return {
    open_button_interaction: openButtonInteraction,
    picker_window_id: pickerWindowId,
    picker_window_title: pickerWindowTitle,
    path_entry_interaction: pathEntryInteraction,
    folder_selection_interaction: folderSelectionInteraction,
    screenshots,
    selected_path: "$RUNNER_TEMP/openobsidian-c01-roundtrip/C01.2 Roundtrip Fixture",
  };
}

async function cancelOpenObsidianNativePicker(
  child: ChildProcess,
  window: {window_id: string},
  appDataRoot: string,
  appDataSnapshotBeforePickerOpen: SnapshotEntry[],
  vaultRoot: string,
  canonicalVault: string,
): Promise<Record<string, unknown>> {
  const screenshots: string[] = [];
  const linuxWindowsBefore = process.platform === "linux" ? x11WindowInventory() : null;
  const windowsBefore = process.platform === "win32" ? windowsTopLevelWindowInventory() : null;
  const openReport = report.openobsidian_open as Record<string, unknown>;
  if (linuxWindowsBefore) openReport.picker_cancel_x11_windows_before = linuxWindowsBefore;
  if (process.platform === "linux") openReport.picker_cancel_x11_input_before = x11InteractionState();
  if (windowsBefore) openReport.picker_cancel_windows_before = windowsBefore;
  const openButtonInteraction = await clickOpenVaultButton(child, window.window_id);
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
    let snapshot = await snapshotTree(appDataRoot);
    if (process.platform === "darwin" && !snapshot.some((entry) => entry.kind === "file" && entry.path === "app.ron")) {
      const appDataReport = report.openobsidian_app_data as Record<string, unknown>;
      appDataReport.eframe_persistence_settling_started_after_picker_open = true;
      await saveReport();
      snapshot = await waitFor(
        "eframe app.ron state to persist after native picker open and before cancellation",
        async () => await snapshotTree(appDataRoot),
        (candidate) => candidate.some((entry) => entry.kind === "file" && entry.path === "app.ron"),
        60_000,
      );
    }
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
  const expectedNoteCountVisible = /2\s+Markdown files found/i.test(restoredWindow.ocrText);
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

async function captureOpenObsidianScreenshot(windowId: string, child: ChildProcess, prefix = "openobsidian-vault"): Promise<{pngPath: string; windowPngPath: string; ocrPngPath: string; ocrText: string}> {
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
    (report.openobsidian_open as Record<string, unknown>).native_window = {
      window_id: windowsCapture.window_id,
      title: windowsCapture.title,
      geometry: windowsCapture.geometry,
    };
  }
  const ocrPngPath = await prepareScreenshotForOcr(windowPngPath);
  const tesseract = process.platform === "win32" ? "tesseract.exe" : "tesseract";
  const pageSegmentationModes = process.platform === "darwin" || process.platform === "win32" ? ["11", "6"] : ["6"];
  const ocrText = pageSegmentationModes.map((mode) => execFileSync(tesseract, [ocrPngPath, "stdout", "--psm", mode], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim()).filter(Boolean).join("\n");
  return {pngPath, windowPngPath, ocrPngPath, ocrText};
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
    open.folder_picker = await selectOpenObsidianVaultFromNativePicker(child, window);
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

    const appDataBaselineAfterPickerCancellation = await runOpenObsidianPickerCancellation(child, window, appDataRoot, noOpBaseline, initialAppData);
    await delay(2_000);
    await stopProcess(child);
    const afterVault = await snapshotTree(vaultRoot);
    ensureExactSnapshot(noOpBaseline, afterVault, "OpenObsidian no-op open, picker cancellation, and close");
    const afterAppData = await snapshotTree(appDataRoot);
    ensureExactSnapshot(appDataBaselineAfterPickerCancellation, afterAppData, "OpenObsidian app data after picker cancellation and close");
    (report.vault_snapshots as Record<string, unknown>).after_openobsidian = afterVault;
    (report.vault_snapshots as Record<string, unknown>).after_picker_cancellation_close = afterVault;
    (report.openobsidian_app_data as Record<string, unknown>).snapshot_after_close = afterAppData;
    (report.openobsidian_app_data as Record<string, unknown>).snapshot_after_picker_cancellation_close = afterAppData;
    const appDataChangesFromStartupThroughCancellation = changedPaths(initialAppData, appDataBaselineAfterPickerCancellation);
    (report.openobsidian_app_data as Record<string, unknown>).changes_from_startup_through_picker_cancellation = appDataChangesFromStartupThroughCancellation;
    (report.openobsidian_app_data as Record<string, unknown>).unchanged_after_initial_startup = appDataChangesFromStartupThroughCancellation.length === 0;
    (report.openobsidian_app_data as Record<string, unknown>).unchanged_after_picker_baseline_and_close = true;
    const cancellation = open.folder_picker_cancel as Record<string, unknown>;
    cancellation.vault_snapshot_unchanged_after_close = true;
    cancellation.app_data_snapshot_unchanged_after_close = true;
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
): Promise<SnapshotEntry[]> {
  const open = report.openobsidian_open as Record<string, unknown>;
  await delay(1_500);
  const startupScreen = await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-vault-before-picker-cancel");
  if (!startupScreen.ocrText.toLowerCase().includes("roundtrip fixture") || !/2\s+Markdown files found/i.test(startupScreen.ocrText)) {
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

  const pickerCancellation = await cancelOpenObsidianNativePicker(child, window, appDataRoot, appDataSnapshotBeforePickerOpen, vaultRoot, canonicalVault);
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

  open.folder_picker_cancel = {
    active_session: true,
    startup_vault_visible: true,
    startup_markdown_count_visible: true,
    startup_screen_ocr: startupScreen.ocrText.slice(0, 2_000),
    ...pickerCancellation,
    vault_snapshot_unchanged_after_cancel: vaultChangesAfterCancel.length === 0,
    app_data_snapshot_unchanged_after_cancel: appDataChangesAfterCancel.length === 0,
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
  ensureExactSnapshot(appDataSnapshotBeforeCancel, appDataAfterCancellation, "OpenObsidian app data after native picker cancellation");
  return appDataAfterCancellation;
}

async function reopenInObsidian(child: ChildProcess, notePath: string): Promise<DevToolsConnection> {
  if (child.exitCode !== null) throw new Error(`Pinned Obsidian exited before reopen (code ${child.exitCode})`);
  const {connection, browserVersion, target} = await connectObsidian(9223);
  const reopen = report.obsidian_reopen as Record<string, unknown>;
  reopen.devtools_browser = browserVersion;
  reopen.first_target = {title: target.title ?? "", url: target.url ?? ""};
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
