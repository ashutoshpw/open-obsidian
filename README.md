# OpenObsidian

OpenObsidian is an Electron workspace for opening existing Obsidian vaults in place, with revision-checked editing, recovery, safe previews and local-first AI seams.

## Development checks

Use the shortest check that matches the change:

```sh
bun install --frozen-lockfile
bun run check:fast       # routine source/UI changes
bun run validate:surfaces # verify named UX surfaces and external handoffs
bun run quality          # phase boundary or release-candidate gate
bun run audit:fallow     # repository health report
bun run audit:packaged -- --artifacts-dir out  # packaged artifact notice audit
bun run audit:dependencies -- --artifacts-dir out  # transitive dependency/package-scope audit
```

`check:fast` runs state, contract, architecture, named-UX-surface, accessibility, layout, typecheck, tests, Knip and the changed-file Fallow audit. It intentionally skips Electron compilation, the quality scorecard, packaging and the full release audit. Run `bun run quality` before a phased checkpoint commit or when changing build/release code.

The recurring audit commands are also available separately:

- `bun run knip` checks unused files, exports and dependencies.
- `bun run audit:fallow:changed` reviews the current working-tree delta against `HEAD`.
- `bun run audit:fallow:strict` runs the changed-file Fallow audit without the brief review mode.
- `bun run audit:fallow` records the full repository health score; its current inherited advisory is tracked rather than hidden.
- `bun run validate:state` keeps the implementation ledger honest and reports incomplete work instead of turning it into a release pass.
- `bun run validate:surfaces` checks `fixtures/ux-surfaces.json` against the renderer and requires an owner/prerequisite handoff for every external-pending surface.

For focused compatibility work, `bun run test:bases` runs the JSON, native YAML `.base` and embedded Markdown `base` fixture tests without running the entire suite. The Bases reader accepts the bounded Obsidian-native YAML view shape, normalizes supported filters/order/grouping/limits into the platform-neutral evaluator, preserves the original YAML source for read-only round trips, and exposes unsupported expressions as compatibility issues. Embedded definitions retain their source spans and remain inert in Markdown preview until a host explicitly requests the safe structured projection.

## Reusable UI boundary

`src/shared/ui/index.ts` is the stable, platform-neutral surface for workspace actions, layout blocks, theme tokens, safe Markdown preview data and deterministic graph positions. It has no Electron, DOM or React Native imports. The Electron renderer maps those values to HTML/SVG; a future Expo app can map the same action IDs, preview blocks and graph layout to native `Pressable`, `View`, `Text` or a canvas surface without copying product vocabulary or parsing rules.

The named UI states are recorded in `fixtures/ux-surfaces.json`. Implemented surfaces have renderer markers and notes; unavailable runtime-dependent surfaces remain visibly labeled as external-pending with an owner and prerequisite instead of pretending to be complete.

Keep platform-specific code in `src/electron` and `src/renderer`. Keep reusable contracts and pure transforms in `src/shared/ui` (and other explicitly shared modules), and add tests that prevent native or DOM dependencies from crossing that boundary.

The Markdown core keeps raw property spans authoritative while exposing a bounded, read-only YAML mapping for nested arrays and maps. Unsupported YAML constructs are reported to callers and are never serialized back over the vault source.

## Packaging

After packaging, run the transitive dependency attribution audit to verify that
only explicitly shipped runtime packages are present in each app.asar archive.

`bun run package:dir` creates an unsigned unpacked preview under `out`. The desktop-build workflow runs the packaged runtime notice audit on Ubuntu, macOS and Windows. Signing, staging, updater installation and production publication remain explicit release handoffs.
