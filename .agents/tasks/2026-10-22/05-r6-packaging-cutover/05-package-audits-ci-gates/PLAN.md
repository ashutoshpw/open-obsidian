# 05 — Package audits and CI gates

**Rows:** D12, D20, Q-014, Q-017, Q-018, RISK-009, MIG-010.

## Goal
Make the workflow and audits Electron-free: push/tag triggers, runner matrix, artifact hashes, notice/redistribution audit, labelled unsigned previews and a failing production gate when credentials are absent.

## Scope
- Rework `desktop-build.yml`: replace `bun run package:dir`/electron-builder steps; keep triggers (`main`, `v*` tags, PR, `workflow_dispatch` with preview/production), the 3-OS matrix and `RELEASE_MODE` logic; validate tag format `vYYYY-MM-DD` and calendar validity.
- Replace `audit:packaged` (Electron runtime notices) with a native package audit: no renderer HTML/JS or Electron runtime in the artifact (MIG-010), icon/identity present, license headers/notices present (D12).
- Dependency/redistribution audit from `Cargo.lock` (cargo-about/cargo-deny or equivalent; tool choice open) covering every shipped crate, plus bundled assets/fonts (RISK-009); replaces `audit-dependency-attribution.ts` for Rust.
- Add the full Rust gates (`fmt`, `test --workspace`, `clippy -D warnings`, `xtask layers`) as required checks on the packaging commit.

## Design
- Production mode without signing secrets fails with an explicit message and produces no artifact upload labelled release; preview artifacts are named `*-preview-<sha>`. Signing steps are stubs gated on secrets and stay unexercised (external-pending).

## Steps
1. Workflow-contract test: parse YAML, assert triggers, matrix, labels, no tag creation.
2. Credential-absent dry run asserts non-success production gate (Q-018).
3. Native package audit and notice audit with fixtures including a deliberately bad package.
4. Switch required checks and retire Electron packaging steps (final deletion in R7 task 01).

## Acceptance / CI evidence
- Exact-SHA run shows 3 OS previews, hashes, audits green; negative fixtures fail as expected.

## Risks
Notice audit may find unlicensed assets or copyleft conflicts (AGPL-only claim); treat findings as blocking and record, not waive.
