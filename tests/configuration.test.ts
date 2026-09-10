import {expect, test} from "bun:test";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {resolveAttachment} from "../src/core/attachments.js";
import {configurationIsReadOnlyBeforeAfter, discoverVaultConfiguration, hasExistingConfiguration} from "../src/core/configuration.js";
import {VaultStore, snapshotVault} from "../src/core/vault.js";

test("configuration discovery maps existing folders without writing them", () => {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-config-vault-"));
  try {
    mkdirSync(join(root, ".obsidian"));
    mkdirSync(join(root, ".obsidian-mobile"));
    writeFileSync(join(root, ".obsidian", "app.json"), "{\"showLineNumber\":true}\n");
    writeFileSync(join(root, ".obsidian-mobile", "appearance.json"), "{\"theme\":\"dark\"}\n");
    const before = snapshotVault(root);
    const result = configurationIsReadOnlyBeforeAfter(root, () => discoverVaultConfiguration(root));

    expect(hasExistingConfiguration(root)).toBe(true);
    expect(result.unchanged).toBe(true);
    expect(result.after.folders).toEqual([".obsidian", ".obsidian-mobile"]);
    expect(result.after.json[".obsidian/app.json"]?.showLineNumber).toBe(true);
    expect(snapshotVault(root).sha256).toBe(before.sha256);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test("attachments retain original binary bytes and expose the original path", () => {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-attachment-vault-"));
  const appData = mkdtempSync(join(tmpdir(), "openobsidian-attachment-app-"));
  try {
    const original = Buffer.from([0, 255, 10, 128]);
    writeFileSync(join(root, "photo.bin"), original);
    const reference = resolveAttachment(new VaultStore(root, appData), "photo.bin");
    expect(reference.kind).toBe("file");
    expect(reference.absolutePath).toBe(join(root, "photo.bin"));
    expect(readFileSync(reference.absolutePath)).toEqual(original);
    expect(resolveAttachment(new VaultStore(root, appData), "missing.pdf").kind).toBe("missing");
  } finally {
    rmSync(root, {recursive: true, force: true});
    rmSync(appData, {recursive: true, force: true});
  }
});
