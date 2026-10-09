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

