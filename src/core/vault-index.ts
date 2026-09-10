import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {extractLinks, resolveLink, type LinkReference} from "./links.js";
import {snapshotVault, VaultStore, type VaultEntry} from "./vault.js";

export type IndexedFile = {
  relativePath: string;
  bytes: number;
  sha256: string;
  links: Array<LinkReference & {resolution: ReturnType<typeof resolveLink>}>;
  searchText?: string;
};

export type VaultIndex = {
  schema_version: 1;
  vaultRoot: string;
  builtAt: string;
  sourceSnapshot: string;
  files: IndexedFile[];
};

function filePath(store: VaultStore, relativePath: string): string {
  return join(store.root, ...relativePath.split("/"));
}

function indexEntry(store: VaultStore, entry: VaultEntry, filePaths: string[]): IndexedFile {
  if (entry.kind === "symlink" || !entry.relativePath.toLowerCase().endsWith(".md")) return {...entry, links: []};
  const searchText = readFileSync(filePath(store, entry.relativePath), "utf8");
  const links = extractLinks(searchText).map((link) => ({...link, resolution: resolveLink(link, filePaths, entry.relativePath)}));
  return {...entry, links, searchText};
}

export function buildVaultIndex(store: VaultStore): VaultIndex {
  const snapshot = snapshotVault(store.root);
  const filePaths = snapshot.entries.filter((entry) => entry.kind === "file").map((entry) => entry.relativePath);
  const files = snapshot.entries.map((entry) => indexEntry(store, entry, filePaths));
  return {schema_version: 1, vaultRoot: store.root, builtAt: new Date().toISOString(), sourceSnapshot: snapshot.sha256, files};
}

function saveVaultIndex(store: VaultStore, index: VaultIndex): string {
  mkdirSync(store.appDataRoot, {recursive: true});
  const path = join(store.appDataRoot, "index.json");
  writeFileSync(path, JSON.stringify(index, null, 2));
  return path;
}

export function rebuildVaultIndex(store: VaultStore): VaultIndex {
  const index = buildVaultIndex(store);
  saveVaultIndex(store, index);
  return index;
}

export function loadVaultIndex(store: VaultStore): VaultIndex | null {
  const path = join(store.appDataRoot, "index.json");
  if (!existsSync(path)) return null;
  const index = JSON.parse(readFileSync(path, "utf8")) as VaultIndex;
  if (index.schema_version !== 1 || index.vaultRoot !== store.root) return null;
  return index;
}

export type SearchResult = {relativePath: string; score: number; preview: string};

export function searchVaultIndex(index: VaultIndex, query: string): SearchResult[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];
  return index.files.flatMap((file) => {
    const content = file.searchText?.toLocaleLowerCase() ?? "";
    const path = file.relativePath.toLocaleLowerCase();
    const contentMatches = content.split(normalizedQuery).length - 1;
    const pathMatch = path.includes(normalizedQuery);
    if (contentMatches === 0 && !pathMatch) return [];
    return [{relativePath: file.relativePath, score: contentMatches + (pathMatch ? 1 : 0), preview: file.searchText?.slice(0, 160) ?? file.relativePath}];
  }).sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath));
}
