import {expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {applyRenamePlan, buildRenamePlan} from "../src/core/rename-plan.js";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/rename-plan.json", import.meta.url), "utf8")) as {schema_version: number; actions: string[]; invariants: Record<string, boolean>};

test("rename plans use resolved references and preserve aliases or subpaths", () => {
  const files = [
    {relativePath: "Index.md", text: "[[Old|alias]] [Old](Old.md#section) ![[Old#block]] [[Other]]"},
    {relativePath: "Old.md", text: "# Old"},
  ];
  const plan = buildRenamePlan(files, "Old.md", "Archive/New.md");
  expect(fixture.schema_version).toBe(1);
  expect(fixture.actions).toEqual(["update", "skip-ambiguous", "skip-unresolved"]);
  expect(Object.values(fixture.invariants).every(Boolean)).toBe(true);
  expect(plan.updateCount).toBe(3);
  expect(plan.skippedCount).toBe(0);
  expect(applyRenamePlan(files[0]!.text, "Index.md", plan)).toBe("[[Archive/New|alias]] [Old](Archive/New.md#section) ![[Archive/New#block]] [[Other]]");
});

test("rename plans leave ambiguous, unresolved and unrelated references untouched", () => {
  const plan = buildRenamePlan([
    {relativePath: "Index.md", text: "[[Old]] [[Missing]] [[Other]]"},
    {relativePath: "Folder/Old.md", text: "# one"},
    {relativePath: "Other/Old.md", text: "# two"},
  ], "Folder/Old.md", "Archive/Old.md");
  expect(plan.references.map((reference) => reference.action)).toEqual(["skip-ambiguous"]);
  expect(plan.warnings).toEqual(["Ambiguous links are shown but not rewritten."]);
  expect(applyRenamePlan("[[Old]] [[Missing]] [[Other]]", "Index.md", plan)).toBe("[[Old]] [[Missing]] [[Other]]");
});
