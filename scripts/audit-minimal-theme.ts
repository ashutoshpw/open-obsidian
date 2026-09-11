import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {discoverVaultConfiguration, configurationIsReadOnlyBeforeAfter} from "../src/core/configuration.js";
import {scanPluginBundle, type BundlePrescreen} from "../src/plugins/bundle-prescreen.js";
import {parseThemeStylesheet, type ThemeStyleAnalysis} from "../src/shared/ui/index.js";
import {asArray, asRecord, type JsonRecord} from "./json.js";
import {downloadPinnedAsset, integrityFailure, readJson, records, string} from "./plugin-audit-helpers.js";

const root = resolve(import.meta.dir, "..");
const themeFixture = readJson(root, "fixtures/pc17-minimal-settings.json");

type ThemeAudit = {
  artifactId: string;
  tag: string;
  integrity: "passed" | "failed";
  analysis: Pick<ThemeStyleAnalysis, "modeSupport" | "layoutContracts" | "pluginViewContracts" | "popoutContracts" | "accessibilityContracts" | "issues"> & {
    previewDisposition: "safe-preview" | "withheld-for-review";
    missingContracts: string[];
  };
};

type SettingsAudit = {
  artifactId: string;
  tag: string;
  integrity: "passed" | "failed";
  prescreen: BundlePrescreen;
  requiredSettings: {key: string; present: boolean}[];
  requiredCommands: {id: string; present: boolean}[];
  saveDataCalls: number;
  runtimeDisposition: "pending-runtime";
  d15Disposition: "denied-security" | "sandbox-review-required";
};

type PersistenceAudit = {
  configurationPath: string;
  discovered: boolean;
  valuesPreserved: boolean;
  sourceUnchanged: boolean;
  policy: string;
};

export type MinimalThemeAudit = {
  schema_version: 1;
  fixture_id: string;
  recorded_at: string;
  pairedArtifacts: {theme: string; settingsPlugin: string};
  theme: ThemeAudit;
  settingsPlugin: SettingsAudit;
  configurationPreservation: PersistenceAudit;
  result: "static-contract-passed-runtime-pending" | "failed";
};

function artifact(manifest: JsonRecord, id: string): JsonRecord {
  const match = records(manifest.artifacts).find((candidate) => string(candidate.id) === id);
  if (!match) throw new Error(`Compatibility manifest is missing ${id}`);
  return match;
}

function asset(artifactRecord: JsonRecord, name: string): JsonRecord {
  const match = records(artifactRecord.release_assets).find((candidate) => string(candidate.name) === name);
  if (!match) throw new Error(`${string(artifactRecord.id)}/${name} is not pinned`);
  return match;
}

function requiredStrings(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === "string");
}

function missing(values: readonly string[], actual: readonly string[]): string[] {
  const set = new Set(actual);
  return values.filter((value) => !set.has(value));
}

export function analyzeMinimalTheme(source: string): ThemeAudit["analysis"] {
  const analysis = parseThemeStylesheet(source);
  const contracts = asRecord(themeFixture.required_theme_contracts);
  const requiredLayout = requiredStrings(contracts?.layout);
  const requiredPluginViews = requiredStrings(contracts?.plugin_views);
  const requiredPopout = requiredStrings(contracts?.popout);
  const requiredAccessibility = requiredStrings(contracts?.accessibility);
  const missingContracts = [
    ...missing(requiredLayout, analysis.layoutContracts),
    ...missing(requiredPluginViews, analysis.pluginViewContracts),
    ...missing(requiredPopout, analysis.popoutContracts),
    ...missing(requiredAccessibility, analysis.accessibilityContracts),
    ...(!analysis.modeSupport.light ? ["mode:light"] : []),
    ...(!analysis.modeSupport.dark ? ["mode:dark"] : []),
  ];
  return {
    modeSupport: analysis.modeSupport,
    layoutContracts: analysis.layoutContracts,
    pluginViewContracts: analysis.pluginViewContracts,
    popoutContracts: analysis.popoutContracts,
    accessibilityContracts: analysis.accessibilityContracts,
    issues: analysis.issues,
    previewDisposition: analysis.safety.previewable ? "safe-preview" : "withheld-for-review",
    missingContracts,
  };
}

