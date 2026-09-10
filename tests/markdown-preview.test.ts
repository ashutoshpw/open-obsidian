import {expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {parseMarkdownPreview} from "../src/core/markdown-preview.js";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/markdown-dialects.json", import.meta.url), "utf8")) as {schema_version: number; supported_blocks: string[]; visible_unsupported_blocks: string[]; invariants: Record<string, boolean>};

test("Markdown dialect fixture renders supported blocks and labels unsafe or unsupported syntax", () => {
  const source = [
    "# Title ==highlight==",
    "",
    "- one",
    "- two",
    "1. first",
    "2. second",
    "",
    "| Name | Status |",
    "| --- | :---: |",
    "| Note | open |",
    "",
    "> [!NOTE] Read-only callout",
    "",
    "```ts",
    "const value = 1;",
    "```",
    "```mermaid",
    "graph TD;",
    "```",
    "[^1]: footnote",
    "$$ x + y $$",
    "<script>unsafe()</script>",
  ].join("\n");
  const blocks = parseMarkdownPreview(source);
  expect(fixture.schema_version).toBe(1);
  expect(fixture.supported_blocks).toContain("tables");
  expect(fixture.visible_unsupported_blocks).toEqual(["footnotes", "math", "diagrams", "raw-html"]);
  expect(Object.entries(fixture.invariants).filter(([key]) => key !== "code_and_diagram_execution").every(([, value]) => value)).toBe(true);
  expect(fixture.invariants.code_and_diagram_execution).toBe(false);
  expect(blocks.map((block) => block.kind)).toEqual(["heading", "list", "list", "table", "quote", "code", "unsupported", "unsupported", "unsupported", "unsupported"]);
  expect(blocks[0]).toMatchObject({kind: "heading", level: 1, text: "Title ==highlight=="});
  expect(blocks[1]).toMatchObject({kind: "list", ordered: false, items: ["one", "two"]});
  expect(blocks[2]).toMatchObject({kind: "list", ordered: true, items: ["first", "second"]});
  expect(blocks[3]).toMatchObject({kind: "table", headers: ["Name", "Status"], rows: [["Note", "open"]]});
  expect(blocks[4]).toMatchObject({kind: "quote", text: "NOTE: Read-only callout"});
  expect(blocks[5]).toMatchObject({kind: "code", language: "ts", text: "const value = 1;"});
  expect(blocks.slice(6).map((block) => block.kind === "unsupported" ? block.syntax : "")).toEqual(["diagram", "footnote", "math", "html"]);
  expect(source).toContain("<script>unsafe()</script>");
});

test("Markdown preview keeps task state and does not execute fenced source", () => {
  const blocks = parseMarkdownPreview("- [x] done\n- [ ] later\n```dataviewjs\nawait dangerous()\n```");
  expect(blocks[0]).toMatchObject({kind: "task", checked: true, text: "done"});
  expect(blocks[1]).toMatchObject({kind: "task", checked: false, text: "later"});
  const code = blocks[2];
  expect(code).toMatchObject({kind: "unsupported", syntax: "diagram"});
  expect(JSON.stringify(code)).toContain("await dangerous()");
});
