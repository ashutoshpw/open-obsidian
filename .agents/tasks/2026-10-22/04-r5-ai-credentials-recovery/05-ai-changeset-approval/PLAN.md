# 05 — AI changesets, approval, undo and recovery

**Rows:** A03, A04, PROD-009, D05 (reviewed-changes half), C13 (stale-write half).

## Goal
Every AI write is a per-file, per-hunk reviewable changeset validated against disk revision, applied via the shared writer, and undoable.

## Scope
- Port `draftLocalAIChange`, `applyAIChangeSet`, `undoAIChange`, `organizationSuggestions`, `AIChangeError` from `src/core/ai-changes.ts` (~277 lines).
- Changeset = list of `ProposedChange` (R4 02) with expected revisions; accept/reject per file and hunk; create/rename/trash suggestions individually approved.
- Undo through journaled history (`crates/vault/src/history.rs`); stale revision refuses apply and offers re-draft.
- Formula/code execution in suggestions is denied (A04).

## Design
- Reuse `ProposedChange` and its engine adapter; **no second writer**. `crates/engine/src/ai/changes.rs` only builds drafts and hunk selection. Preview diff view shares the R4 plugin preview component.
- Provider output is parsed defensively (size caps, path normalization through existing confinement checks).

## Steps
1. Draft parser/validator with hostile-output fixtures (traversal, `.obsidian`, oversize).
2. Hunk selection and partial-apply semantics (documented: partial apply produces one new revision).
3. Stale-write, interrupted-apply and undo tests using the vault journal.
4. Organization-suggestion previews.

## Acceptance / CI evidence
- Vault byte snapshots unchanged for rejected/stale changes; undo restores bytes; evidence lists each fixture outcome on 3 OSes.

## Risks
Hunk-level apply may not map cleanly to the writer's whole-file revision model; if so keep v1 per-file only and mark the per-hunk half of PROD-009 honestly `failing` until resolved.
