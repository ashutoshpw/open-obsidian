import {existsSync, readFileSync, statSync} from "node:fs";
import {basename, dirname, join, relative, resolve} from "node:path";
import {filesUnder, option} from "./audit-packaged-runtime.js";
import {readDistributionAudit} from "./verify-distribution.js";
import {asRecord, asString, type JsonRecord} from "./json.js";

export type DependencyScope = "type-only" | "build-only" | "audit-only" | "install-only" | "bundled-runtime" | "undeclared";

export type DependencyRecord = {
  name: string;
  version: string;
  license: string;
  source: string;
  packageJsonPath: string;
  licenseFiles: string[];
  scopes: DependencyScope[];
  roots: string[];
};

export type AttributionCheck = {id: string; status: "passed" | "failed"; detail: string};
export type DependencyAttributionAudit = {
  checks: AttributionCheck[];
  failures: string[];
  warnings: string[];
  packages: DependencyRecord[];
  archives: string[];
};

const licenseFileNames = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "COPYING.md", "NOTICE", "NOTICE.md", "NOTICE.txt"];

function readJson(path: string): JsonRecord | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return asRecord(value);
  } catch {
    return null;
  }
}

function dependencyNames(value: unknown): string[] {
  return Object.keys(asRecord(value) ?? {});
}

function resolvePackageJson(root: string, name: string, fromPackageJson: string): string | null {
  let directory = dirname(fromPackageJson);
  while (true) {
    const candidate = join(directory, "node_modules", name, "package.json");
    if (existsSync(candidate) && statSync(candidate).isFile()) return resolve(candidate);
    if (directory === root) return null;
    const parent = dirname(directory);
    if (parent === directory || !parent.startsWith(root)) return null;
    directory = parent;
  }
}

function licenseLabel(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string").join(" OR ").trim();
  return "";
}

function sourceLabel(metadata: JsonRecord): string {
  const repository = metadata.repository;
  if (typeof repository === "string") return repository;
  const repositoryRecord = asRecord(repository);
  return asString(repositoryRecord?.url) || asString(metadata.homepage);
}

function packageRecord(root: string, packageJsonPath: string, metadata: JsonRecord): DependencyRecord {
  const packageDirectory = dirname(packageJsonPath);
  return {
    name: asString(metadata.name),
    version: asString(metadata.version),
    license: licenseLabel(metadata.license ?? metadata.licenses),
    source: sourceLabel(metadata),
    packageJsonPath: relative(root, packageJsonPath).replaceAll("\\", "/"),
    licenseFiles: licenseFileNames.filter((name) => existsSync(join(packageDirectory, name))),
    scopes: [],
    roots: [],
  };
}

function addUnique<T>(values: T[], value: T): void {
  if (!values.includes(value)) values.push(value);
}

function addCheck(result: DependencyAttributionAudit, id: string, passed: boolean, detail: string): void {
  result.checks.push({id, status: passed ? "passed" : "failed", detail});
  if (!passed) result.failures.push(detail);
}

function dependencyScope(current: {rootName: string; scope: DependencyScope}): DependencyScope {
  return current.rootName === "electron" && current.scope === "bundled-runtime" ? "install-only" : current.scope;
}

function archiveEntries(root: string, archive: string): {entries: string[]; failure?: string} {
  const asarScript = join(root, "node_modules", "@electron", "asar", "bin", "asar.js");
  if (!existsSync(asarScript)) return {entries: [], failure: "installed @electron/asar CLI is unavailable"};
  const processResult = Bun.spawnSync([process.execPath, asarScript, "list", archive], {cwd: root});
  if (processResult.exitCode !== 0) {
    return {entries: [], failure: "asar listing failed for " + archive};
  }
  return {entries: processResult.stdout.toString().split(/\r?\n/).filter(Boolean)};
}

function archivePackageName(entry: string): string | null {
  const normalized = entry.replaceAll("\\", "/");
  const marker = "/node_modules/";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex < 0) return null;
  const parts = normalized.slice(markerIndex + marker.length).split("/").filter(Boolean);
  if (parts.length === 0) return null;
  return parts[0]?.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0] ?? null;
}

type ArchiveInspection = {listed: boolean; failure?: string; excludedEntries: string[]; unknownEntries: string[]};

function inspectArchive(root: string, artifactDirectory: string, archive: string, recordsByName: Map<string, DependencyRecord>): ArchiveInspection {
  const listed = archiveEntries(root, archive);
  if (listed.failure) return {listed: false, failure: listed.failure, excludedEntries: [], unknownEntries: []};
  const archiveName = relative(artifactDirectory, archive);
  const excludedEntries: string[] = [];
  const unknownEntries: string[] = [];
  for (const entry of listed.entries) {
    const name = archivePackageName(entry);
    if (!name) continue;
    const record = recordsByName.get(name);
    if (!record) unknownEntries.push(name + " in " + archiveName);
    else if (!record.scopes.includes("bundled-runtime")) excludedEntries.push(name + " in " + archiveName);
  }
  return {listed: true, excludedEntries, unknownEntries};
}

