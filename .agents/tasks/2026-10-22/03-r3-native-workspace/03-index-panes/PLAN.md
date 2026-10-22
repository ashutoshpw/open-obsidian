# 03 — Wire VaultIndex to panes: backlinks, outgoing, outline, tags, search, bookmarks

**Rows:** D03, C10 (search/navigation), UX-001, PROD-010 (organization).

## Goal
Surface the existing `VaultIndex` in workspace panes with legacy-matching behavior.

## Scope
- Panes: backlinks, outgoing links, outline (headings), tags (counts + notes), global search, quick switcher feed, bookmarks.
- Legacy behavior to match: search score = lowercase substring count + 1 for path match, sorted score desc then path; quick switcher with empty query lists first 30 `.md`; backlinks sorted by path then line, ambiguous links excluded; unresolved targets stay visible in outgoing links.
- Bookmarks: stored in `.obsidian/bookmarks.json` if the pinned format is documented in fixtures — unverified; confirm against fixtures before writing, else read-only.

## Design
- Existing: `VaultIndex::{backlinks, outgoing_links, tag_counts, notes_with_tag, search, quick_switcher}` and `IndexedHeading`. Behavior parity is likely already unit-tested in `index.rs`; add only missing tests.
- Backend keeps one `Arc<VaultIndex>` rebuilt on watcher hints on a background unit; panes show "indexing" state and stale-while-rebuilding results. Incremental update is a later optimization, not required here.
- Search results are capped (`limit`) and show snippets only if the index exposes them (`SearchHit` fields to verify).

## Steps
1. `WorkspaceBackend` methods + fake backend for kittest; real backend over `VaultIndex`.
2. Panes with click-to-open and heading jump.
3. Background rebuild on watcher events with cancellation (see task 11).
4. Bookmarks read (and write if verified).
5. Legacy-parity fixture: same synthetic vault through Electron-derived expectations (search ordering, backlinks, switcher).

## Acceptance / CI evidence
- Fixture-driven pane content tests; ordering tests; panes update after an external file change.
- Opening panes leaves the vault byte-identical.

## Risks
- Index memory/time on large vaults (task 11). Alias/ambiguity rules must come from fixtures, not guesses.
