export type MarkdownInlineSegment =
  | {kind: "text"; text: string}
  | {kind: "highlight"; text: string}
  | {kind: "strong"; text: string}
  | {kind: "emphasis"; text: string}
  | {kind: "strikethrough"; text: string}
  | {kind: "code"; text: string}
  | {kind: "link"; text: string; target: string}
  | {kind: "wiki-link"; text: string; target: string}
  | {kind: "embed"; text: string; target: string; fragment?: string; width?: number; height?: number};

export type MarkdownPreviewBlock =
  | {kind: "heading"; level: number; text: string}
  | {kind: "paragraph"; text: string}
  | {kind: "task"; checked: boolean; text: string}
  | {kind: "list"; ordered: boolean; items: string[]}
  | {kind: "quote"; text: string}
  | {kind: "code"; language: string; text: string}
  | {kind: "base"; text: string}
  | {kind: "table"; headers: string[]; rows: string[][]}
  | {kind: "thematic-break"}
  | {kind: "unsupported"; syntax: "footnote" | "math" | "diagram" | "html"; text: string};

type ParsedBlock = {block: MarkdownPreviewBlock | null; next: number};
type Fence = {marker: "`" | "~"; length: number; language: string};
type ParsedInline = {segment: Exclude<MarkdownInlineSegment, {kind: "text"}>; length: number};
type StyledInlineKind = "highlight" | "strong" | "emphasis" | "strikethrough" | "code";
type InlineMatcher = (value: string) => ParsedInline | null;

function splitLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/);
}

function headingBlock(line: string): MarkdownPreviewBlock | null {
  const match = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/.exec(line);
  return match ? {kind: "heading", level: match[1]!.length, text: match[2]!.trim()} : null;
}

function setextHeading(lines: string[], index: number): ParsedBlock | null {
  const text = lines[index]!.trim();
  const underline = lines[index + 1] ?? "";
  if (!text || headingBlock(lines[index]!) || listItem(lines[index]!) || quoteLine(lines[index]!) !== null || !/^ {0,3}(=+|-+)[ \t]*$/.test(underline)) return null;
  return {block: {kind: "heading", level: underline.trimStart().startsWith("=") ? 1 : 2, text}, next: index + 2};
}

function taskBlock(line: string): MarkdownPreviewBlock | null {
  const match = /^\s*[-*+][ \t]+\[([ xX])\][ \t]+(.+)$/.exec(line);
  return match ? {kind: "task", checked: match[1]!.toLocaleLowerCase() === "x", text: match[2]!} : null;
}

function listItem(line: string): {ordered: boolean; text: string} | null {
  const match = /^\s*(?:(\d+)[.]|[-*+])[ \t]+(.+)$/.exec(line);
  return match ? {ordered: Boolean(match[1]), text: match[2]!} : null;
}

function listParser(lines: string[], index: number): ParsedBlock | null {
  const first = listItem(lines[index]!);
  if (!first || taskBlock(lines[index]!)) return null;
  const items = [first.text];
  let next = index + 1;
  while (next < lines.length) {
    const item = listItem(lines[next]!);
    if (!item || item.ordered !== first.ordered) break;
    items.push(item.text);
    next += 1;
  }
  return {block: {kind: "list", ordered: first.ordered, items}, next};
}

function fenceInfo(line: string): Fence | null {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*([A-Za-z0-9_+.-]*)[ \t]*$/.exec(line);
  if (!match) return null;
  return {marker: match[1]![0] as "`" | "~", length: match[1]!.length, language: match[2] ?? ""};
}

function isFenceClose(line: string, fence: Fence): boolean {
  const match = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
  return Boolean(match && match[1]![0] === fence.marker && match[1]!.length >= fence.length);
}

function codeParser(lines: string[], index: number): ParsedBlock | null {
  const fence = fenceInfo(lines[index]!);
  if (!fence) return null;
  const content: string[] = [];
  let next = index + 1;
  while (next < lines.length && !isFenceClose(lines[next]!, fence)) {
    content.push(lines[next]!);
    next += 1;
  }
  if (next < lines.length) next += 1;
  if (fence.language.toLocaleLowerCase() === "base") return {block: {kind: "base", text: content.join("\n")}, next};
  const diagram = /^(?:mermaid|plantuml|dot|excalidraw|dataview|dataviewjs)$/i.test(fence.language);
  return diagram ? {block: {kind: "unsupported", syntax: "diagram", text: content.join("\n")}, next} : {block: {kind: "code", language: fence.language, text: content.join("\n")}, next};
}

