# Epic: R3 — native workspace and core workflows

Phase R3 of the Rust migration (`.agents/tasks/2026-10-07/goal.md` line 126): *port the editor and workspace contracts, previews, indices/navigation, graph/Canvas/Bases, keyboard/accessibility and multiwindow behavior.*
Exit criteria: egui interaction/snapshot (kittest) checks plus end-to-end synthetic-vault workflows pass in CI; editing and persistence agree with fixtures; layer checks and cancellable work units are enforced (MIG-006).

Rules inherited from the migration: CI-only validation (no local cargo claims), exact-SHA evidence under `.agents/tasks/2026-10-07/evidence/`, rows move to `passing` in `requirements.json` only with evidence paths, no silent scope reduction. Historical Electron passes are not Rust acceptance evidence.

## Rows (18, `migration_phase == "R3"`)
D03, GATE-005, PROD-007, PROD-010, C05, C05.1, C07.7, C07.8, C07.9, C10, C10.1, UX-001..UX-005, Q-006, MIG-006. All currently `pending`. Note: PROD-010 also names extension and recovery journeys, which finish only after R4 (plugins) — R3 owns the organization and Canvas halves; record the remainder as blocked-on-R4, not passed.

## Starting point (verified 2026-10-22, branch `integrate/r3-foundation` @ c7c5f02)
- `crates/engine/src/index.rs`: `VaultIndex::{build, note, notes, backlinks, outgoing_links, tag_counts, notes_with_tag, graph, local_graph, search, quick_switcher}`; pure and in-memory, built from vault reads. Not yet wired to any UI.
- `crates/engine/src/lib.rs`: `VaultSession::{read, read_preview, write, create_note, create_folder, trash_note, read_conflict}`; `crates/vault`: revision-checked `VaultWriteRequest { expected_revision_sha256 }`, `trash.rs` (`.trash`), `rename_transaction.rs` (`apply_rename_preview`), `watcher.rs` (`poll`), `history.rs`.
- `crates/doc`: `bases.rs` (`parse_base`, `evaluate_base`, `evaluate_base_by_view_index`), `canvas.rs` (`parse_canvas`, `edit_text_node`, `encode_canvas`), `hotkeys.rs` (`parse_hotkeys_settings`), `render_property_edit`, `markdown_preview.rs`.
- `crates/ui-egui/src/lib.rs` (~19k lines, flat `OpenObsidianApp`, inspector with 16 KiB source-preview cap and one global preview) with kittest tests that must stay green. The UI agent is concurrently adding `crates/ui-egui/src/workspace/` (explorer, tabs, palette, commands, panes, `WorkspaceBackend` trait); it did **not exist in the tree when this plan was written** — tasks below say "workspace module" and must be re-checked against what lands.
- Not present: any editor, nav history, graph/canvas/Bases rendering, ron persistence, templates, daily notes, popouts, latency benchmark, `xtask` layer check (xtask exists; contents unverified).

## Key decisions to record in `decisions.md` before coding
1. **Additive workspace:** new `workspace/` module owns layout/tabs/panes; the legacy inspector becomes one pane and keeps its tests untouched. No refactor of the 19k-line file inside R3 tasks.
2. **UI talks only to `WorkspaceBackend`** (trait over `VaultSession` + `VaultIndex`); kittest uses a fake backend, e2e uses a real temp-vault backend.
3. **Editor never edits from a preview:** edit requires a full-file read; save is revision-checked; stale revision opens a conflict/reload choice, never overwrites.
4. **Derived state is rebuildable:** index, graph layout, workspace.ron are caches; vault bytes stay authoritative; viewing creates no vault files (C05.1).
5. **Live preview is honest:** a labelled source-with-decorations mode, not a claim of full Obsidian parity; unsupported syntax is shown as source (reuse `MarkdownUnsupportedSyntax`).
6. Heavy work (index build, search, graph layout, base evaluation) runs on cancellable background units, never on the UI thread.

## Task order and dependencies
| # | Task | Depends on |
|---|------|-----------|
| 01 | workspace-shell-persistence | UI agent's `workspace/` landing |
| 02 | editor-save-live-preview | 01 |
| 03 | index-panes | 01 (parallel with 02) |
| 04 | file-operations-properties | 01, 03 |
| 05 | command-palette-hotkeys | 01 (commands registry) |
| 06 | graph-view | 03 |
| 07 | canvas-view | 01, 02 |
| 08 | bases-layouts | 03, 01 |
| 09 | core-workflows-popouts | 02, 04, 05 |
| 10 | accessibility-locale | 02, 05 (audit grows as surfaces land) |
| 11 | latency-layering-gates | 02, 03; finalizes last |

Critical path: 01 → 02 → 04/05 → 09 → 11. Tasks 06, 07, 08 can run in parallel agents once 03 and 01 are in. R4 task 06 (plugin UI surfaces) and 08 (themes) consume 01 and 05.
