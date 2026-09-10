import {expect, test} from "bun:test";
import {extractLinks, resolveLink, updateLinksOnRename} from "../src/core/links.js";

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

test("rename updates only matching link targets and preserves aliases and subpaths", () => {
  const source = "[[Old|keep alias]] [Old](Old.md) ![[Old#block]] [[Older]]";
  expect(updateLinksOnRename(source, "Old.md", "Archive/New.md")).toBe("[[Archive/New|keep alias]] [Old](Archive/New.md) ![[Archive/New#block]] [[Older]]");
});
