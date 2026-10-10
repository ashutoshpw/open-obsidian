//! Read-only dialect preflight for safe native Markdown previews.

use std::borrow::Cow;

use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};

/// Why the native preview must show the original Markdown source instead of rendering it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MarkdownUnsupportedSyntax {
    LegacyMath,
    Diagrams,
    RawHtml,
    WikiLinks,
    Highlights,
}

impl MarkdownUnsupportedSyntax {
    /// A stable fixture key for this unsupported syntax.
    pub const fn key(self) -> &'static str {
        match self {
            Self::LegacyMath => "legacy-math",
            Self::Diagrams => "diagrams",
            Self::RawHtml => "raw-html",
            Self::WikiLinks => "wiki-links",
            Self::Highlights => "highlights",
        }
    }

    /// A short label suitable for a user-visible preview notice.
    pub const fn label(self) -> &'static str {
        match self {
            Self::LegacyMath => "legacy math delimiters",
            Self::Diagrams => "diagrams",
            Self::RawHtml => "raw HTML",
            Self::WikiLinks => "wiki links",
            Self::Highlights => "highlights",
        }
    }
}

/// Whether the current native preview can render the note without hiding a dialect feature.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MarkdownPreviewDisposition {
    RenderMarkdown,
    ShowSource,
}

/// A read-only classification of the dialect features present in Markdown source.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarkdownPreviewAnalysis {
    unsupported: Vec<MarkdownUnsupportedSyntax>,
    safe_html_break_spans: Vec<std::ops::Range<usize>>,
    inline_highlight_spans: Vec<std::ops::Range<usize>>,
}

impl MarkdownPreviewAnalysis {
    /// Features that require the UI to show the original source as text.
    pub fn unsupported(&self) -> &[MarkdownUnsupportedSyntax] {
        &self.unsupported
    }

    /// Source spans for plain-text highlight phrases the native UI can safely present.
    pub fn inline_highlight_spans(&self) -> &[std::ops::Range<usize>] {
        &self.inline_highlight_spans
    }

    /// The safe presentation for the current native preview implementation.
    pub fn disposition(&self) -> MarkdownPreviewDisposition {
        if self.unsupported.is_empty() {
            MarkdownPreviewDisposition::RenderMarkdown
        } else {
            MarkdownPreviewDisposition::ShowSource
        }
    }

    /// Return the Markdown text used by the native preview without changing the source note.
    ///
    /// Only allowlisted inline HTML line breaks are projected to Markdown hard breaks. Any other
    /// raw HTML is classified as unsupported and remains available through the source fallback.
    pub fn native_render_source<'a>(&self, source: &'a str) -> Cow<'a, str> {
        if self.safe_html_break_spans.is_empty() {
            return Cow::Borrowed(source);
        }

        let mut rendered = String::with_capacity(source.len());
        let mut source_cursor = 0;
        for span in &self.safe_html_break_spans {
            if span.start < source_cursor
                || span.end < span.start
                || span.end > source.len()
                || !source.is_char_boundary(span.start)
                || !source.is_char_boundary(span.end)
            {
                return Cow::Borrowed(source);
            }

            rendered.push_str(&source[source_cursor..span.start]);
            let raw_span = &source[span.clone()];
            if !is_safe_inline_html_break(raw_span) {
                return Cow::Borrowed(source);
            }
            let mut break_end = span.end;
            if !raw_span.ends_with('\n') && !raw_span.ends_with('\r') {
                let remaining = &source.as_bytes()[break_end..];
                if remaining.starts_with(b"\r\n") {
                    break_end += 2;
                } else if remaining.first() == Some(&b'\n') || remaining.first() == Some(&b'\r') {
                    break_end += 1;
                }
            }
            rendered.push_str("  \n");
            source_cursor = break_end;
        }
        rendered.push_str(&source[source_cursor..]);
        Cow::Owned(rendered)
    }
}

