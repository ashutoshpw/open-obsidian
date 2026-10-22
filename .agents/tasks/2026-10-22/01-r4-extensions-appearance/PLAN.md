# Epic: R4 — extensions and appearance

Phase R4 of the Rust migration (`.agents/tasks/2026-10-07/goal.md` line 127): *implement a bounded `wasmi` host and compatibility policy; resolve legacy bundle/theme execution and the supported native appearance projection.*
Exit criteria: artifact integrity, resource limits, capability denial, lifecycle/restart/recovery and required plugin combinations are exercised in CI, and **every legacy compatibility row has evidence and an honest disposition** (supported, failing, untested, or evidence-complete D15 unsupported-security). Ordinary missing code is never relabelled D15.

Starts after R3 closes. Rules inherited from the migration: CI-only validation, exact-SHA evidence under `.agents/tasks/2026-10-07/evidence/`, rows move to `passing` in `requirements.json` only with evidence paths, no silent scope reduction.

## Starting point (verified 2026-10-22)
- `crates/plugins/src/lib.rs` (~96 lines): deny-only `configuration.write` policy and `D15Record`. No discovery, no runtime.
- `apps/plugin-runtime-probe` (Wry `=0.57.0` + winit 0.30): CI feasibility probe running unchanged PC05 and PC08 bundles in a locked-down WebView. **Not a supported feature**; uses compatibility shims and `unsafe-eval` (see `docs/architecture/legacy-plugin-runtime.md`).
- `fixtures/compatibility-manifest.json`: pinned artifact list (version, size, SHA-256).
- `crates/doc/src/{themes,configuration}.rs` + ui `apply_vault_appearance`: theme/snippet analysis is inert; only light/dark, accent and font size apply.
- Requirement rows: 54 in R4 (PC01–PC25, PLUG-*, C11/C11.1/C12, D04/D11/D14/D15, GATE-002/004, A09, RISK-001..003, MIG-008/013, PC-DEP-*).

## Key decisions to record in `decisions.md` before coding
1. **Two runtimes, labelled separately:** `wasmi` for Rust-era (WASM) extensions; sandboxed WebView host for unchanged legacy JS bundles. WASM projections never count as legacy-bundle certification.
2. **WebView host in its own OS process** (not in the egui process), talking to the app over a narrow, versioned, message-only broker. Production security review of `unsafe-eval`/CSP is a gate before any "supported" claim.
3. **All plugin side effects go through one broker** (vault reads, revision-checked writes with preview, network, credentials). Plugins never get filesystem/process/credential handles.
4. **Themes/CSS:** project a documented CSS subset to egui style tokens; never execute or fully render arbitrary CSS. Unsupported rules are reported, not silently dropped.

## Task order and dependencies
| # | Task | Depends on |
|---|------|-----------|
| 01 | plugin-discovery-integrity | R2 C09 config discovery |
| 02 | capability-broker-d15 | 01, R3 file-op facade (create/trash/write) |
| 03 | wasmi-extension-host | 02 |
| 04 | legacy-js-runtime | 02 (parallel with 03) |
| 05 | plugin-lifecycle-state | 01, 02, 03/04 |
| 06 | plugin-ui-surfaces | 05, R3 workspace + command registry |
| 07 | compat-matrix-certification | 04, 05, 06 |
| 08 | theme-css-appearance | R3 workspace (independent of 02–07) |

Tasks 03/04 and 08 can be developed in parallel by separate agents; 01→02→05→06→07 is the critical path.
