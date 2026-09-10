import {extractMarkdownHeadings} from "./markdown.js";
import {buildVaultIndex} from "./vault-index.js";
import {VaultStore} from "./vault.js";
import type {NoteBacklink, NoteContext, NoteLink} from "../shared/api.js";

function sourceLocation(source: string, offset: number): {line: number; text: string} {
  const lines = source.split(/\r\n|\n|\r/);
  const line = source.slice(0, offset).split(/\r\n|\n|\r/).length;
  return {line, text: lines[line - 1]?.trim() || ""};
}

export function buildNoteContext(store: VaultStore, relativePath: string): NoteContext {
  const read = store.read(relativePath);
  const normalizedPath = read.relativePath;
  const text = new TextDecoder("utf-8", {fatal: true}).decode(read.bytes);
  const index = buildVaultIndex(store);
  const current = index.files.find((file) => file.relativePath === normalizedPath);
  const outgoingLinks: NoteLink[] = (current?.links ?? []).map((link) => {
    const location = sourceLocation(text, link.start);
    return {
      target: link.target || link.subpath || link.raw,
      ...(link.resolution.target ? {resolvedPath: link.resolution.target} : {}),
      status: link.resolution.status,
      candidates: link.resolution.candidates,
      line: location.line,
      text: location.text || link.raw,
    };
  });
  const backlinks: NoteBacklink[] = index.files.flatMap((file) => {
    const source = file.searchText;
    if (!source) return [];
    return file.links.flatMap((link) => {
      if (link.resolution.target !== normalizedPath) return [];
      const location = sourceLocation(source, link.start);
      return [{relativePath: file.relativePath, line: location.line, text: location.text || link.raw}];
    });
  }).sort((left, right) => left.relativePath.localeCompare(right.relativePath) || left.line - right.line);
  return {relativePath: normalizedPath, headings: extractMarkdownHeadings(text), outgoingLinks, backlinks};
}
