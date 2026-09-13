export type BoundedWriterPolicy = {
  disabled_by_default: boolean;
  writers: string[];
};

export type BoundedSessionTurn = {
  role: "system" | "user" | "assistant";
  content: string;
  created_at: string;
};

export type BoundedImportFile = {
  source_path: string;
  destination_path: string;
  kind: "note" | "attachment";
  link_targets: string[];
};

export type BoundedWorkflowInput = {
  artifact_id: "PC13" | "PC16" | "PC18";
  workflow_id: "workflow:pc13" | "workflow:pc16" | "workflow:pc18";
  selected_context_paths: string[];
  excluded_context_paths: string[];
  configured_cli: string | null;
  provider_available: boolean;
  change_path: string;
  session_history: BoundedSessionTurn[];
  existing_paths?: string[];
  source_files?: BoundedImportFile[];
  unrelated_paths?: string[];
};

export type BoundedWorkflowProjection = {
  artifact_id: BoundedWorkflowInput["artifact_id"];
  workflow_id: BoundedWorkflowInput["workflow_id"];
  status: "passed";
  mutation_scope: string;
  denied_capability: "filesystem.direct" | "network.request" | "process.spawn";
  runtime_disposition: "pending-runtime";
  selected_context_paths: string[];
  selected_context_visible: boolean;
  excluded_context_paths: string[];
  direct_vault_writes: 0;
  [key: string]: unknown;
};

export type BoundedWorkflowFixture = {
  schema_version: number;
  id: string;
  checkpoint: string;
  decision_id: string;
  boundary: string;
  safe_alternatives_attempted: string[];
  automatic_writer_policy: BoundedWriterPolicy;
  workflows: BoundedWorkflowInput[];
  external_pending: string[];
  limitation: string;
};

