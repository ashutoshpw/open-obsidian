import {createRequire} from "node:module";
import {arch, platform, tmpdir} from "node:os";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {asArray, asRecord, type JsonRecord} from "./json.js";

const root = resolve(import.meta.dir, "..");
const electronBinary = createRequire(import.meta.url)("electron") as string;
const workerPath = join(root, "scripts/plugin-renderer-worker.cjs");
const workerTimeoutMs = 20_000;
const fixture = JSON.parse(readFileSync(join(root, "fixtures/plugin-renderer-lifecycle.json"), "utf8")) as JsonRecord;

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function requireCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(value: unknown, label: string): JsonRecord {
  const result = asRecord(value);
  if (!result) throw new Error(`${label} did not return an object`);
  return result;
}

function strings(value: unknown): string[] {
  return asArray(value).filter((entry): entry is string => typeof entry === "string");
}

function records(value: unknown): JsonRecord[] {
  return asArray(value).map((entry) => asRecord(entry)).filter((entry): entry is JsonRecord => Boolean(entry));
}

function sameStrings(actual: unknown, expected: unknown): boolean {
  return strings(actual).join("|") === strings(expected).join("|");
}

function sameJson(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function phaseAt(phases: JsonRecord[], index: number): JsonRecord {
  return phases[index] ?? {};
}

function lifecycleChecks(safe: JsonRecord, dom: JsonRecord, safeLifecycle: JsonRecord, domLifecycle: JsonRecord, expected: JsonRecord, safeApi: JsonRecord): Record<string, boolean> {
  const expectedApi = record(expected.safe_api, "fixture safe API");
  return {
    safe_lifecycle_loaded: safe.status === expected.safe_status,
    safe_lifecycle_boundary: safe.coverage === expected.safe_coverage,
    safe_onload_then_onunload: sameStrings(safeLifecycle.events, expected.safe_lifecycle_events),
    safe_command_registered: sameStrings(safeApi.commands, expectedApi.commands),
    safe_view_registered: sameStrings(safeApi.views, expectedApi.views),
    safe_settings_registered: sameStrings(safeApi.settings, expectedApi.settings),
    safe_event_registered: sameStrings(safeApi.registeredEvents, expectedApi.events),
    safe_persistence_boundary: sameStrings(safeApi.persistence, expectedApi.persistence),
    dom_lifecycle_denied: dom.status === expected.dom_status,
    dom_lifecycle_boundary: dom.coverage === expected.dom_coverage,
    dom_privileged_capability_denied: strings(dom.deniedCapabilities).includes(string(expected.dom_denied_capability)),
    dom_denied_before_onload_completion: sameStrings(domLifecycle.events, expected.dom_lifecycle_events),
  };
}

function workflowChecks(workflow: JsonRecord, workflowData: JsonRecord, phases: JsonRecord[], expectedWorkflow: JsonRecord, uninstall: JsonRecord): Record<string, boolean> {
  const firstPhase = phaseAt(phases, 0);
  const restartPhase = phaseAt(phases, 1);
  const updatePhase = phaseAt(phases, 2);
  return {
    workflow_loaded: workflow.status === expectedWorkflow.status,
    workflow_boundary: workflow.coverage === expectedWorkflow.coverage,
    workflow_phase_order: sameStrings(phases.map((phase) => string(phase.phase)), expectedWorkflow.phases),
    workflow_version_progression: sameStrings(phases.map((phase) => string(phase.version)), expectedWorkflow.versions),
    workflow_restart_restores_data: sameJson(restartPhase.loadedData, firstPhase.savedData),
    workflow_update_restores_data: sameJson(updatePhase.loadedData, restartPhase.savedData),
    workflow_persistence_order: phases.every((phase) => sameStrings(record(phase.registered, "workflow registration").persistence, expectedWorkflow.persistence)),
    workflow_registration_cleanup: phases.every((phase) => phase.remainingRegistrationsAfterCleanup === 0),
    workflow_uninstall_clears_registrations: uninstall.registrationsCleared === true,
    workflow_plugin_data_persistence: workflowData.pluginDataWrites === expectedWorkflow.plugin_data_writes,
    workflow_no_vault_writes: workflowData.vaultWrites === expectedWorkflow.vault_writes,
    workflow_returns_to_obsidian: uninstall.returnToObsidian === true && workflowData.activeAfterUninstall === false,
  };
}

type WorkerMode = "lifecycle" | "workflow";

async function runSource(source: string, temporaryRoot: string, name: string, mode: WorkerMode = "lifecycle"): Promise<JsonRecord> {
  const sourcePath = join(temporaryRoot, `${name}.main.js`);
  writeFileSync(sourcePath, source, "utf8");
  const {command, args} = workerCommand(sourcePath, mode);
  const child = Bun.spawn([command, ...args], {cwd: root, env: {...process.env, NODE_NO_WARNINGS: "1"}, stdout: "pipe", stderr: "pipe"});
  return parseWorkerOutput(await collectWorkerOutput(child));
}

function hasXvfb(): boolean {
  return platform() === "linux" && Bun.spawnSync(["sh", "-lc", "command -v xvfb-run"]).exitCode === 0;
}

function assertDisplay(useXvfb: boolean): void {
  if (!useXvfb && platform() === "linux" && !process.env.DISPLAY) throw new Error("Plugin lifecycle audit requires DISPLAY or xvfb-run on Linux");
}

function workerArguments(sourcePath: string, useXvfb: boolean, mode: WorkerMode): string[] {
  const electronArgs = ["--disable-gpu", "--disable-software-rasterizer", workerPath, `--source-file=${sourcePath}`, `--run-${mode}`];
  return useXvfb ? ["-a", "--server-args=-screen 0 1280x720x24", electronBinary, ...electronArgs] : electronArgs;
}

function workerCommand(sourcePath: string, mode: WorkerMode): {command: string; args: string[]} {
  const useXvfb = hasXvfb();
  assertDisplay(useXvfb);
  return {command: useXvfb ? "xvfb-run" : electronBinary, args: workerArguments(sourcePath, useXvfb, mode)};
}

type WorkerOutput = [stdout: string, stderr: string, exitCode: number];

async function collectWorkerOutput(child: ReturnType<typeof Bun.spawn>): Promise<WorkerOutput> {
  const stdout = child.stdout as ReadableStream<Uint8Array>;
  const stderr = child.stderr as ReadableStream<Uint8Array>;
  const output = Promise.all([new Response(stdout).text(), new Response(stderr).text(), child.exited]);
  return Promise.race([
    output,
    Bun.sleep(workerTimeoutMs).then(() => {
      child.kill();
      throw new Error(`plugin lifecycle worker exceeded ${workerTimeoutMs}ms`);
    }),
  ]);
}

function outputLine(stdout: string): string {
  return stdout.trim().split("\n").at(-1) ?? "";
}

function parseWorkerRecord(line: string): JsonRecord {
  const parsed = asRecord(JSON.parse(line));
  if (!parsed) throw new Error("plugin lifecycle worker emitted a non-object result");
  return parsed;
}

function workerError(stderr: string, stdout: string, exitCode: number): Error {
  return new Error(stderr.trim() || stdout.trim() || `plugin lifecycle worker exited with code ${String(exitCode)}`);
}

function parseWorkerOutput([stdout, stderr, exitCode]: WorkerOutput): JsonRecord {
  try {
    return parseWorkerRecord(outputLine(stdout));
  } catch {
    throw workerError(stderr, stdout, exitCode);
  }
}

export async function runPluginLifecycleAudit(): Promise<JsonRecord> {
  requireCondition(fixture.schema_version === 1, "plugin lifecycle fixture schema_version must be 1");
  requireCondition(string(fixture.id) === "fixture:plugin-renderer-lifecycle", "plugin lifecycle fixture id is invalid");
  const temporaryRoot = mkdtempSync(join(tmpdir(), "openobsidian-plugin-lifecycle-"));
  try {
    const safe = await runSource(string(fixture.safe_source), temporaryRoot, "safe-lifecycle");
    const dom = await runSource(string(fixture.dom_source), temporaryRoot, "dom-denial");
    const workflow = await runSource(string(fixture.workflow_source), temporaryRoot, "lifecycle-workflow", "workflow");
    const safeLifecycle = record(safe.lifecycle, "safe lifecycle");
    const domLifecycle = record(dom.lifecycle, "DOM lifecycle");
    const expected = record(fixture.expected, "fixture expected");
    const expectedWorkflow = record(expected.workflow, "fixture workflow");
    const safeApi = record(safeLifecycle.api, "safe lifecycle API");
    const workflowData = record(workflow.workflow, "workflow result");
    const phases = records(workflowData.phases);
    const uninstall = record(workflowData.uninstall, "workflow uninstall");
    const checks = {
      ...lifecycleChecks(safe, dom, safeLifecycle, domLifecycle, expected, safeApi),
      ...workflowChecks(workflow, workflowData, phases, expectedWorkflow, uninstall),
    };
    requireCondition(Object.values(checks).every(Boolean), `Plugin lifecycle checks failed: ${JSON.stringify(checks)}`);
    return {
      schema_version: 1,
      status: "passed",
      command: "bun run audit:plugin-lifecycle",
      fixture_id: string(fixture.id),
      environment: {
        platform: platform(),
        architecture: arch(),
        display: process.env.DISPLAY ? "existing" : "xvfb-run",
      },
      checks,
      details: {safe, dom, workflow, safe_api: safeApi, workflow_phases: phases},
      limitations: asArray(fixture.external_pending).filter((entry): entry is string => typeof entry === "string"),
      result: "The synthetic Electron renderer wrapper completed marker-free lifecycle and restart/update/uninstall workflow traces, preserved mediated plugin data across restart/update, denied a privileged DOM request before onload completed, and recorded zero vault writes; unchanged plugin and reference behavior remain pending.",
    };
  } finally {
    rmSync(temporaryRoot, {recursive: true, force: true});
  }
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(await runPluginLifecycleAudit(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({schema_version: 1, status: "failed", command: "bun run audit:plugin-lifecycle", error: error instanceof Error ? error.message : String(error)}));
    process.exit(1);
  }
}
