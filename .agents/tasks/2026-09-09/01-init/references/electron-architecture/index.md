# Electron architecture and extension boundaries

Working specification · v0.3 · 9 September 2026. Confirmed decisions, proposals and untested requirements remain distinguished.

[Back to plan](../../plan.md) · [Decision register](../decisions/index.md)

## Proposed architecture

- Electron main process brokers windows, OS integration and narrowly scoped file operations. Renderer uses isolated context, sandboxing, no direct Node access and validated IPC. Remote content and HTML embeds remain isolated from privileged code.
- Shared TypeScript domain core for parsing, links, properties, changesets and compatibility contracts. CodeMirror-based editor is a candidate to evaluate against extension demands; framework choice follows the compatibility spike rather than dictating it.
- Utility processes handle indexing, parsing, retrieval and model work. A plugin compatibility surface may require a separate renderer/runtime; no claim of strong isolation until proven on each OS. A worker or Node VM alone is insufficient.
- Original vault files remain authoritative. SQLite/full-text index, graph and embeddings are rebuildable and live in app storage, outside externally synced vault paths. Recovery snapshots and action history are durable user data with an explicit retention policy, not disposable caches.
- New app metadata uses a reserved namespace only if portable metadata is necessary. Never inject opaque AI state into existing note frontmatter. Stable identity must tolerate rename, duplicate and external file replacement.
- All app-mediated modifications pass through a revision-aware writer and recovery journal. Native legacy plugins may bypass this mechanism; the compatibility/security milestone must resolve or disclose that limitation rather than promise protections the runtime cannot enforce.

Choose library versions and distribution tooling during implementation against then-current official documentation. Do not lock an Electron version in this PRD without validating support and extension compatibility.

The architecture review reinforces that separate processes and OS credential storage do not by themselves guarantee secrecy against legacy extensions with broad same-user filesystem, process or keychain access. The feasibility milestone must test actual OS-enforced boundaries. Do not promise both unrestricted legacy behavior and enforceable per-file permissions without evidence. Plugins that require direct DOM access also need a tested UI compatibility design; an isolated background host alone cannot reproduce those behaviors.

Proposed extension modes: an explicitly trusted legacy compatibility mode and a restricted mode for extensions that work with scoped capabilities. These are design alternatives pending D15, not a waiver of D04. Keep provider credentials out of plugin environments, and put sensitive provider/permission dialogs outside theme-controlled UI. Theme network blocking can itself affect compatibility and must be recorded in the matrix.

A useful initial spike corpus is 30–50 representative plugins and 10–15 themes, including every user-designated critical extension. These counts are proposed research scope, not launch coverage. Test direct filesystem access, native ABI assumptions, cross-plugin dependencies, monkey-patching, process spawning, key access, resource exhaustion and supply-chain updates. Launch-critical workflows still require full passing acceptance; a high aggregate percentage cannot conceal a broken critical workflow.
