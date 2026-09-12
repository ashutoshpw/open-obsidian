import {expect, test} from "bun:test";
import {parseYamlMapping, serializeYamlValue, yamlFlowMapEntries} from "../src/core/yaml.js";

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

test("bounded YAML serializer round-trips representable maps and preserves scalar types", () => {
  const value = {title: "A # literal", flags: ["one", true, null], nested: {"display name": "Ashutosh", count: 2}};
  const source = serializeYamlValue(value);

  expect(source).toBe('title: "A # literal"\nflags:\n  - "one"\n  - true\n  - null\nnested:\n  "display name": "Ashutosh"\n  count: 2');
  expect(parseYamlMapping(source)).toEqual({value, issues: []});
  expect(serializeYamlValue(value, {style: "flow"})).toBe('{title: "A # literal", flags: ["one", true, null], nested: {"display name": "Ashutosh", count: 2}}');
});

test("bounded YAML serializer rejects unsafe numbers and indentation", () => {
  expect(() => serializeYamlValue(Number.NaN)).toThrow("finite");
  expect(() => serializeYamlValue({value: true}, {indent: 0})).toThrow("indentation");
});

test("flow YAML map spans preserve nested source boundaries and refuse malformed entries", () => {
  const source = "{owner: Ashutosh, nested: {name: source}, tags: [one, two]}";
  expect(yamlFlowMapEntries(source)).toEqual([
    {key: "owner", rawValue: "Ashutosh", valueStart: 8, valueEnd: 16},
    {key: "nested", rawValue: "{name: source}", valueStart: 26, valueEnd: 40},
    {key: "tags", rawValue: "[one, two]", valueStart: 48, valueEnd: 58},
  ]);
  expect(yamlFlowMapEntries("{owner: broken, nope}")).toBeUndefined();
});
