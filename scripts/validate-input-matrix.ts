import {existsSync, readFileSync} from "node:fs";
import {join, resolve} from "node:path";

type Status = "implemented" | "external-pending";
type InputCase = {
  id: string;
  status: Status;
  runner?: string;
  evidence_paths?: string[];
  note?: string;
  owner?: string;
  prerequisites?: string[];
  verification?: string[];
};
type InputMatrix = {schema_version: number; name: string; required_cases: string[]; cases: InputCase[]; invariants: string[]};

const root = resolve(import.meta.dir, "..");
const fixturePath = join(root, "fixtures/c10-input-matrix.json");

function readFixture(): InputMatrix {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as InputMatrix;
}

function nonEmptyStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string" && entry.trim().length > 0);
}

function validateImplementedCase(inputCase: InputCase, name: string, failures: string[]): void {
  if (!inputCase.runner?.trim()) failures.push(`${name} needs a runner`);
  if (!nonEmptyStrings(inputCase.evidence_paths)) failures.push(`${name} needs evidence paths`);
  else for (const path of inputCase.evidence_paths) if (!existsSync(join(root, path))) failures.push(`${name} references missing evidence ${path}`);
  if (!inputCase.note?.trim()) failures.push(`${name} needs an implementation note`);
}

function validateExternalCase(inputCase: InputCase, name: string, failures: string[]): void {
  if (!inputCase.owner?.trim()) failures.push(`${name} needs an owner`);
  if (!nonEmptyStrings(inputCase.prerequisites)) failures.push(`${name} needs prerequisites`);
  if (!nonEmptyStrings(inputCase.verification)) failures.push(`${name} needs verification steps`);
  if (!inputCase.note?.trim()) failures.push(`${name} needs a limitation note`);
}

function validateCase(inputCase: InputCase, failures: string[]): void {
  const name = inputCase.id?.trim() || "(unknown)";
  if (!inputCase.id?.trim()) failures.push("input matrix case IDs must be non-empty");
  switch (inputCase.status) {
    case "implemented":
      validateImplementedCase(inputCase, name, failures);
      return;
    case "external-pending":
      validateExternalCase(inputCase, name, failures);
      return;
    default:
      failures.push(`${name} has an unsupported status ${String(inputCase.status)}`);
  }
}

export function validateInputMatrix(fixture = readFixture()): {failures: string[]; implemented: number; externalPending: number} {
  const failures: string[] = [];
  if (fixture.schema_version !== 1) failures.push("input matrix fixture must use schema version 1");
  if (!fixture.name?.trim()) failures.push("input matrix fixture needs a name");
  if (!nonEmptyStrings(fixture.required_cases)) failures.push("input matrix fixture must list required cases");
  if (!Array.isArray(fixture.cases) || fixture.cases.length === 0) failures.push("input matrix fixture must declare cases");
  if (!nonEmptyStrings(fixture.invariants)) failures.push("input matrix fixture must declare invariants");
  const cases = Array.isArray(fixture.cases) ? fixture.cases : [];
  const ids = cases.map((inputCase) => inputCase.id);
  if (new Set(ids).size !== ids.length) failures.push("input matrix case IDs must be unique");
  for (const required of fixture.required_cases ?? []) if (!ids.includes(required)) failures.push(`input matrix is missing required case ${required}`);
  cases.forEach((inputCase) => validateCase(inputCase, failures));
  return {
    failures,
    implemented: cases.filter((inputCase) => inputCase.status === "implemented").length,
    externalPending: cases.filter((inputCase) => inputCase.status === "external-pending").length,
  };
}

function runInputMatrixCheck(): number {
  const result = validateInputMatrix();
  for (const failure of result.failures) console.error(`INPUT MATRIX ERROR: ${failure}`);
  if (result.failures.length > 0) return 1;
  console.log(`INPUT MATRIX CHECK: passed; ${result.implemented} locally covered, ${result.externalPending} external-pending`);
  return 0;
}

if (import.meta.main) process.exit(runInputMatrixCheck());
