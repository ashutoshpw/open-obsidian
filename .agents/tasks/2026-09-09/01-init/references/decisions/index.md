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
| D11 | App AI and every plugin require enforced preview for file changes and enforced isolation; no trusted bypass | Confirmed; takes priority over incompatible plugin behavior |
| D12 | GNU AGPL v3.0 distribution | Confirmed; use AGPL-3.0-only as the conservative implementation interpretation; no additional license grant inferred |
| D13 | Initial managed inference through an OpenRouter proxy; managed hosting and billing implemented later | Confirmed; no pricing or paid entitlement work in this implementation goal |
| D14 | Top 25 registered community plugins by official cumulative downloads are mandatory v1 targets; Minimal theme and Text Extractor included as workflow dependencies | Selected by research under user authorization; release artifact versions remain to be pinned |
| D15 | Enforced isolation and preview for every plugin, even where compatibility cannot be achieved | Confirmed; incompatible workflows remain visibly unsupported, with evidence; never permit unrestricted execution |
| D16 | 30-day history, configurable 5 GiB cap; never automatically remove unresolved conflicts; OS access controls/full-disk encryption instead of app-managed history encryption | Confirmed; hardware, OS/architecture, performance budgets and other engineering defaults delegated after prototypes |
| D17 | OpenObsidian working name; no deadline; no default note-content telemetry | Confirmed; agent chooses and documents remaining engineering defaults; no paid-resource spending authorized |
| D18 | Goal completion is implementation plus available automated checks; human validation and public release are separate | Confirmed; deferred gates remain pending, not passed |
| D19 | Use GitHub Actions runners in the assigned open-source GitHub project; push phased commits to origin/main | Confirmed; project URL will be supplied at execution start |
| D20 | Push to main triggers preview/staging; release tag vYYYY-MM-DD triggers production builds | Confirmed; implement workflows; creating a production tag/public release is outside the build goal |
| D21 | Two vault types: Standard Vault and Chronicle Vault (Git-enabled) | Two types confirmed; Chronicle is the agent-selected display name under delegated engineering/product naming defaults |

## Decisions needed next

The user's answers on 9 September 2026 resolve the former decision gates. D11/D15 explicitly supersede the earlier requirement to achieve every plugin workflow regardless of isolation constraints. All 25 still require implementation effort and evaluation; a demonstrated security incompatibility can be recorded as unsupported without stopping the rest of the goal. Ordinary missing implementations or failing tests are not security exceptions.

Implement the OpenRouter-proxy client contract and deterministic integration fixtures now; defer operated managed service, billing, pricing and paid entitlements. Record live connectivity prerequisites without representing fixtures as live certification. Use no paid provisioning by default. GitHub runner availability/limits must be checked at execution time; open-source status alone is not evidence of unlimited capacity.

The agent may select OS/architecture support, hardware/performance budgets, models/provider adapters, themes, external sync tools and backend interfaces from prototype evidence. Freeze measurable criteria before final tests; never adjust them merely to conceal failures. Do not ask again for these delegated choices.

The assigned GitHub URL is the deployment target authority: verify origin matches it before pushing. Configure main-push staging in that project's available environment; where hosting/signing credentials are absent, produce downloadable preview artifacts and a deployment/signing handoff. This is build delivery, not a claim that hosted staging or signed release validation passed. No personal-vault remote push is authorized by repository origin/main permission.

To avoid missing requirements, maintain one traceability row per capability linking source/reference version → requirement ID → acceptance fixture → implementation owner → release phase → result. This draft establishes the structure; it does not pretend that every ecosystem edge case has already been discovered.
