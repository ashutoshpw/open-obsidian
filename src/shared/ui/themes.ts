export type ThemeStyleKind = "theme" | "snippet";

export type ThemeMode = "light" | "dark" | "system" | "unknown";

export type ThemeStyleSafety = {
  rawCssExecution: "not-executed";
  externalImports: "denied";
  remoteUrls: "denied";
  privilegedSelectors: readonly string[];
  previewable: boolean;
};

export type ThemeStyleAnalysis = {
  variables: Readonly<Record<string, string>>;
  selectors: readonly string[];
  modeSupport: {light: boolean; dark: boolean};
  layoutContracts: readonly string[];
  pluginViewContracts: readonly string[];
  popoutContracts: readonly string[];
  accessibilityContracts: readonly string[];
  safety: ThemeStyleSafety;
  issues: readonly string[];
};

export type AppearanceSettings = {
  mode: ThemeMode;
  cssTheme: string | null;
  enabledCssSnippets: readonly string[];
  accentColor: string | null;
  baseFontSize: number | null;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function cssSelectors(source: string): string[] {
  const selectors: string[] = [];
  let segmentStart = 0;
  for (const match of source.matchAll(/\{/g)) {
    const index = match.index ?? 0;
    const segment = source.slice(segmentStart, index).trim();
    segmentStart = index + 1;
    const candidate = (segment.split("}").at(-1) ?? "").split(";").at(-1)?.trim() ?? "";
    if (!candidate || candidate.startsWith("@")) continue;
    candidate.split(",").map((selector) => selector.trim()).filter(Boolean).forEach((selector) => selectors.push(selector));
  }
  return unique(selectors);
}

function matchingContracts(selectors: readonly string[], contracts: ReadonlyArray<readonly [string, RegExp]>): string[] {
  return contracts.filter(([, pattern]) => selectors.some((selector) => pattern.test(selector))).map(([id]) => id);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function themeMode(value: unknown): ThemeMode {
  const normalized = optionalString(value)?.toLowerCase();
  if (normalized === "light" || normalized === "dark" || normalized === "system") return normalized;
  return "unknown";
}

export function parseAppearanceSettings(raw: Readonly<Record<string, unknown>>): AppearanceSettings {
  const rawTheme = optionalString(raw.theme);
  const mode = themeMode(raw.mode ?? raw.themeMode ?? raw.colorScheme ?? rawTheme);
  const cssTheme = optionalString(raw.cssTheme) ?? (rawTheme && !["light", "dark", "system"].includes(rawTheme.toLowerCase()) ? rawTheme : null);
  const snippets = Array.isArray(raw.enabledCssSnippets) ? raw.enabledCssSnippets.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()) : [];
  const baseFontSize = typeof raw.baseFontSize === "number" && Number.isFinite(raw.baseFontSize) && raw.baseFontSize > 0 ? raw.baseFontSize : null;
  return {mode, cssTheme, enabledCssSnippets: unique(snippets), accentColor: optionalString(raw.accentColor), baseFontSize};
}

export function parseThemeStylesheet(source: string): ThemeStyleAnalysis {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = cssSelectors(clean);
  const variables: Record<string, string> = {};
  for (const match of clean.matchAll(/(--[a-zA-Z0-9_-]+)\s*:\s*([^;{}]+)(?:;|$)/g)) {
    const name = match[1];
    const value = match[2]?.trim();
    if (name && value) variables[name] = value;
  }

  const darkHint = /prefers-color-scheme\s*:\s*dark|(?:^|[^\w-])(?:theme|mode)[-_ ]dark\b|data-theme\s*=\s*["']dark["']/i.test(clean);
  const lightHint = /prefers-color-scheme\s*:\s*light|(?:^|[^\w-])(?:theme|mode)[-_ ]light\b|data-theme\s*=\s*["']light["']/i.test(clean);
  const modeSupport = darkHint || lightHint ? {light: lightHint, dark: darkHint} : {light: true, dark: true};

  const layoutContracts = matchingContracts(selectors, [
    ["workspace-shell", /(?:^|[\s>])\.workspace\b/i],
    ["workspace-leaf", /\.workspace-leaf\b|\.workspace-tab-container\b/i],
    ["view-header", /\.view-header\b/i],
    ["file-explorer", /\.nav-files-container\b|\.nav-folder\b|\.nav-file\b/i],
    ["titlebar", /\.titlebar\b/i],
    ["status-bar", /\.status-bar\b/i],
  ]);
  const pluginViewContracts = matchingContracts(selectors, [
    ["data-view", /\[data-type\s*=/i],
    ["workspace-leaf-content", /\.workspace-leaf-content\b/i],
    ["view-content", /\.view-content\b/i],
  ]);
  const popoutContracts = matchingContracts(selectors, [
    ["popout-surface", /\.mod-popout\b|\.is-popout\b|body\s*\.mod-popout\b/i],
  ]);
  const accessibilityContracts = unique([
    /:focus(?:-visible)?\b/i.test(clean) ? "focus-visible" : "",
    /prefers-reduced-motion/i.test(clean) ? "reduced-motion" : "",
    /forced-colors|prefers-contrast|\[aria-[\w-]+\]|\brole\s*=/i.test(clean) ? "high-contrast-or-semantic-controls" : "",
    /\bfont-size\s*:/i.test(clean) ? "font-scaling" : "",
  ].filter(Boolean));

  const externalImports = /@import\b/i.test(clean);
  const remoteUrls = /url\(\s*["']?(?:https?:|file:|data:|javascript:)/i.test(clean);
  const executableExpressions = /expression\s*\(|javascript:|-moz-binding|\bbehavior\s*:/i.test(clean);
  const privilegedSelectors = selectors.filter((selector) => /#(?:extension-trust|provider-mode|account-billing|model-management|safe-mode|source-inspector)\b/i.test(selector));
  const issues = [
    ...(externalImports ? ["CSS @import is not resolved during a safe preview"] : []),
    ...(remoteUrls ? ["remote, file and data URL assets are not fetched during a safe preview"] : []),
    ...(executableExpressions ? ["executable CSS expressions are not accepted"] : []),
    ...(privilegedSelectors.length > 0 ? ["selectors targeting privileged or AI controls require host review"] : []),
  ];

  return {
    variables,
    selectors,
    modeSupport,
    layoutContracts,
    pluginViewContracts,
    popoutContracts,
    accessibilityContracts,
    safety: {
      rawCssExecution: "not-executed",
      externalImports: "denied",
      remoteUrls: "denied",
      privilegedSelectors,
      previewable: !externalImports && !remoteUrls && !executableExpressions && privilegedSelectors.length === 0,
    },
    issues,
  };
}
