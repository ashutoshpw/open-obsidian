import {expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {CHANNELS, validatePopoutOpenRequest} from "../src/shared/api.js";
import {auditRendererHtml} from "../scripts/check-accessibility.js";

const root = new URL("..", import.meta.url);
const main = readFileSync(new URL("src/electron/main.ts", root), "utf8");
const preload = readFileSync(new URL("src/electron/preload.ts", root), "utf8");
const renderer = readFileSync(new URL("src/renderer/renderer.ts", root), "utf8");
const mainHtml = readFileSync(new URL("src/renderer/index.html", root), "utf8");
const popout = readFileSync(new URL("src/renderer/popout.ts", root), "utf8");
const html = readFileSync(new URL("src/renderer/popout.html", root), "utf8");

test("popout IPC validates an absolute-vault identity and bounded relative note path", () => {
  expect(CHANNELS.popoutOpen).toBe("popout:open");
  expect(CHANNELS.popoutIntent).toBe("popout:intent");
  expect(validatePopoutOpenRequest({vaultRoot: "/tmp/vault", relativePath: "notes/one.md"})).toEqual({vaultRoot: "/tmp/vault", relativePath: "notes/one.md"});
  expect(() => validatePopoutOpenRequest({vaultRoot: "/tmp/vault", relativePath: "../outside.md"})).toThrow("Invalid workspace popout path");
  expect(() => validatePopoutOpenRequest({vaultRoot: "", relativePath: "notes/one.md"})).toThrow("Invalid popout open request");
});

test("popout host tracks one revision-aware child window per vault-relative note", () => {
  expect(main).toContain("popoutSessionsByWebContentsId");
  expect(main).toContain("createPopoutWindow");
  expect(main).toContain("assertPopoutPath");
  expect(main).toContain("CHANNELS.popoutIntent");
  expect(main).toContain("closePopoutWindows();");
  expect(preload).toContain("openPopout");
  expect(preload).toContain("onPopoutIntent");
  expect(mainHtml).toContain('id="popout-note"');
  expect(renderer).toContain("target.client.openPopout");
  expect(main).toContain("validateAppearanceEvent(event);");
});

test("popout renderer reads and writes only through revision-aware vault APIs", () => {
  expect(popout).toContain("client.readFile");
  expect(popout).toContain("client.writeFile");
  expect(popout).toContain("expectedRevision: revision");
  expect(popout).toContain("onPopoutIntent");
  expect(popout).toContain("event.metaKey || event.ctrlKey");
  expect(popout).toContain("client.loadAppearance");
  expect(popout).toContain("previewThemeAssets");
  expect(popout).toContain("data-openobsidian-theme-mode");
  expect(html).toContain('class="mod-popout"');
  expect(html).toContain('class="workspace workspace-leaf workspace-leaf-content view-content"');
  expect(html).toContain('id="appearance-status"');
  expect(html).toContain('aria-label="Markdown note editor popout"');
  expect(html).toContain('role="status" aria-live="polite"');
  expect(auditRendererHtml(html).failures).toEqual([]);
});
