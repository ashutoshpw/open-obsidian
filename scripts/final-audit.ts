import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {asArray, asRecord, asString, type JsonRecord} from "./json.js";

type AuditRow = {id: string; checkpoint: string; mandatory: boolean; status: string};
type Handoff = {id: string; owner: string; prerequisites: string[]; verification: string[]; status: string};
export type FinalAudit = {
  schema_version: 1;
  generated_at: string;
  repository: {expected_origin: string; actual_origin: string; origin_matches: boolean; branch: string; head: string; main_head: string; required_markers_found: string[]};
  implementation_readiness: {total_rows: number; passing: number; implemented: number; pending: number; failing: number; unsupported_security: number; external_pending: number; mandatory_not_release_passing: number};
  release_readiness: {state: string; release_ready: false; pending_mandatory_rows: string[]; external_pending_rows: string[]; unsupported_security_rows: string[]; handoff_ids: string[]};
  phases: Array<{id: string; total: number; passing: number; implemented: number; pending: number; external_pending: number; failing: number; status: "complete" | "in-progress" | "pending" | "empty"}>;
  handoffs: Handoff[];
  actions: {verified_run_ids: number[]; no_release_tag_created_by_goal: boolean};
  failures: string[];
};

const root = resolve(import.meta.dir, "..");

function readJson(relativePath: string): JsonRecord {
  const parsed: unknown = JSON.parse(readFileSync(join(root, relativePath), "utf8"));
  return asRecord(parsed) ?? {};
}

function records(value: unknown): JsonRecord[] {
  return asArray(value).map(asRecord).filter((entry): entry is JsonRecord => entry !== null);
}

function strings(value: unknown): string[] {
  return asArray(value).map(asString).filter(Boolean);
}

function gitValue(args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {cwd: root});
  return new TextDecoder().decode(result.stdout).trim();
}

function auditRows(document: JsonRecord): AuditRow[] {
  return records(document.rows).map((row) => ({id: typeof row.id === "string" ? row.id : "", checkpoint: typeof row.checkpoint === "string" ? row.checkpoint : "", mandatory: row.mandatory === true, status: typeof row.status === "string" ? row.status : ""}));
}

function statusCount(rows: AuditRow[], status: string): number {
  return rows.filter((row) => row.status === status).length;
}

function phaseStatus(rows: AuditRow[]): "complete" | "in-progress" | "pending" | "empty" {
  if (rows.length === 0) return "empty";
  if (rows.every((row) => row.status === "passing" || row.status === "unsupported_security")) return "complete";
  if (rows.some((row) => row.status === "implemented" || row.status === "passing" || row.status === "external_pending")) return "in-progress";
  return "pending";
}

function phaseSummary(rows: AuditRow[], phaseIds: string[]): FinalAudit["phases"] {
  return phaseIds.map((id) => {
    const phaseRows = rows.filter((row) => row.checkpoint === id);
    return {id, total: phaseRows.length, passing: statusCount(phaseRows, "passing"), implemented: statusCount(phaseRows, "implemented"), pending: statusCount(phaseRows, "pending"), external_pending: statusCount(phaseRows, "external_pending"), failing: statusCount(phaseRows, "failing"), status: phaseStatus(phaseRows)};
  });
}

function parseHandoffs(document: JsonRecord): Handoff[] {
  return records(document.handoffs).map((handoff) => ({id: typeof handoff.id === "string" ? handoff.id : "", owner: typeof handoff.owner === "string" ? handoff.owner : "", prerequisites: strings(handoff.prerequisites), verification: strings(handoff.verification), status: typeof handoff.status === "string" ? handoff.status : ""}));
}

function handoffFailures(handoffs: Handoff[]): string[] {
  return handoffs.flatMap((handoff) => {
    const label = handoff.id || "unknown";
    return [
      ...(!handoff.id || !handoff.owner ? ["every release handoff must have an id and owner"] : []),
      ...(handoff.prerequisites.length === 0 ? [`${label} handoff must list prerequisites`] : []),
      ...(handoff.verification.length === 0 ? [`${label} handoff must list verification steps`] : []),
      ...(handoff.status !== "external-pending" ? [`${label} handoff must remain external-pending`] : []),
    ];
  });
}

