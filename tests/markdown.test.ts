import {expect, test} from "bun:test";
import {editMarkdownProperty, extractMarkdownHeadings, parseMarkdown} from "../src/core/markdown.js";

const preservationFixture = JSON.parse(await Bun.file(new URL("../fixtures/markdown-property-preservation.json", import.meta.url)).text()) as {schema_version: number; invariants: Record<string, boolean>};

test("markdown property edits preserve BOM, line endings and unknown source", () => {
  const source = Buffer.from("\uFEFF---\r\nstatus: open\r\nunknown: [keep, me]\r\ncomment: # untouched\r\n---\r\nBody\r\n", "utf8");
  const document = parseMarkdown(source);
  const edited = editMarkdownProperty(source, "status", "done");

  expect(document.hasBom).toBe(true);
  expect(document.lineEnding).toBe("\r\n");
  expect(document.properties.map((property) => property.key)).toEqual(["status", "unknown", "comment"]);
  expect(Buffer.from(edited).toString("utf8")).toBe("\uFEFF---\r\nstatus: done\r\nunknown: [keep, me]\r\ncomment: # untouched\r\n---\r\nBody\r\n");
  expect(document.yamlIssues).toEqual([]);
  expect(document.properties.find((property) => property.key === "unknown")?.value).toEqual(["keep", "me"]);
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

test("markdown outline extraction ignores fenced headings and preserves source line numbers", () => {
  const headings = extractMarkdownHeadings("# Top\ntext\n```md\n## ignored\n```\n  ### Child ###\n");
  expect(headings).toEqual([{text: "Top", level: 1, line: 1}, {text: "Child", level: 3, line: 6}]);
});
