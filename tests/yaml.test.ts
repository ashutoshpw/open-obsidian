import {expect, test} from "bun:test";
import {parseYamlMapping} from "../src/core/yaml.js";

test("bounded YAML reader preserves nested maps, arrays and scalar types", () => {
  const result = parseYamlMapping("tags:\n  - one\n  - two\nmetadata:\n  owner: Ashutosh # source comment\n  numbers: [1, true, null]\n  children:\n    - key: value\n      count: 2\n");

  expect(result.issues).toEqual([]);
  expect(result.value).toEqual({tags: ["one", "two"], metadata: {owner: "Ashutosh", numbers: [1, true, null], children: [{key: "value", count: 2}]}});
});

test("unsupported YAML block scalars are reported without rewriting source", () => {
  const result = parseYamlMapping("summary: |\n  source stays authoritative\n");

  expect(result.issues).toEqual(["line 1: literal YAML blocks are preserved as raw source but not structured"]);
  expect(result.value.summary).toBe("|");
});
