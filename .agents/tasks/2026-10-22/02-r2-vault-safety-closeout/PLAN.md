# Epic: R2 — vault and document safety closeout

Phase R2 of the Rust migration (`.agents/tasks/2026-10-07/goal.md` line 125): *port source-preserving document models, revision hashing, scoped IO, transactions, journal/recovery, attachments, history, watcher and rename/merge behavior.*
Exit criteria: Rust fixture/differential, property and failure-injection suites cover the existing safety cases on all three OSes; unchanged bytes and recovered files are verified. This epic closes the **26 R2 rows still `pending`** in `requirements.json` (22 R2 rows are already `passing`).

Rules inherited from the migration: CI-only validation (no local cargo claims), exact-SHA evidence under `.agents/tasks/2026-10-07/evidence/`, rows move to `passing` only with evidence paths, no silent scope reduction. Decisions already taken by the user: Bases target is **full pinned Obsidian 1.14.4 reference parity**; Chronicle (D21) and all SYNC rows are in scope; Q-005 needs pinned hardware and is recorded **external-pending** unless a self-hosted runner is added; SYNC-007's uninstaller wiring is carried to R6.

## Starting point (verified 2026-10-22)
- Branch `integrate/r3-foundation` (HEAD `c7c5f02`), merge-base with `origin/main` is `3182aea`. Present: `crates/vault` (`history.rs`, `write_recovery.rs`, `configuration.rs`, `trash.rs`, `rename_transaction.rs`, `watcher.rs`), `crates/doc` (`bases.rs`, `canvas.rs`, `configuration.rs`, `themes.rs`), `crates/engine` (`bases.rs`, `index.rs`), `crates/platform/src/storage_protection.rs`, `crates/testkit`.
- **Prior work, not yet integrated:** local branch `wip/c07-combined-2400e57` (one commit, "R2.8.131 combined C07.5 inventory, C09.2 style discovery and C07.3 groupOrder work"; same tip as the stale local `main`). It is **not an ancestor of HEAD** and diverges heavily (about 109 files; it predates the R3 work on `ui-egui` and `origin/main` has since moved on). It also adds `docs/architecture/bases.md` and `docs/architecture/native-appearance.md`, which do not exist at HEAD. Treat it as source material to **rebase/port by hand per task** (tasks 02, 03, 04), not to merge wholesale. `grep groupOrder crates/*/src` is empty at HEAD, so C07.3 has no code here yet.
- Existing evidence: C01.2 pinned-Obsidian round trip passed on 3 OSes at SHA `f396927` (`c01.2-reference-roundtrip-matrix.md`); the row stays pending for remaining read-only flows.
- Fixtures already in `fixtures/`: `c07-*.json`, `c06-*.json`, `history-retention.json`, `vault-safety*.json`, `sync-*.json`, `uninstall-preservation.json`, `exit-portability.json`, `performance-benchmark.json`, `configuration-inventory.json`. Whether each is complete enough for its row is checked per task, not assumed.

## Key decisions to record in `decisions.md` before coding
1. **Capture before implement for Bases:** pinned Obsidian 1.14.4 behavior is captured in CI (all three OSes, first open and reopen) and reconciled before any Rust comparator/grouping/filter code claims parity; capture-only results never count as Rust parity.
2. **Bounded, read-only vault walks:** one no-symlink inventory with explicit caps feeds Bases, configuration discovery and index; any reached cap sets `complete=false`, never a silent truncation.
3. **No automatic destruction:** history cleanup and conflict removal always require an explicit user action; unresolved conflicts are protected even over the 5 GiB cap.
4. **Chronicle is Standard plus explicit Git actions:** opening/scanning never stages, commits, contacts a remote or initializes Git.
5. **External-pending is a legitimate disposition** (Q-005 hardware, SYNC-007 installer wiring in R6), recorded with owner and unblock condition, never `passing`.

## Task order and dependencies
| # | Task | Rows | Depends on |
|---|------|------|-----------|
| 01 | bases-number-locale-parity | C07.4 | none (capture workflow first) |
| 02 | bases-file-inventory | C07.5 | wip rebase |
| 03 | configuration-discovery | C09, C09.1 (discovery half) | wip rebase (C09.2) |
| 04 | bases-group-order | C07.3 | 01, 02 |
| 05 | bases-filter-grammar | C07.6, C07 | 01, 02, 04 |
| 06 | canvas-reference-roundtrip | C06, C01, C01.2, GATE-001, Q-001, Q-002 | none |
| 07 | history-retention-conflicts | D16, SYNC-006, GATE-003, Q-004, RISK-005 | none |
| 08 | chronicle-standard-vault | PROD-003, PROD-005, D21 | 06 (snapshot harness) |
| 09 | portability-export | C14 | 06 |
| 10 | sync-matrix-uninstall | SYNC-005, SYNC-007 | 07 |
| 11 | benchmarks-test-program | Q-005, Q-013 | all (collects dispositions) |

Critical path: 01 → 04 → 05. Tasks 02/03, 06, 07 start in parallel. C09.1's enablement half is owned by R4 task 02 (`01-r4-extensions-appearance/02-capability-broker-d15`); R2 only proves discovery never writes. C07 closes only after 01–05 and its exact-SHA gate pass.
