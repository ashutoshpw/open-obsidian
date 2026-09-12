export type YamlScalar = string | number | boolean | null;
export type YamlValue = YamlScalar | YamlValue[] | {[key: string]: YamlValue};
export type YamlMap = {[key: string]: YamlValue};

type YamlLine = {indent: number; content: string; line: number};
type YamlPair = {key: string; value: string};
type ParsedBlock = {value: YamlValue; index: number};
type ParsedMapEntry = {key: string; value: YamlValue; index: number};
type ParsedSequenceItem = {value: YamlValue; index: number};
type ScanState = {quote: '"' | "'" | undefined; depth: number};

function defineKey(target: YamlMap, key: string, value: YamlValue): void {
  Object.defineProperty(target, key, {configurable: true, enumerable: true, value, writable: true});
}

function yamlMap(): YamlMap {
  return {};
}

function quoteAt(value: string, index: number): '"' | "'" | undefined {
  const character = value[index];
  return character === '"' || character === "'" ? character : undefined;
}

function advanceScanState(state: ScanState, value: string, index: number): void {
  const character = value[index] ?? "";
  if (state.quote) {
    if (character === state.quote && value[index - 1] !== "\\") state.quote = undefined;
    return;
  }
  const nextQuote = quoteAt(value, index);
  if (nextQuote) {
    state.quote = nextQuote;
    return;
  }
  if ("[{(".includes(character)) state.depth += 1;
  if (")]}".includes(character)) state.depth = Math.max(0, state.depth - 1);
}

function scanTopLevel(value: string, predicate: (character: string, index: number) => boolean): number {
  const state: ScanState = {quote: undefined, depth: 0};
  for (let index = 0; index < value.length; index += 1) {
    advanceScanState(state, value, index);
    const character = value[index] ?? "";
    if (!state.quote && state.depth === 0 && predicate(character, index)) return index;
  }
  return -1;
}

function isCommentStart(value: string, character: string, index: number): boolean {
  return character === "#" && (index === 0 || /\s/.test(value[index - 1] ?? ""));
}

export function yamlInlineCommentIndex(value: string): number {
  return scanTopLevel(value, (character, index) => isCommentStart(value, character, index));
}

function stripComment(value: string): string {
  const comment = yamlInlineCommentIndex(value);
  return comment < 0 ? value.trimEnd() : value.slice(0, comment).trimEnd();
}

function tokenize(source: string, issues: string[]): YamlLine[] {
  return source.split(/\r\n|\n|\r/).flatMap((raw, index) => {
    if (/\t/.test(raw.match(/^\s*/)?.[0] ?? "")) issues.push(`line ${index + 1}: tabs are not supported for YAML indentation`);
    const indentation = /^[ ]*/.exec(raw)?.[0].length ?? 0;
    const content = stripComment(raw.slice(indentation)).trim();
    return content && !content.startsWith("#") ? [{indent: indentation, content, line: index + 1}] : [];
  });
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replaceAll("''", "'");
  return trimmed;
}

function mappingKey(value: string): string | undefined {
  const key = unquote(value);
  const quoted = value.startsWith('"') || value.startsWith("'");
  return key && (quoted || /^[A-Za-z0-9_.-]+$/.test(key)) ? key : undefined;
}

function pair(value: string): YamlPair | undefined {
  const colon = scanTopLevel(value, (character) => character === ":");
  const following = colon < 0 ? "" : value[colon + 1] ?? "";
  if (colon <= 0 || (following && !/\s/.test(following))) return undefined;
  const rawKey = value.slice(0, colon).trim();
  const key = mappingKey(rawKey);
  if (!key) return undefined;
  return {key, value: value.slice(colon + 1).trim()};
}

function delimitedParts(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start <= value.length) {
    const relativeSeparator = scanTopLevel(value.slice(start), (character) => character === ",");
    if (relativeSeparator < 0) {
      const last = value.slice(start).trim();
      if (last) parts.push(last);
      return parts;
    }
    const separator = start + relativeSeparator;
    const part = value.slice(start, separator).trim();
    if (part) parts.push(part);
    start = separator + 1;
  }
  return parts;
}

function flowArray(value: string, issues: string[], line: number): YamlValue[] | undefined {
  if (!value.startsWith("[") || !value.endsWith("]")) return undefined;
  return delimitedParts(value.slice(1, -1)).map((part) => scalar(part, issues, line));
}

function flowObject(value: string, issues: string[], line: number): YamlMap | undefined {
  if (!value.startsWith("{") || !value.endsWith("}")) return undefined;
  const result = yamlMap();
  delimitedParts(value.slice(1, -1)).forEach((entry) => {
    const parsed = pair(entry);
    if (!parsed) {
      issues.push(`line ${line}: inline YAML map entry is not supported`);
      return;
    }
    defineKey(result, parsed.key, scalar(parsed.value, issues, line));
  });
  return result;
}

