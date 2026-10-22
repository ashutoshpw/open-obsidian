# 07 — History retention, conflicts and fault injection

**Rows:** D16, SYNC-006, GATE-003, Q-004, RISK-005.

## Goal
30-day retention under a configurable 5 GiB cap that never auto-removes unresolved conflicts, with failure-injection proof that no content is lost without acknowledgment.

## Scope
- Retention and cap warnings; protected overflow warns and requires explicit user resolution before any cleanup.
- Conflict lifecycle: read, resolve, keep-both; interrupted-write and race/partial-sync recovery (external writers, watcher events).
- Failure-injection suite: crash mid-write, disk full, rename failure, partial sync file, concurrent external edit, each ending recoverable or explicitly acknowledged.
- D16's OS-encryption status half is reported by task 10 (SYNC-007).

## Design
- Existing: `crates/vault/src/history.rs` (`plan_history_retention`, `history_retention_plan`, `cleanup_history`, `read_conflict`, `resolve_conflict`, `VaultHistoryPolicy`), `write_recovery.rs` (`recover_pending_writes`), `rename_transaction.rs`, `watcher.rs`, `crates/doc/src/merge.rs`; fixtures `history-retention.json`, `sync-*.json`, `vault-safety-failure-matrix.json`, `vault-safety.json`.
- Much of this exists already (22 R2 rows pass); first audit where each failure-matrix cell lacks a test. UI warning for protected overflow is in `crates/ui-egui` (confirm it exists; uncertain).
- Fault injection hooks: prefer an injectable filesystem seam in `crates/vault`; check whether one exists before adding (new if absent).

## Steps
1. Map every `vault-safety-failure-matrix.json` cell to a test or gap.
2. Fill gaps: protected-conflict overflow, configurable cap, cleanup requiring explicit action.
3. Add race/partial-sync fixtures for RISK-005 with explicit support dispositions.
4. Three-OS run with preserved-version assertions.

## Acceptance / CI evidence
- Matrix report listing every injected fault, outcome and recovered artifact; protected conflicts byte-identical afterwards.

## Risks
Platform-specific atomic-rename and fsync behavior (Windows locking) can make some faults non-injectable; record as external-pending with reason, not as passing.
