import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {asArray, asRecord, asString, type JsonRecord} from "./json.js";

const defaultRoot = resolve(import.meta.dir, "..");
const allowedApiStatuses = new Set(["not-established", "verified", "failing", "pending"]);
const allowedRuntimeStatuses = new Set(["pending", "passing", "failing", "unsupported-security", "external-pending"]);

type VersionPair = {product: string; version: string};
type VersionTrack = VersionPair & {releaseStatus: string};
type Verification = {status: string; evidence: string | null};
type VersionRecord = {
  artifactId: string;
  minimumAppVersion: string | null;
  minimumAppVersionSource: string;
  requiredTrack: string;
  apiVerification: Verification;
  runtimeVerification: Verification;
};
type VersionBaselineDocument = {
  schemaVersion: number;
  apiReferenceId: string;
  stableBaseline: VersionTrack;
  earlyAccessTrack: VersionTrack;
  policy: {
    minimumAppVersionIsNotApiProof: boolean;
    pluginFixtureMayAdvanceStable: boolean;
    stableAdvanceRequires: string[];
    runtimeOwner: string;
    runtimeNextStep: string;
  };
  records: VersionRecord[];
};

export type VersionBaselineCheck = {id: string; status: "passed" | "pending" | "failed"; detail: string};
export type VersionBaselineAudit = {
  checks: VersionBaselineCheck[];
  failures: string[];
  artifactCount: number;
  apiUnestablishedCount: number;
  runtimePendingCount: number;
  stableBaseline: VersionTrack;
  earlyAccessTrack: VersionTrack;
};

function readJson(rootDirectory: string, relativePath: string): JsonRecord {
  return JSON.parse(readFileSync(join(rootDirectory, relativePath), "utf8")) as JsonRecord;
}

function pair(value: unknown): VersionPair {
  const record = asRecord(value) ?? {};
  return {product: asString(record.product), version: asString(record.version)};
}

function track(value: unknown): VersionTrack {
  const record = asRecord(value) ?? {};
  return {...pair(record), releaseStatus: asString(record.release_status)};
}

function verification(value: unknown): Verification {
  const record = asRecord(value) ?? {};
  return {status: asString(record.status), evidence: typeof record.evidence === "string" ? record.evidence : null};
}

function versionRecord(value: unknown): VersionRecord {
  const record = asRecord(value) ?? {};
  return {
    artifactId: asString(record.artifact_id),
    minimumAppVersion: typeof record.minimum_app_version === "string" ? record.minimum_app_version : null,
    minimumAppVersionSource: asString(record.minimum_app_version_source),
    requiredTrack: asString(record.required_track),
    apiVerification: verification(record.api_verification),
    runtimeVerification: verification(record.runtime_verification),
  };
}

export function readVersionBaseline(rootDirectory = defaultRoot): VersionBaselineDocument {
  const raw = readJson(rootDirectory, "fixtures/version-baseline.json");
  const policy = asRecord(raw.policy) ?? {};
  return {
    schemaVersion: typeof raw.schema_version === "number" ? raw.schema_version : 0,
    apiReferenceId: asString(raw.api_reference_id),
    stableBaseline: track(raw.stable_baseline),
    earlyAccessTrack: track(raw.early_access_track),
    policy: {
      minimumAppVersionIsNotApiProof: policy.minimum_app_version_is_not_api_proof === true,
      pluginFixtureMayAdvanceStable: policy.plugin_fixture_may_advance_stable === true,
      stableAdvanceRequires: asArray(policy.stable_advance_requires).map(asString).filter(Boolean),
      runtimeOwner: asString(policy.runtime_owner),
      runtimeNextStep: asString(policy.runtime_next_step),
    },
    records: asArray(raw.records).map(versionRecord),
  };
}

function parseVersion(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length < 1 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  return [...parts.map(Number), 0, 0].slice(0, 3);
}

function compareVersions(left: string, right: string): number | null {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
  }
  return 0;
}

