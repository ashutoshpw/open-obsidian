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
