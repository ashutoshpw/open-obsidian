import type {OpenObsidianAPI, PopoutIntent} from "../shared/api.js";
import {decodeBase64, encodeBase64} from "../shared/base64.js";
import {effectiveThemeMode, previewThemeAssets, safeAppearanceColor, safeAppearanceFontSize} from "./theme-preview.js";
import {styleMatchesName, type ThemeStyleAsset, type VaultAppearance} from "../shared/ui/index.js";

type PopoutWindow = Window & {openObsidian?: OpenObsidianAPI};

const api = (window as unknown as PopoutWindow).openObsidian;
const title = document.querySelector<HTMLElement>("#popout-title");
const pathLabel = document.querySelector<HTMLElement>("#popout-path");
const editor = document.querySelector<HTMLTextAreaElement>("#popout-editor");
const saveButton = document.querySelector<HTMLButtonElement>("#save-popout");
const reloadButton = document.querySelector<HTMLButtonElement>("#reload-note");
const status = document.querySelector<HTMLElement>("#status");
const appearanceStatus = document.querySelector<HTMLElement>("#appearance-status");

let intent: PopoutIntent | null = null;
let revision: string | null = null;
let dirty = false;
let reading = false;
let saving = false;
let readRequest = 0;
let appearanceRequest = 0;
let appearanceData: VaultAppearance | null = null;
let appearanceStyleElements: HTMLStyleElement[] = [];

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function setStatus(message: string): void {
  if (status) status.textContent = message;
}

function setAppearanceStatus(message: string): void {
  if (appearanceStatus) appearanceStatus.textContent = message;
}

function popoutThemeScope(mode: "light" | "dark"): string {
  return `body.mod-popout[data-openobsidian-theme-mode="${mode}"]`;
}

function configuredAppearanceAssets(data: VaultAppearance): ThemeStyleAsset[] {
  const theme = data.styles.find((asset) => asset.kind === "theme" && styleMatchesName(asset.relativePath, data.settings.cssTheme));
  const snippets = data.styles.filter((asset) => asset.kind === "snippet" && data.settings.enabledCssSnippets.some((name) => styleMatchesName(asset.relativePath, name) || name === asset.relativePath));
  return theme ? [theme, ...snippets] : snippets;
}

function clearAppearance(): void {
  appearanceStyleElements.forEach((style) => style.remove());
  appearanceStyleElements = [];
  appearanceData = null;
  document.body.removeAttribute("data-openobsidian-theme-mode");
  document.body.classList.remove("theme-light", "theme-dark");
  document.body.style.removeProperty("font-size");
  document.body.style.removeProperty("--accent");
  setAppearanceStatus("Vault appearance preview is not loaded.");
}

function applyAppearanceSurface(data: VaultAppearance, mode: "light" | "dark"): void {
  document.body.dataset.openobsidianThemeMode = mode;
  document.body.classList.toggle("theme-light", mode === "light");
  document.body.classList.toggle("theme-dark", mode === "dark");
  const fontSize = safeAppearanceFontSize(data.settings.baseFontSize);
  if (fontSize) document.body.style.fontSize = fontSize;
  else document.body.style.removeProperty("font-size");
  const accent = safeAppearanceColor(data.settings.accentColor);
  if (accent) document.body.style.setProperty("--accent", accent);
  else document.body.style.removeProperty("--accent");
}

function applyAppearance(data: VaultAppearance): void {
  appearanceStyleElements.forEach((style) => style.remove());
  appearanceStyleElements = [];
  const mode = effectiveThemeMode(data.settings.mode);
  applyAppearanceSurface(data, mode);
  const preview = previewThemeAssets(configuredAppearanceAssets(data), mode, popoutThemeScope(mode));
  appearanceStyleElements = preview.styles;
  const summary = `${preview.applied.length} safe preview style${preview.applied.length === 1 ? "" : "s"} applied in ${mode} mode${preview.blocked.length ? ` · ${preview.blocked.length} withheld for review` : ""}. Popout appearance is read-only.`;
  setAppearanceStatus(preview.blocked.length ? `${summary} ${preview.blocked.join(" · ")}` : summary);
}

function appearanceRequestIsCurrent(currentIntent: PopoutIntent, currentRequest: number): boolean {
  return currentRequest === appearanceRequest && intent === currentIntent;
}

async function loadAppearance(client: OpenObsidianAPI, currentIntent: PopoutIntent, currentRequest: number): Promise<void> {
  try {
    const data = await client.loadAppearance();
    if (appearanceRequestIsCurrent(currentIntent, currentRequest)) {
      appearanceData = data;
      applyAppearance(data);
    }
  } catch (error) {
    if (appearanceRequestIsCurrent(currentIntent, currentRequest)) {
      clearAppearance();
      setAppearanceStatus(`Unable to load the vault appearance preview: ${errorText(error, "appearance access was rejected")}`);
    }
  }
}

