import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {asArray, asRecord, asString, type JsonRecord} from "./json.js";

export type DownloadOptions = {
  attempts?: number;
  timeoutMs?: number;
};

export function readJson(root: string, relativePath: string): JsonRecord {
  const parsed = JSON.parse(readFileSync(join(root, relativePath), "utf8")) as unknown;
  const value = asRecord(parsed);
  if (!value) throw new Error(`${relativePath} must contain a JSON object`);
  return value;
}

export function records(value: unknown): JsonRecord[] {
  return asArray(value).map(asRecord).filter((item): item is JsonRecord => item !== null);
}

export function string(value: unknown): string {
  return asString(value);
}

export function mainAsset(artifact: JsonRecord): JsonRecord | null {
  return records(artifact.release_assets).find((asset) => string(asset.name) === "main.js") ?? null;
}

function sha256(bytes: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

export function integrityFailure(asset: JsonRecord, bytes: ArrayBuffer): string | null {
  const expectedBytes = asset.bytes;
  const expectedHash = string(asset.sha256);
  if (typeof expectedBytes !== "number" || bytes.byteLength !== expectedBytes) return `size expected ${String(expectedBytes)}, got ${bytes.byteLength}`;
  const actualHash = sha256(bytes);
  return actualHash === expectedHash ? null : `hash expected ${expectedHash}, got ${actualHash}`;
}

function retryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

type DownloadAttempt = {bytes: ArrayBuffer | null; retry: boolean};

async function downloadAttempt(url: string, timeoutMs: number): Promise<DownloadAttempt> {
  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(timeoutMs)});
    return response.ok ? {bytes: await response.arrayBuffer(), retry: false} : {bytes: null, retry: retryableStatus(response.status)};
  } catch {
    return {bytes: null, retry: true};
  }
}

export async function downloadPinnedAsset(url: string, options: DownloadOptions = {}): Promise<ArrayBuffer | null> {
  const attempts = options.attempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 45_000;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await downloadAttempt(url, timeoutMs);
    if (result.bytes) return result.bytes;
    if (!result.retry || attempt === attempts) return null;
    await new Promise((resolveRetry) => setTimeout(resolveRetry, 500 * attempt));
  }
  return null;
}
