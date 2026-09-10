import {expect, test} from "bun:test";
import {DEFAULT_HISTORY_POLICY, DEFAULT_WORKSPACE_SETTINGS, validateChronicleCommitRequest, validateChronicleDiffRequest, validateChronicleRestoreRequest, validateConflictReadRequest, validateConflictResolutionRequest, validateHistoryPolicy, validateVaultWriteRequest, validateWorkspaceSettings} from "../src/shared/api.js";

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
  expect(DEFAULT_WORKSPACE_SETTINGS).toEqual({editorMode: "source", splitView: true});
  expect(validateWorkspaceSettings({editorMode: "reading", splitView: false})).toEqual({editorMode: "reading", splitView: false});
  expect(() => validateWorkspaceSettings({editorMode: "wysiwyg", splitView: true})).toThrow("Invalid workspace settings");
  expect(() => validateWorkspaceSettings({editorMode: "source", splitView: "yes"})).toThrow("Invalid workspace settings");
});

test("history and conflict IPC validation keeps destructive actions explicit", () => {
  expect(validateHistoryPolicy(DEFAULT_HISTORY_POLICY)).toEqual(DEFAULT_HISTORY_POLICY);
  expect(validateConflictReadRequest({id: "conflict-id", relativePath: "note.md"})).toEqual({id: "conflict-id", relativePath: "note.md"});
  expect(validateConflictResolutionRequest({id: "conflict-id", relativePath: "note.md", action: "keep-incoming"})).toEqual({id: "conflict-id", relativePath: "note.md", action: "keep-incoming"});
  expect(() => validateHistoryPolicy({maxAgeDays: -1, maxBytes: 10})).toThrow("Invalid history policy");
  expect(() => validateHistoryPolicy({maxAgeDays: 30, maxBytes: Number.POSITIVE_INFINITY})).toThrow("Invalid history policy");
  expect(() => validateConflictResolutionRequest({id: "conflict-id", relativePath: "note.md", action: "delete"})).toThrow("Invalid conflict resolution request");
});
