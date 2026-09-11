import {createHash} from "node:crypto";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {tmpdir} from "node:os";
import {editCanvasTextNode, parseCanvas, type CanvasDocument, type CanvasNode} from "../src/core/canvas.js";
import {editMarkdownProperty} from "../src/core/markdown.js";
import {VaultStore} from "../src/core/vault.js";

const root = new URL("..", import.meta.url);

type TextSpanDiff = {kind: "text-span"; start: number; delete_text: string; insert_text: string};
type CanvasFieldDiff = {kind: "canvas-field"; path: string; from: string; to: string};
type MarkdownCase = {id: string; kind: "markdown-property"; path: string; before: string; edit: {key: string; raw_value: string}; after: string; approved_diff: TextSpanDiff};
type CanvasCase = {id: string; kind: "canvas-text-node"; path: string; before: CanvasDocument; edit: {node_id: string; text: string}; after: CanvasDocument; approved_diff: CanvasFieldDiff};
type GoldenCase = MarkdownCase | CanvasCase;
type GoldenFixture = {schema_version: 1; fixture_id: "fixture:q-edit-fidelity"; name: string; cases: GoldenCase[]; reference_reopen: {status: "external-pending"; reason: string}};

export type GoldenEditResult = {
  id: string;
  kind: GoldenCase["kind"];
  path: string;
  local_status: "passed";
  exact_output: boolean;
  approved_diff: TextSpanDiff | CanvasFieldDiff;
  reopened_locally: boolean;
  before_sha256: string;
  after_sha256: string;
};

export type GoldenEditReport = {
  schema_version: 1;
  fixture_id: string;
  recorded_at: string;
  cases: GoldenEditResult[];
  local: {passed: boolean; case_count: number; exact_outputs: number; reopened: number};
  reference_reopen: {status: "external-pending"; reason: string};
  release_eligible: false;
  result: string;
};

function readFixture(): GoldenFixture {
  return JSON.parse(readFileSync(new URL("fixtures/golden-edit-fidelity.json", root), "utf8")) as GoldenFixture;
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function commonPrefixLength(before: string, after: string): number {
  const limit = Math.min(before.length, after.length);
  let start = 0;
  while (start < limit) {
    if (before[start] !== after[start]) break;
    start += 1;
  }
  return start;
}

function commonSpan(before: string, after: string): {start: number; deleteText: string; insertText: string} {
  const start = commonPrefixLength(before, after);
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start) {
    if (afterEnd <= start) break;
    if (before[beforeEnd - 1] !== after[afterEnd - 1]) break;
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return {start, deleteText: before.slice(start, beforeEnd), insertText: after.slice(start, afterEnd)};
}

function assertTextSpan(before: string, after: string, expected: TextSpanDiff): void {
  const actual = commonSpan(before, after);
  const expectedSpan = {start: expected.start, deleteText: expected.delete_text, insertText: expected.insert_text};
  if (JSON.stringify(actual) !== JSON.stringify(expectedSpan)) {
    throw new Error(`${expected.kind} does not match the exact approved span`);
  }
  const rebuilt = `${before.slice(0, expected.start)}${expected.insert_text}${before.slice(expected.start + expected.delete_text.length)}`;
  if (rebuilt !== after) {
    throw new Error("approved text span does not produce the expected output");
  }
}

function canvasNodeId(path: string): string {
  return path.slice("nodes[".length, path.indexOf("]"));
}

function requireCanvasNode(document: CanvasDocument, nodeId: string): CanvasNode {
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`approved Canvas node does not exist: ${nodeId}`);
  return node;
}

function assertApprovedCanvasText(before: CanvasDocument, after: CanvasDocument, expected: CanvasFieldDiff): void {
  const nodeId = canvasNodeId(expected.path);
  const beforeNode = requireCanvasNode(before, nodeId);
  const afterNode = requireCanvasNode(after, nodeId);
  if (beforeNode.text !== expected.from) throw new Error("approved Canvas source text does not match");
  if (afterNode.text !== expected.to) throw new Error("approved Canvas output text does not match");
}

function assertCanvasOnlyTextChange(before: CanvasDocument, after: CanvasDocument, expected: CanvasFieldDiff): void {
  const beforeComparable = JSON.parse(JSON.stringify(before)) as CanvasDocument;
  const afterComparable = JSON.parse(JSON.stringify(after)) as CanvasDocument;
  const nodeId = canvasNodeId(expected.path);
  const beforeTarget = beforeComparable.nodes.find((node) => node.id === nodeId);
  const afterTarget = afterComparable.nodes.find((node) => node.id === nodeId);
  if (!beforeTarget || !afterTarget) throw new Error("approved Canvas node does not exist in comparable documents");
  delete beforeTarget.text;
  delete afterTarget.text;
  if (JSON.stringify(beforeComparable) !== JSON.stringify(afterComparable)) throw new Error("Canvas edit changed fields outside the approved text field");
}

