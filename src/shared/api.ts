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

export type GraphNode = {id: string; kind: "file" | "unresolved"; label: string};
export type GraphEdge = {id: string; from: string; to: string; kind: "link" | "embed"};
export type GraphView = {nodes: GraphNode[]; edges: GraphEdge[]};

export type CanvasNodeView = {id: string; type: string; [key: string]: unknown};
export type CanvasEdgeView = {id: string; fromNode: string; toNode: string; [key: string]: unknown};
export type CanvasView = {relativePath: string; revision: string; nodes: CanvasNodeView[]; edges: CanvasEdgeView[]};
export type CanvasTextEditRequest = {relativePath: string; expectedRevision: string; nodeId: string; text: string};
export type CanvasCreateNoteRequest = {relativePath: string; expectedRevision: string; nodeId: string; notePath: string};
export type CanvasCreateNoteResponse = {canvas: CanvasView; created: VaultReadResponse};

export type BaseIssueView = {kind: "unsupported-formula" | "invalid-filter"; message: string; expression?: string};
export type BaseScalar = string | number | boolean | null;
export type BaseValue = BaseScalar | BaseValue[];
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
export type GroundedAnswer = {status: "grounded" | "missing-evidence" | "conflicting-evidence"; answer: string; inference: string | null; conflicts: string[]; citations: RetrievalCitation[]};
export type RetrievalResponse = {query: string; mode: "local-hybrid" | "keyword-fallback"; provider: "none"; scope: RetrievalScope; passages: RetrievalPassage[]; answer: GroundedAnswer; indexedFiles: string[]; excludedFiles: string[]; scopedOutFiles: string[]; progress: RetrievalProgress};

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

export type NoteContext = {
  relativePath: string;
  headings: NoteHeading[];
  backlinks: NoteBacklink[];
};

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
};
