import {createHash, randomUUID} from "node:crypto";
import {existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, unlinkSync, writeFileSync} from "node:fs";
import {basename, dirname, join, relative, resolve} from "node:path";

export type VaultEntryKind = "file" | "symlink";

export type VaultEntry = {
  relativePath: string;
  kind: VaultEntryKind;
  bytes: number;
  sha256: string;
  target?: string;
};

export type VaultSnapshot = {
  root: string;
  capturedAt: string;
  entries: VaultEntry[];
  sha256: string;
};

export type VaultScan = {
  before: VaultSnapshot;
  after: VaultSnapshot;
  unchanged: boolean;
  changedPaths: string[];
};

export type VaultRead = {
  relativePath: string;
  bytes: Uint8Array;
  revision: string;
};

export type VaultWrite = {
  relativePath: string;
  expectedRevision: string | null;
  bytes: Uint8Array;
  operationId?: string;
};

export type RecoveryRecord = {
  id: string;
  relativePath: string;
  revision: string;
  bytes: number;
  path: string;
  capturedAt: string;
};

export class VaultSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultSafetyError";
  }
}

export class RevisionConflict extends Error {
  readonly relativePath: string;
  readonly expectedRevision: string | null;
  readonly currentRevision: string | null;
  readonly preservedIncomingPath: string;

  constructor(
    relativePath: string,
    expectedRevision: string | null,
    currentRevision: string | null,
    preservedIncomingPath: string,
  ) {
    super(`Revision conflict for ${relativePath}; incoming bytes were preserved at ${preservedIncomingPath}`);
    this.name = "RevisionConflict";
    this.relativePath = relativePath;
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
    this.preservedIncomingPath = preservedIncomingPath;
  }
}

type JournalEntry = {
  id: string;
  operation: "write";
  state: "prepared" | "committed" | "failed";
  relativePath: string;
  expectedRevision: string | null;
  nextRevision: string;
  recordedAt: string;
  error?: string;
};

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hashEntries(entries: VaultEntry[]): string {
  return hashBytes(Buffer.from(JSON.stringify(entries)));
}

function normalizeRelativePath(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0") || segments.includes("..") || segments.includes("")) {
    throw new VaultSafetyError(`Vault path must be a non-empty relative path: ${relativePath}`);
  }
  return normalized;
}

function pathInside(root: string, relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  const candidate = resolve(root, ...normalized.split("/"));
  const distance = relative(root, candidate);
  if (distance.startsWith("..") || distance.startsWith("/")) {
    throw new VaultSafetyError(`Vault path escapes the selected root: ${relativePath}`);
  }
  return candidate;
}

function entryFor(path: string, relativePath: string): VaultEntry {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink()) {
    const target = readlinkSync(path);
    return {relativePath, kind: "symlink", bytes: Buffer.byteLength(target), sha256: hashBytes(Buffer.from(target)), target};
  }
  if (!stats.isFile()) throw new VaultSafetyError(`Unsupported vault entry type: ${relativePath}`);
  const bytes = readFileSync(path);
  return {relativePath, kind: "file", bytes: bytes.byteLength, sha256: hashBytes(bytes)};
}

function collectEntries(directory: string, prefix: string): VaultEntry[] {
  return readdirSync(directory, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name)).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    const entryRelativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return collectEntries(entryPath, entryRelativePath);
    return [entryFor(entryPath, entryRelativePath)];
  });
}

export function snapshotVault(root: string): VaultSnapshot {
  const resolvedRoot = resolve(root);
  if (!existsSync(resolvedRoot) || !lstatSync(resolvedRoot).isDirectory()) {
    throw new VaultSafetyError(`Vault root is not an existing directory: ${root}`);
  }
  const entries = collectEntries(resolvedRoot, "");
  return {root: resolvedRoot, capturedAt: new Date().toISOString(), entries, sha256: hashEntries(entries)};
}

function changedSnapshotPaths(before: VaultSnapshot, after: VaultSnapshot): string[] {
  const beforeEntries = new Map(before.entries.map((entry) => [entry.relativePath, entry]));
  const afterEntries = new Map(after.entries.map((entry) => [entry.relativePath, entry]));
  const paths = new Set([...beforeEntries.keys(), ...afterEntries.keys()]);
  return [...paths].filter((path) => JSON.stringify(beforeEntries.get(path)) !== JSON.stringify(afterEntries.get(path))).sort();
}

function scanVault(root: string): VaultScan {
  const before = snapshotVault(root);
  const after = snapshotVault(root);
  return {before, after, unchanged: before.sha256 === after.sha256, changedPaths: changedSnapshotPaths(before, after)};
}

export class VaultStore {
  readonly root: string;
  readonly appDataRoot: string;

  constructor(root: string, appDataRoot: string) {
    this.root = resolve(root);
    this.appDataRoot = resolve(appDataRoot);
  }

