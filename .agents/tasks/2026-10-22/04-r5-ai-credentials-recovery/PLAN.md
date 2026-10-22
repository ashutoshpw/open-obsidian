# Epic: R5 — AI, credentials and recovery workflows

Phase R5 of the Rust migration (`.agents/tasks/2026-10-07/goal.md` line 128): *port retrieval, providers/model lifecycle, context controls, changeset approval, native credential handling, Chronicle/sync and portability.*
Exit criteria: provider mocks, exclusion/privacy, stale-write rejection, undo/recovery, credential failures/migration and synthetic portability workflows pass in CI **without real secrets or personal vaults**. Live managed inference, provider terms and human pilots stay external-pending (R7).

Starts after R4 task 02 (capability broker) exists; R5 plugs AI into the same preview broker. Rules inherited: CI-only validation, exact-SHA evidence under `.agents/tasks/2026-10-07/evidence/`, rows move to `passing` only with evidence paths.

## Starting point (verified 2026-10-22)
- Legacy behavior lives in `src/core/{providers,retrieval,ai-changes,privacy,model-lifecycle,chronicle,history,credentials,sync-tools,storage-protection}.ts` (~1800 lines) plus `src/electron/provider-credentials.ts` (Electron `safeStorage`). These are the port references; behavior is pinned by their tests.
- `crates/platform/src/lib.rs` defines the `CredentialStore` trait (get/set/delete/`delete_all_for_application`) and `CredentialStoreError`, but **no OS-backed implementation exists** (new). `user_data.rs` has `cleanup_user_data`; `storage_protection.rs` reports protection status.
- `crates/vault/src/history.rs` has `plan_history_retention`, `history_records`, `cleanup_history`, `read_conflict`, `resolve_conflict`. `crates/engine/src/index.rs` is the in-memory vault index (search, links). No retrieval, provider, AI or Chronicle code exists in Rust (all new).
- Requirement rows: 37 in R5 (D05/D07/D10/D13/D17, PROD-001/004/006/008/009, C13, C15/C15.1, A01–A08 incl. .1, AI-001..004, Q-007/008/009/015/016, DEL-001/003, RISK-006/007, MIG-009).

## Key decisions to record in `decisions.md` before coding
1. **Three explicit modes, no silent fallback:** managed (typed OpenRouter-proxy client seam; no billing, no hosted service), BYOK, local. Selection is user state; a failing mode reports an error, never switches mode.
2. **AI never silently uploads note content.** Every request is built from a visible, user-confirmable context set after exclusions; destination shown before send.
3. **All AI file changes use the plugin path:** `ProposedChange` -> preview -> `VaultSession` revision-checked journaled write (R4 task 02). No AI-specific writer.
4. **Credentials only in the OS keychain** via `crates/platform`; never in vault, app-data JSON, logs, plugin or renderer storage. Missing keychain is a visible unavailable state, not plaintext fallback.
5. **Chronicle is opt-in Git:** every Git mutation is explicit; no auto-push, no destructive reset; app-private data never staged by default.

## Task order and dependencies
| # | Task | Depends on |
|---|------|-----------|
| 01 | native-credential-store | R2 platform crate |
| 02 | retrieval-index-grounding | R3 engine index |
| 03 | provider-modes-and-seam | 01, 02 |
| 04 | privacy-context-controls | 02, 03 |
| 05 | ai-changeset-approval | 03, 04, R4 02 |
| 06 | model-lifecycle-portability | 02, 03 |
| 07 | chronicle-git-workflows | R3 file ops (parallel with 02–06) |
| 08 | sync-conflict-recovery-history | 07, R3 watcher |

Critical path 01 -> 03 -> 04 -> 05. Tasks 07/08 are independent of AI and can run in parallel.
