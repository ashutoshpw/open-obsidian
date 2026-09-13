export type CombinationCatalogEntry = {
  id: string;
  members: string[];
  status: string;
};

export type CombinationArtifactEvidence = {
  artifact_id: string;
  status: string;
  denied_capabilities: string[];
  error?: string | null;
};

export type CombinationD15WorkflowRecord = {
  artifact_id: string;
  workflow_id: string;
  denied_capabilities: string[];
  safe_alternatives_attempted: string[];
  visible_compatibility_entry: {
    artifact_id: string;
    workflow_id: string;
    catalog_path: string;
    matrix_source: string;
    status: string;
    visible: boolean;
  };
  disabled_path_test: {
    id: string;
    capability: string;
    method: string;
    status: string;
    artifact_execution: string;
  };
  disposition: string;
  runtime_disposition: string;
};

export type CombinationD15DisabledPathCheck = {
  capability: string;
  source: string;
  status: string;
  marker_capability: string;
};

export type CombinationD15Evidence = {
  safe_alternatives_attempted: string[];
  workflow_records: CombinationD15WorkflowRecord[];
  disabled_path_checks: CombinationD15DisabledPathCheck[];
  unsupported_security_count: number;
  all_runtime_dispositions_pending: boolean;
};

export type ExistingBoundedCombinationEvidence = {
  id: string;
  target_ids: string[];
  bounded_lifecycle: string;
  persistence: string;
  action_status: string;
  dependency_status: string;
  vault_writes: number;
  dependency_artifact_id?: string | null;
  dependency_fixture_id?: string | null;
  recovery_status?: string | null;
  automatic_writers_disabled?: boolean | null;
  persisted_state_deterministic?: boolean | null;
  recovery_member_count?: number | null;
  [key: string]: unknown;
};

export type BoundedEvidenceBinding = {
  catalog_id: string;
  source_combination_id: string;
  expected_status: "passed" | "partial" | "not-run";
  expected_dependency_artifact?: string;
  expected_dependency_fixture?: string;
};

export type CombinationMatrixEntry = {
  artifactId: string;
  platform: string;
  disposition: string;
};

export type PluginCombinationEvidenceConfig = {
  schema_version: number;
  id: string;
  checkpoint: string;
  decision_id: string;
  boundary: string;
  catalog_path: string;
  lifecycle_evidence_path: string;
  d15_evidence_path: string;
  bounded_loaded_evidence_path: string;
  safe_alternatives_attempted: string[];
  external_pending: string[];
  limitation: string;
  bounded_evidence: BoundedEvidenceBinding[];
};

export type CombinationDisabledPathTest = {
  artifact_id: string;
  workflow_id: string;
  id: string;
  capability: string;
  method: string;
  status: string;
  artifact_execution: string;
};

export type CombinationDisabledPathCheck = {
  capability: string;
  source: string;
  status: string;
  marker_capability: string;
};

export type CombinationVisibleMatrixEntry = {
  artifact_id: string;
  platform: string;
  disposition: "pending-runtime";
  visible: true;
};

export type CombinationBoundedEvidence = {
  status: "passed" | "partial" | "not-run";
  source_combination_id: string | null;
  bounded_lifecycle: string | null;
  persistence: string | null;
  action_status: string | null;
  dependency_status: string | null;
  vault_writes: number | null;
  dependency_artifact_id: string | null;
  dependency_fixture_id: string | null;
  recovery_status: string | null;
  automatic_writers_disabled: boolean | null;
  persisted_state_deterministic: boolean | null;
  recovery_member_count: number | null;
  expected_status: "passed" | "partial" | "not-run" | null;
  note: string;
};