function assertCanvasDiff(before: CanvasDocument, after: CanvasDocument, expected: CanvasFieldDiff): void {
  assertApprovedCanvasText(before, after, expected);
  assertCanvasOnlyTextChange(before, after, expected);
}

function beforeBytes(testCase: GoldenCase): Uint8Array {
  return testCase.kind === "markdown-property" ? bytes(testCase.before) : bytes(`${JSON.stringify(testCase.before)}\n`);
}

function expectedBytes(testCase: GoldenCase): Uint8Array {
  return testCase.kind === "markdown-property" ? bytes(testCase.after) : bytes(`${JSON.stringify(testCase.after, null, 2)}\n`);
}

function editedBytes(testCase: GoldenCase, original: Uint8Array): Uint8Array {
  return testCase.kind === "markdown-property"
    ? editMarkdownProperty(original, testCase.edit.key, testCase.edit.raw_value)
    : editCanvasTextNode(original, testCase.edit.node_id, testCase.edit.text);
}

function assertApprovedDiff(testCase: GoldenCase, original: Uint8Array, edited: Uint8Array): void {
  if (testCase.kind === "markdown-property") assertTextSpan(testCase.before, testCase.after, testCase.approved_diff);
  else assertCanvasDiff(parseCanvas(original), parseCanvas(edited), testCase.approved_diff);
}

function runCase(testCase: GoldenCase, rootPath: string, appData: string): GoldenEditResult {
  const filePath = join(rootPath, testCase.path);
  mkdirSync(dirname(filePath), {recursive: true});
  const originalBytes = beforeBytes(testCase);
  const approvedBytes = expectedBytes(testCase);
  writeFileSync(filePath, originalBytes);
  const store = new VaultStore(rootPath, appData);
  const original = store.read(testCase.path);
  const edited = editedBytes(testCase, original.bytes);
  assertApprovedDiff(testCase, original.bytes, edited);
  if (Buffer.compare(Buffer.from(edited), Buffer.from(approvedBytes)) !== 0) throw new Error(`${testCase.id} did not produce the exact golden output`);
  store.write({relativePath: testCase.path, expectedRevision: original.revision, bytes: edited, operationId: `golden-${testCase.id}`});
  const reopened = new VaultStore(rootPath, appData).read(testCase.path);
  if (Buffer.compare(Buffer.from(reopened.bytes), Buffer.from(approvedBytes)) !== 0) throw new Error(`${testCase.id} did not reopen with the exact approved bytes`);
  return {id: testCase.id, kind: testCase.kind, path: testCase.path, local_status: "passed", exact_output: true, approved_diff: testCase.approved_diff, reopened_locally: true, before_sha256: sha256(originalBytes), after_sha256: sha256(approvedBytes)};
}

function validateFixtureIdentity(fixture: GoldenFixture): void {
  if (fixture.schema_version !== 1 || fixture.fixture_id !== "fixture:q-edit-fidelity") throw new Error("golden edit fixture identity is invalid");
}

function validateFixtureCases(fixture: GoldenFixture): void {
  if (fixture.cases.length === 0) throw new Error("golden edit fixture must contain cases");
  if (new Set(fixture.cases.map((testCase) => testCase.id)).size !== fixture.cases.length) throw new Error("golden edit fixture case ids must be unique");
}

export function runGoldenEditFidelity(fixture = readFixture(), recordedAt = new Date().toISOString()): GoldenEditReport {
  validateFixtureIdentity(fixture);
  validateFixtureCases(fixture);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "openobsidian-golden-edit-"));
  const appData = mkdtempSync(join(tmpdir(), "openobsidian-golden-app-"));
  try {
    const cases = fixture.cases.map((testCase) => runCase(testCase, temporaryRoot, appData));
    return {
      schema_version: 1,
      fixture_id: fixture.fixture_id,
      recorded_at: recordedAt,
      cases,
      local: {passed: cases.every((testCase) => testCase.local_status === "passed" && testCase.exact_output && testCase.reopened_locally), case_count: cases.length, exact_outputs: cases.filter((testCase) => testCase.exact_output).length, reopened: cases.filter((testCase) => testCase.reopened_locally).length},
      reference_reopen: fixture.reference_reopen,
      release_eligible: false,
      result: "Local golden edits preserve only approved fields and reopen byte-identically; reference Obsidian reopen remains external-pending."
    };
  } finally {
    rmSync(temporaryRoot, {recursive: true, force: true});
    rmSync(appData, {recursive: true, force: true});
  }
}

if (import.meta.main) {
  const report = runGoldenEditFidelity();
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.local.passed ? 0 : 1);
}
