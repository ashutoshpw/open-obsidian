import {expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {runFinalAudit} from "../scripts/final-audit.js";

const root = new URL("..", import.meta.url);
const fixture = JSON.parse(readFileSync(new URL("fixtures/release-handoff.json", root), "utf8")) as {schema_version: number; phase_ids: string[]; handoffs: Array<{id: string; owner: string; prerequisites: string[]; verification: string[]; status: string}>; no_release_tag_created_by_goal: boolean};

test("final audit separates implementation readiness from external release readiness", () => {
  const audit = runFinalAudit("2026-09-10T00:00:00.000Z");
  expect(fixture.schema_version).toBe(1);
  expect(fixture.phase_ids).toHaveLength(19);
  expect(audit.failures).toEqual([]);
  expect(audit.repository.origin_matches).toBe(true);
  expect(audit.repository.branch).toBe("main");
  expect(audit.implementation_readiness.total_rows).toBe(196);
  expect(audit.implementation_readiness.implemented).toBe(119);
  expect(audit.implementation_readiness.mandatory_not_release_passing).toBe(161);
  expect(audit.release_readiness.release_ready).toBe(false);
  expect(audit.release_readiness.pending_mandatory_rows.length).toBe(161);
  expect(audit.release_readiness.external_pending_rows.length).toBe(6);
  expect(audit.phases).toHaveLength(19);
  expect(audit.phases.some((phase) => phase.id === "P6.2")).toBe(true);
  expect(fixture.handoffs.map((handoff) => handoff.id)).toEqual(expect.arrayContaining(["managed-service", "human-validation", "signed-artifacts", "publication", "reference-vault", "plugin-runtime", "updater-rollback"]));
  expect(fixture.handoffs.every((handoff) => handoff.owner && handoff.prerequisites.length > 0 && handoff.verification.length > 0 && handoff.status === "external-pending")).toBe(true);
  expect(fixture.no_release_tag_created_by_goal).toBe(true);
});
