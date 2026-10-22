# 07 — Compatibility matrix and certification

**Rows:** PC01–PC25 (final dispositions), PLUG-004, C11, C11.1, GATE-002, Q-003, DEL-004 (R4 part), RISK-001, MIG-008 (final).

## Goal
A dated, per-platform, per-workflow result for every plugin and dependency with an honest disposition, generated from CI artifacts, not hand edited.

## Scope
- Matrix schema: plugin × platform × workflow → `passing | failing | untested | unsupported-security(D15 id)`; artifact version/hash recorded per cell; references the evidence file and exact SHA.
- Workflow fixtures per plugin taken from each PC row's acceptance text (e.g. PC04 Tasks query + source update through revision-aware writer; PC09 Kanban board edit portability; PC03 Dataview DQL render / DataviewJS handling).
- Generator in `xtask` that consumes the per-plugin JSON reports (task 04/03) and updates `fixtures/compatibility-coverage.json` + a human-readable `docs/compatibility/matrix.md`; CI gate fails if any mandatory cell is unassessed.
- Honest accounting: failing ≠ D15; D15 requires reproduction, safe alternatives, denial test, visible entry (task 02).

## Steps
1. Matrix schema + validator in `xtask` and `validate_inventory` integration.
2. Wire per-plugin report ingestion; render markdown; CI check.
3. Work through waves from task 04: author fixtures, run in CI, record outcomes.
4. Final reconcile: update `requirements.json` rows only with evidence paths; summarize unsupported-security and external-pending items for handoff.

## Acceptance
Every mandatory PC/PLUG cell has a dated result on 3 OSes; no unassessed mandatory cell (Q-003); matrix links resolve to exact-SHA evidence.

## Risks
Long CI cycles (reference-app runs); budget several repair milestones per wave.
