import {createHash} from "node:crypto";
import {existsSync, readFileSync, readdirSync, statSync} from "node:fs";
import {basename, dirname, join, resolve} from "node:path";

type ArtifactManifest = {
  schema_version: number;
  files: Array<{path: string; bytes: number; sha256: string}>;
};

export type PackagedRuntimeCheck = {id: string; status: "passed" | "failed"; detail: string};
export type PackagedRuntimeAudit = {checks: PackagedRuntimeCheck[]; failures: string[]};

const sha256Pattern = /^[a-f0-9]{64}$/;

function filesUnder(directory: string): string[] {
  return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.isFile() ? [path] : [];
  });
}

function hash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function addCheck(result: PackagedRuntimeAudit, id: string, passed: boolean, detail: string): void {
  result.checks.push({id, status: passed ? "passed" : "failed", detail});
  if (!passed) result.failures.push(detail);
}

function readManifest(path: string): ArtifactManifest | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<ArtifactManifest>;
    if (value.schema_version !== 1 || !Array.isArray(value.files)) return null;
    return value as ArtifactManifest;
  } catch {
    return null;
  }
}

function unsafeManifestPath(pathName: string): boolean {
  return !pathName || pathName.startsWith("/") || pathName.includes("../") || pathName.includes("\\");
}

function manifestPathName(file: ArtifactManifest["files"][number]): string {
  return typeof file.path === "string" ? file.path : "";
}

function manifestPathFailures(pathName: string): string[] {
  return unsafeManifestPath(pathName) ? [`release manifest contains an unsafe path: ${pathName || "(unknown)"}`] : [];
}

function manifestArtifactFailures(artifactPath: string, file: ArtifactManifest["files"][number], pathName: string): string[] {
  if (!existsSync(artifactPath) || !statSync(artifactPath).isFile()) return [`release manifest file is missing: ${pathName}`];
  const failures: string[] = [];
  const bytes = statSync(artifactPath).size;
  if (bytes !== file.bytes) failures.push(`${pathName} byte count mismatch: manifest ${file.bytes}, artifact ${bytes}`);
  if (!sha256Pattern.test(file.sha256) || hash(artifactPath) !== file.sha256) failures.push(`${pathName} sha256 does not match release manifest`);
  return failures;
}

function auditManifestFile(root: string, file: ArtifactManifest["files"][number], seen: Set<string>): string[] {
  const pathName = manifestPathName(file);
  const pathFailures = manifestPathFailures(pathName);
  if (pathFailures.length > 0) return pathFailures;
  const failures = seen.has(pathName) ? [`release manifest contains a duplicate path: ${pathName}`] : [];
  seen.add(pathName);
  return [...failures, ...manifestArtifactFailures(join(root, pathName), file, pathName)];
}

function auditManifestEntries(root: string, manifest: ArtifactManifest): string[] {
  const seen = new Set<string>();
  return manifest.files.flatMap((file) => auditManifestFile(root, file, seen));
}

function auditManifest(root: string, result: PackagedRuntimeAudit): void {
  const path = join(root, "release-manifest.json");
  if (!existsSync(path)) {
    addCheck(result, "release-manifest", false, "release-manifest.json is missing from the packaged artifact");
    return;
  }
  const manifest = readManifest(path);
  if (!manifest) {
    addCheck(result, "release-manifest", false, "release-manifest.json is malformed or has an unsupported schema");
    return;
  }
  const failures = auditManifestEntries(root, manifest);
  addCheck(result, "release-manifest", failures.length === 0, failures.length === 0 ? `release manifest matches ${manifest.files.length} packaged files` : failures.join("; "));
}

function auditRuntimeNotices(root: string, result: PackagedRuntimeAudit): void {
  const files = filesUnder(root);
  const electronLicenses = files.filter((path) => basename(path) === "LICENSE.electron.txt");
  const chromiumLicenses = files.filter((path) => basename(path) === "LICENSES.chromium.html");
  addCheck(result, "electron-license-assets", electronLicenses.length > 0, electronLicenses.length > 0 ? `found ${electronLicenses.length} Electron license asset(s)` : "packaged artifact has no LICENSE.electron.txt");
  addCheck(result, "chromium-license-assets", chromiumLicenses.length > 0, chromiumLicenses.length > 0 ? `found ${chromiumLicenses.length} Chromium notice asset(s)` : "packaged artifact has no LICENSES.chromium.html");

  const runtimeRoots = electronLicenses.map(dirname);
  const paired = runtimeRoots.every((runtimeRoot) => {
    const chromiumPath = join(runtimeRoot, "LICENSES.chromium.html");
    const asarPath = existsSync(join(runtimeRoot, "app.asar")) ? join(runtimeRoot, "app.asar") : join(runtimeRoot, "resources", "app.asar");
    return existsSync(chromiumPath) && existsSync(asarPath) && statSync(asarPath).size > 0;
  });
  addCheck(result, "runtime-payload-pairing", runtimeRoots.length > 0 && paired, paired ? "each Electron runtime has Chromium notices and a non-empty app.asar" : "each Electron runtime must ship paired Chromium notices and a non-empty app.asar");

  const electronText = electronLicenses.map((path) => readFileSync(path, "utf8").toLowerCase()).join("\n");
  const chromiumText = chromiumLicenses.map((path) => readFileSync(path, "utf8").toLowerCase()).join("\n");
  addCheck(result, "electron-license-content", electronText.includes("electron"), "Electron license content names Electron");
  addCheck(result, "chromium-node-license-content", /chromium/.test(chromiumText) && /node\.?js|nodejs/.test(chromiumText), "Chromium notice content includes Chromium and Node.js attribution");
}

export function auditPackagedRuntime(directory: string): PackagedRuntimeAudit {
  const root = resolve(directory);
  const result: PackagedRuntimeAudit = {checks: [], failures: []};
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    result.failures.push(`packaged artifact directory does not exist: ${directory}`);
    result.checks.push({id: "artifact-directory", status: "failed", detail: result.failures[0]!});
    return result;
  }
  auditManifest(root, result);
  auditRuntimeNotices(root, result);
  return result;
}

function option(name: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

if (import.meta.main) {
  const directory = option("--artifacts-dir") ?? process.env.PACKAGED_ARTIFACT_DIR;
  if (!directory) {
    console.error("usage: bun scripts/audit-packaged-runtime.ts --artifacts-dir <directory>");
    process.exit(2);
  }
  const result = auditPackagedRuntime(directory);
  result.checks.forEach((check) => {
    const prefix = check.status === "passed" ? "PACKAGED RUNTIME" : "PACKAGED RUNTIME ERROR";
    (check.status === "passed" ? console.log : console.error)(`${prefix}: ${check.detail}`);
  });
  if (result.failures.length > 0) process.exit(1);
  console.log(`PACKAGED RUNTIME CHECK: passed; ${result.checks.length} checks`);
}