function flowCollection(value: string, issues: string[], line: number): YamlValue | undefined {
  return flowArray(value, issues, line) ?? flowObject(value, issues, line);
}

export type YamlFlowMapEntry = {key: string; rawValue: string; valueStart: number; valueEnd: number};
export type YamlFlowSequenceEntry = {index: number; rawValue: string; valueStart: number; valueEnd: number};

type FlowEntryRange = {start: number; end: number};
const flowDelimiterPairs: Readonly<Record<string, string>> = {")": "(", "]": "[", "}": "{"};

type FlowEntryCharacter = "invalid" | "separator" | "other";

function flowEntryCharacter(scan: ScanState, delimiters: string[], value: string, index: number): FlowEntryCharacter {
  const character = value[index] ?? "";
  advanceScanState(scan, value, index);
  if (scan.quote) return "other";
  const expected = flowDelimiterPairs[character];
  if (expected) return delimiters.pop() === expected ? "other" : "invalid";
  if ("[{(".includes(character)) {
    delimiters.push(character);
    return "other";
  }
  return scan.depth === 0 && character === "," ? "separator" : "other";
}

function flowEntryRanges(value: string, opening: string, closing: string): FlowEntryRange[] | undefined {
  if (!value.startsWith(opening) || !value.endsWith(closing)) return undefined;
  const ranges: FlowEntryRange[] = [];
  let start = 1;
  const delimiters: string[] = [];
  const state: ScanState = {quote: undefined, depth: 0};
  for (let index = 1; index < value.length - 1; index += 1) {
    const character = flowEntryCharacter(state, delimiters, value, index);
    if (character === "invalid") return undefined;
    if (character === "separator") {
      ranges.push({start, end: index});
      start = index + 1;
    }
  }
  if (state.quote || delimiters.length !== 0) return undefined;
  ranges.push({start, end: value.length - 1});
  return ranges;
}

function flowMapEntry(value: string, start: number, end: number): YamlFlowMapEntry | undefined {
  const source = value.slice(start, end);
  const parsed = pair(source);
  if (!parsed) return undefined;
  const colon = scanTopLevel(source, (character) => character === ":");
  if (colon < 0) return undefined;
  const afterColon = source.slice(colon + 1);
  const comment = yamlInlineCommentIndex(afterColon);
  const beforeComment = comment < 0 ? afterColon : afterColon.slice(0, comment);
  const rawValue = beforeComment.trim();
  const leading = beforeComment.length - beforeComment.trimStart().length;
  const valueStart = start + colon + 1 + leading;
  return {key: parsed.key, rawValue, valueStart, valueEnd: valueStart + rawValue.length};
}

/**
 * Return source spans for entries in a single-line flow mapping. The caller
 * can replace one value span without reserializing the surrounding map. A
 * malformed entry returns undefined so source-preserving editors fail closed.
 */
export function yamlFlowMapEntries(value: string): YamlFlowMapEntry[] | undefined {
  const ranges = flowEntryRanges(value, "{", "}");
  if (!ranges) return undefined;
  const entries: YamlFlowMapEntry[] = [];
  for (const range of ranges) {
    if (value.slice(range.start, range.end).trim() === "") continue;
    const entry = flowMapEntry(value, range.start, range.end);
    if (!entry) return undefined;
    entries.push(entry);
  }
  return entries;
}

function flowSequenceEntry(value: string, start: number, end: number, index: number): YamlFlowSequenceEntry | undefined {
  const source = value.slice(start, end);
  const rawValue = source.trim();
  if (!rawValue) return undefined;
  const leading = source.length - source.trimStart().length;
  return {index, rawValue, valueStart: start + leading, valueEnd: start + leading + rawValue.length};
}

/**
 * Return source spans for entries in a single-line flow sequence. The caller
 * can replace one indexed entry without reserializing the surrounding list.
 * Empty, unbalanced or otherwise malformed entries return undefined so
 * source-preserving editors fail closed.
 */
export function yamlFlowSequenceEntries(value: string): YamlFlowSequenceEntry[] | undefined {
  const ranges = flowEntryRanges(value, "[", "]");
  if (!ranges) return undefined;
  if (value.slice(1, -1).trim() === "") return [];
  const entries: YamlFlowSequenceEntry[] = [];
  for (const range of ranges) {
    const entry = flowSequenceEntry(value, range.start, range.end, entries.length);
    if (!entry) return undefined;
    entries.push(entry);
  }
  return entries;
}

function parseNullScalar(value: string, _issues: string[], _line: number): YamlValue | undefined {
  return !value || value === "~" || /^(?:null|nil)$/i.test(value) ? null : undefined;
}

