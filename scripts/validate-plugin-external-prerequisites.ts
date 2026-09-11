import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";

type CatalogEntry = {id: string; external_prerequisites?: unknown};
type PrerequisiteEntry = {
  target_id: string;
  prerequisites: string[];
  status: "external_pending" | "not-required";
  setup: string;
  verification: string;
};
type ExternalPrerequisiteFixture = {
  schema_version: number;
  id: string;
  source_catalog: string;
  status: "external_pending";
  live_access: {contacted: false; selected_vault_accessed: false; provider_contacted: false; artifact_modified: false};
  entries: PrerequisiteEntry[];
  invariants: string[];
};

const root = resolve(import.meta.dir, "..");

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8")) as T;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value as string[] : [];
}

export function validatePluginExternalPrerequisites(
  fixture = readJson<ExternalPrerequisiteFixture>("fixtures/plugin-external-prerequisites.json"),
  catalog = readJson<{entries: CatalogEntry[]}>("fixtures/plugin-catalog.json"),
): string[] {
  const expected = new Map(catalog.entries.map((entry) => [entry.id, strings(entry.external_prerequisites)]));
  const {failures, seen} = validateEntries(fixture.entries, expected);
  return [
    ...validateHeader(fixture),
    ...validateLiveAccess(fixture.live_access),
    ...failures,
    ...validateCompleteness(fixture.entries, expected, seen),
    ...validateInvariants(fixture.invariants),
  ];
}

function validateHeader(fixture: ExternalPrerequisiteFixture): string[] {
  return [
    fixture.schema_version === 1 ? null : "external prerequisite fixture must use schema version 1",
    fixture.id === "fixture:external-prerequisites" ? null : "external prerequisite fixture ID is invalid",
    fixture.source_catalog === "fixtures/plugin-catalog.json" ? null : "external prerequisite fixture must point to the pinned catalog",
    fixture.status === "external_pending" ? null : "fixture status must remain external_pending",
  ].filter((failure): failure is string => failure !== null);
}

function validateLiveAccess(liveAccess: ExternalPrerequisiteFixture["live_access"]): string[] {
  const contacted = Object.entries(liveAccess).filter(([, value]) => value).map(([key]) => key);
  return contacted.length === 0 ? [] : ["prerequisite contract must not contact live systems, access the selected vault or mutate artifacts"];
}

function validateEntry(entry: PrerequisiteEntry, expected: Map<string, string[]>, seen: Set<string>): string[] {
  const failures: string[] = [];
  if (seen.has(entry.target_id)) failures.push(`duplicate prerequisite entry ${entry.target_id}`);
  seen.add(entry.target_id);
  const prerequisites = expected.get(entry.target_id);
  if (!prerequisites) return [...failures, `unknown catalog target ${entry.target_id}`];
  if (JSON.stringify(entry.prerequisites) !== JSON.stringify(prerequisites)) failures.push(`${entry.target_id} prerequisites do not match the pinned catalog`);
  const expectedStatus = prerequisites.length > 0 ? "external_pending" : "not-required";
  if (entry.status !== expectedStatus) failures.push(`${entry.target_id} has an invalid prerequisite status`);
  if (!entry.setup.trim() || !entry.verification.trim()) failures.push(`${entry.target_id} must include setup and verification instructions`);
  return failures;
}

function validateEntries(entries: PrerequisiteEntry[], expected: Map<string, string[]>): {failures: string[]; seen: Set<string>} {
  const seen = new Set<string>();
  const failures = entries.flatMap((entry) => validateEntry(entry, expected, seen));
  return {failures, seen};
}

function validateCompleteness(entries: PrerequisiteEntry[], expected: Map<string, string[]>, seen: Set<string>): string[] {
  const missing = [...expected.keys()].filter((id) => !seen.has(id)).map((id) => `catalog target ${id} has no prerequisite row`);
  return entries.length === expected.size ? missing : [...missing, `expected ${expected.size} prerequisite rows, found ${entries.length}`];
}

function validateInvariants(invariants: string[]): string[] {
  return invariants.length >= 3 && invariants.every((invariant) => invariant.trim()) ? [] : ["external prerequisite invariants must be complete"];
}

if (import.meta.main) {
  const failures = validatePluginExternalPrerequisites();
  failures.forEach((failure) => console.error(`PLUGIN PREREQUISITE ERROR: ${failure}`));
  if (failures.length > 0) process.exit(1);
  console.log("PLUGIN PREREQUISITE CHECK: passed; 27 catalog targets have explicit prerequisite and live-access dispositions");
}
