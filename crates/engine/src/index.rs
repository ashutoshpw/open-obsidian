//! In-memory derived vault index: links, backlinks, tags, headings, graph, and search.
//!
//! The index is a pure projection of vault paths and Markdown bytes. It performs no I/O,
//! never mutates vault files, and can be rebuilt at any time. All query results are sorted so
//! repeated builds over the same input produce identical output.

use openobsidian_doc::{LinkKind, LinkReference, MarkdownSource};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::path::Path;

/// Maximum links retained per note; further links are dropped and the note is reported truncated.
pub const MAX_LINKS_PER_NOTE: usize = 10_000;
/// Maximum distinct inline tags retained per note.
pub const MAX_TAGS_PER_NOTE: usize = 10_000;
/// Maximum headings retained per note.
pub const MAX_HEADINGS_PER_NOTE: usize = 10_000;
/// Number of characters of note text returned as a search preview.
pub const SEARCH_PREVIEW_CHARS: usize = 160;

/// Path-level outcome of resolving one link against the vault's files.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum IndexedLinkResolution {
    /// Exactly one vault file matched.
    Resolved(String),
    /// No vault file matched.
    Unresolved,
    /// More than one vault file matched, so the link is not counted as a backlink.
    Ambiguous,
    /// The target uses a URI scheme and points outside the vault.
    External,
}

/// One link-like reference found in a note.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IndexedLink {
    pub kind: LinkKind,
    pub target: String,
    pub alias: Option<String>,
    pub subpath: Option<String>,
    /// One-based line of the first byte of the link.
    pub line: usize,
    pub resolution: IndexedLinkResolution,
}

/// One ATX heading found outside fenced code.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IndexedHeading {
    /// Heading level from 1 (`#`) to 6 (`######`).
    pub level: u8,
    pub text: String,
    /// One-based source line.
    pub line: usize,
}

/// Derived facts about one Markdown note.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NoteRecord {
    pub path: String,
    pub links: Vec<IndexedLink>,
    /// Distinct inline tags without the leading `#`, sorted.
    pub tags: Vec<String>,
    pub headings: Vec<IndexedHeading>,
}

/// A resolved link that points at a note or attachment.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Backlink {
    pub source: String,
    pub line: usize,
    pub kind: LinkKind,
}

/// Node category in the vault graph.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum GraphNodeKind {
    File,
    Attachment,
    Unresolved,
}

/// One graph node. Unresolved nodes use the id `?<target>`.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct GraphNode {
    pub id: String,
    pub kind: GraphNodeKind,
}

/// Edge category in the vault graph.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum GraphEdgeKind {
    Link,
    Embed,
}

/// A directed edge from a note to a file or unresolved node.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub kind: GraphEdgeKind,
}

/// Nodes sorted by id and edges sorted by `(source, target, kind)` without duplicates.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Graph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

/// One full-text or path search result.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SearchHit {
    pub path: String,
    pub score: usize,
    /// First characters of the note text; empty for files without indexed text.
    pub preview: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct SearchText {
    lowercase: String,
    preview: String,
}

/// In-memory index over a vault's files and Markdown notes.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct VaultIndex {
    /// Notes that were not valid UTF-8 and were therefore not indexed, sorted.
    pub skipped: Vec<String>,
    /// Notes whose links, tags, or headings hit a per-note cap, sorted.
    pub truncated_notes: Vec<String>,
    files: Vec<String>,
    notes: BTreeMap<String, NoteRecord>,
    search_text: BTreeMap<String, SearchText>,
}

