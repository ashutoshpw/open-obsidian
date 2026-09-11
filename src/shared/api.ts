import type {BookmarkResponse, DailyNotePlan, TagIndex, TaskItem, TemplateIndex} from "./ui/index.js";

export const CHANNELS = {
  selectVault: "vault:select",
  listFiles: "vault:list-files",
  search: "vault:search",
  readFile: "vault:read",
  writeFile: "vault:write",
  reviewChanges: "chronicle:review-changes",
  diffChanges: "chronicle:diff",
  chronicleHistory: "chronicle:history",
  historyRecords: "vault:history-records",
  restoreChronicle: "chronicle:restore",
  commitChronicle: "chronicle:commit",
  noteContext: "vault:note-context",
  bookmarks: "vault:bookmarks",
  tags: "vault:tags",
  tasks: "vault:tasks",
  toggleTask: "vault:toggle-task",
  templates: "vault:templates",
  dailyNote: "vault:daily-note",
  openDailyNote: "vault:open-daily-note",
  loadSettings: "workspace:load-settings",
  saveSettings: "workspace:save-settings",
  historyPlan: "vault:history-plan",
  cleanupHistory: "vault:cleanup-history",
  readConflict: "vault:read-conflict",
  resolveConflict: "vault:resolve-conflict",
  syncTools: "workspace:sync-tools",
  loadWorkspaceState: "workspace:load-state",
  saveWorkspaceState: "workspace:save-state",
  graph: "workspace:graph",
  canvas: "workspace:canvas",
  editCanvasText: "workspace:edit-canvas-text",
  createCanvasNote: "workspace:create-canvas-note",
  base: "workspace:base",
  retrieve: "workspace:retrieve",
  retrievalProgress: "workspace:retrieval-progress",
  draftAIChange: "ai:draft-change",
  applyAIChange: "ai:apply-change",
  undoAIChange: "ai:undo-change",
  organizationSuggestions: "ai:organization-suggestions",
  loadProviderSettings: "ai:load-provider-settings",
  saveProviderSettings: "ai:save-provider-settings",
  saveProviderCredential: "ai:save-provider-credential",
  providerStatus: "ai:provider-status",
  diagnosticManifest: "workspace:diagnostic-manifest",
} as const;

export type VaultGitSummary = {
  vaultType: "standard" | "chronicle";
  branch: string | null;
  head: string | null;
  unborn: boolean;
  dirty: boolean;
  staged: boolean;
  untracked: boolean;
  remoteCount: number;
  authorConfigured: boolean;
  remoteContacted: false;
};

export type VaultFileSummary = {
  relativePath: string;
  kind: "file" | "symlink";
  bytes: number;
  sha256: string;
};

export type VaultSearchResult = {
  relativePath: string;
  score: number;
  preview: string;
};

export type VaultSummary = {
  root: string;
  fileCount: number;
  unchanged: boolean;
  sha256: string;
  git: VaultGitSummary;
};

export type VaultReadResponse = {
  relativePath: string;
  base64: string;
  revision: string;
};

export type VaultWriteRequest = {
  relativePath: string;
  expectedRevision: string | null;
  base64: string;
};

export type ChronicleCommitReview = {
  selectedPaths: string[];
  excludedPaths: Array<{path: string; reason: string}>;
  stagedPaths: string[];
  unstagedPaths: string[];
  untrackedPaths: string[];
};

export type ChronicleHistoryEntry = {
  revision: string;
  authoredAt: string;
  author: string;
  message: string;
};

export type VaultHistoryRecord = {
  id: string;
  relativePath: string;
  revision: string;
  bytes: number;
  capturedAt: string;
  kind: "recovery" | "failed" | "conflict";
  protected: boolean;
  expectedRevision?: string | null;
  currentRevision?: string | null;
};

export type HistoryPolicy = {
  maxAgeDays: number;
  maxBytes: number;
};

export const DEFAULT_HISTORY_POLICY: HistoryPolicy = {maxAgeDays: 30, maxBytes: 5 * 1024 * 1024 * 1024};

export type HistoryPlanSummary = {
  retainedCount: number;
  pruneableCount: number;
  protectedCount: number;
  retainedBytes: number;
  pruneableBytes: number;
  warning: boolean;
};

