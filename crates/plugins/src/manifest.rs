//! Typed, non-panicking parsing of Obsidian plugin `manifest.json` files.
//!
//! Parsing is pure: it takes bytes already read by the caller. Malformed input never
//! panics and never silently disappears; every deviation is returned as a visible
//! [`ManifestIssue`]. Fields this crate does not model are preserved verbatim in
//! [`PluginManifest::extra`] so a later writer or report cannot lose them.

use serde_json::{Map, Value};

/// Default maximum JSON nesting depth accepted in a manifest.
pub const DEFAULT_MAX_MANIFEST_DEPTH: usize = 16;

const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

/// Severity of a manifest issue.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IssueSeverity {
    /// The manifest cannot be used as a plugin description.
    Error,
    /// The manifest is usable but a field deviates from the expected shape.
    Warning,
}

/// A visible problem found while parsing a manifest.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ManifestIssue {
    /// Whether the issue prevents the manifest from being used.
    pub severity: IssueSeverity,
    /// The manifest field involved, when the issue concerns one field.
    pub field: Option<String>,
    /// Human-readable description suitable for display.
    pub message: String,
}

impl ManifestIssue {
    fn error(field: Option<&str>, message: impl Into<String>) -> Self {
        Self {
            severity: IssueSeverity::Error,
            field: field.map(str::to_owned),
            message: message.into(),
        }
    }

    fn warning(field: &str, message: impl Into<String>) -> Self {
        Self {
            severity: IssueSeverity::Warning,
            field: Some(field.to_owned()),
            message: message.into(),
        }
    }
}

/// A parsed Obsidian plugin manifest.
#[derive(Clone, Debug, PartialEq)]
pub struct PluginManifest {
    /// Plugin identifier (`id`); required.
    pub id: String,
    /// Display name (`name`); required.
    pub name: String,
    /// Plugin version (`version`); required.
    pub version: String,
    /// Minimum Obsidian version (`minAppVersion`).
    pub min_app_version: Option<String>,
    /// Plugin description (`description`).
    pub description: Option<String>,
    /// Author name (`author`).
    pub author: Option<String>,
    /// Author URL (`authorUrl`).
    pub author_url: Option<String>,
    /// Funding information (`fundingUrl`), a string or an object, kept as raw JSON.
    pub funding_url: Option<Value>,
    /// Whether the plugin declares itself desktop-only (`isDesktopOnly`); false when absent.
    pub is_desktop_only: bool,
    /// Every field not modelled above, preserved unchanged.
    pub extra: Map<String, Value>,
}

/// Outcome of parsing a manifest: the manifest when usable, plus all issues found.
#[derive(Clone, Debug, PartialEq)]
pub struct ManifestParse {
    /// The parsed manifest; `None` when any [`IssueSeverity::Error`] issue was found.
    pub manifest: Option<PluginManifest>,
    /// All issues in discovery order.
    pub issues: Vec<ManifestIssue>,
}

/// Parses manifest bytes, tolerating a leading UTF-8 byte-order mark.
///
/// `max_depth` bounds JSON nesting; deeper documents are rejected with an error issue.
pub fn parse_manifest(bytes: &[u8], max_depth: usize) -> ManifestParse {
    let body = bytes.strip_prefix(UTF8_BOM).unwrap_or(bytes);
    let mut issues = Vec::new();
    let value = match serde_json::from_slice::<Value>(body) {
        Ok(value) => value,
        Err(error) => {
            issues.push(ManifestIssue::error(
                None,
                format!("manifest is not valid JSON: {error}"),
            ));
            return ManifestParse {
                manifest: None,
                issues,
            };
        }
    };
    if nesting_depth(&value) > max_depth {
        issues.push(ManifestIssue::error(
            None,
            format!("manifest nesting exceeds the limit of {max_depth}"),
        ));
        return ManifestParse {
            manifest: None,
            issues,
        };
    }
    let Value::Object(mut object) = value else {
        issues.push(ManifestIssue::error(None, "manifest must be a JSON object"));
        return ManifestParse {
            manifest: None,
            issues,
        };
    };

    let id = take_string(&mut object, "id", true, &mut issues);
    let name = take_string(&mut object, "name", true, &mut issues);
    let version = take_string(&mut object, "version", true, &mut issues);
    let min_app_version = take_string(&mut object, "minAppVersion", false, &mut issues);
    let description = take_string(&mut object, "description", false, &mut issues);
    let author = take_string(&mut object, "author", false, &mut issues);
    let author_url = take_string(&mut object, "authorUrl", false, &mut issues);
    let funding_url = take_funding(&mut object, &mut issues);
    let is_desktop_only = take_bool(&mut object, "isDesktopOnly", &mut issues);

    let manifest = match (id, name, version) {
        (Some(id), Some(name), Some(version)) => Some(PluginManifest {
            id,
            name,
            version,
            min_app_version,
            description,
            author,
            author_url,
            funding_url,
            is_desktop_only,
            extra: object,
        }),
        _ => None,
    };
    ManifestParse { manifest, issues }
}

