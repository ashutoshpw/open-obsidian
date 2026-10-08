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
