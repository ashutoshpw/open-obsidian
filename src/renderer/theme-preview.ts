import {parseThemeStylesheet, themeStyleName, type ThemeMode, type ThemeStyleAsset} from "../shared/ui/index.js";

type ThemePreviewResult = {style: HTMLStyleElement | null; issues: string[]};
export type ThemePreviewBatch = {styles: HTMLStyleElement[]; applied: string[]; blocked: string[]};

function prefersDarkMode(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return true;
  }
}

export function effectiveThemeMode(mode: ThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  return prefersDarkMode() ? "dark" : "light";
}

function splitThemeSelectors(value: string): string[] {
  return (value.match(/(?:[^,(]|\([^)]*\))+/g) ?? []).map((selector) => selector.trim()).filter(Boolean);
}

function privilegedThemeSelector(selector: string): boolean {
  return /#(?:extension-trust|provider-mode|account-billing|model-management|safe-mode|source-inspector)\b/i.test(selector);
}

function scopeModeSelector(selector: string, scope: string, mode: "light" | "dark"): string | null {
  const modeClass = `.theme-${mode}`;
  if (selector === modeClass || selector.startsWith(`${modeClass} `)) return `${scope}${selector.slice(modeClass.length)}`;
  if (selector.startsWith(`body${modeClass}`)) return `${scope}${selector.slice(`body${modeClass}`.length)}`;
  return null;
}

function scopeRootSelector(selector: string, scope: string): string | null {
  const root = /^(?:html|body|:root)(.*)$/i.exec(selector);
  return root ? `${scope}${root[1] ?? ""}` : null;
}

function scopeSelector(selector: string, scope: string, mode: "light" | "dark"): string {
  const trimmed = selector.trim();
  return scopeModeSelector(trimmed, scope, mode) ?? scopeRootSelector(trimmed, scope) ?? `${scope} ${trimmed}`;
}

function rewriteStyleRule(rule: CSSStyleRule, scope: string, mode: "light" | "dark"): string | null {
  const selectors = splitThemeSelectors(rule.selectorText);
  if (selectors.some(privilegedThemeSelector)) return "a rule targeting a privileged control was withheld";
  try {
    rule.selectorText = selectors.map((selector) => scopeSelector(selector, scope, mode)).join(", ");
    return null;
  } catch {
    return "a selector could not be safely scoped and was withheld";
  }
}

function externalRule(rule: CSSRule): boolean {
  return rule.type === CSSRule.IMPORT_RULE || rule.type === CSSRule.FONT_FACE_RULE || rule.type === CSSRule.PAGE_RULE;
}

type RuleOwner = {cssRules: CSSRuleList; deleteRule: (index: number) => void};

function sanitizeNestedRule(rule: CSSRule, scope: string, mode: "light" | "dark", issues: string[]): boolean {
  const nested = (rule as CSSRule & {cssRules?: CSSRuleList}).cssRules;
  if (!nested || typeof (rule as CSSRule & {deleteRule?: unknown}).deleteRule !== "function") return false;
  visitRules(rule as unknown as RuleOwner, scope, mode, issues);
  return nested.length === 0;
}

function sanitizeRule(rule: CSSRule, scope: string, mode: "light" | "dark", issues: string[]): boolean {
  if (rule instanceof CSSStyleRule) {
    const issue = rewriteStyleRule(rule, scope, mode);
    if (issue) issues.push(issue);
    return Boolean(issue);
  }
  if (sanitizeNestedRule(rule, scope, mode, issues)) return true;
  return sanitizeExternalRule(rule, issues);
}

function sanitizeExternalRule(rule: CSSRule, issues: string[]): boolean {
  if (!externalRule(rule)) return false;
  issues.push("an external or document-level rule was withheld");
  return true;
}

function visitRules(owner: RuleOwner, scope: string, mode: "light" | "dark", issues: string[]): void {
  for (let index = owner.cssRules.length - 1; index >= 0; index -= 1) {
    const rule = owner.cssRules[index];
    if (rule && sanitizeRule(rule, scope, mode, issues)) owner.deleteRule(index);
  }
}

function createPreviewStyle(asset: ThemeStyleAsset): HTMLStyleElement {
  const style = document.createElement("style");
  style.dataset.openobsidianStyle = asset.relativePath;
  // Keep the untrusted stylesheet inert while the browser parses it. Rules
  // are scoped and unsafe rule kinds removed before it is enabled.
  style.media = "not all";
  style.textContent = asset.source;
  document.head.append(style);
  return style;
}

function previewThemeAsset(asset: ThemeStyleAsset, mode: "light" | "dark", scope: string): ThemePreviewResult {
  const analysis = parseThemeStylesheet(asset.source);
  if (!analysis.safety.previewable) return {style: null, issues: [...analysis.issues]};
  const style = createPreviewStyle(asset);
  const sheet = style.sheet;
  if (!sheet) {
    style.remove();
    return {style: null, issues: ["The browser did not expose a preview stylesheet"]};
  }
  const issues: string[] = [];
  visitRules(sheet, scope, mode, issues);
  style.media = "all";
  return {style, issues};
}

function recordPreviewResult(batch: ThemePreviewBatch, asset: ThemeStyleAsset, result: ThemePreviewResult): void {
  if (result.style) {
    batch.styles.push(result.style);
    batch.applied.push(themeStyleName(asset.relativePath));
  }
  if (result.issues.length > 0) batch.blocked.push(`${themeStyleName(asset.relativePath)}: ${result.issues.join("; ")}`);
}

function addPreviewAsset(batch: ThemePreviewBatch, asset: ThemeStyleAsset, mode: "light" | "dark", scope: string): void {
  if (!(asset.analysis.modeSupport[mode] ?? true)) {
    batch.blocked.push(`${themeStyleName(asset.relativePath)} (${mode} mode is not declared)`);
    return;
  }
  recordPreviewResult(batch, asset, previewThemeAsset(asset, mode, scope));
}

export function previewThemeAssets(assets: readonly ThemeStyleAsset[], mode: "light" | "dark", scope: string): ThemePreviewBatch {
  const styles: HTMLStyleElement[] = [];
  const applied: string[] = [];
  const blocked: string[] = [];
  const batch = {styles, applied, blocked};
  assets.forEach((asset) => addPreviewAsset(batch, asset, mode, scope));
  return batch;
}

export function safeAppearanceColor(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim();
  return /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s,.%+-]+\))$/i.test(normalized) ? normalized : null;
}

export function safeAppearanceFontSize(value: number | null): string | null {
  if (value === null || value < 10 || value > 32) return null;
  return `${value}px`;
}
