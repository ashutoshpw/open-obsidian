const OPEN_OBSIDIAN_PROTOCOL = "openobsidian:";

export type LaunchIntent = {
  source: "cli" | "deep-link";
  vaultPath: string;
  relativePath: string | null;
};

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateVaultArgument(value: unknown): string {
  if (!nonEmpty(value)) throw new Error("Launch vault path must be non-empty");
  const path = value.trim();
  if (path.length > 4096 || path.includes("\0") || path.startsWith("-")) throw new Error("Launch vault path is invalid");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) throw new Error("Launch vault path must be a filesystem path");
  return path;
}

function validateRelativePath(value: unknown): string {
  if (!nonEmpty(value)) throw new Error("Launch file path must be non-empty");
  const path = value.trim();
  const segments = path.split("/");
  if (path.length > 500 || path.startsWith("/") || path.includes("\\") || path.includes("\0") || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Launch file path must be a safe vault-relative path");
  }
  return path;
}

function protocolHostIsOpen(url: URL): boolean {
  return url.hostname.toLowerCase() === "open" || url.pathname === "/open" || url.pathname === "open";
}

/**
 * Parse only OpenObsidian's explicitly-owned protocol. Other protocols return
 * null so registering this handler can never imply an obsidian:// takeover.
 */
export function parseDeepLinkIntent(value: string): LaunchIntent | null {
  if (!value.toLocaleLowerCase().startsWith(OPEN_OBSIDIAN_PROTOCOL)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("OpenObsidian deep link is malformed");
  }
  if (url.protocol.toLocaleLowerCase() !== OPEN_OBSIDIAN_PROTOCOL || !protocolHostIsOpen(url)) throw new Error("OpenObsidian deep link action is unsupported");
  const vaultPath = url.searchParams.get("vault");
  const file = url.searchParams.get("file");
  return {source: "deep-link", vaultPath: validateVaultArgument(vaultPath), relativePath: file === null ? null : validateRelativePath(file)};
}

type LaunchState = {vaultPath?: string; relativePath: string | null; sawOpen: boolean};

function protocolArgument(argument: string): {handled: boolean; intent: LaunchIntent | null} {
  const lowered = argument.toLocaleLowerCase();
  if (lowered.startsWith(OPEN_OBSIDIAN_PROTOCOL)) return {handled: true, intent: parseDeepLinkIntent(argument)};
  if (lowered.startsWith("obsidian:")) return {handled: true, intent: null};
  return {handled: false, intent: null};
}

function pathFlagValue(args: readonly string[], index: number, name: string): {value: unknown; nextIndex: number} | null {
  const argument = args[index]!;
  if (argument === name) return {value: args[index + 1], nextIndex: index + 1};
  const prefix = `${name}=`;
  return argument.startsWith(prefix) ? {value: argument.slice(prefix.length), nextIndex: index} : null;
}

function setVaultPath(state: LaunchState, value: unknown): void {
  if (state.vaultPath !== undefined) throw new Error("Launch vault path was provided more than once");
  state.vaultPath = validateVaultArgument(value);
}

function setRelativePath(state: LaunchState, value: unknown): void {
  if (state.sawOpen) throw new Error("Launch file path was provided more than once");
  state.relativePath = validateRelativePath(value);
  state.sawOpen = true;
}

function launchIntentFromState(state: LaunchState): LaunchIntent | null {
  if (state.relativePath !== null && state.vaultPath === undefined) throw new Error("Launch file path requires --vault");
  return state.vaultPath === undefined ? null : {source: "cli", vaultPath: state.vaultPath, relativePath: state.relativePath};
}

/**
 * Parse explicit Electron/CLI arguments. Unknown Electron switches are
 * ignored, but malformed values for our own flags fail closed.
 */
export function parseLaunchArguments(args: readonly string[]): LaunchIntent | null {
  const state: LaunchState = {relativePath: null, sawOpen: false};

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    const protocol = protocolArgument(argument);
    if (protocol.handled) {
      if (protocol.intent) return protocol.intent;
      continue;
    }
    const vault = pathFlagValue(args, index, "--vault");
    if (vault) {
      setVaultPath(state, vault.value);
      index = vault.nextIndex;
      continue;
    }
    const open = pathFlagValue(args, index, "--open");
    if (open) {
      setRelativePath(state, open.value);
      index = open.nextIndex;
    }
  }
  return launchIntentFromState(state);
}
