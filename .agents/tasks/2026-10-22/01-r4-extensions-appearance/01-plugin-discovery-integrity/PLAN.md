# 01 — Plugin discovery and artifact integrity

**Rows:** PLUG-001, PLUG-010, D14, C11.1, PC-DEP-MINIMAL, PC-DEP-TEXT-EXTRACTOR, C09.1 (discovery half), D04, MIG-008 (hash part).

## Goal
Read-only discovery of installed plugins/themes in a vault and verification of each against the pinned manifest, with no writes and no code execution.

## Scope
- Discover `.obsidian/plugins/<id>/{manifest.json,main.js,styles.css,data.json}`, `.obsidian/community-plugins.json`, `.obsidian/themes/*`, `.obsidian/snippets/*` using the confined, no-follow inventory in `crates/vault` (reuse C07.5/C09 discovery; do not add a second walker).
- Typed `PluginManifest` (id, name, version, minAppVersion, isDesktopOnly, author, ...) with unknown-field preservation; malformed manifests become visible issues, not panics.
- `ArtifactIdentity { id, version, main_js_sha256, size, styles_sha256 }`; compare with `fixtures/compatibility-manifest.json` (25 plugins + Minimal + Text Extractor). Result enum: `MatchesPinned | DifferentVersion | HashMismatch | Unpinned`.
- Caps: max plugins, max file bytes, max manifest depth; omissions reported.

## Design
- New module `crates/plugins/src/discovery.rs` (pure over a `VaultFileSource` trait so tests use in-memory fixtures) + `manifest.rs`.
- Engine facade `VaultSession::discover_plugins()` runs off the UI frame.
- Never read `data.json` contents here (plugin settings may hold secrets); size and presence only.

## Steps
1. Add manifest + identity types and fixture parsing tests (valid, missing fields, unknown fields, BOM, oversized, symlink).
2. Implement discovery over the vault inventory with caps.
3. Pin-comparison against the manifest fixture; add the two dependency rows (Minimal, Text Extractor) and ensure no development-branch value is treated as a release.
4. Engine facade + `docs/architecture/plugin-discovery.md`.

## Acceptance / CI evidence
- Fixture vaults (empty, all 25 plugins, tampered `main.js`, symlinked plugin dir, huge manifest) give deterministic results on 3 OSes; byte/hash snapshot of the vault is unchanged after discovery.
- Rows PLUG-001, D14, C11.1 and the PC-DEP rows get evidence paths; C09.1 stays pending until task 02 consults the policy at enablement.

## Risks
Plugin directories using non-UTF-8 names; case-insensitive filesystems (macOS/Windows) producing duplicate ids.
