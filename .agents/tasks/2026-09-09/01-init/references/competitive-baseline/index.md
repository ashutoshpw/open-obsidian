# Obsidian competitive baseline

Working specification · v0.3 · 9 September 2026. Confirmed decisions, proposals and untested requirements remain distinguished.

[Back to plan](../../plan.md) · [Decision register](../decisions/index.md)

## Competitive baseline and evidence

Research cutoff: 9 September 2026. The official changelog shows Desktop 1.13.7 as public, dated 12 August, and Desktop 1.14.1 as Catalyst/early access, dated 8 September. Test public behavior as the stable baseline and maintain a separate early-access compatibility track. Recheck at specification freeze and before every release. Do not present roadmap items as released features.

The baseline inventory must include editing, properties, backlinks, graph, Canvas, Bases, search, workspaces, core plugins, community extensions, themes, CLI/automation, web capture, and the surrounding Sync/Publish/mobile workflows. Native AI alone is insufficient evidence of superiority: compare against both stock Obsidian and a representative plugin-equipped setup. Existing paid Obsidian service interoperability is not implied by local file compatibility.

Primary references, retrieved for this planning pass:

- [Official changelog](https://obsidian.md/changelog/): release dates and public versus early-access status; recent Bases and CLI changes.
- [Storage](https://obsidian.md/help/Files+and+folders/How+Obsidian+stores+data) and [configuration folder](https://obsidian.md/help/Files+and+folders/Configuration+folder): vault and settings model.
- [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/): interoperable Canvas structure.
- [Bases syntax](https://obsidian.md/help/bases/syntax): file-based view definition contract.
- [Obsidian API repository](https://github.com/obsidianmd/obsidian-api): public type definitions; these are not the application's implementation.
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security): renderer and IPC security constraints.
- [SQLite WAL](https://www.sqlite.org/wal.html): index storage and recovery constraints.

Detailed behavior below is a proposed acceptance contract. Exact edge-case equivalence must be established through reference behavior tests, not inferred from documentation alone.