export type PluginCombinationRecord = {
  id: string;
  members: string[];
  target_ids: string[];
  catalog_status: string;
  artifact_evidence: CombinationArtifactEvidence[];
  denied_components: string[];
  denied_capabilities: string[];
  safe_alternatives_attempted: string[];
  disabled_path_tests: CombinationDisabledPathTest[];
  disabled_path_checks: CombinationDisabledPathCheck[];
  visible_compatibility_entries: CombinationD15WorkflowRecord["visible_compatibility_entry"][];
  visible_pending_matrix_entries: CombinationVisibleMatrixEntry[];
  bounded_evidence: CombinationBoundedEvidence;
  disposition: "candidate-denial" | "candidate-pending";
  runtime_disposition: "pending-runtime";
  unsupported_security: false;
  no_plugin_promoted: true;
};

export type PluginCombinationEvidence = {
  schema_version: 1;
  id: "fixture:plugin-combination-audit";
  checkpoint: "P3.2";
  decision_id: "D15";
  boundary: "electron-renderer";
  status: "partial";
  catalog_combination_ids: string[];
  combination_count: number;
  combinations: PluginCombinationRecord[];
  candidate_denial_count: number;
  candidate_pending_count: number;
  bounded_pass_count: number;
  unsupported_security_count: 0;
  all_catalog_combinations_covered: true;
  all_runtime_dispositions_pending: true;
  no_plugin_promoted: true;
  source_evidence: {
    catalog: string;
    lifecycle: string;
    d15: string;
    bounded_loaded: string;
  };
  safe_alternatives_attempted: string[];
  external_pending: string[];
  limitation: string;
  result: string;
};

export type PluginCombinationEvidenceInput = {
  config: PluginCombinationEvidenceConfig;
  catalogCombinations: CombinationCatalogEntry[];
  lifecycleEvidence: CombinationArtifactEvidence[];
  d15Evidence: CombinationD15Evidence;
  boundedEvidence: ExistingBoundedCombinationEvidence[];
  boundedBindings: BoundedEvidenceBinding[];
  matrixEntries: CombinationMatrixEntry[];
};

const deniedStatuses = new Set(["renderer-denied", "denied-security"]);

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function sameStrings(actual: string[], expected: string[]): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function artifactById(results: CombinationArtifactEvidence[], id: string): CombinationArtifactEvidence {
  const result = results.find((candidate) => candidate.artifact_id === id);
  if (!result) throw new Error(`combination evidence is missing lifecycle result for ${id}`);
  return result;
}

function boundedResult(
  combination: CombinationCatalogEntry,
  bindings: BoundedEvidenceBinding[],
  existing: ExistingBoundedCombinationEvidence[],
): CombinationBoundedEvidence {
  const binding = bindings.find((candidate) => candidate.catalog_id === combination.id);
  if (!binding) {
    return {
      status: "not-run",
      source_combination_id: null,
      bounded_lifecycle: null,
      persistence: null,
      action_status: null,
      dependency_status: null,
      vault_writes: null,
      dependency_artifact_id: null,
      dependency_fixture_id: null,
      recovery_status: null,
      automatic_writers_disabled: null,
      persisted_state_deterministic: null,
      recovery_member_count: null,
      expected_status: null,
      note: "No bounded loaded-workflow trace is recorded for this catalog combination.",
    };
  }
  const source = existing.find((candidate) => candidate.id === binding.source_combination_id);
  if (!source) {
    return {
      status: "not-run",
      source_combination_id: binding.source_combination_id,
      bounded_lifecycle: null,
      persistence: null,
      action_status: null,
      dependency_status: null,
      vault_writes: null,
      dependency_artifact_id: null,
      dependency_fixture_id: null,
      recovery_status: null,
      automatic_writers_disabled: null,
      persisted_state_deterministic: null,
      recovery_member_count: null,
      expected_status: binding.expected_status,
      note: `Bounded source combination ${binding.source_combination_id} is missing from the loaded-workflow evidence.`,
    };
  }
  const passed = source.bounded_lifecycle === "complete"
    && source.persistence === "preserved"
    && source.action_status === "passed"
    && source.dependency_status === "verified"
    && source.vault_writes === 0
    && source.recovery_status === "passed"
    && source.automatic_writers_disabled === true
    && source.persisted_state_deterministic === true
    && source.recovery_member_count === source.target_ids.length;
  const status = passed ? "passed" : "partial";
  return {
    status,
    source_combination_id: source.id,
    bounded_lifecycle: source.bounded_lifecycle,
    persistence: source.persistence,
    action_status: source.action_status,
    dependency_status: source.dependency_status,
    vault_writes: source.vault_writes,
    dependency_artifact_id: source.dependency_artifact_id ?? null,
    dependency_fixture_id: source.dependency_fixture_id ?? null,
    recovery_status: source.recovery_status ?? null,
    automatic_writers_disabled: source.automatic_writers_disabled ?? null,
    persisted_state_deterministic: source.persisted_state_deterministic ?? null,
    recovery_member_count: source.recovery_member_count ?? null,
    expected_status: binding.expected_status,
    note: passed
      ? "Bounded synthetic lifecycle, persistence, dependency, deterministic deny-clear-return recovery and zero-vault-write checks pass; runtime compatibility remains pending."
      : "A bounded loaded-workflow record exists, but one or more lifecycle, persistence, dependency, recovery or zero-vault-write checks remain partial.",
  };
}

