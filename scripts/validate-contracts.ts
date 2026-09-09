import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { asArray, asRecord, asString, type JsonRecord } from "./json.js";

const root = resolve(import.meta.dir, "..");
const failures: string[] = [];
const warnings: string[] = [];

function readJson(relativePath: string): JsonRecord {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8")) as JsonRecord;
}

const record = asRecord;
const array = asArray;
const string = asString;

function fail(message: string): void {
  failures.push(message);
}

function warn(message: string): void {
  warnings.push(message);
}

function requireNonEmpty(value: unknown, message: string): void {
  if (!string(value).trim()) fail(message);
}

function expectedArtifactIds(): string[] {
  return [...Array.from({length: 25}, (_, index) => `PC${String(index + 1).padStart(2, "0")}`), "PC-DEP-MINIMAL", "PC-DEP-TEXT-EXTRACTOR"];
}

function validateArtifactIds(artifacts: JsonRecord[]): void {
  const expected = expectedArtifactIds();
  const actual = artifacts.map((artifact) => string(artifact.id));
  if (artifacts.length !== expected.length) fail(`compatibility manifest must contain ${expected.length} artifacts, found ${artifacts.length}`);
  expected.filter((id) => !actual.includes(id)).forEach((id) => fail(`compatibility manifest is missing ${id}`));
  actual.filter((id) => !expected.includes(id)).forEach((id) => fail(`compatibility manifest contains unknown ${id}`));
  const ranks = artifacts.filter((artifact) => artifact.rank !== null).map((artifact) => Number(artifact.rank)).sort((left, right) => left - right);
  const expectedRanks = Array.from({length: 25}, (_, index) => index + 1);
  if (JSON.stringify(ranks) !== JSON.stringify(expectedRanks)) fail("compatibility manifest ranks must be exactly 1 through 25");
}

function validateAssetUrl(id: string, tag: string, asset: JsonRecord): void {
  const name = string(asset.name) || "(unknown asset)";
  const url = string(asset.url);
  if (url.includes("/HEAD/") || !url.includes(`/releases/download/${tag}/`)) fail(`${id}/${name} is not pinned to tag ${tag}`);
}

function validateAssetHash(id: string, asset: JsonRecord): void {
  const name = string(asset.name) || "(unknown asset)";
  if (!/^([a-f0-9]{64})$/.test(string(asset.sha256))) fail(`${id}/${name} must have a 64-character SHA-256 hash`);
}

function validateAssetSize(id: string, asset: JsonRecord): void {
  const name = string(asset.name) || "(unknown asset)";
  if (typeof asset.bytes !== "number" || asset.bytes <= 0) fail(`${id}/${name} must have a positive byte count`);
}

function validateAsset(id: string, tag: string, asset: JsonRecord): void {
  validateAssetUrl(id, tag, asset);
  validateAssetHash(id, asset);
  validateAssetSize(id, asset);
}

function artifactAssets(id: string, artifact: JsonRecord): JsonRecord[] {
  const assets = array(artifact.release_assets).map(record).filter((value): value is JsonRecord => value !== null);
  if (assets.length === 0) fail(`${id} must declare at least one release asset`);
  return assets;
}

function validateArtifactMetadataId(id: string, artifact: JsonRecord, metadata: JsonRecord): void {
  if (string(metadata.id) && metadata.id !== artifact.registry_id) warn(`${id} release manifest ID ${string(metadata.id)} differs from registry ID ${string(artifact.registry_id)}`);
}

function validateArtifactMetadata(id: string, artifact: JsonRecord, assets: JsonRecord[]): void {
  const releaseManifest = assets.find((asset) => asset.name === "manifest.json");
  const metadata = releaseManifest ? record(releaseManifest.manifest) : null;
  if (!metadata) {
    warn(`${id} has no parsed manifest metadata; verify before compatibility certification`);
    return;
  }
  validateArtifactMetadataId(id, artifact, metadata);
}

function validateArtifactRequiredAsset(id: string, assets: JsonRecord[]): void {
  const requiredAsset = id === "PC-DEP-MINIMAL" ? "theme.css" : "main.js";
  if (!assets.some((asset) => asset.name === requiredAsset)) fail(`${id} must pin ${requiredAsset}`);
}

