import {parseYamlMapping, serializeYamlValue, yamlInlineCommentIndex, type YamlValue} from "./yaml.js";

export type MarkdownLineEnding = "\r\n" | "\n" | "\r" | "mixed" | "none";

export type MarkdownProperty = {
  key: string;
  rawValue: string;
  value: YamlValue | undefined;
  valueStart: number;
  valueEnd: number;
  inlineComment?: string;
};

export type MarkdownDocument = {
  text: string;
  hasBom: boolean;
  lineEnding: MarkdownLineEnding;
  properties: MarkdownProperty[];
  yamlIssues: string[];
};

export type MarkdownHeading = {
  text: string;
  level: number;
  line: number;
};

type FrontmatterBounds = {contentStart: number; contentEnd: number};
type SourceLine = {start: number; indent: number; content: string};
type SourceProperty = {key: string; rawValue: string; valueStart: number; valueEnd: number};
type NestedCandidate = {kind: "stop"} | {kind: "skip"} | {kind: "found"; property: SourceProperty};

function detectLineEnding(text: string): MarkdownLineEnding {
  const endings = [...text.matchAll(/\r\n|\n|\r/g)].map((match) => match[0]);
  if (endings.length === 0) return "none";
  if (endings.every((ending) => ending === endings[0])) return endings[0] as MarkdownLineEnding;
  return "mixed";
}

function decodeUtf8(bytes: Uint8Array): {text: string; hasBom: boolean} {
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  return {text: new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(bytes), hasBom};
}

function frontmatterBounds(text: string): FrontmatterBounds | null {
  const opening = /^(?:\uFEFF)?---(?:\r\n|\n|\r)/.exec(text);
  if (!opening) return null;
  const remainder = text.slice(opening[0].length);
  const closing = /^---[ \t]*(?:\r\n|\n|\r|$)/m.exec(remainder);
  if (!closing) return null;
  return {contentStart: opening[0].length, contentEnd: opening[0].length + closing.index};
}

function sourceLines(text: string, bounds: FrontmatterBounds): SourceLine[] {
  const source = text.slice(bounds.contentStart, bounds.contentEnd);
  const lines: SourceLine[] = [];
  const linePattern = /[^\r\n]*(?:\r\n|\n|\r|$)/g;
  let offset = 0;
  for (const match of source.matchAll(linePattern)) {
    const line = match[0]!;
    const body = line.replace(/(?:\r\n|\n|\r)$/, "");
    const indentation = /^[ ]*/.exec(body)?.[0].length ?? 0;
    const content = body.slice(indentation).trimEnd();
    const meaningful = content.trim();
    if (meaningful && !meaningful.startsWith("#")) {
      lines.push({start: bounds.contentStart + offset, indent: indentation, content});
    }
    offset += line.length;
    if (line.length === 0) break;
  }
  return lines;
}

function unquoteMappingKey(value: string): string | undefined {
  const trimmed = value.trim();
  if (/^[A-Za-z0-9_.-]+$/.test(trimmed)) return trimmed;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replaceAll("''", "'");
  return undefined;
}

function sourceProperty(line: SourceLine): SourceProperty | undefined {
  const match = /^((?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[A-Za-z0-9_.-]+))([ \t]*):([ \t]*)(.*)$/.exec(line.content);
  if (!match) return undefined;
  const key = unquoteMappingKey(match[1]!);
  if (!key) return undefined;
  const keyAndSpacingLength = match[1]!.length + match[2]!.length;
  const afterColon = `${match[3]!}${match[4]!}`;
  const comment = yamlInlineCommentIndex(afterColon);
  const beforeComment = comment < 0 ? afterColon : afterColon.slice(0, comment);
  const rawValue = beforeComment.trim();
  const valueStart = line.start + line.indent + keyAndSpacingLength + 1 + (beforeComment.length - beforeComment.trimStart().length);
  return {key, rawValue, valueStart, valueEnd: valueStart + rawValue.length};
}

