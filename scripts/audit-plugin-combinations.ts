import {resolve} from "node:path";
import {buildPluginCompatibilityMatrix} from "../src/plugins/compatibility-matrix.js";
import {
  buildPluginCombinationEvidence,
  validatePluginCombinationEvidence,
  type BoundedEvidenceBinding,
  type CombinationArtifactEvidence,
  type CombinationCatalogEntry,
  type CombinationD15Evidence,
  type ExistingBoundedCombinationEvidence,
  type PluginCombinationEvidenceConfig,
} from "../src/plugins/plugin-combination-evidence.js";
import {asArray, asRecord, type JsonRecord} from "./json.js";
import {readJson, records, string} from "./plugin-audit-helpers.js";

const root = resolve(import.meta.dir, "..");
const configPath = "fixtures/plugin-combination-audit.json";

function strings(value: unknown): string[] {
  return asArray(value).filter((entry): entry is string => typeof entry === "string");
}

function requiredString(record: JsonRecord, key: string, label: string): string {
  const value = string(record[key]);
  if (!value) throw new Error(`${label} is missing ${key}`);
  return value;
}

function config(): PluginCombinationEvidenceConfig {
  const value = readJson(root, configPath);
  const bindings = records(value.bounded_evidence).map((binding) => {
    const expected = string(binding.expected_status);
    if (expected !== "passed" && expected !== "partial" && expected !== "not-run") throw new Error(`combination binding ${string(binding.catalog_id)} has an invalid expected_status`);
    return {
      catalog_id: requiredString(binding, "catalog_id", "combination binding"),
      source_combination_id: requiredString(binding, "source_combination_id", "combination binding"),
      expected_status: expected,
      ...(string(binding.expected_dependency_artifact) ? {expected_dependency_artifact: string(binding.expected_dependency_artifact)} : {}),
      ...(string(binding.expected_dependency_fixture) ? {expected_dependency_fixture: string(binding.expected_dependency_fixture)} : {}),
    } as BoundedEvidenceBinding;
  });
  return {
    schema_version: value.schema_version === 1 ? 1 : Number(value.schema_version),
    id: requiredString(value, "id", "combination audit fixture"),
    checkpoint: requiredString(value, "checkpoint", "combination audit fixture"),
    decision_id: requiredString(value, "decision_id", "combination audit fixture"),
    boundary: requiredString(value, "boundary", "combination audit fixture"),
    catalog_path: requiredString(value, "catalog_path", "combination audit fixture"),
    lifecycle_evidence_path: requiredString(value, "lifecycle_evidence_path", "combination audit fixture"),
    d15_evidence_path: requiredString(value, "d15_evidence_path", "combination audit fixture"),
    bounded_loaded_evidence_path: requiredString(value, "bounded_loaded_evidence_path", "combination audit fixture"),
    safe_alternatives_attempted: strings(value.safe_alternatives_attempted),
    external_pending: strings(value.external_pending),
    limitation: requiredString(value, "limitation", "combination audit fixture"),
    bounded_evidence: bindings,
  };
}

function catalogCombinations(value: unknown): CombinationCatalogEntry[] {
  return records(value).map((combination) => ({
    id: requiredString(combination, "id", "catalog combination"),
    members: strings(combination.members),
    status: string(combination.status),
  }));
}

function lifecycleEvidence(value: unknown): CombinationArtifactEvidence[] {
  return records(value).map((result) => ({
    artifact_id: requiredString(result, "artifact_id", "lifecycle artifact result"),
    status: requiredString(result, "status", "lifecycle artifact result"),
    denied_capabilities: strings(result.denied_capabilities),
    error: typeof result.error === "string" ? result.error : null,
  }));
}

