//! Read-only data source consumed by the workspace UI.
//!
//! The workspace never touches the filesystem or the engine directly. Everything it displays
//! comes through [`WorkspaceBackend`], and everything it wants changed is returned to the host as
//! a [`super::WorkspaceAction`]. That keeps the workspace logic testable with
//! [`InMemoryBackend`] and lets the host decide how (and on which thread) the vault is indexed.

use super::fuzzy::{compare_names, rank_strings};
use std::collections::{BTreeMap, BTreeSet};

/// One note that links to the note being inspected.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BacklinkRow {
    /// Vault-relative slash path of the linking note.
    pub source: String,
    /// One-based line number of the link inside `source`.
    pub line: usize,
}

/// One link leaving the note being inspected.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LinkRow {
    /// The link target as written (without alias, heading or block suffix).
    pub target_label: String,
    /// Vault-relative slash path of the resolved note, or `None` for an unresolved link.
    pub resolved: Option<String>,
}

/// One full-text search hit.
#[derive(Clone, Debug, PartialEq)]
pub struct SearchRow {
    /// Vault-relative slash path of the matching note.
    pub path: String,
    /// Relative relevance; higher is better. Only comparable within one result set.
    pub score: f32,
    /// A short, single-line excerpt around the first match.
    pub preview: String,
}

/// Synchronous, cheap queries the workspace issues while rendering.
///
/// Implementations should answer from an in-memory index; the workspace caches results per
/// [`WorkspaceBackend::revision`], so a backend that bumps its revision whenever the index
/// changes is only queried again when something actually changed. All paths are vault-relative
/// and slash separated, e.g. `folder/note.md`.
pub trait WorkspaceBackend {
    /// Monotonic counter that changes whenever any answer below may have changed.
    ///
    /// The default of `0` disables nothing; it only means cached answers are reused until the
    /// query itself changes. Backends that can change underneath the workspace should override it.
    fn revision(&self) -> u64 {
        0
    }

    /// All vault files, in any order.
    fn list_paths(&self) -> Vec<String>;

    /// Notes linking to `path`.
    fn backlinks(&self, path: &str) -> Vec<BacklinkRow>;

    /// Links leaving `path`, in document order.
    fn outgoing_links(&self, path: &str) -> Vec<LinkRow>;

    /// Full-text search, best hit first, at most `limit` rows.
    fn search(&self, query: &str, limit: usize) -> Vec<SearchRow>;

    /// Fuzzy file-name matches for the quick switcher, best first, at most `limit` paths.
    fn quick_switch(&self, query: &str, limit: usize) -> Vec<String>;

    /// Every tag (without the leading `#`) and the number of notes that use it.
    fn tags(&self) -> Vec<(String, usize)>;

    /// Notes that use `tag` (with or without the leading `#`).
    fn notes_with_tag(&self, tag: &str) -> Vec<String>;
}

// Engine adapter (to be wired by the integrator once `openobsidian_engine` exposes its vault
// index). It is intentionally not compiled here so this module does not depend on index types
// that may still be changing. The expected shape is:
//
//     pub struct EngineBackend<'a> {
//         index: &'a openobsidian_engine::VaultIndex,
//     }
//
//     impl WorkspaceBackend for EngineBackend<'_> {
//         fn revision(&self) -> u64 { self.index.generation() }
//         fn list_paths(&self) -> Vec<String> { /* index file list as slash paths */ }
//         fn backlinks(&self, path: &str) -> Vec<BacklinkRow> { /* index backlinks */ }
//         fn outgoing_links(&self, path: &str) -> Vec<LinkRow> { /* resolved outgoing links */ }
//         fn search(&self, query: &str, limit: usize) -> Vec<SearchRow> { /* full text */ }
//         fn quick_switch(&self, query: &str, limit: usize) -> Vec<String> {
//             /* index fuzzy file search, or super::fuzzy::rank_strings over list_paths */
//         }
//         fn tags(&self) -> Vec<(String, usize)> { /* tag counts */ }
//         fn notes_with_tag(&self, tag: &str) -> Vec<String> { /* tag members */ }
//     }
//
// Every method must stay cheap and non-blocking because it may run on the UI thread.

const PREVIEW_CHARS: usize = 120;

/// A complete in-memory vault for tests and demos.
///
/// Links are `[[target]]`, `[[target|alias]]` and `[[target#heading]]` wikilinks; tags are
/// whitespace-delimited `#tag` tokens. Resolution mirrors Obsidian's shortest-path rule.
#[derive(Clone, Debug, Default)]
pub struct InMemoryBackend {
    notes: BTreeMap<String, String>,
    revision: u64,
}

impl InMemoryBackend {
    /// An empty vault.
    pub fn new() -> Self {
        Self::default()
    }

    /// Builder-style [`Self::insert_note`].
    #[must_use]
    pub fn with_note(mut self, path: impl Into<String>, content: impl Into<String>) -> Self {
        self.insert_note(path, content);
        self
    }

