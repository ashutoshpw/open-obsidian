import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";

type PrimaryReference = {
  id: string;
  url: string;
  status: number;
  content_type: string;
  bytes: number;
  sha256: string;
  immutable_version?: string;
  source_commit?: string;
};

type PrimaryReferenceDocument = {schema_version: number; references: PrimaryReference[]};
type Fetcher = (url: string) => Promise<Response>;
type ReferenceCheck = {id: string; ok: boolean; message: string};

const root = resolve(import.meta.dir, "..");
const recordPath = join(root, "config/primary-references.json");

export function readPrimaryReferenceRecord(): PrimaryReferenceDocument {
  return JSON.parse(readFileSync(recordPath, "utf8")) as PrimaryReferenceDocument;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function validateReferenceIdentity(reference: PrimaryReference, ids: Set<string>): string[] {
  const errors: string[] = [];
  const label = reference.id || "(unknown)";
  if (!reference.id || ids.has(reference.id)) errors.push(`primary reference id is missing or duplicated: ${label}`);
  ids.add(reference.id);
  return errors;
}

function validateReferenceTransport(reference: PrimaryReference): string[] {
  const errors: string[] = [];
  const label = reference.id || "(unknown)";
  if (!/^https:\/\//.test(reference.url)) errors.push(`${label} must use HTTPS`);
  if (reference.status !== 200) errors.push(`${label} must record HTTP 200`);
  return errors;
}

function validateReferenceContent(reference: PrimaryReference): string[] {
  const errors: string[] = [];
  const label = reference.id || "(unknown)";
  const validMetadata = reference.content_type && Number.isInteger(reference.bytes) && reference.bytes > 0 && /^[a-f0-9]{64}$/.test(reference.sha256);
  if (!validMetadata) errors.push(`${label} has invalid content metadata`);
  if (!reference.immutable_version && !reference.sha256) errors.push(`${label} needs an immutable version or content hash`);
  return errors;
}

function validateReferenceMetadata(reference: PrimaryReference): string[] {
  return [...validateReferenceTransport(reference), ...validateReferenceContent(reference)];
}

function validateReference(reference: PrimaryReference, ids: Set<string>): string[] {
  return [...validateReferenceIdentity(reference, ids), ...validateReferenceMetadata(reference)];
}

function validateRecord(document: PrimaryReferenceDocument): string[] {
  const errors: string[] = [];
  if (document.schema_version !== 1) errors.push("primary reference record schema_version must be 1");
  if (!Array.isArray(document.references) || document.references.length === 0) {
    errors.push("primary reference record must contain references");
    return errors;
  }
  const ids = new Set<string>();
  document.references.forEach((reference) => errors.push(...validateReference(reference, ids)));
  return errors;
}

async function fetchWithRetries(fetcher: Fetcher, url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetcher(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 400));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function compareResponse(reference: PrimaryReference, response: Response, bytes: Uint8Array): string[] {
  const actualType = response.headers.get("content-type")?.split(";", 1)[0] ?? "";
  const expectedType = reference.content_type.split(";", 1)[0] ?? "";
  const actualHash = sha256(bytes);
  return [
    response.status !== reference.status ? `status expected ${reference.status}, got ${response.status}` : "",
    actualType !== expectedType ? `content type expected ${expectedType}, got ${actualType || "(missing)"}` : "",
    bytes.byteLength !== reference.bytes ? `byte count expected ${reference.bytes}, got ${bytes.byteLength}` : "",
    actualHash !== reference.sha256 ? `SHA-256 expected ${reference.sha256}, got ${actualHash}` : "",
  ].filter(Boolean);
}

async function checkReference(reference: PrimaryReference, fetcher: Fetcher): Promise<ReferenceCheck> {
  try {
    const response = await fetchWithRetries(fetcher, reference.url);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const mismatches = compareResponse(reference, response, bytes);
    return {id: reference.id, ok: mismatches.length === 0, message: mismatches.join("; ") || "content and metadata match"};
  } catch (error) {
    return {id: reference.id, ok: false, message: error instanceof Error ? error.message : String(error)};
  }
}

export async function verifyPrimaryReferences(fetcher: Fetcher = (url) => fetch(url, {redirect: "follow"})): Promise<ReferenceCheck[]> {
  const document = readPrimaryReferenceRecord();
  const shapeErrors = validateRecord(document);
  if (shapeErrors.length > 0) return shapeErrors.map((message) => ({id: "record", ok: false, message}));
  return Promise.all(document.references.map((reference) => checkReference(reference, fetcher)));
}

if (import.meta.main) {
  const checks = await verifyPrimaryReferences();
  checks.forEach((check) => console.log(`${check.ok ? "PASS" : "FAIL"} ${check.id}: ${check.message}`));
  process.exit(checks.every((check) => check.ok) ? 0 : 1);
}
