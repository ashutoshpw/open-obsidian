# OpenObsidian implementation goal

Implement the complete first desktop release specified by [plan.md](plan.md) and every module linked from it. Work in this repository on the current `main` branch, make phased commits, and persist enough verified state that an interrupted run resumes at the next unfinished operation. This file is the goal prompt: read it fully when starting or resuming. Do not treat creating a scaffold, prototype, backlog, or passing subset as completion.

## Authority and scope

- Read repository `AGENTS.md` instructions, `plan.md`, and all 14 linked module documents before implementation. Confirmed requirements and recorded user decisions govern scope. Re-read changed specifications on resume.
- Deliver P0–P6: Electron desktop for macOS, Windows and Linux; in-place Obsidian vault compatibility; all C01–C14, A01–A09 and PC01–PC25 requirements; required plugin dependencies and theme fixtures; managed/BYOK/local AI; external-sync coexistence; recovery; accessible UX; packaging and release operations.
- Load unchanged upstream plugin artifacts. Similar built-in functionality, disabled-plugin preservation, mock integrations and aggregate pass percentages do not satisfy plugin certification.
- Preserve scope-before-deadline, no unintended vault writes, approved/recoverable AI changes, and all release gates. Resolve the D11/D15 conflict using concrete compatibility/security evidence and a user decision if required. Never silently weaken a guarantee or defer a required plugin.
- P7 is a separately decided expansion phase. Record its handoff and prerequisites; do not implement mobile, own sync, autonomy, collaboration or publishing unless the user expands this goal.
- Resolve routine engineering choices autonomously and record rationale. Open product decisions that materially determine licensing, billing, retention, trust or release scope require the user's answer; do independent work while awaiting it. Provisional engineering defaults must be labeled and must not masquerade as approved launch decisions.
- Prefer TypeScript/JavaScript and Bun for project tooling. Electron remains the application runtime. Select supported dependency versions from current primary documentation and pin the chosen versions and lockfile.
- Implementation, local validation and commits on `main` are authorized. This prompt does not independently authorize pushing, public publication, paid purchases, production provisioning, messaging others, or changes to personal vaults. Prepare concrete release artifacts and record any final external action awaiting authority. Never report that action as completed.

## Durable progress contract

Keep the following files beside this goal. Initialize them at P0.1, before substantive implementation, and commit them with the work they describe. Use repository-relative paths, UTC timestamps and no secrets or personal note content.

| Artifact | Required contents |
| --- | --- |
| `state.json` | Machine-readable summary and checkpoint records following the schema below. |
| `requirements.json` | One acceptance row per independently testable clause of every module, including requirements without existing IDs. |
| `evidence/` | Dated command results, test reports, fixture manifests, reference comparisons, screenshots, benchmark data, decisions and release checks. |
| `journal.md` | Append-only handoff entries: checkpoint, exact work completed, failures, decisions, next operation and interrupted operations. |

Minimum `state.json` shape (expand checkpoint entries for every row in the checkpoint table):

```json
{
  "schema_version": 1,
  "goal_id": "openobsidian-v1",
  "spec_hashes": {},
  "branch": "main",
  "baseline_commit": null,
  "last_reconciled_head": null,
  "updated_at": "<UTC ISO-8601 timestamp>",
  "status": "active",
  "current_checkpoint": "P0.1",
  "next_action": "Inventory repository and initialize traceability",
  "checkpoints": {
    "P0.1": {
      "status": "pending",
      "depends_on": [],
      "requirement_ids": [],
      "completed_actions": [],
      "next_action": "Initialize progress artifacts",
      "evidence": [],
      "commit_marker": "[openobsidian P0.1]",
      "validated_source_tree": null,
      "blockers": []
    }
  }
}
```

