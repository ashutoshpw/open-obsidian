import {discoverVaultConfiguration} from "./configuration.js";
import {parseMarkdown} from "./markdown.js";
import {VaultStore} from "./vault.js";
import {annotateBookmarks, buildTagSummaries, extractMarkdownTags, extractMarkdownTasks, parseBookmarkConfiguration, toggleMarkdownTaskSource, type BookmarkItem, type BookmarkResponse, type TagIndex, type TaskItem} from "../shared/ui/index.js";

function markdownRecords(store: VaultStore): Array<{relativePath: string; text: string; revision: string}> {
  return store.scan().after.entries.filter((entry) => entry.kind === "file" && entry.relativePath.toLocaleLowerCase().endsWith(".md")).map((entry) => {
    const read = store.read(entry.relativePath);
    return {relativePath: read.relativePath, text: parseMarkdown(read.bytes).text, revision: read.revision};
  });
}

export function buildBookmarkIndex(store: VaultStore): BookmarkResponse {
  const configuration = discoverVaultConfiguration(store.root);
  const raw = configuration.json[".obsidian/bookmarks.json"];
  if (!raw) return {source: "missing", items: [], issues: ["No .obsidian/bookmarks.json configuration was found"]};
  const parsed = parseBookmarkConfiguration(raw);
  const paths = store.scan().after.entries.filter((entry) => entry.kind === "file").map((entry) => entry.relativePath);
  const items = annotateBookmarks(parsed.items, paths);
  const missing = items.flatMap((item) => missingBookmarkPaths(item));
  return {source: "obsidian-bookmarks", items, issues: [...parsed.issues, ...missing.map((path) => `Bookmark target is not present in the selected vault: ${path}`)]};
}

function missingBookmarkPaths(item: BookmarkItem): string[] {
  const children = item.items?.flatMap(missingBookmarkPaths) ?? [];
  if (item.available || item.kind === "search" || !item.path) return children;
  return [item.path, ...children];
}

export function buildTagIndex(store: VaultStore): TagIndex {
  const records = markdownRecords(store).map((record) => ({relativePath: record.relativePath, occurrences: extractMarkdownTags(record.text)}));
  return {tags: buildTagSummaries(records), filesScanned: records.length};
}

export function buildTaskIndex(store: VaultStore): TaskItem[] {
  return markdownRecords(store).flatMap((record) => extractMarkdownTasks(record.text, record.relativePath).map((task) => ({...task, revision: record.revision}))).sort((left, right) => left.relativePath.localeCompare(right.relativePath) || left.line - right.line);
}

export function toggleVaultTask(store: VaultStore, relativePath: string, expectedRevision: string, line: number, checked: boolean) {
  const current = store.read(relativePath);
  const source = parseMarkdown(current.bytes).text;
  const next = toggleMarkdownTaskSource(source, line, checked);
  if (next === source && current.revision === expectedRevision) return current;
  return store.write({relativePath: current.relativePath, expectedRevision, bytes: new TextEncoder().encode(next)});
}