function d15Evidence(value: JsonRecord): CombinationD15Evidence {
  return {
    safe_alternatives_attempted: strings(value.safe_alternatives_attempted),
    workflow_records: records(value.workflow_records).map((record) => ({
      artifact_id: requiredString(record, "artifact_id", "D15 workflow record"),
      workflow_id: requiredString(record, "workflow_id", "D15 workflow record"),
      denied_capabilities: strings(record.denied_capabilities),
      safe_alternatives_attempted: strings(record.safe_alternatives_attempted),
      visible_compatibility_entry: (() => {
        const entry = asRecord(record.visible_compatibility_entry);
        if (!entry) throw new Error("D15 workflow record is missing visible_compatibility_entry");
        return {
          artifact_id: requiredString(entry, "artifact_id", "D15 visible entry"),
          workflow_id: requiredString(entry, "workflow_id", "D15 visible entry"),
          catalog_path: requiredString(entry, "catalog_path", "D15 visible entry"),
          matrix_source: requiredString(entry, "matrix_source", "D15 visible entry"),
          status: requiredString(entry, "status", "D15 visible entry"),
          visible: entry.visible === true,
        };
      })(),
      disabled_path_test: (() => {
        const test = asRecord(record.disabled_path_test);
        if (!test) throw new Error("D15 workflow record is missing disabled_path_test");
        return {
          id: requiredString(test, "id", "D15 disabled path test"),
          capability: requiredString(test, "capability", "D15 disabled path test"),
          method: requiredString(test, "method", "D15 disabled path test"),
          status: requiredString(test, "status", "D15 disabled path test"),
          artifact_execution: requiredString(test, "artifact_execution", "D15 disabled path test"),
        };
      })(),
      disposition: requiredString(record, "disposition", "D15 workflow record"),
      runtime_disposition: requiredString(record, "runtime_disposition", "D15 workflow record"),
    })),
    disabled_path_checks: records(value.disabled_path_checks).map((check) => ({
      capability: requiredString(check, "capability", "D15 disabled path check"),
      source: requiredString(check, "source", "D15 disabled path check"),
      status: requiredString(check, "status", "D15 disabled path check"),
      marker_capability: requiredString(check, "marker_capability", "D15 disabled path check"),
    })),
    unsupported_security_count: typeof value.unsupported_security_count === "number" ? value.unsupported_security_count : -1,
    all_runtime_dispositions_pending: value.all_runtime_dispositions_pending === true,
  };
}

function boundedEvidence(value: JsonRecord): ExistingBoundedCombinationEvidence[] {
  const loaded = asRecord(value.loaded_workflow_audit);
  return records(loaded?.required_combinations).map((combination) => ({
    id: requiredString(combination, "id", "bounded combination evidence"),
    target_ids: strings(combination.target_ids),
    bounded_lifecycle: string(combination.bounded_lifecycle),
    persistence: string(combination.persistence),
    action_status: string(combination.action_status),
    dependency_status: string(combination.dependency_status),
    vault_writes: typeof combination.vault_writes === "number" ? combination.vault_writes : -1,
    dependency_artifact_id: asRecord(combination.dependency_artifact)?.id === undefined ? null : string(asRecord(combination.dependency_artifact)?.id),
    dependency_fixture_id: asRecord(combination.dependency_fixture)?.id === undefined ? null : string(asRecord(combination.dependency_fixture)?.id),
  }));
}

export function buildPluginCombinationAudit() {
  const auditConfig = config();
  const catalog = readJson(root, "fixtures/plugin-catalog.json");
  const lifecycle = readJson(root, auditConfig.lifecycle_evidence_path);
  const d15 = readJson(root, auditConfig.d15_evidence_path);
  const bounded = readJson(root, auditConfig.bounded_loaded_evidence_path);
  const matrix = buildPluginCompatibilityMatrix(catalog, readJson(root, "fixtures/compatibility-manifest.json"), readJson(root, "fixtures/plugin-isolation.json"));
  const input = {
    config: auditConfig,
    catalogCombinations: catalogCombinations(catalog.combinations),
    lifecycleEvidence: lifecycleEvidence(lifecycle.artifact_results),
    d15Evidence: d15Evidence(d15),
    boundedEvidence: boundedEvidence(bounded),
    boundedBindings: auditConfig.bounded_evidence,
    matrixEntries: matrix.targets.map((target) => ({artifactId: target.artifactId, platform: target.platform, disposition: target.disposition})),
  };
  if (auditConfig.schema_version !== 1 || auditConfig.checkpoint !== "P3.2" || auditConfig.decision_id !== "D15" || auditConfig.boundary !== "electron-renderer") throw new Error("plugin combination audit fixture identity is invalid");
  if (input.d15Evidence.safe_alternatives_attempted.join("|") !== auditConfig.safe_alternatives_attempted.join("|")) throw new Error("D15 safe alternatives do not match the combination audit fixture");
  if (input.catalogCombinations.length !== 7) throw new Error(`expected seven catalog-required combinations, found ${input.catalogCombinations.length}`);
  if (input.d15Evidence.unsupported_security_count !== 0 || input.d15Evidence.all_runtime_dispositions_pending !== true) throw new Error("D15 evidence must remain pending without unsupported-security classification");
  const evidence = buildPluginCombinationEvidence(input);
  const failures = validatePluginCombinationEvidence(evidence, input);
  if (failures.length > 0) throw new Error(failures.join("\n"));
  return evidence;
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(buildPluginCombinationAudit(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({schema_version: 1, status: "failed", command: "bun run audit:plugin-combinations", error: error instanceof Error ? error.message : String(error)}));
    process.exit(1);
  }
}
