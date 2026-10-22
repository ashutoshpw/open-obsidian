# 03 — Final feature matrix and full-CI exact-SHA run

**Rows:** Q-016, Q-019, DEL-001 (final), plus the "all mandatory rows" exit criterion.

## Goal
Generate a feature matrix from `requirements.json` and evidence, and prove every applicable Rust CI job passes on the final implementation SHA.

## Scope
- Per-row disposition: `passing` (with evidence paths), `failing`, `untested`, `d15-unsupported-security` (evidence-complete only), `external_pending` (owner + handoff).
- Separate implementation-readiness count from release-readiness count; no external-pending row is counted as passed.
- Include plugin compatibility rows (PC01–PC25) with honest dispositions inherited from R4 task 07.
- Record the final CI run: workflow names, run IDs, SHA, per-OS result, artifact hashes.

## Design
- Replace `scripts/final-audit.ts` / `status.ts` with `cargo xtask final-audit` (or keep Bun if retained by R7 01); output is JSON + generated Markdown matrix under `.agents/tasks/2026-10-07/evidence/`.
- The final SHA must contain no later non-doc commits; evidence references that SHA exactly. A docs-only follow-up commit requires an explicit note and, if CI-relevant files change, a re-run.

## Steps
1. Matrix generator with schema validation (evidence file exists, SHA matches tested tree).
2. Dry run to list rows lacking evidence; drive remaining work to closure or honest dispositions.
3. Final all-green run on 3 OSes; capture evidence.
4. Check `state.json` checkpoints are ordered and no phase is marked complete without evidence.

## Acceptance / CI evidence
- Matrix committed with SHA; generator test fails if a `passing` row lacks evidence or an external row is counted as passed.

## Risks
Some rows may legitimately remain failing or untested at the end; the matrix must say so rather than the phase being declared done early.
