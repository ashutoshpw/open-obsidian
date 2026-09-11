import {expect, test} from "bun:test";
import {QUICK_CHECKS} from "../scripts/check-fast.js";

test("fast check covers routine quality gates without packaging", () => {
  const ids = QUICK_CHECKS.map((check) => check.id);
  expect(ids).toEqual(["state", "contracts", "plugin-matrix", "architecture", "surfaces", "version-baseline", "differential", "entry-points", "paid-service-boundary", "workflows", "input-matrix", "comparison-scorecard", "accessibility", "layout", "typecheck", "tests", "knip", "fallow-changed"]);
  expect(QUICK_CHECKS.some((check) => check.args.includes("compile"))).toBe(false);
  expect(QUICK_CHECKS.some((check) => check.args.includes("package:dir"))).toBe(false);
  expect(QUICK_CHECKS.some((check) => check.args.includes("quality"))).toBe(false);
});
