import {afterEach, expect, test} from "bun:test";
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {inspectVaultGitState} from "../src/core/chronicle.js";
import {RevisionConflict, VaultSafetyError, VaultStore, snapshotVault} from "../src/core/vault.js";

const temporaryRoots: string[] = [];

function createFixture(): {root: string; appData: string} {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-vault-"));
  const appData = mkdtempSync(join(tmpdir(), "openobsidian-app-"));
  temporaryRoots.push(root, appData);
  mkdirSync(join(root, ".obsidian"));
  writeFileSync(join(root, "note.md"), Buffer.from("\uFEFF---\r\nstatus: open\r\nunknown: [keep, me]\r\n---\r\nBody\r\n", "utf8"));
  writeFileSync(join(root, "binary.bin"), Buffer.from([0, 255, 7, 10, 128]));
  writeFileSync(join(root, ".obsidian", "app.json"), "{\"theme\":\"minimal\"}\n");
  return {root, appData};
}

function gitResult(root: string, args: string[]): {exitCode: number; stdout: string} {
  const result = Bun.spawnSync(["git", "-C", root, ...args]);
  return {exitCode: result.exitCode, stdout: result.stdout.toString().trim()};
}

function runGit(root: string, args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", root, ...args]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

afterEach(() => {
  temporaryRoots.splice(0).forEach((path) => rmSync(path, {recursive: true, force: true}));
});

test("scan and read are byte-preserving no-op operations", () => {
  const fixture = createFixture();
  const store = new VaultStore(fixture.root, fixture.appData);
  const before = snapshotVault(fixture.root);
  const scan = store.scan();
  const read = store.read("note.md");
  const after = snapshotVault(fixture.root);

  expect(scan.unchanged).toBe(true);
  expect(scan.changedPaths).toEqual([]);
  expect(read.bytes).toEqual(new Uint8Array(Buffer.from("\uFEFF---\r\nstatus: open\r\nunknown: [keep, me]\r\n---\r\nBody\r\n", "utf8")));
  expect(after.sha256).toBe(before.sha256);
  expect(readdirSync(fixture.appData)).toEqual([]);
});

test("revision-aware writes preserve untouched bytes and create recovery history", () => {
  const fixture = createFixture();
  const store = new VaultStore(fixture.root, fixture.appData);
  const original = store.read("note.md");
  const next = Buffer.from(Buffer.from(original.bytes).toString("utf8").replace("status: open", "status: done"), "utf8");
  const written = store.write({relativePath: "note.md", expectedRevision: original.revision, bytes: next, operationId: "test-write"});

  expect(written.revision).not.toBe(original.revision);
  expect(readFileSync(join(fixture.root, "note.md"))).toEqual(next);
  expect(readFileSync(join(fixture.root, "binary.bin"))).toEqual(Buffer.from([0, 255, 7, 10, 128]));
  expect(store.listRecovery("note.md")).toHaveLength(1);
  expect(readFileSync(store.listRecovery("note.md")[0]!.path)).toEqual(Buffer.from(original.bytes));
  expect(readdirSync(fixture.root).some((name) => name.endsWith(".tmp"))).toBe(false);
});

test("concurrent edits preserve incoming bytes as a conflict", () => {
  const fixture = createFixture();
  const store = new VaultStore(fixture.root, fixture.appData);
  const original = store.read("note.md");
  const external = Buffer.from("external edit\n", "utf8");
  const incoming = Buffer.from("assistant edit\n", "utf8");
  writeFileSync(join(fixture.root, "note.md"), external);

  let caught: unknown;
  try {
    store.write({relativePath: "note.md", expectedRevision: original.revision, bytes: incoming});
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(RevisionConflict);
  const conflict = caught as RevisionConflict;
  expect(conflict.expectedRevision).toBe(original.revision);
  expect(conflict.currentRevision).toBe(store.read("note.md").revision);
  expect(readFileSync(conflict.preservedIncomingPath)).toEqual(incoming);
  expect(readFileSync(join(fixture.root, "note.md"))).toEqual(external);
});

test("three-way merge writes disjoint edits and preserves overlapping conflicts", () => {
  const fixture = createFixture();
  const mergePath = join(fixture.root, "merge.md");
  const base = Buffer.from("one\ntwo\nthree\n", "utf8");
  writeFileSync(mergePath, base);
  const store = new VaultStore(fixture.root, fixture.appData);

  writeFileSync(mergePath, Buffer.from("one\ntwo\nTHREE\n", "utf8"));
  const merged = store.mergeWrite("merge.md", new Uint8Array(base), Buffer.from("ONE\ntwo\nthree\n", "utf8"), "test-merge");

  expect(merged.merge.status).toBe("merged");
  expect(readFileSync(mergePath)).toEqual(Buffer.from("ONE\ntwo\nTHREE\n", "utf8"));
  expect(merged.written?.revision).toBe(store.read("merge.md").revision);

  const current = Buffer.from("CURRENT\ntwo\nTHREE\n", "utf8");
  writeFileSync(mergePath, current);
  const conflictIncoming = Buffer.from("LOCAL\ntwo\nTHREE\n", "utf8");
  const conflict = store.mergeWrite("merge.md", Buffer.from("ONE\ntwo\nTHREE\n", "utf8"), conflictIncoming);

  expect(conflict.merge.status).toBe("conflict");
  expect(conflict.preservedIncomingPath).toBeDefined();
  expect(readFileSync(mergePath)).toEqual(current);
  expect(readFileSync(conflict.preservedIncomingPath!)).toEqual(conflictIncoming);
});

test("an interrupted temporary replacement preserves both old and incoming bytes", () => {
  const fixture = createFixture();
  const original = readFileSync(join(fixture.root, "note.md"));
  const incoming = Buffer.from("interrupted assistant edit\n", "utf8");
  const store = new VaultStore(fixture.root, fixture.appData, {
    faultHook: (stage) => {
      if (stage === "after-temp-write") throw new Error("injected interruption");
    },
  });

  expect(() => store.write({relativePath: "note.md", expectedRevision: store.read("note.md").revision, bytes: incoming})).toThrow("injected interruption");
  expect(readFileSync(join(fixture.root, "note.md"))).toEqual(original);
  expect(readFileSync(store.listFailedWrites("note.md")[0]!.path)).toEqual(incoming);
  expect(store.listRecovery("note.md")).toHaveLength(1);
  expect(readdirSync(fixture.root).some((name) => name.endsWith(".tmp"))).toBe(false);
});

test("pre-write and replace failures preserve incoming bytes as failed history", () => {
  for (const [stage, message] of [["before-temp-write", "injected disk full"], ["before-replace", "injected permission loss"]] as const) {
    const fixture = createFixture();
    const original = readFileSync(join(fixture.root, "note.md"));
    const incoming = Buffer.from(`${message}\n`, "utf8");
    const store = new VaultStore(fixture.root, fixture.appData, {faultHook: (faultStage) => {
      if (faultStage === stage) throw new Error(message);
    }});

    expect(() => store.write({relativePath: "note.md", expectedRevision: store.read("note.md").revision, bytes: incoming})).toThrow(message);
    expect(readFileSync(join(fixture.root, "note.md"))).toEqual(original);
    expect(readFileSync(store.listFailedWrites("note.md")[0]!.path)).toEqual(incoming);
    expect(readdirSync(fixture.root).some((name) => name.endsWith(".tmp"))).toBe(false);
    temporaryRoots.splice(temporaryRoots.indexOf(fixture.root), 1);
    temporaryRoots.splice(temporaryRoots.indexOf(fixture.appData), 1);
    rmSync(fixture.root, {recursive: true, force: true});
    rmSync(fixture.appData, {recursive: true, force: true});
  }
});

test("a failed multi-file write journals the batch and preserves each version", () => {
  const fixture = createFixture();
  writeFileSync(join(fixture.root, "second.md"), "second original\n");
  const store = new VaultStore(fixture.root, fixture.appData, {
    faultHook: (stage, relativePath) => {
      if (stage === "before-replace" && relativePath === "second.md") throw new Error("injected batch failure");
    },
  });
  const first = store.read("note.md");
  const second = store.read("second.md");

  expect(() => store.writeBatch([
    {relativePath: "note.md", expectedRevision: first.revision, bytes: Buffer.from("first next\n")},
    {relativePath: "second.md", expectedRevision: second.revision, bytes: Buffer.from("second next\n")},
  ], "test-batch")).toThrow("injected batch failure");
  expect(readFileSync(join(fixture.root, "note.md"))).toEqual(Buffer.from("first next\n"));
  expect(readFileSync(join(fixture.root, "second.md"))).toEqual(Buffer.from("second original\n"));
  expect(readFileSync(store.listFailedWrites("second.md")[0]!.path)).toEqual(Buffer.from("second next\n"));
  const journal = readFileSync(join(fixture.appData, "journal.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as {operation: string; state: string; id: string});
  expect(journal.some((entry) => entry.operation === "batch" && entry.state === "failed" && entry.id === "test-batch")).toBe(true);
});

test("symlinks are recorded but never followed for file operations", () => {
  const fixture = createFixture();
  const outside = join(fixture.appData, "outside.txt");
  writeFileSync(outside, "outside\n");
  symlinkSync(outside, join(fixture.root, "outside.txt"));
  const store = new VaultStore(fixture.root, fixture.appData);
  const snapshot = snapshotVault(fixture.root);

  expect(snapshot.entries.find((entry) => entry.relativePath === "outside.txt")?.kind).toBe("symlink");
  expect(() => store.read("outside.txt")).toThrow(VaultSafetyError);
  expect(() => store.write({relativePath: "outside.txt", expectedRevision: null, bytes: Buffer.from("blocked") })).toThrow(VaultSafetyError);
});

test("intermediate symlinks are never traversed", () => {
  const fixture = createFixture();
  const outsideDirectory = join(fixture.appData, "outside-directory");
  mkdirSync(outsideDirectory);
  writeFileSync(join(outsideDirectory, "secret.md"), "secret\n");
  symlinkSync(outsideDirectory, join(fixture.root, "linked-directory"));
  const store = new VaultStore(fixture.root, fixture.appData);

  expect(() => store.read("linked-directory/secret.md")).toThrow(VaultSafetyError);
  expect(() => store.write({relativePath: "linked-directory/new.md", expectedRevision: null, bytes: Buffer.from("blocked") })).toThrow(VaultSafetyError);
  expect(readFileSync(join(outsideDirectory, "secret.md"))).toEqual(Buffer.from("secret\n"));
});

test("delete-versus-edit and rename-versus-edit preserve incoming bytes", () => {
  const fixture = createFixture();
  const store = new VaultStore(fixture.root, fixture.appData);
  const original = store.read("note.md");
  const deletedIncoming = Buffer.from("edit after delete\n");
  unlinkSync(join(fixture.root, "note.md"));

  expect(() => store.write({relativePath: "note.md", expectedRevision: original.revision, bytes: deletedIncoming})).toThrow(RevisionConflict);
  const deletedConflict = store.listRecovery().find((record) => record.relativePath === "note.md");
  expect(deletedConflict).toBeUndefined();
  const deletedPath = readdirSync(join(fixture.appData, "conflicts")).find((name) => name.endsWith(".incoming"));
  expect(deletedPath).toBeDefined();
  expect(readFileSync(join(fixture.appData, "conflicts", deletedPath!))).toEqual(deletedIncoming);

  writeFileSync(join(fixture.root, "note.md"), Buffer.from(original.bytes));
  const renamedBase = store.read("note.md");
  const renamedIncoming = Buffer.from("edit after rename\n");
  renameSync(join(fixture.root, "note.md"), join(fixture.root, "renamed.md"));

  expect(() => store.write({relativePath: "note.md", expectedRevision: renamedBase.revision, bytes: renamedIncoming})).toThrow(RevisionConflict);
  expect(readFileSync(join(fixture.root, "renamed.md"))).toEqual(Buffer.from(original.bytes));
  const conflictFiles = readdirSync(join(fixture.appData, "conflicts")).filter((name) => name.endsWith(".incoming"));
  expect(conflictFiles).toHaveLength(2);
  expect(conflictFiles.map((name) => readFileSync(join(fixture.appData, "conflicts", name)))).toContainEqual(renamedIncoming);
});

test("case-only renames and Unicode source bytes remain observable", () => {
  const fixture = createFixture();
  const casePath = join(fixture.root, "CaseOnly.md");
  const lowerPath = join(fixture.root, "caseonly.md");
  const unicodeBytes = Buffer.from("na\u0069\u0308ve\r\n", "utf8");
  writeFileSync(casePath, "case\n");
  writeFileSync(join(fixture.root, "unicode.md"), unicodeBytes);
  const store = new VaultStore(fixture.root, fixture.appData);
  const before = snapshotVault(fixture.root);
  renameSync(casePath, lowerPath);
  const after = snapshotVault(fixture.root);

  expect(diffPaths(before, after)).toContain("CaseOnly.md");
  expect(diffPaths(before, after)).toContain("caseonly.md");
  expect(store.read("unicode.md").bytes).toEqual(unicodeBytes);
});

test("the safety failure matrix names every required non-destructive outcome", () => {
  const matrix = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/vault-safety-failure-matrix.json"), "utf8")) as {
    schema_version: number;
    scenarios: Array<{id: string; expected_outcome: string}>;
  };
  const expected = ["disk-full", "permission-loss", "concurrent-edit", "delete-versus-edit", "rename-versus-edit", "partial-sync", "cloud-placeholder", "symlink", "case-only-rename", "windows-reserved-name", "unicode-normalization"];

  expect(matrix.schema_version).toBe(1);
  expect(matrix.scenarios.map((scenario) => scenario.id)).toEqual(expected);
  expect(matrix.scenarios.every((scenario) => scenario.expected_outcome.length > 0)).toBe(true);
  if (process.platform === "win32") {
    const fixture = createFixture();
    const store = new VaultStore(fixture.root, fixture.appData);
    expect(() => store.read("CON")).toThrow("Windows-reserved");
  }
});

test("Standard vault Git inspection is read-only", () => {
  const fixture = createFixture();
  const before = snapshotVault(fixture.root);
  const state = inspectVaultGitState(fixture.root);
  const after = snapshotVault(fixture.root);

  expect(state.vaultType).toBe("standard");
  expect(state.isRepository).toBe(false);
  expect(state.remoteContacted).toBe(false);
  expect(after.sha256).toBe(before.sha256);
});

test("Chronicle inspection captures dirty unborn remotes without remote contact", () => {
  const fixture = createFixture();
  runGit(fixture.root, ["init", "--quiet"]);
  runGit(fixture.root, ["remote", "add", "origin", "https://offline.invalid/openobsidian.git"]);
  writeFileSync(join(fixture.root, "untracked.md"), "untracked\n");
  const before = snapshotVault(fixture.root);
  const state = inspectVaultGitState(fixture.root, (root, args) => args[0] === "config" ? {exitCode: 1, stdout: ""} : gitResult(root, args));
  const after = snapshotVault(fixture.root);

  expect(state.vaultType).toBe("chronicle");
  expect(state.isRepository).toBe(true);
  expect(state.unborn).toBe(true);
  expect(state.dirty).toBe(true);
  expect(state.untracked).toBe(true);
  expect(state.staged).toBe(false);
  expect(state.authorConfigured).toBe(false);
  expect(state.remotes).toEqual([{name: "origin", fetchUrl: "https://offline.invalid/openobsidian.git", pushUrl: "https://offline.invalid/openobsidian.git"}]);
  expect(state.remoteContacted).toBe(false);
  expect(after.sha256).toBe(before.sha256);
});

function diffPaths(before: ReturnType<typeof snapshotVault>, after: ReturnType<typeof snapshotVault>): string[] {
  const beforePaths = new Set(before.entries.map((entry) => entry.relativePath));
  const afterPaths = new Set(after.entries.map((entry) => entry.relativePath));
  return [...new Set([...beforePaths, ...afterPaths])].filter((path) => beforePaths.has(path) !== afterPaths.has(path)).sort();
}
