import {DEFAULT_HISTORY_POLICY, DEFAULT_WORKSPACE_SETTINGS, type EditorMode, type NoteContext, type OpenObsidianAPI, type SyncToolDisposition, type VaultHistoryRecord, type WorkspaceSettings} from "../shared/api.js";

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
const settingsPanel = document.querySelector<HTMLElement>("#settings-panel");
const toggleSettingsButton = document.querySelector<HTMLButtonElement>("#toggle-settings");
const closeSettingsButton = document.querySelector<HTMLButtonElement>("#close-settings");
const defaultEditorMode = document.querySelector<HTMLSelectElement>("#default-editor-mode");
const splitView = document.querySelector<HTMLInputElement>("#split-view");
let selectedSummary: VaultSummary | null = null;
let selectedPath: string | null = null;
let selectedRevision: string | null = null;
let dirty = false;
let requestId = 0;
let changeReview: Awaited<ReturnType<OpenObsidianAPI["reviewChanges"]>> | null = null;
let workspaceSettings: WorkspaceSettings = {...DEFAULT_WORKSPACE_SETTINGS};
let tabStates: NoteTab[] = [];
let contextRequestId = 0;
let paletteRequestId = 0;
let selectedConflict: VaultHistoryRecord | null = null;

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
  if (defaultEditorMode) defaultEditorMode.value = settings.editorMode;
  if (splitView) splitView.checked = settings.splitView;
  renderEditorMode();
  renderContextSplit();
}

async function persistWorkspaceSettings(): Promise<void> {
  if (!api) return;
  try {
    applyWorkspaceSettings(await api.saveSettings(workspaceSettings));
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

function updateChronicleControls(): void {
  setDisabled(openQuickSwitcherButton, !selectedSummary);
  setDisabled(reviewButton, !selectedSummary || selectedSummary.git.vaultType !== "chronicle");
  setDisabled(historyButton, !selectedSummary);
  setDisabled(reviewRetentionButton, !selectedSummary);
  if (!selectedSummary) setDisabled(cleanupHistoryButton, true);
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

function renderFiles(files: Awaited<ReturnType<OpenObsidianAPI["listFiles"]>>): void {
  if (!fileList) return;
  fileList.replaceChildren();
  if (files.length === 0) {
    const message = document.createElement("p");
    message.className = "empty-list";
    message.textContent = "No Markdown notes found.";
    fileList.append(message);
    return;
  }
  files.forEach((file) => fileList.append(fileButton(file.relativePath, file.kind, undefined, file.kind === "file" && file.relativePath.toLowerCase().endsWith(".md"))));
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
  results.forEach((result) => fileList.append(fileButton(result.relativePath, "file", result.preview)));
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

function togglePanel(panel: HTMLElement | null, visible: boolean): void {
  setHidden(changePanel, panel !== changePanel || !visible);
  setHidden(historyPanel, panel !== historyPanel || !visible);
  setHidden(settingsPanel, panel !== settingsPanel || !visible);
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
    renderRetentionSummary(await api.historyPlan(DEFAULT_HISTORY_POLICY));
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
    const result = await api.cleanupHistory(DEFAULT_HISTORY_POLICY);
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
    setStatus(`Opened ${response.relativePath} · revision ${response.revision.slice(0, 12)}…`);
  } catch (error) {
    setStatus(errorText(error, "Unable to open the note."));
  }
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
  if (activateLoadedTab(path)) return;
  beginFileRead(api, path);
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
  renderTabs();
  renderNoteContext({relativePath: "", headings: [], backlinks: []});
  updateEditorState();
}

function showNoVault(): void {
  setText(vaultMode, "No vault");
  if (fileList) fileList.replaceChildren();
  setHidden(changePanel, true);
  setHidden(historyPanel, true);
  setHidden(settingsPanel, true);
  setHidden(conflictBox, true);
  selectedConflict = null;
  changeReview = null;
  updateChronicleControls();
  setStatus(summaryMessage(selectedSummary));
}

async function openVaultRequest(client: OpenObsidianAPI): Promise<void> {
  try {
    selectedSummary = await client.selectVault();
    resetEditor();
    if (!selectedSummary) {
      showNoVault();
      return;
    }
    renderMode(selectedSummary);
    await listFilesRequest(client);
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
if (openQuickSwitcherButton) openQuickSwitcherButton.addEventListener("click", () => openQuickSwitcher());
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
  updateEditorState();
  setStatus("Unsaved changes · save to create a recoverable revision.");
});
if (saveButton) saveButton.addEventListener("click", () => void saveNote());
function isShortcut(event: KeyboardEvent, key: string): boolean {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === key;
}

function handleKeydown(event: KeyboardEvent): void {
  if (isShortcut(event, "s")) {
    event.preventDefault();
    void saveNote();
  }
  if (isShortcut(event, "p") || isShortcut(event, "o")) {
    event.preventDefault();
    openQuickSwitcher();
  }
}

document.addEventListener("keydown", handleKeydown);
updateEditorState();
void loadWorkspaceSettings();
