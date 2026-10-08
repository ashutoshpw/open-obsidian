//! Lossless document values shared by the vault engine and native UI.

use std::collections::HashMap;

/// Original document bytes remain authoritative until an explicit transform is approved.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RawDocument {
    bytes: Vec<u8>,
}

impl RawDocument {
    pub fn from_bytes(bytes: Vec<u8>) -> Self {
        Self { bytes }
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.bytes
    }
}

/// Line-ending style observed in a Markdown source without normalizing its bytes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LineEnding {
    CrLf,
    Lf,
    Cr,
    Mixed,
    None,
}

/// A half-open byte range into a document's original UTF-8 source.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SourceSpan {
    pub start: usize,
    pub end: usize,
}

/// Source boundaries for a YAML frontmatter block.
///
/// Delimiter spans exclude their line endings. The content span includes any
/// line ending immediately before the closing delimiter, matching its position
/// in the original source.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FrontmatterBounds {
    pub opening_delimiter: SourceSpan,
    pub content: SourceSpan,
    pub closing_delimiter: SourceSpan,
}

/// Source locations for a simple top-level frontmatter mapping entry.
///
/// The value span excludes whitespace around the value and any trailing YAML
/// comment. The original source remains authoritative; this type does not
/// interpret the value or modify the document.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarkdownPropertySource {
    pub key: String,
    pub key_span: SourceSpan,
    pub value_span: SourceSpan,
}

/// The source syntax used by an extracted Markdown reference.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LinkKind {
    WikiLink,
    Markdown,
    Embed,
}

/// A link-like reference with byte ranges into the original Markdown source.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LinkReference {
    pub kind: LinkKind,
    pub raw: String,
    pub target: String,
    pub alias: Option<String>,
    pub subpath: Option<String>,
    pub source_span: SourceSpan,
    pub target_span: SourceSpan,
}

/// The path-level resolution outcome for a Markdown link reference.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LinkResolutionStatus {
    Resolved,
    Unresolved,
    Ambiguous,
    External,
}

/// Candidate files for a link, keeping unresolved and ambiguous cases explicit.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LinkResolution {
    pub status: LinkResolutionStatus,
    pub target: Option<String>,
    pub candidates: Vec<String>,
}

/// Maximum number of nested Markdown note transclusions rendered below the source note.
pub const MAX_NOTE_TRANSCLUSION_DEPTH: usize = 3;

/// Maximum decoded Markdown source size permitted for an inline transclusion.
pub const MAX_NOTE_TRANSCLUSION_SOURCE_BYTES: usize = 512 * 1024;

/// A source slice selected by a Markdown heading or block identifier.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LinkSubpathStatus {
    Resolved,
    Unresolved,
    Ambiguous,
}

/// Read-only content and zero-based line bounds for a validated link subpath.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LinkSubpathSlice {
    pub status: LinkSubpathStatus,
    pub text: Option<String>,
    pub line_start: Option<usize>,
    pub line_end: Option<usize>,
}

/// Reason a note transclusion was rejected before reading or rendering its source.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TransclusionBlockReason {
    Depth,
    Cycle,
}

/// Updated depth and path chain for a permitted nested note transclusion.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransclusionGuard {
    pub next_depth: usize,
    pub chain: Vec<String>,
}

/// Action proposed for a link that points at a note being renamed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LinkRenameAction {
    Update,
    SkipAmbiguous,
    SkipUnresolved,
}

/// A UTF-8 Markdown note included in a read-only link rename plan.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenamePlanFile {
    pub relative_path: String,
    pub source: MarkdownSource,
}

/// A source-ranged link decision in a rename preview.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LinkRenameEdit {
    pub source_path: String,
    pub kind: LinkKind,
    pub raw: String,
    pub target: String,
    pub source_span: SourceSpan,
    pub target_span: SourceSpan,
    pub resolution: LinkResolutionStatus,
    pub action: LinkRenameAction,
    pub replacement: Option<String>,
}

/// A pure rename preview. It does not modify any note or vault path.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LinkRenamePlan {
    pub old_path: String,
    pub new_path: String,
    pub edits: Vec<LinkRenameEdit>,
    pub update_count: usize,
    pub skipped_count: usize,
    pub warnings: Vec<String>,
}

/// An invalid or stale input to a pure rename preview operation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LinkRenamePlanError {
    EmptyPath,
    SamePath,
    StaleSource,
}

impl std::fmt::Display for LinkRenamePlanError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyPath => formatter.write_str("Rename plan paths must not be empty"),
            Self::SamePath => {
                formatter.write_str("Rename plan requires distinct source and destination paths")
            }
            Self::StaleSource => {
                formatter.write_str("Rename preview source does not match its recorded byte spans")
            }
        }
    }
}

impl std::error::Error for LinkRenamePlanError {}

/// A validated UTF-8 Markdown view backed by the original bytes.
///
/// The text accessor includes a UTF-8 BOM when the source has one. This type does
/// not parse properties or rewrite text; callers must keep the original bytes as
/// the authority until a separately approved source-span edit is applied.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarkdownSource {
    raw: RawDocument,
    has_bom: bool,
    line_ending: LineEnding,
}

impl MarkdownSource {
    /// Parse Markdown source as UTF-8 while retaining its exact bytes.
    pub fn parse(bytes: Vec<u8>) -> Result<Self, std::str::Utf8Error> {
        let raw = RawDocument::from_bytes(bytes);
        let text = std::str::from_utf8(raw.as_bytes())?;
        let has_bom = raw.as_bytes().starts_with(&[0xef, 0xbb, 0xbf]);
        let line_ending = detect_line_ending(text);
        Ok(Self {
            raw,
            has_bom,
            line_ending,
        })
    }

    /// Return decoded source text, including U+FEFF when the source begins with a BOM.
    pub fn text(&self) -> &str {
        // Construction validates these immutable bytes as UTF-8.
        std::str::from_utf8(self.raw.as_bytes()).expect("MarkdownSource stores validated UTF-8")
    }

    pub fn as_bytes(&self) -> &[u8] {
        self.raw.as_bytes()
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.raw.into_bytes()
    }

    pub fn has_bom(&self) -> bool {
        self.has_bom
    }

    pub fn line_ending(&self) -> LineEnding {
        self.line_ending
    }

    /// Find a complete YAML frontmatter block without interpreting its contents.
    ///
    /// Returned offsets are byte offsets into `as_bytes()`. A leading UTF-8 BOM
    /// is part of the source and shifts the opening delimiter's byte offset.
    pub fn frontmatter_bounds(&self) -> Option<FrontmatterBounds> {
        let bytes = self.raw.as_bytes();
        let opening_start: usize = if self.has_bom { 3 } else { 0 };
        let opening_end = opening_start.checked_add(3)?;
        if bytes.get(opening_start..opening_end)? != &b"---"[..] {
            return None;
        }

        let (opening_line_end, opening_break_width) = line_bounds(bytes, opening_end);
        if opening_line_end != opening_end || opening_break_width == 0 {
            return None;
        }

        let content_start = opening_end + opening_break_width;
        let mut line_start = content_start;
        while line_start <= bytes.len() {
            let (line_end, break_width) = line_bounds(bytes, line_start);
            if is_closing_delimiter(&bytes[line_start..line_end]) {
                return Some(FrontmatterBounds {
                    opening_delimiter: SourceSpan {
                        start: opening_start,
                        end: opening_end,
                    },
                    content: SourceSpan {
                        start: content_start,
                        end: line_start,
                    },
                    closing_delimiter: SourceSpan {
                        start: line_start,
                        end: line_end,
                    },
                });
            }
            if break_width == 0 {
                return None;
            }
            line_start = line_end + break_width;
        }
        None
    }

    /// Return source spans for simple, unindented frontmatter mapping entries.
    ///
    /// This is a structural view only: it does not parse YAML values, nested
    /// mappings or sequences. Unsupported keys and indented child entries are
    /// omitted, while every source byte remains unchanged.
    pub fn frontmatter_properties(&self) -> Vec<MarkdownPropertySource> {
        let Some(bounds) = self.frontmatter_bounds() else {
            return Vec::new();
        };
        frontmatter_properties(self.raw.as_bytes(), bounds.content)
    }

    /// Extract supported wiki, Markdown and embed references outside Markdown code spans.
    ///
    /// Returned ranges are UTF-8 byte offsets. Fenced code blocks and matched inline
    /// code spans are ignored. This structural pass does not resolve targets or edit
    /// references.
    pub fn extract_links(&self) -> Vec<LinkReference> {
        extract_links(self.raw.as_bytes())
    }
}

fn frontmatter_properties(bytes: &[u8], content: SourceSpan) -> Vec<MarkdownPropertySource> {
    let mut properties = Vec::new();
    let mut line_start = content.start;

    while line_start < content.end {
        let (line_end, break_width) = line_bounds(bytes, line_start);
        let line_end = line_end.min(content.end);
        if let Some(property) = source_property(&bytes[line_start..line_end], line_start) {
            properties.push(property);
        }
        if break_width == 0 {
            break;
        }
        line_start = line_end + break_width;
    }

    properties
}

