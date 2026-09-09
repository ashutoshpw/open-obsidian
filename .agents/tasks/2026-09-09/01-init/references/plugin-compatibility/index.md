# Plugin and theme compatibility

Working specification · v0.3 · 9 September 2026. Confirmed decisions, proposals and untested requirements remain distinguished.

[Back to plan](../../plan.md) · [Decision register](../decisions/index.md)

## Plugin and theme feasibility program

This is the first major technical gate, before investing in the full product UI. A modernized interface may change DOM structures that themes and plugins expect. Some plugins may depend on undocumented internals or native modules. A published API declaration is useful input, not a drop-in runtime.

Build a fixture manifest containing plugin/theme ID, version, artifact hash, license/source reference, Obsidian reference version, OS/architecture, configuration, workflows and expected outputs. Include the user's actual must-have set plus representative editor extensions, query/view plugins, templates/scripts, Canvas extensions, file/network integrations, native dependencies, themes and CSS snippets. The top-25 set in the [launch plugin catalog](../plugin-catalog/index.md) is now mandatory v1 scope, with Minimal theme and Text Extractor as workflow dependencies. These are requirements, not completed certifications.

Test installation/loading, settings, commands, event lifecycle, editor mutation, view rendering, hotkeys, vault writes, restart, uninstall, updates and return to Obsidian. Include plugin combinations and failure recovery. Record undocumented dependency use and maintenance burden. Pin baseline versions and continuously rerun against new upstream versions.

Gate outcome: an evidence-backed compatibility design, known breakages, expected engineering cost, and a release certification policy. Do not quietly downgrade D04. If full compatibility cannot be delivered under the chosen security model, bring the concrete failures and alternatives back for a decision. No universal compatibility marketing claim based on a small successful sample.

## Definition of first-release support

1. Load and run the upstream released plugin bundle unchanged in the compatible runtime, with the existing vault files and configuration. A built-in feature with a similar name, read-only rendering, or preservation of disabled plugin files **does not satisfy this requirement**.
2. Preserve plugin IDs, settings, custom scripts, plugin-owned files and serialized data. Verify alternating launches in our app and reference Obsidian. Do not auto-enable code merely because its directory exists.
3. Pin version, release URL, manifest/main/styles hashes, minimum application version, OS/architecture, dependencies and test fixtures. Development-branch manifests are discovery evidence, not proof of a stable release. Record plugin status as planned, implemented, passing or blocked, with dated evidence.
4. All 25 must pass their required workflows across the three desktop platforms, except capabilities the upstream plugin itself limits to a particular OS. Such intrinsic platform restrictions must be documented and match the reference product; they are not blanket waivers of compatibility.
5. Test plugin combinations: Templater + Calendar + QuickAdd; Dataview + Tasks; Minimal + Minimal Theme Settings + Style Settings; Omnisearch + Text Extractor; Excalidraw embeds; TaskNotes + Bases; Linter with template-generated notes. Test Git and Remotely Save individually and in documented coexistence configurations, avoiding competing automatic sync writers by default.
6. Existing provider subscriptions, external executables, OAuth access, model downloads and service terms remain prerequisites when upstream requires them. Our managed-AI subscription does not replace another plugin's paid entitlement. Test integrations with appropriately provisioned test accounts; do not claim unavailable services passed.
7. Native app AI and legacy AI plugins must coexist without silently sharing credentials, context or billing. Explicitly resolve preview-before-apply behavior for plugins/CLIs that can write directly. If it cannot be enforced, this is a release-blocking D11/D15 conflict to bring back to the user, not permission to quietly weaken the rule.
8. Linter and other user-enabled mutating automation may intentionally change formatting. Those test outcomes are evaluated against the user's configured plugin behavior. The no-op fidelity gate runs before enabling such automation; opening/indexing alone never authorizes a lint or migration.

## Delivery impact and launch gates

P1 must test the hardest compatibility surfaces first: DataviewJS and Templater scripting; Excalidraw custom views; Style Settings/Minimal DOM contracts; Git and Claudian process access; Remotely Save file/network behavior; TaskNotes/Bases integration. Then P3 completes all 25 plus required dependency fixtures. This is sequencing within v1, not a reduced launch list.

A single critical workflow failure in this set blocks its certification and the stated v1 contract. Do not replace this gate with an aggregate 80–90% pass rate. If the engineering spike exposes an infeasible dependency or disproportionate cost, present the specific failure and options for a user decision. No plugin is silently deferred.

The wider 30–50-plugin research corpus in the [architecture review](../electron-architecture/index.md) remains useful for discovering additional API requirements, but only this researched top-25 set and its necessary dependencies have now been added to mandatory launch scope. Themes beyond Minimal still need a separate research-selected certification set.
