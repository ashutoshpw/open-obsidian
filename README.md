# OpenObsidian

OpenObsidian is an Electron workspace for opening existing Obsidian vaults in place, with revision-checked editing, recovery, safe previews and local-first AI seams.

## Development checks

Use the shortest check that matches the change:

```sh
bun install --frozen-lockfile
bun run check:fast       # routine source/UI changes
bun run quality          # phase boundary or release-candidate gate
bun run audit:fallow     # repository health report
bun run audit:packaged -- --artifacts-dir out  # packaged artifact notice audit
```

`check:fast` runs state, contract, architecture, accessibility, layout, typecheck, tests, Knip and the changed-file Fallow audit. It intentionally skips Electron compilation, the quality scorecard, packaging and the full release audit. Run `bun run quality` before a phased checkpoint commit or when changing build/release code.

The recurring audit commands are also available separately:

- `bun run knip` checks unused files, exports and dependencies.
- `bun run audit:fallow:changed` reviews the current working-tree delta against `HEAD`.
- `bun run audit:fallow:strict` runs the changed-file Fallow audit without the brief review mode.
- `bun run audit:fallow` records the full repository health score; its current inherited advisory is tracked rather than hidden.
- `bun run validate:state` keeps the implementation ledger honest and reports incomplete work instead of turning it into a release pass.

## Reusable UI boundary

`src/shared/ui/index.ts` is the stable, platform-neutral surface for workspace actions, layout blocks, theme tokens and safe Markdown preview data. It has no Electron, DOM or React Native imports. The Electron renderer maps those values to HTML; a future Expo app can map the same action IDs and preview blocks to native `Pressable`, `View` and `Text` components without copying product vocabulary or parsing rules.

Keep platform-specific code in `src/electron` and `src/renderer`. Keep reusable contracts and pure transforms in `src/shared/ui` (and other explicitly shared modules), and add tests that prevent native or DOM dependencies from crossing that boundary.

## Packaging

`bun run package:dir` creates an unsigned unpacked preview under `out`. The desktop-build workflow runs the packaged runtime notice audit on Ubuntu, macOS and Windows. Signing, staging, updater installation and production publication remain explicit release handoffs.
