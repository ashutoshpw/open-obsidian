# 02 — Bases file inventory

**Rows:** C07.5 (child of C07).

## Goal
A bounded, no-symlink inventory so a base covers every safely supported regular file (including attachments), with explicit `complete` and `unavailable` semantics.

## Scope
- One inventory pass: 10,000 regular-file row cap, 100,000 filesystem entries inspected (directories and symlink entries counted, symlinks never followed).
- Source caps: `.base` 4 MiB, Markdown 512 KiB each and 16 MiB aggregate, 100,000 extracted tags/links/embeds, 16 MiB derived metadata. These are resource-safety defaults, not Obsidian claims.
- Caps applied before reads or hashing; attachment bodies and the whole vault are never hashed.
- Evaluation-level `complete` flag; over-cap rows omitted with a summary issue; oversized Markdown keeps filesystem metadata with source-derived properties `unavailable`; incomplete index makes affected backlinks unavailable. Characterize whether `.obsidian` files are included and the `file.file` vs `file.properties` distinction.

## Design
- Prior work: `wip/c07-combined-2400e57` contains a C07.5 inventory API (large `crates/engine/src/bases.rs` and `crates/vault/src/lib.rs` changes) and `fixtures/c07-bases-file-properties-reference.json`. Port it onto HEAD; do not merge the branch.
- Existing: `crates/engine/src/index.rs` (in-memory vault index) and `crates/vault/src/lib.rs` scoped walking; check whether the inventory should reuse the index walker rather than add a second one (uncertain).
- Evaluation entry points: `evaluate_base`, `evaluate_base_by_view_index` (`crates/engine/src/bases.rs`).

## Steps
1. Diff the wip inventory against HEAD APIs; list conflicts before porting.
2. Land the inventory type with caps and issues, with unit tests per cap (row, entry, per-file, aggregate, metadata).
3. Wire file properties (`file.name`, `ext`, `size`, `ctime`, `mtime`, `folder`, ...) for non-Markdown files; verify against the pinned reference fixture.
4. Symlink, permission-denied and non-UTF-8 name fixtures (cross-OS).

## Acceptance / CI evidence
- Cap tests plus a snapshot test proving the inventory writes nothing; three-OS CI on exact SHA.
- Reference comparison for file-property values on pinned Obsidian 1.14.4.

## Risks
Port conflicts with the R3 index; Windows/macOS path-case and timestamp differences (ctime semantics) may need documented exclusions.
