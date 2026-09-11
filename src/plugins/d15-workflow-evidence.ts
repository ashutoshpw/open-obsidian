import {scanPluginBundle} from "./bundle-prescreen.js";

export type D15WorkflowConfig = {
  schema_version: number;
  id: string;
  checkpoint: string;
  decision_id: string;
  boundary: string;
  required_record_fields: string[];
  safe_alternatives_attempted: string[];
  disabled_path_sources: Record<string, string>;
  visible_entry: {
    catalog_path: string;
    matrix_source: string;
    status: string;
    visible: boolean;
  };
  status_policy: {
    candidate_disposition: string;
    runtime_disposition: string;
    unsupported_security_requires: string[];
    ordinary_failures_are_not_security_exceptions: boolean;
  };
};

export type D15ArtifactResult = {
  artifact_id: string;
  status: string;
  denied_capabilities: string[];
  error?: string | null;
};

export type D15CatalogWorkflow = {
  id: string;
  description: string;
};

export type D15CatalogEntry = {
  id: string;
  name: string;
  workflows: D15CatalogWorkflow[];
};

export type D15WorkflowRecord = {
  artifact_id: string;
  workflow_id: string;
  workflow_description: string;
  reproduction: string;
  denied_capabilities: string[];
  safe_alternatives_attempted: string[];
  visible_compatibility_entry: {
    artifact_id: string;
    workflow_id: string;
    catalog_path: string;
    matrix_source: string;
    status: "pending-runtime";
    visible: true;
  };
  disabled_path_test: {
    id: string;
    capability: string;
    method: "synthetic denied-capability contract";
    status: "passed";
    artifact_execution: "not-executed";
  };
  disposition: "candidate-denial";
  runtime_disposition: "pending-runtime";
};

export type D15WorkflowEvidence = {
  schema_version: 1;
  id: "fixture:d15-exception-contract";
  checkpoint: "P3.2";
  decision_id: "D15";
  boundary: "electron-renderer";
  source_artifact_evidence: string;
  candidate_artifact_ids: string[];
  workflow_records: D15WorkflowRecord[];
  disabled_path_checks: Array<{
    capability: string;
    source: string;
    status: "passed";
    marker_capability: string;
  }>;
  candidate_count: number;
  unsupported_security_count: 0;
  all_runtime_dispositions_pending: true;
  safe_alternatives_attempted: string[];
  visible_compatibility_entry: D15WorkflowRecord["visible_compatibility_entry"];
  external_pending: string[];
  limitation: string;
};

export type D15EvidenceValidationInput = {
  config: D15WorkflowConfig;
  artifactResults: D15ArtifactResult[];
  catalogEntries: D15CatalogEntry[];
};

const requiredCapabilities = new Set([
  "filesystem.direct",
  "network.request",
  "process.spawn",
  "credentials.read",
  "dom.privileged",
  "native.abi",
  "code.dynamic",
]);

function candidateResults(results: D15ArtifactResult[]): D15ArtifactResult[] {
  return results.filter((result) => result.status === "renderer-denied");
}

function entryById(entries: D15CatalogEntry[], artifactId: string): D15CatalogEntry {
  const entry = entries.find((candidate) => candidate.id === artifactId);
  if (!entry) throw new Error(`D15 catalog entry is missing for ${artifactId}`);
  if (entry.workflows.length === 0) throw new Error(`D15 catalog entry has no workflow for ${artifactId}`);
  return entry;
}

function firstCapability(result: D15ArtifactResult): string {
  const capability = result.denied_capabilities.find((value) => requiredCapabilities.has(value));
  if (!capability) throw new Error(`D15 artifact ${result.artifact_id} has no recognized denied capability`);
  return capability;
}

