# Rust migration journal

## R0.1 — preflight and traceability preparation

Read the Rust goal, prior goal/plan and module specifications. Local and remote main agree at d0ad51c. Baseline GitHub quality passes on all three desktop OSes. Compatibility refresh has upstream drift; loaded-plugin workflow remains queued. No local tests or executable validation were run.

Prepared all 196 legacy requirement rows with provisional Rust owners and fresh pending migration status, plus source/test/fixture/tooling inventory. These mappings need clause-by-clause review. GitHub identity w3research cannot push (HTTP 403), so no migration CI result or completed R0 milestone is claimed.

Next: restore write access, push this small R0.1 commit, inspect the exact-SHA migration and baseline CI jobs, then finish inventory review before R1.

## R0.1 — commit and push attempt

Local implementation commit: b1dbd9f. `git push origin main` returned exit 128 / HTTP 403, permission denied to w3research. The commit remains local; no migration CI was triggered and R0 remains in progress. Next action is restoring write access and pushing the prepared commit.

## R0.1 — write access restored

Connected repository identity now reports push permission. Both prepared commits pushed successfully to origin/main at 74049947d4816049ce187b9f3d23e1e804c52b59. Inventory, quality, desktop-build, renderer and loaded-plugin CI runs started; their results remain pending. Previous access failures remain historical evidence.

## R0.1 — GitHub CI acceptance

Inventory 37666896485, quality 37666896526, desktop build 37666896581, plugin renderer 37666896500 and loaded workflows 37666896720 passed for exact SHA 74049947d4816049ce187b9f3d23e1e804c52b59. All applicable baseline platform jobs passed. Evidence: evidence/r0.1-ci.json. R0.1 is complete; R0 remains in progress because the provisional ownership and runtime acceptance mapping still need review. No Rust feature or plugin certification status is promoted.

## CI preparation — native parallel steps

Before Rust implementation, group nine read-only contract/source checks in the quality job and both read-only post-package audits in the desktop job using GitHub Actions `parallel`. Preserve dependency installation, state validation, synthetic/runtime tests, compilation, sandbox setup and artifact production ordering. The group barrier requires every audit before artifact upload. Reconcile changed workflow inventory hashes while preserving original hashes. Validation is pending GitHub CI; no local checks were executed.

## CI preparation — verified on GitHub Actions

Parallel implementation f38c0ef40cd073cc8c6aada74adbf190b15ac0f2 passed quality 37667876075, desktop packaging 37667875966, inventory 37667875876, renderer 37667875978 and loaded-plugin 37667875884. All matrix jobs succeeded on Ubuntu/macOS/Windows. Quality timestamps show overlapping child steps. Evidence: evidence/parallel-ci.json. No local checks were run. CI preparation is complete; next migration operation remains R0.2 ownership/runtime-acceptance review.

## R0.2 — requirement and source ownership review

Reviewed 196 inherited acceptance rows against the Rust goal and added 14 migration-specific rows for Rust stack, CI-only testing, phased pushes, native UI, unsafe policy, plugin/runtime compatibility and credential migration. Assigned every one of 231 inventoried paths to a target crate/workspace owner; tests and fixtures also name the shared testkit role. Electron-only decisions/proposals are explicitly marked superseded; other Rust acceptance remains pending and historical passes stay historical. CI inventory is the next gate.

## R0.2 — decisions and acceptance review

Mapped all 196 inherited rows and added 15 migration-specific rows, including the early unchanged-JavaScript/DOM plugin feasibility gate. Corrected the target owner map across 231 inventoried files; historical pass evidence is preserved, Rust work starts pending, Electron architecture-only rows are superseded, and external rows remain external_pending. Recorded the Rust stack, vault hashing, plugin cohort, credential migration and GitHub CI decisions in decisions.md. Next gate: exact-SHA GitHub inventory and baseline workflows.

## R0.2 — mapping refinement

Corrected graph/UI, Canvas/document, platform configuration/storage, responsiveness and upstream-drift ownership. Added MIG-015 for an early cross-platform unchanged-JavaScript/DOM plugin feasibility gate before broad native UI investment. The reviewed inventory now carries 211 rows: 196 inherited product clauses and 15 Rust migration clauses. Rust acceptance stays pending; 11 Electron-only proposals are explicitly superseded and 10 external requirements remain pending.

## R0.2 — GitHub CI acceptance

Exact SHA d79e500d18fe87c23c7617bdc5fcdd9c10ef7c74 passed the migration inventory (37669022715), quality (37669022778), desktop build (37669022762), plugin renderer (37669022845) and loaded-plugin workflows (37669022789). All required jobs and platform matrices passed. The quality and desktop workflows also passed with the new GitHub Actions parallel-step groups. Evidence: evidence/r0.2-ci.json. R0 is complete.

## R1.1 — native Rust foundation started

Started a minimal Cargo workspace and native eframe shell based on the recorded Photocraft stack. The initial Rust CI will run only in GitHub Actions on Ubuntu, macOS and Windows. Workspace compilation does not complete plugin compatibility; MIG-015 remains the R1 gate before broad native UI work.

## R1.1 — first Rust CI feedback and correction

Exact-SHA Rust CI for 05ed884e1538a31d5229fe2e92f718f452030b48 caught Rustfmt differences and that eframe 0.36 implements `App::ui` rather than `App::update`. The first Linux formatting job and macOS/Windows compile jobs failed; the correction updates the UI entrypoint and applies the formatter layout reported by GitHub. GitHub Actions generated Cargo.lock in run 37669853135; its artifact digest is e12ecff53e0b4613a3077731c3862ff674f7db738d7dc8aa392a9dde20fd128b. The lockfile is now committed with the correction and Rust CI will enforce it with `--locked`. R1.1 remains in progress pending fresh three-OS CI.

## R1.1 — GitHub CI acceptance

Rust CI 37671111006 passed on Ubuntu, macOS and Windows for exact SHA f5a9c281f096928b2fad4f40ee9ca6a9dcfdc4eb. Formatting, workspace tests, Clippy, crate layering and release builds succeeded. GitHub uploaded the Linux native preview; its ID, size and digest plus the exact Rust/toolchain and lockfile record are in evidence/r1.1-ci.json. The existing inventory, quality, desktop, plugin-renderer and loaded-plugin workflows also passed for this SHA (run IDs 37671110921, 37671111067, 37671110915, 37671110973 and 37671110997). The first Rust CI attempt at 05ed884 failed on formatting and the eframe 0.36 API; the recorded correction passed. R1.1 is complete.

## R1.2 — unchanged-plugin feasibility gate started

Next is the narrow JavaScript/DOM runtime feasibility spike from MIG-015. Existing Electron probes use a Node/Electron worker and bounded DOM mocks; those results do not establish a Rust-hosted runtime. Keep broad native UI work paused until an unchanged-artifact compatibility path and denied-capability behavior have GitHub CI evidence on Linux, macOS and Windows.

R1.1 artifact integrity: downloaded the GitHub preview archive without launching it. The Linux executable SHA-256 is 65d37b19f076826ab056919873fa0851c4a8eae1da188887b173b04218a84ac2 (20,776,344 bytes); archive details are retained in evidence/r1.1-ci.json. `egui_extras` and `rayon` remain declared workspace dependencies but are not yet used by the foundation crates; their first use will add them to Cargo.lock in the relevant migration slice.

## Goal update — documentation maintenance

Added the user-edited goal clause requiring documentation to stay current in each phase and an explicit final stale-instruction/link/behavior audit. Reconciled it as MIG-016 and RM-08, updated the inventory validator to require 16 Rust-specific rows, and preserved the R0.2 historical count at 211. Updated goal SHA-256: 89ed20b10116ecc814509f368935a284fa94f209b54a2055f71815cbd4099c87.

## R1.2 — Wry unchanged-plugin feasibility probe

Implemented a separate Rust probe executable using Wry `=0.57.0` and winit `0.30`; the native application UI remains on eframe. The probe verifies each unchanged bundle, release manifest and stylesheet against the pinned compatibility manifest, then runs PC05 Advanced Tables and PC08 Style Settings inside the system WebView. It captures the WebView engine and UA, real DOM metrics, plugin API registrations, a DOM-backed editor callback attempt, and representative denials for direct filesystem, process, common network requests and credential modules. The in-memory custom protocol serves only the probe page, exact plugin code and optional style asset. Reports remain `feasibility-only` and leave `LegacyCompatibility::Pending`.

The WebView uses a restrictive content policy, internal navigation only, denied permissions/new windows/downloads and a report-only IPC path. This experiment allows `'unsafe-eval'` for CommonJS compilation. The Mac WebView clipboard setting cannot disable clipboard access, and the Linux probe is X11-only; Wayland GTK integration is not established. These are explicit R1.2 limitations, not claims of product-level isolation.

Source review tightened navigation to the exact localhost probe document (including Wry's Windows localhost alias), rejected unexpected custom-protocol asset hosts, denied frame ancestors and disabled general autofill where the platform supports it. The Linux loop pumps GTK every 10 ms while waiting for WebKit and IPC events. Wry's 0.57.0 documentation confirms the `winit` event-loop/GTK integration and Linux X11-only child-WebView path; Wayland remains unproven. MIG-015 and the mapping's goal hash now point to the Wry-specific goal revision.

No local compile, test, format, lint or runtime validation was run. Cargo is not installed in the workspace. Source SHA ce6097ab2625bddb34905b85a47a35b7e7fa602e was pushed with push-triggered CI skipped, then the temporary resolver completed successfully in GitHub Actions run 37678837444. It uploaded artifact 11508186485 (SHA-256 `7b72eb720f50343361e9b99363ebad8ee3b545440adad5b42426e4bffb7fe46d`); the retrieved Cargo.lock is 139,659 bytes with SHA-256 `dfc3e567b971232e9f9b0e6768c161fdadddfeae7622f0925baab0c6fdb556f9`. The resolver workflow is now removed. This is lock generation only, not compilation or runtime evidence. Next: push the locked source slice and inspect exact-SHA Rust and unchanged-plugin CI on all three operating systems.

## R1.2 CI feedback — source SHA 3b509255

The locked implementation SHA 3b509255b65c3b8d669cc225df3af75147392e61 triggered the full Rust and legacy CI. Plugin renderer, loaded workflows and desktop packaging passed (runs 37679025185, 37679025165 and 37679025241). Inventory run 37679025320 failed because MIG-015's owner no longer matched the guard and the new Bun audit script was absent from inventory; quality run 37679025129 found a nullable TypeScript access in the new script. Both issues are corrected in the working tree and will be pushed as a small CI-fix commit. The exact-SHA Rust matrix 37679025109 is still running; its results remain pending.

## R1.2 CI completion — source SHA 3b509255

Rust matrix 37679025109 completed with Linux formatting failure and macOS/Windows workspace-test compile failures. Rustfmt requested import ordering and line wrapping in `main.rs`; Wry 0.57's navigation handler takes an owned `String`, while the probe passed a `&str` function item. No compilation, tests or plugin probes passed on that SHA. The correction commit e264e9f65da1cad16e23b55cec3a510379ebd072 passes the inventory and quality matrices (runs 37679500393 and 37679500532); its Rust matrix is still running. The exact CI-reported Rust formatting and callback adaptation are prepared for the next small commit.

## R1.2 CI feedback — Linux X11 runtime dependency

The Rust CI run for source SHA 21928f8658ef948853d351da13734b1523be81d5 passed Linux formatting, workspace tests, Clippy, dependency-layer checks and the native release build. The unchanged-plugin probe then failed before WebView creation during winit's X11 XKB event-loop initialization. Its uploaded report (run 37680987992, job 112996658714, artifact 11509255875) records pinned bundle and manifest integrity passing for PC05 and PC08, but zero plugins executed. The headless runner installs `libxkbcommon-dev` without Ubuntu's `libxkbcommon-x11-0` runtime library, so the CI setup now adds that dependency; the runtime documentation records the finding. This is an environment setup failure, not plugin compatibility evidence. The exact-SHA macOS and Windows jobs are still running at this journal entry.

## R1.2 desktop plugin probe feedback — source SHA 21928f8

The completed macOS and Windows jobs in run 37680987992 both launched Wry and passed the direct capability-denial probes; the verified PC05 and PC08 bundles still failed before onload because the shim omitted Obsidian's `Modal` superclass. Their runtime reports are retained as artifacts 11510040712 (macOS) and 11510475254 (Windows), with summaries in `evidence/r1.2-plugin-runtime-desktop-21928f8.json`. Static inspection verified the downloaded bundles against the pinned SHA-256 values and found Modal subclasses in both. The probe adds a minimal Modal API/DOM fixture and fixes the Obsidian DOM helper's string argument to mean CSS classes. All results remain feasibility-only; R1.2 remains in progress until the updated exact-SHA CI reports are reviewed.

## R1.2 metadata CI feedback — source SHA 356e2a1

Inventory run 37682834615 found that the nested R1.2 state entry was missing its `next_action` property name; the CI JSON parser identified the exact line, and the property is restored in the follow-up. Quality run 37682834698 passed on macOS and Windows but the Ubuntu Electron vault round-trip audit failed before reaching its local retrieval boundary. The same workflow passed on source SHA 21928f8, so this is tracked as a separate exact-SHA CI result and must pass on a fresh run before closing the slice.

## R1.2 Linux XKB dependency confirmation — source SHA ee263c6

After adding `libxkbcommon-x11-0`, the Linux CI probe reached Wry/WebKitGTK 2.52.6 under Xvfb, verified both pinned plugin assets and passed the capability-denial checks. Both plugins then failed at the missing `Modal` superclass. Artifact 11510616191 and its digest are recorded in `evidence/r1.2-linux-xkb-runtime-ee263c6.json`. This confirms the Linux runner dependency correction; the `Modal` fixture is included in the following exact-SHA run.

## R1.2 Windows workspace-test finding — source SHA d96d781

Rust CI run 37683082486 failed in the Windows vault test while scanning a temporary vault (`Access is denied`); the test helper named directories from a timestamp, which can collide when tests start concurrently. The helper now allocates process-scoped, monotonically numbered directories with atomic `create_dir` and retries existing names. The Windows fix and the Linux XKB evidence are queued for a fresh exact-SHA GitHub Actions run. At this checkpoint macOS had passed workspace tests, Clippy and layer checks and was building the native preview; Ubuntu was still installing Linux dependencies.

## R1.2 macOS plugin-shim findings — source SHA d96d781

The macOS Wry job built successfully and reached the unchanged-plugin probes. Artifact 11509358621 (digest `585c46a9477d9fb70ac8c752f33a7352382a266897645889126ccf109f86a2c1`) confirms PC05 integrity and capability denials passed, but its async startup registered no commands before the editor check. PC08 reached `activeWindow` and stopped before rendering settings controls. The exact reports and bundle hashes are summarized in `evidence/r1.2-plugin-runtime-macos-d96d781.json`. Static inspection confirmed PC05 calls `asyncOnload()` without returning its promise and PC08 uses Obsidian's `activeWindow` alias; the probe fixture now waits briefly for startup and supplies that alias.

## R1.2 Linux formatting feedback — source SHA ec27f5a

Linux rustfmt rejected only the new temporary-directory `format!` expression in CI run 37684304691. Its requested layout has been applied from the GitHub log. macOS and Windows passed workspace tests, Clippy, layering and native builds; both Wry probes then failed on the same harness gaps as the earlier macOS artifact: PC05 async startup was not observed and PC08 lacked `activeWindow`. The exact-SHA reports, checksums and five passing companion workflow runs are recorded in `evidence/r1.2-plugin-runtime-desktop-ec27f5a.json`. The follow-up push includes the formatting correction and Wry fixture update.

## R1.2 three-platform Wry probe — source SHA d8c908d

Rust CI run 37685943499 passed format, workspace tests, Clippy, layering and native builds on Ubuntu, macOS and Windows. The unchanged PC05 bundle passed integrity, capability-denial and editor-callback checks on all three WebViews; its settings tab exposed a missing `activeDocument` alias. PC08 passed integrity and capability denials but stopped at the missing `workspace.onLayoutReady` shim before rendering controls. Artifact checksums and exact platform results are in `evidence/r1.2-plugin-runtime-desktop-d8c908d.json`. Static inspection of the verified PC08 bundle also found use of `app.commands.removeCommand` and `app.plugins.plugins`; these minimal APIs and `activeDocument` are now included alongside the layout-ready callback in the next fixture revision. Compatibility remains Pending and feasibility-only.

## R1.2 component lifecycle finding — source SHA a363c77

The a363c77 matrix passed format, workspace tests, Clippy, layering and native builds on all three OSes. PC05 passed its settings and editor probes; PC08 loaded and passed capability checks but could not display settings because the fixture lacked `Component.addChild`. The three platform reports and digests are captured in `evidence/r1.2-plugin-runtime-desktop-a363c77.json`. The official [Obsidian API declaration](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts) defines `addChild` as returning and loading a child when the parent is loaded, and `removeChild` as unloading it. The fixture now models child tracking and lifecycle and invokes the plugin through `Component.load()` so the loaded-parent state is represented.

## R1.2 component lifecycle follow-up — source SHA ca83049

The ca83049 Rust matrix passed Ubuntu formatting and passed workspace tests, Clippy, crate layering and native preview builds on Ubuntu, macOS and Windows. PC05 passed integrity, capability denial, settings and editor-callback checks on all three platforms. PC08 loaded, registered and displayed its settings tab, and passed integrity and capability checks, but rendered zero controls. Exact report hashes, artifact digests, WebView versions and companion workflow results are in `evidence/r1.2-plugin-runtime-desktop-ca83049.json`. Source inspection of the unchanged PC08 bundle found that it scans `document.styleSheets` via each `ownerNode.textContent` and debounces parsing for 100 ms. The probe had supplied only the pinned external plugin stylesheet and waited 50 ms. The follow-up now extracts the PC08 scenario's `Themes/Minimal.css`, checks its SHA-256 in both the audit script and Rust host, injects it as a text-backed style element and waits 150 ms before displaying settings. No local executable checks were run; exact-SHA GitHub CI is required, and R1.2 remains pending.

## R1.2 theme fixture follow-up — source SHA 2332189

The exact-SHA Rust matrix for 2332189847ef767ebef852087caa6b569aaee466 passed Ubuntu formatting and passed workspace tests, Clippy, layering and native builds on Ubuntu, macOS and Windows. PC05 passed its end-to-end probe on all platforms. PC08 reported the configured theme fixture path and matching SHA-256 on all platforms; its stylesheet rule count increased from 104 to 110, confirming CSS discovery. Settings generation then failed because the shim lacked `Setting.then`; all hashes, reports and companion gates are recorded in `evidence/r1.2-plugin-runtime-desktop-2332189.json`. The official [Obsidian API declaration](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts) documents `Setting.then(cb)` as a chain callback that returns the setting. The current follow-up implements that method and the observed settings DOM/search/extra-button/slider hooks, and checks both workflow-declared control IDs. No local executable validation was run; the next push must pass exact-SHA GitHub CI, and R1.2 remains pending.

## R1.2 debounce finding and GitHub Actions parallel steps — source SHA 787b2e8

Rust CI run 37692387013 passed formatting, workspace tests, Clippy, layering and native builds on Ubuntu, macOS and Windows. PC05 passed unchanged-bundle, capability-denial and editor checks on all three systems. PC08 verified the configured theme CSS and parsed 110 rules, then failed at the missing Obsidian `debounce` export before rendering both expected controls. Exact reports and artifact digests are recorded in `evidence/r1.2-plugin-runtime-desktop-787b2e8.json`; the five companion workflows all passed on the same SHA. The official [Obsidian API declaration](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts) documents `debounce` and its cancellable/runnable wrapper; the probe now includes a timer-based implementation. The quality and desktop workflows already use GitHub Actions `parallel` groups, and both passed on this SHA. Rust CI now groups only independent formatting and workspace tests; Cargo Clippy, layer checks and builds remain ordered because they share build output. These workflow/source updates are local and require exact-SHA CI after push. R1.2 remains in progress and compatibility remains Pending.

## R1.2 debounce follow-up and parallel-step CI — source SHA 932db65

Rust CI run 37694605581 passed formatting on Ubuntu, workspace tests on all three systems, Clippy, layering and native preview builds. Its Rust `parallel` group passed; Ubuntu's format check and workspace tests started at the same timestamp and completed successfully. The five companion workflows also passed on the exact SHA. PC05 passed unchanged-bundle checks on Linux, macOS and Windows. PC08's `debounce` exception disappeared, but all three reports still lacked the expected `compact` and `accent` IDs while confirming the theme fixture hash and 110 stylesheet rules. Reports and artifact digests are in `evidence/r1.2-plugin-runtime-desktop-932db65.json`. Static inspection of the pinned PC08 bundle confirmed a 100 ms `setTimeout` around CSS parsing; the next probe slice waits 300 ms and records bounded empty/error messages plus asynchronous WebView errors so CI can distinguish parser and rendering failures. No local executable validation was run; R1.2 remains pending and compatibility remains Pending.

## R1.2 workspace event API finding — source SHA 397363e

Rust CI run 37696015863 passed formatting on Ubuntu, workspace tests on all three systems, Clippy, layering and native preview builds. The Rust parallel group passed, and all five companion workflows passed. PC05 passed on every platform. The new asynchronous diagnostics showed PC08's CSS initialization stopped on `this.plugin.app.workspace.trigger is not a function`; the missing event method prevented settings from reaching the DOM. Exact platform reports and artifact digests are in `evidence/r1.2-plugin-runtime-desktop-397363e.json`. The official [Obsidian API declarations](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts) expose the inherited `Events.trigger` method. The fixture now records Workspace listeners and dispatches the `css-change` event through them. No local executable validation was run; the exact-SHA CI after push must verify the next probe slice. R1.2 and compatibility remain pending.

## R1.2 workspace event follow-up — source SHA 43b1209

Rust CI run 37697107538 passed formatting on Ubuntu, workspace tests on all three systems, Clippy, layering and native preview builds. The Rust parallel group passed and all five companion workflows were green. PC05 passed on Linux, macOS and Windows. PC08 no longer reported the `Workspace.trigger` exception, but still rendered neither expected control; its async-error and empty/error-DOM fields were empty. Reports and artifact hashes are in `evidence/r1.2-plugin-runtime-desktop-43b1209.json`. Static inspection showed the unchanged bundle guards component-render failures by logging them through `console.error`; the next probe slice captures bounded console errors to expose that path. No local executable validation was run. R1.2 and compatibility remain pending.

## R1.2 setting heading finding — source SHA f355fdf

Rust CI run 37698233935 passed Ubuntu formatting and passed workspace tests, Clippy, dependency layering and native preview builds on all three platforms. The five companion workflows also passed on the exact SHA. PC05 passed on all three systems. PC08 verified the unchanged bundle and pinned theme CSS (110 parsed rules), then bounded console capture showed `this.settingEl.setHeading is not a function` on Linux, macOS and Windows; each report has no asynchronous errors and renders neither expected control ID. Exact reports, artifact digests and companion run IDs are in `evidence/r1.2-plugin-runtime-desktop-f355fdf.json`. The official [Obsidian settings guide](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/User%20interface/Settings.md) demonstrates `Setting.setHeading()` for section headings; the fixture now adds the `setting-item-heading` class and returns the setting for chaining. No local executable checks were run. R1.2 remains in progress and compatibility remains Pending.

## R1.2 setting class finding — source SHA f87dd5b

Rust CI run 37700260331 passed Ubuntu formatting, workspace tests, Clippy, dependency layering and native preview builds on all three platforms. The five companion workflows also passed. PC05 passed everywhere. PC08 verified its theme fixture and 110 CSS rules; adding `Setting.setHeading()` advanced rendering to the next missing API, `Setting.setClass()`, on Linux, macOS and Windows. Exact reports and digests are recorded in `evidence/r1.2-plugin-runtime-desktop-f87dd5b.json`. The official [Obsidian API declarations](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts) include `Setting.setClass`; the fixture now adds the requested class to the setting row. No local executable tests were run. R1.2 remains in progress and compatibility remains Pending.

## R1.2 global DOM helper finding — source SHA 47639e3

Rust CI run 37701425250 passed Ubuntu formatting, workspace tests, Clippy, dependency layering and native preview builds on all three platforms. PC05 passed everywhere. PC08 advanced through the `Setting.setClass()` shim and rendered the `appearance` setting before stopping at the missing global `createSpan` helper on Linux, macOS and Windows. Exact reports, artifact hashes and companion workflows are in `evidence/r1.2-plugin-runtime-desktop-47639e3.json`. The quality workflow's first macOS Electron vault audit stopped before local retrieval; rerunning the failed job on the same SHA passed. The documented global helper now returns a detached span built with the probe's safe DOM constructor, and is also exported by the `obsidian` shim. No local executable tests were run. R1.2 remains in progress and compatibility remains Pending.

## R1.2 callback-aware DOM helpers — source SHA 7a83009

Rust CI run 37702519338 passed Ubuntu formatting, workspace tests, Clippy, dependency layering and native preview builds on all three platforms. All five companion workflows passed. PC05 passed everywhere. PC08 had no JavaScript errors and rendered three controls, including the `appearance` group, but still did not expose the expected `compact` and `accent` setting IDs. The exact reports and artifact hashes are in `evidence/r1.2-plugin-runtime-desktop-7a83009.json`. Static inspection of the SHA-verified PC08 1.0.9 bundle showed it calls `createEl` and `createFragment` globals, uses callback arguments on Node `createEl`/`createDiv`/`createSpan`, and builds content in `DocumentFragment`s. The next slice implements those documented DOM helpers and callbacks. No local executable tests were run. R1.2 remains in progress and compatibility remains Pending.

## R1.2 collapsed Style Settings section — source SHA b16801c

Rust CI run 37704569741 passed the parallel group, workspace tests, Clippy, layering and native preview builds on Ubuntu, macOS and Windows; Ubuntu formatting passed. All five companion workflows passed. PC05 passed everywhere. The bounded PC08 row snapshot showed an `Appearance` heading with the `is-collapsed` class and only the section heading mounted, with no JavaScript or asynchronous errors. This explains why the expected child IDs were absent: the probe displayed the settings tab but did not open the default-collapsed section. Exact artifact digests and report hashes are in `evidence/r1.2-plugin-runtime-desktop-b16801c.json`. The follow-up clicks initially collapsed Style Settings headings to expand them before checking the expected controls. No local executable validation was run; the new slice requires exact-SHA GitHub CI, and R1.2 remains in progress with compatibility Pending.

## R1.2 expanded Style Settings controls — source SHA 4de1ae5

Rust CI run 37705662792 passed the parallel group, workspace tests, Clippy, layering and native preview builds on all three platforms; Ubuntu formatting passed. The five companion workflows passed. PC05 passed on all platforms. Expanding the default-collapsed PC08 Appearance heading mounted the `compact` toggle. The unchanged Style Settings 1.0.9 bundle then logged that the `accent` variable-color setting lacked valid `default-light` and `default-dark` colors, so its row did not render. The exact bundle's own renderer checks those fields. Per-platform report hashes, artifact digests and CI IDs are in `evidence/r1.2-plugin-runtime-desktop-4de1ae5.json`. The next slice adds valid color defaults to the PC08 theme metadata in both fixture copies and updates the inventory hash. No local executable validation was run; R1.2 remains in progress and compatibility remains Pending.

## R1.2 variable-color fixture schema — source SHA c08207f

Rust CI run 37706599128 passed the parallel group, workspace tests, Clippy, layering and native preview builds on all three platforms; Ubuntu formatting passed. The five companion workflows passed. PC05 passed everywhere. PC08 rendered the `compact` toggle after expanding Appearance, but the unchanged Style Settings 1.0.9 bundle still rejected Accent because `variable-color` requires a `default` field. Static inspection distinguishes this from `variable-themed-color`, which uses `default-light` and `default-dark`. Exact artifact digests and report hashes are in `evidence/r1.2-plugin-runtime-desktop-c08207f.json`. The next slice replaces the incorrect fields with `default: "#3366ff"` in both fixture copies and updates the inventory hash. No local executable validation was run; R1.2 remains in progress and compatibility remains Pending.

## R1.2 feasibility acceptance — source SHA 5ea3ea6

Rust CI run [37707607250](https://github.com/ashutoshpw/open-obsidian/actions/runs/37707607250) completed successfully on exact SHA `5ea3ea6c9e0d02a562daa696eac19b826dad0efa`. The Actions parallel group, workspace tests, Clippy, dependency layering, native builds and plugin probes passed on Ubuntu, macOS and Windows; Ubuntu formatting passed. Unchanged PC05 Advanced Tables and PC08 Style Settings passed bundle integrity, loading, capability-denial and representative settings checks on all three system WebViews. PC05's editor callback changed the synthetic note on every platform; PC08 rendered `appearance`, `compact` and `accent` with no captured console or asynchronous errors. The five companion workflows (inventory, quality, desktop build, plugin renderer and loaded-plugin workflows) also passed on the same SHA. Platform reports, artifact IDs and SHA-256 digests are recorded in `evidence/r1.2-plugin-runtime-desktop-5ea3ea6.json`.

The R1.2 feasibility gate and R1 phase are complete. This is limited evidence for two unchanged plugin versions on the configured CI WebViews; it does not certify broad legacy compatibility, Linux Wayland integration or WebView isolation. `LegacyCompatibility` remains Pending. No local executable validation was run. Next is R2.1: review the inherited document/vault contracts and define a small source-preserving document-model slice with exact-SHA GitHub Actions gates.

## R2.1 work — Markdown source metadata

Reviewed the inherited implementation plan, vault compatibility contract, C02 migration requirements, Rust document/vault crate boundaries and source-preservation fixtures. The first R2.1 slice adds `MarkdownSource`, a strict UTF-8 view backed by the existing exact-byte `RawDocument`; it records UTF-8 BOM and LF/CRLF/CR/mixed/no line-ending metadata without normalizing source, and rejects invalid UTF-8 while retaining binary-safe `RawDocument` behavior. Unit cases cover these contracts and are pending GitHub Actions. No local executable validation was run. Next: commit and push this coherent work slice, then inspect the exact-SHA Rust matrix and companion workflows.

## R1 evidence-commit CI reconciliation — source SHA 7ef175e

The state/evidence commit for R1 was also exercised by GitHub Actions on exact SHA `7ef175e955b42a1796a93ae66364f416094f0740`: Rust CI, inventory, desktop build, plugin renderer and loaded-plugin workflows passed. The quality workflow's first macOS attempt stopped before the Electron vault audit reached local retrieval (`Local index complete · 1/1 Markdown files visited · 1 passages indexed · 3 excluded.`); rerunning the failed same-SHA job passed. The failed attempt and successful rerun are recorded separately in `state.json`.

## R2.1 formatting feedback — source SHA 634dab7

Rust CI run [37708730866](https://github.com/ashutoshpw/open-obsidian/actions/runs/37708730866) compiled the R2.1 code and passed all four new document tests plus the existing workspace tests on Ubuntu, macOS and Windows. macOS and Windows also passed Clippy, layering, native builds and the unchanged-plugin probes. Ubuntu formatting failed on one long byte-string assignment; the exact rustfmt layout from the GitHub log is applied. The quality run was cancelled; inventory, desktop, renderer and loaded-plugin companion workflows passed. This SHA is not accepted. Next: push the small formatting correction and obtain fresh exact-SHA CI, including quality.

## R2.1 acceptance — source SHA a8b0f67

Rust CI run [37709133512](https://github.com/ashutoshpw/open-obsidian/actions/runs/37709133512) passed on exact SHA `a8b0f67311f022884c24786cee78b1ba39beeb7a`. Formatting on Ubuntu, the Rust parallel group, workspace tests (including all four `openobsidian-doc` tests), Clippy, crate layering, native preview builds and unchanged-plugin probes passed on Ubuntu, macOS and Windows. The five companion workflows—inventory, quality, desktop build, plugin renderer and loaded plugins—also passed on the same SHA. GitHub used Rust stable 1.99.0 and Bun 1.4.2. The Linux preview and three platform reports, with artifact and report hashes, are recorded in `evidence/r2.1-markdown-source-a8b0f67.json`.

R2.1 is complete. The new type is only a strict UTF-8 source view: frontmatter/YAML parsing, source-span edits and vault writes are still pending. No local executable validation was run. Next is R2.2: expose byte-accurate frontmatter delimiter/content spans without interpreting or rewriting YAML, then validate only through exact-SHA GitHub Actions.

## R2.1 evidence commit CI reconciliation — source SHA a654a41

After the R2.1 completion record was pushed, all six GitHub Actions workflows passed on tracking/evidence commit `a654a419bac1a12c097556f895e3486adf824a1f`, including the inventory check of the new evidence record. The exact tested implementation remains `a8b0f67311f022884c24786cee78b1ba39beeb7a`; `a654a41` contains only its acceptance record. All runs are listed in `state.json`.

## R2.2 work — frontmatter source boundaries

The next read-only document slice exposes opening delimiter, content and closing delimiter spans as byte offsets into the unchanged UTF-8 source. It handles an optional BOM and LF, CRLF and CR line endings, and returns no bounds for absent, unclosed or near-match delimiters. Focused Rust cases cover Unicode byte offsets and preserved content. No local executable validation was run. Next: commit and push this work slice, then inspect only exact-SHA GitHub Actions results.

## R2.2 compiler feedback — source SHA cc2109d

Rust CI run [37709950709](https://github.com/ashutoshpw/open-obsidian/actions/runs/37709950709) found the same compiler error on macOS job 113093277769 and Windows job 113093277790: Rust could not infer the integer type for the BOM-dependent `opening_start` before `.checked_add(3)`. The compiler diagnostic requests an explicit type; the correction sets it to `usize`, as required for byte offsets. The Ubuntu job remained in system-dependency installation while this was recorded, so its source test result is pending. Inventory, quality, desktop, plugin-renderer and loaded-plugin workflows passed on this SHA. The correction will be pushed as a focused commit and the entire exact-SHA matrix rerun.

## R2.2 rustfmt feedback — source SHA 5f24fc2

Rust CI run [37710356848](https://github.com/ashutoshpw/open-obsidian/actions/runs/37710356848) compiled the corrected byte-offset implementation and passed all seven `openobsidian-doc` tests on Ubuntu. Ubuntu rustfmt reported five layout changes in the new helper and tests; applied the exact GitHub diff. macOS passed workspace tests, Clippy, layering, native build and plugin probes. Windows passed workspace tests, Clippy and layering and was still building when this correction was prepared. All five companion workflows passed on the same SHA. This source SHA is not accepted; the next pushed SHA must pass formatting and the full matrix.

## R2.2 acceptance — source SHA a8ee53d

Rust CI run [37710647728](https://github.com/ashutoshpw/open-obsidian/actions/runs/37710647728) passed on exact SHA `a8ee53ddcd81414c0f6e583de063b008876af826`. The seven `openobsidian-doc` tests, Ubuntu formatting, parallel group, Clippy, crate layering, native preview builds and unchanged-plugin probes passed on Ubuntu, macOS and Windows. All five companion workflows—inventory, quality, desktop build, plugin renderer and loaded plugins—passed on this SHA. GitHub used Rust stable 1.99.0 and Bun 1.4.2. The Linux preview and three platform compatibility reports, with artifact and report hashes, are recorded in `evidence/r2.2-frontmatter-bounds-a8ee53d.json`.

R2.2 is complete. The slice only identifies frontmatter source spans; it does not interpret YAML properties or edit/write vault files. The plugin reports remain feasibility-only and broad legacy compatibility remains Pending. No local executable validation was run. Next: review remaining R2 requirements and define the next focused document/vault contract slice.

## R2.2 acceptance-record CI reconciliation — SHA 65479f9

After the R2.2 acceptance record was pushed, all six GitHub Actions workflows passed on exact SHA `65479f95df4ae1c68145356e90de97c33e3757cd`, including the Rust three-OS matrix and inventory validation of the evidence and state files. The runs are recorded in `state.json`.

## R2.3 work — top-level frontmatter property spans

The next read-only document slice returns simple top-level frontmatter keys and raw value spans as byte offsets into the original UTF-8 source. It omits indented child entries, honors comments outside quoted/flow values, and performs no YAML interpretation or source edits. Focused Rust tests cover BOM/CRLF input, Unicode byte values, comments, blank values and incomplete frontmatter. No local executable validation was run. Next: push the source slice and inspect exact-SHA GitHub Actions.

## R2.3 formatting feedback — source SHA 9839a30

Rust CI run [37711725622](https://github.com/ashutoshpw/open-obsidian/actions/runs/37711725622) compiled the R2.3 source and passed workspace tests on Ubuntu, macOS and Windows. Ubuntu rustfmt reported three layout changes; applied the exact GitHub diff. macOS and Windows passed tests, Clippy, layering, native builds and unchanged-plugin probes. All five companion workflows passed on the exact SHA. This source SHA is not accepted; the next pushed SHA must pass formatting and the full Rust matrix.

## R2.3 acceptance — source SHA 851e158

Rust CI run [37712092256](https://github.com/ashutoshpw/open-obsidian/actions/runs/37712092256) passed on exact SHA `851e1583bd8b30f4d1b9be9d504b2271ddb73add`. All nine `openobsidian-doc` tests passed on Ubuntu, macOS and Windows, including both new property-span tests; Ubuntu formatting, the parallel group, Clippy, crate layering, native preview builds and unchanged-plugin probes passed. The five companion workflows also passed: inventory, quality, desktop build, plugin renderer and loaded plugins. Quality run [37712092267](https://github.com/ashutoshpw/open-obsidian/actions/runs/37712092267) initially failed only on Ubuntu because the Electron audit did not reach the local retrieval boundary; the same-SHA second attempt passed without source changes. Artifact IDs, report and binary hashes, OS versions and scope limits are recorded in `evidence/r2.3-frontmatter-properties-851e158.json`.

R2.3 is complete. The API returns raw byte spans for simple top-level property-shaped lines and does not parse YAML or edit/write vault files. Existing GitHub Actions `parallel` step groups were exercised successfully on this SHA, including Rust, quality and desktop workflows; their original implementation/evidence remains recorded under `ci_preparation` and `evidence/parallel-ci.json`. Broad legacy plugin compatibility remains Pending, and the Wry reports are feasibility-only. No local executable validation was run. Next: inspect the remaining R2 requirements and select the next small source-preserving vault/document slice.

## R2.4 work — source-ranged Markdown link references

The Rust `crates/doc` contract now extracts the existing wiki-link, Markdown-link and embed forms into raw references with target, alias, subpath and source/target byte spans. The test cases cover Unicode/BOM offsets, aliases, heading fragments and embeds; target offsets point to the destination even when visible text equals the target. This slice reads source only and performs no resolution or edits. No local executable validation was run. Next: push the R2.4 implementation and inspect exact-SHA GitHub Actions.

## R2.4 formatting feedback — source SHA b1b3b13

Rust CI run [37713280397](https://github.com/ashutoshpw/open-obsidian/actions/runs/37713280397) compiled the source and passed all 11 `openobsidian-doc` tests on Ubuntu, macOS and Windows. Ubuntu rustfmt requested two layout changes; applied the exact output. macOS and Windows also passed Clippy, layering, native preview builds and unchanged-plugin probes. All five companion workflows passed on the exact SHA. This source is not accepted until the formatting correction passes a fresh exact-SHA Rust matrix.

## R2.4 acceptance — source SHA 75aeac4

Rust CI run [37713605939](https://github.com/ashutoshpw/open-obsidian/actions/runs/37713605939) passed on exact SHA `75aeac4ba1fa5096c84db08028d3bfd54f626afe`. All eleven `openobsidian-doc` tests passed on Ubuntu, macOS and Windows; Ubuntu formatting, the parallel group, Clippy, crate layering, native preview builds and unchanged-plugin probes passed. All five companion workflows passed on the same SHA. Runtime report and preview artifact IDs, hashes, browser versions and scope limits are recorded in `evidence/r2.4-link-source-spans-75aeac4.json`.

R2.4 is complete. The Rust document model now exposes byte-accurate raw and target spans for supported wiki links, Markdown links and embeds. Link resolution and source updates remain future R2 work; code-span/fence exclusion must be in place before these references drive edits. The Wry compatibility reports remain feasibility-only. No local executable validation was run. Next: port path-level resolved, unresolved, ambiguous and external link outcomes while preserving the full C03 scope.

## R2.5 work — path-level link resolution

The document crate now resolves extracted references against vault-relative paths with explicit resolved, unresolved, ambiguous and external outcomes. The path layer handles same-directory names, Markdown extensions, basename ambiguity, percent-encoded targets, backslash separators and current-note links. Focused tests cover each outcome. Heading/block verification and code-context filtering remain required before link references can drive edits. No local executable validation was run. Next: push the R2.5 implementation and inspect exact-SHA GitHub Actions.

## Supplemental GitHub Actions parallel-step adoption

Added a native `parallel` group to `.github/workflows/compatibility-pins.yml` for the independent version-baseline, plugin-selection, asset-pin and primary-reference checks. Manual run [37715418139](https://github.com/ashutoshpw/open-obsidian/actions/runs/37715418139) on `8d4d44b889dab494197e9e04e4b535f477e027e7` confirmed GitHub recognized the group and waited for all four results: three passed; plugin selection failed because live registry/statistics hashes and download counts no longer match the frozen fixture. The fixture was left unchanged. The workflow hash was reconciled in commit `22a6b04`; the final workflow content and CI preparation evidence are in `evidence/parallel-ci-compatibility-pins-8d4d44b.json`. No local validation was run.

## R2.5 formatting and inventory feedback

Rust CI run [37714519508](https://github.com/ashutoshpw/open-obsidian/actions/runs/37714519508) and run [37715409555](https://github.com/ashutoshpw/open-obsidian/actions/runs/37715409555) both reported the same two Ubuntu rustfmt line wraps in `crates/doc/src/lib.rs`; Ubuntu workspace tests passed and macOS/Windows jobs passed. Applied only GitHub's formatter output in commit `3ea79b8`. The inventory run [37715409674](https://github.com/ashutoshpw/open-obsidian/actions/runs/37715409674) on `8d4d44b` requested the updated compatibility-workflow hash; commit `22a6b04` records the old hash and reconciliation reason. The quality run on `133b3f2` failed on macOS during the Electron retrieval boundary on its first two attempts; retry attempt 3 passed without a source change. All five companion workflows passed on final SHA `3ea79b8`.

## R2.5 acceptance — source SHA 3ea79b8

Rust CI [37715735622](https://github.com/ashutoshpw/open-obsidian/actions/runs/37715735622) passed on exact SHA `3ea79b8eb948568c0f8c2866801b726b5e00a9e6`: all thirteen `openobsidian-doc` tests, including both new resolution tests, passed on Ubuntu, macOS and Windows. Ubuntu formatting, the parallel test group, Clippy, crate layering, native preview builds and unchanged-plugin feasibility probes passed. Inventory [37715735487](https://github.com/ashutoshpw/open-obsidian/actions/runs/37715735487), quality [37715735540](https://github.com/ashutoshpw/open-obsidian/actions/runs/37715735540), desktop [37715735616](https://github.com/ashutoshpw/open-obsidian/actions/runs/37715735616), renderer [37715735514](https://github.com/ashutoshpw/open-obsidian/actions/runs/37715735514) and loaded-plugin [37715735543](https://github.com/ashutoshpw/open-obsidian/actions/runs/37715735543) workflows also passed. Exact report/artifact hashes and WebView versions are recorded in `evidence/r2.5-link-resolution-3ea79b8.json`.

R2.5 is complete. The path resolver remains read-only; code-context filtering and heading/block validation still block safe reference edits. PC05/PC08 remain feasibility-only and broad legacy compatibility remains Pending. No local executable validation was run. Next: R2.6, adding source-aware subpath checks and ensuring code contexts cannot be treated as editable references.

## R2.6.1 work — Markdown code-context filtering

`MarkdownSource::extract_links()` now skips references inside backtick and tilde fenced blocks and matched inline code spans. It keeps byte offsets against the original UTF-8 source, respects delimiter-run lengths, and leaves unmatched or escaped inline ticks literal. Focused tests cover both fence markers, longer closing fences, wrong-marker lines, CRLF/BOM offsets, equal and unequal backtick runs, unmatched delimiters and escaped ticks. The first pushed source SHA `b20792b` passed the document tests but GitHub CI requested one rustfmt layout change and strict Clippy corrections; only those CI findings were applied in `cf31282`. No local executable validation was run.

## R2.6.1 acceptance — source SHA cf31282

Rust CI [37717339835](https://github.com/ashutoshpw/open-obsidian/actions/runs/37717339835) passed on exact SHA `cf312828fab467bd679e5c2b9995ed337a4e11f1`. All fifteen `openobsidian-doc` tests passed on Ubuntu, macOS and Windows; Ubuntu formatting, the parallel group, Clippy, crate layering, native preview builds and unchanged-plugin feasibility probes passed. Inventory [37717339911](https://github.com/ashutoshpw/open-obsidian/actions/runs/37717339911), quality [37717339898](https://github.com/ashutoshpw/open-obsidian/actions/runs/37717339898), desktop [37717339932](https://github.com/ashutoshpw/open-obsidian/actions/runs/37717339932), renderer [37717339896](https://github.com/ashutoshpw/open-obsidian/actions/runs/37717339896) and loaded-plugin [37717339888](https://github.com/ashutoshpw/open-obsidian/actions/runs/37717339888) workflows also passed. Runtime reports, artifact IDs/hashes, WebView versions and the Linux preview hash are recorded in `evidence/r2.6.1-code-context-cf312828.json`.

R2.6.1 is complete. Indented code blocks and source-aware heading/block subpath validation remain outstanding; link references remain read-only and must not drive edits yet. PC05/PC08 reports remain feasibility-only, with broad legacy compatibility Pending. No local executable validation was run. Next: R2.6.2, validate heading and block subpath identities against target-note source.

## R2.6.2 work — source-aware heading and block subpaths

Added a source-aware resolver that checks heading and exact block-ID fragments against read-only Markdown note sources, while preserving the path-only resolver. It handles ATX/setext heading identities, percent-encoded fragments, missing/duplicate subpaths, fenced-code exclusion, same-basename disambiguation and current-note links. Tests also confirm the legacy path-only behavior. Link references remain read-only; no rename/move edit plan or source write is produced. Indented-code filtering remains outside this slice.

The first implementation SHA `5138574dc145e37671f6f78b8aca3bb17c0a508b` passed the new workspace tests but GitHub rustfmt requested layout changes. Applied the reported formatting, then strict Clippy identified eight manual space/tab comparisons. Replaced them with the CI-recommended character-array patterns; rustfmt requested two final wraps, applied exactly. The macOS Electron audit on `0a110fd8059bcf61c049ccf08da947f98cdcf37d` failed once at the retrieval-boundary check and passed on same-SHA attempt 2 without a source change.

## R2.6.2 acceptance — source SHA d35d5ea

Rust CI [37719218911](https://github.com/ashutoshpw/open-obsidian/actions/runs/37719218911) passed on exact SHA `d35d5ea10f7f95dbfb5a5384a9855bd836326ef9`: all seventeen `openobsidian-doc` tests passed on Ubuntu, macOS and Windows; Ubuntu formatting, the parallel group, Clippy, layering, native preview builds and unchanged-plugin feasibility probes passed. Inventory [37719218927](https://github.com/ashutoshpw/open-obsidian/actions/runs/37719218927), quality [37719218904](https://github.com/ashutoshpw/open-obsidian/actions/runs/37719218904), desktop [37719218933](https://github.com/ashutoshpw/open-obsidian/actions/runs/37719218933), renderer [37719218898](https://github.com/ashutoshpw/open-obsidian/actions/runs/37719218898) and loaded-plugin [37719218914](https://github.com/ashutoshpw/open-obsidian/actions/runs/37719218914) workflows also passed. Runtime reports, artifact IDs/hashes, WebView versions and the Linux preview hash are recorded in `evidence/r2.6.2-subpath-resolution-d35d5ea.json`.

R2.6.2 is complete. The source-aware resolver verifies subpath identity but does not prepare or apply rename/move edits; C03 remains Pending. Indented-code link filtering remains outstanding. PC05/PC08 reports remain feasibility-only. No local executable validation was run. Next: R2.6.3, inspect legacy link-update behavior and fixtures and design a source-ranged, ambiguity-safe edit plan before enabling reference writes.

## R2.6.3 work — source-ranged rename preview

Reviewed the legacy rename plan, link update and vault behavior together with the focused rename/link fixtures. Ported a pure Rust rename plan that uses the source-aware resolver, updates only confidently resolved target spans, and preserves aliases, heading/block subpaths, relative Markdown target form, BOM/CRLF bytes and UTF-8 byte offsets. Ambiguous and unresolved references are retained as warning/skip entries. Rendering a preview is in-memory only; it does not write to the vault. Revision-bound snapshot checks, apply, rollback and crash recovery remain future work. Four focused document tests were added. No local executable validation was run.

The first implementation SHA `83295e66ccb8e163b39aaab95422ac4ccea73d72` passed its document tests and five companion workflows; Rust CI reported Ubuntu formatting differences and a strict Clippy comparator lint on macOS/Windows. Applied those CI findings in the follow-up source commit `7b3b14bc5a8dac5762e0f957a3d922c09bab83fa`. On that exact SHA all 21 `openobsidian-doc` tests and Rust CI checks passed on Ubuntu, macOS and Windows, including formatting, the parallel group, Clippy, crate layering, native preview builds and Wry feasibility probes. Inventory, quality, desktop build, plugin renderer and loaded-plugin workflows also passed. The quality workflow's first attempt failed during the macOS Electron theme screenshot audit; its second attempt passed without source changes. Detailed exact-SHA job IDs, artifacts, report hashes and WebView versions are in `evidence/r2.6.3-rename-preview-7b3b14b.json`.

R2.6.3 is complete. The Rust API now creates a source-ranged, ambiguity-safe rename preview, but does not apply it or write vault files; C03 and C03.2 remain Pending. Indented-code filtering also remains outstanding. PC05/PC08 are feasibility-only and broad legacy-plugin compatibility remains Pending. No local executable validation was run. Next: inspect `crates/vault` revision/snapshot and transaction APIs, then design rename apply/rollback bound to the captured source revisions. Keep C03/C03.2 pending until the required exact-SHA GitHub CI acceptance passes.

The R2.6.3 acceptance-record commit `ba556c94ba1017ec6103417d104d8e5565f8523b` was itself accepted by all six required GitHub Actions workflows: Rust CI [37721508959](https://github.com/ashutoshpw/open-obsidian/actions/runs/37721508959), inventory [37721508917](https://github.com/ashutoshpw/open-obsidian/actions/runs/37721508917), quality [37721508969](https://github.com/ashutoshpw/open-obsidian/actions/runs/37721508969), desktop [37721508982](https://github.com/ashutoshpw/open-obsidian/actions/runs/37721508982), renderer [37721508946](https://github.com/ashutoshpw/open-obsidian/actions/runs/37721508946) and loaded plugins [37721508954](https://github.com/ashutoshpw/open-obsidian/actions/runs/37721508954).

## R2.6.4 work — revision-bound vault snapshots and rename previews

Added a sorted, content-addressed vault snapshot over regular files and symlink targets without following links. Vault reads now reject symlink traversal at every path component. `VaultRoot::build_rename_preview` reads all eligible Markdown notes between matching snapshots, then builds the source-aware Rust link plan and binds its identity to the snapshot SHA-256. `verify_rename_preview` rebuilds the plan and rejects any changed snapshot or decision. Three focused vault tests cover content-change detection, a read-only BOM/CRLF rename preview becoming stale after an external edit, and symlink snapshot/read behavior. No local executable validation was run.

The first R2.6.4 SHA `c250d741201d99fdd152c3e2ee8c87b430e26e8b` passed its Windows Rust job and all five companion workflows. Rust CI requested Ubuntu rustfmt layout changes and macOS Clippy flagged an owned `PathBuf` comparison in the symlink test. Applied only those findings in `84b4f843c20d7b8699f84cc08001a027c9a4ca2a`. That exact SHA passed all three Rust OS jobs: 21 document tests on each OS; five vault tests on Ubuntu and macOS and four on Windows, where the Unix-only symlink test is not compiled; formatting, parallel checks, Clippy, layering, native builds and plugin feasibility probes passed. All five companion workflows also passed. Artifact IDs, archive/report/binary hashes, browser versions and full job IDs are in `evidence/r2.6.4-vault-snapshot-preview-84b4f84.json`.

R2.6.4 is complete. Previews are vault-bound and stale plans fail closed, but no transaction journal, apply, rollback, crash recovery or history retention exists yet; C03 and C03.2 remain Pending. Empty directories and permission metadata are not part of the snapshot hash. PC05/PC08 remain feasibility-only; broad legacy-plugin compatibility remains Pending. No local executable validation was run. Next: port journaled, revision-checked multi-file rename apply and rollback in a separate small slice; test failure injection and external-change preservation through exact-SHA GitHub CI before considering C03/C03.2 complete.

## R2.6.5a work — revision-checked vault write foundation

Added `VaultStore` and revision-checked single-file writes outside the vault data tree. The write path preserves incoming conflict/failed bytes and prior bytes, appends prepared/committed/failed journal records, uses same-directory temporary replacement, and attempts a revision-guarded rollback if the commit journal cannot be recorded. Four focused tests cover successful writes, stale conflicts, replacement failure and rollback of a newly created file after journal failure. This is a foundation only: multi-file rename apply/rollback, crash recovery and history cleanup are still pending. The revision checks remain optimistic and do not provide an OS-level compare-and-swap against arbitrary external writers.

This slice was developed in small pushed commits: `d34e9c2` first failed CI on Ubuntu formatting and a missing test import; `bbc3ade` fixed those findings, then all three Rust Clippy jobs identified the same collapsible-if lint; `0e449c4` fixed the lint, then Ubuntu rustfmt requested the let-chain brace on a separate line; `8be9112` applied the final formatting correction. No local executable validation was run.

## R2.6.5a acceptance — source SHA 8be9112

All six required workflows passed for exact source SHA `8be9112ceee2a4df1b2512891828dfeefaf03f30`: Rust CI [37724381031](https://github.com/ashutoshpw/open-obsidian/actions/runs/37724381031), inventory [37724381029](https://github.com/ashutoshpw/open-obsidian/actions/runs/37724381029), quality [37724381014](https://github.com/ashutoshpw/open-obsidian/actions/runs/37724381014), desktop [37724380962](https://github.com/ashutoshpw/open-obsidian/actions/runs/37724380962), renderer [37724381040](https://github.com/ashutoshpw/open-obsidian/actions/runs/37724381040), and loaded plugins [37724380967](https://github.com/ashutoshpw/open-obsidian/actions/runs/37724380967). All 21 document tests passed on each OS; vault tests passed 9 on Ubuntu/macOS and 8 on Windows, where the existing Unix-only symlink test is excluded. Rust formatting, parallel checks, Clippy, layering, native builds and Wry probes passed on all three OSes. The first quality attempt timed out an unchanged Windows restricted-runtime test at five seconds; rerunning the failed job on the same SHA passed the full matrix. Job IDs and artifact digests are recorded in `evidence/r2.6.5-write-foundation-8be9112.json`.

R2.6.5 remains in progress. Next: implement revision-checked multi-file rename apply and rollback with failure injection, preserve/report external changes, and keep C03/C03.2 Pending until exact-SHA GitHub CI acceptance. Crash recovery and history cleanup remain future slices.

## R2.6.5b work — journaled rename apply and rollback

Added `VaultStore::apply_rename_preview` to revalidate the snapshot and source revisions, reject occupied destinations, preserve before-images outside the vault, move the source note, apply only planned byte spans, and append prepared/committed/failed journal states. Failure handling rolls back changed paths only when their current revision still matches the transaction write. A changed reference is left in place, preserved to conflict history and reported as needing recovery. Five focused tests cover successful moves, destination conflicts, failed writes, failed commit journaling and an external edit during rollback. Windows case-only renames use a temporary same-directory path. Revision checks remain optimistic and do not provide an OS-level compare-and-swap. No local executable validation was run.

The first source SHA `0ea917636bc4c90a76e828550a4ad59bb73f0d44` failed Rust CI on a `move_state` borrow conflict and Ubuntu formatting. `dd5095f918da06390c35509cc520b883a404f590` fixed those findings; Rust CI then reported one remaining Ubuntu rustfmt layout correction. Its Windows Electron packaging job also saw an upstream HTTP 500 while fetching the icons bundle. Applied the exact formatting output in `cebbebed074e91d9ec3bde6ebeded79dd0327ad3`.

## R2.6.5b acceptance — source SHA cebbebe

All six required workflows passed for exact source SHA `cebbebed074e91d9ec3bde6ebeded79dd0327ad3`: Rust CI [37726325987](https://github.com/ashutoshpw/open-obsidian/actions/runs/37726325987), inventory [37726325899](https://github.com/ashutoshpw/open-obsidian/actions/runs/37726325899), quality [37726325965](https://github.com/ashutoshpw/open-obsidian/actions/runs/37726325965), desktop [37726325892](https://github.com/ashutoshpw/open-obsidian/actions/runs/37726325892), renderer [37726326110](https://github.com/ashutoshpw/open-obsidian/actions/runs/37726326110) and loaded plugins [37726325883](https://github.com/ashutoshpw/open-obsidian/actions/runs/37726325883). Rust CI passed formatting, tests, the parallel group, Clippy, layering, preview builds and Wry probes on Linux, macOS and Windows. The document crate's 21 tests passed on each OS; vault tests passed 14 on Ubuntu/macOS and 13 on Windows, where the Unix-only symlink test is not compiled. The first quality attempt failed its unchanged macOS Electron retrieval-boundary audit; attempt 2 passed all three OS jobs without source changes. Artifact IDs and archive digests are recorded in `evidence/r2.6.5-rename-transaction-cebbebe.json`.

R2.6.5 remains in progress. Rename apply/rollback is accepted as a slice, but crash recovery and configurable history retention/cleanup remain. C03 and C03.2 stay Pending; broad plugin compatibility remains Pending, and Wry reports remain feasibility-only. No local executable validation was run. Next: implement crash recovery for interrupted rename transactions and history retention/cleanup.

## R2.6.5c work — interrupted rename recovery

Added journal recovery for interrupted multi-file renames. Recovery reads complete JSONL records, selects the latest state for each operation, and replays only schema-v2 `prepared` or `recovery_required` transactions. It restores a target only when its current revision matches the recorded post-write revision; external edits remain intact and are reported for attention. Source moves, Windows case-only rename casing, idempotent terminal records and incomplete journal tails are covered. Configurable history retention and cleanup remain for a later slice. No local executable validation was run.

The first source SHA `5eca34dc17a6cd8fb735f1ead6121b5bbdd51046` failed Rust CI on formatting, stale assertions for the rollback journal state and Windows case-only path casing. `c60d0e4d7711a1dda9442ec004ded69d91e9d896` fixed those findings; its focused tests passed, while Clippy and formatting identified helper ordering and two recovery-path layouts. `076d2ec474940789e814ca8a44ec5a67652b7782` addressed those exact CI findings.

## R2.6.5c acceptance — source SHA 076d2ec

All six required workflows passed for exact source SHA `076d2ec474940789e814ca8a44ec5a67652b7782`: Rust CI [37728398286](https://github.com/ashutoshpw/open-obsidian/actions/runs/37728398286), inventory [37728398251](https://github.com/ashutoshpw/open-obsidian/actions/runs/37728398251), quality [37728398341](https://github.com/ashutoshpw/open-obsidian/actions/runs/37728398341), desktop [37728398334](https://github.com/ashutoshpw/open-obsidian/actions/runs/37728398334), renderer [37728398311](https://github.com/ashutoshpw/open-obsidian/actions/runs/37728398311) and loaded plugins [37728398293](https://github.com/ashutoshpw/open-obsidian/actions/runs/37728398293). Rust CI passed formatting, all 17 vault tests and 21 document tests, the parallel group, Clippy, crate layering, native preview builds and Wry feasibility probes on Ubuntu, macOS and Windows. All companion workflow jobs passed on their three-OS matrices where applicable. Job IDs are recorded in `evidence/r2.6.5-recovery-076d2ec.json`.

R2.6.5 remains in progress. Crash recovery is accepted as a slice; configurable history retention/cleanup and full C03/C03.2 acceptance remain. Revision checks are optimistic and do not provide OS-level compare-and-swap against arbitrary external writers. No local executable validation was run. Next: implement configurable retention and cleanup for recovery history and conflict artifacts.


## R2.6.5d work — configurable history retention and cleanup

Added Rust vault APIs for validated history listing, read-only age/size retention planning, and explicit cleanup. The default policy keeps up to 30 days and 5 GiB; conflicts remain protected and can exceed the cap with a warning. The reader accepts Rust snake_case and legacy TypeScript camelCase manifests, understands epoch and ISO timestamps, and derives artifact paths from validated IDs instead of trusting manifest paths. Cleanup re-reads each eligible record and removes only its managed artifact and sidecar. Seven focused tests cover the policy, legacy metadata, path confinement, symlink rejection and protected conflicts. No local executable validation was run.

The first source SHA `6aa9562d9caa9f17949c4b92ef8d864dd84b449f` exposed an integer API unavailable on the GitHub Rust toolchain and Ubuntu formatting differences (Rust CI [37729960326](https://github.com/ashutoshpw/open-obsidian/actions/runs/37729960326)). `8038a17f1de16b44bd4f3b4e5d1d95e4a5300047` fixed those findings; Clippy then flagged a manual character comparison and an identity operation, and rustfmt requested one layout change (Rust CI [37730178080](https://github.com/ashutoshpw/open-obsidian/actions/runs/37730178080)). `ce2a4ceb46e15265d3262daac78a2d2c89912d12` fixed both Clippy findings; rustfmt requested a final one-line timestamp expression (Rust CI [37730394298](https://github.com/ashutoshpw/open-obsidian/actions/runs/37730394298)). The exact formatter layout was applied in `d7862a34578cfd918e5b93480a868b8d10ed3437`.

## R2.6.5d acceptance — source SHA d7862a3

All six required workflows passed on exact source SHA `d7862a34578cfd918e5b93480a868b8d10ed3437`: Rust CI [37730671686](https://github.com/ashutoshpw/open-obsidian/actions/runs/37730671686), inventory [37730671698](https://github.com/ashutoshpw/open-obsidian/actions/runs/37730671698), quality [37730671833](https://github.com/ashutoshpw/open-obsidian/actions/runs/37730671833), desktop [37730671682](https://github.com/ashutoshpw/open-obsidian/actions/runs/37730671682), renderer [37730671731](https://github.com/ashutoshpw/open-obsidian/actions/runs/37730671731), and loaded plugins [37730671695](https://github.com/ashutoshpw/open-obsidian/actions/runs/37730671695). Rust CI passed formatting, all workspace tests, Clippy, layering, native preview builds and Wry feasibility probes. The document crate's 21 tests passed on each OS; vault tests passed 24 on Ubuntu/macOS and 23 on Windows, where the Unix-only symlink test is excluded. Exact run/job IDs are recorded in `evidence/r2.6.5-history-retention-d7862a3.json`.

R2.6.5 remains in progress. The vault-layer retention API is accepted as a slice, but app IPC/UI integration and the separate D16 OS-level history-encryption requirement remain. C03 and C03.2 stay Pending, and optimistic revision checks still do not provide OS-level compare-and-swap against arbitrary external writers. No local executable validation was run. Next: review the app history boundary and D16 requirement, then define the next bounded R2 integration slice.

## R2.6.6 work — checked OS storage-protection status

Added a read-only Rust platform API that probes FileVault on macOS, BitLocker for the validated Windows `SystemDrive`, and Linux root device-mapper status through `cryptsetup`. It reports `Unknown` when evidence is missing or ambiguous, and keeps raw command output and volume identifiers out of report details. Nine focused tests cover explicit enabled/disabled states, failures, drive validation, active cryptsetup evidence and unsupported platforms. No local executable validation was run.

The first source SHA `c98e027cb502e1b6ff1ac7ba1fdc7ac736a666bb` exposed `String`/`&str` mismatches in failed-command details and Ubuntu rustfmt differences (Rust CI [37731971269](https://github.com/ashutoshpw/open-obsidian/actions/runs/37731971269)); the five companion workflows passed. `310c7c5deabf596c6f545fb9981f8260b69b67a0` fixed those findings, then Rust CI [37732207511](https://github.com/ashutoshpw/open-obsidian/actions/runs/37732207511) found test closures retaining borrowed command arguments. The five companion workflows passed on that SHA. `ecfb3341baebcbffdb75824425346e8b1acceefe` captures owned arguments.

## R2.6.6 accepted backend slice — source SHA ecfb334

All six required workflows passed for exact source SHA `ecfb3341baebcbffdb75824425346e8b1acceefe`: Rust CI [37732392551](https://github.com/ashutoshpw/open-obsidian/actions/runs/37732392551), inventory [37732392549](https://github.com/ashutoshpw/open-obsidian/actions/runs/37732392549), quality [37732392552](https://github.com/ashutoshpw/open-obsidian/actions/runs/37732392552), desktop [37732392581](https://github.com/ashutoshpw/open-obsidian/actions/runs/37732392581), renderer [37732392553](https://github.com/ashutoshpw/open-obsidian/actions/runs/37732392553), and loaded plugins [37732392505](https://github.com/ashutoshpw/open-obsidian/actions/runs/37732392505). Rust CI passed formatting, all nine platform-protection tests, workspace tests, Clippy, layering, native builds and Wry probes on Ubuntu, macOS and Windows. The document suite had 21 passes on each OS; vault had 24 on Ubuntu/macOS and 23 on Windows. Quality attempt 1 failed the unchanged Linux Electron vault audit before its local retrieval boundary; attempt 2 passed all OS jobs without source changes. Exact job IDs and results are recorded in `evidence/r2.6.6-storage-protection-ecfb334.json`.

D16 and SYNC-007 remain Pending: this backend report is not yet shown in the native UI, and managed history/recovery data still needs user-only OS access controls. Uninstall preservation and the full legacy history workflow also remain part of acceptance. R2.6.5 and C03/C03.2 remain Pending until cross-layer acceptance. Next: integrate Rust history and storage-protection APIs with the native application boundary, then address recovery-data access controls.

## R2.6.7 accepted UI slice — source SHA 428cc5a

Composed the checked platform report at the desktop application boundary and displayed its status, method, safe details and system-volume/root-filesystem scope in the native eframe shell. The UI keeps `Unknown` explicit and offers manual refresh. The exact run for `1a819baa3bec07c7b1f8ee982293684d21215d43` found two Ubuntu rustfmt wraps; commit `428cc5a67e27816c9759441009f63a0ce1fbfd11` applies the CI-reported correction.

All six required workflows passed on the corrected exact SHA: Rust CI [37734329160](https://github.com/ashutoshpw/open-obsidian/actions/runs/37734329160), inventory [37734329109](https://github.com/ashutoshpw/open-obsidian/actions/runs/37734329109), quality [37734329048](https://github.com/ashutoshpw/open-obsidian/actions/runs/37734329048), desktop [37734329028](https://github.com/ashutoshpw/open-obsidian/actions/runs/37734329028), renderer [37734329131](https://github.com/ashutoshpw/open-obsidian/actions/runs/37734329131), and loaded plugins [37734329126](https://github.com/ashutoshpw/open-obsidian/actions/runs/37734329126). Rust CI passed formatting, workspace tests, Clippy, layering, native preview builds and Wry feasibility probes on Ubuntu, macOS and Windows using stable Rust 1.99.0. Nine platform tests and the UI status-label test passed on each OS. Exact job IDs, lockfile digest and all uploaded artifact hashes are recorded in `evidence/r2.6.7-storage-status-ui-428cc5a.json`.

The shell has no end-to-end UI interaction test, and CI did not launch the app to inspect actual host encryption status. The probe only reports the system volume/root filesystem, not the history directory or every mounted volume. Rust history listing, retention planning, explicit cleanup, conflict resolution and user-only app-data controls remain unwired; D16, SYNC-007, R2.6.5 and C03/C03.2 stay Pending. No local executable validation was run. Next: integrate the existing Rust history API with a user-selected vault and native UI, then enforce and verify per-user recovery-data access controls and uninstall preservation.

## GitHub Actions parallel-step preflight

The GitHub Actions `parallel` step syntax from the June 25, 2026 changelog is already present on `main`: Rust formatting/tests in `.github/workflows/rust.yml`, independent source/contract checks in `quality.yml`, pin checks in `compatibility-pins.yml`, and post-package audits in `desktop-build.yml`. These groups place independent checks in parallel and wait before dependent work. The R2.6.8 exact-SHA Rust run also completed its formatting/test parallel group successfully. No extra workflow edit was needed.

## R2.6.8 work — explicit conflict-resolution APIs

Added validated conflict inspection and explicit Keep Current/Keep Incoming operations to the Rust vault store. Inspection checks the history record and relative path and returns incoming bytes with their SHA-256 revision. Keep Current removes only the selected managed conflict artifact. Keep Incoming writes against the conflict's recorded current revision and removes the conflict only after a successful write. If an external edit occurs first, the write is rejected and both recovery records remain. Four focused tests cover these outcomes and wrong-path rejection. No local executable validation was run.

The first implementation SHA `688522f21e3f2bfedf6e722f56c2098b80511fbd` ran all workspace tests successfully on Linux, macOS and Windows, but Linux rustfmt reported five layout-only differences. Its five companion workflows passed. The exact CI-requested formatting was committed as `117baa904cfb4dd0621f35c8279caf7669f27bce`.

## R2.6.8 accepted API slice — source SHA 117baa9

All six required workflows passed on exact source SHA `117baa904cfb4dd0621f35c8279caf7669f27bce`: Rust CI [37735896443](https://github.com/ashutoshpw/open-obsidian/actions/runs/37735896443), inventory [37735896464](https://github.com/ashutoshpw/open-obsidian/actions/runs/37735896464), quality [37735896473](https://github.com/ashutoshpw/open-obsidian/actions/runs/37735896473), desktop [37735896475](https://github.com/ashutoshpw/open-obsidian/actions/runs/37735896475), plugin renderer [37735896492](https://github.com/ashutoshpw/open-obsidian/actions/runs/37735896492), and loaded plugins [37735896462](https://github.com/ashutoshpw/open-obsidian/actions/runs/37735896462). Rust CI passed formatting, workspace tests, Clippy, layering, native preview builds and Wry feasibility probes on all three OSes. Vault tests passed 28 on Ubuntu/macOS and 27 on Windows; the Unix-only symlink test is not compiled there. The document suite had 21 passes, platform had 9, and UI had 1 on each OS. Stable Rust was 1.99.0 and Cargo.lock SHA-256 was `86c9234ef2db3e66a03541362c53d331458fe69a2b46eea3650bac1482e59938`. Job IDs and uploaded artifact digests are in `evidence/r2.6.8-conflict-resolution-117baa9.json`.

This accepts the vault API slice only. Native history UI integration, per-vault app-data paths, user-only OS access controls and uninstall preservation remain pending. D16, SYNC-007, R2.6.5 and C03/C03.2 remain pending. Next: connect history listing, retention planning, cleanup and conflict actions through the native application/UI boundary while preserving the legacy per-vault data path and enforcing user-only access.

## R2.6.9 work — private per-vault app data and engine history boundary

Added the OS-specific `OpenObsidian` user-data root and legacy Electron-compatible per-vault identity: the first 24 lowercase hexadecimal digits of SHA-256 over the lexically resolved absolute vault root. The service creates a managed history directory outside the vault, rejects symlink/reparse-point paths, applies owner-only Unix mode `0700`, and on Windows removes inherited ACLs before granting access to the current user's SID. Missing roots or failed access-control operations fail closed. `VaultSession` now owns `VaultStore` and exposes the history listing, retention plan, explicit cleanup and conflict APIs through the engine boundary. No local executable validation was run.

The first pushed source SHA `73d090fea1d7597d12f9924a18316123d4dd5f6d` had five companion workflows pass; Rust CI [37737649615](https://github.com/ashutoshpw/open-obsidian/actions/runs/37737649615) failed because `--locked` rejected the stale Cargo.lock and Ubuntu reported rustfmt-only differences. A temporary manual lock resolver was pushed in `e5b19dc42df804f826d5cc320f5ccb9751c7f0cf`; resolver run [37737882280](https://github.com/ashutoshpw/open-obsidian/actions/runs/37737882280) passed, its Cargo.lock artifact was retrieved, and the temporary workflow was removed in `6ee95210cf6fcc4752aafb50320ab409c10fdfde`. The subsequent Rust CI [37737980596](https://github.com/ashutoshpw/open-obsidian/actions/runs/37737980596) compiled on all three OSes but failed a shared test that constructed Windows, macOS and Linux `PathBuf` fixtures on every host. Five companion workflows passed on that SHA. The path-location checks are now gated to their matching OS in `fe2db5eb869e3171204fe92ff59d16096e0b966b`.

## R2.6.9 accepted service slice — source SHA fe2db5e

All six required workflows passed on exact source SHA `fe2db5eb869e3171204fe92ff59d16096e0b966b`: Rust CI [37738397245](https://github.com/ashutoshpw/open-obsidian/actions/runs/37738397245), inventory [37738397204](https://github.com/ashutoshpw/open-obsidian/actions/runs/37738397204), quality [37738397194](https://github.com/ashutoshpw/open-obsidian/actions/runs/37738397194), desktop build [37738397198](https://github.com/ashutoshpw/open-obsidian/actions/runs/37738397198), plugin renderer [37738397355](https://github.com/ashutoshpw/open-obsidian/actions/runs/37738397355), and loaded-plugin workflows [37738397203](https://github.com/ashutoshpw/open-obsidian/actions/runs/37738397203). Rust CI passed formatting, the formatting/test parallel group, workspace tests, Clippy, layering, native preview builds and Wry feasibility probes on Ubuntu, macOS and Windows. Document tests passed 21 on each OS; vault tests passed 28 on Ubuntu/macOS and 27 on Windows; platform tests passed 13 on Ubuntu, 12 on macOS and 13 on Windows; the UI suite passed one on each OS. Stable Rust was 1.99.0, and the committed Cargo.lock SHA-256 is `c8ec1aa39b07cbba1d1cbd11dccb8eb01d80cd7617cd58ff6834476881d84c7e`. Exact job IDs, test details and artifact digests are recorded in `evidence/r2.6.9-private-vault-data-fe2db5e.json`.

This accepts the private data service and engine API slice only. The native folder picker and history UI still need to call the service; uninstall preservation and cross-layer use remain unverified. D16, SYNC-007, R2.6.5 and C03/C03.2 remain Pending. Wry feasibility artifacts do not certify broad Obsidian plugin compatibility. Next: add a native folder picker with `rfd 0.17`, inject the platform service at the app boundary, and surface listing, retention preview, explicit cleanup and conflict resolution in the native UI.

## R2.6.10 accepted native picker slice — source SHA ee9b40f

Added the Photocraft-aligned `rfd` native folder picker and asynchronous vault opening through the protected per-vault app-data service. Storage preparation and `VaultSession::open` run on a Rayon worker; the UI receives completion through a channel, reports safe errors, and keeps the current session when opening a replacement fails. CI compiled the picker on all three desktop platforms but did not launch a graphical session to click through it.

All six required workflows passed for exact source SHA `ee9b40fc348f09c3ad1bf514ed3ae8a63b1e14ec`: Rust CI [37740368458](https://github.com/ashutoshpw/open-obsidian/actions/runs/37740368458), inventory [37740368427](https://github.com/ashutoshpw/open-obsidian/actions/runs/37740368427), quality [37740368437](https://github.com/ashutoshpw/open-obsidian/actions/runs/37740368437), desktop build [37740368395](https://github.com/ashutoshpw/open-obsidian/actions/runs/37740368395), plugin renderer [37740369613](https://github.com/ashutoshpw/open-obsidian/actions/runs/37740369613), and loaded-plugin workflows [37740368418](https://github.com/ashutoshpw/open-obsidian/actions/runs/37740368418). Rust formatting, workspace tests, Clippy, crate layering, native preview builds and Wry feasibility probes passed on Ubuntu, macOS and Windows. The CI-generated lockfile, test counts, job IDs and artifact digests are recorded in `evidence/r2.6.10-native-vault-picker-ee9b40f.json`.

No local executable validation was run. R2.6.10 is complete as a picker/opening slice. History listing, retention configuration and preview, explicit cleanup and conflict controls remain for R2.6.11; the UI interaction handoff, uninstall preservation, D16, SYNC-007 and C03/C03.2 remain pending.

## R2.6.11a work — native history list and retention preview

Added the native history listing and configurable age/size policy preview. History reads and retention planning run on a Rayon worker, leaving the UI responsive; unresolved conflicts are labeled protected. Changing the policy invalidates the previous preview, and no history is deleted by this slice. A focused UI helper test covers history-kind labels and byte formatting. GitHub Actions acceptance is pending; no local executable validation was run. Next: push this slice and inspect its exact-SHA CI before adding explicit cleanup confirmation and conflict inspection/resolution.

The first R2.6.11a source SHA `d9528ac9a67c68fbf3818b27e26d017e790d4b9c` passed inventory, quality, desktop build, plugin renderer and loaded-plugin workflows. Rust CI [37742058141](https://github.com/ashutoshpw/open-obsidian/actions/runs/37742058141) found that `--locked` rejected the missing direct Rayon dependency entry in `Cargo.lock`; Ubuntu also reported three formatting-only changes. The five companion results are inventory [37742058070](https://github.com/ashutoshpw/open-obsidian/actions/runs/37742058070), quality [37742058244](https://github.com/ashutoshpw/open-obsidian/actions/runs/37742058244), desktop [37742058240](https://github.com/ashutoshpw/open-obsidian/actions/runs/37742058240), renderer [37742058313](https://github.com/ashutoshpw/open-obsidian/actions/runs/37742058313), and loaded plugins [37742058222](https://github.com/ashutoshpw/open-obsidian/actions/runs/37742058222). Exact jobs were inspected. The current follow-up applies only the CI formatting and obtains the lockfile through the temporary Actions resolver; no local executable validation was run.

## R2.6.11a lockfile resolution — GitHub Actions only

Temporary resolver run [37742373924](https://github.com/ashutoshpw/open-obsidian/actions/runs/37742373924), job [113195823746](https://github.com/ashutoshpw/open-obsidian/actions/runs/37742373924/job/113195823746), passed on resolver SHA `1cd43f6a16a1d9cf510007bc45ce913a090b7e86`. Its Cargo.lock artifact `11534088564` has archive digest `sha256:b31c42f5d747c3a8e172cf5983dab657386c46a9ecfc00c2aac236ddbbab4d9c`; the retrieved lockfile SHA-256 is `e10a7e8ee874986f77b2b17e0c11c778abcc69aa9c90b5d889a17dd9dc16b64b`. The temporary resolver workflow has been removed from the source changes. No local Cargo command was run.

## R2.6.11a accepted history listing and retention preview — source SHA 82c9d2a

The native UI now lists recovery, failed-write and unresolved-conflict records and displays a read-only retention preview for user-selected age and size limits. History scanning and plan calculation run on a Rayon worker. The UI label/byte-format tests passed; no history is deleted by this slice.

All six required workflows passed on exact source SHA `82c9d2aea345417777704f11a1184acc96a33531`: Rust CI [37742573163](https://github.com/ashutoshpw/open-obsidian/actions/runs/37742573163), inventory [37742573158](https://github.com/ashutoshpw/open-obsidian/actions/runs/37742573158), quality [37742573003](https://github.com/ashutoshpw/open-obsidian/actions/runs/37742573003), desktop build [37742573024](https://github.com/ashutoshpw/open-obsidian/actions/runs/37742573024), plugin renderer [37742573137](https://github.com/ashutoshpw/open-obsidian/actions/runs/37742573137), and loaded-plugin workflows [37742573023](https://github.com/ashutoshpw/open-obsidian/actions/runs/37742573023). Rust CI passed formatting, workspace tests, Clippy, crate layering, native builds and Wry feasibility probes on all three OSes. Document tests passed 21 on each OS; vault tests passed 28 on Ubuntu/macOS and 27 on Windows; platform tests passed 13 on Ubuntu/Windows and 12 on macOS; the UI suite passed two on each OS. Exact job IDs, Cargo.lock hash and artifact digests are in `evidence/r2.6.11a-history-preview-82c9d2a.json`.

CI compiled and tested the UI but did not launch a graphical session to inspect it. Explicit cleanup confirmation and validated conflict inspection/Keep Current/Keep Incoming controls remain for R2.6.11b. No local executable validation was run.

## R2.6.11b work — explicit cleanup and conflict controls

Added a two-step cleanup confirmation that invokes the existing retention API only after the user reviews and confirms the pruneable count/size. Conflict rows can be inspected asynchronously with read-only current/incoming text previews capped at 16 KiB; binary previews are omitted. Keep Current and Keep Incoming each require a separate confirmation, and Keep Incoming remains protected by the stored revision precondition. Failed cleanup invalidates the preview; failed conflict resolution closes the stale inspection so the user must refresh and inspect again. Focused tests cover preview truncation, binary handling and explicit action labels. No local executable validation was run.

The first exact-SHA CI run was on `bab128387f27f5870610d3b13be0c79775c6d101`. Workspace tests passed on Ubuntu, macOS and Windows; inventory, quality, desktop build, plugin renderer and loaded-plugin workflows passed. Rust CI [37743596109](https://github.com/ashutoshpw/open-obsidian/actions/runs/37743596109) failed on Ubuntu rustfmt layout and macOS/Windows Clippy `collapsible_if` diagnostics. The exact formatter and let-chain changes were applied from those diagnostics.

The second run on `eab4f342d0ba459585f9b9c239a4aefdc0cc3c34` passed inventory, quality, desktop build, plugin renderer and loaded-plugin workflows. macOS and Windows Rust jobs passed; Ubuntu workspace tests passed, while rustfmt requested a line-broken let-chain and a collapsed button call. Those exact formatting changes are applied. Run and job IDs for both attempts are recorded in `state.json`; the current source still requires all six exact-SHA workflows. No local executable validation was run.

## R2.6.11b accepted cleanup and conflict controls — source SHA e1f5c18

The native history UI now requires review and explicit confirmation before cleanup, keeps unresolved conflicts protected, and supports asynchronous conflict inspection with bounded text previews. Keep Current/Keep Incoming each require confirmation; Keep Incoming remains guarded by the recorded current revision. All six required workflows passed on exact source SHA `e1f5c180ebf53a213fcc86089853c58a916bcdcf`: Rust CI [37744683799](https://github.com/ashutoshpw/open-obsidian/actions/runs/37744683799), inventory [37744683837](https://github.com/ashutoshpw/open-obsidian/actions/runs/37744683837), quality [37744683804](https://github.com/ashutoshpw/open-obsidian/actions/runs/37744683804), desktop build [37744683836](https://github.com/ashutoshpw/open-obsidian/actions/runs/37744683836), plugin renderer [37744683803](https://github.com/ashutoshpw/open-obsidian/actions/runs/37744683803), and loaded-plugin workflows [37744683843](https://github.com/ashutoshpw/open-obsidian/actions/runs/37744683843). Rust formatting, workspace tests, Clippy, layering, native builds and Wry feasibility probes passed on Ubuntu, macOS and Windows. Document tests passed 21 per OS; vault tests passed 28 on Ubuntu/macOS and 27 on Windows; platform tests passed 13 on Ubuntu/Windows and 12 on macOS; UI tests passed four per OS. Exact job IDs, artifact IDs/digests and test details are in `evidence/r2.6.11b-history-controls-e1f5c18.json`. No local executable validation was run.

The native UI compiled in CI, but CI did not launch a graphical session to inspect the controls. D16, SYNC-007, R2.6.5, C03/C03.2 and uninstall preservation remain pending. Next: audit those remaining R2 safety gates and define a bounded cross-layer slice before beginning R3.

## R2.6.12 work — engine rename boundary and startup recovery

The R2 audit found that `VaultStore` implements snapshot-bound rename transactions and interrupted-rename recovery, but `VaultSession` exposed neither rename operations nor a recovery report, and session opening did not run recovery before scanning notes. This slice adds those engine boundaries, replays pending rename recovery before the session listing is captured, allows the listing to be explicitly refreshed after a committed operation, and surfaces recovered/attention-needed outcomes in the native shell. Focused engine coverage exercises a reference-preserving rename and a synthetic prepared journal recovered during session open. GitHub Actions acceptance is pending; no local executable validation was run. D16, SYNC-007, C03/C03.2 and uninstall preservation remain pending.

The first exact-SHA Rust CI run for R2.6.12, source `5a5dea83536ff53f5d05851ace0a5b10a045c571`, failed on formatting differences in the new assertions/import layout and Clippy `cmp_owned` findings in four path assertions on macOS and Windows. Workspace tests passed on all three OSes. Inventory [37746429398](https://github.com/ashutoshpw/open-obsidian/actions/runs/37746429398), quality [37746429373](https://github.com/ashutoshpw/open-obsidian/actions/runs/37746429373), desktop build [37746429341](https://github.com/ashutoshpw/open-obsidian/actions/runs/37746429341), plugin renderer [37746429326](https://github.com/ashutoshpw/open-obsidian/actions/runs/37746429326), and loaded-plugin workflows [37746429329](https://github.com/ashutoshpw/open-obsidian/actions/runs/37746429329) passed on that SHA. The formatter and Clippy findings are corrected from the exact GitHub diagnostics. No local executable validation was run; the correction awaits a fresh six-workflow exact-SHA run.

## R2.6.12 accepted engine rename and recovery boundary — source SHA fec449b

The focused correction was pushed as `fec449b5f99b01c275fdfdbb510b6f9fb73e3799`. Rust CI run [37746882095](https://github.com/ashutoshpw/open-obsidian/actions/runs/37746882095) had successful macOS and Windows jobs, but its Ubuntu system-dependency installation remained active for more than ten minutes. That run was cancelled and Rust CI was dispatched again without source changes. The retry [37748018421](https://github.com/ashutoshpw/open-obsidian/actions/runs/37748018421) passed on Ubuntu, macOS and Windows, including formatting, workspace tests, Clippy, dependency layering, native preview builds and unchanged-plugin Wry feasibility probes. The other five required workflows also passed on the exact same SHA: inventory [37746882062](https://github.com/ashutoshpw/open-obsidian/actions/runs/37746882062), quality [37746882013](https://github.com/ashutoshpw/open-obsidian/actions/runs/37746882013), desktop build [37746881947](https://github.com/ashutoshpw/open-obsidian/actions/runs/37746881947), plugin renderer [37746882098](https://github.com/ashutoshpw/open-obsidian/actions/runs/37746882098), and loaded-plugin workflows [37746882017](https://github.com/ashutoshpw/open-obsidian/actions/runs/37746882017).

Rust 1.99.0 workspace test totals by crate were: document 21 on every OS; engine 2 on every OS; platform 13 on Ubuntu/Windows and 12 on macOS; UI 5 on every OS; and vault 28 on Ubuntu/macOS and 27 on Windows. Exact job IDs, artifact IDs/digests, Cargo.lock hash, and test details are recorded in `evidence/r2.6.12-engine-rename-recovery-fec449b.json`. No local executable validation was run. CI compiled and tested the UI but did not launch a graphical session; D16, SYNC-007, R2.6.5, C03/C03.2 and uninstall preservation remain pending for full R2 acceptance.

## R2.6.13 work — native rename review and apply

Connected the snapshot-bound rename preview and journaled apply APIs to the native UI. The source-note picker uses the session's Markdown listing; preview and apply run on Rayon workers. The preview displays affected references, labels ambiguous and unresolved references as unchanged, caps rendered rows at 100, and requires a separate review/confirmation before applying. Successful applies refresh a cloned session's note listing before replacing the UI session. Stale previews and occupied destinations require a new preview. Added a focused UI test for update/skip labels. No local executable validation was run.

The first implementation SHA `e7e1d50ec51c78e20bdc4dc11811e88a6b41f9f3` passed the five companion workflows but Rust CI [37750008646](https://github.com/ashutoshpw/open-obsidian/actions/runs/37750008646) found one Rust mutability error and Ubuntu formatting differences. Applied the compiler suggestion and exact rustfmt output in a follow-up commit.

All six required workflows passed on exact implementation SHA `4e9a5c6ae17f4641529a687d82735212bb5dc68c`: Rust CI [37750280277](https://github.com/ashutoshpw/open-obsidian/actions/runs/37750280277), inventory [37750280197](https://github.com/ashutoshpw/open-obsidian/actions/runs/37750280197), quality [37750280183](https://github.com/ashutoshpw/open-obsidian/actions/runs/37750280183), desktop build [37750280208](https://github.com/ashutoshpw/open-obsidian/actions/runs/37750280208), plugin renderer [37750280266](https://github.com/ashutoshpw/open-obsidian/actions/runs/37750280266), and loaded-plugin workflows [37750280191](https://github.com/ashutoshpw/open-obsidian/actions/runs/37750280191). Rust formatting, workspace tests, Clippy, layering, native builds and Wry probes passed on Ubuntu/macOS/Windows. Document tests passed 21 per OS; engine tests passed 2 per OS; platform tests passed 13 on Ubuntu/Windows and 12 on macOS; UI tests passed 6 per OS; vault tests passed 28 on Ubuntu/macOS and 27 on Windows. Run/job IDs, artifact hashes and limitations are in `evidence/r2.6.13-native-rename-review-4e9a5c6.json`.

CI compiled and tested the UI but did not launch a graphical session to inspect the interactive rename flow. C03/C03.2 remain pending until their full fixture and reference-safety acceptance is recorded; D16, SYNC-007, R2.6.5 and uninstall preservation also remain pending for full R2 acceptance. No local executable validation was run. Next: continue the R2 acceptance audit and select the next bounded GitHub-CI slice.

## R2.6.14 accepted fixture-backed rename and move planning — source SHA 7f9b53c

Expanded `fixtures/rename-plan.json` into concrete `fixture:c03-rename-move` cases for resolved wiki/Markdown/embed references, alias and subpath preservation, duplicate-basename disambiguation, ambiguous and unresolved skips, unrelated references, BOM and CRLF bytes. The Rust testkit consumes the fixture and checks planned decisions, warnings, exact rendered bytes for every source and source immutability. Updated the inventory hash for the fixture. No local executable validation was run.

The first source SHA `d0147fb4ddf0417d1feba703cf29fe0ce686872a` exposed a malformed JSON array terminator in both Rust workspace tests and the legacy quality suite; the Rust CI also requested formatting. Fixed the JSON in `6d7c9687fc3e9a242be7dd22cf6bed71493510b0`; workspace tests passed on all three operating systems, while Ubuntu rustfmt requested the final layout correction. Applied that exact CI diff in `7f9b53ca22971e34e9f900f1185ed4376ee2ce2e`.

All six required workflows passed on the exact implementation SHA `7f9b53ca22971e34e9f900f1185ed4376ee2ce2e`: Rust CI [37752643862](https://github.com/ashutoshpw/open-obsidian/actions/runs/37752643862), inventory [37752643929](https://github.com/ashutoshpw/open-obsidian/actions/runs/37752643929), quality [37752644021](https://github.com/ashutoshpw/open-obsidian/actions/runs/37752644021), desktop build [37752643754](https://github.com/ashutoshpw/open-obsidian/actions/runs/37752643754), plugin renderer [37752643695](https://github.com/ashutoshpw/open-obsidian/actions/runs/37752643695), and loaded-plugin workflows [37752643985](https://github.com/ashutoshpw/open-obsidian/actions/runs/37752643985). Rust tests passed on Ubuntu/macOS/Windows, including one new testkit fixture test per OS; formatting, Clippy, layering, native builds and Wry feasibility probes passed. The first quality attempt failed an existing macOS Electron retrieval-boundary audit; retrying that job on the same SHA passed all three jobs. Exact job IDs, test counts, artifact IDs/digests and failure history are recorded in `evidence/r2.6.14-rename-plan-fixture-7f9b53c.json`.

This slice tests document planning and in-memory rendering, not transaction apply/rollback, crash recovery or graphical interaction. C03 and C03.2 remain pending full cross-layer fixture, transaction, reference-safety and native interaction acceptance. D16, SYNC-007, history integration details and uninstall preservation remain pending for R2. Next: extend the fixture through `VaultStore` apply/rollback and establish native interaction evidence, then continue the remaining R2 safety and uninstall acceptance audit.

## R2.6.15 accepted fixture-backed vault rename apply and rollback — source SHA `fc8b896`

Expanded the resolved C03 rename fixture to cover a second linked note and added rollback expectations. The shared Rust testkit now materializes each fixture case in a temporary vault, applies it through `VaultStore`, and verifies exact bytes, source movement, reference counts, warnings and journal states. A vault-level failure-injection test fails the second reference write after the first has committed, then proves the prior write and source move are restored byte-for-byte and recorded as `rolled_back`. The fixture inventory hash is reconciled.

The first source SHA `eacfd57f6053cf33315b069a60e266cc5e990c95` passed workspace tests on Ubuntu, macOS and Windows, including both fixture tests; Clippy passed on all three platforms. CI reported four Ubuntu rustfmt changes and a stale fixture hash in the inventory workflow. Applied those exact formatting corrections and updated the inventory hash in `fc8b896054979af3e0dc212a7f33576a3672a524`.

All six required GitHub Actions workflows passed on the exact source SHA `fc8b896054979af3e0dc212a7f33576a3672a524`: Rust CI [37755371928](https://github.com/ashutoshpw/open-obsidian/actions/runs/37755371928), inventory [37755372062](https://github.com/ashutoshpw/open-obsidian/actions/runs/37755372062), quality [37755372207](https://github.com/ashutoshpw/open-obsidian/actions/runs/37755372207), desktop build [37755371926](https://github.com/ashutoshpw/open-obsidian/actions/runs/37755371926), plugin renderer [37755371966](https://github.com/ashutoshpw/open-obsidian/actions/runs/37755371966), and loaded-plugin workflows [37755371910](https://github.com/ashutoshpw/open-obsidian/actions/runs/37755371910). Rust fmt, workspace tests, Clippy, layering, native builds and Wry probes passed on Ubuntu/macOS/Windows. The two testkit fixture tests passed on all three OSes; vault tests passed 29 on Ubuntu/macOS and 28 on Windows. Artifact hashes, job IDs, test counts and the superseded attempt are in `evidence/r2.6.15-rename-vault-transaction-fixture-fc8b896.json`.

The GitHub Actions native `parallel` groups referenced by the goal were already adopted in `.github/workflows/rust.yml`, `.github/workflows/quality.yml`, `.github/workflows/compatibility-pins.yml` and `.github/workflows/desktop-build.yml`, and exercised successfully. No additional workflow change was needed. No local executable validation was run.

This slice verifies the fixture through apply and rollback, but does not add fixture-driven interrupted-process recovery or inspect the graphical flow in a launched desktop. C03/C03.2 remain pending full cross-layer and native interaction acceptance. D16, SYNC-007, remaining R2 workflow gaps, history integration and uninstall preservation remain open. Next: extend the fixture through interrupted-transaction recovery and native interaction evidence, then continue those R2 acceptance gates.

## R2.6.16 accepted fixture-backed interrupted rename recovery — source SHA `927b77f`

Extended `fixture:c03-rename-move` through a simulated interrupted `VaultStore` rename. The test records recovery before-images and a prepared manifest, moves `Old.md` to `Archive/New.md`, writes planned references, reopens the vault, and checks that recovery restores every original fixture byte, moves the source back, records `rolled_back`, reports no attention items and remains idempotent. Recovery's exact-path lookup now validates nested parent directories, rejects symlinks and non-directories, and confirms canonical containment beneath the vault root. No local executable validation was run.

The first source SHA `38b7ac0bf81e7e9205910fe2df46f4152a95ce56` passed the inventory and five companion workflows, but Rust CI [37757201156](https://github.com/ashutoshpw/open-obsidian/actions/runs/37757201156) found the new recovery test returned no recovered operation. A diagnostic commit, `8a45120a3a8c92222cc5a0fdc49b68c495ed5bd8`, made the recovery issue explicit: nested parent `Archive` was being passed to a resolver that expects a regular-file leaf. The nested-directory lookup was corrected on source SHA `927b77f240d962259fe507132ebfa3696e6872f8`.

All six required workflows passed on exact source SHA `927b77f240d962259fe507132ebfa3696e6872f8`: Rust CI [37757851922](https://github.com/ashutoshpw/open-obsidian/actions/runs/37757851922), inventory [37757852034](https://github.com/ashutoshpw/open-obsidian/actions/runs/37757852034), quality [37757851871](https://github.com/ashutoshpw/open-obsidian/actions/runs/37757851871), desktop build [37757851825](https://github.com/ashutoshpw/open-obsidian/actions/runs/37757851825), plugin renderer [37757851891](https://github.com/ashutoshpw/open-obsidian/actions/runs/37757851891), and loaded-plugin workflows [37757851804](https://github.com/ashutoshpw/open-obsidian/actions/runs/37757851804). Formatting, workspace tests, Clippy, layering, native builds and Wry probes passed on Ubuntu/macOS/Windows. The recovery fixture test passed on all three; vault tests passed 30 on Ubuntu/macOS and 29 on Windows. Run/job IDs and test counts are in `evidence/r2.6.16-rename-recovery-fixture-927b77f.json`.

This slice verifies fixture-driven interrupted recovery, but it does not inspect the rename flow in an interactive desktop. C03/C03.2 remain pending full cross-layer and native interaction acceptance. D16, SYNC-007, remaining R2 workflow gaps, history integration and uninstall preservation remain open. Next: establish native interaction evidence for rename preview and apply, then continue those R2 acceptance gates.

## R2.6.17 accepted headless egui rename interaction — source SHA `9b2080e`

Extracted `OpenObsidianApp::show_ui` so the eframe app and `egui_kittest` harness render the same UI. The accessible interaction test drives the production rename preview, separate review/confirmation and apply actions. It verifies the note and linked-reference bytes remain unchanged before final confirmation, then checks the moved note, updated references and refreshed session listing. No local executable validation was run.

The first implementation SHA `48aa973145356d64ff9e470028a0a419da2c2cb7` passed the interaction test on all three operating systems and all five companion workflows, while Rust CI [37759944562](https://github.com/ashutoshpw/open-obsidian/actions/runs/37759944562) found an Ubuntu formatting difference and macOS/Windows Clippy rejected the `PathBuf` comparison. Fixed the comparison and formatting in `619ab15c6fea5709faa201611bee9befabe4fe61`; its five companion workflows and macOS/Windows Rust jobs passed, but Ubuntu formatting requested one final layout adjustment. The Windows cache finalization later completed successfully. Applied that CI formatting output in `9b2080e3ea6559c4cf678f39c1fbaca2148f999b`.

All six required workflows passed on exact implementation SHA `9b2080e3ea6559c4cf678f39c1fbaca2148f999b`: Rust CI [37761060138](https://github.com/ashutoshpw/open-obsidian/actions/runs/37761060138), inventory [37761060028](https://github.com/ashutoshpw/open-obsidian/actions/runs/37761060028), quality [37761060110](https://github.com/ashutoshpw/open-obsidian/actions/runs/37761060110), desktop build [37761060020](https://github.com/ashutoshpw/open-obsidian/actions/runs/37761060020), plugin renderer [37761060163](https://github.com/ashutoshpw/open-obsidian/actions/runs/37761060163), and loaded-plugin workflows [37761059999](https://github.com/ashutoshpw/open-obsidian/actions/runs/37761059999). Rust formatting, workspace tests, Clippy, dependency layers, native preview builds and Wry feasibility probes passed on Ubuntu/macOS/Windows. The rename interaction passed on all three. Rust 1.99.0 was installed by the stable toolchain workflow. Test counts, job IDs, artifact digests and superseded CI attempts are recorded in `evidence/r2.6.17-egui-rename-interaction-9b2080e.json`.

This is headless accessible-widget interaction evidence, not a launched OS-native session, visual snapshot or human accessibility review. C03/C03.2 remain pending full fixture and cross-layer acceptance; D16, SYNC-007, remaining R2 workflow gaps, history integration and uninstall preservation remain open. Next: continue the R2 acceptance audit and select the next bounded GitHub-CI slice.

## R2.6.18 accepted native uninstall cleanup choices — source SHA `bf4e3b3`

Ported the existing optional app-cache, stored-credential and recovery-history choices into the native egui shell. All choices start off, and the summary states that uninstall cleanup never includes the vault. Added an accessible interaction test that selects every choice and confirms the open vault remains byte-identical. No cleanup action was executed or connected to an OS uninstaller in this slice, and no local executable validation was run.

The first source SHA `b142166afe39a44d56864414ea0c800bcb118b5e` passed all five companion workflows, but Rust CI [37762463675](https://github.com/ashutoshpw/open-obsidian/actions/runs/37762463675) found that the accessibility query for `Recovery history` matched both the existing history heading and the new checkbox on all three OSes. Renamed the checkbox to `Clean up recovery history` in `bf4e3b32d3b163d6acd249f52f31a3e048ed305c`.

All six required workflows passed on exact implementation SHA `bf4e3b32d3b163d6acd249f52f31a3e048ed305c`: Rust CI [37762742848](https://github.com/ashutoshpw/open-obsidian/actions/runs/37762742848), inventory [37762742918](https://github.com/ashutoshpw/open-obsidian/actions/runs/37762742918), quality [37762743044](https://github.com/ashutoshpw/open-obsidian/actions/runs/37762743044), desktop build [37762742805](https://github.com/ashutoshpw/open-obsidian/actions/runs/37762742805), plugin renderer [37762742956](https://github.com/ashutoshpw/open-obsidian/actions/runs/37762742956), and loaded-plugin workflows [37762742981](https://github.com/ashutoshpw/open-obsidian/actions/runs/37762742981). Formatting, workspace tests, Clippy, layering, native preview builds, Wry feasibility and the cleanup-choice interaction passed on Ubuntu/macOS/Windows. Rust 1.99.0 was installed by the stable toolchain workflow. Test counts, job IDs and artifact digests are in `evidence/r2.6.18-uninstall-cleanup-choices-bf4e3b3.json`.

This UI slice verifies the preservation statement and choice state, not actual uninstall behavior or deletion of app-owned data. D16 and SYNC-007 remain pending; C03/C03.2 full cross-layer acceptance, remaining R2 workflow gaps and history integration also remain open. Next: add a fixture-backed cross-layer uninstall-preservation contract and finish the remaining D16/history gates.

## R2.6.19 accepted fixture-backed ambiguous/unresolved rename interaction — source SHA `842615d`

Extended the production `egui_kittest` rename interaction to load the ambiguous/unresolved case from `fixtures/rename-plan.json`. The UI preview reports zero reference updates and two skipped edits; fixture files remain byte-identical before confirmation. After explicit apply, the note moves, ambiguous/unresolved references and unrelated files remain unchanged, and the refreshed session lists the destination. No local executable validation was run.

The first source SHA `daf4e4e1949fc9b2b0302d2c0afa05c713b39727` passed the five companion workflows, while Rust CI [37763860969](https://github.com/ashutoshpw/open-obsidian/actions/runs/37763860969) found Ubuntu formatting differences and a macOS interaction failure because the harness needed one more UI step after review before the confirmation control became available. Applied the exact CI formatting and added that step in `842615dc6be2c6ba7ed3408208098717ca623e2e`.

All six required workflows passed on exact implementation SHA `842615dc6be2c6ba7ed3408208098717ca623e2e`: Rust CI [37764171330](https://github.com/ashutoshpw/open-obsidian/actions/runs/37764171330), inventory [37764171447](https://github.com/ashutoshpw/open-obsidian/actions/runs/37764171447), quality [37764171360](https://github.com/ashutoshpw/open-obsidian/actions/runs/37764171360), desktop build [37764171390](https://github.com/ashutoshpw/open-obsidian/actions/runs/37764171390), loaded-plugin workflows [37764171419](https://github.com/ashutoshpw/open-obsidian/actions/runs/37764171419), and plugin renderer [37764171450](https://github.com/ashutoshpw/open-obsidian/actions/runs/37764171450). Formatting, workspace tests, Clippy, layering, native preview builds, unchanged-plugin probes and the new UI interaction passed on Ubuntu/macOS/Windows. Rust 1.99.0 was used; test totals, job IDs and artifact digests are in `evidence/r2.6.19-egui-rename-fixture-skips-842615d.json`.

This remains headless interaction evidence and does not establish native-window visual acceptance. C03/C03.2 full cross-layer acceptance, D16, SYNC-007 uninstall preservation, remaining R2 workflow gaps and history integration remain pending. Next: add the fixture-backed uninstall preservation contract for SYNC-007 and finish the D16/history gates; keep R2 open until all acceptance criteria pass in GitHub CI.

## R2.6.20 accepted fixture-backed uninstall preservation — source SHA `fee60f2`

Added `fixtures/uninstall-preservation.json`, a synthetic scenario covering nested vault files, application cache, managed recovery state and an unresolved conflict. Registered its expected fixture hash in the migration inventory. The headless `egui_kittest` interaction materializes the scenario, opens it through the production `VaultSession`, selects all three optional cleanup choices in the production UI, and verifies every fixture file remains byte-identical. No cleanup or OS uninstaller is executed, and no local executable validation was run.

The first implementation SHA `17d19f316b7bf2fb3e8eac1733ce471cdb9e2fad` passed the fixture interaction on all three OSes and all five companion workflows; Rust CI [37765743470](https://github.com/ashutoshpw/open-obsidian/actions/runs/37765743470) failed only on Ubuntu rustfmt. Applied the exact shorter let-binding layout requested by CI in `fee60f234ce7225b5eb4bb6261fd8820aed5ec10`.

All six required workflows passed on exact source SHA `fee60f234ce7225b5eb4bb6261fd8820aed5ec10`: Rust CI [37766196839](https://github.com/ashutoshpw/open-obsidian/actions/runs/37766196839), inventory [37766196822](https://github.com/ashutoshpw/open-obsidian/actions/runs/37766196822), quality [37766196836](https://github.com/ashutoshpw/open-obsidian/actions/runs/37766196836), desktop build [37766196832](https://github.com/ashutoshpw/open-obsidian/actions/runs/37766196832), loaded-plugin workflows [37766196870](https://github.com/ashutoshpw/open-obsidian/actions/runs/37766196870), and plugin renderer [37766196872](https://github.com/ashutoshpw/open-obsidian/actions/runs/37766196872). The UI interaction passed on Ubuntu, macOS and Windows. Test counts, exact job IDs, preview/plugin artifact IDs and digests are recorded in `evidence/r2.6.20-uninstall-fixture-preservation-fee60f2.json`.

This verifies the preservation invariant while cleanup choices are selected in the UI. It does not execute an OS uninstall or establish packaging/uninstaller integration, so SYNC-007 remains pending. D16, history integration and C03/C03.2 full cross-layer acceptance also remain open. Next: advance those R2 acceptance gates in bounded slices and keep all executable checks in GitHub Actions.

## R2.6.21 accepted fixture-backed history retention UI — source SHA `3ed8e6d`

Added `fixtures/history-retention.json`, a synthetic scenario with an aged recovery record, a protected unresolved conflict and an in-place vault note under the supported 30-day/5-GiB policy. The production egui UI and `VaultSession` interaction opens and lists the fixture history, requests a read-only retention preview, enters the separate review step, then requires explicit confirmation before removing the expired recovery record. It verifies preview/review do not delete files, then checks the conflict artifacts and vault note remain byte-identical after cleanup. No local executable validation was run.

The first implementation SHA `cf52817dddd8f8c18c517664478f8cea07bb2055` had three Ubuntu rustfmt differences and the interaction did not produce a plan on any OS. The fixture's zero-byte cap was below the UI control's supported 0.1-GiB minimum; changed the test to the supported 5-GiB policy and added direct session/task diagnostics in `3ed8e6dd9573a55ae8ff573ca5f6f2d2a206d4d0`. Its companion inventory, desktop build, plugin renderer and loaded-plugin workflows passed. The first quality attempt's macOS Electron vault audit stopped before retrieval; rerunning the failed job on the same SHA made all three quality jobs pass.

All six required workflows passed on exact implementation SHA `3ed8e6dd9573a55ae8ff573ca5f6f2d2a206d4d0`: Rust CI [37768223806](https://github.com/ashutoshpw/open-obsidian/actions/runs/37768223806), inventory [37768223829](https://github.com/ashutoshpw/open-obsidian/actions/runs/37768223829), quality [37768223901](https://github.com/ashutoshpw/open-obsidian/actions/runs/37768223901), desktop build [37768223816](https://github.com/ashutoshpw/open-obsidian/actions/runs/37768223816), loaded-plugin workflows [37768223775](https://github.com/ashutoshpw/open-obsidian/actions/runs/37768223775), and plugin renderer [37768223765](https://github.com/ashutoshpw/open-obsidian/actions/runs/37768223765). The history interaction passed on Ubuntu, macOS and Windows. Test counts, job IDs, preview/plugin artifact IDs and digests, and the initial attempt are recorded in `evidence/r2.6.21-history-retention-ui-3ed8e6d.json`.

This headless interaction confirms age-based explicit cleanup and conflict protection. It uses the supported 5-GiB cap and does not render-test the over-cap warning; the vault unit suite covers that planning rule. D16 still needs storage-status interaction acceptance. SYNC-007 host-level uninstall integration and C03/C03.2 full cross-layer acceptance remain open. Next: verify Enabled, Disabled and Unknown OS storage-protection states and the UI refresh action through headless interaction, then continue the remaining R2 acceptance gates in GitHub Actions.

## R2.6.22 accepted OS storage-status UI refresh — source SHA `fc50e9b`

Added a headless `egui_kittest` interaction over the production shell with an injected deterministic storage probe. It renders Enabled, Disabled and Unknown in sequence, verifies the OS-reported and encryption-not-verified wording and report detail, checks that a normal redraw does not rerun the probe, and clicks Refresh storage status to confirm the probe reruns and the report changes. No local executable validation was run.

The first implementation SHA `741c8c77fc5f0429cb6d96c1f0b6753fdefc350d` passed the new interaction on Ubuntu and the full Rust CI on macOS and Windows; Ubuntu requested two rustfmt line-wrap changes. The five companion workflows passed on that SHA. Applied the exact GitHub formatting in `fc50e9bebe41a90c0e9b6b5a8a8579c9729babab`.

All six required workflows passed on exact source SHA `fc50e9bebe41a90c0e9b6b5a8a8579c9729babab`: Rust CI [37770217922](https://github.com/ashutoshpw/open-obsidian/actions/runs/37770217922), inventory [37770218096](https://github.com/ashutoshpw/open-obsidian/actions/runs/37770218096), quality [37770218092](https://github.com/ashutoshpw/open-obsidian/actions/runs/37770218092), desktop build [37770217899](https://github.com/ashutoshpw/open-obsidian/actions/runs/37770217899), plugin renderer [37770218095](https://github.com/ashutoshpw/open-obsidian/actions/runs/37770218095), and loaded-plugin workflows [37770217932](https://github.com/ashutoshpw/open-obsidian/actions/runs/37770217932). The interaction passed on Ubuntu, macOS and Windows. Exact job IDs, package test counts and artifact digests are in `evidence/r2.6.22-storage-status-refresh-fc50e9b.json`.

This interaction validates report presentation and refresh, not the underlying encryption state of each CI host or native-window visual/manual accessibility behavior. D16 still needs an interaction-level over-cap warning check. SYNC-007 host-level uninstall integration and C03/C03.2 full cross-layer acceptance remain open. Next: render the over-cap warning in the UI and prove it never triggers cleanup without explicit confirmation, then continue remaining R2 acceptance in GitHub Actions.

## R2.6.23 accepted over-cap history warning UI — source SHA `b236009`

Added a headless `egui_kittest` interaction that renders an over-cap protected-history warning and the eligible-cleanup review control. Its planner input uses synthetic record metadata just above the UI's 0.1-GiB minimum, avoiding a large fixture artifact. The test confirms the warning leaves cleanup confirmation false and starts no history task; the existing fixture-backed history interaction separately confirms preview/review do not delete artifacts and cleanup only runs after explicit confirmation. No local executable validation was run.

The first source SHA `9d81f2354c3246ee693dbabda16e23920454402d` passed the new UI interaction on all three operating systems and all five companion workflows. Rust CI requested one Ubuntu rustfmt layout change and reported an unnecessary mutable harness binding through macOS/Windows Clippy. Applied those exact corrections in `b2360095025f8c6f3277a8b97119a09a54ee529d`.

All six required workflows passed on exact source SHA `b2360095025f8c6f3277a8b97119a09a54ee529d`: Rust CI [37771857953](https://github.com/ashutoshpw/open-obsidian/actions/runs/37771857953), inventory [37771857931](https://github.com/ashutoshpw/open-obsidian/actions/runs/37771857931), quality [37771857976](https://github.com/ashutoshpw/open-obsidian/actions/runs/37771857976), desktop build [37771857971](https://github.com/ashutoshpw/open-obsidian/actions/runs/37771857971), plugin renderer [37771857939](https://github.com/ashutoshpw/open-obsidian/actions/runs/37771857939), and loaded-plugin workflows [37771857958](https://github.com/ashutoshpw/open-obsidian/actions/runs/37771857958). The interaction passed on Ubuntu, macOS and Windows. Test counts, job IDs and artifact digests are recorded in `evidence/r2.6.23-history-warning-ui-b236009.json`.

Together with R2.6.21's fixture-backed retention and explicit-cleanup behavior and R2.6.22's OS storage-status display/refresh, this closes D16's cap-warning display gap. It remains headless interaction evidence and does not establish native-window visual/manual accessibility acceptance. SYNC-007 host-level uninstall integration and full C03/C03.2 cross-layer acceptance remain open. Next: continue those bounded R2 acceptance slices using GitHub Actions only.

## R2.6.24 accepted fixture-backed duplicate-basename rename interaction — source SHA `a01c8a2`

Extended the production egui rename interaction to use the C03 `same-basename-disambiguated` fixture case. The shared `Folder/Target.md` and `Archive/Target.md` basenames are disambiguated by the heading subpath in `[[Target#Overview]]`. Preview reports one update and no skips and leaves every fixture file unchanged; after separate review and explicit confirmation, the intended note moves and reference updates, the unrelated same-basename note remains byte-identical, and the session refresh lists the new path. No local executable validation was run.

The first source SHA `c4d717bb85276f6cd6415507a23b4771e2713352` passed the inventory, quality, desktop-build and loaded-plugin workflows. Rust CI [37773268853](https://github.com/ashutoshpw/open-obsidian/actions/runs/37773268853) found the new test's missing `Path` import and rustfmt layout differences. The plugin-renderer workflow [37773268828](https://github.com/ashutoshpw/open-obsidian/actions/runs/37773268828) passed on macOS and Windows, while its Ubuntu job was cancelled after the 20-minute timeout. Added the import and applied CI's formatting corrections in `a01c8a2d4d144816b393885e86aec9b633aa0949`.

All six required workflows passed on exact source SHA `a01c8a2d4d144816b393885e86aec9b633aa0949`: Rust CI [37775644956](https://github.com/ashutoshpw/open-obsidian/actions/runs/37775644956), inventory [37775644873](https://github.com/ashutoshpw/open-obsidian/actions/runs/37775644873), quality [37775644982](https://github.com/ashutoshpw/open-obsidian/actions/runs/37775644982), desktop build [37775644939](https://github.com/ashutoshpw/open-obsidian/actions/runs/37775644939), plugin renderer [37775644978](https://github.com/ashutoshpw/open-obsidian/actions/runs/37775644978), and loaded-plugin workflows [37775645024](https://github.com/ashutoshpw/open-obsidian/actions/runs/37775645024). The interaction passed on Ubuntu, macOS and Windows; Rust formatting, workspace tests, Clippy, crate layering, native builds and Wry probes also passed. GitHub's native Rust `Parallel group` step completed its wait barrier after both grouped steps succeeded. Package test counts, job IDs and artifact digests are in `evidence/r2.6.24-subpath-rename-ui-a01c8a2.json`.

This is headless egui interaction evidence, not a launched-window visual or manual accessibility review. Full C03/C03.2 fixture and cross-layer acceptance and SYNC-007 host-level uninstall integration remain open. Next: continue those acceptance gates using GitHub Actions only.

## R2.6.25 accepted shared source-aware link-resolution fixture — source SHA `b5f3249`

Added `fixtures/link-resolution.json`, a shared fixture for wiki and Markdown links, aliases, relative paths, local headings, heading/block subpaths, image embeds, note transclusion, unresolved paths, duplicate headings, duplicate-basename disambiguation and external links. It records expected resolution status/targets/candidate paths and verifies source immutability. Registered the fixture digest in the migration inventory and added `c03_link_forms_fixture_matches_source_aware_resolution` to the shared testkit using production extraction and resolution APIs. No local executable validation was run.

The first source SHA `2aecb9e349a06299e9a700140922ee94ce09d78a` passed inventory, quality, desktop-build and loaded-plugin workflows. The Ubuntu Rust job initially stalled during system dependency installation; its targeted same-SHA rerun completed tests and found two rustfmt changes. The Windows plugin-renderer job also hit a transient integrity failure downloading the pinned Iconize release asset, then passed after rerun on the same SHA. Applied the exact CI formatting corrections in `b5f3249f2e6eb5b98ea6515722f397cea0f3db89`.

All six required workflows passed on exact source SHA `b5f3249f2e6eb5b98ea6515722f397cea0f3db89`: Rust CI [37779411992](https://github.com/ashutoshpw/open-obsidian/actions/runs/37779411992), inventory [37779411993](https://github.com/ashutoshpw/open-obsidian/actions/runs/37779411993), quality [37779412136](https://github.com/ashutoshpw/open-obsidian/actions/runs/37779412136), desktop build [37779412032](https://github.com/ashutoshpw/open-obsidian/actions/runs/37779412032), plugin renderer [37779412010](https://github.com/ashutoshpw/open-obsidian/actions/runs/37779412010), and loaded-plugin workflows [37779412013](https://github.com/ashutoshpw/open-obsidian/actions/runs/37779412013). The fixture-backed resolver test passed on Ubuntu, macOS and Windows; formatting, workspace tests, Clippy, crate layering, native previews, Wry feasibility, inventory traceability, quality, desktop packaging and plugin workflows passed. The Rust native Parallel group completed successfully. Per-package test counts, job IDs, artifacts and digests are recorded in `evidence/r2.6.25-link-resolution-fixture-b5f3249.json`.

This closes a shared fixture/testkit coverage gap, not full C03/C03.2 cross-layer acceptance. Native interactions for all link forms and SYNC-007 host-level uninstall integration remain open. Next: continue those acceptance gates with executable checks only in GitHub Actions.

## R2.6.26 accepted shared mixed-link rename UI interaction — source SHA `7b3c3d1`

Replaced the hardcoded basic rename interaction with the shared resolved C03 fixture case covering wiki, Markdown and embed references. The production egui interaction opens the fixture through `VaultSession`, previews four updates with no skips and no byte changes, then requires separate review and explicit confirmation before apply. It verifies the note moves, the refreshed session lists the destination, all fixture files match expected post-apply bytes, and BOM/CRLF/aliases/subpaths remain intact. No local executable validation was run.

The first source SHA `2f35990028fa86757fae75f3ef0bb96105e46e18` passed all five companion workflows; the fixture interaction and workspace tests passed on Ubuntu, macOS and Windows. Ubuntu rustfmt requested two layout changes. Applied the exact CI layout in `7b3c3d1a115d79badb4816182f74ab709b145bed`.

All six required workflows passed on exact source SHA `7b3c3d1a115d79badb4816182f74ab709b145bed`: Rust CI [37781838520](https://github.com/ashutoshpw/open-obsidian/actions/runs/37781838520), inventory [37781838505](https://github.com/ashutoshpw/open-obsidian/actions/runs/37781838505), quality [37781838559](https://github.com/ashutoshpw/open-obsidian/actions/runs/37781838559), desktop build [37781838501](https://github.com/ashutoshpw/open-obsidian/actions/runs/37781838501), plugin renderer [37781838527](https://github.com/ashutoshpw/open-obsidian/actions/runs/37781838527), and loaded-plugin workflows [37781838497](https://github.com/ashutoshpw/open-obsidian/actions/runs/37781838497). The UI interaction passed on all three OSes; formatting, workspace tests, Clippy, crate layering, native builds, Wry probes and the Rust parallel group passed. Test counts, job IDs and artifact digests are recorded in `evidence/r2.6.26-ui-mixed-link-rename-7b3c3d1.json`.

This advances fixture-backed C03/C03.2 UI acceptance but does not cover every link form/cross-layer case or native-window visual/manual accessibility acceptance. SYNC-007 host-level uninstall integration remains open. Next: continue full C03/C03.2 acceptance and host-level uninstall preservation, keeping executable validation in GitHub Actions.

## R2.6.27 accepted snapshot-bound vault link resolution API — source SHA `a6fb330`

Added `VaultRoot::resolve_links_for_note` and the `VaultSession` wrapper. Resolution requires an existing regular Markdown note, reads sources through the confined vault reader, considers regular vault files as candidates while excluding symlinks, and rejects a changed before/after snapshot. The API is read-only. The shared C03 link-resolution fixture now passes through this vault/engine path and compares reference forms, expected statuses, resolved targets and candidate paths while verifying unchanged snapshot and exact file bytes. No local executable validation was run.

The first source SHA `6bd5c5e2ec885fe0069ff54b38c374730de206e5` passed the five companion workflows and workspace tests on Ubuntu, macOS and Windows. Ubuntu Rust CI requested rustfmt layout corrections in the new fixture and vault code. Applied those exact CI corrections in `a6fb3309fcce87bd4d4644b1071763c56e12007b`.

All six required workflows passed on exact source SHA `a6fb3309fcce87bd4d4644b1071763c56e12007b`: Rust CI [37784366922](https://github.com/ashutoshpw/open-obsidian/actions/runs/37784366922), inventory [37784366970](https://github.com/ashutoshpw/open-obsidian/actions/runs/37784366970), quality [37784366940](https://github.com/ashutoshpw/open-obsidian/actions/runs/37784366940), desktop build [37784367156](https://github.com/ashutoshpw/open-obsidian/actions/runs/37784367156), plugin renderer [37784367082](https://github.com/ashutoshpw/open-obsidian/actions/runs/37784367082), and loaded-plugin workflows [37784367302](https://github.com/ashutoshpw/open-obsidian/actions/runs/37784367302). Formatting, workspace tests, Clippy, crate layering, native previews and unchanged-plugin feasibility probes passed across the Rust matrix. The new fixture test passed on all three operating systems. Exact package counts, job IDs and artifact digests are in `evidence/r2.6.27-vault-link-resolution-a6fb330.json`.

This validates the snapshot-bound vault-to-engine resolver API, not user-facing native link-status presentation or full C03/C03.2 cross-layer acceptance. SYNC-007 host-level uninstall integration remains open. Next: continue those acceptance gates using GitHub Actions only.

## R2.6.28 accepted fixture-backed native link status UI — source SHA `63ad990`

Added a per-note egui link-status panel backed by the snapshot-bound `VaultSession` resolver. It reports resolved, ambiguous, unresolved and external counts and shows each reference's kind, raw text, target, candidates, alias and subpath. The resolver runs on a Rayon worker and is serialized with history and rename operations; the fixture-driven UI interaction verifies displayed details and unchanged vault bytes. No local executable validation was run.

The initial source SHA `dfe760f6aa12aae0502fb8e08f15b2786967f4c3` exposed a duplicate kittest query and Ubuntu rustfmt corrections. The follow-up SHA `7375807a1dc4e5efd5cf00087431aabc77d9fc15` passed workspace tests on all three OSes but exposed one remaining rustfmt line; its macOS Electron retrieval audit failed once while Ubuntu and Windows passed. Applied the exact formatter correction in `63ad990443aeade86806709775ec3eb8a2ab5398`; the fresh quality matrix passed on all three OSes.

All six required workflows passed on exact source SHA `63ad990443aeade86806709775ec3eb8a2ab5398`: Rust CI [37788415419](https://github.com/ashutoshpw/open-obsidian/actions/runs/37788415419), inventory [37788415417](https://github.com/ashutoshpw/open-obsidian/actions/runs/37788415417), quality [37788415354](https://github.com/ashutoshpw/open-obsidian/actions/runs/37788415354), desktop build [37788415568](https://github.com/ashutoshpw/open-obsidian/actions/runs/37788415568), plugin renderer [37788415403](https://github.com/ashutoshpw/open-obsidian/actions/runs/37788415403), and loaded-plugin workflows [37788415371](https://github.com/ashutoshpw/open-obsidian/actions/runs/37788415371). The new UI test passed in the 14-test `openobsidian-ui-egui` suite on Ubuntu, macOS and Windows; formatting, workspace tests, Clippy, crate layering, native builds, Wry feasibility, and the Rust parallel-group barrier passed. Job IDs, per-crate test counts, artifact IDs and digests are in `evidence/r2.6.28-native-link-status-ui-63ad990.json`.

This provides fixture-backed native presentation but does not complete full C03/C03.2 cross-layer or native-window visual/accessibility acceptance. SYNC-007 host-level uninstall integration remains open. Next: continue those acceptance gates and host-level uninstall preservation, keeping all executable validation in GitHub Actions.

## R2.6.29 accepted bounded Markdown transclusion primitives — source SHA `3db8464`

Added pure `crates/doc` primitives for read-only heading/block slicing and nested note transclusion guards. Slicing shares the existing fence-aware subpath identities, explicitly returns resolved/unresolved/ambiguous statuses, removes only a selected block marker, and preserves original source bytes. The depth/cycle guard caps nested note depth at three, and a 512 KiB decoded-source bound is available to callers. No local executable validation was run.

The first source SHA `e8cb44c41b3753c4392e7521e5645066314041da` exposed incorrect line-ending/section-boundary expectations and Ubuntu rustfmt differences. `7da8f143d74736d7f6974776ef9e93472b6b646a` corrected those but still expected a trailing newline at a heading boundary. `9a3e8c09e7e276625250bf79062668b26b583111` passed tests on all three platforms, while CI requested one rustfmt line and a Clippy `collapsible_if` correction; its macOS Electron retrieval audit failed once. Applied the exact CI fixes in `3db8464e48bfc54e8f2fdf0b60f37becdc43b283`.

All six required workflows passed on exact source SHA `3db8464e48bfc54e8f2fdf0b60f37becdc43b283`: Rust CI [37792786996](https://github.com/ashutoshpw/open-obsidian/actions/runs/37792786996), inventory [37792787021](https://github.com/ashutoshpw/open-obsidian/actions/runs/37792787021), quality [37792786975](https://github.com/ashutoshpw/open-obsidian/actions/runs/37792786975), desktop build [37792786974](https://github.com/ashutoshpw/open-obsidian/actions/runs/37792786974), plugin renderer [37792787006](https://github.com/ashutoshpw/open-obsidian/actions/runs/37792787006), and loaded-plugin workflows [37792786992](https://github.com/ashutoshpw/open-obsidian/actions/runs/37792786992). The `openobsidian-doc` suite passed 24 tests on Ubuntu, macOS and Windows. Formatting, workspace tests, Clippy, crate layering, native builds, unchanged-plugin feasibility and the Rust parallel group passed. Artifact IDs and SHA-256 digests are recorded in `evidence/r2.6.29-bounded-transclusion-3db8464.json`.

This is pure document-core coverage, not complete transclusion: vault/session path resolution, Markdown-only target filtering, bounded file reads and native rendering remain. C03/C03.1 and C03.2 full cross-layer acceptance and SYNC-007 host-level uninstall integration remain pending. Next: integrate bounded note embeds through `VaultSession` and continue those acceptance gates using GitHub Actions only.

## R2.6.30 accepted bounded vault/session note embeds — source SHA `08ab237`

Integrated note-embed resolution through snapshot-bound `VaultRoot` and `VaultSession` APIs. The resolver limits targets to regular Markdown files, checks cycle/depth guards before target reads, enforces the 512 KiB source bound, validates subpaths and rechecks snapshot stability. Snapshot hashing now streams regular files through a fixed-size buffer. Fixture-backed tests cover selected subpaths, attachment exclusion, ambiguous basename disambiguation, guard ordering and oversized targets. No local executable validation was run.

All six required GitHub Actions workflows passed for exact source SHA `08ab2379c9f96af4f1baece934f1711b6d78a24c`: Rust CI [37800020938](https://github.com/ashutoshpw/open-obsidian/actions/runs/37800020938), migration inventory [37800020928](https://github.com/ashutoshpw/open-obsidian/actions/runs/37800020928), quality [37800020964](https://github.com/ashutoshpw/open-obsidian/actions/runs/37800020964), desktop build [37800020941](https://github.com/ashutoshpw/open-obsidian/actions/runs/37800020941), plugin renderer [37800020936](https://github.com/ashutoshpw/open-obsidian/actions/runs/37800020936), and loaded-plugin workflows [37800020931](https://github.com/ashutoshpw/open-obsidian/actions/runs/37800020931). Rust tests, formatting, Clippy, layering, native builds, Wry feasibility and the Rust parallel group passed across Ubuntu, macOS and Windows. Per-crate test counts, job IDs, uploaded artifacts and digests are in `evidence/r2.6.30-note-embed-vault-08ab237.json`.

This completes the vault/engine integration slice only. Native UI rendering through the new session API, full C03/C03.1/C03.2 acceptance and SYNC-007 host-level uninstall integration remain pending. Next: connect the resolver to fixture-backed egui transclusion rendering and continue validation only through GitHub Actions.


## R2.6.31 accepted bounded native note-transclusion preview — source SHA `ea760a6`

Connected the snapshot-bound `VaultSession` note-embed tree to the egui link-inspection panel. The resolver runs on a Rayon worker; the tree is capped at 32 nodes, each source remains bounded to 512 KiB, and the native read-only Markdown source preview is capped at 16 KiB. The fixture interaction verifies included source text, nested-cycle and attachment failure labels, omitted-node reporting, and unchanged vault bytes. The preview is source text rather than formatted Markdown or attachment rendering. No local executable validation was run.

The first source SHA `14c93b2ead4ff6c96e9589c2bfde6f92f9ee9bc5` exposed rustfmt differences and an ambiguous duplicate egui accessible-label query. Corrected those findings in `ea760a6fc6ed173d72412f4298445af8bd9f775f`. All six required workflows passed on that exact SHA: Rust CI [37804148150](https://github.com/ashutoshpw/open-obsidian/actions/runs/37804148150), inventory [37804148101](https://github.com/ashutoshpw/open-obsidian/actions/runs/37804148101), quality [37804148119](https://github.com/ashutoshpw/open-obsidian/actions/runs/37804148119), desktop build [37804148108](https://github.com/ashutoshpw/open-obsidian/actions/runs/37804148108), plugin renderer [37804148128](https://github.com/ashutoshpw/open-obsidian/actions/runs/37804148128), and loaded-plugin workflows [37804148098](https://github.com/ashutoshpw/open-obsidian/actions/runs/37804148098). The first Ubuntu quality attempt did not reach its Electron vault retrieval boundary; rerunning that failed job on the same SHA passed all quality jobs. Per-OS tests, job IDs, artifacts and digests are in `evidence/r2.6.31-native-transclusion-preview-ea760a6.json`.

This is one C03 transclusion UI slice, not full C03/C03.1/C03.2 acceptance. The remaining work includes the complete link-form/status matrix, rename-plan ambiguity and explicit-resolution coverage, and SYNC-007 host-level uninstall preservation. Next: continue those acceptance gates, keeping executable validation in GitHub Actions only.


## R2.6.32 attempt — UI status visibility assertion

Pushed source SHA `76e4d8538e58d32f9a4d8536372da8bf4648d4f9` with fixture-driven assertions for the unresolved link row and ambiguous/unresolved rename decisions in the egui preview. Inventory, quality, desktop build, plugin renderer and loaded-plugin workflows passed. Rust CI failed on Ubuntu, macOS and Windows because the confirmation text is exposed after the second egui frame; the assertion queried it after the first. The assertion is moved after that second frame. Job IDs and exact run outcomes are recorded in `state.json`; the corrected source still needs fresh GitHub Actions results. No local executable validation was run.


## R2.6.32 accepted C03.1/C03.2 egui visibility acceptance — source SHA `a30a98c`

Added fixture-driven egui assertions that unresolved note references remain visible with their source target and that ambiguous/unresolved rename references show explicit stay-unchanged decisions before confirmation. Applying the fixture move updates zero references and preserves all unrelated file bytes. The first attempt `76e4d85` queried confirmation text before the second egui frame; corrected in `a30a98c90e4a8b97d3743c0960b0a02133b14327`. No local executable validation was run.

All six required GitHub Actions workflows passed on exact SHA `a30a98c90e4a8b97d3743c0960b0a02133b14327`: Rust CI [37809286291](https://github.com/ashutoshpw/open-obsidian/actions/runs/37809286291), inventory [37809286093](https://github.com/ashutoshpw/open-obsidian/actions/runs/37809286093), quality [37809286318](https://github.com/ashutoshpw/open-obsidian/actions/runs/37809286318), desktop build [37809286088](https://github.com/ashutoshpw/open-obsidian/actions/runs/37809286088), plugin renderer [37809286236](https://github.com/ashutoshpw/open-obsidian/actions/runs/37809286236), and loaded-plugin workflows [37809286106](https://github.com/ashutoshpw/open-obsidian/actions/runs/37809286106). The UI interaction suite passed 14 tests on Ubuntu, macOS and Windows. Formatting, all workspace tests, Clippy, layering, native preview builds, unchanged-plugin feasibility, and the Rust parallel group passed. Job IDs, per-crate counts, artifacts and SHA-256 digests are in `evidence/r2.6.32-link-rename-visibility-a30a98c.json`.

C03.1 and C03.2 now pass. Parent C03 remains open for complete transclusion behavior; formatted Markdown and attachment rendering remain outside this preview. SYNC-007 host-level uninstall integration remains pending. Next: continue parent C03 and host-level uninstall preservation through GitHub Actions.


## R2.6.33 accepted formatted Markdown note transclusions — source SHA `158ee2f`

Resolved note transclusions now render as CommonMark in the native egui preview using the pinned `egui_commonmark` 0.25.0 renderer, aligned with egui 0.36. The app reuses a `CommonMarkCache`. Default features are disabled, so image loading and network fetching remain off; the renderer stays read-only and cannot use Markdown to open arbitrary local files. Fixture coverage checks a rendered heading and bold text while confirming vault bytes are unchanged. No local executable validation was run.

The first implementation SHA `0f1c98475f00112f9523ce4b5b359c125810de7e` failed locked Rust CI because the new dependency needed a refreshed `Cargo.lock`; the migration inventory also reported the temporary lockfile bootstrap workflow and stale fixture hash. A GitHub Actions resolver run generated the lockfile artifact, and the temporary workflow was removed. The follow-up SHA `3b9dc56a60d04d7cb277bf276fdd3ff435008d6b` passed workspace tests on all operating systems; Ubuntu then reported an import-order rustfmt correction. Applied that exact correction in `158ee2ff5e8be7e569c8a34da05dfa5ffe66c21b`.

All six required workflows passed on exact source SHA `158ee2ff5e8be7e569c8a34da05dfa5ffe66c21b`: Rust CI [37813290567](https://github.com/ashutoshpw/open-obsidian/actions/runs/37813290567), inventory [37813290516](https://github.com/ashutoshpw/open-obsidian/actions/runs/37813290516), quality [37813290528](https://github.com/ashutoshpw/open-obsidian/actions/runs/37813290528), desktop build [37813290498](https://github.com/ashutoshpw/open-obsidian/actions/runs/37813290498), plugin renderer [37813290629](https://github.com/ashutoshpw/open-obsidian/actions/runs/37813290629), and loaded-plugin workflows [37813290575](https://github.com/ashutoshpw/open-obsidian/actions/runs/37813290575). Formatting, workspace tests, Clippy, crate layering, native preview builds and unchanged-plugin feasibility passed across Ubuntu, macOS and Windows. Per-crate test counts, job IDs, artifacts and SHA-256 digests are in `evidence/r2.6.33-formatted-markdown-transclusions-158ee2f.json`.

This accepts formatted rendering for note transclusions, not complete parent C03 behavior. Attachment image rendering through bounded vault-mediated reads remains open, as does SYNC-007 host-level uninstall preservation. Next: continue those slices through GitHub Actions only.


## Desktop release preflights use native parallel steps — validated SHA `2d207d1`

The workflows already used GitHub Actions `parallel` groups for independent compatibility, quality, desktop audit, and Rust checks. Added one more group in `.github/workflows/desktop-build.yml`: the release gate and update/rollback manifest check read separate inputs and share no outputs, so they can run concurrently and then wait before signing and packaging. This follows GitHub's [`parallel` step feature](https://github.blog/changelog/2026-06-25-actions-steps-can-now-be-run-in-parallel/).

The first workflow commit `825189d763aa39f2a67bb643063dec9c1ec1a2a4` passed desktop build and the other four companion workflows, but inventory CI required the workflow hash to be refreshed. Updated the inventory record in `2d207d1823d486c64acb2192ae14ebe82c19a87e`. All six required workflows then passed on that exact SHA: inventory [37814827922](https://github.com/ashutoshpw/open-obsidian/actions/runs/37814827922), Rust CI [37814827806](https://github.com/ashutoshpw/open-obsidian/actions/runs/37814827806), quality [37814827797](https://github.com/ashutoshpw/open-obsidian/actions/runs/37814827797), desktop build [37814827874](https://github.com/ashutoshpw/open-obsidian/actions/runs/37814827874), plugin renderer [37814827811](https://github.com/ashutoshpw/open-obsidian/actions/runs/37814827811), and loaded-plugin workflows [37814827805](https://github.com/ashutoshpw/open-obsidian/actions/runs/37814827805). The desktop `parallel` barrier passed on Ubuntu, macOS and Windows. Job IDs are recorded in `evidence/parallel-ci-desktop-preflight-2d207d1.json`.


## R2.6.34 accepted bounded vault image attachments — source SHA `a0a81e5`

Added revision-verified, bounded raster attachment decoding to the vault/session path and native egui previews for BMP, GIF, ICO, JPEG, PNG and WebP. Decoding is limited to 8 MiB per source, dimensions up to 4096, 4,194,304 decoded pixels per image, a 64 MiB decoder allocation limit, and shared report caps of 8 images, 16 MiB source bytes and 8,388,608 decoded pixels. The renderer caches textures by content SHA-256, caps the displayed size at 640×480 and exposes the alias as accessible text. Unsupported attachments remain inert; previews are static. No local executable validation was run.

Dependency preparation pinned `image` 0.25.10 with default features disabled and only the six supported codecs enabled. A temporary GitHub Actions resolver run on preparation commit `5d0ebffad84d576f42fcd8304e7b2d7211202fea` produced the lockfile artifact [11567179971](https://github.com/ashutoshpw/open-obsidian/actions/runs/37818676025); its digest and the resulting `Cargo.lock` hash are recorded in the evidence file. The temporary resolver workflow was removed before implementation validation.

The initial implementation SHA `0bb109375b4045ec3ca77e4c84f7de11552b7b19` passed the five companion workflows; Rust CI found rustfmt layout changes and a UI fixture that lacked the session needed to render the transclusion panel. `b8d972b50fe53e1a0e51bcebd7bf2fc0c47223d6` fixed those findings; five companion workflows passed and Rust CI then identified Clippy's `too_many_arguments` warning in the recursive resolver. Consolidated the shared node/image limits into a budget object in `a0a81e5b7464767204fa55c27c1dc7afb245c309`.

All six required workflows passed on exact implementation SHA `a0a81e5b7464767204fa55c27c1dc7afb245c309`: Rust CI [37822490487](https://github.com/ashutoshpw/open-obsidian/actions/runs/37822490487), inventory [37822489753](https://github.com/ashutoshpw/open-obsidian/actions/runs/37822489753), quality [37822489549](https://github.com/ashutoshpw/open-obsidian/actions/runs/37822489549), desktop build [37822490562](https://github.com/ashutoshpw/open-obsidian/actions/runs/37822490562), plugin renderer [37822489829](https://github.com/ashutoshpw/open-obsidian/actions/runs/37822489829), and loaded-plugin workflows [37822489819](https://github.com/ashutoshpw/open-obsidian/actions/runs/37822489819). Formatting, workspace tests, Clippy, layering, native preview builds, unchanged-plugin feasibility and the bounded image/UI fixtures passed across all three OSes. Test counts, job IDs, artifact IDs and SHA-256 digests are in `evidence/r2.6.34-bounded-vault-image-attachments-a0a81e5.json`.

This accepts bounded static previews for the supported raster formats. It does not complete parent C03 attachment/link behavior; SVG/AVIF and animation playback remain unsupported. SYNC-007 host-level uninstall preservation and native-window human accessibility checks remain open. Next: complete remaining C03 behavior and SYNC-007 through GitHub Actions only.


## R2.6.35 accepted vault-to-egui image preview interaction — source SHA `443b716`

Strengthened the existing image preview interaction so it no longer injects a prebuilt decoded image. The test now puts the checked-in PNG asset in a temporary vault, resolves it through `VaultSession::resolve_note_embeds_for_note`, checks the decoded RGBA dimensions, verifies the native egui image has accessible alias text and a cached texture, and confirms rendering leaves the source attachment bytes identical. No local executable validation was run.

All six required workflows passed on exact source SHA `443b7161eacbfd4c770927dc368836f938878a04`: Rust CI [37825268425](https://github.com/ashutoshpw/open-obsidian/actions/runs/37825268425), inventory [37825268614](https://github.com/ashutoshpw/open-obsidian/actions/runs/37825268614), quality [37825268654](https://github.com/ashutoshpw/open-obsidian/actions/runs/37825268654), desktop build [37825268485](https://github.com/ashutoshpw/open-obsidian/actions/runs/37825268485), plugin renderer [37825268489](https://github.com/ashutoshpw/open-obsidian/actions/runs/37825268489), and loaded-plugin workflows [37825268491](https://github.com/ashutoshpw/open-obsidian/actions/runs/37825268491). Rust formatting, workspace tests including the new vault-to-egui path, Clippy, dependency layering, native preview builds, unchanged-plugin feasibility and the parallel group passed across all three OSes. Job IDs, artifact IDs and digests are in `evidence/r2.6.35-vault-to-egui-image-preview-443b716.json`.

This verifies the end-to-end path for a supported PNG image only; the full parent C03 acceptance audit and SYNC-007 host-level uninstall integration remain open. The latter depends on selecting a native package/uninstaller during R6. Next: audit the remaining C03 fixture coverage, then implement the SYNC-007 host cleanup path through GitHub Actions as the packaging design becomes available.


## R2.6.36 accepted parent C03 cross-layer link and transclusion behavior — tested source SHA `443b716`

Closed the parent C03 row after reviewing the accumulated fixtures and rerunning the complete Rust workspace suite on exact source SHA `443b7161eacbfd4c770927dc368836f938878a04`. Coverage spans source-aware wiki/Markdown/relative links, aliases, headings/blocks, unresolved and ambiguous results, snapshot-bound vault resolution, embedded notes and supported image attachments, byte-preserving rename plans/apply/rollback, and fixture-backed egui review/render interactions. Updated the C03 requirement row to `passing` and linked the evidence chain. Unsupported attachment formats stay inert; the human packaged-window accessibility review and SYNC-007 uninstall path remain open.

All six required workflows passed on the tested source: Rust CI [37825268425](https://github.com/ashutoshpw/open-obsidian/actions/runs/37825268425), inventory [37825268614](https://github.com/ashutoshpw/open-obsidian/actions/runs/37825268614), quality [37825268654](https://github.com/ashutoshpw/open-obsidian/actions/runs/37825268654), desktop build [37825268485](https://github.com/ashutoshpw/open-obsidian/actions/runs/37825268485), plugin renderer [37825268489](https://github.com/ashutoshpw/open-obsidian/actions/runs/37825268489), and loaded-plugin workflows [37825268491](https://github.com/ashutoshpw/open-obsidian/actions/runs/37825268491). The indexed fixture mapping is in `evidence/r2.6.36-c03-cross-layer-acceptance-443b716.json`.

Next: implement an explicit, conflict-safe cleanup executor for app-owned data and define its adapter seam for the native uninstaller. The actual OS uninstall workflow will be validated when the R6 packaging format is selected; all executable checks remain in GitHub Actions.


## R2.6.37 cleanup executor implementation — GitHub CI pending

Added an explicit platform cleanup API for app-owned root/per-vault data, with ownership markers, target preflight checks, and a CLI adapter for package-supplied selections. Cache cleanup is restricted to marked per-vault data roots; conflicts, vault files, journals, unknown neighbors, and recovery directories referenced by pending, failed, malformed, unreadable, or oversized operation journals are preserved. The shared fixture now includes a prepared rename journal and its before-image. Recovery cleanup reports preserved journal directories to the caller.

Added an application-scoped credential deletion method to the platform seam. There is still no native credential backend, so the CLI reports that selected credential cleanup as unavailable rather than claiming success. The UI checkboxes remain a preview, and no OS package invokes the cleanup adapter yet; that integration remains an R6 handoff and must run after the desktop process exits.

Focused platform and CLI tests are authored but have not been executed locally. R2.6.37 remains in progress until the exact pushed implementation SHA passes GitHub Actions; no local executable validation was run.

The first exact-SHA Rust CI run [37829742165](https://github.com/ashutoshpw/open-obsidian/actions/runs/37829742165) for source `951b1677c251a5f05bef19350decc015428a365d` passed the workspace tests on Ubuntu, macOS and Windows. Ubuntu reported rustfmt-only source layout differences; macOS and Windows reported one strict Clippy finding because `UserDataCleanupOutcome`'s `Default` implementation was derivable. The five companion workflows passed on the same source: inventory [37829742187](https://github.com/ashutoshpw/open-obsidian/actions/runs/37829742187), quality [37829742154](https://github.com/ashutoshpw/open-obsidian/actions/runs/37829742154), desktop [37829742221](https://github.com/ashutoshpw/open-obsidian/actions/runs/37829742221), plugin renderer [37829742225](https://github.com/ashutoshpw/open-obsidian/actions/runs/37829742225), and loaded-plugin workflows [37829742268](https://github.com/ashutoshpw/open-obsidian/actions/runs/37829742268). Applied only the formatter and Clippy corrections requested by those logs; the corrected SHA remains subject to fresh CI. No local executable validation was run.

R2.6.37 passed all six required workflows on exact source SHA `62c2dfd07615af2110beaa49bf1627162be469fd`: Rust CI [37830288660](https://github.com/ashutoshpw/open-obsidian/actions/runs/37830288660), inventory [37830288726](https://github.com/ashutoshpw/open-obsidian/actions/runs/37830288726), quality [37830288730](https://github.com/ashutoshpw/open-obsidian/actions/runs/37830288730), desktop build [37830288689](https://github.com/ashutoshpw/open-obsidian/actions/runs/37830288689), plugin renderer [37830288825](https://github.com/ashutoshpw/open-obsidian/actions/runs/37830288825), and loaded-plugin workflows [37830288775](https://github.com/ashutoshpw/open-obsidian/actions/runs/37830288775). Rust formatting, workspace tests, Clippy, dependency layering, native preview builds, unchanged-plugin probes, and the parallel group passed across Ubuntu/macOS/Windows. Artifact IDs and digests are recorded in `evidence/r2.6.37-uninstall-cleanup-62c2dfd.json`. R2.6.37 is accepted as a cleanup executor/API slice; invoking it from an OS uninstaller remains an R6 handoff, credential deletion still needs a native backend, and current UI choices are a preview. No local executable validation was run.


## R2.6.38 existing-vault in-place opening — in progress

The state ledger was reconciled to pushed HEAD `c61e473d3263c2c473fc58b2017b13536e77512f`. The next slice targets pending D02 and the existing-vault portions of C01.1 and MIG-012. Added a shared synthetic vault fixture with BOM/CRLF Markdown, `.obsidian` settings, unknown paths and binary bytes; the egui interaction opens the selected existing folder through `VaultSession`, checks the SHA-256 revision and app-data boundary, and compares every file and directory before and after UI open/close. All executable validation remains pending GitHub Actions CI; no local tests or builds were run. Broad C01 no-op coverage and reference-application round trips remain open.

The first exact-SHA CI attempt for `513cb2de8fc041705ede595027cbe0bfffb6ca93` failed Rust CI [37832820221](https://github.com/ashutoshpw/open-obsidian/actions/runs/37832820221): workspace tests found that the test treated the expected false `requires_import_or_conversion` invariant as true, and Ubuntu rustfmt requested two layout changes. Inventory [37832820248](https://github.com/ashutoshpw/open-obsidian/actions/runs/37832820248), quality [37832820257](https://github.com/ashutoshpw/open-obsidian/actions/runs/37832820257), desktop [37832820315](https://github.com/ashutoshpw/open-obsidian/actions/runs/37832820315), plugin renderer [37832820287](https://github.com/ashutoshpw/open-obsidian/actions/runs/37832820287) and loaded-plugin workflows [37832820256](https://github.com/ashutoshpw/open-obsidian/actions/runs/37832820256) passed on that SHA. Applied those CI-reported corrections; fresh exact-SHA validation is pending. No local executable validation was run.

The second exact-SHA attempt on `120df20b4f6d78b79391b56bb187f2a0533b7586` passed inventory [37833353346](https://github.com/ashutoshpw/open-obsidian/actions/runs/37833353346), quality [37833353354](https://github.com/ashutoshpw/open-obsidian/actions/runs/37833353354), desktop [37833353602](https://github.com/ashutoshpw/open-obsidian/actions/runs/37833353602), plugin renderer [37833353351](https://github.com/ashutoshpw/open-obsidian/actions/runs/37833353351) and loaded-plugin workflows [37833353401](https://github.com/ashutoshpw/open-obsidian/actions/runs/37833353401). Workspace tests passed on all three OSes; macOS and Windows completed their Rust checks. Rust CI [37833353340](https://github.com/ashutoshpw/open-obsidian/actions/runs/37833353340) failed only because Ubuntu rustfmt requested one remaining line-wrap change in the app-state invariant assertion. Applied the exact formatting correction; fresh CI is pending. No local executable validation was run.


R2.6.38 accepted existing-vault in-place opening — source SHA `10a69a8`

The shared existing-vault fixture and native egui interaction now prove the focused opening slice: selected directory opened in place through `VaultSession`, no import/conversion, app data kept outside the vault, SHA-256 note revisions, and exact tree/byte preservation across a read-only open/close. Fixture content includes BOM/CRLF Markdown, `.obsidian` settings, unknown paths and binary bytes. D02 and MIG-012 pass for this slice. The existing-vault subset of C01.1 has evidence, while the broad C01/C01.1 no-op corpus and C01.2 reference-app round trips remain pending.

All six required workflows passed on exact source SHA `10a69a8ace2cd765295cf239e11532e13d894f74`: Rust CI [37834098114, attempt 2](https://github.com/ashutoshpw/open-obsidian/actions/runs/37834098114), inventory [37834098153](https://github.com/ashutoshpw/open-obsidian/actions/runs/37834098153), quality [37834098150](https://github.com/ashutoshpw/open-obsidian/actions/runs/37834098150), desktop build [37834098205](https://github.com/ashutoshpw/open-obsidian/actions/runs/37834098205), plugin renderer [37834098108](https://github.com/ashutoshpw/open-obsidian/actions/runs/37834098108), and loaded-plugin workflows [37834098162](https://github.com/ashutoshpw/open-obsidian/actions/runs/37834098162). Formatting, workspace tests, Clippy, layering, native preview builds, unchanged-plugin feasibility and the Rust parallel group passed; the new UI interaction passed on Ubuntu, macOS and Windows. The first Ubuntu attempt stalled during system dependency installation and was cancelled; rerunning only the failed part on the same SHA passed. Job IDs, artifacts and SHA-256 digests are in `evidence/r2.6.38-existing-vault-in-place-10a69a8.json`. No local executable validation was run.

The GitHub Actions native `parallel` step feature requested by the user is already implemented in the compatibility, quality, desktop-build and Rust workflows. Its use in desktop release preflights was accepted on exact SHA `2d207d1823d486c64acb2192ae14ebe82c19a87e` (see `evidence/parallel-ci-desktop-preflight-2d207d1.json`); the current Rust run also passed its parallel group.


## R2.6.39 existing-vault read-only operation audit — awaiting GitHub CI

Extended `fixtures/existing-vault.json` with a resolved wiki link and heading embed while retaining its BOM/CRLF Markdown, `.obsidian` settings, unknown paths and binary files. Added a shared testkit interaction that scans and reads the vault, resolves links and note embeds, prepares and revalidates a rename preview, and compares the full path/type/byte tree after each read-only operation. The fixture also records the expected link resolutions and preview update count.

The source slice is ready for exact-SHA GitHub Actions validation. No local tests, builds, formatters, linters or executable checks were run. C01.1, C01.2 and parent C01 remain pending until CI evidence is reviewed.


The first R2.6.39 CI attempt used exact source SHA `8aa618b78ed47800c8a773ccc1c6863f33a9845a`. The new shared test passed on Ubuntu, macOS and Windows. Rust CI failed only on the six Ubuntu rustfmt layout requests; macOS and Windows Rust jobs passed. The quality, desktop build, plugin renderer and loaded-plugin workflows passed. Inventory CI reported the stale `fixtures/existing-vault.json` hash; I refreshed it and updated reader metadata to include the testkit consumer. Fresh exact-SHA CI is pending.

## R2.6.39 accepted existing-vault read-only operation no-op corpus — source SHA ebece90

Extended the shared arbitrary-content existing-vault fixture with a resolved wiki link and heading embed. The testkit now scans and reads the vault, checks SHA-256 revisions, resolves links and note embeds, renders a transclusion, prepares and revalidates a rename preview, and verifies the complete path/type/byte tree remains unchanged after each read-only operation. The rename path remains preview-only.

The first source SHA 8aa618b78ed47800c8a773ccc1c6863f33a9845a passed the new test on all three operating systems, but Ubuntu rustfmt requested six layout changes and inventory CI reported the stale fixture hash. Applied the CI diff and refreshed fixture hash and reader metadata in ebece9002b2c574433012bc914e3d1b00466ca07.

All six required workflows passed on exact source SHA ebece9002b2c574433012bc914e3d1b00466ca07: Rust CI [37838299698](https://github.com/ashutoshpw/open-obsidian/actions/runs/37838299698), inventory [37838299814](https://github.com/ashutoshpw/open-obsidian/actions/runs/37838299814), quality [37838300055](https://github.com/ashutoshpw/open-obsidian/actions/runs/37838300055), desktop build [37838299733](https://github.com/ashutoshpw/open-obsidian/actions/runs/37838299733), plugin renderer [37838299747](https://github.com/ashutoshpw/open-obsidian/actions/runs/37838299747), and loaded-plugin workflows [37838299825](https://github.com/ashutoshpw/open-obsidian/actions/runs/37838299825). The named test passed on Ubuntu, macOS and Windows. Job IDs and artifact IDs/digests are in evidence/r2.6.39-existing-vault-read-only-ebece90.json. No local executable validation was run.

C01.1 now passes for this arbitrary-content no-op corpus slice. Parent C01 and C01.2 remain open for the complete product-level read-only workflow and reference-application round-trip matrix; this result does not certify every vault content combination. Next: cover the next smallest end-to-end read-only flow through GitHub Actions.


## R2.6.40 accepted existing-vault UI preview preservation — source SHA 8819bb4

Added a native egui interaction using the shared existing-vault fixture. It resolves the fixture's wiki link and note embed, checks the transclusion report, builds the rename preview without applying it, and compares the complete filesystem path/type/byte tree after each UI operation and after closing the UI. The app-data directory remains empty.

The first source SHA 8f46c156d354071651c805dd2eed97cff829a89c failed to compile the new test on all three operating systems because the destination String was moved before the filesystem assertion. Cloned the value as requested by Rust CI in 8819bb44722b8652d8ba40e10ec85ea41cb065a5.

All six required workflows passed on exact source SHA 8819bb44722b8652d8ba40e10ec85ea41cb065a5: Rust CI [37840008687](https://github.com/ashutoshpw/open-obsidian/actions/runs/37840008687), inventory [37840008662](https://github.com/ashutoshpw/open-obsidian/actions/runs/37840008662), quality [37840008681](https://github.com/ashutoshpw/open-obsidian/actions/runs/37840008681), desktop build [37840008673](https://github.com/ashutoshpw/open-obsidian/actions/runs/37840008673), plugin renderer [37840008794](https://github.com/ashutoshpw/open-obsidian/actions/runs/37840008794), and loaded-plugin workflows [37840008682](https://github.com/ashutoshpw/open-obsidian/actions/runs/37840008682). The named UI test passed on Ubuntu, macOS and Windows. Job IDs and artifact IDs/digests are in evidence/r2.6.40-existing-vault-ui-preservation-8819bb4.json. No local executable validation was run.

Parent C01 and C01.2 remain open for the complete product read-only and reference-application round-trip matrix. C01.1 remains passing for the tested arbitrary-content no-op corpus; this slice does not certify every vault content combination. Continue R2 with the next uncovered C01 read-only flow through GitHub Actions.


## R2.6.41 accepted existing-vault history UI preservation — source SHA `c58cbed`

Extended the history-retention UI interaction to materialize the shared existing-vault fixture, including settings, unknown paths and binary content. It compares the complete vault path/type/byte tree after history preview, before cleanup confirmation, after app-data cleanup, and after closing the UI. Eligible recovery artifacts are pruned only after confirmation; the protected conflict artifact and its bytes remain intact.

The first exact-SHA attempt on `6616f92dca5076702f6595194074438fac407703` passed workspace tests on Ubuntu, macOS and Windows, including the new history interaction. Ubuntu rustfmt requested five layout corrections; the other five required workflows passed and macOS/Windows Rust jobs passed. Applied the CI-requested formatting changes in `c58cbed45b9815af038f19fef7676d021b667a56`.

All six required workflows passed on the corrected exact SHA: Rust CI [37841826110](https://github.com/ashutoshpw/open-obsidian/actions/runs/37841826110), inventory [37841826105](https://github.com/ashutoshpw/open-obsidian/actions/runs/37841826105), quality [37841826059](https://github.com/ashutoshpw/open-obsidian/actions/runs/37841826059), desktop build [37841826132](https://github.com/ashutoshpw/open-obsidian/actions/runs/37841826132), plugin renderer [37841826037](https://github.com/ashutoshpw/open-obsidian/actions/runs/37841826037), and loaded-plugin workflows [37841826101](https://github.com/ashutoshpw/open-obsidian/actions/runs/37841826101). The named history UI test passed on Ubuntu, macOS and Windows. Job IDs, artifacts and SHA-256 digests are in [`evidence/r2.6.41-existing-vault-history-preservation-c58cbed.json`](evidence/r2.6.41-existing-vault-history-preservation-c58cbed.json). No local executable validation was run.

C01.1 remains passing for the tested arbitrary-content no-op corpus. Parent C01 and C01.2 remain open for the broader product read-only workflow matrix and reference-application round trips. Next: cover the next uncovered C01 read-only product flow and prepare the C01.2 round-trip matrix through GitHub Actions only.

## R2.6.42 accepted existing-vault uninstall cleanup-choice preview — source SHA `3b0e251`

Added a native egui interaction using the shared arbitrary-content existing-vault fixture. It opens the selected directory in place, snapshots the complete vault and separate app-data trees, and selects each optional uninstall cleanup choice one at a time. The full path/type/byte trees remain unchanged after each choice and after closing the UI; the controls only preview options and do not run cleanup.

The first exact-SHA attempt on `4a005df8d745eece7ea0ea81a89ac30646126536` passed workspace tests on Ubuntu, macOS and Windows, including the new preservation interaction. Ubuntu rustfmt requested one line-wrap change; the other five required workflows passed and macOS/Windows Rust checks passed. Applied the requested formatting in `3b0e251e4044699d90d1844709290f74a7805588`.

All six required workflows passed on corrected exact SHA `3b0e251e4044699d90d1844709290f74a7805588`: Rust CI [37844353485](https://github.com/ashutoshpw/open-obsidian/actions/runs/37844353485), inventory [37844353449](https://github.com/ashutoshpw/open-obsidian/actions/runs/37844353449), quality [37844353470](https://github.com/ashutoshpw/open-obsidian/actions/runs/37844353470), desktop build [37844353406](https://github.com/ashutoshpw/open-obsidian/actions/runs/37844353406), plugin renderer [37844353479](https://github.com/ashutoshpw/open-obsidian/actions/runs/37844353479), and loaded-plugin workflows [37844353350](https://github.com/ashutoshpw/open-obsidian/actions/runs/37844353350). The named UI test passed on Ubuntu, macOS and Windows. Job IDs and artifact SHA-256 digests are in [`evidence/r2.6.42-existing-vault-uninstall-preview-3b0e251.json`](evidence/r2.6.42-existing-vault-uninstall-preview-3b0e251.json). No local executable validation was run.

C01.1 remains passing for the tested arbitrary-content no-op corpus. Parent C01 and C01.2 remain open for the broader read-only product workflow matrix and reference-application round trips. The next R2 slice will cover existing-vault conflict inspection as a read-only preview, alongside preparation of the C01.2 round-trip matrix through GitHub Actions only.

## R2.6.43 accepted existing-vault conflict inspection — source SHA `e9a0afe`

Extended the existing-vault history UI interaction to inspect the protected conflict after confirmed cleanup. It checks both current and incoming versions, compares the full vault and separate app-data path/type/byte trees, activates the explicit Close inspection control, confirms the inspection state clears, and compares both trees again.

The first exact-SHA attempt on `d043d6205d1f0b730fc43985018d838e10bca202` passed the conflict-content and preservation assertions but failed the close-state assertion on Ubuntu, macOS and Windows; the other five required workflows passed. The next SHA `041c1912f173742ca8a086c775b263cad72287f1` passed all six workflows and checked preservation after app teardown. The final SHA `e9a0afe7a66b93857f4c0bae8493a8a8e22510af` fits the preview to the headless viewport and exercises the close control directly.

All six required workflows passed on the final exact SHA: Rust CI [37847216053](https://github.com/ashutoshpw/open-obsidian/actions/runs/37847216053), inventory [37847216058](https://github.com/ashutoshpw/open-obsidian/actions/runs/37847216058), quality [37847216043](https://github.com/ashutoshpw/open-obsidian/actions/runs/37847216043), desktop build [37847216224](https://github.com/ashutoshpw/open-obsidian/actions/runs/37847216224), plugin renderer [37847216046](https://github.com/ashutoshpw/open-obsidian/actions/runs/37847216046), and loaded-plugin workflows [37847216069](https://github.com/ashutoshpw/open-obsidian/actions/runs/37847216069). The named UI test passed on Ubuntu, macOS and Windows. The Rust parallel group passed on all three platforms. Job IDs and artifact SHA-256 digests are in [`evidence/r2.6.43-existing-vault-conflict-inspection-e9a0afe.json`](evidence/r2.6.43-existing-vault-conflict-inspection-e9a0afe.json). No local executable validation was run.

C01.1 remains passing for the tested arbitrary-content preservation corpus. Parent C01 and C01.2 remain open for broader read-only product coverage and reference-application round trips. Next: cover the next uncovered C01 read-only flow and define the C01.2 round-trip matrix through GitHub Actions only.

## R2.6.44 accepted bounded existing-note source preview — source SHA `37a1f7c`

Added a vault-level source-prefix read bounded to 16 KiB and a collapsed-by-default native note source preview with an explicit close control. The read keeps raw source bytes authoritative, reports total size and truncation, and fails closed when file metadata changes during the read. The UI handles the read in a background worker and reports invalid UTF-8 without rewriting source bytes. The focused test checks the fixture's BOM/CRLF bytes and compares complete vault and separate app-data path/type/byte snapshots after preview and explicit close. A vault test also confirms an oversized source returns only the bounded prefix.

The first exact-SHA attempt `04d85d94a861d0a03931cac1c7ab54f4654358df` passed inventory, quality, desktop build, plugin renderer and loaded-plugin workflows, but Rust CI reported formatting differences and three existing UI interactions failed on Ubuntu, macOS and Windows because the expanded panel displaced controls in the headless viewport. The new preview test passed. Applied Ubuntu's rustfmt output, collapsed the section by default, and made the focused interaction open it explicitly in `37a1f7cd80003be356ed7ed1ad273f6fa97f4f53`.

All six required workflows passed on corrected exact SHA `37a1f7cd80003be356ed7ed1ad273f6fa97f4f53`: Rust CI [37849931563](https://github.com/ashutoshpw/open-obsidian/actions/runs/37849931563), inventory [37849931628](https://github.com/ashutoshpw/open-obsidian/actions/runs/37849931628), quality [37849931595](https://github.com/ashutoshpw/open-obsidian/actions/runs/37849931595), desktop build [37849931601](https://github.com/ashutoshpw/open-obsidian/actions/runs/37849931601), plugin renderer [37849931624](https://github.com/ashutoshpw/open-obsidian/actions/runs/37849931624), and loaded-plugin workflows [37849931598](https://github.com/ashutoshpw/open-obsidian/actions/runs/37849931598). The focused preview interaction passed on Ubuntu, macOS and Windows; workspace test totals were 108, 107 and 106 respectively. The Rust parallel group passed on each OS. Job IDs and artifact SHA-256 digests are in [`evidence/r2.6.44-existing-vault-source-preview-37a1f7c.json`](evidence/r2.6.44-existing-vault-source-preview-37a1f7c.json). No local executable validation was run.

Defined the C01.2 reference-application matrix in [`c01.2-reference-roundtrip-matrix.md`](c01.2-reference-roundtrip-matrix.md). The current evidence uses a synthetic fixture and does not establish Obsidian-authored fixture provenance or an Obsidian desktop reopen round trip. C01.1 remains passing for the tested preservation corpus; parent C01 and C01.2 remain open. Next: continue R2 with the next uncovered C01 read-only product flow, then obtain a privacy-safe Obsidian-authored fixture and run the provenance/reopen cases through GitHub Actions only.

## R2.6.45 accepted existing-vault note-list refresh — source SHA `b6153f9`

Added a compact, asynchronous **Refresh note list** action for an already-open vault. The UI rescans Markdown paths and updates its listing after a note appears externally. The interaction adds an external note before refresh, checks that the new note becomes visible and the count updates, then compares complete vault and separate app-data path/type/byte snapshots after refresh and UI teardown.

The first exact-SHA attempt `b73274736e1774d48ab8c959390f97d3c7a00400` passed the new refresh test but displaced an existing rename-preview button in the headless viewport on all three operating systems; Ubuntu also requested rustfmt changes. Applied the formatting and compacted the control in `ea784a985bd6653b240db54a0e64756465887e21`, but CI showed the same rename interaction failure. Moved the note count into the wrapped header in `1acd6b20c2b8b4836ee95e48823b3512b0b9945b`; workspace tests then passed on all three platforms, while Clippy found an owned `PathBuf` used only for comparison. Replaced it with a borrowed path comparison in the final source SHA.

All six required workflows passed on corrected exact SHA `b6153f9ea900ef64baf66a65054c0835652b6687`: Rust CI [37853242520](https://github.com/ashutoshpw/open-obsidian/actions/runs/37853242520), inventory [37853242599](https://github.com/ashutoshpw/open-obsidian/actions/runs/37853242599), quality [37853242632](https://github.com/ashutoshpw/open-obsidian/actions/runs/37853242632), desktop build [37853242563](https://github.com/ashutoshpw/open-obsidian/actions/runs/37853242563), plugin renderer [37853242643](https://github.com/ashutoshpw/open-obsidian/actions/runs/37853242643), and loaded-plugin workflows [37853242503](https://github.com/ashutoshpw/open-obsidian/actions/runs/37853242503). The focused refresh interaction passed on Ubuntu, macOS and Windows; workspace test totals were 109, 108 and 107 respectively. Ubuntu formatting, the Rust parallel group, Clippy, layering, native preview builds, and unchanged-plugin feasibility probes passed. Job IDs, artifact IDs and SHA-256 digests are in [`evidence/r2.6.45-existing-vault-note-list-refresh-b6153f9.json`](evidence/r2.6.45-existing-vault-note-list-refresh-b6153f9.json). No local executable validation was run.

C01.1 remains passing for the tested synthetic arbitrary-content preservation corpus. Parent C01 and C01.2 remain open for the remaining read-only product flows and the Obsidian-authored fixture/provenance/reopen cases. C01.2-02 now includes the note-list refresh flow but remains synthetic-fixture evidence only. Next: continue R2 with the next uncovered C01 read-only product flow and pursue the privacy-safe reference fixture and GitHub Actions reopen case.

## R2.6.46 accepted Obsidian Linux runner feasibility — source SHA `e02368d`

Pinned the official Obsidian 1.14.4 Linux x86_64 AppImage by SHA-256 and added a manually dispatched GitHub Actions workflow to launch it under Xvfb. The first attempt queried the Chrome DevTools endpoint before it was ready; the follow-up polls with a bounded timeout. The corrected run captured the first-run renderer title, URL, visible text, screenshot and process log.

The corrected feasibility workflow passed on exact source SHA `e02368dac3bd5c0434a1a8929bd3c2377ba7d5b5`: [Obsidian runner feasibility 37856059473](https://github.com/ashutoshpw/open-obsidian/actions/runs/37856059473). All six required project workflows also passed on that SHA: Rust CI [37856056862](https://github.com/ashutoshpw/open-obsidian/actions/runs/37856056862), inventory [37856056817](https://github.com/ashutoshpw/open-obsidian/actions/runs/37856056817), quality [37856056808](https://github.com/ashutoshpw/open-obsidian/actions/runs/37856056808), desktop build [37856056834](https://github.com/ashutoshpw/open-obsidian/actions/runs/37856056834), plugin renderer [37856056842](https://github.com/ashutoshpw/open-obsidian/actions/runs/37856056842), and loaded-plugin workflows [37856056876](https://github.com/ashutoshpw/open-obsidian/actions/runs/37856056876). Artifact and file SHA-256 digests are in [`evidence/r2.6.46-obsidian-runner-feasibility-e02368d.json`](evidence/r2.6.46-obsidian-runner-feasibility-e02368d.json). No local executable validation was run.

This result proves runner feasibility only. It opened Obsidian's first-run screen, not a vault; no Obsidian-authored fixture was created, and OpenObsidian did not open a vault. C01, C01.2-01 and C01.2-03 remain pending. Next: add direct existing-vault startup, then implement the fixture provenance and same-vault reopen checks through GitHub Actions.

## R2.6.47 accepted existing-vault startup path — source SHA `fe1b934`

Added `--open-vault PATH` to the native desktop. The CLI preserves OS-native path values, requires one existing directory, prepares private per-vault data outside the selected vault, opens a `VaultSession`, and passes it into the egui shell before its first frame. The focused CLI argument test and egui initial-session preservation interaction both pass on Ubuntu, macOS, and Windows. The fixture vault and separate app-data tree remain unchanged after the UI interaction and teardown.

The first source SHA `ea834034bbede7a108e33028a2d7e0bc996abbd4` passed workspace tests and five companion workflows, but Ubuntu rustfmt requested import/assertion layout changes and Clippy on macOS/Windows rejected an unnecessary `mut`. Applied the exact CI feedback in `fe1b9343e9b0ae969fc627fb06623f990f225c9d`.

All six required workflows passed on corrected exact SHA `fe1b9343e9b0ae969fc627fb06623f990f225c9d`: Rust CI [37857618635](https://github.com/ashutoshpw/open-obsidian/actions/runs/37857618635), inventory [37857618600](https://github.com/ashutoshpw/open-obsidian/actions/runs/37857618600), quality [37857618603](https://github.com/ashutoshpw/open-obsidian/actions/runs/37857618603), desktop build [37857618593](https://github.com/ashutoshpw/open-obsidian/actions/runs/37857618593), plugin renderer [37857618545](https://github.com/ashutoshpw/open-obsidian/actions/runs/37857618545), and loaded-plugin workflows [37857618832](https://github.com/ashutoshpw/open-obsidian/actions/runs/37857618832). Job IDs and artifact digests are in [`evidence/r2.6.47-existing-vault-launch-fe1b934.json`](evidence/r2.6.47-existing-vault-launch-fe1b934.json). No local executable validation was run.

This slice compiles and covers argument parsing plus initial-session UI behavior, but it does not launch the desktop process with `--open-vault`. No Obsidian-authored fixture was created or reopened. C01 and C01.2 remain open. Next: use the pinned Obsidian runner to author a privacy-safe fixture, run OpenObsidian against that exact vault path, compare vault/app-data snapshots, and reopen the same vault in Obsidian through GitHub Actions.

## R2.6.48 Linux reference-app round-trip runner — exact-SHA CI pending

Added a Linux-only GitHub Actions workflow that creates generated, privacy-safe vault content with BOM/CRLF Markdown, Unicode and space-containing paths, a pinned attachment, opaque binary data, unknown Obsidian settings, and disabled plugin/theme fixtures. Pinned Obsidian 1.14.4 opens the folder and authors a seed note through its editor. The workflow snapshots every path, kind, byte count, SHA-256, and symlink target; launches the native binary with `--open-vault` against the same folder; checks visible vault/name and note count, unchanged vault/app-data snapshots, and reopens the vault in Obsidian. Reopen-time changes are allowed only for the two identified Obsidian workspace-state files and are reported separately.

The workflow and runner are implemented, but exact-SHA GitHub Actions evidence is pending. macOS/Windows, parent C01, broader C01 read-only coverage, and edit/save reopen remain pending. No local application launch, build, test, formatter, or runtime validation was used; only source inspection and `git diff --check` were performed locally.

The first exact-SHA attempt, `e5b6d21fa4fc0c73b3d4ae70513cd364baea6e93`, passed the pinned AppImage checksum and native release build, and all six required project workflows passed. The reference workflow failed before selecting the vault: Obsidian's native folder picker blocks the renderer thread, so awaiting the CDP response to the Open-button click deadlocked until `Runtime.evaluate` timed out. The artifact and exact run/job IDs are recorded in [`evidence/r2.6.48-roundtrip-ci-e5b6d21.json`](evidence/r2.6.48-roundtrip-ci-e5b6d21.json). No note authoring, OpenObsidian launch, or reopen acceptance occurred. The runner now dispatches the click without awaiting it and waits on X11 window focus before resuming DevTools calls; fresh exact-SHA GitHub Actions validation is pending.

The second exact-SHA attempt, `0a0440a0d7bfecf1385db43a7807cba4cc7bc6bf`, passed all six required project workflows, but the round-trip workflow again stopped at the native folder picker. CI confirmed the picker opened as the “Open folder as vault” window and stayed active after the location path and Return were sent, so fixture authoring, OpenObsidian launch, and reopen checks did not run. The report, artifact digest, and exact workflow/job IDs are recorded in [`evidence/r2.6.48-roundtrip-ci-0a0440a.json`](evidence/r2.6.48-roundtrip-ci-0a0440a.json). Added X11 screenshots of the picker states and an explicit GTK `Alt+O` Open action attempt, retaining bounded window-focus checks. The CI-informed correction is pending a fresh exact-SHA run; no local executable validation was run.

The third exact-SHA attempt, `c027e0ed1b4a2fac179be30c30e84385052f9cbe`, passed all six required project workflows. The macOS quality job first failed because its Electron renderer did not reach the retrieval boundary after indexing, then passed on a failed-job-only rerun at the same SHA. The pinned Obsidian runner still failed to select the vault: after the absolute path was typed, the GTK location-entry overlay showed the folder suggestion list and the bottom-right **Open** button, but Return, `Alt+O`, and a second Return left the picker open. No note was authored and OpenObsidian was not launched. Exact workflow/job IDs, the artifact digest, and screenshot/report hashes are in [`evidence/r2.6.48-roundtrip-ci-c027e0e.json`](evidence/r2.6.48-roundtrip-ci-c027e0e.json). The next runner revision measures the picker window bounds and clicks the visible Open control; no local executable validation was run.

The fourth exact-SHA attempt, `c7267cc2c996e9264c92be6a1564840c92526fd6`, passed all six required project workflows. The geometry-based Open click selected the generated fixture folder; its screenshot shows the vault workspace and first-open trust prompt. The runner then timed out because it incorrectly waited for focus to return to the original first-run window ID, although the picker had closed and Obsidian opened the vault in a new window ID. No note authorship, OpenObsidian launch, or reopen check occurred. Exact workflow/job IDs, artifact digest, and report/screenshot hashes are recorded in [`evidence/r2.6.48-roundtrip-ci-c7267cc.json`](evidence/r2.6.48-roundtrip-ci-c7267cc.json). The next correction detects closure by the picker window ID, reconnects DevTools to the vault renderer, and selects **Browse vault in Restricted Mode** before authoring; no local executable validation was run.

The fifth exact-SHA attempt, `543aa85e8cd81d801127faace10518e62a220c87`, passed all six required project workflows. The runner detected the folder picker closing, attached to the new `app://obsidian.md/index.html` vault renderer, and selected **Browse vault in Restricted Mode**. It then stopped before recording an active editor or authored note; the timeout error itself failed while formatting an undefined last value, which obscured the exact editor state. OpenObsidian and the snapshot/reopen cases did not run. Workflow/job IDs, artifact digest, and file hashes are in [`evidence/r2.6.48-roundtrip-ci-543aa85.json`](evidence/r2.6.48-roundtrip-ci-543aa85.json). The next attempt fixes undefined timeout formatting, captures the restricted-mode screen, clicks the visible **New note** action through DevTools, and records editor state around that action; no local executable validation was run.

The sixth exact-SHA attempt, `da0ab78b12c26c83f6205909811ccb34ac2a91b5`, passed all six required project workflows. Obsidian opened the fixture in Restricted Mode and the visible **New note** action created an Untitled note, confirmed by the screenshot. The runner then failed before editor-state polling because the `waitFor` call passed the DevTools connection as its label argument. No note content was inserted, OpenObsidian was not launched, and snapshots/reopen were not reached. Run/job IDs, artifact digest, and file hashes are in [`evidence/r2.6.48-roundtrip-ci-da0ab78.json`](evidence/r2.6.48-roundtrip-ci-da0ab78.json). The next commit corrects the helper argument order; no local executable validation was run.

The seventh exact-SHA attempt, `0a288760b0c4c3ba3f76cf6c943886ab2292f92a`, passed all six required project workflows. The editor wait found three `contenteditable` elements and one active element, but no Markdown file containing the seed marker was persisted after `Input.insertText`. The pre-insertion screenshot shows the Untitled title selected, consistent with input focus being on Obsidian's inline title instead of the Markdown body. The report, artifact digest, and exact workflow/job IDs are in [`evidence/r2.6.48-roundtrip-ci-0a28876.json`](evidence/r2.6.48-roundtrip-ci-0a28876.json). The next slice records editable-element details, targets `.cm-content[contenteditable=true]`, focuses it at measured coordinates, verifies focus, and captures post-insertion screenshots; no local executable validation was run.

The eighth exact-SHA attempt, `fabcc8a50f897520b8d1cf5d9962ca91cb76a551`, passed all six required project workflows. Obsidian authored `Untitled.md` with the expected marker and attachment link, and the full pre-OpenObsidian vault snapshot was captured. OpenObsidian remained alive, but the Xvfb root screenshot was black and OCR returned no text; its log contained a Mesa DRI3 warning. The report, baseline snapshot, artifact digest, and exact workflow/job IDs are in [`evidence/r2.6.48-roundtrip-ci-fabcc8a.json`](evidence/r2.6.48-roundtrip-ci-fabcc8a.json). The next slice forces Mesa software GL, waits for a visible OpenObsidian X11 window, captures both root and window-specific screenshots, and polls rendered OCR for the selected vault and note count; no local executable validation was run.

The ninth exact-SHA attempt, `74680fbab2db368a5dbcd5accfbd8d3a1d18a1cd`, passed all six required project workflows. The pinned Obsidian authoring step persisted `Untitled.md`; OpenObsidian displayed **Vault: C01.2 Roundtrip Fixture** and **2 Markdown files found**; the complete vault snapshot and managed app-data snapshot were unchanged after startup and close. The final Obsidian reopen stage failed before running its DOM-read callback because both reopen `waitFor` calls passed the DevTools connection in the label position. Evidence and exact workflow/job IDs are in [`evidence/r2.6.48-roundtrip-ci-74680fb.json`](evidence/r2.6.48-roundtrip-ci-74680fb.json). The next slice corrects both call signatures and retries the reopen/content/snapshot assertions; no local executable validation was run.

The tenth exact-SHA attempt, `0d235e860743905004e549264b24ed3f9873f38e`, passed all six required project workflows. Obsidian authored `Untitled.md` with the expected attachment embed, OpenObsidian displayed the selected vault and two-note count, and the vault and managed app-data snapshots were unchanged through OpenObsidian startup and close. Reopen reached the authored note, but the runner falsely required the Markdown embed syntax in the live-preview editor's `innerText`; the CI screenshot shows Obsidian rendering the image. The artifact digest, report/snapshot/screenshot hashes, and exact workflow/job IDs are in [`evidence/r2.6.48-roundtrip-ci-0d235e8.json`](evidence/r2.6.48-roundtrip-ci-0d235e8.json). The runner correction now checks the exact embed in the reopened Markdown source and validates the attachment path through the expanded file tree or rendered editor text. This correction is pending a fresh exact-SHA GitHub Actions run; no local executable validation was run.

R2.6.48 passed on exact source SHA `3b621dfe83ab96313b407651dbe354c29bd06e89`. The pinned Obsidian 1.14.4 UI authored the synthetic `Untitled.md` note and image embed; OpenObsidian opened that same vault and displayed its name and two-note count; Obsidian then reopened the same note and listed the exact attachment path. All 22 vault entries matched before/after OpenObsidian and after Obsidian reopen, the managed app-data directory remained outside the vault and unchanged, and no workspace-state files changed. The reopened screenshot includes Obsidian's first-open trust prompt with the note and rendered image behind it; plugins remained untrusted. The round-trip workflow and all six required project workflows passed on the exact SHA. Run/job IDs and artifact hashes are in [`evidence/r2.6.48-roundtrip-ci-3b621df.json`](evidence/r2.6.48-roundtrip-ci-3b621df.json). This completes the Linux-only R2.6.48 slice; C01/C01.2 stay open for macOS/Windows reference-app execution and remaining read-only product flows, and edit/save remains deferred to C02/C14. No local executable validation was run.

## R2.6.49 cross-platform reference round-trip — runner corrections pending CI

Expanded the Obsidian 1.14.4 fixture authoring, OpenObsidian no-op open, and same-vault reopen workflow to Ubuntu, macOS, and Windows. On exact source SHA `337857560332327cd13b9a797eaab76abf7afcf4`, Linux passed the complete round trip and all six companion project workflows passed, including Rust CI on all three operating systems. macOS authored the fixture; its OpenObsidian screenshot visibly shows the selected vault and two-note count, but OCR over the whole dark desktop returned garbled text, so the automated snapshot/reopen assertions did not run. Windows' temporary Obsidian profile lacked a `Desktop` directory; its native folder picker displayed a blocking missing-location dialog and did not select the generated fixture. It did not author a note or reach OpenObsidian.

The attempt report, job IDs, artifact digests and selected file hashes are recorded in [`evidence/r2.6.49-roundtrip-ci-3378575.json`](evidence/r2.6.49-roundtrip-ci-3378575.json). The first correction captured the macOS OpenObsidian window using its CoreGraphics window ID and ran sparse-text plus block OCR against that window. It also created the temporary Windows profile Desktop before Obsidian starts. The exact-SHA retry and its findings are recorded below; no local executable validation was run. C01 and C01.2 remain pending, and edit/save remains deferred to C02/C14.

On the resulting exact SHA `9de7785555c64fc5e08e15e668ce7dc47755d1ba`, Linux again passed the full round trip. macOS captured the app window and the screenshot shows the selected vault/count, but OCR still failed on the dark low-contrast text before snapshot/reopen. Windows no longer showed the missing-location dialog and navigated to the generated fixture, but its SendKeys sequence did not invoke the native **Select Folder** button; authoring did not start. All six required project workflows passed, with the macOS quality audit passing on a failed-job-only retry at the same SHA. Exact run/job IDs, artifacts and selected hashes are in [`evidence/r2.6.49-roundtrip-ci-9de7785.json`](evidence/r2.6.49-roundtrip-ci-9de7785.json).

The next CI slice contrast-stretches and upscales a separate macOS OCR image while preserving the raw screenshot. On Windows it invokes the picker’s Select Folder button through UI Automation and captures screenshots before and after selection. These corrections need a focused commit and fresh exact-SHA CI; no local executable validation was run. C01/C01.2 remain pending.

On exact source SHA `3635245c4201e8ed613fdd74148da01d1485480e`, Linux and macOS passed the complete Obsidian-authored no-op round trip. macOS authored the note and attachment, OpenObsidian displayed the selected vault and two-note count, Obsidian reopened the same note and attachment path, all 22 vault entries matched before/after snapshots, and app data remained separate and unchanged. Windows reached the native picker but failed inside the UI Automation command before confirming the folder; the runner had discarded PowerShell output, and no vault renderer or note authoring started. All six companion project workflows passed on this SHA. Exact run/job IDs, artifact digests and selected hashes are recorded in [`evidence/r2.6.49-roundtrip-ci-3635245.json`](evidence/r2.6.49-roundtrip-ci-3635245.json).

The current focused Windows correction retains stdout/stderr and accessible window/button diagnostics, invokes the native Select Folder button with a focus-and-Enter fallback, and records the selection result for the CI report. It is pending a fresh exact-SHA GitHub Actions run. C01/C01.2 remain pending; no local executable validation was run.

On exact source SHA `eea967957281c34471ca9fcf985e2463e4757c48`, Linux and macOS passed the full Obsidian-authored round trip again. Both runs recorded the same note hash, reopened the exact attachment, preserved the vault snapshots, and kept app data separate and unchanged. Windows reached the native folder picker with the fixture loaded; its screenshot showed Select Folder, but the button was absent from both the picker and desktop UIA searches. The command retained this output, but no vault renderer appeared and fixture authoring did not start. Run/job IDs, artifacts, report hashes and screenshots are in [`evidence/r2.6.49-roundtrip-ci-eea9679.json`](evidence/r2.6.49-roundtrip-ci-eea9679.json).

Rust CI, desktop build, plugin renderer and loaded-plugin workflows passed on the same SHA. The quality workflow's macOS Electron retrieval audit failed once after indexing, then passed on a same-SHA failed-job retry. Inventory exposed the extra trailing comma in the newly appended state entry at line 197; the comma is removed in the pending correction. The next Windows slice searches the desktop-wide UIA tree and presses Enter with the picker focused if the Select Folder control remains unavailable. This update and runner correction are pending fresh exact-SHA CI; C01/C01.2 remain pending, and no local executable validation was run.

## R2.6.49 cross-platform round-trip accepted — source SHA f396927

The Windows picker and OCR corrections passed with the full round-trip matrix on exact source SHA `f396927a7e15e9fa8631bb3b4d78e90198c5fbd0`. The matrix passed on Ubuntu, macOS and Windows, as did Rust CI, inventory, quality, desktop build, plugin renderer and loaded-plugin workflows. Pinned Obsidian 1.14.4 authored the fixture note and attachment link on each OS; OpenObsidian opened the same vault and showed its name/count; Obsidian reopened the note and exact attachment path. The 22-entry vault remained byte-identical, app data remained outside the vault and unchanged, and no workspace-state changes were recorded. Exact run/job IDs, runner images, reference asset hashes, artifacts and report hashes are in [`evidence/r2.6.49-roundtrip-ci-f396927.json`](evidence/r2.6.49-roundtrip-ci-f396927.json). Intermediate failures remain documented in [`evidence/r2.6.49-roundtrip-ci-followups.json`](evidence/r2.6.49-roundtrip-ci-followups.json).

The readiness fix factors the Obsidian renderer snapshot into one reader and waits up to 20 seconds for the exact authored path to appear after note content is visible; the path assertion remains required. No local tests, builds, or application launches were used. C01/C01.2 remain pending for the remaining read-only flows; edit/save remains deferred to C02/C14.

## R2.6.50 — cross-platform existing-vault refresh and preview

Added one integrated native UI case that opens the existing-vault fixture, adds `Notes/External.md` after the session opens, refreshes the production note listing from two to three Markdown files, previews the exact BOM/CRLF bytes, closes the preview, and verifies full vault and separate app-data snapshots remain unchanged. The existing vault unit test `note_source_preview_is_bounded_and_preserves_the_original_prefix` also verifies the 16 KiB preview limit in the same three-OS Rust workspace matrix.

Three exact-SHA iterations captured CI feedback: `b66cb662784f265581695498527e56ddd421a825` exposed an oversized text-area close failure and missing Windows popup option; `fb9565373a7a080c5a6e833ef61762948cbddb74` exposed a rustfmt mismatch and unstable picker query; `a4382a671a9adb9b667233ac52660819a2b4b0f2` showed the Windows AccessKit tree still omitted the refreshed ComboBox option. Their CI failures and corrections are retained in [`evidence/r2.6.50-external-note-refresh-preview-a54e312.json`](evidence/r2.6.50-external-note-refresh-preview-a54e312.json). The final harness selects the path through test state after the real refresh, so this acceptance does not establish ComboBox popup accessibility on Windows.

On exact implementation SHA `a54e3126aa9ed3f0479ad615cb296ffa09cbaf7b`, all seven GitHub Actions workflows passed: Rust CI, migration inventory, quality, desktop build, plugin renderer, loaded-plugin workflows, and the Obsidian 1.14.4 reference round trip. The Rust, quality, desktop, plugin, loaded-plugin and reference matrices passed on Linux, macOS and Windows; the inventory job passed. Job IDs and artifact SHA-256 digests are in the evidence file. C01/C01.2 remain pending for broader read-only product coverage; edit/save remains deferred to C02/C14. No local tests, builds, application launches, formatting or validation commands were used.

Next: inspect remaining C01/C01.2 read-only flows and select the smallest cross-platform slice for R2.6.51.

## R2.6.51 — accessible existing-vault note navigation

Added compact Previous note/Next note controls beside the existing note picker. The integrated existing-vault UI test now selects the externally added `Notes/External.md` through the rendered Previous note control after refresh, previews its exact UTF-8 BOM/CRLF bytes, closes the preview, and checks complete vault and separate app-data snapshots remain unchanged. This also retains the existing link/rename preview interaction in the same compact layout.

The first exact-SHA attempt, `08fc27b64c0aac882215e9ce0e51d2425a6cf6a9`, passed six companion workflows and the Obsidian reference round trip but failed Rust workspace tests on all three OSes: the expanded list displaced a rename control, selection did not update reliably, and Windows did not expose the list item to the UI harness. Those failures are preserved in [`evidence/r2.6.51-accessible-note-navigation-d6b8b19.json`](evidence/r2.6.51-accessible-note-navigation-d6b8b19.json). The corrective attempt kept the existing picker and added same-row navigation buttons.

On corrected exact source SHA `d6b8b19691031d544cea34226244ab43d2e687a6`, all seven required GitHub Actions workflows passed: Rust CI, migration inventory, quality, desktop build, plugin renderer, loaded-plugin workflows, and the pinned Obsidian 1.14.4 round trip. The focused refresh/selection/preview test passed on Ubuntu, macOS and Windows. The three-OS round trip passed; Rust CI passed formatting, workspace tests, Clippy, dependency layering, native preview builds and unchanged-plugin feasibility probes. Job IDs and artifact SHA-256 digests are recorded in the evidence file. C01/C01.2 remain pending for broader read-only product coverage; edit/save remains deferred to C02/C14. No local tests, builds, formatters, linters or application launches were run.

Next: continue R2 with the next uncovered C01/C01.2 read-only product flow and keep both parent requirements pending until their full coverage is accepted.

## R2.6.52 — external note removal and stale-preview invalidation

Added a cross-platform native UI test that opens a source preview for `Notes/Welcome.md`, simulates an external writer removing that note, then refreshes the open vault. The refreshed listing selects the remaining `README.md`, clears the stale preview, and displays the fallback source. The fixture snapshot is compared with the expected tree after the intentional external removal; refresh, preview, close and UI teardown make no further vault or app-data changes.

The first exact-SHA attempt, `7a9ab971d1e7577b925ce4678eb501e8af484416`, passed workspace tests on Ubuntu, macOS and Windows and passed six companion workflows including the Obsidian round trip. Ubuntu formatting failed with assertion-wrap differences. The exact formatter output was applied in `bf5bc3349a73753d0ee236e2656a0c59de6f24be`.

On corrected exact source SHA `bf5bc3349a73753d0ee236e2656a0c59de6f24be`, the focused removal/refresh test passed on all three OSes and all seven required workflows passed: Rust CI, inventory, quality, desktop build, plugin renderer, loaded-plugin workflows, and the pinned Obsidian 1.14.4 round trip. Exact job IDs and artifact SHA-256 digests are in [`evidence/r2.6.52-external-deletion-refresh-bf5bc33.json`](evidence/r2.6.52-external-deletion-refresh-bf5bc33.json). C01/C01.2 remain pending for broader read-only product coverage; edit/save remains deferred to C02/C14. No local executable validation was run.

Next: continue R2 by selecting another uncovered C01/C01.2 read-only product flow; do not close either requirement until the full acceptance coverage passes.

## R2.6.53 — bounded oversized note preview

Added a cross-platform UI test for an existing note larger than the 16 KiB source-preview bound. The preview limit splits an emoji's UTF-8 encoding; the UI keeps only the valid source prefix, reports the full original byte count and marks it truncated. Vault and separate app-data snapshots stay unchanged through preview, closing the preview, and app teardown. Moved the Close source preview control above the source field so the action remains reachable with large content.

The first exact-SHA attempt, `eb700dfe408d15c04846a094fed3be956e8b2a51`, failed the new close assertion in Rust CI on Ubuntu, macOS, and Windows. The preview size, truncation, UTF-8 boundary and status assertions passed; the control below the large field was not activated. Inventory, quality, desktop build, plugin renderer, loaded-plugin workflows and the Obsidian round trip passed. Run/job IDs and the failure are recorded in [`evidence/r2.6.53-bounded-note-preview-7f77ad0.json`](evidence/r2.6.53-bounded-note-preview-7f77ad0.json).

On corrected exact source SHA `7f77ad0f69d315db6514b04435c2fe9a0c8def6b`, all seven GitHub Actions workflows passed. The focused test passed on Linux, macOS and Windows, and the pinned Obsidian 1.14.4 round trip passed on all three platforms. Run/job IDs and artifact SHA-256 digests are in the evidence file. C01/C01.2 remain pending for broader read-only coverage; edit/save remains deferred to C02/C14. No local executable validation was run.

Next: continue R2 with another uncovered C01/C01.2 read-only product flow; keep both parents pending until their full acceptance coverage passes.

## R2.6.54 — refresh after an external in-place note edit

Added a cross-platform native UI test for an in-place external edit to the
currently previewed `Notes/Welcome.md`. The test simulates replacing the same
path with a longer UTF-8 BOM/CRLF source, refreshes the open vault, verifies
the selected path and note count remain stable while stale preview state clears,
then previews the exact updated bytes and full size. The vault remains equal to
the expected post-edit snapshot and separate app data remains unchanged through
refresh, preview, close, and teardown.

The first source SHA, `9c20b3388e8e88a24585d377eb313c46b2b55486`, passed the
focused test and all other workspace tests on Ubuntu, macOS and Windows; all six
companion workflows passed. Ubuntu rustfmt identified two assertion-wrap
changes. Commit `882592960fe1c9e3ac54564276086fed753a6c3e` applies the exact CI
layout. Its first Rust CI attempt had one Windows PC05 WebView timeout after the
Windows workspace tests, Clippy, layering check, and native build passed. A
same-SHA retry passed both PC05 and PC08 probes; it needed no source change.

On exact source SHA `882592960fe1c9e3ac54564276086fed753a6c3e`, all seven
required workflows passed and the focused UI test passed on Ubuntu, macOS and
Windows. The Obsidian 1.14.4 reference round trip also passed on all three
platforms. Exact jobs and artifact digests are in
[`evidence/r2.6.54-external-note-edit-refresh-8825929.json`](evidence/r2.6.54-external-note-edit-refresh-8825929.json).
C01/C01.2 remain pending for broader read-only product coverage; edit/save
remains deferred to C02/C14. No local tests, builds, formatters, linters or
application launches were run.

Next: continue R2 with another uncovered C01/C01.2 read-only product flow; keep
both parent requirements pending until their full acceptance coverage passes.

## R2.6.56 — empty existing-vault open and refresh

Added an egui test for opening an existing vault with zero Markdown notes but
with an unrecognized Obsidian setting, opaque binary asset, and non-Markdown
README. The test checks the canonical open path, zero-note count, empty inspect
and rename states, and refresh. Complete vault and separate app-data
path/kind/byte snapshots remain unchanged after open, refresh, and UI teardown.

The first source SHA `d92ec40162590159fb4981c0e10300360dfb7d2b` passed the
focused test and workspace tests; Ubuntu rustfmt requested exact layout changes.
The six companion workflows passed. Applied the GitHub rustfmt output in
`c339a19b4d64ba9abea25794d7eae895acc91bfa`.

On exact source SHA `c339a19b4d64ba9abea25794d7eae895acc91bfa`, the focused test
passed on Ubuntu, macOS and Windows, and all seven required workflows passed.
Rust CI covered formatting, workspace tests, Clippy, layering, native preview
builds, and feasibility-only PC05/PC08 probes. The independent Obsidian 1.14.4
round-trip workflow also passed on all three OSes; it is regression evidence,
not empty-vault reference-app evidence. Run/job IDs, toolchain, artifact hashes
and limitations are recorded in
[`evidence/r2.6.56-existing-empty-vault-ui-c339a19.json`](evidence/r2.6.56-existing-empty-vault-ui-c339a19.json).
C01.1 remains passing with this additional arbitrary-content preservation
coverage. C01 and C01.2 remain pending for broader read-only coverage. Edit/save
remains deferred to C02/C14. No local tests, builds, formatters, linters or
application launches were run.

## CI preparation — parallel quality state preflight

Moved the read-only progress-state validation into the existing native
`parallel:` group in `.github/workflows/quality.yml`, alongside independent
source and contract checks. Runtime tests remain after the group barrier. The
first push, `d59a43a2706156b0f5659a0584fa839573c9d244`, passed quality on all
three OSes but inventory flagged the changed workflow's stale recorded hash.
Reconciled `inventory.json` and pushed `01fdec963c5abb6d4eb97e9adb1ef5e431e7f2e9`;
all six workflows triggered on that SHA passed. The new grouped check and both
parallel barriers passed on Ubuntu, macOS and Windows. Evidence:
[`evidence/parallel-ci-quality-state-preflight-01fdec9.json`](evidence/parallel-ci-quality-state-preflight-01fdec9.json).
No local executable validation was run. This preparation does not close any
product requirement or change the R2 scope.

Next: continue R2 with another uncovered C01/C01.2 read-only product flow; keep
both parent requirements pending until their full cross-platform read-only coverage passes.

## CI preparation — parallel quality source audits

Extended `.github/workflows/quality.yml` with a native GitHub Actions `parallel`
group for the independent Knip and report-only Fallow health audits. The
following pull-request-only Fallow review remains behind the group barrier. The
first push's inventory check found a stale workflow hash; `inventory.json` was
reconciled without changing its original baseline hash. On exact SHA
`f9d66e6f45e09fe108347db543a7d325b70d48c2`, inventory, Rust CI, quality, desktop
build, plugin renderer and loaded-plugin workflows passed. Both grouped audits
passed on Ubuntu, Windows and macOS. Run/job IDs are recorded in
[`evidence/parallel-ci-quality-audits-f9d66e6.json`](evidence/parallel-ci-quality-audits-f9d66e6.json).
No local checks were run. This CI preparation does not change the active Rust
milestone or close any product requirement.

## R2.6.55 — existing-vault attachment preview and full-tree no-op check

Expanded the image-preview UI case to materialize the existing-vault fixture,
seed an embedded-image note and repository image before taking the baseline,
then open the vault and resolve/render the image through the egui action. The
test compares the complete vault path/byte snapshot and separate app-data tree
after open, preview, and UI teardown; it verifies decoded pixels and accessible
alt text. The seeded setup writes are included in the initial snapshot.

On exact source SHA `a3fbc6a5522ddc422f4d1f74d53c4199ff50ef4e`, the focused test
passed on Ubuntu, macOS and Windows. Rust formatting, workspace tests, Clippy,
layering, native preview builds, unchanged-plugin feasibility probes, inventory,
quality, desktop build, plugin renderer, loaded-plugin workflows and the pinned
Obsidian 1.14.4 round trip passed in all seven required GitHub Actions
workflows. Exact run/job IDs and artifact digests are in
[`evidence/r2.6.55-existing-vault-attachment-preview-a3fbc6a.json`](evidence/r2.6.55-existing-vault-attachment-preview-a3fbc6a.json).
The PC05/PC08 reports remain feasibility-only and do not certify isolation.
C01/C01.2 remain pending for broader read-only product coverage; edit/save is
deferred to C02/C14. No local tests, builds, formatters, linters or application
launches were run.

Next: continue R2 with another uncovered C01/C01.2 read-only product flow; keep
both parent requirements pending until their full acceptance coverage passes.

## R2.6.57 — preserve active vault after another open fails

Added an egui UI case that leaves a two-note existing vault active while a
second selected path points to a regular file. The production
VaultSession::open call rejects that path; the UI clears its opening state,
shows the safe error, and retains the canonical root, both notes and the
existing-vault labels. Full path/kind/byte snapshots of the active vault and
separate app-data tree, plus the selected file bytes, remain unchanged through
the failure and UI teardown.

The first source push, d2034768d3b6e00c6e9922d6944bac69ce28f6db, passed the
focused/workspace tests and six companion workflows; Ubuntu rustfmt reported
two layout changes. The exact CI layout was applied in
e803f6c0f2f620c171b63d2ba01b22b837214371. On that exact source SHA, the focused
test passed on Linux, macOS and Windows and all seven required GitHub Actions
workflows passed. Run/job IDs, toolchain, artifacts and limitations are in
[evidence/r2.6.57-failed-vault-open-preservation-e803f6c.json](evidence/r2.6.57-failed-vault-open-preservation-e803f6c.json).
C01/C01.2 remain pending for broader read-only coverage; C01.1 remains passing.
Edit/save remains deferred to C02/C14. No local tests, builds, formatters,
linters or application launches were run.

Next: continue R2 with another uncovered C01/C01.2 read-only product flow; keep
both parent requirements pending until their full cross-platform coverage passes.

## R2.6.58 — switch between existing vaults

Added an egui UI case that begins with the existing-vault fixture open and its
note source preview visible, then opens a second valid vault containing a
different note, an unrecognized Obsidian option and an opaque binary asset.
The second vault becomes the canonical active session; the note list and link
and rename source paths point to its sole note, and the first vault's preview
state is cleared. Full path/kind/byte snapshots of both vaults and a separate
app-data sentinel remain unchanged after the switch and UI teardown.

The first source push, 3e4a4c10d25b3ea6b934d4dfbf1d21319e64fb5d, exposed a
missing harness frame advance before querying the expanded preview button and
three rustfmt layout differences. The focused test and all seven workflows
passed on the corrected exact source SHA
b221d72eff3bcfbd1656212915c1acb4fe8b2134. The test passed on Linux, macOS and
Windows. Exact run/job IDs, artifacts, toolchain and limitations are recorded
in [evidence/r2.6.58-existing-vault-switch-b221d72.json](evidence/r2.6.58-existing-vault-switch-b221d72.json).
C01/C01.2 remain pending for broader read-only coverage; C01.1 remains passing.
Edit/save remains deferred to C02/C14. No local tests, builds, formatters,
linters or application launches were run.

Next: continue R2 with another uncovered C01/C01.2 read-only product flow; keep
both parent requirements pending until their full cross-platform coverage passes.

## R2.6.59 — note navigation wraps and clears stale previews

Added a synthetic egui case starting at the final sorted note, README.md, with
link/embed results and its exact source preview open. Next note wraps to
Notes/Welcome.md; Previous note wraps back to README.md. Both selection changes
clear the old link status/resolutions, embed report and source preview state.
The README can then be previewed byte-for-byte again, while complete vault and
separate app-data snapshots remain unchanged after navigation and UI teardown.

The first source SHA, 1624da996b79ea46a2c152a2af8f19c5f36fa464, passed the
focused test on all three OSes and all six companion workflows, but Ubuntu
rustfmt requested two assert_eq! wraps. Those exact layouts were applied in
1d15ea0a0f49b5b8f31c1e8603868ef5b9968cc7. The focused test and all seven
required workflows passed on the corrected SHA across Linux, macOS and
Windows. Run/job IDs, artifacts, toolchain and limits are recorded in
[evidence/r2.6.59-note-navigation-wrap-1d15ea0.json](evidence/r2.6.59-note-navigation-wrap-1d15ea0.json).
C01/C01.2 remain pending for broader read-only coverage; the test does not
certify the Note to inspect ComboBox popup or native picker accessibility.
C01.1 remains passing; edit/save remains deferred to C02/C14. No local tests,
builds, formatters, linters or application launches were run.

Next: continue R2 with another uncovered C01/C01.2 read-only product flow; keep
both parent requirements pending until their full cross-platform coverage passes.

## R2.6.60 — select a note through the inspect ComboBox

Added a synthetic egui UI case that starts with README.md selected, its links
and embeds resolved, and its exact source preview visible. The test activates
the `Note to inspect` ComboBox through an AccessKit click action, selects
Notes/Welcome.md, confirms that stale link/embed/preview/error/texture state is
cleared, and previews the selected note byte-for-byte. Full vault and separate
app-data snapshots remain unchanged through selection, preview, and UI teardown.

The first source attempt, `fe96e16ba4e06dfc1febe5a5a63d787c9eb744de`, passed
the focused test on Ubuntu and macOS but failed Windows because its AccessKit
option label used native backslashes. The `5fa9f888244ab233965f8a789faa1f73f20d288f`
attempt still failed Windows: the ComboBox stayed closed after a pointer click
and the fixture path retained slash separators. The `7e85a9e20088d39b6305ce13579020d2f6171e2d`
attempt passed the focused test on all three OSes but Ubuntu rustfmt required
one exact layout adjustment. On corrected source SHA
`f1d759ef94c92fa7d1af945b0697e36eb76c974f`, all seven workflows and every job
passed; the focused test passed on Ubuntu, macOS, and Windows. Details and
artifact digests are in
[`evidence/r2.6.60-note-inspector-combobox-f1d759e.json`](evidence/r2.6.60-note-inspector-combobox-f1d759e.json).

The AccessKit action verifies semantic activation in the synthetic egui test
harness. It does not certify OS screen-reader behavior, the native folder
picker, or an Obsidian reference-app round trip. C01/C01.2 remain pending for
broader read-only coverage; C01.1 remains passing. Edit/save is deferred to
C02/C14. No local tests, builds, formatters, linters, or application launches
were run.

## CI preparation — parallel runner setup

Grouped independent setup work with GitHub Actions `parallel` in Rust CI, the
cross-platform Obsidian vault round-trip, and its manually dispatched reference
runner. On exact workflow commit `c479996995d6774d8ab776f1f61b6d2261592b36`,
all seven push workflows and the manual reference-runner workflow passed.
A later Windows Rust run on `17cc77f` exposed a shared `event.json` collision
when `setup-bun` ran concurrently with Rust setup. The correction moves Bun
setup after the parallel group in Rust CI and the vault round-trip workflow;
Rust toolchain setup remains parallel with platform dependency installation.
On corrected source SHA `646c3298e0f3146bc568f66997eed375fa2017d7`, all seven
workflows passed, including the adjusted setup sequence on Windows. The manual
Linux reference-runner workflow retains its Bun/dependency parallel group. Run
and job IDs are recorded in
[`evidence/parallel-ci-runner-setup-c479996.json`](evidence/parallel-ci-runner-setup-c479996.json)
and [`evidence/r2.6.61-duplicate-note-basename-646c329.json`](evidence/r2.6.61-duplicate-note-basename-646c329.json).
No local workflow validation or executable testing was run; CI results do not
quantify a time reduction. This preparation does not close a product
requirement or change the active R2 scope.

Next: continue R2 with another uncovered C01/C01.2 read-only product flow; keep
both parent requirements pending until their full cross-platform coverage passes.

## R2.6.61 — disambiguate duplicate note basenames

Added an existing-vault UI case with both `Notes/Welcome.md` and
`Archive/Welcome.md`. Starting from README.md with link/embed results and its
source preview visible, the test opens `Note to inspect` using an AccessKit
click, confirms both choices have distinct relative-path labels, and selects
the archived note. It verifies the selected path, stale result/preview state
clearing, and byte-exact BOM/CRLF preview. Full vault and separate app-data
snapshots remain unchanged through selection, preview and UI teardown.

The first source attempt, `17cc77f5377db37e20c8fe9e17cbe040dddab521`, failed
to compile on macOS and Ubuntu because the path lookup closure returned unit;
Ubuntu rustfmt also requested exact layout changes. Windows Rust CI failed
before tests because concurrent Bun setup hit a shared `event.json` file. All
six companion workflows passed, including the three-platform Obsidian
round-trip. On corrected source SHA
`646c3298e0f3146bc568f66997eed375fa2017d7`, the focused test passed on Ubuntu,
macOS and Windows and all seven workflows passed. The Bun setup ordering fix
was included in that same corrected revision. Run/job IDs, artifact digests,
and the failure/correction trail are recorded in
[`evidence/r2.6.61-duplicate-note-basename-646c329.json`](evidence/r2.6.61-duplicate-note-basename-646c329.json).

This synthetic AccessKit interaction does not certify native OS screen-reader
behavior, native folder-picker accessibility, or an Obsidian reference-app
round trip. C01/C01.2 remain pending for broader read-only coverage; C01.1
remains passing. Edit/save remains deferred to C02/C14. No local tests, builds,
formatters, linters, or application launches were run.

Next: continue R2 with another uncovered C01/C01.2 read-only product flow; keep
both parent requirements pending until their full cross-platform coverage passes.

## R2.6.62 — preserve Unicode and spaced note paths

Added an existing-vault UI case for `Guides/日本語 intro.md`. The test starts
with README.md selected, link/embed results resolved and its exact source
preview open, then selects the Unicode and space-containing note path through
the Note to inspect ComboBox. It verifies stale state clears, previews the
selected BOM/CRLF source byte-for-byte, and compares full vault and separate
app-data snapshots through UI teardown.

On exact source SHA `d77e8cb5720eaac92c835a25a962f986d965962b`, the focused test
passed on Ubuntu, macOS and Windows. All seven GitHub Actions workflows and
every job passed on that SHA, including the Obsidian 1.14.4 round trip on all
three operating systems. Run/job IDs, artifact digests and the test boundary
are recorded in
[`evidence/r2.6.62-unicode-spaced-note-path-d77e8cb.json`](evidence/r2.6.62-unicode-spaced-note-path-d77e8cb.json).

This synthetic AccessKit interaction does not certify native screen-reader or
folder-picker behavior, or a reference-app round trip for this specific
selection. C01 and C01.2 remain pending for broader read-only coverage; C01.1
remains passing. Edit/save remains deferred to C02/C14. No local tests, builds,
formatters, linters or application launches were run.

Next: continue R2 with another uncovered C01/C01.2 read-only product flow; keep
both parent requirements pending until their full cross-platform coverage passes.

## CI readiness — GitHub Actions parallel steps

Reviewed GitHub's [parallel steps announcement](https://github.blog/changelog/2026-06-25-actions-steps-can-now-be-run-in-parallel/) and [workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax). The repository already uses native `parallel:` groups for independent setup and checks in Rust CI, quality, desktop builds, the Obsidian round-trip, compatibility pins, and the reference-runner workflow. The migration goal already requires using these groups when checks do not share mutable outputs. The existing setup and audit changes are documented in `evidence/parallel-ci-runner-setup-c479996.json` and `evidence/parallel-ci-quality-audits-f9d66e6.json`; the exact-SHA `f1f49c4` runs also executed the Rust and quality parallel groups successfully. No extra workflow change was needed. No local workflow validation or executable tests were run.

## R2.6.63 — native folder picker and reference-app reopen

Extended the Obsidian round-trip workflow to start OpenObsidian normally and use its native `rfd::FileDialog::pick_folder` flow for the synthetic space-containing fixture. Created the missing Windows Desktop directory, added `zenity` for Linux's rfd XDG portal fallback, and automated the visible native picker controls on Linux and Windows. macOS uses its native Open panel. The earlier CI attempts and their fixes are captured in the milestone evidence.

On exact source SHA `f1f49c4289984ef6d26437894fcca0cc53627576`, OpenObsidian opened the selected fixture and Obsidian Desktop 1.14.4 reopened the same vault on Ubuntu, macOS, and Windows. Each report records 22 matching vault entries before/open/reopen, unchanged non-workspace paths, no workspace-state changes, and separate app data outside the vault and unchanged. All seven required workflows passed; the first quality attempt failed on Ubuntu's Electron retrieval audit, then all three quality jobs passed on a same-SHA rerun. Exact run/job IDs, runner images, report summaries, artifacts and digests are in [`evidence/r2.6.63-native-folder-picker-f1f49c4.json`](evidence/r2.6.63-native-folder-picker-f1f49c4.json).

This proves the tested native-picker/open/reopen flow for the recorded CI images and synthetic fixture. Linux exercised the zenity fallback, not an installed XDG portal frontend. Broader C01/C01.2 read-only coverage remains pending; C01.1 remains passing, and edit/save is deferred to C02/C14. No local tests, builds, formatters, linters, or application launches were run.

Next: continue R2 with another uncovered C01/C01.2 read-only product flow; keep both parent requirements pending until their full cross-platform coverage passes.

## R2.6.64 — fail closed on invalid UTF-8 note preview

Added a cross-platform UI case with a BOM/CRLF Markdown note containing an
invalid UTF-8 byte. The test selects the path through `Note to inspect`, asks
for the source preview, and verifies the explicit invalid-UTF-8 error is shown
without creating a replacement-text preview. Exact file bytes and full vault
and separate app-data snapshots remain unchanged through the error and UI
teardown.

The first implementation SHA `9baa4bdc92ae17b7545c9540f07f92c801fda027`
passed workspace tests on all three OSes but Ubuntu rustfmt requested two
layout changes. After applying GitHub's exact diff, SHA
`533de08f2340f28523e35d3ec1b2eef6d7437612` passed Rust CI and the focused test
on all three OSes; its Windows Obsidian round-trip job exposed a collision
between Rust toolchain setup and the parallel setup group (`event.json` was
already in use). Moved Rust setup before that group. On exact SHA
`4f61672bd1eb09fc8ea912c4a9f07af2f1fa740a`, the focused test passed on Ubuntu,
macOS, and Windows and all seven required workflows passed. Exact run/job IDs,
artifact hashes, failures, and corrections are in
[`evidence/r2.6.64-invalid-utf8-preview-4f61672.json`](evidence/r2.6.64-invalid-utf8-preview-4f61672.json).

The AccessKit egui harness does not certify native OS screen-reader behavior
or Obsidian's handling of invalid-UTF-8 Markdown. C01.1 remains passing; C01 and
C01.2 remain pending for broader read-only coverage; edit/save remains deferred
to C02/C14. No local tests, builds, formatters, linters, or application
launches were run.

## R2.6.65 — cancel the native folder picker with an active vault

Extended the three-platform Obsidian round-trip runner to test cancelling
OpenObsidian's actual native folder picker while a fixture vault is already
active. The first attempt, exact SHA
`14bdd060750bc526e38501ac8e35eeaa6a0d14e7`, passed on macOS: the Open panel
was visible, Escape closed it, and vault/app-data snapshots stayed unchanged.
Linux remained on the OpenObsidian window after the attempted second picker;
Windows UI Automation reported the button disabled after the async open. The
round-trip run therefore failed on Linux and Windows, while the six companion
workflows passed. Run `37911081741` uploaded all three platform reports and
screenshots; artifact IDs, digests and job IDs will be retained in milestone
evidence.

The follow-up keeps the original native folder-selection case, then launches a
separate OpenObsidian process with `--open-vault` so the fixture is active
before the first picker request. It verifies the platform dialog is visible
before sending Escape, confirms the selected vault name and note count return,
and compares complete vault and separate app-data snapshots after
cancellation and teardown. The corrected exact-SHA matrix is pending. No local
tests, builds, formatters, linters, or application launches were run.

Next: the separate-process correction was checked on exact SHA
`9e105b1184e6193a314ea35310d572076b5e4300`; see the attempt-2 result and
same-session correction below.

### R2.6.65 attempt 2 result and same-session correction — SHA `9e105b1`

The second-process approach failed on exact SHA
`9e105b1184e6193a314ea35310d572076b5e4300`. Ubuntu's first native folder
selection reached the app but showed that private per-vault storage could not
be prepared. macOS started the `--open-vault` session and displayed the active
vault, but the attempted click left the native Open panel closed. Windows'
`--open-vault` process exited because private application storage was
unavailable. Round-trip run [37912392662](https://github.com/ashutoshpw/open-obsidian/actions/runs/37912392662)
uploaded the per-platform screenshots and reports; job IDs are 113760392720,
113760392958, and 113760393069 for Ubuntu, macOS, and Windows respectively.
Artifact IDs and digests are recorded in `state.json` pending final evidence.

Rust CI [37912392642](https://github.com/ashutoshpw/open-obsidian/actions/runs/37912392642)
passed on Ubuntu, macOS, and Windows. Quality [37912392614](https://github.com/ashutoshpw/open-obsidian/actions/runs/37912392614),
desktop build [37912392777](https://github.com/ashutoshpw/open-obsidian/actions/runs/37912392777),
plugin renderer [37912392658](https://github.com/ashutoshpw/open-obsidian/actions/runs/37912392658),
loaded-plugin workflows [37912392722](https://github.com/ashutoshpw/open-obsidian/actions/runs/37912392722),
and inventory [37912392828](https://github.com/ashutoshpw/open-obsidian/actions/runs/37912392828)
also passed. GitHub's native parallel groups completed in Rust CI and quality.

The same-session correction, implementation SHA
`e0b9cc9c726f3b73f7dc2f6877da6c4016ab9599`, moved picker cancellation into the
OpenObsidian process after the original folder selection and added safe
private-storage error details to the CI application log. Its exact-SHA attempt
3 result and next correction are recorded below.

### R2.6.65 attempt 3 result and screen-click correction — SHA `ab18bb1`

The third exact-SHA run
[37913554801](https://github.com/ashutoshpw/open-obsidian/actions/runs/37913554801)
opened the generated vault on Ubuntu, macOS, and Windows, then failed to open
the second native picker. Ubuntu's active window stayed on OpenObsidian;
macOS's accessibility tree did not expose the button and Tab/Return did not
open the panel; Windows UI Automation reported `Open vault` disabled after its
ten-second wait. Round-trip jobs were 113764189187, 113764189121, and
113764188684 respectively. Artifact IDs/digests are recorded in `state.json`.

Rust CI [37913554889](https://github.com/ashutoshpw/open-obsidian/actions/runs/37913554889),
quality [37913554842](https://github.com/ashutoshpw/open-obsidian/actions/runs/37913554842),
desktop build [37913554814](https://github.com/ashutoshpw/open-obsidian/actions/runs/37913554814),
plugin renderer [37913554766](https://github.com/ashutoshpw/open-obsidian/actions/runs/37913554766),
loaded-plugin workflows [37913554794](https://github.com/ashutoshpw/open-obsidian/actions/runs/37913554794),
and inventory [37913554824](https://github.com/ashutoshpw/open-obsidian/actions/runs/37913554824)
passed. The Rust CI and quality native parallel groups passed.

The screen-click correction, implementation SHA
`42457db91045fd2cd6fb5481c61a1869a0f404af`, uses a CoreGraphics click on the
visible macOS control, falls back from Windows UI Automation to its button
screen bounds, retains Linux's geometry click, and captures the immediate
post-click screen. Exact-SHA round-trip and companion workflow validation is
pending on `origin/main`. No local tests, builds, formatters, linters, or
application launches were run.

### R2.6.65 attempt 4 result and picker-verification correction — SHA `937d2f2`

The fourth exact-SHA round-trip run
[37914544755](https://github.com/ashutoshpw/open-obsidian/actions/runs/37914544755)
failed before cancellation acceptance on all three platforms. Ubuntu job
113767431837 kept the active OpenObsidian screen after the click and timed out
waiting for a native picker. macOS job 113767431926 stopped before clicking:
AppleScript returned `112, ,, 43`, which the window-position parser rejected.
Windows job 113767431574 opened the native folder dialog; its screenshot shows
the visible picker, but OCR misread its control labels and the title check
rejected it before Escape. Artifact IDs and digests are in `state.json`.

Rust CI [37914544561](https://github.com/ashutoshpw/open-obsidian/actions/runs/37914544561),
quality [37914544565](https://github.com/ashutoshpw/open-obsidian/actions/runs/37914544565),
desktop build [37914544735](https://github.com/ashutoshpw/open-obsidian/actions/runs/37914544735),
plugin renderer [37914544642](https://github.com/ashutoshpw/open-obsidian/actions/runs/37914544642),
loaded-plugin workflows [37914546088](https://github.com/ashutoshpw/open-obsidian/actions/runs/37914546088),
and inventory [37914544653](https://github.com/ashutoshpw/open-obsidian/actions/runs/37914544653)
passed on this SHA. Rust CI and quality native parallel groups passed.

Correction implementation SHA `bdd332ff9870f8c5797184755030c2103cc71f5d`
uses a window-relative Linux pointer move, extracts numeric macOS window
coordinates even when AppleScript adds punctuation, and accepts fuzzy OCR for
the native picker’s Cancel and Open/Select/Choose controls. A CI-only
`OPENOBSIDIAN_CI_DIAGNOSTICS` flag logs state transitions that determine
whether Open vault is enabled. The next exact-SHA Actions validation is pending
on `origin/main`. No local tests, builds, formatters, linters, or application
launches were run.

### R2.6.65 attempt 5 result and X11/accessibility correction — SHA `11ae4c5`

The fifth exact-SHA round-trip run
[37915827809](https://github.com/ashutoshpw/open-obsidian/actions/runs/37915827809)
passed the cancellation and full vault/app-data snapshot checks on Windows.
Job 113771634842 opened the picker, sent Escape, restored the original vault
and two-note count, and reopened the unchanged vault in Obsidian. Ubuntu job
113771634822 timed out on the active screen even though the UI-state log showed
`session=true`, all busy receivers clear, and `open_vault_enabled=true`. macOS
job 113771634392 opened the native panel, visible in the artifact screenshot,
but OCR failed to recognize its controls before Escape. Artifact IDs and digests
are recorded in `state.json`.

Rust CI [37915827731](https://github.com/ashutoshpw/open-obsidian/actions/runs/37915827731),
quality [37915827713](https://github.com/ashutoshpw/open-obsidian/actions/runs/37915827713),
desktop build [37915827688](https://github.com/ashutoshpw/open-obsidian/actions/runs/37915827688),
plugin renderer [37915827589](https://github.com/ashutoshpw/open-obsidian/actions/runs/37915827589),
loaded-plugin workflows [37915827698](https://github.com/ashutoshpw/open-obsidian/actions/runs/37915827698),
and inventory [37915827756](https://github.com/ashutoshpw/open-obsidian/actions/runs/37915827756)
passed on this SHA; the Rust matrix passed on all three operating systems.

Correction implementation SHA `56442b0eda2719c8a565d40dc38e9799cab2e18a`
raises the X11 window before the Linux click and saves its click result to the
failure report. The macOS gate now reads System Events window and sheet names
to verify that the native Open panel is present and closed around Escape, with
screenshot OCR retained as fallback. Exact-SHA CI validation is pending on
`origin/main`. No local tests, builds, formatters, linters, or application
launches were run.

### R2.6.65 attempt 6 result and platform window-detection correction — SHA `35f0c7b`

The sixth exact-SHA round-trip run
[37916648305](https://github.com/ashutoshpw/open-obsidian/actions/runs/37916648305)
did not pass the cancellation gate. Ubuntu stayed on the active vault screen
after the click. Windows reported that UI Automation invoked the enabled Open
vault button, but its screenshot gate did not recognize a native picker.
macOS's screenshot clearly showed the native Open panel, while OCR and the
accessibility title check failed to accept it. Artifact IDs, digests, full
reports and screenshots are retained in `state.json` and the Actions artifacts.

Rust CI [37916648441](https://github.com/ashutoshpw/open-obsidian/actions/runs/37916648441),
quality [37916648314](https://github.com/ashutoshpw/open-obsidian/actions/runs/37916648314),
desktop build [37916648299](https://github.com/ashutoshpw/open-obsidian/actions/runs/37916648299),
plugin renderer [37916648316](https://github.com/ashutoshpw/open-obsidian/actions/runs/37916648316),
loaded-plugin workflows [37916648389](https://github.com/ashutoshpw/open-obsidian/actions/runs/37916648389),
and inventory [37916648326](https://github.com/ashutoshpw/open-obsidian/actions/runs/37916648326)
passed on the same SHA. The native parallel setup groups passed.

The next correction sends the Linux click directly to the intended X11 window,
records window inventories before and after the click, detects and raises a new
Linux picker window, enumerates Windows top-level UI Automation windows and
focuses the newly detected native picker before Escape, and crops/enlarges the
macOS panel for OCR while recording accessibility descriptions in failures.
Exact-SHA validation is pending on `origin/main`. No local tests, builds,
formatters, linters, or application launches were run.

### R2.6.65 attempt 7 result and targeted correction — SHA `e982f11`

The seventh exact-SHA round-trip run
[37918171371](https://github.com/ashutoshpw/open-obsidian/actions/runs/37918171371)
failed the cancellation gate on Ubuntu, macOS, and Windows. Linux remained on
the active vault after the direct X11 click. Windows reported `Open vault` as
disabled and exposed no new top-level picker window, despite the application
log reporting an active session, no busy receivers, and `open_vault_enabled=true`.
macOS displayed the native Open panel and returned to the original vault after
Escape, but cancellation changed app data: `app.ron` appeared, so the snapshot
check failed before the report recorded its contents.

Rust CI [37918171265](https://github.com/ashutoshpw/open-obsidian/actions/runs/37918171265),
desktop build [37918171317](https://github.com/ashutoshpw/open-obsidian/actions/runs/37918171317),
plugin renderer [37918171382](https://github.com/ashutoshpw/open-obsidian/actions/runs/37918171382),
loaded-plugin workflows [37918171230](https://github.com/ashutoshpw/open-obsidian/actions/runs/37918171230),
and inventory [37918171388](https://github.com/ashutoshpw/open-obsidian/actions/runs/37918171388)
passed on this SHA. Quality [37918171223](https://github.com/ashutoshpw/open-obsidian/actions/runs/37918171223)
failed on all three operating systems because Knip reported the duplicated
`tesseract` binary invocation. The native parallel setup groups passed. Reports,
run/job links, artifact IDs, and digests are recorded in
[`evidence/r2.6.65-cancellation-attempt-7-e982f11.json`](evidence/r2.6.65-cancellation-attempt-7-e982f11.json).

The next slice shares the OCR invocation, restores Linux's relative pointer
motion and normal click, polls Windows UI Automation for the Open button and
records its full control inventory if the picker does not appear, and saves
before/after app-data snapshots plus raw `.ron` contents before asserting
unchanged state. Exact-SHA GitHub Actions validation is pending on
`origin/main`. No local tests, builds, formatters, linters, or application
launches were run.

### R2.6.65 attempt 8 result and focused diagnostics — SHA `b1b48b6`

The attempt 8 source commit was pushed to `origin/main`. The first exact-SHA
round-trip run
[37919573887](https://github.com/ashutoshpw/open-obsidian/actions/runs/37919573887)
failed cancellation on all three operating systems. Its Ubuntu job was rerun
alone as run attempt 2; it failed again with the same private app-data
preparation error. The macOS and Windows jobs were not rerun. Ubuntu's report
still lacked the exact filesystem operation that returned `ENOENT`. On
Windows, UI Automation reported `Open vault IsEnabled=false` for the full poll,
and the timeout prevented the new control inventory from being written. On
macOS, Escape returned to the active vault, but `app.ron` appeared in app data
after startup; the report now preserves the raw file contents. Its contents
match eframe's persisted window and UI state, though the timing alone does not
prove that cancellation created it.

Rust CI [37919573793](https://github.com/ashutoshpw/open-obsidian/actions/runs/37919573793),
quality [37919573889](https://github.com/ashutoshpw/open-obsidian/actions/runs/37919573889),
desktop build [37919573816](https://github.com/ashutoshpw/open-obsidian/actions/runs/37919573816),
plugin renderer [37919573831](https://github.com/ashutoshpw/open-obsidian/actions/runs/37919573831),
loaded-plugin workflows [37919573791](https://github.com/ashutoshpw/open-obsidian/actions/runs/37919573791),
and inventory [37919573804](https://github.com/ashutoshpw/open-obsidian/actions/runs/37919573804)
passed on the exact SHA. The parallel setup groups passed. Per-platform job
IDs and artifact digests are recorded in
[`evidence/r2.6.65-cancellation-attempt-8-b1b48b6.json`](evidence/r2.6.65-cancellation-attempt-8-b1b48b6.json).

The next focused correction adds path-free operation-stage context to private
app-data failures, lets a Windows UI Automation timeout flow into the complete
control inventory, and waits for macOS startup persistence before establishing
the cancellation baseline. The post-cancellation snapshot remains strict.
Exact-SHA GitHub Actions validation is pending. No local executable
validation was run.

### R2.6.65 attempt 9 result and picker-selection correction — SHA `7c29a1a`

All seven workflows ran on the exact source SHA. Rust CI, quality, desktop
build, plugin renderer, loaded-plugin workflows, and inventory passed. The
Obsidian round-trip failed on all three operating systems. Linux's new
operation-stage message identified `canonicalize selected vault` as the
failure, with `ENOENT`; the GTK location entry had not produced a path the app
could resolve. On macOS, the native panel reached the fixture folder, but its
Open button remained visible in the final screenshot, so selection had not
completed. Windows opened the fixture, then its cancellation step stopped
because a quoted focus diagnostic broke the PowerShell Escape script.

The next slice presses Return to apply the GTK location entry before clicking
Open, waits for the macOS panel and selects its Open button through
accessibility, and moves the Windows diagnostic outside its PowerShell source
string. Exact-SHA CI and artifact details are in
[`evidence/r2.6.65-cancellation-attempt-9-7c29a1a.json`](evidence/r2.6.65-cancellation-attempt-9-7c29a1a.json).
The required parallel setup groups passed. No local executable validation was
run.

The R2.8.89 documentation-only tracker checkpoint was pushed on exact SHA
`bdfe5c18c44ed25fcfabcad256624f8db51da2c`. Inventory
[38162326307](https://github.com/ashutoshpw/open-obsidian/actions/runs/38162326307),
quality
[38162326292](https://github.com/ashutoshpw/open-obsidian/actions/runs/38162326292),
desktop build
[38162326331](https://github.com/ashutoshpw/open-obsidian/actions/runs/38162326331),
plugin renderer
[38162326343](https://github.com/ashutoshpw/open-obsidian/actions/runs/38162326343),
loaded-plugin workflows
[38162326324](https://github.com/ashutoshpw/open-obsidian/actions/runs/38162326324),
and Rust CI
[38162326313](https://github.com/ashutoshpw/open-obsidian/actions/runs/38162326313)
all passed on attempt 1. Exact job IDs, artifact IDs, links, and SHA-256 digests
are in `evidence/r2.8.89-tracker-checkpoint-bdfe5c1.json`; the path-filtered
Obsidian round-trip remains covered by accepted source SHA
`c74d27860f7c60459373887bf85caec2c3af2182`. This checkpoint reconciliation is
recorded separately from the R2.8.90 source slice.

The follow-up R2.8.89 documentation checkpoint was pushed on exact SHA
`bf03563a1ac2bc7ba24cee88ff0ee1212bbd8618`. Inventory, desktop build, plugin
renderer, loaded-plugin workflows, and Rust CI passed on attempt 1. Quality
attempt 1 failed only the Ubuntu Electron retrieval-boundary check; all three
quality jobs passed on same-SHA attempt 2. Exact run/job IDs, artifacts, links,
and digests are in
[`evidence/r2.8.89-tracker-checkpoint-bf03563.json`](evidence/r2.8.89-tracker-checkpoint-bf03563.json).
The path-filtered Obsidian round-trip remains covered by accepted source SHA
`c74d27860f7c60459373887bf85caec2c3af2182`.

R2.8.90 begins as a narrow persisted text-card edit through `VaultSession`:
check the caller-observed SHA-256, use the document-layer edit, and pass that
same SHA to the journaled write. Session reads normalize portable path
separators to the same form used by journaled writes; a parallel source review
found and prompted a fixture case for the Unix backslash-alias mismatch. Fixture coverage now includes semantic
preservation, untouched note bytes, no note creation, invalid node IDs/types,
stale revisions, malformed JSON, invalid Canvas shape, and the exact `InvalidPath`
error for `..` traversal. Read-only parallel reviews found no obvious API/type
blocker and prompted the invalid-shape and typed traversal assertions. C06/C06.1 remain
pending until native editing and the explicit note-creation action are complete.
The source slice is prepared for its own small commit and push; GitHub Actions
will provide all phase validation.

Process exception: during source review, `git diff --check` was inadvertently
run locally as a whitespace check. No local tests, builds, formatters, Clippy,
application launches, or runtime probes were run. Future executable validation
continues to use GitHub Actions only.

### R2.6.65 attempt 10 result and focused diagnostics — SHA `f32dd3d`

The exact-SHA round-trip run [37921995802](https://github.com/ashutoshpw/open-obsidian/actions/runs/37921995802) did not pass cancellation on all platforms. Windows job `113791877859` passed the complete native picker cancellation flow: the fixture opened, Escape closed the picker, the original two-note vault returned, and vault/app-data snapshots remained unchanged. Ubuntu job `113791878091` failed while canonicalizing the selected vault path (`ENOENT`); its screenshot OCR reported that private per-vault storage could not be prepared. macOS job `113791878385` showed the native panel and navigated to the fixture path, but the AppleScript lookup did not find its Open button.

Rust CI [37921995806](https://github.com/ashutoshpw/open-obsidian/actions/runs/37921995806), quality [37921995793](https://github.com/ashutoshpw/open-obsidian/actions/runs/37921995793), desktop build [37921995780](https://github.com/ashutoshpw/open-obsidian/actions/runs/37921995780), plugin renderer [37921995766](https://github.com/ashutoshpw/open-obsidian/actions/runs/37921995766), loaded-plugin workflows [37921995761](https://github.com/ashutoshpw/open-obsidian/actions/runs/37921995761), and inventory [37921995810](https://github.com/ashutoshpw/open-obsidian/actions/runs/37921995810) passed. Native parallel setup groups passed on applicable runners. Job IDs, artifact IDs and digests are recorded in [`evidence/r2.6.65-cancellation-attempt-10-f32dd3d.json`](evidence/r2.6.65-cancellation-attempt-10-f32dd3d.json).

The attempt 11 correction raises and focuses the Linux Zenity picker before opening its Ctrl+L location entry, then records a screenshot at that state before typing the fixture path. On macOS, it saves native picker accessibility-window descriptions and searches nested accessibility contents for an `AXButton` named `Open`. Windows selection/cancellation code remains unchanged because attempt 10 passed there. Exact-SHA validation is pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.65 attempt 11 result and focused correction — SHA `678c11d`

Rust CI [37923156962](https://github.com/ashutoshpw/open-obsidian/actions/runs/37923156962), quality [37923157087](https://github.com/ashutoshpw/open-obsidian/actions/runs/37923157087), desktop build [37923157016](https://github.com/ashutoshpw/open-obsidian/actions/runs/37923157016), plugin renderer [37923156991](https://github.com/ashutoshpw/open-obsidian/actions/runs/37923156991), loaded-plugin workflows [37923157035](https://github.com/ashutoshpw/open-obsidian/actions/runs/37923157035), and inventory [37923156926](https://github.com/ashutoshpw/open-obsidian/actions/runs/37923156926) passed on all applicable runners. The initial round-trip attempt [37923157021](https://github.com/ashutoshpw/open-obsidian/actions/runs/37923157021) failed on all three platforms. Its same-SHA attempt 2 reran only Windows job `113798185833` and passed the complete native picker cancellation, vault/app-data snapshot, and Obsidian reopen checks. Linux's focused location-entry screenshot shows the full fixture path, but pressing Return closed the picker and OpenObsidian then failed to canonicalize the selected vault (`ENOENT`). macOS exposed accessibility windows named `Open` and `OpenObsidian`, but the nested `AXButton` scan did not find the visible Open control. The first Windows job found the Open vault button disabled and no picker window; the successful same-SHA rerun indicates this failure was intermittent. Run/job IDs and artifact hashes are in [`evidence/r2.6.65-cancellation-attempt-11-678c11d.json`](evidence/r2.6.65-cancellation-attempt-11-678c11d.json).

The attempt 12 runner clicks Linux's visible folder-dialog confirmation after entering the focused absolute path. On macOS, it reads the accessible Open panel bounds, clicks the visible Open control, and captures the panel before and after selection. Windows remains unchanged after its passing same-SHA rerun. Exact-SHA validation is pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.65 attempt 12 result and focused correction — SHA `790f365`

The exact-SHA Obsidian round-trip run [37924569487](https://github.com/ashutoshpw/open-obsidian/actions/runs/37924569487) failed on Linux, macOS, and Windows. Linux's screenshot shows the fixture path in Zenity's focused location entry, but the confirmation click landed below the visible OK button. macOS successfully selected and opened the fixture; the cancellation audit then waited for `app.ron` before opening the second picker. Attempts 7 and 8 show that eframe creates this file after the native picker opens, so the wait was ordered too early. Windows selected the fixture, then UI Automation reported the visible Open vault control disabled for ten seconds and no second picker window appeared; an earlier same-SHA Windows rerun passed, so this remains intermittent.

Rust CI [37924569448](https://github.com/ashutoshpw/open-obsidian/actions/runs/37924569448), quality [37924569593](https://github.com/ashutoshpw/open-obsidian/actions/runs/37924569593), desktop build [37924569462](https://github.com/ashutoshpw/open-obsidian/actions/runs/37924569462), plugin renderer [37924569510](https://github.com/ashutoshpw/open-obsidian/actions/runs/37924569510), loaded-plugin workflows [37924569340](https://github.com/ashutoshpw/open-obsidian/actions/runs/37924569340), and inventory [37924569489](https://github.com/ashutoshpw/open-obsidian/actions/runs/37924569489) passed on the exact SHA. Native parallel groups completed successfully. Run/job IDs and artifact digests are in [`evidence/r2.6.65-cancellation-attempt-12-790f365.json`](evidence/r2.6.65-cancellation-attempt-12-790f365.json).

Attempt 13 moves the macOS app-data baseline to after the cancellation picker is visible and before Escape. The audit still requires exact app-data snapshots across Escape and close; it records only path-free eframe window/UI state written when the picker opens. Linux's confirmation click moves to the visible OK-button center. Windows remains unchanged pending a fresh exact-SHA result. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.65 attempt 13 result and focused correction — SHA `be878dc`

The exact-SHA round-trip run [37926559925](https://github.com/ashutoshpw/open-obsidian/actions/runs/37926559925) passed on macOS and failed on Ubuntu and Windows. macOS passed native selection, cancellation, vault/app-data snapshot comparisons, and Obsidian reopen; its report confirms `app.ron` contains eframe `window` and `egui` state without vault or app-data paths and remains unchanged after the picker opens. Windows' initial job opened the fixture but did not open the cancellation picker while UI Automation reported Open vault disabled. The same-SHA Windows rerun (attempt 2, job `113808783449`) passed cancellation, snapshots, and reopen. Ubuntu entered the fixture path and clicked Zenity's visible OK button, but OpenObsidian reported `canonicalize selected vault: ENOENT` while preparing private per-vault storage.

Rust CI [37926559989](https://github.com/ashutoshpw/open-obsidian/actions/runs/37926559989), quality [37926559894](https://github.com/ashutoshpw/open-obsidian/actions/runs/37926559894), desktop build [37926560016](https://github.com/ashutoshpw/open-obsidian/actions/runs/37926560016), plugin renderer [37926559927](https://github.com/ashutoshpw/open-obsidian/actions/runs/37926559927), loaded-plugin workflows [37926560000](https://github.com/ashutoshpw/open-obsidian/actions/runs/37926560000), and inventory [37926559916](https://github.com/ashutoshpw/open-obsidian/actions/runs/37926559916) passed. Parallel setup groups passed. Run/job IDs and artifact digests are in [`evidence/r2.6.65-cancellation-attempt-13-be878dc.json`](evidence/r2.6.65-cancellation-attempt-13-be878dc.json).

Attempt 14 clears the focused Linux Ctrl+L location entry before typing the fixture path. Windows code remains unchanged after its passing same-SHA rerun. Exact-SHA GitHub Actions validation is pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.65 attempt 14 result and focused correction — SHA `d7a666f`

The exact-SHA round-trip run [37927972374](https://github.com/ashutoshpw/open-obsidian/actions/runs/37927972374) passed on macOS and Windows, but Ubuntu still failed while opening the selected vault. The audit cleared Zenity's focused Ctrl+L location entry, typed the fixture path, and clicked the visible OK button at `(786, 309)`; OpenObsidian again reported `canonicalize selected vault: ENOENT`. The change did not resolve the selected path. Run/job IDs and artifact digests are in [`evidence/r2.6.65-cancellation-attempt-14-d7a666f.json`](evidence/r2.6.65-cancellation-attempt-14-d7a666f.json).

Rust CI [37927972402](https://github.com/ashutoshpw/open-obsidian/actions/runs/37927972402), quality [37927972393](https://github.com/ashutoshpw/open-obsidian/actions/runs/37927972393), desktop build [37927972377](https://github.com/ashutoshpw/open-obsidian/actions/runs/37927972377), plugin renderer [37927972347](https://github.com/ashutoshpw/open-obsidian/actions/runs/37927972347), loaded-plugin workflows [37927972398](https://github.com/ashutoshpw/open-obsidian/actions/runs/37927972398), and inventory [37927972345](https://github.com/ashutoshpw/open-obsidian/actions/runs/37927972345) passed. Parallel setup groups passed.

Attempt 15 explicitly focuses the location field before clearing it, captures the empty and entered states, and saves CI OCR from both screenshots so the next run reveals exactly what Zenity received. Exact-SHA GitHub Actions validation is pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.65 attempt 15 result and Linux path-entry correction — SHA `5a4ae4e`

The initial exact-SHA round-trip run [37928627417](https://github.com/ashutoshpw/open-obsidian/actions/runs/37928627417) failed on all three platforms. Ubuntu cleared the native Zenity Ctrl+L field, but the entered screenshot/OCR showed extra trailing characters after the fixture basename; OpenObsidian then failed selected-vault canonicalization (`ENOENT`). The initial macOS and Windows cancellation jobs also failed to expose a second picker. Same-SHA reruns passed macOS on attempt 2, job `113816075619`, and Windows on attempt 3, job `113817385236`, including picker cancellation, vault/app-data snapshots, and Obsidian reopen. Artifact digests and all platform job IDs are in [`evidence/r2.6.65-cancellation-attempt-15-5a4ae4e.json`](evidence/r2.6.65-cancellation-attempt-15-5a4ae4e.json).

Rust CI [37928627420](https://github.com/ashutoshpw/open-obsidian/actions/runs/37928627420), quality [37928627398](https://github.com/ashutoshpw/open-obsidian/actions/runs/37928627398), desktop build [37928627644](https://github.com/ashutoshpw/open-obsidian/actions/runs/37928627644), plugin renderer [37928627683](https://github.com/ashutoshpw/open-obsidian/actions/runs/37928627683), loaded-plugin workflows [37928627442](https://github.com/ashutoshpw/open-obsidian/actions/runs/37928627442), and inventory [37928627493](https://github.com/ashutoshpw/open-obsidian/actions/runs/37928627493) passed on the same source SHA. Native `parallel:` groups passed in all applicable workflows.

Attempt 16 replaces Linux character-by-character typing with a clipboard paste through xclip and adds xclip to the Linux CI runner dependencies. macOS and Windows picker interactions are unchanged after their same-SHA reruns passed. No local tests, builds, formatters, linters, or application launches were run. Exact-SHA GitHub Actions validation for attempt 16 remains pending.

### R2.6.65 attempt 16 result and Knip correction — SHA `b60c584`

The exact-SHA round-trip run [37930991168](https://github.com/ashutoshpw/open-obsidian/actions/runs/37930991168) initially failed on Ubuntu, macOS, and Windows. The Linux xclip clipboard paste selected the fixture successfully and OpenObsidian displayed the expected two-note vault, but the second in-session Open vault action did not expose a new X11 folder picker. Ubuntu reproduced this on same-SHA attempt 2. The initial macOS failure timed out waiting for `app.ron`; same-SHA attempt 2 passed the full cancellation, snapshot, and Obsidian reopen flow. Windows initially failed and also failed on same-SHA attempt 2, then passed the full flow on same-SHA attempt 3. Artifact IDs and digests are in [`evidence/r2.6.65-cancellation-attempt-16-b60c584.json`](evidence/r2.6.65-cancellation-attempt-16-b60c584.json).

Rust CI [37930991097](https://github.com/ashutoshpw/open-obsidian/actions/runs/37930991097), desktop build [37930991094](https://github.com/ashutoshpw/open-obsidian/actions/runs/37930991094), plugin renderer [37930991195](https://github.com/ashutoshpw/open-obsidian/actions/runs/37930991195), loaded-plugin workflows [37930991139](https://github.com/ashutoshpw/open-obsidian/actions/runs/37930991139), and inventory [37930991143](https://github.com/ashutoshpw/open-obsidian/actions/runs/37930991143) passed. Quality [37930991184](https://github.com/ashutoshpw/open-obsidian/actions/runs/37930991184) failed on all three OSes because Knip reported xclip as an unlisted binary. All applicable native `parallel:` groups passed.

Attempt 17 adds xclip to Knip's `ignoreBinaries` so the Linux-only CI dependency is declared without adding it as a cross-platform package. The Linux in-session cancellation picker remains under investigation. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.65 attempt 17 result — SHA `673cc8c`

The exact-SHA quality [37933026742](https://github.com/ashutoshpw/open-obsidian/actions/runs/37933026742), Rust CI [37933026853](https://github.com/ashutoshpw/open-obsidian/actions/runs/37933026853), desktop build [37933027039](https://github.com/ashutoshpw/open-obsidian/actions/runs/37933027039), plugin renderer [37933026889](https://github.com/ashutoshpw/open-obsidian/actions/runs/37933026889), loaded-plugin workflows [37933027026](https://github.com/ashutoshpw/open-obsidian/actions/runs/37933027026), and inventory [37933026779](https://github.com/ashutoshpw/open-obsidian/actions/runs/37933026779) all passed. The xclip Knip allowlist passed on all three OSes, and all applicable native `parallel:` groups passed. The path-filtered native vault round-trip workflow was not triggered for this configuration-and-task-record-only commit; the Linux cancellation issue from attempt 16 remains open. Job IDs are in [`evidence/r2.6.65-cancellation-attempt-17-673cc8c.json`](evidence/r2.6.65-cancellation-attempt-17-673cc8c.json).

### R2.6.65 attempt 18 result — SHA `5127065`

Exact-SHA round-trip [37934068527](https://github.com/ashutoshpw/open-obsidian/actions/runs/37934068527) passed cancellation, snapshots and Obsidian reopen on Windows. Ubuntu again did not show a second picker; the artifact records the pointer over the Open vault control and focus on OpenObsidian, but the app logged no second button activation or native picker result. macOS timed out waiting for eframe `app.ron` persistence after the second native picker opened and before the cancellation snapshot. Rust CI [37934068644](https://github.com/ashutoshpw/open-obsidian/actions/runs/37934068644), quality [37934068584](https://github.com/ashutoshpw/open-obsidian/actions/runs/37934068584), desktop build [37934068552](https://github.com/ashutoshpw/open-obsidian/actions/runs/37934068552), plugin renderer [37934068588](https://github.com/ashutoshpw/open-obsidian/actions/runs/37934068588), loaded-plugin workflows [37934068615](https://github.com/ashutoshpw/open-obsidian/actions/runs/37934068615), and inventory [37934068548](https://github.com/ashutoshpw/open-obsidian/actions/runs/37934068548) passed on all applicable OSes. Native parallel groups passed. Artifact IDs and digests are in [`evidence/r2.6.65-cancellation-attempt-18-5127065.json`](evidence/r2.6.65-cancellation-attempt-18-5127065.json).

Attempt 19 logs egui pointer-button events and the Open vault response rectangle under `OPENOBSIDIAN_CI_DIAGNOSTICS`, and holds the Linux primary click for 120 ms. Exact-SHA GitHub Actions validation is pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.65 attempt 19 result — SHA `2701df1`

The native round-trip [37935119692](https://github.com/ashutoshpw/open-obsidian/actions/runs/37935119692) passed on macOS and failed on Ubuntu and Windows on both attempts at the same SHA. Ubuntu's egui log reports the old pointer position `[786,309]` for the second button press, while X11 reports the pointer at `[36,51]` over the button. Windows received a press with `hovered=false` and a release with `hovered=true`, so the button did not report a click. Windows UI Automation also reported `IsEnabled=false` during polling although the app state and final control inventory show it enabled. The same-SHA Windows retry reproduced the failure.

Rust CI [37935119846](https://github.com/ashutoshpw/open-obsidian/actions/runs/37935119846), quality [37935119661](https://github.com/ashutoshpw/open-obsidian/actions/runs/37935119661), desktop build [37935119765](https://github.com/ashutoshpw/open-obsidian/actions/runs/37935119765), plugin renderer [37935119568](https://github.com/ashutoshpw/open-obsidian/actions/runs/37935119568), loaded-plugin workflows [37935119746](https://github.com/ashutoshpw/open-obsidian/actions/runs/37935119746), and inventory [37935119601](https://github.com/ashutoshpw/open-obsidian/actions/runs/37935119601) passed on all applicable OSes. The loaded-plugin macOS run initially failed because a remote `theme.css` download failed; its same-SHA rerun passed. All applicable native parallel groups passed. Round-trip artifact IDs and digests are in [`evidence/r2.6.65-cancellation-attempt-19-2701df1.json`](evidence/r2.6.65-cancellation-attempt-19-2701df1.json).

### R2.6.65 attempt 20 result — SHA `2e8447c`

Exact-SHA round-trip [37936679421](https://github.com/ashutoshpw/open-obsidian/actions/runs/37936679421) passed native cancellation, unchanged vault/app-data snapshots, and Obsidian reopen on Windows and macOS. Ubuntu selected the fixture and displayed the expected vault, but the second native picker did not open. X11 reported the pointer at `(36,51)` over Open vault; egui continued to log the previous Zenity position `(786,309)` with `hovered=false` and no click receipt. The Linux cancellation/reopen slice remains unaccepted. Artifact IDs and digests are in [`evidence/r2.6.65-cancellation-attempt-20-2e8447c.json`](evidence/r2.6.65-cancellation-attempt-20-2e8447c.json).

Rust CI [37936679514](https://github.com/ashutoshpw/open-obsidian/actions/runs/37936679514), quality [37936679541](https://github.com/ashutoshpw/open-obsidian/actions/runs/37936679541), desktop build [37936679608](https://github.com/ashutoshpw/open-obsidian/actions/runs/37936679608), plugin renderer [37936679633](https://github.com/ashutoshpw/open-obsidian/actions/runs/37936679633), loaded-plugin workflows [37936679845](https://github.com/ashutoshpw/open-obsidian/actions/runs/37936679845), and inventory [37936679400](https://github.com/ashutoshpw/open-obsidian/actions/runs/37936679400) passed. All applicable native `parallel:` groups passed. Attempt 21 explicitly reactivates the Linux application window, waits for egui-confirmed hover before clicking, and falls back to keyboard focus/Enter when X11 motion is not delivered. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.65 attempt 21 result — SHA `76f3195`

Exact-SHA round-trip [37938102365](https://github.com/ashutoshpw/open-obsidian/actions/runs/37938102365) passed native selection, cancellation, unchanged vault/app-data snapshots, and Obsidian reopen on Windows and macOS. Ubuntu successfully delivered the first egui click and opened the native picker, then the audit stopped with `egui_hover_event is not defined` before selecting the fixture or reaching cancellation. Linux remains unaccepted. Artifact IDs and digests are in [`evidence/r2.6.65-cancellation-attempt-21-76f3195.json`](evidence/r2.6.65-cancellation-attempt-21-76f3195.json).

Rust CI [37938102688](https://github.com/ashutoshpw/open-obsidian/actions/runs/37938102688), quality [37938102536](https://github.com/ashutoshpw/open-obsidian/actions/runs/37938102536), desktop build [37938102370](https://github.com/ashutoshpw/open-obsidian/actions/runs/37938102370), plugin renderer [37938102483](https://github.com/ashutoshpw/open-obsidian/actions/runs/37938102483), loaded-plugin workflows [37938102484](https://github.com/ashutoshpw/open-obsidian/actions/runs/37938102484), and inventory [37938102362](https://github.com/ashutoshpw/open-obsidian/actions/runs/37938102362) passed. All applicable native `parallel:` groups passed. The next source commit corrects the CI-reported property mapping; attempt 22 will rerun the exact-SHA matrix. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.65 attempt 22 result — SHA `d2f0bb5`

Exact-SHA round-trip [37938888438](https://github.com/ashutoshpw/open-obsidian/actions/runs/37938888438) passed on Ubuntu, macOS, and Windows. All three platforms opened the fixture, cancelled the second native picker, preserved vault and separate app-data snapshots, and reopened the same vault in Obsidian. On Ubuntu, CI showed X11 pointer motion still was not delivered to egui; the audit tab-focused Open vault and used Enter, then verified the native picker and sent Escape. Artifact IDs and digests are in [`evidence/r2.6.65-cancellation-attempt-22-d2f0bb5.json`](evidence/r2.6.65-cancellation-attempt-22-d2f0bb5.json). C01.2-16 is accepted for the three recorded runner OSes; this does not complete broader C01/C01.2 read-only coverage.

Rust CI [37938888640](https://github.com/ashutoshpw/open-obsidian/actions/runs/37938888640), quality [37938888421](https://github.com/ashutoshpw/open-obsidian/actions/runs/37938888421), desktop build [37938888460](https://github.com/ashutoshpw/open-obsidian/actions/runs/37938888460), plugin renderer [37938888486](https://github.com/ashutoshpw/open-obsidian/actions/runs/37938888486), loaded-plugin workflows [37938888492](https://github.com/ashutoshpw/open-obsidian/actions/runs/37938888492), and inventory [37938888513](https://github.com/ashutoshpw/open-obsidian/actions/runs/37938888513) passed. All applicable native `parallel:` groups passed. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.66 started — C01.2-17 outside-vault reference containment

At starting SHA e14cdca7cff0b37137c26324678a13844d957edf, selected a read-only flow that checks relative Markdown links and embeds pointing from a nested note to a sibling file outside the selected vault. Added a focused egui acceptance test that requires unresolved targets, an unrendered embed, no outside content in the report, and unchanged vault, app-data, and outside-file bytes after resolution and teardown. Added the pending C01.2-17 row to the matrix. Exact-SHA GitHub Actions validation is pending; no local tests, builds, formatters, linters, or application launches were run.

Next: review the source and task-tracking changes, commit and push to origin/main, then inspect all required exact-SHA CI workflows and platform jobs. Broader C01/C01.2 acceptance remains pending.

### R2.6.66 attempt 1 result and correction — SHA 7e3e8ca

Rust CI run [37940517496](https://github.com/ashutoshpw/open-obsidian/actions/runs/37940517496) compiled the new test on all three OSes, but it failed when the test queried the same accessible “Source target” label exposed by both references. The direct assertions for the two unresolved references had passed. Ubuntu also reported two formatting-only differences. Both issues are corrected in the next source change; no local formatter or tests were run.

Inventory [37940517580](https://github.com/ashutoshpw/open-obsidian/actions/runs/37940517580), loaded-plugin workflows [37940517583](https://github.com/ashutoshpw/open-obsidian/actions/runs/37940517583), desktop build [37940517593](https://github.com/ashutoshpw/open-obsidian/actions/runs/37940517593), and plugin renderer [37940517712](https://github.com/ashutoshpw/open-obsidian/actions/runs/37940517712) passed. Quality [37940517742](https://github.com/ashutoshpw/open-obsidian/actions/runs/37940517742) failed only on macOS, where the unrelated Electron vault audit did not reach its local-retrieval check; this needs a fresh exact-SHA result. The round-trip run [37940517561](https://github.com/ashutoshpw/open-obsidian/actions/runs/37940517561) passed Ubuntu and macOS at first review; Windows was still running then and later passed. All three round-trip jobs succeeded, with artifact details in evidence/r2.6.66-attempt-1-7e3e8ca.json.

The correction removes the duplicate-label UI query and applies the exact layout requested by Rust CI formatting. C01.2-17 and broader C01/C01.2 remain pending.

The Windows job in round-trip run 37940517561 has now passed as well. All three Obsidian round-trip jobs passed; artifact IDs and SHA-256 digests are recorded in evidence/r2.6.66-attempt-1-7e3e8ca.json. This companion pass does not change the failed Rust UI test result.

### R2.6.66 attempt 2 result and full-label correction — SHA 099ed0a

Rust CI [37941225076](https://github.com/ashutoshpw/open-obsidian/actions/runs/37941225076) passed formatting but the new test failed on Ubuntu, macOS, and Windows. The accessible message is “Not rendered: no matching Markdown note or vault attachment was found. ![[../../Outside.md|outside note]]”; egui appends the original embed syntax, so the shorter prefix query returned no node. The test now queries the full UI label. Quality [37941224859](https://github.com/ashutoshpw/open-obsidian/actions/runs/37941224859), inventory [37941224995](https://github.com/ashutoshpw/open-obsidian/actions/runs/37941224995), loaded-plugin workflows [37941224998](https://github.com/ashutoshpw/open-obsidian/actions/runs/37941224998), desktop build [37941225012](https://github.com/ashutoshpw/open-obsidian/actions/runs/37941225012), and plugin renderer [37941224980](https://github.com/ashutoshpw/open-obsidian/actions/runs/37941224980) passed on all required platforms.

Obsidian round-trip run [37941224899](https://github.com/ashutoshpw/open-obsidian/actions/runs/37941224899) passed macOS, failed Ubuntu during its author/open/snapshot/reopen step, and was still running on Windows at record time. The failure is recorded pending its logs and artifact. Attempt details are in evidence/r2.6.66-attempt-2-099ed0a.json. C01.2-17 and broader C01/C01.2 remain pending.

The Ubuntu job in round-trip run 37941224899 has now completed with failure; macOS and Windows passed. Its uploaded report shows the selected fixture opened in OpenObsidian and the Obsidian authoring steps passed. The final Obsidian reopen step failed when xdotool searched for a visible X11 window; the report leaves obsidian_reopen pending. The Ubuntu artifact, screenshots, logs, report, artifact ID and digest are recorded in evidence/r2.6.66-attempt-2-099ed0a.json. This reference-app runner issue is separate from the Rust UI test’s missing accessible-label suffix.

### R2.6.66 attempt 3 result — SHA 6c00421

Rust CI [37942056560](https://github.com/ashutoshpw/open-obsidian/actions/runs/37942056560) passed the workspace tests on Ubuntu, macOS, and Windows, including the C01.2-17 outside-vault link/embed assertions. Ubuntu formatting alone failed because rustfmt expects the full accessible-label assignment on one line; the CI diff confirmed the exact layout. Quality [37942056596](https://github.com/ashutoshpw/open-obsidian/actions/runs/37942056596), inventory [37942056428](https://github.com/ashutoshpw/open-obsidian/actions/runs/37942056428), loaded-plugin workflows [37942056607](https://github.com/ashutoshpw/open-obsidian/actions/runs/37942056607), desktop build [37942056440](https://github.com/ashutoshpw/open-obsidian/actions/runs/37942056440), plugin renderer [37942056491](https://github.com/ashutoshpw/open-obsidian/actions/runs/37942056491), and the Obsidian round trip [37942056513](https://github.com/ashutoshpw/open-obsidian/actions/runs/37942056513) passed on all required platforms. Job IDs and artifact digests are in evidence/r2.6.66-attempt-3-6c00421.json. The one-line format correction and fresh exact-SHA CI are pending; C01.2-17 remains pending until Rust CI passes.

### R2.6.66 attempt 4 result — SHA 9b08663

Rust CI [37943051080](https://github.com/ashutoshpw/open-obsidian/actions/runs/37943051080) passed formatting, workspace tests, Clippy, layering, native preview builds and plugin runtime probes on Ubuntu, macOS and Windows. The vault round trip [37943051122](https://github.com/ashutoshpw/open-obsidian/actions/runs/37943051122), inventory [37943051060](https://github.com/ashutoshpw/open-obsidian/actions/runs/37943051060), loaded-plugin workflows [37943050981](https://github.com/ashutoshpw/open-obsidian/actions/runs/37943050981), desktop build [37943051089](https://github.com/ashutoshpw/open-obsidian/actions/runs/37943051089), and plugin renderer [37943050989](https://github.com/ashutoshpw/open-obsidian/actions/runs/37943050989) also passed on all required platforms. Quality [37943051161](https://github.com/ashutoshpw/open-obsidian/actions/runs/37943051161) initially failed on macOS because the Electron vault audit did not reach its local retrieval boundary; rerunning the failed job on the same SHA passed all three quality jobs. C01.2-17 is accepted on exact source SHA 9b08663fadc162c6843e1cd5df76589462522eca. Run IDs, job IDs, artifact IDs and digests are in evidence/r2.6.66-attempt-4-9b08663.json. Broader C01/C01.2 acceptance remains pending.

### R2.6.67 scope — native Windows note-selector accessibility

C01.2-02 records that the Note to inspect popup remains unverified for Windows accessibility. R2.6.67 uses a Windows-only GitHub Actions audit to launch the native app against a disposable two-note vault, inspect the note selector's UIA patterns and options, select Notes/Welcome.md through SelectionItemPattern, and compare vault plus isolated APPDATA/LOCALAPPDATA snapshots through teardown. The synthetic egui tests remain separate evidence; this slice is not a claim about VoiceOver or AT-SPI. Exact-SHA CI is pending.

### R2.6.67 attempt 1 result — SHA 2f8d950

Rust CI, quality, desktop build, plugin renderer, loaded-plugin workflows, and inventory passed on exact source SHA `2f8d950cd2a4fc9bb16c886fb0f8a3288bfdec53`; the Linux and macOS Obsidian round-trip jobs also passed. The Windows UIA audit found the `Note to inspect` control by its correct ComboBox role and name, then failed because the pinned AccessKit Windows adapter exposes no ExpandCollapsePattern. Microsoft's ComboBox specification requires that pattern, so the popup could not be opened and the app-data no-write comparison was not reached. Full run and job IDs, artifact ID and digest, and the report hash are in `evidence/r2.6.67-uia-attempt-1-2f8d950.json`. The correction replaces the ComboBox with a named menu button using InvokePattern and radio options using SelectionItemPattern; exact-SHA CI will validate selected-value reporting and no-write snapshots.

### R2.6.67 attempt 2 result and UIA invocation correction — SHA `c5c8ef9`

The menu-button version exposed an enabled Button named `Note to inspect` and a ValuePattern value, but Windows UI Automation did not expose InvokePattern. The audit stopped before popup selection or isolated APPDATA/LOCALAPPDATA baselines; the report recorded the vault unchanged after teardown. The displayed value was `Notes\Welcome.md` because that fixture path sorted before `README.md`. The Windows job failed in round-trip run [37947952858](https://github.com/ashutoshpw/open-obsidian/actions/runs/37947952858), job `113879024691`. Artifact `11623444618` has digest `sha256:3287072b0d2200e53e64ffa957b008a49c36cf9c7ae4f6e2e02119209422aed7`; report SHA-256 is `1127d6439cb31cd960bfc630981c43e33284c112503b74b1ddbe2f1323a5fd54`. Linux and macOS round-trip jobs passed.

Rust CI [37947952897](https://github.com/ashutoshpw/open-obsidian/actions/runs/37947952897), quality [37947952967](https://github.com/ashutoshpw/open-obsidian/actions/runs/37947952967), desktop build [37947952947](https://github.com/ashutoshpw/open-obsidian/actions/runs/37947952947), plugin renderer [37947952651](https://github.com/ashutoshpw/open-obsidian/actions/runs/37947952651), loaded-plugin workflows [37947952888](https://github.com/ashutoshpw/open-obsidian/actions/runs/37947952888), and inventory [37947952844](https://github.com/ashutoshpw/open-obsidian/actions/runs/37947952844) passed. Exact job IDs and artifact details are in `evidence/r2.6.67-uia-attempt-2-c5c8ef9.json`.

The next correction explicitly adds the AccessKit Click action to the menu-button node and moves the nested fixture note to `Zed/Welcome.md`, after `README.md` in path order. Exact-SHA GitHub Actions validation remains pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.67 attempt 3 result and expanded-state correction — SHA `d54fb8c`

Windows round-trip run [37948991762](https://github.com/ashutoshpw/open-obsidian/actions/runs/37948991762), job `113882568596`, still failed UIA: the selector reported value `README.md` but did not expose InvokePattern. The vault remained unchanged after teardown; the audit again stopped before popup selection and application-data baselines. Its artifact is `11625036245`, digest `sha256:6779e734bda96f974a7ae6f11850e0a1686b24d6addf398b37c0adcfa673597c`; report SHA-256 is `9e9fc4e9e0256151b64d8a188279097dc60fdd492a1281c511c7aab26ac12697`.

At evidence collection, Rust CI [37948991759](https://github.com/ashutoshpw/open-obsidian/actions/runs/37948991759) had passed macOS and Windows jobs, while the Ubuntu job was still running. Inventory [37948991771](https://github.com/ashutoshpw/open-obsidian/actions/runs/37948991771), quality [37948991837](https://github.com/ashutoshpw/open-obsidian/actions/runs/37948991837), desktop build [37948991773](https://github.com/ashutoshpw/open-obsidian/actions/runs/37948991773), plugin renderer [37948991844](https://github.com/ashutoshpw/open-obsidian/actions/runs/37948991844), loaded-plugin workflows [37948991770](https://github.com/ashutoshpw/open-obsidian/actions/runs/37948991770), and Linux/macOS round-trip jobs passed. Run and job details are in `evidence/r2.6.67-uia-attempt-3-d54fb8c.json`.

The pinned AccessKit consumer derives Invoke eligibility from clickability while excluding nodes with expanded state; the Windows adapter uses that eligibility for InvokePattern. The previous code set `expanded=false` while closed, suppressing Invoke. The next correction clears the expanded attribute while closed and sets it only while the popup is open, retaining the Click action and menu popup label. Exact-SHA GitHub Actions validation remains pending; no local tests, builds, formatters, linters, or application launches were run.

### R2.6.67 attempt 4 result — SHA `1edccbf`

C01.2-18 passed on exact source SHA `1edccbf3978406f28e0569f3784d3be1e9fbe479`. Windows UIA exposed an enabled `Note to inspect` Button with InvokePattern and ValuePattern showing `README.md`; `InvokePattern.Invoke` opened the menu; UIA exposed `README.md` and `Zed\Welcome.md` as RadioButton options; `SelectionItemPattern.Select` selected `Zed\Welcome.md` and the ValuePattern updated. Vault, isolated roaming app data, and isolated local app data snapshots were unchanged during actions and after teardown. The report is in `evidence/r2.6.67-uia-attempt-4-1edccbf.json`; artifact `11625946596` has digest `sha256:b2587a3e1ecf68dbdbc966f335e007595563c95d48f26af10e272c5b1604ad56`, and the report SHA-256 is `327ac0e5299862c7b3eecbebe5c1285a6f31def493862cb658dea3c7e769a195`.

All seven required workflows passed on this exact SHA: Rust CI [37950261226](https://github.com/ashutoshpw/open-obsidian/actions/runs/37950261226), Obsidian vault round trip [37950261158](https://github.com/ashutoshpw/open-obsidian/actions/runs/37950261158), inventory [37950261193](https://github.com/ashutoshpw/open-obsidian/actions/runs/37950261193), loaded-plugin workflows [37950261146](https://github.com/ashutoshpw/open-obsidian/actions/runs/37950261146), desktop build [37950261239](https://github.com/ashutoshpw/open-obsidian/actions/runs/37950261239), plugin renderer [37950261324](https://github.com/ashutoshpw/open-obsidian/actions/runs/37950261324), and quality [37950261198](https://github.com/ashutoshpw/open-obsidian/actions/runs/37950261198). The initial macOS round-trip job failed on its separate `app.ron` persistence wait before cancellation; rerunning that job on the same SHA passed. Final job IDs and both macOS artifact digests are in the linked evidence JSON.

R2.6.67 is complete for C01.2-18 on the Windows GitHub runner. This result does not certify VoiceOver or AT-SPI behavior; broader C01/C01.2 acceptance remains pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.68 attempt 1 result — SHA `4f3a5b49`

The existing-vault link/transclusion UI case now checks complete vault and separate app-data snapshots, including a binary app-data sentinel, after session open, nested Markdown rendering, and teardown. Its C03 fixture includes selected heading/block transclusions and a nested self-embed cycle; the UI must render the selected text, stop the cycle, and keep an unsupported SVG embed explicitly unrendered. The strengthened workspace test passed on Ubuntu, macOS, and Windows.

Rust CI [37953262720](https://github.com/ashutoshpw/open-obsidian/actions/runs/37953262720) failed only the Ubuntu formatting gate: `cargo fmt --all -- --check` requested multiline layout for the two app-data snapshot assertions at `crates/ui-egui/src/lib.rs` lines 4023 and 4142. The Ubuntu workspace test step passed; the macOS job `113897225501` and Windows job `113897225527` passed. The other six required workflows passed: Obsidian round trip [37953262566](https://github.com/ashutoshpw/open-obsidian/actions/runs/37953262566), inventory [37953262723](https://github.com/ashutoshpw/open-obsidian/actions/runs/37953262723), loaded plugins [37953262564](https://github.com/ashutoshpw/open-obsidian/actions/runs/37953262564), desktop build [37953262798](https://github.com/ashutoshpw/open-obsidian/actions/runs/37953262798), plugin renderer [37953262652](https://github.com/ashutoshpw/open-obsidian/actions/runs/37953262652), and quality [37953262727](https://github.com/ashutoshpw/open-obsidian/actions/runs/37953262727). Full job IDs and conclusions are in `evidence/r2.6.68-attempt-1-4f3a5b4.json`.

The next commit applies those two CI-reported wraps and reruns the required workflows on the corrected exact SHA. C01.2-19 remains pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.68 attempt 2 result — SHA `65b8c47`

C01.2-19 passed on exact source SHA `65b8c4739032b9a44e9bae0b7c81437fae62f274`. The strengthened nested-transclusion workspace test passed on Ubuntu, macOS, and Windows. It rendered the selected heading and block source slices, stopped the nested self-embed cycle, kept the unsupported SVG explicit, and preserved complete vault and separate app-data snapshots—including the binary sentinel—through open, link resolution, rendering, and teardown.

Rust CI [37954282572](https://github.com/ashutoshpw/open-obsidian/actions/runs/37954282572) passed on same-SHA attempt 2. Its first attempt passed all three workspace test suites and failed only when the Windows Wry feasibility probe timed out; the retry passed on Windows. Obsidian vault round-trip [37954282908](https://github.com/ashutoshpw/open-obsidian/actions/runs/37954282908) passed on same-SHA attempt 2 after its first macOS job timed out waiting for `app.ron` persistence before the acceptance actions. Inventory [37954282754](https://github.com/ashutoshpw/open-obsidian/actions/runs/37954282754), loaded-plugin workflows [37954282727](https://github.com/ashutoshpw/open-obsidian/actions/runs/37954282727), desktop build [37954282581](https://github.com/ashutoshpw/open-obsidian/actions/runs/37954282581), plugin renderer [37954282772](https://github.com/ashutoshpw/open-obsidian/actions/runs/37954282772), and quality [37954282558](https://github.com/ashutoshpw/open-obsidian/actions/runs/37954282558) passed on their initial attempts. All seven required workflows therefore passed on the exact source SHA. Per-job results and artifact digests are in [`evidence/r2.6.68-attempt-2-65b8c47.json`](evidence/r2.6.68-attempt-2-65b8c47.json).

The GitHub Actions parallel-step syntax from the [June 25 changelog](https://github.blog/changelog/2026-06-25-actions-steps-can-now-be-run-in-parallel/) is already used by this repository in Rust CI, quality, desktop build, compatibility-pin verification, round-trip acceptance, and reference-feasibility workflows. No workflow changes were needed for that feature; parallel groups completed successfully in the exact-SHA runs above.

This acceptance is synthetic egui coverage and does not claim identical Obsidian transclusion rendering or native screen-reader behavior. R2.6.68 is complete for C01.2-19; broader C01/C01.2 acceptance remains pending. No local tests, builds, formatters, linters, or application launches were run.

## R2.6.69 — symlink-boundary read-only links and transclusions

Add C01.2-20 using the existing `fixture:symlink-boundary` contract. The cross-platform egui case opens a synthetic existing vault with a file symlink and a directory symlink to an outside Markdown target, then resolves Markdown and wiki references. Require both symlinks to remain metadata-only, both embeds to stay unrendered, the outside sentinel to remain absent from reports, and complete vault, app-data, and outside-target snapshots to remain unchanged through teardown. The repository's GitHub Actions parallel-step feature was already present in the relevant workflows; no workflow change is needed. Implementation and exact-SHA validation remain in progress. No local tests, builds, formatters, linters, or application launches were run.

The first source SHA `4f60ad384a6055dfd7e52348a1945c8cd8fcd4f5` passed the new workspace test on Ubuntu, macOS, and Windows. GitHub's Ubuntu formatting job identified three layout changes; the push-triggered Ubuntu runner stalled in dependency setup, so a same-SHA manual Rust CI run completed the tests and reported only formatting failure. The Obsidian round-trip passed on Ubuntu and Windows. Its macOS job failed three same-SHA attempts because the audit waited for `app.ron` even though the file was not created; the five companion workflows passed. The correction applies the exact formatting from Rust CI and compares snapshots of whatever app-data state exists immediately before cancellation, without requiring `app.ron`; any later change remains a failure. Exact-SHA CI for the correction is pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.69 accepted — C01.2-20 — source SHA `6ed9058`

The symlink-boundary egui workspace test passed on Ubuntu, macOS, and Windows. Both the file and directory symlinks to the outside Markdown target stayed unresolved; all four Markdown/wiki references remained unresolved, both embeds remained unrendered, the outside sentinel stayed absent from reports, and complete vault, separate app-data, and outside-target snapshots remained unchanged after open, resolution, and teardown.

Rust CI [37960074849](https://github.com/ashutoshpw/open-obsidian/actions/runs/37960074849), Obsidian vault round-trip [37960074884](https://github.com/ashutoshpw/open-obsidian/actions/runs/37960074884), inventory [37960074908](https://github.com/ashutoshpw/open-obsidian/actions/runs/37960074908), loaded-plugin workflows [37960074861](https://github.com/ashutoshpw/open-obsidian/actions/runs/37960074861), desktop build [37960074873](https://github.com/ashutoshpw/open-obsidian/actions/runs/37960074873), quality [37960074863](https://github.com/ashutoshpw/open-obsidian/actions/runs/37960074863), and plugin renderer [37960074993](https://github.com/ashutoshpw/open-obsidian/actions/runs/37960074993) all passed on exact source SHA `6ed9058de819829284eb03b3ee2a0e3f29863d8a`. All Rust checks and native builds passed on the three operating systems. The corrected Obsidian audit passed all three platforms while preserving the strict before/after app-data snapshot comparison. Job IDs and artifact digests are in [`evidence/r2.6.69-attempt-2-6ed9058.json`](evidence/r2.6.69-attempt-2-6ed9058.json).

The repository already uses GitHub Actions parallel groups in Rust CI, quality, desktop build, compatibility-pin verification, Obsidian round-trip acceptance, and reference-feasibility workflows, so no workflow YAML edit was needed for the June 25 parallel-step feature. C01 and C01.2 remain pending because broader read-only acceptance coverage is incomplete. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.70 started — C01.2-21 dangling symlink containment

At starting SHA `df60c1e118cc4677538dcaa6f497e5d812ae568e`, selected the dangling-target edge of the existing `fixture:symlink-boundary` contract. The new cross-platform egui case seeds a real Markdown note, an unrelated outside sentinel, and dangling file/directory symlinks pointing outside the vault. It requires the vault scan to list only the real note, reference resolution to remain unresolved without an error, embeds to stay unrendered, and vault/app-data/outside snapshots to stay unchanged through teardown. Exact-SHA GitHub Actions validation is pending. No local tests, builds, formatters, linters, or application launches were run.

The first source SHA `c580968fc0df3ea1ca1300696095f37ed0b49019` passed the new workspace test on Ubuntu, macOS, and Windows. Rust CI [37962018748](https://github.com/ashutoshpw/open-obsidian/actions/runs/37962018748) failed only Ubuntu formatting; the workspace tests passed on all three OSes, as did Clippy, layering, native preview builds, and the Wry feasibility probes. Obsidian vault round-trip [37962018635](https://github.com/ashutoshpw/open-obsidian/actions/runs/37962018635) passed on all three OSes. Inventory [37962018644](https://github.com/ashutoshpw/open-obsidian/actions/runs/37962018644), loaded-plugin workflows [37962018617](https://github.com/ashutoshpw/open-obsidian/actions/runs/37962018617), desktop build [37962018609](https://github.com/ashutoshpw/open-obsidian/actions/runs/37962018609), quality [37962018716](https://github.com/ashutoshpw/open-obsidian/actions/runs/37962018716), and plugin renderer [37962018641](https://github.com/ashutoshpw/open-obsidian/actions/runs/37962018641) passed. Rust CI requested one multiline layout change to the dangling-directory symlink metadata assertion; that exact diff is applied, and fresh exact-SHA CI is pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.70 accepted — C01.2-21 — source SHA `e924c2d`

The dangling-symlink egui workspace test passed on Ubuntu, macOS, and Windows. The scan listed only the real Markdown note while recording the dangling file and directory symlinks without following their missing outside targets. All four Markdown/wiki references remained unresolved without error; both embeds stayed unrendered; the unrelated outside sentinel remained absent from the report; and full vault, separate app-data, and outside snapshots remained unchanged after open, resolution, and teardown.

Rust CI [37962678665](https://github.com/ashutoshpw/open-obsidian/actions/runs/37962678665), Obsidian vault round-trip [37962678682](https://github.com/ashutoshpw/open-obsidian/actions/runs/37962678682), inventory [37962678803](https://github.com/ashutoshpw/open-obsidian/actions/runs/37962678803), loaded-plugin workflows [37962678699](https://github.com/ashutoshpw/open-obsidian/actions/runs/37962678699), desktop build [37962680186](https://github.com/ashutoshpw/open-obsidian/actions/runs/37962680186), quality [37962678739](https://github.com/ashutoshpw/open-obsidian/actions/runs/37962678739), and plugin renderer [37962678657](https://github.com/ashutoshpw/open-obsidian/actions/runs/37962678657) all passed on exact source SHA `e924c2daf831428601ddb9ae3cdc8811f7171394`. The first attempt's formatting-only failure and corrected run's job IDs and artifact digests are in [`evidence/r2.6.70-attempt-2-e924c2d.json`](evidence/r2.6.70-attempt-2-e924c2d.json).

C01 and C01.2 remain pending because broader read-only acceptance coverage is incomplete. The existing GitHub Actions parallel-step implementation remains in place; no workflow YAML change was needed. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.71 started — C01.2-22 in-vault symlink containment

At starting SHA `2c33dc1d699de9684f1fd8d7fffb6a1263b2d5af`, selected the in-vault target side of `fixture:symlink-boundary`. The new cross-platform egui case opens a vault with file and directory symlinks to real notes inside that vault. It requires scanning to list each real Markdown note once, symlink paths to remain metadata-only, all references through the aliases to stay unresolved, embeds to stay unrendered, target content to remain absent from reports, and vault/app-data snapshots to remain unchanged through teardown. Exact-SHA GitHub Actions validation is pending. No local tests, builds, formatters, linters, or application launches were run.

The first source SHA `58ed756173ebc56d41d455d15dca48d7c5ab900a` passed the new workspace test on Ubuntu, macOS, and Windows. Rust CI [37964197061](https://github.com/ashutoshpw/open-obsidian/actions/runs/37964197061) failed only Ubuntu formatting; all other Rust checks passed on macOS and Windows. Obsidian vault round-trip [37964197141](https://github.com/ashutoshpw/open-obsidian/actions/runs/37964197141) passed on all three OSes. Inventory [37964197233](https://github.com/ashutoshpw/open-obsidian/actions/runs/37964197233), loaded-plugin workflows [37964197122](https://github.com/ashutoshpw/open-obsidian/actions/runs/37964197122), desktop build [37964197088](https://github.com/ashutoshpw/open-obsidian/actions/runs/37964197088), quality [37964197064](https://github.com/ashutoshpw/open-obsidian/actions/runs/37964197064), and plugin renderer [37964197150](https://github.com/ashutoshpw/open-obsidian/actions/runs/37964197150) passed. Rust CI requested a single-line `read_link(...).expect(...)` layout for the directory symlink target assertion. That exact formatter diff is applied, and fresh exact-SHA CI is pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.71 attempt 2 result — SHA `0108ca7`

Rust CI [37964860456](https://github.com/ashutoshpw/open-obsidian/actions/runs/37964860456) passed formatting, workspace tests, Clippy, layering, native preview builds and compatibility probes on Ubuntu, macOS and Windows. Inventory [37964860398](https://github.com/ashutoshpw/open-obsidian/actions/runs/37964860398), loaded-plugin workflows [37964860416](https://github.com/ashutoshpw/open-obsidian/actions/runs/37964860416), desktop build [37964860433](https://github.com/ashutoshpw/open-obsidian/actions/runs/37964860433), quality [37964860575](https://github.com/ashutoshpw/open-obsidian/actions/runs/37964860575), and plugin renderer [37964860411](https://github.com/ashutoshpw/open-obsidian/actions/runs/37964860411) also passed on all applicable platforms. The Obsidian round trip [37964861008](https://github.com/ashutoshpw/open-obsidian/actions/runs/37964861008) passed on Ubuntu and Windows; macOS passed the vault snapshot gate but failed when the app-data exact-snapshot assertion rejected eframe's persisted `app.ron` UI state after picker cancellation. The macOS report artifact `11632239984` has digest `sha256:3236f8a73656901fe92a128a17b90dec7fd21b9439d48246c7e87cbe31df2328`.

The audit now applies the existing macOS-only `app.ron` content and forbidden-path checks after picker cancellation and application close. Every vault snapshot remains exact, and app-data changes on Linux and Windows remain disallowed. Exact-SHA validation of this correction is pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.71 accepted — C01.2-22 — source SHA `e6f47c7`

The in-vault symlink egui test passed on Ubuntu, macOS and Windows. The vault scan listed each real Markdown note once without traversing the in-vault file and directory symlinks. All four alias references remained unresolved, both embeds stayed unrendered, target-note sentinel text was absent from the report, and vault/app-data snapshots remained unchanged through open, resolution and teardown.

Rust CI [37965884311](https://github.com/ashutoshpw/open-obsidian/actions/runs/37965884311), inventory [37965884302](https://github.com/ashutoshpw/open-obsidian/actions/runs/37965884302), loaded-plugin workflows [37965884314](https://github.com/ashutoshpw/open-obsidian/actions/runs/37965884314), desktop build [37965884268](https://github.com/ashutoshpw/open-obsidian/actions/runs/37965884268), quality [37965884310](https://github.com/ashutoshpw/open-obsidian/actions/runs/37965884310), plugin renderer [37965884270](https://github.com/ashutoshpw/open-obsidian/actions/runs/37965884270), and Obsidian vault round trip [37965884264](https://github.com/ashutoshpw/open-obsidian/actions/runs/37965884264) passed on exact source SHA `e6f47c7a6d39950d20f1922022fa39e28d075b63`. The first Ubuntu round-trip attempt failed before cancellation assertions when `xdotool search --onlyvisible --name .` found no visible window; rerunning that Ubuntu job on the same SHA passed. The macOS and Windows round-trip jobs passed. The reports show 22 unchanged vault entries and unchanged app data after cancellation and close. The successful macOS report had no `app.ron` changes, so the allowed-file branch was not exercised in that accepted run. Full job IDs, both Ubuntu artifacts, all other artifact digests and exact-SHA results are in [`evidence/r2.6.71-attempt-3-e6f47c7.json`](evidence/r2.6.71-attempt-3-e6f47c7.json).

The native GitHub Actions parallel groups in Rust CI, quality, desktop build and vault round-trip completed on this exact SHA. The CI parallel-step preparation remains documented in `evidence/parallel-ci.json` and `evidence/parallel-ci-runner-setup-c479996.json`; no workflow YAML changed in this slice. This is synthetic egui coverage and does not claim identical Obsidian symlink behavior. Broader C01/C01.2 acceptance remains pending. No local tests, builds, formatters, linters or application launches were run.

### R2.6.72 started — C01.2-23 self-referential directory symlink

At starting SHA `73e4b8cab8ef5944951dfe3c5fb06d23b40318ce`, selected a cycle case in the existing symlink-boundary safety contract. The cross-platform egui acceptance test opens a vault where `Notes/loop` points to `Notes`, checks scanning terminates and lists only the real Markdown files, then resolves one-hop and repeated-loop references. It requires alias links to remain unresolved, embeds to stay unrendered, target content to remain absent, and full vault plus separate app-data snapshots to remain unchanged through teardown. Exact-SHA GitHub Actions validation is pending. The Actions `parallel` prerequisite is already implemented and its exact-commit workflows passed; this slice needs no workflow change. No local tests, builds, formatters, linters, or application launches were run.

The first source SHA `26d82e079045718c5f7c88c65dfb6221bca987f9` passed the focused workspace test on Ubuntu, macOS, and Windows. Rust CI [37968436823](https://github.com/ashutoshpw/open-obsidian/actions/runs/37968436823) identified one Ubuntu rustfmt line wrap and Clippy's `cmp_owned` warning on macOS and Windows. The other required workflows passed: Obsidian round-trip [37968436854](https://github.com/ashutoshpw/open-obsidian/actions/runs/37968436854) passed macOS and Windows but its first Ubuntu attempt failed because `xdotool search --onlyvisible --name .` found no visible window; inventory [37968436853](https://github.com/ashutoshpw/open-obsidian/actions/runs/37968436853), loaded-plugin workflows [37968436744](https://github.com/ashutoshpw/open-obsidian/actions/runs/37968436744), desktop build [37968436721](https://github.com/ashutoshpw/open-obsidian/actions/runs/37968436721), quality [37968436719](https://github.com/ashutoshpw/open-obsidian/actions/runs/37968436719), and plugin renderer [37968436828](https://github.com/ashutoshpw/open-obsidian/actions/runs/37968436828) passed. The focused workspace test passed before Clippy on macOS/Windows and alongside Ubuntu's formatting failure. The same-SHA Ubuntu retry job `113950447731` made no progress in Linux dependency setup for more than seven minutes and was cancelled; that retry is not validation evidence. The next commit applies only the CI-reported formatter and borrowed-path comparison corrections and obtains fresh exact-SHA results. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.72 accepted — C01.2-23 — source SHA `c0b5d28`

The focused self-referential directory-symlink workspace test passed on Ubuntu, macOS, and Windows. Vault open completed without traversing `Notes/loop`; the real Markdown note and target were each listed once; direct reads and source previews through first-hop/repeated cycle paths returned the symlink error; all four references remained unresolved; both embeds stayed unrendered; and the target sentinel remained absent from the report. Full vault and separate app-data snapshots remained unchanged through open, link resolution, and teardown.

Rust CI [37969958828](https://github.com/ashutoshpw/open-obsidian/actions/runs/37969958828), Obsidian vault round-trip [37969958822](https://github.com/ashutoshpw/open-obsidian/actions/runs/37969958822), inventory [37969958858](https://github.com/ashutoshpw/open-obsidian/actions/runs/37969958858), loaded-plugin workflows [37969958821](https://github.com/ashutoshpw/open-obsidian/actions/runs/37969958821), desktop build [37969958872](https://github.com/ashutoshpw/open-obsidian/actions/runs/37969958872), quality [37969958830](https://github.com/ashutoshpw/open-obsidian/actions/runs/37969958830), and plugin renderer [37969958837](https://github.com/ashutoshpw/open-obsidian/actions/runs/37969958837) all passed on the exact source SHA. Every required Ubuntu, macOS and Windows job passed. Run/job IDs and artifact digests are in [`evidence/r2.6.72-attempt-2-c0b5d28.json`](evidence/r2.6.72-attempt-2-c0b5d28.json).

This synthetic egui case does not establish identical Obsidian symlink-cycle behavior. The Actions `parallel` groups in Rust CI, quality, desktop build and vault round-trip also completed on this SHA. Broader C01/C01.2 acceptance remains pending. No local tests, builds, formatters, linters or application launches were run.

### R2.6.73 started — C01.2-24 external note rename refresh

At starting SHA `39bba59d67e4ba3f72104636951d587e295b48a5`, selected the uncovered existing-vault flow where the currently selected and previewed note is renamed outside OpenObsidian. The new egui case seeds a resolvable self-link, captures a byte snapshot, performs the external rename, and checks refresh clears stale link/embed/preview state, falls back to `README.md`, and still allows the renamed note to be selected and previewed byte-for-byte. It also compares the post-rename vault and separate app-data snapshots through refresh, preview, close and teardown. Exact-SHA GitHub Actions validation is pending. No local tests, builds, formatters, linters or application launches were run.

Attempt 1 on exact source SHA `3b361e255179d79980c25e09aca62b938e61e1ca` failed the new focused workspace test on Ubuntu, macOS and Windows: `Notes/Welcome-renamed.md` sorts before `README.md`, so it was correctly chosen as the first refreshed entry. Ubuntu also reported the exact rustfmt line wraps applied in the follow-up. Inventory [37972081606](https://github.com/ashutoshpw/open-obsidian/actions/runs/37972081606), quality [37972081615](https://github.com/ashutoshpw/open-obsidian/actions/runs/37972081615), desktop build [37972081451](https://github.com/ashutoshpw/open-obsidian/actions/runs/37972081451), loaded-plugin workflows [37972081475](https://github.com/ashutoshpw/open-obsidian/actions/runs/37972081475), and plugin renderer [37972081592](https://github.com/ashutoshpw/open-obsidian/actions/runs/37972081592) passed. Rust CI [37972083301](https://github.com/ashutoshpw/open-obsidian/actions/runs/37972083301) failed on the formatter and the same fallback assertion across all three systems. Obsidian round-trip [37972081722](https://github.com/ashutoshpw/open-obsidian/actions/runs/37972081722) passed on Ubuntu and macOS while Windows was still running. The correction renames the note to root-level `Zzz-Welcome-renamed.md`, placing it after the deterministic README fallback, and applies the formatter's suggested layout. No local checks were run.

### R2.6.73 accepted — C01.2-24 — source SHA `5670d5a`

The corrected focused workspace test passed on Ubuntu, macOS and Windows. After the external rename to `Zzz-Welcome-renamed.md`, refresh removed the old path, cleared stale preview/link/embed state, selected `README.md`, and kept the renamed note available for byte-exact BOM/CRLF preview. Full vault and separate app-data snapshots matched the post-rename baseline through refresh, fallback preview, renamed-note preview, close and teardown.

Rust CI [37972566928](https://github.com/ashutoshpw/open-obsidian/actions/runs/37972566928), Obsidian vault round-trip [37972566943](https://github.com/ashutoshpw/open-obsidian/actions/runs/37972566943), inventory [37972567036](https://github.com/ashutoshpw/open-obsidian/actions/runs/37972567036), loaded-plugin workflows [37972566912](https://github.com/ashutoshpw/open-obsidian/actions/runs/37972566912), desktop build [37972567058](https://github.com/ashutoshpw/open-obsidian/actions/runs/37972567058), quality [37972566921](https://github.com/ashutoshpw/open-obsidian/actions/runs/37972566921), and plugin renderer [37972567030](https://github.com/ashutoshpw/open-obsidian/actions/runs/37972567030) all passed on exact source SHA `5670d5ae84a449a17359c975b676247d38564ad0`. All required Ubuntu, macOS and Windows jobs passed. Run/job IDs, artifacts, digests, toolchain and lockfile hash are in [`evidence/r2.6.73-attempt-2-5670d5a.json`](evidence/r2.6.73-attempt-2-5670d5a.json).

This synthetic egui case does not establish identical Obsidian external-rename behavior. Broader C01/C01.2 acceptance remains pending, and edit/save remains deferred to C02/C14. No local tests, builds, formatters, linters or application launches were run.

The documentation commit `0b2a9d3853203bdf5c6ce173311180333ac36939` passed quality, desktop build, plugin renderer, loaded-plugin workflows, and Rust CI. Inventory [37973480838](https://github.com/ashutoshpw/open-obsidian/actions/runs/37973480838) reported a JSON parse error in the new C01.2 evidence list: the preceding path lacked a comma and the final path had a trailing comma. Those separators were corrected in `requirements.json`. Follow-up inventory [37974137719](https://github.com/ashutoshpw/open-obsidian/actions/runs/37974137719) then identified a missing comma between the `blocker` and `gate_class` fields; that separator is being corrected. The exact-source implementation results above remain valid. The round-trip workflow does not trigger for these documentation-only commits. No local JSON parser or other validation was run.

### R2.6.74 started — C01.2-25 external removal of the final note

C01.2-02 covers external removal while another Markdown note remains, and C01.2-07 covers opening an empty vault. The transition between those states is uncovered: remove the only Markdown note from an active vault that already has link/embed and source-preview state, refresh, and verify that the UI reaches the empty state without retaining stale selection or writing vault/app data. The focused test and matrix row are being added as R2.6.74. Starting source SHA: `7e74b3be437cce9ee29d7782e04c7b6b2641535c`. Broader C01/C01.2 acceptance remains pending. All executable validation will run through GitHub Actions only.

### R2.6.74 attempt 1 — source SHA `632b64c`

The focused workspace test `egui_refresh_after_external_removal_of_last_note_clears_stale_state_without_writing` passed on Ubuntu, macOS and Windows. Rust CI failed only the Ubuntu formatting gate: rustfmt requested a multiline layout for the app-data sentinel write. The same test passed in all three matrix jobs. Obsidian vault round-trip passed on Ubuntu, macOS and Windows; inventory, loaded-plugin workflows, desktop build, quality and plugin renderer also passed. Run/job IDs are in the R2.6.74 entry in `state.json`. The exact GitHub rustfmt diff is applied locally for attempt 2. No local checks were run.

### R2.6.74 attempt 2 — source SHA `03d3cf2`

The focused workspace test passed on Ubuntu, macOS and Windows. Rust CI failed only the Ubuntu formatting gate, where GitHub Actions rustfmt requested a single-line layout for the only-note write; macOS and Windows Rust CI passed. Obsidian vault round-trip passed on all three operating systems, as did inventory, loaded-plugin workflows, desktop build, quality and plugin renderer. Exact run/job IDs are in the R2.6.74 entry in `state.json`; the second exact formatter diff is applied locally for attempt 3. No local checks were run.

The Actions parallel-step request was already satisfied before this slice: commit `c479996995d6774d8ab776f1f61b6d2261592b36` groups independent setup steps in Rust CI, Obsidian round-trip and the reference-runner workflow. The exact-SHA evidence records all seven push workflows plus the manual reference workflow passing, with parallel groups succeeding. Current Rust CI, quality, desktop-build and round-trip workflows also exercise the feature. See `evidence/parallel-ci-runner-setup-c479996.json`; no extra workflow changes are needed.

### R2.6.74 accepted — C01.2-25 — source SHA `898c2df`

The focused workspace test `egui_refresh_after_external_removal_of_last_note_clears_stale_state_without_writing` passed on Ubuntu, macOS and Windows; each `ui-egui` job reported 39 passed tests. The active one-note vault reached its empty state after external note removal and refresh, stale UI state cleared, and vault/app-data snapshots remained unchanged through teardown.

Rust CI [37977661266](https://github.com/ashutoshpw/open-obsidian/actions/runs/37977661266), Obsidian vault round-trip [37977661288](https://github.com/ashutoshpw/open-obsidian/actions/runs/37977661288), inventory [37977661297](https://github.com/ashutoshpw/open-obsidian/actions/runs/37977661297), loaded-plugin workflows [37977661109](https://github.com/ashutoshpw/open-obsidian/actions/runs/37977661109), desktop build [37977661237](https://github.com/ashutoshpw/open-obsidian/actions/runs/37977661237), quality [37977661186](https://github.com/ashutoshpw/open-obsidian/actions/runs/37977661186), and plugin renderer [37977661286](https://github.com/ashutoshpw/open-obsidian/actions/runs/37977661286) all passed on exact source SHA `898c2df7c14cd7cd315012e747f9232f77fa92b1`. Full job IDs, artifact digests, and the two formatting-only failed attempts are recorded in [`evidence/r2.6.74-attempt-3-898c2df.json`](evidence/r2.6.74-attempt-3-898c2df.json). This is synthetic egui coverage and does not certify identical Obsidian external-removal behavior. Broader C01/C01.2 read-only acceptance remains pending. No local tests, builds, formatters, linters or application launches were run.

### R2.6.75 started — C01.2-26 external removal of a rendered attachment

The previous C01.2 cases cover image rendering and external Markdown note removal separately. This slice keeps the Markdown note active while its embedded image is removed externally, then refreshes and resolves it again. The expected UI clears the old report and texture, reports the missing image as unresolved, and preserves the post-removal vault plus separate app-data snapshots through teardown. Starting source SHA: `396a50389d91041977dd67c22b9e75320c21f228`. Exact-SHA GitHub Actions validation is pending; no local tests, builds, formatters, linters, or application launches were run.

### R2.6.75 attempt 1 — source SHA `ee92f4c`

The focused workspace test passed on Ubuntu, macOS, and Windows. Rust CI passed on macOS and Windows but failed Ubuntu's formatting gate for one `assert_eq!` line wrap; Ubuntu workspace tests also passed. Obsidian vault round-trip passed on all three operating systems, as did inventory, loaded-plugin workflows, desktop build, quality, and plugin renderer. The exact Ubuntu rustfmt diff is applied for attempt 2. Run/job IDs are recorded under R2.6.75 in `state.json`. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.75 accepted — C01.2-26 — source SHA `688899c`

The focused workspace test passed on Ubuntu, macOS, and Windows; each `ui-egui` job reported 40 passed tests. After the PNG attachment was removed externally, refresh kept the vault and Markdown note active, cleared stale link/embed/preview/error/texture state, and a fresh resolution reported the embed as unresolved and not rendered. The full post-removal vault and separate app-data snapshots stayed unchanged through refresh, re-resolution, and teardown.

Rust CI [37980471991](https://github.com/ashutoshpw/open-obsidian/actions/runs/37980471991), Obsidian vault round-trip [37980472081](https://github.com/ashutoshpw/open-obsidian/actions/runs/37980472081), inventory [37980472079](https://github.com/ashutoshpw/open-obsidian/actions/runs/37980472079), loaded-plugin workflows [37980472085](https://github.com/ashutoshpw/open-obsidian/actions/runs/37980472085), desktop build [37980472603](https://github.com/ashutoshpw/open-obsidian/actions/runs/37980472603), quality [37980472482](https://github.com/ashutoshpw/open-obsidian/actions/runs/37980472482), and plugin renderer [37980472433](https://github.com/ashutoshpw/open-obsidian/actions/runs/37980472433) all passed on the exact source SHA. Full job IDs, artifact digests, toolchain, and lockfile hash are in [`evidence/r2.6.75-attempt-2-688899c.json`](evidence/r2.6.75-attempt-2-688899c.json). This synthetic egui case does not certify identical Obsidian attachment-removal behavior. Broader C01/C01.2 acceptance remains pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.76 started — C01.2-27 external creation of an embedded attachment

The preceding C01.2 cases cover resolving a present image and invalidating it after external removal. This slice begins with the referenced image missing, then creates it outside OpenObsidian while its note preview is open. Refresh should clear the unresolved report and stale preview state; a fresh resolution should decode and render the new image without writing additional vault or app data. Starting source SHA: `bada4da30965183333781eb41c79f5d203879857`. All executable validation remains GitHub Actions-only.

### R2.6.76 accepted — C01.2-27 — source SHA `3d83472`

The focused workspace test passed on Ubuntu, macOS, and Windows; each `ui-egui` job reported 41 passed tests. The initially missing PNG embed was unresolved and not rendered. After creating the PNG externally and refreshing, stale embed/preview/error/texture state cleared, a fresh resolution decoded and rendered the image with accessible alt text, and the vault plus separate app-data snapshots stayed unchanged through teardown.

Rust CI [37982139127](https://github.com/ashutoshpw/open-obsidian/actions/runs/37982139127), Obsidian vault round-trip [37982139216](https://github.com/ashutoshpw/open-obsidian/actions/runs/37982139216), inventory [37982139132](https://github.com/ashutoshpw/open-obsidian/actions/runs/37982139132), loaded-plugin workflows [37982139167](https://github.com/ashutoshpw/open-obsidian/actions/runs/37982139167), desktop build [37982139171](https://github.com/ashutoshpw/open-obsidian/actions/runs/37982139171), quality [37982139140](https://github.com/ashutoshpw/open-obsidian/actions/runs/37982139140), and plugin renderer [37982139270](https://github.com/ashutoshpw/open-obsidian/actions/runs/37982139270) all passed on the exact source SHA. The native GitHub Actions `parallel` groups used by Rust CI, round-trip, desktop build, and quality also passed in this run; their implementation and initial exact-SHA verification are recorded in [`evidence/parallel-ci-runner-setup-c479996.json`](evidence/parallel-ci-runner-setup-c479996.json). Full job IDs, artifact digests, toolchain, and lockfile hash for this slice are in [`evidence/r2.6.76-attempt-1-3d83472.json`](evidence/r2.6.76-attempt-1-3d83472.json). This synthetic egui case does not certify identical Obsidian external-creation behavior. Broader C01/C01.2 acceptance remains pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.77 started — C01.2-28 external in-place attachment edit

The preceding slices cover external attachment removal and creation. This slice keeps the same PNG path while replacing its bytes outside OpenObsidian, then refreshes and verifies that a fresh report decodes the new dimensions and pixels after stale texture state clears. The one-note vault stays active, the source preview and image are open before the external edit, and the exact post-edit vault plus separate app-data snapshots must remain unchanged through teardown. Starting source SHA: `1bdb32932ab909245607e19991eeec8f8b049ee0`. The test-only PNG encoder uses the existing workspace-pinned `image` crate at version `0.25.10`; no new package or version is selected. Exact-SHA GitHub Actions validation is pending; no local tests, builds, formatters, linters, or application launches were run.

### R2.6.77 attempt 1 — source SHA `85f3a10`

The focused workspace test `egui_refresh_after_external_attachment_edit_reloads_image_without_writing` passed on Ubuntu, macOS, and Windows. Rust CI passed workspace tests on all three OSes but failed Ubuntu's formatting gate for two rustfmt-reported line layouts. Inventory, loaded-plugin workflows, desktop build, quality, and plugin renderer passed. The first Ubuntu Obsidian round-trip attempt failed before the scenario because `xdotool search --onlyvisible --name .` found no visible window; a same-SHA retry passed, and the macOS and Windows round-trip jobs passed. The formatting corrections are applied for a fresh exact-SHA run. Full run/job IDs and artifact digests are in [`evidence/r2.6.77-attempt-1-85f3a10.json`](evidence/r2.6.77-attempt-1-85f3a10.json). All native `parallel:` barriers in the applicable workflows completed. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.77 accepted — C01.2-28 — source SHA `9242b85`

The focused workspace test passed on Ubuntu, macOS, and Windows. The test replaced an already rendered PNG at the same path outside OpenObsidian, refreshed while keeping the vault and note active, cleared stale report/preview/error/texture state, and decoded the replacement dimensions and exact RGBA pixels with accessible alt text. The post-edit vault and separate app-data snapshots remained unchanged through refresh, re-resolution, and teardown.

Rust CI [37985505208](https://github.com/ashutoshpw/open-obsidian/actions/runs/37985505208), Obsidian vault round-trip [37985505288](https://github.com/ashutoshpw/open-obsidian/actions/runs/37985505288), inventory [37985505297](https://github.com/ashutoshpw/open-obsidian/actions/runs/37985505297), loaded-plugin workflows [37985505281](https://github.com/ashutoshpw/open-obsidian/actions/runs/37985505281), desktop build [37985505230](https://github.com/ashutoshpw/open-obsidian/actions/runs/37985505230), quality [37985505242](https://github.com/ashutoshpw/open-obsidian/actions/runs/37985505242), and plugin renderer [37985505325](https://github.com/ashutoshpw/open-obsidian/actions/runs/37985505325) passed on exact source SHA `9242b850106480d7c8e5ee37f0fc3b7aca1dc427`. Native `parallel:` barriers passed in Rust CI, quality, desktop build, and round-trip on their applicable OS matrices. Job IDs, artifact digests and limitations are in [`evidence/r2.6.77-attempt-2-9242b85.json`](evidence/r2.6.77-attempt-2-9242b85.json). This synthetic egui flow does not certify identical Obsidian external in-place attachment-edit behavior. Broader C01/C01.2 acceptance remains pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.77 progress-record validation — source SHA `5a355d9`

The evidence-only progress commit passed Rust CI [37986429695](https://github.com/ashutoshpw/open-obsidian/actions/runs/37986429695), inventory [37986429685](https://github.com/ashutoshpw/open-obsidian/actions/runs/37986429685), desktop build [37986429680](https://github.com/ashutoshpw/open-obsidian/actions/runs/37986429680), plugin renderer [37986429633](https://github.com/ashutoshpw/open-obsidian/actions/runs/37986429633), loaded-plugin workflows [37986429601](https://github.com/ashutoshpw/open-obsidian/actions/runs/37986429601), and quality [37986429600](https://github.com/ashutoshpw/open-obsidian/actions/runs/37986429600) on exact SHA `5a355d933ed696bd1a848154ae1931d176370396`. The first Ubuntu quality job failed because Electron could not find an X server or `$DISPLAY` (job `114009454562`); rerunning quality on the same SHA passed Ubuntu job `114010221813`, with macOS and Windows passing as well. The round-trip workflow was skipped by its documentation-only path filter. This run validates the progress record; R2.6.77 implementation acceptance remains tied to SHA `9242b85`. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.78 started — C01.2-29 external corruption of a rendered attachment

The prior slices cover removing an attachment, creating a missing attachment, and replacing a rendered image with another valid image. This slice keeps the same PNG path but replaces its contents with a deterministic PNG header and IHDR chunk without image data. Refresh should keep the vault and note active, clear stale report/preview/error/texture state, and make a fresh report retain the resolved path while marking the image NotRendered with the safe-preview explanation. The exact post-corruption vault snapshot and separate app-data snapshot must remain unchanged through teardown. Starting source SHA: `5a355d933ed696bd1a848154ae1931d176370396`. Exact-SHA GitHub Actions validation is pending; no local tests, builds, formatters, linters, or application launches were run.

### R2.6.78 attempt 1 — source SHA `a76bbc7`

The focused test did not compile because its expected vault-snapshot tuple used a `u64` length where the helper expects a `u8` file-kind marker. Rust CI [37987381026](https://github.com/ashutoshpw/open-obsidian/actions/runs/37987381026) failed on all three runners with that type error; the five companion workflows passed. The Obsidian round-trip [37987380916](https://github.com/ashutoshpw/open-obsidian/actions/runs/37987380916) was canceled after its Ubuntu dependency-install step remained in progress; its macOS and Windows jobs had passed. See [`evidence/r2.6.78-attempt-1-a76bbc7.json`](evidence/r2.6.78-attempt-1-a76bbc7.json).

### R2.6.78 attempt 2 — source SHA `c5ee057`

After correcting the snapshot tuple, the focused workspace tests passed on Ubuntu, macOS, and Windows. Rust CI [37987798762](https://github.com/ashutoshpw/open-obsidian/actions/runs/37987798762) failed only because Ubuntu rustfmt required the tuple insertion on one line. The five companion workflows passed; the queued round-trip [37987798793](https://github.com/ashutoshpw/open-obsidian/actions/runs/37987798793) was canceled when the next corrective commit superseded this source. See [`evidence/r2.6.78-attempt-2-c5ee057.json`](evidence/r2.6.78-attempt-2-c5ee057.json).

### R2.6.78 accepted — C01.2-29 — source SHA `569ae42`

The focused test `egui_refresh_after_external_attachment_corruption_stops_rendering_without_writing` passed on Ubuntu, macOS, and Windows. It rendered the initial PNG and opened the note source preview, externally replaced the same attachment path with a deterministic PNG signature and complete IHDR chunk without image data, and captured the post-corruption vault snapshot. Refresh kept the vault and note active while clearing stale report/preview/error/texture state. Fresh resolution retained the same attachment path but reported `NotRendered` with the safe-preview explanation and no cached texture. The post-corruption vault snapshot and separate app-data snapshot stayed unchanged through refresh, re-resolution, and teardown.

Rust CI [37988331166](https://github.com/ashutoshpw/open-obsidian/actions/runs/37988331166), Obsidian vault round-trip [37988331415](https://github.com/ashutoshpw/open-obsidian/actions/runs/37988331415), inventory [37988331355](https://github.com/ashutoshpw/open-obsidian/actions/runs/37988331355), loaded-plugin workflows [37988331263](https://github.com/ashutoshpw/open-obsidian/actions/runs/37988331263), desktop build [37988331276](https://github.com/ashutoshpw/open-obsidian/actions/runs/37988331276), quality [37988331168](https://github.com/ashutoshpw/open-obsidian/actions/runs/37988331168), and plugin renderer [37988331434](https://github.com/ashutoshpw/open-obsidian/actions/runs/37988331434) passed on exact source SHA `569ae4241b845937bca3fc30aec9335c11280c76`. Native `parallel:` groups passed in Rust CI, quality, desktop build, and Obsidian round-trip. Job IDs, artifact digests, and attempt details are in [`evidence/r2.6.78-attempt-1-a76bbc7.json`](evidence/r2.6.78-attempt-1-a76bbc7.json), [`evidence/r2.6.78-attempt-2-c5ee057.json`](evidence/r2.6.78-attempt-2-c5ee057.json), and [`evidence/r2.6.78-attempt-3-569ae42.json`](evidence/r2.6.78-attempt-3-569ae42.json). This synthetic egui case does not certify identical Obsidian external-corruption behavior. Broader C01/C01.2 acceptance remains pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.78 evidence-record validation — source SHA `bb3b1a4`

The evidence-only commit passed Rust CI [37989387421](https://github.com/ashutoshpw/open-obsidian/actions/runs/37989387421), inventory [37989387321](https://github.com/ashutoshpw/open-obsidian/actions/runs/37989387321), loaded-plugin workflows [37989387287](https://github.com/ashutoshpw/open-obsidian/actions/runs/37989387287), desktop build [37989387459](https://github.com/ashutoshpw/open-obsidian/actions/runs/37989387459), quality [37989387390](https://github.com/ashutoshpw/open-obsidian/actions/runs/37989387390), and plugin renderer [37989387424](https://github.com/ashutoshpw/open-obsidian/actions/runs/37989387424) on exact SHA `bb3b1a4568b43a0af9df3d4c3524456754adde36`. The Obsidian round-trip workflow was skipped by its documentation-only path filter; implementation acceptance remains tied to exact source SHA `569ae4241b845937bca3fc30aec9335c11280c76`. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.79 started — C01.2-30 external rename of a rendered attachment

This slice checks that an external rename of an attachment does not leave the original embed rendered or redirect it to a different in-vault path. The focused test will open a one-note vault, render `Attachments/photo.png`, open the source preview, rename the file to `Attachments/renamed-photo.png` outside OpenObsidian, and refresh. Refresh should keep the vault and note active while clearing stale report/preview/error/texture state. The fresh report should mark the original path unresolved and NotRendered, and the post-rename vault plus separate app-data snapshots should stay unchanged through teardown. Starting source SHA: `bb3b1a4568b43a0af9df3d4c3524456754adde36`. Exact-SHA GitHub Actions validation is pending; no local tests, builds, formatters, linters, or application launches were run.

### R2.6.79 accepted — C01.2-30 — source SHA `69f5502`

The focused test `egui_refresh_after_external_attachment_rename_clears_stale_embed_without_writing` passed on Ubuntu, macOS, and Windows. It rendered `Attachments/photo.png`, opened the note source preview, renamed the attachment outside OpenObsidian to `Attachments/renamed-photo.png`, and refreshed the active vault. Refresh kept the vault and note active while clearing stale link/embed/preview/error/texture state. Fresh resolution left the original embed unresolved and NotRendered instead of redirecting to the renamed path. The exact post-rename vault snapshot and separate app-data snapshot remained unchanged through refresh, re-resolution, and UI teardown.

Rust CI [37990216225](https://github.com/ashutoshpw/open-obsidian/actions/runs/37990216225), Obsidian vault round-trip [37990216197](https://github.com/ashutoshpw/open-obsidian/actions/runs/37990216197), inventory [37990216175](https://github.com/ashutoshpw/open-obsidian/actions/runs/37990216175), loaded-plugin workflows [37990216293](https://github.com/ashutoshpw/open-obsidian/actions/runs/37990216293), desktop build [37990216267](https://github.com/ashutoshpw/open-obsidian/actions/runs/37990216267), quality [37990216285](https://github.com/ashutoshpw/open-obsidian/actions/runs/37990216285), and plugin renderer [37990216319](https://github.com/ashutoshpw/open-obsidian/actions/runs/37990216319) passed on exact source SHA `69f550253f23e47103b9eae1bd655890a6c9e266`. Native `parallel:` groups passed in Rust CI, quality, desktop build, and Obsidian round-trip. Job IDs, artifact digests, and environment details are in [`evidence/r2.6.79-attempt-1-69f5502.json`](evidence/r2.6.79-attempt-1-69f5502.json). This synthetic egui flow does not certify identical Obsidian external attachment-rename behavior. Broader C01/C01.2 acceptance remains pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.80 started — C01.2-31 path-qualified attachment after external move

This slice checks that an embed with a directory-qualified attachment path does not resolve to a same-basename image moved into another folder. The focused test will render `Attachments/photo.png`, open the note source preview, move the file outside OpenObsidian to `Images/photo.png` while preserving its basename, and refresh. Refresh should keep the vault and note active while clearing stale report/preview/error/texture state. Fresh resolution should leave the original path unresolved and NotRendered; the post-move vault and separate app-data snapshots should remain unchanged through teardown. Starting source SHA: `c575b0f9ff9b8f7f23d2bb11b5fd905031313456`. Exact-SHA GitHub Actions validation is pending; no local tests, builds, formatters, linters, or application launches were run.

### R2.6.80 accepted — C01.2-31 — source SHA `445b4a2`

The focused test `egui_refresh_after_external_attachment_move_does_not_match_same_basename_elsewhere` passed on Ubuntu, macOS, and Windows. It rendered `Attachments/photo.png`, opened the note source preview, moved the image outside OpenObsidian to `Images/photo.png` while preserving its basename, and refreshed the active vault. Refresh kept the vault and note active while clearing stale link/embed/preview/error/texture state. Fresh resolution left the path-qualified original embed unresolved and NotRendered instead of matching the new path by basename. The exact post-move vault snapshot and separate app-data snapshot remained unchanged through refresh, re-resolution, and UI teardown.

Rust CI [37991910574](https://github.com/ashutoshpw/open-obsidian/actions/runs/37991910574), Obsidian vault round-trip [37991910596](https://github.com/ashutoshpw/open-obsidian/actions/runs/37991910596), inventory [37991910462](https://github.com/ashutoshpw/open-obsidian/actions/runs/37991910462), loaded-plugin workflows [37991910545](https://github.com/ashutoshpw/open-obsidian/actions/runs/37991910545), desktop build [37991910590](https://github.com/ashutoshpw/open-obsidian/actions/runs/37991910590), quality [37991910633](https://github.com/ashutoshpw/open-obsidian/actions/runs/37991910633), and plugin renderer [37991910491](https://github.com/ashutoshpw/open-obsidian/actions/runs/37991910491) passed on exact source SHA `445b4a2defcaa13a3811361900c52b752401cb82`. Native `parallel:` groups passed in Rust CI, quality, desktop build, and Obsidian round-trip. Job IDs, artifact digests, and environment details are in [`evidence/r2.6.80-attempt-1-445b4a2.json`](evidence/r2.6.80-attempt-1-445b4a2.json). This synthetic egui flow does not certify identical Obsidian external attachment-move behavior. Broader C01/C01.2 acceptance remains pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.81 started — C01.2-32 external duplicate-basename attachment creation

At starting SHA `53a3106c45c9a5a662c0dfe34d42df7adab2cea2`, selected the basename-only embed transition after R2.6.80 covered path-qualified lookup. The new egui case starts with `![[photo.png]]` resolving to one image, externally adds a second `photo.png` in another vault directory, refreshes, and requires an ambiguous report with both exact candidates, no rendered image, and cleared stale UI state. Full vault and separate app-data snapshots must remain unchanged after the external addition through re-resolution and teardown. Exact-SHA GitHub Actions validation is pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.81 accepted — C01.2-32 — source SHA `6ce0747`

The focused test `egui_refresh_after_external_duplicate_attachment_creation_marks_embed_ambiguous` passed on Ubuntu, macOS, and Windows. The initial basename-only embed resolved and rendered `Attachments/photo.png`; after an external `Images/photo.png` was added, refresh kept the vault and note active and cleared stale link/embed/preview/error/texture state. Fresh resolution reported exactly the two sorted candidates, no target, and `NotRendered` with no cached texture. The post-creation vault snapshot and separate app-data snapshot remained unchanged through refresh, re-resolution, and teardown.

Rust CI [37994023189](https://github.com/ashutoshpw/open-obsidian/actions/runs/37994023189), Obsidian vault round-trip [37994023164](https://github.com/ashutoshpw/open-obsidian/actions/runs/37994023164), inventory [37994023209](https://github.com/ashutoshpw/open-obsidian/actions/runs/37994023209), loaded-plugin workflows [37994023210](https://github.com/ashutoshpw/open-obsidian/actions/runs/37994023210), desktop build [37994023156](https://github.com/ashutoshpw/open-obsidian/actions/runs/37994023156), quality [37994023312](https://github.com/ashutoshpw/open-obsidian/actions/runs/37994023312), and plugin renderer [37994023196](https://github.com/ashutoshpw/open-obsidian/actions/runs/37994023196) passed on exact source SHA `6ce07476f4266161b49df79e1e55ad032e52c9b1`. Job IDs, artifact digests, and limitations are in [`evidence/r2.6.81-attempt-1-6ce0747.json`](evidence/r2.6.81-attempt-1-6ce0747.json). This synthetic egui flow does not certify identical Obsidian behavior for external same-basename creation. Broader C01/C01.2 acceptance remains pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.82 started — C01.2-33 external duplicate-basename attachment removal

Starting from current `origin/main` SHA `4c87ed15e8b18e9aecb697ff40d768e7a0da2e44`, this slice checks the reverse transition from C01.2-32: a basename-only embed is initially ambiguous across `Attachments/photo.png` and `Images/photo.png`; after an external removal of the latter, refresh should clear stale ambiguity and source-preview state, and fresh resolution should render the sole remaining attachment with the expected pixels and alt text. The exact post-removal vault snapshot and separate app-data snapshot must remain unchanged through refresh, re-resolution, and teardown. Exact-SHA GitHub Actions validation is pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.82 accepted — C01.2-33 — source SHA `f6a75a6`

The focused test `egui_refresh_after_external_duplicate_attachment_removal_resolves_embed_without_writing` passed on Ubuntu, macOS, and Windows. Initially, `![[photo.png]]` matched `Attachments/photo.png` and `Images/photo.png`, reported `Ambiguous` with no target, and remained `NotRendered`. After opening the note source preview and externally removing `Images/photo.png`, refresh kept the vault and note active while clearing stale ambiguity and preview state. Fresh resolution uniquely targeted `Attachments/photo.png`; decoded dimensions and RGBA bytes matched the source image, and the alt text was available. The exact post-removal vault snapshot and separate app-data snapshot remained unchanged through refresh, re-resolution, and teardown.

Rust CI [37995942213](https://github.com/ashutoshpw/open-obsidian/actions/runs/37995942213), Obsidian vault round-trip [37995942267](https://github.com/ashutoshpw/open-obsidian/actions/runs/37995942267), inventory [37995942281](https://github.com/ashutoshpw/open-obsidian/actions/runs/37995942281), loaded-plugin workflows [37995942190](https://github.com/ashutoshpw/open-obsidian/actions/runs/37995942190), desktop build [37995942327](https://github.com/ashutoshpw/open-obsidian/actions/runs/37995942327), quality [37995942170](https://github.com/ashutoshpw/open-obsidian/actions/runs/37995942170), and plugin renderer [37995942228](https://github.com/ashutoshpw/open-obsidian/actions/runs/37995942228) passed on exact source SHA `f6a75a6f76555dc91f38f138e0f3b0fd28501a9a`. Job IDs, artifact digests, and limitations are in [`evidence/r2.6.82-attempt-1-f6a75a6.json`](evidence/r2.6.82-attempt-1-f6a75a6.json). This synthetic egui case does not certify identical Obsidian external-removal behavior. Broader C01/C01.2 acceptance remains pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.83 started — C01.2-34 external rename of one duplicate-basename attachment

Starting from current `origin/main` SHA `1cb2fe699dc7eb4324acbdfc8db45b92bdc4304e`, this slice starts with a basename-only embed ambiguous between `Attachments/photo.png` and `Images/photo.png`, then externally renames the latter to `Images/renamed-photo.png`. Refresh should clear stale ambiguity and source-preview state, and fresh resolution should uniquely render `Attachments/photo.png` while retaining the renamed attachment with its exact bytes. The exact post-rename vault snapshot and separate app-data snapshot must remain unchanged through refresh, re-resolution, and teardown. Exact-SHA GitHub Actions validation is pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.83 attempt 1 — source SHA `2c73106`

The focused workspace test `egui_refresh_after_external_duplicate_attachment_rename_resolves_remaining_embed_without_writing` passed on Ubuntu, macOS, and Windows. It confirmed the initially ambiguous state, the external rename, refresh clearing stale UI state, unique rendering of `Attachments/photo.png` with its expected pixels and alt text, and unchanged exact vault/app-data snapshots through teardown. Ubuntu Rust CI failed only because `cargo fmt --all -- --check` requested two formatting changes; the other six required workflows passed, including all three Obsidian round-trip jobs. The Actions-reported formatting changes have been applied and need fresh exact-SHA validation.

Rust CI [37997265353](https://github.com/ashutoshpw/open-obsidian/actions/runs/37997265353) failed its Ubuntu format gate while tests passed on all three operating systems. Obsidian vault round-trip [37997265322](https://github.com/ashutoshpw/open-obsidian/actions/runs/37997265322), inventory [37997265343](https://github.com/ashutoshpw/open-obsidian/actions/runs/37997265343), loaded-plugin workflows [37997265351](https://github.com/ashutoshpw/open-obsidian/actions/runs/37997265351), desktop build [37997265349](https://github.com/ashutoshpw/open-obsidian/actions/runs/37997265349), quality [37997265359](https://github.com/ashutoshpw/open-obsidian/actions/runs/37997265359), and plugin renderer [37997265354](https://github.com/ashutoshpw/open-obsidian/actions/runs/37997265354) passed on exact source SHA `2c73106dd52e838895481e11780d81c7dbd2b658`. Job IDs, artifact digests, and the formatting limitation are recorded in [`evidence/r2.6.83-attempt-1-2c73106.json`](evidence/r2.6.83-attempt-1-2c73106.json). Native parallel groups completed; the second Rust CI parallel barrier reported failure due to the format gate. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.83 attempt 2 — source SHA `80c2508`

The focused workspace test passed on Ubuntu, macOS, and Windows. Rust CI again failed only on Ubuntu rustfmt, this time requesting one additional leading space before the brace under the wrapped test function signature. The six companion workflows passed: the first Obsidian round-trip attempt had its Ubuntu job stalled in dependency installation for more than ten minutes, so it was canceled; the exact-SHA Ubuntu job was rerun and passed, with the macOS and Windows round-trip jobs passing as well. The Actions-reported brace indentation correction has been applied and needs fresh exact-SHA validation.

Rust CI [37997996002](https://github.com/ashutoshpw/open-obsidian/actions/runs/37997996002) failed its Ubuntu format gate while tests passed on all three operating systems. Obsidian vault round-trip [37997995943](https://github.com/ashutoshpw/open-obsidian/actions/runs/37997995943) passed on attempt 2 for exact source SHA `80c2508854b593aff115fd2396df88442a5a9f61`; attempt 1 was canceled only after its Ubuntu dependency-install step remained active for over ten minutes. Inventory [37997995988](https://github.com/ashutoshpw/open-obsidian/actions/runs/37997995988), loaded-plugin workflows [37997995952](https://github.com/ashutoshpw/open-obsidian/actions/runs/37997995952), desktop build [37997996055](https://github.com/ashutoshpw/open-obsidian/actions/runs/37997996055), quality [37997996337](https://github.com/ashutoshpw/open-obsidian/actions/runs/37997996337), and plugin renderer [37997996061](https://github.com/ashutoshpw/open-obsidian/actions/runs/37997996061) passed on the same SHA. Job IDs, artifact digests, both round-trip attempts, and limitations are in [`evidence/r2.6.83-attempt-2-80c2508.json`](evidence/r2.6.83-attempt-2-80c2508.json). Parallel groups passed except the Rust CI Ubuntu group whose downstream barrier reported the format failure. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.83 accepted — C01.2-34 — source SHA `5797966411632b3e9a0def6fe526ccf4c0ca3bcd`

The focused test `egui_refresh_after_external_duplicate_attachment_rename_resolves_remaining_embed_without_writing` passed on Ubuntu, macOS, and Windows. Initially, `![[photo.png|Accessible retained attachment]]` matched `Attachments/photo.png` and `Images/photo.png`, reported `Ambiguous` with no target, and remained `NotRendered`. After opening the note source preview and externally renaming `Images/photo.png` to `Images/renamed-photo.png`, refresh kept the vault and note active while clearing stale ambiguity and preview state. Fresh resolution uniquely targeted `Attachments/photo.png`, rendered its exact decoded pixels with alt text, and retained the renamed file with exact bytes. The exact post-rename vault snapshot and separate app-data snapshot remained unchanged through refresh, re-resolution, and teardown.

Rust CI [37999608331](https://github.com/ashutoshpw/open-obsidian/actions/runs/37999608331), Obsidian vault round-trip [37999608438](https://github.com/ashutoshpw/open-obsidian/actions/runs/37999608438) on attempt 4, inventory [37999608424](https://github.com/ashutoshpw/open-obsidian/actions/runs/37999608424), loaded-plugin workflows [37999608426](https://github.com/ashutoshpw/open-obsidian/actions/runs/37999608426), desktop build [37999608363](https://github.com/ashutoshpw/open-obsidian/actions/runs/37999608363), quality [37999608354](https://github.com/ashutoshpw/open-obsidian/actions/runs/37999608354), and plugin renderer [37999608402](https://github.com/ashutoshpw/open-obsidian/actions/runs/37999608402) passed on exact source SHA `5797966411632b3e9a0def6fe526ccf4c0ca3bcd`. Round-trip attempts 1–3 encountered transient Windows OCR dependency/Chocolatey feed failures, a slow Ubuntu dependency setup, and an Ubuntu missing-visible-window startup failure; attempt 4 passed on all three operating systems. Rust CI's Ubuntu format gate and focused workspace tests passed; native parallel groups passed where configured. Job IDs, artifact digests, retry history, and limitations are in [`evidence/r2.6.83-attempt-3-5797966.json`](evidence/r2.6.83-attempt-3-5797966.json). This synthetic egui flow does not certify identical Obsidian external-rename behavior. Broader C01/C01.2 acceptance remains pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.84 started — C01.2-35 external invalid-UTF-8 note edit

Starting from `origin/main` SHA `746809778e8aa49dd7a3e47a159986a8435a532c`, this slice opens a valid note preview, externally replaces the selected note with invalid UTF-8, refreshes, and verifies the stale preview is cleared and a new preview fails closed with an explicit encoding error. The exact post-edit vault snapshot and separate app-data snapshot must remain unchanged through refresh, failed re-preview, and teardown. Exact-SHA GitHub Actions validation is pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.84 attempt 1 — source SHA `14f883f`

The focused workspace test passed on Ubuntu, macOS, and Windows. Ubuntu Rust CI failed only because `cargo fmt --all -- --check` requested the invalid-UTF-8 assertion be wrapped in its outer `assert!` macro. The six companion workflows passed, including the Obsidian round-trip on all three operating systems. The exact CI-reported formatting reflow is applied and needs fresh exact-SHA validation.

Rust CI [38002656105](https://github.com/ashutoshpw/open-obsidian/actions/runs/38002656105) failed its Ubuntu formatting gate while the workspace tests passed on all three OSes. Obsidian vault round-trip [38002656074](https://github.com/ashutoshpw/open-obsidian/actions/runs/38002656074), inventory [38002656103](https://github.com/ashutoshpw/open-obsidian/actions/runs/38002656103), loaded-plugin workflows [38002656076](https://github.com/ashutoshpw/open-obsidian/actions/runs/38002656076), desktop build [38002656137](https://github.com/ashutoshpw/open-obsidian/actions/runs/38002656137), quality [38002656080](https://github.com/ashutoshpw/open-obsidian/actions/runs/38002656080), and plugin renderer [38002656147](https://github.com/ashutoshpw/open-obsidian/actions/runs/38002656147) passed on exact source SHA `14f883f31726684fd0218927f135f54c657c8af8`. Job IDs, artifact digests, and the format failure are in [`evidence/r2.6.84-attempt-1-14f883f.json`](evidence/r2.6.84-attempt-1-14f883f.json). The Rust Ubuntu downstream parallel barrier reported the format failure; other completed parallel groups passed. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.84 accepted — C01.2-35 — source SHA `bd8d536187cbb46084dc14b9d879f9610d8b727c`

The focused test `egui_refresh_after_external_invalid_utf8_note_edit_clears_stale_preview_without_writing` passed on Ubuntu, macOS, and Windows. It displayed the valid BOM/CRLF source, externally replaced `Notes/Welcome.md` with bytes containing `0xff`, and refreshed while keeping the vault and selected note active and clearing stale preview/error/receiver state. A fresh preview failed closed with the explicit invalid-UTF-8 error and no source. The exact post-edit vault snapshot and separate app-data snapshot remained unchanged through refresh, failed preview, and teardown.

Rust CI [38003199001](https://github.com/ashutoshpw/open-obsidian/actions/runs/38003199001), Obsidian vault round-trip [38003198950](https://github.com/ashutoshpw/open-obsidian/actions/runs/38003198950), inventory [38003198942](https://github.com/ashutoshpw/open-obsidian/actions/runs/38003198942), loaded-plugin workflows [38003198940](https://github.com/ashutoshpw/open-obsidian/actions/runs/38003198940), desktop build [38003198936](https://github.com/ashutoshpw/open-obsidian/actions/runs/38003198936), quality [38003198972](https://github.com/ashutoshpw/open-obsidian/actions/runs/38003198972), and plugin renderer [38003199024](https://github.com/ashutoshpw/open-obsidian/actions/runs/38003199024) passed on exact source SHA `bd8d536187cbb46084dc14b9d879f9610d8b727c`. The Ubuntu formatter gate and focused workspace tests passed; tests passed on all three operating systems. Native parallel groups passed in Rust CI, Obsidian round-trip, desktop build, and quality workflows. Run/job IDs and artifact digests are in [`evidence/r2.6.84-attempt-2-bd8d536.json`](evidence/r2.6.84-attempt-2-bd8d536.json). This synthetic egui scenario does not certify identical Obsidian external invalid-UTF-8 behavior. Broader C01/C01.2 read-only acceptance remains pending. No local executable validation was run.

### R2.6.85 started — C01.2-36 external invalid-UTF-8 repair recovery

Starting from `origin/main` SHA `189c8b30b8c1e6a1eee20acec8b3badd156d15c0`, this slice begins with a valid source preview, externally corrupts the selected note with invalid UTF-8, refreshes, and verifies fail-closed preview behavior. It then externally repairs the same note with new valid UTF-8, refreshes again, and verifies the prior error clears and the repaired bytes preview exactly. The exact post-repair vault snapshot and separate app-data snapshot must remain unchanged through both refreshes, failed and successful previews, and teardown. Exact-SHA GitHub Actions validation is pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.85 accepted — C01.2-36 — source SHA `814881e69db735c2fd253e34a8a890425e10f6c5`

The focused test `egui_refresh_after_external_invalid_utf8_note_repair_recovers_preview_without_writing` passed on Ubuntu, macOS, and Windows. It opened a valid BOM/CRLF note preview, externally replaced the same note with invalid UTF-8, refreshed and verified fail-closed preview behavior, then externally repaired that path with new valid BOM/CRLF bytes. A second refresh cleared the previous error, and the repaired preview matched the exact source bytes and full length. Vault and separate app-data snapshots remained unchanged through both refreshes, failed and successful previews, and UI teardown.

Rust CI [38004753759](https://github.com/ashutoshpw/open-obsidian/actions/runs/38004753759), Obsidian vault round-trip [38004753687](https://github.com/ashutoshpw/open-obsidian/actions/runs/38004753687), inventory [38004753863](https://github.com/ashutoshpw/open-obsidian/actions/runs/38004753863), loaded-plugin workflows [38004753783](https://github.com/ashutoshpw/open-obsidian/actions/runs/38004753783), desktop build [38004753834](https://github.com/ashutoshpw/open-obsidian/actions/runs/38004753834), quality [38004753739](https://github.com/ashutoshpw/open-obsidian/actions/runs/38004753739), and plugin renderer [38004753821](https://github.com/ashutoshpw/open-obsidian/actions/runs/38004753821) all passed on exact source SHA `814881e69db735c2fd253e34a8a890425e10f6c5`. The Ubuntu formatting gate passed; native parallel groups passed in Rust CI, Obsidian round-trip, desktop build, and quality. Job IDs and artifact digests are in [`evidence/r2.6.85-attempt-1-814881e.json`](evidence/r2.6.85-attempt-1-814881e.json). This synthetic egui scenario does not certify identical Obsidian external invalid-UTF-8 repair behavior. Broader C01/C01.2 read-only acceptance remains pending; edit/save remains deferred to C02/C14. No local tests, builds, formatters, linters, or application launches were run.

### R2.6.86 accepted — C01.2-37 — source SHA `4a7bb63a8b2ffc74e6b7058ad6c30050a8d5072b`

Attempt 1 on `d9805f8938cd4f5431950b9d63b40b29f3218e5` passed the focused recovery test on Ubuntu, macOS, and Windows, and six of seven required workflows. Rust CI [38006055863](https://github.com/ashutoshpw/open-obsidian/actions/runs/38006055863) failed only at Ubuntu formatting; its workspace tests passed. The Ubuntu CI diff was applied in the small correction commit `4a7bb63` without running a local formatter.

On exact source SHA `4a7bb63a8b2ffc74e6b7058ad6c30050a8d5072b`, the focused test passed on Ubuntu, macOS, and Windows. Rust CI [38006478173](https://github.com/ashutoshpw/open-obsidian/actions/runs/38006478173), Obsidian vault round-trip [38006478164](https://github.com/ashutoshpw/open-obsidian/actions/runs/38006478164), inventory [38006478175](https://github.com/ashutoshpw/open-obsidian/actions/runs/38006478175), loaded-plugin workflows [38006478158](https://github.com/ashutoshpw/open-obsidian/actions/runs/38006478158), desktop build [38006478223](https://github.com/ashutoshpw/open-obsidian/actions/runs/38006478223), quality [38006478189](https://github.com/ashutoshpw/open-obsidian/actions/runs/38006478189), and plugin renderer [38006478219](https://github.com/ashutoshpw/open-obsidian/actions/runs/38006478219) all passed. The Ubuntu format gate passed; native parallel groups succeeded in Rust CI, round-trip, desktop build, and quality. Job IDs and artifact digests are recorded in [`evidence/r2.6.86-attempt-2-4a7bb63.json`](evidence/r2.6.86-attempt-2-4a7bb63.json). This synthetic egui scenario does not certify identical Obsidian behavior when an external process temporarily relocates the vault root. Broader C01/C01.2 acceptance remains pending; no local tests, builds, formatters, linters, or application launches were run.

### R2.6.86 started — C01.2-37 failed-refresh recovery

Starting from tracker checkpoint SHA `e371aeaba091e2048d85f28e6a9dd8a7baf0ec77`, this slice exercises an active vault root temporarily disappearing during refresh. The UI must report the safe-refresh failure while retaining the existing session, listing, and selected path; a read attempt must fail closed. After the directory returns with an external note update, refresh must clear the prior errors and preview the exact current bytes, while vault and separate app-data snapshots remain unchanged through teardown. The focused test is added to `crates/ui-egui/src/lib.rs`; its exact-source CI validation is pending. No local tests, builds, formatters, linters, or application launches were run.

The R2.6.85 evidence checkpoint on `e371aea` passed inventory [38005602624](https://github.com/ashutoshpw/open-obsidian/actions/runs/38005602624), loaded-plugin workflows [38005602514](https://github.com/ashutoshpw/open-obsidian/actions/runs/38005602514), desktop build [38005602562](https://github.com/ashutoshpw/open-obsidian/actions/runs/38005602562), and plugin renderer [38005602579](https://github.com/ashutoshpw/open-obsidian/actions/runs/38005602579). Quality attempt 1 [38005602573](https://github.com/ashutoshpw/open-obsidian/actions/runs/38005602573) failed on Ubuntu because the legacy Electron audit did not reach its local retrieval boundary; same-SHA attempt 2 passed on all three OSes. The tracker-only push did not trigger Obsidian round-trip because the changed paths are outside that workflow's filter. Rust CI [38005602707](https://github.com/ashutoshpw/open-obsidian/actions/runs/38005602707) was still in progress when this note was written; no next implementation push will supersede it.

Rust CI [38005602707](https://github.com/ashutoshpw/open-obsidian/actions/runs/38005602707) subsequently passed on Ubuntu, macOS, and Windows (jobs `114073553942`, `114073554055`, and `114073554049`). All applicable workflows for the `e371aea` tracker checkpoint are now terminal; Obsidian round-trip remained skipped by its path filter. The exact implementation SHA `814881e69db735c2fd253e34a8a890425e10f6c5` had already passed all seven required workflows. The R2.6.86 source commit can now be pushed for fresh exact-SHA validation.

### R2.7.1 started — SYNC-003 watcher recovery

Starting from `origin/main` SHA `bc7cd91d1ef356340614867ca33c3d2ad39db29d`, this slice adds a pinned `notify = 8.2.0` watcher, one-slot coalesced invalidation hints, root replacement recovery, and a 60-second disk reconciliation in the egui shell. The fixture covers overflow, sleep/missed notifications, and root reconnect; none of those event payloads are treated as authoritative state. The crate is OpenObsidian-specific and records its CC0-1.0 license in `Cargo.toml`. A temporary manual GitHub Actions workflow will resolve the lockfile; after retrieving it, that workflow will be removed in the lockfile/evidence checkpoint. All test and executable validation remains pending GitHub Actions; no local tests, builds, formatters, linters, or application launches were run. `SYNC-003` remains pending until exact-SHA CI passes on Linux, macOS and Windows.

The implementation commit `4717ddcd17b87a47be9962f02edcdb79efeb4525` is pushed. The temporary resolver run [38008451230](https://github.com/ashutoshpw/open-obsidian/actions/runs/38008451230) passed and produced the `Cargo.lock` artifact. Inventory [38008424655](https://github.com/ashutoshpw/open-obsidian/actions/runs/38008424655) identified missing mappings for the new fixture and temporary resolver workflow; the fixture mapping has been added and the resolver removed. The other exact-SHA runs were still pending at this point; their terminal results and the required follow-up are recorded below. This SHA is not accepted; obtain full exact-SHA results after the lockfile correction.

The first source SHA's runs are now terminal. Rust CI [38008424440](https://github.com/ashutoshpw/open-obsidian/actions/runs/38008424440) failed because the committed lockfile did not yet include `notify` and because Ubuntu rustfmt reported layout changes in the new watcher and egui test; those formatting edits are applied exactly from CI output. Obsidian round-trip [38008424427](https://github.com/ashutoshpw/open-obsidian/actions/runs/38008424427) failed on the same stale lockfile. Inventory [38008424655](https://github.com/ashutoshpw/open-obsidian/actions/runs/38008424655) reported the missing mappings for the new fixture and temporary workflow; the fixture is mapped and the temporary workflow is removed. Loaded-plugin workflows [38008424663](https://github.com/ashutoshpw/open-obsidian/actions/runs/38008424663), desktop build [38008424376](https://github.com/ashutoshpw/open-obsidian/actions/runs/38008424376), quality [38008424530](https://github.com/ashutoshpw/open-obsidian/actions/runs/38008424530), and plugin renderer [38008424478](https://github.com/ashutoshpw/open-obsidian/actions/runs/38008424478) passed. The resolver artifact digest is `sha256:2a8a67f52599586584cec864d4d738a5a2275d18daa14e6b7c92f821fd6f3788`; the retrieved lockfile SHA-256 is `6c9cc16121dac77b0992cd6b93281bf71f79eeda9890da554967ec4d0f2dcae5`. The implementation is not accepted because Rust tests and builds did not run. No local executable validation was run.

### R2.7.1 accepted — SYNC-003 — source SHA `a301bfcee01d3a16c812c3eaa0f0859d9109e887`

Rust CI [38008783246](https://github.com/ashutoshpw/open-obsidian/actions/runs/38008783246) failed on `c48b5b49d621f4db0809cae07e28b89c58f3f5fa` because the sleep/reconnect test assumed its refresh receiver would remain present after the first UI frame; the refresh can finish immediately and clear the receiver. The same assertion failed on all three operating systems. The watcher implementation and the other six workflows passed, including the three-platform Obsidian round-trip. Commit `a301bfc` now accepts either an active receiver or the completed refresh status, and still verifies the reconciled note's exact bytes.

On exact source SHA `a301bfcee01d3a16c812c3eaa0f0859d9109e887`, `egui_reconciles_from_disk_after_a_sleep_or_reconnect_gap` and the overflow, root-reconnect, and event-hint watcher tests passed on Ubuntu, macOS, and Windows. Rust CI [38009149073](https://github.com/ashutoshpw/open-obsidian/actions/runs/38009149073), Obsidian vault round-trip [38009149201](https://github.com/ashutoshpw/open-obsidian/actions/runs/38009149201), inventory [38009149082](https://github.com/ashutoshpw/open-obsidian/actions/runs/38009149082), loaded-plugin workflows [38009149129](https://github.com/ashutoshpw/open-obsidian/actions/runs/38009149129), desktop build [38009149092](https://github.com/ashutoshpw/open-obsidian/actions/runs/38009149092), quality [38009149107](https://github.com/ashutoshpw/open-obsidian/actions/runs/38009149107), and plugin renderer [38009149126](https://github.com/ashutoshpw/open-obsidian/actions/runs/38009149126) all passed. Native parallel step groups passed in Rust CI, Obsidian round-trip, desktop build, and quality. Job IDs and artifact digests are recorded in [`evidence/r2.7.1-sync-watcher-a301bfc.json`](evidence/r2.7.1-sync-watcher-a301bfc.json). `SYNC-003` is recorded as passing. No local tests, builds, formatters, linters, or application launches were run.

### R2.7.2 started — C01.2-38 watcher-triggered external-note reconciliation

Starting from `origin/main` SHA `9f8a9f678bd3cd96f7e266a3418dfbefe8ea9f31`, this slice verifies the live notify callback through the native UI: after opening a one-note vault, create a second note outside the app and wait for the filesystem watcher to refresh the listing without pressing Refresh or allowing the 60-second periodic reconciliation to fire. The new note's CRLF source bytes must match exactly, and vault/app-data snapshots must remain unchanged after the external creation through UI teardown. The watcher fixture now includes this external-event case and its inventory hash is updated. Exact-SHA GitHub Actions validation is pending; no local tests, builds, formatters, linters, or application launches were run.

### R2.7.2 accepted — C01.2-38 / SYNC-003 — source SHA `2964c96cea6ad96710ef3a7a0e02eeab4d500776`

The focused test `egui_reconciles_an_external_note_change_from_the_watcher_without_manual_refresh` passed on Ubuntu, macOS, and Windows. With periodic reconciliation delayed for 60 seconds, creating `After.md` outside OpenObsidian caused the live watcher to refresh the open UI automatically. The exact CRLF source was read from the refreshed session, and vault/app-data snapshots stayed unchanged after the external creation through refresh and teardown.

Rust CI [38011050342](https://github.com/ashutoshpw/open-obsidian/actions/runs/38011050342), Obsidian vault round-trip [38011050261](https://github.com/ashutoshpw/open-obsidian/actions/runs/38011050261), inventory [38011050229](https://github.com/ashutoshpw/open-obsidian/actions/runs/38011050229), loaded-plugin workflows [38011050180](https://github.com/ashutoshpw/open-obsidian/actions/runs/38011050180), desktop build [38011050303](https://github.com/ashutoshpw/open-obsidian/actions/runs/38011050303), quality [38011050227](https://github.com/ashutoshpw/open-obsidian/actions/runs/38011050227), and plugin renderer [38011050276](https://github.com/ashutoshpw/open-obsidian/actions/runs/38011050276) all passed on this exact SHA. Native parallel step groups passed in Rust CI, Obsidian round-trip, desktop build, and quality. Job IDs and artifact digests are recorded in [`evidence/r2.7.2-watcher-event-2964c96.json`](evidence/r2.7.2-watcher-event-2964c96.json). `SYNC-003` remains passing; broader C01/C01.2 acceptance remains pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.8.1 started — SYNC-002 interrupted single-file writes

Starting from tracker checkpoint SHA `a8c06b93ba7895b24421df29eefc2ab3638ab4a0`, this slice persists incoming write bytes and the previous revision before journaling `prepared`, then recovers by SHA-256 only when the target is still at the expected revision. It also handles a completed replacement with a missing commit record, retains unresolved write images against history cleanup, surfaces recovery outcomes in the UI, and documents POSIX/Windows and power-loss limits. Fixtures cover crash-before-replace, crash-after-replace, new-file creation, external edits, and the existing multi-file rename rollback case. Implementation and exact-SHA GitHub Actions acceptance are pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.8.1 attempt 1 — source SHA `672995b`

The interrupted-write recovery implementation was pushed in commit `672995b76b95c889afad41b3def3267e1aee6cfa`. Workspace tests passed on Ubuntu, macOS, and Windows, but Rust CI failed Ubuntu formatting and Windows/macOS Clippy. The formatting and owned-comparison findings were corrected in `e98eab193fd55eb4c275a02fac0e4c80b0cc4d97` before accepting the slice. The other six required workflows passed on the initial source SHA, including all three Obsidian round-trip jobs.

### R2.8.1 attempt 2 — source SHA `e98eab1`

The formatter and owned-comparison corrections passed; workspace tests also passed across the OS matrix. Windows Clippy then identified a large `RenameTaskMessage` variant, corrected by boxing the rename result in `c340ff19de41f3266573aa2afc34dee95c06e996`. The first round-trip attempt on this source SHA failed on Ubuntu before the reopen checks because `xdotool` found no visible X11 window. The second Ubuntu retry stalled in dependency setup for over ten minutes and was cancelled; the third same-SHA retry passed, as did macOS and Windows. This environment retry did not change source code.

### R2.8.1 accepted — SYNC-002 — source SHA `c340ff1`

On exact source SHA `c340ff19de41f3266573aa2afc34dee95c06e996`, the interrupted-write fixture, `VaultSession` startup recovery, and existing multi-file rename recovery tests passed on Ubuntu, macOS, and Windows. The Windows-only case-only rename recovery test passed on Windows. Rust CI also passed formatting, Clippy, dependency-layer checks, and native preview builds on all three systems.

All seven required GitHub Actions workflows passed on the exact SHA: Rust CI [38014303728](https://github.com/ashutoshpw/open-obsidian/actions/runs/38014303728), Obsidian vault round-trip [38014303720](https://github.com/ashutoshpw/open-obsidian/actions/runs/38014303720), inventory [38014303759](https://github.com/ashutoshpw/open-obsidian/actions/runs/38014303759), loaded-plugin workflows [38014303738](https://github.com/ashutoshpw/open-obsidian/actions/runs/38014303738), desktop build [38014303713](https://github.com/ashutoshpw/open-obsidian/actions/runs/38014303713), quality [38014303715](https://github.com/ashutoshpw/open-obsidian/actions/runs/38014303715), and plugin renderer [38014303734](https://github.com/ashutoshpw/open-obsidian/actions/runs/38014303734). Job IDs, artifact digests, test names, and limits are recorded in [`evidence/r2.8.1-interrupted-write-c340ff1.json`](evidence/r2.8.1-interrupted-write-c340ff1.json). SYNC-002 is passing. Broader R2 filesystem and C01/C01.2 acceptance remain pending.

The fixture injects persisted restart states in generated synthetic vaults; it does not simulate hardware power loss or certify identical replacement semantics on every filesystem. The atomic-write fixture states the Windows and power-loss limits without a universal atomicity claim. No local tests, builds, formatters, linters, or application launches were run.

### R2.8.2 started — SYNC-001 concurrent edit merge

Starting from tracker checkpoint SHA `d9c6c3877f7d9cd6775cd91cdac6895a4e9c4155`, this slice adds a conservative byte-preserving three-way merge for disjoint edits to existing lines. It uses the editor base, incoming edit, and current revision; structural changes, overlapping edits, divergent binary or invalid text, and deleted current files remain explicit conflicts. Conflict handling preserves the complete incoming revision and leaves the current version intact. The fixture covers mixed line endings, BOM, safe edits, overlapping edits, insertions, binary divergence, and deletion without resurrection. No local tests, builds, formatters, linters, or application launches were run.

### R2.8.2 attempts 1–2 — source SHAs `3f6932c` and `b2bb5ef`

Workspace tests passed except for a transient, timing-sensitive existing macOS egui refresh assertion on the first exact-SHA run; its same-SHA retry passed. Rust CI's Ubuntu format gate reported formatting corrections, which were applied from CI output. Both first two source SHAs encountered the same Ubuntu Obsidian round-trip startup issue: no visible X11 window before the UI checks. macOS and Windows round-trip jobs passed, and inventory, loaded-plugin, desktop, quality, and renderer workflows passed on both attempts. The Linux UI retry was made on the final source SHA.

### R2.8.2 accepted — SYNC-001 — source SHA `638ba85dd94826b77623a43709d458d13fa1c1e7`

On the final exact source SHA, the focused merge and fixture tests passed on Ubuntu, macOS, and Windows. Safe disjoint same-count edits preserve bytes, including mixed line endings and BOM. The algorithm reports overlapping or structural edits and divergent binary/invalid UTF-8 as conflicts, preserves complete incoming bytes in conflict history, and does not resurrect a file deleted externally.

All seven required GitHub Actions workflows passed on exact SHA `638ba85dd94826b77623a43709d458d13fa1c1e7`: Rust CI [38016971227](https://github.com/ashutoshpw/open-obsidian/actions/runs/38016971227), Obsidian vault round-trip [38016971276](https://github.com/ashutoshpw/open-obsidian/actions/runs/38016971276), inventory [38016971245](https://github.com/ashutoshpw/open-obsidian/actions/runs/38016971245), loaded-plugin workflows [38016971273](https://github.com/ashutoshpw/open-obsidian/actions/runs/38016971273), desktop build [38016971234](https://github.com/ashutoshpw/open-obsidian/actions/runs/38016971234), quality [38016971252](https://github.com/ashutoshpw/open-obsidian/actions/runs/38016971252), and plugin renderer [38016971244](https://github.com/ashutoshpw/open-obsidian/actions/runs/38016971244). Every applicable Ubuntu, macOS, and Windows job passed. Job IDs, preview artifact digests, focused test names, retry history, and limits are recorded in [`evidence/r2.8.2-revision-merge-638ba85.json`](evidence/r2.8.2-revision-merge-638ba85.json). `SYNC-001` is passing. Editor UI integration and broader R2/C01/C01.2 acceptance remain pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.8.3 started — SYNC-004 disk-full and permission-loss cases

Starting from tracker checkpoint SHA `bd7e88355c5be0a4470c39918334eba51ba4c77c`, this slice makes the existing failure matrix executable in Rust for its disk-full-before-temporary-write and permission-loss-before-replacement cases. Each case must retain the original vault bytes, the incoming bytes in failed history and recovery history, remove any target temporary, and write a failed journal terminal state. The matrix's other nine scenarios remain pending. Implementation and exact-SHA GitHub Actions validation are pending. No local code tests, builds, formatters, linters, or application launches were run. During preparation, local JSON parsing/schema queries and `git diff --check` were run; they are not acceptance evidence, and the fixture query and whitespace check exceeded the goal's CI-only validation path. All implementation and fixture acceptance will be decided from GitHub Actions only.

### R2.8.3 CI attempt 1 — source SHA `7b945d0f52a4ab891aeeeb95a51d45bb76a52546`

The focused `failure_matrix_preserves_all_versions_for_disk_full_and_permission_loss` test and full Rust workspace tests passed on Ubuntu. Rust CI failed only its Ubuntu rustfmt gate, which identified a one-line assertion layout; macOS Rust CI passed. Obsidian vault round-trip, inventory, plugin renderer, desktop build, loaded-plugin workflows and quality all passed on this exact SHA. Parallel step groups completed successfully in the round-trip, desktop-build and quality runs; the Rust CI test/format group also ran to completion, with only formatting failing. Runs: Rust CI [38018097195](https://github.com/ashutoshpw/open-obsidian/actions/runs/38018097195), Obsidian vault round-trip [38018097295](https://github.com/ashutoshpw/open-obsidian/actions/runs/38018097295), inventory [38018097275](https://github.com/ashutoshpw/open-obsidian/actions/runs/38018097275), plugin renderer [38018097271](https://github.com/ashutoshpw/open-obsidian/actions/runs/38018097271), desktop build [38018097191](https://github.com/ashutoshpw/open-obsidian/actions/runs/38018097191), loaded-plugin workflows [38018097226](https://github.com/ashutoshpw/open-obsidian/actions/runs/38018097226), and quality [38018097239](https://github.com/ashutoshpw/open-obsidian/actions/runs/38018097239). The formatter correction is taken directly from the GitHub log; no local formatter or executable validation was run.

### R2.8.3 CI attempt 2 — source SHA `8699a70a5da23deddb4a82b4f90bc937ce54173f`

Six of seven workflows passed: vault round-trip on Ubuntu/macOS/Windows, inventory, plugin renderer, desktop build, loaded-plugin workflows and quality. Rust CI passed on macOS and Windows, and workspace tests passed on all three OSes, including `failure_matrix_preserves_all_versions_for_disk_full_and_permission_loss`; Ubuntu Rust CI failed only rustfmt. Its exact diff requires the macro call and first argument to wrap as shown by the runner. Runs: Rust CI [38018517675](https://github.com/ashutoshpw/open-obsidian/actions/runs/38018517675), Obsidian vault round-trip [38018517670](https://github.com/ashutoshpw/open-obsidian/actions/runs/38018517670), inventory [38018517648](https://github.com/ashutoshpw/open-obsidian/actions/runs/38018517648), plugin renderer [38018517668](https://github.com/ashutoshpw/open-obsidian/actions/runs/38018517668), desktop build [38018517646](https://github.com/ashutoshpw/open-obsidian/actions/runs/38018517646), loaded-plugin workflows [38018517678](https://github.com/ashutoshpw/open-obsidian/actions/runs/38018517678), and quality [38018517652](https://github.com/ashutoshpw/open-obsidian/actions/runs/38018517652). The next correction follows that CI diff; no local formatter or executable validation was run.

### R2.8.3 accepted — SYNC-004 disk-full and permission-loss slice — source SHA `c3127faf3ad3601f6d7bed67b08b3ac7173e99dd`

The focused test `tests::failure_matrix_preserves_all_versions_for_disk_full_and_permission_loss` passed with the full workspace tests on Ubuntu, macOS, and Windows. Rust CI also passed formatting on Ubuntu, Clippy, dependency layering, native preview builds, and unchanged-plugin feasibility probes on all three platforms. All seven required workflows passed on this exact SHA: Rust CI [38018867912](https://github.com/ashutoshpw/open-obsidian/actions/runs/38018867912), Obsidian vault round-trip [38018867953](https://github.com/ashutoshpw/open-obsidian/actions/runs/38018867953), inventory [38018867935](https://github.com/ashutoshpw/open-obsidian/actions/runs/38018867935), loaded-plugin workflows [38018867922](https://github.com/ashutoshpw/open-obsidian/actions/runs/38018867922), desktop build [38018867939](https://github.com/ashutoshpw/open-obsidian/actions/runs/38018867939), quality [38018867928](https://github.com/ashutoshpw/open-obsidian/actions/runs/38018867928), and plugin renderer [38018867956](https://github.com/ashutoshpw/open-obsidian/actions/runs/38018867956). The parallel `steps` feature from the linked GitHub changelog is already implemented in this repository's independent CI groups; these exact-SHA runs exercised those groups successfully. No redundant groups were added to workflows whose steps have dependencies or only one executable check. Artifact IDs, SHA-256 digests, job IDs, attempts and limitations are recorded in [`evidence/r2.8.3-sync-failure-matrix-c3127fa.json`](evidence/r2.8.3-sync-failure-matrix-c3127fa.json). This slice covers two of eleven `SYNC-004` scenarios; the other nine, aggregate SYNC-004, editor integration, and broader C01/C01.2 acceptance remain pending. The earlier documented local JSON/schema parsing and `git diff --check` policy deviation remains excluded from acceptance evidence.

### R2.8.4 started — SYNC-004 partial multi-file sync

Starting from tracker checkpoint SHA `1b0cb46f37abae8b0b42759b9e1be357faacd84d`, this slice adds ordered revision-checked batch writes to `VaultStore`. The batch record and each constituent file record retain their outcomes, including an earlier committed file when a later replacement fails. The expanded fixture requires both original and incoming versions to survive for each file. Exact-SHA GitHub Actions acceptance is pending; all executable validation remains CI-only.

### R2.8.4 attempt 1 — source SHA `d17cc084cbfcdd6a7dc918c88202dcac28989cf7`

The focused `partial_sync_matrix_journals_partial_application_and_preserves_each_version` test and full Rust workspace tests passed on Ubuntu, macOS, and Windows. Rust CI [38020656241](https://github.com/ashutoshpw/open-obsidian/actions/runs/38020656241) passed macOS and Windows; Ubuntu failed only rustfmt, whose exact changes are applied in the follow-up. Vault round-trip [38020656177](https://github.com/ashutoshpw/open-obsidian/actions/runs/38020656177) passed macOS and Windows; Ubuntu failed before the round-trip because `xdotool search --onlyvisible --name .` found no visible window. Inventory [38020656282](https://github.com/ashutoshpw/open-obsidian/actions/runs/38020656282), loaded-plugin workflows [38020656235](https://github.com/ashutoshpw/open-obsidian/actions/runs/38020656235), desktop build [38020656175](https://github.com/ashutoshpw/open-obsidian/actions/runs/38020656175), quality [38020656144](https://github.com/ashutoshpw/open-obsidian/actions/runs/38020656144), and plugin renderer [38020656147](https://github.com/ashutoshpw/open-obsidian/actions/runs/38020656147) passed. No local formatter or executable validation was run.

### R2.8.4 accepted — SYNC-004 partial multi-file sync — source SHA `e031fd9b9eb838401e8aeb4f649aace26d10c384`

The focused test `tests::partial_sync_matrix_journals_partial_application_and_preserves_each_version` and full workspace tests passed on Ubuntu, macOS, and Windows. Rust CI [38021042763](https://github.com/ashutoshpw/open-obsidian/actions/runs/38021042763), Obsidian vault round-trip [38021042752](https://github.com/ashutoshpw/open-obsidian/actions/runs/38021042752), inventory [38021042753](https://github.com/ashutoshpw/open-obsidian/actions/runs/38021042753), loaded-plugin workflows [38021042778](https://github.com/ashutoshpw/open-obsidian/actions/runs/38021042778), desktop build [38021042758](https://github.com/ashutoshpw/open-obsidian/actions/runs/38021042758), quality [38021042762](https://github.com/ashutoshpw/open-obsidian/actions/runs/38021042762), and plugin renderer [38021042750](https://github.com/ashutoshpw/open-obsidian/actions/runs/38021042750) all passed on this exact source SHA. Native parallel step groups also completed successfully in Rust CI, vault round-trip, desktop build, and quality. Job IDs, artifact IDs and digests, tool versions, and the prior CI attempt are in [`evidence/r2.8.4-sync-failure-matrix-e031fd9.json`](evidence/r2.8.4-sync-failure-matrix-e031fd9.json). The slice completes three of eleven `SYNC-004` scenarios; eight remain, and full SYNC-004, editor integration, and broader C01/C01.2 acceptance remain pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.8.5 started — SYNC-004 concurrent edit

Starting from tracker checkpoint SHA `2370ecd86f258af6746ebca7c861a3ebbf456dec`, this slice makes the stale-write conflict path an executable failure-matrix case. The fixture models an external edit after the caller reads its base revision; the expected outcome preserves the current vault bytes, records the incoming editor version as a protected conflict, and journals the conflict state. Exact-SHA GitHub Actions acceptance is pending; executable validation remains CI-only.

### R2.8.5 attempt 1 — source SHA `d5e979a9429659eabd0cd58a06df6c9df050ab20`

The focused `tests::concurrent_edit_matrix_preserves_external_target_and_incoming_conflict` test and full Rust workspace tests passed on Ubuntu, macOS, and Windows. Rust CI [38021865918](https://github.com/ashutoshpw/open-obsidian/actions/runs/38021865918) passed macOS and Windows; Ubuntu failed only rustfmt, with the formatter diff applied in the follow-up. Obsidian vault round-trip [38021865933](https://github.com/ashutoshpw/open-obsidian/actions/runs/38021865933), inventory [38021866043](https://github.com/ashutoshpw/open-obsidian/actions/runs/38021866043), plugin renderer [38021865915](https://github.com/ashutoshpw/open-obsidian/actions/runs/38021865915), loaded-plugin workflows [38021865912](https://github.com/ashutoshpw/open-obsidian/actions/runs/38021865912), desktop build [38021865907](https://github.com/ashutoshpw/open-obsidian/actions/runs/38021865907), and quality [38021865966](https://github.com/ashutoshpw/open-obsidian/actions/runs/38021865966) passed. No local formatter or executable validation was run.

### R2.8.5 accepted — SYNC-004 concurrent edit — source SHA `2989c5659a8324ecc7f4aaf53c51122a12b57272`

The focused test `tests::concurrent_edit_matrix_preserves_external_target_and_incoming_conflict` and full Rust workspace tests passed on Ubuntu, macOS, and Windows. Rust CI [38022153278](https://github.com/ashutoshpw/open-obsidian/actions/runs/38022153278), Obsidian vault round-trip [38022153277](https://github.com/ashutoshpw/open-obsidian/actions/runs/38022153277), inventory [38022153251](https://github.com/ashutoshpw/open-obsidian/actions/runs/38022153251), loaded-plugin workflows [38022153236](https://github.com/ashutoshpw/open-obsidian/actions/runs/38022153236), desktop build [38022153233](https://github.com/ashutoshpw/open-obsidian/actions/runs/38022153233), quality [38022153259](https://github.com/ashutoshpw/open-obsidian/actions/runs/38022153259), and plugin renderer [38022153244](https://github.com/ashutoshpw/open-obsidian/actions/runs/38022153244) all passed on this exact source SHA; quality passed on attempt 2 after its first Ubuntu Electron vault audit failed before local retrieval. Native parallel step groups completed successfully. Job IDs, artifact IDs and digests, tool versions, and prior attempts are recorded in [`evidence/r2.8.5-sync-failure-matrix-2989c56.json`](evidence/r2.8.5-sync-failure-matrix-2989c56.json). Four of eleven `SYNC-004` scenarios are now covered; seven remain, and full SYNC-004, editor integration, and broader C01/C01.2 acceptance remain pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.8.6 started — SYNC-004 delete versus edit

Starting from tracker checkpoint SHA `789108eaf6bbed5279397b8ef601da162848326f`, this slice makes a stale write after an external deletion an executable failure-matrix case. It preserves the incoming edit as a protected conflict, records the conflict, and leaves the deleted path absent so the local edit does not silently resurrect it. Exact-SHA GitHub Actions acceptance is pending; executable validation remains CI-only.

### R2.8.6 accepted — SYNC-004 delete versus edit — source SHA `c36954bd4ff4f4ecb5b34263ccd24a59ab63650e`

The focused test `tests::delete_edit_matrix_preserves_incoming_conflict_without_resurrection` and full Rust workspace tests passed on Ubuntu, macOS, and Windows. Rust CI [38022975922](https://github.com/ashutoshpw/open-obsidian/actions/runs/38022975922), Obsidian vault round-trip [38022975851](https://github.com/ashutoshpw/open-obsidian/actions/runs/38022975851), inventory [38022975852](https://github.com/ashutoshpw/open-obsidian/actions/runs/38022975852), loaded-plugin workflows [38022975810](https://github.com/ashutoshpw/open-obsidian/actions/runs/38022975810), desktop build [38022975845](https://github.com/ashutoshpw/open-obsidian/actions/runs/38022975845), quality [38022975843](https://github.com/ashutoshpw/open-obsidian/actions/runs/38022975843), and plugin renderer [38022975824](https://github.com/ashutoshpw/open-obsidian/actions/runs/38022975824) all passed on this exact source SHA. The GitHub Actions log confirms the focused test passed on all three Rust CI platforms. Native parallel step groups completed successfully. Job IDs, artifact IDs and digests, tool versions, and acceptance limits are recorded in [`evidence/r2.8.6-sync-failure-matrix-c36954b.json`](evidence/r2.8.6-sync-failure-matrix-c36954b.json). Five of eleven `SYNC-004` scenarios now have executable coverage; six remain, and full SYNC-004, editor integration, and broader C01/C01.2 acceptance remain pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.8.7 started — SYNC-004 rename versus edit

Starting from tracker checkpoint SHA `1c6a300b461ff42749c971e1a221d26ef006c2bc`, this slice models an external rename after the editor reads the source revision and before it submits its edit. The stale edit must not recreate the old path or disturb the renamed file; its bytes remain readable in protected conflict history, with a conflict journal entry. Exact-SHA GitHub Actions acceptance is pending, and executable validation remains CI-only.

### R2.8.7 accepted — SYNC-004 rename versus edit — source SHA `e4231593c9f19e3110ca594d8241db98c963ff5f`

The focused test `tests::rename_edit_matrix_preserves_external_move_and_incoming_conflict` and full Rust workspace tests passed on Ubuntu, macOS, and Windows. Rust CI [38023644444](https://github.com/ashutoshpw/open-obsidian/actions/runs/38023644444), inventory [38023644299](https://github.com/ashutoshpw/open-obsidian/actions/runs/38023644299), loaded-plugin workflows [38023644284](https://github.com/ashutoshpw/open-obsidian/actions/runs/38023644284), desktop build [38023644310](https://github.com/ashutoshpw/open-obsidian/actions/runs/38023644310), quality [38023644297](https://github.com/ashutoshpw/open-obsidian/actions/runs/38023644297), and plugin renderer [38023644314](https://github.com/ashutoshpw/open-obsidian/actions/runs/38023644314) passed on the exact source SHA. Obsidian vault round-trip [38023644309](https://github.com/ashutoshpw/open-obsidian/actions/runs/38023644309) passed on attempt 2; its first Ubuntu attempt failed at `xdotool search --onlyvisible --name .` before completing the UI flow, while macOS and Windows passed. The focused Rust test passed on all three platforms. Native parallel step groups completed successfully. Job IDs, artifact digests, prior attempt details, tool versions, and acceptance limits are in [`evidence/r2.8.7-sync-failure-matrix-e423159.json`](evidence/r2.8.7-sync-failure-matrix-e423159.json). Six of eleven `SYNC-004` scenarios now have executable coverage; five remain, and full SYNC-004, editor integration, and broader C01/C01.2 acceptance remain pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.8.8 started — SYNC-004 symlink traversal

Starting from tracker checkpoint SHA `3a99c3578dde83e76f5a4c58591b7069bdb59ac4`, this slice expands the symlink case into fixture-driven coverage on macOS, Windows, and Linux. Vault snapshots must record the link target, while reads and writes through a link to a file outside the vault must be rejected without changing the outside file. Exact-SHA GitHub Actions acceptance is pending; executable validation remains CI-only.

### R2.8.8 attempt 1 — source SHA `238c10399809126532e873ac65910adb811716c9`

The focused symlink test and full workspace tests passed on Ubuntu, macOS, and Windows. Rust CI [38024469346](https://github.com/ashutoshpw/open-obsidian/actions/runs/38024469346) failed only the Ubuntu rustfmt gate, which reported two formatting-only changes in `crates/vault/src/lib.rs`. Inventory [38024469328](https://github.com/ashutoshpw/open-obsidian/actions/runs/38024469328), loaded-plugin workflows [38024469355](https://github.com/ashutoshpw/open-obsidian/actions/runs/38024469355), desktop build [38024469338](https://github.com/ashutoshpw/open-obsidian/actions/runs/38024469338), quality [38024469424](https://github.com/ashutoshpw/open-obsidian/actions/runs/38024469424), plugin renderer [38024469350](https://github.com/ashutoshpw/open-obsidian/actions/runs/38024469350), and vault round-trip [38024469406](https://github.com/ashutoshpw/open-obsidian/actions/runs/38024469406) passed. The exact formatting diff was applied from the GitHub Actions log in source commit `f10243984108a56c7ccb6fdd71273c55c2003302`; no local formatter or executable validation was run.

### R2.8.8 accepted — SYNC-004 symlink traversal — source SHA `f10243984108a56c7ccb6fdd71273c55c2003302`

The focused test `tests::symlink_matrix_records_link_and_denies_read_write_traversal` and full Rust workspace tests passed on Ubuntu, macOS, and Windows. Rust CI [38024752878](https://github.com/ashutoshpw/open-obsidian/actions/runs/38024752878), vault round-trip [38024752854](https://github.com/ashutoshpw/open-obsidian/actions/runs/38024752854), inventory [38024752895](https://github.com/ashutoshpw/open-obsidian/actions/runs/38024752895), loaded-plugin workflows [38024752885](https://github.com/ashutoshpw/open-obsidian/actions/runs/38024752885), desktop build [38024752836](https://github.com/ashutoshpw/open-obsidian/actions/runs/38024752836), quality [38024752840](https://github.com/ashutoshpw/open-obsidian/actions/runs/38024752840), and plugin renderer [38024752873](https://github.com/ashutoshpw/open-obsidian/actions/runs/38024752873) all passed on this exact source SHA. Native parallel step groups also passed. Job IDs, artifact digests, tool versions, the rustfmt follow-up, and limits are recorded in [`evidence/r2.8.8-sync-failure-matrix-f102439.json`](evidence/r2.8.8-sync-failure-matrix-f102439.json). Seven of eleven `SYNC-004` scenarios now have executable coverage; four remain, and full SYNC-004, editor integration, and broader C01/C01.2 acceptance remain pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.8.9 started — SYNC-004 cloud placeholder

Starting from tracker checkpoint SHA `c3a2aed08ad7e6bff6d943070205bb2a578d94de`, this slice makes an unknown cloud-provider URI an executable failure-matrix case. The vault link resolver must classify the URI as external without assigning a local target or candidate path. Exact-SHA GitHub Actions acceptance is pending; executable validation remains CI-only.

### R2.8.9 accepted — SYNC-004 cloud placeholder — source SHA `23480420323466c3d8996889a21b0624f677a081`

The focused test `tests::cloud_placeholder_matrix_does_not_resolve_unknown_uri_as_vault_path` and full Rust workspace tests passed on Ubuntu, macOS, and Windows. Rust CI [38025389089](https://github.com/ashutoshpw/open-obsidian/actions/runs/38025389089), vault round-trip [38025389109](https://github.com/ashutoshpw/open-obsidian/actions/runs/38025389109), inventory [38025389136](https://github.com/ashutoshpw/open-obsidian/actions/runs/38025389136), loaded-plugin workflows [38025389028](https://github.com/ashutoshpw/open-obsidian/actions/runs/38025389028), desktop build [38025389001](https://github.com/ashutoshpw/open-obsidian/actions/runs/38025389001), quality [38025389033](https://github.com/ashutoshpw/open-obsidian/actions/runs/38025389033), and plugin renderer [38025389047](https://github.com/ashutoshpw/open-obsidian/actions/runs/38025389047) all passed on this exact source SHA. Native parallel step groups completed successfully. Job IDs, artifact digests, tool versions, and limits are recorded in [`evidence/r2.8.9-sync-failure-matrix-2348042.json`](evidence/r2.8.9-sync-failure-matrix-2348042.json). Eight of eleven `SYNC-004` scenarios now have executable coverage; three remain, and full SYNC-004, editor integration, and broader C01/C01.2 acceptance remain pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.8.10 started — SYNC-004 case-only rename

Starting from current `origin/main` checkpoint `c7c04ec0198505f9def5ef0d1a426533ba8bc94d`, whose seven GitHub Actions workflows passed, this slice adds Windows-only fixture-backed coverage for `Notes/Title.md` to `Notes/title.md`. The renamed entry must preserve its BOM/CRLF bytes and SHA-256 revision, avoid a content replacement, and journal `case_only: true` with state `committed`. Exact-SHA implementation CI is pending; executable validation remains GitHub Actions only.

### R2.8.10 accepted — SYNC-004 case-only rename — source SHA `d286305aa68e958b03ca8f42f5fe2e49d5a6ea8b`

The focused test `tests::case_only_rename_matrix_preserves_content_revision_and_commits_path_change` passed in the Windows Rust CI job, and full workspace tests passed on Ubuntu, macOS, and Windows. Rust CI [38026631734](https://github.com/ashutoshpw/open-obsidian/actions/runs/38026631734), Obsidian vault round-trip [38026631729](https://github.com/ashutoshpw/open-obsidian/actions/runs/38026631729), inventory [38026631748](https://github.com/ashutoshpw/open-obsidian/actions/runs/38026631748), loaded-plugin workflows [38026631727](https://github.com/ashutoshpw/open-obsidian/actions/runs/38026631727), desktop build [38026631725](https://github.com/ashutoshpw/open-obsidian/actions/runs/38026631725), quality [38026631726](https://github.com/ashutoshpw/open-obsidian/actions/runs/38026631726), and plugin renderer [38026631747](https://github.com/ashutoshpw/open-obsidian/actions/runs/38026631747) all passed on this exact source SHA. The Windows log reports the focused test as `... ok`; the test checks the actual case-preserved path, exact BOM/CRLF bytes, unchanged revision, failed replacement hook, and committed journal with `case_only: true`. Job IDs, artifact digests, tool versions, and limitations are recorded in [`evidence/r2.8.10-sync-failure-matrix-d286305.json`](evidence/r2.8.10-sync-failure-matrix-d286305.json). Nine of eleven SYNC-004 scenarios now have executable Rust coverage; Windows reserved names and Unicode normalization remain, and aggregate SYNC-004, editor integration, and broader C01/C01.2 acceptance remain pending. No local tests, builds, formatters, linters, or application launches were run.


### R2.8.10 tracker checkpoint — SHA `68045d0539fcdd93403b1f5bdcbac4ef3a5ba7e2`

The R2.8.10 source commit `d286305aa68e958b03ca8f42f5fe2e49d5a6ea8b` passed all seven required workflows. The tracker checkpoint is now on `origin/main`; its six path-eligible workflows passed: Rust CI [38027130993](https://github.com/ashutoshpw/open-obsidian/actions/runs/38027130993), vault round-trip (path-filtered off; already passed on source SHA `d286305`), inventory [38027131049](https://github.com/ashutoshpw/open-obsidian/actions/runs/38027131049), loaded-plugin workflows [38027130966](https://github.com/ashutoshpw/open-obsidian/actions/runs/38027130966), desktop build [38027131040](https://github.com/ashutoshpw/open-obsidian/actions/runs/38027131040), quality [38027130962](https://github.com/ashutoshpw/open-obsidian/actions/runs/38027130962), and plugin renderer [38027131012](https://github.com/ashutoshpw/open-obsidian/actions/runs/38027131012).

### R2.8.11 started — SYNC-004 Windows-reserved paths

Starting from tracker checkpoint SHA `68045d0539fcdd93403b1f5bdcbac4ef3a5ba7e2`, this slice rejects Windows reserved device names, numbered aliases, trailing dots/spaces, and colon streams in the Rust vault path validator. Its Windows-only fixture test checks both reads and writes and verifies that a valid BOM/CRLF file remains unchanged with no journal entries. Exact-SHA GitHub Actions acceptance is pending; executable validation remains GitHub Actions only. The fixture SHA-256 is `31a24ca1b51874a4027e44267d049d2e2cf9a266a3844f1cdad3baa3119f90b0`.


### R2.8.11 CI attempt 1 — source SHA `664d76fd8ee74a593f45a8159450462acdaa55e4`

Workspace tests passed on Ubuntu, macOS, and Windows; the Windows Rust log reports `tests::windows_reserved_name_matrix_denies_reads_and_writes_without_mutating_vault ... ok`. The vault round-trip, inventory, loaded-plugin workflows, desktop build, quality, and plugin renderer workflows also passed on this exact SHA. Rust CI [38027767712](https://github.com/ashutoshpw/open-obsidian/actions/runs/38027767712) failed Ubuntu formatting and Windows Clippy; macOS Rust CI passed. The Ubuntu formatter supplied four exact layout changes in the new test. Windows Clippy requested `trim_end_matches([' ', '.'])` instead of a manual character predicate. The correction follows those CI reports; no local formatter, tests, or builds were run. Runs: vault round-trip [38027767700](https://github.com/ashutoshpw/open-obsidian/actions/runs/38027767700), inventory [38027767738](https://github.com/ashutoshpw/open-obsidian/actions/runs/38027767738), loaded-plugin workflows [38027767740](https://github.com/ashutoshpw/open-obsidian/actions/runs/38027767740), desktop build [38027767697](https://github.com/ashutoshpw/open-obsidian/actions/runs/38027767697), quality [38027767728](https://github.com/ashutoshpw/open-obsidian/actions/runs/38027767728), and plugin renderer [38027767709](https://github.com/ashutoshpw/open-obsidian/actions/runs/38027767709).
### R2.8.11 accepted — SYNC-004 Windows-reserved names — source SHA `ad0147976f395ccd831351d6849d4c02cb339670`

The focused test `tests::windows_reserved_name_matrix_denies_reads_and_writes_without_mutating_vault` passed on Windows; full Rust workspace tests passed on Ubuntu, macOS, and Windows. Rust CI [38028036963](https://github.com/ashutoshpw/open-obsidian/actions/runs/38028036963), Obsidian vault round-trip [38028036960](https://github.com/ashutoshpw/open-obsidian/actions/runs/38028036960), inventory [38028036932](https://github.com/ashutoshpw/open-obsidian/actions/runs/38028036932), loaded-plugin workflows [38028036955](https://github.com/ashutoshpw/open-obsidian/actions/runs/38028036955), desktop build [38028036940](https://github.com/ashutoshpw/open-obsidian/actions/runs/38028036940), quality [38028036966](https://github.com/ashutoshpw/open-obsidian/actions/runs/38028036966), and plugin renderer [38028036942](https://github.com/ashutoshpw/open-obsidian/actions/runs/38028036942) all passed on this exact SHA. The initial attempt `664d76f` passed workspace tests and six companion workflows but failed Ubuntu formatting and Windows Clippy; the follow-up applies the exact CI corrections and passes all seven workflows. Job IDs, artifact digests, focused test output, and limitations are recorded in [`evidence/r2.8.11-sync-failure-matrix-ad01479.json`](evidence/r2.8.11-sync-failure-matrix-ad01479.json). Ten of eleven SYNC-004 scenarios now have executable Rust coverage; Unicode normalization remains, and aggregate SYNC-004, editor integration, and broader C01/C01.2 acceptance remain pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.8.12 accepted — SYNC-004 Unicode normalization — source SHA 6edc2979f7a5434ee89c9dd4ce0d42ab38326f21

The fixture-backed Unicode normalization test passed on Ubuntu, macOS, and Windows; full Rust workspace tests passed on all three platforms. On macOS, NFC and NFD spellings resolve to one existing file without changing its BOM/CRLF bytes; on Windows and Linux, both spellings remain distinct entries with their matching original bytes. Rust CI [38029254237](https://github.com/ashutoshpw/open-obsidian/actions/runs/38029254237), vault round-trip [38029254234](https://github.com/ashutoshpw/open-obsidian/actions/runs/38029254234), inventory [38029254180](https://github.com/ashutoshpw/open-obsidian/actions/runs/38029254180), loaded-plugin workflows [38029254205](https://github.com/ashutoshpw/open-obsidian/actions/runs/38029254205), desktop build [38029254203](https://github.com/ashutoshpw/open-obsidian/actions/runs/38029254203), quality [38029254258](https://github.com/ashutoshpw/open-obsidian/actions/runs/38029254258), and plugin renderer [38029254216](https://github.com/ashutoshpw/open-obsidian/actions/runs/38029254216) all passed on this exact SHA. The first attempt exposed a Windows snapshot-separator assertion and Ubuntu formatting; the second exposed an unused macOS-only import. Their corrections follow the exact GitHub CI diagnostics. Evidence, focused test lines, job IDs, artifact digests, tool versions, and limitations are recorded in [evidence/r2.8.12-unicode-normalization-6edc297.json](evidence/r2.8.12-unicode-normalization-6edc297.json). All eleven SYNC-004 scenarios now have executable Rust coverage and the requirement is passing. Broader R2, editor integration, and C01/C01.2 acceptance remain pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.8.13 accepted — source-preserving Markdown property edit — source SHA `530eaab471052a74d72bbbf1af63695b6a0eec3e`

Added `MarkdownSource::render_property_edit` for source-span replacement of represented top-level frontmatter values. The `fixture:c02-byte-roundtrip` cases preserve BOM, CRLF, comments, valid unknown YAML and malformed unknown YAML; only the approved value span changes. Empty values before comments receive a separator. Missing properties, multiline values and block scalars fail closed. Both focused tests and full workspace tests passed on Ubuntu, macOS and Windows. C02.2 is passing on this exact source SHA; broader C02 and RISK-004 remain pending.

All seven required workflows passed: Rust CI [38031163672](https://github.com/ashutoshpw/open-obsidian/actions/runs/38031163672), Obsidian vault round-trip [38031165332](https://github.com/ashutoshpw/open-obsidian/actions/runs/38031165332), inventory [38031163624](https://github.com/ashutoshpw/open-obsidian/actions/runs/38031163624), loaded-plugin workflows [38031163735](https://github.com/ashutoshpw/open-obsidian/actions/runs/38031163735), desktop build [38031163630](https://github.com/ashutoshpw/open-obsidian/actions/runs/38031163630), quality [38031163719](https://github.com/ashutoshpw/open-obsidian/actions/runs/38031163719) (attempt 2), and plugin renderer [38031163648](https://github.com/ashutoshpw/open-obsidian/actions/runs/38031163648). Quality's first Ubuntu attempt failed in the existing Electron retrieval-boundary audit; rerunning only that failed job on the same SHA passed. Native `parallel:` groups completed successfully in Rust CI, vault round-trip, desktop build and quality. Evidence, exact job IDs, tool versions and artifact digests are recorded in [evidence/r2.8.13-frontmatter-property-edit-530eaab.json](evidence/r2.8.13-frontmatter-property-edit-530eaab.json). All tests, builds, formatting and Clippy validation ran in GitHub Actions only.

### R2.8.14 started — YAML block-scalar header safety

Starting from tracker checkpoint SHA `b30b75e6c69b8ddccb6f792f74fab2f8ce3db97a`, this slice expands the frontmatter editor's structured-value guard to accept literal/folded block scalar headers with optional chomping and indentation indicators in either order. The new `fixture:risk-normalization` cases require every edit to fail as `StructuredValue` without changing source bytes. Exact-SHA GitHub Actions acceptance is pending; executable validation remains CI-only.

### R2.8.14 accepted — YAML block-scalar header safety — source SHA `088d0ef6558debec1d85268d07f642e2acc251ba`

The new `fixture:risk-normalization` test covers 16 literal/folded block-scalar headers: default, strip, keep, indentation, and both modifier orders. Every attempted edit returns `StructuredValue`; the original source bytes remain unchanged. The test and full Rust workspace tests passed on Ubuntu, macOS, and Windows. The existing C02 byte-roundtrip fixture also passed, covering approved-span edits and malformed/unknown frontmatter preservation. RISK-004 is passing on this exact source SHA.

All seven required workflows passed on the exact source SHA: Rust CI [38032129457](https://github.com/ashutoshpw/open-obsidian/actions/runs/38032129457), Obsidian vault round-trip [38032129469](https://github.com/ashutoshpw/open-obsidian/actions/runs/38032129469), inventory [38032129500](https://github.com/ashutoshpw/open-obsidian/actions/runs/38032129500), loaded-plugin workflows [38032129445](https://github.com/ashutoshpw/open-obsidian/actions/runs/38032129445), desktop build [38032129473](https://github.com/ashutoshpw/open-obsidian/actions/runs/38032129473), quality [38032129444](https://github.com/ashutoshpw/open-obsidian/actions/runs/38032129444), and plugin renderer [38032129491](https://github.com/ashutoshpw/open-obsidian/actions/runs/38032129491). Native parallel step groups completed successfully in Rust CI, vault round-trip, desktop build, and quality. Evidence, job IDs, artifact digests, and toolchain details are recorded in [evidence/r2.8.14-block-scalar-rejection-088d0ef.json](evidence/r2.8.14-block-scalar-rejection-088d0ef.json). No local tests, builds, formatters, linters, or application launches were run.

### R2.8.15 started — C04.1 unknown-property preservation

Starting from tracker checkpoint SHA `21e817b7acf54a746ccc0391a6fbe1eaf83cd7b7`, this slice adds a golden fixture for editing one represented frontmatter property while preserving BOM/CRLF, comments, ordering, arrays, scalar types, aliases, tags, nested values and unknown fields. It exercises the existing source-span editor without introducing a YAML serializer. Exact-SHA GitHub Actions acceptance is pending; executable validation remains CI-only.

### R2.8.15 accepted — C04.1 unknown-property preservation — source SHA `a89574a0cfec01a20df9f525eff325a3d8a6139a`

The focused fixture test `c02_byte_roundtrip_fixture_tests::c04_property_edit_preserves_unrepresented_yaml_and_only_changes_approved_bytes` passed in the Rust workspace matrix on Ubuntu, macOS, and Windows. It edits only the approved `title` value bytes and preserves the BOM, CRLF, comments, property order, aliases, tags, typed scalars, nested mappings/sequences and unrepresented fields. Rust CI [38033019449](https://github.com/ashutoshpw/open-obsidian/actions/runs/38033019449), Obsidian vault round-trip [38033019518](https://github.com/ashutoshpw/open-obsidian/actions/runs/38033019518), inventory [38033019459](https://github.com/ashutoshpw/open-obsidian/actions/runs/38033019459), loaded-plugin workflows [38033019457](https://github.com/ashutoshpw/open-obsidian/actions/runs/38033019457), desktop build [38033019438](https://github.com/ashutoshpw/open-obsidian/actions/runs/38033019438), quality [38033019469](https://github.com/ashutoshpw/open-obsidian/actions/runs/38033019469), and plugin renderer [38033019474](https://github.com/ashutoshpw/open-obsidian/actions/runs/38033019474) all passed on the exact source SHA. Evidence, job IDs, artifact digests, toolchain details, and limitations are recorded in [evidence/r2.8.15-c04-unknown-preservation-a89574a.json](evidence/r2.8.15-c04-unknown-preservation-a89574a.json). C04.1 is passing; broader C04, C02, editor integration, and R2 acceptance remain pending. No local tests, builds, formatters, linters, or application launches were run.

### R2.8.15 tracker checkpoint accepted — SHA `fa9bbeda0af5c19ceca88349e65f1ee6cd8a1831`

All six path-eligible workflows passed on this tracker-only commit: Rust CI [38033480999](https://github.com/ashutoshpw/open-obsidian/actions/runs/38033480999), inventory [38033480852](https://github.com/ashutoshpw/open-obsidian/actions/runs/38033480852), loaded-plugin workflows [38033480834](https://github.com/ashutoshpw/open-obsidian/actions/runs/38033480834), desktop build [38033480879](https://github.com/ashutoshpw/open-obsidian/actions/runs/38033480879), quality [38033480898](https://github.com/ashutoshpw/open-obsidian/actions/runs/38033480898), and plugin renderer [38033480873](https://github.com/ashutoshpw/open-obsidian/actions/runs/38033480873). Rust CI passed workspace tests, Clippy, native builds and compatibility probes on Ubuntu, macOS and Windows. The vault round-trip workflow was path-filtered off for tracker-only changes; it had passed on source SHA `a89574a0cfec01a20df9f525eff325a3d8a6139a`. The new native parallel step groups completed successfully. No local tests or builds were run.

### R2.8.16 started — bounded YAML property projection

Starting from tracker checkpoint SHA `fa9bbeda0af5c19ceca88349e65f1ee6cd8a1831`, this slice adds a bounded, read-only YAML projection to `crates/doc`. The projection retains mapping order and represents supported scalar and nested/flow collection types; aliases, tags, block scalars and malformed constructs remain source-only with explicit issues. A fixture checks typed projection while preserving BOM/CRLF, comments and exact Markdown bytes. The broader C04 requirement remains pending. All executable validation is GitHub Actions only.

### R2.8.16 accepted — bounded YAML property projection — source SHA `3356560c9212daf1c67d402ddde93314eeeb3380`

Added `MarkdownSource::parse_frontmatter_yaml()` and a bounded, read-only YAML parser in `crates/doc`. It preserves ordered mappings and supported null, boolean, number, string, sequence and mapping values. Unsupported aliases, tags, block scalars, malformed flow collections and excessive nesting are reported as source-only values. The parser has no serializer. The fixture-driven projection and depth-limit tests passed on Ubuntu, macOS and Windows; they verify typed/nested values, comments, unknown keys and byte-identical BOM/CRLF Markdown.

The first implementation CI attempt at `8cba55471d374f16e4d6e46fe999a974ee750d85` passed workspace tests on all three OSes and the six companion workflows, but Ubuntu rustfmt and macOS/Windows Clippy failed. The correction at `18867c6c33cf3de035de13c2aa37cdfa73578ee6` applied those diagnostics; its Rust tests and native preview builds then exposed one compile error because `RawDocument` is not indexable. `3356560c9212daf1c67d402ddde93314eeeb3380` uses the validated `MarkdownSource::text()` view for the source span.

All seven required workflows passed on exact source SHA `3356560c9212daf1c67d402ddde93314eeeb3380`: Rust CI [38034904956](https://github.com/ashutoshpw/open-obsidian/actions/runs/38034904956), Obsidian vault round-trip [38034904909](https://github.com/ashutoshpw/open-obsidian/actions/runs/38034904909), inventory [38034904930](https://github.com/ashutoshpw/open-obsidian/actions/runs/38034904930), loaded-plugin workflows [38034904932](https://github.com/ashutoshpw/open-obsidian/actions/runs/38034904932), desktop build [38034904903](https://github.com/ashutoshpw/open-obsidian/actions/runs/38034904903), quality [38034904924](https://github.com/ashutoshpw/open-obsidian/actions/runs/38034904924), and plugin renderer [38034904908](https://github.com/ashutoshpw/open-obsidian/actions/runs/38034904908). Rust formatting, workspace tests, Clippy, dependency layers, native previews and Wry probes passed on the matrix; the round-trip passed on all three OSes. Native `parallel:` groups completed successfully in Rust CI, round-trip, desktop build and quality. Exact job IDs, artifact digests, toolchain and limitations are in [evidence/r2.8.16-bounded-yaml-projection-3356560.json](evidence/r2.8.16-bounded-yaml-projection-3356560.json).

The fixture is passing, while broader C04 property semantics and editor integration remain pending. C02/C02.1 dialect rendering remains pending. No local tests, builds, formatters, linters or application launches were run.

Next: review the remaining C04 requirements and linked YAML fixtures, then define the next focused parser or edit-safety slice. Keep broader C04, C02/C02.1 and editor integration pending.

### R2.8.16 tracker checkpoint accepted — SHA `83e67dbf7815542975c6f4e405dc7005f7371276`

All six path-eligible workflows passed on the tracker-only commit: Rust CI [38035588442](https://github.com/ashutoshpw/open-obsidian/actions/runs/38035588442), inventory [38035588475](https://github.com/ashutoshpw/open-obsidian/actions/runs/38035588475), loaded-plugin workflows [38035588492](https://github.com/ashutoshpw/open-obsidian/actions/runs/38035588492), desktop build [38035588497](https://github.com/ashutoshpw/open-obsidian/actions/runs/38035588497), quality [38035588530](https://github.com/ashutoshpw/open-obsidian/actions/runs/38035588530), and plugin renderer [38035588451](https://github.com/ashutoshpw/open-obsidian/actions/runs/38035588451). The path-filtered vault round-trip was not triggered for this task-record-only commit; it passed on source SHA `3356560c9212daf1c67d402ddde93314eeeb3380`. All applicable native parallel groups passed. No local tests or builds were run.

### R2.8.17 started — Unicode and space-bearing YAML mapping keys

Starting from tracker checkpoint SHA `83e67dbf7815542975c6f4e405dc7005f7371276`, this slice extends the bounded, read-only YAML projection to retain plain Unicode and space-bearing keys, quoted keys with colons, colon-bearing plain keys, and embedded apostrophes. Unsupported complex keys must produce an explicit issue. The fixture remains byte-preserving and the parser remains non-serializing. Exact-SHA GitHub Actions acceptance is pending; executable validation remains CI-only.

### R2.8.17 accepted — Unicode and space-bearing YAML mapping keys — source SHA `85325d65d4fbd25eb9ee663525128ff661e0a3ab`

The CI-reported rustfmt and Clippy corrections from the first source attempt (`cdeb47482ef01eff2f276a1f1d2cf4f9d5100d20`) are in the follow-up commit. The focused YAML projection, excessive-nesting and property-preservation tests, plus the full workspace tests, passed in GitHub Actions on Ubuntu, macOS and Windows. Rust CI [38036443624](https://github.com/ashutoshpw/open-obsidian/actions/runs/38036443624), Obsidian vault round-trip [38036443740](https://github.com/ashutoshpw/open-obsidian/actions/runs/38036443740), inventory [38036443570](https://github.com/ashutoshpw/open-obsidian/actions/runs/38036443570), loaded-plugin workflows [38036443621](https://github.com/ashutoshpw/open-obsidian/actions/runs/38036443621), desktop build [38036443585](https://github.com/ashutoshpw/open-obsidian/actions/runs/38036443585), quality [38036443550](https://github.com/ashutoshpw/open-obsidian/actions/runs/38036443550), and plugin renderer [38036443689](https://github.com/ashutoshpw/open-obsidian/actions/runs/38036443689) all passed on this exact source SHA. Native `parallel:` groups passed in Rust CI, round-trip, desktop build and quality. Job IDs and artifact digests are recorded in [evidence/r2.8.17-yaml-mapping-keys-85325d6.json](evidence/r2.8.17-yaml-mapping-keys-85325d6.json).

The fixture's mapping-key projection slice is passing. Full C04 property semantics, structured editor integration, and C02/C02.1 dialect rendering remain pending. No local tests, builds, formatting, Clippy or application launches were run.

Next: review the remaining C04 requirements and fixtures, then define the next focused parser or edit-safety slice.

### R2.8.17 tracker checkpoint accepted — SHA `981fd0d8e08bbffd99d95e54a8996cc271e37a25`

The six path-eligible tracker workflows passed: Rust CI [38036889732](https://github.com/ashutoshpw/open-obsidian/actions/runs/38036889732), inventory [38036889892](https://github.com/ashutoshpw/open-obsidian/actions/runs/38036889892), loaded-plugin workflows [38036889848](https://github.com/ashutoshpw/open-obsidian/actions/runs/38036889848), desktop build [38036889853](https://github.com/ashutoshpw/open-obsidian/actions/runs/38036889853), quality [38036889852](https://github.com/ashutoshpw/open-obsidian/actions/runs/38036889852), and plugin renderer [38036889857](https://github.com/ashutoshpw/open-obsidian/actions/runs/38036889857). The task-record-only commit did not trigger the path-filtered vault round-trip; that workflow passed on the tested source SHA `85325d65d4fbd25eb9ee663525128ff661e0a3ab`. No local tests or builds were run.

### R2.8.18 started — nested YAML property edits

Starting from accepted checkpoint SHA `bda4c8d032a441f18c52f128d8fccf83675bf8b8`, this slice ports the existing TypeScript nested-property source edit behavior into `crates/doc`. It will address explicit mapping keys and sequence indices through block and flow collections, replacing only the selected inline leaf value and preserving all other source bytes. Ambiguous, malformed, unsupported and block-scalar paths must fail closed. Work is fixture-driven; all executable validation remains in GitHub Actions only.

### R2.8.18 CI attempt 1 — source SHA `161656a7bc3a8fc547f2d7ccfdbab77051cdc262`

The migration inventory [38038162067](https://github.com/ashutoshpw/open-obsidian/actions/runs/38038162067), loaded-plugin workflows [38038162049](https://github.com/ashutoshpw/open-obsidian/actions/runs/38038162049), desktop build [38038162100](https://github.com/ashutoshpw/open-obsidian/actions/runs/38038162100), quality [38038162068](https://github.com/ashutoshpw/open-obsidian/actions/runs/38038162068), and plugin renderer [38038162134](https://github.com/ashutoshpw/open-obsidian/actions/runs/38038162134) passed. Rust CI [38038162071](https://github.com/ashutoshpw/open-obsidian/actions/runs/38038162071) reported Ubuntu rustfmt changes and compiler error E0277: `source_property` used `?` on `std::str::from_utf8` without converting its `Result` to `Option`. The Obsidian vault round-trip [38038162080](https://github.com/ashutoshpw/open-obsidian/actions/runs/38038162080) hit the same compiler error in all three native builds. Applied the exact CI formatting and `.ok()?` correction. This SHA is not accepted; the follow-up exact-SHA CI is pending. No local tests, builds, formatting or linting were run.

### R2.8.18 CI attempt 2 — source SHA `182f3de99412b951845da7fe8e5b2cac6b5d85d5`

The Obsidian vault round-trip [38038351270](https://github.com/ashutoshpw/open-obsidian/actions/runs/38038351270) passed on Ubuntu, macOS, and Windows. Inventory [38038351241](https://github.com/ashutoshpw/open-obsidian/actions/runs/38038351241), loaded-plugin workflows [38038351229](https://github.com/ashutoshpw/open-obsidian/actions/runs/38038351229), desktop build [38038351269](https://github.com/ashutoshpw/open-obsidian/actions/runs/38038351269), quality [38038351209](https://github.com/ashutoshpw/open-obsidian/actions/runs/38038351209), and plugin renderer [38038351211](https://github.com/ashutoshpw/open-obsidian/actions/runs/38038351211) also passed. Rust CI [38038351217](https://github.com/ashutoshpw/open-obsidian/actions/runs/38038351217) failed workspace tests: an empty mapping value before a comment produced a reversed source span, and an indentationless block sequence after an empty mapping entry was rejected. Ubuntu rustfmt requested one closure-brace layout change. Prepared those scanner and formatting corrections from the GitHub diagnostics; this SHA is not accepted. No local tests, builds, formatting, or linting were run.

### R2.8.18 CI attempt 3 — source SHA `7599ecd942a3b027686e3a8da055f9ec63c70201`

Inventory [38038697672](https://github.com/ashutoshpw/open-obsidian/actions/runs/38038697672), loaded-plugin workflows [38038697600](https://github.com/ashutoshpw/open-obsidian/actions/runs/38038697600), desktop build [38038697754](https://github.com/ashutoshpw/open-obsidian/actions/runs/38038697754), quality [38038697569](https://github.com/ashutoshpw/open-obsidian/actions/runs/38038697569), and plugin renderer [38038697605](https://github.com/ashutoshpw/open-obsidian/actions/runs/38038697605) passed. Rust CI [38038697678](https://github.com/ashutoshpw/open-obsidian/actions/runs/38038697678) passed Ubuntu formatting and workspace tests on Ubuntu, macOS, and Windows, but Clippy failed on all three platforms for a needless lifetime, too many arguments, a needless range loop, and a needless borrow. The vault round-trip [38038697670](https://github.com/ashutoshpw/open-obsidian/actions/runs/38038697670) passed on Ubuntu, macOS, and Windows. Applied Clippy's four direct suggestions from the GitHub logs. This SHA is not accepted. No local tests, builds, formatting, or linting were run.

### R2.8.18 accepted — nested YAML property edits — source SHA `caa403719337508bc3776403e87026c979453788`

Added `MarkdownSource::render_nested_property_edit` and a bounded source-span resolver for explicit mapping keys and sequence indices in block and flow YAML. The 18-case `fixture:c04-nested-property-edit` covers byte-preserving leaf edits, typed flow replacements, comments, BOM/CRLF, indentationless sequences, and fail-closed malformed, missing, block-scalar, unsupported, and ambiguous paths. The focused test `c02_byte_roundtrip_fixture_tests::c04_nested_property_edits_preserve_every_unselected_source_byte` and full workspace tests passed on Ubuntu, macOS, and Windows.

All seven required workflows passed on this exact source SHA: Rust CI [38039225285](https://github.com/ashutoshpw/open-obsidian/actions/runs/38039225285), Obsidian vault round-trip [38039225255](https://github.com/ashutoshpw/open-obsidian/actions/runs/38039225255), inventory [38039225271](https://github.com/ashutoshpw/open-obsidian/actions/runs/38039225271), loaded-plugin workflows [38039225301](https://github.com/ashutoshpw/open-obsidian/actions/runs/38039225301), desktop build [38039225293](https://github.com/ashutoshpw/open-obsidian/actions/runs/38039225293), quality [38039225282](https://github.com/ashutoshpw/open-obsidian/actions/runs/38039225282), and plugin renderer [38039225348](https://github.com/ashutoshpw/open-obsidian/actions/runs/38039225348). Exact job IDs, artifact digests, the four failed attempts and their CI-guided corrections are recorded in [evidence/r2.8.18-nested-property-edits-caa4037.json](evidence/r2.8.18-nested-property-edits-caa4037.json).

The nested property edit slice is accepted and recorded for C04.1. Full C04 property semantics, structured editor integration, and C02/C02.1 dialect rendering remain pending. All formatting, tests, Clippy, builds and executable validation ran in GitHub Actions only.

### R2.8.19 accepted — full C04 property preservation — validated source SHA `caa403719337508bc3776403e87026c979453788`

Reconciled `fixture:c04-properties` (four projection cases), `fixture:c04-unknown-preservation` (one exact-span edit case), and `fixture:c04-nested-property-edit` (18 edit/fail-closed cases). On the same source SHA, the four focused tests for bounded projection, nesting limits, unknown preservation, and nested edits passed in GitHub Rust CI logs on Ubuntu, macOS, and Windows; full workspace tests and all seven required workflows passed. Aliases/tags, malformed YAML and block scalars remain source-only or unsupported with original bytes authoritative. C04 and C04.1 are now passing; structured properties UI and C02/C02.1 dialect rendering remain pending. Detailed tests, job IDs, run links, artifact digests and limitations are in [evidence/r2.8.19-c04-properties-acceptance-caa4037.json](evidence/r2.8.19-c04-properties-acceptance-caa4037.json), which references complete run artifacts in [evidence/r2.8.18-nested-property-edits-caa4037.json](evidence/r2.8.18-nested-property-edits-caa4037.json). No local tests, builds, formatting or linting were run.

Next: define the first bounded Rust C02.1 safe-preview dialect slice from `fixtures/markdown-dialects.json`; full source/live-preview/reading-view editing remains pending.

### R2.8.20 in progress — safe preview preflight — starting tracker SHA `74d58cbf2abf32d90e1d554fd95ecfd6e82b0d62`

The R2.8.19 evidence checkpoint is on `origin/main`. Its six path-eligible workflows passed: Rust CI [38040236585](https://github.com/ashutoshpw/open-obsidian/actions/runs/38040236585), quality [38040236607](https://github.com/ashutoshpw/open-obsidian/actions/runs/38040236607), desktop build [38040236631](https://github.com/ashutoshpw/open-obsidian/actions/runs/38040236631), loaded-plugin workflows [38040236532](https://github.com/ashutoshpw/open-obsidian/actions/runs/38040236532), inventory [38040236595](https://github.com/ashutoshpw/open-obsidian/actions/runs/38040236595), and plugin renderer [38040236529](https://github.com/ashutoshpw/open-obsidian/actions/runs/38040236529). The Obsidian vault round-trip workflow was not path-eligible for this tracker-only commit; this does not replace or change the accepted C04 implementation evidence on `caa403719337508bc3776403e87026c979453788`.

Prepared the first bounded C02.1 preview slice locally: `crates/doc` now plans a read-only dialect preflight with pinned `pulldown-cmark 0.13.4` (MIT); the native UI keeps the existing `egui_commonmark` path for its current supported subset and displays the bounded source slice with an explicit reason for footnotes, math, diagram/plugin fences, raw HTML, wiki links, and highlights. Added fixture cases for supported markup, each source-only case, mixed content, code literals, and unknown syntax, plus a native UI test and dependency/architecture documentation. The implementation has not yet been pushed, so exact-SHA GitHub CI is pending. No local tests, builds, formatting, linting, or executable validation were run. C02.1 remains pending.

### R2.8.20 CI-guided correction prepared — prior source SHA ffa7b6d76762ec12fe615dce26473da875de77c6

All seven required workflows for the prior source SHA completed. Rust CI [38040833064](https://github.com/ashutoshpw/open-obsidian/actions/runs/38040833064) exposed a legacy backslash-delimited math syntax miss on Ubuntu, macOS, and Windows, plus rustfmt differences on Ubuntu. Inventory [38040833068](https://github.com/ashutoshpw/open-obsidian/actions/runs/38040833068) found that the fixture digest was not reconciled. Quality [38040833069](https://github.com/ashutoshpw/open-obsidian/actions/runs/38040833069) showed that the fixture must retain its established supported_blocks and four-item visible_unsupported_blocks schema. The Obsidian vault round-trip passed on Ubuntu, macOS, and Windows [38040833052](https://github.com/ashutoshpw/open-obsidian/actions/runs/38040833052); desktop build [38040833063](https://github.com/ashutoshpw/open-obsidian/actions/runs/38040833063), loaded plugins [38040833062](https://github.com/ashutoshpw/open-obsidian/actions/runs/38040833062), and plugin renderer [38040833089](https://github.com/ashutoshpw/open-obsidian/actions/runs/38040833089) passed.

Prepared the correction locally: scan legacy math delimiters from source while excluding inline, fenced, and indented code; add an indented-code fixture; restore the established fixture fields; reconcile its SHA-256; and apply the formatting changes reported by GitHub CI. These corrections are not yet pushed or validated. No local tests, builds, formatting, linting, or executable checks were run. C02.1 remains pending. Next: commit and push this small correction checkpoint, then inspect all exact-SHA workflow results.

### R2.8.20 follow-up correction prepared — prior source SHA a787fe65c5035d784f95de8b7bf2aa62c05f57b8

The seven required workflows for a787fe65c5035d784f95de8b7bf2aa62c05f57b8 completed. Rust CI [38041262911](https://github.com/ashutoshpw/open-obsidian/actions/runs/38041262911) passed the legacy math fixture, then failed on wiki-link detection on Ubuntu, macOS, and Windows; Ubuntu also reported one remaining rustfmt import-wrap difference. Inventory [38041262908](https://github.com/ashutoshpw/open-obsidian/actions/runs/38041262908), quality [38041262894](https://github.com/ashutoshpw/open-obsidian/actions/runs/38041262894), plugin renderer [38041262853](https://github.com/ashutoshpw/open-obsidian/actions/runs/38041262853), desktop build [38041262900](https://github.com/ashutoshpw/open-obsidian/actions/runs/38041262900), loaded plugins [38041262891](https://github.com/ashutoshpw/open-obsidian/actions/runs/38041262891), and the Ubuntu/macOS/Windows vault round-trip [38041262926](https://github.com/ashutoshpw/open-obsidian/actions/runs/38041262926) passed.

Prepared a second correction locally: scan unnormalized source for wiki links, highlights, and legacy math while skipping fenced and indented code and consulting parser-reported inline code spans; apply the remaining formatting change. These changes are not yet pushed or validated. No local tests, builds, formatting, linting, or executable checks were run. C02.1 remains pending. Next: commit and push this follow-up checkpoint, then inspect every exact-SHA workflow result.

### R2.8.20 UI expectation correction prepared — prior source SHA 26eb1df2c180d2516ee5e78e4ae13e5098829dd7

For source SHA 26eb1df2c180d2516ee5e78e4ae13e5098829dd7, inventory [38041571660](https://github.com/ashutoshpw/open-obsidian/actions/runs/38041571660), quality [38041571613](https://github.com/ashutoshpw/open-obsidian/actions/runs/38041571613), plugin renderer [38041571610](https://github.com/ashutoshpw/open-obsidian/actions/runs/38041571610), desktop build [38041571629](https://github.com/ashutoshpw/open-obsidian/actions/runs/38041571629), loaded plugins [38041571607](https://github.com/ashutoshpw/open-obsidian/actions/runs/38041571607), and vault round-trip on Ubuntu, macOS, and Windows [38041571649](https://github.com/ashutoshpw/open-obsidian/actions/runs/38041571649) passed. Rust CI [38041571611](https://github.com/ashutoshpw/open-obsidian/actions/runs/38041571611) passed formatting and the document-layer dialect cases, then failed the existing nested-transclusion UI assertion on all three platforms. The test searched for formatted prose, while the new frozen preview contract correctly displayed the whole transclusion source because it contains a wiki embed.

Prepared a test-only correction locally: require the visible unsupported-syntax notice and the exact original Markdown text, while retaining the existing vault and app-data snapshot assertions. No production behavior changes in this follow-up. These changes are not yet pushed or validated. No local tests, builds, formatting, linting, or executable checks were run. C02.1 remains pending. Next: commit and push the assertion correction, then inspect every exact-SHA workflow.

### R2.8.20 Clippy correction prepared — prior source SHA 88ce1530d8ee4f7a17fced2def6fe706a059c9ef

All seven required workflows completed for 88ce1530d8ee4f7a17fced2def6fe706a059c9ef. Workspace tests passed on Ubuntu, macOS, and Windows and Ubuntu formatting passed in Rust CI [38041879139](https://github.com/ashutoshpw/open-obsidian/actions/runs/38041879139). Inventory [38041879149](https://github.com/ashutoshpw/open-obsidian/actions/runs/38041879149), quality [38041879128](https://github.com/ashutoshpw/open-obsidian/actions/runs/38041879128), loaded plugins [38041879140](https://github.com/ashutoshpw/open-obsidian/actions/runs/38041879140), plugin renderer [38041879144](https://github.com/ashutoshpw/open-obsidian/actions/runs/38041879144), desktop build [38041879216](https://github.com/ashutoshpw/open-obsidian/actions/runs/38041879216), and the three-platform vault round-trip [38041879201](https://github.com/ashutoshpw/open-obsidian/actions/runs/38041879201) passed. Clippy failed on all three operating systems because the wiki-link scanner nested an if that can be merged into its let-chain condition.

Applied the CI-requested conditional merge locally. The correction is not yet pushed or validated. No local tests, builds, formatting, linting, or executable checks were run. C02.1 remains pending. Next: commit and push this small correction checkpoint and inspect exact-SHA GitHub Actions.

### R2.8.20 accepted — safe Markdown preview preflight — source SHA `d19d3d31e741d36d829f2eba5fb893e7453c70dc`

The read-only `crates/doc` preflight and native UI source fallback passed the four focused document/UI tests on Ubuntu, macOS, and Windows. Rust CI, vault round-trip acceptance, inventory, loaded-plugin workflows, desktop build, quality, and plugin-renderer workflows all passed for this exact SHA. Rust CI ran formatting on Ubuntu only (the workflow skips that step on macOS and Windows); workspace tests, Clippy, layering, release builds, and runtime probes passed on all three operating systems. Run IDs, job IDs, toolchain version, fixture coverage, and 16 artifact SHA-256 digests are recorded in [evidence/r2.8.20-safe-preview-d19d3d3.json](evidence/r2.8.20-safe-preview-d19d3d3.json).

Accepted slice: `C02.1:safe-preview-preflight`. This does not complete C02.1: full dialect rendering and editing remain pending, including math, diagrams, wiki-link/highlight rendering, and safe HTML projection. No local tests, builds, formatting, linting, or executable validation were run.

Next: R2.8.21 enables native footnote rendering through the pinned `egui_commonmark 0.25.0` renderer, which declares footnote support; preserve visible source fallback for the remaining unsupported dialects.

### R2.8.21 CI attempt 1 — source SHA `b0044852bfefed99659e71dbd4f992262c623d98`

Rust CI [38043421631](https://github.com/ashutoshpw/open-obsidian/actions/runs/38043421631), Obsidian vault round-trip [38043421643](https://github.com/ashutoshpw/open-obsidian/actions/runs/38043421643), loaded-plugin workflows [38043421613](https://github.com/ashutoshpw/open-obsidian/actions/runs/38043421613), desktop build [38043421616](https://github.com/ashutoshpw/open-obsidian/actions/runs/38043421616), quality [38043421602](https://github.com/ashutoshpw/open-obsidian/actions/runs/38043421602), and plugin renderer [38043421823](https://github.com/ashutoshpw/open-obsidian/actions/runs/38043421823) passed. Rust tests, Clippy, layering, release builds and runtime probes passed on Ubuntu, macOS and Windows; the vault round-trip passed across all three platforms. The migration inventory [38043421640](https://github.com/ashutoshpw/open-obsidian/actions/runs/38043421640) failed because the updated `fixtures/markdown-dialects.json` retained its prior baseline hash. Updated the inventory record to the SHA-256 of the changed fixture. This source SHA is not accepted; rerun all required checks on the corrected exact SHA. No local tests, builds, formatters, linters or application validation were run. A local `git diff --check` whitespace check was run inadvertently; it is not acceptance evidence.

### R2.8.21 accepted — native Markdown footnotes — source SHA `06d2c000ec2013acdb6f43816d4ff7025d91879d`

After reconciling the dialect fixture hash, all seven required workflows passed on this exact SHA. The new focused egui footnote test and full workspace suites passed on Ubuntu, macOS, and Windows. Rust CI passed formatting on Ubuntu (skipped by workflow policy on macOS and Windows), Clippy, layer checks, release builds, and plugin runtime probes on all three operating systems. Obsidian vault round-trip passed on all three platforms. Run IDs, job IDs, toolchain, fixture coverage, and all 16 artifact digests are recorded in [evidence/r2.8.21-native-footnotes-06d2c00.json](evidence/r2.8.21-native-footnotes-06d2c00.json).

Accepted slice: `C02.1:native-footnote-rendering`. Other unsupported syntax still uses visible source fallback, and full C02.1 rendering and source-preserving editing remain pending. No local tests, builds, formatters, linters, or application validation were used for acceptance; the earlier local `git diff --check` whitespace check is explicitly excluded from evidence.

Next: continue C02.1 with another focused Markdown preview slice while keeping the broader compatibility contract pending.

### R2.8.22 implementation prepared — revision-safe task checkbox editing — starting tracker SHA `9dbe17cf5d614a3732e357db478a2a89e162b224`

The native note source preview now renders supported, complete Markdown with `CommonMarkViewer::show_mut` and sends task-marker changes through `VaultSession::write` using the exact SHA-256 revision from the bounded read. The vault exposes a revision only when the entire note fits within 16 KiB. After a task save, watcher reconciliation retains the preview only while the selected file still matches the saved revision. The dialect fixture covers BOM, CRLF, checked and unchecked tasks, code literals, and unknown source text. New egui cases cover exact-byte preservation, read-only unsupported and truncated previews, stale-write conflict handling, and keeping a saved preview through reconciliation. Architecture documentation describes the behavior and remaining C02.1 limits. The initial implementation was committed and pushed as `20a1ecb5ec9ce016932f6d2ae0593985e12d3a15`; see the CI attempt below. The focused Rust/UI suites and all executable validation remain GitHub Actions only. C02.1 remains pending.

### R2.8.22 CI attempt 1 — implementation SHA `20a1ecb5ec9ce016932f6d2ae0593985e12d3a15`

Six required workflows passed: migration inventory [38045394731](https://github.com/ashutoshpw/open-obsidian/actions/runs/38045394731), plugin renderer [38045394802](https://github.com/ashutoshpw/open-obsidian/actions/runs/38045394802), loaded-plugin workflows [38045394793](https://github.com/ashutoshpw/open-obsidian/actions/runs/38045394793), desktop build [38045394705](https://github.com/ashutoshpw/open-obsidian/actions/runs/38045394705), quality [38045394836](https://github.com/ashutoshpw/open-obsidian/actions/runs/38045394836), and Obsidian vault round-trip [38045394778](https://github.com/ashutoshpw/open-obsidian/actions/runs/38045394778) across Ubuntu, macOS and Windows. Rust CI [38045394780](https://github.com/ashutoshpw/open-obsidian/actions/runs/38045394780) failed on all three platforms because both new UI tests selected a unique checkbox while the fixture renders two; Ubuntu's formatting gate also reported four assertion-wrap differences. Workspace compilation completed, and the remaining tests passed. The correction changes these tests to select the first checkbox from a multi-result query and applies the CI-reported wrapping. No local tests, builds, formatters, linters or validation were run. C02.1 remains pending until all seven workflows pass on the correction SHA.

### R2.8.22 accepted — revision-safe task checkbox editing — source SHA `915653c0f2b491eb888cb52aba0bec63412563cb`

After the checkbox selector and formatting correction, Rust CI [38045752497](https://github.com/ashutoshpw/open-obsidian/actions/runs/38045752497) passed on Ubuntu, macOS and Windows. The five focused vault/UI tests and full workspace suites passed on all three platforms; formatting passed on Ubuntu, while the workflow skips it on macOS and Windows. Clippy, layering, release builds and plugin runtime probes passed on all three platforms. The other six required workflows also passed on this exact SHA: Obsidian vault round-trip [38045752459](https://github.com/ashutoshpw/open-obsidian/actions/runs/38045752459) (successful run attempt 2), inventory [38045752476](https://github.com/ashutoshpw/open-obsidian/actions/runs/38045752476), loaded-plugin workflows [38045752433](https://github.com/ashutoshpw/open-obsidian/actions/runs/38045752433), desktop build [38045752484](https://github.com/ashutoshpw/open-obsidian/actions/runs/38045752484), quality [38045752392](https://github.com/ashutoshpw/open-obsidian/actions/runs/38045752392), and plugin renderer [38045752463](https://github.com/ashutoshpw/open-obsidian/actions/runs/38045752463). The first Windows vault round-trip attempt failed because OCR omitted characters from the visible restored file-count label; its screenshot showed the active fixture vault. Rerunning only that failed job on the same SHA passed on all three platforms. Exact jobs, toolchain/dependency versions, all 16 accepted artifact archive digests, and the earlier failed attempts are recorded in [evidence/r2.8.22-native-task-checkboxes-915653c.json](evidence/r2.8.22-native-task-checkboxes-915653c.json). No local executable validation was used. Accepted slice: `C02.1:revision-safe-task-checkbox-editing`. Full C02.1 remains pending.

### R2.8.23 implementation prepared — escaped Markdown highlight delimiters — starting tracker SHA `f0a668941739f31513e60082b89891b6684796f2`

The Markdown preflight now follows CommonMark backslash parity for highlight openers. An odd-length backslash run escapes the first `=` and leaves the literal source in the normal Markdown preview; an even-length run retains the active highlight and source-only fallback. The shared dialect fixture covers both cases and the inventory records its new SHA-256. Architecture documentation records the boundary. The source classifier does not rewrite note bytes. Full C02.1 remains pending. All executable validation will run in GitHub Actions on the exact pushed SHA; no local tests, builds, formatters or linters were run.

### R2.8.23 CI attempt 1 — implementation SHA `9bc9eaaa8161824018b546aa142736b2d7d228e8`

Migration inventory [38047091127](https://github.com/ashutoshpw/open-obsidian/actions/runs/38047091127), desktop build [38047091149](https://github.com/ashutoshpw/open-obsidian/actions/runs/38047091149), plugin renderer [38047091157](https://github.com/ashutoshpw/open-obsidian/actions/runs/38047091157), loaded-plugin workflows [38047091211](https://github.com/ashutoshpw/open-obsidian/actions/runs/38047091211), quality [38047091128](https://github.com/ashutoshpw/open-obsidian/actions/runs/38047091128), and the three-OS Obsidian vault round-trip [38047091229](https://github.com/ashutoshpw/open-obsidian/actions/runs/38047091229) passed. Rust CI [38047091161](https://github.com/ashutoshpw/open-obsidian/actions/runs/38047091161) passed workspace tests on all three OSes and formatting on macOS/Windows, but Ubuntu rustfmt requested one condition be formatted on a single line. No other Rust gate ran after that formatting failure. The correction follows the exact CI diff. This SHA is not accepted; all seven workflows will be rerun on the correction SHA. No local tests, builds, formatters, linters or validation were run.

### R2.8.23 accepted — escaped Markdown highlight delimiters — source SHA `e6117c8ce7e123ed34c2b143404cae15f8755a0a`

All seven required workflows passed on the exact source SHA: Rust CI [38047383822](https://github.com/ashutoshpw/open-obsidian/actions/runs/38047383822), vault round-trip [38047383751](https://github.com/ashutoshpw/open-obsidian/actions/runs/38047383751), inventory [38047383815](https://github.com/ashutoshpw/open-obsidian/actions/runs/38047383815), loaded-plugin workflows [38047383795](https://github.com/ashutoshpw/open-obsidian/actions/runs/38047383795), desktop build [38047383774](https://github.com/ashutoshpw/open-obsidian/actions/runs/38047383774), quality [38047383835](https://github.com/ashutoshpw/open-obsidian/actions/runs/38047383835), and plugin renderer [38047383857](https://github.com/ashutoshpw/open-obsidian/actions/runs/38047383857). Rust formatting, workspace tests, Clippy, dependency-layer checks, release builds, and runtime probes passed across the Rust matrix; the dialect fixture test passed on all three operating systems. The vault round-trip passed on all three operating systems. Native `parallel:` groups completed successfully in Rust CI and the vault round-trip. GitHub artifact IDs, archive hashes, job IDs, toolchain versions, and the first formatting attempt are recorded in [evidence/r2.8.23-escaped-markdown-highlights-e6117c8.json](evidence/r2.8.23-escaped-markdown-highlights-e6117c8.json). No local executable validation was used. C02.1 remains pending.

### R2.8.23 tracker CI — acceptance record SHA `83b58b1670b749e0c0994a157079a1927f68f88e`

The six path-eligible workflows passed on the tracker commit: Rust migration inventory [38047845319](https://github.com/ashutoshpw/open-obsidian/actions/runs/38047845319), Rust CI [38047845313](https://github.com/ashutoshpw/open-obsidian/actions/runs/38047845313), plugin renderer [38047845273](https://github.com/ashutoshpw/open-obsidian/actions/runs/38047845273), loaded-plugin workflows [38047845295](https://github.com/ashutoshpw/open-obsidian/actions/runs/38047845295), desktop build [38047845290](https://github.com/ashutoshpw/open-obsidian/actions/runs/38047845290), and quality [38047845281](https://github.com/ashutoshpw/open-obsidian/actions/runs/38047845281). The path-filtered Obsidian round-trip did not run on this tracker-only commit; it passed on the exact implementation SHA `e6117c8ce7e123ed34c2b143404cae15f8755a0a`.

### R2.8.24 in progress — revision-safe task editing inside standard callouts — starting tracker SHA `83b58b1670b749e0c0994a157079a1927f68f88e`

The accepted task-toggle slice covered top-level task lists. This slice extends the same exact-marker, revision-checked behavior to task lists inside supported standard callouts. A BOM/CRLF fixture records the full source and exact post-toggle bytes; a native UI case will verify the checkbox is rendered in the callout and the source remains unchanged outside the selected marker. Full C02.1 stays pending. All executable validation remains GitHub Actions only.

### R2.8.24 accepted — revision-safe task editing inside standard callouts — source SHA `89e7afbfd8dd421c64c746be0c86d60df331c456`

All seven required workflows passed on the exact implementation SHA: Rust CI [38048299327](https://github.com/ashutoshpw/open-obsidian/actions/runs/38048299327), vault round-trip [38048299365](https://github.com/ashutoshpw/open-obsidian/actions/runs/38048299365), inventory [38048299410](https://github.com/ashutoshpw/open-obsidian/actions/runs/38048299410), loaded-plugin workflows [38048299348](https://github.com/ashutoshpw/open-obsidian/actions/runs/38048299348), desktop build [38048299367](https://github.com/ashutoshpw/open-obsidian/actions/runs/38048299367), quality [38048299371](https://github.com/ashutoshpw/open-obsidian/actions/runs/38048299371), and plugin renderer [38048299351](https://github.com/ashutoshpw/open-obsidian/actions/runs/38048299351). Rust formatting, workspace tests, Clippy, dependency-layer checks, release builds, and runtime probes passed across the Rust matrix. The focused callout task interaction passed on Ubuntu, macOS, and Windows, and the vault round-trip passed on all three operating systems. Run/job IDs, toolchain versions, and GitHub artifact hashes are in [evidence/r2.8.24-callout-task-editing-89e7afb.json](evidence/r2.8.24-callout-task-editing-89e7afb.json). No local executable validation was used. Full C02.1 remains pending.

### R2.8.25 in progress — revision-safe explicit Markdown source drafts — starting tracker SHA `170a6fcd351a7776befefdf4a7cf12de62bdb1e7`

The native preview now allows an explicit plain-source draft for a complete UTF-8 note up to 16 KiB. Saving uses the revision captured by the preview and the existing vault writer. The fixture covers BOM, CRLF, unsupported wiki syntax, and an unknown extension; the UI cases cover successful save, refresh preservation, external change invalidation, and stale-write conflict recovery. Full C02.1 remains pending. All tests and executable validation remain GitHub Actions only.

The first four pushed candidates were not accepted: Rust CI [38049459405](https://github.com/ashutoshpw/open-obsidian/actions/runs/38049459405) exposed test-harness selectors for the multiline editor that were not queryable and a rustfmt-only correction; [38049711599](https://github.com/ashutoshpw/open-obsidian/actions/runs/38049711599) confirmed the editor label was absent from the AccessKit tree; [38049976766](https://github.com/ashutoshpw/open-obsidian/actions/runs/38049976766) and [38050251529](https://github.com/ashutoshpw/open-obsidian/actions/runs/38050251529) identified Clippy `collapsible_if` findings in source-draft start/cancel handling. The UI cases now exercise the visible save action with draft state supplied through the test harness, and both conditionals follow Clippy's suggested let-chain form. The six companion workflows and Obsidian round-trip passed on each candidate.

### R2.8.25 accepted — revision-safe explicit Markdown source drafts — source SHA `c500b95c9f27cb2b5a7233a18f62b3245c46b82d`

All seven required workflows passed on the exact implementation SHA: Rust CI [38050497085](https://github.com/ashutoshpw/open-obsidian/actions/runs/38050497085), Obsidian vault round-trip [38050497055](https://github.com/ashutoshpw/open-obsidian/actions/runs/38050497055), inventory [38050497056](https://github.com/ashutoshpw/open-obsidian/actions/runs/38050497056), loaded-plugin workflows [38050497057](https://github.com/ashutoshpw/open-obsidian/actions/runs/38050497057), desktop build [38050497045](https://github.com/ashutoshpw/open-obsidian/actions/runs/38050497045), quality [38050497102](https://github.com/ashutoshpw/open-obsidian/actions/runs/38050497102), and plugin renderer [38050497072](https://github.com/ashutoshpw/open-obsidian/actions/runs/38050497072). The two focused source-edit UI cases and full workspace tests passed on Ubuntu, macOS, and Windows. Formatting, Clippy, dependency-layer checks, native release builds, and runtime probes passed in Rust CI; the Obsidian vault round-trip passed on all three operating systems. Job IDs, artifact hashes, versions, and failed CI attempts are recorded in [evidence/r2.8.25-revision-safe-source-editing-c500b95.json](evidence/r2.8.25-revision-safe-source-editing-c500b95.json).

The source editor's multiline input is not directly simulated by this egui test harness because its AccessKit node was not queryable; the tests seed draft state through the harness, then exercise save and stale-write behavior. Existing `parallel:` groups are present in six workflow files and passed where exercised in the Rust CI and vault round-trip jobs. No local tests, builds, formatters, linters, or application validation were used. Full C02.1 remains pending; continue with another narrow Markdown slice.

### R2.8.26 in progress — native math renderer feasibility

Started a development-only compatibility probe for `latex-rust = 1.0.2`, pinned exactly with `std` and `png` features. The focused UI-crate test checks representative formula PNG output, decodes the returned bytes with the existing image library, and verifies that TikZ input returns an error. The optional crate `egui` feature is excluded because it targets egui 0.28. Dependency selection, upstream MIT/Apache and embedded STIX Two Math OFL notices, and the pending runtime decision are recorded in RM-11 and the Markdown architecture note. The probe source has not yet been resolved or tested. Full C02.1 remains pending. No local tests, builds, formatting, Clippy or application launches were run. Next: generate the updated lockfile in GitHub Actions, then run all required exact-SHA workflows on the lockfile/test commit.

The first temporary resolver workflow passed on preparation SHA `af042daab04c94ca3ed4ebe7c356cb8be727b098` in [run 38052517905](https://github.com/ashutoshpw/open-obsidian/actions/runs/38052517905), job `114214324803`. It generated a lockfile with `cargo generate-lockfile`; artifact `11669712101` has archive SHA-256 `abe76ec72b41a7f1d450877a239784db9f655d80cbfb7cb8871a43d9a95ddd50`. That lockfile resolved `latex-rust 1.0.2`, `tiny-skia 0.11.4`, and `ttf-parser 0.25.1`, but also upgraded unrelated compatible transitive versions, so it was discarded. A second resolver run [38052714178](https://github.com/ashutoshpw/open-obsidian/actions/runs/38052714178) attempted `cargo check --workspace --all-targets` but stopped before compilation because that temporary job lacked the GTK/GLib runner packages. The regular Rust CI's Linux package setup is being added. This exact-SHA failure does not report a math probe or source error. After runner setup, the resolver will compile the probe while preserving existing locked versions where compatible; its lockfile is not yet accepted. Required exact-SHA acceptance remains pending.

The corrected resolver completed on preparation SHA `497c2b0d3b8715615ff594cdc12c65ae0181c6ce` in [run 38052845299](https://github.com/ashutoshpw/open-obsidian/actions/runs/38052845299), job `114215319824`. `cargo check --workspace --all-targets` compiled the workspace, including the candidate test target, and uploaded artifact `11670142020` (archive SHA-256 `88431794649ad7a8170949d297812f4ebac9a91d07e48ad4b2ef90b368bbffe4`). The CI-generated Cargo.lock SHA-256 is `f143845d873b4b530e4661a43baca149bec9c8deea627285620b5431252c06dc`; its diff adds only the candidate renderer and its PNG dependency. This compile is not test or exact-SHA acceptance evidence. The temporary resolver was removed; the lockfile, focused test, and required seven-workflow matrix are next.

### R2.8.26 CI attempt 1 — probe SHA `05ee40722021c49e5d0ea27faaa6268427d329a3`

Rust CI [38053157730](https://github.com/ashutoshpw/open-obsidian/actions/runs/38053157730) passed the workspace tests on Ubuntu, macOS and Windows, but its Ubuntu formatting check failed on two call-layout differences in the new probe test. The other six required workflows passed on this SHA: vault round-trip [38053157770](https://github.com/ashutoshpw/open-obsidian/actions/runs/38053157770), inventory [38053157768](https://github.com/ashutoshpw/open-obsidian/actions/runs/38053157768), loaded plugins [38053157767](https://github.com/ashutoshpw/open-obsidian/actions/runs/38053157767), quality [38053157789](https://github.com/ashutoshpw/open-obsidian/actions/runs/38053157789), desktop build [38053157774](https://github.com/ashutoshpw/open-obsidian/actions/runs/38053157774), and plugin renderer [38053157754](https://github.com/ashutoshpw/open-obsidian/actions/runs/38053157754). The CI-reported layout was applied in correction SHA `74b1287a1c35752a4e42f500ba243d6e608eaafb`; no local formatting or other validation was run.

### R2.8.26 CI attempt 2 — correction SHA `74b1287a1c35752a4e42f500ba243d6e608eaafb`

The six companion workflows passed again: Rust migration inventory [38054326761](https://github.com/ashutoshpw/open-obsidian/actions/runs/38054326761), plugin renderer [38054326757](https://github.com/ashutoshpw/open-obsidian/actions/runs/38054326757), loaded-plugin workflows [38054326766](https://github.com/ashutoshpw/open-obsidian/actions/runs/38054326766), desktop build [38054326786](https://github.com/ashutoshpw/open-obsidian/actions/runs/38054326786), quality [38054326762](https://github.com/ashutoshpw/open-obsidian/actions/runs/38054326762), and the three-OS Obsidian vault round-trip [38054326770](https://github.com/ashutoshpw/open-obsidian/actions/runs/38054326770). Rust CI [38054326804](https://github.com/ashutoshpw/open-obsidian/actions/runs/38054326804) passed workspace tests on all three platforms and passed macOS/Windows gates; Ubuntu still failed only because rustfmt indents the chained `.expect(...)` one level further. That exact CI layout is now applied locally. This attempt is not accepted; next commit and push the correction, then inspect all seven workflows for the new exact SHA. No local tests, formatters, builds, linters, or application validation were run.

### R2.8.26 accepted — latex-rust renderer feasibility probe — source SHA df0e02e55934fa26e6c9c5fb787a94772209d0c9

All seven required GitHub Actions workflows passed on the exact source SHA: Rust CI [38054819418](https://github.com/ashutoshpw/open-obsidian/actions/runs/38054819418), vault round-trip [38054819362](https://github.com/ashutoshpw/open-obsidian/actions/runs/38054819362), inventory [38054819545](https://github.com/ashutoshpw/open-obsidian/actions/runs/38054819545), loaded plugins [38054819374](https://github.com/ashutoshpw/open-obsidian/actions/runs/38054819374), desktop build [38054819375](https://github.com/ashutoshpw/open-obsidian/actions/runs/38054819375), quality [38054819406](https://github.com/ashutoshpw/open-obsidian/actions/runs/38054819406), and plugin renderer [38054819369](https://github.com/ashutoshpw/open-obsidian/actions/runs/38054819369). The focused PNG renderer probe and workspace tests passed on Ubuntu, macOS, and Windows; Ubuntu formatting, Clippy, layering, release builds and runtime probes passed, with formatting skipped by policy on macOS and Windows. The three-platform Obsidian vault round-trip passed. Exact job IDs, toolchain, versions, limitations, previous formatting attempts, and seven artifact archive hashes are recorded in [evidence/r2.8.26-latex-rust-feasibility-df0e02e.json](evidence/r2.8.26-latex-rust-feasibility-df0e02e.json).

Accepted slice: C02.1:math-renderer-candidate-feasibility. The test confirms three representative expressions produce PNGs decodable by image 0.25.10 and that TikZ input returns an error. latex-rust remains dev-only; this does not accept runtime rendering, formula fidelity, UI fallback/cache/resource behavior, or full C02.1. The existing GitHub Actions parallel groups completed successfully as part of the exact-SHA CI; their preparation evidence predates this implementation slice. No local tests, formatters, builds, Clippy, or application validation were used.

Next: R2.8.27 implements supported math through egui_commonmark's math callback. Before promoting the renderer to a runtime dependency, include the embedded STIX Two Math OFL notice, bound formula count/length and raster output/cache, provide a visible original-source fallback for renderer errors, and add egui preview coverage. Keep unsupported legacy delimiters visibly source-only; full C02.1 remains pending.

### R2.8.27 implementation prepared — pending exact-SHA GitHub Actions

The runtime math slice now configures the `egui_commonmark` callback for both mutable note previews and read-only note transclusions. Standard inline/display math no longer forces the whole preview to source mode; legacy backslash-delimited math remains source-only. Renderer errors and size/complexity limits show the formula source, and surrounding Markdown continues rendering. Formula callbacks are capped at 32 per egui UI pass, expressions at 512 UTF-8 bytes and 48 nested groups, each PNG at 1024 pixels per dimension / 262,144 total pixels / 1 MiB encoded, and the LRU cache at 64 entries / 4 MiB of RGBA texture data.

Exact `latex-rust` 1.0.2 archive inspection found SHA-256 `002bcaf7505b3516103424d8211b44cc4eb401cec17d35283402882b403c11fc`, matching `Cargo.lock`; its VCS metadata identifies `jscarr64/LaTeX-Rust` commit `b5391dd306a792a7327a0a76bfa84fb9827d77c5`. The crate's MIT and Apache licenses, package NOTICE, and full STIX Two Math 2.13 OFL 1.1 notice were copied from that exact archive and recorded in `evidence/r2.8.27-latex-rust-package-provenance.json`.

Focused renderer-bound, source-fallback, inline/display UI, cache-eviction, and license-presence tests were added but have not been run locally. This slice is not accepted until exact-SHA GitHub Actions passes all required workflows on Ubuntu, macOS, and Windows. Full C02.1 remains pending.

### GitHub Actions parallel quality checks — validated on `8c84978c16bf4064811da6e9c0b1002f8d52737c`

The quality workflow now runs the host vault round-trip report, `bun test`, and executable quality scorecard in one native Actions `parallel` group. Their temporary data is isolated; the Electron compile remains after the group's implicit wait. Existing Rust, desktop, vault, compatibility, and audit workflows already use native parallel groups. Exact-SHA quality run [38056935093](https://github.com/ashutoshpw/open-obsidian/actions/runs/38056935093) passed on Ubuntu, macOS, and Windows. Each platform's three grouped steps started at the same timestamp, completed successfully, and the Electron compile started at the group's completion time. Job IDs, step timestamps, and limits are recorded in [evidence/parallel-quality-checks-8c84978.json](evidence/parallel-quality-checks-8c84978.json). This confirms parallel execution and ordering; it does not claim a measured speedup over a sequential baseline.

The workflow-only commit's other triggered runs passed for desktop build [38056934989](https://github.com/ashutoshpw/open-obsidian/actions/runs/38056934989), loaded plugins [38056935133](https://github.com/ashutoshpw/open-obsidian/actions/runs/38056935133), and plugin renderer [38056935040](https://github.com/ashutoshpw/open-obsidian/actions/runs/38056935040). Rust CI [38056934962](https://github.com/ashutoshpw/open-obsidian/actions/runs/38056934962) and migration inventory [38056935030](https://github.com/ashutoshpw/open-obsidian/actions/runs/38056935030) failed on the unchanged R2.8.27 source and unreconciled baseline hashes. The vault round-trip workflow did not trigger because this commit only changed the quality workflow and did not match the vault workflow's path filter.

### R2.8.27 CI attempt 1 — source SHA `b00dec3e61c5f0f767f88209f2eb7c049d9c809a`

Rust CI [38056491115](https://github.com/ashutoshpw/open-obsidian/actions/runs/38056491115) found that the math callback's borrowed renderer cache escaped into a `'static` callback, causing Rust lifetime and borrow errors on all three operating systems. Ubuntu rustfmt also requested layout changes in the new UI tests and renderer. Vault round-trip [38056491112](https://github.com/ashutoshpw/open-obsidian/actions/runs/38056491112) stopped at the same compile errors. Inventory [38056491116](https://github.com/ashutoshpw/open-obsidian/actions/runs/38056491116) found `fixtures/markdown-dialects.json` had not been reconciled. Desktop build [38056491118](https://github.com/ashutoshpw/open-obsidian/actions/runs/38056491118), quality [38056491113](https://github.com/ashutoshpw/open-obsidian/actions/runs/38056491113), loaded plugins [38056491121](https://github.com/ashutoshpw/open-obsidian/actions/runs/38056491121), and plugin renderer [38056491109](https://github.com/ashutoshpw/open-obsidian/actions/runs/38056491109) passed. The attempt is not accepted.

### R2.8.27 CI attempt 2 — workflow SHA `8c84978c16bf4064811da6e9c0b1002f8d52737c`

The quality parallel group passed on all three platforms as recorded above. Rust CI again reported the callback lifetime/borrow errors and Ubuntu formatting differences. Inventory additionally detected the changed `.github/workflows/quality.yml`. Both baseline entries are now reconciled in the worktree: `fixtures/markdown-dialects.json` is `5b8bb84b93ccfbf418be3617ff8748932937c84177a492ccfdf91c42b54ca92c`, and `.github/workflows/quality.yml` is `70d331456325f97b65f27c9de554019c55d370c3b4a131e6e41b8deff968e6cb`. The callback now owns shared renderer state through `Rc<RefCell<MathRendererCache>>`, and the exact formatting requests were applied from CI output. These corrections have not yet been tested; commit and push them, then inspect all seven required workflows on that new exact SHA. No local tests, formatting, builds, or executable validation were run.

### R2.8.27 CI attempt 3 — source SHA `73a1b96d0b9085bb25af837b462848bfac97deb5`

Rust CI [38057348784](https://github.com/ashutoshpw/open-obsidian/actions/runs/38057348784) compiled the callback successfully and passed 69 workspace tests on Ubuntu, macOS, and Windows, but two new UI assertions per platform expected accessible math labels without the newlines produced by the actual egui tree. The tree confirms inline and display formulas render as images and that unsupported TikZ math shows both a failure notice and source; only the expected label strings were wrong. Ubuntu rustfmt requested three simple preview closures be flattened. The correction updates those assertions to the labels shown in CI and applies the three formatting layouts.

The other six workflows passed: inventory [38057348815](https://github.com/ashutoshpw/open-obsidian/actions/runs/38057348815), desktop build [38057348727](https://github.com/ashutoshpw/open-obsidian/actions/runs/38057348727), quality [38057348804](https://github.com/ashutoshpw/open-obsidian/actions/runs/38057348804), loaded plugins [38057348774](https://github.com/ashutoshpw/open-obsidian/actions/runs/38057348774), plugin renderer [38057348794](https://github.com/ashutoshpw/open-obsidian/actions/runs/38057348794), and the Obsidian vault round-trip [38057348785](https://github.com/ashutoshpw/open-obsidian/actions/runs/38057348785) across Ubuntu, macOS, and Windows. The attempt is not accepted until the corrected implementation passes Rust CI and all seven required workflows on a fresh exact SHA. No local tests, formatters, builds, or executable validation were run.

### R2.8.27 CI attempt 4 — source SHA `c11c3900a7f1c59dd2a3a4122bcac93542c90d2e`

Rust CI [38057847412](https://github.com/ashutoshpw/open-obsidian/actions/runs/38057847412) compiled the math renderer and passed the rest of the workspace suite, but the new error-fallback UI case queried the label `Before` while egui exposes `Before the formula:`. The source now checks the rendered labels `Before the formula:` and `After the formula.`. Inventory [38057847426](https://github.com/ashutoshpw/open-obsidian/actions/runs/38057847426), desktop build [38057847396](https://github.com/ashutoshpw/open-obsidian/actions/runs/38057847396), quality [38057847418](https://github.com/ashutoshpw/open-obsidian/actions/runs/38057847418), loaded-plugin workflows [38057847408](https://github.com/ashutoshpw/open-obsidian/actions/runs/38057847408), and plugin renderer [38057847404](https://github.com/ashutoshpw/open-obsidian/actions/runs/38057847404) passed.

Obsidian vault round-trip [38057847433](https://github.com/ashutoshpw/open-obsidian/actions/runs/38057847433) passed on Ubuntu and macOS in both attempts. Its Windows job failed first because `tesseract.exe` was missing, then failed again on an exact failed-job rerun. Both attempt logs show Chocolatey's community feed returned HTTP 504 while resolving the Tesseract package; PowerShell then continued into the audit because the setup did not verify the executable. The workflow now retries package installation up to three times and verifies `tesseract.exe` before adding its directory to `GITHUB_PATH`. Run/job details are recorded in [evidence/r2.8.27-ci-attempt4-c11c390.json](evidence/r2.8.27-ci-attempt4-c11c390.json). The source and workflow corrections are pending a new exact-SHA GitHub Actions run. No local tests, formatters, builds, linters, or application validation were used.

### R2.8.27 CI attempt 5 — source SHA `9f8daa321f838fae0c56be7455076dfe458a9824`

Rust workspace tests passed on Ubuntu, macOS, and Windows, but Rust CI [38058813086](https://github.com/ashutoshpw/open-obsidian/actions/runs/38058813086) failed its Clippy step on two new `markdown_math.rs` patterns: `chunks_exact_mut(4)` and `% 2 == 0`. Both findings were reported on all three operating systems; the source now uses the suggested `as_chunks_mut::<4>()` and `is_multiple_of(2)` APIs. The migration inventory [38058813047](https://github.com/ashutoshpw/open-obsidian/actions/runs/38058813047) rejected the added vault-roundtrip workflow row because its validator explicitly excludes that acceptance workflow from the source inventory; the row has been removed.

The five remaining workflows passed: Obsidian vault round-trip [38058813102](https://github.com/ashutoshpw/open-obsidian/actions/runs/38058813102) on Ubuntu, macOS, and Windows, including the new Tesseract retry; quality [38058813048](https://github.com/ashutoshpw/open-obsidian/actions/runs/38058813048), plugin renderer [38058813060](https://github.com/ashutoshpw/open-obsidian/actions/runs/38058813060), desktop build [38058813078](https://github.com/ashutoshpw/open-obsidian/actions/runs/38058813078), and loaded plugins [38058813072](https://github.com/ashutoshpw/open-obsidian/actions/runs/38058813072). Details are in [evidence/r2.8.27-ci-attempt5-9f8daa3.json](evidence/r2.8.27-ci-attempt5-9f8daa3.json). The Clippy and inventory corrections are pending fresh exact-SHA GitHub Actions. No local tests, formatters, builds, linters, or application validation were used.

### R2.8.27 accepted — bounded standard inline/display math — source SHA `e68b97aee09345ba857df1f91b2eb57d37c35ee7`

All seven required workflows passed on the exact source SHA: Rust CI [38059226160](https://github.com/ashutoshpw/open-obsidian/actions/runs/38059226160), Obsidian vault round-trip [38059226179](https://github.com/ashutoshpw/open-obsidian/actions/runs/38059226179), inventory [38059226141](https://github.com/ashutoshpw/open-obsidian/actions/runs/38059226141), loaded plugins [38059226169](https://github.com/ashutoshpw/open-obsidian/actions/runs/38059226169), desktop build [38059226146](https://github.com/ashutoshpw/open-obsidian/actions/runs/38059226146), quality [38059226214](https://github.com/ashutoshpw/open-obsidian/actions/runs/38059226214), and plugin renderer [38059226187](https://github.com/ashutoshpw/open-obsidian/actions/runs/38059226187). Rust tests, Ubuntu formatting, Clippy, dependency layering, native preview builds and unchanged-plugin Wry probes passed on their applicable jobs. The pinned Obsidian 1.14.4 vault round-trip passed on all three operating systems; Windows OCR installation and executable verification passed after the workflow's retry change.

The quality run also confirmed the requested native parallel group on all three operating systems. On macOS, the host vault round-trip, `bun test`, and quality scorecard started within 100 ms, all passed, and the Electron compile began after the group's wait barrier. This confirms ordering and concurrent execution without claiming a measured speedup. Toolchain versions, job IDs, exact Obsidian hashes, package provenance, limitations, artifact links and archive SHA-256 digests are recorded in [evidence/r2.8.27-latex-rust-runtime-e68b97a.json](evidence/r2.8.27-latex-rust-runtime-e68b97a.json). The package/font notices remain in [evidence/r2.8.27-latex-rust-package-provenance.json](evidence/r2.8.27-latex-rust-package-provenance.json).

Accepted slice: `C02.1:standard-inline-display-math`. Unsupported TikZ and legacy backslash-delimited math still display as source; this does not complete the broader Markdown preview, C02.1, or the full migration. No local tests, builds, formatters, Clippy, or application validation were used. Continue with another narrow C02.1 slice; R3-R7 also remain pending.

### R2.8.28 accepted — native Markdown table preview UI contract — source SHA `f2c5bfb459852a777c192697fece5731295628f8`

Added an egui UI contract test confirming a supported CommonMark table stays in native Markdown preview, exposes its header and body-cell text through the accessibility tree, and leaves the original source bytes unchanged. The existing `egui_commonmark` table renderer remains unchanged; this slice adds focused cross-platform coverage and does not claim pixel-level layout fidelity or table-specific cell editing.

All seven required workflows passed on this exact source SHA: Rust CI [38060156805](https://github.com/ashutoshpw/open-obsidian/actions/runs/38060156805), Obsidian vault round-trip [38060156765](https://github.com/ashutoshpw/open-obsidian/actions/runs/38060156765), inventory [38060156746](https://github.com/ashutoshpw/open-obsidian/actions/runs/38060156746), loaded-plugin workflows [38060156801](https://github.com/ashutoshpw/open-obsidian/actions/runs/38060156801), desktop build [38060156774](https://github.com/ashutoshpw/open-obsidian/actions/runs/38060156774), quality [38060156755](https://github.com/ashutoshpw/open-obsidian/actions/runs/38060156755), and plugin renderer [38060156762](https://github.com/ashutoshpw/open-obsidian/actions/runs/38060156762). Rust workspace tests passed on Ubuntu, macOS, and Windows; Ubuntu rustfmt, Clippy, dependency layering, native builds and Wry probes passed. The Obsidian 1.14.4 vault round-trip also passed on all three operating systems. Job IDs, artifact links and SHA-256 digests are recorded in [evidence/r2.8.28-markdown-table-ui-contract-f2c5bfb.json](evidence/r2.8.28-markdown-table-ui-contract-f2c5bfb.json).

Accepted slice: `C02.1:table-preview-ui-contract`. This is partial C02.1 coverage; diagram rendering, highlight rendering and safe HTML projection remain pending. No local tests, builds, formatters, Clippy, or application validation were run. Continue with another narrow C02.1 slice; later R3-R7 remain pending.

### R2.8.29 accepted — revision-safe Markdown table cell source edit — source SHA `dcf5568011809e9b5f04d966e172a97f1ea5f6b0`

Added a `table_editing` case to `fixture:c02-dialects` and an egui vault test that changes one table cell through the explicit Markdown source editor. The test checks native table preview before and after the edit, saves through the revision-checked vault writer, and compares the final vault bytes with the exact expected fixture. The BOM, CRLF endings, alignment row, separators and untouched cell remain intact. The migration inventory now records the fixture's updated SHA-256.

All seven required workflows passed on this exact source SHA: Rust CI [38061007108](https://github.com/ashutoshpw/open-obsidian/actions/runs/38061007108), Obsidian vault round-trip [38061007103](https://github.com/ashutoshpw/open-obsidian/actions/runs/38061007103), inventory [38061007128](https://github.com/ashutoshpw/open-obsidian/actions/runs/38061007128), loaded-plugin workflows [38061007135](https://github.com/ashutoshpw/open-obsidian/actions/runs/38061007135), desktop build [38061007074](https://github.com/ashutoshpw/open-obsidian/actions/runs/38061007074), quality [38061007174](https://github.com/ashutoshpw/open-obsidian/actions/runs/38061007174), and plugin renderer [38061007081](https://github.com/ashutoshpw/open-obsidian/actions/runs/38061007081). The new UI test and full Rust workspace suite passed on all three platforms; Ubuntu rustfmt, Clippy, dependency layering, native builds and Wry probes passed. The Obsidian 1.14.4 round-trip passed on Ubuntu, macOS, and Windows. Exact job IDs, toolchain, artifacts and archive digests are in [evidence/r2.8.29-table-cell-source-edit-dcf5568.json](evidence/r2.8.29-table-cell-source-edit-dcf5568.json).

Accepted slice: `C02.1:revision-safe-table-cell-source-editing`. The table can be edited in explicit source mode; this does not claim direct reading-view cell editing or complete C02.1. Unsupported HTML, diagrams, highlights and wiki links remain visible source-only cases. No local tests, builds, formatters, Clippy, or application validation were run. Continue the Markdown preview work and keep R3-R7 pending.


### R2.8.30 accepted — accessible, keyboard-driven Markdown source editing — source SHA 51ac3ff929d4643eca3b9531ddb64aced988b67c

The Markdown table-cell edit test now resolves the source editor by its visible Markdown source editor label and multiline text-input role. It clicks the editor, selects and pastes the expected source, waits for the accessibility tree to refresh, and saves through the revision-checked vault writer. The exact table fixture output retains its BOM, CRLF endings, table delimiters, alignment row, and untouched cell.

All seven required workflows passed on the exact implementation SHA: Rust CI [38062406417](https://github.com/ashutoshpw/open-obsidian/actions/runs/38062406417), Obsidian vault round-trip [38062406449](https://github.com/ashutoshpw/open-obsidian/actions/runs/38062406449), inventory [38062406447](https://github.com/ashutoshpw/open-obsidian/actions/runs/38062406447), loaded-plugin workflows [38062406472](https://github.com/ashutoshpw/open-obsidian/actions/runs/38062406472), desktop build [38062406402](https://github.com/ashutoshpw/open-obsidian/actions/runs/38062406402), quality [38062406411](https://github.com/ashutoshpw/open-obsidian/actions/runs/38062406411), and plugin renderer [38062406464](https://github.com/ashutoshpw/open-obsidian/actions/runs/38062406464). Rust workspace tests passed on all three operating systems; Ubuntu formatting, Clippy, crate layering, native builds and Wry probes passed. The Obsidian vault round-trip passed on all three operating systems. Job IDs, exact run links, artifact IDs, and GitHub archive digests are recorded in [evidence/r2.8.30-markdown-source-editor-accessibility-51ac3ff.json](evidence/r2.8.30-markdown-source-editor-accessibility-51ac3ff.json). No local tests, builds, formatters, linters, or application validation were used.

Accepted slice: C02.1 revision-safe source-editor accessibility. Full C02.1 and R3-R7 remain pending.

### R2.8.31 in progress — safe inline HTML line breaks

Add a small safe HTML subset to native Markdown preview: attribute-free inline br, br/, and br / become Markdown hard breaks in a preview-only projection. Any other raw HTML, including active content, stays in the source-only fallback with the original source visible. The projection must not modify vault bytes. The fixture will cover accepted spellings and unsupported HTML; a Rust UI case will verify both rendered lines and source immutability. All executable validation remains GitHub Actions only.


### R2.8.30 accepted — accessible, keyboard-driven Markdown source editing — source SHA 51ac3ff929d4643eca3b9531ddb64aced988b67c

The Markdown table-cell edit test now resolves the source editor by its visible Markdown source editor label and multiline text-input role. It clicks the editor, selects and pastes the expected source, waits for the accessibility tree to refresh, and saves through the revision-checked vault writer. The exact table fixture output retains its BOM, CRLF endings, table delimiters, alignment row, and untouched cell.

All seven required workflows passed on the exact implementation SHA: Rust CI [38062406417](https://github.com/ashutoshpw/open-obsidian/actions/runs/38062406417), Obsidian vault round-trip [38062406449](https://github.com/ashutoshpw/open-obsidian/actions/runs/38062406449), inventory [38062406447](https://github.com/ashutoshpw/open-obsidian/actions/runs/38062406447), loaded-plugin workflows [38062406472](https://github.com/ashutoshpw/open-obsidian/actions/runs/38062406472), desktop build [38062406402](https://github.com/ashutoshpw/open-obsidian/actions/runs/38062406402), quality [38062406411](https://github.com/ashutoshpw/open-obsidian/actions/runs/38062406411), and plugin renderer [38062406464](https://github.com/ashutoshpw/open-obsidian/actions/runs/38062406464). Rust workspace tests passed on all three operating systems; Ubuntu formatting, Clippy, crate layering, native builds and Wry probes passed. The Obsidian vault round-trip passed on all three operating systems. Job IDs, exact run links, artifact IDs, and GitHub archive digests are recorded in [evidence/r2.8.30-markdown-source-editor-accessibility-51ac3ff.json](evidence/r2.8.30-markdown-source-editor-accessibility-51ac3ff.json). No local tests, builds, formatters, linters, or application validation were used.

Accepted slice: C02.1 revision-safe source-editor accessibility. Full C02.1 and R3-R7 remain pending.

### R2.8.31 in progress — safe inline HTML line breaks

Add a small safe HTML subset to native Markdown preview: attribute-free inline br, br/, and br / become Markdown hard breaks in a preview-only projection. Any other raw HTML, including active content, stays in the source-only fallback with the original source visible. The projection must not modify vault bytes. The fixture will cover accepted spellings and unsupported HTML; a Rust UI case will verify both rendered lines and source immutability. All executable validation remains GitHub Actions only.


### R2.8.31 accepted — safe inline HTML line breaks — source SHA 8a6235def8b0ad6d0276995f1e295f86d1650278

The native Markdown preview now projects only attribute-free inline br, br/, and br / tags into Markdown hard breaks. The projection handles LF and CRLF boundaries and is read-only; the original note remains authoritative. Attribute-bearing break tags, active script content, block HTML, and other raw HTML continue to show the original source with an unsupported-syntax notice. The Rust dialect fixture covers all accepted spellings and these source-only cases, and the egui UI case confirms that both lines render while the input source bytes remain unchanged.

The first source candidate, fa0ff45597f546b34d03a0aa89e0ff6829491d47, failed the legacy TypeScript fixture assertion because its top-level visible unsupported list had been changed. The follow-up restored that existing legacy contract and retained the new Rust-specific metadata under rust_preview. The first quality run on the final SHA had one Ubuntu Electron vault audit failure after the renderer reported indexing complete at 1/1 passages without reaching the expected retrieval status; macOS and Windows passed. Same-SHA quality rerun attempt 2 passed all three operating systems.

All seven required workflows passed on the exact accepted SHA: Rust CI [38064579873](https://github.com/ashutoshpw/open-obsidian/actions/runs/38064579873), Obsidian vault round-trip [38064610431](https://github.com/ashutoshpw/open-obsidian/actions/runs/38064610431), inventory [38064579801](https://github.com/ashutoshpw/open-obsidian/actions/runs/38064579801), loaded-plugin workflows [38064579830](https://github.com/ashutoshpw/open-obsidian/actions/runs/38064579830), desktop build [38064579790](https://github.com/ashutoshpw/open-obsidian/actions/runs/38064579790), quality rerun [38064579782](https://github.com/ashutoshpw/open-obsidian/actions/runs/38064579782), and plugin renderer [38064579845](https://github.com/ashutoshpw/open-obsidian/actions/runs/38064579845). Rust workspace tests, including the focused preview and UI tests, passed on all three platforms. The Obsidian vault round-trip passed on all three platforms. Exact job IDs, artifact links and archive digests are in [evidence/r2.8.31-safe-inline-html-break-8a6235d.json](evidence/r2.8.31-safe-inline-html-break-8a6235d.json). No local tests, builds, formatters, linters, or application validation were used.

Accepted slice: C02.1 safe inline HTML line-break preview. Full C02.1 and R3-R7 remain pending. Continue with another focused C02.1 preview feature, keeping source preservation and unsupported behavior explicit.

### R2.8.32 in progress — plain inline highlight preview

Render Obsidian `==highlight==` markers only inside a single plain-text paragraph with no mixed Markdown or ambiguous markup. Preserve complex highlights as original source with the existing unsupported-syntax notice. Add fixture coverage for one and multiple highlighted phrases, mixed-format fallback, and a UI check that the highlighted content is accessible and source bytes remain unchanged. Executable validation remains limited to exact-SHA GitHub Actions.

### R2.8.32 CI attempt 1 — source SHA `a7a993ec9f5eda6efc589c69033e5ac17cf97ad0`

GitHub Rust CI [38065534531](https://github.com/ashutoshpw/open-obsidian/actions/runs/38065534531) passed the full macOS and Windows jobs and Ubuntu workspace tests, but Ubuntu rustfmt requested the highlight-span `push` expression on one line. The six companion workflows passed on this exact SHA: Obsidian vault round-trip [38065534494](https://github.com/ashutoshpw/open-obsidian/actions/runs/38065534494), inventory [38065534504](https://github.com/ashutoshpw/open-obsidian/actions/runs/38065534504), loaded plugins [38065534517](https://github.com/ashutoshpw/open-obsidian/actions/runs/38065534517), desktop build [38065534519](https://github.com/ashutoshpw/open-obsidian/actions/runs/38065534519), quality [38065534540](https://github.com/ashutoshpw/open-obsidian/actions/runs/38065534540), and plugin renderer [38065534493](https://github.com/ashutoshpw/open-obsidian/actions/runs/38065534493). The formatter correction is committed separately and pending a fresh exact-SHA matrix. No local tests, builds, formatters, or application validation were run.

### R2.8.32 accepted — plain inline highlight preview — source SHA `12d68e3993cf5f7951ee4245e51ee45d15759e67`

The native Markdown preview now renders `==highlight==` phrases in a single plain-text paragraph using source-byte spans, while mixed Markdown highlights remain visible in source-only fallback. One- and multi-highlight cases render in the fixture; escaped openers remain literal and even-backslash active markers remain classified. The egui UI exposes the highlighted phrase and preserves the input source bytes.

All seven required workflows passed on the exact accepted source SHA: Rust CI [38065888656](https://github.com/ashutoshpw/open-obsidian/actions/runs/38065888656), Obsidian vault round-trip [38065888746](https://github.com/ashutoshpw/open-obsidian/actions/runs/38065888746), inventory [38065888790](https://github.com/ashutoshpw/open-obsidian/actions/runs/38065888790), loaded-plugin workflows [38065888677](https://github.com/ashutoshpw/open-obsidian/actions/runs/38065888677), desktop build [38065888710](https://github.com/ashutoshpw/open-obsidian/actions/runs/38065888710), quality [38065888685](https://github.com/ashutoshpw/open-obsidian/actions/runs/38065888685), and plugin renderer [38065888716](https://github.com/ashutoshpw/open-obsidian/actions/runs/38065888716). The fixture and egui tests passed on Ubuntu, macOS, and Windows. Job IDs and artifact digests are recorded in [evidence/r2.8.32-inline-highlights-12d68e3.json](evidence/r2.8.32-inline-highlights-12d68e3.json). No local tests, builds, formatters, Clippy, or application validation were used.

Accepted slice: `C02.1:plain-inline-highlight-preview`. Complex highlights and other unsupported Markdown constructs remain source-only; this does not complete full C02.1 or migration phases R3-R7.

### R2.8.33 accepted — primary note preview projection integration — source SHA `d8ab02cc5f0c2a0f9cf9af6aaf7072ab120c9a01`

The primary note source panel now routes supported plain-highlight and safe HTML line-break projections through the dialect-aware preview. Projected previews are explicitly read-only and preserve source bytes; unprojected CommonMark retains the revision-checked task-checkbox write path. Two panel-level UI cases cover the visible highlight and line-break output with unchanged source.

All seven required workflows passed on the exact source SHA: inventory [38066822137](https://github.com/ashutoshpw/open-obsidian/actions/runs/38066822137), loaded-plugin workflows [38066822124](https://github.com/ashutoshpw/open-obsidian/actions/runs/38066822124), desktop build [38066822142](https://github.com/ashutoshpw/open-obsidian/actions/runs/38066822142), quality [38066822144](https://github.com/ashutoshpw/open-obsidian/actions/runs/38066822144), Rust CI [38066822172](https://github.com/ashutoshpw/open-obsidian/actions/runs/38066822172), plugin renderer [38066822170](https://github.com/ashutoshpw/open-obsidian/actions/runs/38066822170), and Obsidian vault round-trip [38066822179](https://github.com/ashutoshpw/open-obsidian/actions/runs/38066822179). Rust CI and round-trip jobs passed on Ubuntu, macOS, and Windows. Rust CI used rustc 1.99.0 (`b940084d7`, 2026-09-28); all artifact IDs and digests are recorded in [evidence/r2.8.33-primary-preview-projections-d8ab02c.json](evidence/r2.8.33-primary-preview-projections-d8ab02c.json). No local tests, builds, formatters, Clippy, or application validation were run.

The user's requested GitHub Actions parallel-step feature was already implemented and accepted in CI preparation before Rust migration implementation. It is used in the current Rust, quality, desktop-build, vault round-trip, compatibility-pin, and reference-runner workflows; no additional workflow edit was needed. See [evidence/parallel-ci-runner-setup-c479996.json](evidence/parallel-ci-runner-setup-c479996.json) and the [GitHub Actions parallel steps announcement](https://github.blog/changelog/2026-06-25-actions-steps-can-now-be-run-in-parallel/).

Accepted slice: primary-panel projection integration for safe HTML breaks and plain inline highlights. Other unsupported Markdown constructs remain source-only; full C02.1 and migration phases R3-R7 remain pending.

### R2.8.34 in progress — resolved wiki-link preview

Starting from accepted `origin/main` SHA `70d898c`, add a bounded preview for single-line plain-text wiki links that resolve unambiguously to `.md` notes. Clicks navigate through the existing vault session. Unresolved, ambiguous, stale-revision, subpath, embedded, non-Markdown, and mixed-Markdown cases remain source-only. Fixture and egui coverage verify visible labels, navigation, source-byte preservation, and safe fallback. Executable validation remains limited to exact-SHA GitHub Actions; no local tests, builds, formatters, linters, or app launches are allowed by the goal.

The requested GitHub Actions parallel-step capability was already implemented and accepted before migration work. Native `parallel` groups are present in the Rust, quality, desktop-build, vault round-trip, compatibility-pin, and reference-feasibility workflows; the pre-migration run and per-runner evidence are recorded in `evidence/parallel-ci.json` and `evidence/parallel-ci-runner-setup-c479996.json`.

### R2.8.34 CI attempt 1 — source SHA `19fe5f059386ddc7c514466d18696d04d110ad0d`

The GitHub Actions inventory workflow failed because the edited `fixtures/markdown-dialects.json` still had its previous baseline hash in `inventory.json`. The failure was identified from run [38068131711](https://github.com/ashutoshpw/open-obsidian/actions/runs/38068131711); the fixture hash and reconciliation reason are corrected in a follow-up commit. The other six workflows were still running on the superseded SHA when the correction was prepared, so none of those results will be used to accept the follow-up source SHA. No local tests, builds, formatters, linters, or application validation were run.

### R2.8.34 CI attempt 2 — source SHA `bb12bbfd114404f6be13f5835ef594507694b110`

The inventory [38068184158](https://github.com/ashutoshpw/open-obsidian/actions/runs/38068184158), desktop build [38068184142](https://github.com/ashutoshpw/open-obsidian/actions/runs/38068184142), plugin renderer [38068184145](https://github.com/ashutoshpw/open-obsidian/actions/runs/38068184145), quality [38068184210](https://github.com/ashutoshpw/open-obsidian/actions/runs/38068184210), and loaded-plugin workflows [38068184205](https://github.com/ashutoshpw/open-obsidian/actions/runs/38068184205) passed. Rust CI [38068184126](https://github.com/ashutoshpw/open-obsidian/actions/runs/38068184126) passed workspace tests on Ubuntu, macOS, and Windows, but Ubuntu rustfmt requested layout changes and Clippy reported one collapsible `if` on macOS and Windows. Those exact CI corrections are applied in the follow-up source commit. The same-SHA vault round-trip dispatch [38068209777](https://github.com/ashutoshpw/open-obsidian/actions/runs/38068209777) was canceled after the implementation changed, to reserve acceptance for the corrected SHA. No local tests, builds, formatters, linters, or application validation were run.

### R2.8.34 accepted — resolved wiki-link preview — source SHA `b03a6733c6a26ed000b15bb1123612fd025c4e0f`

The primary preview renders a simple inline wiki link only when the vault resolves it to one Markdown note; clicking navigates to that note. The source remains read-only and unchanged. Unresolved, ambiguous, stale, subpath, embedded, non-Markdown, and mixed-Markdown cases retain source-only fallback. Both focused egui tests passed on Ubuntu, macOS, and Windows.

All seven required workflows passed on the exact source SHA: inventory [38068443093](https://github.com/ashutoshpw/open-obsidian/actions/runs/38068443093), loaded plugins [38068443140](https://github.com/ashutoshpw/open-obsidian/actions/runs/38068443140), desktop build [38068443079](https://github.com/ashutoshpw/open-obsidian/actions/runs/38068443079), quality [38068443097](https://github.com/ashutoshpw/open-obsidian/actions/runs/38068443097), Rust CI [38068443194](https://github.com/ashutoshpw/open-obsidian/actions/runs/38068443194), plugin renderer [38068443155](https://github.com/ashutoshpw/open-obsidian/actions/runs/38068443155), and Obsidian vault round-trip [38068443156](https://github.com/ashutoshpw/open-obsidian/actions/runs/38068443156). Rust CI, vault round-trip, and related matrix jobs passed on all three platforms. Rust CI used rustc 1.99.0 (`b940084d7`, 2026-09-28); job IDs and artifact digests are in [evidence/r2.8.34-resolved-wiki-links-b03a673.json](evidence/r2.8.34-resolved-wiki-links-b03a673.json). The CI preparation's native `parallel` step groups remain in use and passed; the requested capability required no further workflow edits. No local tests, builds, formatters, Clippy, or application validation were used.

Accepted slice: simple resolved Markdown-note wiki-link preview and navigation. Full C02.1 and migration phases R3-R7 remain pending.

The accepted tracker/evidence checkpoint at [2f10530f6b7af6450ce36a984e1dfdb68926ad7f](https://github.com/ashutoshpw/open-obsidian/commit/2f10530f6b7af6450ce36a984e1dfdb68926ad7f) also passed the GitHub inventory workflow on that exact tracker SHA: [run 38068953165](https://github.com/ashutoshpw/open-obsidian/actions/runs/38068953165).

### R2.8.35 in progress — stale wiki-link fallback and documentation

Starting from tracker SHA `a3d7bcf37f92445a8066dfa21872b381b47417cf`, close the evidence gap in R2.8.34's stale-revision contract with an egui test that injects resolved links associated with an older revision and verifies source-only fallback, no clickable link, the refresh instruction, and unchanged vault/app-data snapshots. Update `docs/architecture/markdown-preview.md` so its supported wiki-link boundary matches the accepted primary-panel behavior. All executable validation remains GitHub Actions only.

### R2.8.35 CI attempt 1 — source SHA `c18eecf0543cdc6dff12ae0a2bc293846ee42bce`

GitHub Rust CI [38069247624](https://github.com/ashutoshpw/open-obsidian/actions/runs/38069247624) failed to compile the new test on Ubuntu, macOS, and Windows: it passed `&RawDocument` directly to `std::str::from_utf8` instead of using `RawDocument::as_bytes()`. The Ubuntu and macOS workspace-test jobs reported the same E0308 mismatch; Windows confirmed it as well. The test now uses the existing byte accessor, following nearby preview code. The Obsidian vault round-trip had passed on Ubuntu and macOS and was still running on Windows when this correction was prepared; the corrected source SHA will receive its own full required-workflow run. No local tests, builds, formatters, linters, or app launches were used.

### R2.8.35 accepted — stale wiki-link fallback evidence — source SHA `07848e213417184734da29a4810762ecf9b3a106`

The corrected egui case verifies that an old link-resolution revision stays source-only, shows the refresh instruction, has no AccessKit link, and preserves both vault and app-data snapshots. The Markdown preview architecture guide now matches the accepted single-line, plain-text, uniquely resolved Markdown-target behavior and its source-only boundaries. The focused test passed in Rust workspace tests on Ubuntu, macOS, and Windows.

All seven required workflows passed on the exact source SHA: inventory [38069552077](https://github.com/ashutoshpw/open-obsidian/actions/runs/38069552077), loaded-plugin workflows [38069552140](https://github.com/ashutoshpw/open-obsidian/actions/runs/38069552140), desktop build [38069552049](https://github.com/ashutoshpw/open-obsidian/actions/runs/38069552049), quality [38069552082](https://github.com/ashutoshpw/open-obsidian/actions/runs/38069552082), Rust CI [38069552017](https://github.com/ashutoshpw/open-obsidian/actions/runs/38069552017), plugin renderer [38069552014](https://github.com/ashutoshpw/open-obsidian/actions/runs/38069552014), and Obsidian vault round-trip [38069552154](https://github.com/ashutoshpw/open-obsidian/actions/runs/38069552154). Rust CI and vault round-trip passed on Ubuntu, macOS, and Windows. Rust CI used rustc 1.99.0 (`b940084d7`, 2026-09-28); exact job IDs and artifact digests are in [evidence/r2.8.35-stale-wiki-link-fallback-07848e2.json](evidence/r2.8.35-stale-wiki-link-fallback-07848e2.json). The previous `c18eecf` candidate was rejected by Rust CI for the documented `RawDocument` byte-access compile error and is retained as a superseded attempt in the evidence. No local tests, builds, formatters, Clippy, or application validation were used.

Accepted slice: stale-resolution fail-closed behavior and accurate preview documentation. Full C02.1 and migration phases R3-R7 remain pending.

The accepted evidence checkpoint at [68ce866fa3bc2f3c071a5a6e355e2c9fe7dfa5bc](https://github.com/ashutoshpw/open-obsidian/commit/68ce866fa3bc2f3c071a5a6e355e2c9fe7dfa5bc) passed the GitHub inventory workflow on that exact tracker SHA: [run 38070190720](https://github.com/ashutoshpw/open-obsidian/actions/runs/38070190720), job 114265841500. R2.8.36 starts from this accepted tracker checkpoint.

### R2.8.36 in progress — embedded and subpath wiki-link fallback

Starting from tracker SHA `d670877dd97fe9493b436461f39b207c791e4785` (accepted implementation SHA `07848e213417184734da29a4810762ecf9b3a106`), add fixture-driven egui evidence that embedded and subpath wiki links remain source-only even when their underlying Markdown target resolves. The fixture cases and UI test now assert successful target resolution, no clickable link, visible original source, and unchanged vault/app-data snapshots. The fixture inventory hash is reconciled; push this slice for exact-SHA GitHub Actions. All executable validation remains GitHub Actions only.

### R2.8.36 CI attempt 1 — source SHA `7610882d5d139f44af6c30e904c7a1a9934637f3`

Inventory [38070371580](https://github.com/ashutoshpw/open-obsidian/actions/runs/38070371580), loaded-plugin workflows [38070371604](https://github.com/ashutoshpw/open-obsidian/actions/runs/38070371604), desktop build [38070371588](https://github.com/ashutoshpw/open-obsidian/actions/runs/38070371588), quality [38070371566](https://github.com/ashutoshpw/open-obsidian/actions/runs/38070371566), plugin renderer [38070371559](https://github.com/ashutoshpw/open-obsidian/actions/runs/38070371559), and Obsidian vault round-trip [38070371578](https://github.com/ashutoshpw/open-obsidian/actions/runs/38070371578) passed. Rust CI [38070371633](https://github.com/ashutoshpw/open-obsidian/actions/runs/38070371633) passed workspace tests, including the new embedded/subpath case, on Ubuntu, macOS, and Windows. Ubuntu formatting requested one line-wrap adjustment to the fixture loop; the exact diff is applied in the follow-up. No local tests, builds, formatters, linters, or app launches were used.

### R2.8.36 accepted — embedded and subpath wiki-link fallback — source SHA `8e4a4b09127bc7a02e52d616d6e09c5118af4644`

The fixture-driven egui test confirms both `![[Plans/Project]]` and `[[Plans/Project#Overview]]` resolve to the intended Markdown note while remaining source-only in the primary preview. Neither context exposes a clickable link, and the test verifies unchanged source text plus unchanged vault and app-data snapshots. Rust CI passed the focused test on Ubuntu, macOS, and Windows.

All seven required workflows passed on this exact source SHA: inventory [38070798476](https://github.com/ashutoshpw/open-obsidian/actions/runs/38070798476), loaded-plugin workflows [38070798485](https://github.com/ashutoshpw/open-obsidian/actions/runs/38070798485), desktop build [38070798426](https://github.com/ashutoshpw/open-obsidian/actions/runs/38070798426), quality [38070798475](https://github.com/ashutoshpw/open-obsidian/actions/runs/38070798475), Rust CI [38070798480](https://github.com/ashutoshpw/open-obsidian/actions/runs/38070798480), plugin renderer [38070798402](https://github.com/ashutoshpw/open-obsidian/actions/runs/38070798402), and Obsidian vault round-trip [38070798503](https://github.com/ashutoshpw/open-obsidian/actions/runs/38070798503). The loaded-plugin workflow's Ubuntu job was rerun as attempt 2 on the same SHA after GitHub reported the initial terminal-success run's Ubuntu job as still in progress; attempt 2 completed successfully across all three platforms. Rust CI used rustc 1.99.0 (`b940084d7`, 2026-09-28); exact jobs and artifact digests are recorded in [evidence/r2.8.36-embed-subpath-source-only-8e4a4b0.json](evidence/r2.8.36-embed-subpath-source-only-8e4a4b0.json). No local tests, builds, formatters, Clippy, or application validation were used.

Accepted slice: source-only safety for embedded and subpath wiki links whose Markdown targets resolve. Full C02.1 and migration phases R3-R7 remain pending.

The accepted evidence checkpoint at [a7ccfd1d835d36a4afa8ab6857af284545a47105](https://github.com/ashutoshpw/open-obsidian/commit/a7ccfd1d835d36a4afa8ab6857af284545a47105) passed the GitHub inventory workflow on that exact tracker SHA: [run 38071735312](https://github.com/ashutoshpw/open-obsidian/actions/runs/38071735312), job 114270346478.

### R2.8.37 in progress — non-Markdown wiki-link target fallback

Starting from tracker SHA `a7ccfd1d835d36a4afa8ab6857af284545a47105` (accepted implementation SHA `8e4a4b09127bc7a02e52d616d6e09c5118af4644`), add fixture-driven UI evidence that a simple wiki link to a uniquely resolved non-Markdown vault asset stays source-only. The test now confirms path resolution succeeds while the preview exposes no clickable link and preserves source, vault, and app-data bytes. The fixture hash is reconciled; push for exact-SHA GitHub Actions. All executable validation remains GitHub Actions only.

### R2.8.37 accepted — non-Markdown wiki-link target fallback — source SHA `0f134032cadfd3e983359f5951cf553ea3e5b323`

The fixture-driven source-only UI case now covers three resolved-target contexts: an embedded link, a heading-subpath link, and a simple wiki link to `Boards/Research.canvas`. For the non-Markdown case, the test confirms the path resolves to the `.canvas` file while the primary preview exposes no clickable link and preserves source, vault, and app-data bytes. The updated fixture hash passed inventory.

All seven required workflows passed on the exact source SHA: inventory [38071964146](https://github.com/ashutoshpw/open-obsidian/actions/runs/38071964146), loaded-plugin workflows [38071964092](https://github.com/ashutoshpw/open-obsidian/actions/runs/38071964092), desktop build [38071964138](https://github.com/ashutoshpw/open-obsidian/actions/runs/38071964138), quality [38071964102](https://github.com/ashutoshpw/open-obsidian/actions/runs/38071964102), Rust CI [38071964165](https://github.com/ashutoshpw/open-obsidian/actions/runs/38071964165), plugin renderer [38071964099](https://github.com/ashutoshpw/open-obsidian/actions/runs/38071964099), and Obsidian vault round-trip [38071964097](https://github.com/ashutoshpw/open-obsidian/actions/runs/38071964097). Rust CI passed the focused case on Ubuntu, macOS, and Windows. The first quality attempt's Ubuntu Electron vault audit stopped after indexing one passage without reaching the local retrieval boundary; the quality workflow's second attempt passed on all three operating systems at the same SHA. Exact job IDs and artifact digests are in [evidence/r2.8.37-non-markdown-wiki-link-fallback-0f13403.json](evidence/r2.8.37-non-markdown-wiki-link-fallback-0f13403.json). No local tests, builds, formatters, Clippy, or application validation were used.

Accepted slice: source-only safety for resolved non-Markdown wiki-link targets. Full C02.1 and migration phases R3-R7 remain pending.

The accepted evidence checkpoint at [3e4af157c28d3eca8b746b3b567772f3a3ad6c79](https://github.com/ashutoshpw/open-obsidian/commit/3e4af157c28d3eca8b746b3b567772f3a3ad6c79) passed the GitHub inventory workflow on that exact tracker SHA: [run 38072571002](https://github.com/ashutoshpw/open-obsidian/actions/runs/38072571002), job 114272857654.

### R2.8.38 in progress — mixed-formatting wiki-link fallback

Starting from tracker SHA `3e4af157c28d3eca8b746b3b567772f3a3ad6c79` (accepted implementation SHA `0f134032cadfd3e983359f5951cf553ea3e5b323`), add fixture-driven UI evidence that a wiki link surrounded by Markdown emphasis remains source-only even when its target resolves to a local Markdown note. The resolved-target mixed-formatting case is in the existing source-only UI test; it checks for no clickable link and unchanged source, vault, and app-data bytes. The fixture hash is reconciled; push for exact-SHA GitHub Actions. All executable validation remains GitHub Actions only.

### R2.8.38 accepted — mixed-formatting wiki-link fallback — source SHA `737493c4c89022f96b1d18bf8b6a92fe7da1a013`

The primary preview keeps a resolved wiki link surrounded by Markdown emphasis source-only. The focused egui test confirmed the target resolves, exposes no clickable link, and preserves source, vault, and app-data bytes. It passed on Ubuntu, macOS, and Windows.

All seven required workflows passed on this exact SHA: inventory [38072701814](https://github.com/ashutoshpw/open-obsidian/actions/runs/38072701814), loaded-plugin workflows [38072701755](https://github.com/ashutoshpw/open-obsidian/actions/runs/38072701755), desktop build [38072701771](https://github.com/ashutoshpw/open-obsidian/actions/runs/38072701771), quality [38072701876](https://github.com/ashutoshpw/open-obsidian/actions/runs/38072701876), Rust CI [38072701798](https://github.com/ashutoshpw/open-obsidian/actions/runs/38072701798), plugin renderer [38072701863](https://github.com/ashutoshpw/open-obsidian/actions/runs/38072701863), and Obsidian vault round-trip [38072701916](https://github.com/ashutoshpw/open-obsidian/actions/runs/38072701916). Rust CI and vault round-trip passed on all three platforms. Rust CI used rustc 1.99.0 (`b940084d7`, 2026-09-28); job IDs and artifact digests are recorded in [evidence/r2.8.38-mixed-formatting-wiki-link-fallback-737493c.json](evidence/r2.8.38-mixed-formatting-wiki-link-fallback-737493c.json).

The GitHub Actions native `parallel` step groups remain enabled in the workflows, including Rust CI, and passed in CI. The requested parallel-step capability was already implemented in CI preparation; see [evidence/parallel-ci.json](evidence/parallel-ci.json). No local tests, builds, formatters, Clippy, or application validation were run.

Accepted slice: source-only handling for a resolved wiki link surrounded by Markdown emphasis. Full C02.1 and migration phases R3-R7 remain pending. Next: R2.8.39 adds a resolved wiki link inside a Markdown list block and verifies that it stays source-only.

The R2.8.38 acceptance tracker commit [02188f14d63e90e41d78ddf997945004638311e5](https://github.com/ashutoshpw/open-obsidian/commit/02188f14d63e90e41d78ddf997945004638311e5) passed the inventory workflow on that exact SHA: [run 38073362634](https://github.com/ashutoshpw/open-obsidian/actions/runs/38073362634), job 114275170259. The checkpoint is recorded in the R2.8.38 evidence.

### R2.8.39 in progress — list-context wiki-link fallback

Starting from tracker SHA `02188f14d63e90e41d78ddf997945004638311e5`, add a fixture-driven case for a simple wiki link inside a Markdown list item whose target resolves to a local Markdown note. The existing egui source-only test checks that the resolved list-context link exposes no clickable link and preserves source, vault, and app-data bytes. The fixture hash and inventory reconciliation reason are updated. Push this focused slice for exact-SHA GitHub Actions; no executable validation runs locally.

### R2.8.39 accepted — list-context wiki-link fallback — source SHA `4d667618bc97b10b1b187b3c69b183eae3927433`

The primary preview keeps a simple resolved wiki link inside a Markdown list item source-only. The fixture-driven egui test confirms that the target resolves, the preview exposes no clickable link, and source, vault, and app-data bytes remain unchanged. The focused test passed on Ubuntu, macOS, and Windows.

All seven required workflows passed on this exact SHA: inventory [38073436553](https://github.com/ashutoshpw/open-obsidian/actions/runs/38073436553), loaded-plugin workflows [38073435975](https://github.com/ashutoshpw/open-obsidian/actions/runs/38073435975), desktop build [38073435982](https://github.com/ashutoshpw/open-obsidian/actions/runs/38073435982), quality [38073436008](https://github.com/ashutoshpw/open-obsidian/actions/runs/38073436008), Rust CI [38073436009](https://github.com/ashutoshpw/open-obsidian/actions/runs/38073436009), plugin renderer [38073435974](https://github.com/ashutoshpw/open-obsidian/actions/runs/38073435974), and Obsidian vault round-trip [38073435964](https://github.com/ashutoshpw/open-obsidian/actions/runs/38073435964). Rust CI and vault round-trip passed on all three platforms. Rust CI used rustc 1.99.0 (`b940084d7`, 2026-09-28); job IDs and artifact digests are recorded in [evidence/r2.8.39-list-context-wiki-link-fallback-4d66761.json](evidence/r2.8.39-list-context-wiki-link-fallback-4d66761.json). No local executable validation was used.

Accepted slice: source-only handling for a resolved wiki link inside a Markdown list item. Full C02.1 and migration phases R3-R7 remain pending. Next: R2.8.40 adds the same focused source-only check for a resolved wiki link in a Markdown table cell.

The R2.8.39 acceptance tracker commit [c84d298078a6cea048771550801074d2a2e67a27](https://github.com/ashutoshpw/open-obsidian/commit/c84d298078a6cea048771550801074d2a2e67a27) passed the inventory workflow on that exact SHA: [run 38073847295](https://github.com/ashutoshpw/open-obsidian/actions/runs/38073847295), job 114276606004. The checkpoint is recorded in the R2.8.39 evidence.

### R2.8.40 in progress — table-context wiki-link fallback

Starting from tracker SHA `c84d298078a6cea048771550801074d2a2e67a27`, add a fixture-driven case for a simple wiki link inside a Markdown table cell whose target resolves to a local Markdown note. The existing egui source-only test checks that the resolved table-context link exposes no clickable link and preserves source, vault, and app-data bytes. The fixture hash and inventory reconciliation reason are updated. Push this focused slice for exact-SHA GitHub Actions; no executable validation runs locally.

### R2.8.40 accepted — table-context wiki-link fallback — source SHA `ece927bb112ba037fe6cde6bd7bc189d22bcff7d`

The primary preview keeps a simple resolved wiki link inside a Markdown table cell source-only. The fixture-driven egui test confirms that the target resolves, the preview exposes no clickable link, and source, vault, and app-data bytes remain unchanged. The focused test passed on Ubuntu, macOS, and Windows.

All seven required workflows passed on this exact SHA: inventory [38073900813](https://github.com/ashutoshpw/open-obsidian/actions/runs/38073900813), loaded-plugin workflows [38073900787](https://github.com/ashutoshpw/open-obsidian/actions/runs/38073900787), desktop build [38073900772](https://github.com/ashutoshpw/open-obsidian/actions/runs/38073900772), quality [38073900810](https://github.com/ashutoshpw/open-obsidian/actions/runs/38073900810), Rust CI [38073900786](https://github.com/ashutoshpw/open-obsidian/actions/runs/38073900786), plugin renderer [38073900773](https://github.com/ashutoshpw/open-obsidian/actions/runs/38073900773), and Obsidian vault round-trip [38073900791](https://github.com/ashutoshpw/open-obsidian/actions/runs/38073900791). Rust CI and vault round-trip passed on all three platforms. Rust CI used rustc 1.99.0 (`b940084d7`, 2026-09-28); job IDs and artifact digests are recorded in [evidence/r2.8.40-table-context-wiki-link-fallback-ece927b.json](evidence/r2.8.40-table-context-wiki-link-fallback-ece927b.json). No local executable validation was used.

Accepted slice: source-only handling for a resolved wiki link inside a Markdown table cell. Full C02.1 and migration phases R3-R7 remain pending. Next: R2.8.41 checks a resolved wiki link inside a Markdown task-list item and verifies that source-only fallback remains read-only.

The R2.8.40 acceptance tracker commit [5e4946822092f73b8f398549f5a9c55ce58ae01d](https://github.com/ashutoshpw/open-obsidian/commit/5e4946822092f73b8f398549f5a9c55ce58ae01d) passed the inventory workflow on that exact SHA: [run 38074377893](https://github.com/ashutoshpw/open-obsidian/actions/runs/38074377893), job 114278156103. The checkpoint is recorded in the R2.8.40 evidence.

### R2.8.41 in progress — task-list wiki-link fallback

Starting from tracker SHA `5e4946822092f73b8f398549f5a9c55ce58ae01d`, add a fixture-driven case for a simple wiki link inside a Markdown task-list item whose target resolves to a local Markdown note. The existing egui source-only test checks that no clickable link or interactive task checkbox appears and that source, vault, and app-data bytes remain unchanged. The fixture hash and inventory reconciliation reason are updated. Push this focused slice for exact-SHA GitHub Actions; no executable validation runs locally.

### R2.8.41 accepted — task-list wiki-link fallback remains read-only — source SHA `9059c689a1d5cb3db4ed9cf3ace40bed3839a7bd`

The primary preview keeps a simple resolved wiki link inside a Markdown task-list item source-only. The fixture-driven egui test confirms that the target resolves, the preview exposes no clickable link or interactive checkbox, and source, vault, and app-data bytes remain unchanged. The focused test passed on Ubuntu, macOS, and Windows.

All seven required workflows passed on this exact SHA: inventory [38074442617](https://github.com/ashutoshpw/open-obsidian/actions/runs/38074442617), loaded-plugin workflows [38074442671](https://github.com/ashutoshpw/open-obsidian/actions/runs/38074442671), desktop build [38074442649](https://github.com/ashutoshpw/open-obsidian/actions/runs/38074442649), quality [38074442644](https://github.com/ashutoshpw/open-obsidian/actions/runs/38074442644), Rust CI [38074442674](https://github.com/ashutoshpw/open-obsidian/actions/runs/38074442674), plugin renderer [38074442618](https://github.com/ashutoshpw/open-obsidian/actions/runs/38074442618), and Obsidian vault round-trip [38074442636](https://github.com/ashutoshpw/open-obsidian/actions/runs/38074442636). Rust CI and vault round-trip passed on all three platforms. Rust CI used rustc 1.99.0 (`b940084d7`, 2026-09-28); job IDs and artifact digests are recorded in [evidence/r2.8.41-task-list-wiki-link-read-only-9059c68.json](evidence/r2.8.41-task-list-wiki-link-read-only-9059c68.json). No local executable validation was used.

Accepted slice: source-only handling for a resolved wiki link inside a Markdown task-list item, with no interactive checkbox. Full C02.1 and migration phases R3-R7 remain pending. Next: R2.8.42 checks a resolved wiki link inside a Markdown blockquote.

The R2.8.41 acceptance tracker commit [92ba28d09233621d17d5d60740f4d327aa0ccac4](https://github.com/ashutoshpw/open-obsidian/commit/92ba28d09233621d17d5d60740f4d327aa0ccac4) passed the inventory workflow on that exact SHA: [run 38074846776](https://github.com/ashutoshpw/open-obsidian/actions/runs/38074846776), job 114279573757. The checkpoint is recorded in the R2.8.41 evidence.

### R2.8.42 in progress — blockquote wiki-link fallback

Starting from tracker SHA `92ba28d09233621d17d5d60740f4d327aa0ccac4`, add a fixture-driven case for a simple wiki link inside a Markdown blockquote whose target resolves to a local Markdown note. The existing egui source-only test checks that the resolved link exposes no clickable link and preserves source, vault, and app-data bytes. The fixture hash and inventory reconciliation reason are updated. Push this focused slice for exact-SHA GitHub Actions; no executable validation runs locally.

### R2.8.42 accepted — blockquote-context wiki-link fallback — source SHA `e67e133d557526d1a4db355561136b09451683b8`

The primary preview keeps a simple resolved wiki link inside a Markdown blockquote source-only. The fixture-driven egui test confirms that the target resolves, the preview exposes no clickable link, and source, vault, and app-data bytes remain unchanged. The focused test passed on Ubuntu, macOS, and Windows.

All seven required workflows passed on this exact SHA: inventory [38074920910](https://github.com/ashutoshpw/open-obsidian/actions/runs/38074920910), loaded-plugin workflows [38074920826](https://github.com/ashutoshpw/open-obsidian/actions/runs/38074920826), desktop build [38074921009](https://github.com/ashutoshpw/open-obsidian/actions/runs/38074921009), quality [38074920913](https://github.com/ashutoshpw/open-obsidian/actions/runs/38074920913), Rust CI [38074920845](https://github.com/ashutoshpw/open-obsidian/actions/runs/38074920845), plugin renderer [38074920844](https://github.com/ashutoshpw/open-obsidian/actions/runs/38074920844), and Obsidian vault round-trip [38074920829](https://github.com/ashutoshpw/open-obsidian/actions/runs/38074920829). Rust CI and vault round-trip passed on all three platforms. Rust CI used rustc 1.99.0 (`b940084d7`, 2026-09-28); job IDs and artifact digests are recorded in [evidence/r2.8.42-blockquote-wiki-link-fallback-e67e133.json](evidence/r2.8.42-blockquote-wiki-link-fallback-e67e133.json). No local executable validation was used.

Accepted slice: source-only handling for a resolved wiki link inside a Markdown blockquote. Full C02.1 and migration phases R3-R7 remain pending. Next: R2.8.43 checks a resolved wiki link inside a Markdown heading.

The R2.8.42 acceptance tracker commit [f547f62ee3eefe7a2dbe52c936d8822dff1d9fc8](https://github.com/ashutoshpw/open-obsidian/commit/f547f62ee3eefe7a2dbe52c936d8822dff1d9fc8) passed the inventory workflow on that exact SHA: [run 38075378129](https://github.com/ashutoshpw/open-obsidian/actions/runs/38075378129), job 114281141309. The checkpoint is recorded in the R2.8.42 evidence.

### R2.8.43 in progress — heading-context wiki-link fallback

Starting from tracker SHA `f547f62ee3eefe7a2dbe52c936d8822dff1d9fc8`, add a fixture-driven case for a simple wiki link inside a Markdown heading whose target resolves to a local Markdown note. The existing egui source-only test checks that the resolved link exposes no clickable link and preserves source, vault, and app-data bytes. The fixture hash and inventory reconciliation reason are updated. Push this focused slice for exact-SHA GitHub Actions; no executable validation runs locally.

### R2.8.43 accepted — heading-context wiki-link fallback — source SHA `9017825fc2626069d756aa919cd7893b3ccbf390`

The primary preview keeps a simple resolved wiki link inside a Markdown heading source-only. The fixture-driven egui test confirms the target resolves, exposes no clickable link, and preserves source, vault, and app-data bytes. The focused test passed on Ubuntu, macOS, and Windows.

All seven required workflows passed on this exact SHA: inventory [38075498280](https://github.com/ashutoshpw/open-obsidian/actions/runs/38075498280), loaded-plugin workflows [38075498538](https://github.com/ashutoshpw/open-obsidian/actions/runs/38075498538), desktop build [38075498441](https://github.com/ashutoshpw/open-obsidian/actions/runs/38075498441), quality [38075498371](https://github.com/ashutoshpw/open-obsidian/actions/runs/38075498371), Rust CI [38075498313](https://github.com/ashutoshpw/open-obsidian/actions/runs/38075498313), plugin renderer [38075498348](https://github.com/ashutoshpw/open-obsidian/actions/runs/38075498348), and Obsidian vault round-trip [38075498399](https://github.com/ashutoshpw/open-obsidian/actions/runs/38075498399). Rust CI used rustc 1.99.0 (`b940084d7`, 2026-09-28); job IDs and artifact digests are recorded in [evidence/r2.8.43-heading-context-wiki-link-fallback-9017825.json](evidence/r2.8.43-heading-context-wiki-link-fallback-9017825.json). No local executable validation was used.

Accepted slice: source-only handling for a resolved wiki link inside a Markdown heading. Full C02.1 and migration phases R3-R7 remain pending. Next: review the remaining C02.1 Markdown dialect gaps and select one isolated fixture-backed behavior for R2.8.44.

### R2.8.44 in progress — code-context wiki-link markers remain literal

Starting from tracker checkpoint `c08ef15f590ca496a56e0d93fc6b2521cc7e4069`, inventory [run 38076155373](https://github.com/ashutoshpw/open-obsidian/actions/runs/38076155373), job 114283409991, passed. Add egui source-preview coverage for the existing `literal-markers-inside-code` C02.1 fixture: its wiki-link markers inside inline and fenced code must remain literal, unresolved, and non-clickable while preserving vault and app-data bytes. Push this focused slice for exact-SHA GitHub Actions; no executable validation runs locally.

### R2.8.44 accepted — code-context wiki-link markers remain literal — source SHA `8006dd7002965a57ac40135d3fb38e9edac536d3`

The existing `literal-markers-inside-code` fixture now drives an egui source-preview test. It verifies the resolver finds no links inside inline or fenced code, the preview renders without wiki-link fallback or clickable links, and source, vault, and app-data bytes remain unchanged. The focused egui case passed on Ubuntu, macOS, and Windows.

All seven required workflows passed on this exact SHA: inventory [38076297763](https://github.com/ashutoshpw/open-obsidian/actions/runs/38076297763), loaded-plugin workflows [38076297841](https://github.com/ashutoshpw/open-obsidian/actions/runs/38076297841), desktop build [38076297715](https://github.com/ashutoshpw/open-obsidian/actions/runs/38076297715), quality [38076297735](https://github.com/ashutoshpw/open-obsidian/actions/runs/38076297735), Rust CI [38076297794](https://github.com/ashutoshpw/open-obsidian/actions/runs/38076297794), plugin renderer [38076297761](https://github.com/ashutoshpw/open-obsidian/actions/runs/38076297761), and Obsidian vault round-trip [38076297768](https://github.com/ashutoshpw/open-obsidian/actions/runs/38076297768). Rust CI used rustc 1.99.0 (`b940084d7`, 2026-09-28); job IDs and artifact digests are recorded in [evidence/r2.8.44-code-markers-remain-literal-8006dd7.json](evidence/r2.8.44-code-markers-remain-literal-8006dd7.json). Native `parallel:` groups ran in Rust CI and Obsidian vault round-trip. No local executable validation was used.

Accepted slice: literal handling for wiki-link markers inside inline and fenced code. Full C02.1 and migration phases R3-R7 remain pending. Next: verify the existing escaped-highlight-opener fixture in native preview as R2.8.45.

### R2.8.45 in progress — escaped highlight opener remains literal

Starting from tracker checkpoint `c42a4a8bedd750a082177f6af38a42cbba27cd1b`, inventory [run 38076833787](https://github.com/ashutoshpw/open-obsidian/actions/runs/38076833787), job 114285470515, passed. Add egui preview coverage for the existing `escaped-highlight-opener-is-literal` C02.1 fixture. The escaped `==` opener must remain visible as literal Markdown, produce no highlight span, and preserve the fixture source bytes. Push the focused slice for exact-SHA GitHub Actions; no executable validation runs locally.

Attempt 1 on implementation SHA `7a002250` failed in Rust CI on Ubuntu, macOS, and Windows. The exact assertion expected the whole paragraph as one accessibility label; GitHub logs show the escaped text as the node label `==this phrase== as literal text.`. The test now queries the actual emitted label and will be rerun on a new exact SHA. No local test or formatter was used.

### R2.8.45 accepted — escaped highlight opener remains literal — source SHA `ddaa4122c04e60cadd69825145e1f79fbb005f70`

After correcting the accessibility query, the fixture-driven egui test confirms the escaped `==` delimiters remain visible as literal text and no highlight span is produced. The focused case passed on Ubuntu, macOS, and Windows. All seven workflows passed on the accepted SHA: inventory [38077150604](https://github.com/ashutoshpw/open-obsidian/actions/runs/38077150604), loaded-plugin workflows [38077150596](https://github.com/ashutoshpw/open-obsidian/actions/runs/38077150596), desktop build [38077150598](https://github.com/ashutoshpw/open-obsidian/actions/runs/38077150598), quality [38077150615](https://github.com/ashutoshpw/open-obsidian/actions/runs/38077150615), Rust CI [38077150576](https://github.com/ashutoshpw/open-obsidian/actions/runs/38077150576), plugin renderer [38077150586](https://github.com/ashutoshpw/open-obsidian/actions/runs/38077150586), and Obsidian vault round-trip [38077150578](https://github.com/ashutoshpw/open-obsidian/actions/runs/38077150578). Rust CI used rustc 1.99.0 (`b940084d7`, 2026-09-28); job IDs, artifacts, and the failed first attempt are recorded in [evidence/r2.8.45-escaped-highlight-literal-ddaa412.json](evidence/r2.8.45-escaped-highlight-literal-ddaa412.json). No local executable validation was used.

Accepted slice: escaped highlight markers remain literal and read-only in native preview. Full C02.1 and migration phases R3-R7 remain pending. Next: check the mixed-formatting highlight fixture's source-only fallback in R2.8.46.

### R2.8.46 in progress — mixed-formatting highlights use source fallback

Starting from tracker checkpoint `fce50a295a53bcc0a191591b8bab6a58307c814c`, inventory [run 38077690594](https://github.com/ashutoshpw/open-obsidian/actions/runs/38077690594), job 114287998844, passed. Add egui preview coverage for the existing `highlight-mixed-with-markdown-formatting` fixture. The preview should explain that highlights are unsupported in this mixed form, show the original source intact, and keep the source bytes unchanged. Push the focused slice for exact-SHA GitHub Actions; no executable validation runs locally.

### R2.8.46 accepted — mixed-formatting highlights use source fallback — source SHA `0df8f8ca8ea6181d1d665006d1bac478ca247064`

The fixture-driven egui preview test confirms mixed emphasis and highlight syntax is shown as source with an explicit unsupported-highlights message and no projected highlight span. The original source remains unchanged. The focused case passed on Ubuntu, macOS, and Windows.

All seven workflows passed on this exact SHA: inventory [38077740796](https://github.com/ashutoshpw/open-obsidian/actions/runs/38077740796), loaded-plugin workflows [38077740745](https://github.com/ashutoshpw/open-obsidian/actions/runs/38077740745), desktop build [38077740675](https://github.com/ashutoshpw/open-obsidian/actions/runs/38077740675), quality [38077740749](https://github.com/ashutoshpw/open-obsidian/actions/runs/38077740749), Rust CI [38077740698](https://github.com/ashutoshpw/open-obsidian/actions/runs/38077740698), plugin renderer [38077740789](https://github.com/ashutoshpw/open-obsidian/actions/runs/38077740789), and Obsidian vault round-trip [38077740761](https://github.com/ashutoshpw/open-obsidian/actions/runs/38077740761). Rust CI used rustc 1.99.0 (`b940084d7`, 2026-09-28); job IDs and artifact digests are recorded in [evidence/r2.8.46-mixed-formatting-highlight-fallback-0df8f8c.json](evidence/r2.8.46-mixed-formatting-highlight-fallback-0df8f8c.json). No local executable validation was used.

Accepted slice: mixed-formatting highlights remain source-only. Full C02.1 and migration phases R3-R7 remain pending. Next: check the attribute-bearing HTML line-break fallback in R2.8.47.

### R2.8.47 in progress — attribute-bearing HTML line breaks remain source-only

Use the existing `html-break-with-attributes-remains-source` fixture to verify the native preview identifies raw HTML as unsupported and displays the original source without mutation. The fixture-driven egui case is added; push this focused slice for exact-SHA GitHub Actions. No executable validation runs locally.

Starting from tracker checkpoint `9986a6af0e047d213232edf51901efcc559f656a`, inventory [run 38078130253](https://github.com/ashutoshpw/open-obsidian/actions/runs/38078130253), job 114289293256, passed.

### R2.8.47 accepted — attribute-bearing HTML line breaks remain source-only — source SHA `56c398d0f604219ed206ec95a322311e63dad6fc`

The fixture-driven egui test confirms `<br class=wide>` produces the raw-HTML fallback and displays the exact source. The focused case passed on Ubuntu, macOS, and Windows. All seven workflows passed on this exact SHA: inventory [38078177857](https://github.com/ashutoshpw/open-obsidian/actions/runs/38078177857), loaded-plugin workflows [38078177936](https://github.com/ashutoshpw/open-obsidian/actions/runs/38078177936), desktop build [38078177881](https://github.com/ashutoshpw/open-obsidian/actions/runs/38078177881), quality [38078177854](https://github.com/ashutoshpw/open-obsidian/actions/runs/38078177854), Rust CI [38078177855](https://github.com/ashutoshpw/open-obsidian/actions/runs/38078177855), plugin renderer [38078177894](https://github.com/ashutoshpw/open-obsidian/actions/runs/38078177894), and Obsidian vault round-trip [38078177971](https://github.com/ashutoshpw/open-obsidian/actions/runs/38078177971). Rust CI used rustc 1.99.0 (`b940084d7`, 2026-09-28); job IDs and artifact digests are recorded in [evidence/r2.8.47-html-break-attributes-source-only-56c398d.json](evidence/r2.8.47-html-break-attributes-source-only-56c398d.json). No local executable validation was used.

Accepted slice: attribute-bearing HTML breaks remain visible source-only. Full C02.1 and migration phases R3-R7 remain pending. Next: verify the even-backslash highlight fixture's active opener and source fallback in R2.8.48.

### R2.8.48 in progress — even-backslash highlight remains explicit source

Use the existing `even-backslash-run-keeps-highlight-active` fixture to verify an active highlight opener after an even backslash run receives the unsupported-highlights fallback and displays the original source unchanged. The fixture-driven egui case is added; push this focused slice for exact-SHA GitHub Actions. No executable validation runs locally.

Starting from tracker checkpoint `4a325896501d2581e9770caa5d57bbb59349d1f1`, inventory [run 38079330150](https://github.com/ashutoshpw/open-obsidian/actions/runs/38079330150), job 114292823765, passed.

### R2.8.48 accepted — even-backslash highlight stays active and source-only — source SHA `8ae3b8acf636a35ccc18a12bf4914c365dedbb02`

The fixture-driven egui test confirms the highlight opener remains active after an even backslash run, the analyzer selects source-only fallback without retaining a partial span, and the preview displays the original source. The focused case passed on Ubuntu, macOS, and Windows. All seven workflows passed on this exact SHA: inventory [38079424869](https://github.com/ashutoshpw/open-obsidian/actions/runs/38079424869), loaded-plugin workflows [38079424891](https://github.com/ashutoshpw/open-obsidian/actions/runs/38079424891), desktop build [38079424876](https://github.com/ashutoshpw/open-obsidian/actions/runs/38079424876), quality [38079424863](https://github.com/ashutoshpw/open-obsidian/actions/runs/38079424863), Rust CI [38079424880](https://github.com/ashutoshpw/open-obsidian/actions/runs/38079424880), plugin renderer [38079424850](https://github.com/ashutoshpw/open-obsidian/actions/runs/38079424850), and Obsidian vault round-trip [38079424878](https://github.com/ashutoshpw/open-obsidian/actions/runs/38079424878). Rust CI used rustc 1.99.0 (`b940084d7`, 2026-09-28); job IDs and artifact digests are recorded in [evidence/r2.8.48-even-backslash-highlight-fallback-8ae3b8a.json](evidence/r2.8.48-even-backslash-highlight-fallback-8ae3b8a.json). No local executable validation was used.

Accepted slice: an active even-backslash highlight opener remains source-only when the syntax is unsupported. Full C02.1 and migration phases R3-R7 remain pending. Next: verify the legacy delimited math fixture's source-only fallback in R2.8.49.

### R2.8.49 in progress — legacy delimited math uses source fallback

Use the existing `legacy-delimited-math` fixture to verify the preview identifies legacy math delimiters as unsupported and displays the original source unchanged. Push this focused slice for exact-SHA GitHub Actions; no executable validation runs locally.

Starting from tracker checkpoint `6985063e723a100f342864bf965d8959152627b5`, inventory [run 38080064698](https://github.com/ashutoshpw/open-obsidian/actions/runs/38080064698), job 114294968243, passed.

### R2.8.49 accepted — legacy delimited math uses source fallback — source SHA `17235d180c0a7d233aa79a7d0f9e2f48d3a13e4f`

The existing `legacy-delimited-math` C02.1 fixture now drives an egui preview test. It verifies the preview labels legacy math delimiters as unsupported, displays the exact fixture source, and leaves its bytes unchanged. The focused test passed on Ubuntu, macOS, and Windows; each platform's `ui-egui` suite passed 87 tests.

All seven required workflows passed on this exact source SHA: inventory [38080241011](https://github.com/ashutoshpw/open-obsidian/actions/runs/38080241011), loaded-plugin workflows [38080241041](https://github.com/ashutoshpw/open-obsidian/actions/runs/38080241041), desktop build [38080241039](https://github.com/ashutoshpw/open-obsidian/actions/runs/38080241039), quality [38080241030](https://github.com/ashutoshpw/open-obsidian/actions/runs/38080241030), Rust CI [38080241040](https://github.com/ashutoshpw/open-obsidian/actions/runs/38080241040), plugin renderer [38080240989](https://github.com/ashutoshpw/open-obsidian/actions/runs/38080240989), and Obsidian vault round-trip [38080241014](https://github.com/ashutoshpw/open-obsidian/actions/runs/38080241014). The first Linux round-trip attempt failed at `xdotool search --onlyvisible --name .`; retry attempt 2 passed on the same SHA. Rust CI used rustc 1.99.0 (`b940084d7`, 2026-09-28). Job IDs, both Linux attempt artifacts, all artifact digests, and the retry details are recorded in [evidence/r2.8.49-legacy-delimited-math-fallback-17235d1.json](evidence/r2.8.49-legacy-delimited-math-fallback-17235d1.json). Native `parallel:` groups ran in Rust CI and the vault round-trip workflow. No local executable validation was used.

Accepted slice: the legacy delimited math fixture remains visible source-only with an explicit reason and no source mutation. Full C02.1 and migration phases R3-R7 remain pending. Next: verify the existing Mermaid diagram fixture uses the visible source-only fallback in R2.8.50.

### R2.8.50 in progress — Mermaid diagram remains source-only

Use the existing `mermaid-diagram` C02.1 fixture to verify that the native preview identifies diagrams as unsupported and displays the original fenced source unchanged. Add fixture-driven egui coverage, then push for exact-SHA GitHub Actions; no executable validation runs locally.

The fixture-driven egui test is added in `crates/ui-egui/src/lib.rs`. It asserts the source-only disposition, the explicit diagrams fallback message, the exact fixture source in the accessibility tree, and unchanged source bytes. Commit and push for exact-SHA GitHub Actions; no local executable validation runs.

R2.8.50 tracker checkpoint: inventory [run 38081195364](https://github.com/ashutoshpw/open-obsidian/actions/runs/38081195364), job 114298287270, passed for tracker SHA `b81cf8d44bb6b80c23522a17c91c23c97c780e86`.

### R2.8.50 accepted — Mermaid diagram remains source-only — source SHA `1bb6bd42385264f8666b0d3ef1192a37276d8beb`

The existing `mermaid-diagram` C02.1 fixture now drives an egui preview test. It confirms the analyzer selects `ShowSource`, the preview announces unsupported diagrams, and the complete fenced source remains visible with unchanged bytes. The focused case passed on Ubuntu, macOS, and Windows; each platform's `ui-egui` suite passed 88 tests.

All seven required workflows passed on this exact source SHA: inventory [38081307837](https://github.com/ashutoshpw/open-obsidian/actions/runs/38081307837), loaded-plugin workflows [38081307870](https://github.com/ashutoshpw/open-obsidian/actions/runs/38081307870), desktop build [38081307852](https://github.com/ashutoshpw/open-obsidian/actions/runs/38081307852), quality [38081307835](https://github.com/ashutoshpw/open-obsidian/actions/runs/38081307835), Rust CI [38081307857](https://github.com/ashutoshpw/open-obsidian/actions/runs/38081307857), plugin renderer [38081307847](https://github.com/ashutoshpw/open-obsidian/actions/runs/38081307847), and Obsidian vault round-trip [38081307838](https://github.com/ashutoshpw/open-obsidian/actions/runs/38081307838). The first Linux round-trip attempt failed at `xdotool search --onlyvisible --name .`; retry attempt 2 passed on the same SHA. Rust CI used rustc 1.99.0 (`b940084d7`, 2026-09-28). Job IDs, both Linux attempt artifacts, all artifact digests, and retry details are recorded in [evidence/r2.8.50-mermaid-diagram-source-fallback-1bb6bd4.json](evidence/r2.8.50-mermaid-diagram-source-fallback-1bb6bd4.json). Native `parallel:` groups ran in Rust CI and the vault round-trip workflow. No local executable validation was used.

Accepted slice: Mermaid fenced diagrams remain visible source-only with an explicit reason. Full C02.1 and migration phases R3-R7 remain pending. Next: verify an unsupported raw-HTML block makes a document with otherwise supported Markdown stay entirely source-only in R2.8.51.

### R2.8.51 in progress — mixed supported and unsupported Markdown stays source-only

Use the existing `mixed-supported-and-unsupported` C02.1 fixture, which combines a heading and math with a raw HTML script block. Verify the preview reports the raw-HTML fallback, presents the entire original document as source, does not project the heading or formula partially, and preserves the source bytes. Add fixture-driven egui coverage and push for exact-SHA GitHub Actions; no local executable validation runs.

The fixture-driven egui test is added in `crates/ui-egui/src/lib.rs`. It checks `ShowSource`, the raw-HTML fallback message, the complete source label, absence of separately rendered heading/formula labels, and unchanged source bytes. Push this focused change for exact-SHA GitHub Actions; no local executable validation runs.

R2.8.51 tracker checkpoint: inventory [run 38082110532](https://github.com/ashutoshpw/open-obsidian/actions/runs/38082110532), job 114300986023, passed for tracker SHA `dda71d1b8b0fb65302c621d17245f4939b34dd99`.

### R2.8.51 accepted — mixed supported and unsupported Markdown stays source-only — source SHA `d527e45cffa8bdcd1e5c3863fe7aa24cf1a31e48`

The existing `mixed-supported-and-unsupported` C02.1 fixture now drives an egui preview test. It verifies that unsupported raw HTML selects `ShowSource`, the fallback message and complete source are visible, the heading and formula do not appear as separately rendered nodes, and source bytes remain unchanged. The focused test passed on Ubuntu, macOS, and Windows; each platform's `ui-egui` suite passed 89 tests.

All seven required workflows passed on this exact source SHA: inventory [38082227704](https://github.com/ashutoshpw/open-obsidian/actions/runs/38082227704), loaded-plugin workflows [38082227732](https://github.com/ashutoshpw/open-obsidian/actions/runs/38082227732), desktop build [38082227692](https://github.com/ashutoshpw/open-obsidian/actions/runs/38082227692), quality [38082227721](https://github.com/ashutoshpw/open-obsidian/actions/runs/38082227721), Rust CI [38082227688](https://github.com/ashutoshpw/open-obsidian/actions/runs/38082227688), plugin renderer [38082227723](https://github.com/ashutoshpw/open-obsidian/actions/runs/38082227723), and Obsidian vault round-trip [38082227685](https://github.com/ashutoshpw/open-obsidian/actions/runs/38082227685). The initial Windows Rust CI attempt had an existing attachment-refresh test time out waiting five seconds for its link-resolver worker; retry attempt 2 passed on the same SHA. Rust CI used rustc 1.99.0 (`b940084d7`, 2026-09-28). Job IDs, both attempts, artifact digests, and the failure details are recorded in [evidence/r2.8.51-mixed-markdown-source-fallback-d527e45.json](evidence/r2.8.51-mixed-markdown-source-fallback-d527e45.json). Native `parallel:` groups ran in Rust CI and the vault round-trip workflow. No local executable validation was used.

Accepted slice: documents that mix supported Markdown with unsupported raw HTML remain entirely source-only. Full C02.1 and migration phases R3-R7 remain pending. Next: verify the raw-HTML script fixture remains literal in the preview in R2.8.52.

### R2.8.52 in progress — raw HTML script remains source-only

Use the existing `raw-html` C02.1 fixture, containing `<script>alert('not executed')</script>`, to verify the native preview explains the raw-HTML fallback and displays the exact script source as text without projecting or executing it. Add fixture-driven egui coverage and push for exact-SHA GitHub Actions; no executable validation runs locally.

R2.8.52 tracker checkpoint: inventory [run 38083231666](https://github.com/ashutoshpw/open-obsidian/actions/runs/38083231666), job 114304284483, passed for tracker SHA `30129623e4c1ff6ada96e7011d253cf3d4e987dc`.

The fixture-driven egui test is added in `crates/ui-egui/src/lib.rs`. It checks the source-only disposition, explicit raw-HTML fallback message, literal script source in the accessibility tree, and unchanged source bytes. Push this focused change for exact-SHA GitHub Actions; no local executable validation runs.

### R2.8.52 accepted — raw HTML script remains source-only — source SHA `50455182afb258eb221ba38bef9c77870ce1ab83`

The existing `raw-html` C02.1 fixture now drives an egui preview test. It verifies `ShowSource`, the explicit raw-HTML fallback message, literal display of the exact `<script>` source, and unchanged source bytes. The focused test passed on Ubuntu, macOS, and Windows; each platform's `ui-egui` suite passed 90 tests.

All seven required workflows passed on this exact source SHA: inventory [38083294837](https://github.com/ashutoshpw/open-obsidian/actions/runs/38083294837), loaded-plugin workflows [38083294763](https://github.com/ashutoshpw/open-obsidian/actions/runs/38083294763), desktop build [38083294813](https://github.com/ashutoshpw/open-obsidian/actions/runs/38083294813), quality [38083294694](https://github.com/ashutoshpw/open-obsidian/actions/runs/38083294694), Rust CI [38083294749](https://github.com/ashutoshpw/open-obsidian/actions/runs/38083294749), plugin renderer [38083294785](https://github.com/ashutoshpw/open-obsidian/actions/runs/38083294785), and Obsidian vault round-trip [38083294727](https://github.com/ashutoshpw/open-obsidian/actions/runs/38083294727). Rust CI used rustc 1.99.0 (`b940084d7`, 2026-09-28); job IDs and artifact digests are recorded in [evidence/r2.8.52-raw-html-script-source-fallback-5045518.json](evidence/r2.8.52-raw-html-script-source-fallback-5045518.json). Native `parallel:` groups ran in Rust CI and the vault round-trip workflow. No local executable validation was used.

Accepted slice: raw HTML script content remains visible as source and is not projected in the native preview. Full C02.1 and migration phases R3-R7 remain pending. Next: verify unknown extension markup remains literal in R2.8.53.

### R2.8.53 in progress — unknown extension markup remains literal

Use the existing `unknown-markup-remains-literal` C02.1 fixture to confirm the `%%` extension marker stays visible as literal text under native CommonMark rendering, without triggering the unsupported-syntax fallback. Preserve the fixture source bytes and validate only through exact-SHA GitHub Actions.

The fixture-driven egui test is added in `crates/ui-egui/src/lib.rs`. It checks `RenderMarkdown`, the full literal source label, absence of a raw-HTML fallback message, and unchanged source bytes. Push the focused change for exact-SHA GitHub Actions; no local executable validation runs.

R2.8.53 tracker checkpoint: inventory [run 38083742362](https://github.com/ashutoshpw/open-obsidian/actions/runs/38083742362), job 114305797972, passed for tracker SHA `4435d7755f2fd1512588609c765ef2299312ca46`.

### R2.8.53 accepted — unknown extension markup remains literal — source SHA c4bd5e5b3478014a402a850afda051154efb525d

The existing unknown-markup-remains-literal C02.1 fixture now drives an egui preview test. It verifies that the analyzer selects RenderMarkdown, shows the exact %% source literally, does not show an unsupported raw-HTML fallback, and preserves the fixture bytes. The focused test passed on Ubuntu, macOS, and Windows; each platform's ui-egui suite passed 91 tests.

All seven required workflows passed on this exact source SHA: inventory [38083793948](https://github.com/ashutoshpw/open-obsidian/actions/runs/38083793948), loaded-plugin workflows [38083793913](https://github.com/ashutoshpw/open-obsidian/actions/runs/38083793913), desktop build [38083793915](https://github.com/ashutoshpw/open-obsidian/actions/runs/38083793915), quality [38083793943](https://github.com/ashutoshpw/open-obsidian/actions/runs/38083793943), Rust CI [38083793960](https://github.com/ashutoshpw/open-obsidian/actions/runs/38083793960), plugin renderer [38083793958](https://github.com/ashutoshpw/open-obsidian/actions/runs/38083793958), and Obsidian vault round-trip [38083794004](https://github.com/ashutoshpw/open-obsidian/actions/runs/38083794004). Quality attempt 1 failed only on macOS in the Electron vault retrieval-boundary audit; rerunning the failed job on the same SHA passed. Rust CI used rustc 1.99.0 (b940084d7, 2026-09-28). Job IDs, artifact digests, and the retry record are in [evidence/r2.8.53-unknown-markup-literal-c4bd5e5.json](evidence/r2.8.53-unknown-markup-literal-c4bd5e5.json). Native parallel groups ran in Rust CI and the vault round-trip workflow. No local executable validation was used.

Accepted slice: unknown extension markup stays visible as ordinary Markdown text without triggering source fallback. Full C02.1 and migration phases R3-R7 remain pending. Next: verify legacy math delimiters inside indented code remain ordinary rendered code in R2.8.54.

### R2.8.54 in progress — legacy math inside indented code remains literal

Use the existing legacy-math-inside-indented-code C02.1 fixture to verify that legacy math delimiters inside an indented code block do not trigger the unsupported-math fallback. The preview should keep the fixture on the RenderMarkdown path, show the original code literally, and preserve source bytes. Add fixture-driven egui coverage and push for exact-SHA GitHub Actions; no local executable validation runs.

R2.8.54 tracker checkpoint: inventory [run 38084316519](https://github.com/ashutoshpw/open-obsidian/actions/runs/38084316519), job 114307488452, passed for tracker SHA 94b057532f005d67eee6a0c6a334690ec3704024.

The fixture-driven egui case is added in crates/ui-egui/src/lib.rs. It checks RenderMarkdown, the literal code content, absence of the legacy-math source fallback, and unchanged source bytes. Commit and push the focused case for exact-SHA GitHub Actions; no local executable validation runs.

The first implementation CI attempt failed on all three platforms because the code block's literal text is exposed as an accessibility value rather than an exact label. The assertion now checks the value. macOS also reported a failure in an unrelated existing empty-vault refresh timing assertion; check the corrected source SHA before attributing or accepting that result.

### R2.8.54 accepted — legacy math inside indented code remains literal — source SHA 81bda29b1f938f8ebc2cb7674b265b11ca765297

The existing legacy-math-inside-indented-code C02.1 fixture now drives an egui preview test. It verifies that the analyzer selects RenderMarkdown, the literal code is exposed as an accessibility value, the legacy-math fallback is absent, and the source bytes remain unchanged. The focused test passed on Ubuntu, macOS, and Windows; each platform's ui-egui suite passed 92 tests.

All seven required workflows passed on this exact source SHA: inventory [38084695689](https://github.com/ashutoshpw/open-obsidian/actions/runs/38084695689), loaded-plugin workflows [38084695706](https://github.com/ashutoshpw/open-obsidian/actions/runs/38084695706), desktop build [38084695734](https://github.com/ashutoshpw/open-obsidian/actions/runs/38084695734), quality [38084695721](https://github.com/ashutoshpw/open-obsidian/actions/runs/38084695721), Rust CI [38084695757](https://github.com/ashutoshpw/open-obsidian/actions/runs/38084695757), plugin renderer [38084695719](https://github.com/ashutoshpw/open-obsidian/actions/runs/38084695719), and Obsidian vault round-trip [38084695776](https://github.com/ashutoshpw/open-obsidian/actions/runs/38084695776). The first implementation commit b7d72a9 used an exact-label query; CI showed the literal code is exposed as an accessibility value, so the test was corrected in 81bda29. An unrelated existing macOS empty-vault refresh timing assertion failed on the first SHA but did not recur on the accepted SHA. Job IDs, artifact digests, and the superseded attempt are recorded in [evidence/r2.8.54-indented-math-code-literal-81bda29.json](evidence/r2.8.54-indented-math-code-literal-81bda29.json). Native parallel groups ran in Rust CI and the vault round-trip workflow. No local executable validation was used.

Accepted slice: legacy math delimiters inside indented code remain visible as code and do not trigger source fallback. Full C02.1 and migration phases R3-R7 remain pending. Next: verify that both plain inline highlights render from their fixture in R2.8.55.

### R2.8.55 in progress — multiple plain inline highlights render together

Use the existing multiple-plain-highlights C02.1 fixture to verify both expected highlight phrases appear in the Markdown preview, with RenderMarkdown disposition and unchanged source bytes. Add fixture-driven egui coverage and push for exact-SHA GitHub Actions; no local executable validation runs.

R2.8.55 tracker checkpoint: inventory [run 38085191217](https://github.com/ashutoshpw/open-obsidian/actions/runs/38085191217), job 114310136384, passed for tracker SHA bb8c200506018dc117adf07451fa793746a1c5ef.

The fixture-driven egui case is added in crates/ui-egui/src/lib.rs. It checks RenderMarkdown, both expected highlight spans and their visible text, and unchanged source bytes. Commit and push the focused case for exact-SHA GitHub Actions; no local executable validation runs.

### R2.8.55 accepted — multiple plain inline highlights render together — source SHA e2b1df91c0ec906d70143933335ede8473692d90

The existing multiple-plain-highlights C02.1 fixture now drives an egui preview test. It verifies RenderMarkdown, both expected highlight texts, and unchanged source bytes. The focused test passed on Ubuntu, macOS, and Windows; each platform's ui-egui suite passed 93 tests.

All seven required workflows passed on this exact source SHA: inventory [38085254558](https://github.com/ashutoshpw/open-obsidian/actions/runs/38085254558), loaded-plugin workflows [38085254551](https://github.com/ashutoshpw/open-obsidian/actions/runs/38085254551), desktop build [38085254564](https://github.com/ashutoshpw/open-obsidian/actions/runs/38085254564), quality [38085254574](https://github.com/ashutoshpw/open-obsidian/actions/runs/38085254574), Rust CI [38085254560](https://github.com/ashutoshpw/open-obsidian/actions/runs/38085254560), plugin renderer [38085254563](https://github.com/ashutoshpw/open-obsidian/actions/runs/38085254563), and Obsidian vault round-trip [38085254593](https://github.com/ashutoshpw/open-obsidian/actions/runs/38085254593). Quality attempt 1 failed only on macOS at the intermittent Electron local retrieval-boundary audit; rerunning failed jobs on the same SHA passed all three platforms. Exact job IDs, artifacts, and retry details are in [evidence/r2.8.55-multiple-plain-highlights-e2b1df9.json](evidence/r2.8.55-multiple-plain-highlights-e2b1df9.json). Native parallel groups ran in Rust CI and the vault round-trip workflow. No local executable validation was used.

Accepted slice: both plain inline highlight spans render in the native preview and the fixture source remains unchanged. Full C02.1 and migration phases R3-R7 remain pending.

### R2.8.56 in progress — safe HTML line break before CRLF

Use the existing safe-html-inline-break-before-crlf C02.1 fixture to verify the preview selects RenderMarkdown and produces the expected two-line native rendering while preserving the original CRLF source bytes. Add focused fixture-driven egui coverage and push for exact-SHA GitHub Actions; no local executable validation runs.

R2.8.56 tracker checkpoint: inventory [run 38085825358](https://github.com/ashutoshpw/open-obsidian/actions/runs/38085825358), job 114311987124, passed for tracker SHA 36b73c0088d58400baf072d946ad2fa53e4902f4.

### R2.8.56 accepted — safe HTML line break before CRLF — source SHA 1db003128ea61085806e03c863ea143f433e71f8

The existing safe-html-inline-break-before-crlf C02.1 fixture now drives an egui preview test. It verifies RenderMarkdown, the expected native-render source with a Markdown hard break, visible text on both lines, and unchanged CRLF source bytes. The focused test passed on Ubuntu, macOS, and Windows; each platform's ui-egui suite passed 94 tests.

All seven required workflows passed on this exact source SHA: inventory [38085899734](https://github.com/ashutoshpw/open-obsidian/actions/runs/38085899734), loaded-plugin workflows [38085899738](https://github.com/ashutoshpw/open-obsidian/actions/runs/38085899738), desktop build [38085899740](https://github.com/ashutoshpw/open-obsidian/actions/runs/38085899740), quality [38085899739](https://github.com/ashutoshpw/open-obsidian/actions/runs/38085899739), Rust CI [38085899732](https://github.com/ashutoshpw/open-obsidian/actions/runs/38085899732), plugin renderer [38085899743](https://github.com/ashutoshpw/open-obsidian/actions/runs/38085899743), and Obsidian vault round-trip [38085899726](https://github.com/ashutoshpw/open-obsidian/actions/runs/38085899726). Exact job IDs and artifact digests are in [evidence/r2.8.56-safe-html-break-before-crlf-1db0031.json](evidence/r2.8.56-safe-html-break-before-crlf-1db0031.json). Native parallel groups ran in Rust CI and the vault round-trip workflow. No local executable validation was used.

Accepted slice: the allowlisted HTML break followed by CRLF renders as a native hard break while retaining the original source bytes. Full C02.1 and migration phases R3-R7 remain pending.

### R2.8.57 in progress — self-closing safe HTML line break

Use the existing safe-html-inline-break-self-closing C02.1 fixture to verify the preview selects RenderMarkdown and renders the expected two text lines while preserving the original source bytes. Add focused fixture-driven egui coverage and push for exact-SHA GitHub Actions; no local executable validation runs.

R2.8.57 tracker checkpoint: inventory [run 38086361576](https://github.com/ashutoshpw/open-obsidian/actions/runs/38086361576), job 114313592142, passed for tracker SHA 4ab381bbd04cbcc72abbff365f630ce26e786372.

### R2.8.57 accepted — self-closing safe HTML line break — source SHA ac6cf578fae6acd9aacc3c3d8a5c1f833f6cb093

The existing safe-html-inline-break-self-closing C02.1 fixture now drives an egui preview test. It verifies RenderMarkdown, the expected native-render source with a Markdown hard break, visible text on both lines, and unchanged source bytes. The focused test passed on Ubuntu, macOS, and Windows; each platform's ui-egui suite passed 95 tests.

All seven required workflows passed on this exact source SHA: inventory [38086419026](https://github.com/ashutoshpw/open-obsidian/actions/runs/38086419026), loaded-plugin workflows [38086419029](https://github.com/ashutoshpw/open-obsidian/actions/runs/38086419029), desktop build [38086419007](https://github.com/ashutoshpw/open-obsidian/actions/runs/38086419007), quality [38086419037](https://github.com/ashutoshpw/open-obsidian/actions/runs/38086419037), Rust CI [38086418999](https://github.com/ashutoshpw/open-obsidian/actions/runs/38086418999), plugin renderer [38086419053](https://github.com/ashutoshpw/open-obsidian/actions/runs/38086419053), and Obsidian vault round-trip [38086419009](https://github.com/ashutoshpw/open-obsidian/actions/runs/38086419009). Exact job IDs and artifact digests are in [evidence/r2.8.57-self-closing-html-break-ac6cf57.json](evidence/r2.8.57-self-closing-html-break-ac6cf57.json). Native parallel groups ran in Rust CI and the vault round-trip workflow. No local executable validation was used.

Accepted slice: the allowlisted `<br/>` form renders as a native hard break while retaining the original source bytes. Full C02.1 and migration phases R3-R7 remain pending.

### R2.8.58 in progress — spaced self-closing safe HTML line break

Use the existing safe-html-inline-break-spaced-self-closing C02.1 fixture to verify the preview selects RenderMarkdown and renders the expected two text lines while preserving the original source bytes. Add focused fixture-driven egui coverage and push for exact-SHA GitHub Actions; no local executable validation runs.

R2.8.58 tracker checkpoint: inventory [run 38086875802](https://github.com/ashutoshpw/open-obsidian/actions/runs/38086875802), job 114315123074, passed for tracker SHA d165f95cce2645454b32cedb5585a84945e00ac8.

### R2.8.58 accepted — spaced self-closing safe HTML line break — source SHA d1e6283339193b6c72273cccf4ce657e2c7063e6

The existing safe-html-inline-break-spaced-self-closing C02.1 fixture now drives an egui preview test. It verifies RenderMarkdown, the expected native-render source with a Markdown hard break, visible text on both lines, and unchanged source bytes. The focused test passed on Ubuntu, macOS, and Windows; each platform's ui-egui suite passed 96 tests.

All seven required workflows passed on this exact source SHA: inventory [38086933721](https://github.com/ashutoshpw/open-obsidian/actions/runs/38086933721), loaded-plugin workflows [38086933663](https://github.com/ashutoshpw/open-obsidian/actions/runs/38086933663), desktop build [38086933763](https://github.com/ashutoshpw/open-obsidian/actions/runs/38086933763), quality [38086933624](https://github.com/ashutoshpw/open-obsidian/actions/runs/38086933624), Rust CI [38086933673](https://github.com/ashutoshpw/open-obsidian/actions/runs/38086933673), plugin renderer [38086933728](https://github.com/ashutoshpw/open-obsidian/actions/runs/38086933728), and Obsidian vault round-trip [38086933662](https://github.com/ashutoshpw/open-obsidian/actions/runs/38086933662). Exact job IDs and artifact digests are in [evidence/r2.8.58-spaced-self-closing-html-break-d1e6283.json](evidence/r2.8.58-spaced-self-closing-html-break-d1e6283.json). Native parallel groups ran in Rust CI and the vault round-trip workflow. No local executable validation was used.

Accepted slice: the allowlisted `<br />` form renders as a native hard break while retaining the original source bytes. Full C02.1 and migration phases R3-R7 remain pending.

### R2.8.59 in progress — canonical safe HTML line-break fixture

Use the existing safe-html-inline-break C02.1 fixture to verify the preview selects RenderMarkdown and produces the expected native-render source and visible text on both lines while preserving the original source bytes. Convert the existing direct-string egui case to fixture-driven coverage and push for exact-SHA GitHub Actions; no local executable validation runs.

R2.8.59 tracker checkpoint: inventory [run 38087496025](https://github.com/ashutoshpw/open-obsidian/actions/runs/38087496025), job 114316954570, passed for tracker SHA 38123bc7abc1a7a2dc3510cd265904140b017bb4.

### R2.8.59 accepted — canonical safe HTML line-break fixture — source SHA 56a408ac224bb87cb8f2e263a376c55087e171b9

The canonical safe-html-inline-break C02.1 fixture now drives the egui preview test. It verifies RenderMarkdown, the fixture's expected native-render source, visible text on both lines, and unchanged source bytes. The focused test passed on Ubuntu, macOS, and Windows; each platform's ui-egui suite passed 96 tests.

All seven required workflows passed on this exact source SHA: inventory [38087589281](https://github.com/ashutoshpw/open-obsidian/actions/runs/38087589281), loaded-plugin workflows [38087589291](https://github.com/ashutoshpw/open-obsidian/actions/runs/38087589291), desktop build [38087589278](https://github.com/ashutoshpw/open-obsidian/actions/runs/38087589278), quality [38087589284](https://github.com/ashutoshpw/open-obsidian/actions/runs/38087589284), Rust CI [38087589268](https://github.com/ashutoshpw/open-obsidian/actions/runs/38087589268), plugin renderer [38087589269](https://github.com/ashutoshpw/open-obsidian/actions/runs/38087589269), and Obsidian vault round-trip [38087589313](https://github.com/ashutoshpw/open-obsidian/actions/runs/38087589313). The first vault attempt failed only at Ubuntu X11 visible-window discovery; retry attempt 2 passed all three platforms on the same SHA. Exact job IDs and artifact digests are in [evidence/r2.8.59-canonical-safe-html-break-56a408a.json](evidence/r2.8.59-canonical-safe-html-break-56a408a.json). Native parallel groups ran in Rust CI and the vault round-trip workflow. No local executable validation was used.

Accepted slice: the canonical allowlisted `<br>` fixture renders as a native hard break while retaining the original source bytes. Full C02.1 and migration phases R3-R7 remain pending.

### R2.8.60 in progress — footnote fixture preview coverage

Use the existing footnote C02.1 fixture to verify the preview selects RenderMarkdown, exposes the reference sentence and definition body, and preserves the original source bytes. Convert the direct-string egui case to fixture-driven coverage and push for exact-SHA GitHub Actions; no local executable validation runs.

R2.8.60 tracker checkpoint: inventory [run 38088389129](https://github.com/ashutoshpw/open-obsidian/actions/runs/38088389129), job 114319596343, passed for tracker SHA 645f73ce00ff9e36988f019c922a74676e46a2f2.

### R2.8.60 accepted — footnote fixture preview coverage — source SHA e2293a33dc1070a7130fc6a1991632dd9fff47ba

The existing footnote C02.1 fixture now drives the egui preview test. It verifies RenderMarkdown, the visible reference and footnote body, no raw-HTML source fallback, and unchanged fixture bytes. The focused Rust UI test passed on Ubuntu, macOS, and Windows; each platform's ui-egui suite passed 96 tests.

All seven required workflows passed on this exact source SHA: inventory [38088479335](https://github.com/ashutoshpw/open-obsidian/actions/runs/38088479335), loaded-plugin workflows [38088479392](https://github.com/ashutoshpw/open-obsidian/actions/runs/38088479392), desktop build [38088479334](https://github.com/ashutoshpw/open-obsidian/actions/runs/38088479334), quality [38088479339](https://github.com/ashutoshpw/open-obsidian/actions/runs/38088479339), Rust CI [38088479349](https://github.com/ashutoshpw/open-obsidian/actions/runs/38088479349), plugin renderer [38088479441](https://github.com/ashutoshpw/open-obsidian/actions/runs/38088479441), and Obsidian vault round-trip [38088479326](https://github.com/ashutoshpw/open-obsidian/actions/runs/38088479326). Exact job IDs and artifact digests are in [evidence/r2.8.60-footnote-fixture-e2293a3.json](evidence/r2.8.60-footnote-fixture-e2293a3.json). Native parallel groups ran in Rust CI and the vault round-trip workflow. No local executable validation was used.

Accepted slice: the footnote fixture renders the reference and definition in the native preview while preserving source bytes. Full C02.1 and migration phases R3-R7 remain pending.

### R2.8.61 in progress — inline and display math fixture preview

Use the existing inline-and-display-math C02.1 fixture to verify the preview selects RenderMarkdown, exposes both formulas, and preserves the original source bytes. Move the existing egui case onto fixture-driven coverage, then push for exact-SHA GitHub Actions; no local executable validation runs. The tracker inventory checkpoint is pending after the R2.8.60 acceptance record is pushed.

R2.8.61 tracker checkpoint: inventory [run 38089359790](https://github.com/ashutoshpw/open-obsidian/actions/runs/38089359790), job 114322424595, passed for tracker SHA e43bad8df82ef5a8001ab624374db6f98ba2f993.

### R2.8.61 accepted — inline and display math fixture preview — source SHA 3b3aca73db358cea7a2e13c2d845162813471fec

The existing inline-and-display-math C02.1 fixture now drives the egui preview test. It verifies RenderMarkdown, both rendered formulas, and unchanged fixture bytes. The focused Rust UI test passed on Ubuntu, macOS, and Windows; each platform's ui-egui suite passed 96 tests.

All seven required workflows passed on this exact source SHA: inventory [38089475114](https://github.com/ashutoshpw/open-obsidian/actions/runs/38089475114), loaded-plugin workflows [38089475052](https://github.com/ashutoshpw/open-obsidian/actions/runs/38089475052), desktop build [38089475098](https://github.com/ashutoshpw/open-obsidian/actions/runs/38089475098), quality [38089475057](https://github.com/ashutoshpw/open-obsidian/actions/runs/38089475057), Rust CI [38089475061](https://github.com/ashutoshpw/open-obsidian/actions/runs/38089475061), plugin renderer [38089475075](https://github.com/ashutoshpw/open-obsidian/actions/runs/38089475075), and Obsidian vault round-trip [38089475072](https://github.com/ashutoshpw/open-obsidian/actions/runs/38089475072). Exact job IDs and artifact digests are in [evidence/r2.8.61-inline-display-math-fixture-3b3aca7.json](evidence/r2.8.61-inline-display-math-fixture-3b3aca7.json). Native parallel groups ran in Rust CI and the vault round-trip workflow. No local executable validation was used.

Accepted slice: inline and display math from the shared C02.1 fixture render through the native preview while retaining the original source bytes. Full C02.1 and migration phases R3-R7 remain pending.

### R2.8.62 in progress — CommonMark basics fixture table preview

Use the existing commonmark-basics C02.1 fixture in the egui Markdown table preview test. Verify RenderMarkdown, the table headers and expected row values, and unchanged source bytes. Push the focused change for exact-SHA GitHub Actions; no local executable validation runs. The tracker inventory checkpoint is pending after the R2.8.61 acceptance record is pushed.

R2.8.62 tracker checkpoint: inventory [run 38090121657](https://github.com/ashutoshpw/open-obsidian/actions/runs/38090121657), job 114324667885, passed for tracker SHA 5b619026759880e90cadbceb6fb92cfe80fade7f.

### R2.8.62 accepted — CommonMark basics fixture table preview — source SHA d793bcb60dad1d6b4b9447e887a5ff91f7cd74b6

The existing commonmark-basics C02.1 fixture now drives the egui Markdown table preview test. It verifies RenderMarkdown, the table header and row values, and unchanged fixture bytes. The focused Rust UI test passed on Ubuntu, macOS, and Windows; each platform's ui-egui suite passed 96 tests.

All seven required workflows passed on this exact source SHA: inventory [38090184705](https://github.com/ashutoshpw/open-obsidian/actions/runs/38090184705), loaded-plugin workflows [38090184670](https://github.com/ashutoshpw/open-obsidian/actions/runs/38090184670), desktop build [38090184708](https://github.com/ashutoshpw/open-obsidian/actions/runs/38090184708), quality [38090184702](https://github.com/ashutoshpw/open-obsidian/actions/runs/38090184702), Rust CI [38090184696](https://github.com/ashutoshpw/open-obsidian/actions/runs/38090184696), plugin renderer [38090184679](https://github.com/ashutoshpw/open-obsidian/actions/runs/38090184679), and Obsidian vault round-trip [38090184693](https://github.com/ashutoshpw/open-obsidian/actions/runs/38090184693). Exact job IDs and artifact digests are in [evidence/r2.8.62-commonmark-basics-table-fixture-d793bcb.json](evidence/r2.8.62-commonmark-basics-table-fixture-d793bcb.json). Native parallel groups ran in Rust CI and the vault round-trip workflow. No local executable validation was used.

Accepted slice: the CommonMark basics fixture renders its table in the native preview while preserving its original bytes. Full C02.1 and migration phases R3-R7 remain pending.

### R2.8.63 in progress — single inline highlight fixture preview

Use the existing highlight C02.1 fixture to drive the egui preview, verify RenderMarkdown and the expected highlighted phrase, and preserve the original source bytes. Convert the direct-string single-highlight test to fixture-driven coverage and push for exact-SHA GitHub Actions; no local executable validation runs. The tracker inventory checkpoint is pending after the R2.8.62 acceptance record is pushed.

R2.8.63 tracker checkpoint: inventory [run 38090729528](https://github.com/ashutoshpw/open-obsidian/actions/runs/38090729528), job 114326433179, passed for tracker SHA c36d6c9768e1d924d3aea9e9535eee1aa57e0fb0.

### R2.8.63 accepted — single inline highlight fixture preview — source SHA 2a5a304362cf1ed73adc8adc31035b51dac992ac

The existing highlight C02.1 fixture now drives the egui preview test. It verifies RenderMarkdown, the fixture's expected highlighted phrase, and unchanged fixture bytes. The focused Rust UI test passed on Ubuntu, macOS, and Windows; each platform's ui-egui suite passed 96 tests. The first implementation commit failed the Ubuntu formatting check; the GitHub Actions log showed the exact rustfmt layout changes, which were applied in the correction commit. The test itself passed on Ubuntu in that first attempt.

All seven required workflows passed on the corrected source SHA: inventory [38091042826](https://github.com/ashutoshpw/open-obsidian/actions/runs/38091042826), loaded-plugin workflows [38091042860](https://github.com/ashutoshpw/open-obsidian/actions/runs/38091042860), desktop build [38091042858](https://github.com/ashutoshpw/open-obsidian/actions/runs/38091042858), quality [38091042829](https://github.com/ashutoshpw/open-obsidian/actions/runs/38091042829), Rust CI [38091042827](https://github.com/ashutoshpw/open-obsidian/actions/runs/38091042827), plugin renderer [38091042813](https://github.com/ashutoshpw/open-obsidian/actions/runs/38091042813), and Obsidian vault round-trip [38091042850](https://github.com/ashutoshpw/open-obsidian/actions/runs/38091042850). The initial macOS quality job missed the Electron retrieval boundary and the initial macOS vault run timed out after folder selection; same-SHA attempt 2 passed for both. Exact job IDs, retries, and artifact digests are in [evidence/r2.8.63-single-highlight-fixture-2a5a304.json](evidence/r2.8.63-single-highlight-fixture-2a5a304.json). Native parallel groups ran in Rust CI and the vault round-trip workflow. No local executable validation was used.

Accepted slice: the single plain highlight fixture renders the expected phrase through the native preview while retaining its source bytes. Full C02.1 and migration phases R3-R7 remain pending.

### R2.8.64 in progress — simple wiki-link source-fallback fixture

Use the existing wiki-link C02.1 fixture in the generic egui Markdown preview to verify ShowSource, the visible original wiki-link syntax, the unsupported-wiki-links reason, and unchanged source bytes. Add focused fixture-driven coverage and push for exact-SHA GitHub Actions; no local executable validation runs. The tracker inventory checkpoint is pending after the R2.8.63 acceptance record is pushed.

R2.8.64 tracker checkpoint: inventory [run 38091980947](https://github.com/ashutoshpw/open-obsidian/actions/runs/38091980947), job 114330096505, passed for tracker SHA 2118f8446c8fa27b7c27205107e4ea395101b313.


### R2.8.64 accepted — simple wiki-link source-fallback fixture — source SHA 885fb20208c7390d483e4a9d32136d63600d6b44

The existing wiki-link C02.1 fixture now drives the generic egui Markdown preview test. It verifies ShowSource, the visible original wiki-link syntax, the unsupported-wiki-links reason, and unchanged fixture source bytes. The focused Rust UI test passed on Ubuntu, macOS, and Windows; each platform's ui-egui suite passed 97 tests. The first implementation SHA failed only GitHub's formatting check; the exact rustfmt layout from its log was applied in the correction commit. A superseded same-SHA quality retry passed after its first macOS Electron retrieval-boundary timeout; quality passed on attempt 1 for the accepted corrected SHA.

All seven required workflows passed on the corrected source SHA: inventory [38092168263](https://github.com/ashutoshpw/open-obsidian/actions/runs/38092168263), loaded-plugin workflows [38092168320](https://github.com/ashutoshpw/open-obsidian/actions/runs/38092168320), desktop build [38092168241](https://github.com/ashutoshpw/open-obsidian/actions/runs/38092168241), quality [38092168257](https://github.com/ashutoshpw/open-obsidian/actions/runs/38092168257), Rust CI [38092168281](https://github.com/ashutoshpw/open-obsidian/actions/runs/38092168281), plugin renderer [38092168296](https://github.com/ashutoshpw/open-obsidian/actions/runs/38092168296), and Obsidian vault round-trip [38092168332](https://github.com/ashutoshpw/open-obsidian/actions/runs/38092168332). Exact job IDs, retry information, and all 16 artifact digests are in [evidence/r2.8.64-simple-wiki-link-fixture-885fb20.json](evidence/r2.8.64-simple-wiki-link-fixture-885fb20.json). Native parallel groups ran successfully in Rust CI and the vault round-trip workflow. No local executable validation was used.

Accepted slice: simple wiki links remain visible as source with an explicit unsupported reason. C02.1 and migration phases R3-R7 remain pending.

### R2.8.65 in progress — C02.1 preview coverage reconciliation

Reconcile each of the 21 shared Rust Markdown preview fixture cases with its egui coverage, then distinguish this read-only preview coverage from C02.1's broader render/edit acceptance. Keep C02.1 pending until the whole criterion is evidenced, and select the next bounded implementation slice from the remaining gaps. Push the R2.8.64 acceptance record and run the Rust migration inventory checkpoint on its tracker SHA; no local executable validation runs.

R2.8.65 tracker checkpoint: inventory [run 38092858681](https://github.com/ashutoshpw/open-obsidian/actions/runs/38092858681), job 114332692803, passed for tracker SHA bb61601e1a8358c665cebd3cda544782c497a585.


### R2.8.65 accepted — C02.1 preview coverage reconciliation

All 21 `rust_preview.cases` entries map to explicit egui preview tests. The audit separates that preview coverage from C02.1's wider render/edit clause: task and callout-task toggles, table-cell source editing and generic source editing have separate UI tests, but the declared standard alert callout preview has no dedicated case asserting its heading and body. C02.1 remains pending. The audit and complete case-to-test map are in [evidence/r2.8.65-c02.1-preview-coverage-audit.md](evidence/r2.8.65-c02.1-preview-coverage-audit.md). The Rust migration inventory checkpoint passed on tracker SHA `bb61601e1a8358c665cebd3cda544782c497a585`; no local executable validation was used.

### R2.8.66 in progress — standard alert callout preview fixture

Add a standard alert callout to the shared C02.1 Rust preview fixture and verify the egui preview exposes its heading and body while keeping the original source bytes unchanged. Push the focused change for exact-SHA GitHub Actions; no local executable validation runs.

R2.8.66 tracker checkpoint: inventory [run 38092990546](https://github.com/ashutoshpw/open-obsidian/actions/runs/38092990546), job 114333070887, passed for tracker SHA 767799df2165056bff889e770abf814ecf91f80a.


### R2.8.66 accepted — standard alert callout preview fixture — source SHA 71022bfb86eda820835a9e3e57f72a9bed271241

The shared C02.1 fixture includes a standard alert callout case. Its egui preview test verifies RenderMarkdown, the alert marker, visible title/body, and unchanged fixture source bytes. The focused test passed on Ubuntu, macOS, and Windows; each ui-egui suite passed 98 tests. GitHub CI exposed the renderer's exact accessible labels and rustfmt layout on the first implementation SHA; both were corrected from CI output. A same-SHA quality retry passed after its first macOS Electron retrieval-boundary failure; corrected-source quality passed on attempt 1.

All seven required workflows passed on exact source SHA 71022bfb86eda820835a9e3e57f72a9bed271241: inventory [38093279218](https://github.com/ashutoshpw/open-obsidian/actions/runs/38093279218), loaded plugins [38093279364](https://github.com/ashutoshpw/open-obsidian/actions/runs/38093279364), desktop build [38093279298](https://github.com/ashutoshpw/open-obsidian/actions/runs/38093279298), quality [38093279365](https://github.com/ashutoshpw/open-obsidian/actions/runs/38093279365), Rust CI [38093279283](https://github.com/ashutoshpw/open-obsidian/actions/runs/38093279283), plugin renderer [38093279208](https://github.com/ashutoshpw/open-obsidian/actions/runs/38093279208), and vault round-trip [38093279270](https://github.com/ashutoshpw/open-obsidian/actions/runs/38093279270). Exact job identifiers and all 16 artifact digests are in [evidence/r2.8.66-standard-alert-callout-71022bf.json](evidence/r2.8.66-standard-alert-callout-71022bf.json). No local executable validation was used.

### R2.8.67 accepted — C02.1 render/edit acceptance audit

The audit reconciles all 22 Rust preview cases with explicit egui tests and separately maps fixture-backed task, callout-task, table-cell, and generic source editing, including exact saved bytes and stale-edit conflict behavior. GitHub UI suite logs confirm 98 tests passed on each supported CI OS; all seven required workflows passed on the same exact source SHA 71022bfb86eda820835a9e3e57f72a9bed271241. Requirement C02.1 is marked passing with [evidence/r2.8.67-c02.1-render-edit-audit.md](evidence/r2.8.67-c02.1-render-edit-audit.md) and the exact-SHA workflow/artifact record above. Parent C02 remains pending because its three-mode and golden round-trip clauses require separate evidence. No local executable validation was used.

R2.8.67 tracker checkpoint: inventory [run 38094092569](https://github.com/ashutoshpw/open-obsidian/actions/runs/38094092569), job 114336291041, passed on tracker SHA 859bf5084a491aec2b9a1b2051db1479e879cdd7.

### R2.8.68 in progress — parent C02 mode and round-trip acceptance

Audit source, live-preview, and reading workflows against their Rust UI behavior and fixtures. Reconcile BOM, line ending, whitespace, comment, unknown-syntax, and untouched-span preservation to direct round-trip/edit evidence. Keep C02 pending until all criteria have direct cross-platform evidence; choose a bounded implementation change for any gap. The tracker inventory checkpoint passed on SHA 859bf5084a491aec2b9a1b2051db1479e879cdd7. No local executable validation runs.

### R2.8.68 audit complete — parent C02 mode and round-trip gap

Mapped the three legacy editor modes to the Rust note preview UI, existing fixture coverage, and explicit UI tests. Rust currently renders Markdown and supports revision-checked source drafts, but has no selected Source/Live preview/Reading modes; editing currently replaces its preview presentation. Existing C02.2 and C02.1 evidence covers BOM, CRLF, comments, unknown syntax, approved frontmatter spans, exact task/table/source edits, and stale-write protection across the supported CI platforms. It does not prove mode-switch draft retention or the complete parent golden workflow. Parent C02 remains pending. The detailed matrix and next implementation slice are in [evidence/r2.8.68-c02-three-mode-audit.md](evidence/r2.8.68-c02-three-mode-audit.md). No local executable validation was run.

Next: push this tracker update and obtain its exact-SHA inventory result. Then implement the three explicit native modes and a composite byte-preservation fixture as R2.8.69; keep validation in GitHub Actions only.

R2.8.68 tracker checkpoint: inventory [run 38094389705](https://github.com/ashutoshpw/open-obsidian/actions/runs/38094389705), job 114337166754, passed for tracker SHA 54e9574d0235beaadb5e49f7b8850d973b028989. R2.8.69 is in progress.

### R2.8.69 implementation prepared — native Markdown modes

Added Source, Live preview, and Reading controls to the bounded native note workflow. Live preview can show the source draft and rendered result together; Reading hides source-edit controls and retains an unsaved draft; Source focuses the raw source editor. Added fixture-driven mode transitions and a composite exact-byte save case carrying BOM, CRLF, a YAML comment, unknown frontmatter, significant trailing spaces, and a Markdown comment. Updated the Markdown architecture note and reconciled the changed fixture hash in the inventory. This slice has not yet been validated; push it and use exact-SHA GitHub Actions only. Parent C02 remains pending.

First implementation SHA `a01e0db80e132bc6020c323fe05777711f4ec72d`: Rust CI [run 38094789852](https://github.com/ashutoshpw/open-obsidian/actions/runs/38094789852) failed on Ubuntu, macOS, and Windows. The 98 existing UI tests passed on each platform, but the two new mode tests queried `Markdown source editor` before the next egui frame had applied the clicked `Edit Markdown source` action. Runner accessibility snapshots still showed the edit button. Ubuntu formatting passed. Inventory [38094789844](https://github.com/ashutoshpw/open-obsidian/actions/runs/38094789844), loaded plugins [38094789890](https://github.com/ashutoshpw/open-obsidian/actions/runs/38094789890), plugin renderer [38094789848](https://github.com/ashutoshpw/open-obsidian/actions/runs/38094789848), quality [38094789865](https://github.com/ashutoshpw/open-obsidian/actions/runs/38094789865), and desktop build [38094789918](https://github.com/ashutoshpw/open-obsidian/actions/runs/38094789918) passed; vault round-trip [38094789842](https://github.com/ashutoshpw/open-obsidian/actions/runs/38094789842) was still running at review. The correction adds an additional harness frame before querying the editor. No local executable validation was run.

The first-SHA vault round-trip completed successfully on all platforms: Ubuntu job 114338370716, macOS job 114338370553, and Windows job 114338370764. All six companion workflows passed; only Rust CI failed. The correction can now be pushed without superseding a pending required run.

### R2.8.69 second implementation attempt — source SHA 6535790e5e9b6f90f193a5aab737edc3159006b4

The additional egui harness frame fixed the earlier editor-transition timing issue. Rust CI [run 38095070927](https://github.com/ashutoshpw/open-obsidian/actions/runs/38095070927) then failed on Ubuntu job 114339193779, macOS job 114339193884, and Windows job 114339193915 because the Live preview test expected the Reading-mode unsaved-draft label. The UI correctly exposes the source-editor label in Live preview; the other 99 ui-egui tests passed on each platform, including the golden byte-roundtrip test. Ubuntu formatting passed.

Inventory [38095070882](https://github.com/ashutoshpw/open-obsidian/actions/runs/38095070882), loaded plugins [38095070884](https://github.com/ashutoshpw/open-obsidian/actions/runs/38095070884), plugin renderer [38095070933](https://github.com/ashutoshpw/open-obsidian/actions/runs/38095070933), quality [38095070888](https://github.com/ashutoshpw/open-obsidian/actions/runs/38095070888), and desktop build [38095070917](https://github.com/ashutoshpw/open-obsidian/actions/runs/38095070917) passed. Vault round-trip [38095070831](https://github.com/ashutoshpw/open-obsidian/actions/runs/38095070831) passed on macOS job 114339193444 and Windows job 114339193489; Ubuntu job 114339193353 failed at X11 visible-window discovery. Same-SHA attempt 2 passed on Ubuntu job 114339986622, Windows job 114339987796, and macOS job 114340014317. The local correction now expects the source-editor status in Live preview while retaining the separate unsaved-draft assertion in Reading. No local executable validation was run.

### R2.8.69 accepted — native Markdown modes and golden round trip — source SHA 8fe603b3fa4164cf681f94c3093f65b793d31e8c

The Live preview test now asserts the source-editor status, while Reading separately verifies its unsaved-draft status. Both focused mode tests passed, and all 100 ui-egui tests passed on Ubuntu, macOS, and Windows. The golden fixture edit preserved BOM, CRLF, significant spaces, comments, unknown frontmatter, and every unapproved source byte. Rust 1.99.0 (b940084d7, 2026-09-28) was used with the committed Cargo.lock SHA-256 recorded in the evidence.

All seven required workflows passed on exact source SHA 8fe603b3fa4164cf681f94c3093f65b793d31e8c: inventory [38095517526](https://github.com/ashutoshpw/open-obsidian/actions/runs/38095517526), loaded plugins [38095517525](https://github.com/ashutoshpw/open-obsidian/actions/runs/38095517525), desktop build [38095517432](https://github.com/ashutoshpw/open-obsidian/actions/runs/38095517432), quality [38095517459](https://github.com/ashutoshpw/open-obsidian/actions/runs/38095517459), Rust CI [38095517465](https://github.com/ashutoshpw/open-obsidian/actions/runs/38095517465), plugin renderer [38095517476](https://github.com/ashutoshpw/open-obsidian/actions/runs/38095517476), and Obsidian vault round-trip [38095517953](https://github.com/ashutoshpw/open-obsidian/actions/runs/38095517953). Job IDs and all 16 artifact IDs/digests are in [evidence/r2.8.69-markdown-modes-8fe603b.json](evidence/r2.8.69-markdown-modes-8fe603b.json). Parent requirement C02 is now passing; C01/C01.2 and remaining R2 work are still pending. Existing native GitHub Actions `parallel:` groups ran in the Rust, quality, desktop-build, and vault-roundtrip workflows. No local executable validation was run.

R2.8.69 tracker checkpoint: inventory [run 38096042195](https://github.com/ashutoshpw/open-obsidian/actions/runs/38096042195), job 114342032706, passed for tracker SHA `0d6db90c67d1cb779ae9a383489b05736543c717`. The loaded-plugin workflow [38096042151](https://github.com/ashutoshpw/open-obsidian/actions/runs/38096042151), desktop build [38096042117](https://github.com/ashutoshpw/open-obsidian/actions/runs/38096042117), Rust CI [38096042190](https://github.com/ashutoshpw/open-obsidian/actions/runs/38096042190), and plugin renderer [38096042147](https://github.com/ashutoshpw/open-obsidian/actions/runs/38096042147) passed on that tracker SHA. Quality [run 38096042142](https://github.com/ashutoshpw/open-obsidian/actions/runs/38096042142) initially missed the Electron retrieval boundary in its macOS job 114342032929; same-SHA attempt 2 passed all three platforms, with retry job 114342364461. The vault round-trip was not triggered by tracker-only paths; its all-platform run passed on the exact implementation SHA `8fe603b3fa4164cf681f94c3093f65b793d31e8c`. Job IDs and the complete artifact digest list for the accepted implementation are in [evidence/r2.8.69-markdown-modes-8fe603b.json](evidence/r2.8.69-markdown-modes-8fe603b.json).

R2.8.70 starts at tracker SHA `0d6db90c67d1cb779ae9a383489b05736543c717` with an evidence-backed audit of C01/C01.2 read-only vault operations and byte-snapshot coverage. Those requirements remain pending until all operations and platforms have direct proof.

R2.8.70 audit prepared from repository head `8cf701b825ba13b9715388a6c3fbc313547bfdf6`. The audit maps direct vault tests, egui snapshot tests, watcher coverage, and the narrower Obsidian 1.14.4 reference-app round-trip evidence. It found that C01.2-38 watcher evidence was linked in `requirements.json` and the state/journal but absent from the C01.2 matrix; the missing row is now recorded and explicitly labeled synthetic UI coverage. C01/C01.2 remain pending because read-only preview/refresh/link/embed flows have not all been exercised against the Obsidian-authored vault through the actual desktop on all supported OSes. The next bounded slice is C01.2-39: native source preview and no-op close with before/after vault and app-data snapshots on Ubuntu, macOS, and Windows. Inventory CI is pending for this tracker SHA; no local executable validation was run.

### R2.8.70 accepted — C01/C01.2 read-only audit

The evidence-backed operation map is recorded in [evidence/r2.8.70-c01-readonly-audit.md](evidence/r2.8.70-c01-readonly-audit.md). The missing C01.2-38 matrix row now points to the existing watcher evidence and clearly identifies it as synthetic egui coverage. The audit confirms broad exact-SHA three-OS snapshot tests for Rust vault and UI behavior, alongside narrower actual Obsidian 1.14.4 open/reopen, native picker, and cancellation evidence. C01 and C01.2 remain pending because all source-preview, refresh, link/embed, and recovery flows have not been run in the reference desktop against the Obsidian-authored fixture on all three OSes.

Rust migration inventory passed on exact tracker SHA `e5de40c22299b27cf706ac4af584909dbac105c9`: [run 38096528700](https://github.com/ashutoshpw/open-obsidian/actions/runs/38096528700), job `114343454234`. This is tracker validation, not product behavior evidence. No local executable validation was run.

Next: R2.8.71 adds native OpenObsidian source preview and no-op close to the Obsidian-authored round-trip flow, with vault and app-data snapshots on Ubuntu, macOS, and Windows. C01/C01.2 remain pending.

### R2.8.71 C01.2-39 accepted — reference-app source preview and no-op close

Starting from tracker SHA `93ca0f24325176e0ea7f7b34d5a5fe1e088e9fc6`, added source preview and close to the pinned Obsidian 1.14.4 round-trip workflow. The actual OpenObsidian desktop displayed the Obsidian-authored BOM/CRLF note `Nested Ω/space note.md`, showed `Original bytes stay untouched.`, closed the preview without editing, and reopened the vault successfully on Linux, macOS, and Windows. Complete vault snapshots remained byte-identical throughout. Linux and Windows app-data snapshots remained unchanged. On macOS only `app.ron` eframe UI-state persistence changed; the report verified window/egui state and no vault or app-data paths, with all other app-data unchanged.

The exact implementation SHA `ddfee6f6459ef15598337bdebe7b8367fc3b2539` passed the Obsidian round-trip workflow on all three OSes (run [38098596467](https://github.com/ashutoshpw/open-obsidian/actions/runs/38098596467); jobs `114349622664`, `114349622783`, `114349622796`). All seven required workflows passed on that same SHA: Rust CI [38098596520](https://github.com/ashutoshpw/open-obsidian/actions/runs/38098596520), inventory [38098596385](https://github.com/ashutoshpw/open-obsidian/actions/runs/38098596385), quality [38098596388](https://github.com/ashutoshpw/open-obsidian/actions/runs/38098596388), desktop build [38098596447](https://github.com/ashutoshpw/open-obsidian/actions/runs/38098596447), plugin renderer [38098596414](https://github.com/ashutoshpw/open-obsidian/actions/runs/38098596414), and loaded-plugin workflows [38098596375](https://github.com/ashutoshpw/open-obsidian/actions/runs/38098596375). Per-platform reports, runner/reference-app versions, job IDs and artifact digests are in [evidence/r2.8.71-reference-source-preview-ddfee6f.json](evidence/r2.8.71-reference-source-preview-ddfee6f.json).

Linux and macOS Accessibility APIs exposed no controls for the egui window, so the final workflow uses OCR-located visible controls with platform-native pointer events on those systems; Windows uses UI Automation. Several CI attempts exposed and corrected control-recognition, OCR threshold, app-data policy, and macOS pointer-offset issues. No local tests, builds, formatters, linters, runtime probes, or application launches were used. Rust migration inventory passed on the exact tracker SHA `cd9137d0f45f5927aa891c24ac82a63f26489d32`: [run 38099452203](https://github.com/ashutoshpw/open-obsidian/actions/runs/38099452203), job `114352164752`. R2.8.71 is complete. Parent C01/C01.2 remain pending because the broader reference-app read-only matrix is not yet complete; edit/save remains deferred to C02/C14.

### R2.8.72 in progress — reference-app external note refresh

Starting from tracker SHA `a3aafa3ef954093239a4d128d81de6ec1622fe5f`, extend the pinned Obsidian 1.14.4 round-trip so OpenObsidian receives a deterministic BOM/CRLF note created outside the app after startup. Exercise the visible note-list refresh, select the new note in `Note to inspect`, preview and close its source, verify exact vault/app-data snapshots after the deliberate creation, and confirm the note remains byte-identical and visible after Obsidian reopens the vault. C01.2-40 is pending exact-SHA CI evidence on Linux, macOS and Windows; all seven required workflows must pass. No local tests, builds, formatters, linters, runtime probes or app launches are permitted; executable validation runs only in GitHub Actions. Parent C01/C01.2 remain pending.

The first implementation, exact source SHA `507ef57c6e0773325b15c37a818ddf6483926075`, passed Rust CI, inventory, quality, desktop build, plugin renderer, and loaded-plugin workflows, but the Obsidian round-trip failed on all three OSes (run [38100421753](https://github.com/ashutoshpw/open-obsidian/actions/runs/38100421753)). Linux AT-SPI exposed no controls and OCR missed the visible `Refresh note list` button. Windows' file watcher refreshed while the test was preparing snapshots, leaving that button disabled; the selector screenshot showed `After refresh.md`, but OCR did not recognize the open popup. macOS reached the earlier preview-close action, where OCR misread Ω in the path-specific anchor. The failed per-OS reports and screenshots are in artifacts `11686484970` (Linux), `11687841382` (macOS), and `11688130317` (Windows). The corrective slice uses the neighboring Markdown-count label to locate refresh, waits for the Windows refresh control to become enabled, selects Windows radio items through UI Automation, and uses a simpler source-label anchor plus a deterministic keyboard fallback on Linux/macOS. C01.2-40 remains pending; no local executable validation was run.

The corrective source SHA `4fa4fdf5e3b588341e1f2aa044513833b12f068e` passed inventory, Rust CI, quality, desktop build, plugin renderer, and loaded-plugin workflows, but the Obsidian round-trip still failed on Linux, macOS and Windows (run [38101532872](https://github.com/ashutoshpw/open-obsidian/actions/runs/38101532872)). Linux remained at two visible Markdown files and macOS showed the new count but stayed in the refreshing state after the manual refresh click. Both logs show the UI receiving the click and retaining the refresh receiver; no worker-stage diagnostics existed to determine whether Rayon scheduled the scan, the scan returned, preview preservation completed, or the UI consumed the result. Windows UI Automation selected the exact `After refresh.md` radio item with `SelectionItemPattern.Select`, while screenshot OCR read the label as `Afterrefresh.nd i`, causing a false-negative selection assertion before preview. Platform reports and artifact IDs/digests are recorded in [evidence/r2.8.72-roundtrip-ci-4fa4fdf.json](evidence/r2.8.72-roundtrip-ci-4fa4fdf.json). The next slice adds CI-only refresh-worker and watcher-hint stage logs, records Windows enabled state before activation, and accepts the exact native Windows selection result while retaining screenshot capture and the unique source-marker preview assertion. C01.2-40 remains pending; no local executable validation was run.

The diagnostic source SHA `3afdfb605f826474ca4e11c5b9467ea3011a6cdb` passed inventory, plugin renderer, loaded-plugin, quality, and desktop-build workflows. Rust CI passed on macOS and Windows; Ubuntu workspace tests passed (100 `ui-egui` and 50 vault tests), while `cargo fmt --all -- --check` found two formatting differences in the new diagnostics. The Obsidian round-trip passed in full on Windows and failed on Linux and macOS (run [38102475317](https://github.com/ashutoshpw/open-obsidian/actions/runs/38102475317)). Linux logs show the scan finding three entries and delivering its result, followed by a queued watcher refresh whose result was not consumed; the screenshot remained in the refreshing state, the OCR click happened while the control was disabled, and no `manual_button` request was logged. macOS displayed three Markdown files and a completed refresh, then stopped at `Note to inspect`: Accessibility exposed no control and that attempt's window-only capture was blank. Windows selected the exact note through UI Automation and preserved its bytes and the vault/app-data snapshots through preview, close, and Obsidian reopen. Artifact IDs and digests are recorded in [evidence/r2.8.72-roundtrip-ci-3afdfb6.json](evidence/r2.8.72-roundtrip-ci-3afdfb6.json). The next correction schedules repaint after both watcher and manual refresh starts, waits for outstanding watcher refreshes to settle before the explicit manual action, uses full-desktop OCR when macOS window capture is blank, and uses the sorted first-item keyboard action to select the exact note on Linux/macOS. C01.2-40 and parent C01/C01.2 remain pending; no local tests, builds, formatter, linter, or application launches were used.

The refresh-lifecycle correction was pushed as exact source SHA `3ed950ee7e5f0ff1623aea0ec050a9a595fa1bd3`. Inventory, plugin renderer, loaded-plugin, quality, desktop build, and Rust CI passed across their required jobs. The Obsidian round-trip passed on Windows and failed on Linux and macOS (run [38103381537](https://github.com/ashutoshpw/open-obsidian/actions/runs/38103381537)). Linux completed the source preview with unchanged vault/app-data snapshots, but AT-SPI exposed no close button and OCR failed to match the `Source Nested` anchor. macOS created `After refresh.md` with the expected 129 bytes and SHA-256, consumed two successful watcher refresh results, and then timed out because the OCR click did not trigger a `manual_button` request. Windows completed the round-trip, exact UI Automation note selection, preview close, and Obsidian reopen with unchanged snapshots. Per-OS artifacts and exact companion run/job IDs are recorded in [evidence/r2.8.72-roundtrip-ci-3ed950e.json](evidence/r2.8.72-roundtrip-ci-3ed950e.json). The next correction anchors the Linux close action to the stable preview title and logs the macOS refresh button's egui response rectangle and pointer input under CI diagnostics. C01.2-40 and parent C01/C01.2 remain pending; no local tests, builds, formatter, linter, or application launches were used.

### R2.8.72 refresh-target diagnostics on `6c17d27`

Exact-SHA GitHub Actions on `6c17d27c9bc41386e6a169e0259420bf2ecf7c83` passed inventory, plugin renderer, loaded-plugin, quality, desktop build, and Rust Linux/Windows. The Rust macOS job failed because the existing empty-vault test assumed its fast refresh receiver was still pending after one UI step; the refresh had already completed. The Obsidian 1.14.4 round-trip passed on Windows. Linux observed a delayed watcher refresh after the OCR click began, so the button was disabled on press and no manual request was logged. macOS diagnostics showed pointer y=89 outside the Refresh note list response rectangle at y=64.5–79.5. Exact run/job IDs, failure details, and round-trip artifact hashes are in [evidence/r2.8.72-roundtrip-ci-6c17d27.json](evidence/r2.8.72-roundtrip-ci-6c17d27.json). The current correction waits for delayed watcher activity, retries the manual click while the control is available, targets the measured macOS button position, and accepts an already completed refresh in the egui test. No local executable validation was run.

### R2.8.72 refresh click and OCR status on `5788a79`

Exact-SHA GitHub Actions on `5788a79c46e2aeb56abf34590754ccc6cb789e53` passed inventory, plugin renderer, loaded-plugin, quality, desktop build, and Rust CI on all required platforms. The round-trip reached a successful manual refresh request and result on Linux, macOS, and Windows. It then stopped on Linux and Windows because OCR misread the refreshed status phrase; macOS reached note selection but OCR missed the low-contrast `Previous note` label. The artifacts and exact run/job IDs are recorded in [evidence/r2.8.72-roundtrip-ci-5788a79.json](evidence/r2.8.72-roundtrip-ci-5788a79.json). The next correction uses fuzzy OCR for that status and the visible ASCII `Nested` note name to position the selector click. No local executable validation was run.

### R2.8.72 selector click on `f85d619`

Exact-SHA GitHub Actions on `f85d619b5d8c64dd2afe2b95509e5fadf6f41c25` passed inventory, plugin renderer, loaded-plugin, quality, desktop build, and Rust CI on all required platforms. The round-trip passed on Windows. On Linux and macOS, manual refresh succeeded and the selector opened, but the `Home`/`Enter` keyboard sequence left the menu open on the original note. The audit incorrectly accepted its own action description as proof of selection, then timed out waiting for the external note's source preview. Artifacts, exact job IDs, and hashes are in [evidence/r2.8.72-roundtrip-ci-f85d619.json](evidence/r2.8.72-roundtrip-ci-f85d619.json). The next correction clicks the first menu row using the stable `Resolve wiki links` anchor and requires OCR to confirm the selected note before continuing. No local executable validation was run.

### R2.8.72 refreshed-note selection on `be082a4`

Exact-SHA GitHub Actions on `be082a4864b38d28cf2ab15489d7ed84c47b5271` passed inventory, plugin renderer, loaded-plugin, quality, desktop build, and Rust CI on all required platforms. The Obsidian 1.14.4 round-trip passed on macOS and Windows. Linux created and refreshed the external note, but clicking the visible first menu row closed the selector without changing the selected note. Evidence and hashes are recorded in [evidence/r2.8.72-roundtrip-ci-be082a4.json](evidence/r2.8.72-roundtrip-ci-be082a4.json). The next correction uses the `Previous note` button after verifying the sorted path order places the new note immediately before the existing selected note, then waits for the selected title to appear. No local executable validation was run.

### R2.8.72 Previous note control on `be4cbc0`

All six companion workflows passed on exact SHA `be4cbc0db3ef3e8ed5a1c0cc2368d6cef6a036a0`; the Rust matrix passed on Ubuntu, macOS and Windows. The Obsidian round-trip passed on macOS and failed on Linux and Windows (run [38105693878](https://github.com/ashutoshpw/open-obsidian/actions/runs/38105693878)). Windows UI Automation looked for `After refresh.md` while the `Note to inspect` popup was closed. Linux's final screenshot visibly showed `After refresh.md` selected, but OCR did not recognize the label and the script stopped before checking its source marker. Artifact IDs and SHA-256 digests are in [evidence/r2.8.72-roundtrip-ci-be4cbc0.json](evidence/r2.8.72-roundtrip-ci-be4cbc0.json). The follow-up opens the selector on Windows and records the exact selected path after the Linux/macOS `Previous note` action; the unique source-marker preview remains the content check. No local executable validation was run.

### R2.8.72 / C01.2-40 accepted on `de43f2d`

The exact implementation SHA `de43f2dd78cb1d5228a9e093d2deaa80e91dd7e9` passed all seven required workflows across Ubuntu, macOS, and Windows. The first Ubuntu quality attempt failed at the Electron local retrieval-boundary audit; a same-SHA retry passed. In the Obsidian 1.14.4 round-trip, Linux and macOS CI diagnostics confirmed the `Previous note` action selected `After refresh.md`; Windows UI Automation selected its exact menu item after opening the selector. All three platforms showed the refreshed three-note count and the unique source marker in the preview, then closed the preview. The only vault change was the deliberate new 129-byte BOM/CRLF note with SHA-256 `7048191bb325cea95a09e07ae6de4df9132a38e9b12e5cca0b0d38d6c8fc62d6`; the note reopened unchanged in Obsidian on every platform. Vault snapshots remained unchanged after preview/close, separate app-data policy passed, and no non-workspace or reference workspace paths changed during reopen. Run/job IDs, runner/reference-app versions, artifact hashes, and selection evidence are in [evidence/r2.8.72-c01.2-40-de43f2d.json](evidence/r2.8.72-c01.2-40-de43f2d.json). C01.2-40 is accepted; parent C01/C01.2 remain pending. No local executable validation was run. The next slice is the next uncovered reference-app read-only flow through GitHub Actions.

### R2.8.73 / C01.2-41 accepted on `e78409a`

The first Windows attempt (`416b181`) selected the exact note but used an unsupported UI Automation button pattern to dismiss the selector. The Escape correction (`140b875`) closed it and resolved the correct attachment, but a queued watcher refresh cleared the visible result before capture; that attempt also had a transient Windows plugin-feasibility probe failure. The final focused correction (`e78409a`) waits for refresh settlement and re-resolves if necessary. All seven required workflows passed on the exact implementation SHA. The pinned Obsidian 1.14.4-authored `Untitled.md` resolved its single image embed to the exact attachment hash; decoded image metadata and visible output passed on Linux, macOS, and Windows. Vault snapshots, picker cancellation, and Obsidian reopen passed; only macOS eframe `app.ron` UI state changed under the existing policy. See [evidence/r2.8.73-c01.2-41-e78409a.json](evidence/r2.8.73-c01.2-41-e78409a.json). Parent C01/C01.2 remain pending.

The GitHub Actions native `parallel:` step groups were already present in Rust CI, quality, desktop build, Obsidian round-trip, compatibility pins, and reference-app feasibility workflows; the applicable groups passed in this exact-SHA run. The goal now links the official [GitHub changelog](https://github.blog/changelog/2026-06-25-actions-steps-can-now-be-run-in-parallel/) and [workflow syntax reference](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsparallel). No local tests, builds, formatters, linters, or application launches were run.

The tracker commit `3b8ef4e` inventory run [38112305700](https://github.com/ashutoshpw/open-obsidian/actions/runs/38112305700) failed because the appended C01/C01.2 blocker sentences omitted trailing JSON commas. The commas are corrected. The desktop build, plugin renderer, loaded-plugin workflows, and three-platform Rust CI passed on that SHA. OpenObsidian quality attempt 1 had an Ubuntu Electron retrieval-boundary timeout while its Windows and macOS jobs passed; same-SHA attempt 2 passed all three platforms ([38112305697](https://github.com/ashutoshpw/open-obsidian/actions/runs/38112305697)). The correction commit will rerun the inventory check.

### R2.8.73 tracker checkpoint on `616920d`

After correcting the missing commas reported by the first tracker inventory attempt, exact tracker SHA `616920d3f807672fbc72619f4560ba1f04f7ca8e` passed Rust migration inventory [run 38112650345, job 114391230743](https://github.com/ashutoshpw/open-obsidian/actions/runs/38112650345). The five companion workflows triggered by the correction commit also passed: [quality](https://github.com/ashutoshpw/open-obsidian/actions/runs/38112650355), [Rust CI](https://github.com/ashutoshpw/open-obsidian/actions/runs/38112650405), [desktop build](https://github.com/ashutoshpw/open-obsidian/actions/runs/38112650371), [plugin renderer](https://github.com/ashutoshpw/open-obsidian/actions/runs/38112650333), and [loaded plugins](https://github.com/ashutoshpw/open-obsidian/actions/runs/38112650351). Parallel groups ran successfully in the applicable workflows. The original image-resolution implementation remains accepted on `e78409a`; C01/C01.2 remain pending.

### R2.8.74 audit — C01.2-42 selected

The read-only reference-app audit found that C01.2-39 through C01.2-41 cover
source preview/close, external Markdown note creation and refresh, and
Obsidian-authored image embed resolution. Attachment removal is currently
covered by synthetic egui behavior but has not been driven through the active
desktop and reopened in Obsidian. The next slice removes the resolved image
externally in the isolated CI vault, explicitly refreshes and re-resolves the
embed, checks stale output and byte/snapshot safety, and verifies that the note
link persists while the file remains absent after Obsidian reopen. C01.2-42
remains pending exact-SHA GitHub Actions on Linux, macOS, and Windows.

The linked GitHub Actions `parallel:` step feature is already implemented in
the applicable workflows and has exact-SHA CI evidence; remaining single
validation/setup flows have dependencies that do not admit a safe additional
parallel group. No local executable validation was run.

### R2.8.74 / C01.2-42 attempt 1 on `3232359`

Inventory, quality, desktop build, plugin renderer, loaded-plugin workflows,
and Rust CI passed on exact SHA `3232359881d19960862279bfee0a78af38c014e3`.
The focused Obsidian round-trip failed on all three platforms: Ubuntu and
Windows exposed a false positive because two-edit OCR matching treated the
`Resolve wiki links` control label as stale `Resolved: 1`; the Windows capture
showed no resolved count or image. On macOS, the accessibility API could not
find **Close source preview** and the OCR fallback click landed above the
visible button. Artifact IDs, digests, report hashes, run/job IDs, and findings
are in [evidence/r2.8.74-c01.2-42-attempt-1-3232359.json](evidence/r2.8.74-c01.2-42-attempt-1-3232359.json).
The next commit narrows stale-count OCR matching and corrects the macOS click
offset, then reruns all seven workflows on its exact SHA. No local executable
validation was run.

### R2.8.74 / C01.2-42 attempt 2 on `f4b570e`

Inventory, quality, desktop build, plugin renderer, loaded-plugin workflows,
and Rust CI passed again on exact SHA
`f4b570e241c2ec46074170804b34c166d1673edb`. Linux completed the full C01.2-42
round trip: external removal changed only the image path, fresh resolution was
Unresolved with no target and `not_rendered`, app-data policy passed, and
Obsidian reopened with the note embed intact and attachment absent. The macOS
close-preview click now succeeded, but stale-count fuzzy OCR matched
“Unresolved references.” Windows recorded the correct C01.2-41 resolved-image
diagnostics, then a deferred 60-second vault reconciliation ran and cleared the
image before the screenshot gate. Mac/Windows did not reach C01.2-42. Exact job
IDs, all three reports, hashes, and artifact digests are in
[evidence/r2.8.74-c01.2-42-attempt-2-f4b570e.json](evidence/r2.8.74-c01.2-42-attempt-2-f4b570e.json).
The next exact-SHA correction line-anchors the negative OCR check and gives the
deferred reconciliation time to finish before the final resolution screenshot.
No local executable validation was run.

### R2.8.74 / C01.2-42 accepted on `7952658`

All seven required GitHub Actions workflows passed for exact implementation SHA
`79526587c3ed3ead47a0cc682baa4a8f92ecb26b`. The quality workflow's first
Ubuntu attempt timed out in the Electron retrieval-boundary audit; the same-SHA
rerun passed on Ubuntu, macOS, and Windows. Rust CI, desktop build, plugin
renderer, loaded-plugin workflows, and migration inventory passed.

All three pinned Obsidian 1.14.4 round-trip artifacts passed. On each platform,
external removal changed only `Assets/roundtrip image.png`; `Untitled.md` and
its `![[Assets/roundtrip image.png]]` source remained byte-identical. Refresh
cleared the old resolved count and image, and fresh resolution showed
`Unresolved`, no target, `not_rendered`, and the missing-attachment message.
Picker cancellation and Obsidian reopen passed with the note source intact and
the attachment absent. Vault/app-data snapshots passed; macOS persisted only
the previously permitted eframe `app.ron` UI state. Run/job IDs, artifact
digests, and report hashes are in
[evidence/r2.8.74-c01.2-42-reference-app-image-attachment-removal.json](evidence/r2.8.74-c01.2-42-reference-app-image-attachment-removal.json).
Existing GitHub Actions `parallel:` groups passed where applicable. No local
executable validation was run. C01.2-42 is accepted; parent C01/C01.2 remain
pending. Next: push the tracker checkpoint and verify it through GitHub Actions.


### R2.8.74 tracker checkpoint on `9b7b712`

The tracker checkpoint for accepted C01.2-42 passed exact-SHA migration
inventory run 38114951017 and the five companion workflows: quality
38114951191, desktop build 38114951125, plugin renderer 38114951036, loaded
plugins 38114951060, and Rust CI 38114950978. Every matrix job passed. The
Obsidian round-trip workflow did not trigger for this documentation-only
checkpoint; its Linux, macOS, and Windows jobs passed on implementation SHA
`79526587c3ed3ead47a0cc682baa4a8f92ecb26b`. C01.2-42 is accepted and parent
C01/C01.2 remain pending. Next: audit remaining read-only requirements and
select the next bounded reference-app gap for R2.8.75. No local executable
validation was run.


### R2.8.75 in progress — C01.2-43 real-app external note edit

Revalidated clean main at f70745df9299785e2d31e8822825f49f209abd34. C01.2-42
is the latest accepted reference-app case. The prior C01.2-05 edit/refresh test
is synthetic egui coverage; C01.2-40 uses the pinned Obsidian-authored vault
for external note creation and preview, but does not edit that selected note
while its preview remains open. The read-only audit selects C01.2-43 to cover
that gap through the running desktop on Ubuntu, macOS, and Windows, including
exact BOM/CRLF hashes and visible updated content after Obsidian reopen.

The reference harness now overwrites exactly After refresh.md while OpenObsidian
shows its original source preview, refreshes through the native UI, requires
stale preview clearing and updated-source visibility, and returns the
post-edit snapshot as the baseline for image resolution. The later deliberate
attachment removal establishes its own baseline for the remaining no-op flows.
Reopen assertions compare exact edited bytes and render the new marker in Obsidian.
The matrix row and audit are recorded in
evidence/r2.8.75-c01-readonly-audit.md. Parent C01/C01.2 remain pending. All
executable validation remains limited to GitHub Actions.

### R2.8.75 / C01.2-43 attempt 1 on `64f77e7`

All six companion workflows passed on exact SHA
`64f77e7200829dde897ec43bde0b0fef49d0b3ac`: inventory
[38117308220](https://github.com/ashutoshpw/open-obsidian/actions/runs/38117308220),
quality [38117308234](https://github.com/ashutoshpw/open-obsidian/actions/runs/38117308234),
desktop build [38117308265](https://github.com/ashutoshpw/open-obsidian/actions/runs/38117308265),
plugin renderer [38117308231](https://github.com/ashutoshpw/open-obsidian/actions/runs/38117308231),
loaded plugins [38117308228](https://github.com/ashutoshpw/open-obsidian/actions/runs/38117308228),
and Rust CI [38117308257](https://github.com/ashutoshpw/open-obsidian/actions/runs/38117308257).
Obsidian round-trip [38117308222](https://github.com/ashutoshpw/open-obsidian/actions/runs/38117308222) passed macOS and Windows and failed Ubuntu because OCR missed the
selected path after refresh. Linux had the exact external edit, count and
app-data checks, but did not continue to updated preview/reopen. macOS and
Windows reports contained the exact 142-byte edited note and updated marker;
their reopened screenshots show Obsidian's trust prompt covering the note, so
the visible reopen acceptance is incomplete. Evidence, artifact digests, report
hashes and screenshot hashes are in
`evidence/r2.8.75-c01.2-43-attempt-1-64f77e7.json`.

The correction logs the selected note path from the applied refresh state under
the CI diagnostics flag and requires that exact path after the edit refresh. The
reopen harness now waits for the trust decision, chooses Restricted Mode, and
requires the prompt to be gone before accepting or capturing the updated note.
C01.2-43 remains pending until all seven workflows and the three platform
screenshots pass on a new exact SHA. No local product build, test, typecheck,
application launch, or runtime audit was run. During preparation only, I ran
`git diff --check` and `python3 -m json.tool` on changed tracker files; these
did not validate application behavior and are not acceptance evidence. All
application validation remains in GitHub Actions.

### R2.8.75 / C01.2-43 accepted on 938f4cd

The correction passed all seven required GitHub Actions workflows on exact
implementation SHA 938f4cda4885efc09d75e6d1eeb182398cacf229. The initial Ubuntu
quality attempt hit a transient Electron retrieval-boundary audit failure; the
same-SHA rerun passed on Ubuntu, macOS, and Windows. Inventory, desktop build,
plugin renderer, loaded-plugin workflows, Rust CI, and the Obsidian round-trip
passed. Existing native parallel step groups passed in applicable workflows.

All three Obsidian 1.14.4 round-trip reports passed. Each platform changed only
After refresh.md from 129 bytes to 142 bytes with the expected SHA-256
225d6216fad51e43994e3ddc2a29411ff003a6ed0336d7c8f4fd13f4e7b39309; the Markdown
count remained three and app data stayed unchanged. Manual refresh retained the
selected path, cleared the old preview, and showed the updated marker. Linux
OCR did not independently recognize the selected path, while the exact CI-only
selection diagnostic confirmed it. Each Obsidian reopen selected Restricted
Mode, hid the trust dialog, matched the edited bytes, and visibly rendered the
updated marker. I visually inspected all three screenshots. Run/job IDs,
artifact digests, report hashes, and screenshot hashes are recorded in
evidence/r2.8.75-c01.2-43-attempt-2-938f4cd.json.

C01.2-43 is accepted; broader C01/C01.2 remain pending. No local executable
validation was run.

### R2.8.75 tracker checkpoint on 3d69885

The evidence tracker checkpoint passed all six documentation-triggered
GitHub Actions workflows on exact SHA 3d6988523e90819b15f4893736a0cfbfb782e896:
migration inventory run 38119086998, quality 38119087016, desktop build
38119086937, plugin renderer 38119087023, loaded-plugin workflows 38119086981,
and Rust CI 38119086983. All platform matrix jobs passed. The path-filtered
Obsidian round-trip workflow did not trigger for this documentation-only
commit; the Linux, macOS, and Windows round-trip jobs passed on implementation
SHA 938f4cda4885efc09d75e6d1eeb182398cacf229. The applicable native parallel
step groups passed on both the implementation and tracker checkpoints.

Next: audit the remaining C01/C01.2 read-only requirements and choose the next
bounded gap. Parent C01/C01.2 remain pending; executable validation stays in
GitHub Actions.

### R2.8.76 / C01.2-44 accepted on 6d3ac64

The first implementation SHA `f231a119edea037fd27abb8caf8968f3b8223d8f`
passed the six companion workflows and Linux round trip, but Windows' note
selector was collapsed and macOS accessibility/OCR did not locate the next-note
button. Both failed before mutating the vault. Correction SHA
`6d3ac642fd3b10052d4f41e9b6274654bc54e786` opens the Windows selector and uses
the reported native button geometry for macOS navigation.

All seven required workflows passed on the correction SHA. Linux, macOS, and
Windows confirmed the external path-only rename, unchanged 142-byte SHA-256,
stale-preview clearing, exact fallback selection, snapshot-preserving
re-preview/close, and Obsidian 1.14.4 Restricted Mode reopen. Applicable
GitHub Actions parallel groups passed. Exact run/job IDs, artifact/report and
screenshot hashes, and both attempts are in
`evidence/r2.8.76-c01.2-44-attempt-1-f231a11.json` and
`evidence/r2.8.76-c01.2-44-attempt-2-6d3ac64.json`. The matrix and requirement
tracker accept C01.2-44 only; parent C01/C01.2 remain pending. No local
executable validation was run.


### Parallel roadmap audit

Three read-only agents compared remaining R2 gaps and phase assignments. The
recommended next slice is C08.1: add a vault-confined regular-file resolver, a
platform opener, and a native action, with an injected CI opener asserting the
exact original path and denials for missing paths, directories, traversal, and
symlinks. C09's read-only `.obsidian` inventory is another bounded candidate;
C06/C07 are larger uncovered document/workspace areas. The audit also records
six pending requirement rows still labeled R1 although `state.json` marks R1
complete. They remain pending until mappings and criteria are reconciled.
Details: `evidence/r2.8.76-parallel-roadmap-audit.md`.

Next: commit and push this tracker/evidence checkpoint, inspect the path-eligible
CI workflows, then begin R2.8.77 for C08.1. Reconcile the R1 row assignments in
a separate tracker slice; do not treat partial or legacy-only evidence as
acceptance. All executable validation remains in GitHub Actions.

### R2.8.76 tracker checkpoint accepted on f00e67b

The tracker checkpoint passed all six documentation-triggered GitHub Actions
workflows on exact SHA `f00e67b3a293f22c5794295a437ac3ff9e4b321c`: inventory
38122116827, quality 38122116874, desktop build 38122116853, plugin renderer
38122116850, loaded-plugin workflows 38122116854, and Rust CI 38122116836. All
platform matrix jobs passed. The path-filtered Obsidian round-trip workflow did
not trigger for this tracker-only commit; all three round-trip jobs passed on
implementation SHA `6d3ac642fd3b10052d4f41e9b6274654bc54e786`. Exact run/job IDs
and the path-filter explanation are recorded in
`evidence/r2.8.76-tracker-checkpoint-f00e67b.json`.

The requirement audit keeps MIG-004 pending until its new Rust 1.95.0 CI job
passes, narrows MIG-003 and MIG-015 to their observed R1 feasibility evidence,
and moves MIG-006, Q-006 and Q-009 to their actual later-phase owners. These
row changes do not claim broader migration acceptance.

### R2.8.77 / C08.1 implementation in progress

The current bounded slice adds a vault-confined regular-file resolver, a
Photocraft-aligned `open` platform adapter, and a desktop-injected action in
the native UI. It revalidates the target just before handoff, tests the opaque
fixture's exact path and bytes, and denies missing, directory, traversal,
symlink and stale targets. Rust CI also gains a locked workspace test job at
the declared Rust 1.95 MSRV. C08.1 remains pending until the seven required
workflows and this MSRV job pass on the exact source SHA. No local executable
validation was run.

### R2.8.77 / C08.1 attempt 1 on 859b411

All seven workflows triggered on exact source SHA
`859b4117fe06295a521dc263bf06cab3cf738a54`. The inventory run
38123196199 failed at `validate_inventory.py` because `state.json` had one
extra closing brace at line 26791 (`JSONDecodeError: Extra data`). The error
was removed in the working tree based on the CI diagnostic. Quality
38123196260, desktop build 38123196187, plugin renderer 38123196200 and
loaded-plugin workflows 38123196205 passed. Rust CI 38123196169 and Obsidian
round-trip 38123196213 were still running at 2026-10-11T08:02:21Z. The
correction push is deferred until those runs are terminal to avoid cancelling
required evidence. C08.1 remains pending; no local executable validation was
run.

### R2.8.77 / C08.1 attempt 1 completed

The remaining exact-SHA workflows finished on `859b411`. All three Obsidian
1.14.4 round-trip jobs passed (Linux 114422011080, Windows 114422011182,
macOS 114422011287); artifact IDs and SHA-256 digests are recorded in
`evidence/r2.8.77-c08.1-attempt-1-859b411.json`. The Rust 1.95.0 workspace test
job passed as well (114422010812). Stable workspace tests passed on all three
OSes, but Ubuntu formatting failed on the six CI-reported hunks and macOS and
Windows Clippy rejected the redundant closure. Inventory also failed on the
extra state brace. This attempt is not accepted; the CI-directed corrections
are ready for a new exact-SHA push. No local executable validation was run.

### R2.8.77 / C08.1 accepted on 9de1895

The corrected implementation SHA `9de1895c1a0a8f6eaa2730a05c7a6d6226cc3fc5`
passed all seven required GitHub Actions workflows: inventory 38123850648,
quality 38123850670, desktop build 38123850723, plugin renderer 38123850656,
loaded-plugin workflows 38123850621, Rust CI 38123850685, and Obsidian
round-trip 38123850667. All matrix jobs passed, including the Rust 1.95.0
locked workspace test job (114423978108). Windows' first round-trip attempt
timed out while waiting for the renamed-note source preview; rerunning that
job on the same SHA passed (114425824311). No source changes were made between
the two Windows attempts. Successful round-trip artifact IDs and digests are
recorded in `evidence/r2.8.77-c08.1-9de1895.json` alongside all run/job IDs and
the failed first Windows artifact. C08.1 and MIG-004 now pass on this source
SHA; parent C08 remains pending. No local executable validation was run.

### R2.8.77 tracker checkpoint accepted on ca02f5b

All six documentation-triggered GitHub Actions workflows passed on exact
tracker SHA `ca02f5b155396b325a1159d8a2c4b36282a8df6d`: inventory 38125089316,
quality 38125089306, desktop build 38125089323, plugin renderer 38125089314,
loaded-plugin workflows 38125089301 and Rust CI 38125089304. Every matrix job
passed, including the Rust 1.95.0 job. The path-filtered Obsidian round-trip
workflow did not trigger for this documentation-only commit; Linux, macOS and
Windows passed on implementation SHA `9de1895c1a0a8f6eaa2730a05c7a6d6226cc3fc5`
in run 38123850667, attempt 2. Exact run/job IDs and the trigger explanation
are in `evidence/r2.8.77-tracker-checkpoint-ca02f5b.json`. No local executable
validation was run.

### R2.8.78 / C09 configuration discovery slice in progress

Added vault-owned, read-only configuration discovery for root `.obsidian` and
`.obsidian-*` directories. The result sorts folder names and vault-relative JSON
paths, retains exact bytes and unknown object keys, skips symlinks and malformed
or non-object JSON, and does not create configuration. Added a fixture and
cross-platform Rust coverage for nested settings, decoys, invalid inputs,
symlinks and unchanged vault snapshots. Parent C09 and policy row C09.1 remain
pending; theme/style analysis and settings mapping are later work.

The tracker now assigns pending AI grounding row Q-009 to R5, and the duplicate
status/evidence quartet in SYNC-001 was removed while retaining its passing
evidence. Exact-SHA GitHub Actions are the only executable validation for this
milestone; no local tests, builds, formatters or validators were run.

Attempt 1 was pushed as exact source SHA
`b0b855771467233df38354f0da26bdce1594a243`. Quality, desktop build, plugin
renderer and loaded-plugin workflows passed; the migration inventory and
Ubuntu Rust formatting checks failed. Rust workspace tests passed on Ubuntu,
Windows and macOS, the Rust 1.95 MSRV job passed, and Windows/macOS Rust CI
passed. The first Obsidian round-trip attempt failed only on the Windows
source-preview UI step while Linux and macOS passed; retrying the round-trip on
the same SHA passed all three operating systems. The first attempt remains
not accepted because inventory and formatting failed. Exact job IDs, findings
and round-trip artifact digests are recorded in
`evidence/r2.8.78-c09-attempt-1-b0b8557.json`. The inventory and formatter
corrections are prepared for a new exact-SHA GitHub Actions attempt. No local
tests, builds, formatters or validators were run.

Attempt 2 was pushed as exact source SHA
`c9ce4a00fa418d8302ea6d0b5db5075120c2c411`. All seven required workflows
passed: migration inventory 38127466969, quality 38127467013, desktop build
38127467115, plugin renderer 38127467099, loaded-plugin workflows 38127466980,
Rust CI 38127467047, and Obsidian vault round-trip 38127466987. Rust CI passed
on Ubuntu, macOS and Windows plus Rust 1.95.0; Obsidian 1.14.4 round-trip passed
on Linux, macOS and Windows. Artifact digests and exact job IDs are recorded
in `evidence/r2.8.78-c09-discovery-c9ce4a0.json`. R2.8.78 is complete as a
partial C09 configuration discovery slice. Parent C09 and C09.1 remain pending
for CSS/theme analysis, settings mapping, app-metadata policy and plugin-write
policy. No local tests, builds, formatters or validators were run.

## 2026-10-11T09:33:03Z — R2.8.78 tracker checkpoint and R2.8.79 preparation

The six documentation-triggered workflows passed on exact tracker SHA
`b61541bd8f6842d600ad264e72e29b03759857ab`: inventory 38128241848, quality
38128241880, desktop build 38128241889, plugin renderer 38128241892,
loaded-plugin workflows 38128241856, and Rust CI 38128241846. Rust CI passed
Ubuntu, macOS, Windows, and the locked Rust 1.95 MSRV job. The path-filtered
Obsidian round-trip did not trigger for the documentation-only checkpoint;
Linux, macOS, and Windows passed on source SHA
`c9ce4a00fa418d8302ea6d0b5db5075120c2c411`. Run/job details are in
`evidence/r2.8.78-tracker-checkpoint-b61541b.json`.

Parallel read-only reviews recommended R2.8.79 as a typed projection of the
supported `appearance.json` fields in `crates/doc`, integrated with the
existing read-only `crates/vault` discovery. The implementation keeps raw
configuration bytes and unknown keys authoritative, and does not apply CSS or
modify the vault. C09 remains pending for broader appearance/theme and
app-metadata work; C09.1 remains pending for its plugin-write policy. No local
tests, builds, formatters, validators, or application launch were run.

## 2026-10-11T09:45:01Z — R2.8.79 attempt 1 review

Source SHA `35719d51be1cbc91ee71c72a1c2a45edb7fac253` completed all seven
required workflows. Migration inventory 38128877217 failed because the
configuration fixture changed without its baseline digest being reconciled.
Rust CI 38128877234 failed on Ubuntu, macOS, Windows, and Rust 1.95 because
`AppearanceMode` was missing from the vault test-module imports; Ubuntu also
reported rustfmt layout changes in `crates/vault/src/configuration.rs` and
`crates/vault/src/lib.rs`. Quality 38128877259, desktop build 38128877243,
plugin renderer 38128877236, loaded-plugin workflows 38128877246, and Obsidian
round-trip 38128877245 passed. The round-trip jobs passed on Linux, macOS, and
Windows. Full job IDs and findings are in
`evidence/r2.8.79-attempt-1-35719d5.json`.

Applied the reported import and formatting corrections and updated the
configuration fixture digest in the migration inventory. The ECMAScript trim
parity fixture now covers BOM trimming and U+0085 preservation. These changes
will be committed and pushed as a small corrective phase for a fresh exact-SHA
GitHub Actions run. No local tests, builds, formatters, or validators were run.

## 2026-10-11T09:57:16Z — R2.8.79 attempt 2 review

Corrective source SHA `a4406a7aaa57deac9b5716cd88a225c05c371112` completed all
seven required workflows. Inventory 38129595422, quality 38129595399, desktop
build 38129595396, plugin renderer 38129595389, loaded-plugin workflows
38129595406, and Obsidian round-trip 38129595409 passed. Round-trip passed on
Linux, Windows, and macOS. Rust CI 38129595419 failed on Ubuntu, macOS,
Windows, and Rust 1.95: the BOM-prefixed mode fixture projected as `Unknown`
instead of `Dark`. Ubuntu also reported rustfmt reflow in the `crates/vault`
public re-export and test import. Exact jobs and round-trip artifact digests
are in `evidence/r2.8.79-attempt-2-a4406a7.json`.

The mode parser now uses the ECMAScript whitespace helper, and the two
`crates/vault/src/lib.rs` layouts match the Ubuntu rustfmt output. Attempt 1's
round-trip artifact IDs and digests are also recorded in its evidence file.
These changes will be pushed as a small correction for a fresh exact-SHA run
of all seven workflows. No local tests, builds, formatters, or validators were
run.

## 2026-10-11T10:08:49Z — R2.8.79 accepted

Corrected source SHA `e3de21b265ad0de3f0ae213c7d314fe66f45636b` passed all
seven required workflows: inventory 38130253619, quality 38130253546, desktop
build 38130253592, plugin renderer 38130253593, loaded-plugin workflows
38130253618, Rust CI 38130253599, and Obsidian round-trip 38130253621. Rust CI
passed on Ubuntu, macOS, Windows, and Rust 1.95.0; Obsidian 1.14.4 round-trip
passed on Linux, macOS, and Windows. Exact job IDs and artifact digests are in
`evidence/r2.8.79-c09-appearance-e3de21b.json`.

R2.8.79 is complete as a partial C09 mapping slice. The supported appearance
fields are projected into typed settings while raw configuration bytes and
unknown keys remain authoritative. C09 remains pending for safe CSS/theme
analysis, broader supported settings, and app-metadata policy; C09.1 remains
pending for its mediated plugin-write policy. No local tests, builds,
formatters, validators, or application launch were run.

Parallel reviews recommended a read-only theme/snippet CSS asset inventory in
`crates/vault`, retaining vault-relative paths, exact bytes, kind, and SHA-256.
The fixture and implementation cover direct CSS children in `themes/` and
`snippets/`, plus Obsidian's standard `themes/<name>/theme.css` entrypoint. The
named theme directory is scanned only at that one level; sibling CSS and deeper
nested assets remain excluded. The official theme tutorial installs themes in
named folders and edits `theme.css`:
https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Themes/App%20themes/Build%20a%20theme.md.
Symlinks and non-CSS files remain excluded. Parsing and CSS application stay in
later slices. The fixture digest is reconciled in `inventory.json`; C09 and
C09.1 remain pending.

## 2026-10-11T10:28:00Z — R2.8.79 tracker checkpoint and R2.8.80 started

Tracker checkpoint SHA `36af32ed88f88844244dbb373a4f60b41f471556` passed all
six documentation-triggered workflows: inventory 38130953227, quality
38130953215, desktop build 38130953236, plugin renderer 38130953210,
loaded-plugin workflows 38130953251, and Rust CI 38130953269. Rust CI passed
on Ubuntu, macOS, Windows and Rust 1.95. The path-filtered round-trip workflow
did not trigger for this documentation-only checkpoint; Linux, macOS and
Windows passed on implementation SHA `e3de21b265ad0de3f0ae213c7d314fe66f45636b`.
Job IDs are recorded in
`evidence/r2.8.79-tracker-checkpoint-36af32e.json`.

R2.8.80 starts from tracker SHA `36af32ed88f88844244dbb373a4f60b41f471556`.
It adds a read-only raw CSS inventory in `crates/vault`, covering direct theme
and snippet CSS plus the standard one-level `themes/<name>/theme.css` entrypoint.
Fixture inventory and state are updated; C09 and C09.1 remain pending. Exact-SHA
GitHub Actions validation is pending. No local tests, builds, formatters,
validators, or application launch were run.

## 2026-10-11T10:40:39Z — R2.8.80 accepted

R2.8.80 passed all seven required GitHub Actions workflows on exact source SHA
`b6f0bbb2fd5f098864f2451ea7ac1626e058e3ee`: inventory 38132088472, quality
38132088509, desktop build 38132088487, plugin renderer 38132088436, loaded
plugin workflows 38132088488, Rust CI 38132088474, and Obsidian vault round-trip
38132088454. Rust CI passed on Ubuntu, macOS, Windows, and Rust 1.95. The
round-trip passed on Linux, macOS, and Windows; all run/job IDs and artifact
digests are in `evidence/r2.8.80-c09-style-inventory-b6f0bbb.json`.

R2.8.80 accepts the raw, read-only CSS inventory as a partial C09 slice. The
inventory covers direct theme/snippet CSS plus the standard named-folder
`themes/<name>/theme.css` entrypoint. The parallel legacy audit found that the
TypeScript inventory recognizes only direct CSS children, so the standard
entrypoint is additional coverage; a later analyzer must derive theme identity
from the parent folder to match `appearance.json`. The legacy analyzer is
regex-based and its browser preview sanitizer is a separate behavior. CSS
analysis/application, app-metadata policy, and C09.1's mediated plugin-write
policy remain pending. A Rust 1.95/MSRV and cross-platform review found no
blocking issue. The fixture digest is `92f0a39b7a7d7dd05c3924b8c9f170d47a892f4552e65231d127f13320665347`.

The next bounded candidate is R2.8.81: exercise and enforce the default
app-metadata separation boundary in `crates/platform` with an injected user-data
root and CI-only tests. Keep portable selection unavailable, and keep C09 and
C09.1 pending. No local tests, builds, formatters, validators, or application
launch were run.

## 2026-10-11T11:02:36Z — R2.8.80 tracker evidence passed; R2.8.81 source ready

Tracker evidence checkpoint SHA `21c801a63fa64cc7c996d45064026ad4fb8a2b42`
passed all six documentation-triggered workflows: inventory 38133653183,
quality 38133653174, desktop build 38133653141, plugin renderer 38133653116,
loaded-plugin workflows 38133653206, and Rust CI 38133653218. Rust CI passed
on Rust 1.95, Ubuntu, macOS, and Windows. The path-filtered Obsidian round-trip
did not trigger for this tracker-only commit; Linux, macOS, and Windows passed
on implementation SHA `b6f0bbb2fd5f098864f2451ea7ac1626e058e3ee`. Exact job IDs
are in `evidence/r2.8.80-tracker-checkpoint-21c801a.json`.

R2.8.81 adds a private injected app-data-root seam while keeping production
root selection after vault resolution and canonicalization. Cross-platform
tests check the hashed location, ownership markers, unchanged vault paths and
bytes, and rejection of an in-vault root before creation. A parallel read-only
review found no blocker. The source commit is pushed for exact-SHA validation;
all seven required workflows are pending. C09 and C09.1 remain pending. No
local tests, builds, formatters, validators, or application launch were run.

## 2026-10-11T10:53:45Z — R2.8.80 tracker checkpoint accepted; R2.8.81 prepared

Tracker SHA `9a00847a683450aa667d74805f07c9ed98d1cb66` passed all six
documentation-triggered workflows: inventory 38132934956, quality 38132934911,
desktop build 38132934909, plugin renderer 38132934942, loaded-plugin workflows
38132934924, and Rust CI 38132934912. Rust CI passed on Rust 1.95, Ubuntu,
macOS, and Windows. The path-filtered Obsidian round-trip did not trigger for
the tracker-only commit; Linux, macOS, and Windows passed on implementation
SHA `b6f0bbb2fd5f098864f2451ea7ac1626e058e3ee`. Exact job IDs are in
`evidence/r2.8.80-tracker-checkpoint-9a00847.json`.

R2.8.81 prepares a private injected-root seam for per-vault app-data creation
while production continues to select the platform user-data path. CI tests
cover an outside-vault path with ownership markers and unchanged vault paths
and bytes, plus rejection before creating any in-vault data directory. A
read-only parallel review found no blocker; it specifically checked that the
production root supplier runs after existing vault resolution and
canonicalization. Exact-SHA validation is pending. C09 and C09.1 remain
pending. No local tests, builds, formatters, validators, or application launch
were run.

## 2026-10-11T11:15:11Z — R2.8.81 attempt 1 CI findings

Exact source SHA `64fdca004c6f5c2c3801fac7f14c86e10c503a04` completed all seven
required workflows. The attempt is not accepted and its complete run, job, and
artifact evidence is in `evidence/r2.8.81-attempt-1-64fdca0.json`. Inventory,
desktop build, plugin renderer, loaded-plugin workflows, MSRV 1.95, and the
macOS Obsidian round-trip passed. Rust Clippy failed on Ubuntu, macOS, and
Windows because the private injected-root test helper was unused in production;
the workspace tests passed on each platform. The helper now has `#[cfg(test)]`,
preserving its two test call sites while excluding it from production builds.

The Ubuntu quality workflow timed out while waiting for final local retrieval
metadata in the Electron audit; recent Linux runs and this SHA's macOS and
Windows jobs passed that audit. Linux Obsidian round-trip stopped at native
picker window discovery and Windows stopped when accessibility automation
could not find `Close source preview` after an external note refresh. Their
artifacts confirm the app-data root stayed outside the vault and the boundary
checks passed. These failures do not implicate the app-data change; the next
exact-SHA run must pass all seven workflows before this partial C09 slice is
accepted. C09 and C09.1 remain pending. No local tests, builds, formatters,
validators, or application launches were run.

## 2026-10-11T11:27:57Z — R2.8.81 accepted on exact source SHA

Corrected source SHA `fb5105853f7e7a34ea64acc5c095e5358e44791e` passed all seven
required GitHub Actions workflows. Rust CI passed on Ubuntu, macOS, Windows,
and the Rust 1.95 MSRV. Quality, inventory, desktop build, plugin renderer,
loaded-plugin workflows, and the Linux/macOS/Windows Obsidian round-trip also
passed. Exact run/job IDs and round-trip artifact metadata are recorded in
`evidence/r2.8.81-c09-app-data-separation-fb51058.json`; the rejected first
attempt is retained in `evidence/r2.8.81-attempt-1-64fdca0.json`.

R2.8.81 is accepted as a partial C09 app-metadata boundary slice. The test-only
annotation fixed the Clippy dead-code issue without changing production path
selection. The initial Electron retrieval timeout and Linux/Windows UI
automation failures did not reproduce on retry; all round-trip reports show
the app-data root outside the vault and no unintended app-data changes. Parent
C09 and C09.1 remain pending. After the tracker checkpoint passes, the next
bounded candidate is R2.8.82: canonical theme identity with read-only CSS
safety analysis. No local tests, builds, formatters, validators, or application
launches were run.

## 2026-10-11T11:48:25Z — R2.8.81 tracker checkpoint passed

Tracker checkpoint SHA `5587460c9adb5858562bbb21e2fe059e989f34fd` passed all
six required documentation workflows: inventory run 38136037616, quality
38136037614, desktop build 38136037621, plugin renderer 38136037596,
loaded-plugin workflows 38136037665, and Rust CI 38136037601. Rust CI passed
on Ubuntu, macOS, Windows, and Rust 1.95. Exact job IDs and run URLs are in
`evidence/r2.8.81-tracker-checkpoint-5587460.json`. The path-filtered Obsidian
round-trip remains covered by implementation SHA
`fb5105853f7e7a34ea64acc5c095e5358e44791e`. Next, push this tracker evidence
checkpoint and validate its documentation workflows, then submit R2.8.82 for
all seven required source workflows. C09 and C09.1 remain pending. No local
tests, builds, formatters, validators, or application launches were run.

## 2026-10-11T11:57:33Z — R2.8.81 tracker evidence passed; R2.8.82 prepared

Tracker evidence commit SHA `51b523a38cbacba3f0b03d718daacd9e086156c6` passed
all six documentation workflows. The first quality attempt failed only on
macOS because the Electron vault audit indexed its fixture but did not observe
the local retrieval boundary before the assertion timed out; GitHub reran the
failed job and the second attempt passed. The other quality OS jobs and the
inventory, desktop build, plugin renderer, loaded-plugin workflows and Rust CI
passed. Run IDs, job IDs and the retry finding are recorded in
`evidence/r2.8.81-tracker-checkpoint-51b523a.json`. The path-filtered Obsidian
round-trip remains covered by R2.8.81 source SHA
`fb5105853f7e7a34ea64acc5c095e5358e44791e`.

R2.8.82 is prepared as a partial C09 style/settings slice. It keeps normalized
vault-relative paths as canonical asset IDs, adds folder-aware display names
and scoped duplicate matching, and exposes explicitly heuristic read-only CSS
analysis. The folder entrypoint rule intentionally corrects `theme.css` to use
its parent theme folder name (for example, `Solarized`) while retaining the
full path as identity. Fixture coverage connects `appearance.json` theme and
snippet settings to discovered assets and covers multiple same-name styles.
The source SHA and all seven required workflows are pending. C09 and C09.1
remain pending. The next small C09 candidate is a data-only projection of
vault `hotkeys.json`, kept separate from app-owned shortcut dispatch. No local
tests, builds, formatters, validators, or application launches were run.

## 2026-10-11T11:59:51Z — R2.8.82 static parity review

Parallel static reviews compared the CSS metadata heuristics against the
existing TypeScript analyzer and checked the configuration asset mappings.
The final CSS custom property now matches the legacy analyzer's requirement
for a semicolon or end-of-input, and `.workspace` detection accepts the full
ECMAScript whitespace set. Fixture cases cover those boundaries, selected
appearance theme and enabled snippet resolution, duplicate display names, and
the folder-entrypoint display-name correction. The configuration fixture
digest in the inventory is refreshed. Changes remain source-reviewed only;
the exact-SHA GitHub CI gate is pending. No local tests, builds, formatters,
validators, or application launches were run.

## 2026-10-11T12:04:48Z — R2.8.82 first CI attempt found compile and formatting errors

Source SHA `77f174934bfcbc509d9f0436bdbd25c5e66f9728` passed inventory,
quality, desktop build, plugin renderer and loaded-plugin workflows. Rust CI
failed on Ubuntu, macOS, Windows and Rust 1.95 with E0505 because the lossy
UTF-8 view borrowed `raw_bytes` through the struct initializer after the bytes
were moved. Ubuntu also reported rustfmt changes in the new analyzer and vault
fixture checks. All three Obsidian round-trip jobs stopped at the same native
preview build error. Exact run/job results are in
`evidence/r2.8.82-ci-attempt-77f1749.json`. The correction now computes owned
analysis inside a scoped borrow and applies the formatter's reported layouts.
The follow-up source SHA and its seven-workflow CI results are pending. C09
and C09.1 remain pending. No local tests, builds, formatters, validators, or
application launches were run.

## 2026-10-11T12:15:12Z — R2.8.82 second CI attempt found fixture order and UI harness issue

Follow-up SHA `fe57d3061d0ee379846b1f8e07337a1a2029b552` passed inventory,
quality, desktop build, plugin renderer and loaded-plugin workflows. Its Rust
CI jobs reached the theme fixtures but found that the safe-theme selector
expectation did not follow first-seen source order; Ubuntu also requested one
remaining rustfmt layout. The macOS and Windows Obsidian round-trip jobs
passed. The Linux round-trip report records that the xdotool visible-window
search could not find a visible window. Workflow/job IDs and
the Linux artifact reference are in
`evidence/r2.8.82-ci-attempt-fe57d30.json`. The fixture expectation and final
formatting layout are corrected locally and the fixture hash is refreshed.
The next exact-SHA run must confirm the retry of all seven required workflows.
C09 and C09.1 remain pending. No local tests, builds, formatters, validators,
or application launches were run.

## 2026-10-11T12:26:02Z — R2.8.82 third CI attempt isolated one Clippy lint

Source SHA `b7ccff97711f8c411bd3c39dc6c43726128b7ea3` passed inventory,
quality, desktop build, plugin renderer, loaded-plugin workflows and all three
Obsidian round-trip jobs. Rust 1.95 tests also passed. Stable Rust CI failed
Clippy on Ubuntu, macOS and Windows because `selector_has_class_word` returned
a temporary `next_ok` binding directly; the lint is denied by the workspace
CI command. Exact run/job results are in
`evidence/r2.8.82-ci-attempt-b7ccff9.json`. The predicate now returns directly
from its closure. The follow-up source SHA and exact-SHA CI results are
pending. C09 and C09.1 remain pending. No local tests, builds, formatters,
validators, or application launches were run.

## 2026-10-11T12:44:04Z — R2.8.82 source validation passed

Implementation SHA `8c1ae9f4300f113b54e3cc02073f7af2dda49514` passed all seven required GitHub Actions workflows:
inventory, quality, desktop build, plugin renderer, loaded plugins, Rust CI
(including Rust 1.95), and the Linux/macOS/Windows Obsidian round-trip. The
first Windows round-trip attempt could not find the Close source preview
control; GitHub reran the failed job on the same SHA and attempt 2 passed.
Exact workflow and job IDs, URLs, and retry details are recorded in
`evidence/r2.8.82-c09-style-identity-css-8c1ae9f.json`. R2.8.82 is accepted as a partial C09 settings/style slice; C09
and C09.1 remain pending.

The next action is a documentation-only tracker checkpoint for the exact-SHA
results, followed by the six required GitHub workflows. Parallel read-only
research is underway for the next bounded candidate, a vault `hotkeys.json`
data-only projection kept separate from app-owned shortcut dispatch. No local
tests, builds, formatters, validators, or application launches were run.

## 2026-10-11T12:48:18Z — R2.8.83 hotkeys source research and implementation started

Two independent read-only reviews established that this repository has no vault
`hotkeys.json` parser or fixture. The legacy loader recursively inventories
configuration JSON but only adds a typed `appearance.json` projection; the
app-owned shortcut catalog remains a separate concern. Obsidian's public API
defines a hotkey as ordered modifier strings plus a key string and documents
platform aliases; the Help page allows multiple combinations per command. The
public docs do not specify the complete on-disk serialization, so the new
fixture pins only the narrow supported shape and original JSON/bytes remain
authoritative. Research and boundaries are in
`evidence/r2.8.83-hotkeys-source-research.md`.

The selected slice projects only root-level `hotkeys.json`, preserves root
identity, empty command arrays, order, unknown command/modifier strings and
raw malformed entries, and does not register or normalize imported bindings.
Fixture-backed parser and vault assertions are being prepared. Tracker
checkpoint SHA `4f798c2c78f109903d19d6d8d2921f3a3b538901` has passed inventory and plugin renderer;
quality, desktop build, loaded plugins and Rust CI are still running. No local
tests, builds, formatters, validators, or application launches were run.

## 2026-10-11T12:52:09Z — R2.8.82 tracker checkpoint passed

Tracker checkpoint SHA `4f798c2c78f109903d19d6d8d2921f3a3b538901` passed all six required
documentation workflows: inventory, quality on all three OSes, desktop build
on all three OSes, plugin renderer on all three OSes, loaded plugins on all
three OSes, and Rust CI on Ubuntu, macOS, Windows and Rust 1.95. Exact run/job
IDs and URLs are in `evidence/r2.8.82-tracker-checkpoint-4f798c2.json`. The path-filtered Obsidian
round-trip passed on implementation SHA
`8c1ae9f4300f113b54e3cc02073f7af2dda49514`; it was not expected on this
documentation-only commit. No local executable validation was run.

R2.8.83 source review found no apparent type/API issue; its root-path guard and
fixture ordering match the inventory contract. The bounded source slice is
ready for its exact-SHA seven-workflow CI push. C09 and C09.1 remain pending.

## 2026-10-11T12:52:55Z — R2.8.83 source pushed; seven-workflow CI pending

Implementation SHA `ece504236c0abb38c6fe765243f505965a4316fb` was pushed to `origin/main`. GitHub queued all
seven required workflows: inventory run 38140952526, quality 38140952527,
desktop build 38140952528, plugin renderer 38140952531, loaded plugins
38140952529, Rust CI 38140952548, and Obsidian round-trip 38140952546. The
source commit includes the R2.8.82 six-workflow tracker evidence and R2.8.83
source research. The implementation remains pending until all seven exact-SHA
workflows pass. No local tests, builds, formatters, validators, or application
launches were run.

## 2026-10-11T13:02:59Z — R2.8.83 first CI attempt identified formatter and UI timing issues

Source SHA `ece504236c0abb38c6fe765243f505965a4316fb` passed inventory, quality, desktop build, plugin renderer,
and loaded-plugin workflows. Rust CI passed on macOS, Windows, and Rust 1.95;
Ubuntu workspace tests passed, while Ubuntu's formatter check reported exact
layout changes in the new hotkeys assertions and imports. Those reported
changes have been applied directly from GitHub's output.

The Obsidian round-trip passed on Ubuntu. macOS timed out waiting for the
enabled Resolve link status button bounds; Windows timed out while previewing
the renamed note. Their logs and artifact IDs are recorded in
`evidence/r2.8.83-attempt-1-ece5042.json`. The corrected source SHA will rerun all seven workflows, which
will show whether those UI timeouts reproduce. No local tests, builds,
formatters, validators, or application launches were run.

## 2026-10-11T13:15:04Z — R2.8.83 passed on the corrected exact source SHA

Source SHA `6d4d891d61acad3ad1c3bbdf8d2b409ab5aa2aef` passed all seven required
GitHub Actions workflows. Inventory, quality, desktop build, plugin renderer,
loaded plugins and Rust CI passed. Rust CI passed on Ubuntu, macOS, Windows and
Rust 1.95. The pinned Obsidian 1.14.4 round-trip passed on Ubuntu, Windows and
macOS, resolving the two attempt-1 UI timeouts. Each downloaded round-trip
report records this exact SHA and `status: passed`; report hashes and workflow,
job and artifact IDs are recorded in
`evidence/r2.8.83-attempt-2-6d4d891.json`. R2.8.83 is accepted as a partial
C09 settings/hotkeys data-only slice; C09 and C09.1 remain pending. The next
action is a documentation-only tracker checkpoint, followed by the next
bounded settings slice selected from parallel read-only research. No local
tests, builds, formatters, validators, or application launches were run.

## 2026-10-11T13:27:00Z — R2.8.83 tracker checkpoint passed; R2.8.84 scoped

Documentation-only tracker SHA `9176467a8b77bc1963352421867cc87f7dfc9798` passed
all six required documentation workflows, including Rust CI on Ubuntu, macOS,
Windows and Rust 1.95. Its path-filtered Obsidian round-trip was not triggered;
that workflow passed on implementation SHA
`6d4d891d61acad3ad1c3bbdf8d2b409ab5aa2aef`. Exact run/job IDs are recorded in
`evidence/r2.8.83-tracker-checkpoint-9176467.json`.

Two independent read-only reviews compared the remaining app, workspace, and
plugin configuration candidates. The next slice is limited to the existing
fixture-backed `showLineNumber` Boolean in root `app.json` files. The typed view
will preserve true/false while treating missing or incorrectly typed values as
absent, retain exact JSON bytes and unknown fields, and leave nested plugin
`app.json` files generic. It does not change UI behavior or claim a complete
Obsidian `app.json` schema. Scope and review rationale are in
`evidence/r2.8.84-app-json-source-research.md`. C09 and C09.1 remain pending.
No local tests, builds, formatters, validators, or application launches were
run.

## 2026-10-11T13:42:20Z — R2.8.84 attempt 1: CI formatter correction

Source SHA `7ed26f588722fa5f665e7ba12ba53236c790497e` passed six of seven
required workflows. Rust CI failed only the Ubuntu `cargo fmt --all -- --check`
step; the workspace tests passed on Ubuntu, macOS, Windows and Rust 1.95, and
the macOS/Windows stable jobs passed. The pinned Obsidian 1.14.4 round-trip
passed on Linux, macOS and Windows. Each downloaded report records this exact
SHA and `status: passed`; report and artifact hashes are recorded in
`evidence/r2.8.84-attempt-1-7ed26f5.json`. The two import-list wraps reported
by GitHub are corrected locally. R2.8.84 remains pending until a fresh exact
source SHA passes all seven workflows. C09 and C09.1 remain pending. No local
tests, builds, formatters, validators, or application launches were run.

## 2026-10-11T13:45:10Z — R2.8.84 attempt 2 pushed for CI

Formatting-only correction source SHA
`16b5f362ba2ca922bcac4a492248e09a7dbfcd8f` was pushed to `origin/main`.
The exact-SHA workflow runs are inventory `38144412216`, quality
`38144412181`, desktop build `38144412227`, plugin renderer `38144412219`,
loaded plugins `38144412166`, Rust CI `38144412174`, and vault round-trip
`38144412179`. Results are pending. R2.8.84 remains in progress; C09 and C09.1
remain pending. No local tests, builds, formatters, validators, or application
launches were run.


## 2026-10-11T13:55:34Z — R2.8.84 accepted; tracker checkpoint next

The formatting-correction source SHA
`16b5f362ba2ca922bcac4a492248e09a7dbfcd8f` passed all seven required
GitHub Actions workflows. Rust CI passed on Ubuntu, macOS, and Windows, plus
the Rust 1.95 job. The pinned Obsidian 1.14.4 round-trip passed on Linux,
macOS, and Windows. Exact run and job IDs, round-trip artifact IDs and archive
digests, report hashes, and CI limitations are in
`evidence/r2.8.84-attempt-2-16b5f36.json`.

Each round-trip report records this exact source SHA, passed status, and
unchanged non-workspace vault paths after reopen. The macOS report records
initial `app.ron` persistence; app data remained separate from the vault and
unchanged after the later picker baseline and close. No local executable
validation was run.

R2.8.84 is accepted as a partial C09 app-settings projection. C09 and C09.1
remain pending. The documentation-only tracker checkpoint is next; the passed
path-filtered round-trip remains covered by implementation SHA
`16b5f362ba2ca922bcac4a492248e09a7dbfcd8f`.


## 2026-10-11T14:00:22Z — R2.8.84 tracker checkpoint pushed for CI

Documentation-only tracker checkpoint SHA
`da3f8908ba1f8ea06a7a633abe075b300826e6e1` was pushed after source acceptance.
The six exact-SHA workflow runs are inventory `38145363300`, quality
`38145363315`, desktop build `38145363393`, plugin renderer
`38145363350`, loaded plugins `38145363345`, and Rust CI `38145363322`.
Their results are pending. The path-filtered Obsidian round-trip remains covered
by implementation SHA `16b5f362ba2ca922bcac4a492248e09a7dbfcd8f`. No local
tests, builds, formatters, validators, or application launches were run.

## 2026-10-11T14:09:33Z — R2.8.84 tracker checkpoint accepted; R2.8.85 scoped

Documentation-only tracker SHA
`da3f8908ba1f8ea06a7a633abe075b300826e6e1` passed all six required
documentation workflows. Inventory run `38145363300` passed job
`114487459845`; desktop build `38145363393`, plugin renderer `38145363350`,
and loaded plugin workflows `38145363345` passed all their OS jobs. Rust CI
`38145363322` passed Ubuntu `114487460167`, macOS `114487460072`, Windows
`114487459904`, and Rust 1.95 `114487460133`.

Quality run `38145363315` passed on attempt 2: macOS `114487946021`, Ubuntu
`114487946774`, and Windows `114487972443`. Its initial macOS job
`114487460243` timed out while waiting for the local retrieval boundary after
indexing had completed; the same-SHA rerun passed, indicating a transient
timing delay. The path-filtered Obsidian round-trip did not run for this
documentation-only commit and remains covered by implementation SHA
`16b5f362ba2ca922bcac4a492248e09a7dbfcd8f`. Exact run and job results are in
`evidence/r2.8.84-tracker-checkpoint-da3f890.json`. C09 and C09.1 remain
pending. No local executable validation was run.

Parallel read-only audits selected R2.8.85 as a data-only projection of the
legacy template folder and daily-note folder, date format, and optional
template path settings. The parser will retain source objects/bytes and
unknown fields, report legacy path issues, and keep projected paths inert.
Nested plugin files remain generic JSON only. Recognized alternate
`.obsidian-*` roots follow the existing Rust C09 discovery policy; this is
broader than the legacy workflow's `.obsidian`-only read path and will not be
described as exact workflow parity. Template execution, date expansion,
planning, writes, and UI behavior are out of scope. No local tests,
builds, formatters, validators, or application launches were run.

## 2026-10-11T14:22:32Z — R2.8.84 tracker checkpoint accepted; R2.8.85 source prepared

The documentation-only tracker SHA
`96a1224525e3c195a6dd5ac54f0ecaeee81a04b8` passed all six required workflows.
Inventory, desktop build, plugin renderer, loaded plugin workflows, and Rust CI
passed on attempt 1. Quality passed on attempt 3 after two macOS retries timed
out at the local retrieval boundary; attempt 3 passed while the parallel
plugin lifecycle audit was running. Exact run and job results are recorded in
`evidence/r2.8.84-tracker-checkpoint-96a1224.json`. The path-filtered
round-trip remains covered by implementation SHA
`16b5f362ba2ca922bcac4a492248e09a7dbfcd8f`.

R2.8.85 now projects typed template-folder and daily-note settings from exact
root configuration files while preserving source JSON bytes, unknown fields,
and generic nested plugin files. Its fixture includes alternate roots,
malformed/non-object files, unsafe paths and types, CRLF bytes, and unchanged
snapshot checks. The Rust APIs accept parsed JSON object maps; discovery omits
non-object inputs before projection. C09 and C09.1 remain pending. Only
GitHub Actions will validate the source SHA; the seven required workflows
include the path-filtered Obsidian round-trip.

Process note: two local `git diff --check` commands were accidentally run
during review (one by the root agent and one by a parallel reviewer). No
project tests, builds, formatters, or application launches were run; all
project validation remains assigned to GitHub Actions.

## 2026-10-11T14:34:26Z — R2.8.85 source attempt 1 CI findings

Source SHA `d7d46b610004c3705ba3427c6e7eaed57fe9020f` passed the quality,
desktop build, plugin renderer, loaded-plugin, and Obsidian 1.14.4 round-trip
workflows. The round-trip passed on Windows, Ubuntu, and macOS. Rust workspace
tests passed on Ubuntu, macOS, Windows, and Rust 1.95. Inventory failed because
the changed configuration fixture digest had not yet been reconciled. Clippy
reported eight arguments on `discover_directory` for macOS and Windows;
Ubuntu rustfmt reported one assertion wrap and one import reflow. Exact run
and job results are in `evidence/r2.8.85-attempt-1-d7d46b6.json`.

The follow-up groups recursive discovery output through `VaultConfiguration`,
applies the two rustfmt changes from CI, and updates the fixture SHA and purpose
in `inventory.json`. R2.8.85 remains in progress; C09 and C09.1 remain pending.
No local project tests, builds, formatters, or application launches were run.

## 2026-10-11T14:53:31Z — R2.8.85 accepted after same-SHA retries

Correction SHA `26c3363b1bc07eac10c56a7a258b914bc36f67f3` passed all seven
required workflows. Inventory, desktop build, plugin renderer, loaded-plugin
workflows, and Rust CI passed on attempt 1. Quality passed on same-SHA attempt
2 after its first macOS job timed out at the local retrieval boundary. The
Obsidian 1.14.4 round-trip passed on same-SHA attempt 2 after the first Windows
job timed out waiting for a preview after external note rename. Ubuntu,
macOS, Windows, and Rust 1.95 Rust CI jobs passed. Exact job IDs, report hashes,
artifact IDs, and digests are in
`evidence/r2.8.85-attempt-2-26c3363.json`.

The Windows artifact review showed that rename bytes/hash, refreshed note
count, renamed-path selection, vault bytes, and app-data bytes were correct.
A parallel read-only code audit identified that a delayed watcher refresh can
clear an unchanged read-only preview. R2.8.85 is accepted as a partial C09
data-only settings slice; C09 and C09.1 remain pending. R2.8.86 will make the
refresh preserve an open preview only while its path and revision still match.
No local tests, builds, formatters, validators, or application launches were
run.

## 2026-10-11T15:19:47Z — R2.8.85 checkpoint and R2.8.86 acceptance

The R2.8.85 tracker checkpoint `9558a9a09c5bf9f9f9778c1b6c1679259290b66d`
passed all six documentation workflows on the exact SHA. The source SHA
`26c3363b1bc07eac10c56a7a258b914bc36f67f3` had already passed its seven
required workflows, including the three-platform Obsidian 1.14.4 round-trip.
Run and job IDs are in `evidence/r2.8.85-tracker-checkpoint-9558a9a.json`.

R2.8.86 preserves an open read-only note preview during refresh when the
previewed file's path and disk revision are unchanged. External note edits or
deletions still clear it, and an active embed report/error retains the prior
attachment invalidation behavior. The first source attempt failed nine
attachment-embed UI cases because it preserved stale previews too broadly. The
second attempt restored those cases and passed workspace tests, but Ubuntu
rustfmt reported two layout changes. The formatted correction
`a7d718c9d216df26776c2022a29d6d9e1babb66d` passed all seven required workflows
on the exact SHA, including Rust CI on Ubuntu, macOS, Windows, and Rust 1.95,
and the pinned Obsidian round-trip on all three platforms. Exact run/job IDs
and artifact digests are in `evidence/r2.8.86-attempt-3-a7d718c.json`.

R2.8.86 is accepted as a bounded C01 preview-refresh slice. C01 and C01.2 remain
pending because this case does not close their broader read-only acceptance
matrix. C09 and C09.1 also remain pending. The C09.1 Rust policy owner is
corrected to `crates/plugins`; R2.8.87 will add a pure deny-only
`configuration.write` policy and fixture-backed denial record coverage. It
will not claim full enforcement until Rust discovery and enablement callsites
route through the policy and present the decision. No local tests, builds,
formatters, validators, or application launches were run.

The R2.8.86 tracker checkpoint at `c09cc905858acef6009582ab02135395ff4a0e0b`
passed all six documentation workflows. Quality's initial Ubuntu job timed
out at the known Electron local-retrieval boundary; its same-SHA retry passed.
Exact run and job IDs are in
`evidence/r2.8.86-tracker-checkpoint-c09cc90.json`. The Obsidian round-trip
remains covered by implementation SHA `a7d718c9d216df26776c2022a29d6d9e1babb66d`.
No local executable validation was run.

R2.8.87 attempt 1 was pushed as `dac76cc1b08d47c84667785cea8cad1fb2e86ff2`.
Inventory, quality, desktop build, plugin renderer, loaded-plugin workflows,
and the three-platform Obsidian round-trip passed. Rust CI passed Windows,
macOS, and Rust 1.95; Ubuntu tests, Clippy, layer checks, and build passed but
`cargo fmt --all -- --check` reported two line-wrap differences. The exact
workflow/job results are in `evidence/r2.8.87-attempt-1-dac76cc.json`. The
formatter corrections are taken directly from GitHub's output. No local
executable validation or formatter run was performed.

R2.8.87 attempt 2 was pushed as `99eb225f652ee6c0cbdb3dc935d0f99da5c0874b`.
Six of seven required workflows passed, including all three Obsidian 1.14.4
round-trip jobs. Rust CI passed macOS, Windows, and Rust 1.95; Ubuntu workspace
tests passed, but `cargo fmt --all -- --check` reported one line-wrap difference
in `crates/plugins/src/lib.rs`. The exact CI correction is applied for attempt
3. Run and job IDs are in `evidence/r2.8.87-attempt-2-99eb225.json`. No local
executable validation or formatter run was performed.

R2.8.87 attempt 3 was accepted on exact source SHA
`8891393ff5955a1797a8d6626c2d4d17d6509552`. All seven required GitHub
Actions workflows passed, including Rust CI on Ubuntu, macOS, Windows, and Rust
1.95 and the pinned Obsidian 1.14.4 round-trip on all three platforms. Quality
attempt 1 had a transient macOS retrieval-boundary timeout; the same-SHA failed-job
retry passed. Run and job IDs are in
`evidence/r2.8.87-attempt-3-8891393.json`. No local executable validation was
used for acceptance. C09 and C09.1 remain pending because real Rust discovery and
enablement callsites do not yet consume and surface the deny policy. The
six-workflow documentation checkpoint is next.

R2.8.88 C06 Canvas work was reviewed in parallel before the source push. The
bounded codec retains unknown JSON values semantically, and the pinned Obsidian
reopen audit seeds the referenced note/background, checks the visible Canvas
marker and exact path, and compares Canvas bytes before and after reopen. Keep
C06 and C06.1 pending for broader editing/writing and explicit-action behavior.
One audit agent accidentally ran `git diff --check` on this uncommitted work; it
produced no output and was not used as validation evidence. No repository code
was changed by that command. All acceptance validation remains assigned to
GitHub Actions.

R2.8.87 documentation-only tracker checkpoint SHA
`ce59d7399caf58d498529dd29794c2c2c44c93dd` passed all six required workflows
on attempt 1, including Rust CI on Ubuntu, macOS, Windows, and Rust 1.95. Exact
run/job IDs are in `evidence/r2.8.87-tracker-checkpoint-ce59d73.json`. The
path-filtered Obsidian round-trip remains covered by accepted implementation SHA
`8891393ff5955a1797a8d6626c2d4d17d6509552`.

R2.8.88 is in progress as a bounded C06 Canvas codec and pinned reference-reopen
slice. Its source commit includes the semantic parser/encoder, fixture-driven
known/unknown field and malformed-input coverage, fixture inventory row, and
three-platform Obsidian reopen audit. Full C06 and C06.1 remain pending: this
slice does not implement Canvas editing, explicit note creation, vault writes,
or UI integration. No local executable validation is used for acceptance.

R2.8.88 source attempt 1 (`1118d999531eea586073e6184e153d751437711d`) passed
inventory, quality, desktop build, plugin renderer, and loaded-plugin workflows.
Rust CI passed Rust 1.95, macOS, and Windows; Ubuntu workspace tests passed but
its formatting gate failed on five `crates/doc/src/canvas.rs` layouts. The
Obsidian round-trip failed on all three OSes: Ubuntu's screenshot showed three
Markdown files while OCR read two, and macOS/Windows changed the renamed note
from 142 to 132 bytes after the new Canvas selection. The Windows artifact
confirms the Canvas marker/path and unchanged Canvas bytes before that later
failure. Exact run/job IDs and artifact digests are recorded in
`evidence/r2.8.88-attempt-1-1118d99.json`.

Attempt 2 keeps the Rust formatting corrections from GitHub's log, delays the
Canvas target note until after OpenObsidian's count-sensitive audit, moves the
Canvas check before selecting the edited note, and uses the standard
`#^block-id` Canvas subpath with an unresolved-link assertion. The edited-note
byte check remains enabled. All acceptance validation remains on GitHub Actions;
no local tests, builds, formatters, validators, or app launches were run.

R2.8.88 attempt 2 was committed and pushed as
`9b74c39858ea1576791b83ad4f3d6d6bb5af197c`. Exact-SHA runs are inventory
38156539343, quality 38156539318, desktop build 38156539371, plugin renderer
38156539242, loaded-plugin workflows 38156539417, Rust CI 38156539262, and
Obsidian round-trip 38156539309. Six workflows passed, including all Rust jobs
on Ubuntu, macOS, Windows, and Rust 1.95. The three round-trip jobs visibly
opened the Canvas and passed the immediate byte check, but the final post-close
snapshot found the same rewrite on Linux, macOS, and Windows: 1,818 bytes / SHA
`fb2523fb5328b3df233fda21fb31acf5dcecd6fc5028d41a5d38d8b3a8584479` became
1,345 bytes / SHA
`0ada29494f95af2572b28af1117a4ff4b0d89436e07da06572815c16f80c1535`. The
renamed external note remained exact. Job IDs and artifact archive digests are
in `evidence/r2.8.88-attempt-2-9b74c39.json`. No local executable validation
was run.

Attempt 3 isolates the pinned-app probe in a dedicated vault and fresh profile,
using a known-field Canvas fixture. The codec's rich unknown-field fixture stays
in Rust coverage; the app probe checks the reference fixture after first
shutdown, opens the same vault in a second process, and checks it again after
shutdown. It checks the target paragraph and rejects Obsidian's unresolved
subpath error while retaining `#^block-id` in the Canvas source; it does not
expect the renderer to display Markdown's hidden block-ID syntax. Both C01.2's
whole-vault check and the Canvas source checks remain strict. No local tests,
builds, formatters, validators, or app launches were run. C06 and C06.1 remain
pending.

R2.8.88 attempt 3 was committed and pushed as exact source SHA
`260d095f42ef5c4d6a237e59b58058975482ab2c`. Inventory run
[38158188281](https://github.com/ashutoshpw/open-obsidian/actions/runs/38158188281)
passed. Exact-SHA quality [38158188304](https://github.com/ashutoshpw/open-obsidian/actions/runs/38158188304),
desktop build [38158188305](https://github.com/ashutoshpw/open-obsidian/actions/runs/38158188305),
plugin renderer [38158188261](https://github.com/ashutoshpw/open-obsidian/actions/runs/38158188261),
loaded plugins [38158188265](https://github.com/ashutoshpw/open-obsidian/actions/runs/38158188265),
Rust CI [38158188271](https://github.com/ashutoshpw/open-obsidian/actions/runs/38158188271),
and Obsidian round-trip [38158188254](https://github.com/ashutoshpw/open-obsidian/actions/runs/38158188254)
were queued or running at first inspection. All seven workflow IDs and initial
statuses are in `evidence/r2.8.88-attempt-3-260d095.json`; acceptance remains
pending until every required job and platform settles. No local executable
validation was run.

R2.8.88 attempt 3 passed all seven required workflows on exact source SHA
`260d095f42ef5c4d6a237e59b58058975482ab2c`, with no retries. Rust CI passed
Ubuntu, macOS, Windows, and Rust 1.95; the pinned Obsidian 1.14.4 round-trip
passed on Linux, macOS, and Windows. All three archived reports show the
referenced Canvas marker/path/paragraph visible, no unresolved subpath error,
and the same 741-byte Canvas SHA-256
`2258580368625a06b2b3d2f5b0576b032678b0a7bc73d1292716642c9c7f4cc5` before
open, after the first shutdown, and after reopen and the second shutdown. The
dedicated vault changed only `.obsidian/workspace.json` on first open and had no
further changes on reopen; the main C01.2 non-workspace vault paths remained
unchanged. Artifact IDs, archive digests, report hashes, per-job IDs, and exact
workflow links are recorded in `evidence/r2.8.88-attempt-3-260d095.json`.
R2.8.88 is accepted as a bounded Canvas codec and pinned reference-reopen slice;
full Canvas editing/writing, note creation, and explicit-action behavior remain
pending under C06/C06.1. No local executable validation was run; the downloaded
CI artifacts were inspected as evidence only.

The documentation-only R2.8.88 tracker checkpoint was pushed as exact SHA
`a051739cd366310715b1cac8353752921dd05ab0`. Inventory
[38159101527](https://github.com/ashutoshpw/open-obsidian/actions/runs/38159101527),
quality [38159101521](https://github.com/ashutoshpw/open-obsidian/actions/runs/38159101521),
desktop build [38159101524](https://github.com/ashutoshpw/open-obsidian/actions/runs/38159101524),
plugin renderer [38159101522](https://github.com/ashutoshpw/open-obsidian/actions/runs/38159101522),
loaded plugin workflows [38159101529](https://github.com/ashutoshpw/open-obsidian/actions/runs/38159101529),
and Rust CI [38159101583](https://github.com/ashutoshpw/open-obsidian/actions/runs/38159101583)
all passed on attempt 1, including Rust 1.95 and every OS matrix job. Exact job
IDs are recorded in `evidence/r2.8.88-tracker-checkpoint-a051739.json`. The
path-filtered Obsidian round-trip remains covered by accepted source SHA
`260d095f42ef5c4d6a237e59b58058975482ab2c`. No local executable validation
was run.

The R2.8.88 tracker record was committed as exact SHA
`a1600c8f918f4e540dcb0b66b894986aab375a2f`. Its six required documentation
workflows passed on attempt 1, including inventory, quality, desktop build,
plugin renderer, loaded plugins, and Rust CI on Ubuntu, macOS, Windows, and Rust
1.95. Exact workflow and job IDs are in
`evidence/r2.8.88-tracker-checkpoint-a1600c8.json`; the path-filtered Obsidian
round-trip remains covered by source SHA
`260d095f42ef5c4d6a237e59b58058975482ab2c`. No local executable validation
was run.

R2.8.89 is a bounded C06.1 document-layer edit slice. It adds a pure
`CanvasDocument::edit_text_node` API, fixture cases proving only the selected
node's text changes while unknown fields and sibling nodes remain intact, and
typed non-mutating failures for missing, duplicate, and non-text node IDs. The
operation has no vault or filesystem path and cannot create a note. Full Canvas
persistence, note extraction, revision-checked note creation, and the explicit
UI action remain pending under C06/C06.1.

R2.8.89 attempt 1 ran all seven required workflows on exact source SHA
`992e92f161f884fcb5393322e428113bf3ef2245`. Inventory, quality, desktop build,
plugin renderer, loaded-plugin workflows, and Obsidian 1.14.4 round-trip passed.
Rust CI passed workspace tests on Ubuntu, all checks on macOS and Windows, and
locked workspace tests on Rust 1.95; Ubuntu failed only its formatting check.
All three Obsidian round-trip reports confirm `C06 Reference.canvas` reopened
with its referenced block visible and its 741-byte source SHA unchanged after
both shutdowns. Exact run/job IDs, artifact IDs and digests, and report hashes
are in `evidence/r2.8.89-attempt-1-992e92f.json`. The exact three line-layout
changes from GitHub's formatter log were applied in correction source SHA
`c74d27860f7c60459373887bf85caec2c3af2182`. All seven required workflows
passed on that exact SHA on attempt 1, including Rust CI across Ubuntu, macOS,
Windows, and Rust 1.95, and Obsidian round-trip across Linux, macOS, and
Windows. Exact run/job IDs, round-trip report hashes, and artifact digests are
in `evidence/r2.8.89-attempt-2-c74d278.json`. R2.8.89 is accepted as a pure
document-layer edit; persisted Canvas edits, explicit note creation, and UI
integration remain pending under C06/C06.1. No local executable validation was
run.

R2.8.90 adds a revision-checked `VaultSession::edit_canvas_text_node` operation.
It checks the supplied SHA-256 before parsing and uses that same revision for
the journaled write. Fixture-backed coverage checks persisted text edits,
unknown-field and sibling preservation, invalid nodes and IDs, stale revisions,
malformed Canvas data, unsafe paths, and that editing never creates a Markdown
note. Portable slash normalization prevents Windows-style path aliases from
reading or writing a different file on Unix. C06 and C06.1 remain pending until
native Canvas UI and the explicit note-creation action are implemented.

R2.8.90 attempt 1 was pushed as exact source SHA
`cec7fc052ad1769fc536f1cc4823480688246026`. Quality, desktop build, plugin
renderer, and loaded-plugin workflows passed. Inventory rejected the
comma-separated owner values for C06 and C06.1. Rust CI and the three-platform
vault round-trip failed because Cargo could not resolve the unqualified
`thiserror` lock entry while two versions were present; Ubuntu Rust CI also
reported formatting changes. The preview build stopped before Obsidian
launched. Exact run/job IDs and successful artifact digests are in
[`evidence/r2.8.90-attempt-1-cec7fc0.json`](evidence/r2.8.90-attempt-1-cec7fc0.json).
The retry uses the allowed single `crates/engine` tracker owner, qualifies
`thiserror 2.0.21`, and applies the formatter layout shown in CI logs. No local
executable validation was run.

R2.8.90 attempt 2 was pushed as exact source SHA
`a5f08ae4c01658fc7c3ff5b4a11bf966977eb880`. Inventory, quality, desktop
build, plugin renderer, loaded-plugin workflows, and the Obsidian 1.14.4
round-trip all passed on their exact run and platform matrices. Rust CI passed
formatting, workspace tests, and Clippy on Ubuntu, macOS, and Windows; the Rust
1.95 locked workspace tests passed. All three platform jobs stopped at the
layer gate because `xtask layers` did not yet allow the intended
`openobsidian-engine -> openobsidian-doc` edge. The pinned reference Canvas
reopened with its marker and linked content visible, and its 741-byte source
SHA-256 `2258580368625a06b2b3d2f5b0576b032678b0a7bc73d1292716642c9c7f4cc5`
remained unchanged after shutdown and reopen on all three platforms. Artifact
digests, round-trip report hashes, and exact job IDs are in
[`evidence/r2.8.90-attempt-2-a5f08ae.json`](evidence/r2.8.90-attempt-2-a5f08ae.json).
The correction updates the architecture allow-map so the engine can compose
the pure document operation with the revision-checked vault write. No local
executable validation was run.

R2.8.90 attempt 3 was accepted on exact source SHA
`612fc550c7061d751672790f2b2b21869e990a9d`. All seven required workflows
passed: inventory, quality, desktop build, plugin renderer, loaded plugins,
Rust CI, and the Obsidian 1.14.4 vault round-trip. Rust CI passed formatting,
workspace tests, Clippy, dependency-layer checks, native builds, and Wry probes
on Ubuntu, macOS, and Windows; Rust 1.95 locked workspace tests passed. Because
the xtask-only correction was outside the round-trip push path filters, that
workflow was manually dispatched and confirmed the same SHA; Linux, macOS, and
Windows all passed. The reports confirm the known-field reference Canvas
reopened with its linked target visible and unchanged source bytes. Exact run
and job IDs, artifact digests, and report hashes are in
[`evidence/r2.8.90-attempt-3-612fc55.json`](evidence/r2.8.90-attempt-3-612fc55.json).
This accepts the persisted Canvas edit slice only; native Canvas UI and
explicit note creation remain pending. No local executable validation was
run.

## 2026-10-11 — R2.8.91 create-only vault write checkpoint

Implemented the vault create-only backend slice with a retained vault-root
capability, no-follow parent traversal, atomic no-clobber hard-link publication,
incoming recovery history, journal recovery, and file-identity-gated staging
cleanup. Added failure-injection coverage for racing targets, interrupted
publication, ambiguous or foreign staging files, and partial staging writes.
Recovery preserves stages whose ownership cannot be proven; committed cleanup
may remove a stage only after proving it is the published target's hard link.

Independent read-only reviews checked recovery ordering, stage ownership, path
races, Windows behavior, documented limits, and Rust formatting. They found no
obvious API or type issue; they identified two continuation-indentation issues,
a tracker wording mismatch, and invalid JSON punctuation, all corrected by
inspection. The tracker now records that a detected staging-name race can
require explicit recovery and that directory-entry durability is not guaranteed
across power loss. No local tests, builds, formatters, validators, or application
launches were run.

The source checkpoint was committed and pushed as exact SHA
`15b8eef965fb3ab6e21394ffcb8fad68c8c3f038`. Rust 1.95 resolver run
`38171266213` passed on that SHA and uploaded artifact `11714340044`; the
archive digest, extracted 152,006-byte `Cargo.lock` digest, run URL, and job ID
are recorded in `evidence/r2.8.91-cargo-lock-resolution-15b8eef.json`. This was
metadata resolution only, not compilation or tests. Next: commit and push the
lockfile, then obtain all seven required R2.8.91 workflows on the exact locked
implementation SHA before acceptance.

R2.8.91 attempt 1 ran all seven required workflows on exact SHA
`15b8eef965fb3ab6e21394ffcb8fad68c8c3f038`. Quality, desktop build, plugin
renderer, and loaded-plugin workflows passed. Inventory rejected the new
resolver workflow, while Rust CI and all three vault round-trip jobs failed
because the lockfile had not yet been resolved. Run and job IDs and outcomes
are in `evidence/r2.8.91-attempt-1-15b8eef.json`. This attempt was not accepted.

Attempt 2 ran all seven workflows on exact lockfile-bearing SHA
`f975e48d8887c79e72623c85bac75a4cabecc723`. Quality, desktop build, plugin
renderer, loaded plugins, and the Obsidian 1.14.4 vault round-trip passed; the
round-trip passed on Linux, macOS, and Windows. Inventory still reported the
resolver workflow, and Rust CI reported formatter differences plus a missing
test-module import for `create_temporary_name`. Exact run and job IDs are in
`evidence/r2.8.91-attempt-2-f975e48.json`. This attempt was not accepted.

Attempt 3 ran all seven required workflows on exact SHA
`3460b71a20b42b4d9cc3a0a2b15796e31f200e19`. Six passed, including the
Obsidian 1.14.4 round-trip on Linux, macOS, and Windows. Rust CI found that
Unix directory sync used a cloned capability handle that returned `EBADF`,
Clippy rejected the cleanup function's eight arguments, Ubuntu reported three
rustfmt differences, and the Windows UI test could not rename its retained
open vault root. Exact workflow and job IDs, artifact digests, and findings
are recorded in
[`evidence/r2.8.91-attempt-3-3460b71.json`](evidence/r2.8.91-attempt-3-3460b71.json).
This attempt was not accepted.

The next correction reopens `.` relative to the held directory capability
before Unix `sync_all`, groups cleanup parameters into a context struct, and
makes the root-refresh test reflect Windows' retained-root behavior while
preserving the unavailable-root path on other platforms. The remaining
GitHub-reported formatter layouts are applied. No local tests, builds,
formatters, validators, or application launches were run.

R2.8.91 attempt 4 was accepted on exact source SHA
`336e745aac2238c037104ab6cfdb686b59b41d3e`. All seven required GitHub
Actions workflows passed, including the Rust matrix on Ubuntu, macOS, Windows,
and Rust 1.95 and the Obsidian 1.14.4 round-trip on Linux, macOS, and Windows.
Rust CI attempt 1 stalled in the Windows workspace-test step and was cancelled;
the same-SHA attempt 2 passed all four Rust jobs. Workflow/job IDs and artifact
archive digests are in
[`evidence/r2.8.91-attempt-4-336e745.json`](evidence/r2.8.91-attempt-4-336e745.json).
No local executable validation was run.

## 2026-10-11 — R2.8.92 pure Canvas text extraction implementation

Added `CanvasDocument::extract_text_node(&self, node_id: &str) -> Result<&str,
CanvasError>` in `crates/doc`. It follows the existing unique-ID and text-node
checks and returns a typed `TextContentUnavailable` error when a text node has
no string-valued text field. The borrowed result preserves empty, Unicode,
multiline, and trailing-newline content without mutating the Canvas.

Extended `fixtures/c06-text-card.json` with exact extraction cases and
fixture-driven tests for successful and rejected extractions. The cases cover
Unicode with mixed CRLF/LF line endings, a trailing newline, empty text,
missing and duplicate IDs, non-text nodes, and absent or non-string text. Each
case asserts the document remains unchanged. Updated the existing `crates/doc`
inventory entry and fixture SHA-256. Engine orchestration, vault writes, native
UI, explicit note creation, and C06/C06.1 acceptance remain pending.

The implementation was pushed on exact source SHA
`e5ee89a48f50e43026953e6361bb7312b58b16fa`. Attempt 1 passed inventory,
quality, desktop build, plugin renderer, and loaded-plugin workflows. Ubuntu
Rust CI failed only the formatting check at `crates/doc/src/canvas.rs:404`
after workspace tests passed; macOS and Windows Rust jobs passed. MSRV and the
three vault round-trip jobs were still running at evidence capture. Exact run
and job IDs and captured statuses are in
[`evidence/r2.8.92-attempt-1-e5ee89a.json`](evidence/r2.8.92-attempt-1-e5ee89a.json).
This attempt is not accepted. The exact formatting layout requested by GitHub
CI is applied in the working tree for a correction push. No local tests,
builds, formatters, validators, or application launches were run.

R2.8.92 attempt 2 was accepted on exact source SHA
`1a025db5ef713eb6e89c4f7654e97e125af9d992`. All seven required workflows
passed: inventory, quality, desktop build, plugin renderer, loaded plugins,
Rust CI on Ubuntu/macOS/Windows and Rust 1.95, and the pinned Obsidian 1.14.4
vault round-trip on Linux/macOS/Windows. Workflow/job IDs and artifact archive
digests are recorded in
[`evidence/r2.8.92-attempt-2-1a025db.json`](evidence/r2.8.92-attempt-2-1a025db.json).
No local executable validation was run. C06/C06.1 remain pending.

## 2026-10-11 — R2.8.93 revision-checked text-card note creation

Added an engine-only `VaultSession::create_canvas_note_from_text_node` operation.
It checks the caller's observed Canvas revision, parses and extracts one text
node, and creates a new Markdown note with the exact text-card bytes through
`VaultStore::create_new`. The Canvas is never modified. The method documents
that revision checking and note publication are not atomic across files and
that creation uses the validated snapshot. Non-Markdown destinations fail with
a typed error before reading the Canvas.

The fixture-driven engine coverage checks exact Unicode/mixed-line-ending text,
lowercase and uppercase Markdown extensions, unchanged Canvas and sibling
files, stale revisions, missing/duplicate/non-text/invalid text cards,
malformed Canvas data, existing destination conflicts, traversal using POSIX
and Windows separators, and missing parent directories. The fixture SHA is
recorded in `inventory.json`. Native UI confirmation, C06/C06.1 acceptance, and
the pinned Obsidian create-note round-trip remain pending. No local tests,
builds, formatters, validators, or application launches were run.

R2.8.93 source and fixture changes are included in the current checkpoint for
exact-SHA GitHub Actions validation. No local executable validation was run.

## 2026-10-12 — R2.8.93 attempt 1 and tracker reconciliation

Attempt 1 ran on exact source SHA
`392014b2481975adfc7e07a7c8aff3ad3648e3eb`. Six of seven required workflows
passed: inventory, quality, desktop build, plugin renderer, loaded plugins,
and the Obsidian 1.14.4 round-trip on Linux, macOS, and Windows. Rust CI passed
workspace tests on Ubuntu and all jobs on macOS, Windows, and Rust 1.95. Its
Ubuntu formatting check requested two layout-only changes in
`crates/engine/src/lib.rs`: reorder/wrap the public import list and collapse
the `canvas_storage_path` fallback expression to one line. Those exact CI
changes are applied in the correction checkpoint. Workflow/job IDs, artifact
IDs, archive digests, and failure details are recorded in
[`evidence/r2.8.93-attempt-1-392014b.json`](evidence/r2.8.93-attempt-1-392014b.json).
Attempt 1 is not accepted until the correction passes all required workflows
on its own exact SHA.

This checkpoint also reconciles `state.json`: R2.8.92 is marked complete on
accepted SHA `1a025db5ef713eb6e89c4f7654e97e125af9d992`, and R2.8.93 records its
first attempt and pending correction. The R2.8.94 draft is being prepared in
an isolated worktree: an engine-owned preview retains the Canvas revision,
then a separate explicit egui action creates a note from the reviewed text.
It does not include Canvas editing or the reference-app create-note scenario;
C06/C06.1 remain pending. No local tests, builds, formatters, validators, or
application launches were run.

## 2026-10-12 — R2.8.93 accepted; R2.8.94 drafts in review

R2.8.93 attempt 2 was accepted on exact source SHA
`325ce3ab806f3e41564f12a8d61ef7562ffa45e9`. All seven required GitHub Actions
workflows passed, including Rust CI on Ubuntu, macOS, Windows, and Rust 1.95,
and the pinned Obsidian 1.14.4 round-trip on Ubuntu, Windows, and macOS. Run
and job IDs plus artifact IDs and archive digests are recorded in
[`evidence/r2.8.93-attempt-2-325ce3a.json`](evidence/r2.8.93-attempt-2-325ce3a.json).
Attempt 1's Ubuntu formatting-only failure remains documented in its original
evidence file.

R2.8.94's engine preview and explicit egui create action are drafted in an
isolated worktree. Review found and fixed the vault-switch busy-state race and
two invalid non-ASCII Rust byte-string literals in its Harness coverage. The
separate pinned Obsidian create-note round-trip harness is also drafted and
awaiting adversarial review. It checks no writes before confirmation, exact
note bytes, unchanged Canvas bytes, and first-open/reopen visibility. Canvas
editing and C06/C06.1 acceptance remain pending.

No local tests, builds, formatters, or application launches were run. A
non-executable `git diff --check` was inadvertently run while inspecting the
isolated UI draft and returned clean; no further local validation is planned.


## 2026-10-12 — R2.8.94 attempt 1 CI failed; correction underway

Added the bounded Canvas text-card preview, an explicit review and confirmation
flow for create-only Markdown note creation, revision revalidation, and Markdown
listing refresh. The native UI now shows this bounded flow before the other vault
actions so its controls remain reachable in the preview window. The create API
also rejects non-`.canvas` source paths. Harness coverage checks no writes during
form entry, preview and review; exact note bytes; unchanged Canvas bytes; and
first-open/reopen visibility in pinned Obsidian 1.14.4. The UI and engine tests
cover exact text, final confirmation, stale revisions, destination conflicts,
and non-Canvas source paths.

Independent read-only reviews found and helped resolve a Windows path-separator
assertion and a lower-page UI reachability risk. R2.8.94 attempt 1 was pushed on
exact source SHA `74b8d11121a8d6b9f4fb0796f14eabf70b401aa2`. Five workflows
passed; Rust CI failed on Ubuntu, Windows, macOS, and MSRV with ten identical UI
Harness failures, and Ubuntu also reported Rust formatting differences. The
round-trip failed on all three platforms because the expanded Canvas form
obscured the existing note-source preview. All run IDs and the complete outcome
are in `state.json`.

The correction collapses Canvas note creation by default, shortens its scrollable
exact-text preview so confirmation remains reachable, explicitly expands the
section in Canvas UI and round-trip interactions, and applies formatting shown
by Ubuntu CI. No local tests, builds, formatters, validators, or application
launches were run. Canvas editing and C06/C06.1 acceptance remain pending.

## 2026-10-12 — R2.8.94 attempt 2 CI findings

Attempt 2 was pushed at exact source SHA
`088f23d67b17a4329007c910553009df07687c1e`. Desktop build, inventory, plugin
renderer, loaded-plugin, and quality workflows passed. Rust CI passed formatting
but failed on Ubuntu, macOS, Windows, and MSRV with the same four UI Harness
failures per target: three Canvas confirmation actions were clipped from the
accessible UI tree, and a rename test assumed its worker receiver would remain
present for at least one frame. The three-platform Obsidian round-trip failed
while reopening or previewing on every OS. Linux's Canvas child was writing to a
separate log than the picker helper read; Windows OCR confused `C06` with
`CO6`; macOS's OCR fallback did not load the expected updated preview. The
macOS window screenshot included padding and shadow that did not match the
queried window bounds used for click mapping. Run IDs and artifact digests are
recorded in `state.json`.

The next correction places confirmation controls before the scrollable exact
body, keeps rename completion and result assertions while removing transient
worker-handle assertions, passes the per-process Linux app log into the picker,
allows one OCR edit for the fixture vault name, and maps full-desktop macOS OCR
through Quartz display bounds. A targeted CI diagnostic records source-preview
geometry and event counts without including typed or pasted text. No local tests,
builds, formatters, validators, or application launches were run. The corrected
phase still requires all seven workflows to pass on one exact pushed SHA.

## 2026-10-12 — R2.8.94 attempt 3 CI findings and correction

Attempt 3 ran on exact source SHA
`95c67a57bdadb6c7b5a37b4fe8b024b02cf2cc29`. Inventory, quality, desktop build,
plugin renderer, and loaded-plugin workflows passed. Rust CI failed on Ubuntu,
macOS, Windows, and Rust 1.95 with 102 passed and four failed UI Harness tests
on each target. Three tests queried the Canvas confirmation button from a stale
frame after changing confirmation state. The combined existing-vault link and
rename test ended without a rename preview after clicking the preview action;
CI logs did not distinguish a missed click from a worker error, while source
layout and the populated transclusion report support a clipped-button diagnosis.
The Obsidian round-trip failed on all three operating systems: macOS clicked
above the refresh button, Windows UI Automation did not change the Canvas path
field, and Linux AT-SPI exposed no editable roles. Exact run/job IDs and the
three artifact digests are recorded in
[`evidence/r2.8.94-attempt-3-95c67a5.json`](evidence/r2.8.94-attempt-3-95c67a5.json).

The focused correction advances the egui Harness after each confirmation-state
transition, places rename controls before the long link/transclusion report,
uses the macOS OCR anchor center without the 17-point upward adjustment, adds a
bounded Windows keyboard fallback with exact UIA readback, and uses measured
800x600 Linux field centers with screenshot OCR readback after AT-SPI fails. The
Linux verifier requires exact normalized field values and permits the immediate
next OCR line only for the wrapped New Markdown path field observed in CI.
No local tests, builds, formatters, or application launches were run. An
accidental non-executable `git diff --check` ran on the intermediate working
tree and returned clean; the correction still requires the seven GitHub Actions
workflows on its exact pushed SHA. Canvas editing and C06/C06.1 remain pending.

## 2026-10-12 — R2.8.94 attempt 4 CI findings and correction

Attempt 4 ran on exact source SHA
`459ff4c5279e9b7531b210a68b09896a4d416221`. Inventory, quality, desktop
build, plugin renderer and loaded-plugin workflows passed. Rust CI failed on
Ubuntu, macOS, Windows and Rust 1.95: each target passed 102 tests and failed
the same four note-inspection selection tests because the UI retained
`README.md` after an attempted selection. The Obsidian 1.14.4 round-trip failed
on Linux, macOS and Windows. Its screenshots show the source marker, but
full-window OCR missed the body on macOS and Windows and read `note` as `nate`
on Linux. No vault data mismatch was reported. Exact workflow/job IDs and
artifact digests are recorded in
[`evidence/r2.8.94-attempt-4-459ff4c.json`](evidence/r2.8.94-attempt-4-459ff4c.json).

The next correction makes the Rename section collapsible so it no longer
pushes Link status controls outside the Harness viewport; all four rename UI
tests explicitly open the section before using its controls. The round-trip
helper now locates the source label from Tesseract TSV, crops that source pane,
and uses one-edit fuzzy marker matching while retaining separate stale-preview
and close checks. No local tests, builds, formatters, validators or application
launches were run. One accidental non-executable `git diff --check` in the
separate Canvas-edit draft returned clean. The correction still requires all
seven GitHub Actions workflows on its exact pushed SHA.

During review of this correction, a second non-executable `git diff --check`
was accidentally included in a source-inspection command and returned clean.
It executed no application or test code; all executable validation remains
reserved for GitHub Actions.

## 2026-10-12 — R2.8.94 attempt 5 CI findings and correction

Attempt 5 ran on exact source SHA
c8db437492c50af201be4144de5389585f7be63d. Inventory, desktop build, plugin
renderer, and loaded-plugin workflows passed. Quality failed on Ubuntu when
the Electron vault audit reached the completed-index message but did not reach
the local retrieval boundary. Rust CI failed on Ubuntu, macOS, Windows, and
Rust 1.95 with the same two empty-vault Harness failures: the tests queried the
rename-empty-state label before opening the collapsed Rename section. Exact
run/job IDs and artifact digests are in
[evidence/r2.8.94-attempt-5-c8db437.json](evidence/r2.8.94-attempt-5-c8db437.json).

The Obsidian round-trip failed on Windows and macOS because the prepared OCR
image erased the low-contrast source-editor text before cropping; the raw
screenshots show the marker, and no vault mismatch was reported. Linux passed
the source-preview check, then its Canvas text-card ID keyboard fallback clicked
the instruction banner at y=146 instead of the input row around y=160. The
correction crops the original window screenshot using scaled Tesseract bounds
and records the crop geometry, shifts all Linux Canvas input centers to the
visible input rows, and opens the Rename section in the two empty-vault tests.
The correction is prepared for a new focused commit and exact-SHA GitHub
Actions run. No local tests, builds, formatters, validators, or applications
were run.

## 2026-10-12 — R2.8.94 attempt 6 CI findings

Attempt 6 ran on exact source SHA
a06faf8ebdcc4979b549ae0ce924e2a2c40ec34c. Inventory, quality, desktop build,
plugin renderer, loaded plugin workflows, and Rust CI passed. The Obsidian
round-trip passed on Windows and failed on Ubuntu and macOS. On Linux the
focused Canvas path field visibly contained the expected value and clipboard
readback reached the first-attempt exact-match branch, but strict crop OCR
rejected its noisy recognition. On macOS the three form fields were visible,
but the guessed Preview click did not start preview. No vault mismatch was
reported. Run/job IDs and artifact digests are recorded in
[evidence/r2.8.94-attempt-6-a06faf8.json](evidence/r2.8.94-attempt-6-a06faf8.json).

The next focused correction uses exact clipboard equality as the Linux field
value check while keeping OCR and screenshots as diagnostics, reports egui's
Preview button bounds, clicks that button from the current response rectangle
on Linux and macOS, and requires preview-only UI text in the screenshot check.
Only GitHub Actions will run executable validation. The migration milestone
remains in progress until all seven required workflows pass on the exact
correction SHA.

## 2026-10-12 — R2.8.94 attempt 7 CI findings

Attempt 7 ran on exact source SHA
`6505a8b61076d88ac2d73efe746fdc6e48c9eb2f`. Inventory, quality, desktop
build, plugin renderer, loaded plugin workflows and Rust CI passed. The
Obsidian 1.14.4 round-trip passed on Windows and failed on Linux and macOS.
Linux reached the final Canvas confirmation screen, but OCR read “text” as
“bext” in the review phrase and the screenshot predicate timed out. macOS
reached the review screen, then accessibility and OCR could not locate the
Confirm and create note button. Neither failure wrote the note or changed the
Canvas vault. Exact run/job IDs and artifact digests are in
[`evidence/r2.8.94-attempt-7-6505a8b.json`](evidence/r2.8.94-attempt-7-6505a8b.json).

The attempt 8 correction uses current egui response bounds for Review and
Confirm clicks on Linux/macOS, and permits one OCR character error in the
final review phrase while retaining exact marker and destination checks. The
correction still requires all seven workflows on its exact pushed SHA. No
local tests, builds, formatters, validators or application launches were run.

## 2026-10-12 — R2.8.94 accepted; R2.8.95 started

R2.8.94 attempt 8 passed on exact source SHA e32331d50aeb1c7080dff20bf5ad4ea9c1be7642. All seven required
GitHub Actions workflows and all 20 jobs succeeded: inventory, quality, desktop
build, plugin renderer, loaded-plugin workflows, Rust CI, and the pinned Obsidian
1.14.4 vault round-trip. Rust CI passed on Ubuntu, macOS, Windows, and Rust 1.95;
the round-trip passed on Linux, Windows, and macOS. The workflow/job IDs and all
16 artifact IDs, sizes, and archive digests are recorded in
evidence/r2.8.94-attempt-8-e32331d.json. GitHub reported Node.js 20 deprecation annotations
and a temporary macOS runner capacity notice; neither caused a job failure.
No local tests, builds, formatters, validators, or application launches ran.

This accepted slice completes the engine-backed, explicit Canvas text-card to
Markdown-note creation flow. It still requires manual Canvas path and card ID
entry; Canvas editing and the broader C06/C06.1 acceptance remain pending.

R2.8.95 is now in progress from e32331d50aeb1c7080dff20bf5ad4ea9c1be7642. It adds a separate native editor
for one Canvas text card with revision-stamped load, draft, explicit Save,
Cancel/Reload, and stale-revision handling. The editor will use a bounded Canvas
read capped at 4 MiB and the engine will reject non-.canvas edit targets. Acceptance
will verify that only Save writes, only the selected card's text changes
semantically, unknown JSON fields and siblings remain intact, editing creates no
Markdown note, and pinned Obsidian displays the result after reopen on all three
operating systems. Executable validation remains GitHub Actions only.

## 2026-10-12 — R2.8.95 attempt 1 CI findings and correction

Attempt 1 ran on exact source SHA
`7c8dd7bcf8edfff6e668fbeb519767b63b8dc3d2` and is not accepted. Inventory,
quality, desktop build, plugin renderer, and loaded-plugin workflows passed.
Rust CI failed on Ubuntu, macOS, Windows, and Rust 1.95: four existing
`openobsidian-ui-egui` note-selector tests left `README.md` selected instead of
the requested path. Ubuntu also reported exact rustfmt changes in engine, UI,
and vault files. The Canvas editor header had been inserted before existing
panels; the correction moves it after the prior panels to preserve the
selector's position. Full CI results are recorded in
[`evidence/r2.8.95-attempt-1-7c8dd7b.json`](evidence/r2.8.95-attempt-1-7c8dd7b.json).

The pinned Obsidian round-trip failed before Canvas Save on Linux, Windows, and
macOS. The app showed the form and loaded draft, but CI OCR or accessibility
matching missed the hyphenated text-card field, garbled one field label, or
missed the disabled Save label. The vault source stayed byte-identical and no
Markdown note was created. The correction adds OCR label variants and checks
the visible “Canvas text loaded” status instead of the low-contrast Save label.
All run/job IDs and 12 artifact IDs, sizes, and digests are in the attempt
evidence. No local tests, builds, formatters, linters, validators, or
application launches were run.

One accidental local `git diff --check` during source inspection returned
clean. This whitespace check is recorded as a process deviation; executable
validation remains reserved for GitHub Actions. The focused correction is
prepared for attempt 2 and will be pushed to `origin/main` for its seven exact
SHA workflows after this CI result has been fully reconciled.

Attempt 2 correction commit `400fec03669e8eb97d05270d1166d0e9ff7026ed` was
pushed to `origin/main` and is not accepted. Inventory, desktop build, plugin
renderer and loaded-plugin workflows passed. Quality failed on Ubuntu after
an indexing progress event overwrote the final retrieval state. Rust CI failed
the stale-draft Reload receiver assertion on Ubuntu, macOS, Windows and Rust
1.95. Obsidian round-trip failed on Linux, Windows and macOS; evidence showed
clipped controls on two platforms and a disabled form during watcher refresh
on Linux. Exact run/job IDs and 12 artifact IDs, sizes and digests are in
[`evidence/r2.8.95-attempt-2-400fec0.json`](evidence/r2.8.95-attempt-2-400fec0.json).

Attempt 3 corrections have been integrated in parallel: native app-body
scrolling and editor auto-scroll, round-trip waits using the text-edit log,
and request-correlated Electron retrieval progress. Independent reviewers
found no actionable issues; the fixes are being committed as focused slices.
No local tests, builds,
formatters, linters, validators or application launches were run. The next
commit will be pushed to `origin/main` for fresh exact-SHA GitHub Actions
results after source review.

## 2026-10-12 — R2.8.95 attempt 3 CI findings

Attempt 3 ran on exact source SHA `a0053ac932b5aa55c18df7e30ccfdf5d45604583` and is not accepted. Quality, desktop build, plugin renderer, and loaded-plugin workflows passed across their required jobs. Inventory failed because five modified Electron files still carried baseline hashes. Rust CI passed the Rust 1.95 job and failed strict Clippy on Ubuntu, macOS, and Windows for five test-only `PathBuf` comparisons that should compare borrowed `Path` values. The pinned Obsidian round-trip failed on all three platforms: Linux OCR merged one field label; Windows `SendKeys` dropped the tail of a long input burst; macOS clicked the wrapped New Markdown field about 15 pixels too high after the form shifted on a vault-refresh status update, replacing the Canvas path and leaving the destination blank so Preview stayed disabled. Exact run/job IDs and 12 artifact IDs, sizes, and digests are recorded in [`evidence/r2.8.95-attempt-3-a0053ac.json`](evidence/r2.8.95-attempt-3-a0053ac.json).

The next focused correction updates the five stale hashes, replaces owned-path comparisons with borrowed paths, matches the Linux label through a same-line OCR token-span fallback, sends Windows text in chunks with exact prefix readback, and makes macOS recapture after refresh activity before probing the blank destination field. The macOS readback clears the clipboard first and requires visible OCR from the destination row in addition to the exact copied value. The vault and exact-content readback assertions remain required. No local tests, builds, formatters, linters, validators, or application launches were run.

## 2026-10-12 — R2.8.95 attempt 4 CI findings

Attempt 4 ran on exact source SHA `b14b10c7dd4678f03a4ecf1a10b571d3321693fb` and is not accepted. Inventory, desktop build, plugin renderer, loaded-plugin workflows, and Rust CI passed; Rust CI passed its 1.95 MSRV job and Ubuntu, macOS, and Windows. Quality failed on all three operating systems because Knip reported `pbcopy` from the round-trip audit as an unlisted binary; the parallel Fallow audit passed. The pinned Obsidian 1.14.4 round-trip passed on Linux. On macOS, the Canvas text edit and explicit Save passed, then the note-creation field had an exact clipboard readback and a screenshot showing `Notes/Canvas text card.md`, but Tesseract read the suffix as `mq` and stopped before Preview. On Windows, loading the Canvas draft made no vault changes, but exact readback caught a 42-character replacement that had only reached 28 characters of the expected 32-character prefix; Save was never activated. The exact-SHA run/job IDs, all 12 artifact IDs, sizes and archive digests are in [`evidence/r2.8.95-attempt-4-b14b10c.json`](evidence/r2.8.95-attempt-4-b14b10c.json).

The focused attempt 5 corrections add `pbcopy` to Knip's binary allow-list, verify Windows keyboard entry one character at a time before Save, and accept only the observed macOS `.md` OCR suffix misread while retaining exact clipboard readback. No local tests, builds, formatters, linters, validators, or application launches were run. The next push to `origin/main` will request all seven required workflows on the correction SHA.

## 2026-10-12 — R2.8.95 attempt 5 CI findings

Attempt 5 ran on exact source SHA `471082995724190ff75c98e541a93f631e04a265` and is not accepted. Inventory, quality, desktop build, plugin renderer, loaded-plugin workflows, and Rust CI all passed; Rust CI passed Ubuntu, macOS, Windows, and the Rust 1.95 MSRV job. The pinned Obsidian 1.14.4 round-trip passed on Linux and macOS, including Canvas text-card edit/save, note creation from the edited card, no-write checks during load/input, and reopen checks. Windows passed its earlier C01.2 source preview, note creation/edit/rename, attachment, refresh, and reopen checks, then failed while entering the Canvas draft. The 42-character field readback stalled at 22 characters when 23 were expected at character offset 22 after 55 polls. The 741-byte Canvas source remained at its original SHA-256, the destination note was absent, and explicit Save was never activated. Exact run/job IDs and all 16 artifact IDs, sizes, and archive digests are recorded in [`evidence/r2.8.95-attempt-5-4710829.json`](evidence/r2.8.95-attempt-5-4710829.json).

The attempt 6 correction replaces the Windows per-character fallback with an STA Unicode clipboard paste and exact ordinal UI Automation readback. Diagnostics retain clipboard verification, focus, selection/paste status, mismatch index, and bounded polling details. The correction is integrated locally as a focused commit, while attempt 5's exact-SHA evidence remains recorded separately. No local tests, builds, formatters, linters, validators, or application launches were run.

## 2026-10-12 — R2.8.95 attempt 6 accepted; R2.8.96 C07 foundation started

Attempt 6 passed on exact source SHA
`adc1ddce142f41dd250c37722ed8b48b9194bd5c`. All seven required GitHub Actions
workflows and all 20 jobs succeeded, including Rust 1.95 and the pinned Obsidian
1.14.4 round-trip on Linux, Windows, and macOS. Exact workflow/job IDs and all
16 artifact IDs, sizes, and archive digests are recorded in
[`evidence/r2.8.95-attempt-6-adc1ddc.json`](evidence/r2.8.95-attempt-6-adc1ddc.json).
The round-trip reports confirm exact draft readback, no write before explicit
Save, preservation of sibling Canvas data, no Markdown note created during edit,
and first-open/reopen visibility. Windows' STA Unicode clipboard fallback
passed. macOS normalized Canvas JSON on first close while retaining expected
semantics; the file remained stable after that normalization. No local executable
validation was run.

R2.8.96 is scoped to a bounded `crates/doc` Bases parser/evaluator foundation
covering native `.base` JSON/YAML, embedded definitions, source retention,
unknown fields, supported evaluation and explicit unsupported-result data. The
isolated branch adds fixture-driven cases for unsupported formula collisions,
empty/fully filtered inputs, and direct coverage of `fixtures/bases-native.yaml`.
This does not load or render Bases in the app. C07 and C07.1 remain pending until
engine/UI integration and visible compatibility issue reporting are implemented.
The focused code commits are under independent source review; no local tests,
builds, formatters, validators, or application launches were run.

## 2026-10-12 — R2.8.96 C07 source review and CI preparation

The bounded C07 document-layer implementation is integrated locally through
four focused commits after accepted SHA `adc1ddce`: the parser/evaluator, the
unsupported-formula collision/empty-row correction, typed comparison and file
extension correction, and fixture-driven coverage. Independent review caught
that the two new fixture files were missing from the exact source inventory;
records and SHA-256 digests have been added. Review also caught lexical numeric
ordering for decimal values, `file.ext` leaking dotted parent-folder text,
missing derived `file.ext` sort values, and repeated unsupported-formula issues
per row. Those behaviors now have focused coverage. `file.name` remains the
full filename including its extension, consistent with existing behavior and the
official Bases property table; `file.basename` (without extension) is a separate
property in the official docs.

The fixture set now covers decimal filters and sorting, dotted parent folders,
file-derived field values, and source retention. Rust CI will run the fixture
suite on Ubuntu, macOS, Windows, and Rust 1.95. The round-trip workflow is also
required on this exact slice as a regression gate; its existing Canvas flow does
not establish Bases UI acceptance. No local tests, builds, formatters, linters,
validators, or application launches were run. C07 and C07.1 remain pending
because no engine/UI callsite loads or renders Bases and unsupported-expression
issues are not yet visible in the app.

The next action recorded here was completed; attempt 1 and the reconciled
follow-up are recorded below.

## 2026-10-12 — R2.8.96 attempt 1 and parallel correction review

Attempt 1 ran on exact pushed SHA
`1a0854d837f9d67432d6bafb35fb1405f8036c7d`. The Rust migration inventory,
quality, desktop build, plugin renderer, loaded-plugin workflows, and Obsidian
1.14.4 round-trip passed. Rust CI failed: Rust 1.95 and workspace tests passed;
Ubuntu reported rustfmt differences in `crates/doc/src/bases.rs` and its public
re-export, while Windows and macOS Clippy reported a collapsible conditional and
an unnecessary `field_value` lifetime. Exact run/job IDs and round-trip artifact
digests are recorded in
[`evidence/r2.8.96-attempt-1-1a0854d.json`](evidence/r2.8.96-attempt-1-1a0854d.json).

Parallel source review also found precision loss for mixed integer/f64 numeric
comparisons, unsupported formula collision fallback during sorting and
grouping, inconsistent missing/null ordering, nested-fence recognition,
integer-valued floating limits, path tie-break differences, and first-seen group
order differences. Fixtures now cover these cases, including UTF-8 source-span
offsets. The Rust engine fixes and fixture-harness integration are committed in
`053d85c`, with fixtures and inventory updates in `0884a12`. Exact numeric
ordering above 2^53 is a deliberate precision improvement over JavaScript
Number rounding. Text ordering remains deterministic and case-insensitive, with
a known difference from ambient `localeCompare` for accents and some non-ASCII
strings; decision RM-12 records this boundary. The attempt is not accepted; C07
and C07.1 remain pending. The commits are prepared locally and await an exact
remote-base check and push for a new seven-workflow CI attempt. No local tests,
builds, formatters, linters, validators, or application launches were run.

## 2026-10-12 — R2.8.96 attempt 2 CI findings

Attempt 2 ran on exact pushed SHA
`e74126380bae4e20c8b292c7994d9610a5852831` and is not accepted. Six of seven
required workflows passed: Rust migration inventory, quality, desktop build,
plugin renderer, loaded-plugin workflows, and the pinned Obsidian 1.14.4
round-trip. Rust CI failed only its Ubuntu formatting step. Workspace tests
passed on Ubuntu, Windows, macOS, and Rust 1.95; macOS and Windows Rust jobs
passed. Ubuntu rustfmt reported nine hunks in `crates/doc/src/bases.rs` at lines
816, 1082, 2172, 2182, 2214, 2234, 2241, 2268, and 2286. Exact run/job IDs and
all published artifact IDs, sizes, and archive digests are in
[`evidence/r2.8.96-attempt-2-e741263.json`](evidence/r2.8.96-attempt-2-e741263.json).

The three round-trip jobs passed on Linux, macOS, and Windows. Each report
records the exact source SHA, unchanged non-workspace paths after reopen,
preserved Canvas semantics and created-note bytes, and stable second-shutdown
Canvas bytes. This is a regression gate; it does not establish Bases UI
acceptance. C07 and C07.1 remain pending.

Compatibility review records `groupBy.direction` as an explicit bounded C07
limit/open decision because the legacy parser extracts the group property and
does not apply a direction. Unknown bare identifiers remain context-dependent
property references; no unsupported-expression requirement is inferred without
rows or a linked fixture. The empty/fully filtered `date(today)` issue behavior
is a deliberate strengthening required by its linked fixture.

The nine formatter changes are committed locally as `70a98e6` and await a fresh
exact-SHA CI attempt. No local tests, builds, formatters, linters, validators,
or application launches were run.

## 2026-10-12 — R2.8.96 attempt 3 accepted; same-SHA round-trip retry

Attempt 3 ran on exact pushed source SHA
01d7ad437f28667e6e79455b2450c73e7b6d3916 and is accepted for the bounded
C07 document-layer parser/evaluator foundation. All seven required GitHub Actions
workflows and all 20 jobs in the final workflow attempts passed. Rust CI passed on
Rust 1.95, Ubuntu, Windows, and macOS. The inventory, quality, desktop build,
plugin renderer, and loaded-plugin workflows also passed on this exact SHA.

The first attempt of Obsidian round-trip run 38209751630 passed on Linux and
Windows but failed on macOS job 114681047214, step 16. The artifact shows that
a watcher refresh disabled and moved the Canvas Load button after the CI
automation positioned its click, so the populated C06 Reference.canvas /
text-1 form remained unloaded. This is recorded as a likely transient UI
automation timing race. Only the failed macOS job was rerun on the same source
SHA; run attempt 2 passed on Linux, Windows, and macOS, including the Canvas
text edit/save, no-write-before-save, selected-card-only change, no-note-during-
edit, and reopen checks. The initial failed macOS artifact remains in the
evidence alongside the successful retry artifact.

Exact workflow/job conclusions and all 17 artifact IDs, sizes, and archive
digests—including both macOS round-trip attempts—are recorded in
[evidence/r2.8.96-attempt-3-01d7ad4.json](evidence/r2.8.96-attempt-3-01d7ad4.json).
This acceptance covers the scoped document-layer foundation only; Bases loading,
rendering, and visible unsupported-expression reporting remain pending under
C07/C07.1. The bounded compatibility notes remain: groupBy.direction is not
applied by legacy behavior; an unknown bare identifier remains a context-
dependent property reference absent a row or linked fixture; and the empty or
fully filtered date(today) issue behavior is a deliberate strengthening
required by its fixture.

No local project tests, builds, formatters, linters, validators, or application
launches were run. All executable validation evidence came from GitHub Actions.

## 2026-10-12 — R2.8.97 attempt 1 CI findings

Attempt 1 ran on exact source SHA
`fb7dff956188738938508f92af2a8764a03eeb98` and is not accepted. Six of the
seven required workflows passed; Rust CI run `38212918823` failed. Its Rust
1.95 job `114690929100` passed, and the workspace test steps passed on Ubuntu,
macOS, and Windows. Ubuntu job `114690929420` failed only `Check formatting`
on three rustfmt differences in `crates/engine/src/bases.rs`: the
`list_base_files` signature, the unclosed-frontmatter error return, and the
base-listing test assertion. macOS job `114690929345` and Windows job
`114690929668` failed `Run Clippy` on `clippy::cmp_owned` at line 506, where a
`PathBuf` was constructed for a path comparison.

The pinned Obsidian 1.14.4 round-trip passed on Linux, Windows, and macOS in run
`38212918747` (jobs `114690929731`, `114690929982`, and `114690930083`). The
inventory (`38212918651`), quality (`38212918704`), desktop build
(`38212918778`), plugin renderer (`38212918739`), and loaded-plugin
(`38212918843`) workflows also passed. Exact workflow/job conclusions and all
12 artifact IDs, sizes, and archive SHA-256 digests are recorded in
[`evidence/r2.8.97-attempt-1-fb7dff9.json`](evidence/r2.8.97-attempt-1-fb7dff9.json).
GitHub Actions logs included non-blocking Node.js deprecation warnings.

The correction applies the CI formatting and borrowed-path comparison fixes
and adds index-based view selection so unnamed, explicitly empty-name, and
duplicate-name views can be selected exactly while preserving the existing
name-based behavior. This follow-up is not validated by attempt 1 and needs a
fresh exact-SHA Actions run. C07/C07.1 remain pending. No local project tests,
builds, formatters, linters, validators, or application launches were run.

## 2026-10-12 — R2.8.97 attempt 2 launched

The focused correction was pushed as commit `1db4cd36bc7f7ae371eeeacd1a428533d223985c`.
Attempt 1 remains not accepted; attempt 2 is pending on this exact source SHA.
The correction includes the CI-requested formatting and Clippy fixes and the
index-based view selector for unnamed, explicitly empty-name, and duplicate
view names. The existing name-based selection remains supported.

The seven required GitHub Actions runs are inventory `38214429821`, quality
`38214428573`, desktop build `38214428457`, plugin renderer `38214428556`,
loaded-plugin workflows `38214428529`, Rust CI `38214428477`, and Obsidian
vault round-trip `38214428519`. All report the exact correction SHA. Inventory
completed successfully; quality was queued and the other five runs were in
progress when captured. Exact run URLs and statuses are in
[`evidence/r2.8.97-attempt-2-1db4cd3.json`](evidence/r2.8.97-attempt-2-1db4cd3.json).
Job conclusions and artifact IDs, sizes, and digests will be recorded after
completion. No local project validation was run, and C07/C07.1 remain pending.

## 2026-10-12 — R2.8.97 attempt 2 accepted

Attempt 2 passed on exact source SHA
`1db4cd36bc7f7ae371eeeacd1a428533d223985c`. All seven required GitHub Actions
workflows and all 20 jobs passed: inventory run `38214429821`, quality
`38214428573`, desktop build `38214428457`, plugin renderer `38214428556`,
loaded-plugin workflows `38214428529`, Rust CI `38214428477`, and Obsidian
vault round-trip `38214428519`. Rust CI passed on Rust 1.95, Ubuntu, Windows,
and macOS; the pinned Obsidian 1.14.4 round-trip passed on Linux, Windows, and
macOS. Exact job IDs/conclusions and all 16 artifact IDs, sizes, and archive
SHA-256 digests are recorded in
[`evidence/r2.8.97-attempt-2-1db4cd3.json`](evidence/r2.8.97-attempt-2-1db4cd3.json).

This accepts the bounded engine Bases evaluation/discovery service and exact
view-index selection for unnamed, explicitly empty-name, and duplicate-name
views. C07/C07.1 remain pending until UI Bases loading/rendering and visible
unsupported-expression reporting are integrated and validated. No local
project tests, builds, formatters, linters, validators, or application launches
were run; executable validation came from GitHub Actions.

## 2026-10-12 — R2.8.98 UI implementation ready for CI

The bounded, read-only Bases egui panel implementation is complete locally. It
uses exact path and view-index selection, asynchronous snapshot-bound
evaluation, visible compatibility and collection issues, operation gating,
cache invalidation, and bounded UTF-8-safe display output. Bounded display/text
tests are included. An initial source review found no behavioral must-fix.
Follow-up acceptance review identified missing selector interaction and
compatibility path assertions; those are now covered, and the latest source
review found no remaining acceptance gap or compile-level concern.

No local validation was run. C07/C07.1 remain pending.

## 2026-10-12 — R2.8.98 attempt 1 launched

The focused UI slice was pushed to `origin/main` as exact source SHA
`50a78e85cb4eff9a482fd3150335ef9d66a01503`. All seven required GitHub Actions
workflows were triggered on that SHA. Inventory run `38216580855` passed;
quality run `38216580909` was queued; desktop build `38216580854`, plugin
renderer `38216580860`, loaded-plugin workflows `38216580968`, Rust CI
`38216580946`, and Obsidian vault round-trip `38216580835` were in progress at
capture. Run URLs and current status are in
[`evidence/r2.8.98-attempt-1-50a78e8.json`](evidence/r2.8.98-attempt-1-50a78e8.json).
No local project validation was run. C07/C07.1 remain pending.

## 2026-10-12 — R2.8.98 attempt 1 completed, not accepted

Attempt 1 completed on exact source SHA
`50a78e85cb4eff9a482fd3150335ef9d66a01503`. Inventory, quality, desktop
build, plugin renderer, and loaded-plugin workflows passed. Rust CI failed on
Rust 1.95, Ubuntu, Windows, and macOS; Ubuntu also failed formatting. The UI
panel test exposed ambiguous path labels and platform-specific separators, the
selector interaction failed to choose the second `.base` path, and many existing
vault UI interactions were blocked while an automatically started Bases
snapshot held the shared busy gate. The Obsidian round-trip passed on macOS;
Windows timed out while waiting for the note-list refresh control after watcher
refresh, with `bases_receiver=true`; Linux failed while polling an empty X11
window inventory because `xdotool search --onlyvisible --name .` returned exit
1. The 20 job conclusions and 12 artifact IDs, sizes, and archive SHA-256
digests are recorded in
[`evidence/r2.8.98-attempt-1-50a78e8.json`](evidence/r2.8.98-attempt-1-50a78e8.json).

The correction makes a Bases snapshot user-initiated, adjusts UI assertions for
multiple labels and native path display, and treats xdotool's no-window exit as
an empty poll result while preserving other errors. A separate embedded Bases
document test slice remains uncommitted and is excluded from this correction.
No local tests, builds, formatters, linters, validators, or application launches
were run. C07/C07.1 remain pending until all required workflows pass on a
corrected implementation SHA.

## 2026-10-12 — R2.8.98 attempt 2 launched

The focused correction was committed and pushed as exact source SHA
bef8a72e45f195b2e32d34f378f2abde3cccf55c. Seven required workflows are queued:
quality 38218066464, desktop build 38218066535, Obsidian round-trip
38218066617, plugin renderer 38218066561, Rust CI 38218066643, loaded-plugin
workflows 38218066681, and inventory 38218066902. Exact run URLs and initial
statuses are in evidence/r2.8.98-attempt-2-bef8a72.json. No local validation was
run. Do not push until every exact-SHA workflow completes. The separate
embedded Bases document test slice remains uncommitted. C07/C07.1 remain pending.

## 2026-10-12 — R2.8.98 attempt 2 completed, not accepted

Attempt 2 completed on exact source SHA
`bef8a72e45f195b2e32d34f378f2abde3cccf55c`. Six of seven required workflows
passed: inventory `38218066902`, quality `38218066464`, desktop build
`38218066535`, plugin renderer `38218066561`, loaded-plugin workflows
`38218066681`, and Obsidian vault round-trip `38218066617`. Rust CI
`38218066643` failed on MSRV 1.95, Ubuntu, Windows, and macOS; each job reported
111 passed and 4 failed. The failures were two Bases UI assertion/selector
issues and two uninstall checkbox interactions outside the full-page harness
viewport. The cross-platform round-trip passed on Linux, Windows, and macOS.
Exact job results and all 12 artifact IDs, sizes, and digests are recorded in
[`evidence/r2.8.98-attempt-2-bef8a72.json`](evidence/r2.8.98-attempt-2-bef8a72.json).

The correction in this worktree scopes those tests to the relevant panels,
uses native path components and the rendered snapshot label, and verifies each
selection immediately. The separate embedded Bases document test and fixture
remain uncommitted. C07/C07.1 remain pending. No local tests, builds,
formatters, linters, validators, or application launches were run.

## 2026-10-12 — R2.8.98 attempt 3 launched

The focused correction was committed and pushed to `origin/main` as exact source
SHA `8bbcaaffbf4247786e87b3065549fe67881a6e1c`. Inventory run `38220445135`,
quality `38220445083`, desktop build `38220445147`, plugin renderer
`38220445098`, loaded-plugin workflows `38220445101`, Rust CI `38220445070`,
and Obsidian vault round-trip `38220445088` were triggered on that SHA.
Inventory, quality, plugin renderer, and loaded-plugin workflows have passed;
desktop build, Rust CI, and round-trip were still active at capture. Exact job
IDs, statuses, URLs, and available artifact metadata are in
[`evidence/r2.8.98-attempt-3-8bbcaaf.json`](evidence/r2.8.98-attempt-3-8bbcaaf.json).
No local validation was run. Do not push until all seven workflows resolve.
The separate embedded Bases test and fixture remain uncommitted; C07/C07.1
remain pending.


## 2026-10-12 — R2.8.98 attempt 3 completed, not accepted

Attempt 3 completed on exact source SHA `8bbcaaffbf4247786e87b3065549fe67881a6e1c`. Six of seven required workflows passed: inventory `38220445135`, quality `38220445083`, desktop build `38220445147`, plugin renderer `38220445098`, loaded-plugin workflows `38220445101`, and Obsidian 1.14.4 vault round-trip `38220445088`. Rust CI `38220445070` failed on Rust 1.95 job `114715131262`, macOS `114715131355`, Ubuntu `114715131544`, and Windows `114715131666`. Each job reported 114 passed and 1 failed in `tests::egui_bases_selectors_use_exact_paths_and_source_view_indices`: the fixture placed JSON `formulas` at the document root, so the selected view did not produce the expected unsupported-formula issue label. The parser reads JSON formulas from each view; the attempt 4 correction places the formula inside `views[0]`. Ubuntu also reported four rustfmt-only layout differences, now corrected in the focused UI source diff.

All exact job conclusions and all 12 artifact IDs, sizes, SHA-256 digests, and expiration times are in [`evidence/r2.8.98-attempt-3-8bbcaaf.json`](evidence/r2.8.98-attempt-3-8bbcaaf.json). No local tests, builds, formatters, linters, validators, or application launches were run. The attempt 4 correction is prepared for an exact-SHA GitHub Actions run. The separate R2.8.99 source change `crates/doc/src/bases.rs` and fixture `fixtures/c07-embedded-base-evaluation.json` remain uncommitted and excluded. C07/C07.1 remain pending.


## 2026-10-12 — R2.8.98 attempt 4 launched

The focused correction was committed and pushed to `origin/main` as exact source SHA `1d096a859c9d95cb0d6c047cd3cb25c858b35310`. It moves the JSON unsupported formula into the selected first view and applies the four formatting changes requested by attempt 3 Ubuntu CI. Inventory run `38222005000` passed. Quality `38222004908`, desktop build `38222004927`, loaded-plugin workflows `38222004985`, plugin renderer `38222005087`, Rust CI `38222005080`, and Obsidian vault round-trip `38222005010` were queued or running at initial capture. Exact job IDs, URLs, and captured statuses are in [`evidence/r2.8.98-attempt-4-1d096a8.json`](evidence/r2.8.98-attempt-4-1d096a8.json).

No local project tests, builds, formatters, linters, validators, or application launches were run. The separate R2.8.99 source change `crates/doc/src/bases.rs` and fixture `fixtures/c07-embedded-base-evaluation.json` remain uncommitted and excluded. C07/C07.1 remain pending. Wait for all seven exact-SHA workflows before the next push.


## 2026-10-12 — R2.8.98 attempt 4 completed, not accepted

Attempt 4 completed on exact source SHA `1d096a859c9d95cb0d6c047cd3cb25c858b35310`. Six of seven workflows passed: inventory `38222005000`, quality `38222004908`, desktop build `38222004927`, loaded-plugin workflows `38222004985`, plugin renderer `38222005087`, and Obsidian vault round-trip `38222005010`; the round-trip passed on macOS job `114720251122`, Windows `114720251260`, and Linux `114720251476`. Rust CI `38222005080` failed overall: MSRV job `114720251071` passed, while Ubuntu `114720251225`, macOS `114720251457`, and Windows `114720251330` failed `Run Clippy`. Their workspace tests passed, including 115 UI tests; Ubuntu formatting passed. Clippy reported `large_enum_variant` for `BasesTaskMessage` at `crates/ui-egui/src/lib.rs:81` and `let_and_return` in `bases_view_label` at line 4093. Both were promoted by `-D warnings`.

The local focused correction boxes only the `BaseFileEvaluation` payload in the asynchronous message and returns the `bases_view_label` match directly. A read-only source review found its ownership handling sound. This change is pending exact-SHA CI. Exact run/job conclusions and all 12 artifact IDs, sizes, SHA-256 digests, and expiration times are recorded in [`evidence/r2.8.98-attempt-4-1d096a8.json`](evidence/r2.8.98-attempt-4-1d096a8.json). No local tests, builds, formatters, linters, validators, or application launches were run. The separate R2.8.99 `crates/doc/src/bases.rs` change and `fixtures/c07-embedded-base-evaluation.json` remain uncommitted and excluded. C07/C07.1 remain pending.


## 2026-10-12 — R2.8.98 attempt 5 launched

The focused correction was committed and pushed to `origin/main` as exact source SHA `e2b8983b243014440dcf34508fd84f3ece66653c`. It boxes the `BaseFileEvaluation` asynchronous message payload and returns the `bases_view_label` match directly to address attempt 4 Clippy findings. Inventory run `38223392916` passed. Quality `38223392892`, desktop build `38223392852`, loaded-plugin workflows `38223392859`, plugin renderer `38223392943`, Rust CI `38223392862`, and Obsidian vault round-trip `38223393959` were queued or running at initial capture. Exact job IDs, URLs, and captured statuses are in [`evidence/r2.8.98-attempt-5-e2b8983.json`](evidence/r2.8.98-attempt-5-e2b8983.json).

No local project tests, builds, formatters, linters, validators, or application launches were run. The separate R2.8.99 `crates/doc/src/bases.rs` work and `fixtures/c07-embedded-base-evaluation.json` remain uncommitted and excluded. C07/C07.1 remain pending. Wait for all seven exact-SHA workflows before the next push.


## 2026-10-12 — R2.8.98 attempt 5 completed and accepted

Attempt 5 passed on exact source SHA
e2b8983b243014440dcf34508fd84f3ece66653c. All seven required workflows and
all 20 jobs passed: inventory 38223392916, quality 38223392892, desktop
build 38223392852, loaded-plugin workflows 38223392859, plugin renderer
38223392943, Rust CI 38223392862, and Obsidian 1.14.4 vault round-trip
38223393959. Rust CI passed on the minimum supported Rust 1.95 toolchain and
Ubuntu, Windows, and macOS. The round-trip passed on macOS job 114724878775,
Linux 114724879016, and Windows 114724879093.

All exact-SHA job conclusions and all 16 artifact IDs, sizes, and archive
SHA-256 digests are recorded in
[evidence/r2.8.98-attempt-5-e2b8983.json](evidence/r2.8.98-attempt-5-e2b8983.json).
No local tests, builds, formatters, linters, validators, or application
launches were run. The latest accepted R2 implementation SHA is now
e2b8983b243014440dcf34508fd84f3ece66653c.

C07.1 embedded Bases work is in progress as a separate slice: bounded engine
listing/evaluation and additive egui integration with visible issues and no
vault writes. The source and fixture remain outside this accepted SHA pending
review and GitHub CI. C07/C07.1 remain pending.


## R2.8.99 / C07.1 — embedded Bases integration in progress

Started from accepted SHA e2b8983b243014440dcf34508fd84f3ece66653c. The slice
adds a fixture for source-preserving embedded NativeYaml definitions, bounded
snapshot- and revision-checked engine listing/evaluation, and an additive
egui panel for note, definition, and view selection with visible compatibility
and collection issues. The UI fixture covers multiple definitions/views,
supported file.path output, unsupported formula diagnostics, exact source bytes,
and unchanged vault/app-data snapshots.

Read-only review found a stale error message on definition changes and a
per-frame clone of the full Markdown path list. The UI now clears the previous
error before switching definitions and keeps selector materialization bounded
to the visible option set. No local tests, builds, formatters, linters,
validators, or application launches were run. The integrated slice remains
uncommitted and requires exact-SHA GitHub Actions CI before acceptance.


A read-only engine audit found no path-confinement, stale-listing, or snapshot
race bypass. The engine bounds source reads at 512 KiB per note, the aggregate
collection at 16 MiB, and note rows at 10,000. The existing whole-vault snapshot
and Markdown listing still traverse the full vault, so their I/O and temporary
path-list memory scale with vault size; they execute on the background worker.
This known scaling limit is recorded for follow-up rather than described as a
bounded whole-vault scan.


## 2026-10-12 — R2.8.99 attempt 1 launched

The C07.1 embedded Bases integration was committed as 21b275c74fdb61402d30205182cb66c1c8d4e9a4 and pushed to origin/main. Inventory run 38225556448 passed. Quality 38225556462, desktop build 38225556449, loaded-plugin workflows 38225556379, plugin renderer 38225556360, Rust CI 38225556463, and Obsidian vault round-trip 38225556423 were active or queued at initial capture. Exact job IDs/statuses, two available Linux artifacts, and capture metadata are in [evidence/r2.8.99-attempt-1-21b275c.json](evidence/r2.8.99-attempt-1-21b275c.json).

No local project validation was run. Wait for all seven exact-SHA workflows, reconcile terminal results and artifacts, and do not push meanwhile.


## 2026-10-12 — R2.8.99 attempt 1 completed, not accepted

Attempt 1 completed on exact source SHA `21b275c74fdb61402d30205182cb66c1c8d4e9a4`. Five of seven required workflows passed: inventory `38225556448`, quality `38225556462`, desktop build `38225556449`, plugin renderer `38225556360`, and loaded-plugin workflows `38225556379`. Rust CI `38225556463` failed on MSRV job `114732063429` and Ubuntu, Windows, and macOS jobs `114732063616`, `114732063617`, and `114732063737`. The new embedded Bases UI test observed view index 0 instead of 1 on MSRV, Ubuntu, and macOS; Windows could not find the slash-separated `Notes/Dashboard.md` accessibility label. Ubuntu also reported rustfmt differences in touched Rust sources.

Obsidian round-trip `38225556423` passed on Windows job `114732063245` and macOS job `114732063585`; Ubuntu job `114732063477` failed because OCR read “found” as “Faund” in the refreshed note-list status. The Linux artifact confirms the refresh showed three Markdown files and no app-data mutation. All 12 exact-SHA artifact IDs, sizes, archive SHA-256 digests, and expiration times are recorded in [`evidence/r2.8.99-attempt-1-21b275c.json`](evidence/r2.8.99-attempt-1-21b275c.json).

The focused correction now waits for the selected definition/view evaluation, uses native `PathBuf` components for the Windows fixture, applies the rustfmt changes indicated by CI, and tolerates the observed OCR spelling error while checking the exact Markdown count on one line. It is ready for a fresh exact-SHA run. No local tests, builds, formatters, linters, validators, or application launches were run. Commit and push the correction to `origin/main`, then wait for all seven workflows to become terminal.


## 2026-10-12 — R2.8.99 attempt 2 launched

The focused correction was committed and pushed to `origin/main` as exact source SHA `18c13710a5973ef6628585c391a4d033ca9fb8fe`. Inventory run `38227415282` passed. Quality `38227415226`, desktop build `38227415248`, plugin renderer `38227415217`, loaded-plugin workflows `38227415258`, Rust CI `38227415283`, and Obsidian vault round-trip `38227415279` were queued or running at initial capture. Exact job IDs/statuses and three available Linux artifacts are recorded in [`evidence/r2.8.99-attempt-2-18c1371.json`](evidence/r2.8.99-attempt-2-18c1371.json).

No local project validation was run. Wait for all seven exact-SHA workflows, reconcile terminal results and artifacts, and do not push meanwhile.


## 2026-10-12 — R2.8.99 attempt 2 completed, not accepted

Attempt 2 completed on exact source SHA
18c13710a5973ef6628585c391a4d033ca9fb8fe. Five of seven required workflows
passed: inventory 38227415282, quality 38227415226, desktop build 38227415248,
plugin renderer 38227415217, and loaded-plugin workflows 38227415258.

Rust CI 38227415283 failed on Ubuntu job 114738223114, Windows
114738223406, macOS 114738223420, and minimum Rust 1.95 job 114738223485.
Ubuntu, macOS, and MSRV timed out waiting for the selected embedded view
evaluation after the alternate-view interaction. Windows could not find the
expected backslash-separated issue label; the UI renders that label with
forward slashes. Ubuntu also reported one rustfmt layout difference. Clippy
was skipped after workspace-test failures.

Vault round-trip 38227415279 passed on macOS 114738223784 and Windows
114738223847. Linux 114738223468 failed an OCR-only count check. The
screenshot visibly shows three Markdown files while OCR read “Faund”; the
report records a count of three after rename and a visible refresh status.
All exact job outcomes and 12 artifact IDs, sizes, SHA-256 digests, and
expiration times are recorded in
evidence/r2.8.99-attempt-2-18c1371.json.

The next correction scopes the UI interaction test directly to the embedded
Bases panel, normalizes the issue-label path to forward slashes, applies the
rustfmt change from CI, and uses the existing count-aware OCR matcher for both
startup and restored-vault checks. All attempt-2 jobs are terminal, so the
next correction push is permitted. No local tests, builds, formatters,
linters, validators, or application launches were run.


## 2026-10-12 — R2.8.99 attempt 3 launched

The focused embedded Bases and OCR corrections were pushed to origin/main as
exact source SHA b0ea75d06f3e2565b8c5dad706708561ec5190b4. Inventory run 38229475013 passed. Quality
38229474997, desktop build 38229475032, plugin renderer 38229474913,
loaded-plugin workflows 38229475025, Rust CI 38229475014, and Obsidian vault
round-trip 38229475012 were queued or running at initial capture. Exact job
IDs, URLs, statuses, and the three available Linux artifacts are recorded in
evidence/r2.8.99-attempt-3-b0ea75d.json.

No local project validation was run. Wait for every exact-SHA workflow and job
to become terminal, reconcile all results and artifacts, and do not push
another SHA meanwhile.


## 2026-10-12 — R2.8.99 attempt 3 completed and accepted

Attempt 3 passed on exact source SHA b0ea75d06f3e2565b8c5dad706708561ec5190b4. All seven required workflows and
all 20 jobs succeeded: inventory 38229475013, quality 38229474997, desktop
build 38229475032, plugin renderer 38229474913, loaded-plugin workflows
38229475025, Rust CI 38229475014, and Obsidian 1.14.4 vault round-trip
38229475012.

Rust CI passed on Rust 1.95 job 114745105663 and Ubuntu 114745105970,
Windows 114745106077, and macOS 114745106107. The embedded Bases UI
interaction test passed across all four jobs. The round-trip passed on
Windows 114745105791, Linux 114745106002, and macOS 114745106004.
Sixteen exact-SHA artifacts were published. Their IDs, sizes, archive
SHA-256 digests, and expiration times are recorded in
evidence/r2.8.99-attempt-3-b0ea75d.json.

No local tests, builds, formatters, linters, validators, or application
launches were run. R2.8.99/C07.1 is accepted. Next, reconcile C06/C06.1
and C07/C07.1 requirement evidence against the accepted implementation
milestones, keep unresolved sorting and grouping bounds explicit, and then
start the fixture-first C08 attachment preservation slice.


## 2026-10-12 — C06/C07 crosswalk and R2.8.100 C08 slice prepared

The accepted R2.8.95 attempt 6 evidence supports C06.1's explicit text-card
save and separate explicit note-creation behavior on all three platforms, so
C06.1 is marked passing with tested source SHA
`adc1ddce142f41dd250c37722ed8b48b9194bd5c`. The accepted R2.8.99 attempt 3
evidence supports C07.1's visible unsupported-formula issue, retained source,
and absence of a fabricated formula value; C07.1 is marked passing with tested
source SHA
`b0ea75d06f3e2565b8c5dad706708561ec5190b4`.

C06 remains pending: full file, web/link, group, and edge editing is not
implemented, and the rich unknown-field fixture has not been reopened in the
reference Obsidian workflow. C07 remains pending: the evaluator does not claim
legacy locale sorting for non-ASCII text, `groupBy.direction`, or JavaScript
numeric rounding above 2^53. Those bounds remain explicit.

R2.8.100 adds the declared `fixture:c08-attachments` fixture and a shared
testkit acceptance for exact relative embed references to a Markdown note,
SVG, PDF, audio, video, and opaque binary. The read-only sequence checks exact
source and attachment bytes, references, whole-vault snapshots, no generated
derivative files, and equivalent results after reopening. The fixture is
listed in the source inventory. C08 remains pending until exact-SHA GitHub
Actions passes. No local tests, builds, formatters, linters, validators, or
application launches were run. Commit and push the slice, then wait for all
seven required workflows before another push.


## 2026-10-12 — R2.8.100 attempt 1 CI underway

The C08 fixture-preservation commit is pushed to `origin/main` on exact source
SHA `0ac90e2dcbda516271c041853236215d6f08a605`. Inventory run 38232144530,
quality 38232144652, desktop build 38232144509, plugin renderer 38232144708,
loaded-plugin workflows 38232144613, and Obsidian vault round-trip 38232144803
passed. Rust CI run 38232144781 is still active: MSRV job 114753944300 and
macOS job 114753944503 passed; Ubuntu job 114753944524 failed `cargo fmt
--all -- --check`; Windows job 114753944687 remains in workspace tests. The
run is not accepted, and no follow-up push will supersede this exact-SHA
validation before every required workflow is terminal.

The state file now reflects the pushed SHA and live run. C07.2 group direction
implementation, fixture, inventory/requirements updates, and the pinned
Obsidian first-open/reopen probe remain uncommitted and separate from the C08
formatting correction. A delegated probe review accidentally ran
`git diff --check`; it produced no output. No local tests, builds, formatters,
linters, application launches, or other executable validation were run.


## 2026-10-12 — C07 documented gap crosswalk expanded

The current official Bases syntax documents `groupOrder` as both a visibility
filter and an explicit group ordering, and says `null` in that list includes
rows with no grouped-property value. The C07 implementation inventory had not
tracked this documented behavior. Added mandatory pending requirement C07.3
for JSON/native YAML parsing, typed ordered values, null-group inclusion,
precedence over groupBy direction, source preservation, and pinned Obsidian
first-open/reopen verification.

C07.2 explicitly excludes locale sorting and JavaScript number behavior above
2^53. Added mandatory pending C07.4 to characterize and match the pinned
Obsidian 1.14.4 behavior for locale-sensitive text ordering and large-number
conversion/comparison/identity on the three CI operating systems. C07 parent
acceptance now names these obligations; no documented gap is treated as
complete. The requirements file now has 215 rows. This scope update is local
and will be included only in a later exact-SHA milestone after the current
R2.8.100 CI gate and C08 correction are reconciled.


## 2026-10-12 — C07 full-syntax coverage audit

A source-to-implementation crosswalk against the official Bases syntax and Views
documentation found that the current Rust projection only collects Markdown
notes, exposes three file fields, evaluates a narrow comparison/formula subset,
and renders results through generic rows. Added pending C07.5–C07.9 for the
all-file universe and file properties, expression/filter/formula semantics,
display names and summaries, distinct core layouts, and context-sensitive
`this.file`. Extended C07.3 to preserve typed group identity and explicitly
listed empty groups. These rows remain pending until implementation and pinned
Obsidian reference behavior are demonstrated in exact-SHA GitHub CI.

This scope work is local while R2.8.100 attempt 1 remains active. No local tests,
builds, formatters, linters, validators, or applications were run.


## 2026-10-12 — R2.8.100 CI failure diagnosis

A delegated read-only inspection of the completed Ubuntu Rust job logs isolated
`cargo fmt --all -- --check` to three formatting differences in
`crates/testkit/src/lib.rs`. The working-tree correction already expands the
assertion, wraps the map closure, and splits the fixture-file iterator expression
exactly as the CI formatter requested. Ubuntu workspace tests passed in parallel
with formatting; downstream Clippy, layer, build, and probe jobs were skipped
after the parallel group reported the formatter failure. The workflow’s native
`parallel:` group executed successfully as configured. Windows workspace tests
remain active, so the run is still pending and no follow-up push is made.


A read-only review of the queued C07.2 diff found that an unsupported explicit
`groupBy.direction` currently becomes the same internal state as an omitted
direction. Extended C07.2 acceptance to require characterization against pinned
Obsidian and a visible issue rather than silently falling back to first-seen
ordering. This remains a local acceptance update pending the current R2.8.100
run and does not alter its SHA.


## 2026-10-12 — C07.2 malformed direction diagnostics

The C07.2 source review found that an invalid explicit group direction was
indistinguishable from an omitted direction and silently used first-seen order.
The JSON and native YAML parsers now retain a visible `InvalidSource` issue for
invalid direction values; the C07 fixture and inventory entry cover both input
formats, preserve source bytes, and assert the fallback order without hiding the
issue. These C07 changes remain uncommitted while R2.8.100 attempt 1 is active.
No local tests, builds, formatters, linters, validators, or application launches
were run.


The same review found malformed `groupBy` values and objects without a string
property were also silently ignored. The JSON/native YAML parsers now report
those shapes as visible source issues, and the C07 fixture covers missing
properties and unsupported value shapes while asserting rows and source remain
intact. The C07.2 acceptance and inventory purpose now include these cases.


## 2026-10-12 — C07.2 invalid-direction reference characterization

A read-only review found the fixture's first-seen behavior for invalid explicit
directions was not yet backed by the pinned Obsidian reference. Extended the
round-trip probe with an unsupported `SIDEWAYS` direction, recording its visible
view state, group order, text, and screenshots on first open and reopen. The
probe continues to assert documented ASC/DESC behavior and source preservation;
it does not assume how Obsidian handles the invalid value. This evidence remains
pending until the C07 slice is pushed after R2.8.100's exact-SHA CI gate.

The probe also records group order when `groupBy.direction` is omitted because
the current first-seen expectation still needs a pinned-reference observation.
The Rust fallback will be reconciled with both captured behaviors before C07.2
is accepted.

Reconciled C07.7–C07.9 to R3 because their acceptance requires native UI
rendering, layouts, and presentation context. C07.2–C07.6 remain R2 document
and evaluation work. No local tests, builds, formatters, linters, validators, or
application launches were run.


## 2026-10-12 — Parallel C07 review and probe hardening

Delegated independent read-only reviews of the C07.2 pinned-app probe, the
C07.3 groupOrder implementation path, and the active R2.8.100 GitHub Actions
run. The probe review found the invalid-direction capture could accept an
unrelated UI change, fail to record a silent no-op, and sample before the view
settled. The probe now records distinct visible states until stable, waits a
bounded period for a no-transition result, retains those observations through
reopen, and requires the exact invalid-direction file to become active before
the slice can pass. It records a failed selection as evidence and lets the
reopen observation run before the final acceptance failure.

The C07.3 review found acceptance gaps for malformed values, groupOrder without
groupBy, typed array/object values, and the pinned runtime version. Expanded its
criteria to characterize these cases against Obsidian 1.14.4, require visible
issues for unsupported configurations, and cover typed equality, empty groups,
and source preservation. Added the checksum-pinned Obsidian release manifest to
its structured reference versions. The tracker now has 220 requirement rows.

At 11:26 UTC, Rust CI run 38232144781 on SHA
`0ac90e2dcbda516271c041853236215d6f08a605` remained in progress; Windows
workspace tests had been active for about 1 hour 37 minutes with no visible
logs. No push, cancel, or rerun was made. These C07 changes remain local until
the current run is terminal and the isolated C08 correction is accepted. No
local tests, builds, formatters, linters, validators, or application launches
were run.


## 2026-10-12 — Comparator and all-file metadata audit

Parallel read-only reviews of C07.4 and C07.5 found that current numeric
comparison preserves exact Rust integers above 2^53 while the legacy runtime
uses JavaScript numbers, and that current string/path sorting is not locale
collation. Expanded C07.4 to characterize numeric conversion, identity, sorting,
relational/equality filters and `contains` first, reconcile existing fixture
expectations, then cover case/diacritic/numeric-text collation and path
tie-breaks under an explicit locale policy. C07.3 numeric group identity is
cross-linked to this decision, and the checksum-pinned Obsidian release
manifest is listed as a structured reference.

The C07.5 audit found `VaultRoot::snapshot()` enumerates regular files but
hashes all contents before evaluator limits apply; current session enumeration
is Markdown-only, and no reusable timestamps or batched link index exist.
Expanded C07.5 to require a bounded non-symlink inventory before reads/hashes,
explicit handling of unavailable timestamps and incomplete collections, one
indexed Markdown pass for tags/links/backlinks/embeds, attachment metadata
without note properties, and pinned `.obsidian` inclusion/property formats.
Added the checksum-pinned Obsidian release manifest to its references.

At 11:31 UTC, Rust CI run 38232144781 remained active on Windows workspace
tests at about 1 hour 42 minutes. Only the macOS plugin-runtime artifact was
available at that time; all run evidence remains pending terminal completion.
No push, cancellation, rerun, local executable validation, test, build,
formatter, linter, or validator was run.


## 2026-10-12 — Group identity and expression audit

A follow-up C07.3 review proposed keeping `groupOrder` as three distinct parse
states (absent, listed including an empty list, and invalid) and separating
typed identity from the rendered group label. It identified additional pinned
reference questions for duplicate declarations, missing versus explicit-null
labels, array/object equality, and `groupOrder` without `groupBy`. Expanded the
C07.3 criteria and short acceptance summary to cover those cases, match visible
malformed-value fallback, and defer numeric identity to C07.4.

The C07.6 audit found formulas are computed after filtering, JSON root filters
are ignored, unsupported filters can be dropped when combined, and formula
dependencies/operators/functions are mostly unsupported. Expanded C07.6 to
require bounded JSON/native expression parsing, no silent filter removal,
deterministic formula dependencies and cycle issues, formula evaluation before
filter/sort/group, and context-free functions; `this` presentation behavior is
assigned to C07.9. C07.4 comparison and C07.5 file metadata are recorded as
dependencies. The R2 C07.2–C07.6 rows now list the checksum-pinned Obsidian
release manifest in structured references.

At 11:35 UTC, run 38232144781 remained in progress on Windows workspace tests
at about 1 hour 46 minutes, with no logs or new artifacts. No push, cancel,
rerun, or local executable validation was performed.

## 2026-10-12 — Parallel C07 and C08 review

Parallel read-only reviews confirmed that the pinned Obsidian 1.14.4 documentation
supports formula grouping in Kanban. C07.3 and C07.6 now share a reference
fixture with a formula dependency, a formula-derived group property, and
groupOrder values, checked on first open and reopen. C07.5 now names the
bounded inventory and source/metadata caps, incomplete-result behavior, the
crates/vault inventory API co-owner, and exact file.file and file.properties
forms. C07.6 now requires capturing the pinned app's rendered row membership
for unsupported filters while surfacing a visible Rust compatibility issue.

A read-only review of C08 at exact SHA 0ac90e2 found no high-confidence defect.
It noted the test reads the Markdown source directly while full-tree snapshots
check that attachment paths and bytes remain unchanged through scan, link/embed
resolution, and reopen.

At 11:46 UTC, Rust CI run 38232144781 remained in progress on Windows workspace
tests, with no step updates since 09:48 UTC. The Ubuntu formatter check failed;
Ubuntu workspace tests passed. Six other required workflows passed, and the
only available Rust artifact remains the macOS Wry evidence. No push, cancel,
rerun, or local executable validation was performed.

At 11:48 UTC, the invalid-direction probe was clarified to keep no-transition as a diagnostic
rather than an accepted compatibility result until the exact target .base
file is active. If selection fails, the reference run is recorded as a
probe failure, so it cannot be confused with Obsidian's fallback behavior.

## 2026-10-12 — R3 Bases UI lookahead and C07.2 fallback audit

The official Bases syntax and view pages were reviewed against C07.7–C07.9.
C07.7 now names displayName's table-header-only use, the typed built-in Table
summary set, per-view summary selection, grouped summary placement, and the
values expression context shared with C07.6. C07.8 now pins one setting per
layout and checks documented Table edits and Kanban moves/new-note actions,
including the pinned restrictions for formula and non-folder file-property
groups. C07.9 now requires distinct context paths, this.file in both a formula
and a filter/function, live sidebar context updates, and the absent-context
case. The pinned Obsidian 1.14.4 reference is listed for each child.

A read-only C07.2 source review found the invalid-direction fixture expected
first-seen group order without pinned app evidence. The fixture now marks that
fallback as pending and retains current Rust order only as an implementation
observation; the expected issue and source-preservation assertions remain.
Positive ASC/DESC/omitted order assertions still live in Rust source rather than
as shared fixture cases and should be normalized before that milestone is
accepted.

At 11:56 UTC, Rust CI run 38232144781 remained active on the Windows workspace
test step; GitHub returned BlobNotFound for the job log. No push, cancel, rerun,
local test, build, formatter, linter, validator, or application launch occurred.

At 11:58 UTC, committed only the CI-requested testkit formatting correction as
d6d4661fdcf139ab1459ff97f94675d9befa26ff, based on 0ac90e2. origin/main remains
on the exact SHA under CI; the formatting commit awaits terminal results before
push. No local hooks, tests, builds, formatters, linters, validators, or
application launches were run.


## 2026-10-12 — Parallel C07.2 evidence and next-slice audits

Delegated separate read-only audits of the C07.2 reference probe and next R2
milestones. The probe audit found that ASC, DESC, and omitted-direction
observations return on the first matching UI state instead of proving settled
output; group order is inferred from first text occurrences rather than
asserted headings; one note per group cannot establish within-group row order;
and positive fixture expectations lack pinned-report provenance. The parser
source review found no high-confidence C07.2 defect. Apply these evidence
corrections after the active C08 gate clears, before accepting C07.2.

The next-slice review recommends serializing C07.2 and C07.4a because both own
the Bases parser/fixture, then adding C07.5a as a separate bounded inventory
API in crates/vault before engine integration. A third read-only audit found
the current snapshot hashes every file body and the Markdown scan is unbounded;
the additive inventory should use capability-relative no-follow traversal,
return only stat metadata with explicit completeness, preserve the existing
content-addressed snapshot contract, and never imply an atomic/content
snapshot. All audits performed no local executable validation and made no
changes to the pending C08 run.

At 12:01 UTC, Rust CI run 38232144781 remained in progress on Windows workspace
tests with no updated step data since 09:48 UTC. The isolated formatter fix
remains local and unpushed until the run reaches a terminal state. No push,
cancel, rerun, test, build, formatter, linter, validator, or app launch occurred.

At 12:04 UTC, the same Windows workspace-test step remained active after 2h16m,
with only the macOS Wry artifact available. A read-only source audit found no
unbounded Rust test polling or blocking channel receive; UI wait helpers have
5–15 second deadlines and the test fixtures are modest. One narrow candidate is
the Windows ACL test's `whoami.exe`/`icacls.exe` subprocesses, which use
`Command::output()` without a timeout, though source alone does not explain the
stall. The job log remains unavailable, so no cause is attributed. No CI action
or local executable validation was performed.

At 12:07:34 UTC, GitHub still reported run 38232144781 in progress on the same
Windows `Run workspace tests` step; MSRV and macOS passed, Ubuntu formatting
failed, and only the macOS Wry artifact existed. A fresh job-log fetch at
12:08:07 UTC again returned `BlobNotFound`; the workflow log-URL endpoint also
returned 404. The job remains live and unmodified. No push, cancellation,
rerun, or local executable validation occurred.

At 12:11:37 UTC, a fresh poll of run 38232144781 still showed Windows job
114753944687 in progress on `Run workspace tests`; the other Rust jobs remained
MSRV/macOS success and Ubuntu failure. The required run is still live, so the
local formatting correction remains unpushed and C07.2 remains gated. No
cancel, rerun, push, or local executable validation occurred.

## 2026-10-13 — R2.8.100 attempt 1 reconciliation and diagnostic repair

At 20:31 UTC, exact-run GitHub Actions API reads confirmed all seven required
workflows on `0ac90e2dcbda516271c041853236215d6f08a605` were terminal. Inventory,
quality, desktop build, plugin renderer, loaded plugins, and the pinned Obsidian
1.14.4 round-trip passed (16 jobs total). Rust CI failed: MSRV and macOS passed,
Ubuntu failed `Check formatting` after workspace tests passed, and Windows job
114753944687 was cancelled after its workspace test step ran from 09:48:41 to
15:47:49 UTC. The latest available Windows test output showed
`tests::egui_previews_existing_vault_attachment_without_changing_its_tree`
still running at 09:51:04 UTC; the blocking statement is unknown. Attempt 1 is
not accepted. Exact run/job URLs and the 13 artifacts returned by the artifact
API, including sizes, digests and expirations, are recorded in
`evidence/r2.8.100-attempt-1-0ac90e2.json`. No artifact archives were
downloaded and no local executable validation was run.

The CI-requested rustfmt correction remains committed locally as
`d6d4661fdcf139ab1459ff97f94675d9befa26ff`. Added test-local C08 progress
markers and a Windows-only, 20-minute exact-test CI step with `--nocapture`;
the Windows workspace suite skips only that separately executed test. This
keeps coverage while exposing a synchronous frame if it blocks again. Updated
the goal's push policy to batch focused local commits at meaningful milestone
boundaries and wait for all required exact-SHA workflows before the next push.
These changes have not yet been run in CI. No local tests, build, formatter,
lint, validator or application launch was run. C07.2 work remains separate and
must stay out of the C08 repair batch.

The focused R2.8.100 repair batch is committed locally. A fresh read of
`refs/heads/main` still returned `0ac90e2dcbda516271c041853236215d6f08a605`;
the repair batch remains unpushed pending the single milestone CI push.

After the repair push, the remote advanced to `f41b46f5f668e306b475fc305c475f09d76cd79d`.
At 20:41 UTC, inventory, quality, desktop build, plugin renderer, and loaded
plugins had passed. Rust CI remained active: macOS passed, MSRV workspace tests
were running, Ubuntu workspace tests passed but `cargo fmt --all -- --check`
reported one line-wrap correction in `crates/ui-egui/src/lib.rs`, and the
Windows attachment-preview diagnostic step was running. All three Obsidian
round-trip jobs were active. Applied the exact formatter layout locally; no
local executable validation or follow-up push occurred.

At 20:46 UTC, the Windows attachment-preview test had passed and the Windows
workspace suite was running; the MSRV workspace tests were also active. The
Windows Obsidian round-trip completed successfully, while macOS and Ubuntu
round-trip jobs remained active. The five companion workflows stayed green;
Ubuntu's Rust formatting failure remained terminal. No follow-up push or local
executable validation occurred.

R2.8.100 repair attempt 2 reached terminal state at 20:48 UTC on exact SHA
`f41b46f5f668e306b475fc305c475f09d76cd79d`. Six companion workflows passed
all 16 jobs; Rust CI passed the MSRV, macOS, and Windows jobs, while Ubuntu
workspace tests passed and `cargo fmt --all -- --check` requested a line wrap
at `crates/ui-egui/src/lib.rs:14418`. The focused Windows attachment-preview
test passed. The pinned Obsidian round-trip passed on Windows, macOS, and
Ubuntu. All 14 returned artifact IDs, sizes, archive SHA-256 digests, and
expirations are recorded in
`evidence/r2.8.100-attempt-2-f41b46f.json`. The Windows round-trip artifact was
downloaded; its report has no C07 section because C07 was not included on this
SHA. Attempt 2 is not accepted. The exact formatter correction and evidence
are being batched as one repair milestone; no local executable validation or
follow-up push occurred.

The formatter correction and exact attempt-2 evidence were committed as
`779a33325be6e1cb5ebee30d7a69afa60a4da571` and pushed after confirming
`origin/main` still pointed to `f41b46f5f668e306b475fc305c475f09d76cd79d`.
All seven required workflows triggered for the pushed SHA: inventory
`38466235467`, quality `38466235649`, desktop build `38466235714`, plugin
renderer `38466235534`, loaded plugins `38466235636`, Rust CI `38466235354`,
and Obsidian round-trip `38466235429`. C07 remains local and unpushed. No local
executable validation was run.

At 21:03 UTC, exact-SHA polling showed the five companion workflows passed.
Rust CI had passed MSRV 1.95, Ubuntu, and macOS; its Windows job was still
running. The Obsidian 1.14.4 round-trip had passed Windows while macOS and
Ubuntu remained in progress. Artifact IDs, sizes, digests, and expiry metadata
are available from the Actions API; no terminal attempt-3 evidence file has
been written yet, and no next milestone push is allowed while jobs remain live.

Read-only review of the local C07.2 probe found that body-wide row-title
searches could misattribute rows and that failed later views lost prior
observations. The probe now uses heading and row DOM geometry, checks row
membership for ASC/DESC/omitted views, samples positive views until settled,
captures selection/render failures with screenshots and state, persists each
completed view, and records the actual view type for invalid-direction
fallbacks after exact-file selection. Per-group row order remains provisional
until the pinned-app observation is copied into fixture expectations. These
C07 changes are not part of `779a333`; no local executable validation was run.

At 21:04 UTC, Rust CI completed successfully on all four jobs, including
Windows. The Obsidian round-trip passed on Windows and macOS; Ubuntu job
115533622344 remained in progress. Six of seven required workflows are
complete and successful, so the next milestone remains gated on that last
exact-SHA job. The C07.2 probe changes remain local and are absent from this
CI SHA.

## 2026-10-13 — R2.8.100 attempt 3 accepted; C07 contract/capture milestone defined

The prior 21:04 UTC status is superseded: Obsidian round-trip job
115533622344 completed successfully at 21:06 UTC. All seven required workflows
and all 20 jobs passed for exact SHA
`779a33325be6e1cb5ebee30d7a69afa60a4da571`. The run produced 16 artifacts;
their IDs, byte sizes, archive SHA-256 digests, and expirations are recorded in
`evidence/r2.8.100-attempt-3-779a333.json`. R2.8.100 is accepted and C08 now
passes. The round-trip reports contain no C07 probe section because the local
C07 changes were not in this SHA. No local tests, builds, formatters, linters,
validators, or application launches were run.

Defined R2.8.101 to clarify the goal's milestone-batched CI policy, split C07
into independently verifiable C07.2-C07.9 requirements, and capture the C07.2
pinned reference behavior. Its CI report must record settled
omitted/ASC/DESC/unsupported-direction views, exact target selection, per-group
ordered rows and membership across reopen, and unchanged source hashes on all
three operating systems. The captured behavior will be reconciled into fixtures
and Rust semantics in a separate milestone. The goal now states that minor
edits accumulate locally and `origin/main` receives one push per completed
milestone; while a long CI batch is running, the remote tip stays unchanged
until all exact-SHA workflows finish. No R2.8.101 push has been made; finish
read-only review of the probe candidate before its single batched push.

Follow-up read-only probe review hardened one error path: the unsupported
direction capture now records its last known state and state samples even when
a retry read or screenshot fails, including the error details. An initial
renderer-read failure is also caught and persisted. The report labels the
R2.8.101 capture scope separately from later Rust parity; visible heading and
row candidates are filtered before order extraction. These source changes
remain pending GitHub Actions. Keep `crates/doc/src/bases.rs` and
`fixtures/c07-bases.json` out of the reference-capture push so that the probe
and engine/fixture reconciliation remain separate milestones. No local
executable validation was run.

Final read-only review confirmed the R2.8.101 probe records visible per-group
row membership/order, settled first-open and reopen observations, source hashes,
and failures without discarding prior captures. The goal's push rule now
distinguishes a completed implementation batch ready for CI from an accepted
milestone: push one accumulated batch after the named deliverable and CI-ready
acceptance package are complete, then hold `origin/main` steady until every
required exact-SHA workflow finishes and is reconciled. CI submission alone
does not mark the milestone accepted. R2.8.101 is ready for its single CI
submission; the Rust evaluator and fixture parity edits remain outside this
batch. No local executable validation was run.

## 2026-10-13 — R2.8.101 attempt 1 reconciled; capture repair in progress

R2.8.101 attempt 1 was pushed as exact SHA
`33eb15f4d01ac4d4456143260689f127068697e8`. All seven required workflows
reached terminal state: quality, desktop build, plugin renderer, loaded plugins,
and Rust CI passed (16 jobs total); inventory failed; and all three
Linux/macOS/Windows Obsidian round-trip jobs failed. The Rust workflow passed
all four jobs. The run returned 16 artifacts. Exact workflow/job IDs, artifact
IDs/digests/expiry, and the failure observations are stored in
`evidence/r2.8.101-attempt-1-33eb15f.json`. Attempt 1 is not accepted.

The inventory failure had two causes: the validator did not allow the newly
split C07.2-C07.9 rows, and `inventory.json` described the local, unpushed
revision of `fixtures/c07-bases.json` instead of the fixture at the tested SHA.
The validator and baseline hash corrections are committed locally in
`02049fc` and `05c42a6`; they have not been pushed.

The round-trip failure occurred during first-open ASC capture on all three
platforms. Exact-file selection and the Bases view succeeded, but the probe
found no heading candidates or group rows. The Windows screenshot/report show
Alpha, Bravo, and Zulu note groups plus a visible None group with the four
`.base` files. The probe repair now scopes extraction to rendered Bases table
rows, records group and file-path order dynamically, includes DOM diagnostics
for future CI failures, and requires only complete fixture-path capture and
stable observations across reopen. It no longer judges the pinned app against
preset ASC/DESC order or hard-coded group membership; interpretation and Rust
fixture reconciliation remain a separate milestone. Keep
`crates/doc/src/bases.rs` and `fixtures/c07-bases.json` out of this repair batch.
No local executable validation was run.

## 2026-10-13 — R2.8.101 repair batch ready for one CI submission

Clarified the CI cadence in `goal.md`: related minor work accumulates inside a
named implementation milestone, its complete CI-ready package is pushed once,
and the milestone is accepted only after required workflows pass on that exact
SHA. The remote tip stays unchanged while the potentially hours-long workflow
batch is pending; no minor-change or next-milestone push is allowed during
that wait.

The C07 probe now extracts visible, recognized table/row/list-item records
using exact row classes, records ordered groups and file paths without preset
membership/order claims, and requires all ten fixture paths only for ASC, DESC,
and omitted views. SIDEWAYS is capture-only and accepts partial or empty output
when each typed candidate maps. Exact-fixture links outside a recognized row
are retained separately as unscoped diagnostics and never inherit a group by
vertical position. First-open/reopen comparisons include those diagnostics;
selection, render, and capture failures retain their state samples and
screenshot evidence.

Read-only subagent review found no remaining serious probe issue after the
selector/scoping corrections. The two inventory fixes are in local commits
`02049fc` and `05c42a6`; attempt-1 evidence is ready to include. Keep
`crates/doc/src/bases.rs` and `fixtures/c07-bases.json` out of this reference
repair. The accumulated batch is ready for its single push; its exact
implementation SHA and new CI evidence will be recorded after submission. No
local executable validation was run.

## 2026-10-13 — R2.8.101 attempt 2 partial CI

GitHub confirms `origin/main` remains at exact SHA
`e85c40329a9b0597822901bc026414556db3285d`. Five required workflows have
passed: inventory, quality, desktop build, plugin renderer, and loaded plugins.
Rust CI macOS and Ubuntu jobs also passed; its MSRV 1.95 and Windows jobs remain
in progress. All three Obsidian 1.14.4 round-trip jobs remain in progress. The
latest snapshot records 15 of 20 successful jobs, five pending jobs, and the
available artifact IDs, sizes, SHA-256 digests, and expirations in
`evidence/r2.8.101-attempt-2-e85c403.json`. No failures are recorded so far.
Keep the remote tip unchanged and reconcile final jobs and C07.2 captures only
after both remaining workflows become terminal. No local executable validation
was run.

## 2026-10-13 — R2.8.101 attempt 2 reconciled; R2.8.102 repair in progress

All seven required workflows reached terminal state on exact SHA
`e85c40329a9b0597822901bc026414556db3285d`. Inventory, quality, desktop build,
plugin renderer, loaded-plugin workflows, and all four Rust CI jobs passed.
Obsidian vault round-trip run
[38476604440](https://github.com/ashutoshpw/open-obsidian/actions/runs/38476604440)
failed on Linux job `115568710229`, macOS job `115568709798`, and Windows job
`115568710139`. Each report selected `Ascending.base`, exposed the Bases view,
and listed all ten results, but captured rows only under Alpha. The DOM uses a
separate `.bases-table` for each group; the probe treated only the first table
as in-scope and omitted Bravo, Zulu, and None rows from the per-group mapping.
The attempt is not accepted. All 16 artifact IDs, sizes, digests, and expiration
times, plus the exact job conclusions, are recorded in
[`evidence/r2.8.101-attempt-2-e85c403.json`](evidence/r2.8.101-attempt-2-e85c403.json).

Defined R2.8.102 as one focused repair milestone. The local probe now enumerates
each visible table root, scans rows across those roots, and uses the nearest
table for row/link membership. The goal's push policy now says one accumulated
push after a named milestone's implementation and CI-ready acceptance package
are complete, followed by a stable-SHA wait for every required workflow; local
failure analysis remains allowed during that wait. The C07 evaluator and fixture
changes remain outside this batch. No local executable validation was run; this
repair is validated only by exact-SHA GitHub Actions after its single batch push.

## 2026-10-13 — R2.8.102 submitted to GitHub Actions

After attempt 2 was fully reconciled, pushed the completed multi-table capture
repair and goal cadence update in one batch to `origin/main` at exact SHA
`636b8fbe935b4225ef724d1fa56df3a7d92c4d49`. All seven required workflows were
queued for that SHA: inventory `38478734160`, quality `38478734201`, desktop
build `38478734162`, plugin renderer `38478734152`, loaded plugins `38478734255`,
Rust CI `38478734190`, and Obsidian round-trip `38478734218`. The initial exact
run snapshot is in
[`evidence/r2.8.102-attempt-1-636b8fb.json`](evidence/r2.8.102-attempt-1-636b8fb.json).
Keep `origin/main` at this SHA until all seven workflows and their jobs are
terminal and reconciled. The provisional C07 evaluator/fixture changes remain
local. No local executable validation was run.

## 2026-10-13 — R2.8.102 attempt 1 reconciled; R2.8.103 prepared

All seven required workflows are terminal for exact SHA
`636b8fbe935b4225ef724d1fa56df3a7d92c4d49`: inventory `38478734160`, quality
`38478734201`, desktop build `38478734162`, plugin renderer `38478734152`,
loaded plugins `38478734255`, and Rust CI `38478734190` passed. Obsidian
round-trip `38478734218` failed on Linux, macOS, and Windows. Each platform
reached the C07 ASC and DESC views and captured the same groups and member rows,
confirming multi-table discovery. The source-preservation assertion then found
that Obsidian rewrote `Ascending.base` from `name: "C07 group direction ASC"`
and `property: note.team` to `name: C07 group direction ASC` and
`property: team`. The seed was noncanonical; keep strict hashes and author the
canonical YAML before opening Obsidian. The reports and exact artifact digests
are recorded in [`evidence/r2.8.102-attempt-1-636b8fb.json`](evidence/r2.8.102-attempt-1-636b8fb.json).

Prepared R2.8.103 as one C07.2 capture-fixture repair batch: seed Obsidian's
canonical native YAML, retain source-preservation checks, and capture ASC, DESC,
omitted, and unsupported direction through first open and reopen on all three
platforms. The provisional Rust evaluator and fixture changes stay separate
until the complete reference result is available. `origin/main` remains at
`636b8fb`; no local executable validation was run.

## 2026-10-13 — R2.8.103 submitted to GitHub Actions

Pushed the single completed canonical-fixture capture batch to `origin/main` at
exact SHA `de462533be90985ba1dbb368e70231ffc1edd815` (commit `de46253`). All seven required workflows were queued:
quality `38480428475`, inventory `38480428584`, loaded plugins `38480428472`,
desktop build `38480428526`, Rust CI `38480428606`, Obsidian round-trip
`38480428571`, and plugin renderer `38480428613`. The initial exact-SHA snapshot
is in [`evidence/r2.8.103-attempt-1-de46253.json`](evidence/r2.8.103-attempt-1-de46253.json).
Keep `origin/main` at this SHA until every required workflow/job is terminal and
reconciled. The provisional Rust Bases evaluator and fixture edits remain local.
No local executable validation was run.

## Read-only C07.2 candidate review during R2.8.103 CI wait

The parked `crates/doc/src/bases.rs` candidate orders the missing-value group
before populated groups for ASC. The provisional R2.8.102 reference capture put
`None` last for both ASC and DESC. Its current direction fixtures omit the
missing-value rows and do not cover all ten observed paths or the two-row Alpha
and Bravo groups. Omitted-direction default, invalid-direction fallback, numeric
ordering, reopen stability, and source preservation remain unverified. Reconcile
these in the later parity milestone after R2.8.103 produces complete reference
results; no implementation change or executable validation was made during the
CI wait.


## 2026-10-13 — R2.8.103 attempt 1 reconciled; R2.8.104 prepared

All seven required workflows and all 20 jobs reached terminal state on exact SHA
`de462533be90985ba1dbb368e70231ffc1edd815`. Inventory, quality, loaded plugins,
desktop build, plugin renderer, and all four Rust CI jobs passed (17 jobs).
Obsidian vault round-trip `38480428571` failed on Windows job `115581379170`,
macOS job `115581379491`, and Ubuntu job `115581379508`. Each platform
selected `Omitted Direction.base` successfully and showed the same `.bases-error`
message, `"groupBy" must be a object in view "C07 group direction omitted"`,
with no groups or rows. ASC was `Alpha, Bravo, Zulu, None`; DESC was
`Zulu, Bravo, Alpha, None`, with matching row membership/order across all three
first-open reports. Source hashes were unchanged. The failed omitted case stopped
the probe before SIDEWAYS or reopen capture, so R2.8.103 is not accepted. All
20 job conclusions and the 16 exact artifact IDs, sizes, archive digests, and
expirations are in
[`evidence/r2.8.103-attempt-1-de46253.json`](evidence/r2.8.103-attempt-1-de46253.json).

Prepared R2.8.104 as a focused C07.2 reference-capture repair: treat the tested
missing-direction native-YAML mapping as the pinned app's visible parse-error
outcome after exact-file selection, retain settled DOM/screenshot/hash evidence,
continue to SIDEWAYS, and compare all observations after reopen on Linux, macOS,
and Windows. Keep the parked Rust Bases evaluator/fixture changes separate until
the full reference result is available. The goal wording now explicitly says not
to push after every minor change; accumulate related changes into one named
milestone batch, push once when its acceptance package is ready, and wait for all
exact-SHA CI workflows before another push. `origin/main` remains at `de46253`;
no local executable validation was run.

## R2.8.104 capture repair package prepared

Static review tightened the omitted-direction probe: it now fails if the
expected `.bases-error` state does not settle, checks settled observations on
first open and reopen, and reports omitted parse-error stability separately
from explicit ASC/DESC group and row-order stability. The report metadata now
describes the pinned `groupBy` parse rejection and does not claim an omitted
group or row order. R2.8.104 acceptance notes require this separate error
comparison. The migration goal specifies one accumulated push at a named
milestone boundary and a fixed remote SHA while CI runs, including the expected
multi-hour wait. The package is ready for one push after confirming the remote
still matches its starting SHA; parked Rust Bases evaluator/fixture edits remain
excluded. No local executable validation was run.

## 2026-10-13 — R2.8.104 submitted to GitHub Actions

Pushed the single accumulated R2.8.104 milestone commit
`11931b9a9003857caf00542e74a45f7fb6947f65` to `origin/main`, after confirming
the remote tip still matched starting SHA `de462533be90985ba1dbb368e70231ffc1edd815`.
Parked `crates/doc/src/bases.rs` and `fixtures/c07-bases.json` were excluded.
All seven required workflow runs were created for the exact pushed SHA:
quality `38482878996`, inventory `38482879167`, loaded plugins `38482878953`,
desktop build `38482879089`, Rust CI `38482879033`, Obsidian round-trip
`38482879118`, and plugin renderer `38482878948`. Inventory passed in the first
poll; the other six workflows were in progress. Evidence is tracked in
[`evidence/r2.8.104-attempt-1-11931b9.json`](evidence/r2.8.104-attempt-1-11931b9.json).
Keep `origin/main` fixed until every required job is terminal. No local
executable validation was run.

## R2.8.104 Windows round-trip failure observed; CI still running

The Windows job `115589435795` in round-trip run `38482879118` failed the
strict source-hash check at `reopen-asc`: `Invalid Direction.base` changed from
122 bytes / SHA-256 `fb9d112de60508c86bdde1c2ebf989143a379ff6ce59cc89e958865cfe43afe0`
to 62 bytes / SHA-256 `6db35053b1d4aa0aca718364f906cd8820193c635ba002958f953d1aa03548cc`. The uploaded
report shows `SIDEWAYS` was the final active view before shutdown and was
restored at startup; the changed source contains only the view type and name,
with `groupBy` removed. This points to startup restoration of the unsupported
view as the mutation trigger. Confirm on the other platforms and after all jobs
are terminal before defining a focused repair. At this update, the remaining
Rust Windows/MSRV jobs and the macOS/Ubuntu round-trip jobs were still running.
The Windows artifact ID, SHA-256, size, and expiry are in
[`evidence/r2.8.104-attempt-1-11931b9.json`](evidence/r2.8.104-attempt-1-11931b9.json).
No repair has been pushed; `origin/main` remains at the submitted SHA.

## 2026-10-13 — R2.8.104 attempt 1 reconciled; R2.8.105 prepared

All seven required workflows and all 20 jobs reached terminal state on exact
SHA `11931b9a9003857caf00542e74a45f7fb6947f65`: inventory, quality, loaded
plugins, desktop build, plugin renderer, and all four Rust CI jobs passed (17
jobs). Obsidian round-trip failed on Linux job `115589435736`, macOS job
`115589435357`, and Windows job `115589435795`. Each platform captured the
settled omitted-direction parse rejection and matching ASC/DESC first-open
observations. Each then failed at `reopen-asc`: restoring the final active
SIDEWAYS view rewrote `Invalid Direction.base` from 122 bytes / SHA-256
`fb9d112de60508c86bdde1c2ebf989143a379ff6ce59cc89e958865cfe43afe0` to 62
bytes / SHA-256
`6db35053b1d4aa0aca718364f906cd8820193c635ba002958f953d1aa03548cc`, dropping
`groupBy`. DESC, omitted, and SIDEWAYS reopen observations were not reached.
All exact run/job IDs and 16 artifact IDs, sizes, digests, and expirations are
in [`evidence/r2.8.104-attempt-1-11931b9.json`](evidence/r2.8.104-attempt-1-11931b9.json).
R2.8.104 is not accepted.

Prepared R2.8.105 as one focused reopen-capture repair: after collecting the
first-open cases, leave ASC active before shutdown; reopen from that supported
view, explicitly capture all four cases again, and verify strict source hashes
around each transition and shutdown. This preserves the unsupported-view
observation while preventing it from being implicitly restored before the
reopen probe. A rewrite while switching away from SIDEWAYS will still fail the
strict hash assertion and remain visible in the report. The remote remains at
`11931b9`; make no push until the R2.8.105 implementation and acceptance
package are complete, then submit one batch and wait for its full exact-SHA CI.
No local executable validation was run.

R2.8.105's local capture change now records the immediate post-startup active
view and screenshot, checks hashes before proceeding, requires ASC to be the
restored active Bases view, and explicitly recaptures it after every direction
set before shutdown. It also restores ASC before the second shutdown and checks
hashes after both reset transitions. The accepted ASC/DESC, omitted-error, and
SIDEWAYS observations remain separate from these workspace-reset observations.
No local executable validation was run.

## 2026-10-13 — R2.8.105 submitted to GitHub Actions

Pushed the single accumulated R2.8.105 repair commit
`45ae26c71d274097bf5ca9827e61cf6e9f0c3413` after confirming `origin/main` still
matched starting SHA `11931b9a9003857caf00542e74a45f7fb6947f65`. Parked
`crates/doc/src/bases.rs` and `fixtures/c07-bases.json` were excluded. All seven
required workflows were created for the exact SHA: Rust CI `38484650452`, plugin
renderer `38484650432`, Obsidian round-trip `38484650445`, quality `38484650496`,
loaded plugins `38484650479`, inventory `38484650459`, and desktop build
`38484650469`. They were queued at the first poll. Track the job conclusions and
artifact metadata in
[evidence/r2.8.105-attempt-1-45ae26c.json](evidence/r2.8.105-attempt-1-45ae26c.json).
Keep origin/main fixed until the complete CI batch is terminal. No local
executable validation was run.

## 2026-10-13 — R2.8.105 CI reconciled

All seven required workflows and all jobs are terminal on exact SHA
45ae26c71d274097bf5ca9827e61cf6e9f0c3413. Inventory, desktop build, plugin
renderer, loaded plugins, Rust CI, and quality passed. The quality workflow's
initial Windows CDP timeout (Electron CDP evaluation exceeded 8000ms) passed
on same-SHA failed-job retry attempt 2. The three Linux, macOS, and Windows
Obsidian round-trip jobs failed at the same strict
first-open-after-shutdown-restore hash check: Invalid Direction.base changed
from 122 bytes / SHA-256
fb9d112de60508c86bdde1c2ebf989143a379ff6ce59cc89e958865cfe43afe0 to 62 bytes
/ SHA-256
6db35053b1d4aa0aca718364f906cd8820193c635ba002958f953d1aa03548cc, dropping
groupBy. First-open ASC/DESC, omitted-direction parse rejection, and SIDEWAYS
observations settled on every platform; the strict hash failure prevented
reopen captures. The reports do not isolate whether the rewrite happened while
switching views, saving workspace state, or restoring the workspace.

The full exact-SHA jobs, retry, artifacts, and platform findings are recorded
in [evidence/r2.8.105-attempt-1-45ae26c.json](evidence/r2.8.105-attempt-1-45ae26c.json).
R2.8.105 is terminal but not accepted. Keep origin/main at
45ae26c71d274097bf5ca9827e61cf6e9f0c3413 while the next named capture-repair
milestone is analyzed and prepared locally; push once its implementation and
CI-ready acceptance package are complete. No local executable validation was
run.

## 2026-10-14 — R2.8.106 planned

The R2.8.105 artifacts bound the source rewrite to the interval after the
SIDEWAYS view was captured and before the hash check following the explicit ASC
workspace reset. The reports do not establish which internal Obsidian write
caused it. All three platforms produced the same 62-byte `Invalid Direction.base`
with SHA-256
`6db35053b1d4aa0aca718364f906cd8820193c635ba002958f953d1aa03548cc`, dropping
the `groupBy` mapping.

R2.8.106 will keep the original source hashes as the immutable reference,
capture this exact reference-app normalization as a deviation rather than a
preservation pass, and fail on any other or different source change. It will
record and restore only the generated unsupported-direction fixture between
sessions, then complete explicit first-open and reopened captures on Linux,
macOS, and Windows. Rust source-byte preservation remains a separate strict
acceptance condition; the parked Rust Bases parser and fixture edits stay out
of this capture milestone. Required CI is the full seven-workflow R2 batch.
Push once after the probe, acceptance notes, and evidence schema are ready, and
hold the resulting SHA until every required workflow is terminal and
reconciled. No local executable validation will be run.

## 2026-10-14 — R2.8.106 capture contract and CI cadence clarified

Strengthened `goal.md` to say explicitly that minor edits and local commits do not
start the large CI suite: group related changes into one named milestone, push
one CI-ready batch, and keep that SHA unchanged until the full required workflow
set is terminal and reconciled. Added the reopen comparisons to C07.2 tracking:
ASC/DESC group and member-row order, and the omitted-direction visible parse
error. Clarified that the pinned app's exact synthetic-fixture normalization is
reference behavior only; Rust byte preservation remains independent and strict.

The R2.8.106 probe now recognizes and records only the exact 62-byte
`Invalid Direction.base` normalization at every post-open source-hash checkpoint,
retaining the immutable original baseline and checkpoint history. It reseeds
only that generated file between sessions and reports completed capture separately
from source preservation. The before-first-open and before-reopen seed checks stay
strict. Rust Bases parser and fixture changes remain parked outside this batch.

`origin/main` and local `HEAD` remain `45ae26c71d274097bf5ca9827e61cf6e9f0c3413`.
No local executable validation was run. Finish static review and evidence
metadata before the single R2.8.106 milestone push.

Static review tightened the failure report as well: source preservation starts
unproven, becomes true only after both complete sessions match their seed, and
becomes false on either the known normalization or any unexpected hash mismatch.
The report wording now matches the acceptance scope of all post-open hash
checkpoints. No local executable validation was run.

The hash checkpoint now passes its captured file bytes directly to the rewrite
recorder, so the SHA, bytes artifact, and first-observed stage describe one
snapshot even if the app writes the file again immediately afterward. The
report's workspace-restore description now covers every post-open hash checkpoint.

The checkpoint scan also collects missing/unreadable source paths instead of
aborting mid-scan. It continues far enough to record the known mutation, then
fails the workflow with all unrelated source mismatches included. The failure
path preserves the same behavior.

## 2026-10-14 — R2.8.106 submitted to GitHub Actions

Pushed the single accumulated milestone commit `95d2bab0acb88b672de5bab84cac0085989c6b96`
to `origin/main` after confirming its starting tip was
`45ae26c71d274097bf5ca9827e61cf6e9f0c3413`. The parked Rust Bases parser and
fixture edits were excluded. All seven required workflows were found for the
exact SHA. In the first job snapshot, inventory and the Ubuntu plugin-renderer
job passed; the other 18 of 20 jobs were queued or running. The initial
commit-filtered status lookup briefly returned no runs, then the branch view
found all seven, so no manual workflow trigger was needed. Run and job IDs are
recorded in `evidence/r2.8.106-attempt-1-95d2bab.json`. Keep `origin/main` fixed
until every required job is terminal and reconciled. No local executable
validation was run.

## R2.8.106 CI status — first four workflows passed

On exact SHA `95d2bab0acb88b672de5bab84cac0085989c6b96`, inventory, quality,
desktop build, and plugin renderer completed successfully. Two loaded-plugin
platform jobs passed while macOS continued. Rust CI's four jobs and the three
Obsidian round-trip jobs remained in progress. The observed snapshot is 12
passed and 8 running across the 20 jobs. Evidence and job links are updated in
`evidence/r2.8.106-attempt-1-95d2bab.json`; keep the remote SHA fixed.

## R2.8.106 CI status — loaded-plugin matrix passed

On exact SHA `95d2bab0acb88b672de5bab84cac0085989c6b96`, all three loaded-plugin
platform jobs have now passed. Inventory, quality, desktop build, and plugin
renderer remain passed. The four Rust CI jobs and three Obsidian round-trip jobs
are still in progress: 13 of 20 jobs passed and 7 are running. The evidence
file is updated; `origin/main` remains fixed.

## R2.8.106 CI status — Rust Ubuntu and macOS passed

The Rust CI jobs on Ubuntu and macOS have passed on exact SHA
`95d2bab0acb88b672de5bab84cac0085989c6b96`. The minimum-supported-Rust and
Windows jobs remain active, alongside all three Obsidian round-trip jobs. Five
workflows are complete; the current count is 15 passing and 5 running jobs out
of 20. Updated run/job evidence is in the R2.8.106 attempt file. The remote tip
remains unchanged.

## R2.8.106 CI status — Windows round-trip passed

The Windows Obsidian 1.14.4 round-trip job passed on exact SHA
`95d2bab0acb88b672de5bab84cac0085989c6b96`. Ubuntu and macOS round-trip remain
active, as do the Rust MSRV and Windows jobs. Six workflows are complete and
passing; 16 of 20 jobs passed and 4 are running. The remote SHA remains fixed.

## Milestone push cadence clarified

Clarified the goal's push boundary: keep minor edits and milestone work local,
then push one accumulated, CI-ready batch to `origin/main` at a named milestone
boundary. Keep that SHA fixed until its required CI batch is terminal and
reconciled; the several-hour wait is expected. This documentation update is
local and does not change the active R2.8.106 run at `95d2bab0acb88b672de5bab84cac0085989c6b96`.

## R2.8.106 attempt 1 — terminal, not accepted

All seven workflows are terminal on exact SHA
`95d2bab0acb88b672de5bab84cac0085989c6b96`: six workflow conclusions passed;
19 of 20 jobs passed. Rust CI passed on MSRV 1.95 and Ubuntu, macOS, and
Windows. Obsidian round-trip passed on Linux and Windows; macOS failed before
C07.2 in the preceding Canvas New Markdown path field check. The screenshot and
label-anchored OCR crop show `Notes/Canvas text card.md`, but `pbpaste` returned
an empty string, so the harness stopped before preview/confirmation and before
the Bases capture. This is a harness readback false negative, not a C07.2
behavior result. The exact job log and all artifact names, IDs, digests, and
links are recorded in `evidence/r2.8.106-attempt-1-95d2bab.json`.

Linux and Windows artifacts contain complete first-open/reopen C07.2 captures,
including ASC/DESC group and row-order stability, the omitted-direction error,
SIDEWAYS observations, and the exact pinned-app `Invalid Direction.base`
rewrite/reseed. That rewrite is reference-app behavior, not Rust preservation
evidence. macOS did not reach C07.2. C07.2 remains pending.

Started R2.8.107 as a focused repair: wait for the Canvas refresh to settle and
allow a literal exact OCR line from the fresh labeled path crop only when
`pbpaste` is empty; retain failure for a nonempty mismatch or missing visual
confirmation. Add an explicit included-milestone field to the aggregate report.
Keep the remote SHA fixed until this repair package is complete; exclude the
parked Rust Bases parser and fixture. No local executable validation was run.

## R2.8.107 package ready for milestone push

Static review confirms the fallback is limited to the New Markdown path, an
empty clipboard, and a fresh label-anchored OCR line with case preserved and
whitespace-only normalization. The post-entry watcher wait runs before the
clipboard and screenshot readback. Aggregate reports identify the included
C07.2 section while keeping the primary report context. The R2.8.106 attempt
evidence and all required workflows are terminal and reconciled.

Clarified the goal's push cadence: keep minor edits local, push one accumulated
batch after a named milestone's implementation and CI-ready acceptance package
are complete, then hold that exact SHA through the several-hour CI batch. The
R2.8.107 package is ready for one push. Exclude the parked Rust Bases parser and
fixture. No local executable validation was run.

## 2026-10-14 — R2.8.107 pushed; exact-SHA CI pending

Pushed the single accumulated R2.8.107 milestone commit
`fdb74ab3893b63bc9e77e7e7b12c27fd1f1821aa` to `origin/main` after confirming
the remote started at `95d2bab0acb88b672de5bab84cac0085989c6b96`. All seven
required workflows were found for the new exact SHA. The initial snapshot had
2 of 20 jobs passed, 17 running, and 1 queued; no failures were observed.
Workflow and job IDs/URLs are recorded in
`evidence/r2.8.107-attempt-1-fdb74ab.json`. Keep `origin/main` at this SHA until
all seven workflows are terminal, then reconcile every job and artifact. No
local executable validation was run.

## R2.8.107 CI progress — five workflows passed

On exact SHA `fdb74ab3893b63bc9e77e7e7b12c27fd1f1821aa`, inventory, desktop
build, quality, loaded-plugin workflows, and plugin-renderer matrix have passed.
All 13 jobs in those five workflows succeeded. The four Rust CI jobs and three
Obsidian round-trip jobs remain in progress; no failures were observed in this
snapshot. Updated run/job status is in
`evidence/r2.8.107-attempt-1-fdb74ab.json`. Keep `origin/main` fixed until all
seven workflows are terminal.

## R2.8.107 CI progress — Rust CI and Windows round-trip passed

At 2026-10-14T00:44:33Z, the exact pushed SHA `fdb74ab3893b63bc9e77e7e7b12c27fd1f1821aa` has six of seven required workflows passed. All four Rust CI jobs (MSRV 1.95 and Ubuntu/macOS/Windows) passed; the round-trip Windows job passed. The macOS and Ubuntu round-trip jobs remain in progress, so 18/20 jobs have succeeded and the attempt remains pending. Run IDs and job URLs are recorded in `evidence/r2.8.107-attempt-1-fdb74ab.json`. Hold `origin/main` at this SHA and inspect all three platform artifacts after the remaining jobs finish. C07.2 remains pending; no local executable validation was run.

## R2.8.107 CI progress — macOS round-trip passed

At 2026-10-14T00:45:08Z, the exact pushed SHA `fdb74ab3893b63bc9e77e7e7b12c27fd1f1821aa` has six of seven required workflows passed. Rust CI and the Windows and macOS round-trip jobs passed; only Ubuntu round-trip remains active. Nineteen of twenty jobs succeeded and none failed. Run/job IDs are recorded in `evidence/r2.8.107-attempt-1-fdb74ab.json`. Keep `origin/main` fixed until the final job finishes and its artifact is inspected. C07.2 remains pending; no local executable validation was run.

## R2.8.107 terminal — accepted on exact SHA

On exact SHA `fdb74ab3893b63bc9e77e7e7b12c27fd1f1821aa`, all seven required workflows and all 20 jobs passed. Round-trip Linux, macOS, and Windows artifacts were downloaded and inspected. Each report is top-level passed, includes the R2.8.106 C07.2 section, and records complete first-open/reopen evidence: ASC Alpha/Bravo/Zulu/None; DESC Zulu/Bravo/Alpha/None; omitted-direction visible parse error with zero rows/groups; SIDEWAYS flat rows with no groups; and the exact Invalid Direction.base rewrite and reseed. Artifact IDs, digests, and findings are recorded in `evidence/r2.8.107-attempt-1-fdb74ab.json`. This establishes the pinned-app reference capture only; C07.2 remains pending until Rust parity and source preservation pass. No local executable validation was run.

## R2.8.108 started — C07.2 Rust Bases parity and source preservation

Defined the next milestone against the completed three-platform reference artifacts. The focused scope covers explicit JSON/native-YAML group direction, None-last ordering, invalid native-YAML omitted/SIDEWAYS outcomes, exact source-byte and unknown-field preservation, and malformed-shape fixtures. Keep C07.3/C07.4 semantics out of scope. The existing Rust diff remains local and unvalidated; no push or local executable validation was run.

## Milestone push rule made explicit

The goal now requires exactly one accumulated `origin/main` push per named
milestone, after its implementation and CI-ready acceptance package are
complete. Minor source, test, fixture, workflow, configuration, documentation,
and evidence changes stay in the local milestone batch. Keep the submitted SHA
fixed while the several-hour required CI batch runs, and wait for all required
workflows to become terminal before the next push. `origin/main` remains at
`fdb74ab3893b63bc9e77e7e7b12c27fd1f1821aa`; R2.8.108 work is local. No local
executable validation was run.

## R2.8.108 static review follow-up

Parallel read-only reviews found that JSON `groupBy` with an omitted direction
had local first-seen behavior but no explicit unprobed fixture. Added a fixture
and Rust assertion that records this handling separately from the captured
native-YAML omitted-direction rejection. Added an unprobed JSON scalar
`groupBy` fail-safe fixture and assertions that evaluation returns the exact
reported issue message. Static review confirms missing values and empty
strings use distinct group identities; a literal string `None` can share the
missing group's display label, an uncaptured presentation case outside this
milestone. Refreshed the fixture inventory hash. All changes remain local; no
executable validation was run.

## R2.8.108 acceptance package ready

Completed the static source/fixture review and exact-error reconciliation for
the C07.2 Rust Bases slice. The package covers explicit JSON/native-YAML
ASC/DESC order, missing-last groups, omitted-direction native-YAML rejection,
SIDEWAYS flat results, source-byte and unknown-field retention, malformed
shapes, and explicit unprobed JSON omission/scalar behavior. The fixture hash
matches its migration inventory row. One accumulated push submitted the
milestone for required GitHub CI; no executable validation was run locally.

## R2.8.108 pushed; exact-SHA CI pending

Pushed the single accumulated milestone commit
`af2866641a8105ba643543ad49ee295a2dd063ba` to `origin/main` after confirming
the remote started at `fdb74ab3893b63bc9e77e7e7b12c27fd1f1821aa`. At
2026-10-14T01:04:01Z, the inventory workflow had passed; 18 jobs were running,
one was queued, and none had failed across the other six workflows. Exact run
and job IDs/URLs are in `evidence/r2.8.108-attempt-1-af28666.json`. Keep
`origin/main` at this SHA until all seven workflows and all 20 jobs are
terminal, then reconcile every result and artifact. No local executable
validation was run.

## R2.8.108 CI progress — five workflows passed

At 2026-10-14T01:05:42Z, exact SHA
`af2866641a8105ba643543ad49ee295a2dd063ba` had five of seven workflows pass:
inventory, quality, desktop build, loaded-plugin workflows, and plugin-renderer
matrix. Thirteen of 20 jobs succeeded; all four Rust CI jobs and all three
Obsidian round-trip jobs remained in progress. No failures were reported.
Updated run/job status is in `evidence/r2.8.108-attempt-1-af28666.json`; keep
`origin/main` fixed until all seven workflows are terminal.

## R2.8.108 CI progress — Rust failures identified

At 2026-10-14T01:06:58Z, 13/20 jobs had passed, two Rust CI jobs had failed
(macOS and Ubuntu workspace tests), and five jobs remained active: Rust MSRV,
Windows Rust, and the three-platform Obsidian round-trip. Ubuntu also reported
a formatting failure. The Rust workflow itself remains in progress, and GitHub
does not yet expose failed-step logs; collect them after it becomes terminal.
Current statuses are in `evidence/r2.8.108-attempt-1-af28666.json`. Keep
`origin/main` fixed at `af2866641a8105ba643543ad49ee295a2dd063ba` until every
workflow and job is terminal. No local executable validation was run.

## R2.8.108 CI progress — three Rust failures confirmed

At 2026-10-14T01:13:08Z, 13/20 jobs had passed, all three Rust OS workspace
test jobs had failed, and four jobs remained active: Rust MSRV and the three
Obsidian round-trip jobs. Ubuntu also failed formatting. GitHub logs confirm the
same test mismatch on macOS, Ubuntu, and Windows: the implementation displays
the missing formula group as `None`, while the older unsupported-formula
fixture expects an empty label. Ubuntu rustfmt reported seven layout changes
in `crates/doc/src/bases.rs`. The focused fixture expectation and exact
CI-requested formatting corrections are prepared locally, and the changed
fixture inventory hash is updated. Keep `origin/main` fixed at the submitted
SHA until all current jobs are terminal; only then define and push the named
repair milestone. No local executable validation was run.

## R2.8.108 CI progress — Rust terminal, Windows round-trip passed

At 2026-10-14T01:14:27Z, 14/20 jobs had passed, all four Rust CI jobs had
failed on the unsupported-formula fixture's stale empty-group label, and two
Obsidian round-trip jobs (Ubuntu and macOS) remained active. The Windows
round-trip passed and uploaded artifact `11863541910` (13,725,681 bytes;
archive SHA-256 `bb7a8f71252040697b3951d118068b15d15ee8584ea71ea0849eeeab485f51ef`;
report SHA-256 `de6222f77dd0b6c850159db0e591d2411892fc7550945bca45a1c7342802ddd7`).
Its C07.2 capture completed; exact artifact metadata and concise observations
are in `evidence/r2.8.108-attempt-1-af28666.json`. Keep `origin/main` fixed
until the two remaining jobs and the full round-trip workflow are terminal.
No local executable validation was run.

## R2.8.108 CI progress — Linux round-trip passed

At 2026-10-14T01:15:57Z, 15/20 jobs had passed, all four Rust CI jobs had
failed on the stale unsupported-formula fixture label, and only the macOS
Obsidian round-trip remained active. The Linux round-trip passed and uploaded
artifact `11863532481` (15,199,717 bytes; archive SHA-256
`2c1178f23b5dbe677c759ced844707c18c23dada3d471cb6a06a3473b5c72262`; report
SHA-256 `1cbb8ffdadc8e90653afccd10dffb3f54e1faa53b9c3a20d8bad08a43f28b25b`).
The Linux report confirms stable captured ASC/DESC groups and row ordering
after reopen. Exact artifact records are in
`evidence/r2.8.108-attempt-1-af28666.json`. Keep `origin/main` fixed until
macOS and the full workflow are terminal. No local executable validation was
run.

## R2.8.108 attempt 1 terminal — not accepted

At 2026-10-14T01:17:09Z, all seven required workflows and all 20 jobs were
terminal on exact SHA `af2866641a8105ba643543ad49ee295a2dd063ba`: 16 passed and
four Rust CI jobs failed. Each Rust platform/MSRV job reports the same
unsupported-formula fixture mismatch: actual missing-result group label
`None`, expected `""`; Ubuntu also failed rustfmt with seven layout changes.
The three-platform Obsidian round-trip passed and all reports retain stable
ASC/DESC groups and row order after reopen, the omitted-direction parse error,
and flat SIDEWAYS results. Artifact IDs, archive/report hashes, and exact run
and job IDs are reconciled in `evidence/r2.8.108-attempt-1-af28666.json`.
R2.8.108 is not accepted because Rust CI failed. No local executable
validation was run.

## R2.8.109 repair milestone started

After every R2.8.108 workflow became terminal, defined a single repair batch:
update the unsupported-formula fixture to expect the missing-result label
`None`, apply the exact rustfmt changes requested by Ubuntu CI, preserve the
explicit assertions for unprobed JSON groupBy behavior, and refresh the
fixture inventory hash. C07.3 and C07.4 remain outside this repair. The
complete source, fixture, inventory, state, journal, and failed-attempt
evidence package is being prepared locally; it will be pushed once to
`origin/main` only after the milestone package is ready. No local executable
validation was run.

## R2.8.109 pushed; exact-SHA CI pending

Pushed the single accumulated R2.8.109 repair commit
`813cd81a226d2611162cc44193c939bc002eba88` to `origin/main` after verifying
the remote still matched `af2866641a8105ba643543ad49ee295a2dd063ba`. The
initial exact-SHA snapshot at 2026-10-14T01:20:30Z found all seven required
workflows: inventory, quality, desktop build, plugin-renderer matrix,
loaded-plugin workflows, Rust CI, and Obsidian vault round-trip. Three of 20
jobs had passed, 16 were running, and one was queued. Exact run and job IDs
are in `evidence/r2.8.109-attempt-1-813cd81.json`. Keep `origin/main` at this
SHA until all required jobs are terminal; do not use local executable
validation.

## Goal push policy clarified (local)

Clarified `goal.md` so CI is a checkpoint for a named, completed milestone:
minor edits and intermediate commits remain local, and one accumulated
`origin/main` push starts that milestone's full CI batch. Manual or other CI
triggers for individual edits/incomplete milestones are prohibited. This
documentation update remains local while R2.8.109 CI is active; bundle it with
a later named milestone rather than creating a goal-only CI push. No local
executable validation was run.

## R2.8.109 attempt 1 terminal — not accepted

All seven required workflows and 20 jobs are terminal on exact SHA
`813cd81a226d2611162cc44193c939bc002eba88`: 19 jobs passed and one failed.
Rust CI passed 4/4 (Ubuntu, macOS, Windows, Rust 1.95); the five companion
workflows passed 13/13. The Linux and Windows Obsidian round-trip jobs passed
with C07 captures; macOS failed before C07 in the Canvas clipboard interaction
(AX found no field and the OCR-positioned fallback produced an empty
clipboard). All three artifact and report hashes, exact run/job IDs, and
platform observations are in
`evidence/r2.8.109-attempt-1-813cd81.json`. R2.8.109 is not accepted. Compare
the macOS failure with prior attempts to decide whether a same-SHA retry is a
valid transient-infrastructure retry; otherwise prepare a named follow-up
milestone. Keep `origin/main` at this SHA until that decision and any complete
follow-up package are ready. No local executable validation was run.

## R2.8.110 macOS Canvas reference-input repair started

R2.8.109's only failing job is the macOS Obsidian round-trip. Compared with
R2.8.106, the same macOS 26.6.2 / `macos-26-arm64` image shows the same
AX-miss plus OCR-positioned keyboard fallback failure class on different
Canvas fields. The current screenshot crop still showed the `text-card-id`
hint after entry; this is reproducible field targeting/focus/readback behavior,
not evidence of a transient runner outage, so no same-SHA retry is planned.

Defined R2.8.110 to repair macOS Canvas input targeting using fresh visible
placeholder/field bounds and clipboard paste, while requiring exact
clipboard/accessibility readback or a literal exact line from a fresh
field-anchored OCR crop only when clipboard readback is empty. Preserve the
New Markdown blank-field probe, source/no-write snapshots, and explicit
save/confirmation gates. Include the clarified milestone-only push policy and
R2.8.109 terminal evidence in the single accumulated batch. Keep `origin/main`
at `813cd81a226d2611162cc44193c939bc002eba88`; keep source edits local and
push once only after the complete acceptance package is ready. No local
executable validation was run.

## R2.8.110 macOS Canvas input repair assembled locally

The macOS fallback now searches both OCR modes while keeping each discovered
form label paired with candidates from that same mode. It requires exactly one
field-text match in the configured label-relative region: same row/right of
label for inline inputs, and below/left of label for the wrapped New Markdown
path. The selected field is pasted, the paste clipboard is cleared, and the
focused value is copied back. Readback also requires the exact expected text in
the fresh, unique label-relative crop; an empty clipboard may use one literal
case-preserving line only when the clipboard command had no error. Ambiguous
matches, clipboard errors, and nonempty mismatches fail closed. The report now
records label/value OCR bounds, image dimensions, and the clicked field center
to diagnose any remaining focus issue.

Two independent static reviews found no neighboring-field acceptance path or
type mismatch; the remaining risk is a fail-closed OCR/layout false negative.
The push-cadence wording and R2.8.109 evidence are included with this milestone.
The complete source/evidence/state package remains local for one accumulated
milestone push. No local tests, builds, formatters, or executable validation
were run.

## R2.8.110 pushed; exact-SHA CI pending

Pushed the single accumulated R2.8.110 commit
`d186ac031b89977e1d3fc067d20c45add8c43343` to `origin/main` after confirming
`origin` points to this repository and the previous remote tip was
`813cd81a226d2611162cc44193c939bc002eba88`. All seven required workflows were
found on the exact pushed SHA: inventory `38497909351`, quality `38497909324`,
desktop build `38497909330`, plugin renderer `38497909334`, loaded plugin
workflows `38497909364`, Rust CI `38497909357`, and Obsidian vault round-trip
`38497909338`. The initial job snapshot at 2026-10-14T01:51:36Z had 3/20 jobs
passed, 16 running, one queued, and no failures. Exact run URLs, job states,
and the snapshot are in `evidence/r2.8.110-attempt-1-d186ac0.json`. Keep
`origin/main` at this SHA until every required job is terminal. No local
executable validation was run.

The latest exact-SHA snapshot at 2026-10-14T01:53:07Z has five successful
workflows and 13/20 jobs passed. The four Rust CI jobs and three platform
round-trip jobs remain in progress; no failures or queued jobs are reported.
The run IDs and updated snapshot are retained in the same evidence file.

At 2026-10-14T01:55:34Z, Rust CI Ubuntu and macOS had passed, bringing the
batch to 15/20 successful jobs. Rust 1.95, Windows Rust, and the three
round-trip platforms remained active with no failures or queued jobs.

## R2.8.110 terminal; R2.8.111 focused-crop repair underway

All seven required workflows and 20 jobs are terminal on exact SHA
`d186ac031b89977e1d3fc067d20c45add8c43343`: 19 passed and one failed. Rust
CI passed 4/4, all five companion workflows passed, and Windows/Ubuntu
round-trips passed. The macOS round-trip failed at C06 Canvas edit-path
targeting before C07. Its AX lookup found zero fields, then full-desktop OCR
reported zero visible field candidates. The raw macOS screenshot shows
`Boards/Idea.canvas` inside the expected same-row field; the derived OCR image
washed the gray placeholder into the white input after `-level 0%,15%`
preprocessing. This is a fail-closed OCR preprocessing miss, not evidence of
wrong label-relative geometry. No same-SHA retry is needed for this source
failure.

The seven run IDs and all 20 job IDs/conclusions are captured in
`evidence/r2.8.110-attempt-1-d186ac0.json`. Round-trip artifact IDs are
11863883564 (macOS), 11864649824 (Windows), and 11865430252 (Linux); report
hashes, the macOS screenshot/OCR image hashes, failure details, and artifact
sizes are recorded there. The R2.8.110 milestone remains unaccepted.

Defined R2.8.111 as one focused repair milestone after the R2.8.110 batch
became terminal. Full-screen OCR remains responsible for locating instructions
and labels. When it fails to identify one field value, the fallback crops the
configured label-relative field region from the original screenshot,
preprocesses the crop separately, maps candidates through measured crop and
source image dimensions, and applies the same unique-match geometry rule. Both
raw and processed crop paths, bounds, dimensions/scales, OCR modes/text,
candidate lists, mapped bounds, and the field center are retained in the CI
report. Missing or ambiguous candidates still fail closed; exact clipboard
and fresh visible-field OCR verification remain required.

Two independent static reviews found no fail-open, coordinate-mapping, or
uniqueness issue. The code review requested removal of an unused local
executable variable; that cleanup is included. No local tests, builds,
formatters, typechecks, or runtime validation were run. The goal's milestone
policy remains in effect: do not trigger CI for intermediate edits. Finish the
source and evidence package locally, then push one accumulated R2.8.111
milestone to `origin/main`; hold that exact SHA until every required job is
terminal.

## R2.8.111 pushed; exact-SHA CI pending

After R2.8.110 became terminal, confirmed `origin/main` still matched
`d186ac031b89977e1d3fc067d20c45add8c43343` and pushed the single complete
R2.8.111 milestone commit `b917c2e615223917ea205beb9a4537fc398ee3b6` to
`origin/main`. The commit contains the focused-crop OCR repair, static review
notes, R2.8.110 terminal job/artifact reconciliation, and the R2.8.111 scope
and acceptance criteria. No local executable validation was run.

All seven required workflows were identified on the exact pushed SHA:
inventory `38499461125`, quality `38499461058`, desktop build `38499461059`,
plugin renderer `38499461126`, loaded plugin workflows `38499461131`, Rust CI
`38499461122`, and Obsidian vault round-trip `38499461080`. Initial snapshot:
2/20 jobs passed, 17 in progress, one queued, zero failures. Exact job IDs,
URLs, and state are in `evidence/r2.8.111-attempt-1-b917c2e.json`. Hold
`origin/main` at this SHA until every job is terminal; do not push or trigger
another batch while it runs.

At 2026-10-14T02:10:18Z, 13/20 R2.8.111 jobs passed. Inventory, quality,
desktop build, plugin renderer, and loaded-plugin workflows are all
successful. The four Rust CI jobs and three round-trip platform jobs remain
in progress; there are no queued jobs or failures. The exact-SHA snapshot is
in `evidence/r2.8.111-attempt-1-b917c2e.json`. Continue holding `origin/main`
at `b917c2e615223917ea205beb9a4537fc398ee3b6` until all required jobs are
terminal.

At 2026-10-14T02:13:11Z, 15/20 R2.8.111 jobs passed. Rust CI macOS and
Ubuntu passed, in addition to inventory and all five companion workflows.
Windows Rust, MSRV Rust 1.95, and the three round-trip platform jobs remain
active; none are queued and no failures are reported. The macOS round-trip is
running the focused-crop repair. The exact-SHA snapshot is retained in
`evidence/r2.8.111-attempt-1-b917c2e.json`; keep `origin/main` fixed at
`b917c2e615223917ea205beb9a4537fc398ee3b6` until all jobs are terminal.

At 2026-10-14T02:18:25Z, 16/20 R2.8.111 jobs passed. Rust CI is green on
macOS, Ubuntu, and minimum Rust 1.95; all five companion workflows are also
green. Windows Rust is building its native preview, and Windows/macOS/Ubuntu
round-trip UI jobs are still running. No failures or queued jobs are reported.
See the updated exact-SHA evidence snapshot and keep `origin/main` at
`b917c2e615223917ea205beb9a4537fc398ee3b6` until every job is terminal.


## R2.8.111 terminal; R2.8.112 readback repair defined

All seven required workflows and 20 jobs are terminal on exact SHA
`b917c2e615223917ea205beb9a4537fc398ee3b6`: 19 passed and one failed. Rust
CI passed all four jobs; inventory, quality, desktop build, plugin renderer,
and loaded-plugin workflows passed all 13 companion jobs. Windows and Ubuntu
Obsidian round-trip passed. The macOS round-trip failed at C06 Canvas edit-path
readback before C07. Full run/job outcomes and artifact metadata are in
`evidence/r2.8.111-attempt-1-b917c2e.json`.

The macOS artifact report is SHA-256
`324064f557578cf8cd7eea9304e6835fe2a4c4680ab22dafe31145492ab5bc15`. The
label-relative field crop was 251x32 and the processed crop was 1004x128 at
4x. The fresh screenshot shows `C06 Reference.canvas` selected in the intended
field, while OCR returned empty text in PSM 7 and `i"!` in PSM 6. The report
did not preserve the clipboard value, and the fail-closed visual check aborted
before C07. This is an OCR false negative; the artifact shows the expected
field alignment and value. Raw/processed crop hashes are
`9f7e6179aa3c03b950bc48a75ce2c5c48cb4167d2bd9c7ff4feec15a7d8a36d6` and
`cca8701c74f1575b89aa44b7440b042c13021d4d3612a8d69016409d8f30fcaf`; the
readback screenshot hash is
`8b3d59d986c55076c1181c140f69a1e502a4d1ff734eddac97a8f510bb6c5e82`.
Windows artifact 11865053789 (13,906,095 bytes; API digest
`sha256:d0f3b40b9fc4434f98e6150d78df34e65ceb8eb8eb59bbd46acb4f6165c5a1`)
report hash is `721f71a9fb20b6961f05fc9c32a3d4fd13f614ace8d588aa40ac334f6165c5a1`.
Linux artifact 11865084065 (15,198,519 bytes; API digest
`sha256:51ec825cd112c2e27c3cec7b92c83fe34f30af2291e2109cf3f0ec182cfb7fc0`)
report hash is `410fdbaffe86f0c552e7cc728cf7bb238f4324e157e4774201ba50437fca4d2f`.
macOS artifact 11865980376 (11,873,323 bytes; API digest
`sha256:e3cfa4a6188a32d16bc0924a5860c8dba1156f9a4e80959980e936dfd66db962`).

Independent read-only reviews recommend sending Right Arrow after Cmd+C and
before the readback capture so the exact copied clipboard value is retained
while the field text is no longer selected. Keep exact clipboard readback and
unique, label-relative visible OCR as independent required checks; do not
relax geometry or candidate uniqueness. R2.8.112 is defined for this repair,
with the clarified goal.md rule: minor edits and commits remain batched
locally, and exactly one accumulated `origin/main` push occurs after each
named implementation milestone package is ready. Hold `origin/main` at
`b917c2e615223917ea205beb9a4537fc398ee3b6` until that package is ready. No
local tests, builds, formatters, typechecks or runtime validation were run.


## R2.8.112 implementation slice ready for milestone packaging

Applied the focused macOS readback correction in
`audit-obsidian-vault-roundtrip.ts`: after Cmd+A/Cmd+C copies the focused field,
the automation waits briefly and sends Right Arrow before screenshot capture,
so selected text is no longer highlighted for OCR while the copied clipboard
value remains available. The success report records that the selection-collapse
key was sent. Existing unique label-relative OCR, exact clipboard readback, and
the narrowly conditional empty-clipboard exact-line fallback remain unchanged;
no field geometry or candidate-matching rule was relaxed.

Two independent read-only reviews approved the repair and confirmed the strict
visual/clipboard gates and the clarified `goal.md` one-push-per-milestone rule.
The raw `goal.md`, source, R2.8.111 terminal evidence, state, and journal changes
are all local for one accumulated R2.8.112 milestone package. No local tests,
builds, formatters, typechecks, or runtime validation were run. Push only after
this complete package is assembled; then hold its exact SHA until all required
GitHub Actions jobs are terminal.


## R2.8.112 pushed; exact-SHA CI pending

Confirmed `origin/main` matched the terminal R2.8.111 SHA
`b917c2e615223917ea205beb9a4537fc398ee3b6`, then pushed the complete
R2.8.112 milestone once as `dd2bfbdb81a9df95a65b53488f489c2a50757e2f`. The
commit contains the macOS Canvas text deselection before screenshot OCR, its
readback diagnostic, the clearer milestone-only push policy, and R2.8.111
terminal job/artifact reconciliation.

All seven required workflows were identified on the exact pushed SHA:
inventory `38501049919`, quality `38501049920`, desktop build `38501049930`,
plugin renderer `38501049916`, loaded plugins `38501049970`, Rust CI
`38501049872`, and Obsidian vault round-trip `38501049927`. Initial snapshot:
3/20 jobs passed, 16 were in progress, one was queued, and no failures were
reported. Run/job IDs, URLs, and statuses are in
`evidence/r2.8.112-attempt-1-dd2bfbd.json`. Hold `origin/main` at the submitted
SHA until every required job is terminal; no local tests, builds, formatters,
typechecks, or runtime validation were run.


At 2026-10-14T02:27:58Z, 10/20 R2.8.112 jobs passed. Inventory, desktop
build (3/3), plugin renderer (3/3), quality Ubuntu, and loaded-plugin
Windows/Ubuntu passed. Quality Windows/macOS, loaded-plugin macOS, Rust 4/4,
and round-trip 3/3 remained in progress; no failures or queued jobs were
reported. See `evidence/r2.8.112-attempt-1-dd2bfbd.json`; keep `origin/main`
fixed at the submitted SHA until all required jobs are terminal.


At 2026-10-14T02:29:01Z, all five R2.8.112 companion workflows passed all
13 jobs. Rust CI 4/4 and all three Obsidian round-trip jobs remain in progress;
there are no failures or queued jobs. Exact-SHA artifact IDs, sizes, API
digests, job IDs and URLs are recorded in
`evidence/r2.8.112-attempt-1-dd2bfbd.json`. Keep `origin/main` fixed at
`dd2bfbdb81a9df95a65b53488f489c2a50757e2f` until the Rust and round-trip
workflows are terminal and their artifacts are reconciled.


At 2026-10-14T02:30:44Z, 15/20 R2.8.112 jobs passed. All companion
workflows are green; Rust Ubuntu and macOS also passed. Rust Windows is still
running the attachment-preview test, minimum Rust 1.95 is running locked
workspace tests, and all three Obsidian round-trip jobs remain active. No
failures or queued jobs are reported. Exact-SHA status is in
`evidence/r2.8.112-attempt-1-dd2bfbd.json`; keep `origin/main` fixed until
all jobs finish.


At 2026-10-14T02:33:57Z, the overall R2.8.112 count remains 15/20 passed,
with five jobs active and no failures/queued jobs. The Rust Windows
attachment-preview test passed and its workspace tests are running; MSRV
locked workspace tests continue. All three round-trip jobs remain in the
author/open/snapshot/reopen step. Keep `origin/main` at the exact submitted
SHA and await terminal workflow results.


At 2026-10-14T02:35:15Z, the R2.8.112 batch remains 15/20 passed with five
jobs active. Rust Windows attachment-preview/workspace tests and Clippy passed;
its dependency-layer check is running. MSRV locked tests continue. macOS and
Windows round-trip are at step 16 and Ubuntu at step 15 of the author/open/
snapshot/reopen acceptance phase. No failures or queued jobs. Keep the pushed
SHA fixed.


At 2026-10-14T02:36:41Z, 17/20 jobs passed. All companion workflows, Rust
Ubuntu/macOS/MSRV 1.95, and the Windows round-trip passed. Rust Windows native
preview and macOS/Ubuntu round-trip are still running; no failures or queued
jobs. Windows round-trip artifact 11866705727 is 13,962,987 bytes with API
digest `sha256:88d24238e3a295f8f58e5be5e8ad3278cd8c7dcbb91c09156980629a4fc0fdfb`.
Other currently available Rust and companion artifacts are in
`evidence/r2.8.112-attempt-1-dd2bfbd.json`. Keep the remote SHA fixed.

## R2.8.112 terminal result and R2.8.113 repair scope

At 2026-10-14T02:40:14Z, all seven required workflows and 20 jobs for exact SHA `dd2bfbdb81a9df95a65b53488f489c2a50757e2f` are terminal: 19 passed and one failed. Inventory, quality, desktop build, renderer, loaded-plugin workflows and all four Rust CI jobs passed. Windows and Ubuntu Obsidian round-trip passed; macOS job `115647827573` failed at C06 Canvas edit-path OCR before C07. The macOS screenshot visibly shows the exact `C06 Reference.canvas` value with selection collapsed, but Tesseract PSM 7 returned `[cos Referencecanvag` and PSM 6 returned `CIE Daferanre [cos Referencecanvag`. The exact clipboard result was not recorded, so it remains unverified. The selection-collapse correction improved the screenshot/OCR evidence but did not satisfy the exact OCR gate. Artifact, report, screenshot and crop hashes are recorded in `evidence/r2.8.112-attempt-1-dd2bfbd.json`.

Windows and Ubuntu completed C06 and C07.2. Their reference capture reports document two Obsidian source rewrites; that is pinned application behavior, not Rust parity. The terminal exact-SHA result is not accepted because macOS did not complete C06/C07.

The goal's CI cadence wording was clarified locally per user direction: related minor changes accumulate locally, and one reviewed `origin/main` push occurs only after a named milestone implementation package is complete. No goal edit was pushed during this run. Define R2.8.113 as the focused macOS OCR/readback repair; preserve exact visual OCR, exact clipboard verification, label-relative geometry and unique field matching. Keep all work local until the coherent repair package and CI acceptance criteria are ready, then push once and hold that SHA through its full CI batch. No local test/build/format/type/runtime validation was run.

### R2.8.113 planned deliverable and acceptance

**Deliverable:** make macOS Canvas field readback robust to Tesseract's C06 filename misrecognition without weakening the visible-value or clipboard gates. If full-screen Tesseract cannot locate the entered value, retain the uniquely recognized field label and configured label-relative field rectangle for a fresh screenshot crop. Use macOS Vision's accurate text-recognition request on that crop, with language correction disabled; require one exact, case-preserving recognized line. Keep exact clipboard equality mandatory. The existing empty/no-error clipboard exception continues to require Tesseract's literal exact line and is not widened to Vision-only output. Preserve all existing field geometry, label/candidate ambiguity rejection, and entry targeting.

**Acceptance:** C06 Canvas edit-path and card-ID readbacks complete on macOS with exact visual text and exact clipboard contents; C06 plus the existing C07.2 reference capture complete on Ubuntu, macOS and Windows. Keep the known Obsidian source rewrite observations clearly labeled as reference-app behavior. All 20 jobs across inventory, quality, desktop build, plugin renderer, loaded-plugin workflows, Rust CI and Obsidian round-trip pass on the exact milestone SHA.

**Expected CI evidence:** exact SHA, all seven run IDs/URLs and job conclusions, platform/tool versions, round-trip report and artifact digests, report SHA-256, screenshot and focused-crop hashes, label-relative crop bounds, Tesseract and Vision text/candidates/confidence/bounds, exact clipboard readback status, and C06/C07.2 phase results. Do not use local tests, builds, OCR probes or other executable validation. Static reviews found no blocking code/API issue and approve the final fallback behavior. Submit this as one accumulated milestone push only after its implementation and CI-ready evidence package are complete; keep all current edits local meanwhile.

## R2.8.113 terminal result and R2.8.114 repair scope

At 2026-10-14T03:00:14Z, all seven required workflows and all 20 jobs for exact SHA `f87842ada8519af5b1ad5952625e855b9e921a23` are terminal: 19 passed and one failed. Inventory, quality, desktop build, plugin renderer, loaded-plugin workflows, and all four Rust CI jobs passed. Windows and Ubuntu round-trip passed. The macOS round-trip job `115653520285` failed later in note creation while positioning the already populated `Canvas path` field; it did not reach C07.2. Complete run/job/artifact IDs, digests, report hashes and failure diagnostics are in `evidence/r2.8.113-attempt-1-f87842a.json`.

The earlier C06 Canvas edit-path readback repair works on macOS: clipboard equality was exact, Vision recognized `C06 Reference.canvas` with confidence 1.0, and the selection-collapse key was sent before capture. The later failure is separate: macOS accessibility found zero matching fields, while Tesseract PSM 7 and 6 both read the visible `Boards/Idea.canvas` as `fecardsideacanvas` and returned no field candidates. The CI screenshot and processed crop visibly show the expected value, so this is an OCR field-positioning false negative; the script correctly failed closed. C07.2 was captured on Linux and Windows but was not reached on macOS. Their reports retain the two observed Obsidian source rewrites as reference-app behavior, not Rust parity evidence.

## R2.8.114 planned deliverable and acceptance

**Deliverable:** use the existing macOS Vision OCR only as a focused field-positioning fallback after both Tesseract passes on the processed label-relative crop produce zero candidates. Require exactly one case-preserving, whitespace-normalized match to the configured current field value, confidence of at least 0.80, a valid normalized box within the crop, and a unique candidate after the existing same-row/right-of-label geometry filter. Convert Vision's bottom-left-origin box through the crop scale and full-screen OCR scale exactly once. Do not invoke Vision when Tesseract returned any candidate (including ambiguous or approximate candidates), and do not fall back to estimated label offsets for a populated field. Preserve exact clipboard equality and the existing exact visual readback gate. Record Tesseract attempts, Vision text/confidence/raw and mapped bounds, crop dimensions/scales, candidate geometry, selected source, and any errors in CI evidence.

**Acceptance:** the macOS round-trip exercises this fallback for the `Boards/Idea.canvas` Create-note field, completes field entry with exact clipboard and exact visual readback, and reaches C06 plus C07.2. Ubuntu and Windows continue to pass their round-trip workflows. All seven required workflows and 20 jobs pass on the exact repair SHA. Reference-app source rewrites remain identified as such. All executable validation runs only in GitHub Actions; local work is source inspection, editing, Git and evidence review only.

**Static review:** independent read-only reviews agree that this is a field-positioning failure after the R2.8.113 C06 repair. The focused Vision fallback must fail closed on zero, multiple, low-confidence, out-of-region or invalid candidates; it must not resolve existing Tesseract ambiguity or fuzzy candidates. Both reviewers approved bottom-left-origin coordinate conversion plus existing label geometry and recommended recording the fallback's actual use in the macOS artifact. No local executable validation was run.

R2.8.113 was pushed once to `origin/main`; its exact-SHA CI batch is fully terminal and not accepted. `origin/main` remains at `f87842ada8519af5b1ad5952625e855b9e921a23` while R2.8.114 is prepared locally. Accumulate the repair, evidence requirements and static review into one coherent milestone package, make one push only after it is ready, then hold that SHA until every required workflow is terminal. Do not trigger CI for intermediate edits.

### R2.8.114 local implementation and review

The round-trip audit now uses Apple Vision on the focused processed crop only when both macOS Tesseract passes produce zero candidates. A candidate must match the configured field value exactly after whitespace normalization, have confidence in `[0.80, 1.0]`, have finite positive bounds fully inside the normalized crop, and pass the existing label-relative field geometry filter; exactly one accepted candidate is required. Tesseract candidates, including approximate candidates that fail geometry, suppress the Vision fallback. No estimated-offset click is added. Vision's lower-left-origin bounds are mapped through the processed-to-raw crop scale, crop origin, and full-screen OCR scale. The report records the Vision source, image path, normalized and mapped bounds, confidence, per-candidate rejection reasons, and errors. The Tesseract source label now distinguishes the processed crop from the raw crop.

Two independent read-only static reviews approved the fallback, uniqueness/fail-closed behavior, coordinate conversion, and diagnostic fields. One reviewer recommended validating confidence range; the source now rejects confidence outside `[0,1]`. The R2.8.113 terminal failure, all seven exact-SHA runs, all job statuses, artifact digests, report hashes, screenshot/crop hashes, and macOS/Linux/Windows findings are recorded in `evidence/r2.8.113-attempt-1-f87842a.json`. Only progress JSON structure was parsed locally; no app tests, builds, OCR probes, formatters, typechecks, or lint were run. The R2.8.114 implementation and CI-ready acceptance package are complete locally; verify `origin/main` is still at the failed R2.8.113 SHA, then make one accumulated milestone push and hold that exact SHA through the full CI batch.

## R2.8.114 terminal result — accepted

At 2026-10-14T03:21:37Z, all seven required workflows and all 20 jobs for exact SHA `15ee500b04be9acef86a1b5fbf3d1e0ccb5bf7b7` are terminal and successful. The runs are inventory `38504639385`, quality `38504639275`, desktop build `38504639221`, plugin renderer `38504639229`, loaded plugin workflows `38504639400`, Rust CI `38504639365`, and Obsidian vault round-trip `38504639253`. Each run, job, artifact ID, size, archive digest, and report digest is recorded in `evidence/r2.8.114-attempt-1-15ee500.json`.

The macOS round-trip confirms both focused Tesseract passes returned zero candidates for the populated `Boards/Idea.canvas` field. Vision then matched the exact case-preserving value at confidence 1.0 with valid normalized crop bounds and the existing label geometry. The path readback was exact through clipboard and Vision visual recognition; the report also records that Tesseract did not produce an exact readback line. C06 reference reopen passed and C07.2 capture completed on Linux, macOS, and Windows.

C07.2 records `captured-reference-mutation`, including two source rewrite observations from pinned Obsidian. This is reference-app behavior and does not establish Rust source-preservation parity. Keep those findings separate from the Rust implementation acceptance.

R2.8.114 is accepted. No tests, builds, OCR probes, or application validation ran locally; CI artifacts and screenshots were reviewed read-only. The `goal.md` milestone gate already states that minor edits stay local and one accumulated push triggers CI only after a complete, reviewed milestone package; keep that cadence for the next R2 milestone.


## 2026-10-14 — C07.2 reconciled; R2.8.115 C07.3 characterization started

A read-only audit of the accepted R2.8.114 evidence and current Rust fixtures confirms C07.2 at exact source SHA `15ee500b04be9acef86a1b5fbf3d1e0ccb5bf7b7`. The fixture-backed Rust tests cover explicit ASC/DESC group and member-row ordering for JSON and native YAML and assert `encode_base` returns the exact source bytes; the four Rust CI jobs (Windows, Ubuntu, macOS, and Rust 1.95) passed. The Obsidian reference capture completed first-open/reopen on Linux, macOS, and Windows, and all seven workflows/20 jobs passed. The two source rewrites in the pinned app are recorded as reference behavior, not Rust preservation failures. `requirements.json` now records C07.2 as passing with exact-SHA evidence.

R2.8.115 is scoped as a reference-only C07.3 milestone. It will characterize pinned Obsidian 1.14.4 groupOrder behavior for JSON/native YAML, typed and colliding labels, group visibility/order, empty and duplicate declarations, null versus missing values, malformed fallback, groupOrder without groupBy, and the formula-derived Kanban case. The capture must verify exact active files, every group heading and member path, first-open/reopen state, and strict unchanged `.base`/note hashes across Linux, macOS, and Windows. Rust implementation is deferred until these observations exist. The milestone acceptance package requires all seven current workflows (20 jobs) on one exact SHA.

The goal cadence was clarified: minor changes accumulate locally; one push follows a complete, reviewed milestone, and `origin/main` remains at that SHA until the full CI batch is terminal. R2.8.115 has not been pushed and no CI run was requested. No local tests, builds, typechecks, formatters, lint, or runtime validation were run.

### R2.8.115 C07.3 reference-capture package ready for CI

The isolated probe and `fixture:c07-group-order-reference` now cover 14 JSON/native-YAML scenarios in a dedicated synthetic vault. It records exact active files, ordered group arrays (including duplicate rendered labels), member paths/order, visible errors/notices, stable state samples, screenshots, first-open/reopen comparisons, and strict `.base`/note SHA-256 checkpoints. Coverage includes order precedence, listed/unlisted and empty groups, empty lists, duplicate declarations, missing versus null values, typed labels, `groupOrder` without `groupBy`, malformed shapes, and the formula-dependent Kanban case. The round-trip workflow path filter includes the new fixture and inventory metadata records its digest.

JSON `1e999` and YAML `!!binary` are recorded as boundary candidates, not assumed unsupported. The custom YAML tag is only a parser-rejection probe. If neither candidate demonstrates app-level rejection after Obsidian loads the Bases view, unsupported-entry behavior remains unprobed and Rust C07.3 parity remains blocked. Independent read-only review found no blocking defects in the capture gates or workflow wiring. The milestone package is complete locally and awaits one accumulated push; no CI was requested and no local executable validation ran.

### R2.8.115 exact-SHA CI in progress

The reviewed package was committed and pushed once to `origin/main` as `30d0ad5de778dbeb36a7963cec78d39f391b0e59`; the push advanced from the accepted R2.8.114 SHA `15ee500b04be9acef86a1b5fbf3d1e0ccb5bf7b7`. The seven required runs are inventory `38508718956`, quality `38508718987`, desktop build `38508719004`, plugin renderer `38508718953`, loaded plugin workflows `38508718982`, Rust CI `38508718977`, and Obsidian vault round-trip `38508718974`.

At 2026-10-14T03:57:32Z, inventory, quality, desktop build, plugin renderer, and loaded plugin workflows were terminal and successful (13/20 jobs); Rust CI and the three-platform Obsidian round-trip were still running (7/20 jobs), with no failures reported. Keep `origin/main` at this exact SHA through terminal results. No local tests, builds, typechecks, formatting, lint, or runtime validation ran; executable validation is in GitHub Actions only.

## R2.8.115 terminal result — failed; R2.8.116 capture repair planned

At 2026-10-14T04:10:06Z, all seven required workflows and all 20 jobs for exact SHA `30d0ad5de778dbeb36a7963cec78d39f391b0e59` were terminal: 17 passed and three failed. Inventory, quality, desktop build, plugin renderer, loaded-plugin workflows, and all four Rust CI jobs passed. The three Obsidian round-trip jobs failed at C07.3; workflow/run, all job IDs/conclusions, artifact IDs/digests/sizes, per-platform report hashes, a representative screenshot hash for each OS, and the shared mismatch evidence are recorded in `evidence/r2.8.115-attempt-1-30d0ad5.json`.

All three platform reports show the same `first-open-yaml-empty-group-order-list` source-hash failure. Obsidian changed generated `Bases/02 JSON precedence.base` from 276 bytes / SHA-256 `7b36ee037f578caa4029dd25ff7acaa9fd338e423ae83198729201b589ccb010` to 181 bytes / SHA-256 `8a2f3fa8780feb58e05af822ba5f85098949a7167808c63c215eff14b312128c`. Each report also says renderer evaluation returned no JSON value (`Uncaught`). Only the first three of 14 scenarios have first-open records, no reopen scenario was captured, and structured selection/group data is absent. Screenshots visibly show YAML Alpha then Zulu, JSON Zulu then Alpha, and zero rows for the empty YAML order list; these remain visual-only evidence. The archives include original seeds and hashes but not the rewritten bytes, so the exact rewrite is unresolved. Do not claim C07.3 behavior or Rust parity from this attempt; `requirements.json` keeps C07.3 pending and links this failed evidence.

R2.8.116 is planned as one focused cross-platform capture-repair milestone. It will capture and retain original and post-open/reopen source bytes and hashes without aborting on a pinned-app rewrite, isolate scenario source state, return actionable DevTools exception details, and capture exact selection, loaded/error surface, ordered headings, row membership, and first-open/reopen results for all 14 scenarios on Linux, macOS, and Windows. JSON `1e999` and YAML `!!binary` remain exploratory candidates; no app-level unsupported-entry behavior will be claimed without visible rejection from a loaded Bases view. Rust source-preservation requirements remain unchanged. Push one accumulated R2.8.116 batch only after the complete, reviewed package is ready, then hold its exact SHA until all required CI jobs are terminal.

Per user direction, the definition of done in `goal.md` now says small implementation commits may accumulate locally and reach `origin/main` only in a completed milestone batch. This doc clarification remains local for the next coherent milestone push. No local tests, builds, typechecks, formatting, lint, or runtime validation ran; only GitHub CI artifacts and screenshots were inspected.

## 2026-10-14 — R2.8.116 capture repair in progress

R2.8.116 remains local after the terminal R2.8.115 failure on `30d0ad5de778dbeb36a7963cec78d39f391b0e59`. C07.3 now prepares a separate copy of the complete synthetic vault for each scenario and uses a separate Obsidian profile, preserving identical membership while preventing one scenario's writes from contaminating another. Prior isolated vault/profile roots are removed before fixture generation. The capture records source paths, byte lengths, hashes, and exact changed/new bytes; after first-open shutdown it restores the original seed and verifies it before reopen. CDP failures retain exception/stack diagnostics, an independent minimal renderer-state probe, and a labeled retry while the primary failure remains acceptance-failing. Fixture setup now rejects anything other than 14 unique, path-safe scenario IDs. Fixture and artifact paths are resolved beneath their destination roots, and seed paths use collision-safe UTF-8 hex names. The terminal summary distinguishes pinned-app source mutation from source-hash preservation so it does not report an undefined C07.3 field. The C07.3 requirement now explicitly treats any pinned-app rewrite as reference evidence while retaining strict exact-byte preservation for Rust.

Updated `goal.md` to define a milestone as a coherent deliverable with meaningful acceptance criteria, explicitly excluding a single commit, file change, minor fix, or cleanup item as a CI milestone. Related small tasks accumulate locally; exactly one accumulated `origin/main` push triggers CI after the milestone package is complete and reviewed. The submitted SHA remains unchanged until the several-hour CI batch is terminal and reconciled. The goal clarification is part of the local R2.8.116 batch, not a standalone push. `state.json` now records R2.8.116 in progress and reconciles the remote tip at `30d0ad5…`.

No root local tests, builds, typechecks, formatter, lint, or runtime validation ran. A read-only reviewer inadvertently ran `git diff --check`; this was local whitespace inspection only and provides no CI acceptance evidence. Complete remaining source review and the progress/evidence package before the one R2.8.116 milestone push.

### R2.8.116 review follow-up — source and renderer evidence hardening

Independent static reviews found that C07.3 could omit visible links that did not map to fixture paths, silently treat a source symlink/type replacement as merely missing, reseed through a symlink ancestor, and report hardcoded vault paths that might not match the configured work directory. The local repair now records source-like regular files, symlinks, directories and other entries by kind; saves exact regular-file bytes and symlink target bytes; writes a full directory-subtree manifest with exact descendant file/link artifacts; leaves special filesystem entries explicitly incomplete; distinguishes a truly absent source path from a present type change; and requires complete evidence for every observed change. Reseeding removes source symlinks and path obstructions without following them, verifies destination ancestors before source reads/writes, and confirms the exact seed after restoration. Source snapshots also guard the isolated vault path beneath the configured work directory.

Renderer extraction now retains visible path-link candidates and data rows that cannot map uniquely to a fixture path, rejects ambiguous basename/stem aliases, absolute-like candidates and traversal paths, and includes these candidates in settling and first-open/reopen acceptance. Every loaded scenario, including both empty-order-list cases, must expose at least one mapped fixture path unless it displays an explicit visible error. The report records that membership is the pinned app's observed rendering; there is no independent oracle for a note omitted entirely from the UI. Table scope requires an actual table ancestor. The affected renderer path no longer uses `Array.prototype.at` or `String.prototype.replaceAll`, the duplicate state-sample field was removed, and the C07.3 report names the scenario container separately from opened scenario vaults.

The source-observation gate now requires exactly ten named checkpoints for each of 14 scenarios (140 total), rejecting missing, duplicate and unexpected pairs. `snapshotTree` classifies entries from `lstat` metadata and verifies directory type again before recursion. The UI review found that an informational notice containing only “YAML” or “JSON” could be mistaken for an error; the classifier now requires a visible error/alert surface or error-specific notice/body wording. The latest read-only reviews also confirmed the subtree and special-entry evidence gates; no local tests or executable validation ran.

The final independent static reviews found no remaining blocker. They confirmed the 14×10 checkpoint matrix, path and row ambiguity gates, accurate scenario/container path reporting, and the informational-notice error classifier. The reviewers also confirmed that membership is reported as observed output with the omission limitation stated. One narrow filesystem race remains between `lstat` and later file/directory operations; it was judged non-blocking for this CI capture workflow. R2.8.116 is ready as one accumulated milestone package; verify the remote main SHA immediately before its single push and hold that SHA through all required workflows. No local executable validation ran.

R2.8.116 was committed and pushed once to `origin/main` at `f1dc5405fc720801d198f747499c1284dde1a034`. The seven required workflows are inventory `38513414259`, quality `38513414257`, desktop build `38513414279`, plugin renderer `38513414307`, loaded plugin workflows `38513414258`, Rust CI `38513414268`, and Obsidian vault round-trip `38513414260`. At 2026-10-14T04:50:43Z, inventory had passed and the other six workflows were in progress. Across all 20 jobs, 7 had succeeded, 13 were in progress, and none were queued or failed. Keep this SHA fixed until all required jobs are terminal and their artifacts/results are reconciled. No local executable validation ran.

At 2026-10-14T04:51:40Z, five workflows were complete and successful: inventory, quality, desktop build, plugin renderer, and loaded plugin workflows. The 13 jobs in those workflows passed. Rust CI's four jobs and the three Obsidian round-trip jobs were still in progress; no job had failed or remained queued. Continue to hold `origin/main` at the submitted SHA.

At 2026-10-14T04:54:06Z, both Linux and macOS Rust CI jobs also passed. Across the full batch, 15/20 jobs had succeeded and five were still running: Rust CI Windows and MSRV, plus the Windows, Ubuntu, and macOS round-trip captures. No failures or queued jobs were reported.

At 2026-10-14T04:55:41Z, the Windows Obsidian round-trip job had failed while Ubuntu/macOS round-trip and the Windows/MSRV Rust jobs remained in progress. The other 15 jobs had succeeded; none were queued. GitHub reports the failed-job logs unavailable until the round-trip workflow is terminal. Do not prepare or push a repair until every required workflow finishes and the failure evidence is readable.

The Windows round-trip artifact is available: artifact `11871165497`, 5,329,057 bytes, digest `sha256:5d249fe892735350200565eea1e50e1ee9805a70f9b50ea9153e612b37f1acd8`, [download](https://github.com/ashutoshpw/open-obsidian/actions/runs/38513414260/artifacts/11871165497). Its report records a timeout waiting for OpenObsidian to close the externally edited note preview, so C07.3 was not reached on Windows. The required workflow has not yet become terminal; read the final logs and other platform artifacts before classifying or rerunning this failure.

Read-only Rust parity review while CI runs found that current Rust support remains at C07.2: `groupOrder` is ignored, typed identity is not exposed, missing and explicit-null grouping values are merged, and the C07.3 fixture is not used by Rust tests. The formula-derived Kanban dependency case is also unsupported by the current view/formula model. These implementation gaps are independent of the pending CI; exact behavior for duplicate declarations, typed labels/equality, malformed fallback, and unsupported entries still depends on successful pinned-app C07.3 observations. Keep Rust C07.3 parity pending until those observations are available.

The goal's CI rule now states directly that minor changes remain local and do not each trigger CI. One accumulated push to `origin/main` follows a complete, reviewed named milestone; “ready for CI” means implementation-complete, and milestone achievement requires all required jobs passing for the exact pushed SHA. The R2.8.116 policy clarification stays in its single accumulated repair batch. No local tests, builds, typechecks, formatting, lint or runtime validation ran.

At 2026-10-14T05:00:30Z, the Windows Rust CI job also passed. The batch now has 16/20 jobs passed, one Windows round-trip failure, and three jobs in progress: Rust MSRV plus Ubuntu/macOS round-trip. Read-only review of the Windows round-trip artifact confirms the exact `After refresh.md` radio selection succeeded, but the selector popup remained visibly open over the note preview; the subsequent `Close source preview` UIA call reported `InvokePattern.Invoke` without closing it. The popup is the strongest supported failure cause, though the screenshot alone cannot prove it blocked the invocation.

Prepared a local, unpushed repair in `audit-obsidian-vault-roundtrip.ts`: on Windows, require the exact `SelectionItemPattern.Select` result, then reuse the existing Escape-based selector dismissal helper and fail unless the selected option is no longer visible. This runs before note-preview read/edit/close actions and follows the already-used Windows embed-selection path. Two independent read-only reviews found it localized and consistent with that helper; no tests, build, formatting, lint, runtime validation or new CI run was performed. Keep the repair local until all seven R2.8.116 workflows are terminal and their results are reconciled.

At 2026-10-14T05:01:34Z, R2.8.116 Rust CI completed successfully on all four jobs: Ubuntu, macOS, Windows and MSRV 1.95. Six of seven workflows are now terminal and successful; the only active workflow is Obsidian round-trip acceptance, with Ubuntu/macOS jobs still running. Across 20 jobs, 17 passed, one Windows round-trip job failed, and two round-trip jobs remain in progress. Continue holding `origin/main` at `f1dc5405fc720801d198f747499c1284dde1a034` until the round-trip workflow and all artifacts are reconciled.

## 2026-10-14 — R2.8.116 exact-SHA terminal result; R2.8.117 repair underway

Read-only GitHub reconciliation at 2026-10-14T05:25:54Z confirms all seven workflows and all 20 jobs for `f1dc5405fc720801d198f747499c1284dde1a034` are terminal. Six workflows passed; Obsidian vault round-trip acceptance failed all three platform jobs (17 passed, 3 failed overall). The remote `origin/main` remains at the submitted SHA. Exact workflow/job IDs, URLs, artifact IDs, archive digests, report SHA-256 values, expiry times, and failure classification are recorded in `evidence/r2.8.116-attempt-1-f1dc540.json`.

Linux and macOS each produced 14 incomplete first-open and 14 incomplete reopen C07.3 observations after the generated renderer raised `ReferenceError: scenario is not defined`; the minimal state probe still showed the requested Bases view loaded. Each completed its 140-entry source-checkpoint matrix. Their Kanban observations retained 14 unmapped row/card candidates per stage. Windows timed out before C07.3 while the exact-selected note-selector popup remained open during external-note preview close. C07.3 remains pending, and no groupOrder parity claim is supported.

R2.8.117 is being prepared as one coherent capture repair: fix the renderer expression, map the actual Kanban card/column structure without allowing unrelated errors to bypass extraction gates, and fail closed on Windows selector UIA read errors while requiring the selector to remain observable through closure confirmation. Static review is continuing. The milestone remains local and unpushed until its full acceptance package is complete; no local tests, builds, formatters, lint, or runtime validation ran.

## 2026-10-14 — R2.8.116 exact-SHA terminal result; R2.8.117 repair underway

Read-only GitHub reconciliation at 2026-10-14T05:25:54Z confirms all seven workflows and all 20 jobs for `f1dc5405fc720801d198f747499c1284dde1a034` are terminal. Six workflows passed; Obsidian vault round-trip acceptance failed all three platform jobs (17 passed, 3 failed overall). The remote `origin/main` remains at the submitted SHA. Exact workflow/job IDs, URLs, artifact IDs, archive digests, report SHA-256 values, expiry times, and failure classification are recorded in `evidence/r2.8.116-attempt-1-f1dc540.json`.

Linux and macOS each produced 14 incomplete first-open and 14 incomplete reopen C07.3 observations after the generated renderer raised `ReferenceError: scenario is not defined`; the minimal state probe still showed the requested Bases view loaded. Each completed its 140-entry source-checkpoint matrix. Their Kanban observations retained 14 unmapped row/card candidates per stage. Windows timed out before C07.3 while the exact-selected note-selector popup remained open during external-note preview close. C07.3 remains pending, and no groupOrder parity claim is supported.

R2.8.117 is being prepared as one coherent capture repair: fix the renderer expression, map the actual Kanban card/column structure without allowing unrelated global errors to bypass extraction gates, and fail closed on Windows selector UIA read errors while requiring the selector to remain observable through closure confirmation. The state record now tracks R2.8.116 as not accepted and R2.8.117 as the active local milestone. The batch remains unpushed until its static review and full CI-ready acceptance package are complete; no local tests, builds, formatters, lint, or runtime validation ran.

## 2026-10-14 — CI milestone push cadence clarified

Clarified `goal.md` so a named milestone is the unit of CI submission: focused commits and related minor fixes accumulate locally, then the complete, reviewed milestone is pushed once to `origin/main` with its acceptance package. Each push starts the required CI batch, which may take several hours; no minor-change pushes are used for incremental feedback, and `origin/main` stays at the submitted SHA until all required workflows are terminal. The milestone is ready for CI at push time and is achieved only after all required jobs pass for that exact SHA and results are reconciled. Repairs follow the same named-milestone cadence. Updated `requirements.json`'s `goal_sha256` to `71bbc3331716760e94c54de5287bfa993c666e4a7582ccfe11c6c1c42f4908ff`. This clarification does not advance or authorize a push for active R2.8.117; no local executable validation ran.

## 2026-10-14 — R2.8.117 static-review hardening

Independent static review found that Windows UI Automation read exceptions were swallowed during the before/after selector scans, allowing an unreadable radio to be treated as absent, and the selector's reported visibility only established process-tree presence. The helper now aborts on any descendant read error, requires exactly one `Note to inspect` button, reads and reports `IsOffscreen` before and after dismissal, and accepts only a non-offscreen button with three stable empty path-radio scans. Exact selection, supported `ExpandCollapsePattern` state, and the process-wide path-radio scope remain explicit in the report and acceptance. A process-wide scan may fail if another visible note-path radio exists; no current-fixture evidence shows one, so this remains a documented false-failure limitation.

The renderer's empty-error exception now requires a scenario-declared `expected_error_outcome` plus a 20-character `expected_error_text` containing a `groupBy`/`groupOrder` term and word-bounded failure wording. The phrase must appear in painted active-view error text or in a painted notice associated with the requested `.base` or scenario. The checked-in 14-scenario fixture declares no expected-error outcomes, so these cases remain fail-closed. The R2.8.116 source, renderer, and Windows findings were reviewed by independent read-only agents; the remaining process-wide radio-scan and discrete painted-text sampling limits are recorded for exact-SHA CI interpretation. `state.json` now records R2.8.116's terminal 17/20 result and R2.8.117's current acceptance. R2.8.117 remains local and unpushed pending final package reconciliation; no local executable validation ran.

## 2026-10-14 — CI push gate made explicit

Made `goal.md` explicit that minor edits and focused commits stay local, and a single push to `origin/main` submits one complete named milestone for its full CI batch. Because the suite may take several hours, there is no push-for-incremental-feedback exception. The progress record distinguishes implementation-complete/CI-pending at submission from achieved after all required exact-SHA CI passes and evidence reconciliation. The same rule applies to grouped repairs after the prior batch is terminal. Updated `requirements.json`'s `goal_sha256` to `b21090ed02e77dc0bc25f228b394403328adfc9fed81d0bf74b25d23eafff31b`; the R2.8.117 evidence path and independent static review outcomes are recorded in `state.json`. No local executable validation ran.

## 2026-10-14 — R2.8.117 submitted for exact-SHA CI

Pushed the complete R2.8.117 milestone once to `origin/main` as `fd1d449e9523b4272fe8f8de84413a976bf4c22a`, whose parent was the terminal R2.8.116 SHA `f1dc5405fc720801d198f747499c1284dde1a034`. GitHub created all seven required push workflows: [inventory](https://github.com/ashutoshpw/open-obsidian/actions/runs/38519463974), [quality](https://github.com/ashutoshpw/open-obsidian/actions/runs/38519463962), [desktop build](https://github.com/ashutoshpw/open-obsidian/actions/runs/38519463838), [plugin renderer](https://github.com/ashutoshpw/open-obsidian/actions/runs/38519464078), [loaded plugin workflows](https://github.com/ashutoshpw/open-obsidian/actions/runs/38519463956), [Rust CI](https://github.com/ashutoshpw/open-obsidian/actions/runs/38519463950), and [vault round-trip](https://github.com/ashutoshpw/open-obsidian/actions/runs/38519464076). At 05:58:39 UTC, inventory and plugin renderer had passed; 9/20 jobs were successful, 11 were in progress, and no job or workflow had failed. Exact run/job IDs and status snapshots are recorded in `state.json`. Keep `origin/main` at this SHA until every required job is terminal; artifact and final evidence reconciliation remain pending. No local executable validation ran.

At 06:01:48 UTC, the Windows round-trip job failed while the round-trip workflow's Ubuntu and macOS jobs and all four Rust CI jobs were still running. Its uploaded Windows artifact (`11873421594`, SHA-256 `ac540398704accec90b78736a9cc08d5243914e27c94f5e32cc98cb96c64a870`) contains a PowerShell `ParserError`: two `if` conditions in `dismissWindowsNoteSelectorMenu` place `-and` at the start of a new line, which the parser treats as a new statement. `gh run view --log-failed` confirmed complete logs remain unavailable until the workflow is terminal. Prepared a local-only correction by flattening the condition and factoring the fallback condition into simple booleans. A read-only static re-review is pending; no tests or executable validation ran. Keep the repair unpushed until all seven workflows and 20 jobs for `fd1d449e9523b4272fe8f8de84413a976bf4c22a` are terminal.

At 06:03:32 UTC, five workflows and 15/20 jobs had succeeded, one Windows round-trip job had failed, and four jobs remained in progress; there were no queued jobs. A second static review confirmed the local condition rewrite removes the newline-before-`-and` parser issue, preserves its intended logic, and exposes no other visible PowerShell parser/control-flow defect. The local repair remains unpushed while the Rust CI and round-trip workflows complete.

At 06:04:42 UTC, five workflows and 16/20 jobs had succeeded. The Windows round-trip job remained the sole failure; Rust 1.95 and the Ubuntu/macOS round-trip jobs were still in progress. No additional workflow or job failure was reported, and the prepared repair remained local.

At 06:08:12 UTC, six workflows and 17/20 jobs had succeeded. Rust CI passed; the Windows round-trip failure remained, and Ubuntu/macOS round-trip jobs were still in progress. Committed the parser-safe Windows helper correction locally as `750b5a16f8f5354e36736fd3b5d194fba40fead7`; `origin/main` remains at `fd1d449e9523b4272fe8f8de84413a976bf4c22a`. The local repair awaits the current batch's terminal result before any push.

At 06:14:14 UTC, the Ubuntu round-trip job had also failed while macOS remained in progress; 17/20 jobs had passed, two had failed, and one remained active. The Linux artifact shows all 14 table scenarios mapped the expected fixture groups and notes, but the generic `.bases-tr` header wrapper containing visible “file name” was also classified as an unmapped data row. Added `.bases-table-header` to the descendant header selector as a local correction; independent static review is pending. The Windows parser repair commit and this table-header correction both remain unpushed until the full SHA batch is terminal. The Linux artifact ID, digest, and URL are recorded in `state.json`.


## 2026-10-14 — R2.8.117 exact-SHA terminal result

Read-only GitHub reconciliation at 06:52 UTC confirms all seven workflows and all 20 jobs for fd1d449e9523b4272fe8f8de84413a976bf4c22a are terminal: six workflows passed and the round-trip workflow failed all three platform jobs (17/20 jobs passed). Linux rejected the 14 C07.3 first-open/reopen scenarios because the visible file name header was classified as an unmapped row; its source-checkpoint matrix completed 140/140. macOS had the same header issue, unmapped formula-derived Kanban cards/counts, and a typed-values renderer/reopen trust-screen timeout; its matrix recorded 135/140 entries. Windows stopped before C07.3 with PowerShell parser errors in the selector-dismissal helper. C07.3 remains pending, with no Rust parity or full-fixture membership claim. Run/job IDs, artifact archive digests, report hashes and platform details are in [the R2.8.117 evidence record](evidence/r2.8.117-attempt-1-fd1d449.json). No local executable validation ran.

## 2026-10-14 — R2.8.118 visible-result repair started

Started R2.8.118 from the terminal R2.8.117 SHA. The repair will bind each displayed result count to the active result container, re-query and preserve path identity while scrolling, and require the number of unique mapped visible paths to equal the displayed count. Zero results are observations only for the two exact empty groupOrder-list cases and the source-guarded YAML binary candidate; those results do not imply unsupported semantics. The milestone also covers the Windows selector parser failure and macOS picker closure plus canonical vault-path evidence. Keep origin/main at the submitted R2.8.117 SHA until the complete R2.8.118 package is reviewed, then push once for its full exact-SHA CI batch. Reference membership remains observed UI behavior, with no full-fixture oracle or Rust parity claim.

Clarified the migration cadence again in `goal.md`: minor changes and focused commits accumulate locally; a named milestone is pushed once after its implementation and CI-ready acceptance package are complete and reviewed; its status remains CI-pending until all required jobs pass for that exact SHA. The remote stays at one submitted SHA until its full, potentially several-hour CI batch is terminal. Updated MIG-002's source clause and acceptance in `requirements.json` to match, and refreshed its `goal_sha256` to `91a6fe3d8a1d83843449b516cfff24effa223b648917542918d9f1a425f4cf9e`. This is documentation/progress-record alignment within the local R2.8.118 package, not a separate CI milestone or push. No local executable validation ran.

At 07:31 UTC, the final independent static review approved R2.8.118's exact Windows baseline-HWND preservation and recorded after-close inventory. The complete static package review also covers scroll/requery identity, unique path/count reconciliation, the exact source-guarded zero-result allowlist, YAML view-block scoping, and exact-SHA CI evidence requirements. `state.json` records the review as passed and preserves the result-count selector limitation: exact `N result(s)` text is associated by active-container structure and visibility, rather than a count-specific selector. R2.8.118 is implementation-complete and ready for its single milestone push after confirming the remote tip; the milestone remains unachieved until all required exact-SHA CI jobs pass. No local tests, builds, formatter, lint, typecheck, runtime probe, or application launch ran.

Pushed R2.8.118 once to `origin/main` at `5ab14b51f306deccb2377c46470435ee628ed004`; this push included the accumulated local PowerShell parser repair and the reviewed visible-result/picker repair. All seven expected workflows were created for that exact SHA: [desktop build](https://github.com/ashutoshpw/open-obsidian/actions/runs/38528980059), [loaded plugin workflows](https://github.com/ashutoshpw/open-obsidian/actions/runs/38528979834), [plugin renderer](https://github.com/ashutoshpw/open-obsidian/actions/runs/38528979856), [quality](https://github.com/ashutoshpw/open-obsidian/actions/runs/38528979829), [vault round-trip](https://github.com/ashutoshpw/open-obsidian/actions/runs/38528979891), [Rust CI](https://github.com/ashutoshpw/open-obsidian/actions/runs/38528979839), and [inventory](https://github.com/ashutoshpw/open-obsidian/actions/runs/38528979883). At 07:33 UTC, inventory had passed; the other six workflows were in progress. Four of 20 jobs had succeeded, 16 were in progress, and none were queued or failed. Exact workflow/job IDs and the snapshot are in `state.json`. Keep origin/main fixed at this SHA until all seven workflows and 20 jobs are terminal and reconciled. No local executable validation ran.

At 07:34:11 UTC, desktop build, loaded-plugin workflows, plugin renderer, quality, and migration inventory had passed. Rust CI and vault round-trip remained in progress; 13/20 jobs had succeeded and seven were active, with no failures or queued jobs. The updated snapshot is in `state.json`; keep the submitted SHA fixed.

At 07:37:49 UTC, macOS round-trip job `115735985728` failed before path entry while the other five pending jobs continued; 14/20 jobs had passed, one failed, and five remained active. Its artifact (`11876579650`, SHA-256 `83062a59a0d35bc42005eeb2692639c19d69db88659778c73650081aa423a72f`) reports `AXWindow:Open folder as vaultAXWindow:Obsidian` while waiting for the native Open panel. The uploaded initial screenshot shows the first-run page without a visible picker; report SHA-256 is `0a5611ad7be07f371e70a69609f69aad6621aa1cadb59f993c653df77a6b63e8`, and screenshot SHA-256 is `91533071be91eb378de810651f9d1e30c5cfa3ec321b38e14e7f077dcb2cb909`. This is a partial failure only; hold the exact SHA until all remaining workflows/jobs are terminal. The report and snapshot details are recorded in `state.json`.

At 07:40:56 UTC, the Windows round-trip job `115735985739` also failed in `select_folder` with a PowerShell ParserError caused by `-or` at the start of continued condition lines. The focused local repair factors the conditions into same-line booleans; a read-only reviewer approved its syntax/control flow. Its artifact (`11877446390`, SHA-256 `d052be9743c005427ef3c0056fc574d0e7e90c0b524a6f9b0dc214daec1dd392`) and report hash are recorded in `state.json`. A separate static review found the macOS click status was recorded after a fire-and-forget synthetic DOM click and the accessibility inventory concatenated window identities without separators; the artifact does not confirm that a native picker appeared. Treat the synthetic-click diagnosis as an inference. Prepare a fail-closed macOS repair using trusted visible control activation and structured accessibility evidence, while keeping path entry blocked until a chooser is confirmed. The other three jobs are still running; keep `origin/main` at the submitted SHA until all 20 are terminal.

At 07:50:15 UTC, six of seven workflows and 17/20 jobs for R2.8.118 had passed. macOS job `115735985728` and Windows job `115735985739` remain failed; Ubuntu job `115735985544` is still running. The four-job Rust CI workflow, including the minimum supported Rust job, has now passed. The Windows PowerShell parser correction remains local. The macOS chooser now records a baseline inventory, dispatches a trusted accessibility click to the unique enabled first-run Open control, waits for exactly one newly added panel identity, and requires screenshot OCR plus a matching inventory before path entry. It targets that exact panel for the Open action and confirms its disappearance against the baseline; the acceptance text now requires this evidence. An independent static re-review is pending. Updated the status snapshot; do not push while the Ubuntu job is active. No local tests, builds, formatting, lint, runtime probes, or application launches ran.

At 07:54 UTC, independent static reviews found the role/name multiset could mistake a same-titled window for the selected panel or its disappearance. The macOS inventory and selector now include panel bounds and, for sheets, parent-window role/name/bounds; the same recorded identity must be re-established before path entry, before the Open action, and absent from the after-close inventory. The R2.8.118 acceptance now names these identity fields and requires fail-closed behavior if they are not unique. `origin/main` was verified still at `5ab14b51f306deccb2377c46470435ee628ed004`; the Ubuntu round-trip job was still active at the last status poll. A second independent read-only review is pending. No local executable validation ran.

## 2026-10-14 — R2.8.118 reconciled; R2.8.119 repair package in review

The milestone cadence in `goal.md` now requires one push to `origin/main` only after a named milestone's complete implementation and reviewed acceptance package are ready. Minor edits and focused commits stay local; the full required CI batch runs on one exact SHA and may take several hours. `requirements.json` MIG-002 references goal SHA-256 `5435f3de75c7fb4b9dfec6d3d87f4529fc17a9d8165af2b48280993c1673f56e`.

Read-only GitHub reconciliation confirmed R2.8.118 at exact SHA `5ab14b51f306deccb2377c46470435ee628ed004` is terminal: six of seven workflows and 17 of 20 jobs passed, while the Ubuntu, macOS, and Windows vault round-trip jobs failed. The exact workflow/job results, artifact URLs/digests, report hashes, and platform failure details are recorded in `evidence/r2.8.118-attempt-1-5ab14b5.json`; `origin/main` remains at this SHA. C07.3 is still pending.

Defined R2.8.119 as one local repair milestone for awaited Ubuntu renderer JSON, the Windows PowerShell parser failure, and fail-closed macOS picker activation/selection/cancellation. The macOS gates now require a pre-open inventory, exactly one new role/name/bounds/parent identity, readable nonzero-size inventories, nonempty screenshot OCR without a visible chooser, and three consecutive accessible snapshots with no matching/new panel after Open or Escape. Independent static source review found no concrete fail-open in these closure gates; it records the correlated OCR/accessibility omission and identical-fingerprint limits. The full package review is pending. No local tests, builds, formatter, lint, typecheck, runtime probe, or application launch ran; a read-only `git diff --check` was the only local check.

At 08:19 UTC, sharpened `goal.md`'s CI submission rule: minor edits and intermediate commits stay local; one push submits a complete, reviewed named milestone; the remote remains fixed until that milestone's full CI batch is terminal, with the status changing to achieved only after exact-SHA passes. The suite may take several hours, so no partial pushes are used for incremental feedback. `requirements.json` MIG-002 now points to goal SHA-256 `ca8a8036b4e11fab01c89e4a4be9560034afeb787fe653c01d72d49046533d15` while retaining the previous hash as a historical version. No local executable validation ran.

At 08:22 UTC, the final independent static review approved the newest R2.8.119 change: the raw fresh accessibility inventory is saved before parsing and retained in the failure report if parsing or identity checks fail. It confirmed the panel identity gates remain fail-closed and the existing Open/cancel error evidence and three closure snapshots are preserved. The reviewer also confirmed the updated goal cadence is coherent. `state.json` now records package review as passed; no tests or executable validation ran.

Pushed R2.8.119 once to `origin/main` at exact SHA `2a18016de043ea8ec82529fe4abb4912d439efa2`. All seven expected workflows appeared for that SHA. At 08:22:38 UTC, the Rust migration inventory workflow and Ubuntu plugin-renderer job had passed; 17 jobs were in progress, one was queued, and none had failed. The seven workflow IDs/URLs, 20 job IDs, and initial exact-SHA snapshot are in `evidence/r2.8.119-attempt-1-2a18016.json` and `state.json`. Keep `origin/main` at this SHA until every required job is terminal. No local executable validation ran; a read-only `git diff --check` was the only local check.

At 08:24:01 UTC, read-only GitHub reconciliation showed five of seven workflows and 13 of 20 jobs passed: desktop build, loaded plugin workflows, plugin renderer, quality, and inventory. Rust CI and vault round-trip remain in progress with seven jobs active; no failures or queued jobs are reported. Updated the attempt evidence and snapshot history. Keep `origin/main` fixed at `2a18016de043ea8ec82529fe4abb4912d439efa2` until terminal.

At 08:31:24 UTC, exact-SHA reconciliation showed five workflows passed and 16 of 20 jobs passed; Windows and macOS vault round-trip jobs failed, while Ubuntu round-trip and Windows Rust CI remained active. The failed artifacts show the first-run macOS Open CTA and Windows Select Folder control visibly present, while their respective accessibility providers omit the target controls. The attempt evidence now records current run/job URLs, statuses, artifact digests, report hashes, screenshot hashes, and both partial failure summaries. Read-only reviews recommend a macOS fallback that requires the unique OCR Open label to the right of the exact Open folder as vault row, and a Windows fallback that enumerates a unique visible/enabled exact-caption Win32 Button under the recorded dialog and sends BM_CLICK to that child handle. Keep `origin/main` at `2a18016de043ea8ec82529fe4abb4912d439efa2` until every required job is terminal. No local executable validation ran.

At 08:38:51 UTC, the Rust CI workflow completed successfully on Ubuntu, macOS, Windows, and Rust 1.95. Six workflows and 17 of 20 jobs now pass; the two picker round-trip failures remain partial because Ubuntu round-trip is still active. The exact-SHA evidence and job URL lists are updated. The macOS OCR-row fallback and Windows exact Win32-child fallback are being prepared locally for one repair milestone; no push is allowed until the last required job is terminal and the full batch is reconciled. No local executable validation ran.

At 08:42:37 UTC, the R2.8.119 exact-SHA batch still has six of seven workflows and 17 of 20 jobs passing; Windows and macOS round-trip jobs failed, and Ubuntu round-trip remains active. The Windows reviewer confirmed bounded Unicode `WM_GETTEXT` via `SendMessageTimeoutW` addresses cross-process child captions, then recommended rejecting a full caption buffer and making the W entry point exact; both hardenings are applied locally. The macOS reviewer approved confidence >= 0.8, strict left-edge placement to the right of the exact row title, <=0.04 vertical center delta, and screenshot capture before OCR. OCR and display-metric exceptions now also get explicit failure statuses in the report. The cadence in `goal.md` now states directly that minor edits never trigger individual pushes or fresh CI batches; it was cross-referenced in MIG-002 with goal SHA-256 `72ffa528debfde44753d1228729f5e70848cd6bb831a776801163b30ada1a7ec`. Keep the repair edits local until the current batch is terminal, then package them as one reviewed milestone and push once. No local executable validation ran; `git diff --check` is the only local code check.

## 2026-10-14 — R2.8.119 terminal failure; R2.8.120 planned

Final read-only reconciliation at 08:48:51 UTC confirms all seven required workflows and 20 jobs are terminal for exact SHA `2a18016de043ea8ec82529fe4abb4912d439efa2`; six workflows and 17 jobs passed, while the Linux, macOS, and Windows vault round-trip jobs failed. `origin/main` remains at the submitted SHA. Run/job URLs and statuses are preserved in the attempt evidence and `state.json`. No CI batch remains active.

The Linux report (`report_sha256=5f7eda16d9e33225eef345a16c6e5e3faf9fce3eb00ed20d5b4579ec84c88ae7`) shows the C01.2 authoring/reopen round-trip and C07.3 source-preservation recording passed, but C07.3 failed all 14 scenarios. Visible grouped tables contain multiple per-group `.bases-table` elements, which the selector treated as competing view roots; count scoping then failed. Typed-table rows and Kanban cards were also reported unmapped, and several reopen captures timed out. The artifact has an 19,198,296-byte archive digest recorded in `evidence/r2.8.119-attempt-1-2a18016.json`; representative screenshots corroborate the visible rows and result counts.

R2.8.120 is now planned as one coherent repair for grouped-table root/count selection, typed-row/Kanban path mapping, and the macOS/Windows native picker activation failures. Two read-only reviews approved the local macOS and Windows changes. The Linux extractor review is pending. Keep all corrections local, complete and review the entire acceptance package, then submit this milestone once to `origin/main`. The CI cadence clarification in `goal.md` and MIG-002 is recorded with goal SHA-256 `72ffa528debfde44753d1228729f5e70848cd6bb831a776801163b30ada1a7ec`. No local executable validation ran.


## 2026-10-14 — R2.8.120 repair implementation in progress

Two independent read-only subagent audits confirmed that the terminal Ubuntu report shows per-group `.bases-table` children under one `.bases-table-container`, and that the reopen timeout occurs before extraction while the exact requested `.base` is already active. The audits found no static explanation for the Kanban mapper discrepancy: 104/104 sampled card titles were unmapped even though each title matches one unique seeded note stem. I am keeping that cause unclaimed and added direct unique path matching plus match diagnostics.

Locally updated the capture source to use a unique visible table container only when it owns every visible table root; preserve the existing count and ambiguity gates. Added an exact-path/Bases-view check before reopen explorer selection, with first-open continuing through the visible tree. The macOS OCR fallback now describes mouse-event dispatch and leaves picker identity/OCR as the confirmation step. The malformed Linux artifact name and stale terminal/next-action state entries were reconciled. The current goal policy remains one push after a complete named, reviewed milestone and full exact-SHA CI batch; `origin/main` remains at `2a18016de043ea8ec82529feabb4912d439efa2`.

R2.8.120 remains local pending final read-only review of the combined source and acceptance package. No executable validation ran; static `git diff --check` is the only local check.

At 09:06:30 UTC, pushed R2.8.120 once to `origin/main` at exact SHA `985af8aa18be53c285221b2ed21d4062e69b9f3d`. The initial exact-SHA snapshot at 09:07:49 UTC found all seven required workflows: Rust migration inventory passed; round-trip, quality, Rust CI, desktop build and plugin-renderer matrix were in progress; loaded-plugin workflows were queued. One of 20 jobs passed, 18 were in progress, one was queued, and none had failed. Workflow/job IDs and URLs are in `evidence/r2.8.120-attempt-1-985af8a.json` and `state.json`. Keep `origin/main` fixed at this SHA until all 20 jobs are terminal. No local executable validation ran.

At 09:05 UTC, two independent final static reviews approved the grouped-table container/count selection, unique-only path matcher, active-target reopen branch, macOS status wording, and Windows native-button fallback. Review identified one diagnostics gap: row-only unmapped candidates lacked direct fixture-path matches. Added required `fixture_path_matches` fields to both the initial visible-row scan and fresh-scroll scan; a second read-only review confirmed both construction paths and report arrays are covered. Updated active C07.3 report labels and acceptance metadata to R2.8.120, synchronized MIG-002 to the current `goal.md` SHA-256 `72ffa528debfde44753d1228729f5e70848cd6bb831a776801163b30ada1a7ec`, and reconciled state review statuses and next action. The Kanban mapping discrepancy remains unexplained and no runtime cause is claimed. Empty views with a visible table container but no visible table root fail closed; previously recorded zero-result cases retain the header-only fallback when neither container nor table roots are visible. R2.8.120 is implementation-complete and ready for one milestone submission, not CI-accepted. `origin/main` remains at `2a18016de043ea8ec82529feabb4912d439efa2`. No local tests, builds, formatter, lint, typecheck, runtime probe, or application launch ran.

## 2026-10-14 — complete-milestone push gate clarified

Updated `goal.md` and MIG-002 so CI submission is explicitly one push per complete, reviewed named milestone. Minor edits, isolated fixes, intermediate commits and partial milestones stay local; each batch is sized for the full CI suite, which may take several hours. Keep `origin/main` at the submitted SHA until every required workflow/job is terminal, then submit the next milestone or a grouped repair once. The submission is implementation-complete / CI-pending; achievement requires passing, reconciled exact-SHA results. Current `goal.md` SHA-256: `de3944b86b8f6a4cc3c5dd6bce7c1c043aca432ba12c318b342cf9d24743a53d`. No local executable validation ran. The active R2.8.120 CI batch remains on its submitted SHA; this goal refinement remains local for a later milestone submission.

## 2026-10-14 — R2.8.120 status refresh and repair preparation

At 09:19:05 UTC, exact-SHA Actions reconciliation found six of seven workflows successful and one workflow still active; 17/20 jobs passed, two round-trip jobs failed, and the Ubuntu round-trip job remained in progress. Rust CI passed on all four jobs, including minimum Rust 1.95. The macOS report failed in first-run display metrics before click/picker/path entry and omitted Swift stderr. The Windows report shows completed path entry and exact Select Folder activation; the picker PID/HWND disappeared, but the Obsidian host HWND changed and the stale close predicate stopped execution before canonical selected-path verification. Artifact IDs, digests, report/screenshot hashes, run/job URLs and status counts are recorded in `evidence/r2.8.120-attempt-1-985af8a.json`.

Prepared a local macOS repair that resolves the single `NSScreen`'s `NSScreenNumber` to its `CGDirectDisplayID` at each OCR screen mapping and captures failed Swift subprocess output. Prepared a Windows close check that allows a new same-class host HWND while still requiring the recorded picker PID/HWND to disappear, exactly one visible same-process host, and no UIA read errors; the downstream exact canonical path check remains unchanged. Independent read-only reviews approved both repairs after the picker identity predicate was tightened. The Ubuntu round-trip job remains active, so no repair milestone is pushed or CI batch started. No local executable validation ran.

## 2026-10-14 — R2.8.120 terminal reconciliation; R2.8.121 repair package

Final exact-SHA reconciliation at 09:24:51 UTC found all seven R2.8.120 workflows and all 20 jobs terminal for `985af8aa18be53c285221b2ed21d4062e69b9f3d`: six workflows / 17 jobs passed, and the cross-platform round-trip workflow / three platform jobs failed. The Ubuntu job was terminal, so the earlier 09:19 active-job snapshot is superseded. `origin/main` remains exactly at the failed SHA. Artifact IDs, digests, report hashes, job/run URLs, confirmed findings, and diagnostic inferences are in `evidence/r2.8.120-attempt-1-985af8a.json`.

R2.8.121 is now recorded as one bounded repair milestone for all three platform failures. Its local source package resolves macOS display IDs and preserves Swift failure output; lets Windows accept a replacement same-class host HWND only after the exact picker identity disappears and a clean unique host inventory is observed; scopes Linux table-row diagnostic corroboration to the selected result root and requires unique row/path/link evidence; and narrows Kanban fallback hit testing to painted title-node descendants while recording title-test failure details. Table row corroboration remains diagnostic-only and cannot create extracted paths or group membership. These checks preserve the existing ambiguity, count, exact path, and source-checkpoint gates. Independent read-only review passed after tightening title hit targets and correcting row-self-candidate classification. No local executable validation ran, and no R2.8.121 push has been made.

The goal's one-push-per-complete-milestone rule is reflected in MIG-002; current `goal.md` SHA-256 is `1185a710634269472513fec045fc07eeb1d1697c28a06f374740c707ff5935ce`. Minor corrections remain local and are grouped into this milestone. CI results may take several hours; after a complete reviewed package is submitted once, `origin/main` stays at that exact SHA until all required workflows and jobs are terminal. R2.8.121 is ready for one push. The branch and live remote were read-only checked: both point to `985af8aa18be53c285221b2ed21d4062e69b9f3d` on `main` before submission.
