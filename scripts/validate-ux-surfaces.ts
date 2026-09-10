import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";

type SurfaceStatus = "implemented" | "external-pending";
type UXSurface = {id: string; label: string; status: SurfaceStatus; markers: string[]; note?: string; handoff?: string};
type UXSurfaceFixture = {schema_version: number; surfaces: UXSurface[]};

const root = resolve(import.meta.dir, "..");

function readText(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

function readFixture(): UXSurfaceFixture {
  return JSON.parse(readText("fixtures/ux-surfaces.json")) as UXSurfaceFixture;
}

function surfaceIdentityErrors(surface: UXSurface): string[] {
  const name = surface.id.trim() || "(unknown)";
  return [
    !surface.id.trim() ? "UX surface IDs must be non-empty" : null,
    !surface.label.trim() ? `${name} must have a label` : null,
  ].filter((error): error is string => Boolean(error));
}

function surfaceMarkerErrors(surface: UXSurface, source: string): string[] {
  const name = surface.id.trim() || "(unknown)";
  const markers = Array.isArray(surface.markers) ? surface.markers : [];
  if (markers.length === 0) return [`${name} must declare a UI marker`];
  return markers.every((marker) => source.includes(marker)) ? [] : [`${name} is missing a renderer marker`];
}

function surfaceStatusErrors(surface: UXSurface): string[] {
  const name = surface.id.trim() || "(unknown)";
  if (surface.status === "implemented" && !surface.note?.trim()) return [`${name} needs an implementation note`];
  const hasHandoff = surface.handoff?.includes("Owner:") || surface.handoff?.includes("Prerequisite:");
  if (surface.status === "external-pending" && !hasHandoff) return [`${name} needs an explicit owner/prerequisite handoff`];
  return [];
}

function surfaceErrors(surface: UXSurface, source: string): string[] {
  return [...surfaceIdentityErrors(surface), ...surfaceMarkerErrors(surface, source), ...surfaceStatusErrors(surface)];
}

function validateSurface(surface: UXSurface, source: string, failures: string[]): void {
  failures.push(...surfaceErrors(surface, source));
}

export function validateUXSurfaces(fixture = readFixture(), source = `${readText("src/renderer/index.html")}\n${readText("src/renderer/renderer.ts")}`): {failures: string[]; implemented: number; externalPending: number} {
  const failures: string[] = [];
  if (fixture.schema_version !== 1) failures.push("UX surface fixture must use schema version 1");
  if (!Array.isArray(fixture.surfaces) || fixture.surfaces.length === 0) failures.push("UX surface fixture must declare surfaces");
  const ids = fixture.surfaces.map((surface) => surface.id);
  if (new Set(ids).size !== ids.length) failures.push("UX surface IDs must be unique");
  fixture.surfaces.forEach((surface) => validateSurface(surface, source, failures));
  const implemented = fixture.surfaces.filter((surface) => surface.status === "implemented").length;
  const externalPending = fixture.surfaces.filter((surface) => surface.status === "external-pending").length;
  return {failures, implemented, externalPending};
}

if (import.meta.main) {
  const result = validateUXSurfaces();
  result.failures.forEach((failure) => console.error(`SURFACE ERROR: ${failure}`));
  if (result.failures.length > 0) process.exit(1);
  console.log(`SURFACE CHECK: passed; ${result.implemented} implemented, ${result.externalPending} external-pending named UX surfaces`);
}
