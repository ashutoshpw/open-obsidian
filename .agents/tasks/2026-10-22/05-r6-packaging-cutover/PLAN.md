# Epic: R6 — packaging and cutover

Phase R6 of the Rust migration (`.agents/tasks/2026-10-07/goal.md` line 129): *replace electron-builder with native packaging tooling; preserve icons/app identity/notices, update/rollback contracts and three-OS preview delivery; migrate app-owned settings safely.*
Exit criteria: installable preview artifacts, launch/file-open/clipboard scenarios, package audits and full Rust gates pass in CI; platform limitations remain recorded. **Signing, notarization and publication are external-pending and not implemented here.**

Starts after R5 closes (R5 supplies the credential store and AI state that packaging must carry). Rules inherited: CI-only validation, exact-SHA evidence, no release tag created by this goal.

## Starting point (verified 2026-10-22)
- `package.json` `build` block (electron-builder 26.16.1): appId `ai.openobsidian.desktop`, productName `OpenObsidian`, icon `assets/openobsidian-icon.png`, targets mac `dmg`, win `nsis`, linux `AppImage`, output `out/`.
- `.github/workflows/desktop-build.yml` still packages Electron with `bun run package:dir`, plus `release:gate`, `release:update-check`, `audit:packaged`, dependency-attribution audits, and `RELEASE_MODE` preview/production logic using `CSC_LINK`/`CSC_KEY_PASSWORD`.
- `.github/workflows/rust.yml` builds `cargo build --workspace --release` and uploads only a Linux preview executable.
- `scripts/{release-gate,update-rollback,audit-packaged-runtime,audit-dependency-attribution,verify-distribution}.ts` and `fixtures/update-rollback.json` hold the current contracts (TypeScript).
- Electron app settings: `workspace-settings.json` in `userData`, per-vault data under `userData/vaults/<id>` (`src/electron/main.ts`). Rust side: `crates/platform/src/user_data.rs` (`app_user_data_directory`, `prepare_vault_app_data`, `cleanup_user_data`). `apps/openobsidian/src/main.rs` is the Rust entry.
- Requirement rows: 7 in R6 (D12, D20, Q-014, Q-017, Q-018, RISK-009, MIG-010).

## Key decisions to record in `decisions.md` before coding
1. **Package formats** are open: candidates `cargo-packager`/`cargo-bundle`, or `.dmg`+`.msi`/NSIS+`AppImage`/deb via per-OS tooling. Choose with a spike; keep the existing per-OS format families unless the spike shows a blocker.
2. **Release tooling is Rust/xtask or kept TS?** Decide whether release gate and manifest scripts are ported to `xtask` (matching row owners) or remain Bun until R7 retirement; either way no Electron code path remains in the gate.
3. **Unsigned preview is the only CI output**; production mode fails clearly without credentials and never silently publishes.
4. **Settings migration is copy-forward, never destructive**: old files are left in place until the user confirms cleanup.

## Task order and dependencies
| # | Task | Depends on |
|---|------|-----------|
| 01 | settings-migration | R5 01 |
| 02 | native-packaging-tooling | R3 app binary, decision 1 |
| 03 | launch-fileopen-clipboard-scenarios | 02 |
| 04 | update-rollback-contracts | 02 |
| 05 | package-audits-ci-gates | 02, 04 (final integration after 03) |

01 and 02 can run in parallel; 05 is the critical-path closer.
