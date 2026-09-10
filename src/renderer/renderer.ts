import {DEFAULT_HISTORY_POLICY, DEFAULT_WORKSPACE_SETTINGS, DEFAULT_WORKSPACE_STATE, type BaseEvaluationView, type BaseResponse, type BaseValue, type CanvasNodeView, type CanvasView, type EditorMode, type GraphView, type HistoryPolicy, type NoteContext, type OpenObsidianAPI, type RetrievalCitation, type RetrievalProgress, type RetrievalRequest, type RetrievalResponse, type SyncToolDisposition, type VaultHistoryRecord, type WorkspaceSettings, type WorkspaceState} from "../shared/api.js";

type OpenObsidianWindow = Window & {openObsidian?: OpenObsidianAPI};
type VaultSummary = Exclude<Awaited<ReturnType<OpenObsidianAPI["selectVault"]>>, null>;
type NoteTab = {path: string; revision: string | null; content: string; dirty: boolean; loaded: boolean};

const api = (window as unknown as OpenObsidianWindow).openObsidian;
const selectButton = document.querySelector<HTMLButtonElement>("#select-vault");
const searchInput = document.querySelector<HTMLInputElement>("#vault-search");
const fileList = document.querySelector<HTMLElement>("#file-list");
const vaultMode = document.querySelector<HTMLElement>("#vault-mode");
const editorPath = document.querySelector<HTMLElement>("#editor-path");
const editor = document.querySelector<HTMLTextAreaElement>("#note-editor");
const emptyState = document.querySelector<HTMLElement>("#empty-state");
const saveButton = document.querySelector<HTMLButtonElement>("#save-note");
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
const backlinksList = document.querySelector<HTMLElement>("#backlinks-list");
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
const settingsPanel = document.querySelector<HTMLElement>("#settings-panel");
const toggleSettingsButton = document.querySelector<HTMLButtonElement>("#toggle-settings");
const closeSettingsButton = document.querySelector<HTMLButtonElement>("#close-settings");
const defaultEditorMode = document.querySelector<HTMLSelectElement>("#default-editor-mode");
const splitView = document.querySelector<HTMLInputElement>("#split-view");
const historyAgeDays = document.querySelector<HTMLInputElement>("#history-age-days");
const historyMaxMiB = document.querySelector<HTMLInputElement>("#history-max-mib");
const openGraphButton = document.querySelector<HTMLButtonElement>("#open-graph");
const openCanvasButton = document.querySelector<HTMLButtonElement>("#open-canvas");
const openBaseButton = document.querySelector<HTMLButtonElement>("#open-base");
const graphPanel = document.querySelector<HTMLElement>("#graph-panel");
const closeGraphButton = document.querySelector<HTMLButtonElement>("#close-graph");
const graphQuery = document.querySelector<HTMLInputElement>("#graph-query");
const graphNodeKind = document.querySelector<HTMLSelectElement>("#graph-node-kind");
const graphEdgeKind = document.querySelector<HTMLSelectElement>("#graph-edge-kind");
const graphSummary = document.querySelector<HTMLElement>("#graph-summary");
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
let changeReview: Awaited<ReturnType<OpenObsidianAPI["reviewChanges"]>> | null = null;
let workspaceSettings: WorkspaceSettings = {...DEFAULT_WORKSPACE_SETTINGS, historyPolicy: {...DEFAULT_HISTORY_POLICY}};
let workspaceState: WorkspaceState = {...DEFAULT_WORKSPACE_STATE, settings: workspaceSettings, openTabs: [], navigationHistory: []};
let tabStates: NoteTab[] = [];
let contextRequestId = 0;
let paletteRequestId = 0;
let selectedConflict: VaultHistoryRecord | null = null;
let workspaceStateReady: Promise<void> = Promise.resolve();
let vaultFiles: Awaited<ReturnType<OpenObsidianAPI["listFiles"]>> = [];
let graphData: GraphView | null = null;
let canvasData: CanvasView | null = null;
let baseData: BaseResponse | null = null;
let retrievalData: RetrievalResponse | null = null;
let pendingCitation: RetrievalCitation | null = null;

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

function decodeBase64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function setText(element: HTMLElement | null, value: string): void {
  if (element) element.textContent = value;
}

function setDisabled(element: HTMLButtonElement | HTMLTextAreaElement | null, value: boolean): void {
  if (element) element.disabled = value;
}

