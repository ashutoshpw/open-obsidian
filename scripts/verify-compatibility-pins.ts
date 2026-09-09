import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { asArray, asRecord, asString, type JsonRecord } from "./json.js";

const root = resolve(import.meta.dir, "..");
const failures: string[] = [];
const DOWNLOAD_CONCURRENCY = 4;
const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_TIMEOUT_MS = 45_000;

const array = asArray;
const record = asRecord;
const string = asString;

function sha256(bytes: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

type DownloadAttempt = {bytes: ArrayBuffer | null; retry: boolean; error: string};
type DownloadResult = DownloadAttempt & {attempts: number};

async function downloadAttempt(url: string): Promise<DownloadAttempt> {
  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)});
    if (response.ok) return {bytes: await response.arrayBuffer(), retry: false, error: ""};
    const error = `HTTP ${response.status}`;
    return {bytes: null, retry: shouldRetryStatus(response.status), error};
  } catch (error) {
    return {bytes: null, retry: true, error: errorMessage(error)};
  }
}

function shouldRetryAttempt(result: DownloadAttempt, attempt: number): boolean {
  return result.retry && attempt < DOWNLOAD_ATTEMPTS;
}

async function downloadWithRetries(url: string, attempt = 1): Promise<DownloadResult> {
  const result = await downloadAttempt(url);
  if (!shouldRetryAttempt(result, attempt)) return {...result, attempts: attempt};
  return downloadWithRetries(url, attempt + 1);
}

async function downloadAsset(artifactId: string, asset: JsonRecord): Promise<ArrayBuffer | null> {
  const name = string(asset.name) || "(unknown asset)";
  const url = string(asset.url);
  const result = await downloadWithRetries(url);
  if (result.bytes) return result.bytes;
  failures.push(`${artifactId}/${name} download failed after ${result.attempts} attempts: ${result.error}`);
  return null;
}

function checkAssetHash(artifactId: string, asset: JsonRecord, bytes: ArrayBuffer): void {
  const name = string(asset.name) || "(unknown asset)";
  const expectedHash = string(asset.sha256);
  const actualHash = sha256(bytes);
  if (actualHash !== expectedHash) failures.push(`${artifactId}/${name} hash changed: expected ${expectedHash}, got ${actualHash}`);
}

function checkAssetSize(artifactId: string, asset: JsonRecord, bytes: ArrayBuffer): void {
  const name = string(asset.name) || "(unknown asset)";
  if (bytes.byteLength !== asset.bytes) failures.push(`${artifactId}/${name} size changed: expected ${String(asset.bytes)}, got ${bytes.byteLength}`);
}

type AssetCheck = {artifactId: string; asset: JsonRecord};

async function verifyAsset(artifactId: string, asset: JsonRecord): Promise<void> {
  const bytes = await downloadAsset(artifactId, asset);
  if (!bytes) return;
  checkAssetHash(artifactId, asset, bytes);
  checkAssetSize(artifactId, asset, bytes);
}

function checkAssetUrl(artifactId: string, asset: JsonRecord): void {
  if (string(asset.url).includes("/HEAD/")) failures.push(`${artifactId} contains an unpinned HEAD asset URL`);
}

function checkAssetHashShape(artifactId: string, asset: JsonRecord): boolean {
  const valid = /^[a-f0-9]{64}$/.test(string(asset.sha256));
  if (!valid) failures.push(`${artifactId} contains an invalid SHA-256 asset hash`);
  return valid;
}

function checkAssetSizeShape(artifactId: string, asset: JsonRecord): boolean {
  const valid = typeof asset.bytes === "number" && asset.bytes > 0;
  if (!valid) failures.push(`${artifactId} contains an invalid asset size`);
  return valid;
}

function readManifest(): JsonRecord[] {
  const document = JSON.parse(readFileSync(join(root, "fixtures/compatibility-manifest.json"), "utf8")) as JsonRecord;
  return array(document.artifacts).map(record).filter((value): value is JsonRecord => value !== null);
}

function validatePinShape(artifactId: string, asset: JsonRecord): boolean {
  checkAssetUrl(artifactId, asset);
  return checkAssetHashShape(artifactId, asset) && checkAssetSizeShape(artifactId, asset) && !string(asset.url).includes("/HEAD/");
}

function checksForArtifact(artifact: JsonRecord): AssetCheck[] {
  const id = string(artifact.id) || "(unknown artifact)";
  return array(artifact.release_assets)
    .map(record)
    .filter((asset): asset is JsonRecord => asset !== null)
    .filter((asset) => validatePinShape(id, asset))
    .map((asset) => ({artifactId: id, asset}));
}

function collectAssetChecks(artifacts: JsonRecord[]): AssetCheck[] {
  return artifacts.flatMap(checksForArtifact);
}

async function verifyAssets(checks: AssetCheck[]): Promise<void> {
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < checks.length) {
      const check = checks[nextIndex];
      nextIndex += 1;
      if (check) await verifyAsset(check.artifactId, check.asset);
    }
  }

  const workerCount = Math.min(DOWNLOAD_CONCURRENCY, checks.length);
  await Promise.all(Array.from({length: workerCount}, () => worker()));
}

async function main(): Promise<number> {
  const artifacts = readManifest();
  const checks = collectAssetChecks(artifacts);
  await verifyAssets(checks);
  if (failures.length > 0) {
    failures.forEach((failure) => console.error(`PIN ERROR: ${failure}`));
    return 1;
  }
  console.log(`PIN CHECK: passed; ${artifacts.length} artifacts and ${checks.length} release assets match recorded SHA-256 and byte counts`);
  return 0;
}

process.exit(await main());
