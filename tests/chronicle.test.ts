import {afterEach, expect, test} from "bun:test";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {addChronicleRemote, adoptChronicle, chronicleDiff, chronicleHistory, commitChronicleSelection, initializeChronicle, inspectVaultGitState, pullChronicle, pushChronicle, restoreChronicleFile, reviewChronicleCommit} from "../src/core/chronicle.js";
import {historyRecordsFromStore, planHistoryRetention} from "../src/core/history.js";
import {VaultStore} from "../src/core/vault.js";

const roots: string[] = [];

function git(root: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", root, ...args]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-chronicle-"));
  roots.push(root);
  return root;
}

function configureGit(root: string): void {
  git(root, "config", "user.name", "OpenObsidian Test");
  git(root, "config", "user.email", "test@openobsidian.invalid");
}

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, {recursive: true, force: true})));

test("Standard vaults remain read-only until Chronicle initialization is explicit", () => {
  const root = createRoot();
  writeFileSync(join(root, "note.md"), "standard\n");

  expect(inspectVaultGitState(root).vaultType).toBe("standard");
  expect(existsSync(join(root, ".git"))).toBe(false);
  const state = initializeChronicle(root);
  expect(state.vaultType).toBe("chronicle");
  expect(state.unborn).toBe(true);
  expect(existsSync(join(root, ".git"))).toBe(true);
});

test("Chronicle selection commits only approved paths and preserves unrelated staged work", () => {
  const root = createRoot();
  const appData = join(root, ".openobsidian-data");
  initializeChronicle(root);
  expect(adoptChronicle(root).isRepository).toBe(true);
  configureGit(root);
  writeFileSync(join(root, "a.md"), "a one\n");
  writeFileSync(join(root, "b.md"), "b one\n");
  git(root, "add", "--", "a.md", "b.md");
  const initial = commitChronicleSelection(root, ["a.md", "b.md"], "initial notes", appData);

  writeFileSync(join(root, "a.md"), "a two\n");
  writeFileSync(join(root, "b.md"), "b two\n");
  git(root, "add", "--", "b.md");
  mkdirSync(appData, {recursive: true});
  writeFileSync(join(appData, "credentials.json"), "secret\n");

  const review = reviewChronicleCommit(root, ["a.md", "b.md", ".openobsidian-data/credentials.json"], appData);
  expect(review.selectedPaths).toEqual(["a.md", "b.md"]);
  expect(review.excludedPaths).toEqual([{path: ".openobsidian-data/credentials.json", reason: "OpenObsidian app-private data is never staged by default."}]);
  const committed = commitChronicleSelection(root, ["a.md"], "update a", appData);

  expect(committed.paths).toEqual(["a.md"]);
  expect(git(root, "show", `${committed.revision}:a.md`)).toBe("a two");
  expect(git(root, "diff", "--cached", "--name-only")).toBe("b.md");
  expect(git(root, "status", "--porcelain=v1", "--untracked-files=all")).toContain("credentials.json");
  expect(git(root, "show", `${initial.revision}:b.md`)).toBe("b one");
});

test("Chronicle diff, history and restore use the recovery broker", () => {
  const root = createRoot();
  const appData = mkdtempSync(join(tmpdir(), "openobsidian-chronicle-app-"));
  roots.push(appData);
  initializeChronicle(root);
  configureGit(root);
  writeFileSync(join(root, "note.md"), "one\n");
  const first = commitChronicleSelection(root, ["note.md"], "first", appData);
  writeFileSync(join(root, "note.md"), "two\n");
  expect(chronicleDiff(root, "note.md")).toContain("+two");
  const store = new VaultStore(root, appData);
  const restored = restoreChronicleFile(root, store, first.revision, "note.md");

  expect(restored.sourceRevision).toBe(first.revision);
  expect(readFileSync(join(root, "note.md"), "utf8")).toBe("one\n");
  expect(store.listRecovery("note.md")).toHaveLength(1);
  expect(chronicleHistory(root).map((entry) => entry.message)).toEqual(["first"]);
  expect(historyRecordsFromStore(store).map((entry) => entry.kind)).toEqual(["recovery"]);
  expect(planHistoryRetention(historyRecordsFromStore(store), new Date("2026-09-10T00:00:00Z"), {maxAgeDays: 30, maxBytes: 100}).retained).toHaveLength(1);
});

test("Chronicle remotes and sync actions are explicit and injectable", () => {
  const root = createRoot();
  initializeChronicle(root);
  const state = addChronicleRemote(root, "offline", "https://offline.invalid/openobsidian.git");
  expect(state.remotes).toEqual([{name: "offline", fetchUrl: "https://offline.invalid/openobsidian.git", pushUrl: "https://offline.invalid/openobsidian.git"}]);

  const calls: string[][] = [];
  const runner = (_root: string, args: string[]) => {
    calls.push(args);
    return {exitCode: 0, stdout: "ok"};
  };
  expect(pullChronicle(root, "offline", "main", runner)).toBe("ok");
  expect(pushChronicle(root, "offline", "main", runner)).toBe("ok");
  expect(calls).toEqual([["pull", "--ff-only", "offline", "main"], ["push", "offline", "main"]]);
  expect(() => pushChronicle(root, "-u", "main", runner)).toThrow("invalid");
});
