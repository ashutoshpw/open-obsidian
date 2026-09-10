# Bun script playbook

The packaging-only dependency audit is:

    bun run audit:dependencies -- --artifacts-dir out

Use the shortest command that matches the change. All scripts are repository-local Bun entry points, so evidence and CI use the same implementation.

| Command | Use |
| --- | --- |
| `bun run check:fast` | Routine source/UI gate: state, contracts, architecture, named surfaces, version baseline, accessibility, layout, typecheck, tests, Knip and changed-file Fallow. |
| `bun run test:bases` | Focused JSON/native-YAML Bases compatibility fixture tests. |
| `bun run quality` | Phase-boundary gate: full local checks, compile, distribution, quality scorecard, Knip and report-only Fallow health. |
| `bun run knip` | Recurring unused files, exports and dependencies audit. |
| `bun run audit:fallow` | Repository health score; inherited advisories stay visible. |
| `bun run audit:fallow:changed` | Brief changed-file Fallow review for the current working tree. |
| `bun run audit:fallow:strict` | Full changed-file Fallow gate before a source commit. |
| `bun run audit:source-tree` | Evidence-ready immutable digest of the current tracked/untracked source tree. |
| `bun run validate:state` | Progress artifact, requirement coverage and evidence-reference validation. |
| `bun run final:audit` | Origin/branch/marker check plus implementation versus release-readiness summary. |
| `bun run validate:surfaces` | Named UX surface inventory and external handoff validation. |
| `bun run validate:layout` | Static Obsidian-shell geometry and navigation-marker checks. |
| `bun run verify:version-baseline` | Cross-checks the stable/early-access references and records per-artifact minimum-version, API and runtime verification status. |
| `bun run audit:packaged -- --artifacts-dir out` | Packaged runtime notice and artifact integrity audit after packaging. |

For a normal change, run `bun run check:fast`. Before a checkpoint commit, run `bun run quality` and `bun run audit:source-tree`; copy the latter's `sha256`, path count and `head` into the evidence record. Run `bunx fallow` through the repository scripts rather than hiding findings in ad-hoc output.
