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

#[cfg(test)]
mod tests {
    use super::RawDocument;

    #[test]
    fn untouched_document_bytes_round_trip_exactly() {
        let bytes =
            b"\xef\xbb\xbf---\r\nunknown: [value, {nested: true}]\r\n---\r\ntext\r\n".to_vec();
        assert_eq!(RawDocument::from_bytes(bytes.clone()).into_bytes(), bytes);
    }
}
