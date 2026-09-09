import {afterEach, expect, test} from "bun:test";
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
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
