import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

const root = resolve(import.meta.dir, "..");

type ProfileDisposition = "external-pending";

type ComparisonProfile = {
  id: string;
  label: string;
  disposition: ProfileDisposition;
  reason: string;
};

type ComparisonTask = {
  id: string;
  prompt: string;
  measures: string[];
};

type ModelCondition = {
  id: string;
  description: string;
  network: "offline" | "controlled-external";
};

type ExternalPending = {id: string; reason: string};

export type ComparisonFixture = {
  schema_version: 1;
  protocol_version: string;
  name: string;
  assignment_seed: string;
  profiles: ComparisonProfile[];
  tasks: ComparisonTask[];
  corpus_profiles: string[];
  model_conditions: ModelCondition[];
  repetitions: number;
  external_pending: ExternalPending[];
};

export type ComparisonRun = {
  id: string;
  block: number;
  sequence: number;
  profile: string;
  task: string;
  corpus_profile: string;
  model_condition: string;
  status: "external-pending";
  accuracy: number | null;
  completion_time_ms: number | null;
  notes: string;
};

export type ComparisonScorecardReport = {
  schema_version: 1;
  protocol_version: string;
  recorded_at: string;
  assignment_seed: string;
  protocol: {
    profiles: string[];
    tasks: string[];
    corpus_profiles: string[];
    model_conditions: string[];
    repetitions: number;
    identical_inputs: boolean;
    counterbalanced: boolean;
  };
  runs: ComparisonRun[];
  measurements: {
    completed: number;
    pending: number;
    accuracy_available: boolean;
    completion_time_available: boolean;
  };
  validation: {
    passed: boolean;
    profile_balance: boolean;
    task_balance: boolean;
    corpus_balance: boolean;
    model_condition_balance: boolean;
    no_measurement_invention: boolean;
  };
  comparison_status: "defined_not_run";
  release_eligible: false;
  external_pending: ExternalPending[];
  result: string;
};

