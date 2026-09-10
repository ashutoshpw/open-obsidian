import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {parseMarkdown, type MarkdownProperty} from "./markdown.js";
import {snapshotVault, VaultStore, type VaultEntry} from "./vault.js";
import type {GroundedAnswer, RetrievalCitation, RetrievalProgress, RetrievalRequest, RetrievalResponse, RetrievalSafety, RetrievalScope} from "../shared/api.js";

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
type RetrievalIndexEntry = {relativePath: string; revision: string; modifiedAt: string; tags: string[]; passages: Passage[]};
type RetrievalIndex = {schema_version: 1; vaultRoot: string; sourceSnapshot: string; entries: RetrievalIndexEntry[]};

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

const injectionPatterns = [
  /ignore\s+(?:all|any|the|previous|prior)\s+instructions/i,
  /(?:system|developer)\s+(?:message|prompt)/i,
  /(?:reveal|expose)\s+(?:the\s+)?(?:secret|system\s+prompt|instructions)/i,
  /execute\s+(?:this|the)\s+(?:command|code)/i,
  /send\s+(?:this\s+)?(?:data|note|context)\s+to/i,
  /grant\s+(?:access|permission)/i,
];
const claimValues = /(?:\b\d+(?:\.\d+)?\s*(?:ms|seconds?|minutes?|hours?|days?|weeks?|months?|years?|gb|mb|kb)?\b|\b(?:true|false|enabled|disabled|yes|no|never|always|none|local|remote)\b)/giu;

function injectionDetected(passages: RetrievalCitation[]): boolean {
  return passages.some((passage) => injectionPatterns.some((pattern) => pattern.test(passage.snippet)));
}

function conflictingClaims(passages: RetrievalCitation[]): string[] {
  const claims = new Map<string, Map<string, Set<string>>>();
  passages.forEach((passage) => {
    const values = [...passage.snippet.matchAll(claimValues)].map((match) => match[0]!.trim().toLocaleLowerCase());
    if (values.length === 0) return;
    const shape = tokens(passage.snippet.replace(claimValues, " ")).join(" ");
    if (shape.length === 0) return;
    const valueSet = claims.get(shape) ?? new Map<string, Set<string>>();
    values.forEach((value) => {
      const sources = valueSet.get(value) ?? new Set<string>();
      sources.add(passage.relativePath);
      valueSet.set(value, sources);
    });
    claims.set(shape, valueSet);
  });
  return [...claims.entries()].flatMap(([shape, values]) => {
    const distinct = [...values.entries()].filter(([, sources]) => sources.size > 0).map(([value]) => value);
    const sourceCount = new Set([...values.values()].flatMap((sources) => [...sources])).size;
    if (distinct.length < 2 || sourceCount < 2) return [];
    return [`Sources disagree on “${shape}”: ${distinct.join(" vs ")}.`];
  });
}

function answerSafety(passages: RetrievalCitation[]): RetrievalSafety {
  return {sourceDataUntrusted: true, promptInjectionDetected: injectionDetected(passages), excludedContentDisclosed: false, vaultBoundary: "selected-vault-only"};
}

function groundedAnswer(query: string, passages: RetrievalCitation[]): GroundedAnswer {
  if (passages.length === 0) {
    return {status: "missing-evidence", answer: `No in-scope source passage matched “${query}”.`, inference: null, conflicts: [], warnings: [], citations: []};
  }
  const conflicts = conflictingClaims(passages);
  const promptInjection = injectionDetected(passages);
  return {
    status: conflicts.length > 0 ? "conflicting-evidence" : "grounded",
    answer: `${conflicts.length > 0 ? "Sources contain conflicting evidence. Review each citation before relying on an answer.\n\n" : ""}${passages.slice(0, 3).map((source) => `[${source.relativePath}:${source.lineStart}] ${source.snippet}`).join("\n\n")}`,
    inference: "No model inference was run. This local answer contains source excerpts only; inspect a citation before relying on it.",
    conflicts,
    warnings: promptInjection ? ["Instruction-like text was found in a source excerpt. It was treated as untrusted note content and was not executed or sent to a provider."] : [],
    citations: passages,
  };
}

function report(listener: ProgressListener | undefined, progress: RetrievalProgress): void {
  listener?.(progress);
}

function candidateFiles(entries: VaultEntry[]): VaultEntry[] {
  return entries.filter((entry) => entry.kind === "file" && entry.relativePath.toLocaleLowerCase().endsWith(".md"));
}

function retrievalIndexPath(store: VaultStore): string {
  return join(store.appDataRoot, "retrieval-index.json");
}

function validPassage(value: unknown): value is Passage {
  if (value === null || typeof value !== "object") return false;
  const passage = value as Partial<Passage>;
  return typeof passage.relativePath === "string" && typeof passage.revision === "string" && (typeof passage.heading === "string" || passage.heading === null) && typeof passage.lineStart === "number" && typeof passage.lineEnd === "number" && typeof passage.text === "string";
}

function validIndexEntry(value: unknown): value is RetrievalIndexEntry {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Partial<RetrievalIndexEntry>;
  return typeof entry.relativePath === "string" && typeof entry.revision === "string" && typeof entry.modifiedAt === "string" && Array.isArray(entry.tags) && entry.tags.every((tag) => typeof tag === "string") && Array.isArray(entry.passages) && entry.passages.every(validPassage);
}

function loadRetrievalIndex(store: VaultStore): RetrievalIndex | null {
  const path = retrievalIndexPath(store);
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<RetrievalIndex>;
    if (value.schema_version !== 1 || value.vaultRoot !== store.root || typeof value.sourceSnapshot !== "string" || !Array.isArray(value.entries) || !value.entries.every(validIndexEntry)) return null;
    return value as RetrievalIndex;
  } catch {
    return null;
  }
}

