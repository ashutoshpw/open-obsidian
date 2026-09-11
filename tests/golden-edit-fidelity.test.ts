import {expect, test} from "bun:test";
import {runGoldenEditFidelity} from "../scripts/golden-edit-fidelity.js";

test("golden edit audit preserves approved-only changes and local reopen bytes", () => {
  const report = runGoldenEditFidelity(undefined, "2026-09-11T17:10:00.000Z");
  expect(report.local).toEqual({passed: true, case_count: 2, exact_outputs: 2, reopened: 2});
  expect(report.cases.map((entry) => entry.id)).toEqual(["markdown-property", "canvas-text-node"]);
  expect(report.cases.every((entry) => entry.local_status === "passed" && entry.exact_output && entry.reopened_locally)).toBe(true);
  expect(report.reference_reopen.status).toBe("external-pending");
  expect(report.release_eligible).toBe(false);
});
