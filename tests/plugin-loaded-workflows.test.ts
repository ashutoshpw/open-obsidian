import {expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";

type LoadedWorkflowFixture = {
  schema_version: number;
  id: string;
  checkpoint: string;
  decision_id: string;
  boundary: string;
  target_ids: string[];
  required_phases: string[];
  scenarios: Record<string, {workflow_id: string; description: string; initial_data: Record<string, unknown>; files: Array<{path: string; content: string}>}>;
  combination: {id: string; target_ids: string[]};
  safe_alternatives_attempted: string[];
  external_pending: string[];
  limitation: string;
};

const root = resolve(import.meta.dir, "..");
const fixture = JSON.parse(readFileSync(join(root, "fixtures/plugin-loaded-workflows.json"), "utf8")) as LoadedWorkflowFixture;
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {scripts?: Record<string, string>};
const workflow = readFileSync(join(root, ".github/workflows/plugin-loaded-workflows.yml"), "utf8");
const rendererWorker = readFileSync(join(root, "scripts/plugin-renderer-worker.cjs"), "utf8");
const loadedWorkflowAudit = readFileSync(join(root, "scripts/audit-plugin-loaded-workflows.ts"), "utf8");

test("loaded-plugin workflow fixture keeps pinned scope and lifecycle boundaries explicit", () => {
  expect(fixture.schema_version).toBe(1);
  expect(fixture.id).toBe("fixture:plugin-loaded-workflows");
  expect(fixture.checkpoint).toBe("P3.2");
  expect(fixture.decision_id).toBe("D14");
  expect(fixture.boundary).toBe("electron-renderer");
  expect(fixture.target_ids).toEqual(["PC07", "PC08", "PC17", "PC20", "PC21", "PC22", "PC23", "PC24"]);
  expect(fixture.required_phases).toEqual(["install", "restart", "update"]);
  expect(fixture.combination).toMatchObject({id: "combination:pc07-pc21-pc23", target_ids: ["PC07", "PC21", "PC23"]});
  expect(fixture.combination.target_ids.every((id) => fixture.target_ids.includes(id))).toBe(true);
  expect(packageJson.scripts?.["audit:plugin-loaded-workflows"]).toBe("bun scripts/audit-plugin-loaded-workflows.ts");
  expect(workflow).toContain("name: OpenObsidian loaded plugin workflows");
  expect(workflow).toContain("os: [ubuntu-latest, macos-latest, windows-latest]");
  expect(workflow).toContain("bun run audit:plugin-loaded-workflows");
  expect(workflow).toContain("actions/upload-artifact@v4");
  expect(workflow).toContain("require.resolve('electron/package.json')");
  expect(workflow).toContain('node "$electron_package_dir/install.js"');
  expect(workflow).toContain('test -f "$sandbox_helper"');
  expect(workflow).toContain('sudo chmod 4755 "$sandbox_helper"');
  expect(rendererWorker).toContain("deniedPaths");
  expect(rendererWorker).toContain('"vault.direct-write"');
  expect(rendererWorker).toContain("boundedStorage");
  expect(rendererWorker).toContain("persistedData");
  expect(rendererWorker).toContain("bounded action timeout");
  expect(rendererWorker).toContain("evaluatePhase");
  expect(rendererWorker).toContain("getElementsByClassName");
  expect(rendererWorker).toContain("target.documentElement = safeDomObject();");
  expect(rendererWorker).toContain("target.createElementNS = () => safeDomObject();");
  expect(rendererWorker).toContain("moment.updateLocale =");
  expect(rendererWorker).toContain("target._bundledLocaleWeekSpec = {dow: 0};");
  expect(rendererWorker).toContain("registerHoverLinkSource() {}");
  expect(rendererWorker).toContain("function boundedEditorAdapter");
  expect(rendererWorker).toContain('specifier === "@codemirror/language"');
  expect(rendererWorker).toContain("foldedRanges()");
  expect(rendererWorker).toContain("getRange(from, to)");
  expect(rendererWorker).toContain("replaceRange(replacement, from, to = from)");
  expect(rendererWorker).toContain("editorCallback");
  expect(rendererWorker).not.toContain('status: "not-executed"');
  expect(rendererWorker).toContain("globalThis.app = runtime.window?.app || runtime.app || null");
  expect(rendererWorker).toContain("globalThis.app = pluginApp");
  expect(rendererWorker).toContain("updateFontSize() {");
  expect(rendererWorker).toContain("this.fontSize = typeof value === \"number\" && Number.isFinite(value) ? value : null;");
  expect(rendererWorker).toContain("titleEl: safeDomObject()");
  expect(rendererWorker).toContain("target.createRange = () => ({createContextualFragment: () => safeDomObject()");
  expect(rendererWorker).toContain("if (property === \"then\") return undefined");
  expect(rendererWorker).toContain("const internalFiles = dataStore?.internalFiles instanceof Map");
  expect(rendererWorker).toContain("dataStore.initialByPlugin");
  expect(rendererWorker).toContain("persistedDataByPlugin");
  expect(rendererWorker).toContain("detach() {");
  expect(rendererWorker).toContain("env.smart_sources.opts.prevent_import_on_load = true");
  expect(rendererWorker).toContain("runtime.window = undefined");
  expect(loadedWorkflowAudit).toContain('.filter((action) => action.status !== "passed")');
  expect(loadedWorkflowAudit).toContain("scopedPersistencePass");

  for (const id of fixture.target_ids) {
    const scenario = fixture.scenarios[id];
    expect(scenario.workflow_id).toBe(`workflow:${id.toLowerCase()}`);
    expect(scenario.description.length).toBeGreaterThan(20);
    expect(Object.keys(scenario.initial_data).length).toBeGreaterThan(0);
    expect(scenario.files.length).toBeGreaterThan(0);
    expect(scenario.files.every((file) => file.path.length > 0 && file.content.length > 0)).toBe(true);
  }

  expect(fixture.safe_alternatives_attempted).toEqual(["mediated vault read", "bounded renderer preview", "workflow disabled"]);
  expect(fixture.external_pending.length).toBeGreaterThanOrEqual(5);
  expect(fixture.limitation).toContain("unchanged pinned main.js bytes");
  expect(fixture.limitation).toContain("does not certify stock Obsidian");
});

test("renderer wrapper permits plugin-local app bindings", () => {
  const argumentBlock = rendererWorker.match(/const factory = new Function\(\n([\s\S]*?)\n\s+`"use strict/)?.[1];
  expect(argumentBlock).toBeDefined();
  const formalNames = [...(argumentBlock ?? "").matchAll(/"([^"\\]+)"/g)].map((match) => match[1]);
  expect(formalNames).not.toContain("app");

  const module = {exports: {}};
  const pluginLocalApp = new Function(...formalNames, "const app = {name: 'plugin-local'}; module.exports = app;");
  expect(() => pluginLocalApp(module, module.exports, ...formalNames.slice(2).map(() => undefined))).not.toThrow();
  expect(module.exports).toEqual({name: "plugin-local"});
});

test("PC20 fixture and bounded editor trace cover mutation history and folding", () => {
  const pc20 = fixture.scenarios.PC20;
  expect(pc20.files).toContainEqual({
    path: "Notes/Outline.md",
    content: "- First\n  - First child\n- Parent\n  - Child\n- Last\n",
  });
  expect(rendererWorker).toContain("const history = [];");
  expect(rendererWorker).toContain("const redoHistory = [];");
  expect(rendererWorker).toContain("dispatch(transaction = {})");
  expect(rendererWorker).toContain("foldedRanges()");
  expect(rendererWorker).toContain("foldEffect: {of(value) { return {type: \"fold\", range: value}; }}");
  expect(rendererWorker).toContain("unfoldEffect: {of(value) { return {type: \"unfold\", range: value}; }}");
  expect(rendererWorker).toContain("canUndo() { return history.length > 0; }");
  expect(rendererWorker).toContain("canRedo() { return redoHistory.length > 0; }");
  expect(rendererWorker).toContain("editorSnapshot() { return snapshot(); }");
  expect(rendererWorker).toContain("while (pluginApp.editor.canUndo()) pluginApp.editor.undo();");
  expect(loadedWorkflowAudit).toContain("undo_restores_prior_bytes");
  expect(loadedWorkflowAudit).toContain("redo_restores_command_bytes");
  expect(loadedWorkflowAudit).toContain("folding_round_trip");
  expect(loadedWorkflowAudit).toContain("phase_editor_round_trip");
  expect(loadedWorkflowAudit).toContain("editor_checks: editor");
});

test("PC08 fixture and detached DOM seam keep Style Settings bounded", () => {
  const pc08 = fixture.scenarios.PC08;
  expect(pc08.files).toContainEqual(expect.objectContaining({path: "Themes/Minimal.css"}));
  expect(rendererWorker).toContain("target.getElementsByTagName");
  expect(rendererWorker).toContain("detachLeavesOfType(type)");
  expect(rendererWorker).toContain('String(name).toLowerCase() === "head"');
});

test("PC24 fixture and event seam keep Tag Wrangler mutations editor-only", () => {
  const pc24 = fixture.scenarios.PC24 as typeof fixture.scenarios.PC24 & {
    tag_workflow?: {source_tag: string; target_tag: string; expected_unrelated_property: string; expected_unrelated_text: string};
  };
  expect(pc24.tag_workflow).toMatchObject({
    source_tag: "project/open",
    target_tag: "archive/open",
    expected_unrelated_property: "owner: keep",
    expected_unrelated_text: "project/opening remains plain text",
  });
  expect((fixture.scenarios.PC24 as typeof pc24 & {exercise_events?: string[]}).exercise_events).toEqual(["editor-menu", "changed", "delete"]);
  expect(pc24.files).toContainEqual(expect.objectContaining({
    path: "Notes/Tags.md",
    content: expect.stringContaining("project/open/sub"),
  }));
  expect(rendererWorker).toContain("eventHandlers");
  expect(rendererWorker).toContain("function boundedMenu()");
  expect(rendererWorker).toContain("Workflow-mode clipboard capture is deliberately renderer-local");
  expect(rendererWorker).toContain("synthetic clipboard payload exceeds bounded limit");
  expect(rendererWorker).toContain("getClickableTokenAt(position)");
  expect(rendererWorker).toContain("function boundedTagWorkflow");
  expect(rendererWorker).toContain('mutation_scope: "bounded-editor-only"');
  expect(loadedWorkflowAudit).toContain("tagWorkflowChecks");
  expect(loadedWorkflowAudit).toContain("clipboard_external_writes_zero");
  expect(loadedWorkflowAudit).toContain("event_attempts_recorded");
});
