# Product and user journeys

Working specification · v0.3 · 9 September 2026. Confirmed decisions, proposals and untested requirements remain distinguished.

[Back to plan](../../plan.md) · [Decision register](../decisions/index.md)

## Product objective

Build an Electron application for individual power users that opens their existing Obsidian vault directly and improves knowledge retrieval, synthesis, and maintenance through integrated AI. Users must be able to return to Obsidian with their files and workflows intact. Existing community plugins and themes are an explicit compatibility target, not an optional replacement by our own ecosystem.

“Better than Obsidian” means demonstrably better on selected user tasks while meeting the compatibility and reliability gates below. It cannot honestly mean every existing and future plugin works without testing. Broad ecosystem compatibility remains the objective; a versioned certification matrix must make actual coverage visible. Any reduction of the user's compatibility requirement requires a product decision, not an engineering assumption.

## Vault types

- **Standard Vault:** open/create ordinary Obsidian-compatible folders without initializing Git or requiring an account.
- **Chronicle Vault:** the Git-enabled vault type. Offer explicit initialization or adoption of an existing repository, status/diff, selected-file commits, history, recoverable restore, optional remote setup and explicit pull/push with conflict resolution. Keep Markdown/Canvas/Bases/attachments authoritative and portable.
- Opening or scanning either type is read-only. Detect existing Git without initializing, staging, committing or contacting remotes automatically. Upgrade Standard to Chronicle only through an explicit action; switching off Chronicle features never deletes `.git` or history. Test dirty repositories, existing branches/remotes, unborn HEAD, no configured author, offline operation and merge conflicts.
- Keep credentials, app caches, embeddings and recovery snapshots out of new Git commits by default. Review selected paths and exclusions before each commit. Preserve existing ignore rules and unrelated staged changes. Personal vault remote actions require vault-level user intent; project CI/push authorization does not transfer to vaults. Do not enable competing Git/Remotely Save automatic writers by default.
- Chronicle is built-in functionality and does not certify PC06 (the unchanged Git plugin). It uses the same revision checks and recovery boundaries; Git history does not replace the recovery journal.

## Core journeys

1. **Adopt without migration:** choose an existing directory → read-only compatibility scan → see notes, graph, Canvas, Bases, and extension status → open a note immediately → explicitly enable desired extensions. Never require an account for local note access.
2. **Find reliable answers:** ask a question → choose vault/folder scope → retrieve relevant passages → receive an answer with clickable file/heading/block citations → inspect evidence. If evidence is absent or conflicting, say so.
3. **Write with context:** select text or a note → request draft/rewrite → review a diff → accept all or individual changes → undo. Preserve existing formatting outside the approved edit.
4. **Maintain knowledge:** propose links, tags, duplicate merges, or folder moves → inspect affected files and references → apply a recoverable batch → verify links. Suggestions are distinct from factual assertions.
5. **Think spatially:** open an existing Canvas → edit file/text/link/group nodes and edges → optionally request an AI-generated arrangement → approve changes → reopen in Obsidian.
6. **Keep familiar workflows:** enable a certified existing plugin/theme → reuse supported settings → run its commands and views → retain its files and data after restart and reopening in Obsidian.
7. **Recover safely:** encounter an external edit or interrupted save → preserve local and external versions → resolve conflict or restore history without losing either version.
