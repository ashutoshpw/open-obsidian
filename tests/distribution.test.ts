import {expect, test} from "bun:test";
import {auditDistribution, readDistributionAudit} from "../scripts/verify-distribution.js";

test("distribution audit covers direct packages and records release gates", () => {
  const audit = readDistributionAudit();
  const result = auditDistribution();
  expect(result.failures).toEqual([]);
  expect(audit.project.license).toBe("AGPL-3.0-only");
  expect(audit.direct_packages).toHaveLength(6);
  expect(audit.external_tools.map((tool) => tool.name)).toEqual(["fallow"]);
  expect(audit.release_gates.every((gate) => gate.status === "pending")).toBe(true);
});