export type HistoryCleanupResult = {
  removed: string[];
  protected: string[];
  warning: boolean;
};

export type ConflictReadResponse = {
  id: string;
  relativePath: string;
  base64: string;
  revision: string;
};

export type ConflictResolutionAction = "keep-current" | "keep-incoming";

export type ConflictResolutionRequest = {
  id: string;
  relativePath: string;
  action: ConflictResolutionAction;
};

export type ConflictResolutionResponse = {
  id: string;
  relativePath: string;
  action: ConflictResolutionAction;
  read?: VaultReadResponse;
};

export type SyncToolDisposition = {
  id: string;
  name: string;
  mode: "built-in" | "manual" | "unsupported";
  verification: "contract-only";
  remoteContacted: false;
  note: string;
};

export type ChronicleDiffRequest = {
  relativePath?: string;
  staged?: boolean;
};

export type ChronicleCommitRequest = {
  selectedPaths: string[];
  message: string;
};

export type ChronicleRestoreRequest = {
  revision: string;
  relativePath: string;
};

export type EditorMode = "source" | "live-preview" | "reading";

export type GraphLayoutMode = "force" | "hierarchical" | "radial";
export type GraphPoint = {x: number; y: number};
export type GraphNode = {id: string; kind: "file" | "attachment" | "unresolved"; label: string};
export type GraphEdge = {id: string; from: string; to: string; kind: "link" | "embed"};
export type GraphGroup = {id: string; label: string; nodeIds: string[]};
export type GraphView = {nodes: GraphNode[]; edges: GraphEdge[]; groups: GraphGroup[]; layout: GraphLayoutMode; positions: Record<string, GraphPoint>};

export type CanvasNodeView = {id: string; type: string; [key: string]: unknown};
export type CanvasEdgeView = {id: string; fromNode: string; toNode: string; [key: string]: unknown};
export type CanvasView = {relativePath: string; revision: string; nodes: CanvasNodeView[]; edges: CanvasEdgeView[]};
export type CanvasTextEditRequest = {relativePath: string; expectedRevision: string; nodeId: string; text: string};
export type CanvasCreateNoteRequest = {relativePath: string; expectedRevision: string; nodeId: string; notePath: string};
export type CanvasCreateNoteResponse = {canvas: CanvasView; created: VaultReadResponse};

export type BaseIssueView = {kind: "unsupported-formula" | "invalid-filter" | "invalid-source"; message: string; expression?: string};
export type BaseScalar = string | number | boolean | null;
export type BaseValue = BaseScalar | BaseValue[] | {[key: string]: BaseValue};
export type BaseRowView = {path: string; values: Record<string, BaseValue>};
export type BaseEvaluationView = {name?: string; type: "table" | "list" | "cards"; rows: BaseRowView[]; groups: Record<string, BaseRowView[]>; issues: BaseIssueView[]};
export type BaseResponse = {relativePath: string; revision: string; views: BaseEvaluationView[]};

export type RetrievalScope = {
  paths?: string[];
  folders?: string[];
  tags?: string[];
  modifiedAfter?: string;
  modifiedBefore?: string;
  excludedPaths?: string[];
};

export type RetrievalRequest = {query: string; scope?: RetrievalScope; limit?: number};
export type RetrievalProgress = {phase: "indexing" | "complete"; processed: number; total: number; indexed: number; excluded: number; currentPath?: string};
export type RetrievalCitation = {id: string; kind: "source"; relativePath: string; revision: string; heading: string | null; lineStart: number; lineEnd: number; snippet: string};
export type RetrievalPassage = RetrievalCitation & {score: number; keywordScore: number; semanticScore: number};
export type RetrievalSafety = {sourceDataUntrusted: true; promptInjectionDetected: boolean; excludedContentDisclosed: false; vaultBoundary: "selected-vault-only"};
export type GroundedAnswer = {status: "grounded" | "missing-evidence" | "conflicting-evidence"; answer: string; inference: string | null; conflicts: string[]; warnings: string[]; citations: RetrievalCitation[]};
export type RetrievalResponse = {query: string; mode: "local-hybrid" | "keyword-fallback"; provider: "none"; scope: RetrievalScope; passages: RetrievalPassage[]; answer: GroundedAnswer; safety: RetrievalSafety; indexedFiles: string[]; excludedFiles: string[]; scopedOutFiles: string[]; progress: RetrievalProgress};