/// Classify dialect syntax before rendering while leaving the borrowed source untouched.
///
/// CommonMark-compatible content, including standard inline and display math, continues through
/// the native `egui_commonmark` renderer. Known syntax outside that renderer's current contract
/// takes a source-only fallback, so the UI does not silently flatten legacy math delimiters,
/// diagram fences, unsupported raw HTML, wiki links, or complex highlights. A plain-text
/// paragraph may contain safely rendered highlight phrases. Attribute-free inline `<br>` tags
/// are the one safe HTML subset projected to a Markdown hard break.
/// Footnotes are supported by the pinned renderer. Inline markers inside fenced, indented, and
/// inline code are not dialect syntax. Backslash-escaped highlight openers remain literal text
/// and do not force the source-only fallback.
pub fn analyze_markdown_preview(source: &str) -> MarkdownPreviewAnalysis {
    let mut unsupported = Vec::new();
    let mut inline_code_spans = Vec::new();
    let mut safe_html_break_spans = Vec::new();
    let mut paragraph_count = 0;
    let mut plain_text_paragraph_events_only = true;
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_DEFINITION_LIST
        | Options::ENABLE_MATH;

    for (event, source_span) in Parser::new_ext(source, options).into_offset_iter() {
        match &event {
            Event::Start(Tag::Paragraph) => {
                paragraph_count += 1;
                if paragraph_count > 1 {
                    plain_text_paragraph_events_only = false;
                }
            }
            Event::End(TagEnd::Paragraph) | Event::Text(_) => {}
            _ => plain_text_paragraph_events_only = false,
        }

        match event {
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(language))) => {
                if is_diagram_fence(&language) {
                    push_once(&mut unsupported, MarkdownUnsupportedSyntax::Diagrams);
                }
            }
            Event::InlineHtml(html) if is_safe_inline_html_break(&html) => {
                safe_html_break_spans.push(source_span);
            }
            Event::Html(_) | Event::InlineHtml(_) => {
                push_once(&mut unsupported, MarkdownUnsupportedSyntax::RawHtml);
            }
            Event::Code(_) => inline_code_spans.push(source_span),
            _ => {}
        }
    }

    let mut inline_highlight_spans = Vec::new();
    scan_source_only_syntax(
        source,
        &inline_code_spans,
        &mut inline_highlight_spans,
        &mut unsupported,
    );
    if !inline_highlight_spans.is_empty()
        && !(paragraph_count == 1
            && plain_text_paragraph_events_only
            && is_simple_plain_highlight_source(source))
    {
        push_once(&mut unsupported, MarkdownUnsupportedSyntax::Highlights);
        inline_highlight_spans.clear();
    }

    MarkdownPreviewAnalysis {
        unsupported,
        safe_html_break_spans,
        inline_highlight_spans,
    }
}

fn is_simple_plain_highlight_source(source: &str) -> bool {
    !source.chars().any(|character| {
        matches!(
            character,
            '\\' | '&' | '<' | '>' | '`' | '[' | ']' | '*' | '_' | '$' | '~' | '\n' | '\r'
        )
    })
}

fn is_diagram_fence(language: &str) -> bool {
    matches!(
        language
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "mermaid" | "plantuml" | "dot" | "excalidraw" | "dataview" | "dataviewjs"
    )
}

fn is_safe_inline_html_break(html: &str) -> bool {
    let tag = html.trim();
    tag.eq_ignore_ascii_case("<br>")
        || tag.eq_ignore_ascii_case("<br/>")
        || tag.eq_ignore_ascii_case("<br />")
}

fn push_once(unsupported: &mut Vec<MarkdownUnsupportedSyntax>, syntax: MarkdownUnsupportedSyntax) {
    if !unsupported.contains(&syntax) {
        unsupported.push(syntax);
    }
}

