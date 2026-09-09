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

export type OpenObsidianAPI = {
  selectVault: () => Promise<VaultSummary | null>;
  readFile: (relativePath: string) => Promise<VaultReadResponse>;
  writeFile: (request: VaultWriteRequest) => Promise<VaultReadResponse>;
};