function auditArtifacts(root: string, artifactsDirectory: string, result: DependencyAttributionAudit): void {
  const directory = resolve(artifactsDirectory);
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    addCheck(result, "artifact-directory", false, "packaged artifact directory does not exist: " + artifactsDirectory);
    return;
  }
  const archives = filesUnder(directory).filter((path) => basename(path) === "app.asar");
  result.archives = archives.map((path) => relative(directory, path).replaceAll("\\", "/")).sort();
  addCheck(result, "artifact-archives", archives.length > 0, archives.length > 0 ? "found " + archives.length + " app.asar archive(s)" : "no app.asar archive was found");
  const recordsByName = new Map(result.packages.map((record) => [record.name, record]));
  const inspections = archives.map((archive) => inspectArchive(root, directory, archive, recordsByName));
  const listingFailures = inspections.flatMap((inspection) => inspection.failure ? [inspection.failure] : []);
  const excludedEntries = inspections.flatMap((inspection) => inspection.excludedEntries);
  const unknownEntries = inspections.flatMap((inspection) => inspection.unknownEntries);
  addCheck(result, "artifact-archive-readable", listingFailures.length === 0, listingFailures.length === 0 ? "all app.asar archives were listed successfully" : listingFailures.join("; "));
  addCheck(result, "artifact-excludes-non-runtime-packages", excludedEntries.length === 0, excludedEntries.length === 0 ? "no type-only, build-only, install-only or audit-only package is present under app.asar/node_modules" : "non-runtime packages are present under app.asar/node_modules: " + excludedEntries.join(", "));
  addCheck(result, "artifact-package-attribution", unknownEntries.length === 0, unknownEntries.length === 0 ? "every package path under app.asar/node_modules is represented in the installed graph" : "unrecognized package paths under app.asar/node_modules: " + unknownEntries.join(", "));
}

type QueueItem = {name: string; from: string; rootName: string; scope: DependencyScope; required: boolean};
type DependencyCollection = {records: Map<string, DependencyRecord>; missingRequired: string[]; missingOptional: string[]};
type ResolvedQueueItem = {item: QueueItem; packageJsonPath: string; metadata: JsonRecord};

function seedQueue(packagePath: string, distribution: ReturnType<typeof readDistributionAudit>): QueueItem[] {
  return distribution.direct_packages.map((entry) => ({
    name: entry.name,
    from: packagePath,
    rootName: entry.name,
    scope: entry.distribution_scope as DependencyScope,
    required: true,
  }));
}

function recordMissing(collection: DependencyCollection, item: QueueItem, detail: string): void {
  (item.required ? collection.missingRequired : collection.missingOptional).push(detail);
}

function processQueueItem(root: string, item: QueueItem, collection: DependencyCollection, visited: Set<string>): ResolvedQueueItem | null {
  const packageJsonPath = resolvePackageJson(root, item.name, item.from);
  if (!packageJsonPath) {
    recordMissing(collection, item, item.name + " required by " + item.from);
    return null;
  }
  const visitKey = packageJsonPath + "|" + item.scope;
  if (visited.has(visitKey)) return null;
  visited.add(visitKey);
  const metadata = readJson(packageJsonPath);
  if (!metadata) {
    recordMissing(collection, item, item.name + " has malformed package metadata");
    return null;
  }
  return {item, packageJsonPath, metadata};
}

function recordPackage(root: string, resolved: ResolvedQueueItem, records: Map<string, DependencyRecord>): void {
  let record = records.get(resolved.packageJsonPath);
  if (!record) {
    record = packageRecord(root, resolved.packageJsonPath, resolved.metadata);
    records.set(resolved.packageJsonPath, record);
  }
  addUnique(record.scopes, resolved.item.scope);
  addUnique(record.roots, resolved.item.rootName);
}

function enqueueDependencyGroup(queue: QueueItem[], metadata: JsonRecord, field: "dependencies" | "optionalDependencies" | "peerDependencies", item: QueueItem, required: boolean): void {
  for (const name of dependencyNames(metadata[field])) {
    queue.push({name, from: item.from, rootName: item.rootName, scope: dependencyScope(item), required});
  }
}