fn scan_source_only_syntax(
    source: &str,
    inline_code_spans: &[std::ops::Range<usize>],
    inline_highlight_spans: &mut Vec<std::ops::Range<usize>>,
    unsupported: &mut Vec<MarkdownUnsupportedSyntax>,
) {
    let mut fence: Option<(u8, usize)> = None;
    let mut source_offset = 0;

    for raw_line in source.split_inclusive('\n') {
        let line = raw_line.strip_suffix('\n').unwrap_or(raw_line);
        let line = line.strip_suffix('\r').unwrap_or(line);
        let bytes = line.as_bytes();
        let leading_spaces = bytes.iter().take_while(|byte| **byte == b' ').count();

        if let Some((open_marker, open_length)) = fence {
            if leading_spaces <= 3
                && let Some((marker, marker_length, marker_start)) =
                    fence_marker(bytes, leading_spaces)
                && marker == open_marker
                && marker_length >= open_length
                && bytes[marker_start + marker_length..]
                    .iter()
                    .all(|byte| matches!(byte, b' ' | b'\t'))
            {
                fence = None;
            }
            source_offset += raw_line.len();
            continue;
        }

        if leading_spaces <= 3
            && let Some((marker, marker_length, _)) = fence_marker(bytes, leading_spaces)
            && marker_length >= 3
        {
            fence = Some((marker, marker_length));
            source_offset += raw_line.len();
            continue;
        }
        if leading_spaces >= 4 || bytes.first() == Some(&b'\t') {
            source_offset += raw_line.len();
            continue;
        }

        let mut cursor = 0;
        while cursor < bytes.len() {
            if bytes[cursor] == 96 {
                let run_length = backtick_run_length(bytes, cursor);
                let run_end = cursor + run_length;
                if let Some(close_end) =
                    matching_backtick_run_end(bytes, run_end, bytes.len(), run_length)
                {
                    cursor = close_end;
                } else {
                    cursor = run_end;
                }
                continue;
            }

            if bytes[cursor..].starts_with(b"[[") {
                if !inside_inline_code(inline_code_spans, source_offset + cursor)
                    && let Some(close_start) = find_sequence(bytes, cursor + 2, b"]]")
                    && text_between_is_not_blank(bytes, cursor + 2, close_start)
                {
                    push_once(unsupported, MarkdownUnsupportedSyntax::WikiLinks);
                }
                cursor += 2;
                continue;
            }

            if bytes[cursor..].starts_with(b"==") {
                if !inside_inline_code(inline_code_spans, source_offset + cursor)
                    && let Some(close_start) = find_sequence(bytes, cursor + 2, b"==")
                    && text_between_is_not_blank(bytes, cursor + 2, close_start)
                {
                    inline_highlight_spans
                        .push(source_offset + cursor..source_offset + close_start + 2);
                    cursor = close_start + 2;
                    continue;
                }
                cursor += 2;
                continue;
            }

            if bytes[cursor] == b'\\' {
                let mut run_end = cursor + 1;
                while run_end < bytes.len() && bytes[run_end] == b'\\' {
                    run_end += 1;
                }
                let odd_backslash_run = (run_end - cursor) % 2 == 1;
                if !inside_inline_code(inline_code_spans, source_offset + cursor)
                    && odd_backslash_run
                    && run_end < bytes.len()
                    && matches!(bytes[run_end], b'(' | b'[' | b')' | b']')
                {
                    push_once(unsupported, MarkdownUnsupportedSyntax::LegacyMath);
                }
                // CommonMark's backslash escapes quote punctuation. Consume the first equals
                // sign in an escaped highlight opener so the scanner does not mistake the second
                // one for a fresh delimiter. Even-length backslash runs retain their normal
                // behavior: the following opener is still active syntax.
                cursor = if odd_backslash_run && run_end < bytes.len() && bytes[run_end] == b'=' {
                    run_end + 1
                } else {
                    run_end
                };
                continue;
            }

            cursor += 1;
        }
        source_offset += raw_line.len();
    }
}

fn inside_inline_code(spans: &[std::ops::Range<usize>], offset: usize) -> bool {
    spans.iter().any(|span| span.contains(&offset))
}

fn fence_marker(bytes: &[u8], leading_spaces: usize) -> Option<(u8, usize, usize)> {
    let marker_start = leading_spaces;
    let marker = *bytes.get(marker_start)?;
    if marker != 96 && marker != b'~' {
        return None;
    }
    let marker_length = bytes[marker_start..]
        .iter()
        .take_while(|byte| **byte == marker)
        .count();
    Some((marker, marker_length, marker_start))
}

fn backtick_run_length(bytes: &[u8], start: usize) -> usize {
    bytes[start..]
        .iter()
        .take_while(|byte| **byte == 96)
        .count()
}

fn matching_backtick_run_end(
    bytes: &[u8],
    mut cursor: usize,
    end: usize,
    length: usize,
) -> Option<usize> {
    while cursor < end {
        if bytes[cursor] == 96 {
            let run_length = backtick_run_length(bytes, cursor);
            if run_length == length {
                return Some(cursor + run_length);
            }
            cursor += run_length;
        } else {
            cursor += 1;
        }
    }
    None
}

