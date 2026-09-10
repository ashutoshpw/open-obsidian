import {readdirSync, watch, type FSWatcher} from "node:fs";
import {join, relative} from "node:path";
import {diffVaultSnapshots, snapshotVault, type VaultSnapshot} from "./vault.js";

export type VaultWatchHint = {event: "rename" | "change"; relativePath: string | null};
export type VaultWatchRescan = {event: "rescan"; relativePath: null; reason: "overflow" | "sleep" | "reconnect" | "manual"; changedPaths: string[]};
export type VaultWatchEvent = VaultWatchHint | VaultWatchRescan;
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

export type VaultWatcher = {
  close: () => void;
  rescan: (reason?: VaultWatchRescan["reason"]) => VaultReconciliation;
  snapshot: () => VaultSnapshot;
};

export function createVaultWatcher(root: string, onEvent: (event: VaultWatchEvent) => void): VaultWatcher {
  let current = snapshotVault(root);
  let closed = false;
  let watchers: FSWatcher[] = [];

  const closeWatchers = (): void => {
    watchers.forEach((watcher) => watcher.close());
    watchers = [];
  };

  const rescan = (reason: VaultWatchRescan["reason"] = "manual"): VaultReconciliation => {
    if (closed) return {before: current, after: current, changed: false, changedPaths: []};
    const result = reconcileVault(current, root);
    current = result.after;
    onEvent({event: "rescan", relativePath: null, reason, changedPaths: result.changedPaths});
    return result;
  };

  const handleHint = (hint: VaultWatchHint): void => onEvent(hint);
  const handleError = (): void => {
    try {
      rescan("overflow");
    } catch {
      onEvent({event: "rescan", relativePath: null, reason: "overflow", changedPaths: []});
    }
  };

  try {
    const watcher = watch(root, {recursive: true}, (event, filename) => handleHint({event, relativePath: filename ? filename.toString().replaceAll("\\", "/") : null}));
    watcher.on("error", handleError);
    watchers = [watcher];
  } catch {
    watchers = directories(root).map((directory) => {
      const watcher = watchDirectory(root, directory, handleHint);
      watcher.on("error", handleError);
      return watcher;
    });
  }

  return {
    close: () => {
      if (closed) return;
      closed = true;
      closeWatchers();
    },
    rescan,
    snapshot: () => current,
  };
}

export function watchVault(root: string, onHint: (hint: VaultWatchHint) => void): () => void {
  const watcher = createVaultWatcher(root, (event) => {
    if (event.event === "rename" || event.event === "change") onHint(event);
  });
  return watcher.close;
}

export function watchVaultWithRecovery(root: string, onEvent: (event: VaultWatchEvent) => void): VaultWatcher {
  return createVaultWatcher(root, onEvent);
}
