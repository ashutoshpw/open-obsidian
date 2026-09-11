import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {parseLaunchArguments, type LaunchIntent} from "../src/shared/entry-points.js";

type EntryPointCase = {id: string; args: string[]; expected: LaunchIntent | null};
type InvalidEntryPointCase = {id: string; args: string[]; error: string};
type EntryPointFixture = {schema_version: number; id: string; protocol: string; cases: EntryPointCase[]; invalid_cases: InvalidEntryPointCase[]};

const root = resolve(import.meta.dir, "..");

function readFixture(): EntryPointFixture {
  return JSON.parse(readFileSync(join(root, "fixtures/entry-points.json"), "utf8")) as EntryPointFixture;
}

export type EntryPointValidation = {failures: string[]; validCases: number; invalidCases: number};

export function validateEntryPointFixture(fixture = readFixture()): EntryPointValidation {
  const failures: string[] = [];
  if (fixture.schema_version !== 1) failures.push("entry-point fixture must use schema version 1");
  if (fixture.id !== "fixture:entry-points") failures.push("entry-point fixture ID must be fixture:entry-points");
  if (fixture.protocol !== "openobsidian") failures.push("entry-point fixture must reserve only the openobsidian protocol");
  const ids = fixture.cases.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) failures.push("entry-point case IDs must be unique");
  fixture.cases.forEach((entry) => {
    try {
      const actual = parseLaunchArguments(entry.args);
      if (JSON.stringify(actual) !== JSON.stringify(entry.expected)) failures.push(`${entry.id}: parsed intent does not match expected result`);
    } catch (error) {
      failures.push(`${entry.id}: unexpected parse error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  const invalidIds = fixture.invalid_cases.map((entry) => entry.id);
  if (new Set(invalidIds).size !== invalidIds.length) failures.push("invalid entry-point case IDs must be unique");
  fixture.invalid_cases.forEach((entry) => {
    try {
      parseLaunchArguments(entry.args);
      failures.push(`${entry.id}: expected a fail-closed parse error`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== entry.error) failures.push(`${entry.id}: expected ${entry.error}, received ${message}`);
    }
  });
  return {failures, validCases: fixture.cases.length, invalidCases: fixture.invalid_cases.length};
}

if (import.meta.main) {
  const result = validateEntryPointFixture();
  result.failures.forEach((failure) => console.error(`ENTRY POINT ERROR: ${failure}`));
  if (result.failures.length > 0) process.exit(1);
  console.log(`ENTRY POINT CHECK: passed; ${result.validCases} valid cases and ${result.invalidCases} fail-closed cases`);
}