  scan(): VaultScan {
    return scanVault(this.root);
  }

  read(relativePath: string): VaultRead {
    const normalized = normalizeRelativePath(relativePath);
    const filePath = pathInside(this.root, normalized);
    if (!existsSync(filePath)) throw new VaultSafetyError(`Vault file does not exist: ${normalized}`);
    if (lstatSync(filePath).isSymbolicLink()) throw new VaultSafetyError(`Refusing to read through a vault symlink: ${normalized}`);
    const bytes = readFileSync(filePath);
    return {relativePath: normalized, bytes: new Uint8Array(bytes), revision: hashBytes(bytes)};
  }

  write(request: VaultWrite): VaultRead {
    const normalized = normalizeRelativePath(request.relativePath);
    const targetPath = pathInside(this.root, normalized);
    const current = this.currentRevision(targetPath);
    const nextBytes = new Uint8Array(request.bytes);
    const nextRevision = hashBytes(nextBytes);
    if (current !== request.expectedRevision) {
      const preservedPath = this.preserveConflict(normalized, nextBytes, request.expectedRevision, current);
      throw new RevisionConflict(normalized, request.expectedRevision, current, preservedPath);
    }

    const operationId = request.operationId ?? randomUUID();
    const journalBase: JournalEntry = {
      id: operationId,
      operation: "write",
      state: "prepared",
      relativePath: normalized,
      expectedRevision: request.expectedRevision,
      nextRevision,
      recordedAt: new Date().toISOString(),
    };
    this.appendJournal(journalBase);
    try {
      if (current !== null) this.preservePrevious(normalized, targetPath, current);
      this.atomicReplace(targetPath, nextBytes);
      this.appendJournal({...journalBase, state: "committed", recordedAt: new Date().toISOString()});
      return {relativePath: normalized, bytes: nextBytes, revision: nextRevision};
    } catch (error) {
      this.appendJournal({...journalBase, state: "failed", recordedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error)});
      throw error;
    }
  }

  listRecovery(relativePath?: string): RecoveryRecord[] {
    const directory = join(this.appDataRoot, "recovery");
    if (!existsSync(directory)) return [];
    const normalized = relativePath ? normalizeRelativePath(relativePath) : null;
    return readdirSync(directory).filter((name) => name.endsWith(".json")).flatMap((name) => {
      const record = JSON.parse(readFileSync(join(directory, name), "utf8")) as RecoveryRecord;
      return !normalized || record.relativePath === normalized ? [record] : [];
    }).sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
  }

  private currentRevision(filePath: string): string | null {
    if (!existsSync(filePath)) return null;
    if (lstatSync(filePath).isSymbolicLink()) throw new VaultSafetyError(`Refusing to write through a vault symlink: ${filePath}`);
    return hashBytes(readFileSync(filePath));
  }

  private appendJournal(entry: JournalEntry): void {
    mkdirSync(this.appDataRoot, {recursive: true});
    writeFileSync(join(this.appDataRoot, "journal.jsonl"), `${JSON.stringify(entry)}\n`, {flag: "a"});
  }

  private preservePrevious(relativePath: string, filePath: string, revision: string): void {
    const bytes = readFileSync(filePath);
    this.writeRecoveryRecord(relativePath, revision, bytes, "recovery");
  }

  private preserveConflict(relativePath: string, bytes: Uint8Array, expectedRevision: string | null, currentRevision: string | null): string {
    const id = randomUUID();
    const directory = join(this.appDataRoot, "conflicts");
    mkdirSync(directory, {recursive: true});
    const path = join(directory, `${id}.incoming`);
    writeFileSync(path, bytes);
    writeFileSync(join(directory, `${id}.json`), JSON.stringify({id, relativePath, expectedRevision, currentRevision, capturedAt: new Date().toISOString(), path}, null, 2));
    return path;
  }

  private writeRecoveryRecord(relativePath: string, revision: string, bytes: Uint8Array, directoryName: "recovery"): void {
    const id = randomUUID();
    const directory = join(this.appDataRoot, directoryName);
    mkdirSync(directory, {recursive: true});
    const path = join(directory, `${id}.bin`);
    writeFileSync(path, bytes);
    const record: RecoveryRecord = {id, relativePath, revision, bytes: bytes.byteLength, path, capturedAt: new Date().toISOString()};
    writeFileSync(join(directory, `${id}.json`), JSON.stringify(record, null, 2));
  }

  private atomicReplace(targetPath: string, bytes: Uint8Array): void {
    mkdirSync(dirname(targetPath), {recursive: true});
    const temporaryPath = join(dirname(targetPath), `.${basename(targetPath)}.${randomUUID()}.tmp`);
    try {
      writeFileSync(temporaryPath, bytes);
      renameSync(temporaryPath, targetPath);
    } finally {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    }
  }
}
