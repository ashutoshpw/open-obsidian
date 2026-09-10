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
  const target = match[2] ?? "";
  const targetStart = match.index + raw.indexOf(target);
  const parsed = splitTarget(target);
  references.push({kind: raw.startsWith("!") ? "embed" : "markdown", raw, ...parsed, start: match.index, end: match.index + raw.length, targetStart, targetEnd: targetStart + target.length});
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
  return decodeURIComponent(target).replaceAll("\\", "/").replace(/^\.\//, "");
}

function candidatePaths(target: string, currentPath: string): string[] {
  const normalized = normalizeTarget(target);
  if (!normalized || normalized.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(normalized)) return [];
  const directory = currentPath.includes("/") ? currentPath.slice(0, currentPath.lastIndexOf("/")) : "";
  const relativeTarget = directory && !normalized.includes("/") ? `${directory}/${normalized}` : normalized;
  return [...new Set([relativeTarget, relativeTarget.endsWith(".md") ? relativeTarget : `${relativeTarget}.md`])];
}

export function resolveLink(reference: LinkReference, files: string[], currentPath = ""): LinkResolution {
  if (/^[a-z][a-z0-9+.-]*:/i.test(reference.target)) return {status: "external", candidates: []};
  const candidates = candidatePaths(reference.target, currentPath);
  const matches = files.filter((file) => candidates.includes(normalizeTarget(file)));
  if (matches.length === 1) return {status: "resolved", target: matches[0], candidates: matches};
  if (matches.length > 1) return {status: "ambiguous", candidates: matches.sort()};
  return {status: "unresolved", candidates};
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