function blockEnd(lines: SourceLine[], start: number, parentIndent: number): number {
  let index = start;
  while (index < lines.length && lines[index]!.indent > parentIndent) index += 1;
  return index;
}

function nestedLeafValue(property: SourceProperty, path: readonly string[]): SourceProperty {
  if (!property.rawValue || property.rawValue === "|" || property.rawValue === ">") throw new Error(`Structured Markdown property edit requires an inline value: ${path.join(".")}`);
  return property;
}

function nestedLeafChild(lines: SourceLine[], index: number, end: number, indent: number, path: readonly string[], pathIndex: number, property: SourceProperty): SourceProperty {
  if (property.rawValue) throw new Error(`Nested Markdown property is inline and cannot be traversed: ${path.slice(0, pathIndex + 1).join(".")}`);
  const child = index + 1;
  if (child >= end || lines[child]!.indent <= indent) throw new Error(`Nested Markdown property has no represented child: ${path.join(".")}`);
  return nestedLeaf(lines, child, blockEnd(lines, child, indent), lines[child]!.indent, path, pathIndex + 1);
}

function nestedCandidate(line: SourceLine, indent: number, wanted: string, path: readonly string[], pathIndex: number): NestedCandidate {
  if (line.indent < indent) return {kind: "stop"};
  if (line.indent !== indent) return {kind: "skip"};
  if (line.content === "-" || line.content.startsWith("- ")) throw new Error(`Nested Markdown property path enters an unsupported sequence: ${path.slice(0, pathIndex + 1).join(".")}`);
  const property = sourceProperty(line);
  return property?.key === wanted ? {kind: "found", property} : {kind: "skip"};
}

function nestedLeaf(lines: SourceLine[], start: number, end: number, indent: number, path: readonly string[], pathIndex: number): SourceProperty {
  const wanted = path[pathIndex];
  if (!wanted) throw new Error("Nested Markdown property path must contain at least one key");
  for (let index = start; index < end; index += 1) {
    const candidate = nestedCandidate(lines[index]!, indent, wanted, path, pathIndex);
    if (candidate.kind === "stop") break;
    if (candidate.kind === "skip") continue;
    const property = candidate.property;
    return pathIndex === path.length - 1
      ? nestedLeafValue(property, path)
      : nestedLeafChild(lines, index, end, indent, path, pathIndex, property);
  }
  throw new Error(`Markdown property is not represented: ${path.join(".")}`);
}

function propertiesIn(text: string, bounds: FrontmatterBounds | null): {properties: MarkdownProperty[]; yamlIssues: string[]} {
  if (!bounds) return {properties: [], yamlIssues: []};
  const properties: MarkdownProperty[] = [];
  const source = text.slice(bounds.contentStart, bounds.contentEnd);
  const parsed = parseYamlMapping(source);
  const linePattern = /[^\r\n]*(?:\r\n|\n|\r|$)/g;
  let offset = 0;
  for (const match of source.matchAll(linePattern)) {
    const line = match[0];
    const property = /^([A-Za-z0-9_-]+)([ \t]*):([ \t]*)([^\r\n]*)(?:\r\n|\n|\r|$)$/.exec(line);
    if (property) {
      const prefix = `${property[1]}${property[2]}:`;
      const rawAfterColon = `${property[3]}${property[4]}`;
      const commentIndex = yamlInlineCommentIndex(rawAfterColon);
      const beforeComment = commentIndex < 0 ? rawAfterColon : rawAfterColon.slice(0, commentIndex);
      const rawValue = beforeComment.trim();
      const valueStart = bounds.contentStart + offset + prefix.length + (beforeComment.length - beforeComment.trimStart().length);
      const inlineComment = commentIndex < 0 ? undefined : rawAfterColon.slice(commentIndex).trimEnd();
      properties.push({key: property[1], rawValue, value: parsed.value[property[1]], valueStart, valueEnd: valueStart + rawValue.length, inlineComment});
    }
    offset += line.length;
    if (line.length === 0) break;
  }
  return {properties, yamlIssues: parsed.issues};
}

