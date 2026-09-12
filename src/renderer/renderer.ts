import {DEFAULT_HISTORY_POLICY, DEFAULT_PROVIDER_SETTINGS, DEFAULT_WORKSPACE_SETTINGS, DEFAULT_WORKSPACE_STATE, type AIChangeSet, type AIOrganizationResponse, type AttachmentReadResponse, type BaseEvaluationView, type BaseResponse, type BaseScalar, type BaseValue, type CanvasNodeView, type CanvasView, type ConversationTurn, type EditorMode, type GraphView, type HistoryPolicy, type NoteContext, type OpenObsidianAPI, type ProviderMode, type ProviderSettings, type ProviderStatus, type ProviderUsageCaps, type RetrievalCitation, type RetrievalProgress, type RetrievalRequest, type RetrievalResponse, type SyncToolDisposition, type VaultHistoryRecord, type WorkspaceSettings, type WorkspaceState} from "../shared/api.js";
import type {LaunchIntent} from "../shared/entry-points.js";
import {decodeBase64, encodeBase64} from "../shared/base64.js";
import {layoutGraph, parseInlineMarkdown, parseMarkdownPreview, resolveKeyboardCommand, styleMatchesName, themeStyleName, type KeyboardCommandId, type MarkdownInlineSegment, type MarkdownPreviewBlock, type ThemeMode, type ThemeStyleAsset, type VaultAppearance} from "../shared/ui/index.js";
import {effectiveThemeMode, previewThemeAssets, safeAppearanceColor, safeAppearanceFontSize} from "./theme-preview.js";
import {localeDirection, message, normalizeLocale, type MessageKey} from "../core/localization.js";
import {MAX_TRANSCLUSION_DEPTH, guardTransclusion, resolveNoteEmbed, selectTransclusionSource, withinTransclusionSourceLimit, type NoteEmbedResolution, type TransclusionGuard} from "../core/transclusion.js";
import {OPEN_OBSIDIAN_THEME, UNINSTALL_CLEANUP_OPTIONS, extractMarkdownTasks, uninstallCleanupOption, vaultPane, workspaceAction, type BookmarkItem, type BookmarkResponse, type DailyNotePlan, type TagIndex, type TaskItem, type TemplateIndex, type UninstallCleanupOptionId, type VaultPane, type VaultPaneId, type WorkspaceActionId} from "../shared/ui/index.js";

type OpenObsidianWindow = Window & {openObsidian?: OpenObsidianAPI};
type VaultSummary = Exclude<Awaited<ReturnType<OpenObsidianAPI["selectVault"]>>, null>;
type NoteTab = {path: string; revision: string | null; content: string; dirty: boolean; loaded: boolean};

const api = (window as unknown as OpenObsidianWindow).openObsidian;
const selectButton = document.querySelector<HTMLButtonElement>("#select-vault");
const searchInput = document.querySelector<HTMLInputElement>("#vault-search");
const fileList = document.querySelector<HTMLElement>("#file-list");
const vaultMode = document.querySelector<HTMLElement>("#vault-mode");
const vaultName = document.querySelector<HTMLElement>("#vault-name");
const vaultBranch = document.querySelector<HTMLElement>("#vault-branch");
const appShell = document.querySelector<HTMLElement>(".app-shell");
const sidebar = document.querySelector<HTMLElement>(".sidebar");
const toggleLeftSidebarButton = document.querySelector<HTMLButtonElement>("#toggle-left-sidebar");
const toggleRightSidebarButton = document.querySelector<HTMLButtonElement>("[data-ui-action=\"toggle-right-sidebar\"]");
const sidebarPaneButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-sidebar-pane]")];
const bookmarksList = document.querySelector<HTMLElement>("#bookmarks-list");
const bookmarksSummary = document.querySelector<HTMLElement>("#bookmarks-summary");
const tagList = document.querySelector<HTMLElement>("#tag-list");
const tagSummary = document.querySelector<HTMLElement>("#tag-summary");
const taskIndexList = document.querySelector<HTMLElement>("#task-index-list");
const taskSummary = document.querySelector<HTMLElement>("#task-summary");
const templateList = document.querySelector<HTMLElement>("#template-list");
const templateSummary = document.querySelector<HTMLElement>("#template-summary");
const dailyNoteButton = document.querySelector<HTMLButtonElement>("#daily-note");
const dailyNoteSummary = document.querySelector<HTMLElement>("#daily-note-summary");
const editorPath = document.querySelector<HTMLElement>("#editor-path");
const editor = document.querySelector<HTMLTextAreaElement>("#note-editor");
const emptyState = document.querySelector<HTMLElement>("#empty-state");
const saveButton = document.querySelector<HTMLButtonElement>("#save-note");
const popoutButton = document.querySelector<HTMLButtonElement>("#popout-note");
const reviewButton = document.querySelector<HTMLButtonElement>("#review-changes");
const historyButton = document.querySelector<HTMLButtonElement>("#show-history");
const changePanel = document.querySelector<HTMLElement>("#change-panel");
const closeChangesButton = document.querySelector<HTMLButtonElement>("#close-changes");
const changeSummary = document.querySelector<HTMLElement>("#change-summary");
const changeList = document.querySelector<HTMLElement>("#change-list");
const diffPath = document.querySelector<HTMLSelectElement>("#diff-path");
const diffStaged = document.querySelector<HTMLInputElement>("#diff-staged");
const diffOutput = document.querySelector<HTMLElement>("#diff-output");
const commitMessage = document.querySelector<HTMLInputElement>("#commit-message");
const commitSelectedButton = document.querySelector<HTMLButtonElement>("#commit-selected");
const historyPanel = document.querySelector<HTMLElement>("#history-panel");
const closeHistoryButton = document.querySelector<HTMLButtonElement>("#close-history");
const historySummary = document.querySelector<HTMLElement>("#history-summary");
const historyList = document.querySelector<HTMLElement>("#history-list");
const retentionSummary = document.querySelector<HTMLElement>("#retention-summary");
const reviewRetentionButton = document.querySelector<HTMLButtonElement>("#review-retention");
const cleanupHistoryButton = document.querySelector<HTMLButtonElement>("#cleanup-history");
const syncToolList = document.querySelector<HTMLElement>("#sync-tool-list");
const conflictBox = document.querySelector<HTMLElement>("#conflict-box");
const conflictTitle = document.querySelector<HTMLElement>("#conflict-title");
const conflictSummary = document.querySelector<HTMLElement>("#conflict-summary");
const conflictOutput = document.querySelector<HTMLElement>("#conflict-output");
const closeConflictButton = document.querySelector<HTMLButtonElement>("#close-conflict");
const keepCurrentButton = document.querySelector<HTMLButtonElement>("#keep-current");
const keepIncomingButton = document.querySelector<HTMLButtonElement>("#keep-incoming");
const status = document.querySelector<HTMLDivElement>("#status");
const noteTabs = document.querySelector<HTMLElement>("#note-tabs");
const editorStage = document.querySelector<HTMLElement>("#editor-stage");
const notePreview = document.querySelector<HTMLElement>("#note-preview");
const editorModeButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-editor-mode]")];
const contextPane = document.querySelector<HTMLElement>("#context-pane");
const toggleContextButton = document.querySelector<HTMLButtonElement>("#toggle-context");
const outlineList = document.querySelector<HTMLElement>("#outline-list");
const outgoingLinksList = document.querySelector<HTMLElement>("#outgoing-links-list");
const backlinksList = document.querySelector<HTMLElement>("#backlinks-list");
const taskList = document.querySelector<HTMLElement>("#task-list");
const quickSwitcher = document.querySelector<HTMLDialogElement>("#quick-switcher");
const openQuickSwitcherButton = document.querySelector<HTMLButtonElement>("#open-quick-switcher");
const closeQuickSwitcherButton = document.querySelector<HTMLButtonElement>("#close-quick-switcher");
const quickQuery = document.querySelector<HTMLInputElement>("#quick-query");
const quickResults = document.querySelector<HTMLElement>("#quick-results");
const commandPalette = document.querySelector<HTMLDialogElement>("#command-palette");
const openCommandPaletteButton = document.querySelector<HTMLButtonElement>("#open-command-palette");
const closeCommandPaletteButton = document.querySelector<HTMLButtonElement>("#close-command-palette");
const commandQuery = document.querySelector<HTMLInputElement>("#command-query");
const commandResults = document.querySelector<HTMLElement>("#command-results");
const openRetrievalButton = document.querySelector<HTMLButtonElement>("#open-retrieval");
const retrievalPanel = document.querySelector<HTMLElement>("#retrieval-panel");
const closeRetrievalButton = document.querySelector<HTMLButtonElement>("#close-retrieval");
const retrievalForm = document.querySelector<HTMLFormElement>("#retrieval-form");
const retrievalQuery = document.querySelector<HTMLInputElement>("#retrieval-query");
const retrievalFolder = document.querySelector<HTMLInputElement>("#retrieval-folder");
const retrievalTags = document.querySelector<HTMLInputElement>("#retrieval-tags");
const retrievalExcluded = document.querySelector<HTMLInputElement>("#retrieval-excluded");
const runRetrievalButton = document.querySelector<HTMLButtonElement>("#run-retrieval");
const retrievalMeta = document.querySelector<HTMLElement>("#retrieval-meta");
const retrievalAnswer = document.querySelector<HTMLElement>("#retrieval-answer");
const retrievalResults = document.querySelector<HTMLElement>("#retrieval-results");
const exportConversationButton = document.querySelector<HTMLButtonElement>("#export-conversation");
const conversationExportOutput = document.querySelector<HTMLElement>("#conversation-export");
const sourceInspector = document.querySelector<HTMLElement>("#source-inspector");
const sourceInspectorPath = document.querySelector<HTMLElement>("#source-inspector-path");
const sourceInspectorMeta = document.querySelector<HTMLElement>("#source-inspector-meta");
const sourceInspectorSnippet = document.querySelector<HTMLElement>("#source-inspector-snippet");
const openSourceInspectorButton = document.querySelector<HTMLButtonElement>("#open-source-inspector");
const openAIReviewButton = document.querySelector<HTMLButtonElement>("#open-ai-review");
const aiPanel = document.querySelector<HTMLElement>("#ai-panel");
const closeAIPanelButton = document.querySelector<HTMLButtonElement>("#close-ai");
const aiForm = document.querySelector<HTMLFormElement>("#ai-form");
const aiTarget = document.querySelector<HTMLSelectElement>("#ai-target");
const aiInstruction = document.querySelector<HTMLInputElement>("#ai-instruction");
const aiSummary = document.querySelector<HTMLElement>("#ai-summary");
const aiChanges = document.querySelector<HTMLElement>("#ai-changes");
const applyAIButton = document.querySelector<HTMLButtonElement>("#apply-ai");
const undoAIButton = document.querySelector<HTMLButtonElement>("#undo-ai");
const suggestAIButton = document.querySelector<HTMLButtonElement>("#suggest-ai");
const aiOrganization = document.querySelector<HTMLElement>("#ai-organization");
const settingsPanel = document.querySelector<HTMLElement>("#settings-panel");
const toggleSettingsButton = document.querySelector<HTMLButtonElement>("#toggle-settings");
const closeSettingsButton = document.querySelector<HTMLButtonElement>("#close-settings");
const settingsSearch = document.querySelector<HTMLInputElement>("#settings-search");
const settingsSearchStatus = document.querySelector<HTMLElement>("#settings-search-status");
const settingsSections = [...document.querySelectorAll<HTMLElement>("[data-settings-section]")];
const appearanceTheme = document.querySelector<HTMLSelectElement>("#appearance-theme");
const appearanceMode = document.querySelector<HTMLSelectElement>("#appearance-mode");
const appearanceSnippets = document.querySelector<HTMLFieldSetElement>("#appearance-snippets");
const appearanceSnippetsEmpty = document.querySelector<HTMLElement>("#appearance-snippets-empty");
const appearanceSummary = document.querySelector<HTMLElement>("#appearance-summary");
const appearanceSafety = document.querySelector<HTMLElement>("#appearance-safety");
const uninstallCleanupChoices = [...document.querySelectorAll<HTMLInputElement>("[data-uninstall-choice]")];
const uninstallCleanupSummary = document.querySelector<HTMLElement>("#uninstall-cleanup-summary");
const defaultEditorMode = document.querySelector<HTMLSelectElement>("#default-editor-mode");
const splitView = document.querySelector<HTMLInputElement>("#split-view");
const historyAgeDays = document.querySelector<HTMLInputElement>("#history-age-days");
const historyMaxMiB = document.querySelector<HTMLInputElement>("#history-max-mib");
const providerMode = document.querySelector<HTMLSelectElement>("#provider-mode");
const providerModel = document.querySelector<HTMLInputElement>("#provider-model");
const providerEndpoint = document.querySelector<HTMLInputElement>("#provider-endpoint");
const providerCredentialRef = document.querySelector<HTMLInputElement>("#provider-credential-ref");
const providerSecret = document.querySelector<HTMLInputElement>("#provider-secret");
const providerMaxRequests = document.querySelector<HTMLInputElement>("#provider-max-requests");
const providerMaxInput = document.querySelector<HTMLInputElement>("#provider-max-input");
const providerMaxOutput = document.querySelector<HTMLInputElement>("#provider-max-output");
const providerMaxCost = document.querySelector<HTMLInputElement>("#provider-max-cost");
const saveProviderButton = document.querySelector<HTMLButtonElement>("#save-provider");
const saveProviderCredentialButton = document.querySelector<HTMLButtonElement>("#save-provider-credential");
const refreshProviderButton = document.querySelector<HTMLButtonElement>("#refresh-provider");
const providerStatusOutput = document.querySelector<HTMLElement>("#provider-status");
const showDiagnosticsButton = document.querySelector<HTMLButtonElement>("#show-diagnostics");
const diagnosticsOutput = document.querySelector<HTMLElement>("#diagnostics-output");
const extensionBisectButton = document.querySelector<HTMLButtonElement>("#extension-bisect");
const showModelHandoffButton = document.querySelector<HTMLButtonElement>("#show-model-handoff");
const showAccountBillingHandoffButton = document.querySelector<HTMLButtonElement>("#show-account-billing-handoff");
const safeModeButton = document.querySelector<HTMLButtonElement>("#safe-mode-action");
const openGraphButton = document.querySelector<HTMLButtonElement>("#open-graph");
const openCanvasButton = document.querySelector<HTMLButtonElement>("#open-canvas");
const openBaseButton = document.querySelector<HTMLButtonElement>("#open-base");
const graphPanel = document.querySelector<HTMLElement>("#graph-panel");
const closeGraphButton = document.querySelector<HTMLButtonElement>("#close-graph");
const graphQuery = document.querySelector<HTMLInputElement>("#graph-query");
const graphNodeKind = document.querySelector<HTMLSelectElement>("#graph-node-kind");
const graphEdgeKind = document.querySelector<HTMLSelectElement>("#graph-edge-kind");
const graphLayout = document.querySelector<HTMLSelectElement>("#graph-layout");
const graphSummary = document.querySelector<HTMLElement>("#graph-summary");
const graphSurface = document.querySelector<SVGSVGElement>("#graph-surface");
const graphNodeList = document.querySelector<HTMLElement>("#graph-node-list");
const graphEdgeList = document.querySelector<HTMLElement>("#graph-edge-list");
const canvasPanel = document.querySelector<HTMLElement>("#canvas-panel");
const closeCanvasButton = document.querySelector<HTMLButtonElement>("#close-canvas");
const canvasFile = document.querySelector<HTMLSelectElement>("#canvas-file");
const canvasSummary = document.querySelector<HTMLElement>("#canvas-summary");
const canvasNodeList = document.querySelector<HTMLElement>("#canvas-node-list");
const canvasEdgeList = document.querySelector<HTMLElement>("#canvas-edge-list");
const basePanel = document.querySelector<HTMLElement>("#base-panel");
const closeBaseButton = document.querySelector<HTMLButtonElement>("#close-base");
const baseFile = document.querySelector<HTMLSelectElement>("#base-file");
const baseView = document.querySelector<HTMLSelectElement>("#base-view");
const baseSummary = document.querySelector<HTMLElement>("#base-summary");
const baseIssues = document.querySelector<HTMLElement>("#base-issues");
const baseResults = document.querySelector<HTMLElement>("#base-results");
let selectedSummary: VaultSummary | null = null;
let selectedPath: string | null = null;
let selectedRevision: string | null = null;
let dirty = false;
let requestId = 0;
let previewGeneration = 0;
type PreviewEmbedContext = {sourcePath: string; depth: number; chain: readonly string[]};
const previewEmbedContexts = new WeakMap<HTMLElement, PreviewEmbedContext>();
let changeReview: Awaited<ReturnType<OpenObsidianAPI["reviewChanges"]>> | null = null;
let workspaceSettings: WorkspaceSettings = {...DEFAULT_WORKSPACE_SETTINGS, historyPolicy: {...DEFAULT_HISTORY_POLICY}};
let workspaceState: WorkspaceState = {...DEFAULT_WORKSPACE_STATE, settings: workspaceSettings, openTabs: [], navigationHistory: []};
let providerSettings: ProviderSettings = DEFAULT_PROVIDER_SETTINGS;
let tabStates: NoteTab[] = [];
let contextRequestId = 0;
let paletteRequestId = 0;
let selectedConflict: VaultHistoryRecord | null = null;
let workspaceStateReady: Promise<void> = Promise.resolve();
let leftSidebarVisible = true;
let activeVaultPane: VaultPaneId = "files";
let vaultFiles: Awaited<ReturnType<OpenObsidianAPI["listFiles"]>> = [];
let bookmarkData: BookmarkResponse | null = null;
let tagData: TagIndex | null = null;
let taskData: TaskItem[] = [];
let templateData: TemplateIndex | null = null;
let dailyNoteData: DailyNotePlan | null = null;
let graphData: GraphView | null = null;
let canvasData: CanvasView | null = null;
let baseData: BaseResponse | null = null;
let retrievalData: RetrievalResponse | null = null;
let conversationTurns: ConversationTurn[] = [];
let pendingCitation: RetrievalCitation | null = null;
let sourceInspectorCitation: RetrievalCitation | null = null;
let aiChangeSet: AIChangeSet | null = null;
let aiUndoId: string | null = null;
let appearanceData: VaultAppearance | null = null;
let appearanceStyleElements: HTMLStyleElement[] = [];
const uiLocale = normalizeLocale(navigator.language);

const providerIds: Record<ProviderMode, ProviderSettings["providerId"]> = {managed: "openrouter-proxy", byok: "openai-compatible", local: "local-openai-compatible"};

