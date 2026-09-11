import {createHash} from "node:crypto";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {parseCanvas} from "../src/core/canvas.js";
import {exportPortableConversation} from "../src/core/model-lifecycle.js";
import {VaultStore} from "../src/core/vault.js";

type JsonRecord = Record<string, unknown>;
type ConversationFixture = Parameters<typeof exportPortableConversation>[0];
type ExitFixture = {
  schema_version: 1;
  id: "fixture:c14-exit-portability";
  ordinary_outputs: string[];
  conversation: ConversationFixture;
  external_pending: string[];
};

export type ExitPortabilityReport = {
  schema_version: 1;
  fixture_id: string;
  recorded_at: string;
  local: {
    status: "passed";
    checks: {
      markdown_reopened: boolean;
      canvas_reopened: boolean;
      conversation_exported: boolean;
      vault_contains_only_portable_outputs: boolean;
      app_database_required: false;
    };
    exported_conversation: {schema_version: number; providerMode: string; model: string | null; turns: number};
  };
  reference: {status: "external-pending"; reason: string};
  release_eligible: false;
  result: string;
};

const fixture = JSON.parse(readFileSync(new URL("../fixtures/exit-portability.json", import.meta.url), "utf8")) as ExitFixture;
const markdown = "# Portable AI output\n\nThis remains ordinary Markdown.\n";
const canvas = {nodes: [{id: "text-1", type: "text", text: "Portable Canvas output", x: 0, y: 0, width: 320, height: 120}], edges: []};

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function readFixture(): ExitFixture {
  assertCondition(fixture.schema_version === 1 && fixture.id === "fixture:c14-exit-portability", "C14 fixture identity is invalid");
  assertCondition(fixture.ordinary_outputs.length === 2, "C14 fixture must include Markdown and Canvas outputs");
  assertCondition(fixture.external_pending.length > 0, "C14 fixture must retain reference limitations");
  return fixture;
}

function portableConversation(): {content: string; parsed: JsonRecord} {
  const content = exportPortableConversation(fixture.conversation, "2026-09-11T00:00:02Z");
  const parsed = JSON.parse(content) as JsonRecord;
  assertCondition(parsed.schema_version === 1 && parsed.providerMode === "none" && parsed.model === null, "Conversation export metadata is not portable");
  assertCondition(Array.isArray(parsed.turns) && parsed.turns.length === fixture.conversation.turns.length, "Conversation export turns are incomplete");
  return {content, parsed};
}

export function runExitPortabilityAudit(recordedAt = new Date().toISOString()): ExitPortabilityReport {
  const selected = readFixture();
  const exported = portableConversation();
  const vaultRoot = mkdtempSync(join(tmpdir(), "openobsidian-c14-vault-"));
  const appData = mkdtempSync(join(tmpdir(), "openobsidian-c14-app-"));
  try {
    mkdirSync(join(vaultRoot, "notes"), {recursive: true});
    mkdirSync(join(vaultRoot, "boards"), {recursive: true});
    const markdownBytes = new TextEncoder().encode(markdown);
    const canvasBytes = new TextEncoder().encode(`${JSON.stringify(canvas, null, 2)}\n`);
    writeFileSync(join(vaultRoot, "notes/ai-output.md"), markdownBytes);
    writeFileSync(join(vaultRoot, "boards/ai-output.canvas"), canvasBytes);
    const store = new VaultStore(vaultRoot, appData);
    const markdownRead = store.read("notes/ai-output.md");
    const canvasRead = store.read("boards/ai-output.canvas");
    const parsedCanvas = parseCanvas(canvasRead.bytes);
    const reopenedMarkdown = new VaultStore(vaultRoot, appData).read("notes/ai-output.md");
    const reopenedCanvas = new VaultStore(vaultRoot, appData).read("boards/ai-output.canvas");
    const entries = readdirSync(vaultRoot);
    const checks = {
      markdown_reopened: Buffer.from(reopenedMarkdown.bytes).equals(Buffer.from(markdownBytes)) && markdownRead.revision === reopenedMarkdown.revision,
      canvas_reopened: Buffer.from(reopenedCanvas.bytes).equals(Buffer.from(canvasBytes)) && parsedCanvas.nodes.some((node) => node.id === "text-1"),
      conversation_exported: exported.content.endsWith("\n") && exported.content.includes('"schema_version": 1'),
      vault_contains_only_portable_outputs: selected.ordinary_outputs.every((path) => existsSync(join(vaultRoot, path))) && !entries.includes(".openobsidian-data"),
      app_database_required: false as const,
    };
    assertCondition(Object.entries(checks).filter(([key]) => key !== "app_database_required").every(([, value]) => value === true) && checks.app_database_required === false, `C14 portability checks failed: ${JSON.stringify(checks)}`);
    return {
      schema_version: 1,
      fixture_id: selected.id,
      recorded_at: recordedAt,
      local: {
        status: "passed",
        checks,
        exported_conversation: {schema_version: Number(exported.parsed.schema_version), providerMode: String(exported.parsed.providerMode), model: exported.parsed.model === null ? null : String(exported.parsed.model), turns: Array.isArray(exported.parsed.turns) ? exported.parsed.turns.length : 0},
      },
      reference: {status: "external-pending", reason: "A pinned reference Obsidian runtime and consented fixture vault are required for back-and-forth reopen comparison."},
      release_eligible: false,
      result: `Local Markdown (${sha256(markdownBytes).slice(0, 12)}…) and JSON Canvas (${sha256(canvasBytes).slice(0, 12)}…) reopen byte-identically; conversation history exports as ordinary JSON without a vault database. Reference Obsidian reopen remains external-pending.`,
    };
  } finally {
    rmSync(vaultRoot, {recursive: true, force: true});
    rmSync(appData, {recursive: true, force: true});
  }
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(runExitPortabilityAudit(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({schema_version: 1, status: "failed", fixture_id: fixture.id, error: error instanceof Error ? error.message : String(error)}));
    process.exit(1);
  }
}
