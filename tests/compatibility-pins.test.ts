import {expect, test} from "bun:test";
import {checkManifestMetadata} from "../scripts/verify-compatibility-pins.js";

function bytes(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer as ArrayBuffer;
}

const asset = {
  name: "manifest.json",
  manifest: {id: "fixture-plugin", name: "Fixture Plugin", version: "1.2.3", minAppVersion: null},
};

test("compatibility pin gate matches recorded manifest metadata", () => {
  expect(checkManifestMetadata("PC01", asset, bytes(JSON.stringify({id: "fixture-plugin", name: "Fixture Plugin", version: "1.2.3", minAppVersion: null})))).toEqual([]);
  expect(checkManifestMetadata("PC01", asset, bytes(JSON.stringify({id: "other-plugin", name: "Fixture Plugin", version: "1.2.3", minAppVersion: null})))).toEqual(["PC01/manifest.json id changed: expected fixture-plugin, got other-plugin"]);
});

test("compatibility pin gate rejects malformed or unrecorded manifests", () => {
  expect(checkManifestMetadata("PC01", asset, bytes("not-json"))).toEqual(["PC01/manifest.json is not valid JSON"]);
  expect(checkManifestMetadata("PC01", {name: "manifest.json"}, bytes("{}"))).toEqual(["PC01/manifest.json is missing recorded manifest metadata"]);
  expect(checkManifestMetadata("PC01", {name: "styles.css", manifest: asset.manifest}, bytes("body {}"))).toEqual([]);
});
