import {createRequire} from "node:module";
import {createHash} from "node:crypto";
import {arch, platform, tmpdir} from "node:os";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {spawn} from "node:child_process";
import {asArray, asRecord, type JsonRecord} from "./json.js";
import {downloadPinnedAsset, integrityFailure, mainAsset, readJson, records, string} from "./plugin-audit-helpers.js";

const root = resolve(import.meta.dir, "..");
const electronBinary = createRequire(import.meta.url)("electron") as string;
const electronVersion = createRequire(import.meta.url)("electron/package.json").version as string;
const workerPath = join(root, "scripts/plugin-renderer-worker.cjs");
const fixture = readJson(root, "fixtures/plugin-loaded-workflows.json");
const manifest = readJson(root, "fixtures/compatibility-manifest.json");
const rendererTimeoutMs = 30_000;
const boundedLifecycleChecks = [
  "loaded",
  "workflow_supported",
  "required_phases",
  "version_progression",
  "lifecycle_started",
  "settings_registration_recorded",
  "views_registration_recorded",
  "command_attempts_recorded",
  "settings_attempts_recorded",
  "views_attempts_recorded",
  "event_attempts_recorded",
  "clipboard_bounded",
  "clipboard_external_writes_zero",
  "cleanup_after_each_phase",
  "uninstall_clears_registrations",
  "return_to_obsidian",
  "no_vault_writes",
] as const;

type ChildOutcome = {stdout: string; stderr: string; code: number | null; timedOut: boolean};

function requireCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function hasXvfb(): boolean {
  return platform() === "linux" && Bun.spawnSync(["sh", "-lc", "command -v xvfb-run"]).exitCode === 0;
}

function workerCommand(sourcePath: string, configPath: string): {command: string; args: string[]} {
  const useXvfb = hasXvfb();
  if (!useXvfb && platform() === "linux" && !process.env.DISPLAY) throw new Error("Loaded-plugin workflow audit requires DISPLAY or xvfb-run on Linux");
  const electronArgs = ["--disable-gpu", "--disable-software-rasterizer", workerPath, `--source-file=${sourcePath}`, "--run-workflow", `--workflow-config=${configPath}`];
  return useXvfb ? {command: "xvfb-run", args: ["-a", "--server-args=-screen 0 1280x720x24", electronBinary, ...electronArgs]} : {command: electronBinary, args: electronArgs};
}

async function collect(child: ReturnType<typeof spawn>): Promise<ChildOutcome> {
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const completion = new Promise<number | null>((resolveCompletion) => child.on("close", resolveCompletion));
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, rendererTimeoutMs);
  const code = await completion;
  clearTimeout(timer);
  return {stdout, stderr, code, timedOut};
}

function parseWorker(outcome: ChildOutcome): JsonRecord {
  if (outcome.timedOut) throw new Error(`loaded-plugin workflow worker exceeded ${rendererTimeoutMs}ms`);
  const lines = outcome.stdout.trim().split(/\r?\n/).reverse();
  let parseError = "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = asRecord(JSON.parse(line));
      if (parsed) return parsed;
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
  }
  const tail = outcome.stdout.trim().slice(-400);
  throw new Error(outcome.stderr.trim() || `loaded-plugin workflow worker emitted no JSON object (${parseError || "unknown parse error"}); stdout bytes: ${outcome.stdout.length}; stdout tail: ${tail}`);
}

function scenario(id: string): JsonRecord {
  const scenarios = asRecord(fixture.scenarios);
  const value = scenarios?.[id];
  const record = asRecord(value);
  if (!record) throw new Error(`missing loaded-plugin workflow scenario ${id}`);
  return record;
}

function artifactById(id: string): JsonRecord {
  const artifact = records(manifest.artifacts).find((entry) => string(entry.id) === id);
  if (!artifact) throw new Error(`missing compatibility artifact ${id}`);
  return artifact;
}

function sourceTree(): JsonRecord {
  const result = Bun.spawnSync(["bun", "scripts/source-tree-digest.ts"], {cwd: root});
  const output = result.stdout.toString().trim();
  if (result.exitCode !== 0 || !output) throw new Error(result.stderr.toString().trim() || "source-tree digest failed");
  return asRecord(JSON.parse(output)) ?? {};
}

function combinedSource(sources: Array<{id: string; source: string}>): string {
  const modules = sources.map(({id, source}) => `(() => { const module = {exports: {}}; const exports = module.exports;\n${source}\nreturn {id: ${JSON.stringify(id)}, exports: module.exports}; })()`).join(",\n");
  return `const {Plugin} = require("obsidian");\nconst children = [${modules}];\nconst constructors = children.map(({exports}) => typeof exports === "function" ? exports : exports && exports.default).filter((value) => typeof value === "function");\nmodule.exports = class CombinedLoadedArtifacts extends Plugin {\n  constructor(app, manifest) { super(app, manifest); this.children = constructors.map((Constructor, index) => new Constructor(app, {id: children[index].id, version: manifest.version})); }\n  async onload() { for (const child of this.children) if (typeof child.onload === "function") await child.onload(); }\n  async onunload() { for (const child of [...this.children].reverse()) if (typeof child.onunload === "function") await child.onunload(); }\n};\n`;
}

