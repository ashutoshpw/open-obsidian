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
  scenarios: Record<string, {workflow_id: string; description: string; initial_data: Record<string, unknown>; active_file?: string; files: Array<{path: string; content: string}>; calendar_workflow?: Record<string, unknown>; task_workflow?: Record<string, unknown>; table_workflow?: Record<string, unknown>; git_workflow?: Record<string, unknown>; kanban_workflow?: Record<string, unknown>; templater_workflow?: Record<string, unknown>}>;
  combination: {id: string; target_ids: string[]};
  required_combinations: Array<{id: string; target_ids: string[]; scenario_id?: string; dependency_artifacts?: Array<{artifact_id: string; assets: string[]}>; dependency_fixtures?: Array<{fixture_id: string; paths: string[]}>; files?: Array<{path: string; content: string}>}>;
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
  expect(fixture.target_ids).toEqual(["PC02", "PC03", "PC04", "PC05", "PC06", "PC07", "PC08", "PC09", "PC17", "PC19", "PC20", "PC21", "PC22", "PC23", "PC24", "PC25"]);
  expect(fixture.required_phases).toEqual(["install", "restart", "update"]);
  expect(fixture.combination).toMatchObject({id: "combination:pc07-pc21-pc23", target_ids: ["PC07", "PC21", "PC23"]});
  expect(fixture.combination.target_ids.every((id) => fixture.target_ids.includes(id))).toBe(true);
  expect(fixture.required_combinations).toEqual([
    expect.objectContaining({
      id: "combination:pc08-pc17-minimal",
      target_ids: ["PC08", "PC17"],
      scenario_id: "PC08",
      dependency_artifacts: [{artifact_id: "PC-DEP-MINIMAL", assets: ["manifest.json", "theme.css"]}],
    }),
    expect.objectContaining({
      id: "combination:pc19-bases",
      target_ids: ["PC19"],
      scenario_id: "PC19",
      dependency_fixtures: [{fixture_id: "fixture:baseline:bases", paths: ["TaskNotes/Views/tasks-default.base", "TaskNotes/Views/calendar-default.base"]}],
    }),
  ]);
  expect(fixture.required_combinations.every((combination) => combination.target_ids.every((id) => fixture.target_ids.includes(id)))).toBe(true);
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
  expect(rendererWorker).toContain("target.navigator = {");
  expect(rendererWorker).toContain("const safeNavigator = runtime.allowSyntheticDocument ? safeWindow.navigator : deniedObject");
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
  expect(rendererWorker).toContain("loadedSnapshotsByPlugin");
  expect(rendererWorker).toContain("persistedDataByPlugin");
  expect(rendererWorker).toContain("targetIds: Array.isArray(workflowConfig.target_ids)");
  expect(rendererWorker).toContain("detach() {");
  expect(rendererWorker).toContain("env.smart_sources.opts.prevent_import_on_load = true");
  expect(rendererWorker).toContain("runtime.window = undefined");
  expect(loadedWorkflowAudit).toContain('.filter((action) => action.status !== "passed")');
  expect(loadedWorkflowAudit).toContain("scopedPersistencePass");
  expect(loadedWorkflowAudit).toContain("loadedSnapshotsByPlugin");
  expect(loadedWorkflowAudit).toContain("combinationDefinitions");
  expect(loadedWorkflowAudit).toContain("verifyCombinationDependencies");
  expect(loadedWorkflowAudit).toContain("all_required_combinations_complete");

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
  expect(fixture.limitation).toContain("clipboard capture that never reaches the OS");
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

