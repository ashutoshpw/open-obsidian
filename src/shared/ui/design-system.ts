export const OPEN_OBSIDIAN_THEME = {
  colors: {
    chrome: "#202020",
    chromeRaised: "#262626",
    panel: "#1e1e1e",
    rail: "#1b1b1b",
    border: "#ffffff12",
    text: "#d9d9d9",
    textMuted: "#858585",
    accent: "#a78bfa",
  },
  metrics: {
    titlebarHeight: 40,
    ribbonWidth: 44,
    sidebarWidth: 300,
    workspaceHeaderHeight: 40,
    tabStripHeight: 34,
    editorToolbarHeight: 34,
    statusFooterHeight: 28,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
  },
  radii: {
    control: 5,
    panel: 8,
  },
} as const;

export type WorkspaceActionId =
  | "open-vault"
  | "quick-switcher"
  | "command-palette"
  | "toggle-left-sidebar"
  | "toggle-right-sidebar"
  | "settings"
  | "graph"
  | "canvas"
  | "bases"
  | "history";

export type WorkspaceAction = {
  id: WorkspaceActionId;
  label: string;
  icon: string;
  group: "navigation" | "workspace" | "review";
};

export const WORKSPACE_ACTIONS: readonly WorkspaceAction[] = [
  {id: "open-vault", label: "Open vault", icon: "▣", group: "navigation"},
  {id: "quick-switcher", label: "Quick switcher", icon: "⌕", group: "navigation"},
  {id: "command-palette", label: "Command palette", icon: "⌘", group: "navigation"},
  {id: "toggle-left-sidebar", label: "Toggle left sidebar", icon: "◧", group: "workspace"},
  {id: "toggle-right-sidebar", label: "Toggle right sidebar", icon: "◨", group: "workspace"},
  {id: "settings", label: "Settings", icon: "⚙", group: "workspace"},
  {id: "graph", label: "Graph", icon: "◌", group: "workspace"},
  {id: "canvas", label: "Canvas", icon: "▧", group: "workspace"},
  {id: "bases", label: "Bases", icon: "▦", group: "workspace"},
  {id: "history", label: "History", icon: "◷", group: "review"},
];

export const TITLEBAR_ACTIONS: readonly WorkspaceActionId[] = [
  "open-vault",
  "quick-switcher",
  "command-palette",
  "toggle-left-sidebar",
  "toggle-right-sidebar",
  "settings",
];

export function workspaceAction(id: WorkspaceActionId): WorkspaceAction {
  const action = WORKSPACE_ACTIONS.find((candidate) => candidate.id === id);
  if (!action) throw new Error(`Unknown workspace action: ${id}`);
  return action;
}
