import {VaultStore, type VaultScan} from "../core/vault.js";
import {PluginPolicy, type CapabilityRequest, type PolicyDecision, type PluginCapability} from "./policy.js";

export type NoOpOrderResult = {
  before: VaultScan;
  after: VaultScan;
  automationStarted: boolean;
  firstOpenWrite: boolean;
  changedPaths: string[];
};

export type CapabilityMatrixResult = {
  requests: CapabilityRequest[];
  decisions: PolicyDecision[];
  deniedRecords: number;
};

function changedPathsBetween(before: VaultScan, after: VaultScan): string[] {
  const beforeEntries = new Map(before.after.entries.map((entry) => [entry.relativePath, JSON.stringify(entry)]));
  const afterEntries = new Map(after.after.entries.map((entry) => [entry.relativePath, JSON.stringify(entry)]));
  return [...new Set([...beforeEntries.keys(), ...afterEntries.keys()])].filter((path) => beforeEntries.get(path) !== afterEntries.get(path)).sort();
}

export function runNoOpOrder(store: VaultStore, automation?: () => void): NoOpOrderResult {
  const before = store.scan();
  let automationStarted = false;
  if (automation) {
    automationStarted = true;
    automation();
  }
  const after = store.scan();
  return {before, after, automationStarted, firstOpenWrite: before.after.sha256 !== after.after.sha256, changedPaths: changedPathsBetween(before, after)};
}

export function runCapabilityMatrix(policy: PluginPolicy, pluginId: string, capabilities: PluginCapability[]): CapabilityMatrixResult {
  const requests = capabilities.map((capability) => ({pluginId, capability}));
  const decisions = requests.map((request) => policy.evaluate(request));
  return {requests, decisions, deniedRecords: policy.compatibilityRecords().length};
}
