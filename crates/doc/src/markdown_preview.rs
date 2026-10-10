//! Read-only dialect preflight for safe native Markdown previews.

use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};

/// Why the native preview must show the original Markdown source instead of rendering it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MarkdownUnsupportedSyntax {
    Footnotes,
    Math,
    Diagrams,
    RawHtml,
    WikiLinks,
    Highlights,
}

impl MarkdownUnsupportedSyntax {
    /// A stable fixture key for this unsupported syntax.
    pub const fn key(self) -> &'static str {
        match self {
            Self::Footnotes => "footnotes",
            Self::Math => "math",
            Self::Diagrams => "diagrams",
            Self::RawHtml => "raw-html",
            Self::WikiLinks => "wiki-links",
            Self::Highlights => "highlights",
        }
    }

    /// A short label suitable for a user-visible preview notice.
    pub const fn label(self) -> &'static str {
        match self {
            Self::Footnotes => "footnotes",
            Self::Math => "math",
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
}

impl MarkdownPreviewAnalysis {
    /// Features that require the UI to show the original source as text.
    pub fn unsupported(&self) -> &[MarkdownUnsupportedSyntax] {
        &self.unsupported
    }

    /// The safe presentation for the current native preview implementation.
    pub fn disposition(&self) -> MarkdownPreviewDisposition {
        if self.unsupported.is_empty() {
            MarkdownPreviewDisposition::RenderMarkdown
        } else {
            MarkdownPreviewDisposition::ShowSource
        }
    }
}

/// Classify dialect syntax before rendering while leaving the borrowed source untouched.
///
/// CommonMark-compatible content continues through the native `egui_commonmark` renderer.
/// Known syntax outside that renderer's current contract takes a source-only fallback, so the
/// UI does not silently flatten footnotes, math, diagram fences, raw HTML, wiki links, or
/// highlights. Inline markers inside fenced and inline code are not treated as dialect syntax.
pub fn analyze_markdown_preview(source: &str) -> MarkdownPreviewAnalysis {
    let mut unsupported = Vec::new();
    let mut inside_code_block = false;
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_DEFINITION_LIST
        | Options::ENABLE_MATH;

    for (event, source_span) in Parser::new_ext(source, options).into_offset_iter() {
        match event {
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(language))) => {
                inside_code_block = true;
                if is_diagram_fence(&language) {
                    push_once(&mut unsupported, MarkdownUnsupportedSyntax::Diagrams);
                }
            }
            Event::Start(Tag::CodeBlock(CodeBlockKind::Indented)) => {
                inside_code_block = true;
            }
            Event::End(TagEnd::CodeBlock) => inside_code_block = false,
            Event::FootnoteReference(_) | Event::Start(Tag::FootnoteDefinition(_)) => {
                push_once(&mut unsupported, MarkdownUnsupportedSyntax::Footnotes);
            }
            Event::InlineMath(_) | Event::DisplayMath(_) => {
                push_once(&mut unsupported, MarkdownUnsupportedSyntax::Math);
            }
            Event::Html(_) | Event::InlineHtml(_) => {
                push_once(&mut unsupported, MarkdownUnsupportedSyntax::RawHtml);
            }
            Event::Text(_) if !inside_code_block => {
                let Some(text) = source.get(source_span) else {
                    continue;
                };
                if contains_wiki_link(text) {
                    push_once(&mut unsupported, MarkdownUnsupportedSyntax::WikiLinks);
                }
                if contains_highlight(text) {
                    push_once(&mut unsupported, MarkdownUnsupportedSyntax::Highlights);
                }
                if contains_legacy_math_delimiter(text) {
                    push_once(&mut unsupported, MarkdownUnsupportedSyntax::Math);
                }
            }
            _ => {}
        }
    }

    MarkdownPreviewAnalysis { unsupported }
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

fn push_once(
    unsupported: &mut Vec<MarkdownUnsupportedSyntax>,
    syntax: MarkdownUnsupportedSyntax,
) {
    if !unsupported.contains(&syntax) {
        unsupported.push(syntax);
    }
}

fn contains_wiki_link(text: &str) -> bool {
    let mut remaining = text;
    while let Some(open) = remaining.find("[[") {
        remaining = &remaining[open + 2..];
        let Some(close) = remaining.find("]]") else {
            return false;
        };
        if !remaining[..close].trim().is_empty() {
            return true;
        }
        remaining = &remaining[close + 2..];
    }
    false
}

fn contains_highlight(text: &str) -> bool {
    let mut remaining = text;
    while let Some(open) = remaining.find("==") {
        remaining = &remaining[open + 2..];
        let Some(close) = remaining.find("==") else {
            return false;
        };
        let content = &remaining[..close];
        if !content.trim().is_empty() && !content.contains('\n') && !content.contains('\r') {
            return true;
        }
        remaining = &remaining[close + 2..];
    }
    false
}

fn contains_legacy_math_delimiter(text: &str) -> bool {
    [r"\(", r"\)", r"\[", r"\]"]
        .iter()
        .any(|delimiter| text.contains(*delimiter))
}

#[cfg(test)]
mod tests {
    use super::{
        MarkdownPreviewDisposition, MarkdownUnsupportedSyntax, analyze_markdown_preview,
    };

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

            assert_eq!(
                analysis.disposition(),
                expected_disposition,
                "unexpected preview mode for fixture case {}",
                case["id"]
            );
            assert_eq!(
                actual_unsupported,
                expected_unsupported,
                "unexpected unsupported syntax for fixture case {}",
                case["id"]
            );
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
