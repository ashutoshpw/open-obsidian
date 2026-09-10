import type {BaseValue} from "../shared/api.js";

export type BaseRow = {path: string; properties: Record<string, BaseValue>};
type BaseComparisonOperator = "equals" | "not-equals" | "contains" | "gt" | "gte" | "lt" | "lte";
const comparisonOperators = new Set<BaseComparisonOperator>(["equals", "not-equals", "contains", "gt", "gte", "lt", "lte"]);
export type BaseFilter =
  | {kind: "all" | "any"; filters: BaseFilter[]}
  | {kind: "comparison"; field: string; operator: BaseComparisonOperator; value: BaseValue};
export type BaseSort = {field: string; direction?: "asc" | "desc"};
export type BaseView = {
  type: "table" | "list" | "cards";
  name?: string;
  filter?: BaseFilter;
  sort?: BaseSort[];
  groupBy?: string;
  formulas?: Record<string, string>;
  [key: string]: unknown;
};
export type BaseDocument = {
  version: 1;
  views: BaseView[];
  [key: string]: unknown;
};
export type BaseIssue = {kind: "unsupported-formula" | "invalid-filter"; message: string; expression?: string};
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

function requireFilter(value: unknown): BaseFilter | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new Error("Bases filter must be an object");
  const parsed = compoundFilter(value) ?? comparisonFilter(value);
  if (!parsed) throw new Error("Bases filter is not supported by the version 1 grammar");
  return parsed;
}

function requireView(value: unknown): BaseView {
  if (!isObject(value) || !["table", "list", "cards"].includes(value.type as string)) throw new Error("Bases view must declare a supported type");
  const sort = Array.isArray(value.sort) ? value.sort.map((raw) => {
    if (!isObject(raw) || typeof raw.field !== "string") throw new Error("Bases sort entries must declare a field");
    const direction: BaseSort["direction"] = raw.direction === "desc" ? "desc" : "asc";
    return {field: raw.field, direction};
  }) : undefined;
  const formulas = isObject(value.formulas) ? Object.fromEntries(Object.entries(value.formulas).filter(([, expression]) => typeof expression === "string")) as Record<string, string> : undefined;
  return {...value, type: value.type as BaseView["type"], name: typeof value.name === "string" ? value.name : undefined, filter: requireFilter(value.filter), sort, groupBy: typeof value.groupBy === "string" ? value.groupBy : undefined, formulas};
}

export function parseBase(bytes: Uint8Array): BaseDocument {
  const value = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)) as unknown;
  if (!isObject(value) || (value.version !== 1 && value.schema_version !== 1) || !Array.isArray(value.views)) throw new Error("Bases document must declare version 1 and views");
  return {...value, version: 1, views: value.views.map(requireView)} as BaseDocument;
}

export function encodeBase(document: BaseDocument): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`);
}

function fieldValue(row: BaseRow, field: string): BaseValue | undefined {
  if (field === "file.path") return row.path;
  if (field === "file.name") return row.path.split("/").pop() ?? row.path;
  if (field === "file.ext") return row.path.includes(".") ? row.path.slice(row.path.lastIndexOf(".") + 1) : "";
  return row.properties[field];
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
      const order = compare(left.values[sort.field] ?? left.properties[sort.field], right.values[sort.field] ?? right.properties[sort.field]);
      if (order !== 0) return sort.direction === "desc" ? -order : order;
    }
    return left.path.localeCompare(right.path);
  });
}

export function evaluateBase(document: BaseDocument, viewName: string, sourceRows: BaseRow[]): BaseEvaluation {
  const view = document.views.find((candidate) => candidate.name === viewName) ?? document.views[0];
  if (!view) throw new Error("Bases document has no views");
  const issues: BaseIssue[] = [];
  const rows = sortRows(sourceRows.filter((row) => !view.filter || matchesFilter(view.filter, row)).map((row) => evaluateRow(row, view, issues)), view.sort);
  const groups: Record<string, EvaluatedBaseRow[]> = {};
  if (view.groupBy) rows.forEach((row) => {
    const key = String(row.values[view.groupBy!] ?? row.properties[view.groupBy!] ?? "");
    (groups[key] ??= []).push(row);
  });
  return {view, rows, groups, issues};
}
