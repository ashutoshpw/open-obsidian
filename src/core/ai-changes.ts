import {createHash, randomUUID} from "node:crypto";
import {snapshotVault, VaultStore} from "./vault.js";
import {extractLinks, resolveLink} from "./links.js";
import {parseMarkdown} from "./markdown.js";
import {parseBase} from "./bases.js";
import {parseCanvas} from "./canvas.js";
import {normalizeScopePath, scopePathMatches} from "./path-scope.js";
import {DEFAULT_RETRIEVAL_EXCLUSIONS} from "./retrieval.js";
import type {AIApplyChangeRequest, AIChangeSelection, AIChangeSet, AIFileChange, AIOrganizationResponse, AIUndoChangeResponse, OrganizationSuggestion, RetrievalScope} from "../shared/api.js";

export type AppliedAIChange = {
  undoId: string;
  changeSetId: string;
  files: Array<{relativePath: string; before: Uint8Array; writtenRevision: string}>;
};

export class AIChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIChangeError";
  }
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function scopeAllowsPath(path: string, scope: RetrievalScope): boolean {
  if (scope.excludedPaths?.some((candidate) => scopePathMatches(path, candidate))) return false;
  if (scope.paths?.length && !scope.paths.map(normalizeScopePath).includes(path)) return false;
  return !(scope.folders?.length && !scope.folders.some((candidate) => scopePathMatches(path, candidate)));
}

function availableReferenceFiles(entries: Array<{kind: string; relativePath: string}>, scope: RetrievalScope): string[] {
  return entries.filter((entry) => entry.kind === "file" && !scope.excludedPaths?.some((candidate) => scopePathMatches(entry.relativePath, candidate))).map((entry) => entry.relativePath);
}

function scopeList(value: string[] | undefined): string[] {
  return value ? [...value] : [];
}

function scopeValue(scope: RetrievalScope | undefined): RetrievalScope {
  const excludedPaths = [...new Set([...DEFAULT_RETRIEVAL_EXCLUSIONS, ...scopeList(scope?.excludedPaths)])];
  return {
    paths: scopeList(scope?.paths),
    folders: scopeList(scope?.folders),
    tags: scopeList(scope?.tags),
    modifiedAfter: scope?.modifiedAfter,
    modifiedBefore: scope?.modifiedBefore,
    excludedPaths,
  };
}

function preserveBom(bytes: Uint8Array, text: string): Uint8Array {
  const encoded = new TextEncoder().encode(text);
  if (bytes[0] !== 0xef || bytes[1] !== 0xbb || bytes[2] !== 0xbf) return encoded;
  return new Uint8Array(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(encoded)]));
}

function lineCount(text: string): number {
  return Math.max(1, text.split(/\r\n|\n|\r/).length);
}

function appendText(text: string, addition: string): string {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const normalized = addition.replace(/\r\n|\r|\n/g, newline);
  return `${text}${text.endsWith(newline) ? "" : newline}${normalized}${newline}`;
}

type InstructionResult = {text: string; summary: string};
type InstructionHandler = (text: string, instruction: string) => InstructionResult | null;

function appendInstruction(text: string, instruction: string): InstructionResult | null {
  const match = /^(?:append|add)\s*:\s*([\s\S]+)$/i.exec(instruction);
  return match ? {text: appendText(text, match[1]!), summary: "Append the requested source text"} : null;
}

function prependInstruction(text: string, instruction: string): InstructionResult | null {
  const match = /^(?:prepend|insert at top)\s*:\s*([\s\S]+)$/i.exec(instruction);
  if (!match) return null;
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  return {text: `${match[1]}${newline}${text}`, summary: "Prepend the requested source text"};
}

function replaceInstruction(text: string, instruction: string): InstructionResult | null {
  const match = /^(?:replace|rewrite)\s*:\s*([\s\S]+?)\s*=>\s*([\s\S]+)$/i.exec(instruction);
  if (!match) return null;
  if (!text.includes(match[1]!)) throw new AIChangeError("The requested source text was not found; no draft was created");
  return {text: text.split(match[1]!).join(match[2]!), summary: "Rewrite the requested source text"};
}

