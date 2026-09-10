import {randomUUID} from "node:crypto";
import {scopePathMatches} from "./path-scope.js";
import {validateProviderSettings} from "../shared/api.js";
import type {ProviderAvailability, ProviderId, ProviderMode, ProviderSettings, ProviderStatus, ProviderUsageCaps, ProviderUsageSnapshot, RetrievalScope} from "../shared/api.js";
import type {CredentialStore} from "./credentials.js";

export type ProviderErrorCode = "invalid-config" | "credential-missing" | "scope-denied" | "unavailable" | "offline" | "timeout" | "cancelled" | "quota" | "transport";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;

  constructor(code: ProviderErrorCode, message: string) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
  }
}

export type ProviderInputContext = {
  scope: RetrievalScope;
  relativePaths: string[];
  excludedPaths: string[];
  sourceDataUntrusted: true;
};

export type ProviderInput = {prompt: string; context: ProviderInputContext};

export type ProviderTransportRequest = {
  requestId: string;
  mode: ProviderMode;
  providerId: ProviderId;
  model: string;
  endpoint: string;
  credential: string | null;
  prompt: string;
  maxOutputTokens: number;
  signal: AbortSignal;
};

export type ProviderTransportResponse = {text: string; inputTokens?: number; outputTokens?: number; costCents?: number};
export type ProviderTransport = (request: ProviderTransportRequest) => Promise<ProviderTransportResponse>;
export type ProviderUsage = {inputTokens: number; outputTokens: number; costCents: number};
export type ProviderResponse = {requestId: string; mode: ProviderMode; providerId: ProviderId; model: string; text: string; usage: ProviderUsage};
export type ProviderRunOptions = {credentials: CredentialStore; transport?: ProviderTransport; ledger?: ProviderUsageLedger; signal?: AbortSignal; timeoutMs?: number; online?: boolean};

function providerError(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid provider configuration";
}

function checkedSettings(settings: ProviderSettings): ProviderSettings {
  try {
    return validateProviderSettings(settings);
  } catch (error) {
    throw new ProviderError("invalid-config", providerError(error));
  }
}

function tokenEstimate(value: string): number {
  return Math.max(1, Math.ceil(value.trim().length / 4));
}

function pathExcluded(path: string, excluded: string[]): boolean {
  return excluded.some((candidate) => scopePathMatches(path, candidate));
}

function pathSelected(path: string, scope: RetrievalScope): boolean {
  const paths = scope.paths ?? [];
  const folders = scope.folders ?? [];
  if (!pathInList(path, paths)) return false;
  return pathInFolder(path, folders);
}

function pathInList(path: string, paths: string[]): boolean {
  if (paths.length === 0) return true;
  return paths.includes(path);
}

function pathInFolder(path: string, folders: string[]): boolean {
  if (folders.length === 0) return true;
  return folders.some((folder) => scopePathMatches(path, folder));
}

function contextIsSafe(input: ProviderInput): boolean {
  const excluded = [...input.context.excludedPaths, ...(input.context.scope.excludedPaths ?? [])];
  return input.context.relativePaths.every((path) => !pathExcluded(path, excluded) && pathSelected(path, input.context.scope));
}

function validateInput(input: ProviderInput): void {
  if (!input.prompt.trim()) throw new ProviderError("scope-denied", "Provider input must contain an explicitly selected prompt");
  if (!input.context.sourceDataUntrusted || !contextIsSafe(input)) throw new ProviderError("scope-denied", "Provider input contains excluded or untrusted scope data");
}

function requiredCredential(settings: ProviderSettings, credentials: CredentialStore): string | null {
  if (settings.mode === "local") return null;
  const reference = credentialReference(settings, credentials);
  const secret = credentials.read(reference);
  if (!secret) throw new ProviderError("credential-missing", `The ${settings.mode} credential is unavailable`);
  return secret;
}

function credentialReference(settings: ProviderSettings, credentials: CredentialStore): string {
  const reference = settings.credentialRef;
  if (!reference || !credentials.has(reference)) throw new ProviderError("credential-missing", `No credential is stored for ${settings.mode} mode`);
  return reference;
}

