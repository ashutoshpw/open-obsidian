import {expect, test} from "bun:test";
import {runQualityProgram} from "../scripts/quality-program.js";

test("quality program records local fidelity, latency, grounding and external dispositions", () => {
  const report = runQualityProgram();

  expect(report.schema_version).toBe(1);
  expect(report.scorecard.profiles).toEqual(["stock-obsidian", "plugin-equipped-obsidian", "openobsidian"]);
  expect(report.scorecard.corpus_profiles).toHaveLength(6);
  expect(report.no_op_fidelity.passed).toBe(true);
  expect(report.no_op_fidelity.before).toBe(report.no_op_fidelity.after);
  expect(report.search.runs).toBe(25);
  expect(report.search.passed).toBe(true);
  expect(report.grounding).toMatchObject({supported_claims: 1, excluded_file_disclosures: 0, cross_vault_disclosures: 0, prompt_injection_actions: 0, passed: true});
  expect(report.privacy).toMatchObject({private_vault_upload: false, note_content_telemetry: false, provider_secret_telemetry: false, diagnostics_destination: "local-export-only"});
  expect(report.layer_dispositions.find((layer) => layer.id === "accessibility-and-screen-reader")?.status).toBe("external-pending");
  expect(report.attempts.some((attempt) => attempt.status === "external-pending")).toBe(true);
});
