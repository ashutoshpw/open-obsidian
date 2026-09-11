import {expect, test} from "bun:test";
import {createPluginCompatibilityMatrix} from "../scripts/validate-plugin-matrix.js";
import {PLUGIN_LIFECYCLE_CHECKS, PLUGIN_PLATFORMS, validatePluginCompatibilityMatrix} from "../src/plugins/compatibility-matrix.js";

test("compatibility matrix covers every pinned target on every desktop platform", () => {
  const matrix = createPluginCompatibilityMatrix();
  expect(matrix.mandatoryTargetIds).toHaveLength(25);
  expect(matrix.dependencyTargetIds).toHaveLength(2);
  expect(matrix.targets).toHaveLength(81);
  expect([...new Set(matrix.targets.map((target) => target.artifactId))]).toHaveLength(27);
  expect(new Set(matrix.targets.map((target) => target.platform))).toEqual(new Set(PLUGIN_PLATFORMS));
  expect(validatePluginCompatibilityMatrix(matrix)).toEqual([]);
});

test("runtime and lifecycle claims remain pending until unchanged artifacts execute safely", () => {
  const matrix = createPluginCompatibilityMatrix();
  const sample = matrix.targets.find((target) => target.artifactId === "PC03" && target.platform === "macOS");
  expect(sample?.disposition).toBe("pending-runtime");
  expect(Object.keys(sample?.lifecycle ?? {})).toEqual([...PLUGIN_LIFECYCLE_CHECKS]);
  expect(Object.values(sample?.lifecycle ?? {}).every((status) => status === "pending-runtime")).toBe(true);
  expect(Object.values(sample?.workflowEvidence ?? {}).every((status) => status === "pending-runtime")).toBe(true);
  expect(sample?.deniedCapabilities).toContain("process.spawn");
});
