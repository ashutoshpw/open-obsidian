import {resolve} from "node:path";

export type QuickCheck = {id: string; args: string[]};

export const QUICK_CHECKS: readonly QuickCheck[] = [
  {id: "state", args: ["run", "validate:state"]},
  {id: "contracts", args: ["run", "validate:contracts"]},
  {id: "plugin-matrix", args: ["run", "validate:plugin-matrix"]},
  {id: "plugin-d15", args: ["run", "validate:plugin-d15"]},
  {id: "plugin-d15-bounded", args: ["run", "audit:plugin-d15-bounded"]},
  {id: "plugin-combinations", args: ["run", "audit:plugin-combinations"]},
  {id: "plugin-prerequisites", args: ["run", "validate:plugin-prerequisites"]},
  {id: "architecture", args: ["run", "validate:architecture"]},
  {id: "surfaces", args: ["run", "validate:surfaces"]},
  {id: "version-baseline", args: ["run", "verify:version-baseline"]},
  {id: "differential", args: ["run", "validate:differential"]},
  {id: "entry-points", args: ["run", "validate:entry-points"]},
  {id: "paid-service-boundary", args: ["run", "validate:paid-service-boundary"]},
  {id: "workflows", args: ["run", "validate:workflows"]},
  {id: "input-matrix", args: ["run", "validate:input-matrix"]},
  {id: "comparison-scorecard", args: ["run", "audit:comparison-scorecard"]},
  {id: "golden-edit-fidelity", args: ["run", "audit:golden-edit-fidelity"]},
  {id: "compatibility-coverage", args: ["run", "audit:compatibility-coverage"]},
  {id: "accessibility", args: ["run", "check:accessibility"]},
  {id: "layout", args: ["run", "validate:layout"]},
  {id: "typecheck", args: ["run", "typecheck"]},
  {id: "tests", args: ["test"]},
  {id: "knip", args: ["run", "knip"]},
  {id: "fallow-changed", args: ["run", "audit:fallow:changed"]},
];

const root = resolve(import.meta.dir, "..");

function runCheck(check: QuickCheck): number {
  console.log(`\n[check:fast] ${check.id}`);
  const result = Bun.spawnSync([process.execPath, ...check.args], {cwd: root});
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  return result.exitCode;
}

export function runQuickChecks(): number {
  for (const check of QUICK_CHECKS) {
    const exitCode = runCheck(check);
    if (exitCode !== 0) return exitCode || 1;
  }
  console.log("\n[check:fast] passed");
  return 0;
}

if (import.meta.main) process.exit(runQuickChecks());
