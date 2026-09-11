export const PLUGIN_PLATFORMS = ["macOS", "Windows", "Linux"] as const;
export type PluginPlatform = (typeof PLUGIN_PLATFORMS)[number];

export const PLUGIN_LIFECYCLE_CHECKS = [
  "install",
  "load",
  "settings",
  "commands",
  "events",
  "editor-mutation",
  "view-rendering",
  "hotkeys",
  "vault-write",
  "restart",
  "update",
  "uninstall",
  "return-to-obsidian",
] as const;
export type PluginLifecycleCheck = (typeof PLUGIN_LIFECYCLE_CHECKS)[number];

export type CompatibilityAsset = {
  name: string;
  bytes: number;
  sha256: string;
};

export type CompatibilityWorkflow = {
  id: string;
  criticality: string;
  description: string;
  expectedOutputs: string[];
};

export type PluginCompatibilityCell = {
  artifactId: string;
  pluginId: string;
  name: string;
  version: string;
  sourceRepository: string;
  releaseUrl: string;
  assets: CompatibilityAsset[];
  configurationFixtureId: string;
  platform: PluginPlatform;
  architectures: string[];
  workflows: CompatibilityWorkflow[];
  workflowEvidence: Record<string, "pending-runtime">;
  combinations: string[];
  lifecycle: Record<PluginLifecycleCheck, "pending-runtime">;
  disposition: "pending-runtime";
  securityPolicy: "D15: isolated preview required";
  deniedCapabilities: string[];
};

export type PluginBypassTest = {
  id: string;
  capability: string;
  expected: string;
};

export type PluginFeasibilityPlan = {
  scope: string;
  corpusSource: string;
  corpusCount: number;
  hardestTargets: string[];
  bypassTests: PluginBypassTest[];
};

export type PluginCompatibilityMatrix = {
  targets: PluginCompatibilityCell[];
  mandatoryTargetIds: string[];
  dependencyTargetIds: string[];
  feasibility: PluginFeasibilityPlan;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(record).filter((item): item is UnknownRecord => item !== null) : [];
}

function lifecycle(): Record<PluginLifecycleCheck, "pending-runtime"> {
  return Object.fromEntries(PLUGIN_LIFECYCLE_CHECKS.map((check) => [check, "pending-runtime"])) as Record<PluginLifecycleCheck, "pending-runtime">;
}

function workflowEvidence(workflowsForEntry: CompatibilityWorkflow[]): Record<string, "pending-runtime"> {
  return Object.fromEntries(workflowsForEntry.map((workflow) => [workflow.id, "pending-runtime"]));
}

function feasibilityPlan(isolation: UnknownRecord): PluginFeasibilityPlan {
  const plan = record(isolation.feasibility);
  const bypassTests = records(plan?.bypass_tests).flatMap((bypassTest) => {
    const id = string(bypassTest.id);
    const capability = string(bypassTest.capability);
    const expected = string(bypassTest.expected);
    return id && capability && expected ? [{id, capability, expected}] : [];
  });
  return {
    scope: string(plan?.scope),
    corpusSource: string(plan?.corpus_source),
    corpusCount: typeof plan?.corpus_count === "number" ? plan.corpus_count : 0,
    hardestTargets: strings(plan?.hardest_targets),
    bypassTests,
  };
}

function artifactAssets(artifact: UnknownRecord): CompatibilityAsset[] {
  return records(artifact.release_assets).flatMap((asset) => {
    const name = string(asset.name);
    const bytes = asset.bytes;
    const sha256 = string(asset.sha256);
    return name && typeof bytes === "number" && sha256 ? [{name, bytes, sha256}] : [];
  });
}

function workflows(entry: UnknownRecord): CompatibilityWorkflow[] {
  return records(entry.workflows).flatMap((workflow) => {
    const id = string(workflow.id);
    const criticality = string(workflow.criticality);
    const description = string(workflow.description);
    const expectedOutputs = strings(workflow.expected_outputs);
    return id && description ? [{id, criticality, description, expectedOutputs}] : [];
  });
}

function combinationsFor(entryId: string, combinations: UnknownRecord[]): string[] {
  return combinations.flatMap((combination) => strings(combination.members).includes(entryId) ? [string(combination.id)] : []);
}

function mandatoryAndDependencies(catalog: UnknownRecord, entries: UnknownRecord[]): {mandatoryTargetIds: string[]; dependencyTargetIds: string[]} {
  const selection = record(catalog.selection_basis);
  const knownIds = new Set(entries.map((entry) => string(entry.id)));
  const selected = strings(selection?.mandatory_scope).filter((id) => knownIds.has(id));
  const dependencies = strings(selection?.dependencies).filter((id) => knownIds.has(id));
  return {mandatoryTargetIds: selected, dependencyTargetIds: dependencies};
}

function cellLabel(cell: PluginCompatibilityCell): string {
  return `${cell.artifactId}/${cell.platform}`;
}

function invalidAssetPins(cell: PluginCompatibilityCell): boolean {
  return cell.assets.length === 0 || cell.assets.some((asset) => asset.bytes <= 0 || !/^[a-f0-9]{64}$/.test(asset.sha256));
}

function missingReleaseIdentity(cell: PluginCompatibilityCell): string | null {
  return !cell.pluginId || !cell.version || !cell.sourceRepository || !cell.releaseUrl ? `${cellLabel(cell)} is missing release identity` : null;
}

function missingConfiguration(cell: PluginCompatibilityCell): string | null {
  return cell.configurationFixtureId ? null : `${cellLabel(cell)} is missing configuration fixture`;
}

function missingWorkflowOutputs(cell: PluginCompatibilityCell): string | null {
  return cell.workflows.length > 0 && cell.workflows.every((workflow) => workflow.expectedOutputs.length > 0) ? null : `${cellLabel(cell)} is missing workflow outputs`;
}

