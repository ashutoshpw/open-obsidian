import {afterEach, expect, test} from "bun:test";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {PluginPolicy, PreviewBroker, type PluginCapability} from "../src/plugins/policy.js";
import {VaultStore} from "../src/core/vault.js";

const temporaryRoots: string[] = [];

function fixture(): {root: string; appData: string} {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-plugin-vault-"));
  const appData = mkdtempSync(join(tmpdir(), "openobsidian-plugin-app-"));
  temporaryRoots.push(root, appData);
  writeFileSync(join(root, "note.md"), "original\n");
  return {root, appData};
}

afterEach(() => {
  temporaryRoots.splice(0).forEach((path) => rmSync(path, {recursive: true, force: true}));
});

test("D15 denies direct plugin capabilities with visible records", () => {
  const policy = new PluginPolicy();
  const denied: PluginCapability[] = ["vault.direct-write", "configuration.write", "filesystem.direct", "network.request", "process.spawn", "credentials.read", "dom.privileged"];
  const decisions = denied.map((capability) => policy.evaluate({pluginId: "fixture-plugin", capability}));

  expect(decisions.every((decision) => decision.decision === "deny")).toBe(true);
  expect(policy.compatibilityRecords()).toHaveLength(denied.length);
  expect(policy.compatibilityRecords().every((record) => record.visible && record.status === "unsupported_security")).toBe(true);
  expect(policy.compatibilityRecords().every((record) => record.safeAlternativesAttempted.length > 0 && record.reproduction.length > 0)).toBe(true);
});

test("shared plugin configuration writes are denied until an explicit host policy exists", () => {
  const policy = new PluginPolicy();
  const decision = policy.evaluate({
    pluginId: "fixture-plugin",
    capability: "configuration.write",
    target: ".obsidian/plugins/fixture-plugin/data.json",
    detail: "plugin settings write requested during discovery",
  });

  expect(decision.decision).toBe("deny");
  expect(decision.record).toMatchObject({
    capability: "configuration.write",
    visible: true,
    status: "unsupported_security",
    reproduction: "plugin settings write requested during discovery",
  });
  expect(decision.record?.safeAlternativesAttempted).toContain("workflow disabled");
});

test("plugin writes are staged and require explicit approval", () => {
  const {root, appData} = fixture();
  const store = new VaultStore(root, appData);
  const broker = new PreviewBroker(store);
  const original = store.read("note.md");
  const preview = broker.preview("fixture-plugin", {relativePath: "note.md", expectedRevision: original.revision, bytes: Buffer.from("approved\n")});

  expect(readFileSync(join(root, "note.md"), "utf8")).toBe("original\n");
  expect(() => broker.apply(preview, false)).toThrow("not approved");
  broker.apply(preview, true);
  expect(readFileSync(join(root, "note.md"), "utf8")).toBe("approved\n");
});

test("mediated reads remain available without granting direct access", () => {
  const policy = new PluginPolicy();
  expect(policy.evaluate({pluginId: "fixture-plugin", capability: "vault.read"})).toEqual({decision: "allow", reason: "Mediated read-only capability"});
  expect(policy.compatibilityRecords()).toEqual([]);
});
