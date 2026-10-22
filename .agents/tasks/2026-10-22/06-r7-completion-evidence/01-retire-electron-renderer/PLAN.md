# 01 — Retire Electron, renderer and obsolete tooling

**Rows:** MIG-010 (final), MIG-016 (tooling half), PROD-001 (regression via Rust suites).

## Goal
Remove the shipped Electron app, renderer and TS tooling once every behavior they covered has Rust-side evidence.

## Scope
- Coverage-replacement table: for each of `src/core/*.ts`, `src/electron`, `src/renderer`, `src/plugins`, `src/shared`, `scripts/*.ts` and workflow, record the Rust/xtask replacement or "retired, not applicable" with a reason.
- Delete only rows that are fully mapped. Items still needed by Rust CI are kept and relocated: for example compatibility-pin verification (`scripts/verify-compatibility-pins.ts`), the Wry plugin-runtime audit (`scripts/audit-rust-plugin-runtime.ts`, called by `rust.yml`) and Obsidian reference scripts under `.agents/tasks/2026-10-07/`. Whether Bun remains as a CI dependency is open.
- Remove `electron`, `electron-builder`, TS config, `knip.json`, `quality.yml`, obsolete `package.json` scripts; keep or shrink `package.json` only if Bun scripts remain.

## Design
- Do it in reviewable stages: (1) mapping table checked by a script, (2) delete renderer + Electron main, (3) delete dead TS core, (4) workflow cleanup. Each stage must keep `rust.yml` green on its SHA.
- Keep git history as the archive; no `legacy/` copy in-tree unless the compatibility fixtures require pinned TS probes.

## Steps
1. Produce and review the mapping table; resolve every "no replacement" entry or record a decision.
2. Staged deletions with CI between stages.
3. Packaged-runtime inventory shows no HTML/JS/Electron files (MIG-010) on exact SHA.
4. Update `validate-*` style checks to xtask equivalents or remove them with a recorded reason.

## Acceptance / CI evidence
- Final workflow set contains no step that installs Electron; `rg -i electron` over tracked files returns only allow-listed historical references (list kept in a test).

## Risks
Deleting scripts that the existing evidence references by path: evidence files must stay readable (keep evidence JSON; paths in `requirements.json` must still resolve).
