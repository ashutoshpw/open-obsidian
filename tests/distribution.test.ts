import {expect, test} from "bun:test";
import {mkdtempSync, mkdirSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {auditPackagedRuntime} from "../scripts/audit-packaged-runtime.js";
import {auditDistribution, readDistributionAudit} from "../scripts/verify-distribution.js";

function sha256(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function packagedFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-packaged-runtime-"));
  const resources = join(root, "linux-unpacked", "resources");
  mkdirSync(resources, {recursive: true});
  const electronLicense = "Electron license";
  const chromiumLicense = "Chromium and Node.js notices";
  const app = "app-asar-bytes";
  writeFileSync(join(root, "linux-unpacked", "LICENSE.electron.txt"), electronLicense);
  writeFileSync(join(root, "linux-unpacked", "LICENSES.chromium.html"), chromiumLicense);
  writeFileSync(join(resources, "app.asar"), app);
  const files = [
    ["linux-unpacked/LICENSE.electron.txt", electronLicense],
    ["linux-unpacked/LICENSES.chromium.html", chromiumLicense],
    ["linux-unpacked/resources/app.asar", app],
  ].map(([path, content]) => ({path, bytes: content.length, sha256: sha256(content)}));
  writeFileSync(join(root, "release-manifest.json"), `${JSON.stringify({schema_version: 1, files}, null, 2)}\n`);
  return root;
}

test("packaged runtime audit verifies notice pairing and release manifest", () => {
  const result = auditPackagedRuntime(packagedFixture());
  expect(result.failures).toEqual([]);
  expect(result.checks.every((check) => check.status === "passed")).toBe(true);
});

test("distribution audit covers direct packages and records release gates", () => {
  const audit = readDistributionAudit();
  const result = auditDistribution();
  expect(result.failures).toEqual([]);
  expect(audit.project.license).toBe("AGPL-3.0-only");
  expect(audit.direct_packages).toHaveLength(6);
  expect(audit.external_tools.map((tool) => tool.name)).toEqual(["fallow"]);
  expect(audit.release_gates.every((gate) => gate.status === "pending")).toBe(true);
});