function matrixEntriesFor(matrixEntries: CombinationMatrixEntry[], artifactId: string): CombinationVisibleMatrixEntry[] {
  return matrixEntries
    .filter((entry) => entry.artifactId === artifactId)
    .map((entry) => {
      if (entry.disposition !== "pending-runtime") throw new Error(`${artifactId}/${entry.platform} is not visible as pending-runtime`);
      return entry;
    })
    .map((entry) => ({artifact_id: entry.artifactId, platform: entry.platform, disposition: "pending-runtime" as const, visible: true as const}));
}

function disabledPathTestsFor(records: CombinationD15WorkflowRecord[], deniedCapabilities: string[]): CombinationDisabledPathTest[] {
  return records
    .filter((record) => deniedCapabilities.includes(record.disabled_path_test.capability))
    .map((record) => ({
      artifact_id: record.artifact_id,
      workflow_id: record.workflow_id,
      id: record.disabled_path_test.id,
      capability: record.disabled_path_test.capability,
      method: record.disabled_path_test.method,
      status: record.disabled_path_test.status,
      artifact_execution: record.disabled_path_test.artifact_execution,
    }));
}

export function buildPluginCombinationEvidence(input: PluginCombinationEvidenceInput): PluginCombinationEvidence {
  const d15Records = input.d15Evidence.workflow_records;
  const combinations = input.catalogCombinations.map((combination) => {
    if (!combination.id) throw new Error("catalog combination is missing an id");
    if (combination.members.length === 0 || new Set(combination.members).size !== combination.members.length) throw new Error(`${combination.id} must declare unique members`);
    const artifacts = combination.members.map((id) => artifactById(input.lifecycleEvidence, id));
    const deniedComponents = artifacts.filter((artifact) => deniedStatuses.has(artifact.status)).map((artifact) => artifact.artifact_id);
    const deniedCapabilities = unique(artifacts.flatMap((artifact) => deniedStatuses.has(artifact.status) ? artifact.denied_capabilities : []));
    const deniedRecords = d15Records.filter((record) => deniedComponents.includes(record.artifact_id));
    if (deniedComponents.some((artifactId) => !deniedRecords.some((record) => record.artifact_id === artifactId))) throw new Error(`${combination.id} is missing D15 workflow evidence for a denied component`);
    const safeAlternatives = deniedRecords.length > 0
      ? unique(deniedRecords.flatMap((record) => record.safe_alternatives_attempted))
      : [...input.config.safe_alternatives_attempted];
    const matrix = combination.members.flatMap((id) => matrixEntriesFor(input.matrixEntries, id));
    const bounded = boundedResult(combination, input.boundedBindings, input.boundedEvidence);
    return {
      id: combination.id,
      members: [...combination.members],
      target_ids: [...combination.members],
      catalog_status: combination.status,
      artifact_evidence: artifacts.map((artifact) => ({...artifact, denied_capabilities: [...artifact.denied_capabilities]})),
      denied_components: deniedComponents,
      denied_capabilities: deniedCapabilities,
      safe_alternatives_attempted: safeAlternatives,
      disabled_path_tests: disabledPathTestsFor(deniedRecords, deniedCapabilities),
      disabled_path_checks: input.d15Evidence.disabled_path_checks.filter((check) => deniedCapabilities.includes(check.capability)).map((check) => ({...check})),
      visible_compatibility_entries: deniedRecords.map((record) => ({...record.visible_compatibility_entry})),
      visible_pending_matrix_entries: matrix,
      bounded_evidence: bounded,
      disposition: deniedComponents.length > 0 ? "candidate-denial" as const : "candidate-pending" as const,
      runtime_disposition: "pending-runtime" as const,
      unsupported_security: false as const,
      no_plugin_promoted: true as const,
    };
  });
  const candidateDenialCount = combinations.filter((combination) => combination.disposition === "candidate-denial").length;
  const boundedPassCount = combinations.filter((combination) => combination.bounded_evidence.status === "passed").length;
  return {
    schema_version: 1,
    id: "fixture:plugin-combination-audit",
    checkpoint: "P3.2",
    decision_id: "D15",
    boundary: "electron-renderer",
    status: "partial",
    catalog_combination_ids: combinations.map((combination) => combination.id),
    combination_count: combinations.length,
    combinations,
    candidate_denial_count: candidateDenialCount,
    candidate_pending_count: combinations.length - candidateDenialCount,
    bounded_pass_count: boundedPassCount,
    unsupported_security_count: 0,
    all_catalog_combinations_covered: true,
    all_runtime_dispositions_pending: true,
    no_plugin_promoted: true,
    source_evidence: {
      catalog: input.config.catalog_path,
      lifecycle: input.config.lifecycle_evidence_path,
      d15: input.config.d15_evidence_path,
      bounded_loaded: input.config.bounded_loaded_evidence_path,
    },
    safe_alternatives_attempted: [...input.config.safe_alternatives_attempted],
    external_pending: [...input.config.external_pending],
    limitation: input.config.limitation,
    result: `All ${combinations.length} catalog-required combinations are visible with ${candidateDenialCount} candidate-denial/pending-runtime dispositions and ${boundedPassCount} bounded synthetic passes; no compatibility status or unsupported-security exception was promoted.`,
  };
}

