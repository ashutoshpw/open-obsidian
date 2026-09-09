# Obsidian-compatible AI workspace — implementation plan

Version 0.4 · 9 September 2026 · Working PRD and implementation plan

Build an Electron application for individual power users that opens existing Obsidian vaults directly and improves knowledge retrieval, synthesis and organization through AI. This is a planning specification; no application or plugin compatibility has been implemented or certified yet.

## Confirmed product decisions

- **Electron on macOS, Windows and Linux.** Mobile is a later, separate implementation.
- **Open existing vaults in place:** retain notes, files, links/graph relationships, Canvas nodes and Obsidian interoperability.
- **Evaluate and implement the top 25 plugins**, with Minimal theme and Text Extractor dependencies. Enforced isolation and preview take priority: evidence-backed security incompatibilities stay explicitly unsupported, never enabled through a trusted bypass.
- **AI for individual power users:** managed service, BYOK and local models.
- **Preview AI changes before applying**, with recovery and undo.
- **External file sync first**; our own encrypted sync is deferred.
- **Scope before deadline:** estimate staffing and dates after compatibility prototypes.
- **GNU AGPL v3.0; Standard and Chronicle vaults.** Chronicle adds opt-in Git workflows while retaining ordinary vault files.
- **Managed operations and billing later.** Build the OpenRouter-proxy client seam now alongside BYOK/local modes.
- **Autonomous implementation handoff:** available automated checks and cross-platform builds complete this goal; human validation, signing access and public release are tracked separately. Push phased commits to origin/main; main pushes trigger staging/preview, and vYYYY-MM-DD tags trigger production builds.

The authoritative [decision register](references/decisions/index.md) also records open questions. “Better than Obsidian” must be established through the [quality scorecard](references/quality-release/index.md), including comparison with plugin-equipped Obsidian.

## Module documents

Each module owns its detailed requirements; this file is the entry point.

| Module | Specification |
| --- | --- |
| Product and user journeys | [references/product/index.md](references/product/index.md) |
| Decisions and open questions | [references/decisions/index.md](references/decisions/index.md) |
| Obsidian competitive baseline | [references/competitive-baseline/index.md](references/competitive-baseline/index.md) |
| Vault and file compatibility | [references/vault-compatibility/index.md](references/vault-compatibility/index.md) |
| Plugin and theme compatibility | [references/plugin-compatibility/index.md](references/plugin-compatibility/index.md) |
| First-release plugin support catalog | [references/plugin-catalog/index.md](references/plugin-catalog/index.md) |
| Plugin selection evidence and version discovery | [references/plugin-research/index.md](references/plugin-research/index.md) |
| AI workspace and provider data flows | [references/ai-workspace/index.md](references/ai-workspace/index.md) |
| User experience and accessibility | [references/ux-accessibility/index.md](references/ux-accessibility/index.md) |
| Electron architecture and extension boundaries | [references/electron-architecture/index.md](references/electron-architecture/index.md) |
| Sync, file safety and recovery | [references/sync-recovery/index.md](references/sync-recovery/index.md) |
| Quality, testing and release operations | [references/quality-release/index.md](references/quality-release/index.md) |
| Implementation phases and responsibilities | [references/delivery/index.md](references/delivery/index.md) |
| Risk register | [references/risks/index.md](references/risks/index.md) |

## Delivery sequence

| Phase | Outcome required before proceeding |
| --- | --- |
| P0 — Define | Freeze launch contract, reference versions, test corpus and open decisions. |
| P1 — Prove feasibility | Demonstrate file-safe editing, representative plugin/theme compatibility and viable trust boundaries; estimate effort from evidence. |
| P2 — Build foundation | Implement vault engine, editor, links, properties, search and recovery. |
| P3 — Complete compatibility | Deliver Graph, Canvas, Bases, core workflows and all required plugin/dependency tests. |
| P4 — Add AI | Deliver grounded retrieval, provider modes, reviewed changes and managed-service operations. |
| P5 — Private beta | Validate real vaults, platform/sync matrix, accessibility, performance and update recovery. |
| P6 — Release | Meet the launch contract and publish the compatibility matrix with operational ownership. |
| P7 — Expand | Consider mobile, own sync, autonomy, collaboration and publishing under separate decisions. |

See [delivery](references/delivery/index.md) for dependencies, responsibilities and exit evidence. P4 may overlap foundation work after P1 fixes the interfaces; P3 remains a first-release gate.

## Non-negotiable release gates

1. Opening/indexing a vault causes no unintended writes; edits survive reopening in reference Obsidian.
2. Evaluate all 25 plugins and dependencies across the applicable matrix. Supported workflows must pass using unchanged artifacts; demonstrated isolation/preview incompatibilities must be safely disabled and listed as unsupported under D15. Missing implementation cannot be relabeled a security exception.
3. Conflicts and interrupted changes remain recoverable; no unacknowledged content loss in the failure suite.
4. AI scope, provider destination, isolation and change approval are enforced and tested for app AI and every enabled plugin. Direct-write bypasses are forbidden; D15 already determines the compatibility tradeoff.
5. Performance, accessibility, source-grounding and practical user benefit meet the agreed scorecard.

## Next decisions and work

Apply D11–D21 from the decision register without reopening approved choices. Pin released plugin artifacts and hashes; choose engineering defaults and broader theme coverage from evidence. The phase descriptions describe the product lifecycle; this implementation goal completes the automated implementation portions of P0–P6 and hands off deferred managed operations, human validation and release execution explicitly.

## Documentation maintenance

Keep Dxx decisions in the decision register and Cxx/Axx/PCxx requirements in their owning modules. Record source version, test fixture, owner, phase and result for each requirement. Change this entry point only for scope, module navigation, delivery sequencing or launch-gate changes. Preserve relative links so the folder works as a portable Markdown knowledge base.
