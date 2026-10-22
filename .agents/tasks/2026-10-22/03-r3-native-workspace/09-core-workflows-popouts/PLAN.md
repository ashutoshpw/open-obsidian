# 09 — Core workflows: templates, daily notes, history pane, popouts

**Rows:** C10, C10.1 (popout half), PROD-010 (recovery: preserved versions), D03.

## Goal
Complete the C10 workflow list with a test disposition for each item, and add multi-window support.

## Scope
- First step: enumerate the C10 workflow list from `requirements.json`/legacy app into a checklist in this folder, each marked automated test, manual, or not-planned-with-reason. Everything below is a candidate until that list is read.
- Templates (insert into note; variable set from legacy/fixtures), daily notes (folder/format from `.obsidian/daily-notes.json`, create-if-missing with preview), history pane (`VaultSession` history records, `read_conflict`, restore with preview), popouts (note in a second native window).

## Design
- Popouts: egui multi-viewport (`ctx.show_viewport_*`) if supported by eframe 0.36 on all CI platforms — verify; each popout shares the backend and revision-checked buffers, so two windows on one note see one dirty state.
- History restore goes through the normal revision-checked write path; prior content stays preserved.
- Templater-like automation belongs to R4 plugins, not here.

## Steps
1. Build the workflow checklist and fixtures.
2. Templates + daily notes using task 04 file ops.
3. History pane over `history_records` with preview and restore.
4. Popout viewport, shared buffer, close/dirty behavior; kittest where viewports allow, else explicit external-pending.
5. End-to-end keyboard journey across the checklist.

## Acceptance / CI evidence
- Per-workflow test or documented disposition; keyboard-only e2e passes; restore keeps prior version.
- Popout edit visible in main window; closing dirty popout prompts.

## Risks
- kittest may not drive secondary viewports; record any such gap as external-pending, not passing.