function validateBoundedEvidence(record: PluginCombinationRecord, binding: BoundedEvidenceBinding | undefined): string[] {
  if (!binding) {
    return record.bounded_evidence.status === "not-run" ? [] : [`${record.id} has bounded evidence without a fixture binding`];
  }
  const failures: string[] = [];
  if (record.bounded_evidence.expected_status !== binding.expected_status) failures.push(`${record.id} bounded evidence expected status does not match its binding`);
  if (record.bounded_evidence.status !== binding.expected_status) failures.push(`${record.id} bounded evidence status ${record.bounded_evidence.status} does not match ${binding.expected_status}`);
  if (binding.expected_status === "passed" && record.bounded_evidence.vault_writes !== 0) failures.push(`${record.id} bounded pass must record zero vault writes`);
  if (binding.expected_dependency_artifact && record.bounded_evidence.dependency_artifact_id !== binding.expected_dependency_artifact) failures.push(`${record.id} bounded evidence is missing dependency artifact ${binding.expected_dependency_artifact}`);
  if (binding.expected_dependency_fixture && record.bounded_evidence.dependency_fixture_id !== binding.expected_dependency_fixture) failures.push(`${record.id} bounded evidence is missing dependency fixture ${binding.expected_dependency_fixture}`);
  return failures;
}

