import {createHash} from "node:crypto";
import {statSync} from "node:fs";
import {join} from "node:path";
import {parseMarkdown, type MarkdownProperty} from "./markdown.js";
import {snapshotVault, VaultStore, type VaultEntry} from "./vault.js";
import type {GroundedAnswer, RetrievalCitation, RetrievalProgress, RetrievalRequest, RetrievalResponse, RetrievalScope} from "../shared/api.js";

export const DEFAULT_RETRIEVAL_EXCLUSIONS = [".obsidian", ".git", ".trash"] as const;

const vectorSize = 64;
const stopWords = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "what", "when", "where", "which", "who", "with"]);

type Passage = {
  relativePath: string;
  revision: string;
  heading: string | null;
  lineStart: number;
  lineEnd: number;
  text: string;
};

type ScoredPassage = {passage: Passage; keywordScore: number; semanticScore: number; score: number};
type ProgressListener = (progress: RetrievalProgress) => void;

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function pathMatches(path: string, candidate: string): boolean {
  const normalized = normalizePath(candidate);
  return normalized.length > 0 && (path === normalized || path.startsWith(`${normalized}/`));
}

function excludedPath(path: string, exclusions: string[]): boolean {
  return exclusions.some((candidate) => pathMatches(path, candidate));
}

function scopePaths(scope: RetrievalScope | undefined): {paths: string[]; folders: string[]} {
  return {paths: scope?.paths?.map(normalizePath) ?? [], folders: scope?.folders?.map(normalizePath) ?? []};
}

function pathInScope(path: string, scope: RetrievalScope | undefined): boolean {
  const selected = scopePaths(scope);
  return [selected.paths.length === 0 || selected.paths.includes(path), selected.folders.length === 0 || selected.folders.some((folder) => pathMatches(path, folder))].every(Boolean);
}

function tagsInScope(scope: RetrievalScope | undefined, tags: string[]): boolean {
  const tagFilter = scope?.tags?.map((tag) => tag.toLocaleLowerCase()) ?? [];
  return tagFilter.length === 0 || tagFilter.every((tag) => tags.includes(tag));
}

function afterBoundary(scope: RetrievalScope | undefined, timestamp: number): boolean {
  const boundary = scope?.modifiedAfter;
  return !boundary || timestamp >= Date.parse(boundary);
}

function beforeBoundary(scope: RetrievalScope | undefined, timestamp: number): boolean {
  const boundary = scope?.modifiedBefore;
  return !boundary || timestamp <= Date.parse(boundary);
}

function datesInScope(scope: RetrievalScope | undefined, modifiedAt: string): boolean {
  const timestamp = Date.parse(modifiedAt);
  return [afterBoundary(scope, timestamp), beforeBoundary(scope, timestamp)].every(Boolean);
}

function inScope(path: string, scope: RetrievalScope | undefined, tags: string[], modifiedAt: string): boolean {
  return [pathInScope(path, scope), tagsInScope(scope, tags), datesInScope(scope, modifiedAt)].every(Boolean);
}

function propertyTags(properties: MarkdownProperty[]): string[] {
  const property = properties.find((candidate) => candidate.key.toLocaleLowerCase() === "tags");
  if (!property) return [];
  return property.rawValue.toLocaleLowerCase().match(/[\p{L}\p{N}_/-]+/gu) ?? [];
}

