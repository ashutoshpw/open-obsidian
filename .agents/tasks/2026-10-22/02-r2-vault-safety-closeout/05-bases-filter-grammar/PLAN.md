# 05 — Bases filter and expression grammar

**Rows:** C07.6, C07 (umbrella; closes only after tasks 01-05 and the exact-SHA gate).

## Goal
A bounded shared expression grammar for JSON and native YAML that matches the pinned reference on supported expressions and fails visibly, never silently, on the rest.

## Scope
- Root/global and per-view filters combined by AND; recursive `and`/`or`/`not`; comparisons, boolean/arithmetic operators, nested/bracket access, dates/durations, a bounded context-free built-in set.
- Formula dependency resolution: deterministic order, cycle reporting, formulas computed before filter, sort and group.
- Unknown syntax and plugin functions are visibly unsupported, never `null`. Unsupported filter nodes must not turn a view unfiltered; capture what Obsidian 1.14.4 renders (fails, excludes, or other) and match the row outcome.
- `this` presentation context is deferred to C07.9 (not in R2).
- C07 umbrella also needs: summaries, row sorting, core view types/layouts, unavailable plugin view types as visible issues.

## Design
- Existing: `crates/engine/src/bases.rs` (`evaluate_base`, `parse_embedded_bases`), `crates/doc/src/bases.rs`, `fixtures/c07-unsupported-formula.json`, `c07-embedded-base-evaluation.json`, `c07-base-vault-evaluation.json`. Check what grammar the current evaluator already implements before designing; the 1451-line engine file may already cover part of this.
- `docs/architecture/bases.md` exists only on the wip branch; port or rewrite it as the grammar spec.
- Coordinate: comparisons use task 01, file property access uses task 02, Kanban group fixture uses task 04.

## Steps
1. Inventory current grammar support vs the Obsidian syntax doc; write the supported-set table.
2. Reference capture for unsupported-filter behavior and dependency chains/cycles.
3. Implement/extend parser and dependency resolver; property tests for no-panic on malformed input.
4. Differential fixtures for representative expressions; wire into the three-OS reference workflow.
5. Run the C07 umbrella checklist and update the row only if every child passes.

## Acceptance / CI evidence
- Exact-SHA three-OS evidence; unsupported-expression issues listed per fixture.

## Risks
Function coverage is open-ended; the "bounded set" must be enumerated and frozen in `decisions.md` so full parity is claimed only against it.
