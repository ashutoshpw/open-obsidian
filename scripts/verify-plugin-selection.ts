import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { asArray, asRecord, asString, type JsonRecord } from "./json.js";

const root = resolve(import.meta.dir, "..");
const failures: string[] = [];
const statsUrl = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json";
const registryUrl = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json";

function sha256(bytes: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function readManifest(): JsonRecord {
  return JSON.parse(readFileSync(join(root, "fixtures/compatibility-manifest.json"), "utf8")) as JsonRecord;
}

function downloadedCount(value: unknown): number {
  return asRecord(value)?.downloads as number ?? 0;
}

function expectedArtifacts(manifest: JsonRecord): JsonRecord[] {
  return asArray(manifest.artifacts)
    .map(asRecord)
    .filter((artifact): artifact is JsonRecord => artifact !== null && artifact.rank !== null)
    .sort((left, right) => Number(left.rank) - Number(right.rank));
}

function compareSourceHash(name: string, actual: string, source: JsonRecord): void {
  const expected = asRecord(source[name])?.sha256;
  if (actual !== expected) failures.push(`${name} snapshot hash changed: expected ${String(expected)}, got ${actual}`);
}

function compareExpectedDownloads(artifacts: JsonRecord[], stats: JsonRecord): void {
  for (const artifact of artifacts) {
    const id = asString(artifact.registry_id);
    const expected = Number(artifact.downloads);
    const actual = downloadedCount(stats[id]);
    if (actual !== expected) failures.push(`${id} download snapshot changed: expected ${expected}, got ${actual}`);
  }
}

function compareRegistryRows(artifacts: JsonRecord[], registry: JsonRecord[]): void {
  const registryMap = new Map(registry.map((entry) => [asString(entry.id), entry]));
  for (const artifact of artifacts) {
    const id = asString(artifact.registry_id);
    const entry = registryMap.get(id);
    if (!entry) failures.push(`${id} is absent from the official community registry`);
    else if (asString(entry.repo).toLowerCase() !== asString(artifact.repo).toLowerCase()) failures.push(`${id} repository changed in the official registry`);
  }
}

function compareRanking(artifacts: JsonRecord[], stats: JsonRecord, registry: JsonRecord[]): void {
  const registered = new Set(registry.map((entry) => asString(entry.id)));
  const ranked = Object.entries(stats)
    .filter(([id, value]) => registered.has(id) && downloadedCount(value) > 0)
    .sort(([, left], [, right]) => downloadedCount(right) - downloadedCount(left))
    .slice(0, 25)
    .map(([id]) => id);
  const expected = artifacts.map((artifact) => asString(artifact.registry_id));
  if (JSON.stringify(ranked) !== JSON.stringify(expected)) failures.push(`top-25 ranking changed: expected ${expected.join(",")}, got ${ranked.join(",")}`);
}

async function fetchSnapshot(url: string): Promise<{bytes: ArrayBuffer; json: JsonRecord | JsonRecord[]}> {
  const response = await fetch(url, {signal: AbortSignal.timeout(30_000)});
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  return {bytes, json: JSON.parse(Buffer.from(bytes).toString()) as JsonRecord | JsonRecord[]};
}

async function main(): Promise<number> {
  const manifest = readManifest();
  const source = asRecord(manifest.selection_sources);
  const [statsSnapshot, registrySnapshot] = await Promise.all([fetchSnapshot(statsUrl), fetchSnapshot(registryUrl)]);
  const stats = asRecord(statsSnapshot.json) ?? {};
  const registry = asArray(registrySnapshot.json).map(asRecord).filter((entry): entry is JsonRecord => entry !== null);
  if (source) {
    compareSourceHash("stats", sha256(statsSnapshot.bytes), source);
    compareSourceHash("registry", sha256(registrySnapshot.bytes), source);
  } else {
    failures.push("manifest is missing selection_sources");
  }
  const artifacts = expectedArtifacts(manifest);
  compareExpectedDownloads(artifacts, stats);
  compareRegistryRows(artifacts, registry);
  compareRanking(artifacts, stats, registry);
  if (failures.length > 0) {
    failures.forEach((failure) => console.error(`SELECTION ERROR: ${failure}`));
    return 1;
  }
  console.log(`SELECTION CHECK: passed; official registry/stat hashes and ranked ${artifacts.length} targets match the frozen snapshot`);
  return 0;
}

if (import.meta.main) process.exit(await main());
