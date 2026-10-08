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
        let opening_start = if self.has_bom { 3 } else { 0 };
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
    rest.iter()
        .all(|byte| *byte == b' ' || *byte == b'\t')
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
    use super::{FrontmatterBounds, LineEnding, MarkdownSource, RawDocument, SourceSpan};

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
        let bytes = "\u{feff}---\r\nstatus: 🐈\n--- \t\r\nbody".as_bytes().to_vec();
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
        assert_eq!(&bytes[bounds.content.start..bounds.content.end], "status: 🐈\n".as_bytes());
        assert_eq!(
            &bytes[bounds.closing_delimiter.start..bounds.closing_delimiter.end],
            b"--- \t"
        );
        assert_eq!(source.as_bytes(), bytes);
    }

    #[test]
    fn frontmatter_bounds_support_lf_crlf_and_cr_delimiters() {
        let cases = [
            (b"---\nkey: value\n---".as_slice(), b"key: value\n".as_slice()),
            (
                b"---\r\nkey: value\r\n---".as_slice(),
                b"key: value\r\n".as_slice(),
            ),
            (b"---\rkey: value\r---".as_slice(), b"key: value\r".as_slice()),
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
}
