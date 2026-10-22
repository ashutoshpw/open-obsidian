# 02 — Native packaging tooling

**Rows:** MIG-010 (runtime inventory half), Q-014 (artifact production), D12 (identity/notices in artifacts).

## Goal
Produce installable unsigned preview artifacts for macOS, Windows and Linux from the Rust workspace, replacing electron-builder.

## Scope
- Preserve app identity `ai.openobsidian.desktop`, product name, icon (`assets/openobsidian-icon.png` converted to `.icns`/`.ico`/PNG set), AGPL-3.0-only notices, `THIRD_PARTY_NOTICES.md`, `licenses/`.
- Formats (open, see epic decision 1): macOS `.app`+`.dmg`, Windows installer, Linux `AppImage` or equivalent.
- Register file associations (`.md`, vault folders) and URL/deep-link handling only where the format supports it; record gaps.

## Design
- `xtask package --target <os>` (new subcommand; today `xtask/src/main.rs` only has `layers`) wraps the chosen tool with pinned versions; produces `out/` plus hashes.
- Release binary is `apps/openobsidian`; the CLI `apps/openobsidian-cli` ships only if the product contract says so (verify before including).
- The Wry-based `plugin-runtime-probe` is not packaged unless R4 promotes the WebView host to a shipped helper process.

## Steps
1. Spike on the three OSes; record the decision.
2. Icon/asset generation script with deterministic output.
3. `xtask package` and CI job (extend `rust.yml` or replace `desktop-build.yml` build steps; preserve its `RELEASE_MODE` semantics).
4. Install/uninstall smoke test per OS (silent install on runners where possible).

## Acceptance / CI evidence
- Three-OS artifacts uploaded with SHA-256 manifest for the exact SHA; installer smoke logs; labelled unsigned previews.

## Risks
Runner limits for installer/DMG tooling and AppImage FUSE; document per-OS limitations rather than dropping a platform silently.
