import {OPEN_OBSIDIAN_THEME, type WorkspaceActionId} from "./design-system.js";

export type WorkspaceBlockId =
  | "titlebar"
  | "ribbon"
  | "vault-sidebar"
  | "note-tabs"
  | "workspace-header"
  | "editor"
  | "context-pane"
  | "status";

export type WorkspaceBlock = {
  id: WorkspaceBlockId;
  label: string;
  role: "navigation" | "region" | "contentinfo";
  mobilePresentation: "inline" | "stacked" | "sheet";
};

export const WORKSPACE_BLOCKS: readonly WorkspaceBlock[] = [
  {id: "titlebar", label: "Workspace navigation", role: "navigation", mobilePresentation: "inline"},
  {id: "ribbon", label: "Workspace ribbon", role: "navigation", mobilePresentation: "stacked"},
  {id: "vault-sidebar", label: "Vault navigation", role: "navigation", mobilePresentation: "stacked"},
  {id: "note-tabs", label: "Open notes", role: "navigation", mobilePresentation: "inline"},
  {id: "workspace-header", label: "Current note actions", role: "navigation", mobilePresentation: "inline"},
  {id: "editor", label: "Note editor", role: "region", mobilePresentation: "stacked"},
  {id: "context-pane", label: "Note context", role: "region", mobilePresentation: "sheet"},
  {id: "status", label: "Workspace status", role: "contentinfo", mobilePresentation: "inline"},
];

export type WorkspaceVisibility = {
  leftSidebar: boolean;
  rightSidebar: boolean;
};

export const DEFAULT_WORKSPACE_VISIBILITY: WorkspaceVisibility = {leftSidebar: true, rightSidebar: true};

export function workspaceColumns(visibility: WorkspaceVisibility): {ribbon: number; sidebar: number; content: string} {
  return {
    ribbon: OPEN_OBSIDIAN_THEME.metrics.ribbonWidth,
    sidebar: visibility.leftSidebar ? OPEN_OBSIDIAN_THEME.metrics.sidebarWidth : 0,
    content: "1fr",
  };
}

export type SharedWorkspaceAction = {
  actionId: WorkspaceActionId;
  enabled: boolean;
};
