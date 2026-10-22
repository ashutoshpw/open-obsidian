# 01 — App-owned settings migration

**Rows:** MIG-010 (state half), D20 (no-data-loss half); feeds the cleanup adapter in `release-handoff.md`.

## Goal
Safely carry Electron-era app-owned state into the Rust app's directories, and wire confirmed cleanup to `cleanup_user_data`.

## Scope
- Locate legacy `userData` (`workspace-settings.json`, provider settings, `vaults/<id>` per-vault data, credentials blob) per OS; map to `app_user_data_directory()` and `prepare_vault_app_data`.
- Versioned migration with a dry-run report; unknown files are preserved, never deleted. Credentials are handled by R5 task 01 (this task only invokes it).
- Cleanup adapter: after the desktop process exits and the user confirms choices, call `openobsidian_platform::cleanup_user_data`, report preserved journal-recovery directories, and surface credential cleanup failures.

## Design
- `crates/platform/src/migration.rs` (new): pure planner `plan(legacy_root, new_root) -> MigrationPlan`, executor copies atomically (temp + rename). Idempotent; records a migration marker with schema version.
- The legacy directory layout is from `src/electron/main.ts` lines ~46 and ~574; confirm by fixture, not assumption, since packaged productName affects the OS path.

## Steps
1. Synthetic legacy-directory fixtures (settings, vault data, corrupt JSON, partial earlier migration).
2. Planner + executor with failure injection (disk full, permission denied).
3. Cleanup adapter wiring and a "preserve journal recovery" test.
4. First-launch UI prompt in the R3 workspace.

## Acceptance / CI evidence
- Migration idempotence and non-destructive tests on 3 OSes; cleanup report test covers credential failure; no vault bytes touched.

## Risks
Real legacy installs cannot be tested in CI; fixtures approximate them. Record this limitation in the handoff.
