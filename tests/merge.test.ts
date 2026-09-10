import {expect, test} from "bun:test";
import {threeWayMergeBytes} from "../src/core/merge.js";

const bytes = (value: string) => new TextEncoder().encode(value);

test("three-way merge combines disjoint line edits without losing either version", () => {
  const result = threeWayMergeBytes(bytes("one\ntwo\nthree\n"), bytes("ONE\ntwo\nthree\n"), bytes("one\ntwo\nTHREE\n"));
  expect(result.status).toBe("merged");
  expect(new TextDecoder().decode(result.bytes)).toBe("ONE\ntwo\nTHREE\n");
  expect(result.conflicts).toEqual([]);
});

test("three-way merge reports overlapping and structural edits instead of guessing", () => {
  const overlap = threeWayMergeBytes(bytes("one\ntwo\n"), bytes("ONE\ntwo\n"), bytes("CURRENT\ntwo\n"));
  expect(overlap.status).toBe("conflict");
  expect(overlap.conflicts[0]).toMatchObject({line: 1, base: "one\n", local: "ONE\n", current: "CURRENT\n"});

  const binary = threeWayMergeBytes(bytes("\u0000base"), bytes("\u0000local"), bytes("\u0000current"));
  expect(binary.status).toBe("conflict");
  expect(binary.bytes).toBeUndefined();
});