function manifestMinimumAppVersion(artifact: JsonRecord): {version: string | null; assetFound: boolean} {
  const manifestAsset = asArray(artifact.release_assets)
    .map(asRecord)
    .find((asset) => asset !== null && asString(asset.name) === "manifest.json");
  const manifest = asRecord(manifestAsset?.manifest);
  return {version: typeof manifest?.minAppVersion === "string" ? manifest.minAppVersion : null, assetFound: Boolean(manifestAsset)};
}

function artifactRecords(rootDirectory: string): JsonRecord[] {
  const manifest = readJson(rootDirectory, "fixtures/compatibility-manifest.json");
  return asArray(manifest.artifacts).map(asRecord).filter((artifact): artifact is JsonRecord => artifact !== null);
}

function referenceIds(rootDirectory: string): Set<string> {
  const document = readJson(rootDirectory, "config/primary-references.json");
  return new Set(asArray(document.references).map(asRecord).filter((reference): reference is JsonRecord => reference !== null).map((reference) => asString(reference.id)).filter(Boolean));
}

function protocolTrack(rootDirectory: string, id: string): VersionPair {
  const document = readJson(rootDirectory, "fixtures/evaluation-protocol.json");
  const reference = asArray(document.reference_tracks)
    .map(asRecord)
    .find((entry) => entry !== null && asString(entry.id) === id);
  return pair(reference);
}

function addCheck(result: VersionBaselineAudit, id: string, status: VersionBaselineCheck["status"], detail: string): void {
  result.checks.push({id, status, detail});
}

function fail(result: VersionBaselineAudit, message: string): void {
  result.failures.push(message);
}

function comparePair(result: VersionBaselineAudit, id: string, expected: VersionPair, actual: VersionPair): void {
  if (expected.product !== actual.product || expected.version !== actual.version) {
    fail(result, `${id} expected ${expected.product} ${expected.version}, got ${actual.product || "(missing)"} ${actual.version || "(missing)"}`);
    return;
  }
  addCheck(result, id, "passed", `${actual.product} ${actual.version}`);
}

function expectedTrack(minimumAppVersion: string | null, stable: string, earlyAccess: string): string {
  if (!minimumAppVersion) return "undetermined";
  const stableComparison = compareVersions(minimumAppVersion, stable);
  const earlyComparison = compareVersions(minimumAppVersion, earlyAccess);
  if (stableComparison !== null && stableComparison <= 0) return "stable";
  if (earlyComparison !== null && earlyComparison <= 0) return "early-access";
  return "unsupported";
}

function validatePolicy(result: VersionBaselineAudit, document: VersionBaselineDocument, references: Set<string>): void {
  const failuresBefore = result.failures.length;
  validatePolicyShape(result, document);
  if (!references.has(document.apiReferenceId)) fail(result, `version baseline API reference is missing: ${document.apiReferenceId || "(empty)"}`);
  else addCheck(result, "api-reference", "passed", `${document.apiReferenceId} is recorded in primary references`);
  if (result.failures.length === failuresBefore) addCheck(result, "baseline-policy", "passed", "stable advancement is gated by reference, API and runtime evidence");
}

function validatePolicyShape(result: VersionBaselineAudit, document: VersionBaselineDocument): void {
  if (document.schemaVersion !== 1) fail(result, "version baseline schema_version must be 1");
  if (!document.policy.minimumAppVersionIsNotApiProof) fail(result, "version baseline must state that minimum app versions are not API proof");
  if (document.policy.pluginFixtureMayAdvanceStable) fail(result, "plugin fixtures must not advance the stable baseline");
  if (document.policy.stableAdvanceRequires.length < 3) fail(result, "stable baseline advancement needs immutable, API and runtime evidence requirements");
  if (!document.policy.runtimeOwner || !document.policy.runtimeNextStep) fail(result, "runtime verification owner and next step must be recorded");
}

