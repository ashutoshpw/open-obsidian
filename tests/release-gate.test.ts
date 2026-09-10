import {expect, test} from "bun:test";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildArtifactManifest, evaluateReleaseGate, validateReleaseTag, writeArtifactManifest} from "../scripts/release-gate.js";

const root = new URL("..", import.meta.url);
const fixture = JSON.parse(readFileSync(new URL("fixtures/delivery-workflows.json", root), "utf8")) as {schema_version: number; workflows: string[]; runner_matrix: string[]; artifact_contract: string[]; preview_without_signing: string; production_without_signing: string; release_tag_created_by_goal: boolean};

test("release tag validation enforces an actual calendar date", () => {
  const now = new Date("2026-09-10T12:00:00Z");
  expect(validateReleaseTag("v2026-09-10", now)).toEqual([]);
  expect(validateReleaseTag("v2026-02-29", now)).toEqual(["release tag v2026-02-29 is not a valid calendar date"]);
  expect(validateReleaseTag("v2026-09-11", now)).toEqual(["release tag v2026-09-11 is in the future relative to the current UTC date"]);
  expect(validateReleaseTag("2026-09-10", now)[0]).toContain("must match vYYYY-MM-DD");
});

test("credential-absent previews are labeled and production is blocked", () => {
  expect(evaluateReleaseGate({mode: "preview", signingConfigured: false, stagingConfigured: false})).toMatchObject({status: "preview", label: "unsigned-preview", failures: []});
  expect(evaluateReleaseGate({mode: "production", tag: "v2026-09-10", signingConfigured: false, stagingConfigured: false, now: new Date("2026-09-10T00:00:00Z")})).toMatchObject({status: "blocked", label: "signed-production-candidate"});
  expect(evaluateReleaseGate({mode: "production", tag: "v2026-09-10", signingConfigured: true, stagingConfigured: true, now: new Date("2026-09-10T00:00:00Z")})).toMatchObject({status: "production-ready", failures: []});
});

test("delivery workflow fixture and artifact hashes are explicit", () => {
  expect(fixture.schema_version).toBe(1);
  expect(fixture.runner_matrix).toEqual(["ubuntu-latest", "macos-latest", "windows-latest"]);
  expect(fixture.artifact_contract).toEqual(["release-manifest.json", "sha256", "upload-artifact@v4"]);
  expect(fixture.preview_without_signing).toBe("unsigned-preview");
  expect(fixture.production_without_signing).toBe("blocked");
  expect(fixture.release_tag_created_by_goal).toBe(false);
  const quality = readFileSync(new URL(".github/workflows/quality.yml", root), "utf8");
  const desktop = readFileSync(new URL(".github/workflows/desktop-build.yml", root), "utf8");
  for (const workflow of [quality, desktop]) expect(workflow).toContain('tags: ["v*"]');
  for (const runner of fixture.runner_matrix) expect(desktop).toContain(runner);
  for (const contract of fixture.artifact_contract) expect(desktop).toContain(contract);
  expect(desktop).toContain("Validate release gate before packaging");
  expect(desktop).toContain("CSC_IDENTITY_AUTO_DISCOVERY");
  expect(readFileSync(new URL("package.json", root), "utf8")).toContain("electron-builder --dir --publish never");

  const directory = mkdtempSync(join(tmpdir(), "openobsidian-release-test-"));
  try {
    mkdirSync(join(directory, "nested"));
    writeFileSync(join(directory, "app.zip"), "release-bytes");
    writeFileSync(join(directory, "nested", "checksums.txt"), "sha256");
    const manifest = buildArtifactManifest(directory, "2026-09-10T00:00:00.000Z");
    expect(manifest.files.map((file) => file.path)).toEqual(["app.zip", "nested/checksums.txt"]);
    expect(manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
    expect(writeArtifactManifest(directory, "2026-09-10T00:00:00.000Z").files).toEqual(manifest.files);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});