function markerFailures(requiredMarkers: string[], log: string): string[] {
  return requiredMarkers.filter((marker) => !log.includes(marker)).map((marker) => `required Git marker is not reachable: ${marker}`);
}

function canonicalOrigin(origin: string): string {
  return origin.replace(/\/+$/, "").replace(/\.git$/, "");
}

function repositoryAudit(expectedOrigin: string, requiredMarkers: string[]): {repository: FinalAudit["repository"]; failures: string[]} {
  const actualOrigin = gitValue(["remote", "get-url", "origin"]);
  const branch = gitValue(["branch", "--show-current"]);
  const head = gitValue(["rev-parse", "HEAD"]);
  const mainHead = gitValue(["rev-parse", "main"]);
  const log = gitValue(["log", "--format=%s", "--all"]);
  const originMatches = canonicalOrigin(actualOrigin) === canonicalOrigin(expectedOrigin);
  const requiredMarkersFound = requiredMarkers.filter((marker) => log.includes(marker));
  const failures = [...(!originMatches ? [`origin mismatch: expected ${expectedOrigin}, found ${actualOrigin || "(missing)"}`] : []), ...(branch !== "main" ? [`branch must be main, found ${branch || "(detached)"}`] : []), ...markerFailures(requiredMarkers, log)];
  return {repository: {expected_origin: expectedOrigin, actual_origin: actualOrigin, origin_matches: originMatches, branch, head, main_head: mainHead, required_markers_found: requiredMarkersFound}, failures};
}

export function runFinalAudit(generatedAt = new Date().toISOString()): FinalAudit {
  const state = readJson(".agents/tasks/2026-09-09/01-init/state.json");
  const requirements = readJson(".agents/tasks/2026-09-09/01-init/requirements.json");
  const fixture = readJson("fixtures/release-handoff.json");
  const rows = auditRows(requirements);
  const phaseIds = strings(fixture.phase_ids);
  const requiredMarkers = strings(fixture.required_markers);
  const handoffs = parseHandoffs(fixture);
  const repository = repositoryAudit(typeof fixture.expected_origin === "string" ? fixture.expected_origin : "", requiredMarkers);
  const pendingMandatoryRows = rows.filter((row) => row.mandatory && !["passing", "unsupported_security"].includes(row.status)).map((row) => row.id);
  const externalPendingRows = rows.filter((row) => row.status === "external_pending").map((row) => row.id);
  const unsupportedSecurityRows = rows.filter((row) => row.status === "unsupported_security").map((row) => row.id);
  const noReleaseTag = fixture.no_release_tag_created_by_goal === true;
  const failures = [...repository.failures, ...handoffFailures(handoffs), ...(phaseIds.length !== 19 ? ["release handoff must enumerate exactly 19 phases"] : []), ...(handoffs.length < 7 ? ["release handoff must enumerate managed, human, signing, publication, reference, plugin and updater gates"] : []), ...(!noReleaseTag ? ["release handoff must confirm that no release tag was created by this goal"] : [])];
  const stateStatus = typeof state.status === "string" ? state.status : "unknown";
  return {
    schema_version: 1,
    generated_at: generatedAt,
    repository: repository.repository,
    implementation_readiness: {
      total_rows: rows.length,
      passing: statusCount(rows, "passing"),
      implemented: statusCount(rows, "implemented"),
      pending: statusCount(rows, "pending"),
      failing: statusCount(rows, "failing"),
      unsupported_security: unsupportedSecurityRows.length,
      external_pending: externalPendingRows.length,
      mandatory_not_release_passing: pendingMandatoryRows.length,
    },
    release_readiness: {state: stateStatus, release_ready: false, pending_mandatory_rows: pendingMandatoryRows, external_pending_rows: externalPendingRows, unsupported_security_rows: unsupportedSecurityRows, handoff_ids: handoffs.map((handoff) => handoff.id)},
    phases: phaseSummary(rows, phaseIds),
    handoffs,
    actions: {verified_run_ids: Array.isArray(fixture.verified_actions_runs) ? fixture.verified_actions_runs.filter((id): id is number => typeof id === "number") : [], no_release_tag_created_by_goal: noReleaseTag},
    failures,
  };
}

if (import.meta.main) {
  const result = runFinalAudit();
  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length > 0) process.exit(1);
}
