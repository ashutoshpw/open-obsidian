import {expect, test} from "bun:test";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {resolveAttachment} from "../src/core/attachments.js";
import {configurationIsReadOnlyBeforeAfter, discoverVaultConfiguration, hasExistingConfiguration} from "../src/core/configuration.js";
import {parseThemeStylesheet} from "../src/shared/ui/index.js";
import {auditThemeAssets} from "../scripts/audit-theme-assets.js";
import {VaultStore, snapshotVault} from "../src/core/vault.js";

test("configuration discovery maps existing folders without writing them", () => {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-config-vault-"));
  try {
    mkdirSync(join(root, ".obsidian"));
    mkdirSync(join(root, ".obsidian-mobile"));
    writeFileSync(join(root, ".obsidian", "app.json"), "{\"showLineNumber\":true}\n");
    writeFileSync(join(root, ".obsidian-mobile", "appearance.json"), "{\"theme\":\"dark\"}\n");
    const before = snapshotVault(root);
    const result = configurationIsReadOnlyBeforeAfter(root, () => discoverVaultConfiguration(root));

    expect(hasExistingConfiguration(root)).toBe(true);
    expect(result.unchanged).toBe(true);
    expect(result.after.folders).toEqual([".obsidian", ".obsidian-mobile"]);
    expect(result.after.json[".obsidian/app.json"]?.showLineNumber).toBe(true);
    expect(result.after.appearance[".obsidian-mobile/appearance.json"]).toMatchObject({mode: "dark"});
    expect(result.after.styles).toEqual([]);
    expect(snapshotVault(root).sha256).toBe(before.sha256);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test("configuration discovery maps theme and snippet CSS without modifying source bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-style-vault-"));
  try {
    mkdirSync(join(root, ".obsidian", "themes"), {recursive: true});
    mkdirSync(join(root, ".obsidian", "snippets"), {recursive: true});
    writeFileSync(join(root, ".obsidian", "appearance.json"), JSON.stringify({cssTheme: "Minimal", mode: "dark", enabledCssSnippets: ["focus"]}));
    const theme = Buffer.from("body.theme-dark { --accent-h: 260; } .workspace .view-header { color: var(--text-normal); } .workspace-leaf-content[data-type=\"markdown\"] { padding: 8px; } body.mod-popout :focus-visible { outline: 2px solid red; } @media (prefers-reduced-motion: reduce) { .workspace { transition: none; } }");
    const snippet = Buffer.from(".nav-file-title:focus-visible { font-size: 16px; }");
    writeFileSync(join(root, ".obsidian", "themes", "Minimal.css"), theme);
    writeFileSync(join(root, ".obsidian", "snippets", "focus.css"), snippet);

    const discovered = discoverVaultConfiguration(root);
    expect(discovered.appearance[".obsidian/appearance.json"]).toMatchObject({mode: "dark", cssTheme: "Minimal", enabledCssSnippets: ["focus"]});
    expect(discovered.styles.map((style) => [style.kind, style.relativePath])).toEqual([
      ["snippet", ".obsidian/snippets/focus.css"],
      ["theme", ".obsidian/themes/Minimal.css"],
    ]);
    const minimal = discovered.styles.find((style) => style.kind === "theme");
    expect(minimal?.bytes).toEqual(new Uint8Array(theme));
    expect(minimal?.analysis).toMatchObject({
      modeSupport: {light: false, dark: true},
      layoutContracts: ["workspace-shell", "workspace-leaf", "view-header"],
      pluginViewContracts: ["data-view", "workspace-leaf-content"],
      popoutContracts: ["popout-surface"],
      accessibilityContracts: ["focus-visible", "reduced-motion"],
      safety: {rawCssExecution: "not-executed", previewable: true},
    });
    expect(minimal?.analysis.variables).toMatchObject({"--accent-h": "260"});
    expect(minimal?.analysis.selectors).toContain("body.theme-dark");
    const report = auditThemeAssets(root);
    expect(report.summary).toMatchObject({styleCount: 2, previewableCount: 2, reviewRequiredCount: 0, modeCoverage: {light: true, dark: true}});
    expect(report.styles.map((style) => style.relativePath)).toEqual([".obsidian/snippets/focus.css", ".obsidian/themes/Minimal.css"]);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test("theme analysis reports unsafe imports and privileged selectors without executing CSS", () => {
  const analysis = parseThemeStylesheet("@import url(https://example.com/theme.css); #provider-mode { display: none; } .workspace { background: url(data:image/png;base64,abc); }");
  expect(analysis.safety).toMatchObject({rawCssExecution: "not-executed", externalImports: "denied", remoteUrls: "denied", previewable: false});
  expect(analysis.safety.privilegedSelectors).toEqual(["#provider-mode"]);
  expect(analysis.issues).toEqual([
    "CSS @import is not resolved during a safe preview",
    "remote, file and data URL assets are not fetched during a safe preview",
    "selectors targeting privileged or AI controls require host review",
  ]);
});

test("attachments retain original binary bytes and expose the original path", () => {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-attachment-vault-"));
  const appData = mkdtempSync(join(tmpdir(), "openobsidian-attachment-app-"));
  try {
    const original = Buffer.from([0, 255, 10, 128]);
    writeFileSync(join(root, "photo.bin"), original);
    const reference = resolveAttachment(new VaultStore(root, appData), "photo.bin");
    expect(reference.kind).toBe("file");
    expect(reference.absolutePath).toBe(join(root, "photo.bin"));
    expect(readFileSync(reference.absolutePath)).toEqual(original);
    expect(resolveAttachment(new VaultStore(root, appData), "missing.pdf").kind).toBe("missing");
  } finally {
    rmSync(root, {recursive: true, force: true});
    rmSync(appData, {recursive: true, force: true});
  }
});
