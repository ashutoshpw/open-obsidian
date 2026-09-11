import {resolve} from "node:path";
import {scanPluginBundle, type BundlePrescreen} from "../src/plugins/bundle-prescreen.js";
import {probePluginBundle, type RuntimeProbeResult} from "../src/plugins/runtime-probe.js";
import {asArray, asRecord, type JsonRecord} from "./json.js";
import {downloadPinnedAsset, integrityFailure, mainAsset, readJson, records, string} from "./plugin-audit-helpers.js";

const root = resolve(import.meta.dir, "..");
const attempts = 3;
const timeoutMs = 45_000;
const auditConcurrency = 4;

type BundleAudit = {
  artifactId: string;
  tag: string;
  status: "static-prescreened" | "not-applicable" | "failed";
  integrity: "passed" | "failed" | "not-applicable";
  runtime: "pending-runtime";
  markers: BundlePrescreen["markers"];
  sandboxProbe?: RuntimeProbeResult;
  detail?: string;
};

function selectedIds(manifest: JsonRecord, isolation: JsonRecord): string[] {
  if (process.argv.includes("--all")) return records(manifest.artifacts).map((artifact) => string(artifact.id)).filter(Boolean);
  return asArray(asRecord(isolation.feasibility)?.hardest_targets).map(string).filter(Boolean);
}

function failedAudit(artifactId: string, tag: string, detail: string): BundleAudit {
  return {artifactId, tag, status: "failed", integrity: "failed", runtime: "pending-runtime", markers: [], detail};
}

async function auditDownloadedBundle(artifact: JsonRecord, asset: JsonRecord, bytes: ArrayBuffer, runtimeProbe: boolean): Promise<BundleAudit> {
  const artifactId = string(artifact.id);
  const tag = string(artifact.tag);
  const integrity = integrityFailure(asset, bytes);
  if (integrity) return failedAudit(artifactId, tag, integrity);
  const source = new TextDecoder().decode(bytes);
  const scan = scanPluginBundle(source);
  const sandboxProbe = runtimeProbe ? await probePluginBundle(source) : undefined;
  return {artifactId, tag, status: "static-prescreened", integrity: "passed", runtime: "pending-runtime", markers: scan.markers, sandboxProbe};
}

async function auditArtifact(artifact: JsonRecord, runtimeProbe: boolean): Promise<BundleAudit> {
  const artifactId = string(artifact.id);
  const tag = string(artifact.tag);
  const asset = mainAsset(artifact);
  if (!asset) return {artifactId, tag, status: "not-applicable", integrity: "not-applicable", runtime: "pending-runtime", markers: [], detail: "no main.js release asset"};
  const bytes = await downloadPinnedAsset(string(asset.url), {attempts, timeoutMs});
  if (!bytes) return failedAudit(artifactId, tag, "download failed after retries");
  return auditDownloadedBundle(artifact, asset, bytes, runtimeProbe);
}

async function auditWithConcurrency(ids: string[], byId: Map<string, JsonRecord>, runtimeProbe: boolean): Promise<BundleAudit[]> {
  const results = new Array<BundleAudit>(ids.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= ids.length) return;
      const id = ids[index];
      const artifact = byId.get(id);
      results[index] = artifact
        ? await auditArtifact(artifact, runtimeProbe)
        : {artifactId: id, tag: "", status: "failed", integrity: "failed", runtime: "pending-runtime", markers: [], detail: "artifact is missing from compatibility manifest"};
    }
  }
  await Promise.all(Array.from({length: Math.min(auditConcurrency, ids.length)}, () => worker()));
  return results;
}

async function main(): Promise<number> {
  const manifest = readJson(root, "fixtures/compatibility-manifest.json");
  const isolation = readJson(root, "fixtures/plugin-isolation.json");
  const byId = new Map(records(manifest.artifacts).map((artifact) => [string(artifact.id), artifact]));
  const ids = selectedIds(manifest, isolation);
  const runtimeProbe = process.argv.includes("--runtime-probe");
  const audits = await auditWithConcurrency(ids, byId, runtimeProbe);
  const failures = audits.filter((audit) => audit.status === "failed");
  audits.forEach((audit) => console.log(JSON.stringify(audit)));
  if (failures.length > 0) {
    console.error(`PLUGIN BUNDLE AUDIT: failed; ${failures.length} pinned bundle checks failed`);
    return 1;
  }
  const prescreened = audits.filter((audit) => audit.status === "static-prescreened").length;
  const probeSummary = runtimeProbe ? `; sandbox module probes: ${audits.filter((audit) => audit.sandboxProbe?.status === "loaded").length} loaded, ${audits.filter((audit) => audit.sandboxProbe?.status === "denied").length} denied, ${audits.filter((audit) => audit.sandboxProbe?.status === "failed").length} failed, ${audits.filter((audit) => audit.sandboxProbe?.status === "timed-out").length} timed out` : "";
  console.log(`PLUGIN BUNDLE AUDIT: passed; ${prescreened} pinned main.js bundles statically prescreened${probeSummary}; all runtime dispositions remain pending-runtime`);
  return 0;
}

if (import.meta.main) process.exit(await main());