function saveRetrievalIndex(store: VaultStore, index: RetrievalIndex): void {
  mkdirSync(store.appDataRoot, {recursive: true});
  writeFileSync(retrievalIndexPath(store), JSON.stringify(index, null, 2));
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

function readCandidate(store: VaultStore, entry: VaultEntry): RetrievalIndexEntry | null {
  try {
    const read = store.read(entry.relativePath);
    const text = new TextDecoder().decode(read.bytes);
    const modifiedAt = entryModifiedAt(store, entry.relativePath);
    return {relativePath: entry.relativePath, revision: read.revision, modifiedAt, tags: markdownTags(text), passages: splitPassages(text, entry.relativePath, read.revision)};
  } catch {
    return null;
  }
}

function candidateProgress(processed: number, total: number, indexed: number, excluded: number, currentPath?: string): RetrievalProgress {
  return {phase: "indexing", processed, total, indexed, excluded, currentPath};
}

function entriesPassageCount(entries: Map<string, RetrievalIndexEntry>): number {
  return [...entries.values()].reduce((total, entry) => total + entry.passages.length, 0);
}

function indexCandidate(store: VaultStore, entry: VaultEntry, entries: Map<string, RetrievalIndexEntry>, scope: RetrievalScope, exclusions: string[]): {current: RetrievalIndexEntry | undefined; scopedOut: boolean} {
  const path = entry.relativePath;
  if (excludedPath(path, exclusions)) {
    entries.delete(path);
    return {current: undefined, scopedOut: false};
  }
  const cached = entries.get(path);
  const indexed = cached?.revision === entry.sha256 ? cached : readCandidate(store, entry);
  if (indexed) entries.set(path, indexed);
  else entries.delete(path);
  const current = entries.get(path);
  return {current, scopedOut: Boolean(current && !inScope(path, scope, current.tags, current.modifiedAt))};
}

function scopedPassages(entries: Map<string, RetrievalIndexEntry>, scope: RetrievalScope, query: string): ScoredPassage[] {
  return [...entries.values()].filter((entry) => inScope(entry.relativePath, scope, entry.tags, entry.modifiedAt)).flatMap((entry) => entry.passages.map((passage) => scorePassage(query, passage)));
}

function indexCandidates(store: VaultStore, candidates: VaultEntry[], snapshotRevision: string, scope: RetrievalScope, exclusions: string[], query: string, excludedFiles: string[], listener?: ProgressListener): {index: RetrievalIndex; passages: ScoredPassage[]; scopedOutFiles: string[]; processed: number} {
  const previous = loadRetrievalIndex(store);
  const entries = new Map(previous?.entries.map((entry) => [entry.relativePath, entry]) ?? []);
  const candidatePaths = new Set(candidates.map((entry) => entry.relativePath));
  for (const path of entries.keys()) if (!candidatePaths.has(path)) entries.delete(path);
  const scopedOutFiles: string[] = [];
  let processed = 0;
  for (const entry of candidates) {
    processed += 1;
    const path = entry.relativePath;
    const result = indexCandidate(store, entry, entries, scope, exclusions);
    if (result.scopedOut) scopedOutFiles.push(path);
    report(listener, candidateProgress(processed, candidates.length, entriesPassageCount(entries), excludedFiles.length, path));
  }
  const index = {schema_version: 1 as const, vaultRoot: store.root, sourceSnapshot: snapshotRevision, entries: [...entries.values()].filter((entry) => candidatePaths.has(entry.relativePath)).sort((left, right) => left.relativePath.localeCompare(right.relativePath))};
  saveRetrievalIndex(store, index);
  return {index, passages: scopedPassages(entries, scope, query), scopedOutFiles, processed};
}

export function retrieveVault(store: VaultStore, request: RetrievalRequest, listener?: ProgressListener): RetrievalResponse {
  const scope = retrievalScope(request.scope);
  const exclusions = [...DEFAULT_RETRIEVAL_EXCLUSIONS, ...(scope.excludedPaths ?? [])];
  const snapshot = snapshotVault(store.root);
  const candidates = candidateFiles(snapshot.entries);
  const explicitlyExcluded = snapshot.entries.filter((entry) => excludedPath(entry.relativePath, exclusions)).map((entry) => entry.relativePath).sort();
  report(listener, candidateProgress(0, candidates.length, 0, explicitlyExcluded.length));
  const indexed = indexCandidates(store, candidates, snapshot.sha256, scope, exclusions, request.query, explicitlyExcluded, listener);
  const {passages, scopedOutFiles, processed} = indexed;
  // A semantic feature collision must never turn into grounded evidence by itself. Exact term overlap is the local safety anchor; the deterministic vector score only reranks anchored passages.
  const ranked = passages.filter((result) => result.keywordScore > 0).sort((left, right) => right.score - left.score || left.passage.relativePath.localeCompare(right.passage.relativePath) || left.passage.lineStart - right.passage.lineStart).slice(0, request.limit ?? 10);
  const citations = ranked.map((result) => citation(result.passage));
  const progress = {phase: "complete" as const, processed, total: candidates.length, indexed: passages.length, excluded: explicitlyExcluded.length};
  report(listener, progress);
  return {
    query: request.query,
    mode: "local-hybrid",
    scope,
    passages: ranked.map((result, index) => ({...citations[index]!, score: result.score, keywordScore: result.keywordScore, semanticScore: result.semanticScore})),
    answer: groundedAnswer(request.query, citations),
    safety: answerSafety(citations),
    indexedFiles: [...new Set(passages.map((result) => result.passage.relativePath))].sort(),
    excludedFiles: explicitlyExcluded,
    scopedOutFiles: scopedOutFiles.sort(),
    progress,
    provider: "none",
  };
}
