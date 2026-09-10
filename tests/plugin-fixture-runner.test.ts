import {afterEach, expect, test} from "bun:test";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runCapabilityMatrix, runNoOpOrder} from "../src/plugins/fixture-runner.js";
import {PluginPolicy} from "../src/plugins/policy.js";
import {VaultStore} from "../src/core/vault.js";

const temporaryRoots: string[] = [];

function fixture(): {root: string; appData: string} {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-plugin-order-vault-"));
  const appData = mkdtempSync(join(tmpdir(), "openobsidian-plugin-order-app-"));
  temporaryRoots.push(root, appData);
  writeFileSync(join(root, "note.md"), "original\n");
  return {root, appData};
}

afterEach(() => temporaryRoots.splice(0).forEach((path) => rmSync(path, {recursive: true, force: true})));

test("plugin fixture runner snapshots before automation and detects first-open writes", () => {
  const {root, appData} = fixture();
  const store = new VaultStore(root, appData);
  const noOp = runNoOpOrder(store);
  expect(noOp.automationStarted).toBe(false);
  expect(noOp.firstOpenWrite).toBe(false);
  expect(noOp.changedPaths).toEqual([]);

  const write = runNoOpOrder(store, () => writeFileSync(join(root, "note.md"), "plugin first-open write\n"));
  expect(write.automationStarted).toBe(true);
  expect(write.firstOpenWrite).toBe(true);
  expect(write.changedPaths).toEqual(["note.md"]);
  expect(readFileSync(join(root, "note.md"), "utf8")).toBe("plugin first-open write\n");
});

test("capability fixture runner records every denied privileged path", () => {
  const policy = new PluginPolicy();
  const result = runCapabilityMatrix(policy, "fixture-plugin", ["filesystem.direct", "network.request", "process.spawn", "credentials.read", "dom.privileged"]);
  expect(result.decisions.every((decision) => decision.decision === "deny")).toBe(true);
  expect(result.deniedRecords).toBe(5);
  expect(policy.compatibilityRecords().every((record) => record.visible && record.safeAlternativesAttempted.length >= 3)).toBe(true);
});
