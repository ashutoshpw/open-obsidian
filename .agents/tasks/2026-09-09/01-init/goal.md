# OpenObsidian implementation goal

Implement the desktop application specified by [plan.md](plan.md) and every module linked from it, applying confirmed D11–D21. Completion means all in-scope implementation and available automated checks, with human validation, operated managed service/billing, signing access and public release tracked separately. Work on current `main`, commit and push in phases to the assigned `origin/main`, and persist verified state so interruptions resume at the next unfinished operation. Read this file fully on start/resume. A scaffold, prototype or arbitrary passing subset is not completion.

## Authority and scope

- Read repository `AGENTS.md` instructions, `plan.md`, and all 14 linked module documents before implementation. Confirmed requirements and recorded user decisions govern scope. Re-read changed specifications on resume.
- Deliver implementation portions of P0–P6: Electron desktop on macOS/Windows/Linux; C01–C15 including Standard and Chronicle vaults; A01–A09 under D13; evaluation and compatible implementation of PC01–PC25/dependencies/themes under D15; BYOK/local and OpenRouter-proxy client; recovery/accessibility; cross-platform builds and delivery workflows. License project code GNU AGPL v3.0, using AGPL-3.0-only without inferring an additional later-version grant; retain third-party notices and verify redistribution compatibility.
- Load unchanged upstream plugin artifacts. Similar built-in functionality, disabled-plugin preservation, mock integrations and aggregate pass percentages do not satisfy plugin certification.
- Enforce isolation and preview for every plugin and app AI; no trusted bypass. D15 already authorizes retaining demonstrated incompatible workflows as unsupported, with reproducer/reference evidence and denied-execution tests. Do not ask the user to trade security for compatibility again. Missing code, ordinary failures or untested workflows cannot become exceptions.
- P7 is a separately decided expansion phase. Record its handoff and prerequisites; do not implement mobile, own sync, autonomy, collaboration or publishing unless the user expands this goal.
- Apply approved OpenObsidian naming, 30-day/5 GiB configurable history, protected unresolved conflicts, OS-based history protection, no deadline and no default note-content telemetry. Choose remaining OS/architecture, hardware/performance, models/adapters, themes, sync tools and backend interfaces autonomously after prototypes; record evidence and freeze measurable acceptance before final testing. Managed service and billing/pricing are later work, not questions that block this goal.
- Prefer TypeScript/JavaScript and Bun for project tooling. Electron remains the application runtime. Select supported dependency versions from current primary documentation and pin the chosen versions and lockfile.
- The GitHub project URL will be assigned when execution starts. Verify origin against it; configure an absent origin only from that assigned URL, never invent a repository target. Use that project's GitHub Actions runners, commit and push to origin/main, and implement main-push preview/staging and production-build tags in vYYYY-MM-DD format. Creating production tags/public releases is later release work. Paid resources, personal vault mutations, personal-vault remote pushes and messages to others are not authorized. Use existing/free capacity; document external setup without silently spending.

## Durable progress contract

Keep the following files beside this goal. Initialize them at P0.1, before substantive implementation, and commit them with the work they describe. Use repository-relative paths, UTC timestamps and no secrets or personal note content.

