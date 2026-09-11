import {expect, test} from "bun:test";
import {validateElectronVaultFixture} from "../scripts/audit-electron-vault.js";

test("Electron vault audit fixture stays explicit about its local boundary", () => {
  expect(validateElectronVaultFixture()).toEqual({phases: 7, paths: 3, assertions: 9});
});
