import {expect, test} from "bun:test";
import {DEFAULT_WORKSPACE_VISIBILITY, OPEN_OBSIDIAN_THEME, TITLEBAR_ACTIONS, WORKSPACE_ACTIONS, WORKSPACE_BLOCKS, type SharedWorkspaceAction, type WorkspaceAction, type WorkspaceBlock, type WorkspaceBlockId, type WorkspaceVisibility, workspaceAction, workspaceColumns} from "../src/shared/ui/index.js";

test("shared workspace UI contract exposes reusable blocks and semantic actions", () => {
  const firstBlock: WorkspaceBlock = WORKSPACE_BLOCKS[0]!;
  const firstBlockId: WorkspaceBlockId = firstBlock.id;
  const visibility: WorkspaceVisibility = {...DEFAULT_WORKSPACE_VISIBILITY, leftSidebar: false};
  const sharedAction: SharedWorkspaceAction = {actionId: "toggle-right-sidebar", enabled: true};
  const action: WorkspaceAction = workspaceAction(sharedAction.actionId);
  expect(OPEN_OBSIDIAN_THEME.metrics).toMatchObject({titlebarHeight: 40, ribbonWidth: 44, sidebarWidth: 300, tabStripHeight: 34});
  expect(new Set(WORKSPACE_BLOCKS.map((block) => block.id)).size).toBe(WORKSPACE_BLOCKS.length);
  expect(firstBlockId).toBe("titlebar");
  expect(firstBlock.mobilePresentation).toBe("inline");
  expect(new Set(WORKSPACE_ACTIONS.map((action) => action.id)).size).toBe(WORKSPACE_ACTIONS.length);
  expect(TITLEBAR_ACTIONS.every((id) => WORKSPACE_ACTIONS.some((action) => action.id === id))).toBe(true);
  expect(action).toMatchObject({label: "Toggle right sidebar", group: "workspace"});
  expect(sharedAction.enabled).toBe(true);
  expect(workspaceColumns(visibility)).toEqual({ribbon: 44, sidebar: 0, content: "1fr"});
});
