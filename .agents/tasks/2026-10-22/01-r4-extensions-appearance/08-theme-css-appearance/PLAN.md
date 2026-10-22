# 08 — Theme and CSS appearance projection

**Rows:** C12, PC08 (Style Settings, appearance half), PC17 (Minimal + minimal-settings), RISK-002, UX-004 (contrast/scale), PLUG-010.

## Goal
Make themes and CSS snippets usable in the egui app via an honest, documented projection — no arbitrary CSS execution, no control over privileged dialogs or AI permissions.

## Scope
- Extend `crates/doc/src/themes.rs` analysis into a **token projection**: CSS custom properties (`--background-primary`, `--text-normal`, `--interactive-accent`, font families/sizes, radii, spacing) resolved per light/dark mode into an `AppearanceTokens` struct; `@media`/`.theme-dark|.theme-light` scoping handled; `var()` resolution with cycle/depth limits; `color-mix`/`hsl()/rgb()/#hex` parsing for colors.
- Apply tokens to egui `Visuals`/`Style` and to Markdown preview rendering (headings, links, code, callouts) in the R3 workspace; popout windows reuse the same tokens.
- Everything unsupported (selectors, pseudo-elements, layout rules) listed in an "Appearance report" pane — reported, never silently dropped (extends `native-appearance.md`).
- Style Settings (PC08): read `@settings` blocks as data to produce a settings UI whose values override tokens; values persisted via broker/app-data, not by running the plugin.
- Minimal theme: pinned artifact; screenshots/traces for light/dark and popout (RISK-002).

## Design
- `crates/doc/src/appearance/{css_tokens.rs,project.rs}` (pure, no egui); `crates/ui-egui/src/workspace/theme.rs` applies tokens; token cache keyed by file revision.
- Caps on file size, rule count, variable depth; all inputs treated as untrusted data.

## Steps
1. Tolerant CSS tokenizer/parser subset with fixtures from Minimal and common snippets; golden token tests.
2. Projection to `AppearanceTokens` + unsupported-rule report.
3. Apply to egui visuals and preview; light/dark and popout parity tests (kittest snapshots).
4. Style Settings `@settings` reading and override layer; contrast checks against UX-004 thresholds.

## Acceptance / CI evidence
- Fixture themes render consistently across modes/windows on 3 OSes (snapshot diffs under tolerance); theme/snippet files unchanged after use (no vault writes); report lists every unsupported construct.

## Risks
CSS scope creep: freeze the supported subset in `docs/architecture/native-appearance.md` and add to it only through fixtures.
