import {expect, test} from "bun:test";
import {validateUXSurfaces} from "../scripts/validate-ux-surfaces.js";

test("named UX surface fixture is backed by renderer markers or explicit handoffs", () => {
  const result = validateUXSurfaces();
  expect(result.failures).toEqual([]);
  expect(result.implemented).toBeGreaterThanOrEqual(10);
  expect(result.externalPending).toBeGreaterThanOrEqual(3);
});
