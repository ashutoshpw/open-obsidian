import type {BaseComparisonOperator, BaseFilter, BaseIssue} from "./bases.js";
import {parseYamlMapping, type YamlValue} from "./yaml.js";

type YamlMap = {[key: string]: YamlValue};
type NativeFilterResult = {filter?: BaseFilter; supported: boolean};
type NativeFilterKind = "and" | "or" | "not";
export type NativeBaseParse = {root: YamlMap; views: unknown[]; issues: BaseIssue[]};

const operators: Record<string, BaseComparisonOperator> = {
  "=": "equals",
  "==": "equals",
  "!=": "not-equals",
  contains: "contains",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
};
const filterKinds = new Set<NativeFilterKind>(["and", "or", "not"]);

function isMap(value: YamlValue | undefined): value is YamlMap {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidFilter(message: string, issues: BaseIssue[]): NativeFilterResult {
  issues.push({kind: "invalid-filter", message});
  return {supported: false};
}

function quotedExpression(token: string): string | undefined {
  if (token.startsWith('"') && token.endsWith('"')) {
    try {
      const parsed = JSON.parse(token) as unknown;
      return typeof parsed === "string" ? parsed : token.slice(1, -1);
    } catch {
      return token.slice(1, -1);
    }
  }
  if (token.startsWith("'") && token.endsWith("'")) return token.slice(1, -1).replaceAll("''", "'");
  return undefined;
}

function booleanExpression(token: string): boolean | undefined {
  return /^(true|false)$/i.test(token) ? token.toLocaleLowerCase() === "true" : undefined;
}

function numberExpression(token: string): number | undefined {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(token) ? Number(token) : undefined;
}

function expressionValue(token: string): string | number | boolean | null {
  const trimmed = token.trim();
  const quoted = quotedExpression(trimmed);
  if (quoted !== undefined) return quoted;
  if (trimmed === "null" || trimmed === "~") return null;
  const boolean = booleanExpression(trimmed);
  if (boolean !== undefined) return boolean;
  const number = numberExpression(trimmed);
  if (number !== undefined) return number;
  return trimmed;
}

function comparison(expression: string, issues: BaseIssue[]): NativeFilterResult {
  const match = /^\s*([A-Za-z0-9_.-]+)\s*(==|!=|>=|<=|>|<|=|contains)\s*(.+?)\s*$/i.exec(expression);
  if (!match) return invalidFilter(`Native Bases filter is outside the supported comparison subset: ${expression}`, issues);
  const operator = operators[match[2]!.toLocaleLowerCase()];
  if (!operator) return invalidFilter(`Native Bases filter operator is not supported: ${match[2]}`, issues);
  return {supported: true, filter: {kind: "comparison", field: match[1]!, operator, value: expressionValue(match[3]!)}};
}

function filterMapEntry(value: YamlMap, issues: BaseIssue[]): [NativeFilterKind, YamlValue] | undefined {
  const entries = Object.entries(value);
  const kind = entries[0]?.[0];
  if (entries.length !== 1 || !kind || !filterKinds.has(kind as NativeFilterKind)) {
    invalidFilter("Native Bases filter maps must contain one of and, or or not", issues);
    return undefined;
  }
  return [kind as NativeFilterKind, entries[0]![1]];
}

function filterChildren(rawChildren: YamlValue, issues: BaseIssue[]): NativeFilterResult[] {
  const children = Array.isArray(rawChildren) ? rawChildren : [rawChildren];
  return children.map((child) => nativeFilter(child, issues));
}

function composeNativeFilter(kind: NativeFilterKind, parsedChildren: NativeFilterResult[], issues: BaseIssue[]): NativeFilterResult {
  if (parsedChildren.some((child) => !child.supported)) return {supported: false};
  const filters = parsedChildren.flatMap((child) => child.filter ? [child.filter] : []);
  if (!filters.length) return invalidFilter(`Native Bases ${kind} filters must contain at least one filter`, issues);
  if (kind === "not") return {supported: true, filter: {kind: "not", filter: {kind: "any", filters}}};
  return {supported: true, filter: {kind: kind === "and" ? "all" : "any", filters}};
}

function nativeFilterMap(value: YamlMap, issues: BaseIssue[]): NativeFilterResult {
  const entry = filterMapEntry(value, issues);
  if (!entry) return {supported: false};
  const [kind, rawChildren] = entry;
  return composeNativeFilter(kind, filterChildren(rawChildren, issues), issues);
}

function nativeFilter(value: YamlValue | undefined, issues: BaseIssue[]): NativeFilterResult {
  if (value === undefined) return {supported: true};
  if (typeof value === "string") return comparison(value, issues);
  if (isMap(value)) return nativeFilterMap(value, issues);
  return invalidFilter("Native Bases filters must be strings or and/or/not maps", issues);
}

function combineFilters(filters: Array<BaseFilter | undefined>): BaseFilter | undefined {
  const present = filters.filter((filter): filter is BaseFilter => filter !== undefined);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return {kind: "all", filters: present};
}

function formulas(value: YamlValue | undefined): Record<string, string> | undefined {
  if (!isMap(value)) return undefined;
  const entries = Object.entries(value).filter(([, expression]) => typeof expression === "string") as Array<[string, string]>;
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function groupBy(value: YamlValue | undefined): string | undefined {
  if (typeof value === "string") return value;
  return isMap(value) && typeof value.property === "string" ? value.property : undefined;
}

function order(value: YamlValue | undefined): Array<{field: string; direction: "asc" | "desc"}> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry) => typeof entry === "string" ? [{field: entry, direction: "asc" as const}] : []);
}

function mergeFormulas(base: Record<string, string> | undefined, view: Record<string, string> | undefined): Record<string, string> | undefined {
  const merged = {...base, ...view};
  return Object.keys(merged).length ? merged : undefined;
}

function nativeView(value: YamlValue, globalFilter: NativeFilterResult, baseFormulas: Record<string, string> | undefined, issues: BaseIssue[]): unknown {
  if (!isMap(value)) throw new Error("Native Bases views must be maps");
  if (typeof value.formula === "string") issues.push({kind: "invalid-source", message: "Native Bases formulas must be declared in a formulas map", expression: value.formula});
  const localFilter = nativeFilter(value.filters, issues);
  const filter = globalFilter.supported && localFilter.supported ? combineFilters([globalFilter.filter, localFilter.filter]) : undefined;
  const viewOrder = order(value.order) ?? order(value.sort);
  return {
    ...value,
    filter,
    sort: viewOrder,
    groupBy: groupBy(value.groupBy),
    formulas: mergeFormulas(baseFormulas, formulas(value.formulas)),
  };
}

export function parseNativeBase(source: string): NativeBaseParse {
  const parsed = parseYamlMapping(source);
  const issues: BaseIssue[] = parsed.issues.map((message) => ({kind: "invalid-source", message}));
  const globalFilter = nativeFilter(parsed.value.filters, issues);
  const baseFormulas = formulas(parsed.value.formulas);
  const views = Array.isArray(parsed.value.views) ? parsed.value.views.map((view) => nativeView(view, globalFilter, baseFormulas, issues)) : [];
  return {root: parsed.value, views, issues};
}
