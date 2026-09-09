# Decisions and open questions

Working specification · v0.3 · 9 September 2026. Confirmed decisions, proposals and untested requirements remain distinguished.

[Back to plan](../../plan.md) · [Product](../product/index.md)

## Decision register

| ID | Decision | Status |
| --- | --- | --- |
| D01 | Electron desktop application | Confirmed |
| D02 | Open existing vault directories in place; no required import or conversion | Confirmed |
| D03 | Support notes, links/graph relationships, Canvas nodes, and existing files | Confirmed |
| D04 | Existing Obsidian community plugins and themes must be supported | Confirmed target; feasibility and coverage unproven |
| D05 | Main differentiation: AI knowledge workspace | Confirmed |
| D06 | Initial audience: individual power users | Confirmed |
| D07 | Managed AI, user-supplied provider keys, and local models | Confirmed |
| D08 | Define scope before committing to deadline or staffing | Confirmed |
| D09 | macOS, Windows, Linux first; mobile separately | Confirmed |
| D10 | Coexist with external file sync first; own encrypted sync later | Confirmed |
| D11 | AI previews changes before applying; scoped autonomy later | Confirmed |
| D12 | Open-source, source-available, or proprietary distribution | Open |
| D13 | Free core / paid AI / sync packaging and pricing | Open |
| D14 | Top 25 registered community plugins by official cumulative downloads are mandatory v1 targets; Minimal theme and Text Extractor included as workflow dependencies | Selected by research under user authorization; release artifact versions remain to be pinned |
| D15 | Legacy extension execution/trust model | Open; architecture feasibility gate |
| D16 | Reference vault sizes, hardware, languages, and retention | Proposals: [benchmarks/hardware](../quality-release/index.md), [language fixtures](../ux-accessibility/index.md), [history retention](../sync-recovery/index.md), [AI data flows](../ai-workspace/index.md); validate with pilot |
| D17 | Brand/name, budget, team, release date | Open |

## Decisions needed next

Platform, sync and AI-write choices (D09–D11) are now confirmed. The research-selected launch plugin set is recorded in the [launch plugin catalog](../plugin-catalog/index.md) (D14). Next decide acceptable legacy extension trust behavior (D15) using P1 findings. Follow with distribution/business model, local history policy, hardware floor and launch resources. Pricing and dates come after cost/compatibility evidence.

To avoid missing requirements, maintain one traceability row per capability linking source/reference version → requirement ID → acceptance fixture → implementation owner → release phase → result. This draft establishes the structure; it does not pretend that every ecosystem edge case has already been discovered.
