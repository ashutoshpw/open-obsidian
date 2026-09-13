import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {buildPluginCompatibilityMatrix} from "../src/plugins/compatibility-matrix.js";
import {buildD15BoundedWorkflowEvidence, validateD15BoundedWorkflowEvidence, type BoundedWorkflowEvidence, type BoundedWorkflowFixture} from "../src/plugins/d15-bounded-workflows.js";
import {buildD15WorkflowEvidence, validateD15WorkflowEvidence, type D15ArtifactResult, type D15CatalogEntry, type D15WorkflowConfig} from "../src/plugins/d15-workflow-evidence.js";
import {asArray, asRecord, type JsonRecord} from "./json.js";

const root = resolve(import.meta.dir, "..");
const configPath = "fixtures/plugin-d15-workflows.json";
const artifactEvidencePath = ".agents/tasks/2026-09-09/01-init/evidence/2026-09-11-p3.2-plugin-artifact-lifecycle-v2.json";

function readJson(relativePath: string): JsonRecord {
  const value = JSON.parse(readFileSync(join(root, relativePath), "utf8")) as unknown;
  const record = asRecord(value);
  if (!record) throw new Error(`${relativePath} must contain an object`);
  return record;
}

function strings(value: unknown): string[] {
  return asArray(value).filter((entry): entry is string => typeof entry === "string");
}

function artifactResults(value: unknown): D15ArtifactResult[] {
  return asArray(value).flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) return [];
    const artifactId = typeof record.artifact_id === "string" ? record.artifact_id : "";
    const status = typeof record.status === "string" ? record.status : "";
    return artifactId && status ? [{artifact_id: artifactId, status, denied_capabilities: strings(record.denied_capabilities), error: typeof record.error === "string" ? record.error : null}] : [];
  });
}

function catalogEntries(value: unknown): D15CatalogEntry[] {
  return asArray(value).flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) return [];
    const id = typeof record.id === "string" ? record.id : "";
    const name = typeof record.name === "string" ? record.name : "";
    const workflows = asArray(record.workflows).flatMap((workflow) => {
      const item = asRecord(workflow);
      const workflowId = typeof item?.id === "string" ? item.id : "";
      const description = typeof item?.description === "string" ? item.description : "";
      return workflowId && description ? [{id: workflowId, description}] : [];
    });
    return id && name ? [{id, name, workflows}] : [];
  });
}

export type D15EvidenceWithBoundedWorkflows = ReturnType<typeof buildD15WorkflowEvidence> & {bounded_workflow_projections: BoundedWorkflowEvidence};

export function buildD15Evidence(): D15EvidenceWithBoundedWorkflows {
  const config = readJson(configPath) as unknown as D15WorkflowConfig;
  const artifactEvidence = readJson(artifactEvidencePath);
  const catalog = readJson("fixtures/plugin-catalog.json");
  const results = artifactResults(artifactEvidence.artifact_results);
  const entries = catalogEntries(catalog.entries);
  const input = {config, artifactResults: results, catalogEntries: entries};
  const evidence = buildD15WorkflowEvidence(input);
  const failures = validateD15WorkflowEvidence(evidence, input);
  const matrix = buildPluginCompatibilityMatrix(catalog, readJson("fixtures/compatibility-manifest.json"), readJson("fixtures/plugin-isolation.json"));
  const matrixFailures = evidence.candidate_artifact_ids.flatMap((artifactId) => {
    const cells = matrix.targets.filter((target) => target.artifactId === artifactId);
    return cells.length === 3 && cells.every((cell) => cell.disposition === "pending-runtime") ? [] : [`${artifactId} is missing three visible pending-runtime matrix cells`];
  });
  failures.push(...matrixFailures);
  if (failures.length > 0) throw new Error(failures.join("\n"));
  const boundedFixture = readJson("fixtures/plugin-d15-bounded-workflows.json") as unknown as BoundedWorkflowFixture;
  const boundedEvidence = buildD15BoundedWorkflowEvidence(boundedFixture);
  const boundedFailures = validateD15BoundedWorkflowEvidence(boundedEvidence, boundedFixture);
  if (boundedFailures.length > 0) throw new Error(boundedFailures.join("\n"));
  return {...evidence, bounded_workflow_projections: boundedEvidence};
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(buildD15Evidence(), null, 2));
  } catch (error) {
    console.error(`D15 WORKFLOW EVIDENCE: failed; ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