function quotedToken(source: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:["']${escaped}["']|\\b${escaped})\\s*:`).test(source);
}

function commandToken(source: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:["']?id["']?)\\s*:\\s*["']${escaped}["']`).test(source);
}

export function analyzeMinimalSettings(source: string): Pick<SettingsAudit, "prescreen" | "requiredSettings" | "requiredCommands" | "saveDataCalls" | "runtimeDisposition" | "d15Disposition"> {
  const prescreen = scanPluginBundle(source);
  const settingsKeys = requiredStrings(themeFixture.settings_keys);
  const commandIds = requiredStrings(themeFixture.command_ids);
  const requiredSettings = settingsKeys.map((key) => ({key, present: quotedToken(source, key)}));
  const requiredCommands = commandIds.map((id) => ({id, present: commandToken(source, id)}));
  const saveDataCalls = [...source.matchAll(/\bsaveData\s*\(/g)].length;
  return {
    prescreen,
    requiredSettings,
    requiredCommands,
    saveDataCalls,
    runtimeDisposition: "pending-runtime",
    d15Disposition: prescreen.markerIds.includes("dom") ? "denied-security" : "sandbox-review-required",
  };
}

function fixtureSettings(): Record<string, unknown> {
  return {
    lightStyle: "minimal-light",
    darkStyle: "minimal-dark",
    lightScheme: "minimal-default-light",
    darkScheme: "minimal-default-dark",
    lineHeight: 1.5,
    lineWidth: 40,
    textNormal: 16,
    textSmall: 13,
    unknownFutureKey: {preserve: true},
  };
}

function configurationPreservation(): PersistenceAudit {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "openobsidian-pc17-config-"));
  const configurationPath = String(themeFixture.configuration_path);
  const absoluteSettingsPath = join(temporaryRoot, configurationPath);
  try {
    mkdirSync(join(temporaryRoot, ".obsidian", "plugins", "obsidian-minimal-settings"), {recursive: true});
    const settings = fixtureSettings();
    writeFileSync(absoluteSettingsPath, `${JSON.stringify(settings)}\n`);
    const sourceBytes = readFileSync(absoluteSettingsPath);
    const before = discoverVaultConfiguration(temporaryRoot);
    const result = configurationIsReadOnlyBeforeAfter(temporaryRoot, () => discoverVaultConfiguration(temporaryRoot));
    const discovered = result.after.json[configurationPath];
    return {
      configurationPath,
      discovered: discovered !== undefined,
      valuesPreserved: JSON.stringify(discovered) === JSON.stringify(settings) && JSON.stringify(before.json[configurationPath]) === JSON.stringify(settings),
      sourceUnchanged: Buffer.compare(sourceBytes, readFileSync(absoluteSettingsPath)) === 0 && result.unchanged,
      policy: String(themeFixture.persistence_policy),
    };
  } finally {
    rmSync(temporaryRoot, {recursive: true, force: true});
  }
}

function integrity(assetRecord: JsonRecord, bytes: ArrayBuffer): "passed" | "failed" {
  return integrityFailure(assetRecord, bytes) === null ? "passed" : "failed";
}

function settingsContractPass(settingsAnalysis: Pick<SettingsAudit, "requiredSettings" | "requiredCommands" | "saveDataCalls">): boolean {
  return settingsAnalysis.requiredSettings.every((entry) => entry.present)
    && settingsAnalysis.requiredCommands.every((entry) => entry.present)
    && settingsAnalysis.saveDataCalls > 0;
}

function staticContractPass(themeIntegrity: "passed" | "failed", settingsIntegrity: "passed" | "failed", themeAnalysis: ThemeAudit["analysis"], settingsAnalysis: Pick<SettingsAudit, "requiredSettings" | "requiredCommands" | "saveDataCalls">, persistence: PersistenceAudit): boolean {
  return themeIntegrity === "passed"
    && settingsIntegrity === "passed"
    && themeAnalysis.missingContracts.length === 0
    && settingsContractPass(settingsAnalysis)
    && persistence.discovered
    && persistence.valuesPreserved
    && persistence.sourceUnchanged;
}

async function downloadPair(manifest: JsonRecord): Promise<{themeArtifact: JsonRecord; settingsArtifact: JsonRecord; themeAsset: JsonRecord; settingsAsset: JsonRecord; themeBytes: ArrayBuffer; settingsBytes: ArrayBuffer}> {
  const themeArtifact = artifact(manifest, String(themeFixture.theme_artifact_id));
  const settingsArtifact = artifact(manifest, String(themeFixture.plugin_artifact_id));
  const themeAsset = asset(themeArtifact, "theme.css");
  const settingsAsset = asset(settingsArtifact, "main.js");
  const [themeBytes, settingsBytes] = await Promise.all([downloadPinnedAsset(string(themeAsset.url)), downloadPinnedAsset(string(settingsAsset.url))]);
  if (!themeBytes || !settingsBytes) throw new Error("Minimal pair asset download failed after retries");
  return {themeArtifact, settingsArtifact, themeAsset, settingsAsset, themeBytes, settingsBytes};
}

export async function auditMinimalPair(): Promise<MinimalThemeAudit> {
  const manifest = readJson(root, "fixtures/compatibility-manifest.json");
  const {themeArtifact, settingsArtifact, themeAsset, settingsAsset, themeBytes, settingsBytes} = await downloadPair(manifest);
  const themeAnalysis = analyzeMinimalTheme(new TextDecoder().decode(themeBytes));
  const settingsAnalysis = analyzeMinimalSettings(new TextDecoder().decode(settingsBytes));
  const themeIntegrity = integrity(themeAsset, themeBytes);
  const settingsIntegrity = integrity(settingsAsset, settingsBytes);
  const persistence = configurationPreservation();
  const staticPass = staticContractPass(themeIntegrity, settingsIntegrity, themeAnalysis, settingsAnalysis, persistence);
  return {
    schema_version: 1,
    fixture_id: String(themeFixture.fixture_id),
    recorded_at: new Date().toISOString(),
    pairedArtifacts: {theme: `${string(themeArtifact.id)}@${string(themeArtifact.tag)}`, settingsPlugin: `${string(settingsArtifact.id)}@${string(settingsArtifact.tag)}`},
    theme: {artifactId: string(themeArtifact.id), tag: string(themeArtifact.tag), integrity: themeIntegrity, analysis: themeAnalysis},
    settingsPlugin: {artifactId: string(settingsArtifact.id), tag: string(settingsArtifact.tag), integrity: settingsIntegrity, ...settingsAnalysis},
    configurationPreservation: persistence,
    result: staticPass ? "static-contract-passed-runtime-pending" : "failed",
  };
}

if (import.meta.main) {
  try {
    const report = await auditMinimalPair();
    console.log(JSON.stringify(report, null, 2));
    if (report.result === "failed") process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
