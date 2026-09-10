import {resolve} from "node:path";

export type QuickCheck = {id: string; args: string[]};

export const QUICK_CHECKS: readonly QuickCheck[] = [
  {id: "state", args: ["run", "validate:state"]},
  {id: "contracts", args: ["run", "validate:contracts"]},
  {id: "architecture", args: ["run", "validate:architecture"]},
  {id: "surfaces", args: ["run", "validate:surfaces"]},
  {id: "version-baseline", args: ["run", "verify:version-baseline"]},
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
