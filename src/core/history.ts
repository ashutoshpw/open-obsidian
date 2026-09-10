import type {RecoveryRecord} from "./vault.js";

export type HistoryPolicy = {maxAgeDays: number; maxBytes: number};
export type HistoryRecord = RecoveryRecord & {kind: "recovery" | "failed" | "conflict"; protected?: boolean};
export type HistoryPlan = {retained: HistoryRecord[]; pruneable: HistoryRecord[]; protected: HistoryRecord[]; retainedBytes: number; pruneableBytes: number};

const defaultPolicy: HistoryPolicy = {maxAgeDays: 30, maxBytes: 5 * 1024 * 1024 * 1024};

function validPolicy(policy: HistoryPolicy): HistoryPolicy {
  if (!Number.isFinite(policy.maxAgeDays) || policy.maxAgeDays < 0) throw new Error("History maxAgeDays must be non-negative");
  if (!Number.isFinite(policy.maxBytes) || policy.maxBytes < 0) throw new Error("History maxBytes must be non-negative");
  return policy;
}

function isProtected(record: HistoryRecord): boolean {
  return record.kind === "conflict" || record.protected === true;
}

function isExpired(record: HistoryRecord, cutoff: number): boolean {
  return Date.parse(record.capturedAt) < cutoff;
}

export function planHistoryRetention(records: HistoryRecord[], now = new Date(), policy: HistoryPolicy = defaultPolicy): HistoryPlan {
  const selected = validPolicy(policy);
  const cutoff = now.getTime() - selected.maxAgeDays * 24 * 60 * 60 * 1000;
  const sorted = [...records].sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
  const retained: HistoryRecord[] = [];
  const pruneable: HistoryRecord[] = [];
  let retainedBytes = 0;
  for (const record of sorted) {
    const protectedRecord = isProtected(record);
    const withinBudget = retainedBytes + record.bytes <= selected.maxBytes;
    if (protectedRecord || (!isExpired(record, cutoff) && withinBudget)) {
      retained.push(record);
      retainedBytes += record.bytes;
    } else {
      pruneable.push(record);
    }
  }
  return {retained, pruneable, protected: retained.filter(isProtected), retainedBytes, pruneableBytes: pruneable.reduce((total, record) => total + record.bytes, 0)};
}

export function historyRecords(storeRecords: {recovery: RecoveryRecord[]; failed: RecoveryRecord[]}): HistoryRecord[] {
  return [
    ...storeRecords.recovery.map((record) => ({...record, kind: "recovery" as const})),
    ...storeRecords.failed.map((record) => ({...record, kind: "failed" as const})),
  ];
}