function validateArtifactPin(result: VersionBaselineAudit, artifact: JsonRecord): void {
  const id = asString(artifact.id) || "(unknown artifact)";
  const tag = asString(artifact.tag);
  const releaseUrl = asString(artifact.release_url);
  const assets = asArray(artifact.release_assets).map(asRecord).filter((asset): asset is JsonRecord => asset !== null);
  if (!tag || !releaseUrl || releaseUrl.includes("/HEAD/") || assets.length === 0) fail(result, `${id} must retain a tagged release URL and release assets`);
  if (assets.some((asset) => !asString(asset.url) || asString(asset.url).includes("/HEAD/"))) fail(result, `${id} contains an unpinned release asset URL`);
}

function validateRecord(result: VersionBaselineAudit, record: VersionRecord, artifact: JsonRecord, document: VersionBaselineDocument): void {
  const id = asString(artifact.id) || "(unknown artifact)";
  const manifest = manifestMinimumAppVersion(artifact);
  validateMinimumVersion(result, record, manifest, id);
  validateTrack(result, record, manifest.version, document, id);
  validateApiVerification(result, record, id);
  validateRuntimeVerification(result, record, id);
  countVerification(result, record);
}

function validateMinimumVersion(result: VersionBaselineAudit, record: VersionRecord, manifest: {version: string | null; assetFound: boolean}, id: string): void {
  if (!manifest.assetFound) fail(result, `${id} is missing its release manifest asset`);
  if (record.minimumAppVersion !== manifest.version) fail(result, `${id} minimum app version differs from its recorded release manifest`);
  const expectedSource = manifest.version ? "release-manifest" : "manifest-not-declared";
  if (record.minimumAppVersionSource !== expectedSource) fail(result, `${id} has invalid minimum app version source ${record.minimumAppVersionSource || "(empty)"}`);
}

function validateTrack(result: VersionBaselineAudit, record: VersionRecord, minimumAppVersion: string | null, document: VersionBaselineDocument, id: string): void {
  const expected = expectedTrack(minimumAppVersion, document.stableBaseline.version, document.earlyAccessTrack.version);
  if (record.requiredTrack !== expected) fail(result, `${id} requires ${expected} from its minimum app version, recorded ${record.requiredTrack || "(empty)"}`);
}

function validateApiVerification(result: VersionBaselineAudit, record: VersionRecord, id: string): void {
  if (!allowedApiStatuses.has(record.apiVerification.status) || !record.apiVerification.evidence) fail(result, `${id} must record API verification status and evidence`);
}

function validateRuntimeVerification(result: VersionBaselineAudit, record: VersionRecord, id: string): void {
  if (!allowedRuntimeStatuses.has(record.runtimeVerification.status)) fail(result, `${id} has invalid runtime verification status ${record.runtimeVerification.status || "(empty)"}`);
  if (record.runtimeVerification.status === "passing" && !record.runtimeVerification.evidence) fail(result, `${id} cannot be runtime-passing without evidence`);
}

function countVerification(result: VersionBaselineAudit, record: VersionRecord): void {
  if (record.apiVerification.status !== "verified") result.apiUnestablishedCount += 1;
  if (record.runtimeVerification.status === "pending") result.runtimePendingCount += 1;
}

function collectArtifactIds(result: VersionBaselineAudit, artifacts: JsonRecord[]): Set<string> {
  const artifactIds = new Set<string>();
  for (const artifact of artifacts) {
    const id = asString(artifact.id);
    if (!id || artifactIds.has(id)) fail(result, `compatibility manifest has duplicate or empty artifact id: ${id || "(empty)"}`);
    artifactIds.add(id);
    validateArtifactPin(result, artifact);
  }
  return artifactIds;
}

function collectVersionRecords(result: VersionBaselineAudit, records: VersionRecord[]): Map<string, VersionRecord> {
  const recordMap = new Map<string, VersionRecord>();
  for (const record of records) {
    if (!record.artifactId || recordMap.has(record.artifactId)) fail(result, `version baseline has duplicate or empty artifact id: ${record.artifactId || "(empty)"}`);
    recordMap.set(record.artifactId, record);
  }
  return recordMap;
}