function setStatus(message: string): void {
  if (status) status.textContent = message;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function gitSummaryMessage(git: VaultSummary["git"]): string {
  if (git.vaultType !== "chronicle") return "Standard";
  return git.dirty ? "Chronicle · dirty" : "Chronicle · clean";
}

function scanSummaryMessage(summary: VaultSummary): string {
  return summary.unchanged ? "no-op scan verified" : "changed during scan";
}

function summaryMessage(summary: Awaited<ReturnType<OpenObsidianAPI["selectVault"]>>): string {
  if (!summary) return "No vault selected.";
  return `Opened ${summary.root} · ${gitSummaryMessage(summary.git)} · ${summary.fileCount} files · ${scanSummaryMessage(summary)} · ${summary.sha256.slice(0, 12)}…`;
}

function setText(element: HTMLElement | null, value: string): void {
  if (element) element.textContent = value;
}

function applyLocale(): void {
  document.documentElement.lang = uiLocale;
  document.documentElement.dir = localeDirection(uiLocale);
  document.querySelectorAll<HTMLElement>("[data-message-key]").forEach((element) => {
    const key = element.dataset.messageKey as MessageKey | undefined;
    if (key) element.textContent = message(uiLocale, key);
  });
}

function setDisabled(element: HTMLButtonElement | HTMLTextAreaElement | null, value: boolean): void {
  if (element) element.disabled = value;
}

function setHidden(element: HTMLElement | null, value: boolean): void {
  if (element) element.hidden = value;
}

function settingsSectionMatches(section: HTMLElement, query: string): boolean {
  const haystack = `${section.dataset.settingsSection ?? ""} ${section.textContent ?? ""}`.toLocaleLowerCase();
  return !query || haystack.includes(query);
}

function settingsQueryValue(): string {
  return settingsSearch?.value.trim().toLocaleLowerCase() ?? "";
}

function visibleSettingsSectionCount(query: string): number {
  let visible = 0;
  for (const section of settingsSections) {
    const matches = settingsSectionMatches(section, query);
    setHidden(section, !matches);
    visible += Number(matches);
  }
  return visible;
}

function settingsSearchMessage(query: string, visible: number): string {
  if (!query) return "Showing all settings.";
  return `${visible} setting section${visible === 1 ? "" : "s"} match “${query}”.`;
}

function renderSettingsSearch(): void {
  const query = settingsQueryValue();
  setText(settingsSearchStatus, settingsSearchMessage(query, visibleSettingsSectionCount(query)));
}

function selectedUninstallCleanupLabels(): string[] {
  return uninstallCleanupChoices.flatMap((choice) => {
    const id = choice.dataset.uninstallChoice as UninstallCleanupOptionId | undefined;
    return choice.checked && id ? [uninstallCleanupOption(id).label] : [];
  });
}

function renderUninstallCleanupSummary(): void {
  const labels = selectedUninstallCleanupLabels();
  setText(uninstallCleanupSummary, labels.length ? `Selected local cleanup: ${labels.join(", ")}. The vault remains preserved.` : "No local cleanup selected; the vault remains preserved.");
}

function applyUninstallCleanupMetadata(): void {
  const knownIds = new Set(UNINSTALL_CLEANUP_OPTIONS.map((option) => option.id));
  uninstallCleanupChoices.forEach((choice) => {
    const id = choice.dataset.uninstallChoice as UninstallCleanupOptionId | undefined;
    if (!id || !knownIds.has(id)) {
      choice.disabled = true;
      return;
    }
    const option = uninstallCleanupOption(id);
    choice.title = option.description;
    choice.defaultChecked = option.defaultSelected;
    choice.addEventListener("change", renderUninstallCleanupSummary);
  });
  renderUninstallCleanupSummary();
}

function openSettingsPanel(): void {
  if (!settingsPanel) return;
  togglePanel(settingsPanel, true);
  renderSettingsSearch();
  settingsSearch?.focus();
}

function reportExternalHandoff(label: string): void {
  setStatus(`${label} remains external-pending; no unsupported runtime action was started.`);
}

function applySharedDesignTokens(): void {
  const {colors, metrics, radii, spacing} = OPEN_OBSIDIAN_THEME;
  const tokens: Record<string, string> = {
    "--chrome": colors.chrome,
    "--chrome-raised": colors.chromeRaised,
    "--panel": colors.panel,
    "--rail": colors.rail,
    "--panel-border": colors.border,
    "--text": colors.text,
    "--text-muted": colors.textMuted,
    "--accent": colors.accent,
    "--layout-titlebar-height": `${metrics.titlebarHeight}px`,
    "--layout-ribbon-width": `${metrics.ribbonWidth}px`,
    "--layout-sidebar-width": `${metrics.sidebarWidth}px`,
    "--layout-icon-size": `${metrics.iconSize}px`,
    "--layout-workspace-header-height": `${metrics.workspaceHeaderHeight}px`,
    "--layout-tab-strip-height": `${metrics.tabStripHeight}px`,
    "--layout-editor-toolbar-height": `${metrics.editorToolbarHeight}px`,
    "--layout-status-footer-height": `${metrics.statusFooterHeight}px`,
    "--space-xs": `${spacing.xs}px`,
    "--space-sm": `${spacing.sm}px`,
    "--space-md": `${spacing.md}px`,
    "--space-lg": `${spacing.lg}px`,
    "--radius-control": `${radii.control}px`,
    "--radius-panel": `${radii.panel}px`,
  };
  Object.entries(tokens).forEach(([name, value]) => document.documentElement.style.setProperty(name, value));
}

function selectedAppearanceAssets(): ThemeStyleAsset[] {
  if (!appearanceData) return [];
  const themePath = appearanceTheme?.value ?? "";
  const snippets = new Set([...document.querySelectorAll<HTMLInputElement>("#appearance-snippets input[data-appearance-snippet]")].filter((input) => input.checked).map((input) => input.value));
  return appearanceData.styles.filter((asset) => (asset.kind === "theme" && asset.relativePath === themePath) || (asset.kind === "snippet" && snippets.has(asset.relativePath)));
}

function themeScope(mode: "light" | "dark"): string {
  return `.app-shell[data-openobsidian-theme-mode="${mode}"]`;
}

function setAppearanceMode(mode: "light" | "dark"): void {
  if (!appShell) return;
  appShell.dataset.openobsidianThemeMode = mode;
  appShell.classList.toggle("theme-light", mode === "light");
  appShell.classList.toggle("theme-dark", mode === "dark");
}

function setAppearanceFontSize(data: VaultAppearance): void {
  if (!appShell) return;
  const fontSize = safeAppearanceFontSize(data.settings.baseFontSize);
  if (fontSize) appShell.style.fontSize = fontSize;
  else appShell.style.removeProperty("font-size");
}

function setAppearanceAccent(data: VaultAppearance): void {
  if (!appShell) return;
  const accent = safeAppearanceColor(data.settings.accentColor);
  if (accent) appShell.style.setProperty("--accent", accent);
  else appShell.style.removeProperty("--accent");
}

function applyAppearanceSurface(data: VaultAppearance, mode: "light" | "dark"): void {
  setAppearanceMode(mode);
  setAppearanceFontSize(data);
  setAppearanceAccent(data);
}

function setAppearancePreviewState(blocked: boolean): void {
  if (appearanceSafety) appearanceSafety.dataset.state = blocked ? "blocked" : "ready";
}

function appearanceStatusText(mode: "light" | "dark", applied: readonly string[], blocked: readonly string[]): string {
  const summary = `${applied.length} safe preview style${applied.length === 1 ? "" : "s"} applied in ${mode} mode${blocked.length ? ` · ${blocked.length} withheld for review` : ""}. Vault appearance files remain read-only.`;
  return blocked.length > 0 ? `${summary} ${blocked.join(" · ")}` : summary;
}

function clearAppearanceStyles(): void {
  appearanceStyleElements.forEach((style) => style.remove());
  appearanceStyleElements = [];
}

function selectedAppearanceMode(data: VaultAppearance): ThemeMode {
  const value = appearanceMode?.value ?? "";
  return ["light", "dark", "system"].includes(value) ? (value as ThemeMode) : data.settings.mode;
}

function applySelectedAppearance(): void {
  clearAppearanceStyles();
  if (!appearanceData) {
    appShell?.removeAttribute("data-openobsidian-theme-mode");
    return;
  }
  if (!appShell) return;
  const data = appearanceData;
  const mode = effectiveThemeMode(selectedAppearanceMode(data));
  applyAppearanceSurface(data, mode);
  const preview = previewThemeAssets(selectedAppearanceAssets(), mode, themeScope(mode));
  appearanceStyleElements = preview.styles;
  setText(appearanceSafety, appearanceStatusText(mode, preview.applied, preview.blocked));
  setAppearancePreviewState(preview.blocked.length > 0);
}
function renderAppearanceThemeOptions(data: VaultAppearance): void {
  if (!appearanceTheme) return;
  const themes = data.styles.filter((asset) => asset.kind === "theme");
  appearanceTheme.replaceChildren(new Option("OpenObsidian base", ""), ...themes.map((asset) => new Option(themeStyleName(asset.relativePath), asset.relativePath)));
  const configuredTheme = themes.find((asset) => styleMatchesName(asset.relativePath, data.settings.cssTheme));
  appearanceTheme.value = configuredTheme?.relativePath ?? "";
}

function appendAppearanceSnippet(asset: ThemeStyleAsset, configured: readonly string[]): void {
  if (!appearanceSnippets) return;
  const label = document.createElement("label");
  label.className = "appearance-snippet-option";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.dataset.appearanceSnippet = "true";
  input.value = asset.relativePath;
  input.checked = configured.some((name) => styleMatchesName(asset.relativePath, name) || name === asset.relativePath);
  input.addEventListener("change", applySelectedAppearance);
  const text = document.createElement("span");
  text.textContent = themeStyleName(asset.relativePath);
  label.append(input, text);
  appearanceSnippets.append(label);
}

function renderAppearanceSnippets(data: VaultAppearance): void {
  if (!appearanceSnippets) return;
  appearanceSnippets.querySelectorAll(".appearance-snippet-option").forEach((node) => node.remove());
  const snippets = data.styles.filter((asset) => asset.kind === "snippet");
  setHidden(appearanceSnippetsEmpty, snippets.length === 0);
  snippets.forEach((asset) => appendAppearanceSnippet(asset, data.settings.enabledCssSnippets));
}

type AppearanceControls = {
  theme: HTMLSelectElement;
  mode: HTMLSelectElement;
  snippets: HTMLFieldSetElement;
};

function appearanceControls(): AppearanceControls | null {
  const controls = {theme: appearanceTheme, mode: appearanceMode, snippets: appearanceSnippets};
  if (Object.values(controls).some((control) => !control)) return null;
  return controls as AppearanceControls;
}

function disableAppearanceControls(): void {
  appearanceTheme?.setAttribute("disabled", "true");
  appearanceMode?.setAttribute("disabled", "true");
  appearanceSnippets?.setAttribute("disabled", "true");
}

function appearanceSummaryText(data: VaultAppearance): string {
  const assetLabel = data.styles.length === 1 ? "asset" : "assets";
  const settingsSource = data.settingsPath ? ` from ${data.settingsPath}` : "";
  return `${data.styles.length} CSS ${assetLabel} discovered${settingsSource}. Selection is a renderer-only safe preview; no vault file is modified.`;
}

function renderAppearanceControls(): void {
  const controls = appearanceControls();
  if (!controls) {
    disableAppearanceControls();
    return;
  }
  if (!appearanceData) {
    disableAppearanceControls();
    return;
  }
  const data = appearanceData;
  renderAppearanceThemeOptions(data);
  controls.mode.value = effectiveThemeMode(data.settings.mode);
  controls.theme.disabled = false;
  controls.mode.disabled = false;
  controls.snippets.disabled = false;
  renderAppearanceSnippets(data);
  setText(appearanceSummary, appearanceSummaryText(data));
  applySelectedAppearance();
}

function resetAppearanceControls(): void {
  if (appearanceTheme) {
    appearanceTheme.replaceChildren(new Option("OpenObsidian base", ""));
    appearanceTheme.value = "";
    appearanceTheme.disabled = true;
  }
  appearanceMode?.setAttribute("disabled", "true");
  appearanceSnippets?.setAttribute("disabled", "true");
  appearanceSnippets?.querySelectorAll(".appearance-snippet-option").forEach((node) => node.remove());
}

function clearAppearance(): void {
  clearAppearanceStyles();
  appearanceData = null;
  appShell?.removeAttribute("data-openobsidian-theme-mode");
  appShell?.classList.remove("theme-light", "theme-dark");
  appShell?.style.removeProperty("font-size");
  appShell?.style.removeProperty("--accent");
  resetAppearanceControls();
  setText(appearanceSummary, "Open a vault to inspect its read-only appearance configuration.");
  setText(appearanceSafety, "Raw CSS, imports, URL assets and privileged selectors are never applied.");
  if (appearanceSafety) delete appearanceSafety.dataset.state;
}

async function loadAppearance(client: OpenObsidianAPI): Promise<void> {
  try {
    appearanceData = await client.loadAppearance();
    renderAppearanceControls();
  } catch (error) {
    clearAppearance();
    setStatus(errorText(error, "Unable to load appearance configuration; the base OpenObsidian theme remains active."));
  }
}

function applySharedActionMetadata(): void {
  document.querySelectorAll<HTMLElement>("[data-ui-action]").forEach((element) => {
    const id = element.dataset.uiAction as WorkspaceActionId | undefined;
    if (!id) return;
    const action = workspaceAction(id);
    element.dataset.icon = action.icon;
    element.title = action.label;
    element.setAttribute("aria-label", action.label);
  });
}

function applySharedVaultPaneMetadata(): void {
  sidebarPaneButtons.forEach((element) => {
    const id = element.dataset.sidebarPane as VaultPaneId | undefined;
    if (!id) return;
    const pane: VaultPane = vaultPane(id);
    element.dataset.icon = pane.icon;
    element.title = pane.label;
    element.setAttribute("aria-label", pane.label);
  });
}

const bookmarkKindLabels: Partial<Record<BookmarkItem["kind"], string>> = {file: "File", folder: "Folder", search: "Search", block: "Block", group: "Group"};

function bookmarkMeta(item: BookmarkItem): string {
  return `${bookmarkKindLabels[item.kind] ?? "Bookmark"} · ${bookmarkTarget(item)}${item.subpath ?? ""}`;
}

function bookmarkTarget(item: BookmarkItem): string {
  if (item.kind === "search") return item.query ?? "";
  return item.path ?? "Group";
}

function openSearchBookmark(item: BookmarkItem): void {
  const query = item.query ?? "";
  setVaultPane("search");
  if (searchInput) searchInput.value = query;
  searchVault(query);
}

function openFolderBookmark(item: BookmarkItem): void {
  if (!item.path) return;
  const first = vaultFiles.find((file) => file.kind === "file" && (file.relativePath === item.path || file.relativePath.startsWith(`${item.path}/`)));
  if (first) openFile(first.relativePath);
  else setStatus(`Bookmark folder ${item.path} is empty; no file was opened.`);
}

const bookmarkActions: Partial<Record<BookmarkItem["kind"], (item: BookmarkItem) => void>> = {search: openSearchBookmark, folder: openFolderBookmark, file: openPathBookmark, block: openPathBookmark};

function openBookmark(item: BookmarkItem): void {
  if (!item.available) {
    setStatus(`Bookmark target ${item.path ?? item.title} is missing; no file was opened.`);
    return;
  }
  bookmarkActions[item.kind]?.(item);
}

function openPathBookmark(item: BookmarkItem): void {
  if (!item.path) return;
  openFile(item.path);
  if (item.kind === "block" && item.subpath) setStatus(`Opened ${item.path}; bookmark target ${item.subpath} remains source-preserving.`);
}

function bookmarkNodes(items: BookmarkItem[]): Node[] {
  const nodes: Node[] = [];
  items.forEach((item) => nodes.push(...bookmarkNode(item)));
  return nodes;
}

function bookmarkNode(item: BookmarkItem): Node[] {
  if (item.kind === "group") {
    const heading = document.createElement("h3");
    heading.className = "workflow-group";
    heading.textContent = item.title;
    return [heading, ...bookmarkNodes(item.items ?? [])];
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "workflow-row";
  button.disabled = !item.available;
  const meta = bookmarkMeta(item);
  button.title = item.available ? meta : `${meta} · missing`;
  const title = document.createElement("span");
  title.textContent = item.title;
  const detail = document.createElement("small");
  detail.textContent = button.title;
  button.append(title, detail);
  button.addEventListener("click", () => openBookmark(item));
  return [button];
}

function bookmarkSummaryText(data: BookmarkResponse | null): string {
  if (!data) return "Open a vault to load bookmarks.";
  if (data.source === "missing") return "No Obsidian bookmark configuration found.";
  return `${bookmarkCountText(data.items.length)}${bookmarkIssueText(data.issues.length)}.`;
}

function bookmarkCountText(count: number): string {
  return `${count} bookmark${count === 1 ? "" : "s"} loaded`;
}

function bookmarkIssueText(count: number): string {
  return count ? ` · ${count} issue${count === 1 ? "" : "s"}` : "";
}

function renderBookmarkEmpty(data: BookmarkResponse | null): void {
  if (!bookmarksList) return;
  const empty = document.createElement("p");
  empty.className = "empty-list";
  empty.textContent = data?.issues[0] ?? "No bookmarks configured.";
  bookmarksList.append(empty);
}

function renderBookmarkSummary(data: BookmarkResponse | null): void {
  if (!bookmarksSummary) return;
  bookmarksSummary.textContent = bookmarkSummaryText(data);
  bookmarksList?.append(bookmarksSummary);
}

function renderBookmarks(data: BookmarkResponse | null): void {
  if (!bookmarksList) return;
  bookmarksList.replaceChildren();
  renderBookmarkSummary(data);
  if (data && data.items.length > 0) {
    bookmarksList.append(...bookmarkNodes(data.items));
    return;
  }
  renderBookmarkEmpty(data);
}

function tagSummaryText(data: TagIndex | null): string {
  if (!data) return "Open a vault.";
  return `${countLabel(data.tags.length, "tag")} · ${data.filesScanned} files`;
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function vaultIndexItem(labelText: string, metaText: string, title: string, action: () => void): HTMLLIElement {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "vault-index-row";
  const label = document.createElement("span");
  label.textContent = labelText;
  const count = document.createElement("small");
  count.textContent = metaText;
  button.append(label, count);
  button.title = title;
  button.addEventListener("click", action);
  item.append(button);
  return item;
}

function tagIndexItem(tag: TagIndex["tags"][number]): HTMLLIElement {
  const first = tag.files[0];
  return vaultIndexItem(`#${tag.tag}`, countLabel(tag.files.length, "file"), countLabel(tag.count, "occurrence"), () => {
    if (first) openFile(first.relativePath);
  });
}

function renderTagIndex(data: TagIndex | null): void {
  setText(tagSummary, tagSummaryText(data));
  if (!tagList) return;
  tagList.replaceChildren();
  if (!data || data.tags.length === 0) {
    const empty = document.createElement("li");
    empty.className = "workflow-summary";
    empty.textContent = "No tags indexed.";
    tagList.append(empty);
    return;
  }
  tagList.append(...data.tags.map(tagIndexItem));
}

function taskRevision(task: TaskItem): string | null {
  return task.revision ?? (task.relativePath === selectedPath ? selectedRevision : null);
}

function taskToggleBlockReason(task: TaskItem, revision: string | null): string | undefined {
  if (!api) return "This task has no current revision; reopen the vault before changing it.";
  if (!revision) return "This task has no current revision; reopen the vault before changing it.";
  if (taskNeedsSave(task)) return "Save the current note before toggling a task; unsaved source remains unchanged.";
  return undefined;
}

function taskNeedsSave(task: TaskItem): boolean {
  return task.relativePath === selectedPath && dirty;
}

function taskToggleError(error: unknown): string {
  return errorText(error, "Unable to update the task; the original note bytes remain authoritative.");
}

function applyTaskRead(task: TaskItem, updated: Awaited<ReturnType<OpenObsidianAPI["toggleTask"]>>): void {
  if (task.relativePath === selectedPath) applyReadResponse(updated);
}

async function performTaskToggle(client: OpenObsidianAPI, task: TaskItem, revision: string, checkbox: HTMLInputElement): Promise<void> {
  const updated = await client.toggleTask({relativePath: task.relativePath, expectedRevision: revision, line: task.line, checked: checkbox.checked});
  applyTaskRead(task, updated);
  await loadWorkflowIndexes(client);
}

async function toggleTaskItem(task: TaskItem, checkbox: HTMLInputElement): Promise<void> {
  const client = api;
  const revision = taskRevision(task);
  const blocked = taskToggleBlockReason(task, revision);
  if (blocked) {
    checkbox.checked = task.checked;
    setStatus(blocked);
    return;
  }
  checkbox.disabled = true;
  try {
    await performTaskToggle(client!, task, revision!, checkbox);
    setStatus(`Updated task in ${task.relativePath} at line ${task.line}; surrounding Markdown and recurrence text were preserved.`);
  } catch (error) {
    checkbox.checked = task.checked;
    checkbox.disabled = false;
    setStatus(taskToggleError(error));
  }
}

function taskContextItem(task: TaskItem): HTMLLIElement {
  const item = document.createElement("li");
  const label = document.createElement("label");
  label.className = "task-context-item";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = task.checked;
  checkbox.disabled = !taskRevision(task) || dirty;
  checkbox.setAttribute("aria-label", `${task.checked ? "Complete" : "Incomplete"} task: ${task.text}`);
  const content = document.createElement("span");
  content.textContent = task.text;
  const meta = document.createElement("small");
  meta.textContent = `line ${task.line}${task.recurrence ? ` · ${task.recurrence}` : ""}`;
  content.append(meta);
  label.append(checkbox, content);
  checkbox.addEventListener("change", () => void toggleTaskItem(task, checkbox));
  item.append(label);
  return item;
}

function renderTaskContext(): void {
  const tasks = selectedPath && editor ? extractMarkdownTasks(editor.value, selectedPath).map((task) => ({...task, revision: selectedRevision ?? undefined})) : [];
  renderContextList(taskList, tasks.map(taskContextItem), "No tasks in this note.");
}

function taskIndexItem(task: TaskItem): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "task-index-row";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = task.checked;
  checkbox.disabled = !taskRevision(task);
  checkbox.setAttribute("aria-label", `${task.checked ? "Complete" : "Incomplete"} task in ${task.relativePath}`);
  checkbox.addEventListener("change", () => void toggleTaskItem(task, checkbox));
  const button = document.createElement("button");
  button.type = "button";
  button.className = "vault-index-row";
  const text = document.createElement("span");
  text.textContent = task.text;
  const meta = document.createElement("small");
  meta.textContent = `${task.relativePath}:${task.line}`;
  button.append(text, meta);
  button.addEventListener("click", () => openFile(task.relativePath));
  item.append(checkbox, button);
  return item;
}

function renderTaskIndex(tasks: TaskItem[]): void {
  setText(taskSummary, `${tasks.length} task${tasks.length === 1 ? "" : "s"}`);
  if (!taskIndexList) return;
  taskIndexList.replaceChildren(...tasks.map(taskIndexItem));
  if (tasks.length === 0) {
    const empty = document.createElement("li");
    empty.className = "workflow-summary";
    empty.textContent = "No tasks indexed.";
    taskIndexList.append(empty);
  }
}

function templateSummaryText(data: TemplateIndex | null): string {
  if (!data) return "No vault open.";
  if (data.source === "missing") return "Not configured.";
  const summary = countLabel(data.items.length, "template");
  return data.issues.length > 0 ? `${summary} · ${countLabel(data.issues.length, "issue")}` : summary;
}

function templateIndexItem(template: TemplateIndex["items"][number]): HTMLLIElement {
  return vaultIndexItem(template.title, template.relativePath, "Open template source; template scripts are not executed.", () => openFile(template.relativePath));
}

function renderTemplateIndex(data: TemplateIndex | null): void {
  setText(templateSummary, templateSummaryText(data));
  if (!templateList) return;
  templateList.replaceChildren(...templateRows(data));
}

function templateRows(data: TemplateIndex | null): Node[] {
  if (!data) return [workflowEmpty("No templates configured.")];
  if (data.items.length === 0) return [workflowEmpty(data.issues[0] ?? "No templates configured.")];
  return data.items.map(templateIndexItem);
}

function workflowEmpty(text: string): HTMLLIElement {
  const empty = document.createElement("li");
  empty.className = "workflow-summary";
  empty.textContent = text;
  return empty;
}

function dailyNoteIssue(data: DailyNotePlan, fallback: string): string {
  return data.issues[0] ?? fallback;
}

function configuredDailyNoteSummary(data: DailyNotePlan): string {
  const state = data.exists ? "ready" : "created on open";
  const template = data.template ? " · plain-text template" : "";
  return `${data.relativePath} · ${state}${template}`;
}

function dailyNoteSummaryText(data: DailyNotePlan | null): string {
  if (!data) return "Daily notes are not configured.";
  if (data.source === "missing") return dailyNoteIssue(data, "Daily notes are not configured.");
  if (!data.relativePath) return dailyNoteIssue(data, "Daily-note path is unavailable.");
  return configuredDailyNoteSummary(data);
}

function dailyNoteReady(data: DailyNotePlan | null): boolean {
  if (!data) return false;
  return [Boolean(selectedSummary), data.source === "obsidian-daily-notes", Boolean(data.relativePath), data.issues.length === 0].every(Boolean);
}

function dailyNoteButtonLabel(data: DailyNotePlan | null): string {
  return data?.exists ? "Open today’s note" : "Create today’s note";
}

function dailyNoteButtonTitle(data: DailyNotePlan | null): string {
  if (!data) return "Daily notes are not configured.";
  return data.issues[0] ?? "Open or create today’s daily note with the configured plain-text template.";
}

function renderDailyNote(data: DailyNotePlan | null): void {
  setText(dailyNoteSummary, dailyNoteSummaryText(data));
  if (!dailyNoteButton) return;
  setDisabled(dailyNoteButton, !dailyNoteReady(data));
  dailyNoteButton.textContent = dailyNoteButtonLabel(data);
  dailyNoteButton.title = dailyNoteButtonTitle(data);
}

function dailyNoteAvailabilityReason(): string | undefined {
  const checks: Array<[boolean, string]> = [
    [api === undefined, "Daily notes are not configured for this vault."],
    [selectedSummary === null, "Open a vault before opening today’s daily note."],
    [dailyNoteData === null, "Daily notes are not configured for this vault."],
    [dailyNoteData?.relativePath === null, "Daily-note path is unavailable."],
  ];
  return checks.find(([invalid]) => invalid)?.[1];
}

function dailyNoteBlockReason(): string | undefined {
  const unavailable = dailyNoteAvailabilityReason();
  if (unavailable) return unavailable;
  const plan = dailyNoteData!;
  const checks: Array<[boolean, string]> = [
    [plan.issues.length > 0, plan.issues[0] ?? "Daily-note configuration needs review."],
    [dirty, "Save the current note before opening today’s daily note."],
  ];
  return checks.find(([blocked]) => blocked)?.[1];
}

async function openDailyNoteRequest(): Promise<void> {
  const blocked = dailyNoteBlockReason();
  if (blocked) {
    setStatus(blocked);
    return;
  }
  const client = api!;
  const plan = dailyNoteData!;
  setDisabled(dailyNoteButton, true);
  setStatus(`Opening ${plan.relativePath} with a revision-checked write if it is new…`);
  try {
    applyReadResponse(await client.openDailyNote());
    await loadWorkflowIndexes(client);
    setStatus(`Opened ${plan.relativePath}; template scripts were not executed.`);
  } catch (error) {
    setStatus(errorText(error, "Unable to open today’s daily note; the vault remains unchanged."));
  } finally {
    renderDailyNote(dailyNoteData);
  }
}

function renderWorkflowIndexes(): void {
  renderBookmarks(bookmarkData);
  renderTagIndex(tagData);
  renderTaskIndex(taskData);
  renderTemplateIndex(templateData);
  renderDailyNote(dailyNoteData);
  renderTaskContext();
}

async function loadWorkflowIndexes(client: OpenObsidianAPI): Promise<void> {
  try {
    const [bookmarks, tags, tasks, templates, dailyNote] = await Promise.all([client.bookmarks(), client.tags(), client.tasks(), client.templates(), client.dailyNote()]);
    bookmarkData = bookmarks;
    tagData = tags;
    taskData = tasks;
    templateData = templates;
    dailyNoteData = dailyNote;
    renderWorkflowIndexes();
  } catch (error) {
    setStatus(errorText(error, "Unable to load vault workflows; source notes remain unchanged."));
  }
}

function paneStatus(id: VaultPaneId): string {
  const statusByPane: Record<VaultPaneId, string> = {
    files: filesPaneStatus(),
    search: searchPaneStatus(),
    bookmarks: bookmarksPaneStatus(),
  };
  return statusByPane[id];
}

function filesPaneStatus(): string {
  return selectedSummary ? "Showing Markdown notes from the selected vault." : "Choose a vault to begin.";
}

function searchPaneStatus(): string {
  return selectedSummary ? "Search the selected vault locally." : "Open a vault to search its notes.";
}

function bookmarksPaneStatus(): string {
  return bookmarkData?.source === "obsidian-bookmarks" ? "Showing read-only Obsidian bookmarks." : "No Obsidian bookmark configuration was found; no bookmark data was inferred.";
}

const vaultPaneActions: Record<VaultPaneId, () => void> = {
  files: () => setStatus(paneStatus("files")),
  search: () => {
    searchInput?.focus();
    setStatus(paneStatus("search"));
  },
  bookmarks: () => setStatus(paneStatus("bookmarks")),
};

function setVaultPane(id: VaultPaneId): void {
  activeVaultPane = id;
  sidebar?.setAttribute("data-active-pane", id);
  setHidden(bookmarksList, id !== "bookmarks");
  sidebarPaneButtons.forEach((button) => button.setAttribute("aria-selected", String(button.dataset.sidebarPane === id)));
  vaultPaneActions[id]();
}

function appendPreviewInline(element: HTMLElement, value: string): void {
  parseInlineMarkdown(value).forEach((segment) => element.append(previewInlineSegment(segment)));
}

type MarkdownStyledSegment = Exclude<MarkdownInlineSegment, {kind: "text" | "link" | "wiki-link" | "embed"}>;
const markdownInlineTags: Record<MarkdownStyledSegment["kind"], keyof HTMLElementTagNameMap> = {highlight: "mark", strong: "strong", emphasis: "em", strikethrough: "del", code: "code"};

function previewLinkSegment(segment: Extract<MarkdownInlineSegment, {kind: "link" | "wiki-link"}>): HTMLElement {
  const link = document.createElement("span");
  link.className = segment.kind === "wiki-link" ? "markdown-wiki-link" : "markdown-link";
  link.dataset.target = segment.target;
  link.title = `Link target: ${segment.target}`;
  link.textContent = segment.text;
  return link;
}

function previewEmbedData(segment: Extract<MarkdownInlineSegment, {kind: "embed"}>): Record<string, string> {
  const data: Record<string, string> = {target: segment.target};
  if (segment.fragment) data.fragment = segment.fragment;
  if (segment.width !== undefined) data.width = String(segment.width);
  if (segment.height !== undefined) data.height = String(segment.height);
  return data;
}

function previewEmbedDimensions(segment: Extract<MarkdownInlineSegment, {kind: "embed"}>): string {
  if (segment.width === undefined) return "";
  const size = segment.height === undefined ? String(segment.width) : `${segment.width}x${segment.height}`;
  return ` · ${size}px`;
}

function previewEmbedDescription(segment: Extract<MarkdownInlineSegment, {kind: "embed"}>): {title: string; text: string} {
  const location = segment.target || "current note";
  const fragment = segment.fragment ? `#${segment.fragment}` : "";
  const dimensions = previewEmbedDimensions(segment);
  const title = `Embedded content: ${location}${fragment}${dimensions}`;
  return {title, text: `[embed: ${segment.text || `${location}${fragment}`}${dimensions}]`};
}

function previewEmbedSegment(segment: Extract<MarkdownInlineSegment, {kind: "embed"}>): HTMLElement {
  const embed = document.createElement("span");
  embed.className = "markdown-embed";
  Object.entries(previewEmbedData(segment)).forEach(([key, value]) => {
    embed.dataset[key] = value;
  });
  embed.dataset.label = segment.text || segment.target;
  const description = previewEmbedDescription(segment);
  embed.title = description.title;
  embed.setAttribute("aria-label", description.title);
  embed.textContent = description.text;
  return embed;
}

function attachmentDimension(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const dimension = Number(value);
  return Number.isSafeInteger(dimension) && dimension > 0 ? dimension : undefined;
}

function createAttachmentElement(response: AttachmentReadResponse): HTMLImageElement | HTMLAudioElement | HTMLVideoElement {
  if (response.kind === "image") return document.createElement("img");
  if (response.kind === "audio") return document.createElement("audio");
  return document.createElement("video");
}

function applyAttachmentDimensions(element: HTMLImageElement | HTMLAudioElement | HTMLVideoElement, placeholder: HTMLElement): void {
  const width = attachmentDimension(placeholder.dataset.width);
  const height = attachmentDimension(placeholder.dataset.height);
  if (width !== undefined) element.setAttribute("width", String(width));
  if (height !== undefined) element.setAttribute("height", String(height));
}

function applyAttachmentPlayback(element: HTMLImageElement | HTMLAudioElement | HTMLVideoElement): void {
  if (element instanceof HTMLImageElement) {
    element.decoding = "async";
    element.loading = "lazy";
    return;
  }
  element.controls = true;
  element.preload = "metadata";
}

function previewAttachmentElement(response: AttachmentReadResponse, placeholder: HTMLElement): HTMLElement {
  const label = placeholder.dataset.label || response.relativePath;
  const element = createAttachmentElement(response);
  element.className = `markdown-attachment markdown-attachment-${response.kind}`;
  element.dataset.target = response.relativePath;
  element.dataset.mimeType = response.mimeType;
  element.dataset.bytes = String(response.bytes);
  element.dataset.revision = response.revision;
  const fragment = placeholder.dataset.fragment;
  if (fragment) element.dataset.fragment = fragment;
  element.setAttribute("aria-label", label);
  if (element instanceof HTMLImageElement) {
    element.alt = label;
  }
  applyAttachmentPlayback(element);
  applyAttachmentDimensions(element, placeholder);
  element.src = `data:${response.mimeType};base64,${response.base64}`;
  return element;
}

async function requestPreviewAttachment(sourcePath: string, target: string | undefined): Promise<AttachmentReadResponse | null> {
  if (!api || !target) return null;
  try {
    return await api.readAttachment({sourcePath, target});
  } catch {
    return null;
  }
}

function decoratePreviewEmbeds(root: ParentNode, context: PreviewEmbedContext): void {
  root.querySelectorAll<HTMLElement>(".markdown-embed").forEach((placeholder) => {
    previewEmbedContexts.set(placeholder, context);
    placeholder.dataset.sourcePath = context.sourcePath;
    placeholder.dataset.depth = String(context.depth);
  });
}

function previewEmbedFailureLabel(reason: string): string {
  const labels: Record<string, string> = {
    unresolved: "target was not found",
    ambiguous: "target is ambiguous",
    external: "external targets are not loaded",
    depth: `nested preview limit reached (${MAX_TRANSCLUSION_DEPTH})`,
    cycle: "recursive embed cycle blocked",
    oversized: "note is too large for an inline preview",
    unsupported: "target is not a supported inline preview",
    read: "note could not be read",
  };
  return labels[reason] ?? reason;
}

function markPreviewEmbedUnavailable(placeholder: HTMLElement, reason: string, resolution?: NoteEmbedResolution): void {
  const target = placeholder.dataset.target || "current note";
  const fragment = placeholder.dataset.fragment ? `#${placeholder.dataset.fragment}` : "";
  const label = `Embedded content unavailable: ${target}${fragment} · ${previewEmbedFailureLabel(reason)}`;
  placeholder.classList.add("markdown-embed-unresolved");
  placeholder.dataset.status = reason;
  if (resolution?.candidates.length) placeholder.dataset.candidates = resolution.candidates.join(",");
  placeholder.title = label;
  placeholder.setAttribute("aria-label", label);
  placeholder.textContent = `[embed unavailable: ${target}${fragment} · ${previewEmbedFailureLabel(reason)}]`;
}

function previewSourceBytesWithinLimit(base64: string): boolean {
  return withinTransclusionSourceLimit(base64);
}

type ReadNoteEmbed = {
  response: Awaited<ReturnType<OpenObsidianAPI["readFile"]>>;
  source: string;
  resolution: NoteEmbedResolution;
  guard: Extract<TransclusionGuard, {allowed: true}>;
};

type PreviewNoteTarget = {resolution: NoteEmbedResolution; guard: Extract<TransclusionGuard, {allowed: true}>};

function previewNoteTargetValue(placeholder: HTMLElement): string | null {
  const target = placeholder.dataset.target;
  if (target) return target;
  markPreviewEmbedUnavailable(placeholder, "unresolved");
  return null;
}

function previewNoteReference(target: string, fragment: string | undefined): {target: string; fragment?: string} {
  return fragment ? {target, fragment} : {target};
}

function previewNoteResolution(context: PreviewEmbedContext, placeholder: HTMLElement): NoteEmbedResolution | null {
  const target = previewNoteTargetValue(placeholder);
  if (!target) return null;
  const fragment = placeholder.dataset.fragment;
  const initial = resolveNoteEmbed(previewNoteReference(target, fragment), vaultFiles.filter((file) => file.kind === "file").map((file) => file.relativePath), context.sourcePath);
  if (initial.status !== "resolved" || !initial.target) {
    markPreviewEmbedUnavailable(placeholder, initial.status, initial);
    return null;
  }
  return initial;
}

function resolvePreviewNoteTarget(context: PreviewEmbedContext, placeholder: HTMLElement): PreviewNoteTarget | null {
  const initial = previewNoteResolution(context, placeholder);
  if (!initial?.target) return null;
  const guard = guardTransclusion(context.depth, context.chain, initial.target);
  if (!guard.allowed) {
    markPreviewEmbedUnavailable(placeholder, guard.reason);
    return null;
  }
  return {resolution: initial, guard};
}

async function readPreviewNoteSource(target: string, placeholder: HTMLElement): Promise<{response: Awaited<ReturnType<OpenObsidianAPI["readFile"]>>; source: string} | null> {
  if (!api) return null;
  let response: Awaited<ReturnType<OpenObsidianAPI["readFile"]>>;
  try {
    response = await api.readFile(target);
  } catch {
    markPreviewEmbedUnavailable(placeholder, "read");
    return null;
  }
  if (!previewSourceBytesWithinLimit(response.base64)) {
    markPreviewEmbedUnavailable(placeholder, "oversized");
    return null;
  }
  try {
    return {response, source: decodeBase64(response.base64)};
  } catch {
    markPreviewEmbedUnavailable(placeholder, "read");
    return null;
  }
}

function selectPreviewNoteSource(context: PreviewEmbedContext, placeholder: HTMLElement, response: Awaited<ReturnType<OpenObsidianAPI["readFile"]>>, source: string, resolution: NoteEmbedResolution): {source: string; resolution: NoteEmbedResolution} | null {
  const fragment = placeholder.dataset.fragment;
  const sourceAware = resolvePreviewFragment(context, response, source, resolution, fragment);
  if (sourceAware.status !== "resolved") {
    markPreviewEmbedUnavailable(placeholder, sourceAware.status, sourceAware);
    return null;
  }
  const selected = selectTransclusionSource(source, fragment);
  if (selected.status !== "resolved" || selected.text === undefined) {
    markPreviewEmbedUnavailable(placeholder, selected.status);
    return null;
  }
  return {source: selected.text, resolution: sourceAware};
}

function resolvePreviewFragment(context: PreviewEmbedContext, response: Awaited<ReturnType<OpenObsidianAPI["readFile"]>>, source: string, resolution: NoteEmbedResolution, fragment: string | undefined): NoteEmbedResolution {
  if (!fragment) return resolution;
  const target = resolution.target ?? response.relativePath;
  const sources = new Map([[target, source], [response.relativePath, source]]);
  return resolveNoteEmbed({target: response.relativePath, fragment}, [response.relativePath], context.sourcePath, sources);
}

async function requestPreviewNote(context: PreviewEmbedContext, placeholder: HTMLElement): Promise<ReadNoteEmbed | null> {
  const target = resolvePreviewNoteTarget(context, placeholder);
  const targetPath = target?.resolution.target;
  if (!targetPath) return null;
  const read = await readPreviewNoteSource(targetPath, placeholder);
  if (!read) return null;
  const selected = selectPreviewNoteSource(context, placeholder, read.response, read.source, target.resolution);
  if (!selected) return null;
  return {response: read.response, source: selected.source, resolution: selected.resolution, guard: target.guard};
}

function previewTransclusionElement(read: ReadNoteEmbed, placeholder: HTMLElement): HTMLElement {
  const target = read.response.relativePath;
  const fragment = placeholder.dataset.fragment;
  const label = `Transcluded note: ${target}${fragment ? `#${fragment}` : ""}`;
  const section = document.createElement("section");
  section.className = "markdown-transclusion";
  section.dataset.target = target;
  section.dataset.revision = read.response.revision;
  if (fragment) section.dataset.fragment = fragment;
  section.setAttribute("aria-label", label);
  section.title = label;
  section.replaceChildren(...parseMarkdownPreview(read.source).map(previewElement));
  section.querySelectorAll<HTMLInputElement>(".task-line input").forEach((checkbox) => {
    checkbox.disabled = true;
    checkbox.setAttribute("aria-label", "Read-only transcluded task");
  });
  decoratePreviewEmbeds(section, {sourcePath: target, depth: read.guard.nextDepth, chain: read.guard.chain});
  return section;
}

function previewHydrationCurrent(generation: number, placeholder: HTMLElement): boolean {
  return generation === previewGeneration && placeholder.isConnected;
}

function replacePreviewAttachment(response: AttachmentReadResponse, generation: number, placeholder: HTMLElement): boolean {
  if (!previewHydrationCurrent(generation, placeholder)) return false;
  placeholder.replaceWith(previewAttachmentElement(response, placeholder));
  return true;
}

async function hydrateNestedPreviewEmbeds(transclusion: HTMLElement, note: ReadNoteEmbed, generation: number): Promise<void> {
  const nested = [...transclusion.querySelectorAll<HTMLElement>(".markdown-embed")];
  await Promise.all(nested.map((child) => {
    const childContext = previewEmbedContexts.get(child) ?? {sourcePath: note.response.relativePath, depth: note.guard.nextDepth, chain: note.guard.chain};
    return hydratePreviewEmbed(childContext, generation, child);
  }));
}

async function hydratePreviewEmbed(context: PreviewEmbedContext, generation: number, placeholder: HTMLElement): Promise<void> {
  const response = await requestPreviewAttachment(context.sourcePath, placeholder.dataset.target);
  if (response) {
    replacePreviewAttachment(response, generation, placeholder);
    return;
  }
  const note = await requestPreviewNote(context, placeholder);
  if (!note || !previewHydrationCurrent(generation, placeholder)) return;
  const transclusion = previewTransclusionElement(note, placeholder);
  placeholder.replaceWith(transclusion);
  await hydrateNestedPreviewEmbeds(transclusion, note, generation);
}

async function hydratePreviewEmbeds(sourcePath: string, generation: number): Promise<void> {
  if (!api || !notePreview) return;
  const context: PreviewEmbedContext = {sourcePath, depth: 0, chain: [sourcePath]};
  decoratePreviewEmbeds(notePreview, context);
  const placeholders = [...notePreview.querySelectorAll<HTMLElement>(".markdown-embed")];
  await Promise.all(placeholders.map((placeholder) => hydratePreviewEmbed(context, generation, placeholder)));
}

const markdownInlineSpecialRenderers: Partial<Record<MarkdownInlineSegment["kind"], (segment: MarkdownInlineSegment) => Node>> = {
  link: (segment) => previewLinkSegment(segment as Extract<MarkdownInlineSegment, {kind: "link" | "wiki-link"}>),
  "wiki-link": (segment) => previewLinkSegment(segment as Extract<MarkdownInlineSegment, {kind: "link" | "wiki-link"}>),
  embed: (segment) => previewEmbedSegment(segment as Extract<MarkdownInlineSegment, {kind: "embed"}>),
};

function previewInlineSegment(segment: MarkdownInlineSegment): Node {
  if (segment.kind === "text") return document.createTextNode(segment.text);
  const specialRenderer = markdownInlineSpecialRenderers[segment.kind];
  if (specialRenderer) return specialRenderer(segment);
  const element = document.createElement(markdownInlineTags[segment.kind as MarkdownStyledSegment["kind"]]);
  element.textContent = segment.text;
  return element;
}

function previewHeading(block: Extract<MarkdownPreviewBlock, {kind: "heading"}>): HTMLElement {
  const element = document.createElement(`h${block.level}`);
  appendPreviewInline(element, block.text);
  return element;
}

function previewParagraph(block: Extract<MarkdownPreviewBlock, {kind: "paragraph"}>): HTMLElement {
  const element = document.createElement("p");
  appendPreviewInline(element, block.text);
  return element;
}

function previewTask(block: Extract<MarkdownPreviewBlock, {kind: "task"}>): HTMLElement {
  const row = document.createElement("label");
  row.className = "task-line";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = block.checked;
  const text = document.createElement("span");
  appendPreviewInline(text, block.text);
  row.append(checkbox, text);
  return row;
}

function previewList(block: Extract<MarkdownPreviewBlock, {kind: "list"}>): HTMLElement {
  const list = document.createElement(block.ordered ? "ol" : "ul");
  block.items.forEach((item) => {
    const row = document.createElement("li");
    appendPreviewInline(row, item);
    list.append(row);
  });
  return list;
}

function previewQuote(block: Extract<MarkdownPreviewBlock, {kind: "quote"}>): HTMLElement {
  const quote = document.createElement("blockquote");
  appendPreviewInline(quote, block.text);
  return quote;
}

function previewCode(block: Extract<MarkdownPreviewBlock, {kind: "code"}>): HTMLElement {
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = block.text;
  if (block.language) code.dataset.language = block.language;
  pre.append(code);
  return pre;
}

function previewBase(block: Extract<MarkdownPreviewBlock, {kind: "base"}>): HTMLElement {
  const pre = document.createElement("pre");
  pre.className = "markdown-base";
  const code = document.createElement("code");
  code.dataset.language = "base · read-only";
  code.textContent = block.text;
  pre.append(code);
  return pre;
}

function previewTableCell(value: string, header: boolean): HTMLElement {
  const cell = document.createElement(header ? "th" : "td");
  appendPreviewInline(cell, value);
  return cell;
}

function previewTable(block: Extract<MarkdownPreviewBlock, {kind: "table"}>): HTMLElement {
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  block.headers.forEach((header) => headRow.append(previewTableCell(header, true)));
  head.append(headRow);
  const body = document.createElement("tbody");
  block.rows.forEach((row) => {
    const bodyRow = document.createElement("tr");
    row.forEach((value) => bodyRow.append(previewTableCell(value, false)));
    body.append(bodyRow);
  });
  table.append(head, body);
  return table;
}

function previewThematicBreak(): HTMLElement {
  const element = document.createElement("hr");
  element.setAttribute("aria-hidden", "true");
  return element;
}

function previewUnsupported(block: Extract<MarkdownPreviewBlock, {kind: "unsupported"}>): HTMLElement {
  const element = document.createElement("p");
  element.className = "markdown-unsupported";
  element.textContent = `${block.syntax} syntax is shown as text; execution/rendering is not enabled: ${block.text}`;
  return element;
}

const previewBuilders: {[K in MarkdownPreviewBlock["kind"]]: (block: Extract<MarkdownPreviewBlock, {kind: K}>) => HTMLElement} = {
  heading: previewHeading,
  paragraph: previewParagraph,
  task: previewTask,
  list: previewList,
  quote: previewQuote,
  code: previewCode,
  base: previewBase,
  table: previewTable,
  "thematic-break": previewThematicBreak,
  unsupported: previewUnsupported,
};

function previewElement(block: MarkdownPreviewBlock): HTMLElement {
  return previewBuilders[block.kind](block as never);
}

function renderNotePreview(value: string): void {
  if (!notePreview) return;
  const generation = ++previewGeneration;
  notePreview.replaceChildren(...parseMarkdownPreview(value).map(previewElement));
  const tasks = selectedPath ? extractMarkdownTasks(value, selectedPath).map((task) => ({...task, revision: selectedRevision ?? undefined})) : [];
  notePreview.querySelectorAll<HTMLInputElement>(".task-line input").forEach((checkbox, index) => {
    const task = tasks[index];
    if (!task) {
      checkbox.disabled = true;
      return;
    }
    checkbox.disabled = !taskRevision(task) || dirty;
    checkbox.setAttribute("aria-label", `${task.checked ? "Complete" : "Incomplete"} task: ${task.text}`);
    checkbox.addEventListener("change", () => void toggleTaskItem(task, checkbox));
  });
  renderTaskContext();
  if (selectedPath) void hydratePreviewEmbeds(selectedPath, generation);
}

function renderEditorMode(): void {
  const mode = workspaceSettings.editorMode;
  editorModeButtons.forEach((button) => {
    button.dataset.active = button.dataset.editorMode === mode ? "true" : "false";
    button.disabled = !selectedPath;
  });
  setHidden(editor, mode === "reading" || !selectedPath);
  setHidden(notePreview, mode === "source" || !selectedPath);
  document.querySelector<HTMLElement>(".note-surface")?.setAttribute("data-mode", mode);
}

function renderContextSplit(): void {
  editorStage?.setAttribute("data-split", String(workspaceSettings.splitView));
  // Keep the right workspace pane present in the empty state so the initial
  // shell matches the reference app's split layout before a note is opened.
  setHidden(contextPane, !workspaceSettings.splitView);
  toggleContextButton?.replaceChildren(document.createTextNode(contextButtonLabel()));
  const rightSidebarLabel = workspaceSettings.splitView ? "Hide right sidebar" : "Show right sidebar";
  toggleRightSidebarButton?.setAttribute("aria-label", rightSidebarLabel);
  toggleRightSidebarButton?.setAttribute("title", rightSidebarLabel);
  toggleRightSidebarButton?.setAttribute("aria-pressed", String(workspaceSettings.splitView));
}

function contextButtonLabel(): string {
  return workspaceSettings.splitView ? "Hide context" : "Show context";
}

function applyWorkspaceSettings(settings: WorkspaceSettings): void {
  workspaceSettings = settings;
  workspaceState = {...workspaceState, settings};
  setInputValue(defaultEditorMode, settings.editorMode);
  setInputChecked(splitView, settings.splitView);
  setInputValue(historyAgeDays, String(settings.historyPolicy.maxAgeDays));
  setInputValue(historyMaxMiB, String(Math.max(1, Math.round(settings.historyPolicy.maxBytes / (1024 * 1024)))));
  renderEditorMode();
  renderContextSplit();
}

function applyProviderSettings(settings: ProviderSettings): void {
  providerSettings = settings;
  setInputValue(providerMode, settings.mode);
  setInputValue(providerModel, settings.model);
  setInputValue(providerEndpoint, settings.endpoint);
  setInputValue(providerCredentialRef, settings.credentialRef ?? "");
  setInputValue(providerMaxRequests, String(settings.caps.maxRequests));
  setInputValue(providerMaxInput, String(settings.caps.maxInputTokens));
  setInputValue(providerMaxOutput, String(settings.caps.maxOutputTokens));
  setInputValue(providerMaxCost, String(settings.caps.maxCostCents));
}

function providerCapsFromInputs(): ProviderUsageCaps | null {
  const maxRequests = inputWholeNumber(providerMaxRequests, 1);
  const maxInputTokens = inputWholeNumber(providerMaxInput, 1);
  const maxOutputTokens = inputWholeNumber(providerMaxOutput, 1);
  const maxCostCents = inputWholeNumber(providerMaxCost, 0);
  if ([maxRequests, maxInputTokens, maxOutputTokens, maxCostCents].some((value) => value === null)) return null;
  return {maxRequests: maxRequests!, maxInputTokens: maxInputTokens!, maxOutputTokens: maxOutputTokens!, maxCostCents: maxCostCents!};
}

function selectedProviderMode(): ProviderMode | null {
  return providerModeValue(providerMode?.value);
}

function providerControlValue(element: HTMLInputElement | HTMLSelectElement | null): string {
  return element?.value.trim() ?? "";
}

function providerSecretValue(): string {
  return providerSecret?.value ?? "";
}

function providerCredentialFromInputs(): {credentialRef: string; secret: string} | null {
  const credentialRef = providerControlValue(providerCredentialRef);
  const secret = providerSecretValue();
  if (!credentialRef || !secret) return null;
  return {credentialRef, secret};
}

function providerModeValue(value: string | undefined): ProviderMode | null {
  if (value === "managed") return value;
  if (value === "byok") return value;
  if (value === "local") return value;
  return null;
}

function providerSettingsFromInputs(): ProviderSettings | null {
  const mode = selectedProviderMode();
  if (!mode) return null;
  const caps = providerCapsFromInputs();
  if (!caps) return null;
  return {mode, providerId: providerIds[mode], model: providerControlValue(providerModel), endpoint: providerControlValue(providerEndpoint), credentialRef: providerControlValue(providerCredentialRef) || null, caps};
}

function renderProviderStatus(value: ProviderStatus): void {
  setText(providerStatusOutput, `${value.mode} · ${value.availability} · ${value.model} · ${value.destination} · credential ${value.credentialState} · fallback ${value.fallback} · ${value.reason} · usage ${value.usage.requestCount}/${value.usage.maxRequests} requests`);
}

async function loadProviderConfiguration(): Promise<void> {
  const client = api;
  if (!client) return;
  try {
    applyProviderSettings(await client.loadProviderSettings());
    renderProviderStatus(await client.providerStatus());
  } catch (error) {
    setStatus(errorText(error, "Unable to load provider settings; provider remains unavailable."));
  }
}

async function loadDiagnosticManifest(): Promise<void> {
  const client = api;
  if (!client || !diagnosticsOutput) return;
  try {
    diagnosticsOutput.textContent = JSON.stringify(await client.diagnosticManifest(), null, 2);
    setHidden(diagnosticsOutput, false);
    setStatus("Local diagnostics loaded; note content and provider secrets were excluded.");
  } catch (error) {
    setStatus(errorText(error, "Unable to load local diagnostics."));
  }
}

async function saveProviderConfiguration(): Promise<void> {
  const client = api;
  const settings = providerSettingsFromInputs();
  if (!client || !settings) {
    setStatus("Provider settings require a valid mode, model, endpoint and whole-number caps.");
    applyProviderSettings(providerSettings);
    return;
  }
  try {
    applyProviderSettings(await client.saveProviderSettings(settings));
    renderProviderStatus(await client.providerStatus());
    setStatus("Provider settings saved; no request was dispatched.");
  } catch (error) {
    setStatus(errorText(error, "Unable to save provider settings."));
  }
}

async function storeProviderCredential(client: OpenObsidianAPI, credential: {credentialRef: string; secret: string}): Promise<void> {
  try {
    renderProviderStatus(await client.saveProviderCredential(credential));
    if (providerSecret) providerSecret.value = "";
    setStatus("Credential stored by the main process; the secret was cleared from the form.");
  } catch (error) {
    setStatus(errorText(error, "Unable to store the provider credential."));
  }
}

async function saveProviderCredential(): Promise<void> {
  const client = api;
  if (!client) return;
  const credential = providerCredentialFromInputs();
  if (!credential) {
    setStatus("Enter a credential reference and secret before storing the credential.");
    return;
  }
  await storeProviderCredential(client, credential);
}

function setInputValue(element: HTMLInputElement | HTMLSelectElement | null, value: string): void {
  if (element) element.value = value;
}

function setInputChecked(element: HTMLInputElement | null, value: boolean): void {
  if (element) element.checked = value;
}

async function persistWorkspaceSettings(): Promise<void> {
  if (!api) return;
  try {
    applyWorkspaceSettings(await api.saveSettings(workspaceSettings));
    await persistWorkspaceState();
  } catch (error) {
    setStatus(errorText(error, "Unable to save workspace settings."));
  }
}

async function loadWorkspaceSettings(): Promise<void> {
  if (!api) return;
  try {
    applyWorkspaceSettings(await api.loadSettings());
  } catch (error) {
    setStatus(errorText(error, "Unable to load workspace settings; using source mode."));
  }
}

async function loadWorkspaceState(): Promise<void> {
  if (!api) return;
  try {
    const state = await api.loadWorkspaceState();
    workspaceState = state;
    applyWorkspaceSettings(state.settings);
  } catch (error) {
    setStatus(errorText(error, "Unable to load workspace state; using default workspace settings."));
  }
}

function workspaceNavigation(selected: string | null): string[] {
  if (!selected) return workspaceState.navigationHistory;
  return [...workspaceState.navigationHistory.filter((path) => path !== selected), selected].slice(-100);
}

async function persistWorkspaceState(): Promise<void> {
  const client = api;
  if (!client) return;
  const next = buildWorkspaceState();
  workspaceState = next;
  try {
    workspaceState = await client.saveWorkspaceState(next);
  } catch (error) {
    setStatus(errorText(error, "Unable to save workspace state."));
  }
}

function buildWorkspaceState(): WorkspaceState {
  const openTabs = loadedTabPaths();
  const activePath = activeWorkspacePath(openTabs);
  return {...workspaceState, settings: workspaceSettings, vaultRoot: workspaceVaultRoot(), openTabs, activePath, navigationHistory: workspaceNavigation(activePath)};
}

function loadedTabPaths(): string[] {
  return tabStates.filter((tab) => tab.loaded).map((tab) => tab.path).slice(-50);
}

function activeWorkspacePath(openTabs: string[]): string | null {
  return selectedPath && openTabs.includes(selectedPath) ? selectedPath : null;
}

function workspaceVaultRoot(): string | null {
  return selectedSummary?.root ?? workspaceState.vaultRoot;
}

function setEditorMode(mode: EditorMode): void {
  workspaceSettings = {...workspaceSettings, editorMode: mode};
  renderEditorMode();
  if (defaultEditorMode) defaultEditorMode.value = mode;
  void persistWorkspaceSettings();
}

function setSplitView(enabled: boolean): void {
  workspaceSettings = {...workspaceSettings, splitView: enabled};
  renderContextSplit();
  void persistWorkspaceSettings();
}

function renderLeftSidebar(): void {
  appShell?.setAttribute("data-left-sidebar", String(leftSidebarVisible));
  const label = leftSidebarVisible ? "Hide left sidebar" : "Show left sidebar";
  toggleLeftSidebarButton?.setAttribute("aria-label", label);
  toggleLeftSidebarButton?.setAttribute("title", label);
  toggleLeftSidebarButton?.setAttribute("aria-pressed", String(leftSidebarVisible));
}

function setLeftSidebarVisible(visible: boolean): void {
  leftSidebarVisible = visible;
  renderLeftSidebar();
}

function setHistoryPolicy(policy: HistoryPolicy): void {
  workspaceSettings = {...workspaceSettings, historyPolicy: policy};
  applyWorkspaceSettings(workspaceSettings);
  void persistWorkspaceSettings();
}

function updateHistoryPolicyFromInputs(): void {
  const policy = historyPolicyFromInputs();
  if (!policy) {
    setStatus("History retention must use whole non-negative days and at least 1 MiB.");
    applyWorkspaceSettings(workspaceSettings);
    return;
  }
  setHistoryPolicy(policy);
}

function historyPolicyFromInputs(): HistoryPolicy | null {
  const maxAgeDays = inputWholeNumber(historyAgeDays, 0);
  if (maxAgeDays === null) return null;
  const maxBytes = inputHistoryBytes(historyMaxMiB);
  if (maxBytes === null) return null;
  return {maxAgeDays, maxBytes};
}

function inputWholeNumber(element: HTMLInputElement | null, minimum: number): number | null {
  return wholeNumber(Number(element?.value), minimum);
}

function inputHistoryBytes(element: HTMLInputElement | null): number | null {
  return historyBytes(Number(element?.value));
}

function historyBytes(value: number): number | null {
  const maxMiB = wholeNumber(value, 1);
  if (maxMiB === null) return null;
  const maxBytes = maxMiB * 1024 * 1024;
  return Number.isSafeInteger(maxBytes) ? maxBytes : null;
}

function wholeNumber(value: number, minimum: number): number | null {
  return Number.isSafeInteger(value) && value >= minimum ? value : null;
}

function updateChronicleControls(): void {
  setDisabled(openQuickSwitcherButton, !selectedSummary);
  setDisabled(openRetrievalButton, !selectedSummary);
  setDisabled(openAIReviewButton, !selectedSummary);
  updateWorkspaceToolControls();
  setDisabled(reviewButton, !selectedSummary || selectedSummary.git.vaultType !== "chronicle");
  setDisabled(historyButton, !selectedSummary);
  setDisabled(reviewRetentionButton, !selectedSummary);
  if (!selectedSummary) setDisabled(cleanupHistoryButton, true);
}

function hasWorkspaceFile(extension: string): boolean {
  return vaultFiles.some((file) => file.kind === "file" && file.relativePath.toLowerCase().endsWith(extension));
}

function updateWorkspaceToolControls(): void {
  setDisabled(openGraphButton, !selectedSummary);
  setDisabled(openCanvasButton, !selectedSummary || !hasWorkspaceFile(".canvas"));
  setDisabled(openBaseButton, !selectedSummary || !hasWorkspaceFile(".base"));
}

function updateEditorState(): void {
  setText(editorPath, selectedPath ?? "No note selected");
  setDisabled(editor, !selectedPath);
  setDisabled(saveButton, !selectedPath || !dirty);
  setDisabled(popoutButton, !selectedPath || dirty || !selectedSummary);
  setHidden(emptyState, Boolean(selectedPath));
  renderEditorMode();
  renderContextSplit();
  updateChronicleControls();
}

function modeDetail(git: VaultSummary["git"]): string {
  if (git.vaultType !== "chronicle") return "";
  return git.branch ? ` · ${git.branch}` : "";
}

function vaultDisplayName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).at(-1) ?? "Vault";
}

