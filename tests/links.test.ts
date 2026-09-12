import {expect, test} from "bun:test";
import {extractLinks, resolveLink, sliceLinkSubpath, updateLinksOnRename} from "../src/core/links.js";
import {MAX_TRANSCLUSION_DEPTH, guardTransclusion, resolveNoteEmbed, selectTransclusionSource, withinTransclusionSourceLimit} from "../src/core/transclusion.js";

test("link extraction keeps embeds, aliases, subpaths and markdown targets distinct", () => {
  const links = extractLinks("[[Notes/Target|alias]] ![[Images/photo.png]] [target](Notes/Target.md#heading)");
  expect(links.map((link) => link.kind)).toEqual(["wikilink", "embed", "markdown"]);
  expect(links[0]).toMatchObject({target: "Notes/Target", alias: "alias"});
  expect(links[1]).toMatchObject({target: "Images/photo.png"});
  expect(links[2]).toMatchObject({target: "Notes/Target.md", subpath: "heading"});
});

test("link resolution reports resolved, ambiguous and unresolved targets", () => {
  const [resolved, ambiguous, missing] = extractLinks("[[Target]] [[Target]] [[Missing]]");
  expect(resolveLink(resolved!, ["Target.md"])).toMatchObject({status: "resolved", target: "Target.md"});
  expect(resolveLink(ambiguous!, ["Target.md", "Target"])).toMatchObject({status: "ambiguous"});
  expect(resolveLink(missing!, ["Other.md"])).toMatchObject({status: "unresolved"});
});

test("source-aware link resolution validates headings, block IDs, duplicates and current-note subpaths", () => {
  const source = [
    "[[Target#Overview]] [[Target#^intro]] [[Target#Missing]] [[#Overview]]",
    "[[Target#Duplicate]] [[Target#^code]]",
  ].join("\n");
  const target = "# Overview\n\nOpening paragraph ^intro\n\n## Duplicate\n## Duplicate\n\n```md\n# Overview\nnot a block ^code\n```\n";
  const links = extractLinks(source);
  const sources = new Map([["Target.md", target]]);

  expect(resolveLink(links[0]!, ["Target.md"], "Index.md", sources)).toMatchObject({status: "resolved", target: "Target.md"});
  expect(resolveLink(links[1]!, ["Target.md"], "Index.md", sources)).toMatchObject({status: "resolved", target: "Target.md"});
  expect(resolveLink(links[2]!, ["Target.md"], "Index.md", sources)).toMatchObject({status: "unresolved", candidates: ["Target.md"]});
  expect(resolveLink(links[3]!, ["Target.md"], "Target.md", new Map([["Target.md", "# Overview\n"]]))).toMatchObject({status: "resolved", target: "Target.md"});
  expect(resolveLink(links[4]!, ["Target.md"], "Index.md", sources)).toMatchObject({status: "ambiguous", candidates: ["Target.md"]});
  expect(resolveLink(links[5]!, ["Target.md"], "Index.md", sources)).toMatchObject({status: "unresolved", candidates: ["Target.md"]});
});

test("rename updates only matching link targets and preserves aliases and subpaths", () => {
  const source = "[[Old|keep alias]] [Old](Old.md) ![[Old#block]] [[Older]]";
  expect(updateLinksOnRename(source, "Old.md", "Archive/New.md")).toBe("[[Archive/New|keep alias]] [Old](Archive/New.md) ![[Archive/New#block]] [[Older]]");
});

test("note transclusion resolves only Markdown notes and validates source-aware subpaths", () => {
  const files = ["Index.md", "Notes/Target.md", "Archive/Target.md", "Notes/photo.png"];
  const source = "# Overview\n\nVisible paragraph\n\n## Details\nDetails paragraph ^details\n\n```md\n# Overview\nnot a heading target\n```\n";
  expect(resolveNoteEmbed({target: "Target"}, files, "Index.md")).toMatchObject({status: "ambiguous"});
  expect(resolveNoteEmbed({target: "photo.png"}, files, "Index.md")).toMatchObject({status: "unresolved"});
  expect(resolveNoteEmbed({target: "Notes/Target", fragment: "Details"}, files, "Index.md", new Map([["Notes/Target.md", source]]))).toMatchObject({status: "resolved", target: "Notes/Target.md"});
  expect(resolveNoteEmbed({target: "Notes/Target", fragment: "Missing"}, files, "Index.md", new Map([["Notes/Target.md", source]]))).toMatchObject({status: "unresolved"});
  expect(resolveNoteEmbed({target: "https://example.test/note.md"}, files, "Index.md")).toMatchObject({status: "external"});
});

test("transclusion slices headings and block IDs without entering fenced source", () => {
  const source = "# Overview\n\nVisible paragraph\n\n## Details\nDetails paragraph ^details\n\n## Next\nNext paragraph\n\n```md\n# Overview\nnot a heading target\n```\n";
  expect(selectTransclusionSource(source, "Overview")).toMatchObject({status: "resolved", text: "# Overview\n\nVisible paragraph\n\n## Details\nDetails paragraph ^details\n\n## Next\nNext paragraph\n\n```md\n# Overview\nnot a heading target\n```\n"});
  expect(selectTransclusionSource(source, "Details")).toMatchObject({status: "resolved", text: "## Details\nDetails paragraph ^details\n"});
  expect(selectTransclusionSource(source, "^details")).toMatchObject({status: "resolved", text: "Details paragraph"});
  expect(sliceLinkSubpath(source, "Overview").status).toBe("resolved");
  expect(selectTransclusionSource(source, "Missing")).toEqual({status: "unresolved"});
});

test("transclusion depth, cycle and source-byte bounds fail closed", () => {
  expect(guardTransclusion(0, ["Index.md"], "Notes/Target.md")).toEqual({allowed: true, nextDepth: 1, chain: ["Index.md", "Notes/Target.md"]});
  expect(guardTransclusion(1, ["Index.md", "Notes/Target.md"], "Index.md")).toEqual({allowed: false, reason: "cycle"});
  expect(guardTransclusion(MAX_TRANSCLUSION_DEPTH, ["Index.md"], "Notes/Target.md")).toEqual({allowed: false, reason: "depth"});
  expect(withinTransclusionSourceLimit("a".repeat(700_000))).toBe(false);
  expect(withinTransclusionSourceLimit("a".repeat(100))).toBe(true);
});