| Artifact | Required contents |
| --- | --- |
| `state.json` | Machine-readable summary and checkpoint records following the schema below. |
| `requirements.json` | One acceptance row per independently testable clause of every module, including requirements without existing IDs. |
| `evidence/` | Dated command results, test reports, fixture manifests, reference comparisons, screenshots, benchmark data, decisions and release checks. |
| `journal.md` | Append-only handoff entries: checkpoint, exact work completed, failures, decisions, next operation and interrupted operations. |
| `release-handoff.md` | Separate pending human validation, managed service/billing, signing/live access and publication tasks, with prerequisites, owners and exact verification steps. |

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
- Requirement statuses: `pending`, `implemented`, `passing`, `failing`, `blocked`, `unsupported_security`, `external_pending`. Add `gate_class` (`implementation` or `release_external`) and `decision_id` to every row. `implemented`, `unsupported_security` and `external_pending` are never reported as passing. A D15 security exception requires proof, attempted safe alternatives, a disabled-path test and a visible compatibility entry. External rows require D13/D18–D20 authority and handoff instructions. Missing core code or failing available tests remain implementation blockers. GitHub macOS/Windows/Linux jobs remain required when provisioned; temporary CI failures are not deferred gates.
- Each evidence record identifies timestamp, checkpoint/requirement, exact command or manual procedure, environment, dependency/fixture versions, tested source tree or artifact hash, exit code/result and limitations. Record failed attempts as well as successful reruns. Keep large/private artifacts out of Git; retain a durable location, hash and retrieval procedure for required external evidence.
- Report completed/total implementation checkpoints and passing/total acceptance cells, including unsupported-security and external-pending counts separately by platform. Report implementation and release readiness separately. Keep all rows in the inventory and explain authorized gate classification; do not hide gaps by changing denominators or counting fixtures as live verification.
- A checkpoint is complete when its implementation rows pass (or satisfy the D15 evidence/denial contract), external rows have explicit handoffs, evidence exists and the phased commit is reachable on `main`. Record push SHA and GitHub run URLs/results separately; required available CI must pass before final completion. Checkpoint completion never implies pending human/release work passed. Reconcile markers after commits without self-referencing commit hashes.

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
| P0.2 | Apply D11–D21; freeze implementation versus external gates, reference tracks, platform matrix, synthetic corpus and evaluation protocol. Pin released artifacts/hashes for all 25 plugins/dependencies; verify licenses and theme scope. Configure assigned GitHub origin and Actions. Never substitute development manifests for releases. |
| P1.1 | Prove lossless open/index/close, editing and recovery with reference round trips and injected interrupted writes/concurrent edits. Measure representative large vaults and preserve conflicting versions. |
| P1.2 | Run hardest unchanged-plugin prototypes: DataviewJS, Templater scripts/system commands, Excalidraw views, Minimal/Style Settings DOM, Git/Claudian process access, Remotely Save, TaskNotes/Bases. Test credential/filesystem/network/process bypasses per OS. Implement enforceable boundaries and safely disable proven incompatible paths under D15; document evidence without reopening the security decision. |
| P1.3 | Record architecture decisions, actual API/DOM compatibility gaps, security boundaries, library/distribution choices, platform/hardware proposals, owners and optimistic/likely/pessimistic effort ranges. Establish executable build/test setup and interfaces supporting foundation/AI overlap. |
| P2.1 | Deliver vault engine, lossless Markdown/properties parsing, link resolution, attachments/config preservation, revision-aware writer, durable journal/history, watchers and external edit reconciliation. C01–C04/C08–C09/C13–C14 foundation acceptance and failure fixtures pass. |
| P2.2 | Deliver source/live/reading editor, explorer, tabs/splits/popouts, commands, quick switcher, outline/backlinks, keyword search, settings and account-free local opening. Cover C02/C10 and relevant UX/keyboard/IME/RTL cases with end-to-end tests. |
| P2.3 | Complete recovery/retention, external sync and C15 Standard/Chronicle vaults, including Git adoption/init, selected commits, diff/history/restore, optional remotes and conflicts. Verify no-op scans, dirty repos, no accidental staging/push, protected history and cross-process rename/delete/binary/cloud-placeholder failures. |
| P3.1 | Deliver functional Graph, JSON Canvas and Bases plus complete core-workflow inventory. Verify C05–C07/C10 behavior and unknown-field preservation against pinned Obsidian, including navigation/editing and exit portability. |
| P3.2 | Evaluate every PC01–PC25 workflow/dependency per OS/version, implementing safe unchanged-artifact compatibility. Test combinations/lifecycle/settings/updates/restarts/return-to-Obsidian. Supported workflows pass; proven D15 incompatibilities have reproducible evidence, denial tests and unsupported entries. No unassessed plugins or ordinary implementation gaps qualify as complete. |
| P3.3 | Certify selected themes/snippets and legacy layout contracts across modes/popouts/plugin views; complete C11–C12 and CLI/deep-link matrix under D15. Verify privileged dialogs and AI controls cannot be controlled by themes/extensions or bypass approval. |
| P4.1 | Deliver A01–A02: incremental hybrid retrieval, exclusions, scope filters, revision-aware citations, source inspector and conflicting/absent evidence handling. Run grounding and cross-vault/excluded-content leakage evals. |
| P4.2 | Deliver A03–A04/A09: reviewed drafting/organization/Canvas/Bases changes, per-file acceptance, revision checks, undo and recovery; test prompt injection, scope enforcement and legacy-agent coexistence. |
| P4.3 | Deliver BYOK/local implementations and OpenRouter-proxy client contract, credential separation, cancellation/errors, usage/caps, model lifecycle/offline behavior and deletion/export. Contract fixtures pass; run live integrations when provisioned. Hand off unavailable live access and operated managed accounts/billing/pricing under D13 without claiming live certification. |
| P5.1 | Run available automated OS/architecture/sync suites, reference comparisons, long-running reliability/performance and grounding checks. Meet frozen automated budgets. Prepare real-vault beta and practical-benefit protocols; human measurements remain external-pending. Use GitHub runners rather than treating untested desktop platforms as passed. |
| P5.2 | Complete accessibility, language/IME/RTL and keyboard journeys; privacy/security review; dependency/license review; opt-in diagnostics, safe mode and extension bisect. Resolve all blocking data-loss/security/accessibility issues and rerun affected gates. |
| P6.1 | Build macOS/Windows/Linux packages on Actions and test available installation/update/rollback/offline/uninstall flows. Implement signing/notarization hooks; absent signing credentials produce clearly unsigned preview artifacts and external handoff. Main pushes trigger preview/staging delivery; valid vYYYY-MM-DD tags trigger production builds with signing prerequisites checked and no silent unsigned production fallback. |
| P6.2 | Audit implementation coverage, security exceptions, CI and artifacts; deliver compatibility matrix, support/recovery/security docs and release-handoff. Record human review, live managed access, signing and publication as pending external gates. Verify origin/main and required available CI; implementation goal can complete while release readiness remains pending. Do not create a production tag to manufacture completion. |
| P7.1 | Write expansion handoff with explicit separate decisions for mobile, own sync, autonomy, collaboration and publishing. This checkpoint requires the handoff only and does not expand v1 scope. |

