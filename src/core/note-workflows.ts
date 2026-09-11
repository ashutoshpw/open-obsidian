import {discoverVaultConfiguration} from "./configuration.js";
import {parseMarkdown} from "./markdown.js";
import {VaultStore} from "./vault.js";
import {dailyNotePath, expandPlainTextTemplate, formatDailyNoteDate, parseDailyNoteConfiguration, parseTemplateConfiguration, templateTitle, type DailyNotePlan, type TemplateIndex, type TemplateItem} from "../shared/ui/index.js";

function configuredJson(store: VaultStore, name: string): Record<string, unknown> | undefined {
  return discoverVaultConfiguration(store.root).json[`.obsidian/${name}`];
}

function markdownFiles(store: VaultStore, folder: string): Array<{relativePath: string; revision: string}> {
  const prefix = folder ? `${folder}/` : "";
  return store.scan().after.entries.filter((entry) => entry.kind === "file" && entry.relativePath.toLowerCase().endsWith(".md") && entry.relativePath.startsWith(prefix)).map((entry) => {
    const read = store.read(entry.relativePath);
    return {relativePath: read.relativePath, revision: read.revision};
  });
}

function templateItem(store: VaultStore, file: {relativePath: string; revision: string}, index: number): TemplateItem {
  return {id: `template.${index + 1}`, relativePath: file.relativePath, title: templateTitle(file.relativePath), revision: file.revision};
}

function templateItems(store: VaultStore, folder: string): TemplateItem[] {
  return markdownFiles(store, folder).sort((left, right) => left.relativePath.localeCompare(right.relativePath)).map((file, index) => templateItem(store, file, index));
}

export function buildTemplateIndex(store: VaultStore): TemplateIndex {
  const raw = configuredJson(store, "templates.json");
  if (!raw) return {source: "missing", folder: null, items: [], issues: ["No .obsidian/templates.json configuration was found"]};
  const settings = parseTemplateConfiguration(raw);
  const items = settings.issues.length === 0 ? templateItems(store, settings.folder) : [];
  return {source: "obsidian-templates", folder: settings.folder, items, issues: settings.issues};
}

function missingTemplateIssue(template: string | null, paths: ReadonlySet<string>): string | undefined {
  return template && !paths.has(template) ? `Daily-note template is not present in the selected vault: ${template}` : undefined;
}

export function buildDailyNotePlan(store: VaultStore, date = new Date()): DailyNotePlan {
  const raw = configuredJson(store, "daily-notes.json");
  if (!raw) return {source: "missing", relativePath: null, exists: false, folder: null, format: null, template: null, dateText: null, timeText: null, issues: ["No .obsidian/daily-notes.json configuration was found"]};
  const settings = parseDailyNoteConfiguration(raw);
  const relativePath = dailyNotePath(settings, date);
  const dateText = formatDailyNoteDate(date, settings.format);
  const timeText = formatDailyNoteDate(date, "HH:mm");
  const paths = new Set(store.scan().after.entries.filter((entry) => entry.kind === "file").map((entry) => entry.relativePath));
  const templateIssue = missingTemplateIssue(settings.template, paths);
  const issues = [...settings.issues, ...(relativePath ? [] : ["Daily-note format does not resolve to a safe relative path"]), ...(templateIssue ? [templateIssue] : [])];
  return {source: "obsidian-daily-notes", relativePath, exists: relativePath ? paths.has(relativePath) : false, folder: settings.folder, format: settings.format, template: settings.template, dateText, timeText, issues};
}

export function openDailyNote(store: VaultStore, date = new Date()) {
  const plan = buildDailyNotePlan(store, date);
  if (!plan.relativePath) throw new Error(plan.issues[0] ?? "Daily note path is unavailable");
  if (plan.issues.length > 0) throw new Error(plan.issues[0]!);
  if (plan.exists) return store.read(plan.relativePath);
  let text = "";
  if (plan.template) {
    const template = parseMarkdown(store.read(plan.template).bytes).text;
    text = expandPlainTextTemplate(template, {date: plan.dateText ?? "", time: plan.timeText ?? "", title: templateTitle(plan.relativePath)}).text;
  }
  return store.write({relativePath: plan.relativePath, expectedRevision: null, bytes: new TextEncoder().encode(text)});
}
