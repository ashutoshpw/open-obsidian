import {expect, test} from "bun:test";
import {encodeBase, evaluateBase, parseBase} from "../src/core/bases.js";

test("Bases preserves unknown definitions and evaluates a safe table view", () => {
  const source = {
    version: 1,
    views: [{type: "table", name: "Open", filter: {kind: "comparison", field: "status", operator: "equals", value: "open"}, sort: [{field: "priority", direction: "desc"}], groupBy: "owner", formulas: {pathLabel: "file.path"}, unknownView: {keep: true}}],
    unknownRoot: {keep: true},
  };
  const document = parseBase(new TextEncoder().encode(JSON.stringify(source)));
  const result = evaluateBase(document, "Open", [
    {path: "a.md", properties: {status: "open", priority: 1, owner: "A"}},
    {path: "b.md", properties: {status: "open", priority: 2, owner: "B"}},
    {path: "c.md", properties: {status: "done", priority: 3, owner: "A"}},
  ]);

  expect(result.rows.map((row) => row.path)).toEqual(["b.md", "a.md"]);
  expect(result.rows[0]?.values.pathLabel).toBe("b.md");
  expect(result.groups.A).toHaveLength(1);
  expect(parseBase(encodeBase(document)).unknownRoot).toEqual({keep: true});
  expect((parseBase(encodeBase(document)).views[0] as Record<string, unknown>).unknownView).toEqual({keep: true});
});

test("unsupported Bases formulas are visible and never evaluated", () => {
  const document = parseBase(new TextEncoder().encode(JSON.stringify({version: 1, views: [{type: "list", formulas: {bad: "date(today)"}}]})));
  const result = evaluateBase(document, "missing", [{path: "note.md", properties: {}}]);

  expect(result.rows[0]?.values.bad).toBeUndefined();
  expect(result.issues).toEqual([{kind: "unsupported-formula", message: "Unsupported Bases formula: date(today)", expression: "date(today)"}]);
});
