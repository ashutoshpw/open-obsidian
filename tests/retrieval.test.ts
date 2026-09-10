import {expect, test} from "bun:test";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DEFAULT_RETRIEVAL_EXCLUSIONS, retrieveVault} from "../src/core/retrieval.js";
import {VaultStore} from "../src/core/vault.js";

test("local hybrid retrieval filters scope before ranking and exposes source revisions", () => {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-retrieval-vault-"));
  const appData = mkdtempSync(join(tmpdir(), "openobsidian-retrieval-app-"));
  try {
    mkdirSync(join(root, "Projects"), {recursive: true});
    mkdirSync(join(root, ".obsidian"), {recursive: true});
    writeFileSync(join(root, "Projects", "alpha.md"), "---\ntags: [ai, project]\n---\n# Retrieval\nLocal retrieval answers stay grounded in source notes.\n");
    writeFileSync(join(root, "Projects", "private.md"), "Local retrieval secret should never be returned.\n");
    writeFileSync(join(root, "outside.md"), "Local retrieval outside the selected folder.\n");
    writeFileSync(join(root, ".obsidian", "config.md"), "Local retrieval configuration secret.\n");
    const store = new VaultStore(root, appData);
    const progress: Array<{phase: string; processed: number; total: number; indexed: number; excluded: number; currentPath?: string}> = [];
    const result = retrieveVault(store, {query: "local retrieval", scope: {folders: ["Projects"], tags: ["ai"], excludedPaths: ["Projects/private.md"]}}, (update) => progress.push(update));
    const citation = result.passages[0]!;

    expect(DEFAULT_RETRIEVAL_EXCLUSIONS).toContain(".obsidian");
    expect(result.mode).toBe("local-hybrid");
    expect(result.provider).toBe("none");
    expect(result.indexedFiles).toEqual(["Projects/alpha.md"]);
    expect(result.excludedFiles).toEqual([".obsidian/config.md", "Projects/private.md"]);
    expect(result.scopedOutFiles).toContain("outside.md");
    expect(citation.relativePath).toBe("Projects/alpha.md");
    expect(citation.heading).toBe("Retrieval");
    expect(citation.lineStart).toBe(4);
    expect(citation.revision).toBe(store.read("Projects/alpha.md").revision);
    expect(citation.snippet).toContain("Local retrieval answers");
    expect(result.answer.status).toBe("grounded");
    expect(result.answer.inference).toContain("No model inference");
    expect(result.answer.citations[0]?.id).toBe(citation.id);
    expect(progress[0]).toMatchObject({phase: "indexing", processed: 0, total: 4});
    expect(progress.at(-1)).toMatchObject({phase: "complete", processed: 4, total: 4, excluded: 2});
  } finally {
    rmSync(root, {recursive: true, force: true});
    rmSync(appData, {recursive: true, force: true});
  }
});

test("grounded retrieval reports missing evidence without inventing an answer", () => {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-missing-vault-"));
  const appData = mkdtempSync(join(tmpdir(), "openobsidian-missing-app-"));
  try {
    writeFileSync(join(root, "note.md"), "A note about local files.\n");
    const result = retrieveVault(new VaultStore(root, appData), {query: "unrecorded question"});
    expect(result.passages).toEqual([]);
    expect(result.answer).toMatchObject({status: "missing-evidence", inference: null, citations: []});
    expect(result.answer.answer).toContain("No in-scope source passage matched");
  } finally {
    rmSync(root, {recursive: true, force: true});
    rmSync(appData, {recursive: true, force: true});
  }
});