function phaseRecords(workflow: JsonRecord): JsonRecord[] {
  return records(workflow.phases);
}

function actionFailures(workflow: JsonRecord): JsonRecord[] {
  return phaseRecords(workflow).flatMap((phase) => {
    const actions = asRecord(phase.actions) ?? {};
    return [...records(actions.commands), ...records(actions.views), ...records(actions.settings), ...records(actions.events)].filter((action) => action.status !== "passed");
  });
}

function editorChecks(workflow: JsonRecord): JsonRecord {
  const phases = phaseRecords(workflow);
  const commands = phases.flatMap((phase) => records(asRecord(phase.actions)?.commands));
  const editorActions = commands.filter((action) => string(action.callbackKind) === "editorCallback");
  const mutatedActions = editorActions.filter((action) => asRecord(action.editor)?.mutated === true);
  const editorPhases = phases.map((phase) => asRecord(phase.editor)).filter((editor): editor is JsonRecord => editor !== null);
  const replacements = editorPhases.flatMap((editor) => records(editor.operations)).filter((operation) => string(operation.operation) === "replaceRange");
  const foldOperations = editorPhases.flatMap((editor) => records(editor.operations)).filter((operation) => string(operation.operation) === "fold");
  const unfoldOperations = editorPhases.flatMap((editor) => records(editor.operations)).filter((operation) => string(operation.operation) === "unfold");
  return {
    editor_callbacks: editorActions.length > 0,
    editor_actions_passed: editorActions.every((action) => action.status === "passed"),
    hierarchy_mutation_observed: replacements.length > 0,
    undo_restores_prior_bytes: mutatedActions.length > 0 && mutatedActions.every((action) => asRecord(action.editor)?.undoRestored === true),
    redo_restores_command_bytes: mutatedActions.length > 0 && mutatedActions.every((action) => asRecord(action.editor)?.redoRestored === true),
    folding_round_trip: foldOperations.length > 0 && unfoldOperations.length > 0 && editorPhases.every((editor) => records(editor.finalFoldedRanges).length === 0),
    phase_editor_round_trip: editorPhases.length === phases.length && editorPhases.every((editor) => string(editor.initialValue) === string(editor.finalValue) && records(editor.finalFoldedRanges).length === 0),
  };
}

function tagWorkflowChecks(workflow: JsonRecord): JsonRecord {
  const traces = phaseRecords(workflow)
    .map((phase) => asRecord(phase.tag_workflow))
    .filter((trace): trace is JsonRecord => trace !== null);
  const every = (key: string): boolean => traces.length === 3 && traces.every((trace) => trace[key] === true);
  return {
    present: traces.length === 3,
    bounded_editor_mutation: traces.length === 3 && traces.every((trace) => trace.mutation_scope === "bounded-editor-only"),
    rename_scoped: every("rename_scoped"),
    merge_deterministic: every("merge_deterministic"),
    hierarchical_occurrences_preserved: every("hierarchical_occurrences_preserved"),
    unrelated_properties_preserved: every("unrelated_properties_preserved"),
    unrelated_text_preserved: every("unrelated_text_preserved"),
    undo_restores_prior_bytes: every("undo_restored"),
    redo_restores_command_bytes: every("redo_restored"),
    plugin_rename_callback_not_invoked: traces.length === 3 && traces.every((trace) => trace.plugin_rename_callback === "not-invoked"),
    direct_vault_writes_zero: traces.length === 3 && traces.every((trace) => trace.direct_vault_writes === 0),
  };
}

function recentFilesWorkflowChecks(workflow: JsonRecord): JsonRecord {
  const traces = phaseRecords(workflow)
    .map((phase) => asRecord(phase.recent_files_workflow))
    .filter((trace): trace is JsonRecord => trace !== null);
  const every = (key: string): boolean => traces.length === 3 && traces.every((trace) => trace[key] === true);
  return {
    present: traces.length === 3,
    bounded_read_only: traces.length === 3 && traces.every((trace) => trace.mutation_scope === "bounded-in-memory-projection"),
    stale_entries_removed: every("stale_entries_removed"),
    rename_entry_updated: every("rename_entry_updated"),
    delete_entry_removed: every("delete_entry_removed"),
    retained_entry_preserved: every("retained_entry_preserved"),
    order_preserved: every("order_preserved"),
    max_length_preserved: every("max_length_preserved"),
    direct_vault_writes_zero: traces.length === 3 && traces.every((trace) => trace.direct_vault_writes === 0),
  };
}

