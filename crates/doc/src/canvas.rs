//! Lossless semantic parsing and encoding for JSON Canvas documents.
//!
//! The original Canvas JSON remains authoritative. This module validates the
//! document object and any present `nodes`/`edges` arrays, while retaining the
//! original shape so optional arrays and fields it does not understand survive
//! a parse-and-encode round trip.

use serde_json::{Number, Value};
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

    /// Returns the source state of the optional `nodes` array.
    pub fn nodes_field<'a>(&'a self) -> CanvasField<'a, &'a [Value]> {
        array_field(&self.value, "nodes")
    }

    /// Returns the source state of the optional `edges` array.
    pub fn edges_field<'a>(&'a self) -> CanvasField<'a, &'a [Value]> {
        array_field(&self.value, "edges")
    }

    /// Returns the document's nodes without projecting or dropping fields.
    ///
    /// JSON Canvas 1.0 permits the array to be omitted. In that case this view
    /// is empty while [`Self::as_json`] still preserves the omitted field.
    pub fn nodes(&self) -> &[Value] {
        self.value
            .get("nodes")
            .and_then(Value::as_array)
            .map_or(&[], Vec::as_slice)
    }

    /// Returns the document's edges without projecting or dropping fields.
    ///
    /// JSON Canvas 1.0 permits the array to be omitted. In that case this view
    /// is empty while [`Self::as_json`] still preserves the omitted field.
    pub fn edges(&self) -> &[Value] {
        self.value
            .get("edges")
            .and_then(Value::as_array)
            .map_or(&[], Vec::as_slice)
    }

    /// Projects standard node fields without changing or discarding their JSON.
    ///
    /// Unknown node types and malformed fields remain visible through the
    /// projection and its `raw` value. The document's complete JSON remains
    /// authoritative.
    pub fn project_nodes(&self) -> impl Iterator<Item = CanvasNodeProjection<'_>> {
        self.nodes().iter().map(CanvasNodeProjection::from_json)
    }

    /// Projects standard edge fields without changing or discarding their JSON.
    pub fn project_edges(&self) -> impl Iterator<Item = CanvasEdgeProjection<'_>> {
        self.edges().iter().map(CanvasEdgeProjection::from_json)
    }

    /// Returns the stored text from one uniquely identified text node.
    ///
    /// The returned text is not trimmed or normalized. This document-only
    /// operation does not mutate the Canvas or create a note.
    pub fn extract_text_node(&self, node_id: &str) -> Result<&str, CanvasError> {
        let mut matching_nodes = self
            .nodes()
            .iter()
            .filter(|node| node.get("id").and_then(Value::as_str) == Some(node_id));
        let node = matching_nodes
            .next()
            .ok_or_else(|| CanvasError::NodeNotFound(node_id.to_owned()))?;
        if matching_nodes.next().is_some() {
            return Err(CanvasError::AmbiguousNodeId(node_id.to_owned()));
        }
        if node.get("type").and_then(Value::as_str) != Some("text") {
            return Err(CanvasError::NotTextNode(node_id.to_owned()));
        }

        node.get("text")
            .and_then(Value::as_str)
            .ok_or_else(|| CanvasError::TextContentUnavailable(node_id.to_owned()))
    }

    /// Replaces the text on one uniquely identified text node.
    ///
    /// This document-only operation does not create notes or write to a vault.
    pub fn edit_text_node(&mut self, node_id: &str, text: &str) -> Result<(), CanvasError> {
        let Some(nodes) = self
            .value
            .get_mut("nodes")
            .and_then(Value::as_array_mut)
        else {
            return Err(CanvasError::NodeNotFound(node_id.to_owned()));
        };
        let matching_indices = nodes
            .iter()
            .enumerate()
            .filter(|(_, node)| node.get("id").and_then(Value::as_str) == Some(node_id))
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        let node_index = match matching_indices.as_slice() {
            [] => return Err(CanvasError::NodeNotFound(node_id.to_owned())),
            [node_index] => *node_index,
            _ => return Err(CanvasError::AmbiguousNodeId(node_id.to_owned())),
        };
        let node = &mut nodes[node_index];
        if node.get("type").and_then(Value::as_str) != Some("text") {
            return Err(CanvasError::NotTextNode(node_id.to_owned()));
        }

        node.as_object_mut()
            .expect("a node with an id is a JSON object")
            .insert("text".to_owned(), Value::String(text.to_owned()));
        Ok(())
    }
}

/// A field in a typed projection, preserving absence and malformed source data.
#[derive(Clone, Debug, PartialEq)]
pub enum CanvasField<'a, T> {
    /// The containing object has no field with this name.
    Missing,
    /// The field has the expected JSON type and is borrowed from the document.
    /// This does not validate enum spellings or relationships between fields.
    Valid(T),
    /// The field or containing value has an unexpected JSON shape.
    ///
    /// The original malformed value is borrowed here and remains in the raw document.
    Malformed(&'a Value),
}