function vaultBranchLabel(git: VaultSummary["git"]): string {
  if (git.vaultType !== "chronicle") return "Standard vault";
  return `${git.branch ?? "unborn"}${git.dirty ? " · dirty" : " · clean"}`;
}

function renderVaultIdentity(summary: VaultSummary): void {
  setText(vaultName, vaultDisplayName(summary.root));
  setText(vaultBranch, vaultBranchLabel(summary.git));
}

function renderMode(summary: VaultSummary): void {
  if (!vaultMode) return;
  vaultMode.textContent = `${gitSummaryMessage(summary.git)}${modeDetail(summary.git)}`;
  vaultMode.dataset.state = summary.git.dirty ? "dirty" : "clean";
  renderVaultIdentity(summary);
  updateChronicleControls();
}

function configureFileButton(button: HTMLButtonElement, path: string, kind: "file" | "symlink", openable: boolean): void {
  button.disabled = kind === "symlink" || !openable;
  if (kind === "symlink") button.title = "Symlink entries are visible but cannot be opened through the vault boundary.";
  else if (!openable) button.title = "This file remains visible and authoritative but is not a Markdown editor target.";
  else button.addEventListener("click", () => void openFile(path));
}

function fileButton(path: string, kind: "file" | "symlink", preview?: string, openable = true): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "file-row";
  button.dataset.path = path;
  button.dataset.selected = String(path === selectedPath);
  const name = document.createElement("span");
  name.className = "file-name";
  name.textContent = path;
  button.append(name);
  if (preview) {
    const excerpt = document.createElement("small");
    excerpt.className = "file-preview";
    excerpt.textContent = preview.replace(/\s+/g, " ").trim();
    button.append(excerpt);
  }
  configureFileButton(button, path, kind, openable);
  return button;
}