- Goal statuses: `active`, `waiting_for_input`, `blocked`, `complete`. Checkpoint statuses: `pending`, `in_progress`, `blocked`, `complete`. These are repository bookkeeping values; follow the actual harness's own rules for any goal-status tools. Do not assume reading this file automatically creates a harness goal or provides automatic resume.
- Hash `plan.md` and every module with SHA-256. `baseline_commit` is the initial HEAD, or null for an unborn repository. `last_reconciled_head` records the HEAD observed at the last reconciliation; it is not a self-reference to the commit containing the file.
- Requirement rows include `id`, source path/heading and clause, checkpoint, owner/workstream, mandatory flag, acceptance criteria, fixture IDs, reference/artifact versions and hashes, applicable OS/architecture, status, evidence paths, tested source tree and blocker. Split Cxx/Axx/PCxx into subclauses as needed; keep parent IDs. Give stable IDs to UX, security, sync, operations and other unnumbered requirements. Preserve parent-to-child coverage.
- Requirement statuses: `pending`, `implemented`, `passing`, `failing`, `blocked`. `implemented` is not `passing`. Explicitly store individual matrix cells; a macOS result does not prove Windows/Linux. Upstream-intrinsic restrictions require reference evidence and rationale, not a blanket skip. A missing account, runner or fixture is blocked, not passing.
- Each evidence record identifies timestamp, checkpoint/requirement, exact command or manual procedure, environment, dependency/fixture versions, tested source tree or artifact hash, exit code/result and limitations. Record failed attempts as well as successful reruns. Keep large/private artifacts out of Git; retain a durable location, hash and retrieval procedure for required external evidence.
- Report checkpoint completion as completed/total and mandatory acceptance coverage as passing/total applicable cells, plus failing, blocked and untested counts by platform. Denominators come from the frozen requirements inventory. Never hide gaps by deleting rows or counting generated tests as passed workflows.
- A checkpoint is complete only when its required acceptance rows pass, evidence exists and the phased commit is reachable on `main`. A phase is complete only when every checkpoint in it is complete. Commit markers are reconciled after a commit; do not attempt to embed a commit's own SHA into itself.

## Start and resume protocol

1. Locate the repository root and this task folder. Read guidance, this goal, existing state/requirements/journal and the last relevant evidence. Inspect branch, HEAD (allow unborn HEAD), Git status/diff, staged changes, and checkpoint-marker history on `main`. Never reset, clean, stash or overwrite unrelated user changes automatically.
2. Verify the current branch is `main`. Do not create or switch branches to bypass an unexpected checkout. If a different branch is active, record the discrepancy and obtain direction before implementation commits.
3. If progress files are missing, initialize from the specification and actual checkout/history. If they disagree, reconcile using reachable commits, source changes and evidence; do not blindly trust the latest checkbox or file timestamp. Preserve useful unfinished work.
4. Recompute specification hashes. Map changes to affected acceptance rows and checkpoints; invalidate stale passing evidence and reopen affected work. Do the same for source/dependency changes affecting previously tested behavior. Never erase the historical results.
5. Resolve each `[openobsidian Pn.m]` marker from reachable history. If code was committed but progress was interrupted, verify the commit and evidence and repair state. If state says complete without the required commit/evidence, reopen it. Inspect existing staged or unstaged checkpoint work before rerunning commands.
6. Check whether an interrupted build, test, download or service is still running using its recorded identity and current process/output evidence. Reuse or finish it when safe; do not duplicate servers, purchases, migrations or external submissions. PIDs alone are not identity. Record non-idempotent intent before execution and verify its outcome before retrying.
7. Resume the recorded next unfinished action in the earliest dependency-ready checkpoint. Complete partial actions instead of restarting the phase. Work on another independent checkpoint when blocked, keeping the original blocker visible. Revalidate stale evidence in proportion to changed code and risk.
8. Before an intentional handoff, after each meaningful completed action, after a failed gate and before/after each commit, update progress and journal with the exact next action, environment/prerequisites and evidence. Use atomic replacement for machine-readable state where practical. Sudden termination may occur before this write; Git/worktree reconciliation must still recover the remaining work.

## Checkpoints and exit evidence

