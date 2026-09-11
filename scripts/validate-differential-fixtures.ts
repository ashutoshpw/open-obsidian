import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";

type ReferenceStatus = "observed" | "external-pending";
type ComparisonStatus = "match" | "mismatch" | "not-compared";

export type DifferentialTrack = {
  id: string;
  product: string;
  version: string;
  status: ReferenceStatus;
  applicable_platforms: string[];
};

export type DifferentialCase = {
  id: string;
  surface: string;
  operation: string;
  input: Record<string, unknown>;
  local_test: string;
  local_expectation: {status: "passed"};
  reference_observation: {
    status: ReferenceStatus;
    required_steps: string[];
    tracks: string[];
    result: string | null;
  };
  comparison: {
    status: ComparisonStatus;
    discrepancies: string[];
    decision_id: string;
    decision: string;
  };
};

export type DifferentialFixture = {
  schema_version: number;
  id: string;
  purpose: string;
  reference_tracks: DifferentialTrack[];
  cases: DifferentialCase[];
};

export type DifferentialValidation = {
  failures: string[];
  localCaseCount: number;
  pendingReferenceCount: number;
  decisionCount: number;
};

const root = resolve(import.meta.dir, "..");
const supportedPlatforms = ["macOS", "Windows", "Linux"];

function readFixture(): DifferentialFixture {
  return JSON.parse(readFileSync(join(root, "fixtures/vault-differential.json"), "utf8")) as DifferentialFixture;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function addFailures(failures: string[], errors: string[], prefix: string): void {
  errors.forEach((error) => failures.push(`${prefix}${error}`));
}

function trackIdentityErrors(track: DifferentialTrack): string[] {
  return [
    ...(!nonEmpty(track.id) ? ["track ID is empty"] : []),
    ...(!nonEmpty(track.product) ? [`${track.id || "track"} product is empty`] : []),
    ...(!nonEmpty(track.version) ? [`${track.id || "track"} version is empty`] : []),
  ];
}

function trackPlatformErrors(track: DifferentialTrack): string[] {
  return supportedPlatforms.every((platform) => track.applicable_platforms?.includes(platform))
    ? []
    : [`${track.id || "track"} must name macOS, Windows and Linux`];
}

function trackStatusErrors(track: DifferentialTrack): string[] {
  return track.status === "observed" || track.status === "external-pending" ? [] : [`${track.id || "track"} has an invalid status`];
}

function validateTrack(track: DifferentialTrack): string[] {
  return [...trackIdentityErrors(track), ...trackPlatformErrors(track), ...trackStatusErrors(track)];
}

function referenceStepErrors(observation: DifferentialCase["reference_observation"]): string[] {
  return Array.isArray(observation.required_steps) && observation.required_steps.length >= 2 && observation.required_steps.every(nonEmpty)
    ? []
    : ["reference observation needs at least two non-empty steps"];
}

function referenceTrackErrors(observation: DifferentialCase["reference_observation"], trackIds: Set<string>): string[] {
  if (!Array.isArray(observation.tracks) || observation.tracks.length === 0) return ["reference observation needs at least one track"];
  return observation.tracks.filter((track) => !trackIds.has(track)).map((track) => `reference observation names unknown track ${track}`);
}

function referenceResultErrors(observation: DifferentialCase["reference_observation"]): string[] {
  if (observation.status === "external-pending") return observation.result === null ? [] : ["external-pending reference observation must have a null result"];
  if (observation.status === "observed") return nonEmpty(observation.result) ? [] : ["observed reference observation must have a result"];
  return ["reference observation has an invalid status"];
}

function validateReferenceObservation(testCase: DifferentialCase, trackIds: Set<string>): string[] {
  const observation = testCase.reference_observation;
  return [...referenceStepErrors(observation), ...referenceTrackErrors(observation, trackIds), ...referenceResultErrors(observation)];
}

function comparisonIdentityErrors(comparison: DifferentialCase["comparison"]): string[] {
  return [
    ...(!nonEmpty(comparison.decision_id) ? ["comparison must retain a decision ID"] : []),
    ...(!nonEmpty(comparison.decision) ? ["comparison must retain a non-empty decision"] : []),
    ...(!Array.isArray(comparison.discrepancies) ? ["comparison discrepancies must be an array"] : []),
  ];
}

function notComparedErrors(testCase: DifferentialCase, discrepancies: string[]): string[] {
  if (testCase.comparison.status !== "not-compared") return [];
  return [
    ...(testCase.reference_observation.status !== "external-pending" ? ["not-compared cases must have an external-pending reference observation"] : []),
    ...(discrepancies.length > 0 ? ["not-compared cases cannot claim discrepancies without a reference result"] : []),
  ];
}

function matchErrors(testCase: DifferentialCase, discrepancies: string[]): string[] {
  if (testCase.comparison.status !== "match") return [];
  return testCase.reference_observation.status === "observed" && discrepancies.length === 0
    ? []
    : ["match cases require an observed reference result and no discrepancies"];
}

function mismatchErrors(testCase: DifferentialCase, discrepancies: string[]): string[] {
  if (testCase.comparison.status !== "mismatch") return [];
  return discrepancies.length > 0 ? [] : ["mismatch cases must preserve at least one discrepancy"];
}

function comparisonStatusErrors(status: ComparisonStatus): string[] {
  return ["match", "mismatch", "not-compared"].includes(status) ? [] : ["comparison has an invalid status"];
}

function validateComparison(testCase: DifferentialCase): string[] {
  const comparison = testCase.comparison;
  const discrepancies = Array.isArray(comparison.discrepancies) ? comparison.discrepancies : [];
  return [
    ...comparisonIdentityErrors(comparison),
    ...comparisonStatusErrors(comparison.status),
    ...notComparedErrors(testCase, discrepancies),
    ...matchErrors(testCase, discrepancies),
    ...mismatchErrors(testCase, discrepancies),
  ];
}

function validateCase(testCase: DifferentialCase, trackIds: Set<string>, failures: string[]): void {
  const prefix = `${testCase.id || "(unknown case)"}: `;
  const identityErrors = [
    ...(!nonEmpty(testCase.id) ? ["case ID is empty"] : []),
    ...(!nonEmpty(testCase.surface) ? ["surface is empty"] : []),
    ...(!nonEmpty(testCase.operation) ? ["operation is empty"] : []),
    ...(!nonEmpty(testCase.local_test) ? ["local test command is empty"] : []),
    ...(testCase.local_expectation?.status !== "passed" ? ["local expectation must be passed"] : []),
  ];
  addFailures(failures, identityErrors, prefix);
  addFailures(failures, validateReferenceObservation(testCase, trackIds), prefix);
  addFailures(failures, validateComparison(testCase), prefix);
}

export function validateDifferentialFixture(fixture = readFixture()): DifferentialValidation {
  const failures: string[] = [];
  if (fixture.schema_version !== 1) failures.push("differential fixture must use schema version 1");
  if (fixture.id !== "fixture:reference-differential") failures.push("differential fixture ID must be fixture:reference-differential");
  if (!nonEmpty(fixture.purpose)) failures.push("differential fixture purpose is empty");
  const tracks = Array.isArray(fixture.reference_tracks) ? fixture.reference_tracks : [];
  const trackIds = new Set(tracks.map((track) => track.id));
  if (tracks.length < 2) failures.push("differential fixture must include stable and early-access reference tracks");
  if (trackIds.size !== tracks.length) failures.push("reference track IDs must be unique");
  ["stable", "early-access"].filter((id) => !trackIds.has(id)).forEach((id) => failures.push(`differential fixture is missing ${id} reference track`));
  tracks.forEach((track) => addFailures(failures, validateTrack(track), `${track.id || "(unknown track)"}: `));
  const cases = Array.isArray(fixture.cases) ? fixture.cases : [];
  const caseIds = new Set(cases.map((testCase) => testCase.id));
  if (cases.length < 4) failures.push("differential fixture must include at least four local probes");
  if (caseIds.size !== cases.length) failures.push("differential case IDs must be unique");
  cases.forEach((testCase) => validateCase(testCase, trackIds, failures));
  return {
    failures,
    localCaseCount: cases.filter((testCase) => testCase.local_expectation?.status === "passed").length,
    pendingReferenceCount: cases.filter((testCase) => testCase.reference_observation?.status === "external-pending").length,
    decisionCount: cases.filter((testCase) => nonEmpty(testCase.comparison?.decision_id)).length,
  };
}

if (import.meta.main) {
  const result = validateDifferentialFixture();
  result.failures.forEach((failure) => console.error(`DIFFERENTIAL ERROR: ${failure}`));
  if (result.failures.length > 0) process.exit(1);
  console.log(`DIFFERENTIAL CHECK: passed; ${result.localCaseCount} local probes registered, ${result.pendingReferenceCount} reference observations pending, ${result.decisionCount} comparison decisions retained`);
}
