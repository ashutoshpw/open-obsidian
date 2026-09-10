import {existsSync, lstatSync, readdirSync, readFileSync} from "node:fs";
import {join, resolve} from "node:path";

export type VaultConfiguration = {
  root: string;
  folders: string[];
  json: Record<string, Record<string, unknown>>;
};

function configurationFolder(name: string): boolean {
  return name === ".obsidian" || name.startsWith(".obsidian-");
}

function jsonFile(path: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function discoverVaultConfiguration(root: string): VaultConfiguration {
  const resolvedRoot = resolve(root);
  const folders = readdirSync(resolvedRoot, {withFileTypes: true})
    .filter((entry) => entry.isDirectory() && configurationFolder(entry.name))
    .map((entry) => entry.name)
    .sort();
  const json: Record<string, Record<string, unknown>> = {};
  for (const folder of folders) {
    const folderPath = join(resolvedRoot, folder);
    for (const entry of readdirSync(folderPath, {withFileTypes: true}).filter((entry) => entry.isFile() && entry.name.endsWith(".json"))) {
      const parsed = jsonFile(join(folderPath, entry.name));
      if (parsed) json[`${folder}/${entry.name}`] = parsed;
    }
  }
  return {root: resolvedRoot, folders, json};
}

export function hasExistingConfiguration(root: string): boolean {
  return readdirSync(resolve(root), {withFileTypes: true}).some((entry) => entry.isDirectory() && configurationFolder(entry.name));
}

export function configurationIsReadOnlyBeforeAfter(root: string, operation: () => VaultConfiguration): {before: VaultConfiguration; after: VaultConfiguration; unchanged: boolean} {
  const before = discoverVaultConfiguration(root);
  const result = operation();
  const after = discoverVaultConfiguration(root);
  return {before, after, unchanged: JSON.stringify(before) === JSON.stringify(after) && JSON.stringify(result) === JSON.stringify(before)};
}
