# 08 — Chronicle and Standard vault safety

**Rows:** PROD-003, PROD-005, D21.

## Goal
Both vault types are visible, tested and interoperable. Opening or scanning either is read-only; existing Git is detected, never modified, contacted or initialized implicitly.

## Scope
- Standard Vault: account-free create/open of ordinary Obsidian-compatible folders; no Git initialization.
- Chronicle Vault: Git-enabled but with ordinary vault portability; Git actions (init, stage, commit, revert) are explicit and reversible, each requiring a user action.
- No-op scan fixtures: dirty repository, remotes, unborn HEAD, offline, no content/config/Git state change.
- Interop: a vault moves between types without data loss.

## Design
- Existing: `fixtures/vault-safety.json`, `fixtures/existing-vault.json`; no Git code was found in `crates/vault` (grep to confirm at start). Likely new: `crates/vault/src/git.rs` (or a `crates/git` crate) that detects state by reading `.git` files, or shells out to `git` only on explicit actions. Choice of `gix` vs the git CLI is **undecided**; record in `decisions.md` with the licensing and binary-size impact.
- Snapshot harness from task 06 includes `.git` contents in hashes.
- UI: vault-type selection in `crates/ui-egui/src/lib.rs` (new surface; coordinate with R3 workspace owners).

## Steps
1. Decide Git access strategy; document.
2. Detection API (read-only) plus fixtures for the four repo states.
3. No-op scan tests proving `.git` bytes unchanged, no network call (offline sandbox in CI).
4. Explicit action layer with undo for each action.
5. Vault-type create/open UI and portability round trip.

## Acceptance / CI evidence
- Three-OS evidence; hashes of the full tree including `.git`; test that no remote URL is contacted.

## Risks
Git hooks and config can execute code if the CLI is invoked on open (avoid: never spawn git during scan); worktrees/submodules/bare layouts are edge cases that may need documented exclusions.
