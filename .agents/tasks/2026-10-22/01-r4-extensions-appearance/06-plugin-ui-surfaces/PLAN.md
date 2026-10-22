# 06 — Plugin UI surfaces (egui)

**Rows:** UX-003 (trust, diagnostics, safe mode, settings search surfaces), PLUG-004 (visibility), D15 visibility, C11.

## Goal
User-facing screens for plugins, built on the R3 workspace shell and command registry.

## Scope
- **Plugin manager** pane: discovered plugins with version, pin status (matches / different / unpinned), state, last fault, dispositions (supported / failing / untested / unsupported-security with the D15 evidence link).
- **Trust prompt** (non-routine modal allowed only here): shows requested capabilities and hash; remember/deny.
- **Change preview** UI for broker `ProposedChange`s (diff, approve/reject, stale warning) — reuse the R5 changeset UI shape where possible.
- Plugin-contributed commands appear in the R3 command palette; settings tabs render via the host's `PluginSettingTab` description (declarative widgets → egui).
- Status bar entries for plugin faults; safe-mode banner; diagnostics export (local only).
- Accessibility: every control labelled and keyboard operable; kittest coverage.

## Design
- `crates/ui-egui/src/workspace/panes/plugins.rs` (+ `preview_change.rs`), consuming a `PluginBackend` trait implemented over the engine so UI logic stays unit-testable (same pattern as `WorkspaceBackend`).

## Steps
1. Backend trait + in-memory impl; plugin manager pane + tests.
2. Trust prompt + capability display.
3. Change-preview UI; command-palette integration; declarative settings renderer.
4. Accessibility pass and kittest scenarios (enable → fault → quarantine → disable).

## Acceptance / CI evidence
- kittest interaction traces for each surface; D15 entries visible with evidence links; no routine modals.
