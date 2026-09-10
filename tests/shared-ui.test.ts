import {expect, test} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {DEFAULT_WORKSPACE_VISIBILITY, OPEN_OBSIDIAN_THEME, TITLEBAR_ACTIONS, WORKSPACE_ACTIONS, WORKSPACE_BLOCKS, layoutGraph, type GraphLayoutOptions, type SharedWorkspaceAction, type WorkspaceAction, type WorkspaceBlock, type WorkspaceBlockId, type WorkspaceVisibility, workspaceAction, workspaceBlock, workspaceColumns} from "../src/shared/ui/index.js";

test("shared workspace UI contract exposes reusable blocks and semantic actions", () => {
  const firstBlock: WorkspaceBlock = WORKSPACE_BLOCKS[0]!;
  const firstBlockId: WorkspaceBlockId = firstBlock.id;
  const visibility: WorkspaceVisibility = {...DEFAULT_WORKSPACE_VISIBILITY, leftSidebar: false};
  const sharedAction: SharedWorkspaceAction = {actionId: "toggle-right-sidebar", enabled: true};
  const action: WorkspaceAction = workspaceAction(sharedAction.actionId);
  expect(OPEN_OBSIDIAN_THEME.metrics).toMatchObject({titlebarHeight: 40, ribbonWidth: 44, sidebarWidth: 300, tabStripHeight: 34});
  expect(new Set(WORKSPACE_BLOCKS.map((block) => block.id)).size).toBe(WORKSPACE_BLOCKS.length);
  expect(firstBlockId).toBe("titlebar");
  expect(workspaceBlock(firstBlockId)).toEqual(firstBlock);
  expect(firstBlock.mobilePresentation).toBe("inline");
  expect(new Set(WORKSPACE_ACTIONS.map((action) => action.id)).size).toBe(WORKSPACE_ACTIONS.length);
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
