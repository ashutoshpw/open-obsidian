# 02 — Documentation update and stale-instruction audit

**Rows:** MIG-016, D17 (branding consistency), D12 (notice docs).

## Goal
Every user, architecture, developer, build, packaging, update, compatibility, security and platform document matches shipped Rust behavior, enforced by a CI audit.

## Scope
- Rewrite `README.md`, `release-handoff.md`, `PRIVACY.md`, `scripts/README.md` (or its replacement), `docs/architecture/*`, and update `config/launch-contract.json` (`runtime`, `status`, `certification_status`) and any status/`state.json` text.
- New docs where missing: build/test instructions (`cargo` workflows), packaging, update/rollback, platform limitations, AI data-flow contract (from R5 03), credential handling, plugin runtime support statement from R4.
- Docs affected by earlier phases should already be updated per MIG-016; this task audits that and fills gaps.

## Design
- `cargo xtask docs-audit` (new): extracts relative links, checks they resolve; greps tracked docs for stale Electron instructions (`electron`, `bun run package`, `electron-builder`, `safeStorage` ...) against an allow-list of explicitly historical files; verifies changed docs per phase via a manifest of doc owners.
- Historical docs carry a header like "Historical: describes the Electron-era implementation".

## Steps
1. Inventory docs and classify: current / rewrite / historical.
2. Rewrite and add docs; link-check.
3. Implement `docs-audit` with negative fixtures; add to `rust.yml`.
4. Cross-check claims (feature, platform, plugin statuses) against the matrix from task 03.

## Acceptance / CI evidence
- Docs audit green on exact SHA with allow-list reviewed; negative fixture proves it detects a stale instruction.

## Risks
Claims drifting from the matrix: derive status tables from `requirements.json` rather than hand-writing them.
