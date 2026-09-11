import {app, BrowserWindow, dialog, ipcMain} from "electron";
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join, resolve} from "node:path";
import {applyAIChangeSet, draftLocalAIChange, organizationSuggestions, undoAIChange, type AppliedAIChange} from "../core/ai-changes.js";
import {describeProvider} from "../core/providers.js";
import {chronicleDiff, chronicleHistory, commitChronicleSelection, inspectVaultGitState, restoreChronicleFile, reviewChronicleChanges} from "../core/chronicle.js";
import {createNoteFromTextNode, editCanvasTextNode, parseCanvas} from "../core/canvas.js";
import {evaluateBase, parseBase, type BaseRow} from "../core/bases.js";
import {buildVaultGraph} from "../core/graph.js";
import {cleanupHistory, DEFAULT_HISTORY_POLICY, historyRecordsFromStore, planHistoryRetention} from "../core/history.js";
import {parseMarkdown} from "../core/markdown.js";
import {buildNoteContext} from "../core/note-context.js";
import {createDiagnosticManifest, type DiagnosticManifest} from "../core/privacy.js";
import {retrieveVault} from "../core/retrieval.js";
import {syncToolDispositions} from "../core/sync-tools.js";
import {buildVaultIndex, searchVaultIndex} from "../core/vault-index.js";
import {VaultStore} from "../core/vault.js";
import {buildDailyNotePlan, buildTemplateIndex, openDailyNote} from "../core/note-workflows.js";
import {buildBookmarkIndex, buildTagIndex, buildTaskIndex, toggleVaultTask} from "../core/workflows.js";
import {discoverVaultConfiguration} from "../core/configuration.js";
import {ElectronCredentialStore} from "./provider-credentials.js";
import {parseAppearanceSettings, type VaultAppearance} from "../shared/ui/index.js";
import {CHANNELS, DEFAULT_PROVIDER_SETTINGS, DEFAULT_WORKSPACE_SETTINGS, DEFAULT_WORKSPACE_STATE, validateAIDraftRequest, validateAIApplyChangeRequest, validateAIOrganizationScope, validateAIUndoChangeRequest, validateCanvasCreateNoteRequest, validateCanvasTextEditRequest, validateChronicleCommitRequest, validateChronicleDiffRequest, validateChronicleRestoreRequest, validateConflictReadRequest, validateConflictResolutionRequest, validateHistoryPolicy, validateProviderCredentialRequest, validateProviderSettings, validateRetrievalRequest, validateTaskToggleRequest, validateVaultWriteRequest, validateWorkspaceSettings, validateWorkspaceState, type AIApplyChangeResponse, type AIChangeSet, type AIOrganizationResponse, type AIUndoChangeResponse, type BaseEvaluationView, type BaseResponse, type BaseValue, type CanvasCreateNoteResponse, type CanvasView, type ConflictReadResponse, type ConflictResolutionResponse, type GraphView, type HistoryCleanupResult, type HistoryPlanSummary, type HistoryPolicy, type NoteContext, type ProviderSettings, type ProviderStatus, type RetrievalResponse, type SyncToolDisposition, type VaultFileSummary, type VaultHistoryRecord, type VaultSearchResult, type VaultSummary, type VaultWriteRequest, type WorkspaceSettings, type WorkspaceState} from "../shared/api.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = dirname(currentFile);
let activeVault: VaultStore | null = null;
let mainWindow: BrowserWindow | null = null;
const aiChangeSets = new Map<string, AIChangeSet>();
const aiAppliedChanges = new Map<string, AppliedAIChange>();

function vaultAppData(root: string): string {
  const id = createHash("sha256").update(resolve(root)).digest("hex").slice(0, 24);
  return join(app.getPath("userData"), "vaults", id);
}

function requireVault(): VaultStore {
  if (!activeVault) throw new Error("Open a vault before using vault operations");
  return activeVault;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function decodeBase64(value: unknown): Uint8Array {
  if (!isString(value)) throw new Error("File bytes must be a base64 string");
  return new Uint8Array(Buffer.from(value, "base64"));
}

function applicationIconPath(): string {
  const appRoot = app.isPackaged ? app.getAppPath() : resolve(currentDirectory, "..");
  return join(appRoot, "assets", "openobsidian-icon.png");
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#202020",
    icon: applicationIconPath(),
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? {x: 12, y: 12} : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(currentDirectory, "preload.cjs"),
    },
  });
  const projectRoot = resolve(currentDirectory, "..");
  const rendererPath = app.isPackaged ? join(app.getAppPath(), "src/renderer/index.html") : join(projectRoot, "src/renderer/index.html");
  void mainWindow.loadFile(rendererPath);
}