impl VaultIndex {
    /// Builds an index from every regular vault file path and the Markdown notes' bytes.
    ///
    /// Paths are slash-separated and vault-relative. Notes that are not valid UTF-8 are listed
    /// in [`VaultIndex::skipped`] and otherwise ignored.
    pub fn build(
        all_paths: Vec<String>,
        notes: impl IntoIterator<Item = (String, Vec<u8>)>,
    ) -> VaultIndex {
        let resolver = LinkResolver::new(&all_paths);
        let mut files: BTreeSet<String> = all_paths.into_iter().collect();
        let mut index = VaultIndex::default();
        for (path, bytes) in notes {
            let Ok(source) = MarkdownSource::parse(bytes) else {
                index.skipped.push(path);
                continue;
            };
            files.insert(path.clone());
            let (record, search_text, truncated) = index_note(&path, &source, &resolver);
            if truncated {
                index.truncated_notes.push(path.clone());
            }
            index.search_text.insert(path.clone(), search_text);
            index.notes.insert(path, record);
        }
        index.skipped.sort();
        index.skipped.dedup();
        index.truncated_notes.sort();
        index.truncated_notes.dedup();
        index.files = files.into_iter().collect();
        index
    }

    /// Returns the record for one indexed note.
    pub fn note(&self, path: &str) -> Option<&NoteRecord> {
        self.notes.get(path)
    }

    /// Returns every indexed note sorted by path.
    pub fn notes(&self) -> Vec<&NoteRecord> {
        self.notes.values().collect()
    }

    /// Returns links whose single resolved target is `path`, sorted by source and line.
    ///
    /// Ambiguous, external, and unresolved links never count.
    pub fn backlinks(&self, path: &str) -> Vec<Backlink> {
        let mut backlinks = Vec::new();
        for note in self.notes.values() {
            for link in &note.links {
                if let IndexedLinkResolution::Resolved(target) = &link.resolution
                    && target == path
                {
                    backlinks.push(Backlink {
                        source: note.path.clone(),
                        line: link.line,
                        kind: link.kind,
                    });
                }
            }
        }
        backlinks.sort_by_key(|backlink| (backlink.source.clone(), backlink.line));
        backlinks
    }

    /// Returns the links of one note in source order.
    pub fn outgoing_links(&self, path: &str) -> &[IndexedLink] {
        self.notes
            .get(path)
            .map(|note| note.links.as_slice())
            .unwrap_or_default()
    }

    /// Returns the number of notes carrying each tag.
    pub fn tag_counts(&self) -> BTreeMap<String, usize> {
        let mut counts = BTreeMap::new();
        for note in self.notes.values() {
            for tag in &note.tags {
                *counts.entry(tag.clone()).or_insert(0) += 1;
            }
        }
        counts
    }

    /// Returns the sorted paths of notes carrying `tag` (a leading `#` is ignored).
    pub fn notes_with_tag(&self, tag: &str) -> Vec<String> {
        let tag = tag.strip_prefix('#').unwrap_or(tag);
        self.notes
            .values()
            .filter(|note| note.tags.iter().any(|candidate| candidate == tag))
            .map(|note| note.path.clone())
            .collect()
    }

    /// Builds the whole-vault graph.
    ///
    /// Every file is a node. Each distinct unresolved, ambiguous, or external link target also
    /// becomes an `?<target>` node so dangling references stay visible.
    pub fn graph(&self) -> Graph {
        let mut nodes: BTreeMap<String, GraphNodeKind> = BTreeMap::new();
        for path in &self.files {
            let kind = if is_markdown_path(path) {
                GraphNodeKind::File
            } else {
                GraphNodeKind::Attachment
            };
            nodes.insert(path.clone(), kind);
        }
        let mut edges = BTreeSet::new();
        for note in self.notes.values() {
            for link in &note.links {
                let target = match &link.resolution {
                    IndexedLinkResolution::Resolved(path) => path.clone(),
                    _ => {
                        let id = format!("?{}", link.target);
                        nodes.insert(id.clone(), GraphNodeKind::Unresolved);
                        id
                    }
                };
                let kind = if link.kind == LinkKind::Embed {
                    GraphEdgeKind::Embed
                } else {
                    GraphEdgeKind::Link
                };
                edges.insert(GraphEdge {
                    source: note.path.clone(),
                    target,
                    kind,
                });
            }
        }
        Graph {
            nodes: nodes
                .into_iter()
                .map(|(id, kind)| GraphNode { id, kind })
                .collect(),
            edges: edges.into_iter().collect(),
        }
    }

