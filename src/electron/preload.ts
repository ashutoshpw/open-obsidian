import {contextBridge, ipcRenderer} from "electron";
import {CHANNELS, type OpenObsidianAPI, type VaultWriteRequest} from "../shared/api.js";

const api: OpenObsidianAPI = {
  selectVault: () => ipcRenderer.invoke(CHANNELS.selectVault),
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
  loadSettings: () => ipcRenderer.invoke(CHANNELS.loadSettings),
  saveSettings: (settings) => ipcRenderer.invoke(CHANNELS.saveSettings, settings),
  historyPlan: (policy) => ipcRenderer.invoke(CHANNELS.historyPlan, policy),
  cleanupHistory: (policy) => ipcRenderer.invoke(CHANNELS.cleanupHistory, policy),
  readConflict: (request) => ipcRenderer.invoke(CHANNELS.readConflict, request),
  resolveConflict: (request) => ipcRenderer.invoke(CHANNELS.resolveConflict, request),
  syncTools: () => ipcRenderer.invoke(CHANNELS.syncTools),
  loadWorkspaceState: () => ipcRenderer.invoke(CHANNELS.loadWorkspaceState),
  saveWorkspaceState: (state) => ipcRenderer.invoke(CHANNELS.saveWorkspaceState, state),
};

contextBridge.exposeInMainWorld("openObsidian", api);
