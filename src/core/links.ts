export type LinkKind = "wikilink" | "markdown" | "embed";

export type LinkReference = {
  kind: LinkKind;
  raw: string;
  target: string;
  alias?: string;
  subpath?: string;
  start: number;
  end: number;
  targetStart: number;
  targetEnd: number;
};

export type LinkResolution = {
  status: "resolved" | "unresolved" | "ambiguous" | "external";
  target?: string;
  candidates: string[];
};

type LinkSourceMap = ReadonlyMap<string, string> | Readonly<Record<string, string>>;

function splitTarget(value: string): {target: string; alias?: string; subpath?: string} {
  const [withoutAlias, alias] = value.split("|", 2);
  const [target, subpath] = (withoutAlias ?? "").split("#", 2);
  return {target: target ?? "", alias, subpath};
}

function addWikiReference(references: LinkReference[], match: RegExpExecArray): void {
  const raw = match[0];
  const content = match[1] ?? "";
  const parsed = splitTarget(content);
  const contentStart = match.index + (raw.startsWith("!") ? 3 : 2);
  const targetEndOffset = [content.indexOf("#"), content.indexOf("|")].filter((offset) => offset >= 0).sort((left, right) => left - right)[0] ?? content.length;
  references.push({kind: raw.startsWith("!") ? "embed" : "wikilink", raw, ...parsed, start: match.index, end: match.index + raw.length, targetStart: contentStart, targetEnd: contentStart + targetEndOffset});
}

function addMarkdownReference(references: LinkReference[], match: RegExpExecArray): void {
  const raw = match[0];
  const rawTarget = match[2] ?? "";
  const targetStart = match.index + raw.indexOf(rawTarget);
  const parsed = splitTarget(rawTarget);
  references.push({kind: raw.startsWith("!") ? "embed" : "markdown", raw, ...parsed, start: match.index, end: match.index + raw.length, targetStart, targetEnd: targetStart + parsed.target.length});
}

export function extractLinks(text: string): LinkReference[] {
  const references: LinkReference[] = [];
  const wikilinks = /!?\[\[([^\]]+)\]\]/g;
  const markdown = /!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of text.matchAll(wikilinks)) addWikiReference(references, match);
  for (const match of text.matchAll(markdown)) addMarkdownReference(references, match);
  return references.sort((left, right) => left.start - right.start);
}

