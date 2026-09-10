import {expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {DEFAULT_PROVIDER_SETTINGS, type ProviderMode, type ProviderSettings} from "../src/shared/api.js";
import {MemoryCredentialStore} from "../src/core/credentials.js";
import {describeProvider, ProviderError, ProviderUsageLedger, providerInput, runProviderRequest, type ProviderTransportRequest} from "../src/core/providers.js";
import {createLocalModelManifest, derivativeDeletionPlan, exportPortableConversation, inspectLocalModel, modelChangeRequiresReindex} from "../src/core/model-lifecycle.js";

const providerFixture = JSON.parse(readFileSync(new URL("../fixtures/provider-modes.json", import.meta.url), "utf8")) as {schema_version: number; modes: Array<{id: string; fallback: string}>};
const lifecycleFixture = JSON.parse(readFileSync(new URL("../fixtures/model-lifecycle.json", import.meta.url), "utf8")) as {schema_version: number; states: string[]};

const caps = {maxRequests: 2, maxInputTokens: 100, maxOutputTokens: 20, maxCostCents: 10};
const providerIds: Record<ProviderMode, ProviderSettings["providerId"]> = {managed: "openrouter-proxy", byok: "openai-compatible", local: "local-openai-compatible"};

function settings(mode: ProviderMode): ProviderSettings {
  const endpoint = {managed: "https://proxy.example.test/v1", byok: "https://provider.example.test/v1", local: "http://127.0.0.1:11434/v1"}[mode];
  return {...DEFAULT_PROVIDER_SETTINGS, mode, providerId: providerIds[mode], model: "test-model", endpoint, credentialRef: mode === "local" ? null : `${mode}-credential`, caps};
}

function input(paths = ["note.md"], excludedPaths: string[] = []): ReturnType<typeof providerInput> {
  return providerInput("Summarize the selected note.", {paths, excludedPaths}, paths);
}

test("provider fixtures and status expose explicit destinations without fallback", () => {
  expect(providerFixture.schema_version).toBe(1);
  expect(providerFixture.modes.map((mode) => mode.id)).toEqual(["managed", "byok", "local"]);
  expect(providerFixture.modes.every((mode) => mode.fallback === "none")).toBe(true);
  expect(lifecycleFixture.schema_version).toBe(1);
  expect(lifecycleFixture.states).toEqual(["missing", "invalid", "stale", "offline", "ready"]);

  const credentials = new MemoryCredentialStore();
  const local = describeProvider(settings("local"), credentials);
  expect(local.credentialState).toBe("not-required");
  expect(local.fallback).toBe("none");
  expect(local.availability).toBe("unavailable");
  const byok = describeProvider(settings("byok"), credentials);
  expect(byok.credentialState).toBe("missing");
  expect(byok.availability).toBe("setup-required");
  credentials.write("byok-credential", "test-secret");
  expect(describeProvider(settings("byok"), credentials).credentialState).toBe("stored");
});

test("provider requests use only the selected mode, enforce context and record hard caps", async () => {
  const credentials = new MemoryCredentialStore();
  credentials.write("byok-credential", "test-secret");
  const ledger = new ProviderUsageLedger(caps);
  let seen: ProviderTransportRequest | undefined;
  const result = await runProviderRequest(settings("byok"), input(), {credentials, ledger, online: true, timeoutMs: 1_000, transport: async (request) => { seen = request; return {text: "local test answer", outputTokens: 3, costCents: 1}; }});
  expect(result.mode).toBe("byok");
  expect(result.providerId).toBe("openai-compatible");
  expect(result.usage.inputTokens).toBe(7);
  expect(seen?.credential).toBe("test-secret");
  expect(ledger.snapshot()).toMatchObject({requestCount: 1, inputTokens: 7, outputTokens: 3, costCents: 1, maxRequests: 2});
  await expect(runProviderRequest(settings("byok"), input(["private.md"], ["private.md"]), {credentials, online: true, transport: async () => ({text: "should not dispatch"})})).rejects.toMatchObject({code: "scope-denied"});
  await expect(runProviderRequest(settings("local"), input(), {credentials, online: false, transport: async () => ({text: "should not fallback"})})).rejects.toMatchObject({code: "offline"});
  await expect(runProviderRequest(settings("managed"), input(), {credentials, online: true, transport: async () => ({text: "should not dispatch"})})).rejects.toMatchObject({code: "credential-missing"});
  await expect(runProviderRequest(settings("local"), input(), {credentials, online: true})).rejects.toMatchObject({code: "unavailable"});
});

test("provider timeout, cancellation, quota and error redaction are explicit", async () => {
  const credentials = new MemoryCredentialStore();
  const waiting = ({signal}: ProviderTransportRequest): Promise<{text: string}> => new Promise((resolve, reject) => { signal.addEventListener("abort", () => reject(new Error("secret-token")), {once: true}); void resolve; });
  await expect(runProviderRequest(settings("local"), input(), {credentials, online: true, timeoutMs: 100, transport: waiting})).rejects.toMatchObject({code: "timeout"});

  const controller = new AbortController();
  const cancelled = runProviderRequest(settings("local"), input(), {credentials, online: true, timeoutMs: 1_000, signal: controller.signal, transport: waiting});
  controller.abort();
  await expect(cancelled).rejects.toMatchObject({code: "cancelled"});

  const limited = new ProviderUsageLedger({...caps, maxInputTokens: 1});
  await expect(runProviderRequest(settings("local"), input(), {credentials, ledger: limited, online: true, transport: async () => ({text: "not called"})})).rejects.toMatchObject({code: "quota"});
  let failure: ProviderError | undefined;
  try {
    await runProviderRequest(settings("local"), input(), {credentials, online: true, transport: async () => { throw new Error("secret-token"); }});
  } catch (error) {
    failure = error as ProviderError;
  }
  expect(failure?.code).toBe("transport");
  expect(failure?.message).not.toContain("secret-token");
});

test("model lifecycle verifies bytes, detects stale versions and exports portable history", () => {
  const bytes = new TextEncoder().encode("model bytes");
  const manifest = createLocalModelManifest({modelId: "test-model", version: "1", source: "fixture", license: "test", storagePath: "models/test"}, bytes);
  expect(inspectLocalModel(manifest, bytes, "1", true).state).toBe("ready");
  expect(inspectLocalModel(manifest, new TextEncoder().encode("changed"), "1", true).state).toBe("invalid");
  expect(inspectLocalModel(manifest, bytes, "2", true).state).toBe("stale");
  expect(inspectLocalModel(manifest, bytes, "1", false).state).toBe("offline");
  expect(inspectLocalModel(null, null, undefined, true).state).toBe("missing");
  expect(modelChangeRequiresReindex(manifest, manifest)).toBe(false);
  expect(modelChangeRequiresReindex(manifest, {...manifest, version: "2"})).toBe(true);
  expect(derivativeDeletionPlan("note.md", "rev-2", false, [{path: "derivatives/old", sourcePath: "note.md", sourceRevision: "rev-1", modelVersion: "1"}, {path: "derivatives/current", sourcePath: "note.md", sourceRevision: "rev-2", modelVersion: "1"}, {path: "derivatives/other", sourcePath: "other.md", sourceRevision: "rev-1", modelVersion: "1"}])).toEqual(["derivatives/old"]);
  const exported = JSON.parse(exportPortableConversation({providerMode: "none", model: null, turns: [{role: "user", content: "hello", createdAt: "2026-09-10T00:00:00Z"}]}, "2026-09-10T00:00:00Z")) as {schema_version: number; providerMode: string; model: string | null; turns: unknown[]};
  expect(exported).toMatchObject({schema_version: 1, providerMode: "none", model: null});
  expect(exported.turns).toHaveLength(1);
});
