# 04 — Update and rollback contracts

**Rows:** Q-014 (update/rollback checks), Q-018, EXT-003 (signed update half stays external).

## Goal
Preserve the manifest, downgrade and restoration contracts currently enforced by `scripts/update-rollback.ts` and `fixtures/update-rollback.json` for the native package, without shipping an auto-updater yet.

## Scope
- Port or re-point the checks: manifest integrity (SHA-256), target vs rollback version, distinct previous artifact, `external-pending` when no previous signed artifact exists.
- Define the release-manifest schema (`release-manifest.json`) emitted by task 02 and consumed by the checks.
- An in-app updater is **not** in scope unless the product contract requires it; verify against `config/launch-contract.json` before adding one. Signed update artifacts and live rollback remain external.

## Design
- Contract check lives in `xtask` (`cargo xtask release-check`, new) or stays Bun until R7; record decision. The fixture JSON schema should remain compatible so evidence history stays comparable.
- Previous-version fixture is a synthetic manifest pair for CI; real previous signed artifacts are an external prerequisite.

## Steps
1. Inventory every assertion in `update-rollback.ts` and map it to the new check (traceability table).
2. Implement checks + failing-case tests (tampered hash, missing rollback, same-version rollback).
3. Wire into CI before and after packaging, as `desktop-build.yml` does today.

## Acceptance / CI evidence
- Positive and negative cases pass on exact SHA; report states "external-pending" for signed update verification.

## Risks
Mistaking a passing synthetic fixture for rollback proof; reports must label it synthetic.
