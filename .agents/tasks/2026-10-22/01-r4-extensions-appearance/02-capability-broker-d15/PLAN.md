# 02 — Capability broker and D15 records

**Rows:** D11, D15, MIG-013, PLUG-007, RISK-003, GATE-004, A09 (plugin-AI half), C09.1, PLUG-008.

## Goal
A single policy/broker layer that every plugin runtime (WASM and WebView) must go through. Default is deny; allowed effects are explicit, previewable and recoverable.

## Scope
- Capability enum: `VaultRead(scope)`, `VaultWrite(scope)` (staged), `Network(origin)`, `Process`, `Credential`, `Clipboard`, `ConfigurationWrite`, `Workspace(ui)`.
- Grant model per plugin id + artifact hash; grants stored in app data (not the vault), visible and revocable.
- **Write path:** plugin write requests become a `ProposedChange` (path, expected revision, new bytes/span edits). User approves a preview, then the engine applies it through the existing revision-checked writer (`VaultSession::write`, journaled). Unapproved/stale changes never touch disk. Automatic writers (Templater, Linter, Tasks) run with explicit per-plugin automation permission only; first open stays no-op (PLUG-008).
- **D15 records:** extend `D15Record` so every denial has reproduction, safe alternatives attempted, a denial test id, and a visible compatibility entry. A denial because a feature is not implemented is `failing`, not D15.
- Complete C09.1: enablement and discovery callsites consult `ConfigurationWriteRequest` policy and show the decision.

## Design
- `crates/plugins/src/broker.rs`: `trait CapabilityBroker { fn request(&self, plugin: &PluginRef, cap: Capability) -> Decision }`, `Decision::{Allow, Deny(D15Record), NeedsApproval(ProposedChange)}`.
- Pure and synchronous; no I/O in `crates/plugins` (engine supplies the executor), keeping the layering check green.
- Network: allow-list by origin; no ambient network in WASM host; WebView CSP `connect-src` stays blocked unless broker grants a specific origin proxied through Rust.

## Steps
1. Capability/decision types + exhaustive unit tests (deny by default, per-plugin isolation, grant revocation).
2. `ProposedChange` + engine adapter using `VaultSession::write`/`create_note`/`trash_note`; stale-revision refusal tests.
3. D15 record builder with required fields; refuse to build one without a denial test id.
4. Bypass fixtures: path traversal, symlink, `.obsidian` writes, process spawn, credential file reads, alternate network mechanisms.

## Acceptance / CI evidence
- Denied-path suite passes on 3 OSes; vault byte snapshots unchanged for every denied attempt.
- MIG-013/PLUG-007 evidence JSON listing each bypass attempt and its recorded decision.

## Risks
Scope creep into R5 (AI broker): keep AI-provider credentials out of this task; only define the hook that R5 will implement.