Run in the listed order unless documented dependencies allow overlap. P2/P3/P4 may overlap after P1 establishes the interfaces; all remain release gates. Split large checkpoints into stable numbered subcheckpoints if needed without deleting the parent's acceptance scope.

| ID | Deliverable and measurable exit condition |
| --- | --- |
| P0.1 | Inventory repository; initialize progress, requirement inventory, ownership, dependency graph and baseline. Add a Bun status/validation command that checks state structure, all checkpoint IDs, requirement coverage, evidence references and Git marker consistency. It must report incomplete work honestly and fail a release-completion check while mandatory work is missing. |
| P0.2 | Freeze launch contract, stable/early-access reference tracks, platform matrix, synthetic vault corpus and measurable evaluation protocol. Track D12–D17 and all proposed thresholds/policies to resolution at their dependent gates. Pin released artifacts/hashes for all 25 plugins and dependencies; record licenses and additional theme research/certification scope. Do not substitute development manifests for releases. |
| P1.1 | Prove lossless open/index/close, editing and recovery with reference round trips and injected interrupted writes/concurrent edits. Measure representative large vaults and preserve conflicting versions. |
| P1.2 | Run hardest unchanged-plugin prototypes: DataviewJS, Templater scripts/system commands, Excalidraw views, Minimal/Style Settings DOM, Git/Claudian process access, Remotely Save, TaskNotes/Bases. Exercise trust/credential/filesystem/network bypasses on applicable platforms. Resolve D15 and D11 with evidence before choosing the production runtime boundary. |
| P1.3 | Record architecture decisions, actual API/DOM compatibility gaps, security boundaries, library/distribution choices, platform/hardware proposals, owners and optimistic/likely/pessimistic effort ranges. Establish executable build/test setup and interfaces supporting foundation/AI overlap. |
| P2.1 | Deliver vault engine, lossless Markdown/properties parsing, link resolution, attachments/config preservation, revision-aware writer, durable journal/history, watchers and external edit reconciliation. C01–C04/C08–C09/C13–C14 foundation acceptance and failure fixtures pass. |
| P2.2 | Deliver source/live/reading editor, explorer, tabs/splits/popouts, commands, quick switcher, outline/backlinks, keyword search, settings and account-free local opening. Cover C02/C10 and relevant UX/keyboard/IME/RTL cases with end-to-end tests. |
| P2.3 | Complete recovery/retention and external-sync implementation, conflict/history UI, fault suite, index rebuilds and no-op/approved-edit fidelity. Demonstrate cross-process races and documented mitigations, including rename/delete/binary/cloud-placeholder cases. |
| P3.1 | Deliver functional Graph, JSON Canvas and Bases plus complete core-workflow inventory. Verify C05–C07/C10 behavior and unknown-field preservation against pinned Obsidian, including navigation/editing and exit portability. |
| P3.2 | Complete unchanged-artifact plugin runtime and certify PC01–PC25 plus all dependencies in the applicable OS/version matrix. Run required plugin combinations, lifecycle, settings, update/uninstall, restart and return-to-Obsidian tests. Every mandatory workflow passes. |
| P3.3 | Certify selected themes/snippets and legacy layout contracts across modes/popouts/plugin views; complete C11–C12 and CLI/deep-link matrix. Verify privileged dialogs and AI controls coexist with themes and trusted extensions under the approved boundary. |
| P4.1 | Deliver A01–A02: incremental hybrid retrieval, exclusions, scope filters, revision-aware citations, source inspector and conflicting/absent evidence handling. Run grounding and cross-vault/excluded-content leakage evals. |
| P4.2 | Deliver A03–A04/A09: reviewed drafting/organization/Canvas/Bases changes, per-file acceptance, revision checks, undo and recovery; test prompt injection, scope enforcement and legacy-agent coexistence. |
| P4.3 | Deliver A05–A08: managed/BYOK/local provider flows, credential storage, cancellation/errors, costs/caps, model lifecycle/offline behavior, deletion/export. Implement and verify managed accounts/entitlements/billing reconciliation/idempotency/operations using provisioned test integrations; mock-only checks leave live acceptance blocked. |
| P5.1 | Run consented real-vault beta, full OS/architecture and named sync-tool matrix, plugin-equipped reference comparisons, long-running reliability and performance. Meet agreed startup/search/input/resource/AI quality gates and practical task-benefit evaluation. Missing pilot participants or runners remains explicit pending evidence. |
| P5.2 | Complete accessibility, language/IME/RTL and keyboard journeys; privacy/security review; dependency/license review; opt-in diagnostics, safe mode and extension bisect. Resolve all blocking data-loss/security/accessibility issues and rerun affected gates. |
| P6.1 | Produce and verify signed/notarized macOS, signed Windows and agreed Linux packages; test installation, upgrade/downgrade, updater integrity, offline behavior, rollback and safe uninstall. Record artifact hashes, tested versions, signing prerequisites and operational ownership. |
| P6.2 | Audit every requirement and release gate; prepare compatibility matrix, known issues, onboarding/recovery/support docs, vulnerability and incident response, release notes and rollback runbook. Execute authorized release actions, or record the exact prepared action awaiting authority. Full goal completion requires all mandatory evidence and release sign-off, not just release preparation. |
| P7.1 | Write expansion handoff with explicit separate decisions for mobile, own sync, autonomy, collaboration and publishing. This checkpoint requires the handoff only and does not expand v1 scope. |

