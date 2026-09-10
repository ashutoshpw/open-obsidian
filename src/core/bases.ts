import type {BaseValue} from "../shared/api.js";
import {parseNativeBase} from "./bases-native.js";

export type BaseRow = {path: string; properties: Record<string, BaseValue>};
export type BaseComparisonOperator = "equals" | "not-equals" | "contains" | "gt" | "gte" | "lt" | "lte";
const comparisonOperators = new Set<BaseComparisonOperator>(["equals", "not-equals", "contains", "gt", "gte", "lt", "lte"]);
export type BaseFilter =
  | {kind: "all" | "any"; filters: BaseFilter[]}
  | {kind: "not"; filter: BaseFilter}
  | {kind: "comparison"; field: string; operator: BaseComparisonOperator; value: BaseValue};
export type BaseSort = {field: string; direction?: "asc" | "desc"};
export type BaseView = {
  type: "table" | "list" | "cards";
  name?: string;
  filter?: BaseFilter;
  sort?: BaseSort[];
  groupBy?: string;
  limit?: number;
  formulas?: Record<string, string>;
  [key: string]: unknown;
};
export type BaseDocument = {
  version: 1;
  views: BaseView[];
  issues?: BaseIssue[];
  sourceFormat?: "json" | "yaml";
  sourceText?: string;
  [key: string]: unknown;
};
export type BaseIssue = {kind: "unsupported-formula" | "invalid-filter" | "invalid-source"; message: string; expression?: string};
export type EvaluatedBaseRow = BaseRow & {values: Record<string, BaseValue>};
export type BaseEvaluation = {view: BaseView; rows: EvaluatedBaseRow[]; groups: Record<string, EvaluatedBaseRow[]>; issues: BaseIssue[]};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireValue(value: unknown): BaseValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(requireValue);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, requireValue(nested)]));
  throw new Error("Bases values must be JSON scalars, arrays or maps");
}

function compoundFilter(value: Record<string, unknown>): BaseFilter | undefined {
  if ((value.kind !== "all" && value.kind !== "any") || !Array.isArray(value.filters)) return undefined;
  return {kind: value.kind, filters: value.filters.map(requireFilter).filter((filter): filter is BaseFilter => filter !== undefined)};
}

function comparisonFilter(value: Record<string, unknown>): BaseFilter | undefined {
  if (value.kind !== "comparison" || typeof value.field !== "string" || typeof value.operator !== "string" || !comparisonOperators.has(value.operator as BaseComparisonOperator)) return undefined;
  return {kind: "comparison", field: value.field, operator: value.operator as BaseComparisonOperator, value: requireValue(value.value)};
}

function requireSortEntry(value: unknown): BaseSort {
  if (!isObject(value) || typeof value.field !== "string") throw new Error("Bases sort entries must declare a field");
  return {field: value.field, direction: value.direction === "desc" ? "desc" : "asc"};
}

function requireSort(value: unknown): BaseSort[] | undefined {
  return Array.isArray(value) ? value.map(requireSortEntry) : undefined;
}

function requireFormulas(value: unknown): Record<string, string> | undefined {
  return isObject(value) ? Object.fromEntries(Object.entries(value).filter(([, expression]) => typeof expression === "string")) as Record<string, string> : undefined;
}

function requireViewType(value: unknown): BaseView["type"] {
  if (!isObject(value) || !["table", "list", "cards"].includes(value.type as string)) throw new Error("Bases view must declare a supported type");
  return value.type as BaseView["type"];
}

function requireFilter(value: unknown): BaseFilter | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new Error("Bases filter must be an object");
  if (value.kind === "not") {
    if (!("filter" in value)) throw new Error("Bases not filters must declare a filter");
    const filter = requireFilter(value.filter);
    if (!filter) throw new Error("Bases not filters must declare a filter");
    return {kind: "not", filter};
  }
  const parsed = compoundFilter(value) ?? comparisonFilter(value);
  if (!parsed) throw new Error("Bases filter is not supported by the version 1 grammar");
  return parsed;
}

function requireView(value: unknown): BaseView {
  const type = requireViewType(value);
  if (!isObject(value)) throw new Error("Bases view must declare a supported type");
  const sort = requireSort(value.sort);
  const formulas = requireFormulas(value.formulas);
  const limit = typeof value.limit === "number" && Number.isInteger(value.limit) && value.limit >= 0 ? value.limit : undefined;
  return {...value, type, name: typeof value.name === "string" ? value.name : undefined, filter: requireFilter(value.filter), sort, groupBy: typeof value.groupBy === "string" ? value.groupBy : undefined, limit, formulas};
}