export type AIChangeHunk = {id: string; startLine: number; endLine: number; before: string; after: string; status: "pending" | "accepted" | "rejected"};
export type AIFileChange = {id: string; relativePath: string; expectedRevision: string; summary: string; beforeBase64: string; afterBase64: string; hunks: AIChangeHunk[]; status: "pending" | "accepted" | "rejected"};
export type AIChangeSafety = {previewRequired: true; sourceDataUntrusted: true; shell: false; network: false; connectors: false; provider: "none"};
export type AIChangeSet = {id: string; kind: "draft" | "organization"; instruction: string; createdAt: string; provider: "none"; scope: RetrievalScope; files: AIFileChange[]; safety: AIChangeSafety};
export type AIDraftRequest = {relativePath: string; instruction: string; expectedRevision?: string; scope?: RetrievalScope};
export type AIChangeSelection = {fileId: string; hunkIds: string[]};
export type AIApplyChangeRequest = {changeSetId: string; selections: AIChangeSelection[]};
export type AIApplyChangeResponse = {changeSetId: string; undoId: string; files: VaultReadResponse[]};
export type AIUndoChangeRequest = {undoId: string};
export type AIUndoChangeResponse = {undoId: string; files: VaultReadResponse[]};
export type OrganizationSuggestionKind = "link" | "property" | "duplicate" | "rename" | "canvas" | "base" | "formula-code";
export type OrganizationSuggestion = {id: string; kind: OrganizationSuggestionKind; relativePath: string; targetPath?: string; summary: string; detail: string; status: "awaiting-approval" | "denied-security"; safeAlternative?: string};
export type AIOrganizationResponse = {provider: "none"; scope: RetrievalScope; suggestions: OrganizationSuggestion[]; warnings: string[]; safety: AIChangeSafety};

export type ProviderMode = "managed" | "byok" | "local";
export type ProviderId = "openrouter-proxy" | "openai-compatible" | "local-openai-compatible";
export type ProviderUsageCaps = {maxRequests: number; maxInputTokens: number; maxOutputTokens: number; maxCostCents: number};
export type ProviderSettings = {mode: ProviderMode; providerId: ProviderId; model: string; endpoint: string; credentialRef: string | null; caps: ProviderUsageCaps};
export type ProviderCredentialState = "not-required" | "stored" | "missing";
export type ProviderAvailability = "ready" | "setup-required" | "offline" | "quota-exhausted" | "unavailable";
export type ProviderUsageSnapshot = ProviderUsageCaps & {requestCount: number; inputTokens: number; outputTokens: number; costCents: number};
export type ProviderStatus = {mode: ProviderMode; providerId: ProviderId; model: string; endpoint: string; destination: string; credentialState: ProviderCredentialState; availability: ProviderAvailability; fallback: "none"; reason: string; usage: ProviderUsageSnapshot};
export type ProviderCredentialRequest = {credentialRef: string; secret: string};

export type WorkspaceSettings = {
  editorMode: EditorMode;
  splitView: boolean;
  historyPolicy: HistoryPolicy;
};

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {editorMode: "source", splitView: true, historyPolicy: DEFAULT_HISTORY_POLICY};

export type WorkspaceState = {
  settings: WorkspaceSettings;
  vaultRoot: string | null;
  openTabs: string[];
  activePath: string | null;
  navigationHistory: string[];
};

export const DEFAULT_WORKSPACE_STATE: WorkspaceState = {settings: DEFAULT_WORKSPACE_SETTINGS, vaultRoot: null, openTabs: [], activePath: null, navigationHistory: []};

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  mode: "local",
  providerId: "local-openai-compatible",
  model: "unset",
  endpoint: "http://127.0.0.1:11434/v1",
  credentialRef: null,
  caps: {maxRequests: 20, maxInputTokens: 100000, maxOutputTokens: 16000, maxCostCents: 1000},
};

export type NoteHeading = {
  text: string;
  level: number;
  line: number;
};

export type NoteBacklink = {
  relativePath: string;
  line: number;
  text: string;
};

export type NoteLinkStatus = "resolved" | "unresolved" | "ambiguous" | "external";