function smartConnectionsWorkflowChecks(workflow: JsonRecord): JsonRecord {
  const traces = phaseRecords(workflow)
    .map((phase) => asRecord(phase.smart_connections_workflow))
    .filter((trace): trace is JsonRecord => trace !== null);
  const every = (key: string): boolean => traces.length === 3 && traces.every((trace) => trace[key] === true);
  return {
    present: traces.length === 3,
    bounded_read_only: traces.length === 3 && traces.every((trace) => trace.mutation_scope === "bounded-in-memory-projection"),
    local_model_provenance_verified: every("local_model_provenance_verified"),
    indexed_paths_match: every("indexed_paths_match"),
    excluded_paths_match: every("excluded_paths_match"),
    exclusions_enforced: every("exclusions_enforced"),
    remote_fallback_disabled: every("remote_fallback_disabled"),
    remote_fallback_not_used: traces.length === 3 && traces.every((trace) => trace.remote_fallback_used === false),
    import_queue_disabled: every("import_queue_disabled"),
    embed_queue_disabled: every("embed_queue_disabled"),
    bounded_scope: every("bounded_scope"),
    direct_vault_writes_zero: traces.length === 3 && traces.every((trace) => trace.direct_vault_writes === 0),
    status_passed: traces.length === 3 && traces.every((trace) => trace.status === "passed"),
  };
}

function dataviewWorkflowChecks(workflow: JsonRecord): JsonRecord {
  const trace = asRecord(workflow.dataview_workflow);
  const phases = records(trace?.phases);
  const every = (key: string): boolean => phases.length === 3 && phases.every((phase) => phase[key] === "passed" || phase[key] === true);
  const dataviewjs = asRecord(trace?.dataviewjs);
  return {
    present: trace !== null,
    bounded_read_only: trace?.mutation_scope === "bounded-read-only-query-projection",
    query_parsed: trace?.query_parsed === true,
    table_query: trace?.query_type === "table",
    columns_resolved: trace?.columns_resolved === true,
    fields_resolved: trace?.fields_resolved === true,
    rows_match: trace?.rows_match === true,
    links_resolved: trace?.links_resolved === true,
    tasks_detected: trace?.tasks_detected === true,
    refresh_after_external_edit: trace?.refresh_after_external_edit === true,
    dataviewjs_denied: trace?.dataviewjs_denied === true
      && dataviewjs?.disposition === "denied"
      && dataviewjs?.capability === "code.dynamic"
      && dataviewjs?.no_dynamic_execution === true,
    direct_vault_writes_zero: trace?.direct_vault_writes === 0 && trace?.direct_vault_writes_zero === true,
    phase_projections_passed: every("status"),
    status_passed: trace?.status === "passed" && trace?.all_phases_passed === true,
  };
}

function linterWorkflowChecks(workflow: JsonRecord): JsonRecord {
  const trace = asRecord(workflow.linter_workflow);
  const phases = records(trace?.phases);
  const every = (key: string): boolean => phases.length === 3 && phases.every((phase) => phase[key] === true);
  return {
    present: trace !== null,
    bounded_read_only: trace?.mutation_scope === "bounded-in-memory-projection",
    first_open_noop: every("first_open_noop") && trace?.first_open_mutation_count === 0,
    explicit_command_configured: every("explicit_command_configured"),
    explicit_output_match: every("explicit_output_match") && trace?.explicit_output_match === true,
    configured_yaml_output_match: every("configured_yaml_output_match") && trace?.configured_yaml_output_match === true,
    configured_markdown_output_match: every("configured_markdown_output_match") && trace?.configured_markdown_output_match === true,
    lint_on_save_matches: every("lint_on_save_matches") && trace?.lint_on_save_matches === true,
    only_expected_target_affected: every("only_expected_target_affected") && trace?.only_expected_target_affected === true,
    direct_vault_writes_zero: trace?.direct_vault_writes === 0 && every("direct_vault_writes_zero"),
    status_passed: trace?.status === "passed" && phases.length === 3 && phases.every((phase) => phase.status === "passed"),
  };
}

function taskWorkflowChecks(workflow: JsonRecord): JsonRecord {
  const traces = phaseRecords(workflow)
    .map((phase) => asRecord(phase.task_workflow))
    .filter((trace): trace is JsonRecord => trace !== null);
  const every = (key: string): boolean => traces.length === 3 && traces.every((trace) => trace[key] === true);
  return {
    present: traces.length === 3,
    bounded_revision_aware: traces.length === 3 && traces.every((trace) => trace.mutation_scope === "bounded-revision-aware-writer"),
    query_matched: every("query_matched"),
    bases_mappings_present: every("bases_mappings_present"),
    source_revision_matched: every("revision_matched"),
    stale_revision_rejected: every("stale_revision_rejected"),
    status_updated: every("status_updated"),
    task_checkbox_updated: every("task_checkbox_updated"),
    unrelated_content_preserved: every("unrelated_content_preserved"),
    revision_advanced: every("revision_advanced"),
    direct_vault_writes_zero: every("direct_vault_writes_zero"),
    status_passed: traces.length === 3 && traces.every((trace) => trace.status === "passed"),
  };
}

