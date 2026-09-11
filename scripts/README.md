# Bun script playbook

The packaging-only dependency audit is:

    bun run audit:dependencies -- --artifacts-dir out

Use the shortest command that matches the change. All scripts are repository-local Bun entry points, so evidence and CI use the same implementation.

| Command | Use |
| --- | --- |
| `bun run check:fast` | Routine source/UI gate: state, contracts, architecture, named surfaces, version baseline, accessibility, layout, typecheck, tests, Knip and changed-file Fallow. |
| `bun run test:bases` | Focused JSON/native-YAML Bases compatibility fixture tests. |
| `bun run quality` | Phase-boundary gate: full local checks, compile, distribution, quality scorecard, Knip and report-only Fallow health. |
| `bun run benchmark` | Measures Linux core-synthetic startup/indexing, edit-operation, search, watcher and resource distributions; use `--profiles=100,1000,10000` and optionally `--index-runs=1 --search-runs=25 --input-runs=25` for a bounded larger corpus. Renderer paint, pinned hardware, reference vaults, cross-platform and human comparison remain external-pending. |
| `bun run knip` | Recurring unused files, exports and dependencies audit. |
| `bun run audit:fallow` | Repository health score; inherited advisories stay visible. |
| `bun run audit:fallow:changed` | Brief changed-file Fallow review for the current working tree. |
| `bun run audit:fallow:strict` | Full changed-file Fallow gate before a source commit. |
| `bun run audit:source-tree` | Evidence-ready immutable digest of the current tracked/untracked source tree. |
| `bun run validate:state` | Progress artifact, requirement coverage and evidence-reference validation. |
| `bun run final:audit` | Origin/branch/marker check plus implementation versus release-readiness summary. |
| `bun run validate:surfaces` | Named UX surface inventory and external handoff validation. |
| `bun run validate:differential` | Validates the executable local vault probes and explicit reference-comparison decisions. |
| `bun run validate:entry-points` | Validates explicit `--vault`/`--open` CLI and `openobsidian://` deep-link cases, including fail-closed traversal and non-hijacking `obsidian://` cases. |
| `bun run validate:paid-service-boundary` | Validates separate unsupported, contract-only, entitlement-free Sync and Publish dispositions and their visible renderer handoff. |
| `bun run validate:workflows` | Validates the complete C10 core-workflow inventory, including local bookmark/tag/task/template/daily-note markers and keyboard journey handoffs. |
| `bun run validate:input-matrix` | Validates the keyboard/IME/Unicode/RTL/popout input matrix and its local versus external dispositions. |
| `bun run validate:layout` | Static Obsidian-shell geometry and navigation-marker checks. |
| `bun run audit:theme-assets -- --root /path/to/vault` | Read-only appearance/theme/snippet audit; reports hashes, CSS variables, legacy layout contracts, mode/accessibility coverage and safe-preview issues without executing CSS. Add `--strict` to fail on any host-review item. |
| `bun run verify:version-baseline` | Cross-checks the stable/early-access references and records per-artifact minimum-version, API and runtime verification status. |
| `bun run verify:compatibility-pins` | Downloads the frozen release assets and verifies SHA-256, byte counts and recorded plugin manifest metadata. |
| `bun run audit:plugin-bundles` | Downloads pinned hardest-plugin `main.js` bundles (use `--all` for every applicable artifact), verifies bytes, and performs a non-executing privileged-API marker prescreen; runtime remains pending. |
| `bun run audit:plugin-runtime` | Opt-in loads the same unchanged pinned bundles in a separate Node permission-restricted subprocess with no host module/DOM/network/process access; this is module-load evidence only and does not certify Electron or OS isolation. |
| `bun run audit:plugin-renderer` | Opt-in downloads the eight hardest unchanged pins, statically denies privileged sources before execution, and runs only marker-free sources in a hidden Electron sandboxed renderer wrapper; lifecycle and OS-enforcement certification remain pending. |
| `bun run audit:plugin-runtime:all` | Repeatable full-matrix variant that loads every pinned plugin/dependency `main.js` asset under the same restricted module-load probe; downloads are bounded to four concurrent assets with retry backoff, and results remain pending-runtime. |
| `bun run validate:plugin-matrix` | Builds and validates the 25-plugin plus dependency matrix across macOS, Windows and Linux with release pins, workflows and pending lifecycle dispositions. |
| `bun run verify:plugin-selection` | Rechecks live registry/download snapshots; intentional drift fails without changing the frozen selection. |
| `bun run audit:packaged -- --artifacts-dir out` | Packaged runtime notice and artifact integrity audit after packaging. |

For a normal change, run `bun run check:fast`. Before a checkpoint commit, run `bun run quality` and `bun run audit:source-tree`; copy the latter's `sha256`, path count and `head` into the evidence record. Run `bunx fallow` through the repository scripts rather than hiding findings in ad-hoc output. Workflow smoke tests live in `tests/workflows.test.ts` and `tests/note-workflows.test.ts`; keep pure parsing and data contracts under `src/shared/ui`, and keep vault I/O in `src/core/workflows.ts` or `src/core/note-workflows.ts` so an Expo host can reuse the contracts.