## Phased commits on current main

- Remain on `main`; no feature branches or worktrees on another branch. Inspect status/diffs before staging. Preserve unrelated changes and stage explicit task-owned paths, never an indiscriminate `git add .`.
- This repository may initially have no commits and the planning folder may be untracked. At P0.1, review and include the governing task documents and initialized tracking files as the baseline commit. Do not omit the specification needed to reproduce the goal.
- Commit each completed checkpoint or coherent subcheckpoint using `[openobsidian P0.1] Initialize goal tracking` (substitute ID/summary). Use unique completion markers; earlier incremental commits use `[openobsidian P0.1 work] ...` and do not count as completion.
- Before a completion commit: run relevant checks with normal hooks, review the staged diff, persist acceptance/evidence and next action, and record the validated source tree (exclude progress-only metadata when computing its digest). No bypassing hooks, fabricated test output or unrelated cleanup.
- After commit: verify marker, branch, commit reachability and status; record the observed SHA in the next progress update. An interruption here is recovered from the marker. Avoid endless metadata-only commits merely to record their own hashes.
- If interrupted mid-checkpoint, retain the worktree and exact resume instructions. A coherent partial commit is permitted with a `work` marker and honest incomplete status; a failing acceptance gate cannot receive a completion marker.
- After coherent phased commits, push to verified origin/main and inspect the triggered Actions runs; fix scoped failures. Reconcile ahead/behind state before pushing; never force-push. If hooks fail, fix scoped failures without disabling checks. No amend/rebase/reset/history rewrite unless separately authorized. Record remote SHA/run IDs for resume; do not duplicate deployments when a push already triggered one.

## Completion and handoff

Continue until all implementation checkpoints satisfy the completion contract above, or a concrete dependency prevents further useful independent progress. External-pending release rows do not stop independent implementation. Large scope, slow builds and an interrupted session are not reasons to declare completion. Surface genuine implementation blockers with evidence, attempted alternatives, affected IDs and exact resume action.

The final implementation audit checks plan/module coverage, C15, all 25 evaluated plugins/dependencies, enforced security, cross-platform builds and available tests. Unfinished implementation, an ordinary failing test or missing evidence blocks completion. D15 exceptions and D13/D18–D20 external handoffs remain separately visible and never count as passed release gates. P7 remains outside scope beyond its handoff.

On any handoff report: current checkpoint/action, completed/total checkpoints, passing/total mandatory matrix cells with gaps by OS, phased commit SHAs, last verification results, blockers and exact resume operation. On full completion also report packaged artifact locations/hashes, compatibility/release evidence and final `main` commit. Set `state.json` to `complete` only after this audit succeeds. If the harness offers a goal-completion tool, use it only then and in accordance with its actual instructions.
