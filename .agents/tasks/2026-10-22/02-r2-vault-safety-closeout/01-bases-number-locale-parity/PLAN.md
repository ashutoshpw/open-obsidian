# 01 — Bases number and locale parity

**Rows:** C07.4 (child of C07).

## Goal
Reproduce observable Obsidian 1.14.4 comparison semantics for locale-sensitive text sorting and JavaScript numbers above 2^53, with captured reference evidence preceding Rust code.

## Scope
- Capture phase: all ten C07.4 scenarios, first open and reopen, Linux/macOS/Windows; 28 source checkpoints per OS, complete checkpoint matrices, `reopen_seed_hashes_match=true` after reseeding; source hashes and changed bytes reported without requiring Obsidian to keep its own rewrites.
- Tie handling per the row text: creation-order seed predicate strict on first open (all OSes) and Linux/Windows reopen; Mac reopen retains raw order with the exact 23-note set and two tie paths.
- Rust phase: JS Number conversion/equality/ordering, filtering, `contains`, grouping, observed locale/tie semantics. Unsupported behavior stays a visible issue.
- Out of scope: full filter grammar (task 05), groupOrder identity (task 04, but it consumes this task's number identity).

## Design
- Existing: `fixtures/c07-number-reference.json`, `fixtures/c07-bases.json`, `crates/doc/src/bases.rs` (`parse_base`, `evaluate_base` live in `crates/engine/src/bases.rs`), and the reference tooling `.agents/tasks/2026-10-07/audit-obsidian-reference-runtime.ts` plus `.github/workflows/obsidian-reference-feasibility.yml`. Verify what the fixture already records before adding scenarios.
- New: a `BaseNumber`/comparator module in `crates/engine/src/bases.rs` (or a sibling file) with an `f64` JS-semantics layer; no locale crate until the captured locale policy (runner default, frozen) shows what is needed. Uncertain: whether ICU-grade collation is required or a captured-order table suffices.

## Steps
1. Extend the reference workflow to emit the 28-checkpoint matrix; run and commit evidence (capture-only).
2. Reconcile the three OS results into `fixtures/c07-number-reference.json`; document divergences.
3. Implement number identity/ordering, then locale/tie sorting, behind fixtures generated from step 2.
4. Differential test in Rust CI: every fixture scenario matches the captured outcome.

## Acceptance / CI evidence
- Exact-SHA evidence JSON per OS for capture and for Rust parity, kept separate.
- Failed capture attempts retained in `evidence/`.

## Risks
macOS reopen tie-order instability; runner locale drift (freeze and record the locale). If a scenario cannot be reproduced deterministically it is recorded as an explicit exclusion, not rounded to "passing".
