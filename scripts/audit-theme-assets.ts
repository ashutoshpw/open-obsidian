import {existsSync, lstatSync} from "node:fs";
import {resolve} from "node:path";
import {discoverVaultConfiguration} from "../src/core/configuration.js";

type ThemeAudit = {
  schema_version: 1;
  root: string;
  appearance: ReturnType<typeof discoverVaultConfiguration>["appearance"];
  styles: Array<{
    relativePath: string;
    kind: string;
    sha256: string;
    variables: string[];
    selectors: number;
    modeSupport: {light: boolean; dark: boolean};
    layoutContracts: string[];
    pluginViewContracts: string[];
    popoutContracts: string[];
    accessibilityContracts: string[];
    previewable: boolean;
    issues: string[];
  }>;
  summary: {
    styleCount: number;
    previewableCount: number;
    reviewRequiredCount: number;
    modeCoverage: {light: boolean; dark: boolean};
  };
};

function argumentValue(args: readonly string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function usage(): never {
  console.error("Usage: bun scripts/audit-theme-assets.ts --root /path/to/vault [--strict]");
  process.exit(2);
}

export function auditThemeAssets(rootArgument: string): ThemeAudit {
  const root = resolve(rootArgument);
  if (!existsSync(root) || !lstatSync(root).isDirectory()) throw new Error(`Theme audit root is not a directory: ${root}`);
  const configuration = discoverVaultConfiguration(root);
  const styles = configuration.styles.map((style) => ({
    relativePath: style.relativePath,
    kind: style.kind,
    sha256: style.sha256,
    variables: Object.keys(style.analysis.variables).sort(),
    selectors: style.analysis.selectors.length,
    modeSupport: style.analysis.modeSupport,
    layoutContracts: [...style.analysis.layoutContracts],
    pluginViewContracts: [...style.analysis.pluginViewContracts],
    popoutContracts: [...style.analysis.popoutContracts],
    accessibilityContracts: [...style.analysis.accessibilityContracts],
    previewable: style.analysis.safety.previewable,
    issues: [...style.analysis.issues],
  }));
  return {
    schema_version: 1,
    root,
    appearance: configuration.appearance,
    styles,
    summary: {
      styleCount: styles.length,
      previewableCount: styles.filter((style) => style.previewable).length,
      reviewRequiredCount: styles.filter((style) => !style.previewable).length,
      modeCoverage: {
        light: styles.some((style) => style.modeSupport.light),
        dark: styles.some((style) => style.modeSupport.dark),
      },
    },
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const rootArgument = argumentValue(args, "--root");
  if (!rootArgument || rootArgument.startsWith("--")) usage();
  try {
    const report = auditThemeAssets(rootArgument);
    console.log(JSON.stringify(report, null, 2));
    if (args.includes("--strict") && report.summary.reviewRequiredCount > 0) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
