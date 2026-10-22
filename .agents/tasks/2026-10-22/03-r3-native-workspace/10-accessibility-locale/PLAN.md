# 10 — Accessibility, input methods and locale

**Rows:** UX-003, UX-004, UX-005, C10.1, UX-001.

## Goal
Keyboard, screen-reader, scale, contrast, IME, RTL and locale behavior with automated evidence where possible and explicit handoffs where human access is required.

## Scope
- UX-003: documented state table for each named surface (explorer, editor, panes, palette, graph, canvas, bases, popouts) with a fixture each.
- UX-004: focus order and visible focus, accesskit labels/roles (eframe `accesskit` is enabled), contrast checks, UI scale, reduced motion, keyboard alternative for graph/canvas.
- UX-005: central message catalog (all user-visible strings through one lookup); locale fixtures (long strings, RTL, CJK, combining marks); no truncation or input corruption.
- C10.1: IME composition, RTL editing, Unicode (normalization, emoji) round-trip in editor save.

## Design
- Introduce `workspace/i18n.rs` (new): `tr(key)` with an English catalog; add a lint/test that fails on new hard-coded strings in the workspace module (best-effort grep test).
- Use `egui_kittest` accesskit queries for labels; IME and screen readers cannot be fully driven in CI.

## Steps
1. Message catalog and migration of existing workspace strings.
2. A11y tree assertions per surface; focus-trap/return tests for overlays.
3. Locale/RTL/IME fixtures; Unicode save round-trip against disk.
4. Manual-trace template for human checks, marked external-pending.

## Acceptance / CI evidence
- Automated a11y assertions per surface; locale snapshots; Unicode byte round-trip.
- Human-only items (real screen readers, real IME) listed in the evidence file as external-pending — not passed.

## Risks
- Easy to overclaim: egui's RTL/shaping and IME support are limited and platform-dependent; failures get recorded honestly.
