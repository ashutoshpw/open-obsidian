# 04 — External release handoff

**Rows:** EXT-001, EXT-002, EXT-003, EXT-004, PROD-002, Q-010, Q-011, Q-019, PLUG-006, P7-001 (all external-pending).

## Goal
A final handoff that gives each open external item an owner, prerequisites and exact verification steps, without claiming it was run.

## Scope
- Update `release-handoff.md` and `.agents/tasks/2026-10-07/release-handoff.md`: managed service (EXT-001: endpoint, retention/billing policy, live credentials; checks for selected-scope requests and redacted errors), human validation (EXT-002 / PROD-002 / Q-010: consent, hardware, participants, counterbalanced procedure, result storage), signing/notarization and update verification (EXT-003), publication (EXT-004: authorized tag and signed artifacts only), screen-reader review (Q-011), live plugin prerequisites (PLUG-006), reference Obsidian runs, later-scope expansion decisions (P7-001, e.g. owned encrypted sync, mobile).
- Mark the package cleanup adapter item resolved only if R6 task 01 CI evidence exists.
- Table format kept: Item / Prerequisite and verification / Status.

## Design
- Each item links to the repo command or workflow that performs the verification once the prerequisite exists (for example the `workflow_dispatch` production gate); nothing is executed by this task.
- Telemetry/privacy statements stay no-content (D17, Q-015).

## Steps
1. Reconcile current handoff text with post-migration commands (replace `bun run release:check` etc. if retired).
2. Add owners (`desktop-release`, `operations-handoff`, `product-ux`, `vault-filesystem`, `compatibility-runtime` are the roles used today) and verification steps per row.
3. Review that no row's status text overstates evidence; verify with the matrix from task 03.

## Acceptance / CI evidence
- Docs audit (task 02) passes; a test checks that each external-pending row id appears in the handoff with an owner field.

## Risks
Role names may not map to real people; keep them as roles and flag assignment as a human action.