test("PC01 fixture covers bounded Excalidraw scene, links, export and reopen projection", () => {
  const pc01 = fixture.scenarios.PC01 as typeof fixture.scenarios.PC03 & {
    excalidraw_workflow?: {
      source_path: string;
      linked_asset_paths: string[];
      note_link_path: string;
      embed_path: string;
      expected_note_link: string;
      expected_embed: string;
      export_path: string;
      expected_export_mime: string;
      expected_scene_id: string;
      expected_element_count: number;
      edit_element_id: string;
      edit_probe_label: string;
      scripting_interface: {name: string; version: string; operations: string[]};
    };
  };
  expect(pc01.workflow_id).toBe("workflow:pc01");
  expect(pc01.files).toContainEqual(expect.objectContaining({path: "Drawings/Scene.excalidraw", content: expect.stringContaining("scene-1")}));
  expect(pc01.files).toContainEqual(expect.objectContaining({path: "Assets/reference.png"}));
  expect(pc01.excalidraw_workflow).toEqual({
    source_path: "Drawings/Scene.excalidraw",
    linked_asset_paths: ["Assets/reference.png"],
    note_link_path: "Notes/Context.md",
    embed_path: "Notes/Embed.md",
    expected_note_link: "[[Drawings/Scene.excalidraw]]",
    expected_embed: "![[Drawings/Scene.excalidraw]]",
    export_path: "Exports/Scene.svg",
    expected_export_mime: "image/svg+xml",
    expected_scene_id: "scene-1",
    expected_element_count: 2,
    edit_element_id: "scene-1",
    edit_probe_label: "bounded edit",
    scripting_interface: {
      name: "excalidraw-api",
      version: "2",
      operations: ["getScene", "updateScene", "exportImage"],
    },
  });
  expect(rendererWorker).toContain("function boundedExcalidrawWorkflow");
  expect(rendererWorker).toContain('mutation_scope: "bounded-in-memory-excalidraw-projection"');
  expect(rendererWorker).toContain("scriptingInterfaceRecorded");
  expect(rendererWorker).toContain("exportProjection");
  expect(loadedWorkflowAudit).toContain("function excalidrawWorkflowChecks");
  expect(loadedWorkflowAudit).toContain("bounded_excalidraw_projection");
  expect(loadedWorkflowAudit).toContain("excalidraw_bounded_projection_complete");
});