    /// Adds or replaces a note and bumps the revision.
    pub fn insert_note(&mut self, path: impl Into<String>, content: impl Into<String>) {
        self.notes.insert(path.into(), content.into());
        self.revision += 1;
    }

    /// Removes a note and bumps the revision when it existed.
    pub fn remove_note(&mut self, path: &str) -> Option<String> {
        let removed = self.notes.remove(path);
        if removed.is_some() {
            self.revision += 1;
        }
        removed
    }

    /// The content of `path`, if present.
    pub fn note(&self, path: &str) -> Option<&str> {
        self.notes.get(path).map(String::as_str)
    }

    /// Resolves a wikilink target to a vault path.
    pub fn resolve(&self, target: &str) -> Option<String> {
        let wanted = target.trim().to_lowercase();
        if wanted.is_empty() {
            return None;
        }
        let with_extension = format!("{wanted}.md");
        self.notes
            .keys()
            .filter(|path| {
                let path = path.to_lowercase();
                if wanted.contains('/') {
                    path == wanted || path == with_extension
                } else {
                    let name = path.rsplit('/').next().unwrap_or(&path);
                    name == wanted || name == with_extension
                }
            })
            .min_by(|left, right| left.len().cmp(&right.len()).then_with(|| left.cmp(right)))
            .cloned()
    }
}

impl WorkspaceBackend for InMemoryBackend {
    fn revision(&self) -> u64 {
        self.revision
    }

    fn list_paths(&self) -> Vec<String> {
        self.notes.keys().cloned().collect()
    }

    fn backlinks(&self, path: &str) -> Vec<BacklinkRow> {
        let mut rows = Vec::new();
        for (source, content) in &self.notes {
            if source == path {
                continue;
            }
            for (index, line) in content.lines().enumerate() {
                let links_here = wikilink_targets(line)
                    .into_iter()
                    .any(|target| self.resolve(target).as_deref() == Some(path));
                if links_here {
                    rows.push(BacklinkRow {
                        source: source.clone(),
                        line: index + 1,
                    });
                }
            }
        }
        rows
    }

    fn outgoing_links(&self, path: &str) -> Vec<LinkRow> {
        let Some(content) = self.notes.get(path) else {
            return Vec::new();
        };
        let mut seen = BTreeSet::new();
        let mut rows = Vec::new();
        for target in content.lines().flat_map(wikilink_targets) {
            if seen.insert(target.to_owned()) {
                rows.push(LinkRow {
                    target_label: target.to_owned(),
                    resolved: self.resolve(target),
                });
            }
        }
        rows
    }

    fn search(&self, query: &str, limit: usize) -> Vec<SearchRow> {
        let needle = query.trim().to_lowercase();
        if needle.is_empty() {
            return Vec::new();
        }
        let mut rows: Vec<SearchRow> = self
            .notes
            .iter()
            .filter_map(|(path, content)| search_note(path, content, &needle))
            .collect();
        rows.sort_by(|left, right| {
            let by_score = right.score.total_cmp(&left.score);
            by_score.then_with(|| compare_names(&left.path, &right.path))
        });
        rows.truncate(limit);
        rows
    }

    fn quick_switch(&self, query: &str, limit: usize) -> Vec<String> {
        let paths: Vec<&String> = self.notes.keys().collect();
        rank_strings(query, &paths, limit)
    }

    fn tags(&self) -> Vec<(String, usize)> {
        let mut counts: BTreeMap<String, usize> = BTreeMap::new();
        for content in self.notes.values() {
            for tag in note_tags(content) {
                *counts.entry(tag).or_default() += 1;
            }
        }
        counts.into_iter().collect()
    }

    fn notes_with_tag(&self, tag: &str) -> Vec<String> {
        let wanted = normalize_tag(tag);
        self.notes
            .iter()
            .filter(|(_, content)| note_tags(content).contains(&wanted))
            .map(|(path, _)| path.clone())
            .collect()
    }
}

fn search_note(path: &str, content: &str, needle: &str) -> Option<SearchRow> {
    let path_hit = path.to_lowercase().contains(needle);
    let mut hits = 0_usize;
    let mut preview = None;
    for line in content.lines() {
        let count = line.to_lowercase().matches(needle).count();
        if count > 0 && preview.is_none() {
            preview = Some(line.trim().chars().take(PREVIEW_CHARS).collect::<String>());
        }
        hits += count;
    }
    if hits == 0 && !path_hit {
        return None;
    }
    let hits = u16::try_from(hits).unwrap_or(u16::MAX);
    let score = f32::from(hits) + if path_hit { 10.0 } else { 0.0 };
    Some(SearchRow {
        path: path.to_owned(),
        score,
        preview: preview.unwrap_or_default(),
    })
}

