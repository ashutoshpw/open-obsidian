import {expect, test} from "bun:test";
import {scanPluginBundle} from "../src/plugins/bundle-prescreen.js";

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
