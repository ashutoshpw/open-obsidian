import {expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {parseInlineMarkdown, parseMarkdownPreview} from "../src/core/markdown-preview.js";

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
    "```base",
    "views:",
    "  - type: table",
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
  expect(blocks.map((block) => block.kind)).toEqual(["heading", "list", "list", "table", "quote", "code", "base", "unsupported", "unsupported", "unsupported", "unsupported"]);
  expect(blocks[0]).toMatchObject({kind: "heading", level: 1, text: "Title ==highlight=="});
  expect(blocks[1]).toMatchObject({kind: "list", ordered: false, items: ["one", "two"]});
  expect(blocks[2]).toMatchObject({kind: "list", ordered: true, items: ["first", "second"]});
  expect(blocks[3]).toMatchObject({kind: "table", headers: ["Name", "Status"], rows: [["Note", "open"]]});
  expect(blocks[4]).toMatchObject({kind: "quote", text: "NOTE: Read-only callout"});
  expect(blocks[5]).toMatchObject({kind: "code", language: "ts", text: "const value = 1;"});
  expect(blocks[6]).toMatchObject({kind: "base", text: "views:\n  - type: table"});
  expect(blocks.slice(7).map((block) => block.kind === "unsupported" ? block.syntax : "")).toEqual(["diagram", "footnote", "math", "html"]);
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

test("Markdown preview groups richer blocks without rewriting their source text", () => {
  const blocks = parseMarkdownPreview("Setext heading\n===\n\nParagraph line one\nline two\n\n> first line\n>\n> second line\n\n---\n\n~~~ts\nconst value = 1;\n~~~");
  expect(blocks).toEqual([
    {kind: "heading", level: 1, text: "Setext heading"},
    {kind: "paragraph", text: "Paragraph line one\nline two"},
    {kind: "quote", text: "first line\n\nsecond line"},
    {kind: "thematic-break"},
    {kind: "code", language: "ts", text: "const value = 1;"},
  ]);
});

test("Markdown preview keeps embedded Base definitions as inert source blocks", () => {
  const blocks = parseMarkdownPreview("Before\n\n~~~base\nviews:\n  - type: list\n~~~\n\nAfter");
  expect(blocks).toEqual([
    {kind: "paragraph", text: "Before"},
    {kind: "base", text: "views:\n  - type: list"},
    {kind: "paragraph", text: "After"},
  ]);
});

test("shared inline Markdown segments are safe for DOM or native renderers", () => {
  expect(parseInlineMarkdown("==mark== **bold** *italic* ~~old~~ `code` [docs](https://example.com) [[Note|open]] <script>")).toEqual([
    {kind: "highlight", text: "mark"},
    {kind: "text", text: " "},
    {kind: "strong", text: "bold"},
    {kind: "text", text: " "},
    {kind: "emphasis", text: "italic"},
    {kind: "text", text: " "},
    {kind: "strikethrough", text: "old"},
    {kind: "text", text: " "},
    {kind: "code", text: "code"},
    {kind: "text", text: " "},
    {kind: "link", text: "docs", target: "https://example.com"},
    {kind: "text", text: " "},
    {kind: "wiki-link", text: "open", target: "Note"},
    {kind: "text", text: " <script>"},
  ]);
});

test("inline embeds preserve targets, fragments, labels and dimensions without loading assets", () => {
  expect(parseInlineMarkdown("![[Images/photo.png#crop|320x180]] ![[Note#Overview|caption]] ![Alt text](Images/photo.png#crop|320x180)")).toEqual([
    {kind: "embed", text: "Images/photo.png", target: "Images/photo.png", fragment: "crop", width: 320, height: 180},
    {kind: "text", text: " "},
    {kind: "embed", text: "caption", target: "Note", fragment: "Overview"},
    {kind: "text", text: " "},
    {kind: "embed", text: "Alt text", target: "Images/photo.png", fragment: "crop", width: 320, height: 180},
  ]);
});

test("inline embeds keep one-dimensional sizing structured and escaped syntax inert", () => {
  expect(parseInlineMarkdown("![[diagram.svg|640]] \\![[not-an-embed]]")).toEqual([
    {kind: "embed", text: "diagram.svg", target: "diagram.svg", width: 640},
    {kind: "text", text: " \\![[not-an-embed]]"},
  ]);
});
