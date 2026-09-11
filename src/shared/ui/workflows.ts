export type BookmarkKind = "file" | "folder" | "search" | "block" | "group";

export type BookmarkItem = {
  id: string;
  kind: BookmarkKind;
  title: string;
  path?: string;
  subpath?: string;
  query?: string;
  items?: BookmarkItem[];
  available: boolean;
};

export type BookmarkResponse = {
  source: "obsidian-bookmarks" | "missing";
  items: BookmarkItem[];
  issues: string[];
};

export type TagOccurrence = {
  tag: string;
  line: number;
  text: string;
  source: "frontmatter" | "inline";
};

export type TagFileSummary = {
  relativePath: string;
  count: number;
  lines: number[];
};

export type TagSummary = {
  tag: string;
  count: number;
  files: TagFileSummary[];
};

export type TagIndex = {
  tags: TagSummary[];
  filesScanned: number;
};

export type TaskItem = {
  id: string;
  relativePath: string;
  revision?: string;
  line: number;
  checked: boolean;
  text: string;
  recurrence?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeRelativePath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("/") || value.includes("\\") || value.includes("\0")) return undefined;
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return undefined;
  return normalized;
}

function safeSubpath(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 500 ? value : undefined;
}

function fenceMarker(line: string): boolean {
  return /^\s*(?:`{3,}|~{3,})/.test(line);
}

function frontmatterOpening(line: string, lineNumber: number): boolean {
  return lineNumber === 1 && /^\uFEFF?---[ \t]*$/.test(line);
}

function frontmatterClosing(line: string): boolean {
  return /^---[ \t]*$/.test(line);
}

function defaultBookmarkTitle(kind: BookmarkKind, path: string | undefined, query: string | undefined): string {
  if (kind === "search") return query || "Saved search";
  if (kind === "group") return "Bookmark group";
  if (path) return path.split("/").at(-1) || path;
  return kind === "block" ? "Saved block" : "Bookmark";
}

function bookmarkPathAvailable(item: BookmarkItem, paths: ReadonlySet<string>): boolean {
  if (item.kind === "search") return true;
  if (item.kind === "group") return Boolean(item.items?.some((child) => child.available));
  if (!item.path) return false;
  if (item.kind === "folder") return [...paths].some((candidate) => candidate === item.path || candidate.startsWith(`${item.path}/`));
  return paths.has(item.path);
}

export function annotateBookmarks(items: BookmarkItem[], paths: readonly string[]): BookmarkItem[] {
  const knownPaths = new Set(paths);
  return items.map((item) => {
    const children = item.items ? annotateBookmarks(item.items, paths) : undefined;
    const annotated = children ? {...item, items: children} : item;
    return {...annotated, available: bookmarkPathAvailable(annotated, knownPaths)};
  });
}

const bookmarkKinds = new Set(["file", "folder", "search", "block", "group"]);

function bookmarkKind(rawType: unknown, hasChildren: boolean): BookmarkKind | null {
  if (hasChildren) return "group";
  if (typeof rawType !== "string" || !bookmarkKinds.has(rawType)) return null;
  return rawType as BookmarkKind;
}

function bookmarkFieldIssue(kind: BookmarkKind, path: string | undefined, query: string | undefined, id: string): string | undefined {
  if (kind !== "group" && kind !== "search" && !path) return `${id} requires a safe relative path`;
  if (kind === "search" && !query) return `${id} requires a saved search query`;
  return undefined;
}

function parseBookmarkChildren(rawItems: unknown[], id: string, issues: string[]): BookmarkItem[] {
  const children: BookmarkItem[] = [];
  rawItems.forEach((child, index) => {
    const parsed = parseBookmarkItem(child, `${id}.${index + 1}`, issues);
    if (parsed) children.push(parsed);
  });
  return children;
}

function bookmarkOptionalFields(path: string | undefined, subpath: string | undefined, query: string | undefined): Pick<BookmarkItem, "path" | "subpath" | "query" | "items"> {
  const fields: Pick<BookmarkItem, "path" | "subpath" | "query" | "items"> = {};
  if (path) fields.path = path;
  if (subpath) fields.subpath = subpath;
  if (query) fields.query = query;
  return fields;
}

function bookmarkTitle(raw: Record<string, unknown>, kind: BookmarkKind, path: string | undefined, query: string | undefined): string {
  if (typeof raw.title === "string" && raw.title.trim()) return raw.title.trim();
  return defaultBookmarkTitle(kind, path, query);
}

function bookmarkChildren(raw: Record<string, unknown>, kind: BookmarkKind, id: string, issues: string[]): BookmarkItem[] | undefined {
  if (kind !== "group" || !Array.isArray(raw.items)) return undefined;
  return parseBookmarkChildren(raw.items, id, issues);
}

function parseBookmarkItem(raw: unknown, id: string, issues: string[]): BookmarkItem | null {
  if (!isRecord(raw)) {
    issues.push(`${id} is not an object`);
    return null;
  }
  const kind = bookmarkKind(raw.type, Array.isArray(raw.items));
  if (!kind) {
    issues.push(`${id} has an unsupported bookmark type`);
    return null;
  }
  const path = safeRelativePath(raw.path);
  const subpath = safeSubpath(raw.subpath);
  const query = typeof raw.query === "string" && raw.query.trim() ? raw.query.trim() : undefined;
  const issue = bookmarkFieldIssue(kind, path, query, id);
  if (issue) {
    issues.push(issue);
    return null;
  }
  const title = bookmarkTitle(raw, kind, path, query);
  const children = bookmarkChildren(raw, kind, id, issues);
  const optional = bookmarkOptionalFields(path, subpath, query);
  if (children) optional.items = children;
  return {id, kind, title, ...optional, available: true};
}

export function parseBookmarkConfiguration(value: unknown): {items: BookmarkItem[]; issues: string[]} {
  const issues: string[] = [];
  if (!isRecord(value) || !Array.isArray(value.items)) return {items: [], issues: ["Bookmark configuration has no items array"]};
  const items: BookmarkItem[] = [];
  value.items.forEach((item, index) => {
    const parsed = parseBookmarkItem(item, `bookmark.${index + 1}`, issues);
    if (parsed) items.push(parsed);
  });
  return {items, issues};
}

function normalizeTag(value: string): string | undefined {
  const unquoted = value.trim().replace(/^['"]|['"]$/g, "").replace(/^#/, "");
  return /^[\p{L}\p{N}_][\p{L}\p{N}_/-]*$/u.test(unquoted) ? unquoted.toLocaleLowerCase() : undefined;
}

function frontmatterTagValues(value: string): string[] {
  const trimmed = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  const tokens: string[] = [];
  const tokenPattern = /"([^"\n]+)"|'([^'\n]+)'|([^,\s]+)/g;
  for (const match of trimmed.matchAll(tokenPattern)) tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  return tokens;
}

function tagOccurrencesFromLine(line: string, lineNumber: number, source: TagOccurrence["source"]): TagOccurrence[] {
  if (source === "frontmatter") {
    return frontmatterTagValues(line).flatMap((value) => {
      const tag = normalizeTag(value);
      return tag ? [{tag, line: lineNumber, text: line.trim(), source}] : [];
    });
  }
  const searchable = line.replace(/`[^`\r\n]*`/g, "");
  return [...searchable.matchAll(/(?<![\p{L}\p{N}_/-])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu)].flatMap((match) => {
    const tag = normalizeTag(match[1] ?? "");
    return tag ? [{tag, line: lineNumber, text: line.trim(), source}] : [];
  });
}

type FrontmatterTagLine = {handled: boolean; inFrontmatter: boolean; inTagsList: boolean; occurrences: TagOccurrence[]};

function inspectFrontmatterTagLine(line: string, lineNumber: number, inTagsList: boolean): FrontmatterTagLine {
  if (frontmatterClosing(line)) return {handled: true, inFrontmatter: false, inTagsList: false, occurrences: []};
  const tagsProperty = /^\s*tags\s*:\s*(.*)$/.exec(line);
  if (tagsProperty) {
    const value = tagsProperty[1] ?? "";
    return {handled: true, inFrontmatter: true, inTagsList: !value.trim(), occurrences: tagOccurrencesFromLine(value, lineNumber, "frontmatter")};
  }
  if (inTagsList) {
    const listValue = /^\s*-\s*(.+)$/.exec(line);
    if (listValue) return {handled: true, inFrontmatter: true, inTagsList: true, occurrences: tagOccurrencesFromLine(listValue[1] ?? "", lineNumber, "frontmatter")};
    return {handled: true, inFrontmatter: true, inTagsList: false, occurrences: []};
  }
  return {handled: true, inFrontmatter: true, inTagsList: false, occurrences: []};
}

export function extractMarkdownTags(source: string): TagOccurrence[] {
  const lines = source.split(/\r\n|\n|\r/);
  const occurrences: TagOccurrence[] = [];
  let inFrontmatter = false;
  let inTagsList = false;
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineNumber = index + 1;
    if (frontmatterOpening(line, lineNumber)) {
      inFrontmatter = true;
      inTagsList = false;
      continue;
    }
    if (inFrontmatter && frontmatterClosing(line)) {
      inFrontmatter = false;
      inTagsList = false;
      continue;
    }
    if (inFrontmatter) {
      const frontmatter = inspectFrontmatterTagLine(line, lineNumber, inTagsList);
      occurrences.push(...frontmatter.occurrences);
      inFrontmatter = frontmatter.inFrontmatter;
      inTagsList = frontmatter.inTagsList;
      continue;
    }
    if (fenceMarker(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) occurrences.push(...tagOccurrencesFromLine(line, lineNumber, "inline"));
  }
  return occurrences;
}

type TagAccumulator = {count: number; files: Map<string, {count: number; lines: number[]}>};

function addTagOccurrence(byTag: Map<string, TagAccumulator>, relativePath: string, occurrence: TagOccurrence): void {
  const summary = byTag.get(occurrence.tag) ?? {count: 0, files: new Map()};
  summary.count += 1;
  const file = summary.files.get(relativePath) ?? {count: 0, lines: []};
  file.count += 1;
  if (!file.lines.includes(occurrence.line)) file.lines.push(occurrence.line);
  summary.files.set(relativePath, file);
  byTag.set(occurrence.tag, summary);
}

function tagSummary(entry: [string, TagAccumulator]): TagSummary {
  const [tag, summary] = entry;
  const files = [...summary.files.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([relativePath, file]) => ({relativePath, count: file.count, lines: [...file.lines].sort((left, right) => left - right)}));
  return {tag, count: summary.count, files};
}

export function buildTagSummaries(records: readonly {relativePath: string; occurrences: readonly TagOccurrence[]}[]): TagSummary[] {
  const byTag = new Map<string, TagAccumulator>();
  for (const record of records) for (const occurrence of record.occurrences) addTagOccurrence(byTag, record.relativePath, occurrence);
  return [...byTag.entries()].sort(([left], [right]) => left.localeCompare(right)).map(tagSummary);
}

const taskLinePattern = /^(\s*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\][ \t]+)(.*)$/;

