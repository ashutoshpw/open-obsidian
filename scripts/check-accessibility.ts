import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";

export type AccessibilityAuditResult = {failures: string[]; checks: string[]};

const root = resolve(import.meta.dir, "..");

function attribute(attributes: string, name: string): string | undefined {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match?.[1];
}

function plainText(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/&(?:amp|lt|gt|quot|#39);/g, " ").replace(/\s+/g, " ").trim();
}

function referencedIds(value: string | undefined): string[] {
  return value?.split(/\s+/).filter(Boolean) ?? [];
}

function documentIds(html: string): {ids: Set<string>; duplicateIds: string[]} {
  const allIds = [...html.matchAll(/\bid=["']([^"']+)["']/gi)].map((match) => match[1]);
  return {ids: new Set(allIds), duplicateIds: allIds.filter((id, index, all) => all.indexOf(id) !== index)};
}

function labelledControlIds(html: string): Set<string> {
  return new Set([...html.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)].flatMap((match) => {
    const direct = attribute(match[1] ?? "", "for");
    const nested = [...(match[2] ?? "").matchAll(/<(?:input|select|textarea)\b[^>]*\bid=["']([^"']+)["']/gi)].map((nestedMatch) => nestedMatch[1]);
    return direct ? [direct, ...nested] : nested;
  }));
}

function buttonFailures(attributes: string, content: string, ids: Set<string>): string[] {
  const id = attribute(attributes, "id") ?? "(anonymous)";
  const type = attribute(attributes, "type");
  const label = attribute(attributes, "aria-label");
  const labelledBy = referencedIds(attribute(attributes, "aria-labelledby"));
  const failures: string[] = [];
  if (!type) failures.push(`${id} button must declare type`);
  if (type && !["button", "submit", "reset"].includes(type.toLowerCase())) failures.push(`${id} button has invalid type ${type}`);
  const hasName = Boolean(plainText(content) || label || (labelledBy.length > 0 && labelledBy.every((reference) => ids.has(reference))));
  if (!hasName) failures.push(`${id} button has no accessible name`);
  return failures;
}

function auditButtons(html: string, ids: Set<string>): string[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)].flatMap((match) => buttonFailures(match[1] ?? "", match[2] ?? "", ids));
}

function controlFailure(tag: string, attributes: string, labelledIds: Set<string>): string[] {
  const type = (attribute(attributes, "type") ?? "").toLowerCase();
  if (tag === "input" && type === "hidden") return [];
  const id = attribute(attributes, "id") ?? "(anonymous)";
  const label = attribute(attributes, "aria-label");
  const labelledBy = referencedIds(attribute(attributes, "aria-labelledby"));
  const hasLabel = Boolean(label || labelledBy.length > 0 || labelledIds.has(id));
  return hasLabel ? [] : [`${id} ${tag} has no associated label`];
}

function auditFormControls(html: string, labelledIds: Set<string>): string[] {
  return [...html.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)].flatMap((match) => controlFailure(match[1]?.toLowerCase() ?? "control", match[2] ?? "", labelledIds));
}

function auditRequiredStyles(html: string): {failures: string[]; checks: string[]} {
  const failures: string[] = [];
  const checks: string[] = [];
  if (!html.includes(":focus-visible")) failures.push("renderer must define a visible focus-visible style");
  else checks.push("focus-visible");
  if (!html.includes("prefers-reduced-motion")) failures.push("renderer must honor prefers-reduced-motion");
  else checks.push("reduced-motion");
  if (!/role=["']status["'][^>]*aria-live=["']polite["']/i.test(html)) failures.push("renderer status must be a polite live region");
  else checks.push("live-status");
  return {failures, checks};
}

function auditDialogs(html: string, ids: Set<string>): string[] {
  return [...html.matchAll(/<dialog\b([^>]*)>/gi)].flatMap((match) => {
    const id = attribute(match[1] ?? "", "id") ?? "(anonymous)";
    const labelledBy = referencedIds(attribute(match[1] ?? "", "aria-labelledby"));
    return labelledBy.length > 0 && labelledBy.every((reference) => ids.has(reference)) ? [] : [`${id} dialog must reference an existing accessible title`];
  });
}

export function auditRendererHtml(html = readFileSync(join(root, "src/renderer/index.html"), "utf8")): AccessibilityAuditResult {
  const {ids, duplicateIds} = documentIds(html);
  const failures: string[] = [];
  const checks: string[] = [];
  if (duplicateIds.length > 0) failures.push(`duplicate DOM IDs: ${[...new Set(duplicateIds)].join(", ")}`);
  failures.push(...auditButtons(html, ids));
  checks.push("button-types", "interactive-names");
  failures.push(...auditFormControls(html, labelledControlIds(html)));
  checks.push("form-labels");
  const styleAudit = auditRequiredStyles(html);
  failures.push(...styleAudit.failures);
  checks.push(...styleAudit.checks);
  failures.push(...auditDialogs(html, ids));
  checks.push("dialog-labels");
  return {failures, checks: [...new Set(checks)]};
}

if (import.meta.main) {
  const result = auditRendererHtml();
  result.failures.forEach((failure) => console.error(`ACCESSIBILITY ERROR: ${failure}`));
  if (result.failures.length > 0) process.exit(1);
  console.log(`ACCESSIBILITY CHECK: passed; ${result.checks.length} static checks`);
}
