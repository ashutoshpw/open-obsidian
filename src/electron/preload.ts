import {contextBridge, ipcRenderer} from "electron";
import {CHANNELS, type OpenObsidianAPI, type VaultWriteRequest} from "../shared/api.js";

const api: OpenObsidianAPI = {
  selectVault: () => ipcRenderer.invoke(CHANNELS.selectVault),
  readFile: (relativePath) => ipcRenderer.invoke(CHANNELS.readFile, relativePath),
  writeFile: (request: VaultWriteRequest) => ipcRenderer.invoke(CHANNELS.writeFile, request),
};

contextBridge.exposeInMainWorld("openObsidian", api);
