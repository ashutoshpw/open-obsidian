import {expect, test} from "bun:test";
import {encodeBase, evaluateBase, parseBase} from "../src/core/bases.js";
import {parseEmbeddedBases} from "../src/core/embedded-base.js";

const fixture = await Bun.file(new URL("../fixtures/derived-surfaces.json", import.meta.url)).json() as {schema_version: number; bases: {view_types: string[]; preserve: string[]}; invariants: Record<string, boolean>};
const nativeFixture = await Bun.file(new URL("../fixtures/bases-native.yaml", import.meta.url)).text();

test("Bases preserves unknown definitions and evaluates a safe table view", () => {
  const source = {
    version: 1,
    views: [{type: "table", name: "Open", filter: {kind: "comparison", field: "status", operator: "equals", value: "open"}, sort: [{field: "priority", direction: "desc"}], groupBy: "owner", formulas: {pathLabel: "file.path"}, unknownView: {keep: true}}, {type: "list", name: "List", properties: ["status", "priority"]}, {type: "cards", name: "Cards", cardSize: "medium"}],
    unknownRoot: {keep: true},
  };
  const document = parseBase(new TextEncoder().encode(JSON.stringify(source)));
  expect(fixture.schema_version).toBe(1);
  expect(fixture.bases.view_types).toEqual(["table", "list", "cards"]);
  expect(fixture.bases.preserve).toContain("unknown-fields");
  expect(Object.values(fixture.invariants).every(Boolean)).toBe(true);
  const result = evaluateBase(document, "Open", [
    {path: "a.md", properties: {status: "open", priority: 1, owner: "A", metadata: {labels: ["one"]}}},
    {path: "b.md", properties: {status: "open", priority: 2, owner: "B"}},
    {path: "c.md", properties: {status: "done", priority: 3, owner: "A"}},
  ]);

  expect(result.rows.map((row) => row.path)).toEqual(["b.md", "a.md"]);
  expect(result.rows[0]?.values.pathLabel).toBe("b.md");
  expect(result.groups.A).toHaveLength(1);
  expect(result.rows.find((row) => row.path === "a.md")?.properties.metadata).toEqual({labels: ["one"]});
  expect(parseBase(encodeBase(document)).unknownRoot).toEqual({keep: true});
  expect((parseBase(encodeBase(document)).views[0] as Record<string, unknown>).unknownView).toEqual({keep: true});
  expect(parseBase(encodeBase(document)).views.map((view) => view.type)).toEqual(["table", "list", "cards"]);
});

test("unsupported Bases formulas are visible and never evaluated", () => {
  const document = parseBase(new TextEncoder().encode(JSON.stringify({version: 1, views: [{type: "list", formulas: {bad: "date(today)"}}]})));
  const result = evaluateBase(document, "missing", [{path: "note.md", properties: {}}]);

  expect(result.rows[0]?.values.bad).toBeUndefined();
  expect(result.issues).toEqual([{kind: "unsupported-formula", message: "Unsupported Bases formula: date(today)", expression: "date(today)"}]);
});

test("Bases preserves nested values in supported filter definitions", () => {
  const document = parseBase(new TextEncoder().encode(JSON.stringify({version: 1, views: [{type: "table", filter: {kind: "comparison", field: "metadata", operator: "equals", value: {labels: ["one"]}}}]})));

  expect((document.views[0]?.filter as {value: unknown}).value).toEqual({labels: ["one"]});
});

test("Bases reads the native YAML view shape without rewriting its source", () => {
  const document = parseBase(new TextEncoder().encode(nativeFixture));
  const result = evaluateBase(document, "Open items", [
    {path: "a.md", properties: {status: "open", priority: 1, owner: "A"}},
    {path: "b.md", properties: {status: "open", priority: 2, owner: "B"}},
    {path: "c.md", properties: {status: "done", priority: 3, owner: "A"}},
  ]);

  expect(document.sourceFormat).toBe("yaml");
  expect(result.rows.map((row) => row.path)).toEqual(["b.md"]);
  expect(result.rows[0]?.values.pathLabel).toBe("b.md");
  expect(result.view.groupBy).toBe("owner");
  expect(result.view.sort).toEqual([{field: "priority", direction: "asc"}]);
  expect(result.issues).toEqual([]);
  expect(new TextDecoder().decode(encodeBase(document))).toBe(nativeFixture);
  expect((document.properties as {status: {displayName: string}}).status.displayName).toBe("Status");
});

test("unsupported native Bases expressions remain visible and are not partially applied", () => {
  const source = ["filters: file.hasTag(\"open\")", "views:", "  - type: list", "    name: Notes"].join("\n") + "\n";
  const result = evaluateBase(parseBase(new TextEncoder().encode(source)), "Notes", [{path: "note.md", properties: {status: "open"}}]);

  expect(result.rows).toHaveLength(1);
  expect(result.issues).toEqual([{kind: "invalid-filter", message: 'Native Bases filter is outside the supported comparison subset: file.hasTag("open")'}]);
});

test("embedded Base definitions retain spans, source and compatibility issues", () => {
  const source = "# Notes\n\n```base\nviews:\n  - type: list\n    name: Notes\n```\n\n~~~base\nfilters: file.hasTag(\"open\")\nviews:\n  - type: table\n~~~\n";
  const definitions = parseEmbeddedBases(source);

  expect(definitions).toHaveLength(2);
  expect(definitions[0]?.document?.views[0]?.name).toBe("Notes");
  expect(definitions[0]?.issues).toEqual([]);
  expect(definitions[0] ? source.slice(definitions[0].start, definitions[0].end) : "").toBe("views:\n  - type: list\n    name: Notes\n");
  expect(definitions[1]?.document?.views[0]?.type).toBe("table");
  expect(definitions[1]?.issues).toEqual([{kind: "invalid-filter", message: 'Native Bases filter is outside the supported comparison subset: file.hasTag("open")'}]);
});

test("unclosed embedded Base definitions are visible without evaluation", () => {
  const [definition] = parseEmbeddedBases("~~~base\nviews:\n  - type: list\n");

  expect(definition?.document).toBeUndefined();
  expect(definition?.issues).toEqual([{kind: "invalid-source", message: "Embedded base fence is not closed"}]);
});