function tableCells(line: string): string[] | null {
  if (!line.includes("|")) return null;
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function tableSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function tableParser(lines: string[], index: number): ParsedBlock | null {
  const headers = tableCells(lines[index]!);
  const separator = tableCells(lines[index + 1] ?? "");
  if (!headers || !separator || !tableSeparator(separator)) return null;
  const rows: string[][] = [];
  let next = index + 2;
  while (next < lines.length) {
    const row = tableCells(lines[next]!);
    if (!row) break;
    rows.push(row);
    next += 1;
  }
  return {block: {kind: "table", headers, rows}, next};
}

function thematicBreak(line: string): MarkdownPreviewBlock | null {
  return /^(?: {0,3}(?:\*\s*){3,}| {0,3}(?:-\s*){3,}| {0,3}(?:_\s*){3,})$/.test(line) ? {kind: "thematic-break"} : null;
}

function unsupportedBlock(line: string): MarkdownPreviewBlock | null {
  if (/^\s*<\/?[A-Za-z][^>]*>/.test(line)) return {kind: "unsupported", syntax: "html", text: line};
  if (/^\s*\[\^[^\]]+\]:/.test(line) || /\[\^[^\]]+\]/.test(line)) return {kind: "unsupported", syntax: "footnote", text: line};
  if (/^\s*(?:\$\$|\\\[|\\\()/.test(line) || /(?:\$\$|\\\]|\\\))\s*$/.test(line) || /(?:^|[^\w])\$(?:[^$\n]+)\$(?!\w)/.test(line)) return {kind: "unsupported", syntax: "math", text: line};
  return null;
}

function quoteLine(line: string): string | null {
  const match = /^\s*>[ \t]?(.*)$/.exec(line);
  return match?.[1] ?? null;
}

function quoteParser(lines: string[], index: number): ParsedBlock | null {
  const firstLine = quoteLine(lines[index]!);
  if (firstLine === null) return null;
  const content = [firstLine];
  let next = index + 1;
  while (next < lines.length) {
    const line = quoteLine(lines[next]!);
    if (line !== null) {
      content.push(line);
      next += 1;
      continue;
    }
    if (lines[next]!.trim() === "" && quoteLine(lines[next + 1] ?? "") !== null) {
      content.push("");
      next += 1;
      continue;
    }
    break;
  }
  const callout = /^\[!([A-Za-z0-9_-]+)\][ \t]*(.*)$/.exec(content[0]!);
  const text = callout ? `${callout[1]}: ${callout[2]}${content.slice(1).length ? `\n${content.slice(1).join("\n")}` : ""}`.trim() : content.join("\n");
  return {block: {kind: "quote", text}, next};
}

function blockAt(lines: string[], index: number): ParsedBlock | null {
  return codeParser(lines, index) ?? tableParser(lines, index) ?? setextHeading(lines, index) ?? listParser(lines, index) ?? quoteParser(lines, index) ?? simpleParser(lines, index);
}

function startsBlock(lines: string[], index: number): boolean {
  const quote = quoteLine(lines[index]!);
  return Boolean(codeParser(lines, index) ?? tableParser(lines, index) ?? setextHeading(lines, index) ?? headingBlock(lines[index]!) ?? taskBlock(lines[index]!) ?? listItem(lines[index]!)) || quote !== null || Boolean(unsupportedBlock(lines[index]!) ?? thematicBreak(lines[index]!));
}

function paragraphParser(lines: string[], index: number): ParsedBlock {
  const content = [lines[index]!];
  let next = index + 1;
  while (next < lines.length && lines[next]!.trim() && !startsBlock(lines, next)) {
    content.push(lines[next]!);
    next += 1;
  }
  return {block: {kind: "paragraph", text: content.join("\n")}, next};
}

function simpleParser(lines: string[], index: number): ParsedBlock | null {
  const line = lines[index]!;
  const block = headingBlock(line) ?? taskBlock(line) ?? unsupportedBlock(line) ?? thematicBreak(line);
  return block ? {block, next: index + 1} : null;
}

