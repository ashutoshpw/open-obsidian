import {createHash} from "node:crypto";

export type LocalModelManifest = {
  modelId: string;
  version: string;
  sha256: string;
  bytes: number;
  source: string;
  license: string;
  storagePath: string;
};

export type ModelReadiness = "missing" | "invalid" | "stale" | "offline" | "ready";
export type ModelInspection = {modelId: string; version: string | null; state: ModelReadiness; reason: string};
export type DerivedArtifact = {path: string; sourcePath: string; sourceRevision: string; modelVersion: string};
export type ConversationTurn = {role: "system" | "user" | "assistant"; content: string; createdAt: string};
export type PortableConversation = {schema_version: 1; exportedAt: string; providerMode: "managed" | "byok" | "local" | "none"; model: string | null; turns: ConversationTurn[]};

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function nonEmpty(value: string): boolean {
  return value.length > 0;
}

function validManifestHash(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function validManifestBytes(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validManifest(manifest: LocalModelManifest): boolean {
  return [nonEmpty(manifest.modelId), nonEmpty(manifest.version), validManifestHash(manifest.sha256), validManifestBytes(manifest.bytes), nonEmpty(manifest.source), nonEmpty(manifest.license), nonEmpty(manifest.storagePath)].every(Boolean);
}

export function createLocalModelManifest(input: Omit<LocalModelManifest, "sha256" | "bytes">, bytes: Uint8Array): LocalModelManifest {
  return {...input, sha256: hashBytes(bytes), bytes: bytes.byteLength};
}

function artifactMatches(manifest: LocalModelManifest, bytes: Uint8Array | null): boolean {
  if (!validManifest(manifest)) return false;
  if (!bytes || bytes.byteLength !== manifest.bytes) return false;
  return hashBytes(bytes) === manifest.sha256;
}

function inspectInstalledModel(manifest: LocalModelManifest, bytes: Uint8Array | null, expectedVersion: string | undefined, online: boolean): ModelInspection {
  if (!artifactMatches(manifest, bytes)) return {modelId: manifest.modelId, version: manifest.version, state: "invalid", reason: "The installed model bytes do not match its integrity manifest."};
  if (versionStale(manifest, expectedVersion)) return {modelId: manifest.modelId, version: manifest.version, state: "stale", reason: `The installed model is ${manifest.version}; ${expectedVersion} is required.`};
  if (!online) return {modelId: manifest.modelId, version: manifest.version, state: "offline", reason: "The local model runtime is offline; no remote fallback is permitted."};
  return {modelId: manifest.modelId, version: manifest.version, state: "ready", reason: "The local model bytes and requested version are verified."};
}

function versionStale(manifest: LocalModelManifest, expectedVersion: string | undefined): boolean {
  if (!expectedVersion) return false;
  return expectedVersion !== manifest.version;
}

export function inspectLocalModel(manifest: LocalModelManifest | null, bytes: Uint8Array | null, expectedVersion: string | undefined, online: boolean): ModelInspection {
  if (!manifest) return {modelId: "", version: null, state: "missing", reason: "No local model is installed."};
  return inspectInstalledModel(manifest, bytes, expectedVersion, online);
}

function sameModelIdentity(previous: LocalModelManifest, current: LocalModelManifest): boolean {
  return previous.modelId === current.modelId && previous.version === current.version && previous.sha256 === current.sha256;
}

export function modelChangeRequiresReindex(previous: LocalModelManifest | null, current: LocalModelManifest | null): boolean {
  if (!previous || !current) return previous !== current;
  return !sameModelIdentity(previous, current);
}

export function derivativeDeletionPlan(sourcePath: string, sourceRevision: string | null, excluded: boolean, artifacts: DerivedArtifact[]): string[] {
  return artifacts.filter((artifact) => artifact.sourcePath === sourcePath && (excluded || sourceRevision === null || artifact.sourceRevision !== sourceRevision)).map((artifact) => artifact.path).sort();
}

function validTurn(turn: ConversationTurn): boolean {
  if (!["system", "user", "assistant"].includes(turn.role)) return false;
  if (turn.content.length > 100_000) return false;
  return nonEmpty(turn.createdAt);
}

export function exportPortableConversation(input: Omit<PortableConversation, "schema_version" | "exportedAt">, exportedAt = new Date().toISOString()): string {
  if (!input.turns.every(validTurn)) throw new Error("Conversation contains an invalid or oversized turn");
  return `${JSON.stringify({schema_version: 1, exportedAt, providerMode: input.providerMode, model: input.model, turns: input.turns}, null, 2)}\n`;
}
