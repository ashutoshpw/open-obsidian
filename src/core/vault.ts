import {createHash, randomUUID} from "node:crypto";
import {existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, unlinkSync, writeFileSync} from "node:fs";
import {basename, dirname, join, relative, resolve} from "node:path";
import type {ConflictResolutionAction} from "../shared/api.js";
import {threeWayMergeBytes, type MergeResult} from "./merge.js";
import {applyRenamePlan as applyParsedRenamePlan, buildRenamePlan as buildParsedRenamePlan, renamePlanIdentity, type RenamePlan, type RenamePlanFile} from "./rename-plan.js";

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

export type VaultMergeResult = {merge: MergeResult; written?: VaultRead; preservedIncomingPath?: string};

export type VaultRenamePlan = RenamePlan & {planId: string; snapshotSha256: string};
export type VaultRenameResult = {
  planId: string;
  oldPath: string;
  newPath: string;
  updatedReferences: number;
  skippedReferences: number;
  warnings: string[];
  read: VaultRead;
};

export type RecoveryRecord = {
  id: string;
  relativePath: string;
  revision: string;
  bytes: number;
  path: string;
  capturedAt: string;
};

export type ConflictRecord = RecoveryRecord & {kind: "conflict"; expectedRevision: string | null; currentRevision: string | null; protected: true};
export type ConflictResolution = {id: string; relativePath: string; action: ConflictResolutionAction; read?: VaultRead};

export type VaultFaultStage = "before-temp-write" | "after-temp-write" | "before-replace" | "before-rename";

export type VaultStoreOptions = {
  /** Override the host platform for deterministic safety-fixture coverage. */
  platform?: NodeJS.Platform;
  faultHook?: (stage: VaultFaultStage, relativePath: string) => void;
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

function hasConflictFields(raw: Partial<ConflictRecord>): raw is Partial<ConflictRecord> & {id: string; relativePath: string; path: string; capturedAt: string} {
  return typeof raw.id === "string" && typeof raw.relativePath === "string" && typeof raw.path === "string" && typeof raw.capturedAt === "string";
}

function conflictBytes(raw: Partial<ConflictRecord> & {path: string}): number {
  if (typeof raw.bytes === "number") return raw.bytes;
  if (!existsSync(raw.path)) return 0;
  return readFileSync(raw.path).byteLength;
}

function conflictRecord(raw: Partial<ConflictRecord>): ConflictRecord[] {
  if (!hasConflictFields(raw)) return [];
  return [{id: raw.id, relativePath: raw.relativePath, revision: raw.revision ?? raw.expectedRevision ?? "", bytes: conflictBytes(raw), path: raw.path, capturedAt: raw.capturedAt, kind: "conflict", expectedRevision: raw.expectedRevision ?? null, currentRevision: raw.currentRevision ?? null, protected: true}];
}

type JournalEntry = {
  id: string;
  operation: "write" | "batch" | "rename";
  state: "prepared" | "committed" | "failed";
  relativePath?: string;
  paths?: string[];
  oldPath?: string;
  newPath?: string;
  planId?: string;
  expectedRevision?: string | null;
  nextRevision?: string;
  recordedAt: string;
  error?: string;
};

type RenameUpdate = {sourcePath: string; targetPath: string; before: VaultRead; bytes: Uint8Array};
type WrittenRenameUpdate = RenameUpdate & {written: VaultRead};

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hashEntries(entries: VaultEntry[]): string {
  return hashBytes(Buffer.from(JSON.stringify(entries)));
}

function normalizeRelativePath(relativePath: string, platform: NodeJS.Platform = process.platform): string {
  const normalized = relativePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0") || segments.includes("..") || segments.includes("") || segments.includes(".")) {
    throw new VaultSafetyError(`Vault path must be a non-empty relative path: ${relativePath}`);
  }
  if (platform === "win32" && segments.some((segment) => windowsReservedSegment(segment))) {
    throw new VaultSafetyError(`Vault path uses a Windows-reserved name: ${relativePath}`);
  }
  return normalized;
}

const windowsReservedNames = new Set(["CON", "PRN", "AUX", "NUL", ...Array.from({length: 9}, (_, index) => `COM${index + 1}`), ...Array.from({length: 9}, (_, index) => `LPT${index + 1}`)]);

