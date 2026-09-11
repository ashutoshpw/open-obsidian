import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";

type WorkflowStatus = "implemented" | "incomplete" | "deferred";
type CoreWorkflow = {id: string; label: string; status: WorkflowStatus; entry_point: string; test_disposition: string; markers: string[]; test?: string; handoff?: string};
type CoreWorkflowFixture = {schema_version: number; id: string; purpose: string; workflows: CoreWorkflow[]; keyboard_journey: {status: string; shortcuts: string[]; steps: string[]; markers: string[]; external_pending: string[]}};
export type CoreWorkflowValidation = {failures: string[]; implemented: number; incomplete: number; deferred: number};

const root = resolve(import.meta.dir, "..");
const expectedIds = ["file-explorer", "tabs", "splits", "popouts", "command-palette", "quick-switcher", "bookmarks", "outline", "backlinks", "outgoing-links", "templates", "daily-notes", "note-composition", "history", "tasks", "tags"];

function readFixture(): CoreWorkflowFixture {
  return JSON.parse(readFileSync(join(root, "fixtures/c10-core-workflows.json"), "utf8")) as CoreWorkflowFixture;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sourceErrors(markers: string[], source: string, name: string): string[] {
  return markers.filter((marker) => !source.includes(marker)).map((marker) => `${name} is missing renderer marker ${marker}`);
}

function workflowIdentityErrors(workflow: CoreWorkflow): string[] {
  return [
    ...(!nonEmpty(workflow.id) ? ["workflow ID is empty"] : []),
    ...(!nonEmpty(workflow.label) ? [`${workflow.id || "workflow"} label is empty`] : []),
    ...(!nonEmpty(workflow.entry_point) ? [`${workflow.id || "workflow"} entry point is empty`] : []),
    ...(!nonEmpty(workflow.test_disposition) ? [`${workflow.id || "workflow"} test disposition is empty`] : []),
  ];
}

function implementedWorkflowErrors(workflow: CoreWorkflow, source: string): string[] {
  if (workflow.status !== "implemented") return [];
  return [
    ...(!nonEmpty(workflow.test) ? [`${workflow.id} needs a local test command`] : []),
    ...sourceErrors(workflow.markers, source, workflow.id),
  ];
}

function handoffErrors(workflow: CoreWorkflow): string[] {
  if (workflow.status === "implemented") return [];
  const handoff = workflow.handoff ?? "";
  return handoff.includes("Owner:") && handoff.includes("Prerequisite:") ? [] : [`${workflow.id} needs an Owner/Prerequisite handoff`];
}

function workflowErrors(workflow: CoreWorkflow, source: string): string[] {
  return [...workflowIdentityErrors(workflow), ...implementedWorkflowErrors(workflow, source), ...handoffErrors(workflow)];
}

function keyboardJourneyErrors(journey: CoreWorkflowFixture["keyboard_journey"], source: string): string[] {
  return [
    ...(journey.status !== "implemented-locally" ? ["keyboard journey must remain implemented-locally until visible validation passes"] : []),
    ...(journey.shortcuts.length < 3 ? ["keyboard journey needs the primary command, switcher and save shortcuts"] : []),
    ...(journey.steps.length < 4 ? ["keyboard journey needs at least four steps"] : []),
    ...sourceErrors(journey.markers, source, "keyboard journey"),
    ...(journey.external_pending.length === 0 ? ["keyboard journey must retain visible/reference validation handoffs"] : []),
  ];
}

export function validateCoreWorkflowFixture(fixture = readFixture(), source = `${readFileSync(join(root, "src/renderer/index.html"), "utf8")}\n${readFileSync(join(root, "src/renderer/renderer.ts"), "utf8")}`): CoreWorkflowValidation {
  const failures: string[] = [];
  if (fixture.schema_version !== 1) failures.push("core workflow fixture must use schema version 1");
  if (fixture.id !== "fixture:c10-core-workflows") failures.push("core workflow fixture ID is incorrect");
  if (!nonEmpty(fixture.purpose)) failures.push("core workflow fixture purpose is empty");
  const workflows = Array.isArray(fixture.workflows) ? fixture.workflows : [];
  const ids = workflows.map((workflow) => workflow.id);
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) failures.push("core workflow IDs must cover the C10 list in order");
  if (new Set(ids).size !== ids.length) failures.push("core workflow IDs must be unique");
  workflows.forEach((workflow) => failures.push(...workflowErrors(workflow, source)));
  failures.push(...keyboardJourneyErrors(fixture.keyboard_journey, source));
  return {
    failures,
    implemented: workflows.filter((workflow) => workflow.status === "implemented").length,
    incomplete: workflows.filter((workflow) => workflow.status === "incomplete").length,
    deferred: workflows.filter((workflow) => workflow.status === "deferred").length,
  };
}

if (import.meta.main) {
  const result = validateCoreWorkflowFixture();
  result.failures.forEach((failure) => console.error(`WORKFLOW ERROR: ${failure}`));
  if (result.failures.length > 0) process.exit(1);
  console.log(`WORKFLOW CHECK: passed; ${result.implemented} implemented, ${result.incomplete} incomplete, ${result.deferred} deferred C10 workflows; keyboard journey remains locally implemented with external validation pending`);
}
