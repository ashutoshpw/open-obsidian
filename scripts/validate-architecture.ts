import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {asArray, asRecord, asString, type JsonRecord} from "./json.js";

const root = resolve(import.meta.dir, "..");
const array = asArray;
const record = asRecord;
const string = asString;

function readManifest(): JsonRecord {
  return JSON.parse(readFileSync(join(root, "config/architecture-manifest.json"), "utf8")) as JsonRecord;
}

function processNames(manifest: JsonRecord): string[] {
  return array(manifest.processes).map(record).map((process) => string(process?.name)).filter(Boolean);
}

function invalidPositive(value: unknown): boolean {
  return typeof value !== "number" || value <= 0;
}

function estimateChecks(raw: unknown): Array<[boolean, string]> {
  const estimate = record(raw);
  const name = string(estimate?.workstream);
  const fields = ["optimistic_days", "likely_days", "pessimistic_days"];
  const values = fields.map((field) => estimate?.[field]);
  return [
    ...values.map((value, index) => [invalidPositive(value), `${name} has an invalid ${fields[index] ?? "unknown"} estimate`] as [boolean, string]),
    [!Array.isArray(estimate?.dependencies), `${name} is missing dependencies`],
    [!string(estimate?.status).includes("not a calendar promise"), `${name} is missing the calendar disclaimer`],
  ];
}

function settingChecks(settings: JsonRecord | null): Array<[boolean, string]> {
  return [
    [settings?.contextIsolation !== true, "renderer must enable context isolation"],
    [settings?.nodeIntegration !== false, "renderer must disable Node integration"],
    [settings?.sandbox !== true, "renderer must enable sandboxing"],
  ];
}

function interfaceChecks(raw: unknown): [boolean, string] {
  const domainInterface = record(raw);
  const path = string(domainInterface?.path);
  return [!path || !Bun.file(join(root, path)).size, `missing domain interface source: ${path}`];
}

function privateCostChecks(id: string, raw: unknown): Array<[boolean, string]> {
  const cost = record(raw);
  return [
    [invalidPositive(cost?.optimistic_days), `${id} has an invalid optimistic private-internals cost`],
    [invalidPositive(cost?.likely_days), `${id} has an invalid likely private-internals cost`],
    [invalidPositive(cost?.pessimistic_days), `${id} has an invalid pessimistic private-internals cost`],
  ];
}

function privateFindingIdentityChecks(id: string, finding: JsonRecord | null): Array<[boolean, string]> {
  return [
    [!string(finding?.surface), `${id} is missing a private-internals surface`],
    [!string(finding?.reproduction), `${id} is missing a private-internals reproduction`],
    [!string(finding?.owner), `${id} is missing a private-internals owner`],
  ];
}

function privateFindingEvidenceChecks(id: string, finding: JsonRecord | null): Array<[boolean, string]> {
  return [[!Array.isArray(finding?.evidence) || finding.evidence.length === 0, `${id} is missing private-internals evidence`]];
}

function privateFindingDecisionChecks(id: string, finding: JsonRecord | null): Array<[boolean, string]> {
  return [
    [!string(finding?.decision_id), `${id} is missing a private-internals decision ID`],
    [!string(finding?.compatibility_decision), `${id} is missing a compatibility decision`],
    [string(finding?.status) !== "pending-runtime", `${id} must remain pending-runtime until runtime evidence exists`],
  ];
}

function privateFindingChecks(raw: unknown, index: number): Array<[boolean, string]> {
  const finding = record(raw);
  const id = string(finding?.id) || `private-internals-${index + 1}`;
  return [...privateFindingIdentityChecks(id, finding), ...privateFindingEvidenceChecks(id, finding), ...privateFindingDecisionChecks(id, finding), ...privateCostChecks(id, finding?.cost)];
}

function privateInternalChecks(raw: unknown): Array<[boolean, string]> {
  const findings = array(raw);
  const ids = findings.map((finding) => string(record(finding)?.id)).filter(Boolean);
  return [
    [findings.length < 4, "architecture manifest must record at least four private-internals findings"],
    [new Set(ids).size !== ids.length, "private-internals finding IDs must be unique"],
    ...findings.flatMap(privateFindingChecks),
  ];
}

function main(): number {
  const manifest = readManifest();
  const renderer = array(manifest.processes).map(record).find((process) => string(process?.name) === "renderer");
  const checks: Array<[boolean, string]> = [
    [manifest.schema_version !== 1, "architecture manifest must declare schema 1"],
    [string(record(manifest.runtime)?.name) !== "Electron", "architecture manifest must declare Electron"],
    ...["main", "preload", "renderer", "plugin-runtime"].map((name) => [!processNames(manifest).includes(name), `missing architecture process: ${name}`] as [boolean, string]),
    ...settingChecks(record(renderer?.settings)),
    ...array(manifest.effort_estimates).flatMap(estimateChecks),
    ...array(manifest.domain_interfaces).map(interfaceChecks),
    ...privateInternalChecks(manifest.private_internal_findings),
  ];
  const errors = checks.filter(([failed]) => failed).map(([, message]) => message);
  if (errors.length > 0) {
    errors.forEach((error) => console.error(`ARCHITECTURE ERROR: ${error}`));
    return 1;
  }
  console.log("ARCHITECTURE CHECK: passed; Electron boundaries, domain interfaces and preliminary estimate disclaimers are recorded");
  return 0;
}

process.exit(main());
