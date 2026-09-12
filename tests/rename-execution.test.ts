import {afterEach, expect, test} from "bun:test";
import {mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync, existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {VaultSafetyError, VaultStore} from "../src/core/vault.js";

const temporaryRoots: string[] = [];

function fixture(options: ConstructorParameters<typeof VaultStore>[2] = {}): {root: string; appData: string; store: VaultStore} {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-rename-vault-"));
  const appData = mkdtempSync(join(tmpdir(), "openobsidian-rename-app-"));
  mkdirSync(join(root, "Archive"));
  temporaryRoots.push(root, appData);
  return {root, appData, store: new VaultStore(root, appData, options)};
}

afterEach(() => {
  temporaryRoots.splice(0).forEach((path) => rmSync(path, {recursive: true, force: true}));
});

test("rename plans move the source and update only resolved references", () => {
  const {root, appData, store} = fixture();
  const index = Buffer.from("\uFEFF[[Old|alias]] [Old](Old.md#section) ![[Old#block]] [[Other]]\r\n", "utf8");
  writeFileSync(join(root, "Index.md"), index);
  writeFileSync(join(root, "Old.md"), "# Old\n\nOpening paragraph ^block\n\n[[Old]]\n");
  writeFileSync(join(root, "Other.md"), "# Other\n");

  const plan = store.buildRenamePlan("Old.md", "Archive/New.md");
  expect(plan.planId).toMatch(/^[a-f0-9]{64}$/);
  expect(plan.updateCount).toBe(4);
  expect(plan.skippedCount).toBe(0);

  const result = store.applyRenamePlan(plan);
  expect(result.newPath).toBe("Archive/New.md");
  expect(result.updatedReferences).toBe(4);
  expect(existsSync(join(root, "Old.md"))).toBe(false);
  expect(readFileSync(join(root, "Archive", "New.md"), "utf8")).toContain("[[Archive/New]]");
  expect(readFileSync(join(root, "Index.md"))).toEqual(Buffer.from("\uFEFF[[Archive/New|alias]] [Old](Archive/New.md#section) ![[Archive/New#block]] [[Other]]\r\n", "utf8"));
  expect(readFileSync(join(root, "Other.md"), "utf8")).toBe("# Other\n");
  expect(readFileSync(join(appData, "journal.jsonl"), "utf8")).toContain('"operation":"rename"');
});

test("rename keeps relative Markdown links relative to their source note", () => {
  const {root, store} = fixture();
  mkdirSync(join(root, "Notes"));
  writeFileSync(join(root, "Notes", "Index.md"), "[Old](Old.md#details)\n");
  writeFileSync(join(root, "Notes", "Old.md"), "# Old\n\n## Details\n");
  const plan = store.buildRenamePlan("Notes/Old.md", "Archive/New.md");
  expect(plan.updateCount).toBe(1);
  expect(plan.references[0]?.replacement).toBe("../Archive/New.md");
  store.applyRenamePlan(plan);
  expect(readFileSync(join(root, "Notes", "Index.md"), "utf8")).toBe("[Old](../Archive/New.md#details)\n");
});

test("rename application fails closed when the preview snapshot is stale", () => {
  const {root, store} = fixture();
  writeFileSync(join(root, "Index.md"), "[[Old]]\n");
  writeFileSync(join(root, "Old.md"), "# Old\n");
  const plan = store.buildRenamePlan("Old.md", "Archive/New.md");
  writeFileSync(join(root, "Index.md"), "external edit\n");

  expect(() => store.applyRenamePlan(plan)).toThrow("Rename plan is stale");
  expect(existsSync(join(root, "Old.md"))).toBe(true);
  expect(readFileSync(join(root, "Index.md"), "utf8")).toBe("external edit\n");
});

test("rename rolls back the filesystem move and earlier link writes after a later write failure", () => {
  const {root, store} = fixture({faultHook: (stage, relativePath) => {
    if (stage === "before-replace" && relativePath === "B.md") throw new Error("injected rename write failure");
  }});
  writeFileSync(join(root, "A.md"), "[[Old]]\n");
  writeFileSync(join(root, "B.md"), "[[Old]]\n");
  writeFileSync(join(root, "Old.md"), "# Old\n");
  const plan = store.buildRenamePlan("Old.md", "Archive/New.md");

  expect(() => store.applyRenamePlan(plan)).toThrow("injected rename write failure");
  expect(existsSync(join(root, "Old.md"))).toBe(true);
  expect(existsSync(join(root, "Archive", "New.md"))).toBe(false);
  expect(readFileSync(join(root, "A.md"), "utf8")).toBe("[[Old]]\n");
  expect(readFileSync(join(root, "B.md"), "utf8")).toBe("[[Old]]\n");
});

test("rename rejects symlink sources, existing destinations and unsafe paths", () => {
  const {root, store} = fixture();
  writeFileSync(join(root, "Old.md"), "# Old\n");
  writeFileSync(join(root, "Archive", "New.md"), "existing\n");
  expect(() => store.buildRenamePlan("Old.md", "Archive/New.md")).toThrow("destination already exists");
  expect(() => store.buildRenamePlan("../Old.md", "Archive/Other.md")).toThrow(VaultSafetyError);

  const outside = join(root, "outside.md");
  writeFileSync(outside, "outside\n");
  symlinkSync(outside, join(root, "Linked.md"));
  expect(() => store.buildRenamePlan("Linked.md", "Archive/Linked.md")).toThrow("symlink");
});
