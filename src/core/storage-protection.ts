import {spawnSync} from "node:child_process";

export type StorageProtectionStatus = "enabled" | "disabled" | "unknown";
export type StorageProtectionReport = {platform: NodeJS.Platform; status: StorageProtectionStatus; method: string; detail: string};
export type ProtectionCommandRunner = (command: string, args: string[]) => {exitCode: number; stdout: string; stderr?: string};

function runProtectionCommand(command: string, args: string[]): {exitCode: number; stdout: string; stderr?: string} {
  const result = spawnSync(command, args, {encoding: "utf8"});
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : result.error?.message;
  return {exitCode: result.status ?? 1, stdout, stderr};
}

function unknown(platform: NodeJS.Platform, method: string, detail: string): StorageProtectionReport {
  return {platform, status: "unknown", method, detail};
}

export function inspectStorageProtection(platform: NodeJS.Platform = process.platform, runner: ProtectionCommandRunner = runProtectionCommand): StorageProtectionReport {
  if (platform === "darwin") return inspectMacProtection(platform, runner);
  if (platform === "win32") return inspectWindowsProtection(platform, runner);
  if (platform === "linux") return inspectLinuxProtection(platform, runner);
  return unknown(platform, "unsupported platform probe", "No supported OS encryption probe is available.");
}

function inspectMacProtection(platform: NodeJS.Platform, runner: ProtectionCommandRunner): StorageProtectionReport {
  const method = "fdesetup status";
  const result = runner("fdesetup", ["status"]);
  if (result.exitCode !== 0) return unknown(platform, method, result.stderr || "FileVault status could not be read.");
  if (/filevault is on/i.test(result.stdout)) return {platform, status: "enabled", method, detail: result.stdout};
  if (/filevault is off/i.test(result.stdout)) return {platform, status: "disabled", method, detail: result.stdout};
  return unknown(platform, method, result.stdout || "FileVault status was inconclusive.");
}

function inspectWindowsProtection(platform: NodeJS.Platform, runner: ProtectionCommandRunner): StorageProtectionReport {
  const method = "manage-bde -status";
  const result = runner("manage-bde", ["-status"]);
  if (result.exitCode !== 0) return unknown(platform, method, result.stderr || "BitLocker status could not be read.");
  const encrypted = /protection status\s*:\s*protection on/i.test(result.stdout) && /conversion status\s*:\s*fully encrypted/i.test(result.stdout);
  const disabled = /protection status\s*:\s*protection off/i.test(result.stdout) || /conversion status\s*:\s*fully decrypted/i.test(result.stdout);
  if (encrypted) return {platform, status: "enabled", method, detail: result.stdout};
  if (disabled) return {platform, status: "disabled", method, detail: result.stdout};
  return unknown(platform, method, result.stdout || "BitLocker status was inconclusive.");
}

function inspectLinuxProtection(platform: NodeJS.Platform, runner: ProtectionCommandRunner): StorageProtectionReport {
  const method = "findmnt root source";
  const result = runner("findmnt", ["--noheadings", "--output", "SOURCE", "--target", "/"]);
  if (result.exitCode !== 0) return unknown(platform, method, result.stderr || "Linux root storage source could not be read.");
  const source = result.stdout.trim();
  if (/^\/dev\/(mapper\/|dm-)/.test(source)) return {platform, status: "enabled", method, detail: source};
  if (source) return unknown(platform, method, `Root source ${source} is not enough evidence of full-disk encryption.`);
  return unknown(platform, method, "Linux root storage source was empty.");
}