export type NoteLink = {
  target: string;
  resolvedPath?: string;
  status: NoteLinkStatus;
  candidates: string[];
  line: number;
  text: string;
};

export type NoteContext = {
  relativePath: string;
  headings: NoteHeading[];
  outgoingLinks: NoteLink[];
  backlinks: NoteBacklink[];
};

export type ToggleTaskRequest = {relativePath: string; expectedRevision: string; line: number; checked: boolean};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBase64(value: string): boolean {
  return value.length === 0 || /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

export function validateVaultWriteRequest(value: unknown): VaultWriteRequest {
  if (!isRecord(value) || typeof value.relativePath !== "string" || value.relativePath.length === 0) throw new Error("Invalid vault write request");
  if (value.expectedRevision !== undefined && value.expectedRevision !== null && typeof value.expectedRevision !== "string") throw new Error("Invalid vault write request");
  if (typeof value.base64 !== "string" || !isBase64(value.base64)) throw new Error("Invalid vault write request");
  return {relativePath: value.relativePath, expectedRevision: value.expectedRevision ?? null, base64: value.base64};
}

export function validateChronicleDiffRequest(value: unknown): ChronicleDiffRequest {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || (value.relativePath !== undefined && typeof value.relativePath !== "string") || (value.staged !== undefined && typeof value.staged !== "boolean")) throw new Error("Invalid Chronicle diff request");
  return {relativePath: value.relativePath as string | undefined, staged: value.staged as boolean | undefined};
}

export function validateChronicleCommitRequest(value: unknown): ChronicleCommitRequest {
  if (!isRecord(value) || !Array.isArray(value.selectedPaths) || value.selectedPaths.some((path) => typeof path !== "string") || typeof value.message !== "string") throw new Error("Invalid Chronicle commit request");
  return {selectedPaths: value.selectedPaths as string[], message: value.message};
}

export function validateChronicleRestoreRequest(value: unknown): ChronicleRestoreRequest {
  if (!isRecord(value) || typeof value.revision !== "string" || typeof value.relativePath !== "string" || value.revision.length === 0 || value.relativePath.length === 0) throw new Error("Invalid Chronicle restore request");
  return {revision: value.revision, relativePath: value.relativePath};
}

export function validateWorkspaceSettings(value: unknown): WorkspaceSettings {
  if (!isRecord(value) || !["source", "live-preview", "reading"].includes(value.editorMode as string) || typeof value.splitView !== "boolean") throw new Error("Invalid workspace settings");
  return {editorMode: value.editorMode as EditorMode, splitView: value.splitView, historyPolicy: value.historyPolicy === undefined ? DEFAULT_HISTORY_POLICY : validateHistoryPolicy(value.historyPolicy)};
}

export function validateHistoryPolicy(value: unknown): HistoryPolicy {
  if (!isRecord(value) || !Number.isInteger(value.maxAgeDays) || (value.maxAgeDays as number) < 0 || !Number.isSafeInteger(value.maxBytes) || (value.maxBytes as number) < 0) throw new Error("Invalid history policy");
  return {maxAgeDays: value.maxAgeDays as number, maxBytes: value.maxBytes as number};
}

export function validateConflictReadRequest(value: unknown): {id: string; relativePath: string} {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0 || typeof value.relativePath !== "string" || value.relativePath.length === 0) throw new Error("Invalid conflict read request");
  return {id: value.id, relativePath: value.relativePath};
}

export function validateConflictResolutionRequest(value: unknown): ConflictResolutionRequest {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0 || typeof value.relativePath !== "string" || value.relativePath.length === 0 || (value.action !== "keep-current" && value.action !== "keep-incoming")) throw new Error("Invalid conflict resolution request");
  return {id: value.id, relativePath: value.relativePath, action: value.action};
}

function validateWorkspacePath(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 500 || value.startsWith("/") || value.includes("\\") || value.includes("\0") || value.split("/").some((segment) => !segment || segment === "." || segment === "..")) throw new Error(`Invalid workspace ${label}`);
  return value;
}

function validateWorkspacePaths(value: unknown, label: string, limit: number): string[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`Invalid workspace ${label}`);
  return value.map((path) => validateWorkspacePath(path, label));
}

