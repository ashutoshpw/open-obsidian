import {expect, test} from "bun:test";
import {validateInputMatrix} from "../scripts/validate-input-matrix.js";

test("C10 input matrix keeps local traces and external popout handoff explicit", () => {
  const result = validateInputMatrix();
  expect(result.failures).toEqual([]);
  expect(result.implemented).toBe(4);
  expect(result.externalPending).toBe(1);
});
