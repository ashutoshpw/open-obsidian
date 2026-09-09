import { expect, test } from "bun:test";

const root = new URL("..", import.meta.url).pathname;

function runStatus(...args: string[]): { code: number; output: string } {
  const result = Bun.spawnSync(["bun", "scripts/status.ts", ...args], {cwd: root});
  return {
    code: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
}

test("status validator accepts the initialized progress structure", () => {
  const result = runStatus("--validate");
  expect(result.code).toBe(0);
  expect(result.output).toContain("STRUCTURE CHECK: passed");
  expect(result.output).toContain("196 total");
});

test("release check refuses incomplete implementation honestly", () => {
  const result = runStatus("--release");
  expect(result.code).toBe(2);
  expect(result.output).toContain("RELEASE CHECK: incomplete");
  expect(result.output).toContain("183 mandatory acceptance rows");
});
