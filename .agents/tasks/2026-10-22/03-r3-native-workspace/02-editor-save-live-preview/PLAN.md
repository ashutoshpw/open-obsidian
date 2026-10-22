# 02 — Editor: source, reading, live preview, save, navigation history

**Rows:** D03 (editor), C10 (edit/save/navigate), UX-001, PROD-010 (edit journey).

## Goal
A real note editor with revision-checked save, honest preview modes and back/forward history.

## Scope
- Open = full-file read via `VaultSession::read` (the 16 KiB `read_preview` cap is for the inspector only). Files over a stated size/binary/non-UTF-8 open read-only with the reason shown.
- Modes: source, reading (`doc::markdown_preview`), live preview. Per-tab dirty indicator, save (Ctrl/Cmd+S as in legacy `src/renderer/renderer.ts`), save-failed state.
- Stale revision: external change while dirty -> non-modal conflict bar (keep mine / reload / view diff), using watcher `poll` and `read_conflict`; never silent overwrite.
- Back/forward navigation history per workspace.

## Design
- Buffer holds `{path, base_revision_sha256, text, dirty}`; save builds `VaultWriteRequest { expected_revision_sha256: Some(base) }`; on success replace base with `VaultWriteResult.read` revision.
- Live preview v1 = source editing with decorated heading/emphasis/link spans and an explicit "Live preview (partial)" label listing unsupported constructs. Do not claim Obsidian parity; fixtures define what is supported.
- IME/RTL: use egui `TextEdit` and do not intercept composition events (see task 10).

## Steps
1. Buffer model + save/conflict state machine as pure code with unit tests.
2. Source editor widget, dirty/save UI, hotkey.
3. Reading and live-preview modes; unsupported-syntax disclosure.
4. Nav history + link follow (resolved, ambiguous, unresolved -> offer create via task 04).
5. External-change and stale-save kittest + synthetic-vault e2e.

## Acceptance / CI evidence
- Edit -> save -> bytes on disk match; stale save refused with journaled prior content intact; large-file fixture opens within documented behavior.
- kittest: dirty marker appears/clears, Ctrl+S saves, conflict bar shown on external edit.

## Risks
- Editor performance on large files (task 11 measures). Undo/redo scope and word-wrap choices are unverified; keep to egui `TextEdit` defaults first.