function missingWorkflowEvidence(cell: PluginCompatibilityCell): string | null {
  return cell.workflows.every((workflow) => cell.workflowEvidence[workflow.id] === "pending-runtime") ? null : `${cellLabel(cell)} is missing workflow evidence dispositions`;
}

function unreviewedDisposition(cell: PluginCompatibilityCell): string | null {
  return cell.disposition === "pending-runtime" ? null : `${cellLabel(cell)} has an unreviewed runtime disposition`;
}

function incompleteLifecycle(cell: PluginCompatibilityCell): string | null {
  return PLUGIN_LIFECYCLE_CHECKS.every((check) => cell.lifecycle[check] === "pending-runtime") ? null : `${cellLabel(cell)} has an incomplete lifecycle disposition`;
}

function missingSecurityPolicy(cell: PluginCompatibilityCell): string | null {
  return cell.securityPolicy === "D15: isolated preview required" ? null : `${cellLabel(cell)} is missing the D15 policy`;
}

function invalidReleasePins(cell: PluginCompatibilityCell): string | null {
  return invalidAssetPins(cell) ? `${cellLabel(cell)} has invalid release asset pins` : null;
}

function validateCell(cell: PluginCompatibilityCell): string[] {
  return [missingReleaseIdentity(cell), missingConfiguration(cell), missingWorkflowOutputs(cell), missingWorkflowEvidence(cell), unreviewedDisposition(cell), incompleteLifecycle(cell), missingSecurityPolicy(cell), invalidReleasePins(cell)].filter((message): message is string => message !== null);
}

function validateFeasibilityPlan(matrix: PluginCompatibilityMatrix, targetIds: string[]): string[] {
  const plan = matrix.feasibility;
  const failures: string[] = [];
  if (!plan.scope || !plan.corpusSource) failures.push("feasibility plan is missing scope or corpus source");
  if (plan.corpusCount !== targetIds.length) failures.push(`feasibility plan corpus count ${plan.corpusCount} does not match ${targetIds.length} matrix targets`);
  if (plan.hardestTargets.length === 0 || plan.hardestTargets.some((id) => !targetIds.includes(id))) failures.push("feasibility plan has an unknown or empty hardest-target set");
  if (plan.bypassTests.length < 8 || plan.bypassTests.some((test) => !test.id || !test.capability || !test.expected)) failures.push("feasibility plan must declare eight complete bypass tests");
  return failures;
}

export function buildPluginCompatibilityMatrix(catalog: UnknownRecord, manifest: UnknownRecord, isolation: UnknownRecord): PluginCompatibilityMatrix {
  const entries = records(catalog.entries);
  const artifacts = new Map(records(manifest.artifacts).map((artifact) => [string(artifact.id), artifact]));
  const combinations = records(catalog.combinations);
  const deniedCapabilities = strings(record(isolation.capabilities)?.denied);
  const feasibility = feasibilityPlan(isolation);
  const targets = entries.flatMap((entry) => {
    const artifactId = string(entry.id);
    const artifact = artifacts.get(artifactId);
    if (!artifact) return [];
    const platforms = strings(entry.applicable_platforms).filter((platform): platform is PluginPlatform => PLUGIN_PLATFORMS.includes(platform as PluginPlatform));
    const entryWorkflows = workflows(entry);
    return platforms.map((platform) => ({
      artifactId,
      pluginId: string(artifact.registry_id) || artifactId,
      name: string(entry.name),
      version: string(artifact.tag),
      sourceRepository: string(artifact.source_repository),
      releaseUrl: string(artifact.release_url),
      assets: artifactAssets(artifact),
      configurationFixtureId: string(entry.configuration_fixture_id),
      platform,
      architectures: strings(entry.architectures),
      workflows: entryWorkflows,
      workflowEvidence: workflowEvidence(entryWorkflows),
      combinations: combinationsFor(artifactId, combinations),
      lifecycle: lifecycle(),
      disposition: "pending-runtime" as const,
      securityPolicy: string(entry.security_policy) as "D15: isolated preview required",
      deniedCapabilities,
    }));
  });
  const {mandatoryTargetIds, dependencyTargetIds} = mandatoryAndDependencies(catalog, entries);
  return {targets, mandatoryTargetIds, dependencyTargetIds, feasibility};
}

export function validatePluginCompatibilityMatrix(matrix: PluginCompatibilityMatrix): string[] {
  const failures: string[] = [];
  const targetIds = [...new Set(matrix.targets.map((target) => target.artifactId))];
  const expectedCells = targetIds.length * PLUGIN_PLATFORMS.length;
  if (matrix.targets.length !== expectedCells) failures.push(`expected ${expectedCells} platform cells, found ${matrix.targets.length}`);
  targetIds.forEach((id) => {
    const cells = matrix.targets.filter((target) => target.artifactId === id);
    PLUGIN_PLATFORMS.filter((platform) => !cells.some((cell) => cell.platform === platform)).forEach((platform) => failures.push(`${id} is missing ${platform} matrix cell`));
  });
  matrix.targets.forEach((cell) => failures.push(...validateCell(cell)));
  const mandatory = new Set(matrix.mandatoryTargetIds);
  const dependencies = new Set(matrix.dependencyTargetIds);
  if (mandatory.size !== 25) failures.push(`expected 25 mandatory targets, found ${mandatory.size}`);
  if (dependencies.size !== 2) failures.push(`expected 2 dependency targets, found ${dependencies.size}`);
  [...mandatory, ...dependencies].filter((id) => !targetIds.includes(id)).forEach((id) => failures.push(`selection references missing matrix target ${id}`));
  failures.push(...validateFeasibilityPlan(matrix, targetIds));
  return failures;
}