export function parseBase(bytes: Uint8Array): BaseDocument {
  const source = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
  try {
    const value = JSON.parse(source) as unknown;
    if (!isObject(value) || (value.version !== 1 && value.schema_version !== 1) || !Array.isArray(value.views)) throw new Error("Bases document must declare version 1 and views");
    return {...value, version: 1, views: value.views.map(requireView)} as BaseDocument;
  } catch (error) {
    if (error instanceof SyntaxError) {
      const native = parseNativeBase(source);
      if (!Array.isArray(native.root.views)) throw new Error("Bases document must declare version 1 and views");
      return {...native.root, version: 1, views: native.views.map(requireView), issues: native.issues.length ? native.issues : undefined, sourceFormat: "yaml", sourceText: source} as BaseDocument;
    }
    throw error;
  }
}

export function encodeBase(document: BaseDocument): Uint8Array {
  if (document.sourceFormat === "yaml" && typeof document.sourceText === "string") return new TextEncoder().encode(document.sourceText);
  return new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`);
}

function normalizeField(field: string): string {
  return field.startsWith("note.") ? field.slice("note.".length) : field;
}

function fieldValue(row: BaseRow, field: string): BaseValue | undefined {
  const normalizedField = normalizeField(field);
  if (normalizedField === "file.path") return row.path;
  if (normalizedField === "file.name") return row.path.split("/").pop() ?? row.path;
  if (normalizedField === "file.ext") return row.path.includes(".") ? row.path.slice(row.path.lastIndexOf(".") + 1) : "";
  return row.properties[normalizedField];
}

function compare(left: BaseValue | undefined, right: BaseValue | undefined): number {
  if (left === right) return 0;
  if (left === undefined || left === null) return -1;
  if (right === undefined || right === null) return 1;
  return String(left).localeCompare(String(right), undefined, {numeric: true, sensitivity: "base"});
}

function matchesComparison(filter: Extract<BaseFilter, {kind: "comparison"}>, row: BaseRow): boolean {
  const actual = fieldValue(row, filter.field);
  if (filter.operator === "contains") return Array.isArray(actual) ? actual.includes(filter.value) : String(actual ?? "").toLocaleLowerCase().includes(String(filter.value).toLocaleLowerCase());
  const order = compare(actual, filter.value);
  if (filter.operator === "equals") return order === 0;
  if (filter.operator === "not-equals") return order !== 0;
  if (filter.operator === "gt") return order > 0;
  if (filter.operator === "gte") return order >= 0;
  if (filter.operator === "lt") return order < 0;
  return order <= 0;
}

function matchesFilter(filter: BaseFilter, row: BaseRow): boolean {
  if (filter.kind === "comparison") return matchesComparison(filter, row);
  if (filter.kind === "not") return !matchesFilter(filter.filter, row);
  const results = filter.filters.map((child) => matchesFilter(child, row));
  return filter.kind === "all" ? results.every(Boolean) : results.some(Boolean);
}

function formulaValue(expression: string, row: BaseRow): BaseValue {
  const trimmed = expression.trim();
  const field = fieldValue(row, trimmed);
  if (field !== undefined) return field;
  if (/^(true|false)$/.test(trimmed)) return trimmed === "true";
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  throw new Error(`Unsupported Bases formula: ${expression}`);
}

function evaluateRow(row: BaseRow, view: BaseView, issues: BaseIssue[]): EvaluatedBaseRow {
  const values: Record<string, BaseValue> = {...row.properties, "file.path": row.path, "file.name": row.path.split("/").pop() ?? row.path};
  for (const [name, expression] of Object.entries(view.formulas ?? {})) {
    try {
      values[name] = formulaValue(expression, row);
    } catch (error) {
      issues.push({kind: "unsupported-formula", message: error instanceof Error ? error.message : String(error), expression});
    }
  }
  return {...row, values};
}

function sortRows(rows: EvaluatedBaseRow[], sorts: BaseSort[] | undefined): EvaluatedBaseRow[] {
  if (!sorts?.length) return rows;
  return [...rows].sort((left, right) => {
    for (const sort of sorts) {
      const field = normalizeField(sort.field);
      const order = compare(left.values[field] ?? left.properties[field], right.values[field] ?? right.properties[field]);
      if (order !== 0) return sort.direction === "desc" ? -order : order;
    }
    return left.path.localeCompare(right.path);
  });
}

export function evaluateBase(document: BaseDocument, viewName: string, sourceRows: BaseRow[]): BaseEvaluation {
  const view = document.views.find((candidate) => candidate.name === viewName) ?? document.views[0];
  if (!view) throw new Error("Bases document has no views");
  const issues: BaseIssue[] = [...(document.issues ?? [])];
  const sortedRows = sortRows(sourceRows.filter((row) => !view.filter || matchesFilter(view.filter, row)).map((row) => evaluateRow(row, view, issues)), view.sort);
  const rows = typeof view.limit === "number" ? sortedRows.slice(0, view.limit) : sortedRows;
  const groups: Record<string, EvaluatedBaseRow[]> = {};
  if (view.groupBy) rows.forEach((row) => {
    const field = normalizeField(view.groupBy!);
    const key = String(row.values[field] ?? row.properties[field] ?? "");
    (groups[key] ??= []).push(row);
  });
  return {view, rows, groups, issues};
}