    /// Returns the subgraph within `depth` undirected hops of `path`.
    ///
    /// An unknown `path` yields an empty graph; depth zero yields only the node itself.
    pub fn local_graph(&self, path: &str, depth: usize) -> Graph {
        let full = self.graph();
        if !full.nodes.iter().any(|node| node.id == path) {
            return Graph::default();
        }
        let mut adjacency: HashMap<&str, Vec<&str>> = HashMap::new();
        for edge in &full.edges {
            let source = edge.source.as_str();
            let target = edge.target.as_str();
            adjacency.entry(source).or_default().push(target);
            adjacency.entry(target).or_default().push(source);
        }
        let mut visited: HashSet<&str> = HashSet::new();
        let mut queue: VecDeque<(&str, usize)> = VecDeque::new();
        visited.insert(path);
        queue.push_back((path, 0));
        while let Some((current, distance)) = queue.pop_front() {
            if distance >= depth {
                continue;
            }
            for neighbor in adjacency.get(current).into_iter().flatten().copied() {
                if visited.insert(neighbor) {
                    queue.push_back((neighbor, distance + 1));
                }
            }
        }
        let nodes = full
            .nodes
            .iter()
            .filter(|node| visited.contains(node.id.as_str()))
            .cloned()
            .collect();
        let edges = full
            .edges
            .iter()
            .filter(|edge| {
                visited.contains(edge.source.as_str()) && visited.contains(edge.target.as_str())
            })
            .cloned()
            .collect();
        Graph { nodes, edges }
    }

    /// Searches note text and file paths for a case-insensitive substring.
    ///
    /// A note scores the number of non-overlapping text matches plus one when its path also
    /// matches. Files without indexed text match on path only with score one. Results sort by
    /// score descending, then path.
    pub fn search(&self, query: &str, limit: usize) -> Vec<SearchHit> {
        let query = query.trim().to_lowercase();
        if query.is_empty() {
            return Vec::new();
        }
        let mut hits = Vec::new();
        for path in &self.files {
            let path_bonus = usize::from(path.to_lowercase().contains(&query));
            let (score, preview) = match self.search_text.get(path) {
                Some(text) => {
                    let matches = text.lowercase.matches(query.as_str()).count();
                    (matches + path_bonus, text.preview.clone())
                }
                None => (path_bonus, String::new()),
            };
            if score > 0 {
                hits.push(SearchHit {
                    path: path.clone(),
                    score,
                    preview,
                });
            }
        }
        hits.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then_with(|| left.path.cmp(&right.path))
        });
        hits.truncate(limit);
        hits
    }

    /// Returns Markdown note paths for a quick-switcher query.
    ///
    /// An empty query lists the first `limit` notes by path. Otherwise basename matches come
    /// first, then other path matches, then notes that match only by content.
    pub fn quick_switcher(&self, query: &str, limit: usize) -> Vec<String> {
        let query = query.trim().to_lowercase();
        if query.is_empty() {
            return self
                .files
                .iter()
                .filter(|path| is_markdown_path(path))
                .take(limit)
                .cloned()
                .collect();
        }
        let mut tiers: [Vec<String>; 3] = [Vec::new(), Vec::new(), Vec::new()];
        for hit in self.search(&query, usize::MAX) {
            if !is_markdown_path(&hit.path) {
                continue;
            }
            let lowercase = hit.path.to_lowercase();
            let basename = lowercase.rsplit('/').next().unwrap_or(&lowercase);
            let tier = if basename.contains(&query) {
                0
            } else if lowercase.contains(&query) {
                1
            } else {
                2
            };
            if let Some(bucket) = tiers.get_mut(tier) {
                bucket.push(hit.path);
            }
        }
        tiers.into_iter().flatten().take(limit).collect()
    }
}

