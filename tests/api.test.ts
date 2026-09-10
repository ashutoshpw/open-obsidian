import {expect, test} from "bun:test";
import {DEFAULT_HISTORY_POLICY, DEFAULT_PROVIDER_SETTINGS, DEFAULT_WORKSPACE_SETTINGS, validateAIDraftRequest, validateAIApplyChangeRequest, validateAIOrganizationScope, validateAIUndoChangeRequest, validateCanvasCreateNoteRequest, validateCanvasTextEditRequest, validateChronicleCommitRequest, validateChronicleDiffRequest, validateChronicleRestoreRequest, validateConflictReadRequest, validateConflictResolutionRequest, validateHistoryPolicy, validateProviderCredentialRequest, validateProviderSettings, validateRetrievalRequest, validateVaultWriteRequest, validateWorkspaceSettings, validateWorkspaceState} from "../src/shared/api.js";

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

test("provider IPC validation keeps destination, credential and caps explicit", () => {
  expect(validateProviderSettings(DEFAULT_PROVIDER_SETTINGS)).toEqual(DEFAULT_PROVIDER_SETTINGS);
  expect(validateProviderSettings({...DEFAULT_PROVIDER_SETTINGS, mode: "managed", providerId: "openrouter-proxy", model: "managed-model", endpoint: "https://proxy.example.test/v1", credentialRef: "managed-key"})).toMatchObject({mode: "managed", providerId: "openrouter-proxy", endpoint: "https://proxy.example.test/v1", credentialRef: "managed-key"});
  expect(validateProviderSettings({...DEFAULT_PROVIDER_SETTINGS, mode: "byok", providerId: "openai-compatible", model: "byok-model", endpoint: "https://api.example.test/v1", credentialRef: "user-key"}).mode).toBe("byok");
  expect(validateProviderCredentialRequest({credentialRef: "user-key", secret: "secret-value"})).toEqual({credentialRef: "user-key", secret: "secret-value"});
});

test("provider IPC validation rejects unsafe endpoints, modes, caps and credentials", () => {
  expect(() => validateProviderSettings({...DEFAULT_PROVIDER_SETTINGS, mode: "byok", providerId: "openrouter-proxy", endpoint: "https://api.example.test/v1"})).toThrow("Provider id does not match provider mode");
  expect(() => validateProviderSettings({...DEFAULT_PROVIDER_SETTINGS, mode: "byok", providerId: "openai-compatible", endpoint: "http://api.example.test/v1"})).toThrow("Remote provider endpoint must use HTTPS");
  expect(() => validateProviderSettings({...DEFAULT_PROVIDER_SETTINGS, endpoint: "http://192.168.1.10:11434/v1"})).toThrow("Local provider endpoint must use loopback");
  expect(() => validateProviderSettings({...DEFAULT_PROVIDER_SETTINGS, caps: {...DEFAULT_PROVIDER_SETTINGS.caps, maxRequests: 0}})).toThrow("Invalid provider usage cap");
  expect(() => validateProviderCredentialRequest({credentialRef: "bad ref", secret: "secret-value"})).toThrow("Invalid provider credential request");
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

test("reviewed AI IPC validation keeps scope, approval and undo explicit", () => {
  const revision = "a".repeat(64);
  expect(validateAIDraftRequest({relativePath: "notes/plan.md", instruction: " append: reviewed follow-up ", expectedRevision: revision, scope: {folders: ["notes"], excludedPaths: ["notes/private.md"]}})).toEqual({relativePath: "notes/plan.md", instruction: "append: reviewed follow-up", expectedRevision: revision, scope: {paths: [], folders: ["notes"], tags: [], modifiedAfter: undefined, modifiedBefore: undefined, excludedPaths: ["notes/private.md"]}});
  expect(validateAIApplyChangeRequest({changeSetId: "change-set", selections: [{fileId: "file", hunkIds: ["hunk", "hunk"]}]})).toEqual({changeSetId: "change-set", selections: [{fileId: "file", hunkIds: ["hunk"]}]});
  expect(validateAIUndoChangeRequest({undoId: "undo-record"})).toEqual({undoId: "undo-record"});
  expect(validateAIOrganizationScope({paths: ["notes/plan.md"]})).toEqual({paths: ["notes/plan.md"], folders: [], tags: [], modifiedAfter: undefined, modifiedBefore: undefined, excludedPaths: []});
  expect(() => validateAIDraftRequest({relativePath: "../outside.md", instruction: "append: unsafe"})).toThrow("Invalid workspace AI path");
  expect(() => validateAIDraftRequest({relativePath: "note.md", instruction: "   "})).toThrow("Invalid AI instruction");
  expect(() => validateAIApplyChangeRequest({changeSetId: "change-set", selections: [{fileId: "file", hunkIds: [7]}]})).toThrow("Invalid AI change selection");
  expect(() => validateAIUndoChangeRequest({undoId: ""})).toThrow("Invalid AI undo request");
});
