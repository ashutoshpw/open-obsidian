import {expect, test} from "bun:test";
import {runComparisonScorecard, validateComparisonFixture, type ComparisonFixture} from "../scripts/comparison-scorecard.js";

const fixture = await Bun.file(new URL("../fixtures/comparison-scorecard.json", import.meta.url)).json() as ComparisonFixture;

test("comparison scorecard validates a balanced identical-input protocol without inventing measurements", () => {
  expect(validateComparisonFixture(fixture)).toEqual([]);
  const report = runComparisonScorecard(fixture, "2026-09-11T00:00:00Z");

  expect(report.validation).toEqual({
    passed: true,
    profile_balance: true,
    task_balance: true,
    corpus_balance: true,
    model_condition_balance: true,
    no_measurement_invention: true,
  });
  expect(report.protocol).toMatchObject({
    profiles: ["stock-obsidian", "plugin-equipped-obsidian", "openobsidian"],
    tasks: ["find", "synthesize", "organize"],
    corpus_profiles: ["smoke-edge-cases", "medium-10k", "large-100k", "canvas-bases", "conflict-recovery", "ai-grounding"],
    model_conditions: ["local-deterministic", "provider-backed"],
    identical_inputs: true,
    counterbalanced: true,
  });
  expect(report.runs).toHaveLength(108);
  expect(report.runs.every((run) => run.status === "external-pending" && run.accuracy === null && run.completion_time_ms === null)).toBe(true);
  expect(report.measurements).toEqual({completed: 0, pending: 108, accuracy_available: false, completion_time_available: false});
  expect(report.comparison_status).toBe("defined_not_run");
  expect(report.release_eligible).toBe(false);
  expect(report.result).toContain("no superiority claim");
});

test("comparison scorecard rejects duplicate task identities", () => {
  const invalid = {...fixture, tasks: [fixture.tasks[0]!, fixture.tasks[0]!]};
  expect(validateComparisonFixture(invalid)).toContain("comparison tasks need unique prompts and measured outcomes");
  expect(runComparisonScorecard(invalid, "2026-09-11T00:00:00Z").validation.passed).toBe(false);
});