function enqueueChildren(queue: QueueItem[], resolved: ResolvedQueueItem): void {
  const item = {...resolved.item, from: resolved.packageJsonPath};
  enqueueDependencyGroup(queue, resolved.metadata, "dependencies", item, true);
  enqueueDependencyGroup(queue, resolved.metadata, "optionalDependencies", item, false);
  enqueueDependencyGroup(queue, resolved.metadata, "peerDependencies", item, false);
}

function collectDependencyGraph(root: string, packagePath: string, distribution: ReturnType<typeof readDistributionAudit>): DependencyCollection {
  const collection: DependencyCollection = {records: new Map(), missingRequired: [], missingOptional: []};
  const queue = seedQueue(packagePath, distribution);
  const visited = new Set<string>();
  while (queue.length > 0) {
    const item = queue.shift()!;
    const resolved = processQueueItem(root, item, collection, visited);
    if (!resolved) continue;
    recordPackage(root, resolved, collection.records);
    enqueueChildren(queue, resolved);
  }
  return collection;
}

function packageVersions(records: DependencyRecord[], predicate: (record: DependencyRecord) => boolean): string[] {
  return records.filter(predicate).map((record) => record.name + "@" + record.version);
}

function auditGraphChecks(result: DependencyAttributionAudit, collection: DependencyCollection): void {
  const records = [...collection.records.values()].sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version) || left.packageJsonPath.localeCompare(right.packageJsonPath));
  result.packages = records;
  if (collection.missingOptional.length > 0) result.warnings.push(collection.missingOptional.length + " optional or peer dependency edge(s) are not installed for this platform; examples: " + collection.missingOptional.slice(0, 3).join(", "));
  const missingLicense = packageVersions(records, (record) => !record.license);
  const shipped = records.filter((record) => record.scopes.includes("bundled-runtime"));
  const missingShippedFiles = packageVersions(shipped, (record) => record.licenseFiles.length === 0);
  const missingShippedSources = packageVersions(shipped, (record) => !record.source);
  addCheck(result, "dependency-graph-resolution", collection.missingRequired.length === 0, collection.missingRequired.length === 0 ? "all required dependency edges resolve from the installed graph" : "required dependency edges do not resolve: " + collection.missingRequired.join(", "));
  addCheck(result, "dependency-license-metadata", missingLicense.length === 0, missingLicense.length === 0 ? records.length + " dependency records contain license metadata" : "dependency records lack license metadata: " + missingLicense.join(", "));
  addCheck(result, "shipped-package-license-files", missingShippedFiles.length === 0, missingShippedFiles.length === 0 ? shipped.length + " bundled-runtime package records have local license files" : "bundled-runtime packages lack local license files: " + missingShippedFiles.join(", "));
  addCheck(result, "shipped-package-sources", missingShippedSources.length === 0, missingShippedSources.length === 0 ? shipped.length + " bundled-runtime package records have source metadata" : "bundled-runtime packages lack source metadata: " + missingShippedSources.join(", "));
}

export function auditInstalledDependencyGraph(rootDirectory: string): DependencyAttributionAudit {
  const root = resolve(rootDirectory);
  const result: DependencyAttributionAudit = {checks: [], failures: [], warnings: [], packages: [], archives: []};
  const packagePath = join(root, "package.json");
  if (!readJson(packagePath)) {
    addCheck(result, "project-package-json", false, "package.json is missing or malformed");
    return result;
  }
  auditGraphChecks(result, collectDependencyGraph(root, packagePath, readDistributionAudit()));
  return result;
}

export function auditDependencyAttribution(rootDirectory: string, artifactsDirectory: string): DependencyAttributionAudit {
  const result = auditInstalledDependencyGraph(rootDirectory);
  auditArtifacts(resolve(rootDirectory), artifactsDirectory, result);
  return result;
}

if (import.meta.main) {
  const artifactsDirectory = option("--artifacts-dir");
  if (!artifactsDirectory) {
    console.error("usage: bun scripts/audit-dependency-attribution.ts --artifacts-dir <directory>");
    process.exit(2);
  }
  const result = auditDependencyAttribution(resolve(import.meta.dir, ".."), artifactsDirectory);
  result.warnings.forEach((warning) => console.warn("DEPENDENCY ATTRIBUTION WARNING: " + warning));
  result.checks.forEach((check) => {
    const prefix = check.status === "passed" ? "DEPENDENCY ATTRIBUTION" : "DEPENDENCY ATTRIBUTION ERROR";
    (check.status === "passed" ? console.log : console.error)(prefix + ": " + check.detail);
  });
  if (result.failures.length > 0) process.exit(1);
  console.log("DEPENDENCY ATTRIBUTION CHECK: passed; " + result.packages.length + " installed records and " + result.archives.length + " packaged archive(s) audited");
}
