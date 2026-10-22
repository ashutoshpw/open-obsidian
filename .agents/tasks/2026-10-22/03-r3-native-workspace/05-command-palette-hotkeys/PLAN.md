# 05 — Command registry, palette, quick switcher and hotkeys

**Rows:** UX-001, C10 (keyboard journey), D03.

## Goal
Every core action is a registered command reachable by palette and configurable key, matching legacy Ctrl/Cmd+P (switcher) and Ctrl/Cmd+S behavior.

## Scope
- Command registry (id, name, default hotkey, enabled predicate) in the workspace module; palette and quick switcher UI (switcher fed by `VaultIndex::quick_switcher`).
- Load custom bindings from `.obsidian/hotkeys.json` via `doc::parse_hotkeys_settings` (`HotkeyBinding`, `HotkeysSettings`); show conflicts; Ctrl vs Cmd mapping per platform.
- Hotkey editing UI: write back only if round-trip fixtures prove unknown keys are preserved; else read-only with a stated reason.

## Design
- Registry is the single dispatch point (R4 plugin commands will register here). Commands take a `CommandContext`, not `&mut OpenObsidianApp`.
- Legacy: `src/renderer/renderer.ts` binds Ctrl/Cmd+P and Ctrl/Cmd+S; port ids and defaults, check the Electron app for the rest rather than guessing Obsidian defaults.
- Palette ordering: fuzzy rank is unverified against legacy; specify with fixtures first.

## Steps
1. Registry + dispatch tests (enable/disable, conflicts).
2. Palette and switcher overlays with focus return to the previous widget.
3. hotkeys.json load, platform mapping, conflict display.
4. Keyboard-only journey kittest: open vault, switcher to a note, edit, save, palette command.

## Acceptance / CI evidence
- kittest simulated key events trigger commands; custom binding fixture honored; unknown binding entries preserved.
- Switcher empty-query lists first 30 `.md` (shared fixture with task 03).

## Risks
- egui key-event coverage differs per OS (Cmd vs Ctrl, IME); macOS CI leg is the arbiter.