function markSelectedFile(): void {
  fileList?.querySelectorAll<HTMLButtonElement>(".file-row").forEach((button) => {
    button.dataset.selected = String(button.dataset.path === selectedPath);
  });
}

function supportedWorkspaceFile(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".canvas") || lower.endsWith(".base");
}

function aiTargetPaths(): string[] {
  return vaultFiles.filter((file) => file.kind === "file" && file.relativePath.toLowerCase().endsWith(".md")).map((file) => file.relativePath);
}

function preferredAITarget(paths: string[]): string | undefined {
  return validAITarget(selectedPath, paths) ?? validAITarget(aiTarget?.value, paths) ?? paths[0];
}

function validAITarget(candidate: string | null | undefined, paths: string[]): string | undefined {
  if (!candidate) return undefined;
  return paths.includes(candidate) ? candidate : undefined;
}

function aiTargetValue(): string {
  return aiTarget?.value.trim() ?? "";
}

function aiInputValue(element: HTMLInputElement | null): string {
  return element?.value.trim() ?? "";
}

function aiTargetHasUnsavedChanges(target: string): boolean {
  return target === selectedPath && dirty;
}

function aiChangeSetHasUnsavedChanges(changeSet: AIChangeSet): boolean {
  return dirty && changeSet.files.some((file) => file.relativePath === selectedPath);
}