function parseBlockScalar(value: string, issues: string[], line: number): YamlValue | undefined {
  if (value !== "|" && value !== ">") return undefined;
  const name = value === "|" ? "literal" : "folded";
  issues.push("line " + line + ": " + name + " YAML blocks are preserved as raw source but not structured");
  return value;
}

function parseQuotedScalar(value: string, _issues: string[], _line: number): YamlValue | undefined {
  const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
  return quoted ? unquote(value) : undefined;
}

function parseBooleanScalar(value: string, _issues: string[], _line: number): YamlValue | undefined {
  return /^(?:true|false)$/i.test(value) ? value.toLocaleLowerCase() === "true" : undefined;
}

function parseNumberScalar(value: string, _issues: string[], _line: number): YamlValue | undefined {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ? Number(value) : undefined;
}

type ScalarParser = (value: string, issues: string[], line: number) => YamlValue | undefined;
const scalarParsers: readonly ScalarParser[] = [parseNullScalar, parseBlockScalar, parseQuotedScalar, flowCollection, parseBooleanScalar, parseNumberScalar];

function scalar(value: string, issues: string[], line: number): YamlValue {
  const trimmed = stripComment(value).trim();
  for (const parser of scalarParsers) {
    const parsed = parser(trimmed, issues, line);
    if (parsed !== undefined) return parsed;
  }
  return trimmed;
}

export type YamlSerializeStyle = "block" | "flow";
export type YamlSerializeOptions = {indent?: number; style?: YamlSerializeStyle};

function isYamlScalar(value: YamlValue): value is YamlScalar {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function yamlKey(value: string): string {
  return /^[A-Za-z0-9_.-]+$/.test(value) ? value : JSON.stringify(value);
}

function yamlScalar(value: YamlScalar): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (!Number.isFinite(value)) throw new TypeError("YAML numbers must be finite");
  return Object.is(value, -0) ? "-0" : String(value);
}

function yamlFlow(value: YamlValue): string {
  if (isYamlScalar(value)) return yamlScalar(value);
  if (Array.isArray(value)) return `[${value.map(yamlFlow).join(", ")}]`;
  return `{${Object.entries(value).map(([key, nested]) => `${yamlKey(key)}: ${yamlFlow(nested)}`).join(", ")}}`;
}

