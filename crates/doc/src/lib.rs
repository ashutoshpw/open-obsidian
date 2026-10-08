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

fn source_subpath_keys(source: &MarkdownSource) -> Vec<String> {
    let bytes = source.as_bytes();
    let fenced_ranges = fenced_code_ranges(bytes);
    let mut keys = Vec::new();
    let mut fence_index = 0;
    let mut line_start = 0;

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

        keys.extend(source_line_subpath_keys(line, next_line));
        if break_width == 0 {
            break;
        }
        line_start = next_line_start;
    }

    keys
}

fn source_line_subpath_keys(line: &str, next_line: &str) -> Vec<String> {
    let mut keys = Vec::new();
    if let Some((heading, _level)) = atx_heading(line) {
        keys.push(normalized_heading(heading_text(heading)));
    } else if setext_heading_level(line, next_line).is_some() {
        keys.push(normalized_heading(heading_text(line)));
    }

    if let Some(id) = block_id(line) {
        keys.push(format!("^{id}"));
    }
    keys
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
        FrontmatterBounds, LineEnding, LinkKind, LinkResolution, LinkResolutionStatus,
        MarkdownSource, RawDocument, SourceSpan, resolve_link, resolve_link_with_sources,
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
}
