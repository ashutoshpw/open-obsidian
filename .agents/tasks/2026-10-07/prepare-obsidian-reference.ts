import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {access, appendFile, chmod, mkdir, readFile, readdir, rm} from "node:fs/promises";
import {createReadStream} from "node:fs";
import {join, resolve} from "node:path";

type PlatformPin = {
  asset: string;
  download_url: string;
  sha256: string;
  source_platform: string;
  format: "AppImage" | "DMG" | "NSIS installer";
};

type ReleasePin = {
  version: string;
  platforms: Record<"linux" | "macos" | "windows", PlatformPin>;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required GitHub Actions environment variable ${name} is missing`);
  return value;
}

async function sha256(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer);
  return digest.digest("hex");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function assetPlatform(): "linux" | "macos" | "windows" {
  if (process.platform === "linux") return "linux";
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  throw new Error(`Unsupported reference runner platform ${process.platform}`);
}

async function installLinux(downloadPath: string, runnerTemp: string): Promise<string> {
  const extractionDirectory = join(runnerTemp, "obsidian-appimage");
  await mkdir(extractionDirectory, {recursive: true});
  await chmod(downloadPath, 0o755);
  execFileSync(downloadPath, ["--appimage-extract"], {cwd: extractionDirectory, stdio: "inherit"});
  return join(extractionDirectory, "squashfs-root", "obsidian");
}

async function installMacOS(downloadPath: string, runnerTemp: string): Promise<string> {
  const mountPoint = join(runnerTemp, "obsidian-dmg-mount");
  const applicationPath = join(runnerTemp, "Obsidian.app");
  await mkdir(mountPoint, {recursive: true});
  await rm(applicationPath, {recursive: true, force: true});
  let mounted = false;
  try {
    execFileSync("hdiutil", ["attach", "-readonly", "-nobrowse", "-quiet", "-mountpoint", mountPoint, downloadPath], {stdio: "inherit"});
    mounted = true;
    const entries = await readdir(mountPoint, {withFileTypes: true});
    const appEntry = entries.find((entry) => entry.name.endsWith(".app") && entry.isDirectory());
    if (!appEntry) throw new Error(`Pinned Obsidian DMG contains no application bundle: ${entries.map((entry) => entry.name).join(", ")}`);
    execFileSync("ditto", [join(mountPoint, appEntry.name), applicationPath], {stdio: "inherit"});
  } finally {
    if (mounted) execFileSync("hdiutil", ["detach", mountPoint, "-quiet"], {stdio: "inherit"});
  }
  return join(applicationPath, "Contents", "MacOS", "Obsidian");
}

async function installWindows(downloadPath: string, runnerTemp: string): Promise<string> {
  const installDirectory = join(runnerTemp, "obsidian-install");
  await mkdir(installDirectory, {recursive: true});
  execFileSync(downloadPath, ["/S", `/D=${installDirectory}`], {stdio: "inherit", timeout: 240_000});

  const candidates = [
    join(installDirectory, "Obsidian.exe"),
    join(installDirectory, "app", "Obsidian.exe"),
    join(requiredEnv("LOCALAPPDATA"), "Programs", "Obsidian", "Obsidian.exe"),
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error(`Silent Obsidian installer did not produce the expected executable; checked ${JSON.stringify(candidates)}`);
}

async function main(): Promise<void> {
  const platform = assetPlatform();
  const runnerTemp = resolve(requiredEnv("RUNNER_TEMP"));
  const pinPath = resolve(".agents/tasks/2026-10-07/obsidian-reference-pin.json");
  const pin = JSON.parse(await readFile(pinPath, "utf8")) as ReleasePin;
  const asset = pin.platforms[platform];
  const downloadPath = join(runnerTemp, asset.asset);
  const curl = process.platform === "win32" ? "curl.exe" : "curl";

  execFileSync(curl, ["--fail", "--location", "--retry", "3", asset.download_url, "--output", downloadPath], {stdio: "inherit"});
  const actualSha256 = await sha256(downloadPath);
  if (actualSha256.toLowerCase() !== asset.sha256.toLowerCase()) {
    throw new Error(`Pinned Obsidian asset SHA-256 mismatch for ${asset.asset}: expected ${asset.sha256}, got ${actualSha256}`);
  }

  const binary = platform === "linux"
    ? await installLinux(downloadPath, runnerTemp)
    : platform === "macos"
      ? await installMacOS(downloadPath, runnerTemp)
      : await installWindows(downloadPath, runnerTemp);
  if (!(await exists(binary))) throw new Error(`Pinned Obsidian executable does not exist after installation: ${binary}`);

  const githubEnv = requiredEnv("GITHUB_ENV");
  const environment = [
    ["OBSIDIAN_RELEASE_VERSION", pin.version],
    ["OBSIDIAN_RELEASE_ASSET", asset.asset],
    ["OBSIDIAN_RELEASE_SHA256", asset.sha256],
    ["OBSIDIAN_SOURCE_PLATFORM", asset.source_platform],
    ["OBSIDIAN_BINARY", binary],
  ];
  await appendFile(githubEnv, `${environment.map(([key, value]) => `${key}=${value}`).join("\n")}\n`, "utf8");
  console.log(`Verified ${asset.asset} (${asset.sha256}) and installed ${binary}`);
}

try {
  await main();
} catch (error) {
  console.error(`Could not prepare pinned Obsidian desktop: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