function aiDraftDetails(): {target: string; instruction: string} | null {
  const target = validAITarget(aiTargetValue(), aiTargetPaths());
  if (!target) return null;
  const instruction = aiInputValue(aiInstruction);
  if (!instruction) return null;
  return {target, instruction};
}

function aiApplySelections(changeSet: AIChangeSet): Array<{fileId: string; hunkIds: string[]}> | null {
  if (aiChangeSetHasUnsavedChanges(changeSet)) {
    setStatus("Save the current note before applying an AI preview.");
    return null;
  }
  const selections = aiSelections();
  if (selections.length === 0) {
    setStatus("Approve at least one AI hunk before applying.");
    return null;
  }
  return selections;
}

function renderAITargetOptions(): void {
  const paths = aiTargetPaths();
  if (!aiTarget) return;
  selectPathOptions(aiTarget, paths, preferredAITarget(paths));
  setDisabled(applyAIButton, !aiChangeSet || aiSelections().length === 0);
}

function renderFiles(files: Awaited<ReturnType<OpenObsidianAPI["listFiles"]>>): void {
  vaultFiles = files;
  renderAITargetOptions();
  updateWorkspaceToolControls();
  if (!fileList) return;
  fileList.replaceChildren();
  if (files.length === 0) {
    const message = document.createElement("p");
    message.className = "empty-list";
    message.textContent = "No Markdown notes found.";
    fileList.append(message);
    return;
  }
  files.forEach((file) => fileList.append(fileButton(file.relativePath, file.kind, undefined, file.kind === "file" && supportedWorkspaceFile(file.relativePath))));
}

function renderSearchResults(results: Awaited<ReturnType<OpenObsidianAPI["search"]>>): void {
  if (!fileList) return;
  fileList.replaceChildren();
  if (results.length === 0) {
    const message = document.createElement("p");
    message.className = "empty-list";
    message.textContent = "No matching notes.";
    fileList.append(message);
    return;
  }
  results.forEach((result) => fileList.append(fileButton(result.relativePath, "file", result.preview, supportedWorkspaceFile(result.relativePath))));
}

function currentTab(): NoteTab | undefined {
  return selectedPath ? tabStates.find((tab) => tab.path === selectedPath) : undefined;
}

function syncActiveTab(): void {
  const tab = currentTab();
  if (!tab || !editor) return;
  tab.revision = selectedRevision;
  tab.content = editor.value;
  tab.dirty = dirty;
  tab.loaded = true;
}

function tabButton(tab: NoteTab): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "note-tab";
  button.dataset.active = tab.path === selectedPath ? "true" : "false";
  button.textContent = tab.dirty ? `${tab.path} ·` : tab.path;
  button.title = tab.dirty ? `${tab.path} has unsaved changes` : tab.path;
  button.addEventListener("click", () => activateTab(tab.path));
  return button;
}

function renderTabs(): void {
  if (!noteTabs) return;
  noteTabs.replaceChildren(...tabStates.map(tabButton));
}

function rememberTab(path: string): NoteTab {
  const existing = tabStates.find((tab) => tab.path === path);
  if (existing) return existing;
  const tab: NoteTab = {path, revision: null, content: "", dirty: false, loaded: false};
  tabStates.push(tab);
  renderTabs();
  return tab;
}

function restoreTab(tab: NoteTab): void {
  selectedPath = tab.path;
  selectedRevision = tab.revision;
  dirty = tab.dirty;
  if (editor) editor.value = tab.content;
  renderNotePreview(tab.content);
  updateEditorState();
  markSelectedFile();
  renderTabs();
  void loadNoteContext(tab.path);
  void persistWorkspaceState();
  setStatus(`Switched to ${tab.path}${tab.dirty ? " · unsaved changes" : ""}.`);
}

function activateTab(path: string): void {
  syncActiveTab();
  const tab = tabStates.find((candidate) => candidate.path === path);
  if (!tab) return openFile(path);
  requestId += 1;
  if (tab.loaded) restoreTab(tab);
  else openFile(path);
}

function contextButton(text: string, meta: string, action: () => void): HTMLLIElement {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "context-item";
  button.textContent = `${text} · ${meta}`;
  button.addEventListener("click", action);
  item.append(button);
  return item;
}

function contextEmpty(message: string): HTMLLIElement {
  const item = document.createElement("li");
  const text = document.createElement("p");
  text.className = "context-empty";
  text.textContent = message;
  item.append(text);
  return item;
}

function renderNoteContext(context: NoteContext): void {
  renderContextList(outlineList, context.headings.map((heading) => contextButton(`${"· ".repeat(Math.max(0, heading.level - 1))}${heading.text}`, `line ${heading.line}`, () => focusEditorLine(heading.line))), "No headings in this note.");
  renderContextList(outgoingLinksList, context.outgoingLinks.map((link) => {
    const target = link.resolvedPath ?? link.target;
    const status = link.status === "resolved" ? "" : ` · ${link.status}`;
    return contextButton(`${target}${status}`, `line ${link.line}`, () => {
      if (link.resolvedPath) openFile(link.resolvedPath);
      else setStatus(`Link target ${link.target || "(empty)"} remains ${link.status}; no file was opened.`);
    });
  }), "No outgoing links in this note.");
  renderContextList(backlinksList, context.backlinks.map((backlink) => contextButton(backlink.relativePath, `line ${backlink.line}`, () => openFile(backlink.relativePath))), "No notes link here yet.");
  renderTaskContext();
}

function renderContextList(list: HTMLElement | null, rows: HTMLLIElement[], emptyMessage: string): void {
  if (!list) return;
  list.replaceChildren(...rows);
  if (rows.length === 0) list.append(contextEmpty(emptyMessage));
}

function focusEditorLine(line: number): void {
  if (!editor) return;
  const offset = editor.value.split(/\r\n|\n|\r/).slice(0, Math.max(0, line - 1)).reduce((total, part) => total + part.length + 1, 0);
  editor.focus();
  editor.setSelectionRange(offset, offset);
  setStatus(`Outline focused line ${line}.`);
}

function acceptNoteContext(currentRequest: number, context: NoteContext): void {
  if (currentRequest !== contextRequestId || context.relativePath !== selectedPath) return;
  renderNoteContext(context);
}

function noteContextError(currentRequest: number, error: unknown): void {
  if (currentRequest === contextRequestId) setStatus(errorText(error, "Unable to load note context."));
}

async function loadNoteContext(path: string): Promise<void> {
  if (!api) return;
  const currentRequest = ++contextRequestId;
  try {
    const context = await api.noteContext(path);
    acceptNoteContext(currentRequest, context);
  } catch (error) {
    noteContextError(currentRequest, error);
  }
}

type QuickResult = {relativePath: string; preview: string};

function renderQuickResults(results: QuickResult[]): void {
  if (!quickResults) return;
  quickResults.replaceChildren(...results.map((result) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quick-result";
    button.setAttribute("role", "option");
    const path = document.createElement("span");
    path.textContent = result.relativePath;
    const preview = document.createElement("small");
    preview.textContent = result.preview;
    button.append(path, preview);
    button.addEventListener("click", () => {
      quickSwitcher?.close();
      openFile(result.relativePath);
    });
    return button;
  }));
  if (results.length === 0) {
    const empty = document.createElement("p");
    empty.className = "context-empty";
    empty.textContent = "No Markdown notes match this search.";
    quickResults.append(empty);
  }
}

async function quickMatches(client: OpenObsidianAPI, query: string): Promise<QuickResult[]> {
  if (query.trim()) return client.search(query);
  return (await client.listFiles()).filter((file) => file.kind === "file" && file.relativePath.toLowerCase().endsWith(".md")).slice(0, 30).map((file) => ({relativePath: file.relativePath, preview: "Markdown note"}));
}

async function fetchQuickMatches(client: OpenObsidianAPI, query: string, currentRequest: number): Promise<void> {
  try {
    const results = await quickMatches(client, query);
    if (currentRequest === paletteRequestId) renderQuickResults(results);
  } catch (error) {
    if (currentRequest === paletteRequestId) setStatus(errorText(error, "Unable to search the quick switcher."));
  }
}

async function quickSearchRequest(query: string, currentRequest: number): Promise<void> {
  if (!api) return;
  await fetchQuickMatches(api, query, currentRequest);
}

function searchQuickSwitcher(query: string): void {
  const currentRequest = ++paletteRequestId;
  void quickSearchRequest(query, currentRequest);
}

function openQuickSwitcher(): void {
  if (!quickSwitcher) return;
  if (!quickSwitcher.open) quickSwitcher.showModal();
  if (quickQuery) {
    quickQuery.value = "";
    quickQuery.focus();
  }
  searchQuickSwitcher("");
}

type WorkspaceCommand = {label: string; shortcut: string; available: () => boolean; run: () => void};

function workspaceCommands(): WorkspaceCommand[] {
  return [
    {label: "Open vault", shortcut: "", available: () => Boolean(api && selectButton), run: () => selectButton?.click()},
    {label: "Quick switcher", shortcut: "⌘/Ctrl P", available: () => Boolean(selectedSummary), run: openQuickSwitcher},
    {label: "Open grounded search", shortcut: "", available: () => Boolean(selectedSummary), run: openRetrievalPanel},
    {label: "Review local AI draft", shortcut: "", available: () => Boolean(selectedSummary), run: openAIReviewPanel},
    {label: "Open graph", shortcut: "", available: () => Boolean(selectedSummary), run: () => void openGraphPanel()},
    {label: "Open Canvas", shortcut: "", available: () => Boolean(selectedSummary && hasWorkspaceFile(".canvas")), run: () => void openCanvasPanel()},
    {label: "Open Bases", shortcut: "", available: () => Boolean(selectedSummary && hasWorkspaceFile(".base")), run: () => void openBasePanel()},
    {label: "Open settings", shortcut: "", available: () => Boolean(settingsPanel), run: openSettingsPanel},
    {label: "Search settings", shortcut: "", available: () => Boolean(settingsPanel), run: openSettingsPanel},
    {label: "Review changes", shortcut: "", available: () => Boolean(selectedSummary?.git.vaultType === "chronicle"), run: () => void reviewChangesRequest()},
    {label: "Open history", shortcut: "", available: () => Boolean(selectedSummary), run: () => void historyRequest()},
    {label: "Toggle context pane", shortcut: "", available: () => Boolean(selectedPath), run: () => setSplitView(!workspaceSettings.splitView)},
    {label: "Save current note", shortcut: "⌘/Ctrl S", available: () => Boolean(selectedPath && dirty), run: saveNote},
    {label: "Close workspace panel", shortcut: "Escape", available: () => true, run: () => togglePanel(null, false)},
  ];
}

function commandMatches(command: WorkspaceCommand, query: string): boolean {
  return command.label.toLocaleLowerCase().includes(query) || command.shortcut.toLocaleLowerCase().includes(query);
}

function commandButton(command: WorkspaceCommand): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "command-result";
  button.setAttribute("role", "option");
  const label = document.createElement("span");
  label.textContent = command.label;
  const shortcut = document.createElement("small");
  shortcut.textContent = command.shortcut;
  button.append(label, shortcut);
  button.addEventListener("click", () => {
    commandPalette?.close();
    command.run();
  });
  return button;
}

function renderCommandResults(): void {
  if (!commandResults) return;
  const query = commandQuery?.value.trim().toLocaleLowerCase() ?? "";
  const commands = workspaceCommands().filter((command) => command.available() && commandMatches(command, query));
  commandResults.replaceChildren(...commands.map(commandButton));
  if (commands.length === 0) commandResults.append(graphEmpty("No available commands match this search."));
}

function openCommandPalette(): void {
  if (!commandPalette) return;
  if (!commandPalette.open) commandPalette.showModal();
  if (commandQuery) {
    commandQuery.value = "";
    commandQuery.focus();
  }
  renderCommandResults();
}

function commandQueryKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    commandResults?.querySelector<HTMLButtonElement>("button")?.focus();
  }
  if (event.key === "Enter") commandResults?.querySelector<HTMLButtonElement>("button")?.click();
}

function graphKindMatches(node: GraphView["nodes"][number]): boolean {
  const kind = graphNodeKind?.value ?? "all";
  return kind === "all" || kind === node.kind;
}

function graphQueryMatches(node: GraphView["nodes"][number]): boolean {
  const query = graphQuery?.value.trim().toLocaleLowerCase() ?? "";
  return !query || node.label.toLocaleLowerCase().includes(query);
}

function graphNodeMatches(node: GraphView["nodes"][number]): boolean {
  return [graphKindMatches(node), graphQueryMatches(node)].every(Boolean);
}

function graphEdgeKindMatches(edge: GraphView["edges"][number]): boolean {
  const kind = graphEdgeKind?.value ?? "all";
  return kind === "all" || kind === edge.kind;
}

function graphEdgeMatches(edge: GraphView["edges"][number], nodeIds: Set<string>): boolean {
  return [graphEdgeKindMatches(edge), nodeIds.has(edge.from), nodeIds.has(edge.to)].every(Boolean);
}

function graphNodeButton(node: GraphView["nodes"][number]): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "graph-node";
  button.dataset.kind = node.kind;
  button.disabled = node.kind === "unresolved";
  button.textContent = `${node.kind === "unresolved" ? "Unresolved" : node.kind === "attachment" ? "Open attachment" : "Open"} · ${node.label}`;
  if (node.kind !== "unresolved") button.addEventListener("click", () => openFile(node.id));
  return button;
}

function graphLayoutMode(): GraphView["layout"] {
  const value = graphLayout?.value;
  return value === "hierarchical" || value === "radial" ? value : "force";
}

function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS("http://www.w3.org/2000/svg", name);
}

function renderGraphSurface(nodes: GraphView["nodes"], edges: GraphView["edges"], layout: GraphView["layout"]): void {
  if (!graphSurface) return;
  const positions = layoutGraph(nodes, edges, layout);
  graphSurface.replaceChildren();
  edges.forEach((edge) => {
    const from = positions[edge.from];
    const to = positions[edge.to];
    if (!from || !to) return;
    const line = svgElement("line");
    line.setAttribute("x1", String(from.x));
    line.setAttribute("y1", String(from.y));
    line.setAttribute("x2", String(to.x));
    line.setAttribute("y2", String(to.y));
    line.setAttribute("class", `graph-edge-line graph-edge-${edge.kind}`);
    graphSurface.append(line);
  });
  nodes.forEach((node) => {
    const point = positions[node.id];
    if (!point) return;
    const group = svgElement("g");
    group.setAttribute("class", `graph-point graph-point-${node.kind}`);
    const circle = svgElement("circle");
    circle.setAttribute("cx", String(point.x));
    circle.setAttribute("cy", String(point.y));
    circle.setAttribute("r", node.kind === "unresolved" ? "6" : "8");
    const label = svgElement("text");
    label.setAttribute("x", String(point.x));
    label.setAttribute("y", String(point.y + 22));
    label.setAttribute("text-anchor", "middle");
    label.textContent = node.label.length > 24 ? `${node.label.slice(0, 22)}…` : node.label;
    group.append(circle, label);
    graphSurface.append(group);
  });
  graphSurface.setAttribute("aria-label", `${layout} graph map with ${nodes.length} nodes and ${edges.length} edges`);
}

function graphEdgeRow(edge: GraphView["edges"][number]): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "graph-edge";
  row.textContent = `${edge.kind} · ${edge.from} → ${edge.to}`;
  return row;
}

function graphEmpty(message: string): HTMLParagraphElement {
  const empty = document.createElement("p");
  empty.className = "context-empty";
  empty.textContent = message;
  return empty;
}

function renderGraphList(list: HTMLElement, rows: HTMLElement[], message: string): void {
  list.replaceChildren(...rows);
  if (rows.length === 0) list.append(graphEmpty(message));
}

function graphCountLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function graphSummaryText(data: GraphView, nodeCount: number, edgeCount: number): string {
  return `${graphCountLabel(nodeCount, "visible node")} · ${graphCountLabel(edgeCount, "visible edge")} · ${data.groups.length} folder group${data.groups.length === 1 ? "" : "s"} · ${data.layout} layout · derived state only`;
}

function renderGraph(): void {
  const data = graphData;
  const nodeList = graphNodeList;
  const edgeList = graphEdgeList;
  if (!data || !nodeList || !edgeList) return;
  const nodes = data.nodes.filter(graphNodeMatches);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = data.edges.filter((edge) => graphEdgeMatches(edge, nodeIds));
  const layout = graphLayoutMode();
  setText(graphSummary, `${graphSummaryText({...data, layout}, nodes.length, edges.length)} · spatial map with keyboard list alternative`);
  renderGraphSurface(nodes, edges, layout);
  renderGraphList(nodeList, nodes.map(graphNodeButton), "No graph nodes match this filter.");
  renderGraphList(edgeList, edges.map(graphEdgeRow), "No graph edges match this filter.");
}

async function openGraphPanel(): Promise<void> {
  if (!api || !selectedSummary) return;
  togglePanel(graphPanel, true);
  setText(graphSummary, "Building the graph from the authoritative vault index…");
  try {
    graphData = await api.graph();
    renderGraph();
    setStatus("Graph ready; opening it did not write to the vault.");
  } catch (error) {
    setText(graphSummary, errorText(error, "Unable to load the vault graph."));
  }
}

function togglePanel(panel: HTMLElement | null, visible: boolean): void {
  [changePanel, historyPanel, settingsPanel, graphPanel, canvasPanel, basePanel, retrievalPanel, aiPanel].forEach((candidate) => setHidden(candidate, candidate !== panel || !visible));
}

function selectPathOptions(select: HTMLSelectElement | null, paths: string[], selected: string | undefined): void {
  if (!select) return;
  select.replaceChildren(...paths.map((path) => new Option(path, path, path === selected, path === selected)));
}

function canvasNodeText(node: CanvasNodeView): string {
  return typeof node.text === "string" ? node.text : "";
}

function canvasNodeTarget(node: CanvasNodeView): string | null {
  if (typeof node.file === "string") return node.file;
  if (typeof node.url === "string") return node.url;
  if (typeof node.link === "string") return node.link;
  return null;
}