async function loadFixture(): Promise<ComparisonFixture> {
  const bytes = await readFile(resolve(root, "fixtures/comparison-scorecard.json"), "utf8");
  return JSON.parse(bytes) as ComparisonFixture;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function validateIdentity(fixture: ComparisonFixture): string[] {
  const failures: string[] = [];
  if (fixture.schema_version !== 1) failures.push("unsupported comparison fixture schema");
  if (!fixture.protocol_version || !fixture.name || !fixture.assignment_seed) failures.push("comparison fixture identity is incomplete");
  return failures;
}

function validateProfiles(profiles: ComparisonProfile[]): string[] {
  const failures: string[] = [];
  const required = ["stock-obsidian", "plugin-equipped-obsidian", "openobsidian"];
  const ids = profiles.map((profile) => profile.id);
  if (profiles.length < required.length || !required.every((id) => ids.includes(id)) || !unique(ids)) failures.push("comparison fixture needs unique stock, plugin-equipped and OpenObsidian profiles");
  if (profiles.some((profile) => profile.disposition !== "external-pending" || !profile.reason)) failures.push("every unavailable comparison profile needs an explicit external disposition");
  return failures;
}

function validateTasks(tasks: ComparisonTask[]): string[] {
  const ids = tasks.map((task) => task.id);
  return tasks.length === 0 || !unique(ids) || tasks.some((task) => !task.prompt || task.measures.length === 0) ? ["comparison tasks need unique prompts and measured outcomes"] : [];
}

function validateCollections(fixture: ComparisonFixture): string[] {
  const failures: string[] = [];
  if (fixture.corpus_profiles.length === 0 || !unique(fixture.corpus_profiles)) failures.push("comparison fixture needs unique corpus profiles");
  if (fixture.model_conditions.length === 0 || !unique(fixture.model_conditions.map((condition) => condition.id))) failures.push("comparison fixture needs unique model conditions");
  if (!Number.isInteger(fixture.repetitions) || fixture.repetitions < 1) failures.push("comparison repetitions must be a positive integer");
  return failures;
}

function validateExternalPending(entries: ExternalPending[]): string[] {
  return entries.length === 0 || entries.some((entry) => !entry.id || !entry.reason) ? ["comparison external handoffs need ids and reasons"] : [];
}

export function validateComparisonFixture(fixture: ComparisonFixture): string[] {
  return [
    ...validateIdentity(fixture),
    ...validateProfiles(fixture.profiles),
    ...validateTasks(fixture.tasks),
    ...validateCollections(fixture),
    ...validateExternalPending(fixture.external_pending),
  ];
}

function expectedRunCount(fixture: ComparisonFixture): number {
  return fixture.profiles.length * fixture.tasks.length * fixture.corpus_profiles.length * fixture.model_conditions.length * fixture.repetitions;
}

function buildRuns(fixture: ComparisonFixture): ComparisonRun[] {
  const runs: ComparisonRun[] = [];
  let sequence = 0;
  let block = 0;
  for (let repetition = 0; repetition < fixture.repetitions; repetition += 1) {
    for (const modelCondition of fixture.model_conditions) {
      for (const corpusProfile of fixture.corpus_profiles) {
        for (const task of fixture.tasks) {
          const rotation = block % fixture.profiles.length;
          fixture.profiles.forEach((_, index) => {
            const profile = fixture.profiles[(index + rotation) % fixture.profiles.length]!;
            sequence += 1;
            runs.push({
              id: `run-${String(sequence).padStart(4, "0")}`,
              block,
              sequence,
              profile: profile.id,
              task: task.id,
              corpus_profile: corpusProfile,
              model_condition: modelCondition.id,
              status: "external-pending",
              accuracy: null,
              completion_time_ms: null,
              notes: profile.reason,
            });
          });
          block += 1;
        }
      }
    }
  }
  return runs;
}

function balanced(runs: ComparisonRun[], field: keyof Pick<ComparisonRun, "profile" | "task" | "corpus_profile" | "model_condition">, expected: string[]): boolean {
  const counts = new Map<string, number>();
  runs.forEach((run) => counts.set(run[field], (counts.get(run[field]) ?? 0) + 1));
  const values = expected.map((value) => counts.get(value) ?? 0);
  return values.every((value) => value > 0) && new Set(values).size === 1;
}

function balancedByBlock(runs: ComparisonRun[], profiles: string[]): boolean {
  const blocks = new Map<number, string[]>();
  runs.forEach((run) => blocks.set(run.block, [...(blocks.get(run.block) ?? []), run.profile]));
  return [...blocks.values()].every((block) => block.length === profiles.length && new Set(block).size === profiles.length && profiles.every((profile) => block.includes(profile)));
}

export function runComparisonScorecard(fixture: ComparisonFixture, recordedAt = new Date().toISOString()): ComparisonScorecardReport {
  const failures = validateComparisonFixture(fixture);
  const runs = failures.length === 0 ? buildRuns(fixture) : [];
  const profileIds = fixture.profiles.map((profile) => profile.id);
  const taskIds = fixture.tasks.map((task) => task.id);
  const conditionIds = fixture.model_conditions.map((condition) => condition.id);
  const validation = {
    passed: false,
    profile_balance: runs.length > 0 && balanced(runs, "profile", profileIds),
    task_balance: runs.length > 0 && balanced(runs, "task", taskIds),
    corpus_balance: runs.length > 0 && balanced(runs, "corpus_profile", fixture.corpus_profiles),
    model_condition_balance: runs.length > 0 && balanced(runs, "model_condition", conditionIds),
    no_measurement_invention: runs.every((run) => run.status === "external-pending" && run.accuracy === null && run.completion_time_ms === null),
  };
  validation.passed = failures.length === 0 && runs.length === expectedRunCount(fixture) && validation.profile_balance && validation.task_balance && validation.corpus_balance && validation.model_condition_balance && balancedByBlock(runs, profileIds) && validation.no_measurement_invention;
  return {
    schema_version: 1,
    protocol_version: fixture.protocol_version,
    recorded_at: recordedAt,
    assignment_seed: fixture.assignment_seed,
    protocol: {
      profiles: profileIds,
      tasks: taskIds,
      corpus_profiles: [...fixture.corpus_profiles],
      model_conditions: conditionIds,
      repetitions: fixture.repetitions,
      identical_inputs: true,
      counterbalanced: validation.passed,
    },
    runs,
    measurements: {
      completed: runs.filter((run) => run.status !== "external-pending").length,
      pending: runs.filter((run) => run.status === "external-pending").length,
      accuracy_available: runs.some((run) => run.accuracy !== null),
      completion_time_available: runs.some((run) => run.completion_time_ms !== null),
    },
    validation,
    comparison_status: "defined_not_run",
    release_eligible: false,
    external_pending: [...fixture.external_pending],
    result: validation.passed
      ? "The counterbalanced comparison protocol is structurally valid with identical task, corpus and model-condition assignments; no stock, plugin-equipped or human-run measurements were available, so no superiority claim is made."
      : `Comparison protocol validation failed: ${failures.join("; ") || "assignment balance is incomplete"}`,
  };
}

if (import.meta.main) {
  const fixture = await loadFixture();
  const report = runComparisonScorecard(fixture);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.validation.passed ? 0 : 1);
}