test("PC02 fixture and bounded projection cover safe Templater values and denied execution", () => {
  const pc02 = fixture.scenarios.PC02 as typeof fixture.scenarios.PC03 & {
    templater_workflow?: {
      template_path: string;
      include_path: string;
      output_path: string;
      moved_path: string;
      expected_output: string;
      dynamic_script: string;
      system_command: string;
      cursor_marker: string;
      expected_cursor_offset: number;
    };
  };
  expect(pc02.workflow_id).toBe("workflow:pc02");
  expect(pc02.files).toContainEqual(expect.objectContaining({path: "Templates/Note.md", content: expect.stringContaining("tp.file.include") }));
  expect(pc02.templater_workflow).toMatchObject({
    template_path: "Templates/Note.md",
    include_path: "Templates/Shared.md",
    output_path: "Notes/Generated.md",
    moved_path: "Archive/Generated.md",
    cursor_marker: "⟦cursor⟧",
    expected_cursor_offset: 96,
    dynamic_script: expect.stringContaining("tp.file.create_new"),
    system_command: "echo unsafe",
    expected_output: expect.stringContaining("<!-- user script disabled by D15 -->"),
  });
  expect(rendererWorker).toContain("function boundedTemplaterWorkflow");
  expect(rendererWorker).toContain("bounded-in-memory-templater-projection");
  expect(rendererWorker).toContain("dynamic_script_denied");
  expect(rendererWorker).toContain("system_command_denied");
  expect(loadedWorkflowAudit).toContain("function templaterWorkflowChecks");
  expect(loadedWorkflowAudit).toContain("templater_workflow_checks");
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

test("PC03 fixture and bounded projection cover DQL fields, links, tasks and safe refresh", () => {
  const pc03 = fixture.scenarios.PC03 as typeof fixture.scenarios.PC03 & {
    dataview_workflow?: {
      query: string;
      expected_columns: string[];
      expected_rows: Array<Record<string, unknown>>;
      expected_links: Array<Record<string, unknown>>;
      expected_tasks: Array<Record<string, unknown>>;
      external_edit: {path: string; expected_status: string};
      dataviewjs: {capability: string; expected_disposition: string; safe_alternative: string};
    };
  };
  expect(pc03.files).toContainEqual(expect.objectContaining({path: "Notes/Project.md", content: expect.stringContaining("[[Notes/Second]]")}));
  expect(pc03.dataview_workflow).toMatchObject({
    query: expect.stringContaining("TABLE status, priority, file.link"),
    expected_columns: ["file.path", "status", "priority", "file.link"],
    expected_rows: [
      {path: "Notes/Project.md", status: "active", priority: 2, link: "Notes/Project.md"},
      {path: "Notes/Second.md", status: "active", priority: 1, link: "Notes/Second.md"},
    ],
    external_edit: {path: "Notes/Second.md", expected_status: "paused"},
    dataviewjs: {capability: "code.dynamic", expected_disposition: "denied", safe_alternative: "bounded DQL projection"},
  });
  expect(rendererWorker).toContain("function boundedDataviewWorkflow");
  expect(rendererWorker).toContain("dataviewjs_denied");
  expect(rendererWorker).toContain("refresh_after_external_edit");
  expect(loadedWorkflowAudit).toContain("function dataviewWorkflowChecks");
  expect(loadedWorkflowAudit).toContain("dataview_workflow_checks");
  expect(loadedWorkflowAudit).toContain("rows_match");
});

test("PC04 fixture and bounded projection cover task query, grouping and surgical edits", () => {
  const pc04 = fixture.scenarios.PC04 as typeof fixture.scenarios.PC04 & {
    tasks_workflow?: {
      query: string;
      expected_query_rows: Array<Record<string, unknown>>;
      expected_group_counts: Record<string, number>;
      create_task: {line: string; insert_before: string};
      complete_task: {target_line: string; expected_line: string};
      expected_dates: string[];
      expected_recurrence: string;
      expected_output: string;
    };
  };
  expect(pc04.files).toContainEqual(expect.objectContaining({path: "Notes/Tasks.md", content: expect.stringContaining("🔁 every week when done") }));
  expect(pc04.tasks_workflow).toMatchObject({
    query: expect.stringContaining("group by status"),
    expected_query_rows: [
      {line: "- [ ] Prepare release 📅 2026-09-20 🔁 every week when done #task", status: "TODO", due: "2026-09-20", recurrence: "every week when done"},
      {line: "- [ ] Review compatibility ⏫ 📅 2026-09-22 #task", status: "TODO", due: "2026-09-22", recurrence: null},
    ],
    expected_group_counts: {TODO: 2},
    create_task: {line: "- [ ] Draft changelog 📅 2026-09-24 #task", insert_before: "Plain note remains untouched"},
    complete_task: {
      target_line: "- [ ] Prepare release 📅 2026-09-20 🔁 every week when done #task",
      expected_line: "- [x] Prepare release 📅 2026-09-20 🔁 every week when done #task",
    },
    expected_recurrence: "every week when done",
  });
  expect(pc04.tasks_workflow?.expected_dates).toEqual(["2026-09-20", "2026-09-22", "2026-09-01", "2026-09-24"]);
  expect(pc04.tasks_workflow?.expected_output).toContain("- [x] Prepare release");
  expect(pc04.tasks_workflow?.expected_output).toContain("- [ ] Draft changelog");
  expect(rendererWorker).toContain("function boundedTasksWorkflow");
  expect(rendererWorker).toContain('mutation_scope: "bounded-in-memory-task-projection"');
  expect(rendererWorker).toContain("recurrence_round_tripped");
  expect(rendererWorker).toContain("source_note_update_surgical");
  expect(loadedWorkflowAudit).toContain("function tasksWorkflowChecks");
  expect(loadedWorkflowAudit).toContain("tasks_workflow_checks");
  expect(loadedWorkflowAudit).toContain("create_task_projected");
});

test("PC05 fixture and bounded projection cover table edits, calculation and serialization", () => {
  const pc05 = fixture.scenarios.PC05 as typeof fixture.scenarios.PC03 & {
    table_workflow?: {
      source_path: string;
      expected_headers: string[];
      expected_row_count: number;
      edit_row: {key: string; expected_total: string};
      expected_output: string;
      untouched_path: string;
    };
  };
  expect(pc05.files).toContainEqual(expect.objectContaining({path: "Notes/Table.md", content: expect.stringContaining("| Widget | 2 | 12.50 | 25.00 |" )}));
  expect(pc05.table_workflow).toMatchObject({
    source_path: "Notes/Table.md",
    expected_headers: ["Item", "Qty", "Price", "Total"],
    expected_row_count: 2,
    edit_row: {key: "Widget", expected_total: "37.50"},
    untouched_path: "Notes/Untouched.md",
    expected_output: expect.stringContaining("| Widget | 3 | 12.50 | 37.50 |"),
  });
  expect(rendererWorker).toContain("function boundedTableWorkflow");
  expect(rendererWorker).toContain("bounded-in-memory-table-projection");
  expect(rendererWorker).toContain("parseMarkdownTable");
  expect(loadedWorkflowAudit).toContain("function tableWorkflowChecks");
  expect(loadedWorkflowAudit).toContain("table_workflow_checks");
  expect(loadedWorkflowAudit).toContain("serialization_match");
});

test("PC06 fixture and bounded projection keep Git actions explicit and credential-safe", () => {
  const pc06 = fixture.scenarios.PC06 as typeof fixture.scenarios.PC03 & {
    git_workflow?: {
      repository_path: string;
      default_branch: string;
      remote_name: string;
      credential_helper: string;
      status: {expected_branch: string; expected_dirty_paths: string[]; expected_staged_paths: string[]; expected_untracked_paths: string[]};
      diff: {path: string; before: string; after: string; expected_hunks: number};
      commit: {selected_paths: string[]; message: string; expected_revision: string};
      pull: {remote: string; branch: string; mode: string; expected_result: string};
      push: {remote: string; branch: string; mode: string; expected_result: string};
      conflict: {path: string; local_copy: string; remote_copy: string; expected_state: string};
      schedule: {pull_interval_minutes: number; push_interval_minutes: null; automatic_push: boolean; expected_disposition: string};
      denied_operations: Array<{operation: string; capability: string; disposition: string; safe_alternative: string}>;
    };
  };
  expect(pc06.initial_data).toMatchObject({
    repository: {path: "Chronicle", branch: "main", remote: "origin", credentialHelper: "os-keychain"},
    schedule: {pullIntervalMinutes: 30, pushIntervalMinutes: null, automaticPush: false},
  });
  expect(pc06.files).toContainEqual(expect.objectContaining({path: "Notes/Changed.md", content: "# Changed\n\nNew body.\n"}));
  expect(pc06.git_workflow).toMatchObject({
    repository_path: "Chronicle",
    default_branch: "main",
    remote_name: "origin",
    credential_helper: "os-keychain",
    status: {expected_branch: "main", expected_dirty_paths: ["Notes/Changed.md"], expected_staged_paths: ["Notes/Staged.md"], expected_untracked_paths: ["Notes/New.md"]},
    diff: {path: "Notes/Changed.md", expected_hunks: 1},
    commit: {selected_paths: ["Notes/Changed.md"], message: "Update compatibility", expected_revision: "abc1234"},
    pull: {remote: "origin", branch: "main", mode: "explicit", expected_result: "fast-forward"},
    push: {remote: "origin", branch: "main", mode: "explicit", expected_result: "pushed"},
    conflict: {path: "Notes/Conflict.md", local_copy: "Notes/Conflict.local.md", remote_copy: "Notes/Conflict.remote.md", expected_state: "protected"},
    schedule: {pull_interval_minutes: 30, push_interval_minutes: null, automatic_push: false, expected_disposition: "configured-but-not-run"},
  });
  expect(pc06.git_workflow?.denied_operations).toEqual([
    {operation: "git-process", capability: "process.spawn", disposition: "denied", safe_alternative: "mediated Chronicle Git action"},
    {operation: "credential-helper", capability: "credentials.read", disposition: "denied", safe_alternative: "preserve the configured helper name without reading credentials"},
  ]);
  expect(rendererWorker).toContain("function boundedGitWorkflow");
  expect(rendererWorker).toContain('mutation_scope: "bounded-in-memory-git-projection"');
  expect(rendererWorker).toContain("credential_helper_preserved");
  expect(rendererWorker).toContain("conflict_versions_preserved");
  expect(rendererWorker).toContain("automatic_push_disabled");
  expect(loadedWorkflowAudit).toContain("function gitWorkflowChecks");
  expect(loadedWorkflowAudit).toContain("git_workflow_checks");
  expect(loadedWorkflowAudit).toContain("credential_helper_not_read");
});

test("PC07 fixture and bounded projection cover daily paths, templates and weekly integration", () => {
  const pc07 = fixture.scenarios.PC07 as typeof fixture.scenarios.PC07 & {
    calendar_workflow?: {
      existing_date: string;
      create_date: string;
      week_date: string;
      daily_note: {
        format: string;
        folder: string;
        template: string;
        existing_path: string;
        expected_created_path: string;
        expected_created_output: string;
      };
      weekly_note: {
        format: string;
        folder: string;
        template: string;
        expected_path: string;
        expected_output: string;
      };
      expected_week_start: string;
      expected_locale: string;
      weekly_integration_disposition: string;
    };
  };
  expect(pc07.files).toContainEqual(expect.objectContaining({path: "Templates/Daily.md", content: "# {{title}}\n"}));
  expect(pc07.files).toContainEqual(expect.objectContaining({path: "Templates/Weekly.md", content: "# {{title}}\n"}));
  expect(pc07.initial_data).toMatchObject({
    weekStart: "monday",
    showWeeklyNote: true,
    weeklyNoteFormat: "GGGG-[W]WW",
    weeklyNoteTemplate: "Templates/Weekly.md",
    weeklyNoteFolder: "Weekly",
    dailyNoteFormat: "YYYY-MM-DD",
    dailyNoteTemplate: "Templates/Daily.md",
    dailyNoteFolder: "Daily",
  });
  expect(pc07.calendar_workflow).toMatchObject({
    existing_date: "2026-09-11",
    create_date: "2026-09-12",
    week_date: "2026-09-12",
    daily_note: {
      format: "YYYY-MM-DD",
      folder: "Daily",
      template: "Templates/Daily.md",
      existing_path: "Daily/2026-09-11.md",
      expected_created_path: "Daily/2026-09-12.md",
      expected_created_output: "# 2026-09-12\n",
    },
    weekly_note: {
      format: "GGGG-[W]WW",
      folder: "Weekly",
      template: "Templates/Weekly.md",
      expected_path: "Weekly/2026-W37.md",
      expected_output: "# 2026-W37\n",
    },
    expected_week_start: "monday",
    expected_locale: "en",
    weekly_integration_disposition: "configured-and-projected",
  });
  expect(rendererWorker).toContain("function boundedCalendarWorkflow");
  expect(rendererWorker).toContain('mutation_scope: "bounded-in-memory-calendar-projection"');
  expect(rendererWorker).toContain("weekly_integration_recorded");
  expect(loadedWorkflowAudit).toContain("function calendarWorkflowChecks");
  expect(loadedWorkflowAudit).toContain("calendar_workflow_checks");
  expect(loadedWorkflowAudit).toContain("daily_note_path_matches");
});

test("PC19 fixture covers note-backed tasks plus Bases view mappings", () => {
  const pc19 = fixture.scenarios.PC19;
  expect(pc19.files).toContainEqual(expect.objectContaining({path: "Notes/Task.md", content: expect.stringContaining("- [ ] Review compatibility #task")}));
  expect(pc19.files).toContainEqual(expect.objectContaining({path: "TaskNotes/Views/tasks-default.base"}));
  expect(pc19.files).toContainEqual(expect.objectContaining({path: "TaskNotes/Views/calendar-default.base"}));
  expect(pc19.initial_data).toMatchObject({taskTag: "task", defaultTaskStatus: "open", enableBases: true});
  expect(pc19.initial_data.commandFileMapping).toEqual({
    "open-tasks-view": "TaskNotes/Views/tasks-default.base",
    "open-calendar-view": "TaskNotes/Views/calendar-default.base",
  });
  expect(pc19.task_workflow).toEqual({
    target_path: "Notes/Task.md",
    expected_initial_status: "open",
    final_status: "done",
    expected_revision: "e2acd09d",
    stale_revision: "00000000",
  });
  expect(pc19.active_file).toBe("Notes/Task.md");
  expect(rendererWorker).toContain("return {id: command.id};");
  expect(rendererWorker).toContain("registerDomEvent(_target, _type, _callback, _options)");
  expect(rendererWorker).toContain("function boundedTaskWorkflow");
  expect(rendererWorker).toContain('mutation_scope: "bounded-revision-aware-writer"');
  expect(loadedWorkflowAudit).toContain("function taskWorkflowChecks");
  expect(loadedWorkflowAudit).toContain("task_workflow_checks");
});

test("PC08 fixture and detached DOM seam keep Style Settings bounded", () => {
  const pc08 = fixture.scenarios.PC08;
  expect(pc08.files).toContainEqual(expect.objectContaining({path: "Themes/Minimal.css"}));
  expect(rendererWorker).toContain("target.getElementsByTagName");
  expect(rendererWorker).toContain("detachLeavesOfType(type)");
  expect(rendererWorker).toContain('String(name).toLowerCase() === "head"');
});

test("PC09 fixture and bounded projection preserve Kanban board structure and links", () => {
  const pc09 = fixture.scenarios.PC09 as typeof fixture.scenarios.PC03 & {
    kanban_workflow?: {
      source_path: string;
      expected_frontmatter: Record<string, string>;
      expected_lanes: Array<{name: string; cards: string[]}>;
      move_card: {card: string; from_lane: string; to_lane: string; position: number};
      edit_card: {before: string; after: string; expected_link: string};
      expected_link_targets: string[];
      expected_output: string;
      untouched_path: string;
      expected_untouched_content: string;
    };
  };
  expect(pc09.initial_data).toMatchObject({version: 2, boardFolder: "Boards", preserveMetadata: true, cardSyntax: "checkbox"});
  expect(pc09.files).toContainEqual(expect.objectContaining({path: "Boards/Project.md", content: expect.stringContaining("## Backlog")}));
  expect(pc09.kanban_workflow).toEqual({
    source_path: "Boards/Project.md",
    expected_frontmatter: {"kanban-plugin": "board", board: "Project", owner: "Ashutosh"},
    expected_lanes: [
      {name: "Backlog", cards: ["Plan release", "Review compatibility [[Notes/Review.md|review notes]]"]},
      {name: "In Progress", cards: ["Implement projection [[Notes/Design.md|design notes]]"]},
      {name: "Done", cards: ["Ship baseline"]},
    ],
    move_card: {card: "Review compatibility [[Notes/Review.md|review notes]]", from_lane: "Backlog", to_lane: "In Progress", position: 1},
    edit_card: {before: "Implement projection [[Notes/Design.md|design notes]]", after: "Implement bounded projection [[Notes/Design.md|design notes]]", expected_link: "Notes/Design.md"},
    expected_link_targets: ["Notes/Review.md", "Notes/Design.md"],
    expected_output: "---\nkanban-plugin: board\nboard: Project\nowner: Ashutosh\n---\n\n## Backlog\n- [ ] Plan release\n\n## In Progress\n- [ ] Implement bounded projection [[Notes/Design.md|design notes]]\n- [ ] Review compatibility [[Notes/Review.md|review notes]]\n\n## Done\n- [x] Ship baseline\n",
    untouched_path: "Notes/Context.md",
    expected_untouched_content: "# Context\n\nThe board links back to this note.\n",
  });
  expect(rendererWorker).toContain("function boundedKanbanWorkflow");
  expect(rendererWorker).toContain('mutation_scope: "bounded-in-memory-kanban-projection"');
  expect(rendererWorker).toContain("parseKanbanBoard");
  expect(rendererWorker).toContain("links_preserved");
  expect(loadedWorkflowAudit).toContain("function kanbanWorkflowChecks");
  expect(loadedWorkflowAudit).toContain("kanban_workflow_checks");
  expect(loadedWorkflowAudit).toContain("move_projected");
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

test("PC23 fixture and recent-file seam remove stale entries read-only", () => {
  const pc23 = fixture.scenarios.PC23 as typeof fixture.scenarios.PC23 & {
    recent_files_workflow?: {
      stale_path: string;
      retained_path: string;
      rename_from: string;
      rename_to: string;
      rename_basename: string;
      delete_path: string;
      max_length: number;
    };
  };
  expect(pc23.initial_data.recentFiles).toContainEqual({path: "Archive/missing.md", basename: "missing"});
  expect(pc23.initial_data.recentFiles).toContainEqual({path: "Archive/old-note.md", basename: "old-note"});
  expect(pc23.recent_files_workflow).toEqual({
    stale_path: "Archive/missing.md",
    retained_path: "Daily/2026-09-12.md",
    rename_from: "Daily/2026-09-11.md",
    rename_to: "Daily/2026-09-12.md",
    rename_basename: "2026-09-12",
    delete_path: "Archive/old-note.md",
    max_length: 50,
  });
  expect(pc23.files).toContainEqual(expect.objectContaining({path: "Daily/2026-09-12.md"}));
  expect(rendererWorker).toContain("function boundedRecentFilesWorkflow");
  expect(rendererWorker).toContain('mutation_scope: "bounded-in-memory-projection"');
  expect(rendererWorker).toContain("stale_entries_removed");
  expect(rendererWorker).toContain("rename_entry_updated");
  expect(rendererWorker).toContain("delete_entry_removed");
  expect(rendererWorker).toContain("order_preserved");
  expect(rendererWorker).toContain("direct_vault_writes: 0");
  expect(loadedWorkflowAudit).toContain("function recentFilesWorkflowChecks");
  expect(loadedWorkflowAudit).toContain("recent_files_workflow_checks");
  expect(loadedWorkflowAudit).toContain("max_length_preserved");
  expect(loadedWorkflowAudit).toContain("rename_entry_updated");
  expect(loadedWorkflowAudit).toContain("delete_entry_removed");
  expect(loadedWorkflowAudit).toContain("direct_vault_writes_zero");
});

test("PC22 fixture and Smart Connections seam enforce local provenance and exclusions", () => {
  const pc22 = fixture.scenarios.PC22 as typeof fixture.scenarios.PC22 & {
    smart_connections_workflow?: {
      local_model: {identity: string; provider: string; model_key: string; provenance: string};
      excluded_folders: string[];
      excluded_paths: string[];
      expected_indexed_paths: string[];
      expected_excluded_paths: string[];
      remote_fallback_disabled: boolean;
      max_candidates: number;
    };
  };
  expect(pc22.smart_connections_workflow).toEqual({
    local_model: {
      identity: "local",
      provider: "transformers",
      model_key: "TaylorAI/bge-micro-v2",
      provenance: "bundled-local-transformers",
    },
    excluded_folders: ["Private"],
    excluded_paths: ["Private/Secret.md"],
    expected_indexed_paths: ["Notes/Context.md", "Notes/Related.md"],
    expected_excluded_paths: ["Private/Secret.md"],
    remote_fallback_disabled: true,
    max_candidates: 16,
  });
  expect(pc22.initial_data.settings).toMatchObject({embeddingModel: "local", excludedFolders: ["Private"]});
  expect(pc22.files).toContainEqual(expect.objectContaining({path: "Private/Secret.md"}));
  expect(rendererWorker).toContain("function boundedSmartConnectionsWorkflow");
  expect(rendererWorker).toContain('mutation_scope: "bounded-in-memory-projection"');
  expect(rendererWorker).toContain("local_model_provenance_verified");
  expect(rendererWorker).toContain("excluded_paths_match");
  expect(rendererWorker).toContain("remote_fallback_used");
  expect(rendererWorker).toContain("smart_sources_embed_queue_disabled");
  expect(rendererWorker).toContain("smart_blocks_embed_queue_disabled");
  expect(loadedWorkflowAudit).toContain("function smartConnectionsWorkflowChecks");
  expect(loadedWorkflowAudit).toContain("smart_connections_workflow_checks");
  expect(loadedWorkflowAudit).toContain("local_model_provenance_verified");
  expect(loadedWorkflowAudit).toContain("remote_fallback_not_used");
});

test("PC25 fixture and Linter seam require explicit deterministic automation", () => {
  const pc25 = fixture.scenarios.PC25 as typeof fixture.scenarios.PC25 & {
    linter_workflow?: {
      target_path: string;
      explicit_command: string;
      expected_lint_on_save: boolean;
      first_open_expected_mutations: number;
      enabled_rules: string[];
      yaml_key_priority_order: string[];
      expected_mutated_paths: string[];
      expected_unchanged_paths: string[];
      expected_output: string;
    };
  };
  expect(pc25.initial_data).toMatchObject({lintOnSave: true, lintOnFileChange: false});
  expect(pc25.linter_workflow).toEqual({
    target_path: "Notes/Lint.md",
    explicit_command: "lint-file",
    expected_lint_on_save: true,
    first_open_expected_mutations: 0,
    enabled_rules: ["yaml-key-sort", "headings-start-line", "line-break-at-document-end"],
    yaml_key_priority_order: ["title", "tags"],
    expected_mutated_paths: ["Notes/Lint.md"],
    expected_unchanged_paths: ["Notes/Untouched.md"],
    expected_output: "---\ntitle: Lint fixture\ntags:\n  - b\n  - a\n---\n\n# Heading\n\nBody\n",
  });
  expect(pc25.files).toContainEqual(expect.objectContaining({path: "Notes/Untouched.md"}));
  expect(rendererWorker).toContain("function boundedLinterWorkflow");
  expect(rendererWorker).toContain('mutation_scope: "bounded-in-memory-projection"');
  expect(rendererWorker).toContain("first_open_mutation_count");
  expect(rendererWorker).toContain("configured_yaml_output_match");
  expect(rendererWorker).toContain("direct_vault_writes_zero");
  expect(loadedWorkflowAudit).toContain("function linterWorkflowChecks");
  expect(loadedWorkflowAudit).toContain("linter_workflow_checks");
  expect(loadedWorkflowAudit).toContain("first_open_noop");
  expect(loadedWorkflowAudit).toContain("lint_on_save_matches");
});