function setDisabled(element: HTMLButtonElement | HTMLTextAreaElement | null, disabled: boolean): void {
  if (element) element.disabled = disabled;
}

function editorDisabled(): boolean {
  if (!intent) return true;
  return reading;
}

function saveDisabled(): boolean {
  if (!intent || !dirty) return true;
  return reading || saving;
}

function reloadDisabled(): boolean {
  if (!intent) return true;
  return reading || saving;
}

function updateControls(): void {
  setDisabled(editor, editorDisabled());
  setDisabled(saveButton, saveDisabled());
  setDisabled(reloadButton, reloadDisabled());
}

function applyRead(response: Awaited<ReturnType<OpenObsidianAPI["readFile"]>>): void {
  if (response.relativePath !== intent?.relativePath) return;
  revision = response.revision;
  dirty = false;
  if (editor) editor.value = decodeBase64(response.base64);
  updateControls();
  document.title = `OpenObsidian · ${response.relativePath}`;
  setStatus(`Opened ${response.relativePath} · revision ${response.revision.slice(0, 12)}…`);
}

function canReadDiskVersion(): boolean {
  if (!api || !intent) return false;
  return !reading && !saving;
}

function readRequestIsCurrent(currentRequest: number, currentIntent: PopoutIntent): boolean {
  return currentRequest === readRequest && intent === currentIntent;
}

function finishRead(currentRequest: number): void {
  if (currentRequest !== readRequest) return;
  reading = false;
  updateControls();
}

async function readPopout(client: OpenObsidianAPI, currentIntent: PopoutIntent, currentRequest: number): Promise<void> {
  try {
    const response = await client.readFile(currentIntent.relativePath);
    if (readRequestIsCurrent(currentRequest, currentIntent)) applyRead(response);
  } catch (error) {
    setStatus(errorText(error, "Unable to read the note; the vault bytes remain unchanged."));
  }
}

async function readDiskVersion(): Promise<void> {
  if (!canReadDiskVersion()) return;
  const client = api!;
  const currentIntent = intent!;
  const currentRequest = ++readRequest;
  reading = true;
  updateControls();
  setStatus(dirty ? "Reading the latest disk version; unsaved popout changes will be discarded…" : `Reading ${currentIntent.relativePath}…`);
  await readPopout(client, currentIntent, currentRequest);
  finishRead(currentRequest);
}

function canSaveNote(): boolean {
  return [api, intent, editor].every(Boolean) && dirty && !reading && !saving;
}

function setSavedState(response: Awaited<ReturnType<OpenObsidianAPI["writeFile"]>>, value: string, currentIntent: PopoutIntent): void {
  if (intent !== currentIntent || !editor) return;
  revision = response.revision;
  const unchanged = editor.value === value;
  dirty = !unchanged;
  updateControls();
  setStatus(unchanged ? `Saved ${response.relativePath} · revision ${response.revision.slice(0, 12)}…` : `Saved the previous ${response.relativePath} revision; newer popout changes remain unsaved.`);
}

async function saveNote(): Promise<void> {
  if (!canSaveNote()) return;
  const client = api!;
  const currentIntent = intent!;
  const noteEditor = editor!;
  const value = noteEditor.value;
  saving = true;
  updateControls();
  setStatus(`Saving ${currentIntent.relativePath} with a revision check…`);
  try {
    const response = await client.writeFile({relativePath: currentIntent.relativePath, expectedRevision: revision, base64: encodeBase64(value)});
    setSavedState(response, value, currentIntent);
  } catch (error) {
    setStatus(`Save failed: ${errorText(error, "the revision check was rejected")}. Unsaved changes remain; reload the disk version to discard them.`);
  } finally {
    saving = false;
    updateControls();
  }
}

function handleIntent(next: PopoutIntent): void {
  intent = next;
  appearanceRequest += 1;
  clearAppearance();
  revision = null;
  dirty = false;
  if (title) title.textContent = "Note popout";
  if (pathLabel) pathLabel.textContent = next.relativePath;
  void loadAppearance(api!, next, appearanceRequest);
  void readDiskVersion();
}

if (editor) editor.addEventListener("input", () => {
  dirty = true;
  updateControls();
  setStatus("Unsaved popout changes · save to create a revision-checked write.");
});
if (saveButton) saveButton.addEventListener("click", () => void saveNote());
if (reloadButton) reloadButton.addEventListener("click", () => void readDiskVersion());
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") {
    event.preventDefault();
    void saveNote();
  }
});

if (api) api.onPopoutIntent(handleIntent);
else setStatus("Popout API unavailable; close this window and reopen it from the main workspace.");
updateControls();