function validateArtifact(id: string, artifact: JsonRecord): void {
  const tag = string(artifact.tag);
  requireNonEmpty(artifact.repo, `${id} must declare its source repository`);
  requireNonEmpty(tag, `${id} must declare a released tag`);
  if (tag === "HEAD" || tag.includes("/")) fail(`${id} has a non-release tag: ${tag}`);
  requireNonEmpty(artifact.release_url, `${id} must declare a release URL`);
  const assets = artifactAssets(id, artifact);
  assets.forEach((asset) => validateAsset(id, tag, asset));
  validateArtifactMetadata(id, artifact, assets);
  validateArtifactRequiredAsset(id, assets);
}

function validateManifest(): void {
  const manifest = readJson("fixtures/compatibility-manifest.json");
  const artifacts = array(manifest.artifacts).map(record).filter((value): value is JsonRecord => value !== null);
  validateArtifactIds(artifacts);
  artifacts.forEach((artifact) => validateArtifact(string(artifact.id) || "(unknown)", artifact));
}

function validateWorkflow(id: string, workflow: JsonRecord): void {
  requireNonEmpty(workflow.description, `${id} workflow must have a description`);
  if (array(workflow.expected_outputs).length === 0) fail(`${id} workflow must have expected outputs`);
}

function validateCatalogPlatforms(id: string, entry: JsonRecord): void {
  const platforms = array(entry.applicable_platforms).map(string);
  ["macOS", "Windows", "Linux"].filter((platform) => !platforms.includes(platform)).forEach((platform) => fail(`${id} is missing ${platform} applicability`));
  if (array(entry.architectures).length === 0) fail(`${id} must declare architecture targets`);
}

function validateCatalogWorkflows(id: string, entry: JsonRecord): void {
  const workflows = array(entry.workflows).map(record).filter((value): value is JsonRecord => value !== null);
  if (workflows.length === 0) fail(`${id} must declare a workflow fixture`);
  workflows.forEach((workflow) => validateWorkflow(id, workflow));
}

function validateCatalogEntry(entry: JsonRecord): void {
  const id = string(entry.id) || "(unknown)";
  validateCatalogPlatforms(id, entry);
  if (string(entry.security_policy) !== "D15: isolated preview required") fail(`${id} must carry the D15 security policy`);
  validateCatalogWorkflows(id, entry);
  if (string(entry.status) !== "planned") fail(`${id} must remain planned until runtime certification exists`);
}

function validateCatalogCombinations(catalog: JsonRecord, ids: string[]): void {
  const combinations = array(catalog.combinations).map(record).filter((value): value is JsonRecord => value !== null);
  combinations.forEach((combination) => array(combination.members).map(string).filter((id) => !ids.includes(id)).forEach((id) => fail(`plugin combination references unknown ${id}`)));
}

function validateCatalog(): void {
  const catalog = readJson("fixtures/plugin-catalog.json");
  const entries = array(catalog.entries).map(record).filter((value): value is JsonRecord => value !== null);
  const ids = entries.map((entry) => string(entry.id));
  if (ids.length !== 27) fail(`plugin catalog must contain 27 entries, found ${ids.length}`);
  if (new Set(ids).size !== ids.length) fail("plugin catalog IDs must be unique");
  entries.forEach(validateCatalogEntry);
  validateCatalogCombinations(catalog, ids);
}

function validateBaselineSurface(surface: JsonRecord): void {
  const id = string(surface.id) || "(unknown)";
  requireNonEmpty(surface.fixture, `${id} must have a baseline fixture ID`);
  requireNonEmpty(surface.reference, `${id} must have a primary reference`);
}

function validateStableBaseline(ledger: JsonRecord): void {
  if (record(ledger.stable_reference)?.version !== "1.13.7") fail("stable baseline must remain Obsidian 1.13.7");
}

function validateEarlyAccessBaseline(ledger: JsonRecord): void {
  if (record(ledger.early_access_reference)?.version !== "1.14.1") fail("early-access baseline must remain Obsidian 1.14.1");
}

