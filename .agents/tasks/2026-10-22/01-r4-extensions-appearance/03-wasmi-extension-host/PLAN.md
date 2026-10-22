# 03 — Bounded `wasmi` extension host (Rust-era plugins)

**Rows:** MIG-008 (WASM projections, labelled separately), PLUG-002 (lifecycle), RISK-003.

## Goal
Run WASM extensions with hard resource limits and capabilities mediated only by task 02's broker.

## Scope
- `wasmi = "2.0.0"` (default features off; `std`, `validate`, `stable`, `portable-dispatch` as pinned in goal.md), added to `crates/plugins` only; `unsafe` stays denied.
- Limits: fuel per call, max linear memory, max table size, wall-clock deadline via epoch/fuel checks, max output bytes, max host-call rate.
- Host functions (versioned ABI `openobsidian:ext/1`): `vault.read(path)`, `vault.propose_change(...)`, `log`, `command.register`, `settings.get/set` — each calls the broker; no WASI filesystem/network.
- Extension package: `extension.json` (id, version, abi, requested capabilities) + `.wasm`, hash-pinned.

## Design
- `crates/plugins/src/wasm/{host,abi,limits}.rs`; instances are created per call or per session with a reset policy; traps return typed errors, never panic the app.
- Run on a rayon/worker thread with a cancellation token (reuse the R3 `MIG-006` cancel token).
- Provide a tiny reference extension (Rust → wasm32) in `fixtures/` built only in CI for tests.

## Steps
1. ABI doc + host skeleton loading a trivial module; fuel/memory limit tests (infinite loop, memory bomb, deep recursion).
2. Broker-backed host functions with denial tests.
3. Lifecycle: load/unload/reload, crash isolation, restart recovery.
4. Cancellation + timeout tests; fuzz-ish malformed wasm inputs.

## Acceptance / CI evidence
- Limit-breach fixtures all terminate within bounds on 3 OSes; no host panic; broker denials visible.
- Evidence file labels results "WASM projection" (never counted toward unchanged-JS certification).

## Risks
wasmi 2.0 API drift (verify the version resolves in `Cargo.lock` with `--locked`); cross-platform float/NaN determinism is not required.
