import {parseYamlMapping, serializeYamlValue, yamlFlowMapEntries, yamlFlowSequenceEntries, yamlInlineCommentIndex, type YamlValue} from "./yaml.js";

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
export type MarkdownPropertyPath = readonly (string | number)[];

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

function sourceProperty(line: SourceLine, sequenceHead = false): SourceProperty | undefined {
  const sequencePrefix = sequenceHead ? /^(?:-[ \t]+|-)/.exec(line.content)?.[0] ?? "" : "";
  const content = line.content.slice(sequencePrefix.length);
  const match = /^((?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[A-Za-z0-9_.-]+))([ \t]*):([ \t]*)(.*)$/.exec(content);
  if (!match) return undefined;
  const key = unquoteMappingKey(match[1]!);
  if (!key) return undefined;
  const keyAndSpacingLength = match[1]!.length + match[2]!.length;
  const afterColon = `${match[3]!}${match[4]!}`;
  const comment = yamlInlineCommentIndex(afterColon);
  const beforeComment = comment < 0 ? afterColon : afterColon.slice(0, comment);
  const rawValue = beforeComment.trim();
  const valueStart = line.start + line.indent + sequencePrefix.length + keyAndSpacingLength + 1 + (beforeComment.length - beforeComment.trimStart().length);
  return {key, rawValue, valueStart, valueEnd: valueStart + rawValue.length};
}

function blockEnd(lines: SourceLine[], start: number, parentIndent: number): number {
  let index = start;
  while (index < lines.length && lines[index]!.indent > parentIndent) index += 1;
  return index;
}

function pathLabel(path: MarkdownPropertyPath): string {
  return path.map(String).join(".");
}

function nestedLeafValue(property: SourceProperty, path: MarkdownPropertyPath): SourceProperty {
  if (!property.rawValue || property.rawValue === "|" || property.rawValue === ">") throw new Error(`Structured Markdown property edit requires an inline value: ${pathLabel(path)}`);
  return property;
}

function sequenceLine(line: SourceLine): boolean {
  return line.content === "-" || line.content.startsWith("- ");
}

function sequenceItemEnd(lines: SourceLine[], start: number, end: number, indent: number): number {
  let itemEnd = start + 1;
  while (itemEnd < end && lines[itemEnd]!.indent > indent) itemEnd += 1;
  return itemEnd;
}

function findSequenceItem(lines: SourceLine[], start: number, end: number, indent: number, wanted: number): {start: number; end: number} | undefined {
  let item = 0;
  for (let index = start; index < end; index += 1) {
    const line = lines[index]!;
    if (line.indent < indent || !sequenceLine(line)) break;
    if (line.indent !== indent) continue;
    const itemEnd = sequenceItemEnd(lines, index, end, indent);
    if (item === wanted) return {start: index, end: itemEnd};
    item += 1;
    index = itemEnd - 1;
  }
  return undefined;
}

function nestedSequence(lines: SourceLine[], start: number, end: number, indent: number, path: MarkdownPropertyPath, pathIndex: number): SourceProperty {
  const wanted = path[pathIndex];
  if (typeof wanted !== "number" || !Number.isInteger(wanted) || wanted < 0) throw new Error(`Nested Markdown sequence path requires a non-negative integer index: ${pathLabel(path)}`);
  const item = findSequenceItem(lines, start, end, indent, wanted);
  if (!item) throw new Error(`Markdown property is not represented: ${pathLabel(path)}`);
  return nestedSequenceItem(lines, item.start, item.end, indent, path, pathIndex + 1);
}

function nestedSequenceHead(lines: SourceLine[], start: number, end: number, sequenceIndent: number, path: MarkdownPropertyPath, pathIndex: number, head: SourceProperty): SourceProperty {
  const wanted = path[pathIndex];
  if (head.key === wanted) {
    if (pathIndex === path.length - 1) return nestedLeafValue(head, path);
    return nestedLeafChild(lines, start, end, sequenceIndent, path, pathIndex, head);
  }
  if (head.rawValue === "") throw new Error(`Nested Markdown sequence item has an ambiguous nested mapping; address its first key explicitly: ${pathLabel(path)}`);
  return nestedSequenceContinuation(lines, start, end, sequenceIndent, path, pathIndex);
}

