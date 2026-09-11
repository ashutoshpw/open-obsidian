import {expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";

type PrivateFinding = {
  id: string;
  surface: string;
  reproduction: string;
  evidence: string[];
  owner: string;
  cost: {optimistic_days: number; likely_days: number; pessimistic_days: number};
  decision_id: string;
  compatibility_decision: string;
  status: string;
};

const root = resolve(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(root, "config/architecture-manifest.json"), "utf8")) as {private_internal_findings: PrivateFinding[]};

test("architecture records private-internal findings without overclaiming runtime certification", () => {
  const findings = manifest.private_internal_findings;
  expect(findings).toHaveLength(4);
  expect(new Set(findings.map((finding) => finding.id)).size).toBe(findings.length);
  expect(findings.every((finding) => finding.surface && finding.reproduction && finding.owner && finding.decision_id && finding.compatibility_decision)).toBe(true);
  expect(findings.every((finding) => finding.evidence.length > 0)).toBe(true);
  expect(findings.every((finding) => finding.status === "pending-runtime")).toBe(true);
  expect(findings.every((finding) => finding.cost.optimistic_days > 0 && finding.cost.likely_days >= finding.cost.optimistic_days && finding.cost.pessimistic_days >= finding.cost.likely_days)).toBe(true);
});
