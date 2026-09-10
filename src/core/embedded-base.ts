import {parseBase, type BaseDocument, type BaseIssue} from "./bases.js";

type SourceLine = {content: string; start: number; end: number};
type OpenFence = {marker: "`" | "~"; length: number; contentStart: number};
type EmbeddedSource = {source: string; start: number; end: number; issue?: string};
export type EmbeddedBaseDefinition = EmbeddedSource & {document?: BaseDocument; issues: BaseIssue[]};

function sourceLines(text: string): SourceLine[] {
  return [...text.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)].flatMap((match) => {
    const raw = match[0] ?? "";
    if (!raw) return [];
    const ending = raw.endsWith("\r\n") ? 2 : /[\r\n]$/.test(raw) ? 1 : 0;
    return [{content: raw.slice(0, raw.length - ending), start: match.index ?? 0, end: (match.index ?? 0) + raw.length}];
  });
}

function openingFence(line: SourceLine): OpenFence | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*base[ \t]*$/i.exec(line.content);
  return match ? {marker: match[1]![0] as "`" | "~", length: match[1]!.length, contentStart: line.end} : undefined;
}

function closesFence(line: SourceLine, fence: OpenFence): boolean {
  const match = /^ {0,3}(`+|~+)[ \t]*$/.exec(line.content);
  return Boolean(match && match[1]![0] === fence.marker && match[1]!.length >= fence.length);
}

function embeddedSources(text: string): EmbeddedSource[] {
  const lines = sourceLines(text);
  const sources: EmbeddedSource[] = [];
  let open: OpenFence | undefined;
  for (const line of lines) {
    if (!open) {
      open = openingFence(line);
      continue;
    }
    if (closesFence(line, open)) {
      sources.push({source: text.slice(open.contentStart, line.start), start: open.contentStart, end: line.start});
      open = undefined;
    }
  }
  if (open) sources.push({source: text.slice(open.contentStart), start: open.contentStart, end: text.length, issue: "Embedded base fence is not closed"});
  return sources;
}

function sourceIssue(message: string): BaseIssue {
  return {kind: "invalid-source", message};
}

function parseEmbeddedSource(candidate: EmbeddedSource): EmbeddedBaseDefinition {
  if (candidate.issue) return {...candidate, issues: [sourceIssue(candidate.issue)]};
  try {
    const document = parseBase(new TextEncoder().encode(candidate.source));
    return {...candidate, document, issues: document.issues ?? []};
  } catch (error) {
    return {...candidate, issues: [sourceIssue(error instanceof Error ? error.message : String(error))]};
  }
}

/** Extract read-only `base` fenced definitions while retaining their source spans. */
export function parseEmbeddedBases(text: string): EmbeddedBaseDefinition[] {
  return embeddedSources(text).map(parseEmbeddedSource);
}
