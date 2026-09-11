import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {buildPluginCompatibilityCoverageReport, validatePluginCompatibilityCoverage, type CompatibilityCoverageFixture} from "../src/plugins/compatibility-matrix.js";
import {createPluginCompatibilityMatrix} from "./validate-plugin-matrix.js";

const root = resolve(import.meta.dir, "..");

export function readCompatibilityCoverageFixture(): CompatibilityCoverageFixture {
  return JSON.parse(readFileSync(`${root}/fixtures/compatibility-coverage.json`, "utf8")) as CompatibilityCoverageFixture;
}

export function runCompatibilityCoverageAudit() {
  const matrix = createPluginCompatibilityMatrix();
  const report = buildPluginCompatibilityCoverageReport(matrix);
  const failures = validatePluginCompatibilityCoverage(report, readCompatibilityCoverageFixture());
  return {report, failures};
}

if (import.meta.main) {
  const {report, failures} = runCompatibilityCoverageAudit();
  console.log(JSON.stringify(report, null, 2));
  if (failures.length > 0) {
    failures.forEach((failure) => console.error(`COMPATIBILITY COVERAGE ERROR: ${failure}`));
    process.exit(1);
  }
  console.log(`COMPATIBILITY COVERAGE: passed; ${report.mandatoryTargetIds.length} mandatory targets, ${report.cells.filter((cell) => cell.mandatory).length} explicit mandatory cells, counts=${JSON.stringify(report.counts)}`);
}
