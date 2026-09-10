import {expect, test} from "bun:test";
import {editCanvasTextNode, parseCanvas, createNoteFromTextNode, encodeCanvas} from "../src/core/canvas.js";
import {buildVaultGraph} from "../src/core/graph.js";

const fixture = await Bun.file(new URL("../fixtures/derived-surfaces.json", import.meta.url)).json() as {schema_version: number; graph: {node_kinds: string[]; grouping: string}; canvas: {node_types: string[]; preserve: string[]}; invariants: Record<string, boolean>};

test("canvas edits preserve unknown fields and only create notes explicitly", () => {
  const source = Buffer.from(JSON.stringify({nodes: [{id: "text-1", type: "text", text: "draft", x: 10, y: 20, width: 300, height: 120, styleAttributes: {color: "#fff"}, unknownNode: {keep: true}}, {id: "file-1", type: "file", file: "Notes/Target.md", subpath: "#Heading", label: "Target"}, {id: "link-1", type: "link", url: "https://example.com", label: "Web"}, {id: "group-1", type: "group", children: ["text-1", "file-1"], style: {background: "blue"}}], edges: [{id: "edge-1", fromNode: "text-1", toNode: "file-1", label: "relates", unknownEdge: {keep: true}}], unknownRoot: "preserve"}));
  expect(fixture.schema_version).toBe(1);
  expect(fixture.canvas.node_types).toEqual(["text", "file", "link", "group"]);
  expect(fixture.canvas.preserve).toContain("subpaths");
  expect(parseCanvas(encodeCanvas({nodes: [], edges: [], unknownRoot: "round-trip"})).unknownRoot).toBe("round-trip");
  const edited = editCanvasTextNode(source, "text-1", "updated");
  const document = parseCanvas(edited);
  expect(document.unknownRoot).toBe("preserve");
  expect(document.nodes.map((node) => node.type)).toEqual(["text", "file", "link", "group"]);
  expect(document.nodes[0]).toMatchObject({text: "updated", unknownNode: {keep: true}});
  expect(document.nodes[1]).toMatchObject({file: "Notes/Target.md", subpath: "#Heading", label: "Target"});
  expect(document.edges[0]).toMatchObject({fromNode: "text-1", toNode: "file-1", unknownEdge: {keep: true}});
  expect(createNoteFromTextNode(edited, "text-1", "created.md")).toMatchObject({path: "created.md"});
});

test("graph derives resolved and unresolved links without changing source files", () => {
  expect(fixture.graph.node_kinds).toEqual(["file", "attachment", "unresolved"]);
  expect(fixture.graph.grouping).toBe("folder");
  const graph = buildVaultGraph({
    schema_version: 1,
    vaultRoot: "/tmp/vault",
    builtAt: "2026-09-10T00:00:00Z",
    sourceSnapshot: "snapshot",
    files: [
      {relativePath: "A.md", bytes: 1, sha256: "a", searchText: "", links: [{kind: "wikilink", raw: "[[B]]", target: "B", start: 0, end: 5, targetStart: 2, targetEnd: 3, resolution: {status: "resolved", target: "B.md", candidates: ["B.md"]}}]},
      {relativePath: "B.md", bytes: 1, sha256: "b", searchText: "", links: []},
      {relativePath: "assets/image.png", bytes: 4, sha256: "image", searchText: undefined, links: []},
      {relativePath: "C.md", bytes: 1, sha256: "c", searchText: "", links: [{kind: "wikilink", raw: "[[Missing]]", target: "Missing", start: 0, end: 10, targetStart: 2, targetEnd: 9, resolution: {status: "unresolved", candidates: ["Missing", "Missing.md"]}}]},
    ],
  });
  expect(graph.edges).toHaveLength(2);
  expect(graph.nodes.find((node) => node.kind === "unresolved")?.label).toBe("Missing");
  expect(graph.nodes.find((node) => node.id === "assets/image.png")?.kind).toBe("attachment");
  expect(graph.groups.find((group) => group.id === "assets")?.nodeIds).toEqual(["assets/image.png"]);
  expect(graph.layout).toBe("force");
});
