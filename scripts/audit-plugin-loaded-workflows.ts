import {createRequire} from "node:module";
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
  const line = outcome.stdout.trim().split("\n").at(-1) ?? "";
  const parsed = asRecord(JSON.parse(line));
  if (!parsed) throw new Error(outcome.stderr.trim() || "loaded-plugin workflow worker emitted a non-object result");
  return parsed;
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
    return [...records(actions.commands), ...records(actions.views), ...records(actions.settings)].filter((action) => action.status !== "passed");
  });
}

function combinationTargetIds(): string[] {
  const combination = asRecord(fixture.combination);
  return asArray(combination?.target_ids).filter((value): value is string => typeof value === "string");
}

function workflowChecks(result: JsonRecord): Record<string, boolean> {
  const workflow = asRecord(result.workflow) ?? {};
  const phases = phaseRecords(workflow);
  const phaseNames = phases.map((phase) => string(phase.phase));
  const expectedPhases = asArray(fixture.required_phases).filter((value): value is string => typeof value === "string");
  const uninstall = asRecord(workflow.uninstall) ?? {};
  const registered = phases.map((phase) => asRecord(phase.registered) ?? {});
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
    restart_restores_data: JSON.stringify(phases[1]?.loadedData) === JSON.stringify(phases[0]?.savedData),
    update_restores_data: JSON.stringify(phases[2]?.loadedData) === JSON.stringify(phases[1]?.savedData),
    restart_restores_persisted_data: JSON.stringify(phases[1]?.loadedData) === JSON.stringify(phases[0]?.persistedData),
    update_restores_persisted_data: JSON.stringify(phases[2]?.loadedData) === JSON.stringify(phases[1]?.persistedData),
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
  const restart = checks.restart_restores_data || checks.restart_restores_persisted_data;
  const update = checks.update_restores_data || checks.update_restores_persisted_data;
  return restart === true && update === true;
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
        disposition: "bounded-workflow-evidence-pending-runtime",
      });
      sources.push({id, source: downloaded.source});
    }
    const combinationIds = combinationTargetIds();
    requireCondition(combinationIds.length > 0 && combinationIds.every((id) => targetIds.includes(id)), "loaded-plugin combination must reference audited target ids");
    const combinationSources = sources.filter(({id}) => combinationIds.includes(id));
    const combinationScenario = scenario(combinationIds[0]);
    const combination = asRecord(fixture.combination) ?? {};
    const combinationId = string(combination.id) || `combination:${combinationIds.map((id) => id.toLowerCase()).join("-")}`;
    const combinationConfig = {artifact_id: combinationId, ...combinationScenario, target_ids: combinationIds};
    const combinationResult = await runWorker(combinedSource(combinationSources), combinationConfig, temporaryRoot, `combination-${combinationIds.map((id) => id.toLowerCase()).join("-")}`);
    const combinationChecks = workflowChecks(combinationResult);
    const combinationWorkflow = asRecord(combinationResult.workflow) ?? {};
    const combinationActionFailures = actionFailures(combinationWorkflow);
    const artifactLifecyclesComplete = artifactResults.every((entry) => entry.bounded_lifecycle === "complete");
    const combinationLifecycleComplete = checksPass(combinationChecks, boundedLifecycleChecks);
    const artifactChecksComplete = artifactResults.every((entry) => checksPass(asRecord(entry.checks) as Record<string, boolean>, boundedLifecycleChecks) && persistencePasses(asRecord(entry.checks) as Record<string, boolean>) && entry.action_status === "passed");
    const combinationChecksComplete = combinationLifecycleComplete && persistencePasses(combinationChecks) && combinationActionFailures.length === 0;
    const allChecks = artifactChecksComplete && combinationChecksComplete;
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
      combination: {
        id: combinationId,
        target_ids: combinationIds,
        result: combinationResult,
        checks: combinationChecks,
        bounded_lifecycle: combinationLifecycleComplete ? "complete" : "partial",
        persistence: persistencePasses(combinationChecks) ? "preserved" : "not-proven",
        persistence_source: combinationChecks.restart_restores_data === true && combinationChecks.update_restores_data === true
          ? "plugin-data-save"
          : persistencePasses(combinationChecks)
            ? "mediated-plugin-data-store"
            : "not-proven",
        action_status: combinationActionFailures.length === 0 ? "passed" : "partial",
        action_failures: combinationActionFailures,
        disposition: "bounded-combination-evidence-pending-runtime",
      },
      checks: {
        all_artifact_lifecycle_traces_complete: artifactLifecyclesComplete,
        combination_lifecycle_trace_complete: combinationLifecycleComplete,
        all_bounded_traces_complete: allChecks,
        all_artifacts_integrity_checked: artifactResults.every((entry) => entry.integrity === "passed"),
        no_plugin_promoted: true,
      },
      safe_alternatives_attempted: asArray(fixture.safe_alternatives_attempted),
      external_pending: asArray(fixture.external_pending),
      limitation: string(fixture.limitation),
      result: artifactLifecyclesComplete && combinationLifecycleComplete
        ? "All three unchanged pinned artifacts and the shared combination wrapper completed the bounded install/restart/update/uninstall/return-to-Obsidian lifecycle traces; persisted-data gaps and settings/view/command action failures remain recorded as pending-runtime limitations."
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
