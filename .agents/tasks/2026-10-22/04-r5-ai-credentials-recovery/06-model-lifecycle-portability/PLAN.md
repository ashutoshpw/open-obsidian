# 06 — Local model lifecycle and portability

**Rows:** A08, D05 (local half), PROD-001 (portable AI additions), Q-008 (model memory split).

## Goal
Local model manifests with integrity/version checks, derivative deletion without touching notes, and portable conversation export that reference Obsidian can ignore safely.

## Scope
- Port `createLocalModelManifest`, `inspectLocalModel` (states missing/invalid/stale/offline/ready), `modelChangeRequiresReindex`, `derivativeDeletionPlan`, `exportPortableConversation` from `src/core/model-lifecycle.ts` (~88 lines).
- SHA-256 verification of model bytes; version change triggers reindex (task 02); offline behavior reported.
- AI state kept in the reserved portable-metadata namespace or app-data, **never injected into existing note frontmatter** (`config/launch-contract.json` `portable_metadata`).

## Design
- `crates/engine/src/ai/model.rs` pure planning; file hashing done by the caller. Model download/runtime engine selection is **out of scope and undecided**; this task covers manifest/lifecycle only.
- Deleting a derivative never removes a source note; excluded-source derivatives are scheduled for deletion.

## Steps
1. Manifest/inspection types and fixtures (tampered, stale, missing, offline).
2. Deletion plan and reindex trigger tests.
3. Portable export schema v1 + round-trip test: open vault in place, add AI artifacts, verify note bytes unchanged.

## Acceptance / CI evidence
- Lifecycle fixture matrix passes; byte-snapshot test shows notes untouched; the roundtrip against real Obsidian remains owned by the existing reference-vault handoff (external).

## Risks
Local inference runtime selection could dominate scope; keep it a seam and record deferral in `decisions.md`.