function parseAt(lines: string[], index: number): ParsedBlock {
  if (!lines[index]!.trim()) return {block: null, next: index + 1};
  return blockAt(lines, index) ?? paragraphParser(lines, index);
}

function styledInline(kind: StyledInlineKind, pattern: RegExp, value: string): ParsedInline | null {
  const match = pattern.exec(value);
  return match ? {segment: {kind, text: match[1] ?? match[2] ?? ""}, length: match[0].length} : null;
}

function wikiLinkInline(value: string): ParsedInline | null {
  const match = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(value);
  return match ? {segment: {kind: "wiki-link", text: match[2] ?? match[1]!, target: match[1]!}, length: match[0].length} : null;
}

function embedDimensions(value: string): {width?: number; height?: number} | null {
  const match = /^(\d+)(?:x(\d+))?$/i.exec(value.trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = match[2] === undefined ? undefined : Number(match[2]);
  if (!Number.isSafeInteger(width) || width <= 0 || height !== undefined && (!Number.isSafeInteger(height) || height <= 0)) return null;
  return height === undefined ? {width} : {width, height};
}

function embedSegment(value: string, label: string): Exclude<MarkdownInlineSegment, {kind: "text"}> {
  const [targetAndFragment, option] = value.split("|", 2);
  const hash = targetAndFragment.indexOf("#");
  const target = hash < 0 ? targetAndFragment : targetAndFragment.slice(0, hash);
  const fragment = hash < 0 ? undefined : targetAndFragment.slice(hash + 1);
  const dimensions = option === undefined ? null : embedDimensions(option);
  const text = dimensions || option === undefined ? label || target : option;
  return {kind: "embed", text, target, ...(fragment ? {fragment} : {}), ...(dimensions ?? {})};
}

function wikiEmbedInline(value: string): ParsedInline | null {
  const match = /^!\[\[([^\]\n]+)\]\]/.exec(value);
  return match ? {segment: embedSegment(match[1]!, ""), length: match[0].length} : null;
}

function markdownEmbedInline(value: string): ParsedInline | null {
  const match = /^!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\)/.exec(value);
  return match ? {segment: embedSegment(match[2]!, match[1]!), length: match[0].length} : null;
}

function linkInline(value: string): ParsedInline | null {
  const match = /^\[([^\]\n]+)\]\(([^)\s]+)(?:\s+["'][^)"]*["'])?\)/.exec(value);
  return match ? {segment: {kind: "link", text: match[1]!, target: match[2]!}, length: match[0].length} : null;
}

const inlineMatchers: readonly InlineMatcher[] = [
  (value) => styledInline("highlight", /^==([^=\n]+)==/, value),
  (value) => styledInline("code", /^`([^`\n]+)`/, value),
  wikiEmbedInline,
  markdownEmbedInline,
  wikiLinkInline,
  linkInline,
  (value) => styledInline("strong", /^\*\*([^*\n]+)\*\*|^__([^_\n]+)__/, value),
  (value) => styledInline("strikethrough", /^~~([^~\n]+)~~/, value),
  (value) => styledInline("emphasis", /^\*([^*\n]+)\*|^_([^_\n]+)_/, value),
];

function inlineAt(value: string, index: number): ParsedInline | null {
  if (index > 0 && value[index - 1] === "\\") return null;
  if (index > 1 && value[index - 1] === "!" && value[index - 2] === "\\") return null;
  const suffix = value.slice(index);
  for (const matcher of inlineMatchers) {
    const parsed = matcher(suffix);
    if (parsed) return parsed;
  }
  return null;
}

export function parseInlineMarkdown(value: string): MarkdownInlineSegment[] {
  const segments: MarkdownInlineSegment[] = [];
  let plain = "";
  const flush = (): void => {
    if (plain) segments.push({kind: "text", text: plain});
    plain = "";
  };
  let index = 0;
  while (index < value.length) {
    const parsed = inlineAt(value, index);
    if (!parsed) {
      plain += value[index]!;
      index += 1;
      continue;
    }
    flush();
    segments.push(parsed.segment);
    index += parsed.length;
  }
  flush();
  return segments;
}

export function parseMarkdownPreview(text: string): MarkdownPreviewBlock[] {
  const lines = splitLines(text);
  const blocks: MarkdownPreviewBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const parsed = parseAt(lines, index);
    if (parsed.block) blocks.push(parsed.block);
    index = parsed.next;
  }
  return blocks;
}
