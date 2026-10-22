# 06 — Graph view (global and local)

**Rows:** C05, C05.1, PROD-010 (organization), D03.

## Goal
Navigable global and local graph with filters, derived entirely from the index, read-only.

## Scope
- Global graph via `VaultIndex::graph()` and local via `local_graph(path, depth)`; nodes include unresolved `?target` nodes (legacy behavior); click opens note (or offers create for unresolved).
- Filters: tags, folders/path text, orphans, unresolved toggle (exact filter set to confirm from legacy `src/shared/ui/graph.ts` and fixtures).
- Layouts: force, hierarchical, radial, ported from `src/shared/ui/graph.ts`; deterministic seeded force layout so snapshots are stable.

## Design
- Layout code is pure (new `crates/ui-egui/src/workspace/graph_layout.rs` or engine-side if layering needs it), steps on a background cancellable unit and publishes positions to the painter; pan/zoom/hover/select in the painter.
- No vault writes, no cache files in the vault (C05.1); any layout cache lives in app data and is discardable.
- Large graphs: cap rendered labels, degrade gracefully; thresholds come from task 11.

## Steps
1. Port layouts with golden-position tests from legacy fixtures (tolerance stated).
2. Painter widget, pan/zoom, selection, accessibility labels (task 10).
3. Filters and local-depth control.
4. Before/after vault snapshot test while graph opened and interacted.

## Acceptance / CI evidence
- Fixture vault: expected nodes/edges (incl. unresolved) equal derived graph; click navigates; vault byte-identical after use (C05.1).
- kittest snapshots for each layout.

## Risks
- Force layout cost/determinism; keyboard-accessible graph navigation (list/tab order alternative) is a UX-004 requirement and easy to forget.