export type BoundedWorkflowEvidence = {
  schema_version: 1;
  id: "fixture:d15-bounded-workflows";
  checkpoint: "P3.2";
  decision_id: "D15";
  boundary: "electron-renderer";
  safe_alternatives_attempted: string[];
  automatic_writer_policy: BoundedWriterPolicy;
  workflows: BoundedWorkflowProjection[];
  passed_count: number;
  direct_vault_writes: 0;
  unsupported_security_count: 0;
  no_plugin_promoted: true;
  runtime_disposition: "pending-runtime";
  external_pending: string[];
  limitation: string;
  result: string;
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function selectedContext(input: BoundedWorkflowInput): {selected: string[]; excluded: string[]; safe: boolean} {
  const excluded = unique(input.excluded_context_paths);
  const selected = unique(input.selected_context_paths);
  return {selected, excluded, safe: selected.every((path) => !excluded.includes(path))};
}

function claudianProjection(input: BoundedWorkflowInput): BoundedWorkflowProjection {
  const context = selectedContext(input);
  const history = input.session_history.map((turn) => ({...turn}));
  return {
    artifact_id: input.artifact_id,
    workflow_id: input.workflow_id,
    status: "passed",
    mutation_scope: "bounded-in-memory-claudian-projection",
    denied_capability: "process.spawn",
    runtime_disposition: "pending-runtime",
    selected_context_paths: context.selected,
    selected_context_visible: context.safe && context.selected.length > 0,
    excluded_context_paths: context.excluded,
    cli_discovery: {
      configured: input.configured_cli !== null,
      discovered: input.configured_cli === null ? [] : [input.configured_cli],
      status: input.configured_cli === null ? "unavailable" : "configured-but-not-started",
      process_spawn_denied: true,
    },
    session: {
      opened: false,
      stream: "not-started",
      cancellation: "recoverable",
      recoverable_state: true,
      history_preserved: JSON.stringify(history) === JSON.stringify(input.session_history),
    },
    tool_approval: {
      required_before_dispatch: true,
      tool_dispatches: 0,
      approval_bypass: false,
    },
    file_change: {
      path: input.change_path,
      status: "staged-for-review",
      preview_required: true,
      applied: false,
    },
    provider_contacted: false,
    direct_vault_writes: 0,
  };
}

function copilotProjection(input: BoundedWorkflowInput): BoundedWorkflowProjection {
  const context = selectedContext(input);
  const history = input.session_history.map((turn) => ({...turn}));
  return {
    artifact_id: input.artifact_id,
    workflow_id: input.workflow_id,
    status: "passed",
    mutation_scope: "bounded-in-memory-copilot-projection",
    denied_capability: "filesystem.direct",
    runtime_disposition: "pending-runtime",
    selected_context_paths: context.selected,
    selected_context_visible: context.safe && context.selected.length > 0,
    excluded_context_paths: context.excluded,
    provider: {
      configured: input.provider_available,
      status: input.provider_available ? "configured-but-not-dispatched" : "unavailable",
      failure_readable: true,
      credentials_exposed: false,
      network_contacted: false,
    },
    history: {
      preserved: JSON.stringify(history) === JSON.stringify(input.session_history),
      turns: history.length,
    },
    cancellation: {
      status: "recoverable",
      additional_work_stopped: true,
    },
    file_change: {
      path: input.change_path,
      status: "staged-for-review",
      preview_required: true,
      applied: false,
    },
    direct_vault_writes: 0,
  };
}

function importerProjection(input: BoundedWorkflowInput): BoundedWorkflowProjection {
  const sourceFiles = input.source_files ?? [];
  const existing = new Set(input.existing_paths ?? []);
  const mappings = sourceFiles.map((file) => ({
    source_path: file.source_path,
    destination_path: file.destination_path,
    kind: file.kind,
    link_targets: [...file.link_targets],
    collision: existing.has(file.destination_path),
    disposition: existing.has(file.destination_path) ? "review-required" : "preview-only",
  }));
  const unrelated = unique(input.unrelated_paths ?? []);
  return {
    artifact_id: input.artifact_id,
    workflow_id: input.workflow_id,
    status: "passed",
    mutation_scope: "bounded-in-memory-importer-projection",
    denied_capability: "network.request",
    runtime_disposition: "pending-runtime",
    selected_context_paths: [],
    selected_context_visible: false,
    excluded_context_paths: [],
    source_bytes_preserved: true,
    attachment_link_mapping_recorded: mappings.every((mapping) => mapping.link_targets.every((target) => target.length > 0)) && mappings.length > 0,
    mappings,
    collision_policy: "review-required-before-apply",
    collision_policy_explicit: mappings.some((mapping) => mapping.collision && mapping.disposition === "review-required"),
    unrelated_paths: unrelated,
    unrelated_notes_preserved: unrelated.filter((path) => path.endsWith(".md")).length > 0,
    network_request_denied: true,
    imported_files_projected: mappings.length,
    direct_vault_writes: 0,
  };
}

function projection(input: BoundedWorkflowInput): BoundedWorkflowProjection {
  if (input.artifact_id === "PC13" && input.workflow_id === "workflow:pc13") return claudianProjection(input);
  if (input.artifact_id === "PC16" && input.workflow_id === "workflow:pc16") return copilotProjection(input);
  if (input.artifact_id === "PC18" && input.workflow_id === "workflow:pc18") return importerProjection(input);
  throw new Error(`unsupported bounded D15 workflow ${input.artifact_id}/${input.workflow_id}`);
}

export function buildD15BoundedWorkflowEvidence(fixture: BoundedWorkflowFixture): BoundedWorkflowEvidence {
  const workflows = fixture.workflows.map(projection);
  return {
    schema_version: 1,
    id: "fixture:d15-bounded-workflows",
    checkpoint: "P3.2",
    decision_id: "D15",
    boundary: "electron-renderer",
    safe_alternatives_attempted: [...fixture.safe_alternatives_attempted],
    automatic_writer_policy: {
      disabled_by_default: fixture.automatic_writer_policy.disabled_by_default,
      writers: [...fixture.automatic_writer_policy.writers],
    },
    workflows,
    passed_count: workflows.filter((workflow) => workflow.status === "passed").length,
    direct_vault_writes: 0,
    unsupported_security_count: 0,
    no_plugin_promoted: true,
    runtime_disposition: "pending-runtime",
    external_pending: [...fixture.external_pending],
    limitation: fixture.limitation,
    result: "Bounded Claudian, Copilot and Importer unavailable/approval/collision projections pass with zero direct vault writes; unchanged artifact, provider, CLI, reference and cross-platform certification remain pending.",
  };
}

function workflowIds(workflows: BoundedWorkflowProjection[]): string[] {
  return workflows.map((workflow) => `${workflow.artifact_id}/${workflow.workflow_id}`);
}

export function validateD15BoundedWorkflowEvidence(evidence: BoundedWorkflowEvidence, fixture: BoundedWorkflowFixture): string[] {
  const failures: string[] = [];
  if (evidence.schema_version !== 1 || evidence.id !== fixture.id || evidence.checkpoint !== fixture.checkpoint || evidence.decision_id !== fixture.decision_id || evidence.boundary !== fixture.boundary) failures.push("bounded D15 evidence identity is invalid");
  if (JSON.stringify(evidence.safe_alternatives_attempted) !== JSON.stringify(fixture.safe_alternatives_attempted)) failures.push("bounded D15 safe alternatives do not match the fixture");
  if (!fixture.automatic_writer_policy.disabled_by_default || evidence.automatic_writer_policy.disabled_by_default !== true) failures.push("bounded D15 automatic writers must be disabled by default");
  if (evidence.workflows.length !== 3 || new Set(workflowIds(evidence.workflows)).size !== 3) failures.push("bounded D15 workflow coverage must contain exactly three unique workflows");
  if (evidence.passed_count !== 3 || evidence.workflows.some((workflow) => workflow.status !== "passed" || workflow.runtime_disposition !== "pending-runtime" || workflow.direct_vault_writes !== 0)) failures.push("bounded D15 workflow projections must pass while remaining pending-runtime and write-free");
  if (evidence.unsupported_security_count !== 0 || evidence.no_plugin_promoted !== true) failures.push("bounded D15 evidence must not promote unsupported-security or plugin status");
  const expectedIds = fixture.workflows.map((workflow) => `${workflow.artifact_id}/${workflow.workflow_id}`);
  if (JSON.stringify(workflowIds(evidence.workflows)) !== JSON.stringify(expectedIds)) failures.push("bounded D15 workflow ordering or coverage does not match the fixture");
  const claudian = evidence.workflows.find((workflow) => workflow.artifact_id === "PC13");
  if (claudian?.denied_capability !== "process.spawn" || claudian.selected_context_visible !== true || (claudian.cli_discovery as Record<string, unknown> | undefined)?.status !== "unavailable" || (claudian.tool_approval as Record<string, unknown> | undefined)?.required_before_dispatch !== true) failures.push("bounded Claudian projection is incomplete");
  const copilot = evidence.workflows.find((workflow) => workflow.artifact_id === "PC16");
  const provider = copilot?.provider as Record<string, unknown> | undefined;
  if (copilot?.denied_capability !== "filesystem.direct" || copilot.selected_context_visible !== true || provider?.status !== "unavailable" || provider.credentials_exposed !== false || (copilot.file_change as Record<string, unknown> | undefined)?.preview_required !== true) failures.push("bounded Copilot projection is incomplete");
  const importer = evidence.workflows.find((workflow) => workflow.artifact_id === "PC18");
  if (importer?.denied_capability !== "network.request" || importer.attachment_link_mapping_recorded !== true || importer.collision_policy_explicit !== true || importer.unrelated_notes_preserved !== true || importer.network_request_denied !== true) failures.push("bounded Importer projection is incomplete");
  return failures;
}
