import {createHash} from "node:crypto";
import {execFileSync, spawnSync} from "node:child_process";
import {lstat, mkdir, readFile, readdir, readlink, realpath, rename, rm, unlink, writeFile} from "node:fs/promises";
import {createWriteStream} from "node:fs";
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {spawn, type ChildProcess} from "node:child_process";
import {isDeepStrictEqual} from "node:util";

type CdpTarget = {
  id?: string;
  type?: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};

type CdpResponse = {
  id?: number;
  result?: Record<string, unknown>;
  error?: {message?: string};
};

type CdpRemoteObject = {
  type?: string;
  subtype?: string;
  className?: string;
  description?: string;
  value?: unknown;
  unserializableValue?: string;
  objectId?: string;
  preview?: unknown;
};

type CdpExceptionDetails = {
  exceptionId?: number;
  text?: string;
  lineNumber?: number;
  columnNumber?: number;
  scriptId?: string;
  url?: string;
  exception?: CdpRemoteObject;
  stackTrace?: {
    description?: string;
    callFrames?: Array<{
      functionName?: string;
      scriptId?: string;
      url?: string;
      lineNumber?: number;
      columnNumber?: number;
    }>;
  };
};

function summarizeCdpRemoteObject(remote: CdpRemoteObject | undefined): Record<string, unknown> | null {
  if (!remote) return null;
  const primitiveValue = remote.value === null || ["string", "number", "boolean"].includes(typeof remote.value)
    ? remote.value
    : undefined;
  let valuePreview: string | undefined;
  if (remote.value !== undefined && primitiveValue === undefined) {
    try {
      valuePreview = JSON.stringify(remote.value)?.slice(0, 4_000);
    } catch {
      valuePreview = String(remote.value).slice(0, 4_000);
    }
  }
  return {
    type: remote.type,
    subtype: remote.subtype,
    className: remote.className,
    description: remote.description,
    value: primitiveValue,
    value_preview: valuePreview,
    unserializableValue: remote.unserializableValue,
    objectId: remote.objectId,
    preview: remote.preview,
  };
}

function runtimeEvaluationDiagnostics(response: CdpResponse): Record<string, unknown> {
  const result = response.result?.result as CdpRemoteObject | undefined;
  const details = response.result?.exceptionDetails as CdpExceptionDetails | undefined;
  return {
    remote_object: summarizeCdpRemoteObject(result),
    exception_details: details ? {
      exceptionId: details.exceptionId,
      text: details.text,
      lineNumber: details.lineNumber,
      columnNumber: details.columnNumber,
      scriptId: details.scriptId,
      url: details.url,
      exception: summarizeCdpRemoteObject(details.exception),
      stackTrace: details.stackTrace ? {
        description: details.stackTrace.description,
        callFrames: (details.stackTrace.callFrames ?? []).map((frame) => ({
          functionName: frame.functionName,
          scriptId: frame.scriptId,
          url: frame.url,
          lineNumber: frame.lineNumber,
          columnNumber: frame.columnNumber,
        })),
      } : undefined,
    } : null,
  };
}

type SnapshotEntry = {
  path: string;
  kind: "file" | "directory" | "symlink" | "other";
  bytes?: number;
  sha256?: string;
  target?: string;
  target_bytes_base64?: string;
  target_sha256?: string;
};

type GroupOrderScenario = {
  id: string;
  base_path: string;
  source_format: "json" | "native-yaml";
  layout: "table" | "kanban";
  group_by_property?: string;
  coverage: string[];
  expected_error_outcome?: "visible-error";
  expected_error_text?: string;
  source: string | Record<string, unknown>;
};

type GroupOrderFixture = {
  schema_version: number;
  id: string;
  description: string;
  notes: Array<{path: string; source: string}>;
  scenarios: GroupOrderScenario[];
};

type GroupOrderSourceHash = {bytes: number; sha256: string};

type GroupOrderMinimalRendererState = {
  requested_file_path: string;
  active_file_path: string | null;
  active_view_type: string | null;
  title: string;
  body: string;
  view_access_error?: string;
};

type GroupOrderScenarioFixture = {
  vault_root: string;
  source_files: Record<string, Buffer>;
  source_hashes: Record<string, GroupOrderSourceHash>;
  fixture_paths: string[];
  seed_artifacts: Record<string, string>;
};

type GroupOrderGroupObservation = {
  index: number;
  heading_text: string;
  heading_class_name: string;
  heading_bounds: {top: number; left: number};
  heading_visibility_sample: GroupOrderScrollEvidence;
  member_paths: string[];
};

type GroupOrderScrollPosition = {
  class_name: string;
  scroll_top: number;
  scroll_left: number;
  scroll_height: number;
  client_height: number;
  scroll_width: number;
  client_width: number;
};

type GroupOrderScrollEvidence = {
  visibility_sample_sequence: number;
  visibility_sample_bounds: {top: number; left: number; width: number; height: number};
  scroll_positions: GroupOrderScrollPosition[];
};

type GroupOrderResultCountEvidence = {
  text: string;
  tag: string;
  class_name: string;
  bounds: {top: number; left: number; width: number; height: number};
  scope: "selected-table-shell" | "selected-table-container" | "active-kanban-container";
  selected_result_root: {tag: string; class_name: string; contained_visible_table_count: number | null; bounds: {top: number; left: number; width: number; height: number}};
  nearest_table_shell: {tag: string; class_name: string} | null;
  shared_container: {tag: string; class_name: string} | null;
};

type GroupOrderViewportPreparation = {
  left_sidebar_collapsed: boolean;
  requested_width: number;
  requested_height: number;
  actual_width: number;
  actual_height: number;
  actual_outer_width: number;
  actual_outer_height: number;
};

type GroupOrderUnmappedPathCandidate = {
  candidate: string;
  text: string;
  class_name: string;
  source_scope: string;
  fixture_path_matches?: string[];
  top: number;
  left: number;
  visibility_sample_sequence: number;
  visibility_sample_bounds: GroupOrderScrollEvidence["visibility_sample_bounds"];
  scroll_positions: GroupOrderScrollPosition[];
};

type GroupOrderUnmappedRowCandidate = {
  text: string;
  fixture_path_matches: string[];
  class_name: string;
  tag: string;
  top: number;
  left: number;
  visibility_sample_sequence: number;
  visibility_sample_bounds: GroupOrderScrollEvidence["visibility_sample_bounds"];
  scroll_positions: GroupOrderScrollPosition[];
};

type GroupOrderPreSweepRowResolution = GroupOrderUnmappedRowCandidate & {
  resolution: "resolved-by-complete-fresh-sweep" | "unresolved";
  matched_path: string | null;
  fresh_sweep_observation_count: number;
  group_keys: string[];
  resolution_reasons: string[];
};

type GroupOrderMappedRowPathCandidate = {
  path: string;
  text: string;
  class_name: string;
  tag: string;
  top: number;
  left: number;
};

type GroupOrderFreshSweepOffset = {
  container_class: string;
  axis: "current" | "vertical" | "horizontal";
  requested_offset: number | null;
  scroll_positions: GroupOrderScrollPosition[];
  path_samples: number;
  unique_path_count: number;
  unique_paths: string[];
  heading_samples: number;
  unmapped_path_samples: number;
  unmapped_row_samples: number;
  ordered_paths: string[];
  ordered_headings: string[];
  structural_heading_observations: Array<{
    key: string;
    base_identity: string;
    occurrence: number;
    occurrence_count: number;
    tag: string;
    class_name: string;
    label: string;
    painted: boolean;
    table_section_root_tag: string | null;
    table_section_root_class_name: string;
    logical_position: Record<string, unknown> | null;
  }>;
  outside_selected_root_group_markers: Array<{
    tag: string;
    class_name: string;
    text: string;
    shared_ancestor_tag: string | null;
    shared_ancestor_class_name: string;
  }>;
  result_group_assignments: Array<{
    path: string;
    group_key: string | null;
    column_ordinal: number | null;
    local_dom_ordinal: number;
    visibility_sample_sequence: number;
    scroll_positions: GroupOrderScrollPosition[];
    title_hit_diagnostics?: Record<string, unknown>;
  }>;
  mapped_row_path_candidates: GroupOrderMappedRowPathCandidate[];
  unmapped_rows: GroupOrderUnmappedRowCandidate[];
};

type GroupOrderVisibleState = {
  requested_file_path: string;
  selection_succeeded: boolean;
  active_file_path: string | null;
  active_view_type: string | null;
  title: string;
  body: string;
  result_count: number | null;
  result_count_texts: string[];
  result_count_evidence: GroupOrderResultCountEvidence[];
  kanban_rendered_count_evidence: Array<Record<string, unknown>>;
  zero_result_outcome_classification: "empty-group-order-list" | "yaml-binary-candidate-observation" | null;
  viewport: {width: number; height: number; available_width: number; available_height: number};
  visibility_sampling: {
    scroll_actions: number;
    path_candidates: number;
    painted_path_candidates: number;
    group_markers: number;
    painted_group_markers: number;
    data_rows: number;
    painted_data_rows: number;
    fresh_sweep_positions: number;
    fresh_sweep_coverage_complete: boolean;
    fresh_sweep_path_samples: number;
    fresh_sweep_unique_paths: string[];
    fresh_sweep_ordered_paths: string[];
    fresh_sweep_result_membership: Array<{
      path: string;
      result_order_ordinal: number;
      group_keys: string[];
      column_ordinal: number | null;
      observation_count: number;
    }>;
    fresh_sweep_result_count_matches: boolean | null;
    fresh_sweep_heading_samples: number;
    fresh_sweep_unique_headings: string[];
    fresh_sweep_ordered_headings: string[];
    fresh_sweep_heading_identity_ambiguous: boolean;
    fresh_sweep_heading_collision_base_count: number;
    fresh_sweep_heading_identity_collisions: Array<Record<string, unknown>>;
    fresh_sweep_unmapped_path_samples: number;
    fresh_sweep_unmapped_row_samples: number;
    fresh_sweep_unmapped_rows: GroupOrderUnmappedRowCandidate[];
    fresh_sweep_unmapped_candidates: GroupOrderUnmappedPathCandidate[];
    fresh_sweep_unowned_result_samples: number;
    fresh_sweep_unowned_result_observations: Array<Record<string, unknown>>;
    fresh_sweep_unresolved_group_owner_paths: string[];
    fresh_sweep_resolved_table_sections: Array<Record<string, unknown>>;
    fresh_sweep_table_section_observations: Array<Record<string, unknown>>;
    fresh_sweep_table_section_accepted_reconciliation_evidence: Array<Record<string, unknown>>;
    fresh_sweep_table_section_accepted_reconciliation_evidence_truncated: boolean;
    fresh_sweep_table_section_reconciliation_evidence: Array<Record<string, unknown>>;
    fresh_sweep_table_section_snapshot_orders: Array<Record<string, unknown>>;
    fresh_sweep_table_section_reconciliation_ambiguous: boolean;
    fresh_sweep_dom_object_id_scope: "one-visible-state-page-evaluation" | "not-captured";
    fresh_sweep_unpainted_table_section_keys: string[];
    fresh_sweep_duplicate_path_samples: number;
    fresh_sweep_ordering_ambiguous: boolean;
    fresh_sweep_group_ownership_ambiguous: boolean;
    fresh_sweep_painted_kanban_column_ordinals: number[];
    fresh_sweep_scroll_offsets: GroupOrderFreshSweepOffset[];
    node_identity_change_count: number;
    blocking_node_identity_change_count: number;
    node_identity_change_examples: Array<{kind: string; before: string; after: string; class_name: string}>;
    blocking_node_identity_change_examples: Array<{kind: string; before: string; after: string; class_name: string}>;
  };
  pre_sweep_unmapped_visible_row_candidates: GroupOrderUnmappedRowCandidate[];
  pre_sweep_row_reconciliation: {
    fresh_sweep_evidence_eligible: boolean;
    resolved_candidates: GroupOrderPreSweepRowResolution[];
    unresolved_candidates: GroupOrderPreSweepRowResolution[];
  };
  groups: GroupOrderGroupObservation[];
  ungrouped_visible_file_paths: string[];
  unassigned_visible_file_paths: string[];
  visible_fixture_path_links: Array<{
    path: string;
    text: string;
    class_name: string;
    source_scope: string;
    top: number;
    left: number;
    visibility_sample_sequence: number;
    visibility_sample_bounds: GroupOrderScrollEvidence["visibility_sample_bounds"];
    scroll_positions: GroupOrderScrollPosition[];
    result_order_ordinal: number;
    group_heading: string | null;
    group_keys: string[];
    column_ordinal: number | null;
    fresh_sweep_observation_count: number;
    title_hit_diagnostics?: Record<string, unknown>;
  }>;
  mapped_visible_row_path_candidates: GroupOrderMappedRowPathCandidate[];
  unmapped_visible_path_candidates: GroupOrderUnmappedPathCandidate[];
  unmapped_visible_row_candidates: GroupOrderUnmappedRowCandidate[];
  visible_group_marker_count: number;
  unmapped_group_marker_count: number;
  occluded_kanban_dom_candidates: Array<{
    kind: "group-heading" | "card";
    text: string;
    class_name: string;
    top: number;
    left: number;
    title_diagnostics?: Record<string, unknown>;
  }>;
  visible_error_texts: string[];
  notices: string[];
  explicit_error_surface: boolean;
  error_surface_scope: "active-view" | "requested-file-matched-notice" | "none";
  dom_diagnostics: Array<{tag: string; class_name: string; role: string | null; text: string; top: number; left: number; painted?: boolean}>;
  extraction_ambiguous: boolean;
  ambiguity_reasons: string[];
};

type GroupOrderScenarioObservation = GroupOrderVisibleState & {
  stage: "first-open" | "reopen";
  target_selection_mode: "active-target-reused" | "visible-tree-selected";
  ordered_group_headings: string[];
  error_surface_classification: "loaded-bases-view" | "loaded-bases-view-with-visible-error" | "non-bases-view-with-visible-error" | "non-bases-view-without-visible-error";
  state_settled: boolean;
  viewport_preparation: GroupOrderViewportPreparation | null;
  state_samples: Array<{
    active_file_path: string | null;
    active_view_type: string | null;
    selection_succeeded: boolean;
    body: string;
    result_count: number | null;
    result_count_texts: string[];
    result_count_evidence: GroupOrderResultCountEvidence[];
    kanban_rendered_count_evidence: Array<Record<string, unknown>>;
    zero_result_outcome_classification: GroupOrderVisibleState["zero_result_outcome_classification"];
    viewport: {width: number; height: number; available_width: number; available_height: number};
    visibility_sampling: GroupOrderVisibleState["visibility_sampling"];
    viewport_preparation: GroupOrderViewportPreparation | null;
    groups: GroupOrderGroupObservation[];
    ungrouped_visible_file_paths: string[];
    unassigned_visible_file_paths: string[];
    mapped_visible_row_path_candidates: GroupOrderVisibleState["mapped_visible_row_path_candidates"];
    unmapped_visible_path_candidates: GroupOrderVisibleState["unmapped_visible_path_candidates"];
    unmapped_visible_row_candidates: GroupOrderVisibleState["unmapped_visible_row_candidates"];
    occluded_kanban_dom_candidates: GroupOrderVisibleState["occluded_kanban_dom_candidates"];
    visible_error_texts: string[];
    notices: string[];
    explicit_error_surface: boolean;
    error_surface_scope: GroupOrderVisibleState["error_surface_scope"];
  }>;
  screenshot: string | null;
  screenshot_error?: string;
  probe_error?: string;
  probe_phase?: string;
  probe_retry_error?: string;
  minimal_renderer_state?: GroupOrderMinimalRendererState;
  minimal_renderer_state_error?: string;
};

const reportDirectory = resolve(requiredEnv("OBSIDIAN_REPORT_DIRECTORY"));
const workDirectory = resolve(requiredEnv("OBSIDIAN_ROUNDTRIP_WORK_DIRECTORY"));
const vaultRoot = join(workDirectory, "C01.2 Roundtrip Fixture");
const canvasVaultName = "C06 Canvas Reference Fixture";
const canvasVaultRoot = join(workDirectory, canvasVaultName);
const basesVaultName = "C07 Bases Direction Reference Fixture";
const basesVaultRoot = join(workDirectory, basesVaultName);
const groupOrderVaultName = "C07 Group Order Reference Fixture";
const groupOrderVaultRoot = join(workDirectory, groupOrderVaultName);
const groupOrderScenarioFixturePath = join(process.cwd(), "fixtures", "c07-group-order-reference.json");
// Intentional fixture changes must update this reviewed digest and the exact scenario ID inventory below.
const groupOrderScenarioFixtureSha256 = "1ecc2863c78a115fa48d4d2c4eef1bba90c13a494404ab2a10c862da97c518de";
const obsidianBinary = resolve(requiredEnv("OBSIDIAN_BINARY"));
const openObsidianBinary = resolve(requiredEnv("OPENOBSIDIAN_BINARY"));
const obsidianVersion = requiredEnv("OBSIDIAN_RELEASE_VERSION");
const obsidianSha256 = requiredEnv("OBSIDIAN_RELEASE_SHA256");
const sourceSha = process.env.GITHUB_SHA ?? "unknown";
const runId = process.env.GITHUB_RUN_ID ?? "unknown";
const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? "unknown";
const attachmentPath = "Assets/roundtrip image.png";
const noteMarker = "Authored by pinned Obsidian through its editor on GitHub Actions.";
const noteEmbed = "![[Assets/roundtrip image.png]]";
const noteContents = `${noteMarker}\n\n${noteEmbed}\n`;
const canvasPath = "C06 Reference.canvas";
const canvasMarker = "Canvas text card";
const canvasEditedText = "Canvas text card edited in OpenObsidian CI";
const canvasNotePath = "Notes/Canvas text card.md";
const canvasTargetPath = "Notes/Target.md";
const canvasTargetMarkdown = "# Heading\n\nTarget for the C06 Canvas fixture subpath. ^block-id\n";
const canvasTargetText = "Target for the C06 Canvas fixture subpath.";
const canvasTargetMarkdownBytes = Buffer.from(canvasTargetMarkdown, "utf8");
const basesDirectionFixturePaths = [
  "Ascending.base",
  "Descending.base",
  "Invalid Direction.base",
  "Omitted Direction.base",
  "Notes/01-zulu-first.md",
  "Notes/02-alpha-first.md",
  "Notes/03-bravo-first.md",
  "Notes/04-zulu-second.md",
  "Notes/05-alpha-second.md",
  "Notes/06-bravo-second.md",
];
const omittedBasesDirection = "OMITTED";
const invalidBasesDirection = "SIDEWAYS";
const normalizedInvalidBasesDirection = Buffer.from(
  "views:\n  - type: table\n    name: C07 group direction SIDEWAYS\n",
  "utf8",
);
const normalizedInvalidBasesDirectionSha256 = "6db35053b1d4aa0aca718364f906cd8820193c635ba002958f953d1aa03548cc";
const obsidianAsset = requiredEnv("OBSIDIAN_RELEASE_ASSET");
const obsidianSourcePlatform = requiredEnv("OBSIDIAN_SOURCE_PLATFORM");
const seedMarkdownPath = "Nested Ω/space note.md";
const seedMarkdown = "\uFEFF---\r\ntitle: Original CRLF note\r\nunknown_nested:\r\n  keep: [true, 7, 'opaque']\r\n---\r\n\r\nOriginal bytes stay untouched.\r\n";
const externalRefreshMarkdownPath = "After refresh.md";
const externalRenamedMarkdownPath = "After refresh renamed.md";
const externalRefreshMarkdown = "\uFEFF---\r\ntitle: External refresh note\r\nunknown_nested:\r\n  keep: [true, 13, 'external']\r\n---\r\n\r\nExternal note source stays exact.\r\n";
const externalRefreshMarkdownBytes = Buffer.from(externalRefreshMarkdown, "utf8");
const externalRefreshMarker = "External note source stays exact.";
const externalEditedMarkdown = "\uFEFF---\r\ntitle: External in-place edit\r\nunknown_nested:\r\n  keep: [true, 29, 'updated']\r\n---\r\n\r\nExternal note source updated by in-place edit.\r\n";
const externalEditedMarkdownBytes = Buffer.from(externalEditedMarkdown, "utf8");
const externalEditedMarker = "External note source updated by in-place edit.";
const workspaceStateAllowlist = [".obsidian/workspace.json", ".obsidian/workspace-mobile.json"];
const startedAt = new Date().toISOString();
const macOSWindowIds = new Map<number, string>();

const report: Record<string, unknown> = {
  schema_version: 1,
  milestone: "R2.8.76-C01.2-reference-app-external-note-rename-refresh",
  included_milestone_sections: [{
    milestone: "R2.8.106-C07.2-reference-rewrite-and-reopen-capture",
    report_path: "bases_group_direction_reference",
  }, {
    milestone: "R2.8.121-C07.3-cross-platform-capture-repair",
    report_path: "bases_group_order_reference",
  }],
  status: "pending",
  started_at: startedAt,
  source_sha: sourceSha,
  runner_os: process.env.RUNNER_OS ?? "unknown",
  runner_image: process.env.ImageOS ?? process.env.OBSIDIAN_RUNNER_IMAGE ?? "unknown",
  runner_image_version: process.env.ImageVersion ?? "unknown",
  workflow_run_id: runId,
  workflow_run_attempt: runAttempt,
  reference_application: {
    product: "Obsidian Desktop",
    version: obsidianVersion,
    asset: obsidianAsset,
    sha256: obsidianSha256,
    ...(process.platform === "linux" ? {appimage_sha256: obsidianSha256} : {}),
    source_platform: obsidianSourcePlatform,
    runner_architecture: process.arch,
    fixture_authoring: "Open the generated vault in the pinned desktop app, create a new note with its editor action, and insert the seed text through the renderer keyboard input protocol.",
  },
  fixture: {
    privacy: "Generated synthetic data only; no personal vault content or credentials.",
    vault_path: vaultRoot,
    seed_markdown_path: seedMarkdownPath,
    authored_note_path: null,
    attachment_path: attachmentPath,
    content_hashes: {},
  },
  obsidian_authoring: {status: "pending"},
  openobsidian_open: {status: "pending"},
  obsidian_reopen: {status: "pending"},
  canvas_reference_reopen: {
    status: "pending",
    text_edit: {status: "pending"},
    note_creation: {status: "pending"},
  },
  bases_group_direction_reference: {
    status: "pending",
    milestone: "R2.8.106-C07.2-reference-rewrite-and-reopen-capture",
    capture_scope: "Record pinned Obsidian behavior, including its exact unsupported-view source rewrite; Rust fixture reconciliation and byte-preserving parity acceptance are separate.",
    application: "Pinned Obsidian Desktop 1.14.4",
    explicit_direction_expectation: "Record rendered ASC/DESC group and row order without judging it against a Rust or preset expectation; reconcile the captured result in the follow-up parity milestone.",
    omitted_direction_expectation: "The pinned app rejects the tested native-YAML groupBy mapping when direction is omitted with `groupBy` must be a object; capture the settled exact-file error state on first open and reopen, record no group or row order, and do not infer a default.",
    workspace_restore_expectation: "After each session captures all four direction cases, make the supported ASC view active before shutdown. Keep the original source hashes immutable. At any post-open source-hash checkpoint, record only the exact known Invalid Direction.base normalization (122 to 62 bytes, groupBy removed) as pinned-app behavior; fail for any other change. If it occurs, restore only that generated file from its recorded seed after shutdown and before the reopened session, record the reseed, then capture the four original cases again.",
    source_preservation_expectation: "A source rewrite by pinned Obsidian is reported as a reference-app mutation, never as Rust source-preservation success. Rust parse/encode preservation remains a separate strict requirement.",
    fixture_paths_to_observe: basesDirectionFixturePaths,
    omitted_direction: omittedBasesDirection,
    invalid_direction: invalidBasesDirection,
  },
  bases_group_order_reference: {
    status: "pending",
    milestone: "R2.8.121-C07.3-cross-platform-capture-repair",
    source_sha: sourceSha,
    capture_scope: "Record actual pinned Obsidian 1.14.4 groupOrder behavior for JSON-compatible and native-YAML .base inputs, typed values, malformed configurations, JSON non-finite-number and YAML binary-tag candidates, and formula-derived Kanban grouping. Capture is reference characterization only and does not establish Rust parity.",
    application: "Pinned Obsidian Desktop 1.14.4",
    fixture_id: "fixture:c07-group-order-reference",
    fixture_source_path: "fixtures/c07-group-order-reference.json",
    strict_source_preservation_expectation: "Record the original and every observed post-open/reopen .base and note byte count, SHA-256, and exact raw bytes. Reference-app rewrites are observations and must not abort the capture; reseed from the recorded source after first-open shutdown so the reopen capture starts from the same input, and report that harness write. This is separate from the strict Rust parser/encoder requirement to preserve source bytes exactly.",
    observation_expectation: "Capture the exact selected .base, active view type, visible errors/notices and whether the state is a loaded Bases view or a non-Bases error view; record ordered group headings with stable ordinals, each heading's painted-text and scroll-position sample, every rendered result path/order (including .base results), and all state samples/screenshots. After settled scrolling, freshly query painted rows/cards and headings at every bounded scroll position so virtualized or recycled nodes are re-identified; record scroll offsets, DOM/column order constraints, identity changes, unique path-to-group assignments, and unmapped candidates. Require complete sweep coverage, stable unambiguous order and ownership, and unique mapped paths equal to the structurally scoped visible result count. Accept zero results only for json-empty-group-order-list, yaml-empty-group-order-list, and yaml-binary-tag-value-candidate when the exact Bases view is active, one visible table shell and a painted 0-results count are present, and no group, path, unmapped row, error or error notice appears. The binary-tag case remains an outcome observation and does not prove unsupported behavior. Record actual fallback behavior without assigning an undocumented meaning to malformed input. Fail closed when a rendered group or result cannot be mapped unambiguously.",
    unsupported_entry_scope: "Probe valid-input JSON non-finite-number and YAML binary-tag candidates without assuming either is unsupported. If neither produces visible app-level rejection after the Bases view loads, record app-level unsupported groupOrder entry behavior as unresolved and keep Rust C07.3 parity blocked.",
    rust_parity_claimed: false,
    scenarios: [],
  },
  vault_snapshots: {},
  openobsidian_app_data: {},
  workspace_state_allowlist: workspaceStateAllowlist,
  acceptance_limits: [
    "The run proves read-only startup, source preview and close, external note creation, in-place edit, and rename followed by explicit UI refresh and preview, native image-embed resolution and external attachment removal followed by refresh/re-resolution, plus explicit Canvas text-card note preview/review/confirmation before first-open and reopened-vault visibility, native folder-picker selection and cancellation, and Obsidian reopen on the recorded runner platform only; other operating systems require their own passing artifact.",
    "The deliberate external note creation, in-place note edit, attachment removal, and note rename each establish a new baseline; all subsequent no-op operations must preserve the latest applicable baseline exactly.",
    "The Canvas check uses a dedicated reference-compatible fixture and fresh Obsidian profile, edits one native text card with no write before explicit save, verifies the saved JSON differs only at that selected card's text while preserving sibling nodes and edges, creates one Markdown note afterward with the edited text-card bytes, exposes the edited text and referenced block content, and checks the edited Canvas and note after first-open and reopened-vault sessions. The codec's rich unknown-field fixture remains covered by Rust tests and is not opened by Obsidian. This does not certify every Canvas workflow or cross-platform behavior beyond the recorded runner.",
    "The C07 reference probe opens synthetic Bases files with explicit ASC and DESC, omitted direction, and an unsupported direction. For ASC and DESC it captures every rendered group and file row from all Bases table roots on first open and reopen, including the null-value group containing the .base files, without judging observed ordering against preset expectations. For the tested omitted-direction native-YAML mapping, it captures the settled exact-file parse rejection (`groupBy` must be a object) and records no group or row order; it does not infer a default. The unsupported direction remains a capture-only observation. Before each shutdown, the probe explicitly restores ASC. It retains the original source hash baseline and reports Obsidian's exact 62-byte Invalid Direction.base rewrite if it occurs at any post-open source-hash checkpoint; the generated file is reseeded between sessions so the reopened view is captured from the original fixture, with that harness action reported. This reference-app mutation is not evidence that Rust preserves the source. Interpretation and Rust fixture reconciliation belong to the follow-up parity milestone.",
    "The separate C07.3 reference probe uses a generated synthetic vault and captures JSON-compatible and native-YAML .base scenarios for groupOrder precedence, listed and unlisted groups, explicit empty groups, empty lists, duplicates, null versus missing values, typed scalar/array/object values and rendered-label collisions, groupOrder without groupBy, malformed shapes, JSON 1e999 and YAML !!binary boundary candidates, YAML tag rejection, and a dependent-formula Kanban view. Each scenario runs in its own copy of the complete synthetic vault and its own Obsidian profile so every view has the same file membership and rewrites cannot contaminate other scenarios. It records whether candidate rejection occurs on a non-Bases error surface or within a loaded Bases view. Unless a candidate visibly demonstrates app-level rejection after Bases loads, that behavior remains unprobed and Rust C07.3 parity stays blocked. For each scenario it captures the exact active .base, ordered group-heading array and every member path/order, visible errors/notices, stable state samples, and screenshots on first open and reopen. At every checkpoint it records source path sets, byte counts, hashes, and exact raw artifacts for changed/new source files. After first-open shutdown it restores the recorded seeds, reports that harness reseed, and begins the same scenario's reopen from identical bytes. Reference-app rewrites remain reference observations; they are never Rust source-preservation evidence. An incomplete or ambiguous UI extraction fails closed. These observations characterize Obsidian only and do not establish Rust parity.",
    "This run does not certify all product C01 flows or general plugin/theme compatibility.",
  ],
};

class DevToolsConnection {
  private nextId = 0;
  private readonly pending = new Map<number, {resolve(value: CdpResponse): void; reject(error: Error): void}>();

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      let message: CdpResponse;
      try {
        message = JSON.parse(String(event.data)) as CdpResponse;
      } catch {
        return;
      }
      if (typeof message.id !== "number") return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message ?? "Chrome DevTools Protocol request failed"));
      else request.resolve(message);
    });
    socket.addEventListener("close", () => {
      for (const request of this.pending.values()) request.reject(new Error("DevTools connection closed"));
      this.pending.clear();
    });
  }

  static async connect(url: string): Promise<DevToolsConnection> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolveOpen, rejectOpen) => {
      const timer = setTimeout(() => rejectOpen(new Error("Timed out connecting to Obsidian DevTools")), 15_000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolveOpen();
      }, {once: true});
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        rejectOpen(new Error("Could not connect to Obsidian DevTools"));
      }, {once: true});
    });
    return new DevToolsConnection(socket);
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<CdpResponse> {
    const id = ++this.nextId;
    return new Promise<CdpResponse>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error(`Timed out waiting for DevTools method ${method}`));
      }, 20_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolveRequest(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectRequest(error);
        },
      });
      this.socket.send(JSON.stringify({id, method, params}));
    });
  }

  send(method: string, params: Record<string, unknown> = {}): void {
    const id = ++this.nextId;
    this.socket.send(JSON.stringify({id, method, params}));
  }

  async evaluateJson<T>(expression: string, label = "renderer expression"): Promise<T> {
    const response = await this.request("Runtime.evaluate", {
      expression: `JSON.stringify(${expression})`,
      returnByValue: true,
      awaitPromise: true,
    });
    const remoteObject = response.result?.result as CdpRemoteObject | undefined;
    const value = remoteObject?.value;
    if (response.result?.exceptionDetails || typeof value !== "string") {
      throw new Error(`Obsidian renderer evaluation returned no JSON value (${label}): ${JSON.stringify(runtimeEvaluationDiagnostics(response))}`);
    }
    return JSON.parse(value) as T;
  }

  async evaluateJsonAwaited<T>(expression: string, label = "renderer expression"): Promise<T> {
    const response = await this.request("Runtime.evaluate", {
      expression: `(async () => JSON.stringify(await (${expression})))()`,
      returnByValue: true,
      awaitPromise: true,
    });
    const remoteObject = response.result?.result as CdpRemoteObject | undefined;
    const value = remoteObject?.value;
    if (response.result?.exceptionDetails || typeof value !== "string") {
      throw new Error(`Obsidian renderer evaluation returned no awaited JSON value (${label}): ${JSON.stringify(runtimeEvaluationDiagnostics(response))}`);
    }
    return JSON.parse(value) as T;
  }

  async evaluate(expression: string, label = "renderer expression"): Promise<unknown> {
    const response = await this.request("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.result?.exceptionDetails) {
      throw new Error(`Obsidian renderer evaluation failed (${label}): ${JSON.stringify(runtimeEvaluationDiagnostics(response))}`);
    }
    return (response.result?.result as CdpRemoteObject | undefined)?.value;
  }

  close(): void {
    this.socket.close();
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required GitHub Actions environment variable ${name} is missing`);
  return value;
}

function resolveContainedPath(root: string, relativePath: string): string {
  if (!relativePath || relativePath.includes("\\") || relativePath.split("/").some((part) => (
    !part || part === "." || part === ".." || part.includes(":") || part.trimEnd() !== part || part.endsWith(".")
  ))) {
    throw new Error(`Unsafe relative path: ${relativePath}`);
  }
  const resolvedRoot = resolve(root);
  const destination = resolve(resolvedRoot, relativePath);
  const pathFromRoot = relative(resolvedRoot, destination);
  if (!pathFromRoot || pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error(`Path escapes its destination root: ${relativePath}`);
  }
  return destination;
}

async function assertNoSymlinkPathComponents(root: string, relativePath: string): Promise<string> {
  const destination = resolveContainedPath(root, relativePath);
  const resolvedRoot = resolve(root);
  const rootMetadata = await lstat(resolvedRoot);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error(`Destination root is not a real directory: ${resolvedRoot}`);
  }
  const components = relative(resolvedRoot, destination).split(sep);
  let current = resolvedRoot;
  for (let index = 0; index < components.length; index += 1) {
    current = join(current, components[index]);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
    if (metadata.isSymbolicLink()) throw new Error(`Destination path contains a symlink: ${current}`);
    if (index < components.length - 1 && !metadata.isDirectory()) {
      throw new Error(`Destination path ancestor is not a directory: ${current}`);
    }
  }
  return destination;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function saveReport(): Promise<void> {
  await mkdir(reportDirectory, {recursive: true});
  await writeFile(join(reportDirectory, "obsidian-vault-roundtrip-report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

async function saveReportAfterStageFailure(stage: string, evidence: Record<string, unknown>, originalError: unknown): Promise<void> {
  try {
    await saveReport();
  } catch (saveError) {
    const originalMessage = originalError instanceof Error ? originalError.message : String(originalError);
    const saveMessage = saveError instanceof Error ? saveError.message : String(saveError);
    evidence[`${stage}_evidence_save_error`] = saveMessage;
    console.error(`Could not persist report after ${stage} failed (${originalMessage}): ${saveMessage}`);
  }
}

async function waitFor<T>(label: string, read: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await delay(500);
  }
  const serializedLast = JSON.stringify(last);
  throw new Error(`Timed out waiting for ${label}; last value=${(serializedLast ?? String(last)).slice(0, 2_000)}`);
}

type OpenObsidianRefreshDiagnostics = {
  requests: Array<{source: string; line: number}>;
  consumedResults: Array<{succeeded: boolean; entries: number | null; line: number}>;
  receiverStates: Array<{busy: boolean; line: number}>;
};

function openObsidianRefreshActivityChanged(
  before: OpenObsidianRefreshDiagnostics,
  after: OpenObsidianRefreshDiagnostics,
): boolean {
  return before.requests.length !== after.requests.length
    || before.consumedResults.length !== after.consumedResults.length;
}

async function readOpenObsidianRefreshDiagnostics(
  logPath = join(reportDirectory, "openobsidian.log"),
): Promise<OpenObsidianRefreshDiagnostics> {
  const log = await readFile(logPath, "utf8").catch(() => "");
  const diagnostics: OpenObsidianRefreshDiagnostics = {requests: [], consumedResults: [], receiverStates: []};
  for (const [line, value] of log.split(/\r?\n/).entries()) {
    const request = value.match(/OpenObsidian CI vault refresh request: source=([a-z_]+)/);
    if (request) diagnostics.requests.push({source: request[1] ?? "unknown", line});
    const consumed = value.match(/OpenObsidian CI vault refresh result consumed: succeeded=(true|false)(?:, entries=(\d+))?/);
    if (consumed) diagnostics.consumedResults.push({
      succeeded: consumed[1] === "true",
      entries: consumed[2] === undefined ? null : Number(consumed[2]),
      line,
    });
    const receiverState = value.match(/OpenObsidian CI UI state: .*vault_refresh_receiver=(true|false)/);
    if (receiverState) diagnostics.receiverStates.push({busy: receiverState[1] === "true", line});
  }
  return diagnostics;
}

async function waitForOpenObsidianRefreshIdle(
  previousRequestCount: number,
  expectedEntries: number,
  requireManualRequest: boolean,
  logPath = join(reportDirectory, "openobsidian.log"),
): Promise<OpenObsidianRefreshDiagnostics & {settled_for_ms: number}> {
  let settledSince: number | null = null;
  return await waitFor(
    requireManualRequest
      ? "OpenObsidian to finish the explicit manual note-list refresh"
      : "OpenObsidian watcher refreshes to settle before the manual refresh",
    async () => {
      const diagnostics = await readOpenObsidianRefreshDiagnostics(logPath);
      const latestRequest = diagnostics.requests.at(-1);
      const latestResult = diagnostics.consumedResults.at(-1);
      const receiverBusy = diagnostics.receiverStates.at(-1)?.busy ?? false;
      const latestRequestConsumed = !latestRequest || Boolean(latestResult && latestResult.line > latestRequest.line);
      const newManualRequest = diagnostics.requests.some((request, index) => (
        index >= previousRequestCount && request.source === "manual_button"
      ));
      const latestResultHasExpectedEntries = latestResult?.succeeded === true && latestResult.entries === expectedEntries;
      const ready = !receiverBusy
        && latestRequestConsumed
        && (!requireManualRequest || (newManualRequest && latestResultHasExpectedEntries));
      if (ready) settledSince ??= Date.now();
      else settledSince = null;
      return {...diagnostics, settled_for_ms: settledSince === null ? 0 : Date.now() - settledSince};
    },
    (diagnostics) => diagnostics.settled_for_ms >= 750,
    30_000,
  );
}

async function clickManualRefreshUntilRequested(
  child: ChildProcess,
  windowId: string,
  previousRequestCount: number,
): Promise<string> {
  const clickActions: string[] = [];
  const deadline = Date.now() + 30_000;
  let lastClickAt = 0;
  let diagnostics = await readOpenObsidianRefreshDiagnostics();
  const findManualRequest = (value: OpenObsidianRefreshDiagnostics) => value.requests.find((request, index) => (
    index >= previousRequestCount && request.source === "manual_button"
  ));

  while (Date.now() < deadline) {
    const manualRequest = findManualRequest(diagnostics);
    if (manualRequest) {
      return clickActions.at(-1) ?? `Manual refresh request observed at log line ${manualRequest.line}`;
    }

    const latestRequest = diagnostics.requests.at(-1);
    const latestResult = diagnostics.consumedResults.at(-1);
    const receiverBusy = diagnostics.receiverStates.at(-1)?.busy ?? false;
    const latestRequestConsumed = !latestRequest || Boolean(latestResult && latestResult.line > latestRequest.line);
    if (
      !receiverBusy
      && latestRequestConsumed
      && clickActions.length < 4
      && Date.now() - lastClickAt >= 500
    ) {
      clickActions.push(await invokeNativeAccessibleControl(
        child,
        windowId,
        "Refresh note list",
        "Markdown files found",
        true,
      ));
      lastClickAt = Date.now();
      // The native click can take long enough for a request to arrive after
      // the pre-click diagnostics snapshot. Always read the log again after it.
      diagnostics = await readOpenObsidianRefreshDiagnostics();
      const requestAfterClick = findManualRequest(diagnostics);
      if (requestAfterClick) return clickActions.at(-1)!;
    } else {
      diagnostics = await readOpenObsidianRefreshDiagnostics();
    }

    if (Date.now() < deadline) await delay(250);
  }

  diagnostics = await readOpenObsidianRefreshDiagnostics();
  const finalManualRequest = findManualRequest(diagnostics);
  if (finalManualRequest) return clickActions.at(-1) ?? `Manual refresh request observed at log line ${finalManualRequest.line}`;
  throw new Error(
    `Timed out waiting for OpenObsidian to receive the explicit manual note-list refresh; `
    + `click_actions=${JSON.stringify(clickActions)}; final=${JSON.stringify({diagnostics, manualRequest: null})}`,
  );
}

async function waitForDevToolsVersion(port: number): Promise<{Browser?: string; "Protocol-Version"?: string}> {
  const value = await waitFor<{Browser?: string; "Protocol-Version"?: string} | null>(`Obsidian DevTools port ${port}`, async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (!response.ok) return null;
      return await response.json() as {Browser?: string; "Protocol-Version"?: string};
    } catch {
      return null;
    }
  }, (candidate) => candidate !== null);
  if (!value) throw new Error(`Obsidian DevTools did not start on port ${port}`);
  return value;
}

async function readPageTargets(port: number): Promise<CdpTarget[]> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) return [];
    return await response.json() as CdpTarget[];
  } catch {
    return [];
  }
}

async function waitForPageTarget(port: number, predicate: (target: CdpTarget) => boolean = () => true, label = `Obsidian page target on port ${port}`): Promise<CdpTarget> {
  const value = await waitFor<CdpTarget | null>(label, async () => {
    try {
      const targets = await readPageTargets(port);
      return targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl && predicate(target)) ?? null;
    } catch {
      return null;
    }
  }, (candidate) => candidate !== null);
  if (!value) throw new Error(`Obsidian did not expose a page target on port ${port}`);
  return value;
}

async function connectTarget(target: CdpTarget): Promise<DevToolsConnection> {
  if (!target.webSocketDebuggerUrl) throw new Error("Obsidian page target did not expose its DevTools WebSocket");
  const connection = await DevToolsConnection.connect(target.webSocketDebuggerUrl);
  await connection.request("Page.enable");
  await connection.request("Runtime.enable");
  return connection;
}

async function connectObsidian(port: number): Promise<{connection: DevToolsConnection; browserVersion: string; target: CdpTarget}> {
  const version = await waitForDevToolsVersion(port);
  const target = await waitForPageTarget(port);
  const connection = await connectTarget(target);
  return {connection, browserVersion: version.Browser ?? "unknown", target};
}

function launchLogged(command: string, args: string[], logPath: string, env: NodeJS.ProcessEnv): ChildProcess {
  const log = createWriteStream(logPath, {flags: "a"});
  const child = spawn(command, args, {env, stdio: ["ignore", "pipe", "pipe"]});
  child.stdout?.pipe(log, {end: false});
  child.stderr?.pipe(log, {end: false});
  child.once("close", () => log.end());
  return child;
}

async function waitForExit(child: ChildProcess, timeoutMs = 20_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolveExit, rejectExit) => {
    const timer = setTimeout(() => rejectExit(new Error(`Process ${child.pid ?? "unknown"} did not exit within ${timeoutMs} ms`)), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}

async function stopProcess(child: ChildProcess | undefined, connection?: DevToolsConnection): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    connection?.close();
    return;
  }
  if (connection) {
    try {
      await connection.request("Browser.close");
    } catch {
      connection.close();
    }
  }
  if (!connection) child.kill("SIGTERM");
  try {
    await waitForExit(child, 15_000);
  } catch {
    child.kill("SIGTERM");
    try {
      await waitForExit(child, 5_000);
    } catch {
      child.kill("SIGKILL");
      await waitForExit(child, 5_000).catch(() => undefined);
    }
  }
  connection?.close();
}

function xdotool(...args: string[]): void {
  execFileSync("xdotool", args, {stdio: "ignore"});
}

function clickWindowOpenButton(windowId: string): {window_x: number; window_y: number; window_width: number; window_height: number; click_x: number; click_y: number} {
  const geometryOutput = execFileSync("xdotool", ["getwindowgeometry", "--shell", windowId], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
  const readGeometry = (key: string): number => {
    const match = geometryOutput.match(new RegExp(`^${key}=(\\d+)$`, "m"));
    if (!match) throw new Error(`Could not read ${key} from native folder picker geometry`);
    return Number(match[1]);
  };
  const windowX = readGeometry("X");
  const windowY = readGeometry("Y");
  const windowWidth = readGeometry("WIDTH");
  const windowHeight = readGeometry("HEIGHT");
  const clickX = Math.round(windowX + windowWidth * 0.953);
  const clickY = Math.round(windowY + windowHeight * 0.915);
  xdotool("mousemove", "--sync", String(clickX), String(clickY));
  xdotool("click", "1");
  return {window_x: windowX, window_y: windowY, window_width: windowWidth, window_height: windowHeight, click_x: clickX, click_y: clickY};
}

async function clickOpenVaultButtonLinux(windowId: string, applicationLogPath: string): Promise<{window_x: number; window_y: number; window_width: number; window_height: number; click_x: number; click_y: number; focused_window_before_activation: string; focused_window_after_activation: string; pointer_before_click: string; egui_action_event: string; keyboard_fallback: false}> {
  const geometryOutput = execFileSync("xdotool", ["getwindowgeometry", "--shell", windowId], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
  const readGeometry = (key: string): number => {
    const match = geometryOutput.match(new RegExp(`^${key}=(\\d+)$`, "m"));
    if (!match) throw new Error(`Could not read ${key} from OpenObsidian window geometry`);
    return Number(match[1]);
  };
  const windowX = readGeometry("X");
  const windowY = readGeometry("Y");
  const windowWidth = readGeometry("WIDTH");
  const windowHeight = readGeometry("HEIGHT");
  const clickX = Math.round(windowX + windowWidth * 0.045);
  const clickY = Math.round(windowY + windowHeight * 0.085);
  const focusedWindowBeforeActivation = x11InteractionState().focused_window_id;
  xdotool("windowraise", windowId);
  xdotool("windowfocus", "--sync", windowId);
  await delay(250);
  const focusedWindowAfterActivation = x11InteractionState().focused_window_id;
  const pointerBeforeClick = x11InteractionState().pointer;
  const activationLogBefore = await readFile(applicationLogPath, "utf8");
  const activationCountBefore = activationLogBefore.split("OpenObsidian CI action: Open vault click received").length - 1;
  xdotool("mousemove", "--sync", String(clickX), String(clickY));
  await delay(100);
  xdotool("click", "1");
  const eguiActionEvent = await waitFor(
    "OpenObsidian to receive the Linux Open vault click",
    async () => {
      const currentLog = await readFile(applicationLogPath, "utf8");
      const actionLines = currentLog
        .split(/\r?\n/)
        .filter((line) => line.includes("OpenObsidian CI action: Open vault click received"));
      return actionLines.length > activationCountBefore ? actionLines.at(-1) ?? null : null;
    },
    (line) => line !== null,
    5_000,
  );
  if (!eguiActionEvent) throw new Error(`Linux click did not activate Open vault; X11 focus=${focusedWindowAfterActivation}; pointer=${pointerBeforeClick}`);
  return {
    window_x: windowX,
    window_y: windowY,
    window_width: windowWidth,
    window_height: windowHeight,
    click_x: clickX,
    click_y: clickY,
    focused_window_before_activation: focusedWindowBeforeActivation,
    focused_window_after_activation: focusedWindowAfterActivation,
    pointer_before_click: pointerBeforeClick,
    egui_action_event: eguiActionEvent,
    keyboard_fallback: false,
  };
}

type X11WindowDescription = {window_id: string; title: string; window_class: string; geometry: string};

function x11WindowInventory(): X11WindowDescription[] {
  let output: string;
  try {
    output = execFileSync("xdotool", ["search", "--onlyvisible", "--name", "."], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === 1
    ) {
      return [];
    }
    throw error;
  }
  return output.split(/\r?\n/).filter((windowId) => /^\d+$/.test(windowId)).map((windowId) => {
    const read = (args: string[]): string => {
      try {
        return execFileSync("xdotool", args, {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
      } catch {
        return "";
      }
    };
    const title = read(["getwindowname", windowId]);
    const windowClass = read(["getwindowclassname", windowId]);
    const geometry = read(["getwindowgeometry", "--shell", windowId]).split(/\r?\n/)
      .filter((line) => /^(X|Y|WIDTH|HEIGHT)=/.test(line))
      .join(",");
    return {window_id: windowId, title, window_class: windowClass, geometry};
  });
}

function x11InteractionState(): {focused_window_id: string; focused_window_title: string; pointer: string} {
  const read = (args: string[]): string => {
    try {
      return execFileSync("xdotool", args, {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
    } catch {
      return "unavailable";
    }
  };
  const focusedWindowId = read(["getwindowfocus"]);
  return {
    focused_window_id: focusedWindowId,
    focused_window_title: /^\d+$/.test(focusedWindowId) ? read(["getwindowname", focusedWindowId]) : "unavailable",
    pointer: read(["getmouselocation", "--shell"]),
  };
}

async function clickOpenVaultButtonMacOS(child: ChildProcess): Promise<string> {
  const positionScript = `on run argv
    tell application "System Events"
      set targetProcess to first process whose unix id is (item 1 of argv as integer)
      set frontmost of targetProcess to true
      set windowPosition to position of window 1 of targetProcess
      return (item 1 of windowPosition as integer) & "," & (item 2 of windowPosition as integer)
    end tell
  end run`;
  const position = execFileSync("osascript", ["-e", positionScript, String(child.pid ?? -1)], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
  const coordinates = position.match(/\d+/g)?.map(Number) ?? [];
  if (coordinates.length < 2) throw new Error(`Could not read the OpenObsidian window position for a native click: ${position}`);
  const clickX = coordinates[0] + 36;
  const clickY = coordinates[1] + 83;
  const swiftPath = join(workDirectory, "openobsidian-click.swift");
  await writeFile(swiftPath, `import AppKit
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3,
      let x = Double(CommandLine.arguments[1]),
      let y = Double(CommandLine.arguments[2]) else {
    fatalError("Expected screen x and y coordinates")
}
let point = CGPoint(x: x, y: y)
for type in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else {
        fatalError("Could not create a mouse event")
    }
    event.post(tap: .cghidEventTap)
    if type == .leftMouseDown { Thread.sleep(forTimeInterval: 0.08) }
}
`);
  execFileSync("swift", [swiftPath, String(clickX), String(clickY)], {stdio: "ignore"});
  return `Sent a macOS mouse click to the visible Open vault control at (${clickX}, ${clickY}).`;
}

async function clickMacOSNativePickerOpenButton(child: ChildProcess, expectedPanelIdentity: string): Promise<string> {
  const expectedPanel = expectedPanelIdentity?.match(/^(AXSheet|AXWindow):([^|]+)\|bounds=(-?\d+),(-?\d+),(\d+),(\d+)(?:\|parent=(AXWindow):([^|]+)\|bounds=(-?\d+),(-?\d+),(\d+),(\d+))?$/);
  if (!expectedPanel
      || Number(expectedPanel[5]) <= 0
      || Number(expectedPanel[6]) <= 0
      || (expectedPanel[1] === "AXSheet" && (!expectedPanel[7] || Number(expectedPanel[11]) <= 0 || Number(expectedPanel[12]) <= 0))) {
    throw new Error(`Invalid native macOS panel identity: ${expectedPanelIdentity}`);
  }
  const boundsScript = `on run argv
    tell application "System Events"
      set targetProcess to first process whose unix id is (item 1 of argv as integer)
      set expectedPanelRole to item 2 of argv as text
      set expectedPanelName to item 3 of argv as text
      set expectedPanelX to item 4 of argv as integer
      set expectedPanelY to item 5 of argv as integer
      set expectedPanelWidth to item 6 of argv as integer
      set expectedPanelHeight to item 7 of argv as integer
      set matchingPanels to {}
      set accessibilityReadErrors to {}
      if expectedPanelRole is "AXSheet" then
        if (count of argv) is not 13 then error "Expected parent identity and bounds for the recorded AXSheet"
        set expectedParentRole to item 8 of argv as text
        set expectedParentName to item 9 of argv as text
        set expectedParentX to item 10 of argv as integer
        set expectedParentY to item 11 of argv as integer
        set expectedParentWidth to item 12 of argv as integer
        set expectedParentHeight to item 13 of argv as integer
        repeat with candidateWindow in windows of targetProcess
          set parentMatches to false
          try
            set candidateParentRole to role of candidateWindow as text
            set candidateParentName to name of candidateWindow as text
            set candidateParentPosition to position of candidateWindow
            set candidateParentSize to size of candidateWindow
            set parentMatches to candidateParentRole is expectedParentRole and candidateParentName is expectedParentName and (item 1 of candidateParentPosition as integer) is expectedParentX and (item 2 of candidateParentPosition as integer) is expectedParentY and (item 1 of candidateParentSize as integer) is expectedParentWidth and (item 2 of candidateParentSize as integer) is expectedParentHeight
          on error errorMessage
            set end of accessibilityReadErrors to "parent window attributes: " & errorMessage
          end try
          set candidateSheets to {}
          try
            set candidateSheets to sheets of candidateWindow
          on error errorMessage
            set end of accessibilityReadErrors to "sheet enumeration: " & errorMessage
          end try
          set candidateSheetIndex to 0
          repeat with candidateSheet in candidateSheets
            set candidateSheetIndex to candidateSheetIndex + 1
            try
              set candidateSheetRole to role of candidateSheet as text
              set candidateSheetName to name of candidateSheet as text
              set candidateSheetPosition to position of candidateSheet
              set candidateSheetSize to size of candidateSheet
              if parentMatches and candidateSheetRole is expectedPanelRole and candidateSheetName is expectedPanelName and (item 1 of candidateSheetPosition as integer) is expectedPanelX and (item 2 of candidateSheetPosition as integer) is expectedPanelY and (item 1 of candidateSheetSize as integer) is expectedPanelWidth and (item 2 of candidateSheetSize as integer) is expectedPanelHeight then
                set end of matchingPanels to candidateSheet
              end if
            on error errorMessage
              set end of accessibilityReadErrors to "sheet " & candidateSheetIndex & " attributes: " & errorMessage
            end try
          end repeat
        end repeat
      else if expectedPanelRole is "AXWindow" then
        if (count of argv) is not 7 then error "Unexpected parent identity for the recorded AXWindow"
        repeat with candidateWindow in windows of targetProcess
          try
            set candidateRole to role of candidateWindow as text
            set candidateName to name of candidateWindow as text
            set candidatePosition to position of candidateWindow
            set candidateSize to size of candidateWindow
            if candidateRole is expectedPanelRole and candidateName is expectedPanelName and (item 1 of candidatePosition as integer) is expectedPanelX and (item 2 of candidatePosition as integer) is expectedPanelY and (item 1 of candidateSize as integer) is expectedPanelWidth and (item 2 of candidateSize as integer) is expectedPanelHeight then
              set end of matchingPanels to candidateWindow
            end if
          on error errorMessage
            set end of accessibilityReadErrors to "window attributes: " & errorMessage
          end try
        end repeat
      else
        error "Unsupported role for the recorded native panel: " & expectedPanelRole
      end if
      if (count of accessibilityReadErrors) > 0 then
        set AppleScript's text item delimiters to " | "
        set errorSummary to accessibilityReadErrors as text
        set AppleScript's text item delimiters to ""
        error "Native panel identity enumeration had accessibility read errors: " & errorSummary
      end if
      if (count of matchingPanels) is not 1 then error "Expected exactly one recorded native panel " & expectedPanelRole & ":" & expectedPanelName & "; found " & (count of matchingPanels)
      set pickerElement to item 1 of matchingPanels
      set matchingButtons to {}
      set accessibilityReadErrors to {}
      set pickerDescendants to {}
      try
        set pickerDescendants to entire contents of pickerElement
      on error errorMessage
        set end of accessibilityReadErrors to "picker descendant enumeration: " & errorMessage
      end try
      set descendantIndex to 0
      repeat with candidateElement in pickerDescendants
        set descendantIndex to descendantIndex + 1
        try
          set candidateRole to role of candidateElement as text
          set candidateName to name of candidateElement as text
          if candidateRole is "AXButton" and candidateName is "Open" then
            set end of matchingButtons to candidateElement
          end if
        on error errorMessage
          set end of accessibilityReadErrors to "picker descendant " & descendantIndex & " attributes: " & errorMessage
        end try
      end repeat
      if (count of accessibilityReadErrors) > 0 then
        set AppleScript's text item delimiters to " | "
        set errorSummary to accessibilityReadErrors as text
        set AppleScript's text item delimiters to ""
        error "Native Open button enumeration had accessibility read errors: " & errorSummary
      end if
      if (count of matchingButtons) is not 1 then error "Expected one native Open button in the picker; found " & (count of matchingButtons)
      set openButton to item 1 of matchingButtons
      try
        if (enabled of openButton) is not true then error "The native Open button is disabled"
        set buttonPosition to position of openButton
        set buttonSize to size of openButton
      on error errorMessage
        error "Could not read the unique native Open button state or bounds: " & errorMessage
      end try
      if (item 1 of buttonSize as integer) <= 0 or (item 2 of buttonSize as integer) <= 0 then error "The unique native Open button has invalid bounds"
      return (item 1 of buttonPosition as integer) & "," & (item 2 of buttonPosition as integer) & "," & (item 1 of buttonSize as integer) & "," & (item 2 of buttonSize as integer)
    end tell
  end run`;
  let bounds: string;
  try {
    const args = ["-e", boundsScript, String(child.pid ?? -1), ...expectedPanel.slice(1, 7).map((value) => value ?? "")];
    if (expectedPanel[1] === "AXSheet") args.push(...expectedPanel.slice(7, 13).map((value) => value ?? ""));
    bounds = execFileSync("osascript", args, {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {stderr?: Buffer | string; stdout?: Buffer | string};
    const output = [failure.stdout, failure.stderr].filter(Boolean).map(String).join("\n").trim();
    let windows = "unavailable";
    try {
      windows = macOSApplicationWindowDescriptions(child);
    } catch (windowError) {
      windows = `window description failed: ${windowError instanceof Error ? windowError.message : String(windowError)}`;
    }
    throw new Error(`Could not locate one enabled native macOS Open button by accessibility bounds: ${output || failure.message}; windows=${windows}`);
  }
  const coordinates = bounds.match(/-?\d+/g)?.map(Number) ?? [];
  if (coordinates.length !== 4 || coordinates[2] <= 0 || coordinates[3] <= 0) {
    let windows = "unavailable";
    try {
      windows = macOSApplicationWindowDescriptions(child);
    } catch (windowError) {
      windows = `window description failed: ${windowError instanceof Error ? windowError.message : String(windowError)}`;
    }
    throw new Error(`Could not read valid native macOS Open button bounds: ${bounds}; windows=${windows}`);
  }
  const [buttonX, buttonY, buttonWidth, buttonHeight] = coordinates;
  const clickX = buttonX + buttonWidth / 2;
  const clickY = buttonY + buttonHeight / 2;
  const swiftPath = join(workDirectory, "openobsidian-picker-click.swift");
  await writeFile(swiftPath, `import AppKit
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3,
      let x = Double(CommandLine.arguments[1]),
      let y = Double(CommandLine.arguments[2]) else {
    fatalError("Expected screen x and y coordinates")
}
let point = CGPoint(x: x, y: y)
for type in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else {
        fatalError("Could not create a mouse event")
    }
    event.post(tap: .cghidEventTap)
    if type == .leftMouseDown { Thread.sleep(forTimeInterval: 0.08) }
}
`);
  execFileSync("swift", [swiftPath, String(clickX), String(clickY)], {stdio: "ignore"});
  return `Clicked the unique enabled native macOS Open button at (${clickX}, ${clickY}) using its accessibility bounds ${bounds}.`;
}

function activeWindowTitle(): string {
  try {
    return execFileSync("xdotool", ["getwindowfocus", "getwindowname"], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
  } catch {
    return "";
  }
}

function activeWindowId(): string {
  try {
    return execFileSync("xdotool", ["getwindowfocus"], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
  } catch {
    return "";
  }
}

function macOSApplicationWindowDescriptions(child: ChildProcess): string {
  const script = `on run argv
    tell application "System Events"
      set targetProcess to first process whose unix id is (item 1 of argv as integer)
      set windowDescriptions to {}
      set windowIndex to 0
      try
        repeat with candidateWindow in windows of targetProcess
          set windowIndex to windowIndex + 1
          set candidateIdentity to ""
          try
            set candidateRole to role of candidateWindow as text
            set candidateName to name of candidateWindow as text
            set candidatePosition to position of candidateWindow
            set candidateSize to size of candidateWindow
            set candidateBounds to ((item 1 of candidatePosition as integer) as text) & "," & ((item 2 of candidatePosition as integer) as text) & "," & ((item 1 of candidateSize as integer) as text) & "," & ((item 2 of candidateSize as integer) as text)
            set candidateIdentity to candidateRole & ":" & candidateName & "|bounds=" & candidateBounds
            set end of windowDescriptions to candidateIdentity
          on error errorMessage
            set end of windowDescriptions to "accessibility read error:window " & windowIndex & ":" & errorMessage
          end try
          set candidateSheets to {}
          try
            set candidateSheets to sheets of candidateWindow
          on error errorMessage
            set end of windowDescriptions to "accessibility read error:sheet enumeration for window " & windowIndex & ":" & errorMessage
          end try
          set sheetIndex to 0
          repeat with candidateSheet in candidateSheets
            set sheetIndex to sheetIndex + 1
            try
              if candidateIdentity is "" then error "parent window identity was unreadable"
              set candidateSheetRole to role of candidateSheet as text
              set candidateSheetName to name of candidateSheet as text
              set candidateSheetPosition to position of candidateSheet
              set candidateSheetSize to size of candidateSheet
              set candidateSheetBounds to ((item 1 of candidateSheetPosition as integer) as text) & "," & ((item 2 of candidateSheetPosition as integer) as text) & "," & ((item 1 of candidateSheetSize as integer) as text) & "," & ((item 2 of candidateSheetSize as integer) as text)
              set end of windowDescriptions to candidateSheetRole & ":" & candidateSheetName & "|bounds=" & candidateSheetBounds & "|parent=" & candidateIdentity
            on error errorMessage
              set end of windowDescriptions to "accessibility read error:sheet " & windowIndex & "," & sheetIndex & ":" & errorMessage
            end try
          end repeat
        end repeat
      on error errorMessage
        set end of windowDescriptions to "accessibility error:" & errorMessage
      end try
      set AppleScript's text item delimiters to linefeed
      set serializedDescriptions to windowDescriptions as text
      set AppleScript's text item delimiters to ""
      return serializedDescriptions
    end tell
  end run`;
  return execFileSync("osascript", ["-e", script, String(child.pid ?? -1)], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
}

async function clickMacOSFirstRunOpenButtonVisually(
  child: ChildProcess,
  reporter: Record<string, unknown>,
): Promise<string> {
  const screenshotPath = await captureDesktopScreenshot("obsidian-first-run-open-target.png");
  const screenshotSize = await pngDimensions(screenshotPath);
  const fallbackEvidenceBase = {
    screenshot: relative(reportDirectory, screenshotPath),
    screenshot_dimensions: screenshotSize,
  };
  reporter.first_run_open_visual_fallback = {
    status: "screenshot-captured",
    ...fallbackEvidenceBase,
  };
  const accessibilityEntries = macOSReadableAccessibilityWindowEntries(macOSApplicationWindowDescriptions(child));
  const applicationWindows = accessibilityEntries.filter((entry) => /^AXWindow:/i.test(entry));
  if (applicationWindows.length !== 1) {
    throw new Error(`The OCR fallback expected exactly one readable OpenObsidian top-level window; found ${applicationWindows.length}: ${JSON.stringify(applicationWindows)}`);
  }
  const windowMatch = /^AXWindow:[^|]+\|bounds=(-?\d+),(-?\d+),(\d+),(\d+)$/i.exec(applicationWindows[0] ?? "");
  if (!windowMatch) throw new Error(`The OCR fallback could not parse the single OpenObsidian window bounds: ${applicationWindows[0]}`);
  const windowBounds = {
    x: Number(windowMatch[1]),
    y: Number(windowMatch[2]),
    width: Number(windowMatch[3]),
    height: Number(windowMatch[4]),
  };
  if (!(windowBounds.width > 0 && windowBounds.height > 0 && screenshotSize.width > 0 && screenshotSize.height > 0)) {
    throw new Error(`The OCR fallback received invalid window or screenshot dimensions: window=${JSON.stringify(windowBounds)}; screenshot=${JSON.stringify(screenshotSize)}`);
  }

  const windowEvidenceBase = {
    ...fallbackEvidenceBase,
    application_window_bounds: windowBounds,
    accessibility_windows: applicationWindows,
  };
  reporter.first_run_open_visual_fallback = {
    status: "accessibility-window-verified-ocr-pending",
    ...windowEvidenceBase,
  };
  let candidates: MacOSVisionTextCandidate[];
  try {
    candidates = await readMacOSVisionTextCandidates(screenshotPath);
  } catch (error) {
    reporter.first_run_open_visual_fallback = {
      status: "failed-vision-ocr",
      ...windowEvidenceBase,
      error: error instanceof Error ? error.message : String(error),
    };
    throw error;
  }
  const normalizeText = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const validCandidate = (candidate: MacOSVisionTextCandidate): boolean => {
    const {x, y, width, height} = candidate.boundingBox;
    return candidate.confidence >= 0.8
      && width > 0 && height > 0
      && x >= 0 && y >= 0
      && x + width <= 1.001 && y + height <= 1.001;
  };
  const openCandidates = candidates.filter((candidate) => validCandidate(candidate) && normalizeText(candidate.text) === "open");
  const rowCandidates = candidates.filter((candidate) => validCandidate(candidate) && normalizeText(candidate.text) === "open folder as vault");
  if (openCandidates.length !== 1 || rowCandidates.length !== 1) {
    reporter.first_run_open_visual_fallback = {
      status: "failed-ambiguous-ocr",
      screenshot: relative(reportDirectory, screenshotPath),
      screenshot_dimensions: screenshotSize,
      open_candidate_count: openCandidates.length,
      row_label_candidate_count: rowCandidates.length,
      vision_candidates: candidates,
      accessibility_windows: applicationWindows,
    };
    throw new Error(`The macOS first-run OCR fallback requires one high-confidence standalone Open label and one exact Open folder as vault row label; found open=${openCandidates.length}, row=${rowCandidates.length}`);
  }

  const open = openCandidates[0]!;
  const row = rowCandidates[0]!;
  const openCenterX = open.boundingBox.x + open.boundingBox.width / 2;
  const openCenterYFromTop = 1 - (open.boundingBox.y + open.boundingBox.height / 2);
  const rowRight = row.boundingBox.x + row.boundingBox.width;
  const rowCenterYFromTop = 1 - (row.boundingBox.y + row.boundingBox.height / 2);
  const verticalAlignment = Math.abs(openCenterYFromTop - rowCenterYFromTop);
  const openLeft = open.boundingBox.x;
  const openRight = open.boundingBox.x + open.boundingBox.width;
  const openTop = 1 - (open.boundingBox.y + open.boundingBox.height);
  const openBottom = 1 - open.boundingBox.y;
  const displayScript = `import AppKit\nimport CoreGraphics\nimport Foundation\nlet screens = NSScreen.screens\nguard screens.count == 1 else { fatalError("Display metrics require the single-display macOS CI screen") }\nguard let screenNumber = screens[0].deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { fatalError("Could not read the macOS CI screen number") }\nlet displayID = CGDirectDisplayID(screenNumber.uint32Value)\nlet bounds = CGDisplayBounds(displayID)\nguard bounds.width > 0, bounds.height > 0 else { fatalError("Could not read the selected macOS display bounds") }\nlet screenCountText = String(screens.count)\nlet originXText = String(Double(bounds.origin.x))\nlet originYText = String(Double(bounds.origin.y))\nlet widthText = String(Double(bounds.width))\nlet heightText = String(Double(bounds.height))\nlet fields = [screenCountText, originXText, originYText, widthText, heightText]\nprint(fields.joined(separator: ","))`;
  let displayOutput: string;
  try {
    displayOutput = execFileSync("swift", ["-e", displayScript], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
  } catch (error) {
    const displayCommandError = error as Error & {stderr?: unknown; stdout?: unknown; status?: unknown; signal?: unknown};
    reporter.first_run_open_visual_fallback = {
      status: "failed-display-metrics",
      ...windowEvidenceBase,
      open_candidate: open,
      row_label_candidate: row,
      vision_candidates: candidates,
      error: error instanceof Error ? error.message : String(error),
      display_probe_stderr: displayCommandError.stderr == null ? "" : String(displayCommandError.stderr).trim(),
      display_probe_stdout: displayCommandError.stdout == null ? "" : String(displayCommandError.stdout).trim(),
      display_probe_exit_status: displayCommandError.status ?? null,
      display_probe_signal: displayCommandError.signal ?? null,
    };
    throw error;
  }
  const displayValues = displayOutput.split(",").map(Number);
  if (displayValues.length !== 5 || displayValues.some((value) => !Number.isFinite(value)) || displayValues[0] !== 1) {
    reporter.first_run_open_visual_fallback = {
      status: "failed-display-metrics",
      ...windowEvidenceBase,
      open_candidate: open,
      row_label_candidate: row,
      vision_candidates: candidates,
      display_values: displayValues,
    };
    throw new Error(`The macOS first-run OCR fallback requires one readable display; got ${JSON.stringify(displayValues)}`);
  }
  const displayBounds = {x: displayValues[1]!, y: displayValues[2]!, width: displayValues[3]!, height: displayValues[4]!};
  const screenshotAspect = screenshotSize.width / screenshotSize.height;
  const displayAspect = displayBounds.width / displayBounds.height;
  const clickX = displayBounds.x + openCenterX * displayBounds.width;
  const clickY = displayBounds.y + openCenterYFromTop * displayBounds.height;
  const targetLeft = displayBounds.x + openLeft * displayBounds.width;
  const targetRight = displayBounds.x + openRight * displayBounds.width;
  const targetTop = displayBounds.y + openTop * displayBounds.height;
  const targetBottom = displayBounds.y + openBottom * displayBounds.height;
  const insideWindow = targetLeft >= windowBounds.x
    && targetRight <= windowBounds.x + windowBounds.width
    && targetTop >= windowBounds.y
    && targetBottom <= windowBounds.y + windowBounds.height;
  if (openLeft <= rowRight
      || verticalAlignment > 0.04
      || !insideWindow
      || Math.abs(screenshotAspect - displayAspect) > 0.02) {
    reporter.first_run_open_visual_fallback = {
      status: "failed-geometry",
      screenshot: relative(reportDirectory, screenshotPath),
      screenshot_dimensions: screenshotSize,
      display_bounds: displayBounds,
      application_window_bounds: windowBounds,
      open_candidate: open,
      row_label_candidate: row,
      vertical_alignment_fraction: verticalAlignment,
      screenshot_aspect: screenshotAspect,
      display_aspect: displayAspect,
      candidate_inside_application_window: insideWindow,
      vision_candidates: candidates,
    };
    throw new Error(`The unique macOS Open OCR label was not aligned to the right of the exact Open folder as vault row inside the application window: horizontal=${openLeft > rowRight}; vertical_delta=${verticalAlignment}; inside_window=${insideWindow}; screenshot_aspect=${screenshotAspect}; display_aspect=${displayAspect}`);
  }

  const xFraction = Math.max(0, Math.min(1, openCenterX));
  const yFraction = Math.max(0, Math.min(1, openCenterYFromTop));
  const clickFractions = {x: xFraction, y: yFraction};
  const clickEvidence = {
    ...windowEvidenceBase,
    display_bounds: displayBounds,
    open_candidate: open,
    row_label_candidate: row,
    vertical_alignment_fraction: verticalAlignment,
    screenshot_aspect: screenshotAspect,
    display_aspect: displayAspect,
    candidate_inside_application_window: insideWindow,
    click_fractions: clickFractions,
    vision_candidates: candidates,
  };
  reporter.first_run_open_visual_fallback = {
    status: "geometry-verified-click-pending",
    ...clickEvidence,
  };
  let click: string;
  try {
    click = await clickMacOSDesktopFraction(xFraction, yFraction);
  } catch (error) {
    reporter.first_run_open_visual_fallback = {
      status: "failed-desktop-click",
      ...clickEvidence,
      error: error instanceof Error ? error.message : String(error),
    };
    throw error;
  }
  reporter.first_run_open_visual_fallback = {
    status: "mouse-events-dispatched-to-verified-ocr-target",
    ...clickEvidence,
    click,
  };
  return `System Events exposed no AXButton named Open; dispatched mouse events to the unique high-confidence OCR Open label aligned with the exact Open folder as vault row inside the application window. ${click}`;
}

async function clickMacOSFirstRunOpenButton(child: ChildProcess, reporter: Record<string, unknown>): Promise<string> {
  const script = `on run argv
    tell application "System Events"
      set targetProcess to first process whose unix id is (item 1 of argv as integer)
      set frontmost of targetProcess to true
      set matchingButtons to {}
      set accessibilityReadErrors to {}
      repeat with candidateWindow in windows of targetProcess
        set windowContents to {}
        try
          set windowContents to entire contents of candidateWindow
        on error errorMessage
          set end of accessibilityReadErrors to "first-run window descendant enumeration: " & errorMessage
        end try
        set descendantIndex to 0
        repeat with candidateButton in windowContents
          set descendantIndex to descendantIndex + 1
          try
            set candidateRole to role of candidateButton as text
            set candidateName to name of candidateButton as text
            if candidateRole is "AXButton" and candidateName is "Open" then
              set end of matchingButtons to candidateButton
            end if
          on error errorMessage
            set end of accessibilityReadErrors to "first-run descendant " & descendantIndex & " attributes: " & errorMessage
          end try
        end repeat
      end repeat
      if (count of accessibilityReadErrors) > 0 then
        set AppleScript's text item delimiters to " | "
        set errorSummary to accessibilityReadErrors as text
        set AppleScript's text item delimiters to ""
        error "First-run Open-button enumeration had accessibility read errors: " & errorSummary
      end if
      if (count of matchingButtons) is 0 then return "OPEN_BUTTON_NOT_EXPOSED"
      if (count of matchingButtons) is not 1 then error "Expected exactly one first-run Open accessibility button; found " & (count of matchingButtons)
      set targetButton to item 1 of matchingButtons
      if (visible of targetButton) is not true then error "The exact first-run Open accessibility button is not visible"
      if (enabled of targetButton) is not true then error "The exact first-run Open accessibility button is disabled"
      set buttonPosition to position of targetButton
      set buttonSize to size of targetButton
      if (item 1 of buttonSize) <= 0 or (item 2 of buttonSize) <= 0 then error "The exact first-run Open accessibility button has invalid bounds"
      click targetButton
      return "System Events dispatched a trusted click to the unique enabled AXButton Open at (" & (item 1 of buttonPosition as integer) & "," & (item 2 of buttonPosition as integer) & "," & (item 1 of buttonSize as integer) & "," & (item 2 of buttonSize as integer) & ")"
    end tell
  end run`;
  let output: string;
  try {
    output = execFileSync("osascript", ["-e", script, String(child.pid ?? -1)], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {stderr?: Buffer | string; stdout?: Buffer | string};
    const output = [failure.stdout, failure.stderr].filter(Boolean).map(String).join("\n").trim();
    throw new Error(`Could not activate the unique visible first-run Open button through macOS accessibility: ${output || failure.message}`);
  }
  if (output === "OPEN_BUTTON_NOT_EXPOSED") return await clickMacOSFirstRunOpenButtonVisually(child, reporter);
  return output;
}

function macOSAccessibilityWindowEntries(descriptions: string): string[] {
  return descriptions.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
}

function macOSReadableAccessibilityWindowEntries(descriptions: string): string[] {
  const entries = macOSAccessibilityWindowEntries(descriptions);
  if (entries.length === 0) throw new Error("The macOS accessibility inventory was empty");
  const readErrors = entries.filter((entry) => /^accessibility (?:error|read error):/i.test(entry));
  if (readErrors.length > 0) throw new Error(`The macOS accessibility inventory contains read errors: ${readErrors.join(" | ")}`);
  const incompleteEntries = entries.filter((entry) => /\|bounds=unavailable(?:\||$)/i.test(entry));
  if (incompleteEntries.length > 0) throw new Error(`The macOS accessibility inventory contains incomplete bounds: ${incompleteEntries.join(" | ")}`);
  const zeroSizeNativePanels = entries.filter((entry) => {
    const windowMatch = /^AXWindow:(?:Open|Open folder as vault)\|bounds=(-?\d+),(-?\d+),(\d+),(\d+)$/i.exec(entry);
    if (windowMatch && (Number(windowMatch[3]) <= 0 || Number(windowMatch[4]) <= 0)) return true;
    const sheetMatch = /^AXSheet:(?:Open|Open folder as vault)\|bounds=(-?\d+),(-?\d+),(\d+),(\d+)\|parent=AXWindow:[^|]+\|bounds=(-?\d+),(-?\d+),(\d+),(\d+)$/i.exec(entry);
    return Boolean(sheetMatch && (
      Number(sheetMatch[3]) <= 0
      || Number(sheetMatch[4]) <= 0
      || Number(sheetMatch[7]) <= 0
      || Number(sheetMatch[8]) <= 0
    ));
  });
  if (zeroSizeNativePanels.length > 0) {
    throw new Error(`The macOS accessibility inventory contains a zero-sized native Open panel or parent window: ${zeroSizeNativePanels.join(" | ")}`);
  }
  return entries;
}

function isMacOSNativeOpenPanelEntry(entry: string): boolean {
  const nativeWindow = /^AXWindow:(?:Open|Open folder as vault)\|bounds=-?\d+,-?\d+,[1-9]\d*,[1-9]\d*$/i;
  const nativeSheet = /^AXSheet:(?:Open|Open folder as vault)\|bounds=-?\d+,-?\d+,[1-9]\d*,[1-9]\d*\|parent=AXWindow:[^|]+\|bounds=-?\d+,-?\d+,[1-9]\d*,[1-9]\d*$/i;
  return nativeWindow.test(entry) || nativeSheet.test(entry);
}

function macOSNativeOpenPanelEntries(descriptions: string): string[] {
  return macOSReadableAccessibilityWindowEntries(descriptions).filter(isMacOSNativeOpenPanelEntry);
}

function macOSNativeOpenPanelIdentityCount(entries: string[], identity: string): number {
  return entries.filter((entry) => entry === identity && isMacOSNativeOpenPanelEntry(entry)).length;
}

function macOSNativeOpenPanelBounds(identity: string): {x: number; y: number; width: number; height: number} {
  const windowMatch = /^AXWindow:(?:Open|Open folder as vault)\|bounds=(-?\d+),(-?\d+),(\d+),(\d+)$/i.exec(identity);
  const sheetMatch = /^AXSheet:(?:Open|Open folder as vault)\|bounds=(-?\d+),(-?\d+),(\d+),(\d+)\|parent=AXWindow:[^|]+\|bounds=(-?\d+),(-?\d+),(\d+),(\d+)$/i.exec(identity);
  const match = windowMatch ?? sheetMatch;
  if (!match) throw new Error(`Cannot extract native Open panel bounds from accessibility identity ${identity}`);
  const bounds = {x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4])};
  if (!(bounds.width > 0 && bounds.height > 0)) {
    throw new Error(`Native Open panel accessibility identity has invalid bounds: ${identity}`);
  }
  return bounds;
}

function macOSAddedNativeOpenPanelEntries(before: string[], after: string[]): string[] {
  const remaining = new Map<string, number>();
  for (const entry of before) {
    if (!isMacOSNativeOpenPanelEntry(entry)) continue;
    remaining.set(entry, (remaining.get(entry) ?? 0) + 1);
  }
  const added: string[] = [];
  for (const entry of after) {
    if (!isMacOSNativeOpenPanelEntry(entry)) continue;
    const priorCount = remaining.get(entry) ?? 0;
    if (priorCount > 0) remaining.set(entry, priorCount - 1);
    else added.push(entry);
  }
  return added;
}

type WindowsTopLevelWindow = {
  name: string;
  class_name: string;
  process_id: number;
  native_window_handle: number;
  is_offscreen: boolean;
  read_error?: string;
};

function windowsTopLevelWindowInventory(): WindowsTopLevelWindow[] {
  const script = `
    $ErrorActionPreference = "Stop"
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $elements = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition
    )
    $windows = @()
    foreach ($element in $elements) {
      try {
        $current = $element.Current
        $name = [string]$current.Name
        $className = [string]$current.ClassName
        $processId = [int]$current.ProcessId
        $handle = [int]$current.NativeWindowHandle
        $isOffscreen = [bool]$current.IsOffscreen
        if ($name -or $className -or $handle -ne 0) {
          $windows += [PSCustomObject]@{
            name = $name
            class_name = $className
            process_id = $processId
            native_window_handle = $handle
            is_offscreen = $isOffscreen
          }
        }
      } catch {
        $windows += [PSCustomObject]@{
          name = ""
          class_name = "UIA_READ_ERROR"
          process_id = 0
          native_window_handle = 0
          is_offscreen = $true
          read_error = $_.Exception.Message
        }
      }
    }
    ConvertTo-Json -InputObject @($windows) -Depth 3 -Compress
  `;
  const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
  if (!output || output === "null") throw new Error("Windows top-level UIA inventory returned no JSON window list");
  let value: unknown;
  try {
    value = JSON.parse(output) as unknown;
  } catch (error) {
    const parseError = new Error(`Could not parse Windows top-level UIA inventory: ${error instanceof Error ? error.message : String(error)}`) as Error & {stdout: string};
    parseError.stdout = output;
    throw parseError;
  }
  if (!Array.isArray(value)) throw new Error(`Windows top-level UIA inventory must be a JSON array; received ${typeof value}`);
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Windows top-level UIA inventory entry ${index} is not an object`);
    }
    const candidate = entry as Record<string, unknown>;
    const processId = candidate.process_id;
    const nativeWindowHandle = candidate.native_window_handle;
    if (typeof candidate.name !== "string"
      || typeof candidate.class_name !== "string"
      || typeof processId !== "number" || !Number.isInteger(processId) || processId < 0
      || typeof nativeWindowHandle !== "number" || !Number.isSafeInteger(nativeWindowHandle) || nativeWindowHandle < 0
      || typeof candidate.is_offscreen !== "boolean"
      || (candidate.read_error !== undefined
        && (typeof candidate.read_error !== "string" || candidate.read_error.length === 0))) {
      throw new Error(`Windows top-level UIA inventory entry ${index} has invalid fields: ${JSON.stringify(candidate)}`);
    }
    return candidate as unknown as WindowsTopLevelWindow;
  });
}

function windowsOpenVaultControlInventory(processId: number): unknown {
  const script = `
    $ErrorActionPreference = "Stop"
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $application = Get-Process -Id $env:OPENOBSIDIAN_WINDOW_PROCESS_ID -ErrorAction SilentlyContinue
    if ($null -eq $application -or $application.MainWindowHandle -eq 0) {
      $application = Get-Process -Name "openobsidian" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    }
    if ($null -eq $application -or $application.MainWindowHandle -eq 0) { throw "OpenObsidian did not expose its main window handle" }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($application.MainWindowHandle)
    $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $controls = @()
    foreach ($element in $elements) {
      try {
        $current = $element.Current
        $name = [string]$current.Name
        $automationId = [string]$current.AutomationId
        $controlType = [string]$current.ControlType.ProgrammaticName
        if ($name -or $automationId -or $controlType -match "Button") {
          $bounds = $current.BoundingRectangle
          $controls += [PSCustomObject]@{
            name = $name
            automation_id = $automationId
            control_type = $controlType
            class_name = [string]$current.ClassName
            is_enabled = [bool]$current.IsEnabled
            is_offscreen = [bool]$current.IsOffscreen
            bounds = "$($bounds.Left),$($bounds.Top),$($bounds.Width),$($bounds.Height)"
          }
        }
      } catch {}
    }
    ConvertTo-Json -InputObject @($controls) -Depth 4 -Compress
  `;
  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      env: {...process.env, OPENOBSIDIAN_WINDOW_PROCESS_ID: String(processId)},
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return output ? JSON.parse(output) : [];
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {error: detail};
  }
}

function isNewWindowsNativePicker(windowDescription: WindowsTopLevelWindow, previousHandles: Set<number>, applicationPid: number): boolean {
  if (windowDescription.is_offscreen || previousHandles.has(windowDescription.native_window_handle)) return false;
  return windowDescription.process_id === applicationPid ||
    /open|folder|browse|select|choose/i.test(`${windowDescription.name} ${windowDescription.class_name}`) ||
    windowDescription.class_name === "#32770";
}

async function waitForRenderer(connection: DevToolsConnection, expression: string, predicate: (value: string) => boolean, label: string, timeoutMs = 120_000): Promise<string> {
  return await waitFor(label, async () => await connection.evaluateJson<string>(expression), predicate, timeoutMs);
}

async function captureObsidianScreenshot(connection: DevToolsConnection, filename: string): Promise<void> {
  const response = await connection.request("Page.captureScreenshot", {format: "png", captureBeyondViewport: false});
  const base64 = response.result?.data as string | undefined;
  if (!base64) throw new Error("Obsidian did not return a renderer screenshot");
  await writeFile(join(reportDirectory, filename), Buffer.from(base64, "base64"));
}

async function captureX11Screenshot(filename: string): Promise<string> {
  const xwdPath = join(reportDirectory, filename.replace(/\.png$/i, ".xwd"));
  const pngPath = join(reportDirectory, filename);
  execFileSync("xwd", ["-root", "-silent", "-out", xwdPath], {stdio: "ignore"});
  execFileSync("convert", [xwdPath, pngPath], {stdio: "ignore"});
  return pngPath;
}

async function captureDesktopScreenshot(filename: string): Promise<string> {
  if (process.platform === "linux") return await captureX11Screenshot(filename);
  const pngPath = join(reportDirectory, filename);
  if (process.platform === "darwin") {
    execFileSync("screencapture", ["-x", pngPath], {stdio: "ignore"});
    return pngPath;
  }
  const script = `
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save($env:OBSIDIAN_SCREENSHOT_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
  `;
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    env: {...process.env, OBSIDIAN_SCREENSHOT_PATH: pngPath},
    stdio: "ignore",
  });
  return pngPath;
}

async function captureX11WindowScreenshot(windowId: string, filename: string): Promise<string> {
  const xwdPath = join(reportDirectory, filename.replace(/\.png$/i, ".xwd"));
  const pngPath = join(reportDirectory, filename);
  execFileSync("xwd", ["-id", windowId, "-silent", "-out", xwdPath], {stdio: "ignore"});
  execFileSync("convert", [xwdPath, pngPath], {stdio: "ignore"});
  return pngPath;
}

async function captureMacOSWindowScreenshot(processId: number, filename: string): Promise<string> {
  let windowId = macOSWindowIds.get(processId);
  if (!windowId) {
    const script = `
      import CoreGraphics
      import Foundation

      let targetProcessId = ${processId}
      let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
      let targetWindow = windows.first { window in
        (window[kCGWindowOwnerPID as String] as? Int) == targetProcessId &&
        (window[kCGWindowLayer as String] as? Int) == 0
      }
      guard let windowNumber = targetWindow?[kCGWindowNumber as String] else {
        fputs("OpenObsidian did not expose an on-screen macOS window\\n", stderr)
        exit(1)
      }
      print(windowNumber)
    `;
    windowId = execFileSync("swift", ["-e", script], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim().split(/\s+/).at(-1);
    if (!windowId || !/^\d+$/.test(windowId)) throw new Error("Could not identify OpenObsidian's macOS window for screenshot capture");
    macOSWindowIds.set(processId, windowId);
  }
  const pngPath = join(reportDirectory, filename);
  execFileSync("screencapture", ["-x", `-l${windowId}`, pngPath], {stdio: "ignore"});
  return pngPath;
}

async function captureWindowsWindowScreenshot(processId: number, filename: string): Promise<{
  pngPath: string;
  window_id: string;
  title: string;
  geometry: string;
}> {
  const pngPath = join(reportDirectory, filename);
  const script = `
    $ErrorActionPreference = "Stop"
    Add-Type -AssemblyName System.Drawing
    Add-Type -TypeDefinition @'
      using System;
      using System.Runtime.InteropServices;
      public struct OpenObsidianWindowRect {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
      }
      public static class OpenObsidianWindowCapture {
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out OpenObsidianWindowRect rect);
      }
'@
    $application = Get-Process -Id $env:OPENOBSIDIAN_WINDOW_PROCESS_ID -ErrorAction SilentlyContinue
    if ($null -eq $application -or $application.MainWindowHandle -eq 0) {
      $application = Get-Process -Name "openobsidian" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    }
    if ($null -eq $application -or $application.MainWindowHandle -eq 0) {
      throw "Could not find the OpenObsidian main window for process $env:OPENOBSIDIAN_WINDOW_PROCESS_ID"
    }
    $bounds = New-Object OpenObsidianWindowRect
    if (-not [OpenObsidianWindowCapture]::GetWindowRect($application.MainWindowHandle, [ref]$bounds)) {
      throw "Could not read the OpenObsidian main window bounds"
    }
    $width = $bounds.Right - $bounds.Left
    $height = $bounds.Bottom - $bounds.Top
    if ($width -le 0 -or $height -le 0) {
      throw "OpenObsidian reported invalid window bounds: $($bounds.Left),$($bounds.Top),$width,$height"
    }
    $bitmap = [System.Drawing.Bitmap]::new($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
      $bitmap.Save($env:OBSIDIAN_SCREENSHOT_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
    [ordered]@{
      window_id = $application.MainWindowHandle.ToInt64().ToString()
      title = $application.MainWindowTitle
      geometry = "x=$($bounds.Left) y=$($bounds.Top) width=$width height=$height"
    } | ConvertTo-Json -Compress
  `;
  const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    env: {...process.env, OBSIDIAN_SCREENSHOT_PATH: pngPath, OPENOBSIDIAN_WINDOW_PROCESS_ID: String(processId)},
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const window = JSON.parse(output) as {window_id: string; title: string; geometry: string};
  return {pngPath, ...window};
}

async function prepareScreenshotForOcr(imagePath: string): Promise<string> {
  const ocrImagePath = join(reportDirectory, "openobsidian-vault-window-ocr.png");
  const imageMagick = process.platform === "linux" ? "convert" : "magick";
  execFileSync(imageMagick, [imagePath, "-colorspace", "Gray", "-level", "0%,15%", "-resize", "200%", ocrImagePath], {stdio: "ignore"});
  return ocrImagePath;
}

async function readScreenshotOcr(imagePath: string): Promise<string> {
  const ocrImagePath = await prepareScreenshotForOcr(imagePath);
  const pageSegmentationModes = process.platform === "darwin" || process.platform === "win32" ? ["11", "6"] : ["6"];
  return runTesseractOcr(ocrImagePath, pageSegmentationModes);
}

async function readNativeFolderPickerOcr(imagePath: string, panelIdentity?: string): Promise<string> {
  if (process.platform !== "darwin") return await readScreenshotOcr(imagePath);
  return (await inspectMacOSNativeOpenPanelScreenshot(imagePath, panelIdentity)).visible_text;
}

function runTesseractOcr(imagePath: string, pageSegmentationModes: string[]): string {
  const tesseract = process.platform === "win32" ? "tesseract.exe" : "tesseract";
  return pageSegmentationModes.map((mode) => execFileSync(tesseract, [imagePath, "stdout", "--psm", mode], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim()).filter(Boolean).join("\n");
}

function runTesseractTsv(imagePath: string, pageSegmentationMode = "6"): string {
  const tesseract = process.platform === "win32" ? "tesseract.exe" : "tesseract";
  return execFileSync(tesseract, [imagePath, "stdout", "--psm", pageSegmentationMode, "tsv"], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
}

type MacOSVisionTextCandidate = {
  text: string;
  confidence: number;
  boundingBox: {x: number; y: number; width: number; height: number};
};

async function readMacOSVisionTextCandidates(imagePath: string): Promise<MacOSVisionTextCandidate[]> {
  const swiftPath = join(workDirectory, "openobsidian-canvas-field-vision-ocr.swift");
  await writeFile(swiftPath, `import Foundation
import Vision

guard CommandLine.arguments.count == 2 else {
    fatalError("Expected a PNG image path")
}
let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US"]
let handler = VNImageRequestHandler(url: imageURL, options: [:])
try handler.perform([request])
let candidates = (request.results ?? []).compactMap { observation -> [String: Any]? in
    guard let recognized = observation.topCandidates(1).first else { return nil }
    let bounds = observation.boundingBox
    return [
        "text": recognized.string,
        "confidence": Double(recognized.confidence),
        "boundingBox": [
            "x": Double(bounds.origin.x),
            "y": Double(bounds.origin.y),
            "width": Double(bounds.width),
            "height": Double(bounds.height)
        ]
    ]
}
let data = try JSONSerialization.data(withJSONObject: candidates, options: [.sortedKeys])
print(String(decoding: data, as: UTF8.self))
`);
  const output = execFileSync("swift", [swiftPath, imagePath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 30_000,
  }).trim();
  const candidates = JSON.parse(output) as MacOSVisionTextCandidate[];
  if (!Array.isArray(candidates) || candidates.some((candidate) =>
    typeof candidate.text !== "string"
    || !Number.isFinite(candidate.confidence)
    || candidate.confidence < 0
    || candidate.confidence > 1
    || ![candidate.boundingBox?.x, candidate.boundingBox?.y, candidate.boundingBox?.width, candidate.boundingBox?.height].every(Number.isFinite)
  )) {
    throw new Error("macOS Vision OCR returned an invalid text-candidate payload");
  }
  return candidates;
}

async function inspectMacOSNativeOpenPanelScreenshot(
  imagePath: string,
  panelIdentity?: string,
): Promise<{
  method: "macOS Vision";
  screenshot_dimensions: {width: number; height: number};
  panel_identity: string | null;
  panel_bounds: {x: number; y: number; width: number; height: number} | null;
  visible_text: string;
  vision_candidates: MacOSVisionTextCandidate[];
  exact_cancel_candidates: MacOSVisionTextCandidate[];
  exact_open_candidates: MacOSVisionTextCandidate[];
  confirmed_native_picker_buttons: boolean;
}> {
  const screenshotDimensions = await pngDimensions(imagePath);
  if (!(screenshotDimensions.width > 0 && screenshotDimensions.height > 0)) {
    throw new Error(`macOS native picker screenshot has invalid dimensions: ${JSON.stringify(screenshotDimensions)}`);
  }
  const candidates = await readMacOSVisionTextCandidates(imagePath);
  const panelBounds = panelIdentity ? macOSNativeOpenPanelBounds(panelIdentity) : null;
  if (panelBounds && (
    panelBounds.x < 0
    || panelBounds.y < 0
    || panelBounds.x + panelBounds.width > screenshotDimensions.width + 2
    || panelBounds.y + panelBounds.height > screenshotDimensions.height + 2
  )) {
    throw new Error(`The exact macOS accessibility panel bounds do not fit the screenshot dimensions: panel=${JSON.stringify(panelBounds)} screenshot=${JSON.stringify(screenshotDimensions)}`);
  }
  const validCandidate = (candidate: MacOSVisionTextCandidate): boolean => {
    const {x, y, width, height} = candidate.boundingBox;
    return candidate.confidence >= 0.5
      && width > 0 && height > 0
      && x >= 0 && y >= 0
      && x + width <= 1.001 && y + height <= 1.001;
  };
  const candidateBoundsAreInsidePanel = (candidate: MacOSVisionTextCandidate): boolean => {
    if (!panelBounds) return true;
    const left = candidate.boundingBox.x * screenshotDimensions.width;
    const right = (candidate.boundingBox.x + candidate.boundingBox.width) * screenshotDimensions.width;
    const top = (1 - candidate.boundingBox.y - candidate.boundingBox.height) * screenshotDimensions.height;
    const bottom = (1 - candidate.boundingBox.y) * screenshotDimensions.height;
    return left >= panelBounds.x - 2
      && right <= panelBounds.x + panelBounds.width + 2
      && top >= panelBounds.y - 2
      && bottom <= panelBounds.y + panelBounds.height + 2;
  };
  const visibleCandidates = candidates.filter((candidate) => validCandidate(candidate) && candidateBoundsAreInsidePanel(candidate));
  const normalizeLabel = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const exactCancelCandidates = panelBounds
    ? visibleCandidates.filter((candidate) => candidate.confidence >= 0.8 && normalizeLabel(candidate.text) === "cancel")
    : [];
  const exactOpenCandidates = panelBounds
    ? visibleCandidates.filter((candidate) => candidate.confidence >= 0.8 && normalizeLabel(candidate.text) === "open")
    : [];
  let buttonGeometryIsPlausible = false;
  if (panelBounds && exactCancelCandidates.length === 1 && exactOpenCandidates.length === 1) {
    const cancel = exactCancelCandidates[0]!;
    const open = exactOpenCandidates[0]!;
    const center = (candidate: MacOSVisionTextCandidate) => ({
      x: (candidate.boundingBox.x + candidate.boundingBox.width / 2) * screenshotDimensions.width,
      y: (1 - candidate.boundingBox.y - candidate.boundingBox.height / 2) * screenshotDimensions.height,
    });
    const cancelCenter = center(cancel);
    const openCenter = center(open);
    const cancelXFraction = (cancelCenter.x - panelBounds.x) / panelBounds.width;
    const openXFraction = (openCenter.x - panelBounds.x) / panelBounds.width;
    const cancelYFraction = (cancelCenter.y - panelBounds.y) / panelBounds.height;
    const openYFraction = (openCenter.y - panelBounds.y) / panelBounds.height;
    buttonGeometryIsPlausible = cancelCenter.x < openCenter.x
      && cancelXFraction >= 0.5
      && openXFraction >= 0.7
      && cancelYFraction >= 0.78
      && openYFraction >= 0.78
      && Math.abs(cancelYFraction - openYFraction) <= 0.07;
  }
  return {
    method: "macOS Vision",
    screenshot_dimensions: screenshotDimensions,
    panel_identity: panelIdentity ?? null,
    panel_bounds: panelBounds,
    visible_text: visibleCandidates.map((candidate) => candidate.text).join("\n"),
    vision_candidates: visibleCandidates,
    exact_cancel_candidates: exactCancelCandidates,
    exact_open_candidates: exactOpenCandidates,
    confirmed_native_picker_buttons: buttonGeometryIsPlausible,
  };
}

function ocrTokenMatches(token: string, expected: string): boolean {
  if (token === expected) return true;
  if (Math.abs(token.length - expected.length) > 1) return false;

  let previous = Array.from({length: expected.length + 1}, (_, index) => index);
  for (let tokenIndex = 1; tokenIndex <= token.length; tokenIndex += 1) {
    const current = [tokenIndex];
    for (let expectedIndex = 1; expectedIndex <= expected.length; expectedIndex += 1) {
      current.push(Math.min(
        (current[expectedIndex - 1] ?? 0) + 1,
        (previous[expectedIndex] ?? 0) + 1,
        (previous[expectedIndex - 1] ?? 0) + Number(token[tokenIndex - 1] !== expected[expectedIndex - 1]),
      ));
    }
    previous = current;
  }
  return previous[expected.length] <= 1;
}

function ocrTextContainsPhrase(text: string, phrase: string): boolean {
  const normalizedText = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalizedPhrase = phrase.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalizedText.includes(normalizedPhrase);
}

function canvasFormFieldLabelsVisible(text: string): boolean {
  return ocrTextContainsFuzzyPhrase(text, "Canvas path")
    && ocrTextContainsFuzzyPhrase(text, "Text card ID")
    && ocrTextContainsFuzzyPhrase(text, "New markdown path");
}

function editDistanceWithinLimit(left: string, right: string, limit: number): boolean {
  if (Math.abs(left.length - right.length) > limit) return false;

  let previous = Array.from({length: right.length + 1}, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current.push(Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + Number(left[leftIndex - 1] !== right[rightIndex - 1]),
      ));
    }
    previous = current;
  }
  return (previous[right.length] ?? Number.POSITIVE_INFINITY) <= limit;
}

function ocrTextContainsFuzzyPhrase(text: string, phrase: string, maxEdits = 2): boolean {
  const normalizedPhrase = phrase.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalizedPhrase) return false;
  const minimumLength = Math.max(1, normalizedPhrase.length - maxEdits);
  const maximumLength = normalizedPhrase.length + maxEdits;

  for (const line of text.split(/\r?\n/)) {
    const normalizedLine = line.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (let length = minimumLength; length <= maximumLength; length += 1) {
      for (let start = 0; start + length <= normalizedLine.length; start += 1) {
        if (editDistanceWithinLimit(normalizedLine.slice(start, start + length), normalizedPhrase, maxEdits)) {
          return true;
        }
      }
    }
  }
  return false;
}

function ocrTextContainsFuzzyPhraseAcrossLines(text: string, phrase: string, maxEdits = 1): boolean {
  return ocrTextContainsFuzzyPhrase(text.replace(/\r?\n/g, " "), phrase, maxEdits);
}

function ocrTextContainsRefreshedMarkdownCount(text: string, count: number): boolean {
  const status = "notelistrefreshed";
  const markdownCountLabel = "markdownfilesfound";
  const expectedCount = String(count);
  const statusMinLength = Math.max(1, status.length - 2);
  const statusMaxLength = status.length + 2;
  const labelMinLength = Math.max(1, markdownCountLabel.length - 2);
  const labelMaxLength = markdownCountLabel.length + 2;

  for (const line of text.split(/\r?\n/)) {
    const normalizedLine = line.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (let statusLength = statusMinLength; statusLength <= statusMaxLength; statusLength += 1) {
      for (let statusStart = 0; statusStart + statusLength <= normalizedLine.length; statusStart += 1) {
        const candidateStatus = normalizedLine.slice(statusStart, statusStart + statusLength);
        if (!editDistanceWithinLimit(candidateStatus, status, 2)) continue;

        const afterStatus = normalizedLine.slice(statusStart + statusLength);
        if (!afterStatus.startsWith(expectedCount)) continue;
        const afterCount = afterStatus.slice(expectedCount.length);
        if (/^[0-9]/.test(afterCount)) continue;

        for (
          let labelLength = labelMinLength;
          labelLength <= Math.min(labelMaxLength, afterCount.length);
          labelLength += 1
        ) {
          if (
            editDistanceWithinLimit(afterCount.slice(0, labelLength), markdownCountLabel, 2)
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function windowsSelectionConfirmsPath(action: unknown, expectedPath: string): boolean {
  if (typeof action !== "string") return false;
  try {
    const selection = JSON.parse(action) as {
      action?: unknown;
      control_type?: unknown;
      name?: unknown;
    };
    return selection.name === expectedPath
      && selection.control_type === "ControlType.RadioButton"
      && selection.action === "SelectionItemPattern.Select";
  } catch {
    return false;
  }
}

function windowsSelectorOpenConfirms(action: unknown): boolean {
  if (typeof action !== "string") return false;
  try {
    const opening = JSON.parse(action) as {
      action?: unknown;
      control_type?: unknown;
      name?: unknown;
    };
    return opening.name === "Note to inspect"
      && opening.control_type === "ControlType.Button"
      && opening.action === "InvokePattern.Invoke";
  } catch {
    return false;
  }
}

function windowsSelectorDismissConfirmsClosed(action: unknown): boolean {
  if (typeof action !== "string") return false;
  try {
    const dismissal = JSON.parse(action) as {
      control_type?: unknown;
      name?: unknown;
      dismissal_action?: unknown;
      visible_note_options_before_dismissal?: unknown;
      visible_note_options_after_dismissal?: unknown;
      stable_empty_scans?: unknown;
      selector_visible_after_dismissal?: unknown;
      selector_is_offscreen_before_dismissal?: unknown;
      selector_is_offscreen_after_dismissal?: unknown;
      expand_collapse_read_status_before?: unknown;
      expand_collapse_read_status_after?: unknown;
      expand_collapse_supported_before?: unknown;
      expand_collapse_state_before?: unknown;
      expand_collapse_supported_after?: unknown;
      expand_collapse_state_after?: unknown;
      target_option_visible_before_dismissal?: unknown;
      target_option_visible_after_dismissal?: unknown;
    };
    const visibleBefore = typeof dismissal.visible_note_options_before_dismissal === "number"
      ? dismissal.visible_note_options_before_dismissal
      : -1;
    const expandedBefore = dismissal.expand_collapse_state_before === "Expanded"
      || dismissal.expand_collapse_state_before === "PartiallyExpanded";
    const escapeWasJustified = visibleBefore > 0
      ? dismissal.target_option_visible_before_dismissal === true
        && (dismissal.expand_collapse_read_status_before === "unsupported"
          || (dismissal.expand_collapse_read_status_before === "supported" && expandedBefore))
      : visibleBefore === 0
        && dismissal.expand_collapse_read_status_before === "supported"
        && expandedBefore;
    const alreadyCollapsedWasObserved = visibleBefore === 0
      && dismissal.target_option_visible_before_dismissal === false
      && dismissal.expand_collapse_read_status_before === "supported"
      && dismissal.expand_collapse_state_before === "Collapsed";
    const collapsedAfter = dismissal.expand_collapse_read_status_after === "supported"
      ? dismissal.expand_collapse_state_after === "Collapsed"
      : dismissal.expand_collapse_read_status_after === "unsupported"
        && dismissal.expand_collapse_read_status_before === "unsupported"
        && dismissal.dismissal_action === "WScript.Shell.SendKeys(Escape)"
        && visibleBefore > 0;
    return dismissal.name === "Note to inspect"
      && dismissal.control_type === "ControlType.Button"
      && (dismissal.dismissal_action === "WScript.Shell.SendKeys(Escape)"
        || dismissal.dismissal_action === "already-collapsed")
      && typeof dismissal.visible_note_options_before_dismissal === "number"
      && ((dismissal.dismissal_action === "WScript.Shell.SendKeys(Escape)" && escapeWasJustified)
        || (dismissal.dismissal_action === "already-collapsed" && alreadyCollapsedWasObserved))
      && dismissal.visible_note_options_after_dismissal === 0
      && dismissal.stable_empty_scans === 3
      && dismissal.selector_visible_after_dismissal === true
      && dismissal.selector_is_offscreen_before_dismissal === false
      && dismissal.selector_is_offscreen_after_dismissal === false
      && collapsedAfter
      && dismissal.target_option_visible_after_dismissal === false;
  } catch {
    return false;
  }
}

function windowsNoteSelectorObservationConfirmsSameTarget(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  expectedPath?: string,
): boolean {
  const beforeTarget = before.target_option as Record<string, unknown> | null;
  const afterTarget = after.target_option as Record<string, unknown> | null;
  if (!beforeTarget || !afterTarget) return false;
  if (before.selector_count !== 1 || after.selector_count !== 1) return false;
  if (before.selector_is_offscreen !== false || after.selector_is_offscreen !== false) return false;
  if (beforeTarget.name !== afterTarget.name || beforeTarget.control_type !== "ControlType.RadioButton") return false;
  if (afterTarget.control_type !== "ControlType.RadioButton") return false;
  if (expectedPath !== undefined && (beforeTarget.name !== expectedPath || afterTarget.name !== expectedPath)) return false;
  if (beforeTarget.is_offscreen !== false || afterTarget.is_offscreen !== false) return false;
  if (beforeTarget.positive_bounds !== true || afterTarget.positive_bounds !== true) return false;
  const supportedBefore = before.selector_expand_collapse_supported === true;
  const supportedAfter = after.selector_expand_collapse_supported === true;
  if (supportedBefore !== supportedAfter) return false;
  if (supportedBefore && (
    !["Expanded", "PartiallyExpanded"].includes(String(before.selector_expand_collapse_state))
    || !["Expanded", "PartiallyExpanded"].includes(String(after.selector_expand_collapse_state))
  )) return false;
  return (["left", "top", "width", "height"] as const).every((key) => {
    const beforeValue = Number(beforeTarget[key]);
    const afterValue = Number(afterTarget[key]);
    return Number.isFinite(beforeValue) && Number.isFinite(afterValue) && Math.abs(beforeValue - afterValue) <= 1;
  });
}

async function captureWindowsNoteSelectorOptionScreenshot(
  filename: string,
  targetOption: Record<string, unknown>,
): Promise<{pngPath: string; geometry: string}> {
  const pngPath = join(reportDirectory, filename);
  const coordinates = ["left", "top", "width", "height"].map((key) => Number(targetOption[key]));
  if (!coordinates.every(Number.isFinite) || coordinates[2] <= 0 || coordinates[3] <= 0) {
    throw new Error(`Windows note selector target has invalid UI Automation bounds: ${JSON.stringify(targetOption)}`);
  }
  const script = `
    $ErrorActionPreference = "Stop"
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $targetLeft = [int][math]::Floor([double]$env:OPENOBSIDIAN_TARGET_LEFT)
    $targetTop = [int][math]::Floor([double]$env:OPENOBSIDIAN_TARGET_TOP)
    $targetRight = [int][math]::Ceiling($targetLeft + [double]$env:OPENOBSIDIAN_TARGET_WIDTH)
    $targetBottom = [int][math]::Ceiling($targetTop + [double]$env:OPENOBSIDIAN_TARGET_HEIGHT)
    $left = [math]::Max($screen.Left, $targetLeft - 24)
    $top = [math]::Max($screen.Top, $targetTop - 8)
    $right = [math]::Min($screen.Right, $targetRight + 24)
    $bottom = [math]::Min($screen.Bottom, $targetBottom + 8)
    $width = $right - $left
    $height = $bottom - $top
    if ($width -le 0 -or $height -le 0) {
      throw "The note-selector target bounds do not intersect the visible desktop: x=$left y=$top width=$width height=$height"
    }
    $bitmap = [System.Drawing.Bitmap]::new($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($left, $top, 0, 0, $bitmap.Size)
      $bitmap.Save($env:OBSIDIAN_SCREENSHOT_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
    [ordered]@{geometry = "x=$left y=$top width=$width height=$height"} | ConvertTo-Json -Compress
  `;
  const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      OBSIDIAN_SCREENSHOT_PATH: pngPath,
      OPENOBSIDIAN_TARGET_LEFT: String(coordinates[0]),
      OPENOBSIDIAN_TARGET_TOP: String(coordinates[1]),
      OPENOBSIDIAN_TARGET_WIDTH: String(coordinates[2]),
      OPENOBSIDIAN_TARGET_HEIGHT: String(coordinates[3]),
    },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const capture = JSON.parse(output) as {geometry?: unknown};
  if (typeof capture.geometry !== "string") {
    throw new Error(`Windows note selector screenshot returned no crop geometry: ${output}`);
  }
  return {pngPath, geometry: capture.geometry};
}

async function readWindowsExpandedNoteSelectorTarget(
  child: ChildProcess,
  expectedPath: string,
): Promise<Record<string, unknown>> {
  const processId = child.pid;
  if (!processId) throw new Error("OpenObsidian did not expose its process id for note selector inspection");
  const script = `
    $ErrorActionPreference = "Stop"
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $processId = [int]$env:OPENOBSIDIAN_WINDOW_PROCESS_ID
    $expectedPath = $env:OPENOBSIDIAN_EXPECTED_NOTE_PATH.Replace([string][char]92, "/")
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $condition = [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
      $processId
    )
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    $lastObservation = $null
    while ([DateTime]::UtcNow -lt $deadline) {
      $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
      $selectors = @()
      $targetOptions = @()
      $visibleNoteOptionNames = @()
      foreach ($element in $elements) {
        try {
          $current = $element.Current
          if ($current.ControlType.ProgrammaticName -eq "ControlType.Button" -and $current.Name -eq "Note to inspect") {
            $selectors += $element
          }
          if ($current.ControlType.ProgrammaticName -ne "ControlType.RadioButton" -or $current.IsOffscreen) { continue }
          $normalizedName = $current.Name.Replace([string][char]92, "/")
          if ($normalizedName -match "\\.(md|base|canvas)$") { $visibleNoteOptionNames += $normalizedName }
          if ($normalizedName -ceq $expectedPath) {
            $bounds = $current.BoundingRectangle
            $targetOptions += [pscustomobject]@{
              element = $element
              name = $normalizedName
              is_offscreen = [bool]$current.IsOffscreen
              left = [double]$bounds.Left
              top = [double]$bounds.Top
              width = [double]$bounds.Width
              height = [double]$bounds.Height
            }
          }
        } catch {
          throw "Could not read a note selector UI Automation element: $($_.Exception.Message)"
        }
      }
      $selectorState = "unsupported"
      $selectorIsOffscreen = $null
      $selectorSupported = $false
      if ($selectors.Count -eq 1) {
        $selectorIsOffscreen = [bool]$selectors[0].Current.IsOffscreen
        $expandPattern = $null
        $selectorSupported = $selectors[0].TryGetCurrentPattern(
          [System.Windows.Automation.ExpandCollapsePattern]::Pattern,
          [ref]$expandPattern
        )
        if ($selectorSupported) { $selectorState = $expandPattern.Current.ExpandCollapseState.ToString() }
      }
      $target = if ($targetOptions.Count -eq 1) { $targetOptions[0] } else { $null }
      $positiveTargetBounds = $null -ne $target -and $target.width -gt 0 -and $target.height -gt 0
      $lastObservation = [pscustomobject]@{
        selector_count = $selectors.Count
        selector_is_offscreen = $selectorIsOffscreen
        selector_expand_collapse_supported = [bool]$selectorSupported
        selector_expand_collapse_state = $selectorState
        visible_note_option_names = @($visibleNoteOptionNames)
        exact_target_match_count = $targetOptions.Count
        target_option = if ($target) {
          [pscustomobject]@{
            name = $target.name
            control_type = "ControlType.RadioButton"
            is_offscreen = $target.is_offscreen
            left = $target.left
            top = $target.top
            width = $target.width
            height = $target.height
            positive_bounds = $positiveTargetBounds
          }
        } else { $null }
      }
      $selectorIsExpanded = $selectorState -in @("Expanded", "PartiallyExpanded")
      $targetProvesExpanded = -not $selectorSupported -and $null -ne $target
      if ($selectors.Count -eq 1 -and -not $selectorIsOffscreen -and
          $targetOptions.Count -eq 1 -and $positiveTargetBounds -and
          ($selectorIsExpanded -or $targetProvesExpanded)) {
        $lastObservation | ConvertTo-Json -Compress -Depth 5
        exit 0
      }
      Start-Sleep -Milliseconds 250
    }
    throw "Timed out waiting for the exact visible note selector option; expected=$expectedPath; last=$($lastObservation | ConvertTo-Json -Compress -Depth 5)"
  `;
  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENOBSIDIAN_WINDOW_PROCESS_ID: String(processId),
        OPENOBSIDIAN_EXPECTED_NOTE_PATH: expectedPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return JSON.parse(output) as Record<string, unknown>;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {stderr?: Buffer | string; stdout?: Buffer | string};
    const output = [failure.stdout, failure.stderr].filter(Boolean).map(String).join("\n").trim();
    throw new Error(`Could not confirm the expanded Windows note selector for ${expectedPath}: ${output || failure.message}`);
  }
}

async function readWindowsSelectedNoteSelectorState(
  child: ChildProcess,
  expectedPath: string,
): Promise<Record<string, unknown>> {
  const processId = child.pid;
  if (!processId) throw new Error("OpenObsidian did not expose its process id for selected-note verification");
  const script = `
    $ErrorActionPreference = "Stop"
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $processId = [int]$env:OPENOBSIDIAN_WINDOW_PROCESS_ID
    $expectedPath = $env:OPENOBSIDIAN_EXPECTED_NOTE_PATH.Replace([string][char]92, "/")
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $condition = [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
      $processId
    )
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    $lastObservation = $null
    while ([DateTime]::UtcNow -lt $deadline) {
      $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
      $selectors = @()
      foreach ($element in $elements) {
        try {
          $current = $element.Current
          if ($current.ControlType.ProgrammaticName -eq "ControlType.Button" -and $current.Name -eq "Note to inspect") {
            $selectors += $element
          }
        } catch { throw "Could not read a note selector button: $($_.Exception.Message)" }
      }
      $selectorOffscreen = $null
      $valuePatternSupported = $false
      $selectorValue = $null
      $targetOptions = @()
      if ($selectors.Count -eq 1) {
        try {
          $selectorOffscreen = [bool]$selectors[0].Current.IsOffscreen
          $valuePattern = $null
          $valuePatternSupported = $selectors[0].TryGetCurrentPattern(
            [System.Windows.Automation.ValuePattern]::Pattern,
            [ref]$valuePattern
          )
          if ($valuePatternSupported) { $selectorValue = [string]$valuePattern.Current.Value }
        } catch { throw "Could not read the note selector value: $($_.Exception.Message)" }
        foreach ($element in $elements) {
          try {
            $current = $element.Current
            if ($current.ControlType.ProgrammaticName -ne "ControlType.RadioButton" -or $current.IsOffscreen) { continue }
            $normalizedName = $current.Name.Replace([string][char]92, "/")
            if ($normalizedName -cne $expectedPath) { continue }
            $selectionPattern = $null
            $selectionPatternSupported = $element.TryGetCurrentPattern(
              [System.Windows.Automation.SelectionItemPattern]::Pattern,
              [ref]$selectionPattern
            )
            $targetOptions += [pscustomobject]@{
              name = $normalizedName
              control_type = $current.ControlType.ProgrammaticName
              is_offscreen = [bool]$current.IsOffscreen
              selection_pattern_supported = [bool]$selectionPatternSupported
              is_selected = if ($selectionPatternSupported) { [bool]$selectionPattern.Current.IsSelected } else { $false }
            }
          } catch { throw "Could not read the exact selected note option: $($_.Exception.Message)" }
        }
      }
      $normalizedValue = if ($null -ne $selectorValue) { $selectorValue.Replace([string][char]92, "/") } else { $null }
      $targetOptionSelected = $false
      if ($targetOptions.Count -eq 1) {
        $targetOptionSelected = [bool]$targetOptions[0].selection_pattern_supported -and [bool]$targetOptions[0].is_selected
      }
      $lastObservation = [pscustomobject]@{
        selector_count = $selectors.Count
        selector_is_offscreen = $selectorOffscreen
        value_pattern_supported = [bool]$valuePatternSupported
        selector_value = $selectorValue
        normalized_selector_value = $normalizedValue
        expected_path = $expectedPath
        target_option_count = $targetOptions.Count
        target_option = if ($targetOptions.Count -eq 1) { $targetOptions[0] } else { $null }
        target_option_is_selected = [bool]$targetOptionSelected
      }
      $targetOptionStateAcceptable = $targetOptions.Count -eq 1 -and $targetOptionSelected
      if ($selectors.Count -eq 1 -and -not $selectorOffscreen -and $valuePatternSupported -and $normalizedValue -ceq $expectedPath -and $targetOptionStateAcceptable) {
        $lastObservation | ConvertTo-Json -Compress -Depth 5
        exit 0
      }
      Start-Sleep -Milliseconds 250
    }
    throw "Timed out waiting for the note selector to reflect the exact selected path; expected=$expectedPath; last=$($lastObservation | ConvertTo-Json -Compress -Depth 5)"
  `;
  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENOBSIDIAN_WINDOW_PROCESS_ID: String(processId),
        OPENOBSIDIAN_EXPECTED_NOTE_PATH: expectedPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return JSON.parse(output) as Record<string, unknown>;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {stderr?: Buffer | string; stdout?: Buffer | string};
    const output = [failure.stdout, failure.stderr].filter(Boolean).map(String).join("\n").trim();
    throw new Error(`Could not verify the selected Windows note path ${expectedPath}: ${output || failure.message}`);
  }
}

function windowsSelectedNoteSelectorConfirmsPath(observation: unknown, expectedPath: string): boolean {
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) return false;
  const state = observation as Record<string, unknown>;
  const normalizePath = (value: unknown) => typeof value === "string" ? value.replace(/\\/g, "/") : null;
  const targetOptionCount = Number(state.target_option_count);
  const optionStateAcceptable = targetOptionCount === 1 && state.target_option_is_selected === true;
  return state.selector_count === 1
    && state.selector_is_offscreen === false
    && state.value_pattern_supported === true
    && normalizePath(state.normalized_selector_value ?? state.selector_value) === normalizePath(expectedPath)
    && optionStateAcceptable;
}

async function dismissWindowsNoteSelectorMenu(child: ChildProcess, expectedPath: string): Promise<string> {
  const processId = child.pid;
  if (!processId) throw new Error("OpenObsidian did not expose its process id for Windows note selector dismissal");
  const script = `
    $ErrorActionPreference = "Stop"
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $processId = [int]$env:OPENOBSIDIAN_WINDOW_PROCESS_ID
    $expectedPath = $env:OPENOBSIDIAN_EXPECTED_NOTE_PATH.Replace([string][char]92, "/")
    $shell = New-Object -ComObject WScript.Shell
    if (-not $shell.AppActivate($processId)) { throw "Could not focus OpenObsidian before dismissing the expanded note selector" }
    Start-Sleep -Milliseconds 100
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $condition = [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
      $processId
    )
    function Read-SelectorExpandCollapseState($element) {
      if ($null -eq $element) {
        return [pscustomobject]@{ status = "missing-element"; supported = $null; state = $null; error = "selector element was not present in this UIA scan" }
      }
      try {
        $pattern = $null
        $supported = $element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)
        if (-not $supported) {
          return [pscustomobject]@{ status = "unsupported"; supported = $false; state = $null; error = $null }
        }
        try {
          $state = $pattern.Current.ExpandCollapseState.ToString()
          if ($state -notin @("Collapsed", "Expanded", "PartiallyExpanded", "LeafNode")) {
            return [pscustomobject]@{ status = "error"; supported = $true; state = $null; error = "UIA returned an unknown expansion state: $state" }
          }
          return [pscustomobject]@{ status = "supported"; supported = $true; state = $state; error = $null }
        } catch {
          return [pscustomobject]@{ status = "error"; supported = $true; state = $null; error = $_.Exception.Message }
        }
      } catch {
        return [pscustomobject]@{ status = "error"; supported = $null; state = $null; error = $_.Exception.Message }
      }
    }
    $selector = $null
    $selectorMatchesBefore = 0
    $selectorOffscreenBefore = $true
    $visibleNoteOptionsBefore = 0
    $visibleNoteOptionsAfter = 0
    $targetOptionVisibleBefore = $false
    $targetOptionVisible = $false
    $dismissalAction = "already-collapsed"
    $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    foreach ($element in $elements) {
      try {
        $current = $element.Current
        $normalizedName = $current.Name.Replace([string][char]92, "/")
        if ($current.ControlType.ProgrammaticName -eq "ControlType.Button" -and $current.Name -eq "Note to inspect") {
          $selectorMatchesBefore += 1
          $selector = $element
          $selectorOffscreenBefore = $current.IsOffscreen
        }
        if ($current.ControlType.ProgrammaticName -eq "ControlType.RadioButton" -and
            $normalizedName -match "\\.(md|base|canvas)$" -and -not $current.IsOffscreen) {
          $visibleNoteOptionsBefore += 1
          if ($normalizedName -eq $expectedPath) { $targetOptionVisibleBefore = $true }
        }
      } catch {
        throw "Could not read a process UI Automation element before selector dismissal: $($_.Exception.Message)"
      }
    }
    if ($selectorMatchesBefore -ne 1) { throw "UI Automation expected one Note to inspect button before dismissal, found $selectorMatchesBefore" }
    if ($selectorOffscreenBefore) { throw "UI Automation exposed the Note to inspect button as offscreen before dismissal" }
    $selectorExpansionBefore = Read-SelectorExpandCollapseState $selector
    if ($selectorExpansionBefore.status -eq "error" -or $selectorExpansionBefore.status -eq "missing-element") {
      throw "Could not read the note-selector expansion pattern before dismissal: $($selectorExpansionBefore.error)"
    }
    $selectorWasExpanded = $selectorExpansionBefore.state -eq "Expanded" -or $selectorExpansionBefore.state -eq "PartiallyExpanded"
    if ($visibleNoteOptionsBefore -gt 0 -and -not $targetOptionVisibleBefore) {
      throw "The exact selected note path is not visible in the expanded selector"
    }
    if ($selectorExpansionBefore.status -eq "unsupported" -and $visibleNoteOptionsBefore -eq 0) {
      throw "UI Automation exposed neither the selector expansion state nor any note-path options; the collapsed state cannot be confirmed"
    }
    if ($selectorExpansionBefore.status -eq "supported" -and $selectorExpansionBefore.state -notin @("Collapsed", "Expanded", "PartiallyExpanded")) {
      throw "UI Automation exposed a non-expandable note selector with unexpected state: $($selectorExpansionBefore.state)"
    }
    if ($visibleNoteOptionsBefore -gt 0 -or $selectorWasExpanded) {
      if ($selectorExpansionBefore.status -eq "supported" -and $selectorExpansionBefore.state -eq "Collapsed") {
        throw "UI Automation reports the selector collapsed while visible note options remain"
      }
      $dismissalAction = "WScript.Shell.SendKeys(Escape)"
      $shell.SendKeys("{ESC}")
      Start-Sleep -Milliseconds 150
    } elseif ($selectorExpansionBefore.status -eq "supported" -and $selectorExpansionBefore.state -ne "Collapsed") {
      throw "UI Automation exposes an unknown note-selector expansion state: $($selectorExpansionBefore.state)"
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(3)
    $stableEmptyScans = 0
    $selectorExpansionAfter = $selectorExpansionBefore
    $selectorVisibleAfterDismissal = $false
    while ($stableEmptyScans -lt 3 -and [DateTime]::UtcNow -lt $deadline) {
      $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
      $visibleNoteOptionsAfter = 0
      $targetOptionVisible = $false
      $selectorAfter = $null
      $selectorMatchesAfter = 0
      $selectorOffscreenAfter = $true
      foreach ($element in $elements) {
        try {
          $current = $element.Current
          $normalizedName = $current.Name.Replace([string][char]92, "/")
          if ($current.ControlType.ProgrammaticName -eq "ControlType.Button" -and $current.Name -eq "Note to inspect") {
            $selectorMatchesAfter += 1
            $selectorAfter = $element
            $selectorOffscreenAfter = $current.IsOffscreen
          }
          if ($current.ControlType.ProgrammaticName -eq "ControlType.RadioButton" -and
              $normalizedName -match "\\.(md|base|canvas)$" -and -not $current.IsOffscreen) {
            $visibleNoteOptionsAfter += 1
            if ($normalizedName -eq $expectedPath) { $targetOptionVisible = $true }
          }
        } catch {
          throw "Could not read a process UI Automation element after selector dismissal: $($_.Exception.Message)"
        }
      }
      if ($selectorMatchesAfter -ne 1) { throw "UI Automation expected one Note to inspect button after dismissal, found $selectorMatchesAfter" }
      $selectorVisibleAfterDismissal = $null -ne $selectorAfter -and -not $selectorOffscreenAfter
      $selectorExpansionAfter = Read-SelectorExpandCollapseState $selectorAfter
      if ($selectorExpansionAfter.status -eq "error") {
        throw "Could not read the note-selector expansion pattern after dismissal: $($selectorExpansionAfter.error)"
      }
      $expansionConfirmsClosed = ($selectorExpansionAfter.status -eq "supported" -and
        $selectorExpansionAfter.state -eq "Collapsed")
      $expansionUnsupportedBeforeAndAfter = $selectorExpansionAfter.status -eq "unsupported" -and $selectorExpansionBefore.status -eq "unsupported"
      $escapeDismissedVisibleMenu = $dismissalAction -eq "WScript.Shell.SendKeys(Escape)" -and $visibleNoteOptionsBefore -gt 0
      if ($expansionUnsupportedBeforeAndAfter -and $escapeDismissedVisibleMenu) {
        $expansionConfirmsClosed = $true
      }
      if ($visibleNoteOptionsAfter -eq 0 -and $selectorVisibleAfterDismissal -and $expansionConfirmsClosed) {
        $stableEmptyScans += 1
      } else {
        $stableEmptyScans = 0
      }
      if ($stableEmptyScans -lt 3) { Start-Sleep -Milliseconds 100 }
    }
    if ($visibleNoteOptionsAfter -gt 0 -or -not $selectorVisibleAfterDismissal -or $stableEmptyScans -ne 3) {
      throw "The note selector did not remain observable in three consecutive empty UI Automation scans after dismissal"
    }
    [pscustomobject]@{
      name = $selectorAfter.Current.Name
      control_type = $selectorAfter.Current.ControlType.ProgrammaticName
      dismissal_action = $dismissalAction
      visible_note_options_before_dismissal = $visibleNoteOptionsBefore
      visible_note_options_after_dismissal = $visibleNoteOptionsAfter
      stable_empty_scans = $stableEmptyScans
      selector_visible_after_dismissal = $selectorVisibleAfterDismissal
      selector_is_offscreen_before_dismissal = $selectorOffscreenBefore
      selector_is_offscreen_after_dismissal = $selectorOffscreenAfter
      expand_collapse_read_status_before = $selectorExpansionBefore.status
      expand_collapse_read_status_after = $selectorExpansionAfter.status
      expand_collapse_supported_before = $selectorExpansionBefore.supported
      expand_collapse_state_before = $selectorExpansionBefore.state
      expand_collapse_supported_after = $selectorExpansionAfter.supported
      expand_collapse_state_after = $selectorExpansionAfter.state
      target_option_visible_before_dismissal = $targetOptionVisibleBefore
      target_option_visible_after_dismissal = $targetOptionVisible
    } | ConvertTo-Json -Compress
  `;
  try {
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENOBSIDIAN_WINDOW_PROCESS_ID: String(processId),
        OPENOBSIDIAN_EXPECTED_NOTE_PATH: expectedPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {stderr?: Buffer | string; stdout?: Buffer | string};
    const output = [failure.stdout, failure.stderr].filter(Boolean).map(String).join("\n").trim();
    throw new Error(`Could not confirm the Windows note selector was closed: ${output || failure.message}`);
  }
}

function nativeFolderPickerVisibleInOcr(text: string): boolean {
  const compact = text.toLowerCase().replace(/[^a-z]/g, "");
  if (compact.includes("openanexistingvault") || compact.includes("openexistingvault")) return true;

  const tokens = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const hasCancel = tokens.some((token) => ocrTokenMatches(token, "cancel"));
  const hasPickerAction = ["open", "select", "choose"].some((expected) =>
    tokens.some((token) => ocrTokenMatches(token, expected))
  );
  return hasCancel && hasPickerAction;
}

type VaultDirectoryOptions = {
  targetRoot?: string;
  reporter?: Record<string, unknown>;
  screenshotPrefix?: string;
};

function vaultPickerScreenshotName(prefix: string, filename: string): string {
  return prefix.length > 0 ? `${prefix}-${filename}` : filename;
}

async function clickFirstRunOpenButton(
  connection: DevToolsConnection,
  reporter: Record<string, unknown> = report.obsidian_authoring as Record<string, unknown>,
  child?: ChildProcess,
): Promise<void> {
  const visible = await connection.evaluateJson<{matchedCount: number; buttons: string[]}>(`(() => {
    const buttons = [...document.querySelectorAll('button,[role="button"]')];
    const summary = buttons.map((button) => (button.innerText || button.textContent || '').trim()).filter(Boolean);
    const matches = buttons.filter((button) => (button.innerText || button.textContent || '').trim() === 'Open');
    return {matchedCount:matches.length,buttons:summary};
  })()`);
  reporter.first_run_buttons = visible.buttons;
  reporter.first_run_open_button_match_count = visible.matchedCount;
  if (visible.matchedCount !== 1) throw new Error(`Expected one exact Obsidian Open button; found ${visible.matchedCount}; visible button labels=${visible.buttons.join(" | ")}`);
  if (process.platform === "darwin") {
    if (!child?.pid) throw new Error("OpenObsidian did not expose its process id for macOS first-run Open activation");
    reporter.first_run_open_activation = await clickMacOSFirstRunOpenButton(child, reporter);
    return;
  }
  // Electron's native folder picker blocks the renderer thread while it is open, so
  // dispatch the click without waiting for Runtime.evaluate's response.
  connection.send("Runtime.evaluate", {
    expression: `(() => [...document.querySelectorAll('button,[role="button"]')]
      .find((button) => (button.innerText || button.textContent || '').trim() === 'Open')?.click())()`,
    returnByValue: true,
  });
  reporter.first_run_open_activation = "Dispatched the exact Open button's DOM click through the renderer";
}

async function finishVaultDirectorySelection(
  connection: DevToolsConnection,
  port: number,
  pickerEvidence: Record<string, unknown>,
  options: VaultDirectoryOptions = {},
): Promise<DevToolsConnection> {
  const targetRoot = options.targetRoot ?? vaultRoot;
  const reporter = options.reporter ?? report.obsidian_authoring as Record<string, unknown>;
  const targetVaultName = basename(targetRoot);
  const priorPickerRecord = reporter.folder_picker && typeof reporter.folder_picker === "object"
    ? reporter.folder_picker as Record<string, unknown>
    : {};
  const folderPickerRecord: Record<string, unknown> = {
    ...priorPickerRecord,
    ...pickerEvidence,
    page_targets_after_folder_selection: [],
    vault_renderer_target: null,
    renderer_wait_status: "pending",
  };
  reporter.folder_picker = folderPickerRecord;
  let vaultTarget: CdpTarget;
  try {
    vaultTarget = await waitForPageTarget(
      port,
      (candidate) => typeof candidate.url === "string" && candidate.url.startsWith("app://obsidian.md/") && !candidate.url.includes("/starter.html"),
      "Obsidian vault renderer after folder selection",
    );
  } catch (error) {
    folderPickerRecord.renderer_wait_status = "failed";
    folderPickerRecord.renderer_wait_error = error instanceof Error ? error.message : String(error);
    try {
      folderPickerRecord.page_targets_after_folder_selection = (await readPageTargets(port))
        .map(({id, title, url, type}) => ({id, title, url, type}));
    } catch (targetError) {
      folderPickerRecord.page_target_read_error = targetError instanceof Error ? targetError.message : String(targetError);
    }
    throw error;
  }
  const pageTargets = await readPageTargets(port);
  folderPickerRecord.page_targets_after_folder_selection = pageTargets.map(({id, title, url, type}) => ({id, title, url, type}));
  folderPickerRecord.vault_renderer_target = {id: vaultTarget.id ?? null, title: vaultTarget.title ?? "", url: vaultTarget.url ?? ""};
  folderPickerRecord.renderer_wait_status = "target-found";
  connection.close();
  connection = await connectTarget(vaultTarget);

  const isVaultLoaded = (body: string) => body.includes(targetVaultName) && !body.includes("Open folder as vault") && !body.includes("Create new vault");
  const body = await waitForRenderer(connection, "document.body?.innerText ?? ''", isVaultLoaded, `Obsidian to open the selected ${targetVaultName} folder`, 45_000);
  reporter.selected_vault_text = body.slice(0, 2_000);
  reporter.selected_vault_in_ui = true;
  const selectedVaultPath = await connection.evaluateJson<string | null>(`(() => {
    const path = window.app?.vault?.adapter?.basePath;
    return typeof path === 'string' && path.length > 0 ? path : null;
  })()`, "read selected vault's adapter base path");
  const expectedCanonicalVaultPath = await realpath(targetRoot);
  let observedCanonicalVaultPath: string | null = null;
  let observedVaultPathError: string | undefined;
  if (selectedVaultPath) {
    try {
      observedCanonicalVaultPath = await realpath(selectedVaultPath);
    } catch (error) {
      observedVaultPathError = error instanceof Error ? error.message : String(error);
    }
  }
  const comparableVaultPath = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;
  const exactVaultPathMatch = observedCanonicalVaultPath !== null
    && comparableVaultPath(expectedCanonicalVaultPath) === comparableVaultPath(observedCanonicalVaultPath);
  reporter.selected_vault_path = {
    requested_path: targetRoot,
    expected_canonical_path: expectedCanonicalVaultPath,
    adapter_base_path: selectedVaultPath,
    observed_canonical_path: observedCanonicalVaultPath,
    canonicalization_error: observedVaultPathError ?? null,
    exact_match: exactVaultPathMatch,
  };
  if (!exactVaultPathMatch) {
    await saveReport();
    throw new Error(`Obsidian opened a vault path that did not exactly match the selected fixture: expected=${expectedCanonicalVaultPath}; adapter=${selectedVaultPath ?? "unavailable"}; observed=${observedCanonicalVaultPath ?? "unavailable"}`);
  }
  return connection;
}

async function chooseVaultDirectoryLinux(connection: DevToolsConnection, port: number, options: VaultDirectoryOptions = {}): Promise<DevToolsConnection> {
  const targetRoot = options.targetRoot ?? vaultRoot;
  const reporter = options.reporter ?? report.obsidian_authoring as Record<string, unknown>;
  const screenshotPrefix = options.screenshotPrefix ?? "";
  const initialWindowId = activeWindowId();
  const initialTitle = activeWindowTitle();
  await clickFirstRunOpenButton(connection, reporter);
  const pickerWindow = await waitFor("Obsidian folder picker", async () => {
    await delay(250);
    return {windowId: activeWindowId(), title: activeWindowTitle()};
  }, (value) => value.windowId.length > 0 && value.windowId !== initialWindowId, 20_000).catch(() => ({windowId: activeWindowId(), title: activeWindowTitle()}));
  reporter.folder_picker = {
    initial_window_id: initialWindowId,
    initial_window_title: initialTitle,
    picker_window_id: pickerWindow.windowId,
    picker_window_title: pickerWindow.title,
  };
  const pickerScreenshots = [await captureDesktopScreenshot(vaultPickerScreenshotName(screenshotPrefix, "obsidian-folder-picker-initial.png"))];

  xdotool("key", "ctrl+l");
  xdotool("type", "--clearmodifiers", "--delay", "2", targetRoot);
  pickerScreenshots.push(await captureDesktopScreenshot(vaultPickerScreenshotName(screenshotPrefix, "obsidian-folder-picker-path-entered.png")));
  const pickerStillActive = () => activeWindowId() === pickerWindow.windowId;
  const openButtonClick = clickWindowOpenButton(pickerWindow.windowId);
  await delay(1_000);
  pickerScreenshots.push(await captureDesktopScreenshot(vaultPickerScreenshotName(screenshotPrefix, "obsidian-folder-picker-after-open-click.png")));
  if (pickerStillActive()) {
    xdotool("key", "Return");
    await delay(1_000);
  }
  if (pickerStillActive()) {
    xdotool("key", "alt+o");
    await delay(1_000);
  }
  if (pickerStillActive()) {
    xdotool("key", "Return");
    await delay(1_000);
  }
  if (pickerStillActive()) {
    await waitFor("Obsidian folder picker to close", async () => activeWindowId(), (windowId) => windowId !== pickerWindow.windowId, 15_000);
  }
  reporter.folder_picker_closed = true;

  return await finishVaultDirectorySelection(connection, port, {
    initial_window_id: initialWindowId,
    initial_window_title: initialTitle,
    picker_window_id: pickerWindow.windowId,
    picker_window_title: pickerWindow.title,
    open_button_click: openButtonClick,
    picker_screenshots: pickerScreenshots.map((path) => relative(reportDirectory, path)),
    picker_closed: true,
  }, options);
}

async function chooseVaultDirectoryMacOS(connection: DevToolsConnection, port: number, child: ChildProcess, options: VaultDirectoryOptions = {}): Promise<DevToolsConnection> {
  const targetRoot = options.targetRoot ?? vaultRoot;
  const reporter = options.reporter ?? report.obsidian_authoring as Record<string, unknown>;
  const screenshotPrefix = options.screenshotPrefix ?? "";
  const pickerScreenshots: string[] = [];
  const folderPickerRecord: Record<string, unknown> = {
    interaction: "macOS Open panel: record the first-run accessibility inventory, dispatch a trusted click to its unique enabled Open control, confirm one newly added native panel and high-confidence Cancel/Open Vision candidates inside that exact panel's accessibility bounds, then enter the fixture path and click that exact panel's Open button",
    picker_screenshots: [],
    picker_open_status: "not-started",
    picker_baseline_status: "pending",
    initial_picker_screenshot_status: "not-started",
    picker_visual_confirmation_status: "not-started",
    path_entry_status: "not-started",
    picker_visibility_wait_status: "not-started",
    open_button_click_status: "not-started",
    picker_closed: false,
  };
  reporter.folder_picker = folderPickerRecord;
  await saveReport();

  let pickerWindowsBeforeOpen: string;
  let pickerEntriesBeforeOpen: string[];
  try {
    pickerWindowsBeforeOpen = macOSApplicationWindowDescriptions(child);
    pickerEntriesBeforeOpen = macOSReadableAccessibilityWindowEntries(pickerWindowsBeforeOpen);
    folderPickerRecord.picker_baseline_status = "captured";
    folderPickerRecord.picker_windows_before_open = pickerWindowsBeforeOpen;
    folderPickerRecord.picker_entries_before_open = pickerEntriesBeforeOpen;
    folderPickerRecord.native_open_panel_entries_before_open = macOSNativeOpenPanelEntries(pickerWindowsBeforeOpen);
  } catch (error) {
    folderPickerRecord.picker_baseline_status = "failed";
    folderPickerRecord.picker_baseline_error = error instanceof Error ? error.message : String(error);
    try {
      folderPickerRecord.picker_windows_after_baseline_failure = macOSApplicationWindowDescriptions(child);
    } catch (windowError) {
      folderPickerRecord.picker_baseline_window_read_error = windowError instanceof Error ? windowError.message : String(windowError);
    }
    await saveReportAfterStageFailure("picker_baseline", folderPickerRecord, error);
    throw error;
  }
  await saveReport();

  let latestVisualConfirmationWindows: string | undefined;
  try {
    await clickFirstRunOpenButton(connection, reporter, child);
    folderPickerRecord.picker_open_status = "activation-dispatched-awaiting-native-panel";
    await delay(1_000);
  } catch (error) {
    folderPickerRecord.picker_open_status = "failed";
    folderPickerRecord.picker_open_error = error instanceof Error ? error.message : String(error);
    try {
      folderPickerRecord.picker_windows_after_open_failure = macOSApplicationWindowDescriptions(child);
    } catch (windowError) {
      folderPickerRecord.picker_open_window_read_error = windowError instanceof Error ? windowError.message : String(windowError);
    }
    await saveReportAfterStageFailure("picker_open", folderPickerRecord, error);
    throw error;
  }
  await saveReport();

  type MacOSPanelObservation = {descriptions: string; entries: string[]; addedPanels: string[]};
  let latestPickerWindows = pickerWindowsBeforeOpen;
  let latestPickerEntries = pickerEntriesBeforeOpen;
  let latestAddedPanels: string[] = [];
  const pickerInventoryReadErrors: string[] = [];
  let pickerPanelIdentity = "";
  folderPickerRecord.picker_visibility_wait_status = "pending";
  let panelObservation: MacOSPanelObservation;
  try {
    panelObservation = await waitFor(
      "exactly one new macOS native Open panel after trusted first-run activation",
      async () => {
        try {
          const descriptions = macOSApplicationWindowDescriptions(child);
          latestPickerWindows = descriptions;
          const entries = macOSReadableAccessibilityWindowEntries(descriptions);
          const addedPanels = macOSAddedNativeOpenPanelEntries(pickerEntriesBeforeOpen, entries);
          latestPickerEntries = entries;
          latestAddedPanels = addedPanels;
          return {descriptions, entries, addedPanels};
        } catch (error) {
          pickerInventoryReadErrors.push(error instanceof Error ? error.message : String(error));
          return {descriptions: "", entries: [], addedPanels: []};
        }
      },
      (observation) => observation.addedPanels.length > 0,
      15_000,
    );
    folderPickerRecord.picker_windows_after_open_activation = panelObservation.descriptions;
    folderPickerRecord.picker_entries_after_open_activation = panelObservation.entries;
    folderPickerRecord.new_native_open_panel_entries = panelObservation.addedPanels;
    folderPickerRecord.picker_window_read_errors_after_open_activation = pickerInventoryReadErrors;
    if (panelObservation.addedPanels.length !== 1) {
      throw new Error(`Expected exactly one newly added native macOS Open panel; found ${panelObservation.addedPanels.length}; entries=${JSON.stringify(panelObservation.entries)}`);
    }
    if (pickerInventoryReadErrors.length > 0) {
      throw new Error(`The accessibility inventory had read errors while waiting for the native panel: ${pickerInventoryReadErrors.join(" | ")}`);
    }
    pickerPanelIdentity = panelObservation.addedPanels[0] ?? "";
    if (!pickerPanelIdentity) throw new Error("The newly added native macOS Open panel had no recorded identity");
    const currentPanelIdentityCount = macOSNativeOpenPanelIdentityCount(panelObservation.entries, pickerPanelIdentity);
    if (currentPanelIdentityCount !== 1) {
      throw new Error(`The newly added native macOS Open panel identity is not unique in the current inventory; expected one match for ${pickerPanelIdentity}, found ${currentPanelIdentityCount}`);
    }
    folderPickerRecord.picker_panel_identity = pickerPanelIdentity;
    folderPickerRecord.picker_panel_identity_match_count_after_activation = currentPanelIdentityCount;
    folderPickerRecord.picker_visibility_wait_status = "confirmed-new-panel-identity";
  } catch (error) {
    folderPickerRecord.picker_visibility_wait_status = "failed";
    folderPickerRecord.picker_visibility_wait_error = error instanceof Error ? error.message : String(error);
    folderPickerRecord.picker_windows_after_open_activation = latestPickerWindows;
    folderPickerRecord.picker_entries_after_open_activation = latestPickerEntries;
    folderPickerRecord.new_native_open_panel_entries = latestAddedPanels;
    folderPickerRecord.picker_window_read_errors_after_open_activation = pickerInventoryReadErrors;
    try {
      const path = await captureDesktopScreenshot(vaultPickerScreenshotName(screenshotPrefix, "obsidian-folder-picker-open-failure.png"));
      pickerScreenshots.push(path);
      folderPickerRecord.picker_screenshots = pickerScreenshots.map((screenshotPath) => relative(reportDirectory, screenshotPath));
      folderPickerRecord.picker_open_failure_screenshot_status = "captured";
      folderPickerRecord.picker_open_failure_screenshot_ocr = (await readNativeFolderPickerOcr(path)).slice(0, 2_000);
    } catch (screenshotError) {
      folderPickerRecord.picker_open_failure_screenshot_status = "failed";
      folderPickerRecord.picker_open_failure_screenshot_error = screenshotError instanceof Error ? screenshotError.message : String(screenshotError);
    }
    await saveReportAfterStageFailure("picker_visibility_wait", folderPickerRecord, error);
    throw error;
  }
  await saveReport();

  try {
    folderPickerRecord.initial_picker_screenshot_status = "pending";
    folderPickerRecord.picker_visual_confirmation_status = "pending";
    await saveReport();
    const initialPickerScreenshot = await captureDesktopScreenshot(vaultPickerScreenshotName(screenshotPrefix, "obsidian-folder-picker-initial.png"));
    pickerScreenshots.push(initialPickerScreenshot);
    folderPickerRecord.initial_picker_screenshot_status = "captured";
    folderPickerRecord.picker_screenshots = pickerScreenshots.map((path) => relative(reportDirectory, path));
    const initialPickerVisualEvidence = await inspectMacOSNativeOpenPanelScreenshot(initialPickerScreenshot, pickerPanelIdentity);
    folderPickerRecord.initial_picker_screenshot_ocr = initialPickerVisualEvidence.visible_text.slice(0, 2_000);
    folderPickerRecord.initial_picker_screenshot_vision_evidence = initialPickerVisualEvidence;
    if (!initialPickerVisualEvidence.confirmed_native_picker_buttons
        || !nativeFolderPickerVisibleInOcr(String(folderPickerRecord.initial_picker_screenshot_ocr))) {
      throw new Error(`The newly added panel ${pickerPanelIdentity} was not visibly confirmed by high-confidence Cancel/Open text inside its exact accessibility bounds: ${JSON.stringify(initialPickerVisualEvidence)}`);
    }
    latestVisualConfirmationWindows = macOSApplicationWindowDescriptions(child);
    folderPickerRecord.picker_windows_at_visual_confirmation = latestVisualConfirmationWindows;
    const visualConfirmationEntries = macOSReadableAccessibilityWindowEntries(latestVisualConfirmationWindows);
    const visualConfirmationPanels = macOSAddedNativeOpenPanelEntries(pickerEntriesBeforeOpen, visualConfirmationEntries);
    const visualConfirmationIdentityCount = macOSNativeOpenPanelIdentityCount(visualConfirmationEntries, pickerPanelIdentity);
    folderPickerRecord.picker_entries_at_visual_confirmation = visualConfirmationEntries;
    folderPickerRecord.new_native_open_panel_entries_at_visual_confirmation = visualConfirmationPanels;
    folderPickerRecord.picker_panel_identity_match_count_at_visual_confirmation = visualConfirmationIdentityCount;
    if (visualConfirmationPanels.length !== 1 || visualConfirmationPanels[0] !== pickerPanelIdentity || visualConfirmationIdentityCount !== 1) {
      throw new Error(`The visually confirmed chooser no longer maps to exactly one current recorded panel ${pickerPanelIdentity}: added=${JSON.stringify(visualConfirmationPanels)} current_matches=${visualConfirmationIdentityCount}`);
    }
    folderPickerRecord.picker_visual_confirmation_status = "confirmed-by-accessibility-bounded-vision";
  } catch (error) {
    folderPickerRecord.picker_visual_confirmation_status = "failed";
    folderPickerRecord.picker_visual_confirmation_error = error instanceof Error ? error.message : String(error);
    if (latestVisualConfirmationWindows !== undefined) {
      folderPickerRecord.picker_windows_at_visual_confirmation = latestVisualConfirmationWindows;
    }
    if (folderPickerRecord.initial_picker_screenshot_status === "pending") folderPickerRecord.initial_picker_screenshot_status = "failed";
    await saveReportAfterStageFailure("picker_visual_confirmation", folderPickerRecord, error);
    throw error;
  }
  await saveReport();

  const script = `on run argv
    tell application "System Events"
      set targetProcess to first process whose unix id is (item 1 of argv as integer)
      set frontmost of targetProcess to true
      keystroke "g" using {command down, shift down}
      delay 0.5
      keystroke (item 2 of argv)
      delay 0.5
      key code 36
      delay 1
  end tell
  end run`;
  folderPickerRecord.path_entry_status = "pending";
  await saveReport();
  try {
    const pathEntryStdout = execFileSync("osascript", ["-e", script, String(child.pid ?? -1), targetRoot], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    folderPickerRecord.path_entry_script_stdout = pathEntryStdout;
    folderPickerRecord.path_entry_status = "completed";
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    const failure = error as NodeJS.ErrnoException & {stderr?: Buffer | string; stdout?: Buffer | string};
    folderPickerRecord.path_entry_status = "failed";
    folderPickerRecord.path_entry_error = errorText;
    folderPickerRecord.path_entry_script_stdout = String(failure.stdout ?? "").trim();
    folderPickerRecord.path_entry_script_stderr = String(failure.stderr ?? "").trim();
    try {
      folderPickerRecord.picker_windows_after_path_entry_failure = macOSApplicationWindowDescriptions(child);
    } catch (windowError) {
      folderPickerRecord.path_entry_window_read_error = windowError instanceof Error ? windowError.message : String(windowError);
    }
    await saveReportAfterStageFailure("path_entry", folderPickerRecord, error);
    throw error;
  }
  await saveReport();
  await delay(1_000);
  try {
    const pathEnteredScreenshot = await captureDesktopScreenshot(vaultPickerScreenshotName(screenshotPrefix, "obsidian-folder-picker-after-path.png"));
    pickerScreenshots.push(pathEnteredScreenshot);
    folderPickerRecord.path_entry_screenshot_status = "captured";
    folderPickerRecord.picker_screenshots = pickerScreenshots.map((path) => relative(reportDirectory, path));
    const pathEntryVisualEvidence = await inspectMacOSNativeOpenPanelScreenshot(pathEnteredScreenshot, pickerPanelIdentity);
    folderPickerRecord.path_entry_screenshot_ocr = pathEntryVisualEvidence.visible_text.slice(0, 2_000);
    folderPickerRecord.path_entry_screenshot_vision_evidence = pathEntryVisualEvidence;
    if (!pathEntryVisualEvidence.confirmed_native_picker_buttons
        || !nativeFolderPickerVisibleInOcr(String(folderPickerRecord.path_entry_screenshot_ocr))) {
      throw new Error(`The recorded native panel ${pickerPanelIdentity} was not visibly present after path entry according to exact-panel Vision evidence: ${JSON.stringify(pathEntryVisualEvidence)}`);
    }
    const pathEntryWindows = macOSApplicationWindowDescriptions(child);
    const pathEntryEntries = macOSReadableAccessibilityWindowEntries(pathEntryWindows);
    const pathEntryPanels = macOSAddedNativeOpenPanelEntries(pickerEntriesBeforeOpen, pathEntryEntries);
    const pathEntryIdentityCount = macOSNativeOpenPanelIdentityCount(pathEntryEntries, pickerPanelIdentity);
    folderPickerRecord.picker_windows_after_path_entry = pathEntryWindows;
    folderPickerRecord.picker_entries_after_path_entry = pathEntryEntries;
    folderPickerRecord.new_native_open_panel_entries_after_path_entry = pathEntryPanels;
    folderPickerRecord.picker_panel_identity_match_count_after_path_entry = pathEntryIdentityCount;
    if (pathEntryPanels.length !== 1 || pathEntryPanels[0] !== pickerPanelIdentity || pathEntryIdentityCount !== 1) {
      throw new Error(`Path entry changed or duplicated the active native panel identity; expected one current ${pickerPanelIdentity}, added=${JSON.stringify(pathEntryPanels)} current_matches=${pathEntryIdentityCount}`);
    }
    folderPickerRecord.path_entry_visual_confirmation_status = "confirmed-by-accessibility-bounded-vision";
  } catch (error) {
    folderPickerRecord.path_entry_screenshot_status = folderPickerRecord.path_entry_screenshot_status === "captured" ? "captured-ocr-failed" : "failed";
    folderPickerRecord.path_entry_screenshot_error = error instanceof Error ? error.message : String(error);
    await saveReportAfterStageFailure("path_entry_screenshot", folderPickerRecord, error);
    throw error;
  }
  await saveReport();

  let openButtonClick: string;
  try {
    openButtonClick = await clickMacOSNativePickerOpenButton(child, pickerPanelIdentity);
  } catch (error) {
    folderPickerRecord.open_button_click_status = "failed";
    folderPickerRecord.open_button_click_error = error instanceof Error ? error.message : String(error);
    try {
      folderPickerRecord.picker_windows_after_open_attempt = macOSApplicationWindowDescriptions(child);
    } catch (windowError) {
      folderPickerRecord.picker_window_read_error = windowError instanceof Error ? windowError.message : String(windowError);
    }
    await saveReportAfterStageFailure("open_button_click", folderPickerRecord, error);
    throw error;
  }
  folderPickerRecord.open_button_click = openButtonClick;
  folderPickerRecord.open_button_click_status = "click-dispatched-awaiting-panel-disappearance";
  await saveReport();
  await delay(500);
  try {
    const afterOpenScreenshot = await captureDesktopScreenshot(vaultPickerScreenshotName(screenshotPrefix, "obsidian-folder-picker-after-open-click.png"));
    pickerScreenshots.push(afterOpenScreenshot);
    folderPickerRecord.picker_screenshots = pickerScreenshots.map((path) => relative(reportDirectory, path));
    folderPickerRecord.after_open_screenshot_status = "captured";
    folderPickerRecord.after_open_screenshot_ocr = (await readNativeFolderPickerOcr(afterOpenScreenshot)).slice(0, 2_000);
    if (!String(folderPickerRecord.after_open_screenshot_ocr).trim()) {
      throw new Error("The macOS after-Open screenshot OCR returned no readable text, so it cannot confirm the chooser closed");
    }
    if (nativeFolderPickerVisibleInOcr(String(folderPickerRecord.after_open_screenshot_ocr))) {
      throw new Error(`The macOS native folder chooser remains visible in the after-Open screenshot: ${JSON.stringify(folderPickerRecord.after_open_screenshot_ocr)}`);
    }
  } catch (error) {
    folderPickerRecord.after_open_screenshot_status = "failed";
    folderPickerRecord.after_open_screenshot_error = error instanceof Error ? error.message : String(error);
    await saveReportAfterStageFailure("after_open_screenshot", folderPickerRecord, error);
    throw error;
  }
  await saveReport();
  let pickerWindowsAfterClick = "";
  let closeObservation: {descriptions: string; entries: string[]; remainingNewPanelEntries: string[]; matchingPanelIdentityCount: number; consecutiveAbsentSnapshots: number; consecutiveAbsentPanelInventories: string[]};
  let pickerEntriesAfterClick: string[] = [];
  let remainingNewPanelEntries: string[] = [];
  let latestPickerWindowsAfterClick = "";
  const pickerInventoryReadErrorsAfterClick: string[] = [];
  let consecutiveAbsentPanelSnapshots = 0;
  const consecutiveAbsentPanelInventories: string[] = [];
  try {
    closeObservation = await waitFor(
      `the exact newly added macOS panel ${pickerPanelIdentity} to disappear after clicking Open`,
      async () => {
        try {
          const descriptions = macOSApplicationWindowDescriptions(child);
          latestPickerWindowsAfterClick = descriptions;
          const entries = macOSReadableAccessibilityWindowEntries(descriptions);
          pickerEntriesAfterClick = entries;
          remainingNewPanelEntries = macOSAddedNativeOpenPanelEntries(pickerEntriesBeforeOpen, entries);
          const matchingPanelIdentityCount = macOSNativeOpenPanelIdentityCount(entries, pickerPanelIdentity);
          const panelAbsent = remainingNewPanelEntries.length === 0 && matchingPanelIdentityCount === 0;
          consecutiveAbsentPanelSnapshots = panelAbsent ? consecutiveAbsentPanelSnapshots + 1 : 0;
          if (panelAbsent) {
            consecutiveAbsentPanelInventories.push(descriptions);
            if (consecutiveAbsentPanelInventories.length > 3) consecutiveAbsentPanelInventories.shift();
          } else {
            consecutiveAbsentPanelInventories.length = 0;
          }
          return {descriptions, entries, remainingNewPanelEntries, matchingPanelIdentityCount, consecutiveAbsentSnapshots: consecutiveAbsentPanelSnapshots, consecutiveAbsentPanelInventories: consecutiveAbsentPanelInventories.slice()};
        } catch (error) {
          pickerInventoryReadErrorsAfterClick.push(error instanceof Error ? error.message : String(error));
          consecutiveAbsentPanelSnapshots = 0;
          return {descriptions: "", entries: [], remainingNewPanelEntries: [pickerPanelIdentity], matchingPanelIdentityCount: 1, consecutiveAbsentSnapshots: 0, consecutiveAbsentPanelInventories: []};
        }
      },
      (observation) => observation.remainingNewPanelEntries.length === 0
        && observation.matchingPanelIdentityCount === 0
        && observation.consecutiveAbsentSnapshots >= 3,
      15_000,
    );
    if (pickerInventoryReadErrorsAfterClick.length > 0) {
      throw new Error(`The accessibility inventory had read errors while confirming panel closure: ${pickerInventoryReadErrorsAfterClick.join(" | ")}`);
    }
    pickerWindowsAfterClick = closeObservation.descriptions;
    pickerEntriesAfterClick = closeObservation.entries;
    remainingNewPanelEntries = closeObservation.remainingNewPanelEntries;
    folderPickerRecord.picker_windows_after_open_click = pickerWindowsAfterClick;
    folderPickerRecord.picker_window_read_errors_after_click = pickerInventoryReadErrorsAfterClick;
    folderPickerRecord.picker_panel_identity_match_count_after_open_click = closeObservation.matchingPanelIdentityCount;
    folderPickerRecord.picker_panel_consecutive_absent_snapshots_after_open_click = closeObservation.consecutiveAbsentSnapshots;
    folderPickerRecord.picker_panel_consecutive_absent_inventories_after_open_click = closeObservation.consecutiveAbsentPanelInventories;
  } catch (error) {
    folderPickerRecord.open_button_click_status = "close-confirmation-failed";
    folderPickerRecord.picker_close_error = error instanceof Error ? error.message : String(error);
    folderPickerRecord.picker_window_read_errors_after_click = pickerInventoryReadErrorsAfterClick;
    folderPickerRecord.picker_windows_after_open_click = latestPickerWindowsAfterClick;
    folderPickerRecord.picker_entries_after_open_click = pickerEntriesAfterClick;
    folderPickerRecord.new_native_open_panel_entries_after_open_click = remainingNewPanelEntries;
    folderPickerRecord.picker_panel_consecutive_absent_inventories_after_open_click = consecutiveAbsentPanelInventories;
    await saveReportAfterStageFailure("picker_close", folderPickerRecord, error);
    throw error;
  }
  folderPickerRecord.picker_windows_after_open_click = pickerWindowsAfterClick;
  folderPickerRecord.picker_entries_after_open_click = pickerEntriesAfterClick;
  folderPickerRecord.new_native_open_panel_entries_after_open_click = remainingNewPanelEntries;
  folderPickerRecord.picker_window_read_errors_after_click = pickerInventoryReadErrorsAfterClick;
  folderPickerRecord.picker_closed = true;
  folderPickerRecord.open_button_click_status = "confirmed-picker-closed";
  reporter.folder_picker_closed = true;
  await saveReport();
  return await finishVaultDirectorySelection(connection, port, {
    ...folderPickerRecord,
    picker_screenshots: pickerScreenshots.map((path) => relative(reportDirectory, path)),
  }, options);
}

async function chooseVaultDirectoryWindows(
  connection: DevToolsConnection,
  port: number,
  child: ChildProcess,
  options: VaultDirectoryOptions = {},
): Promise<DevToolsConnection> {
  const targetRoot = options.targetRoot ?? vaultRoot;
  const reporter = options.reporter ?? report.obsidian_authoring as Record<string, unknown>;
  const screenshotPrefix = options.screenshotPrefix ?? "";
  const processId = child.pid;
  const pickerScreenshots: string[] = [];
  const folderPickerRecord: Record<string, unknown> = {
    interaction: "Windows native folder picker: require the exact Obsidian-owned dialog, enter the fixture path after foreground confirmation, and invoke its exact Select Folder button",
    requested_path: targetRoot,
    application_process_id: processId ?? null,
    picker_screenshots: [],
    first_run_open_status: "not-started",
    picker_inventory_status: "not-started",
    picker_visibility_status: "not-started",
    path_entry_status: "not-started",
    select_folder_status: "not-started",
    picker_close_status: "not-started",
    picker_closed: false,
  };
  reporter.folder_picker = folderPickerRecord;
  await saveReport();

  const recordProcessErrorOutput = (stage: string, error: unknown): void => {
    if (!error || typeof error !== "object") return;
    const processError = error as {stdout?: string | Buffer; stderr?: string | Buffer};
    if (processError.stdout !== undefined) folderPickerRecord[`${stage}_stdout`] = String(processError.stdout).trim();
    if (processError.stderr !== undefined) folderPickerRecord[`${stage}_stderr`] = String(processError.stderr).trim();
  };
  const saveFailure = async (stage: string, error: unknown): Promise<never> => {
    const message = error instanceof Error ? error.message : String(error);
    recordProcessErrorOutput(stage, error);
    folderPickerRecord[`${stage}_status`] = "failed";
    folderPickerRecord[`${stage}_error`] = message;
    await saveReportAfterStageFailure(stage, folderPickerRecord, error);
    throw error;
  };
  const capturePickerScreenshot = async (stage: string, filename: string): Promise<void> => {
    folderPickerRecord[`${stage}_status`] = "pending";
    await saveReport();
    let path: string;
    try {
      path = await captureDesktopScreenshot(vaultPickerScreenshotName(screenshotPrefix, filename));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      folderPickerRecord[`${stage}_status`] = "failed";
      folderPickerRecord[`${stage}_error`] = message;
      await saveReportAfterStageFailure(stage, folderPickerRecord, error);
      throw error;
    }
    pickerScreenshots.push(path);
    folderPickerRecord[`${stage}_status`] = "captured";
    folderPickerRecord.picker_screenshots = pickerScreenshots.map((screenshotPath) => relative(reportDirectory, screenshotPath));
    await saveReport();
  };
  const captureDiagnosticScreenshot = async (stage: string, originalError: unknown): Promise<void> => {
    try {
      const filename = vaultPickerScreenshotName(screenshotPrefix, `obsidian-folder-picker-${stage}-failure.png`);
      const path = await captureDesktopScreenshot(filename);
      pickerScreenshots.push(path);
      folderPickerRecord[`${stage}_failure_screenshot_status`] = "captured";
      folderPickerRecord.picker_screenshots = pickerScreenshots.map((screenshotPath) => relative(reportDirectory, screenshotPath));
    } catch (error) {
      folderPickerRecord[`${stage}_failure_screenshot_status`] = "failed";
      folderPickerRecord[`${stage}_failure_screenshot_error`] = error instanceof Error ? error.message : String(error);
    }
    await saveReportAfterStageFailure(stage, folderPickerRecord, originalError);
  };
  const runPickerPowerShell = async (stage: string, script: string): Promise<string> => {
    folderPickerRecord[`${stage}_status`] = "pending";
    await saveReport();
    const spawnPickerPowerShell = () => spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-STA", "-Command", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENOBSIDIAN_WINDOW_PROCESS_ID: String(processId),
        OPENOBSIDIAN_PICKER_WINDOW_HANDLE: String(folderPickerRecord.picker_window_handle),
        OBSIDIAN_PICKER_VAULT_PATH: targetRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let result: ReturnType<typeof spawnPickerPowerShell>;
    try {
      result = spawnPickerPowerShell();
    } catch (error) {
      recordProcessErrorOutput(stage, error);
      folderPickerRecord[`${stage}_status`] = "failed";
      folderPickerRecord[`${stage}_error`] = error instanceof Error ? error.message : String(error);
      await saveReportAfterStageFailure(stage, folderPickerRecord, error);
      await captureDiagnosticScreenshot(stage, error);
      throw error;
    }
    const stdout = String(result.stdout ?? "").trim();
    const stderr = String(result.stderr ?? "").trim();
    const nativePickerLine = stdout.split(/\r?\n/).find((line) => line.startsWith("NATIVE_PICKER_TOP_LEVEL_JSON:"));
    if (nativePickerLine) {
      const serializedPicker = nativePickerLine.slice("NATIVE_PICKER_TOP_LEVEL_JSON:".length);
      try {
        folderPickerRecord.native_picker_top_level = JSON.parse(serializedPicker);
      } catch (error) {
        folderPickerRecord.native_picker_top_level_parse_error = error instanceof Error ? error.message : String(error);
        folderPickerRecord.native_picker_top_level_raw = serializedPicker;
      }
    }
    const nativeInventoryLine = stdout.split(/\r?\n/).find((line) => line.startsWith("NATIVE_PICKER_CHILD_INVENTORY_JSON:"));
    if (nativeInventoryLine) {
      const serializedInventory = nativeInventoryLine.slice("NATIVE_PICKER_CHILD_INVENTORY_JSON:".length);
      try {
        folderPickerRecord.native_picker_child_inventory = JSON.parse(serializedInventory);
      } catch (error) {
        folderPickerRecord.native_picker_child_inventory_parse_error = error instanceof Error ? error.message : String(error);
        folderPickerRecord.native_picker_child_inventory_raw = serializedInventory;
      }
    }
    const nativeActivationLine = stdout.split(/\r?\n/).find((line) => line.startsWith("NATIVE_PICKER_BUTTON_ACTIVATION:"));
    if (nativeActivationLine) folderPickerRecord.native_picker_button_activation = nativeActivationLine.slice("NATIVE_PICKER_BUTTON_ACTIVATION:".length);
    folderPickerRecord[`${stage}_stdout`] = stdout;
    folderPickerRecord[`${stage}_stderr`] = stderr;
    folderPickerRecord[`${stage}_exit_status`] = result.status;
    folderPickerRecord[`${stage}_signal`] = result.signal;
    if (result.error || result.status !== 0) {
      const detail = [stderr, stdout, result.error?.message].filter(Boolean).join("\n") || `PowerShell exited with status ${result.status}`;
      const error = result.error ?? new Error(`Windows ${stage} failed: ${detail}`);
      folderPickerRecord[`${stage}_status`] = "failed";
      folderPickerRecord[`${stage}_error`] = error.message;
      await saveReportAfterStageFailure(stage, folderPickerRecord, error);
      await captureDiagnosticScreenshot(stage, error);
      throw error;
    }
    folderPickerRecord[`${stage}_status`] = "completed";
    await saveReport();
    return stdout;
  };

  if (!Number.isInteger(processId) || !processId || processId <= 0) {
    await saveFailure("first_run_open", new Error("OpenObsidian did not expose its process id for Windows folder selection"));
  }
  let windowsBefore: WindowsTopLevelWindow[];
  let applicationWindowHandle: number | null = null;
  let applicationWindowClassName: string | null = null;
  try {
    windowsBefore = windowsTopLevelWindowInventory();
    folderPickerRecord.windows_before_open_click = windowsBefore;
    const readErrors = windowsBefore.filter((window) => window.read_error).map((window) => window.read_error);
    if (readErrors.length > 0) {
      throw new Error(`Windows top-level UIA baseline inventory had read errors: ${readErrors.join(" | ")}`);
    }
    const visibleApplicationWindows = windowsBefore.filter((window) => window.process_id === processId
      && window.native_window_handle > 0
      && !window.is_offscreen);
    if (visibleApplicationWindows.length !== 1) {
      throw new Error(`Windows top-level UIA baseline expected exactly one visible OpenObsidian window for process ${processId}; found ${visibleApplicationWindows.length}`);
    }
    const applicationWindow = visibleApplicationWindows[0];
    if (!applicationWindow.class_name.trim()) {
      throw new Error("Windows top-level UIA baseline did not expose the application window class");
    }
    applicationWindowHandle = applicationWindow.native_window_handle;
    applicationWindowClassName = applicationWindow.class_name;
    folderPickerRecord.application_window_before_selection = applicationWindow;
  } catch (error) {
    recordProcessErrorOutput("picker_inventory", error);
    folderPickerRecord.picker_inventory_status = "failed";
    folderPickerRecord.picker_inventory_error = error instanceof Error ? error.message : String(error);
    await saveReportAfterStageFailure("picker_inventory", folderPickerRecord, error);
    await captureDiagnosticScreenshot("picker_inventory", error);
    await saveFailure("picker_inventory", error);
  }
  folderPickerRecord.windows_before_open_click = windowsBefore;
  folderPickerRecord.picker_inventory_status = "captured-before-open";
  await saveReport();

  folderPickerRecord.first_run_open_status = "pending";
  await saveReport();
  try {
    await clickFirstRunOpenButton(connection, reporter);
  } catch (error) {
    folderPickerRecord.first_run_open_status = "failed";
    folderPickerRecord.first_run_open_error = error instanceof Error ? error.message : String(error);
    await saveReportAfterStageFailure("first_run_open", folderPickerRecord, error);
    try {
      folderPickerRecord.windows_after_open_failure = windowsTopLevelWindowInventory();
    } catch (inventoryError) {
      recordProcessErrorOutput("open_failure_inventory", inventoryError);
      folderPickerRecord.open_failure_inventory_error = inventoryError instanceof Error ? inventoryError.message : String(inventoryError);
    }
    await captureDiagnosticScreenshot("first_run_open", error);
    await saveFailure("first_run_open", error);
  }
  folderPickerRecord.first_run_open_status = "clicked";
  await saveReport();

  folderPickerRecord.picker_visibility_status = "pending";
  await saveReport();
  let pickerWindow: WindowsTopLevelWindow;
  try {
    const inventory = await waitFor(
      "new OpenObsidian-owned Windows folder picker",
      async () => windowsTopLevelWindowInventory(),
      (windows) => windows.some((window) => window.process_id === processId
        && window.name === "Open folder as vault"
        && !window.is_offscreen
        && !window.read_error
        && !windowsBefore.some((previous) => previous.native_window_handle === window.native_window_handle)),
      20_000,
    );
    if (inventory.some((window) => window.read_error)) {
      throw new Error(`Windows folder picker inventory contained UIA read errors: ${inventory.filter((window) => window.read_error).map((window) => window.read_error).join(" | ")}`);
    }
    const candidates = inventory.filter((window) => window.process_id === processId
      && window.name === "Open folder as vault"
      && !window.is_offscreen
      && !windowsBefore.some((previous) => previous.native_window_handle === window.native_window_handle));
    if (candidates.length !== 1 || candidates[0].native_window_handle <= 0) {
      throw new Error(`Expected exactly one new visible OpenObsidian folder picker; candidates=${JSON.stringify(candidates)}; inventory=${JSON.stringify(inventory)}`);
    }
    pickerWindow = candidates[0];
  } catch (error) {
    recordProcessErrorOutput("picker_visibility", error);
    folderPickerRecord.picker_visibility_status = "failed";
    folderPickerRecord.picker_visibility_error = error instanceof Error ? error.message : String(error);
    await saveReportAfterStageFailure("picker_visibility", folderPickerRecord, error);
    try {
      folderPickerRecord.windows_after_visibility_failure = windowsTopLevelWindowInventory();
    } catch (inventoryError) {
      recordProcessErrorOutput("visibility_failure_inventory", inventoryError);
      folderPickerRecord.visibility_failure_inventory_error = inventoryError instanceof Error ? inventoryError.message : String(inventoryError);
    }
    await captureDiagnosticScreenshot("picker_visibility", error);
    await saveFailure("picker_visibility", error);
  }
  folderPickerRecord.picker_window = pickerWindow;
  folderPickerRecord.picker_window_handle = pickerWindow.native_window_handle;
  folderPickerRecord.picker_visibility_status = "confirmed-exact-process-window";
  await saveReport();

  await capturePickerScreenshot("initial_picker_screenshot", "obsidian-folder-picker-initial.png");
  const pathEntryScript = `
    $ErrorActionPreference = "Stop"
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type @'
    using System;
    using System.Runtime.InteropServices;
    public static class OpenObsidianPickerNative {
      [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
      [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    }
'@
    $expectedProcessId = [int]$env:OPENOBSIDIAN_WINDOW_PROCESS_ID
    $pickerHandle = [IntPtr]::new([long]$env:OPENOBSIDIAN_PICKER_WINDOW_HANDLE)
    $picker = [System.Windows.Automation.AutomationElement]::FromHandle($pickerHandle)
    if ($null -eq $picker) { throw "Could not resolve the recorded Windows folder picker handle" }
    $pickerCurrent = $picker.Current
    if ($pickerCurrent.ProcessId -ne $expectedProcessId -or $pickerCurrent.Name -ne "Open folder as vault") {
      throw "Recorded folder picker identity changed: process=$($pickerCurrent.ProcessId), name=$($pickerCurrent.Name)"
    }
    [OpenObsidianPickerNative]::SetForegroundWindow($pickerHandle) | Out-Null
    Start-Sleep -Milliseconds 250
    $foregroundHandle = [OpenObsidianPickerNative]::GetForegroundWindow()
    if ($foregroundHandle.ToInt64() -ne $pickerHandle.ToInt64()) {
      throw "Could not confirm the exact Obsidian folder picker is foreground; expected=$($pickerHandle.ToInt64()), actual=$($foregroundHandle.ToInt64())"
    }
    $shell = New-Object -ComObject WScript.Shell
    $shell.SendKeys("^l")
    Start-Sleep -Milliseconds 250
    if ([OpenObsidianPickerNative]::GetForegroundWindow().ToInt64() -ne $pickerHandle.ToInt64()) {
      throw "Obsidian folder picker lost foreground before path paste"
    }
    [System.Windows.Forms.Clipboard]::SetText($env:OBSIDIAN_PICKER_VAULT_PATH)
    $shell.SendKeys("^v")
    Start-Sleep -Milliseconds 250
    if ([OpenObsidianPickerNative]::GetForegroundWindow().ToInt64() -ne $pickerHandle.ToInt64()) {
      throw "Obsidian folder picker lost foreground before path confirmation"
    }
    $shell.SendKeys("{ENTER}")
    Write-Output "Path entered through the foreground-confirmed Obsidian folder picker; process=$expectedProcessId; handle=$($pickerHandle.ToInt64())"
  `;
  await runPickerPowerShell("path_entry", pathEntryScript);
  await delay(750);
  await capturePickerScreenshot("path_entry_screenshot", "obsidian-folder-picker-after-path.png");

  const selectFolderScript = `
    $ErrorActionPreference = "Stop"
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type @'
    using System;
    using System.Collections.Generic;
    using System.Runtime.InteropServices;
    using System.Text;
    using System.ComponentModel;

    public struct OpenObsidianPickerRect {
      public int Left;
      public int Top;
      public int Right;
      public int Bottom;
    }

    public sealed class OpenObsidianPickerWindowSnapshot {
      public long handle { get; set; }
      public long parent_handle { get; set; }
      public int process_id { get; set; }
      public int thread_id { get; set; }
      public string class_name { get; set; }
      public string caption { get; set; }
      public int control_id { get; set; }
      public bool visible { get; set; }
      public bool enabled { get; set; }
      public int left { get; set; }
      public int top { get; set; }
      public int right { get; set; }
      public int bottom { get; set; }
      public int width { get; set; }
      public int height { get; set; }
      public bool has_bounds { get; set; }
      public bool is_window { get; set; }
      public string read_error { get; set; }
    }

    public static class OpenObsidianPickerNative {
      private delegate bool EnumChildProc(IntPtr handle, IntPtr parameter);
      private const uint BM_CLICK = 0x00F5;
      private const uint WM_GETTEXT = 0x000D;
      private const uint SMTO_ABORTIFHUNG = 0x0002;
      private const uint SMTO_BLOCK = 0x0001;
      private const uint CAPTION_READ_TIMEOUT_MS = 2000;
      private const int CAPTION_BUFFER_CHARS = 512;
      [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
      [DllImport("user32.dll", SetLastError = true)] private static extern bool IsWindow(IntPtr handle);
      [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr handle);
      [DllImport("user32.dll")] private static extern bool IsChild(IntPtr parent, IntPtr handle);
      [DllImport("user32.dll", SetLastError = true)] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
      [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern int GetClassName(IntPtr handle, StringBuilder className, int maxCount);
      [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
      [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr handle);
      [DllImport("user32.dll", SetLastError = true)] private static extern bool GetWindowRect(IntPtr handle, out OpenObsidianPickerRect rect);
      [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr handle);
      [DllImport("user32.dll", SetLastError = true)] private static extern bool EnumChildWindows(IntPtr parent, EnumChildProc callback, IntPtr parameter);
      [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SendMessageTimeout(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeoutMs, out IntPtr result);
      [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true, EntryPoint = "SendMessageTimeoutW")]
      private static extern IntPtr SendMessageTimeoutText(IntPtr handle, uint message, IntPtr wParam, [Out] StringBuilder text, uint flags, uint timeoutMs, out IntPtr result);

      public static OpenObsidianPickerWindowSnapshot Inspect(IntPtr handle) {
        var snapshot = new OpenObsidianPickerWindowSnapshot {
          handle = handle.ToInt64(),
          parent_handle = GetParent(handle).ToInt64(),
          class_name = "",
          caption = "",
          read_error = ""
        };
        snapshot.is_window = IsWindow(handle);
        if (!snapshot.is_window) {
          snapshot.read_error = "HWND is no longer a window";
          return snapshot;
        }
        uint processId;
        snapshot.thread_id = (int)GetWindowThreadProcessId(handle, out processId);
        snapshot.process_id = (int)processId;
        var className = new StringBuilder(256);
        if (GetClassName(handle, className, className.Capacity) <= 0) {
          snapshot.read_error += "GetClassName failed (" + Marshal.GetLastWin32Error() + "); ";
        } else {
          snapshot.class_name = className.ToString();
        }
        var caption = new StringBuilder(CAPTION_BUFFER_CHARS);
        IntPtr copied;
        IntPtr textRead = SendMessageTimeoutText(
          handle,
          WM_GETTEXT,
          new IntPtr(caption.Capacity),
          caption,
          SMTO_ABORTIFHUNG | SMTO_BLOCK,
          CAPTION_READ_TIMEOUT_MS,
          out copied);
        if (textRead == IntPtr.Zero) {
          snapshot.read_error += "SendMessageTimeout(WM_GETTEXT) failed or timed out (" + Marshal.GetLastWin32Error() + "); ";
        } else if (copied.ToInt64() < 0 || copied.ToInt64() >= caption.Capacity - 1) {
          snapshot.read_error += "SendMessageTimeout(WM_GETTEXT) returned an invalid or truncated character count (" + copied + "); ";
        } else {
          snapshot.caption = caption.ToString();
        }
        snapshot.control_id = GetDlgCtrlID(handle);
        snapshot.visible = IsWindowVisible(handle);
        snapshot.enabled = IsWindowEnabled(handle);
        OpenObsidianPickerRect rect;
        if (!GetWindowRect(handle, out rect)) {
          snapshot.read_error += "GetWindowRect failed (" + Marshal.GetLastWin32Error() + "); ";
        } else {
          snapshot.left = rect.Left;
          snapshot.top = rect.Top;
          snapshot.right = rect.Right;
          snapshot.bottom = rect.Bottom;
          snapshot.width = rect.Right - rect.Left;
          snapshot.height = rect.Bottom - rect.Top;
          snapshot.has_bounds = true;
        }
        snapshot.read_error = snapshot.read_error.Trim();
        return snapshot;
      }

      public static OpenObsidianPickerWindowSnapshot[] EnumerateChildren(IntPtr parent) {
        var snapshots = new List<OpenObsidianPickerWindowSnapshot>();
        EnumChildProc callback = delegate(IntPtr child, IntPtr parameter) {
          var snapshot = Inspect(child);
          snapshot.is_window = snapshot.is_window && IsChild(parent, child);
          snapshots.Add(snapshot);
          return true;
        };
        bool success = EnumChildWindows(parent, callback, IntPtr.Zero);
        GC.KeepAlive(callback);
        if (!success) {
          int error = Marshal.GetLastWin32Error();
          if (error != 0) throw new Win32Exception(error, "EnumChildWindows failed");
        }
        return snapshots.ToArray();
      }

      public static bool IsChildOf(IntPtr parent, IntPtr handle) {
        return IsChild(parent, handle);
      }

      public static bool SendButtonClick(IntPtr handle, out long messageResult, out int error) {
        IntPtr result;
        IntPtr sent = SendMessageTimeout(handle, BM_CLICK, IntPtr.Zero, IntPtr.Zero, SMTO_ABORTIFHUNG, 2000, out result);
        messageResult = result.ToInt64();
        error = sent == IntPtr.Zero ? Marshal.GetLastWin32Error() : 0;
        return sent != IntPtr.Zero;
      }
    }
'@
    $expectedProcessId = [int]$env:OPENOBSIDIAN_WINDOW_PROCESS_ID
    $pickerHandle = [IntPtr]::new([long]$env:OPENOBSIDIAN_PICKER_WINDOW_HANDLE)
    $picker = [System.Windows.Automation.AutomationElement]::FromHandle($pickerHandle)
    if ($null -eq $picker) { throw "Could not resolve the recorded Windows folder picker handle" }
    $pickerCurrent = $picker.Current
    if ($pickerCurrent.ProcessId -ne $expectedProcessId -or $pickerCurrent.Name -ne "Open folder as vault") {
      throw "Recorded folder picker identity changed: process=$($pickerCurrent.ProcessId), name=$($pickerCurrent.Name)"
    }
    if ([OpenObsidianPickerNative]::GetForegroundWindow().ToInt64() -ne $pickerHandle.ToInt64()) {
      throw "The exact Obsidian folder picker is not foreground before Select Folder activation"
    }
    $buttonCondition = [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Button
    )
    $buttons = $picker.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
    $matchingButtons = @()
    $buttonReadErrors = @()
    $buttonLabels = @()
    foreach ($button in $buttons) {
      try {
        $current = $button.Current
        $buttonLabels += [string]$current.Name
        if ($current.ProcessId -eq $expectedProcessId -and $current.Name -eq "Select Folder") {
          $matchingButtons += $button
        }
      } catch { $buttonReadErrors += $_.Exception.Message }
    }
    if ($buttonReadErrors.Count -gt 0) {
      throw "Could not read every button under the exact Obsidian folder picker; errors=$($buttonReadErrors -join ' | ')"
    }
    if ($matchingButtons.Count -gt 1) {
      $labels = @($buttonLabels) -join " | "
      throw "Expected one Select Folder button inside the exact Obsidian picker; found $($matchingButtons.Count); picker buttons=$labels"
    }
    if ($matchingButtons.Count -eq 0) {
      $nativePicker = [OpenObsidianPickerNative]::Inspect($pickerHandle)
      $nativePickerJson = ConvertTo-Json -InputObject $nativePicker -Depth 4 -Compress
      Write-Output "NATIVE_PICKER_TOP_LEVEL_JSON:$nativePickerJson"
      if ($nativePicker.read_error) { throw "Could not read the exact picker HWND through Win32: $($nativePicker.read_error)" }
      if (-not $nativePicker.is_window -or
          $nativePicker.process_id -ne $expectedProcessId -or
          $nativePicker.class_name -cne "#32770" -or
          $nativePicker.caption -cne "Open folder as vault" -or
          -not $nativePicker.visible -or
          -not $nativePicker.enabled -or
          -not $nativePicker.has_bounds -or
          $nativePicker.width -le 0 -or
          $nativePicker.height -le 0) {
        throw "The recorded HWND is no longer the exact visible enabled Obsidian folder picker: $nativePickerJson"
      }
      if ([OpenObsidianPickerNative]::GetForegroundWindow().ToInt64() -ne $pickerHandle.ToInt64()) {
        throw "The exact Obsidian picker lost foreground before native Select Folder lookup"
      }
      $nativeChildren = @([OpenObsidianPickerNative]::EnumerateChildren($pickerHandle))
      $nativeChildrenJson = ConvertTo-Json -InputObject @($nativeChildren) -Depth 5 -Compress
      Write-Output "NATIVE_PICKER_CHILD_INVENTORY_JSON:$nativeChildrenJson"
      $nativeReadErrors = @($nativeChildren | Where-Object { $_.read_error })
      if ($nativeReadErrors.Count -gt 0) {
        throw "Win32 could not read every descendant of the exact Obsidian picker: $(@($nativeReadErrors | ForEach-Object { $_.read_error }) -join ' | ')"
      }
      $matchingNativeButtons = @($nativeChildren | Where-Object {
        $_.is_window -and
        $_.process_id -eq $expectedProcessId -and
        $_.class_name -ceq "Button" -and
        ([string]$_.caption).Replace("&", "") -ceq "Select Folder"
      })
      if ($matchingNativeButtons.Count -ne 1) {
        throw "Expected one exact Win32 Button captioned Select Folder below the recorded Obsidian picker; found $($matchingNativeButtons.Count); picker HWND=$($pickerHandle.ToInt64()); native descendants=$nativeChildrenJson"
      }
      $nativeSelectFolder = $matchingNativeButtons[0]
      if (-not $nativeSelectFolder.is_window -or
          -not $nativeSelectFolder.visible -or
          -not $nativeSelectFolder.enabled -or
          -not $nativeSelectFolder.has_bounds -or
          $nativeSelectFolder.width -le 0 -or
          $nativeSelectFolder.height -le 0 -or
          $nativeSelectFolder.left -lt $nativePicker.left -or
          $nativeSelectFolder.top -lt $nativePicker.top -or
          $nativeSelectFolder.right -gt $nativePicker.right -or
          $nativeSelectFolder.bottom -gt $nativePicker.bottom) {
        throw "The unique native Select Folder button is hidden, disabled, unreadable, zero-sized, or outside the exact picker rectangle: $($nativeSelectFolder | ConvertTo-Json -Compress)"
      }
      $pickerBeforeClick = [OpenObsidianPickerNative]::Inspect($pickerHandle)
      $buttonBeforeClick = [OpenObsidianPickerNative]::Inspect([IntPtr]::new([long]$nativeSelectFolder.handle))
      $pickerChanged = [bool]($pickerBeforeClick.read_error -or
        -not $pickerBeforeClick.is_window -or
        $pickerBeforeClick.process_id -ne $expectedProcessId -or
        $pickerBeforeClick.class_name -cne "#32770" -or
        $pickerBeforeClick.caption -cne "Open folder as vault" -or
        -not $pickerBeforeClick.visible -or
        -not $pickerBeforeClick.enabled -or
        $pickerBeforeClick.left -ne $nativePicker.left -or
        $pickerBeforeClick.top -ne $nativePicker.top -or
        $pickerBeforeClick.right -ne $nativePicker.right -or
        $pickerBeforeClick.bottom -ne $nativePicker.bottom)
      $buttonChanged = [bool]($buttonBeforeClick.read_error -or
        -not $buttonBeforeClick.is_window -or
        -not [OpenObsidianPickerNative]::IsChildOf($pickerHandle, [IntPtr]::new([long]$nativeSelectFolder.handle)) -or
        $buttonBeforeClick.process_id -ne $expectedProcessId -or
        $buttonBeforeClick.class_name -cne "Button" -or
        ([string]$buttonBeforeClick.caption).Replace("&", "") -cne "Select Folder" -or
        $buttonBeforeClick.control_id -ne $nativeSelectFolder.control_id -or
        -not $buttonBeforeClick.visible -or
        -not $buttonBeforeClick.enabled -or
        -not $buttonBeforeClick.has_bounds -or
        $buttonBeforeClick.left -ne $nativeSelectFolder.left -or
        $buttonBeforeClick.top -ne $nativeSelectFolder.top -or
        $buttonBeforeClick.right -ne $nativeSelectFolder.right -or
        $buttonBeforeClick.bottom -ne $nativeSelectFolder.bottom)
      if ($pickerChanged -or $buttonChanged) {
        throw "The exact picker or native Select Folder button identity/state/bounds changed before activation; picker=$($pickerBeforeClick | ConvertTo-Json -Compress); button=$($buttonBeforeClick | ConvertTo-Json -Compress)"
      }
      if ([OpenObsidianPickerNative]::GetForegroundWindow().ToInt64() -ne $pickerHandle.ToInt64()) {
        throw "The exact Obsidian folder picker lost foreground before native Select Folder activation"
      }
      $nativeMessageResult = [long]0
      $nativeMessageError = 0
      $nativeClickSent = [OpenObsidianPickerNative]::SendButtonClick([IntPtr]::new([long]$nativeSelectFolder.handle), [ref]$nativeMessageResult, [ref]$nativeMessageError)
      if (-not $nativeClickSent) {
        throw "Could not send a bounded BM_CLICK to the exact native Select Folder button; Win32 error=$nativeMessageError"
      }
      Write-Output "NATIVE_PICKER_BUTTON_ACTIVATION:BM_CLICK; picker=$($pickerHandle.ToInt64()); child=$($nativeSelectFolder.handle); control_id=$($nativeSelectFolder.control_id); bounds=$($nativeSelectFolder.left),$($nativeSelectFolder.top),$($nativeSelectFolder.width),$($nativeSelectFolder.height); message_result=$nativeMessageResult"
      return
    }
    $selectFolder = $matchingButtons[0]
    if (-not $selectFolder.Current.IsEnabled -or $selectFolder.Current.IsOffscreen) {
      throw "The exact Select Folder UIA button is disabled or offscreen"
    }
    $buttonBounds = $selectFolder.Current.BoundingRectangle
    if ($buttonBounds.Width -le 0 -or $buttonBounds.Height -le 0) {
      throw "The exact Select Folder UIA button has invalid bounds"
    }
    $pickerCurrent = $picker.Current
    $buttonCurrent = $selectFolder.Current
    $pickerIdentityChanged = $pickerCurrent.ProcessId -ne $expectedProcessId -or $pickerCurrent.Name -ne "Open folder as vault"
    $buttonIdentityChanged = $buttonCurrent.ProcessId -ne $expectedProcessId -or $buttonCurrent.Name -ne "Select Folder"
    $buttonUnavailable = -not $buttonCurrent.IsEnabled -or $buttonCurrent.IsOffscreen
    if ($pickerIdentityChanged -or $buttonIdentityChanged -or $buttonUnavailable) {
      throw "The exact Obsidian picker or Select Folder UIA target changed before activation"
    }
    if ([OpenObsidianPickerNative]::GetForegroundWindow().ToInt64() -ne $pickerHandle.ToInt64()) {
      throw "The exact Obsidian folder picker lost foreground before Select Folder activation"
    }
    try {
      $selectFolder.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      Write-Output "Invoked exact Select Folder UIA button; process=$expectedProcessId; handle=$($pickerHandle.ToInt64()); bounds=$($buttonBounds.Left),$($buttonBounds.Top),$($buttonBounds.Width),$($buttonBounds.Height)"
    } catch {
      $invokeError = $_.Exception.Message
      $selectFolder.SetFocus()
      Start-Sleep -Milliseconds 150
      if (-not $selectFolder.Current.HasKeyboardFocus) { throw "Could not confirm keyboard focus on exact Select Folder button after InvokePattern failure: $invokeError" }
      if ([OpenObsidianPickerNative]::GetForegroundWindow().ToInt64() -ne $pickerHandle.ToInt64()) {
        throw "Obsidian folder picker lost foreground before focused Select Folder confirmation"
      }
      $shell = New-Object -ComObject WScript.Shell
      $shell.SendKeys("{ENTER}")
      Write-Output "Focused exact Select Folder UIA button and pressed Enter; process=$expectedProcessId; handle=$($pickerHandle.ToInt64()); InvokePattern error=$invokeError"
    }
  `;
  const selectionResult = await runPickerPowerShell("select_folder", selectFolderScript);
  folderPickerRecord.picker_close_status = "pending";
  await saveReport();
  try {
    const windowsAfterPickerClose = await waitFor(
      "the recorded Obsidian folder picker to close",
      async () => windowsTopLevelWindowInventory(),
      (windows) => {
        const recordedPickerHandleStillPresent = windows.some((window) => window.process_id === processId
          && window.native_window_handle === pickerWindow.native_window_handle);
        const visibleApplicationHosts = windows.filter((window) => window.process_id === processId
          && window.class_name === applicationWindowClassName
          && window.native_window_handle > 0
          && !window.is_offscreen);
        return !recordedPickerHandleStillPresent
          && visibleApplicationHosts.length === 1
          && !windows.some((window) => window.read_error);
      },
      15_000,
    );
    folderPickerRecord.windows_after_picker_close = windowsAfterPickerClose;
    const applicationWindowsAfterClose = windowsAfterPickerClose.filter((window) => window.process_id === processId
      && window.class_name === applicationWindowClassName
      && window.native_window_handle > 0
      && !window.is_offscreen);
    folderPickerRecord.application_window_after_picker_close = applicationWindowsAfterClose[0] ?? null;
    folderPickerRecord.application_window_handle_changed = applicationWindowsAfterClose[0]?.native_window_handle !== applicationWindowHandle;
  } catch (error) {
    recordProcessErrorOutput("picker_close", error);
    folderPickerRecord.picker_close_status = "failed";
    folderPickerRecord.picker_close_error = error instanceof Error ? error.message : String(error);
    await saveReportAfterStageFailure("picker_close", folderPickerRecord, error);
    try {
      folderPickerRecord.windows_after_close_failure = windowsTopLevelWindowInventory();
    } catch (inventoryError) {
      recordProcessErrorOutput("close_failure_inventory", inventoryError);
      folderPickerRecord.close_failure_inventory_error = inventoryError instanceof Error ? inventoryError.message : String(inventoryError);
    }
    await captureDiagnosticScreenshot("picker_close", error);
    await saveFailure("picker_close", error);
  }
  folderPickerRecord.picker_close_status = "confirmed-closed";
  folderPickerRecord.picker_closed = true;
  reporter.folder_picker_closed = true;
  await saveReport();
  await capturePickerScreenshot("after_select_screenshot", "obsidian-folder-picker-after-select.png");
  return await finishVaultDirectorySelection(connection, port, {
    ...folderPickerRecord,
    selection_result: selectionResult,
    picker_screenshots: pickerScreenshots.map((path) => relative(reportDirectory, path)),
  }, options);
}

async function chooseVaultDirectory(connection: DevToolsConnection, port: number, child: ChildProcess, options: VaultDirectoryOptions = {}): Promise<DevToolsConnection> {
  if (process.platform === "linux") return await chooseVaultDirectoryLinux(connection, port, options);
  if (process.platform === "darwin") return await chooseVaultDirectoryMacOS(connection, port, child, options);
  if (process.platform === "win32") return await chooseVaultDirectoryWindows(connection, port, child, options);
  throw new Error(`Unsupported Obsidian folder picker platform ${process.platform}`);
}

async function chooseRestrictedMode(
  connection: DevToolsConnection,
  reporter: Record<string, unknown> = report.obsidian_authoring as Record<string, unknown>,
  vaultName = "C01.2 Roundtrip Fixture",
  expectedEditorText = noteMarker,
): Promise<void> {
  const readTrustState = async () => await connection.evaluateJson<{body: string; buttons: string[]; editor: string}>(`(() => {
    const buttons = [...document.querySelectorAll('button,[role="button"]')];
    return {
      body: document.body?.innerText ?? '',
      buttons: buttons.map((button) => (button.innerText || button.textContent || '').trim()).filter(Boolean),
      editor: [...document.querySelectorAll('[contenteditable="true"]')].map((element) => element.innerText ?? '').join('\\n'),
    };
  })()`);
  const state = await waitFor(
    "the reopened fixture vault trust decision",
    readTrustState,
    (value) => value.buttons.includes("Browse vault in Restricted Mode")
      || (!value.body.includes("Do you trust the author of this vault?")
        && (value.editor.includes(expectedEditorText) || value.body.includes(vaultName))),
    30_000,
  );
  const restrictedModeLabel = "Browse vault in Restricted Mode";
  reporter.trust_prompt_buttons = state.buttons;
  if (!state.buttons.includes(restrictedModeLabel)) {
    if (state.body.includes("Do you trust the author of this vault?")) {
      throw new Error("Obsidian displayed the vault trust prompt without its Restricted Mode button");
    }
    reporter.restricted_mode_selected = false;
    return;
  }

  connection.send("Runtime.evaluate", {
    expression: `(() => [...document.querySelectorAll('button,[role="button"]')]
      .find((button) => (button.innerText || button.textContent || '').trim() === '${restrictedModeLabel}')?.click())()`,
    returnByValue: true,
  });
  const body = await waitForRenderer(connection, "document.body?.innerText ?? ''", (value) => !value.includes("Do you trust the author of this vault?") && value.includes(vaultName), `Obsidian to browse ${vaultName} in Restricted Mode`, 30_000);
  reporter.restricted_mode_selected = true;
  reporter.restricted_mode_text = body.slice(0, 2_000);
}

function readCanvasReferenceFixtureBytes(): Buffer {
  const document = {
    nodes: [
      {
        id: "text-1",
        type: "text",
        x: 10,
        y: 20,
        width: 320,
        height: 140,
        text: canvasMarker,
        color: "1",
      },
      {
        id: "file-1",
        type: "file",
        x: 370,
        y: 20,
        width: 240,
        height: 150,
        file: canvasTargetPath,
        subpath: "#^block-id",
        color: "2",
      },
      {
        id: "group-1",
        type: "group",
        x: 10,
        y: 220,
        width: 620,
        height: 260,
        label: "Reference group",
        children: ["text-1", "file-1"],
        background: "Assets/group-background.png",
        backgroundStyle: "cover",
      },
    ],
    edges: [],
  };
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
}

async function createCanvasReferenceFixture(): Promise<{bytes: number; sha256: string}> {
  await mkdir(join(canvasVaultRoot, "Notes"), {recursive: true});
  await mkdir(join(canvasVaultRoot, "Assets"), {recursive: true});
  await mkdir(join(canvasVaultRoot, ".obsidian"), {recursive: true});
  await mkdir(join(canvasVaultRoot, ".obsidian", "plugins"), {recursive: true});
  await mkdir(join(canvasVaultRoot, ".obsidian", "themes"), {recursive: true});
  const canvasBytes = readCanvasReferenceFixtureBytes();
  const files: Record<string, Buffer> = {
    [canvasPath]: canvasBytes,
    [canvasTargetPath]: canvasTargetMarkdownBytes,
    "Assets/group-background.png": await readFile(resolve("assets/openobsidian-icon.png")),
    ".obsidian/app.json": await readFile(join(vaultRoot, ".obsidian", "app.json")),
    ".obsidian/appearance.json": await readFile(join(vaultRoot, ".obsidian", "appearance.json")),
    ".obsidian/community-plugins.json": await readFile(join(vaultRoot, ".obsidian", "community-plugins.json")),
    ".obsidian/core-plugins.json": await readFile(join(vaultRoot, ".obsidian", "core-plugins.json")),
  };
  for (const [path, bytes] of Object.entries(files)) await writeFile(join(canvasVaultRoot, path), bytes);
  const canvasHash = createHash("sha256").update(canvasBytes).digest("hex");
  await writeFile(join(reportDirectory, "canvas-reference-seed.canvas"), canvasBytes);
  const canvasReport = report.canvas_reference_reopen as Record<string, unknown>;
  canvasReport.vault_name = canvasVaultName;
  canvasReport.vault_path = canvasVaultRoot;
  canvasReport.fixture_profile = "Reference-compatible known-field Canvas document; the Rust codec's unknown-field fixture remains in fixtures/c06-canvas.json and is not opened by Obsidian.";
  canvasReport.path = canvasPath;
  canvasReport.marker = canvasMarker;
  canvasReport.target_path = canvasTargetPath;
  canvasReport.target_subpath = "#^block-id";
  canvasReport.seeded_files = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }]));
  canvasReport.source_before_first_open = {bytes: canvasBytes.length, sha256: canvasHash};
  return {bytes: canvasBytes.length, sha256: canvasHash};
}

function basesDirectionDefinition(direction: string): Buffer {
  const label = direction === omittedBasesDirection ? "omitted" : direction;
  const directionLine = direction === omittedBasesDirection ? "" : `      direction: ${direction}\n`;
  const viewName = `C07 group direction ${label}`;
  return Buffer.from(
    `views:\n  - type: table\n    name: ${viewName}\n    groupBy:\n      property: team\n${directionLine}`,
    "utf8",
  );
}

async function createBasesDirectionFixture(): Promise<Record<string, {bytes: number; sha256: string}>> {
  await mkdir(join(basesVaultRoot, "Notes"), {recursive: true});
  await mkdir(join(basesVaultRoot, ".obsidian"), {recursive: true});
  await mkdir(join(basesVaultRoot, ".obsidian", "plugins"), {recursive: true});
  await mkdir(join(basesVaultRoot, ".obsidian", "themes"), {recursive: true});
  const files: Record<string, Buffer> = {
    "Ascending.base": basesDirectionDefinition("ASC"),
    "Descending.base": basesDirectionDefinition("DESC"),
    "Omitted Direction.base": basesDirectionDefinition(omittedBasesDirection),
    "Invalid Direction.base": basesDirectionDefinition(invalidBasesDirection),
    "Notes/01-zulu-first.md": Buffer.from("---\nteam: Zulu\n---\n\nSynthetic C07 first Zulu row.\n", "utf8"),
    "Notes/02-alpha-first.md": Buffer.from("---\nteam: Alpha\n---\n\nSynthetic C07 first Alpha row.\n", "utf8"),
    "Notes/03-bravo-first.md": Buffer.from("---\nteam: Bravo\n---\n\nSynthetic C07 first Bravo row.\n", "utf8"),
    "Notes/04-zulu-second.md": Buffer.from("---\nteam: Zulu\n---\n\nSynthetic C07 second Zulu row.\n", "utf8"),
    "Notes/05-alpha-second.md": Buffer.from("---\nteam: Alpha\n---\n\nSynthetic C07 second Alpha row.\n", "utf8"),
    "Notes/06-bravo-second.md": Buffer.from("---\nteam: Bravo\n---\n\nSynthetic C07 second Bravo row.\n", "utf8"),
    ".obsidian/app.json": await readFile(join(vaultRoot, ".obsidian", "app.json")),
    ".obsidian/appearance.json": await readFile(join(vaultRoot, ".obsidian", "appearance.json")),
    ".obsidian/community-plugins.json": await readFile(join(vaultRoot, ".obsidian", "community-plugins.json")),
    ".obsidian/core-plugins.json": await readFile(join(vaultRoot, ".obsidian", "core-plugins.json")),
  };
  for (const [path, bytes] of Object.entries(files)) {
    const destination = join(basesVaultRoot, path);
    await mkdir(dirname(destination), {recursive: true});
    await writeFile(destination, bytes);
  }

  const sourceHashes = Object.fromEntries(Object.entries(files)
    .filter(([path]) => path.endsWith(".base") || path.endsWith(".md"))
    .map(([path, bytes]) => [path, {
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }]));
  const basesReport = report.bases_group_direction_reference as Record<string, unknown>;
  basesReport.vault_name = basesVaultName;
  basesReport.vault_path = basesVaultRoot;
  basesReport.source_hashes_before_open = sourceHashes;
  basesReport.note_order_by_path = [
    {path: "Notes/01-zulu-first.md", group: "Zulu"},
    {path: "Notes/02-alpha-first.md", group: "Alpha"},
    {path: "Notes/03-bravo-first.md", group: "Bravo"},
    {path: "Notes/04-zulu-second.md", group: "Zulu"},
    {path: "Notes/05-alpha-second.md", group: "Alpha"},
    {path: "Notes/06-bravo-second.md", group: "Bravo"},
  ];
  basesReport.fixture_paths_to_observe = basesDirectionFixturePaths;
  basesReport.reference_app_asset_sha256 = obsidianSha256;
  for (const [path, bytes] of Object.entries(files)) {
    await writeFile(join(reportDirectory, `bases-direction-${basename(path).replaceAll(".", "-")}.seed`), bytes);
  }
  return sourceHashes;
}

async function createGroupOrderReferenceFixture(): Promise<{
  fixture: GroupOrderFixture;
  sources: Record<string, Buffer>;
  sourceHashes: Record<string, GroupOrderSourceHash>;
  scenarioFixtures: Record<string, GroupOrderScenarioFixture>;
}> {
  const fixtureBytes = await readFile(groupOrderScenarioFixturePath);
  const fixtureSha256 = createHash("sha256").update(fixtureBytes).digest("hex");
  if (fixtureSha256 !== groupOrderScenarioFixtureSha256) {
    throw new Error(`C07.3 fixture source changed from the reviewed scenario/source inventory: expected=${groupOrderScenarioFixtureSha256}; observed=${fixtureSha256}`);
  }
  const fixtureValue = JSON.parse(fixtureBytes.toString("utf8")) as unknown;
  if (!fixtureValue || typeof fixtureValue !== "object" || Array.isArray(fixtureValue)) {
    throw new Error("C07.3 groupOrder fixture must be a JSON object");
  }
  const fixture = fixtureValue as GroupOrderFixture;
  if (fixture.schema_version !== 1 || fixture.id !== "fixture:c07-group-order-reference") {
    throw new Error(`Unexpected C07.3 groupOrder fixture identity: ${fixture.id}`);
  }
  if (typeof fixture.description !== "string" || !Array.isArray(fixture.notes) || fixture.notes.length === 0
    || !Array.isArray(fixture.scenarios) || fixture.scenarios.length === 0) {
    throw new Error("C07.3 groupOrder fixture must contain synthetic notes and scenarios");
  }
  for (const note of fixture.notes) {
    if (!note || typeof note !== "object" || typeof note.path !== "string" || typeof note.source !== "string") {
      throw new Error("C07.3 groupOrder notes must have string path and source fields");
    }
  }
  for (const scenario of fixture.scenarios) {
    if (!scenario || typeof scenario !== "object" || typeof scenario.id !== "string"
      || typeof scenario.base_path !== "string" || !Array.isArray(scenario.coverage)
      || !scenario.coverage.every((item) => typeof item === "string")) {
      throw new Error("C07.3 groupOrder scenarios must have string IDs, base paths, and coverage entries");
    }
    if (scenario.source_format !== "json" && scenario.source_format !== "native-yaml") {
      throw new Error(`C07.3 ${scenario.id} has unsupported source_format ${String(scenario.source_format)}`);
    }
    if (scenario.layout !== "table" && scenario.layout !== "kanban") {
      throw new Error(`C07.3 ${scenario.id} has unsupported layout ${String(scenario.layout)}`);
    }
    if (scenario.group_by_property !== undefined && (typeof scenario.group_by_property !== "string" || scenario.group_by_property.length === 0)) {
      throw new Error(`C07.3 ${scenario.id} group_by_property must be a non-empty string when present`);
    }
    if ((scenario.source_format === "native-yaml" && typeof scenario.source !== "string")
      || (scenario.source_format === "json" && typeof scenario.source !== "string"
        && (!scenario.source || typeof scenario.source !== "object" || Array.isArray(scenario.source)))) {
      throw new Error(`C07.3 ${scenario.id} source does not match its ${scenario.source_format} format`);
    }
  }
  if (fixture.scenarios.length !== 14) {
    throw new Error(`C07.3 groupOrder fixture must contain exactly 14 scenarios; found ${fixture.scenarios.length}`);
  }
  const scenarioIds = fixture.scenarios.map((scenario) => scenario.id);
  if (scenarioIds.some((id) => typeof id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(id)) || new Set(scenarioIds).size !== scenarioIds.length) {
    throw new Error("C07.3 groupOrder scenario IDs must be path-safe, non-empty, and unique");
  }
  const expectedScenarioIds = [
    "yaml-desc-precedence-listed-unlisted-empty-and-duplicate",
    "json-asc-precedence-listed-and-unlisted",
    "yaml-empty-group-order-list",
    "json-empty-group-order-list",
    "json-non-finite-number-entry-candidate",
    "yaml-binary-tag-value-candidate",
    "yaml-missing-vs-null-and-label-collision",
    "yaml-group-order-without-group-by",
    "yaml-typed-values-and-rendered-label-collisions",
    "json-typed-values-and-rendered-label-collisions",
    "yaml-malformed-scalar-order",
    "json-malformed-mapping-order",
    "yaml-unsupported-tag-entry",
    "yaml-formula-dependent-kanban",
  ];
  if (scenarioIds.length !== expectedScenarioIds.length
    || scenarioIds.some((id, index) => id !== expectedScenarioIds[index])) {
    throw new Error(`C07.3 scenario inventory or order changed: expected=${expectedScenarioIds.join(",")}; observed=${scenarioIds.join(",")}`);
  }
  const requiredCoverage = [
    "direction-precedence", "listed-unlisted", "empty-group", "duplicate-declaration", "empty-order-list",
    "missing-vs-null", "group-order-without-group-by", "typed-string", "typed-number", "typed-boolean",
    "typed-array", "typed-object", "typed-null", "typed-missing", "rendered-label-collision", "malformed-shape",
    "unsupported-entry-candidate", "non-finite-number-entry", "yaml-binary-entry-candidate", "yaml-tag-parser-rejection-probe",
    "formula-dependency", "formula-derived-grouping", "kanban",
  ];
  const coverage = new Set(fixture.scenarios.flatMap((scenario) => scenario.coverage));
  const missingCoverage = requiredCoverage.filter((name) => !coverage.has(name));
  if (missingCoverage.length > 0) throw new Error(`C07.3 groupOrder fixture omits required scenarios: ${missingCoverage.join(", ")}`);
  const zeroResultAllowlist = new Set([
    "json-empty-group-order-list",
    "yaml-empty-group-order-list",
    "yaml-binary-tag-value-candidate",
  ]);
  const observedZeroResultAllowlist = scenarioIds.filter((id) => zeroResultAllowlist.has(id));
  if (observedZeroResultAllowlist.length !== zeroResultAllowlist.size
    || [...zeroResultAllowlist].some((id) => !observedZeroResultAllowlist.includes(id))) {
    throw new Error("C07.3 zero-result observation allowlist must contain exactly the two empty-order scenarios and the YAML binary-tag candidate");
  }

  const sourceFiles: Record<string, Buffer> = {};
  for (const note of fixture.notes) {
    if (!note.path.startsWith("Notes/") || !note.path.endsWith(".md")) {
      throw new Error(`Unsafe C07.3 groupOrder note path: ${note.path}`);
    }
    resolveContainedPath(groupOrderVaultRoot, note.path);
    if (sourceFiles[note.path]) throw new Error(`Duplicate C07.3 groupOrder fixture path: ${note.path}`);
    sourceFiles[note.path] = Buffer.from(note.source, "utf8");
  }
  for (const scenario of fixture.scenarios) {
    if (!scenario.base_path.startsWith("Bases/") || !scenario.base_path.endsWith(".base")) {
      throw new Error(`Unsafe C07.3 groupOrder base path: ${scenario.base_path}`);
    }
    if (scenario.expected_error_outcome === "visible-error") {
      const expectedErrorText = typeof scenario.expected_error_text === "string" ? scenario.expected_error_text.trim() : "";
      const hasGroupOrderContext = /\b(?:groupBy|groupOrder|group by|group order)\b/i.test(expectedErrorText);
      const hasFailureWording = /\b(?:invalid|unsupported|must|could not|failed|malformed|error|exception|rejected|unable)\b/i.test(expectedErrorText);
      if (expectedErrorText.length < 20 || !hasGroupOrderContext || !hasFailureWording) {
        throw new Error(`C07.3 ${scenario.id} must name the specific groupBy/groupOrder failure in expected_error_text`);
      }
    } else if (scenario.expected_error_outcome !== undefined || scenario.expected_error_text !== undefined) {
      throw new Error(`C07.3 ${scenario.id} declares error expectations without expected_error_outcome=visible-error`);
    }
    resolveContainedPath(groupOrderVaultRoot, scenario.base_path);
    if (sourceFiles[scenario.base_path]) throw new Error(`Duplicate C07.3 groupOrder fixture path: ${scenario.base_path}`);
    let parsedJsonSource: Record<string, unknown> | undefined;
    let parsedJsonView: Record<string, unknown> | undefined;
    if (scenario.source_format === "json") {
      if (typeof scenario.source === "string") {
        try {
          parsedJsonSource = JSON.parse(scenario.source) as Record<string, unknown>;
        } catch (error) {
          throw new Error(`C07.3 ${scenario.id} JSON source is syntactically invalid: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        parsedJsonSource = scenario.source;
      }
      if (!parsedJsonSource || typeof parsedJsonSource !== "object" || Array.isArray(parsedJsonSource)) {
        throw new Error(`C07.3 ${scenario.id} JSON source must be a .base object`);
      }
      const jsonViews = parsedJsonSource.views;
      if (!Array.isArray(jsonViews) || jsonViews.length !== 1
        || !jsonViews[0] || typeof jsonViews[0] !== "object" || Array.isArray(jsonViews[0])) {
        throw new Error(`C07.3 ${scenario.id} JSON source must contain exactly one view object`);
      }
      parsedJsonView = jsonViews[0] as Record<string, unknown>;
      if (parsedJsonView.type !== scenario.layout) {
        throw new Error(`C07.3 ${scenario.id} declares layout=${scenario.layout} but its JSON view type is ${String(parsedJsonView.type)}`);
      }
    }
    const yamlScenarioLines = scenario.source_format === "native-yaml" && typeof scenario.source === "string"
      ? scenario.source.split(/\r?\n/)
      : [];
    const yamlViewHeaderIndexes = yamlScenarioLines.flatMap((line, index) => /^views:\s*(?:#.*)?$/.test(line) ? [index] : []);
    const yamlViewHeaderIndex = yamlViewHeaderIndexes.length === 1 ? yamlViewHeaderIndexes[0] : -1;
    const yamlViewBlockEndIndex = yamlViewHeaderIndex < 0
      ? -1
      : yamlScenarioLines.findIndex((line, index) => index > yamlViewHeaderIndex
        && Boolean(line.trim()) && !/^\s*#/.test(line) && !/^\s/.test(line));
    const yamlViewLines = yamlViewHeaderIndex < 0
      ? []
      : yamlScenarioLines.slice(yamlViewHeaderIndex + 1, yamlViewBlockEndIndex < 0 ? undefined : yamlViewBlockEndIndex);
    const yamlViewEntries = yamlViewLines.filter((line) => /^  -\s+/.test(line));
    const yamlViewTypes = yamlViewLines.filter((line) => /^  -\s+type:\s*(?:table|kanban)\s*(?:#.*)?$/.test(line));
    const expectedYamlViewTypeLine = `  - type: ${scenario.layout}`;
    const yamlHasOneView = yamlViewHeaderIndexes.length === 1 && yamlViewEntries.length === 1
      && yamlViewTypes.length === 1 && yamlViewTypes[0] === expectedYamlViewTypeLine;
    const yamlGroupOrderKeys = yamlViewLines.filter((line) => /^ {4}groupOrder\s*:/.test(line));
    const yamlGroupOrderIndex = yamlGroupOrderKeys.length === 1 ? yamlViewLines.indexOf(yamlGroupOrderKeys[0]) : -1;
    const yamlGroupOrderNextLine = yamlGroupOrderIndex >= 0 ? yamlViewLines[yamlGroupOrderIndex + 1] ?? "" : "";
    const yamlGroupByKeys = yamlViewLines.filter((line) => /^ {4}groupBy:\s*(?:#.*)?$/.test(line));
    const yamlGroupByIndex = yamlGroupByKeys.length === 1 ? yamlViewLines.indexOf(yamlGroupByKeys[0]) : -1;
    if (scenario.source_format === "native-yaml" && !yamlHasOneView) {
      throw new Error(`C07.3 ${scenario.id} YAML source must contain exactly one view with type=${scenario.layout}`);
    }
    const yamlHasOneTableView = yamlHasOneView && scenario.layout === "table";
    if (scenario.id === "json-empty-group-order-list") {
      const view = (parsedJsonSource?.views as Array<Record<string, unknown>> | undefined)?.[0];
      if (scenario.source_format !== "json" || scenario.layout !== "table" || !scenario.group_by_property
        || (parsedJsonSource?.views as Array<Record<string, unknown>> | undefined)?.length !== 1
        || view?.type !== "table" || !Array.isArray(view?.groupOrder) || view.groupOrder.length !== 0) {
        throw new Error("C07.3 json-empty-group-order-list must remain a table with groupBy and an explicit empty JSON groupOrder array");
      }
    } else if (scenario.id === "yaml-empty-group-order-list") {
      if (scenario.source_format !== "native-yaml" || scenario.layout !== "table" || !scenario.group_by_property
        || !yamlHasOneTableView || yamlGroupOrderKeys.length !== 1
        || !/^ {4}groupOrder:\s*\[\s*\]\s*(?:#.*)?$/.test(yamlGroupOrderKeys[0])
        || !yamlViewLines.some((line) => /^ {4}groupBy:\s*(?:#.*)?$/.test(line))
        || !yamlViewLines.some((line) => /^ {6}property:\s*team\s*(?:#.*)?$/.test(line))) {
        throw new Error("C07.3 yaml-empty-group-order-list must remain a table with groupBy and an explicit empty YAML groupOrder list");
      }
    } else if (scenario.id === "yaml-binary-tag-value-candidate") {
      if (scenario.source_format !== "native-yaml" || scenario.layout !== "table" || !scenario.group_by_property
        || !yamlHasOneTableView || yamlGroupOrderKeys.length !== 1
        || !/^ {4}groupOrder:\s*(?:#.*)?$/.test(yamlGroupOrderKeys[0])
        || !/^ {6}-\s+!!binary\s+SGVsbG8=\s*(?:#.*)?$/.test(yamlGroupOrderNextLine)
        || !yamlViewLines.some((line) => /^ {4}groupBy:\s*(?:#.*)?$/.test(line))
        || !yamlViewLines.some((line) => /^ {6}property:\s*team\s*(?:#.*)?$/.test(line))) {
        throw new Error("C07.3 yaml-binary-tag-value-candidate must remain a table with groupBy and the !!binary SGVsbG8= entry");
      }
    }
    if (scenario.group_by_property) {
      if (scenario.source_format === "json") {
        const groupBy = parsedJsonView?.groupBy as Record<string, unknown> | undefined;
        if (!groupBy || groupBy.property !== scenario.group_by_property
          || (groupBy.direction !== "ASC" && groupBy.direction !== "DESC")) {
          throw new Error(`C07.3 ${scenario.id} must use the captured explicit groupBy mapping and direction`);
        }
      } else {
        const escapedProperty = scenario.group_by_property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const propertyLine = yamlGroupByIndex >= 0 ? yamlViewLines[yamlGroupByIndex + 1] ?? "" : "";
        const directionLine = yamlGroupByIndex >= 0 ? yamlViewLines[yamlGroupByIndex + 2] ?? "" : "";
        const expectedPropertyLine = new RegExp(`^ {6}property:\\s*${escapedProperty}\\s*(?:#.*)?$`);
        const validGroupByMapping = yamlHasOneView && yamlGroupByKeys.length === 1
          && expectedPropertyLine.test(propertyLine)
          && /^ {6}direction:\s*(?:ASC|DESC)\s*(?:#.*)?$/.test(directionLine);
        if (!validGroupByMapping) {
          throw new Error(`C07.3 ${scenario.id} must use the captured explicit groupBy mapping and direction`);
        }
      }
    } else if (scenario.source_format === "native-yaml"
      ? yamlGroupByKeys.length !== 0
      : Boolean(parsedJsonView?.groupBy !== undefined)) {
      throw new Error(`C07.3 ${scenario.id} is the no-groupBy scenario and must omit groupBy`);
    }
    const source = scenario.source_format === "json"
      ? typeof scenario.source === "string" ? `${scenario.source.trimEnd()}\n` : `${JSON.stringify(scenario.source, null, 2)}\n`
      : scenario.source as string;
    sourceFiles[scenario.base_path] = Buffer.from(source, "utf8");
  }

  const configFiles: Record<string, Buffer> = {
    ".obsidian/app.json": await readFile(join(vaultRoot, ".obsidian", "app.json")),
    ".obsidian/appearance.json": await readFile(join(vaultRoot, ".obsidian", "appearance.json")),
    ".obsidian/community-plugins.json": await readFile(join(vaultRoot, ".obsidian", "community-plugins.json")),
    ".obsidian/core-plugins.json": await readFile(join(vaultRoot, ".obsidian", "core-plugins.json")),
  };
  await rm(groupOrderVaultRoot, {recursive: true, force: true});
  await mkdir(groupOrderVaultRoot, {recursive: true});
  const sourceHashes = Object.fromEntries(Object.entries(sourceFiles).map(([path, bytes]) => [path, {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }]));
  const scenarioFixtures: Record<string, GroupOrderScenarioFixture> = {};
  for (const scenario of fixture.scenarios) {
    const scenarioSourceFiles = {...sourceFiles};
    const scenarioSourceHashes = Object.fromEntries(Object.entries(scenarioSourceFiles).map(([path, bytes]) => [path, {
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }]));
    const scenarioVaultRoot = resolveContainedPath(groupOrderVaultRoot, scenario.id);
    const files = {...scenarioSourceFiles, ...configFiles};
    for (const [path, bytes] of Object.entries(files)) {
      const destination = resolveContainedPath(scenarioVaultRoot, path);
      await mkdir(dirname(destination), {recursive: true});
      await writeFile(await assertNoSymlinkPathComponents(scenarioVaultRoot, path), bytes);
    }
    const fixturePaths = Object.keys(scenarioSourceHashes).sort((left, right) => left.localeCompare(right, "en"));
    const seedArtifacts: Record<string, string> = {};
    for (const path of Object.keys(scenarioSourceFiles)) {
      const pathToken = Buffer.from(path, "utf8").toString("hex");
      seedArtifacts[path] = `c07-group-order-seeds/${scenario.id}/${pathToken}.seed`;
    }
    scenarioFixtures[scenario.id] = {
      vault_root: scenarioVaultRoot,
      source_files: scenarioSourceFiles,
      source_hashes: scenarioSourceHashes,
      fixture_paths: fixturePaths,
      seed_artifacts: seedArtifacts,
    };
    for (const [path, bytes] of Object.entries(scenarioSourceFiles)) {
      const artifactPath = resolveContainedPath(reportDirectory, seedArtifacts[path]);
      await mkdir(dirname(artifactPath), {recursive: true});
      await writeFile(artifactPath, bytes);
    }
  }
  const basesReport = report.bases_group_order_reference as Record<string, unknown>;
  basesReport.scenario_vault_container_name = groupOrderVaultName;
  basesReport.work_directory = workDirectory;
  basesReport.scenario_vault_container_path = groupOrderVaultRoot;
  basesReport.fixture_manifest_sha256 = createHash("sha256").update(fixtureBytes).digest("hex");
  basesReport.scenario_count = fixture.scenarios.length;
  basesReport.scenario_inputs = fixture.scenarios.map((scenario) => ({
    id: scenario.id,
    base_path: scenario.base_path,
    source_format: scenario.source_format,
    layout: scenario.layout,
    group_by_property: scenario.group_by_property ?? null,
    expected_error_outcome: scenario.expected_error_outcome ?? null,
    expected_error_text: scenario.expected_error_text?.trim() ?? null,
    coverage: scenario.coverage,
    source_sha256: sourceHashes[scenario.base_path]?.sha256 ?? null,
    isolated_vault_path: scenarioFixtures[scenario.id]?.vault_root ?? null,
    source_hashes: scenarioFixtures[scenario.id]?.source_hashes ?? {},
    seed_artifacts: scenarioFixtures[scenario.id]?.seed_artifacts ?? {},
  }));
  basesReport.source_hashes_before_open = Object.fromEntries(Object.entries(scenarioFixtures).map(([id, scenarioFixture]) => [id, scenarioFixture.source_hashes]));
  basesReport.note_order_by_path = fixture.notes.map((note) => ({path: note.path, content_sha256: sourceHashes[note.path]?.sha256 ?? null}));
  basesReport.fixture_paths_to_observe = Object.fromEntries(Object.entries(scenarioFixtures).map(([id, scenarioFixture]) => [id, scenarioFixture.fixture_paths]));
  basesReport.scenario_isolation = "Each groupOrder scenario has its own copy of the complete synthetic vault, including all 14 .base inputs and shared Markdown notes, so every view has identical file membership while app rewrites cannot contaminate another scenario. Each vault uses a unique Obsidian profile and is restarted for its reopen capture.";
  basesReport.reference_app_asset_sha256 = obsidianSha256;
  basesReport.coverage_limitations = [
    "The JSON 1e999 and YAML !!binary cases are syntax-valid boundary/tag value candidates. Their outcomes are observations; neither is asserted to be unsupported before the pinned app is captured.",
    "The YAML custom-tag case records parser/tag rejection for the supplied source. It is a separate syntax probe and is not counted as an app-level unsupported groupOrder entry.",
    "Unless a candidate visibly demonstrates app-level rejection after the Bases view loads, unsupported app-level groupOrder entry behavior remains unprobed and Rust C07.3 parity remains blocked on that characterization.",
    "Visible membership is recorded as pinned-app behavior rather than inferred from the seed note set: a grouped table can omit notes outside its declared groupOrder, and a valid empty order can render a loaded table with zero results. Every non-empty result count must map one-to-one to unique fixture paths, including any rendered .base files. Zero results are accepted only for the two explicit empty-order scenarios and the YAML binary-tag candidate, with the exact Bases target active, one painted table shell, a painted 0-results count, and no groups, paths, unmapped rows, errors or error notices; the binary candidate remains an observation and does not establish rejection.",
    "The capture collapses the left sidebar and requests the available desktop viewport before observation. It scrolls each rendered group heading, path, and row candidate into view and records a painted hit/caret sample, bounds, and scroll positions; the scenario screenshot shows the final viewport only. Painted-text visibility uses discrete 3x3 samples, so narrow occluders can fall between sample points, and text/background contrast is not measured.",
    "Windows note-path radio scans cover all UI Automation descendants for the process rather than a verified selector-popup subtree, so an unrelated visible path radio can cause a fail-closed false failure. IsOffscreen status is UIA evidence and does not prove that the selector button is unobscured at the pixel level.",
  ];
  await writeFile(join(reportDirectory, "c07-group-order-fixture.json"), fixtureBytes);
  return {fixture, sources: sourceFiles, sourceHashes, scenarioFixtures};
}

async function recordGroupOrderSourceCheckpoint(
  expected: Record<string, GroupOrderSourceHash>,
  stage: string,
  scenarioId: string,
  scenarioVaultRoot: string,
): Promise<Record<string, GroupOrderSourceHash>> {
  const errors: string[] = [];
  let snapshot: SnapshotEntry[] = [];
  try {
    const scenarioRootRelativePath = relative(workDirectory, scenarioVaultRoot).split(sep).join("/");
    const guardedRoot = await assertNoSymlinkPathComponents(workDirectory, scenarioRootRelativePath);
    const rootMetadata = await lstat(guardedRoot);
    if (!rootMetadata.isDirectory()) throw new Error(`C07.3 scenario vault root is not a directory: ${guardedRoot}`);
    snapshot = await snapshotTree(scenarioVaultRoot);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const expectedSourcePaths = Object.keys(expected).sort((left, right) => left.localeCompare(right, "en"));
  const expectedSourcePathSet = new Set(expectedSourcePaths);
  const sourceEntries = snapshot.filter((entry) => /\.(?:base|md)$/i.test(entry.path)
    || (entry.kind !== "directory" && expectedSourcePaths.some((path) => path.startsWith(`${entry.path}/`))));
  const actualSourceEntries = new Map(sourceEntries.map((entry) => [entry.path, entry]));
  const observed: Record<string, GroupOrderSourceHash> = {};
  for (const entry of sourceEntries) {
    if (entry.bytes !== undefined && entry.sha256) observed[entry.path] = {bytes: entry.bytes, sha256: entry.sha256};
  }
  const changes: Array<Record<string, unknown>> = [];
  const artifactStage = stage.replaceAll(/[^a-z0-9-]/gi, "-");
  const describeObservedEntry = async (entry: SnapshotEntry): Promise<Record<string, unknown>> => {
    const description: Record<string, unknown> = {kind: entry.kind};
    if (entry.kind === "file" && entry.bytes !== undefined && entry.sha256) {
      description.bytes = entry.bytes;
      description.sha256 = entry.sha256;
      const bytes = await readFile(await assertNoSymlinkPathComponents(scenarioVaultRoot, entry.path));
      const artifactName = `c07-group-order-source-${scenarioId}-${artifactStage}-${entry.sha256}.bin`;
      await writeFile(resolveContainedPath(reportDirectory, artifactName), bytes);
      const verified = bytes.length === entry.bytes && createHash("sha256").update(bytes).digest("hex") === entry.sha256;
      description.exact_observed_bytes_artifact = artifactName;
      description.exact_observed_bytes_verified = verified;
      if (!verified) throw new Error(`Source bytes changed while recording ${entry.path} at ${stage}`);
      return description;
    }
    if (entry.kind === "symlink") {
      description.target = entry.target ?? null;
      description.target_sha256 = entry.target_sha256 ?? null;
      if (entry.target_bytes_base64 === undefined || !entry.target_sha256) throw new Error(`Symlink target evidence is incomplete for ${entry.path} at ${stage}`);
      const targetBytes = Buffer.from(entry.target_bytes_base64, "base64");
      const artifactName = `c07-group-order-link-${scenarioId}-${artifactStage}-${entry.target_sha256}.bin`;
      await writeFile(resolveContainedPath(reportDirectory, artifactName), targetBytes);
      const verified = createHash("sha256").update(targetBytes).digest("hex") === entry.target_sha256;
      description.exact_target_bytes_artifact = artifactName;
      description.exact_target_bytes_verified = verified;
      if (!verified) throw new Error(`Symlink target bytes changed while recording ${entry.path} at ${stage}`);
      description.exact_observed_state_recorded = true;
      return description;
    }
    if (entry.kind === "directory") {
      const descendants = snapshot.filter((candidate) => candidate.path.startsWith(`${entry.path}/`));
      const directoryEntries: Array<Record<string, unknown>> = [];
      let exactSubtreeRecorded = true;
      for (const descendant of descendants) {
        const nested: Record<string, unknown> = {path: descendant.path, kind: descendant.kind};
        const pathToken = createHash("sha256").update(descendant.path, "utf8").digest("hex");
        if (descendant.kind === "file" && descendant.bytes !== undefined && descendant.sha256) {
          const bytes = await readFile(await assertNoSymlinkPathComponents(scenarioVaultRoot, descendant.path));
          const artifactName = `c07-group-order-subtree-file-${scenarioId}-${artifactStage}-${pathToken}-${descendant.sha256}.bin`;
          await writeFile(resolveContainedPath(reportDirectory, artifactName), bytes);
          const verified = bytes.length === descendant.bytes && createHash("sha256").update(bytes).digest("hex") === descendant.sha256;
          nested.bytes = descendant.bytes;
          nested.sha256 = descendant.sha256;
          nested.exact_observed_bytes_artifact = artifactName;
          nested.exact_observed_bytes_verified = verified;
          exactSubtreeRecorded = exactSubtreeRecorded && verified;
        } else if (descendant.kind === "file") {
          exactSubtreeRecorded = false;
        } else if (descendant.kind === "symlink" && descendant.target_bytes_base64 !== undefined && descendant.target_sha256) {
          const targetBytes = Buffer.from(descendant.target_bytes_base64, "base64");
          const artifactName = `c07-group-order-subtree-link-${scenarioId}-${artifactStage}-${pathToken}-${descendant.target_sha256}.bin`;
          await writeFile(resolveContainedPath(reportDirectory, artifactName), targetBytes);
          const verified = createHash("sha256").update(targetBytes).digest("hex") === descendant.target_sha256;
          nested.target = descendant.target ?? null;
          nested.target_sha256 = descendant.target_sha256;
          nested.exact_target_bytes_artifact = artifactName;
          nested.exact_target_bytes_verified = verified;
          exactSubtreeRecorded = exactSubtreeRecorded && verified;
        } else if (descendant.kind === "symlink" || descendant.kind === "other") {
          exactSubtreeRecorded = false;
        }
        directoryEntries.push(nested);
      }
      const manifest = Buffer.from(`${JSON.stringify({root: entry.path, kind: "directory", entries: directoryEntries}, null, 2)}\n`, "utf8");
      const manifestSha256 = createHash("sha256").update(manifest).digest("hex");
      const manifestArtifact = `c07-group-order-subtree-${scenarioId}-${artifactStage}-${manifestSha256}.json`;
      await writeFile(resolveContainedPath(reportDirectory, manifestArtifact), manifest);
      description.directory_entries = directoryEntries;
      description.directory_manifest_artifact = manifestArtifact;
      description.directory_manifest_sha256 = manifestSha256;
      description.exact_observed_state_recorded = exactSubtreeRecorded;
      return description;
    }
    description.exact_observed_state_recorded = false;
    return description;
  };
  const observedStateRecorded = (description: Record<string, unknown>): boolean => description.kind === "file"
    ? description.exact_observed_bytes_verified === true
    : description.kind === "symlink"
      ? description.exact_target_bytes_verified === true
      : description.exact_observed_state_recorded === true;
  for (const path of expectedSourcePaths) {
    const entry = actualSourceEntries.get(path);
    if (!entry) {
      changes.push({path, status: "missing", expected: expected[path], observed: null});
      continue;
    }
    if (entry.kind === "file" && entry.bytes === expected[path].bytes && entry.sha256 === expected[path].sha256) continue;
    const change: Record<string, unknown> = {
      path,
      status: entry.kind === "file" ? "changed" : "type-changed",
      expected: expected[path],
      observed: null,
    };
    try {
      const description = await describeObservedEntry(entry);
      change.observed = description;
      change.exact_observed_state_recorded = observedStateRecorded(description);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      change.exact_observed_state_error = message;
      errors.push(`Could not preserve exact observed state for ${path} at ${stage}: ${message}`);
    }
    changes.push(change);
  }
  for (const entry of sourceEntries.filter((candidate) => !expectedSourcePathSet.has(candidate.path))) {
    const change: Record<string, unknown> = {path: entry.path, status: "new", expected: null, observed: null};
    try {
      const description = await describeObservedEntry(entry);
      change.observed = description;
      change.exact_observed_state_recorded = observedStateRecorded(description);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      change.exact_observed_state_error = message;
      errors.push(`Could not preserve exact observed state for new source ${entry.path} at ${stage}: ${message}`);
    }
    changes.push(change);
  }
  const basesReport = report.bases_group_order_reference as Record<string, unknown>;
  const checkpoints = (basesReport.source_hash_checkpoints ?? []) as Array<Record<string, unknown>>;
  const unchanged = changes.length === 0 && errors.length === 0 && expectedSourcePaths.every((path) => Boolean(observed[path]));
  checkpoints.push({scenario_id: scenarioId, stage, expected, observed, changes, errors, unchanged});
  basesReport.source_hash_checkpoints = checkpoints;
  if (!unchanged) {
    basesReport.source_preservation_passed = false;
    basesReport.reference_source_mutation_observed = basesReport.reference_source_mutation_observed === true || changes.length > 0;
    const failures = (basesReport.source_preservation_failures ?? []) as Array<Record<string, unknown>>;
    failures.push({scenario_id: scenarioId, stage, changes, errors});
    basesReport.source_preservation_failures = failures;
  } else if (basesReport.source_preservation_passed === undefined) {
    basesReport.source_preservation_passed = true;
  }
  await saveReport();
  return observed;
}

async function reseedGroupOrderScenarioSources(
  scenarioId: string,
  scenarioVaultRoot: string,
  sourceFiles: Record<string, Buffer>,
  before: Record<string, GroupOrderSourceHash>,
): Promise<void> {
  const scenarioRootRelativePath = relative(workDirectory, scenarioVaultRoot).split(sep).join("/");
  const guardedRoot = await assertNoSymlinkPathComponents(workDirectory, scenarioRootRelativePath);
  const rootMetadata = await lstat(guardedRoot);
  if (!rootMetadata.isDirectory()) throw new Error(`C07.3 scenario vault root is not a directory: ${guardedRoot}`);
  const snapshot = await snapshotTree(scenarioVaultRoot);
  const expectedPaths = new Set(Object.keys(sourceFiles));
  const removedSourceEntries: Array<Record<string, unknown>> = [];
  const entriesByPath = new Map(snapshot.map((entry) => [entry.path, entry]));
  const removedPaths = new Set<string>();
  const removalOrder = snapshot.slice().sort((left, right) => right.path.split("/").length - left.path.split("/").length
    || right.path.localeCompare(left.path, "en"));
  for (const entry of removalOrder) {
    const isSourcePath = /\.(?:base|md)$/i.test(entry.path);
    const obstructsExpectedSource = entry.kind !== "directory"
      && [...expectedPaths].some((path) => path.startsWith(`${entry.path}/`));
    const expectedPathHasWrongKind = expectedPaths.has(entry.path) && entry.kind !== "file";
    const removeEntry = (entry.kind === "symlink" && (isSourcePath || obstructsExpectedSource || expectedPathHasWrongKind))
      || (isSourcePath && (!expectedPaths.has(entry.path) || expectedPathHasWrongKind))
      || expectedPathHasWrongKind
      || obstructsExpectedSource;
    if (!removeEntry) continue;
    const record: Record<string, unknown> = {path: entry.path, kind: entry.kind};
    if (isSourcePath || obstructsExpectedSource || expectedPathHasWrongKind) {
      if (entry.kind === "file") {
        const bytes = await readFile(await assertNoSymlinkPathComponents(scenarioVaultRoot, entry.path));
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const artifact = `c07-group-order-source-${scenarioId}-before-reseed-${sha256}.bin`;
        await writeFile(resolveContainedPath(reportDirectory, artifact), bytes);
        record.bytes = bytes.length;
        record.sha256 = sha256;
        record.exact_observed_bytes_artifact = artifact;
      } else if (entry.kind === "symlink") {
        record.target = entry.target ?? null;
        record.target_sha256 = entry.target_sha256 ?? null;
        if (entry.target_bytes_base64 === undefined || !entry.target_sha256) {
          throw new Error(`C07.3 reseed cannot preserve symlink target evidence for ${entry.path}`);
        }
        const targetBytes = Buffer.from(entry.target_bytes_base64, "base64");
        const targetArtifact = `c07-group-order-link-${scenarioId}-before-reseed-${entry.target_sha256}.bin`;
        await writeFile(resolveContainedPath(reportDirectory, targetArtifact), targetBytes);
        record.exact_target_bytes_artifact = targetArtifact;
        record.exact_target_bytes_verified = createHash("sha256").update(targetBytes).digest("hex") === entry.target_sha256;
        if (record.exact_target_bytes_verified !== true) {
          throw new Error(`C07.3 reseed cannot verify symlink target evidence for ${entry.path}`);
        }
      }
      removedSourceEntries.push(record);
    }
    const entryPath = resolveContainedPath(scenarioVaultRoot, entry.path);
    if (entry.kind === "symlink") await unlink(entryPath);
    else await rm(entryPath, {recursive: true, force: true});
    removedPaths.add(entry.path);
  }
  for (const [path, bytes] of Object.entries(sourceFiles)) {
    const destination = resolveContainedPath(scenarioVaultRoot, path);
    const parentParts = path.split("/").slice(0, -1);
    for (let index = 0; index < parentParts.length; index += 1) {
      const ancestor = parentParts.slice(0, index + 1).join("/");
      const ancestorEntry = entriesByPath.get(ancestor);
      if (ancestorEntry && ancestorEntry.kind !== "directory" && !removedPaths.has(ancestor)) {
        throw new Error(`C07.3 reseed left a non-directory source ancestor in place: ${ancestor}`);
      }
    }
    await mkdir(dirname(destination), {recursive: true});
    await writeFile(await assertNoSymlinkPathComponents(scenarioVaultRoot, path), bytes);
  }
  const expectedAfter = Object.fromEntries(Object.entries(sourceFiles).map(([path, bytes]) => [path, {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }]));
  const after: Record<string, GroupOrderSourceHash> = {};
  for (const path of Object.keys(sourceFiles)) {
    const bytes = await readFile(await assertNoSymlinkPathComponents(scenarioVaultRoot, path));
    after[path] = {bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")};
  }
  const exactSeedRestored = isDeepStrictEqual(expectedAfter, after);
  const basesReport = report.bases_group_order_reference as Record<string, unknown>;
  const events = (basesReport.source_reseed_events ?? []) as Array<Record<string, unknown>>;
  events.push({
    scenario_id: scenarioId,
    after_stage: "first-open-after-shutdown",
    before,
    after,
    expected_after: expectedAfter,
    removed_source_entries: removedSourceEntries,
    restored_source_files: Object.keys(sourceFiles).sort((left, right) => left.localeCompare(right, "en")),
    exact_seed_restored: exactSeedRestored,
  });
  basesReport.source_reseed_events = events;
  await saveReport();
  if (!exactSeedRestored) throw new Error(`C07.3 harness reseed failed to restore exact source bytes for ${scenarioId}`);
}

async function readGroupOrderVisibleState(
  connection: DevToolsConnection,
  scenario: GroupOrderScenario,
  fixturePaths: string[],
): Promise<GroupOrderVisibleState> {
  const visibleState = await connection.evaluateJsonAwaited<GroupOrderVisibleState>(`(async () => {
    const fixturePaths = ${JSON.stringify(fixturePaths)};
    const requestedPath = ${JSON.stringify(scenario.base_path)};
    const layout = ${JSON.stringify(scenario.layout)};
    const groupByProperty = ${JSON.stringify(scenario.group_by_property ?? null)};
    const scenarioId = ${JSON.stringify(scenario.id)};
    const scenarioExpectsVisibleError = ${JSON.stringify(scenario.expected_error_outcome === "visible-error")};
    const expectedErrorText = ${JSON.stringify(scenario.expected_error_text?.trim() ?? null)};
    const root = document.querySelector('.workspace-leaf.mod-active') ?? document.body;
    const view = window.app?.workspace?.activeLeaf?.view;
    const body = root?.innerText ?? '';
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
      available_width: window.screen?.availWidth ?? window.innerWidth,
      available_height: window.screen?.availHeight ?? window.innerHeight,
    };
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.05
        && bounds.width > 0 && bounds.height > 0
        && bounds.right > 0 && bounds.bottom > 0
        && bounds.left < window.innerWidth && bounds.top < window.innerHeight;
    };
    const kanbanContainers = layout === 'kanban' && root
      ? [...root.querySelectorAll('.bases-kanban-container')]
      : [];
    const kanbanRoot = layout === 'kanban'
      ? (kanbanContainers.length === 1 ? kanbanContainers[0] : null)
      : root;
    const observationRoot = layout === 'kanban' ? kanbanRoot : root;
    const stableDomOrdinalByElement = new WeakMap();
    if (observationRoot) {
      [...observationRoot.querySelectorAll('*')].forEach((element, index) => stableDomOrdinalByElement.set(element, index));
    }
    const tableRoots = observationRoot ? [...observationRoot.querySelectorAll('.bases-table, [role="table"], table')] : [];
    const tableContainerRoots = observationRoot ? [...observationRoot.querySelectorAll('.bases-table-container')] : [];
    const tableShells = observationRoot ? [...observationRoot.querySelectorAll('.bases-table, .bases-table-header, [role="table"], table')] : [];
    const occludedKanbanDomCandidates = [];
    const hitTestPainted = (element, minimumCoverage = 0.5) => {
      if (!visible(element)) return false;
      let effectiveOpacity = 1;
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const style = window.getComputedStyle(ancestor);
        const opacity = Number(style.opacity);
        if (style.display === 'none' || style.visibility === 'hidden' || !Number.isFinite(opacity)) return false;
        effectiveOpacity *= opacity;
        if (effectiveOpacity <= 0.05) return false;
      }
      const clipped = clipToVisibleBounds(element, element.getBoundingClientRect());
      if (!clipped || clipped.coverage < minimumCoverage) return false;
      const points = [];
      for (const xFraction of [0.2, 0.5, 0.8]) {
        for (const yFraction of [0.2, 0.5, 0.8]) {
          points.push({
            x: clipped.left + (clipped.right - clipped.left) * xFraction,
            y: clipped.top + (clipped.bottom - clipped.top) * yFraction,
          });
        }
      }
      const paintedSamples = points.filter(({x, y}) => {
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && (hit === element || element.contains(hit)));
      });
      return paintedSamples.length >= Math.max(1, Math.ceil(points.length * 0.6));
    };
    const textOf = (element) => normalize(element?.innerText || element?.textContent || '');
    const clipToVisibleBounds = (element, bounds) => {
      const originalArea = Math.max(0, bounds.width) * Math.max(0, bounds.height);
      if (originalArea === 0) return null;
      const clipped = {
        left: Math.max(0, bounds.left),
        top: Math.max(0, bounds.top),
        right: Math.min(window.innerWidth, bounds.right),
        bottom: Math.min(window.innerHeight, bounds.bottom),
      };
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = window.getComputedStyle(ancestor);
        const ancestorBounds = ancestor.getBoundingClientRect();
        if (/(hidden|clip|scroll|auto|overlay)/.test(style.overflowX)) {
          clipped.left = Math.max(clipped.left, ancestorBounds.left);
          clipped.right = Math.min(clipped.right, ancestorBounds.right);
        }
        if (/(hidden|clip|scroll|auto|overlay)/.test(style.overflowY)) {
          clipped.top = Math.max(clipped.top, ancestorBounds.top);
          clipped.bottom = Math.min(clipped.bottom, ancestorBounds.bottom);
        }
      }
      const width = Math.max(0, clipped.right - clipped.left);
      const height = Math.max(0, clipped.bottom - clipped.top);
      const area = width * height;
      return area > 0 ? {...clipped, width, height, coverage: area / originalArea} : null;
    };
    const textNodeIsPainted = (node) => {
      let element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      let effectiveOpacity = 1;
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const style = window.getComputedStyle(ancestor);
        const opacity = Number(style.opacity);
        if (style.display === 'none' || style.visibility === 'hidden' || !Number.isFinite(opacity)) return false;
        effectiveOpacity *= opacity;
        if (effectiveOpacity <= 0.05) return false;
      }
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const alphaOf = (color) => {
        const normalized = String(color || '').replace(/\\s+/g, '').toLowerCase();
        if (normalized === 'transparent') return 0;
        const rgba = normalized.match(/^rgba\\([^/]*,([\\d.]+)(%)?\\)$/);
        if (rgba) return Number(rgba[1]) / (rgba[2] ? 100 : 1);
        const modern = normalized.match(/\\/([\\d.]+)%?\\)$/);
        if (modern) return Number(modern[1]) / (modern[0].includes('%') ? 100 : 1);
        return 1;
      };
      const fillColor = style.getPropertyValue('-webkit-text-fill-color');
      return alphaOf(style.color) > 0.05 && (!fillColor || fillColor === 'currentcolor' || alphaOf(fillColor) > 0.05);
    };
    const hitTestPaintedText = (element, hitContainer = element) => {
      if (!visible(element) || !hitTestPainted(hitContainer) || !textOf(element)) return false;
      const textRange = document.createRange();
      textRange.selectNodeContents(element);
      const rects = [...textRange.getClientRects()];
      let totalArea = 0;
      let visibleArea = 0;
      const samples = [];
      for (const bounds of rects) {
        const boundsArea = Math.max(0, bounds.width) * Math.max(0, bounds.height);
        if (boundsArea === 0) continue;
        totalArea += boundsArea;
        const clipped = clipToVisibleBounds(element, bounds);
        if (!clipped) continue;
        visibleArea += clipped.width * clipped.height;
        for (const xFraction of [0.2, 0.5, 0.8]) {
          for (const yFraction of [0.2, 0.5, 0.8]) {
            samples.push({
              x: clipped.left + clipped.width * xFraction,
              y: clipped.top + clipped.height * yFraction,
            });
          }
        }
      }
      if (totalArea === 0 || visibleArea / totalArea < 0.6 || samples.length === 0) return false;
      let paintedTextSamples = 0;
      for (const {x, y} of samples) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || (hit !== hitContainer && !hitContainer.contains(hit))) continue;
        const rangeAtPoint = document.caretRangeFromPoint?.(x, y);
        const caretAtPoint = document.caretPositionFromPoint?.(x, y);
        const node = rangeAtPoint?.startContainer ?? caretAtPoint?.offsetNode ?? null;
        if (node && (node === element || element.contains(node)) && textNodeIsPainted(node)) paintedTextSamples += 1;
      }
      return paintedTextSamples >= Math.max(1, Math.ceil(samples.length * 0.6));
    };
    const inspectPaintedCardTitleText = (element, card) => {
      const caretTextHitTestPassed = hitTestPaintedText(element, card);
      const diagnostics = {
        caret_text_hit_test_passed: caretTextHitTestPassed,
        method: 'title-range-hit-test-with-exact-card-surface-fallback',
        title_visible: Boolean(element && visible(element)),
        card_painted: Boolean(card && hitTestPainted(card)),
        title_text_painted: Boolean(element && textNodeIsPainted(element)),
        range_rect_count: 0,
        visible_range_coverage: 0,
        sample_point_count: 0,
        title_subtree_hit_samples: 0,
        painted_title_subtree_hit_samples: 0,
        card_surface_hit_samples: 0,
        caret_text_hit_samples: 0,
        card_surface_caret_text_hit_samples: 0,
        unrelated_hit_sample_count: 0,
        no_hit_sample_count: 0,
        required_painted_samples: 0,
        hit_target_samples: [],
        non_title_hit_targets: [],
        reason: '',
      };
      if (!diagnostics.title_visible) {
        diagnostics.reason = 'title-not-visible';
        return {painted: false, diagnostics};
      }
      if (!diagnostics.card_painted) {
        diagnostics.reason = 'card-not-painted';
        return {painted: false, diagnostics};
      }
      if (!textOf(element)) {
        diagnostics.reason = 'title-text-empty';
        return {painted: false, diagnostics};
      }
      if (!diagnostics.title_text_painted) {
        diagnostics.reason = 'title-text-style-not-painted';
        return {painted: false, diagnostics};
      }
      const textRange = document.createRange();
      textRange.selectNodeContents(element);
      const rects = [...textRange.getClientRects()];
      diagnostics.range_rect_count = rects.length;
      let totalArea = 0;
      let visibleArea = 0;
      const points = [];
      for (const bounds of rects) {
        const area = Math.max(0, bounds.width) * Math.max(0, bounds.height);
        if (area === 0) continue;
        totalArea += area;
        const clipped = clipToVisibleBounds(element, bounds);
        if (!clipped) continue;
        visibleArea += clipped.width * clipped.height;
        for (const xFraction of [0.2, 0.5, 0.8]) {
          for (const yFraction of [0.2, 0.5, 0.8]) {
            points.push({
              x: clipped.left + clipped.width * xFraction,
              y: clipped.top + clipped.height * yFraction,
            });
          }
        }
      }
      diagnostics.visible_range_coverage = totalArea > 0 ? visibleArea / totalArea : 0;
      diagnostics.sample_point_count = points.length;
      if (totalArea === 0) {
        diagnostics.reason = 'title-range-has-no-area';
        return {painted: false, diagnostics};
      }
      if (diagnostics.visible_range_coverage < 0.6) {
        diagnostics.reason = 'title-range-visibility-below-threshold';
        return {painted: false, diagnostics};
      }
      if (points.length === 0) {
        diagnostics.reason = 'title-range-has-no-sample-points';
        return {painted: false, diagnostics};
      }
      const nonTitleHitTargets = new Map();
      const hitTargetSamples = [];
      for (const {x, y} of points) {
        const rangeAtPoint = document.caretRangeFromPoint?.(x, y);
        const caretAtPoint = document.caretPositionFromPoint?.(x, y);
        const caretNode = rangeAtPoint?.startContainer ?? caretAtPoint?.offsetNode ?? null;
        const caretTextHit = Boolean(caretNode
          && caretNode.nodeType === Node.TEXT_NODE
          && element.contains(caretNode)
          && textNodeIsPainted(caretNode));
        if (caretTextHit) diagnostics.caret_text_hit_samples += 1;
        const hit = document.elementFromPoint(x, y);
        if (!hit) {
          diagnostics.no_hit_sample_count += 1;
          hitTargetSamples.push({x, y, category: 'no-hit', tag: null, class_name: '', caret_text_hit: caretTextHit});
          continue;
        }
        const titleSubtreeHit = Boolean(hit && (hit === element || element.contains(hit)));
        if (titleSubtreeHit) {
          diagnostics.title_subtree_hit_samples += 1;
          if (textNodeIsPainted(hit)) diagnostics.painted_title_subtree_hit_samples += 1;
          hitTargetSamples.push({
            x,
            y,
            category: 'title-subtree',
            tag: hit.tagName.toLowerCase(),
            class_name: hit.getAttribute('class') || '',
            caret_text_hit: caretTextHit,
          });
        } else if (hit === card) {
          diagnostics.card_surface_hit_samples += 1;
          if (caretTextHit) diagnostics.card_surface_caret_text_hit_samples += 1;
          hitTargetSamples.push({
            x,
            y,
            category: 'exact-card-root',
            tag: hit.tagName.toLowerCase(),
            class_name: hit.getAttribute('class') || '',
            caret_text_hit: caretTextHit,
          });
          const key = hit.tagName.toLowerCase() + '.' + String(hit.getAttribute('class') || '').trim().replace(/\\s+/g, '.');
          const previous = nonTitleHitTargets.get(key) || {tag: hit.tagName.toLowerCase(), class_name: hit.getAttribute('class') || '', count: 0};
          previous.count += 1;
          nonTitleHitTargets.set(key, previous);
        } else {
          diagnostics.unrelated_hit_sample_count += 1;
          hitTargetSamples.push({
            x,
            y,
            category: 'unrelated-target',
            tag: hit.tagName.toLowerCase(),
            class_name: hit.getAttribute('class') || '',
            caret_text_hit: caretTextHit,
          });
          const key = hit.tagName.toLowerCase() + '.' + String(hit.getAttribute('class') || '').trim().replace(/\\s+/g, '.');
          const previous = nonTitleHitTargets.get(key) || {tag: hit.tagName.toLowerCase(), class_name: hit.getAttribute('class') || '', count: 0};
          previous.count += 1;
          nonTitleHitTargets.set(key, previous);
        }
      }
      const requiredPaintedSamples = Math.max(1, Math.ceil(points.length * 0.6));
      diagnostics.required_painted_samples = requiredPaintedSamples;
      diagnostics.hit_target_samples = hitTargetSamples;
      diagnostics.non_title_hit_targets = [...nonTitleHitTargets.values()];
      const validPaintedSamples = diagnostics.painted_title_subtree_hit_samples + diagnostics.card_surface_hit_samples;
      const caretBackedTextEvidencePresent = diagnostics.caret_text_hit_samples > 0
        && (diagnostics.card_surface_hit_samples === 0 || diagnostics.card_surface_caret_text_hit_samples > 0);
      const exactCardSurfaceTitleRangeFallback = diagnostics.caret_text_hit_samples === 0
        && Boolean(card && card.matches('.bases-kanban-card'))
        && diagnostics.card_surface_hit_samples === points.length
        && diagnostics.title_subtree_hit_samples === 0
        && diagnostics.painted_title_subtree_hit_samples === 0
        && diagnostics.unrelated_hit_sample_count === 0
        && diagnostics.no_hit_sample_count === 0
        && diagnostics.range_rect_count > 0
        && diagnostics.visible_range_coverage >= 0.6
        && diagnostics.title_visible
        && diagnostics.title_text_painted
        && diagnostics.card_painted;
      diagnostics.card_surface_text_evidence_present = diagnostics.card_surface_caret_text_hit_samples > 0;
      diagnostics.exact_card_surface_title_range_fallback_passed = exactCardSurfaceTitleRangeFallback;
      diagnostics.visible_text_evidence_method = exactCardSurfaceTitleRangeFallback
        ? 'exact-card-surface-title-range'
        : caretBackedTextEvidencePresent ? 'caret-text-and-exact-hit-targets' : 'no-confirmed-title-text-hit';
      const painted = diagnostics.unrelated_hit_sample_count === 0
        && diagnostics.no_hit_sample_count === 0
        && (caretBackedTextEvidencePresent || exactCardSurfaceTitleRangeFallback)
        && validPaintedSamples >= requiredPaintedSamples;
      diagnostics.reason = painted ? '' : 'title-range-hit-test-below-threshold-or-covered-by-unrelated-target';
      return {painted, diagnostics};
    };
    let scrollActions = 0;
    const scrollEvidenceByElement = new WeakMap();
    const waitForPaintFrames = () => new Promise((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    });
    const readScrollPositions = (element) => {
      const positions = [];
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.scrollHeight > ancestor.clientHeight + 1 || ancestor.scrollWidth > ancestor.clientWidth + 1) {
          positions.push({
            class_name: ancestor.getAttribute('class') || ancestor.tagName.toLowerCase(),
            scroll_top: Math.round(ancestor.scrollTop),
            scroll_left: Math.round(ancestor.scrollLeft),
            scroll_height: ancestor.scrollHeight,
            client_height: ancestor.clientHeight,
            scroll_width: ancestor.scrollWidth,
            client_width: ancestor.clientWidth,
          });
        }
      }
      const page = document.scrollingElement;
      if (page && !positions.some((position) => position.class_name === 'document')) {
        positions.push({
          class_name: 'document',
          scroll_top: Math.round(window.scrollY),
          scroll_left: Math.round(window.scrollX),
          scroll_height: page.scrollHeight,
          client_height: page.clientHeight,
          scroll_width: page.scrollWidth,
          client_width: page.clientWidth,
        });
      }
      return positions;
    };
    const scrollIntoView = async (element) => {
      if (!element || typeof element.scrollIntoView !== 'function') return false;
      element.scrollIntoView({behavior: 'instant', block: 'center', inline: 'nearest'});
      await waitForPaintFrames();
      const bounds = element.getBoundingClientRect();
      scrollActions += 1;
      scrollEvidenceByElement.set(element, {
        visibility_sample_sequence: scrollActions,
        visibility_sample_bounds: {
          top: bounds.top,
          left: bounds.left,
          width: bounds.width,
          height: bounds.height,
        },
        scroll_positions: readScrollPositions(element),
      });
      return true;
    };
    const samplePaintedText = async (element, hitContainer = element) =>
      await scrollIntoView(element) && hitTestPaintedText(element, hitContainer);
    const samplePaintedCardTitleText = async (element, card) => {
      if (!await scrollIntoView(element)) {
        return {painted: false, diagnostics: {caret_text_hit_test_passed: false, method: 'title-subtree-hit-test', reason: 'scroll-into-view-failed'}};
      }
      return inspectPaintedCardTitleText(element, card);
    };
    const samplePaintedElement = async (element, minimumCoverage = 0.5) =>
      await scrollIntoView(element) && hitTestPainted(element, minimumCoverage);
    const exactResultCountElements = root
      ? [...root.querySelectorAll('*')].filter((element) => /^\\d+\\s+results?$/i.test(textOf(element)))
      : [];
    const leafResultCountElements = exactResultCountElements.filter((element) =>
      !exactResultCountElements.some((candidate) => candidate !== element && element.contains(candidate)));
    const nearestCommonAncestor = (left, right) => {
      const ancestors = new Set();
      for (let current = left; current; current = current.parentElement) ancestors.add(current);
      for (let current = right; current; current = current.parentElement) {
        if (ancestors.has(current)) return current;
      }
      return null;
    };
    const visibleTableRoots = tableRoots.filter((element) => visible(element) && hitTestPainted(element, 0.2));
    const visibleTableContainerCandidates = tableContainerRoots.filter((element) =>
      visible(element) && hitTestPainted(element, 0.2));
    const visibleTableContainers = visibleTableContainerCandidates.filter((container) => {
      const containedVisibleTableRoots = visibleTableRoots.filter((table) => container.contains(table));
      return containedVisibleTableRoots.length > 0
        && containedVisibleTableRoots.length === visibleTableRoots.length;
    }).filter((container, _index, candidates) =>
      !candidates.some((candidate) => candidate !== container && candidate.contains(container)));
    const visiblePreferredTableRoots = tableRoots.filter((element) =>
      element.matches('.bases-table') && visible(element) && hitTestPainted(element, 0.2));
    const visibleFallbackTableRoots = tableRoots.filter((element) => visible(element) && hitTestPainted(element, 0.2));
    const visibleRootCandidates = visiblePreferredTableRoots.length > 0 ? visiblePreferredTableRoots : visibleFallbackTableRoots;
    const topLevelVisibleRootCandidates = visibleRootCandidates.filter((element) =>
      !visibleRootCandidates.some((candidate) => candidate !== element && candidate.contains(element)));
    const visibleTableShells = visibleTableContainerCandidates.length > 0
      ? visibleTableContainers
      : topLevelVisibleRootCandidates.length > 0
        ? topLevelVisibleRootCandidates
        : tableShells.filter((element) => element.matches('.bases-table-header')
          && visible(element) && hitTestPainted(element, 0.2));
    const visibleKanbanRoots = layout === 'kanban' && kanbanRoot
      && kanbanContainers.length === 1 && visible(kanbanRoot) && hitTestPainted(kanbanRoot, 0.2)
      ? [kanbanRoot]
      : [];
    const visibleResultRoots = layout === 'table' ? visibleTableShells : visibleKanbanRoots;
    const selectedResultRoot = visibleResultRoots.length === 1 ? visibleResultRoots[0] : null;
    const sharesSelectedResultScope = (element) => {
      if (!selectedResultRoot) return false;
      if (selectedResultRoot.contains(element)) return true;
      const shared = nearestCommonAncestor(element, selectedResultRoot);
      return Boolean(shared
        && shared !== root && shared !== document.body
        && shared.contains(selectedResultRoot) && shared.contains(element)
        && visibleResultRoots.filter((candidate) => shared.contains(candidate)).length === 1);
    };
    const resultCountEvidence = leafResultCountElements.flatMap((element) => {
      const text = textOf(element);
      const bounds = element.getBoundingClientRect();
      if (!selectedResultRoot || !visible(element) || !hitTestPaintedText(element)) return [];
      const sharedContainer = nearestCommonAncestor(element, selectedResultRoot);
      const selectedRootIsContained = selectedResultRoot.contains(element);
      const meaningfulSharedContainer = Boolean(sharedContainer
        && sharedContainer !== root && sharedContainer !== document.body
        && sharedContainer.contains(selectedResultRoot) && sharedContainer.contains(element)
        && visibleResultRoots.filter((candidate) => sharedContainer.contains(candidate)).length === 1);
      if (!selectedRootIsContained && !meaningfulSharedContainer) return [];
      const selectedRootEvidence = {
        tag: selectedResultRoot.tagName.toLowerCase(),
        class_name: selectedResultRoot.getAttribute('class') || '',
        contained_visible_table_count: layout === 'table'
          ? visibleTableRoots.filter((table) => selectedResultRoot.contains(table)).length
          : null,
        bounds: (() => {
          const selectedBounds = selectedResultRoot.getBoundingClientRect();
          return {top: selectedBounds.top, left: selectedBounds.left, width: selectedBounds.width, height: selectedBounds.height};
        })(),
      };
      const nearestTableShell = layout === 'table'
        ? selectedResultRoot.matches('.bases-table-container')
          ? visibleTableRoots.length === 1 ? visibleTableRoots[0] : null
          : selectedResultRoot
        : null;
      return [{
        text,
        tag: element.tagName.toLowerCase(),
        class_name: element.getAttribute('class') || '',
        bounds: {top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height},
        scope: layout === 'table'
          ? selectedResultRoot.matches('.bases-table-container') ? 'selected-table-container' : 'selected-table-shell'
          : 'active-kanban-container',
        selected_result_root: selectedRootEvidence,
        nearest_table_shell: nearestTableShell
          ? {tag: nearestTableShell.tagName.toLowerCase(), class_name: nearestTableShell.getAttribute('class') || ''}
          : null,
        shared_container: sharedContainer ? {
          tag: sharedContainer.tagName.toLowerCase(),
          class_name: sharedContainer.getAttribute('class') || '',
        } : null,
      }];
    });
    const resultCountTexts = resultCountEvidence.map((entry) => entry.text).sort();
    const resultCountMatch = resultCountEvidence.length === 1 ? resultCountEvidence[0].text.match(/^(\\d+)\\s+results?$/i) : null;
    const resultCount = resultCountMatch ? Number(resultCountMatch[1]) : null;
    let zeroResultOutcomeClassification = null;
    if (resultCount === 0) {
      if (scenarioId === 'json-empty-group-order-list' || scenarioId === 'yaml-empty-group-order-list') {
        zeroResultOutcomeClassification = 'empty-group-order-list';
      } else if (scenarioId === 'yaml-binary-tag-value-candidate') {
        zeroResultOutcomeClassification = 'yaml-binary-candidate-observation';
      }
    }
    const rawKanbanColumns = layout === 'kanban' && kanbanRoot
      ? [...kanbanRoot.querySelectorAll('.bases-kanban-column')]
      : [];
    const paintedKanbanColumns = [];
    for (const column of rawKanbanColumns) {
      const header = column.querySelector('.bases-kanban-column-header');
      const cards = [...column.querySelectorAll('.bases-kanban-card')];
      const paintedHeader = Boolean(header && await samplePaintedText(header));
      let paintedCard = false;
      for (const card of cards) {
        if (await samplePaintedElement(card)) {
          paintedCard = true;
          break;
        }
      }
      if (paintedHeader || paintedCard || await samplePaintedElement(column, 0.2)) paintedKanbanColumns.push(column);
    }
    const fixturePathMatches = (candidate) => {
      if (!candidate) return [];
      const candidateText = String(candidate).trim();
      if (candidateText.startsWith('/') || candidateText.startsWith('\\\\')) return [];
      const rawParts = candidateText.split('\\\\').join('/').split('/');
      if (rawParts.some((part) => part === '..' || part.includes(':'))) return [];
      const normalized = rawParts.filter((part) => part && part !== '.').join('/');
      if (!normalized) return [];
      const normalizedLower = normalized.toLowerCase();
      const exactMatches = fixturePaths.filter((path) => path.toLowerCase() === normalizedLower);
      if (exactMatches.length > 0) return exactMatches;
      if (normalized.includes('/')) return [];
      const basename = normalizedLower;
      return fixturePaths.filter((path) => {
        const pathParts = path.split('/');
        const filename = (pathParts[pathParts.length - 1] || path).toLowerCase();
        const stem = filename.replace(/\\.(?:md|base)$/i, '');
        return filename === basename || stem === basename;
      });
    };
    const pathFor = (candidate) => {
      const matches = fixturePathMatches(candidate);
      return matches.length === 1 ? matches[0] : null;
    };
    const pathCandidateFor = (element) =>
      element.getAttribute('data-href') || element.getAttribute('data-path') || textOf(element);
    const pathIdentity = (candidate, path = pathFor(candidate)) =>
      path ? 'path:' + path : 'unmapped:' + normalize(candidate).toLowerCase();
    const kanbanCardIdentity = (candidate, card, path = pathFor(candidate)) =>
      pathIdentity(candidate, path) + '|column:' + rawKanbanColumns.indexOf(card.closest('.bases-kanban-column'));
    const nodeIdentityChanges = [];
    const recordIdentityChange = (kind, before, after, element) => {
      nodeIdentityChanges.push({
        kind,
        before,
        after,
        class_name: element?.getAttribute('class') || '',
      });
    };
    const linkSelector = 'a[data-href], [data-href], a[data-path], [data-path], a.internal-link, .internal-link';
    const rawLinks = observationRoot
      ? [...observationRoot.querySelectorAll(linkSelector)]
      : [];
    const rawCandidates = rawLinks.map((element) => {
      const candidate = pathCandidateFor(element);
      return {element, candidate, path: pathFor(candidate)};
    });
    const candidateKey = (entry) => entry.path ?? entry.candidate.trim().toLowerCase();
    const retainedCandidates = rawCandidates.filter((entry) => !rawCandidates.some((nested) => nested !== entry
      && entry.element.contains(nested.element)
      && candidateKey(nested) === candidateKey(entry)));
    const paintedPathCandidateElements = new WeakSet();
    const pathScrollEvidenceByElement = new WeakMap();
    for (const entry of retainedCandidates) {
      const {element} = entry;
      const painted = textOf(element)
        ? await samplePaintedText(element)
        : await samplePaintedElement(element);
      const candidateAfterScroll = pathCandidateFor(element);
      const identityBefore = pathIdentity(entry.candidate, entry.path);
      const identityAfter = pathIdentity(candidateAfterScroll);
      if (identityBefore !== identityAfter) {
        recordIdentityChange('path', identityBefore, identityAfter, element);
        continue;
      }
      if (painted) {
        paintedPathCandidateElements.add(element);
        pathScrollEvidenceByElement.set(element, scrollEvidenceByElement.get(element));
      }
    }
    const linkScope = (element) => {
      const owner = element.closest('.bases-tr, .bases-row, .bases-table-row, .bases-card, .bases-kanban-card, tr, [role="row"], li, [role="listitem"]');
      const tableRoot = element.closest('.bases-table, [role="table"], table');
      return tableRoot ? 'table' : layout === 'kanban' ? 'kanban' : owner ? 'explicit-row' : 'unscoped';
    };
    const linkedPathLinks = retainedCandidates
      .filter((entry) => entry.path && paintedPathCandidateElements.has(entry.element))
      .map(({element, path}, index) => {
        const bounds = element.getBoundingClientRect();
        const visibilitySample = pathScrollEvidenceByElement.get(element);
        const owner = element.closest('.bases-tr, .bases-row, .bases-table-row, .bases-card, .bases-kanban-card, tr, [role="row"], li, [role="listitem"]');
        const tableRoot = element.closest('.bases-table, [role="table"], table');
        const ownerClass = owner?.getAttribute('class') || '';
        return {
          element,
          path,
          text: textOf(element),
          class_name: element.getAttribute('class') || '',
          source_scope: tableRoot ? 'table' : layout === 'kanban' ? 'kanban' : owner ? 'explicit-row' : 'unscoped',
          row_class_name: ownerClass,
          top: visibilitySample?.visibility_sample_bounds.top ?? bounds.top,
          left: visibilitySample?.visibility_sample_bounds.left ?? bounds.left,
          ...visibilitySample,
          index,
        };
      });
    const unmappedVisiblePathCandidates = retainedCandidates
      .filter((entry) => !entry.path && paintedPathCandidateElements.has(entry.element))
      .map(({element, candidate}) => {
        const bounds = element.getBoundingClientRect();
        return {
          candidate,
          text: textOf(element),
          class_name: element.getAttribute('class') || '',
          source_scope: linkScope(element),
          fixture_path_matches: fixturePathMatches(candidate),
          top: pathScrollEvidenceByElement.get(element)?.visibility_sample_bounds.top ?? bounds.top,
          left: pathScrollEvidenceByElement.get(element)?.visibility_sample_bounds.left ?? bounds.left,
          ...pathScrollEvidenceByElement.get(element),
        };
      });
    const hasGroupMarker = (element) => {
      if (layout === 'kanban') {
        return element.matches('.bases-group-heading')
          && Boolean(element.closest('.bases-kanban-column-header'))
          && Boolean(element.closest('.bases-kanban-column'));
      }
      return element.matches('.bases-group-heading');
    };
    const isStructurallyRenderableMarker = (element) => {
      let effectiveOpacity = 1;
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const style = window.getComputedStyle(ancestor);
        const opacity = Number(style.opacity);
        if (style.display === 'none'
          || style.visibility === 'hidden'
          || style.visibility === 'collapse'
          || style.contentVisibility === 'hidden'
          || !Number.isFinite(opacity)) return false;
        effectiveOpacity *= opacity;
        if (effectiveOpacity <= 0.05) return false;
      }
      return true;
    };
    const rawMarkerElements = kanbanRoot
      ? [...kanbanRoot.querySelectorAll('[class], [data-group], [role="group"]')]
        .filter((element) => hasGroupMarker(element) && isStructurallyRenderableMarker(element))
      : [];
    const markerElements = [];
    for (const element of rawMarkerElements) {
      const identityBefore = normalize(element.getAttribute('data-group') || element.getAttribute('aria-label') || textOf(element));
      const painted = await samplePaintedText(element);
      const identityAfter = normalize(element.getAttribute('data-group') || element.getAttribute('aria-label') || textOf(element));
      if (identityBefore !== identityAfter) recordIdentityChange('group-heading', identityBefore, identityAfter, element);
      if (painted && identityBefore === identityAfter) {
        markerElements.push(element);
        continue;
      }
      if (layout === 'kanban') {
        const bounds = element.getBoundingClientRect();
        occludedKanbanDomCandidates.push({kind: 'group-heading', text: textOf(element), class_name: element.getAttribute('class') || '', top: bounds.top, left: bounds.left});
      }
    }
    const leafMarkers = layout === 'kanban'
      ? markerElements
      : markerElements.filter((element) => !markerElements.some((nested) => nested !== element && element.contains(nested)));
    const headingMarkers = leafMarkers.map((element, index) => {
      const bounds = element.getBoundingClientRect();
      const visibilitySample = scrollEvidenceByElement.get(element);
      const label = normalize(element.getAttribute('data-group') || element.getAttribute('aria-label') || textOf(element));
      const rowOwner = element.closest('.bases-tr, .bases-row, .bases-table-row, tr, [role="row"], li, [role="listitem"]');
      return {
        element,
        column: layout === 'kanban' ? element.closest('.bases-kanban-column') : null,
        index,
        label,
        class_name: element.getAttribute('class') || '',
        top: visibilitySample?.visibility_sample_bounds.top ?? bounds.top,
        left: visibilitySample?.visibility_sample_bounds.left ?? bounds.left,
        visibility_sample_sequence: visibilitySample?.visibility_sample_sequence ?? 0,
        visibility_sample_bounds: visibilitySample?.visibility_sample_bounds ?? {
          top: bounds.top,
          left: bounds.left,
          width: bounds.width,
          height: bounds.height,
        },
        scroll_positions: visibilitySample?.scroll_positions ?? [],
        row_owner: rowOwner,
      };
    }).sort((left, right) => {
      if (layout === 'kanban') {
        const leftColumnIndex = rawKanbanColumns.indexOf(left.element.closest('.bases-kanban-column'));
        const rightColumnIndex = rawKanbanColumns.indexOf(right.element.closest('.bases-kanban-column'));
        if (leftColumnIndex !== rightColumnIndex) return leftColumnIndex - rightColumnIndex;
      }
      const leftOrdinal = stableDomOrdinalByElement.get(left.element);
      const rightOrdinal = stableDomOrdinalByElement.get(right.element);
      if (leftOrdinal !== undefined && rightOrdinal !== undefined && leftOrdinal !== rightOrdinal) {
        return leftOrdinal - rightOrdinal;
      }
      const position = left.element.compareDocumentPosition(right.element);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return left.index - right.index;
    });
    const kanbanCardPathLinks = [];
    if (layout === 'kanban' && kanbanRoot) {
      const cards = [...kanbanRoot.querySelectorAll('.bases-kanban-card')]
        .filter((card) => paintedKanbanColumns.includes(card.closest('.bases-kanban-column')));
      for (const card of cards) {
        const initialTitleCandidates = [...card.querySelectorAll('.bases-kanban-card-property.mod-title')];
        const initialTitle = initialTitleCandidates.length === 1 ? textOf(initialTitleCandidates[0]) : '';
        const identityBefore = kanbanCardIdentity(initialTitle, card);
        await scrollIntoView(card);
        const titleCandidatesAfterScroll = [...card.querySelectorAll('.bases-kanban-card-property.mod-title')];
        const titleAfterScroll = titleCandidatesAfterScroll.length === 1 ? textOf(titleCandidatesAfterScroll[0]) : '';
        const identityAfterScroll = kanbanCardIdentity(titleAfterScroll, card);
        if (identityBefore !== identityAfterScroll) {
          recordIdentityChange('kanban-card', identityBefore, identityAfterScroll, card);
          continue;
        }
        const bounds = card.getBoundingClientRect();
        const visibilitySample = scrollEvidenceByElement.get(card);
        if (!hitTestPainted(card)) {
          occludedKanbanDomCandidates.push({kind: 'card', text: textOf(card), class_name: card.getAttribute('class') || '', top: bounds.top, left: bounds.left});
          continue;
        }
        const titleCandidates = [...card.querySelectorAll('.bases-kanban-card-property.mod-title')].filter(visible);
        const titleNodes = [];
        const titleDiagnostics = [];
        for (const titleNode of titleCandidates) {
          const titleCheck = await samplePaintedCardTitleText(titleNode, card);
          titleDiagnostics.push(titleCheck.diagnostics);
          if (titleCheck.painted) titleNodes.push(titleNode);
        }
        if (titleCandidates.length !== 1 || titleNodes.length !== 1) {
          occludedKanbanDomCandidates.push({
            kind: 'card',
            text: textOf(card),
            class_name: card.getAttribute('class') || '',
            top: bounds.top,
            left: bounds.left,
            title_diagnostics: {
              visible_title_candidate_count: titleCandidates.length,
              painted_title_candidate_count: titleNodes.length,
              ...(titleCandidates.length === 1 ? {} : {
                caret_text_hit_test_passed: false,
                reason: 'visible-title-candidate-count-not-one',
              }),
              samples: titleDiagnostics,
            },
          });
          continue;
        }
        const title = textOf(titleNodes[0]);
        const path = pathFor(title);
        const identityAfter = kanbanCardIdentity(title, card, path);
        if (identityBefore !== identityAfter) {
          recordIdentityChange('kanban-card', identityBefore, identityAfter, card);
          continue;
        }
        if (!path) continue;
        const column = card.closest('.bases-kanban-column');
        kanbanCardPathLinks.push({
          element: card,
          column,
          path,
          text: title,
          class_name: card.getAttribute('class') || '',
          source_scope: 'kanban',
          row_class_name: card.getAttribute('class') || '',
          title_hit_diagnostics: titleDiagnostics[0],
          top: visibilitySample?.visibility_sample_bounds.top ?? bounds.top,
          left: visibilitySample?.visibility_sample_bounds.left ?? bounds.left,
          ...visibilitySample,
          index: linkedPathLinks.length + kanbanCardPathLinks.length,
        });
      }
    }
    let pathLinks = layout === 'kanban' ? kanbanCardPathLinks : linkedPathLinks;
    let groupRecords = headingMarkers.map((marker, index) => ({
      index,
      heading_text: marker.label,
      heading_class_name: marker.class_name,
      heading_bounds: {top: marker.top, left: marker.left},
      heading_visibility_sample: {
        visibility_sample_sequence: marker.visibility_sample_sequence,
        visibility_sample_bounds: marker.visibility_sample_bounds,
        scroll_positions: marker.scroll_positions,
      },
      member_paths: [],
      marker,
    }));
    const rowCandidates = observationRoot
      ? [...observationRoot.querySelectorAll('.bases-tr, .bases-row, .bases-table-row, .bases-card, .bases-kanban-card, tr, [role="row"]')]
      : [];
    const visibleRowElements = [];
    for (const row of rowCandidates) {
      if (await samplePaintedText(row)) visibleRowElements.push(row);
    }
    const rowIsHeader = (row) => row.matches('thead tr, .bases-table-header, [role="columnheader"]')
      || Boolean(row.querySelector('.bases-table-header, th, [role="columnheader"]'));
    const rowIsGroupHeading = (row) => hasGroupMarker(row)
      || markerElements.some((marker) => row.contains(marker));
    const rowHasPathCandidate = (row) => retainedCandidates.some((candidate) =>
      row === candidate.element || row.contains(candidate.element))
      || pathLinks.some((candidate) => row === candidate.element || row.contains(candidate.element));
    const rowTextPathByElement = new Map();
    const rowTextPathCounts = new Map();
    if (layout === 'table' && selectedResultRoot) {
      for (const row of visibleRowElements) {
        if (rowIsHeader(row) || rowIsGroupHeading(row) || !selectedResultRoot.contains(row)) continue;
        const matches = fixturePathMatches(textOf(row));
        if (matches.length !== 1) continue;
        rowTextPathByElement.set(row, matches[0]);
        rowTextPathCounts.set(matches[0], (rowTextPathCounts.get(matches[0]) || 0) + 1);
      }
    }
    const mappedPathlessRows = new Set();
    const mappedVisibleRowPathCandidates = [...rowTextPathByElement]
      .filter(([row, path]) => {
        const scopedPathLinks = pathLinks.filter((candidate) =>
          candidate.path === path
          && (candidate.element === selectedResultRoot || selectedResultRoot?.contains(candidate.element)));
        const uniquelyMappedPathlessRow = !rowHasPathCandidate(row)
          && rowTextPathCounts.get(path) === 1
          && scopedPathLinks.length === 1;
        if (uniquelyMappedPathlessRow) mappedPathlessRows.add(row);
        return uniquelyMappedPathlessRow;
      })
      .map(([row, path]) => {
        const bounds = row.getBoundingClientRect();
        const visibilitySample = scrollEvidenceByElement.get(row);
        return {
          path,
          text: textOf(row),
          class_name: row.getAttribute('class') || '',
          tag: row.tagName.toLowerCase(),
          top: visibilitySample?.visibility_sample_bounds.top ?? bounds.top,
          left: visibilitySample?.visibility_sample_bounds.left ?? bounds.left,
        };
      });
    const preSweepUnmappedVisibleRowCandidates = visibleRowElements
      .filter((row) => {
        return !rowIsHeader(row) && !rowIsGroupHeading(row) && !rowHasPathCandidate(row)
          && !mappedPathlessRows.has(row) && Boolean(textOf(row));
      })
      .map((row) => {
        const bounds = row.getBoundingClientRect();
        const visibilitySample = scrollEvidenceByElement.get(row);
        const rowText = textOf(row);
        return {
          text: rowText.slice(0, 500),
          fixture_path_matches: fixturePathMatches(rowText),
          class_name: row.getAttribute('class') || '',
          tag: row.tagName.toLowerCase(),
          top: visibilitySample?.visibility_sample_bounds.top ?? bounds.top,
          left: visibilitySample?.visibility_sample_bounds.left ?? bounds.left,
          visibility_sample_sequence: visibilitySample?.visibility_sample_sequence ?? 0,
          visibility_sample_bounds: visibilitySample?.visibility_sample_bounds ?? {
            top: bounds.top,
            left: bounds.left,
            width: bounds.width,
            height: bounds.height,
          },
          scroll_positions: visibilitySample?.scroll_positions ?? [],
        };
      });
    const freshSweepOffsets = [];
    const freshSweepPaths = new Set();
    const freshSweepHeadingKeys = new Set();
    const freshSweepNodeIdentities = new WeakMap();
    const freshSweepResultRecords = new Map();
    const freshSweepHeadingRecords = new Map();
    const freshSweepPathGroupKeys = new Map();
    const freshSweepPathOrderEdges = new Map();
    const freshSweepHeadingOrderEdges = new Map();
    const freshSweepHeadingMultiplicityByBase = new Map();
    const freshSweepHeadingElementsByBase = new Map();
    const freshSweepHeadingLogicalPositionByElement = new WeakMap();
    // These IDs are scoped to this one page evaluation. They prove only that the exact DOM
    // objects persisted across samples in this sweep; they are not stable IDs across scans.
    const freshSweepScanLocalDomObjectIds = new WeakMap();
    let freshSweepNextScanLocalDomObjectId = 0;
    const scanLocalDomObjectId = (element) => {
      if (!element) return null;
      let objectId = freshSweepScanLocalDomObjectIds.get(element);
      if (objectId === undefined) {
        objectId = ++freshSweepNextScanLocalDomObjectId;
        freshSweepScanLocalDomObjectIds.set(element, objectId);
      }
      return objectId;
    };
    const freshSweepHeadingCollisionBases = new Set();
    const freshSweepHeadingIdentityCollisionEvidence = [];
    const freshSweepTableSections = new Map();
    const freshSweepTableSectionOrders = new Map();
    const freshSweepTableSectionSnapshotOrders = new Map();
    const freshSweepTableSectionAcceptedReconciliationEvidence = [];
    let freshSweepTableSectionAcceptedReconciliationEvidenceTruncated = false;
    const freshSweepTableSectionReconciliationEvidence = [];
    const freshSweepPathTableSectionKeys = new Map();
    let freshSweepTableSectionReconciliationAmbiguous = false;
    let freshSweepUnresolvedGroupOwnerPaths = [];
    let freshSweepUnpaintedTableSectionKeys = [];
    const freshSweepUnmappedCandidates = [];
    const freshSweepUnmappedRows = [];
    const freshSweepPaintedKanbanColumnOrdinals = new Set();
    let freshSweepPositions = 0;
    let freshSweepPathSamples = 0;
    let freshSweepHeadingSamples = 0;
    let freshSweepUnmappedPathSamples = 0;
    let freshSweepUnmappedRowSamples = 0;
    let freshSweepDuplicatePathSamples = 0;
    let freshSweepUnownedResultSamples = 0;
    const freshSweepUnownedResultObservations = [];
    let freshSweepCoverageComplete = true;
    let freshSweepOrderingAmbiguous = false;
    let freshSweepGroupOwnershipAmbiguous = false;
    let freshSweepHeadingIdentityAmbiguous = false;
    const maximumFreshSweepPositions = 128;
    const headingBaseIdentity = (element) => {
      const dataGroup = normalize(element.getAttribute('data-group'));
      const ariaLabel = normalize(element.getAttribute('aria-label'));
      const label = normalize(textOf(element));
      const identity = dataGroup ? 'data-group:' + dataGroup : ariaLabel ? 'aria-label:' + ariaLabel : 'rendered:' + label;
      if (layout !== 'kanban') return identity;
      const column = element.closest('.bases-kanban-column');
      return rawKanbanColumns.indexOf(column) + ':' + identity;
    };
    const headingIdentity = (baseIdentity, occurrence, occurrenceCount) =>
      occurrenceCount > 1 ? baseIdentity + '|occurrence:' + occurrence : baseIdentity;
    const headingIdentityEntries = (elements) => {
      const occurrenceCounts = new Map();
      const entries = elements.map((element) => {
        const baseIdentity = headingBaseIdentity(element);
        const occurrence = occurrenceCounts.get(baseIdentity) ?? 0;
        occurrenceCounts.set(baseIdentity, occurrence + 1);
        return {element, base_identity: baseIdentity, occurrence};
      });
      return entries.map((entry) => ({
        ...entry,
        occurrence_count: occurrenceCounts.get(entry.base_identity) ?? 1,
        key: headingIdentity(entry.base_identity, entry.occurrence, occurrenceCounts.get(entry.base_identity) ?? 1),
      }));
    };
    const scopedHeadingIdentityElements = (elements) => {
      const scoped = layout === 'kanban'
        ? elements
        : elements.filter((element) => selectedResultRoot?.contains(element));
      return layout === 'kanban'
        ? scoped
        : scoped.filter((element) => !scoped.some((nested) => nested !== element && element.contains(nested)));
    };
    const structuralDomElementRoute = (element, boundary = null) => {
      if (!element) return {route_complete: true, segments: [], tag_name: 'document'};
      const segments = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && segments.length < 24) {
        const classNames = [...current.classList].sort();
        const structuralAttributes = [...current.attributes]
          .filter((attribute) => attribute.name === 'id'
            || attribute.name === 'role'
            || attribute.name.startsWith('data-'))
          .map((attribute) => [attribute.name, attribute.value])
          .sort((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));
        const sameTagSiblings = current.parentElement
          ? [...current.parentElement.children].filter((sibling) => sibling.tagName === current.tagName)
          : [];
        segments.push({
          tag_name: current.tagName.toLowerCase(),
          class_names: classNames,
          structural_attributes: structuralAttributes,
          same_tag_sibling_ordinal: sameTagSiblings.indexOf(current),
        });
        if (current === boundary) break;
        current = current.parentElement;
      }
      return {
        route_complete: current === null || current === boundary,
        segments: segments.reverse(),
        tag_name: element.tagName.toLowerCase(),
      };
    };
    const recordHeadingIdentityEntries = (entries, sample) => {
      const counts = new Map();
      const priorElementsByBase = new Map([...freshSweepHeadingElementsByBase]
        .map(([baseIdentity, elements]) => [baseIdentity, new Set(elements.keys())]));
      for (const entry of entries) counts.set(entry.base_identity, entry.occurrence_count);
      for (const [baseIdentity, count] of counts) {
        const priorCount = freshSweepHeadingMultiplicityByBase.get(baseIdentity);
        if (priorCount !== undefined && priorCount !== count) {
          freshSweepHeadingIdentityAmbiguous = true;
          freshSweepHeadingIdentityCollisionEvidence.push({
            base_identity: baseIdentity,
            prior_occurrence_count: priorCount,
            occurrence_count: count,
            reason: 'heading-identity-occurrence-count-changed-between-samples',
            sample,
          });
        }
        if (priorCount === undefined) freshSweepHeadingMultiplicityByBase.set(baseIdentity, count);
        if (count > 1) {
          freshSweepHeadingCollisionBases.add(baseIdentity);
          if (!freshSweepHeadingIdentityCollisionEvidence.some((item) => item.base_identity === baseIdentity
            && item.occurrence_count === count && Array.isArray(item.occurrence_keys))) {
            freshSweepHeadingIdentityCollisionEvidence.push({
              base_identity: baseIdentity,
              occurrence_count: count,
              occurrence_keys: entries.filter((entry) => entry.base_identity === baseIdentity).map((entry) => entry.key),
              sample,
            });
          }
        }
      }
      for (const entry of entries) {
        if (!freshSweepHeadingElementsByBase.has(entry.base_identity)) {
          freshSweepHeadingElementsByBase.set(entry.base_identity, new Map());
        }
        const observedElements = freshSweepHeadingElementsByBase.get(entry.base_identity);
        const priorElements = priorElementsByBase.get(entry.base_identity);
        if (priorElements?.size && !priorElements.has(entry.element)) {
          // A previously observed identity appearing on a new node may be a recycled heading
          // for another equal-looking value. Occurrence ordinals separate simultaneous labels,
          // but cannot prove continuity across disjoint DOM snapshots.
          freshSweepHeadingIdentityAmbiguous = true;
          freshSweepHeadingIdentityCollisionEvidence.push({
            base_identity: entry.base_identity,
            occurrence_key: entry.key,
            occurrence_count: entry.occurrence_count,
            reason: 'previously-seen-heading-identity-reappeared-on-a-new-node',
            sample,
          });
        }
        observedElements.set(entry.element, entry.key);
        // Non-empty table-section observations are reconciled through shared member paths.
        // Exact scan-local heading/root object IDs may bridge a pathless sample at the same
        // supported location; they are never durable section identity. Kanban continues to use
        // its separate column identity.
        if (layout === 'kanban') observeFreshNodeIdentity(entry.element, 'heading:' + entry.key, 'group-heading');
        const verticalScrollAncestors = [];
        const horizontalScrollAncestors = [];
        const coordinateModelIssues = [];
        const inspectCoordinateStyle = (element, style) => {
          if (style.position === 'sticky' || style.position === 'fixed') {
            coordinateModelIssues.push({
              kind: 'sticky-or-fixed-position',
              tag_name: element.tagName.toLowerCase(),
              class_name: element.getAttribute('class') || '',
              position: style.position,
            });
          }
          if (style.zoom && style.zoom !== 'normal' && style.zoom !== '1') {
            coordinateModelIssues.push({
              kind: 'zoomed-coordinate-ancestor',
              tag_name: element.tagName.toLowerCase(),
              class_name: element.getAttribute('class') || '',
              zoom: style.zoom,
            });
          }
          const transformedProperties = ['transform', 'perspective', 'translate', 'rotate', 'scale']
            .filter((property) => style[property] && style[property] !== 'none');
          if (transformedProperties.length > 0) {
            coordinateModelIssues.push({
              kind: 'transformed-coordinate-ancestor',
              tag_name: element.tagName.toLowerCase(),
              class_name: element.getAttribute('class') || '',
              properties: transformedProperties,
            });
          }
        };
        inspectCoordinateStyle(entry.element, window.getComputedStyle(entry.element));
        for (let ancestor = entry.element.parentElement; ancestor; ancestor = ancestor.parentElement) {
          const style = window.getComputedStyle(ancestor);
          inspectCoordinateStyle(ancestor, style);
          if (ancestor === document.documentElement || ancestor === document.body) continue;
          if (ancestor.scrollHeight > ancestor.clientHeight + 1
            && /(auto|scroll|overlay|hidden)/.test(style.overflowY)) verticalScrollAncestors.push(ancestor);
          if (ancestor.scrollWidth > ancestor.clientWidth + 1
            && /(auto|scroll|overlay|hidden)/.test(style.overflowX)) horizontalScrollAncestors.push(ancestor);
        }
        const bounds = entry.element.getBoundingClientRect();
        const sectionRoot = entry.element.closest('.bases-table') || selectedResultRoot;
        const windowScrollTop = window.scrollY;
        const windowScrollLeft = window.scrollX;
        const verticalScrollOffsets = verticalScrollAncestors.map((ancestor) => ancestor.scrollTop);
        const horizontalScrollOffsets = horizontalScrollAncestors.map((ancestor) => ancestor.scrollLeft);
        const logicalPosition = {
          window_scroll_top: Math.round(windowScrollTop),
          vertical_scroll_ancestor_routes: verticalScrollAncestors.map((ancestor) => structuralDomElementRoute(ancestor)),
          vertical_scroll_ancestor_offsets: verticalScrollOffsets.map((offset) => Math.round(offset)),
          top: Math.round(bounds.top + windowScrollTop + verticalScrollOffsets.reduce((sum, offset) => sum + offset, 0)),
          window_scroll_left: Math.round(windowScrollLeft),
          horizontal_scroll_ancestor_routes: horizontalScrollAncestors.map((ancestor) => structuralDomElementRoute(ancestor)),
          horizontal_scroll_ancestor_offsets: horizontalScrollOffsets.map((offset) => Math.round(offset)),
          left: Math.round(bounds.left + windowScrollLeft + horizontalScrollOffsets.reduce((sum, offset) => sum + offset, 0)),
          coordinate_model_supported: coordinateModelIssues.length === 0,
          coordinate_model_issues: coordinateModelIssues.slice(0, 16),
          section_root_route: structuralDomElementRoute(sectionRoot),
          scan_local_heading_object_id: scanLocalDomObjectId(entry.element),
          scan_local_section_root_object_id: scanLocalDomObjectId(sectionRoot),
        };
        const priorLogicalPosition = freshSweepHeadingLogicalPositionByElement.get(entry.element);
        if (priorLogicalPosition
          && (JSON.stringify(priorLogicalPosition.vertical_scroll_ancestor_routes) !== JSON.stringify(logicalPosition.vertical_scroll_ancestor_routes)
            || JSON.stringify(priorLogicalPosition.horizontal_scroll_ancestor_routes) !== JSON.stringify(logicalPosition.horizontal_scroll_ancestor_routes)
            || priorLogicalPosition.coordinate_model_supported !== logicalPosition.coordinate_model_supported
            || JSON.stringify(priorLogicalPosition.coordinate_model_issues) !== JSON.stringify(logicalPosition.coordinate_model_issues)
            || JSON.stringify(priorLogicalPosition.section_root_route) !== JSON.stringify(logicalPosition.section_root_route)
            || priorLogicalPosition.scan_local_section_root_object_id !== logicalPosition.scan_local_section_root_object_id
            || Math.abs(priorLogicalPosition.top - logicalPosition.top) > 4
            || Math.abs(priorLogicalPosition.left - logicalPosition.left) > 4)) {
          // A virtualized renderer can recycle the same DOM node for an equal-looking heading;
          // a changed logical row position reveals that the label alone cannot prove continuity.
          freshSweepHeadingIdentityAmbiguous = true;
          freshSweepHeadingIdentityCollisionEvidence.push({
            base_identity: entry.base_identity,
            occurrence_key: entry.key,
            occurrence_count: entry.occurrence_count,
            reason: 'heading-node-logical-position-changed-between-samples',
            prior_logical_position: priorLogicalPosition,
            logical_position: logicalPosition,
            sample,
          });
        }
        freshSweepHeadingLogicalPositionByElement.set(entry.element, logicalPosition);
      }
    };
    const observeFreshNodeIdentity = (element, identity, kind) => {
      const previousIdentity = freshSweepNodeIdentities.get(element);
      if (previousIdentity !== undefined && previousIdentity !== identity) {
        recordIdentityChange(kind, previousIdentity, identity, element);
        freshSweepNodeIdentities.set(element, identity);
      } else if (previousIdentity === undefined) {
        freshSweepNodeIdentities.set(element, identity);
      }
    };
    const compareDomOrder = (left, right) => {
      if (left === right) return 0;
      const position = left.compareDocumentPosition(right);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    };
    const sameTableSectionAnchor = (left, right) => {
      const leftPosition = left?.logical_position;
      const rightPosition = right?.logical_position;
      const completeRouteList = (routes) => Array.isArray(routes)
        && routes.every((route) => route?.route_complete === true);
      return Boolean(leftPosition && rightPosition
        && Number.isFinite(leftPosition.top) && Number.isFinite(leftPosition.left)
        && Number.isFinite(rightPosition.top) && Number.isFinite(rightPosition.left)
        && leftPosition.coordinate_model_supported === true
        && rightPosition.coordinate_model_supported === true
        && completeRouteList(leftPosition.vertical_scroll_ancestor_routes)
        && completeRouteList(leftPosition.horizontal_scroll_ancestor_routes)
        && leftPosition.section_root_route?.route_complete === true
        && completeRouteList(rightPosition.vertical_scroll_ancestor_routes)
        && completeRouteList(rightPosition.horizontal_scroll_ancestor_routes)
        && rightPosition.section_root_route?.route_complete === true
        && JSON.stringify(leftPosition.vertical_scroll_ancestor_routes) === JSON.stringify(rightPosition.vertical_scroll_ancestor_routes)
        && JSON.stringify(leftPosition.horizontal_scroll_ancestor_routes) === JSON.stringify(rightPosition.horizontal_scroll_ancestor_routes)
        && JSON.stringify(leftPosition.section_root_route) === JSON.stringify(rightPosition.section_root_route));
    };
    const sameTableSectionLogicalPosition = (left, right) => {
      const leftPosition = left?.logical_position;
      const rightPosition = right?.logical_position;
      return Boolean(leftPosition && rightPosition
        && Number.isFinite(leftPosition.top) && Number.isFinite(leftPosition.left)
        && Number.isFinite(rightPosition.top) && Number.isFinite(rightPosition.left)
        && sameTableSectionAnchor(left, right)
        && Math.abs(leftPosition.top - rightPosition.top) <= 4
        && Math.abs(leftPosition.left - rightPosition.left) <= 4);
    };
    const addOrderEdges = (edgeMap, values) => {
      const ordered = [...new Set(values)];
      for (const value of ordered) if (!edgeMap.has(value)) edgeMap.set(value, new Set());
      for (let index = 0; index + 1 < ordered.length; index += 1) {
        if (ordered[index] !== ordered[index + 1]) edgeMap.get(ordered[index]).add(ordered[index + 1]);
      }
    };
    const topologicalOrder = (values, edgeMap) => {
      const nodes = [...new Set(values)];
      const incoming = new Map(nodes.map((node) => [node, 0]));
      for (const node of nodes) {
        for (const next of edgeMap.get(node) ?? []) {
          if (incoming.has(next)) incoming.set(next, incoming.get(next) + 1);
        }
      }
      const remaining = new Set(nodes);
      const ordered = [];
      let ambiguous = false;
      while (remaining.size > 0) {
        const ready = [...remaining].filter((node) => incoming.get(node) === 0).sort();
        if (ready.length === 0) {
          ambiguous = true;
          ordered.push(...[...remaining].sort());
          break;
        }
        if (ready.length !== 1) ambiguous = true;
        const next = ready[0];
        remaining.delete(next);
        ordered.push(next);
        for (const after of edgeMap.get(next) ?? []) {
          if (incoming.has(after)) incoming.set(after, incoming.get(after) - 1);
        }
      }
      return {ordered, ambiguous};
    };
    const addPathGroupObservation = (path, groupKey, unownedEvidence = null) => {
      if (!groupKey) {
        if (groupByProperty || layout === 'kanban') {
          freshSweepUnownedResultSamples += 1;
          if (unownedEvidence) freshSweepUnownedResultObservations.push(unownedEvidence);
        }
        return;
      }
      if (layout === 'table' && groupByProperty) {
        const section = freshSweepTableSections.get(groupKey);
        if (!section) {
          freshSweepTableSectionReconciliationAmbiguous = true;
          return;
        }
        section.member_paths.add(path);
        if (!freshSweepPathTableSectionKeys.has(path)) freshSweepPathTableSectionKeys.set(path, new Set());
        freshSweepPathTableSectionKeys.get(path).add(groupKey);
        return;
      }
      if (!freshSweepPathGroupKeys.has(path)) freshSweepPathGroupKeys.set(path, new Set());
      freshSweepPathGroupKeys.get(path).add(groupKey);
      if (freshSweepPathGroupKeys.get(path).size > 1) freshSweepGroupOwnershipAmbiguous = true;
    };
    for (const entry of retainedCandidates) {
      const identityBefore = pathIdentity(entry.candidate, entry.path);
      const candidateNow = pathCandidateFor(entry.element);
      const identityNow = pathIdentity(candidateNow);
      if (identityBefore !== identityNow) recordIdentityChange('path', identityBefore, identityNow, entry.element);
      freshSweepNodeIdentities.set(entry.element, identityNow);
    }
    for (const link of kanbanCardPathLinks) {
      const titleNow = textOf(link.element.querySelector('.bases-kanban-card-property.mod-title'));
      const pathNow = pathFor(titleNow);
      const identityNow = kanbanCardIdentity(titleNow, link.element, pathNow);
      const identityBefore = 'path:' + link.path + '|column:' + rawKanbanColumns.indexOf(link.column);
      if (identityNow !== identityBefore) recordIdentityChange('kanban-card', identityBefore, identityNow, link.element);
      freshSweepNodeIdentities.set(link.element, identityNow);
    }
    const initialHeadingIdentityEntries = headingIdentityEntries(
      scopedHeadingIdentityElements(layout === 'table' ? rawMarkerElements : markerElements),
    );
    recordHeadingIdentityEntries(initialHeadingIdentityEntries, {source: 'initial-dom'});
    const scanFreshSweepPosition = async (scrollContainer, containerClass, axis, requestedOffset) => {
      await waitForPaintFrames();
      freshSweepPositions += 1;
      const offsetEvidence = {
        container_class: containerClass,
        axis,
        requested_offset: requestedOffset,
        scroll_positions: readScrollPositions(scrollContainer),
        path_samples: 0,
        unique_path_count: 0,
        unique_paths: [],
        heading_samples: 0,
        unmapped_path_samples: 0,
        unmapped_row_samples: 0,
        ordered_paths: [],
        ordered_headings: [],
        structural_heading_observations: [],
        outside_selected_root_group_markers: [],
        result_group_assignments: [],
        mapped_row_path_candidates: [],
        unmapped_rows: [],
      };
      freshSweepOffsets.push(offsetEvidence);
      const unmappedCandidateEvidence = (element, candidate, sourceScope, diagnostics = undefined) => {
        const bounds = element.getBoundingClientRect();
        return {
          candidate: String(candidate || ''),
          text: textOf(element),
          class_name: element.getAttribute('class') || '',
          source_scope: sourceScope,
          fixture_path_matches: fixturePathMatches(candidate),
          top: bounds.top,
          left: bounds.left,
          visibility_sample_sequence: freshSweepPositions,
          visibility_sample_bounds: {top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height},
          scroll_positions: readScrollPositions(element),
          ...(diagnostics ? {diagnostics} : {}),
        };
      };
      const pathsAtPosition = new Set();
      const addFreshPath = (path) => {
        if (pathsAtPosition.has(path)) freshSweepDuplicatePathSamples += 1;
        pathsAtPosition.add(path);
        freshSweepPaths.add(path);
      };
      const freshRawMarkers = observationRoot
        ? [...observationRoot.querySelectorAll('[class], [data-group], [role="group"]')]
          .filter((element) => hasGroupMarker(element) && isStructurallyRenderableMarker(element))
        : [];
      offsetEvidence.outside_selected_root_group_markers = freshRawMarkers
        .filter((element) => sharesSelectedResultScope(element) && !selectedResultRoot?.contains(element))
        .map((element) => {
          const shared = nearestCommonAncestor(element, selectedResultRoot);
          return {
            tag: element.tagName.toLowerCase(),
            class_name: element.getAttribute('class') || '',
            text: textOf(element).slice(0, 240),
            shared_ancestor_tag: shared?.tagName?.toLowerCase() || null,
            shared_ancestor_class_name: shared?.getAttribute('class') || '',
          };
        });
      // Table ownership needs offscreen structural boundaries; painted visibility is recorded separately below.
      const freshMarkers = scopedHeadingIdentityElements(layout === 'table'
        ? freshRawMarkers
        : freshRawMarkers.filter((element) => visible(element) && hitTestPaintedText(element)));
      const freshMarkerIdentityEntries = headingIdentityEntries(freshMarkers);
      recordHeadingIdentityEntries(freshMarkerIdentityEntries, {
        source: 'fresh-sweep',
        position: freshSweepPositions,
        scroll_positions: offsetEvidence.scroll_positions,
      });
      const markerObservations = freshMarkerIdentityEntries.map((identityEntry) => {
        const {element, key} = identityEntry;
        const column = layout === 'kanban' ? element.closest('.bases-kanban-column') : null;
        const columnOrdinal = layout === 'kanban' ? rawKanbanColumns.indexOf(column) : null;
        const painted = visible(element) && hitTestPaintedText(element);
        if (painted) {
          freshSweepHeadingKeys.add(key);
          freshSweepHeadingSamples += 1;
          offsetEvidence.heading_samples += 1;
          if (layout === 'kanban') freshSweepPaintedKanbanColumnOrdinals.add(columnOrdinal);
          const bounds = element.getBoundingClientRect();
          if (!freshSweepHeadingRecords.has(key)) {
            freshSweepHeadingRecords.set(key, {
              key,
              base_identity: identityEntry.base_identity,
              element,
              label: normalize(element.getAttribute('data-group') || element.getAttribute('aria-label') || textOf(element)),
              class_name: element.getAttribute('class') || '',
              column,
              column_ordinal: columnOrdinal,
              top: bounds.top,
              left: bounds.left,
              visibility_sample_sequence: freshSweepPositions,
              visibility_sample_bounds: {top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height},
              scroll_positions: readScrollPositions(element),
            });
          }
        }
        return {
          element,
          key,
          base_identity: identityEntry.base_identity,
          occurrence: identityEntry.occurrence,
          occurrence_count: identityEntry.occurrence_count,
          column,
          column_ordinal: columnOrdinal,
          painted,
          logical_position: freshSweepHeadingLogicalPositionByElement.get(element) ?? null,
        };
      });
      offsetEvidence.structural_heading_observations = markerObservations.map((marker) => ({
        key: marker.key,
        base_identity: marker.base_identity,
        occurrence: marker.occurrence,
        occurrence_count: marker.occurrence_count,
        tag: marker.element.tagName.toLowerCase(),
        class_name: marker.element.getAttribute('class') || '',
        label: normalize(marker.element.getAttribute('data-group') || marker.element.getAttribute('aria-label') || textOf(marker.element)),
        painted: marker.painted,
        table_section_root_tag: (marker.element.closest('.bases-table') || selectedResultRoot)?.tagName?.toLowerCase() || null,
        table_section_root_class_name: (marker.element.closest('.bases-table') || selectedResultRoot)?.getAttribute('class') || '',
        logical_position: freshSweepHeadingLogicalPositionByElement.get(marker.element) ?? null,
      }));
      const paintedHeadingEvents = markerObservations
        .filter((marker) => marker.painted)
        .sort((left, right) => layout === 'kanban'
          ? left.column_ordinal - right.column_ordinal || compareDomOrder(left.element, right.element)
          : compareDomOrder(left.element, right.element));
      offsetEvidence.ordered_headings = [...new Set(paintedHeadingEvents.map((marker) => marker.key))];
      if (layout === 'table') {
        const structurallyOrderedHeadings = markerObservations
          .filter((marker) => sharesSelectedResultScope(marker.element)
            && window.getComputedStyle(marker.element).display !== 'none'
            && window.getComputedStyle(marker.element).visibility !== 'hidden'
            && freshSweepHeadingKeys.has(marker.key))
          .sort((left, right) => compareDomOrder(left.element, right.element))
          .map((marker) => marker.key);
        addOrderEdges(freshSweepHeadingOrderEdges, structurallyOrderedHeadings);
      }
      const resultEntries = [];
      const recordResult = (entry, groupKey, columnOrdinal, column, localOrdinal) => {
        const bounds = entry.element.getBoundingClientRect();
        const scrollPositions = readScrollPositions(entry.element);
        freshSweepPathSamples += 1;
        offsetEvidence.path_samples += 1;
        addFreshPath(entry.path);
        const observation = {
          path: entry.path,
          group_key: groupKey,
          column_ordinal: columnOrdinal,
          local_dom_ordinal: localOrdinal,
          visibility_sample_sequence: freshSweepPositions,
          scroll_positions: scrollPositions,
          ...(entry.title_hit_diagnostics ? {title_hit_diagnostics: entry.title_hit_diagnostics} : {}),
        };
        if (!freshSweepResultRecords.has(entry.path)) {
          freshSweepResultRecords.set(entry.path, {
            element: entry.element,
            column,
            column_ordinal: columnOrdinal,
            path: entry.path,
            text: entry.text,
            class_name: entry.class_name,
            source_scope: layout === 'kanban' ? 'kanban' : 'table',
            row_class_name: entry.row_class_name || '',
            ...(entry.title_hit_diagnostics ? {title_hit_diagnostics: entry.title_hit_diagnostics} : {}),
            top: bounds.top,
            left: bounds.left,
            visibility_sample_sequence: freshSweepPositions,
            visibility_sample_bounds: {top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height},
            scroll_positions: scrollPositions,
            observations: [],
          });
        } else {
          const prior = freshSweepResultRecords.get(entry.path);
          if (layout === 'kanban' && prior.column_ordinal !== columnOrdinal) {
            recordIdentityChange('kanban-card', 'path:' + entry.path + '|column:' + prior.column_ordinal,
              'path:' + entry.path + '|column:' + columnOrdinal, entry.element);
          }
        }
        freshSweepResultRecords.get(entry.path).observations.push(observation);
        offsetEvidence.result_group_assignments.push(observation);
        const paintedColumnHeadings = layout === 'kanban'
          ? markerObservations.filter((marker) => marker.painted && marker.column === column)
          : [];
        addPathGroupObservation(entry.path, groupKey, groupKey ? null : {
          path: entry.path,
          group_key: null,
          column_ordinal: columnOrdinal,
          local_dom_ordinal: localOrdinal,
          visibility_sample_sequence: freshSweepPositions,
          scroll_positions: scrollPositions,
          ...(layout === 'kanban' ? {
            visible_painted_heading_candidate_count: paintedColumnHeadings.length,
            visible_painted_heading_keys: paintedColumnHeadings.map((marker) => marker.key),
            card_bounds: {top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height},
            title_hit_diagnostics: entry.title_hit_diagnostics ?? null,
          } : {
            table_section_root_tag: entry.element.closest('.bases-table')?.tagName.toLowerCase() || selectedResultRoot?.tagName.toLowerCase() || null,
            table_section_root_class_name: entry.element.closest('.bases-table')?.getAttribute('class') || selectedResultRoot?.getAttribute('class') || '',
            structurally_rendered_heading_labels: markerObservations
              .filter((marker) => selectedResultRoot?.contains(marker.element))
              .map((marker) => normalize(marker.element.getAttribute('data-group') || marker.element.getAttribute('aria-label') || textOf(marker.element))),
            result_bounds: {top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height},
          }),
        });
        resultEntries.push({...entry, column_ordinal: columnOrdinal, column, local_dom_ordinal: localOrdinal});
      };
      if (layout === 'kanban' && kanbanRoot) {
        const freshCards = [...kanbanRoot.querySelectorAll('.bases-kanban-card')];
        const cardOrdinalByElement = new Map();
        const cardsByColumn = new Map();
        for (const card of freshCards) {
          const column = card.closest('.bases-kanban-column');
          if (!cardsByColumn.has(column)) cardsByColumn.set(column, []);
          cardsByColumn.get(column).push(card);
        }
        for (const cards of cardsByColumn.values()) cards.forEach((card, index) => cardOrdinalByElement.set(card, index));
        for (const card of freshCards) {
          if (!visible(card) || !hitTestPainted(card)) continue;
          const titles = [...card.querySelectorAll('.bases-kanban-card-property.mod-title')].filter(visible);
          const titleCheck = titles.length === 1
            ? inspectPaintedCardTitleText(titles[0], card)
            : {painted: false, diagnostics: {method: 'title-subtree-hit-test', caret_text_hit_test_passed: false, reason: 'visible-title-candidate-count-not-one'}};
          if (titles.length !== 1 || !titleCheck.painted) {
            freshSweepPathSamples += 1;
            offsetEvidence.path_samples += 1;
            freshSweepUnmappedPathSamples += 1;
            offsetEvidence.unmapped_path_samples += 1;
            freshSweepUnmappedCandidates.push(unmappedCandidateEvidence(card, textOf(card), 'kanban', {
              visible_title_candidate_count: titles.length,
              ...titleCheck.diagnostics,
            }));
            continue;
          }
          const title = textOf(titles[0]);
          const path = pathFor(title);
          observeFreshNodeIdentity(card, kanbanCardIdentity(title, card, path), 'kanban-card');
          if (!path) {
            freshSweepPathSamples += 1;
            offsetEvidence.path_samples += 1;
            freshSweepUnmappedPathSamples += 1;
            offsetEvidence.unmapped_path_samples += 1;
            freshSweepUnmappedCandidates.push(unmappedCandidateEvidence(card, title, 'kanban'));
            continue;
          }
          const column = card.closest('.bases-kanban-column');
          const columnOrdinal = rawKanbanColumns.indexOf(column);
          const columnHeadings = markerObservations.filter((marker) => marker.painted && marker.column === column);
          const groupKey = columnHeadings.length === 1 ? columnHeadings[0].key : null;
          if (columnOrdinal >= 0) freshSweepPaintedKanbanColumnOrdinals.add(columnOrdinal);
          recordResult({
            element: card,
            path,
            text: title,
            class_name: card.getAttribute('class') || '',
            row_class_name: card.getAttribute('class') || '',
            title_hit_diagnostics: titleCheck.diagnostics,
          }, groupKey, columnOrdinal, column, cardOrdinalByElement.get(card) ?? -1);
        }
      } else if (selectedResultRoot) {
        const freshLinks = [...selectedResultRoot.querySelectorAll(linkSelector)].map((element) => {
          const candidate = pathCandidateFor(element);
          return {element, candidate, path: pathFor(candidate)};
        });
        const freshCandidateKey = (entry) => entry.path ?? entry.candidate.trim().toLowerCase();
        const retainedFreshLinks = freshLinks.filter((entry) => !freshLinks.some((nested) => nested !== entry
          && entry.element.contains(nested.element)
          && freshCandidateKey(nested) === freshCandidateKey(entry)));
        const paintedFreshLinks = [];
        for (const entry of retainedFreshLinks) {
          if (!visible(entry.element)) continue;
          const painted = textOf(entry.element)
            ? hitTestPaintedText(entry.element)
            : hitTestPainted(entry.element);
          if (!painted) continue;
          const identity = pathIdentity(entry.candidate, entry.path);
          observeFreshNodeIdentity(entry.element, identity, 'path');
          if (!entry.path) {
            freshSweepPathSamples += 1;
            offsetEvidence.path_samples += 1;
            freshSweepUnmappedPathSamples += 1;
            offsetEvidence.unmapped_path_samples += 1;
            freshSweepUnmappedCandidates.push(unmappedCandidateEvidence(entry.element, entry.candidate, 'table'));
            continue;
          }
          paintedFreshLinks.push(entry);
        }
        paintedFreshLinks.sort((left, right) => compareDomOrder(left.element, right.element));
        // Identify group sections within this DOM snapshot only. Cross-snapshot matches require
        // shared member paths, except a pathless empty section may retain the same heading/root
        // objects at the same supported content-space location during this page evaluation.
        // Location and object IDs are evaluation-scoped evidence, never durable identity.
        const tableMarkers = markerObservations.filter((marker) => selectedResultRoot.contains(marker.element));
        const sectionRootFor = (element) => element.closest('.bases-table') || selectedResultRoot;
        const sectionRoots = [...new Set([
          ...tableMarkers.map((marker) => sectionRootFor(marker.element)),
          ...paintedFreshLinks.map((entry) => sectionRootFor(entry.element)),
        ])].sort(compareDomOrder);
        const localSectionOrder = [];
        let localOrdinal = 0;
        for (const [sectionRootOrdinal, sectionRoot] of sectionRoots.entries()) {
          const sectionMarkers = tableMarkers
            .filter((marker) => sectionRootFor(marker.element) === sectionRoot)
            .sort((left, right) => compareDomOrder(left.element, right.element));
          const sectionLinks = paintedFreshLinks
            .filter((entry) => sectionRootFor(entry.element) === sectionRoot);
          const events = [
            ...sectionMarkers.map((marker) => ({kind: 'heading', element: marker.element, marker})),
            ...sectionLinks.map((entry, index) => ({kind: 'path', element: entry.element, entry, index})),
          ].sort((left, right) => compareDomOrder(left.element, right.element));
          let activeTableSection = null;
          let localGroupOrdinal = 0;
          for (const event of events) {
            if (event.kind === 'heading') {
              if (!groupByProperty) continue;
              const localKey = `sample:${freshSweepPositions}|section:${sectionRootOrdinal}|group:${localGroupOrdinal}`;
              const bounds = event.element.getBoundingClientRect();
              const marker = event.marker;
              freshSweepTableSections.set(localKey, {
                key: localKey,
                sample: freshSweepPositions,
                local_order: localSectionOrder.length,
                base_identity: marker.base_identity,
                heading_text: normalize(marker.element.getAttribute('data-group') || marker.element.getAttribute('aria-label') || textOf(marker.element)),
                heading_class_name: marker.element.getAttribute('class') || '',
                heading_bounds: {top: bounds.top, left: bounds.left},
                heading_visibility_sample: {
                  visibility_sample_sequence: freshSweepPositions,
                  visibility_sample_bounds: {top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height},
                  scroll_positions: readScrollPositions(marker.element),
                },
                section_root_tag: sectionRoot.tagName.toLowerCase(),
                section_root_class_name: sectionRoot.getAttribute('class') || '',
                logical_position: marker.logical_position,
                painted_observation_count: marker.painted ? 1 : 0,
                painted_sample_sequences: marker.painted ? [freshSweepPositions] : [],
                member_paths: new Set(),
              });
              localSectionOrder.push(localKey);
              activeTableSection = localKey;
              localGroupOrdinal += 1;
              continue;
            }
            const rowOwner = event.entry.element.closest('.bases-tr, .bases-row, .bases-table-row, tr, [role="row"]');
            recordResult({
              element: event.entry.element,
              path: event.entry.path,
              text: textOf(event.entry.element),
              class_name: event.entry.element.getAttribute('class') || '',
              row_class_name: rowOwner?.getAttribute('class') || '',
            }, groupByProperty ? activeTableSection : null, null, null, localOrdinal);
            localOrdinal += 1;
          }
        }
        if (groupByProperty) freshSweepTableSectionOrders.set(freshSweepPositions, localSectionOrder);
        const freshRows = [...selectedResultRoot.querySelectorAll('.bases-tr, .bases-row, .bases-table-row, tr, [role="row"]')]
          .filter((row) => visible(row) && hitTestPaintedText(row) && Boolean(textOf(row)));
        const freshRowHasCandidate = (row) => retainedFreshLinks.some((entry) =>
          row === entry.element || row.contains(entry.element));
        const freshRowTextPathByElement = new Map();
        const freshRowTextPathCounts = new Map();
        for (const row of freshRows) {
          const isHeader = row.matches('thead tr, .bases-table-header, [role="columnheader"]')
            || Boolean(row.querySelector('.bases-table-header, th, [role="columnheader"]'));
          const isGroupHeading = hasGroupMarker(row) || tableMarkers.some((marker) => row.contains(marker.element));
          if (isHeader || isGroupHeading || !selectedResultRoot.contains(row)) continue;
          const matches = fixturePathMatches(textOf(row));
          if (matches.length !== 1) continue;
          freshRowTextPathByElement.set(row, matches[0]);
          freshRowTextPathCounts.set(matches[0], (freshRowTextPathCounts.get(matches[0]) || 0) + 1);
        }
        const mappedFreshPathlessRows = new Set();
        for (const [row, path] of freshRowTextPathByElement) {
          const uniquelyMappedPathlessRow = !freshRowHasCandidate(row)
            && freshRowTextPathCounts.get(path) === 1
            && resultEntries.filter((entry) => entry.path === path).length === 1;
          if (!uniquelyMappedPathlessRow) continue;
          mappedFreshPathlessRows.add(row);
          const bounds = row.getBoundingClientRect();
          offsetEvidence.mapped_row_path_candidates.push({
            path,
            text: textOf(row),
            class_name: row.getAttribute('class') || '',
            tag: row.tagName.toLowerCase(),
            top: bounds.top,
            left: bounds.left,
          });
        }
        for (const row of freshRows) {
          const isHeader = row.matches('thead tr, .bases-table-header, [role="columnheader"]')
            || Boolean(row.querySelector('.bases-table-header, th, [role="columnheader"]'));
          const isGroupHeading = hasGroupMarker(row) || tableMarkers.some((marker) => row.contains(marker.element));
          const hasCandidate = freshRowHasCandidate(row);
          const hasMappedUniquePath = mappedFreshPathlessRows.has(row);
          if (!isHeader && !isGroupHeading && !hasCandidate && !hasMappedUniquePath) {
            freshSweepUnmappedRowSamples += 1;
            offsetEvidence.unmapped_row_samples += 1;
            const bounds = row.getBoundingClientRect();
            const rowText = textOf(row);
            const unmappedRow = {
              text: rowText.slice(0, 500),
              fixture_path_matches: fixturePathMatches(rowText),
              class_name: row.getAttribute('class') || '',
              tag: row.tagName.toLowerCase(),
              top: bounds.top,
              left: bounds.left,
              visibility_sample_sequence: freshSweepPositions,
              visibility_sample_bounds: {top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height},
              scroll_positions: readScrollPositions(row),
            };
            freshSweepUnmappedRows.push(unmappedRow);
            offsetEvidence.unmapped_rows.push(unmappedRow);
          }
        }
      }
      resultEntries.sort((left, right) => layout === 'kanban'
        ? left.column_ordinal - right.column_ordinal || left.local_dom_ordinal - right.local_dom_ordinal
        : compareDomOrder(left.element, right.element));
      offsetEvidence.ordered_paths = [...new Set(resultEntries.map((entry) => entry.path))];
      if (layout === 'kanban') {
        const pathsByColumn = new Map();
        for (const entry of resultEntries) {
          if (!pathsByColumn.has(entry.column_ordinal)) pathsByColumn.set(entry.column_ordinal, []);
          pathsByColumn.get(entry.column_ordinal).push(entry.path);
        }
        for (const paths of pathsByColumn.values()) addOrderEdges(freshSweepPathOrderEdges, paths);
      } else {
        addOrderEdges(freshSweepPathOrderEdges, offsetEvidence.ordered_paths);
      }
      offsetEvidence.unique_path_count = pathsAtPosition.size;
      offsetEvidence.unique_paths = [...pathsAtPosition].sort();
    };
    if (observationRoot) {
      await scanFreshSweepPosition(observationRoot, 'current-viewport', 'current', null);
      const sweptScrollContainers = new WeakSet();
      freshSweepTraversal: while (true) {
        const potentialScrollContainers = [observationRoot, ...observationRoot.querySelectorAll('*')]
          .filter((element) => {
            if (sweptScrollContainers.has(element)) return false;
            const style = window.getComputedStyle(element);
            const verticalScrollable = element.scrollHeight > element.clientHeight + 1
              && /(auto|scroll|overlay|hidden)/.test(style.overflowY);
            const horizontalScrollable = element.scrollWidth > element.clientWidth + 1
              && /(auto|scroll|overlay|hidden)/.test(style.overflowX);
            return verticalScrollable || horizontalScrollable;
          });
        if (potentialScrollContainers.length === 0) break;
        for (const container of potentialScrollContainers) {
          sweptScrollContainers.add(container);
          await scrollIntoView(container);
          const containerClass = container.getAttribute('class') || container.tagName.toLowerCase();
          const axes = [];
          if (container.scrollHeight > container.clientHeight + 1) axes.push({
            axis: 'vertical',
            property: 'scrollTop',
            viewport: container.clientHeight,
            sizeProperty: 'scrollHeight',
          });
          if (container.scrollWidth > container.clientWidth + 1) axes.push({
            axis: 'horizontal',
            property: 'scrollLeft',
            viewport: container.clientWidth,
            sizeProperty: 'scrollWidth',
          });
          for (const {axis, property, viewport: axisViewport, sizeProperty} of axes) {
            let sweptMaximum = -1;
            while (true) {
              const maximum = Math.max(0, container[sizeProperty] - axisViewport);
              if (maximum <= sweptMaximum) break;
              const step = Math.max(1, Math.floor(Math.max(1, axisViewport) * 0.75));
              const offsets = [0];
              for (let offset = step; offset < maximum; offset += step) offsets.push(offset);
              offsets.push(maximum);
              for (const offset of [...new Set(offsets)]) {
                if (freshSweepPositions >= maximumFreshSweepPositions) {
                  freshSweepCoverageComplete = false;
                  break freshSweepTraversal;
                }
                container[property] = offset;
                await scanFreshSweepPosition(container, containerClass, axis, offset);
              }
              sweptMaximum = maximum;
            }
          }
        }
      }
    }
    const freshSweepResolvedTableSections = new Map();
    let freshSweepOrderedTableSectionKeys = [];
    if (layout === 'table' && groupByProperty) {
      const localSectionKeys = [...freshSweepTableSections.keys()];
      const sectionParent = new Map(localSectionKeys.map((key) => [key, key]));
      const sectionRoot = (key) => {
        let root = key;
        while (sectionParent.get(root) !== root) root = sectionParent.get(root);
        let current = key;
        while (sectionParent.get(current) !== current) {
          const next = sectionParent.get(current);
          sectionParent.set(current, root);
          current = next;
        }
        return root;
      };
      const joinSections = (left, right) => {
        const leftRoot = sectionRoot(left);
        const rightRoot = sectionRoot(right);
        if (leftRoot !== rightRoot) sectionParent.set(rightRoot, leftRoot);
      };
      const sectionsBySample = new Map();
      const pathSectionsBySample = new Map();
      for (const [key, section] of freshSweepTableSections) {
        if (!sectionsBySample.has(section.sample)) sectionsBySample.set(section.sample, []);
        sectionsBySample.get(section.sample).push(key);
        for (const path of section.member_paths) {
          const samplePathKey = `${section.sample}\u0000${path}`;
          if (!pathSectionsBySample.has(samplePathKey)) pathSectionsBySample.set(samplePathKey, new Set());
          pathSectionsBySample.get(samplePathKey).add(key);
        }
      }
      for (const [sample, keys] of sectionsBySample) {
        for (let leftIndex = 0; leftIndex < keys.length; leftIndex += 1) {
          for (let rightIndex = leftIndex + 1; rightIndex < keys.length; rightIndex += 1) {
            const leftKey = keys[leftIndex];
            const rightKey = keys[rightIndex];
            const left = freshSweepTableSections.get(leftKey);
            const right = freshSweepTableSections.get(rightKey);
            if (!sameTableSectionLogicalPosition(left, right)) continue;
            freshSweepTableSectionReconciliationAmbiguous = true;
            if (freshSweepTableSectionReconciliationEvidence.length < 160) {
              freshSweepTableSectionReconciliationEvidence.push({
                reason: 'distinct-local-sections-share-one-stable-logical-position',
                sample,
                left_key: leftKey,
                right_key: rightKey,
                left_heading_text: left.heading_text,
                right_heading_text: right.heading_text,
                logical_position: left.logical_position,
              });
            }
          }
        }
      }
      if ([...pathSectionsBySample.values()].some((keys) => keys.size > 1)) {
        freshSweepTableSectionReconciliationAmbiguous = true;
      }
      const sampleIds = [...sectionsBySample.keys()].sort((left, right) => left - right);
      for (let leftIndex = 0; leftIndex < sampleIds.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < sampleIds.length; rightIndex += 1) {
          const leftSections = sectionsBySample.get(sampleIds[leftIndex]);
          const rightSections = sectionsBySample.get(sampleIds[rightIndex]);
          const pairEdges = [];
          let labelConflict = false;
          let positionConflict = false;
          for (const leftKey of leftSections) {
            const left = freshSweepTableSections.get(leftKey);
            for (const rightKey of rightSections) {
              const right = freshSweepTableSections.get(rightKey);
              const sharedPaths = [...left.member_paths].filter((path) => right.member_paths.has(path));
              const samePosition = sameTableSectionLogicalPosition(left, right);
              if (left.heading_text !== right.heading_text && (sharedPaths.length > 0 || samePosition)) {
                labelConflict = true;
                if (freshSweepTableSectionReconciliationEvidence.length < 160) {
                  freshSweepTableSectionReconciliationEvidence.push({
                    reason: 'shared-path-or-logical-position-has-different-heading-text',
                    left_key: leftKey,
                    right_key: rightKey,
                    left_heading_text: left.heading_text,
                    right_heading_text: right.heading_text,
                    shared_paths: sharedPaths,
                    left_logical_position: left.logical_position,
                    right_logical_position: right.logical_position,
                  });
                }
                continue;
              }
              if (left.heading_text !== right.heading_text) continue;
              if (sharedPaths.length > 0 && !samePosition) {
                positionConflict = true;
                if (freshSweepTableSectionReconciliationEvidence.length < 160) {
                  freshSweepTableSectionReconciliationEvidence.push({
                    reason: 'shared-path-sections-have-different-logical-positions',
                    left_key: leftKey,
                    right_key: rightKey,
                    heading_text: left.heading_text,
                    shared_paths: sharedPaths,
                    left_logical_position: left.logical_position,
                    right_logical_position: right.logical_position,
                  });
                }
                continue;
              }
              if (!samePosition) continue;
              // A shared canonical member path, matching heading, complete structural routes,
              // and matching content-space location corroborate continuity after DOM replacement.
              // Pathless sample observations are handled separately using same-evaluation IDs.
              if (sharedPaths.length === 0) continue;
              pairEdges.push({
                left_key: leftKey,
                right_key: rightKey,
                shared_paths: sharedPaths,
                identity_evidence: 'shared-canonical-member-path-plus-matching-heading-and-logical-location',
                left_logical_position: left.logical_position,
                right_logical_position: right.logical_position,
              });
            }
          }
          if (labelConflict || positionConflict) {
            freshSweepTableSectionReconciliationAmbiguous = true;
            continue;
          }
          const leftDegrees = new Map();
          const rightDegrees = new Map();
          for (const edge of pairEdges) {
            leftDegrees.set(edge.left_key, (leftDegrees.get(edge.left_key) || 0) + 1);
            rightDegrees.set(edge.right_key, (rightDegrees.get(edge.right_key) || 0) + 1);
          }
          if ([...leftDegrees.values(), ...rightDegrees.values()].some((degree) => degree > 1)) {
            freshSweepTableSectionReconciliationAmbiguous = true;
            if (freshSweepTableSectionReconciliationEvidence.length < 160) {
              freshSweepTableSectionReconciliationEvidence.push({
                reason: 'logical-position-reconciliation-is-not-one-to-one',
                left_sample: sampleIds[leftIndex],
                right_sample: sampleIds[rightIndex],
                candidate_edges: pairEdges,
              });
            }
            continue;
          }
          for (const edge of pairEdges) {
            const mergedRoots = sectionRoot(edge.left_key) !== sectionRoot(edge.right_key);
            joinSections(edge.left_key, edge.right_key);
            if (!mergedRoots) continue;
            if (freshSweepTableSectionAcceptedReconciliationEvidence.length >= 256) {
              freshSweepTableSectionAcceptedReconciliationEvidenceTruncated = true;
              continue;
            }
            freshSweepTableSectionAcceptedReconciliationEvidence.push({
              left_local_key: edge.left_key,
              right_local_key: edge.right_key,
              left_sample: freshSweepTableSections.get(edge.left_key).sample,
              right_sample: freshSweepTableSections.get(edge.right_key).sample,
              heading_text: freshSweepTableSections.get(edge.left_key).heading_text,
              shared_canonical_member_paths: edge.shared_paths,
              left_observed_member_path_count: freshSweepTableSections.get(edge.left_key).member_paths.size,
              right_observed_member_path_count: freshSweepTableSections.get(edge.right_key).member_paths.size,
              identity_evidence: edge.identity_evidence,
              left_logical_location: {
                top: edge.left_logical_position?.top ?? null,
                left: edge.left_logical_position?.left ?? null,
                scan_local_heading_object_id: edge.left_logical_position?.scan_local_heading_object_id ?? null,
                scan_local_section_root_object_id: edge.left_logical_position?.scan_local_section_root_object_id ?? null,
              },
              right_logical_location: {
                top: edge.right_logical_position?.top ?? null,
                left: edge.right_logical_position?.left ?? null,
                scan_local_heading_object_id: edge.right_logical_position?.scan_local_heading_object_id ?? null,
                scan_local_section_root_object_id: edge.right_logical_position?.scan_local_section_root_object_id ?? null,
              },
            });
          }
        }
      }

      // A snapshot can observe no painted member paths for a section even when the section has
      // members elsewhere in the sweep; zero paths is not proof that the group is empty. Bridge
      // such pathless observations only when the exact heading and section-root objects persist
      // in this page evaluation and their supported routes and content-space coordinates agree.
      // Reused nodes at a different logical position are caught by the anchor/position gate.
      for (let leftIndex = 0; leftIndex < sampleIds.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < sampleIds.length; rightIndex += 1) {
          for (const leftKey of sectionsBySample.get(sampleIds[leftIndex])) {
            const left = freshSweepTableSections.get(leftKey);
            for (const rightKey of sectionsBySample.get(sampleIds[rightIndex])) {
              const right = freshSweepTableSections.get(rightKey);
              if ((left.member_paths.size > 0 && right.member_paths.size > 0)
                || left.heading_text !== right.heading_text
                || !sameTableSectionLogicalPosition(left, right)
                || !left.logical_position?.scan_local_heading_object_id
                || left.logical_position.scan_local_heading_object_id !== right.logical_position?.scan_local_heading_object_id
                || !left.logical_position?.scan_local_section_root_object_id
                || left.logical_position.scan_local_section_root_object_id !== right.logical_position?.scan_local_section_root_object_id) continue;
              const mergedRoots = sectionRoot(leftKey) !== sectionRoot(rightKey);
              joinSections(leftKey, rightKey);
              if (!mergedRoots) continue;
              if (freshSweepTableSectionAcceptedReconciliationEvidence.length >= 256) {
                freshSweepTableSectionAcceptedReconciliationEvidenceTruncated = true;
                continue;
              }
              freshSweepTableSectionAcceptedReconciliationEvidence.push({
                left_local_key: leftKey,
                right_local_key: rightKey,
                left_sample: left.sample,
                right_sample: right.sample,
                heading_text: left.heading_text,
                shared_canonical_member_paths: [],
                left_observed_member_path_count: left.member_paths.size,
                right_observed_member_path_count: right.member_paths.size,
                pathless_endpoints: {
                  left: left.member_paths.size === 0,
                  right: right.member_paths.size === 0,
                },
                identity_evidence: 'same-page-evaluation-objects-plus-matching-logical-location-for-pathless-sample',
                left_logical_location: {
                  top: left.logical_position?.top ?? null,
                  left: left.logical_position?.left ?? null,
                  scan_local_heading_object_id: left.logical_position?.scan_local_heading_object_id ?? null,
                  scan_local_section_root_object_id: left.logical_position?.scan_local_section_root_object_id ?? null,
                },
                right_logical_location: {
                  top: right.logical_position?.top ?? null,
                  left: right.logical_position?.left ?? null,
                  scan_local_heading_object_id: right.logical_position?.scan_local_heading_object_id ?? null,
                  scan_local_section_root_object_id: right.logical_position?.scan_local_section_root_object_id ?? null,
                },
              });
            }
          }
        }
      }

      const rootRecords = new Map();
      for (const [key, section] of freshSweepTableSections) {
        const root = sectionRoot(key);
        if (!rootRecords.has(root)) {
          rootRecords.set(root, {
            root,
            heading_text: section.heading_text,
            heading_class_name: section.heading_class_name,
            logical_position: section.logical_position,
            heading_bounds: section.heading_bounds,
            heading_visibility_sample: section.heading_visibility_sample,
            section_root_tag: section.section_root_tag,
            section_root_class_name: section.section_root_class_name,
            painted_observation_count: 0,
            painted_sample_sequences: new Set(),
            local_keys: [],
            samples: new Set(),
            member_paths: new Set(),
            first_sample: section.sample,
            first_order: section.local_order,
          });
        }
        const record = rootRecords.get(root);
        if (record.heading_text !== section.heading_text) {
          freshSweepTableSectionReconciliationAmbiguous = true;
        }
        if (!sameTableSectionLogicalPosition(record, section)) {
          freshSweepTableSectionReconciliationAmbiguous = true;
          if (freshSweepTableSectionReconciliationEvidence.length < 160) {
            freshSweepTableSectionReconciliationEvidence.push({
              reason: 'reconciled-local-sections-disagree-on-logical-position',
              root,
              left_logical_position: record.logical_position,
              right_logical_position: section.logical_position,
              local_section_key: key,
            });
          }
        }
        record.local_keys.push(key);
        record.samples.add(section.sample);
        record.painted_observation_count += section.painted_observation_count;
        for (const sample of section.painted_sample_sequences) record.painted_sample_sequences.add(sample);
        for (const path of section.member_paths) record.member_paths.add(path);
        if (section.sample < record.first_sample
          || (section.sample === record.first_sample && section.local_order < record.first_order)) {
          record.first_sample = section.sample;
          record.first_order = section.local_order;
          record.heading_class_name = section.heading_class_name;
          record.heading_bounds = section.heading_bounds;
          record.heading_visibility_sample = section.heading_visibility_sample;
          record.section_root_tag = section.section_root_tag;
          record.section_root_class_name = section.section_root_class_name;
        }
      }
      const rootEntries = [...rootRecords.values()];
      for (const record of rootEntries) {
        const localSectionsPerSample = new Map();
        for (const localKey of record.local_keys) {
          const sample = freshSweepTableSections.get(localKey).sample;
          localSectionsPerSample.set(sample, (localSectionsPerSample.get(sample) || 0) + 1);
        }
        if ([...localSectionsPerSample.values()].some((count) => count > 1)) {
          // A final identity must never collapse two separate sections from one DOM snapshot.
          freshSweepTableSectionReconciliationAmbiguous = true;
        }
      }
      for (let leftIndex = 0; leftIndex < rootEntries.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < rootEntries.length; rightIndex += 1) {
          const left = rootEntries[leftIndex];
          const right = rootEntries[rightIndex];
          if (left.heading_text !== right.heading_text) continue;
          if (![...left.samples].some((sample) => right.samples.has(sample))) {
            // Path-backed graph edges may connect non-adjacent samples transitively. If they did
            // not, a different content-space slot under the same complete supported routes is
            // sufficient to retain a distinct visible section; a same-slot or incomparable
            // equal-label component remains ambiguous.
            const sameAnchor = sameTableSectionAnchor(left, right);
            const distinctLogicalSlots = sameAnchor
              && (Math.abs(left.logical_position.top - right.logical_position.top) > 4
                || Math.abs(left.logical_position.left - right.logical_position.left) > 4);
            if (distinctLogicalSlots) {
              if (freshSweepTableSectionReconciliationEvidence.length < 160) {
                freshSweepTableSectionReconciliationEvidence.push({
                  reason: 'equal-label-disjoint-sample-sections-have-distinct-supported-logical-slots',
                  left_key: left.root,
                  right_key: right.root,
                  heading_text: left.heading_text,
                  left_logical_position: left.logical_position,
                  right_logical_position: right.logical_position,
                  left_samples: [...left.samples],
                  right_samples: [...right.samples],
                });
              }
              continue;
            }
            freshSweepTableSectionReconciliationAmbiguous = true;
            if (freshSweepTableSectionReconciliationEvidence.length < 160) {
              freshSweepTableSectionReconciliationEvidence.push({
                reason: 'equal-label-disjoint-sample-sections-have-no-supported-distinct-slot-or-continuity',
                left_key: left.root,
                right_key: right.root,
                heading_text: left.heading_text,
                same_complete_supported_anchor_routes: sameAnchor,
                left_logical_position: left.logical_position,
                right_logical_position: right.logical_position,
                left_samples: [...left.samples],
                right_samples: [...right.samples],
              });
            }
          }
        }
      }
      rootEntries.sort((left, right) => left.first_sample - right.first_sample || left.first_order - right.first_order);
      const globalKeyByRoot = new Map();
      rootEntries.forEach((record, index) => {
        const key = `table-section:${index}`;
        globalKeyByRoot.set(record.root, key);
        freshSweepResolvedTableSections.set(key, {...record, key, member_paths: []});
      });
      for (const [path, localKeys] of freshSweepPathTableSectionKeys) {
        const globalKeys = [...new Set([...localKeys].map((key) => globalKeyByRoot.get(sectionRoot(key))).filter(Boolean))];
        if (globalKeys.length > 0) freshSweepPathGroupKeys.set(path, new Set(globalKeys));
        if (globalKeys.length > 1) freshSweepGroupOwnershipAmbiguous = true;
      }
      freshSweepUnresolvedGroupOwnerPaths = [...freshSweepPaths]
        .filter((path) => (freshSweepPathGroupKeys.get(path)?.size ?? 0) !== 1)
        .sort();

      const tableSectionOrderEdges = new Map();
      for (const localKeys of freshSweepTableSectionOrders.values()) {
        const globalKeys = [...new Set(localKeys
          .map((key) => globalKeyByRoot.get(sectionRoot(key)))
          .filter(Boolean))];
        addOrderEdges(tableSectionOrderEdges, globalKeys);
      }
      const sectionsByStableAnchor = new Map();
      for (const [key, section] of freshSweepResolvedTableSections) {
        if (!sameTableSectionAnchor(section, section)) continue;
        const position = section.logical_position;
        const anchorKey = JSON.stringify([
          position.vertical_scroll_ancestor_routes,
          position.horizontal_scroll_ancestor_routes,
          position.section_root_route,
        ]);
        if (!sectionsByStableAnchor.has(anchorKey)) sectionsByStableAnchor.set(anchorKey, []);
        sectionsByStableAnchor.get(anchorKey).push({key, top: position.top, left: position.left});
      }
      for (const sections of sectionsByStableAnchor.values()) {
        sections.sort((left, right) => left.top - right.top || left.left - right.left || left.key.localeCompare(right.key));
        addOrderEdges(tableSectionOrderEdges, sections.map((section) => section.key));
      }
      const orderedSections = topologicalOrder([...freshSweepResolvedTableSections.keys()], tableSectionOrderEdges);
      freshSweepOrderedTableSectionKeys = orderedSections.ordered;
      if (orderedSections.ambiguous) freshSweepOrderingAmbiguous = true;
      freshSweepUnpaintedTableSectionKeys = [...freshSweepResolvedTableSections.entries()]
        .filter(([, section]) => section.painted_observation_count === 0)
        .map(([key]) => key);
      for (const [sample, localKeys] of freshSweepTableSectionOrders) {
        freshSweepTableSectionSnapshotOrders.set(sample, localKeys.map((localKey) => ({
          local_key: localKey,
          global_key: globalKeyByRoot.get(sectionRoot(localKey)) ?? null,
        })));
      }
      if (freshSweepTableSectionReconciliationAmbiguous) freshSweepGroupOwnershipAmbiguous = true;
    }
    const freshSweepUniquePaths = [...freshSweepPaths].sort();
    const freshSweepUniqueHeadings = [...freshSweepHeadingKeys].sort();
    let freshSweepOrderedPaths = [];
    if (layout === 'kanban') {
      const columnOrdinals = [...new Set([...freshSweepResultRecords.values()].map((entry) => entry.column_ordinal))].sort((left, right) => left - right);
      for (const columnOrdinal of columnOrdinals) {
        const columnPaths = [...freshSweepResultRecords.values()]
          .filter((entry) => entry.column_ordinal === columnOrdinal)
          .map((entry) => entry.path);
        const ordered = topologicalOrder(columnPaths, freshSweepPathOrderEdges);
        freshSweepOrderedPaths.push(...ordered.ordered);
        if (ordered.ambiguous) freshSweepOrderingAmbiguous = true;
      }
      if ([...freshSweepResultRecords.values()].some((entry) => entry.column_ordinal < 0)) freshSweepOrderingAmbiguous = true;
    } else {
      const ordered = topologicalOrder(freshSweepUniquePaths, freshSweepPathOrderEdges);
      freshSweepOrderedPaths = ordered.ordered;
      if (ordered.ambiguous) freshSweepOrderingAmbiguous = true;
    }
    let freshSweepOrderedHeadings = [];
    if (layout === 'kanban') {
      freshSweepOrderedHeadings = [...freshSweepHeadingRecords.keys()].sort((leftKey, rightKey) => {
        const left = freshSweepHeadingRecords.get(leftKey);
        const right = freshSweepHeadingRecords.get(rightKey);
        return left.column_ordinal - right.column_ordinal || leftKey.localeCompare(rightKey);
      });
    } else {
      const ordered = topologicalOrder(freshSweepUniqueHeadings, freshSweepHeadingOrderEdges);
      freshSweepOrderedHeadings = ordered.ordered;
      if (ordered.ambiguous && !(layout === 'table' && groupByProperty)) freshSweepOrderingAmbiguous = true;
    }
    pathLinks = freshSweepOrderedPaths.map((path, index) => {
      const result = freshSweepResultRecords.get(path);
      const groupKeys = [...(freshSweepPathGroupKeys.get(path) ?? [])];
      return {
        ...result,
        index,
        result_order_ordinal: index,
        group_key: groupKeys.length === 1 ? groupKeys[0] : null,
        group_keys: groupKeys,
      };
    });
    const reconciledUnownedResultObservations = freshSweepUnownedResultObservations.map((observation) => {
      const groupKeys = [...(freshSweepPathGroupKeys.get(observation.path) ?? [])];
      const groupOwners = groupKeys.map((key) => layout === 'kanban'
        ? {key, column_ordinal: freshSweepHeadingRecords.get(key)?.column_ordinal ?? null}
        : {key, heading_text: freshSweepResolvedTableSections.get(key)?.heading_text ?? null});
      return {
        ...observation,
        reconciled_group_keys: groupKeys,
        reconciled_group_owners: groupOwners,
        reconciled_to_one_stable_owner: layout === 'kanban'
          ? groupKeys.length === 1 && groupOwners[0].column_ordinal === observation.column_ordinal
          : groupKeys.length === 1,
      };
    });
    if (layout === 'table' && groupByProperty) {
      groupRecords = freshSweepOrderedTableSectionKeys.map((key, index) => {
        const section = freshSweepResolvedTableSections.get(key);
        return {
          index,
          key,
          base_identity: section.key,
          heading_text: section.heading_text,
          heading_class_name: section.heading_class_name,
          heading_bounds: section.heading_bounds,
          heading_visibility_sample: section.heading_visibility_sample,
          section_root_tag: section.section_root_tag,
          section_root_class_name: section.section_root_class_name,
          member_paths: [],
          marker: {element: null, column: null, label: section.heading_text, index},
        };
      });
    } else {
      groupRecords = freshSweepOrderedHeadings.map((key, index) => {
        const heading = freshSweepHeadingRecords.get(key);
        const marker = {
          element: heading.element,
          column: heading.column,
          label: heading.label,
          index,
        };
        return {
          index,
          key,
          base_identity: heading.base_identity,
          heading_text: heading.label,
          heading_class_name: heading.class_name,
          heading_bounds: {top: heading.top, left: heading.left},
          heading_visibility_sample: {
            visibility_sample_sequence: heading.visibility_sample_sequence,
            visibility_sample_bounds: heading.visibility_sample_bounds,
            scroll_positions: heading.scroll_positions,
          },
          member_paths: [],
          marker,
        };
      });
    }
    const ungroupedVisibleFilePaths = [];
    const unassignedVisibleFilePaths = [];
    for (const link of pathLinks) {
      if (layout === 'kanban' || groupByProperty) {
        const ownerKeys = link.group_keys;
        const owners = groupRecords.filter((group) => ownerKeys.includes(group.key));
        if (ownerKeys.length !== 1 || owners.length !== 1) {
          unassignedVisibleFilePaths.push(link.path);
          continue;
        }
        owners[0].member_paths.push(link.path);
      } else {
        ungroupedVisibleFilePaths.push(link.path);
      }
    }
    const allUnmappedVisiblePathCandidates = [...unmappedVisiblePathCandidates, ...freshSweepUnmappedCandidates];
    const blockingNodeIdentityChanges = nodeIdentityChanges.filter((change) =>
      !(layout === 'table' && groupByProperty && change.kind === 'group-heading'));
    const freshSweepEvidenceEligibleForPreSweepRows = layout === 'table'
      && freshSweepPositions > 0
      && freshSweepCoverageComplete
      && resultCount !== null
      && freshSweepUniquePaths.length === resultCount
      && freshSweepUnmappedPathSamples === 0
      && freshSweepUnmappedRowSamples === 0
      && freshSweepDuplicatePathSamples === 0
      && (!(layout === 'table' && groupByProperty) || freshSweepUnresolvedGroupOwnerPaths.length === 0)
      && (!(layout === 'table' && groupByProperty) || freshSweepUnpaintedTableSectionKeys.length === 0)
      && (layout !== 'table' || !groupByProperty || reconciledUnownedResultObservations.every((observation) => observation.reconciled_to_one_stable_owner))
      && !freshSweepOrderingAmbiguous
      && !freshSweepGroupOwnershipAmbiguous
      && (layout === 'table' && groupByProperty || !freshSweepHeadingIdentityAmbiguous)
      && blockingNodeIdentityChanges.length === 0
      && allUnmappedVisiblePathCandidates.length === 0
      && unassignedVisibleFilePaths.length === 0;
    const preSweepRowReconciliation = preSweepUnmappedVisibleRowCandidates.map((candidate) => {
      const fixturePathMatches = candidate.fixture_path_matches;
      const matchedPath = fixturePathMatches.length === 1 ? fixturePathMatches[0] : null;
      const freshRecord = matchedPath ? freshSweepResultRecords.get(matchedPath) : null;
      const groupKeys = matchedPath ? [...(freshSweepPathGroupKeys.get(matchedPath) ?? [])] : [];
      const groupOwnerIsStable = groupByProperty ? groupKeys.length === 1 : groupKeys.length === 0;
      const resolutionReasons = [];
      if (!freshSweepEvidenceEligibleForPreSweepRows) {
        resolutionReasons.push('The exhaustive fresh sweep did not pass all completeness, uniqueness, mapping, ordering, and ownership gates.');
      }
      if (fixturePathMatches.length !== 1) {
        resolutionReasons.push('The preliminary row text did not map to exactly one fixture path.');
      }
      if (!freshRecord || freshRecord.observations.length === 0 || !freshSweepPaths.has(matchedPath)) {
        resolutionReasons.push('The candidate path was not independently observed by the exhaustive fresh sweep.');
      }
      if (!groupOwnerIsStable) {
        resolutionReasons.push(groupByProperty
          ? 'The fresh sweep did not establish exactly one stable group owner for the candidate path.'
          : 'The ungrouped table unexpectedly recorded group ownership for the candidate path.');
      }
      return {
        ...candidate,
        resolution: resolutionReasons.length === 0 ? 'resolved-by-complete-fresh-sweep' : 'unresolved',
        matched_path: matchedPath,
        fresh_sweep_observation_count: freshRecord?.observations.length ?? 0,
        group_keys: groupKeys,
        resolution_reasons: resolutionReasons,
      };
    });
    const resolvedPreSweepRowCandidates = preSweepRowReconciliation
      .filter((candidate) => candidate.resolution === 'resolved-by-complete-fresh-sweep');
    const unresolvedPreSweepRowCandidates = preSweepRowReconciliation
      .filter((candidate) => candidate.resolution === 'unresolved');
    const errorSpecificPattern = /invalid|unsupported|must be|could not|failed|failure|malformed|error|exception|rejected|unable to/i;
    const activeErrorElements = [...(root?.querySelectorAll('[role="alert"], .bases-error, [class*="error"]') ?? [])]
      .filter((element) => hitTestPaintedText(element));
    const visibleErrorTexts = [...new Set(activeErrorElements
      .map(textOf)
      .filter((text) => Boolean(text) && errorSpecificPattern.test(text)))];
    const notices = [...new Set([...(document.querySelectorAll('.notice, .modal-container, [role="alert"]'))]
      .filter((element) => hitTestPaintedText(element)).map(textOf).filter(Boolean))];
    const explicitBodyErrorPattern = /parse error|failed to parse|could not parse|invalid \\.base|must be (?:a|an)|unsupported (?:group|entry|value)/i;
    const explicitBodyErrorTexts = [...new Set([...(root?.querySelectorAll('p, div, span, small, strong, em') ?? [])]
      .filter((element) => explicitBodyErrorPattern.test(textOf(element)) && hitTestPaintedText(element))
      .map(textOf).filter(Boolean))];
    const requestedBaseName = (requestedPath.split('/').pop() || '').replace(/\\.base$/i, '').toLowerCase();
    const expectedErrorTextLower = expectedErrorText?.toLowerCase() || '';
    const expectedActiveViewError = scenarioExpectsVisibleError && Boolean(expectedErrorTextLower)
      && [...visibleErrorTexts, ...explicitBodyErrorTexts]
        .some((text) => text.toLowerCase().includes(expectedErrorTextLower));
    const matchingErrorNotice = scenarioExpectsVisibleError && Boolean(expectedErrorTextLower)
      && notices.some((text) => errorSpecificPattern.test(text)
        && (text.toLowerCase().includes(requestedBaseName) || text.toLowerCase().includes(scenarioId.toLowerCase()))
        && text.toLowerCase().includes(expectedErrorTextLower));
    const activeViewError = expectedActiveViewError;
    const errorSurfaceScope = expectedActiveViewError
      ? 'active-view'
      : matchingErrorNotice ? 'requested-file-matched-notice' : 'none';
    const explicitErrorSurface = expectedActiveViewError || matchingErrorNotice;
    const emptyErrorOutcome = scenarioExpectsVisibleError
      && explicitErrorSurface
      && groupRecords.length === 0
      && freshSweepUniquePaths.length === 0
      && allUnmappedVisiblePathCandidates.length === 0
      && freshSweepUnmappedRowSamples === 0
      && unresolvedPreSweepRowCandidates.length === 0
      && occludedKanbanDomCandidates.length === 0
      && (layout === 'kanban' ? kanbanContainers.length === 0 : tableRoots.length === 0);
    const emptyTableOutcome = layout === 'table'
      && !scenarioExpectsVisibleError
      && zeroResultOutcomeClassification !== null
      && view?.getViewType?.() === 'bases'
      && view?.file?.path === requestedPath
      && visibleTableShells.length === 1
      && resultCount === 0
      && freshSweepPositions > 0
      && freshSweepCoverageComplete
      && freshSweepUniquePaths.length === 0
      && freshSweepUnmappedPathSamples === 0
      && freshSweepUnmappedRowSamples === 0
      && groupRecords.length === 0
      && ungroupedVisibleFilePaths.length === 0
      && unassignedVisibleFilePaths.length === 0
      && allUnmappedVisiblePathCandidates.length === 0
      && unresolvedPreSweepRowCandidates.length === 0
      && visibleErrorTexts.length === 0
      && !notices.some((text) => errorSpecificPattern.test(text));
    const ambiguityReasons = [];
    const kanbanRenderedCountEvidence = [];
    if ((layout === 'table' || layout === 'kanban') && !selectedResultRoot && !explicitErrorSurface) {
      ambiguityReasons.push('Expected exactly one visible result root for the loaded Bases view, found ' + visibleResultRoots.length + '.');
    }
    if (resultCount === null && selectedResultRoot && !explicitErrorSurface) {
      ambiguityReasons.push('No visible result count was structurally scoped to the selected result root and its meaningful shared container.');
    }
    if (layout === 'kanban' && kanbanContainers.length > 1) {
      ambiguityReasons.push('Expected at most one Kanban container under the active view, found ' + kanbanContainers.length + '.');
    }
    if (layout === 'kanban' && !emptyErrorOutcome && kanbanContainers.length !== 1) {
      ambiguityReasons.push('Expected exactly one loaded Kanban container, found ' + kanbanContainers.length + '.');
    }
    if (groupRecords.some((group) => !group.heading_text)) ambiguityReasons.push('A visible group marker has no extractable heading text.');
    if (allUnmappedVisiblePathCandidates.length > 0) ambiguityReasons.push('One or more visible file-link candidates could not be mapped to a unique fixture path.');
    if (unresolvedPreSweepRowCandidates.length > 0) ambiguityReasons.push('One or more preliminary visible data rows could not be reconciled with a complete, unique fresh-sweep result and stable group ownership.');
    if (unassignedVisibleFilePaths.length > 0) ambiguityReasons.push('One or more visible fixture file links could not be assigned to a group or an ungrouped view.');
    const unreconciledUnownedKanbanObservations = reconciledUnownedResultObservations
      .filter((observation) => observation.reconciled_to_one_stable_owner !== true);
    if (layout === 'kanban' && unreconciledUnownedKanbanObservations.length > 0) {
      ambiguityReasons.push('One or more Kanban cards with a partially clipped or missing heading observation could not be reconciled to exactly one stable painted heading owner: '
        + JSON.stringify(unreconciledUnownedKanbanObservations.slice(0, 12)));
    }
    if (layout === 'kanban' && freshSweepUniquePaths.length > 0 && groupRecords.length === 0 && !emptyErrorOutcome) {
      ambiguityReasons.push('The Kanban view rendered fixture files without detectable group headings.');
    }
    if (layout === 'kanban' && !emptyErrorOutcome) {
      for (const columnOrdinal of freshSweepPaintedKanbanColumnOrdinals) {
        const column = rawKanbanColumns[columnOrdinal];
        const headings = groupRecords.filter((group) => group.marker.column === column);
        if (headings.length !== 1) {
          ambiguityReasons.push('A painted Kanban column must have exactly one visible group heading; found ' + headings.length + '.');
        }
      }
      for (const group of groupRecords) {
        if (!freshSweepPaintedKanbanColumnOrdinals.has(rawKanbanColumns.indexOf(group.marker.column))) {
          ambiguityReasons.push('Visible Kanban heading ' + JSON.stringify(group.heading_text) + ' has no uniquely painted column.');
        }
      }
      const countSampleLimit = maximumFreshSweepPositions;
      if (groupRecords.length > countSampleLimit) {
        ambiguityReasons.push('Kanban rendered-count verification is bounded to ' + countSampleLimit
          + ' headings, but the view has ' + groupRecords.length + '.');
      }
      for (let groupIndex = 0; groupIndex < groupRecords.length; groupIndex += 1) {
        const group = groupRecords[groupIndex];
        const headingElement = group.marker.element;
        const originalColumn = headingElement?.closest('.bases-kanban-column') ?? null;
        const originalHeader = headingElement?.closest('.bases-kanban-column-header') ?? null;
        const originalColumnOrdinal = rawKanbanColumns.indexOf(originalColumn);
        const capturedColumnOrdinal = rawKanbanColumns.indexOf(group.marker.column);
        if (groupIndex >= countSampleLimit) {
          kanbanRenderedCountEvidence.push({
            group_key: group.key,
            heading_text: group.heading_text,
            column_ordinal: originalColumnOrdinal,
            captured_column_ordinal: capturedColumnOrdinal,
            expected_count: group.member_paths.length,
            sampled: false,
            sample_limit: countSampleLimit,
            accepted: false,
          });
          continue;
        }
        const headingScrollSucceeded = await scrollIntoView(headingElement);
        const headingBounds = headingElement?.getBoundingClientRect();
        const headingText = textOf(headingElement);
        const headingVisible = Boolean(headingElement && visible(headingElement));
        const headingPainted = Boolean(headingScrollSucceeded && headingVisible && hitTestPaintedText(headingElement));
        const headingScrollPositions = headingElement ? readScrollPositions(headingElement) : [];
        const columnAfterHeading = headingElement?.closest('.bases-kanban-column') ?? null;
        const headerAfterHeading = headingElement?.closest('.bases-kanban-column-header') ?? null;
        const headerCountElements = headerAfterHeading
          ? [...headerAfterHeading.querySelectorAll('.bases-kanban-column-count')]
          : [];
        const countElement = headerCountElements.length === 1 ? headerCountElements[0] : null;
        const countScrollSucceeded = await scrollIntoView(countElement);
        const column = headingElement?.closest('.bases-kanban-column') ?? null;
        const headerElement = headingElement?.closest('.bases-kanban-column-header') ?? null;
        const countElements = column ? [...column.querySelectorAll('.bases-kanban-column-count')] : [];
        const currentHeaderCountElements = headerElement
          ? [...headerElement.querySelectorAll('.bases-kanban-column-count')]
          : [];
        const countText = textOf(countElement);
        const declaredCount = /^\\d+$/.test(countText) ? Number(countText) : null;
        const countVisible = Boolean(countScrollSucceeded && countElement && visible(countElement));
        const countPainted = Boolean(countVisible && hitTestPaintedText(countElement));
        const countScrollPositions = countElement ? readScrollPositions(countElement) : [];
        const columnOrdinal = rawKanbanColumns.indexOf(column);
        const headingColumnOrdinal = rawKanbanColumns.indexOf(columnAfterHeading);
        const headingInHeader = Boolean(headerElement && headingElement && headerElement.contains(headingElement));
        const countNodeOwnershipStable = Boolean(countElement
          && countElement.isConnected
          && currentHeaderCountElements.length === 1
          && currentHeaderCountElements[0] === countElement
          && countElement.closest('.bases-kanban-column') === column
          && countElement.closest('.bases-kanban-column-header') === headerElement
          && headerElement?.contains(countElement));
        const headingIdentityAfterSampling = headingElement ? headingBaseIdentity(headingElement) : '';
        const headingIdentityStable = headingIdentityAfterSampling === group.base_identity;
        const columnIdentityAmbiguous = !headingElement?.isConnected
          || originalColumnOrdinal < 0
          || columnOrdinal !== originalColumnOrdinal
          || headingColumnOrdinal !== originalColumnOrdinal
          || originalColumnOrdinal !== capturedColumnOrdinal
          || !originalColumn?.isConnected
          || !originalHeader?.isConnected
          || column !== originalColumn
          || headerAfterHeading !== originalHeader
          || headerElement !== originalHeader
          || !column?.isConnected
          || !headerElement?.isConnected
          || !column.contains(headingElement)
          || !headingInHeader
          || !headingIdentityStable;
        const countMismatch = declaredCount === null
          || declaredCount !== group.member_paths.length
          || !countVisible
          || !countPainted
          || !countNodeOwnershipStable;
        const countBounds = countElement?.getBoundingClientRect();
        kanbanRenderedCountEvidence.push({
          group_key: group.key,
          heading_text: group.heading_text,
          column_ordinal: columnOrdinal,
          captured_column_ordinal: capturedColumnOrdinal,
          sampled: true,
          column_connected: Boolean(column?.isConnected),
          header_connected: Boolean(headerElement?.isConnected),
          heading_in_header: headingInHeader,
          heading_identity_stable: headingIdentityStable,
          heading_sample: {
            scroll_succeeded: headingScrollSucceeded,
            text: headingText,
            bounds: headingBounds ? {
              top: headingBounds.top,
              left: headingBounds.left,
              width: headingBounds.width,
              height: headingBounds.height,
            } : null,
            visible: headingVisible,
            painted: headingPainted,
            scroll_positions: headingScrollPositions,
          },
          count_descendant_count: countElements.length,
          header_count_descendant_count: headerCountElements.length,
          count_scroll_succeeded: countScrollSucceeded,
          count_visible: countVisible,
          count_painted: countPainted,
          count_node_ownership_stable: countNodeOwnershipStable,
          count_scroll_positions: countScrollPositions,
          selected_count_element: countElement && countBounds ? {
            tag_name: countElement.tagName.toLowerCase(),
            class_name: countElement.getAttribute('class') || '',
            text: countText,
            bounds: {
              top: countBounds.top,
              left: countBounds.left,
              width: countBounds.width,
              height: countBounds.height,
            },
          } : null,
          expected_count: group.member_paths.length,
          observed_count: declaredCount,
          accepted: headingPainted && !columnIdentityAmbiguous && !countMismatch,
        });
        if (!headingPainted || columnIdentityAmbiguous || countMismatch) {
          const columnHeaderText = textOf(headerElement);
          const failureReasons = [];
          if (!headingPainted) failureReasons.push('owning heading was not visible and painted at its sampled scroll position');
          if (columnIdentityAmbiguous) failureReasons.push('owning column identity was ambiguous');
          if (countMismatch) {
            failureReasons.push('card count expected ' + group.member_paths.length
              + ' but observed ' + JSON.stringify(countText)
              + ' (scroll=' + countScrollSucceeded
              + ', visible=' + countVisible
              + ', painted=' + countPainted
              + ', ownership_stable=' + countNodeOwnershipStable + ')');
          }
          ambiguityReasons.push('Kanban group ' + JSON.stringify(group.heading_text)
            + ' failed rendered-column validation: ' + failureReasons.join('; ')
            + ' (column ordinal ' + columnOrdinal
            + ', heading column ordinal ' + headingColumnOrdinal
            + ', captured column ordinal ' + capturedColumnOrdinal
            + ', count descendants ' + countElements.length
            + ', header count descendants ' + headerCountElements.length
            + ', count element ' + JSON.stringify(countElement ? {
              tag_name: countElement.tagName.toLowerCase(),
              class_name: countElement.getAttribute('class') || '',
              text: textOf(countElement),
              bounds: countBounds ? {
                top: countBounds.top,
                left: countBounds.left,
                width: countBounds.width,
                height: countBounds.height,
              } : null,
            } : null)
            + ', header ' + JSON.stringify(columnHeaderText)
            + ', column connected ' + Boolean(column?.isConnected)
            + ', header connected ' + Boolean(headerElement?.isConnected)
            + ', heading in header ' + headingInHeader
            + ', heading contained ' + Boolean(column && headingElement && column.contains(headingElement)) + ').');
        }
      }
    }
    if (layout === 'table' && groupByProperty && freshSweepUniquePaths.length > 0
      && groupRecords.length === 0 && !emptyErrorOutcome) {
      ambiguityReasons.push('A grouped table rendered fixture files without detectable group headings.');
    }
    if (scenarioExpectsVisibleError && !explicitErrorSurface) {
      ambiguityReasons.push('The scenario expected a visible error surface, but none was observed.');
    }
    if (freshSweepPositions === 0 && !explicitErrorSurface) {
      ambiguityReasons.push('No fresh result DOM sweep positions were sampled.');
    }
    if (!freshSweepCoverageComplete) {
      ambiguityReasons.push('The fresh DOM sweep exceeded its bounded scroll-position budget before coverage completed.');
    }
    if (resultCount !== null && freshSweepUniquePaths.length !== resultCount) {
      ambiguityReasons.push('Freshly swept unique fixture paths did not match the reported Bases result count.');
    }
    if (freshSweepUnmappedPathSamples > 0) {
      ambiguityReasons.push('The fresh DOM sweep found one or more painted result candidates that did not map to a unique fixture path.');
    }
    if (freshSweepDuplicatePathSamples > 0) {
      ambiguityReasons.push('The fresh DOM sweep found duplicate fixture paths at one or more scroll positions.');
    }
    if (freshSweepUnmappedRowSamples > 0) {
      ambiguityReasons.push('The fresh DOM sweep found one or more painted result rows without a mapped path candidate.');
    }
    if (layout === 'table' && groupByProperty && freshSweepUnresolvedGroupOwnerPaths.length > 0) {
      ambiguityReasons.push('The exhaustive fresh sweep did not reconcile every grouped table result to exactly one owner section: '
        + JSON.stringify(freshSweepUnresolvedGroupOwnerPaths.slice(0, 24)) + '.');
    }
    if (layout === 'table' && groupByProperty && freshSweepUnpaintedTableSectionKeys.length > 0) {
      ambiguityReasons.push('One or more structural table sections never had a painted heading observation: '
        + JSON.stringify(freshSweepUnpaintedTableSectionKeys.slice(0, 24)) + '.');
    }
    if (freshSweepTableSectionReconciliationAmbiguous) {
      ambiguityReasons.push('Repeated or virtualized table sections could not be reconciled to unique logical positions with required DOM continuity evidence: '
        + JSON.stringify(freshSweepTableSectionReconciliationEvidence.slice(0, 12)) + '.');
    }
    if (freshSweepOrderingAmbiguous) {
      ambiguityReasons.push('Fresh DOM sweep positions did not establish one stable DOM or column order for every result and group.');
    }
    if (freshSweepGroupOwnershipAmbiguous) {
      ambiguityReasons.push('Fresh DOM sweep observations assigned one or more results to conflicting groups.');
    }
    if (freshSweepHeadingIdentityAmbiguous && !(layout === 'table' && groupByProperty)) {
      ambiguityReasons.push('Repeated or recycled group headings shared an identity that could not be tracked uniquely across fresh DOM samples.');
    }
    if (blockingNodeIdentityChanges.length > 0) {
      ambiguityReasons.push('One or more result or group nodes changed identity after scrolling.');
    }
    if ((layout === 'table' || layout === 'kanban') && !explicitErrorSurface && resultCount === null) {
      ambiguityReasons.push(resultCountTexts.length > 1
        ? 'The loaded Bases view exposed multiple distinct visible result counts.'
        : 'The loaded Bases view did not expose one visible result count scoped to its result area.');
    }
    if (freshSweepUniquePaths.length === 0 && allUnmappedVisiblePathCandidates.length === 0 && !emptyErrorOutcome && !emptyTableOutcome) {
      ambiguityReasons.push(layout === 'kanban'
        ? 'A C07.3 Kanban scenario rendered no uniquely mapped fixture cards and showed no explicit visible error.'
        : 'A C07.3 scenario rendered no mapped fixture file links and showed no explicit visible error.');
    }
    const diagnosticsElements = root ? [...root.querySelectorAll('[class], [data-group], [role="group"]')].filter(visible) : [];
    const domDiagnostics = diagnosticsElements
      .filter((element) => hasGroupMarker(element) || /card|kanban|table|row/i.test(element.getAttribute('class') || ''))
      .slice(0, 160)
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        const kanbanCandidate = layout === 'kanban' && element.matches('.bases-group-heading, .bases-kanban-card');
        return {tag: element.tagName.toLowerCase(), class_name: element.getAttribute('class') || '', role: element.getAttribute('role'), text: textOf(element).slice(0, 240), top: bounds.top, left: bounds.left, ...(kanbanCandidate ? {painted: element.matches('.bases-group-heading') ? hitTestPaintedText(element) : hitTestPainted(element)} : {})};
      });
    const visibleFixturePathLinks = pathLinks.map((link) => ({
      path: link.path,
      text: link.text,
      class_name: link.class_name,
      source_scope: link.source_scope,
      top: link.top,
      left: link.left,
      visibility_sample_sequence: link.visibility_sample_sequence,
      visibility_sample_bounds: link.visibility_sample_bounds,
      scroll_positions: link.scroll_positions,
      result_order_ordinal: link.result_order_ordinal,
      group_heading: groupRecords.find((group) => group.key === link.group_key)?.heading_text ?? null,
      group_keys: link.group_keys,
      column_ordinal: link.column_ordinal,
      fresh_sweep_observation_count: link.observations.length,
      ...(link.title_hit_diagnostics ? {title_hit_diagnostics: link.title_hit_diagnostics} : {}),
    }));
    return {
      requested_file_path: requestedPath,
      selection_succeeded: view?.file?.path === requestedPath,
      active_file_path: view?.file?.path ?? null,
      active_view_type: view?.getViewType?.() ?? null,
      title: document.title,
      body: body.slice(0, 10_000),
      result_count: resultCount,
      result_count_texts: resultCountTexts,
      result_count_evidence: resultCountEvidence,
      kanban_rendered_count_evidence: kanbanRenderedCountEvidence,
      zero_result_outcome_classification: zeroResultOutcomeClassification,
      viewport,
      visibility_sampling: {
        scroll_actions: scrollActions,
        path_candidates: retainedCandidates.length,
        painted_path_candidates: retainedCandidates.filter((entry) => paintedPathCandidateElements.has(entry.element)).length,
        group_markers: rawMarkerElements.length,
        painted_group_markers: markerElements.length,
        data_rows: rowCandidates.length,
        painted_data_rows: visibleRowElements.length,
        fresh_sweep_positions: freshSweepPositions,
        fresh_sweep_coverage_complete: freshSweepCoverageComplete,
        fresh_sweep_path_samples: freshSweepPathSamples,
        fresh_sweep_unique_paths: freshSweepUniquePaths,
        fresh_sweep_ordered_paths: freshSweepOrderedPaths,
        fresh_sweep_result_membership: pathLinks.map((link) => ({
          path: link.path,
          result_order_ordinal: link.result_order_ordinal,
          group_keys: link.group_keys,
          column_ordinal: link.column_ordinal,
          observation_count: link.observations.length,
        })),
        fresh_sweep_result_count_matches: resultCount === null ? null : freshSweepUniquePaths.length === resultCount,
        fresh_sweep_heading_samples: freshSweepHeadingSamples,
        fresh_sweep_unique_headings: freshSweepUniqueHeadings,
        fresh_sweep_ordered_headings: freshSweepOrderedHeadings,
        fresh_sweep_heading_identity_ambiguous: freshSweepHeadingIdentityAmbiguous,
        fresh_sweep_heading_collision_base_count: freshSweepHeadingCollisionBases.size,
        fresh_sweep_heading_identity_collisions: freshSweepHeadingIdentityCollisionEvidence,
        fresh_sweep_unmapped_path_samples: freshSweepUnmappedPathSamples,
        fresh_sweep_unmapped_row_samples: freshSweepUnmappedRowSamples,
        fresh_sweep_unmapped_rows: freshSweepUnmappedRows.slice(0, 80),
        fresh_sweep_unmapped_candidates: freshSweepUnmappedCandidates.slice(0, 80),
        fresh_sweep_unowned_result_samples: freshSweepUnownedResultSamples,
        fresh_sweep_unowned_result_observations: reconciledUnownedResultObservations.slice(0, 160),
        fresh_sweep_unresolved_group_owner_paths: freshSweepUnresolvedGroupOwnerPaths,
        fresh_sweep_resolved_table_sections: freshSweepOrderedTableSectionKeys.map((key, index) => {
          const section = freshSweepResolvedTableSections.get(key);
          return {
            key,
            index,
            heading_text: section.heading_text,
            heading_class_name: section.heading_class_name,
            logical_position: section.logical_position,
            section_root_tag: section.section_root_tag,
            section_root_class_name: section.section_root_class_name,
            sample_count: section.samples.size,
            member_paths: [...section.member_paths].sort(),
            local_section_count: section.local_keys.length,
            local_section_keys: section.local_keys,
            samples: [...section.samples].sort((left, right) => left - right),
            painted_observation_count: section.painted_observation_count,
            painted_sample_sequences: [...section.painted_sample_sequences].sort((left, right) => left - right),
          };
        }),
        fresh_sweep_table_section_observations: [...freshSweepTableSections.values()].map((section) => ({
          local_key: section.key,
          sample: section.sample,
          local_order: section.local_order,
          heading_text: section.heading_text,
          heading_class_name: section.heading_class_name,
          section_root_tag: section.section_root_tag,
          section_root_class_name: section.section_root_class_name,
          logical_position: section.logical_position,
          member_paths: [...section.member_paths].sort(),
          painted: section.painted_observation_count > 0,
        })),
        fresh_sweep_table_section_accepted_reconciliation_evidence: freshSweepTableSectionAcceptedReconciliationEvidence,
        fresh_sweep_table_section_accepted_reconciliation_evidence_truncated: freshSweepTableSectionAcceptedReconciliationEvidenceTruncated,
        fresh_sweep_table_section_reconciliation_evidence: freshSweepTableSectionReconciliationEvidence,
        fresh_sweep_table_section_snapshot_orders: [...freshSweepTableSectionSnapshotOrders.entries()].map(([sample, mappings]) => ({
          sample,
          ordered_global_section_keys: mappings.map((mapping) => mapping.global_key),
          local_to_global_sections: mappings,
        })),
        fresh_sweep_table_section_reconciliation_ambiguous: freshSweepTableSectionReconciliationAmbiguous,
        fresh_sweep_dom_object_id_scope: 'one-visible-state-page-evaluation',
        fresh_sweep_unpainted_table_section_keys: freshSweepUnpaintedTableSectionKeys,
        fresh_sweep_duplicate_path_samples: freshSweepDuplicatePathSamples,
        fresh_sweep_ordering_ambiguous: freshSweepOrderingAmbiguous,
        fresh_sweep_group_ownership_ambiguous: freshSweepGroupOwnershipAmbiguous,
        fresh_sweep_painted_kanban_column_ordinals: [...freshSweepPaintedKanbanColumnOrdinals].sort((left, right) => left - right),
        fresh_sweep_scroll_offsets: freshSweepOffsets,
        node_identity_change_count: nodeIdentityChanges.length,
        blocking_node_identity_change_count: blockingNodeIdentityChanges.length,
        node_identity_change_examples: nodeIdentityChanges.slice(0, 30),
        blocking_node_identity_change_examples: blockingNodeIdentityChanges.slice(0, 30),
      },
      pre_sweep_unmapped_visible_row_candidates: preSweepUnmappedVisibleRowCandidates,
      pre_sweep_row_reconciliation: {
        fresh_sweep_evidence_eligible: freshSweepEvidenceEligibleForPreSweepRows,
        resolved_candidates: resolvedPreSweepRowCandidates,
        unresolved_candidates: unresolvedPreSweepRowCandidates,
      },
      groups: groupRecords.map(({index, heading_text, heading_class_name, heading_bounds, heading_visibility_sample, member_paths}) => ({
        index,
        heading_text,
        heading_class_name,
        heading_bounds,
        heading_visibility_sample,
        member_paths,
      })),
      ungrouped_visible_file_paths: ungroupedVisibleFilePaths,
      unassigned_visible_file_paths: unassignedVisibleFilePaths,
      visible_fixture_path_links: visibleFixturePathLinks,
      mapped_visible_row_path_candidates: mappedVisibleRowPathCandidates,
      unmapped_visible_path_candidates: allUnmappedVisiblePathCandidates,
      unmapped_visible_row_candidates: [...unresolvedPreSweepRowCandidates, ...freshSweepUnmappedRows],
      visible_group_marker_count: freshSweepHeadingKeys.size,
      unmapped_group_marker_count: groupRecords.filter((group) => !group.heading_text).length,
      occluded_kanban_dom_candidates: occludedKanbanDomCandidates,
      visible_error_texts: visibleErrorTexts,
      notices,
      explicit_error_surface: explicitErrorSurface,
      error_surface_scope: errorSurfaceScope,
      dom_diagnostics: domDiagnostics,
      extraction_ambiguous: ambiguityReasons.length > 0,
      ambiguity_reasons: ambiguityReasons,
    };
  })()`, `C07.3 full visible-state extraction for ${scenario.id}`);
  if (!visibleState || !Array.isArray((visibleState as GroupOrderVisibleState).groups)) {
    throw new Error(`C07.3 visible-state extraction returned no group array for ${scenario.id}: ${JSON.stringify(visibleState).slice(0, 2_000)}`);
  }
  return visibleState;
}

async function readGroupOrderMinimalRendererState(
  connection: DevToolsConnection,
  requestedPath: string,
): Promise<GroupOrderMinimalRendererState> {
  return await connection.evaluateJson<GroupOrderMinimalRendererState>(`(() => {
    const root = document.querySelector('.workspace-leaf.mod-active') ?? document.body;
    const state = {
      requested_file_path: ${JSON.stringify(requestedPath)},
      active_file_path: null,
      active_view_type: null,
      title: document.title || '',
      body: String(root?.innerText ?? '').slice(0, 4_000),
    };
    try {
      const view = window.app?.workspace?.activeLeaf?.view;
      state.active_file_path = typeof view?.file?.path === 'string' ? view.file.path : null;
      state.active_view_type = typeof view?.getViewType === 'function' ? view.getViewType() : null;
    } catch (error) {
      state.view_access_error = String(error && (error.stack || error.message || error));
    }
    return state;
  })()`, `C07.3 minimal renderer-state probe for ${requestedPath}`);
}

function emptyGroupOrderVisibleState(scenario: GroupOrderScenario): GroupOrderVisibleState {
  return {
    requested_file_path: scenario.base_path,
    selection_succeeded: false,
    active_file_path: null,
    active_view_type: null,
    title: "",
    body: "",
    result_count: null,
    result_count_texts: [],
    result_count_evidence: [],
    kanban_rendered_count_evidence: [],
    zero_result_outcome_classification: null,
    viewport: {width: 0, height: 0, available_width: 0, available_height: 0},
    visibility_sampling: {
      scroll_actions: 0,
      path_candidates: 0,
      painted_path_candidates: 0,
      group_markers: 0,
      painted_group_markers: 0,
      data_rows: 0,
      painted_data_rows: 0,
      fresh_sweep_positions: 0,
      fresh_sweep_coverage_complete: false,
      fresh_sweep_path_samples: 0,
      fresh_sweep_unique_paths: [],
      fresh_sweep_ordered_paths: [],
      fresh_sweep_result_membership: [],
      fresh_sweep_result_count_matches: null,
      fresh_sweep_heading_samples: 0,
      fresh_sweep_unique_headings: [],
      fresh_sweep_ordered_headings: [],
      fresh_sweep_heading_identity_ambiguous: false,
      fresh_sweep_heading_collision_base_count: 0,
      fresh_sweep_heading_identity_collisions: [],
      fresh_sweep_unmapped_path_samples: 0,
      fresh_sweep_unmapped_row_samples: 0,
      fresh_sweep_unmapped_rows: [],
      fresh_sweep_unmapped_candidates: [],
      fresh_sweep_unowned_result_samples: 0,
      fresh_sweep_unowned_result_observations: [],
      fresh_sweep_unresolved_group_owner_paths: [],
      fresh_sweep_resolved_table_sections: [],
      fresh_sweep_table_section_observations: [],
      fresh_sweep_table_section_accepted_reconciliation_evidence: [],
      fresh_sweep_table_section_accepted_reconciliation_evidence_truncated: false,
      fresh_sweep_table_section_reconciliation_evidence: [],
      fresh_sweep_table_section_snapshot_orders: [],
      fresh_sweep_table_section_reconciliation_ambiguous: false,
      fresh_sweep_dom_object_id_scope: "not-captured",
      fresh_sweep_unpainted_table_section_keys: [],
      fresh_sweep_duplicate_path_samples: 0,
      fresh_sweep_ordering_ambiguous: false,
      fresh_sweep_group_ownership_ambiguous: false,
      fresh_sweep_painted_kanban_column_ordinals: [],
      fresh_sweep_scroll_offsets: [],
      node_identity_change_count: 0,
      blocking_node_identity_change_count: 0,
      node_identity_change_examples: [],
      blocking_node_identity_change_examples: [],
    },
    groups: [],
    ungrouped_visible_file_paths: [],
    unassigned_visible_file_paths: [],
    visible_fixture_path_links: [],
    mapped_visible_row_path_candidates: [],
    pre_sweep_unmapped_visible_row_candidates: [],
    pre_sweep_row_reconciliation: {
      fresh_sweep_evidence_eligible: false,
      resolved_candidates: [],
      unresolved_candidates: [],
    },
    unmapped_visible_path_candidates: [],
    unmapped_visible_row_candidates: [],
    visible_group_marker_count: 0,
    unmapped_group_marker_count: 0,
    occluded_kanban_dom_candidates: [],
    visible_error_texts: [],
    notices: [],
    explicit_error_surface: false,
    error_surface_scope: "none",
    dom_diagnostics: [],
    extraction_ambiguous: false,
    ambiguity_reasons: [],
  };
}

function hasExplicitVisibleGroupOrderParseError(state: GroupOrderVisibleState): boolean {
  return state.explicit_error_surface;
}

async function captureGroupOrderScenario(
  connection: DevToolsConnection,
  scenario: GroupOrderScenario,
  fixturePaths: string[],
  stage: "first-open" | "reopen",
): Promise<GroupOrderScenarioObservation> {
  let visible = emptyGroupOrderVisibleState(scenario);
  const stateSamples: GroupOrderScenarioObservation["state_samples"] = [];
  let stateSettled = false;
  let screenshot: string | null = null;
  let screenshotError: string | undefined;
  let probeError: string | undefined;
  let probePhase: string | undefined;
  let viewportPreparation: GroupOrderViewportPreparation | null = null;
  let retryProbeError: string | undefined;
  let minimalRendererState: GroupOrderMinimalRendererState | undefined;
  let minimalRendererStateError: string | undefined;
  let targetSelectionMode: GroupOrderScenarioObservation["target_selection_mode"] = "visible-tree-selected";
  const recordState = (state: GroupOrderVisibleState): void => {
    const sample: GroupOrderScenarioObservation["state_samples"][number] = {
      active_file_path: state.active_file_path,
      active_view_type: state.active_view_type,
      selection_succeeded: state.selection_succeeded,
      body: state.body.slice(0, 10_000),
      result_count: state.result_count,
      result_count_texts: state.result_count_texts,
      result_count_evidence: state.result_count_evidence,
      kanban_rendered_count_evidence: state.kanban_rendered_count_evidence,
      zero_result_outcome_classification: state.zero_result_outcome_classification,
      viewport: state.viewport,
      visibility_sampling: state.visibility_sampling,
      viewport_preparation: viewportPreparation,
      groups: state.groups,
      ungrouped_visible_file_paths: state.ungrouped_visible_file_paths,
      unassigned_visible_file_paths: state.unassigned_visible_file_paths,
      mapped_visible_row_path_candidates: state.mapped_visible_row_path_candidates,
      unmapped_visible_path_candidates: state.unmapped_visible_path_candidates,
      unmapped_visible_row_candidates: state.unmapped_visible_row_candidates,
      occluded_kanban_dom_candidates: state.occluded_kanban_dom_candidates,
      visible_error_texts: state.visible_error_texts,
      notices: state.notices,
      explicit_error_surface: state.explicit_error_surface,
      error_surface_scope: state.error_surface_scope,
    };
    if (stateSamples.length === 0 || !isDeepStrictEqual(stateSamples[stateSamples.length - 1], sample)) {
      stateSamples.push(sample);
    }
  };
  const captureScreenshot = async (): Promise<void> => {
    screenshot = `obsidian-group-order-${stage}-${scenario.id.replaceAll(/[^a-z0-9-]/gi, "-")}.png`;
    try {
      await captureObsidianScreenshot(connection, screenshot);
    } catch (error) {
      screenshotError = error instanceof Error ? error.message : String(error);
      screenshot = null;
    }
  };

  try {
    probePhase = "inspect-active-target";
    try {
      minimalRendererState = await readGroupOrderMinimalRendererState(connection, scenario.base_path);
    } catch (stateProbeError) {
      minimalRendererStateError = stateProbeError instanceof Error ? stateProbeError.message : String(stateProbeError);
    }
    const targetAlreadyActive = stage === "reopen"
      && Boolean(minimalRendererState
        && minimalRendererState.active_file_path === scenario.base_path
        && minimalRendererState.active_view_type === "bases");
    if (targetAlreadyActive) targetSelectionMode = "active-target-reused";
    if (!targetAlreadyActive) {
      probePhase = "list-visible-vault-paths";
      const listVisiblePaths = async (): Promise<string[]> => await connection.evaluateJson<string[]>(`(() => {
      const visible = (element) => {
        const bounds = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0;
      };
      return [...document.querySelectorAll('[data-path]')]
        .filter(visible)
        .map((element) => element.getAttribute('data-path') || '')
        .filter(Boolean);
      })()`, "C07.3 visible vault-path list");
      let visiblePaths = await listVisiblePaths();
      if (!visiblePaths.includes(scenario.base_path)) {
        probePhase = "expand-target-folder";
        const parentPath = scenario.base_path.split("/").slice(0, -1).join("/");
        await connection.evaluateJson<boolean>(`(() => {
        const targetPath = ${JSON.stringify(parentPath)};
        const visible = (element) => {
          const bounds = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0;
        };
        const folder = [...document.querySelectorAll('[data-path]')]
          .find((element) => element.getAttribute('data-path') === targetPath
            && visible(element)
            && (element.classList.contains('nav-folder-title') || element.closest('.nav-folder')));
        if (!folder) return false;
        const collapsed = folder.classList.contains('is-collapsed')
          || folder.getAttribute('aria-expanded') === 'false'
          || folder.closest('.nav-folder')?.classList.contains('is-collapsed');
        if (collapsed) folder.click();
        return true;
        })()`, "C07.3 expand target folder");
        probePhase = "wait-for-target-file";
        visiblePaths = await waitFor(
          `${stage}: Obsidian to list ${scenario.base_path}`,
          listVisiblePaths,
          (paths) => paths.includes(scenario.base_path),
          30_000,
        );
      }
      if (!visiblePaths.includes(scenario.base_path)) {
        throw new Error(`${stage}: Obsidian did not list the exact C07.3 target ${scenario.base_path}`);
      }
      probePhase = "select-target-base";
      const clicked = await connection.evaluateJson<boolean>(`(() => {
      const path = ${JSON.stringify(scenario.base_path)};
      const visible = (element) => {
        const bounds = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0;
      };
      const candidates = [...document.querySelectorAll('[data-path]')]
        .filter((element) => element.getAttribute('data-path') === path && visible(element));
      const target = candidates.find((element) => element.classList.contains('nav-file-title')
        || element.closest('.nav-file')) || candidates[0];
      target?.click();
      return Boolean(target);
      })()`, "C07.3 select target .base");
      if (!clicked) throw new Error(`${stage}: Obsidian did not expose ${scenario.base_path} for selection`);
    }

    probePhase = "prepare-full-results-viewport";
    viewportPreparation = await connection.evaluateJson<GroupOrderViewportPreparation>(`(() => {
      const leftSplit = window.app?.workspace?.leftSplit;
      if (!leftSplit || typeof leftSplit.collapse !== 'function') {
        return {
          left_sidebar_collapsed: false,
          requested_width: 0,
          requested_height: 0,
          actual_width: window.innerWidth,
          actual_height: window.innerHeight,
          actual_outer_width: window.outerWidth,
          actual_outer_height: window.outerHeight,
        };
      }
      if (!leftSplit.collapsed) leftSplit.collapse();
      const requestedWidth = Number(window.screen?.availWidth ?? window.innerWidth);
      const requestedHeight = Number(window.screen?.availHeight ?? window.innerHeight);
      if (requestedWidth > window.outerWidth || requestedHeight > window.outerHeight) {
        window.resizeTo(requestedWidth, requestedHeight);
      }
      return {
        left_sidebar_collapsed: Boolean(leftSplit.collapsed),
        requested_width: requestedWidth,
        requested_height: requestedHeight,
        actual_width: window.innerWidth,
        actual_height: window.innerHeight,
        actual_outer_width: window.outerWidth,
        actual_outer_height: window.outerHeight,
      };
    })()`, "C07.3 prepare Bases observation viewport");
    if (!viewportPreparation.left_sidebar_collapsed) {
      throw new Error(`${stage}: could not collapse Obsidian's left sidebar before the complete-results capture; requested viewport=${viewportPreparation.requested_width}x${viewportPreparation.requested_height}`);
    }
    await delay(500);
    const actualViewport = await connection.evaluateJson<Pick<GroupOrderViewportPreparation, "actual_width" | "actual_height" | "actual_outer_width" | "actual_outer_height">>(`({
      actual_width: window.innerWidth,
      actual_height: window.innerHeight,
      actual_outer_width: window.outerWidth,
      actual_outer_height: window.outerHeight,
    })`, "C07.3 record prepared viewport dimensions");
    viewportPreparation = {...viewportPreparation, ...actualViewport};

    let stableFingerprint = "";
    let stableSamples = 0;
    const settleDeadline = Date.now() + 45_000;
    probePhase = "settle-and-extract-visible-state";
    while (Date.now() < settleDeadline) {
      await delay(500);
      const next = await readGroupOrderVisibleState(connection, scenario, fixturePaths);
      visible = next;
      recordState(next);
      const nextFingerprint = JSON.stringify(next);
      if (next.selection_succeeded && nextFingerprint === stableFingerprint) {
        stableSamples += 1;
      } else {
        stableFingerprint = nextFingerprint;
        stableSamples = 0;
      }
      if (stableSamples >= 3) break;
    }
    stateSettled = stableSamples >= 3;
    probePhase = "validate-captured-state";
    if (visible.active_file_path !== scenario.base_path || !visible.selection_succeeded) {
      throw new Error(`${stage}: the exact .base was not active after selection; state=${JSON.stringify(visible).slice(0, 8_000)}`);
    }
    if (visible.active_view_type !== "bases"
        && !(scenario.expected_error_outcome === "visible-error" && hasExplicitVisibleGroupOrderParseError(visible))) {
      throw new Error(`${stage}: the exact .base was not opened as a Bases view and no explicit visible parse/error state was captured; state=${JSON.stringify(visible).slice(0, 8_000)}`);
    }
    if (!stateSettled) {
      throw new Error(`${stage}: selected .base did not reach a stable visible state; samples=${JSON.stringify(stateSamples).slice(0, 8_000)}`);
    }
    if (visible.extraction_ambiguous) {
      throw new Error(`${stage}: visible group or file extraction was ambiguous: ${visible.ambiguity_reasons.join(" ")}`);
    }
    const expectedMappedPaths = visible.visible_fixture_path_links.map((entry) => entry.path).sort();
    const observedMappedPaths = [
      ...visible.groups.flatMap((group) => group.member_paths),
      ...visible.ungrouped_visible_file_paths,
    ].sort();
    if (!isDeepStrictEqual(expectedMappedPaths, observedMappedPaths)) {
      throw new Error(`${stage}: visible fixture file links were not completely mapped to group/member order; visible=${JSON.stringify(expectedMappedPaths)} mapped=${JSON.stringify(observedMappedPaths)}`);
    }
  } catch (error) {
    const primaryPhase = probePhase ?? "unknown-capture-phase";
    probeError = error instanceof Error ? error.message : String(error);
    probePhase = primaryPhase;
    try {
      minimalRendererState = await readGroupOrderMinimalRendererState(connection, scenario.base_path);
    } catch (stateProbeError) {
      minimalRendererStateError = stateProbeError instanceof Error ? stateProbeError.message : String(stateProbeError);
    }
    await delay(250);
    try {
      visible = await readGroupOrderVisibleState(connection, scenario, fixturePaths);
      recordState(visible);
    } catch (retryError) {
      retryProbeError = retryError instanceof Error ? retryError.message : String(retryError);
    }
  }

  await captureScreenshot();
  return {
    ...visible,
    ordered_group_headings: visible.groups.map((group) => group.heading_text),
    target_selection_mode: targetSelectionMode,
    error_surface_classification: visible.active_view_type === "bases"
      ? hasExplicitVisibleGroupOrderParseError(visible)
        ? "loaded-bases-view-with-visible-error"
        : "loaded-bases-view"
      : hasExplicitVisibleGroupOrderParseError(visible)
        ? "non-bases-view-with-visible-error"
        : "non-bases-view-without-visible-error",
    body: visible.body.slice(0, 10_000),
    stage,
    state_settled: stateSettled,
    viewport_preparation: viewportPreparation,
    state_samples: stateSamples,
    screenshot,
    ...(screenshotError ? {screenshot_error: screenshotError} : {}),
    ...(probeError ? {probe_error: probeError} : {}),
    ...(probePhase ? {probe_phase: probePhase} : {}),
    ...(retryProbeError ? {probe_retry_error: retryProbeError} : {}),
    ...(minimalRendererState ? {minimal_renderer_state: minimalRendererState} : {}),
    ...(minimalRendererStateError ? {minimal_renderer_state_error: minimalRendererStateError} : {}),
  };
}

async function assertBasesDirectionSourceHashes(
  expected: Record<string, {bytes: number; sha256: string}>,
  stage: string,
  allowKnownReferenceRewrite = false,
  capturedBytes?: Record<string, Buffer>,
  unexpectedMismatches?: string[],
): Promise<Record<string, {bytes: number; sha256: string}>> {
  const observed: Record<string, {bytes: number; sha256: string}> = {};
  for (const [path, baseline] of Object.entries(expected)) {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(basesVaultRoot, path));
    } catch (error) {
      const basesReport = report.bases_group_direction_reference as Record<string, unknown>;
      basesReport.reference_app_source_preservation_passed = false;
      const message = `Could not read C07 source ${path} ${stage}: ${error instanceof Error ? error.message : String(error)}`;
      if (unexpectedMismatches) {
        unexpectedMismatches.push(message);
        continue;
      }
      throw new Error(message);
    }
    if (capturedBytes) capturedBytes[path] = bytes;
    const actual = {
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    observed[path] = actual;
    if (actual.bytes !== baseline.bytes || actual.sha256 !== baseline.sha256) {
      const artifactPath = `bases-direction-source-changed-${stage.replaceAll(/[^a-z0-9-]/gi, "-")}-${basename(path)}`;
      await writeFile(join(reportDirectory, artifactPath), bytes);
      const isKnownReferenceRewrite = allowKnownReferenceRewrite
        && path === "Invalid Direction.base"
        && actual.bytes === normalizedInvalidBasesDirection.length
        && actual.sha256 === normalizedInvalidBasesDirectionSha256
        && bytes.equals(normalizedInvalidBasesDirection);
      if (isKnownReferenceRewrite) continue;
      const basesReport = report.bases_group_direction_reference as Record<string, unknown>;
      basesReport.reference_app_source_preservation_passed = false;
      const mismatch = `Obsidian changed C07 source ${path} ${stage}: expected ${baseline.bytes} bytes / ${baseline.sha256}, got ${actual.bytes} bytes / ${actual.sha256}`;
      if (unexpectedMismatches) {
        unexpectedMismatches.push(mismatch);
        continue;
      }
      throw new Error(mismatch);
    }
  }
  return observed;
}

async function recordBasesDirectionReferenceRewrite(
  expected: Record<string, {bytes: number; sha256: string}>,
  observed: Record<string, {bytes: number; sha256: string}>,
  bytes: Buffer,
  session: "first_open" | "reopen",
  stage: string,
): Promise<boolean> {
  const path = "Invalid Direction.base";
  const baseline = expected[path];
  const actual = observed[path];
  if (actual.bytes === baseline.bytes && actual.sha256 === baseline.sha256) return false;

  if (actual.bytes !== normalizedInvalidBasesDirection.length
    || actual.sha256 !== normalizedInvalidBasesDirectionSha256
    || bytes.length !== actual.bytes
    || createHash("sha256").update(bytes).digest("hex") !== actual.sha256
    || !bytes.equals(normalizedInvalidBasesDirection)) {
    throw new Error(`Pinned Obsidian C07 reference mutation did not match the recorded normalization at ${stage}`);
  }
  const artifactPath = `bases-direction-source-changed-${stage.replaceAll(/[^a-z0-9-]/gi, "-")}-${basename(path)}`;
  const basesReport = report.bases_group_direction_reference as Record<string, unknown>;
  const observations = (basesReport.source_rewrite_observations ?? []) as Array<Record<string, unknown>>;
  const priorObservation = observations.find((item) => {
    const after = item.after as {bytes?: number; sha256?: string} | undefined;
    return item.session === session && item.path === path && after?.sha256 === actual.sha256;
  });
  if (priorObservation) {
    const checkpoints = (priorObservation.checkpoints ?? [priorObservation.first_observed_stage ?? priorObservation.stage]) as string[];
    if (!checkpoints.includes(stage)) checkpoints.push(stage);
    priorObservation.checkpoints = checkpoints;
    await saveReport();
    return true;
  }
  const observation = {
    session,
    first_observed_stage: stage,
    checkpoints: [stage],
    path,
    source_preserved: false,
    before: baseline,
    after: actual,
    exact_bytes: bytes.toString("utf8"),
    artifact: artifactPath,
  };
  observations.push(observation);
  basesReport.source_rewrite_observations = observations;
  basesReport.reference_app_source_preservation_passed = false;
  if (basesReport.source_rewrite_first_detected_at === undefined) {
    basesReport.source_rewrite_first_detected_at = {session, stage, path};
  }
  await saveReport();
  return true;
}

async function createFixture(): Promise<void> {
  await mkdir(join(vaultRoot, "Nested Ω"), {recursive: true});
  await mkdir(join(vaultRoot, "Assets"), {recursive: true});
  await mkdir(join(vaultRoot, ".opaque"), {recursive: true});
  await mkdir(join(vaultRoot, ".obsidian", "themes", "CI Minimal"), {recursive: true});
  await mkdir(join(vaultRoot, ".obsidian", "plugins", "disabled-fixture"), {recursive: true});

  const files: Record<string, Buffer> = {
    [seedMarkdownPath]: Buffer.from(seedMarkdown, "utf8"),
    "Assets/roundtrip image.png": await readFile(resolve("assets/openobsidian-icon.png")),
    ".opaque/unknown.bin": Buffer.from([0x00, 0x7f, 0xff, 0x4f, 0x4f, 0x42, 0x01, 0x02, 0x00, 0x10]),
    ".obsidian/app.json": Buffer.from('{"newFileLocation":"root","defaultViewMode":"source","unknown_roundtrip_setting":{"keep":[true,7,"opaque"]}}\n'),
    ".obsidian/appearance.json": Buffer.from('{"accentColor":"#8b5cf6","unknownAppearanceSetting":"preserve-me"}\n'),
    ".obsidian/community-plugins.json": Buffer.from("[]\n"),
    ".obsidian/themes/CI Minimal/manifest.json": Buffer.from('{"name":"CI Minimal","version":"1.0.0","minAppVersion":"1.0.0","author":"OpenObsidian CI fixture","authorUrl":"","description":"Synthetic, disabled round-trip fixture theme."}\n'),
    ".obsidian/themes/CI Minimal/theme.css": Buffer.from(".theme-dark { --background-primary: #171717; }\n"),
    ".obsidian/plugins/disabled-fixture/manifest.json": Buffer.from('{"id":"disabled-fixture","name":"Disabled fixture data","version":"1.0.0","minAppVersion":"1.0.0","description":"Synthetic disabled fixture; never enabled or executed."}\n'),
    ".obsidian/plugins/disabled-fixture/data.json": Buffer.from('{"unknown_plugin_value":{"keep":"opaque"}}\n'),
    ".obsidian/plugins/disabled-fixture/main.js": Buffer.from("// Deliberately disabled; fixture data only.\n"),
  };
  for (const [path, bytes] of Object.entries(files)) await writeFile(join(vaultRoot, path), bytes);
  const hashes = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }]));
  (report.fixture as Record<string, unknown>).content_hashes = hashes;
  (report.fixture as Record<string, unknown>).provenance = {
    authored_by: "GitHub Actions fixture generator plus pinned Obsidian Desktop UI",
    generator_source_sha: sourceSha,
    reference_app_version: obsidianVersion,
    reference_asset: obsidianAsset,
    reference_asset_sha256: obsidianSha256,
    ...(process.platform === "linux" ? {reference_appimage_sha256: obsidianSha256} : {}),
    source_platform: obsidianSourcePlatform,
    contains_personal_data: false,
    execution_policy: "No local application launch or local validation was used.",
  };
}

async function snapshotTree(root: string): Promise<SnapshotEntry[]> {
  const entries: SnapshotEntry[] = [];
  async function visit(directory: string): Promise<void> {
    const directoryMetadata = await lstat(directory);
    if (!directoryMetadata.isDirectory()) throw new Error(`Source tree directory changed type while snapshotting: ${directory}`);
    const children = await readdir(directory, {withFileTypes: true});
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const child of children) {
      const absolutePath = join(directory, child.name);
      const relativePath = relative(root, absolutePath).split(sep).join("/");
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) {
        const targetBytes = await readlink(absolutePath, {encoding: "buffer"});
        entries.push({
          path: relativePath,
          kind: "symlink",
          target: targetBytes.toString("utf8"),
          target_bytes_base64: targetBytes.toString("base64"),
          target_sha256: createHash("sha256").update(targetBytes).digest("hex"),
        });
      } else if (metadata.isDirectory()) {
        entries.push({path: relativePath, kind: "directory"});
        await visit(absolutePath);
      } else if (metadata.isFile()) {
        const bytes = await readFile(absolutePath);
        entries.push({
          path: relativePath,
          kind: "file",
          bytes: metadata.size,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      } else {
        entries.push({path: relativePath, kind: "other"});
      }
    }
  }
  await visit(root);
  entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  return entries;
}

async function readSnapshotTextFiles(root: string, snapshot: SnapshotEntry[], matchesPath: (path: string) => boolean): Promise<Array<{path: string; bytes: number; sha256: string; content: string}>> {
  const files = snapshot.filter((entry) => entry.kind === "file" && matchesPath(entry.path));
  return await Promise.all(files.map(async (entry) => ({
    path: entry.path,
    bytes: entry.bytes ?? 0,
    sha256: entry.sha256 ?? "",
    content: await readFile(join(root, entry.path), "utf8"),
  })));
}

function changedPaths(before: SnapshotEntry[], after: SnapshotEntry[]): Array<{path: string; before?: SnapshotEntry; after?: SnapshotEntry}> {
  const oldByPath = new Map(before.map((entry) => [entry.path, entry]));
  const newByPath = new Map(after.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...oldByPath.keys(), ...newByPath.keys()])].sort((left, right) => left.localeCompare(right, "en"));
  return paths.flatMap((path) => {
    const oldEntry = oldByPath.get(path);
    const newEntry = newByPath.get(path);
    return JSON.stringify(oldEntry) === JSON.stringify(newEntry) ? [] : [{path, before: oldEntry, after: newEntry}];
  });
}

function ensureExactSnapshot(before: SnapshotEntry[], after: SnapshotEntry[], label: string): void {
  const changes = changedPaths(before, after);
  if (changes.length > 0) throw new Error(`${label} changed ${changes.length} vault path(s): ${JSON.stringify(changes).slice(0, 6_000)}`);
}

function countMarkdownFiles(snapshot: SnapshotEntry[]): number {
  return snapshot.filter((entry) => entry.kind === "file" && entry.path.toLowerCase().endsWith(".md")).length;
}

function ensureAppDataChangesAreMacEframeUiStateOnly(
  changes: Array<{path: string; before?: SnapshotEntry; after?: SnapshotEntry}>,
  eframeFiles: Array<{path: string; bytes: number; sha256: string; content: string}>,
  label: string,
  forbiddenPaths: string[],
): void {
  const unexpected = changes.filter((change) => (
    process.platform !== "darwin"
    || change.path !== "app.ron"
    || change.after?.kind !== "file"
  ));
  if (unexpected.length > 0) {
    throw new Error(label + " changed app-data paths outside macOS eframe UI state: " + JSON.stringify(unexpected).slice(0, 6_000));
  }

  const appRon = eframeFiles.find((file) => file.path === "app.ron");
  if (changes.some((change) => change.path === "app.ron") && !appRon) {
    throw new Error(label + " changed app.ron but the resulting eframe state file could not be read");
  }
  if (process.platform === "darwin" && appRon) {
    if (!/(?:^|[\s({,\[])"?window"?\s*:/.test(appRon.content) || !/(?:^|[\s({,\[])"?egui"?\s*:/.test(appRon.content)) {
      throw new Error(label + " app.ron did not contain the expected eframe window and egui state");
    }
    if (forbiddenPaths.some((path) => path.length > 0 && appRon.content.includes(path))) {
      throw new Error(label + " app.ron contains a vault or app-data path");
    }
  }
}

async function validateCanvasNoteCreationAppDataTransaction(
  before: SnapshotEntry[],
  after: SnapshotEntry[],
  changes: Array<{path: string; before?: SnapshotEntry; after?: SnapshotEntry}>,
  appDataRoot: string,
  canonicalAppDataRoot: string,
  canvasVaultRoot: string,
  notePath: string,
  noteBytes: Buffer,
  noteSha256: string,
): Promise<{vault_data_id: string; operation_id: string; journal_rows: number; recovery_bytes: number}> {
  if (createHash("sha256").update(noteBytes).digest("hex") !== noteSha256) {
    throw new Error("Canvas note creation expected bytes do not match their reported revision");
  }
  const vaultDataId = createHash("sha256").update(resolve(canvasVaultRoot)).digest("hex").slice(0, 24);
  const vaultDataPrefix = `vaults/${vaultDataId}`;
  const markerPath = `${vaultDataPrefix}/.openobsidian-vault-data`;
  const beforeMarker = before.find((entry) => entry.path === markerPath);
  const afterMarker = after.find((entry) => entry.path === markerPath);
  if (beforeMarker?.kind !== "file" || JSON.stringify(beforeMarker) !== JSON.stringify(afterMarker)) {
    throw new Error(`Canvas note creation changed or lacked its selected-vault app-data marker: ${markerPath}`);
  }
  const markerBytes = await readFile(join(appDataRoot, markerPath));
  if (!markerBytes.equals(Buffer.from("openobsidian-vault-data-v1\n", "utf8"))) {
    throw new Error(`Canvas note creation found an unexpected selected-vault app-data marker at ${markerPath}`);
  }

  const eframeChanges = changes.filter((change) => change.path === "app.ron");
  const eframeFilesAfter = await readSnapshotTextFiles(
    appDataRoot,
    after,
    (path) => path.toLowerCase().endsWith(".ron"),
  );
  ensureAppDataChangesAreMacEframeUiStateOnly(
    eframeChanges,
    eframeFilesAfter,
    "OpenObsidian app data after explicit Canvas note creation",
    [canvasVaultRoot, resolve(canvasVaultRoot), appDataRoot, canonicalAppDataRoot],
  );

  const journalPath = `${vaultDataPrefix}/journal.jsonl`;
  const recoveryDirectoryPath = `${vaultDataPrefix}/recovery`;
  if (before.some((entry) => entry.path === journalPath || entry.path === recoveryDirectoryPath)) {
    throw new Error("Canvas note creation app-data baseline already contains a journal or recovery directory for the selected vault");
  }
  const outOfScope = changes.filter((change) => (
    change.path !== "app.ron" && change.path !== vaultDataPrefix && !change.path.startsWith(`${vaultDataPrefix}/`)
  ));
  if (outOfScope.length > 0) {
    throw new Error(`Canvas note creation changed app-data paths outside the selected vault transaction: ${JSON.stringify(outOfScope).slice(0, 6_000)}`);
  }

  const journalBytes = await readFile(join(appDataRoot, journalPath));
  const journalEntry = after.find((entry) => entry.path === journalPath);
  if (journalEntry?.kind !== "file"
    || journalEntry.bytes !== journalBytes.length
    || journalEntry.sha256 !== createHash("sha256").update(journalBytes).digest("hex")) {
    throw new Error("Canvas note creation journal bytes do not match its app-data snapshot");
  }
  const journalText = journalBytes.toString("utf8");
  if (!journalText.endsWith("\n")) throw new Error("Canvas note creation journal is missing its final record delimiter");
  const journalRecordsText = journalText.replace(/\r?\n$/, "");
  const journalLines = journalRecordsText.split(/\r?\n/);
  if (journalLines.length !== 2 || journalLines.some((line) => line.trim().length === 0)) {
    throw new Error(`Canvas note creation journal must contain exactly two non-empty records: ${journalText.slice(0, 2_000)}`);
  }
  const journalRows = journalLines.map((line) => JSON.parse(line) as Record<string, unknown>);
  const expectedJournalKeys = ["error", "expected_revision", "id", "next_revision", "operation", "recorded_at", "relative_path", "state"].sort();
  if (journalRows.length !== 2 || journalRows.some((row) => (
    JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(expectedJournalKeys)
  ))) {
    throw new Error(`Canvas note creation journal must contain exactly two complete create records: ${journalText.slice(0, 2_000)}`);
  }
  const [prepared, committed] = journalRows;
  if (!prepared || !committed) throw new Error("Canvas note creation journal is missing a prepared or committed record");
  const operationId = typeof prepared?.id === "string" ? prepared.id : "";
  const validTimestamp = (value: unknown): value is string => (
    typeof value === "string" && /^\d{10,}$/.test(value) && Number.isSafeInteger(Number(value))
  );
  if (!/^\d+-\d+-\d+$/.test(operationId)
    || committed?.id !== operationId
    || prepared?.operation !== "create"
    || committed?.operation !== "create"
    || prepared?.state !== "prepared"
    || committed?.state !== "committed"
    || prepared?.relative_path !== notePath
    || committed?.relative_path !== notePath
    || prepared?.expected_revision !== null
    || committed?.expected_revision !== null
    || prepared?.next_revision !== noteSha256
    || committed?.next_revision !== noteSha256
    || prepared?.error !== null
    || committed?.error !== null
    || !validTimestamp(prepared?.recorded_at)
    || !validTimestamp(committed?.recorded_at)
    || Number(committed.recorded_at) < Number(prepared.recorded_at)) {
    throw new Error(`Canvas note creation journal records did not match the confirmed destination and bytes: ${journalText.slice(0, 2_000)}`);
  }

  const incomingName = `${operationId}-incoming`;
  const recoveryBytesPath = `${recoveryDirectoryPath}/${incomingName}.bin`;
  const recoveryManifestPath = `${recoveryDirectoryPath}/${incomingName}.json`;
  const expectedTransactionPaths = new Set([journalPath, recoveryDirectoryPath, recoveryBytesPath, recoveryManifestPath]);
  const transactionChanges = changes.filter((change) => change.path !== "app.ron");
  if (transactionChanges.length !== expectedTransactionPaths.size
    || transactionChanges.some((change) => !expectedTransactionPaths.has(change.path) || change.before !== undefined)) {
    throw new Error(`Canvas note creation app data contained an unexpected selected-vault delta: ${JSON.stringify(transactionChanges).slice(0, 6_000)}`);
  }
  const recoveryDirectory = after.find((entry) => entry.path === recoveryDirectoryPath);
  if (recoveryDirectory?.kind !== "directory") {
    throw new Error(`Canvas note creation recovery directory is missing: ${recoveryDirectoryPath}`);
  }

  const recoveryBytes = await readFile(join(appDataRoot, recoveryBytesPath));
  const recoveryBytesEntry = after.find((entry) => entry.path === recoveryBytesPath);
  if (recoveryBytesEntry?.kind !== "file"
    || !recoveryBytes.equals(noteBytes)
    || recoveryBytesEntry.bytes !== recoveryBytes.length
    || recoveryBytesEntry.sha256 !== noteSha256
    || createHash("sha256").update(recoveryBytes).digest("hex") !== noteSha256) {
    throw new Error("Canvas note creation recovery bytes do not match the confirmed note or app-data snapshot");
  }

  const manifestBytes = await readFile(join(appDataRoot, recoveryManifestPath));
  const manifestEntry = after.find((entry) => entry.path === recoveryManifestPath);
  if (manifestEntry?.kind !== "file"
    || manifestEntry.bytes !== manifestBytes.length
    || manifestEntry.sha256 !== createHash("sha256").update(manifestBytes).digest("hex")) {
    throw new Error("Canvas note creation recovery manifest does not match its app-data snapshot");
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as Record<string, unknown>;
  const expectedManifestKeys = ["bytes", "captured_at", "current_revision", "expected_revision", "id", "path", "relative_path", "revision"].sort();
  const expectedIncomingPath = join(canonicalAppDataRoot, recoveryBytesPath);
  const normalizeRecoveryPath = (value: string): string => {
    const slashNormalized = value.replace(/\\/g, "/");
    return process.platform === "win32"
      ? slashNormalized.replace(/^\/\/\?\//, "").toLowerCase()
      : slashNormalized;
  };
  if (JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(expectedManifestKeys)
    || manifest.id !== incomingName
    || manifest.relative_path !== notePath
    || manifest.revision !== noteSha256
    || manifest.bytes !== noteBytes.length
    || typeof manifest.path !== "string"
    || normalizeRecoveryPath(manifest.path) !== normalizeRecoveryPath(expectedIncomingPath)
    || !validTimestamp(manifest.captured_at)
    || manifest.expected_revision !== null
    || manifest.current_revision !== null) {
    throw new Error(`Canvas note creation recovery manifest did not match the confirmed transaction: ${manifestBytes.toString("utf8").slice(0, 2_000)}`);
  }

  return {
    vault_data_id: vaultDataId,
    operation_id: operationId,
    journal_rows: journalRows.length,
    recovery_bytes: recoveryBytes.length,
  };
}

async function createObsidianProfile(
  profileDirectory: string,
  port: number,
  logFilename = port === 9222 ? "obsidian-author.log" : "obsidian-reopen.log",
): Promise<ChildProcess> {
  await mkdir(profileDirectory, {recursive: true});
  const homeRoot = join(profileDirectory, "home");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
  };
  const args: string[] = [];
  if (process.platform === "linux") {
    env.HOME = homeRoot;
    env.XDG_CONFIG_HOME = join(profileDirectory, "config");
    env.XDG_CACHE_HOME = join(profileDirectory, "cache");
    env.XDG_DATA_HOME = join(profileDirectory, "data");
    args.push("--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage");
  } else if (process.platform === "win32") {
    env.HOME = homeRoot;
    env.USERPROFILE = homeRoot;
    env.APPDATA = join(profileDirectory, "appdata-roaming");
    env.LOCALAPPDATA = join(profileDirectory, "appdata-local");
    // Windows folder pickers open the profile's Desktop by default; create it so
    // the native picker does not block automation with a missing-location dialog.
    await mkdir(join(homeRoot, "Desktop"), {recursive: true});
  }
  // Keep the GitHub-hosted macOS user's ephemeral login keychain available to Electron safeStorage.
  // Pointing HOME at a new temp directory produces a blocking "Keychain Not Found" native dialog.
  args.push(
    "--remote-allow-origins=*",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${join(profileDirectory, "user-data")}`,
  );
  return launchLogged(obsidianBinary, args, join(reportDirectory, logFilename), env);
}

async function authorFixtureThroughObsidian(child: ChildProcess): Promise<{connection: DevToolsConnection; browserVersion: string; notePath: string}> {
  if (child.exitCode !== null) throw new Error(`Pinned Obsidian exited before authoring (code ${child.exitCode})`);
  let {connection, browserVersion, target} = await connectObsidian(9222);
  const authoring = report.obsidian_authoring as Record<string, unknown>;
  authoring.devtools_browser = browserVersion;
  authoring.first_target = {title: target.title ?? "", url: target.url ?? ""};
  const firstRunBody = await waitForRenderer(connection, "document.body?.innerText ?? ''", (body) => body.includes("Open folder as vault"), "Obsidian's first-run vault screen");
  authoring.first_run_text = firstRunBody.slice(0, 2_000);
  await captureObsidianScreenshot(connection, "obsidian-first-run.png");
  connection = await chooseVaultDirectory(connection, 9222, child);
  await chooseRestrictedMode(connection);
  await captureObsidianScreenshot(connection, "obsidian-vault-restricted-mode.png");

  const newNoteButtons = await connection.evaluateJson<{labels: string[]; found: boolean}>(`(() => {
    const buttons = [...document.querySelectorAll('button,[role="button"]')];
    const labels = buttons.map((button) => (button.innerText || button.textContent || '').trim()).filter(Boolean);
    return {labels, found: buttons.some((button) => (button.innerText || button.textContent || '').trim().startsWith('New note'))};
  })()`);
  authoring.new_note_action_buttons = newNoteButtons.labels;
  if (!newNoteButtons.found) throw new Error("Obsidian did not expose its visible New note action after Restricted Mode opened the vault");
  authoring.new_note_action = "DOM click on Obsidian's visible New note button";
  connection.send("Runtime.evaluate", {
    expression: `(() => [...document.querySelectorAll('button,[role="button"]')]
      .find((button) => (button.innerText || button.textContent || '').trim().startsWith('New note'))?.click())()`,
    returnByValue: true,
  });
  await delay(750);
  await captureObsidianScreenshot(connection, "obsidian-new-note-action.png");

  const editor = await waitFor("Obsidian Markdown editor to become available", async () => await connection.evaluateJson<{
    count: number;
    active: boolean;
    active_tag: string | null;
    active_class: string;
    editable_elements: Array<{tag: string; class_name: string; aria_label: string | null; text: string; active: boolean}>;
    markdown_editor: {class_name: string; x: number; y: number; width: number; height: number} | null;
  }>(`(() => {
    const editors = [...document.querySelectorAll('[contenteditable="true"]')];
    const active = document.activeElement;
    const markdownEditor = document.querySelector('.cm-content[contenteditable="true"]');
    const rect = markdownEditor?.getBoundingClientRect();
    return {
      count: editors.length,
      active: editors.some((element) => element === active || element.contains(active)),
      active_tag: active?.tagName ?? null,
      active_class: typeof active?.className === 'string' ? active.className : '',
      editable_elements: editors.map((element) => ({
        tag: element.tagName,
        class_name: typeof element.className === 'string' ? element.className : '',
        aria_label: element.getAttribute('aria-label'),
        text: (element.textContent ?? '').slice(0, 100),
        active: element === active || element.contains(active),
      })),
      markdown_editor: markdownEditor && rect ? {
        class_name: typeof markdownEditor.className === 'string' ? markdownEditor.className : '',
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      } : null,
    };
  })()`), (value) => {
    (report.obsidian_authoring as Record<string, unknown>).last_editor_state = value;
    return value.markdown_editor !== null;
  }, 30_000);
  authoring.editor_after_new_note = editor;
  const clickX = Math.max(1, editor.markdown_editor!.x + 12);
  const clickY = Math.max(1, editor.markdown_editor!.y + 12);
  await connection.request("Input.dispatchMouseEvent", {type: "mouseMoved", x: clickX, y: clickY});
  await connection.request("Input.dispatchMouseEvent", {type: "mousePressed", x: clickX, y: clickY, button: "left", clickCount: 1});
  await connection.request("Input.dispatchMouseEvent", {type: "mouseReleased", x: clickX, y: clickY, button: "left", clickCount: 1});
  const editorFocus = await connection.evaluateJson<{markdown_editor_active: boolean; active_tag: string | null; active_class: string}>(`(() => {
    const markdownEditor = document.querySelector('.cm-content[contenteditable="true"]');
    const active = document.activeElement;
    return {
      markdown_editor_active: Boolean(markdownEditor && (markdownEditor === active || markdownEditor.contains(active))),
      active_tag: active?.tagName ?? null,
      active_class: typeof active?.className === 'string' ? active.className : '',
    };
  })()`);
  authoring.editor_focus_after_click = editorFocus;
  if (!editorFocus.markdown_editor_active) throw new Error(`Could not focus Obsidian's Markdown editor: ${JSON.stringify(editorFocus)}`);
  await captureObsidianScreenshot(connection, "obsidian-markdown-editor-focused.png");
  const inserted = await connection.request("Input.insertText", {text: noteContents});
  if (inserted.error) throw new Error(`Could not insert synthetic note content into Obsidian: ${inserted.error.message ?? "unknown error"}`);
  await captureObsidianScreenshot(connection, "obsidian-note-content-entered.png");

  const notePath = await waitFor("Obsidian to persist the new Markdown note", async () => {
    const entries = await snapshotTree(vaultRoot);
    for (const entry of entries) {
      if (entry.kind !== "file" || !entry.path.toLocaleLowerCase("en").endsWith(".md")) continue;
      const contents = await readFile(join(vaultRoot, entry.path), "utf8");
      if (contents.includes(noteMarker) && contents.includes(noteEmbed)) return entry.path;
    }
    return null;
  }, (value) => value !== null, 45_000).then((value) => {
    if (!value) throw new Error("Obsidian's new note was not persisted");
    return value;
  });

  await captureObsidianScreenshot(connection, "obsidian-authored-note.png");
  authoring.status = "passed";
  authoring.note_path = notePath;
  authoring.note_sha256 = createHash("sha256").update(await readFile(join(vaultRoot, notePath))).digest("hex");
  authoring.note_bytes = (await readFile(join(vaultRoot, notePath))).length;
  authoring.attachment_path_in_note = noteContents.includes(attachmentPath);
  authoring.markdown_saved_by_reference_editor = true;
  (report.fixture as Record<string, unknown>).authored_note_path = notePath;
  await saveReport();
  return {connection, browserVersion, notePath};
}

async function focusOpenObsidian(child: ChildProcess): Promise<void> {
  if (process.platform === "linux") return;
  if (process.platform === "darwin") {
    const script = `tell application "System Events" to set frontmost of first process whose unix id is ${child.pid ?? -1} to true`;
    execFileSync("osascript", ["-e", script], {stdio: "ignore"});
    return;
  }
  const script = `
    Add-Type -TypeDefinition @'
      using System;
      using System.Runtime.InteropServices;
      public static class OpenObsidianWindow {
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
      }
'@
    $application = Get-Process -Id ${child.pid ?? -1} -ErrorAction SilentlyContinue
    if ($null -eq $application -or $application.MainWindowHandle -eq 0) {
      $application = Get-Process -Name "openobsidian" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    }
    if ($null -ne $application -and $application.MainWindowHandle -ne 0) {
      [OpenObsidianWindow]::ShowWindow($application.MainWindowHandle, 9) | Out-Null
      [OpenObsidianWindow]::SetForegroundWindow($application.MainWindowHandle) | Out-Null
    }
  `;
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {stdio: "ignore"});
}

async function clickOpenVaultButton(
  child: ChildProcess,
  windowId: string,
  applicationLogPath: string,
  screenshotName = "openobsidian-vault-picker-cancel-click.png",
  reportTarget: Record<string, unknown> = report.openobsidian_open as Record<string, unknown>,
): Promise<string> {
  await focusOpenObsidian(child);
  if (process.platform === "linux") {
    const clicked = await clickOpenVaultButtonLinux(windowId, applicationLogPath);
    await delay(500);
    const screenshot = await captureDesktopScreenshot(screenshotName);
    reportTarget.picker_cancel_click_screenshot = relative(reportDirectory, screenshot);
    return `Activated OpenObsidian (focus ${clicked.focused_window_before_activation} -> ${clicked.focused_window_after_activation}), clicked (${clicked.click_x}, ${clicked.click_y}), and confirmed the egui Open vault action; window=${clicked.window_x},${clicked.window_y},${clicked.window_width},${clicked.window_height}; pointer_before_click=${clicked.pointer_before_click}; egui_action_event=${clicked.egui_action_event}; keyboard_fallback=${clicked.keyboard_fallback}.`;
  }
  if (process.platform === "darwin") {
    const script = `on run argv
      tell application "System Events"
        set targetProcess to first process whose unix id is (item 1 of argv as integer)
        set frontmost of targetProcess to true
        try
          set openVaultButton to missing value
          repeat with candidate in entire contents of window 1 of targetProcess
            try
              if role of candidate is "AXButton" and name of candidate is "Open vault" then
                set openVaultButton to candidate
                exit repeat
              end if
            end try
          end repeat
          if openVaultButton is not missing value then
            click openVaultButton
            return "Invoked the Open vault button from the window's nested accessibility tree."
          end if
          return "The nested accessibility tree did not expose Open vault."
        on error errorMessage
          return "Accessibility lookup failed: " & errorMessage
        end try
      end tell
    end run`;
    const interaction = execFileSync("osascript", ["-e", script, String(child.pid ?? -1)], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
    return interaction.includes("Invoked the Open vault button") ? interaction : await clickOpenVaultButtonMacOS(child);
  }
  if (process.platform === "win32") {
    const script = `
      $ErrorActionPreference = "Stop"
      Add-Type -AssemblyName UIAutomationClient
      Add-Type -AssemblyName UIAutomationTypes
      $application = Get-Process -Id ${child.pid ?? -1} -ErrorAction SilentlyContinue
      if ($null -eq $application -or $application.MainWindowHandle -eq 0) {
        $application = Get-Process -Name "openobsidian" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
      }
      if ($null -eq $application -or $application.MainWindowHandle -eq 0) { throw "OpenObsidian did not expose its main window handle" }
      $root = [System.Windows.Automation.AutomationElement]::FromHandle($application.MainWindowHandle)
      $buttonType = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Button
      )
      $buttonName = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::NameProperty,
        "Open vault"
      )
      $button = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.AndCondition]::new($buttonType, $buttonName))
      $deadline = [DateTime]::UtcNow.AddSeconds(10)
      $isEnabled = $false
      $bounds = $null
      $lastState = "not found"
      $stateTransitions = @()
      while ([DateTime]::UtcNow -lt $deadline) {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($application.MainWindowHandle)
        $button = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.AndCondition]::new($buttonType, $buttonName))
        if ($null -ne $button) {
          try {
            $current = $button.Current
            $isEnabled = [bool]$current.IsEnabled
            $bounds = $current.BoundingRectangle
            $observedState = "found; IsEnabled=$isEnabled; bounds=$($bounds.Left),$($bounds.Top),$($bounds.Width),$($bounds.Height)"
          } catch {
            $observedState = "stale UI Automation element: $($_.Exception.Message)"
            $isEnabled = $false
          }
        } else {
          $observedState = "not found"
          $isEnabled = $false
        }
        if ($observedState -ne $lastState) {
          $stateTransitions += ([DateTime]::UtcNow.ToString('HH:mm:ss.fffZ') + ":" + $observedState)
          $lastState = $observedState
        }
        if ($isEnabled) { break }
        Start-Sleep -Milliseconds 250
      }
      if ($null -eq $button) {
        Write-Output "Open vault was not exposed through UI Automation after polling; state_transitions=$($stateTransitions -join ' | ')"
        return
      }
      $invoked = $false
      $invokeFailure = "UI Automation continued to report IsEnabled=$isEnabled after polling"
      if ($isEnabled) {
        try {
          $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
          $invoked = $true
          Write-Output "Invoked the Open vault accessibility button after UI Automation polling; IsEnabled=$isEnabled; bounds=$($bounds.Left),$($bounds.Top),$($bounds.Width),$($bounds.Height); state_transitions=$($stateTransitions -join ' | ')"
        } catch {
          $invokeFailure = $_.Exception.Message
        }
      }
      if (-not $invoked) {
          Add-Type -TypeDefinition @'
            using System;
            using System.Runtime.InteropServices;
            public static class OpenObsidianMouse {
              [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
              [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
            }
'@
          if ($bounds.Width -le 0 -or $bounds.Height -le 0) { throw "Open vault has no clickable UI Automation bounds; IsEnabled=$isEnabled; state_transitions=$($stateTransitions -join ' | '); InvokePattern failed: $invokeFailure" }
          $clickX = [int][Math]::Round($bounds.Left + ($bounds.Width / 2))
          $clickY = [int][Math]::Round($bounds.Top + ($bounds.Height / 2))
          [OpenObsidianMouse]::SetCursorPos($clickX, $clickY) | Out-Null
          Start-Sleep -Milliseconds 250
          [OpenObsidianMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
          Start-Sleep -Milliseconds 120
          [OpenObsidianMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
          Write-Output "Moved the pointer to Open vault, waited 250 ms, and held a screen click; IsEnabled=$isEnabled; bounds=$($bounds.Left),$($bounds.Top),$($bounds.Width),$($bounds.Height); state_transitions=$($stateTransitions -join ' | '); InvokePattern result: $invokeFailure"
      }
    `;
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
  }
  throw new Error(`Unsupported OpenObsidian folder picker platform ${process.platform}`);
}

async function selectOpenObsidianVaultFromNativePicker(
  child: ChildProcess,
  window: {window_id: string},
  applicationLogPath: string,
  targetRoot = vaultRoot,
  reportTarget: Record<string, unknown> = report.openobsidian_open as Record<string, unknown>,
  screenshotPrefix = "openobsidian",
): Promise<Record<string, unknown>> {
  const screenshots: string[] = [];
  const openReport = reportTarget;
  const screenshot = (name: string) => `${screenshotPrefix}-${name}.png`;
  await focusOpenObsidian(child);
  if (process.platform === "linux") xdotool("windowfocus", "--sync", window.window_id);
  screenshots.push(relative(reportDirectory, await captureDesktopScreenshot(screenshot("vault-picker-home"))));
  let macPickerEntriesBeforeOpen: string[] | null = null;
  if (process.platform === "darwin") {
    const descriptions = macOSApplicationWindowDescriptions(child);
    macPickerEntriesBeforeOpen = macOSReadableAccessibilityWindowEntries(descriptions);
    reportTarget.native_picker_accessibility_windows_before_open = descriptions;
    reportTarget.native_picker_entries_before_open = macPickerEntriesBeforeOpen;
    await saveReport();
  }

  const openButtonInteraction = await clickOpenVaultButton(
    child,
    window.window_id,
    applicationLogPath,
    screenshot("vault-picker-cancel-click"),
    reportTarget,
  );

  await delay(750);
  try {
    const pickerScreenshot = await captureDesktopScreenshot(screenshot("native-folder-picker"));
    screenshots.push(relative(reportDirectory, pickerScreenshot));
    openReport.native_picker_open_screenshot = relative(reportDirectory, pickerScreenshot);
    openReport.native_picker_screenshots = screenshots.slice();
    openReport.native_picker_open_screenshot_status = "captured";
    await saveReport();
  } catch (error) {
    openReport.native_picker_open_screenshot_status = "failed";
    openReport.native_picker_open_error = error instanceof Error ? error.message : String(error);
    await saveReportAfterStageFailure("native_picker_open_screenshot", openReport, error);
    throw error;
  }
  const pickerWindowId = process.platform === "linux" ? activeWindowId() : null;
  const pickerWindowTitle = process.platform === "linux" ? activeWindowTitle() : "native platform folder picker";
  let pathEntryInteraction: string;
  let folderSelectionInteraction: string;

  if (process.platform === "linux") {
    if (!pickerWindowId || pickerWindowId === window.window_id) throw new Error(`OpenObsidian native folder picker did not become active; title=${pickerWindowTitle}`);
    xdotool("windowraise", pickerWindowId);
    xdotool("windowfocus", "--sync", pickerWindowId);
    await delay(250);
    xdotool("key", "ctrl+l");
    await delay(500);
    screenshots.push(relative(reportDirectory, await captureDesktopScreenshot(screenshot("native-folder-location-entry"))));
    xdotool("mousemove", "--window", pickerWindowId, "400", "22");
    xdotool("click", "1");
    xdotool("key", "ctrl+a");
    xdotool("key", "BackSpace");
    await delay(250);
    const clearedLocationScreenshot = await captureDesktopScreenshot(screenshot("native-folder-location-entry-cleared"));
    screenshots.push(relative(reportDirectory, clearedLocationScreenshot));
    const clearedLocationOcr = await readScreenshotOcr(clearedLocationScreenshot);
    execFileSync("xclip", ["-selection", "clipboard", "-loops", "1", "-in"], {input: targetRoot, stdio: ["pipe", "ignore", "ignore"]});
    xdotool("key", "ctrl+v");
    await delay(500);
    const enteredPathScreenshot = await captureDesktopScreenshot(screenshot("native-folder-path-entered"));
    screenshots.push(relative(reportDirectory, enteredPathScreenshot));
    const enteredPathOcr = await readScreenshotOcr(enteredPathScreenshot);
    openReport.linux_folder_selection_location_entry_after_clear_ocr = clearedLocationOcr.slice(0, 2_000);
    openReport.linux_folder_selection_location_entry_ocr = enteredPathOcr.slice(0, 2_000);
    openReport.linux_folder_selection_location_entry_contains_fixture_path = enteredPathOcr.includes(targetRoot);
    await saveReport();
    pathEntryInteraction = "Focused and cleared the Ctrl+L location entry, then pasted the full absolute fixture path from the CI clipboard.";
    const clicked = clickWindowOpenButton(pickerWindowId);
    folderSelectionInteraction = `Clicked the native folder dialog confirmation at (${clicked.click_x}, ${clicked.click_y}) after entering the fixture path.`;
    await delay(750);
    screenshots.push(relative(reportDirectory, await captureDesktopScreenshot(screenshot("native-folder-path-opened"))));
    if (activeWindowId() === pickerWindowId) {
      openReport.linux_folder_selection_interaction = folderSelectionInteraction;
      openReport.linux_folder_selection_click = clicked;
      openReport.linux_folder_selection_screenshots = screenshots.slice();
      await saveReport();
      throw new Error(`The native Linux folder picker remained visible after its confirmation button click; window=${pickerWindowTitle}; click=${JSON.stringify(clicked)}`);
    }
  } else if (process.platform === "darwin") {
    const pickerBaselineEntries = macPickerEntriesBeforeOpen;
    if (!pickerBaselineEntries) throw new Error("The macOS native picker accessibility baseline was not captured before activation");
    let latestMacPickerInventory = "";
    let panelObservation: {descriptions: string; entries: string[]; addedPanels: string[]} | null = null;
    try {
      panelObservation = await waitFor(
        "exactly one new native macOS folder picker to become visible",
        async () => {
          const descriptions = macOSApplicationWindowDescriptions(child);
          latestMacPickerInventory = descriptions;
          const entries = macOSReadableAccessibilityWindowEntries(descriptions);
          return {descriptions, entries, addedPanels: macOSAddedNativeOpenPanelEntries(pickerBaselineEntries, entries)};
        },
        (observation) => observation.addedPanels.length === 1,
        15_000,
      );
    } catch (error) {
      if (!latestMacPickerInventory) {
        try {
          latestMacPickerInventory = macOSApplicationWindowDescriptions(child);
        } catch (inventoryError) {
          reportTarget.native_picker_open_inventory_error = inventoryError instanceof Error ? inventoryError.message : String(inventoryError);
        }
      }
      reportTarget.native_picker_open_status = "failed";
      reportTarget.native_picker_open_error = error instanceof Error ? error.message : String(error);
      reportTarget.native_picker_accessibility_windows_after_open_attempt = latestMacPickerInventory;
      await saveReportAfterStageFailure("native_picker_open", reportTarget, error);
      throw error;
    }
    if (!panelObservation) throw new Error("The macOS picker visibility wait returned no panel observation");
    const pickerAccessibility = panelObservation.descriptions;
    const pickerPanelIdentity = panelObservation.addedPanels[0] ?? "";
    if (!pickerPanelIdentity || panelObservation.addedPanels.length !== 1 || macOSNativeOpenPanelIdentityCount(panelObservation.entries, pickerPanelIdentity) !== 1) {
      const error = new Error(`The macOS native folder picker identity is missing or ambiguous before path entry: ${JSON.stringify(panelObservation.addedPanels)}`);
      reportTarget.native_picker_open_status = "failed";
      reportTarget.native_picker_open_error = error.message;
      reportTarget.native_picker_accessibility_windows_after_open_attempt = pickerAccessibility;
      await saveReportAfterStageFailure("native_picker_open", reportTarget, error);
      throw error;
    }
    reportTarget.native_picker_panel_identity = pickerPanelIdentity;
    reportTarget.native_picker_accessibility_windows = pickerAccessibility;
    reportTarget.native_picker_open_status = "identity-confirmed";
    await saveReport();
    let pickerReadyScreenshot = "";
    let pickerReadyOcr = "";
    let latestMacVisualInventory = pickerAccessibility;
    try {
      pickerReadyScreenshot = await captureDesktopScreenshot(screenshot("native-folder-picker-ready"));
      screenshots.push(relative(reportDirectory, pickerReadyScreenshot));
      reportTarget.native_picker_ready_screenshot = relative(reportDirectory, pickerReadyScreenshot);
      reportTarget.native_picker_screenshots = screenshots.slice();
      reportTarget.native_picker_ready_screenshot_status = "captured";
      await saveReport();
      const pickerReadyVisionEvidence = await inspectMacOSNativeOpenPanelScreenshot(pickerReadyScreenshot, pickerPanelIdentity);
      pickerReadyOcr = pickerReadyVisionEvidence.visible_text;
      reportTarget.native_picker_screenshot_ocr = pickerReadyOcr.slice(0, 2_000);
      reportTarget.native_picker_screenshot_vision_evidence = pickerReadyVisionEvidence;
      const visualInventory = macOSApplicationWindowDescriptions(child);
      latestMacVisualInventory = visualInventory;
      const visualEntries = macOSReadableAccessibilityWindowEntries(visualInventory);
      const visualAddedPanels = macOSAddedNativeOpenPanelEntries(pickerBaselineEntries, visualEntries);
      const visualIdentityCount = macOSNativeOpenPanelIdentityCount(visualEntries, pickerPanelIdentity);
      reportTarget.native_picker_accessibility_windows_at_visual_confirmation = visualInventory;
      reportTarget.native_picker_added_panels_at_visual_confirmation = visualAddedPanels;
      reportTarget.native_picker_panel_identity_match_count_at_visual_confirmation = visualIdentityCount;
      if (!pickerReadyVisionEvidence.confirmed_native_picker_buttons || !nativeFolderPickerVisibleInOcr(pickerReadyOcr)
          || visualAddedPanels.length !== 1 || visualAddedPanels[0] !== pickerPanelIdentity || visualIdentityCount !== 1) {
        throw new Error(`The macOS folder picker lacks high-confidence Cancel/Open Vision candidates inside its exact current accessibility bounds before path entry; evidence=${JSON.stringify(pickerReadyVisionEvidence)}; added panels=${JSON.stringify(visualAddedPanels)}; accessibility=${JSON.stringify(visualInventory)}`);
      }
      reportTarget.native_picker_ready_screenshot_status = "visually-and-accessibly-confirmed";
      await saveReport();
    } catch (error) {
      reportTarget.native_picker_ready_screenshot_status = "failed";
      reportTarget.native_picker_ready_screenshot_error = error instanceof Error ? error.message : String(error);
      reportTarget.native_picker_ready_screenshot_ocr = pickerReadyOcr.slice(0, 2_000);
      reportTarget.native_picker_accessibility_windows_at_visual_confirmation = latestMacVisualInventory;
      await saveReportAfterStageFailure("native_picker_visual_confirmation", reportTarget, error);
      throw error;
    }
    const pathScript = `on run argv
      tell application "System Events"
        set targetProcess to first process whose unix id is (item 1 of argv as integer)
        set frontmost of targetProcess to true
        keystroke "g" using {command down, shift down}
        delay 0.75
        keystroke (item 2 of argv)
        delay 0.5
        key code 36
        delay 1
      end tell
    end run`;
    execFileSync("osascript", ["-e", pathScript, String(child.pid ?? -1), targetRoot], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
    await delay(500);
    screenshots.push(relative(reportDirectory, await captureDesktopScreenshot(screenshot("native-folder-path-entered"))));
    reportTarget.native_picker_screenshots = screenshots.slice();
    await saveReport();
    const pathEntryInventory = macOSReadableAccessibilityWindowEntries(macOSApplicationWindowDescriptions(child));
    const pathEntryIdentityCount = macOSNativeOpenPanelIdentityCount(pathEntryInventory, pickerPanelIdentity);
    reportTarget.native_picker_panel_identity_match_count_after_path_entry = pathEntryIdentityCount;
    if (pathEntryIdentityCount !== 1) {
      throw new Error(`The macOS native folder picker identity changed or became ambiguous after path entry: expected one ${pickerPanelIdentity}, found ${pathEntryIdentityCount}`);
    }
    folderSelectionInteraction = await clickMacOSNativePickerOpenButton(child, pickerPanelIdentity);
    let consecutiveAbsentSnapshots = 0;
    let latestPickerCloseInventory = "";
    const closureSnapshotInventories: string[] = [];
    try {
      await delay(500);
      const afterOpenScreenshot = await captureDesktopScreenshot(screenshot("native-folder-path-selected"));
      screenshots.push(relative(reportDirectory, afterOpenScreenshot));
      reportTarget.native_picker_screenshots = screenshots.slice();
      reportTarget.native_picker_after_open_screenshot = relative(reportDirectory, afterOpenScreenshot);
      reportTarget.native_picker_after_open_screenshot_status = "captured";
      await saveReport();
      try {
        latestPickerCloseInventory = macOSApplicationWindowDescriptions(child);
        reportTarget.native_picker_after_open_accessibility_windows = latestPickerCloseInventory;
        macOSReadableAccessibilityWindowEntries(latestPickerCloseInventory);
        await saveReport();
      } catch (error) {
        reportTarget.native_picker_after_open_inventory_error = error instanceof Error ? error.message : String(error);
        throw error;
      }
      const afterOpenOcr = await readNativeFolderPickerOcr(afterOpenScreenshot);
      reportTarget.native_picker_after_open_screenshot_ocr = afterOpenOcr.slice(0, 2_000);
      if (!afterOpenOcr.trim()) {
        throw new Error("The macOS after-Open screenshot OCR returned no readable text, so it cannot confirm the chooser closed");
      }
      if (nativeFolderPickerVisibleInOcr(afterOpenOcr)) {
        throw new Error(`The macOS native folder chooser remains visible in the after-Open screenshot: ${JSON.stringify(afterOpenOcr.slice(0, 2_000))}`);
      }
      const closeObservation = await waitFor(
        `the exact macOS picker ${pickerPanelIdentity} to remain absent across three accessibility snapshots`,
        async () => {
          const descriptions = macOSApplicationWindowDescriptions(child);
          latestPickerCloseInventory = descriptions;
          const entries = macOSReadableAccessibilityWindowEntries(descriptions);
          const addedPanels = macOSAddedNativeOpenPanelEntries(pickerBaselineEntries, entries);
          const matchingPanelIdentityCount = macOSNativeOpenPanelIdentityCount(entries, pickerPanelIdentity);
          const absent = addedPanels.length === 0 && matchingPanelIdentityCount === 0;
          consecutiveAbsentSnapshots = absent ? consecutiveAbsentSnapshots + 1 : 0;
          if (absent) {
            closureSnapshotInventories.push(descriptions);
            if (closureSnapshotInventories.length > 3) closureSnapshotInventories.shift();
          } else {
            closureSnapshotInventories.length = 0;
          }
          return {descriptions, entries, addedPanels, matchingPanelIdentityCount, consecutiveAbsentSnapshots, closureSnapshotInventories: closureSnapshotInventories.slice()};
        },
        (observation) => observation.addedPanels.length === 0
          && observation.matchingPanelIdentityCount === 0
          && observation.consecutiveAbsentSnapshots >= 3,
        15_000,
      );
      reportTarget.native_picker_panel_identity_match_count_after_open_click = closeObservation.matchingPanelIdentityCount;
      reportTarget.native_picker_panel_consecutive_absent_snapshots_after_open_click = closeObservation.consecutiveAbsentSnapshots;
      reportTarget.native_picker_closure_snapshot_inventories = closeObservation.closureSnapshotInventories;
      reportTarget.native_picker_added_panels_after_open_click = closeObservation.addedPanels;
      reportTarget.native_picker_accessibility_windows_after_open_click = closeObservation.descriptions;
      reportTarget.native_picker_after_open_status = "confirmed-closed";
      await saveReport();
    } catch (error) {
      reportTarget.native_picker_after_open_status = "failed";
      reportTarget.native_picker_after_open_error = error instanceof Error ? error.message : String(error);
      reportTarget.native_picker_after_open_latest_accessibility_windows = latestPickerCloseInventory;
      reportTarget.native_picker_panel_consecutive_absent_snapshots_after_open_click = consecutiveAbsentSnapshots;
      reportTarget.native_picker_closure_snapshot_inventories = closureSnapshotInventories;
      if (!reportTarget.native_picker_after_open_screenshot_status) {
        reportTarget.native_picker_after_open_screenshot_status = "failed";
      }
      await saveReportAfterStageFailure("native_picker_after_open", reportTarget, error);
      throw error;
    }
    pathEntryInteraction = "Used Command-Shift-G with the full absolute fixture path; the native Open button was clicked using the Open panel's accessible bounds.";
  } else {
    const pathScript = `
      $ErrorActionPreference = "Stop"
      $shell = New-Object -ComObject WScript.Shell
      $shell.SendKeys("^l")
      Start-Sleep -Milliseconds 300
      $shell.SendKeys($env:OPENOBSIDIAN_PICKER_VAULT_PATH)
      Start-Sleep -Milliseconds 300
      $shell.SendKeys("{ENTER}")
    `;
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", pathScript], {
      env: {...process.env, OPENOBSIDIAN_PICKER_VAULT_PATH: targetRoot},
      stdio: "ignore",
    });
    screenshots.push(relative(reportDirectory, await captureDesktopScreenshot(screenshot("native-folder-path-entered"))));
    const selectScript = `
      $ErrorActionPreference = "Stop"
      Add-Type -AssemblyName UIAutomationClient
      Add-Type -AssemblyName UIAutomationTypes
      $root = [System.Windows.Automation.AutomationElement]::RootElement
      $buttonType = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Button
      )
      $buttonNames = @("Select Folder", "Select", "Open")
      $selected = $null
      foreach ($name in $buttonNames) {
        $nameCondition = [System.Windows.Automation.PropertyCondition]::new(
          [System.Windows.Automation.AutomationElement]::NameProperty,
          $name
        )
        $selected = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.AndCondition]::new($buttonType, $nameCondition))
        if ($null -ne $selected) { break }
      }
      if ($null -ne $selected) {
        $selected.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        Write-Output "Invoked native folder selection button: $($selected.Current.Name)"
      } else {
        Add-Type -TypeDefinition @'
          using System;
          using System.Runtime.InteropServices;
          [StructLayout(LayoutKind.Sequential)] public struct OpenObsidianPickerRect { public int Left; public int Top; public int Right; public int Bottom; }
          public static class OpenObsidianPickerNative {
            [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
            [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out OpenObsidianPickerRect rectangle);
            [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
            [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extraInfo);
          }
'@
        $dialog = [OpenObsidianPickerNative]::GetForegroundWindow()
        if ($dialog -eq [IntPtr]::Zero) { throw "Could not find the foreground native folder picker window" }
        $rectangle = New-Object OpenObsidianPickerRect
        if (-not [OpenObsidianPickerNative]::GetWindowRect($dialog, [ref]$rectangle)) { throw "Could not read the native folder picker window bounds" }
        $dialogWidth = $rectangle.Right - $rectangle.Left
        $dialogHeight = $rectangle.Bottom - $rectangle.Top
        if ($dialogWidth -lt 500 -or $dialogHeight -lt 400) { throw "Foreground window is not the native folder picker: $($dialogWidth)x$($dialogHeight)" }
        $clickX = $rectangle.Left + [int]($dialogWidth * 0.72)
        $clickY = $rectangle.Top + [int]($dialogHeight * 0.936)
        if (-not [OpenObsidianPickerNative]::SetCursorPos($clickX, $clickY)) { throw "Could not move the pointer to the native folder picker button" }
        [OpenObsidianPickerNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 100
        [OpenObsidianPickerNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
        Write-Output "The picker did not expose its Select Folder button; clicked the visible button at ($clickX, $clickY)."
      }
    `;
    folderSelectionInteraction = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", selectScript], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
    pathEntryInteraction = "Ctrl+L location entry with the full absolute fixture path.";
  }

  await delay(1_000);
  screenshots.push(relative(reportDirectory, await captureDesktopScreenshot(screenshot("vault-picker-selected"))));
  return {
    open_button_interaction: openButtonInteraction,
    picker_window_id: pickerWindowId,
    picker_window_title: pickerWindowTitle,
    path_entry_interaction: pathEntryInteraction,
    folder_selection_interaction: folderSelectionInteraction,
    screenshots,
    selected_path: targetRoot,
  };
}

async function cancelOpenObsidianNativePicker(
  child: ChildProcess,
  window: {window_id: string},
  appDataRoot: string,
  appDataSnapshotBeforePickerOpen: SnapshotEntry[],
  vaultRoot: string,
  canonicalVault: string,
  expectedMarkdownCount: number,
): Promise<Record<string, unknown>> {
  const screenshots: string[] = [];
  const linuxWindowsBefore = process.platform === "linux" ? x11WindowInventory() : null;
  const windowsBefore = process.platform === "win32" ? windowsTopLevelWindowInventory() : null;
  const openReport = report.openobsidian_open as Record<string, unknown>;
  if (linuxWindowsBefore) openReport.picker_cancel_x11_windows_before = linuxWindowsBefore;
  if (process.platform === "linux") openReport.picker_cancel_x11_input_before = x11InteractionState();
  if (windowsBefore) openReport.picker_cancel_windows_before = windowsBefore;
  let macPickerEntriesBeforeOpen: string[] | null = null;
  let macPickerPanelIdentity: string | null = null;
  if (process.platform === "darwin") {
    const descriptions = macOSApplicationWindowDescriptions(child);
    macPickerEntriesBeforeOpen = macOSReadableAccessibilityWindowEntries(descriptions);
    openReport.picker_cancel_accessibility_windows_before_open = descriptions;
    openReport.picker_cancel_entries_before_open = macPickerEntriesBeforeOpen;
    await saveReport();
  }
  const openButtonInteraction = await clickOpenVaultButton(
    child,
    window.window_id,
    join(reportDirectory, "openobsidian.log"),
  );
  openReport.picker_cancel_open_button_interaction = openButtonInteraction;
  if (process.platform === "win32") {
    const screenshot = await captureDesktopScreenshot("openobsidian-vault-picker-cancel-click.png");
    openReport.picker_cancel_click_screenshot = relative(reportDirectory, screenshot);
  }
  if (process.platform === "linux") {
    openReport.picker_cancel_x11_windows_after_click = x11WindowInventory();
    openReport.picker_cancel_x11_input_after_click = x11InteractionState();
  }
  if (process.platform === "win32") openReport.picker_cancel_windows_after_click = windowsTopLevelWindowInventory();
  await saveReport();
  let pickerWindowId: string | null = null;
  let pickerWindowTitle = "native platform folder picker";
  let cancellationInteraction: string;
  let pickerOpenOcr: string | null = null;
  let pickerAccessibilityWindows: string | null = null;
  let remainingMacAccessibilityWindows: string | null = null;
  let windowsPicker: WindowsTopLevelWindow | null = null;
  let remainingWindows: WindowsTopLevelWindow[] | null = null;
  let linuxWindowsAfterEscape: X11WindowDescription[] | null = null;
  let macPickerCloseAbsentSnapshots = 0;
  const macPickerCloseSnapshotInventories: string[] = [];
  let appDataSnapshotBeforeCancel: SnapshotEntry[] = [];
  let appDataChangesOnPickerOpen: Array<{path: string; before?: SnapshotEntry; after?: SnapshotEntry}> = [];
  let eframePersistenceFilesBeforeCancel: Array<{path: string; bytes: number; sha256: string; content: string}> = [];
  const captureAppDataBaselineBeforeCancel = async (): Promise<void> => {
    const snapshot = await snapshotTree(appDataRoot);
    const eframeFiles = await readSnapshotTextFiles(appDataRoot, snapshot, (path) => path.toLowerCase().endsWith(".ron"));
    const changes = changedPaths(appDataSnapshotBeforePickerOpen, snapshot);
    ensureAppDataChangesAreMacEframeUiStateOnly(
      changes,
      eframeFiles,
      "OpenObsidian app data while opening native picker",
      [vaultRoot, canonicalVault, appDataRoot],
    );
    appDataSnapshotBeforeCancel = snapshot;
    appDataChangesOnPickerOpen = changes;
    eframePersistenceFilesBeforeCancel = eframeFiles;
    const appDataReport = report.openobsidian_app_data as Record<string, unknown>;
    appDataReport.snapshot_before_picker_cancellation = snapshot;
    appDataReport.changes_on_picker_open = changes;
    appDataReport.eframe_persistence_files_before_cancellation = eframeFiles;
    appDataReport.eframe_app_ron_present_before_cancellation = snapshot.some(
      (entry) => entry.kind === "file" && entry.path === "app.ron",
    );
    await saveReport();
  };
  if (process.platform === "linux") {
    const previousWindowIds = new Set((linuxWindowsBefore ?? []).map((candidate) => candidate.window_id));
    const picker = await waitFor("new X11 native folder picker window", async () => {
      const candidates = x11WindowInventory().filter((candidate) => candidate.window_id !== window.window_id && !previousWindowIds.has(candidate.window_id));
      return candidates[0] ?? null;
    }, (candidate) => candidate !== null, 10_000);
    if (!picker) throw new Error(`OpenObsidian did not create a new X11 folder-picker window; before=${JSON.stringify(linuxWindowsBefore)}; after=${JSON.stringify(x11WindowInventory())}`);
    xdotool("windowraise", picker.window_id);
    xdotool("windowfocus", "--sync", picker.window_id);
    await delay(300);
    pickerWindowId = picker.window_id;
    pickerWindowTitle = picker.title;
    screenshots.push(relative(reportDirectory, await captureDesktopScreenshot("openobsidian-vault-picker-cancel-open.png")));
    await captureAppDataBaselineBeforeCancel();
    xdotool("key", "Escape");
    linuxWindowsAfterEscape = await waitFor("X11 native folder picker to close after Escape", async () => x11WindowInventory(), (windows) => !windows.some((candidate) => candidate.window_id === picker.window_id), 10_000);
    cancellationInteraction = `Raised X11 picker window ${picker.window_id} (${picker.title}) and sent Escape.`;
    openReport.picker_cancel_x11_windows_after_escape = linuxWindowsAfterEscape;
  } else if (process.platform === "darwin") {
    const pickerBaselineEntries = macPickerEntriesBeforeOpen;
    if (!pickerBaselineEntries) throw new Error("The macOS cancellation accessibility baseline was not captured before activation");
    let latestMacCancellationOpenInventory = "";
    let macCancellationOpenOcr = "";
    try {
      await delay(1_000);
      const pickerScreenshot = await captureDesktopScreenshot("openobsidian-vault-picker-cancel-open.png");
      screenshots.push(relative(reportDirectory, pickerScreenshot));
      openReport.picker_cancel_open_screenshot_path = relative(reportDirectory, pickerScreenshot);
      openReport.picker_cancel_screenshots = screenshots.slice();
      openReport.picker_cancel_open_screenshot_status = "captured";
      await saveReport();
      const accessibilityWindows = macOSApplicationWindowDescriptions(child);
      latestMacCancellationOpenInventory = accessibilityWindows;
      pickerAccessibilityWindows = accessibilityWindows;
      pickerWindowTitle = accessibilityWindows;
      const pickerEntries = macOSReadableAccessibilityWindowEntries(accessibilityWindows);
      const addedPanels = macOSAddedNativeOpenPanelEntries(pickerBaselineEntries, pickerEntries);
      macPickerPanelIdentity = addedPanels[0] ?? null;
      if (addedPanels.length !== 1 || !macPickerPanelIdentity || macOSNativeOpenPanelIdentityCount(pickerEntries, macPickerPanelIdentity) !== 1) {
        throw new Error(`The native macOS Open panel identity is absent or ambiguous before Escape: ${JSON.stringify(addedPanels)}`);
      }
      const cancellationOpenVisionEvidence = await inspectMacOSNativeOpenPanelScreenshot(pickerScreenshot, macPickerPanelIdentity);
      macCancellationOpenOcr = cancellationOpenVisionEvidence.visible_text;
      pickerOpenOcr = macCancellationOpenOcr;
      openReport.picker_cancel_open_screenshot_ocr = macCancellationOpenOcr.slice(0, 2_000);
      openReport.picker_cancel_open_screenshot_vision_evidence = cancellationOpenVisionEvidence;
      if (!cancellationOpenVisionEvidence.confirmed_native_picker_buttons || !nativeFolderPickerVisibleInOcr(macCancellationOpenOcr)) {
        throw new Error(`The native macOS Open panel lacks high-confidence Cancel/Open Vision candidates inside its exact accessibility bounds before Escape: ${JSON.stringify(cancellationOpenVisionEvidence)}`);
      }
      openReport.picker_cancel_panel_identity = macPickerPanelIdentity;
      openReport.picker_cancel_accessibility_windows_before_escape = accessibilityWindows;
      await saveReport();
    } catch (error) {
      openReport.picker_cancel_open_status = "failed";
      openReport.picker_cancel_open_error = error instanceof Error ? error.message : String(error);
      openReport.picker_cancel_open_screenshot_ocr = macCancellationOpenOcr.slice(0, 2_000);
      openReport.picker_cancel_accessibility_windows_after_open_attempt = latestMacCancellationOpenInventory;
      await saveReportAfterStageFailure("picker_cancel_open", openReport, error);
      throw error;
    }
    await captureAppDataBaselineBeforeCancel();
    const script = `tell application "System Events" to key code 53`;
    execFileSync("osascript", ["-e", script], {stdio: "ignore"});
    cancellationInteraction = "Sent Escape to the native macOS Open panel.";
  } else if (process.platform === "win32") {
    const previousHandles = new Set((windowsBefore ?? []).map((candidate) => candidate.native_window_handle));
    const applicationPid = child.pid ?? -1;
    windowsPicker = await waitFor("new Windows native folder-picker window", async () => {
      const candidates = windowsTopLevelWindowInventory().filter((candidate) => isNewWindowsNativePicker(candidate, previousHandles, applicationPid));
      return candidates[0] ?? null;
    }, (candidate) => candidate !== null, 15_000).catch(() => null);
    if (!windowsPicker) throw new Error(`OpenObsidian did not expose a new Windows native folder-picker window; before=${JSON.stringify(windowsBefore)}; after=${JSON.stringify(windowsTopLevelWindowInventory())}; OpenObsidian UI Automation controls=${JSON.stringify(windowsOpenVaultControlInventory(applicationPid))}`);
    pickerWindowId = String(windowsPicker.native_window_handle);
    pickerWindowTitle = `${windowsPicker.name} (${windowsPicker.class_name})`;
    const focusScript = `
      $ErrorActionPreference = "Stop"
      Add-Type -TypeDefinition @'
        using System;
        using System.Runtime.InteropServices;
        public static class OpenObsidianPickerWindow {
          [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
        }
'@
      $shell = New-Object -ComObject WScript.Shell
      $activated = [OpenObsidianPickerWindow]::SetForegroundWindow([IntPtr]${windowsPicker.native_window_handle})
      if (-not $activated) { $activated = $shell.AppActivate(${windowsPicker.process_id}) }
      if (-not $activated) { throw "Could not focus the detected Windows folder picker" }
      Start-Sleep -Milliseconds 300
      Write-Output "Focused native picker by handle=${windowsPicker.native_window_handle}; process=${windowsPicker.process_id}"
    `;
    const focusedPicker = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", focusScript], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
    const pickerScreenshot = await captureDesktopScreenshot("openobsidian-vault-picker-cancel-open.png");
    screenshots.push(relative(reportDirectory, pickerScreenshot));
    pickerOpenOcr = await readNativeFolderPickerOcr(pickerScreenshot);
    await captureAppDataBaselineBeforeCancel();
    const script = `
      $ErrorActionPreference = "Stop"
      $shell = New-Object -ComObject WScript.Shell
      if (-not $shell.AppActivate(${windowsPicker.process_id})) { throw "Could not focus the detected native folder picker" }
      Start-Sleep -Milliseconds 300
      $shell.SendKeys("{ESC}")
      Write-Output "Sent Escape to the native Windows folder picker."
    `;
    const escapeResult = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
    cancellationInteraction = `${focusedPicker}; ${escapeResult}`;
    remainingWindows = await waitFor("Windows native folder picker to close after Escape", async () => windowsTopLevelWindowInventory(), (windows) => !windows.some((candidate) => candidate.native_window_handle === windowsPicker?.native_window_handle), 10_000);
  } else {
    throw new Error(`Unsupported OpenObsidian folder picker platform ${process.platform}`);
  }

  await delay(1_000);
  let cancelledScreenshot: string;
  try {
    cancelledScreenshot = await captureDesktopScreenshot("openobsidian-vault-picker-cancelled.png");
    screenshots.push(relative(reportDirectory, cancelledScreenshot));
    openReport.picker_cancel_screenshot_path = relative(reportDirectory, cancelledScreenshot);
    openReport.picker_cancel_screenshots = screenshots.slice();
    openReport.picker_cancel_after_escape_screenshot_status = "captured";
    await saveReport();
  } catch (error) {
    openReport.picker_cancel_after_escape_screenshot_status = "failed";
    openReport.picker_cancel_after_escape_screenshot_error = error instanceof Error ? error.message : String(error);
    await saveReportAfterStageFailure("picker_cancel_screenshot", openReport, error);
    throw error;
  }
  let cancelledOcr: string;
  try {
    cancelledOcr = await readScreenshotOcr(cancelledScreenshot);
    openReport.picker_cancelled_screen_ocr = cancelledOcr.slice(0, 2_000);
    await saveReport();
  } catch (error) {
    openReport.picker_cancel_after_escape_ocr_status = "failed";
    openReport.picker_cancel_after_escape_ocr_error = error instanceof Error ? error.message : String(error);
    await saveReportAfterStageFailure("picker_cancel_ocr", openReport, error);
    throw error;
  }
  if (process.platform === "darwin") {
    if (!cancelledOcr.trim()) {
      const error = new Error("The macOS after-Escape screenshot OCR returned no readable text, so it cannot confirm the chooser closed");
      openReport.picker_cancel_after_escape_ocr_status = "failed";
      openReport.picker_cancel_close_error = error.message;
      await saveReportAfterStageFailure("picker_cancel_ocr", openReport, error);
      throw error;
    }
    if (nativeFolderPickerVisibleInOcr(cancelledOcr)) {
      const error = new Error(`The native macOS folder picker remained visible in the after-Escape screenshot; OCR=${JSON.stringify(cancelledOcr.slice(0, 2_000))}`);
      openReport.picker_cancel_close_error = error.message;
      await saveReportAfterStageFailure("picker_cancel_close", openReport, error);
      throw error;
    }
    if (!macPickerEntriesBeforeOpen || !macPickerPanelIdentity) {
      throw new Error("The macOS picker cancellation cannot prove closure without its pre-open inventory and exact panel identity");
    }
    let consecutiveAbsentSnapshots = 0;
    let latestCancellationInventory = "";
    try {
      const closeObservation = await waitFor(
        `the exact macOS cancellation panel ${macPickerPanelIdentity} to remain absent across three accessibility snapshots`,
        async () => {
          const descriptions = macOSApplicationWindowDescriptions(child);
          latestCancellationInventory = descriptions;
          const entries = macOSReadableAccessibilityWindowEntries(descriptions);
          const addedPanels = macOSAddedNativeOpenPanelEntries(macPickerEntriesBeforeOpen ?? [], entries);
          const identityCount = macOSNativeOpenPanelIdentityCount(entries, macPickerPanelIdentity ?? "");
          const absent = addedPanels.length === 0 && identityCount === 0;
          consecutiveAbsentSnapshots = absent ? consecutiveAbsentSnapshots + 1 : 0;
          if (absent) {
            macPickerCloseSnapshotInventories.push(descriptions);
            if (macPickerCloseSnapshotInventories.length > 3) macPickerCloseSnapshotInventories.shift();
          } else {
            macPickerCloseSnapshotInventories.length = 0;
          }
          return {descriptions, entries, addedPanels, identityCount, consecutiveAbsentSnapshots, closureSnapshotInventories: macPickerCloseSnapshotInventories.slice()};
        },
        (observation) => observation.addedPanels.length === 0
          && observation.identityCount === 0
          && observation.consecutiveAbsentSnapshots >= 3,
        15_000,
      );
      remainingMacAccessibilityWindows = closeObservation.descriptions;
      macPickerCloseAbsentSnapshots = closeObservation.consecutiveAbsentSnapshots;
      openReport.picker_cancel_accessibility_windows_after_escape = remainingMacAccessibilityWindows;
      openReport.picker_cancel_added_panels_after_escape = closeObservation.addedPanels;
      openReport.picker_cancel_panel_identity_match_count_after_escape = closeObservation.identityCount;
      openReport.picker_cancel_consecutive_absent_snapshots_after_escape = macPickerCloseAbsentSnapshots;
      openReport.picker_cancel_closure_snapshot_inventories_after_escape = closeObservation.closureSnapshotInventories;
    } catch (error) {
      openReport.picker_cancel_accessibility_windows_after_escape = latestCancellationInventory;
      openReport.picker_cancel_close_error = error instanceof Error ? error.message : String(error);
      openReport.picker_cancel_consecutive_absent_snapshots_after_escape = consecutiveAbsentSnapshots;
      openReport.picker_cancel_closure_snapshot_inventories_after_escape = macPickerCloseSnapshotInventories;
      await saveReportAfterStageFailure("picker_cancel_close", openReport, error);
      throw error;
    }
  }
  if (process.platform === "win32" && remainingWindows?.some((candidate) => candidate.native_window_handle === windowsPicker?.native_window_handle)) {
    throw new Error(`The native Windows folder picker remained visible after Escape; windows=${JSON.stringify(remainingWindows)}`);
  }
  const restoredWindow = await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-vault-after-picker-cancelled");
  const restoredVaultVisible = restoredWindow.ocrText.toLowerCase().includes("roundtrip fixture");
  const expectedNoteCountVisible = ocrTextContainsRefreshedMarkdownCount(restoredWindow.ocrText, expectedMarkdownCount);
  if (!restoredVaultVisible || !expectedNoteCountVisible) {
    throw new Error(`OpenObsidian did not restore the active vault after picker cancellation; OCR=${JSON.stringify(restoredWindow.ocrText.slice(0, 2_000))}`);
  }

  return {
    open_button_interaction: openButtonInteraction,
    picker_window_id: pickerWindowId,
    picker_window_title: pickerWindowTitle,
    cancellation_interaction: cancellationInteraction,
    screenshots,
    picker_open_verified: true,
    picker_open_screen_ocr: pickerOpenOcr,
    picker_open_accessibility_windows: pickerAccessibilityWindows,
    picker_closed_verified: true,
    picker_closed_accessibility_windows: remainingMacAccessibilityWindows,
    picker_cancel_panel_identity: macPickerPanelIdentity,
    picker_cancel_consecutive_absent_snapshots: macPickerCloseAbsentSnapshots,
    picker_cancel_closure_snapshot_inventories: macPickerCloseSnapshotInventories,
    picker_open_windows: windowsPicker,
    picker_closed_windows: remainingWindows,
    picker_closed_x11_windows: linuxWindowsAfterEscape,
    app_data_snapshot_before_cancel: appDataSnapshotBeforeCancel,
    app_data_changes_on_picker_open: appDataChangesOnPickerOpen,
    eframe_persistence_files_before_cancel: eframePersistenceFilesBeforeCancel,
    cancelled_screen_ocr: process.platform === "linux" ? null : cancelledOcr.slice(0, 2_000),
    restored_vault_visible: restoredVaultVisible,
    expected_markdown_count_visible: expectedNoteCountVisible,
    restored_ui_ocr: restoredWindow.ocrText.slice(0, 2_000),
  };
}

async function captureOpenObsidianScreenshot(
  windowId: string,
  child: ChildProcess,
  prefix = "openobsidian-vault",
  reportTarget: Record<string, unknown> = report.openobsidian_open as Record<string, unknown>,
): Promise<{pngPath: string; windowPngPath: string; ocrPngPath: string; ocrText: string; windowGeometry?: string}> {
  await focusOpenObsidian(child);
  const pngPath = await captureDesktopScreenshot(`${prefix}.png`);
  const windowsCapture = process.platform === "win32"
    ? await captureWindowsWindowScreenshot(child.pid ?? -1, `${prefix}-window.png`)
    : null;
  const windowPngPath = process.platform === "linux"
    ? await captureX11WindowScreenshot(windowId, `${prefix}-window.png`)
    : process.platform === "darwin"
      ? await captureMacOSWindowScreenshot(child.pid ?? -1, `${prefix}-window.png`)
      : windowsCapture?.pngPath ?? pngPath;
  if (windowsCapture) {
    reportTarget.native_window = {
      window_id: windowsCapture.window_id,
      title: windowsCapture.title,
      geometry: windowsCapture.geometry,
    };
  }
  const ocrPngPath = await prepareScreenshotForOcr(windowPngPath);
  const tesseract = process.platform === "win32" ? "tesseract.exe" : "tesseract";
  const pageSegmentationModes = process.platform === "darwin" || process.platform === "win32" ? ["11", "6"] : ["6"];
  const ocrText = pageSegmentationModes.map((mode) => execFileSync(tesseract, [ocrPngPath, "stdout", "--psm", mode], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim()).filter(Boolean).join("\n");
  return {pngPath, windowPngPath, ocrPngPath, ocrText, ...(windowsCapture ? {windowGeometry: windowsCapture.geometry} : {})};
}

async function withSourcePaneOcr<T extends {ocrPngPath: string; windowPngPath: string}>(capture: T): Promise<T & {
  sourcePaneOcrText: string;
  sourcePaneLabelVisible: boolean;
  sourcePaneOcrCropPath: string | null;
  sourcePaneOcrCropBounds: Record<string, unknown> | null;
}> {
  const sourcePane = await readSourcePaneOcr(capture.windowPngPath, capture.ocrPngPath);
  return {
    ...capture,
    sourcePaneOcrText: sourcePane.text,
    sourcePaneLabelVisible: sourcePane.labelVisible,
    sourcePaneOcrCropPath: sourcePane.cropPath,
    sourcePaneOcrCropBounds: sourcePane.cropBounds,
  };
}

type OcrWordBounds = {text: string; left: number; top: number; width: number; height: number};

function findOcrPhraseBounds(tsv: string, phrase: string, minimumTop = 0, lastMatch = false): OcrWordBounds | null {
  const expected = phrase.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const words: OcrWordBounds[] = [];
  for (const line of tsv.split(/\r?\n/).slice(1)) {
    const columns = line.split("\t");
    if (columns[0] !== "5" || columns.length < 12) continue;
    const text = (columns[11] ?? "").trim();
    if (!text) continue;
    const [left, top, width, height] = columns.slice(6, 10).map(Number);
    if (![left, top, width, height].every(Number.isFinite)) continue;
    words.push({text, left, top, width, height});
  }
  const normalized = words.map((word) => word.text.toLowerCase().replace(/[^a-z0-9]/g, ""));
  let selected: OcrWordBounds | null = null;
  for (let start = 0; expected.length > 0 && start + expected.length <= words.length; start += 1) {
    if (!expected.every((token, offset) => ocrTokenMatches(normalized[start + offset] ?? "", token))) continue;
    const match = words.slice(start, start + expected.length);
    const left = Math.min(...match.map((word) => word.left));
    const top = Math.min(...match.map((word) => word.top));
    const right = Math.max(...match.map((word) => word.left + word.width));
    const bottom = Math.max(...match.map((word) => word.top + word.height));
    if (top < minimumTop) continue;
    const bounds = {text: match.map((word) => word.text).join(" "), left, top, width: right - left, height: bottom - top};
    if (!lastMatch) return bounds;
    selected = bounds;
  }
  return selected;
}

function findOcrJoinedPhraseBoundsCandidates(tsv: string, phrase: string, minimumTop = 0, maxEdits = 1): OcrWordBounds[] {
  const expected = phrase.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!expected) return [];

  const wordsByLine = new Map<string, OcrWordBounds[]>();
  for (const line of tsv.split(/\r?\n/).slice(1)) {
    const columns = line.split("\t");
    if (columns[0] !== "5" || columns.length < 12) continue;
    const text = (columns[11] ?? "").trim();
    if (!text) continue;
    const [left, top, width, height] = columns.slice(6, 10).map(Number);
    if (![left, top, width, height].every(Number.isFinite)) continue;
    const lineId = columns.slice(1, 5).join(":");
    const words = wordsByLine.get(lineId) ?? [];
    words.push({text, left, top, width, height});
    wordsByLine.set(lineId, words);
  }

  const exactMatches = new Map<string, OcrWordBounds>();
  const approximateMatches = new Map<string, OcrWordBounds>();
  for (const words of wordsByLine.values()) {
    for (let start = 0; start < words.length; start += 1) {
      let normalized = "";
      for (let end = start; end < words.length; end += 1) {
        normalized += words[end]!.text.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (normalized.length > expected.length + maxEdits) break;
        const isExact = normalized === expected;
        if (!isExact && !editDistanceWithinLimit(normalized, expected, maxEdits)) continue;

        const match = words.slice(start, end + 1);
        const left = Math.min(...match.map((word) => word.left));
        const top = Math.min(...match.map((word) => word.top));
        if (top < minimumTop) continue;
        const right = Math.max(...match.map((word) => word.left + word.width));
        const bottom = Math.max(...match.map((word) => word.top + word.height));
        const bounds = {text: match.map((word) => word.text).join(" "), left, top, width: right - left, height: bottom - top};
        const matches = isExact ? exactMatches : approximateMatches;
        matches.set(`${left}:${top}:${right}:${bottom}`, bounds);
      }
    }
  }
  return [...(exactMatches.size > 0 ? exactMatches : approximateMatches).values()];
}

function findOcrJoinedPhraseBounds(tsv: string, phrase: string, minimumTop = 0, maxEdits = 1, lastMatch = false): OcrWordBounds | null {
  const matches = findOcrJoinedPhraseBoundsCandidates(tsv, phrase, minimumTop, maxEdits);
  return lastMatch ? matches.at(-1) ?? null : matches[0] ?? null;
}

async function pngDimensions(path: string): Promise<{width: number; height: number}> {
  const bytes = await readFile(path);
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") throw new Error(`Could not read PNG dimensions from ${path}`);
  return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
}

async function readSourcePaneOcr(windowImagePath: string, ocrImagePath: string): Promise<{
  text: string;
  cropPath: string | null;
  labelVisible: boolean;
  cropBounds: Record<string, unknown> | null;
}> {
  const tsv = runTesseractTsv(ocrImagePath);
  const sourceLabel = findOcrPhraseBounds(tsv, "Original Markdown source");
  if (!sourceLabel) return {text: "", cropPath: null, labelVisible: false, cropBounds: null};

  const windowDimensions = await pngDimensions(windowImagePath);
  const ocrDimensions = await pngDimensions(ocrImagePath);
  const scaleX = windowDimensions.width / ocrDimensions.width;
  const scaleY = windowDimensions.height / ocrDimensions.height;
  const sourceTop = sourceLabel.top + sourceLabel.height + 6;
  const previewLabel = findOcrPhraseBounds(tsv, "Markdown preview", sourceTop);
  const cropBounds: Record<string, unknown> = {
    source_label_bounds_ocr_image: sourceLabel,
    markdown_preview_label_bounds_ocr_image: previewLabel,
    window_image_dimensions: windowDimensions,
    ocr_image_dimensions: ocrDimensions,
    ocr_to_window_scale: {x: scaleX, y: scaleY},
    crop_source: "original_window_screenshot",
  };
  const sourceLabelValid = sourceLabel.left >= 0
    && sourceLabel.top >= 0
    && sourceLabel.width > 0
    && sourceLabel.height > 0
    && sourceLabel.left + sourceLabel.width <= ocrDimensions.width
    && sourceLabel.top + sourceLabel.height <= ocrDimensions.height;
  const previewLabelValid = Boolean(previewLabel
    && previewLabel.left >= 0
    && previewLabel.top >= 0
    && previewLabel.width > 0
    && previewLabel.height > 0
    && previewLabel.left + previewLabel.width <= ocrDimensions.width
    && previewLabel.top + previewLabel.height <= ocrDimensions.height
    && previewLabel.top > sourceTop);
  if (!sourceLabelValid || !previewLabelValid || !Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    return {
      text: "",
      cropPath: null,
      labelVisible: true,
      cropBounds: {
        ...cropBounds,
        crop_error: !sourceLabelValid
          ? "source_label_bounds_invalid"
          : !previewLabelValid
            ? "markdown_preview_label_missing_or_out_of_order"
            : "invalid_image_scale",
      },
    };
  }
  const left = Math.max(0, Math.min(windowDimensions.width - 1, Math.round((sourceLabel.left - 12) * scaleX)));
  const top = Math.max(0, Math.min(windowDimensions.height - 1, Math.round(sourceTop * scaleY)));
  const bottom = Math.min(windowDimensions.height, Math.round((previewLabel?.top ?? sourceTop) * scaleY));
  const width = windowDimensions.width - left;
  const height = bottom - top;
  if (left < 0 || top < 0 || width <= 0 || height <= 0
    || left + width > windowDimensions.width || top + height > windowDimensions.height) {
    return {
      text: "",
      cropPath: null,
      labelVisible: true,
      cropBounds: {
        ...cropBounds,
        crop_error: "window_crop_rectangle_invalid",
        window_crop_rectangle: {left, top, width, height},
      },
    };
  }
  const cropPath = join(reportDirectory, "openobsidian-source-pane-ocr-" + Date.now() + ".png");
  const imageMagick = process.platform === "linux" ? "convert" : "magick";
  const cropGeometry = width + "x" + height + "+" + left + "+" + top;
  execFileSync(imageMagick, [
    windowImagePath,
    "-crop",
    cropGeometry,
    "+repage",
    "-colorspace",
    "Gray",
    "-resize",
    "300%",
    cropPath,
  ], {stdio: "ignore"});
  return {
    text: runTesseractOcr(cropPath, ["6"]),
    cropPath,
    labelVisible: true,
    cropBounds: {
      ...cropBounds,
      window_crop_rectangle: {left, top, width, height},
    },
  };
}

function macOSOpenObsidianWindowBounds(child: ChildProcess): {x: number; y: number; width: number; height: number} {
  const script = `on run argv
    tell application "System Events"
      set targetProcess to first process whose unix id is (item 1 of argv as integer)
      set windowPosition to position of window 1 of targetProcess
      set windowSize to size of window 1 of targetProcess
      return (item 1 of windowPosition as integer) & "," & (item 2 of windowPosition as integer) & "," & (item 1 of windowSize as integer) & "," & (item 2 of windowSize as integer)
    end tell
  end run`;
  const value = execFileSync("osascript", ["-e", script, String(child.pid ?? -1)], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
  const bounds = value.match(/-?\d+/g)?.map(Number) ?? [];
  if (bounds.length < 4 || bounds[2] <= 0 || bounds[3] <= 0) throw new Error(`Could not read OpenObsidian's visible macOS window bounds: ${value}`);
  return {x: bounds[0] ?? 0, y: bounds[1] ?? 0, width: bounds[2] ?? 0, height: bounds[3] ?? 0};
}

async function clickVisibleOpenObsidianControl(
  child: ChildProcess,
  windowId: string,
  controlName: string,
  accessibilityFailure: string,
  fallbackAnchorPhrase?: string,
): Promise<string> {
  const capture = await captureOpenObsidianScreenshot(windowId, child, "openobsidian-control-target");
  const tesseract = process.platform === "win32" ? "tesseract.exe" : "tesseract";
  const windowOcrSource = {kind: "window" as const, ocrPath: capture.ocrPngPath, imagePath: capture.windowPngPath, candidates: [] as string[]};
  const ocrSources: Array<{kind: "window" | "desktop"; ocrPath: string; imagePath: string; candidates: string[]}> = process.platform === "darwin"
    ? []
    : [windowOcrSource];
  if (process.platform === "darwin") {
    const desktopOcrPath = join(reportDirectory, "openobsidian-control-target-desktop-ocr.png");
    execFileSync("magick", [capture.pngPath, "-colorspace", "Gray", "-level", "0%,15%", "-resize", "200%", desktopOcrPath], {stdio: "ignore"});
    ocrSources.push({kind: "desktop", ocrPath: desktopOcrPath, imagePath: capture.pngPath, candidates: []});
  }
  let bounds: OcrWordBounds | null = null;
  let ocrSource = ocrSources[0]!;
  let ocrSize = await pngDimensions(ocrSource.ocrPath);
  for (const source of ocrSources) {
    source.candidates = ["11", "6"].map((mode) => execFileSync(tesseract, [source.ocrPath, "stdout", "--psm", mode, "tsv"], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}));
    const targetBounds = source.candidates.map((candidate) => findOcrPhraseBounds(candidate, controlName)).find(Boolean) ?? null;
    if (targetBounds) {
      bounds = targetBounds;
      ocrSource = source;
      ocrSize = await pngDimensions(source.ocrPath);
      break;
    }
  }
  let clickDescription = `OCR label ${JSON.stringify(bounds?.text ?? controlName)}`;
  let xFraction: number;
  let yFraction: number;
  if (!bounds) {
    const anchorPhrase = controlName === "Read note source preview"
      ? "Read up to 16 KiB"
      : controlName === "Close source preview"
        ? fallbackAnchorPhrase ?? "Source"
      : controlName === "Refresh note list"
        ? fallbackAnchorPhrase ?? "Markdown files found"
        : controlName === "Note to inspect"
          ? fallbackAnchorPhrase ?? "Previous note"
        : fallbackAnchorPhrase ?? null;
    let anchor: OcrWordBounds | null = null;
    if (anchorPhrase) {
      for (const source of ocrSources) {
        anchor = source.candidates.map((candidate) => findOcrPhraseBounds(candidate, anchorPhrase)).find(Boolean) ?? null;
        if (anchor) {
          ocrSource = source;
          ocrSize = await pngDimensions(source.ocrPath);
          break;
        }
      }
    }
    if (!anchorPhrase || !anchor) {
      const candidates = ocrSources.flatMap((source) => source.candidates);
      const detectedWords = candidates.map((candidate) => candidate.split(/\r?\n/).slice(1).map((line) => line.split("\t")[11]?.trim()).filter(Boolean).join(" ")).join(" | ");
      throw new Error(`Accessibility failed (${accessibilityFailure}); OCR could not locate ${JSON.stringify(controlName)} or anchor ${JSON.stringify(anchorPhrase)}; detected words=${JSON.stringify(detectedWords.slice(0, 2_000))}; OCR=${JSON.stringify(capture.ocrText.slice(0, 2_000))}`);
    }
    const imageSize = await pngDimensions(ocrSource.imagePath);
    const scaleX = ocrSize.width / imageSize.width;
    const scaleY = ocrSize.height / imageSize.height;
    if (controlName === "Refresh note list") {
      xFraction = (anchor.left - 58 * scaleX) / ocrSize.width;
      yFraction = (anchor.top + anchor.height / 2) / ocrSize.height;
    } else if (controlName === "Note to inspect") {
      xFraction = anchorPhrase === "Nested"
        ? (anchor.left - 55 * scaleX) / ocrSize.width
        : (anchor.left + anchor.width + 55 * scaleX) / ocrSize.width;
      yFraction = (anchor.top + anchor.height / 2) / ocrSize.height;
    } else if (controlName === "Previous note") {
      xFraction = (anchor.left - 155 * scaleX) / ocrSize.width;
      yFraction = (anchor.top + anchor.height / 2) / ocrSize.height;
    } else if (controlName === "Next note") {
      xFraction = (anchor.left + anchor.width + 55 * scaleX) / ocrSize.width;
      yFraction = (anchor.top + anchor.height / 2) / ocrSize.height;
    } else if (controlName === "Review and confirm note creation") {
      xFraction = (anchor.left + 100 * scaleX) / ocrSize.width;
      yFraction = (anchor.top + 77 * scaleY) / ocrSize.height;
    } else {
      let verticalControlOffset = 18;
      if (controlName === "Preview note creation") verticalControlOffset = 90;
      if (process.platform === "darwin" && controlName === "Read note source preview") verticalControlOffset = 28;
      if (controlName === "Close source preview") {
        verticalControlOffset = anchorPhrase === "Note source preview" ? 70 : 28;
        if (process.platform === "darwin" && anchorPhrase === "Note source preview") verticalControlOffset = 86;
      }
      xFraction = (anchor.left + 75 * scaleX) / ocrSize.width;
      yFraction = (anchor.top + verticalControlOffset * scaleY) / ocrSize.height;
    }
    clickDescription = `OCR layout anchor ${JSON.stringify(anchor.text)} for ${JSON.stringify(controlName)}`;
  } else {
    xFraction = (bounds.left + bounds.width / 2) / ocrSize.width;
    yFraction = (bounds.top + bounds.height / 2) / ocrSize.height;
  }
  if (!Number.isFinite(xFraction) || !Number.isFinite(yFraction)
    || xFraction < 0 || xFraction > 1 || yFraction < 0 || yFraction > 1) {
    throw new Error(`OCR mapped ${JSON.stringify(controlName)} outside the captured OpenObsidian window`);
  }
  let interaction: string;

  if (process.platform === "linux") {
    const geometry = execFileSync("xdotool", ["getwindowgeometry", "--shell", windowId], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
    const read = (key: string): number => Number(geometry.match(new RegExp(`^${key}=(\\d+)$`, "m"))?.[1] ?? NaN);
    const width = read("WIDTH");
    const height = read("HEIGHT");
    if (!(width > 0 && height > 0)) throw new Error(`Could not read Linux OpenObsidian window size for OCR click: ${geometry}`);
    const x = Math.round(xFraction * width);
    const y = Math.round(yFraction * height);
    xdotool("windowfocus", "--sync", windowId);
    xdotool("mousemove", "--sync", "--window", windowId, String(x), String(y));
    xdotool("mousedown", "1");
    await delay(80);
    xdotool("mouseup", "1");
    interaction = `xdotool clicked ${clickDescription} at window coordinates (${x}, ${y}) in ${windowId}`;
  } else if (process.platform === "darwin") {
    const swiftPath = join(workDirectory, "openobsidian-native-control-click.swift");
    await writeFile(swiftPath, `import AppKit
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3,
      let xFraction = Double(CommandLine.arguments[1]),
      let yFraction = Double(CommandLine.arguments[2]) else {
    fatalError("Expected desktop OCR click fractions")
}
guard NSScreen.screens.count == 1 else {
    fatalError("Desktop OCR click mapping requires the single-display macOS CI screen")
}
guard let screenNumber = NSScreen.screens[0].deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
    fatalError("Could not read the macOS CI screen number")
}
let displayID = CGDirectDisplayID(screenNumber.uint32Value)
let displayBounds = CGDisplayBounds(displayID)
guard displayBounds.width > 0, displayBounds.height > 0 else {
    fatalError("Could not read the selected macOS display bounds in Quartz coordinates")
}
guard (0.0...1.0).contains(xFraction), (0.0...1.0).contains(yFraction) else {
    fatalError("Desktop OCR click fractions fall outside the single-display screenshot")
}
let point = CGPoint(
    x: displayBounds.origin.x + CGFloat(xFraction) * displayBounds.width,
    y: displayBounds.origin.y + CGFloat(yFraction) * displayBounds.height
)
for type in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else {
        fatalError("Could not create a mouse event")
    }
    event.post(tap: .cghidEventTap)
    if type == .leftMouseDown { Thread.sleep(forTimeInterval: 0.08) }
}
print("\(point.x),\(point.y)")
`);
    const quartzPoint = execFileSync("swift", [swiftPath, String(xFraction), String(yFraction)], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
    interaction = `CoreGraphics clicked ${clickDescription} at desktop fractions (${xFraction}, ${yFraction}), mapped to Quartz screen coordinates (${quartzPoint})`;
  } else if (process.platform === "win32") {
    const geometry = capture.windowGeometry?.match(/x=(-?\d+) y=(-?\d+) width=(\d+) height=(\d+)/);
    if (!geometry) throw new Error(`Could not read OpenObsidian window geometry for OCR click: ${capture.windowGeometry ?? "unavailable"}`);
    const [, xText, yText, widthText, heightText] = geometry;
    const x = Math.round(Number(xText) + xFraction * Number(widthText));
    const y = Math.round(Number(yText) + yFraction * Number(heightText));
    const script = `
      $ErrorActionPreference = "Stop"
      Add-Type -TypeDefinition @'
        using System;
        using System.Runtime.InteropServices;
        public static class OpenObsidianOcrControlClick {
          [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
          [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
        }
'@
      if (-not [OpenObsidianOcrControlClick]::SetCursorPos(${x}, ${y})) { throw "Could not move the pointer to the OCR matched control" }
      Start-Sleep -Milliseconds 80
      [OpenObsidianOcrControlClick]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 60
      [OpenObsidianOcrControlClick]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
      Write-Output "Clicked OCR matched control at (${x}, ${y})."
    `;
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
    interaction = `${output} ${clickDescription}`;
  } else {
    throw new Error(`OCR control activation is not configured for ${process.platform}`);
  }
  return `Visible OCR fallback after accessibility failure ${JSON.stringify(accessibilityFailure)}; ${interaction}; screenshot=${relative(reportDirectory, capture.windowPngPath)}`;
}

async function invokeNativeAccessibleControl(
  child: ChildProcess,
  windowId: string,
  controlName: string,
  fallbackAnchorPhrase?: string,
  waitUntilEnabled = false,
): Promise<string> {
  const processId = child.pid;
  if (!processId) throw new Error("OpenObsidian did not expose its process id for native accessibility automation");

  if (controlName === "Refresh note list" && waitUntilEnabled && process.platform !== "win32") {
    return await clickVisibleOpenObsidianControl(
      child,
      windowId,
      controlName,
      `${process.platform} accessibility does not expose the egui refresh control`,
      fallbackAnchorPhrase,
    );
  }

  if (controlName === "Preview note creation" && waitUntilEnabled && process.platform === "linux") {
    return await clickLinuxCanvasNotePreviewFromCiGeometry(windowId);
  }

  if (controlName === "Preview note creation" && waitUntilEnabled && process.platform === "darwin") {
    return await clickMacOsCanvasNotePreviewFromCiGeometry(child);
  }

  const canvasTextEditAction = controlName === "Load Canvas text card"
    ? "load"
    : controlName === "Save Canvas text"
      ? "save"
      : null;
  if (canvasTextEditAction && waitUntilEnabled && process.platform === "linux") {
    return await clickLinuxCanvasTextEditButtonFromCiGeometry(windowId, canvasTextEditAction);
  }
  if (canvasTextEditAction && waitUntilEnabled && process.platform === "darwin") {
    return await clickMacOsCanvasTextEditButtonFromCiGeometry(child, canvasTextEditAction);
  }

  const canvasNoteAction = controlName === "Review and confirm note creation"
    ? "review"
    : controlName === "Confirm and create note"
      ? "confirm"
      : null;
  if (canvasNoteAction && waitUntilEnabled && process.platform === "linux") {
    return await clickLinuxCanvasNoteReviewOrConfirmFromCiGeometry(windowId, canvasNoteAction);
  }
  if (canvasNoteAction && waitUntilEnabled && process.platform === "darwin") {
    return await clickMacOsCanvasNoteReviewOrConfirmFromCiGeometry(child, canvasNoteAction);
  }

  if (process.platform === "linux") {
    const script = `
import json
import sys
import time
import pyatspi

process_id = int(sys.argv[1])
target_name = sys.argv[2]
deadline = time.monotonic() + 5
last_names = []
while time.monotonic() < deadline:
    desktop = pyatspi.Registry.getDesktop(0)
    pending = [desktop]
    seen = set()
    while pending:
        accessible = pending.pop()
        try:
            name = accessible.getName() or ""
            role = accessible.getRoleName() or ""
            try:
                owner_pid = accessible.get_process_id()
            except Exception:
                owner_pid = None
            if owner_pid == process_id and name:
                last_names.append({"name": name, "role": role})
                if name == target_name:
                    actions = accessible.queryAction()
                    for index in range(actions.nActions):
                        action_name = actions.getName(index)
                        if action_name.lower() in ("click", "press", "activate", "open"):
                            actions.doAction(index)
                            print(json.dumps({"name": name, "role": role, "action": action_name}))
                            sys.exit(0)
                    raise RuntimeError("target control exposes no click/press/activate action")
            child_count = accessible.getChildCount()
            for index in range(child_count):
                child_accessible = accessible.getChildAtIndex(index)
                try:
                    identity = child_accessible.get_hash()
                except Exception:
                    identity = id(child_accessible)
                if identity not in seen:
                    seen.add(identity)
                    pending.append(child_accessible)
        except RuntimeError:
            raise
        except Exception:
            continue
    time.sleep(0.25)
print(json.dumps({"error": "accessible control was not found", "target": target_name, "process_id": process_id, "visible_names": last_names[-80:]}), file=sys.stderr)
sys.exit(1)
`;
    try {
      return execFileSync("python3", ["-c", script, String(processId), controlName], {
        encoding: "utf8",
        env: {...process.env, OPENOBSIDIAN_WINDOW_PROCESS_ID: String(processId)},
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {stderr?: Buffer | string; stdout?: Buffer | string};
      const output = [failure.stdout, failure.stderr].filter(Boolean).map(String).join("\n").trim();
      return await clickVisibleOpenObsidianControl(child, windowId, controlName, `Linux AT-SPI: ${output || failure.message}`, fallbackAnchorPhrase);
    }
  }

  if (process.platform === "darwin") {
    const script = `on run argv
      set processId to (item 1 of argv) as integer
      set targetName to item 2 of argv
      tell application "System Events"
        set targetProcess to first process whose unix id is processId
        set frontmost of targetProcess to true
        set visibleNames to {}
        repeat with candidate in entire contents of window 1 of targetProcess
          try
            set candidateName to name of candidate as text
            set candidateRole to role of candidate as text
            if candidateName is not "" then set end of visibleNames to candidateRole & ":" & candidateName
            if candidateName is targetName then
              try
                perform action "AXPress" of candidate
                return "AXPress|" & candidateRole & "|" & candidateName
              on error pressError
                try
                  click candidate
                  return "click|" & candidateRole & "|" & candidateName & "|" & pressError
                on error clickError
                  error "Found " & candidateRole & " " & candidateName & " but activation failed: " & pressError & "; " & clickError
                end try
              end try
            end if
          end try
        end repeat
        error "Accessible control not found: " & targetName & "; observed=" & (visibleNames as text)
      end tell
    end run`;
    try {
      return execFileSync("osascript", ["-e", script, String(processId), controlName], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {stderr?: Buffer | string; stdout?: Buffer | string};
      const output = [failure.stdout, failure.stderr].filter(Boolean).map(String).join("\n").trim();
      return await clickVisibleOpenObsidianControl(child, windowId, controlName, `macOS Accessibility: ${output || failure.message}`, fallbackAnchorPhrase);
    }
  }

  if (process.platform === "win32") {
    const script = `
      $ErrorActionPreference = "Stop"
      Add-Type -AssemblyName UIAutomationClient
      Add-Type -AssemblyName UIAutomationTypes
      $processId = [int]$env:OPENOBSIDIAN_WINDOW_PROCESS_ID
      $targetName = $env:OPENOBSIDIAN_ACCESSIBLE_CONTROL_NAME
      $root = [System.Windows.Automation.AutomationElement]::RootElement
      $processCondition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
        $processId
      )
      $visibleNames = @()
      $waitForEnabled = $env:OPENOBSIDIAN_WAIT_FOR_ENABLED_CONTROL -eq "1"
      $deadline = [DateTime]::UtcNow.AddSeconds(30)
      do {
        $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $processCondition)
        foreach ($element in $elements) {
          try {
            $current = $element.Current
            if ($current.Name) { $visibleNames += "$($current.ControlType.ProgrammaticName):$($current.Name)" }
            if ($current.Name -ne $targetName) { continue }
            $enabledBeforeActivation = [bool]$current.IsEnabled
            if ($waitForEnabled -and -not $enabledBeforeActivation) { continue }
            try {
              $element.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern).ScrollIntoView()
            } catch {}
            $method = $null
            try {
              $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
              $method = "InvokePattern.Invoke"
            } catch {
              try {
                $toggle = $element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
                if ($toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::Off) {
                  $toggle.Toggle()
                  $method = "TogglePattern.Toggle"
                }
              } catch {}
            }
            if (-not $method) {
              try {
                $expand = $element.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
                if ($expand.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed) {
                  $expand.Expand()
                  $method = "ExpandCollapsePattern.Expand"
                }
              } catch {}
            }
            if (-not $method) {
              try {
                $element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
                $method = "SelectionItemPattern.Select"
              } catch {}
            }
            if (-not $method) { throw "Control was found but exposes no usable UI Automation activation pattern" }
            $enabledAfterActivation = $null
            try { $enabledAfterActivation = [bool]$element.Current.IsEnabled } catch {}
            [pscustomobject]@{
              name = $current.Name
              control_type = $current.ControlType.ProgrammaticName
              action = $method
              is_enabled = $enabledBeforeActivation
              is_enabled_before_activation = $enabledBeforeActivation
              is_enabled_after_activation = $enabledAfterActivation
              is_offscreen = [bool]$current.IsOffscreen
            } | ConvertTo-Json -Compress
            exit 0
          } catch {
            if ($_.Exception.Message -like "Control was found*") { throw }
          }
        }
        if (-not $waitForEnabled) { break }
        if ([DateTime]::UtcNow -ge $deadline) {
          throw "Timed out waiting for enabled control: $targetName; observed=$($visibleNames -join ' | ')"
        }
        Start-Sleep -Milliseconds 250
      } while ($true)
      throw "Accessible control not found: $targetName; observed=$($visibleNames -join ' | ')"
    `;
    try {
      return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
        encoding: "utf8",
        env: {
          ...process.env,
          OPENOBSIDIAN_WINDOW_PROCESS_ID: String(processId),
          OPENOBSIDIAN_ACCESSIBLE_CONTROL_NAME: controlName,
          OPENOBSIDIAN_WAIT_FOR_ENABLED_CONTROL: waitUntilEnabled ? "1" : "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {stderr?: Buffer | string; stdout?: Buffer | string};
      const output = [failure.stdout, failure.stderr].filter(Boolean).map(String).join("\n").trim();
      if (waitUntilEnabled && output.includes("Timed out waiting for enabled control")) throw new Error(output);
      return await clickVisibleOpenObsidianControl(child, windowId, controlName, `Windows UI Automation: ${output || failure.message}`, fallbackAnchorPhrase);
    }
  }

  throw new Error(`Native accessibility automation is not configured for ${process.platform}`);
}

async function runReferenceSourcePreview(
  child: ChildProcess,
  window: {window_id: string},
  appDataRoot: string,
  vaultBaseline: SnapshotEntry[],
): Promise<void> {
  const open = report.openobsidian_open as Record<string, unknown>;
  const previewReport: Record<string, unknown> = {
    status: "in_progress",
    selected_note_path: seedMarkdownPath,
    expected_source_sha256: vaultBaseline.find((entry) => entry.path === seedMarkdownPath)?.sha256 ?? null,
    expected_source_marker: "Original bytes stay untouched.",
  };
  open.source_preview = previewReport;

  const vaultBefore = await snapshotTree(vaultRoot);
  ensureExactSnapshot(vaultBaseline, vaultBefore, "OpenObsidian vault before reference source preview");
  const appDataBefore = await snapshotTree(appDataRoot);
  const canonicalVaultRoot = await realpath(vaultRoot);
  const canonicalAppDataRoot = await realpath(appDataRoot);
  const forbiddenPersistencePaths = [vaultRoot, canonicalVaultRoot, appDataRoot, canonicalAppDataRoot];
  previewReport.vault_snapshot_before = vaultBefore;
  previewReport.app_data_snapshot_before = appDataBefore;
  previewReport.app_data_change_policy = "App data remains byte-identical except macOS app.ron eframe window/egui UI-state persistence, which is inspected for vault and app-data paths.";

  previewReport.expand_preview_action = await invokeNativeAccessibleControl(child, window.window_id, "Note source preview");
  await delay(500);
  previewReport.read_source_action = await invokeNativeAccessibleControl(child, window.window_id, "Read note source preview");

  const visiblePreview = await waitFor("OpenObsidian to display the selected reference source", async () => {
    await delay(350);
    const capture = await withSourcePaneOcr(await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-source-preview"));
    previewReport.preview_screen_ocr = capture.ocrText.slice(0, 4_000);
    previewReport.preview_source_pane_ocr = capture.sourcePaneOcrText.slice(0, 4_000);
    previewReport.preview_source_pane_crop = capture.sourcePaneOcrCropPath
      ? relative(reportDirectory, capture.sourcePaneOcrCropPath)
      : null;
    previewReport.preview_source_pane_crop_bounds = capture.sourcePaneOcrCropBounds;
    return capture;
  }, (capture) => ocrTextContainsFuzzyPhraseAcrossLines(capture.sourcePaneOcrText, "Original bytes stay untouched", 1), 30_000);
  previewReport.preview_screenshot = relative(reportDirectory, visiblePreview.pngPath);
  previewReport.preview_window_screenshot = relative(reportDirectory, visiblePreview.windowPngPath);
  previewReport.source_marker_visible = ocrTextContainsFuzzyPhraseAcrossLines(visiblePreview.sourcePaneOcrText, "Original bytes stay untouched", 1);

  const vaultAfterPreview = await snapshotTree(vaultRoot);
  const appDataAfterPreview = await snapshotTree(appDataRoot);
  const vaultChangesAfterPreview = changedPaths(vaultBefore, vaultAfterPreview);
  const appDataChangesAfterPreview = changedPaths(appDataBefore, appDataAfterPreview);
  const eframeFilesAfterPreview = await readSnapshotTextFiles(appDataRoot, appDataAfterPreview, (path) => path.toLowerCase().endsWith(".ron"));
  previewReport.vault_snapshot_after_preview = vaultAfterPreview;
  previewReport.app_data_snapshot_after_preview = appDataAfterPreview;
  previewReport.vault_changes_after_preview = vaultChangesAfterPreview;
  previewReport.app_data_changes_after_preview = appDataChangesAfterPreview;
  previewReport.eframe_persistence_files_after_preview = eframeFilesAfterPreview;
  previewReport.vault_unchanged_after_preview = vaultChangesAfterPreview.length === 0;
  previewReport.app_data_unchanged_after_preview = appDataChangesAfterPreview.length === 0;
  await saveReport();
  ensureExactSnapshot(vaultBefore, vaultAfterPreview, "OpenObsidian reference source preview");
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataChangesAfterPreview,
    eframeFilesAfterPreview,
    "OpenObsidian app data during reference source preview",
    forbiddenPersistencePaths,
  );
  previewReport.app_data_change_policy_passed_after_preview = true;

  previewReport.close_preview_action = await invokeNativeAccessibleControl(
    child,
    window.window_id,
    "Close source preview",
    process.platform === "linux" ? "Note source preview" : "Source Nested",
  );
  const closedPreview = await waitFor("OpenObsidian to close the reference source preview", async () => {
    await delay(350);
    const capture = await withSourcePaneOcr(await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-source-preview-closed"));
    previewReport.closed_screen_ocr = capture.ocrText.slice(0, 4_000);
    return capture;
  }, (capture) => !capture.sourcePaneLabelVisible
    && !ocrTextContainsFuzzyPhraseAcrossLines(capture.ocrText, "Original bytes stay untouched", 1), 30_000);
  previewReport.closed_screenshot = relative(reportDirectory, closedPreview.pngPath);
  previewReport.preview_closed = true;

  const vaultAfterClose = await snapshotTree(vaultRoot);
  const appDataAfterClose = await snapshotTree(appDataRoot);
  const vaultChangesAfterClose = changedPaths(vaultBefore, vaultAfterClose);
  const appDataChangesAfterClose = changedPaths(appDataBefore, appDataAfterClose);
  const eframeFilesAfterClose = await readSnapshotTextFiles(appDataRoot, appDataAfterClose, (path) => path.toLowerCase().endsWith(".ron"));
  previewReport.vault_snapshot_after_close = vaultAfterClose;
  previewReport.app_data_snapshot_after_close = appDataAfterClose;
  previewReport.vault_changes_after_close = vaultChangesAfterClose;
  previewReport.app_data_changes_after_close = appDataChangesAfterClose;
  previewReport.eframe_persistence_files_after_close = eframeFilesAfterClose;
  previewReport.vault_unchanged_after_close = vaultChangesAfterClose.length === 0;
  previewReport.app_data_unchanged_after_close = appDataChangesAfterClose.length === 0;
  await saveReport();
  ensureExactSnapshot(vaultBefore, vaultAfterClose, "OpenObsidian reference preview close");
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataChangesAfterClose,
    eframeFilesAfterClose,
    "OpenObsidian app data after reference preview close",
    forbiddenPersistencePaths,
  );
  previewReport.app_data_change_policy_passed_after_close = true;
  previewReport.status = "passed";
  await saveReport();
}

async function selectFirstNoteWithPreviousButton(
  child: ChildProcess,
  windowId: string,
  targetPath: string,
  sortedNotePaths: string[],
): Promise<string> {
  if (sortedNotePaths[0] !== targetPath) {
    throw new Error(`Previous-note selector fallback requires ${targetPath} to sort first; actual paths=${JSON.stringify(sortedNotePaths)}`);
  }
  if (process.platform === "linux" || process.platform === "darwin") {
    if (sortedNotePaths[1] !== seedMarkdownPath) {
      throw new Error(`Previous-note selector fallback requires ${seedMarkdownPath} to be immediately after ${targetPath}; actual paths=${JSON.stringify(sortedNotePaths)}`);
    }
    return await invokeNativeAccessibleControl(child, windowId, "Previous note", "Nested");
  }
  if (process.platform === "win32") {
    const script = `
      $ErrorActionPreference = "Stop"
      $shell = New-Object -ComObject WScript.Shell
      if (-not $shell.AppActivate(${child.pid ?? -1})) { throw "Could not focus OpenObsidian before keyboard inspector selection" }
      Start-Sleep -Milliseconds 100
      $shell.SendKeys("{HOME}")
      Start-Sleep -Milliseconds 100
      $shell.SendKeys("{ENTER}")
      Write-Output "Keyboard selected the first inspector menu option (${targetPath}) with Home and Enter."
    `;
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }
  throw new Error(`Keyboard inspector selection is not configured for ${process.platform}`);
}

async function clickLinuxNoteNavigationButtonFromCiGeometry(
  windowId: string,
  direction: "previous" | "next",
): Promise<string> {
  const controlName = direction === "previous" ? "Previous note" : "Next note";
  const diagnosticPrefix = `OpenObsidian CI ${direction}-note input:`;
  const bounds = await readOpenObsidianCiButtonBounds(controlName, diagnosticPrefix);
  const x = Math.round(((bounds.left + bounds.right) / 2) * bounds.pixelsPerPoint);
  const y = Math.round(((bounds.top + bounds.bottom) / 2) * bounds.pixelsPerPoint);
  xdotool("windowfocus", "--sync", windowId);
  xdotool("mousemove", "--sync", "--window", windowId, String(x), String(y));
  xdotool("mousedown", "1");
  await delay(80);
  xdotool("mouseup", "1");
  return `xdotool clicked ${controlName} from CI response geometry at window coordinates (${x}, ${y}); ${bounds.diagnostic}`;
}

async function clickMacOsNoteNavigationButtonFromCiGeometry(
  child: ChildProcess,
  direction: "previous" | "next",
): Promise<string> {
  await focusOpenObsidian(child);
  const window = macOSOpenObsidianWindowBounds(child);
  const macOSRunnerTitlebarHeightPoints = 32;
  await postMacOsPointerEvent(window.x + 5, window.y + macOSRunnerTitlebarHeightPoints + 5, false);
  const controlName = direction === "previous" ? "Previous note" : "Next note";
  const diagnosticPrefix = `OpenObsidian CI ${direction}-note input:`;
  const bounds = await readOpenObsidianCiButtonBounds(controlName, diagnosticPrefix);
  const x = Math.round(window.x + (bounds.left + bounds.right) / 2);
  const y = Math.round(window.y + macOSRunnerTitlebarHeightPoints + (bounds.top + bounds.bottom) / 2);
  await postMacOsPointerEvent(x, y, true);
  return `CoreGraphics clicked ${controlName} at screen point (${x}, ${y}) from egui response geometry; window=${JSON.stringify(window)}; ${bounds.diagnostic}`;
}

async function clickLinuxResolveButtonFromCiGeometry(windowId: string, authoredNotePath: string): Promise<string> {
  xdotool("windowfocus", "--sync", windowId);
  xdotool("mousemove", "--sync", "--window", windowId, "1", "1");
  const bounds = await readOpenObsidianCiButtonBounds(
    "Resolve link status",
    "OpenObsidian CI resolve-link-status input:",
    authoredNotePath,
  );
  const x = Math.round(((bounds.left + bounds.right) / 2) * bounds.pixelsPerPoint);
  const y = Math.round(((bounds.top + bounds.bottom) / 2) * bounds.pixelsPerPoint);
  xdotool("mousemove", "--sync", "--window", windowId, String(x), String(y));
  xdotool("mousedown", "1");
  await delay(80);
  xdotool("mouseup", "1");
  return `xdotool clicked Resolve link status from CI response geometry at window coordinates (${x}, ${y}); ${bounds.diagnostic}`;
}

async function readOpenObsidianCiButtonBounds(
  controlName: string,
  diagnosticPrefix: string,
  expectedSelectedPath?: string,
  diagnosticLogPath = join(reportDirectory, "openobsidian.log"),
  afterLineCount?: number,
): Promise<{diagnostic: string; left: number; top: number; right: number; bottom: number; pixelsPerPoint: number}> {
  const relevantLines = (lines: string[]) => lines
    .filter((line) => line.trim().length > 0)
    .slice(afterLineCount ?? 0);
  const diagnosticLines = await waitFor(
    `OpenObsidian to report the enabled ${controlName} button bounds`,
    async () => (await readFile(diagnosticLogPath, "utf8").catch(() => "")).split(/\r?\n/),
    (lines) => relevantLines(lines).some((line) => line.startsWith(diagnosticPrefix)
      && line.includes("enabled=true")
      && line.includes("pixels_per_point=")
      && (expectedSelectedPath === undefined || line.includes(`selected=${expectedSelectedPath}`))),
    5_000,
  );
  const diagnostic = [...relevantLines(diagnosticLines)].reverse().find((line) => (
    line.startsWith(diagnosticPrefix)
    && line.includes("enabled=true")
    && line.includes("pixels_per_point=")
    && (expectedSelectedPath === undefined || line.includes(`selected=${expectedSelectedPath}`))
  ));
  const geometry = diagnostic?.match(/response_rect=\[\[(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\]\s+-\s+\[(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\]\], pixels_per_point=(\d+(?:\.\d+)?)/);
  if (!diagnostic || !geometry) {
    throw new Error(`OpenObsidian did not report usable ${controlName} button bounds: ${diagnostic ?? "missing diagnostic"}`);
  }
  const bounds = {
    diagnostic,
    left: Number(geometry[1]),
    top: Number(geometry[2]),
    right: Number(geometry[3]),
    bottom: Number(geometry[4]),
    pixelsPerPoint: Number(geometry[5]),
  };
  if (!(bounds.pixelsPerPoint > 0) || !(bounds.right > bounds.left) || !(bounds.bottom > bounds.top)) {
    throw new Error(`OpenObsidian reported invalid ${controlName} button geometry: ${diagnostic}`);
  }
  return bounds;
}

async function clickLinuxCanvasNotePreviewFromCiGeometry(windowId: string): Promise<string> {
  const controlName = "Preview note creation";
  const diagnosticPrefix = "OpenObsidian CI canvas-note-preview input:";
  const diagnosticLogPath = join(reportDirectory, "openobsidian-canvas-note-create.log");
  xdotool("windowfocus", "--sync", windowId);
  const afterLineCount = (await readFile(diagnosticLogPath, "utf8").catch(() => ""))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length;
  xdotool("mousemove", "--sync", "--window", windowId, "1", "1");
  const bounds = await readOpenObsidianCiButtonBounds(
    controlName,
    diagnosticPrefix,
    undefined,
    diagnosticLogPath,
    afterLineCount,
  );
  const x = Math.round(((bounds.left + bounds.right) / 2) * bounds.pixelsPerPoint);
  const y = Math.round(((bounds.top + bounds.bottom) / 2) * bounds.pixelsPerPoint);
  xdotool("mousemove", "--sync", "--window", windowId, String(x), String(y));
  xdotool("mousedown", "1");
  await delay(80);
  xdotool("mouseup", "1");
  return `xdotool clicked ${controlName} from CI response geometry at window coordinates (${x}, ${y}); ${bounds.diagnostic}`;
}

async function clickMacOsCanvasNotePreviewFromCiGeometry(child: ChildProcess): Promise<string> {
  await focusOpenObsidian(child);
  const window = macOSOpenObsidianWindowBounds(child);
  const macOSRunnerTitlebarHeightPoints = 32;
  const controlName = "Preview note creation";
  const diagnosticPrefix = "OpenObsidian CI canvas-note-preview input:";
  const diagnosticLogPath = join(reportDirectory, "openobsidian-canvas-note-create.log");
  const afterLineCount = (await readFile(diagnosticLogPath, "utf8").catch(() => ""))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length;
  await postMacOsPointerEvent(window.x + 5, window.y + macOSRunnerTitlebarHeightPoints + 5, false);
  const bounds = await readOpenObsidianCiButtonBounds(
    controlName,
    diagnosticPrefix,
    undefined,
    diagnosticLogPath,
    afterLineCount,
  );
  const x = Math.round(window.x + (bounds.left + bounds.right) / 2);
  const y = Math.round(window.y + macOSRunnerTitlebarHeightPoints + (bounds.top + bounds.bottom) / 2);
  await postMacOsPointerEvent(x, y, true);
  return `CoreGraphics clicked ${controlName} at screen point (${x}, ${y}) from egui response geometry; window=${JSON.stringify(window)}; ${bounds.diagnostic}`;
}

async function clickLinuxCanvasTextEditButtonFromCiGeometry(
  windowId: string,
  action: "load" | "save",
): Promise<string> {
  const controlName = action === "load" ? "Load Canvas text card" : "Save Canvas text";
  const diagnosticPrefix = `OpenObsidian CI canvas-text-edit-${action} input:`;
  const diagnosticLogPath = join(reportDirectory, "openobsidian-canvas-text-edit.log");
  xdotool("windowfocus", "--sync", windowId);
  const afterLineCount = (await readFile(diagnosticLogPath, "utf8").catch(() => ""))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length;
  xdotool("mousemove", "--sync", "--window", windowId, "1", "1");
  const bounds = await readOpenObsidianCiButtonBounds(
    controlName,
    diagnosticPrefix,
    undefined,
    diagnosticLogPath,
    afterLineCount,
  );
  const x = Math.round(((bounds.left + bounds.right) / 2) * bounds.pixelsPerPoint);
  const y = Math.round(((bounds.top + bounds.bottom) / 2) * bounds.pixelsPerPoint);
  xdotool("mousemove", "--sync", "--window", windowId, String(x), String(y));
  xdotool("mousedown", "1");
  await delay(80);
  xdotool("mouseup", "1");
  return `xdotool clicked ${controlName} from CI response geometry at window coordinates (${x}, ${y}); ${bounds.diagnostic}`;
}

async function clickMacOsCanvasTextEditButtonFromCiGeometry(
  child: ChildProcess,
  action: "load" | "save",
): Promise<string> {
  await focusOpenObsidian(child);
  const window = macOSOpenObsidianWindowBounds(child);
  const macOSRunnerTitlebarHeightPoints = 32;
  const controlName = action === "load" ? "Load Canvas text card" : "Save Canvas text";
  const diagnosticPrefix = `OpenObsidian CI canvas-text-edit-${action} input:`;
  const diagnosticLogPath = join(reportDirectory, "openobsidian-canvas-text-edit.log");
  const afterLineCount = (await readFile(diagnosticLogPath, "utf8").catch(() => ""))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length;
  await postMacOsPointerEvent(window.x + 5, window.y + macOSRunnerTitlebarHeightPoints + 5, false);
  const bounds = await readOpenObsidianCiButtonBounds(
    controlName,
    diagnosticPrefix,
    undefined,
    diagnosticLogPath,
    afterLineCount,
  );
  const x = Math.round(window.x + (bounds.left + bounds.right) / 2);
  const y = Math.round(window.y + macOSRunnerTitlebarHeightPoints + (bounds.top + bounds.bottom) / 2);
  await postMacOsPointerEvent(x, y, true);
  return `CoreGraphics clicked ${controlName} at screen point (${x}, ${y}) from egui response geometry; window=${JSON.stringify(window)}; ${bounds.diagnostic}`;
}

async function clickLinuxCanvasNoteReviewOrConfirmFromCiGeometry(
  windowId: string,
  action: "review" | "confirm",
): Promise<string> {
  const controlName = action === "review" ? "Review and confirm note creation" : "Confirm and create note";
  const diagnosticPrefix = `OpenObsidian CI canvas-note-${action} input:`;
  const diagnosticLogPath = join(reportDirectory, "openobsidian-canvas-note-create.log");
  xdotool("windowfocus", "--sync", windowId);
  const afterLineCount = (await readFile(diagnosticLogPath, "utf8").catch(() => ""))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length;
  xdotool("mousemove", "--sync", "--window", windowId, "1", "1");
  const bounds = await readOpenObsidianCiButtonBounds(
    controlName,
    diagnosticPrefix,
    undefined,
    diagnosticLogPath,
    afterLineCount,
  );
  const x = Math.round(((bounds.left + bounds.right) / 2) * bounds.pixelsPerPoint);
  const y = Math.round(((bounds.top + bounds.bottom) / 2) * bounds.pixelsPerPoint);
  xdotool("mousemove", "--sync", "--window", windowId, String(x), String(y));
  xdotool("mousedown", "1");
  await delay(80);
  xdotool("mouseup", "1");
  return `xdotool clicked ${controlName} from CI response geometry at window coordinates (${x}, ${y}); ${bounds.diagnostic}`;
}

async function clickMacOsCanvasNoteReviewOrConfirmFromCiGeometry(
  child: ChildProcess,
  action: "review" | "confirm",
): Promise<string> {
  await focusOpenObsidian(child);
  const window = macOSOpenObsidianWindowBounds(child);
  const macOSRunnerTitlebarHeightPoints = 32;
  const controlName = action === "review" ? "Review and confirm note creation" : "Confirm and create note";
  const diagnosticPrefix = `OpenObsidian CI canvas-note-${action} input:`;
  const diagnosticLogPath = join(reportDirectory, "openobsidian-canvas-note-create.log");
  const afterLineCount = (await readFile(diagnosticLogPath, "utf8").catch(() => ""))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length;
  await postMacOsPointerEvent(window.x + 5, window.y + macOSRunnerTitlebarHeightPoints + 5, false);
  const bounds = await readOpenObsidianCiButtonBounds(
    controlName,
    diagnosticPrefix,
    undefined,
    diagnosticLogPath,
    afterLineCount,
  );
  const x = Math.round(window.x + (bounds.left + bounds.right) / 2);
  const y = Math.round(window.y + macOSRunnerTitlebarHeightPoints + (bounds.top + bounds.bottom) / 2);
  await postMacOsPointerEvent(x, y, true);
  return `CoreGraphics clicked ${controlName} at screen point (${x}, ${y}) from egui response geometry; window=${JSON.stringify(window)}; ${bounds.diagnostic}`;
}

async function clickMacOsResolveButtonFromCiGeometry(child: ChildProcess, authoredNotePath: string): Promise<string> {
  await focusOpenObsidian(child);
  const window = macOSOpenObsidianWindowBounds(child);
  // Move the pointer once so egui emits fresh bounds for the newly selected note.
  const macOSRunnerTitlebarHeightPoints = 32;
  await postMacOsPointerEvent(window.x + 5, window.y + macOSRunnerTitlebarHeightPoints + 5, false);
  const diagnosticPrefix = "OpenObsidian CI resolve-link-status input:";
  const bounds = await readOpenObsidianCiButtonBounds("Resolve link status", diagnosticPrefix, authoredNotePath);
  const x = Math.round(window.x + (bounds.left + bounds.right) / 2);
  // egui coordinates start below the macOS title bar; AppKit/CGEvent coordinates are screen points.
  const y = Math.round(window.y + macOSRunnerTitlebarHeightPoints + (bounds.top + bounds.bottom) / 2);
  await postMacOsPointerEvent(x, y, true);
  return `CoreGraphics clicked Resolve link status at screen point (${x}, ${y}) from egui response geometry; window=${JSON.stringify(window)}; ${bounds.diagnostic}`;
}

async function postMacOsPointerEvent(x: number, y: number, click: boolean): Promise<void> {
  const swiftPath = join(workDirectory, "openobsidian-native-control-click.swift");
  const eventTypes = click ? "[CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp]" : "[CGEventType.mouseMoved]";
  await writeFile(swiftPath, `import AppKit
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3,
      let x = Double(CommandLine.arguments[1]),
      let y = Double(CommandLine.arguments[2]) else {
    fatalError("Expected screen x and y coordinates")
}
let point = CGPoint(x: x, y: y)
for type in ${eventTypes} {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else {
        fatalError("Could not create mouse event")
    }
    event.post(tap: .cghidEventTap)
    if type == .leftMouseDown { Thread.sleep(forTimeInterval: 0.08) }
}
`);
  execFileSync("swift", [swiftPath, String(x), String(y)], {stdio: "ignore"});
}

async function selectReferenceNoteForEmbedResolution(
  child: ChildProcess,
  windowId: string,
  currentPath: string,
  targetPath: string,
  sortedNotePaths: string[],
): Promise<Record<string, unknown>> {
  const currentIndex = sortedNotePaths.indexOf(currentPath);
  const targetIndex = sortedNotePaths.indexOf(targetPath);
  if (currentIndex < 0 || targetIndex < 0) {
    throw new Error(`Reference note selection requires current and target paths in the refreshed list; current=${currentPath}, target=${targetPath}, paths=${JSON.stringify(sortedNotePaths)}`);
  }
  if (currentPath === targetPath) {
    throw new Error(`Reference image-embed resolution must switch notes before selecting ${targetPath}`);
  }

  if (process.platform === "win32") {
    const collapsedSelectorScreenshot = await captureOpenObsidianScreenshot(
      windowId,
      child,
      "openobsidian-authored-image-note-selector-collapsed",
    );
    const selectorOpenAction = await invokeNativeAccessibleControl(child, windowId, "Note to inspect", currentPath);
    if (!windowsSelectorOpenConfirms(selectorOpenAction)) {
      throw new Error(`Windows UI Automation did not confirm opening the exact note selector: ${selectorOpenAction}`);
    }
    const expandedSelectorCaptures: Array<{
      pngPath: string;
      cropGeometry: string;
      ocrText: string;
      ocrError: string | null;
      uiAutomationBefore: Record<string, unknown>;
      uiAutomationAfter: Record<string, unknown>;
      uiAutomationSameTargetAfterCapture: boolean;
    }> = [];
    let expandedSelectorScreenshotPath = "";
    let expandedSelectorCropGeometry = "";
    let expandedSelectorOcrText = "";
    let expandedSelectorUiAutomationBefore: Record<string, unknown> | null = null;
    let expandedSelectorUiAutomationAfter: Record<string, unknown> | null = null;
    let uiAutomationSameTargetAfterCapture = false;
    let targetPathVisibleByOcr = false;
    let targetPathVisibleByUiAutomation = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const uiAutomationBefore = await readWindowsExpandedNoteSelectorTarget(child, targetPath);
      const targetOption = uiAutomationBefore.target_option as Record<string, unknown>;
      const screenshot = await captureWindowsNoteSelectorOptionScreenshot(
        `openobsidian-authored-image-note-selector-expanded-${attempt}.png`,
        targetOption,
      );
      let screenshotOcr = "";
      let screenshotOcrError: string | null = null;
      try {
        screenshotOcr = await readScreenshotOcr(screenshot.pngPath);
      } catch (error) {
        screenshotOcrError = error instanceof Error ? error.message : String(error);
      }
      const uiAutomationAfter = await readWindowsExpandedNoteSelectorTarget(child, targetPath);
      const sameTargetAfterCapture = windowsNoteSelectorObservationConfirmsSameTarget(uiAutomationBefore, uiAutomationAfter, targetPath);
      expandedSelectorCaptures.push({
        pngPath: screenshot.pngPath,
        cropGeometry: screenshot.geometry,
        ocrText: screenshotOcr,
        ocrError: screenshotOcrError,
        uiAutomationBefore,
        uiAutomationAfter,
        uiAutomationSameTargetAfterCapture: sameTargetAfterCapture,
      });
      expandedSelectorScreenshotPath = screenshot.pngPath;
      expandedSelectorCropGeometry = screenshot.geometry;
      expandedSelectorOcrText = screenshotOcr;
      expandedSelectorUiAutomationBefore = uiAutomationBefore;
      expandedSelectorUiAutomationAfter = uiAutomationAfter;
      uiAutomationSameTargetAfterCapture = sameTargetAfterCapture;
      targetPathVisibleByOcr = ocrTextContainsPhrase(screenshotOcr, targetPath) && sameTargetAfterCapture;
      targetPathVisibleByUiAutomation = sameTargetAfterCapture
        && (uiAutomationBefore.target_option as Record<string, unknown> | null)?.name === targetPath
        && (uiAutomationAfter.target_option as Record<string, unknown> | null)?.name === targetPath;
      if (targetPathVisibleByUiAutomation) break;
      if (attempt < 3) await delay(250);
    }
    const selectorCaptureEvidence = {
      ui_automation_before_capture: expandedSelectorUiAutomationBefore,
      ui_automation_after_capture: expandedSelectorUiAutomationAfter,
      same_target_remained_visible_after_capture: uiAutomationSameTargetAfterCapture,
      screenshot_attempts: expandedSelectorCaptures.map((capture) => ({
        screenshot: relative(reportDirectory, capture.pngPath),
        crop_geometry: capture.cropGeometry,
        ocr_text: capture.ocrText.slice(0, 2_000),
        ocr_error: capture.ocrError,
        ui_automation_before_capture: capture.uiAutomationBefore,
        ui_automation_after_capture: capture.uiAutomationAfter,
        same_target_remained_visible_after_capture: capture.uiAutomationSameTargetAfterCapture,
      })),
      target_path_visible_by_ocr: targetPathVisibleByOcr,
      target_path_visible_by_ui_automation: targetPathVisibleByUiAutomation,
      screenshot_scope: "The screenshot crop is generated directly from the exact visible UI Automation bounds of the expected radio-button option; OCR is retained as a diagnostic because it produced false negatives on a visibly readable row.",
    };
    const openReport = report.openobsidian_open as Record<string, unknown>;
    const priorSelectorCaptures = Array.isArray(openReport.windows_authored_note_selector_capture_attempts)
      ? openReport.windows_authored_note_selector_capture_attempts
      : [];
    openReport.windows_authored_note_selector_capture_attempts = [...priorSelectorCaptures, selectorCaptureEvidence];
    await saveReport();
    if (!targetPathVisibleByUiAutomation) {
      throw new Error(`Windows UI Automation did not preserve one exact visible ${targetPath} radio-button target across its bounds-derived screenshot capture; UI Automation before=${JSON.stringify(expandedSelectorUiAutomationBefore)}; UI Automation after=${JSON.stringify(expandedSelectorUiAutomationAfter)}; crop=${expandedSelectorCropGeometry}; screenshot=${relative(reportDirectory, expandedSelectorScreenshotPath)}; OCR diagnostic=${JSON.stringify(expandedSelectorOcrText.slice(0, 2_000))}`);
    }
    const selectionAction = await invokeNativeAccessibleControl(child, windowId, targetPath, undefined, true);
    if (!windowsSelectionConfirmsPath(selectionAction, targetPath)) {
      throw new Error(`Windows UI Automation did not confirm exact authored-note selection: ${selectionAction}`);
    }
    const selectedNoteState = await readWindowsSelectedNoteSelectorState(child, targetPath);
    openReport.windows_authored_note_selector_selection_confirmation = selectedNoteState;
    if (!windowsSelectedNoteSelectorConfirmsPath(selectedNoteState, targetPath)) {
      throw new Error(`Windows UI Automation did not confirm that the note selector now reflects the exact selected path ${targetPath}: ${JSON.stringify(selectedNoteState)}`);
    }
    await saveReport();
    const dismissAction = await dismissWindowsNoteSelectorMenu(child, targetPath);
    if (!windowsSelectorDismissConfirmsClosed(dismissAction)) {
      throw new Error(`Windows UI Automation did not dismiss the selector after confirming ${targetPath}: ${dismissAction}`);
    }
    return {
      strategy: "windows_ui_automation_exact_path_from_expanded_selector",
      collapsed_selector_screenshot: relative(reportDirectory, collapsedSelectorScreenshot.pngPath),
      expanded_selector_screenshot: relative(reportDirectory, expandedSelectorScreenshotPath),
      expanded_selector_crop_geometry: expandedSelectorCropGeometry,
      expanded_selector_ui_automation_before_capture: expandedSelectorUiAutomationBefore,
      expanded_selector_ui_automation_after_capture: expandedSelectorUiAutomationAfter,
      same_target_remained_visible_after_capture: uiAutomationSameTargetAfterCapture,
      expanded_selector_ocr: expandedSelectorOcrText.slice(0, 4_000),
      expanded_selector_screenshot_attempt_count: expandedSelectorCaptures.length,
      target_path_visible_by_ocr: targetPathVisibleByOcr,
      target_path_visible_by_ui_automation: targetPathVisibleByUiAutomation,
      selected_note_selector_state: selectedNoteState,
      selector_open_action: selectorOpenAction,
      selection_action: selectionAction,
      selector_dismiss_action: dismissAction,
      selector_dismiss_confirmed_closed: true,
      selector_dismiss_confirmation_method: "the Note to inspect button remained visible through three consecutive scans with zero visible note-path radio buttons; ExpandCollapseState was read successfully and Collapsed when the pattern was available",
      exact_selected_path: targetPath,
    };
  }

  const previousSteps = (currentIndex - targetIndex + sortedNotePaths.length) % sortedNotePaths.length;
  const nextSteps = (targetIndex - currentIndex + sortedNotePaths.length) % sortedNotePaths.length;
  const direction = previousSteps <= nextSteps ? "previous" : "next";
  const stepCount = Math.min(previousSteps, nextSteps);
  const selectedPaths: string[] = [];
  const actions: string[] = [];
  let selectedIndex = currentIndex;
  for (let step = 0; step < stepCount; step += 1) {
    const nextIndex = direction === "previous"
      ? (selectedIndex - 1 + sortedNotePaths.length) % sortedNotePaths.length
      : (selectedIndex + 1) % sortedNotePaths.length;
    const selectedPath = sortedNotePaths[nextIndex];
    if (!selectedPath) throw new Error(`Reference note navigation produced no path at index ${nextIndex}`);
    const source = `${direction}_button`;
    const navigationControl = direction === "previous" ? "Previous note" : "Next note";
    const navigationAction = process.platform === "linux"
      ? await clickLinuxNoteNavigationButtonFromCiGeometry(windowId, direction)
      : process.platform === "darwin"
      ? await clickMacOsNoteNavigationButtonFromCiGeometry(child, direction)
        : await invokeNativeAccessibleControl(
          child,
          windowId,
          navigationControl,
          sortedNotePaths[selectedIndex],
        );
    actions.push(navigationAction);
    const expectedLog = `OpenObsidian CI note navigation: source=${source}, selected=${selectedPath}`;
    const navigationLog = await waitFor(
      `OpenObsidian to select ${selectedPath} through the ${direction} note button`,
      async () => (await readFile(join(reportDirectory, "openobsidian.log"), "utf8").catch(() => "")).split(/\r?\n/),
      (lines) => lines.includes(expectedLog),
      15_000,
    );
    selectedPaths.push(navigationLog.find((line) => line === expectedLog) ?? "");
    selectedIndex = nextIndex;
  }
  if (sortedNotePaths[selectedIndex] !== targetPath) {
    throw new Error(`Reference note navigation stopped at ${sortedNotePaths[selectedIndex] ?? "<none>"}; expected ${targetPath}`);
  }
  return {
    strategy: `${direction}_button`,
    actions,
    selected_paths: selectedPaths,
    exact_selected_path: targetPath,
  };
}

async function runReferenceExternalNoteRefresh(
  child: ChildProcess,
  window: {window_id: string},
  appDataRoot: string,
  vaultBaseline: SnapshotEntry[],
): Promise<SnapshotEntry[]> {
  const open = report.openobsidian_open as Record<string, unknown>;
  const refreshReport: Record<string, unknown> = {
    status: "in_progress",
    note_path: externalRefreshMarkdownPath,
    note_bytes: externalRefreshMarkdownBytes.length,
    note_sha256: createHash("sha256").update(externalRefreshMarkdownBytes).digest("hex"),
    expected_source_marker: externalRefreshMarker,
  };
  open.external_note_refresh = refreshReport;

  const refreshRequestCountBeforeCreation = (await readOpenObsidianRefreshDiagnostics()).requests.length;
  const vaultBeforeCreation = await snapshotTree(vaultRoot);
  ensureExactSnapshot(vaultBaseline, vaultBeforeCreation, "OpenObsidian vault before deliberate external note creation");
  const appDataBeforeCreation = await snapshotTree(appDataRoot);
  await writeFile(join(vaultRoot, externalRefreshMarkdownPath), externalRefreshMarkdownBytes, {flag: "wx"});

  const vaultAfterCreation = await snapshotTree(vaultRoot);
  const changesFromExternalCreation = changedPaths(vaultBeforeCreation, vaultAfterCreation);
  const expectedNoteSha256 = createHash("sha256").update(externalRefreshMarkdownBytes).digest("hex");
  if (
    changesFromExternalCreation.length !== 1
    || changesFromExternalCreation[0]?.path !== externalRefreshMarkdownPath
    || changesFromExternalCreation[0]?.after?.kind !== "file"
    || changesFromExternalCreation[0]?.after?.bytes !== externalRefreshMarkdownBytes.length
    || changesFromExternalCreation[0]?.after?.sha256 !== expectedNoteSha256
  ) {
    throw new Error(`External note creation changed unexpected vault entries: ${JSON.stringify(changesFromExternalCreation).slice(0, 6_000)}`);
  }
  const expectedMarkdownCount = countMarkdownFiles(vaultAfterCreation);
  if (expectedMarkdownCount !== countMarkdownFiles(vaultBaseline) + 1) {
    throw new Error(`External note creation produced ${expectedMarkdownCount} Markdown files; expected exactly one additional note`);
  }
  const appDataAfterCreation = await snapshotTree(appDataRoot);
  ensureExactSnapshot(appDataBeforeCreation, appDataAfterCreation, "OpenObsidian app data during deliberate external note creation");
  refreshReport.vault_snapshot_before_creation = vaultBeforeCreation;
  refreshReport.vault_snapshot_after_creation = vaultAfterCreation;
  refreshReport.vault_changes_from_external_creation = changesFromExternalCreation;
  refreshReport.expected_markdown_count_after_refresh = expectedMarkdownCount;
  refreshReport.app_data_snapshot_before_creation = appDataBeforeCreation;
  refreshReport.app_data_snapshot_after_creation = appDataAfterCreation;
  refreshReport.app_data_unchanged_during_external_creation = true;
  const vaultSnapshots = report.vault_snapshots as Record<string, unknown>;
  vaultSnapshots.before_external_note_creation = vaultBeforeCreation;
  vaultSnapshots.after_external_note_creation = vaultAfterCreation;
  await writeFile(join(reportDirectory, "vault-after-external-note-creation.json"), `${JSON.stringify(vaultAfterCreation, null, 2)}\n`);
  await saveReport();

  if (process.platform !== "win32") await delay(2_000);
  const settledWatcherRefresh = await waitForOpenObsidianRefreshIdle(
    refreshRequestCountBeforeCreation,
    expectedMarkdownCount,
    false,
  );
  refreshReport.watcher_refresh_settled_before_manual = {
    settled_for_ms: settledWatcherRefresh.settled_for_ms,
    latest_receiver_busy: settledWatcherRefresh.receiverStates.at(-1)?.busy ?? false,
    latest_consumed_result: settledWatcherRefresh.consumedResults.at(-1) ?? null,
  };
  const refreshRequestCountBeforeManual = settledWatcherRefresh.requests.length;
  refreshReport.refresh_action = await clickManualRefreshUntilRequested(
    child,
    window.window_id,
    refreshRequestCountBeforeManual,
  );
  const settledManualRefresh = await waitForOpenObsidianRefreshIdle(
    refreshRequestCountBeforeManual,
    expectedMarkdownCount,
    true,
  );
  refreshReport.manual_refresh_diagnostics = {
    action_request: settledManualRefresh.requests.at(-1) ?? null,
    result: settledManualRefresh.consumedResults.at(-1) ?? null,
    receiver_busy_after_result: settledManualRefresh.receiverStates.at(-1)?.busy ?? false,
    settled_for_ms: settledManualRefresh.settled_for_ms,
  };
  const refreshedList = await waitFor("OpenObsidian to finish refreshing its note list after external creation", async () => {
    await delay(350);
    const capture = await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-after-external-note-refresh");
    refreshReport.refresh_screen_ocr = capture.ocrText.slice(0, 4_000);
    return capture;
  }, (capture) => ocrTextContainsRefreshedMarkdownCount(capture.ocrText, expectedMarkdownCount), 30_000);
  refreshReport.refreshed_list_screenshot = relative(reportDirectory, refreshedList.pngPath);
  refreshReport.refreshed_list_window_screenshot = relative(reportDirectory, refreshedList.windowPngPath);
  refreshReport.refreshed_markdown_count_visible = true;

  if (process.platform === "win32") {
    refreshReport.open_note_selector_action = await invokeNativeAccessibleControl(
      child,
      window.window_id,
      "Note to inspect",
      "Nested",
    );
    const visibleMenu = await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-external-note-selector");
    refreshReport.selector_menu_screen_ocr = visibleMenu.ocrText.slice(0, 4_000);
    refreshReport.selector_menu_screenshot = relative(reportDirectory, visibleMenu.pngPath);
  } else {
    const selectorBefore = await captureOpenObsidianScreenshot(
      window.window_id,
      child,
      "openobsidian-external-note-selector-before",
    );
    refreshReport.selector_before_screen_ocr = selectorBefore.ocrText.slice(0, 4_000);
    refreshReport.selector_before_screenshot = relative(reportDirectory, selectorBefore.pngPath);
  }
  const sortedNotePaths = vaultAfterCreation
    .filter((entry) => entry.kind === "file" && entry.path.toLowerCase().endsWith(".md"))
    .map((entry) => entry.path)
    .sort();
  if (process.platform === "linux" || process.platform === "darwin") {
    refreshReport.select_external_note_action = await selectFirstNoteWithPreviousButton(
      child,
      window.window_id,
      externalRefreshMarkdownPath,
      sortedNotePaths,
    );
  } else {
    refreshReport.select_external_note_action = await invokeNativeAccessibleControl(child, window.window_id, externalRefreshMarkdownPath);
  }
  refreshReport.external_note_visible_in_selector = true;
  const selectedByWindowsUiAutomation = process.platform === "win32"
    && windowsSelectionConfirmsPath(refreshReport.select_external_note_action, externalRefreshMarkdownPath);
  refreshReport.external_note_selected_by_exact_windows_uia = selectedByWindowsUiAutomation;
  if (process.platform === "win32") {
    if (!selectedByWindowsUiAutomation) {
      throw new Error(`Windows UI Automation did not confirm exact selection of ${externalRefreshMarkdownPath}: ${refreshReport.select_external_note_action}`);
    }
    refreshReport.selector_dismiss_status = "pending";
    refreshReport.selector_dismiss_confirmed_closed = false;
    await saveReport();
    let selectorDismissAction: string;
    try {
      selectorDismissAction = await dismissWindowsNoteSelectorMenu(child, externalRefreshMarkdownPath);
    } catch (error) {
      refreshReport.selector_dismiss_status = "unconfirmed";
      refreshReport.selector_dismiss_confirmed_closed = false;
      refreshReport.selector_dismiss_error = error instanceof Error ? error.message : String(error);
      await saveReport();
      throw error;
    }
    refreshReport.selector_dismiss_action = selectorDismissAction;
    refreshReport.selector_dismiss_confirmed_closed = windowsSelectorDismissConfirmsClosed(selectorDismissAction);
    refreshReport.selector_dismiss_status = refreshReport.selector_dismiss_confirmed_closed ? "confirmed_by_uia_proxy" : "unconfirmed";
    refreshReport.selector_dismiss_confirmation_method = "the Note to inspect button remained visible through three consecutive scans with zero visible note-path radio buttons; ExpandCollapseState was read successfully and Collapsed when the pattern was available";
    await saveReport();
    if (!refreshReport.selector_dismiss_confirmed_closed) {
      throw new Error(`Windows UI Automation did not confirm the note selector was collapsed after selecting ${externalRefreshMarkdownPath}: ${selectorDismissAction}`);
    }
  }
  let selectedByPreviousButton = false;
  if (process.platform === "linux" || process.platform === "darwin") {
    const expectedNavigationLog = `OpenObsidian CI note navigation: source=previous_button, selected=${externalRefreshMarkdownPath}`;
    const navigationLog = await waitFor(
      "OpenObsidian to apply the Previous note button selection",
      async () => (await readFile(join(reportDirectory, "openobsidian.log"), "utf8").catch(() => "")).split(/\r?\n/),
      (lines) => lines.includes(expectedNavigationLog),
      15_000,
    );
    refreshReport.previous_note_selection_diagnostic = navigationLog.find((line) => line === expectedNavigationLog);
    selectedByPreviousButton = true;
  }
  refreshReport.external_note_selected_by_previous_button = selectedByPreviousButton;
  const selectedNote = await waitFor("OpenObsidian to select the externally added note", async () => {
    await delay(350);
    const capture = await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-external-note-selected");
    refreshReport.selected_note_screen_ocr = capture.ocrText.slice(0, 4_000);
    return capture;
  }, (capture) => selectedByWindowsUiAutomation || selectedByPreviousButton
    || ocrTextContainsPhrase(capture.ocrText, externalRefreshMarkdownPath)
    || ocrTextContainsFuzzyPhrase(capture.ocrText, externalRefreshMarkdownPath), 15_000);
  refreshReport.selected_note_screenshot = relative(reportDirectory, selectedNote.pngPath);
  refreshReport.external_note_selected = true;

  refreshReport.read_source_action = await invokeNativeAccessibleControl(child, window.window_id, "Read note source preview");
  const visiblePreview = await waitFor("OpenObsidian to preview the externally added note source", async () => {
    await delay(350);
    const capture = await withSourcePaneOcr(await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-external-note-source-preview"));
    refreshReport.preview_screen_ocr = capture.ocrText.slice(0, 4_000);
    refreshReport.preview_source_pane_ocr = capture.sourcePaneOcrText.slice(0, 4_000);
    refreshReport.preview_source_pane_crop = capture.sourcePaneOcrCropPath
      ? relative(reportDirectory, capture.sourcePaneOcrCropPath)
      : null;
    refreshReport.preview_source_pane_crop_bounds = capture.sourcePaneOcrCropBounds;
    return capture;
  }, (capture) => ocrTextContainsFuzzyPhraseAcrossLines(capture.sourcePaneOcrText, externalRefreshMarker, 1), 30_000);
  refreshReport.preview_screenshot = relative(reportDirectory, visiblePreview.pngPath);
  refreshReport.preview_window_screenshot = relative(reportDirectory, visiblePreview.windowPngPath);
  refreshReport.external_source_marker_visible = true;

  const canonicalVaultRoot = await realpath(vaultRoot);
  const canonicalAppDataRoot = await realpath(appDataRoot);
  const forbiddenPersistencePaths = [vaultRoot, canonicalVaultRoot, appDataRoot, canonicalAppDataRoot];
  const vaultAfterPreview = await snapshotTree(vaultRoot);
  const appDataAfterPreview = await snapshotTree(appDataRoot);
  const vaultChangesAfterPreview = changedPaths(vaultAfterCreation, vaultAfterPreview);
  const appDataChangesAfterPreview = changedPaths(appDataAfterCreation, appDataAfterPreview);
  const eframeFilesAfterPreview = await readSnapshotTextFiles(appDataRoot, appDataAfterPreview, (path) => path.toLowerCase().endsWith(".ron"));
  refreshReport.vault_snapshot_after_preview = vaultAfterPreview;
  refreshReport.vault_changes_after_preview = vaultChangesAfterPreview;
  refreshReport.app_data_snapshot_after_preview = appDataAfterPreview;
  refreshReport.app_data_changes_after_preview = appDataChangesAfterPreview;
  refreshReport.eframe_persistence_files_after_preview = eframeFilesAfterPreview;
  await saveReport();
  ensureExactSnapshot(vaultAfterCreation, vaultAfterPreview, "OpenObsidian external note refresh and source preview");
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataChangesAfterPreview,
    eframeFilesAfterPreview,
    "OpenObsidian external note refresh and source preview app data",
    forbiddenPersistencePaths,
  );
  refreshReport.vault_unchanged_after_preview = true;
  refreshReport.app_data_change_policy_passed_after_preview = true;

  const originalSourceMarkerVisible = ocrTextContainsFuzzyPhraseAcrossLines(visiblePreview.sourcePaneOcrText, externalRefreshMarker, 1);
  const editReport: Record<string, unknown> = {
    status: "in_progress",
    note_path: externalRefreshMarkdownPath,
    previous_note_bytes: externalRefreshMarkdownBytes.length,
    previous_note_sha256: createHash("sha256").update(externalRefreshMarkdownBytes).digest("hex"),
    expected_note_bytes: externalEditedMarkdownBytes.length,
    expected_note_sha256: createHash("sha256").update(externalEditedMarkdownBytes).digest("hex"),
    expected_source_marker: externalEditedMarker,
    original_source_marker_visible_before_edit: originalSourceMarkerVisible,
    source_preview_open_before_edit: true,
  };
  refreshReport.external_in_place_edit = editReport;
  if (!originalSourceMarkerVisible) {
    throw new Error("OpenObsidian did not visibly preview the original note source before the deliberate external edit");
  }

  const settledRefreshBeforeEdit = await waitForOpenObsidianRefreshIdle(
    0,
    expectedMarkdownCount,
    false,
  );
  editReport.previous_refresh_settled_before_edit = {
    settled_for_ms: settledRefreshBeforeEdit.settled_for_ms,
    latest_receiver_busy: settledRefreshBeforeEdit.receiverStates.at(-1)?.busy ?? false,
    latest_consumed_result: settledRefreshBeforeEdit.consumedResults.at(-1) ?? null,
  };
  const refreshRequestCountBeforeEdit = settledRefreshBeforeEdit.requests.length;
  const vaultBeforeEdit = await snapshotTree(vaultRoot);
  ensureExactSnapshot(vaultAfterCreation, vaultBeforeEdit, "OpenObsidian vault before deliberate external note edit");
  const noteBeforeEdit = vaultBeforeEdit.find((entry) => entry.path === externalRefreshMarkdownPath && entry.kind === "file");
  const originalNoteSha256 = createHash("sha256").update(externalRefreshMarkdownBytes).digest("hex");
  if (
    !noteBeforeEdit
    || noteBeforeEdit.bytes !== externalRefreshMarkdownBytes.length
    || noteBeforeEdit.sha256 !== originalNoteSha256
  ) {
    throw new Error("The external note does not match the original source bytes before the in-place edit");
  }
  const appDataBeforeEdit = await snapshotTree(appDataRoot);
  await writeFile(join(vaultRoot, externalRefreshMarkdownPath), externalEditedMarkdownBytes);

  const vaultAfterEdit = await snapshotTree(vaultRoot);
  const changesFromExternalEdit = changedPaths(vaultBeforeEdit, vaultAfterEdit);
  const editedNoteSha256 = createHash("sha256").update(externalEditedMarkdownBytes).digest("hex");
  const editedNote = vaultAfterEdit.find((entry) => entry.path === externalRefreshMarkdownPath && entry.kind === "file");
  if (
    changesFromExternalEdit.length !== 1
    || changesFromExternalEdit[0]?.path !== externalRefreshMarkdownPath
    || changesFromExternalEdit[0]?.before?.sha256 !== originalNoteSha256
    || changesFromExternalEdit[0]?.after?.kind !== "file"
    || changesFromExternalEdit[0]?.after?.bytes !== externalEditedMarkdownBytes.length
    || changesFromExternalEdit[0]?.after?.sha256 !== editedNoteSha256
    || !editedNote
    || editedNote.bytes !== externalEditedMarkdownBytes.length
    || editedNote.sha256 !== editedNoteSha256
  ) {
    throw new Error("The deliberate external note edit did not change exactly the expected note bytes: " + JSON.stringify(changesFromExternalEdit).slice(0, 6_000));
  }
  const markdownCountAfterEdit = countMarkdownFiles(vaultAfterEdit);
  if (markdownCountAfterEdit !== expectedMarkdownCount) {
    throw new Error("The external in-place edit changed the Markdown file count from " + expectedMarkdownCount + " to " + markdownCountAfterEdit);
  }
  const appDataAfterEdit = await snapshotTree(appDataRoot);
  ensureExactSnapshot(appDataBeforeEdit, appDataAfterEdit, "OpenObsidian app data during deliberate external note edit");
  editReport.vault_snapshot_before_edit = vaultBeforeEdit;
  editReport.vault_snapshot_after_edit = vaultAfterEdit;
  editReport.vault_changes_from_external_edit = changesFromExternalEdit;
  editReport.markdown_count_before_edit = expectedMarkdownCount;
  editReport.markdown_count_after_edit = markdownCountAfterEdit;
  editReport.app_data_snapshot_before_edit = appDataBeforeEdit;
  editReport.app_data_snapshot_after_edit = appDataAfterEdit;
  editReport.app_data_unchanged_during_external_edit = true;
  vaultSnapshots.before_external_note_edit = vaultBeforeEdit;
  vaultSnapshots.after_external_note_edit = vaultAfterEdit;
  await writeFile(join(reportDirectory, "vault-after-external-note-edit.json"), JSON.stringify(vaultAfterEdit, null, 2) + "\n");
  await saveReport();

  if (process.platform !== "win32") await delay(2_000);
  const settledWatcherRefreshAfterEdit = await waitForOpenObsidianRefreshIdle(
    refreshRequestCountBeforeEdit,
    markdownCountAfterEdit,
    false,
  );
  editReport.watcher_refresh_settled_before_manual = {
    settled_for_ms: settledWatcherRefreshAfterEdit.settled_for_ms,
    latest_receiver_busy: settledWatcherRefreshAfterEdit.receiverStates.at(-1)?.busy ?? false,
    latest_consumed_result: settledWatcherRefreshAfterEdit.consumedResults.at(-1) ?? null,
  };
  const refreshRequestCountBeforeManualEdit = settledWatcherRefreshAfterEdit.requests.length;
  editReport.refresh_action = await clickManualRefreshUntilRequested(
    child,
    window.window_id,
    refreshRequestCountBeforeManualEdit,
  );
  const settledManualRefreshAfterEdit = await waitForOpenObsidianRefreshIdle(
    refreshRequestCountBeforeManualEdit,
    markdownCountAfterEdit,
    true,
  );
  editReport.manual_refresh_diagnostics = {
    action_request: settledManualRefreshAfterEdit.requests.at(-1) ?? null,
    result: settledManualRefreshAfterEdit.consumedResults.at(-1) ?? null,
    receiver_busy_after_result: settledManualRefreshAfterEdit.receiverStates.at(-1)?.busy ?? false,
    settled_for_ms: settledManualRefreshAfterEdit.settled_for_ms,
  };
  const editedRefresh = await waitFor(
    "OpenObsidian to clear the stale source preview after the external note edit",
    async () => {
      await delay(350);
      const capture = await withSourcePaneOcr(await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-after-external-note-edit-refresh"));
      editReport.refresh_screen_ocr = capture.ocrText.slice(0, 4_000);
      editReport.refresh_source_pane_ocr = capture.sourcePaneOcrText.slice(0, 4_000);
      editReport.refresh_source_pane_crop = capture.sourcePaneOcrCropPath
        ? relative(reportDirectory, capture.sourcePaneOcrCropPath)
        : null;
      editReport.refresh_source_pane_crop_bounds = capture.sourcePaneOcrCropBounds;
      return capture;
    },
    (capture) => (
      ocrTextContainsRefreshedMarkdownCount(capture.ocrText, markdownCountAfterEdit)
      && !capture.sourcePaneLabelVisible
      && !ocrTextContainsFuzzyPhraseAcrossLines(capture.ocrText, externalRefreshMarker, 1)
      && !ocrTextContainsFuzzyPhraseAcrossLines(capture.ocrText, externalEditedMarker, 1)
    ),
    30_000,
  );
  editReport.refresh_screenshot = relative(reportDirectory, editedRefresh.pngPath);
  editReport.refresh_window_screenshot = relative(reportDirectory, editedRefresh.windowPngPath);
  editReport.stale_source_marker_absent_after_refresh = true;
  editReport.updated_source_marker_absent_before_repreview = true;
  const selectedEditedNoteVisible = ocrTextContainsPhrase(editedRefresh.ocrText, externalRefreshMarkdownPath)
    || ocrTextContainsFuzzyPhrase(editedRefresh.ocrText, externalRefreshMarkdownPath);
  editReport.selected_note_path_ocr_confirmation_after_refresh = selectedEditedNoteVisible;
  const expectedSelectionAfterRefresh = `OpenObsidian CI vault refresh selection applied: selected=${externalRefreshMarkdownPath}`;
  const refreshSelectionLog = await waitFor(
    "OpenObsidian to retain the externally edited note selection after refresh",
    async () => (await readFile(join(reportDirectory, "openobsidian.log"), "utf8").catch(() => "")).split(/\r?\n/),
    (lines) => lines.includes(expectedSelectionAfterRefresh),
    15_000,
  );
  editReport.selected_note_path_retained_after_refresh = true;
  editReport.selection_after_refresh_diagnostic = refreshSelectionLog.find((line) => line === expectedSelectionAfterRefresh);
  editReport.selection_after_refresh_screenshot = relative(reportDirectory, editedRefresh.windowPngPath);
  editReport.refreshed_markdown_count_visible = true;
  editReport.stale_preview_cleared = true;

  editReport.read_updated_source_action = await invokeNativeAccessibleControl(
    child,
    window.window_id,
    "Read note source preview",
    externalRefreshMarkdownPath,
  );
  const updatedPreview = await waitFor(
    "OpenObsidian to preview the externally edited note source",
    async () => {
      await delay(350);
      const capture = await withSourcePaneOcr(await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-external-note-edited-source-preview"));
      editReport.updated_preview_screen_ocr = capture.ocrText.slice(0, 4_000);
      editReport.updated_preview_source_pane_ocr = capture.sourcePaneOcrText.slice(0, 4_000);
      editReport.updated_preview_source_pane_crop = capture.sourcePaneOcrCropPath
        ? relative(reportDirectory, capture.sourcePaneOcrCropPath)
        : null;
      editReport.updated_preview_source_pane_crop_bounds = capture.sourcePaneOcrCropBounds;
      return capture;
    },
    (capture) => ocrTextContainsFuzzyPhraseAcrossLines(capture.sourcePaneOcrText, externalEditedMarker, 1)
      && !ocrTextContainsFuzzyPhraseAcrossLines(capture.sourcePaneOcrText, externalRefreshMarker, 1),
    30_000,
  );
  editReport.updated_preview_screenshot = relative(reportDirectory, updatedPreview.pngPath);
  editReport.updated_preview_window_screenshot = relative(reportDirectory, updatedPreview.windowPngPath);
  editReport.updated_source_marker_visible = true;
  editReport.original_source_marker_absent_from_updated_preview = true;

  const vaultAfterUpdatedPreview = await snapshotTree(vaultRoot);
  const appDataAfterUpdatedPreview = await snapshotTree(appDataRoot);
  const vaultChangesAfterUpdatedPreview = changedPaths(vaultAfterEdit, vaultAfterUpdatedPreview);
  const appDataChangesAfterUpdatedPreview = changedPaths(appDataBeforeEdit, appDataAfterUpdatedPreview);
  const eframeFilesAfterUpdatedPreview = await readSnapshotTextFiles(
    appDataRoot,
    appDataAfterUpdatedPreview,
    (path) => path.toLowerCase().endsWith(".ron"),
  );
  editReport.vault_snapshot_after_updated_preview = vaultAfterUpdatedPreview;
  editReport.vault_changes_after_updated_preview = vaultChangesAfterUpdatedPreview;
  editReport.app_data_snapshot_after_updated_preview = appDataAfterUpdatedPreview;
  editReport.app_data_changes_after_updated_preview = appDataChangesAfterUpdatedPreview;
  editReport.eframe_persistence_files_after_updated_preview = eframeFilesAfterUpdatedPreview;
  await saveReport();
  ensureExactSnapshot(vaultAfterEdit, vaultAfterUpdatedPreview, "OpenObsidian updated external note source preview");
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataChangesAfterUpdatedPreview,
    eframeFilesAfterUpdatedPreview,
    "OpenObsidian updated external note source preview app data",
    forbiddenPersistencePaths,
  );
  editReport.vault_unchanged_after_updated_preview = true;
  editReport.app_data_change_policy_passed_after_updated_preview = true;
  await saveReport();

  refreshReport.close_preview_action = await invokeNativeAccessibleControl(
    child,
    window.window_id,
    "Close source preview",
    "Note source preview",
  );
  editReport.close_preview_action = refreshReport.close_preview_action;
  const closedPreview = await waitFor("OpenObsidian to close the externally edited note preview", async () => {
    await delay(350);
    const capture = await withSourcePaneOcr(await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-external-note-edited-preview-closed"));
    refreshReport.closed_screen_ocr = capture.ocrText.slice(0, 4_000);
    return capture;
  }, (capture) => !capture.sourcePaneLabelVisible
    && !ocrTextContainsFuzzyPhraseAcrossLines(capture.ocrText, externalRefreshMarker, 1)
    && !ocrTextContainsFuzzyPhraseAcrossLines(capture.ocrText, externalEditedMarker, 1), 30_000);
  refreshReport.closed_screenshot = relative(reportDirectory, closedPreview.pngPath);
  refreshReport.preview_closed = true;
  editReport.preview_closed = true;

  const vaultAfterClose = await snapshotTree(vaultRoot);
  const appDataAfterClose = await snapshotTree(appDataRoot);
  const vaultChangesAfterClose = changedPaths(vaultAfterEdit, vaultAfterClose);
  const appDataChangesAfterClose = changedPaths(appDataBeforeEdit, appDataAfterClose);
  const eframeFilesAfterClose = await readSnapshotTextFiles(appDataRoot, appDataAfterClose, (path) => path.toLowerCase().endsWith(".ron"));
  refreshReport.vault_snapshot_after_close = vaultAfterClose;
  refreshReport.vault_changes_after_close = vaultChangesAfterClose;
  refreshReport.app_data_snapshot_after_close = appDataAfterClose;
  refreshReport.app_data_changes_after_close = appDataChangesAfterClose;
  refreshReport.eframe_persistence_files_after_close = eframeFilesAfterClose;
  await saveReport();
  ensureExactSnapshot(vaultAfterEdit, vaultAfterClose, "OpenObsidian external note preview close");
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataChangesAfterClose,
    eframeFilesAfterClose,
    "OpenObsidian external note preview close app data",
    forbiddenPersistencePaths,
  );
  refreshReport.vault_unchanged_after_close = true;
  refreshReport.app_data_change_policy_passed_after_close = true;
  editReport.vault_snapshot_after_close = vaultAfterClose;
  editReport.vault_changes_after_close = vaultChangesAfterClose;
  editReport.app_data_snapshot_after_close = appDataAfterClose;
  editReport.app_data_changes_after_close = appDataChangesAfterClose;
  editReport.eframe_persistence_files_after_close = eframeFilesAfterClose;
  editReport.vault_unchanged_after_close = true;
  editReport.app_data_change_policy_passed_after_close = true;
  editReport.status = "passed";
  refreshReport.status = "passed";
  await saveReport();
  return vaultAfterEdit;
}

async function runReferenceImageEmbedResolution(
  child: ChildProcess,
  window: {window_id: string},
  appDataRoot: string,
  vaultBaseline: SnapshotEntry[],
): Promise<void> {
  const open = report.openobsidian_open as Record<string, unknown>;
  const fixture = report.fixture as Record<string, unknown>;
  const authoredNotePath = fixture.authored_note_path;
  if (typeof authoredNotePath !== "string" || authoredNotePath.length === 0) {
    throw new Error("The pinned Obsidian authoring step did not record the authored note path");
  }
  const noteEntry = vaultBaseline.find((entry) => entry.path === authoredNotePath && entry.kind === "file");
  const attachmentEntry = vaultBaseline.find((entry) => entry.path === attachmentPath && entry.kind === "file");
  if (!noteEntry?.sha256 || !attachmentEntry?.sha256) {
    throw new Error(`The Obsidian-authored note or image attachment is missing from the read-only baseline: note=${authoredNotePath}, attachment=${attachmentPath}`);
  }
  const authoredNoteReport = report.obsidian_authoring as Record<string, unknown>;
  if (authoredNoteReport.note_sha256 !== noteEntry.sha256) {
    throw new Error(`The authored note hash changed before reference image-embed resolution: report=${String(authoredNoteReport.note_sha256)}, baseline=${noteEntry.sha256}`);
  }

  const resolutionReport: Record<string, unknown> = {
    status: "in_progress",
    selected_note_path: authoredNotePath,
    selected_note_sha256: noteEntry.sha256,
    attachment_path: attachmentPath,
    attachment_sha256: attachmentEntry.sha256,
    expected_embed_source: noteEmbed,
    expected_link_status: "Resolved",
    expected_embed_disposition: "image",
  };
  open.reference_image_embed_resolution = resolutionReport;

  const vaultBefore = await snapshotTree(vaultRoot);
  ensureExactSnapshot(vaultBaseline, vaultBefore, "OpenObsidian vault before native image-embed resolution");
  const appDataBefore = await snapshotTree(appDataRoot);
  resolutionReport.vault_snapshot_before = vaultBefore;
  resolutionReport.app_data_snapshot_before = appDataBefore;
  await saveReport();

  const sortedNotePaths = vaultBaseline
    .filter((entry) => entry.kind === "file" && entry.path.toLowerCase().endsWith(".md"))
    .map((entry) => entry.path)
    .sort();
  const noteSelection = await selectReferenceNoteForEmbedResolution(
    child,
    window.window_id,
    externalRefreshMarkdownPath,
    authoredNotePath,
    sortedNotePaths,
  );
  resolutionReport.note_selection = noteSelection;
  resolutionReport.exact_authored_note_selected = noteSelection.exact_selected_path === authoredNotePath;
  await delay(350);
  const selectedNote = await captureOpenObsidianScreenshot(
    window.window_id,
    child,
    "openobsidian-authored-image-note-selected",
  );
  resolutionReport.selected_note_screen_ocr = selectedNote.ocrText.slice(0, 4_000);
  resolutionReport.authored_note_path_visible_by_ocr = ocrTextContainsPhrase(selectedNote.ocrText, authoredNotePath);
  resolutionReport.selected_note_screenshot = relative(reportDirectory, selectedNote.pngPath);
  resolutionReport.selected_note_window_screenshot = relative(reportDirectory, selectedNote.windowPngPath);

  const invokeResolveLinkStatus = async (): Promise<string> => process.platform === "linux"
    ? await clickLinuxResolveButtonFromCiGeometry(window.window_id, authoredNotePath)
    : process.platform === "darwin"
      ? await clickMacOsResolveButtonFromCiGeometry(child, authoredNotePath)
      : await invokeNativeAccessibleControl(child, window.window_id, "Resolve link status", authoredNotePath);
  resolutionReport.resolve_link_status_action = await invokeResolveLinkStatus();
  const expectedSummary = `OpenObsidian CI link resolution: source=${authoredNotePath}, total=1, resolved=1, unresolved=0, ambiguous=0, external=0, embed_roots=1, truncated=false`;
  const expectedReference = `OpenObsidian CI link reference: source=${authoredNotePath}, kind=Embed, raw=${JSON.stringify(noteEmbed)}, status=Resolved, target=${attachmentPath}`;
  const expectedEmbedPrefix = `OpenObsidian CI note embed: source=${authoredNotePath}, index=0, raw=${JSON.stringify(noteEmbed)}, status=Resolved, target=${attachmentPath}, disposition=image, revision_sha256=${attachmentEntry.sha256}, `;
  let diagnostics = await waitFor(
    "OpenObsidian to resolve the authored image embed against the exact vault attachment",
    async () => (await readFile(join(reportDirectory, "openobsidian.log"), "utf8").catch(() => "")).split(/\r?\n/),
    (lines) => lines.includes(expectedSummary)
      && lines.includes(expectedReference)
    && lines.some((line) => line.startsWith(expectedEmbedPrefix)),
    30_000,
  );

  // A watcher refresh can be logged just after its earlier idle check settles.
  // Refresh completion clears link results, so the visual-proof loop below also
  // watches for a newer refresh and restores the result before retrying the proof.
  let latestResolutionLine = diagnostics.lastIndexOf(expectedSummary);
  let resolutionRetryCount = 0;
  const retryAfterWatcherRefresh = async (
    settledRefresh: Awaited<ReturnType<typeof waitForOpenObsidianRefreshIdle>>,
  ): Promise<boolean> => {
    const watcherRequest = settledRefresh.requests.filter((request) => (
      request.source === "watcher_reconciliation" && request.line > latestResolutionLine
    )).at(-1);
    const latestRequest = settledRefresh.requests.at(-1);
    const latestResult = settledRefresh.consumedResults.at(-1);
    const receiverBusy = settledRefresh.receiverStates.at(-1)?.busy ?? false;
    if (!watcherRequest || !latestRequest || !latestResult || latestResult.line <= latestRequest.line || receiverBusy) {
      return false;
    }
    if (!latestResult.succeeded || latestResult.entries !== countMarkdownFiles(vaultBaseline)) {
      throw new Error(`OpenObsidian watcher refresh after image resolution returned an unexpected result: ${JSON.stringify(latestResult)}`);
    }
    resolutionReport.post_resolution_watcher_refresh = {
      request: watcherRequest,
      consumed_result: latestResult,
      receiver_busy: receiverBusy,
      settled_for_ms: settledRefresh.settled_for_ms,
    };

    const previousLogLineCount = (await readFile(join(reportDirectory, "openobsidian.log"), "utf8").catch(() => "")).split(/\r?\n/).length;
    const retryAction = await invokeResolveLinkStatus();
    diagnostics = await waitFor(
      "OpenObsidian to restore the resolved image-embed result after vault reconciliation",
      async () => (await readFile(join(reportDirectory, "openobsidian.log"), "utf8").catch(() => "")).split(/\r?\n/),
      (lines) => {
        const summaryLine = lines.lastIndexOf(expectedSummary);
        const retryLines = lines.slice(summaryLine);
        return summaryLine >= previousLogLineCount - 1
          && retryLines.includes(expectedReference)
          && retryLines.some((line) => line.startsWith(expectedEmbedPrefix));
      },
      30_000,
    );
    latestResolutionLine = diagnostics.lastIndexOf(expectedSummary);
    resolutionRetryCount += 1;
    resolutionReport.resolve_link_status_retry_action = retryAction;
    resolutionReport.resolution_retry_count = resolutionRetryCount;
    await saveReport();
    return true;
  };

  await delay(2_000);
  const settledRefresh = await waitForOpenObsidianRefreshIdle(
    0,
    countMarkdownFiles(vaultBaseline),
    false,
  );
  await retryAfterWatcherRefresh(settledRefresh);
  const embedDiagnostic = diagnostics.filter((line) => line.startsWith(expectedEmbedPrefix)).at(-1);
  const imageDetails = embedDiagnostic?.match(/dimensions=(\d+)x(\d+), decoded_rgba_bytes=(\d+), alt=(.+)$/);
  if (!embedDiagnostic || !imageDetails) {
    throw new Error(`OpenObsidian did not report decoded image dimensions and accessible alt text: ${embedDiagnostic ?? "missing image diagnostic"}`);
  }
  const imageWidth = Number(imageDetails[1]);
  const imageHeight = Number(imageDetails[2]);
  const decodedRgbaBytes = Number(imageDetails[3]);
  const imageAltText = JSON.parse(imageDetails[4] ?? "null") as unknown;
  if (
    imageWidth < 1
    || imageHeight < 1
    || decodedRgbaBytes !== imageWidth * imageHeight * 4
    || imageAltText !== "Vault image attachment"
  ) {
    throw new Error(`OpenObsidian's native image result did not match its bounded RGBA/alt-text contract: ${embedDiagnostic}`);
  }
  resolutionReport.link_resolution_diagnostic = expectedSummary;
  resolutionReport.link_reference_diagnostic = expectedReference;
  resolutionReport.note_embed_diagnostic = embedDiagnostic;
  resolutionReport.decoded_image = {
    width: imageWidth,
    height: imageHeight,
    rgba_bytes: decodedRgbaBytes,
    revision_sha256_matches_attachment: true,
    alt_text: imageAltText,
  };

  type ResolvedImageCapture = Awaited<ReturnType<typeof captureOpenObsidianScreenshot>>;
  let rendered: ResolvedImageCapture | null = null;
  let lastRenderedCapture: ResolvedImageCapture | null = null;
  const renderedDeadline = Date.now() + 30_000;
  while (Date.now() < renderedDeadline) {
    await delay(350);
    const capture = await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-resolved-image-embed");
    lastRenderedCapture = capture;
    const visualProofMatches = (
      ocrTextContainsFuzzyPhrase(capture.ocrText, `Link status refreshed for ${authoredNotePath}`)
      && ocrTextContainsFuzzyPhrase(capture.ocrText, "Resolved: 1")
      && ocrTextContainsFuzzyPhrase(capture.ocrText, `Vault image: ${attachmentPath}`)
    );

    const refreshState = await readOpenObsidianRefreshDiagnostics();
    const staleWatcherRequest = refreshState.requests.some((request) => (
      request.source === "watcher_reconciliation" && request.line > latestResolutionLine
    ));
    if (staleWatcherRequest) {
      if (resolutionRetryCount >= 3) {
        resolutionReport.last_visual_proof_screen_ocr = capture.ocrText.slice(0, 4_000);
        resolutionReport.last_visual_proof_screenshot = relative(reportDirectory, capture.pngPath);
        await saveReport();
        throw new Error(`OpenObsidian logged another watcher refresh after ${resolutionRetryCount} image-resolution retries; refusing to accept visual proof from before the refresh`);
      }
      const settledAfterStaleRefresh = await waitForOpenObsidianRefreshIdle(
        0,
        countMarkdownFiles(vaultBaseline),
        false,
      );
      if (!await retryAfterWatcherRefresh(settledAfterStaleRefresh)) {
        throw new Error("OpenObsidian logged a watcher refresh after image resolution but its settled state could not be verified");
      }
      continue;
    }
    if (visualProofMatches) {
      rendered = capture;
      break;
    }
  }
  if (!rendered) {
    if (lastRenderedCapture) {
      resolutionReport.last_visual_proof_screen_ocr = lastRenderedCapture.ocrText.slice(0, 4_000);
      resolutionReport.last_visual_proof_screenshot = relative(reportDirectory, lastRenderedCapture.pngPath);
      await saveReport();
    }
    throw new Error(`Timed out waiting for OpenObsidian to show resolved link status and the image attachment in its native window; retries=${resolutionRetryCount}; last OCR=${JSON.stringify(lastRenderedCapture?.ocrText.slice(0, 2_000) ?? "no screenshot captured")}`);
  }
  resolutionReport.result_screen_ocr = rendered.ocrText.slice(0, 4_000);
  resolutionReport.result_screenshot = relative(reportDirectory, rendered.pngPath);
  resolutionReport.result_window_screenshot = relative(reportDirectory, rendered.windowPngPath);
  resolutionReport.link_status_visible = true;
  resolutionReport.resolved_count_visible = true;
  resolutionReport.image_attachment_visible = true;

  const vaultAfter = await snapshotTree(vaultRoot);
  const appDataAfter = await snapshotTree(appDataRoot);
  const vaultChanges = changedPaths(vaultBefore, vaultAfter);
  const appDataChanges = changedPaths(appDataBefore, appDataAfter);
  const eframeFilesAfter = await readSnapshotTextFiles(appDataRoot, appDataAfter, (path) => path.toLowerCase().endsWith(".ron"));
  resolutionReport.vault_snapshot_after = vaultAfter;
  resolutionReport.vault_changes = vaultChanges;
  resolutionReport.app_data_snapshot_after = appDataAfter;
  resolutionReport.app_data_changes = appDataChanges;
  resolutionReport.eframe_persistence_files_after = eframeFilesAfter;
  await saveReport();
  ensureExactSnapshot(vaultBefore, vaultAfter, "OpenObsidian native image-embed link resolution");
  const canonicalVaultRoot = await realpath(vaultRoot);
  const canonicalAppDataRoot = await realpath(appDataRoot);
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataChanges,
    eframeFilesAfter,
    "OpenObsidian app data during native image-embed link resolution",
    [vaultRoot, canonicalVaultRoot, appDataRoot, canonicalAppDataRoot],
  );
  resolutionReport.vault_unchanged = true;
  resolutionReport.app_data_change_policy_passed = true;
  resolutionReport.status = "passed";
  await saveReport();
}

async function runReferenceImageAttachmentRemoval(
  child: ChildProcess,
  window: {window_id: string},
  appDataRoot: string,
  vaultBaseline: SnapshotEntry[],
): Promise<SnapshotEntry[]> {
  const open = report.openobsidian_open as Record<string, unknown>;
  const fixture = report.fixture as Record<string, unknown>;
  const authoredNotePath = fixture.authored_note_path;
  if (typeof authoredNotePath !== "string" || authoredNotePath.length === 0) {
    throw new Error("The pinned Obsidian authoring step did not record the authored note path before attachment removal");
  }
  const noteEntry = vaultBaseline.find((entry) => entry.path === authoredNotePath && entry.kind === "file");
  const attachmentEntry = vaultBaseline.find((entry) => entry.path === attachmentPath && entry.kind === "file");
  if (!noteEntry?.sha256 || !attachmentEntry?.sha256) {
    throw new Error(`The authored note or its attachment is missing before external removal: note=${authoredNotePath}, attachment=${attachmentPath}`);
  }

  const removalReport: Record<string, unknown> = {
    status: "in_progress",
    selected_note_path: authoredNotePath,
    selected_note_sha256: noteEntry.sha256,
    attachment_path: attachmentPath,
    attachment_sha256_before_removal: attachmentEntry.sha256,
    expected_embed_source: noteEmbed,
    expected_link_status_after_refresh: "Unresolved",
    expected_embed_disposition_after_refresh: "not_rendered",
  };
  open.reference_image_attachment_removal = removalReport;

  const refreshRequestCountBeforeRemoval = (await readOpenObsidianRefreshDiagnostics()).requests.length;
  const vaultBeforeRemoval = await snapshotTree(vaultRoot);
  ensureExactSnapshot(vaultBaseline, vaultBeforeRemoval, "OpenObsidian vault before deliberate external image-attachment removal");
  const appDataBeforeRemoval = await snapshotTree(appDataRoot);
  removalReport.vault_snapshot_before_external_removal = vaultBeforeRemoval;
  removalReport.app_data_snapshot_before_external_removal = appDataBeforeRemoval;
  await saveReport();

  await unlink(join(vaultRoot, attachmentPath));
  const vaultAfterExternalRemoval = await snapshotTree(vaultRoot);
  const vaultChangesFromExternalRemoval = changedPaths(vaultBeforeRemoval, vaultAfterExternalRemoval);
  if (
    vaultChangesFromExternalRemoval.length !== 1
    || vaultChangesFromExternalRemoval[0]?.path !== attachmentPath
    || vaultChangesFromExternalRemoval[0]?.before?.sha256 !== attachmentEntry.sha256
    || vaultChangesFromExternalRemoval[0]?.after !== undefined
  ) {
    throw new Error(`External attachment removal changed unexpected vault entries: ${JSON.stringify(vaultChangesFromExternalRemoval).slice(0, 6_000)}`);
  }
  const noteAfterRemoval = await readFile(join(vaultRoot, authoredNotePath));
  const noteAfterRemovalSha256 = createHash("sha256").update(noteAfterRemoval).digest("hex");
  if (noteAfterRemovalSha256 !== noteEntry.sha256 || !noteAfterRemoval.includes(Buffer.from(noteEmbed, "utf8"))) {
    throw new Error(`External attachment removal changed the Obsidian-authored note or its embed source: ${authoredNotePath}`);
  }
  const appDataAfterExternalRemoval = await snapshotTree(appDataRoot);
  ensureExactSnapshot(appDataBeforeRemoval, appDataAfterExternalRemoval, "Separate OpenObsidian app data during deliberate external image-attachment removal");
  const expectedMarkdownCount = countMarkdownFiles(vaultAfterExternalRemoval);
  removalReport.vault_snapshot_after_external_removal = vaultAfterExternalRemoval;
  removalReport.vault_changes_from_external_removal = vaultChangesFromExternalRemoval;
  removalReport.note_sha256_after_removal = noteAfterRemovalSha256;
  removalReport.note_embed_source_preserved = true;
  removalReport.expected_markdown_count_after_refresh = expectedMarkdownCount;
  removalReport.app_data_snapshot_after_external_removal = appDataAfterExternalRemoval;
  removalReport.app_data_unchanged_during_external_removal = true;
  const vaultSnapshots = report.vault_snapshots as Record<string, unknown>;
  vaultSnapshots.before_external_attachment_removal = vaultBeforeRemoval;
  vaultSnapshots.after_external_attachment_removal = vaultAfterExternalRemoval;
  await writeFile(join(reportDirectory, "vault-after-external-attachment-removal.json"), `${JSON.stringify(vaultAfterExternalRemoval, null, 2)}\n`);
  await saveReport();

  if (process.platform !== "win32") await delay(2_000);
  const settledWatcherRefresh = await waitForOpenObsidianRefreshIdle(
    refreshRequestCountBeforeRemoval,
    expectedMarkdownCount,
    false,
  );
  removalReport.watcher_refresh_settled_before_manual = {
    settled_for_ms: settledWatcherRefresh.settled_for_ms,
    latest_receiver_busy: settledWatcherRefresh.receiverStates.at(-1)?.busy ?? false,
    latest_consumed_result: settledWatcherRefresh.consumedResults.at(-1) ?? null,
  };
  const refreshRequestCountBeforeManual = settledWatcherRefresh.requests.length;
  removalReport.refresh_action = await clickManualRefreshUntilRequested(
    child,
    window.window_id,
    refreshRequestCountBeforeManual,
  );
  const settledManualRefresh = await waitForOpenObsidianRefreshIdle(
    refreshRequestCountBeforeManual,
    expectedMarkdownCount,
    true,
  );
  removalReport.manual_refresh_diagnostics = {
    action_request: settledManualRefresh.requests.at(-1) ?? null,
    result: settledManualRefresh.consumedResults.at(-1) ?? null,
    receiver_busy_after_result: settledManualRefresh.receiverStates.at(-1)?.busy ?? false,
    settled_for_ms: settledManualRefresh.settled_for_ms,
  };

  const refreshed = await waitFor("OpenObsidian to refresh after external image-attachment removal", async () => {
    await delay(350);
    const capture = await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-after-external-attachment-removal-refresh");
    removalReport.refresh_screen_ocr = capture.ocrText.slice(0, 4_000);
    return capture;
  }, (capture) => ocrTextContainsRefreshedMarkdownCount(capture.ocrText, expectedMarkdownCount), 30_000);
  removalReport.refreshed_markdown_count_visible = true;
  removalReport.refresh_screenshot = relative(reportDirectory, refreshed.pngPath);
  removalReport.refresh_window_screenshot = relative(reportDirectory, refreshed.windowPngPath);
  const staleResolvedCountVisible = refreshed.ocrText.split(/\r?\n/).some((line) => (
    /(?:^|[^a-z])resolved\s*:?\s*1(?:$|[^0-9])/i.test(line)
  ));
  const staleImageVisible = ocrTextContainsFuzzyPhrase(refreshed.ocrText, `Vault image: ${attachmentPath}`);
  removalReport.stale_resolved_count_visible_after_refresh = staleResolvedCountVisible;
  removalReport.stale_image_visible_after_refresh = staleImageVisible;
  if (staleResolvedCountVisible || staleImageVisible) {
    throw new Error(`OpenObsidian retained stale resolved-image output after refresh: ${JSON.stringify(refreshed.ocrText.slice(0, 2_000))}`);
  }

  const resolveAction = process.platform === "linux"
    ? await clickLinuxResolveButtonFromCiGeometry(window.window_id, authoredNotePath)
    : process.platform === "darwin"
      ? await clickMacOsResolveButtonFromCiGeometry(child, authoredNotePath)
      : await invokeNativeAccessibleControl(child, window.window_id, "Resolve link status", authoredNotePath);
  removalReport.resolve_link_status_action = resolveAction;
  const expectedSummary = `OpenObsidian CI link resolution: source=${authoredNotePath}, total=1, resolved=0, unresolved=1, ambiguous=0, external=0, embed_roots=1, truncated=false`;
  const expectedReference = `OpenObsidian CI link reference: source=${authoredNotePath}, kind=Embed, raw=${JSON.stringify(noteEmbed)}, status=Unresolved, target=<none>`;
  const expectedEmbed = `OpenObsidian CI note embed: source=${authoredNotePath}, index=0, raw=${JSON.stringify(noteEmbed)}, status=Unresolved, target=<none>, disposition=not_rendered`;
  let diagnostics = await waitFor(
    "OpenObsidian to report the externally removed authored attachment as unresolved",
    async () => (await readFile(join(reportDirectory, "openobsidian.log"), "utf8").catch(() => "")).split(/\r?\n/),
    (lines) => lines.includes(expectedSummary) && lines.includes(expectedReference) && lines.includes(expectedEmbed),
    30_000,
  );
  await delay(2_000);
  const settledResolutionRefresh = await waitForOpenObsidianRefreshIdle(
    0,
    expectedMarkdownCount,
    false,
  );
  const initialResolutionLine = diagnostics.findIndex((line) => line === expectedSummary);
  const refreshAfterInitialResolution = settledResolutionRefresh.requests.some((request) => (
    request.source === "watcher_reconciliation" && request.line > initialResolutionLine
  ));
  if (refreshAfterInitialResolution) {
    removalReport.post_resolution_watcher_refresh = {
      request: settledResolutionRefresh.requests.find((request) => (
        request.source === "watcher_reconciliation" && request.line > initialResolutionLine
      )) ?? null,
      consumed_result: settledResolutionRefresh.consumedResults.at(-1) ?? null,
      receiver_busy: settledResolutionRefresh.receiverStates.at(-1)?.busy ?? false,
    };
    const previousLogLineCount = diagnostics.length;
    removalReport.resolve_link_status_retry_action = process.platform === "linux"
      ? await clickLinuxResolveButtonFromCiGeometry(window.window_id, authoredNotePath)
      : process.platform === "darwin"
        ? await clickMacOsResolveButtonFromCiGeometry(child, authoredNotePath)
        : await invokeNativeAccessibleControl(child, window.window_id, "Resolve link status", authoredNotePath);
    diagnostics = await waitFor(
      "OpenObsidian to restore the unresolved image-embed result after vault reconciliation",
      async () => (await readFile(join(reportDirectory, "openobsidian.log"), "utf8").catch(() => "")).split(/\r?\n/),
      (lines) => {
        const retryLines = lines.slice(previousLogLineCount);
        return retryLines.includes(expectedSummary)
          && retryLines.includes(expectedReference)
          && retryLines.includes(expectedEmbed);
      },
      30_000,
    );
  }
  removalReport.link_resolution_diagnostic = diagnostics.find((line) => line === expectedSummary);
  removalReport.link_reference_diagnostic = diagnostics.find((line) => line === expectedReference);
  removalReport.note_embed_diagnostic = diagnostics.find((line) => line === expectedEmbed);
  removalReport.unresolved_target_is_absent = true;
  removalReport.embed_is_not_rendered = true;

  const unresolved = await waitFor("OpenObsidian to display the unresolved attachment with no stale image", async () => {
    await delay(350);
    return await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-external-attachment-unresolved");
  }, (capture) => (
    ocrTextContainsFuzzyPhrase(capture.ocrText, `Link status refreshed for ${authoredNotePath}`)
    && ocrTextContainsFuzzyPhrase(capture.ocrText, "Unresolved: 1")
    && ocrTextContainsFuzzyPhrase(capture.ocrText, "Not rendered: no matching Markdown note or vault attachment was found")
    && !ocrTextContainsFuzzyPhrase(capture.ocrText, `Vault image: ${attachmentPath}`)
  ), 30_000);
  removalReport.unresolved_screen_ocr = unresolved.ocrText.slice(0, 4_000);
  removalReport.unresolved_screenshot = relative(reportDirectory, unresolved.pngPath);
  removalReport.unresolved_window_screenshot = relative(reportDirectory, unresolved.windowPngPath);
  removalReport.unresolved_count_visible = true;
  removalReport.missing_attachment_message_visible = true;
  removalReport.stale_image_absent = true;

  const vaultAfterResolution = await snapshotTree(vaultRoot);
  const appDataAfterResolution = await snapshotTree(appDataRoot);
  const vaultChangesAfterResolution = changedPaths(vaultAfterExternalRemoval, vaultAfterResolution);
  const appDataChangesAfterResolution = changedPaths(appDataAfterExternalRemoval, appDataAfterResolution);
  const eframeFilesAfterResolution = await readSnapshotTextFiles(appDataRoot, appDataAfterResolution, (path) => path.toLowerCase().endsWith(".ron"));
  removalReport.vault_snapshot_after_resolution = vaultAfterResolution;
  removalReport.vault_changes_after_resolution = vaultChangesAfterResolution;
  removalReport.app_data_snapshot_after_resolution = appDataAfterResolution;
  removalReport.app_data_changes_after_resolution = appDataChangesAfterResolution;
  removalReport.eframe_persistence_files_after_resolution = eframeFilesAfterResolution;
  await saveReport();
  ensureExactSnapshot(vaultAfterExternalRemoval, vaultAfterResolution, "OpenObsidian refresh and unresolved image-embed report after external attachment removal");
  const canonicalVaultRoot = await realpath(vaultRoot);
  const canonicalAppDataRoot = await realpath(appDataRoot);
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataChangesAfterResolution,
    eframeFilesAfterResolution,
    "OpenObsidian app data after external attachment removal and re-resolution",
    [vaultRoot, canonicalVaultRoot, appDataRoot, canonicalAppDataRoot],
  );
  removalReport.vault_unchanged_after_external_removal = true;
  removalReport.app_data_change_policy_passed = true;
  removalReport.status = "passed";
  await saveReport();
  return vaultAfterExternalRemoval;
}

async function runReferenceExternalNoteRename(
  child: ChildProcess,
  window: {window_id: string},
  appDataRoot: string,
  vaultBaseline: SnapshotEntry[],
): Promise<SnapshotEntry[]> {
  const open = report.openobsidian_open as Record<string, unknown>;
  const fixture = report.fixture as Record<string, unknown>;
  const authoredNotePath = fixture.authored_note_path;
  if (typeof authoredNotePath !== "string" || authoredNotePath.length === 0) {
    throw new Error("The Obsidian-authored note path is missing before external note rename");
  }
  const oldNote = vaultBaseline.find((entry) => entry.path === externalRefreshMarkdownPath && entry.kind === "file");
  const expectedSha256 = createHash("sha256").update(externalEditedMarkdownBytes).digest("hex");
  if (!oldNote || oldNote.bytes !== externalEditedMarkdownBytes.length || oldNote.sha256 !== expectedSha256) {
    throw new Error("The externally edited note does not match its exact expected bytes before rename");
  }
  if (vaultBaseline.some((entry) => entry.path === externalRenamedMarkdownPath)) {
    throw new Error("The external note rename destination already exists in the vault baseline");
  }

  const renameReport: Record<string, unknown> = {
    status: "in_progress",
    old_path: externalRefreshMarkdownPath,
    new_path: externalRenamedMarkdownPath,
    note_bytes: externalEditedMarkdownBytes.length,
    note_sha256: expectedSha256,
    expected_source_marker: externalEditedMarker,
    expected_markdown_count: countMarkdownFiles(vaultBaseline),
    note_source_preview_open_before_rename: false,
  };
  open.external_note_rename = renameReport;
  await saveReport();

  const vaultBeforePreview = await snapshotTree(vaultRoot);
  ensureExactSnapshot(vaultBaseline, vaultBeforePreview, "OpenObsidian vault before selecting the note for external rename");
  const appDataBeforePreview = await snapshotTree(appDataRoot);
  const sortedNotePaths = vaultBaseline
    .filter((entry) => entry.kind === "file" && entry.path.toLowerCase().endsWith(".md"))
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right, "en"));
  const renameNoteSelection = await selectReferenceNoteForEmbedResolution(
    child,
    window.window_id,
    authoredNotePath,
    externalRefreshMarkdownPath,
    sortedNotePaths,
  );
  renameReport.select_note_action = renameNoteSelection;
  if (process.platform === "win32") {
    renameReport.open_note_selector_action = renameNoteSelection.selector_open_action;
  }
  renameReport.exact_external_note_selected_before_rename = true;
  renameReport.read_source_action = await invokeNativeAccessibleControl(
    child,
    window.window_id,
    "Read note source preview",
    externalRefreshMarkdownPath,
  );
  const previewBeforeRename = await waitFor(
    "OpenObsidian to display the externally edited note source before rename",
    async () => {
      await delay(350);
      const capture = await withSourcePaneOcr(await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-external-note-before-rename"));
      renameReport.preview_screen_ocr = capture.ocrText.slice(0, 4_000);
      renameReport.preview_source_pane_ocr = capture.sourcePaneOcrText.slice(0, 4_000);
      renameReport.preview_source_pane_crop = capture.sourcePaneOcrCropPath
        ? relative(reportDirectory, capture.sourcePaneOcrCropPath)
        : null;
      renameReport.preview_source_pane_crop_bounds = capture.sourcePaneOcrCropBounds;
      return capture;
    },
    (capture) => ocrTextContainsFuzzyPhraseAcrossLines(capture.sourcePaneOcrText, externalEditedMarker, 1),
    30_000,
  );
  renameReport.preview_screenshot = relative(reportDirectory, previewBeforeRename.pngPath);
  renameReport.preview_window_screenshot = relative(reportDirectory, previewBeforeRename.windowPngPath);
  renameReport.source_marker_visible_before_rename = true;
  renameReport.note_source_preview_open_before_rename = true;

  const vaultAfterPreview = await snapshotTree(vaultRoot);
  const appDataAfterPreview = await snapshotTree(appDataRoot);
  ensureExactSnapshot(vaultBeforePreview, vaultAfterPreview, "OpenObsidian note source preview before external rename");
  const previewAppDataChanges = changedPaths(appDataBeforePreview, appDataAfterPreview);
  const previewEframeFiles = await readSnapshotTextFiles(appDataRoot, appDataAfterPreview, (path) => path.toLowerCase().endsWith(".ron"));
  const canonicalVaultRoot = await realpath(vaultRoot);
  const canonicalAppDataRoot = await realpath(appDataRoot);
  ensureAppDataChangesAreMacEframeUiStateOnly(
    previewAppDataChanges,
    previewEframeFiles,
    "OpenObsidian app data while previewing the note before external rename",
    [vaultRoot, canonicalVaultRoot, appDataRoot, canonicalAppDataRoot],
  );
  renameReport.vault_snapshot_before_preview = vaultBeforePreview;
  renameReport.vault_snapshot_after_preview = vaultAfterPreview;
  renameReport.vault_unchanged_after_preview = true;
  renameReport.app_data_snapshot_before_preview = appDataBeforePreview;
  renameReport.app_data_snapshot_after_preview = appDataAfterPreview;
  renameReport.app_data_changes_after_preview = previewAppDataChanges;
  renameReport.app_data_change_policy_passed_after_preview = true;
  await saveReport();

  const settledBeforeRename = await waitForOpenObsidianRefreshIdle(
    0,
    countMarkdownFiles(vaultBaseline),
    false,
  );
  const requestCountBeforeRename = settledBeforeRename.requests.length;
  const vaultBeforeRename = await snapshotTree(vaultRoot);
  ensureExactSnapshot(vaultBaseline, vaultBeforeRename, "OpenObsidian vault immediately before external note rename");
  const appDataBeforeRename = await snapshotTree(appDataRoot);
  const oldNoteBytes = await readFile(join(vaultRoot, externalRefreshMarkdownPath));
  if (!oldNoteBytes.equals(externalEditedMarkdownBytes)) {
    throw new Error("The note source preview does not match the exact expected bytes immediately before external rename");
  }

  await rename(join(vaultRoot, externalRefreshMarkdownPath), join(vaultRoot, externalRenamedMarkdownPath));
  const vaultAfterRename = await snapshotTree(vaultRoot);
  const changesFromExternalRename = changedPaths(vaultBeforeRename, vaultAfterRename);
  const oldPathChange = changesFromExternalRename.find((change) => change.path === externalRefreshMarkdownPath);
  const newPathChange = changesFromExternalRename.find((change) => change.path === externalRenamedMarkdownPath);
  const renamedEntry = vaultAfterRename.find((entry) => entry.path === externalRenamedMarkdownPath && entry.kind === "file");
  if (
    changesFromExternalRename.length !== 2
    || !oldPathChange
    || oldPathChange.before?.sha256 !== expectedSha256
    || oldPathChange.after !== undefined
    || !newPathChange
    || newPathChange.before !== undefined
    || !newPathChange.after
    || newPathChange.after.kind !== "file"
    || newPathChange.after.bytes !== externalEditedMarkdownBytes.length
    || newPathChange.after.sha256 !== expectedSha256
    || !renamedEntry
    || renamedEntry.bytes !== externalEditedMarkdownBytes.length
    || renamedEntry.sha256 !== expectedSha256
    || vaultAfterRename.some((entry) => entry.path === externalRefreshMarkdownPath)
  ) {
    throw new Error("The external note rename did not move only the expected path while preserving bytes: " + JSON.stringify(changesFromExternalRename).slice(0, 6_000));
  }
  const markdownCountAfterRename = countMarkdownFiles(vaultAfterRename);
  const expectedMarkdownCount = countMarkdownFiles(vaultBaseline);
  if (markdownCountAfterRename !== expectedMarkdownCount) {
    throw new Error("The external note rename changed the Markdown count from " + expectedMarkdownCount + " to " + markdownCountAfterRename);
  }
  const appDataAfterRename = await snapshotTree(appDataRoot);
  ensureExactSnapshot(appDataBeforeRename, appDataAfterRename, "Separate OpenObsidian app data during deliberate external note rename");
  renameReport.vault_snapshot_before_external_rename = vaultBeforeRename;
  renameReport.vault_snapshot_after_external_rename = vaultAfterRename;
  renameReport.vault_changes_from_external_rename = changesFromExternalRename;
  renameReport.old_path_absent_after_rename = true;
  renameReport.new_path_bytes_match_old_path = true;
  renameReport.markdown_count_after_rename = markdownCountAfterRename;
  renameReport.app_data_snapshot_before_external_rename = appDataBeforeRename;
  renameReport.app_data_snapshot_after_external_rename = appDataAfterRename;
  renameReport.app_data_unchanged_during_external_rename = true;
  const vaultSnapshots = report.vault_snapshots as Record<string, unknown>;
  vaultSnapshots.before_external_note_rename = vaultBeforeRename;
  vaultSnapshots.after_external_note_rename = vaultAfterRename;
  await writeFile(join(reportDirectory, "vault-after-external-note-rename.json"), JSON.stringify(vaultAfterRename, null, 2) + "\n");
  await saveReport();

  if (process.platform !== "win32") await delay(2_000);
  const settledWatcherRefresh = await waitForOpenObsidianRefreshIdle(
    requestCountBeforeRename,
    expectedMarkdownCount,
    false,
  );
  renameReport.watcher_refresh_settled_before_manual = {
    settled_for_ms: settledWatcherRefresh.settled_for_ms,
    latest_receiver_busy: settledWatcherRefresh.receiverStates.at(-1)?.busy ?? false,
    latest_consumed_result: settledWatcherRefresh.consumedResults.at(-1) ?? null,
  };
  const requestCountBeforeManual = settledWatcherRefresh.requests.length;
  renameReport.refresh_action = await clickManualRefreshUntilRequested(
    child,
    window.window_id,
    requestCountBeforeManual,
  );
  const settledManualRefresh = await waitForOpenObsidianRefreshIdle(
    requestCountBeforeManual,
    expectedMarkdownCount,
    true,
  );
  renameReport.manual_refresh_diagnostics = {
    action_request: settledManualRefresh.requests.at(-1) ?? null,
    result: settledManualRefresh.consumedResults.at(-1) ?? null,
    receiver_busy_after_result: settledManualRefresh.receiverStates.at(-1)?.busy ?? false,
    settled_for_ms: settledManualRefresh.settled_for_ms,
  };

  const sortedPathsAfterRename = vaultAfterRename
    .filter((entry) => entry.kind === "file" && entry.path.toLowerCase().endsWith(".md"))
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right, "en"));
  const expectedFallbackPath = sortedPathsAfterRename[0];
  if (expectedFallbackPath !== externalRenamedMarkdownPath) {
    throw new Error("The renamed note must be the first sorted fixture note for deterministic refresh fallback; first=" + String(expectedFallbackPath));
  }
  const refreshScreenshot = await waitFor(
    "OpenObsidian to clear the stale preview and select the renamed path after refresh",
    async () => {
      await delay(350);
      const capture = await withSourcePaneOcr(await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-after-external-note-rename-refresh"));
      renameReport.refresh_screen_ocr = capture.ocrText.slice(0, 4_000);
      renameReport.refresh_source_pane_ocr = capture.sourcePaneOcrText.slice(0, 4_000);
      renameReport.refresh_source_pane_crop = capture.sourcePaneOcrCropPath
        ? relative(reportDirectory, capture.sourcePaneOcrCropPath)
        : null;
      renameReport.refresh_source_pane_crop_bounds = capture.sourcePaneOcrCropBounds;
      return capture;
    },
    (capture) => (
      ocrTextContainsRefreshedMarkdownCount(capture.ocrText, expectedMarkdownCount)
      && !capture.sourcePaneLabelVisible
      && !ocrTextContainsFuzzyPhraseAcrossLines(capture.ocrText, externalEditedMarker, 1)
    ),
    30_000,
  );
  renameReport.refresh_screenshot = relative(reportDirectory, refreshScreenshot.pngPath);
  renameReport.refresh_window_screenshot = relative(reportDirectory, refreshScreenshot.windowPngPath);
  renameReport.stale_preview_cleared_after_rename = true;
  renameReport.refreshed_markdown_count_visible = true;
  const expectedSelectionAfterRename = "OpenObsidian CI vault refresh selection applied: selected=" + expectedFallbackPath;
  const refreshSelectionLog = await waitFor(
    "OpenObsidian to apply its exact fallback selection after the external note rename",
    async () => (await readFile(join(reportDirectory, "openobsidian.log"), "utf8").catch(() => "")).split(/\r?\n/),
    (lines) => lines.includes(expectedSelectionAfterRename),
    15_000,
  );
  renameReport.expected_fallback_path = expectedFallbackPath;
  renameReport.selection_after_refresh_diagnostic = refreshSelectionLog.find((line) => line === expectedSelectionAfterRename);
  renameReport.exact_renamed_path_selected_after_refresh = true;

  renameReport.read_renamed_source_action = await invokeNativeAccessibleControl(
    child,
    window.window_id,
    "Read note source preview",
    externalRenamedMarkdownPath,
  );
  const renamedPreview = await waitFor(
    "OpenObsidian to preview the same source bytes through the renamed note path",
    async () => {
      await delay(350);
      const capture = await withSourcePaneOcr(await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-renamed-note-source-preview"));
      renameReport.renamed_preview_screen_ocr = capture.ocrText.slice(0, 4_000);
      renameReport.renamed_preview_source_pane_ocr = capture.sourcePaneOcrText.slice(0, 4_000);
      renameReport.renamed_preview_source_pane_crop = capture.sourcePaneOcrCropPath
        ? relative(reportDirectory, capture.sourcePaneOcrCropPath)
        : null;
      renameReport.renamed_preview_source_pane_crop_bounds = capture.sourcePaneOcrCropBounds;
      return capture;
    },
    (capture) => ocrTextContainsFuzzyPhraseAcrossLines(capture.sourcePaneOcrText, externalEditedMarker, 1),
    30_000,
  );
  renameReport.renamed_preview_screenshot = relative(reportDirectory, renamedPreview.pngPath);
  renameReport.renamed_preview_window_screenshot = relative(reportDirectory, renamedPreview.windowPngPath);
  renameReport.renamed_source_marker_visible = true;

  const vaultAfterRenamedPreview = await snapshotTree(vaultRoot);
  const appDataAfterRenamedPreview = await snapshotTree(appDataRoot);
  ensureExactSnapshot(vaultAfterRename, vaultAfterRenamedPreview, "OpenObsidian preview of the externally renamed note");
  const appDataChangesAfterRenamedPreview = changedPaths(appDataAfterRename, appDataAfterRenamedPreview);
  const eframeFilesAfterRenamedPreview = await readSnapshotTextFiles(
    appDataRoot,
    appDataAfterRenamedPreview,
    (path) => path.toLowerCase().endsWith(".ron"),
  );
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataChangesAfterRenamedPreview,
    eframeFilesAfterRenamedPreview,
    "OpenObsidian app data after previewing the externally renamed note",
    [vaultRoot, canonicalVaultRoot, appDataRoot, canonicalAppDataRoot],
  );
  renameReport.vault_snapshot_after_renamed_preview = vaultAfterRenamedPreview;
  renameReport.vault_unchanged_after_renamed_preview = true;
  renameReport.app_data_snapshot_after_renamed_preview = appDataAfterRenamedPreview;
  renameReport.app_data_changes_after_renamed_preview = appDataChangesAfterRenamedPreview;
  renameReport.app_data_change_policy_passed_after_renamed_preview = true;
  await saveReport();

  renameReport.close_preview_action = await invokeNativeAccessibleControl(
    child,
    window.window_id,
    "Close source preview",
    "Note source preview",
  );
  const closedPreview = await waitFor(
    "OpenObsidian to close the renamed note source preview",
    async () => {
      await delay(350);
      const capture = await withSourcePaneOcr(await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-renamed-note-preview-closed"));
      renameReport.closed_screen_ocr = capture.ocrText.slice(0, 4_000);
      return capture;
    },
    (capture) => !capture.sourcePaneLabelVisible
      && !ocrTextContainsFuzzyPhraseAcrossLines(capture.ocrText, externalEditedMarker, 1),
    30_000,
  );
  renameReport.closed_screenshot = relative(reportDirectory, closedPreview.pngPath);
  renameReport.preview_closed = true;

  const vaultAfterClose = await snapshotTree(vaultRoot);
  const appDataAfterClose = await snapshotTree(appDataRoot);
  ensureExactSnapshot(vaultAfterRename, vaultAfterClose, "OpenObsidian close after external note rename");
  const appDataChangesAfterClose = changedPaths(appDataAfterRename, appDataAfterClose);
  const eframeFilesAfterClose = await readSnapshotTextFiles(appDataRoot, appDataAfterClose, (path) => path.toLowerCase().endsWith(".ron"));
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataChangesAfterClose,
    eframeFilesAfterClose,
    "OpenObsidian app data after closing the externally renamed note preview",
    [vaultRoot, canonicalVaultRoot, appDataRoot, canonicalAppDataRoot],
  );
  renameReport.vault_snapshot_after_close = vaultAfterClose;
  renameReport.vault_unchanged_after_close = true;
  renameReport.app_data_snapshot_after_close = appDataAfterClose;
  renameReport.app_data_changes_after_close = appDataChangesAfterClose;
  renameReport.app_data_change_policy_passed_after_close = true;
  renameReport.status = "passed";
  await saveReport();
  return vaultAfterRename;
}

async function runOpenObsidian(noOpBaseline: SnapshotEntry[]): Promise<SnapshotEntry[]> {
  const userConfigRoot = join(workDirectory, "openobsidian-user-config");
  const homeRoot = join(workDirectory, "openobsidian-home");
  const localDataRoot = join(workDirectory, "openobsidian-local-data");
  const appEnv: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: homeRoot,
  };
  let appDataRoot: string;
  if (process.platform === "win32") {
    appEnv.APPDATA = userConfigRoot;
    appEnv.LOCALAPPDATA = localDataRoot;
    appEnv.USERPROFILE = homeRoot;
    appDataRoot = join(userConfigRoot, "OpenObsidian");
  } else if (process.platform === "darwin") {
    appDataRoot = join(homeRoot, "Library", "Application Support", "OpenObsidian");
  } else {
    appEnv.XDG_CONFIG_HOME = userConfigRoot;
    appEnv.XDG_CACHE_HOME = join(workDirectory, "openobsidian-cache");
    appEnv.XDG_DATA_HOME = join(workDirectory, "openobsidian-data");
    appEnv.LIBGL_ALWAYS_SOFTWARE = "1";
    appEnv.WGPU_BACKEND = "gl";
    appDataRoot = join(userConfigRoot, "OpenObsidian");
  }
  await mkdir(homeRoot, {recursive: true});
  await mkdir(join(homeRoot, "Desktop"), {recursive: true});
  const child = launchLogged(openObsidianBinary, [], join(reportDirectory, "openobsidian.log"), appEnv);
  (report.openobsidian_open as Record<string, unknown>).pid = child.pid ?? null;
  try {
    await delay(1_000);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`OpenObsidian exited before rendering the selected vault (code=${child.exitCode}, signal=${child.signalCode})`);
    }
    let window: {window_id: string; title: string; geometry: string};
    if (process.platform === "linux") {
      const x11Window = await waitFor("OpenObsidian window to become visible", async () => {
        try {
          const output = execFileSync("xdotool", ["search", "--onlyvisible", "--name", "OpenObsidian"], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
          const windowId = output.trim().split(/\s+/).filter(Boolean).at(-1);
          if (!windowId) return null;
          const title = execFileSync("xdotool", ["getwindowname", windowId], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
          const geometry = execFileSync("xdotool", ["getwindowgeometry", "--shell", windowId], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
          return {window_id: windowId, title, geometry};
        } catch {
          return null;
        }
      }, (value) => value !== null, 30_000);
      if (!x11Window) throw new Error("OpenObsidian did not expose a visible X11 window");
      window = x11Window;
      (report.openobsidian_open as Record<string, unknown>).x11_window = x11Window;
      try {
        xdotool("windowfocus", "--sync", window.window_id);
      } catch {
        // Direct per-window capture below still works if Xvfb has no window manager.
      }
    } else {
      window = {window_id: String(child.pid ?? "unknown"), title: "OpenObsidian main window", geometry: "native window bounds captured during screenshot"};
      (report.openobsidian_open as Record<string, unknown>).native_window = window;
    }
    const open = report.openobsidian_open as Record<string, unknown>;
    const expectedInitialMarkdownCount = countMarkdownFiles(noOpBaseline);
    open.folder_picker = await selectOpenObsidianVaultFromNativePicker(
      child,
      window,
      join(reportDirectory, "openobsidian.log"),
    );
    let renderAttempt = 0;
    await waitFor("OpenObsidian to render the selected vault and note count", async () => {
      await delay(1_000);
      const captured = await captureOpenObsidianScreenshot(window.window_id, child);
      renderAttempt += 1;
      open.screenshot = "openobsidian-vault.png";
      open.window_screenshot = "openobsidian-vault-window.png";
      open.ocr_screenshot = relative(reportDirectory, captured.ocrPngPath).split(sep).join("/");
      open.screen_ocr = captured.ocrText;
      open.render_attempts = renderAttempt;
      return captured;
    }, (candidate) => (
      candidate.ocrText.toLowerCase().includes("roundtrip fixture")
      && new RegExp(`${expectedInitialMarkdownCount}\\s+Markdown files found`, "i").test(candidate.ocrText)
    ), 30_000);
    const initialAppData = await snapshotTree(appDataRoot);
    const canonicalVault = await realpath(vaultRoot);
    const canonicalAppData = await realpath(appDataRoot);
    const relativeAppData = relative(canonicalVault, canonicalAppData);
    if (relativeAppData === "" || (!relativeAppData.startsWith(`..${sep}`) && relativeAppData !== ".." && !relativeAppData.startsWith(sep))) {
      throw new Error("OpenObsidian's managed application data directory is inside the selected vault");
    }
    (report.openobsidian_open as Record<string, unknown>).status = "passed";
    (report.openobsidian_open as Record<string, unknown>).selected_vault_visible = true;
    (report.openobsidian_open as Record<string, unknown>).expected_markdown_count_visible = true;
    (report.openobsidian_app_data as Record<string, unknown>).root = appDataRoot;
    (report.openobsidian_app_data as Record<string, unknown>).canonical_root_is_outside_vault = true;
    (report.openobsidian_app_data as Record<string, unknown>).snapshot_after_startup = initialAppData;
    await saveReport();

    await runReferenceSourcePreview(child, window, appDataRoot, noOpBaseline);
    const vaultBaselineAfterExternalNoteEdit = await runReferenceExternalNoteRefresh(child, window, appDataRoot, noOpBaseline);
    const expectedMarkdownCountAfterExternalCreation = countMarkdownFiles(vaultBaselineAfterExternalNoteEdit);
    open.expected_markdown_count_after_external_refresh = expectedMarkdownCountAfterExternalCreation;
    open.expected_markdown_count_after_external_note_edit = expectedMarkdownCountAfterExternalCreation;
    await runReferenceImageEmbedResolution(child, window, appDataRoot, vaultBaselineAfterExternalNoteEdit);
    const vaultBaselineAfterAttachmentRemoval = await runReferenceImageAttachmentRemoval(
      child,
      window,
      appDataRoot,
      vaultBaselineAfterExternalNoteEdit,
    );
    const vaultBaselineAfterExternalNoteRename = await runReferenceExternalNoteRename(
      child,
      window,
      appDataRoot,
      vaultBaselineAfterAttachmentRemoval,
    );
    open.expected_markdown_count_after_external_note_rename = countMarkdownFiles(vaultBaselineAfterExternalNoteRename);
    const appDataBaselineAfterPickerCancellation = await runOpenObsidianPickerCancellation(
      child,
      window,
      appDataRoot,
      vaultBaselineAfterExternalNoteRename,
      initialAppData,
      expectedMarkdownCountAfterExternalCreation,
    );
    await delay(2_000);
    await stopProcess(child);
    const afterVault = await snapshotTree(vaultRoot);
    ensureExactSnapshot(vaultBaselineAfterExternalNoteRename, afterVault, "OpenObsidian no-op open, external note refresh, image attachment removal, note rename, picker cancellation, and close");
    const afterAppData = await snapshotTree(appDataRoot);
    const appDataChangesAfterClose = changedPaths(appDataBaselineAfterPickerCancellation, afterAppData);
    const eframePersistenceFilesAfterClose = await readSnapshotTextFiles(appDataRoot, afterAppData, (path) => path.toLowerCase().endsWith(".ron"));
    ensureAppDataChangesAreMacEframeUiStateOnly(
      appDataChangesAfterClose,
      eframePersistenceFilesAfterClose,
      "OpenObsidian app data after picker cancellation and close",
      [vaultRoot, canonicalVault, appDataRoot],
    );
    (report.vault_snapshots as Record<string, unknown>).after_openobsidian = afterVault;
    (report.vault_snapshots as Record<string, unknown>).after_picker_cancellation_close = afterVault;
    (report.openobsidian_app_data as Record<string, unknown>).snapshot_after_close = afterAppData;
    (report.openobsidian_app_data as Record<string, unknown>).snapshot_after_picker_cancellation_close = afterAppData;
    (report.openobsidian_app_data as Record<string, unknown>).changes_after_picker_baseline_and_close = appDataChangesAfterClose;
    (report.openobsidian_app_data as Record<string, unknown>).eframe_persistence_files_after_picker_baseline_and_close = eframePersistenceFilesAfterClose;
    const appDataChangesFromStartupThroughCancellation = changedPaths(initialAppData, appDataBaselineAfterPickerCancellation);
    (report.openobsidian_app_data as Record<string, unknown>).changes_from_startup_through_picker_cancellation = appDataChangesFromStartupThroughCancellation;
    (report.openobsidian_app_data as Record<string, unknown>).unchanged_after_initial_startup = appDataChangesFromStartupThroughCancellation.length === 0;
    (report.openobsidian_app_data as Record<string, unknown>).unchanged_after_picker_baseline_and_close = appDataChangesAfterClose.length === 0;
    const cancellation = open.folder_picker_cancel as Record<string, unknown>;
    cancellation.vault_snapshot_unchanged_after_close = true;
    cancellation.app_data_snapshot_unchanged_after_close = appDataChangesAfterClose.length === 0;
    cancellation.app_data_changes_after_close = appDataChangesAfterClose;
    cancellation.eframe_persistence_files_after_close = eframePersistenceFilesAfterClose;
    cancellation.app_data_changes_after_close_only_eframe_ui_state = true;
    cancellation.vault_snapshot_after_close = afterVault;
    cancellation.app_data_snapshot_after_close = afterAppData;
    await saveReport();
    return afterVault;
  } finally {
    await stopProcess(child).catch(() => undefined);
  }
}

async function runOpenObsidianPickerCancellation(
  child: ChildProcess,
  window: {window_id: string},
  appDataRoot: string,
  vaultBeforeCancellation: SnapshotEntry[],
  appDataBeforeCancellation: SnapshotEntry[],
  expectedMarkdownCount: number,
): Promise<SnapshotEntry[]> {
  const open = report.openobsidian_open as Record<string, unknown>;
  await delay(1_500);
  const startupScreen = await captureOpenObsidianScreenshot(window.window_id, child, "openobsidian-vault-before-picker-cancel");
  if (
    !startupScreen.ocrText.toLowerCase().includes("roundtrip fixture")
    || !ocrTextContainsRefreshedMarkdownCount(startupScreen.ocrText, expectedMarkdownCount)
  ) {
    throw new Error(`OpenObsidian did not display the active vault before picker cancellation; OCR=${JSON.stringify(startupScreen.ocrText.slice(0, 2_000))}`);
  }

  const canonicalVault = await realpath(vaultRoot);
  const canonicalAppData = await realpath(appDataRoot);
  const relativeAppData = relative(canonicalVault, canonicalAppData);
  if (relativeAppData === "" || (!relativeAppData.startsWith(`..${sep}`) && relativeAppData !== ".." && !relativeAppData.startsWith(sep))) {
    throw new Error("OpenObsidian's managed application data directory is inside the selected vault");
  }
  const vaultSnapshotBeforeCancel = await snapshotTree(vaultRoot);
  const appDataSnapshotBeforePickerOpen = await snapshotTree(appDataRoot);
  const eframeFilesBeforePickerOpen = await readSnapshotTextFiles(appDataRoot, appDataSnapshotBeforePickerOpen, (path) => path.toLowerCase().endsWith(".ron"));
  const appDataStartupChanges = changedPaths(appDataBeforeCancellation, appDataSnapshotBeforePickerOpen);
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataStartupChanges,
    eframeFilesBeforePickerOpen,
    "OpenObsidian startup before native picker open",
    [vaultRoot, canonicalVault, appDataRoot],
  );
  const unexpectedAppDataStartupChanges = appDataStartupChanges.filter((change) => (
    process.platform !== "darwin" || change.path !== "app.ron" || change.after?.kind !== "file"
  ));
  const appDataReport = report.openobsidian_app_data as Record<string, unknown>;
  appDataReport.snapshot_before_picker_open = appDataSnapshotBeforePickerOpen;
  appDataReport.startup_persistence_changes = appDataStartupChanges;
  appDataReport.eframe_persistence_files_before_picker_open = eframeFilesBeforePickerOpen;
  await saveReport();
  ensureExactSnapshot(vaultBeforeCancellation, vaultSnapshotBeforeCancel, "OpenObsidian vault before picker cancellation");
  if (unexpectedAppDataStartupChanges.length > 0) {
    throw new Error(`OpenObsidian app data changed before picker cancellation outside eframe app.ron persistence: ${JSON.stringify(unexpectedAppDataStartupChanges).slice(0, 6_000)}`);
  }

  const pickerCancellation = await cancelOpenObsidianNativePicker(
    child,
    window,
    appDataRoot,
    appDataSnapshotBeforePickerOpen,
    vaultRoot,
    canonicalVault,
    expectedMarkdownCount,
  );
  const appDataSnapshotBeforeCancel = pickerCancellation.app_data_snapshot_before_cancel as SnapshotEntry[];
  const appRonFilesBeforeCancel = pickerCancellation.eframe_persistence_files_before_cancel as Array<{path: string; bytes: number; sha256: string; content: string}>;
  const appDataChangesOnPickerOpen = pickerCancellation.app_data_changes_on_picker_open as Array<{path: string; before?: SnapshotEntry; after?: SnapshotEntry}>;
  appDataReport.snapshot_before_picker_cancellation = appDataSnapshotBeforeCancel;
  appDataReport.changes_on_picker_open = appDataChangesOnPickerOpen;
  appDataReport.eframe_persistence_files_before_cancellation = appRonFilesBeforeCancel;
  await saveReport();
  const vaultAfterCancellation = await snapshotTree(vaultRoot);
  const appDataAfterCancellation = await snapshotTree(appDataRoot);
  const appRonFilesAfterCancel = await readSnapshotTextFiles(appDataRoot, appDataAfterCancellation, (path) => path.toLowerCase().endsWith(".ron"));
  const vaultChangesAfterCancel = changedPaths(vaultSnapshotBeforeCancel, vaultAfterCancellation);
  const appDataChangesAfterCancel = changedPaths(appDataSnapshotBeforeCancel, appDataAfterCancellation);
  ensureAppDataChangesAreMacEframeUiStateOnly(
    appDataChangesAfterCancel,
    appRonFilesAfterCancel,
    "OpenObsidian app data after native picker cancellation",
    [vaultRoot, canonicalVault, appDataRoot],
  );

  open.folder_picker_cancel = {
    active_session: true,
    startup_vault_visible: true,
    startup_markdown_count_visible: true,
    startup_screen_ocr: startupScreen.ocrText.slice(0, 2_000),
    ...pickerCancellation,
    vault_snapshot_unchanged_after_cancel: vaultChangesAfterCancel.length === 0,
    app_data_snapshot_unchanged_after_cancel: appDataChangesAfterCancel.length === 0,
    app_data_changes_after_cancel_only_eframe_ui_state: true,
    app_data_changes_on_picker_open: appDataChangesOnPickerOpen,
    vault_changes_after_cancel: vaultChangesAfterCancel,
    app_data_changes_after_cancel: appDataChangesAfterCancel,
    eframe_persistence_files_before_cancel: appRonFilesBeforeCancel,
    eframe_persistence_files_after_cancel: appRonFilesAfterCancel,
    vault_snapshot_before_cancel: vaultSnapshotBeforeCancel,
    vault_snapshot_after_cancel: vaultAfterCancellation,
    app_data_snapshot_before_cancel: appDataSnapshotBeforeCancel,
    app_data_snapshot_after_cancel: appDataAfterCancellation,
  };
  (report.vault_snapshots as Record<string, unknown>).after_picker_cancellation = vaultAfterCancellation;
  (report.openobsidian_app_data as Record<string, unknown>).snapshot_after_picker_cancellation = appDataAfterCancellation;
  await saveReport();
  ensureExactSnapshot(vaultSnapshotBeforeCancel, vaultAfterCancellation, "OpenObsidian native picker cancellation");
  return appDataAfterCancellation;
}

async function reopenInObsidian(
  child: ChildProcess,
  notePath: string,
  expectedAttachmentPresent: boolean,
  externalNotePath: string,
): Promise<DevToolsConnection> {
  if (child.exitCode !== null) throw new Error(`Pinned Obsidian exited before reopen (code ${child.exitCode})`);
  const {connection, browserVersion, target} = await connectObsidian(9223);
  const reopen = report.obsidian_reopen as Record<string, unknown>;
  reopen.devtools_browser = browserVersion;
  reopen.first_target = {title: target.title ?? "", url: target.url ?? ""};
  await chooseRestrictedMode(connection, reopen);
  const trustPromptHidden = await connection.evaluateJson<boolean>(
    "!(document.body?.innerText ?? '').includes('Do you trust the author of this vault?')",
  );
  reopen.trust_prompt_hidden = trustPromptHidden;
  if (!trustPromptHidden) throw new Error("Obsidian's first-run trust prompt still covers the reopened vault");
  const notePathJson = JSON.stringify(notePath);
  const readVisible = async () => await connection.evaluateJson<{
    body: string;
    editor: string;
    title: string;
    paths: string[];
  }>(`(() => ({
    body: document.body?.innerText ?? '',
    editor: [...document.querySelectorAll('[contenteditable="true"]')].map((element) => element.innerText ?? '').join('\\n'),
    title: document.title,
    paths: [...document.querySelectorAll('[data-path]')].map((element) => element.getAttribute('data-path') || '')
  }))()`);
  let visible = await waitFor("Obsidian to reopen the authored vault note", readVisible, (value) => value.editor.includes(noteMarker), 45_000).catch(() => null);

  if (!visible) {
    await connection.evaluate(`(() => {
      const target = [...document.querySelectorAll('[data-path]')].find((element) => element.getAttribute('data-path') === ${notePathJson});
      target?.click();
      return Boolean(target);
    })()`);
    visible = await waitFor("Obsidian's file explorer to open the authored note", readVisible, (value) => value.editor.includes(noteMarker), 30_000);
  }

  if (!visible.paths.includes(notePath)) {
    visible = await waitFor(
      "Obsidian's file explorer to expose the authored note path",
      readVisible,
      (value) => value.paths.includes(notePath),
      20_000,
    );
  }

  const authoredNoteVisible = visible;
  visible = await waitFor(
    "Obsidian to list the external note after reopening the vault",
    readVisible,
    (value) => value.paths.includes(externalNotePath),
    20_000,
  );
  if (externalNotePath !== externalRefreshMarkdownPath && visible.paths.includes(externalRefreshMarkdownPath)) {
    throw new Error("Obsidian still lists the old external note path after the rename");
  }
  const externalNoteAfterReopen = await readFile(join(vaultRoot, externalNotePath));
  const externalNoteSha256 = createHash("sha256").update(externalNoteAfterReopen).digest("hex");
  if (!externalNoteAfterReopen.equals(externalEditedMarkdownBytes)) {
    throw new Error("Obsidian reopen changed the externally edited note bytes at " + externalNotePath);
  }

  reopen.editor_text = authoredNoteVisible.editor.slice(0, 2_000);
  reopen.visible_vault_text = authoredNoteVisible.body.slice(0, 4_000);
  reopen.final_file_tree_paths = authoredNoteVisible.paths;
  await captureObsidianScreenshot(connection, "obsidian-reopened-vault.png");
  reopen.screenshot = "obsidian-reopened-vault.png";

  const externalNoteSelectionAction = await connection.evaluateJson<boolean>(
    "(() => { const target = [...document.querySelectorAll('[data-path]')].find((element) => element.getAttribute('data-path') === "
      + JSON.stringify(externalNotePath)
      + "); target?.click(); return Boolean(target); })()",
  );
  if (!externalNoteSelectionAction) {
    throw new Error("Obsidian did not expose the externally edited note for selection after reopen");
  }
  const externalEditedNoteVisible = await waitFor(
    "Obsidian to render the externally edited note after reopening the vault",
    readVisible,
    (value) => value.paths.includes(externalNotePath)
      && value.editor.includes(externalEditedMarker)
      && !value.body.includes("Do you trust the author of this vault?"),
    20_000,
  );

  const noteSource = await readFile(join(vaultRoot, notePath), "utf8");
  const attachmentLinkPersistedInSource = noteSource.includes(noteEmbed);
  if (!attachmentLinkPersistedInSource) {
    throw new Error(`Reopened Obsidian note source does not retain the expected attachment link ${attachmentPath}`);
  }

  const attachmentFolderJson = JSON.stringify(attachmentPath.split("/")[0]);
  if (expectedAttachmentPresent && !visible.paths.includes(attachmentPath)) {
    await connection.evaluate(`(() => {
      const folder = [...document.querySelectorAll('[data-path]')].find((element) => element.getAttribute('data-path') === ${attachmentFolderJson});
      folder?.click();
    })()`);
    await delay(500);
  }
  const pathsAfterExpand = await connection.evaluateJson<string[]>(`[...document.querySelectorAll('[data-path]')].map((element) => element.getAttribute('data-path') || '')`);
  const exactAttachmentListed = pathsAfterExpand.includes(attachmentPath);
  const attachmentPathVisibleInRenderedNote = visible.editor.includes(attachmentPath);
  if (expectedAttachmentPresent && !exactAttachmentListed && !attachmentPathVisibleInRenderedNote) {
    throw new Error(`Obsidian does not display attachment path ${attachmentPath} in either the file explorer or the reopened note; paths=${JSON.stringify(pathsAfterExpand).slice(0, 2_000)}`);
  }
  if (!expectedAttachmentPresent && exactAttachmentListed) {
    throw new Error(`Obsidian unexpectedly restored externally removed attachment ${attachmentPath}`);
  }

  const selectedVaultNameVisible = visible.title.includes("Roundtrip Fixture") || visible.body.includes("Roundtrip Fixture");
  if (!selectedVaultNameVisible) {
    throw new Error(`Obsidian did not visibly identify the reopened vault name; title=${JSON.stringify(visible.title)} body=${JSON.stringify(visible.body.slice(0, 2_000))}`);
  }
  reopen.selected_vault_name_visible = selectedVaultNameVisible;
  reopen.selected_vault_restored = authoredNoteVisible.editor.includes(noteMarker) && authoredNoteVisible.paths.includes(notePath);
  reopen.note_path = notePath;
  reopen.note_path_visible_in_file_explorer = true;
  reopen.attachment_path = attachmentPath;
  reopen.attachment_path_expected_present = expectedAttachmentPresent;
  reopen.attachment_link_persisted_in_note_source = attachmentLinkPersistedInSource;
  reopen.attachment_path_visible_in_file_explorer = exactAttachmentListed;
  reopen.attachment_path_visible_in_editor_text = attachmentPathVisibleInRenderedNote;
  reopen.attachment_remains_absent_after_reopen = !expectedAttachmentPresent && !exactAttachmentListed;
  reopen.external_note_path = externalNotePath;
  reopen.external_note_path_visible_in_file_explorer = visible.paths.includes(externalNotePath);
  reopen.external_old_path_absent_after_rename = externalNotePath === externalRefreshMarkdownPath
    || !visible.paths.includes(externalRefreshMarkdownPath);
  reopen.external_note_source_marker_visible_after_reopen = externalEditedNoteVisible.editor.includes(externalEditedMarker);
  reopen.external_note_trust_prompt_hidden = !externalEditedNoteVisible.body.includes("Do you trust the author of this vault?");
  reopen.external_note_source_bytes_match_external_edit = externalNoteAfterReopen.equals(externalEditedMarkdownBytes);
  reopen.external_note_bytes = externalNoteAfterReopen.length;
  reopen.external_note_sha256 = externalNoteSha256;
  reopen.external_note_source_unchanged = true;
  await captureObsidianScreenshot(connection, "obsidian-reopened-external-note.png");
  reopen.external_note_screenshot = "obsidian-reopened-external-note.png";

  reopen.status = "reference_checks_passed";
  return connection;
}

async function verifyCanvasReferenceVisible(
  connection: DevToolsConnection,
  expectedCanvas: {bytes: number; sha256: string},
  screenshot: string,
  label: string,
): Promise<{body: string; editor: string; title: string; paths: string[]; bytes: number; sha256: string}> {
  const readVisible = async () => await connection.evaluateJson<{
    body: string;
    editor: string;
    title: string;
    paths: string[];
  }>(`(() => ({
    body: document.body?.innerText ?? '',
    editor: [...document.querySelectorAll('[contenteditable="true"]')].map((element) => element.innerText ?? '').join('\\n'),
    title: document.title,
    paths: [...document.querySelectorAll('[data-path]')].map((element) => element.getAttribute('data-path') || '')
  }))()`);
  let visible = await waitFor(
    `${label}: Obsidian to list the reference Canvas path`,
    readVisible,
    (value) => value.paths.includes(canvasPath),
    45_000,
  );
  const expectedCanvasContentVisible = (value: {body: string; paths: string[]}) => value.paths.includes(canvasPath)
    && value.body.includes(canvasMarker)
    && value.body.includes(canvasTargetText)
    && !value.body.includes("Do you trust the author of this vault?");
  if (!expectedCanvasContentVisible(visible)) {
    const selectionAction = await connection.evaluateJson<boolean>(`(() => {
      const target = [...document.querySelectorAll('[data-path]')]
        .find((element) => element.getAttribute('data-path') === ${JSON.stringify(canvasPath)});
      target?.click();
      return Boolean(target);
    })()`);
    if (!selectionAction) {
      throw new Error(`${label}: Obsidian did not expose ${canvasPath} for selection`);
    }
    visible = await waitFor(
      `${label}: Obsidian to render the Canvas marker and path`,
      readVisible,
      expectedCanvasContentVisible,
      30_000,
    );
  }
  if (!expectedCanvasContentVisible(visible)) {
    throw new Error(`${label}: Obsidian did not visibly render ${canvasMarker} and the ${canvasTargetPath} block subpath at ${canvasPath}`);
  }
  if (visible.body.includes("Unable to find")) {
    throw new Error(`${label}: Obsidian could not resolve the Canvas file subpath: ${visible.body.slice(0, 2_000)}`);
  }
  const bytes = await readFile(join(canvasVaultRoot, canvasPath));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== expectedCanvas.bytes || sha256 !== expectedCanvas.sha256) {
    await writeFile(join(reportDirectory, "canvas-reference-before-shutdown-check.canvas"), bytes);
    throw new Error(`${label}: Obsidian changed Canvas fixture bytes before shutdown at ${canvasPath}`);
  }
  await captureObsidianScreenshot(connection, screenshot);
  return {...visible, bytes: bytes.length, sha256};
}

async function assertCanvasReferenceSource(
  byteBaseline: {bytes: number; sha256: string},
  expectedDocument: unknown,
  stage: string,
): Promise<{
  bytes: number;
  sha256: string;
  byte_identical_to_baseline: boolean;
  semantic_content_matches_expected: true;
}> {
  // Obsidian may canonicalize Canvas JSON whitespace on shutdown. OpenObsidian's
  // preview/create checks stay byte-exact; this reference-app boundary checks data.
  const bytes = await readFile(join(canvasVaultRoot, canvasPath));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let actualDocument: unknown;
  try {
    actualDocument = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    const evidenceFilename = stage.includes("first")
      ? "canvas-reference-after-first-close.canvas"
      : "canvas-reference-after-reopen-close.canvas";
    await writeFile(join(reportDirectory, evidenceFilename), bytes);
    throw new Error(`Obsidian left invalid Canvas JSON after ${stage}: ${error instanceof Error ? error.message : "unknown JSON parse error"}`);
  }
  if (!isDeepStrictEqual(actualDocument, expectedDocument)) {
    const evidenceFilename = stage.includes("first")
      ? "canvas-reference-after-first-close.canvas"
      : "canvas-reference-after-reopen-close.canvas";
    await writeFile(join(reportDirectory, evidenceFilename), bytes);
    throw new Error(`Obsidian changed the expected Canvas data after ${stage}; got ${bytes.length} bytes / ${sha256}`);
  }
  return {
    bytes: bytes.length,
    sha256,
    byte_identical_to_baseline: bytes.length === byteBaseline.bytes && sha256 === byteBaseline.sha256,
    semantic_content_matches_expected: true,
  };
}

async function assertCanvasCreatedNoteSource(expectedBytes: Buffer, stage: string): Promise<{bytes: number; sha256: string}> {
  const bytes = await readFile(join(canvasVaultRoot, canvasNotePath));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const expectedSha256 = createHash("sha256").update(expectedBytes).digest("hex");
  if (!bytes.equals(expectedBytes)) {
    const filename = stage.includes("first") ? "canvas-note-after-first-obsidian-close.md" : "canvas-note-after-reopen-obsidian-close.md";
    await writeFile(join(reportDirectory, filename), bytes);
    throw new Error(`Obsidian changed the created Canvas note after ${stage}: expected ${expectedBytes.length} bytes / ${expectedSha256}, got ${bytes.length} bytes / ${sha256}`);
  }
  return {bytes: bytes.length, sha256};
}

async function verifyCanvasCreatedNoteVisible(
  connection: DevToolsConnection,
  screenshot: string,
  label: string,
): Promise<{
  body: string;
  editor: string;
  title: string;
  paths: string[];
  active_file_path: string | null;
  active_tree_path: string | null;
  active_view_type: string | null;
  active_view_is_markdown: boolean;
  active_view_text: string;
}> {
  const readVisible = async () => await connection.evaluateJson<{
    body: string;
    editor: string;
    title: string;
    paths: string[];
    active_file_path: string | null;
    active_tree_path: string | null;
    active_view_type: string | null;
    active_view_is_markdown: boolean;
    active_view_text: string;
  }>(`(() => ({
    body: document.body?.innerText ?? '',
    editor: [...document.querySelectorAll('[contenteditable="true"]')].map((element) => element.innerText ?? '').join('\\n'),
    title: document.title,
    paths: [...document.querySelectorAll('[data-path]')].map((element) => element.getAttribute('data-path') || ''),
    active_file_path: window.app?.workspace?.getActiveFile?.()?.path
      ?? window.app?.workspace?.activeLeaf?.view?.file?.path
      ?? null,
    active_tree_path: [...document.querySelectorAll('[data-path].is-active')]
      .map((element) => element.getAttribute('data-path') || '')
      .find(Boolean)
      ?? null,
    active_view_type: window.app?.workspace?.activeLeaf?.view?.getViewType?.()
      ?? document.querySelector('.workspace-leaf.mod-active')?.getAttribute('data-type')
      ?? null,
    active_view_is_markdown: Boolean(
      window.app?.workspace?.activeLeaf?.view?.getViewType?.() === 'markdown'
      || document.querySelector('.workspace-leaf.mod-active')?.querySelector('.markdown-source-view, .markdown-preview-view')
    ),
    active_view_text: (() => {
      const leaf = document.querySelector('.workspace-leaf.mod-active');
      const content = leaf?.querySelector('.cm-content[contenteditable="true"], .markdown-preview-view');
      return content?.innerText ?? '';
    })()
  }))()`);
  let visible = await readVisible();
  const notesFolder = canvasNotePath.split("/")[0] ?? "Notes";
  if (!visible.paths.includes(canvasNotePath) && visible.paths.includes(notesFolder)) {
    await connection.evaluate(`(() => {
      const folder = [...document.querySelectorAll('[data-path]')]
        .find((element) => element.getAttribute('data-path') === ${JSON.stringify(notesFolder)});
      folder?.click();
    })()`);
    visible = await waitFor(
      `${label}: Obsidian to expand the Notes folder`,
      readVisible,
      (value) => value.paths.includes(canvasNotePath),
      10_000,
    );
  }
  const selected = await connection.evaluateJson<boolean>(`(() => {
    const target = [...document.querySelectorAll('[data-path]')]
      .find((element) => element.getAttribute('data-path') === ${JSON.stringify(canvasNotePath)});
    target?.click();
    return Boolean(target);
  })()`);
  if (!selected) throw new Error(`${label}: Obsidian did not expose ${canvasNotePath} for selection`);
  visible = await waitFor(
    `${label}: Obsidian to render the explicitly created note`,
    readVisible,
    (value) => value.paths.includes(canvasNotePath)
      && (value.active_file_path === canvasNotePath || value.active_tree_path === canvasNotePath)
      && value.active_view_is_markdown
      && value.active_view_text.includes(canvasMarker)
      && !value.body.includes("Do you trust the author of this vault?"),
    30_000,
  );
  if (!visible.paths.includes(canvasNotePath)
    || (visible.active_file_path !== canvasNotePath && visible.active_tree_path !== canvasNotePath)
    || !visible.active_view_is_markdown
    || !visible.active_view_text.includes(canvasMarker)) {
    throw new Error(label + ": Obsidian did not make the created Markdown file the active rendered note; active_file_path="
      + JSON.stringify(visible.active_file_path)
      + ", active_tree_path=" + JSON.stringify(visible.active_tree_path)
      + ", active_view_type=" + JSON.stringify(visible.active_view_type)
      + ", active_view_text=" + JSON.stringify(visible.active_view_text.slice(0, 2_000)));
  }
  await captureObsidianScreenshot(connection, screenshot);
  return visible;
}

function normalizeVisibleInputOcr(value: string): string {
  return value.toLowerCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s*([/\\._-])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function canvasInputOcrMatches(text: string, controlName: string, expectedValue: string): boolean {
  const expected = normalizeVisibleInputOcr(expectedValue);
  const expectsMarkdownExtension = controlName === "New Markdown path" && /\.md$/i.test(expectedValue);
  const expectedWithoutMarkdownDot = expectsMarkdownExtension
    ? normalizeVisibleInputOcr(expectedValue.replace(/\.md$/i, "md"))
    : "";
  const expectedWithObservedFinalGlyphMisread = expectsMarkdownExtension
    ? expectedWithoutMarkdownDot.replace(/md$/i, "mq")
    : "";
  return text.split(/\r?\n/).some((line) => {
    const observed = normalizeVisibleInputOcr(line.replace(/^[\[\](){}|]+/, ""));
    if (observed === expected) return true;
    if (!expectsMarkdownExtension) return false;
    // On macOS the enlarged field crop can drop the dot and read the final d as q.
    // Keep the expected directory/name intact and accept only these observed suffix
    // variants when clipboard readback verifies the exact value. Empty-clipboard
    // fallback requires a literal normalized OCR line instead.
    const observedWithoutSpaceBeforeMisreadSuffix = observed.replace(/\s+mq$/i, "mq");
    return observed === expectedWithoutMarkdownDot
      || observedWithoutSpaceBeforeMisreadSuffix === expectedWithObservedFinalGlyphMisread;
  });
}

function canvasInputOcrHasExactLine(text: string, expectedValue: string): boolean {
  const expected = expectedValue.replace(/\s+/g, " ").trim();
  return text.split(/\r?\n/).some((line) =>
    line.replace(/^[\[\](){}|]+/, "").replace(/\s+/g, " ").trim() === expected
  );
}

type CanvasInputFieldLayout = {
  imagePath: string;
  ocrImagePath: string;
  imageDimensions: {width: number; height: number};
  ocrDimensions: {width: number; height: number};
  labelBoundsOcr: OcrWordBounds;
  labelBoundsImage: OcrWordBounds;
  fieldTextBoundsOcr: OcrWordBounds | null;
  fieldCenter: {x: number; y: number};
  fieldPositionSource: "visible-field-text-ocr" | "label-offset-fallback" | "label-anchored-readback-crop";
  fieldTextOcrSource: "full-screenshot-ocr" | "focused-processed-crop-tesseract" | "focused-vision-crop" | "label-offset-fallback";
  fieldSearchCrop: {
    rawCropPath: string;
    ocrCropPath: string;
    cropBounds: {left: number; top: number; width: number; height: number};
    rawCropDimensions: {width: number; height: number};
    ocrCropDimensions: {width: number; height: number};
    rawToOcrScale: {x: number; y: number};
    attempts: Array<{
      engine: "tesseract";
      pageSegmentationMode: string;
      text: string;
      candidates: OcrWordBounds[];
      matchingCandidates: OcrWordBounds[];
    }>;
    vision: {
      imagePath: string;
      confidenceFloor: number;
      candidates: Array<{
        text: string;
        confidence: number;
        boundingBox: MacOSVisionTextCandidate["boundingBox"];
        validBounds: boolean;
        exactText: boolean;
        confidenceAccepted: boolean;
        mappedBoundsOcr: OcrWordBounds | null;
        geometryAccepted: boolean;
        accepted: boolean;
        rejection: string | null;
      }>;
      error: string;
    } | null;
  } | null;
  cropBounds: {left: number; top: number; width: number; height: number};
  coordinateSpace: "window" | "desktop";
};

function canvasInputLabelXOffset(controlName: string): number {
  if (controlName === "Canvas path") return 183;
  if (controlName === "Text card ID") return 146;
  if (controlName === "New Markdown path") return -415;
  if (controlName === "Canvas edit path") return 220;
  if (controlName === "Canvas edit text-card ID") return 240;
  if (controlName === "Canvas text draft") return 280;
  throw new Error(`No Canvas input layout is configured for ${controlName}`);
}

function canvasInputCropWidth(controlName: string): number {
  if (controlName === "Canvas path") return 220;
  if (controlName === "Text card ID") return 150;
  if (controlName === "New Markdown path") return 220;
  if (controlName === "Canvas edit path") return 250;
  if (controlName === "Canvas edit text-card ID") return 220;
  if (controlName === "Canvas text draft") return 520;
  throw new Error(`No Canvas input crop is configured for ${controlName}`);
}

const canvasInputHintValues: Readonly<Record<string, string>> = {
  "Canvas path": "Boards/Idea.canvas",
  "Text card ID": "text-card-id",
  "New Markdown path": "Notes/Created.md",
  "Canvas edit path": "Boards/Idea.canvas",
  "Canvas edit text-card ID": "text-card-id",
  "Canvas text draft": canvasMarker,
};

function canvasInputExpectedRegion(
  label: OcrWordBounds,
  controlName: string,
  scaleX: number,
  scaleY: number,
): {left: number; right: number; top: number; bottom: number} {
  const expectedCenterX = label.left / scaleX + canvasInputLabelXOffset(controlName);
  const labelCenterY = label.top + label.height / 2;
  const expectedCenterY = labelCenterY + (controlName === "New Markdown path" ? 22 * scaleY : 0);
  return {
    left: (expectedCenterX - canvasInputCropWidth(controlName) / 2) * scaleX,
    right: (expectedCenterX + canvasInputCropWidth(controlName) / 2) * scaleX,
    top: expectedCenterY - 16 * scaleY,
    bottom: expectedCenterY + 16 * scaleY,
  };
}

async function findCanvasInputTextInFocusedRawCrop(
  imagePath: string,
  label: OcrWordBounds,
  controlName: string,
  targetFieldText: string,
  scaleX: number,
  scaleY: number,
  imageDimensions: {width: number; height: number},
): Promise<{
  candidate: OcrWordBounds | null;
  source: "focused-processed-crop-tesseract" | "focused-vision-crop" | null;
  search: NonNullable<CanvasInputFieldLayout["fieldSearchCrop"]>;
}> {
  const expectedRegion = canvasInputExpectedRegion(label, controlName, scaleX, scaleY);
  const left = Math.max(0, Math.floor(expectedRegion.left / scaleX));
  const top = Math.max(0, Math.floor(expectedRegion.top / scaleY));
  const right = Math.min(imageDimensions.width, Math.ceil(expectedRegion.right / scaleX));
  const bottom = Math.min(imageDimensions.height, Math.ceil(expectedRegion.bottom / scaleY));
  const cropBounds = {left, top, width: right - left, height: bottom - top};
  if (cropBounds.width <= 0 || cropBounds.height <= 0) {
    throw new Error(`The focused ${controlName} OCR crop is outside the screenshot: crop=${JSON.stringify(cropBounds)}; image=${imageDimensions.width}x${imageDimensions.height}`);
  }

  const fileSafeName = controlName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const rawCropPath = join(reportDirectory, `openobsidian-canvas-field-search-${fileSafeName}-${Date.now()}-raw.png`);
  const ocrCropPath = join(reportDirectory, `openobsidian-canvas-field-search-${fileSafeName}-${Date.now()}-ocr.png`);
  const imageMagick = process.platform === "linux" ? "convert" : "magick";
  execFileSync(imageMagick, [imagePath, "-crop", `${cropBounds.width}x${cropBounds.height}+${left}+${top}`, "+repage", rawCropPath], {stdio: "ignore"});
  execFileSync(imageMagick, [rawCropPath, "-colorspace", "Gray", "-resize", "400%", "-contrast-stretch", "1%x3%", ocrCropPath], {stdio: "ignore"});

  const rawCropDimensions = await pngDimensions(rawCropPath);
  const ocrCropDimensions = await pngDimensions(ocrCropPath);
  const cropScaleX = ocrCropDimensions.width / rawCropDimensions.width;
  const cropScaleY = ocrCropDimensions.height / rawCropDimensions.height;
  if (!(cropScaleX > 0 && cropScaleY > 0 && Number.isFinite(cropScaleX) && Number.isFinite(cropScaleY))) {
    throw new Error(`Could not map the focused ${controlName} OCR crop to its original screenshot rectangle`);
  }

  const attempts: NonNullable<CanvasInputFieldLayout["fieldSearchCrop"]>["attempts"] = [];
  const search: NonNullable<CanvasInputFieldLayout["fieldSearchCrop"]> = {
    rawCropPath: relative(reportDirectory, rawCropPath),
    ocrCropPath: relative(reportDirectory, ocrCropPath),
    cropBounds,
    rawCropDimensions,
    ocrCropDimensions,
    rawToOcrScale: {x: cropScaleX, y: cropScaleY},
    attempts,
    vision: null,
  };
  for (const pageSegmentationMode of ["7", "6"]) {
    const tsv = runTesseractTsv(ocrCropPath, pageSegmentationMode);
    const candidates = findOcrJoinedPhraseBoundsCandidates(tsv, targetFieldText, 0, 1);
    const mappedCandidates = candidates.map((candidate): OcrWordBounds => ({
      text: candidate.text,
      left: (left + candidate.left / cropScaleX) * scaleX,
      top: (top + candidate.top / cropScaleY) * scaleY,
      width: candidate.width / cropScaleX * scaleX,
      height: candidate.height / cropScaleY * scaleY,
    }));
    const matchingCandidates = mappedCandidates.filter((candidate) =>
      canvasInputCandidateMatchesLabel(candidate, label, controlName, scaleX, scaleY)
    );
    const text = tsv.split(/\r?\n/).slice(1)
      .filter((line) => line.split("\t")[0] === "5")
      .map((line) => (line.split("\t")[11] ?? "").trim())
      .filter(Boolean)
      .join(" ");
    attempts.push({engine: "tesseract", pageSegmentationMode, text, candidates: mappedCandidates, matchingCandidates});
    if (matchingCandidates.length === 1) return {candidate: matchingCandidates[0]!, source: "focused-processed-crop-tesseract", search};
  }

  // Vision is a narrowly-scoped fallback for the observed macOS case where
  // both Tesseract passes produce no candidate at all. Do not let it resolve
  // a Tesseract ambiguity or an approximate candidate that failed geometry.
  const tesseractProducedCandidates = attempts.some((attempt) => attempt.candidates.length > 0);
  const visionConfidenceFloor = 0.8;
  if (process.platform === "darwin" && !tesseractProducedCandidates) {
    try {
      const visionCandidates = await readMacOSVisionTextCandidates(ocrCropPath);
      const expectedText = targetFieldText.replace(/\s+/g, " ").trim();
      const diagnosedCandidates = visionCandidates.map((visionCandidate) => {
        const {x, y, width, height} = visionCandidate.boundingBox;
        const validBounds = [x, y, width, height].every(Number.isFinite)
          && x >= 0 && y >= 0 && width > 0 && height > 0
          && x + width <= 1 + 1e-6 && y + height <= 1 + 1e-6;
        const mappedBoundsOcr: OcrWordBounds | null = validBounds
          ? {
            text: visionCandidate.text,
            left: (left + x * ocrCropDimensions.width / cropScaleX) * scaleX,
            top: (top + (1 - y - height) * ocrCropDimensions.height / cropScaleY) * scaleY,
            width: width * ocrCropDimensions.width / cropScaleX * scaleX,
            height: height * ocrCropDimensions.height / cropScaleY * scaleY,
          }
          : null;
        const exactText = visionCandidate.text.replace(/\s+/g, " ").trim() === expectedText;
        const confidenceAccepted = visionCandidate.confidence >= visionConfidenceFloor;
        const geometryAccepted = Boolean(mappedBoundsOcr
          && canvasInputCandidateMatchesLabel(mappedBoundsOcr, label, controlName, scaleX, scaleY));
        const accepted = validBounds && exactText && confidenceAccepted && geometryAccepted;
        const rejection = accepted ? null : [
          !validBounds ? "invalid-or-out-of-crop-bounds" : "",
          !exactText ? "text-not-an-exact-case-preserving-match" : "",
          !confidenceAccepted ? "confidence-below-floor" : "",
          !geometryAccepted ? "outside-configured-label-relative-field-region" : "",
        ].filter(Boolean).join(", ");
        return {
          text: visionCandidate.text,
          confidence: visionCandidate.confidence,
          boundingBox: visionCandidate.boundingBox,
          validBounds,
          exactText,
          confidenceAccepted,
          mappedBoundsOcr,
          geometryAccepted,
          accepted,
          rejection,
        };
      });
      search.vision = {
        imagePath: relative(reportDirectory, ocrCropPath),
        confidenceFloor: visionConfidenceFloor,
        candidates: diagnosedCandidates,
        error: "",
      };
      const accepted = diagnosedCandidates.filter((candidate) => candidate.accepted && candidate.mappedBoundsOcr);
      if (accepted.length === 1) {
        return {candidate: accepted[0]!.mappedBoundsOcr!, source: "focused-vision-crop", search};
      }
    } catch (error) {
      search.vision = {
        imagePath: relative(reportDirectory, ocrCropPath),
        confidenceFloor: visionConfidenceFloor,
        candidates: [],
        error: error instanceof Error ? error.message : "unknown macOS Vision OCR error",
      };
    }
  }
  return {candidate: null, source: null, search};
}

function canvasInputCandidateMatchesLabel(
  candidate: OcrWordBounds,
  label: OcrWordBounds,
  controlName: string,
  scaleX: number,
  scaleY: number,
): boolean {
  const labelCenterY = label.top + label.height / 2;
  const expectedRegion = canvasInputExpectedRegion(label, controlName, scaleX, scaleY);
  const candidateRight = candidate.left + candidate.width;
  const candidateCenterX = candidate.left + candidate.width / 2;
  const candidateCenterY = candidate.top + candidate.height / 2;
  const centerInConfiguredFieldRegion = candidateCenterX >= expectedRegion.left
    && candidateCenterX <= expectedRegion.right
    && candidateCenterY >= expectedRegion.top
    && candidateCenterY <= expectedRegion.bottom;
  if (!centerInConfiguredFieldRegion) return false;

  if (controlName === "New Markdown path") {
    const labelLeft = label.left;
    const labelCenter = labelCenterY;
    return candidateRight <= labelLeft + 4 * scaleX
      && candidate.top >= label.top + label.height - 4 * scaleY
      && candidateCenterY > labelCenter + label.height * 0.35;
  }

  const labelRight = label.left + label.width;
  const sameRowTolerance = Math.max(8 * scaleY, Math.max(label.height, candidate.height) * 0.75);
  return candidate.left >= labelRight - 4 * scaleX
    && Math.abs(candidateCenterY - labelCenterY) <= sameRowTolerance
    && candidateCenterX >= labelRight - 4 * scaleX;
}

async function locateCanvasTextInput(
  capture: Awaited<ReturnType<typeof captureOpenObsidianScreenshot>>,
  controlName: string,
  expectedInputValue?: string,
  allowLabelAnchoredReadbackCrop = false,
): Promise<CanvasInputFieldLayout> {
  const coordinateSpace = process.platform === "darwin" ? "desktop" : "window";
  const imagePath = coordinateSpace === "desktop" ? capture.pngPath : capture.windowPngPath;
  const ocrImagePath = coordinateSpace === "desktop"
    ? join(reportDirectory, `openobsidian-canvas-desktop-ocr-${Date.now()}.png`)
    : capture.ocrPngPath;
  if (coordinateSpace === "desktop") {
    execFileSync("magick", [imagePath, "-colorspace", "Gray", "-level", "0%,15%", "-resize", "200%", ocrImagePath], {stdio: "ignore"});
  }
  const imageDimensions = await pngDimensions(imagePath);
  const ocrDimensions = await pngDimensions(ocrImagePath);
  const scaleX = ocrDimensions.width / imageDimensions.width;
  const scaleY = ocrDimensions.height / imageDimensions.height;
  if (!(scaleX > 0 && scaleY > 0 && Number.isFinite(scaleX) && Number.isFinite(scaleY))) {
    throw new Error(`Could not map the ${controlName} label from OCR pixels to the screenshot`);
  }

  const tsvCandidates = [runTesseractTsv(ocrImagePath, "6"), runTesseractTsv(ocrImagePath, "11")];
  const labelPhrases = controlName.includes("text-card")
    ? [
      controlName,
      controlName.replace("text-card", "text card"),
      controlName.replace("text-card", "textcard"),
    ]
    : [controlName];
  const targetFieldText = controlName === "Canvas text draft"
    ? undefined
    : expectedInputValue ?? canvasInputHintValues[controlName];
  let labelBoundsOcr: OcrWordBounds | null = null;
  let fieldSearchLabelBoundsOcr: OcrWordBounds | null = null;
  let fieldTextBoundsOcr: OcrWordBounds | null = null;
  let fieldTextOcrSource: CanvasInputFieldLayout["fieldTextOcrSource"] = "label-offset-fallback";
  let fieldSearchCrop: CanvasInputFieldLayout["fieldSearchCrop"] = null;
  let fieldSearchFailure = "";
  let labelAnchoredReadbackCropUsed = false;
  for (const tsv of tsvCandidates) {
    // The instruction above the form repeats these labels. Bound the search below its
    // opening words so OCR cannot mistake the instruction for a field label.
    const instructionBounds = findOcrPhraseBounds(tsv, "Enter a", 0)
      ?? findOcrPhraseBounds(tsv, "Preview and confirm", 0)
      ?? findOcrPhraseBounds(tsv, "Load one", 0);
    if (!instructionBounds) continue;
    const candidateFormRowMinimumTop = instructionBounds.top + instructionBounds.height;
    let candidateLabelBounds: OcrWordBounds | null = null;
    for (const labelPhrase of labelPhrases) {
      candidateLabelBounds = findOcrPhraseBounds(tsv, labelPhrase, candidateFormRowMinimumTop, true);
      candidateLabelBounds ??= findOcrJoinedPhraseBounds(tsv, labelPhrase, candidateFormRowMinimumTop, 1);
      if (candidateLabelBounds) break;
    }
    if (!candidateLabelBounds) continue;
    const locatedCandidateLabelBounds = candidateLabelBounds;
    fieldSearchLabelBoundsOcr ??= locatedCandidateLabelBounds;

    const fieldTextCandidates = coordinateSpace === "desktop" && targetFieldText
      ? findOcrJoinedPhraseBoundsCandidates(tsv, targetFieldText, candidateFormRowMinimumTop, 1)
        .filter((candidate) => canvasInputCandidateMatchesLabel(candidate, locatedCandidateLabelBounds, controlName, scaleX, scaleY))
      : [];
    if (coordinateSpace === "desktop" && targetFieldText && fieldTextCandidates.length !== 1) {
      fieldSearchFailure = `Could not uniquely locate the ${controlName} field text in its label-relative OCR region: candidate_count=${fieldTextCandidates.length}; candidates=${JSON.stringify(fieldTextCandidates)}; label=${JSON.stringify(locatedCandidateLabelBounds)}; screenshot=${relative(reportDirectory, imagePath)}`;
      if (allowLabelAnchoredReadbackCrop && fieldTextCandidates.length === 0) {
        // A fresh readback may use the unique visible label and its configured
        // field rectangle to crop the value even when OCR cannot first decode
        // the value. Exact OCR and clipboard checks remain mandatory below.
        labelBoundsOcr = locatedCandidateLabelBounds;
        labelAnchoredReadbackCropUsed = true;
        break;
      }
      continue;
    }
    labelBoundsOcr = locatedCandidateLabelBounds;
    fieldTextBoundsOcr = fieldTextCandidates[0] ?? null;
    if (fieldTextBoundsOcr) fieldTextOcrSource = "full-screenshot-ocr";
    break;
  }
  if (coordinateSpace === "desktop" && targetFieldText && !fieldTextBoundsOcr && fieldSearchLabelBoundsOcr) {
    const focusedSearch = await findCanvasInputTextInFocusedRawCrop(
      imagePath,
      fieldSearchLabelBoundsOcr,
      controlName,
      targetFieldText,
      scaleX,
      scaleY,
      imageDimensions,
    );
    fieldSearchCrop = focusedSearch.search;
    if (focusedSearch.candidate) {
      labelBoundsOcr = fieldSearchLabelBoundsOcr;
      fieldTextBoundsOcr = focusedSearch.candidate;
      fieldTextOcrSource = focusedSearch.source ?? "focused-processed-crop-tesseract";
    } else {
      fieldSearchFailure = `Could not uniquely locate the ${controlName} field text in its label-relative OCR region: full_screenshot=${fieldSearchFailure || "no unique match"}; focused_crop=${JSON.stringify(fieldSearchCrop)}`;
    }
  }
  if (!labelBoundsOcr) {
    if (fieldSearchFailure) throw new Error(fieldSearchFailure);
    throw new Error(`Could not locate the visible ${controlName} label for screenshot-based input targeting: ${relative(reportDirectory, imagePath)}`);
  }
  // macOS AX often omits egui text fields even when they have a labelled_by
  // relationship. Use OCR bounds of the visible placeholder before entry and
  // of the exact field value during readback instead of estimating the field
  // position from a fixed offset. Constrain every match to the configured
  // field region relative to this label and reject missing or ambiguous hits.
  const labelBoundsImage = {
    text: labelBoundsOcr.text,
    left: Math.round(labelBoundsOcr.left / scaleX),
    top: Math.round(labelBoundsOcr.top / scaleY),
    width: Math.max(1, Math.round(labelBoundsOcr.width / scaleX)),
    height: Math.max(1, Math.round(labelBoundsOcr.height / scaleY)),
  };
  const rowOffset = controlName === "New Markdown path" ? 22 : controlName === "Canvas text draft" ? 66 : 0;
  const centerX = fieldTextBoundsOcr
    ? Math.round((fieldTextBoundsOcr.left + fieldTextBoundsOcr.width / 2) / scaleX)
    : Math.round(labelBoundsImage.left + canvasInputLabelXOffset(controlName));
  const centerY = fieldTextBoundsOcr
    ? Math.round((fieldTextBoundsOcr.top + fieldTextBoundsOcr.height / 2) / scaleY)
    : Math.round(labelBoundsImage.top + labelBoundsImage.height / 2 + rowOffset);
  const cropWidth = canvasInputCropWidth(controlName);
  const cropHeight = controlName === "Canvas text draft" ? 72 : 32;
  const cropBounds = {
    left: Math.max(0, Math.min(imageDimensions.width - 1, Math.round(centerX - cropWidth / 2))),
    top: Math.max(0, Math.min(imageDimensions.height - 1, Math.round(centerY - cropHeight / 2))),
    width: 0,
    height: 0,
  };
  cropBounds.width = Math.min(cropWidth, imageDimensions.width - cropBounds.left);
  cropBounds.height = Math.min(cropHeight, imageDimensions.height - cropBounds.top);
  if (centerX < 0 || centerX >= imageDimensions.width || centerY < 0 || centerY >= imageDimensions.height
    || cropBounds.width <= 0 || cropBounds.height <= 0) {
    throw new Error(`The measured ${controlName} field center is outside the screenshot: center=(${centerX},${centerY}), image=${imageDimensions.width}x${imageDimensions.height}`);
  }
  return {
    imagePath,
    ocrImagePath,
    imageDimensions,
    ocrDimensions,
    labelBoundsOcr,
    labelBoundsImage,
    fieldTextBoundsOcr,
    fieldCenter: {x: centerX, y: centerY},
    fieldPositionSource: fieldTextBoundsOcr
      ? "visible-field-text-ocr"
      : labelAnchoredReadbackCropUsed
        ? "label-anchored-readback-crop"
        : "label-offset-fallback",
    fieldTextOcrSource: fieldTextBoundsOcr ? fieldTextOcrSource : "label-offset-fallback",
    fieldSearchCrop,
    cropBounds,
    coordinateSpace,
  };
}

async function readCanvasInputScreenshotValue(
  capture: Awaited<ReturnType<typeof captureOpenObsidianScreenshot>>,
  controlName: string,
  expectedValue: string,
): Promise<{
  exact: boolean;
  exactLine: boolean;
  text: string;
  cropPath: string;
  layout: CanvasInputFieldLayout;
  visionText: string;
  visionCandidates: MacOSVisionTextCandidate[];
  visionAttempted: boolean;
  visionExact: boolean;
  visionError: string;
}> {
  const layout = await locateCanvasTextInput(capture, controlName, expectedValue, process.platform === "darwin");
  const cropPath = join(reportDirectory, `openobsidian-canvas-input-${controlName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}-ocr.png`);
  const {left, top, width, height} = layout.cropBounds;
  const imageMagick = process.platform === "linux" ? "convert" : "magick";
  execFileSync(imageMagick, [
    layout.imagePath,
    "-crop",
    `${width}x${height}+${left}+${top}`,
    "+repage",
    "-colorspace",
    "Gray",
    "-resize",
    "400%",
    "-contrast-stretch",
    "1%x3%",
    cropPath,
  ], {stdio: "ignore"});
  const text = runTesseractOcr(cropPath, ["7", "6"]);
  const tesseractExact = canvasInputOcrMatches(text, controlName, expectedValue);
  let visionCandidates: MacOSVisionTextCandidate[] = [];
  const visionAttempted = process.platform === "darwin" && !tesseractExact;
  let visionError = "";
  if (visionAttempted) {
    try {
      visionCandidates = await readMacOSVisionTextCandidates(cropPath);
    } catch (error) {
      visionError = error instanceof Error ? error.message : "unknown macOS Vision OCR error";
    }
  }
  const expectedLine = expectedValue.replace(/\s+/g, " ").trim();
  const exactVisionCandidates = visionCandidates.filter((candidate) =>
    candidate.text.replace(/\s+/g, " ").trim() === expectedLine
  );
  const visionExact = exactVisionCandidates.length === 1;
  // Keep the existing empty-clipboard fallback tied to Tesseract's literal
  // exact-line result; Vision supplies the second exact visual readback path,
  // but does not widen that clipboard fallback.
  const exactLine = canvasInputOcrHasExactLine(text, expectedValue);
  return {
    exact: tesseractExact || visionExact,
    exactLine,
    text,
    cropPath,
    layout,
    visionText: visionCandidates.map((candidate) => candidate.text).join("\n"),
    visionCandidates,
    visionAttempted,
    visionExact,
    visionError,
  };
}

async function clickMacOSDesktopFraction(xFraction: number, yFraction: number): Promise<string> {
  if (!(Number.isFinite(xFraction) && Number.isFinite(yFraction)
    && xFraction >= 0 && xFraction <= 1 && yFraction >= 0 && yFraction <= 1)) {
    throw new Error(`macOS desktop click fractions fall outside the captured desktop: (${xFraction},${yFraction})`);
  }
  const swiftPath = join(workDirectory, "openobsidian-desktop-click.swift");
  await writeFile(swiftPath, `import AppKit
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3,
      let xFraction = Double(CommandLine.arguments[1]),
      let yFraction = Double(CommandLine.arguments[2]) else {
    fatalError("Expected desktop click fractions")
}
guard NSScreen.screens.count == 1 else {
    fatalError("Desktop click mapping requires the single-display macOS CI screen")
}
guard let screenNumber = NSScreen.screens[0].deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
    fatalError("Could not read the macOS CI screen number")
}
let displayID = CGDirectDisplayID(screenNumber.uint32Value)
let displayBounds = CGDisplayBounds(displayID)
guard displayBounds.width > 0, displayBounds.height > 0 else {
    fatalError("Could not read the selected desktop display bounds")
}
let point = CGPoint(
    x: displayBounds.origin.x + CGFloat(xFraction) * displayBounds.width,
    y: displayBounds.origin.y + CGFloat(yFraction) * displayBounds.height
)
for type in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else {
        fatalError("Could not create desktop mouse event")
    }
    event.post(tap: .cghidEventTap)
    if type == .leftMouseDown { Thread.sleep(forTimeInterval: 0.08) }
}
print("\\(point.x),\\(point.y)")
`);
  const point = execFileSync("swift", [swiftPath, String(xFraction), String(yFraction)], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
  return `CoreGraphics dispatched mouse events to an OCR-positioned desktop target at fractions (${xFraction}, ${yFraction}), Quartz point (${point})`;
}

async function replaceLinuxOpenObsidianTextInputWithKeyboard(
  child: ChildProcess,
  windowId: string,
  controlName: string,
  value: string,
  logPath = join(reportDirectory, "openobsidian-canvas-note-create.log"),
): Promise<string> {
  const fileSafeName = controlName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const maximumAttempts = 3;
  let lastFailure = "no field-position attempt completed";
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    await waitForOpenObsidianRefreshIdle(0, 0, false, logPath);
    const refreshBeforeCapture = await readOpenObsidianRefreshDiagnostics(logPath);
    const before = await captureOpenObsidianScreenshot(windowId, child, `openobsidian-canvas-input-${fileSafeName}-before`);
    const layout = await locateCanvasTextInput(before, controlName);
    const labelOcrFound = Boolean(layout.labelBoundsOcr);
    const screenshotSize = await pngDimensions(before.windowPngPath);
    const geometry = execFileSync("xdotool", ["getwindowgeometry", "--shell", windowId], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
    const readGeometry = (key: string): number => Number(geometry.match(new RegExp(`^${key}=(\\d+)$`, "m"))?.[1] ?? NaN);
    const windowWidth = readGeometry("WIDTH");
    const windowHeight = readGeometry("HEIGHT");
    if (!(windowWidth > 0 && windowHeight > 0 && screenshotSize.width > 0 && screenshotSize.height > 0)) {
      throw new Error(`Could not map Linux Canvas input coordinates for ${controlName}: geometry=${geometry.trim()}; screenshot=${screenshotSize.width}x${screenshotSize.height}`);
    }
    if (!labelOcrFound) {
      throw new Error(`Linux screenshot did not show the ${controlName} label before text entry: screenshot=${relative(reportDirectory, before.windowPngPath)}`);
    }
    if (screenshotSize.width !== 800 || screenshotSize.height !== 600 || windowWidth !== 800 || windowHeight !== 600) {
      throw new Error(`Linux Canvas field coordinates require the captured 800x600 CI layout: window=${windowWidth}x${windowHeight}; screenshot=${screenshotSize.width}x${screenshotSize.height}`);
    }

    // Positioning takes OCR time. If the watcher refreshes during that interval,
    // its status line can move the form after the screenshot; discard those bounds.
    const refreshBeforeClick = await readOpenObsidianRefreshDiagnostics(logPath);
    if (openObsidianRefreshActivityChanged(refreshBeforeCapture, refreshBeforeClick)
      || (refreshBeforeClick.receiverStates.at(-1)?.busy ?? false)) {
      lastFailure = `vault refresh changed the form layout before attempt ${attempt}`;
      continue;
    }

    // X follows the label-to-field layout; Y follows the label itself so optional status
    // messages above the form cannot move the click onto the adjacent input row.
    const clickX = Math.round(layout.fieldCenter.x * windowWidth / screenshotSize.width);
    const clickY = Math.round(layout.fieldCenter.y * windowHeight / screenshotSize.height);
    try {
      xdotool("windowfocus", "--sync", windowId);
      xdotool("mousemove", "--sync", "--window", windowId, String(clickX), String(clickY));
      xdotool("click", "--clearmodifiers", "1");
      xdotool("key", "--clearmodifiers", "ctrl+a");
      execFileSync("xdotool", ["type", "--clearmodifiers", "--delay", "1", value], {stdio: "ignore"});
    } catch (error) {
      const failure = error as NodeJS.ErrnoException;
      throw new Error(`Linux keyboard entry failed for ${controlName}: code=${failure.code ?? "unknown"}; syscall=${failure.syscall ?? "unknown"}; click=(${clickX},${clickY})`);
    }

    let clipboardReadback = "";
    let clipboardReadbackError = "";
    let verificationAttempts = 0;
    for (verificationAttempts = 1; verificationAttempts <= 5; verificationAttempts += 1) {
      xdotool("key", "--clearmodifiers", "ctrl+a");
      xdotool("key", "--clearmodifiers", "ctrl+c");
      await delay(100);
      try {
        clipboardReadback = execFileSync("xclip", ["-selection", "clipboard", "-o"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 2_000,
        });
        clipboardReadbackError = "";
      } catch (error) {
        const failure = error as NodeJS.ErrnoException;
        clipboardReadbackError = `code=${failure.code ?? "unknown"}; syscall=${failure.syscall ?? "unknown"}`;
      }
      if (clipboardReadback === value) break;
      await delay(150);
    }
    xdotool("key", "--clearmodifiers", "Right");
    const verification = await captureOpenObsidianScreenshot(
      windowId,
      child,
      `openobsidian-canvas-input-${fileSafeName}-readback`,
    );
    let visualReadback: Awaited<ReturnType<typeof readCanvasInputScreenshotValue>> | undefined;
    let visualReadbackError = "";
    try {
      visualReadback = await readCanvasInputScreenshotValue(verification, controlName, value);
    } catch (error) {
      visualReadbackError = error instanceof Error ? error.message : "unknown screenshot OCR error";
    }
    const refreshAfterVerification = await readOpenObsidianRefreshDiagnostics(logPath);
    const refreshChangedDuringInput = openObsidianRefreshActivityChanged(refreshBeforeClick, refreshAfterVerification)
      || (refreshAfterVerification.receiverStates.at(-1)?.busy ?? false);
    if (clipboardReadback === value && !refreshChangedDuringInput) {
      return JSON.stringify({
        name: controlName,
        action: "focused the OCR-positioned field, then Ctrl+A and keyboard entry",
        exact_readback: true,
        clipboard_exact: true,
        readback_source: "X11 clipboard after selecting and copying the focused field; screenshot and optional field crop retained as visual evidence",
        readback_ocr: visualReadback?.text ?? "",
        visual_ocr_exact: visualReadback?.exact ?? false,
        visual_ocr_is_diagnostic: true,
        visual_readback_error: visualReadbackError || null,
        expected_length: value.length,
        readback_length: clipboardReadback.length,
        click_x: clickX,
        click_y: clickY,
        position_source: "fresh visible label bounds after a stable vault-refresh window",
        ocr_label_found: labelOcrFound,
        readback_attempts: verificationAttempts,
        position_attempts: attempt,
        before_screenshot: relative(reportDirectory, before.windowPngPath),
        readback_screenshot: relative(reportDirectory, verification.windowPngPath),
        readback_crop: visualReadback ? relative(reportDirectory, visualReadback.cropPath) : null,
        readback_crop_bounds: visualReadback?.layout.cropBounds ?? null,
      });
    }
    lastFailure = `clipboard_length=${clipboardReadback.length}; clipboard_exact=${clipboardReadback === value}; clipboard_error=${clipboardReadbackError || "none"}; crop_ocr=${JSON.stringify(visualReadback?.text ?? "")}; visual_readback_error=${visualReadbackError || "none"}; visual_exact=${visualReadback?.exact ?? false}; refresh_changed=${refreshChangedDuringInput}; click=(${clickX},${clickY}); verification_attempts=${Math.min(verificationAttempts, 5)}; before=${relative(reportDirectory, before.windowPngPath)}; screenshot=${relative(reportDirectory, verification.windowPngPath)}; crop=${visualReadback ? relative(reportDirectory, visualReadback.cropPath) : "unavailable"}`;
  }

  throw new Error(`Linux clipboard readback and field screenshot did not confirm the exact ${controlName} value after ${maximumAttempts} fresh-position attempts: expected_length=${value.length}; ${lastFailure}`);
}

async function replaceMacOSOpenObsidianTextInputWithKeyboard(
  child: ChildProcess,
  windowId: string,
  controlName: string,
  value: string,
  logPath = join(reportDirectory, "openobsidian-canvas-note-create.log"),
): Promise<string> {
  const fileSafeName = controlName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const maximumPositionAttempts = controlName === "Canvas text draft" ? 1 : 3;
  const requiresBlankFieldProbe = controlName !== "Canvas text draft";
  let before: Awaited<ReturnType<typeof captureOpenObsidianScreenshot>> | undefined;
  let layout: CanvasInputFieldLayout | undefined;
  let click = "";
  let lastPositionFailure = "no field-position attempt completed";
  let initialFieldValueLength: number | null = null;
  if (requiresBlankFieldProbe) {
    const probeScript = `on run argv
      set processId to (item 1 of argv) as integer
      tell application "System Events"
        set targetProcess to first process whose unix id is processId
        set frontmost of targetProcess to true
        keystroke "a" using {command down}
        delay 0.1
        keystroke "c" using {command down}
        delay 0.1
      end tell
    end run`;
    for (let attempt = 1; attempt <= maximumPositionAttempts; attempt += 1) {
      await waitForOpenObsidianRefreshIdle(0, 0, false, logPath);
      const refreshBeforeCapture = await readOpenObsidianRefreshDiagnostics(logPath);
      const attemptBefore = await captureOpenObsidianScreenshot(windowId, child, `openobsidian-canvas-input-${fileSafeName}-before`);
      const attemptLayout = await locateCanvasTextInput(attemptBefore, controlName);
      const refreshBeforeClick = await readOpenObsidianRefreshDiagnostics(logPath);
      if (openObsidianRefreshActivityChanged(refreshBeforeCapture, refreshBeforeClick)
        || (refreshBeforeClick.receiverStates.at(-1)?.busy ?? false)) {
        lastPositionFailure = `vault refresh changed the form layout before positioning attempt ${attempt}`;
        continue;
      }
      const attemptClick = await clickMacOSDesktopFraction(
        attemptLayout.fieldCenter.x / attemptLayout.imageDimensions.width,
        attemptLayout.fieldCenter.y / attemptLayout.imageDimensions.height,
      );
      await delay(120);
      execFileSync("pbcopy", [], {input: "", stdio: ["pipe", "ignore", "ignore"]});
      execFileSync("osascript", ["-e", probeScript, String(child.pid ?? -1)], {stdio: "ignore"});
      const initialFieldValue = execFileSync("pbpaste", [], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2_000,
      });
      initialFieldValueLength = initialFieldValue.length;
      if (initialFieldValue !== "") {
        lastPositionFailure = `clicked field was not blank (initial_readback_length=${initialFieldValue.length}); position_source=${attemptLayout.fieldPositionSource}; click=${attemptClick}; screenshot=${relative(reportDirectory, attemptBefore.pngPath)}`;
        continue;
      }
      before = attemptBefore;
      layout = attemptLayout;
      click = attemptClick;
      break;
    }
    if (!before || !layout) {
      throw new Error(`macOS could not establish a blank ${controlName} field before typing after ${maximumPositionAttempts} fresh-position attempts: ${lastPositionFailure}`);
    }
  } else {
    await waitForOpenObsidianRefreshIdle(0, 0, false, logPath);
    before = await captureOpenObsidianScreenshot(windowId, child, `openobsidian-canvas-input-${fileSafeName}-before`);
    layout = await locateCanvasTextInput(before, controlName);
    click = await clickMacOSDesktopFraction(
      layout.fieldCenter.x / layout.imageDimensions.width,
      layout.fieldCenter.y / layout.imageDimensions.height,
    );
    await delay(120);
  }
  if (!before || !layout) throw new Error(`Could not position the macOS ${controlName} input`);
  const pasteScript = `on run argv
    set processId to (item 1 of argv) as integer
    tell application "System Events"
      set targetProcess to first process whose unix id is processId
      set frontmost of targetProcess to true
      keystroke "a" using {command down}
      delay 0.1
      keystroke "v" using {command down}
      delay 0.1
      key code 124
    end tell
  end run`;
  const copyFieldScript = `on run argv
    set processId to (item 1 of argv) as integer
    tell application "System Events"
      set targetProcess to first process whose unix id is processId
      set frontmost of targetProcess to true
      keystroke "a" using {command down}
      delay 0.1
      keystroke "c" using {command down}
      -- Cmd+C leaves the selection highlighted; collapse it for screenshot OCR.
      delay 0.1
      key code 124
      delay 0.1
    end tell
  end run`;
  execFileSync("pbcopy", [], {input: value, stdio: ["pipe", "ignore", "ignore"]});
  execFileSync("osascript", ["-e", pasteScript, String(child.pid ?? -1)], {stdio: "ignore"});
  await delay(150);
  // Clear the value used for paste before copying the field back, so the
  // following pbpaste result can only come from the focused field selection.
  execFileSync("pbcopy", [], {input: "", stdio: ["pipe", "ignore", "ignore"]});
  execFileSync("osascript", ["-e", copyFieldScript, String(child.pid ?? -1)], {stdio: "ignore"});
  await waitForOpenObsidianRefreshIdle(0, 0, false, logPath);
  let clipboardReadback = "";
  let clipboardReadbackError = "";
  try {
    clipboardReadback = execFileSync("pbpaste", [], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    });
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    clipboardReadbackError = `code=${failure.code ?? "unknown"}; syscall=${failure.syscall ?? "unknown"}`;
  }
  const verification = await captureOpenObsidianScreenshot(
    windowId,
    child,
    `openobsidian-canvas-input-${fileSafeName}-readback`,
  );
  let visualReadback: Awaited<ReturnType<typeof readCanvasInputScreenshotValue>> | undefined;
  let visualReadbackError = "";
  try {
    visualReadback = await readCanvasInputScreenshotValue(verification, controlName, value);
  } catch (error) {
    visualReadbackError = error instanceof Error ? error.message : "unknown screenshot OCR error";
  }
  // Confirm the visible value in the label-relative field crop even when the
  // clipboard returns the expected value. This ties readback to the requested
  // control instead of proving only that some focused field was copied.
  const exactVisualFieldReadback = controlName !== "Canvas text draft"
    && (visualReadback?.layout.fieldPositionSource === "visible-field-text-ocr"
      || visualReadback?.layout.fieldPositionSource === "label-anchored-readback-crop")
    && visualReadback?.exact === true;
  if (controlName !== "Canvas text draft" && !exactVisualFieldReadback) {
    throw new Error(`macOS ${controlName} field crop did not visually confirm the exact value in its label-relative OCR region: expected=${JSON.stringify(value)}; crop_ocr=${JSON.stringify(visualReadback?.text ?? "")}; vision_ocr=${JSON.stringify(visualReadback?.visionText ?? "")}; vision_error=${visualReadback?.visionError || "none"}; field_position_source=${visualReadback?.layout.fieldPositionSource ?? "unavailable"}; clipboard_exact=${clipboardReadback === value}; clipboard_length=${clipboardReadback.length}; clipboard_error=${clipboardReadbackError || "none"}; visual_readback_error=${visualReadbackError || "none"}; click=${click}; crop=${visualReadback ? relative(reportDirectory, visualReadback.cropPath) : "unavailable"}; screenshot=${relative(reportDirectory, verification.pngPath)}`);
  }
  // egui can display the exact value even when macOS does not return its
  // selection through pbpaste. Accept that fallback only when the fresh
  // label-relative crop contains one literal, case-preserving line.
  const exactVisualFieldFallback = controlName !== "Canvas text draft"
    && clipboardReadback === ""
    && clipboardReadbackError === ""
    && visualReadback?.exactLine === true;
  if (clipboardReadback !== value && !exactVisualFieldFallback) {
    throw new Error(`macOS clipboard readback did not confirm the exact ${controlName} value: expected_length=${value.length}; actual_length=${clipboardReadback.length}; clipboard_error=${clipboardReadbackError || "none"}; crop_ocr=${JSON.stringify(visualReadback?.text ?? "")}; vision_ocr=${JSON.stringify(visualReadback?.visionText ?? "")}; vision_error=${visualReadback?.visionError || "none"}; visual_readback_error=${visualReadbackError || "none"}; click=${click}; crop=${visualReadback ? relative(reportDirectory, visualReadback.cropPath) : "unavailable"}; screenshot=${relative(reportDirectory, verification.pngPath)}`);
  }
  return JSON.stringify({
    name: controlName,
    action: "focused the OCR-positioned field, Cmd+A and clipboard paste, copied the selected field, then sent Right Arrow to collapse the selection before screenshot readback; macOS Vision reads the label-anchored crop if Tesseract cannot locate the exact value",
    exact_readback: true,
    clipboard_exact: clipboardReadback === value,
    readback_selection_collapse_key_sent: true,
    readback_source: clipboardReadback === value
      ? "macOS clipboard after selecting and copying the focused field"
      : "exact literal Tesseract OCR line from a fresh label-relative field crop after clipboard readback was empty",
    readback_ocr: visualReadback?.text ?? "",
    visual_ocr_exact: visualReadback?.exact ?? false,
    visual_ocr_exact_line: visualReadback?.exactLine ?? false,
    visual_ocr_engine: visualReadback?.visionAttempted ? "Tesseract + macOS Vision" : "Tesseract",
    vision_ocr_text: visualReadback?.visionText ?? "",
    vision_ocr_candidates: visualReadback?.visionCandidates ?? [],
    vision_ocr_error: visualReadback?.visionError || null,
    clipboard_readback_error: clipboardReadbackError || null,
    expected_length: value.length,
    readback_length: clipboardReadback.length,
    initial_field_value_length: initialFieldValueLength,
    position_source: layout.fieldPositionSource,
    field_text_ocr_source: layout.fieldTextOcrSource,
    field_search_crop: layout.fieldSearchCrop,
    label_bounds_ocr: layout.labelBoundsOcr,
    field_text_bounds_ocr: layout.fieldTextBoundsOcr,
    field_center_image: layout.fieldCenter,
    screenshot_dimensions: layout.imageDimensions,
    ocr_dimensions: layout.ocrDimensions,
    click,
    before_screenshot: relative(reportDirectory, before.pngPath),
    readback_screenshot: relative(reportDirectory, verification.pngPath),
    readback_crop: visualReadback ? relative(reportDirectory, visualReadback.cropPath) : null,
    readback_crop_bounds: visualReadback?.layout.cropBounds ?? null,
    readback_field_text_ocr_source: visualReadback?.layout.fieldTextOcrSource ?? null,
    readback_field_search_crop: visualReadback?.layout.fieldSearchCrop ?? null,
    readback_label_bounds_ocr: visualReadback?.layout.labelBoundsOcr ?? null,
    readback_field_text_bounds_ocr: visualReadback?.layout.fieldTextBoundsOcr ?? null,
    readback_screenshot_dimensions: visualReadback?.layout.imageDimensions ?? null,
  });
}

async function replaceOpenObsidianTextInput(
  child: ChildProcess,
  windowId: string,
  controlName: string,
  value: string,
  logPath = join(reportDirectory, "openobsidian-canvas-note-create.log"),
): Promise<string> {
  await waitForOpenObsidianRefreshIdle(0, 0, false, logPath);
  const processId = child.pid;
  if (!processId) throw new Error("OpenObsidian did not expose its process id for Canvas text entry");
  if (process.platform === "linux") {
    const script = `
import json
import sys
import time
import pyatspi

process_id = int(sys.argv[1])
target_name = sys.argv[2]
hint_value = sys.argv[3]
replacement = sys.argv[4]
deadline = time.monotonic() + 20
last_matches = []
while time.monotonic() < deadline:
    pending = [pyatspi.Registry.getDesktop(0)]
    seen = set()
    while pending:
        accessible = pending.pop()
        try:
            name = accessible.getName() or ""
            role = accessible.getRoleName() or ""
            try:
                owner_pid = accessible.get_process_id()
            except Exception:
                owner_pid = None
            if owner_pid == process_id:
                try:
                    editable = accessible.queryEditableText()
                    text = accessible.queryText()
                    current = text.getText(0, text.getCharacterCount())
                    if name != target_name and current != hint_value:
                        raise RuntimeError("editable field did not match its label or visible hint")
                    last_matches.append({"name": name, "role": role, "value_length": len(current)})
                    editable.setTextContents(replacement)
                    time.sleep(0.15)
                    text = accessible.queryText()
                    current = text.getText(0, text.getCharacterCount())
                    if current != replacement:
                        raise RuntimeError("editable text value did not match after replacement")
                    print(json.dumps({"name": name, "role": role, "action": "EditableText.setTextContents", "exact_readback": True, "expected_length": len(replacement), "readback_length": len(current)}))
                    sys.exit(0)
                except Exception:
                    pass
            child_count = accessible.getChildCount()
            for index in range(child_count):
                child_accessible = accessible.getChildAtIndex(index)
                try:
                    identity = child_accessible.get_hash()
                except Exception:
                    identity = id(child_accessible)
                if identity not in seen:
                    seen.add(identity)
                    pending.append(child_accessible)
        except Exception:
            continue
    time.sleep(0.25)
print(json.dumps({"error": "editable accessible field was not found", "target": target_name, "process_id": process_id, "matching_roles": last_matches[-20:]}), file=sys.stderr)
sys.exit(1)
`;
    try {
      const hintValue = canvasInputHintValues[controlName];
      if (hintValue === undefined) throw new Error(`No visible Linux Canvas hint is configured for ${controlName}`);
      const output = execFileSync("python3", ["-c", script, String(processId), controlName, hintValue, value], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      await delay(250);
      return output;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {stderr?: Buffer | string; stdout?: Buffer | string};
      const output = [failure.stdout, failure.stderr].filter(Boolean).map(String).join("\n").trim();
      try {
        return await replaceLinuxOpenObsidianTextInputWithKeyboard(child, windowId, controlName, value, logPath);
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "unknown keyboard fallback error";
        throw new Error(`Could not set the accessible OpenObsidian ${controlName} field: ${output || failure.message}; screenshot-verified keyboard fallback failed: ${fallbackMessage}`);
      }
    }
  } else if (process.platform === "darwin") {
    const hintValue = canvasInputHintValues[controlName];
    if (hintValue === undefined) throw new Error(`No visible macOS Canvas hint is configured for ${controlName}`);
    const script = `on run argv
      set processId to (item 1 of argv) as integer
      set targetName to item 2 of argv
      set hintValue to item 3 of argv
      set replacement to item 4 of argv
      tell application "System Events"
        set targetProcess to first process whose unix id is processId
        set frontmost of targetProcess to true
        set matchingFields to {}
        set fieldInventory to ""
        repeat with candidate in entire contents of window 1 of targetProcess
          try
            set candidateRole to role of candidate as text
            if candidateRole is "AXTextField" or candidateRole is "AXTextArea" then
              set candidateName to ""
              set candidateValue to value of candidate as text
              try
                set candidateName to name of candidate as text
              end try
              set fieldInventory to fieldInventory & "[role=" & candidateRole & ",name=" & candidateName & ",value=" & candidateValue & "]"
              if candidateName is targetName or candidateValue is hintValue then set end of matchingFields to candidate
            end if
          end try
        end repeat
        if (count of matchingFields) is not 1 then error "Could not uniquely resolve the labeled " & targetName & " field by its label or visible hint; matching_fields=" & (count of matchingFields) & "; fields=" & fieldInventory
        set targetField to item 1 of matchingFields
        set targetRole to role of targetField as text
        set value of targetField to replacement
        delay 0.15
        if (value of targetField as text) is not replacement then error "Accessible value did not match after replacement for " & targetName
        return targetRole & ".setValue|" & targetName & "|exact_readback=true"
      end tell
    end run`;
    try {
      const output = execFileSync("osascript", ["-e", script, String(processId), controlName, hintValue, value], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
      await delay(250);
      return JSON.stringify({
        name: controlName,
        action: output,
        exact_readback: true,
        readback_source: "macOS accessibility value",
        expected_length: value.length,
        readback_length: value.length,
        label_or_hint_match: hintValue,
      });
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {stderr?: Buffer | string; stdout?: Buffer | string};
      const output = [failure.stdout, failure.stderr].filter(Boolean).map(String).join("\n").trim();
      try {
        const fallback = await replaceMacOSOpenObsidianTextInputWithKeyboard(child, windowId, controlName, value, logPath);
        return JSON.stringify({
          name: controlName,
          accessibility_lookup_failure: output || failure.message,
          fallback: JSON.parse(fallback),
        });
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "unknown keyboard fallback error";
        throw new Error(`Could not set the macOS OpenObsidian ${controlName} field by AX value or OCR-positioned keyboard fallback: ${output || failure.message}; fallback failed: ${fallbackMessage}`);
      }
    }
  } else if (process.platform === "win32") {
    const script = `
      $ErrorActionPreference = "Stop"
      Add-Type -AssemblyName UIAutomationClient
      Add-Type -AssemblyName UIAutomationTypes
      Add-Type -AssemblyName System.Windows.Forms
      $processId = [int]$env:OPENOBSIDIAN_WINDOW_PROCESS_ID
      $targetName = $env:OPENOBSIDIAN_ACCESSIBLE_CONTROL_NAME
      $hintValue = $env:OPENOBSIDIAN_CANVAS_INPUT_HINT
      $replacement = $env:OPENOBSIDIAN_CANVAS_TEXT_ENTRY
      $root = [System.Windows.Automation.AutomationElement]::RootElement
      $processCondition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
        $processId
      )
      $deadline = [DateTime]::UtcNow.AddSeconds(20)
      do {
        $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $processCondition)
        foreach ($element in $elements) {
          try {
            $current = $element.Current
            if ($current.ControlType -ne [System.Windows.Automation.ControlType]::Edit) { continue }
            $pattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($current.Name -ne $targetName -and [string]$pattern.Current.Value -cne $hintValue) { continue }
            if ($pattern.Current.IsReadOnly) { throw "The accessible edit field is read-only: $targetName" }
            $pattern.SetValue($replacement)
            Start-Sleep -Milliseconds 150
            $actual = [string]$pattern.Current.Value
            $initialReadbackLength = $actual.Length
            $clipboardFallback = -not [string]::Equals($actual, $replacement, [System.StringComparison]::Ordinal)
            $readbackPolls = 1
            $clipboardSet = $false
            $clipboardVerified = $false
            $focusSet = $false
            $hasKeyboardFocus = $false
            $selectAllSent = $false
            $pasteSent = $false
            if ($clipboardFallback) {
              $clipboardFailureType = "none"
              $clipboardFailureMessage = "none"
              $clipboardApartmentState = [System.Threading.Thread]::CurrentThread.ApartmentState.ToString()
              $clipboardReadbackLength = -1
              $clipboardFirstDifferenceIndex = -1
              try {
                [System.Windows.Forms.Clipboard]::SetText($replacement, [System.Windows.Forms.TextDataFormat]::UnicodeText)
                $clipboardSet = $true
                $clipboardReadback = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::UnicodeText)
                $clipboardReadbackLength = $clipboardReadback.Length
                $clipboardVerified = [string]::Equals([string]$clipboardReadback, $replacement, [System.StringComparison]::Ordinal)
                if (-not $clipboardVerified) {
                  $clipboardFirstDifferenceIndex = 0
                  $clipboardCommonLength = [Math]::Min($clipboardReadbackLength, $replacement.Length)
                  while ($clipboardFirstDifferenceIndex -lt $clipboardCommonLength -and [string]::Equals([string]$clipboardReadback[$clipboardFirstDifferenceIndex], [string]$replacement[$clipboardFirstDifferenceIndex], [System.StringComparison]::Ordinal)) {
                    $clipboardFirstDifferenceIndex++
                  }
                  if ($clipboardFirstDifferenceIndex -eq $clipboardCommonLength -and $clipboardReadbackLength -eq $replacement.Length) { $clipboardFirstDifferenceIndex = -1 }
                  throw "Unicode clipboard readback did not exactly match the replacement"
                }
                $element.SetFocus()
                $focusSet = $true
                Start-Sleep -Milliseconds 120
                try { $hasKeyboardFocus = [bool]$element.Current.HasKeyboardFocus } catch { $hasKeyboardFocus = $false }
                [System.Windows.Forms.SendKeys]::SendWait("^a")
                $selectAllSent = $true
                Start-Sleep -Milliseconds 120
                [System.Windows.Forms.SendKeys]::SendWait("^v")
                $pasteSent = $true
              } catch {
                $clipboardFailureType = $_.Exception.GetType().Name
                $clipboardFailureMessage = $_.Exception.Message
                throw "OpenObsidian clipboard fallback failed for '$targetName' (expected_length=$($replacement.Length); initial_readback_length=$initialReadbackLength; clipboard_apartment_state=$clipboardApartmentState; clipboard_set=$clipboardSet; clipboard_verified=$clipboardVerified; clipboard_readback_length=$clipboardReadbackLength; clipboard_first_difference_index=$clipboardFirstDifferenceIndex; focus_set=$focusSet; has_keyboard_focus=$hasKeyboardFocus; select_all_sent=$selectAllSent; paste_sent=$pasteSent; error_type=$clipboardFailureType; error_message=$clipboardFailureMessage)"
              }
              $pasteDeadline = [DateTime]::UtcNow.AddSeconds(10)
              do {
                Start-Sleep -Milliseconds 50
                $readbackPolls++
                try { $actual = [string]$pattern.Current.Value } catch { $actual = "" }
                if ([string]::Equals($actual, $replacement, [System.StringComparison]::Ordinal)) { break }
              } while ([DateTime]::UtcNow -lt $pasteDeadline)
              $firstDifferenceIndex = 0
              $commonLength = [Math]::Min($actual.Length, $replacement.Length)
              while ($firstDifferenceIndex -lt $commonLength -and $actual[$firstDifferenceIndex] -ceq $replacement[$firstDifferenceIndex]) {
                $firstDifferenceIndex++
              }
              if ($firstDifferenceIndex -eq $commonLength -and $actual.Length -eq $replacement.Length) { $firstDifferenceIndex = -1 }
              if (-not [string]::Equals($actual, $replacement, [System.StringComparison]::Ordinal)) {
                throw "OpenObsidian exact readback failed for '$targetName' after clipboard paste (expected_length=$($replacement.Length); actual_length=$($actual.Length); first_difference_index=$firstDifferenceIndex; clipboard_apartment_state=$clipboardApartmentState; clipboard_set=$clipboardSet; clipboard_verified=$clipboardVerified; clipboard_readback_length=$clipboardReadbackLength; clipboard_first_difference_index=$clipboardFirstDifferenceIndex; focus_set=$focusSet; has_keyboard_focus=$hasKeyboardFocus; select_all_sent=$selectAllSent; paste_sent=$pasteSent; clipboard_fallback=true; polls=$readbackPolls)"
              }
            }
            [pscustomobject]@{
              name = $targetName
              action = if ($clipboardFallback) { "ValuePattern.SetValue + focused Ctrl+A and Unicode clipboard paste" } else { "ValuePattern.SetValue" }
              exact_readback = $true
              clipboard_fallback = $clipboardFallback
              clipboard_apartment_state = if ($clipboardFallback) { $clipboardApartmentState } else { "not_used" }
              clipboard_set = $clipboardSet
              clipboard_verified = $clipboardVerified
              focus_set = $focusSet
              has_keyboard_focus = $hasKeyboardFocus
              select_all_sent = $selectAllSent
              paste_sent = $pasteSent
              expected_length = $replacement.Length
              readback_length = $actual.Length
              readback_polls = $readbackPolls
            } | ConvertTo-Json -Compress
            exit 0
          } catch {
            if ($_.Exception.Message -like "The accessible edit field is read-only:*" -or $_.Exception.Message -like "OpenObsidian clipboard fallback failed*" -or $_.Exception.Message -like "OpenObsidian exact readback failed*" ) { throw }
          }
        }
        Start-Sleep -Milliseconds 250
      } while ([DateTime]::UtcNow -lt $deadline)
      throw "Accessible editable field was not found: $targetName"
    `;
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-STA", "-Command", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENOBSIDIAN_WINDOW_PROCESS_ID: String(processId),
        OPENOBSIDIAN_ACCESSIBLE_CONTROL_NAME: controlName,
        OPENOBSIDIAN_CANVAS_INPUT_HINT: canvasInputHintValues[controlName] ?? "",
        OPENOBSIDIAN_CANVAS_TEXT_ENTRY: value,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    await delay(250);
    return output;
  } else {
    throw new Error(`Canvas text entry is not configured for ${process.platform}`);
  }
}

type CanvasReferenceDocument = {
  nodes: Array<Record<string, unknown>>;
  edges: unknown[];
  [key: string]: unknown;
};

function canvasReferenceDocumentsWithEditedText(text: string): {
  seed: CanvasReferenceDocument;
  edited: CanvasReferenceDocument;
} {
  const seed = JSON.parse(readCanvasReferenceFixtureBytes().toString("utf8")) as CanvasReferenceDocument;
  const edited = JSON.parse(readCanvasReferenceFixtureBytes().toString("utf8")) as CanvasReferenceDocument;
  const selectedNode = edited.nodes.find((node) => node.id === "text-1" && node.type === "text");
  if (!selectedNode || selectedNode.text !== canvasMarker) {
    throw new Error("The Canvas editor fixture does not contain the expected text-1 source card");
  }
  selectedNode.text = text;
  return {seed, edited};
}

function canvasDocumentMatchesExpectedTextEdit(actual: unknown, expected: CanvasReferenceDocument): boolean {
  return isDeepStrictEqual(actual, expected);
}

async function runOpenObsidianCanvasTextEdit(
  seedSnapshot: SnapshotEntry[],
  expectedSeedCanvas: {bytes: number; sha256: string},
  seedDocument: CanvasReferenceDocument,
  expectedEditedDocument: CanvasReferenceDocument,
): Promise<{snapshot: SnapshotEntry[]; canvas: {bytes: number; sha256: string}}> {
  const canvasReport = report.canvas_reference_reopen as Record<string, unknown>;
  const editReport = canvasReport.text_edit as Record<string, unknown>;
  const snapshots = report.vault_snapshots as Record<string, unknown>;
  const logPath = join(reportDirectory, "openobsidian-canvas-text-edit.log");
  const userConfigRoot = join(workDirectory, "openobsidian-canvas-edit-user-config");
  const homeRoot = join(workDirectory, "openobsidian-canvas-edit-home");
  const localDataRoot = join(workDirectory, "openobsidian-canvas-edit-local-data");
  const appEnv: NodeJS.ProcessEnv = {...process.env, HOME: homeRoot};
  let appDataRoot: string;
  if (process.platform === "win32") {
    appEnv.APPDATA = userConfigRoot;
    appEnv.LOCALAPPDATA = localDataRoot;
    appEnv.USERPROFILE = homeRoot;
    appDataRoot = join(userConfigRoot, "OpenObsidian");
  } else if (process.platform === "darwin") {
    appDataRoot = join(homeRoot, "Library", "Application Support", "OpenObsidian");
  } else {
    appEnv.XDG_CONFIG_HOME = userConfigRoot;
    appEnv.XDG_CACHE_HOME = join(workDirectory, "openobsidian-canvas-edit-cache");
    appEnv.XDG_DATA_HOME = join(workDirectory, "openobsidian-canvas-edit-data");
    appEnv.LIBGL_ALWAYS_SOFTWARE = "1";
    appEnv.WGPU_BACKEND = "gl";
    appDataRoot = join(userConfigRoot, "OpenObsidian");
  }
  await mkdir(join(homeRoot, "Desktop"), {recursive: true});
  editReport.status = "running";
  editReport.source_canvas_path = canvasPath;
  editReport.source_text_node_id = "text-1";
  editReport.edited_text = canvasEditedText;
  editReport.accessible_labels = [
    "Edit Canvas text card",
    "Canvas edit path",
    "Canvas edit text-card ID",
    "Load Canvas text card",
    "Canvas text draft",
    "Save Canvas text",
    "Reload Canvas",
    "Cancel Canvas edit",
  ];
  editReport.save_policy = "The selected card is loaded into a draft; the vault must remain byte- and snapshot-identical until Save Canvas text is explicitly activated.";
  const screenshots: Record<string, string> = {};
  let child: ChildProcess | undefined;
  let window: {window_id: string; title: string; geometry: string} | undefined;
  try {
    child = launchLogged(openObsidianBinary, [], logPath, appEnv);
    editReport.pid = child.pid ?? null;
    await delay(1_000);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`OpenObsidian exited before Canvas text editing (code=${child.exitCode}, signal=${child.signalCode})`);
    }
    if (process.platform === "linux") {
      const x11Window = await waitFor("OpenObsidian Canvas text-edit window to become visible", async () => {
        try {
          const output = execFileSync("xdotool", ["search", "--onlyvisible", "--name", "OpenObsidian"], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
          const windowId = output.trim().split(/\s+/).filter(Boolean).at(-1);
          if (!windowId) return null;
          const title = execFileSync("xdotool", ["getwindowname", windowId], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
          const geometry = execFileSync("xdotool", ["getwindowgeometry", "--shell", windowId], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
          return {window_id: windowId, title, geometry};
        } catch {
          return null;
        }
      }, (value) => value !== null, 30_000);
      if (!x11Window) throw new Error("OpenObsidian did not expose a visible Canvas text-edit window");
      window = x11Window;
      xdotool("windowfocus", "--sync", window.window_id);
    } else {
      window = {window_id: String(child.pid ?? "unknown"), title: "OpenObsidian Canvas text-edit window", geometry: "native window bounds captured during screenshot"};
    }
    editReport.window = window;
    editReport.native_picker = await selectOpenObsidianVaultFromNativePicker(
      child,
      window,
      logPath,
      canvasVaultRoot,
      editReport,
      "openobsidian-canvas-text-edit",
    );
    const initialMarkdownCount = countMarkdownFiles(seedSnapshot);
    const opened = await waitFor("OpenObsidian to render the Canvas text-edit fixture vault", async () => {
      await delay(750);
      return await captureOpenObsidianScreenshot(window!.window_id, child!, "openobsidian-canvas-text-edit-selected", editReport);
    }, (capture) => ocrTextContainsFuzzyPhrase(capture.ocrText, canvasVaultName, 1)
      && new RegExp(`${initialMarkdownCount}\\s+Markdown files found`, "i").test(capture.ocrText), 30_000);
    screenshots.vault_selected = relative(reportDirectory, opened.windowPngPath);
    editReport.selected_vault_visible = true;
    editReport.markdown_count_before_edit = initialMarkdownCount;

    const canonicalVault = await realpath(canvasVaultRoot);
    const canonicalAppData = await realpath(appDataRoot);
    const relativeAppData = relative(canonicalVault, canonicalAppData);
    if (relativeAppData === "" || (!relativeAppData.startsWith(`..${sep}`) && relativeAppData !== ".." && !relativeAppData.startsWith(sep))) {
      throw new Error("OpenObsidian's Canvas text-edit application data directory is inside the selected vault");
    }
    editReport.app_data_root = appDataRoot;
    editReport.app_data_canonical_root_is_outside_vault = true;

    const beforeEdit = await snapshotTree(canvasVaultRoot);
    ensureExactSnapshot(seedSnapshot, beforeEdit, "Canvas vault before native text-card edit");
    const canvasBytesBefore = await readFile(join(canvasVaultRoot, canvasPath));
    const seedHash = createHash("sha256").update(canvasBytesBefore).digest("hex");
    if (canvasBytesBefore.length !== expectedSeedCanvas.bytes || seedHash !== expectedSeedCanvas.sha256) {
      throw new Error("OpenObsidian changed the Canvas source before native text-card edit");
    }
    if (beforeEdit.some((entry) => entry.path === canvasNotePath)) {
      throw new Error(`Canvas note destination already exists before native text-card edit: ${canvasNotePath}`);
    }
    editReport.vault_snapshot_before_edit = beforeEdit;
    editReport.canvas_bytes_before_edit = {bytes: canvasBytesBefore.length, sha256: seedHash};
    editReport.destination_absent_before_edit = true;

    const settledRefreshBeforeCanvasEditor = await waitForOpenObsidianRefreshIdle(
      0,
      initialMarkdownCount,
      false,
      logPath,
    );
    editReport.refresh_diagnostics_before_editor = {
      requests: settledRefreshBeforeCanvasEditor.requests,
      consumed_results: settledRefreshBeforeCanvasEditor.consumedResults,
      receiver_states: settledRefreshBeforeCanvasEditor.receiverStates,
      settled_for_ms: settledRefreshBeforeCanvasEditor.settled_for_ms,
    };

    const interactions: Record<string, string> = {};
    editReport.interactions = interactions;
    interactions.expand_canvas_text_edit = await invokeNativeAccessibleControl(
      child,
      window.window_id,
      "Edit Canvas text card",
      undefined,
      true,
    );
    const expandedForm = await waitFor(
      "OpenObsidian to expose the native Canvas text-edit fields",
      async () => await captureOpenObsidianScreenshot(window!.window_id, child!, "openobsidian-canvas-text-edit-expanded-form", editReport),
      (capture) => ocrTextContainsFuzzyPhrase(capture.ocrText, "Canvas edit path", 2)
        && ocrTextContainsFuzzyPhrase(capture.ocrText, "Canvas edit text-card ID", 2),
      30_000,
    );
    screenshots.expanded_form = relative(reportDirectory, expandedForm.windowPngPath);
    editReport.expanded_form_ocr = expandedForm.ocrText.slice(0, 4_000);

    const canvasPathReadback = await replaceOpenObsidianTextInput(child, window.window_id, "Canvas edit path", canvasPath, logPath);
    const textCardIdReadback = await replaceOpenObsidianTextInput(child, window.window_id, "Canvas edit text-card ID", "text-1", logPath);
    interactions.canvas_path = canvasPathReadback;
    interactions.text_card_id = textCardIdReadback;
    const inputReadbackEntries = [
      ["Canvas edit path", canvasPathReadback],
      ["Canvas edit text-card ID", textCardIdReadback],
    ] as Array<[string, string]>;
    const inputReadbacks = Object.fromEntries(inputReadbackEntries.map(([name, value]) => {
      try {
        const parsed = JSON.parse(value as string) as {exact_readback?: boolean; fallback?: {exact_readback?: boolean}};
        return [name, {exact_readback: parsed.exact_readback === true || parsed.fallback?.exact_readback === true, interaction: parsed}];
      } catch {
        return [name, {exact_readback: false, interaction: value}];
      }
    }));
    editReport.field_value_readbacks = inputReadbacks;
    const unverifiedInputs = Object.entries(inputReadbacks)
      .filter(([, result]) => !(result as {exact_readback?: boolean}).exact_readback)
      .map(([name]) => name);
    if (unverifiedInputs.length > 0) throw new Error(`Canvas edit inputs did not provide exact field-value readbacks: ${unverifiedInputs.join(", ")}`);

    const afterInput = await snapshotTree(canvasVaultRoot);
    ensureExactSnapshot(beforeEdit, afterInput, "Canvas path and text-card ID entry must not write to the vault");
    if ((await readFile(join(canvasVaultRoot, canvasPath))).compare(canvasBytesBefore) !== 0
      || afterInput.some((entry) => entry.path === canvasNotePath)) {
      throw new Error("Entering native Canvas edit inputs wrote to the vault or changed its Canvas source");
    }
    editReport.vault_snapshot_after_input = afterInput;
    editReport.no_write_during_input = true;

    await waitForOpenObsidianRefreshIdle(0, initialMarkdownCount, false, logPath);
    interactions.load = await invokeNativeAccessibleControl(child, window.window_id, "Load Canvas text card", undefined, true);
    const loadedDraft = await waitFor(
      "OpenObsidian to load the selected Canvas text-card draft",
      async () => await captureOpenObsidianScreenshot(window!.window_id, child!, "openobsidian-canvas-text-edit-loaded", editReport),
      (capture) => ocrTextContainsPhrase(capture.ocrText, "Canvas text draft")
        && ocrTextContainsPhrase(capture.ocrText, "Canvas text loaded")
        && capture.ocrText.includes(canvasMarker),
      30_000,
    );
    screenshots.loaded = relative(reportDirectory, loadedDraft.windowPngPath);
    editReport.loaded_ocr = loadedDraft.ocrText.slice(0, 4_000);
    const afterLoad = await snapshotTree(canvasVaultRoot);
    ensureExactSnapshot(afterInput, afterLoad, "Loading the Canvas text-card draft must not write to the vault");
    if ((await readFile(join(canvasVaultRoot, canvasPath))).compare(canvasBytesBefore) !== 0
      || afterLoad.some((entry) => entry.path === canvasNotePath)) {
      throw new Error("Loading the native Canvas text-card draft wrote to the vault or changed its source");
    }
    editReport.vault_snapshot_after_load = afterLoad;
    editReport.no_write_during_load = true;

    const draftReadback = await replaceOpenObsidianTextInput(child, window.window_id, "Canvas text draft", canvasEditedText, logPath);
    interactions.canvas_text_draft = draftReadback;
    let parsedDraftReadback: {exact_readback?: boolean; fallback?: {exact_readback?: boolean}};
    try {
      parsedDraftReadback = JSON.parse(draftReadback) as {exact_readback?: boolean; fallback?: {exact_readback?: boolean}};
    } catch {
      parsedDraftReadback = {};
    }
    editReport.draft_readback_exact = parsedDraftReadback.exact_readback === true || parsedDraftReadback.fallback?.exact_readback === true;
    if (!editReport.draft_readback_exact) {
      throw new Error("The native Canvas text draft did not provide an exact field-value readback");
    }
    const afterDraft = await snapshotTree(canvasVaultRoot);
    ensureExactSnapshot(afterLoad, afterDraft, "Editing the Canvas draft must not write to the vault before Save Canvas text");
    if ((await readFile(join(canvasVaultRoot, canvasPath))).compare(canvasBytesBefore) !== 0
      || afterDraft.some((entry) => entry.path === canvasNotePath)) {
      throw new Error("Editing the Canvas text draft wrote to the vault before explicit save");
    }
    editReport.vault_snapshot_after_draft = afterDraft;
    editReport.no_write_before_save = true;

    interactions.save = await invokeNativeAccessibleControl(child, window.window_id, "Save Canvas text", undefined, true);
    const savedCanvasBytes = await waitFor("OpenObsidian to save the selected Canvas text card", async () => {
      try {
        const bytes = await readFile(join(canvasVaultRoot, canvasPath));
        let document: unknown;
        try {
          document = JSON.parse(bytes.toString("utf8")) as unknown;
        } catch {
          return null;
        }
        return canvasDocumentMatchesExpectedTextEdit(document, expectedEditedDocument) ? bytes : null;
      } catch {
        return null;
      }
    }, (bytes) => bytes !== null, 15_000);
    if (!savedCanvasBytes) throw new Error("Saving the Canvas text draft did not produce the exact expected Canvas document");
    const savedCanvasHash = createHash("sha256").update(savedCanvasBytes).digest("hex");
    let savedDocument: unknown;
    try {
      savedDocument = JSON.parse(savedCanvasBytes.toString("utf8")) as unknown;
    } catch (error) {
      throw new Error(`Saved Canvas text edit was not valid JSON: ${error instanceof Error ? error.message : "unknown parse error"}`);
    }
    if (!canvasDocumentMatchesExpectedTextEdit(savedDocument, expectedEditedDocument)) {
      await writeFile(join(reportDirectory, "canvas-text-edit-incorrect-output.canvas"), savedCanvasBytes);
      throw new Error("Saved Canvas JSON did not equal the seed document with only text-1.text changed");
    }
    const afterSave = await snapshotTree(canvasVaultRoot);
    const saveChanges = changedPaths(afterDraft, afterSave);
    if (saveChanges.length !== 1 || saveChanges[0]?.path !== canvasPath
      || saveChanges[0]?.before?.kind !== "file" || saveChanges[0]?.after?.kind !== "file") {
      throw new Error(`Saving Canvas text changed paths beyond the selected Canvas file: ${JSON.stringify(saveChanges).slice(0, 4_000)}`);
    }
    if (afterSave.some((entry) => entry.path === canvasNotePath)
      || countMarkdownFiles(afterSave) !== countMarkdownFiles(afterDraft)) {
      throw new Error("Saving the native Canvas text card created or changed a Markdown note");
    }
    const allNonTargetDataPreserved = isDeepStrictEqual(savedDocument, expectedEditedDocument)
      && expectedEditedDocument.nodes.some((node) => node.id === "file-1")
      && expectedEditedDocument.nodes.some((node) => node.id === "group-1")
      && isDeepStrictEqual(expectedEditedDocument.nodes.filter((node) => node.id !== "text-1"), seedDocument.nodes.filter((node) => node.id !== "text-1"))
      && isDeepStrictEqual(expectedEditedDocument.edges, seedDocument.edges);
    if (!allNonTargetDataPreserved) {
      throw new Error("Saving the Canvas edit changed a sibling node, an edge, or other non-target document data");
    }
    editReport.status = "passed";
    editReport.interactions = interactions;
    editReport.screenshots = screenshots;
    editReport.vault_snapshot_after_save = afterSave;
    editReport.vault_changes_from_explicit_save = saveChanges;
    editReport.canvas_bytes_after_save = {bytes: savedCanvasBytes.length, sha256: savedCanvasHash};
    editReport.saved_document_matches_only_selected_text_change = true;
    editReport.selected_node_other_fields_preserved = true;
    editReport.sibling_nodes_and_edges_preserved = true;
    editReport.all_unselected_canvas_fields_preserved = true;
    editReport.no_markdown_created = true;
    snapshots.canvas_text_edit_before = beforeEdit;
    snapshots.canvas_text_edit_after = afterSave;
    await writeFile(join(reportDirectory, "canvas-text-edit-before.json"), `${JSON.stringify(beforeEdit, null, 2)}\n`);
    await writeFile(join(reportDirectory, "canvas-text-edit-after.json"), `${JSON.stringify(afterSave, null, 2)}\n`);
    await writeFile(join(reportDirectory, "canvas-text-edit-source-before.canvas"), canvasBytesBefore);
    await writeFile(join(reportDirectory, "canvas-text-edit-source-after.canvas"), savedCanvasBytes);
    editReport.artifacts = {
      openobsidian_log: "openobsidian-canvas-text-edit.log",
      before_snapshot: "canvas-text-edit-before.json",
      after_snapshot: "canvas-text-edit-after.json",
      source_before: "canvas-text-edit-source-before.canvas",
      source_after: "canvas-text-edit-source-after.canvas",
    };
    await saveReport();

    await delay(1_000);
    await stopProcess(child);
    child = undefined;
    const afterClose = await snapshotTree(canvasVaultRoot);
    ensureExactSnapshot(afterSave, afterClose, "OpenObsidian close after native Canvas text edit");
    const closedBytes = await readFile(join(canvasVaultRoot, canvasPath));
    if (closedBytes.compare(savedCanvasBytes) !== 0 || afterClose.some((entry) => entry.path === canvasNotePath)) {
      throw new Error("OpenObsidian changed the saved Canvas edit on close or created a Markdown note");
    }
    editReport.vault_snapshot_after_close = afterClose;
    editReport.canvas_bytes_after_close = {bytes: closedBytes.length, sha256: createHash("sha256").update(closedBytes).digest("hex")};
    editReport.vault_unchanged_after_close = true;
    await saveReport();
    return {
      snapshot: afterClose,
      canvas: {bytes: closedBytes.length, sha256: createHash("sha256").update(closedBytes).digest("hex")},
    };
  } catch (error) {
    editReport.status = "failed";
    editReport.error = error instanceof Error ? error.message : String(error);
    editReport.screenshots = screenshots;
    await saveReport();
    throw error;
  } finally {
    await stopProcess(child).catch(() => undefined);
  }
}

async function runOpenObsidianCanvasNoteCreation(
  seedSnapshot: SnapshotEntry[],
  expectedCanvas: {bytes: number; sha256: string},
  expectedText: string,
): Promise<SnapshotEntry[]> {
  const canvasReport = report.canvas_reference_reopen as Record<string, unknown>;
  const noteReport = canvasReport.note_creation as Record<string, unknown>;
  const snapshots = report.vault_snapshots as Record<string, unknown>;
  const expectedNoteBytes = Buffer.from(expectedText, "utf8");
  const expectedNoteSha256 = createHash("sha256").update(expectedNoteBytes).digest("hex");
  const userConfigRoot = join(workDirectory, "openobsidian-canvas-user-config");
  const homeRoot = join(workDirectory, "openobsidian-canvas-home");
  const localDataRoot = join(workDirectory, "openobsidian-canvas-local-data");
  const appEnv: NodeJS.ProcessEnv = {...process.env, HOME: homeRoot};
  let appDataRoot: string;
  if (process.platform === "win32") {
    appEnv.APPDATA = userConfigRoot;
    appEnv.LOCALAPPDATA = localDataRoot;
    appEnv.USERPROFILE = homeRoot;
    appDataRoot = join(userConfigRoot, "OpenObsidian");
  } else if (process.platform === "darwin") {
    appDataRoot = join(homeRoot, "Library", "Application Support", "OpenObsidian");
  } else {
    appEnv.XDG_CONFIG_HOME = userConfigRoot;
    appEnv.XDG_CACHE_HOME = join(workDirectory, "openobsidian-canvas-cache");
    appEnv.XDG_DATA_HOME = join(workDirectory, "openobsidian-canvas-data");
    appEnv.LIBGL_ALWAYS_SOFTWARE = "1";
    appEnv.WGPU_BACKEND = "gl";
    appDataRoot = join(userConfigRoot, "OpenObsidian");
  }
  await mkdir(join(homeRoot, "Desktop"), {recursive: true});
  noteReport.status = "running";
  noteReport.source_canvas_path = canvasPath;
  noteReport.source_text_node_id = "text-1";
  noteReport.output_path = canvasNotePath;
  noteReport.expected_note_bytes = expectedNoteBytes.length;
  noteReport.expected_note_sha256 = expectedNoteSha256;
  noteReport.expected_note_text = expectedText;
  noteReport.body_is_exact_canvas_text = true;
  noteReport.accessible_labels = [
    "Create note from Canvas text card",
    "Canvas path",
    "Text card ID",
    "New Markdown path",
    "Preview note creation",
    "Review and confirm note creation",
    "Confirm and create note",
  ];
  const screenshots: Record<string, string> = {};
  let child: ChildProcess | undefined;
  let window: {window_id: string; title: string; geometry: string} | undefined;
  try {
    child = launchLogged(openObsidianBinary, [], join(reportDirectory, "openobsidian-canvas-note-create.log"), appEnv);
    noteReport.pid = child.pid ?? null;
    await delay(1_000);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`OpenObsidian exited before Canvas note creation (code=${child.exitCode}, signal=${child.signalCode})`);
    }
    if (process.platform === "linux") {
      const x11Window = await waitFor("OpenObsidian Canvas note-creation window to become visible", async () => {
        try {
          const output = execFileSync("xdotool", ["search", "--onlyvisible", "--name", "OpenObsidian"], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
          const windowId = output.trim().split(/\s+/).filter(Boolean).at(-1);
          if (!windowId) return null;
          const title = execFileSync("xdotool", ["getwindowname", windowId], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
          const geometry = execFileSync("xdotool", ["getwindowgeometry", "--shell", windowId], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
          return {window_id: windowId, title, geometry};
        } catch {
          return null;
        }
      }, (value) => value !== null, 30_000);
      if (!x11Window) throw new Error("OpenObsidian did not expose a visible Canvas note-creation window");
      window = x11Window;
      xdotool("windowfocus", "--sync", window.window_id);
    } else {
      window = {window_id: String(child.pid ?? "unknown"), title: "OpenObsidian Canvas note-creation window", geometry: "native window bounds captured during screenshot"};
    }
    noteReport.window = window;
    noteReport.native_picker = await selectOpenObsidianVaultFromNativePicker(
      child,
      window,
      join(reportDirectory, "openobsidian-canvas-note-create.log"),
      canvasVaultRoot,
      noteReport,
      "openobsidian-canvas-note-create",
    );
    const initialMarkdownCount = countMarkdownFiles(seedSnapshot);
    const opened = await waitFor("OpenObsidian to render the Canvas fixture vault", async () => {
      await delay(750);
      return await captureOpenObsidianScreenshot(window!.window_id, child!, "openobsidian-canvas-note-create-selected", noteReport);
    }, (capture) => ocrTextContainsFuzzyPhrase(capture.ocrText, canvasVaultName, 1)
      && new RegExp(`${initialMarkdownCount}\\s+Markdown files found`, "i").test(capture.ocrText), 30_000);
    screenshots.vault_selected = relative(reportDirectory, opened.windowPngPath);
    noteReport.selected_vault_visible = true;
    noteReport.markdown_count_before_creation = initialMarkdownCount;
    const canonicalVault = await realpath(canvasVaultRoot);
    const canonicalAppData = await realpath(appDataRoot);
    const relativeAppData = relative(canonicalVault, canonicalAppData);
    if (relativeAppData === "" || (!relativeAppData.startsWith(`..${sep}`) && relativeAppData !== ".." && !relativeAppData.startsWith(sep))) {
      throw new Error("OpenObsidian's Canvas note-creation application data directory is inside the selected vault");
    }
    noteReport.app_data_root = appDataRoot;
    noteReport.app_data_canonical_root_is_outside_vault = true;
    const appDataBeforeCreation = await snapshotTree(appDataRoot);
    noteReport.app_data_snapshot_before_creation = appDataBeforeCreation;

    const noteBefore = await snapshotTree(canvasVaultRoot);
    ensureExactSnapshot(seedSnapshot, noteBefore, "Canvas vault before native note-creation preview");
    const canvasBytesBefore = await readFile(join(canvasVaultRoot, canvasPath));
    if (canvasBytesBefore.length !== expectedCanvas.bytes || createHash("sha256").update(canvasBytesBefore).digest("hex") !== expectedCanvas.sha256) {
      throw new Error("OpenObsidian changed the Canvas source before note creation");
    }
    if (noteBefore.some((entry) => entry.path === canvasNotePath)) {
      throw new Error(`Canvas note destination already exists before explicit confirmation: ${canvasNotePath}`);
    }
    noteReport.vault_snapshot_before_preview = noteBefore;
    noteReport.destination_absent_before_confirmation = true;

    const interactions: Record<string, string> = {};
    noteReport.interactions = interactions;
    interactions.expand_canvas_creation = await invokeNativeAccessibleControl(
      child,
      window.window_id,
      "Create note from Canvas text card",
      undefined,
      true,
    );
    const expandedForm = await waitFor(
      "OpenObsidian to expose the Canvas note-creation fields",
      async () => await captureOpenObsidianScreenshot(window!.window_id, child!, "openobsidian-canvas-note-create-expanded-form", noteReport),
      (capture) => ocrTextContainsPhrase(capture.ocrText, "Canvas path")
        && ocrTextContainsPhrase(capture.ocrText, "Text card ID")
        && ocrTextContainsPhrase(capture.ocrText, "New Markdown path"),
      30_000,
    );
    screenshots.expanded_form = relative(reportDirectory, expandedForm.windowPngPath);
    noteReport.expanded_form_ocr = expandedForm.ocrText.slice(0, 4_000);
    const canvasPathReadback = await replaceOpenObsidianTextInput(child, window!.window_id, "Canvas path", canvasPath);
    const textCardIdReadback = await replaceOpenObsidianTextInput(child, window!.window_id, "Text card ID", "text-1");
    const markdownPathReadback = await replaceOpenObsidianTextInput(child, window!.window_id, "New Markdown path", canvasNotePath);
    interactions.canvas_path = canvasPathReadback;
    interactions.text_card_id = textCardIdReadback;
    interactions.new_markdown_path = markdownPathReadback;
    const readbackEntries = [
      ["Canvas path", canvasPathReadback],
      ["Text card ID", textCardIdReadback],
      ["New Markdown path", markdownPathReadback],
    ] as Array<[string, string]>;
    const fieldReadbacks = Object.fromEntries(readbackEntries.map(([name, result]) => {
      try {
        const parsed = JSON.parse(result) as {exact_readback?: boolean; fallback?: {exact_readback?: boolean}};
        const exactReadback = parsed.exact_readback === true || parsed.fallback?.exact_readback === true;
        return [name, {exact_readback: exactReadback, interaction: parsed}];
      } catch {
        return [name, {exact_readback: false, interaction: result}];
      }
    }));
    noteReport.field_value_readbacks = fieldReadbacks;
    const unverifiedFields = Object.entries(fieldReadbacks).filter(([, result]) => !(result as {exact_readback?: boolean}).exact_readback).map(([name]) => name);
    if (unverifiedFields.length > 0) throw new Error(`Canvas form inputs did not provide exact field-value readbacks: ${unverifiedFields.join(", ")}`);
    const ready = await captureOpenObsidianScreenshot(window!.window_id, child!, "openobsidian-canvas-note-create-form", noteReport);
    if (!canvasFormFieldLabelsVisible(ready.ocrText)) {
      throw new Error(`Canvas note-creation form labels were not visible after exact field-value readback: ${JSON.stringify(ready.ocrText.slice(0, 2_000))}`);
    }
    screenshots.form = relative(reportDirectory, ready.windowPngPath);
    noteReport.form_ocr = ready.ocrText.slice(0, 4_000);
    const afterForm = await snapshotTree(canvasVaultRoot);
    ensureExactSnapshot(noteBefore, afterForm, "Canvas note-creation form must not write to the vault");
    if ((await readFile(join(canvasVaultRoot, canvasPath))).compare(canvasBytesBefore) !== 0
      || afterForm.some((entry) => entry.path === canvasNotePath)) {
      throw new Error("Entering Canvas note-creation form values wrote to the vault or changed the source Canvas");
    }
    noteReport.vault_snapshot_after_form = afterForm;
    noteReport.no_write_during_form_entry = true;

    interactions.preview = await invokeNativeAccessibleControl(
      child,
      window.window_id,
      "Preview note creation",
      "Create note from Canvas text card",
      true,
    );
    const preview = await waitFor(
      "OpenObsidian to show the exact Canvas text-card preview",
      async () => await captureOpenObsidianScreenshot(window!.window_id, child!, "openobsidian-canvas-note-create-preview", noteReport),
      (capture) => capture.ocrText.includes(canvasMarker)
        && (capture.ocrText.includes("Exact note body")
          || capture.ocrText.includes("Review and confirm note creation"))
        && capture.ocrText.includes(canvasNotePath)
        && capture.ocrText.includes(canvasPath),
      30_000,
    );
    screenshots.preview = relative(reportDirectory, preview.windowPngPath);
    noteReport.preview_ocr = preview.ocrText.slice(0, 4_000);
    const afterPreview = await snapshotTree(canvasVaultRoot);
    ensureExactSnapshot(noteBefore, afterPreview, "Canvas note-creation preview must not write to the vault");
    if ((await readFile(join(canvasVaultRoot, canvasPath))).compare(canvasBytesBefore) !== 0) {
      throw new Error("Canvas note-creation preview changed the source Canvas bytes");
    }
    if (afterPreview.some((entry) => entry.path === canvasNotePath)) {
      throw new Error("Canvas note-creation preview wrote the Markdown destination before confirmation");
    }
    noteReport.vault_snapshot_after_preview = afterPreview;
    noteReport.no_write_during_preview = true;

    interactions.review = await invokeNativeAccessibleControl(
      child,
      window.window_id,
      "Review and confirm note creation",
      "Exact note body",
      true,
    );
    const review = await waitFor(
      "OpenObsidian to show the final Canvas note-creation confirmation",
      async () => await captureOpenObsidianScreenshot(window!.window_id, child!, "openobsidian-canvas-note-create-review", noteReport),
      (capture) => capture.ocrText.includes(canvasMarker)
        && capture.ocrText.includes(canvasNotePath)
        && ocrTextContainsFuzzyPhrase(capture.ocrText, "from this Canvas text card", 1),
      30_000,
    );
    screenshots.review = relative(reportDirectory, review.windowPngPath);
    noteReport.review_ocr = review.ocrText.slice(0, 4_000);
    const afterReview = await snapshotTree(canvasVaultRoot);
    ensureExactSnapshot(afterPreview, afterReview, "Canvas note-creation review must not write to the vault");
    if (afterReview.some((entry) => entry.path === canvasNotePath)) {
      throw new Error("Canvas note-creation review wrote the Markdown destination before explicit confirmation");
    }
    noteReport.vault_snapshot_after_review = afterReview;
    noteReport.no_write_during_review = true;

    interactions.confirm = await invokeNativeAccessibleControl(child, window.window_id, "Confirm and create note", undefined, true);
    const confirmedBytes = await waitFor("OpenObsidian to create the confirmed Canvas note", async () => {
      try {
        return await readFile(join(canvasVaultRoot, canvasNotePath));
      } catch {
        return null;
      }
    }, (bytes) => bytes !== null, 15_000);
    if (confirmedBytes === null) {
      throw new Error(`OpenObsidian did not create the confirmed Canvas note at ${canvasNotePath}`);
    }
    if (!confirmedBytes.equals(expectedNoteBytes)) {
      await writeFile(join(reportDirectory, "canvas-note-creation-incorrect-output.md"), confirmedBytes);
      throw new Error(`Created Canvas note bytes differ from the exact text card body: expected ${expectedNoteBytes.length} bytes / ${expectedNoteSha256}, got ${confirmedBytes.length} bytes / ${createHash("sha256").update(confirmedBytes).digest("hex")}`);
    }
    const afterCreate = await snapshotTree(canvasVaultRoot);
    const createChanges = changedPaths(afterReview, afterCreate);
    if (createChanges.length !== 1 || createChanges[0]?.path !== canvasNotePath || createChanges[0]?.before !== undefined || createChanges[0]?.after?.kind !== "file") {
      throw new Error(`Explicit Canvas note creation changed unexpected vault paths: ${JSON.stringify(createChanges).slice(0, 4_000)}`);
    }
    const canvasBytesAfter = await readFile(join(canvasVaultRoot, canvasPath));
    const canvasHashAfter = createHash("sha256").update(canvasBytesAfter).digest("hex");
    if (canvasBytesAfter.length !== expectedCanvas.bytes || canvasHashAfter !== expectedCanvas.sha256) {
      await writeFile(join(reportDirectory, "canvas-note-creation-changed-source.canvas"), canvasBytesAfter);
      throw new Error("Explicit Canvas note creation changed the Canvas source bytes");
    }
    noteReport.status = "passed";
    noteReport.confirmation_interaction = interactions.confirm;
    noteReport.interactions = interactions;
    noteReport.screenshots = screenshots;
    noteReport.expected_note_body_sha256 = expectedNoteSha256;
    noteReport.created_note_bytes = confirmedBytes.length;
    noteReport.created_note_sha256 = createHash("sha256").update(confirmedBytes).digest("hex");
    noteReport.created_note_matches_exact_canvas_text = true;
    noteReport.vault_changes_from_explicit_creation = createChanges;
    noteReport.canvas_bytes_before_creation = {bytes: canvasBytesBefore.length, sha256: expectedCanvas.sha256};
    noteReport.canvas_bytes_after_creation = {bytes: canvasBytesAfter.length, sha256: canvasHashAfter};
    noteReport.canvas_unchanged = true;
    noteReport.vault_snapshot_after_creation = afterCreate;
    snapshots.canvas_note_creation_before = noteBefore;
    snapshots.canvas_note_creation_after = afterCreate;
    await writeFile(join(reportDirectory, "canvas-note-creation-before.json"), `${JSON.stringify(noteBefore, null, 2)}\n`);
    await writeFile(join(reportDirectory, "canvas-note-creation-after.json"), `${JSON.stringify(afterCreate, null, 2)}\n`);
    await writeFile(join(reportDirectory, "canvas-note-creation-source.canvas"), canvasBytesAfter);
    await writeFile(join(reportDirectory, "canvas-note-creation-note.md"), confirmedBytes);
    noteReport.artifacts = {
      openobsidian_log: "openobsidian-canvas-note-create.log",
      before_snapshot: "canvas-note-creation-before.json",
      after_snapshot: "canvas-note-creation-after.json",
      source_canvas_bytes: "canvas-note-creation-source.canvas",
      created_note_bytes: "canvas-note-creation-note.md",
    };
    await saveReport();

    await delay(1_000);
    await stopProcess(child);
    child = undefined;
    const afterClose = await snapshotTree(canvasVaultRoot);
    ensureExactSnapshot(afterCreate, afterClose, "OpenObsidian close after Canvas note creation");
    if ((await readFile(join(canvasVaultRoot, canvasPath))).compare(canvasBytesBefore) !== 0) {
      throw new Error("OpenObsidian changed the Canvas source after note creation when closing");
    }
    noteReport.vault_snapshot_after_close = afterClose;
    const appDataAfterCreation = await snapshotTree(appDataRoot);
    const appDataChangesFromCreation = changedPaths(appDataBeforeCreation, appDataAfterCreation);
    const eframeFilesAfterCreation = await readSnapshotTextFiles(
      appDataRoot,
      appDataAfterCreation,
      (path) => path.toLowerCase().endsWith(".ron"),
    );
    noteReport.app_data_snapshot_after_creation = appDataAfterCreation;
    noteReport.app_data_changes_from_creation = appDataChangesFromCreation;
    noteReport.eframe_persistence_files_after_creation = eframeFilesAfterCreation;
    await saveReport();
    const transactionValidation = await validateCanvasNoteCreationAppDataTransaction(
      appDataBeforeCreation,
      appDataAfterCreation,
      appDataChangesFromCreation,
      appDataRoot,
      canonicalAppData,
      canvasVaultRoot,
      canvasNotePath,
      expectedNoteBytes,
      expectedNoteSha256,
    );
    noteReport.app_data_creation_transaction_validation = transactionValidation;
    noteReport.app_data_change_policy_passed = true;
    noteReport.vault_unchanged_after_close = true;
    await saveReport();
    return afterClose;
  } catch (error) {
    noteReport.status = "failed";
    noteReport.error = error instanceof Error ? error.message : String(error);
    noteReport.screenshots = screenshots;
    await saveReport();
    throw error;
  } finally {
    await stopProcess(child).catch(() => undefined);
  }
}

async function runCanvasReferenceProbe(): Promise<void> {
  const profileDirectory = join(workDirectory, "canvas-obsidian-profile");
  const canvasReport = report.canvas_reference_reopen as Record<string, unknown>;
  const snapshots = report.vault_snapshots as Record<string, unknown>;
  canvasReport.status = "running";
  let firstProcess: ChildProcess | undefined;
  let firstConnection: DevToolsConnection | undefined;
  let secondProcess: ChildProcess | undefined;
  let secondConnection: DevToolsConnection | undefined;
  try {
    const seedCanvas = await createCanvasReferenceFixture();
    const {seed: seedDocument, edited: expectedEditedDocument} = canvasReferenceDocumentsWithEditedText(canvasEditedText);
    const seedSnapshot = await snapshotTree(canvasVaultRoot);
    snapshots.canvas_reference_seed = seedSnapshot;
    const textEdit = await runOpenObsidianCanvasTextEdit(
      seedSnapshot,
      seedCanvas,
      seedDocument,
      expectedEditedDocument,
    );
    const expectedCanvas = textEdit.canvas;
    const editedSnapshot = textEdit.snapshot;
    snapshots.canvas_reference_after_native_text_edit = editedSnapshot;
    canvasReport.source_after_native_text_edit = expectedCanvas;
    canvasReport.edited_text = canvasEditedText;
    const expectedCreatedNoteBytes = Buffer.from(canvasEditedText, "utf8");
    const postCreateBaseline = await runOpenObsidianCanvasNoteCreation(editedSnapshot, expectedCanvas, canvasEditedText);
    snapshots.canvas_reference_after_native_note_creation = postCreateBaseline;
    canvasReport.note_creation_baseline_includes_created_note = postCreateBaseline.some((entry) => (
      entry.path === canvasNotePath
      && entry.kind === "file"
      && entry.bytes === expectedCreatedNoteBytes.length
      && entry.sha256 === createHash("sha256").update(expectedCreatedNoteBytes).digest("hex")
    ));
    if (!canvasReport.note_creation_baseline_includes_created_note) {
      throw new Error("The post-creation Canvas vault baseline does not contain the exact new Markdown note");
    }
    const noteBeforeFirstOpen = await assertCanvasCreatedNoteSource(expectedCreatedNoteBytes, "before the first Obsidian open");
    firstProcess = await createObsidianProfile(profileDirectory, 9224, "obsidian-canvas-first-open.log");
    const first = await connectObsidian(9224);
    firstConnection = first.connection;
    const firstSession: Record<string, unknown> = {
      devtools_browser: first.browserVersion,
      first_target: {title: first.target.title ?? "", url: first.target.url ?? ""},
      source_before_open: expectedCanvas,
      created_note_source_before_open: noteBeforeFirstOpen,
    };
    canvasReport.first_session = firstSession;
    const firstRunBody = await waitForRenderer(
      firstConnection,
      "document.body?.innerText ?? ''",
      (body) => body.includes("Open folder as vault"),
      "Obsidian's first-run Canvas reference vault screen",
    );
    firstSession.first_run_text = firstRunBody.slice(0, 2_000);
    await captureObsidianScreenshot(firstConnection, "obsidian-canvas-first-run.png");
    firstConnection = await chooseVaultDirectory(firstConnection, 9224, firstProcess!, {
      targetRoot: canvasVaultRoot,
      reporter: canvasReport,
      screenshotPrefix: "obsidian-canvas",
    });
    await chooseRestrictedMode(firstConnection, firstSession, canvasVaultName, canvasMarker);
    const firstView = await verifyCanvasReferenceVisible(
      firstConnection,
      expectedCanvas,
      "obsidian-canvas-first-open.png",
      "Canvas reference first open",
    );
    firstSession.canvas_view = {
      marker_visible_in_body: firstView.body.includes(canvasMarker),
      edited_text_visible_in_body: firstView.body.includes(canvasEditedText),
      path_visible_in_file_explorer: firstView.paths.includes(canvasPath),
      target_subpath_content_visible: firstView.body.includes(canvasTargetText),
      target_subpath_resolution_error_absent: !firstView.body.includes("Unable to find"),
      title: firstView.title,
      body: firstView.body.slice(0, 4_000),
      bytes: firstView.bytes,
      sha256: firstView.sha256,
      screenshot: "obsidian-canvas-first-open.png",
    };
    if (!firstView.body.includes(canvasEditedText)) {
      throw new Error("Obsidian's first open did not render the text saved by the native Canvas editor");
    }
    const firstCreatedNoteView = await verifyCanvasCreatedNoteVisible(
      firstConnection,
      "obsidian-canvas-created-note-first-open.png",
      "Canvas-created Markdown note first open",
    );
    const firstCreatedNoteSource = await assertCanvasCreatedNoteSource(expectedCreatedNoteBytes, "during the first Obsidian open");
    firstSession.created_note_view = {
      path: canvasNotePath,
      path_visible_in_file_explorer: firstCreatedNoteView.paths.includes(canvasNotePath),
      active_file_path: firstCreatedNoteView.active_file_path,
      active_tree_path: firstCreatedNoteView.active_tree_path,
      active_view_type: firstCreatedNoteView.active_view_type,
      active_view_is_markdown: firstCreatedNoteView.active_view_is_markdown,
      exact_text_card_body_visible: firstCreatedNoteView.active_view_text.includes(canvasEditedText),
      title: firstCreatedNoteView.title,
      body: firstCreatedNoteView.body.slice(0, 2_000),
      editor: firstCreatedNoteView.editor.slice(0, 2_000),
      active_view_text: firstCreatedNoteView.active_view_text.slice(0, 2_000),
      source_bytes: firstCreatedNoteSource.bytes,
      source_sha256: firstCreatedNoteSource.sha256,
      screenshot: "obsidian-canvas-created-note-first-open.png",
    };
    if (!firstSession.created_note_view || !firstCreatedNoteView.paths.includes(canvasNotePath)
      || (firstCreatedNoteView.active_file_path !== canvasNotePath && firstCreatedNoteView.active_tree_path !== canvasNotePath)
      || !firstCreatedNoteView.active_view_is_markdown
      || !firstCreatedNoteView.active_view_text.includes(canvasEditedText)) {
      throw new Error("Obsidian's first open did not activate and render the explicitly created Canvas text-card Markdown note");
    }
    await delay(2_000);
    await stopProcess(firstProcess, firstConnection);
    firstProcess = undefined;
    firstConnection = undefined;

    const afterFirstClose = await snapshotTree(canvasVaultRoot);
    snapshots.canvas_reference_after_first_close = afterFirstClose;
    const firstCloseCanvas = await assertCanvasReferenceSource(expectedCanvas, expectedEditedDocument, "the first Obsidian shutdown");
    const firstCloseNote = await assertCanvasCreatedNoteSource(expectedCreatedNoteBytes, "the first Obsidian shutdown");
    firstSession.created_note_source_after_close = firstCloseNote;
    const firstCloseChanges = changedPaths(postCreateBaseline, afterFirstClose);
    const firstCloseUnexpectedChanges = firstCloseChanges.filter((change) => (
      change.path !== canvasPath && !workspaceStateAllowlist.includes(change.path)
    ));
    if (firstCloseUnexpectedChanges.length > 0) {
      throw new Error(`Canvas reference first open changed unapproved vault content: ${JSON.stringify(firstCloseUnexpectedChanges).slice(0, 6_000)}`);
    }
    snapshots.canvas_reference_first_open_vault_changes = firstCloseChanges;
    firstSession.source_after_close = firstCloseCanvas;
    firstSession.vault_changes_during_obsidian_session = firstCloseChanges;

    const beforeSecondOpen = afterFirstClose;
    snapshots.canvas_reference_before_second_open = beforeSecondOpen;
    const noteBeforeSecondOpen = await assertCanvasCreatedNoteSource(expectedCreatedNoteBytes, "before the reopened Obsidian session");
    secondProcess = await createObsidianProfile(profileDirectory, 9225, "obsidian-canvas-reopen.log");
    const second = await connectObsidian(9225);
    secondConnection = second.connection;
    const secondSession: Record<string, unknown> = {
      devtools_browser: second.browserVersion,
      first_target: {title: second.target.title ?? "", url: second.target.url ?? ""},
      source_before_reopen: firstCloseCanvas,
      created_note_source_before_reopen: noteBeforeSecondOpen,
    };
    canvasReport.second_session = secondSession;
    await chooseRestrictedMode(secondConnection, secondSession, canvasVaultName, canvasMarker);
    const secondView = await verifyCanvasReferenceVisible(
      secondConnection,
      firstCloseCanvas,
      "obsidian-canvas-reopened.png",
      "Canvas reference reopen",
    );
    secondSession.canvas_view = {
      marker_visible_in_body: secondView.body.includes(canvasMarker),
      edited_text_visible_in_body: secondView.body.includes(canvasEditedText),
      path_visible_in_file_explorer: secondView.paths.includes(canvasPath),
      target_subpath_content_visible: secondView.body.includes(canvasTargetText),
      target_subpath_resolution_error_absent: !secondView.body.includes("Unable to find"),
      title: secondView.title,
      body: secondView.body.slice(0, 4_000),
      bytes: secondView.bytes,
      sha256: secondView.sha256,
      screenshot: "obsidian-canvas-reopened.png",
    };
    if (!secondView.body.includes(canvasEditedText)) {
      throw new Error("Obsidian's reopened session did not render the text saved by the native Canvas editor");
    }
    const secondCreatedNoteView = await verifyCanvasCreatedNoteVisible(
      secondConnection,
      "obsidian-canvas-created-note-reopened.png",
      "Canvas-created Markdown note reopen",
    );
    const secondCreatedNoteSource = await assertCanvasCreatedNoteSource(expectedCreatedNoteBytes, "during the reopened Obsidian session");
    secondSession.created_note_view = {
      path: canvasNotePath,
      path_visible_in_file_explorer: secondCreatedNoteView.paths.includes(canvasNotePath),
      active_file_path: secondCreatedNoteView.active_file_path,
      active_tree_path: secondCreatedNoteView.active_tree_path,
      active_view_type: secondCreatedNoteView.active_view_type,
      active_view_is_markdown: secondCreatedNoteView.active_view_is_markdown,
      exact_text_card_body_visible: secondCreatedNoteView.active_view_text.includes(canvasEditedText),
      title: secondCreatedNoteView.title,
      body: secondCreatedNoteView.body.slice(0, 2_000),
      editor: secondCreatedNoteView.editor.slice(0, 2_000),
      active_view_text: secondCreatedNoteView.active_view_text.slice(0, 2_000),
      source_bytes: secondCreatedNoteSource.bytes,
      source_sha256: secondCreatedNoteSource.sha256,
      screenshot: "obsidian-canvas-created-note-reopened.png",
    };
    if (!secondCreatedNoteView.paths.includes(canvasNotePath)
      || (secondCreatedNoteView.active_file_path !== canvasNotePath && secondCreatedNoteView.active_tree_path !== canvasNotePath)
      || !secondCreatedNoteView.active_view_is_markdown
      || !secondCreatedNoteView.active_view_text.includes(canvasEditedText)) {
      throw new Error("Obsidian's reopened session did not activate and render the explicitly created Canvas text-card Markdown note");
    }
    await delay(2_000);
    await stopProcess(secondProcess, secondConnection);
    secondProcess = undefined;
    secondConnection = undefined;

    const afterSecondClose = await snapshotTree(canvasVaultRoot);
    snapshots.canvas_reference_after_reopen = afterSecondClose;
    const secondCloseCanvas = await assertCanvasReferenceSource(firstCloseCanvas, expectedEditedDocument, "the reopened Obsidian shutdown");
    const secondCloseNote = await assertCanvasCreatedNoteSource(expectedCreatedNoteBytes, "the reopened Obsidian shutdown");
    secondSession.created_note_source_after_close = secondCloseNote;
    const reopenChanges = changedPaths(beforeSecondOpen, afterSecondClose);
    const allowedReferenceChanges = reopenChanges.filter((change) => (
      workspaceStateAllowlist.includes(change.path) || change.path === canvasPath
    ));
    const unexpectedChanges = reopenChanges.filter((change) => (
      !workspaceStateAllowlist.includes(change.path) && change.path !== canvasPath
    ));
    if (unexpectedChanges.length > 0) {
      throw new Error(`Canvas reference reopen changed unapproved vault content: ${JSON.stringify(unexpectedChanges).slice(0, 6_000)}`);
    }
    snapshots.canvas_reference_reopen_changes = allowedReferenceChanges;
    canvasReport.source_after_reopen = secondCloseCanvas;
    canvasReport.source_semantics_preserved_after_both_shutdowns = firstCloseCanvas.semantic_content_matches_expected
      && secondCloseCanvas.semantic_content_matches_expected;
    canvasReport.edited_text_visible_on_first_open = firstView.body.includes(canvasEditedText);
    canvasReport.edited_text_visible_after_reopen = secondView.body.includes(canvasEditedText);
    canvasReport.edited_byte_representation_preserved_after_first_shutdown = firstCloseCanvas.byte_identical_to_baseline;
    canvasReport.second_shutdown_bytes_match_first_close = secondCloseCanvas.byte_identical_to_baseline;
    canvasReport.first_close_canvas_bytes = firstCloseCanvas.bytes;
    canvasReport.first_close_canvas_sha256 = firstCloseCanvas.sha256;
    canvasReport.second_close_canvas_bytes = secondCloseCanvas.bytes;
    canvasReport.second_close_canvas_sha256 = secondCloseCanvas.sha256;
    canvasReport.marker_visible_after_reopen = secondView.body.includes(canvasMarker);
    canvasReport.path_visible_after_reopen = secondView.paths.includes(canvasPath);
    canvasReport.target_subpath_content_visible_after_reopen = secondView.body.includes(canvasTargetText);
    canvasReport.created_note_path = canvasNotePath;
    canvasReport.created_note_body_bytes = expectedCreatedNoteBytes.length;
    canvasReport.created_note_body_sha256 = createHash("sha256").update(expectedCreatedNoteBytes).digest("hex");
    canvasReport.created_note_visible_on_first_open = firstCreatedNoteView.paths.includes(canvasNotePath)
      && (firstCreatedNoteView.active_file_path === canvasNotePath || firstCreatedNoteView.active_tree_path === canvasNotePath)
      && firstCreatedNoteView.active_view_is_markdown
      && firstCreatedNoteView.active_view_text.includes(canvasEditedText);
    canvasReport.created_note_visible_after_reopen = secondCreatedNoteView.paths.includes(canvasNotePath)
      && (secondCreatedNoteView.active_file_path === canvasNotePath || secondCreatedNoteView.active_tree_path === canvasNotePath)
      && secondCreatedNoteView.active_view_is_markdown
      && secondCreatedNoteView.active_view_text.includes(canvasEditedText);
    canvasReport.created_note_bytes_unchanged_after_both_shutdowns = firstCloseNote.sha256 === secondCloseNote.sha256
      && firstCloseNote.bytes === secondCloseNote.bytes
      && firstCloseNote.sha256 === createHash("sha256").update(expectedCreatedNoteBytes).digest("hex");
    canvasReport.reopen_vault_changes = allowedReferenceChanges;
    canvasReport.status = "passed";
  } catch (error) {
    canvasReport.status = "failed";
    canvasReport.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await stopProcess(firstProcess, firstConnection).catch(() => undefined);
    await stopProcess(secondProcess, secondConnection).catch(() => undefined);
  }
}

type BasesDirectionViewObservation = {
  requested_file_path: string;
  selection_succeeded: boolean;
  active_file_path: string | null;
  active_view_type: string | null;
  title: string;
  body: string;
  group_order_from_rendered_rows: string[];
  row_order_by_group_from_dom: Record<string, string[]>;
  rendered_file_paths: string[];
  unscoped_fixture_link_paths: string[];
  group_row_candidates: string[];
  table_root_class: string | null;
  visible_group_heading_count: number;
  visible_group_row_candidate_count: number;
  unmapped_group_heading_count: number;
  unmapped_group_row_candidate_count: number;
  unmapped_data_row_candidate_count: number;
  visible_data_row_candidate_count: number;
  visible_bases_row_candidate_count: number;
  table_row_diagnostics: Array<{
    kind: string;
    group_label: string | null;
    file_path: string | null;
    raw_path: string | null;
    has_file_link: boolean;
    source_scope: string;
    in_table: boolean;
    text: string;
    cell_texts: string[];
    class_name: string;
    top: number;
  }>;
  bases_dom_candidates: Array<{tag: string; class_name: string; role: string | null; text: string; top: number}>;
  notices: string[];
  previous_active_file_path: string | null;
  previous_active_view_type: string | null;
  previous_body: string;
  previous_notices: string[];
  state_transition_observed: boolean;
  state_settled: boolean;
  state_samples: BasesDirectionStateSample[];
  screenshot: string;
};

type BasesDirectionGroupCapture = Pick<
  BasesDirectionViewObservation,
  | "group_order_from_rendered_rows"
  | "row_order_by_group_from_dom"
  | "unmapped_group_heading_count"
  | "unmapped_group_row_candidate_count"
  | "unmapped_data_row_candidate_count"
>;

function hasCompleteBasesFixturePathSet(
  state: Pick<BasesDirectionViewObservation, "row_order_by_group_from_dom">,
): boolean {
  const observed = Object.values(state.row_order_by_group_from_dom).flat();
  const expected = new Set(basesDirectionFixturePaths);
  const observedSet = new Set(observed);
  return observed.length === expected.size
    && observedSet.size === expected.size
    && [...expected].every((path) => observedSet.has(path));
}

function hasCompleteBasesGroupCapture(state: BasesDirectionGroupCapture): boolean {
  return state.group_order_from_rendered_rows.length > 0
    && state.group_order_from_rendered_rows.every((group) => {
      const normalized = group.trim().toLowerCase();
      return normalized !== "" && normalized !== "(unparsed group)" && normalized !== "team";
    })
    && state.unmapped_group_heading_count === 0
    && state.unmapped_group_row_candidate_count === 0
    && state.unmapped_data_row_candidate_count === 0
    && hasCompleteBasesFixturePathSet(state);
}

function hasExpectedOmittedGroupDirectionParseError(
  state: BasesDirectionViewObservation | BasesDirectionVisibleState,
  basePath: string,
  viewName: string,
): boolean {
  const expectedMessage = `"groupBy" must be a object in view "${viewName}"`;
  return state.active_file_path === basePath
    && state.active_view_type === "bases"
    && state.body.includes("Unable to parse your base file:")
    && state.body.includes(expectedMessage)
    && state.group_order_from_rendered_rows.length === 0
    && Object.keys(state.row_order_by_group_from_dom).length === 0
    && state.rendered_file_paths.length === 0
    && state.bases_dom_candidates.some((candidate) => candidate.class_name.includes("bases-error")
      && candidate.text.includes(expectedMessage));
}

type BasesDirectionVisibleState = Omit<
  BasesDirectionViewObservation,
  "previous_active_file_path" | "previous_active_view_type" | "previous_body" | "previous_notices" | "state_transition_observed" | "state_settled" | "state_samples" | "screenshot"
>;

type BasesDirectionStateSample = Pick<
  BasesDirectionVisibleState,
  | "active_file_path"
  | "active_view_type"
  | "title"
  | "body"
  | "group_order_from_rendered_rows"
  | "row_order_by_group_from_dom"
  | "rendered_file_paths"
  | "unscoped_fixture_link_paths"
  | "group_row_candidates"
  | "table_root_class"
  | "visible_group_heading_count"
  | "visible_group_row_candidate_count"
  | "unmapped_group_heading_count"
  | "unmapped_group_row_candidate_count"
  | "unmapped_data_row_candidate_count"
  | "visible_data_row_candidate_count"
  | "visible_bases_row_candidate_count"
  | "table_row_diagnostics"
  | "bases_dom_candidates"
  | "notices"
>;

async function verifyBasesDirectionVisible(
  connection: DevToolsConnection,
  direction: "ASC" | "DESC" | "OMITTED" | "SIDEWAYS",
  stage: string,
): Promise<BasesDirectionViewObservation> {
  const basePath = direction === "ASC"
    ? "Ascending.base"
    : direction === "DESC"
      ? "Descending.base"
      : direction === omittedBasesDirection
        ? "Omitted Direction.base"
        : "Invalid Direction.base";
  const label = direction === omittedBasesDirection ? "omitted" : direction;
  const viewName = `C07 group direction ${label}`;
  const unsupportedDirection = direction === invalidBasesDirection;
  const omittedDirection = direction === omittedBasesDirection;
  const fixturePaths = JSON.stringify(basesDirectionFixturePaths);
  const readVisible = async () => await connection.evaluateJson<BasesDirectionVisibleState>(`(() => {
    const fixturePaths = ${fixturePaths};
    const view = window.app?.workspace?.activeLeaf?.view;
    const root = document.querySelector('.workspace-leaf.mod-active') ?? document.body;
    const body = root?.innerText ?? '';
    const tableSelector = '.bases-table, [role="table"], table';
    const tableRoots = root ? [...root.querySelectorAll(tableSelector)] : [];
    const table = tableRoots[0] ?? null;
    const tableForElement = (element) => {
      const owner = element.closest(tableSelector);
      return owner && root.contains(owner) ? owner : null;
    };
    const isInBasesTable = (element) => Boolean(tableForElement(element));
    const isVisibleElement = (element) => {
      const style = window.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0;
    };
    const normalizeText = (text) => text.replace(/\\s+/g, ' ').trim();
    const textOf = (element) => normalizeText(element?.innerText || element?.textContent || '');
    const rowSelector = '.bases-tr, .bases-row, .bases-table-row, tr, [role="row"], li, [role="listitem"]';
    const linkSelector = 'a[data-href], [data-href], a[data-path], [data-path], a.internal-link, .internal-link';
    const classTokensFor = (element) => [...(element.classList || [])].map((name) => name.toLowerCase());
    const hasKnownBasesRowClass = (element) => classTokensFor(element)
      .some((name) => ['bases-tr', 'bases-row', 'bases-table-row'].includes(name));
    const hasBasesGroupHeadingClass = (element) => classTokensFor(element)
      .some((name) => ['bases-group-heading', 'bases-group-header'].includes(name));
    const hasBasesGroupRowClass = (element) => classTokensFor(element).includes('bases-group-row');
    const hasKnownBasesGroupClass = (element) => hasBasesGroupHeadingClass(element) || hasBasesGroupRowClass(element);
    const hasKnownBasesHeaderClass = (element) => classTokensFor(element).some((name) => name.startsWith('bases-')
      && !name.startsWith('bases-group-')
      && (name.includes('header') || name.includes('thead') || name === 'bases-th' || name.includes('column-header')));
    const pathByDisplayName = new Map(fixturePaths.flatMap((path) => {
      const filename = path.split('/').at(-1) || path;
      const withoutExtension = filename.replace(/\\.(?:md|base)$/i, '');
      return [[filename.toLowerCase(), path], [withoutExtension.toLowerCase(), path]];
    }));
    const normalizePath = (path) => path.trim()
      .split(String.fromCharCode(92)).join('/')
      .split('/')
      .filter((part) => part && part !== '.')
      .join('/');
    const fixturePathFor = (rawPath, linkText) => {
      for (const candidate of [rawPath, linkText]) {
        if (!candidate) continue;
        const normalized = normalizePath(candidate);
        const exactPath = fixturePaths.find((path) => path.toLowerCase() === normalized.toLowerCase());
        if (exactPath) return exactPath;
        const basename = normalized.split('/').at(-1) || '';
        const lowerBasename = basename.toLowerCase();
        const withoutExtension = lowerBasename.endsWith('.md')
          ? lowerBasename.slice(0, -3)
          : lowerBasename.endsWith('.base')
            ? lowerBasename.slice(0, -5)
            : lowerBasename;
        const alias = pathByDisplayName.get(lowerBasename) || pathByDisplayName.get(withoutExtension);
        if (alias) return alias;
      }
      return null;
    };
    const visibleLinksFor = (element) => [...new Set([
      ...(element.matches?.(linkSelector) ? [element] : []),
      ...element.querySelectorAll(linkSelector),
    ])].filter(isVisibleElement);
    const linkPathFor = (link) => fixturePathFor(
      link.getAttribute('data-href') || link.getAttribute('data-path') || null,
      textOf(link),
    );
    const isExcludedRegion = (element) => Boolean(element.closest('.view-header, header, .bases-toolbar, [role="toolbar"], [role="alert"], .notice, .modal-container'));
    const visibleRootRows = root
      ? [...root.querySelectorAll(rowSelector)].filter((row) => isVisibleElement(row) && !isExcludedRegion(row))
      : [];
    const rawRows = tableRoots.length === 0
      ? visibleRootRows
      : [...new Set(tableRoots.flatMap((tableRoot) => [...tableRoot.querySelectorAll(rowSelector)]))]
        .filter((row) => isVisibleElement(row) && !isExcludedRegion(row));
    const hasNestedRowCandidate = (row) => visibleRootRows.some((candidate) => candidate !== row && row.contains(candidate));
    const rowOwnerFor = (element) => {
      const owner = element.closest(rowSelector);
      return owner && root.contains(owner) ? owner : null;
    };
    const visibleGroupClassElements = root
      ? [...root.querySelectorAll('[class]')].filter((element) => isVisibleElement(element)
        && !isExcludedRegion(element)
        && hasKnownBasesGroupClass(element))
      : [];
    const visibleGroupMarkers = visibleGroupClassElements.filter((element) => {
      const nestedGroupMarker = visibleGroupClassElements.some((candidate) => candidate !== element
        && element.contains(candidate));
      if (hasBasesGroupHeadingClass(element)) return !nestedGroupMarker;
      return hasBasesGroupRowClass(element) && !nestedGroupMarker;
    });
    const visibleDataCellsFor = (row) => [...row.querySelectorAll('.bases-td, td, [role="cell"], [role="gridcell"]')]
      .filter((cell) => cell.closest(rowSelector) === row
        && isVisibleElement(cell)
        && cell.tagName.toLowerCase() !== 'th'
        && cell.getAttribute('role') !== 'columnheader');
    const cellTextsFor = (row) => {
      const semanticCells = [...row.querySelectorAll('.bases-td, td, [role="cell"], [role="gridcell"]')]
        .filter((cell) => cell.closest(rowSelector) === row && isVisibleElement(cell));
      const cells = semanticCells.length > 0
        ? semanticCells
        : [...row.children].filter(isVisibleElement);
      return cells.map(textOf).filter(Boolean);
    };
    const hasTeamGroupLabel = (row) => {
      const cellTexts = cellTextsFor(row);
      if (cellTexts.some((text) => /\\bteam\\s+\\S+/i.test(text))) return true;
      return cellTexts.some((text, index) => text.toLowerCase() === 'team' && Boolean(cellTexts[index + 1]));
    };
    const isHeaderOnlyRow = (row) => {
      if (row.closest('thead') || row.getAttribute('role') === 'columnheader' || hasKnownBasesHeaderClass(row)) return true;
      const cells = [...row.querySelectorAll('th, td, [role="columnheader"], [role="cell"], [role="gridcell"]')]
        .filter((cell) => cell.closest(rowSelector) === row && isVisibleElement(cell));
      return cells.length > 0 && cells.every((cell) => cell.tagName.toLowerCase() === 'th'
        || cell.getAttribute('role') === 'columnheader');
    };
    const groupRowCandidateElements = new Set(visibleGroupMarkers.map((marker) => rowOwnerFor(marker) || marker));
    for (const row of visibleRootRows) {
      const hasFileLink = visibleLinksFor(row).length > 0;
      const hasFilePathText = cellTextsFor(row).some((text) => fixturePathFor(null, text));
      const looksLikeGroupRow = !hasFileLink && !hasFilePathText && hasTeamGroupLabel(row);
      const isStructuralHeader = row.closest('thead')
        || row.getAttribute('role') === 'columnheader'
        || hasKnownBasesHeaderClass(row);
      if (!groupRowCandidateElements.has(row)
        && !hasNestedRowCandidate(row)
        && !isStructuralHeader
        && looksLikeGroupRow) {
        groupRowCandidateElements.add(row);
      }
    }
    const dataRowCandidateElements = new Set(rawRows.filter((row) => {
      if (isHeaderOnlyRow(row) || groupRowCandidateElements.has(row)) return false;
      if (hasNestedRowCandidate(row)) return false;
      const hasFixtureLink = visibleLinksFor(row).some((link) => linkPathFor(link));
      const hasVisibleDataCell = visibleDataCellsFor(row).length > 0;
      return hasKnownBasesRowClass(row)
        || (isInBasesTable(row) && hasVisibleDataCell)
        || hasFixtureLink;
    }));
    const visibleFixtureLinks = root
      ? [...root.querySelectorAll(linkSelector)].filter((link) => isVisibleElement(link)
        && !isExcludedRegion(link)
        && linkPathFor(link))
      : [];
    const unscopedFixtureLinkPaths = visibleFixtureLinks.filter((link) => {
      if ([...dataRowCandidateElements, ...groupRowCandidateElements].some((row) => row === link || row.contains(link))) return false;
      const owner = rowOwnerFor(link);
      const inTable = isInBasesTable(link);
      const hasExplicitRowOwner = Boolean(owner && (hasKnownBasesRowClass(owner)
        || owner.matches('tr, [role="row"], li, [role="listitem"]')));
      return !inTable && !hasExplicitRowOwner;
    }).map(linkPathFor).filter(Boolean);
    for (const link of visibleFixtureLinks) {
      if ([...dataRowCandidateElements, ...groupRowCandidateElements].some((row) => row === link || row.contains(link))) continue;
      const owner = rowOwnerFor(link);
      if (owner && isHeaderOnlyRow(owner)) continue;
      const inTable = isInBasesTable(link);
      const hasExplicitRowOwner = Boolean(owner && (hasKnownBasesRowClass(owner)
        || owner.matches('tr, [role="row"], li, [role="listitem"]')));
      const inExcludedRegion = isExcludedRegion(link);
      if (inExcludedRegion || (!inTable && !hasExplicitRowOwner)) continue;
      dataRowCandidateElements.add(owner || link);
    }
    const tableRows = [...new Set([...groupRowCandidateElements, ...dataRowCandidateElements])];
    const groupLabelFor = (row, cellTexts, heading) => {
      const candidates = [textOf(heading), ...cellTexts, textOf(row)]
        .filter(Boolean);
      for (const candidate of candidates) {
        const parts = candidate.split(/\\s+/).filter(Boolean);
        const keyIndex = parts.findIndex((part) => part.toLowerCase() === 'team');
        if (keyIndex >= 0 && parts[keyIndex + 1]) return parts.slice(keyIndex + 1).join(' ');
      }
      for (let index = 0; index < cellTexts.length - 1; index += 1) {
        if (cellTexts[index].toLowerCase() === 'team') return cellTexts[index + 1];
      }
      return textOf(heading) || null;
    };
    const rowRecords = tableRows.map((element, index) => {
      const bounds = element.getBoundingClientRect();
      const cellTexts = cellTextsFor(element);
      const heading = hasKnownBasesGroupClass(element)
        ? element
        : [...element.querySelectorAll('[class]')].find(hasKnownBasesGroupClass) || null;
      const groupLabel = groupLabelFor(element, cellTexts, heading);
      const isGroup = groupRowCandidateElements.has(element);
      const links = visibleLinksFor(element);
      const resolvedPaths = [...new Set(links.map(linkPathFor).filter(Boolean))];
      const textPath = cellTexts.map((text) => fixturePathFor(null, text)).find(Boolean) || null;
      const filePath = isGroup
        ? null
        : resolvedPaths.length === 1
          ? resolvedPaths[0]
          : (hasKnownBasesRowClass(element) || isInBasesTable(element)) && resolvedPaths.length === 0
            ? textPath
            : null;
      const link = links[0] || (element.matches?.(linkSelector) ? element : null);
      const rawPath = link?.getAttribute('data-href')
        || link?.getAttribute('data-path')
        || null;
      const inTable = isInBasesTable(element);
      return {
        element,
        index,
        kind: isGroup ? 'group' : dataRowCandidateElements.has(element) && filePath ? 'file' : 'other',
        group_label: isGroup ? groupLabel : null,
        file_path: isGroup || !dataRowCandidateElements.has(element) ? null : filePath,
        raw_path: rawPath,
        has_file_link: links.length > 0,
        source_scope: inTable
          ? 'table'
          : (hasKnownBasesRowClass(element) || element.matches('tr, [role="row"], li, [role="listitem"]') ? 'explicit-row' : 'table-link'),
        in_table: inTable,
        text: textOf(element),
        cell_texts: cellTexts,
        class_name: element.getAttribute('class') || '',
        top: bounds.top,
      };
    }).sort((left, right) => left.top - right.top || left.index - right.index);
    const isParsedGroupLabel = (label) => Boolean(label && label.trim()
      && label.toLowerCase() !== 'team'
      && label !== '(unparsed group)');
    const mappedGroupHeadingRows = new Set();
    const unmappedGroupHeadingCount = visibleGroupMarkers.filter((headingElement) => {
      const matches = rowRecords.filter((row) => (row.element === headingElement || row.element.contains(headingElement))
        && row.kind === 'group'
        && isParsedGroupLabel(row.group_label));
      if (matches.length !== 1 || mappedGroupHeadingRows.has(matches[0]?.element)) return true;
      mappedGroupHeadingRows.add(matches[0].element);
      return false;
    }).length;
    const unmappedGroupRowCandidateCount = [...groupRowCandidateElements].filter((candidate) => {
      const matches = rowRecords.filter((row) => row.element === candidate
        && row.kind === 'group'
        && isParsedGroupLabel(row.group_label));
      return matches.length !== 1;
    }).length;
    const unmappedDataRowCandidateCount = [...dataRowCandidateElements].filter((candidate) => {
      const matches = rowRecords.filter((row) => row.element === candidate
        && row.kind === 'file'
        && Boolean(row.file_path));
      return matches.length !== 1;
    }).length;
    const groupOrder = [];
    const rowOrderByGroup = {};
    const renderedFilePaths = [];
    let activeGroup = null;
    for (const row of rowRecords) {
      if (row.kind === 'group') {
        activeGroup = row.group_label || '(unparsed group)';
        groupOrder.push(activeGroup);
        rowOrderByGroup[activeGroup] = rowOrderByGroup[activeGroup] || [];
      } else if (row.kind === 'file' && row.file_path) {
        renderedFilePaths.push(row.file_path);
        if (activeGroup && (table === null || row.in_table)) {
          rowOrderByGroup[activeGroup].push(row.file_path);
        } else if (!row.in_table) {
          activeGroup = null;
        }
      }
    }
    const visibleBasesDomElements = [...(root?.querySelectorAll('[class*="bases"], [role="table"], [role="row"], table, tr') || [])]
      .filter(isVisibleElement);
    const visibleBasesRowCandidateCount = groupRowCandidateElements.size + dataRowCandidateElements.size;
    const basesDomCandidates = visibleBasesDomElements
      .slice(0, 80)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        class_name: element.getAttribute('class') || '',
        role: element.getAttribute('role') || null,
        text: textOf(element).slice(0, 160),
        top: element.getBoundingClientRect().top,
      }));
    const notices = [...new Set([...document.querySelectorAll('.notice, .modal-container, [role="alert"]')]
      .map((element) => (element.innerText || element.textContent || '').trim())
      .filter(Boolean))];
    return {
      requested_file_path: ${JSON.stringify(basePath)},
      selection_succeeded: view?.file?.path === ${JSON.stringify(basePath)},
      active_file_path: view?.file?.path ?? null,
      active_view_type: view?.getViewType?.() ?? null,
      title: document.title,
      body,
      group_order_from_rendered_rows: groupOrder,
      row_order_by_group_from_dom: rowOrderByGroup,
      rendered_file_paths: renderedFilePaths,
      unscoped_fixture_link_paths: unscopedFixtureLinkPaths,
      group_row_candidates: groupOrder,
      table_root_class: table?.getAttribute('class') || null,
      visible_group_heading_count: visibleGroupMarkers.length,
      visible_group_row_candidate_count: groupRowCandidateElements.size,
      unmapped_group_heading_count: unmappedGroupHeadingCount,
      unmapped_group_row_candidate_count: unmappedGroupRowCandidateCount,
      unmapped_data_row_candidate_count: unmappedDataRowCandidateCount,
      visible_data_row_candidate_count: dataRowCandidateElements.size,
      visible_bases_row_candidate_count: visibleBasesRowCandidateCount,
      table_row_diagnostics: rowRecords.map(({kind, group_label, file_path, raw_path, has_file_link, source_scope, in_table, text, cell_texts, class_name, top}) => ({
        kind, group_label, file_path, raw_path, has_file_link, source_scope, in_table, text, cell_texts, class_name, top,
      })),
      bases_dom_candidates: basesDomCandidates,
      notices,
    };
  })()`);

  let beforeSelection: BasesDirectionVisibleState = {
    requested_file_path: basePath,
    selection_succeeded: false,
    active_file_path: null,
    active_view_type: null,
    title: "",
    body: "",
    group_order_from_rendered_rows: [],
    row_order_by_group_from_dom: {},
    rendered_file_paths: [],
    unscoped_fixture_link_paths: [],
    group_row_candidates: [],
    table_root_class: null,
    visible_group_heading_count: 0,
    visible_group_row_candidate_count: 0,
    unmapped_group_heading_count: 0,
    unmapped_group_row_candidate_count: 0,
    visible_bases_row_candidate_count: 0,
    unmapped_data_row_candidate_count: 0,
    visible_data_row_candidate_count: 0,
    table_row_diagnostics: [],
    bases_dom_candidates: [],
    notices: [],
  };
  let visible: BasesDirectionVisibleState = beforeSelection;
  let stateTransitionObserved = false;
  let stateSettled = false;
  const stateSamples: BasesDirectionStateSample[] = [];
  const recordStateSample = (state: BasesDirectionVisibleState) => {
    const sample: BasesDirectionStateSample = {
      active_file_path: state.active_file_path,
      active_view_type: state.active_view_type,
      title: state.title,
      body: state.body.slice(0, 6_000),
      group_order_from_rendered_rows: state.group_order_from_rendered_rows,
      row_order_by_group_from_dom: state.row_order_by_group_from_dom,
      rendered_file_paths: state.rendered_file_paths,
      unscoped_fixture_link_paths: state.unscoped_fixture_link_paths,
      group_row_candidates: state.group_row_candidates,
      table_root_class: state.table_root_class,
      visible_group_heading_count: state.visible_group_heading_count,
      visible_group_row_candidate_count: state.visible_group_row_candidate_count,
      unmapped_group_heading_count: state.unmapped_group_heading_count,
      unmapped_group_row_candidate_count: state.unmapped_group_row_candidate_count,
      visible_bases_row_candidate_count: state.visible_bases_row_candidate_count,
      unmapped_data_row_candidate_count: state.unmapped_data_row_candidate_count,
      visible_data_row_candidate_count: state.visible_data_row_candidate_count,
      table_row_diagnostics: state.table_row_diagnostics,
      bases_dom_candidates: state.bases_dom_candidates,
      notices: state.notices,
    };
    if (stateSamples.length === 0 || !isDeepStrictEqual(stateSamples[stateSamples.length - 1], sample)) {
      stateSamples.push(sample);
    }
  };
  const persistProbeFailure = async (state: BasesDirectionVisibleState, error: unknown): Promise<void> => {
    const screenshot = `obsidian-bases-${direction.toLowerCase()}-${stage}-failure.png`;
    let screenshotError: string | undefined;
    try {
      await captureObsidianScreenshot(connection, screenshot);
    } catch (captureError) {
      screenshotError = captureError instanceof Error ? captureError.message : String(captureError);
    }
    const failureObservation: BasesDirectionViewObservation & {probe_error: string; screenshot_error?: string} = {
      ...state,
      body: state.body.slice(0, 6_000),
      previous_active_file_path: beforeSelection.active_file_path,
      previous_active_view_type: beforeSelection.active_view_type,
      previous_body: beforeSelection.body.slice(0, 6_000),
      previous_notices: beforeSelection.notices,
      state_transition_observed: state.active_file_path !== beforeSelection.active_file_path
        || state.active_view_type !== beforeSelection.active_view_type
        || state.title !== beforeSelection.title
        || state.body !== beforeSelection.body
        || !isDeepStrictEqual(state.notices, beforeSelection.notices),
      state_settled: stateSettled,
      state_samples: stateSamples,
      screenshot,
      probe_error: error instanceof Error ? error.message : String(error),
      ...(screenshotError ? {screenshot_error: screenshotError} : {}),
    };
    const basesReport = report.bases_group_direction_reference as Record<string, unknown>;
    const observationKey = unsupportedDirection
      ? stage === "first-open"
        ? "invalid_direction_observation_on_first_open"
        : "invalid_direction_observation_after_reopen"
      : `${stage.replaceAll(/[^a-z0-9]+/gi, "_")}_${direction.toLowerCase()}_failure_observation`;
    basesReport[observationKey] = failureObservation;
    if (unsupportedDirection) {
      basesReport.invalid_direction_probe_error = error instanceof Error ? error.message : String(error);
    }
    await saveReport();
  };
  try {
    beforeSelection = await readVisible();
    visible = beforeSelection;
    const visiblePaths = await waitFor(
      `${stage}: Obsidian to list ${basePath}`,
      async () => await connection.evaluateJson<string[]>(`[...document.querySelectorAll('[data-path]')].map((element) => element.getAttribute('data-path') || '')`),
      (paths) => paths.includes(basePath),
      45_000,
    );
    if (!visiblePaths.includes(basePath)) throw new Error(`${stage}: Obsidian did not list ${basePath}`);
    beforeSelection = await readVisible();
    visible = beforeSelection;
    const clicked = await connection.evaluateJson<boolean>(`(() => {
      const target = [...document.querySelectorAll('[data-path]')]
        .find((element) => element.getAttribute('data-path') === ${JSON.stringify(basePath)});
      target?.click();
      return Boolean(target);
    })()`);
    if (!clicked) throw new Error(`${stage}: Obsidian did not expose ${basePath} for selection`);
  } catch (error) {
    const lastState = await readVisible().catch(() => visible);
    recordStateSample(lastState);
    await persistProbeFailure(lastState, error);
    throw error;
  }
  if (unsupportedDirection || omittedDirection) {
    try {
      visible = beforeSelection;
      let stableFingerprint = JSON.stringify(visible);
      let stableSamples = 0;
      const settleDeadline = Date.now() + 45_000;
      const noTransitionDeadline = Date.now() + 8_000;
      while (Date.now() < settleDeadline) {
        await delay(500);
        const next = await readVisible();
        recordStateSample(next);
        const nextFingerprint = JSON.stringify(next);
        if (nextFingerprint === stableFingerprint) {
          stableSamples += 1;
        } else {
          stableFingerprint = nextFingerprint;
          stableSamples = 0;
        }
        visible = next;
        const targetSelected = next.active_file_path === basePath;
        const expectedOmittedParseError = omittedDirection
          && hasExpectedOmittedGroupDirectionParseError(next, basePath, viewName);
        const visibleStateChanged = next.active_file_path !== beforeSelection.active_file_path
          || next.active_view_type !== beforeSelection.active_view_type
          || next.title !== beforeSelection.title
          || next.body !== beforeSelection.body
          || !isDeepStrictEqual(next.notices, beforeSelection.notices);
        const isReady = omittedDirection
          ? expectedOmittedParseError
          : targetSelected || visibleStateChanged || Date.now() >= noTransitionDeadline;
        if (stableSamples >= 3 && isReady) {
          break;
        }
      }
      stateTransitionObserved = visible.active_file_path !== beforeSelection.active_file_path
        || visible.active_view_type !== beforeSelection.active_view_type
        || visible.title !== beforeSelection.title
        || visible.body !== beforeSelection.body
        || !isDeepStrictEqual(visible.notices, beforeSelection.notices);
      stateSettled = stableSamples >= 3;
      if (omittedDirection && !stateSettled) {
        throw new Error(`${stage}: omitted-direction parse error did not settle; samples=${JSON.stringify(stateSamples).slice(0, 8_000)}`);
      }
      if (omittedDirection && !hasExpectedOmittedGroupDirectionParseError(visible, basePath, viewName)) {
        throw new Error(`${stage}: Obsidian did not show the pinned omitted-direction groupBy parse error for the selected ${basePath}; state=${JSON.stringify(visible).slice(0, 8_000)}`);
      }
      // SIDEWAYS is a capture-only probe: preserve partial or empty fallback
      // observations without imposing the supported directions' full fixture set.
      if (visible.unmapped_group_heading_count > 0
        || visible.unmapped_group_row_candidate_count > 0
        || visible.unmapped_data_row_candidate_count > 0) {
        throw new Error(`${stage}: invalid-direction view exposed group or file rows that did not map one-to-one to rendered records; state=${JSON.stringify(visible).slice(0, 8_000)}`);
      }
    } catch (error) {
      const afterSelection = await readVisible().catch(() => visible);
      recordStateSample(afterSelection);
      await persistProbeFailure(afterSelection, error);
      throw error;
    }
  } else {
    visible = beforeSelection;
    try {
      let viewReady = false;
      const viewDeadline = Date.now() + 45_000;
      while (Date.now() < viewDeadline) {
        visible = await readVisible();
        recordStateSample(visible);
        viewReady = visible.active_file_path === basePath
          && visible.active_view_type === "bases"
          && visible.body.includes(viewName)
          && hasCompleteBasesGroupCapture(visible);
        if (viewReady) break;
        await delay(500);
      }
      if (!viewReady) {
        throw new Error(`${stage}: Obsidian did not expose the ${direction} Bases view; last state=${JSON.stringify(visible).slice(0, 8_000)}`);
      }
      let stableFingerprint = JSON.stringify(visible);
      let stableSamples = 0;
      const settleDeadline = Date.now() + 45_000;
      while (Date.now() < settleDeadline && stableSamples < 3) {
        await delay(500);
        const next = await readVisible();
        recordStateSample(next);
        const nextFingerprint = JSON.stringify(next);
        if (nextFingerprint === stableFingerprint) {
          stableSamples += 1;
        } else {
          stableFingerprint = nextFingerprint;
          stableSamples = 0;
        }
        visible = next;
      }
      stateTransitionObserved = visible.active_file_path !== beforeSelection.active_file_path
        || visible.active_view_type !== beforeSelection.active_view_type
        || visible.title !== beforeSelection.title
        || visible.body !== beforeSelection.body
        || !isDeepStrictEqual(visible.notices, beforeSelection.notices);
      stateSettled = stableSamples >= 3;
      if (!stateSettled) {
        throw new Error(`${stage}: ${direction} Bases view did not settle; samples=${JSON.stringify(stateSamples).slice(0, 8_000)}`);
      }
      if (!hasCompleteBasesGroupCapture(visible)) {
        throw new Error(`${stage}: settled ${direction} Bases view lost complete group or fixture-path capture; state=${JSON.stringify(visible).slice(0, 8_000)}`);
      }
      if (visible.active_file_path !== basePath || visible.active_view_type !== "bases") {
        throw new Error(`${stage}: ${basePath} did not open as a Bases view: ${JSON.stringify({path: visible.active_file_path, type: visible.active_view_type})}`);
      }
    } catch (error) {
      const lastState = await readVisible().catch(() => visible);
      recordStateSample(lastState);
      await persistProbeFailure(lastState, error);
      throw error;
    }
  }
  if (!unsupportedDirection && (visible.active_file_path !== basePath || visible.active_view_type !== "bases")) {
    throw new Error(`${stage}: ${basePath} did not open as a Bases view: ${JSON.stringify({path: visible.active_file_path, type: visible.active_view_type})}`);
  }
  if (!unsupportedDirection && !omittedDirection && (visible.active_view_type !== "bases" || !visible.body.includes(viewName))) {
    throw new Error(`${stage}: Obsidian did not render the ${direction} Bases view: ${JSON.stringify({path: visible.active_file_path, type: visible.active_view_type, body: visible.body.slice(0, 3_000)})}`);
  }
  const screenshot = `obsidian-bases-${direction.toLowerCase()}-${stage}.png`;
  await captureObsidianScreenshot(connection, screenshot);
  return {
    ...visible,
    body: visible.body.slice(0, 6_000),
    previous_active_file_path: beforeSelection.active_file_path,
    previous_active_view_type: beforeSelection.active_view_type,
    previous_body: beforeSelection.body.slice(0, 6_000),
    previous_notices: beforeSelection.notices,
    state_transition_observed: stateTransitionObserved,
    state_settled: stateSettled,
    state_samples: stateSamples,
    screenshot,
  };
}

async function runBasesDirectionReferenceProbe(): Promise<void> {
  const profileDirectory = join(workDirectory, "bases-direction-obsidian-profile");
  const basesReport = report.bases_group_direction_reference as Record<string, unknown>;
  const snapshots = report.vault_snapshots as Record<string, unknown>;
  basesReport.status = "running";
  let firstProcess: ChildProcess | undefined;
  let firstConnection: DevToolsConnection | undefined;
  let secondProcess: ChildProcess | undefined;
  let secondConnection: DevToolsConnection | undefined;
  let sourceHashes: Record<string, {bytes: number; sha256: string}> | undefined;
  let reopenSeedSnapshot: SnapshotEntry[] | undefined;
  const readActiveBasesWorkspaceView = async (connection: DevToolsConnection) => await connection.evaluateJson<{
    active_file_path: string | null;
    active_view_type: string | null;
    title: string;
    body: string;
  }>(`(() => {
    const view = window.app?.workspace?.activeLeaf?.view;
    const root = document.querySelector('.workspace-leaf.mod-active') ?? document.body;
    return {
      active_file_path: view?.file?.path ?? null,
      active_view_type: view?.getViewType?.() ?? null,
      title: document.title,
      body: (root?.innerText ?? '').slice(0, 6_000),
    };
  })()`);
  try {
    sourceHashes = await createBasesDirectionFixture();
    basesReport.source_rewrite_observations = [];
    basesReport.reference_app_source_preservation_passed = null;
    const checkReferenceSourceHashes = async (
      stage: string,
      session: "first_open" | "reopen",
    ): Promise<Record<string, {bytes: number; sha256: string}>> => {
      const capturedBytes: Record<string, Buffer> = {};
      const unexpectedMismatches: string[] = [];
      const observed = await assertBasesDirectionSourceHashes(sourceHashes!, stage, true, capturedBytes, unexpectedMismatches);
      const invalidDirectionHash = observed["Invalid Direction.base"];
      const invalidDirectionBytes = capturedBytes["Invalid Direction.base"];
      if (invalidDirectionHash && invalidDirectionBytes) {
        await recordBasesDirectionReferenceRewrite(
          sourceHashes!,
          observed,
          invalidDirectionBytes,
          session,
          stage,
        );
      }
      if (unexpectedMismatches.length > 0) throw new Error(unexpectedMismatches.join("; "));
      return observed;
    };
    const seedSnapshot = await snapshotTree(basesVaultRoot);
    snapshots.bases_direction_seed = seedSnapshot;
    basesReport.first_open_source_hashes = await assertBasesDirectionSourceHashes(sourceHashes, "before-first-open");
    await saveReport();

    firstProcess = await createObsidianProfile(profileDirectory, 9226, "obsidian-bases-direction-first-open.log");
    const first = await connectObsidian(9226);
    firstConnection = first.connection;
    const firstSession: Record<string, unknown> = {
      devtools_browser: first.browserVersion,
      first_target: {title: first.target.title ?? "", url: first.target.url ?? ""},
      source_hashes_before_open: sourceHashes,
    };
    basesReport.first_session = firstSession;
    const firstRunBody = await waitForRenderer(
      firstConnection,
      "document.body?.innerText ?? ''",
      (body) => body.includes("Open folder as vault"),
      "Obsidian's first-run C07 Bases reference vault screen",
    );
    firstSession.first_run_text = firstRunBody.slice(0, 2_000);
    await captureObsidianScreenshot(firstConnection, "obsidian-bases-direction-first-run.png");
    firstConnection = await chooseVaultDirectory(firstConnection, 9226, firstProcess!, {
      targetRoot: basesVaultRoot,
      reporter: basesReport,
      screenshotPrefix: "obsidian-bases-direction",
    });
    await chooseRestrictedMode(firstConnection, firstSession, basesVaultName, "Synthetic C07 group-direction fixture.");

    const firstViews: Record<string, BasesDirectionViewObservation> = {};
    const firstViewSourceHashes: Record<string, Record<string, {bytes: number; sha256: string}>> = {};
    firstSession.views = firstViews;
    firstSession.source_hashes_after_each_view = firstViewSourceHashes;
    for (const direction of ["ASC", "DESC", omittedBasesDirection, invalidBasesDirection] as const) {
      firstViews[direction] = await verifyBasesDirectionVisible(firstConnection, direction, `first-open`);
      await saveReport();
      firstViewSourceHashes[direction] = await checkReferenceSourceHashes(
        `first-open-${direction.toLowerCase()}`,
        "first_open",
      );
      await saveReport();
    }
    firstSession.source_hashes_after_views = await checkReferenceSourceHashes("first-open-before-shutdown", "first_open");
    firstSession.workspace_reset_before_shutdown = await verifyBasesDirectionVisible(
      firstConnection,
      "ASC",
      "first-open-shutdown-restore",
    );
    const firstResetHashes = await checkReferenceSourceHashes("first-open-after-shutdown-restore", "first_open");
    firstSession.source_hashes_after_workspace_reset = firstResetHashes;
    await saveReport();
    await delay(2_000);
    await stopProcess(firstProcess, firstConnection);
    firstProcess = undefined;
    firstConnection = undefined;

    const afterFirstClose = await snapshotTree(basesVaultRoot);
    snapshots.bases_direction_after_first_close = afterFirstClose;
    const firstCloseHashes = await checkReferenceSourceHashes("first-shutdown", "first_open");
    const firstCloseRewriteObserved = firstCloseHashes["Invalid Direction.base"].sha256
      === normalizedInvalidBasesDirectionSha256;
    const firstCloseChanges = changedPaths(seedSnapshot, afterFirstClose);
    const firstCloseUnexpectedChanges = firstCloseChanges.filter((change) => {
      if (workspaceStateAllowlist.includes(change.path)) return false;
      const isRecordedReferenceRewrite = firstCloseRewriteObserved
        && change.path === "Invalid Direction.base"
        && change.after?.bytes === normalizedInvalidBasesDirection.length
        && change.after?.sha256 === normalizedInvalidBasesDirectionSha256;
      return !isRecordedReferenceRewrite;
    });
    if (firstCloseUnexpectedChanges.length > 0) {
      throw new Error(`C07 Bases first open changed unapproved vault content: ${JSON.stringify(firstCloseUnexpectedChanges).slice(0, 6_000)}`);
    }
    snapshots.bases_direction_first_open_changes = firstCloseChanges;
    basesReport.first_shutdown_source_hashes = firstCloseHashes;
    firstSession.vault_changes_during_obsidian_session = firstCloseChanges;
    await saveReport();

    const invalidDirectionSeedPath = join(reportDirectory, "bases-direction-Invalid Direction-base.seed");
    const invalidDirectionSeedBytes = await readFile(invalidDirectionSeedPath);
    const invalidDirectionBeforeReseed = firstCloseHashes["Invalid Direction.base"];
    const reseededInvalidDirection = invalidDirectionBeforeReseed.bytes !== sourceHashes["Invalid Direction.base"].bytes
      || invalidDirectionBeforeReseed.sha256 !== sourceHashes["Invalid Direction.base"].sha256;
    if (reseededInvalidDirection) {
      await writeFile(join(basesVaultRoot, "Invalid Direction.base"), invalidDirectionSeedBytes);
    }
    const sourceHashesBeforeReopen = await assertBasesDirectionSourceHashes(
      sourceHashes,
      "before-reopen-after-reference-fixture-reseed",
    );
    basesReport.source_reseed_before_reopen = {
      performed_by_probe: reseededInvalidDirection,
      reason: "Restore the synthetic unsupported-direction seed after recording Obsidian's exact reference rewrite so the reopened observation reads the original test input.",
      path: "Invalid Direction.base",
      before: invalidDirectionBeforeReseed,
      after: sourceHashesBeforeReopen["Invalid Direction.base"],
      seed_artifact: "bases-direction-Invalid Direction-base.seed",
    };
    reopenSeedSnapshot = await snapshotTree(basesVaultRoot);
    snapshots.bases_direction_reopen_seed = reopenSeedSnapshot;
    await saveReport();

    secondProcess = await createObsidianProfile(profileDirectory, 9227, "obsidian-bases-direction-reopen.log");
    const second = await connectObsidian(9227);
    secondConnection = second.connection;
    const secondSession: Record<string, unknown> = {
      devtools_browser: second.browserVersion,
      first_target: {title: second.target.title ?? "", url: second.target.url ?? ""},
      source_hashes_before_reopen: sourceHashesBeforeReopen,
      reopened_fixture_seed_snapshot: reopenSeedSnapshot,
    };
    basesReport.second_session = secondSession;
    await chooseRestrictedMode(secondConnection, secondSession, basesVaultName, "Synthetic C07 group-direction fixture.");
    secondSession.workspace_view_immediately_after_startup = await readActiveBasesWorkspaceView(secondConnection);
    const workspaceStartupScreenshot = "obsidian-bases-direction-workspace-startup-state.png";
    secondSession.workspace_startup_screenshot = workspaceStartupScreenshot;
    await captureObsidianScreenshot(secondConnection, workspaceStartupScreenshot);
    await saveReport();
    secondSession.source_hashes_immediately_after_startup = await checkReferenceSourceHashes(
      "reopen-workspace-immediately-after-startup",
      "reopen",
    );
    await saveReport();
    const restoredWorkspaceView = await waitFor(
      "R2.8.106: Obsidian to restore the supported ASC view before reopened capture",
      async () => await readActiveBasesWorkspaceView(secondConnection),
      (state) => state.active_file_path === "Ascending.base" && state.active_view_type === "bases",
      45_000,
    );
    secondSession.workspace_restored_view_at_startup = restoredWorkspaceView;
    const supportedRestoreScreenshot = "obsidian-bases-direction-supported-view-restored.png";
    secondSession.workspace_restore_screenshot = supportedRestoreScreenshot;
    await captureObsidianScreenshot(secondConnection, supportedRestoreScreenshot);
    secondSession.source_hashes_after_workspace_restore = await checkReferenceSourceHashes("reopen-workspace-restore", "reopen");
    await saveReport();

    const reopenedViews: Record<string, BasesDirectionViewObservation> = {};
    const reopenedViewSourceHashes: Record<string, Record<string, {bytes: number; sha256: string}>> = {};
    secondSession.views = reopenedViews;
    secondSession.source_hashes_after_each_view = reopenedViewSourceHashes;
    for (const direction of ["ASC", "DESC", omittedBasesDirection, invalidBasesDirection] as const) {
      reopenedViews[direction] = await verifyBasesDirectionVisible(secondConnection, direction, `reopen`);
      await saveReport();
      reopenedViewSourceHashes[direction] = await checkReferenceSourceHashes(
        `reopen-${direction.toLowerCase()}`,
        "reopen",
      );
      await saveReport();
    }
    secondSession.source_hashes_after_views = await checkReferenceSourceHashes("reopen-before-shutdown", "reopen");
    secondSession.workspace_reset_before_shutdown = await verifyBasesDirectionVisible(
      secondConnection,
      "ASC",
      "reopen-shutdown-restore",
    );
    const secondResetHashes = await checkReferenceSourceHashes("reopen-after-shutdown-restore", "reopen");
    secondSession.source_hashes_after_workspace_reset = secondResetHashes;
    await saveReport();
    await delay(2_000);
    await stopProcess(secondProcess, secondConnection);
    secondProcess = undefined;
    secondConnection = undefined;

    const afterSecondClose = await snapshotTree(basesVaultRoot);
    snapshots.bases_direction_after_reopen = afterSecondClose;
    const secondCloseHashes = await checkReferenceSourceHashes("reopen-shutdown", "reopen");
    const reopenChanges = changedPaths(reopenSeedSnapshot ?? afterFirstClose, afterSecondClose);
    const reopenRewriteObserved = secondCloseHashes["Invalid Direction.base"].bytes !== sourceHashes["Invalid Direction.base"].bytes
      || secondCloseHashes["Invalid Direction.base"].sha256 !== sourceHashes["Invalid Direction.base"].sha256;
    const reopenUnexpectedChanges = reopenChanges.filter((change) => {
      if (workspaceStateAllowlist.includes(change.path)) return false;
      const isRecordedReferenceRewrite = reopenRewriteObserved
        && change.path === "Invalid Direction.base"
        && change.after?.bytes === normalizedInvalidBasesDirection.length
        && change.after?.sha256 === normalizedInvalidBasesDirectionSha256;
      return !isRecordedReferenceRewrite;
    });
    if (reopenUnexpectedChanges.length > 0) {
      throw new Error(`C07 Bases reopen changed unapproved vault content: ${JSON.stringify(reopenUnexpectedChanges).slice(0, 6_000)}`);
    }
    snapshots.bases_direction_reopen_changes = reopenChanges;
    basesReport.second_shutdown_source_hashes = secondCloseHashes;
    const sourceRewriteObservations = basesReport.source_rewrite_observations as Array<Record<string, unknown>>;
    const noReferenceSourceRewriteObserved = sourceRewriteObservations.length === 0;
    const finalSourceHashesMatchSeed = isDeepStrictEqual(sourceHashes, secondCloseHashes);
    basesReport.source_hashes_unchanged_across_both_sessions = noReferenceSourceRewriteObserved && finalSourceHashesMatchSeed;
    basesReport.reference_app_source_preservation_passed = basesReport.source_hashes_unchanged_across_both_sessions;
    basesReport.source_hashes_unchanged_except_known_reference_rewrite = Object.entries(secondCloseHashes).every(([path, actual]) => {
      const baseline = sourceHashes?.[path];
      return Boolean(baseline && ((actual.bytes === baseline.bytes && actual.sha256 === baseline.sha256)
        || (path === "Invalid Direction.base"
          && actual.bytes === normalizedInvalidBasesDirection.length
          && actual.sha256 === normalizedInvalidBasesDirectionSha256)));
    });
    const allDirections = ["ASC", "DESC", omittedBasesDirection, invalidBasesDirection] as const;
    const supportedDirections = ["ASC", "DESC"] as const;
    basesReport.group_order_by_direction_on_first_open = Object.fromEntries(
      allDirections.map((direction) => [direction, firstViews[direction].group_order_from_rendered_rows]),
    );
    basesReport.group_order_by_direction_after_reopen = Object.fromEntries(
      allDirections.map((direction) => [direction, reopenedViews[direction].group_order_from_rendered_rows]),
    );
    basesReport.row_order_by_group_on_first_open = Object.fromEntries(
      allDirections.map((direction) => [direction, firstViews[direction].row_order_by_group_from_dom]),
    );
    basesReport.row_order_by_group_after_reopen = Object.fromEntries(
      allDirections.map((direction) => [direction, reopenedViews[direction].row_order_by_group_from_dom]),
    );
    basesReport.group_order_stable_across_reopen = isDeepStrictEqual(
      Object.fromEntries(supportedDirections.map((direction) => [direction, firstViews[direction].group_order_from_rendered_rows])),
      Object.fromEntries(supportedDirections.map((direction) => [direction, reopenedViews[direction].group_order_from_rendered_rows])),
    );
    basesReport.row_order_stable_across_reopen = isDeepStrictEqual(
      Object.fromEntries(supportedDirections.map((direction) => [direction, firstViews[direction].row_order_by_group_from_dom])),
      Object.fromEntries(supportedDirections.map((direction) => [direction, reopenedViews[direction].row_order_by_group_from_dom])),
    );
    const fixturePathSetCaptured = (view: BasesDirectionViewObservation): boolean => {
      return hasCompleteBasesFixturePathSet(view);
    };
    const groupCaptureComplete = (view: BasesDirectionViewObservation): boolean => hasCompleteBasesGroupCapture(view);
    basesReport.fixture_path_set_captured_on_first_open = Object.fromEntries(
      supportedDirections.map((direction) => [direction, fixturePathSetCaptured(firstViews[direction])]),
    );
    basesReport.fixture_path_set_captured_after_reopen = Object.fromEntries(
      supportedDirections.map((direction) => [direction, fixturePathSetCaptured(reopenedViews[direction])]),
    );
    basesReport.complete_group_capture_on_first_open = Object.fromEntries(
      supportedDirections.map((direction) => [direction, groupCaptureComplete(firstViews[direction])]),
    );
    basesReport.complete_group_capture_after_reopen = Object.fromEntries(
      supportedDirections.map((direction) => [direction, groupCaptureComplete(reopenedViews[direction])]),
    );
    const comparableObservation = (view: BasesDirectionViewObservation) => ({
      requested_file_path: view.requested_file_path,
      selection_succeeded: view.selection_succeeded,
      active_file_path: view.active_file_path,
      active_view_type: view.active_view_type,
      state_settled: view.state_settled,
      body: view.body,
      group_order: view.group_order_from_rendered_rows,
      row_order_by_group: view.row_order_by_group_from_dom,
      rendered_file_paths: view.rendered_file_paths,
      unscoped_fixture_link_paths: view.unscoped_fixture_link_paths,
      visible_group_heading_count: view.visible_group_heading_count,
      visible_group_row_candidate_count: view.visible_group_row_candidate_count,
      unmapped_group_heading_count: view.unmapped_group_heading_count,
      unmapped_group_row_candidate_count: view.unmapped_group_row_candidate_count,
      unmapped_data_row_candidate_count: view.unmapped_data_row_candidate_count,
      visible_data_row_candidate_count: view.visible_data_row_candidate_count,
      visible_bases_row_candidate_count: view.visible_bases_row_candidate_count,
      notices: view.notices,
    });
    basesReport.complete_observations_stable_across_reopen = isDeepStrictEqual(
      Object.fromEntries(allDirections.map((direction) => [direction, comparableObservation(firstViews[direction])])),
      Object.fromEntries(allDirections.map((direction) => [direction, comparableObservation(reopenedViews[direction])])),
    );
    basesReport.omitted_direction_observation_on_first_open = firstViews[omittedBasesDirection];
    basesReport.omitted_direction_observation_after_reopen = reopenedViews[omittedBasesDirection];
    basesReport.omitted_direction_parse_error_on_first_open = hasExpectedOmittedGroupDirectionParseError(
      firstViews[omittedBasesDirection],
      "Omitted Direction.base",
      "C07 group direction omitted",
    );
    basesReport.omitted_direction_parse_error_after_reopen = hasExpectedOmittedGroupDirectionParseError(
      reopenedViews[omittedBasesDirection],
      "Omitted Direction.base",
      "C07 group direction omitted",
    );
    const comparableOmittedParseError = (view: BasesDirectionViewObservation) => ({
      requested_file_path: view.requested_file_path,
      selection_succeeded: view.selection_succeeded,
      active_file_path: view.active_file_path,
      active_view_type: view.active_view_type,
      state_settled: view.state_settled,
      expected_parse_error: hasExpectedOmittedGroupDirectionParseError(
        view,
        "Omitted Direction.base",
        "C07 group direction omitted",
      ),
      body: view.body,
      group_order: view.group_order_from_rendered_rows,
      row_order_by_group: view.row_order_by_group_from_dom,
      rendered_file_paths: view.rendered_file_paths,
      table_root_class: view.table_root_class,
      visible_group_heading_count: view.visible_group_heading_count,
      visible_group_row_candidate_count: view.visible_group_row_candidate_count,
      unmapped_group_heading_count: view.unmapped_group_heading_count,
      unmapped_group_row_candidate_count: view.unmapped_group_row_candidate_count,
      unmapped_data_row_candidate_count: view.unmapped_data_row_candidate_count,
      visible_data_row_candidate_count: view.visible_data_row_candidate_count,
      visible_bases_row_candidate_count: view.visible_bases_row_candidate_count,
      error_dom_candidates: view.bases_dom_candidates
        .filter((candidate) => candidate.class_name.includes("bases-error"))
        .map(({tag, class_name, role, text}) => ({tag, class_name, role, text})),
      notices: view.notices,
    });
    basesReport.omitted_direction_parse_error_stable_across_reopen = isDeepStrictEqual(
      comparableOmittedParseError(firstViews[omittedBasesDirection]),
      comparableOmittedParseError(reopenedViews[omittedBasesDirection]),
    );
    basesReport.invalid_direction_observation_on_first_open = firstViews[invalidBasesDirection];
    basesReport.invalid_direction_observation_after_reopen = reopenedViews[invalidBasesDirection];
    if (!basesReport.source_hashes_unchanged_except_known_reference_rewrite
      || !basesReport.group_order_stable_across_reopen
      || !basesReport.row_order_stable_across_reopen
      || !Object.values(basesReport.fixture_path_set_captured_on_first_open as Record<string, boolean>).every(Boolean)
      || !Object.values(basesReport.fixture_path_set_captured_after_reopen as Record<string, boolean>).every(Boolean)
      || !Object.values(basesReport.complete_group_capture_on_first_open as Record<string, boolean>).every(Boolean)
      || !Object.values(basesReport.complete_group_capture_after_reopen as Record<string, boolean>).every(Boolean)
      || !basesReport.complete_observations_stable_across_reopen
      || !basesReport.omitted_direction_parse_error_on_first_open
      || !basesReport.omitted_direction_parse_error_after_reopen
      || !basesReport.omitted_direction_parse_error_stable_across_reopen
      || firstViews[omittedBasesDirection].active_file_path !== "Omitted Direction.base"
      || firstViews[omittedBasesDirection].active_view_type !== "bases"
      || !firstViews[omittedBasesDirection].state_settled
      || reopenedViews[omittedBasesDirection].active_file_path !== "Omitted Direction.base"
      || reopenedViews[omittedBasesDirection].active_view_type !== "bases"
      || !reopenedViews[omittedBasesDirection].state_settled
      || firstViews[invalidBasesDirection].requested_file_path !== "Invalid Direction.base"
      || reopenedViews[invalidBasesDirection].requested_file_path !== "Invalid Direction.base"
      || firstViews[invalidBasesDirection].active_file_path !== "Invalid Direction.base"
      || reopenedViews[invalidBasesDirection].active_file_path !== "Invalid Direction.base"
      || !firstViews[invalidBasesDirection].selection_succeeded
      || !reopenedViews[invalidBasesDirection].selection_succeeded
      || !firstViews[invalidBasesDirection].state_settled
      || !reopenedViews[invalidBasesDirection].state_settled) {
      throw new Error("C07 Bases first-open/reopen capture assertions failed");
    }
    basesReport.capture_status = "completed";
    basesReport.status = basesReport.reference_app_source_preservation_passed === true
      ? "passed"
      : "captured-reference-mutation";
    report.reference_capture_summary = {
      status: "completed",
      c07_capture_status: basesReport.status,
      reference_app_source_preservation_passed: basesReport.reference_app_source_preservation_passed,
      source_rewrite_observation_count: (basesReport.source_rewrite_observations as unknown[]).length,
      interpretation: "C07.2 reference capture completed. A passing capture records pinned-app behavior and does not establish Rust source-preservation parity.",
    };
    await saveReport();
  } catch (error) {
    basesReport.status = "failed";
    basesReport.error = error instanceof Error ? error.message : String(error);
    if (sourceHashes) {
      try {
        const failureBytes: Record<string, Buffer> = {};
        const failureMismatches: string[] = [];
        const failureHashes = await assertBasesDirectionSourceHashes(
          sourceHashes,
          "failure",
          true,
          failureBytes,
          failureMismatches,
        );
        basesReport.source_hashes_after_failure = failureHashes;
        const invalidDirectionHash = failureHashes["Invalid Direction.base"];
        const invalidDirectionSnapshot = failureBytes["Invalid Direction.base"];
        if (invalidDirectionHash && invalidDirectionSnapshot) {
          await recordBasesDirectionReferenceRewrite(
            sourceHashes,
            failureHashes,
            invalidDirectionSnapshot,
            secondProcess || secondConnection ? "reopen" : "first_open",
            "failure",
          );
        }
        if (failureMismatches.length > 0) {
          basesReport.source_preservation_failure = failureMismatches.join("; ");
        }
      } catch (sourceError) {
        basesReport.source_preservation_failure = sourceError instanceof Error ? sourceError.message : String(sourceError);
      }
    }
    await saveReport();
    throw error;
  } finally {
    await stopProcess(firstProcess, firstConnection).catch(() => undefined);
    await stopProcess(secondProcess, secondConnection).catch(() => undefined);
  }
}

async function runBasesGroupOrderReferenceProbe(): Promise<void> {
  const profilesRoot = join(workDirectory, "group-order-obsidian-profiles");
  const basesReport = report.bases_group_order_reference as Record<string, unknown>;
  const snapshots = report.vault_snapshots as Record<string, unknown>;
  basesReport.status = "running";
  basesReport.capture_status = "running";
  try {
    await rm(profilesRoot, {recursive: true, force: true});
    await mkdir(profilesRoot, {recursive: true});
    const fixtureSetup = await createGroupOrderReferenceFixture();
    const fixture = fixtureSetup.fixture;
    const scenarioFixtures = fixtureSetup.scenarioFixtures;
    const firstViews: Record<string, GroupOrderScenarioObservation> = {};
    const reopenedViews: Record<string, GroupOrderScenarioObservation> = {};
    const firstSourceHashesByScenario: Record<string, Record<string, GroupOrderSourceHash>> = {};
    const reopenedSourceHashesByScenario: Record<string, Record<string, GroupOrderSourceHash>> = {};
    const firstSession: Record<string, unknown> = {
      source_hashes_before_open: Object.fromEntries(Object.entries(scenarioFixtures).map(([id, scenario]) => [id, scenario.source_hashes])),
      source_hashes_after_startup: {},
      source_hashes_after_vault_selection: {},
      source_hashes_after_each_view: firstSourceHashesByScenario,
      source_hashes_after_shutdown: {},
      scenario_runs: {},
      views: firstViews,
    };
    const secondSession: Record<string, unknown> = {
      source_hashes_before_reopen: Object.fromEntries(Object.entries(scenarioFixtures).map(([id, scenario]) => [id, scenario.source_hashes])),
      source_hashes_after_startup: {},
      source_hashes_after_vault_restore: {},
      source_hashes_after_each_view: reopenedSourceHashesByScenario,
      source_hashes_after_shutdown: {},
      workspace_view_immediately_after_startup: {},
      scenario_runs: {},
      views: reopenedViews,
    };
    basesReport.first_session = firstSession;
    basesReport.second_session = secondSession;
    const scenarioReport = fixture.scenarios.map((scenario) => ({
      id: scenario.id,
      base_path: scenario.base_path,
      source_format: scenario.source_format,
      layout: scenario.layout,
      group_by_property: scenario.group_by_property ?? null,
      coverage: scenario.coverage,
      first_open_observation: null as GroupOrderScenarioObservation | null,
      reopen_observation: null as GroupOrderScenarioObservation | null,
      scenario_vault_path: scenarioFixtures[scenario.id]?.vault_root ?? null,
      source_hashes_at_seed: scenarioFixtures[scenario.id]?.source_hashes ?? {},
      seed_artifacts: scenarioFixtures[scenario.id]?.seed_artifacts ?? {},
    }));
    basesReport.scenarios = scenarioReport;
    basesReport.source_hashes_before_open = firstSession.source_hashes_before_open;
    basesReport.source_hashes_before_reopen = secondSession.source_hashes_before_reopen;
    snapshots.group_order_seed = await snapshotTree(groupOrderVaultRoot);
    await saveReport();

    for (const scenario of fixture.scenarios) {
      const scenarioEntry = scenarioReport.find((entry) => entry.id === scenario.id)!;
      const scenarioFixture = scenarioFixtures[scenario.id];
      if (!scenarioFixture) throw new Error(`C07.3 scenario ${scenario.id} has no isolated fixture`);
      const profileDirectory = join(profilesRoot, scenario.id);
      const vaultName = basename(scenarioFixture.vault_root);
      const firstScenarioRun: Record<string, unknown> = {
        vault_name: vaultName,
        vault_path: scenarioFixture.vault_root,
        profile_id: scenario.id,
      };
      const secondScenarioRun: Record<string, unknown> = {
        vault_name: vaultName,
        vault_path: scenarioFixture.vault_root,
        profile_id: scenario.id,
      };
      (firstSession.scenario_runs as Record<string, unknown>)[scenario.id] = firstScenarioRun;
      (secondSession.scenario_runs as Record<string, unknown>)[scenario.id] = secondScenarioRun;

      await recordGroupOrderSourceCheckpoint(scenarioFixture.source_hashes, "before-first-open", scenario.id, scenarioFixture.vault_root);
      let firstProcess: ChildProcess | undefined;
      let firstConnection: DevToolsConnection | undefined;
      try {
        firstProcess = await createObsidianProfile(profileDirectory, 9228, `obsidian-group-order-${scenario.id}-first-open.log`);
        const first = await connectObsidian(9228);
        firstConnection = first.connection;
        firstScenarioRun.devtools_browser = first.browserVersion;
        firstScenarioRun.first_target = {title: first.target.title ?? "", url: first.target.url ?? ""};
        const firstRunBody = await waitForRenderer(
          firstConnection,
          "document.body?.innerText ?? ''",
          (body) => body.includes("Open folder as vault"),
          `Obsidian's first-run screen for C07.3 scenario ${scenario.id}`,
        );
        firstScenarioRun.first_run_text = firstRunBody.slice(0, 2_000);
        (firstSession.source_hashes_after_startup as Record<string, unknown>)[scenario.id] = await recordGroupOrderSourceCheckpoint(
          scenarioFixture.source_hashes,
          "first-open-after-startup",
          scenario.id,
          scenarioFixture.vault_root,
        );
        firstConnection = await chooseVaultDirectory(firstConnection, 9228, firstProcess!, {
          targetRoot: scenarioFixture.vault_root,
          reporter: firstScenarioRun,
          screenshotPrefix: `obsidian-group-order-${scenario.id}`,
        });
        await chooseRestrictedMode(firstConnection, firstScenarioRun, vaultName, basename(scenario.base_path, ".base"));
        (firstSession.source_hashes_after_vault_selection as Record<string, unknown>)[scenario.id] = await recordGroupOrderSourceCheckpoint(
          scenarioFixture.source_hashes,
          "first-open-after-vault-selection",
          scenario.id,
          scenarioFixture.vault_root,
        );
        firstViews[scenario.id] = await captureGroupOrderScenario(firstConnection, scenario, scenarioFixture.fixture_paths, "first-open");
        scenarioEntry.first_open_observation = firstViews[scenario.id];
        firstSourceHashesByScenario[scenario.id] = await recordGroupOrderSourceCheckpoint(
          scenarioFixture.source_hashes,
          "first-open-after-capture",
          scenario.id,
          scenarioFixture.vault_root,
        );
      } catch (error) {
        firstScenarioRun.error = error instanceof Error ? error.message : String(error);
      } finally {
        await stopProcess(firstProcess, firstConnection).catch((error) => {
          firstScenarioRun.shutdown_error = error instanceof Error ? error.message : String(error);
        });
      }
      const firstHashesAfterShutdown = await recordGroupOrderSourceCheckpoint(
        scenarioFixture.source_hashes,
        "first-open-after-shutdown",
        scenario.id,
        scenarioFixture.vault_root,
      );
      (firstSession.source_hashes_after_shutdown as Record<string, unknown>)[scenario.id] = firstHashesAfterShutdown;
      snapshots[`group_order_after_first_close_${scenario.id}`] = await snapshotTree(scenarioFixture.vault_root);
      await saveReport();

      try {
        await reseedGroupOrderScenarioSources(
          scenario.id,
          scenarioFixture.vault_root,
          scenarioFixture.source_files,
          firstHashesAfterShutdown,
        );
      } catch (error) {
        secondScenarioRun.reseed_error = error instanceof Error ? error.message : String(error);
        await saveReport();
        await rm(profileDirectory, {recursive: true, force: true});
        continue;
      }
      await recordGroupOrderSourceCheckpoint(scenarioFixture.source_hashes, "before-reopen-after-reseed", scenario.id, scenarioFixture.vault_root);

      let secondProcess: ChildProcess | undefined;
      let secondConnection: DevToolsConnection | undefined;
      try {
        secondProcess = await createObsidianProfile(profileDirectory, 9229, `obsidian-group-order-${scenario.id}-reopen.log`);
        const second = await connectObsidian(9229);
        secondConnection = second.connection;
        secondScenarioRun.devtools_browser = second.browserVersion;
        secondScenarioRun.first_target = {title: second.target.title ?? "", url: second.target.url ?? ""};
        await chooseRestrictedMode(secondConnection, secondScenarioRun, vaultName, basename(scenario.base_path, ".base"));
        (secondSession.source_hashes_after_startup as Record<string, unknown>)[scenario.id] = await recordGroupOrderSourceCheckpoint(
          scenarioFixture.source_hashes,
          "reopen-after-startup",
          scenario.id,
          scenarioFixture.vault_root,
        );
        (secondSession.workspace_view_immediately_after_startup as Record<string, unknown>)[scenario.id] = await secondConnection.evaluateJson<{
          active_file_path: string | null;
          active_view_type: string | null;
          title: string;
          body: string;
        }>(`(() => {
          const view = window.app?.workspace?.activeLeaf?.view;
          const root = document.querySelector('.workspace-leaf.mod-active') ?? document.body;
          return {
            active_file_path: view?.file?.path ?? null,
            active_view_type: view?.getViewType?.() ?? null,
            title: document.title,
            body: (root?.innerText ?? '').slice(0, 4_000),
          };
        })()`);
        (secondSession.source_hashes_after_vault_restore as Record<string, unknown>)[scenario.id] = await recordGroupOrderSourceCheckpoint(
          scenarioFixture.source_hashes,
          "reopen-after-vault-restore",
          scenario.id,
          scenarioFixture.vault_root,
        );
        reopenedViews[scenario.id] = await captureGroupOrderScenario(secondConnection, scenario, scenarioFixture.fixture_paths, "reopen");
        scenarioEntry.reopen_observation = reopenedViews[scenario.id];
        reopenedSourceHashesByScenario[scenario.id] = await recordGroupOrderSourceCheckpoint(
          scenarioFixture.source_hashes,
          "reopen-after-capture",
          scenario.id,
          scenarioFixture.vault_root,
        );
      } catch (error) {
        secondScenarioRun.error = error instanceof Error ? error.message : String(error);
      } finally {
        await stopProcess(secondProcess, secondConnection).catch((error) => {
          secondScenarioRun.shutdown_error = error instanceof Error ? error.message : String(error);
        });
      }
      (secondSession.source_hashes_after_shutdown as Record<string, unknown>)[scenario.id] = await recordGroupOrderSourceCheckpoint(
        scenarioFixture.source_hashes,
        "reopen-after-shutdown",
        scenario.id,
        scenarioFixture.vault_root,
      );
      snapshots[`group_order_after_reopen_${scenario.id}`] = await snapshotTree(scenarioFixture.vault_root);
      await saveReport();
      await rm(profileDirectory, {recursive: true, force: true});
    }

    const comparableObservation = (view: GroupOrderScenarioObservation) => ({
      requested_file_path: view.requested_file_path,
      selection_succeeded: view.selection_succeeded,
      active_file_path: view.active_file_path,
      active_view_type: view.active_view_type,
      state_settled: view.state_settled,
      title: view.title,
      body: view.body,
      result_count: view.result_count,
      viewport: view.viewport,
      ordered_group_headings: view.ordered_group_headings,
      groups: view.groups.map((group) => ({heading_text: group.heading_text, member_paths: group.member_paths})),
      ungrouped_visible_file_paths: view.ungrouped_visible_file_paths,
      unassigned_visible_file_paths: view.unassigned_visible_file_paths,
      visible_fixture_path_links: view.visible_fixture_path_links.map((link) => ({path: link.path, text: link.text})),
      mapped_visible_row_path_candidates: view.mapped_visible_row_path_candidates.map((row) => ({
        path: row.path,
        text: row.text,
        class_name: row.class_name,
        tag: row.tag,
      })),
      unmapped_visible_path_candidates: view.unmapped_visible_path_candidates,
      unmapped_visible_row_candidates: view.unmapped_visible_row_candidates,
      visible_error_texts: view.visible_error_texts,
      notices: view.notices,
      error_surface_classification: view.error_surface_classification,
      extraction_ambiguous: view.extraction_ambiguous,
      ambiguity_reasons: view.ambiguity_reasons,
    });
    const scenarioComparison: Record<string, boolean> = {};
    const scenarioAcceptance: Record<string, boolean> = {};
    const incompleteScenarios: Array<{id: string; stage: string; reasons: string[]}> = [];
    const firstRunRecords = firstSession.scenario_runs as Record<string, Record<string, unknown>>;
    const reopenRunRecords = secondSession.scenario_runs as Record<string, Record<string, unknown>>;
    for (const scenario of fixture.scenarios) {
      const firstView = firstViews[scenario.id];
      const reopenedView = reopenedViews[scenario.id];
      const complete = (view: GroupOrderScenarioObservation | undefined, expectedStage: "first-open" | "reopen"): boolean => {
        if (!view) {
          const runRecord = expectedStage === "first-open" ? firstRunRecords[scenario.id] : reopenRunRecords[scenario.id];
          incompleteScenarios.push({
            id: scenario.id,
            stage: expectedStage,
            reasons: [
              `${expectedStage} did not produce a structured observation`,
              ...(typeof runRecord?.error === "string" ? [runRecord.error] : []),
              ...(typeof runRecord?.reseed_error === "string" ? [runRecord.reseed_error] : []),
            ],
          });
          return false;
        }
        const expectedPaths = view.visible_fixture_path_links.map((entry) => entry.path).sort();
        const mappedPaths = [...view.groups.flatMap((group) => group.member_paths), ...view.ungrouped_visible_file_paths].sort();
        const valid = view.stage === expectedStage
          && view.requested_file_path === scenario.base_path
          && view.selection_succeeded
          && view.active_file_path === scenario.base_path
          && (view.active_view_type === "bases"
            || (scenario.expected_error_outcome === "visible-error" && hasExplicitVisibleGroupOrderParseError(view)))
          && view.state_settled
          && !view.extraction_ambiguous
          && view.unassigned_visible_file_paths.length === 0
          && view.unmapped_visible_path_candidates.length === 0
          && view.unmapped_visible_row_candidates.length === 0
          && isDeepStrictEqual(expectedPaths, mappedPaths)
          && Boolean(view.screenshot)
          && !view.screenshot_error
          && !view.probe_error;
        if (!valid) {
          incompleteScenarios.push({
            id: scenario.id,
            stage: expectedStage,
            reasons: [
              ...(!view.selection_succeeded || view.active_file_path !== scenario.base_path ? ["exact target selection was not captured"] : []),
              ...(!view.state_settled ? ["visible state did not settle"] : []),
              ...(view.extraction_ambiguous || view.unassigned_visible_file_paths.length > 0 || view.unmapped_visible_path_candidates.length > 0 || view.unmapped_visible_row_candidates.length > 0
                ? [`group/member extraction was incomplete or ambiguous${view.unmapped_visible_path_candidates.length > 0 || view.unmapped_visible_row_candidates.length > 0
                  ? `; unmapped link candidates=${JSON.stringify(view.unmapped_visible_path_candidates)}; unmapped row candidates=${JSON.stringify(view.unmapped_visible_row_candidates)}`
                  : ""}`]
                : []),
              ...(!isDeepStrictEqual(expectedPaths, mappedPaths) ? ["visible fixture paths do not equal the mapped group/member paths"] : []),
              ...(!view.screenshot || view.screenshot_error ? ["required screenshot is missing"] : []),
              ...(view.probe_error ? [view.probe_error] : []),
            ],
          });
        }
        return valid;
      };
      const firstComplete = complete(firstView, "first-open");
      const reopenedComplete = complete(reopenedView, "reopen");
      const stable = firstComplete && reopenedComplete
        && isDeepStrictEqual(comparableObservation(firstView), comparableObservation(reopenedView));
      scenarioComparison[scenario.id] = stable;
      scenarioAcceptance[scenario.id] = firstComplete && reopenedComplete && stable;
      if (firstComplete && reopenedComplete && !stable) {
        incompleteScenarios.push({id: scenario.id, stage: "reopen", reasons: ["first-open and reopened visible observations differ"]});
      }
    }
    basesReport.scenario_comparison_stable_across_reopen = scenarioComparison;
    basesReport.scenario_acceptance_passed = scenarioAcceptance;
    basesReport.incomplete_scenarios = incompleteScenarios;
    const sourceCheckpoints = (basesReport.source_hash_checkpoints as Array<{
      scenario_id: string;
      stage: string;
      unchanged: boolean;
      changes?: Array<Record<string, unknown>>;
      errors?: string[];
    }> | undefined) ?? [];
    const requiredSourceCheckpointStages = [
      "before-first-open",
      "first-open-after-startup",
      "first-open-after-vault-selection",
      "first-open-after-capture",
      "first-open-after-shutdown",
      "before-reopen-after-reseed",
      "reopen-after-startup",
      "reopen-after-vault-restore",
      "reopen-after-capture",
      "reopen-after-shutdown",
    ];
    const expectedCheckpointKeys = new Set(fixture.scenarios.flatMap((scenario) =>
      requiredSourceCheckpointStages.map((stage) => `${scenario.id}\u0000${stage}`)));
    const checkpointCounts = new Map<string, number>();
    for (const checkpoint of sourceCheckpoints) {
      const key = `${checkpoint.scenario_id}\u0000${checkpoint.stage}`;
      checkpointCounts.set(key, (checkpointCounts.get(key) ?? 0) + 1);
    }
    const missingSourceCheckpoints = [...expectedCheckpointKeys]
      .filter((key) => !checkpointCounts.has(key))
      .map((key) => {
        const [scenario_id, stage] = key.split("\u0000");
        return {scenario_id, stage};
      });
    const duplicateSourceCheckpoints = [...checkpointCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key, count]) => {
        const [scenario_id, stage] = key.split("\u0000");
        return {scenario_id, stage, count};
      });
    const unexpectedSourceCheckpoints = [...checkpointCounts.keys()]
      .filter((key) => !expectedCheckpointKeys.has(key))
      .map((key) => {
        const [scenario_id, stage] = key.split("\u0000");
        return {scenario_id, stage};
      });
    const sourceCheckpointMatrixComplete = missingSourceCheckpoints.length === 0
      && duplicateSourceCheckpoints.length === 0
      && unexpectedSourceCheckpoints.length === 0
      && sourceCheckpoints.length === expectedCheckpointKeys.size;
    basesReport.source_checkpoint_matrix = {
      required_stages: requiredSourceCheckpointStages,
      expected_count: expectedCheckpointKeys.size,
      observed_count: sourceCheckpoints.length,
      missing: missingSourceCheckpoints,
      duplicates: duplicateSourceCheckpoints,
      unexpected: unexpectedSourceCheckpoints,
      complete: sourceCheckpointMatrixComplete,
    };
    const reopenedHashesAtShutdown = secondSession.source_hashes_after_shutdown as Record<string, Record<string, GroupOrderSourceHash>>;
    const sourceObservationRecordingComplete = sourceCheckpointMatrixComplete && sourceCheckpoints.every((checkpoint) =>
      (checkpoint.errors?.length ?? 0) === 0
      && (checkpoint.changes ?? []).every((change) => change.status === "missing" || change.exact_observed_state_recorded === true));
    basesReport.source_hashes_unchanged_across_both_sessions = sourceCheckpoints.length > 0 && sourceCheckpoints.every((checkpoint) => checkpoint.unchanged);
    basesReport.source_hashes_match_seed_after_reopen = Object.entries(scenarioFixtures).every(([id, scenarioFixture]) =>
      isDeepStrictEqual(scenarioFixture.source_hashes, reopenedHashesAtShutdown[id] ?? {}));
    basesReport.reference_source_mutation_observed = sourceCheckpoints.some((checkpoint) => (checkpoint.changes?.length ?? 0) > 0);
    basesReport.source_preservation_passed = sourceCheckpoints.length > 0 && sourceCheckpoints.every((checkpoint) => checkpoint.unchanged);
    basesReport.source_observation_recording_complete = sourceObservationRecordingComplete;
    basesReport.capture_status = Object.values(scenarioAcceptance).every(Boolean) ? "completed" : "incomplete";
    if (!Object.values(scenarioAcceptance).every(Boolean) || !sourceObservationRecordingComplete) {
      throw new Error(`C07.3 groupOrder first-open/reopen capture acceptance failed: ${JSON.stringify({scenario_acceptance: scenarioAcceptance, source_observation_recording_complete: sourceObservationRecordingComplete, incomplete_scenarios: incompleteScenarios}).slice(0, 12_000)}`);
    }
    basesReport.status = "captured-reference-only";
    basesReport.rust_parity_claimed = false;
    report.reference_capture_summary = {
      status: "completed",
      c07_2_capture_status: (report.bases_group_direction_reference as Record<string, unknown>).status,
      c07_3_group_order_capture_status: basesReport.status,
      rust_parity_claimed: false,
      reference_source_mutation_observed: basesReport.reference_source_mutation_observed,
      interpretation: "Pinned-app C07.3 observations were captured on this runner. Exact Obsidian source rewrites are recorded as reference behavior and do not establish Rust source preservation or groupOrder parity.",
    };
    await saveReport();
  } catch (error) {
    basesReport.status = "failed";
    basesReport.capture_status = "incomplete";
    basesReport.error = error instanceof Error ? error.message : String(error);
    await saveReport();
    throw error;
  }
}
async function run(): Promise<void> {
  await mkdir(reportDirectory, {recursive: true});
  await mkdir(workDirectory, {recursive: true});
  await createFixture();
  await saveReport();

  let authorProcess: ChildProcess | undefined;
  let authorConnection: DevToolsConnection | undefined;
  let reopenProcess: ChildProcess | undefined;
  let reopenConnection: DevToolsConnection | undefined;
  try {
    authorProcess = await createObsidianProfile(join(workDirectory, "obsidian-profile"), 9222);
    const authored = await authorFixtureThroughObsidian(authorProcess);
    authorConnection = authored.connection;
    await delay(2_000);
    await stopProcess(authorProcess, authorConnection);
    authorProcess = undefined;
    authorConnection = undefined;

    const beforeRust = await snapshotTree(vaultRoot);
    (report.vault_snapshots as Record<string, unknown>).before_openobsidian = beforeRust;
    (report.obsidian_authoring as Record<string, unknown>).closed_before_baseline = true;
    (report.fixture as Record<string, unknown>).authored_note_path = authored.notePath;
    await writeFile(join(reportDirectory, "vault-before-openobsidian.json"), `${JSON.stringify(beforeRust, null, 2)}\n`);
    await saveReport();

    await runOpenObsidian(beforeRust);
    const expectedBeforeObsidianReopen = await snapshotTree(vaultRoot);
    (report.vault_snapshots as Record<string, unknown>).expected_before_obsidian_reopen = expectedBeforeObsidianReopen;
    await writeFile(join(reportDirectory, "vault-after-openobsidian.json"), `${JSON.stringify(report.vault_snapshots && (report.vault_snapshots as Record<string, unknown>).after_openobsidian, null, 2)}\n`);
    await writeFile(join(reportDirectory, "vault-before-obsidian-reopen.json"), `${JSON.stringify(expectedBeforeObsidianReopen, null, 2)}\n`);

    reopenProcess = await createObsidianProfile(join(workDirectory, "obsidian-profile"), 9223);
    const expectedAttachmentPresent = expectedBeforeObsidianReopen.some((entry) => entry.path === attachmentPath && entry.kind === "file");
    reopenConnection = await reopenInObsidian(
      reopenProcess,
      authored.notePath,
      expectedAttachmentPresent,
      externalRenamedMarkdownPath,
    );
    await delay(2_000);
    await stopProcess(reopenProcess, reopenConnection);
    reopenProcess = undefined;
    reopenConnection = undefined;

    const afterReopen = await snapshotTree(vaultRoot);
    const reopenChanges = changedPaths(expectedBeforeObsidianReopen, afterReopen);
    const allowedChanges = reopenChanges.filter((change) => workspaceStateAllowlist.includes(change.path));
    const unapprovedChanges = reopenChanges.filter((change) => !workspaceStateAllowlist.includes(change.path));
    if (unapprovedChanges.length > 0) {
      throw new Error(`Obsidian reopen changed non-workspace vault content: ${JSON.stringify(unapprovedChanges).slice(0, 6_000)}`);
    }
    (report.vault_snapshots as Record<string, unknown>).after_obsidian_reopen = afterReopen;
    (report.vault_snapshots as Record<string, unknown>).reference_workspace_state_changes = allowedChanges;
    (report.vault_snapshots as Record<string, unknown>).non_workspace_paths_unchanged_after_reopen = true;
    (report.obsidian_reopen as Record<string, unknown>).workspace_state_changes = allowedChanges;
    (report.obsidian_reopen as Record<string, unknown>).status = "passed";
    await writeFile(join(reportDirectory, "vault-after-obsidian-reopen.json"), `${JSON.stringify(afterReopen, null, 2)}\n`);
    await writeFile(join(reportDirectory, "vault-reopen-workspace-changes.json"), `${JSON.stringify(allowedChanges, null, 2)}\n`);

    await runCanvasReferenceProbe();
    await runBasesDirectionReferenceProbe();
    await runBasesGroupOrderReferenceProbe();

    report.status = "passed";
    report.completed_at = new Date().toISOString();
  } finally {
    await stopProcess(authorProcess, authorConnection).catch(() => undefined);
    await stopProcess(reopenProcess, reopenConnection).catch(() => undefined);
    await saveReport();
  }
}

try {
  await run();
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.message : String(error);
  report.completed_at = new Date().toISOString();
  console.error(`Obsidian vault round-trip acceptance failed: ${String(report.error)}`);
} finally {
  await saveReport();
}

const referenceCaptureSummary = report.reference_capture_summary as Record<string, unknown> | undefined;
const sourceObservationMessage = typeof referenceCaptureSummary?.reference_source_mutation_observed === "boolean"
  ? `; pinned-app source mutation observed=${String(referenceCaptureSummary.reference_source_mutation_observed)}`
  : typeof referenceCaptureSummary?.reference_app_source_preservation_passed === "boolean"
    ? `; C07.2 pinned-app source hashes preserved=${String(referenceCaptureSummary.reference_app_source_preservation_passed)}`
    : "";
const captureMessage = referenceCaptureSummary
  ? `; C07 reference capture=${String(referenceCaptureSummary.status)}${sourceObservationMessage}`
  : "";
console.log(`Obsidian vault round-trip acceptance: ${String(report.status)}${captureMessage}; report=${join(reportDirectory, "obsidian-vault-roundtrip-report.json")}`);
if (report.status !== "passed") process.exit(1);
