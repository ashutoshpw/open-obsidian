# Shared workspace UI contract

This folder is deliberately platform-neutral. It contains no Electron, DOM or React Native imports, so the desktop renderer and a future Expo app can consume the same workspace vocabulary without sharing platform code.

- `design-system.ts` owns the dark Obsidian-compatible color, metric, spacing and radius tokens plus the semantic action catalog.
- `workspace.ts` describes the reusable workspace blocks and visibility model that a desktop shell or mobile navigation can compose. Use `workspaceBlock(id)` instead of duplicating labels or mobile presentation rules in a host renderer.
- `markdown-preview.ts` parses safe preview blocks and inline segments into data-only values. Desktop HTML and future native views can render the same blocks without sharing a DOM renderer.
- Markdown properties keep their raw source spans while the core read path exposes a bounded YAML mapping for nested arrays/maps; unsupported YAML constructs remain source-only and are reported as issues rather than serialized back.
- `graph.ts` provides a deterministic, platform-neutral spatial layout for force, hierarchical and radial graph views. Hosts can render its point map with SVG on desktop or a native/canvas surface in Expo while retaining the keyboard/list alternative.
- The pure `src/core/bases.ts` evaluator and `src/core/bases-native.ts` YAML adapter have no Electron, DOM or React Native imports. A future Expo host can consume the same typed rows, groups and compatibility issues and provide its own table/list/cards renderer.
- `index.ts` is the stable import surface for the future design system package.

The Electron renderer maps action IDs to HTML buttons and CSS variables. An Expo app should map the same IDs to native primitives such as `Pressable`, `View` and `Text`, keeping native dependencies in the Expo app package. For compound controls, use explicit `Button`, `ButtonIcon` and `ButtonText` roles instead of accepting ambiguous string-or-node children. Use `StyleSheet.create`, `gap`, and continuous border curves when those properties are available on the target React Native version.

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

The shared parser never creates elements, evaluates code or turns link targets into navigable URLs. A host renderer can add an explicit, allowlisted navigation policy later.
