import {resolveLink, sliceLinkSubpath, type LinkReference, type LinkResolution, type LinkSubpathSlice} from "./links.js";

/** Keep nested previews finite even when a vault contains a long embed chain. */
export const MAX_TRANSCLUSION_DEPTH = 3;

/** Keep a single note from expanding an unbounded amount of renderer memory. */
const MAX_TRANSCLUSION_SOURCE_BYTES = 512 * 1024;

export type NoteEmbedReference = {
  target: string;
  fragment?: string;
};

export type NoteEmbedResolution = LinkResolution & {
  fragment?: string;
};

function referenceForEmbed(reference: NoteEmbedReference): LinkReference {
  const fragment = reference.fragment ? `#${reference.fragment}` : "";
  const target = reference.target;
  const content = `${target}${fragment}`;
  return {
    kind: "embed",
    raw: `![[${content}]]`,
    target,
    ...(reference.fragment ? {subpath: reference.fragment} : {}),
    start: 0,
    end: content.length + 5,
    targetStart: 3,
    targetEnd: 3 + target.length,
  };
}

/**
 * Resolve only Markdown note targets. Attachments and external URLs use the
 * separate attachment/open policies and must never enter this read path.
 */
export function resolveNoteEmbed(reference: NoteEmbedReference, files: readonly string[], currentPath = "", sources?: ReadonlyMap<string, string>): NoteEmbedResolution {
  const markdownFiles = files.filter((file) => file.toLocaleLowerCase().endsWith(".md"));
  const resolution = resolveLink(referenceForEmbed(reference), markdownFiles, currentPath, sources);
  return {...resolution, ...(reference.fragment ? {fragment: reference.fragment} : {})};
}

export type TransclusionGuard =
  | {allowed: true; nextDepth: number; chain: readonly string[]}
  | {allowed: false; reason: "depth" | "cycle"};

/**
 * Guard a resolved note path before reading or rendering its source. The
 * current note is included in `chain`, making self-embeds fail closed.
 */
export function guardTransclusion(depth: number, chain: readonly string[], target: string): TransclusionGuard {
  if (!Number.isSafeInteger(depth) || depth < 0 || depth >= MAX_TRANSCLUSION_DEPTH) return {allowed: false, reason: "depth"};
  if (chain.includes(target)) return {allowed: false, reason: "cycle"};
  return {allowed: true, nextDepth: depth + 1, chain: [...chain, target]};
}

export function selectTransclusionSource(source: string, fragment?: string): LinkSubpathSlice {
  return fragment ? sliceLinkSubpath(source, fragment) : {status: "resolved", text: source, lineStart: 0, lineEnd: source.split(/\r\n|\n|\r/).length};
}

/** Base64 is four characters per three bytes; this bound avoids decoding an oversized note. */
export function withinTransclusionSourceLimit(base64: string): boolean {
  return typeof base64 === "string" && base64.length <= Math.ceil(MAX_TRANSCLUSION_SOURCE_BYTES / 3) * 4 + 4;
}