function canvasAction(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function canvasCardHeader(node: CanvasNodeView): HTMLElement {
  const header = document.createElement("header");
  const title = document.createElement("strong");
  title.textContent = node.id;
  const type = document.createElement("span");
  type.textContent = node.type;
  header.append(title, type);
  return header;
}

function canvasTextCard(node: CanvasNodeView, card: HTMLDivElement): void {
  const text = document.createElement("textarea");
  text.value = canvasNodeText(node);
  const notePath = document.createElement("input");
  notePath.type = "text";
  notePath.placeholder = "New note path, e.g. canvas-card.md";
  const actions = document.createElement("div");
  actions.className = "node-actions";
  actions.append(canvasAction("Save text card", () => void editCanvasText(node.id, text.value)), canvasAction("Create note from card", () => void createCanvasNote(node.id, notePath.value)));
  card.append(text, notePath, actions);
}

function canvasTargetCard(node: CanvasNodeView, card: HTMLDivElement): void {
  const target = canvasNodeTarget(node);
  const description = document.createElement("p");
  description.className = "panel-summary";
  description.textContent = target ? `${node.type} target · ${target}` : "This node type is visible but has no supported local target.";
  card.append(description);
  if (target && !/^[a-z][a-z0-9+.-]*:/i.test(target)) card.append(canvasAction("Open target", () => openFile(target.split("#", 1)[0]!)));
}

function canvasNodeCard(node: CanvasNodeView): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "canvas-node";
  card.append(canvasCardHeader(node));
  if (node.type === "text") {
    canvasTextCard(node, card);
  } else {
    canvasTargetCard(node, card);
  }
  return card;
}

function canvasEdgeRow(edge: CanvasView["edges"][number]): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "canvas-edge";
  const label = typeof edge.label === "string" ? ` · ${edge.label}` : "";
  row.textContent = `${edge.fromNode} → ${edge.toNode}${label}`;
  return row;
}

function renderCanvas(): void {
  if (!canvasData || !canvasNodeList || !canvasEdgeList) return;
  setText(canvasSummary, `${graphCountLabel(canvasData.nodes.length, "node")} · ${graphCountLabel(canvasData.edges.length, "edge")} · revision ${canvasData.revision.slice(0, 12)}… · unknown fields remain preserved`);
  renderGraphList(canvasNodeList, canvasData.nodes.map(canvasNodeCard), "This Canvas has no nodes.");
  renderGraphList(canvasEdgeList, canvasData.edges.map(canvasEdgeRow), "This Canvas has no edges.");
}

function canvasPaths(): string[] {
  return vaultFiles.filter((file) => file.kind === "file" && file.relativePath.toLowerCase().endsWith(".canvas")).map((file) => file.relativePath);
}

function selectedCanvasPath(paths: string[]): string {
  const current = canvasData?.relativePath;
  return current !== undefined && paths.includes(current) ? current : paths[0]!;
}

async function loadCanvasFile(path: string): Promise<void> {
  if (!api) return;
  selectPathOptions(canvasFile, canvasPaths(), path);
  setText(canvasSummary, `Reading ${path} without changing the vault…`);
  try {
    canvasData = await api.canvas(path);
    renderCanvas();
    setStatus(`Canvas ${path} is ready; writes require an explicit node action.`);
  } catch (error) {
    setText(canvasSummary, errorText(error, "Unable to load the Canvas file."));
  }
}

async function openCanvasPanel(): Promise<void> {
  const paths = canvasPaths();
  if (!api || !selectedSummary || paths.length === 0) return;
  togglePanel(canvasPanel, true);
  await loadCanvasFile(selectedCanvasPath(paths));
}

async function editCanvasText(nodeId: string, text: string): Promise<void> {
  if (!api || !canvasData) return;
  setStatus(`Saving Canvas text card ${nodeId} with a revision check…`);
  try {
    canvasData = await api.editCanvasText({relativePath: canvasData.relativePath, expectedRevision: canvasData.revision, nodeId, text});
    renderCanvas();
    setStatus(`Updated Canvas text card ${nodeId}; unknown fields remain intact.`);
  } catch (error) {
    setStatus(errorText(error, "Unable to update the Canvas text card; current bytes remain authoritative."));
  }
}

async function createCanvasNote(nodeId: string, notePath: string): Promise<void> {
  const path = requiredCanvasNotePath(notePath);
  if (!path) return;
  const client = api;
  const data = canvasData;
  if (!client || !data) return;
  await performCanvasNoteCreation(client, data, nodeId, path);
}

async function performCanvasNoteCreation(client: OpenObsidianAPI, data: CanvasView, nodeId: string, path: string): Promise<void> {
  setStatus(`Creating ${path} from Canvas card ${nodeId} with explicit approval…`);
  try {
    const result = await client.createCanvasNote({relativePath: data.relativePath, expectedRevision: data.revision, nodeId, notePath: path});
    canvasData = result.canvas;
    renderCanvas();
    await listFilesRequest(client);
    setStatus(`Created ${result.created.relativePath} explicitly from Canvas card ${nodeId}.`);
    openFile(result.created.relativePath);
  } catch (error) {
    setStatus(errorText(error, "Unable to create a note from the Canvas card; no conversion was performed."));
  }
}

function requiredCanvasNotePath(value: string): string | null {
  const path = value.trim();
  if (path) return path;
  setStatus("Enter a new relative note path before creating a note from the Canvas card.");
  return null;
}

function formatBaseScalar(value: BaseScalar): string {
  return String(value ?? "null");
}

function formatBaseArray(value: BaseValue[]): string {
  return `[${value.map(formatBaseValue).join(", ")}]`;
}

function formatBaseObject(value: {[key: string]: BaseValue}): string {
  return `{${Object.entries(value).map(([key, nested]) => `${key}: ${formatBaseValue(nested)}`).join(", ")}}`;
}

function formatBaseValue(value: BaseValue): string {
  if (Array.isArray(value)) return formatBaseArray(value);
  if (value !== null && typeof value === "object") return formatBaseObject(value);
  return formatBaseScalar(value);
}

function baseViewAt(): BaseEvaluationView | undefined {
  const data = baseData;
  if (!data) return undefined;
  return data.views[baseViewIndex(data)] ?? data.views[0];
}

function validBaseIndex(value: number, length: number): boolean {
  return [Number.isInteger(value), value >= 0, value < length].every(Boolean);
}

function baseSelectionValue(): string {
  return baseView ? baseView.value : "0";
}

function baseViewIndex(data: BaseResponse): number {
  const value = Number(baseSelectionValue());
  return validBaseIndex(value, data.views.length) ? value : 0;
}

function baseIssueRow(issue: BaseEvaluationView["issues"][number]): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "base-issue";
  const message = document.createElement("span");
  message.textContent = issue.message;
  row.append(message);
  if (issue.expression) {
    const expression = document.createElement("small");
    expression.textContent = `Expression: ${issue.expression}`;
    row.append(expression);
  }
  return row;
}

function baseRowButton(row: BaseEvaluationView["rows"][number]): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "base-row";
  const path = document.createElement("strong");
  path.textContent = row.path;
  const values = document.createElement("span");
  values.textContent = Object.entries(row.values).map(([key, value]) => `${key}: ${formatBaseValue(value)}`).join(" · ") || "No represented properties";
  button.append(path, values);
  button.addEventListener("click", () => openFile(row.path));
  return button;
}

function renderBaseSummary(view: BaseEvaluationView): void {
  const viewName = view.name ?? `View ${baseViewIndex(baseData!) + 1}`;
  setText(baseSummary, `${viewName} · ${view.type} · ${graphCountLabel(view.rows.length, "matching note")} · read-only projection; source definitions remain unchanged`);
}

function renderBaseIssues(view: BaseEvaluationView): void {
  if (!baseIssues) return;
  renderGraphList(baseIssues, view.issues.map(baseIssueRow), "No compatibility issues in this view.");
}

function renderBaseRows(view: BaseEvaluationView): void {
  if (!baseResults) return;
  renderGraphList(baseResults, view.rows.map(baseRowButton), "No notes match this Bases view.");
}

function renderBase(): void {
  const view = baseViewAt();
  if (!view) return;
  renderBaseSummary(view);
  renderBaseIssues(view);
  renderBaseRows(view);
}

function basePaths(): string[] {
  return vaultFiles.filter((file) => file.kind === "file" && file.relativePath.toLowerCase().endsWith(".base")).map((file) => file.relativePath);
}

function renderBaseViewOptions(): void {
  if (!baseData || !baseView) return;
  baseView.replaceChildren(...baseData.views.map((view, index) => new Option(view.name ?? `View ${index + 1}`, String(index), index === 0, index === 0)));
}

async function loadBaseFile(path: string): Promise<void> {
  if (!api) return;
  selectPathOptions(baseFile, basePaths(), path);
  setText(baseSummary, `Reading ${path} without changing the vault…`);
  try {
    baseData = await api.base(path);
    renderBaseViewOptions();
    renderBase();
    setStatus(`Bases ${path} is ready; unsupported formulas are shown as compatibility issues.`);
  } catch (error) {
    setText(baseSummary, errorText(error, "Unable to load the Bases file."));
  }
}

async function openBasePanel(): Promise<void> {
  const paths = basePaths();
  if (!api || !selectedSummary || paths.length === 0) return;
  togglePanel(basePanel, true);
  await loadBaseFile(selectedBasePath(paths));
}

function selectedBasePath(paths: string[]): string {
  const current = baseData?.relativePath;
  return current !== undefined && paths.includes(current) ? current : paths[0]!;
}

function filterValues(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim().replace(/\/+$/, "")).filter(Boolean);
}

function retrievalQueryValue(): string | null {
  const query = retrievalQuery?.value.trim() ?? "";
  if (!query) {
    setStatus("Enter a question or search terms before starting grounded search.");
    retrievalQuery?.focus();
    return null;
  }
  return query;
}

function retrievalScopeFromForm(): RetrievalRequest["scope"] {
  return {folders: filterValues(retrievalFolder?.value), tags: filterValues(retrievalTags?.value), excludedPaths: filterValues(retrievalExcluded?.value)};
}

function retrievalRequestFromForm(): RetrievalRequest | null {
  const query = retrievalQueryValue();
  return query ? {query, limit: 20, scope: retrievalScopeFromForm()} : null;
}

function scopeFilterLabel(label: string, values: string[] | undefined): string {
  return values && values.length > 0 ? `${label}: ${values.join(", ")}` : "";
}

function retrievalScopeLabel(scope: RetrievalResponse["scope"]): string {
  const filters = [scopeFilterLabel("folders", scope.folders), scopeFilterLabel("tags", scope.tags), scopeFilterLabel("extra exclusions", scope.excludedPaths)].filter(Boolean);
  return filters.length === 0 ? "Scope: entire selected vault" : `Scope: selected vault · ${filters.join(" · ")}`;
}

function renderRetrievalProgress(progress: RetrievalProgress): void {
  if (!retrievalMeta) return;
  if (progress.phase === "complete") {
    setText(retrievalMeta, `Local index complete · ${progress.processed}/${progress.total} Markdown files visited · ${progress.indexed} passages indexed · ${progress.excluded} excluded.`);
    return;
  }
  const current = progress.currentPath ? ` · ${progress.currentPath}` : "";
  setText(retrievalMeta, `Indexing locally · ${progress.processed}/${progress.total} Markdown files visited · ${progress.indexed} passages indexed · ${progress.excluded} excluded${current}`);
}

function groundingStatus(status: RetrievalResponse["answer"]["status"]): string {
  return {grounded: "Source-grounded", "missing-evidence": "Missing evidence", "conflicting-evidence": "Conflicting evidence"}[status];
}

function renderRetrievalAnswer(answer: RetrievalResponse["answer"]): void {
  if (!retrievalAnswer) return;
  retrievalAnswer.hidden = false;
  retrievalAnswer.dataset.status = answer.status;
  retrievalAnswer.replaceChildren();
  const heading = document.createElement("strong");
  heading.textContent = groundingStatus(answer.status);
  const source = document.createElement("p");
  source.textContent = answer.answer;
  retrievalAnswer.append(heading, source);
  if (answer.inference) {
    const inference = document.createElement("small");
    inference.textContent = answer.inference;
    retrievalAnswer.append(inference);
  }
  answer.conflicts.forEach((conflict) => {
    const warning = document.createElement("small");
    warning.textContent = `Conflict: ${conflict}`;
    retrievalAnswer.append(warning);
  });
  answer.warnings.forEach((message) => {
    const warning = document.createElement("small");
    warning.textContent = `Safety: ${message}`;
    retrievalAnswer.append(warning);
  });
}

function retrievalResultButton(passage: RetrievalResponse["passages"][number]): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "retrieval-result";
  const header = document.createElement("header");
  const path = document.createElement("strong");
  path.textContent = passage.relativePath;
  const score = document.createElement("small");
  score.textContent = `score ${passage.score.toFixed(2)}`;
  header.append(path, score);
  const snippet = document.createElement("p");
  snippet.textContent = passage.snippet;
  const source = document.createElement("small");
  source.textContent = `${passage.heading ?? "Untitled block"} · lines ${passage.lineStart}-${passage.lineEnd} · revision ${passage.revision.slice(0, 12)}… · Open source`;
  button.append(header, snippet, source);
  button.addEventListener("click", () => openRetrievalCitation(passage));
  return button;
}

function renderRetrievalResults(passages: RetrievalResponse["passages"]): void {
  if (!retrievalResults) return;
  retrievalResults.replaceChildren(...passages.map(retrievalResultButton));
  if (passages.length === 0) retrievalResults.append(contextEmpty("No source passages match this scope. The answer is intentionally marked as missing evidence."));
}

function retrievalInferenceLabel(): string {
  const response = retrievalData;
  if (!response) return "no model inference";
  if (response.adjudication === "model") return `model inference · ${response.model ?? "configured model"}`;
  return {fallback: "source-only fallback · no completed model inference", local: "no model inference"}[response.adjudication];
}

function renderSourceInspector(citation: RetrievalCitation): void {
  sourceInspectorCitation = citation;
  setText(sourceInspectorPath, citation.relativePath);
  setText(sourceInspectorMeta, `${citation.heading ?? "Untitled block"} · lines ${citation.lineStart}-${citation.lineEnd} · revision ${citation.revision.slice(0, 12)}… · ${retrievalInferenceLabel()}`);
  setText(sourceInspectorSnippet, citation.snippet);
  setHidden(sourceInspector, false);
}

function resetSourceInspector(): void {
  sourceInspectorCitation = null;
  setHidden(sourceInspector, true);
}

function retrievalAdjudicationLabel(response: RetrievalResponse): string {
  if (response.adjudication === "model") return `model adjudication: ${response.provider} · ${response.model ?? "configured model"}`;
  if (response.adjudication === "fallback") return "model adjudication unavailable · source-only fallback";
  return "local source-only answer";
}

function retrievalDestinationLabel(response: RetrievalResponse): string {
  if (response.provider === "none") return "none";
  return `${response.provider} · ${response.model ?? "configured model"}`;
}

function openSourceInspector(): void {
  if (!sourceInspectorCitation) {
    setStatus("Select a grounded source passage before opening the source inspector.");
    return;
  }
  openRetrievalCitation(sourceInspectorCitation);
}

function renderRetrieval(response: RetrievalResponse): void {
  const safety = response.safety.promptInjectionDetected ? " · instruction-like source treated as untrusted" : "";
  // The literal local fallback label is retained for the source-only contract: provider destination: none.
  setText(retrievalMeta, `${response.mode === "local-hybrid" ? "Local hybrid" : "Keyword fallback"} · provider destination: ${retrievalDestinationLabel(response)} · ${retrievalAdjudicationLabel(response)} · embedding: ${response.embeddingModel} · ${retrievalScopeLabel(response.scope)} · ${response.indexedFiles.length} source files · ${response.excludedFiles.length} excluded${safety}`);
  renderRetrievalAnswer(response.answer);
  renderRetrievalResults(response.passages);
}

function conversationProviderMode(): "none" | ProviderMode {
  if (!retrievalData || retrievalData.provider === "none") return "none";
  return providerSettings.mode;
}

function recordRetrievalConversation(request: RetrievalRequest, response: RetrievalResponse): void {
  const query = request.query.trim();
  const answer = response.answer.answer.trim();
  if (!query || !answer) return;
  const now = new Date().toISOString();
  conversationTurns.push({role: "user", content: query, createdAt: now});
  conversationTurns.push({role: "assistant", content: answer, createdAt: new Date().toISOString()});
  setDisabled(exportConversationButton, false);
}

