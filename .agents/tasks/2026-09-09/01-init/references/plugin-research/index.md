# Plugin selection evidence and version discovery

Working specification · v0.3 · 9 September 2026. Confirmed decisions, proposals and untested requirements remain distinguished.

[Back to plan](../../plan.md) · [Decision register](../decisions/index.md)

## Selection decision and method

The user requested research into the most-used Obsidian plugins and inclusion in the first release. Scope decision: the **top 25 currently registered community plugins ranked by cumulative downloads** are mandatory v1 compatibility targets on macOS, Windows and Linux. This is a transparent, reproducible cutoff rather than an editorial favorites list. Native core plugins remain covered separately by C10; they do not appear in community download rankings.

Source: Obsidian's own [community-plugin-stats.json](https://github.com/obsidianmd/obsidian-releases/blob/master/community-plugin-stats.json), joined by plugin ID to its [community-plugins.json registry](https://github.com/obsidianmd/obsidian-releases/blob/master/community-plugins.json). Downloaded and sorted locally during the 9 September 2026 research pass. Only IDs present in the current registry were ranked; order is descending numeric `downloads`. The independently published ObsidianStats list corroborated the same top 25, but the selection and counts below were computed from the primary data.

These are cumulative download events, **not measured active users or active installations**. The dataset contains version-specific counts and no active-user field. Lifetime counts favor older plugins and can reflect repeated updates/downloads. This research does not establish a last-30-day active-use ranking. Refresh popularity at release planning, but do not automatically remove any committed plugin because its rank later falls.

## Reproducibility record

Primary download URLs: [statistics](https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json) and [registry](https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json). A snapshot table is retained above because live counts change. SHA-256 of downloaded inputs:

- `community-plugin-stats.json`: `99c0b10ab6b02d01a9ed7474585d599511638706f35eda00582ad1e3eb997c37`
- `community-plugins.json`: `13608c196df5808661f67b4abea863f0c09a6d0db682bc3df782606ffadd7088`

No compatibility runtime has been built or tested in this planning task. The research establishes selection evidence, not implementation status. Historical mandatory-compatibility wording in this research snapshot is superseded by D15: retain all 25 in evaluation, with proven unsafe workflows disabled and visibly unsupported.

## Upstream manifest discovery snapshot

The following values were read from each registry-linked repository's `HEAD/manifest.json` during this research. They are **development-branch discovery values**, not verified published-release pins or tested compatibility claims. Release artifacts, hashes and matching documentation must be selected in P1. All 25 manifest requests succeeded; Git's returned manifest does not specify `minAppVersion`, which remains an explicit verification item.

| Requirement | Upstream manifest version | Declared minimum app version | Manifest source |
| --- | --- | --- | --- |
| PC01 | 2.27.3 | 1.8.7 | [manifest](https://raw.githubusercontent.com/zsviczian/obsidian-excalidraw-plugin/HEAD/manifest.json) |
| PC02 | 2.25.0 | 1.13.0 | [manifest](https://raw.githubusercontent.com/silentvoid13/Templater/HEAD/manifest.json) |
| PC03 | 0.5.68 | 0.13.11 | [manifest](https://raw.githubusercontent.com/blacksmithgu/obsidian-dataview/HEAD/manifest.json) |
| PC04 | 8.4.0 | 1.8.7 | [manifest](https://raw.githubusercontent.com/obsidian-tasks-group/obsidian-tasks/HEAD/manifest.json) |
| PC05 | 0.23.2 | 1.0.0 | [manifest](https://raw.githubusercontent.com/tgrosinger/advanced-tables-obsidian/HEAD/manifest.json) |
| PC06 | 2.39.0 | Not specified | [manifest](https://raw.githubusercontent.com/vinzent03/obsidian-git/HEAD/manifest.json) |
| PC07 | 1.5.10 | 0.9.11 | [manifest](https://raw.githubusercontent.com/liamcain/obsidian-calendar-plugin/HEAD/manifest.json) |
| PC08 | 1.0.9 | 0.11.5 | [manifest](https://raw.githubusercontent.com/obsidian-community/obsidian-style-settings/HEAD/manifest.json) |
| PC09 | 2.0.51 | 1.0.0 | [manifest](https://raw.githubusercontent.com/obsidian-community/obsidian-kanban/HEAD/manifest.json) |
| PC10 | 0.5.25 | 0.13.21 | [manifest](https://raw.githubusercontent.com/remotely-save/remotely-save/HEAD/manifest.json) |
| PC11 | 2.14.7 | 0.9.12 | [manifest](https://raw.githubusercontent.com/florianwoelki/obsidian-iconize/HEAD/manifest.json) |
| PC12 | 2.24.2 | 1.13.0 | [manifest](https://raw.githubusercontent.com/chhoumann/quickadd/HEAD/manifest.json) |
| PC13 | 2.2.6 | 1.13.0 | [manifest](https://raw.githubusercontent.com/yishentu/claudian/HEAD/manifest.json) |
| PC14 | 4.1.3 | 0.14.0 | [manifest](https://raw.githubusercontent.com/pkm-er/obsidian-editing-toolbar/HEAD/manifest.json) |
| PC15 | 1.31.0 | 1.13.3 | [manifest](https://raw.githubusercontent.com/scambier/obsidian-omnisearch/HEAD/manifest.json) |
| PC16 | 4.0.7 | 1.11.4 | [manifest](https://raw.githubusercontent.com/logancyang/obsidian-copilot/HEAD/manifest.json) |
| PC17 | 9.0.0 | 1.13.0 | [manifest](https://raw.githubusercontent.com/kepano/obsidian-minimal-settings/HEAD/manifest.json) |
| PC18 | 3.1.5 | 1.13.0 | [manifest](https://raw.githubusercontent.com/obsidianmd/obsidian-importer/HEAD/manifest.json) |
| PC19 | 4.12.5 | 1.12.2 | [manifest](https://raw.githubusercontent.com/callumalpass/tasknotes/HEAD/manifest.json) |
| PC20 | 4.10.2 | 1.11.7 | [manifest](https://raw.githubusercontent.com/vslinko/obsidian-outliner/HEAD/manifest.json) |
| PC21 | 4.5.0 | 1.13.0 | [manifest](https://raw.githubusercontent.com/mirnovov/obsidian-homepage/HEAD/manifest.json) |
| PC22 | 4.7.2 | 1.8.7 | [manifest](https://raw.githubusercontent.com/brianpetro/obsidian-smart-connections/HEAD/manifest.json) |
| PC23 | 1.7.10 | 0.16.3 | [manifest](https://raw.githubusercontent.com/tgrosinger/recent-files-obsidian/HEAD/manifest.json) |
| PC24 | 0.6.5 | 1.12.7 | [manifest](https://raw.githubusercontent.com/pjeby/tag-wrangler/HEAD/manifest.json) |
| PC25 | 1.32.0 | 1.12.0 | [manifest](https://raw.githubusercontent.com/platers/obsidian-linter/HEAD/manifest.json) |

These observed minimum-version declarations do not require moving the public baseline beyond 1.13.7, but manifests alone do not establish all API, undocumented behavior, or runtime dependencies.

## Related modules

[Mandatory plugin catalog](../plugin-catalog/index.md) · [Compatibility requirements](../plugin-compatibility/index.md)
