import {app, BrowserWindow, dialog, ipcMain} from "electron";
import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join, resolve} from "node:path";
import {chronicleDiff, chronicleHistory, commitChronicleSelection, inspectVaultGitState, restoreChronicleFile, reviewChronicleChanges} from "../core/chronicle.js";
import {historyRecordsFromStore} from "../core/history.js";
import {buildVaultIndex, searchVaultIndex} from "../core/vault-index.js";
import {VaultStore} from "../core/vault.js";
import {CHANNELS, validateChronicleCommitRequest, validateChronicleDiffRequest, validateChronicleRestoreRequest, validateVaultWriteRequest, type VaultFileSummary, type VaultHistoryRecord, type VaultSearchResult, type VaultSummary, type VaultWriteRequest} from "../shared/api.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = dirname(currentFile);
let activeVault: VaultStore | null = null;

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

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(currentDirectory, "preload.js"),
    },
  });
  const projectRoot = resolve(currentDirectory, "..");
  const rendererPath = app.isPackaged ? join(app.getAppPath(), "src/renderer/index.html") : join(projectRoot, "src/renderer/index.html");
  void window.loadFile(rendererPath);
}

function selectedDirectory(filePaths: string[], canceled: boolean): string | null {
  return canceled ? null : filePaths[0] ?? null;
}

async function selectVault(): Promise<VaultSummary | null> {
  const result = await dialog.showOpenDialog({properties: ["openDirectory", "createDirectory"]});
  const root = selectedDirectory(result.filePaths, result.canceled);
  if (!root) return null;
  if (!existsSync(root)) throw new Error("Selected vault directory is no longer available");
  activeVault = new VaultStore(root, vaultAppData(root));
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
  ipcMain.handle(CHANNELS.restoreChronicle, restoreChronicle);
  ipcMain.handle(CHANNELS.commitChronicle, commitChronicle);
}

app.whenReady().then(() => {
  registerVaultHandlers();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
