export type MergeConflict = {line: number; base: string; local: string; current: string};
export type MergeResult = {status: "unchanged" | "merged" | "conflict"; bytes?: Uint8Array; conflicts: MergeConflict[]};

function same(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function lines(bytes: Uint8Array): string[] | null {
  if (bytes.includes(0)) return null;
  return new TextDecoder("utf-8", {fatal: true}).decode(bytes).match(/.*(?:\r\n|\n|\r|$)/g)?.filter((line) => line.length > 0) ?? [];
}

function conflictResult(base: string[], local: string[], current: string[]): MergeResult {
  return {status: "conflict", conflicts: [{line: 1, base: base.join(""), local: local.join(""), current: current.join("")}]};
}

export function threeWayMergeBytes(baseBytes: Uint8Array, localBytes: Uint8Array, currentBytes: Uint8Array): MergeResult {
  if (same(localBytes, currentBytes)) return {status: "unchanged", bytes: new Uint8Array(localBytes), conflicts: []};
  if (same(baseBytes, localBytes)) return {status: "unchanged", bytes: new Uint8Array(currentBytes), conflicts: []};
  if (same(baseBytes, currentBytes)) return {status: "unchanged", bytes: new Uint8Array(localBytes), conflicts: []};
  const base = lines(baseBytes);
  const local = lines(localBytes);
  const current = lines(currentBytes);
  if (!base || !local || !current || base.length !== local.length || base.length !== current.length) return conflictResult(base ?? [], local ?? [], current ?? []);
  const conflicts: MergeConflict[] = [];
  const merged = base.map((line, index) => {
    const localLine = local[index] ?? "";
    const currentLine = current[index] ?? "";
    if (localLine === currentLine) return localLine;
    if (localLine === line) return currentLine;
    if (currentLine === line) return localLine;
    conflicts.push({line: index + 1, base: line, local: localLine, current: currentLine});
    return line;
  });
  if (conflicts.length > 0) return {status: "conflict", conflicts};
  const bytes = new TextEncoder().encode(merged.join(""));
  return {status: "merged", bytes, conflicts: []};
}