/// Returns the nesting depth of a JSON value; scalars have depth 1.
fn nesting_depth(value: &Value) -> usize {
    match value {
        Value::Array(items) => 1 + items.iter().map(nesting_depth).max().unwrap_or(0),
        Value::Object(map) => 1 + map.values().map(nesting_depth).max().unwrap_or(0),
        _ => 1,
    }
}

/// Removes `key` and returns it as a non-empty string, recording issues otherwise.
///
/// An optional field of the wrong type is put back into the object so it is preserved.
fn take_string(
    object: &mut Map<String, Value>,
    key: &'static str,
    required: bool,
    issues: &mut Vec<ManifestIssue>,
) -> Option<String> {
    let issue = |message: String| {
        if required {
            ManifestIssue::error(Some(key), message)
        } else {
            ManifestIssue::warning(key, message)
        }
    };
    match object.remove(key) {
        None => {
            if required {
                issues.push(issue(format!("required field `{key}` is missing")));
            }
            None
        }
        Some(Value::String(text)) if !text.trim().is_empty() => Some(text),
        Some(Value::String(_)) => {
            issues.push(issue(format!("field `{key}` is empty")));
            None
        }
        Some(other) => {
            issues.push(issue(format!("field `{key}` must be a string")));
            if !required {
                object.insert(key.to_owned(), other);
            }
            None
        }
    }
}

/// Removes `fundingUrl`, accepting a string or an object and warning on other types.
fn take_funding(object: &mut Map<String, Value>, issues: &mut Vec<ManifestIssue>) -> Option<Value> {
    match object.remove("fundingUrl") {
        None => None,
        Some(value @ (Value::String(_) | Value::Object(_))) => Some(value),
        Some(other) => {
            issues.push(ManifestIssue::warning(
                "fundingUrl",
                "field `fundingUrl` must be a string or an object",
            ));
            object.insert("fundingUrl".to_owned(), other);
            None
        }
    }
}