function selectedDirectory(filePaths: string[], canceled: boolean): string | null {
  return canceled ? null : filePaths[0] ?? null;
}

async function selectVault(): Promise<VaultSummary | null> {
  const options = {properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">};
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  const root = selectedDirectory(result.filePaths, result.canceled);
  if (!root) return null;
  if (!existsSync(root)) throw new Error("Selected vault directory is no longer available");
  activeVault = new VaultStore(root, vaultAppData(root));
  aiChangeSets.clear();
  aiAppliedChanges.clear();
  const scan = activeVault.scan();
  const git = inspectVaultGitState(activeVault.root);
  return {
    root: activeVault.root,
    fileCount: scan.after.entries.length,
    unchanged: scan.unchanged,
    sha256: scan.after.sha256,
    git: {
      vaultType: git.vaultType,
      branch: git.branch,
      head: git.head,
      unborn: git.unborn,
      dirty: git.dirty,
      staged: git.staged,
      untracked: git.untracked,
      remoteCount: git.remotes.length,
      authorConfigured: git.authorConfigured,
      remoteContacted: git.remoteContacted,
    },
  };
}

function listFiles(): VaultFileSummary[] {
  return requireVault().scan().after.entries.map((entry) => ({relativePath: entry.relativePath, kind: entry.kind, bytes: entry.bytes, sha256: entry.sha256}));
}

function searchFiles(_event: Electron.IpcMainInvokeEvent, query: unknown): VaultSearchResult[] {
  if (typeof query !== "string") throw new Error("Search query must be a string");
  return searchVaultIndex(buildVaultIndex(requireVault()), query.slice(0, 200)).slice(0, 50);
}

function readFile(_event: Electron.IpcMainInvokeEvent, relativePath: unknown): object {
  if (!isString(relativePath)) throw new Error("Vault path must be a string");
  const read = requireVault().read(relativePath);
  return {relativePath: read.relativePath, base64: Buffer.from(read.bytes).toString("base64"), revision: read.revision};
}

function writeFile(_event: Electron.IpcMainInvokeEvent, value: unknown): object {
  const request: VaultWriteRequest = validateVaultWriteRequest(value);
  const written = requireVault().write({
    relativePath: request.relativePath,
    expectedRevision: request.expectedRevision,
    bytes: decodeBase64(request.base64),
  });
  return {relativePath: written.relativePath, base64: Buffer.from(written.bytes).toString("base64"), revision: written.revision};
}

function requireChronicle(): VaultStore {
  const store = requireVault();
  if (inspectVaultGitState(store.root).vaultType !== "chronicle") throw new Error("Chronicle actions require a Git-backed vault");
  return store;
}

function reviewChanges(): ReturnType<typeof reviewChronicleChanges> {
  const store = requireChronicle();
  return reviewChronicleChanges(store.root, store.appDataRoot);
}

function diffChanges(_event: Electron.IpcMainInvokeEvent, value: unknown): string {
  const request = validateChronicleDiffRequest(value);
  const store = requireChronicle();
  return chronicleDiff(store.root, request.relativePath, request.staged);
}

function chronicleHistoryRequest(_event: Electron.IpcMainInvokeEvent, value: unknown): ReturnType<typeof chronicleHistory> {
  const store = requireChronicle();
  const limit = value === undefined ? undefined : Number(value);
  return chronicleHistory(store.root, limit);
}

function historyRecordsRequest(_event: Electron.IpcMainInvokeEvent, relativePath: unknown): VaultHistoryRecord[] {
  if (relativePath !== undefined && typeof relativePath !== "string") throw new Error("History path must be a string");
  return historyRecordsFromStore(requireVault(), relativePath).map((record) => ({
    id: record.id,
    relativePath: record.relativePath,
    revision: record.revision,
    bytes: record.bytes,
    capturedAt: record.capturedAt,
    kind: record.kind,
    protected: record.protected === true,
    expectedRevision: record.expectedRevision,
    currentRevision: record.currentRevision,
  }));
}

function historyPolicy(value: unknown): HistoryPolicy {
  return value === undefined || value === null ? DEFAULT_HISTORY_POLICY : validateHistoryPolicy(value);
}

function historyPlanRequest(_event: Electron.IpcMainInvokeEvent, value: unknown): HistoryPlanSummary {
  const policy = historyPolicy(value);
  const plan = planHistoryRetention(historyRecordsFromStore(requireVault()), new Date(), policy);
  return {retainedCount: plan.retained.length, pruneableCount: plan.pruneable.length, protectedCount: plan.protected.length, retainedBytes: plan.retainedBytes, pruneableBytes: plan.pruneableBytes, warning: plan.protected.length > 0 && plan.protected.reduce((total, record) => total + record.bytes, 0) > policy.maxBytes};
}

function cleanupHistoryRequest(_event: Electron.IpcMainInvokeEvent, value: unknown): HistoryCleanupResult {
  const store = requireVault();
  const policy = historyPolicy(value);
  const plan = planHistoryRetention(historyRecordsFromStore(store), new Date(), policy);
  return cleanupHistory(plan, policy, (path) => store.removeHistoryPath(path));
}

function conflictReadRequest(_event: Electron.IpcMainInvokeEvent, value: unknown): ConflictReadResponse {
  const request = validateConflictReadRequest(value);
  const conflict = requireVault().readConflict(request.id, request.relativePath);
  const revision = createHash("sha256").update(conflict.bytes).digest("hex");
  return {id: conflict.record.id, relativePath: conflict.record.relativePath, base64: Buffer.from(conflict.bytes).toString("base64"), revision};
}

function conflictResolutionRequest(_event: Electron.IpcMainInvokeEvent, value: unknown): ConflictResolutionResponse {
  const request = validateConflictResolutionRequest(value);
  const result = requireVault().resolveConflict(request.id, request.action, request.relativePath);
  return {id: result.id, relativePath: result.relativePath, action: result.action, read: result.read ? {relativePath: result.read.relativePath, base64: Buffer.from(result.read.bytes).toString("base64"), revision: result.read.revision} : undefined};
}

function syncToolsRequest(): SyncToolDisposition[] {
  return syncToolDispositions();
}

function graphRequest(): GraphView {
  return buildVaultGraph(buildVaultIndex(requireVault()));
}

function canvasView(store: VaultStore, relativePath: string): CanvasView {
  const read = store.read(relativePath);
  const document = parseCanvas(read.bytes);
  return {relativePath: read.relativePath, revision: read.revision, nodes: document.nodes, edges: document.edges};
}

function canvasRequest(_event: Electron.IpcMainInvokeEvent, value: unknown): CanvasView {
  if (typeof value !== "string") throw new Error("Canvas path must be a string");
  return canvasView(requireVault(), value);
}

function editCanvasTextRequest(_event: Electron.IpcMainInvokeEvent, value: unknown): CanvasView {
  const request = validateCanvasTextEditRequest(value);
  const store = requireVault();
  const current = store.read(request.relativePath);
  const bytes = editCanvasTextNode(current.bytes, request.nodeId, request.text);
  store.write({relativePath: current.relativePath, expectedRevision: request.expectedRevision, bytes});
  return canvasView(store, current.relativePath);
}

function createCanvasNoteRequest(_event: Electron.IpcMainInvokeEvent, value: unknown): CanvasCreateNoteResponse {
  const request = validateCanvasCreateNoteRequest(value);
  const store = requireVault();
  const current = store.read(request.relativePath);
  if (current.revision !== request.expectedRevision) throw new Error("Canvas changed; reopen it before creating a note");
  const source = createNoteFromTextNode(current.bytes, request.nodeId, request.notePath);
  const created = store.write({relativePath: source.path, expectedRevision: null, bytes: source.bytes});
  return {canvas: canvasView(store, current.relativePath), created: {relativePath: created.relativePath, base64: Buffer.from(created.bytes).toString("base64"), revision: created.revision}};
}

function baseKeyword(value: string): BaseValue | undefined {
  return {null: null, true: true, false: false}[value];
}

function baseNumber(value: string): number | undefined {
  return /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : undefined;
}

function baseValue(rawValue: string): BaseValue {
  const value = rawValue.trim();
  const keyword = baseKeyword(value);
  if (keyword !== undefined) return keyword;
  return baseNumber(value) ?? value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");
}

function baseProperties(store: VaultStore, relativePath: string): Record<string, BaseValue> {
  try {
    const read = store.read(relativePath);
    return Object.fromEntries(parseMarkdown(read.bytes).properties.map((property) => [property.key, property.value ?? baseValue(property.rawValue)]));
  } catch {
    return {};
  }
}

function baseRows(store: VaultStore): BaseRow[] {
  return buildVaultIndex(store).files.filter((file) => file.relativePath.toLowerCase().endsWith(".md")).map((file) => ({path: file.relativePath, properties: baseProperties(store, file.relativePath)}));
}

function baseEvaluationView(document: ReturnType<typeof parseBase>, view: ReturnType<typeof parseBase>["views"][number], rows: BaseRow[]): BaseEvaluationView {
  const evaluation = evaluateBase({...document, views: [view]}, view.name ?? "", rows);
  return {name: view.name, type: view.type, rows: evaluation.rows.map((row) => ({path: row.path, values: row.values})), groups: Object.fromEntries(Object.entries(evaluation.groups).map(([key, group]) => [key, group.map((row) => ({path: row.path, values: row.values}))])), issues: evaluation.issues};
}

function baseRequest(_event: Electron.IpcMainInvokeEvent, value: unknown): BaseResponse {
  if (typeof value !== "string") throw new Error("Bases path must be a string");
  const store = requireVault();
  const read = store.read(value);
  const document = parseBase(read.bytes);
  const rows = baseRows(store);
  return {relativePath: read.relativePath, revision: read.revision, views: document.views.map((view) => baseEvaluationView(document, view, rows))};
}

function retrieveRequest(event: Electron.IpcMainInvokeEvent, value: unknown): RetrievalResponse {
  const request = validateRetrievalRequest(value);
  return retrieveVault(requireVault(), request, (progress) => event.sender.send(CHANNELS.retrievalProgress, progress));
}

function draftAIChangeRequest(_event: Electron.IpcMainInvokeEvent, value: unknown): AIChangeSet {
  const changeSet = draftLocalAIChange(requireVault(), validateAIDraftRequest(value));
  aiChangeSets.set(changeSet.id, changeSet);
  return changeSet;
}

function applyAIChangeRequest(_event: Electron.IpcMainInvokeEvent, value: unknown): AIApplyChangeResponse {
  const request = validateAIApplyChangeRequest(value);
  const changeSet = aiChangeSets.get(request.changeSetId);
  if (!changeSet) throw new Error("AI change set is no longer available; create a new preview");
  const applied = applyAIChangeSet(requireVault(), changeSet, request);
  aiAppliedChanges.set(applied.undoId, applied);
  return {changeSetId: applied.changeSetId, undoId: applied.undoId, files: applied.files.map((file) => ({relativePath: file.relativePath, base64: Buffer.from(requireVault().read(file.relativePath).bytes).toString("base64"), revision: file.writtenRevision}))};
}

function undoAIChangeRequest(_event: Electron.IpcMainInvokeEvent, value: unknown): AIUndoChangeResponse {
  const request = validateAIUndoChangeRequest(value);
  const applied = aiAppliedChanges.get(request.undoId);
  if (!applied) throw new Error("AI undo record is no longer available; inspect recovery history instead");
  const result = undoAIChange(requireVault(), applied);
  aiAppliedChanges.delete(request.undoId);
  return result;
}

function organizationSuggestionsRequest(_event: Electron.IpcMainInvokeEvent, value: unknown): AIOrganizationResponse {
  return organizationSuggestions(requireVault(), validateAIOrganizationScope(value));
}

function restoreChronicle(_event: Electron.IpcMainInvokeEvent, value: unknown): object {
  const request = validateChronicleRestoreRequest(value);
  const store = requireChronicle();
  const restored = restoreChronicleFile(store.root, store, request.revision, request.relativePath);
  return {relativePath: restored.read.relativePath, base64: Buffer.from(restored.read.bytes).toString("base64"), revision: restored.read.revision};
}

function commitChronicle(_event: Electron.IpcMainInvokeEvent, value: unknown): ReturnType<typeof commitChronicleSelection> {
  const request = validateChronicleCommitRequest(value);
  const store = requireChronicle();
  return commitChronicleSelection(store.root, request.selectedPaths, request.message, store.appDataRoot);
}

function workspaceSettingsPath(): string {
  return join(app.getPath("userData"), "workspace-settings.json");
}

function loadSettings(): WorkspaceSettings {
  try {
    return validateWorkspaceSettings(JSON.parse(readFileSync(workspaceSettingsPath(), "utf8")));
  } catch {
    return DEFAULT_WORKSPACE_SETTINGS;
  }
}

function saveSettings(_event: Electron.IpcMainInvokeEvent, value: unknown): WorkspaceSettings {
  const settings = validateWorkspaceSettings(value);
  mkdirSync(app.getPath("userData"), {recursive: true});
  writeFileSync(workspaceSettingsPath(), `${JSON.stringify(settings, null, 2)}\n`);
  return settings;
}

function loadAppearance(): VaultAppearance {
  const configuration = discoverVaultConfiguration(requireVault().root);
  const settingsEntry = Object.entries(configuration.appearance)[0];
  return {
    settingsPath: settingsEntry?.[0] ?? null,
    settings: settingsEntry?.[1] ?? parseAppearanceSettings({}),
    styles: configuration.styles.map((style) => ({
      relativePath: style.relativePath,
      kind: style.kind,
      sha256: style.sha256,
      source: new TextDecoder().decode(style.bytes),
      analysis: style.analysis,
    })),
  };
}

function providerSettingsPath(): string {
  return join(app.getPath("userData"), "provider-settings.json");
}

function providerCredentialStore(): ElectronCredentialStore {
  return new ElectronCredentialStore(join(app.getPath("userData"), "provider-credentials.json"));
}

function loadProviderSettings(): ProviderSettings {
  try {
    return validateProviderSettings(JSON.parse(readFileSync(providerSettingsPath(), "utf8")));
  } catch {
    return DEFAULT_PROVIDER_SETTINGS;
  }
}

function saveProviderSettings(_event: Electron.IpcMainInvokeEvent, value: unknown): ProviderSettings {
  const settings = validateProviderSettings(value);
  mkdirSync(app.getPath("userData"), {recursive: true});
  writeFileSync(providerSettingsPath(), `${JSON.stringify(settings, null, 2)}\n`);
  return settings;
}

function providerStatus(): ProviderStatus {
  return describeProvider(loadProviderSettings(), providerCredentialStore());
}

function diagnosticManifest(): DiagnosticManifest {
  const provider = providerStatus();
  const vault = activeVault;
  const scan = vault?.scan();
  return createDiagnosticManifest({
    applicationVersion: app.getVersion(),
    platform: process.platform,
    architecture: process.arch,
    vaultFileCount: scan?.after.entries.length,
    vaultKind: vault ? inspectVaultGitState(vault.root).vaultType : "none",
    providerMode: provider.mode,
    providerId: provider.providerId,
    providerCredentialState: provider.credentialState,
  });
}

function saveProviderCredential(_event: Electron.IpcMainInvokeEvent, value: unknown): ProviderStatus {
  const request = validateProviderCredentialRequest(value);
  providerCredentialStore().write(request.credentialRef, request.secret);
  return providerStatus();
}

function workspaceStatePath(): string {
  return join(app.getPath("userData"), "workspace-state.json");
}

function loadWorkspaceState(): WorkspaceState {
  try {
    return validateWorkspaceState(JSON.parse(readFileSync(workspaceStatePath(), "utf8")));
  } catch {
    return DEFAULT_WORKSPACE_STATE;
  }
}

function saveWorkspaceState(_event: Electron.IpcMainInvokeEvent, value: unknown): WorkspaceState {
  const state = validateWorkspaceState(value);
  mkdirSync(app.getPath("userData"), {recursive: true});
  writeFileSync(workspaceStatePath(), `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

function noteContext(_event: Electron.IpcMainInvokeEvent, relativePath: unknown): NoteContext {
  if (typeof relativePath !== "string") throw new Error("Note path must be a string");
  return buildNoteContext(requireVault(), relativePath);
}

function bookmarksRequest() {
  return buildBookmarkIndex(requireVault());
}

function tagsRequest() {
  return buildTagIndex(requireVault());
}

function tasksRequest() {
  return buildTaskIndex(requireVault());
}

function templatesRequest() {
  return buildTemplateIndex(requireVault());
}

function dailyNoteRequest() {
  return buildDailyNotePlan(requireVault());
}

function openDailyNoteRequest() {
  const opened = openDailyNote(requireVault());
  return {relativePath: opened.relativePath, base64: Buffer.from(opened.bytes).toString("base64"), revision: opened.revision};
}

function toggleTaskRequest(_event: Electron.IpcMainInvokeEvent, value: unknown): object {
  const request = validateTaskToggleRequest(value);
  const updated = toggleVaultTask(requireVault(), request.relativePath, request.expectedRevision, request.line, request.checked);
  return {relativePath: updated.relativePath, base64: Buffer.from(updated.bytes).toString("base64"), revision: updated.revision};
}

function registerVaultHandlers(): void {
  ipcMain.handle(CHANNELS.selectVault, selectVault);
  ipcMain.handle(CHANNELS.listFiles, listFiles);
  ipcMain.handle(CHANNELS.search, searchFiles);
  ipcMain.handle(CHANNELS.readFile, readFile);
  ipcMain.handle(CHANNELS.writeFile, writeFile);
  ipcMain.handle(CHANNELS.reviewChanges, reviewChanges);
  ipcMain.handle(CHANNELS.diffChanges, diffChanges);
  ipcMain.handle(CHANNELS.chronicleHistory, chronicleHistoryRequest);
  ipcMain.handle(CHANNELS.historyRecords, historyRecordsRequest);
  ipcMain.handle(CHANNELS.historyPlan, historyPlanRequest);
  ipcMain.handle(CHANNELS.cleanupHistory, cleanupHistoryRequest);
  ipcMain.handle(CHANNELS.readConflict, conflictReadRequest);
  ipcMain.handle(CHANNELS.resolveConflict, conflictResolutionRequest);
  ipcMain.handle(CHANNELS.syncTools, syncToolsRequest);
  ipcMain.handle(CHANNELS.graph, graphRequest);
  ipcMain.handle(CHANNELS.canvas, canvasRequest);
  ipcMain.handle(CHANNELS.editCanvasText, editCanvasTextRequest);
  ipcMain.handle(CHANNELS.createCanvasNote, createCanvasNoteRequest);
  ipcMain.handle(CHANNELS.base, baseRequest);
  ipcMain.handle(CHANNELS.retrieve, retrieveRequest);
  ipcMain.handle(CHANNELS.draftAIChange, draftAIChangeRequest);
  ipcMain.handle(CHANNELS.applyAIChange, applyAIChangeRequest);
  ipcMain.handle(CHANNELS.undoAIChange, undoAIChangeRequest);
  ipcMain.handle(CHANNELS.organizationSuggestions, organizationSuggestionsRequest);
  ipcMain.handle(CHANNELS.restoreChronicle, restoreChronicle);
  ipcMain.handle(CHANNELS.commitChronicle, commitChronicle);
  ipcMain.handle(CHANNELS.noteContext, noteContext);
  ipcMain.handle(CHANNELS.bookmarks, bookmarksRequest);
  ipcMain.handle(CHANNELS.tags, tagsRequest);
  ipcMain.handle(CHANNELS.tasks, tasksRequest);
  ipcMain.handle(CHANNELS.toggleTask, toggleTaskRequest);
  ipcMain.handle(CHANNELS.templates, templatesRequest);
  ipcMain.handle(CHANNELS.dailyNote, dailyNoteRequest);
  ipcMain.handle(CHANNELS.openDailyNote, openDailyNoteRequest);
  ipcMain.handle(CHANNELS.loadSettings, loadSettings);
  ipcMain.handle(CHANNELS.saveSettings, saveSettings);
  ipcMain.handle(CHANNELS.loadAppearance, loadAppearance);
  ipcMain.handle(CHANNELS.loadProviderSettings, loadProviderSettings);
  ipcMain.handle(CHANNELS.saveProviderSettings, saveProviderSettings);
  ipcMain.handle(CHANNELS.saveProviderCredential, saveProviderCredential);
  ipcMain.handle(CHANNELS.providerStatus, providerStatus);
  ipcMain.handle(CHANNELS.diagnosticManifest, diagnosticManifest);
  ipcMain.handle(CHANNELS.loadWorkspaceState, loadWorkspaceState);
  ipcMain.handle(CHANNELS.saveWorkspaceState, saveWorkspaceState);
}

app.whenReady().then(() => {
  registerVaultHandlers();
  if (process.platform === "darwin" && app.dock) app.dock.setIcon(applicationIconPath());
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
