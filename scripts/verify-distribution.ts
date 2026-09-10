import {existsSync, readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {asArray, asRecord, asString, type JsonRecord} from "./json.js";

type AuditedPackage = {
  name: string;
  version: string;
  license: string;
  source: string;
  package_license_file: string;
  distribution_scope: string;
};

type ExternalTool = {name: string; version: string; source: string; installation: string; bundled: boolean};
type DistributionAudit = {
  schema_version: number;
  package_file: string;
  project: {license: string; license_file: string; notice_file: string};
  direct_packages: AuditedPackage[];
  external_tools: ExternalTool[];
  release_gates: {id: string; status: string; reason: string}[];
};
export type DistributionAuditResult = {failures: string[]; warnings: string[]; package_count: number};

const root = resolve(import.meta.dir, "..");

function readJson(relativePath: string): JsonRecord {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8")) as JsonRecord;
}

function readDistributionAudit(): DistributionAudit {
  const raw = readJson("config/distribution-audit.json");
  const project = asRecord(raw.project) ?? {};
  const packages = asArray(raw.direct_packages).map(asRecord).filter((value): value is JsonRecord => value !== null);
  const tools = asArray(raw.external_tools).map(asRecord).filter((value): value is JsonRecord => value !== null);
  const gates = asArray(raw.release_gates).map(asRecord).filter((value): value is JsonRecord => value !== null);
  return {
    schema_version: typeof raw.schema_version === "number" ? raw.schema_version : 0,
    package_file: asString(raw.package_file),
    project: {
      license: asString(project.license),
      license_file: asString(project.license_file),
      notice_file: asString(project.notice_file),
    },
    direct_packages: packages.map((entry) => ({
      name: asString(entry.name),
      version: asString(entry.version),
      license: asString(entry.license),
      source: asString(entry.source),
      package_license_file: asString(entry.package_license_file),
      distribution_scope: asString(entry.distribution_scope),
    })),
    external_tools: tools.map((entry) => ({
      name: asString(entry.name),
      version: asString(entry.version),
      source: asString(entry.source),
      installation: asString(entry.installation),
      bundled: entry.bundled === true,
    })),
    release_gates: gates.map((entry) => ({
      id: asString(entry.id),
      status: asString(entry.status),
      reason: asString(entry.reason),
    })),
  };
}

export {readDistributionAudit};

function packagePath(name: string): string {
  return join(root, "node_modules", name, "package.json");
}

function packageDirectory(name: string): string {
  return join(root, "node_modules", name);
}

function packageMetadata(name: string): JsonRecord | null {
  const path = packagePath(name);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as JsonRecord : null;
}

function addFailure(result: DistributionAuditResult, message: string): void {
  result.failures.push(message);
}

function addWarning(result: DistributionAuditResult, message: string): void {
  result.warnings.push(message);
}

function validateProject(audit: DistributionAudit, project: JsonRecord, result: DistributionAuditResult): void {
  if (audit.schema_version !== 1) addFailure(result, "distribution audit schema_version must be 1");
  if (audit.package_file !== "package.json") addFailure(result, "distribution audit must inspect package.json");
  if (asString(project.license) !== audit.project.license) addFailure(result, "package.json license does not match distribution audit");
  if (!existsSync(join(root, audit.project.license_file))) addFailure(result, `missing project license file: ${audit.project.license_file}`);
  const noticePath = join(root, audit.project.notice_file);
  if (!existsSync(noticePath)) {
    addFailure(result, `missing third-party notice file: ${audit.project.notice_file}`);
    return;
  }
  const notices = readFileSync(noticePath, "utf8").toLowerCase();
  if (!notices.includes(audit.project.license.toLowerCase())) addFailure(result, "third-party notice file does not name the project license");
}

function validatePackageDeclaration(entry: AuditedPackage, result: DistributionAuditResult): void {
  if (!entry.name || !entry.version || !entry.license || !entry.package_license_file || !entry.distribution_scope) {
    addFailure(result, `distribution package entry is incomplete: ${entry.name || "(unknown)"}`);
  }
  if (!/^https:\/\//.test(entry.source)) addFailure(result, `${entry.name || "(unknown)"} source must use HTTPS`);
}

function validatePackageShape(entry: AuditedPackage, result: DistributionAuditResult): void {
  validatePackageDeclaration(entry, result);
  const metadata = packageMetadata(entry.name);
  if (!metadata) {
    addFailure(result, `${entry.name} is declared but is not installed in node_modules`);
    return;
  }
  validatePackageMetadata(entry, metadata, result);
}

function validatePackageMetadata(entry: AuditedPackage, metadata: JsonRecord, result: DistributionAuditResult): void {
  const installedVersion = asString(metadata.version);
  const installedLicense = asString(metadata.license);
  if (installedVersion !== entry.version) addFailure(result, `${entry.name} version mismatch: audit ${entry.version}, installed ${installedVersion}`);
  if (installedLicense !== entry.license) addFailure(result, `${entry.name} license mismatch: audit ${entry.license}, installed ${installedLicense}`);
  if (!existsSync(join(packageDirectory(entry.name), entry.package_license_file))) addFailure(result, `${entry.name} is missing ${entry.package_license_file}`);
}

function validateNoticeEntry(entry: AuditedPackage, notices: string, result: DistributionAuditResult): void {
  const lowerName = entry.name.toLowerCase();
  if (!notices.includes(lowerName) || !notices.includes(entry.version.toLowerCase())) addFailure(result, `${entry.name}@${entry.version} is missing from third-party notices`);
}

function validateDeclaredPackages(audit: DistributionAudit, project: JsonRecord, result: DistributionAuditResult): void {
  const declared = new Set([...Object.keys(asRecord(project.dependencies) ?? {}), ...Object.keys(asRecord(project.devDependencies) ?? {})]);
  const audited = new Set<string>();
  const notices = existsSync(join(root, audit.project.notice_file)) ? readFileSync(join(root, audit.project.notice_file), "utf8").toLowerCase() : "";
  for (const entry of audit.direct_packages) {
    if (audited.has(entry.name)) addFailure(result, `duplicate distribution package entry: ${entry.name}`);
    audited.add(entry.name);
    if (!declared.has(entry.name)) addFailure(result, `${entry.name} is audited but is not a direct package in package.json`);
    validatePackageShape(entry, result);
    validateNoticeEntry(entry, notices, result);
  }
  for (const name of declared) if (!audited.has(name)) addFailure(result, `${name} is a direct package but is missing from the distribution audit`);
}

function validateExternalTools(audit: DistributionAudit, result: DistributionAuditResult): void {
  const notices = existsSync(join(root, audit.project.notice_file)) ? readFileSync(join(root, audit.project.notice_file), "utf8").toLowerCase() : "";
  audit.external_tools.forEach((tool) => validateExternalTool(tool, notices, result));
}

function validateExternalTool(tool: ExternalTool, notices: string, result: DistributionAuditResult): void {
  if (!tool.name || !tool.version || !/^https:\/\//.test(tool.source)) addFailure(result, `external tool entry is incomplete: ${tool.name || "(unknown)"}`);
  if (tool.bundled) addFailure(result, `${tool.name} must remain explicitly non-bundled until its license is packaged`);
  if (tool.installation !== "bunx") addFailure(result, `${tool.name} must record bunx installation`);
  if (!notices.includes(tool.name.toLowerCase()) || !notices.includes(tool.version.toLowerCase())) addFailure(result, `${tool.name}@${tool.version} is missing from third-party notices`);
}

function validateReleaseGates(audit: DistributionAudit, result: DistributionAuditResult): void {
  const ids = new Set<string>();
  for (const gate of audit.release_gates) {
    if (!gate.id || ids.has(gate.id)) addFailure(result, `release gate is missing or duplicated: ${gate.id || "(unknown)"}`);
    ids.add(gate.id);
    if (!gate.reason) addFailure(result, `${gate.id} must describe its remaining audit scope`);
    if (gate.status !== "pending" && gate.status !== "passing") addFailure(result, `${gate.id} has an invalid status: ${gate.status}`);
    if (gate.status === "pending") addWarning(result, `${gate.id}: ${gate.reason}`);
  }
}

export function auditDistribution(): DistributionAuditResult {
  const audit = readDistributionAudit();
  const project = readJson(audit.package_file);
  const result: DistributionAuditResult = {failures: [], warnings: [], package_count: audit.direct_packages.length};
  validateProject(audit, project, result);
  validateDeclaredPackages(audit, project, result);
  validateExternalTools(audit, result);
  validateReleaseGates(audit, result);
  return result;
}

if (import.meta.main) {
  const result = auditDistribution();
  result.warnings.forEach((warning) => console.warn(`DISTRIBUTION WARNING: ${warning}`));
  result.failures.forEach((failure) => console.error(`DISTRIBUTION ERROR: ${failure}`));
  if (result.failures.length > 0) process.exit(1);
  console.log(`DISTRIBUTION CHECK: passed; ${result.package_count} direct packages and external audit tools have matching metadata and notices`);
}
