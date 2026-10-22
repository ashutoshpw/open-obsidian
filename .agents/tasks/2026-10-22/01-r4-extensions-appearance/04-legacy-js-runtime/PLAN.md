# 04 — Legacy JavaScript plugin runtime (unchanged Obsidian bundles)

**Rows:** PC01–PC25 (execution half), PLUG-003, PLUG-009, D15 (unsafe-boundary cases), MIG-008.

## Goal
Turn the R1.2 Wry feasibility probe into a supported-or-honestly-denied runtime that loads **unchanged** release artifacts (`main.js`, `styles.css`) with an Obsidian API implementation.

## Scope
- **Process model:** WebView host runs in a separate child process (`apps/plugin-host`), launched by the app, communicating over stdio/IPC with length-prefixed JSON messages; app never embeds the WebView in its own process.
- **Security review gate (first step):** document threat model for CSP, `unsafe-eval`, navigation/new-window/download denial, clipboard, same-user OS isolation limits; decide on OS-level sandboxing per platform (seccomp/landlock, macOS sandbox profile, Windows AppContainer/job object) or record the limitation honestly.
- **Obsidian API implementation:** replace probe "shims" with a real, growing implementation in JS bundled into the host: `Plugin`, `Modal`, `Setting`, `PluginSettingTab`, `ItemView`, `Notice`, `Workspace`/`Vault`/`MetadataCache` facades backed by broker calls, `requestUrl` (broker-proxied), `Platform`, DOM helpers. Track coverage against `obsidian.d.ts` in a generated gap report.
- CommonJS `require` adapter rejects `fs`, `child_process`, `electron`, `net`, etc. with a D15-eligible, logged denial; unsupported APIs fail visibly as *failing*, not D15.
- Editor integration: CodeMirror-6 extension APIs are out of reach for egui; define what "editor extension" workflows map to (command/transform-based) and mark the rest unsupported with evidence.

## Design
- `apps/plugin-host/` (Rust + wry), `crates/plugins/src/legacy/{protocol,session}.rs` for the app side; JS API layer in `apps/plugin-host/js/` with its own fixture tests run in the CI probe.
- All vault effects are RPCs to the app, which route through task 02.
- Reports record `wry::webview_version()`, user agent, artifact hashes, API shim use separate from unchanged-bytes execution.

## Steps
1. Threat model + decision record; sandbox choices per OS.
2. Extract host into its own binary with the IPC protocol; port PC05/PC08 probe cases with identical results.
3. Implement API surface incrementally in priority order driven by the 25 plugins' actual API usage (static scan of bundles → coverage matrix).
4. Add plugins in waves (simple UI → editor/command → data/query → network/process-heavy); per wave record pass/fail/D15 per workflow.

## Acceptance / CI evidence
- Per-plugin JSON reports on 3 OSes with artifact SHA-256, runtime identity, workflows run, denials. Mock/other-SHA reports never satisfy a row.

## Risks (largest in R4)
WebKitGTK on Linux/Wayland, WebView2 availability on Windows, API surface size, plugins requiring Node. Budget for many D15/"failing" outcomes; do not hide them.