/// Converts a vault-relative path into the slash-separated form used by the index.
pub(crate) fn slash_path(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn is_markdown_path(path: &str) -> bool {
    path.ends_with(".md")
}

fn index_note(
    path: &str,
    source: &MarkdownSource,
    resolver: &LinkResolver,
) -> (NoteRecord, SearchText, bool) {
    let text = source.text();
    let starts = line_starts(text);

    let references = source.extract_links();
    let mut truncated = references.len() > MAX_LINKS_PER_NOTE;
    let links = references
        .iter()
        .take(MAX_LINKS_PER_NOTE)
        .map(|reference| IndexedLink {
            kind: reference.kind,
            target: reference.target.clone(),
            alias: reference.alias.clone(),
            subpath: reference.subpath.clone(),
            line: line_of(&starts, reference.source_span.start),
            resolution: resolver.resolve(reference, path),
        })
        .collect();

    let scan = scan_lines(source, &starts);
    truncated |= scan.truncated;

    let record = NoteRecord {
        path: path.to_owned(),
        links,
        tags: scan.tags.into_iter().collect(),
        headings: scan.headings,
    };
    let search_text = SearchText {
        lowercase: text.to_lowercase(),
        preview: text.chars().take(SEARCH_PREVIEW_CHARS).collect(),
    };
    (record, search_text, truncated)
}

fn line_starts(text: &str) -> Vec<usize> {
    let mut starts = vec![0];
    for (offset, byte) in text.bytes().enumerate() {
        if byte == b'\n' {
            starts.push(offset + 1);
        }
    }
    starts
}

fn line_of(starts: &[usize], offset: usize) -> usize {
    starts.partition_point(|start| *start <= offset)
}

struct LineScan {
    headings: Vec<IndexedHeading>,
    tags: BTreeSet<String>,
    truncated: bool,
}

/// Collects ATX headings and inline tags, skipping frontmatter and fenced code.
fn scan_lines(source: &MarkdownSource, starts: &[usize]) -> LineScan {
    let bounds = source.frontmatter_bounds();
    let body_start = bounds.map_or(0, |bounds| bounds.closing_delimiter.end);
    let mut scan = LineScan {
        headings: Vec::new(),
        tags: BTreeSet::new(),
        truncated: false,
    };
    let mut fence: Option<(char, usize)> = None;
    for (index, raw_line) in source.text().split('\n').enumerate() {
        let offset = starts.get(index).copied().unwrap_or(0);
        if offset < body_start {
            continue;
        }
        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        if let Some((marker, length)) = fence {
            if is_closing_fence(line, marker, length) {
                fence = None;
            }
            continue;
        }
        if let Some(opening) = opening_fence(line) {
            fence = Some(opening);
            continue;
        }
        if let Some((level, text)) = atx_heading(line) {
            if scan.headings.len() < MAX_HEADINGS_PER_NOTE {
                scan.headings.push(IndexedHeading {
                    level,
                    text: text.to_owned(),
                    line: index + 1,
                });
            } else {
                scan.truncated = true;
            }
        }
        collect_line_tags(line, &mut scan.tags, &mut scan.truncated);
    }
    scan
}

/// Splits off up to three spaces of indentation, as CommonMark allows for fences and headings.
fn strip_block_indent(line: &str) -> Option<&str> {
    let trimmed = line.trim_start_matches(' ');
    (line.len() - trimmed.len() <= 3).then_some(trimmed)
}

fn opening_fence(line: &str) -> Option<(char, usize)> {
    let trimmed = strip_block_indent(line)?;
    let marker = trimmed.chars().next()?;
    if marker != '`' && marker != '~' {
        return None;
    }
    let length = trimmed.chars().take_while(|c| *c == marker).count();
    if length < 3 {
        return None;
    }
    let info = trimmed.get(length..)?;
    if marker == '`' && info.contains('`') {
        return None;
    }
    Some((marker, length))
}

fn is_closing_fence(line: &str, marker: char, minimum_length: usize) -> bool {
    let Some(trimmed) = strip_block_indent(line) else {
        return false;
    };
    let length = trimmed.chars().take_while(|c| *c == marker).count();
    let rest = trimmed.get(length..).unwrap_or("");
    length >= minimum_length && rest.trim().is_empty()
}

fn atx_heading(line: &str) -> Option<(u8, &str)> {
    let trimmed = strip_block_indent(line)?;
    let level = trimmed.bytes().take_while(|byte| *byte == b'#').count();
    if !(1..=6).contains(&level) {
        return None;
    }
    let rest = trimmed.get(level..)?;
    if !rest.starts_with([' ', '\t']) {
        return None;
    }
    let content = rest.trim();
    let without_closing = content.trim_end_matches('#');
    let text = if without_closing.is_empty() || without_closing.ends_with([' ', '\t']) {
        without_closing.trim_end()
    } else {
        content
    };
    if text.is_empty() {
        return None;
    }
    Some((u8::try_from(level).ok()?, text))
}

fn is_tag_char(character: char) -> bool {
    character.is_alphanumeric() || matches!(character, '_' | '-' | '/')
}

/// Collects `#tag` words that start a line or follow whitespace, outside inline code spans.
/// Purely numeric words such as `#123` are not tags.
fn collect_line_tags(line: &str, tags: &mut BTreeSet<String>, truncated: &mut bool) {
    let mut in_code = false;
    let mut previous: Option<char> = None;
    for (position, character) in line.char_indices() {
        if character == '`' {
            in_code = !in_code;
        } else if !in_code && character == '#' && previous.is_none_or(char::is_whitespace) {
            let rest = line.get(position + 1..).unwrap_or("");
            let tag: String = rest.chars().take_while(|c| is_tag_char(*c)).collect();
            if tag.chars().any(|c| !c.is_ascii_digit()) {
                if tags.len() >= MAX_TAGS_PER_NOTE && !tags.contains(&tag) {
                    *truncated = true;
                } else {
                    tags.insert(tag);
                }
            }
        }
        previous = Some(character);
    }
}

/// Resolves links with the same matching rules as `openobsidian_doc::resolve_link`, using
/// precomputed lookups so building an index does not scan every file for every link.
struct LinkResolver {
    paths: HashSet<String>,
    by_basename: HashMap<String, Vec<String>>,
}

impl LinkResolver {
    fn new(all_paths: &[String]) -> Self {
        let paths: HashSet<String> = all_paths.iter().cloned().collect();
        let mut by_basename: HashMap<String, Vec<String>> = HashMap::new();
        for path in &paths {
            by_basename
                .entry(basename_without_extension(path).to_owned())
                .or_default()
                .push(path.clone());
        }
        Self { paths, by_basename }
    }

    fn resolve(&self, reference: &LinkReference, current_path: &str) -> IndexedLinkResolution {
        if has_uri_scheme(&reference.target) {
            return IndexedLinkResolution::External;
        }
        let normalized = normalize_target(&reference.target);
        let mut matches: BTreeSet<&str> = BTreeSet::new();
        for candidate in candidate_paths(&reference.target, current_path) {
            if let Some(path) = self.paths.get(&candidate) {
                matches.insert(path.as_str());
            }
        }
        if !normalized.contains('/')
            && let Some(paths) = self.by_basename.get(&normalized)
        {
            matches.extend(paths.iter().map(String::as_str));
        }
        let mut iter = matches.into_iter();
        match (iter.next(), iter.next()) {
            (None, _) => IndexedLinkResolution::Unresolved,
            (Some(only), None) => IndexedLinkResolution::Resolved(only.to_owned()),
            (Some(_), Some(_)) => IndexedLinkResolution::Ambiguous,
        }
    }
}

fn candidate_paths(target: &str, current_path: &str) -> Vec<String> {
    let normalized = normalize_target(target);
    if normalized.is_empty() {
        let current = normalize_target(current_path);
        return if current.is_empty() {
            Vec::new()
        } else {
            vec![current]
        };
    }
    if normalized.starts_with('#') || has_uri_scheme(&normalized) {
        return Vec::new();
    }

    let current = normalize_target(current_path);
    let directory = current.rsplit_once('/').map_or("", |(parent, _)| parent);
    let relative_target = if !directory.is_empty() && !normalized.contains('/') {
        format!("{directory}/{normalized}")
    } else {
        normalized
    };
    let mut candidates = vec![relative_target.clone()];
    if !relative_target.ends_with(".md") {
        candidates.push(format!("{relative_target}.md"));
    }
    candidates
}

fn basename_without_extension(path: &str) -> &str {
    let basename = path.rsplit('/').next().unwrap_or(path);
    basename.strip_suffix(".md").unwrap_or(basename)
}

fn normalize_target(target: &str) -> String {
    let decoded = percent_decode(target).unwrap_or_else(|| target.to_owned());
    let normalized = decoded.replace('\\', "/");
    normalized
        .strip_prefix("./")
        .unwrap_or(&normalized)
        .to_owned()
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while let Some(byte) = bytes.get(index).copied() {
        if byte == b'%' {
            let high = hex_value(*bytes.get(index + 1)?)?;
            let low = hex_value(*bytes.get(index + 2)?)?;
            decoded.push((high << 4) | low);
            index += 3;
        } else {
            decoded.push(byte);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn has_uri_scheme(value: &str) -> bool {
    let Some((scheme, _)) = value.split_once(':') else {
        return false;
    };
    let mut characters = scheme.chars();
    characters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic())
        && characters.all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '+' | '.' | '-')
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build(paths: &[&str], notes: &[(&str, &str)]) -> VaultIndex {
        let paths = paths.iter().map(|path| (*path).to_owned()).collect();
        let notes = notes
            .iter()
            .map(|(path, text)| ((*path).to_owned(), text.as_bytes().to_vec()));
        VaultIndex::build(paths, notes)
    }

    fn ids(graph: &Graph) -> Vec<&str> {
        graph.nodes.iter().map(|node| node.id.as_str()).collect()
    }

    #[test]
    fn backlinks_are_sorted_by_source_then_line() {
        let paths = ["a.md", "b.md", "target.md"];
        let notes = [
            ("b.md", "[[target]]\n"),
            ("a.md", "intro\n\n[[target]]\n[[target]]\n"),
            ("target.md", "body"),
        ];
        let index = build(&paths, &notes);
        let backlinks = index.backlinks("target.md");
        let summary: Vec<(&str, usize)> = backlinks
            .iter()
            .map(|backlink| (backlink.source.as_str(), backlink.line))
            .collect();
        assert_eq!(summary, vec![("a.md", 3), ("a.md", 4), ("b.md", 1)]);
        assert_eq!(backlinks[0].kind, LinkKind::WikiLink);
    }

    #[test]
    fn ambiguous_basenames_are_not_backlinks() {
        let paths = ["a.md", "one/x.md", "two/x.md"];
        let index = build(&paths, &[("a.md", "[[x]]")]);
        let links = index.outgoing_links("a.md");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].resolution, IndexedLinkResolution::Ambiguous);
        assert!(index.backlinks("one/x.md").is_empty());
        assert!(index.backlinks("two/x.md").is_empty());
        assert!(ids(&index.graph()).contains(&"?x"));
    }

    #[test]
    fn unresolved_and_external_targets_become_question_nodes() {
        let text = "[[missing]] and [site](https://example.com/x)";
        let index = build(&["a.md"], &[("a.md", text)]);
        let links = index.outgoing_links("a.md");
        assert_eq!(links[0].resolution, IndexedLinkResolution::Unresolved);
        assert_eq!(links[1].resolution, IndexedLinkResolution::External);
        let graph = index.graph();
        let expected = vec!["?https://example.com/x", "?missing", "a.md"];
        assert_eq!(ids(&graph), expected);
        assert_eq!(graph.nodes[1].kind, GraphNodeKind::Unresolved);
        let targets: Vec<&str> = graph.edges.iter().map(|e| e.target.as_str()).collect();
        assert_eq!(targets, vec!["?https://example.com/x", "?missing"]);
    }

    #[test]
    fn embeds_create_embed_edges_to_attachments() {
        let paths = ["a.md", "img/pic.png"];
        let index = build(&paths, &[("a.md", "![[pic.png]]\n[[a]]\n")]);
        let graph = index.graph();
        let expected = vec![
            GraphEdge {
                source: "a.md".to_owned(),
                target: "a.md".to_owned(),
                kind: GraphEdgeKind::Link,
            },
            GraphEdge {
                source: "a.md".to_owned(),
                target: "img/pic.png".to_owned(),
                kind: GraphEdgeKind::Embed,
            },
        ];
        assert_eq!(graph.edges, expected);
        let attachment = graph.nodes.iter().find(|node| node.id == "img/pic.png");
        let kind = attachment.map(|node| node.kind);
        assert_eq!(kind, Some(GraphNodeKind::Attachment));
    }

    #[test]
    fn duplicate_links_produce_one_edge() {
        let notes = [("a.md", "[[b]] [[b]]"), ("b.md", "")];
        let index = build(&["a.md", "b.md"], &notes);
        assert_eq!(index.graph().edges.len(), 1);
    }

    #[test]
    fn headings_skip_fenced_code_and_frontmatter() {
        let text = "---\n# yaml comment\n---\n# One\n```\n# not a heading\n```\n## Two ##\n\
                    ~~~\n### hidden\n~~~\n####### seven\n#nospace\n### Three\n";
        let index = build(&["n.md"], &[("n.md", text)]);
        let headings = &index.note("n.md").unwrap().headings;
        let summary: Vec<(u8, &str, usize)> = headings
            .iter()
            .map(|heading| (heading.level, heading.text.as_str(), heading.line))
            .collect();
        let expected = vec![(1, "One", 4), (2, "Two", 8), (3, "Three", 14)];
        assert_eq!(summary, expected);
    }

    #[test]
    fn tags_are_deduped_counted_and_skip_code() {
        let first = "# Title\n#alpha #alpha text #beta/sub `#code` #123\n```\n#fenced\n```\n";
        let notes = [("a.md", first), ("b.md", "#alpha mid#word\n")];
        let index = build(&["a.md", "b.md"], &notes);
        let tags = &index.note("a.md").unwrap().tags;
        assert_eq!(tags, &["alpha", "beta/sub"]);
        let counts = index.tag_counts();
        assert_eq!(counts.get("alpha"), Some(&2));
        assert_eq!(counts.get("beta/sub"), Some(&1));
        assert_eq!(counts.len(), 2);
        assert_eq!(index.notes_with_tag("#alpha"), vec!["a.md", "b.md"]);
        assert_eq!(index.notes_with_tag("beta/sub"), vec!["a.md"]);
        assert!(index.notes_with_tag("none").is_empty());
    }

    #[test]
    fn search_scores_text_and_path_matches() {
        let paths = ["a.md", "b/rust.md", "c.md", "rust.png", "d.md"];
        let notes = [
            ("a.md", "rust and RUST"),
            ("b/rust.md", "nothing"),
            ("c.md", "Rust"),
            ("d.md", "other"),
        ];
        let index = build(&paths, &notes);
        let hits = index.search("  Rust ", 10);
        let summary: Vec<(&str, usize)> = hits
            .iter()
            .map(|hit| (hit.path.as_str(), hit.score))
            .collect();
        let expected = vec![("a.md", 2), ("b/rust.md", 1), ("c.md", 1), ("rust.png", 1)];
        assert_eq!(summary, expected);
        assert_eq!(hits[0].preview, "rust and RUST");
        assert_eq!(hits[3].preview, "");
        assert_eq!(index.search("rust", 2).len(), 2);
        assert!(index.search("   ", 10).is_empty());
    }

    #[test]
    fn search_preview_is_limited_to_160_chars() {
        let text = "é".repeat(300);
        let index = build(&["a.md"], &[("a.md", text.as_str())]);
        let hits = index.search("é", 1);
        assert_eq!(hits[0].preview.chars().count(), SEARCH_PREVIEW_CHARS);
        assert_eq!(hits[0].score, 300);
    }

    #[test]
    fn quick_switcher_orders_basename_then_path_then_content() {
        let paths = ["notes/alpha.md", "alps/zeta.md", "gamma.md", "alp.png"];
        let notes = [
            ("notes/alpha.md", "x"),
            ("alps/zeta.md", "x"),
            ("gamma.md", "mentions alp here"),
        ];
        let index = build(&paths, &notes);
        let expected = vec!["notes/alpha.md", "alps/zeta.md", "gamma.md"];
        assert_eq!(index.quick_switcher("ALP", 10), expected);
        assert_eq!(index.quick_switcher("alp", 1), vec!["notes/alpha.md"]);
        assert_eq!(index.quick_switcher("", 2), vec!["alps/zeta.md", "gamma.md"]);
    }

    #[test]
    fn local_graph_respects_depth_and_direction() {
        let notes = [
            ("a.md", "[[b]]"),
            ("b.md", "[[c]]"),
            ("c.md", "[[d]]"),
            ("d.md", ""),
        ];
        let index = build(&["a.md", "b.md", "c.md", "d.md"], &notes);
        assert_eq!(ids(&index.local_graph("b.md", 0)), vec!["b.md"]);
        let one = index.local_graph("b.md", 1);
        assert_eq!(ids(&one), vec!["a.md", "b.md", "c.md"]);
        assert_eq!(one.edges.len(), 2);
        let two = index.local_graph("a.md", 2);
        assert_eq!(ids(&two), vec!["a.md", "b.md", "c.md"]);
        assert!(index.local_graph("missing.md", 3).nodes.is_empty());
    }

    #[test]
    fn non_utf8_notes_are_skipped() {
        let paths = vec!["bad.md".to_owned(), "ok.md".to_owned()];
        let notes = vec![
            ("bad.md".to_owned(), vec![0xff, 0xfe, 0x41]),
            ("ok.md".to_owned(), b"# Fine".to_vec()),
        ];
        let index = VaultIndex::build(paths, notes);
        assert_eq!(index.skipped, vec!["bad.md"]);
        assert!(index.note("bad.md").is_none());
        assert_eq!(index.notes().len(), 1);
        assert!(ids(&index.graph()).contains(&"bad.md"));
    }

    #[test]
    fn relative_and_percent_encoded_targets_resolve() {
        let paths = ["dir/a.md", "dir/my note.md", "root.md"];
        let text = "[x](my%20note.md) [[root]] [[./my note]]";
        let index = build(&paths, &[("dir/a.md", text)]);
        let links = index.outgoing_links("dir/a.md");
        let note = IndexedLinkResolution::Resolved("dir/my note.md".to_owned());
        let root = IndexedLinkResolution::Resolved("root.md".to_owned());
        assert_eq!(links[0].resolution, note);
        assert_eq!(links[1].resolution, root);
        assert_eq!(links[2].resolution, note);
    }
}
