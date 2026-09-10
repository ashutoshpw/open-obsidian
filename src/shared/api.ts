export const CHANNELS = {
  selectVault: "vault:select",
  readFile: "vault:read",
  writeFile: "vault:write",
} as const;

export type VaultSummary = {
  root: string;
  fileCount: number;
  unchanged: boolean;
  sha256: string;
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

export type OpenObsidianAPI = {
  selectVault: () => Promise<VaultSummary | null>;
  readFile: (relativePath: string) => Promise<VaultReadResponse>;
  writeFile: (request: VaultWriteRequest) => Promise<VaultReadResponse>;
};
