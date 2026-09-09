# Plugin and theme compatibility

Working specification · v0.3 · 9 September 2026. Confirmed decisions, proposals and untested requirements remain distinguished.

[Back to plan](../../plan.md) · [Decision register](../decisions/index.md)

## Plugin and theme feasibility program

This is the first major technical gate, before investing in the full product UI. A modernized interface may change DOM structures that themes and plugins expect. Some plugins may depend on undocumented internals or native modules. A published API declaration is useful input, not a drop-in runtime.

Build a fixture manifest containing plugin/theme ID, version, artifact hash, license/source reference, Obsidian reference version, OS/architecture, configuration, workflows and expected outputs. Include the user's actual must-have set plus representative editor extensions, query/view plugins, templates/scripts, Canvas extensions, file/network integrations, native dependencies, themes and CSS snippets. The top-25 set in the [launch plugin catalog](../plugin-catalog/index.md) is now mandatory v1 scope, with Minimal theme and Text Extractor as workflow dependencies. These are requirements, not completed certifications.

Test installation/loading, settings, commands, event lifecycle, editor mutation, view rendering, hotkeys, vault writes, restart, uninstall, updates and return to Obsidian. Include plugin combinations and failure recovery. Record undocumented dependency use and maintenance burden. Pin baseline versions and continuously rerun against new upstream versions.

Gate outcome: an evidence-backed compatibility design, known breakages, expected engineering cost and certification policy. D15 resolves the tradeoff: enforce preview/isolation even when a workflow cannot run. Record reproductions and safe alternatives attempted, deny unsafe execution and publish unsupported status. Do not reopen the already answered trust question. No universal compatibility claim based on a sample.

## Definition of first-release support

1. Load and run the upstream released plugin bundle unchanged in the compatible runtime, with the existing vault files and configuration. A built-in feature with a similar name, read-only rendering, or preservation of disabled plugin files **does not satisfy this requirement**.
2. Preserve plugin IDs, settings, custom scripts, plugin-owned files and serialized data. Verify alternating launches in our app and reference Obsidian. Do not auto-enable code merely because its directory exists.
3. Pin version, release URL, manifest/main/styles hashes, minimum application version, OS/architecture, dependencies and test fixtures. Development-branch manifests are discovery evidence, not proof of a stable release. Record plugin status as planned, implemented, passing or blocked, with dated evidence.
4. All 25 must be evaluated across applicable desktop platforms. Supported workflows must pass. Upstream platform restrictions require reference evidence; D15 security incompatibilities require reproduction, safe alternatives attempted and denied-execution tests. Ordinary missing code or failures cannot be relabeled unsupported-security.
5. Test plugin combinations: Templater + Calendar + QuickAdd; Dataview + Tasks; Minimal + Minimal Theme Settings + Style Settings; Omnisearch + Text Extractor; Excalidraw embeds; TaskNotes + Bases; Linter with template-generated notes. Test Git and Remotely Save individually and in documented coexistence configurations, avoiding competing automatic sync writers by default.
6. Existing provider subscriptions, external executables, OAuth access, model downloads and service terms remain prerequisites when upstream requires them. Our managed-AI subscription does not replace another plugin's paid entitlement. Test integrations with appropriately provisioned test accounts; do not claim unavailable services passed.
7. Native app AI and legacy AI plugins cannot silently share credentials, context or billing. Enforce preview and isolation for plugins/CLIs; if enforcement cannot be achieved, disable that workflow and record a D15 security incompatibility. There is no trusted bypass or outstanding user decision.
8. Linter and other user-enabled mutating automation may intentionally change formatting. Those test outcomes are evaluated against the user's configured plugin behavior. The no-op fidelity gate runs before enabling such automation; opening/indexing alone never authorizes a lint or migration.

## Delivery impact and launch gates

P1 must test the hardest compatibility surfaces first: DataviewJS and Templater scripting; Excalidraw custom views; Style Settings/Minimal DOM contracts; Git and Claudian process access; Remotely Save file/network behavior; TaskNotes/Bases integration. Then P3 completes all 25 plus required dependency fixtures. This is sequencing within v1, not a reduced launch list.

A critical workflow failure blocks its certification. D15 allows a proven security incompatibility to remain unsupported without blocking implementation completion; it does not make the workflow compatible. All 25 remain in the matrix, with passing, failing, untested and unsupported-security results visible. Aggregate pass rates cannot hide missing work.

The wider 30–50-plugin research corpus in the [architecture review](../electron-architecture/index.md) remains useful for discovering additional API requirements, but only this researched top-25 set and its necessary dependencies have now been added to mandatory launch scope. Themes beyond Minimal still need a separate research-selected certification set.
