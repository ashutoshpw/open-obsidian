# OpenObsidian Rust migration goal

## Objective

Migrate OpenObsidian to a native Rust desktop application using the same applicable Rust stack and architecture as [storytold/photocraft](https://github.com/storytold/photocraft). Port the application core, desktop shell, UI, platform services and delivery tooling while preserving the existing product contracts, vault safety and honest compatibility reporting. Deliver working macOS, Windows and Linux builds. A workspace scaffold or a window that opens is not completion.

Migration work started from `d0ad51c0c5bc3480a6f4527b8cc3dbc57063ad79`; the R0.1 inventory milestone and parallel CI preparation have since passed. Read this file fully on start and resume. Passing preparation checks does not imply Rust implementation has started or passed.

## Authority and baseline

- This migration supersedes the earlier requirement to retain Electron and prefer TypeScript/Bun in `.agents/tasks/2026-09-09/01-init/goal.md`. It also supersedes earlier local-testing instructions: **all testing and executable validation for this migration must run only in GitHub Actions CI**.
- Preserve the other confirmed product and safety decisions in the earlier goal, its `plan.md`, linked modules, `requirements.json`, `state.json`, `config/launch-contract.json` and existing fixtures. Read them before implementation. Update runtime-specific contracts and validators as their Rust replacements land; retain historical evidence as historical evidence.
- OpenObsidian baseline inspected for this goal: commit `d0ad51c0c5bc3480a6f4527b8cc3dbc57063ad79`. At implementation start record the actual starting HEAD and reconcile intervening changes.
- Retain OpenObsidian naming and **AGPL-3.0-only** licensing. Photocraft's MIT/Apache licensing does not change this project's license. Preserve applicable third-party attribution.
- Keep current scope: desktop, in-place Obsidian vaults, Standard/opt-in Chronicle vaults, core workflows, bounded plugin/theme compatibility, managed/BYOK/local AI seams and recovery. Mobile, owned sync, operated hosting/billing and public release remain separate scope.

## Reference stack: source-verified Photocraft analysis

Analysis performed on 2026-10-07 using **gh-helper `get_file_contents`**, pinned to Photocraft commit `47f9306fd06d5dee11acb84b108606f4c867222a`. The gh-helper repository-question endpoint returned `Tool not found`; conclusions below come from retrieved manifests and CI source, not its unavailable generated analysis.

Versions below are manifest declarations, not assertions about exact versions resolved in `Cargo.lock`. Inspect the reference lockfile during dependency setup, commit OpenObsidian's own lockfile and build with `--locked` in CI.

| Layer | Verified Photocraft choice | OpenObsidian migration requirement |
| --- | --- | --- |
| Language/workspace | Rust edition `2024`, `rust-version = "1.95"`, resolver `3`; `crates/*`, `apps/*`, `xtask` workspace members | Adopt the same language baseline and workspace organization; select and record a compatible toolchain in CI. |
| Native UI | `egui = "0.36"`, `eframe = "0.36"`; desktop features `default_fonts`, `wgpu`, `accesskit`, `wayland`, `x11`, `persistence` | Implement the desktop UI in Rust using egui/eframe and its wgpu backend; enable native accessibility and Linux window-system support. |
| UI extras | `egui_extras = "0.36"` with SVG support | Use for applicable native UI assets and widgets. Translate HTML/CSS/SVG surfaces to native widgets and painting. |
| Domain boundaries | Separate domain crates, engine, `ui-egui`, desktop/CLI applications and testkit | Separate pure note/vault models, privileged operations, native UI and platform services; enforce dependency direction. |
| Data/errors/logging | `serde = "1"` with `derive`/`rc`, `serde_json = "1"`, `thiserror = "2"`, `log = "0.4"` | Use shared typed contracts, explicit errors and privacy-aware logging. |
| Background work | Native `rayon = "1"` in engine/UI/plugins | Use Rayon and bounded workers/channels for indexing and expensive work, keeping the UI responsive. The inspected manifests do not establish Tokio as the application runtime. |
| OS services | `rfd = "0.17"`, `arboard = "3.6"` with `wayland-data-control`, `open = "5"` | Use native dialogs, clipboard and external-open adapters behind scoped application interfaces. |
| UI persistence | eframe persistence; desktop `ron = "0.12"` reads saved window layout | Use for app-owned UI preferences/layout only. Existing vault files remain authoritative. No database was established by the inspected manifests. |
| Plugins | `wasmi = "2.0.0"`, defaults disabled, features `std`, `validate`, `stable`, `portable-dispatch`; resource-limited WASM host | Adopt a bounded WASM extension host for Rust-era plugins. Resolve legacy JavaScript compatibility separately, with explicit evidence. |
| Platform adapters | macOS `fmv-macos-events = "=0.1.0"`; Windows build dependency `winresource = "0.1"` | Evaluate the same helpers for file-open events and executable resources; keep platform-specific dependencies conditional and narrowly scoped. |
| Quality/tooling | `proptest = "1"`, `criterion = "0.5"`, `egui_kittest = "0.36"`; Cargo fmt/Clippy; Cargo `xtask` alias | Port contract/property tests, UI scenarios, benchmarks and repository gates to Rust and execute them in GitHub CI only. |
| Build discipline | Workspace `unsafe_code = "forbid"`; thin release LTO and one codegen unit; `xtask layers` CI gate | Adopt the same defaults and layering gate; document any narrowly isolated platform FFI requirement. |

Primary source links:

- [Workspace manifest](https://github.com/storytold/photocraft/blob/47f9306fd06d5dee11acb84b108606f4c867222a/Cargo.toml)
- [Desktop manifest](https://github.com/storytold/photocraft/blob/47f9306fd06d5dee11acb84b108606f4c867222a/apps/photocraft/Cargo.toml)
- [UI manifest](https://github.com/storytold/photocraft/blob/47f9306fd06d5dee11acb84b108606f4c867222a/crates/ui-egui/Cargo.toml)
- [Engine manifest](https://github.com/storytold/photocraft/blob/47f9306fd06d5dee11acb84b108606f4c867222a/crates/engine/Cargo.toml)
- [Plugin manifest](https://github.com/storytold/photocraft/blob/47f9306fd06d5dee11acb84b108606f4c867222a/crates/plugins/Cargo.toml)
- [xtask manifest](https://github.com/storytold/photocraft/blob/47f9306fd06d5dee11acb84b108606f4c867222a/xtask/Cargo.toml) and [Cargo alias](https://github.com/storytold/photocraft/blob/47f9306fd06d5dee11acb84b108606f4c867222a/.cargo/config.toml)
- [CI workflow](https://github.com/storytold/photocraft/blob/47f9306fd06d5dee11acb84b108606f4c867222a/.github/workflows/ci.yml): Linux/macOS/Windows matrix, stable toolchain, Rust cache, fmt, locked tests, Clippy, layering, corpus and WASM checks, optional manual fuzzing.

Use the applicable native application stack. Photocraft's photo codecs, color processing, tablet input and image formats are domain-specific and do not become OpenObsidian requirements. Its browser/WASM app also does not expand the desktop scope. The application architecture is Rust with native egui/eframe UI; replacing only the Electron host while retaining the HTML/TypeScript renderer does not fulfill this migration.

Any additional Markdown/YAML, filesystem-watching, HTTP, credential-storage, hashing or Git dependencies are **OpenObsidian-specific selections**, not verified Photocraft dependencies. Record their purpose, pinned version, license and CI evidence before adoption. Preserve existing SHA-256 revision/integrity contracts even though Photocraft's engine declares BLAKE3.

The R1.2 compatibility feasibility experiment adds **Wry `=0.57.0`** (MIT OR Apache-2.0) and **winit `0.30`** as a narrow legacy JavaScript/DOM host candidate. Linux CI uses GTK 3 and WebKitGTK 4.1; macOS uses WKWebView and Windows uses WebView2. This is an OpenObsidian-specific dependency selection, not part of Photocraft's app UI stack. It exists to test unchanged Obsidian bundles against a real browser DOM before deciding whether a product runtime is viable. Keep the result feasibility-only until exact-SHA CI records the browser engine version, plugin bundle hashes, workflows and capability denials on all three operating systems. Wry's `build_as_child` Linux path covers X11; Wayland needs GTK container integration and remains a separate compatibility condition. See [legacy plugin runtime feasibility](../../../docs/architecture/legacy-plugin-runtime.md).

## Current project and target architecture

The inspected project uses Electron `44.3.0`, electron-builder `26.16.1`, TypeScript `7.0.2` and Bun `1.4.2`, with a plain HTML/DOM TypeScript renderer. There is no React dependency in `package.json`. `src/electron` owns privileged operations and the allowlisted preload bridge; `src/renderer` owns UI/popouts; `src/core` owns vault and product behavior; `src/shared` holds contracts and platform-neutral UI transforms; `src/plugins` contains compatibility policy and artifact probes. Existing GitHub workflows already cover three desktop OSes.

Proposed Rust workspace (names are implementation choices, not Photocraft crate names):

| Target | Existing responsibilities to port |
| --- | --- |
| `crates/doc` | Markdown/YAML source spans, links, Canvas/Bases models, configuration and byte-preserving transforms from `src/core`. |
| `crates/vault` | Scoped paths, revisions, journaled writes, attachments, rename transactions, history, conflict recovery and watcher reconciliation. |
| `crates/engine` | Workspace workflows, graph/index/retrieval, changeset approval, provider/model orchestration and privileged operation broker. |
| `crates/platform` | Dialogs, clipboard, file-open events, credential store, storage protection and native window/platform services. |
| `crates/plugins` | Permission policy, preview broker, bounded extension execution, artifact integrity and compatibility reporting. |
| `crates/ui-egui` | Native workspace/editor/preview, navigation, graph, Canvas, Bases, settings, AI review, themes and popouts. |
| `crates/testkit` | Shared synthetic vaults, failure injection, fixture readers and CI report helpers. |
| `apps/openobsidian` | Native eframe desktop entry point and composition of services. |
| `apps/openobsidian-cli` | Existing CLI/entry-point behaviors where specified by product contracts. |
| `xtask` | Layering, fixture/contract audits, packaging, notices, progress validation and performance gates. |

Keep models independent of UI/platform code. All writes, AI actions and plugin requests pass through the revision-aware broker. Replacing IPC with in-process typed calls must preserve validation and capability checks. In-process Rust modules alone do not establish a security boundary for untrusted extensions.

## Product invariants and migration risks

- Open existing vault directories in place without conversion. Preserve original bytes where untouched, including BOM, line endings, frontmatter/property spans, unsupported YAML constructs, JSON unknown fields, attachments and `.obsidian` artifacts. Derived indices and opaque AI state remain outside authoritative vault content.
- Preserve path confinement, symlink/platform-name rules, revision checks, temporary-write/replace behavior, journaling, rename recovery, conservative merge, undo and failure recovery. Protect unresolved conflicts and retain configurable 30-day/5 GiB history policies.
- Port notes/properties, search, links/backlinks/transclusions, graph, Canvas, native/embedded Bases, bookmarks, tags, tasks, templates/daily notes, tabs/splits/popouts and keyboard workflows from the existing contract inventory. Include editing selection, undo/redo, clipboard, IME, Unicode and accessibility in native UI acceptance.
- Preserve managed/BYOK/local modes, visible context, exclusions before indexing/inference, no silent local fallback, grounded retrieval, revision-aware per-file AI review and credential isolation. Replacing Electron `safeStorage` needs a native OS credential migration plan; never silently discard old credentials or fall back to plaintext.
- Keep Standard/Chronicle behavior, external-sync reconciliation, privacy defaults, return-to-Obsidian portability and app-owned data cleanup.
- **Keep all related repository documentation current throughout the migration.** Update affected user guides, architecture and developer/contributor docs, build/run/test instructions, packaging/update guidance, vault and credential migration notes, plugin/theme compatibility and security guidance, platform support information, contracts, and configuration examples in the phase that changes them. At cutover, audit the tracked documentation for obsolete Electron-specific instructions, broken links, and mismatches with the shipped Rust behavior. Preserve historical records as historical; do not present pending or unsupported behavior as available.
- **WASM does not run existing Obsidian JavaScript bundles or supply a DOM.** Retain the unchanged-artifact PC01–PC25/dependency/theme inventory, hashes and certification rules. During the compatibility phase, establish whether a mediated isolated legacy runtime can meet required workflows within the Rust architecture; record any extra runtime as a justified dependency. Native substitutes or WASM ports do not count as unchanged-artifact certification.
- Translate supported appearance settings into egui styling. Existing CSS/private DOM selectors cannot be assumed compatible. Preserve theme assets and report proven limits visibly.
- Missing implementations, ordinary failures and untested workflows remain migration blockers. Only a reproduced unsafe-boundary conflict can use the previously authorized D15 unsupported-security disposition, with evidence, safe-alternative analysis, denial checks and a visible compatibility entry. Do not silently reduce scope to make the Rust build pass.

## Mandatory execution workflow: GitHub CI only

1. Work on `main` and verify the existing `origin` points to this project's repository. Photocraft is the reference, not the push destination. Preserve unrelated work and reconcile remote changes safely; do not force-push.
2. **Run tests only in GitHub Actions CI. Do not run local tests, smoke tests, benchmarks, runtime probes, application launches for validation, or local build/type/lint/validation commands as substitutes for CI.** Local source inspection, editing and Git operations are permitted. Compilation, formatting checks, Clippy, packaging checks, fixture audits and all executable validation belong in CI.
3. Break every phase into small, coherent slices with focused commits, for example `[rust R2.1] Port revision-checked vault reads`. Avoid accumulating the migration into one large commit.
4. **Commit and push to `origin/main` whenever a CI result is needed, and after each completed phase or specific milestone.** An intermediate push can request validation before phase completion. Include the needed workflow changes and tests in that commit so CI tests the actual implementation.
5. Find the GitHub Actions runs for the exact pushed SHA. Inspect every required job and platform, retain run URLs/IDs and artifact links, and record failures. When a workflow is cancelled, skipped, queued or unavailable, validation remains pending. A pass from an earlier SHA does not validate changed implementation.
6. Fix CI failures in another small commit, push to `origin/main` and obtain fresh results. For infrastructure failures, rerun the affected exact-SHA jobs and record the cause; do not substitute local testing.
7. Mark a phase complete only after its acceptance criteria and required CI jobs pass for its implementation SHA. Record human/platform checks that CI cannot prove as explicit external handoffs; never present them as automated passes.
8. Avoid superseding a required pending run with unrelated pushes when CI concurrency would cancel the evidence needed for phase acceptance. Batch a coherent slice, push, inspect the necessary results and then continue.

Port the existing workflows incrementally. Keep Bun/Electron CI as a behavioral reference during transition, running solely in GitHub Actions. Add Rust fmt, Clippy, locked builds/tests, fixture/differential checks, egui interaction/snapshot tests, layering gates and native artifact checks on Ubuntu/macOS/Windows. Configure Linux native/windowing and headless GPU dependencies on the runners. Use cached dependencies and upload actionable failure logs and preview artifacts. Remove obsolete Electron checks only after their equivalent Rust coverage exists.

## Phases and acceptance

Each row is a phase, not a required single commit. Split into smaller numbered milestones and push each when CI evidence is needed or a milestone is reached.

| Phase | Deliverable | Required GitHub CI acceptance |
| --- | --- | --- |
| R0: inventory and traceability | Map existing requirements/modules/tests/fixtures to Rust owners; record current pending gaps, dependency decisions and reference pins; initialize migration progress files. | CI validates the migration inventory and runs the current baseline, recording inherited failures separately. |
| R1: workspace, feasibility and native foundation | Cargo workspace, lockfile/toolchain, crate boundaries, a narrow unchanged-plugin isolation/UI feasibility spike, minimal native eframe app, xtask alias, logging and three-OS Rust workflows. Complete the compatibility spike before broad native UI investment. | Locked workspace build/tests, fmt, Clippy and layering pass; representative JavaScript/DOM plugin workflows and denied capabilities are evidenced across the OS matrix; native preview artifacts produced. |
| R2: vault and document safety | Port source-preserving document models, revision hashing, scoped IO, transactions, journal/recovery, attachments, history, watcher and rename/merge behavior. | Rust fixture/differential, property and failure-injection suites cover existing safety cases on all three OSes; unchanged bytes and recovered files are verified. |
| R3: native workspace and core workflows | Port the editor and workspace contracts, previews, indices/navigation, graph/Canvas/Bases, keyboard/accessibility and multiwindow behavior. | egui interaction/snapshot checks plus end-to-end synthetic vault workflows pass; editing and persistence agree with fixtures. |
| R4: extensions and appearance | Implement bounded wasmi host and compatibility policy; resolve legacy bundle/theme execution and supported native appearance projection. | Artifact integrity, resource limits, capability denial, lifecycle/restart/recovery and required plugin combinations are exercised; each legacy compatibility row has evidence and an honest disposition. |
| R5: AI, credentials and recovery workflows | Port retrieval, providers/model lifecycle, context controls, changeset approval, native credential handling, Chronicle/sync and portability. | Provider mocks, exclusion/privacy, stale-write rejection, undo/recovery, credential failures/migration and synthetic portability workflows pass without real secrets or personal vaults. |
| R6: packaging and cutover | Replace electron-builder with native packaging tooling; preserve icons/app identity/notices, update/rollback contracts and three-OS preview delivery; migrate app-owned settings safely. | Installable preview artifacts, launch/file-open/clipboard scenarios, package audits and full Rust gates pass in CI; platform limitations remain recorded. |
| R7: completion evidence | Retire shipped Electron/renderer and obsolete tooling after coverage replacement; update README, contracts, status, and all related user, architecture, developer, build, packaging, update, compatibility, security, and platform documentation; audit for stale Electron instructions; produce final feature matrix and release handoff. | Full applicable Rust CI passes for final implementation SHA; all mandatory migration rows are satisfied or meet authorized D15 evidence rules; documentation matches shipped behavior and stale instructions are removed or clearly historical; remaining external work is explicit. |

Packaging format, updater integration and signing implementation require their own documented choices; Cargo/eframe alone do not replace electron-builder's delivery features. Production signing, tags and publication remain governed by the existing release scope and external credentials.

## Durable progress and resumption

Create migration-specific `state.json`, `requirements.json`, `journal.md`, `evidence/` and `release-handoff.md` beside this file during R0. Link historical records instead of rewriting their outcomes. Keep personal vault content and credentials out of reports.

- `state.json`: starting/last reconciled HEAD, current phase/milestone, completed work, exact next action, blockers, implementation SHAs, push status and required CI run/results per OS.
- `requirements.json`: stable requirement IDs, original source, Rust owner, acceptance criteria/fixtures, phase, status and evidence. Separate implementation, compatibility-security and external-release rows.
- `journal.md`: append a concise handoff after each meaningful slice and CI result, including failures and unfinished operations.
- `evidence/`: store exact tested SHA, workflow/run URL and ID, OS/toolchain/dependency versions, job conclusion, artifact hashes and limitations. A fixture projection is not evidence of unchanged plugin execution.
- `release-handoff.md`: enumerate remaining human validation, signing, publication and service setup with prerequisites and verification steps.

On resume, read these files, inspect local/remote Git state, reconcile pending CI runs by SHA and continue the next unfinished milestone. Do not repeat completed work or promote pending/failing checks to passing.

## Definition of done

The shipped desktop application and its first-party core/UI/platform services run in Rust on the verified Photocraft native stack. Existing vaults remain portable and safe. All required product workflows, compatibility dispositions, privacy controls and recovery guarantees have traceable acceptance evidence. Rust delivery tooling produces three-OS artifacts and replaces obsolete application tooling. Small migration commits are reachable on `origin/main`, and the final implementation has passing required GitHub CI results with exact-SHA evidence. Remaining human, signing, operated-service and public-release work is documented separately. No local test result is used as migration acceptance evidence.
