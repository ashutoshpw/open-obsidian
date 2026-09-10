import {expect, test} from "bun:test";
import {DEFAULT_HISTORY_POLICY, DEFAULT_WORKSPACE_SETTINGS, validateCanvasCreateNoteRequest, validateCanvasTextEditRequest, validateChronicleCommitRequest, validateChronicleDiffRequest, validateChronicleRestoreRequest, validateConflictReadRequest, validateConflictResolutionRequest, validateHistoryPolicy, validateRetrievalRequest, validateVaultWriteRequest, validateWorkspaceSettings, validateWorkspaceState} from "../src/shared/api.js";

test("vault IPC validation accepts canonical payloads and normalizes omitted revisions", () => {
  expect(validateVaultWriteRequest({relativePath: "note.md", base64: "aGk="})).toEqual({relativePath: "note.md", expectedRevision: null, base64: "aGk="});
  expect(validateVaultWriteRequest({relativePath: "note.md", expectedRevision: "abc", base64: ""}).expectedRevision).toBe("abc");
});

test("vault IPC validation rejects malformed payloads before the broker", () => {
  expect(() => validateVaultWriteRequest(null)).toThrow("Invalid vault write request");
  expect(() => validateVaultWriteRequest([])).toThrow("Invalid vault write request");
  expect(() => validateVaultWriteRequest({relativePath: "", base64: "aGk="})).toThrow("Invalid vault write request");
  expect(() => validateVaultWriteRequest({relativePath: "note.md", expectedRevision: 7, base64: "aGk="})).toThrow("Invalid vault write request");
  expect(() => validateVaultWriteRequest({relativePath: "note.md", base64: "not-base64!"})).toThrow("Invalid vault write request");
});

test("Chronicle IPC validation keeps diff, commit and restore actions typed", () => {
  expect(validateChronicleDiffRequest(undefined)).toEqual({});
  expect(validateChronicleDiffRequest({relativePath: "note.md", staged: true})).toEqual({relativePath: "note.md", staged: true});
  expect(validateChronicleCommitRequest({selectedPaths: ["note.md"], message: "save note"})).toEqual({selectedPaths: ["note.md"], message: "save note"});
  expect(validateChronicleRestoreRequest({revision: "abc123", relativePath: "note.md"})).toEqual({revision: "abc123", relativePath: "note.md"});
});

test("Chronicle IPC validation rejects unsafe action shapes before the broker", () => {
  expect(() => validateChronicleDiffRequest({staged: "yes"})).toThrow("Invalid Chronicle diff request");
  expect(() => validateChronicleCommitRequest({selectedPaths: ["note.md", 7], message: "save note"})).toThrow("Invalid Chronicle commit request");
  expect(() => validateChronicleRestoreRequest({revision: "", relativePath: "note.md"})).toThrow("Invalid Chronicle restore request");
});

test("workspace settings validation keeps editor modes and split state explicit", () => {
  expect(DEFAULT_WORKSPACE_SETTINGS).toEqual({editorMode: "source", splitView: true, historyPolicy: DEFAULT_HISTORY_POLICY});
  expect(validateWorkspaceSettings({editorMode: "reading", splitView: false})).toEqual({editorMode: "reading", splitView: false, historyPolicy: DEFAULT_HISTORY_POLICY});
  expect(() => validateWorkspaceSettings({editorMode: "wysiwyg", splitView: true})).toThrow("Invalid workspace settings");
  expect(() => validateWorkspaceSettings({editorMode: "source", splitView: "yes"})).toThrow("Invalid workspace settings");
  expect(validateWorkspaceSettings({editorMode: "source", splitView: true, historyPolicy: {maxAgeDays: 7, maxBytes: 1048576}}).historyPolicy).toEqual({maxAgeDays: 7, maxBytes: 1048576});
});