## Phased commits on current main

- Remain on `main`; no feature branches or worktrees on another branch. Inspect status/diffs before staging. Preserve unrelated changes and stage explicit task-owned paths, never an indiscriminate `git add .`.
- This repository may initially have no commits and the planning folder may be untracked. At P0.1, review and include the governing task documents and initialized tracking files as the baseline commit. Do not omit the specification needed to reproduce the goal.
- Commit each completed checkpoint or coherent subcheckpoint using `[openobsidian P0.1] Initialize goal tracking` (substitute ID/summary). Use unique completion markers; earlier incremental commits use `[openobsidian P0.1 work] ...` and do not count as completion.
- Before a completion commit: run relevant checks with normal hooks, review the staged diff, persist acceptance/evidence and next action, and record the validated source tree (exclude progress-only metadata when computing its digest). No bypassing hooks, fabricated test output or unrelated cleanup.
- After commit: verify marker, branch, commit reachability and status; record the observed SHA in the next progress update. An interruption here is recovered from the marker. Avoid endless metadata-only commits merely to record their own hashes.
- If interrupted mid-checkpoint, retain the worktree and exact resume instructions. A coherent partial commit is permitted with a `work` marker and honest incomplete status; a failing acceptance gate cannot receive a completion marker.
- If hooks fail, fix scoped failures; document unrelated blockers without disabling checks. No amend/rebase/reset/force push or history rewriting unless separately authorized. No push is implied by local phased commits.

## Completion and handoff

Continue until all required checkpoints and acceptance cells pass, or a concrete external dependency prevents further useful independent progress. Large scope, slow builds and an interrupted session are not reasons to declare completion. Surface blockers with evidence, attempted alternatives, affected checkpoint IDs and the specific input/access needed; retain an exact next action.

The final release audit must verify the five non-negotiable gates in `plan.md`, every owning module, all 25 plugin workflows/dependencies and cross-platform results. No open mandatory blocker, placeholder, unexecuted acceptance test or missing release action may be labeled done. P7 expansion remains outside this goal beyond its handoff.

On any handoff report: current checkpoint/action, completed/total checkpoints, passing/total mandatory matrix cells with gaps by OS, phased commit SHAs, last verification results, blockers and exact resume operation. On full completion also report packaged artifact locations/hashes, compatibility/release evidence and final `main` commit. Set `state.json` to `complete` only after this audit succeeds. If the harness offers a goal-completion tool, use it only then and in accordance with its actual instructions.
