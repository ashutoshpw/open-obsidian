# Epic: R7 — completion evidence

Phase R7 of the Rust migration (`.agents/tasks/2026-10-07/goal.md` line 130): *retire shipped Electron/renderer and obsolete tooling after coverage replacement; update README, contracts, status and all related documentation; audit for stale Electron instructions; produce final feature matrix and release handoff.*
Exit criteria: full applicable Rust CI passes for the final implementation SHA; every mandatory migration row is satisfied or meets authorized D15 evidence rules; documentation matches shipped behavior and stale instructions are removed or clearly historical; remaining external work is explicit.

Starts after R6 closes. Rules inherited: CI-only validation, exact-SHA evidence, no silent scope reduction, rows never marked `passing` without evidence.

## Starting point (verified 2026-10-22)
- Electron app, renderer and TS tooling still present: `src/{core,electron,plugins,renderer,shared}`, `scripts/*.ts` (~50 files), root `package.json` with `electron`, `electron-builder`, `knip`, `bun.lock`, `tsconfig.json`, `knip.json`, `script/build_and_run.sh`, workflows `quality.yml`, `plugin-*.yml`, `compatibility-pins.yml`.
- Docs: `README.md`, `release-handoff.md`, `PRIVACY.md`, `docs/architecture/{legacy-plugin-runtime,markdown-preview}.md`, `config/launch-contract.json` (still says `"runtime": "Electron"`, `certification_status: not_started`).
- `.agents/tasks/2026-10-07/release-handoff.md` already lists external gates (access, CI capacity, accessibility, package cleanup adapter, signing, managed provider, publication).
- Requirement rows: 11 in R7, all `external_pending` or MIG-016: PROD-002, PLUG-006, Q-010, Q-011, Q-019, P7-001, EXT-001..004, plus MIG-016 (docs audit, `pending`).
- Scripts such as `final-audit.ts`, `status.ts`, `release-gate.ts` currently produce the implementation vs release readiness counts.

## Key decisions to record in `decisions.md` before coding
1. **Retire only after replacement evidence:** each deleted TS test/script has a mapped Rust or xtask replacement (or a recorded "no longer applicable"), checked before deletion.
2. **Historical material is labelled, not deleted:** legacy Electron docs that explain provenance move under a "historical" marker; instructions never claim Electron is current.
3. **External-pending rows stay external-pending.** R7 produces handoff text, owners and verification steps; it does not run human pilots, live managed inference, signing, notarization or publication.
4. **Final report separates implementation readiness from release readiness** (Q-016).

## Task order and dependencies
| # | Task | Depends on |
|---|------|-----------|
| 01 | retire-electron-renderer | R6 all, R4 07 coverage replaced |
| 02 | documentation-audit | 01 (can start earlier for non-Electron docs) |
| 03 | feature-matrix-final-ci | 01, 02 |
| 04 | release-handoff | 03 (draft in parallel) |

Strictly serial near the end: the final CI SHA must be the last implementation commit; handoff and matrix cite it.
