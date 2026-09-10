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

export type WorkspaceSettings = {
  editorMode: EditorMode;
  splitView: boolean;
};

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {editorMode: "source", splitView: true};

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
  return {editorMode: value.editorMode as EditorMode, splitView: value.splitView};
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
};
