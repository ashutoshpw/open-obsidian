import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync} from "node:fs";
import {join, relative, resolve} from "node:path";

export type ReleaseMode = "preview" | "production";
export type ReleaseGateInput = {mode: ReleaseMode; tag?: string; signingConfigured: boolean; stagingConfigured: boolean; now?: Date};
export type ReleaseGateResult = {status: "preview" | "production-ready" | "blocked"; label: "unsigned-preview" | "signed-preview" | "signed-production-candidate"; failures: string[]; warnings: string[]};
export type ArtifactManifest = {schema_version: 1; generated_at: string; files: Array<{path: string; bytes: number; sha256: string}>};

function dateParts(tag: string): [number, number, number] | null {
  const match = /^v(\d{4})-(\d{2})-(\d{2})$/.exec(tag);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function validateReleaseTag(tag: string | undefined, now = new Date()): string[] {
  if (!tag) return ["production releases require a vYYYY-MM-DD tag"];
  const parts = dateParts(tag);
  if (!parts) return [`release tag ${tag} must match vYYYY-MM-DD`];
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return [`release tag ${tag} is not a valid calendar date`];
  const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (date.getTime() > current.getTime()) return [`release tag ${tag} is in the future relative to the current UTC date`];
  return [];
}

export function evaluateReleaseGate(input: ReleaseGateInput): ReleaseGateResult {
  const failures = input.mode === "production" ? validateReleaseTag(input.tag, input.now) : [];
  const warnings: string[] = [];
  if (input.mode === "preview") {
    if (!input.signingConfigured) warnings.push("signing credentials are absent; artifact is explicitly labeled unsigned-preview");
    return {status: "preview", label: input.signingConfigured ? "signed-preview" : "unsigned-preview", failures, warnings};
  }
  if (!input.signingConfigured) failures.push("production release requires signing credentials; unsigned production artifacts are not publishable");
  if (!input.stagingConfigured) failures.push("production release requires a configured staging handoff");
  return {status: failures.length > 0 ? "blocked" : "production-ready", label: "signed-production-candidate", failures, warnings};
}

function artifactFiles(directory: string, root = directory): string[] {
  return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return artifactFiles(path, root);
    if (!entry.isFile() || entry.name === "release-manifest.json") return [];
    return [relative(root, path).split("\\").join("/")];
  });
}

export function buildArtifactManifest(directory: string, generatedAt = new Date().toISOString()): ArtifactManifest {
  const root = resolve(directory);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`artifact directory does not exist: ${directory}`);
  const files = artifactFiles(root).sort().map((path) => {
    const bytes = readFileSync(join(root, path));
    return {path, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex")};
  });
  if (files.length === 0) throw new Error(`artifact directory is empty: ${directory}`);
  return {schema_version: 1, generated_at: generatedAt, files};
}

export function writeArtifactManifest(directory: string, generatedAt = new Date().toISOString()): ArtifactManifest {
  const manifest = buildArtifactManifest(directory, generatedAt);
  mkdirSync(resolve(directory), {recursive: true});
  writeFileSync(join(resolve(directory), "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function option(name: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

function releaseMode(): ReleaseMode {
  return (option("--mode") ?? process.env.RELEASE_MODE) === "production" ? "production" : "preview";
}

function releaseTag(): string | undefined {
  const refIsTag = process.env.GITHUB_REF_TYPE === "tag" || process.env.GITHUB_REF?.startsWith("refs/tags/");
  return option("--tag") ?? process.env.RELEASE_TAG ?? (refIsTag ? process.env.GITHUB_REF_NAME : undefined);
}

function signingConfigured(): boolean {
  return process.env.RELEASE_SIGNING_CONFIGURED === "true" || Boolean(process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD);
}

function environmentInput(): ReleaseGateInput {
  return {
    mode: releaseMode(),
    tag: releaseTag(),
    signingConfigured: signingConfigured(),
    stagingConfigured: Boolean(process.env.RELEASE_STAGING_URL),
  };
}

if (import.meta.main) {
  const input = environmentInput();
  const result = evaluateReleaseGate(input);
  const artifactDirectory = option("--artifacts-dir");
  if (artifactDirectory) {
    try {
      const manifest = writeArtifactManifest(artifactDirectory);
      console.log(`RELEASE ARTIFACTS: hashed ${manifest.files.length} files in ${artifactDirectory}`);
    } catch (error) {
      result.failures.push(error instanceof Error ? error.message : "unable to hash release artifacts");
    }
  }
  result.warnings.forEach((warning) => console.warn(`RELEASE WARNING: ${warning}`));
  result.failures.forEach((failure) => console.error(`RELEASE ERROR: ${failure}`));
  console.log(`RELEASE GATE: ${result.status}; ${result.label}`);
  if (result.failures.length > 0) process.exit(1);
}