function tasksWorkflowChecks(workflow: JsonRecord): JsonRecord {
  const traces = phaseRecords(workflow)
    .map((phase) => asRecord(phase.tasks_workflow))
    .filter((trace): trace is JsonRecord => trace !== null);
  const every = (key: string): boolean => traces.length === 3 && traces.every((trace) => trace[key] === true);
  return {
    present: traces.length === 3,
    bounded_read_only: traces.length === 3 && traces.every((trace) => trace.mutation_scope === "bounded-in-memory-task-projection"),
    query_parsed: every("query_parsed"),
    query_matched: every("query_matched"),
    filter_applied: every("filter_applied"),
    rows_match: every("rows_match"),
    sorted_by_due: every("sorted_by_due"),
    group_by_status: every("group_by_status"),
    groups_match: every("groups_match"),
    create_task_projected: every("create_task_projected"),
    complete_task_projected: every("complete_task_projected"),
    status_markers_preserved: every("status_markers_preserved"),
    dates_preserved: every("dates_preserved"),
    recurrence_round_tripped: every("recurrence_round_tripped"),
    source_note_update_surgical: every("source_note_update_surgical"),
    unrelated_content_preserved: every("unrelated_content_preserved"),
    revision_advanced: every("revision_advanced"),
    direct_vault_writes_zero: every("direct_vault_writes_zero"),
    status_passed: traces.length === 3 && traces.every((trace) => trace.status === "passed"),
  };
}

