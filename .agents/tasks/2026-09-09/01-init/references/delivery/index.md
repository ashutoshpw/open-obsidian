# Implementation phases and responsibilities

Working specification · v0.3 · 9 September 2026. Confirmed decisions, proposals and untested requirements remain distinguished.

[Back to plan](../../plan.md) · [Decision register](../decisions/index.md)

## Phased implementation plan

| Phase | Work and dependencies | Exit evidence |
| --- | --- | --- |
| P0: Definition | Confirm open product decisions; collect required extension/version inventory and representative vault profile; freeze baseline and parity ledger | Approved launch contract, evaluation corpus and decisions log |
| P1: Feasibility | In-place reader/writer and crash recovery spike; editor/API compatibility; theme/DOM prototype; extension trust boundary; large-vault benchmarks | Demonstrated required representative workflows, failure report, architecture decisions, credible staffing estimate |
| P2: File-compatible foundation | Vault engine, source/live editor, links/properties/search, settings, history and external-edit handling | Core golden corpus and recovery suite pass |
| P3: Obsidian workflow coverage | Graph, Canvas, Bases, workspace/core features, plugin/theme runtime and ongoing certification | Launch-critical parity and extension suite passes; back-and-forth Obsidian tests pass |
| P4: AI differentiation | Retrieval/citations, BYOK/local, OpenRouter-proxy client contract, local model lifecycle and changes review; managed operation/billing later | Available automated evidence/cost/privacy checks pass; live/human checks explicitly handed off |
| P5: Private beta | Real-world vaults, sync-tool matrix, accessibility, signing/updater, support and performance hardening | No blocking data-loss/security defects; scorecard and pilot results reviewed |
| P6: Release | Publish honest compatibility matrix, onboarding/recovery docs, operational ownership and supported versions | Release sign-off against contract; rollback ready |
| P7: Expansion | Own sync, mobile, scoped autonomy, collaboration or publishing only according to decisions and evidence | Separate PRDs and compatibility/security gates |

P2/P3 and P4 can partially overlap after P1 fixes interfaces. P3 is likely the dominant uncertainty; do not hide it behind a generic “MVP in a few weeks” estimate. No calendar commitment is defensible before the plugin feasibility results and team capacity are known.

D11–D21 govern this table. P2 includes Standard/Chronicle Git-enabled vaults (C15). P3 allows only proven D15 security incompatibilities to remain safely unsupported, with all plugins evaluated. P5/P6 contain both implementation and external release work: the goal finishes automated implementation/build/available-check portions and records human validation, absent signing credentials, live managed access and publication separately. Use Actions in the assigned GitHub project; phased pushes go to origin/main and trigger preview/staging, while valid vYYYY-MM-DD tags trigger production builds. The goal configures tag workflows without creating a release tag.

Required responsibilities: product/UX; editor and compatibility engineering; desktop/filesystem reliability; AI/retrieval; managed-service/backend; QA/automation; security/release operations. Individuals may cover multiple roles. Estimate effort per workstream after P1 with optimistic/likely/pessimistic ranges and explicit dependencies.