fn find_sequence(bytes: &[u8], start: usize, sequence: &[u8]) -> Option<usize> {
    bytes
        .get(start..)?
        .windows(sequence.len())
        .position(|window| window == sequence)
        .map(|offset| start + offset)
}

fn text_between_is_not_blank(bytes: &[u8], start: usize, end: usize) -> bool {
    std::str::from_utf8(&bytes[start..end]).is_ok_and(|text| !text.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::{MarkdownPreviewDisposition, MarkdownUnsupportedSyntax, analyze_markdown_preview};

    const DIALECT_FIXTURE: &str = include_str!("../../../fixtures/markdown-dialects.json");

    #[test]
    fn c02_safe_preview_dialect_fixtures_select_a_visible_fallback_without_mutating_source() {
        let fixture: serde_json::Value =
            serde_json::from_str(DIALECT_FIXTURE).expect("C02 dialect fixture must be valid");
        assert_eq!(fixture["id"], "fixture:c02-dialects");
        assert_eq!(
            fixture["invariants"]["source_bytes_remain_authoritative"],
            true
        );
        assert_eq!(
            fixture["invariants"]["preview_uses_text_content_for_untrusted_source"],
            true
        );
        assert_eq!(fixture["invariants"]["code_and_diagram_execution"], false);
        assert_eq!(
            fixture["invariants"]["safe_html_projection_is_read_only"],
            true
        );
        let cases = fixture["rust_preview"]["cases"]
            .as_array()
            .expect("C02 dialect fixture must include Rust preview cases");

        for case in cases {
            let source = case["source"]
                .as_str()
                .expect("every dialect case must contain source text");
            let original = source.to_owned();
            let analysis = analyze_markdown_preview(source);
            let expected_disposition = match case["expected_disposition"]
                .as_str()
                .expect("every dialect case must declare a preview disposition")
            {
                "render-markdown" => MarkdownPreviewDisposition::RenderMarkdown,
                "show-source" => MarkdownPreviewDisposition::ShowSource,
                other => panic!("unknown preview disposition: {other}"),
            };
            let expected_unsupported = case["unsupported_syntax"]
                .as_array()
                .expect("every dialect case must list its unsupported syntax")
                .iter()
                .map(|value| value.as_str().expect("syntax keys must be strings"))
                .collect::<Vec<_>>();
            let actual_unsupported = analysis
                .unsupported()
                .iter()
                .map(|syntax| syntax.key())
                .collect::<Vec<_>>();
            let actual_highlight_texts = analysis
                .inline_highlight_spans()
                .iter()
                .map(|span| {
                    source
                        .get(span.start + 2..span.end - 2)
                        .expect("highlight spans must cover valid UTF-8 source")
                })
                .collect::<Vec<_>>();
            let expected_highlight_texts = case["expected_highlight_texts"]
                .as_array()
                .map(|texts| {
                    texts
                        .iter()
                        .map(|text| text.as_str().expect("highlight text must be a string"))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();

            assert_eq!(
                analysis.disposition(),
                expected_disposition,
                "unexpected preview mode for fixture case {}",
                case["id"]
            );
            assert_eq!(
                actual_unsupported, expected_unsupported,
                "unexpected unsupported syntax for fixture case {}",
                case["id"]
            );
            assert_eq!(
                actual_highlight_texts, expected_highlight_texts,
                "unexpected native highlight spans for fixture case {}",
                case["id"]
            );
            if let Some(expected_projection) = case["expected_native_render_source"].as_str() {
                assert_eq!(
                    analysis.native_render_source(source).as_ref(),
                    expected_projection,
                    "unexpected native preview projection for fixture case {}",
                    case["id"]
                );
            }
            assert_eq!(
                source.as_bytes(),
                original.as_bytes(),
                "analysis must not change fixture source"
            );
        }
    }

    #[test]
    fn unsupported_syntax_labels_are_stable_and_user_readable() {
        assert_eq!(MarkdownUnsupportedSyntax::RawHtml.label(), "raw HTML");
        assert_eq!(MarkdownUnsupportedSyntax::WikiLinks.key(), "wiki-links");
    }
}
