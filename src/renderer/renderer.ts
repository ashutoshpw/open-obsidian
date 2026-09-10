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
const status = document.querySelector<HTMLDivElement>("#status");
let selectedSummary: VaultSummary | null = null;
let selectedPath: string | null = null;
let selectedRevision: string | null = null;
let dirty = false;
let requestId = 0;
let changeReview: Awaited<ReturnType<OpenObsidianAPI["reviewChanges"]>> | null = null;

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

function updateChronicleControls(): void {
  setDisabled(reviewButton, !selectedSummary || selectedSummary.git.vaultType !== "chronicle");
  setDisabled(historyButton, !selectedSummary);
}

function updateEditorState(): void {
  setText(editorPath, selectedPath ?? "No note selected");
  setDisabled(editor, !selectedPath);
  setDisabled(saveButton, !selectedPath || !dirty);
  setHidden(emptyState, Boolean(selectedPath));
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
    setHidden(historyPanel, true);
    setHidden(changePanel, false);
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

function recoveryRow(record: Awaited<ReturnType<OpenObsidianAPI["historyRecords"]>>[number]): HTMLDivElement {
  const protection = record.protected ? "protected" : "retained until cleanup";
  return historyRow(`${record.kind} · ${record.relativePath}`, `${record.capturedAt} · ${record.bytes} bytes · ${protection}`);
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
    setHidden(changePanel, true);
    setHidden(historyPanel, false);
    renderHistory(history.commits, history.records);
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
  if (editor) editor.value = decodeBase64(response.base64);
  updateEditorState();
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
  setHidden(changePanel, true);
  setHidden(historyPanel, true);
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
