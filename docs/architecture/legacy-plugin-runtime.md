# Legacy plugin runtime feasibility

## Status

This is an R1.2 compatibility experiment. It does not make legacy plugins a supported OpenObsidian feature and does not certify their compatibility. A successful probe establishes only that the selected unchanged bundles can run through a constrained WebView path on the tested operating systems. Lifecycle, restart/update, cross-plugin behavior, reference Obsidian parity, same-user OS isolation and production security still require later evidence.

## Why a WebView is being evaluated

Existing Obsidian plugins are JavaScript bundles that expect CommonJS `require`, Obsidian API classes and browser DOM behavior. The Rust `wasmi` host planned for Rust-era extensions cannot execute those JavaScript bundles or provide a DOM. Wry provides a native system WebView while the application UI remains egui/eframe.

The experiment uses Wry `=0.57.0` and winit `0.30`. Linux uses GTK 3 with WebKitGTK 4.1, macOS uses WKWebView and Windows uses WebView2. These dependencies are specific to legacy compatibility and are not part of the Photocraft Rust stack. Wry documents [the platform engines, Linux dependencies and Wayland GTK integration](https://github.com/tauri-apps/wry/blob/wry-v0.57.0/README.md); the current headless CI probe uses X11 under Xvfb. Its Ubuntu runner installs `libxkbcommon-x11-0` for winit's XKB/X11 event-loop initialization. Wry's crate metadata lists its dual MIT/Apache-2.0 license in the [0.57.0 manifest](https://docs.rs/crate/wry/0.57.0/source/Cargo.toml.orig).

## Probe boundary

The CI probe downloads only pinned assets listed in `fixtures/compatibility-manifest.json` and checks each byte count and SHA-256 before execution. It runs the unchanged PC05 Advanced Tables and PC08 Style Settings bundles. PC05 exercises a registered editor callback against the synthetic editor contract fixture. PC08 loads its pinned stylesheet, registers its Obsidian settings API and renders controls into a real WebView DOM. Reports identify the test as `feasibility-only` and keep the artifact hash separate from the host shim.

The WebView serves a fixed HTML document, the exact verified bundle, and an optional verified stylesheet from an in-memory custom protocol. The host exposes no Node integration, file or vault handles, credential store or application command broker. Its content policy blocks framing and `connect-src`; navigation is limited to the exact probe document, new windows and downloads are denied, and all WebView permission requests are denied. The CommonJS `require` adapter rejects filesystem, process and credential modules, while common JavaScript network APIs are denied. The CI report states the specific probes performed. This does not establish that every browser network mechanism is blocked or certify the WebView as an isolation boundary. The only IPC route reports probe results to Rust and cannot perform application operations.

The host API and editor supplied to these plugins are compatibility shims. The probe includes minimal `Plugin`, `Modal`, settings and view classes plus DOM helper methods for the audited startup paths; it does not implement the full Obsidian API. Their use is reported separately from execution of unchanged plugin bytes and cannot count as unchanged-artifact product certification. A denied capability or unsupported API remains a visible compatibility gap; do not convert an ordinary plugin failure into a security disposition.

## Limits to retain in evidence

- A system WebView is a browser compatibility layer, not an OS sandbox against browser-engine vulnerabilities or same-user access.
- Browser engine versions vary by runner and by end-user platform. Record `wry::webview_version()` and the JavaScript user agent for each run.
- Wry's Linux child-WebView path used here targets X11. Production Wayland support needs a tested GTK container integration.
- Wry cannot disable WebView clipboard access on macOS through its clipboard setting. Keep clipboard capability decisions explicit in later product architecture.
- `unsafe-eval` is enabled in the experiment only to compile a verified CommonJS bundle into the isolated JavaScript context. This is a feasibility trade-off and needs a separate production security review.

## CI source

Only GitHub Actions runs may execute this probe. The Rust workflow uploads per-OS JSON reports containing runtime identity, verified artifact hashes, API registrations, DOM/editor metrics and capability denial results. A mock projection or a report from a different source SHA cannot satisfy the R1.2 gate.
