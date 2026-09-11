import {expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {scanPluginBundle} from "../src/plugins/bundle-prescreen.js";
import {PluginPolicy} from "../src/plugins/policy.js";

type DomFixture = {
  id: string;
  decision_id: string;
  status: string;
  target: string;
  probe: {source: string; reproduction: string; marker: "dom"; capability: "dom.privileged"};
  expected: {prescreen_marker: "dom"; policy_decision: "deny"; record_status: "unsupported_security"; visible: true};
  safe_alternatives_attempted: string[];
  limitation: string;
};

const root = resolve(import.meta.dir, "..");
const fixture = JSON.parse(readFileSync(join(root, "fixtures/arch-dom-compatibility.json"), "utf8")) as DomFixture;

test("DOM-dependent compatibility is an explicit fail-closed D15 decision", () => {
  expect(fixture.id).toBe("fixture:arch-dom-compatibility");
  expect(fixture.decision_id).toBe("D15");
  expect(fixture.status).toBe("denied-security");
  expect(fixture.safe_alternatives_attempted.length).toBeGreaterThan(0);
  expect(fixture.limitation).toContain("lifecycle");

  const prescreen = scanPluginBundle(fixture.probe.source);
  expect(prescreen.markerIds).toContain(fixture.expected.prescreen_marker);

  const policy = new PluginPolicy();
  const decision = policy.evaluate({pluginId: fixture.target ?? "dom-dependent-legacy-fixture", capability: fixture.probe.capability, detail: fixture.probe.reproduction});
  expect(decision.decision).toBe(fixture.expected.policy_decision);
  expect(decision.record).toMatchObject({status: fixture.expected.record_status, visible: fixture.expected.visible, capability: fixture.probe.capability});
});
