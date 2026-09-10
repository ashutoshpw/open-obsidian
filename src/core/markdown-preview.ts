export type MarkdownPreviewBlock =
  | {kind: "heading"; level: number; text: string}
  | {kind: "paragraph"; text: string}
  | {kind: "task"; checked: boolean; text: string}
  | {kind: "list"; ordered: boolean; items: string[]}
  | {kind: "quote"; text: string}
  | {kind: "code"; language: string; text: string}
  | {kind: "table"; headers: string[]; rows: string[][]}
  | {kind: "unsupported"; syntax: "footnote" | "math" | "diagram" | "html"; text: string};

type ParsedBlock = {block: MarkdownPreviewBlock | null; next: number};

function splitLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/);
}

function headingBlock(line: string): MarkdownPreviewBlock | null {
  const match = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/.exec(line);
  return match ? {kind: "heading", level: match[1]!.length, text: match[2]!.trim()} : null;
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

function fenceLanguage(line: string): string | null {
  const match = /^ {0,3}```\s*([A-Za-z0-9_+.-]*)\s*$/.exec(line);
  return match ? match[1] ?? "" : null;
}

function codeParser(lines: string[], index: number): ParsedBlock | null {
  const language = fenceLanguage(lines[index]!);
  if (language === null) return null;
  const content: string[] = [];
  let next = index + 1;
  while (next < lines.length && !/^ {0,3}```\s*$/.test(lines[next]!)) {
    content.push(lines[next]!);
    next += 1;
  }
  if (next < lines.length) next += 1;
  const diagram = /^(?:mermaid|plantuml|dot|excalidraw|dataview|dataviewjs)$/i.test(language);
  return diagram ? {block: {kind: "unsupported", syntax: "diagram", text: content.join("\n")}, next} : {block: {kind: "code", language, text: content.join("\n")}, next};
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

function unsupportedBlock(line: string): MarkdownPreviewBlock | null {
  if (/^\s*<\/?[A-Za-z][^>]*>/.test(line)) return {kind: "unsupported", syntax: "html", text: line};
  if (/^\s*\[\^[^\]]+\]:/.test(line) || /\[\^[^\]]+\]/.test(line)) return {kind: "unsupported", syntax: "footnote", text: line};
  if (/^\s*(?:\$\$|\\\[|\\\()/.test(line) || /(?:\$\$|\\\]|\\\))\s*$/.test(line)) return {kind: "unsupported", syntax: "math", text: line};
  return null;
}

function quoteBlock(line: string): MarkdownPreviewBlock | null {
  const match = /^\s*>[ \t]?(.*)$/.exec(line);
  if (!match) return null;
  const callout = /^\[!([A-Za-z0-9_-]+)\][ \t]*(.*)$/.exec(match[1]!);
  return {kind: "quote", text: callout ? `${callout[1]}: ${callout[2]}`.trim() : match[1]!};
}

function simpleParser(lines: string[], index: number): ParsedBlock {
  const line = lines[index]!;
  const block = headingBlock(line) ?? taskBlock(line) ?? unsupportedBlock(line) ?? quoteBlock(line) ?? {kind: "paragraph" as const, text: line};
  return {block, next: index + 1};
}

function parseAt(lines: string[], index: number): ParsedBlock {
  if (!lines[index]!.trim()) return {block: null, next: index + 1};
  return codeParser(lines, index) ?? tableParser(lines, index) ?? listParser(lines, index) ?? simpleParser(lines, index);
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
