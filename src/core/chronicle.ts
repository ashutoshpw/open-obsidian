import {existsSync, lstatSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {relative, resolve} from "node:path";
import type {ChronicleCommitReview, ChronicleHistoryEntry} from "../shared/api.js";
import {snapshotVault, VaultStore, type VaultRead} from "./vault.js";

export type ChronicleRemote = {name: string; fetchUrl: string; pushUrl: string};
export type VaultGitState = {
  root: string;
  vaultType: "standard" | "chronicle";
  isRepository: boolean;
  repositoryRoot: string | null;
  branch: string | null;
  head: string | null;
  unborn: boolean;
  dirty: boolean;
  staged: boolean;
  untracked: boolean;
  remotes: ChronicleRemote[];
  authorConfigured: boolean;
  remoteContacted: false;
};

export type ChronicleCommandResult = {exitCode: number; stdout: string; stderr?: string};
export type ChronicleCommandRunner = (root: string, args: string[]) => ChronicleCommandResult;

export type ChronicleCommitResult = {revision: string; message: string; paths: string[]};
export type ChronicleRestoreResult = {read: VaultRead; sourceRevision: string};

function runGit(root: string, args: string[]): ChronicleCommandResult {
  const result = spawnSync("git", ["-C", root, ...args], {encoding: "utf8"});
  return {
    exitCode: result.status ?? 1,
    stdout: typeof result.stdout === "string" ? result.stdout.trimEnd() : "",
    stderr: typeof result.stderr === "string" ? result.stderr.trim() : result.error?.message,
  };
}

function runGitBytes(root: string, args: string[]): {exitCode: number; bytes: Uint8Array; stderr: string} {
  const result = spawnSync("git", ["-C", root, ...args]);
  return {
    exitCode: result.status ?? 1,
    bytes: new Uint8Array(result.stdout ?? Buffer.alloc(0)),
    stderr: result.stderr?.toString().trim() ?? result.error?.message ?? "",
  };
}

function output(result: ChronicleCommandResult): string | null {
  return result.exitCode === 0 && result.stdout ? result.stdout : null;
}

function remotes(result: ChronicleCommandResult): ChronicleRemote[] {
  const byName = new Map<string, ChronicleRemote>();
  if (result.exitCode !== 0) return [];
  for (const line of result.stdout.split("\n")) {
    const [name, url, kind] = line.trim().split(/\s+/);
    if (!name || !url || (kind !== "(fetch)" && kind !== "(push)")) continue;
    const current = byName.get(name) ?? {name, fetchUrl: "", pushUrl: ""};
    if (kind === "(fetch)") current.fetchUrl = url;
    else current.pushUrl = url;
    byName.set(name, current);
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function statusFlags(result: ChronicleCommandResult): Pick<VaultGitState, "dirty" | "staged" | "untracked"> {
  const lines = result.exitCode === 0 ? result.stdout.split("\n").filter(Boolean) : [];
  return {
    dirty: lines.length > 0,
    staged: lines.some((line) => line[0] !== " " && line[0] !== "?"),
    untracked: lines.some((line) => line.startsWith("??")),
  };
}

function standardState(root: string): VaultGitState {
  return {root, vaultType: "standard", isRepository: false, repositoryRoot: null, branch: null, head: null, unborn: false, dirty: false, staged: false, untracked: false, remotes: [], authorConfigured: false, remoteContacted: false};
}

export function inspectVaultGitState(root: string, runner: ChronicleCommandRunner = runGit): VaultGitState {
  const resolvedRoot = resolve(root);
  if (!existsSync(resolvedRoot)) throw new Error(`Vault root does not exist: ${root}`);
  const repositoryRoot = output(runner(resolvedRoot, ["rev-parse", "--show-toplevel"]));
  if (!repositoryRoot) return standardState(resolvedRoot);
  const branch = output(runner(resolvedRoot, ["branch", "--show-current"]));
  const head = output(runner(resolvedRoot, ["rev-parse", "--verify", "HEAD"]));
  const status = statusFlags(runner(resolvedRoot, ["status", "--porcelain=v1", "--untracked-files=all"]));
  const authorName = output(runner(resolvedRoot, ["config", "--get", "user.name"]));
  const authorEmail = output(runner(resolvedRoot, ["config", "--get", "user.email"]));
  return {
    root: resolvedRoot,
    vaultType: "chronicle",
    isRepository: true,
    repositoryRoot,
    branch,
    head,
    unborn: head === null,
    ...status,
    remotes: remotes(runner(resolvedRoot, ["remote", "-v"])),
    authorConfigured: authorName !== null && authorEmail !== null,
    remoteContacted: false,
  };
}

function gitError(result: ChronicleCommandResult, operation: string): Error {
  const detail = result.stderr || result.stdout || "unknown Git error";
  return new Error(`${operation} failed: ${detail}`);
}

function runRequired(root: string, args: string[], operation: string, runner: ChronicleCommandRunner = runGit): string {
  const result = runner(root, args);
  if (result.exitCode !== 0) throw gitError(result, operation);
  return result.stdout;
}

function safeRelativePath(root: string, value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0") || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Chronicle path must be a non-empty relative path: ${value}`);
  }
  const candidate = resolve(root, ...normalized.split("/"));
  const distance = relative(resolve(root), candidate);
  if (distance.startsWith("..") || distance.startsWith("/")) throw new Error(`Chronicle path escapes the vault: ${value}`);
  return normalized;
}

function safeRef(value: string): string {
  if (!value || value.startsWith("-") || /[\u0000-\u0020]/.test(value)) throw new Error("Chronicle revision or remote ref is invalid");
  return value;
}

function statusPaths(result: ChronicleCommandResult): {stagedPaths: string[]; unstagedPaths: string[]; untrackedPaths: string[]} {
  const stagedPaths: string[] = [];
  const unstagedPaths: string[] = [];
  const untrackedPaths: string[] = [];
  if (result.exitCode !== 0) return {stagedPaths, unstagedPaths, untrackedPaths};
  for (const line of result.stdout.split("\n").filter(Boolean)) {
    const code = line.slice(0, 2);
    const path = line.slice(3).split(" -> ").at(-1)?.trim();
    if (!path) continue;
    if (code === "??") untrackedPaths.push(path);
    else {
      if (code[0] !== " ") stagedPaths.push(path);
      if (code[1] !== " ") unstagedPaths.push(path);
    }
  }
  return {stagedPaths: [...new Set(stagedPaths)].sort(), unstagedPaths: [...new Set(unstagedPaths)].sort(), untrackedPaths: [...new Set(untrackedPaths)].sort()};
}

export function chronicleChangedPaths(root: string, runner: ChronicleCommandRunner = runGit): string[] {
  const status = statusPaths(runner(root, ["status", "--porcelain=v1", "--untracked-files=all"]));
  return [...new Set([...status.stagedPaths, ...status.unstagedPaths, ...status.untrackedPaths])].sort();
}

function appPrivatePath(root: string, appDataRoot: string | undefined, relativePath: string): boolean {
  if (!appDataRoot) return false;
  const resolvedAppData = resolve(appDataRoot);
  const resolvedRoot = resolve(root);
  const appDataRelative = relative(resolvedRoot, resolvedAppData).replaceAll("\\", "/");
  return appDataRelative !== "" && !appDataRelative.startsWith("..") && !appDataRelative.startsWith("/") && (relativePath === appDataRelative || relativePath.startsWith(`${appDataRelative}/`));
}

export function reviewChronicleCommit(root: string, selectedPaths: string[], appDataRoot?: string, runner: ChronicleCommandRunner = runGit): ChronicleCommitReview {
  const selected = [...new Set(selectedPaths.map((path) => safeRelativePath(root, path)))].sort();
  const excludedPaths = selected.flatMap((path) => appPrivatePath(root, appDataRoot, path) ? [{path, reason: "OpenObsidian app-private data is never staged by default."}] : []);
  const allowed = selected.filter((path) => !excludedPaths.some((entry) => entry.path === path));
  const status = statusPaths(runner(root, ["status", "--porcelain=v1", "--untracked-files=all"]));
  return {selectedPaths: allowed, excludedPaths, ...status};
}

export function reviewChronicleChanges(root: string, appDataRoot?: string, runner: ChronicleCommandRunner = runGit): ChronicleCommitReview {
  return reviewChronicleCommit(root, chronicleChangedPaths(root, runner), appDataRoot, runner);
}

export function initializeChronicle(root: string, runner: ChronicleCommandRunner = runGit): VaultGitState {
  const resolvedRoot = resolve(root);
  if (!existsSync(resolvedRoot) || !lstatSync(resolvedRoot).isDirectory()) throw new Error(`Vault root is not an existing directory: ${root}`);
  runRequired(resolvedRoot, ["init", "--quiet"], "Chronicle initialization", runner);
  return inspectVaultGitState(resolvedRoot, runner);
}

export function adoptChronicle(root: string, runner: ChronicleCommandRunner = runGit): VaultGitState {
  const state = inspectVaultGitState(root, runner);
  if (!state.isRepository) throw new Error("Selected vault is a Standard vault; Chronicle adoption requires an existing Git repository");
  return state;
}

export function addChronicleRemote(root: string, name: string, url: string, runner: ChronicleCommandRunner = runGit): VaultGitState {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || !url || /[\u0000\r\n]/.test(url)) throw new Error("Chronicle remote is invalid");
  runRequired(root, ["remote", "add", name, url], "Chronicle remote setup", runner);
  return inspectVaultGitState(root, runner);
}

export function chronicleDiff(root: string, path?: string, staged = false, runner: ChronicleCommandRunner = runGit): string {
  const args = ["diff", ...(staged ? ["--cached"] : []), "--binary"];
  if (path) args.push("--", safeRelativePath(root, path));
  return runRequired(root, args, "Chronicle diff", runner);
}

export function chronicleHistory(root: string, limit = 50, runner: ChronicleCommandRunner = runGit): ChronicleHistoryEntry[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Chronicle history limit must be between 1 and 500");
  const history = runRequired(root, ["log", `-${limit}`, "--format=%H%x09%aI%x09%an%x09%s"], "Chronicle history", runner);
  return history.split("\n").filter(Boolean).flatMap((line) => {
    const [revision, authoredAt, author, ...message] = line.split("\t");
    return revision && authoredAt && author ? [{revision, authoredAt, author, message: message.join("\t")}] : [];
  });
}

export function commitChronicleSelection(root: string, selectedPaths: string[], message: string, appDataRoot?: string, runner: ChronicleCommandRunner = runGit): ChronicleCommitResult {
  if (!message.trim() || message.includes("\0") || message.length > 200) throw new Error("Chronicle commit message must be non-empty and at most 200 characters");
  const review = reviewChronicleCommit(root, selectedPaths, appDataRoot, runner);
  if (review.selectedPaths.length === 0) throw new Error("Chronicle commit requires at least one allowed path");
  runRequired(root, ["add", "--", ...review.selectedPaths], "Chronicle staging", runner);
  runRequired(root, ["commit", "--only", "--message", message.trim(), "--", ...review.selectedPaths], "Chronicle commit", runner);
  const revision = runRequired(root, ["rev-parse", "HEAD"], "Chronicle commit verification", runner);
  return {revision, message: message.trim(), paths: review.selectedPaths};
}

function showChronicleFile(root: string, revision: string, relativePath: string): Uint8Array {
  const sourceRevision = safeRef(revision);
  const path = safeRelativePath(root, relativePath);
  const result = runGitBytes(root, ["show", `${sourceRevision}:${path}`]);
  if (result.exitCode !== 0) throw new Error(`Chronicle restore source is unavailable: ${result.stderr || sourceRevision}`);
  return result.bytes;
}

export function restoreChronicleFile(root: string, store: VaultStore, revision: string, relativePath: string): ChronicleRestoreResult {
  const path = safeRelativePath(root, relativePath);
  if (resolve(root) !== resolve(store.root)) throw new Error("Chronicle restore store must target the selected vault");
  const bytes = showChronicleFile(root, revision, path);
  const current = snapshotVault(root).entries.find((entry) => entry.relativePath === path);
  if (current?.kind === "symlink") throw new Error(`Chronicle restore refuses a symlink target: ${path}`);
  const read = store.write({relativePath: path, expectedRevision: current?.sha256 ?? null, bytes});
  return {read, sourceRevision: safeRef(revision)};
}

export function pullChronicle(root: string, remote = "origin", branch?: string, runner: ChronicleCommandRunner = runGit): string {
  const args = ["pull", "--ff-only", safeRef(remote)];
  if (branch) args.push(safeRef(branch));
  return runRequired(root, args, "Chronicle pull", runner);
}

export function pushChronicle(root: string, remote = "origin", branch?: string, runner: ChronicleCommandRunner = runGit): string {
  const args = ["push", safeRef(remote)];
  if (branch) args.push(safeRef(branch));
  return runRequired(root, args, "Chronicle push", runner);
}
