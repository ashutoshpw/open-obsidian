import {expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {buildPluginCombinationAudit} from "../scripts/audit-plugin-combinations.js";

type CombinationAuditFixture = {
  schema_version: number;
  id: string;
  checkpoint: string;
  decision_id: string;
  boundary: string;
  catalog_path: string;
  lifecycle_evidence_path: string;
  d15_evidence_path: string;
  bounded_loaded_evidence_path: string;
  safe_alternatives_attempted: string[];
  bounded_evidence: Array<{catalog_id: string; source_combination_id: string; expected_status: string}>;
};

type Catalog = {combinations: Array<{id: string; members: string[]; status: string}>};

const root = resolve(import.meta.dir, "..");
const fixture = JSON.parse(readFileSync(join(root, "fixtures/plugin-combination-audit.json"), "utf8")) as CombinationAuditFixture;
const catalog = JSON.parse(readFileSync(join(root, "fixtures/plugin-catalog.json"), "utf8")) as Catalog;
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {scripts?: Record<string, string>};
const quickChecks = readFileSync(join(root, "scripts/check-fast.ts"), "utf8");
const qualityWorkflow = readFileSync(join(root, ".github/workflows/quality.yml"), "utf8");

test("catalog combination audit fixture keeps source and pending boundaries explicit", () => {
  expect(fixture.schema_version).toBe(1);
  expect(fixture.id).toBe("fixture:plugin-combination-audit");
  expect(fixture.checkpoint).toBe("P3.2");
  expect(fixture.decision_id).toBe("D15");
  expect(fixture.boundary).toBe("electron-renderer");
  expect(fixture.catalog_path).toBe("fixtures/plugin-catalog.json");
  expect(fixture.lifecycle_evidence_path).toContain("plugin-artifact-lifecycle-v2.json");
  expect(fixture.d15_evidence_path).toContain("plugin-d15-workflow.json");
  expect(fixture.bounded_loaded_evidence_path).toContain("required-combinations.json");
  expect(fixture.safe_alternatives_attempted).toEqual(["mediated vault read", "preview broker", "workflow disabled"]);
  expect(fixture.bounded_evidence).toEqual([
    expect.objectContaining({catalog_id: "combo-minimal-style-settings", source_combination_id: "combination:pc08-pc17-minimal", expected_status: "passed"}),
    expect.objectContaining({catalog_id: "combo-tasknotes-bases", source_combination_id: "combination:pc19-bases", expected_status: "passed"}),
  ]);
  expect(packageJson.scripts?.["audit:plugin-combinations"]).toBe("bun scripts/audit-plugin-combinations.ts");
  expect(quickChecks).toContain('{id: "plugin-combinations", args: ["run", "audit:plugin-combinations"]}');
  expect(qualityWorkflow).toContain("Reconcile catalog-required plugin combinations");
  expect(qualityWorkflow).toContain("bun run audit:plugin-combinations");
});

test("audit derives all seven catalog combinations and keeps every disposition pending", () => {
  const evidence = buildPluginCombinationAudit();
  expect(evidence.catalog_combination_ids).toEqual(catalog.combinations.map((combination) => combination.id));
  expect(evidence.combination_count).toBe(7);
  expect(evidence.combinations).toHaveLength(7);
  expect(evidence.candidate_denial_count).toBe(7);
  expect(evidence.candidate_pending_count).toBe(0);
  expect(evidence.unsupported_security_count).toBe(0);
  expect(evidence.all_catalog_combinations_covered).toBe(true);
  expect(evidence.all_runtime_dispositions_pending).toBe(true);
  expect(evidence.no_plugin_promoted).toBe(true);
  expect(evidence.combinations.every((combination) => combination.disposition === "candidate-denial")).toBe(true);
  expect(evidence.combinations.every((combination) => combination.runtime_disposition === "pending-runtime")).toBe(true);
  expect(evidence.combinations.every((combination) => combination.no_plugin_promoted && !combination.unsupported_security)).toBe(true);
});

test("denied combinations retain D15 alternatives, disabled paths and visible matrix cells", () => {
  const evidence = buildPluginCombinationAudit();
  for (const combination of evidence.combinations) {
    expect(combination.denied_components.length).toBeGreaterThan(0);
    expect(combination.denied_capabilities.length).toBeGreaterThan(0);
    expect(combination.safe_alternatives_attempted).toEqual(["mediated vault read", "preview broker", "workflow disabled"]);
    expect(combination.disabled_path_checks.map((check) => check.capability).sort()).toEqual([...combination.denied_capabilities].sort());
    expect(combination.disabled_path_checks.every((check) => check.status === "passed" && check.marker_capability === check.capability)).toBe(true);
    expect(combination.visible_pending_matrix_entries.length).toBe(combination.members.length * 3);
    expect(combination.visible_pending_matrix_entries.every((entry) => entry.visible && entry.disposition === "pending-runtime")).toBe(true);
  }
});

test("existing bounded Minimal and Bases traces remain visible without promotion", () => {
  const evidence = buildPluginCombinationAudit();
  const minimal = evidence.combinations.find((combination) => combination.id === "combo-minimal-style-settings");
  const tasknotes = evidence.combinations.find((combination) => combination.id === "combo-tasknotes-bases");
  expect(minimal?.bounded_evidence).toMatchObject({
    status: "passed",
    source_combination_id: "combination:pc08-pc17-minimal",
    bounded_lifecycle: "complete",
    persistence: "preserved",
    action_status: "passed",
    dependency_status: "verified",
    dependency_artifact_id: "PC-DEP-MINIMAL",
    vault_writes: 0,
  });
  expect(tasknotes?.bounded_evidence).toMatchObject({
    status: "passed",
    source_combination_id: "combination:pc19-bases",
    bounded_lifecycle: "complete",
    persistence: "preserved",
    action_status: "passed",
    dependency_status: "verified",
    dependency_fixture_id: "fixture:baseline:bases",
    vault_writes: 0,
  });
  expect(minimal?.disposition).toBe("candidate-denial");
  expect(tasknotes?.disposition).toBe("candidate-denial");
  expect(evidence.bounded_pass_count).toBe(2);
  expect(evidence.result).toContain("no compatibility status or unsupported-security exception was promoted");
});