function nestedSequenceBare(lines: SourceLine[], start: number, end: number, sequenceIndent: number, path: MarkdownPropertyPath, pathIndex: number): SourceProperty {
  if (lines[start]!.content !== "-") throw new Error(`Nested Markdown sequence item is not a represented mapping: ${pathLabel(path)}`);
  const child = start + 1;
  if (child >= end || lines[child]!.indent <= sequenceIndent) throw new Error(`Nested Markdown sequence item has no represented mapping: ${pathLabel(path)}`);
  return nestedMap(lines, child, end, lines[child]!.indent, path, pathIndex);
}

function nestedSequenceContinuation(lines: SourceLine[], start: number, end: number, sequenceIndent: number, path: MarkdownPropertyPath, pathIndex: number): SourceProperty {
  const continuation = start + 1;
  if (continuation >= end || lines[continuation]!.indent <= sequenceIndent) throw new Error(`Markdown property is not represented: ${pathLabel(path)}`);
  return nestedMap(lines, continuation, end, lines[continuation]!.indent, path, pathIndex);
}

function nestedFlowMapValue(property: SourceProperty, path: MarkdownPropertyPath, pathIndex: number): SourceProperty {
  if (pathIndex === path.length - 1) return nestedLeafValue(property, path);
  if (property.rawValue.startsWith("{") && property.rawValue.endsWith("}")) return nestedFlowMap(property.rawValue, property.valueStart, path, pathIndex + 1);
  if (property.rawValue.startsWith("[") && property.rawValue.endsWith("]")) return nestedFlowSequence(property.rawValue, property.valueStart, path, pathIndex + 1);
  throw new Error(`Nested Markdown property is inline and cannot be traversed: ${pathLabel(path.slice(0, pathIndex + 1))}`);
}

function nestedFlowMap(rawValue: string, valueStart: number, path: MarkdownPropertyPath, pathIndex: number): SourceProperty {
  const entries = yamlFlowMapEntries(rawValue);
  if (!entries) throw new Error(`Nested Markdown flow mapping is not represented: ${pathLabel(path)}`);
  const wanted = path[pathIndex];
  if (typeof wanted !== "string" || !wanted.trim()) throw new Error(`Nested Markdown flow mappings require a non-empty key: ${pathLabel(path)}`);
  const entry = entries.find((candidate) => candidate.key === wanted);
  if (!entry) throw new Error(`Markdown property is not represented: ${pathLabel(path)}`);
  const property: SourceProperty = {key: entry.key, rawValue: entry.rawValue, valueStart: valueStart + entry.valueStart, valueEnd: valueStart + entry.valueEnd};
  return nestedFlowMapValue(property, path, pathIndex);
}

function nestedFlowSequence(rawValue: string, valueStart: number, path: MarkdownPropertyPath, pathIndex: number): SourceProperty {
  const entries = yamlFlowSequenceEntries(rawValue);
  if (!entries) throw new Error(`Nested Markdown flow sequence is not represented: ${pathLabel(path)}`);
  const wanted = path[pathIndex];
  if (typeof wanted !== "number" || !Number.isInteger(wanted) || wanted < 0) throw new Error(`Nested Markdown flow sequences require a non-negative integer index: ${pathLabel(path)}`);
  const entry = entries[wanted];
  if (!entry) throw new Error(`Markdown property is not represented: ${pathLabel(path)}`);
  const property: SourceProperty = {key: String(entry.index), rawValue: entry.rawValue, valueStart: valueStart + entry.valueStart, valueEnd: valueStart + entry.valueEnd};
  return nestedFlowMapValue(property, path, pathIndex);
}

function nestedSequenceItem(lines: SourceLine[], start: number, end: number, sequenceIndent: number, path: MarkdownPropertyPath, pathIndex: number): SourceProperty {
  const wanted = path[pathIndex];
  if (typeof wanted !== "string" || !wanted.trim()) throw new Error(`Nested Markdown sequence items require a mapping key: ${pathLabel(path)}`);
  const head = sourceProperty(lines[start]!, true);
  if (head) return nestedSequenceHead(lines, start, end, sequenceIndent, path, pathIndex, head);
  return nestedSequenceBare(lines, start, end, sequenceIndent, path, pathIndex);
}

