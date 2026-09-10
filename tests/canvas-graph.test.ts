import {expect, test} from "bun:test";
import {editCanvasTextNode, parseCanvas, createNoteFromTextNode, encodeCanvas} from "../src/core/canvas.js";
import {buildVaultGraph} from "../src/core/graph.js";

test("canvas edits preserve unknown fields and only create notes explicitly", () => {
  const source = Buffer.from(JSON.stringify({nodes: [{id: "text-1", type: "text", text: "draft", unknownNode: {keep: true}}], edges: [], unknownRoot: "preserve"}));
  expect(parseCanvas(encodeCanvas({nodes: [], edges: [], unknownRoot: "round-trip"})).unknownRoot).toBe("round-trip");
  const edited = editCanvasTextNode(source, "text-1", "updated");
  const document = parseCanvas(edited);
  expect(document.unknownRoot).toBe("preserve");
  expect(document.nodes[0]).toMatchObject({text: "updated", unknownNode: {keep: true}});
  expect(createNoteFromTextNode(edited, "text-1", "created.md")).toMatchObject({path: "created.md"});
});

test("graph derives resolved and unresolved links without changing source files", () => {
  const graph = buildVaultGraph({
    schema_version: 1,
    vaultRoot: "/tmp/vault",
    builtAt: "2026-09-10T00:00:00Z",
    sourceSnapshot: "snapshot",
    files: [
      {relativePath: "A.md", bytes: 1, sha256: "a", searchText: "", links: [{kind: "wikilink", raw: "[[B]]", target: "B", start: 0, end: 5, targetStart: 2, targetEnd: 3, resolution: {status: "resolved", target: "B.md", candidates: ["B.md"]}}]},
      {relativePath: "B.md", bytes: 1, sha256: "b", searchText: "", links: []},
      {relativePath: "C.md", bytes: 1, sha256: "c", searchText: "", links: [{kind: "wikilink", raw: "[[Missing]]", target: "Missing", start: 0, end: 10, targetStart: 2, targetEnd: 9, resolution: {status: "unresolved", candidates: ["Missing", "Missing.md"]}}]},
    ],
  });
  expect(graph.edges).toHaveLength(2);
  expect(graph.nodes.find((node) => node.kind === "unresolved")?.label).toBe("Missing");
});
