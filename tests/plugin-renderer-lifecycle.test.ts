import {expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";

type LifecycleFixture = {
  schema_version: number;
  id: string;
  checkpoint: string;
  decision_id: string;
  boundary: string;
  safe_source: string;
  dom_source: string;
  expected: {
    safe_status: string;
    safe_coverage: string;
    safe_lifecycle_events: string[];
    safe_api: {commands: string[]; views: string[]; settings: string[]; events: string[]; persistence: string[]};
    dom_status: string;
    dom_coverage: string;
    dom_denied_capability: string;
    dom_lifecycle_events: string[];
  };
  safe_alternatives_attempted: string[];
  external_pending: string[];
  limitation: string;
};

const root = resolve(import.meta.dir, "..");
const fixture = JSON.parse(readFileSync(join(root, "fixtures/plugin-renderer-lifecycle.json"), "utf8")) as LifecycleFixture;

test("renderer lifecycle fixture keeps synthetic execution and external plugin scope separate", () => {
  expect(fixture.schema_version).toBe(1);
  expect(fixture.id).toBe("fixture:plugin-renderer-lifecycle");
  expect(fixture.checkpoint).toBe("P1.2");
  expect(fixture.decision_id).toBe("D15");
  expect(fixture.boundary).toBe("electron-renderer");
  expect(fixture.expected.safe_lifecycle_events).toEqual(["constructed", "plugin-onload", "onload", "plugin-onunload", "onunload"]);
  expect(fixture.expected.safe_api).toEqual({commands: ["lifecycle-command"], views: ["lifecycle-view"], settings: ["lifecycle-settings"], events: ["vault-change"], persistence: ["loadData", "saveData"]});
  expect(fixture.expected.dom_lifecycle_events).toEqual(["constructed"]);
  expect(fixture.expected.dom_denied_capability).toBe("dom.privileged");
  expect(fixture.safe_alternatives_attempted).toEqual(["mediated vault read", "scoped renderer preview", "workflow disabled"]);
  expect(fixture.external_pending).toHaveLength(4);
  expect(fixture.limitation).toContain("synthetic");
  expect(fixture.limitation).toContain("unchanged plugin");
});
