import {expect, test} from "bun:test";
import {editMarkdownNestedPropertyValue, editMarkdownProperty, editMarkdownPropertyValue, extractMarkdownHeadings, parseMarkdown} from "../src/core/markdown.js";

const preservationFixture = JSON.parse(await Bun.file(new URL("../fixtures/markdown-property-preservation.json", import.meta.url)).text()) as {schema_version: number; invariants: Record<string, boolean>};

test("markdown property edits preserve BOM, line endings and unknown source", () => {
  const source = Buffer.from("\uFEFF---\r\nstatus: open\r\nunknown: [keep, me]\r\ncomment: # untouched\r\n---\r\nBody\r\n", "utf8");
  const document = parseMarkdown(source);
  const edited = editMarkdownProperty(source, "status", "done");
  const commentEdited = editMarkdownProperty(source, "comment", "kept");

  expect(document.hasBom).toBe(true);
  expect(document.lineEnding).toBe("\r\n");
  expect(document.properties.map((property) => property.key)).toEqual(["status", "unknown", "comment"]);
  expect(Buffer.from(edited).toString("utf8")).toBe("\uFEFF---\r\nstatus: done\r\nunknown: [keep, me]\r\ncomment: # untouched\r\n---\r\nBody\r\n");
  expect(Buffer.from(commentEdited).toString("utf8")).toContain("comment: kept # untouched");
  expect(document.yamlIssues).toEqual([]);
  expect(document.properties.find((property) => property.key === "unknown")?.value).toEqual(["keep", "me"]);
  expect(document.properties.find((property) => property.key === "comment")?.rawValue).toBe("");
});

test("markdown edits refuse unrepresented or malformed frontmatter", () => {
  const source = Buffer.from("---\nstatus: open\n", "utf8");
  expect(parseMarkdown(source).properties).toEqual([]);
  expect(() => editMarkdownProperty(source, "status", "done")).toThrow("not represented");
});

test("represented property edits preserve nested values, comments and ordering", () => {
  const source = Buffer.from("---\r\nstatus: open\r\nmetadata:\r\n  owner: Ashutosh # keep this comment\r\n  labels:\r\n    - one\r\nunknown: [keep, me]\r\n---\r\nBody\r\n", "utf8");
  const edited = editMarkdownProperty(source, "status", "done");

  expect(preservationFixture.schema_version).toBe(1);
  expect(Object.values(preservationFixture.invariants).every(Boolean)).toBe(true);
  expect(Buffer.from(edited).toString("utf8")).toBe("---\r\nstatus: done\r\nmetadata:\r\n  owner: Ashutosh # keep this comment\r\n  labels:\r\n    - one\r\nunknown: [keep, me]\r\n---\r\nBody\r\n");
  expect(parseMarkdown(edited).properties.map((property) => property.key)).toEqual(["status", "metadata", "unknown"]);
  expect(parseMarkdown(edited).properties.find((property) => property.key === "metadata")?.value).toEqual({owner: "Ashutosh", labels: ["one"]});
  expect(parseMarkdown(edited).yamlIssues).toEqual([]);
});

test("typed Markdown property edits use bounded flow YAML and refuse nested blocks", () => {
  const source = Buffer.from("---\nstatus: open # keep this\nmetadata:\n  owner: Ashutosh\n---\nBody\n", "utf8");
  const edited = editMarkdownPropertyValue(source, "status", ["done", "later"]);

  expect(Buffer.from(edited).toString("utf8")).toBe("---\nstatus: [\"done\", \"later\"] # keep this\nmetadata:\n  owner: Ashutosh\n---\nBody\n");
  expect(parseMarkdown(edited).properties.find((property) => property.key === "status")?.value).toEqual(["done", "later"]);
  expect(() => editMarkdownPropertyValue(source, "metadata", {owner: "changed"})).toThrow("inline value");
});

