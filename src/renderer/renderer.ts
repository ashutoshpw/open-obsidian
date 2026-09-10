import type {OpenObsidianAPI} from "../shared/api.js";

type OpenObsidianWindow = Window & {openObsidian?: OpenObsidianAPI};
type VaultSummary = Exclude<Awaited<ReturnType<OpenObsidianAPI["selectVault"]>>, null>;

const api = (window as unknown as OpenObsidianWindow).openObsidian;
const selectButton = document.querySelector<HTMLButtonElement>("#select-vault");
const searchInput = document.querySelector<HTMLInputElement>("#vault-search");
const fileList = document.querySelector<HTMLElement>("#file-list");
const vaultMode = document.querySelector<HTMLElement>("#vault-mode");
const editorPath = document.querySelector<HTMLElement>("#editor-path");
const editor = document.querySelector<HTMLTextAreaElement>("#note-editor");
const emptyState = document.querySelector<HTMLElement>("#empty-state");
const saveButton = document.querySelector<HTMLButtonElement>("#save-note");
const status = document.querySelector<HTMLDivElement>("#status");
let selectedSummary: VaultSummary | null = null;
let selectedPath: string | null = null;
let selectedRevision: string | null = null;
let dirty = false;
let requestId = 0;

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

function updateEditorState(): void {
  setText(editorPath, selectedPath ?? "No note selected");
  setDisabled(editor, !selectedPath);
  setDisabled(saveButton, !selectedPath || !dirty);
  setHidden(emptyState, Boolean(selectedPath));
}

function modeDetail(git: VaultSummary["git"]): string {
  if (git.vaultType !== "chronicle") return "";
  return git.branch ? ` · ${git.branch}` : "";
}

function renderMode(summary: VaultSummary): void {
  if (!vaultMode) return;
  vaultMode.textContent = `${gitSummaryMessage(summary.git)}${modeDetail(summary.git)}`;
  vaultMode.dataset.state = summary.git.dirty ? "dirty" : "clean";
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

async function readFileRequest(client: OpenObsidianAPI, path: string, currentRequest: number): Promise<void> {
  try {
    const response = await client.readFile(path);
    if (currentRequest !== requestId) return;
    selectedPath = response.relativePath;
    selectedRevision = response.revision;
    dirty = false;
    if (editor) editor.value = decodeBase64(response.base64);
    updateEditorState();
    setStatus(`Opened ${response.relativePath} · revision ${response.revision.slice(0, 12)}…`);
  } catch (error) {
    setStatus(errorText(error, "Unable to open the note."));
  }
}

function openFile(path: string): void {
  if (!api || !editor) return;
  const currentRequest = ++requestId;
  setStatus(`Reading ${path} without changing the vault…`);
  void readFileRequest(api, path, currentRequest);
}

async function writeNoteRequest(client: OpenObsidianAPI, path: string, revision: string | null, value: string): Promise<void> {
  try {
    const response = await client.writeFile({relativePath: path, expectedRevision: revision, base64: encodeBase64(value)});
    selectedRevision = response.revision;
    dirty = false;
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
  updateEditorState();
}

function showNoVault(): void {
  setText(vaultMode, "No vault");
  if (fileList) fileList.replaceChildren();
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
if (searchInput) searchInput.addEventListener("input", () => void searchVault(searchInput.value));
if (editor) editor.addEventListener("input", () => {
  dirty = true;
  updateEditorState();
  setStatus("Unsaved changes · save to create a recoverable revision.");
});
if (saveButton) saveButton.addEventListener("click", () => void saveNote());
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void saveNote();
  }
});
updateEditorState();