impl<'a, T> CanvasField<'a, T> {
    /// Returns the typed value when this field is present and well-formed.
    pub fn valid(&self) -> Option<&T> {
        match self {
            Self::Valid(value) => Some(value),
            Self::Missing | Self::Malformed(_) => None,
        }
    }

    /// Returns true when the source object omitted this field.
    pub fn is_missing(&self) -> bool {
        matches!(self, Self::Missing)
    }

    /// Returns true when the field or containing JSON value is malformed.
    pub fn is_malformed(&self) -> bool {
        matches!(self, Self::Malformed(_))
    }
}

/// Typed content fields for one Canvas node.
#[derive(Clone, Debug, PartialEq)]
pub enum CanvasNodeContent<'a> {
    /// A text card. `text` is required by JSON Canvas 1.0.
    Text { text: CanvasField<'a, &'a str> },
    /// A file card with the standard file and optional subpath fields.
    File {
        file: CanvasField<'a, &'a str>,
        subpath: CanvasField<'a, &'a str>,
    },
    /// A URL card.
    Link { url: CanvasField<'a, &'a str> },
    /// A visual group. Application-specific fields remain available in `raw`.
    Group {
        label: CanvasField<'a, &'a str>,
        background: CanvasField<'a, &'a str>,
        background_style: CanvasField<'a, &'a str>,
    },
    /// A missing, malformed, or not-yet-supported `type` value.
    Unsupported {
        node_type: CanvasField<'a, &'a str>,
    },
}

/// A borrowed typed view of one node; `raw` retains all standard and unknown data.
/// Geometry fields are accepted only when the JSON number is an integer, as
/// required by JSON Canvas 1.0.
///
/// String fields are checked for JSON string type, not for application-specific
/// support of enum spellings, subpath/color constraints, or cross-node references.
/// Raw values are available so callers can handle unrecognized future values.
#[derive(Clone, Debug, PartialEq)]
pub struct CanvasNodeProjection<'a> {
    pub raw: &'a Value,
    pub id: CanvasField<'a, &'a str>,
    pub node_type: CanvasField<'a, &'a str>,
    pub x: CanvasField<'a, &'a Number>,
    pub y: CanvasField<'a, &'a Number>,
    pub width: CanvasField<'a, &'a Number>,
    pub height: CanvasField<'a, &'a Number>,
    pub color: CanvasField<'a, &'a str>,
    pub content: CanvasNodeContent<'a>,
}

impl<'a> CanvasNodeProjection<'a> {
    fn from_json(raw: &'a Value) -> Self {
        let node_type = string_field(raw, "type");
        let content = match node_type.valid().copied() {
            Some("text") => CanvasNodeContent::Text {
                text: string_field(raw, "text"),
            },
            Some("file") => CanvasNodeContent::File {
                file: string_field(raw, "file"),
                subpath: string_field(raw, "subpath"),
            },
            Some("link") => CanvasNodeContent::Link {
                url: string_field(raw, "url"),
            },
            Some("group") => CanvasNodeContent::Group {
                label: string_field(raw, "label"),
                background: string_field(raw, "background"),
                background_style: string_field(raw, "backgroundStyle"),
            },
            Some(_) | None => CanvasNodeContent::Unsupported {
                node_type: node_type.clone(),
            },
        };

        Self {
            raw,
            id: string_field(raw, "id"),
            node_type,
            x: number_field(raw, "x"),
            y: number_field(raw, "y"),
            width: number_field(raw, "width"),
            height: number_field(raw, "height"),
            color: string_field(raw, "color"),
            content,
        }
    }
}

/// A borrowed typed view of one edge; `raw` retains all standard and unknown data.
///
/// String fields are checked for JSON string type, not for supported side/end
/// spellings or whether their endpoint IDs resolve to nodes.
#[derive(Clone, Debug, PartialEq)]
pub struct CanvasEdgeProjection<'a> {
    pub raw: &'a Value,
    pub id: CanvasField<'a, &'a str>,
    pub from_node: CanvasField<'a, &'a str>,
    pub from_side: CanvasField<'a, &'a str>,
    pub from_end: CanvasField<'a, &'a str>,
    pub to_node: CanvasField<'a, &'a str>,
    pub to_side: CanvasField<'a, &'a str>,
    pub to_end: CanvasField<'a, &'a str>,
    pub color: CanvasField<'a, &'a str>,
    pub label: CanvasField<'a, &'a str>,
}

impl<'a> CanvasEdgeProjection<'a> {
    fn from_json(raw: &'a Value) -> Self {
        Self {
            raw,
            id: string_field(raw, "id"),
            from_node: string_field(raw, "fromNode"),
            from_side: string_field(raw, "fromSide"),
            from_end: string_field(raw, "fromEnd"),
            to_node: string_field(raw, "toNode"),
            to_side: string_field(raw, "toSide"),
            to_end: string_field(raw, "toEnd"),
            color: string_field(raw, "color"),
            label: string_field(raw, "label"),
        }
    }
}

