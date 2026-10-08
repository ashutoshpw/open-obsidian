import {mkdir, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";

type CdpTarget = {
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

type RuntimeSnapshot = {
  title: string;
  url: string;
  bodyText: string;
};

const debugUrl = process.env.OBSIDIAN_DEBUG_URL ?? "http://127.0.0.1:9222";
const reportDirectory = resolve(process.env.OBSIDIAN_REPORT_DIRECTORY ?? "artifacts/obsidian-reference");
const reportPath = join(reportDirectory, "obsidian-reference-runtime-report.json");
const screenshotPath = join(reportDirectory, "obsidian-reference-first-run.png");
const appVersion = process.env.OBSIDIAN_RELEASE_VERSION ?? "unknown";
const appSha256 = process.env.OBSIDIAN_RELEASE_SHA256 ?? "unknown";
const sourceSha = process.env.GITHUB_SHA ?? "unknown";
const runnerOs = process.env.RUNNER_OS ?? "unknown";
const startedAt = new Date().toISOString();

const report: Record<string, unknown> = {
  schema_version: 1,
  purpose: "Official Obsidian desktop runner feasibility only; no vault was opened.",
  status: "pending",
  started_at: startedAt,
  source_sha: sourceSha,
  runner_os: runnerOs,
  obsidian_version: appVersion,
  obsidian_appimage_sha256: appSha256,
  run_id: process.env.GITHUB_RUN_ID ?? "unknown",
  run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? "unknown",
  screenshot: screenshotPath,
  vault_reopen_acceptance: "pending",
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
      }, 15_000);
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

  close(): void {
    this.socket.close();
  }
}

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return await response.json() as T;
}

async function waitForPageTarget(): Promise<CdpTarget> {
  const deadline = Date.now() + 120_000;
  let lastError = "No Obsidian page target has appeared";
  while (Date.now() < deadline) {
    try {
      const targets = await json<CdpTarget[]>(`${debugUrl}/json/list`);
      const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (target?.webSocketDebuggerUrl) return target;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 1_000));
  }
  throw new Error(`Obsidian did not expose a page target within 120 seconds: ${lastError}`);
}

async function waitForDevToolsVersion(): Promise<{Browser?: string; "Protocol-Version"?: string}> {
  const deadline = Date.now() + 120_000;
  let lastError = "Obsidian DevTools has not started listening";
  while (Date.now() < deadline) {
    try {
      return await json<{Browser?: string; "Protocol-Version"?: string}>(`${debugUrl}/json/version`);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 1_000));
  }
  throw new Error(`Obsidian DevTools did not start within 120 seconds: ${lastError}`);
}

async function waitForRenderedPage(connection: DevToolsConnection): Promise<RuntimeSnapshot> {
  const deadline = Date.now() + 90_000;
  let lastSnapshot: RuntimeSnapshot = {title: "", url: "", bodyText: ""};
  while (Date.now() < deadline) {
    const response = await connection.request("Runtime.evaluate", {
      expression: "JSON.stringify({title: document.title, url: location.href, bodyText: document.body?.innerText ?? ''})",
      returnByValue: true,
      awaitPromise: true,
    });
    const value = (response.result?.result as {value?: unknown} | undefined)?.value;
    if (typeof value === "string") {
      lastSnapshot = JSON.parse(value) as RuntimeSnapshot;
      if (lastSnapshot.title.trim().length > 0 || lastSnapshot.bodyText.trim().length > 0) return lastSnapshot;
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 1_000));
  }
  throw new Error(`Obsidian page remained blank for 90 seconds; last title=${lastSnapshot.title || "<empty>"}`);
}

async function run(): Promise<void> {
  if (appVersion === "unknown" || appSha256 === "unknown") {
    throw new Error("The pinned Obsidian version and AppImage checksum must be supplied by CI");
  }
  await mkdir(reportDirectory, {recursive: true});
  const version = await waitForDevToolsVersion();
  report.devtools_browser = version.Browser ?? "unknown";
  report.devtools_protocol_version = version["Protocol-Version"] ?? "unknown";

  const target = await waitForPageTarget();
  report.page_target = {title: target.title ?? "", url: target.url ?? ""};
  if (!target.webSocketDebuggerUrl) throw new Error("Obsidian page target did not expose its DevTools WebSocket");

  const connection = await DevToolsConnection.connect(target.webSocketDebuggerUrl);
  try {
    await connection.request("Page.enable");
    await connection.request("Runtime.enable");
    const snapshot = await waitForRenderedPage(connection);
    report.page = {
      title: snapshot.title,
      url: snapshot.url,
      body_text: snapshot.bodyText.slice(0, 8_000),
      body_text_characters: snapshot.bodyText.length,
    };
    const screenshot = await connection.request("Page.captureScreenshot", {format: "png", captureBeyondViewport: false});
    const base64 = (screenshot.result?.data as string | undefined);
    if (!base64) throw new Error("Obsidian did not return a renderer screenshot");
    await writeFile(screenshotPath, Buffer.from(base64, "base64"));
  } finally {
    connection.close();
  }

  report.status = "passed";
  report.completed_at = new Date().toISOString();
}

try {
  await run();
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.message : String(error);
  report.completed_at = new Date().toISOString();
}

await mkdir(reportDirectory, {recursive: true});
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Obsidian reference runner feasibility: ${String(report.status)}; report=${reportPath}`);
if (report.status !== "passed") process.exit(1);