export function parseMarkdown(bytes: Uint8Array): MarkdownDocument {
  const decoded = decodeUtf8(bytes);
  const metadata = propertiesIn(decoded.text, frontmatterBounds(decoded.text));
  return {text: decoded.text, hasBom: decoded.hasBom, lineEnding: detectLineEnding(decoded.text), properties: metadata.properties, yamlIssues: metadata.yamlIssues};
}

export function extractMarkdownHeadings(text: string): MarkdownHeading[] {
  let fenced = false;
  return text.split(/\r\n|\n|\r/).flatMap((line, index) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return [];
    }
    if (fenced) return [];
    const match = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/.exec(line);
    if (!match) return [];
    return [{text: match[2]!.trim(), level: match[1]!.length, line: index + 1}];
  });
}

function encodeMarkdown(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function replaceMarkdownSpan(bytes: Uint8Array, start: number, end: number, replacement: string): Uint8Array {
  const text = decodeUtf8(bytes).text;
  if (start < 0 || end < start || end > text.length) throw new RangeError("Markdown edit span is outside the decoded document");
  return encodeMarkdown(`${text.slice(0, start)}${replacement}${text.slice(end)}`);
}

export function editMarkdownProperty(bytes: Uint8Array, key: string, rawValue: string): Uint8Array {
  const document = parseMarkdown(bytes);
  const property = document.properties.find((candidate) => candidate.key === key);
  if (!property) throw new Error(`Markdown property is not represented: ${key}`);
  const separator = property.rawValue.length === 0 && property.inlineComment && rawValue.trim() && !/\s$/.test(rawValue) ? " " : "";
  return replaceMarkdownSpan(bytes, property.valueStart, property.valueEnd, rawValue + separator);
}

/**
 * Edit an existing single-line property with a typed value. Nested block
 * properties are intentionally refused because replacing only their header
 * would orphan child lines and risk source loss.
 */
export function editMarkdownPropertyValue(bytes: Uint8Array, key: string, value: YamlValue): Uint8Array {
  const document = parseMarkdown(bytes);
  const property = document.properties.find((candidate) => candidate.key === key);
  if (!property) throw new Error(`Markdown property is not represented: ${key}`);
  if (!property.rawValue.trim() || ["|", ">"].includes(property.rawValue.trim())) throw new Error(`Structured Markdown property edit requires an inline value: ${key}`);
  return editMarkdownProperty(bytes, key, serializeYamlValue(value, {style: "flow"}));
}

/**
 * Edit an existing inline scalar nested under block-style mappings. The path
 * is intentionally explicit (for example, ["metadata", "owner"]): only the
 * leaf scalar span is replaced, so comments, unknown siblings, indentation,
 * line endings and all other source bytes remain untouched. Flow collections,
 * sequence entries and block scalars are refused until their source-preserving
 * edit semantics are specified.
 */
export function editMarkdownNestedPropertyValue(bytes: Uint8Array, path: readonly string[], value: YamlValue): Uint8Array {
  if (path.length === 0 || path.some((segment) => !segment.trim())) throw new Error("Nested Markdown property path must contain non-empty keys");
  const document = parseMarkdown(bytes);
  const bounds = frontmatterBounds(document.text);
  if (!bounds) throw new Error(`Markdown property is not represented: ${path.join(".")}`);
  const lines = sourceLines(document.text, bounds);
  const root = lines[0];
  if (!root) throw new Error(`Markdown property is not represented: ${path.join(".")}`);
  const property = nestedLeaf(lines, 0, lines.length, root.indent, path, 0);
  return replaceMarkdownSpan(bytes, property.valueStart, property.valueEnd, serializeYamlValue(value, {style: "flow"}));
}
