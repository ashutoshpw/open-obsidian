import {expect, test} from "bun:test";
import {runCompatibilityCoverageAudit} from "../scripts/audit-compatibility-coverage.js";

test("compatibility coverage enumerates every mandatory cell and separates dispositions", () => {
  const {report, failures} = runCompatibilityCoverageAudit();
  expect(failures).toEqual([]);
  expect(report.mandatoryTargetIds).toHaveLength(25);
  expect(report.dependencyTargetIds).toHaveLength(2);
  expect(report.cells).toHaveLength(81);
  expect(report.cells.filter((cell) => cell.mandatory)).toHaveLength(75);
  expect(report.counts).toEqual({passing: 0, failing: 0, untested: 81, "unsupported-security": 0});
  expect(report.unassessedMandatoryCells).toBe(0);
  expect(report.noUnassessedMandatoryCells).toBe(true);
  expect(new Set(report.cells.map((cell) => cell.status))).toEqual(new Set(["untested"]));
});
