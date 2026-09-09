import {app, BrowserWindow, dialog, ipcMain} from "electron";
import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join, resolve} from "node:path";
import {VaultStore} from "../core/vault.js";
import {CHANNELS, type VaultSummary, type VaultWriteRequest} from "../shared/api.js";

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

type IncomingWriteRequest = {relativePath: string; expectedRevision?: string | null; base64: string};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isRevision(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || isString(value);
}

function isWriteRequest(value: unknown): value is IncomingWriteRequest {
  if (!isObjectRecord(value)) return false;
  if (!isString(value.relativePath)) return false;
  if (!isRevision(value.expectedRevision)) return false;
  return isString(value.base64);
}

function validateWriteRequest(value: unknown): VaultWriteRequest {
  if (!isWriteRequest(value)) throw new Error("Invalid vault write request");
  return {relativePath: value.relativePath, expectedRevision: value.expectedRevision ?? null, base64: value.base64};
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
  return {root: activeVault.root, fileCount: scan.after.entries.length, unchanged: scan.unchanged, sha256: scan.after.sha256};
}

function readFile(_event: Electron.IpcMainInvokeEvent, relativePath: unknown): object {
  if (!isString(relativePath)) throw new Error("Vault path must be a string");
  const read = requireVault().read(relativePath);
  return {relativePath: read.relativePath, base64: Buffer.from(read.bytes).toString("base64"), revision: read.revision};
}

function writeFile(_event: Electron.IpcMainInvokeEvent, value: unknown): object {
  const request = validateWriteRequest(value);
  const written = requireVault().write({
    relativePath: request.relativePath,
    expectedRevision: request.expectedRevision,
    bytes: decodeBase64(request.base64),
  });
  return {relativePath: written.relativePath, base64: Buffer.from(written.bytes).toString("base64"), revision: written.revision};
}

function registerVaultHandlers(): void {
  ipcMain.handle(CHANNELS.selectVault, selectVault);
  ipcMain.handle(CHANNELS.readFile, readFile);
  ipcMain.handle(CHANNELS.writeFile, writeFile);
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
