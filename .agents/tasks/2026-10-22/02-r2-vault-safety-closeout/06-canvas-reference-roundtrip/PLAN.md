# 06 — Canvas and reference round-trip matrix

**Rows:** C06, C01, C01.2, GATE-001, Q-001, Q-002.

## Goal
Prove with byte snapshots and pinned Obsidian 1.14.4 that open/scan/index/preview/close writes nothing, and that approved edits (including Canvas) round-trip with unknown fields preserved.

## Scope
- C06: read/write text, file, web/link and group nodes plus ids, position, size, style, labels, edges, endpoints, subpaths; unknown fields preserved; reopen in reference Obsidian.
- C01/C01.2/GATE-001/Q-001: no-op byte/hash comparison across the supported matrix (Q-001 corpus: 100% identical after open/index/close), including config files and symlink boundaries.
- Q-002: golden edit fixtures show exact approved diffs and reopen in the reference.
- Remaining read-only product flows listed as open in `.agents/tasks/2026-10-07/c01.2-reference-roundtrip-matrix.md`.

## Design
- Existing: `crates/doc/src/canvas.rs` (`CanvasDocument`, `edit_text_node`, projections; text-node editing only), `fixtures/c06-canvas.json`, `c06-text-card*.json`, `golden-edit-fidelity.json`, `existing-vault.json`, `vault-differential.json`; reference tooling `audit-obsidian-vault-roundtrip.ts` and `.github/workflows/obsidian-vault-roundtrip.yml`. Edit coverage for non-text nodes (file/link/group, edges) is new.
- Shared "snapshot" helper likely belongs in `crates/testkit`; reuse it in tasks 08-10.
- Known evidence: C01.2 full round trip passed at `f396927`; do not re-prove, extend.

## Steps
1. Audit the pending-flow list in the matrix doc; map each to a test and the owning row.
2. Extend Canvas model/edit paths and fixtures to remaining node/edge kinds with unknown-field cases.
3. Extend the reference workflow with a Canvas-reopen step (Obsidian-authored and Rust-authored).
4. Build the no-op corpus runner for Q-001 and golden-diff fixtures for Q-002.
5. Mark rows only on exact-SHA green on 3 OSes.

## Acceptance / CI evidence
- Evidence JSON per OS with before/after hashes; failed attempts retained.

## Risks
Obsidian may rewrite files at open (record as reference behavior, not our failure); a headless reference run can flake on Windows/macOS UI waits (already seen in the C01.2 history).
