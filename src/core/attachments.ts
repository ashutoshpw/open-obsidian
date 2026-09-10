import {existsSync, lstatSync, readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {relative, resolve} from "node:path";
import {VaultSafetyError, type VaultStore} from "./vault.js";

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