test("nested Markdown leaf edits preserve block siblings, comments and source framing", () => {
  const source = Buffer.from("\uFEFF---\r\nmetadata:\r\n  owner: Ashutosh # keep this comment\r\n  labels:\r\n    - one\r\nunknown: [keep, me]\r\n---\r\nBody\r\n", "utf8");
  const edited = editMarkdownNestedPropertyValue(source, ["metadata", "owner"], "Ada");

  expect(Buffer.from(edited).toString("utf8")).toBe("\uFEFF---\r\nmetadata:\r\n  owner: \"Ada\" # keep this comment\r\n  labels:\r\n    - one\r\nunknown: [keep, me]\r\n---\r\nBody\r\n");
  expect(parseMarkdown(edited).properties.find((property) => property.key === "metadata")?.value).toEqual({owner: "Ada", labels: ["one"]});
  expect(parseMarkdown(edited).yamlIssues).toEqual([]);
});

test("nested Markdown leaf edits support flow maps and refuse flow sequences and block scalars", () => {
  const flow = Buffer.from("---\nmetadata: {owner: Ashutosh, nested: {name: source}} # keep this\n---\n", "utf8");
  const flowEdited = editMarkdownNestedPropertyValue(flow, ["metadata", "nested", "name"], "changed");
  expect(Buffer.from(flowEdited).toString("utf8")).toBe("---\nmetadata: {owner: Ashutosh, nested: {name: \"changed\"}} # keep this\n---\n");
  expect(parseMarkdown(flowEdited).properties.find((property) => property.key === "metadata")?.value).toEqual({owner: "Ashutosh", nested: {name: "changed"}});
  const flowSequence = Buffer.from("---\nmetadata: [owner, Ashutosh]\n---\n", "utf8");
  const sequence = Buffer.from("---\nmetadata:\n  - owner: Ashutosh\n---\n", "utf8");
  const block = Buffer.from("---\nmetadata:\n  summary: |\n    source stays authoritative\n---\n", "utf8");

  expect(() => editMarkdownNestedPropertyValue(flowSequence, ["metadata", "owner"], "Ada")).toThrow("unsupported flow sequence");
  expect(() => editMarkdownNestedPropertyValue(sequence, ["metadata", "owner"], "Ada")).toThrow("unsupported sequence");
  expect(() => editMarkdownNestedPropertyValue(block, ["metadata", "summary"], "changed")).toThrow("inline value");
});

test("nested Markdown leaf edits address explicitly indexed sequence maps", () => {
  const source = Buffer.from("---\r\nmetadata:\r\n  children:\r\n    - owner: Ashutosh # keep this comment\r\n      role: maintainer\r\n    - owner: Bea\r\nunknown: [keep, me]\r\n---\r\nBody\r\n", "utf8");
  const edited = editMarkdownNestedPropertyValue(source, ["metadata", "children", 0, "owner"], "Ada");

  expect(Buffer.from(edited).toString("utf8")).toBe("---\r\nmetadata:\r\n  children:\r\n    - owner: \"Ada\" # keep this comment\r\n      role: maintainer\r\n    - owner: Bea\r\nunknown: [keep, me]\r\n---\r\nBody\r\n");
  expect(parseMarkdown(edited).properties.find((property) => property.key === "metadata")?.value).toEqual({children: [{owner: "Ada", role: "maintainer"}, {owner: "Bea"}]});
});

test("nested Markdown leaf edits support bare sequence map items and refuse ambiguous paths", () => {
  const source = Buffer.from("---\nmetadata:\n  children:\n    -\n      owner: Ashutosh\n      role: maintainer\nunknown: keep\n---\n", "utf8");
  const edited = editMarkdownNestedPropertyValue(source, ["metadata", "children", 0, "owner"], "Ada");
  expect(Buffer.from(edited).toString("utf8")).toBe("---\nmetadata:\n  children:\n    -\n      owner: \"Ada\"\n      role: maintainer\nunknown: keep\n---\n");
  expect(() => editMarkdownNestedPropertyValue(source, ["metadata", "children", "owner"], "Ada")).toThrow("unsupported sequence");
  expect(() => editMarkdownNestedPropertyValue(source, ["metadata", "children", 1, "owner"], "Ada")).toThrow("not represented");
  expect(() => editMarkdownNestedPropertyValue(source, ["metadata", "children", 0], "Ada")).toThrow("mapping key");
});

test("markdown outline extraction ignores fenced headings and preserves source line numbers", () => {
  const headings = extractMarkdownHeadings("# Top\ntext\n```md\n## ignored\n```\n  ### Child ###\n");
  expect(headings).toEqual([{text: "Top", level: 1, line: 1}, {text: "Child", level: 3, line: 6}]);
});