function windowsReservedSegment(segment: string): boolean {
  if (segment.includes(":")) return true;
  const trimmed = segment.replace(/[ .]+$/, "");
  return windowsReservedNames.has((trimmed.split(".", 1)[0] ?? "").toUpperCase());
}

function assertInsideRoot(root: string, candidate: string, relativePath: string): void {
  const distance = relative(root, candidate);
  if (distance.startsWith("..") || distance.startsWith("/")) throw new VaultSafetyError(`Vault path escapes the selected root: ${relativePath}`);
}

function inspectExistingSegment(path: string, candidate: string, relativePath: string): boolean {
  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) throw new VaultSafetyError(`Refusing to traverse a vault symlink: ${relativePath}`);
    if (path !== candidate && !stats.isDirectory()) throw new VaultSafetyError(`Vault path contains a non-directory parent: ${relativePath}`);
    return true;
  } catch (error) {
    if (error instanceof VaultSafetyError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function assertSafeSegments(root: string, normalized: string, candidate: string, relativePath: string): void {
  let current = root;
  for (const segment of normalized.split("/")) {
    current = join(current, segment);
    if (!inspectExistingSegment(current, candidate, relativePath)) break;
  }
}

function pathInside(root: string, relativePath: string, platform: NodeJS.Platform = process.platform): string {
  const normalized = normalizeRelativePath(relativePath, platform);
  const candidate = resolve(root, ...normalized.split("/"));
  assertInsideRoot(root, candidate, relativePath);
  assertSafeSegments(root, normalized, candidate, relativePath);
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

export function diffVaultSnapshots(before: VaultSnapshot, after: VaultSnapshot): string[] {
  const beforeEntries = new Map(before.entries.map((entry) => [entry.relativePath, entry]));
  const afterEntries = new Map(after.entries.map((entry) => [entry.relativePath, entry]));
  const paths = new Set([...beforeEntries.keys(), ...afterEntries.keys()]);
  return [...paths].filter((path) => JSON.stringify(beforeEntries.get(path)) !== JSON.stringify(afterEntries.get(path))).sort();
}

function scanVault(root: string): VaultScan {
  const before = snapshotVault(root);
  const after = snapshotVault(root);
  return {before, after, unchanged: before.sha256 === after.sha256, changedPaths: diffVaultSnapshots(before, after)};
}

export class VaultStore {
  readonly root: string;
  readonly appDataRoot: string;
  readonly options: VaultStoreOptions;
  readonly platform: NodeJS.Platform;

  constructor(root: string, appDataRoot: string, options: VaultStoreOptions = {}) {
    this.root = resolve(root);
    this.appDataRoot = resolve(appDataRoot);
    this.options = options;
    this.platform = options.platform ?? process.platform;
  }

  scan(): VaultScan {
    return scanVault(this.root);
  }

  read(relativePath: string): VaultRead {
    const normalized = normalizeRelativePath(relativePath, this.platform);
    const filePath = pathInside(this.root, normalized, this.platform);
    if (!existsSync(filePath)) throw new VaultSafetyError(`Vault file does not exist: ${normalized}`);
    if (lstatSync(filePath).isSymbolicLink()) throw new VaultSafetyError(`Refusing to read through a vault symlink: ${normalized}`);
    const bytes = readFileSync(filePath);
    return {relativePath: normalized, bytes: new Uint8Array(bytes), revision: hashBytes(bytes)};
  }

  /**
   * Return an absolute path only after applying the same vault-boundary and
   * regular-file checks used by reads. The caller may hand this path to an
   * explicit OS integration, but symlinks and directories never cross the
   * broker boundary.
   */
  resolveRegularFilePath(relativePath: string): string {
    const normalized = normalizeRelativePath(relativePath, this.platform);
    const filePath = pathInside(this.root, normalized, this.platform);
    if (!existsSync(filePath)) throw new VaultSafetyError(`Vault file does not exist: ${normalized}`);
    const stats = lstatSync(filePath);
    if (stats.isSymbolicLink()) throw new VaultSafetyError(`Refusing to open a vault symlink externally: ${normalized}`);
    if (!stats.isFile()) throw new VaultSafetyError(`Vault entry is not a regular file: ${normalized}`);
    return filePath;
  }

  buildRenamePlan(oldPath: string, newPath: string): VaultRenamePlan {
    const normalizedOldPath = normalizeRelativePath(oldPath, this.platform);
    const normalizedNewPath = normalizeRelativePath(newPath, this.platform);
    if (normalizedOldPath === normalizedNewPath) throw new VaultSafetyError("Rename plan requires distinct source and destination paths");

    const sourcePath = pathInside(this.root, normalizedOldPath, this.platform);
    const sourceStats = this.regularRenameSource(sourcePath, normalizedOldPath);
    const destinationPath = pathInside(this.root, normalizedNewPath, this.platform);
    this.validateRenameDestination(sourcePath, sourceStats, destinationPath, normalizedNewPath);

    const snapshot = snapshotVault(this.root);
    const plan = buildParsedRenamePlan(this.readRenameFiles(snapshot), normalizedOldPath, normalizedNewPath);
    const identity = renamePlanIdentity(plan, snapshot.sha256);
    return {...plan, ...identity};
  }

  applyRenamePlan(plan: VaultRenamePlan): VaultRenameResult {
    const current = this.currentRenamePlan(plan);
    const sourceRead = this.read(current.oldPath);
    const updates = this.buildRenameUpdates(current, sourceRead);
    const sourceAbsolutePath = pathInside(this.root, current.oldPath, this.platform);
    const destinationAbsolutePath = pathInside(this.root, current.newPath, this.platform);
    const operationId = randomUUID();
    const journalBase = this.renameJournal(current, updates, operationId);
    this.appendJournal(journalBase);

    let moved = false;
    let written: WrittenRenameUpdate[] = [];
    try {
      this.renameAbsolute(sourceAbsolutePath, destinationAbsolutePath, current.oldPath);
      moved = true;
      this.writeRenameUpdates(updates, operationId, written);
      return this.commitRename(current, journalBase);
    } catch (error) {
      return this.failRename(error, current, journalBase, operationId, moved, written, sourceAbsolutePath, destinationAbsolutePath);
    }
  }

  private readRenameFiles(snapshot: VaultSnapshot): RenamePlanFile[] {
    const files: RenamePlanFile[] = [];
    for (const entry of snapshot.entries) {
      if (entry.kind !== "file" || !entry.relativePath.toLocaleLowerCase().endsWith(".md")) continue;
      const file = this.readRenameFile(entry.relativePath);
      if (file) files.push(file);
    }
    return files;
  }

  private readRenameFile(relativePath: string): RenamePlanFile | null {
    try {
      const read = this.read(relativePath);
      const text = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(read.bytes);
      return {relativePath, text};
    } catch (error) {
      if (error instanceof TypeError || error instanceof DOMException) return null;
      throw error;
    }
  }

  private currentRenamePlan(plan: VaultRenamePlan): VaultRenamePlan {
    const current = this.buildRenamePlan(plan.oldPath, plan.newPath);
    if (current.planId !== plan.planId || current.snapshotSha256 !== plan.snapshotSha256) throw new VaultSafetyError("Rename plan is stale; preview the rename again before applying it");
    return current;
  }

  private buildRenameUpdates(plan: VaultRenamePlan, sourceRead: VaultRead): RenameUpdate[] {
    const beforeReads = new Map<string, VaultRead>([[plan.oldPath, sourceRead]]);
    const affectedPaths = this.renameAffectedPaths(plan);
    for (const sourcePath of affectedPaths) {
      if (!beforeReads.has(sourcePath)) beforeReads.set(sourcePath, this.read(sourcePath));
    }

    const updates: RenameUpdate[] = [];
    for (const sourcePath of affectedPaths) {
      const update = this.buildRenameUpdate(plan, sourcePath, beforeReads.get(sourcePath));
      if (update) updates.push(update);
    }
    return updates;
  }

  private renameAffectedPaths(plan: VaultRenamePlan): Set<string> {
    const affectedPaths = new Set<string>();
    for (const reference of plan.references) {
      if (reference.action === "update") affectedPaths.add(reference.sourcePath);
    }
    return affectedPaths;
  }

  private buildRenameUpdate(plan: VaultRenamePlan, sourcePath: string, before: VaultRead | undefined): RenameUpdate | null {
    if (!before) return null;
    const targetPath = sourcePath === plan.oldPath ? plan.newPath : sourcePath;
    const sourceText = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(before.bytes);
    const updatedText = applyParsedRenamePlan(sourceText, sourcePath, plan);
    const bytes = new TextEncoder().encode(updatedText);
    if (hashBytes(bytes) === before.revision && targetPath === sourcePath) return null;
    return {sourcePath, targetPath, before, bytes};
  }

  private renameJournal(plan: VaultRenamePlan, updates: RenameUpdate[], operationId: string): JournalEntry {
    return {id: operationId, operation: "rename", state: "prepared", paths: [plan.oldPath, plan.newPath, ...updates.map((update) => update.targetPath)], oldPath: plan.oldPath, newPath: plan.newPath, planId: plan.planId, recordedAt: new Date().toISOString()};
  }

  private writeRenameUpdates(updates: RenameUpdate[], operationId: string, written: WrittenRenameUpdate[]): void {
    for (const [index, update] of updates.entries()) {
      const result = this.write({relativePath: update.targetPath, expectedRevision: update.before.revision, bytes: update.bytes, operationId: operationId + ":" + index});
      written.push({...update, written: result});
    }
  }

  private commitRename(plan: VaultRenamePlan, journalBase: JournalEntry): VaultRenameResult {
    this.appendJournal({...journalBase, state: "committed", recordedAt: new Date().toISOString()});
    const read = this.read(plan.newPath);
    return {planId: plan.planId, oldPath: plan.oldPath, newPath: plan.newPath, updatedReferences: plan.updateCount, skippedReferences: plan.skippedCount, warnings: plan.warnings, read};
  }

  private failRename(error: unknown, plan: VaultRenamePlan, journalBase: JournalEntry, operationId: string, moved: boolean, written: WrittenRenameUpdate[], sourceAbsolutePath: string, destinationAbsolutePath: string): never {
    const rollbackErrors = this.rollbackRename(written, operationId, moved, sourceAbsolutePath, destinationAbsolutePath, plan.newPath);
    const message = error instanceof Error ? error.message : String(error);
    const suffix = rollbackErrors.length > 0 ? " Rollback incomplete: " + rollbackErrors.join("; ") : "";
    this.appendJournal({...journalBase, state: "failed", recordedAt: new Date().toISOString(), error: message + suffix});
    if (rollbackErrors.length > 0) throw new VaultSafetyError("Rename failed and rollback was incomplete: " + message + "; " + rollbackErrors.join("; "));
    throw error;
  }

  private rollbackRename(written: WrittenRenameUpdate[], operationId: string, moved: boolean, sourceAbsolutePath: string, destinationAbsolutePath: string, destinationRelativePath: string): string[] {
    const errors: string[] = [];
    for (const update of [...written].reverse()) {
      const error = this.rollbackRenameUpdate(update, operationId);
      if (error) errors.push(error);
    }
    if (moved) {
      const error = this.rollbackRenameMove(destinationAbsolutePath, sourceAbsolutePath, destinationRelativePath);
      if (error) errors.push(error);
    }
    return errors;
  }

  private rollbackRenameUpdate(update: WrittenRenameUpdate, operationId: string): string | null {
    try {
      const currentRead = this.read(update.targetPath);
      if (currentRead.revision !== update.written.revision) throw new VaultSafetyError("Reference changed during rollback: " + update.targetPath);
      this.write({relativePath: update.targetPath, expectedRevision: currentRead.revision, bytes: update.before.bytes, operationId: operationId + ":rollback:" + update.targetPath});
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  private rollbackRenameMove(destinationAbsolutePath: string, sourceAbsolutePath: string, destinationRelativePath: string): string | null {
    try {
      this.renameAbsolute(destinationAbsolutePath, sourceAbsolutePath, destinationRelativePath);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  write(request: VaultWrite): VaultRead {
    const normalized = normalizeRelativePath(request.relativePath, this.platform);
    const targetPath = pathInside(this.root, normalized, this.platform);
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
      this.atomicReplace(targetPath, normalized, nextBytes);
      this.appendJournal({...journalBase, state: "committed", recordedAt: new Date().toISOString()});
      return {relativePath: normalized, bytes: nextBytes, revision: nextRevision};
    } catch (error) {
      this.preserveFailedWrite(normalized, nextRevision, nextBytes);
      this.appendJournal({...journalBase, state: "failed", recordedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error)});
      throw error;
    }
  }

  mergeWrite(relativePath: string, baseBytes: Uint8Array, incomingBytes: Uint8Array, operationId?: string): VaultMergeResult {
    const current = this.read(relativePath);
    const merge = threeWayMergeBytes(baseBytes, incomingBytes, current.bytes);
    if (merge.status === "conflict") {
      return {merge, preservedIncomingPath: this.preserveConflict(relativePath, new Uint8Array(incomingBytes), hashBytes(baseBytes), current.revision)};
    }
    if (!merge.bytes || hashBytes(merge.bytes) === current.revision) return {merge};
    return {merge, written: this.write({relativePath, expectedRevision: current.revision, bytes: merge.bytes, operationId})};
  }

  writeBatch(requests: VaultWrite[], operationId: string = randomUUID()): VaultRead[] {
    if (requests.length === 0) return [];
    const journalBase: JournalEntry = {id: operationId, operation: "batch", state: "prepared", paths: requests.map((request) => request.relativePath), recordedAt: new Date().toISOString()};
    this.appendJournal(journalBase);
    try {
      const plans = requests.map((request) => this.prepareBatchWrite(request));
      const results = plans.map((request, index) => this.write({...request, operationId: `${operationId}:${index}`}));
      this.appendJournal({...journalBase, state: "committed", recordedAt: new Date().toISOString()});
      return results;
    } catch (error) {
      this.appendJournal({...journalBase, state: "failed", recordedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error)});
      throw error;
    }
  }

  listRecovery(relativePath?: string): RecoveryRecord[] {
    return this.listRecords("recovery", relativePath);
  }

  listFailedWrites(relativePath?: string): RecoveryRecord[] {
    return this.listRecords("failed", relativePath);
  }

  listConflicts(relativePath?: string): ConflictRecord[] {
    return this.listJsonRecords<Partial<ConflictRecord>>("conflicts", relativePath).flatMap((raw) => {
      if (typeof raw.id !== "string" || typeof raw.path !== "string") return [];
      const expectedPath = join(resolve(this.appDataRoot, "conflicts"), `${raw.id}.incoming`);
      return resolve(raw.path) === expectedPath ? conflictRecord(raw) : [];
    });
  }

  readConflict(id: string, relativePath?: string): {record: ConflictRecord; bytes: Uint8Array} {
    const record = this.listConflicts(relativePath).find((candidate) => candidate.id === id);
    if (!record) throw new VaultSafetyError(`Conflict record does not exist: ${id}`);
    const path = this.historyArtifactPath(record.path, "conflicts", record.id, ".incoming");
    if (!existsSync(path)) throw new VaultSafetyError(`Conflict bytes do not exist: ${id}`);
    return {record, bytes: new Uint8Array(readFileSync(path))};
  }

  resolveConflict(id: string, action: ConflictResolutionAction, relativePath?: string): ConflictResolution {
    const conflict = this.readConflict(id, relativePath);
    if (action === "keep-incoming") {
      const read = this.write({relativePath: conflict.record.relativePath, expectedRevision: conflict.record.currentRevision, bytes: conflict.bytes});
      this.removeConflictArtifact(conflict.record);
      return {id, relativePath: conflict.record.relativePath, action, read};
    }
    this.removeConflictArtifact(conflict.record);
    return {id, relativePath: conflict.record.relativePath, action};
  }

  removeHistoryPath(path: string): void {
    const resolved = resolve(path);
    for (const directoryName of ["recovery", "failed"] as const) {
      const directory = resolve(this.appDataRoot, directoryName);
      if (relative(directory, resolved) !== basename(resolved) || !/^[0-9a-f-]{36}\.bin$/i.test(basename(resolved))) continue;
      this.removeArtifact(resolved);
      const metadata = join(directory, `${basename(resolved, ".bin")}.json`);
      this.removeArtifact(metadata);
      return;
    }
    throw new VaultSafetyError("History cleanup path is outside the managed recovery directories");
  }

  private listRecords(directoryName: "recovery" | "failed", relativePath?: string): RecoveryRecord[] {
    return this.listJsonRecords<RecoveryRecord>(directoryName, relativePath);
  }

  private listJsonRecords<T extends {relativePath?: string; capturedAt?: string}>(directoryName: "recovery" | "failed" | "conflicts", relativePath?: string): T[] {
    const directory = join(this.appDataRoot, directoryName);
    if (!existsSync(directory)) return [];
    const normalized = relativePath ? normalizeRelativePath(relativePath, this.platform) : null;
    return readdirSync(directory).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")) as T).filter((record) => !normalized || record.relativePath === normalized).sort((left, right) => (left.capturedAt ?? "").localeCompare(right.capturedAt ?? ""));
  }

  private historyArtifactPath(path: string, directoryName: "recovery" | "failed" | "conflicts", id: string, extension: ".bin" | ".incoming"): string {
    const directory = resolve(this.appDataRoot, directoryName);
    const expected = join(directory, `${id}${extension}`);
    if (resolve(path) !== expected) throw new VaultSafetyError("History artifact path is outside the managed recovery directories");
    return expected;
  }

  private removeConflictArtifact(record: ConflictRecord): void {
    const path = this.historyArtifactPath(record.path, "conflicts", record.id, ".incoming");
    this.removeArtifact(path);
    this.removeArtifact(join(dirname(path), `${record.id}.json`));
  }

  private removeArtifact(path: string): void {
    if (existsSync(path)) unlinkSync(path);
  }

  private currentRevision(filePath: string): string | null {
    if (!existsSync(filePath)) return null;
    if (lstatSync(filePath).isSymbolicLink()) throw new VaultSafetyError(`Refusing to write through a vault symlink: ${filePath}`);
    return hashBytes(readFileSync(filePath));
  }

  private regularRenameSource(filePath: string, relativePath: string): NonNullable<ReturnType<typeof lstatSync>> {
    if (!existsSync(filePath)) throw new VaultSafetyError(`Vault file does not exist: ${relativePath}`);
    const stats = lstatSync(filePath);
    if (stats.isSymbolicLink()) throw new VaultSafetyError(`Refusing to rename a vault symlink: ${relativePath}`);
    if (!stats.isFile()) throw new VaultSafetyError(`Only regular files can be renamed through the vault broker: ${relativePath}`);
    return stats;
  }

  private validateRenameDestination(sourcePath: string, sourceStats: NonNullable<ReturnType<typeof lstatSync>>, destinationPath: string, relativePath: string): void {
    this.validateExistingRenameDestination(sourcePath, sourceStats, destinationPath, relativePath);
    this.validateRenameDestinationParent(destinationPath, relativePath);
  }

  private validateExistingRenameDestination(sourcePath: string, sourceStats: NonNullable<ReturnType<typeof lstatSync>>, destinationPath: string, relativePath: string): void {
    if (!existsSync(destinationPath)) return;
    const destinationStats = lstatSync(destinationPath);
    const sameFile = destinationStats.isFile() && sourceStats.dev === destinationStats.dev && sourceStats.ino === destinationStats.ino;
    if (!(this.platform === "win32" && sameFile)) throw new VaultSafetyError(`Rename destination already exists: ${relativePath}`);
    if (resolve(sourcePath) === resolve(destinationPath)) throw new VaultSafetyError("Rename plan requires distinct source and destination paths");
  }

  private validateRenameDestinationParent(destinationPath: string, relativePath: string): void {
    const parent = dirname(destinationPath);
    if (!existsSync(parent)) throw new VaultSafetyError(`Rename destination folder does not exist: ${relativePath}`);
    const parentStats = lstatSync(parent);
    if (parentStats.isSymbolicLink() || !parentStats.isDirectory()) throw new VaultSafetyError(`Rename destination folder is not a real directory: ${relativePath}`);
  }

  private renameAbsolute(sourcePath: string, destinationPath: string, relativePath: string): void {
    this.options.faultHook?.("before-rename", relativePath);
    const sourceStats = lstatSync(sourcePath);
    const destinationExists = existsSync(destinationPath);
    const destinationStats = destinationExists ? lstatSync(destinationPath) : null;
    const caseOnly = this.platform === "win32" && destinationStats?.isFile() && sourceStats.dev === destinationStats.dev && sourceStats.ino === destinationStats.ino;
    if (!caseOnly) {
      renameSync(sourcePath, destinationPath);
      return;
    }
    const temporaryPath = join(dirname(sourcePath), `.${basename(sourcePath)}.${randomUUID()}.rename.tmp`);
    try {
      renameSync(sourcePath, temporaryPath);
      renameSync(temporaryPath, destinationPath);
    } finally {
      if (existsSync(temporaryPath)) renameSync(temporaryPath, sourcePath);
    }
  }

  private appendJournal(entry: JournalEntry): void {
    mkdirSync(this.appDataRoot, {recursive: true});
    writeFileSync(join(this.appDataRoot, "journal.jsonl"), `${JSON.stringify(entry)}\n`, {flag: "a"});
  }

  private preservePrevious(relativePath: string, filePath: string, revision: string): void {
    const bytes = readFileSync(filePath);
    this.writeRecoveryRecord(relativePath, revision, bytes, "recovery");
  }

  private prepareBatchWrite(request: VaultWrite): VaultWrite {
    const normalized = normalizeRelativePath(request.relativePath, this.platform);
    const targetPath = pathInside(this.root, normalized, this.platform);
    const current = this.currentRevision(targetPath);
    if (current !== request.expectedRevision) {
      const nextBytes = new Uint8Array(request.bytes);
      const preservedPath = this.preserveConflict(normalized, nextBytes, request.expectedRevision, current);
      throw new RevisionConflict(normalized, request.expectedRevision, current, preservedPath);
    }
    return {...request, relativePath: normalized, bytes: new Uint8Array(request.bytes)};
  }

  private preserveConflict(relativePath: string, bytes: Uint8Array, expectedRevision: string | null, currentRevision: string | null): string {
    const id = randomUUID();
    const directory = join(this.appDataRoot, "conflicts");
    mkdirSync(directory, {recursive: true});
    const path = join(directory, `${id}.incoming`);
    writeFileSync(path, bytes);
    writeFileSync(join(directory, `${id}.json`), JSON.stringify({id, relativePath, expectedRevision, currentRevision, revision: expectedRevision ?? "", bytes: bytes.byteLength, capturedAt: new Date().toISOString(), path}, null, 2));
    return path;
  }

  private preserveFailedWrite(relativePath: string, revision: string, bytes: Uint8Array): void {
    try {
      this.writeRecoveryRecord(relativePath, revision, bytes, "failed");
    } catch {
      // Preserve the original write failure when the recovery location is unavailable.
    }
  }

  private writeRecoveryRecord(relativePath: string, revision: string, bytes: Uint8Array, directoryName: "recovery" | "failed"): void {
    const id = randomUUID();
    const directory = join(this.appDataRoot, directoryName);
    mkdirSync(directory, {recursive: true});
    const path = join(directory, `${id}.bin`);
    writeFileSync(path, bytes);
    const record: RecoveryRecord = {id, relativePath, revision, bytes: bytes.byteLength, path, capturedAt: new Date().toISOString()};
    writeFileSync(join(directory, `${id}.json`), JSON.stringify(record, null, 2));
  }

  private atomicReplace(targetPath: string, relativePath: string, bytes: Uint8Array): void {
    mkdirSync(dirname(targetPath), {recursive: true});
    const temporaryPath = join(dirname(targetPath), `.${basename(targetPath)}.${randomUUID()}.tmp`);
    try {
      this.options.faultHook?.("before-temp-write", relativePath);
      writeFileSync(temporaryPath, bytes);
      this.options.faultHook?.("after-temp-write", relativePath);
      this.options.faultHook?.("before-replace", relativePath);
      renameSync(temporaryPath, targetPath);
    } finally {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    }
  }
}