function combinationDefinitions(): JsonRecord[] {
  const primary = asRecord(fixture.combination);
  const additional = records(fixture.required_combinations);
  const definitions = [primary, ...additional].filter((value): value is JsonRecord => value !== null);
  const seen = new Set<string>();
  return definitions.filter((definition) => {
    const id = string(definition.id);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function combinationIds(definition: JsonRecord): string[] {
  return asArray(definition.target_ids).filter((value): value is string => typeof value === "string");
}

function combinationScenarioId(definition: JsonRecord, ids: string[]): string {
  const configured = string(definition.scenario_id);
  return configured && ids.includes(configured) ? configured : ids[0] ?? "";
}

function mergeCombinationFiles(base: JsonRecord[], overrides: JsonRecord[]): JsonRecord[] {
  const byPath = new Map<string, JsonRecord>();
  for (const entry of [...base, ...overrides]) {
    const path = string(entry.path);
    if (path) byPath.set(path, entry);
  }
  return [...byPath.values()];
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function scopedPersistencePass(phases: JsonRecord[], currentIndex: number): boolean {
  const currentPhase = phases[currentIndex] ?? {};
  const snapshots = asRecord(currentPhase.loadedSnapshotsByPlugin);
  const current = asRecord(currentPhase.loadedDataByPlugin) ?? {};
  const previous = phases[currentIndex - 1];
  const previousSaved = asRecord(previous?.savedDataByPlugin) ?? {};
  const previousPersisted = asRecord(previous?.persistedDataByPlugin) ?? {};
  const keys = [...new Set([...Object.keys(previousSaved), ...Object.keys(previousPersisted)])];
  return keys.length > 0 && keys.every((key) => {
    if (!Object.prototype.hasOwnProperty.call(previousSaved, key) && !Object.prototype.hasOwnProperty.call(previousPersisted, key)) return false;
    const expected = Object.prototype.hasOwnProperty.call(previousSaved, key) ? previousSaved[key] : previousPersisted[key];
    const candidates = snapshots && Array.isArray(snapshots[key])
      ? snapshots[key]
      : Object.prototype.hasOwnProperty.call(current, key)
        ? [current[key]]
        : [];
    return candidates.some((candidate) => JSON.stringify(candidate) === JSON.stringify(expected));
  });
}

function workflowChecks(result: JsonRecord): Record<string, boolean> {
  const workflow = asRecord(result.workflow) ?? {};
  const phases = phaseRecords(workflow);
  const phaseNames = phases.map((phase) => string(phase.phase));
  const expectedPhases = asArray(fixture.required_phases).filter((value): value is string => typeof value === "string");
  const uninstall = asRecord(workflow.uninstall) ?? {};
  const registered = phases.map((phase) => asRecord(phase.registered) ?? {});
  const scopedRestart = scopedPersistencePass(phases, 1);
  const scopedUpdate = scopedPersistencePass(phases, 2);
  return {
    loaded: result.status === "loaded",
    workflow_supported: workflow.supported === true,
    required_phases: JSON.stringify(phaseNames) === JSON.stringify(expectedPhases),
    version_progression: phases.length === 3 && string(phases[0]?.version) === "1.0.0" && string(phases[1]?.version) === "1.0.0" && string(phases[2]?.version) === "1.1.0",
    lifecycle_started: phases.every((phase) => asArray(phase.lifecycle).includes("constructed") && asArray(phase.lifecycle).includes("onload")),
    settings_registration_recorded: registered.every((entry) => Array.isArray(entry.settings)),
    views_registration_recorded: registered.every((entry) => Array.isArray(entry.views)),
    command_attempts_recorded: phases.every((phase) => asRecord(phase.actions) && Array.isArray(asRecord(phase.actions)?.commands)),
    settings_attempts_recorded: phases.every((phase) => asRecord(phase.actions) && Array.isArray(asRecord(phase.actions)?.settings)),
    views_attempts_recorded: phases.every((phase) => asRecord(phase.actions) && Array.isArray(asRecord(phase.actions)?.views)),
    event_attempts_recorded: phases.every((phase) => asRecord(phase.actions) && Array.isArray(asRecord(phase.actions)?.events)),
    clipboard_bounded: phases.every((phase) => {
      const clipboard = asRecord(phase.clipboard);
      return clipboard !== null && clipboard.external === false && typeof clipboard.writes === "number" && Number.isInteger(clipboard.writes) && clipboard.writes >= 0 && clipboard.writes <= 1 && typeof clipboard.reads === "number" && Number.isInteger(clipboard.reads) && clipboard.reads >= 0;
    }),
    clipboard_external_writes_zero: phases.every((phase) => asRecord(phase.clipboard)?.external === false),
    restart_restores_data: JSON.stringify(phases[1]?.loadedData) === JSON.stringify(phases[0]?.savedData),
    update_restores_data: JSON.stringify(phases[2]?.loadedData) === JSON.stringify(phases[1]?.savedData),
    restart_restores_scoped_data: scopedRestart,
    update_restores_scoped_data: scopedUpdate,
    restart_restores_persisted_data: JSON.stringify(phases[1]?.loadedData) === JSON.stringify(phases[0]?.persistedData) || scopedRestart,
    update_restores_persisted_data: JSON.stringify(phases[2]?.loadedData) === JSON.stringify(phases[1]?.persistedData) || scopedUpdate,
    storage_recorded: phases.every((phase) => asRecord(phase.storage) !== null),
    cleanup_after_each_phase: phases.every((phase) => phase.remainingRegistrationsAfterCleanup === 0),
    uninstall_clears_registrations: uninstall.registrationsCleared === true,
    return_to_obsidian: uninstall.returnToObsidian === true && workflow.activeAfterUninstall === false,
    no_vault_writes: workflow.vaultWrites === 0,
  };
}

function checksPass(checks: Record<string, boolean>, names: readonly string[]): boolean {
  return names.every((name) => checks[name] === true);
}

function persistencePasses(checks: Record<string, boolean>): boolean {
  const restart = checks.restart_restores_data || checks.restart_restores_persisted_data || checks.restart_restores_scoped_data;
  const update = checks.update_restores_data || checks.update_restores_persisted_data || checks.update_restores_scoped_data;
  return restart === true && update === true;
}

function taskWorkflowPasses(task: JsonRecord | null): boolean {
  if (task === null) return true;
  return [
    "present",
    "bounded_revision_aware",
    "query_matched",
    "bases_mappings_present",
    "source_revision_matched",
    "stale_revision_rejected",
    "status_updated",
    "task_checkbox_updated",
    "unrelated_content_preserved",
    "revision_advanced",
    "direct_vault_writes_zero",
    "status_passed",
  ].every((key) => task[key] === true);
}

function combinationSpecificChecks(targetIds: string[], workflow: JsonRecord): JsonRecord {
  const task = targetIds.includes("PC19") ? taskWorkflowChecks(workflow) : null;
  return {
    task_workflow_checks: task,
    task_workflow_complete: taskWorkflowPasses(task),
  };
}

async function runWorker(source: string, config: JsonRecord, temporaryRoot: string, name: string): Promise<JsonRecord> {
  const sourcePath = join(temporaryRoot, `${name}.main.js`);
  const configPath = join(temporaryRoot, `${name}.json`);
  writeFileSync(sourcePath, source, "utf8");
  writeFileSync(configPath, JSON.stringify(config), "utf8");
  const {command, args} = workerCommand(sourcePath, configPath);
  const child = spawn(command, args, {cwd: root, env: {...process.env, NODE_NO_WARNINGS: "1"}, stdio: ["ignore", "pipe", "pipe"]});
  return parseWorker(await collect(child));
}

async function downloadArtifact(id: string): Promise<{artifact: JsonRecord; source: string; integrity: string}> {
  const artifact = artifactById(id);
  const asset = mainAsset(artifact);
  requireCondition(asset !== null, `${id} has no main.js release asset`);
  const bytes = await downloadPinnedAsset(string(asset.url), {attempts: 3, timeoutMs: 45_000});
  requireCondition(bytes !== null, `${id} main.js download failed`);
  const failure = integrityFailure(asset, bytes);
  requireCondition(failure === null, `${id} main.js integrity failed: ${failure}`);
  return {artifact, source: new TextDecoder().decode(bytes), integrity: "passed"};
}

async function verifyCombinationDependencies(definition: JsonRecord, config: JsonRecord): Promise<JsonRecord> {
  const artifacts: JsonRecord[] = [];
  for (const dependency of records(definition.dependency_artifacts)) {
    const artifactId = string(dependency.artifact_id);
    requireCondition(Boolean(artifactId), "combination dependency artifact_id is required");
    const artifact = artifactById(artifactId);
    const requestedAssets = asArray(dependency.assets).filter((value): value is string => typeof value === "string");
    requireCondition(requestedAssets.length > 0, `${artifactId} combination dependency must name at least one asset`);
    const verifiedAssets: JsonRecord[] = [];
    for (const name of requestedAssets) {
      const asset = records(artifact.release_assets).find((candidate) => string(candidate.name) === name);
      requireCondition(asset !== undefined, `${artifactId} is missing required combination asset ${name}`);
      const bytes = await downloadPinnedAsset(string(asset.url), {attempts: 3, timeoutMs: 45_000});
      requireCondition(bytes !== null, `${artifactId} ${name} download failed`);
      const failure = integrityFailure(asset, bytes);
      requireCondition(failure === null, `${artifactId} ${name} integrity failed: ${failure}`);
      verifiedAssets.push({name, bytes: bytes.byteLength, sha256: sha256(new Uint8Array(bytes))});
    }
    artifacts.push({
      artifact_id: artifactId,
      name: string(artifact.name),
      version: string(artifact.tag),
      assets: verifiedAssets,
    });
  }

  const files = records(config.files);
  const fixtures = records(definition.dependency_fixtures).map((dependency) => {
    const paths = asArray(dependency.paths).filter((value): value is string => typeof value === "string");
    const checked = paths.map((path) => {
      const file = files.find((candidate) => string(candidate.path) === path);
      const content = file ? string(file.content) : "";
      return {path, present: file !== undefined, bytes: new TextEncoder().encode(content).byteLength, sha256: file ? sha256(new TextEncoder().encode(content)) : null};
    });
    return {
      fixture_id: string(dependency.fixture_id),
      paths: checked,
      complete: checked.length > 0 && checked.every((entry) => entry.present),
    };
  });
  requireCondition(fixtures.every((fixture) => fixture.complete), "required combination fixture files are missing");
  return {artifacts, fixtures};
}

export async function runLoadedPluginWorkflowAudit(): Promise<JsonRecord> {
  requireCondition(fixture.schema_version === 1, "loaded-plugin workflow fixture schema_version must be 1");
  requireCondition(string(fixture.id) === "fixture:plugin-loaded-workflows", "loaded-plugin workflow fixture id is invalid");
  const targetIds = asArray(fixture.target_ids).filter((value): value is string => typeof value === "string");
  const temporaryRoot = mkdtempSync(join(tmpdir(), "openobsidian-loaded-plugin-workflows-"));
  try {
    const artifactResults: JsonRecord[] = [];
    const sources: Array<{id: string; source: string}> = [];
    for (const id of targetIds) {
      const downloaded = await downloadArtifact(id);
      const config = {...scenario(id), artifact_id: id};
      const result = await runWorker(downloaded.source, config, temporaryRoot, id);
      const checks = workflowChecks(result);
      const workflow = asRecord(result.workflow) ?? {};
      const failures = actionFailures(workflow);
      const editor = editorChecks(workflow);
      const smartConnections = id === "PC22" ? smartConnectionsWorkflowChecks(workflow) : null;
      const dataview = id === "PC03" ? dataviewWorkflowChecks(workflow) : null;
      const linter = id === "PC25" ? linterWorkflowChecks(workflow) : null;
      const task = id === "PC19" ? taskWorkflowChecks(workflow) : null;
      const tasks = id === "PC04" ? tasksWorkflowChecks(workflow) : null;
      const lifecycleComplete = checksPass(checks, boundedLifecycleChecks);
      const persistenceComplete = persistencePasses(checks);
      const persistenceSource = checks.restart_restores_data === true && checks.update_restores_data === true
        ? "plugin-data-save"
        : persistenceComplete
          ? "mediated-plugin-data-store"
          : "not-proven";
      artifactResults.push({
        artifact_id: id,
        name: string(downloaded.artifact.name),
        version: string(downloaded.artifact.tag),
        integrity: downloaded.integrity,
        denied_capabilities: asArray(result.deniedCapabilities),
        result,
        checks,
        bounded_lifecycle: lifecycleComplete ? "complete" : "partial",
        persistence: persistenceComplete ? "preserved" : "not-proven",
        persistence_source: persistenceSource,
      action_status: failures.length === 0 ? "passed" : "partial",
      action_failures: failures,
      editor_checks: editor,
      tag_workflow_checks: id === "PC24" ? tagWorkflowChecks(workflow) : null,
      recent_files_workflow_checks: id === "PC23" ? recentFilesWorkflowChecks(workflow) : null,
      smart_connections_workflow_checks: smartConnections,
      dataview_workflow_checks: dataview,
      linter_workflow_checks: linter,
      task_workflow_checks: task,
      tasks_workflow_checks: tasks,
      disposition: "bounded-workflow-evidence-pending-runtime",
      });
      sources.push({id, source: downloaded.source});
    }
    const definitions = combinationDefinitions();
    requireCondition(definitions.length > 0, "loaded-plugin audit requires at least one combination definition");
    const combinationResults: JsonRecord[] = [];
    for (const definition of definitions) {
      const ids = combinationIds(definition);
      requireCondition(ids.length > 0 && ids.every((id) => targetIds.includes(id)), `loaded-plugin combination ${string(definition.id)} must reference audited target ids`);
      const sourceEntries = ids.map((id) => sources.find((entry) => entry.id === id)).filter((entry): entry is {id: string; source: string} => entry !== undefined);
      requireCondition(sourceEntries.length === ids.length, `loaded-plugin combination ${string(definition.id)} is missing an audited source`);
      const scenarioId = combinationScenarioId(definition, ids);
      const baseScenario = scenario(scenarioId);
      const definitionFiles = records(definition.files);
      const id = string(definition.id) || `combination:${ids.map((value) => value.toLowerCase()).join("-")}`;
      const combinationConfig = {
        ...baseScenario,
        artifact_id: id,
        files: mergeCombinationFiles(records(baseScenario.files), definitionFiles),
        initial_data_by_plugin: Object.fromEntries(ids.map((pluginId) => [pluginId, asRecord(scenario(pluginId).initial_data) ?? {}])),
        target_ids: ids,
      };
      const dependencies = await verifyCombinationDependencies(definition, combinationConfig);
      const result = await runWorker(combinedSource(sourceEntries), combinationConfig, temporaryRoot, `combination-${id.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`);
      const checks = workflowChecks(result);
      const workflow = asRecord(result.workflow) ?? {};
      const failures = actionFailures(workflow);
      const editor = editorChecks(workflow);
      const specific = combinationSpecificChecks(ids, workflow);
      const lifecycleComplete = checksPass(checks, boundedLifecycleChecks);
      const persistenceComplete = persistencePasses(checks);
      const specificComplete = specific.task_workflow_complete === true;
      const dependencyComplete = records(dependencies.artifacts).every((artifact) => records(artifact.assets).length > 0)
        && records(dependencies.fixtures).every((fixture) => fixture.complete === true);
      combinationResults.push({
        id,
        target_ids: ids,
        scenario_id: scenarioId,
        dependencies,
        result,
        checks,
        bounded_lifecycle: lifecycleComplete ? "complete" : "partial",
        persistence: persistenceComplete ? "preserved" : "not-proven",
        persistence_source: checks.restart_restores_data === true && checks.update_restores_data === true
          ? "plugin-data-save"
          : persistenceComplete
            ? "mediated-plugin-data-store"
            : "not-proven",
        action_status: failures.length === 0 && specificComplete ? "passed" : "partial",
        action_failures: failures,
        editor_checks: editor,
        specific_checks: specific,
        dependency_status: dependencyComplete ? "verified" : "partial",
        disposition: "bounded-combination-evidence-pending-runtime",
      });
    }
    const primaryCombination = combinationResults[0];
    const artifactLifecyclesComplete = artifactResults.every((entry) => entry.bounded_lifecycle === "complete");
    const combinationLifecycleComplete = combinationResults.every((entry) => entry.bounded_lifecycle === "complete");
    const artifactChecksComplete = artifactResults.every((entry) => {
      const tagChecks = asRecord(entry.tag_workflow_checks);
      const tagComplete = entry.artifact_id !== "PC24" || (tagChecks !== null && [
        "present",
        "bounded_editor_mutation",
        "rename_scoped",
        "merge_deterministic",
        "hierarchical_occurrences_preserved",
        "unrelated_properties_preserved",
        "unrelated_text_preserved",
        "undo_restores_prior_bytes",
        "redo_restores_command_bytes",
        "plugin_rename_callback_not_invoked",
        "direct_vault_writes_zero",
      ].every((key) => tagChecks[key] === true));
      const recentFilesChecks = asRecord(entry.recent_files_workflow_checks);
      const recentFilesComplete = entry.artifact_id !== "PC23" || (recentFilesChecks !== null && [
        "present",
        "bounded_read_only",
        "stale_entries_removed",
        "rename_entry_updated",
        "delete_entry_removed",
        "retained_entry_preserved",
        "order_preserved",
        "max_length_preserved",
        "direct_vault_writes_zero",
      ].every((key) => recentFilesChecks[key] === true));
      const smartConnectionsChecks = asRecord(entry.smart_connections_workflow_checks);
      const smartConnectionsComplete = entry.artifact_id !== "PC22" || (smartConnectionsChecks !== null && [
        "present",
        "bounded_read_only",
        "local_model_provenance_verified",
        "indexed_paths_match",
        "excluded_paths_match",
        "exclusions_enforced",
        "remote_fallback_disabled",
        "remote_fallback_not_used",
        "import_queue_disabled",
        "embed_queue_disabled",
        "bounded_scope",
        "direct_vault_writes_zero",
        "status_passed",
      ].every((key) => smartConnectionsChecks[key] === true));
      const linterChecks = asRecord(entry.linter_workflow_checks);
      const linterComplete = entry.artifact_id !== "PC25" || (linterChecks !== null && [
        "present",
        "bounded_read_only",
        "first_open_noop",
        "explicit_command_configured",
        "explicit_output_match",
        "configured_yaml_output_match",
        "configured_markdown_output_match",
        "lint_on_save_matches",
        "only_expected_target_affected",
        "direct_vault_writes_zero",
        "status_passed",
      ].every((key) => linterChecks[key] === true));
      const taskChecks = asRecord(entry.task_workflow_checks);
      const taskComplete = entry.artifact_id !== "PC19" || (taskChecks !== null && [
        "present",
        "bounded_revision_aware",
        "query_matched",
        "bases_mappings_present",
        "source_revision_matched",
        "stale_revision_rejected",
        "status_updated",
        "task_checkbox_updated",
        "unrelated_content_preserved",
        "revision_advanced",
        "direct_vault_writes_zero",
        "status_passed",
      ].every((key) => taskChecks[key] === true));
      const tasksChecks = asRecord(entry.tasks_workflow_checks);
      const tasksComplete = entry.artifact_id !== "PC04" || (tasksChecks !== null && [
        "present",
        "bounded_read_only",
        "query_parsed",
        "query_matched",
        "filter_applied",
        "rows_match",
        "sorted_by_due",
        "group_by_status",
        "groups_match",
        "create_task_projected",
        "complete_task_projected",
        "status_markers_preserved",
        "dates_preserved",
        "recurrence_round_tripped",
        "source_note_update_surgical",
        "unrelated_content_preserved",
        "revision_advanced",
        "direct_vault_writes_zero",
        "status_passed",
      ].every((key) => tasksChecks[key] === true));
      const dataviewChecks = asRecord(entry.dataview_workflow_checks);
      const dataviewComplete = entry.artifact_id !== "PC03" || (dataviewChecks !== null && [
        "present",
        "bounded_read_only",
        "query_parsed",
        "table_query",
        "columns_resolved",
        "fields_resolved",
        "rows_match",
        "links_resolved",
        "tasks_detected",
        "refresh_after_external_edit",
        "dataviewjs_denied",
        "direct_vault_writes_zero",
        "phase_projections_passed",
        "status_passed",
      ].every((key) => dataviewChecks[key] === true));
      return checksPass(asRecord(entry.checks) as Record<string, boolean>, boundedLifecycleChecks) && persistencePasses(asRecord(entry.checks) as Record<string, boolean>) && entry.action_status === "passed" && tagComplete && recentFilesComplete && smartConnectionsComplete && dataviewComplete && linterComplete && taskComplete && tasksComplete;
    });
    const combinationChecksComplete = combinationResults.every((entry) => {
      const checks = asRecord(entry.checks) as Record<string, boolean>;
      return checksPass(checks, boundedLifecycleChecks)
        && persistencePasses(checks)
        && entry.action_status === "passed"
        && entry.dependency_status === "verified";
    });
    const allChecks = artifactChecksComplete && combinationChecksComplete;
    requireCondition(primaryCombination !== undefined, "loaded-plugin audit primary combination is missing");
    return {
      evidence_version: 1,
      status: allChecks ? "passed" : "partial",
      recorded_at: new Date().toISOString(),
      checkpoint: "P3.2",
      requirements: ["GATE-002", "C11", "PLUG-002", "PLUG-003", "PLUG-004", "PLUG-005", ...targetIds],
      decision_id: "D14",
      fixture_id: string(fixture.id),
      command: "bun run audit:plugin-loaded-workflows",
      environment: {platform: platform(), architecture: arch(), electron: electronVersion, display: process.env.DISPLAY ? "existing" : "xvfb-run", branch: "main", selected_vault: "/home/ashutosh/Obsidian", selected_vault_accessed: false},
      source_tree: sourceTree(),
      artifact_results: artifactResults,
      combination: primaryCombination,
      combinations: combinationResults,
      checks: {
        all_artifact_lifecycle_traces_complete: artifactLifecyclesComplete,
        combination_lifecycle_trace_complete: combinationLifecycleComplete,
        all_required_combinations_complete: combinationChecksComplete,
        all_bounded_traces_complete: allChecks,
        all_artifacts_integrity_checked: artifactResults.every((entry) => entry.integrity === "passed"),
        no_plugin_promoted: true,
      },
      safe_alternatives_attempted: asArray(fixture.safe_alternatives_attempted),
      external_pending: asArray(fixture.external_pending),
      limitation: string(fixture.limitation),
      result: allChecks
        ? "All audited unchanged pinned artifacts and all required synthetic combination wrappers completed bounded install/restart/update/uninstall/return-to-Obsidian traces with mediated persistence, settings/view/command/event actions, dependency fixture verification, renderer-local clipboard capture, the PC22 local-model/exclusion projection, the PC23 stale-entry/rename/delete projection, cleanup and zero vault writes; stock Obsidian, reference, cross-platform, human and compatibility certification remain pending."
        : artifactLifecyclesComplete && combinationLifecycleComplete
          ? "All audited unchanged pinned artifacts and all required synthetic combination wrappers completed the bounded install/restart/update/uninstall/return-to-Obsidian lifecycle traces, but one or more bounded action, dependency or persistence checks remain partial; no compatibility status was promoted."
          : "One or more bounded loaded-plugin lifecycle traces were partial; no compatibility status was promoted.",
    };
  } finally {
    rmSync(temporaryRoot, {recursive: true, force: true});
  }
}

if (import.meta.main) {
  try {
    const evidence = await runLoadedPluginWorkflowAudit();
    console.log(JSON.stringify(evidence, null, 2));
  } catch (error) {
    console.error(JSON.stringify({evidence_version: 1, status: "failed", command: "bun run audit:plugin-loaded-workflows", error: error instanceof Error ? error.message : String(error)}));
    process.exit(1);
  }
}
