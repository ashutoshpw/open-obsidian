# User experience and accessibility

Working specification · v0.3 · 9 September 2026. Confirmed decisions, proposals and untested requirements remain distinguished.

[Back to plan](../../plan.md) · [Decision register](../decisions/index.md)

## UX and accessibility

Use a familiar file tree and editor workspace with an optional AI panel and a dedicated changes review. Keep command access keyboard-first. Allow hiding all AI controls. Preserve user-selected editor mode, tabs, splits and navigation history. Show indexing, saving, conflict and provider states clearly without modal interruptions for routine operations.

Required UX specifications: first-run and existing-vault scan; unsupported extension report; extension trust/enablement; provider setup; source inspector; multi-file diff; conflict resolver; history/restore; settings search; keyboard shortcuts; model/download management; account/billing; safe mode and diagnostics.

Support screen readers, visible focus, keyboard-only graph/Canvas alternatives, contrast, font scaling, reduced motion, IME, RTL, Unicode and locale-sensitive dates. Validate English plus representative Hindi/IME and RTL fixtures. Localization architecture belongs in the core even if initial translation coverage is limited.
