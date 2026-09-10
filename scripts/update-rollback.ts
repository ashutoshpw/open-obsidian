import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import type {ArtifactManifest} from "./release-gate.js";

type JsonRecord = Record<string, unknown>;
export type UpdateRollbackInput = {
  currentVersion: string;
  targetVersion: string;
  targetManifest: ArtifactManifest;
  rollbackVersion?: string;
  rollbackManifest?: ArtifactManifest;
};
export type UpdateRollbackCheck = {id: string; status: "passed" | "external-pending"; detail: string};
export type UpdateRollbackResult = {status: "ready" | "blocked"; checks: UpdateRollbackCheck[]; failures: string[]};

const root = resolve(import.meta.dir, "..");
const sha256Pattern = /^[a-f0-9]{64}$/;

function manifestFiles(manifest: ArtifactManifest): ArtifactManifest["files"] {
  return Array.isArray(manifest.files) ? manifest.files : [];
}

function unsafePath(path: string): boolean {
  return !path || path.startsWith("/") || path.includes("../") || path.includes("\\");
}

function manifestShapeFailures(label: string, manifest: ArtifactManifest): string[] {
  const files = manifestFiles(manifest);
  return [
    ...(manifest.schema_version !== 1 ? [`${label} manifest schema_version must be 1`] : []),
    ...(files.length === 0 ? [`${label} manifest must contain at least one file`] : []),
  ];
}

function fileFailures(label: string, file: ArtifactManifest["files"][number], paths: Set<string>): string[] {
  const path = typeof file.path === "string" ? file.path : "";
  const failures = [
    ...(unsafePath(path) ? [`${label} manifest contains an unsafe file path`] : []),
    ...(paths.has(path) ? [`${label} manifest contains a duplicate file path: ${path}`] : []),
    ...(!Number.isInteger(file.bytes) || file.bytes < 0 ? [`${label} manifest has invalid byte count for ${path || "(unknown)"}`] : []),
    ...(!sha256Pattern.test(file.sha256) ? [`${label} manifest has invalid sha256 for ${path || "(unknown)"}`] : []),
  ];
  paths.add(path);
  return failures;
}

function manifestFailures(label: string, manifest: ArtifactManifest | undefined): string[] {
  if (!manifest) return [`${label} manifest is required`];
  const paths = new Set<string>();
  return [...manifestShapeFailures(label, manifest), ...manifestFiles(manifest).flatMap((file) => fileFailures(label, file, paths))];
}

function addManifestCheck(checks: UpdateRollbackCheck[], failures: string[], id: string, label: string, manifest: ArtifactManifest | undefined): void {
  const checkFailures = manifestFailures(label, manifest);
  failures.push(...checkFailures);
  checks.push({id, status: checkFailures.length === 0 ? "passed" : "external-pending", detail: checkFailures.length === 0 ? `${label} manifest is structurally valid` : checkFailures.join("; ")});
}

export function evaluateUpdateRollback(input: UpdateRollbackInput): UpdateRollbackResult {
  const checks: UpdateRollbackCheck[] = [];
  const failures: string[] = [];
  addManifestCheck(checks, failures, "manifest-integrity", "target", input.targetManifest);

  const versionChanged = Boolean(input.currentVersion && input.targetVersion && input.currentVersion !== input.targetVersion);
  if (!versionChanged) failures.push("target version must be non-empty and differ from the current version");
  checks.push({id: "version-transition", status: versionChanged ? "passed" : "external-pending", detail: versionChanged ? `${input.currentVersion} -> ${input.targetVersion}` : "target version transition is invalid"});

  const rollbackAvailable = Boolean(input.rollbackVersion && input.rollbackVersion !== input.targetVersion && input.rollbackManifest);
  addManifestCheck(checks, failures, "rollback-manifest-integrity", "rollback", input.rollbackManifest);
  if (!rollbackAvailable) failures.push("rollback version and a distinct previous artifact are required");
  checks.push({id: "previous-artifact-rollback", status: rollbackAvailable ? "passed" : "external-pending", detail: rollbackAvailable ? `rollback target is ${input.rollbackVersion}` : "previous artifact rollback is not configured"});
  checks.push({id: "offline-installation", status: "external-pending", detail: "verify installation and downgrade on each supported platform with a staged artifact"});

  return {status: failures.length === 0 ? "ready" : "blocked", checks, failures};
}

function readFixture(): JsonRecord {
  return JSON.parse(readFileSync(join(root, "fixtures/update-rollback.json"), "utf8")) as JsonRecord;
}

function artifact(value: unknown): ArtifactManifest | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as ArtifactManifest : undefined;
}

if (import.meta.main) {
  const fixture = readFixture();
  const result = evaluateUpdateRollback({
    currentVersion: typeof fixture.current_version === "string" ? fixture.current_version : "",
    targetVersion: typeof fixture.target_version === "string" ? fixture.target_version : "",
    targetManifest: artifact(fixture.target_manifest) as ArtifactManifest,
    rollbackVersion: typeof fixture.rollback_version === "string" ? fixture.rollback_version : undefined,
    rollbackManifest: artifact(fixture.rollback_manifest),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length > 0) process.exit(1);
}
