import {expect, test} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {DEFAULT_WORKSPACE_VISIBILITY, KEYBOARD_SHORTCUTS, OPEN_OBSIDIAN_THEME, TITLEBAR_ACTIONS, UNINSTALL_CLEANUP_OPTIONS, VAULT_PANES, WORKSPACE_ACTIONS, WORKSPACE_BLOCKS, layoutGraph, resolveKeyboardCommand, type GraphLayoutOptions, type KeyboardInput, type KeyboardShortcut, type SharedWorkspaceAction, type UninstallCleanupOptionId, type WorkspaceAction, type WorkspaceBlock, type WorkspaceBlockId, type WorkspaceVisibility, uninstallCleanupOption, vaultPane, workspaceAction, workspaceBlock, workspaceColumns} from "../src/shared/ui/index.js";

test("shared workspace UI contract exposes reusable blocks and semantic actions", () => {
  const firstBlock: WorkspaceBlock = WORKSPACE_BLOCKS[0]!;
  const firstBlockId: WorkspaceBlockId = firstBlock.id;
  const visibility: WorkspaceVisibility = {...DEFAULT_WORKSPACE_VISIBILITY, leftSidebar: false};
  const sharedAction: SharedWorkspaceAction = {actionId: "toggle-right-sidebar", enabled: true};
  const action: WorkspaceAction = workspaceAction(sharedAction.actionId);
  expect(OPEN_OBSIDIAN_THEME.metrics).toMatchObject({titlebarHeight: 40, ribbonWidth: 44, sidebarWidth: 300, iconSize: 24, tabStripHeight: 34});
  expect(new Set(WORKSPACE_BLOCKS.map((block) => block.id)).size).toBe(WORKSPACE_BLOCKS.length);
  expect(firstBlockId).toBe("titlebar");
  expect(workspaceBlock(firstBlockId)).toEqual(firstBlock);
  expect(firstBlock.mobilePresentation).toBe("inline");
  expect(new Set(WORKSPACE_ACTIONS.map((action) => action.id)).size).toBe(WORKSPACE_ACTIONS.length);
  expect(VAULT_PANES.map((pane) => pane.id)).toEqual(["files", "search", "bookmarks"]);
  expect(vaultPane("search")).toMatchObject({label: "Search", icon: "⌕"});
  expect(TITLEBAR_ACTIONS.every((id) => WORKSPACE_ACTIONS.some((action) => action.id === id))).toBe(true);
  expect(action).toMatchObject({label: "Toggle right sidebar", group: "workspace"});
  expect(sharedAction.enabled).toBe(true);
  expect(workspaceColumns(visibility)).toEqual({ribbon: 44, sidebar: 0, content: "1fr"});
  const layoutOptions: GraphLayoutOptions = {width: 360, height: 240};
  const points = layoutGraph([{id: "A.md", kind: "file", label: "A.md"}, {id: "B.md", kind: "file", label: "B.md"}], [{id: "edge", from: "A.md", to: "B.md", kind: "link"}], "hierarchical", layoutOptions);
  expect(points["A.md"]?.x).toBeLessThan(points["B.md"]?.x ?? 0);
  expect(Object.values(points).every((point) => point.x >= 34 && point.y >= 34)).toBe(true);
});

test("shared UI source remains portable for a future Expo renderer", () => {
  const sharedDirectory = new URL("../src/shared/ui/", import.meta.url);
  const source = readdirSync(sharedDirectory, {withFileTypes: true}).filter((entry) => entry.isFile() && entry.name.endsWith(".ts")).map((entry) => readFileSync(new URL(entry.name, sharedDirectory), "utf8")).join("\n");
  expect(source).not.toMatch(/from ["'][^"']*(?:electron|react-native|react)[^"']*["']/i);
  expect(source).not.toMatch(/\b(?:document|window|HTMLElement|Node)\b/);
});

test("shared keyboard contract resolves primary-modifier commands", () => {
  const shortcut: KeyboardShortcut = KEYBOARD_SHORTCUTS[0]!;
  const input: KeyboardInput = {key: "K", metaKey: true};
  expect(shortcut.label).toBe("Meta/Ctrl-K");
  expect(KEYBOARD_SHORTCUTS.map((entry) => entry.command)).toEqual(["command-palette", "quick-switcher", "quick-switcher", "save-note"]);
  expect(resolveKeyboardCommand(input)).toBe("command-palette");
  expect(resolveKeyboardCommand({key: "p", ctrlKey: true})).toBe("quick-switcher");
  expect(resolveKeyboardCommand({key: "s", ctrlKey: true})).toBe("save-note");
  expect(resolveKeyboardCommand({key: "k"})).toBeUndefined();
});

test("shared uninstall cleanup choices always preserve the vault", () => {
  const ids: UninstallCleanupOptionId[] = ["app-cache", "credentials", "recovery-history"];
  expect(UNINSTALL_CLEANUP_OPTIONS.map((option) => option.id)).toEqual(ids);
  expect(UNINSTALL_CLEANUP_OPTIONS[0]?.vaultDisposition).toBe("preserve");
  expect(UNINSTALL_CLEANUP_OPTIONS.every((option) => option.vaultDisposition === "preserve" && !option.defaultSelected)).toBe(true);
  expect(uninstallCleanupOption("credentials")).toMatchObject({label: "Stored credentials", vaultDisposition: "preserve"});
});
