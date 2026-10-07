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