export function validateWorkspaceState(value: unknown): WorkspaceState {
  if (!isRecord(value) || !isRecord(value.settings) || (value.vaultRoot !== null && typeof value.vaultRoot !== "string") || (value.activePath !== null && value.activePath !== undefined && typeof value.activePath !== "string")) throw new Error("Invalid workspace state");
  const openTabs = validateWorkspacePaths(value.openTabs, "tabs", 50);
  const navigationHistory = validateWorkspacePaths(value.navigationHistory, "navigation history", 100);
  const activePath = value.activePath === null || value.activePath === undefined ? null : validateWorkspacePath(value.activePath, "active path");
  if (activePath && !openTabs.includes(activePath)) throw new Error("Invalid workspace active path");
  return {settings: validateWorkspaceSettings(value.settings), vaultRoot: value.vaultRoot as string | null, openTabs, activePath, navigationHistory};
}

export function validateTaskToggleRequest(value: unknown): ToggleTaskRequest {
  if (!isRecord(value) || typeof value.line !== "number" || !Number.isSafeInteger(value.line) || value.line < 1 || value.line > 1_000_000 || typeof value.checked !== "boolean") throw new Error("Invalid task toggle request");
  return {relativePath: validateWorkspacePath(value.relativePath, "task path"), expectedRevision: validateCanvasRevision(value.expectedRevision), line: value.line, checked: value.checked};
}

function validateCanvasPath(value: unknown, label: string): string {
  return validateWorkspacePath(value, label);
}

function validateCanvasRevision(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) throw new Error("Invalid canvas revision");
  return value;
}

export function validateCanvasTextEditRequest(value: unknown): CanvasTextEditRequest {
  if (!isRecord(value) || typeof value.nodeId !== "string" || value.nodeId.length === 0 || value.nodeId.length > 200 || typeof value.text !== "string") throw new Error("Invalid canvas text edit request");
  return {relativePath: validateCanvasPath(value.relativePath, "path"), expectedRevision: validateCanvasRevision(value.expectedRevision), nodeId: value.nodeId, text: value.text};
}

export function validateCanvasCreateNoteRequest(value: unknown): CanvasCreateNoteRequest {
  if (!isRecord(value) || typeof value.nodeId !== "string" || value.nodeId.length === 0 || value.nodeId.length > 200) throw new Error("Invalid canvas note request");
  return {relativePath: validateCanvasPath(value.relativePath, "path"), expectedRevision: validateCanvasRevision(value.expectedRevision), nodeId: value.nodeId, notePath: validateCanvasPath(value.notePath, "note path")};
}

function validateRetrievalPaths(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  return validateWorkspacePaths(value, label, 50);
}

function validateRetrievalTags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50 || value.some((tag) => typeof tag !== "string" || tag.trim().length === 0 || tag.length > 100)) throw new Error("Invalid retrieval tags");
  return [...new Set(value.map((tag) => tag.trim().replace(/^#/, "").toLocaleLowerCase()))];
}

function validateRetrievalDate(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(`Invalid retrieval ${label}`);
  return value;
}

function validateRetrievalQuery(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 500) throw new Error("Invalid retrieval request");
  return value.trim();
}

function validateRetrievalLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 50) throw new Error("Invalid retrieval limit");
  return value as number;
}

function validateRetrievalScope(value: unknown): RetrievalScope {
  if (!isRecord(value)) throw new Error("Invalid retrieval scope");
  return {
    paths: validateRetrievalPaths(value.paths, "paths"),
    folders: validateRetrievalPaths(value.folders, "folders"),
    tags: validateRetrievalTags(value.tags),
    modifiedAfter: validateRetrievalDate(value.modifiedAfter, "start date"),
    modifiedBefore: validateRetrievalDate(value.modifiedBefore, "end date"),
    excludedPaths: validateRetrievalPaths(value.excludedPaths, "excluded paths"),
  };
}

export function validateRetrievalRequest(value: unknown): RetrievalRequest {
  if (!isRecord(value)) throw new Error("Invalid retrieval request");
  const query = validateRetrievalQuery(value.query);
  const limit = validateRetrievalLimit(value.limit);
  if (value.scope === undefined) return {query, limit};
  return {
    query,
    limit,
    scope: validateRetrievalScope(value.scope),
  };
}

function validateAIInstruction(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 500) throw new Error("Invalid AI instruction");
  return value.trim();
}

