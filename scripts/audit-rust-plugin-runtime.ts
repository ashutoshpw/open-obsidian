import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {spawn} from "node:child_process";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {downloadPinnedAsset, integrityFailure, mainAsset, readJson, records, string} from "./plugin-audit-helpers.js";
import {asRecord} from "./json.js";

const root = resolve(import.meta.dir, "..");
const selectedIds = ["PC05", "PC08"];
const manifest = readJson(root, "fixtures/compatibility-manifest.json");
const byId = new Map(records(manifest.artifacts).map((artifact) => [string(artifact.id), artifact]));
const binaryName = process.platform === "win32" ? "openobsidian-plugin-runtime-probe.exe" : "openobsidian-plugin-runtime-probe";
const binaryPath = resolve(root, "target/release", binaryName);
const timeoutMs = 45_000;
const outputLimit = 100_000;

type ProbeResult = {
  pluginId: string;
  version: string;
  status: "passed" | "failed";
  integrity: "passed" | "failed";
  runtime?: Record<string, unknown>;
  report?: Record<string, unknown>;
  detail?: string;
};

function assetByName(artifact: Record<string, unknown>, name: string): Record<string, unknown> | null {
  return records(artifact.release_assets).find((asset) => string(asset.name) === name) ?? null;
}

function spawnProbe(args: string[]): Promise<{code: number | null; stdout: string; stderr: string; timedOut: boolean}> {
  const command = process.platform === "linux" ? "xvfb-run" : binaryPath;
  const commandArgs = process.platform === "linux" ? ["-a", "--server-args=-screen 0 1280x720x24", binaryPath, ...args] : args;
  const environment = {...process.env};
  if (process.platform === "linux") environment.GDK_BACKEND = "x11";
  const child = spawn(command, commandArgs, {cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"]});
  return new Promise((resolveOutcome) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (outcome: {code: number | null; stdout: string; stderr: string; timedOut: boolean}): void => {
      if (settled) return;
      settled = true;
      resolveOutcome(outcome);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk.toString()}`.slice(-outputLimit); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk.toString()}`.slice(-outputLimit); });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({code: null, stdout, stderr: `${stderr}\n${String(error)}`, timedOut: false});
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({code, stdout, stderr, timedOut});
    });
  });
}

function parseProbeOutput(output: string): Record<string, unknown> | null {
  const line = output.trim().split("\n").at(-1) ?? "";
  try { return asRecord(JSON.parse(line)); } catch { return null; }
}

function checkReport(pluginId: string, report: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (report.status !== "passed") problems.push("WebView or capability probe did not pass");
  const artifact = asRecord(report.artifact);
  const plugin = asRecord(report.plugin);
  const capabilityProbe = asRecord(report.capabilityProbe);
  const api = asRecord(report.api);
  const dom = asRecord(report.dom);
  const editor = asRecord(report.editorWorkflow);
  const stylesheet = asRecord(report.stylesheet);
  const runtime = asRecord(report.runtime);
  if (artifact?.id !== pluginId || typeof artifact.sha256 !== "string" || typeof artifact.manifestId !== "string" || typeof artifact.manifestSha256 !== "string") problems.push("artifact identity and pinned bundle/manifest hashes are missing from runtime report");
  if (plugin?.status !== "loaded") problems.push(`unchanged ${pluginId} bundle did not complete onload`);
  if (capabilityProbe?.passed !== true) problems.push("filesystem/process/network/credential denial probe did not pass");
  if (runtime?.host !== "wry" || typeof runtime.userAgent !== "string" || !runtime.userAgent || typeof runtime.webviewEngineVersion !== "string") problems.push("WebView runtime identity is incomplete");
  if (runtime.legacyCompatibilityState !== "Pending") problems.push("legacy compatibility state was reported as something other than pending");
  if (capabilityProbe?.nativeNetworkBlockedByCsp !== true) problems.push("the browser did not report a connect-src CSP denial");
  if (typeof dom?.bodyChildren !== "number" || typeof dom.pluginRootChildren !== "number") problems.push("browser DOM execution metrics are missing");
  if (pluginId === "PC05" && !(typeof editor?.completedCallbacks === "number" && editor.completedCallbacks > 0)) {
    problems.push("Advanced Tables did not complete an editor callback against the DOM-backed editor fixture");
  }
  if (pluginId === "PC08") {
    if (!(typeof api?.settingTabs === "number" && api.settingTabs > 0)) problems.push("Style Settings did not register its Obsidian settings API");
    if (!(typeof dom?.settingControls === "number" && dom.settingControls > 0)) problems.push("Style Settings did not render a control into the browser DOM");
    if (!(typeof stylesheet?.ruleCount === "number" && stylesheet.ruleCount > 0)) problems.push("Style Settings stylesheet did not load into the browser WebView");
  }
  return problems;
}