function workflowRecord(config: D15WorkflowConfig, result: D15ArtifactResult, entry: D15CatalogEntry, workflow: D15CatalogWorkflow): D15WorkflowRecord {
  const capability = firstCapability(result);
  const error = result.error ?? `renderer denied ${capability}`;
  return {
    artifact_id: result.artifact_id,
    workflow_id: workflow.id,
    workflow_description: workflow.description,
    reproduction: `Unchanged ${result.artifact_id} reached the renderer denial while exercising ${workflow.id}; denied capabilities: ${result.denied_capabilities.join(", ")}; ${error}`,
    denied_capabilities: [...result.denied_capabilities],
    safe_alternatives_attempted: [...config.safe_alternatives_attempted],
    visible_compatibility_entry: {
      artifact_id: result.artifact_id,
      workflow_id: workflow.id,
      catalog_path: config.visible_entry.catalog_path,
      matrix_source: config.visible_entry.matrix_source,
      status: "pending-runtime",
      visible: true,
    },
    disabled_path_test: {
      id: `d15-disabled:${result.artifact_id}:${workflow.id}`,
      capability,
      method: "synthetic denied-capability contract",
      status: "passed",
      artifact_execution: "not-executed",
    },
    disposition: "candidate-denial",
    runtime_disposition: "pending-runtime",
  };
}

function failure(condition: boolean, message: string): string[] {
  return condition ? [message] : [];
}

function includesEvery(value: string, expected: string[]): boolean {
  return expected.every((part) => value.includes(part));
}

function visibleEntryMatches(record: D15WorkflowRecord): boolean {
  const entry = record.visible_compatibility_entry;
  return [entry.visible, entry.status === "pending-runtime", entry.artifact_id === record.artifact_id, entry.workflow_id === record.workflow_id].every(Boolean);
}

function disabledPathMatches(record: D15WorkflowRecord, capability: string): boolean {
  const test = record.disabled_path_test;
  return [test.status === "passed", test.artifact_execution === "not-executed", test.capability === capability].every(Boolean);
}

function pendingDisposition(record: D15WorkflowRecord): boolean {
  return [record.disposition === "candidate-denial", record.runtime_disposition === "pending-runtime"].every(Boolean);
}

function validateWorkflowRecord(record: D15WorkflowRecord, denied: D15ArtifactResult[], config: D15WorkflowConfig): string[] {
  const artifact = denied.find((candidate) => candidate.artifact_id === record.artifact_id);
  if (!artifact) return [`D15 workflow record references a non-denied artifact ${record.artifact_id}`];
  const capability = firstCapability(artifact);
  return [
    ...failure(!includesEvery(record.reproduction, [record.artifact_id, record.workflow_id, capability]), `D15 reproduction is not specific for ${record.artifact_id}/${record.workflow_id}`),
    ...failure(JSON.stringify(record.denied_capabilities) !== JSON.stringify(artifact.denied_capabilities), `D15 denied capabilities do not match lifecycle evidence for ${record.artifact_id}`),
    ...failure(JSON.stringify(record.safe_alternatives_attempted) !== JSON.stringify(config.safe_alternatives_attempted), `D15 alternatives are incomplete for ${record.artifact_id}/${record.workflow_id}`),
    ...failure(!visibleEntryMatches(record), `D15 visible compatibility entry is invalid for ${record.artifact_id}/${record.workflow_id}`),
    ...failure(!disabledPathMatches(record, capability), `D15 disabled-path test is invalid for ${record.artifact_id}/${record.workflow_id}`),
    ...failure(!pendingDisposition(record), `D15 status was promoted for ${record.artifact_id}/${record.workflow_id}`),
  ];
}

function validateDisabledPathCheck(check: D15WorkflowEvidence["disabled_path_checks"][number]): string[] {
  const marker = scanPluginBundle(check.source).markers.find((candidate) => candidate.capability === check.capability);
  return failure(check.status !== "passed" || check.marker_capability !== check.capability || !marker, `D15 synthetic disabled-path test failed for ${check.capability}`);
}

