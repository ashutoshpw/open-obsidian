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
    use super::{LineEnding, MarkdownSource, RawDocument};

    #[test]
    fn untouched_document_bytes_round_trip_exactly() {
        let bytes =
            b"\xef\xbb\xbf---\r\nunknown: [value, {nested: true}]\r\n---\r\ntext\r\n".to_vec();
        assert_eq!(RawDocument::from_bytes(bytes.clone()).into_bytes(), bytes);
    }

    #[test]
    fn markdown_source_preserves_bom_crlf_and_original_bytes() {
        let bytes = b"\xef\xbb\xbf---\r\nunknown: [value, {nested: true}]\r\n---\r\ntext\r\n".to_vec();
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
}
