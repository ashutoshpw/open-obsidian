//! Lossless document values shared by the vault engine and native UI.

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

    /// Extract supported wiki, Markdown and embed references without changing source bytes.
    ///
    /// Returned ranges are UTF-8 byte offsets. This structural pass does not resolve
    /// targets or edit references.
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
    let mut references = Vec::new();
    let mut cursor = 0;

    while cursor < bytes.len() {
        if let Some(reference) = wiki_link_at(bytes, cursor) {
            cursor = reference.source_span.end;
            references.push(reference);
        } else {
            cursor += 1;
        }
    }

    cursor = 0;
    while cursor < bytes.len() {
        if let Some(reference) = markdown_link_at(bytes, cursor) {
            cursor = reference.source_span.end;
            references.push(reference);
        } else {
            cursor += 1;
        }
    }

    references.sort_by_key(|reference| reference.source_span.start);
    references
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
        (
            &value[..separator],
            Some(value[separator + 1..].to_owned()),
        )
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
    use super::{
        FrontmatterBounds, LineEnding, LinkKind, MarkdownSource, RawDocument, SourceSpan,
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
}
