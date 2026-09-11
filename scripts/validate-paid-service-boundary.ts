import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {syncToolDispositions} from "../src/core/sync-tools.js";

type ServiceSurface = {id: string; label: string; status: "unsupported"; verification: "contract-only"; remote_contacted: false; entitlement: "not-inferred"};
type PaidServiceFixture = {schema_version: number; id: string; purpose: string; surfaces: ServiceSurface[]; invariants: string[]};

const root = resolve(import.meta.dir, "..");

function readFixture(): PaidServiceFixture {
  return JSON.parse(readFileSync(join(root, "fixtures/paid-service-boundary.json"), "utf8")) as PaidServiceFixture;
}

export function validatePaidServiceBoundary(fixture = readFixture(), rendererSource = readFileSync(join(root, "src/renderer/index.html"), "utf8")): string[] {
  const failures: string[] = [];
  if (fixture.schema_version !== 1) failures.push("paid-service fixture must use schema version 1");
  if (fixture.id !== "fixture:paid-service-boundary") failures.push("paid-service fixture ID is invalid");
  if (!fixture.purpose.trim()) failures.push("paid-service fixture purpose is empty");
  const expectedIds = ["obsidian-sync", "obsidian-publish"];
  const actualIds = fixture.surfaces.map((surface) => surface.id);
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) failures.push("paid-service fixture must list Sync and Publish separately");
  fixture.surfaces.forEach((surface) => {
    if (surface.status !== "unsupported" || surface.verification !== "contract-only" || surface.remote_contacted !== false || surface.entitlement !== "not-inferred") failures.push(`${surface.id} must remain unsupported, contract-only, remote-free and entitlement-free`);
  });
  fixture.invariants.forEach((invariant) => {
    if (!invariant.trim()) failures.push("paid-service invariants must be non-empty");
  });
  const disposition = syncToolDispositions().find((tool) => tool.id === "obsidian-sync-publish");
  if (!disposition || disposition.mode !== "unsupported" || disposition.remoteContacted || disposition.verification !== "contract-only") failures.push("sync disposition must remain unsupported and remote-free");
  if (!rendererSource.includes("External sync compatibility") || !rendererSource.includes("no Obsidian Sync or Publish access is implied")) failures.push("renderer must keep the paid-service boundary visible");
  return failures;
}

if (import.meta.main) {
  const failures = validatePaidServiceBoundary();
  failures.forEach((failure) => console.error(`PAID SERVICE ERROR: ${failure}`));
  if (failures.length > 0) process.exit(1);
  console.log("PAID SERVICE CHECK: passed; Sync and Publish remain separately unsupported and entitlement-free");
}
