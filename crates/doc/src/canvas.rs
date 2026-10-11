//! Lossless semantic parsing and encoding for JSON Canvas documents.
//!
//! The original Canvas JSON remains authoritative. This module validates only
//! the document envelope (`nodes` and `edges` arrays) and keeps every root,
//! node, and edge field as JSON so fields it does not understand survive a
//! parse-and-encode round trip.

use serde_json::Value;
use std::fmt;

/// A JSON Canvas document whose complete JSON value is retained.
#[derive(Clone, Debug, PartialEq)]
pub struct CanvasDocument {
    value: Value,
}

impl CanvasDocument {
    /// Returns the complete parsed document, including unrecognized fields.
    pub fn as_json(&self) -> &Value {
        &self.value
    }

    /// Returns the document's nodes without projecting or dropping fields.
    pub fn nodes(&self) -> &[Value] {
        self.value["nodes"]
            .as_array()
            .expect("CanvasDocument always contains a nodes array")
    }

    /// Returns the document's edges without projecting or dropping fields.
    pub fn edges(&self) -> &[Value] {
        self.value["edges"]
            .as_array()
            .expect("CanvasDocument always contains an edges array")
    }
}

/// Why a JSON Canvas document could not be parsed or encoded.
#[derive(Debug)]
pub enum CanvasError {
    /// The source is not valid UTF-8 JSON.
    MalformedJson(serde_json::Error),
    /// The root is not an object with both `nodes` and `edges` arrays.
    InvalidDocumentShape,
    /// The retained JSON value could not be encoded.
    Encode(serde_json::Error),
}

impl fmt::Display for CanvasError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MalformedJson(error) => write!(formatter, "invalid Canvas JSON: {error}"),
            Self::InvalidDocumentShape => {
                formatter.write_str("Canvas document must contain nodes and edges arrays")
            }
            Self::Encode(error) => write!(formatter, "could not encode Canvas JSON: {error}"),
        }
    }
}

impl std::error::Error for CanvasError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::MalformedJson(error) | Self::Encode(error) => Some(error),
            Self::InvalidDocumentShape => None,
        }
    }
}

/// Parses UTF-8 JSON and validates the Canvas document envelope.
///
/// As in the legacy parser, node and edge entries remain opaque JSON values;
/// this allows newer node types and unknown fields to round-trip unchanged.
pub fn parse_canvas(bytes: &[u8]) -> Result<CanvasDocument, CanvasError> {
    let value: Value = serde_json::from_slice(bytes).map_err(CanvasError::MalformedJson)?;
    if !value.is_object()
        || !value["nodes"].is_array()
        || !value["edges"].is_array()
    {
        return Err(CanvasError::InvalidDocumentShape);
    }

    Ok(CanvasDocument { value })
}

/// Encodes a Canvas document as pretty JSON followed by one line feed.
pub fn encode_canvas(document: &CanvasDocument) -> Result<Vec<u8>, CanvasError> {
    let mut bytes = serde_json::to_vec_pretty(&document.value).map_err(CanvasError::Encode)?;
    bytes.push(b'\n');
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::{CanvasError, encode_canvas, parse_canvas};
    use serde_json::Value;

    const C06_CANVAS_FIXTURE: &str = include_str!("../../../fixtures/c06-canvas.json");

    #[test]
    fn fixture_documents_round_trip_all_known_and_unknown_fields() {
        let fixture: Value =
            serde_json::from_str(C06_CANVAS_FIXTURE).expect("C06 Canvas fixture must be JSON");
        assert_eq!(fixture["schema_version"], 1);
        assert_eq!(fixture["id"], "fixture:c06-canvas");

        let cases = fixture["valid_cases"]
            .as_array()
            .expect("C06 fixture must contain valid cases");
        assert_eq!(cases.len(), 2, "fixture covers populated and empty documents");

        for case in cases {
            let case_id = case["id"]
                .as_str()
                .expect("each C06 valid case must have an id");
            let expected = &case["document"];
            let source = serde_json::to_vec(expected)
                .unwrap_or_else(|error| panic!("{case_id}: fixture document must encode: {error}"));

            let document = parse_canvas(&source)
                .unwrap_or_else(|error| panic!("{case_id}: fixture document must parse: {error}"));
            assert_eq!(document.as_json(), expected, "{case_id}: parsed value");

            let encoded = encode_canvas(&document)
                .unwrap_or_else(|error| panic!("{case_id}: fixture document must encode: {error}"));
            assert!(encoded.ends_with(b"\n"), "{case_id}: encoded JSON ends in LF");

            let round_tripped = parse_canvas(&encoded)
                .unwrap_or_else(|error| panic!("{case_id}: encoded document must parse: {error}"));
            assert_eq!(round_tripped.as_json(), expected, "{case_id}: semantic round trip");
            assert_eq!(round_tripped.nodes(), expected["nodes"].as_array().unwrap());
            assert_eq!(round_tripped.edges(), expected["edges"].as_array().unwrap());
        }

        let populated = &cases[0]["document"];
        let node_types = populated["nodes"]
            .as_array()
            .expect("populated fixture nodes must be an array")
            .iter()
            .map(|node| node["type"].as_str().expect("fixture node must have a type"))
            .collect::<Vec<_>>();
        assert_eq!(node_types, vec!["text", "file", "link", "group"]);
        assert!(populated.get("unknownRoot").is_some());
        assert!(populated["nodes"][0].get("unknownNode").is_some());
        assert!(populated["edges"][0].get("unknownEdge").is_some());
    }

    #[test]
    fn fixture_invalid_documents_report_malformed_json_and_invalid_shapes() {
        let fixture: Value =
            serde_json::from_str(C06_CANVAS_FIXTURE).expect("C06 Canvas fixture must be JSON");
        let cases = fixture["invalid_cases"]
            .as_array()
            .expect("C06 fixture must contain invalid cases");
        assert!(!cases.is_empty());

        for case in cases {
            let case_id = case["id"]
                .as_str()
                .expect("each C06 invalid case must have an id");
            let source = case["source"]
                .as_str()
                .unwrap_or_else(|| panic!("{case_id}: invalid case must have source text"));
            let error = parse_canvas(source.as_bytes())
                .expect_err("invalid fixture Canvas document must be rejected");

            match case["error"].as_str() {
                Some("malformed_json") => assert!(
                    matches!(&error, CanvasError::MalformedJson(_)),
                    "{case_id}: expected a malformed JSON error, received {error}"
                ),
                Some("invalid_shape") => assert!(
                    matches!(&error, CanvasError::InvalidDocumentShape),
                    "{case_id}: expected an invalid shape error, received {error}"
                ),
                other => panic!("{case_id}: unsupported expected error {other:?}"),
            }
        }
    }

    #[test]
    fn parser_rejects_non_utf8_source() {
        assert!(matches!(
            parse_canvas(&[b'{', 0xff, b'}']),
            Err(CanvasError::MalformedJson(_))
        ));
    }
}
