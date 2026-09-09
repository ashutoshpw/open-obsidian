# Sync, file safety and recovery

Working specification · v0.3 · 9 September 2026. Confirmed decisions, proposals and untested requirements remain distinguished.

[Back to plan](../../plan.md) · [Decision register](../decisions/index.md)

## Data safety, sync and recovery

On save, check the current file revision against the editor base; rebase or perform a three-way merge where safe. Preserve complete conflicting versions when unresolved. Use durable, same-directory temporary writes and atomic replacement where the filesystem permits, with tested fallbacks and recovery snapshots. Multi-file changes are journaled and recoverable, not assumed filesystem-atomic.

Watcher events are hints: verify changes and rescan after overflow, sleep or reconnect. Cover disk full, permission loss, concurrent edits, delete-versus-edit, rename-versus-edit, partial sync, cloud placeholders, symlinks, case-only renames, Windows reserved names and Unicode normalization. External applications do not honor our locks; any remaining cross-process race must be documented and mitigated with version preservation.

Confirmed sync scope: no own sync service in first desktop release; certify a named external-tool matrix and document unsupported combinations. Local compatibility does not grant access to Obsidian Sync or Publish. Optional future own sync must specify E2EE, device membership, key recovery/revocation, offline replay, tombstones, binaries, merge/conflict semantics and server retention. Live collaboration is a separate product choice; a CRDT cannot alone reconcile arbitrary external file edits.

Proposed local history: 30 days, adjustable storage cap, no silent removal of unresolved conflicts. Retention and encryption-at-rest policies require confirmation. Uninstall must not delete the user's vault; cleanup offers explicit choices for app caches, credentials and history.
