import {expect, test} from "bun:test";
import {validateCoreWorkflowFixture} from "../scripts/validate-core-workflows.js";

test("C10 core workflow inventory is complete and honest", () => {
  const result = validateCoreWorkflowFixture();
  expect(result.failures).toEqual([]);
  expect(result.implemented).toBe(13);
  expect(result.incomplete).toBe(0);
  expect(result.deferred).toBe(3);
});
