export type HtmlAuditResult = {failures: string[]; checks: string[]};

export function auditActionTargets(html: string, ids: Set<string>, checks: string[], failures: string[]): void {
  [...html.matchAll(/data-action-target=["']([^"']+)["']/gi)].forEach((match) => {
    const target = match[1];
    if (target && ids.has(target)) checks.push("ribbon action target: " + target);
    else failures.push("ribbon action target has no matching control: " + target);
  });
}

export function runHtmlAudit(audit: () => HtmlAuditResult, label: string): void {
  const result = audit();
  result.failures.forEach((failure) => console.error(`${label} ERROR: ${failure}`));
  if (result.failures.length > 0) process.exit(1);
  console.log(`${label} CHECK: passed; ${result.checks.length} static checks`);
}