function nestedInlineChild(property: SourceProperty, path: MarkdownPropertyPath, pathIndex: number): SourceProperty {
  if (typeof path[pathIndex + 1] !== "string" && typeof path[pathIndex + 1] !== "number") throw new Error(`Nested Markdown property is inline and cannot be traversed: ${pathLabel(path.slice(0, pathIndex + 1))}`);
  return nestedFlowMapValue(property, path, pathIndex);
}

function nestedBlockChild(lines: SourceLine[], index: number, end: number, indent: number, path: MarkdownPropertyPath, pathIndex: number): SourceProperty {
  const child = index + 1;
  if (child >= end || lines[child]!.indent <= indent) throw new Error(`Nested Markdown property has no represented child: ${pathLabel(path)}`);
  const childIndent = lines[child]!.indent;
  if (typeof path[pathIndex + 1] === "number") {
    if (!sequenceLine(lines[child]!)) throw new Error(`Nested Markdown property path expects a sequence: ${pathLabel(path)}`);
    return nestedSequence(lines, child, blockEnd(lines, child, indent), childIndent, path, pathIndex + 1);
  }
  if (sequenceLine(lines[child]!)) throw new Error(`Nested Markdown property path enters an unsupported sequence: ${pathLabel(path.slice(0, pathIndex + 2))}`);
  return nestedMap(lines, child, blockEnd(lines, child, indent), childIndent, path, pathIndex + 1);
}

function nestedLeafChild(lines: SourceLine[], index: number, end: number, indent: number, path: MarkdownPropertyPath, pathIndex: number, property: SourceProperty): SourceProperty {
  if (property.rawValue) return nestedInlineChild(property, path, pathIndex);
  return nestedBlockChild(lines, index, end, indent, path, pathIndex);
}

function findMapProperty(lines: SourceLine[], start: number, end: number, indent: number, wanted: string, path: MarkdownPropertyPath, pathIndex: number): {index: number; property: SourceProperty} | undefined {
  for (let index = start; index < end; index += 1) {
    const line = lines[index]!;
    if (line.indent < indent) break;
    if (line.indent !== indent) continue;
    if (sequenceLine(line)) throw new Error(`Nested Markdown property path enters an unsupported sequence: ${pathLabel(path.slice(0, pathIndex + 1))}`);
    const property = sourceProperty(line);
    if (property?.key !== wanted) continue;
    return {index, property};
  }
  return undefined;
}

function nestedMap(lines: SourceLine[], start: number, end: number, indent: number, path: MarkdownPropertyPath, pathIndex: number): SourceProperty {
  const wanted = path[pathIndex];
  if (typeof wanted !== "string" || !wanted.trim()) throw new Error(`Nested Markdown mapping path requires a non-empty key: ${pathLabel(path)}`);
  const match = findMapProperty(lines, start, end, indent, wanted, path, pathIndex);
  if (!match) throw new Error(`Markdown property is not represented: ${pathLabel(path)}`);
  if (pathIndex === path.length - 1) return nestedLeafValue(match.property, path);
  return nestedLeafChild(lines, match.index, end, indent, path, pathIndex, match.property);
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
 * is intentionally explicit (for example, ["metadata", "owner"],
 * ["metadata", "children", 0, "owner"] or ["metadata", "aliases", 1]):
 * only the selected leaf span is replaced, so comments, unknown siblings,
 * indentation, line endings and all other source bytes remain untouched.
 * Ambiguous sequence entries, malformed flow collections and block scalars
 * are refused until their source-preserving edit semantics are specified.
 */
export function editMarkdownNestedPropertyValue(bytes: Uint8Array, path: MarkdownPropertyPath, value: YamlValue): Uint8Array {
  if (path.length === 0 || path.some((segment) => (typeof segment === "string" && !segment.trim()) || (typeof segment === "number" && (!Number.isInteger(segment) || segment < 0)))) throw new Error("Nested Markdown property path must contain non-empty keys and non-negative integer sequence indexes");
  const document = parseMarkdown(bytes);
  const bounds = frontmatterBounds(document.text);
  if (!bounds) throw new Error(`Markdown property is not represented: ${pathLabel(path)}`);
  const lines = sourceLines(document.text, bounds);
  const root = lines[0];
  if (!root) throw new Error(`Markdown property is not represented: ${pathLabel(path)}`);
  const property = nestedMap(lines, 0, lines.length, root.indent, path, 0);
  return replaceMarkdownSpan(bytes, property.valueStart, property.valueEnd, serializeYamlValue(value, {style: "flow"}));
}
