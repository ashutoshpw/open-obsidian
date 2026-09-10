import {expect, test} from "bun:test";
import {editMarkdownProperty, parseMarkdown} from "../src/core/markdown.js";

test("markdown property edits preserve BOM, line endings and unknown source", () => {
  const source = Buffer.from("\uFEFF---\r\nstatus: open\r\nunknown: [keep, me]\r\ncomment: # untouched\r\n---\r\nBody\r\n", "utf8");
  const document = parseMarkdown(source);
  const edited = editMarkdownProperty(source, "status", "done");

  expect(document.hasBom).toBe(true);
  expect(document.lineEnding).toBe("\r\n");
  expect(document.properties.map((property) => property.key)).toEqual(["status", "unknown", "comment"]);
  expect(Buffer.from(edited).toString("utf8")).toBe("\uFEFF---\r\nstatus: done\r\nunknown: [keep, me]\r\ncomment: # untouched\r\n---\r\nBody\r\n");
});

test("markdown edits refuse unrepresented or malformed frontmatter", () => {
  const source = Buffer.from("---\nstatus: open\n", "utf8");
  expect(parseMarkdown(source).properties).toEqual([]);
  expect(() => editMarkdownProperty(source, "status", "done")).toThrow("not represented");
});