/// Wikilink targets on one line, without alias, heading or block suffixes.
fn wikilink_targets(line: &str) -> Vec<&str> {
    let mut targets = Vec::new();
    let mut rest = line;
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else {
            break;
        };
        let inner = &after[..end];
        let target = inner.split(['|', '#', '^']).next().unwrap_or(inner).trim();
        if !target.is_empty() {
            targets.push(target);
        }
        rest = &after[end + 2..];
    }
    targets
}

fn is_tag_char(character: char) -> bool {
    character.is_alphanumeric() || matches!(character, '_' | '-' | '/')
}

fn normalize_tag(tag: &str) -> String {
    tag.trim().trim_start_matches('#').to_lowercase()
}

fn note_tags(content: &str) -> BTreeSet<String> {
    let mut tags = BTreeSet::new();
    for word in content.split_whitespace() {
        let Some(rest) = word.strip_prefix('#') else {
            continue;
        };
        let tag: String = rest.chars().take_while(|c| is_tag_char(*c)).collect();
        if !tag.is_empty() && !tag.chars().all(|c| c.is_ascii_digit()) {
            tags.insert(tag.to_lowercase());
        }
    }
    tags
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> InMemoryBackend {
        InMemoryBackend::new()
            .with_note(
                "Home.md",
                "# Home\nSee [[Projects/Alpha]] and [[Ideas|my ideas]].\n#index",
            )
            .with_note(
                "Projects/Alpha.md",
                "Alpha links [[Home]]\n#project #status/active",
            )
            .with_note(
                "Ideas.md",
                "Back to [[home#Top]] and [[Missing note]]\n#project #123",
            )
            .with_note("Archive/Ideas.md", "Old ideas, unrelated.")
    }

    #[test]
    fn resolves_by_shortest_path_and_case_insensitively() {
        let backend = vault();
        assert_eq!(backend.resolve("home").as_deref(), Some("Home.md"));
        assert_eq!(backend.resolve("Ideas").as_deref(), Some("Ideas.md"));
        assert_eq!(
            backend.resolve("archive/ideas").as_deref(),
            Some("Archive/Ideas.md")
        );
        assert_eq!(backend.resolve("Nope"), None);
        assert_eq!(backend.resolve("  "), None);
    }

    #[test]
    fn backlinks_report_source_and_line() {
        let backend = vault();
        assert_eq!(
            backend.backlinks("Home.md"),
            [
                BacklinkRow {
                    source: "Ideas.md".to_owned(),
                    line: 1,
                },
                BacklinkRow {
                    source: "Projects/Alpha.md".to_owned(),
                    line: 1,
                },
            ]
        );
        assert!(backend.backlinks("Archive/Ideas.md").is_empty());
    }

    #[test]
    fn outgoing_links_keep_document_order_and_mark_unresolved() {
        let backend = vault();
        let links = backend.outgoing_links("Ideas.md");
        assert_eq!(
            links,
            [
                LinkRow {
                    target_label: "home".to_owned(),
                    resolved: Some("Home.md".to_owned()),
                },
                LinkRow {
                    target_label: "Missing note".to_owned(),
                    resolved: None,
                },
            ]
        );
        assert!(backend.outgoing_links("Unknown.md").is_empty());
    }

    #[test]
    fn tags_count_notes_and_ignore_headings_and_numbers() {
        let backend = vault();
        assert_eq!(
            backend.tags(),
            [
                ("index".to_owned(), 1),
                ("project".to_owned(), 2),
                ("status/active".to_owned(), 1),
            ]
        );
        assert_eq!(
            backend.notes_with_tag("#Project"),
            ["Ideas.md", "Projects/Alpha.md"]
        );
    }

    #[test]
    fn search_ranks_path_hits_and_builds_previews() {
        let backend = vault();
        let rows = backend.search("ideas", 10);
        let paths: Vec<&str> = rows.iter().map(|row| row.path.as_str()).collect();
        assert_eq!(paths, ["Archive/Ideas.md", "Ideas.md", "Home.md"]);
        assert_eq!(
            rows[2].preview,
            "See [[Projects/Alpha]] and [[Ideas|my ideas]]."
        );
        assert!(backend.search("   ", 10).is_empty());
        assert_eq!(backend.search("ideas", 1).len(), 1);
    }

    #[test]
    fn quick_switch_and_revision_track_changes() {
        let mut backend = vault();
        let revision = backend.revision();
        assert_eq!(backend.quick_switch("alpha", 5), ["Projects/Alpha.md"]);
        backend.insert_note("alpha-notes.md", "");
        assert!(backend.revision() > revision);
        assert_eq!(
            backend.quick_switch("alpha", 5),
            ["alpha-notes.md", "Projects/Alpha.md"]
        );
        assert!(backend.remove_note("alpha-notes.md").is_some());
        assert!(backend.remove_note("alpha-notes.md").is_none());
        assert_eq!(backend.list_paths().len(), 4);
    }
}
