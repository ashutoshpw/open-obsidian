import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {auditActionTargets, runHtmlAudit} from "./html-audit.js";

export type LayoutAuditResult = {failures: string[]; checks: string[]};

const root = resolve(import.meta.dir, "..");

function requiredRegion(html: string, label: string, pattern: RegExp, checks: string[], failures: string[]): void {
  if (pattern.test(html)) checks.push(label);
  else failures.push(`missing layout region or marker: ${label}`);
}

export function auditRendererLayout(html = readFileSync(join(root, "src/renderer/index.html"), "utf8")): LayoutAuditResult {
  const failures: string[] = [];
  const checks: string[] = [];
  requiredRegion(html, "obsidian-compatible shell marker", /data-layout=["']obsidian-compatible["']/i, checks, failures);
  requiredRegion(html, "integrated titlebar navigation", /class=["'][^"']*\btitlebar-nav\b[^"']*["'][^>]*aria-label=["']Workspace navigation["']/i, checks, failures);
  requiredRegion(html, "left sidebar toggle", /id=["']toggle-left-sidebar["'][^>]*aria-label=["'][^"']*left sidebar/i, checks, failures);
  requiredRegion(html, "right sidebar toggle", /data-ui-action=["']toggle-right-sidebar["'][^>]*data-action-target=["']toggle-context["']/i, checks, failures);
  requiredRegion(html, "vertical workspace ribbon", /class=["'][^"']*\bribbon\b[^"']*["'][^>]*aria-label=["']Workspace ribbon["']/i, checks, failures);
  requiredRegion(html, "vault file pane", /class=["'][^"']*\bsidebar\b[^"']*["'][^>]*aria-label=["']Vault navigation["']/i, checks, failures);
  requiredRegion(html, "Obsidian-style vault pane tabs", /class=["'][^"']*\bsidebar-tabs\b[^"']*["'][^>]*aria-label=["']Vault panes["']/i, checks, failures);
  requiredRegion(html, "Files/Search/Bookmarks pane controls", /data-sidebar-pane=["']files["'][^>]*[^>]*>Files<\/button>[\s\S]*data-sidebar-pane=["']search["'][^>]*[^>]*>Search<\/button>[\s\S]*data-sidebar-pane=["']bookmarks["'][^>]*[^>]*>Bookmarks<\/button>/i, checks, failures);
  requiredRegion(html, "compact workspace header", /class=["'][^"']*\bworkspace-header\b[^"']*["']/i, checks, failures);
  requiredRegion(html, "note tab strip", /class=["'][^"']*\bnote-tabs\b[^"']*["']/i, checks, failures);
  requiredRegion(html, "split editor stage", /class=["'][^"']*\beditor-stage\b[^"']*["'][^>]*\bid=["']editor-stage["']/i, checks, failures);
  requiredRegion(html, "note context pane", /id=["']context-pane["'][^>]*aria-label=["']Note context["']/i, checks, failures);
  requiredRegion(html, "outgoing links context", /id=["']outgoing-links-list["']/i, checks, failures);
  requiredRegion(html, "workspace status footer", /id=["']status["'][^>]*role=["']status["'][^>]*aria-live=["']polite["']/i, checks, failures);
  requiredRegion(html, "explicit uninstall cleanup choices", /data-ui-surface=["']uninstall-cleanup["'][\s\S]*data-uninstall-choice=["']app-cache["'][\s\S]*data-uninstall-choice=["']credentials["'][\s\S]*data-uninstall-choice=["']recovery-history["']/i, checks, failures);
  requiredRegion(html, "three-column shell sizing", /grid-template-columns:\s*44px\s+300px\s+minmax\(0,\s*1fr\)/i, checks, failures);
  requiredRegion(html, "shared layout token bridge", /var\(--layout-ribbon-width,\s*44px\)[^;]*var\(--layout-sidebar-width,\s*300px\)/i, checks, failures);
  requiredRegion(html, "shared icon size token", /var\(--layout-icon-size,\s*20px\)/i, checks, failures);
  requiredRegion(html, "equal editor and context split", /\.editor-stage\[data-split=["']true["']\]\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/is, checks, failures);
  requiredRegion(html, "compact chrome heights", /\.workspace-header\s*\{[^}]*flex:\s*0\s+0\s+40px/is, checks, failures);
  requiredRegion(html, "graph layout mode control", /id=["']graph-layout["']/i, checks, failures);
  requiredRegion(html, "spatial graph surface", /id=["']graph-surface["'][^>]*role=["']img["']/i, checks, failures);
  requiredRegion(html, "keyboard graph alternative", /id=["']graph-map-help["'][^>]*>[^<]*keyboard-accessible node list/i, checks, failures);

  const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/gi)].map((match) => match[1]));
  auditActionTargets(html, ids, checks, failures);
  return {failures, checks: [...new Set(checks)]};
}

if (import.meta.main) {
  runHtmlAudit(auditRendererLayout, "LAYOUT");
}
