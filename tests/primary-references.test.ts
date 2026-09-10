import {expect, test} from "bun:test";
import {readPrimaryReferenceRecord} from "../scripts/verify-primary-references.js";

test("primary reference record covers versioned and hash-pinned sources", () => {
  const record = readPrimaryReferenceRecord();
  expect(record.schema_version).toBe(1);
  expect(record.references).toHaveLength(8);
  expect(record.references.every((reference) => reference.status === 200 && /^[a-f0-9]{64}$/.test(reference.sha256))).toBe(true);
  expect(record.references.find((reference) => reference.id === "obsidian-api")?.immutable_version).toContain("cc1744324150c632416857c98964f87b1574a5fc");
});
