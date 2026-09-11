# Shared workspace UI contract

This folder is deliberately platform-neutral. It contains no Electron, DOM or React Native imports, so the desktop renderer and a future Expo app can consume the same workspace vocabulary without sharing platform code.

- `design-system.ts` owns the dark Obsidian-compatible color, metric, spacing and radius tokens plus the semantic action catalog.
- `workspace.ts` describes the reusable workspace blocks, vault pane strip and visibility model that a desktop shell or mobile navigation can compose. Use `workspaceBlock(id)` and `vaultPane(id)` instead of duplicating labels or mobile presentation rules in a host renderer.
- `keyboard.ts` owns the data-only shortcut catalog and `resolveKeyboardCommand`. Desktop hosts can pass a `KeyboardEvent`; Expo/native hosts can pass the same `{key, metaKey, ctrlKey}` shape and map the resulting command ID to a native action.
- `markdown-preview.ts` parses safe preview blocks and inline segments into data-only values. Desktop HTML and future native views can render the same blocks without sharing a DOM renderer.
- Fenced `base` blocks are represented as inert data-only preview blocks; `src/core/embedded-base.ts` separately parses their retained spans through the same safe Bases grammar when a host needs a structured projection.
- Markdown properties keep their raw source spans while the core read path exposes a bounded YAML mapping for nested arrays/maps. `serializeYamlValue` and typed property edits are limited to representable scalar/flow values; nested or unsupported YAML remains source-only and is refused rather than silently rewritten.
- `graph.ts` provides a deterministic, platform-neutral spatial layout for force, hierarchical and radial graph views. Hosts can render its point map with SVG on desktop or a native/canvas surface in Expo while retaining the keyboard/list alternative.
- `workflows.ts` provides platform-neutral bookmark, tag-index and task-index contracts plus pure Markdown/configuration transforms. The Electron core supplies vault reads and revision-checked task writes; an Expo host can render the same rows and apply its own navigation and persistence adapter.
- `note-workflows.ts` provides bounded template and daily-note settings, date-path formatting and plain-text variable expansion. Unknown variables stay literal and template scripts are never executed; hosts can reuse the plan/index data and choose a platform-specific safe action.
- `themes.ts` parses appearance settings and CSS into variables, legacy layout contracts, plugin-view/popout selectors and accessibility hints. It never executes CSS, resolves imports or fetches URL assets; desktop and Expo hosts can apply an explicit preview policy to the same analysis.
- `uninstall.ts` provides explicit app-data cleanup choices for desktop or Expo settings. Every choice declares `vaultDisposition: "preserve"`; hosts must keep the vault outside uninstall cleanup and require a separate destructive confirmation for any local app-data removal.
- The pure `src/core/bases.ts` evaluator and `src/core/bases-native.ts` YAML adapter have no Electron, DOM or React Native imports. A future Expo host can consume the same typed rows, groups and compatibility issues and provide its own table/list/cards renderer.
- `index.ts` is the stable import surface for the future design system package.

The Electron renderer maps action IDs to HTML buttons and CSS variables. An Expo app should map the same IDs to native primitives such as `Pressable`, `View` and `Text`, keeping native dependencies in the Expo app package. For compound controls, use explicit `Button`, `ButtonIcon` and `ButtonText` roles instead of accepting ambiguous string-or-node children. Use `StyleSheet.create`, `gap`, and continuous border curves when those properties are available on the target React Native version.

The vault pane strip uses the same data-only contract:

```tsx
const pane = vaultPane("files");

<Pressable accessibilityLabel={pane.label} onPress={() => setPane(pane.id)}>
  <ButtonIcon>{pane.icon}</ButtonIcon>
  <ButtonText>{pane.label}</ButtonText>
</Pressable>
```

Example mapping:

```tsx
const action = workspaceAction("toggle-left-sidebar");

<Pressable accessibilityLabel={action.label} onPress={toggleLeftSidebar}>
  <ButtonIcon>{action.icon}</ButtonIcon>
  <ButtonText>{action.label}</ButtonText>
</Pressable>
```

Markdown preview follows the same boundary:

```tsx
const blocks = parseMarkdownPreview(noteSource);

blocks.map((block) => <MarkdownBlock key={block.kind} block={block} />);
```

Graph layout follows the same boundary:

```tsx
const positions = layoutGraph(nodes, edges, "radial", {width: 360, height: 240});
```

Theme compatibility follows the same boundary:

```tsx
const theme = parseThemeStylesheet(cssText);
if (theme.safety.previewable) renderLegacySurface(theme.variables);
```

The shared parser never creates elements, evaluates code or turns link targets into navigable URLs. A host renderer can add an explicit, allowlisted navigation policy later.
