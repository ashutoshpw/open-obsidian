# 11 — Benchmarks and test program

**Rows:** Q-005, Q-013.

## Goal
Record every named test layer with an executable or explicitly external disposition, and a startup benchmark harness whose pinned-hardware result is honestly external-pending.

## Scope
- Q-013 layers: parser/link differential, byte round trips, extension contracts, screenshots/traces, end-to-end, crash/disk/network faults, long-running resources, prompt-injection/exclusions, upgrade/downgrade, uninstall. Each maps to a CI job, a task in this epic, a later phase, or an external item; failed attempts are retained.
- Q-005: p95 at most 2 s (and p99 recorded) from start to an editable prior note on a 10k-note vault, without requiring full indexing first.

## Design
- Existing: `fixtures/performance-benchmark.json`, `quality-scorecard.json`, `comparison-scorecard.json`, `.github/workflows/quality.yml`, `rust.yml`; `crates/engine/src/index.rs` supports incremental indexing (check lazy-startup path).
- New: a benchmark binary or test (e.g. under `crates/testkit`) generating a 10k-note vault and timing "open vault, load last note, editable" on a hosted runner. Hosted-runner numbers are **diagnostic only**; Q-005 needs pinned hardware. Unless a self-hosted runner is added, Q-005 is recorded external-pending with the unblock condition.
- Q-013 disposition table: `fixtures/q-test-layers` data (check whether present; fixture id `q-test-layers`).

## Steps
1. Build the layer-to-evidence table after tasks 01-10 are scheduled; mark gaps.
2. Generate the 10k vault and the timing harness; run on all OSes for trend data.
3. Record p95/p99 plus indexing state in evidence; label non-pinned results.
4. Wire retention of failed attempts into the evidence index.

## Acceptance / CI evidence
- Q-013: table complete, no layer without a disposition. Q-005: harness plus evidence, row stays `pending` (external) without pinned hardware.

## Risks
Hosted-runner noise tempts premature "passing" claims; do not. Layers owned by R3-R5 (screenshots, extensions) are dispositioned as later-phase, not executed here.
