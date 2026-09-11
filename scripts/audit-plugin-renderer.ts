import {createRequire} from "node:module";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {spawn} from "node:child_process";
import {join, resolve} from "node:path";
import {scanPluginBundle, type BundleMarker} from "../src/plugins/bundle-prescreen.js";
import {asArray, asRecord, type JsonRecord} from "./json.js";
import {downloadPinnedAsset, integrityFailure, mainAsset, readJson, records, string} from "./plugin-audit-helpers.js";

const root = resolve(import.meta.dir, "..");
const attempts = 3;
const downloadTimeoutMs = 45_000;
const rendererTimeoutMs = 20_000;
const workerPath = join(root, "scripts/plugin-renderer-worker.cjs");
const electronBinary = createRequire(import.meta.url)("electron") as string;
const markerCapabilities: Record<string, string> = {
  filesystem: "filesystem.direct",
  network: "network.request",
  process: "process.spawn",
  credentials: "credentials.read",
  dom: "dom.privileged",
  native: "native.abi",
  "dynamic-code": "code.dynamic",
};

export type RendererProbeStatus = "denied-security" | "renderer-loaded" | "renderer-denied" | "renderer-failed" | "not-applicable" | "integrity-failed" | "worker-error";

export type RendererBoundaryDecision = {
  status: "deny-before-renderer" | "execute-renderer";
  markers: BundleMarker[];
  deniedCapabilities: string[];
  safeAlternativesAttempted: string[];
  execution: "not-executed" | "renderer-wrapper";
};

export type RendererProbeResult = {
  artifactId: string;
  name: string;
  version: string;
  releaseUrl: string;
  status: RendererProbeStatus;
  integrity: "passed" | "failed" | "not-applicable";
  execution: RendererBoundaryDecision["execution"];
  markers: BundleMarker[];
  deniedCapabilities: string[];
  safeAlternativesAttempted: string[];
  renderer?: Record<string, unknown>;
  detail?: string;
};

type ChildOutcome = {code: number | null; stdout: string; stderr: string; timedOut: boolean; error?: string};

function markerCapability(marker: BundleMarker): string {
  return markerCapabilities[marker.id] ?? marker.capability;
}

function markerDecision(source: string): RendererBoundaryDecision {
  const scan = scanPluginBundle(source);
  const deniedCapabilities = [...new Set(scan.markers.map(markerCapability))];
  return {
    status: deniedCapabilities.length > 0 ? "deny-before-renderer" : "execute-renderer",
    markers: scan.markers,
    deniedCapabilities,
    safeAlternativesAttempted: ["mediated vault read", "preview broker", "workflow disabled"],
    execution: deniedCapabilities.length > 0 ? "not-executed" : "renderer-wrapper",
  };
}

export function analyzeRendererBoundary(source: string): RendererBoundaryDecision {
  return markerDecision(source);
}

function appendOutput(current: string, chunk: Uint8Array | string): string {
  const value = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  return `${current}${value}`.slice(0, 16_384);
}