function setHidden(element: HTMLElement | null, value: boolean): void {
  if (element) element.hidden = value;
}

function previewLine(line: string): HTMLElement | null {
  if (!line.trim()) return null;
  const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/.exec(line);
  if (heading) {
    const element = document.createElement(`h${heading[1]!.length}`);
    element.textContent = heading[2]!.trim();
    return element;
  }
  const task = /^\s*[-*][ \t]+\[([ xX])\][ \t]+(.+)$/.exec(line);
  if (task) {
    const row = document.createElement("label");
    row.className = "task-line";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task[1]!.toLocaleLowerCase() === "x";
    checkbox.disabled = true;
    const text = document.createElement("span");
    text.textContent = task[2]!;
    row.append(checkbox, text);
    return row;
  }
  const paragraph = document.createElement("p");
  paragraph.textContent = line;
  return paragraph;
}

function renderNotePreview(value: string): void {
  if (!notePreview) return;
  notePreview.replaceChildren(...value.split(/\r\n|\n|\r/).flatMap((line) => {
    const element = previewLine(line);
    return element ? [element] : [];
  }));
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
  setHidden(contextPane, !workspaceSettings.splitView || !selectedPath);
  toggleContextButton?.replaceChildren(document.createTextNode(contextButtonLabel()));
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
  setHidden(emptyState, Boolean(selectedPath));
  renderEditorMode();
  renderContextSplit();
  updateChronicleControls();
}

function modeDetail(git: VaultSummary["git"]): string {
  if (git.vaultType !== "chronicle") return "";
  return git.branch ? ` · ${git.branch}` : "";
}

function renderMode(summary: VaultSummary): void {
  if (!vaultMode) return;
  vaultMode.textContent = `${gitSummaryMessage(summary.git)}${modeDetail(summary.git)}`;
  vaultMode.dataset.state = summary.git.dirty ? "dirty" : "clean";
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

function supportedWorkspaceFile(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".canvas") || lower.endsWith(".base");
}