async function exportConversation(): Promise<void> {
  if (!api) return;
  if (conversationTurns.length === 0) {
    setStatus("Run a grounded search before exporting conversation history.");
    return;
  }
  try {
    const content = await api.exportConversation({providerMode: conversationProviderMode(), model: retrievalData?.model ?? null, turns: conversationTurns});
    if (conversationExportOutput) {
      conversationExportOutput.textContent = content;
      setHidden(conversationExportOutput, false);
    }
    const blob = new Blob([content], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "openobsidian-conversation.json";
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${conversationTurns.length} conversation turns as portable JSON.`);
  } catch (error) {
    setStatus(errorText(error, "Unable to export conversation history."));
  }
}

function openRetrievalCitation(citation: RetrievalCitation): void {
  renderSourceInspector(citation);
  pendingCitation = citation;
  openFile(citation.relativePath);
  if (selectedPath === citation.relativePath && currentTab()?.loaded) {
    pendingCitation = null;
    focusEditorLine(citation.lineStart);
  }
}

function openRetrievalPanel(): void {
  if (!selectedSummary) return;
  togglePanel(retrievalPanel, true);
  if (retrievalData) renderRetrieval(retrievalData);
  retrievalQuery?.focus();
}

function retrievalCompletionStatus(response: RetrievalResponse): string {
  if (response.adjudication === "model") return `model adjudication ran via ${response.provider} (${response.model ?? "configured model"})`;
  if (response.adjudication === "fallback") return "provider adjudication was unavailable; source-only evidence was retained";
  return "no provider request was made";
}

async function performRetrieval(client: OpenObsidianAPI, request: RetrievalRequest): Promise<void> {
  setDisabled(runRetrievalButton, true);
  setText(retrievalMeta, "Starting a local source index; any configured provider receives only approved citations after local ranking…");
  setHidden(retrievalAnswer, true);
  try {
    retrievalData = await client.retrieve(request);
    renderRetrieval(retrievalData);
    recordRetrievalConversation(request, retrievalData);
    setStatus(`Grounded search found ${retrievalData.passages.length} source passage${retrievalData.passages.length === 1 ? "" : "s"}; ${retrievalCompletionStatus(retrievalData)}.`);
  } catch (error) {
    setText(retrievalMeta, errorText(error, "Unable to run grounded search."));
  } finally {
    setDisabled(runRetrievalButton, false);
  }
}

async function runRetrievalRequest(): Promise<void> {
  const client = api;
  if (!client || !selectedSummary) return;
  const request = retrievalRequestFromForm();
  if (request) await performRetrieval(client, request);
}

function aiSelections(): Array<{fileId: string; hunkIds: string[]}> {
  if (!aiChanges) return [];
  const selections = new Map<string, string[]>();
  aiChanges.querySelectorAll<HTMLInputElement>("input[data-ai-file-id][data-ai-hunk-id]:checked").forEach((input) => {
    const fileId = input.dataset.aiFileId;
    const hunkId = input.dataset.aiHunkId;
    if (!fileId || !hunkId) return;
    (selections.get(fileId) ?? selections.set(fileId, []).get(fileId)!).push(hunkId);
  });
  return [...selections.entries()].map(([fileId, hunkIds]) => ({fileId, hunkIds}));
}

function aiChangeRow(file: AIChangeSet["files"][number]): HTMLElement {
  const section = document.createElement("section");
  section.className = "ai-change";
  const header = document.createElement("header");
  const title = document.createElement("strong");
  title.textContent = file.relativePath;
  const summary = document.createElement("small");
  summary.textContent = file.summary;
  header.append(title, summary);
  const fileApproval = document.createElement("label");
  const fileCheckbox = document.createElement("input");
  fileCheckbox.type = "checkbox";
  fileCheckbox.checked = true;
  fileCheckbox.dataset.aiFileApproval = file.id;
  fileCheckbox.addEventListener("change", () => {
    section.querySelectorAll<HTMLInputElement>("input[data-ai-hunk-id]").forEach((input) => { input.checked = fileCheckbox.checked; });
    setDisabled(applyAIButton, aiSelections().length === 0);
  });
  fileApproval.append(fileCheckbox, document.createTextNode("Approve this file"));
  section.append(header, fileApproval);
  file.hunks.forEach((hunk) => {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.dataset.aiFileId = file.id;
    checkbox.dataset.aiHunkId = hunk.id;
    checkbox.addEventListener("change", () => setDisabled(applyAIButton, aiSelections().length === 0));
    label.append(checkbox, document.createTextNode(`Approve hunk · lines ${hunk.startLine}-${hunk.endLine}`));
    const before = document.createElement("pre");
    before.textContent = `Before\n${hunk.before}`;
    const after = document.createElement("pre");
    after.dataset.kind = "after";
    after.textContent = `After\n${hunk.after}`;
    section.append(label, before, after);
  });
  return section;
}

function renderAIChangeSet(changeSet: AIChangeSet): void {
  if (!aiChanges) return;
  aiChangeSet = changeSet;
  setText(aiSummary, `${changeSet.files.length} file preview · provider destination: none · source data remains untrusted · explicit approval and disk revision checks required.`);
  aiChanges.replaceChildren(...changeSet.files.map(aiChangeRow));
  setDisabled(applyAIButton, aiSelections().length === 0);
}

function renderAIOrganization(response: AIOrganizationResponse): void {
  if (!aiOrganization) return;
  aiOrganization.hidden = false;
  aiOrganization.replaceChildren();
  response.warnings.forEach((warning) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = warning;
    aiOrganization.append(paragraph);
  });
  response.suggestions.forEach((suggestion) => {
    const row = document.createElement("div");
    row.className = "ai-suggestion";
    const title = document.createElement("strong");
    title.textContent = `${suggestion.kind} · ${suggestion.relativePath} · ${suggestion.status}`;
    const summary = document.createElement("span");
    summary.textContent = suggestion.summary;
    const detail = document.createElement("small");
    detail.textContent = `${suggestion.detail}${suggestion.safeAlternative ? ` ${suggestion.safeAlternative}` : ""}`;
    row.append(title, summary, detail);
    aiOrganization.append(row);
  });
  if (response.suggestions.length === 0) aiOrganization.append(contextEmpty("No scoped organization suggestions.") as unknown as Node);
}

function openAIReviewPanel(): void {
  if (!selectedSummary) return;
  togglePanel(aiPanel, true);
  renderAITargetOptions();
  aiInstruction?.focus();
}

function aiDraftInput(): {client: OpenObsidianAPI; target: string; instruction: string} | null {
  const client = api;
  if (!client) return null;
  const details = aiDraftDetails();
  if (!details) return null;
  if (aiTargetHasUnsavedChanges(details.target)) {
    setStatus("Save the current note before generating a local AI preview.");
    return null;
  }
  return {client, ...details};
}

async function runAIDraftRequest(): Promise<void> {
  const input = aiDraftInput();
  if (!input) return;
  setDisabled(applyAIButton, true);
  setText(aiSummary, "Creating a local preview; no provider receives note content…");
  try {
    renderAIChangeSet(await input.client.draftAIChange({relativePath: input.target, instruction: input.instruction, scope: {paths: [input.target]}}));
    setStatus("Local AI preview ready; select the hunks you approve before applying.");
  } catch (error) {
    setText(aiSummary, errorText(error, "Unable to create the local AI preview."));
  }
}

function aiApplyInput(): {client: OpenObsidianAPI; changeSet: AIChangeSet; selections: Array<{fileId: string; hunkIds: string[]}>} | null {
  const client = api;
  if (!client) return null;
  const changeSet = aiChangeSet;
  if (!changeSet) return null;
  const selections = aiApplySelections(changeSet);
  if (!selections) return null;
  return {client, changeSet, selections};
}

function finishAIApply(response: Awaited<ReturnType<OpenObsidianAPI["applyAIChange"]>>): void {
  aiUndoId = response.undoId;
  const current = response.files.find((file) => file.relativePath === selectedPath);
  if (current) applyReadResponse(current);
  aiChangeSet = null;
  aiChanges?.replaceChildren(contextEmpty("AI preview applied; the recoverable undo action remains available.") as unknown as Node);
  setText(aiSummary, `Applied ${response.files.length} approved file${response.files.length === 1 ? "" : "s"}; local recovery history retained the prior bytes.`);
  setDisabled(undoAIButton, false);
  setStatus("Approved AI changes applied with a revision check; use Undo last AI write if needed.");
}

async function applyAIDraftRequest(): Promise<void> {
  const input = aiApplyInput();
  if (!input) return;
  setDisabled(applyAIButton, true);
  try {
    finishAIApply(await input.client.applyAIChange({changeSetId: input.changeSet.id, selections: input.selections}));
  } catch (error) {
    setDisabled(applyAIButton, false);
    setStatus(errorText(error, "Unable to apply the AI preview; no unapproved changes were written."));
  }
}

function finishAIUndo(response: Awaited<ReturnType<OpenObsidianAPI["undoAIChange"]>>): void {
  const current = response.files.find((file) => file.relativePath === selectedPath);
  if (current) applyReadResponse(current);
  aiUndoId = null;
  setDisabled(undoAIButton, true);
  setStatus("Undid the approved AI write; both versions remain in recovery history.");
}

async function undoAIRequest(): Promise<void> {
  const client = api;
  if (!client || !aiUndoId) return;
  try {
    finishAIUndo(await client.undoAIChange({undoId: aiUndoId}));
  } catch (error) {
    setStatus(errorText(error, "Unable to undo the AI write; inspect recovery history."));
  }
}

async function suggestOrganizationRequest(): Promise<void> {
  if (!api) return;
  setText(aiSummary, "Reviewing local structure; no provider receives note content…");
  try {
    renderAIOrganization(await api.organizationSuggestions({}));
    setText(aiSummary, "Organization suggestions are preview-only and individually reviewable; formula/code execution remains denied.");
  } catch (error) {
    setText(aiSummary, errorText(error, "Unable to load organization suggestions."));
  }
}

function changeKind(review: NonNullable<typeof changeReview>, path: string): string {
  const options: Array<[string, string[]]> = [["untracked", review.untrackedPaths], ["staged", review.stagedPaths], ["working", review.unstagedPaths]];
  const markers = options.filter(([, paths]) => paths.includes(path)).map(([kind]) => kind);
  return markers.includes("untracked") ? "untracked" : markers.join(" + ") || "working";
}

function selectedChangePaths(): string[] {
  return [...(changeList?.querySelectorAll<HTMLInputElement>("input[data-change-path]:checked") ?? [])].map((input) => input.dataset.changePath).filter((path): path is string => Boolean(path));
}

function renderDiffOptions(review: NonNullable<typeof changeReview>): void {
  if (!diffPath) return;
  diffPath.replaceChildren(new Option("All working changes", ""));
  review.selectedPaths.forEach((path) => diffPath.append(new Option(path, path)));
}

function currentDiffRequest(): {relativePath?: string; staged?: boolean} {
  return {relativePath: diffPath?.value || undefined, staged: diffStaged?.checked === true};
}

async function fetchDiff(client: OpenObsidianAPI, output: HTMLElement): Promise<void> {
  try {
    const result = await client.diffChanges(currentDiffRequest());
    output.textContent = result || "(No diff for this view.)";
  } catch (error) {
    output.textContent = errorText(error, "Unable to load the Chronicle diff.");
  }
}

function changeRow(review: NonNullable<typeof changeReview>, path: string): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "change-row";
  const label = document.createElement("label");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = true;
  checkbox.dataset.changePath = path;
  const name = document.createElement("span");
  name.textContent = path;
  label.append(checkbox, name);
  const kind = document.createElement("small");
  kind.className = "change-kind";
  kind.textContent = changeKind(review, path);
  row.append(label, kind);
  return row;
}

function renderChangeList(review: NonNullable<typeof changeReview>): void {
  if (!changeList) return;
  changeList.replaceChildren(...review.selectedPaths.map((path) => changeRow(review, path)));
  review.excludedPaths.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "excluded-row";
    row.textContent = `Excluded: ${entry.path} · ${entry.reason}`;
    changeList.append(row);
  });
  if (review.selectedPaths.length === 0 && review.excludedPaths.length === 0) {
    const empty = document.createElement("p");
    empty.className = "panel-summary";
    empty.textContent = "No working-tree changes are available to review.";
    changeList.append(empty);
  }
}

function loadDiff(): void {
  if (!api || !diffOutput) return;
  diffOutput.textContent = "Loading diff…";
  void fetchDiff(api, diffOutput);
}

function renderChangeReview(review: Awaited<ReturnType<OpenObsidianAPI["reviewChanges"]>>): void {
  changeReview = review;
  setText(changeSummary, `${review.selectedPaths.length} selectable change${review.selectedPaths.length === 1 ? "" : "s"} · ${review.stagedPaths.length} staged · ${review.unstagedPaths.length} working · ${review.untrackedPaths.length} untracked`);
  renderChangeList(review);
  renderDiffOptions(review);
  setDisabled(commitSelectedButton, review.selectedPaths.length === 0);
  loadDiff();
}

function applyChangeReviewToSummary(review: Awaited<ReturnType<OpenObsidianAPI["reviewChanges"]>>): void {
  if (!selectedSummary) return;
  selectedSummary.git.staged = review.stagedPaths.length > 0;
  selectedSummary.git.untracked = review.untrackedPaths.length > 0;
  selectedSummary.git.dirty = selectedSummary.git.staged || review.unstagedPaths.length > 0 || selectedSummary.git.untracked;
  renderMode(selectedSummary);
}

async function reviewChangesRequest(): Promise<void> {
  if (!api || selectedSummary?.git.vaultType !== "chronicle") return;
  setDisabled(reviewButton, true);
  setStatus("Reviewing Chronicle changes without contacting a remote…");
  try {
    const review = await api.reviewChanges();
    togglePanel(changePanel, true);
    renderChangeReview(review);
    applyChangeReviewToSummary(review);
    setStatus("Chronicle review ready; select only the paths you want to commit.");
  } catch (error) {
    setStatus(errorText(error, "Unable to review Chronicle changes."));
  } finally {
    updateChronicleControls();
  }
}

function historyRow(title: string, meta: string, action?: HTMLButtonElement): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "history-row";
  const content = document.createElement("div");
  const heading = document.createElement("div");
  heading.className = "history-title";
  heading.textContent = title;
  const details = document.createElement("div");
  details.className = "history-meta";
  details.textContent = meta;
  content.append(heading, details);
  row.append(content);
  if (action) row.append(action);
  return row;
}

function restoreAction(revision: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "history-restore";
  button.textContent = "Restore current note";
  button.disabled = !selectedPath;
  button.title = selectedPath ? `Restore ${selectedPath} from this revision` : "Open a note before restoring a Chronicle revision";
  button.addEventListener("click", () => void restoreChronicleRequest(revision));
  return button;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

function inspectConflictAction(record: VaultHistoryRecord): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "history-restore";
  button.textContent = "Inspect conflict";
  button.title = `Inspect incoming bytes for ${record.relativePath}`;
  button.addEventListener("click", () => void inspectConflict(record));
  return button;
}

function conflictAction(record: VaultHistoryRecord): HTMLButtonElement | undefined {
  return record.kind === "conflict" ? inspectConflictAction(record) : undefined;
}

function recoveryRow(record: Awaited<ReturnType<OpenObsidianAPI["historyRecords"]>>[number]): HTMLDivElement {
  const protection = record.protected ? "protected" : "retained until cleanup";
  return historyRow(`${record.kind} · ${record.relativePath}`, `${record.capturedAt} · ${formatBytes(record.bytes)} · ${protection}`, conflictAction(record));
}

function emptyHistoryRow(): HTMLParagraphElement {
  const empty = document.createElement("p");
  empty.className = "panel-summary";
  empty.textContent = "No Chronicle commits or local recovery records are available.";
  return empty;
}

function renderHistoryList(commits: Awaited<ReturnType<OpenObsidianAPI["chronicleHistory"]>>, records: Awaited<ReturnType<OpenObsidianAPI["historyRecords"]>>): void {
  if (!historyList) return;
  const commitRows = commits.map((commit) => historyRow(`${commit.message} · ${commit.revision.slice(0, 12)}…`, `${commit.author} · ${commit.authoredAt}`, restoreAction(commit.revision)));
  const recoveryRows = [...records].sort((left, right) => right.capturedAt.localeCompare(left.capturedAt)).map(recoveryRow);
  historyList.replaceChildren(...commitRows, ...recoveryRows);
  if (commits.length === 0 && records.length === 0) historyList.append(emptyHistoryRow());
}

function renderHistory(commits: Awaited<ReturnType<OpenObsidianAPI["chronicleHistory"]>>, records: Awaited<ReturnType<OpenObsidianAPI["historyRecords"]>>): void {
  const selectedMessage = selectedPath ? `Restore actions target ${selectedPath}.` : "Open a note to enable a commit restore action.";
  setText(historySummary, `${selectedMessage} ${commits.length} Chronicle commit${commits.length === 1 ? "" : "s"} · ${records.length} local recovery record${records.length === 1 ? "" : "s"}.`);
  renderHistoryList(commits, records);
  selectedConflict = null;
  setHidden(conflictBox, true);
}

function renderRetentionSummary(plan: Awaited<ReturnType<OpenObsidianAPI["historyPlan"]>>): void {
  const warning = plan.warning ? " · protected history exceeds the configured cap" : "";
  setText(retentionSummary, `${plan.retainedCount} retained (${formatBytes(plan.retainedBytes)}) · ${plan.pruneableCount} pruneable (${formatBytes(plan.pruneableBytes)}) · ${plan.protectedCount} protected${warning}.`);
  setDisabled(cleanupHistoryButton, plan.pruneableCount === 0 || !selectedSummary);
}

async function retentionPlanRequest(): Promise<void> {
  if (!api || !selectedSummary) return;
  try {
    renderRetentionSummary(await api.historyPlan(workspaceSettings.historyPolicy));
  } catch (error) {
    setText(retentionSummary, errorText(error, "Unable to review recovery retention."));
    setDisabled(cleanupHistoryButton, true);
  }
}

function renderSyncTools(dispositions: SyncToolDisposition[]): void {
  if (!syncToolList) return;
  syncToolList.replaceChildren(...dispositions.map((disposition) => {
    const row = document.createElement("div");
    row.className = "sync-tool-row";
    row.dataset.mode = disposition.mode;
    const name = document.createElement("strong");
    name.textContent = `${disposition.name} · ${disposition.mode}`;
    const note = document.createElement("span");
    note.textContent = disposition.note;
    row.append(name, note);
    return row;
  }));
}

async function loadSyncTools(): Promise<void> {
  if (!api) return;
  try {
    renderSyncTools(await api.syncTools());
  } catch (error) {
    setText(syncToolList, errorText(error, "Unable to load external sync dispositions."));
  }
}

async function cleanupHistoryRequest(): Promise<void> {
  if (!api || !selectedSummary) return;
  setDisabled(cleanupHistoryButton, true);
  setStatus("Removing only expired or over-cap non-conflict recovery records…");
  try {
    const result = await api.cleanupHistory(workspaceSettings.historyPolicy);
    await historyRequest();
    setStatus(cleanupSuccessMessage(result.removed.length));
  } catch (error) {
    setStatus(errorText(error, "Unable to clean up recovery history; protected conflicts remain intact."));
    await retentionPlanRequest();
  }
}

function cleanupSuccessMessage(count: number): string {
  return `${count} recovery record${count === 1 ? "" : "s"} removed; protected conflicts were retained.`;
}

function closeConflict(): void {
  selectedConflict = null;
  setHidden(conflictBox, true);
}

function renderConflictContent(record: VaultHistoryRecord, content: Awaited<ReturnType<OpenObsidianAPI["readConflict"]>>): void {
  if (selectedConflict?.id !== record.id) return;
  setText(conflictTitle, `Conflict · ${record.relativePath}`);
  setText(conflictSummary, `Incoming bytes captured ${record.capturedAt} · ${formatBytes(record.bytes)} · revision ${content.revision.slice(0, 12)}…`);
  setText(conflictOutput, decodeBase64(content.base64));
  setDisabled(keepCurrentButton, false);
  setDisabled(keepIncomingButton, false);
}

async function inspectConflict(record: VaultHistoryRecord): Promise<void> {
  if (!api || record.kind !== "conflict") return;
  selectedConflict = record;
  setHidden(conflictBox, false);
  setText(conflictTitle, `Conflict · ${record.relativePath}`);
  setText(conflictSummary, "Reading the preserved incoming bytes without changing the vault…");
  setText(conflictOutput, "Loading incoming bytes…");
  setDisabled(keepCurrentButton, true);
  setDisabled(keepIncomingButton, true);
  try {
    renderConflictContent(record, await api.readConflict({id: record.id, relativePath: record.relativePath}));
  } catch (error) {
    setText(conflictSummary, errorText(error, "Unable to read the preserved conflict bytes."));
  }
}

function applyConflictReadToTab(response: NonNullable<Awaited<ReturnType<OpenObsidianAPI["resolveConflict"]>>["read"]>): void {
  const tab = tabStates.find((candidate) => candidate.path === response.relativePath);
  if (!tab) return;
  const content = decodeBase64(response.base64);
  tab.revision = response.revision;
  tab.content = content;
  tab.dirty = false;
  tab.loaded = true;
  if (selectedPath !== response.relativePath) return;
  selectedRevision = response.revision;
  dirty = false;
  if (editor) editor.value = content;
  renderNotePreview(content);
  renderTabs();
  updateEditorState();
  void loadNoteContext(response.relativePath);
}

function conflictSelection(): VaultHistoryRecord | null {
  return selectedConflict?.kind === "conflict" ? selectedConflict : null;
}

function conflictActionLabel(action: "keep-current" | "keep-incoming"): string {
  return action === "keep-incoming" ? "Incoming" : "Current";
}

function applyConflictResolutionRead(read: NonNullable<Awaited<ReturnType<OpenObsidianAPI["resolveConflict"]>>["read"]> | undefined): void {
  if (read) applyConflictReadToTab(read);
}

async function resolveSelectedConflict(action: "keep-current" | "keep-incoming"): Promise<void> {
  const record = conflictSelection();
  if (!api || !record) return;
  setDisabled(keepCurrentButton, true);
  setDisabled(keepIncomingButton, true);
  setStatus(`Keeping ${conflictActionLabel(action).toLocaleLowerCase()} bytes for ${record.relativePath}…`);
  try {
    const result = await api.resolveConflict({id: record.id, relativePath: record.relativePath, action});
    applyConflictResolutionRead(result.read);
    closeConflict();
    await historyRequest();
    setStatus(`${conflictActionLabel(action)} bytes kept for ${record.relativePath}; the conflict record was resolved explicitly.`);
  } catch (error) {
    setStatus(errorText(error, "Unable to resolve the conflict; both preserved versions remain available."));
    setDisabled(keepCurrentButton, false);
    setDisabled(keepIncomingButton, false);
  }
}

async function loadHistory(client: OpenObsidianAPI, chronicle: boolean): Promise<{commits: Awaited<ReturnType<OpenObsidianAPI["chronicleHistory"]>>; records: Awaited<ReturnType<OpenObsidianAPI["historyRecords"]>>}> {
  const commits = chronicle ? await client.chronicleHistory(50) : [];
  const records = await client.historyRecords();
  return {commits, records};
}

async function historyRequest(): Promise<void> {
  if (!api || !selectedSummary) return;
  setDisabled(historyButton, true);
  setStatus("Reading local history and recovery records without contacting a remote…");
  try {
    const history = await loadHistory(api, selectedSummary.git.vaultType === "chronicle");
    togglePanel(historyPanel, true);
    renderHistory(history.commits, history.records);
    await Promise.all([retentionPlanRequest(), loadSyncTools()]);
    setStatus("History is read-only until you explicitly choose a restore action.");
  } catch (error) {
    setStatus(errorText(error, "Unable to read vault history."));
  } finally {
    updateChronicleControls();
  }
}

function applyRestoredNote(response: Awaited<ReturnType<OpenObsidianAPI["restoreChronicle"]>>): void {
  selectedRevision = response.revision;
  dirty = false;
  const content = decodeBase64(response.base64);
  const tab = currentTab();
  if (tab) {
    tab.revision = response.revision;
    tab.content = content;
    tab.dirty = false;
    tab.loaded = true;
  }
  if (editor) editor.value = content;
  renderNotePreview(content);
  renderTabs();
  updateEditorState();
  void loadNoteContext(response.relativePath);
}

async function restoreChronicleWithClient(client: OpenObsidianAPI, revision: string, path: string): Promise<void> {
  try {
    const response = await client.restoreChronicle({revision, relativePath: path});
    applyRestoredNote(response);
    setStatus(`Restored ${response.relativePath}; the previous bytes were retained in local recovery history.`);
    await historyRequest();
  } catch (error) {
    setStatus(errorText(error, "Unable to restore the Chronicle revision; current bytes remain authoritative."));
  }
}

async function restoreChronicleRequest(revision: string): Promise<void> {
  if (!api || !selectedPath) {
    setStatus("Open a note before restoring a Chronicle revision.");
    return;
  }
  const path = selectedPath;
  setStatus(`Restoring ${path} from ${revision.slice(0, 12)}… with a recoverable write…`);
  await restoreChronicleWithClient(api, revision, path);
}

function commitInput(): {paths: string[]; message: string} {
  return {paths: selectedChangePaths(), message: commitMessage?.value.trim() ?? ""};
}

function validateCommitInput(input: {paths: string[]; message: string}): boolean {
  if (input.paths.length === 0) {
    setStatus("Select at least one allowed path before committing.");
    return false;
  }
  if (input.message) return true;
  setStatus("Enter a commit message before committing selected changes.");
  commitMessage?.focus();
  return false;
}

async function commitSelectedWithClient(client: OpenObsidianAPI, input: {paths: string[]; message: string}): Promise<void> {
  setDisabled(commitSelectedButton, true);
  setStatus(`Committing ${input.paths.length} selected path${input.paths.length === 1 ? "" : "s"} without touching unrelated staged work…`);
  try {
    const result = await client.commitChronicle({selectedPaths: input.paths, message: input.message});
    if (commitMessage) commitMessage.value = "";
    const review = await client.reviewChanges();
    renderChangeReview(review);
    applyChangeReviewToSummary(review);
    setStatus(`Created Chronicle commit ${result.revision.slice(0, 12)}… for ${result.paths.join(", ")}.`);
  } catch (error) {
    setStatus(errorText(error, "Unable to commit selected Chronicle changes."));
  } finally {
    setDisabled(commitSelectedButton, !changeReview?.selectedPaths.length);
  }
}

async function commitSelectedRequest(): Promise<void> {
  if (!api || !changeReview) return;
  const input = commitInput();
  if (!validateCommitInput(input)) return;
  await commitSelectedWithClient(api, input);
}

async function readFileRequest(client: OpenObsidianAPI, path: string, currentRequest: number): Promise<void> {
  try {
    const response = await client.readFile(path);
    if (currentRequest !== requestId) return;
    applyReadResponse(response);
    void persistWorkspaceState();
    setStatus(`Opened ${response.relativePath} · revision ${response.revision.slice(0, 12)}…`);
  } catch (error) {
    setStatus(errorText(error, "Unable to open the note."));
  }
}

function applyReadResponse(response: Awaited<ReturnType<OpenObsidianAPI["readFile"]>>): void {
  const tab = rememberTab(response.relativePath);
  selectedPath = response.relativePath;
  selectedRevision = response.revision;
  dirty = false;
  tab.revision = response.revision;
  tab.content = decodeBase64(response.base64);
  tab.dirty = false;
  tab.loaded = true;
  if (editor) editor.value = tab.content;
  renderNotePreview(tab.content);
  updateEditorState();
  markSelectedFile();
  renderTabs();
  void loadNoteContext(response.relativePath);
  if (pendingCitation?.relativePath === response.relativePath) {
    const citation = pendingCitation;
    pendingCitation = null;
    focusEditorLine(citation.lineStart);
  }
}

async function restoreWorkspaceTabs(client: OpenObsidianAPI): Promise<void> {
  if (!sameWorkspaceVault()) return;
  await Promise.all(workspaceState.openTabs.slice(0, 50).map((path) => restoreTabFromPath(client, path)));
  restoreActiveWorkspaceTab(workspaceActivePath());
  void persistWorkspaceState();
}

function sameWorkspaceVault(): boolean {
  return Boolean(selectedSummary && workspaceState.vaultRoot === selectedSummary.root);
}

async function restoreTabFromPath(client: OpenObsidianAPI, path: string): Promise<void> {
  try {
    applyReadResponse(await client.readFile(path));
  } catch {
    // A note may have been deleted or moved since the last session; keep the rest of the state recoverable.
  }
}

function workspaceActivePath(): string | undefined {
  const candidates = [workspaceState.activePath, ...tabStates.filter((tab) => tab.loaded).map((tab) => tab.path)].filter((path): path is string => typeof path === "string");
  return candidates.find((path) => tabStates.some((tab) => tab.path === path && tab.loaded));
}

function restoreActiveWorkspaceTab(path: string | undefined): void {
  const tab = path ? tabStates.find((candidate) => candidate.path === path) : undefined;
  if (tab) restoreTab(tab);
}

function beginFileRead(client: OpenObsidianAPI, path: string): void {
  syncActiveTab();
  rememberTab(path);
  const currentRequest = ++requestId;
  setStatus(`Reading ${path} without changing the vault…`);
  void readFileRequest(client, path, currentRequest);
}

function activateLoadedTab(path: string): boolean {
  const existing = tabStates.find((tab) => tab.path === path);
  if (!existing?.loaded) return false;
  activateTab(path);
  return true;
}

function openFile(path: string): void {
  if (!api) return;
  if (openSpecialFile(path)) return;
  if (activateLoadedTab(path)) return;
  beginFileRead(api, path);
}

function openCanvasFile(path: string): void {
  togglePanel(canvasPanel, true);
  void loadCanvasFile(path);
}

function openBaseFile(path: string): void {
  togglePanel(basePanel, true);
  void loadBaseFile(path);
}

function openSpecialFile(path: string): boolean {
  const extension = path.toLowerCase().slice(path.lastIndexOf("."));
  const opener = ({".canvas": openCanvasFile, ".base": openBaseFile} as Record<string, (path: string) => void>)[extension];
  if (!opener) return false;
  opener(path);
  return true;
}

async function writeNoteRequest(client: OpenObsidianAPI, path: string, revision: string | null, value: string): Promise<void> {
  try {
    const response = await client.writeFile({relativePath: path, expectedRevision: revision, base64: encodeBase64(value)});
    selectedRevision = response.revision;
    dirty = false;
    const tab = currentTab();
    if (tab) {
      tab.revision = response.revision;
      tab.content = value;
      tab.dirty = false;
      tab.loaded = true;
    }
    renderTabs();
    void persistWorkspaceState();
    updateEditorState();
    void loadWorkflowIndexes(client);
    setStatus(`Saved ${response.relativePath} · revision ${response.revision.slice(0, 12)}…`);
  } catch (error) {
    updateEditorState();
    setStatus(errorText(error, "Unable to save the note; the original bytes remain authoritative."));
  }
}

function saveNote(): void {
  if ([api, editor, selectedPath, dirty].some((value) => !value)) return;
  const client = api!;
  const noteEditor = editor!;
  const path = selectedPath!;
  const revision = selectedRevision;
  setDisabled(saveButton, true);
  setStatus(`Saving ${path} with a revision check…`);
  void writeNoteRequest(client, path, revision, noteEditor.value);
}

function hasPopoutSelection(): boolean {
  if (!api || !selectedSummary) return false;
  return Boolean(selectedPath);
}

function popoutTarget(): {client: OpenObsidianAPI; vaultRoot: string; relativePath: string} | null {
  if (!hasPopoutSelection()) {
    setStatus("Open a saved Markdown note before opening a popout.");
    return null;
  }
  if (dirty) {
    setStatus("Save the current note before opening its popout.");
    return null;
  }
  return {client: api!, vaultRoot: selectedSummary!.root, relativePath: selectedPath!};
}

function openPopout(): void {
  const target = popoutTarget();
  if (!target) return;
  setDisabled(popoutButton, true);
  setStatus(`Opening ${target.relativePath} in a tracked popout…`);
  void target.client.openPopout({vaultRoot: target.vaultRoot, relativePath: target.relativePath}).then((result) => {
    setStatus(result.reused ? `Focused the existing popout for ${result.relativePath}.` : `Opened ${result.relativePath} in a tracked popout.`);
  }).catch((error) => {
    setStatus(errorText(error, "Unable to open the note popout; the main editor remains authoritative."));
  }).finally(() => updateEditorState());
}

async function searchRequest(client: OpenObsidianAPI, query: string, currentRequest: number): Promise<void> {
  try {
    const results = await client.search(query);
    if (currentRequest === requestId) renderSearchResults(results);
  } catch (error) {
    setStatus(errorText(error, "Unable to search the vault."));
  }
}

async function listFilesRequest(client: OpenObsidianAPI): Promise<void> {
  try {
    renderFiles(await client.listFiles());
  } catch (error) {
    setStatus(errorText(error, "Unable to list vault notes."));
  }
}

function resetWorkflowData(): void {
  clearAppearance();
  vaultFiles = [];
  bookmarkData = null;
  tagData = null;
  taskData = [];
  templateData = null;
  dailyNoteData = null;
  graphData = null;
  canvasData = null;
  baseData = null;
  retrievalData = null;
  conversationTurns = [];
  setDisabled(exportConversationButton, true);
  setHidden(conversationExportOutput, true);
  pendingCitation = null;
  resetSourceInspector();
  aiChangeSet = null;
  aiUndoId = null;
}

function resetEditor(): void {
  selectedPath = null;
  selectedRevision = null;
  dirty = false;
  tabStates = [];
  resetWorkflowData();
  renderTabs();
  renderNoteContext({relativePath: "", headings: [], outgoingLinks: [], backlinks: []});
  renderWorkflowIndexes();
  updateEditorState();
  updateWorkspaceToolControls();
}

function showNoVault(): void {
  setText(vaultMode, "No vault");
  setText(vaultName, "No vault open");
  setText(vaultBranch, "Local workspace");
  if (fileList) fileList.replaceChildren();
  setHidden(changePanel, true);
  setHidden(historyPanel, true);
  setHidden(settingsPanel, true);
  setHidden(graphPanel, true);
  setHidden(canvasPanel, true);
  setHidden(basePanel, true);
  setHidden(retrievalPanel, true);
  setHidden(aiPanel, true);
  setHidden(conflictBox, true);
  selectedConflict = null;
  changeReview = null;
  resetWorkflowData();
  renderWorkflowIndexes();
  updateChronicleControls();
  setStatus(summaryMessage(selectedSummary));
}

async function openVaultRequest(client: OpenObsidianAPI): Promise<void> {
  try {
    await workspaceStateReady;
    selectedSummary = await client.selectVault();
    resetEditor();
    if (!selectedSummary) {
      showNoVault();
      return;
    }
    renderMode(selectedSummary);
    await loadAppearance(client);
    await listFilesRequest(client);
    await loadWorkflowIndexes(client);
    await restoreWorkspaceTabs(client);
    setStatus(summaryMessage(selectedSummary));
  } catch (error) {
    setStatus(errorText(error, "Unable to open the vault."));
  }
}

async function hydrateOpenedVault(client: OpenObsidianAPI, summary: VaultSummary, relativePath: string | null): Promise<void> {
  selectedSummary = summary;
  resetEditor();
  renderMode(summary);
  await loadAppearance(client);
  await listFilesRequest(client);
  await loadWorkflowIndexes(client);
  await restoreWorkspaceTabs(client);
  if (relativePath) openFile(relativePath);
  setStatus(summaryMessage(summary));
}

async function openLaunchIntent(client: OpenObsidianAPI, intent: LaunchIntent): Promise<void> {
  try {
    await workspaceStateReady;
    const summary = await client.openVault(intent.vaultPath);
    await hydrateOpenedVault(client, summary, intent.relativePath);
    if (intent.relativePath) setStatus(`Opened ${intent.relativePath} from the ${intent.source} entry point.`);
  } catch (error) {
    setStatus(errorText(error, "Unable to open the requested launch vault."));
  }
}

function openSelectedVault(client: OpenObsidianAPI, trigger: HTMLButtonElement): void {
  trigger.disabled = true;
  setStatus("Scanning selected vault without changing its files…");
  void openVaultRequest(client).finally(() => {
    trigger.disabled = false;
  });
}

function searchVault(query: string): void {
  if (!api) return;
  const currentRequest = ++requestId;
  if (!query.trim()) {
    void listFilesRequest(api);
    return;
  }
  void searchRequest(api, query, currentRequest);
}

if (api && selectButton) selectButton.addEventListener("click", () => void openSelectedVault(api, selectButton));
if (api) api.onLaunchIntent((intent) => void openLaunchIntent(api, intent));
document.querySelectorAll<HTMLButtonElement>("[data-action-target]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.actionTarget ? document.getElementById(button.dataset.actionTarget) : null;
    target?.click();
  });
});
sidebarPaneButtons.forEach((button) => button.addEventListener("click", () => {
  const id = button.dataset.sidebarPane as VaultPaneId | undefined;
  if (id) setVaultPane(id);
}));
if (openCommandPaletteButton) openCommandPaletteButton.addEventListener("click", openCommandPalette);
if (closeCommandPaletteButton) closeCommandPaletteButton.addEventListener("click", () => commandPalette?.close());
if (commandQuery) {
  commandQuery.addEventListener("input", renderCommandResults);
  commandQuery.addEventListener("keydown", commandQueryKeydown);
}
if (openQuickSwitcherButton) openQuickSwitcherButton.addEventListener("click", () => openQuickSwitcher());
if (dailyNoteButton) dailyNoteButton.addEventListener("click", () => void openDailyNoteRequest());
if (openRetrievalButton) openRetrievalButton.addEventListener("click", openRetrievalPanel);
if (openAIReviewButton) openAIReviewButton.addEventListener("click", openAIReviewPanel);
if (closeAIPanelButton) closeAIPanelButton.addEventListener("click", () => setHidden(aiPanel, true));
if (aiForm) aiForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void runAIDraftRequest();
});
if (applyAIButton) applyAIButton.addEventListener("click", () => void applyAIDraftRequest());
if (undoAIButton) undoAIButton.addEventListener("click", () => void undoAIRequest());
if (suggestAIButton) suggestAIButton.addEventListener("click", () => void suggestOrganizationRequest());
if (closeRetrievalButton) closeRetrievalButton.addEventListener("click", () => setHidden(retrievalPanel, true));
if (exportConversationButton) exportConversationButton.addEventListener("click", () => void exportConversation());
if (retrievalForm) retrievalForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void runRetrievalRequest();
});
if (openGraphButton) openGraphButton.addEventListener("click", () => void openGraphPanel());
if (openCanvasButton) openCanvasButton.addEventListener("click", () => void openCanvasPanel());
if (openBaseButton) openBaseButton.addEventListener("click", () => void openBasePanel());
if (closeGraphButton) closeGraphButton.addEventListener("click", () => setHidden(graphPanel, true));
if (closeCanvasButton) closeCanvasButton.addEventListener("click", () => setHidden(canvasPanel, true));
if (closeBaseButton) closeBaseButton.addEventListener("click", () => setHidden(basePanel, true));
if (graphQuery) graphQuery.addEventListener("input", renderGraph);
if (graphNodeKind) graphNodeKind.addEventListener("change", renderGraph);
if (graphEdgeKind) graphEdgeKind.addEventListener("change", renderGraph);
if (graphLayout) graphLayout.addEventListener("change", renderGraph);
if (canvasFile) canvasFile.addEventListener("change", () => {
  if (canvasFile.value) void loadCanvasFile(canvasFile.value);
});
if (baseFile) baseFile.addEventListener("change", () => {
  if (baseFile.value) void loadBaseFile(baseFile.value);
});
if (baseView) baseView.addEventListener("change", renderBase);
if (quickQuery) quickQuery.addEventListener("input", () => searchQuickSwitcher(quickQuery.value));
if (closeQuickSwitcherButton) closeQuickSwitcherButton.addEventListener("click", () => quickSwitcher?.close());
editorModeButtons.forEach((button) => button.addEventListener("click", () => {
  const mode = button.dataset.editorMode;
  if (mode === "source" || mode === "live-preview" || mode === "reading") setEditorMode(mode);
}));
if (toggleContextButton) toggleContextButton.addEventListener("click", () => setSplitView(!workspaceSettings.splitView));
if (toggleLeftSidebarButton) toggleLeftSidebarButton.addEventListener("click", () => setLeftSidebarVisible(!leftSidebarVisible));
if (toggleSettingsButton) toggleSettingsButton.addEventListener("click", () => {
  if (!settingsPanel) return;
  if (settingsPanel.hidden) openSettingsPanel();
  else togglePanel(settingsPanel, false);
});
if (closeSettingsButton) closeSettingsButton.addEventListener("click", () => setHidden(settingsPanel, true));
if (settingsSearch) settingsSearch.addEventListener("input", renderSettingsSearch);
if (appearanceTheme) appearanceTheme.addEventListener("change", applySelectedAppearance);
if (appearanceMode) appearanceMode.addEventListener("change", applySelectedAppearance);
if (defaultEditorMode) defaultEditorMode.addEventListener("change", () => {
  const mode = defaultEditorMode.value;
  if (mode === "source" || mode === "live-preview" || mode === "reading") setEditorMode(mode);
});
if (splitView) splitView.addEventListener("change", () => setSplitView(splitView.checked));
if (historyAgeDays) historyAgeDays.addEventListener("change", updateHistoryPolicyFromInputs);
if (historyMaxMiB) historyMaxMiB.addEventListener("change", updateHistoryPolicyFromInputs);
if (saveProviderButton) saveProviderButton.addEventListener("click", () => void saveProviderConfiguration());
if (saveProviderCredentialButton) saveProviderCredentialButton.addEventListener("click", () => void saveProviderCredential());
if (refreshProviderButton) refreshProviderButton.addEventListener("click", () => void loadProviderConfiguration());
if (showDiagnosticsButton) showDiagnosticsButton.addEventListener("click", () => void loadDiagnosticManifest());
if (extensionBisectButton) extensionBisectButton.addEventListener("click", () => reportExternalHandoff("Extension trust and bisect"));
if (showModelHandoffButton) showModelHandoffButton.addEventListener("click", () => reportExternalHandoff("Model and download management"));
if (showAccountBillingHandoffButton) showAccountBillingHandoffButton.addEventListener("click", () => reportExternalHandoff("Account and billing"));
if (safeModeButton) safeModeButton.addEventListener("click", () => reportExternalHandoff("Safe mode"));
if (openSourceInspectorButton) openSourceInspectorButton.addEventListener("click", openSourceInspector);
if (reviewRetentionButton) reviewRetentionButton.addEventListener("click", () => void retentionPlanRequest());
if (cleanupHistoryButton) cleanupHistoryButton.addEventListener("click", () => void cleanupHistoryRequest());
if (closeConflictButton) closeConflictButton.addEventListener("click", closeConflict);
if (keepCurrentButton) keepCurrentButton.addEventListener("click", () => void resolveSelectedConflict("keep-current"));
if (keepIncomingButton) keepIncomingButton.addEventListener("click", () => void resolveSelectedConflict("keep-incoming"));
if (reviewButton) reviewButton.addEventListener("click", () => void reviewChangesRequest());
if (historyButton) historyButton.addEventListener("click", () => void historyRequest());
if (closeChangesButton) closeChangesButton.addEventListener("click", () => setHidden(changePanel, true));
if (closeHistoryButton) closeHistoryButton.addEventListener("click", () => setHidden(historyPanel, true));
if (diffPath) diffPath.addEventListener("change", () => void loadDiff());
if (diffStaged) diffStaged.addEventListener("change", () => void loadDiff());
if (commitSelectedButton) commitSelectedButton.addEventListener("click", () => void commitSelectedRequest());
if (searchInput) searchInput.addEventListener("input", () => void searchVault(searchInput.value));
if (editor) editor.addEventListener("input", () => {
  dirty = true;
  syncActiveTab();
  renderNotePreview(editor.value);
  renderTabs();
  void persistWorkspaceState();
  updateEditorState();
  setStatus("Unsaved changes · save to create a recoverable revision.");
});
if (saveButton) saveButton.addEventListener("click", () => void saveNote());
if (popoutButton) popoutButton.addEventListener("click", openPopout);
if (api) api.onRetrievalProgress(renderRetrievalProgress);
function keyboardAction(command: KeyboardCommandId): (() => void) | undefined {
  return {
    "command-palette": openCommandPalette,
    "quick-switcher": openQuickSwitcher,
    "save-note": () => void saveNote(),
  }[command];
}

function handleKeydown(event: KeyboardEvent): void {
  const command = resolveKeyboardCommand(event);
  const action = command ? keyboardAction(command) : undefined;
  if (!action) return;
  event.preventDefault();
  action();
}

document.addEventListener("keydown", handleKeydown);
applySharedDesignTokens();
applySharedActionMetadata();
applySharedVaultPaneMetadata();
applyUninstallCleanupMetadata();
setVaultPane(activeVaultPane);
renderLeftSidebar();
renderSettingsSearch();
applyLocale();
updateEditorState();
workspaceStateReady = loadWorkspaceSettings().then(() => loadWorkspaceState()).then(() => loadProviderConfiguration());
