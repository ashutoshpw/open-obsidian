import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {buildPluginCompatibilityMatrix, PLUGIN_LIFECYCLE_CHECKS, PLUGIN_PLATFORMS, validatePluginCompatibilityMatrix} from "../src/plugins/compatibility-matrix.js";
import {asRecord, type JsonRecord} from "./json.js";

const root = resolve(import.meta.dir, "..");

function readJson(relativePath: string): JsonRecord {
  const parsed: unknown = JSON.parse(readFileSync(join(root, relativePath), "utf8"));
  const value = asRecord(parsed);
  if (!value) throw new Error(`${relativePath} must contain a JSON object`);
  return value;
}

export function createPluginCompatibilityMatrix(): ReturnType<typeof buildPluginCompatibilityMatrix> {
  return buildPluginCompatibilityMatrix(readJson("fixtures/plugin-catalog.json"), readJson("fixtures/compatibility-manifest.json"), readJson("fixtures/plugin-isolation.json"));
}

function main(): number {
  const matrix = createPluginCompatibilityMatrix();
  const failures = validatePluginCompatibilityMatrix(matrix);
  if (failures.length > 0) {
    failures.forEach((failure) => console.error(`PLUGIN MATRIX ERROR: ${failure}`));
    return 1;
  }
  console.log(`PLUGIN MATRIX CHECK: passed; ${matrix.mandatoryTargetIds.length} mandatory targets + ${matrix.dependencyTargetIds.length} dependencies, ${matrix.targets.length} platform cells, ${PLUGIN_LIFECYCLE_CHECKS.length} lifecycle checks, ${PLUGIN_PLATFORMS.length} platforms; all runtime dispositions remain pending-runtime`);
  return 0;
}

if (import.meta.main) process.exit(main());