export function validatePluginCombinationEvidence(
  evidence: PluginCombinationEvidence,
  input: PluginCombinationEvidenceInput,
): string[] {
  const failures: string[] = [];
  const expectedIds = input.catalogCombinations.map((combination) => combination.id);
  if (evidence.schema_version !== 1 || evidence.id !== input.config.id || evidence.checkpoint !== input.config.checkpoint || evidence.decision_id !== input.config.decision_id || evidence.boundary !== input.config.boundary) failures.push("plugin combination evidence identity is invalid");
  if (evidence.status !== "partial") failures.push("plugin combination evidence must remain partial");
  if (!sameStrings(evidence.catalog_combination_ids, expectedIds) || evidence.combination_count !== expectedIds.length) failures.push("catalog combination coverage or ordering is incomplete");
  if (evidence.combinations.length !== expectedIds.length || new Set(evidence.combinations.map((combination) => combination.id)).size !== evidence.combinations.length) failures.push("plugin combination evidence contains duplicate or missing combinations");
  if (evidence.unsupported_security_count !== 0 || evidence.all_runtime_dispositions_pending !== true || evidence.no_plugin_promoted !== true || evidence.all_catalog_combinations_covered !== true) failures.push("plugin combination evidence must remain pending without promotion or unsupported-security classification");
  const lifecycleById = new Map(input.lifecycleEvidence.map((result) => [result.artifact_id, result]));
  evidence.combinations.forEach((record, index) => {
    const catalog = input.catalogCombinations[index];
    if (!catalog || record.id !== catalog.id || !sameStrings(record.members, catalog.members) || !sameStrings(record.target_ids, catalog.members)) {
      failures.push(`${record.id || "combination"} does not match catalog member ordering`);
      return;
    }
    const expectedArtifacts = catalog.members.map((id) => lifecycleById.get(id));
    if (expectedArtifacts.some((artifact) => artifact === undefined)) failures.push(`${record.id} references a member without lifecycle evidence`);
    const expectedDenied = expectedArtifacts.filter((artifact): artifact is CombinationArtifactEvidence => artifact !== undefined && deniedStatuses.has(artifact.status)).map((artifact) => artifact.artifact_id);
    if (!sameStrings(record.denied_components, expectedDenied)) failures.push(`${record.id} denied component coverage does not match lifecycle evidence`);
    const expectedCapabilities = unique(expectedArtifacts.flatMap((artifact) => artifact && deniedStatuses.has(artifact.status) ? artifact.denied_capabilities : []));
    if (!sameStrings(record.denied_capabilities, expectedCapabilities)) failures.push(`${record.id} denied capability coverage does not match lifecycle evidence`);
    if (record.runtime_disposition !== "pending-runtime" || record.no_plugin_promoted !== true || record.unsupported_security !== false) failures.push(`${record.id} has a promoted or non-pending disposition`);
    const deniedWorkflowRecords = input.d15Evidence.workflow_records.filter((workflow) => expectedDenied.includes(workflow.artifact_id));
    const expectedAlternatives = deniedWorkflowRecords.length > 0
      ? unique(deniedWorkflowRecords.flatMap((workflow) => workflow.safe_alternatives_attempted))
      : [...input.config.safe_alternatives_attempted];
    if (!sameStrings(record.safe_alternatives_attempted, expectedAlternatives)) failures.push(`${record.id} safe alternatives do not match D15 evidence`);
    deniedWorkflowRecords.forEach((workflow) => {
      const visible = workflow.visible_compatibility_entry;
      if (visible.artifact_id !== workflow.artifact_id || visible.workflow_id !== workflow.workflow_id || visible.status !== "pending-runtime" || visible.visible !== true) failures.push(`${record.id} has an invalid visible pending entry for ${workflow.artifact_id}/${workflow.workflow_id}`);
      if (workflow.disposition !== "candidate-denial" || workflow.runtime_disposition !== "pending-runtime") failures.push(`${record.id} has a promoted D15 workflow record for ${workflow.artifact_id}/${workflow.workflow_id}`);
    });
    const expectedVisibleIds = deniedWorkflowRecords.map((workflow) => `${workflow.artifact_id}/${workflow.workflow_id}`);
    const actualVisibleIds = record.visible_compatibility_entries.map((entry) => `${entry.artifact_id}/${entry.workflow_id}`);
    if (!sameStrings(actualVisibleIds, expectedVisibleIds)) failures.push(`${record.id} visible compatibility workflow entries are incomplete`);
    const expectedMatrixCount = catalog.members.reduce((count, id) => count + input.matrixEntries.filter((entry) => entry.artifactId === id).length, 0);
    if (record.visible_pending_matrix_entries.length !== expectedMatrixCount || record.visible_pending_matrix_entries.some((entry) => entry.disposition !== "pending-runtime" || entry.visible !== true)) failures.push(`${record.id} visible pending matrix entries are incomplete`);
    const deniedRecordIds = new Set(input.d15Evidence.workflow_records.filter((workflow) => expectedDenied.includes(workflow.artifact_id)).map((workflow) => `${workflow.artifact_id}/${workflow.workflow_id}`));
    const actualDisabledIds = new Set(record.disabled_path_tests.map((test) => `${test.artifact_id}/${test.workflow_id}`));
    if (expectedDenied.some((artifactId) => !input.d15Evidence.workflow_records.some((workflow) => workflow.artifact_id === artifactId))) failures.push(`${record.id} is missing D15 records for a denied component`);
    if (deniedRecordIds.size !== actualDisabledIds.size || [...deniedRecordIds].some((id) => !actualDisabledIds.has(id))) failures.push(`${record.id} disabled-path workflow coverage is incomplete`);
    record.disabled_path_tests.forEach((test) => {
      if (test.status !== "passed" || test.artifact_execution !== "not-executed" || !record.denied_capabilities.includes(test.capability)) failures.push(`${record.id} has an invalid disabled-path test for ${test.capability}`);
    });
    const expectedDisabledCapabilities = new Set(record.denied_capabilities);
    const actualDisabledCapabilities = new Set(record.disabled_path_checks.map((check) => check.capability));
    if (expectedDisabledCapabilities.size !== actualDisabledCapabilities.size || [...expectedDisabledCapabilities].some((capability) => !actualDisabledCapabilities.has(capability))) failures.push(`${record.id} disabled-path capability checks are incomplete`);
    record.disabled_path_checks.forEach((check) => {
      if (check.status !== "passed" || check.marker_capability !== check.capability || !record.denied_capabilities.includes(check.capability)) failures.push(`${record.id} has an invalid disabled-path capability check for ${check.capability}`);
    });
    failures.push(...validateBoundedEvidence(record, input.boundedBindings.find((binding) => binding.catalog_id === record.id)));
  });
  if (evidence.candidate_denial_count !== evidence.combinations.filter((combination) => combination.disposition === "candidate-denial").length) failures.push("candidate-denial count is incorrect");
  if (evidence.candidate_pending_count !== evidence.combinations.filter((combination) => combination.disposition === "candidate-pending").length) failures.push("candidate-pending count is incorrect");
  if (evidence.bounded_pass_count !== evidence.combinations.filter((combination) => combination.bounded_evidence.status === "passed").length) failures.push("bounded pass count is incorrect");
  if (evidence.safe_alternatives_attempted.length !== input.config.safe_alternatives_attempted.length || !sameStrings(evidence.safe_alternatives_attempted, input.config.safe_alternatives_attempted)) failures.push("safe alternatives do not match the audit fixture");
  return failures;
}
