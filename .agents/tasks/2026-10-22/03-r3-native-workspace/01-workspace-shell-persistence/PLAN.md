# 01 — Workspace shell, persistence and first-run journey

**Rows:** UX-002, PROD-007, UX-001 (shell half), D03 (shell half).

## Goal
Make the new workspace module the app's main surface, restore it across restarts, and give a first-run path that ends in an editable existing note.

## Scope
- Mount `workspace/` (explorer, tabs, panes) in `OpenObsidianApp`; legacy inspector becomes a pane/tab.
- Persist layout, open tabs, active note, pane sizes, explorer expansion, recent vaults.
- First-run: pick vault -> scan with visible progress -> open an existing note in the editor; unsupported extensions listed non-blockingly; no sign-in anywhere.
- Non-modal state indicators (scan, dirty, watcher, conflict) in a status bar.

## Design
- Workspace state is `serde` + `ron` in app data (not the vault); version field, tolerant load (unknown/missing paths dropped with a notice, corrupt file -> defaults). `ron` is not a dependency yet (new, add to workspace `Cargo.toml`); `eframe` already enables `persistence`, so evaluate that first and record the choice.
- Obsidian's own `.obsidian/workspace.json` is read-only inspiration; do not write it in this task (decide separately if round-trip is wanted).
- Re-check the `WorkspaceBackend` trait the UI agent added before adding methods.

## Steps
1. Wire module into `OpenObsidianApp` behind the existing vault-open flow; keep old tests running.
2. State model + ron save/load + migration/corruption tests (pure unit tests).
3. Debounced save on change and on exit; restore on open with missing-file handling.
4. First-run flow + status bar; kittest journey: open vault -> scan -> note opens editable.

## Acceptance / CI evidence
- kittest restart fixture: state A saved, new app instance restores tabs/active note/layout (UX-002).
- First-run journey test against a synthetic vault, including a vault with unsupported extensions (PROD-007).
- Existing ui-egui kittest suite unchanged and green.

## Risks
- Concurrent edits to `lib.rs` with the UI agent: keep changes to a small mounting seam.
- Persisted paths from a vault that moved: key state by vault canonical root.
