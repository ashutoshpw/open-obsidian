# 07 — Chronicle (opt-in Git) workflows

**Rows:** PROD-004, PROD-006, C15, C15.1, D10 (Git half).

## Goal
Explicit, revision-aware, recoverable Git workflows for Chronicle vaults without making Git authoritative over Markdown/Canvas/Bases.

## Scope
- Port `inspectVaultGitState`, `chronicleChangedPaths`, `reviewChronicleChanges`/`reviewChronicleCommit`, `initializeChronicle`, `adoptChronicle`, `addChronicleRemote`, `chronicleDiff`, `chronicleHistory`, `commitChronicleSelection`, `restoreChronicleFile`, `pullChronicle`, `pushChronicle` from `src/core/chronicle.ts` (~246 lines).
- Commit only explicitly selected paths; preserve unrelated index state; never stage app-private data by default.
- Restore retains a journaled version of the current file first. No auto-push, no reset --hard, no force.

## Design
- `crates/engine/src/chronicle.rs` with a `GitRunner` trait (args -> exit/stdout); real runner shells out to the system `git` in the app crate (git2/gitoxide alternative is open; record the choice). Environment scrubbed; no credential prompts routed through app storage.
- Tests run against temp repos built in CI plus an injected fake runner for failure modes.

## Steps
1. State inspection (not-a-repo, dirty, detached, nested repo) fixtures.
2. Review/commit with selected-path semantics and index-preservation tests.
3. Restore with journal; pull/push explicit-confirm only; conflict outcomes surfaced, never auto-resolved.
4. UI panes in R3 workspace.

## Acceptance / CI evidence
- Standard and Chronicle end-to-end suites on 3 OSes; assertions that no test invokes push/reset without an explicit call; git missing is a clear unavailable state.

## Risks
Windows path/line-ending behavior and `git` availability on runners; autocrlf must not rewrite vault bytes.
