# 11 — Latency benchmark, layering checks and cancellable work

**Rows:** Q-006, MIG-006, GATE-005 (R3 share).

## Goal
Frozen input-latency measurement and enforced architecture boundaries, so R3 cannot regress silently.

## Scope
- Q-006: benchmark recording input-latency distribution (p50/p95/p99) for a normal and a large-file fixture; compare to frozen thresholds; run in CI and publish JSON.
- MIG-006: layer checks (`doc`/`vault` do not depend on `engine`/`ui-egui`; `engine` does not depend on UI; `plugins` stays I/O-free) and cancellable work units for index build, search, graph layout, base evaluation.
- GATE-005: R3-measurable budgets (startup-to-editable, switcher response, search time); human-only benefit/accessibility checks stay external-pending.

## Design
- Check `xtask/src` for existing checks before adding (contents unverified); implement layer check there via `cargo metadata`, failing on forbidden edges.
- `CancelToken`/work-unit type in `crates/engine` (new), checked in loops; UI drops tokens on tab close or superseding query.
- Latency harness drives the kittest or headless path with a synthetic keystroke -> text-change timing; absolute headless numbers are not human latency, so label them as relative regression budgets and say so.
- Thresholds are frozen in a versioned file only after a baseline run on CI hardware; no invented numbers in this plan.

## Steps
1. Layer check + negative test (a deliberate forbidden edge fails).
2. Cancel token + retrofits to tasks 03/06/08 work units, with cancellation tests.
3. Benchmark harness + fixtures (normal, ~MB-scale file) + JSON output.
4. Baseline on CI, freeze thresholds, wire to `quality.yml`/`rust.yml`.

## Acceptance / CI evidence
- Layer check red on a violating fixture, green on main; cancellation observable within a bounded step.
- Latency JSON per OS under evidence directory, tied to exact SHA.

## Risks
- CI runner variance makes thresholds flaky; use wide budgets plus repeat-run policy. Starting this late risks retrofits, so land the token type early.
