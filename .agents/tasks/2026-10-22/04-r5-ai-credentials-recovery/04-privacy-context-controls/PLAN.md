# 04 — Privacy defaults and context controls

**Rows:** A06, D17, Q-015, AI-002, RISK-006 (prompt-injection half), PROD-001 (portability of AI additions, shared with 06).

## Goal
A single pre-inference gate: the user sees the exact scope, files and destination; exclusions are enforced; telemetry/diagnostics never contain note content or secrets.

## Scope
- Context set UI (R3 panes): selected notes/folders/search results, per-item remove, destination mode label, byte/token estimate.
- Exclusion rules (folders, globs, properties) applied before indexing and before request building.
- Port `DEFAULT_PRIVACY_DEFAULTS`, `createDiagnosticManifest`, `DIAGNOSTIC_CONTROLS` from `src/core/privacy.ts` (~75 lines). Default telemetry is off or content-free; diagnostics are a user-reviewed manifest.
- Prompt-injection posture: retrieved note text is data; it cannot widen scope, select tools or approve changes.

## Design
- `crates/engine/src/ai/context.rs`: `ContextPlan` is the only input accepted by the provider transport (task 03); builder returns a refusal if any path is excluded or out of scope. Broker (R4 02) hook defined there for plugin-originated AI calls.
- Diagnostics manifest is a pure struct with a field allow-list; adding a field requires a test update.

## Steps
1. `ContextPlan` + exclusion enforcement with canary fixtures.
2. Diagnostic manifest and telemetry-default tests (assert no content/secrets, via sentinel strings).
3. Injection fixtures: hostile note text attempting scope expansion/change approval.
4. UI wiring and keyboard/focus checks for the context pane.

## Acceptance / CI evidence
- Canary exclusions absent from every serialized request across modes; telemetry tests pass; injection fixtures meet scorecard; evidence JSON per OS.

## Risks
"Silent upload" can also happen via plugins or link previews; the plugin network path is governed by R4 02 and must be cross-checked in a test here.
