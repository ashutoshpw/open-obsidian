import {expect, test} from "bun:test";
import {validatePluginExternalPrerequisites} from "../scripts/validate-plugin-external-prerequisites.js";

test("plugin prerequisite fixture mirrors the pinned catalog and stays external-only", () => {
  expect(validatePluginExternalPrerequisites()).toEqual([]);
});
