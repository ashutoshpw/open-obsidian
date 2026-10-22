# 02 — Retrieval, indexing and grounded answers

**Rows:** A01, A01.1, A02, A02.1, D05 (retrieval half), PROD-008, Q-007, Q-008, Q-009 (retrieval half), RISK-006 (cross-vault half).

## Goal
Port scoped hybrid retrieval (keyword + optional vector) with incremental progress, exclusion enforcement and citations that open the exact source revision.

## Scope
- Port `retrieveVault` / `retrieveVaultWithModel` and `DEFAULT_RETRIEVAL_EXCLUSIONS` (`.obsidian`, `.git`, `.trash`) from `src/core/retrieval.ts` (~526 lines).
- Deterministic keyword fallback; a deterministic embedding model for tests (`DETERMINISTIC_EMBEDDING_MODEL` analogue).
- Incremental indexing on edit/delete with observable progress; cancellation.
- Citation record: path, heading/block, revision; inference, missing-evidence and conflict labels. Scope is one vault; never another.

## Design
- `crates/engine/src/retrieval/` over the existing `crates/engine/src/index.rs`; pure and synchronous core, executor supplied by the app. Derived indexes live in vault app-data (`prepare_vault_app_data`), never in the vault.
- Exclusion filter is applied **before** tokenizing/embedding, so excluded text is never in any index.
- Model output is a trait seam (task 03 fills it); this task uses mocks only.

## Steps
1. Scope/exclusion types and golden fixtures ported from legacy tests.
2. Keyword index + deterministic fallback; progress events.
3. Vector index behind trait; reindex triggers (task 06 supplies model version changes).
4. Citation resolver and source-inspector data (UI in R3 panes).
5. Benchmarks for search/watcher latency and resource distribution by vault size; grounding evaluation harness (claim accuracy, citation correctness, leak = 0) as an `xtask`/test command.

## Acceptance / CI evidence
- Fixtures show excluded-file canaries never appear in indexes, prompts or results; stale-revision citations are flagged; benchmark JSON per OS (budgets from Q-007 are read from the frozen contract, not invented here).

## Risks
Frozen latency budgets and available runner hardware may disagree; record measured distributions and mark budget status per platform rather than weakening budgets.
