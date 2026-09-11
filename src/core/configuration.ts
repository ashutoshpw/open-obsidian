import {createHash} from "node:crypto";
import {existsSync, lstatSync, readdirSync, readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {parseAppearanceSettings, parseThemeStylesheet, type AppearanceSettings, type ThemeStyleAnalysis, type ThemeStyleKind} from "../shared/ui/index.js";

export type VaultStyle = {
  relativePath: string;
  kind: ThemeStyleKind;
  bytes: Uint8Array;
  sha256: string;
  analysis: ThemeStyleAnalysis;
};

export type VaultConfiguration = {
  root: string;
  folders: string[];
  json: Record<string, Record<string, unknown>>;
  appearance: Record<string, AppearanceSettings>;
  styles: VaultStyle[];
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

function styleFiles(folder: string, folderPath: string): VaultStyle[] {
  const styles: VaultStyle[] = [];
  for (const [directory, kind] of [["themes", "theme"], ["snippets", "snippet"]] as const) {
    const directoryPath = join(folderPath, directory);
    if (!existsSync(directoryPath) || !lstatSync(directoryPath).isDirectory()) continue;
    for (const entry of readdirSync(directoryPath, {withFileTypes: true}).filter((candidate) => candidate.isFile() && candidate.name.toLowerCase().endsWith(".css"))) {
      const path = join(directoryPath, entry.name);
      const bytes = new Uint8Array(readFileSync(path));
      styles.push({
        relativePath: `${folder}/${directory}/${entry.name}`,
        kind,
        bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        analysis: parseThemeStylesheet(new TextDecoder().decode(bytes)),
      });
    }
  }
  return styles.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function discoverVaultConfiguration(root: string): VaultConfiguration {
  const resolvedRoot = resolve(root);
  const folders = readdirSync(resolvedRoot, {withFileTypes: true})
    .filter((entry) => entry.isDirectory() && configurationFolder(entry.name))
    .map((entry) => entry.name)
    .sort();
  const json: Record<string, Record<string, unknown>> = {};
  const appearance: Record<string, AppearanceSettings> = {};
  const styles: VaultStyle[] = [];
  for (const folder of folders) {
    const folderPath = join(resolvedRoot, folder);
    for (const entry of readdirSync(folderPath, {withFileTypes: true}).filter((entry) => entry.isFile() && entry.name.endsWith(".json"))) {
      const relativePath = `${folder}/${entry.name}`;
      const parsed = jsonFile(join(folderPath, entry.name));
      if (parsed) {
        json[relativePath] = parsed;
        if (entry.name === "appearance.json") appearance[relativePath] = parseAppearanceSettings(parsed);
      }
    }
    styles.push(...styleFiles(folder, folderPath));
  }
  return {root: resolvedRoot, folders, json, appearance, styles};
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
