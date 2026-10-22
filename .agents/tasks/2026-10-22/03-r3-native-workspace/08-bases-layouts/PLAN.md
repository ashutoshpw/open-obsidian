# 08 — Bases layouts, summaries and `this.file` context

**Rows:** C07.7, C07.8, C07.9, D03.

## Goal
Render Bases views in the workspace with the four core layouts and correct evaluation context.

## Scope
- Open `.base` files and embedded bases (`parse_embedded_bases`) in main area, in a Markdown note, in Canvas, and in a sidebar.
- Layouts with distinct structures: Table, List, Cards, Kanban; per-layout pinned settings (Table columns, row height, summaries; Cards size/image property/fit; others per C07.8 acceptance text — read it in `requirements.json`).
- C07.7: `properties.*.displayName` shown in Table headers only; filters/formulas keep property names; default Table summaries and per-view property->summary selection.
- C07.9: explicit `this.file` context per placement, asserted with distinct paths.

## Design
- Evaluation: `doc::evaluate_base_by_view_index(doc, idx, rows)` with rows from `VaultIndex`/engine (`crates/engine/src/bases.rs` listing + evaluation types). Add a `BaseEvalContext { this_file: Option<Path>, placement }` parameter if `doc` lacks one (unverified; grep `this` handling first).
- Rendering: egui_extras table or custom; layout widgets consume `BaseEvaluation`, keeping evaluation off the UI thread.
- Editing cells is out of scope; read-only unless fixtures demand otherwise.

## Steps
1. Verify `doc` summary/displayName support; extend with tests if missing.
2. Layout widgets (Table, List, Cards, Kanban) + kittest snapshots.
3. Placements and `this.file` context tests (main, embedded note, embedded canvas, sidebar).
4. Issue display for unsupported formulas/filters.

## Acceptance / CI evidence
- Reference fixtures (pinned Obsidian 1.14.4) compared by row order, headers, summaries; four layouts structurally distinct in snapshots.
- Same base under different `this.file` yields different, asserted rows.

## Risks
- Reference behavior is CI-verified only; mismatches go to `failing`, never relabelled unsupported. Summary formulas beyond defaults unverified.
