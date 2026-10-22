# 03 — Provider modes, managed seam and usage ledger

**Rows:** D07, D13, A05, A07, AI-001, AI-003, RISK-007, D05 (provider half).

## Goal
Typed managed / BYOK / local provider clients with explicit mode selection, deterministic error and cancellation behavior, and local usage/cap accounting. No billing service.

## Scope
- Port `ProviderError` codes (`invalid-config`, `credential-missing`, `scope-denied`, `unavailable`, `offline`, ...), `runProviderRequest`, `describeProvider`, `providerInput`, `ProviderUsageLedger` and `createFetchProviderTransport` from `src/core/providers.ts` (~400 lines).
- Managed mode: client seam for an OpenRouter-style proxy with endpoint unset by default; absent endpoint renders an honest "unavailable / setup required" state (AI-003).
- BYOK: credential via task 01 keychain. Local: user-configured local endpoint or model (see task 06).
- Versioned provider data-flow contract document (AI-001): per mode, what leaves the device, when, and which provider terms/live access are external-pending.

## Design
- `crates/engine/src/ai/providers.rs`: `trait ProviderTransport` (request -> response) with an injectable mock; real HTTP transport lives in the app crate so `engine` stays I/O-free (layering check). HTTP client crate choice is open; record it.
- Network egress is explicit: transport only called after the task 04 gate approves destination + context. Cancellation via a token; timeouts deterministic in tests.
- Ledger: per-day/per-mode usage and cap state in app-data; caps only warn/stop locally.

## Steps
1. Types, error taxonomy, mode selection state; contract doc.
2. Mock-transport conformance fixtures: selection, validation, timeout, cancellation, errors, **no fallback between modes**.
3. Managed seam + unavailable state; BYOK/local wiring.
4. Ledger and cap behavior tests.

## Acceptance / CI evidence
- Fixture matrix passes on 3 OSes with synthetic keys; missing-endpoint and bundle/tree inspection prove no secret or endpoint is baked in (AI-004). No live provider call in CI.

## Risks
Legacy price/cost fields may encode assumptions about provider pricing; port the shape, not numbers, and leave pricing to the external handoff.
