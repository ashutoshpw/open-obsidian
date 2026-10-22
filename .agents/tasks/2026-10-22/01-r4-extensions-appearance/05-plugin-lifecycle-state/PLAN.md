# 05 — Plugin lifecycle, trust and persisted state

**Rows:** PLUG-002, PLUG-003 (alternating launch), PLUG-005, PLUG-008, C09.1, RISK-001, D04.

## Goal
Enable/disable/update/restart plugins safely, preserve vault compatibility when the vault is alternately opened in real Obsidian, and run plugin combinations deterministically.

## Scope
- States: `Discovered → Trusted → Enabled → Running → Faulted/Disabled`. First open of any vault enables **nothing** and writes nothing (`PLUG-008`).
- Trust decision stored in app data keyed by (vault id, plugin id, artifact hash); a changed hash revokes trust and shows the pin-mismatch.
- `community-plugins.json` is read-only unless the user explicitly applies an enable/disable (revision-checked write via broker, preview shown).
- Plugin `data.json` writes: through broker as staged changes, preserving unknown keys/ordering (lossless JSON write helper in `crates/doc`).
- Safe mode: start with all plugins disabled; per-plugin crash counter and auto-quarantine after N faults.
- Combination runs: automatic writers (Templater, Linter, Tasks, QuickAdd...) disabled by default; deterministic ordering and recovery when two plugins touch the same file.
- Restart/update: stop → reload with new artifact; settings migration only if the plugin does it; recovery journal for interrupted plugin writes (reuse `write_recovery`).

## Design
- `crates/plugins/src/lifecycle.rs` state machine (pure, table-tested), engine glue in `crates/engine`, persistence in `crates/platform/user_data.rs`.

## Steps
1. State machine + trust store with tests (hash change, crash loop, safe mode).
2. Lossless `data.json` / `community-plugins.json` writers + tests against pinned fixtures.
3. Alternating-launch fixtures: open in Rust app → open in pinned Obsidian (reference harness) → byte compare.
4. Combination fixtures with conflicting writers; recovery on interruption.

## Acceptance / CI evidence
- No-op byte snapshots across first open with all 25 plugins installed but disabled; alternating-launch round trip on 3 OSes.