export function validateAIDraftRequest(value: unknown): AIDraftRequest {
  if (!isRecord(value)) throw new Error("Invalid AI draft request");
  const expectedRevision = value.expectedRevision === undefined ? undefined : validateCanvasRevision(value.expectedRevision);
  return {relativePath: validateWorkspacePath(value.relativePath, "AI path"), instruction: validateAIInstruction(value.instruction), expectedRevision, scope: value.scope === undefined ? undefined : validateRetrievalScope(value.scope)};
}

function validateAIChangeSelections(value: unknown): AIChangeSelection[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error("Invalid AI change selections");
  return value.map((selection) => {
    if (!isRecord(selection) || typeof selection.fileId !== "string" || selection.fileId.length === 0 || selection.fileId.length > 100 || !Array.isArray(selection.hunkIds) || selection.hunkIds.length > 100 || selection.hunkIds.some((id) => typeof id !== "string" || id.length === 0 || id.length > 100)) throw new Error("Invalid AI change selection");
    return {fileId: selection.fileId, hunkIds: [...new Set(selection.hunkIds as string[])]};
  });
}

export function validateAIApplyChangeRequest(value: unknown): AIApplyChangeRequest {
  if (!isRecord(value) || typeof value.changeSetId !== "string" || value.changeSetId.length === 0 || value.changeSetId.length > 100) throw new Error("Invalid AI apply request");
  return {changeSetId: value.changeSetId, selections: validateAIChangeSelections(value.selections)};
}

export function validateAIUndoChangeRequest(value: unknown): AIUndoChangeRequest {
  if (!isRecord(value) || typeof value.undoId !== "string" || value.undoId.length === 0 || value.undoId.length > 100) throw new Error("Invalid AI undo request");
  return {undoId: value.undoId};
}

export function validateAIOrganizationScope(value: unknown): RetrievalScope | undefined {
  return value === undefined ? undefined : validateRetrievalScope(value);
}

function validateProviderCap(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(`Invalid provider usage cap: ${label}`);
  return value as number;
}

function validateProviderCaps(value: unknown): ProviderUsageCaps {
  if (!isRecord(value)) throw new Error("Invalid provider usage caps");
  return {maxRequests: validateProviderCap(value.maxRequests, "requests", 1), maxInputTokens: validateProviderCap(value.maxInputTokens, "input tokens", 1), maxOutputTokens: validateProviderCap(value.maxOutputTokens, "output tokens", 1), maxCostCents: validateProviderCap(value.maxCostCents, "cost", 0)};
}

function providerUrl(value: unknown): URL {
  if (typeof value !== "string") throw new Error("Invalid provider endpoint");
  if (value.length === 0 || value.length > 2048) throw new Error("Invalid provider endpoint");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid provider endpoint");
  }
  return url;
}

function providerEndpointAllowed(url: URL, mode: ProviderMode): void {
  if (mode === "local" && !["http:", "https:"].includes(url.protocol)) throw new Error("Invalid local provider endpoint");
  if (mode === "local" && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) throw new Error("Local provider endpoint must use loopback");
  if (mode !== "local" && url.protocol !== "https:") throw new Error("Remote provider endpoint must use HTTPS");
}

function validateProviderEndpoint(value: unknown, mode: ProviderMode): string {
  const url = providerUrl(value);
  providerEndpointAllowed(url, mode);
  return url.toString().replace(/\/$/, "");
}

function validCredentialRef(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,99}$/i.test(value);
}

function validateCredentialRef(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!validCredentialRef(value)) throw new Error("Invalid provider credential reference");
  return value;
}

function validateProviderMode(value: unknown): ProviderMode {
  if (value === "managed" || value === "byok" || value === "local") return value;
  throw new Error("Invalid provider settings");
}

function validateProviderModel(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 200) throw new Error("Invalid provider model");
  return value.trim();
}

export function validateProviderSettings(value: unknown): ProviderSettings {
  if (!isRecord(value)) throw new Error("Invalid provider settings");
  const mode = validateProviderMode(value.mode);
  const providerId = value.providerId;
  const expectedProvider = {managed: "openrouter-proxy", byok: "openai-compatible", local: "local-openai-compatible"}[mode];
  if (providerId !== expectedProvider) throw new Error("Provider id does not match provider mode");
  return {mode, providerId: providerId as ProviderId, model: validateProviderModel(value.model), endpoint: validateProviderEndpoint(value.endpoint, mode), credentialRef: validateCredentialRef(value.credentialRef), caps: validateProviderCaps(value.caps)};
}

