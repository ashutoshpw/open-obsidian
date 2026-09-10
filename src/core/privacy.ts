export type PrivacyDefaults = {
  privateVaultUpload: false;
  noteContentTelemetry: false;
  providerSecretTelemetry: false;
  diagnosticsDestination: "local-export-only";
};

export const DEFAULT_PRIVACY_DEFAULTS: PrivacyDefaults = {
  privateVaultUpload: false,
  noteContentTelemetry: false,
  providerSecretTelemetry: false,
  diagnosticsDestination: "local-export-only",
};

export type DiagnosticManifestInput = {
  applicationVersion: string;
  platform: string;
  architecture: string;
  vaultFileCount?: number;
  vaultKind?: "standard" | "chronicle" | "none";
  providerMode?: "managed" | "byok" | "local";
  providerId?: string;
  providerCredentialState?: "not-required" | "stored" | "missing";
};

export type DiagnosticManifest = {
  schema_version: 1;
  generated_at: string;
  destination: "local-export-only";
  privacy: PrivacyDefaults;
  application: {version: string; platform: string; architecture: string};
  vault: {file_count: number; kind: "standard" | "chronicle" | "none"};
  provider: {mode: "managed" | "byok" | "local"; id: string; credential_state: "not-required" | "stored" | "missing"};
  redacted_fields: ["note_content", "provider_secret", "absolute_paths"];
};

const DEFAULT_PROVIDER = {mode: "local" as const, id: "local-openai-compatible", credential_state: "not-required" as const};

function safeLabel(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return value.slice(0, 200).replace(/[\u0000-\u001f\u007f]/g, "");
}

function safeFileCount(value: number | undefined): number {
  return Number.isSafeInteger(value) && value !== undefined && value >= 0 ? value : 0;
}

export function createDiagnosticManifest(input: DiagnosticManifestInput, generatedAt = new Date().toISOString()): DiagnosticManifest {
  const providerMode = input.providerMode ?? DEFAULT_PROVIDER.mode;
  const provider = {
    mode: providerMode,
    id: safeLabel(input.providerId, DEFAULT_PROVIDER.id),
    credential_state: input.providerCredentialState ?? DEFAULT_PROVIDER.credential_state,
  };
  return {
    schema_version: 1,
    generated_at: generatedAt,
    destination: "local-export-only",
    privacy: DEFAULT_PRIVACY_DEFAULTS,
    application: {
      version: safeLabel(input.applicationVersion, "unknown"),
      platform: safeLabel(input.platform, "unknown"),
      architecture: safeLabel(input.architecture, "unknown"),
    },
    vault: {file_count: safeFileCount(input.vaultFileCount), kind: input.vaultKind ?? "none"},
    provider,
    redacted_fields: ["note_content", "provider_secret", "absolute_paths"],
  };
}

export const DIAGNOSTIC_CONTROLS = [
  {id: "show-local-manifest", label: "Show local diagnostics manifest", destructive: false},
  {id: "safe-mode", label: "Reproduce in safe mode", destructive: false},
  {id: "extension-bisect", label: "Disable extensions for diagnosis", destructive: false},
] as const;
