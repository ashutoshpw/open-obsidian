import {expect, test} from "bun:test";
import {validateVaultWriteRequest} from "../src/shared/api.js";

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
