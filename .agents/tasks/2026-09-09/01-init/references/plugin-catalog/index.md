# First-release plugin support catalog

Working specification · v0.3 · 9 September 2026. Confirmed decisions, proposals and untested requirements remain distinguished.

[Back to plan](../../plan.md) · [Decision register](../decisions/index.md)

## Required support and workflow fixtures

Every row requires implementation effort and evaluation, currently **planned / not implemented or certified**. D15 takes priority over compatibility: proven isolation/preview conflicts remain safely disabled and explicitly unsupported, with evidence. All other supported workflows must pass. Workflows below are minimum acceptance requirements; expand them against pinned released artifacts before certification. Repository links preserve attribution; follow ownership redirects when pinning.

| Rank / requirement | Plugin and primary repository | Downloads | Minimum v1 acceptance workflow |
| --- | --- | ---: | --- |
| 1 / PC01 | [Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin) | 7,837,439 | Open/edit existing drawing files, preserve linked assets, follow note links, embed drawings, export and reopen in Obsidian; exercise the frozen release’s scripting interface. |
| 2 / PC02 | [Templater](https://github.com/silentvoid13/Templater) | 5,545,597 | Execute existing templates, dynamic values, prompts, includes and user scripts; create/move notes and preserve cursor/output behavior. Explicitly test system-command integration. |
| 3 / PC03 | [Dataview](https://github.com/blacksmithgu/obsidian-dataview) | 4,931,109 | Render existing DQL and DataviewJS queries from frontmatter/inline fields; validate links, tasks and refresh after external edits. |
| 4 / PC04 | [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) | 4,203,635 | Query, filter, group, create and complete tasks; retain existing date/status/recurrence syntax and correct source-note updates. |
| 5 / PC05 | [Advanced Tables](https://github.com/tgrosinger/advanced-tables-obsidian) | 3,180,678 | Navigate, edit and format Markdown tables using the plugin’s commands; validate calculations supported by the pinned version and intended serialization. |
| 6 / PC06 | [Git](https://github.com/vinzent03/obsidian-git) | 3,119,400 | Use an existing repository: status, diff, commit, pull/push and conflicts; preserve credential-helper behavior and scheduled operations on each OS. |
| 7 / PC07 | [Calendar](https://github.com/liamcain/obsidian-calendar-plugin) | 3,085,881 | Open/create daily notes from calendar navigation using existing date formats, folders and templates; test configured weekly-note integration. |
| 8 / PC08 | [Style Settings](https://github.com/obsidian-community/obsidian-style-settings) | 2,665,411 | Load theme/snippet/plugin setting definitions, change CSS variables/classes, persist values and render consistently across windows. |
| 9 / PC09 | [Kanban](https://github.com/obsidian-community/obsidian-kanban) | 2,644,322 | Open existing Markdown boards; move/edit cards and lanes, preserve metadata/links and reopen in Obsidian without board conversion. |
| 10 / PC10 | [Remotely Save](https://github.com/remotely-save/remotely-save) | 2,216,022 | Use existing supported backend configuration; authenticate, sync, resume interrupted transfer and preserve compatible encryption/conflict behavior. Test two-device text/binary/rename/delete cases. |
| 11 / PC11 | [Iconize](https://github.com/florianwoelki/obsidian-iconize) | 2,213,970 | Retain existing file/folder icon assignments and rules; validate renames, restart, sidebar/tab rendering and configured icon assets. |
| 12 / PC12 | [QuickAdd](https://github.com/chhoumann/quickadd) | 2,089,718 | Run existing capture/template/macro choices, including linked automation scripts; verify generated files and prompt/command ordering. |
| 13 / PC13 | [Claudian](https://github.com/yishentu/claudian) | 2,053,650 | Discover configured agent CLI, open a session, stream responses, provide selected context and preserve session/settings. Test tool approvals, file changes and process cancellation. |
| 14 / PC14 | [Editing Toolbar](https://github.com/pkm-er/obsidian-editing-toolbar) | 1,860,031 | Load configured toolbar, apply editing commands to selections, persist customization and verify source/live-preview/popout behavior. |
| 15 / PC15 | [Omnisearch](https://github.com/scambier/obsidian-omnisearch) | 1,850,420 | Run relevance/typo/phrase search and keyboard navigation, insert links and refresh the index. Include Text Extractor for PDF/image/document search. |
| 16 / PC16 | [Copilot](https://github.com/logancyang/obsidian-copilot) | 1,845,334 | Run the pinned release’s documented AI/agent workflows with existing supported configuration, context and history; test provider failure/cancellation and file-change controls. |
| 17 / PC17 | [Minimal Theme Settings](https://github.com/kepano/obsidian-minimal-settings) | 1,792,641 | With Minimal theme active, apply existing font/color/layout settings and hotkeys; persist values and verify both light and dark modes. |
| 18 / PC18 | [Importer](https://github.com/obsidianmd/obsidian-importer) | 1,647,030 | Run imports supported by the pinned release on their applicable OS; preserve attachments/links, handle collisions, and avoid modifying unrelated existing notes. |
| 19 / PC19 | [TaskNotes](https://github.com/callumalpass/tasknotes) | 1,422,632 | Create/update note-backed tasks and dates/recurrence; render configured Bases views and calendar/time-tracking workflows; preserve YAML and references. |
| 20 / PC20 | [Outliner](https://github.com/vslinko/obsidian-outliner) | 1,395,484 | Move/indent/outdent nested list blocks and use configured shortcuts; preserve child hierarchy and validate editor undo. |
| 21 / PC21 | [Homepage](https://github.com/mirnovov/obsidian-homepage) | 1,319,450 | Restore the configured startup target and supported workspace/view behavior; preserve startup settings and command integration. |
| 22 / PC22 | [Smart Connections](https://github.com/brianpetro/obsidian-smart-connections) | 1,192,397 | Build/use the pinned release’s semantic related-note index, retrieve relevant excerpts and reflect edited/deleted notes; verify configured local-model and exclusion behavior. |
| 23 / PC23 | [Recent Files](https://github.com/tgrosinger/recent-files-obsidian) | 1,183,033 | Record/reopen recent files, preserve configured exclusions and navigation behavior, and survive restart/rename/delete. |
| 24 / PC24 | [Tag Wrangler](https://github.com/pjeby/tag-wrangler) | 1,083,951 | Rename/merge hierarchical tags through plugin commands; update intended occurrences without corrupting unrelated text/properties. |
| 25 / PC25 | [Linter](https://github.com/platers/obsidian-linter) | 1,046,498 | Apply existing enabled rules to explicit test notes; preserve configured lint-on-save behavior and predictable YAML/Markdown output. No first-open bulk linting. |

## Runtime identity and dependency fixtures

Exact plugin IDs are required for discovery and configuration matching; display names are not identifiers:

PC01: `obsidian-excalidraw-plugin`; PC02: `templater-obsidian`; PC03: `dataview`; PC04: `obsidian-tasks-plugin`; PC05: `table-editor-obsidian`; PC06: `obsidian-git`; PC07: `calendar`; PC08: `obsidian-style-settings`; PC09: `obsidian-kanban`; PC10: `remotely-save`; PC11: `obsidian-icon-folder`; PC12: `quickadd`; PC13: `realclaudian`; PC14: `editing-toolbar`; PC15: `omnisearch`; PC16: `copilot`; PC17: `obsidian-minimal-settings`; PC18: `obsidian-importer`; PC19: `tasknotes`; PC20: `obsidian-outliner`; PC21: `homepage`; PC22: `smart-connections`; PC23: `recent-files-obsidian`; PC24: `tag-wrangler`; PC25: `obsidian-linter`.

- **Minimal theme** is a mandatory companion fixture because Minimal Theme Settings explicitly requires it. Test it together with Style Settings. Source: [Minimal Theme Settings upstream](https://github.com/kepano/obsidian-minimal-settings).
- **Text Extractor** is an additional mandatory compatibility dependency for Omnisearch's PDF, image and document indexing workflows. It is not claimed to rank in the top 25. Source: [Omnisearch upstream](https://github.com/scambier/obsidian-omnisearch).
- Freeze any other required dependency found while building fixtures. Optional integrations need explicit coverage entries; supporting a main plugin does not certify every third-party service or companion plugin automatically.
- Claudian's registry ID is `realclaudian`; do not substitute a similarly named fork. The registry notes that this entry has not been manually reviewed by Obsidian staff. Popularity is not a security endorsement.
- TaskNotes and modern Smart Connections workflows depend on recent Bases capabilities. Resolve minimum supported Obsidian/API versions from the selected release manifest, and add an early-access reference track where needed. Do not silently change the stable reference baseline to make a test pass.

## Related modules

[Selection evidence and manifests](../plugin-research/index.md) · [Runtime and launch gates](../plugin-compatibility/index.md)
