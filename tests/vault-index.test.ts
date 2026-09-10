import {expect, test} from "bun:test";
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildVaultIndex, loadVaultIndex, rebuildVaultIndex, searchVaultIndex} from "../src/core/vault-index.js";
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
    expect(link?.resolution).toMatchObject({status: "resolved", target: "Target.md"});
    expect(searchVaultIndex(index, "retrieval").map((result) => result.relativePath)).toContain("Target.md");
    expect(loadVaultIndex(store)?.sourceSnapshot).toBe(before.sha256);
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
