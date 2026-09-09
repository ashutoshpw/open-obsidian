# Vault and file compatibility

Working specification · v0.3 · 9 September 2026. Confirmed decisions, proposals and untested requirements remain distinguished.

[Back to plan](../../plan.md) · [Decision register](../decisions/index.md)

## Compatibility requirements

| ID | Surface | Required behavior and acceptance |
| --- | --- | --- |
| C01 | Vault/filesystem | Open selected folder directly. Preserve paths, attachment names, arbitrary files, and unrecognized content. No silent vault migration. No content writes during scan, index, preview, or no-op close. |
| C02 | Markdown | Source, live-preview, and reading workflows; preserve BOM, line endings, whitespace, comments, unknown syntax, and untouched spans. Specify rendering of tables, tasks, footnotes, callouts, math, diagrams, code, highlights, and safe HTML. |
| C03 | Links | Wikilinks, Markdown links, aliases, relative paths, headings, block IDs, unresolved targets, embeds and transclusions. Rename/move must update intended references using parsed resolution rules. Test ambiguous basenames and heading duplicates. |
| C04 | Properties | Preserve YAML keys, values, comments, ordering, types, aliases/tags/cssclasses, and unknown/nested data even where no structured editor exists. Properties UI cannot discard content it cannot represent. |
| C05 | Graph | Global/local graph derived from links; file nodes, attachments, unresolved targets, filters, groups, search, navigation and layout controls. Graph state is derived; opening graph must not create note files. |
| C06 | Canvas | Read/write .canvas: text, file, web/link, group nodes; IDs, position, size, style, labels, edges, endpoints and subpaths. Preserve unknown fields. Canvas text cards are not automatically notes. |
| C07 | Bases | .base files plus embedded definitions; filters, formulas, properties, sorting, grouping and supported view types. Implement versioned grammar and evaluator. Never silently rewrite unsupported expressions; expose an explicit compatibility issue. |
| C08 | Attachments | Images, PDFs, audio/video and other files; existing embed dimensions, fragments and relative destinations. Unknown binaries remain intact and available to open externally. OCR/transcription is an optional derivative, never a replacement for originals. |
| C09 | Configuration | Detect .obsidian and alternate configuration folders. Preserve them. Map supported preferences, hotkeys, snippets, themes and extension settings. App-owned settings separate by default. Shared plugin configuration writes require an explicit policy. |
| C10 | Core workflows | File explorer, tabs, splits, popouts, command palette, quick switcher, bookmarks, outline, backlinks, outgoing links, templates, daily notes, note composition, history, tasks and tags. Inventory every core feature as tested, incomplete, or intentionally deferred. |
| C11 | Plugins | Load supported existing artifacts unchanged against a compatibility runtime; match API/event ordering, editor interfaces, workspace views, metadata cache, settings, commands, file adapters and persistence. Version and OS-specific results required. |
| C12 | Themes/snippets | Support existing CSS variables, selectors, editor markup and relevant layout contracts. Test light/dark modes, plugin-created views, popout windows and accessibility. New AI UI must coexist without breaking the legacy styled surface. |
| C13 | External tools | Watch and reconcile changes from Obsidian, editors, Git and tested sync tools. Preserve both versions on unresolved conflicts. Do not hijack obsidian:// URLs without a user choice. CLI/deep-link compatibility gets its own matrix. |
| C14 | Exit portability | Files edited here reopen and behave correctly in reference Obsidian. New AI outputs default to ordinary Markdown/Canvas; chat history export available. No mandatory proprietary database for note access. |

Preserving an unsupported format is necessary but does not count as full functional compatibility. Track byte fidelity, behavioral fidelity, visual fidelity, and extension compatibility separately.

C15 — Vault types: implement Standard and Chronicle vaults according to the product module, including explicit Git initialization/adoption, diff/commit/history/restore, optional remotes, conflict recovery, no-op opening and credential/cache exclusions. Cover both types in file-fidelity and end-to-end suites. C11 certification follows D15: proven unsafe workflows stay disabled and visibly unsupported; there is no trusted bypass.
