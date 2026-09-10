import {expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {evaluateUpdateRollback} from "../scripts/update-rollback.js";
import type {ArtifactManifest} from "../scripts/release-gate.js";

const root = new URL("..", import.meta.url);
const manifest = (sha256: string): ArtifactManifest => ({schema_version: 1, generated_at: "2026-09-10T00:00:00.000Z", files: [{path: "app.zip", bytes: 10, sha256}]});

test("update and rollback manifests form a checked transition", () => {
  const result = evaluateUpdateRollback({currentVersion: "0.1.0", targetVersion: "0.2.0", targetManifest: manifest("a".repeat(64)), rollbackVersion: "0.1.0", rollbackManifest: manifest("b".repeat(64))});
  expect(result.status).toBe("ready");
  expect(result.failures).toEqual([]);
  expect(result.checks.map((check) => check.id)).toEqual(["manifest-integrity", "version-transition", "rollback-manifest-integrity", "previous-artifact-rollback", "offline-installation"]);
  expect(result.checks.at(-1)?.status).toBe("external-pending");
});

test("invalid transitions cannot pass the update and rollback contract", () => {
  const result = evaluateUpdateRollback({currentVersion: "0.1.0", targetVersion: "0.1.0", targetManifest: manifest("not-a-sha")});
  expect(result.status).toBe("blocked");
  expect(result.failures).toEqual(expect.arrayContaining([
    "target manifest has invalid sha256 for app.zip",
    "target version must be non-empty and differ from the current version",
    "rollback manifest is required",
    "rollback version and a distinct previous artifact are required",
  ]));
});

test("the checked fixture keeps offline installation explicitly external", () => {
  const fixture = JSON.parse(readFileSync(new URL("fixtures/update-rollback.json", root), "utf8")) as {schema_version: number; checks: string[]};
  expect(fixture.schema_version).toBe(1);
  expect(fixture.checks).toEqual(["manifest-integrity", "previous-artifact-rollback", "offline-installation-external"]);
});
