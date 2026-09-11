import {expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {analyzeRendererBoundary} from "../scripts/audit-plugin-renderer.js";

type RendererFixture = {
  id: string;
  checkpoint: string;
  decision_id: string;
  target_ids: string[];
  marker_capabilities: Record<string, string>;
  policy: {privileged_markers: string; marker_free_source: string; runtime_disposition: string};
  safe_fixture: {id: string; source: string; expected: string; execution: string};
  safe_alternatives_attempted: string[];
  coverage: string;
  limitation: string;
};

const root = resolve(import.meta.dir, "..");
const fixture = JSON.parse(readFileSync(join(root, "fixtures/plugin-renderer-probe.json"), "utf8")) as RendererFixture;

test("renderer preflight keeps privileged plugin sources fail-closed", () => {
  expect(fixture.id).toBe("fixture:plugin-renderer-preflight");
  expect(fixture.checkpoint).toBe("P1.2");
  expect(fixture.decision_id).toBe("D15");
  expect(fixture.target_ids).toHaveLength(8);
  expect(fixture.policy.privileged_markers).toBe("deny-before-renderer");
  expect(fixture.policy.runtime_disposition).toBe("pending-runtime");
  expect(fixture.coverage).toBe("renderer-sandboxed-module-load-only");
  expect(fixture.safe_fixture).toEqual({id: "fixture:renderer-mediated-source", source: "module.exports = {name: 'mediated-fixture'};", expected: "renderer-loaded", execution: "renderer-wrapper"});
  expect(fixture.safe_alternatives_attempted).toEqual(["mediated vault read", "preview broker", "workflow disabled"]);
  expect(fixture.limitation).toContain("lifecycle");
});

test("renderer preflight maps privileged markers to denied capabilities", () => {
  const source = "require('node:fs'); fetch('/api'); process.spawn('git'); keytar.getPassword(); document.body; WebAssembly.compile(); eval('1');";
  const decision = analyzeRendererBoundary(source);
  expect(decision.status).toBe("deny-before-renderer");
  expect(decision.execution).toBe("not-executed");
  expect(decision.deniedCapabilities).toEqual([
    "filesystem.direct",
    "network.request",
    "process.spawn",
    "credentials.read",
    "dom.privileged",
    "code.dynamic",
  ]);
  expect(decision.safeAlternativesAttempted).toEqual(fixture.safe_alternatives_attempted);
});

test("marker-free source is eligible only for the sandboxed renderer wrapper", () => {
  const decision = analyzeRendererBoundary("module.exports = {name: 'mediated'};");
  expect(decision).toMatchObject({status: "execute-renderer", execution: "renderer-wrapper", markers: [], deniedCapabilities: []});
});