test("history and conflict IPC validation keeps destructive actions explicit", () => {
  expect(validateHistoryPolicy(DEFAULT_HISTORY_POLICY)).toEqual(DEFAULT_HISTORY_POLICY);
  expect(validateConflictReadRequest({id: "conflict-id", relativePath: "note.md"})).toEqual({id: "conflict-id", relativePath: "note.md"});
  expect(validateConflictResolutionRequest({id: "conflict-id", relativePath: "note.md", action: "keep-incoming"})).toEqual({id: "conflict-id", relativePath: "note.md", action: "keep-incoming"});
  expect(() => validateHistoryPolicy({maxAgeDays: -1, maxBytes: 10})).toThrow("Invalid history policy");
  expect(() => validateHistoryPolicy({maxAgeDays: 30, maxBytes: Number.POSITIVE_INFINITY})).toThrow("Invalid history policy");
  expect(() => validateConflictResolutionRequest({id: "conflict-id", relativePath: "note.md", action: "delete"})).toThrow("Invalid conflict resolution request");
});

test("workspace state validation restores only bounded relative note navigation", () => {
  expect(validateWorkspaceState({settings: DEFAULT_WORKSPACE_SETTINGS, vaultRoot: "/tmp/vault", openTabs: ["one.md", "folder/two.md"], activePath: "folder/two.md", navigationHistory: ["one.md", "folder/two.md"]})).toMatchObject({activePath: "folder/two.md", openTabs: ["one.md", "folder/two.md"]});
  expect(() => validateWorkspaceState({settings: DEFAULT_WORKSPACE_SETTINGS, vaultRoot: null, openTabs: ["../outside.md"], activePath: null, navigationHistory: []})).toThrow("Invalid workspace tabs");
  expect(() => validateWorkspaceState({settings: DEFAULT_WORKSPACE_SETTINGS, vaultRoot: null, openTabs: ["one.md"], activePath: "two.md", navigationHistory: []})).toThrow("Invalid workspace active path");
});

test("Canvas IPC validation keeps edits revision-aware and note creation explicit", () => {
  expect(validateCanvasTextEditRequest({relativePath: "boards/plan.canvas", expectedRevision: "a".repeat(64), nodeId: "text-1", text: "updated"})).toEqual({relativePath: "boards/plan.canvas", expectedRevision: "a".repeat(64), nodeId: "text-1", text: "updated"});
  expect(validateCanvasCreateNoteRequest({relativePath: "boards/plan.canvas", expectedRevision: "b".repeat(64), nodeId: "text-1", notePath: "notes/plan.md"}).notePath).toBe("notes/plan.md");
  expect(() => validateCanvasTextEditRequest({relativePath: "/outside.canvas", expectedRevision: "a", nodeId: "text-1", text: "updated"})).toThrow("Invalid workspace path");
  expect(() => validateCanvasCreateNoteRequest({relativePath: "boards/plan.canvas", expectedRevision: "b", nodeId: "text-1", notePath: "../plan.md"})).toThrow("Invalid workspace note path");
});

test("retrieval IPC validation keeps scope and limits bounded", () => {
  expect(validateRetrievalRequest({query: "  local notes ", limit: 5, scope: {folders: ["Projects"], tags: ["#ai"], excludedPaths: ["private.md"], modifiedAfter: "2026-01-01T00:00:00Z"}})).toEqual({query: "local notes", limit: 5, scope: {paths: [], folders: ["Projects"], tags: ["ai"], modifiedAfter: "2026-01-01T00:00:00Z", modifiedBefore: undefined, excludedPaths: ["private.md"]}});
  expect(() => validateRetrievalRequest({query: "notes", limit: 0})).toThrow("Invalid retrieval limit");
  expect(() => validateRetrievalRequest({query: "notes", scope: {folders: ["../outside"]}})).toThrow("Invalid workspace folders");
  expect(() => validateRetrievalRequest({query: "notes", scope: {modifiedBefore: "not-a-date"}})).toThrow("Invalid retrieval end date");
});