function outlineInstruction(text: string, instruction: string): InstructionResult | null {
  if (!/^outline$/i.test(instruction)) return null;
  const headings = text.match(/^ {0,3}#{1,6}\s+.+$/gm) ?? [];
  if (headings.length === 0) throw new AIChangeError("This note has no headings from which to build an outline");
  return {text: appendText(text, `## Outline\n${headings.map((heading) => `- ${heading.replace(/^\s*#+\s*/, "")}`).join("\n")}`), summary: "Append a deterministic outline of existing headings"};
}

function summarizeInstruction(text: string, instruction: string): InstructionResult | null {
  if (!/^summarize$/i.test(instruction)) return null;
  const firstBodyLine = text.split(/\r\n|\n|\r/).find((line) => line.trim() && !/^\s*#/.test(line));
  if (!firstBodyLine) throw new AIChangeError("This note has no body text to summarize");
  return {text: appendText(text, `## Summary\n${firstBodyLine.trim()}`), summary: "Append a deterministic first-line summary"};
}

const instructionHandlers: InstructionHandler[] = [appendInstruction, prependInstruction, replaceInstruction, outlineInstruction, summarizeInstruction];

function instructionResult(text: string, instruction: string): InstructionResult {
  const value = instruction.trim();
  for (const handler of instructionHandlers) {
    const result = handler(text, value);
    if (result) return result;
  }
  throw new AIChangeError("Local draft supports append:, prepend:, replace:/rewrite:, outline or summarize; provider-backed free-form drafting is unavailable");
}

function changeHunk(relativePath: string, expectedRevision: string, before: string, after: string): AIFileChange["hunks"][number] {
  const id = createHash("sha256").update(`${relativePath}\0${expectedRevision}\0${after}`).digest("hex").slice(0, 24);
  return {id, startLine: 1, endLine: lineCount(before), before, after, status: "pending"};
}

function fileChange(relativePath: string, expectedRevision: string, beforeBytes: Uint8Array, afterBytes: Uint8Array, summary: string): AIFileChange {
  const before = new TextDecoder().decode(beforeBytes);
  const after = new TextDecoder().decode(afterBytes);
  return {
    id: randomUUID(),
    relativePath,
    expectedRevision,
    summary,
    beforeBase64: Buffer.from(beforeBytes).toString("base64"),
    afterBase64: Buffer.from(afterBytes).toString("base64"),
    hunks: [changeHunk(relativePath, expectedRevision, before, after)],
    status: "pending",
  };
}

export function draftLocalAIChange(store: VaultStore, request: {relativePath: string; instruction: string; expectedRevision?: string; scope?: RetrievalScope}): AIChangeSet {
  if (request.instruction.trim().length === 0 || request.instruction.length > 500) throw new AIChangeError("AI draft instruction must be between 1 and 500 characters");
  const scope = scopeValue(request.scope);
  if (!scopeAllowsPath(request.relativePath, scope)) throw new AIChangeError("The requested AI change is outside the approved scope or an excluded path");
  const current = store.read(request.relativePath);
  if (request.expectedRevision !== undefined && request.expectedRevision !== current.revision) throw new AIChangeError("The note changed before the draft was created; reopen it and try again");
  const source = new TextDecoder().decode(current.bytes);
  const result = instructionResult(source, request.instruction);
  const after = preserveBom(current.bytes, result.text);
  if (hashBytes(after) === current.revision) throw new AIChangeError("The draft produced no change");
  return {
    id: randomUUID(),
    kind: "draft",
    instruction: request.instruction.trim(),
    createdAt: new Date().toISOString(),
    provider: "none",
    scope,
    files: [fileChange(current.relativePath, current.revision, current.bytes, after, result.summary)],
    safety: {previewRequired: true, sourceDataUntrusted: true, shell: false, network: false, connectors: false, provider: "none"},
  };
}

function selectedFileIds(changeSet: AIChangeSet, selections: AIChangeSelection[]): Map<string, Set<string>> {
  const available = new Map(changeSet.files.map((file) => [file.id, new Set(file.hunks.map((hunk) => hunk.id))]));
  const selected = new Map<string, Set<string>>();
  selections.forEach((selection) => {
    const knownHunks = available.get(selection.fileId);
    if (!knownHunks) throw new AIChangeError(`Unknown AI change file: ${selection.fileId}`);
    const hunkIds = new Set(selection.hunkIds);
    if ([...hunkIds].some((id) => !knownHunks.has(id))) throw new AIChangeError(`Unknown AI change hunk in ${selection.fileId}`);
    selected.set(selection.fileId, hunkIds);
  });
  return selected;
}

function selectedBytes(file: AIFileChange, hunkIds: Set<string>): Uint8Array | null {
  if (hunkIds.size === 0) return null;
  const known = new Set(file.hunks.map((hunk) => hunk.id));
  if (hunkIds.size !== known.size) throw new AIChangeError("Partial hunk application is not available for this single-hunk draft");
  return new Uint8Array(Buffer.from(file.afterBase64, "base64"));
}

export function applyAIChangeSet(store: VaultStore, changeSet: AIChangeSet, request: AIApplyChangeRequest): AppliedAIChange {
  if (request.changeSetId !== changeSet.id) throw new AIChangeError("AI change set identity does not match the approval request");
  if (!changeSet.safety.previewRequired || changeSet.safety.shell || changeSet.safety.network || changeSet.safety.connectors) throw new AIChangeError("AI changes must remain inside the preview-only broker");
  const selected = selectedFileIds(changeSet, request.selections);
  const plans = changeSet.files.flatMap((file) => {
    const bytes = selectedBytes(file, selected.get(file.id) ?? new Set());
    return bytes ? [{file, bytes}] : [];
  });
  if (plans.length === 0) throw new AIChangeError("Approve at least one change hunk before applying");
  const current = plans.map(({file}) => ({file, read: store.read(file.relativePath)}));
  current.forEach(({file, read}) => {
    if (read.revision !== file.expectedRevision) throw new AIChangeError(`The note changed before approval: ${file.relativePath}; no AI changes were applied`);
    const before = new Uint8Array(Buffer.from(file.beforeBase64, "base64"));
    if (hashBytes(before) !== file.expectedRevision) throw new AIChangeError(`The change preview has an invalid base revision: ${file.relativePath}`);
  });
  const undoId = randomUUID();
  const applied = plans.map(({file, bytes}) => {
    const written = store.write({relativePath: file.relativePath, expectedRevision: file.expectedRevision, bytes, operationId: `${changeSet.id}:${file.id}`});
    return {relativePath: file.relativePath, before: new Uint8Array(Buffer.from(file.beforeBase64, "base64")), writtenRevision: written.revision};
  });
  return {undoId, changeSetId: changeSet.id, files: applied};
}

export function undoAIChange(store: VaultStore, applied: AppliedAIChange): AIUndoChangeResponse {
  const current = applied.files.map((file) => ({file, read: store.read(file.relativePath)}));
  current.forEach(({file, read}) => {
    if (read.revision !== file.writtenRevision) throw new AIChangeError(`The note changed after the AI edit: ${file.relativePath}; undo was not applied`);
  });
  const files = current.map(({file, read}) => {
    const restored = store.write({relativePath: file.relativePath, expectedRevision: read.revision, bytes: file.before, operationId: `undo:${applied.undoId}:${file.relativePath}`});
    return {relativePath: restored.relativePath, base64: Buffer.from(restored.bytes).toString("base64"), revision: restored.revision};
  });
  return {undoId: applied.undoId, files};
}

function suggestion(id: string, kind: OrganizationSuggestion["kind"], relativePath: string, summary: string, detail: string, status: OrganizationSuggestion["status"], safeAlternative?: string, targetPath?: string): OrganizationSuggestion {
  return {id, kind, relativePath, summary, detail, status, safeAlternative, targetPath};
}

function addMarkdownOrganizationSuggestions(store: VaultStore, entry: {relativePath: string; sha256: string}, allFiles: string[], suggestions: OrganizationSuggestion[]): void {
  const read = store.read(entry.relativePath);
  const text = new TextDecoder().decode(read.bytes);
  extractLinks(text).forEach((link, index) => {
    if (resolveLink(link, allFiles, entry.relativePath).status === "unresolved") suggestions.push(suggestion(`${entry.relativePath}:link:${index}`, "link", entry.relativePath, `Review unresolved link ${link.target}`, `The link target “${link.target}” has no matching file in the selected vault.`, "awaiting-approval"));
  });
  if (parseMarkdown(read.bytes).properties.length === 0) suggestions.push(suggestion(`${entry.relativePath}:property`, "property", entry.relativePath, "Review a tags property", "This note has no represented frontmatter properties; choose a value before applying any property edit.", "awaiting-approval"));
}

function addCanvasOrganizationSuggestions(store: VaultStore, relativePath: string, suggestions: OrganizationSuggestion[]): void {
  try {
    const document = parseCanvas(store.read(relativePath).bytes);
    document.nodes.filter((node) => node.type === "text").forEach((node) => suggestions.push(suggestion(`${relativePath}:canvas:${node.id}`, "canvas", relativePath, `Review Canvas text card ${node.id}`, "Canvas text can be edited or converted to a note only through an explicit revision-checked action.", "awaiting-approval")));
  } catch {
    // An invalid Canvas file remains visible to the normal compatibility surface; no AI action is proposed.
  }
}

function addBaseOrganizationSuggestions(store: VaultStore, relativePath: string, suggestions: OrganizationSuggestion[]): void {
  try {
    const document = parseBase(store.read(relativePath).bytes);
    document.views.forEach((view, index) => suggestions.push(suggestion(`${relativePath}:base:${index}`, "base", relativePath, `Review Bases view ${view.name ?? index + 1}`, "Bases assistance remains a read-only projection until an explicit safe edit is reviewed." , "awaiting-approval")));
    document.views.forEach((view) => Object.entries(view.formulas ?? {}).forEach(([name, expression]) => suggestions.push(suggestion(`${relativePath}:formula-code:${name}`, "formula-code", relativePath, `Formula ${name} requires a separate runtime boundary`, `The expression “${expression}” was not executed by the organization broker.`, "denied-security", "Review the formula in the read-only Bases compatibility surface."))));
    document.issues?.filter((issue) => issue.expression || /formula|expression|code/i.test(issue.message)).forEach((issue, index) => suggestions.push(suggestion(`${relativePath}:formula-code:issue:${index}`, "formula-code", relativePath, "Formula/code execution is denied", `The Bases source contains an unsupported executable expression: ${issue.message}`, "denied-security", "Review the formula in the read-only Bases compatibility surface.")));
  } catch {
    suggestions.push(suggestion(`${relativePath}:formula-code`, "formula-code", relativePath, "Formula/code execution is denied", "The Bases file could not be parsed by the safe compatibility grammar; no model-generated formula or code was executed.", "denied-security", "Review the file in the read-only Bases compatibility surface."));
  }
}

export function organizationSuggestions(store: VaultStore, scopeInput?: RetrievalScope): AIOrganizationResponse {
  const scope = scopeValue(scopeInput);
  const entries = snapshotVault(store.root).entries;
  const files = entries.filter((entry) => entry.kind === "file" && entry.relativePath.toLocaleLowerCase().endsWith(".md") && scopeAllowsPath(entry.relativePath, scope));
  const allFiles = availableReferenceFiles(entries, scope);
  const suggestions: OrganizationSuggestion[] = [];
  const hashes = new Map<string, string[]>();
  files.forEach((entry) => {
    addMarkdownOrganizationSuggestions(store, entry, allFiles, suggestions);
    const bucket = hashes.get(entry.sha256) ?? [];
    bucket.push(entry.relativePath);
    hashes.set(entry.sha256, bucket);
  });
  [...hashes.values()].filter((paths) => paths.length > 1).forEach((paths) => paths.forEach((path, index) => {
    const others = paths.filter((candidate) => candidate !== path).join(", ");
    suggestions.push(suggestion(`${path}:duplicate:${index}`, "duplicate", path, "Review possible duplicate note", `This note has identical source bytes to ${others}.`, "awaiting-approval"));
    suggestions.push(suggestion(`${path}:rename:${index}`, "rename", path, "Review a rename/move plan", "The duplicate analysis found a candidate for a user-chosen rename or move; no destination or filesystem action was selected.", "awaiting-approval"));
  }));
  entries.filter((entry) => entry.kind === "file" && scopeAllowsPath(entry.relativePath, scope)).forEach((entry) => {
    const lower = entry.relativePath.toLocaleLowerCase();
    if (lower.endsWith(".canvas")) addCanvasOrganizationSuggestions(store, entry.relativePath, suggestions);
    if (lower.endsWith(".base")) addBaseOrganizationSuggestions(store, entry.relativePath, suggestions);
  });
  return {
    provider: "none",
    scope,
    suggestions,
    warnings: ["Organization results are suggestions only. Apply each change through a revision-checked preview; source notes and plugin output are untrusted data."],
    safety: {previewRequired: true, sourceDataUntrusted: true, shell: false, network: false, connectors: false, provider: "none"},
  };
}
