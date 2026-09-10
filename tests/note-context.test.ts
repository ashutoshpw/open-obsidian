import {afterEach, expect, test} from "bun:test";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildNoteContext} from "../src/core/note-context.js";
import {VaultStore} from "../src/core/vault.js";

const roots: string[] = [];

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, {recursive: true, force: true})));

test("note context exposes outline headings and resolved backlinks without vault writes", () => {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-note-context-"));
  const appData = mkdtempSync(join(tmpdir(), "openobsidian-note-context-app-"));
  roots.push(root, appData);
  writeFileSync(join(root, "one.md"), "# One\n\n## Details\n");
  writeFileSync(join(root, "two.md"), "See [[one]] for the details.\n");

  const context = buildNoteContext(new VaultStore(root, appData), "one.md");

  expect(context.headings).toEqual([{text: "One", level: 1, line: 1}, {text: "Details", level: 2, line: 3}]);
  expect(context.backlinks).toEqual([{relativePath: "two.md", line: 1, text: "See [[one]] for the details."}]);
});
