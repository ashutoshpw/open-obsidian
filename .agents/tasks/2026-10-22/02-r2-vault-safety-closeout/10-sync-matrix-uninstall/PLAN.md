# 10 — Sync-tool matrix and uninstall cleanup

**Rows:** SYNC-005, SYNC-007.

## Goal
Name and test an external sync-tool matrix (no own sync ships), report OS protection status honestly, and ensure uninstall cleanup never deletes a vault.

## Scope
- SYNC-005: named tools (e.g. Syncthing, iCloud Drive, OneDrive, Dropbox, Git; final list decided here from tools actually available to CI), tested where available, unsupported combinations visible, no implication of Obsidian Sync/Publish access. Each cell has a disposition: supported, failing, untested, unsupported.
- SYNC-007: report checked OS protection status, never claim unverified encryption; uninstall cleanup choices explicit and the vault untouched.
- **Carried to R6:** actual uninstaller/installer wiring. R2 delivers the cleanup planner and fixtures only; SYNC-007 stays pending until R6 wires it.

## Design
- Existing: `crates/platform/src/storage_protection.rs` (`inspect_storage_protection`, `StorageProtectionReport`), `crates/platform/src/user_data.rs` (app-data location), fixtures `sync-tool-matrix` data in `sync-*.json`, `uninstall-preservation.json`, `update-rollback.json`.
- New (if absent): a cleanup planner enumerating app-owned paths vs vault paths, with a hard guard that no planned deletion lies inside a registered vault.
- Sync matrix cells built on task 07's race fixtures; cloud-provider cells that CI cannot run are `untested` with the reason.

## Steps
1. Choose the tool list; record which are runnable on hosted runners.
2. Matrix document and machine-readable `fixtures/sync-tool-matrix.json` (verify whether it exists).
3. Cleanup planner with vault-protection property tests (symlinked vault inside app data, vault at app-data root).
4. Surface protection status in settings/about (confirm current UI use of `inspect_storage_protection`).

## Acceptance / CI evidence
- Matrix with dispositions; uninstall-planner tests on 3 OSes; SYNC-007 recorded external-pending (R6).

## Risks
Cloud sync clients cannot run on CI; avoid certifying tools without evidence. Overstating encryption status is the key correctness risk.
