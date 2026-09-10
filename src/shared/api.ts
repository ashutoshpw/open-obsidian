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
};
