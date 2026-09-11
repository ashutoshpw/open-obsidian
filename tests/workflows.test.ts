import {expect, test} from "bun:test";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildBookmarkIndex, buildTagIndex, buildTaskIndex, toggleVaultTask} from "../src/core/workflows.js";
import {annotateBookmarks, buildTagSummaries, extractMarkdownTags, extractMarkdownTasks, parseBookmarkConfiguration, toggleMarkdownTaskSource} from "../src/shared/ui/index.js";
import {snapshotVault, VaultStore} from "../src/core/vault.js";

test("bookmark parsing keeps groups and marks missing targets without inferring new data", () => {
  const parsed = parseBookmarkConfiguration({items: [
    {type: "file", path: "one.md"},
    {type: "search", title: "Open notes", query: "status:open"},
    {type: "group", title: "Work", items: [{type: "block", path: "one.md", subpath: "#Plan"}, {type: "file", path: "missing.md"}]},
  ]});
  const annotated = annotateBookmarks(parsed.items, ["one.md"]);

  expect(parsed.issues).toEqual([]);
  expect(annotated.map((item) => item.kind)).toEqual(["file", "search", "group"]);
  expect(annotated[1]).toMatchObject({title: "Open notes", query: "status:open", available: true});
  expect(annotated[2]?.items?.[1]).toMatchObject({path: "missing.md", available: false});
});

test("tag extraction skips fenced source and builds deterministic file summaries", () => {
  const source = "---\ntags: [Project, \"#Work\"]\n---\n# Heading\nBody #Project and #work/sub. `#ignored`\n```js\n#fenced\n```\n";
  const occurrences = extractMarkdownTags(source);
  const summaries = buildTagSummaries([{relativePath: "note.md", occurrences}]);

  expect(occurrences.map((occurrence) => [occurrence.tag, occurrence.source, occurrence.line])).toEqual([
    ["project", "frontmatter", 2],
    ["work", "frontmatter", 2],
    ["project", "inline", 5],
    ["work/sub", "inline", 5],
  ]);
  expect(summaries).toEqual([
    {tag: "project", count: 2, files: [{relativePath: "note.md", count: 2, lines: [2, 5]}]},
    {tag: "work", count: 1, files: [{relativePath: "note.md", count: 1, lines: [2]}]},
    {tag: "work/sub", count: 1, files: [{relativePath: "note.md", count: 1, lines: [5]}]},
  ]);
});

test("task extraction and toggle preserve line endings and recurrence text", () => {
  const source = "# Plan\r\n- [ ] Follow up 🔁 every week\r\n- [x] Done\r\n";
  const tasks = extractMarkdownTasks(source, "plan.md");
  const toggled = toggleMarkdownTaskSource(source, 2, true);

  expect(tasks).toEqual([
    {id: "plan.md#L2", relativePath: "plan.md", line: 2, checked: false, text: "Follow up 🔁 every week", recurrence: "🔁 every week"},
    {id: "plan.md#L3", relativePath: "plan.md", line: 3, checked: true, text: "Done"},
  ]);
  expect(toggled).toBe("# Plan\r\n- [x] Follow up 🔁 every week\r\n- [x] Done\r\n");
});

test("vault workflow indexes are read-only and task toggles use a revision check", () => {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-workflows-vault-"));
  const appData = mkdtempSync(join(tmpdir(), "openobsidian-workflows-app-"));
  try {
    mkdirSync(join(root, ".obsidian"));
    writeFileSync(join(root, ".obsidian", "bookmarks.json"), JSON.stringify({items: [{type: "file", path: "plan.md"}, {type: "file", path: "missing.md"}]}, null, 2));
    writeFileSync(join(root, "plan.md"), "---\ntags: [work]\n---\n- [ ] Follow up 🔁 every week\n");
    writeFileSync(join(root, "other.md"), "#work\n");
    const store = new VaultStore(root, appData);
    const before = snapshotVault(root);
    const bookmarks = buildBookmarkIndex(store);
    const tags = buildTagIndex(store);
    const tasks = buildTaskIndex(store);

    expect(bookmarks.source).toBe("obsidian-bookmarks");
    expect(bookmarks.items[0]).toMatchObject({kind: "file", path: "plan.md", available: true});
    expect(bookmarks.items[1]).toMatchObject({path: "missing.md", available: false});
    expect(bookmarks.issues).toContain("Bookmark target is not present in the selected vault: missing.md");
    expect(tags.tags.map((tag) => tag.tag)).toEqual(["work"]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({relativePath: "plan.md", line: 4, checked: false});
    expect(snapshotVault(root).sha256).toBe(before.sha256);

    const updated = toggleVaultTask(store, "plan.md", tasks[0]!.revision!, tasks[0]!.line, true);
    expect(updated.revision).not.toBe(tasks[0]!.revision);
    expect(readFileSync(join(root, "plan.md"), "utf8")).toContain("- [x] Follow up 🔁 every week");
    expect(readFileSync(join(root, "plan.md"), "utf8")).toContain("tags: [work]");
  } finally {
    rmSync(root, {recursive: true, force: true});
    rmSync(appData, {recursive: true, force: true});
  }
});
