# 03 — Configuration discovery

**Rows:** C09, C09.1 (discovery half only; the enablement/policy half is R4).

## Goal
Read-only configuration discovery with exact source bytes, plus style asset discovery (the wip "C09.2" work) and proof that discovery never writes plugin settings.

## Scope
- Return sorted root `.obsidian` and `.obsidian-*` directories and recursively discovered valid JSON object files keyed by vault-relative path; preserve exact bytes and unknown keys; skip symlinks and malformed or non-object JSON; leave the vault snapshot unchanged.
- Explicitly mapped settings only; app metadata stays outside the vault unless portability is chosen.
- C09.1: tests show discovery performs no write to shared plugin settings. The visible-policy decision for enablement is delegated to `01-r4-extensions-appearance/02-capability-broker-d15` (`ConfigurationWriteRequest` in `crates/plugins/src/lib.rs`); this task only records that dependency and keeps C09.1 pending.

## Design
- Existing: `crates/vault/src/configuration.rs` (`VaultConfiguration`, `VaultStyleAsset`, `discover_configuration`, `matching_styles`), `crates/doc/src/configuration.rs`, `crates/doc/src/themes.rs`, `fixtures/configuration-inventory.json`, `fixtures/c12-themes.json`.
- Prior work: `wip/c07-combined-2400e57` rewrites `configuration.rs`/`themes.rs` and adds `crates/ui-egui/fixtures/c09-native-appearance.json` and `docs/architecture/native-appearance.md`. HEAD already has a style-asset struct, so the first step is a three-way comparison, not a copy.
- Appearance projection (applying theme tokens) is R4 task 08; here only discovery and inventory fidelity.

## Steps
1. Compare HEAD and wip behavior; list fields the wip adds (e.g. snippet/theme matching rules).
2. Add missing discovery cases: nested alternate folders, symlinked config, malformed JSON, BOM/CRLF bytes, duplicate keys.
3. Byte-snapshot test around `discover_configuration`.
4. Update `fixtures/configuration-inventory.json` with generated expectations.

## Acceptance / CI evidence
- Three-OS snapshot-unchanged evidence; fixture ids `c09-configuration`, `c09-configuration-inventory`.
- C09.1 stays `pending` with a note pointing at R4 task 02.

## Risks
Case-insensitive filesystems merging `.Obsidian` variants; large config trees (bound the walk, reuse task 02's caps).
