import {contextBridge, ipcRenderer} from "electron";
import {CHANNELS, type AIDraftRequest, type AIApplyChangeRequest, type AIUndoChangeRequest, type OpenObsidianAPI, type ProviderCredentialRequest, type RetrievalProgress, type RetrievalScope, type ToggleTaskRequest, type VaultWriteRequest} from "../shared/api.js";

const api: OpenObsidianAPI = {
  selectVault: () => ipcRenderer.invoke(CHANNELS.selectVault),
  openVault: (root: string) => ipcRenderer.invoke(CHANNELS.openVault, root),
  listFiles: () => ipcRenderer.invoke(CHANNELS.listFiles),
  search: (query) => ipcRenderer.invoke(CHANNELS.search, query),
  readFile: (relativePath) => ipcRenderer.invoke(CHANNELS.readFile, relativePath),
  writeFile: (request: VaultWriteRequest) => ipcRenderer.invoke(CHANNELS.writeFile, request),
  reviewChanges: () => ipcRenderer.invoke(CHANNELS.reviewChanges),
  diffChanges: (request) => ipcRenderer.invoke(CHANNELS.diffChanges, request),
  chronicleHistory: (limit) => ipcRenderer.invoke(CHANNELS.chronicleHistory, limit),
  historyRecords: (relativePath) => ipcRenderer.invoke(CHANNELS.historyRecords, relativePath),
  restoreChronicle: (request) => ipcRenderer.invoke(CHANNELS.restoreChronicle, request),
  commitChronicle: (request) => ipcRenderer.invoke(CHANNELS.commitChronicle, request),
  noteContext: (relativePath) => ipcRenderer.invoke(CHANNELS.noteContext, relativePath),
  bookmarks: () => ipcRenderer.invoke(CHANNELS.bookmarks),
  tags: () => ipcRenderer.invoke(CHANNELS.tags),
  tasks: () => ipcRenderer.invoke(CHANNELS.tasks),
  toggleTask: (request: ToggleTaskRequest) => ipcRenderer.invoke(CHANNELS.toggleTask, request),
  templates: () => ipcRenderer.invoke(CHANNELS.templates),
  dailyNote: () => ipcRenderer.invoke(CHANNELS.dailyNote),
  openDailyNote: () => ipcRenderer.invoke(CHANNELS.openDailyNote),
  loadSettings: () => ipcRenderer.invoke(CHANNELS.loadSettings),
  saveSettings: (settings) => ipcRenderer.invoke(CHANNELS.saveSettings, settings),
  loadAppearance: () => ipcRenderer.invoke(CHANNELS.loadAppearance),
  historyPlan: (policy) => ipcRenderer.invoke(CHANNELS.historyPlan, policy),
  cleanupHistory: (policy) => ipcRenderer.invoke(CHANNELS.cleanupHistory, policy),
  readConflict: (request) => ipcRenderer.invoke(CHANNELS.readConflict, request),
  resolveConflict: (request) => ipcRenderer.invoke(CHANNELS.resolveConflict, request),
  syncTools: () => ipcRenderer.invoke(CHANNELS.syncTools),
  loadWorkspaceState: () => ipcRenderer.invoke(CHANNELS.loadWorkspaceState),
  saveWorkspaceState: (state) => ipcRenderer.invoke(CHANNELS.saveWorkspaceState, state),
  graph: () => ipcRenderer.invoke(CHANNELS.graph),
  canvas: (relativePath) => ipcRenderer.invoke(CHANNELS.canvas, relativePath),
  editCanvasText: (request) => ipcRenderer.invoke(CHANNELS.editCanvasText, request),
  createCanvasNote: (request) => ipcRenderer.invoke(CHANNELS.createCanvasNote, request),
  base: (relativePath) => ipcRenderer.invoke(CHANNELS.base, relativePath),
  retrieve: (request) => ipcRenderer.invoke(CHANNELS.retrieve, request),
  draftAIChange: (request: AIDraftRequest) => ipcRenderer.invoke(CHANNELS.draftAIChange, request),
  applyAIChange: (request: AIApplyChangeRequest) => ipcRenderer.invoke(CHANNELS.applyAIChange, request),
  undoAIChange: (request: AIUndoChangeRequest) => ipcRenderer.invoke(CHANNELS.undoAIChange, request),
  organizationSuggestions: (scope?: RetrievalScope) => ipcRenderer.invoke(CHANNELS.organizationSuggestions, scope),
  loadProviderSettings: () => ipcRenderer.invoke(CHANNELS.loadProviderSettings),
  saveProviderSettings: (settings) => ipcRenderer.invoke(CHANNELS.saveProviderSettings, settings),
  saveProviderCredential: (request: ProviderCredentialRequest) => ipcRenderer.invoke(CHANNELS.saveProviderCredential, request),
  providerStatus: () => ipcRenderer.invoke(CHANNELS.providerStatus),
  diagnosticManifest: () => ipcRenderer.invoke(CHANNELS.diagnosticManifest),
  onLaunchIntent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, intent: Parameters<typeof listener>[0]) => listener(intent);
    ipcRenderer.on(CHANNELS.launchIntent, handler);
    return () => ipcRenderer.removeListener(CHANNELS.launchIntent, handler);
  },
  onRetrievalProgress: (listener: (progress: RetrievalProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: RetrievalProgress) => listener(progress);
    ipcRenderer.on(CHANNELS.retrievalProgress, handler);
    return () => ipcRenderer.removeListener(CHANNELS.retrievalProgress, handler);
  },
};

contextBridge.exposeInMainWorld("openObsidian", api);