function validateRecordCoverage(result: VersionBaselineAudit, document: VersionBaselineDocument, artifacts: JsonRecord[], records: Map<string, VersionRecord>): void {
  for (const artifact of artifacts) {
    const id = asString(artifact.id);
    const record = records.get(id);
    if (!record) fail(result, `${id} is missing a version-baseline record`);
    else validateRecord(result, record, artifact, document);
  }
}

function validateExtraRecords(result: VersionBaselineAudit, artifactIds: Set<string>, records: Map<string, VersionRecord>): void {
  for (const id of records.keys()) if (!artifactIds.has(id)) fail(result, `${id} is not present in the compatibility manifest`);
}

function validateRecords(result: VersionBaselineAudit, document: VersionBaselineDocument, artifacts: JsonRecord[]): void {
  const artifactIds = collectArtifactIds(result, artifacts);
  const records = collectVersionRecords(result, document.records);
  validateRecordCoverage(result, document, artifacts, records);
  validateExtraRecords(result, artifactIds, records);
  result.artifactCount = artifacts.length;
  if (result.failures.length === 0) addCheck(result, "artifact-records", "passed", `${artifacts.length} pinned artifacts have minimum-version, API and runtime records`);
}

export function auditVersionBaseline(rootDirectory = defaultRoot): VersionBaselineAudit {
  const document = readVersionBaseline(rootDirectory);
  const launch = readJson(rootDirectory, "config/launch-contract.json");
  const ledger = readJson(rootDirectory, "fixtures/baseline-ledger.json");
  const release = asRecord(launch.release) ?? {};
  const stable = asRecord(release.stable_reference);
  const earlyAccess = asRecord(release.early_access_reference);
  const result: VersionBaselineAudit = {
    checks: [],
    failures: [],
    artifactCount: 0,
    apiUnestablishedCount: 0,
    runtimePendingCount: 0,
    stableBaseline: document.stableBaseline,
    earlyAccessTrack: document.earlyAccessTrack,
  };
  comparePair(result, "launch-stable", pair(stable), document.stableBaseline);
  comparePair(result, "ledger-stable", pair(ledger.stable_reference), document.stableBaseline);
  comparePair(result, "protocol-stable", protocolTrack(rootDirectory, "obsidian-stable"), document.stableBaseline);
  comparePair(result, "launch-early-access", pair(earlyAccess), document.earlyAccessTrack);
  comparePair(result, "ledger-early-access", pair(ledger.early_access_reference), document.earlyAccessTrack);
  comparePair(result, "protocol-early-access", protocolTrack(rootDirectory, "obsidian-early-access"), document.earlyAccessTrack);
  validatePolicy(result, document, referenceIds(rootDirectory));
  validateRecords(result, document, artifactRecords(rootDirectory));
  if (result.failures.length === 0) addCheck(result, "stable-baseline-guard", "passed", "plugin fixtures cannot move the public stable baseline");
  if (result.runtimePendingCount > 0) addCheck(result, "runtime-certification", "pending", `${result.runtimePendingCount} artifact runtime checks remain for P1.2`);
  else addCheck(result, "runtime-certification", "passed", "all artifact runtime checks are recorded");
  return result;
}

if (import.meta.main) {
  try {
    const result = auditVersionBaseline();
    result.checks.forEach((check) => console.log(`${check.status.toUpperCase()} ${check.id}: ${check.detail}`));
    result.failures.forEach((failure) => console.error(`VERSION BASELINE ERROR: ${failure}`));
    if (result.failures.length > 0) process.exit(1);
    console.log(`VERSION BASELINE CHECK: structural policy passed; ${result.artifactCount} pinned artifacts covered, runtime certification pending for ${result.runtimePendingCount}`);
  } catch (error) {
    console.error(`VERSION BASELINE ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
