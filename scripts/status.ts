import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;
type ErrorList = string[];
type Reporter = (message: string) => void;

const root = resolve(import.meta.dir, "..");
const taskRoot = join(root, ".agents/tasks/2026-09-09/01-init");
const referencesRoot = join(taskRoot, "references");
const checkpointIds = [
  "P0.1", "P0.2", "P1.1", "P1.2", "P1.3", "P2.1", "P2.2", "P2.3",
  "P3.1", "P3.2", "P3.3", "P4.1", "P4.2", "P4.3", "P5.1", "P5.2",
  "P6.1", "P6.2", "P7.1",
];
const requiredFiles = [
  join(taskRoot, "state.json"),
  join(taskRoot, "requirements.json"),
  join(taskRoot, "journal.md"),
  join(taskRoot, "release-handoff.md"),
];
const validRequirementStatuses = new Set([
  "pending", "implemented", "passing", "failing", "blocked", "unsupported_security", "external_pending",
]);
const rowFields = [
  "id", "source", "checkpoint", "owner", "mandatory", "acceptance_criteria", "fixture_ids",
  "reference_versions", "applicable_platforms", "status", "evidence_paths", "tested_source_tree",
  "blocker", "gate_class", "decision_id",
];

function readJson(path: string): JsonRecord {
  return JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function relativePath(path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}

function git(args: string[]): string {
  return Bun.spawnSync(["git", "-C", root, ...args]).stdout.toString().trim();
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function specPaths(): string[] {
  const modules = readdirSync(referencesRoot)
    .filter((name) => statSync(join(referencesRoot, name)).isDirectory())
    .map((name) => `.agents/tasks/2026-09-09/01-init/references/${name}/index.md`)
    .sort();
  return [".agents/tasks/2026-09-09/01-init/plan.md", ...modules];
}

function missingKeys(record: JsonRecord | null, fields: string[]): string[] {
  return fields.filter((field) => !record || !(field in record));
}

function addChecks(checks: Array<[boolean, string]>, errors: ErrorList): void {
  errors.push(...checks.filter(([failed]) => failed).map(([, message]) => message));
}

function reportMissingArtifacts(errors: ErrorList): boolean {
  errors.push(...requiredFiles.filter((path) => !existsSync(path)).map((path) => `missing required progress artifact: ${relativePath(path)}`));
  const evidenceDir = join(taskRoot, "evidence");
  addChecks([[!existsSync(evidenceDir) || !statSync(evidenceDir).isDirectory(), "missing required evidence directory: .agents/tasks/2026-09-09/01-init/evidence"]], errors);
  return errors.length === 0;
}

function validateStateShape(state: JsonRecord, checkpoints: JsonRecord | null, errors: ErrorList): void {
  addChecks([
    [state.schema_version !== 1, "state.json schema_version must be 1"],
    [state.goal_id !== "openobsidian-v1", "state.json goal_id must be openobsidian-v1"],
    [state.branch !== "main", `state.json branch must be main, found ${String(state.branch)}`],
    [!checkpoints, "state.json checkpoints must be an object"],
  ], errors);
  if (!checkpoints) return;
  const actualIds = Object.keys(checkpoints);
  errors.push(...checkpointIds.filter((id) => !actualIds.includes(id)).map((id) => `state.json is missing checkpoint ${id}`));
  errors.push(...actualIds.filter((id) => !checkpointIds.includes(id)).map((id) => `state.json has unknown checkpoint ${id}`));
}

function validateSpecHashes(state: JsonRecord, paths: string[], errors: ErrorList): void {
  const hashes = asRecord(state.spec_hashes);
  if (!hashes) {
    errors.push("state.json spec_hashes must be an object");
    return;
  }
  const missing = paths.filter((path) => !existsSync(join(root, path)));
  errors.push(...missing.map((path) => `missing specification source: ${path}`));
  const stale = paths.filter((path) => existsSync(join(root, path)) && hashes[path] !== sha256(join(root, path)));
  errors.push(...stale.map((path) => `stale specification hash: ${path}`));
  errors.push(...Object.keys(hashes).filter((path) => !paths.includes(path)).map((path) => `unknown specification hash: ${path}`));
}

function validateSource(row: JsonRecord, id: string, errors: ErrorList): void {
  const source = asRecord(row.source);
  if (!source) {
    errors.push(`requirement ${id || "(unknown)"} source must contain path, heading and clause`);
    return;
  }
  errors.push(...missingKeys(source, ["path", "heading", "clause"]).map((field) => `requirement ${id || "(unknown)"} source is missing ${field}`));
  const path = typeof source.path === "string" ? source.path : "";
  if (path && !existsSync(join(root, path))) errors.push(`requirement ${id} references missing source ${path}`);
}

function validateRowFields(row: JsonRecord, id: string, errors: ErrorList): void {
  errors.push(...missingKeys(row, rowFields).map((field) => `requirement row ${id || "(unknown)"} is missing ${field}`));
  validateSource(row, id, errors);
  addChecks([
    [typeof row.checkpoint !== "string" || !checkpointIds.includes(row.checkpoint), `requirement ${id} has invalid checkpoint`],
    [typeof row.mandatory !== "boolean", `requirement ${id} mandatory must be boolean`],
    [typeof row.acceptance_criteria !== "string" || !row.acceptance_criteria.trim(), `requirement ${id} acceptance_criteria must be non-empty`],
    ...["fixture_ids", "reference_versions", "applicable_platforms", "evidence_paths"].map((field) => [!Array.isArray(row[field]), `requirement ${id} ${field} must be an array`] as [boolean, string]),
    [typeof row.status !== "string" || !validRequirementStatuses.has(row.status), `requirement ${id} has invalid status`],
    [typeof row.gate_class !== "string" || !["implementation", "release_external"].includes(row.gate_class), `requirement ${id} has invalid gate_class`],
    [typeof row.decision_id !== "string" || !/^D(?:0[1-9]|1[0-9]|2[0-1])$/.test(row.decision_id), `requirement ${id} has invalid decision_id`],
  ], errors);
}

function collectRow(rawRow: unknown, rows: JsonRecord[], rowMap: Map<string, JsonRecord>, mandatoryRows: JsonRecord[], sources: Set<string>, evidenceRefs: Set<string>, errors: ErrorList): void {
  const row = asRecord(rawRow);
  if (!row) {
    errors.push("requirements.json contains a non-object requirement row");
    return;
  }
  const id = typeof row.id === "string" ? row.id : "";
  validateRowFields(row, id, errors);
  if (!id) return;
  if (rowMap.has(id)) errors.push(`duplicate requirement id: ${id}`);
  rowMap.set(id, row);
  rows.push(row);
  const source = asRecord(row.source);
  if (typeof source?.path === "string") sources.add(source.path);
  if (row.mandatory === true) mandatoryRows.push(row);
  const evidence = Array.isArray(row.evidence_paths) ? row.evidence_paths : [];
  for (const path of evidence) {
    if (typeof path !== "string") errors.push(`requirement ${id} contains a non-string evidence path`);
    else evidenceRefs.add(path);
  }
}

function validateRequirementCoverage(rows: JsonRecord[], rowMap: Map<string, JsonRecord>, sourcePaths: string[], coveredSources: Set<string>, state: JsonRecord, errors: ErrorList): void {
  errors.push(...sourcePaths.filter((path) => !coveredSources.has(path)).map((path) => `no requirement row covers specification ${path}`));
  const requiredParents = Array.isArray(state.required_parent_ids) ? state.required_parent_ids : [];
  errors.push(...requiredParents.filter((id) => typeof id !== "string" || !rowMap.has(id)).map((id) => `state.required_parent_ids is missing from requirements.json: ${String(id)}`));
  errors.push(...rows.filter((row) => typeof row.parent_id === "string" && row.parent_id && !rowMap.has(row.parent_id)).map((row) => `requirement ${String(row.id)} parent_id ${row.parent_id} is not present`));
}

function validateRequirements(document: JsonRecord, paths: string[], state: JsonRecord, errors: ErrorList): { rows: JsonRecord[]; rowMap: Map<string, JsonRecord>; mandatoryRows: JsonRecord[]; evidenceRefs: Set<string> } {
  const rawRows = Array.isArray(document.rows) ? document.rows : [];
  const rows: JsonRecord[] = [];
  const rowMap = new Map<string, JsonRecord>();
  const mandatoryRows: JsonRecord[] = [];
  const evidenceRefs = new Set<string>();
  const coveredSources = new Set<string>();
  if (rawRows.length === 0) errors.push("requirements.json rows must contain at least one acceptance row");
  rawRows.forEach((rawRow) => collectRow(rawRow, rows, rowMap, mandatoryRows, coveredSources, evidenceRefs, errors));
  validateRequirementCoverage(rows, rowMap, paths, coveredSources, state, errors);
  return { rows, rowMap, mandatoryRows, evidenceRefs };
}

function validateOneCheckpoint(id: string, raw: unknown, rowMap: Map<string, JsonRecord>, errors: ErrorList): void {
  const checkpoint = asRecord(raw);
  if (!checkpoint) {
    errors.push(`checkpoint ${id} must be an object`);
    return;
  }
  const requirementIds = Array.isArray(checkpoint.requirement_ids) ? checkpoint.requirement_ids : [];
  errors.push(...requirementIds.filter((requirementId) => typeof requirementId !== "string" || !rowMap.has(requirementId)).map((requirementId) => `checkpoint ${id} references unknown requirement ${String(requirementId)}`));
  const evidence = Array.isArray(checkpoint.evidence) ? checkpoint.evidence : [];
  errors.push(...evidence.filter((path) => typeof path !== "string").map(() => `checkpoint ${id} contains a non-string evidence path`));
  errors.push(...evidence.filter((path): path is string => typeof path === "string" && !existsSync(join(root, path))).map((path) => `checkpoint ${id} evidence path does not exist: ${path}`));
}

function validateCheckpointEvidence(checkpoints: JsonRecord | null, rowMap: Map<string, JsonRecord>, errors: ErrorList): void {
  if (checkpoints) Object.entries(checkpoints).forEach(([id, raw]) => validateOneCheckpoint(id, raw, rowMap, errors));
}

function validateGitMarkers(checkpoints: JsonRecord | null, errors: ErrorList): void {
  if (!checkpoints) return;
  const messages = git(["log", "--all", "--format=%s"]).split("\n");
  Object.entries(checkpoints).forEach(([id, raw]) => {
    const checkpoint = asRecord(raw);
    if (checkpoint?.status !== "complete") return;
    const marker = typeof checkpoint.commit_marker === "string" ? checkpoint.commit_marker : "";
    if (!marker) errors.push(`complete checkpoint ${id} must have a commit_marker`);
    else if (!messages.some((message) => message.includes(marker))) errors.push(`complete checkpoint ${id} marker is not reachable in Git history: ${marker}`);
  });
  const branch = git(["branch", "--show-current"]);
  if (branch !== "main") errors.push(`current Git branch must be main, found ${branch || "(detached)"}`);
}

function validateEvidenceRefs(refs: Set<string>, errors: ErrorList): void {
  errors.push(...[...refs].filter((path) => !existsSync(join(root, path))).map((path) => `requirement evidence path does not exist: ${path}`));
}

function count(rows: JsonRecord[], status: string): number {
  return rows.filter((row) => row.status === status).length;
}

function printSummary(state: JsonRecord, checkpoints: JsonRecord | null, rows: JsonRecord[], mandatoryRows: JsonRecord[], log: Reporter): number {
  const complete = checkpoints ? Object.values(checkpoints).filter((raw) => asRecord(raw)?.status === "complete").length : 0;
  const incomplete = mandatoryRows.filter((row) => row.status !== "passing" && row.status !== "unsupported_security").length;
  log(`OpenObsidian progress: ${complete}/${checkpointIds.length} checkpoints complete`);
  log(`Acceptance rows: ${rows.length} total; ${count(rows, "passing")} passing; ${count(rows, "implemented")} implemented; ${count(rows, "pending")} pending; ${count(rows, "failing")} failing; ${count(rows, "blocked")} blocked`);
  log(`Separate counts: ${count(rows, "unsupported_security")} unsupported-security; ${count(rows, "external_pending")} external-pending; ${incomplete} mandatory rows not release-passing`);
  if (state.status !== "complete") log(`STATUS: goal status is ${String(state.status)}, not complete`);
  if (incomplete > 0) log(`STATUS: release completion remains blocked by ${incomplete} mandatory acceptance rows`);
  return incomplete;
}

export function runStatus(args: string[], log: Reporter = console.log, error: Reporter = console.error): number {
  const flags = new Set(args);
  const errors: ErrorList = [];
  const paths = specPaths();
  if (!reportMissingArtifacts(errors)) {
    error(errors.join("\n"));
    return 1;
  }
  const state = readJson(join(taskRoot, "state.json"));
  const requirements = readJson(join(taskRoot, "requirements.json"));
  const checkpoints = asRecord(state.checkpoints);
  validateStateShape(state, checkpoints, errors);
  validateSpecHashes(state, paths, errors);
  const inventory = validateRequirements(requirements, paths, state, errors);
  validateCheckpointEvidence(checkpoints, inventory.rowMap, errors);
  validateEvidenceRefs(inventory.evidenceRefs, errors);
  validateGitMarkers(checkpoints, errors);
  const incomplete = printSummary(state, checkpoints, inventory.rows, inventory.mandatoryRows, log);
  if (errors.length > 0) {
    error(errors.join("\n"));
    return 1;
  }
  if (flags.has("--release") && incomplete > 0) {
    error("RELEASE CHECK: incomplete; mandatory implementation work or required evidence remains.");
    return 2;
  }
  if (flags.has("--release") && state.status !== "complete") {
    error(`RELEASE CHECK: incomplete; state.status is ${String(state.status)}.`);
    return 2;
  }
  if (flags.has("--validate")) log("STRUCTURE CHECK: passed");
  return 0;
}

if (import.meta.main) process.exit(runStatus(Bun.argv.slice(2)));
