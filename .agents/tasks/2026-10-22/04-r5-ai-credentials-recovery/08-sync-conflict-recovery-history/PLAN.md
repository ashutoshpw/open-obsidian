# 08 — External sync, conflicts and recovery history

**Rows:** D10, C13, Q-016 (recovery handoff text), DEL-001, DEL-003 (state/ownership bookkeeping).

## Goal
Compatibility with external sync tools and Git: external edits, renames/deletes and sync conflicts preserve versions and show explicit conflict state; history retention honors the frozen policy.

## Scope
- Port `planHistoryRetention`, `cleanupHistory`, `historyCapWarning` behavior from `src/core/history.ts` against existing `crates/vault/src/history.rs` (already has retention plan, cleanup, `read_conflict`, `resolve_conflict`) — verify parity and fill gaps rather than re-port.
- Port `syncToolDispositions` (`src/core/sync-tools.ts`) as data: known sync-tool conflict-file patterns recognized and surfaced.
- Fixtures: external edit during open note, rename/delete under sync, Git checkout, deep link without `obsidian://` hijack.
- Retention: 30 days / 5 GiB cap per contract; protected conflict records never pruned; cleanup runs only after user choice.
- Bookkeeping: update `state.json` checkpoints and the ownership map only with evidence (DEL-001/003).

## Design
- Mostly engine/vault tests; UI surfaces conflict banner and history browser in the R3 workspace. Watcher integration uses the R3.23 watcher events.

## Steps
1. Parity audit of `crates/vault/src/history.rs` vs legacy tests; add missing cases.
2. Sync-conflict pattern table and detection tests.
3. External-change fixture suite on 3 OSes.
4. History UI: list, preview, restore (via shared writer), cap warning.

## Acceptance / CI evidence
- Conflict versions always preserved byte-for-byte; retention plan tests with synthetic clocks; evidence JSON with per-fixture outcome.

## Risks
Sync tools differ in behavior and cannot be run in CI; coverage is fixture-simulated, and claims must say so.