fn field_value<'a>(raw: &'a Value, name: &str) -> CanvasField<'a, &'a Value> {
    let Some(object) = raw.as_object() else {
        return CanvasField::Malformed(raw);
    };
    match object.get(name) {
        Some(value) => CanvasField::Valid(value),
        None => CanvasField::Missing,
    }
}

fn array_field<'a>(raw: &'a Value, name: &str) -> CanvasField<'a, &'a [Value]> {
    match field_value(raw, name) {
        CanvasField::Missing => CanvasField::Missing,
        CanvasField::Malformed(value) => CanvasField::Malformed(value),
        CanvasField::Valid(value) => match value.as_array() {
            Some(items) => CanvasField::Valid(items.as_slice()),
            None => CanvasField::Malformed(value),
        },
    }
}

fn string_field<'a>(raw: &'a Value, name: &str) -> CanvasField<'a, &'a str> {
    match field_value(raw, name) {
        CanvasField::Missing => CanvasField::Missing,
        CanvasField::Malformed(value) => CanvasField::Malformed(value),
        CanvasField::Valid(value) => match value.as_str() {
            Some(text) => CanvasField::Valid(text),
            None => CanvasField::Malformed(value),
        },
    }
}

fn number_field<'a>(raw: &'a Value, name: &str) -> CanvasField<'a, &'a Number> {
    match field_value(raw, name) {
        CanvasField::Missing => CanvasField::Missing,
        CanvasField::Malformed(value) => CanvasField::Malformed(value),
        CanvasField::Valid(value) => match value.as_number() {
            Some(number) if number.is_i64() || number.is_u64() => CanvasField::Valid(number),
            None => CanvasField::Malformed(value),
            Some(_) => CanvasField::Malformed(value),
        },
    }
}

/// Why a JSON Canvas document could not be parsed, encoded, edited, or extracted.
#[derive(Debug)]
pub enum CanvasError {
    /// The source is not valid UTF-8 JSON.
    MalformedJson(serde_json::Error),
    /// The root is not an object, or a present `nodes`/`edges` field is not an array.
    InvalidDocumentShape,
    /// The retained JSON value could not be encoded.
    Encode(serde_json::Error),
    /// No node has the requested ID.
    NodeNotFound(String),
    /// Multiple nodes have the requested ID, so an edit would be ambiguous.
    AmbiguousNodeId(String),
    /// The requested node exists but is not a text node.
    NotTextNode(String),
    /// The requested text node does not contain a string-valued text field.
    TextContentUnavailable(String),
}

impl fmt::Display for CanvasError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MalformedJson(error) => write!(formatter, "invalid Canvas JSON: {error}"),
            Self::InvalidDocumentShape => {
                formatter.write_str(
                    "Canvas document must be an object with optional nodes and edges arrays",
                )
            }
            Self::Encode(error) => write!(formatter, "could not encode Canvas JSON: {error}"),
            Self::NodeNotFound(node_id) => {
                write!(formatter, "Canvas node does not exist: {node_id}")
            }
            Self::AmbiguousNodeId(node_id) => {
                write!(formatter, "Canvas node ID is ambiguous: {node_id}")
            }
            Self::NotTextNode(node_id) => {
                write!(formatter, "Canvas node is not a text card: {node_id}")
            }
            Self::TextContentUnavailable(node_id) => {
                write!(formatter, "Canvas text card has no string text: {node_id}")
            }
        }
    }
}

impl std::error::Error for CanvasError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::MalformedJson(error) | Self::Encode(error) => Some(error),
            Self::InvalidDocumentShape
            | Self::NodeNotFound(_)
            | Self::AmbiguousNodeId(_)
            | Self::NotTextNode(_)
            | Self::TextContentUnavailable(_) => None,
        }
    }
}

