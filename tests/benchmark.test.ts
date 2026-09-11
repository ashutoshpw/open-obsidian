import {expect, test} from "bun:test";
import {runBenchmark} from "../scripts/benchmark.js";

test("local benchmark records core distributions and keeps unavailable gates external", async () => {
  const report = await runBenchmark([25], {indexRuns: 1, searchRuns: 5, inputRuns: 5});
  const expectedScope = process.platform === "linux" ? "linux-core-synthetic" : "non-linux-core-synthetic";

  expect(report.schema_version).toBe(1);
  expect(report.environment.scope).toBe(expectedScope);
  expect(report.release_eligible).toBe(false);
  expect(report.profiles).toHaveLength(1);
  expect(report.profiles[0]).toMatchObject({id: "synthetic-25", notes: 25, scope: expectedScope});
  expect(report.profiles[0]?.startup.indexing.runs).toBe(1);
  expect(report.profiles[0]?.startup.editable_before_indexing).toBe(true);
  expect(report.profiles[0]?.input.normal.runs).toBe(5);
  expect(report.profiles[0]?.input.large_file.runs).toBe(5);
  expect(report.profiles[0]?.search.runs).toBe(5);
  expect(report.profiles[0]?.resources.model_memory_bytes).toBe(0);
  expect(report.external_pending.map((entry) => entry.id)).toEqual(expect.arrayContaining(["pinned-hardware", "reference-vault-10000", "reference-vault-100000", "renderer-input-to-paint", "cross-platform", "human-comparison"]));
});
