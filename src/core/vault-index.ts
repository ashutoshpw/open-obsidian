import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {extractLinks, resolveLink, type LinkReference} from "./links.js";
import {snapshotVault, VaultStore, type VaultEntry} from "./vault.js";

export type IndexedFile = {
  identity?: string;
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

export type VaultIdentity = {id: string; relativePath: string; sha256: string; firstSeenAt: string; lastSeenAt: string};
export type VaultIdentityMap = {schema_version: 1; vaultRoot: string; identities: VaultIdentity[]};

function filePath(store: VaultStore, relativePath: string): string {
  return join(store.root, ...relativePath.split("/"));
}

function identityPath(store: VaultStore): string {
  return join(store.appDataRoot, "identities.json");
}

function deterministicIdentity(store: VaultStore, entry: VaultEntry, ordinal: number): string {
  return createHash("sha256").update(`${store.root}\0${entry.relativePath}\0${entry.sha256}\0${ordinal}`).digest("hex");
}

export function loadVaultIdentities(store: VaultStore): VaultIdentityMap | null {
  const path = identityPath(store);
  if (!existsSync(path)) return null;
  const map = JSON.parse(readFileSync(path, "utf8")) as VaultIdentityMap;
  if (map.schema_version !== 1 || map.vaultRoot !== store.root || !Array.isArray(map.identities)) return null;
  return map;
}

function assignIdentities(store: VaultStore, entries: VaultEntry[]): VaultIdentity[] {
  const previous = loadVaultIdentities(store)?.identities ?? [];
  const available = new Set(previous.map((identity) => identity.id));
  const now = new Date().toISOString();
  const matched = entries.map((entry) => previous.find((identity) => available.has(identity.id) && identity.relativePath === entry.relativePath));
  matched.forEach((identity) => {
    if (identity) available.delete(identity.id);
  });
  entries.forEach((entry, index) => {
    if (matched[index]) return;
    matched[index] = previous.find((identity) => available.has(identity.id) && identity.sha256 === entry.sha256);
    if (matched[index]) available.delete(matched[index]!.id);
  });
  return entries.map((entry, ordinal) => {
    const existing = matched[ordinal];
    const id = existing?.id ?? deterministicIdentity(store, entry, ordinal);
    return {id, relativePath: entry.relativePath, sha256: entry.sha256, firstSeenAt: existing?.firstSeenAt ?? now, lastSeenAt: now};
  });
}

function saveVaultIdentities(store: VaultStore, identities: VaultIdentity[]): void {
  mkdirSync(store.appDataRoot, {recursive: true});
  writeFileSync(identityPath(store), JSON.stringify({schema_version: 1, vaultRoot: store.root, identities}, null, 2));
}

function indexEntry(store: VaultStore, entry: VaultEntry, identity: VaultIdentity, filePaths: string[]): IndexedFile {
  if (entry.kind === "symlink" || !entry.relativePath.toLowerCase().endsWith(".md")) return {...entry, identity: identity.id, links: []};
  const searchText = readFileSync(filePath(store, entry.relativePath), "utf8");
  const links = extractLinks(searchText).map((link) => ({...link, resolution: resolveLink(link, filePaths, entry.relativePath)}));
  return {...entry, identity: identity.id, links, searchText};
}

export function buildVaultIndex(store: VaultStore): VaultIndex {
  const snapshot = snapshotVault(store.root);
  const identities = assignIdentities(store, snapshot.entries);
  const filePaths = snapshot.entries.filter((entry) => entry.kind === "file").map((entry) => entry.relativePath);
  const files = snapshot.entries.map((entry, index) => indexEntry(store, entry, identities[index]!, filePaths));
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
  const previous = loadVaultIdentities(store)?.identities ?? [];
  const now = new Date().toISOString();
  saveVaultIdentities(store, index.files.flatMap((file) => file.identity ? [{id: file.identity, relativePath: file.relativePath, sha256: file.sha256, firstSeenAt: previous.find((identity) => identity.id === file.identity)?.firstSeenAt ?? now, lastSeenAt: now}] : []));
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
