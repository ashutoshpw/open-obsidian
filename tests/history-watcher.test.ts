import {expect, test} from "bun:test";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {historyRecords, planHistoryRetention, type HistoryRecord} from "../src/core/history.js";
import {reconcileVault, watchVault} from "../src/core/watcher.js";
import {snapshotVault, VaultStore} from "../src/core/vault.js";

function record(id: string, capturedAt: string, bytes: number, kind: HistoryRecord["kind"] = "recovery"): HistoryRecord {
  return {id, relativePath: `${id}.md`, revision: id, bytes, path: `/recovery/${id}`, capturedAt, kind};
}

test("history retention plans age and byte pruning without deleting protected conflicts", () => {
  const now = new Date("2026-09-10T00:00:00Z");
  const plan = planHistoryRetention([
    record("new", "2026-09-09T00:00:00Z", 4),
    record("old", "2026-08-01T00:00:00Z", 4),
    record("conflict", "2026-01-01T00:00:00Z", 20, "conflict"),
  ], now, {maxAgeDays: 30, maxBytes: 5});

  expect(plan.retained.map((entry) => entry.id)).toEqual(["new", "conflict"]);
  expect(plan.pruneable.map((entry) => entry.id)).toEqual(["old"]);
  expect(plan.protected.map((entry) => entry.id)).toEqual(["conflict"]);
  expect(plan.retainedBytes).toBe(24);
  expect(plan.pruneableBytes).toBe(4);
});

test("history records combine store recovery categories and reconciliation trusts a fresh snapshot", () => {
  const combined = historyRecords({recovery: [record("recovery", "2026-09-09T00:00:00Z", 3)], failed: [record("failed", "2026-09-09T01:00:00Z", 2, "failed")]});
  expect(combined.map((entry) => entry.kind)).toEqual(["recovery", "failed"]);

  const root = mkdtempSync(join(tmpdir(), "openobsidian-watcher-vault-"));
  try {
    writeFileSync(join(root, "note.md"), "before\n");
    const before = snapshotVault(root);
    const closeWatcher = watchVault(root, () => undefined);
    closeWatcher();
    writeFileSync(join(root, "note.md"), "external\n");
    const reconciliation = reconcileVault(before, root);
    expect(reconciliation.changed).toBe(true);
    expect(reconciliation.changedPaths).toEqual(["note.md"]);
    expect(new VaultStore(root, join(root, ".app-data")).scan().after.sha256).toBe(reconciliation.after.sha256);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
