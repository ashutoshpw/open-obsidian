import {expect, test} from "bun:test";
import {existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildVaultIndex, loadVaultIdentities, loadVaultIndex, rebuildVaultIndex, searchVaultIndex} from "../src/core/vault-index.js";
import {VaultStore, snapshotVault} from "../src/core/vault.js";

test("derived indexes stay outside the vault and rebuild from authoritative bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-index-vault-"));
  const appData = mkdtempSync(join(tmpdir(), "openobsidian-index-app-"));
  try {
    writeFileSync(join(root, "Index.md"), "See [[Target]] and the local retrieval guide.\n");
    writeFileSync(join(root, "Target.md"), "Retrieval guide body.\n");
    const store = new VaultStore(root, appData);
    const before = snapshotVault(root);
    const index = rebuildVaultIndex(store);
    const link = index.files.find((file) => file.relativePath === "Index.md")?.links[0];

    expect(existsSync(join(appData, "index.json"))).toBe(true);
    expect(existsSync(join(root, "index.json"))).toBe(false);
    expect(snapshotVault(root).sha256).toBe(before.sha256);
    expect(loadVaultIdentities(store)?.identities).toHaveLength(2);
    expect(link?.resolution).toMatchObject({status: "resolved", target: "Target.md"});
    expect(searchVaultIndex(index, "retrieval").map((result) => result.relativePath)).toContain("Target.md");
    expect(loadVaultIndex(store)?.sourceSnapshot).toBe(before.sha256);
  } finally {
    rmSync(root, {recursive: true, force: true});
    rmSync(appData, {recursive: true, force: true});
  }
});

test("vault identities survive rename and replacement without collapsing duplicates", () => {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-identities-vault-"));
  const appData = mkdtempSync(join(tmpdir(), "openobsidian-identities-app-"));
  try {
    writeFileSync(join(root, "original.md"), "same\n");
    const store = new VaultStore(root, appData);
    const first = rebuildVaultIndex(store);
    const originalIdentity = first.files.find((file) => file.relativePath === "original.md")?.identity;
    renameSync(join(root, "original.md"), join(root, "renamed.md"));
    const renamed = rebuildVaultIndex(store);
    expect(renamed.files.find((file) => file.relativePath === "renamed.md")?.identity).toBe(originalIdentity);

    writeFileSync(join(root, "duplicate.md"), "same\n");
    const duplicate = rebuildVaultIndex(store);
    const duplicateIdentity = duplicate.files.find((file) => file.relativePath === "duplicate.md")?.identity;
    expect(duplicateIdentity).toBeDefined();
    expect(duplicateIdentity).not.toBe(originalIdentity);

    writeFileSync(join(root, "renamed.md"), "replacement\n");
    const replaced = rebuildVaultIndex(store);
    expect(replaced.files.find((file) => file.relativePath === "renamed.md")?.identity).toBe(originalIdentity);
    expect(snapshotVault(root).entries.map((entry) => entry.relativePath)).toEqual(["duplicate.md", "renamed.md"]);
  } finally {
    rmSync(root, {recursive: true, force: true});
    rmSync(appData, {recursive: true, force: true});
  }
});

test("index search returns deterministic ranked results and updates after a rebuild", () => {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-search-vault-"));
  const appData = mkdtempSync(join(tmpdir(), "openobsidian-search-app-"));
  try {
    writeFileSync(join(root, "a.md"), "alpha alpha\n");
    writeFileSync(join(root, "b.md"), "alpha\n");
    const store = new VaultStore(root, appData);
    const first = buildVaultIndex(store);
    expect(searchVaultIndex(first, "alpha").map((result) => result.relativePath)).toEqual(["a.md", "b.md"]);
    writeFileSync(join(root, "b.md"), "beta beta\n");
    const second = rebuildVaultIndex(store);
    expect(searchVaultIndex(second, "alpha").map((result) => result.relativePath)).toEqual(["a.md"]);
    expect(readFileSync(join(root, "b.md"), "utf8")).toBe("beta beta\n");
  } finally {
    rmSync(root, {recursive: true, force: true});
    rmSync(appData, {recursive: true, force: true});
  }
});
