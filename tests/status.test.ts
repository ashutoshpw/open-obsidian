import { expect, test } from "bun:test";
import { runStatus } from "../scripts/status.js";

function executeStatus(...args: string[]): { code: number; output: string } {
  const lines: string[] = [];
  const code = runStatus(args, (message) => lines.push(message), (message) => lines.push(message));
  return {
    code,
    output: lines.join("\n"),
  };
}

test("status validator accepts the initialized progress structure", () => {
  const result = executeStatus("--validate");
  expect(result.code).toBe(0);
  expect(result.output).toContain("STRUCTURE CHECK: passed");
  expect(result.output).toContain("196 total");
});

test("release check refuses incomplete implementation honestly", () => {
  const result = executeStatus("--release");
  expect(result.code).toBe(2);
  expect(result.output).toContain("RELEASE CHECK: incomplete");
  expect(result.output).toContain("161 mandatory acceptance rows");
});
