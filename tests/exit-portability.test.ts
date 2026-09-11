import {expect, test} from "bun:test";
import {runExitPortabilityAudit} from "../scripts/audit-exit-portability.js";

test("C14 local portability audit keeps Markdown, Canvas and conversation output portable", () => {
  const report = runExitPortabilityAudit("2026-09-11T00:00:03.000Z");
  expect(report.fixture_id).toBe("fixture:c14-exit-portability");
  expect(report.local.status).toBe("passed");
  expect(report.local.checks).toEqual({markdown_reopened: true, canvas_reopened: true, conversation_exported: true, vault_contains_only_portable_outputs: true, app_database_required: false});
  expect(report.local.exported_conversation).toEqual({schema_version: 1, providerMode: "none", model: null, turns: 2});
  expect(report.reference.status).toBe("external-pending");
  expect(report.release_eligible).toBe(false);
});
