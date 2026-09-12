import {expect, test} from "bun:test";
import {canInlineAttachment, inlineAttachmentInfo, MAX_INLINE_ATTACHMENT_BYTES, resolveInlineAttachmentTarget} from "../src/core/attachments.js";
import type {VaultEntry} from "../src/core/vault.js";

const entries: VaultEntry[] = [
  {relativePath: "Notes/photo.png", kind: "file", bytes: 128, sha256: "photo"},
  {relativePath: "Images/cover.webp", kind: "file", bytes: 256, sha256: "cover"},
  {relativePath: "shared.mp3", kind: "file", bytes: 512, sha256: "audio"},
  {relativePath: "Notes/photo.svg", kind: "file", bytes: 64, sha256: "svg"},
  {relativePath: "Notes/linked.png", kind: "symlink", bytes: 10, sha256: "link", target: "../outside.png"},
];

test("inline attachment policy allowlists inert-safe media and enforces the byte cap", () => {
  expect(inlineAttachmentInfo("photo.PNG")).toEqual({mimeType: "image/png", kind: "image"});
  expect(inlineAttachmentInfo("voice.m4a")).toEqual({mimeType: "audio/mp4", kind: "audio"});
  expect(inlineAttachmentInfo("clip.webm")).toEqual({mimeType: "video/webm", kind: "video"});
  expect(inlineAttachmentInfo("vector.svg")).toBeNull();
  expect(inlineAttachmentInfo("document.pdf")).toBeNull();
  expect(canInlineAttachment("photo.png", MAX_INLINE_ATTACHMENT_BYTES)).toBe(true);
  expect(canInlineAttachment("photo.png", MAX_INLINE_ATTACHMENT_BYTES + 1)).toBe(false);
  expect(canInlineAttachment("document.pdf", 1)).toBe(false);
});

test("attachment target resolution stays inside scanned regular files", () => {
  expect(resolveInlineAttachmentTarget("Notes/readme.md", "photo.png", entries)).toBe("Notes/photo.png");
  expect(resolveInlineAttachmentTarget("Notes/readme.md", "Images/cover.webp", entries)).toBe("Images/cover.webp");
  expect(resolveInlineAttachmentTarget("Notes/readme.md", "shared.mp3", entries)).toBe("shared.mp3");
  expect(resolveInlineAttachmentTarget("Notes/readme.md", "photo%2Epng", entries)).toBe("Notes/photo.png");
  expect(resolveInlineAttachmentTarget("Notes/readme.md", "linked.png", entries)).toBeNull();
  expect(resolveInlineAttachmentTarget("Notes/readme.md", "../outside.png", entries)).toBeNull();
  expect(resolveInlineAttachmentTarget("Notes/readme.md", "https://example.com/photo.png", entries)).toBeNull();
});

test("ambiguous basename embeds remain inert instead of guessing", () => {
  const ambiguous = [...entries, {relativePath: "Archive/photo.png", kind: "file", bytes: 128, sha256: "other"} satisfies VaultEntry];
  expect(resolveInlineAttachmentTarget("Notes/readme.md", "photo.png", ambiguous)).toBe("Notes/photo.png");
  expect(resolveInlineAttachmentTarget("Other/readme.md", "photo.png", ambiguous)).toBeNull();
});