function outputUsage(result: ProviderTransportResponse, input: ProviderInput): ProviderUsage {
  const inputTokens = usageNumber(result.inputTokens, tokenEstimate(input.prompt));
  const outputTokens = usageNumber(result.outputTokens, tokenEstimate(result.text));
  const costCents = usageNumber(result.costCents, 0);
  if (![inputTokens, outputTokens, costCents].every(validUsageValue)) throw new ProviderError("transport", "Provider returned invalid usage data");
  return {inputTokens, outputTokens, costCents};
}

function usageNumber(value: number | undefined, fallback: number): number {
  return value ?? fallback;
}

function validUsageValue(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function usageExceedsCaps(usage: ProviderUsage, caps: ProviderUsageCaps): boolean {
  const checks: Array<[number, number]> = [[usage.outputTokens, caps.maxOutputTokens], [usage.inputTokens, caps.maxInputTokens], [usage.costCents, caps.maxCostCents]];
  for (const [value, cap] of checks) if (value > cap) return true;
  return false;
}

function ensureOutputWithinCaps(usage: ProviderUsage, caps: ProviderUsageCaps): void {
  if (usageExceedsCaps(usage, caps)) throw new ProviderError("quota", "Provider response exceeded the configured hard usage cap");
}

function timeoutValue(value: number | undefined): number {
  const timeout = value ?? 30_000;
  if (!validTimeout(timeout)) throw new ProviderError("invalid-config", "Provider timeout must be between 100 and 120000 milliseconds");
  return timeout;
}

function validTimeout(value: number): boolean {
  if (!Number.isSafeInteger(value)) return false;
  if (value < 100) return false;
  return value <= 120_000;
}

function ensureDispatchable(settings: ProviderSettings, options: ProviderRunOptions): void {
  ensureTransport(options);
  ensureOnline(settings, options);
  ensureNotCancelled(options);
}

function ensureTransport(options: ProviderRunOptions): void {
  if (!options.transport) throw new ProviderError("unavailable", "No transport is configured for the selected provider; no fallback was attempted");
}

function ensureOnline(settings: ProviderSettings, options: ProviderRunOptions): void {
  if (options.online === false) throw new ProviderError("offline", `The ${settings.mode} provider is offline; no fallback was attempted`);
}

function ensureNotCancelled(options: ProviderRunOptions): void {
  if (options.signal?.aborted) throw new ProviderError("cancelled", "Provider request was cancelled before dispatch");
}

type AbortResources = {controller: AbortController; timedOut: () => boolean; timer: ReturnType<typeof setTimeout>; abort: () => void};

function abortResources(options: ProviderRunOptions): AbortResources {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = timeoutValue(options.timeoutMs);
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  const abort = (): void => controller.abort();
  options.signal?.addEventListener("abort", abort, {once: true});
  return {controller, timedOut: () => timedOut, timer, abort};
}

function transportFailure(error: unknown, resources: AbortResources, options: ProviderRunOptions): ProviderError {
  if (resources.timedOut()) return new ProviderError("timeout", "Provider request timed out");
  if (cancelled(options)) return new ProviderError("cancelled", "Provider request was cancelled");
  if (error instanceof ProviderError) return error;
  return new ProviderError("transport", "Provider request failed; the provider error was redacted");
}

function cancelled(options: ProviderRunOptions): boolean {
  return Boolean(options.signal?.aborted);
}

async function transportCall(settings: ProviderSettings, input: ProviderInput, credential: string | null, options: ProviderRunOptions, requestId: string): Promise<ProviderTransportResponse> {
  ensureDispatchable(settings, options);
  const resources = abortResources(options);
  try {
    return await options.transport!({requestId, mode: settings.mode, providerId: settings.providerId, model: settings.model, endpoint: settings.endpoint, credential, prompt: input.prompt, maxOutputTokens: settings.caps.maxOutputTokens, signal: resources.controller.signal});
  } catch (error) {
    throw transportFailure(error, resources, options);
  } finally {
    clearTimeout(resources.timer);
    options.signal?.removeEventListener("abort", resources.abort);
  }
}

export class ProviderUsageLedger {
  private readonly values: ProviderUsageSnapshot;

  constructor(readonly caps: ProviderUsageCaps) {
    this.values = {...caps, requestCount: 0, inputTokens: 0, outputTokens: 0, costCents: 0};
  }

  preflight(estimate: ProviderUsage): void {
    const checks: Array<[number, number]> = [[this.values.requestCount + 1, this.caps.maxRequests], [this.values.inputTokens + estimate.inputTokens, this.caps.maxInputTokens], [this.values.outputTokens + estimate.outputTokens, this.caps.maxOutputTokens], [this.values.costCents + estimate.costCents, this.caps.maxCostCents]];
    if (checks.some(([value, cap]) => value > cap)) throw new ProviderError("quota", "The configured provider usage cap has been reached");
  }

  static recordUsage(ledger: ProviderUsageLedger, usage: ProviderUsage): void {
    ledger.preflight(usage);
    ledger.values.requestCount += 1;
    ledger.values.inputTokens += usage.inputTokens;
    ledger.values.outputTokens += usage.outputTokens;
    ledger.values.costCents += usage.costCents;
  }

  snapshot(): ProviderUsageSnapshot {
    return {...this.values};
  }
}

function destination(settings: ProviderSettings): string {
  if (settings.mode === "managed") return `Managed OpenRouter proxy · ${settings.endpoint}`;
  if (settings.mode === "byok") return `BYOK provider endpoint · ${settings.endpoint}`;
  return `Local loopback endpoint · ${settings.endpoint}`;
}

function credentialState(settings: ProviderSettings, credentials: CredentialStore): "not-required" | "stored" | "missing" {
  if (settings.mode === "local") return "not-required";
  return settings.credentialRef && credentials.has(settings.credentialRef) ? "stored" : "missing";
}

function availability(settings: ProviderSettings, state: "not-required" | "stored" | "missing", options: {online: boolean; transportConfigured: boolean}): {availability: ProviderAvailability; reason: string} {
  const candidates = [
    {when: state === "missing", availability: "setup-required" as const, reason: "Store a credential in OS credential storage before dispatch."},
    {when: settings.model === "unset", availability: "setup-required" as const, reason: "Select an explicit model before dispatch."},
    {when: !options.transportConfigured, availability: "unavailable" as const, reason: "No provider transport is configured; no fallback is available."},
    {when: !options.online, availability: "offline" as const, reason: "The configured provider is offline; no fallback is available."},
  ];
  return candidates.find((candidate) => candidate.when) ?? {availability: "ready", reason: "The selected provider and model are configured explicitly."};
}

export function describeProvider(settingsInput: ProviderSettings, credentials: CredentialStore, options: {online?: boolean; transportConfigured?: boolean} = {}): ProviderStatus {
  const settings = checkedSettings(settingsInput);
  const state = credentialState(settings, credentials);
  const stateInfo = availability(settings, state, {online: options.online ?? false, transportConfigured: options.transportConfigured ?? false});
  return {mode: settings.mode, providerId: settings.providerId, model: settings.model, endpoint: settings.endpoint, destination: destination(settings), credentialState: state, availability: stateInfo.availability, fallback: "none", reason: stateInfo.reason, usage: new ProviderUsageLedger(settings.caps).snapshot()};
}

export async function runProviderRequest(settingsInput: ProviderSettings, input: ProviderInput, options: ProviderRunOptions): Promise<ProviderResponse> {
  const settings = checkedSettings(settingsInput);
  validateInput(input);
  const credential = requiredCredential(settings, options.credentials);
  const ledger = options.ledger ?? new ProviderUsageLedger(settings.caps);
  const estimate = {inputTokens: tokenEstimate(input.prompt), outputTokens: 0, costCents: 0};
  ledger.preflight(estimate);
  const requestId = randomUUID();
  const result = await transportCall(settings, input, credential, options, requestId);
  if (typeof result.text !== "string") throw new ProviderError("transport", "Provider returned no text response");
  const usage = outputUsage(result, input);
  ensureOutputWithinCaps(usage, settings.caps);
  ProviderUsageLedger.recordUsage(ledger, usage);
  return {requestId, mode: settings.mode, providerId: settings.providerId, model: settings.model, text: result.text, usage};
}

export function providerInput(prompt: string, scope: RetrievalScope, relativePaths: string[]): ProviderInput {
  return {prompt, context: {scope, relativePaths, excludedPaths: scope.excludedPaths ?? [], sourceDataUntrusted: true}};
}
