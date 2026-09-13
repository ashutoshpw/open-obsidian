import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {buildD15BoundedWorkflowEvidence, validateD15BoundedWorkflowEvidence, type BoundedWorkflowFixture} from "../src/plugins/d15-bounded-workflows.js";

const root = resolve(import.meta.dir, "..");
const fixture = JSON.parse(readFileSync(join(root, "fixtures/plugin-d15-bounded-workflows.json"), "utf8")) as BoundedWorkflowFixture;
const evidence = buildD15BoundedWorkflowEvidence(fixture);
const failures = validateD15BoundedWorkflowEvidence(evidence, fixture);

if (failures.length > 0) {
  console.error(`D15 BOUNDED WORKFLOWS: failed; ${failures.join("; ")}`);
  process.exit(1);
}

console.log(JSON.stringify(evidence, null, 2));
