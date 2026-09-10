import {expect, test} from "bun:test";
import {readFileSync} from "node:fs";

const root = new URL("..", import.meta.url);
const fixture = JSON.parse(readFileSync(new URL("fixtures/workspace-journeys.json", root), "utf8")) as {schema_version: number; shortcuts: Array<{key: string; command: string}>; journeys: Array<{steps: string[]}>; external_pending: string[]};
const renderer = readFileSync(new URL("src/renderer/renderer.ts", root), "utf8");
const html = readFileSync(new URL("src/renderer/index.html", root), "utf8");

test("workspace journey fixture covers keyboard commands and visible entry points", () => {
  expect(fixture.schema_version).toBe(1);
  expect(fixture.shortcuts.map((shortcut) => shortcut.command)).toEqual(["command-palette", "quick-switcher", "save-note"]);
  expect(fixture.journeys.every((journey) => journey.steps.length > 0)).toBe(true);
  expect(fixture.external_pending).toContain("visible-electron-keyboard-run");
  expect(fixture.external_pending).toContain("visible-electron-grounded-citation-run");
  for (const id of fixture.journeys.flatMap((journey) => journey.steps)) expect(html.includes(`id="${id}"`) || renderer.includes(`#${id}`)).toBe(true);
  expect(renderer).toContain("event.key.toLowerCase()");
  expect(renderer).toContain("openCommandPalette");
  expect(renderer).toContain("provider destination: none");
});
