import {existsSync, lstatSync, readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {relative, resolve} from "node:path";
import {VaultSafetyError, type VaultEntry, type VaultStore} from "./vault.js";

export type AttachmentReference = {
  relativePath: string;
  absolutePath: string;
  exists: boolean;
  kind: "file" | "symlink" | "missing";
  bytes: number;
  sha256?: string;
};

function safePath(store: VaultStore, relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) throw new VaultSafetyError(`Attachment path escapes the vault: ${relativePath}`);
  const path = resolve(store.root, ...normalized.split("/"));
  if (relative(store.root, path).startsWith("..")) throw new VaultSafetyError(`Attachment path escapes the vault: ${relativePath}`);
  return path;
}

export function resolveAttachment(store: VaultStore, relativePath: string): AttachmentReference {
  const normalized = relativePath.replaceAll("\\", "/");
  const absolutePath = safePath(store, normalized);
  if (!existsSync(absolutePath)) return {relativePath: normalized, absolutePath, exists: false, kind: "missing", bytes: 0};
  const stats = lstatSync(absolutePath);
  if (stats.isSymbolicLink()) return {relativePath: normalized, absolutePath, exists: true, kind: "symlink", bytes: 0};
  if (!stats.isFile()) throw new VaultSafetyError(`Attachment is not a regular file: ${relativePath}`);
  const bytes = readFileSync(absolutePath);
  return {relativePath: normalized, absolutePath, exists: true, kind: "file", bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex")};
}

/**
 * Attachment bytes are copied into a renderer data URL only below this cap.
 * Larger files remain visible as inert embed placeholders so a note cannot
 * make the renderer allocate unbounded memory during preview.
 */
export const MAX_INLINE_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export type InlineAttachmentKind = "image" | "audio" | "video";

const MIME_BY_EXTENSION: Readonly<Record<string, {mimeType: string; kind: InlineAttachmentKind}>> = {
  ".png": {mimeType: "image/png", kind: "image"},
  ".jpg": {mimeType: "image/jpeg", kind: "image"},
  ".jpeg": {mimeType: "image/jpeg", kind: "image"},
  ".gif": {mimeType: "image/gif", kind: "image"},
  ".webp": {mimeType: "image/webp", kind: "image"},
  ".avif": {mimeType: "image/avif", kind: "image"},
  ".bmp": {mimeType: "image/bmp", kind: "image"},
  ".ico": {mimeType: "image/x-icon", kind: "image"},
  ".mp3": {mimeType: "audio/mpeg", kind: "audio"},
  ".wav": {mimeType: "audio/wav", kind: "audio"},
  ".ogg": {mimeType: "audio/ogg", kind: "audio"},
  ".oga": {mimeType: "audio/ogg", kind: "audio"},
  ".m4a": {mimeType: "audio/mp4", kind: "audio"},
  ".aac": {mimeType: "audio/aac", kind: "audio"},
  ".flac": {mimeType: "audio/flac", kind: "audio"},
  ".mp4": {mimeType: "video/mp4", kind: "video"},
  ".m4v": {mimeType: "video/mp4", kind: "video"},
  ".webm": {mimeType: "video/webm", kind: "video"},
  ".ogv": {mimeType: "video/ogg", kind: "video"},
  ".mov": {mimeType: "video/quicktime", kind: "video"},
};

function extension(relativePath: string): string {
  const basename = relativePath.split("/").pop() ?? relativePath;
  const dot = basename.lastIndexOf(".");
  return dot < 0 ? "" : basename.slice(dot).toLocaleLowerCase();
}

export function inlineAttachmentInfo(relativePath: string): {mimeType: string; kind: InlineAttachmentKind} | null {
  return MIME_BY_EXTENSION[extension(relativePath)] ?? null;
}

export function canInlineAttachment(relativePath: string, bytes: number): boolean {
  return Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= MAX_INLINE_ATTACHMENT_BYTES && inlineAttachmentInfo(relativePath) !== null;
}

function normalizedTarget(value: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  const normalized = decoded.replaceAll("\\", "/").replace(/^(?:\.\/)+/, "");
  const segments = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0") || segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return normalized;
}

function isExternalTarget(value: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value.trim());
}

function basename(relativePath: string): string {
  return relativePath.split("/").pop() ?? relativePath;
}

/**
 * Resolve only a vault-local file from a note-relative embed target. The
 * caller supplies the already-scanned entries, so symlinks and directories
 * can be rejected before any bytes are read.
 */
export function resolveInlineAttachmentTarget(sourcePath: string, target: string, entries: readonly VaultEntry[]): string | null {
  if (!sourcePath || !target || isExternalTarget(target)) return null;
  const normalized = normalizedTarget(target);
  if (!normalized) return null;
  const files = entries.filter((entry) => entry.kind === "file").map((entry) => entry.relativePath.replaceAll("\\", "/"));
  const source = sourcePath.replaceAll("\\", "/");
  const directory = source.includes("/") ? source.slice(0, source.lastIndexOf("/")) : "";
  const candidates = [...new Set([...(directory && !normalized.includes("/") ? [`${directory}/${normalized}`] : []), normalized])];
  for (const candidate of candidates) {
    if (files.includes(candidate)) return candidate;
  }
  if (!normalized.includes("/")) {
    const basenameMatches = files.filter((file) => basename(file) === normalized);
    if (basenameMatches.length === 1) return basenameMatches[0]!;
  }
  return null;
}
