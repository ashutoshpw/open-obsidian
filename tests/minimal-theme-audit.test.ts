import {expect, test} from "bun:test";
import {analyzeMinimalSettings, analyzeMinimalTheme} from "../scripts/audit-minimal-theme.js";

test("Minimal theme static audit requires both modes and legacy/plugin/popout contracts", () => {
  const source = `
    :root { --font-ui-small: 13px; }
    .workspace, .workspace-leaf, .view-header, .nav-files-container, .titlebar, .status-bar { color: var(--text-normal); }
    .workspace-leaf-content[data-type="markdown"] .view-content { padding: 1rem; }
    body.mod-popout :focus-visible { outline: 2px solid red; }
    .scaled { font-size: 1rem; background: url(https://example.test/asset.png); }
  `;
  const result = analyzeMinimalTheme(source);

  expect(result.modeSupport).toEqual({light: true, dark: true});
  expect(result.missingContracts).toEqual([]);
  expect(result.previewDisposition).toBe("withheld-for-review");
  expect(result.issues).toContain("remote, file and data URL assets are not fetched during a safe preview");
});

test("Minimal Theme Settings static audit records persistence markers and D15 DOM denial", () => {
  const source = `
    const defaults = {lightStyle: "minimal-light", darkStyle: "minimal-dark", lightScheme: "minimal-default-light", darkScheme: "minimal-default-dark", lineHeight: 1.5, lineWidth: 40, textNormal: 16, textSmall: 13};
    function save() { document.body; window.app; plugin.saveData(defaults); }
    const commands = [{id: "increase-body-font-size"}, {id: "decrease-body-font-size"}, {id: "toggle-hidden-borders"}, {id: "toggle-colorful-headings"}];
  `;
  const result = analyzeMinimalSettings(source);

  expect(result.requiredSettings.every((entry) => entry.present)).toBe(true);
  expect(result.requiredCommands.every((entry) => entry.present)).toBe(true);
  expect(result.saveDataCalls).toBe(1);
  expect(result.prescreen.markerIds).toContain("dom");
  expect(result.d15Disposition).toBe("denied-security");
  expect(result.runtimeDisposition).toBe("pending-runtime");
});
