import {expect, test} from "bun:test";
import {auditVersionBaseline, readVersionBaseline} from "../scripts/verify-version-baseline.js";

test("version baseline keeps stable and early-access tracks explicit", () => {
  const document = readVersionBaseline();
  expect(document.schemaVersion).toBe(1);
  expect(document.stableBaseline).toEqual({product: "Obsidian Desktop", version: "1.13.7", releaseStatus: "public"});
  expect(document.earlyAccessTrack).toEqual({product: "Obsidian Desktop", version: "1.14.1", releaseStatus: "early_access"});
  expect(document.policy.pluginFixtureMayAdvanceStable).toBe(false);
  expect(document.records).toHaveLength(27);
});

test("version baseline audit records manifest limits without claiming runtime compatibility", () => {
  const result = auditVersionBaseline();
  expect(result.failures).toEqual([]);
  expect(result.artifactCount).toBe(27);
  expect(result.apiUnestablishedCount).toBe(27);
  expect(result.runtimePendingCount).toBe(27);
  expect(result.checks.find((check) => check.id === "runtime-certification")?.status).toBe("pending");
  expect(result.checks.find((check) => check.id === "stable-baseline-guard")?.status).toBe("passed");
});

test("minimum app version selects the separate track only when required", () => {
  const document = readVersionBaseline();
  expect(document.records.find((record) => record.artifactId === "PC01")?.requiredTrack).toBe("stable");
  expect(document.records.find((record) => record.artifactId === "PC06")?.requiredTrack).toBe("undetermined");
  expect(document.records.find((record) => record.artifactId === "PC-DEP-MINIMAL")?.requiredTrack).toBe("early-access");
});
