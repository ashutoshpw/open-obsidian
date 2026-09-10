import {expect, test} from "bun:test";
import {inspectStorageProtection} from "../src/core/storage-protection.js";

test("storage protection reports only evidence-backed OS states", () => {
  const fileVault = inspectStorageProtection("darwin", () => ({exitCode: 0, stdout: "FileVault is On.\n"}));
  const bitLocker = inspectStorageProtection("win32", () => ({exitCode: 0, stdout: "Conversion Status: Fully Encrypted\nProtection Status: Protection On\n"}));
  const linuxMapper = inspectStorageProtection("linux", () => ({exitCode: 0, stdout: "/dev/mapper/cryptroot\n"}));
  const linuxPlain = inspectStorageProtection("linux", () => ({exitCode: 0, stdout: "/dev/nvme0n1p2\n"}));
  const unavailable = inspectStorageProtection("darwin", () => ({exitCode: 1, stdout: "", stderr: "permission denied"}));

  expect(fileVault).toMatchObject({status: "enabled", method: "fdesetup status"});
  expect(bitLocker).toMatchObject({status: "enabled", method: "manage-bde -status"});
  expect(linuxMapper).toMatchObject({status: "enabled", method: "findmnt root source"});
  expect(linuxPlain.status).toBe("unknown");
  expect(unavailable).toMatchObject({status: "unknown", detail: "permission denied"});
});
