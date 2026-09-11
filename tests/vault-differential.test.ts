import {afterEach, expect, test} from "bun:test";
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {editMarkdownProperty} from "../src/core/markdown.js";
import {RevisionConflict, VaultSafetyError, VaultStore, snapshotVault} from "../src/core/vault.js";
import {validateDifferentialFixture, type DifferentialCase, type DifferentialFixture} from "../scripts/validate-differential-fixtures.js";

const fixture = JSON.parse(await Bun.file(new URL("../fixtures/vault-differential.json", import.meta.url)).text()) as DifferentialFixture;
const temporaryRoots: string[] = [];

function temporaryFixture(): {root: string; appData: string} {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-differential-vault-"));
  const appData = mkdtempSync(join(tmpdir(), "openobsidian-differential-app-"));
  temporaryRoots.push(root, appData);
  return {root, appData};
}

function inputString(testCase: DifferentialCase, key: string): string {
  const value = testCase.input[key];
  if (typeof value !== "string") throw new Error(`${testCase.id} input ${key} must be a string`);
  return value;
}

function caseById(id: string): DifferentialCase {
  const testCase = fixture.cases.find((candidate) => candidate.id === id);
  if (!testCase) throw new Error(`Missing differential case ${id}`);
  return testCase;
}

afterEach(() => {
  temporaryRoots.splice(0).forEach((path) => rmSync(path, {recursive: true, force: true}));
});

test("differential fixture keeps local and reference results explicit", () => {
  const result = validateDifferentialFixture(fixture);
  expect(result.failures).toEqual([]);
  expect(result.localCaseCount).toBe(4);
  expect(result.pendingReferenceCount).toBe(4);
  expect(result.decisionCount).toBe(4);
});

test("markdown-read-no-op", () => {
  const testCase = caseById("markdown-read-no-op");
  const roots = temporaryFixture();
  mkdirSync(join(roots.root, ".obsidian"));
  const noteSource = inputString(testCase, "note_source");
  writeFileSync(join(roots.root, "note.md"), noteSource, "utf8");
  writeFileSync(join(roots.root, "binary.bin"), Buffer.from(testCase.input.binary_bytes as number[]));
  const store = new VaultStore(roots.root, roots.appData);
  const before = snapshotVault(roots.root);
  const scan = store.scan();
  const read = store.read("note.md");
  const after = snapshotVault(roots.root);

  expect(scan.unchanged).toBe(true);
  expect(scan.changedPaths).toEqual([]);
  expect(Buffer.from(read.bytes).toString("utf8")).toBe(noteSource);
  expect(after.sha256).toBe(before.sha256);
  expect(readdirSync(roots.appData)).toEqual([]);
});

test("markdown-property-source-preservation", () => {
  const testCase = caseById("markdown-property-source-preservation");
  const source = Buffer.from(inputString(testCase, "source"), "utf8");
  const edited = editMarkdownProperty(source, inputString(testCase, "property"), inputString(testCase, "value"));
  expect(Buffer.from(edited).toString("utf8")).toBe(inputString(testCase, "expected"));
});

test("revision-conflict-preserves-incoming", () => {
  const testCase = caseById("revision-conflict-preserves-incoming");
  const roots = temporaryFixture();
  const path = join(roots.root, "note.md");
  writeFileSync(path, inputString(testCase, "original"), "utf8");
  const store = new VaultStore(roots.root, roots.appData);
  const original = store.read("note.md");
  const external = Buffer.from(inputString(testCase, "external"), "utf8");
  const incoming = Buffer.from(inputString(testCase, "incoming"), "utf8");
  writeFileSync(path, external);

  let caught: unknown;
  try {
    store.write({relativePath: "note.md", expectedRevision: original.revision, bytes: incoming});
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(RevisionConflict);
  expect(readFileSync(path)).toEqual(external);
  expect(readFileSync((caught as RevisionConflict).preservedIncomingPath)).toEqual(incoming);
});

test("symlink-boundary-is-not-followed", () => {
  const testCase = caseById("symlink-boundary-is-not-followed");
  const roots = temporaryFixture();
  const target = inputString(testCase, "target");
  const outside = join(roots.appData, target);
  writeFileSync(outside, inputString(testCase, "outside_source"), "utf8");
  symlinkSync(outside, join(roots.root, target));
  const store = new VaultStore(roots.root, roots.appData);
  const snapshot = snapshotVault(roots.root);

  expect(snapshot.entries.find((entry) => entry.relativePath === target)?.kind).toBe("symlink");
  expect(() => store.read(target)).toThrow(VaultSafetyError);
  expect(() => store.write({relativePath: target, expectedRevision: null, bytes: Buffer.from("blocked")})).toThrow(VaultSafetyError);
  expect(readFileSync(outside)).toEqual(Buffer.from(inputString(testCase, "outside_source"), "utf8"));
});
