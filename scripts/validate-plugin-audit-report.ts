import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {asArray, asRecord} from "./json.js";

const root = resolve(import.meta.dir, "..");
const EXPECTED_RENDERER_ARTIFACT_IDS = [
  "PC01", "PC02", "PC03", "PC04", "PC05", "PC06", "PC07", "PC08", "PC09", "PC10",
  "PC11", "PC12", "PC13", "PC14", "PC15", "PC16", "PC17", "PC18", "PC19", "PC20",
  "PC21", "PC22", "PC23", "PC24", "PC25", "PC-DEP-MINIMAL", "PC-DEP-TEXT-EXTRACTOR",
];
const EXPECTED_LOADED_ARTIFACT_IDS = [
  "PC02", "PC03", "PC04", "PC05", "PC06", "PC07", "PC08", "PC09", "PC10", "PC11",
  "PC12", "PC14", "PC15", "PC17", "PC19", "PC20", "PC21", "PC22", "PC23", "PC24", "PC25",
];
const EXPECTED_PRIMARY_COMBINATION_ID = "combination:pc07-pc21-pc23";
const EXPECTED_REQUIRED_COMBINATION_IDS = [
  "combination:pc08-pc17-minimal",
  "combination:pc19-bases",
  "combination:pc15-text-extractor",
];
const BOUNDED_LIFECYCLE_CHECKS = [
  "loaded", "workflow_supported", "required_phases", "version_progression", "lifecycle_started",
  "settings_registration_recorded", "views_registration_recorded", "command_attempts_recorded",
  "settings_attempts_recorded", "views_attempts_recorded", "event_attempts_recorded", "clipboard_bounded",
  "clipboard_external_writes_zero", "cleanup_after_each_phase", "uninstall_clears_registrations",
  "return_to_obsidian", "no_vault_writes",
];
const TASK_WORKFLOW_CHECKS = [
  "present", "bounded_revision_aware", "query_matched", "bases_mappings_present", "source_revision_matched",
  "stale_revision_rejected", "status_updated", "task_checkbox_updated", "unrelated_content_preserved",
  "revision_advanced", "direct_vault_writes_zero", "status_passed",
];
const OMNISEARCH_WORKFLOW_CHECKS = [
  "present", "bounded_read_only", "relevance_ordered", "exact_search_results_match", "typo_tolerant",
  "phrase_search_match", "keyboard_navigation_match", "link_insertion_match", "index_refresh_detected",
  "text_extractor_dependency_configured", "text_extractor_dependency_verified", "text_extractor_paths_match",
  "source_preserved", "unrelated_file_preserved", "direct_vault_writes_zero", "phase_projections_passed", "status_passed",
];
const ARTIFACT_PASS_CHECKS: Record<string, {field: string; keys: string[]}> = {
  PC24: {field: "tag_workflow_checks", keys: ["present", "bounded_editor_mutation", "rename_scoped", "merge_deterministic", "hierarchical_occurrences_preserved", "unrelated_properties_preserved", "unrelated_text_preserved", "undo_restores_prior_bytes", "redo_restores_command_bytes", "plugin_rename_callback_not_invoked", "direct_vault_writes_zero"]},
  PC23: {field: "recent_files_workflow_checks", keys: ["present", "bounded_read_only", "stale_entries_removed", "rename_entry_updated", "delete_entry_removed", "retained_entry_preserved", "order_preserved", "max_length_preserved", "direct_vault_writes_zero"]},
  PC17: {field: "minimal_settings_workflow_checks", keys: ["present", "bounded_read_only", "settings_applied", "theme_detected", "css_variables_preserved", "light_mode_rendered", "dark_mode_rendered", "hotkeys_preserved", "restart_restores_settings", "update_restores_settings", "direct_vault_writes_zero", "status_passed"]},
  PC21: {field: "homepage_workflow_checks", keys: ["present", "bounded_read_only", "startup_target_restored", "target_exists", "settings_preserved", "view_state_restored", "direct_vault_writes_zero", "status_passed"]},
  PC08: {field: "style_settings_workflow_checks", keys: ["present", "bounded_read_only", "settings_applied", "definitions_registered", "compact_applied", "accent_applied", "source_preserved", "light_mode_rendered", "dark_mode_rendered", "popout_rendered", "restart_restores_settings", "update_restores_settings", "direct_vault_writes_zero", "status_passed"]},
  PC07: {field: "calendar_workflow_checks", keys: ["present", "bounded_read_only", "week_start_applied", "locale_applied", "daily_note_path_matches", "daily_existing_opened", "daily_created_in_projection", "daily_date_format_preserved", "daily_template_applied", "weekly_note_path_matches", "weekly_note_created_in_projection", "weekly_date_format_preserved", "weekly_template_applied", "weekly_integration_recorded", "weekly_integration_disposition_recorded", "navigation_deterministic", "direct_vault_writes_zero", "status_passed"]},
  PC22: {field: "smart_connections_workflow_checks", keys: ["present", "bounded_read_only", "local_model_provenance_verified", "indexed_paths_match", "excluded_paths_match", "exclusions_enforced", "remote_fallback_disabled", "remote_fallback_not_used", "import_queue_disabled", "embed_queue_disabled", "bounded_scope", "direct_vault_writes_zero", "status_passed"]},
  PC25: {field: "linter_workflow_checks", keys: ["present", "bounded_read_only", "first_open_noop", "explicit_command_configured", "explicit_output_match", "configured_yaml_output_match", "configured_markdown_output_match", "lint_on_save_matches", "only_expected_target_affected", "direct_vault_writes_zero", "status_passed"]},
  PC19: {field: "task_workflow_checks", keys: TASK_WORKFLOW_CHECKS},
  PC04: {field: "tasks_workflow_checks", keys: ["present", "bounded_read_only", "query_parsed", "query_matched", "filter_applied", "rows_match", "sorted_by_due", "group_by_status", "groups_match", "create_task_projected", "complete_task_projected", "status_markers_preserved", "dates_preserved", "recurrence_round_tripped", "source_note_update_surgical", "unrelated_content_preserved", "revision_advanced", "direct_vault_writes_zero", "status_passed"]},
  PC05: {field: "table_workflow_checks", keys: ["present", "bounded_read_only", "source_path_match", "navigation_recorded", "headers_match", "row_count_match", "edit_projected", "calculation_match", "formatting_applied", "serialization_match", "unrelated_content_preserved", "untouched_file_preserved", "settings_applied", "direct_vault_writes_zero", "phase_projections_passed", "status_passed"]},
  PC03: {field: "dataview_workflow_checks", keys: ["present", "bounded_read_only", "query_parsed", "table_query", "columns_resolved", "fields_resolved", "rows_match", "links_resolved", "tasks_detected", "refresh_after_external_edit", "dataviewjs_denied", "direct_vault_writes_zero", "phase_projections_passed", "status_passed"]},
  PC06: {field: "git_workflow_checks", keys: ["present", "bounded_read_only", "repository_detected", "status_observed", "diff_projected", "commit_selection_valid", "pull_explicit", "push_explicit", "credential_helper_preserved", "credential_helper_not_read", "automatic_push_disabled", "scheduled_pull_preserved", "scheduled_push_not_configured", "schedule_disposition_recorded", "conflict_protected", "conflict_versions_preserved", "denied_operations_recorded", "process_spawn_denied", "credential_read_denied", "direct_vault_writes_zero", "status_passed"]},
  PC09: {field: "kanban_workflow_checks", keys: ["present", "bounded_read_only", "source_path_match", "board_parsed", "frontmatter_matches", "lanes_match", "card_count_match", "move_projected", "edit_projected", "lane_order_preserved", "metadata_preserved", "links_preserved", "source_preserved", "serialization_match", "reopened", "unrelated_content_preserved", "direct_vault_writes_zero", "phase_projections_passed", "status_passed"]},
  PC02: {field: "templater_workflow_checks", keys: ["present", "bounded_read_only", "template_parsed", "dynamic_values_resolved", "include_resolved", "prompt_value_applied", "cursor_preserved", "output_generated", "note_created_projected", "move_projected", "source_preserved", "unrelated_file_preserved", "dynamic_script_denied", "system_command_denied", "no_dynamic_execution", "direct_vault_writes_zero", "status_passed"]},
  PC12: {field: "quickadd_workflow_checks", keys: ["present", "bounded_read_only", "capture_choice_configured", "template_expanded", "generated_file_output", "prompt_order_recorded", "prompt_order_preserved", "command_order_recorded", "command_order_preserved", "macro_order_recorded", "macro_order_preserved", "linked_script_denied", "no_dynamic_execution", "source_preserved", "unrelated_file_preserved", "direct_vault_writes_zero", "status_passed"]},
  PC14: {field: "editing_toolbar_workflow_checks", keys: ["present", "bounded_read_only", "toolbar_rendered", "selection_edits_match", "customization_persisted", "customization_restored_on_restart", "customization_restored_on_update", "source_mode_behavior", "live_preview_behavior", "popout_behavior", "source_preserved", "unrelated_file_preserved", "direct_vault_writes_zero", "phase_projections_passed", "status_passed"]},
  PC15: {field: "omnisearch_workflow_checks", keys: OMNISEARCH_WORKFLOW_CHECKS},
  PC10: {field: "remotely_save_workflow_checks", keys: ["present", "bounded_read_only", "backend_configured", "live_contact_disabled", "network_denied", "credential_read_denied", "denied_operations_recorded", "network_contacted_zero", "credentials_read_zero", "text_sync_plan_recorded", "binary_sync_plan_recorded", "sync_plans_recorded", "interrupted_transfer_resumed", "rename_projected", "delete_projected", "rename_delete_handled", "encryption_metadata_preserved", "conflict_protected", "conflict_versions_retained", "version_retention_preserved", "unrelated_content_preserved", "direct_vault_writes_zero", "status_passed"]},
  PC11: {field: "iconize_workflow_checks", keys: ["present", "bounded_read_only", "file_assignment_preserved", "folder_assignment_preserved", "rules_preserved", "file_rename_projected", "folder_rename_projected", "asset_resolved", "sidebar_rendered", "tab_rendered", "restart_restores_assignments", "update_restores_assignments", "unrelated_content_preserved", "direct_vault_writes_zero", "status_passed"]},
};

function requireCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readExpectedJson(relativePath: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolve(root, relativePath), "utf8")) as unknown;
  } catch (error) {
    throw new Error(`${label} fixture is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const record = asRecord(parsed);
  requireCondition(record !== null, `${label} fixture must contain a JSON object`);
  return record;
}

function requireExactIds(label: string, actualIds: unknown[], expectedIds: string[]): void {
  requireCondition(actualIds.length === expectedIds.length, `${label} count does not match its fixture (${actualIds.length} != ${expectedIds.length})`);
  const actual = new Set<string>();
  for (const value of actualIds) {
    requireCondition(nonEmptyString(value), `${label} contains an empty or non-string ID`);
    requireCondition(!actual.has(value), `${label} contains duplicate ID ${value}`);
    actual.add(value);
  }
  const expected = new Set(expectedIds);
  const missing = expectedIds.filter((id) => !actual.has(id));
  const unexpected = [...actual].filter((id) => !expected.has(id));
  requireCondition(missing.length === 0 && unexpected.length === 0, `${label} IDs differ from fixture; missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}`);
}

function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => equalJson(value, right[index]));
  }
  const leftRecord = asRecord(left);
  const rightRecord = asRecord(right);
  if (leftRecord === null || rightRecord === null) return false;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && equalJson(leftRecord[key], rightRecord[key]));
}

function requireStringArray(value: unknown, label: string): void {
  requireCondition(Array.isArray(value) && value.every((item) => typeof item === "string"), `${label} must be an array of strings`);
}

function requireBooleanRecord(value: unknown, label: string): void {
  const record = asRecord(value);
  requireCondition(record !== null && Object.keys(record).length > 0, `${label} must be a non-empty object`);
  requireCondition(Object.values(record).every((item) => typeof item === "boolean"), `${label} must contain only boolean values`);
}

function requireExactTrueBooleanRecord(value: unknown, label: string, expectedKeys: string[]): void {
  const record = asRecord(value);
  requireCondition(record !== null, `${label} must be an object`);
  const actualKeys = Object.keys(record).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  requireCondition(actualKeys.length === sortedExpectedKeys.length && actualKeys.every((key, index) => key === sortedExpectedKeys[index]), `${label} fields differ from the evidence contract`);
  requireCondition(sortedExpectedKeys.every((key) => record[key] === true), `${label} contains missing or failed required checks`);
}

function lifecycleChecksPass(value: unknown, label: string): boolean {
  const checks = asRecord(value);
  if (checks === null || !BOUNDED_LIFECYCLE_CHECKS.every((name) => checks[name] === true)) return false;
  const restart = checks.restart_restores_data === true || checks.restart_restores_persisted_data === true || checks.restart_restores_scoped_data === true;
  const update = checks.update_restores_data === true || checks.update_restores_persisted_data === true || checks.update_restores_scoped_data === true;
  requireCondition(restart && update, `${label} does not prove persisted data survives restart and update`);
  return true;
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function requireSpecificChecks(value: unknown, label: string): void {
  const record = asRecord(value);
  requireCondition(record !== null && Object.keys(record).length > 0, `${label} must be a non-empty object`);
  for (const [name, check] of Object.entries(record)) {
    if (check === null || typeof check === "boolean") continue;
    const nested = asRecord(check);
    requireCondition(nested !== null && Object.keys(nested).length > 0, `${label}.${name} must be null, boolean, or a non-empty boolean object`);
    requireCondition(Object.values(nested).every((item) => typeof item === "boolean"), `${label}.${name} must contain only boolean values`);
  }
}

function validatePluginResult(value: unknown, label: string): void {
  const result = asRecord(value);
  requireCondition(result !== null, `${label} must be an object`);
  requireCondition(["loaded", "denied", "failed"].includes(String(result.status)), `${label}.status is unknown`);
  for (const field of ["enforcement", "coverage", "exportKind"]) requireCondition(nonEmptyString(result[field]), `${label}.${field} must be a non-empty string`);
  requireStringArray(result.requiredModules, `${label}.requiredModules`);
  requireStringArray(result.deniedCapabilities, `${label}.deniedCapabilities`);
  if (result.deniedPaths !== undefined) requireStringArray(result.deniedPaths, `${label}.deniedPaths`);
  requireCondition(asRecord(result.workflow) !== null, `${label}.workflow must be an object`);
}

function validateCombinationDependencies(value: unknown, definition: Record<string, unknown>, label: string): void {
  const dependencies = asRecord(value);
  requireCondition(dependencies !== null && Array.isArray(dependencies.artifacts) && Array.isArray(dependencies.fixtures), `${label}.dependencies must include artifact and fixture arrays`);

  const expectedArtifacts = asArray(definition.dependency_artifacts).map(asRecord);
  requireCondition(expectedArtifacts.every((item) => item !== null), `${label} fixture has malformed dependency artifact definitions`);
  const actualArtifacts = asArray(dependencies.artifacts).map(asRecord);
  requireCondition(actualArtifacts.every((item) => item !== null), `${label}.dependencies.artifacts contains a malformed row`);
  const expectedArtifactIds = expectedArtifacts.map((item) => item?.artifact_id);
  const actualArtifactIds = actualArtifacts.map((item) => item?.artifact_id);
  requireCondition(expectedArtifactIds.every(nonEmptyString), `${label} fixture has an invalid dependency artifact ID`);
  requireExactIds(`${label}.dependencies.artifacts`, actualArtifactIds, expectedArtifactIds as string[]);
  for (const expected of expectedArtifacts) {
    if (expected === null) continue;
    const id = expected.artifact_id as string;
    const actual = actualArtifacts.find((item) => item?.artifact_id === id);
    requireCondition(actual !== null && actual !== undefined && nonEmptyString(actual.name) && nonEmptyString(actual.version), `${label} dependency ${id} is missing artifact metadata`);
    const expectedAssets = asArray(expected.assets);
    requireStringArray(expectedAssets, `${label} fixture dependency ${id}.assets`);
    const actualAssets = asArray(actual.assets).map(asRecord);
    requireCondition(actualAssets.every((item) => item !== null), `${label} dependency ${id} has a malformed asset row`);
    requireExactIds(`${label} dependency ${id} assets`, actualAssets.map((item) => item?.name), expectedAssets as string[]);
    for (const asset of actualAssets) {
      if (asset === null) continue;
      requireCondition(Number.isSafeInteger(asset.bytes) && (asset.bytes as number) >= 0 && validSha256(asset.sha256), `${label} dependency ${id} asset metadata is invalid`);
    }
  }

  const expectedFixtures = asArray(definition.dependency_fixtures).map(asRecord);
  requireCondition(expectedFixtures.every((item) => item !== null), `${label} fixture has malformed dependency fixture definitions`);
  const actualFixtures = asArray(dependencies.fixtures).map(asRecord);
  requireCondition(actualFixtures.every((item) => item !== null), `${label}.dependencies.fixtures contains a malformed row`);
  const expectedFixtureIds = expectedFixtures.map((item) => item?.fixture_id);
  const actualFixtureIds = actualFixtures.map((item) => item?.fixture_id);
  requireCondition(expectedFixtureIds.every(nonEmptyString), `${label} fixture has an invalid dependency fixture ID`);
  requireExactIds(`${label}.dependencies.fixtures`, actualFixtureIds, expectedFixtureIds as string[]);
  for (const expected of expectedFixtures) {
    if (expected === null) continue;
    const id = expected.fixture_id as string;
    const actual = actualFixtures.find((item) => item?.fixture_id === id);
    requireCondition(actual !== null && actual !== undefined && actual.complete === true, `${label} dependency fixture ${id} is incomplete`);
    const expectedPaths = asArray(expected.paths);
    requireStringArray(expectedPaths, `${label} fixture dependency ${id}.paths`);
    const actualPaths = asArray(actual.paths).map(asRecord);
    requireCondition(actualPaths.every((item) => item !== null), `${label} dependency fixture ${id} has a malformed path row`);
    requireExactIds(`${label} dependency fixture ${id} paths`, actualPaths.map((item) => item?.path), expectedPaths as string[]);
    for (const path of actualPaths) {
      if (path === null) continue;
      requireCondition(path.present === true && Number.isSafeInteger(path.bytes) && (path.bytes as number) >= 0 && validSha256(path.sha256), `${label} dependency fixture ${id} path metadata is invalid`);
    }
  }
}

function validateLoadedArtifactRow(value: unknown, index: number): void {
  const label = `loaded-plugin artifact_results row ${index + 1}`;
  const row = asRecord(value);
  requireCondition(row !== null, `${label} must be an object`);
  requireCondition(nonEmptyString(row.artifact_id), `${label}.artifact_id must be a non-empty string`);
  requireCondition(typeof row.name === "string" && typeof row.version === "string", `${label} must contain string name and version fields`);
  requireCondition(row.integrity === "passed", `${label}.integrity must be passed`);
  requireStringArray(row.denied_capabilities, `${label}.denied_capabilities`);
  validatePluginResult(row.result, `${label}.result`);
  requireBooleanRecord(row.checks, `${label}.checks`);
  const recovery = asRecord(row.denial_recovery_checks);
  requireCondition(recovery !== null && typeof recovery.passed === "boolean" && nonEmptyString(recovery.status), `${label}.denial_recovery_checks must include status and passed`);
  requireCondition(row.bounded_lifecycle === "complete" || row.bounded_lifecycle === "partial", `${label}.bounded_lifecycle is invalid`);
  requireCondition(row.persistence === "preserved" || row.persistence === "not-proven", `${label}.persistence is invalid`);
  requireCondition(["plugin-data-save", "mediated-plugin-data-store", "not-proven"].includes(String(row.persistence_source)), `${label}.persistence_source is invalid`);
  requireCondition(row.action_status === "passed" || row.action_status === "partial", `${label}.action_status is invalid`);
  requireCondition(Array.isArray(row.action_failures), `${label}.action_failures must be an array`);
  requireBooleanRecord(row.editor_checks, `${label}.editor_checks`);
  requireCondition(nonEmptyString(row.disposition), `${label}.disposition must be a non-empty string`);
}

function validateLoadedCombinationRow(
  value: unknown,
  index: number,
  expectedTargetIds: Map<string, string[]>,
  expectedDefinitions: Map<string, {definition: Record<string, unknown>; scenarioId: string}>,
): void {
  const label = `loaded-plugin combinations row ${index + 1}`;
  const row = asRecord(value);
  requireCondition(row !== null, `${label} must be an object`);
  requireCondition(nonEmptyString(row.id) && nonEmptyString(row.scenario_id), `${label} must include id and scenario_id`);
  requireStringArray(row.target_ids, `${label}.target_ids`);
  requireCondition((row.target_ids as string[]).length > 0 && (row.target_ids as string[]).every(nonEmptyString), `${label}.target_ids must not be empty`);
  const expectedTargets = expectedTargetIds.get(row.id as string);
  const expectedCombination = expectedDefinitions.get(row.id as string);
  requireCondition(expectedTargets !== undefined, `${label}.id is not defined by the workflow fixture`);
  requireCondition(expectedCombination !== undefined, `${label}.id has no fixture definition`);
  requireExactIds(`${label}.target_ids`, row.target_ids, expectedTargets);
  requireCondition(row.scenario_id === expectedCombination.scenarioId, `${label}.scenario_id differs from its workflow fixture`);
  validateCombinationDependencies(row.dependencies, expectedCombination.definition, label);
  validatePluginResult(row.result, `${label}.result`);
  requireBooleanRecord(row.checks, `${label}.checks`);
  requireCondition(row.bounded_lifecycle === "complete" || row.bounded_lifecycle === "partial", `${label}.bounded_lifecycle is invalid`);
  requireCondition(row.persistence === "preserved" || row.persistence === "not-proven", `${label}.persistence is invalid`);
  requireCondition(["plugin-data-save", "mediated-plugin-data-store", "not-proven"].includes(String(row.persistence_source)), `${label}.persistence_source is invalid`);
  requireCondition(row.vault_writes === null || typeof row.vault_writes === "number", `${label}.vault_writes must be a number or null`);
  requireCondition(row.action_status === "passed" || row.action_status === "partial", `${label}.action_status is invalid`);
  requireCondition(Array.isArray(row.action_failures), `${label}.action_failures must be an array`);
  requireBooleanRecord(row.editor_checks, `${label}.editor_checks`);
  requireSpecificChecks(row.specific_checks, `${label}.specific_checks`);
  requireCondition(row.dependency_status === "verified" || row.dependency_status === "partial", `${label}.dependency_status is invalid`);
  const recovery = asRecord(row.combination_recovery);
  requireCondition(recovery !== null && nonEmptyString(recovery.state_marker), `${label}.combination_recovery must include a state marker`);
  validatePluginResult(recovery.result, `${label}.combination_recovery.result`);
  const recoveryChecks = asRecord(recovery.checks);
  requireCondition(recoveryChecks !== null && typeof recoveryChecks.passed === "boolean", `${label}.combination_recovery.checks must include passed`);
  requireCondition(nonEmptyString(row.disposition), `${label}.disposition must be a non-empty string`);
}

function validatePassedArtifactRow(value: unknown, index: number): void {
  const label = `passed loaded-plugin artifact_results row ${index + 1}`;
  const row = asRecord(value);
  requireCondition(row !== null, `${label} must be an object`);
  requireCondition(asRecord(row.result)?.status === "loaded", `${label} result is not loaded`);
  requireCondition(lifecycleChecksPass(row.checks, `${label}.checks`), `${label} lifecycle or persistence checks are incomplete`);
  const contract = ARTIFACT_PASS_CHECKS[String(row.artifact_id)];
  if (contract !== undefined) requireExactTrueBooleanRecord(row[contract.field], `${label}.${contract.field}`, contract.keys);
}

function validatePassedCombinationRow(value: unknown, index: number, recoveryProbe: Record<string, unknown>): void {
  const label = `passed loaded-plugin combinations row ${index + 1}`;
  const row = asRecord(value);
  requireCondition(row !== null, `${label} must be an object`);
  requireCondition(asRecord(row.result)?.status === "loaded", `${label} result is not loaded`);
  requireCondition(lifecycleChecksPass(row.checks, `${label}.checks`), `${label} lifecycle or persistence checks are incomplete`);
  const specific = asRecord(row.specific_checks);
  requireCondition(specific !== null, `${label}.specific_checks must be an object`);
  requireExactIds(`${label}.specific_checks fields`, Object.keys(specific), [
    "task_workflow_checks", "task_workflow_complete", "omnisearch_workflow_checks", "omnisearch_workflow_complete",
  ]);
  const targetIds = asArray(row.target_ids).filter((item): item is string => typeof item === "string");
  if (targetIds.includes("PC19")) {
    requireExactTrueBooleanRecord(specific.task_workflow_checks, `${label}.specific_checks.task_workflow_checks`, TASK_WORKFLOW_CHECKS);
  } else {
    requireCondition(specific.task_workflow_checks === null, `${label} has unexpected TaskNotes checks`);
  }
  if (targetIds.includes("PC15")) {
    requireExactTrueBooleanRecord(specific.omnisearch_workflow_checks, `${label}.specific_checks.omnisearch_workflow_checks`, OMNISEARCH_WORKFLOW_CHECKS);
  } else {
    requireCondition(specific.omnisearch_workflow_checks === null, `${label} has unexpected Omnisearch checks`);
  }
  requireCondition(specific.task_workflow_complete === true && specific.omnisearch_workflow_complete === true, `${label} has incomplete plugin-specific checks`);
  const recovery = asRecord(row.combination_recovery);
  requireCondition(asRecord(recovery?.checks)?.passed === true, `${label} recovery checks are incomplete`);
  requireCondition(recovery?.state_marker === recoveryProbe.state_marker, `${label} recovery marker differs from its workflow fixture`);

  const deniedCapability = recoveryProbe.denied_capability;
  requireCondition(nonEmptyString(deniedCapability), `${label} workflow fixture has no recovery denied capability`);
  const recoveryResult = asRecord(recovery?.result);
  requireCondition(recoveryResult !== null && recoveryResult.status === "denied", `${label} recovery result did not deny the configured capability`);
  requireStringArray(recoveryResult.deniedCapabilities, `${label}.combination_recovery.result.deniedCapabilities`);
  requireCondition((recoveryResult.deniedCapabilities as string[]).includes(deniedCapability), `${label} recovery result did not report ${deniedCapability}`);

  const recoveryWorkflow = asRecord(recoveryResult.workflow);
  const rawProbe = asRecord(recoveryWorkflow?.recovery_probe);
  const rawRecovery = asRecord(recoveryWorkflow?.denial_recovery);
  const writerPolicy = asRecord(recoveryWorkflow?.automatic_writer_policy);
  const checks = asRecord(recovery?.checks);
  requireCondition(rawProbe !== null
    && rawProbe.denied_capability === deniedCapability
    && rawProbe.trigger === recoveryProbe.trigger
    && rawProbe.state_marker === recoveryProbe.state_marker
    && rawProbe.mutation_scope === recoveryProbe.mutation_scope, `${label} recovery result does not match the configured probe`);
  requireCondition(rawRecovery !== null
    && rawRecovery.status === "passed"
    && rawRecovery.mutation_scope === "bounded-denial-recovery"
    && rawRecovery.trigger === "d15-capability-denial"
    && rawRecovery.registrations_cleared === true
    && rawRecovery.remaining_registrations === 0
    && asRecord(rawRecovery.registrations_before)?.commands === (row.target_ids as string[]).length
    && asRecord(rawRecovery.registrations_before)?.commandHandlers === (row.target_ids as string[]).length
    && rawRecovery.active_plugin_after_recovery === false
    && rawRecovery.return_to_obsidian === true
    && rawRecovery.direct_vault_writes === 0
    && rawRecovery.direct_vault_writes_zero === true
    && rawRecovery.artifact_execution === "not-executed-after-denial", `${label} recovery result has incomplete denial or cleanup evidence`);
  requireCondition(checks !== null
    && checks.status === "passed"
    && checks.passed === true
    && checks.trigger === "d15-capability-denial"
    && checks.registrations_cleared === true
    && checks.return_to_obsidian === true
    && checks.active_plugin_after_recovery_cleared === true
    && checks.direct_vault_writes_zero === true
    && checks.artifact_execution === "not-executed-after-denial"
    && checks.denied_capability === deniedCapability
    && checks.denied_capability_observed === true
    && checks.probe_configured === true
    && checks.automatic_writers_disabled === true
    && checks.persisted_state_deterministic === true, `${label} recovery summary does not confirm all required checks`);
  requireCondition(writerPolicy?.disabled_by_default === true, `${label} recovery result does not disable automatic writers`);

  const targetIds = row.target_ids as string[];
  const persistence = asRecord(rawRecovery.persistence);
  const persisted = asRecord(persistence?.persisted_data_by_plugin);
  const saved = asRecord(persistence?.saved_data_by_plugin);
  const markerName = recoveryProbe.state_marker as string;
  requireCondition(persistence?.deterministic === true && persisted !== null && saved !== null, `${label} recovery persistence is not deterministic`);
  for (const targetId of targetIds) {
    const persistedPlugin = asRecord(persisted[targetId]);
    const savedPlugin = asRecord(saved[targetId]);
    const persistedMarker = asRecord(persistedPlugin?.[markerName]);
    const savedMarker = asRecord(savedPlugin?.[markerName]);
    requireCondition(persistedPlugin !== null
      && savedPlugin !== null
      && persistedMarker !== null
      && savedMarker !== null
      && equalJson(persistedPlugin, savedPlugin)
      && persistedMarker.plugin_id === targetId
      && savedMarker?.plugin_id === targetId
      && persistedMarker.writer_mode === "disabled"
      && savedMarker.writer_mode === "disabled"
      && persistedMarker.recovery === "pre-denial"
      && savedMarker.recovery === "pre-denial", `${label} recovery persistence marker is missing or inconsistent for ${targetId}`);
  }
}

function validateRendererRow(value: unknown, index: number): void {
  const label = `renderer JSONL row ${index + 1}`;
  const row = asRecord(value);
  requireCondition(row !== null, `${label} must contain a JSON object`);
  requireCondition(nonEmptyString(row.artifactId), `${label} is missing artifactId`);
  for (const field of ["name", "version", "releaseUrl"]) {
    requireCondition(typeof row[field] === "string", `${label}.${field} must be a string`);
  }
  requireCondition(typeof row.status === "string" && [
    "denied-security", "renderer-loaded", "renderer-denied", "renderer-failed",
    "not-applicable", "integrity-failed", "worker-error",
  ].includes(row.status), `${label} has an unknown status`);
  requireCondition(["passed", "failed", "not-applicable"].includes(String(row.integrity)), `${label}.integrity is invalid`);
  requireCondition(["not-executed", "renderer-wrapper"].includes(String(row.execution)), `${label}.execution is invalid`);
  requireCondition(Array.isArray(row.markers), `${label}.markers must be an array`);
  for (const [markerIndex, markerValue] of row.markers.entries()) {
    const marker = asRecord(markerValue);
    requireCondition(marker !== null && ["filesystem", "network", "process", "credentials", "dom", "native", "dynamic-code"].includes(String(marker.id)), `${label}.markers[${markerIndex}] has an invalid id`);
    requireCondition(nonEmptyString(marker.capability), `${label}.markers[${markerIndex}].capability must be a non-empty string`);
    requireStringArray(marker.matchedPatterns, `${label}.markers[${markerIndex}].matchedPatterns`);
  }
  requireStringArray(row.deniedCapabilities, `${label}.deniedCapabilities`);
  requireStringArray(row.safeAlternativesAttempted, `${label}.safeAlternativesAttempted`);
  if (row.renderer !== undefined) requireCondition(asRecord(row.renderer) !== null, `${label}.renderer must be an object when present`);
  if (row.detail !== undefined) requireCondition(typeof row.detail === "string", `${label}.detail must be a string when present`);
}

function expectedRendererIds(): string[] {
  const manifest = readExpectedJson("fixtures/compatibility-manifest.json", "compatibility manifest");
  const artifactIds = asArray(manifest.artifacts).map((artifact) => asRecord(artifact)?.id);
  requireCondition(artifactIds.length > 0 && artifactIds.every(nonEmptyString), "compatibility manifest must define artifact IDs");
  requireExactIds("compatibility manifest artifact IDs", artifactIds, EXPECTED_RENDERER_ARTIFACT_IDS);
  const ids = ["fixture:renderer-mediated-source", ...EXPECTED_RENDERER_ARTIFACT_IDS];
  requireCondition(new Set(ids).size === ids.length, "compatibility manifest contains duplicate renderer IDs");
  return ids;
}

function expectedLoadedIds(): {
  artifactIds: string[];
  combinationIds: string[];
  combinationTargetIds: Map<string, string[]>;
  combinationDefinitions: Map<string, {definition: Record<string, unknown>; scenarioId: string}>;
  recoveryProbe: Record<string, unknown>;
} {
  const fixture = readExpectedJson("fixtures/plugin-loaded-workflows.json", "loaded-plugin workflow");
  const artifactIds = asArray(fixture.target_ids);
  requireCondition(artifactIds.length > 0 && artifactIds.every(nonEmptyString), "loaded-plugin workflow fixture must define target IDs");
  requireExactIds("loaded-plugin fixture target IDs", artifactIds, EXPECTED_LOADED_ARTIFACT_IDS);
  const primaryDefinition = asRecord(fixture.combination);
  requireCondition(primaryDefinition !== null, "loaded-plugin workflow fixture must define its primary combination");
  const recoveryProbe = asRecord(fixture.recovery_probe);
  requireCondition(recoveryProbe !== null
    && nonEmptyString(recoveryProbe.denied_capability)
    && nonEmptyString(recoveryProbe.trigger)
    && nonEmptyString(recoveryProbe.state_marker)
    && nonEmptyString(recoveryProbe.mutation_scope), "loaded-plugin workflow fixture must define a complete recovery probe");
  requireCondition(primaryDefinition.id === EXPECTED_PRIMARY_COMBINATION_ID, "loaded-plugin workflow fixture has an unexpected primary combination ID");
  requireCondition(Array.isArray(fixture.required_combinations), "loaded-plugin workflow fixture must define required_combinations as an array");
  const requiredDefinitions = asArray(fixture.required_combinations).map(asRecord);
  requireCondition(requiredDefinitions.every((definition) => definition !== null), "loaded-plugin workflow fixture contains a malformed required combination");
  const definitions = [primaryDefinition, ...requiredDefinitions.filter((definition) => definition !== null)];
  requireCondition(definitions.length === 1 + asArray(fixture.required_combinations).length, "loaded-plugin workflow combination count differs from its fixture");
  const combinationIds = definitions.map((definition) => definition.id);
  requireCondition(combinationIds.length > 0 && combinationIds.every(nonEmptyString), "loaded-plugin workflow fixture must define combination IDs");
  requireExactIds("loaded-plugin required combinations", requiredDefinitions.map((definition) => definition?.id), EXPECTED_REQUIRED_COMBINATION_IDS);
  requireExactIds("loaded-plugin combinations", combinationIds, [EXPECTED_PRIMARY_COMBINATION_ID, ...EXPECTED_REQUIRED_COMBINATION_IDS]);
  requireCondition(new Set(artifactIds).size === artifactIds.length, "loaded-plugin workflow fixture contains duplicate target IDs");
  requireCondition(new Set(combinationIds).size === combinationIds.length, "loaded-plugin workflow fixture contains duplicate combination IDs");
  const combinationTargetIds = new Map<string, string[]>();
  const combinationDefinitions = new Map<string, {definition: Record<string, unknown>; scenarioId: string}>();
  for (const definition of definitions) {
    const id = definition.id as string;
    requireStringArray(definition.target_ids, `loaded-plugin workflow combination ${id}.target_ids`);
    const targetIds = definition.target_ids as string[];
    requireCondition(targetIds.length > 0 && targetIds.every((targetId) => nonEmptyString(targetId) && artifactIds.includes(targetId)), `loaded-plugin workflow combination ${id} has invalid target IDs`);
    requireCondition(new Set(targetIds).size === targetIds.length, `loaded-plugin workflow combination ${id} contains duplicate target IDs`);
    const configuredScenario = definition.scenario_id;
    const scenarioId = nonEmptyString(configuredScenario) && targetIds.includes(configuredScenario)
      ? configuredScenario
      : targetIds[0];
    requireCondition(nonEmptyString(scenarioId), `loaded-plugin workflow combination ${id} has no scenario target`);
    combinationTargetIds.set(id, targetIds);
    combinationDefinitions.set(id, {definition, scenarioId});
  }
  return {artifactIds: artifactIds as string[], combinationIds: combinationIds as string[], combinationTargetIds, combinationDefinitions, recoveryProbe};
}

function validateLoadedJson(contents: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch (error) {
    throw new Error(`loaded-plugin report is not one valid JSON document: ${error instanceof Error ? error.message : String(error)}`);
  }
  const report = asRecord(parsed);
  requireCondition(report !== null, "loaded-plugin report must contain a JSON object");
  requireCondition(report.evidence_version === 1, "loaded-plugin report has an unsupported evidence_version");
  requireCondition(report.status === "passed" || report.status === "partial" || report.status === "failed", "loaded-plugin report has an unknown status");
  if (report.status === "failed") {
    requireCondition(nonEmptyString(report.command), "failed loaded-plugin report is missing its command");
    requireCondition(nonEmptyString(report.error), "failed loaded-plugin report is missing its error");
    return;
  }
  requireCondition(report.fixture_id === "fixture:plugin-loaded-workflows", "loaded-plugin report has an unexpected fixture_id");
  requireCondition(report.command === "bun run audit:plugin-loaded-workflows", "loaded-plugin report has an unexpected command");
  requireCondition(nonEmptyString(report.recorded_at), "loaded-plugin report is missing recorded_at");
  requireStringArray(report.requirements, "loaded-plugin report requirements");
  requireCondition(asRecord(report.environment) !== null && asRecord(report.source_tree) !== null, "loaded-plugin report is missing environment or source_tree metadata");
  requireCondition(Array.isArray(report.artifact_results), "loaded-plugin report is missing artifact_results");
  requireCondition(Array.isArray(report.combinations), "loaded-plugin report is missing combinations");
  const expected = expectedLoadedIds();
  const artifactIds = asArray(report.artifact_results).map((entry) => asRecord(entry)?.artifact_id);
  const combinationIds = asArray(report.combinations).map((entry) => asRecord(entry)?.id);
  requireExactIds("loaded-plugin artifact_results", artifactIds, expected.artifactIds);
  requireExactIds("loaded-plugin combinations", combinationIds, expected.combinationIds);
  const artifactResults = asArray(report.artifact_results);
  const combinations = asArray(report.combinations);
  artifactResults.forEach(validateLoadedArtifactRow);
  combinations.forEach((entry, index) => validateLoadedCombinationRow(entry, index, expected.combinationTargetIds, expected.combinationDefinitions));
  const primaryCombination = asRecord(report.combination);
  const primaryRow = asArray(report.combinations).map(asRecord).find((entry) => entry?.id === EXPECTED_PRIMARY_COMBINATION_ID);
  requireCondition(primaryCombination !== null && equalJson(primaryCombination, primaryRow), "loaded-plugin primary combination does not match its combinations row");
  const checks = asRecord(report.checks);
  requireBooleanRecord(checks, "loaded-plugin report checks");
  requireCondition(checks.all_bounded_traces_complete === (report.status === "passed"), "loaded-plugin status does not agree with all_bounded_traces_complete");
  requireCondition(checks.no_plugin_promoted === true, "loaded-plugin report must not promote a plugin");
  if (report.status === "passed") {
    requireCondition(
      checks.all_artifact_lifecycle_traces_complete === true
        && checks.combination_lifecycle_trace_complete === true
        && checks.all_required_combinations_complete === true
        && checks.all_required_combination_recoveries_complete === true
        && checks.all_artifacts_integrity_checked === true,
      "passed loaded-plugin report has incomplete lifecycle, integrity, or combination checks",
    );
    requireCondition(artifactResults.every((entry) => {
      const row = asRecord(entry);
      return row?.bounded_lifecycle === "complete" && row.persistence === "preserved" && row.action_status === "passed" && asArray(row.action_failures).length === 0;
    }), "passed loaded-plugin report contains a partial artifact row");
    requireCondition(combinations.every((entry) => {
      const row = asRecord(entry);
      const recovery = asRecord(row?.combination_recovery);
      return row?.bounded_lifecycle === "complete" && row.persistence === "preserved" && row.action_status === "passed" && asArray(row.action_failures).length === 0 && row.dependency_status === "verified" && asRecord(recovery?.checks)?.passed === true;
    }), "passed loaded-plugin report contains a partial combination row");
    artifactResults.forEach(validatePassedArtifactRow);
    combinations.forEach((entry, index) => validatePassedCombinationRow(entry, index, expected.recoveryProbe));
  }
  requireCondition(typeof report.result === "string" && nonEmptyString(report.result), "loaded-plugin report is missing its result summary");
}

function validateRendererJsonl(contents: string): number {
  const lines = contents.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  requireCondition(lines.length > 0, "renderer JSONL report is empty");
  const statuses = new Set([
    "denied-security",
    "renderer-loaded",
    "renderer-denied",
    "renderer-failed",
    "not-applicable",
    "integrity-failed",
    "worker-error",
  ]);
  const artifactIds: unknown[] = [];
  lines.forEach((line, index) => {
    requireCondition(line.trim().length > 0, `renderer JSONL report has a blank row at line ${index + 1}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      throw new Error(`renderer JSONL line ${index + 1} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const row = asRecord(parsed);
    validateRendererRow(row, index);
    artifactIds.push(row.artifactId);
  });
  requireExactIds("renderer JSONL artifact IDs", artifactIds, expectedRendererIds());
  return lines.length;
}

function main(): number {
  const [format, reportPath] = process.argv.slice(2);
  requireCondition(Boolean(reportPath), "usage: bun scripts/validate-plugin-audit-report.ts <loaded-json|renderer-jsonl> <report-path>");
  const contents = readFileSync(resolve(root, reportPath), "utf8");
  if (format === "loaded-json") {
    validateLoadedJson(contents);
    console.log("PLUGIN AUDIT REPORT CHECK: loaded-plugin evidence is valid JSON");
    return 0;
  }
  requireCondition(format === "renderer-jsonl", `unsupported report format: ${format ?? "<missing>"}`);
  const rows = validateRendererJsonl(contents);
  console.log(`PLUGIN AUDIT REPORT CHECK: renderer evidence is valid JSONL; ${rows} rows`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`PLUGIN AUDIT REPORT CHECK: failed; ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
