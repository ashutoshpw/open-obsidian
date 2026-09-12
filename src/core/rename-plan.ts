import {createHash} from "node:crypto";
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

export type RenamePlanIdentity = {planId: string; snapshotSha256: string};

function normalizedPath(value: string): string {
  return decodeURIComponent(value).replaceAll("\\", "/").replace(/^\.\//, "");
}

function targetMatches(target: string, path: string): boolean {
  const normalizedTarget = normalizedPath(target);
  const normalizedPathValue = normalizedPath(path);
  const withoutExtension = normalizedPathValue.endsWith(".md") ? normalizedPathValue.slice(0, -3) : normalizedPathValue;
  return normalizedTarget === normalizedPathValue || normalizedTarget === withoutExtension;
}

function relativePathFromSource(sourcePath: string, newPath: string): string {
  const sourceSegments = sourcePath.split("/");
  sourceSegments.pop();
  const targetSegments = newPath.split("/");
  let common = 0;
  while (common < sourceSegments.length && common < targetSegments.length && sourceSegments[common] === targetSegments[common]) common += 1;
  const upwards = Array.from({length: sourceSegments.length - common}, () => "..");
  const downwards = targetSegments.slice(common);
  return [...upwards, ...downwards].join("/") || targetSegments.at(-1) || newPath;
}

function replacementTarget(reference: LinkReference, sourcePath: string, newPath: string): string {
  if (reference.kind === "wikilink" || reference.kind === "embed" && reference.raw.startsWith("![[")) return newPath.endsWith(".md") ? newPath.slice(0, -3) : newPath;
  const target = normalizedPath(reference.target);
  const candidate = target.includes("/") ? newPath : relativePathFromSource(sourcePath, newPath);
  return target.toLocaleLowerCase().endsWith(".md") || !newPath.toLocaleLowerCase().endsWith(".md") ? candidate : candidate.slice(0, -3);
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
  return {sourcePath: file.relativePath, kind: reference.kind, raw: reference.raw, target: reference.target, start: reference.start, end: reference.end, targetStart: reference.targetStart, targetEnd: reference.targetEnd, resolution: resolution.status, action, replacement: action === "update" ? replacementTarget(reference, file.relativePath, newPath) : null};
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

/**
 * Bind a parsed plan to the exact vault snapshot from which it was produced.
 * The caller must compare this identity before mutating any filesystem path.
 */
export function renamePlanIdentity(plan: RenamePlan, snapshotSha256: string): RenamePlanIdentity {
  const canonical = {
    snapshotSha256,
    oldPath: plan.oldPath,
    newPath: plan.newPath,
    references: plan.references.map((reference) => ({
      sourcePath: reference.sourcePath,
      kind: reference.kind,
      raw: reference.raw,
      target: reference.target,
      start: reference.start,
      end: reference.end,
      targetStart: reference.targetStart,
      targetEnd: reference.targetEnd,
      resolution: reference.resolution,
      action: reference.action,
      replacement: reference.replacement,
    })),
    updateCount: plan.updateCount,
    skippedCount: plan.skippedCount,
    warnings: plan.warnings,
  };
  return {planId: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"), snapshotSha256};
}

export function applyRenamePlan(text: string, sourcePath: string, plan: RenamePlan): string {
  const updates = plan.references.filter((reference) => reference.sourcePath === sourcePath && reference.action === "update" && reference.replacement !== null).sort((left, right) => right.start - left.start);
  return updates.reduce((updated, reference) => `${updated.slice(0, reference.targetStart)}${reference.replacement}${updated.slice(reference.targetEnd)}`, text);
}
