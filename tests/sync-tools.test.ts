import {expect, test} from "bun:test";
import {syncToolDispositions} from "../src/core/sync-tools.js";

test("external sync dispositions name the boundary without implying proprietary service access", () => {
  const tools = syncToolDispositions();
  expect(tools.map((tool) => tool.name)).toEqual(["Built-in Chronicle Git", "Remotely Save", "Syncthing", "Dropbox / OneDrive", "Obsidian Sync / Publish"]);
  expect(tools.find((tool) => tool.id === "chronicle-git")?.mode).toBe("built-in");
  expect(tools.find((tool) => tool.id === "obsidian-sync-publish")?.mode).toBe("unsupported");
  expect(tools.every((tool) => tool.remoteContacted === false && tool.verification === "contract-only")).toBe(true);
});
