import {randomUUID} from "node:crypto";
import {VaultSafetyError, VaultStore, type VaultRead, type VaultWrite} from "../core/vault.js";

export type PluginCapability =
  | "vault.read"
  | "vault.preview-write"
  | "vault.direct-write"
  | "filesystem.direct"
  | "network.request"
  | "process.spawn"
  | "credentials.read"
  | "dom.privileged";

export type CapabilityRequest = {
  pluginId: string;
  capability: PluginCapability;
  target?: string;
  detail?: string;
};

export type D15Record = {
  id: string;
  pluginId: string;
  capability: PluginCapability;
  status: "unsupported_security";
  visible: true;
  reproduction: string;
  safeAlternativesAttempted: string[];
  scope: "plugin-runtime";
};

export type PolicyDecision = {
  decision: "allow" | "stage" | "deny";
  reason: string;
  record?: D15Record;
};

export type PreviewChange = {
  id: string;
  pluginId: string;
  relativePath: string;
  expectedRevision: string | null;
  bytes: Uint8Array;
  createdAt: string;
  status: "awaiting-approval";
};

const allowedCapabilities = new Set<PluginCapability>(["vault.read"]);
const stagedCapabilities = new Set<PluginCapability>(["vault.preview-write"]);

function deniedRecord(request: CapabilityRequest): D15Record {
  return {
    id: `D15:${request.pluginId}:${request.capability}`,
    pluginId: request.pluginId,
    capability: request.capability,
    status: "unsupported_security",
    visible: true,
    reproduction: request.detail ?? `${request.capability} requested${request.target ? ` for ${request.target}` : ""}`,
    safeAlternativesAttempted: ["mediated vault read", "preview broker", "workflow disabled"],
    scope: "plugin-runtime",
  };
}

export class PluginPolicy {
  private readonly deniedRecords = new Map<string, D15Record>();

  evaluate(request: CapabilityRequest): PolicyDecision {
    if (allowedCapabilities.has(request.capability)) return {decision: "allow", reason: "Mediated read-only capability"};
    if (stagedCapabilities.has(request.capability)) return {decision: "stage", reason: "Changes require the preview broker and explicit approval"};
    const record = deniedRecord(request);
    this.deniedRecords.set(record.id, record);
    return {decision: "deny", reason: "Direct plugin capability is denied under D15", record};
  }

  compatibilityRecords(): D15Record[] {
    return [...this.deniedRecords.values()];
  }
}

export class PreviewBroker {
  readonly policy: PluginPolicy;
  private readonly store: VaultStore;

  constructor(store: VaultStore, policy = new PluginPolicy()) {
    this.store = store;
    this.policy = policy;
  }

  preview(pluginId: string, request: VaultWrite): PreviewChange {
    const decision = this.policy.evaluate({pluginId, capability: "vault.preview-write", target: request.relativePath});
    if (decision.decision !== "stage") throw new VaultSafetyError(decision.reason);
    return {
      id: randomUUID(),
      pluginId,
      relativePath: request.relativePath,
      expectedRevision: request.expectedRevision,
      bytes: new Uint8Array(request.bytes),
      createdAt: new Date().toISOString(),
      status: "awaiting-approval",
    };
  }

  apply(change: PreviewChange, approved: boolean): VaultRead {
    if (!approved) throw new VaultSafetyError("Preview change was not approved");
    return this.store.write({relativePath: change.relativePath, expectedRevision: change.expectedRevision, bytes: change.bytes, operationId: change.id});
  }
}
