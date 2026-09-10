import {readdirSync, watch, type FSWatcher} from "node:fs";
import {join, relative} from "node:path";
import {diffVaultSnapshots, snapshotVault, type VaultSnapshot} from "./vault.js";

export type VaultWatchHint = {event: "rename" | "change"; relativePath: string | null};
export type VaultReconciliation = {before: VaultSnapshot; after: VaultSnapshot; changed: boolean; changedPaths: string[]};

export function reconcileVault(before: VaultSnapshot, root: string): VaultReconciliation {
  const after = snapshotVault(root);
  const changedPaths = diffVaultSnapshots(before, after);
  return {before, after, changed: changedPaths.length > 0, changedPaths};
}

function directories(root: string): string[] {
  return [root, ...readdirSync(root, {withFileTypes: true}).filter((entry) => entry.isDirectory()).flatMap((entry) => directories(join(root, entry.name)))];
}

function watchDirectory(root: string, directory: string, onHint: (hint: VaultWatchHint) => void): FSWatcher {
  return watch(directory, (event, filename) => {
    const relativePath = filename ? relative(root, join(directory, filename.toString())).replaceAll("\\", "/") : null;
    onHint({event, relativePath});
  });
}

export function watchVault(root: string, onHint: (hint: VaultWatchHint) => void): () => void {
  try {
    const watcher = watch(root, {recursive: true}, (event, filename) => onHint({event, relativePath: filename ? filename.toString().replaceAll("\\", "/") : null}));
    return () => watcher.close();
  } catch {
    const watchers = directories(root).map((directory) => watchDirectory(root, directory, onHint));
    return () => watchers.forEach((watcher) => watcher.close());
  }
}
