export type TemplateItem = {
  id: string;
  relativePath: string;
  title: string;
  revision: string;
};

export type TemplateIndex = {
  source: "obsidian-templates" | "missing";
  folder: string | null;
  items: TemplateItem[];
  issues: string[];
};

export type TemplateSettings = {
  folder: string;
  issues: string[];
};

export type DailyNoteSettings = {
  folder: string;
  format: string;
  template: string | null;
  issues: string[];
};

export type DailyNotePlan = {
  source: "obsidian-daily-notes" | "missing";
  relativePath: string | null;
  exists: boolean;
  folder: string | null;
  format: string | null;
  template: string | null;
  dateText: string | null;
  timeText: string | null;
  issues: string[];
};

export type TemplateExpansion = {
  text: string;
  issues: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeRelativePath(value: unknown, allowEmpty = false): string | undefined {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.startsWith("/") || value.includes("\\") || value.includes("\0")) return undefined;
  if (value.length === 0) return "";
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return undefined;
  return normalized;
}

export function parseTemplateConfiguration(value: unknown): TemplateSettings {
  if (!isRecord(value)) return {folder: "", issues: ["Template configuration is not an object"]};
  if (value.folder === undefined) return {folder: "", issues: []};
  const folder = safeRelativePath(value.folder, true);
  return folder === undefined ? {folder: "", issues: ["Template folder must be a safe relative path"]} : {folder, issues: []};
}

export function parseDailyNoteConfiguration(value: unknown): DailyNoteSettings {
  if (!isRecord(value)) return {folder: "", format: "YYYY-MM-DD", template: null, issues: ["Daily-note configuration is not an object"]};
  const issues: string[] = [];
  const folder = value.folder === undefined ? "" : safeRelativePath(value.folder, true);
  if (folder === undefined) issues.push("Daily-note folder must be a safe relative path");
  const format = typeof value.format === "string" && value.format.trim() ? value.format.trim() : "YYYY-MM-DD";
  const template = value.template === undefined || value.template === null || value.template === "" ? null : safeRelativePath(value.template);
  if (value.template !== undefined && value.template !== null && value.template !== "" && template === undefined) issues.push("Daily-note template must be a safe relative path");
  return {folder: folder ?? "", format, template: template ?? null, issues};
}

function padded(value: number): string {
  return String(value).padStart(2, "0");
}

function dateTokens(date: Date): Record<string, string> {
  return {
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear()).slice(-2),
    MM: padded(date.getMonth() + 1),
    DD: padded(date.getDate()),
    HH: padded(date.getHours()),
    mm: padded(date.getMinutes()),
    ss: padded(date.getSeconds()),
  };
}

export function formatDailyNoteDate(date: Date, format: string): string {
  const tokens = dateTokens(date);
  return format.replace(/YYYY|YY|MM|DD|HH|mm|ss/g, (token) => tokens[token] ?? token);
}

export function dailyNotePath(settings: DailyNoteSettings, date: Date): string | null {
  const formatted = formatDailyNoteDate(date, settings.format);
  const path = [settings.folder, `${formatted}.md`].filter(Boolean).join("/");
  return safeRelativePath(path) ?? null;
}

export function templateTitle(relativePath: string): string {
  const name = relativePath.split("/").at(-1) ?? relativePath;
  return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

export function expandPlainTextTemplate(source: string, variables: {date: string; time: string; title: string}): TemplateExpansion {
  const issues: string[] = [];
  const known = new Set<string>();
  const values = {date: variables.date, time: variables.time, title: variables.title};
  const text = source.replace(/\{\{([^{}]+)\}\}/g, (match, rawKey: string) => {
    const key = rawKey.trim();
    if (key in values) return values[key as keyof typeof values];
    if (!known.has(key)) {
      known.add(key);
      issues.push(`Unsupported template variable remains literal: ${key}`);
    }
    return match;
  });
  return {text, issues};
}
