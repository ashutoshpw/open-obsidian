# 04 — Bases groupOrder parity

**Rows:** C07.3 (child of C07).

## Goal
Parse and apply `groupOrder` exactly as pinned Obsidian 1.14.4 does, including typed identity, null/empty groups and formula-derived Kanban grouping.

## Scope
- Parse from JSON and native YAML as an ordered list of typed values (including `null` and an empty list); emit only listed groups in declared order; keep distinct typed values separate; preserve explicitly listed empty groups; include missing-value rows only if `null` is listed; row order within groups preserved. Absent `groupOrder` keeps C07.2 `groupBy.direction` or first-seen order.
- Characterize against the reference: groupOrder without groupBy, duplicates, missing vs explicit-null labels, string/number/boolean/array/object/null identity and labels, malformed shapes (visible issue plus reference fallback).
- Shared Kanban fixture: formula A depends on formula B, `groupBy` the derived formula, `groupOrder` lists its output values.

## Design
- No `groupOrder` handling exists at HEAD (`grep groupOrder crates/*/src` is empty). Prior work: `wip/c07-combined-2400e57` implements it in `crates/doc/src/bases.rs` and `crates/engine/src/bases.rs`; port it, keeping its tests.
- Fixtures: `fixtures/c07-group-order-reference.json` (exists), `fixtures/c07-bases.json`. Numeric identity depends on task 01; formula evaluation order depends on task 05, so the Kanban fixture lands last.
- Preserve source bytes and unknown fields via `encode_base`.

## Steps
1. Capture reference outcomes for each characterization case (first open and reopen, 3 OSes); record any pinned-app source rewrite.
2. Port the wip parser and grouping onto HEAD; unit tests per case.
3. Integrate number identity from task 01.
4. Add the formula-derived Kanban fixture after task 05's dependency resolver.

## Acceptance / CI evidence
- Headings and row membership match the reference on all three OSes; evidence names the exact SHA.

## Risks
Reference quirks may contradict the spec text (documented behavior vs observed); the observed result wins and is recorded as such. Kanban support in 1.14.4 may differ per view type.