function spawnRendererWorker(sourceFile: string): Promise<ChildOutcome> {
  const useXvfb = process.platform === "linux" && Bun.spawnSync(["sh", "-lc", "command -v xvfb-run"]).exitCode === 0;
  const command = useXvfb ? "xvfb-run" : electronBinary;
  const electronArgs = ["--disable-gpu", "--disable-software-rasterizer", workerPath, `--source-file=${sourceFile}`];
  const args = useXvfb ? ["-a", "--server-args=-screen 0 1280x720x24", electronBinary, ...electronArgs] : electronArgs;
  if (!useXvfb && process.platform === "linux" && !process.env.DISPLAY) throw new Error("Renderer preflight requires DISPLAY or xvfb-run on Linux");
  const child = spawn(command, args, {cwd: root, env: {PATH: process.env.PATH ?? "", DISPLAY: process.env.DISPLAY ?? "", NODE_NO_WARNINGS: "1"}, stdio: ["ignore", "pipe", "pipe"]});
  return new Promise((resolveOutcome) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (outcome: ChildOutcome): void => {
      if (settled) return;
      settled = true;
      resolveOutcome(outcome);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, rendererTimeoutMs);
    child.stdout.on("data", (chunk) => { stdout = appendOutput(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = appendOutput(stderr, chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({code: null, stdout, stderr, timedOut: false, error: error instanceof Error ? error.message : String(error)});
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({code, stdout, stderr, timedOut});
    });
  });
}

function rendererResult(outcome: ChildOutcome): Record<string, unknown> {
  if (outcome.error) throw new Error(outcome.error);
  if (outcome.timedOut) throw new Error(`renderer worker exceeded ${rendererTimeoutMs}ms`);
  const line = outcome.stdout.trim().split("\n").at(-1) ?? "";
  try {
    const parsed = JSON.parse(line) as unknown;
    const record = asRecord(parsed);
    if (!record) throw new Error("renderer worker emitted a non-object result");
    return record;
  } catch {
    throw new Error((outcome.stderr || outcome.stdout).trim().slice(0, 600) || `renderer worker exited with code ${String(outcome.code)}`);
  }
}

async function auditArtifact(artifact: JsonRecord, temporaryRoot: string): Promise<RendererProbeResult> {
  const artifactId = string(artifact.id);
  const name = string(artifact.name);
  const version = string(artifact.tag);
  const releaseUrl = string(artifact.release_url);
  const asset = mainAsset(artifact);
  if (!asset) return {artifactId, name, version, releaseUrl, status: "not-applicable", integrity: "not-applicable", execution: "not-executed", markers: [], deniedCapabilities: [], safeAlternativesAttempted: []};
  const bytes = await downloadPinnedAsset(string(asset.url), {attempts, timeoutMs: downloadTimeoutMs});
  if (!bytes) return {artifactId, name, version, releaseUrl, status: "integrity-failed", integrity: "failed", execution: "not-executed", markers: [], deniedCapabilities: [], safeAlternativesAttempted: [], detail: "download failed after retries"};
  const integrity = integrityFailure(asset, bytes);
  if (integrity) return {artifactId, name, version, releaseUrl, status: "integrity-failed", integrity: "failed", execution: "not-executed", markers: [], deniedCapabilities: [], safeAlternativesAttempted: [], detail: integrity};
  const source = new TextDecoder().decode(bytes);
  const decision = markerDecision(source);
  const {status: _boundaryStatus, ...boundary} = decision;
  if (decision.status === "deny-before-renderer") return {artifactId, name, version, releaseUrl, status: "denied-security", integrity: "passed", ...boundary};
  const sourceFile = join(temporaryRoot, `${artifactId}.main.js`);
  writeFileSync(sourceFile, source, "utf8");
  try {
    const result = rendererResult(await spawnRendererWorker(sourceFile));
    const status = result.status === "loaded" ? "renderer-loaded" : result.status === "denied" ? "renderer-denied" : "renderer-failed";
    return {artifactId, name, version, releaseUrl, status, integrity: "passed", ...boundary, renderer: result};
  } catch (error) {
    return {artifactId, name, version, releaseUrl, status: "worker-error", integrity: "passed", ...boundary, detail: error instanceof Error ? error.message : String(error)};
  }
}

function selectedIds(manifest: JsonRecord, fixture: JsonRecord): string[] {
  if (process.argv.includes("--all")) return records(manifest.artifacts).map((artifact) => string(artifact.id)).filter(Boolean);
  return asArray(fixture.target_ids).map(string).filter(Boolean);
}

function missingArtifactResult(id: string): RendererProbeResult {
  return {artifactId: id, name: "", version: "", releaseUrl: "", status: "integrity-failed", integrity: "failed", execution: "not-executed", markers: [], deniedCapabilities: [], safeAlternativesAttempted: [], detail: "artifact is missing from compatibility manifest"};
}

async function auditTarget(id: string, byId: Map<string, JsonRecord>, temporaryRoot: string): Promise<RendererProbeResult> {
  const artifact = byId.get(id);
  return artifact ? auditArtifact(artifact, temporaryRoot) : missingArtifactResult(id);
}

async function auditTargets(ids: string[], byId: Map<string, JsonRecord>, temporaryRoot: string): Promise<RendererProbeResult[]> {
  return Promise.all(ids.map((id) => auditTarget(id, byId, temporaryRoot)));
}

function rendererFixtureResult(safeRenderer: Record<string, unknown>): RendererProbeResult {
  const status = safeRenderer.status === "loaded" ? "renderer-loaded" : safeRenderer.status === "denied" ? "renderer-denied" : "renderer-failed";
  return {
    artifactId: "fixture:renderer-mediated-source",
    name: "Mediated renderer fixture",
    version: "1",
    releaseUrl: "",
    status,
    integrity: "passed",
    execution: "renderer-wrapper",
    markers: [],
    deniedCapabilities: Array.isArray(safeRenderer.deniedCapabilities) ? safeRenderer.deniedCapabilities.filter((value): value is string => typeof value === "string") : [],
    safeAlternativesAttempted: [],
    renderer: safeRenderer,
  };
}

async function collectResults(manifest: JsonRecord, fixture: JsonRecord): Promise<RendererProbeResult[]> {
  const byId = new Map(records(manifest.artifacts).map((artifact) => [string(artifact.id), artifact]));
  const ids = selectedIds(manifest, fixture);
  const temporaryRoot = mkdtempSync(join("/tmp", "openobsidian-renderer-probe-"));
  try {
    const safeSourceFile = join(temporaryRoot, "mediated-fixture.main.js");
    writeFileSync(safeSourceFile, "module.exports = {name: 'mediated-fixture'};", "utf8");
    const safeRenderer = rendererResult(await spawnRendererWorker(safeSourceFile));
    return [rendererFixtureResult(safeRenderer), ...await auditTargets(ids, byId, temporaryRoot)];
  } finally {
    rmSync(temporaryRoot, {recursive: true, force: true});
  }
}

function countStatuses(results: RendererProbeResult[], statuses: RendererProbeStatus[]): number {
  const expected = new Set(statuses);
  return results.filter((result) => expected.has(result.status)).length;
}

function summarizeResults(results: RendererProbeResult[]): {passed: boolean; denied: number; loaded: number; failed: number; notApplicable: number} {
  const infrastructureFailures = countStatuses(results, ["integrity-failed", "worker-error"]);
  const rendererWrapperFailed = results[0]?.status !== "renderer-loaded";
  return {
    passed: infrastructureFailures === 0 && !rendererWrapperFailed,
    denied: countStatuses(results, ["denied-security", "renderer-denied"]),
    loaded: countStatuses(results, ["renderer-loaded"]),
    failed: countStatuses(results, ["renderer-failed"]),
    notApplicable: countStatuses(results, ["not-applicable"]),
  };
}

async function main(): Promise<number> {
  const manifest = readJson(root, "fixtures/compatibility-manifest.json");
  const fixture = readJson(root, "fixtures/plugin-renderer-probe.json");
  const results = await collectResults(manifest, fixture);
  results.forEach((result) => console.log(JSON.stringify(result)));
  const summary = summarizeResults(results);
  console.log(`PLUGIN RENDERER PREFLIGHT: ${summary.passed ? "passed" : "failed"}; ${summary.denied} denied, ${summary.loaded} loaded, ${summary.failed} ordinary renderer failures, ${summary.notApplicable} not-applicable; lifecycle and runtime dispositions remain pending-runtime`);
  return summary.passed ? 0 : 1;
}

if (import.meta.main) process.exit(await main());
