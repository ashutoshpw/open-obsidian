import {expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {auditRendererHtml} from "../scripts/check-accessibility.js";
import {createDiagnosticManifest, DEFAULT_PRIVACY_DEFAULTS, DIAGNOSTIC_CONTROLS} from "../src/core/privacy.js";
import {localeDirection, localeMessages, message, normalizeLocale} from "../src/core/localization.js";

const root = new URL("..", import.meta.url);
const privacyFixture = JSON.parse(readFileSync(new URL("fixtures/privacy-defaults.json", root), "utf8")) as {schema_version: number; defaults: typeof DEFAULT_PRIVACY_DEFAULTS; redacted_fields: string[]; controls: string[]};
const localizationFixture = JSON.parse(readFileSync(new URL("fixtures/ux-localization.json", root), "utf8")) as {schema_version: number; locales: Array<{id: "en" | "hi" | "ar"; direction: "ltr" | "rtl"; sample: string}>};

test("privacy defaults keep diagnostics local and exclude sensitive fields", () => {
  expect(privacyFixture.schema_version).toBe(1);
  expect(privacyFixture.defaults).toEqual(DEFAULT_PRIVACY_DEFAULTS);
  expect(privacyFixture.redacted_fields).toEqual(["note_content", "provider_secret", "absolute_paths"]);
  expect(privacyFixture.controls).toEqual(DIAGNOSTIC_CONTROLS.map((control) => control.id));
  const manifest = createDiagnosticManifest({applicationVersion: "0.1.0", platform: "test", architecture: "arm64", vaultFileCount: 4, vaultKind: "standard", providerMode: "byok", providerId: "openai-compatible", providerCredentialState: "stored"}, "2026-09-10T00:00:00.000Z");
  expect(manifest.destination).toBe("local-export-only");
  expect(manifest.privacy.noteContentTelemetry).toBe(false);
  expect(manifest.privacy.providerSecretTelemetry).toBe(false);
  expect(manifest.redacted_fields).toContain("note_content");
  expect(JSON.stringify(manifest)).not.toContain("secret-value");
  expect(JSON.stringify(manifest)).not.toContain("/Users/");
});

test("renderer static accessibility contract passes and records human handoffs separately", () => {
  const result = auditRendererHtml();
  expect(result.failures).toEqual([]);
  expect(result.checks).toEqual(expect.arrayContaining(["interactive-names", "form-labels", "button-types", "focus-visible", "reduced-motion", "live-status", "dialog-labels"]));
});

test("locale fixtures preserve Unicode and make direction explicit", () => {
  expect(localizationFixture.schema_version).toBe(1);
  for (const entry of localizationFixture.locales) {
    expect(localeDirection(entry.id)).toBe(entry.direction);
    expect(message(entry.id, "settings").length).toBeGreaterThan(0);
    expect(new TextDecoder().decode(new TextEncoder().encode(entry.sample))).toBe(entry.sample);
    expect(Object.keys(localeMessages(entry.id))).toContain("localDiagnosticsDescription");
  }
  expect(normalizeLocale("hi-IN")).toBe("hi");
  expect(normalizeLocale("ar-SA")).toBe("ar");
  expect(normalizeLocale("fr-FR")).toBe("en");
});