fn source_property(line: &[u8], line_start: usize) -> Option<MarkdownPropertySource> {
    let mut key_end = 0;
    while line
        .get(key_end)
        .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(*byte, b'_' | b'-'))
    {
        key_end += 1;
    }
    if key_end == 0 {
        return None;
    }

    let mut colon = key_end;
    while line
        .get(colon)
        .is_some_and(|byte| matches!(*byte, b' ' | b'\t'))
    {
        colon += 1;
    }
    if line.get(colon) != Some(&b':') {
        return None;
    }

    let key = std::str::from_utf8(&line[..key_end]).ok()?.to_owned();
    let mut value_start = colon + 1;
    while line
        .get(value_start)
        .is_some_and(|byte| matches!(*byte, b' ' | b'\t'))
    {
        value_start += 1;
    }

    let value = &line[value_start..];
    let value_end = yaml_inline_comment_start(value).unwrap_or(value.len());
    let mut value_end = value_start + value_end;
    while value_end > value_start && matches!(line[value_end - 1], b' ' | b'\t') {
        value_end -= 1;
    }

    Some(MarkdownPropertySource {
        key,
        key_span: SourceSpan {
            start: line_start,
            end: line_start + key_end,
        },
        value_span: SourceSpan {
            start: line_start + value_start,
            end: line_start + value_end,
        },
    })
}

fn extract_links(bytes: &[u8]) -> Vec<LinkReference> {
    let code_ranges = code_context_ranges(bytes);
    let mut references = Vec::new();
    let mut cursor = 0;
    let mut code_range_index = 0;

    while cursor < bytes.len() {
        while code_ranges
            .get(code_range_index)
            .is_some_and(|range| range.end <= cursor)
        {
            code_range_index += 1;
        }

        if let Some(range) = code_ranges.get(code_range_index)
            && range.start <= cursor
        {
            cursor = range.end;
            continue;
        }

        let reference = wiki_link_at(bytes, cursor).or_else(|| markdown_link_at(bytes, cursor));
        if let Some(reference) = reference {
            let intersects_code = code_ranges.get(code_range_index).is_some_and(|range| {
                reference.source_span.start < range.end && range.start < reference.source_span.end
            });
            if intersects_code {
                cursor += 1;
            } else {
                cursor = reference.source_span.end;
                references.push(reference);
            }
        } else {
            cursor += 1;
        }
    }

    references
}

fn code_context_ranges(bytes: &[u8]) -> Vec<SourceSpan> {
    let fenced_ranges = fenced_code_ranges(bytes);
    let mut ranges = fenced_ranges.clone();
    ranges.extend(inline_code_ranges(bytes, &fenced_ranges));
    ranges.sort_by_key(|range| range.start);

    let mut merged: Vec<SourceSpan> = Vec::with_capacity(ranges.len());
    for range in ranges {
        if let Some(previous) = merged.last_mut()
            && range.start <= previous.end
        {
            previous.end = previous.end.max(range.end);
            continue;
        }
        merged.push(range);
    }
    merged
}

fn fenced_code_ranges(bytes: &[u8]) -> Vec<SourceSpan> {
    let mut ranges = Vec::new();
    let mut open_fence: Option<(u8, usize, usize)> = None;
    let mut line_start = 0;

    while line_start < bytes.len() {
        let (line_end, break_width) = line_bounds(bytes, line_start);
        let line = &bytes[line_start..line_end];
        let range_end = line_end + break_width;

        if let Some((marker, minimum_length, range_start)) = open_fence {
            if is_closing_fence(line, marker, minimum_length) {
                ranges.push(SourceSpan {
                    start: range_start,
                    end: range_end,
                });
                open_fence = None;
            }
        } else if let Some((marker, run_length)) = opening_fence(line) {
            open_fence = Some((marker, run_length, line_start));
        }

        if break_width == 0 {
            break;
        }
        line_start = range_end;
    }

    if let Some((_, _, range_start)) = open_fence {
        ranges.push(SourceSpan {
            start: range_start,
            end: bytes.len(),
        });
    }

    ranges
}

fn opening_fence(line: &[u8]) -> Option<(u8, usize)> {
    let line = line.strip_prefix(b"\xef\xbb\xbf").unwrap_or(line);
    let indentation = line.iter().take_while(|byte| **byte == b' ').count();
    if indentation > 3 {
        return None;
    }

    let marker = *line.get(indentation)?;
    if !matches!(marker, b'`' | b'~') {
        return None;
    }

    let run_length = line[indentation..]
        .iter()
        .take_while(|byte| **byte == marker)
        .count();
    if run_length < 3 {
        return None;
    }

    if marker == b'`' && line[indentation + run_length..].contains(&b'`') {
        return None;
    }

    Some((marker, run_length))
}

fn is_closing_fence(line: &[u8], marker: u8, minimum_length: usize) -> bool {
    let indentation = line.iter().take_while(|byte| **byte == b' ').count();
    if indentation > 3 || line.get(indentation) != Some(&marker) {
        return false;
    }

    let run_length = line[indentation..]
        .iter()
        .take_while(|byte| **byte == marker)
        .count();
    run_length >= minimum_length
        && line[indentation + run_length..]
            .iter()
            .all(|byte| matches!(*byte, b' ' | b'\t'))
}

fn inline_code_ranges(bytes: &[u8], fenced_ranges: &[SourceSpan]) -> Vec<SourceSpan> {
    let mut ranges = Vec::new();
    let mut fence_index = 0;
    let mut cursor = 0;

    while cursor < bytes.len() {
        while fenced_ranges
            .get(fence_index)
            .is_some_and(|range| range.end <= cursor)
        {
            fence_index += 1;
        }

        if let Some(range) = fenced_ranges.get(fence_index)
            && range.start <= cursor
        {
            cursor = range.end;
            continue;
        }

        if bytes[cursor] != b'`' || is_escaped_backtick(bytes, cursor) {
            cursor += 1;
            continue;
        }

        let run_end = backtick_run_end(bytes, cursor);
        let run_length = run_end - cursor;
        if let Some(span_end) = matching_backtick_end(bytes, run_end, run_length, fenced_ranges) {
            ranges.push(SourceSpan {
                start: cursor,
                end: span_end,
            });
            cursor = span_end;
        } else {
            // An unmatched delimiter is literal text and cannot hide later links.
            cursor = run_end;
        }
    }

    ranges
}

fn matching_backtick_end(
    bytes: &[u8],
    start: usize,
    delimiter_length: usize,
    fenced_ranges: &[SourceSpan],
) -> Option<usize> {
    let fence_index = fenced_ranges.partition_point(|range| range.end <= start);
    let mut cursor = start;

    while cursor < bytes.len() {
        if let Some(range) = fenced_ranges.get(fence_index)
            && range.start <= cursor
        {
            return None;
        }

        if bytes[cursor] == b'`' {
            let run_end = backtick_run_end(bytes, cursor);
            if run_end - cursor == delimiter_length {
                return Some(run_end);
            }
            cursor = run_end;
        } else {
            cursor += 1;
        }
    }

    None
}

fn backtick_run_end(bytes: &[u8], start: usize) -> usize {
    start
        + bytes[start..]
            .iter()
            .take_while(|byte| **byte == b'`')
            .count()
}

