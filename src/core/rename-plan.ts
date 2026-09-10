import {extractLinks, resolveLink, type LinkKind, type LinkReference, type LinkResolution} from "./links.js";

export type RenamePlanFile = {relativePath: string; text: string};
export type RenamePlanAction = "update" | "skip-ambiguous" | "skip-unresolved";
export type RenamePlanReference = {
  sourcePath: string;
  kind: LinkKind;
  raw: string;
  target: string;
  start: number;
  end: number;
  targetStart: number;
  targetEnd: number;
  resolution: LinkResolution["status"];
  action: RenamePlanAction;
  replacement: string | null;
};
export type RenamePlan = {oldPath: string; newPath: string; references: RenamePlanReference[]; updateCount: number; skippedCount: number; warnings: string[]};

function normalizedPath(value: string): string {
  return decodeURIComponent(value).replaceAll("\\", "/").replace(/^\.\//, "");
}

function targetMatches(target: string, path: string): boolean {
  const normalizedTarget = normalizedPath(target);
  const normalizedPathValue = normalizedPath(path);
  const withoutExtension = normalizedPathValue.endsWith(".md") ? normalizedPathValue.slice(0, -3) : normalizedPathValue;
  return normalizedTarget === normalizedPathValue || normalizedTarget === withoutExtension;
}

function replacementTarget(reference: LinkReference, newPath: string): string {
  if (reference.kind === "wikilink" || reference.kind === "embed" && reference.raw.startsWith("![[")) return newPath.endsWith(".md") ? newPath.slice(0, -3) : newPath;
  return newPath;
}

function candidateIncludesOld(resolution: LinkResolution, oldPath: string): boolean {
  return resolution.candidates.some((candidate) => targetMatches(candidate, oldPath));
}

function referenceAction(reference: LinkReference, resolution: LinkResolution, oldPath: string): RenamePlanAction | null {
  if (resolution.status === "resolved" && resolution.target && targetMatches(resolution.target, oldPath)) return "update";
  if (resolution.status === "ambiguous" && candidateIncludesOld(resolution, oldPath)) return "skip-ambiguous";
  if (resolution.status === "unresolved" && targetMatches(reference.target, oldPath)) return "skip-unresolved";
  return null;
}

function planReference(file: RenamePlanFile, reference: LinkReference, files: string[], oldPath: string, newPath: string): RenamePlanReference | null {
  const resolution = resolveLink(reference, files, file.relativePath);
  const action = referenceAction(reference, resolution, oldPath);
  if (!action) return null;
  return {sourcePath: file.relativePath, kind: reference.kind, raw: reference.raw, target: reference.target, start: reference.start, end: reference.end, targetStart: reference.targetStart, targetEnd: reference.targetEnd, resolution: resolution.status, action, replacement: action === "update" ? replacementTarget(reference, newPath) : null};
}

function warningFor(action: RenamePlanAction): string | null {
  if (action === "skip-ambiguous") return "Ambiguous links are shown but not rewritten.";
  if (action === "skip-unresolved") return "Unresolved links are shown but require explicit resolution before rewriting.";
  return null;
}

export function buildRenamePlan(files: RenamePlanFile[], oldPath: string, newPath: string): RenamePlan {
  if (!oldPath || !newPath || oldPath === newPath) throw new Error("Rename plan requires distinct source and destination paths");
  const filePaths = files.map((file) => file.relativePath);
  const references = files.flatMap((file) => extractLinks(file.text).map((reference) => planReference(file, reference, filePaths, oldPath, newPath)).filter((reference): reference is RenamePlanReference => reference !== null));
  const warnings = [...new Set(references.map((reference) => warningFor(reference.action)).filter((warning): warning is string => warning !== null))];
  return {oldPath, newPath, references, updateCount: references.filter((reference) => reference.action === "update").length, skippedCount: references.filter((reference) => reference.action !== "update").length, warnings};
}

export function applyRenamePlan(text: string, sourcePath: string, plan: RenamePlan): string {
  const updates = plan.references.filter((reference) => reference.sourcePath === sourcePath && reference.action === "update" && reference.replacement !== null).sort((left, right) => right.start - left.start);
  return updates.reduce((updated, reference) => `${updated.slice(0, reference.targetStart)}${reference.replacement}${updated.slice(reference.targetEnd)}`, text);
}