/// Parses UTF-8 JSON and validates the Canvas document object and present arrays.
///
/// JSON Canvas 1.0 permits `nodes` and `edges` to be omitted. Node and edge
/// entries remain opaque JSON values so newer types and unknown fields round-trip.
pub fn parse_canvas(bytes: &[u8]) -> Result<CanvasDocument, CanvasError> {
    let value: Value = serde_json::from_slice(bytes).map_err(CanvasError::MalformedJson)?;
    let Some(object) = value.as_object() else {
        return Err(CanvasError::InvalidDocumentShape);
    };
    if ["nodes", "edges"]
        .into_iter()
        .any(|name| object.get(name).is_some_and(|array| !array.is_array()))
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
    use super::{CanvasError, CanvasField, CanvasNodeContent, encode_canvas, parse_canvas};
    use serde_json::Value;

    const C06_CANVAS_FIXTURE: &str = include_str!("../../../fixtures/c06-canvas.json");
    const C06_TEXT_CARD_FIXTURE: &str = include_str!("../../../fixtures/c06-text-card.json");

    fn field_state<T>(field: &CanvasField<'_, T>) -> &'static str {
        match field {
            CanvasField::Missing => "missing",
            CanvasField::Valid(_) => "valid",
            CanvasField::Malformed(_) => "malformed",
        }
    }

    fn malformed_value<'document, T>(
        field: &CanvasField<'document, T>,
    ) -> Option<&'document Value> {
        match field {
            CanvasField::Malformed(value) => Some(*value),
            CanvasField::Missing | CanvasField::Valid(_) => None,
        }
    }

    fn content_kind(content: &CanvasNodeContent<'_>) -> &'static str {
        match content {
            CanvasNodeContent::Text { .. } => "text",
            CanvasNodeContent::File { .. } => "file",
            CanvasNodeContent::Link { .. } => "link",
            CanvasNodeContent::Group { .. } => "group",
            CanvasNodeContent::Unsupported { .. } => "unsupported",
        }
    }

    #[test]
    fn fixture_documents_round_trip_all_known_and_unknown_fields() {
        let fixture: Value =
            serde_json::from_str(C06_CANVAS_FIXTURE).expect("C06 Canvas fixture must be JSON");
        assert_eq!(fixture["schema_version"], 1);
        assert_eq!(fixture["id"], "fixture:c06-canvas");

        let cases = fixture["valid_cases"]
            .as_array()
            .expect("C06 fixture must contain valid cases");
        assert_eq!(
            cases.len(),
            5,
            "fixture covers populated, empty, and omitted-array documents"
        );

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
            assert!(
                encoded.ends_with(b"\n"),
                "{case_id}: encoded JSON ends in LF"
            );

            let round_tripped = parse_canvas(&encoded)
                .unwrap_or_else(|error| panic!("{case_id}: encoded document must parse: {error}"));
            assert_eq!(
                round_tripped.as_json(),
                expected,
                "{case_id}: semantic round trip"
            );
            let expected_nodes: &[Value] = expected
                .get("nodes")
                .and_then(Value::as_array)
                .map_or(&[], Vec::as_slice);
            let expected_edges: &[Value] = expected
                .get("edges")
                .and_then(Value::as_array)
                .map_or(&[], Vec::as_slice);
            assert_eq!(round_tripped.nodes(), expected_nodes, "{case_id}: nodes view");
            assert_eq!(round_tripped.edges(), expected_edges, "{case_id}: edges view");
            assert_eq!(
                round_tripped.nodes_field().is_missing(),
                expected.get("nodes").is_none(),
                "{case_id}: nodes field presence"
            );
            assert_eq!(
                round_tripped.edges_field().is_missing(),
                expected.get("edges").is_none(),
                "{case_id}: edges field presence"
            );
            match case_id {
                "nodes-array-omitted" | "both-arrays-omitted" => {
                    assert!(round_tripped.as_json().get("nodes").is_none());
                }
                _ => {}
            }
            match case_id {
                "edges-array-omitted" | "both-arrays-omitted" => {
                    assert!(round_tripped.as_json().get("edges").is_none());
                }
                _ => {}
            }
        }

        let populated = &cases[0]["document"];
        let node_types = populated["nodes"]
            .as_array()
            .expect("populated fixture nodes must be an array")
            .iter()
            .map(|node| {
                node["type"]
                    .as_str()
                    .expect("fixture node must have a type")
            })
            .collect::<Vec<_>>();
        assert_eq!(node_types, vec!["text", "file", "link", "group"]);
        assert!(populated.get("unknownRoot").is_some());
        assert!(populated["nodes"][0].get("unknownNode").is_some());
        assert!(populated["edges"][0].get("unknownEdge").is_some());
    }

    #[test]
    fn fixture_projections_expose_standard_node_and_edge_fields_losslessly() {
        let fixture: Value =
            serde_json::from_str(C06_CANVAS_FIXTURE).expect("C06 Canvas fixture must be JSON");
        let expected = &fixture["valid_cases"][0]["document"];
        let source = serde_json::to_vec(expected).expect("Canvas fixture must encode");
        let document = parse_canvas(&source).expect("Canvas fixture must parse");
        let original = document.clone();
        let nodes = document.project_nodes().collect::<Vec<_>>();
        let edges = document.project_edges().collect::<Vec<_>>();

        assert_eq!(nodes.len(), 4);
        assert_eq!(nodes[0].id.valid().copied(), Some("text-1"));
        assert_eq!(nodes[0].node_type.valid().copied(), Some("text"));
        assert_eq!(nodes[0].color.valid().copied(), Some("1"));
        assert_eq!(nodes[0].x.valid().and_then(|number| number.as_i64()), Some(10));
        assert_eq!(nodes[0].y.valid().and_then(|number| number.as_i64()), Some(20));
        assert_eq!(
            nodes[0].width.valid().and_then(|number| number.as_i64()),
            Some(320)
        );
        assert_eq!(
            nodes[0].height.valid().and_then(|number| number.as_i64()),
            Some(140)
        );
        match &nodes[0].content {
            CanvasNodeContent::Text { text } => {
                assert_eq!(text.valid().copied(), Some("Canvas text card"));
            }
            other => panic!("expected text content, received {other:?}"),
        }

        assert_eq!(nodes[1].id.valid().copied(), Some("file-1"));
        match &nodes[1].content {
            CanvasNodeContent::File { file, subpath } => {
                assert_eq!(file.valid().copied(), Some("Notes/Target.md"));
                assert_eq!(subpath.valid().copied(), Some("#^block-id"));
            }
            other => panic!("expected file content, received {other:?}"),
        }
        assert_eq!(nodes[1].raw["label"].as_str(), Some("Target note"));

        assert_eq!(nodes[2].id.valid().copied(), Some("link-1"));
        match &nodes[2].content {
            CanvasNodeContent::Link { url } => {
                assert_eq!(url.valid().copied(), Some("https://example.com/reference"));
            }
            other => panic!("expected link content, received {other:?}"),
        }
        assert_eq!(nodes[2].raw["label"].as_str(), Some("External reference"));

        assert_eq!(nodes[3].id.valid().copied(), Some("group-1"));
        match &nodes[3].content {
            CanvasNodeContent::Group {
                label,
                background,
                background_style,
            } => {
                assert_eq!(label.valid().copied(), Some("Research group"));
                assert_eq!(
                    background.valid().copied(),
                    Some("Assets/group-background.png")
                );
                assert_eq!(background_style.valid().copied(), Some("cover"));
            }
            other => panic!("expected group content, received {other:?}"),
        }
        assert_eq!(nodes[3].raw["children"][0].as_str(), Some("text-1"));
        assert_eq!(nodes[3].raw["children"][1].as_str(), Some("file-1"));

        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].id.valid().copied(), Some("edge-1"));
        assert_eq!(edges[0].from_node.valid().copied(), Some("text-1"));
        assert_eq!(edges[0].from_side.valid().copied(), Some("right"));
        assert_eq!(edges[0].from_end.valid().copied(), Some("arrow"));
        assert_eq!(edges[0].to_node.valid().copied(), Some("file-1"));
        assert_eq!(edges[0].to_side.valid().copied(), Some("left"));
        assert_eq!(edges[0].to_end.valid().copied(), Some("none"));
        assert_eq!(edges[0].color.valid().copied(), Some("4"));
        assert_eq!(edges[0].label.valid().copied(), Some("supports"));
        assert!(nodes[0].raw.get("unknownNode").is_some());
        assert!(nodes[1].raw.get("unknownFileMetadata").is_some());
        assert!(edges[0].raw.get("unknownEdge").is_some());
        assert_eq!(document, original, "projection must not mutate its source");
        assert_eq!(document.as_json(), expected, "unknown JSON remains accessible");
    }

    #[test]
    fn fixture_projection_cases_distinguish_missing_malformed_and_unsupported_fields() {
        let fixture: Value =
            serde_json::from_str(C06_CANVAS_FIXTURE).expect("C06 Canvas fixture must be JSON");
        let cases = fixture["projection_cases"]
            .as_array()
            .expect("C06 fixture must contain projection cases");
        assert_eq!(cases.len(), 5);

        for case in cases {
            let case_id = case["id"]
                .as_str()
                .expect("each projection case must have an id");
            let expected = &case["expected"];
            let source = serde_json::to_vec(&case["document"])
                .unwrap_or_else(|error| {
                    panic!("{case_id}: projection document must encode: {error}")
                });
            let document = parse_canvas(&source)
                .unwrap_or_else(|error| {
                    panic!("{case_id}: projection document must parse: {error}")
                });

            match case_id {
                "unsupported-node-type" => {
                    let node = document.project_nodes().next().expect("one node is present");
                    assert_eq!(
                        node.node_type.valid().copied(),
                        expected["node_type"].as_str(),
                        "{case_id}: node type value"
                    );
                    assert_eq!(
                        field_state(&node.node_type),
                        expected["node_type_state"].as_str().unwrap(),
                        "{case_id}: node type state"
                    );
                    assert_eq!(
                        content_kind(&node.content),
                        expected["content"].as_str().unwrap(),
                        "{case_id}: content kind"
                    );
                    assert_eq!(
                        field_state(&node.x),
                        expected["x_state"].as_str().unwrap(),
                        "{case_id}: x field state"
                    );
                    assert_eq!(
                        field_state(&node.y),
                        expected["y_state"].as_str().unwrap(),
                        "{case_id}: y field state"
                    );
                    assert_eq!(
                        node.raw.get("future").is_some(),
                        expected["future_field_preserved"].as_bool().unwrap(),
                        "{case_id}: unknown field preservation"
                    );
                    match &node.content {
                        CanvasNodeContent::Unsupported { node_type } => {
                            assert_eq!(
                                field_state(node_type),
                                expected["node_type_state"].as_str().unwrap(),
                                "{case_id}: unsupported content node type state"
                            );
                            assert_eq!(
                                node_type.valid().copied(),
                                expected["node_type"].as_str(),
                                "{case_id}: unsupported content node type value"
                            );
                        }
                        other => panic!(
                            "{case_id}: expected unsupported content, received {other:?}"
                        ),
                    }
                }
                "unsupported-malformed-node-type" => {
                    let node = document.project_nodes().next().expect("one node is present");
                    assert_eq!(
                        field_state(&node.node_type),
                        expected["node_type_state"].as_str().unwrap(),
                        "{case_id}: malformed node type state"
                    );
                    assert_eq!(
                        malformed_value(&node.node_type),
                        Some(&expected["node_type_raw"]),
                        "{case_id}: malformed node type raw value"
                    );
                    assert_eq!(
                        content_kind(&node.content),
                        expected["content"].as_str().unwrap(),
                        "{case_id}: content kind"
                    );
                    match &node.content {
                        CanvasNodeContent::Unsupported { node_type } => {
                            assert_eq!(
                                field_state(node_type),
                                expected["node_type_state"].as_str().unwrap(),
                                "{case_id}: unsupported content node type state"
                            );
                            assert_eq!(
                                malformed_value(node_type),
                                Some(&expected["node_type_raw"]),
                                "{case_id}: unsupported content node type raw value"
                            );
                        }
                        other => panic!(
                            "{case_id}: expected unsupported content, received {other:?}"
                        ),
                    }
                }
                "malformed-node-fields" => {
                    let nodes = document.project_nodes().collect::<Vec<_>>();
                    assert_eq!(nodes.len(), 2, "{case_id}: node count");
                    assert_eq!(
                        field_state(&nodes[0].id),
                        expected["id_state"].as_str().unwrap(),
                        "{case_id}: malformed id state"
                    );
                    assert_eq!(
                        malformed_value(&nodes[0].id),
                        Some(&expected["id_raw"]),
                        "{case_id}: malformed id raw value"
                    );
                    assert_eq!(
                        content_kind(&nodes[0].content),
                        expected["content"].as_str().unwrap(),
                        "{case_id}: content kind"
                    );
                    match &nodes[0].content {
                        CanvasNodeContent::Text { text } => {
                            assert_eq!(
                                field_state(text),
                                expected["text_state"].as_str().unwrap(),
                                "{case_id}: text field state"
                            );
                            assert_eq!(
                                malformed_value(text),
                                Some(&expected["text_raw"]),
                                "{case_id}: malformed text raw value"
                            );
                        }
                        other => panic!("{case_id}: expected text content, received {other:?}"),
                    }
                    assert_eq!(
                        field_state(&nodes[1].id),
                        expected["missing_id_state"].as_str().unwrap(),
                        "{case_id}: absent id state"
                    );
                    assert_eq!(
                        field_state(&nodes[1].node_type),
                        expected["missing_type_state"].as_str().unwrap(),
                        "{case_id}: absent type state"
                    );
                    assert_eq!(
                        content_kind(&nodes[1].content),
                        expected["missing_content"].as_str().unwrap(),
                        "{case_id}: absent type content"
                    );
                    match &nodes[1].content {
                        CanvasNodeContent::Unsupported { node_type } => {
                            assert_eq!(
                                field_state(node_type),
                                expected["missing_type_state"].as_str().unwrap(),
                                "{case_id}: unsupported content node type state"
                            );
                            assert_eq!(
                                node_type.valid(),
                                None,
                                "{case_id}: missing unsupported node type has no value"
                            );
                            assert_eq!(
                                malformed_value(node_type),
                                None,
                                "{case_id}: missing unsupported node type has no malformed value"
                            );
                        }
                        other => panic!(
                            "{case_id}: expected unsupported content, received {other:?}"
                        ),
                    }
                }
                "malformed-and-missing-color" => {
                    let nodes = document.project_nodes().collect::<Vec<_>>();
                    assert_eq!(nodes.len(), 2, "{case_id}: node count");
                    assert_eq!(
                        field_state(&nodes[0].color),
                        expected["malformed_color_state"].as_str().unwrap(),
                        "{case_id}: malformed color state"
                    );
                    assert_eq!(
                        malformed_value(&nodes[0].color),
                        Some(&expected["malformed_color_raw"]),
                        "{case_id}: malformed color raw value"
                    );
                    assert_eq!(
                        field_state(&nodes[1].color),
                        expected["missing_color_state"].as_str().unwrap(),
                        "{case_id}: missing color state"
                    );
                    assert_eq!(
                        nodes[1].color.valid(),
                        None,
                        "{case_id}: missing color has no value"
                    );
                    assert_eq!(
                        malformed_value(&nodes[1].color),
                        None,
                        "{case_id}: missing color has no malformed value"
                    );
                }
                "malformed-edge-fields" => {
                    let edge = document.project_edges().next().expect("one edge is present");
                    assert_eq!(
                        field_state(&edge.from_node),
                        expected["from_node_state"].as_str().unwrap(),
                        "{case_id}: malformed endpoint state"
                    );
                    assert_eq!(
                        malformed_value(&edge.from_node),
                        Some(&expected["from_node_raw"]),
                        "{case_id}: malformed endpoint raw value"
                    );
                    assert_eq!(
                        field_state(&edge.to_node),
                        expected["to_node_state"].as_str().unwrap(),
                        "{case_id}: valid endpoint state"
                    );
                    assert_eq!(
                        edge.to_node.valid().copied(),
                        expected["to_node"].as_str(),
                        "{case_id}: valid endpoint value"
                    );
                    assert_eq!(
                        field_state(&edge.from_side),
                        expected["from_side_state"].as_str().unwrap(),
                        "{case_id}: absent side state"
                    );
                }
                other => panic!("unsupported C06 projection case {other:?}"),
            }
        }
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

    #[test]
    fn omitted_optional_arrays_remain_distinct_from_empty_arrays_and_are_non_mutating() {
        let omitted_nodes = parse_canvas(br#"{"edges":[]}"#)
            .expect("JSON Canvas permits the nodes array to be omitted");
        assert!(omitted_nodes.nodes_field().is_missing());
        assert_eq!(omitted_nodes.nodes(), &[]);
        assert_eq!(
            omitted_nodes
                .extract_text_node("missing")
                .expect_err("there are no nodes")
                .to_string(),
            "Canvas node does not exist: missing"
        );
        let original = omitted_nodes.clone();
        let mut editable = omitted_nodes;
        assert!(matches!(
            editable.edit_text_node("missing", "must not be inserted"),
            Err(CanvasError::NodeNotFound(_))
        ));
        assert_eq!(editable, original, "failed edit preserves omitted nodes array");

        let empty_nodes = parse_canvas(br#"{"nodes":[],"edges":[]}"#)
            .expect("an explicitly empty nodes array is valid");
        assert!(!empty_nodes.nodes_field().is_missing());
        assert_eq!(empty_nodes.nodes_field().valid().map(|nodes| nodes.len()), Some(0));
        assert!(empty_nodes.as_json().get("nodes").is_some());
    }

    #[test]
    fn fixture_edits_only_the_selected_text_card_and_preserves_unknown_fields() {
        let fixture: Value = serde_json::from_str(C06_TEXT_CARD_FIXTURE)
            .expect("C06 text-card fixture must be JSON");
        assert_eq!(fixture["schema_version"], 1);
        assert_eq!(fixture["id"], "fixture:c06-text-card");

        let cases = fixture["valid_edits"]
            .as_array()
            .expect("C06 text-card fixture must contain valid edits");
        assert!(!cases.is_empty());

        for case in cases {
            let case_id = case["id"]
                .as_str()
                .expect("each C06 text-card edit must have an id");
            let before = &case["before"];
            let expected = &case["after"];
            let source = serde_json::to_vec(before)
                .unwrap_or_else(|error| panic!("{case_id}: before document must encode: {error}"));
            let mut document = parse_canvas(&source)
                .unwrap_or_else(|error| panic!("{case_id}: before document must parse: {error}"));

            document
                .edit_text_node(
                    case["node_id"]
                        .as_str()
                        .unwrap_or_else(|| panic!("{case_id}: node_id must be a string")),
                    case["text"]
                        .as_str()
                        .unwrap_or_else(|| panic!("{case_id}: text must be a string")),
                )
                .unwrap_or_else(|error| panic!("{case_id}: edit must succeed: {error}"));
            assert_eq!(document.as_json(), expected, "{case_id}: only text changes");

            let encoded = encode_canvas(&document)
                .unwrap_or_else(|error| panic!("{case_id}: edited document must encode: {error}"));
            let round_tripped = parse_canvas(&encoded)
                .unwrap_or_else(|error| panic!("{case_id}: edited document must parse: {error}"));
            assert_eq!(
                round_tripped.as_json(),
                expected,
                "{case_id}: edited semantic round trip"
            );
        }
    }

    #[test]
    fn fixture_extraction_returns_exact_text_without_mutating_the_document() {
        let fixture: Value = serde_json::from_str(C06_TEXT_CARD_FIXTURE)
            .expect("C06 text-card fixture must be JSON");
        let cases = fixture["valid_extractions"]
            .as_array()
            .expect("C06 text-card fixture must contain valid extractions");
        assert!(!cases.is_empty());

        for case in cases {
            let case_id = case["id"]
                .as_str()
                .expect("each valid extraction must have an id");
            let source = serde_json::to_vec(&case["document"]).unwrap_or_else(|error| {
                panic!("{case_id}: extraction document must encode: {error}")
            });
            let document = parse_canvas(&source)
                .unwrap_or_else(|error| panic!("{case_id}: document must parse: {error}"));
            let original = document.clone();
            let actual = document
                .extract_text_node(
                    case["node_id"]
                        .as_str()
                        .unwrap_or_else(|| panic!("{case_id}: node_id must be a string")),
                )
                .unwrap_or_else(|error| panic!("{case_id}: extraction must succeed: {error}"));
            let expected = case["text"]
                .as_str()
                .unwrap_or_else(|| panic!("{case_id}: expected text must be a string"));

            assert_eq!(actual, expected, "{case_id}: exact extracted text");
            assert_eq!(document, original, "{case_id}: extraction is immutable");
        }
    }

    #[test]
    fn invalid_fixture_extractions_fail_without_mutating_the_document() {
        let fixture: Value = serde_json::from_str(C06_TEXT_CARD_FIXTURE)
            .expect("C06 text-card fixture must be JSON");
        let cases = fixture["invalid_extractions"]
            .as_array()
            .expect("C06 text-card fixture must contain invalid extractions");
        assert!(!cases.is_empty());

        for case in cases {
            let case_id = case["id"]
                .as_str()
                .expect("each invalid extraction must have an id");
            let source = serde_json::to_vec(&case["document"]).unwrap_or_else(|error| {
                panic!("{case_id}: extraction document must encode: {error}")
            });
            let document = parse_canvas(&source)
                .unwrap_or_else(|error| panic!("{case_id}: document must parse: {error}"));
            let original = document.clone();
            let error = document
                .extract_text_node(
                    case["node_id"]
                        .as_str()
                        .unwrap_or_else(|| panic!("{case_id}: node_id must be a string")),
                )
                .expect_err("invalid fixture extraction must fail");

            match case["error"].as_str() {
                Some("node_not_found") => assert!(
                    matches!(&error, CanvasError::NodeNotFound(_)),
                    "{case_id}: expected missing node error, received {error}"
                ),
                Some("ambiguous_node_id") => assert!(
                    matches!(&error, CanvasError::AmbiguousNodeId(_)),
                    "{case_id}: expected ambiguous ID error, received {error}"
                ),
                Some("not_text_node") => assert!(
                    matches!(&error, CanvasError::NotTextNode(_)),
                    "{case_id}: expected non-text node error, received {error}"
                ),
                Some("text_content_unavailable") => assert!(
                    matches!(&error, CanvasError::TextContentUnavailable(_)),
                    "{case_id}: expected unavailable text error, received {error}"
                ),
                other => panic!("{case_id}: unsupported expected error {other:?}"),
            }
            assert_eq!(
                document, original,
                "{case_id}: failed extraction is immutable"
            );
        }
    }

    #[test]
    fn invalid_text_card_edits_fail_without_mutating_the_document() {
        let fixture: Value = serde_json::from_str(C06_TEXT_CARD_FIXTURE)
            .expect("C06 text-card fixture must be JSON");
        let cases = fixture["invalid_edits"]
            .as_array()
            .expect("C06 text-card fixture must contain invalid edits");
        assert!(!cases.is_empty());

        for case in cases {
            let case_id = case["id"]
                .as_str()
                .expect("each invalid C06 text-card edit must have an id");
            let source = serde_json::to_vec(&case["before"])
                .unwrap_or_else(|error| panic!("{case_id}: before document must encode: {error}"));
            let mut document = parse_canvas(&source)
                .unwrap_or_else(|error| panic!("{case_id}: before document must parse: {error}"));
            let original = document.clone();
            let error = document
                .edit_text_node(
                    case["node_id"]
                        .as_str()
                        .unwrap_or_else(|| panic!("{case_id}: node_id must be a string")),
                    "must not be applied",
                )
                .expect_err("invalid C06 text-card edit must fail");

            match case["error"].as_str() {
                Some("node_not_found") => assert!(
                    matches!(&error, CanvasError::NodeNotFound(_)),
                    "{case_id}: expected missing node error, received {error}"
                ),
                Some("ambiguous_node_id") => assert!(
                    matches!(&error, CanvasError::AmbiguousNodeId(_)),
                    "{case_id}: expected ambiguous ID error, received {error}"
                ),
                Some("not_text_node") => assert!(
                    matches!(&error, CanvasError::NotTextNode(_)),
                    "{case_id}: expected non-text node error, received {error}"
                ),
                other => panic!("{case_id}: unsupported expected error {other:?}"),
            }
            assert_eq!(document, original, "{case_id}: failure is non-mutating");
        }
    }
}