/// Removes a boolean field, defaulting to false and warning on a wrong type.
fn take_bool(
    object: &mut Map<String, Value>,
    key: &'static str,
    issues: &mut Vec<ManifestIssue>,
) -> bool {
    match object.remove(key) {
        None => false,
        Some(Value::Bool(flag)) => flag,
        Some(other) => {
            issues.push(ManifestIssue::warning(
                key,
                format!("field `{key}` must be a boolean"),
            ));
            object.insert(key.to_owned(), other);
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(text: &str) -> ManifestParse {
        parse_manifest(text.as_bytes(), DEFAULT_MAX_MANIFEST_DEPTH)
    }

    #[test]
    fn parses_a_complete_manifest() {
        let result = parse(
            r#"{"id":"calendar","name":"Calendar","version":"1.5.10","minAppVersion":"0.9.11",
            "description":"d","author":"Liam","authorUrl":"https://x","fundingUrl":"https://f",
            "isDesktopOnly":true}"#,
        );
        assert!(result.issues.is_empty());
        let manifest = result.manifest.expect("manifest");
        assert_eq!(manifest.id, "calendar");
        assert_eq!(manifest.name, "Calendar");
        assert_eq!(manifest.version, "1.5.10");
        assert_eq!(manifest.min_app_version.as_deref(), Some("0.9.11"));
        assert_eq!(manifest.author.as_deref(), Some("Liam"));
        assert_eq!(manifest.author_url.as_deref(), Some("https://x"));
        assert_eq!(
            manifest.funding_url,
            Some(Value::String("https://f".into()))
        );
        assert!(manifest.is_desktop_only);
        assert!(manifest.extra.is_empty());
    }

    #[test]
    fn minimal_manifest_defaults_optional_fields() {
        let manifest = parse(r#"{"id":"a","name":"A","version":"1"}"#)
            .manifest
            .expect("manifest");
        assert_eq!(manifest.min_app_version, None);
        assert!(!manifest.is_desktop_only);
    }

    #[test]
    fn unknown_fields_are_preserved() {
        let result = parse(r#"{"id":"a","name":"A","version":"1","custom":{"k":[1,2]},"n":3}"#);
        let manifest = result.manifest.expect("manifest");
        assert!(result.issues.is_empty());
        assert_eq!(manifest.extra.len(), 2);
        assert_eq!(manifest.extra["n"], Value::from(3));
        assert_eq!(manifest.extra["custom"]["k"][1], Value::from(2));
    }

    #[test]
    fn utf8_bom_is_tolerated() {
        let mut bytes = UTF8_BOM.to_vec();
        bytes.extend_from_slice(br#"{"id":"a","name":"A","version":"1"}"#);
        let result = parse_manifest(&bytes, DEFAULT_MAX_MANIFEST_DEPTH);
        assert!(result.manifest.is_some());
        assert!(result.issues.is_empty());
    }

    #[test]
    fn missing_required_fields_are_each_reported() {
        let result = parse(r#"{"description":"x"}"#);
        assert!(result.manifest.is_none());
        let fields: Vec<_> = result
            .issues
            .iter()
            .filter_map(|issue| issue.field.as_deref())
            .collect();
        assert_eq!(fields, ["id", "name", "version"]);
        assert!(
            result
                .issues
                .iter()
                .all(|issue| issue.severity == IssueSeverity::Error)
        );
    }

    #[test]
    fn empty_and_mistyped_required_fields_are_errors() {
        let result = parse(r#"{"id":"  ","name":5,"version":"1"}"#);
        assert!(result.manifest.is_none());
        assert_eq!(result.issues.len(), 2);
    }

    #[test]
    fn mistyped_optional_fields_warn_and_are_preserved() {
        let result = parse(
            r#"{"id":"a","name":"A","version":"1","author":7,"isDesktopOnly":"yes","fundingUrl":3}"#,
        );
        let manifest = result.manifest.expect("manifest");
        assert_eq!(result.issues.len(), 3);
        assert!(
            result
                .issues
                .iter()
                .all(|issue| issue.severity == IssueSeverity::Warning)
        );
        assert_eq!(manifest.author, None);
        assert!(!manifest.is_desktop_only);
        assert_eq!(manifest.extra["author"], Value::from(7));
        assert_eq!(manifest.extra["isDesktopOnly"], Value::from("yes"));
        assert_eq!(manifest.extra["fundingUrl"], Value::from(3));
    }

    #[test]
    fn funding_object_is_accepted() {
        let result =
            parse(r#"{"id":"a","name":"A","version":"1","fundingUrl":{"Ko-fi":"https://k"}}"#);
        assert!(result.issues.is_empty());
        assert!(result.manifest.expect("manifest").funding_url.is_some());
    }

    #[test]
    fn invalid_json_is_an_issue_not_a_panic() {
        for input in ["", "{", "not json", "{\"id\":", "\u{feff}"] {
            let result = parse(input);
            assert!(result.manifest.is_none(), "{input:?}");
            assert_eq!(result.issues.len(), 1, "{input:?}");
        }
        let invalid_utf8 = parse_manifest(b"{\"id\":\"\xff\"}", DEFAULT_MAX_MANIFEST_DEPTH);
        assert!(invalid_utf8.manifest.is_none());
        assert_eq!(invalid_utf8.issues.len(), 1);
    }

    #[test]
    fn non_object_roots_are_rejected() {
        for input in ["[]", "42", "\"text\"", "null", "true"] {
            let result = parse(input);
            assert!(result.manifest.is_none(), "{input}");
            assert_eq!(result.issues.len(), 1, "{input}");
        }
    }

    #[test]
    fn excessive_nesting_is_rejected() {
        let nested = format!(
            r#"{{"id":"a","name":"A","version":"1","x":{}1{}}}"#,
            "[".repeat(20),
            "]".repeat(20)
        );
        let result = parse(&nested);
        assert!(result.manifest.is_none());
        assert!(result.issues[0].message.contains("nesting"));

        let shallow = parse_manifest(nested.as_bytes(), 64);
        assert!(shallow.manifest.is_some());
    }

    #[test]
    fn extremely_deep_input_is_reported_by_the_json_parser() {
        let deep = format!("{}{}", "[".repeat(10_000), "]".repeat(10_000));
        let result = parse(&deep);
        assert!(result.manifest.is_none());
        assert_eq!(result.issues.len(), 1);
    }

    #[test]
    fn depth_counts_scalars_and_containers() {
        assert_eq!(nesting_depth(&Value::Null), 1);
        assert_eq!(nesting_depth(&serde_json::json!({})), 1);
        assert_eq!(nesting_depth(&serde_json::json!({"a": [1]})), 3);
    }
}
