import {expect, test} from "bun:test";
import {buildD15Evidence} from "../scripts/validate-plugin-d15.js";

test("D15 workflow evidence covers every renderer-denied candidate without promotion", () => {
  const evidence = buildD15Evidence();
  expect(evidence.id).toBe("fixture:d15-exception-contract");
  expect(evidence.candidate_count).toBe(23);
  expect(evidence.workflow_records).toHaveLength(23);
  expect(evidence.disabled_path_checks).toHaveLength(7);
  expect(evidence.unsupported_security_count).toBe(0);
  expect(evidence.all_runtime_dispositions_pending).toBe(true);
  expect(evidence.recovery_test_count).toBe(evidence.workflow_records.length);
  expect(evidence.all_recovery_tests_passed).toBe(true);
  expect(evidence.workflow_records.every((record) => record.disposition === "candidate-denial")).toBe(true);
  expect(evidence.workflow_records.every((record) => record.runtime_disposition === "pending-runtime")).toBe(true);
  expect(evidence.workflow_records.every((record) => record.visible_compatibility_entry.visible && record.visible_compatibility_entry.status === "pending-runtime")).toBe(true);
  expect(evidence.workflow_records.every((record) => record.disabled_path_test.status === "passed" && record.disabled_path_test.artifact_execution === "not-executed")).toBe(true);
  expect(evidence.workflow_records.every((record) => record.recovery_test.status === "passed" && record.recovery_test.registrations_cleared && !record.recovery_test.active_plugin_after_recovery && record.recovery_test.return_to_obsidian && record.recovery_test.direct_vault_writes === 0)).toBe(true);
});

test("bounded D15 projections keep Claudian, Copilot and Importer fail-closed", () => {
  const evidence = buildD15Evidence().bounded_workflow_projections;
  expect(evidence).toMatchObject({
    id: "fixture:d15-bounded-workflows",
    passed_count: 3,
    direct_vault_writes: 0,
    unsupported_security_count: 0,
    no_plugin_promoted: true,
    runtime_disposition: "pending-runtime",
  });
  expect(evidence.workflows.map((workflow) => workflow.artifact_id)).toEqual(["PC13", "PC16", "PC18"]);

  const claudian = evidence.workflows[0]!;
  expect(claudian).toMatchObject({
    denied_capability: "process.spawn",
    selected_context_visible: true,
    direct_vault_writes: 0,
    cli_discovery: {status: "unavailable", process_spawn_denied: true},
    tool_approval: {required_before_dispatch: true, tool_dispatches: 0, approval_bypass: false},
    file_change: {preview_required: true, applied: false},
  });

  const copilot = evidence.workflows[1]!;
  expect(copilot).toMatchObject({
    denied_capability: "filesystem.direct",
    selected_context_visible: true,
    provider: {status: "unavailable", failure_readable: true, credentials_exposed: false, network_contacted: false},
    history: {preserved: true},
    cancellation: {status: "recoverable", additional_work_stopped: true},
    file_change: {preview_required: true, applied: false},
  });

  const importer = evidence.workflows[2]!;
  expect(importer).toMatchObject({
    denied_capability: "network.request",
    attachment_link_mapping_recorded: true,
    collision_policy_explicit: true,
    collision_policy: "review-required-before-apply",
    unrelated_notes_preserved: true,
    network_request_denied: true,
    imported_files_projected: 3,
    direct_vault_writes: 0,
  });
  expect((importer.mappings as Array<{destination_path: string; disposition: string}>).find((mapping) => mapping.destination_path === "Notes/Existing.md")).toMatchObject({disposition: "review-required"});
});