export function buildD15WorkflowEvidence(input: D15EvidenceValidationInput): D15WorkflowEvidence {
  const denied = candidateResults(input.artifactResults);
  const workflowRecords = denied.flatMap((result) => {
    const entry = entryById(input.catalogEntries, result.artifact_id);
    return entry.workflows.map((workflow) => workflowRecord(input.config, result, entry, workflow));
  });
  const disabledPathChecks = [...new Set(workflowRecords.flatMap((record) => record.denied_capabilities))].map((capability) => {
    const source = input.config.disabled_path_sources[capability];
    if (!source) throw new Error(`D15 disabled-path source is missing for ${capability}`);
    const scan = scanPluginBundle(source);
    const marker = scan.markers.find((candidate) => candidate.capability === capability);
    if (!marker) throw new Error(`D15 disabled-path source does not emit ${capability}`);
    return {capability, source, status: "passed" as const, marker_capability: marker.capability};
  });
  const visible = workflowRecords[0]?.visible_compatibility_entry;
  if (!visible) throw new Error("D15 evidence has no denied workflow records");
  return {
    schema_version: 1,
    id: "fixture:d15-exception-contract",
    checkpoint: "P3.2",
    decision_id: "D15",
    boundary: "electron-renderer",
    source_artifact_evidence: ".agents/tasks/2026-09-09/01-init/evidence/2026-09-11-p3.2-plugin-artifact-lifecycle-v2.json",
    candidate_artifact_ids: denied.map((result) => result.artifact_id),
    workflow_records: workflowRecords,
    disabled_path_checks: disabledPathChecks,
    candidate_count: denied.length,
    unsupported_security_count: 0,
    all_runtime_dispositions_pending: true,
    safe_alternatives_attempted: [...input.config.safe_alternatives_attempted],
    visible_compatibility_entry: visible,
    external_pending: [
      "macOS and Windows renderer/OS enforcement",
      "reference Obsidian workflow behavior",
      "unchanged artifact settings, views, combinations and lifecycle certification",
    ],
    limitation: "The generated records prove the local renderer denial contract and synthetic disabled paths only. They keep every candidate pending-runtime and do not certify an unsupported-security exception.",
  };
}

export function validateD15WorkflowEvidence(evidence: D15WorkflowEvidence, input: D15EvidenceValidationInput): string[] {
  const failures: string[] = [];
  const denied = candidateResults(input.artifactResults);
  const deniedIds = denied.map((result) => result.artifact_id);
  if (evidence.id !== input.config.id) failures.push("D15 evidence fixture id does not match the contract");
  if (evidence.schema_version !== 1 || evidence.checkpoint !== "P3.2" || evidence.decision_id !== "D15") failures.push("D15 evidence identity is invalid");
  if (evidence.boundary !== input.config.boundary) failures.push("D15 evidence boundary does not match the contract");
  if (evidence.candidate_count !== denied.length) failures.push(`D15 candidate count ${evidence.candidate_count} does not match ${denied.length} renderer denials`);
  if (JSON.stringify(evidence.candidate_artifact_ids) !== JSON.stringify(deniedIds)) failures.push("D15 candidate artifact ordering does not match lifecycle evidence");
  if (evidence.unsupported_security_count !== 0 || evidence.all_runtime_dispositions_pending !== true) failures.push("D15 evidence must remain pending without unsupported-security classification");
  if (JSON.stringify(evidence.safe_alternatives_attempted) !== JSON.stringify(input.config.safe_alternatives_attempted)) failures.push("D15 safe alternatives do not match the contract");
  if (new Set(evidence.workflow_records.map((record) => `${record.artifact_id}/${record.workflow_id}`)).size !== evidence.workflow_records.length) failures.push("D15 workflow evidence contains duplicate records");
  const expectedRecords = denied.flatMap((result) => entryById(input.catalogEntries, result.artifact_id).workflows.map((workflow) => `${result.artifact_id}/${workflow.id}`));
  const actualRecords = evidence.workflow_records.map((record) => `${record.artifact_id}/${record.workflow_id}`);
  if (JSON.stringify(actualRecords) !== JSON.stringify(expectedRecords)) failures.push("D15 workflow record ordering or coverage does not match the catalog");
  evidence.workflow_records.forEach((record) => failures.push(...validateWorkflowRecord(record, denied, input.config)));
  const expectedDisabledCapabilities = [...new Set(denied.flatMap((result) => result.denied_capabilities))].sort();
  const actualDisabledCapabilities = evidence.disabled_path_checks.map((check) => check.capability).sort();
  if (JSON.stringify(actualDisabledCapabilities) !== JSON.stringify(expectedDisabledCapabilities)) failures.push("D15 disabled-path capability coverage is incomplete");
  evidence.disabled_path_checks.forEach((check) => failures.push(...validateDisabledPathCheck(check)));
  return failures;
}