function normalizeTarget(target: string): string {
  try {
    return decodeURIComponent(target).replaceAll("\\", "/").replace(/^\.\//, "");
  } catch {
    return target.replaceAll("\\", "/").replace(/^\.\//, "");
  }
}

function candidatePaths(target: string, currentPath: string): string[] {
  const normalized = normalizeTarget(target);
  if (!normalized) return currentPath ? [normalizeTarget(currentPath)] : [];
  if (normalized.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(normalized)) return [];
  const directory = currentPath.includes("/") ? currentPath.slice(0, currentPath.lastIndexOf("/")) : "";
  const relativeTarget = directory && !normalized.includes("/") ? `${directory}/${normalized}` : normalized;
  return [...new Set([relativeTarget, relativeTarget.endsWith(".md") ? relativeTarget : `${relativeTarget}.md`])];
}

function basenameWithoutExtension(path: string): string {
  const basename = path.split("/").pop() ?? path;
  return basename.endsWith(".md") ? basename.slice(0, -3) : basename;
}

function fileMatchesReference(file: string, normalizedTarget: string, candidates: string[]): boolean {
  if (candidates.includes(normalizeTarget(file))) return true;
  return !normalizedTarget.includes("/") && basenameWithoutExtension(normalizeTarget(file)) === normalizedTarget;
}

function sourceText(sources: LinkSourceMap | undefined, path: string): string | undefined {
  if (!sources) return undefined;
  if (sources instanceof Map) return sources.get(path);
  return (sources as Readonly<Record<string, string>>)[path];
}

function normalizedHeading(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep malformed percent-encoding source-only and compare its literal text.
  }
  return decoded.trim().replace(/\s+#*\s*$/, "").replace(/\s+/g, " ").toLocaleLowerCase();
}

function blockId(value: string): string | null {
  const match = /(?:^|[\t ])\^([A-Za-z0-9][A-Za-z0-9_-]*)[\t ]*$/.exec(value);
  return match?.[1] ?? null;
}

function headingText(value: string): string {
  return value.replace(/\s+#*\s*$/, "").replace(/\s+\^[A-Za-z0-9][A-Za-z0-9_-]*\s*$/, "").trim();
}

type FenceState = {character: "`" | "~"; length: number};

type SourceSubpath = {
  key: string;
  line: number;
  kind: "heading" | "block";
  level?: number;
};

function updateFence(line: string, fence: FenceState | null): {next: FenceState | null; consumed: boolean} {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  if (!match) return {next: fence, consumed: Boolean(fence)};
  const marker = match[1]!;
  const character = marker[0] as "`" | "~";
  if (!fence) return {next: {character, length: marker.length}, consumed: true};
  return fence.character === character && marker.length >= fence.length ? {next: null, consumed: true} : {next: fence, consumed: true};
}

function setextHeading(line: string, next: string): boolean {
  return Boolean(line.trim()) && !/^ {0,3}(?:[-+*]|\d+[.)])[\t ]+/.test(line) && /^ {0,3}(?:=+|-+)[\t ]*$/.test(next);
}

function sourceLineSubpaths(line: string, next: string, lineNumber: number): SourceSubpath[] {
  const subpaths: SourceSubpath[] = [];
  const atx = /^ {0,3}#{1,6}[\t ]+(.+?)\s*$/.exec(line);
  if (atx) subpaths.push({key: normalizedHeading(headingText(atx[1]!)), line: lineNumber, kind: "heading", level: atx[0]!.match(/^ {0,3}#+/)?.[0].trim().length});
  else if (setextHeading(line, next)) subpaths.push({key: normalizedHeading(headingText(line)), line: lineNumber, kind: "heading", level: /^ {0,3}=/.test(next) ? 1 : 2});
  const id = blockId(line);
  if (id) subpaths.push({key: `^${id}`, line: lineNumber, kind: "block"});
  return subpaths;
}

function sourceSubpathEntries(source: string): SourceSubpath[] {
  const lines = source.split(/\r\n|\n|\r/);
  const subpaths: SourceSubpath[] = [];
  let fence: FenceState | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.replace(/^\uFEFF/, "");
    const transition = updateFence(line, fence);
    fence = transition.next;
    if (transition.consumed || fence) continue;
    subpaths.push(...sourceLineSubpaths(line, lines[index + 1] ?? "", index));
  }
  return subpaths;
}

function sourceSubpaths(source: string): string[] {
  return sourceSubpathEntries(source).map((subpath) => subpath.key);
}

export type LinkSubpathSlice = {
  status: "resolved" | "unresolved" | "ambiguous";
  text?: string;
  lineStart?: number;
  lineEnd?: number;
};

/**
 * Select the source span addressed by a Markdown heading or block ID. The
 * parser intentionally follows the same fence-aware identity rules as link
 * resolution, so executable-looking source remains plain text for hosts.
 */
export function sliceLinkSubpath(source: string, requestedSubpath: string): LinkSubpathSlice {
  const requested = requestedSubpath.trim();
  if (!requested) return {status: "resolved", text: source, lineStart: 0, lineEnd: source.split(/\r\n|\n|\r/).length};
  const key = requested.startsWith("^") ? requested : normalizedHeading(requested);
  const lines = source.split(/\r\n|\n|\r/);
  const matches = sourceSubpathEntries(source).filter((subpath) => subpath.key === key);
  if (matches.length === 0) return {status: "unresolved"};
  if (matches.length > 1) return {status: "ambiguous"};
  const match = matches[0]!;
  let end = lines.length;
  if (match.kind === "heading") {
    for (const candidate of sourceSubpathEntries(source)) {
      if (candidate.kind === "heading" && candidate.line > match.line && (candidate.level ?? 6) <= (match.level ?? 6)) {
        end = candidate.line;
        break;
      }
    }
  } else {
    // Block IDs identify the containing source line. Remove only the marker
    // itself while preserving the author's surrounding text and whitespace.
    const line = lines[match.line] ?? "";
    lines[match.line] = line.replace(/\^[A-Za-z0-9][A-Za-z0-9_-]*[\t ]*$/, "").replace(/[\t ]+$/, "");
    end = match.line + 1;
  }
  return {status: "resolved", text: lines.slice(match.line, end).join("\n"), lineStart: match.line, lineEnd: end};
}

function subpathMatches(source: string, requestedSubpath: string): number {
  const requested = requestedSubpath.trim();
  if (!requested) return 0;
  const key = requested.startsWith("^") ? requested : normalizedHeading(requested);
  return sourceSubpaths(source).filter((subpath) => subpath === key).length;
}

function fileResolution(matches: string[], candidates: string[]): LinkResolution {
  if (matches.length === 1) return {status: "resolved", target: matches[0], candidates: matches};
  return {status: "ambiguous", candidates: matches.length > 1 ? matches.sort() : candidates};
}

function sourceResolution(reference: LinkReference, matches: string[], sources: LinkSourceMap): LinkResolution {
  const states = matches.map((file) => {
    if (!file.toLocaleLowerCase().endsWith(".md")) return "valid";
    const text = sourceText(sources, file);
    const count = text === undefined ? 0 : subpathMatches(text, reference.subpath ?? "");
    return count > 1 ? "duplicate" : count === 1 ? "valid" : "missing";
  });
  const validMatches = matches.filter((_file, index) => states[index] === "valid");
  if (states.includes("duplicate") || validMatches.length > 1) return {status: "ambiguous", candidates: matches.sort()};
  if (validMatches.length === 1) return {status: "resolved", target: validMatches[0], candidates: validMatches};
  return {status: "unresolved", candidates: matches.sort()};
}

export function resolveLink(reference: LinkReference, files: string[], currentPath = "", sources?: LinkSourceMap): LinkResolution {
  if (/^[a-z][a-z0-9+.-]*:/i.test(reference.target)) return {status: "external", candidates: []};
  const normalizedTarget = normalizeTarget(reference.target);
  const candidates = candidatePaths(reference.target, currentPath);
  const matches = files.filter((file) => fileMatchesReference(file, normalizedTarget, candidates));
  if (matches.length === 0) return {status: "unresolved", candidates};
  if (reference.subpath === undefined) return fileResolution(matches, candidates);

  // Path-only callers (rename planning and source-only analysis) retain their
  // previous file-level behavior. The vault index supplies source bytes so a
  // heading or block ID is only resolved when it is represented exactly once.
  return sources ? sourceResolution(reference, matches, sources) : fileResolution(matches, candidates);
}

function renameTarget(reference: LinkReference, oldPath: string, newPath: string): string | null {
  const oldNormalized = normalizeTarget(oldPath);
  const currentTarget = normalizeTarget(reference.target);
  const oldWithoutExtension = oldNormalized.endsWith(".md") ? oldNormalized.slice(0, -3) : oldNormalized;
  if (currentTarget !== oldNormalized && currentTarget !== oldWithoutExtension) return null;
  if (reference.kind === "wikilink" || reference.kind === "embed" && reference.raw.startsWith("![[")) {
    return newPath.endsWith(".md") ? newPath.slice(0, -3) : newPath;
  }
  return newPath;
}

export function updateLinksOnRename(text: string, oldPath: string, newPath: string): string {
  const links = extractLinks(text);
  return links.reduceRight((updated, link) => {
    const replacement = renameTarget(link, oldPath, newPath);
    if (replacement === null) return updated;
    return `${updated.slice(0, link.targetStart)}${replacement}${updated.slice(link.targetEnd)}`;
  }, text);
}
