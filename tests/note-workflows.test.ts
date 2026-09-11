import {expect, test} from "bun:test";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildDailyNotePlan, buildTemplateIndex, openDailyNote} from "../src/core/note-workflows.js";
import {dailyNotePath, expandPlainTextTemplate, parseDailyNoteConfiguration, parseTemplateConfiguration} from "../src/shared/ui/index.js";
import {snapshotVault, VaultStore} from "../src/core/vault.js";

test("template and daily-note contracts keep configuration bounded and reusable", () => {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-note-workflows-vault-"));
  const appData = mkdtempSync(join(tmpdir(), "openobsidian-note-workflows-app-"));
  try {
    mkdirSync(join(root, ".obsidian"));
    mkdirSync(join(root, "Templates"));
    writeFileSync(join(root, ".obsidian", "templates.json"), JSON.stringify({folder: "Templates"}));
    writeFileSync(join(root, ".obsidian", "daily-notes.json"), JSON.stringify({folder: "Daily", format: "YYYY/MM/YYYY-MM-DD", template: "Templates/Daily.md"}));
    writeFileSync(join(root, "Templates", "Daily.md"), "# {{date}}\n\n{{title}} at {{time}}\n{{unknown}}\n");
    const store = new VaultStore(root, appData);
    const before = snapshotVault(root);
    const templates = buildTemplateIndex(store);
    const date = new Date(2026, 8, 11, 9, 5, 0);
    const plan = buildDailyNotePlan(store, date);

    expect(templates).toMatchObject({source: "obsidian-templates", folder: "Templates", items: [{relativePath: "Templates/Daily.md", title: "Daily"}]});
    expect(plan).toMatchObject({source: "obsidian-daily-notes", relativePath: "Daily/2026/09/2026-09-11.md", exists: false, template: "Templates/Daily.md", dateText: "2026/09/2026-09-11"});
    expect(snapshotVault(root).sha256).toBe(before.sha256);

    const created = openDailyNote(store, date);
    expect(created.relativePath).toBe("Daily/2026/09/2026-09-11.md");
    expect(readFileSync(join(root, created.relativePath), "utf8")).toBe("# 2026/09/2026-09-11\n\n2026-09-11 at 09:05\n{{unknown}}\n");
    expect(buildDailyNotePlan(store, date).exists).toBe(true);
    expect(openDailyNote(store, date).revision).toBe(created.revision);
  } finally {
    rmSync(root, {recursive: true, force: true});
    rmSync(appData, {recursive: true, force: true});
  }
});

test("daily-note and plain-text template helpers preserve unsafe or unknown syntax", () => {
  expect(parseTemplateConfiguration({folder: "../Templates"}).issues).toEqual(["Template folder must be a safe relative path"]);
  expect(parseDailyNoteConfiguration({folder: "Daily", template: "/outside.md"}).issues).toEqual(["Daily-note template must be a safe relative path"]);
  const settings = parseDailyNoteConfiguration({folder: "Daily", format: "YYYY-MM-DD"});
  expect(dailyNotePath(settings, new Date(2026, 0, 2))).toBe("Daily/2026-01-02.md");
  expect(expandPlainTextTemplate("{{date}} {{unknown}}", {date: "today", time: "now", title: "Note"})).toEqual({text: "today {{unknown}}", issues: ["Unsupported template variable remains literal: unknown"]});
});