function bodyTags(text: string): string[] {
  const tags: string[] = [];
  for (const match of text.matchAll(/(?:^|[\s([{"'])#([\p{L}\p{N}_/-]+)/gmu)) tags.push(match[1]!.toLocaleLowerCase());
  return tags;
}

function markdownTags(text: string): string[] {
  const document = parseMarkdown(new TextEncoder().encode(text));
  return [...new Set([...propertyTags(document.properties), ...bodyTags(text)])];
}

function tokens(value: string): string[] {
  return (value.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []).filter((token) => !stopWords.has(token));
}

function splitPassages(text: string, relativePath: string, revision: string): Passage[] {
  const lines = text.split(/\r\n|\n|\r/);
  const passages: Passage[] = [];
  let heading: string | null = null;
  let lineStart = 1;
  let content: string[] = [];

  const flush = (lineEnd: number): void => {
    const value = content.join("\n").trim();
    if (value) passages.push({relativePath, revision, heading, lineStart, lineEnd, text: value});
    content = [];
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const headingMatch = /^ {0,3}#{1,6}[ \t]+(.+?)\s*#*\s*$/.exec(line);
    if (headingMatch) {
      flush(lineNumber - 1);
      heading = headingMatch[1]!.trim();
      lineStart = lineNumber;
      content = [line];
      return;
    }
    if (!line.trim()) {
      flush(lineNumber - 1);
      lineStart = lineNumber + 1;
      return;
    }
    if (content.length === 0) lineStart = lineNumber;
    content.push(line);
  });
  flush(lines.length);
  return passages;
}

function hashToken(value: string): number {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  return hash >>> 0;
}

function vector(value: string[]): number[] {
  const result = Array.from({length: vectorSize}, () => 0);
  value.forEach((token) => {
    const hash = hashToken(token);
    result[hash % vectorSize]! += 1;
    result[(hash >>> 8) % vectorSize]! += 0.5;
  });
  return result;
}

function cosine(left: number[], right: number[]): number {
  const dot = left.reduce((total, value, index) => total + value * right[index]!, 0);
  const leftMagnitude = Math.sqrt(left.reduce((total, value) => total + value * value, 0));
  const rightMagnitude = Math.sqrt(right.reduce((total, value) => total + value * value, 0));
  return leftMagnitude === 0 || rightMagnitude === 0 ? 0 : dot / (leftMagnitude * rightMagnitude);
}

function occurrenceCount(text: string, query: string): number {
  if (!query) return 0;
  let count = 0;
  let offset = 0;
  while (offset >= 0) {
    const found = text.indexOf(query, offset);
    if (found < 0) break;
    count += 1;
    offset = found + query.length;
  }
  return count;
}

function scorePassage(query: string, passage: Passage): ScoredPassage {
  const queryTokens = tokens(query);
  const passageTokens = tokens(passage.text);
  const normalizedQuery = query.toLocaleLowerCase();
  const normalizedText = passage.text.toLocaleLowerCase();
  const keywordScore = queryTokens.reduce((total, token) => total + occurrenceCount(normalizedText, token), 0) + (normalizedText.includes(normalizedQuery) ? queryTokens.length : 0);
  const semanticScore = cosine(vector(queryTokens), vector(passageTokens));
  return {passage, keywordScore, semanticScore, score: keywordScore + semanticScore};
}

function citationId(passage: Passage): string {
  return createHash("sha256").update(`${passage.relativePath}\0${passage.revision}\0${passage.lineStart}\0${passage.lineEnd}`).digest("hex").slice(0, 24);
}

function citation(passage: Passage): RetrievalCitation {
  return {id: citationId(passage), kind: "source", relativePath: passage.relativePath, revision: passage.revision, heading: passage.heading, lineStart: passage.lineStart, lineEnd: passage.lineEnd, snippet: passage.text.slice(0, 420)};
}

function groundedAnswer(query: string, passages: RetrievalCitation[]): GroundedAnswer {
  if (passages.length === 0) {
    return {status: "missing-evidence", answer: `No in-scope source passage matched “${query}”.`, inference: null, conflicts: [], citations: []};
  }
  return {
    status: "grounded",
    answer: passages.slice(0, 3).map((source) => `[${source.relativePath}:${source.lineStart}] ${source.snippet}`).join("\n\n"),
    inference: "No model inference was run. This local answer contains source excerpts only; inspect a citation before relying on it.",
    conflicts: [],
    citations: passages,
  };
}

function report(listener: ProgressListener | undefined, progress: RetrievalProgress): void {
  listener?.(progress);
}

function candidateFiles(entries: VaultEntry[]): VaultEntry[] {
  return entries.filter((entry) => entry.kind === "file" && entry.relativePath.toLocaleLowerCase().endsWith(".md"));
}

function entryModifiedAt(store: VaultStore, relativePath: string): string {
  try {
    return statSync(join(store.root, ...relativePath.split("/"))).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

function scopeList(value: string[] | undefined): string[] {
  return value ? [...value] : [];
}

function retrievalScope(scope: RetrievalScope | undefined): RetrievalScope {
  const selected = scope ?? {};
  return {
    paths: scopeList(selected.paths),
    folders: scopeList(selected.folders),
    tags: scopeList(selected.tags),
    modifiedAfter: selected.modifiedAfter,
    modifiedBefore: selected.modifiedBefore,
    excludedPaths: scopeList(selected.excludedPaths),
  };
}

type CandidateResult = {passages: ScoredPassage[]; scopedOut: boolean};

function readCandidate(store: VaultStore, entry: VaultEntry, scope: RetrievalScope, query: string): CandidateResult {
  try {
    const read = store.read(entry.relativePath);
    const text = new TextDecoder().decode(read.bytes);
    const modifiedAt = entryModifiedAt(store, entry.relativePath);
    if (!inScope(entry.relativePath, scope, markdownTags(text), modifiedAt)) return {passages: [], scopedOut: true};
    return {passages: splitPassages(text, entry.relativePath, read.revision).map((passage) => scorePassage(query, passage)), scopedOut: false};
  } catch {
    return {passages: [], scopedOut: true};
  }
}

function candidateProgress(processed: number, total: number, indexed: number, excluded: number, currentPath?: string): RetrievalProgress {
  return {phase: "indexing", processed, total, indexed, excluded, currentPath};
}

function indexCandidates(store: VaultStore, candidates: VaultEntry[], scope: RetrievalScope, exclusions: string[], query: string, excludedFiles: string[], listener?: ProgressListener): {passages: ScoredPassage[]; scopedOutFiles: string[]; processed: number} {
  const passages: ScoredPassage[] = [];
  const scopedOutFiles: string[] = [];
  let processed = 0;
  for (const entry of candidates) {
    processed += 1;
    if (!excludedPath(entry.relativePath, exclusions)) {
      const result = readCandidate(store, entry, scope, query);
      passages.push(...result.passages);
      if (result.scopedOut) scopedOutFiles.push(entry.relativePath);
    }
    report(listener, candidateProgress(processed, candidates.length, passages.length, excludedFiles.length, entry.relativePath));
  }
  return {passages, scopedOutFiles, processed};
}

export function retrieveVault(store: VaultStore, request: RetrievalRequest, listener?: ProgressListener): RetrievalResponse {
  const scope = retrievalScope(request.scope);
  const exclusions = [...DEFAULT_RETRIEVAL_EXCLUSIONS, ...(scope.excludedPaths ?? [])];
  const snapshot = snapshotVault(store.root);
  const candidates = candidateFiles(snapshot.entries);
  const explicitlyExcluded = snapshot.entries.filter((entry) => excludedPath(entry.relativePath, exclusions)).map((entry) => entry.relativePath).sort();
  report(listener, candidateProgress(0, candidates.length, 0, explicitlyExcluded.length));
  const indexed = indexCandidates(store, candidates, scope, exclusions, request.query, explicitlyExcluded, listener);
  const {passages, scopedOutFiles, processed} = indexed;
  const ranked = passages.filter((result) => result.score > 0).sort((left, right) => right.score - left.score || left.passage.relativePath.localeCompare(right.passage.relativePath) || left.passage.lineStart - right.passage.lineStart).slice(0, request.limit ?? 10);
  const citations = ranked.map((result) => citation(result.passage));
  const progress = {phase: "complete" as const, processed, total: candidates.length, indexed: passages.length, excluded: explicitlyExcluded.length};
  report(listener, progress);
  return {
    query: request.query,
    mode: "local-hybrid",
    scope,
    passages: ranked.map((result, index) => ({...citations[index]!, score: result.score, keywordScore: result.keywordScore, semanticScore: result.semanticScore})),
    answer: groundedAnswer(request.query, citations),
    indexedFiles: [...new Set(passages.map((result) => result.passage.relativePath))].sort(),
    excludedFiles: explicitlyExcluded,
    scopedOutFiles: scopedOutFiles.sort(),
    progress,
    provider: "none",
  };
}