export function validateProviderCredentialRequest(value: unknown): ProviderCredentialRequest {
  if (!isRecord(value) || !validCredentialRef(value.credentialRef)) throw new Error("Invalid provider credential request");
  if (typeof value.secret !== "string" || value.secret.length === 0 || value.secret.length > 4096) throw new Error("Invalid provider credential request");
  return {credentialRef: value.credentialRef, secret: value.secret};
}

export type OpenObsidianAPI = {
  selectVault: () => Promise<VaultSummary | null>;
  listFiles: () => Promise<VaultFileSummary[]>;
  search: (query: string) => Promise<VaultSearchResult[]>;
  readFile: (relativePath: string) => Promise<VaultReadResponse>;
  writeFile: (request: VaultWriteRequest) => Promise<VaultReadResponse>;
  reviewChanges: () => Promise<ChronicleCommitReview>;
  diffChanges: (request?: ChronicleDiffRequest) => Promise<string>;
  chronicleHistory: (limit?: number) => Promise<ChronicleHistoryEntry[]>;
  historyRecords: (relativePath?: string) => Promise<VaultHistoryRecord[]>;
  restoreChronicle: (request: ChronicleRestoreRequest) => Promise<VaultReadResponse>;
  commitChronicle: (request: ChronicleCommitRequest) => Promise<{revision: string; message: string; paths: string[]}>;
  noteContext: (relativePath: string) => Promise<NoteContext>;
  bookmarks: () => Promise<BookmarkResponse>;
  tags: () => Promise<TagIndex>;
  tasks: () => Promise<TaskItem[]>;
  toggleTask: (request: ToggleTaskRequest) => Promise<VaultReadResponse>;
  templates: () => Promise<TemplateIndex>;
  dailyNote: () => Promise<DailyNotePlan>;
  openDailyNote: () => Promise<VaultReadResponse>;
  loadSettings: () => Promise<WorkspaceSettings>;
  saveSettings: (settings: WorkspaceSettings) => Promise<WorkspaceSettings>;
  historyPlan: (policy?: HistoryPolicy) => Promise<HistoryPlanSummary>;
  cleanupHistory: (policy?: HistoryPolicy) => Promise<HistoryCleanupResult>;
  readConflict: (request: {id: string; relativePath: string}) => Promise<ConflictReadResponse>;
  resolveConflict: (request: ConflictResolutionRequest) => Promise<ConflictResolutionResponse>;
  syncTools: () => Promise<SyncToolDisposition[]>;
  loadWorkspaceState: () => Promise<WorkspaceState>;
  saveWorkspaceState: (state: WorkspaceState) => Promise<WorkspaceState>;
  graph: () => Promise<GraphView>;
  canvas: (relativePath: string) => Promise<CanvasView>;
  editCanvasText: (request: CanvasTextEditRequest) => Promise<CanvasView>;
  createCanvasNote: (request: CanvasCreateNoteRequest) => Promise<CanvasCreateNoteResponse>;
  base: (relativePath: string) => Promise<BaseResponse>;
  retrieve: (request: RetrievalRequest) => Promise<RetrievalResponse>;
  onRetrievalProgress: (listener: (progress: RetrievalProgress) => void) => () => void;
  draftAIChange: (request: AIDraftRequest) => Promise<AIChangeSet>;
  applyAIChange: (request: AIApplyChangeRequest) => Promise<AIApplyChangeResponse>;
  undoAIChange: (request: AIUndoChangeRequest) => Promise<AIUndoChangeResponse>;
  organizationSuggestions: (scope?: RetrievalScope) => Promise<AIOrganizationResponse>;
  loadProviderSettings: () => Promise<ProviderSettings>;
  saveProviderSettings: (settings: ProviderSettings) => Promise<ProviderSettings>;
  saveProviderCredential: (request: ProviderCredentialRequest) => Promise<ProviderStatus>;
  providerStatus: () => Promise<ProviderStatus>;
  diagnosticManifest: () => Promise<import("../core/privacy.js").DiagnosticManifest>;
};
