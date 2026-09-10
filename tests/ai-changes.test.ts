import {expect, test} from "bun:test";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {AIChangeError, applyAIChangeSet, draftLocalAIChange, organizationSuggestions, undoAIChange} from "../src/core/ai-changes.js";
import {VaultStore} from "../src/core/vault.js";

function fixture(): {root: string; appData: string; store: VaultStore} {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-ai-change-vault-"));
  const appData = mkdtempSync(join(tmpdir(), "openobsidian-ai-change-app-"));
  return {root, appData, store: new VaultStore(root, appData)};
}

test("local AI drafts are preview-only, preserve source encoding and undo through recovery", () => {
  const {root, appData, store} = fixture();
  try {
    const original = Buffer.from("# Note\r\nOriginal source.\r\n", "utf8");
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), original]);
    writeFileSync(join(root, "note.md"), withBom);
    const current = store.read("note.md");
    const draft = draftLocalAIChange(store, {relativePath: "note.md", expectedRevision: current.revision, instruction: "replace: Original source. => Revised source."});
    const file = draft.files[0]!;
    expect(draft.provider).toBe("none");
    expect(draft.safety.previewRequired).toBe(true);
    expect(file.hunks[0]?.status).toBe("pending");
    expect(readFileSync(join(root, "note.md"))).toEqual(withBom);

    const applied = applyAIChangeSet(store, draft, {changeSetId: draft.id, selections: [{fileId: file.id, hunkIds: file.hunks.map((hunk) => hunk.id)}]});
    const changed = store.read("note.md");
    expect(Buffer.from(changed.bytes).toString("utf8")).toContain("Revised source.");
    expect(changed.bytes[0]).toBe(0xef);
    expect(store.listRecovery("note.md").length).toBeGreaterThan(0);

    const undone = undoAIChange(store, applied);
    expect(undone.files[0]?.revision).toBe(current.revision);
    expect(readFileSync(join(root, "note.md"))).toEqual(withBom);
  } finally {
    rmSync(root, {recursive: true, force: true});
    rmSync(appData, {recursive: true, force: true});
  }
});

test("AI approval preflights every revision and rejects stale or unapproved writes", () => {
  const {root, appData, store} = fixture();
  try {
    writeFileSync(join(root, "note.md"), "Original\n");
    const draft = draftLocalAIChange(store, {relativePath: "note.md", instruction: "append: Drafted\n"});
    const file = draft.files[0]!;
    expect(() => applyAIChangeSet(store, draft, {changeSetId: draft.id, selections: []})).toThrow(AIChangeError);
    const current = store.read("note.md");
    store.write({relativePath: "note.md", expectedRevision: current.revision, bytes: new TextEncoder().encode("External edit\n")});
    expect(() => applyAIChangeSet(store, draft, {changeSetId: draft.id, selections: [{fileId: file.id, hunkIds: file.hunks.map((hunk) => hunk.id)}]})).toThrow("no AI changes were applied");
    expect(Buffer.from(store.read("note.md").bytes).toString("utf8")).toBe("External edit\n");
  } finally {
    rmSync(root, {recursive: true, force: true});
    rmSync(appData, {recursive: true, force: true});
  }
});

test("organization suggestions stay scoped and deny formula or code execution", () => {
  const {root, appData, store} = fixture();
  try {
    writeFileSync(join(root, "one.md"), "[[missing-note]]\n");
    writeFileSync(join(root, "copy.md"), "[[missing-note]]\n");
    writeFileSync(join(root, "two.md"), "[[missing-note]]\n");
    writeFileSync(join(root, "board.canvas"), JSON.stringify({nodes: [{id: "text-1", type: "text", text: "Canvas note"}], edges: [], unknownRoot: {keep: true}}));
    writeFileSync(join(root, "table.base"), JSON.stringify({version: 1, views: [{type: "table", name: "Open"}]}));
    writeFileSync(join(root, "view.base"), "views:\n  - type: table\n    formula: exec('not allowed')\n");
    const result = organizationSuggestions(store, {excludedPaths: ["two.md"]});
    expect(result.provider).toBe("none");
    expect(result.scope.excludedPaths).toContain(".git");
    expect(result.safety.shell).toBe(false);
    expect(result.safety.network).toBe(false);
    expect(result.suggestions.every((item) => item.relativePath !== "two.md")).toBe(true);
    expect(result.suggestions.some((item) => item.kind === "link" && item.status === "awaiting-approval")).toBe(true);
    expect(result.suggestions.some((item) => item.kind === "duplicate")).toBe(true);
    expect(result.suggestions.some((item) => item.kind === "rename")).toBe(true);
    expect(result.suggestions.some((item) => item.kind === "canvas" && item.relativePath === "board.canvas")).toBe(true);
    expect(result.suggestions.some((item) => item.kind === "base" && item.relativePath === "table.base")).toBe(true);
    expect(result.suggestions.some((item) => item.kind === "formula-code" && item.status === "denied-security")).toBe(true);
    expect(result.warnings[0]).toContain("suggestions only");
  } finally {
    rmSync(root, {recursive: true, force: true});
    rmSync(appData, {recursive: true, force: true});
  }
});