fn is_escaped_backtick(bytes: &[u8], start: usize) -> bool {
    let mut preceding_backslashes = 0;
    let mut cursor = start;
    while cursor > 0 && bytes[cursor - 1] == b'\\' {
        preceding_backslashes += 1;
        cursor -= 1;
    }
    preceding_backslashes % 2 == 1
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SourceSubpathKind {
    Heading { level: u8 },
    Block,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct SourceSubpathEntry {
    key: String,
    line: usize,
    kind: SourceSubpathKind,
}

fn source_subpath_keys(source: &MarkdownSource) -> Vec<String> {
    source_subpath_entries(source)
        .into_iter()
        .map(|entry| entry.key)
        .collect()
}

fn source_subpath_entries(source: &MarkdownSource) -> Vec<SourceSubpathEntry> {
    let bytes = source.as_bytes();
    let fenced_ranges = fenced_code_ranges(bytes);
    let mut entries = Vec::new();
    let mut fence_index = 0;
    let mut line_start = 0;
    let mut line_number = 0;

    while line_start < bytes.len() {
        while fenced_ranges
            .get(fence_index)
            .is_some_and(|range| range.end <= line_start)
        {
            fence_index += 1;
        }

        let (line_end, break_width) = line_bounds(bytes, line_start);
        if let Some(range) = fenced_ranges.get(fence_index)
            && range.start <= line_start
        {
            line_start = line_end + break_width;
            line_number += 1;
            continue;
        }

        let line_bytes = &bytes[line_start..line_end];
        let line_bytes = if line_start == 0 {
            line_bytes
                .strip_prefix(b"\xef\xbb\xbf")
                .unwrap_or(line_bytes)
        } else {
            line_bytes
        };
        let line = std::str::from_utf8(line_bytes)
            .expect("MarkdownSource stores validated UTF-8")
            .trim_end_matches([' ', '\t']);

        let next_line_start = line_end + break_width;
        let next_line = if break_width > 0 && next_line_start < bytes.len() {
            let (next_line_end, _) = line_bounds(bytes, next_line_start);
            std::str::from_utf8(&bytes[next_line_start..next_line_end])
                .expect("MarkdownSource stores validated UTF-8")
                .trim_end_matches([' ', '\t'])
        } else {
            ""
        };

        entries.extend(source_line_subpath_entries(line, next_line, line_number));
        if break_width == 0 {
            break;
        }
        line_start = next_line_start;
        line_number += 1;
    }

    entries
}

fn source_line_subpath_entries(
    line: &str,
    next_line: &str,
    line_number: usize,
) -> Vec<SourceSubpathEntry> {
    let mut entries = Vec::new();
    let heading = atx_heading(line)
        .map(|(heading, level)| (heading_text(heading), level))
        .or_else(|| setext_heading_level(line, next_line).map(|level| (heading_text(line), level)));
    if let Some((text, level)) = heading {
        entries.push(SourceSubpathEntry {
            key: normalized_heading(text),
            line: line_number,
            kind: SourceSubpathKind::Heading { level },
        });
    }

    if let Some(id) = block_id(line) {
        entries.push(SourceSubpathEntry {
            key: format!("^{id}"),
            line: line_number,
            kind: SourceSubpathKind::Block,
        });
    }
    entries
}

fn atx_heading(line: &str) -> Option<(&str, u8)> {
    let indentation = line.bytes().take_while(|byte| *byte == b' ').count();
    if indentation > 3 {
        return None;
    }

    let bytes = line.as_bytes();
    let marker_length = bytes[indentation..]
        .iter()
        .take_while(|byte| **byte == b'#')
        .count();
    if !(1..=6).contains(&marker_length) {
        return None;
    }

    let content_start = indentation + marker_length;
    if !bytes
        .get(content_start)
        .is_some_and(|byte| matches!(*byte, b' ' | b'\t'))
    {
        return None;
    }
    let content_start = content_start
        + bytes[content_start..]
            .iter()
            .take_while(|byte| matches!(**byte, b' ' | b'\t'))
            .count();

    Some((&line[content_start..], marker_length as u8))
}

fn setext_heading_level(line: &str, underline: &str) -> Option<u8> {
    if line.trim().is_empty() || is_list_item_start(line) {
        return None;
    }

    let indentation = underline.bytes().take_while(|byte| *byte == b' ').count();
    if indentation > 3 {
        return None;
    }
    let bytes = underline.as_bytes();
    let marker = *bytes.get(indentation)?;
    if !matches!(marker, b'=' | b'-') {
        return None;
    }
    let marker_length = bytes[indentation..]
        .iter()
        .take_while(|byte| **byte == marker)
        .count();
    if marker_length == 0
        || !bytes[indentation + marker_length..]
            .iter()
            .all(|byte| matches!(*byte, b' ' | b'\t'))
    {
        return None;
    }

    Some(if marker == b'=' { 1 } else { 2 })
}

fn is_list_item_start(line: &str) -> bool {
    let indentation = line.bytes().take_while(|byte| *byte == b' ').count();
    if indentation > 3 {
        return false;
    }
    let bytes = line.as_bytes();
    let rest = &bytes[indentation..];

    if rest
        .first()
        .is_some_and(|byte| matches!(*byte, b'-' | b'+' | b'*'))
    {
        return rest
            .get(1)
            .is_some_and(|byte| matches!(*byte, b' ' | b'\t'));
    }

    let digits = rest.iter().take_while(|byte| byte.is_ascii_digit()).count();
    digits > 0
        && rest
            .get(digits)
            .is_some_and(|byte| matches!(*byte, b'.' | b')'))
        && rest
            .get(digits + 1)
            .is_some_and(|byte| matches!(*byte, b' ' | b'\t'))
}

fn block_id(line: &str) -> Option<&str> {
    let line = line.trim_end_matches([' ', '\t']);
    let id_start = line.rfind([' ', '\t']).map_or(0, |separator| separator + 1);
    let marker = line.get(id_start..)?.strip_prefix('^')?;
    let mut characters = marker.chars();
    let first = characters.next()?;
    if !first.is_ascii_alphanumeric()
        || !characters
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    {
        return None;
    }
    Some(marker)
}

fn heading_text(value: &str) -> &str {
    let value = strip_trailing_heading_hashes(value.trim_end_matches([' ', '\t']));
    strip_trailing_block_id(value).trim()
}

fn strip_trailing_block_id(value: &str) -> &str {
    let value = value.trim_end_matches([' ', '\t']);
    let Some(separator) = value.rfind([' ', '\t']) else {
        return value;
    };
    let marker = &value[separator + 1..];
    let Some(id) = marker.strip_prefix('^') else {
        return value;
    };
    let mut characters = id.chars();
    if !characters
        .next()
        .is_some_and(|character| character.is_ascii_alphanumeric())
        || !characters
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    {
        return value;
    }
    value[..separator].trim_end_matches([' ', '\t'])
}

fn strip_trailing_heading_hashes(value: &str) -> &str {
    let hash_start = value.trim_end_matches('#').len();
    if hash_start == value.len()
        || !value[..hash_start]
            .chars()
            .next_back()
            .is_some_and(char::is_whitespace)
    {
        return value;
    }
    value[..hash_start].trim_end()
}

fn normalized_heading(value: &str) -> String {
    let decoded = percent_decode(value).unwrap_or_else(|| value.to_owned());
    strip_trailing_heading_hashes(decoded.trim())
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn subpath_match_count(source: &MarkdownSource, requested: &str) -> usize {
    let requested = requested.trim();
    if requested.is_empty() {
        return 0;
    }
    let key = if requested.starts_with('^') {
        requested.to_owned()
    } else {
        normalized_heading(requested)
    };
    source_subpath_keys(source)
        .iter()
        .filter(|subpath| subpath.as_str() == key.as_str())
        .count()
}

/// Select a validated heading or block slice without editing the Markdown source.
///
/// Fenced code is ignored using the same identity parser as link resolution.
/// Selected heading and block slices normalize line endings to LF, matching the
/// preview-facing source selection contract. An empty subpath returns the full
/// source unchanged; the original [`MarkdownSource`] always remains unchanged.
pub fn slice_markdown_subpath(
    source: &MarkdownSource,
    requested_subpath: &str,
) -> LinkSubpathSlice {
    let lines = source_lines(source.text());
    let requested = requested_subpath.trim();
    if requested.is_empty() {
        return LinkSubpathSlice {
            status: LinkSubpathStatus::Resolved,
            text: Some(source.text().to_owned()),
            line_start: Some(0),
            line_end: Some(lines.len()),
        };
    }

    let key = if requested.starts_with('^') {
        requested.to_owned()
    } else {
        normalized_heading(requested)
    };
    let entries = source_subpath_entries(source);
    let mut matches = entries.iter().filter(|entry| entry.key == key);
    let Some(selected) = matches.next() else {
        return unresolved_subpath_slice();
    };
    if matches.next().is_some() {
        return LinkSubpathSlice {
            status: LinkSubpathStatus::Ambiguous,
            text: None,
            line_start: None,
            line_end: None,
        };
    }

    let line_start = selected.line;
    let line_end = match selected.kind {
        SourceSubpathKind::Heading { level } => entries
            .iter()
            .filter_map(|entry| match entry.kind {
                SourceSubpathKind::Heading {
                    level: candidate_level,
                } if entry.line > line_start && candidate_level <= level => Some(entry.line),
                _ => None,
            })
            .min()
            .unwrap_or(lines.len()),
        SourceSubpathKind::Block => (line_start + 1).min(lines.len()),
    };
    let mut selected_lines = lines[line_start..line_end]
        .iter()
        .map(|line| (*line).to_owned())
        .collect::<Vec<_>>();
    if selected.kind == SourceSubpathKind::Block {
        if let Some(line) = selected_lines.first_mut() {
            *line = strip_trailing_block_identifier(line);
        }
    }

    LinkSubpathSlice {
        status: LinkSubpathStatus::Resolved,
        text: Some(selected_lines.join("\n")),
        line_start: Some(line_start),
        line_end: Some(line_end),
    }
}

/// Check the decoded byte length before a Markdown note is rendered inline.
pub fn note_transclusion_source_within_limit(source_bytes: &[u8]) -> bool {
    source_bytes.len() <= MAX_NOTE_TRANSCLUSION_SOURCE_BYTES
}

/// Reject excessive nesting and cycles before reading or rendering a note embed.
pub fn guard_note_transclusion(
    depth: usize,
    chain: &[String],
    target: &str,
) -> Result<TransclusionGuard, TransclusionBlockReason> {
    if depth >= MAX_NOTE_TRANSCLUSION_DEPTH {
        return Err(TransclusionBlockReason::Depth);
    }
    if chain.iter().any(|path| path == target) {
        return Err(TransclusionBlockReason::Cycle);
    }
    let mut next_chain = chain.to_vec();
    next_chain.push(target.to_owned());
    Ok(TransclusionGuard {
        next_depth: depth + 1,
        chain: next_chain,
    })
}

fn unresolved_subpath_slice() -> LinkSubpathSlice {
    LinkSubpathSlice {
        status: LinkSubpathStatus::Unresolved,
        text: None,
        line_start: None,
        line_end: None,
    }
}

fn source_lines(source: &str) -> Vec<&str> {
    let bytes = source.as_bytes();
    let mut lines = Vec::new();
    let mut line_start = 0;
    loop {
        let (line_end, break_width) = line_bounds(bytes, line_start);
        lines.push(&source[line_start..line_end]);
        if break_width == 0 {
            break;
        }
        line_start = line_end + break_width;
        if line_start == bytes.len() {
            lines.push("");
            break;
        }
    }
    lines
}

fn strip_trailing_block_identifier(line: &str) -> String {
    let (bom, content) = line
        .strip_prefix('\u{feff}')
        .map_or(("", line), |content| ("\u{feff}", content));
    let content = content.trim_end_matches([' ', '\t']);
    let marker_start = content.rfind([' ', '\t']).map_or(0, |separator| separator + 1);
    let retained = content[..marker_start].trim_end_matches([' ', '\t']);
    format!("{bom}{retained}")
}

fn wiki_link_at(bytes: &[u8], start: usize) -> Option<LinkReference> {
    let (content_start, kind) = if bytes.get(start..start + 3) == Some(&b"![["[..]) {
        (start + 3, LinkKind::Embed)
    } else if bytes.get(start..start + 2) == Some(&b"[["[..]) {
        (start + 2, LinkKind::WikiLink)
    } else {
        return None;
    };

    let mut content_end = content_start;
    while let Some(byte) = bytes.get(content_end) {
        if *byte == b']' {
            if content_end == content_start || bytes.get(content_end + 1) != Some(&b']') {
                return None;
            }

            let raw_end = content_end + 2;
            return link_reference(
                bytes,
                kind,
                start,
                raw_end,
                content_start,
                &bytes[content_start..content_end],
            );
        }
        content_end += 1;
    }

    None
}

fn markdown_link_at(bytes: &[u8], start: usize) -> Option<LinkReference> {
    let (label_start, kind) = if bytes.get(start..start + 2) == Some(&b"!["[..]) {
        (start + 2, LinkKind::Embed)
    } else if bytes.get(start) == Some(&b'[') {
        (start + 1, LinkKind::Markdown)
    } else {
        return None;
    };

    let label_end = label_start
        + bytes
            .get(label_start..)?
            .iter()
            .position(|byte| *byte == b']')?;
    let target_open = label_end + 1;
    if bytes.get(target_open) != Some(&b'(') {
        return None;
    }

    let target_start = target_open + 1;
    let target_tail = std::str::from_utf8(bytes.get(target_start..)?).ok()?;
    let target_length = target_tail
        .char_indices()
        .find(|(_, character)| *character == ')' || character.is_whitespace())
        .map_or(target_tail.len(), |(offset, _)| offset);
    if target_length == 0 {
        return None;
    }

    let target_end = target_start + target_length;
    let close_paren = if bytes.get(target_end) == Some(&b')') {
        target_end
    } else {
        let whitespace_tail = std::str::from_utf8(bytes.get(target_end..)?).ok()?;
        let whitespace_length = whitespace_tail
            .char_indices()
            .take_while(|(_, character)| character.is_whitespace())
            .map(|(offset, character)| offset + character.len_utf8())
            .last()?;
        let title_start = target_end + whitespace_length;
        if bytes.get(title_start) != Some(&b'"') {
            return None;
        }
        let title_tail = std::str::from_utf8(bytes.get(title_start + 1..)?).ok()?;
        let title_end = title_start + 1 + title_tail.find('"')?;
        let close_paren = title_end + 1;
        if bytes.get(close_paren) != Some(&b')') {
            return None;
        }
        close_paren
    };

    link_reference(
        bytes,
        kind,
        start,
        close_paren + 1,
        target_start,
        &bytes[target_start..target_end],
    )
}

fn link_reference(
    bytes: &[u8],
    kind: LinkKind,
    source_start: usize,
    source_end: usize,
    target_start: usize,
    raw_target: &[u8],
) -> Option<LinkReference> {
    let raw = std::str::from_utf8(&bytes[source_start..source_end])
        .ok()?
        .to_owned();
    let raw_target = std::str::from_utf8(raw_target).ok()?;
    let (target, alias, subpath) = split_link_target(raw_target);
    let target_end = target_start + target.len();

    Some(LinkReference {
        kind,
        raw,
        target,
        alias,
        subpath,
        source_span: SourceSpan {
            start: source_start,
            end: source_end,
        },
        target_span: SourceSpan {
            start: target_start,
            end: target_end,
        },
    })
}

fn split_link_target(value: &str) -> (String, Option<String>, Option<String>) {
    let (without_alias, alias) = if let Some(separator) = value.find('|') {
        (&value[..separator], Some(value[separator + 1..].to_owned()))
    } else {
        (value, None)
    };
    let (target, subpath) = if let Some(separator) = without_alias.find('#') {
        (
            &without_alias[..separator],
            Some(without_alias[separator + 1..].to_owned()),
        )
    } else {
        (without_alias, None)
    };

    (target.to_owned(), alias, subpath)
}

/// Resolve a link against vault-relative paths without reading or changing source files.
///
/// This path-only form retains existing file-level behavior for references with
/// subpaths. Use [`resolve_link_with_sources`] to validate heading and block IDs.
pub fn resolve_link(
    reference: &LinkReference,
    files: &[String],
    current_path: &str,
) -> LinkResolution {
    resolve_link_inner(reference, files, current_path, None)
}

/// Resolve a link and validate a Markdown subpath against source-preserving notes.
///
/// The source map is read-only. Missing headings or block IDs remain unresolved;
/// duplicate identities remain ambiguous. Non-Markdown paths keep file-level
/// resolution behavior.
pub fn resolve_link_with_sources(
    reference: &LinkReference,
    files: &[String],
    current_path: &str,
    sources: &HashMap<String, MarkdownSource>,
) -> LinkResolution {
    resolve_link_inner(reference, files, current_path, Some(sources))
}

fn resolve_link_inner(
    reference: &LinkReference,
    files: &[String],
    current_path: &str,
    sources: Option<&HashMap<String, MarkdownSource>>,
) -> LinkResolution {
    if has_uri_scheme(&reference.target) {
        return LinkResolution {
            status: LinkResolutionStatus::External,
            target: None,
            candidates: Vec::new(),
        };
    }

    let normalized_target = normalize_target(&reference.target);
    let candidates = candidate_paths(&reference.target, current_path);
    let mut matches = Vec::new();
    for file in files {
        if file_matches_reference(file, &normalized_target, &candidates) {
            matches.push(file.clone());
        }
    }

    if matches.is_empty() {
        return LinkResolution {
            status: LinkResolutionStatus::Unresolved,
            target: None,
            candidates,
        };
    }

    if let Some(subpath) = reference.subpath.as_deref()
        && let Some(sources) = sources
    {
        return resolve_subpath(matches, subpath, sources);
    }

    match matches.len() {
        1 => LinkResolution {
            status: LinkResolutionStatus::Resolved,
            target: matches.first().cloned(),
            candidates: matches,
        },
        _ => {
            matches.sort();
            LinkResolution {
                status: LinkResolutionStatus::Ambiguous,
                target: None,
                candidates: matches,
            }
        }
    }
}

fn resolve_subpath(
    mut matches: Vec<String>,
    subpath: &str,
    sources: &HashMap<String, MarkdownSource>,
) -> LinkResolution {
    matches.sort();
    let mut valid_matches = Vec::new();
    let mut duplicate_subpath = false;

    for file in &matches {
        if !file.to_ascii_lowercase().ends_with(".md") {
            valid_matches.push(file.clone());
            continue;
        }

        let count = sources
            .get(file)
            .map_or(0, |source| subpath_match_count(source, subpath));
        if count > 1 {
            duplicate_subpath = true;
        } else if count == 1 {
            valid_matches.push(file.clone());
        }
    }

    if duplicate_subpath || valid_matches.len() > 1 {
        return LinkResolution {
            status: LinkResolutionStatus::Ambiguous,
            target: None,
            candidates: matches,
        };
    }

    match valid_matches.pop() {
        Some(target) => LinkResolution {
            status: LinkResolutionStatus::Resolved,
            target: Some(target.clone()),
            candidates: vec![target],
        },
        None => LinkResolution {
            status: LinkResolutionStatus::Unresolved,
            target: None,
            candidates: matches,
        },
    }
}

/// Build source-ranged link edits for a proposed note rename without writing files.
///
/// `files` must contain the Markdown source for every note participating in
/// resolution. Ambiguous and unresolved references that may point at
/// `old_path` are returned as skipped entries so callers can surface them.
/// Paths must already be validated vault-relative paths.
pub fn build_link_rename_plan(
    files: &[RenamePlanFile],
    old_path: &str,
    new_path: &str,
) -> Result<LinkRenamePlan, LinkRenamePlanError> {
    if old_path.is_empty() || new_path.is_empty() {
        return Err(LinkRenamePlanError::EmptyPath);
    }
    if old_path == new_path {
        return Err(LinkRenamePlanError::SamePath);
    }

    let file_paths: Vec<String> = files
        .iter()
        .map(|file| file.relative_path.clone())
        .collect();
    let sources: HashMap<String, MarkdownSource> = files
        .iter()
        .map(|file| (file.relative_path.clone(), file.source.clone()))
        .collect();
    let mut edits = Vec::new();

    for file in files {
        for reference in file.source.extract_links() {
            let resolution =
                resolve_link_with_sources(&reference, &file_paths, &file.relative_path, &sources);
            let Some(action) = link_rename_action(&reference, &resolution, old_path) else {
                continue;
            };
            let replacement = (action == LinkRenameAction::Update)
                .then(|| link_rename_replacement(&reference, &file.relative_path, new_path));
            edits.push(LinkRenameEdit {
                source_path: file.relative_path.clone(),
                kind: reference.kind,
                raw: reference.raw,
                target: reference.target,
                source_span: reference.source_span,
                target_span: reference.target_span,
                resolution: resolution.status,
                action,
                replacement,
            });
        }
    }

    let update_count = edits
        .iter()
        .filter(|edit| edit.action == LinkRenameAction::Update)
        .count();
    let skipped_count = edits.len() - update_count;
    let mut warnings = Vec::new();
    if edits
        .iter()
        .any(|edit| edit.action == LinkRenameAction::SkipAmbiguous)
    {
        warnings.push("Ambiguous links are shown but not rewritten.".to_owned());
    }
    if edits
        .iter()
        .any(|edit| edit.action == LinkRenameAction::SkipUnresolved)
    {
        warnings.push(
            "Unresolved links are shown but require explicit resolution before rewriting."
                .to_owned(),
        );
    }

    Ok(LinkRenamePlan {
        old_path: old_path.to_owned(),
        new_path: new_path.to_owned(),
        edits,
        update_count,
        skipped_count,
        warnings,
    })
}

/// Render the proposed target replacements in memory, preserving every byte
/// outside the planned target spans. This does not write to a vault or disk.
pub fn render_link_rename_preview(
    source: &MarkdownSource,
    source_path: &str,
    plan: &LinkRenamePlan,
) -> Result<Vec<u8>, LinkRenamePlanError> {
    let original = source.as_bytes();
    let mut updates: Vec<&LinkRenameEdit> = plan
        .edits
        .iter()
        .filter(|edit| edit.source_path == source_path && edit.action == LinkRenameAction::Update)
        .collect();
    updates.sort_by_key(|edit| std::cmp::Reverse(edit.target_span.start));

    let mut previous_start = None;
    let mut rendered = original.to_vec();
    for edit in updates {
        let source_span = edit.source_span;
        let target_span = edit.target_span;
        if source_span.start > target_span.start
            || target_span.start > target_span.end
            || target_span.end > source_span.end
            || source_span.end > original.len()
            || original.get(source_span.start..source_span.end) != Some(edit.raw.as_bytes())
            || original.get(target_span.start..target_span.end) != Some(edit.target.as_bytes())
            || previous_start
                .is_some_and(|start| target_span.end > start || target_span.start == start)
        {
            return Err(LinkRenamePlanError::StaleSource);
        }

        let replacement = edit
            .replacement
            .as_deref()
            .ok_or(LinkRenamePlanError::StaleSource)?;
        rendered.splice(
            target_span.start..target_span.end,
            replacement.as_bytes().iter().copied(),
        );
        previous_start = Some(target_span.start);
    }

    Ok(rendered)
}

fn link_rename_action(
    reference: &LinkReference,
    resolution: &LinkResolution,
    old_path: &str,
) -> Option<LinkRenameAction> {
    match resolution.status {
        LinkResolutionStatus::Resolved
            if resolution
                .target
                .as_deref()
                .is_some_and(|target| rename_target_matches(target, old_path)) =>
        {
            Some(LinkRenameAction::Update)
        }
        LinkResolutionStatus::Ambiguous
            if resolution
                .candidates
                .iter()
                .any(|candidate| rename_target_matches(candidate, old_path)) =>
        {
            Some(LinkRenameAction::SkipAmbiguous)
        }
        LinkResolutionStatus::Unresolved
            if rename_target_matches(&reference.target, old_path)
                || resolution
                    .candidates
                    .iter()
                    .any(|candidate| rename_target_matches(candidate, old_path)) =>
        {
            Some(LinkRenameAction::SkipUnresolved)
        }
        _ => None,
    }
}

fn rename_target_matches(target: &str, path: &str) -> bool {
    let normalized_target = normalize_target(target);
    let normalized_path = normalize_target(path);
    normalized_target == normalized_path
        || normalized_target == without_markdown_extension(&normalized_path)
}

fn without_markdown_extension(path: &str) -> &str {
    if path
        .get(path.len().saturating_sub(3)..)
        .is_some_and(|extension| extension.eq_ignore_ascii_case(".md"))
    {
        &path[..path.len() - 3]
    } else {
        path
    }
}

fn link_rename_replacement(reference: &LinkReference, source_path: &str, new_path: &str) -> String {
    if reference.kind == LinkKind::WikiLink
        || reference.kind == LinkKind::Embed && reference.raw.starts_with("![[")
    {
        return without_markdown_extension(new_path).to_owned();
    }

    let target = normalize_target(&reference.target);
    let candidate = if target.contains('/') {
        new_path.to_owned()
    } else {
        relative_rename_target(source_path, new_path)
    };
    if target.to_ascii_lowercase().ends_with(".md")
        || !new_path.to_ascii_lowercase().ends_with(".md")
    {
        candidate
    } else {
        without_markdown_extension(&candidate).to_owned()
    }
}

fn relative_rename_target(source_path: &str, new_path: &str) -> String {
    let mut source_segments: Vec<&str> = source_path.split('/').collect();
    source_segments.pop();
    let target_segments: Vec<&str> = new_path.split('/').collect();
    let mut common = 0;
    while common < source_segments.len()
        && common < target_segments.len()
        && source_segments[common] == target_segments[common]
    {
        common += 1;
    }

    let mut segments = vec![".."; source_segments.len() - common];
    segments.extend_from_slice(&target_segments[common..]);
    if segments.is_empty() {
        target_segments
            .last()
            .copied()
            .unwrap_or(new_path)
            .to_owned()
    } else {
        segments.join("/")
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

fn file_matches_reference(file: &str, normalized_target: &str, candidates: &[String]) -> bool {
    let normalized_file = normalize_target(file);
    if candidates
        .iter()
        .any(|candidate| candidate == &normalized_file)
    {
        return true;
    }

    !normalized_target.contains('/')
        && basename_without_extension(&normalized_file) == normalized_target
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
    let mut decoded = Vec::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = hex_value(*bytes.get(index + 1)?)?;
            let low = hex_value(*bytes.get(index + 2)?)?;
            decoded.push((high << 4) | low);
            index += 3;
        } else {
            let character = value.get(index..)?.chars().next()?;
            let mut encoded = [0; 4];
            decoded.extend_from_slice(character.encode_utf8(&mut encoded).as_bytes());
            index += character.len_utf8();
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

fn yaml_inline_comment_start(value: &[u8]) -> Option<usize> {
    let mut quote = None;
    let mut depth = 0usize;
    let mut index = 0;

    while index < value.len() {
        let byte = value[index];
        if let Some(active_quote) = quote {
            if active_quote == b'\'' && byte == active_quote && value.get(index + 1) == Some(&byte)
            {
                index += 2;
                continue;
            }
            if active_quote == b'"' && byte == b'\\' {
                index = (index + 2).min(value.len());
                continue;
            }
            if byte == active_quote {
                quote = None;
            }
        } else {
            match byte {
                b'\'' | b'"' => quote = Some(byte),
                b'[' | b'{' | b'(' => depth += 1,
                b']' | b'}' | b')' => depth = depth.saturating_sub(1),
                b'#' if depth == 0 && (index == 0 || matches!(value[index - 1], b' ' | b'\t')) => {
                    return Some(index);
                }
                _ => {}
            }
        }
        index += 1;
    }

    None
}

fn line_bounds(bytes: &[u8], start: usize) -> (usize, usize) {
    let mut end = start;
    while end < bytes.len() && !matches!(bytes[end], b'\r' | b'\n') {
        end += 1;
    }
    let break_width = match bytes.get(end) {
        Some(&b'\r') if bytes.get(end + 1) == Some(&b'\n') => 2,
        Some(&b'\r') | Some(&b'\n') => 1,
        _ => 0,
    };
    (end, break_width)
}

fn is_closing_delimiter(line: &[u8]) -> bool {
    let Some(rest) = line.strip_prefix(b"---") else {
        return false;
    };
    rest.iter().all(|byte| *byte == b' ' || *byte == b'\t')
}

fn detect_line_ending(text: &str) -> LineEnding {
    let bytes = text.as_bytes();
    let mut crlf = false;
    let mut lf = false;
    let mut cr = false;
    let mut index = 0;

    while index < bytes.len() {
        match bytes[index] {
            b'\r' if bytes.get(index + 1) == Some(&b'\n') => {
                crlf = true;
                index += 2;
            }
            b'\r' => {
                cr = true;
                index += 1;
            }
            b'\n' => {
                lf = true;
                index += 1;
            }
            _ => index += 1,
        }
    }

    match (crlf, lf, cr) {
        (false, false, false) => LineEnding::None,
        (true, false, false) => LineEnding::CrLf,
        (false, true, false) => LineEnding::Lf,
        (false, false, true) => LineEnding::Cr,
        _ => LineEnding::Mixed,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{
        FrontmatterBounds, LineEnding, LinkKind, LinkRenameAction, LinkRenamePlanError,
        LinkResolution, LinkResolutionStatus, LinkSubpathStatus, MarkdownSource, RawDocument,
        RenamePlanFile, SourceSpan, TransclusionBlockReason, TransclusionGuard,
        MAX_NOTE_TRANSCLUSION_DEPTH, MAX_NOTE_TRANSCLUSION_SOURCE_BYTES, build_link_rename_plan,
        guard_note_transclusion, note_transclusion_source_within_limit, render_link_rename_preview,
        resolve_link, resolve_link_with_sources, slice_markdown_subpath,
    };

    #[test]
    fn untouched_document_bytes_round_trip_exactly() {
        let bytes =
            b"\xef\xbb\xbf---\r\nunknown: [value, {nested: true}]\r\n---\r\ntext\r\n".to_vec();
        assert_eq!(RawDocument::from_bytes(bytes.clone()).into_bytes(), bytes);
    }

    #[test]
    fn markdown_source_preserves_bom_crlf_and_original_bytes() {
        let bytes =
            b"\xef\xbb\xbf---\r\nunknown: [value, {nested: true}]\r\n---\r\ntext\r\n".to_vec();
        let source = MarkdownSource::parse(bytes.clone()).unwrap();

        assert!(source.has_bom());
        assert_eq!(source.line_ending(), LineEnding::CrLf);
        assert!(source.text().starts_with('\u{feff}'));
        assert_eq!(source.as_bytes(), bytes);
        assert_eq!(source.into_bytes(), bytes);
    }

    #[test]
    fn markdown_source_reports_each_line_ending_style_without_normalizing() {
        let cases = [
            (b"lf\nsource".as_slice(), LineEnding::Lf),
            (b"crlf\r\nsource".as_slice(), LineEnding::CrLf),
            (b"cr\rsource".as_slice(), LineEnding::Cr),
            (b"mixed\r\nsource\n".as_slice(), LineEnding::Mixed),
            (b"single line".as_slice(), LineEnding::None),
        ];

        for (bytes, expected) in cases {
            let source = MarkdownSource::parse(bytes.to_vec()).unwrap();
            assert_eq!(source.line_ending(), expected);
            assert_eq!(source.as_bytes(), bytes);
        }
    }

    #[test]
    fn markdown_source_rejects_invalid_utf8_but_raw_documents_remain_byte_safe() {
        let bytes = vec![b'#', b' ', 0xff];

        assert!(MarkdownSource::parse(bytes.clone()).is_err());
        assert_eq!(RawDocument::from_bytes(bytes.clone()).as_bytes(), bytes);
    }

    #[test]
    fn frontmatter_bounds_use_byte_offsets_and_leave_delimiter_line_endings_out() {
        let bytes = "\u{feff}---\r\nstatus: 🐈\n--- \t\r\nbody"
            .as_bytes()
            .to_vec();
        let source = MarkdownSource::parse(bytes.clone()).unwrap();
        let bounds = source.frontmatter_bounds().unwrap();

        assert_eq!(
            bounds,
            FrontmatterBounds {
                opening_delimiter: SourceSpan { start: 3, end: 6 },
                content: SourceSpan { start: 8, end: 21 },
                closing_delimiter: SourceSpan { start: 21, end: 26 },
            }
        );
        assert_eq!(
            &bytes[bounds.opening_delimiter.start..bounds.opening_delimiter.end],
            b"---"
        );
        assert_eq!(
            &bytes[bounds.content.start..bounds.content.end],
            "status: 🐈\n".as_bytes()
        );
        assert_eq!(
            &bytes[bounds.closing_delimiter.start..bounds.closing_delimiter.end],
            b"--- \t"
        );
        assert_eq!(source.as_bytes(), bytes);
    }

    #[test]
    fn frontmatter_bounds_support_lf_crlf_and_cr_delimiters() {
        let cases = [
            (
                b"---\nkey: value\n---".as_slice(),
                b"key: value\n".as_slice(),
            ),
            (
                b"---\r\nkey: value\r\n---".as_slice(),
                b"key: value\r\n".as_slice(),
            ),
            (
                b"---\rkey: value\r---".as_slice(),
                b"key: value\r".as_slice(),
            ),
        ];

        for (bytes, expected_content) in cases {
            let source = MarkdownSource::parse(bytes.to_vec()).unwrap();
            let bounds = source.frontmatter_bounds().unwrap();
            assert_eq!(
                &source.as_bytes()[bounds.content.start..bounds.content.end],
                expected_content
            );
        }
    }

    #[test]
    fn frontmatter_bounds_fail_closed_for_absent_unclosed_or_near_match_delimiters() {
        for bytes in [
            b"body\n---\nkey: value\n---".as_slice(),
            b"---\nkey: value".as_slice(),
            b"---\nkey: value\n----".as_slice(),
        ] {
            let source = MarkdownSource::parse(bytes.to_vec()).unwrap();
            assert_eq!(source.frontmatter_bounds(), None);
        }
    }

    #[test]
    fn frontmatter_property_sources_preserve_byte_spans_and_ignore_nested_lines() {
        let bytes = "\u{feff}---\r\nstatus:\topen # keep\r\ntitle: \"🐈 # hash\" # note\r\nmetadata:\r\n  owner: hidden\r\nflow: [one#literal, {nested: \"two # hash\"}] # note\r\n# ignored\r\n---\r\nbody"
            .as_bytes()
            .to_vec();
        let source = MarkdownSource::parse(bytes.clone()).unwrap();
        let properties = source.frontmatter_properties();

        assert_eq!(
            properties
                .iter()
                .map(|property| property.key.as_str())
                .collect::<Vec<_>>(),
            vec!["status", "title", "metadata", "flow"]
        );
        assert_eq!(
            &bytes[properties[0].value_span.start..properties[0].value_span.end],
            b"open"
        );
        assert_eq!(
            &bytes[properties[1].value_span.start..properties[1].value_span.end],
            "\"🐈 # hash\"".as_bytes()
        );
        assert_eq!(properties[2].value_span.start, properties[2].value_span.end);
        assert_eq!(
            &bytes[properties[3].value_span.start..properties[3].value_span.end],
            b"[one#literal, {nested: \"two # hash\"}]"
        );
        assert_eq!(
            &bytes[properties[0].key_span.start..properties[0].key_span.end],
            b"status"
        );
        assert_eq!(source.as_bytes(), bytes);
    }

    #[test]
    fn frontmatter_property_sources_require_a_complete_frontmatter_block() {
        for bytes in [b"body\nkey: value\n---".as_slice(), b"---\nkey: value"] {
            let source = MarkdownSource::parse(bytes.to_vec()).unwrap();
            assert!(source.frontmatter_properties().is_empty());
        }
    }

    #[test]
    fn markdown_link_references_preserve_targets_aliases_subpaths_and_byte_spans() {
        let text = "\u{feff}🐈 [[Notes/Target#heading|alias]] ![[Images/photo.png]] [target](Notes/Target.md#heading) ![alt](Images/plot.svg \"title\")";
        let bytes = text.as_bytes().to_vec();
        let source = MarkdownSource::parse(bytes.clone()).unwrap();
        let links = source.extract_links();

        assert_eq!(
            links.iter().map(|link| link.kind).collect::<Vec<_>>(),
            vec![
                LinkKind::WikiLink,
                LinkKind::Embed,
                LinkKind::Markdown,
                LinkKind::Embed
            ]
        );
        assert_eq!(links[0].target, "Notes/Target");
        assert_eq!(links[0].alias.as_deref(), Some("alias"));
        assert_eq!(links[0].subpath.as_deref(), Some("heading"));
        assert_eq!(links[1].target, "Images/photo.png");
        assert_eq!(links[2].target, "Notes/Target.md");
        assert_eq!(links[2].subpath.as_deref(), Some("heading"));
        assert_eq!(links[3].target, "Images/plot.svg");

        for link in &links {
            assert_eq!(
                &bytes[link.source_span.start..link.source_span.end],
                link.raw.as_bytes()
            );
            assert_eq!(
                &bytes[link.target_span.start..link.target_span.end],
                link.target.as_bytes()
            );
        }
        assert_eq!(source.as_bytes(), bytes);
    }

    #[test]
    fn link_extraction_ignores_backtick_and_tilde_fenced_code_blocks() {
        let text = "\u{feff}🐈 [[Before]]\r\n```md [[FenceInfo]]\r\n[[FenceBody]] [label](fenced.md) ![[image.png]]\r\n~~~\r\n[[StillFenced]]\r\n````  \r\n~~~\r\n[[TildeBody]]\r\n~~~\t\r\n[[After]]";
        let bytes = text.as_bytes().to_vec();
        let source = MarkdownSource::parse(bytes.clone()).unwrap();
        let links = source.extract_links();

        assert_eq!(
            links
                .iter()
                .map(|link| link.target.as_str())
                .collect::<Vec<_>>(),
            vec!["Before", "After"]
        );
        for link in &links {
            assert_eq!(
                &bytes[link.source_span.start..link.source_span.end],
                link.raw.as_bytes()
            );
        }
        assert_eq!(source.as_bytes(), bytes);

        let bom_fence = MarkdownSource::parse(
            "\u{feff}```md\n[[HiddenByBomFence]]\n```\n[[Visible]]"
                .as_bytes()
                .to_vec(),
        )
        .unwrap();
        assert_eq!(
            bom_fence
                .extract_links()
                .iter()
                .map(|link| link.target.as_str())
                .collect::<Vec<_>>(),
            vec!["Visible"]
        );
    }

    #[test]
    fn link_extraction_ignores_matched_inline_code_and_leaves_unmatched_ticks_literal() {
        let text = r"[[before]] `[[single]]` ``[[double]] `literal` `` `unmatched [[still-visible]] [[after]]";
        let source = MarkdownSource::parse(text.as_bytes().to_vec()).unwrap();
        let links = source.extract_links();

        assert_eq!(
            links
                .iter()
                .map(|link| link.target.as_str())
                .collect::<Vec<_>>(),
            vec!["before", "still-visible", "after"]
        );

        let escaped = MarkdownSource::parse(r"\`[[escaped]]\`".as_bytes().to_vec()).unwrap();
        let escaped_links = escaped.extract_links();
        assert_eq!(escaped_links.len(), 1);
        assert_eq!(escaped_links[0].target, "escaped");
    }

    #[test]
    fn markdown_link_target_span_points_past_an_identical_visible_label() {
        let source = MarkdownSource::parse(b"[Same](Same)".to_vec()).unwrap();
        let links = source.extract_links();

        assert_eq!(links.len(), 1);
        assert_eq!(links[0].source_span, SourceSpan { start: 0, end: 12 });
        assert_eq!(links[0].target_span, SourceSpan { start: 7, end: 11 });
        assert_eq!(
            &source.as_bytes()[links[0].target_span.start..links[0].target_span.end],
            b"Same"
        );
    }

    #[test]
    fn link_resolution_reports_resolved_ambiguous_and_unresolved_paths() {
        let source = MarkdownSource::parse(b"[[Target]] [[Target]] [[Missing]]".to_vec()).unwrap();
        let links = source.extract_links();

        assert_eq!(
            resolve_link(&links[0], &["Target.md".to_owned()], "Index.md"),
            LinkResolution {
                status: LinkResolutionStatus::Resolved,
                target: Some("Target.md".to_owned()),
                candidates: vec!["Target.md".to_owned()],
            }
        );
        let ambiguous = resolve_link(
            &links[1],
            &["Target.md".to_owned(), "Target".to_owned()],
            "Index.md",
        );
        assert_eq!(ambiguous.status, LinkResolutionStatus::Ambiguous);
        assert_eq!(
            ambiguous.candidates,
            vec!["Target".to_owned(), "Target.md".to_owned()]
        );

        let unresolved = resolve_link(&links[2], &["Other.md".to_owned()], "Index.md");
        assert_eq!(unresolved.status, LinkResolutionStatus::Unresolved);
        assert_eq!(
            unresolved.candidates,
            vec!["Missing".to_owned(), "Missing.md".to_owned()]
        );
    }

    #[test]
    fn link_resolution_handles_current_note_relative_encoded_and_external_targets() {
        let source = MarkdownSource::parse(
            b"[[#Overview]] [[Notes\\Target%20File.md]] [[Target]] [web](https://example.test/note.md)"
                .to_vec(),
        )
        .unwrap();
        let links = source.extract_links();
        let files = vec![
            "Notes/Current.md".to_owned(),
            "Notes/Target File.md".to_owned(),
            "Notes/Target.md".to_owned(),
        ];

        let current = resolve_link(&links[0], &files, "Notes/Current.md");
        assert_eq!(current.status, LinkResolutionStatus::Resolved);
        assert_eq!(current.target.as_deref(), Some("Notes/Current.md"));

        let relative = resolve_link(&links[1], &files, "Index.md");
        assert_eq!(relative.status, LinkResolutionStatus::Resolved);
        assert_eq!(relative.target.as_deref(), Some("Notes/Target File.md"));

        let same_directory = resolve_link(&links[2], &files, "Notes/Current.md");
        assert_eq!(same_directory.status, LinkResolutionStatus::Resolved);
        assert_eq!(same_directory.target.as_deref(), Some("Notes/Target.md"));

        let external = resolve_link(&links[3], &files, "Index.md");
        assert_eq!(external.status, LinkResolutionStatus::External);
        assert!(external.candidates.is_empty());
    }

    #[test]
    fn source_aware_link_resolution_validates_heading_block_and_fenced_subpaths() {
        let reference_source = MarkdownSource::parse(
            b"[[Target#Overview]] [[Target#Welcome%20note]] [[Target#^intro]] [[Target#Missing]] [[Target#Duplicate]] [[Target#Hidden]] [[Target#TildeHidden]] [[Target#^fenced]]".to_vec(),
        )
        .unwrap();
        let links = reference_source.extract_links();
        let target_source = MarkdownSource::parse(
            "\u{feff}# Overview ###\r\n\r\nWelcome note\r\n===\r\n\r\nOpening paragraph ^intro\r\n\r\n## Duplicate\r\n## Duplicate\r\n\r\n```md\r\n# Hidden\r\nHidden paragraph ^fenced\r\n```\r\n~~~\r\n# TildeHidden\r\n~~~"
                .as_bytes()
                .to_vec(),
        )
        .unwrap();
        let mut sources = HashMap::new();
        sources.insert("Target.md".to_owned(), target_source);
        let files = vec!["Target.md".to_owned()];

        for index in [0, 1, 2] {
            assert_eq!(
                resolve_link_with_sources(&links[index], &files, "Index.md", &sources).status,
                LinkResolutionStatus::Resolved
            );
        }
        assert_eq!(
            resolve_link_with_sources(&links[3], &files, "Index.md", &sources),
            LinkResolution {
                status: LinkResolutionStatus::Unresolved,
                target: None,
                candidates: vec!["Target.md".to_owned()],
            }
        );
        assert_eq!(
            resolve_link_with_sources(&links[4], &files, "Index.md", &sources),
            LinkResolution {
                status: LinkResolutionStatus::Ambiguous,
                target: None,
                candidates: vec!["Target.md".to_owned()],
            }
        );
        for index in [5, 6, 7] {
            assert_eq!(
                resolve_link_with_sources(&links[index], &files, "Index.md", &sources).status,
                LinkResolutionStatus::Unresolved
            );
        }

        let current_note = MarkdownSource::parse(b"[[#Overview]]".to_vec())
            .unwrap()
            .extract_links();
        assert_eq!(
            resolve_link_with_sources(&current_note[0], &files, "Target.md", &sources).status,
            LinkResolutionStatus::Resolved
        );

        assert_eq!(
            resolve_link(&links[3], &files, "Index.md").status,
            LinkResolutionStatus::Resolved
        );
    }

    #[test]
    fn transclusion_slices_validated_heading_and_block_sources_read_only() {
        let bytes = "\u{feff}# Overview\r\n\r\nVisible paragraph\r\n\r\n## Details\r\nDetails paragraph ^details\r\n\r\n## Next\r\nNext paragraph\r\n\r\n```md\r\n# Fenced\r\n```\r\n## Duplicate\r\n## Duplicate\r\n"
            .as_bytes()
            .to_vec();
        let source = MarkdownSource::parse(bytes.clone()).unwrap();

        let overview = slice_markdown_subpath(&source, "Overview");
        assert_eq!(overview.status, LinkSubpathStatus::Resolved);
        assert_eq!(overview.text.as_deref(), Some(source.text()));
        assert_eq!(overview.line_start, Some(0));
        assert_eq!(overview.line_end, Some(source.text().split("\r\n").count()));

        let details = slice_markdown_subpath(&source, "Details");
        assert_eq!(details.status, LinkSubpathStatus::Resolved);
        assert_eq!(
            details.text.as_deref(),
            Some("## Details\nDetails paragraph ^details\n")
        );
        assert_eq!(details.line_start, Some(4));
        assert_eq!(details.line_end, Some(7));

        let block = slice_markdown_subpath(&source, "^details");
        assert_eq!(block.status, LinkSubpathStatus::Resolved);
        assert_eq!(block.text.as_deref(), Some("Details paragraph"));
        assert_eq!(block.line_start, Some(5));
        assert_eq!(block.line_end, Some(6));

        assert_eq!(
            slice_markdown_subpath(&source, "Fenced").status,
            LinkSubpathStatus::Unresolved
        );
        let duplicate = slice_markdown_subpath(&source, "Duplicate");
        assert_eq!(duplicate.status, LinkSubpathStatus::Ambiguous);
        assert_eq!(duplicate.text, None);
        assert_eq!(source.as_bytes(), bytes);
    }

    #[test]
    fn transclusion_slices_setext_headings_until_the_next_equal_or_higher_heading() {
        let source = MarkdownSource::parse(
            b"Title\r\n=====\r\nBody\r\nNext\r\n-----\r\nOther".to_vec(),
        )
        .unwrap();

        let title = slice_markdown_subpath(&source, "Title");
        assert_eq!(title.status, LinkSubpathStatus::Resolved);
        assert_eq!(title.text.as_deref(), Some("Title\n=====\nBody\n"));
        assert_eq!(title.line_start, Some(0));
        assert_eq!(title.line_end, Some(3));

        let next = slice_markdown_subpath(&source, "Next");
        assert_eq!(next.status, LinkSubpathStatus::Resolved);
        assert_eq!(next.text.as_deref(), Some("Next\n-----\nOther"));
        assert_eq!(next.line_start, Some(3));
        assert_eq!(next.line_end, Some(6));
        assert_eq!(source.as_bytes(), b"Title\r\n=====\r\nBody\r\nNext\r\n-----\r\nOther");
    }

    #[test]
    fn transclusion_depth_cycles_and_source_size_fail_closed() {
        let chain = vec!["Index.md".to_owned()];
        assert_eq!(
            guard_note_transclusion(0, &chain, "Notes/Target.md"),
            Ok(TransclusionGuard {
                next_depth: 1,
                chain: vec!["Index.md".to_owned(), "Notes/Target.md".to_owned()],
            })
        );
        assert_eq!(
            guard_note_transclusion(1, &["Index.md".to_owned(), "Notes/Target.md".to_owned()], "Index.md"),
            Err(TransclusionBlockReason::Cycle)
        );
        assert_eq!(
            guard_note_transclusion(MAX_NOTE_TRANSCLUSION_DEPTH, &chain, "Notes/Target.md"),
            Err(TransclusionBlockReason::Depth)
        );
        assert!(note_transclusion_source_within_limit(
            &vec![b'x'; MAX_NOTE_TRANSCLUSION_SOURCE_BYTES]
        ));
        assert!(!note_transclusion_source_within_limit(
            &vec![b'x'; MAX_NOTE_TRANSCLUSION_SOURCE_BYTES + 1]
        ));
    }

    #[test]
    fn source_aware_link_resolution_uses_subpaths_to_disambiguate_files() {
        let mut references = MarkdownSource::parse(b"[[Target#Overview]]".to_vec())
            .unwrap()
            .extract_links();
        let reference = references.remove(0);
        let files = vec!["Notes/Target.md".to_owned(), "Archive/Target.md".to_owned()];
        let mut sources = HashMap::new();
        sources.insert(
            "Notes/Target.md".to_owned(),
            MarkdownSource::parse(b"# Overview\n".to_vec()).unwrap(),
        );
        sources.insert(
            "Archive/Target.md".to_owned(),
            MarkdownSource::parse(b"# Other\n".to_vec()).unwrap(),
        );

        assert_eq!(
            resolve_link_with_sources(&reference, &files, "Index.md", &sources),
            LinkResolution {
                status: LinkResolutionStatus::Resolved,
                target: Some("Notes/Target.md".to_owned()),
                candidates: vec!["Notes/Target.md".to_owned()],
            }
        );

        sources.insert(
            "Archive/Target.md".to_owned(),
            MarkdownSource::parse(b"# Overview\n# OVERVIEW\n".to_vec()).unwrap(),
        );
        assert_eq!(
            resolve_link_with_sources(&reference, &files, "Index.md", &sources),
            LinkResolution {
                status: LinkResolutionStatus::Ambiguous,
                target: None,
                candidates: vec!["Archive/Target.md".to_owned(), "Notes/Target.md".to_owned()],
            }
        );

        sources.insert(
            "Target.md".to_owned(),
            MarkdownSource::parse("\u{feff}~~~md\n# Hidden\n".as_bytes().to_vec()).unwrap(),
        );
        let hidden_reference = MarkdownSource::parse(b"[[Target#Hidden]]".to_vec())
            .unwrap()
            .extract_links();
        assert_eq!(
            resolve_link_with_sources(
                &hidden_reference[0],
                &["Target.md".to_owned()],
                "Index.md",
                &sources
            )
            .status,
            LinkResolutionStatus::Unresolved
        );
    }

    #[test]
    fn link_rename_plan_preserves_aliases_subpaths_bom_crlf_and_byte_ranges() {
        let index = MarkdownSource::parse(
            "\u{feff}🌱 [[Old|alias]] [Old](Old.md#Section) ![[Old#^block]]\r\n"
                .as_bytes()
                .to_vec(),
        )
        .unwrap();
        let old_note = MarkdownSource::parse(
            b"# Section\n\nOpening paragraph ^block\n\n[[#Section]]\n".to_vec(),
        )
        .unwrap();
        let files = vec![
            RenamePlanFile {
                relative_path: "Index.md".to_owned(),
                source: index.clone(),
            },
            RenamePlanFile {
                relative_path: "Old.md".to_owned(),
                source: old_note.clone(),
            },
        ];

        let plan = build_link_rename_plan(&files, "Old.md", "Archive/New.md").unwrap();
        assert_eq!(plan.update_count, 4);
        assert_eq!(plan.skipped_count, 0);
        assert!(plan.edits.iter().all(|edit| {
            let source = if edit.source_path == "Index.md" {
                index.as_bytes()
            } else {
                old_note.as_bytes()
            };
            source.get(edit.source_span.start..edit.source_span.end) == Some(edit.raw.as_bytes())
        }));
        assert_eq!(
            render_link_rename_preview(&index, "Index.md", &plan)
                .unwrap()
                .as_slice(),
            "\u{feff}🌱 [[Archive/New|alias]] [Old](Archive/New.md#Section) ![[Archive/New#^block]]\r\n"
                .as_bytes()
        );
        assert_eq!(
            render_link_rename_preview(&old_note, "Old.md", &plan)
                .unwrap()
                .as_slice(),
            b"# Section\n\nOpening paragraph ^block\n\n[[Archive/New#Section]]\n"
        );
    }

    #[test]
    fn link_rename_plan_uses_subpaths_to_disambiguate_same_basename_notes() {
        let index = MarkdownSource::parse(b"[[Target#Overview]]".to_vec()).unwrap();
        let files = vec![
            RenamePlanFile {
                relative_path: "Index.md".to_owned(),
                source: index.clone(),
            },
            RenamePlanFile {
                relative_path: "Folder/Target.md".to_owned(),
                source: MarkdownSource::parse(b"# Overview\n".to_vec()).unwrap(),
            },
            RenamePlanFile {
                relative_path: "Archive/Target.md".to_owned(),
                source: MarkdownSource::parse(b"# Other\n".to_vec()).unwrap(),
            },
        ];

        let plan = build_link_rename_plan(&files, "Folder/Target.md", "Moved/Target.md").unwrap();
        assert_eq!(plan.update_count, 1);
        assert_eq!(plan.skipped_count, 0);
        assert_eq!(plan.edits[0].action, LinkRenameAction::Update);
        assert_eq!(
            render_link_rename_preview(&index, "Index.md", &plan)
                .unwrap()
                .as_slice(),
            b"[[Moved/Target#Overview]]"
        );
    }

    #[test]
    fn link_rename_plan_skips_ambiguous_and_missing_subpaths() {
        let index =
            MarkdownSource::parse(b"[[Target#Duplicate]] [[Target#Missing]] [[Other]]".to_vec())
                .unwrap();
        let files = vec![
            RenamePlanFile {
                relative_path: "Index.md".to_owned(),
                source: index.clone(),
            },
            RenamePlanFile {
                relative_path: "Folder/Target.md".to_owned(),
                source: MarkdownSource::parse(b"# Duplicate\n# DUPLICATE\n".to_vec()).unwrap(),
            },
            RenamePlanFile {
                relative_path: "Archive/Target.md".to_owned(),
                source: MarkdownSource::parse(b"# Duplicate\n# Other\n".to_vec()).unwrap(),
            },
            RenamePlanFile {
                relative_path: "Other.md".to_owned(),
                source: MarkdownSource::parse(b"# Other\n".to_vec()).unwrap(),
            },
        ];

        let plan = build_link_rename_plan(&files, "Folder/Target.md", "Moved/Target.md").unwrap();
        assert_eq!(plan.update_count, 0);
        assert_eq!(plan.skipped_count, 2);
        assert_eq!(
            plan.edits
                .iter()
                .map(|edit| edit.action)
                .collect::<Vec<_>>(),
            vec![
                LinkRenameAction::SkipAmbiguous,
                LinkRenameAction::SkipUnresolved
            ]
        );
        assert_eq!(plan.warnings.len(), 2);
        assert_eq!(
            render_link_rename_preview(&index, "Index.md", &plan)
                .unwrap()
                .as_slice(),
            index.as_bytes()
        );
    }

    #[test]
    fn link_rename_plan_keeps_relative_markdown_targets_and_rejects_stale_preview_sources() {
        let index = MarkdownSource::parse(b"[Old](Old.md#details)\n".to_vec()).unwrap();
        let old_note = MarkdownSource::parse(b"## Details\n".to_vec()).unwrap();
        let files = vec![
            RenamePlanFile {
                relative_path: "Notes/Index.md".to_owned(),
                source: index.clone(),
            },
            RenamePlanFile {
                relative_path: "Notes/Old.md".to_owned(),
                source: old_note,
            },
        ];
        let plan = build_link_rename_plan(&files, "Notes/Old.md", "Archive/New.md").unwrap();
        assert_eq!(
            plan.edits[0].replacement.as_deref(),
            Some("../Archive/New.md")
        );
        assert_eq!(
            render_link_rename_preview(&index, "Notes/Index.md", &plan)
                .unwrap()
                .as_slice(),
            b"[Old](../Archive/New.md#details)\n"
        );

        let stale = MarkdownSource::parse(b"[New](New.md#details)\n".to_vec()).unwrap();
        assert_eq!(
            render_link_rename_preview(&stale, "Notes/Index.md", &plan),
            Err(LinkRenamePlanError::StaleSource)
        );
        assert_eq!(
            build_link_rename_plan(&files, "Notes/Old.md", "Notes/Old.md"),
            Err(LinkRenamePlanError::SamePath)
        );
    }
}