function renderFiles(files: Awaited<ReturnType<OpenObsidianAPI["listFiles"]>>): void {
  vaultFiles = files;
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
  renderContextList(backlinksList, context.backlinks.map((backlink) => contextButton(backlink.relativePath, `line ${backlink.line}`, () => openFile(backlink.relativePath))), "No notes link here yet.");
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
    {label: "Open graph", shortcut: "", available: () => Boolean(selectedSummary), run: () => void openGraphPanel()},
    {label: "Open Canvas", shortcut: "", available: () => Boolean(selectedSummary && hasWorkspaceFile(".canvas")), run: () => void openCanvasPanel()},
    {label: "Open Bases", shortcut: "", available: () => Boolean(selectedSummary && hasWorkspaceFile(".base")), run: () => void openBasePanel()},
    {label: "Open settings", shortcut: "", available: () => Boolean(settingsPanel), run: () => { if (settingsPanel) togglePanel(settingsPanel, true); }},
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
  button.textContent = `${node.kind === "unresolved" ? "Unresolved" : "Open"} · ${node.label}`;
  if (node.kind === "file") button.addEventListener("click", () => openFile(node.id));
  return button;
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

function renderGraph(): void {
  if (!graphData || !graphNodeList || !graphEdgeList) return;
  const nodes = graphData.nodes.filter(graphNodeMatches);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graphData.edges.filter((edge) => graphEdgeMatches(edge, nodeIds));
  setText(graphSummary, `${graphCountLabel(nodes.length, "visible node")} · ${graphCountLabel(edges.length, "visible edge")} · derived state only`);
  renderGraphList(graphNodeList, nodes.map(graphNodeButton), "No graph nodes match this filter.");
  renderGraphList(graphEdgeList, edges.map(graphEdgeRow), "No graph edges match this filter.");
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
  [changePanel, historyPanel, settingsPanel, graphPanel, canvasPanel, basePanel, retrievalPanel].forEach((candidate) => setHidden(candidate, candidate !== panel || !visible));
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

function formatBaseValue(value: BaseValue): string {
  return Array.isArray(value) ? `[${value.map(formatBaseValue).join(", ")}]` : String(value ?? "null");
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

function renderRetrieval(response: RetrievalResponse): void {
  const safety = response.safety.promptInjectionDetected ? " · instruction-like source treated as untrusted" : "";
  setText(retrievalMeta, `${response.mode === "local-hybrid" ? "Local hybrid" : "Keyword fallback"} · provider destination: none · ${retrievalScopeLabel(response.scope)} · ${response.indexedFiles.length} source files · ${response.excludedFiles.length} excluded${safety}`);
  renderRetrievalAnswer(response.answer);
  renderRetrievalResults(response.passages);
}

function openRetrievalCitation(citation: RetrievalCitation): void {
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

async function performRetrieval(client: OpenObsidianAPI, request: RetrievalRequest): Promise<void> {
  setDisabled(runRetrievalButton, true);
  setText(retrievalMeta, "Starting a local source index; no provider has received context…");
  setHidden(retrievalAnswer, true);
  try {
    retrievalData = await client.retrieve(request);
    renderRetrieval(retrievalData);
    setStatus(`Grounded search found ${retrievalData.passages.length} source passage${retrievalData.passages.length === 1 ? "" : "s"}; no provider request was made.`);
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

function resetEditor(): void {
  selectedPath = null;
  selectedRevision = null;
  dirty = false;
  tabStates = [];
  vaultFiles = [];
  graphData = null;
  canvasData = null;
  baseData = null;
  retrievalData = null;
  pendingCitation = null;
  renderTabs();
  renderNoteContext({relativePath: "", headings: [], backlinks: []});
  updateEditorState();
  updateWorkspaceToolControls();
}

function showNoVault(): void {
  setText(vaultMode, "No vault");
  if (fileList) fileList.replaceChildren();
  setHidden(changePanel, true);
  setHidden(historyPanel, true);
  setHidden(settingsPanel, true);
  setHidden(graphPanel, true);
  setHidden(canvasPanel, true);
  setHidden(basePanel, true);
  setHidden(retrievalPanel, true);
  setHidden(conflictBox, true);
  selectedConflict = null;
  changeReview = null;
  vaultFiles = [];
  graphData = null;
  canvasData = null;
  baseData = null;
  retrievalData = null;
  pendingCitation = null;
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
    await listFilesRequest(client);
    await restoreWorkspaceTabs(client);
    setStatus(summaryMessage(selectedSummary));
  } catch (error) {
    setStatus(errorText(error, "Unable to open the vault."));
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
if (openCommandPaletteButton) openCommandPaletteButton.addEventListener("click", openCommandPalette);
if (closeCommandPaletteButton) closeCommandPaletteButton.addEventListener("click", () => commandPalette?.close());
if (commandQuery) {
  commandQuery.addEventListener("input", renderCommandResults);
  commandQuery.addEventListener("keydown", commandQueryKeydown);
}
if (openQuickSwitcherButton) openQuickSwitcherButton.addEventListener("click", () => openQuickSwitcher());
if (openRetrievalButton) openRetrievalButton.addEventListener("click", openRetrievalPanel);
if (closeRetrievalButton) closeRetrievalButton.addEventListener("click", () => setHidden(retrievalPanel, true));
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
if (toggleSettingsButton) toggleSettingsButton.addEventListener("click", () => {
  if (!settingsPanel) return;
  const visible: boolean = settingsPanel.hidden === true;
  togglePanel(settingsPanel, visible);
});
if (closeSettingsButton) closeSettingsButton.addEventListener("click", () => setHidden(settingsPanel, true));
if (defaultEditorMode) defaultEditorMode.addEventListener("change", () => {
  const mode = defaultEditorMode.value;
  if (mode === "source" || mode === "live-preview" || mode === "reading") setEditorMode(mode);
});
if (splitView) splitView.addEventListener("change", () => setSplitView(splitView.checked));
if (historyAgeDays) historyAgeDays.addEventListener("change", updateHistoryPolicyFromInputs);
if (historyMaxMiB) historyMaxMiB.addEventListener("change", updateHistoryPolicyFromInputs);
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
if (api) api.onRetrievalProgress(renderRetrievalProgress);
function keyboardShortcut(event: KeyboardEvent): (() => void) | undefined {
  if (!(event.metaKey || event.ctrlKey)) return undefined;
  return ({s: () => void saveNote(), p: openQuickSwitcher, o: openQuickSwitcher, k: openCommandPalette} as Record<string, () => void>)[event.key.toLowerCase()];
}

function handleKeydown(event: KeyboardEvent): void {
  const action = keyboardShortcut(event);
  if (!action) return;
  event.preventDefault();
  action();
}

document.addEventListener("keydown", handleKeydown);
updateEditorState();
workspaceStateReady = loadWorkspaceSettings().then(() => loadWorkspaceState());