function taskFromLine(line: string, relativePath: string, lineNumber: number): TaskItem | null {
  const match = taskLinePattern.exec(line);
  if (!match) return null;
  const text = match[4] ?? "";
  const recurrenceMatch = /(?:^|\s)(🔁\s+.+)$/u.exec(text);
  return {id: `${relativePath}#L${lineNumber}`, relativePath, line: lineNumber, checked: (match[2] ?? "").toLocaleLowerCase() === "x", text, ...(recurrenceMatch?.[1] ? {recurrence: recurrenceMatch[1]} : {})};
}

export function extractMarkdownTasks(source: string, relativePath: string): TaskItem[] {
  const tasks: TaskItem[] = [];
  let inFrontmatter = false;
  let inFence = false;
  const lines = source.split(/\r\n|\n|\r/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineNumber = index + 1;
    if (frontmatterOpening(line, lineNumber)) {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter && frontmatterClosing(line)) {
      inFrontmatter = false;
      continue;
    }
    if (inFrontmatter) continue;
    if (fenceMarker(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const task = taskFromLine(line, relativePath, lineNumber);
    if (task) tasks.push(task);
  }
  return tasks;
}

export function toggleMarkdownTaskSource(source: string, line: number, checked: boolean): string {
  if (!Number.isSafeInteger(line) || line < 1) throw new Error("Task line must be a positive integer");
  const parts = source.split(/(\r\n|\n|\r)/);
  const bodyIndex = (line - 1) * 2;
  const current = parts[bodyIndex];
  if (current === undefined) throw new Error(`Task line does not exist: ${line}`);
  if (!taskLinePattern.test(current)) throw new Error(`Markdown task is not represented at line ${line}`);
  parts[bodyIndex] = current.replace(taskLinePattern, (_full, prefix: string, _marker: string, suffix: string, text: string) => `${prefix}${checked ? "x" : " "}${suffix}${text}`);
  return parts.join("");
}
