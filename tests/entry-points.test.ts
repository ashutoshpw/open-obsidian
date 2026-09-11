import {expect, test} from "bun:test";
import {parseDeepLinkIntent, parseLaunchArguments} from "../src/shared/entry-points.js";
import {validateEntryPointFixture} from "../scripts/validate-entry-points.js";

test("entry-point fixture keeps explicit CLI/deep-link behavior executable", () => {
  const result = validateEntryPointFixture();
  expect(result.failures).toEqual([]);
  expect(result.validCases).toBe(5);
  expect(result.invalidCases).toBe(3);
});

test("only the OpenObsidian protocol is parsed", () => {
  expect(parseDeepLinkIntent("obsidian://open?vault=%2Ftmp%2Fvault")).toBeNull();
  expect(parseLaunchArguments(["obsidian://open?vault=%2Ftmp%2Fvault", "--no-sandbox"])).toBeNull();
  expect(parseDeepLinkIntent("openobsidian://open?vault=%2Ftmp%2Fvault")).toEqual({source: "deep-link", vaultPath: "/tmp/vault", relativePath: null});
});

test("entry-point file paths stay vault-relative and traversal-free", () => {
  expect(() => parseLaunchArguments(["--vault", "/tmp/vault", "--open", "../outside.md"])).toThrow("safe vault-relative path");
  expect(() => parseLaunchArguments(["--vault", "/tmp/vault", "--open", "folder\\note.md"])).toThrow("safe vault-relative path");
  expect(() => parseLaunchArguments(["--open", "note.md"])).toThrow("requires --vault");
});