function validateBaseline(): void {
  const ledger = readJson("fixtures/baseline-ledger.json");
  const expected = ["editing", "properties", "backlinks", "graph", "canvas", "bases", "search", "workspaces", "core-plugins", "community-extensions", "themes", "cli-automation", "web-capture", "sync", "publish", "mobile"];
  const surfaces = array(ledger.surfaces).map(record).filter((value): value is JsonRecord => value !== null);
  const ids = surfaces.map((surface) => string(surface.id));
  expected.filter((id) => !ids.includes(id)).forEach((id) => fail(`baseline ledger is missing ${id}`));
  surfaces.forEach(validateBaselineSurface);
  validateStableBaseline(ledger);
  validateEarlyAccessBaseline(ledger);
}

function validateEvaluationPlatforms(protocol: JsonRecord): void {
  const platforms = array(protocol.platform_matrix).map(record).filter((value): value is JsonRecord => value !== null);
  const platformIds = platforms.map((platform) => string(platform.id));
  ["macos-arm64", "macos-x64", "windows-x64", "linux-x64", "linux-arm64"].filter((id) => !platformIds.includes(id)).forEach((id) => fail(`evaluation protocol is missing ${id}`));
}

function validateEvaluationProfiles(protocol: JsonRecord): void {
  const profiles = array(protocol.synthetic_vault_profiles).map(record).filter((value): value is JsonRecord => value !== null);
  ["smoke-edge-cases", "medium-10k", "large-100k", "canvas-bases", "conflict-recovery", "ai-grounding"].filter((id) => !profiles.some((profile) => profile.id === id)).forEach((id) => fail(`evaluation protocol is missing ${id}`));
}

function validateNoOpGate(protocol: JsonRecord): void {
  if (record(protocol.quality_gates)?.no_op_fidelity !== "100% fixture files byte-identical after open/index/close") fail("evaluation protocol must freeze the no-op fidelity gate");
}

function validateAiGroundingGate(protocol: JsonRecord): void {
  if (!record(protocol.quality_gates)?.ai_grounding) fail("evaluation protocol must define AI grounding gates");
}

function validateEvaluation(): void {
  const protocol = readJson("fixtures/evaluation-protocol.json");
  validateEvaluationPlatforms(protocol);
  validateEvaluationProfiles(protocol);
  validateNoOpGate(protocol);
  validateAiGroundingGate(protocol);
}

function validateProviderFlow(): void {
  const flow = readJson("fixtures/provider-data-flow.json");
  const modes = array(flow.modes).map(record).filter((value): value is JsonRecord => value !== null);
  const ids = modes.map((mode) => string(mode.id));
  ["managed", "byok", "local"].filter((id) => !ids.includes(id)).forEach((id) => fail(`provider contract is missing ${id}`));
  if (flow.shared_invariants && record(flow.shared_invariants)?.no_silent_local_to_cloud_fallback !== true) fail("provider contract must forbid local-to-cloud fallback");
  modes.forEach((mode) => {
    const id = string(mode.id) || "(unknown)";
    ["credentials", "context", "destination", "failure", "live_status"].forEach((field) => requireNonEmpty(mode[field], `${id} provider mode is missing ${field}`));
  });
}

function validatePins(): void {
  const pins = readJson("config/dependency-pins.json");
  const entries = array(pins.pins).map(record).filter((value): value is JsonRecord => value !== null);
  ["electron", "electron-builder", "bun", "typescript", "knip", "fallow"].filter((id) => !entries.some((entry) => entry.id === id)).forEach((id) => fail(`dependency pins are missing ${id}`));
  entries.forEach((entry) => {
    const id = string(entry.id) || "(unknown)";
    requireNonEmpty(entry.version, `${id} must have a version`);
    requireNonEmpty(entry.source, `${id} must have primary source evidence`);
    if (string(entry.status).includes("pending") && id === "fallow") fail("Fallow must remain executable through bunx, not pending");
  });
  if (pins.lockfile !== "bun.lock") fail("dependency pin contract must point to bun.lock");
}

function main(): number {
  validateManifest();
  validateCatalog();
  validateBaseline();
  validateEvaluation();
  validateProviderFlow();
  validatePins();
  warnings.forEach((message) => console.warn(`CONTRACT WARNING: ${message}`));
  if (failures.length > 0) {
    failures.forEach((message) => console.error(`CONTRACT ERROR: ${message}`));
    return 1;
  }
  console.log(`CONTRACT CHECK: passed; ${27} compatibility entries, ${warnings.length} review warnings, no structural errors`);
  return 0;
}

process.exit(main());
