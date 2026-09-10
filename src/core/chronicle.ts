import {existsSync} from "node:fs";
import {resolve} from "node:path";

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

type CommandResult = {exitCode: number; stdout: string};
type CommandRunner = (root: string, args: string[]) => CommandResult;

function runGit(root: string, args: string[]): CommandResult {
  const result = Bun.spawnSync(["git", "-C", root, ...args]);
  return {exitCode: result.exitCode, stdout: result.stdout.toString().trim()};
}

function output(result: CommandResult): string | null {
  return result.exitCode === 0 && result.stdout ? result.stdout : null;
}

function remotes(result: CommandResult): ChronicleRemote[] {
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

function statusFlags(result: CommandResult): Pick<VaultGitState, "dirty" | "staged" | "untracked"> {
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

export function inspectVaultGitState(root: string, runner: CommandRunner = runGit): VaultGitState {
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