async function auditArtifact(pluginId: string, temporaryRoot: string): Promise<ProbeResult> {
  const artifact = byId.get(pluginId);
  if (!artifact) return {pluginId, version: "", status: "failed", integrity: "failed", detail: "plugin is missing from the pinned compatibility manifest"};
  const version = string(artifact.tag);
  const bundleAsset = mainAsset(artifact);
  if (!bundleAsset) return {pluginId, version, status: "failed", integrity: "failed", detail: "pinned main.js asset is missing"};
  const bundleBytes = await downloadPinnedAsset(string(bundleAsset.url), {attempts: 3, timeoutMs: 45_000});
  if (!bundleBytes) return {pluginId, version, status: "failed", integrity: "failed", detail: "pinned main.js download failed"};
  const bundleFailure = integrityFailure(bundleAsset, bundleBytes);
  if (bundleFailure) return {pluginId, version, status: "failed", integrity: "failed", detail: `main.js ${bundleFailure}`};

  const bundlePath = join(temporaryRoot, `${pluginId}.main.js`);
  writeFileSync(bundlePath, Buffer.from(bundleBytes));
  const manifestAsset = assetByName(artifact, "manifest.json");
  if (!manifestAsset) return {pluginId, version, status: "failed", integrity: "failed", detail: "pinned manifest.json asset is missing"};
  const manifestBytes = await downloadPinnedAsset(string(manifestAsset.url), {attempts: 3, timeoutMs: 45_000});
  if (!manifestBytes) return {pluginId, version, status: "failed", integrity: "failed", detail: "pinned manifest.json download failed"};
  const manifestFailure = integrityFailure(manifestAsset, manifestBytes);
  if (manifestFailure) return {pluginId, version, status: "failed", integrity: "failed", detail: `manifest.json ${manifestFailure}`};
  const manifestPath = join(temporaryRoot, `${pluginId}.manifest.json`);
  writeFileSync(manifestPath, Buffer.from(manifestBytes));
  const args = [
    `--plugin-id=${pluginId}`,
    `--plugin-version=${version}`,
    `--bundle=${bundlePath}`,
    `--sha256=${string(bundleAsset.sha256)}`,
    `--manifest=${manifestPath}`,
    `--manifest-sha256=${string(manifestAsset.sha256)}`,
    "--workflow-fixture=fixtures/plugin-loaded-workflows.json",
  ];

  const stylesheetAsset = assetByName(artifact, "styles.css");
  if (stylesheetAsset) {
    const stylesheetBytes = await downloadPinnedAsset(string(stylesheetAsset.url), {attempts: 3, timeoutMs: 45_000});
    if (!stylesheetBytes) return {pluginId, version, status: "failed", integrity: "failed", detail: "pinned styles.css download failed"};
    const stylesheetFailure = integrityFailure(stylesheetAsset, stylesheetBytes);
    if (stylesheetFailure) return {pluginId, version, status: "failed", integrity: "failed", detail: `styles.css ${stylesheetFailure}`};
    const stylesheetPath = join(temporaryRoot, `${pluginId}.styles.css`);
    writeFileSync(stylesheetPath, Buffer.from(stylesheetBytes));
    args.push(`--stylesheet=${stylesheetPath}`, `--stylesheet-sha256=${string(stylesheetAsset.sha256)}`);
  }

  const outcome = await spawnProbe(args);
  const report = parseProbeOutput(outcome.stdout);
  if (!report) {
    return {pluginId, version, status: "failed", integrity: "passed", detail: `probe produced no JSON report (exit=${String(outcome.code)}, timeout=${outcome.timedOut}): ${(outcome.stderr || outcome.stdout).slice(-800)}`};
  }
  const reportedArtifact = asRecord(report.artifact);
  const actualHash = string(bundleAsset.sha256);
  const manifestHash = string(manifestAsset.sha256);
  const stylesheetHash = string(stylesheetAsset?.sha256);
  const reportStylesheet = asRecord(report.stylesheet);
  const expectedManifest = asRecord(manifestAsset.manifest);
  const expectedManifestId = string(expectedManifest?.id);
  const problems = checkReport(pluginId, report);
  if (reportedArtifact?.sha256 !== actualHash) problems.push("runtime-reported bundle hash differs from the pinned manifest");
  if (reportedArtifact?.manifestSha256 !== manifestHash) problems.push("runtime-reported plugin manifest hash differs from the pinned manifest");
  if (expectedManifestId && reportedArtifact?.manifestId !== expectedManifestId) problems.push("runtime-reported plugin manifest id differs from its pinned release manifest");
  if (stylesheetHash && reportStylesheet?.sha256 !== stylesheetHash) problems.push("runtime-reported stylesheet hash differs from the pinned manifest");
  if (outcome.code !== 0) problems.push(`probe process exited ${String(outcome.code)}`);
  const runtime = asRecord(report.runtime) ?? undefined;
  return {
    pluginId,
    version,
    status: problems.length === 0 ? "passed" : "failed",
    integrity: "passed",
    runtime: runtime ?? undefined,
    report,
    ...(problems.length ? {detail: problems.join("; ")} : {}),
  };
}

async function main(): Promise<number> {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "openobsidian-rust-webview-"));
  const results: ProbeResult[] = [];
  try {
    for (const pluginId of selectedIds) {
      try { results.push(await auditArtifact(pluginId, temporaryRoot)); }
      catch (error) {
        results.push({pluginId, version: "", status: "failed", integrity: "failed", detail: error instanceof Error ? error.message : String(error)});
      }
    }
  } finally {
    rmSync(temporaryRoot, {recursive: true, force: true});
  }
  for (const result of results) console.log(JSON.stringify(result));
  const passed = results.length === selectedIds.length && results.every((result) => result.status === "passed");
  console.log(`RUST WEBVIEW PLUGIN FEASIBILITY: ${passed ? "passed" : "failed"}; ${results.filter((result) => result.status === "passed").length}/${results.length} unchanged artifacts; certification remains feasibility-only`);
  return passed ? 0 : 1;
}

if (import.meta.main) process.exit(await main());
