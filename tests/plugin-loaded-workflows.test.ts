import {expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";

type LoadedWorkflowFixture = {
  schema_version: number;
  id: string;
  checkpoint: string;
  decision_id: string;
  boundary: string;
  target_ids: string[];
  required_phases: string[];
  scenarios: Record<string, {workflow_id: string; description: string; initial_data: Record<string, unknown>; files: Array<{path: string; content: string}>}>;
  combination: {id: string; target_ids: string[]};
  safe_alternatives_attempted: string[];
  external_pending: string[];
  limitation: string;
};

const root = resolve(import.meta.dir, "..");
const fixture = JSON.parse(readFileSync(join(root, "fixtures/plugin-loaded-workflows.json"), "utf8")) as LoadedWorkflowFixture;
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {scripts?: Record<string, string>};

test("loaded-plugin workflow fixture keeps pinned scope and lifecycle boundaries explicit", () => {
  expect(fixture.schema_version).toBe(1);
  expect(fixture.id).toBe("fixture:plugin-loaded-workflows");
  expect(fixture.checkpoint).toBe("P3.2");
  expect(fixture.decision_id).toBe("D14");
  expect(fixture.boundary).toBe("electron-renderer");
  expect(fixture.target_ids).toEqual(["PC07", "PC17", "PC20", "PC21", "PC22", "PC23", "PC24"]);
  expect(fixture.required_phases).toEqual(["install", "restart", "update"]);
  expect(fixture.combination).toMatchObject({id: "combination:pc07-pc21-pc23", target_ids: ["PC07", "PC21", "PC23"]});
  expect(fixture.combination.target_ids.every((id) => fixture.target_ids.includes(id))).toBe(true);
  expect(packageJson.scripts?.["audit:plugin-loaded-workflows"]).toBe("bun scripts/audit-plugin-loaded-workflows.ts");

  for (const id of fixture.target_ids) {
    const scenario = fixture.scenarios[id];
    expect(scenario.workflow_id).toBe(`workflow:${id.toLowerCase()}`);
    expect(scenario.description.length).toBeGreaterThan(20);
    expect(Object.keys(scenario.initial_data).length).toBeGreaterThan(0);
    expect(scenario.files.length).toBeGreaterThan(0);
    expect(scenario.files.every((file) => file.path.length > 0 && file.content.length > 0)).toBe(true);
  }

  expect(fixture.safe_alternatives_attempted).toEqual(["mediated vault read", "bounded renderer preview", "workflow disabled"]);
  expect(fixture.external_pending.length).toBeGreaterThanOrEqual(5);
  expect(fixture.limitation).toContain("unchanged pinned main.js bytes");
  expect(fixture.limitation).toContain("does not certify stock Obsidian");
});
