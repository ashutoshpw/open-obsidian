import {expect, test} from "bun:test";
import {buildD15Evidence} from "../scripts/validate-plugin-d15.js";

test("D15 workflow evidence covers every renderer-denied candidate without promotion", () => {
  const evidence = buildD15Evidence();
  expect(evidence.id).toBe("fixture:d15-exception-contract");
  expect(evidence.candidate_count).toBe(23);
  expect(evidence.workflow_records).toHaveLength(23);
  expect(evidence.disabled_path_checks).toHaveLength(7);
  expect(evidence.unsupported_security_count).toBe(0);
  expect(evidence.all_runtime_dispositions_pending).toBe(true);
  expect(evidence.workflow_records.every((record) => record.disposition === "candidate-denial")).toBe(true);
  expect(evidence.workflow_records.every((record) => record.runtime_disposition === "pending-runtime")).toBe(true);
  expect(evidence.workflow_records.every((record) => record.visible_compatibility_entry.visible && record.visible_compatibility_entry.status === "pending-runtime")).toBe(true);
  expect(evidence.workflow_records.every((record) => record.disabled_path_test.status === "passed" && record.disabled_path_test.artifact_execution === "not-executed")).toBe(true);
});