function yamlBlock(value: YamlValue, level: number, indent: number): string[] {
  const prefix = " ".repeat(level * indent);
  if (isYamlScalar(value)) return [prefix + yamlScalar(value)];
  if (Array.isArray(value)) {
    if (value.length === 0) return [prefix + "[]"];
    return value.flatMap((entry) => isYamlScalar(entry) ? [`${prefix}- ${yamlScalar(entry)}`] : [`${prefix}-`, ...yamlBlock(entry, level + 1, indent)]);
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return [prefix + "{}"];
  return entries.flatMap(([key, nested]) => {
    const label = `${prefix}${yamlKey(key)}:`;
    return isYamlScalar(nested) ? [`${label} ${yamlScalar(nested)}`] : [label, ...yamlBlock(nested, level + 1, indent)];
  });
}

function yamlIndent(options: YamlSerializeOptions): number {
  const indent = options.indent ?? 2;
  if (!Number.isInteger(indent) || indent < 1 || indent > 8) throw new RangeError("YAML indentation must be an integer from 1 to 8");
  return indent;
}

/**
 * Serialize only the same scalar, sequence and mapping values understood by
 * the bounded reader. Callers editing Markdown must retain the original
 * source spans and refuse unsupported YAML rather than round-tripping it.
 */
export function serializeYamlValue(value: YamlValue, options: YamlSerializeOptions = {}): string {
  if (options.style === "flow") return yamlFlow(value);
  return yamlBlock(value, 0, yamlIndent(options)).join("\n");
}

function isSequenceLine(line: YamlLine): boolean {
  return line.content === "-" || line.content.startsWith("- ");
}

function parseBlock(lines: YamlLine[], start: number, indent: number, issues: string[]): ParsedBlock {
  return isSequenceLine(lines[start]!) ? parseSequence(lines, start, indent, issues) : parseMap(lines, start, indent, issues);
}

function hasNestedBlockValue(next: YamlLine | undefined, indent: number): boolean {
  return Boolean(next && (next.indent > indent || (next.indent === indent && isSequenceLine(next))));
}

function parseMapEntry(lines: YamlLine[], start: number, indent: number, issues: string[]): ParsedMapEntry | undefined {
  const current = lines[start]!;
  const parsed = pair(current.content);
  if (!parsed) {
    issues.push(`line ${current.line}: YAML mapping entry is not supported`);
    return undefined;
  }
  const next = lines[start + 1];
  let index = start + 1;
  let value: YamlValue;
  if (!parsed.value && hasNestedBlockValue(next, indent)) {
    const child = parseBlock(lines, start + 1, next.indent, issues);
    value = child.value;
    index = child.index;
  } else {
    value = scalar(parsed.value, issues, current.line);
    if (parsed.value === "|" || parsed.value === ">") while (lines[index] && lines[index]!.indent > indent) index += 1;
  }
  return {key: parsed.key, value, index};
}

function parseMap(lines: YamlLine[], start: number, indent: number, issues: string[]): ParsedBlock {
  const result = yamlMap();
  let index = start;
  while (index < lines.length) {
    const current = lines[index]!;
    if (current.indent < indent || isSequenceLine(current)) break;
    if (current.indent > indent) {
      issues.push(`line ${current.line}: unexpected indentation`);
      index += 1;
      continue;
    }
    const entry = parseMapEntry(lines, index, indent, issues);
    if (!entry) {
      index += 1;
      continue;
    }
    defineKey(result, entry.key, entry.value);
    index = entry.index;
  }
  return {value: result, index};
}

function mergeMap(target: YamlMap, source: YamlValue): void {
  if (source === null || Array.isArray(source) || typeof source !== "object") return;
  Object.entries(source).forEach(([key, value]) => defineKey(target, key, value));
}

function sequenceRest(line: YamlLine): string {
  return line.content.slice(line.content === "-" ? 1 : 2).trim();
}

function parseBareSequenceItem(lines: YamlLine[], index: number, indent: number, rest: string, issues: string[]): ParsedSequenceItem {
  const next = lines[index + 1];
  if (!rest && next && next.indent > indent) {
    const child = parseBlock(lines, index + 1, next.indent, issues);
    return {value: child.value, index: child.index};
  }
  return {value: scalar(rest, issues, lines[index]!.line), index: index + 1};
}

function assignSequencePair(lines: YamlLine[], index: number, indent: number, parsedPair: YamlPair, item: YamlMap, issues: string[]): number {
  const next = lines[index];
  if (!parsedPair.value && next && next.indent > indent) {
    const child = parseBlock(lines, index, next.indent, issues);
    defineKey(item, parsedPair.key, child.value);
    return child.index;
  }
  defineKey(item, parsedPair.key, scalar(parsedPair.value, issues, lines[index - 1]!.line));
  return index;
}

function appendSequenceContinuation(lines: YamlLine[], index: number, indent: number, item: YamlMap, issues: string[]): number {
  const next = lines[index];
  if (!next || next.indent <= indent || isSequenceLine(next)) return index;
  const continuation = parseMap(lines, index, next.indent, issues);
  mergeMap(item, continuation.value);
  return continuation.index;
}

function parseSequenceItem(lines: YamlLine[], index: number, indent: number, issues: string[]): ParsedSequenceItem {
  const current = lines[index]!;
  const rest = sequenceRest(current);
  const parsedPair = pair(rest);
  if (!parsedPair) return parseBareSequenceItem(lines, index, indent, rest, issues);
  const item = yamlMap();
  const nextIndex = assignSequencePair(lines, index + 1, indent, parsedPair, item, issues);
  return {value: item, index: appendSequenceContinuation(lines, nextIndex, indent, item, issues)};
}

function parseSequence(lines: YamlLine[], start: number, indent: number, issues: string[]): ParsedBlock {
  const result: YamlValue[] = [];
  let index = start;
  while (index < lines.length && lines[index]!.indent === indent && isSequenceLine(lines[index]!)) {
    const item = parseSequenceItem(lines, index, indent, issues);
    result.push(item.value);
    index = item.index;
  }
  return {value: result, index};
}

export type YamlParseResult = {value: YamlMap; issues: string[]};

/**
 * Parse the deliberately bounded YAML subset used for read-only vault metadata.
 * The original source remains authoritative; callers must surface `issues` and
 * never serialize this result back over the frontmatter.
 */
export function parseYamlMapping(source: string): YamlParseResult {
  const issues: string[] = [];
  const lines = tokenize(source, issues);
  if (lines.length === 0) return {value: yamlMap(), issues};
  const parsed = parseBlock(lines, 0, lines[0]!.indent, issues);
  if (Array.isArray(parsed.value) || parsed.value === null || typeof parsed.value !== "object") {
    issues.push(`line ${lines[0]!.line}: YAML frontmatter must be a mapping`);
    return {value: yamlMap(), issues};
  }
  if (parsed.index < lines.length) issues.push(`line ${lines[parsed.index]!.line}: YAML content could not be represented`);
  return {value: parsed.value as YamlMap, issues};
}
