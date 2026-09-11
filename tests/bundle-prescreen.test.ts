import {expect, test} from "bun:test";
import {scanPluginBundle} from "../src/plugins/bundle-prescreen.js";
import {probePluginBundle} from "../src/plugins/runtime-probe.js";

test("bundle prescreen reports privileged markers without executing source", () => {
  const result = scanPluginBundle("const fs = require('fs'); fetch('/api'); process.spawn('git'); document.body; keytar.getPassword(); eval('1');");

  expect(result.markerIds).toEqual(["filesystem", "network", "process", "credentials", "dom", "dynamic-code"]);
  expect(result.markers.find((marker) => marker.id === "filesystem")?.capability).toBe("filesystem.direct");
  expect(result.markers.find((marker) => marker.id === "process")?.matchedPatterns).toContain("child-process");
});

test("bundle prescreen stays quiet for a mediated read-only bundle", () => {
  expect(scanPluginBundle("export function readVault() { return api.vault.read('note.md'); }"))
    .toEqual({markers: [], markerIds: []});
});

test("restricted runtime probe loads a source-only module without host access", async () => {
  const result = await probePluginBundle("module.exports = {name: 'fixture'};", {timeoutMs: 5_000});

  expect(result.status).toBe("loaded");
  expect(result.coverage).toBe("module-load-only");
  expect(result.exportKind).toBe("object");
  expect(result.deniedCapabilities).toEqual([]);
});

test("restricted runtime probe denies direct modules and dynamic code", async () => {
  const result = await probePluginBundle("require('node:fs'); eval('1');", {timeoutMs: 5_000});

  expect(result.status).toBe("denied");
  expect(result.deniedCapabilities).toContain("filesystem.direct");
});

test("restricted runtime probe bounds synchronous resource exhaustion", async () => {
  const result = await probePluginBundle("while (true) {}", {timeoutMs: 5_000});

  expect(result.status).toBe("timed-out");
  expect(result.deniedCapabilities).toContain("resource.unbounded");
});
