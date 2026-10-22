//! Source-preserving frontmatter property access for note editors.
//!
//! Reads list the simple top-level properties of a note, and edits go through the document
//! layer's span-based renderer so every byte outside the edited value stays unchanged.

use openobsidian_doc::MarkdownSource;

/// One top-level frontmatter property as written in the note.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NoteProperty {
    pub key: String,
    /// The value's source text, trimmed.
    pub value: String,
}

/// Lists the supported top-level properties of `text` in source order.
pub fn note_properties(text: &str) -> Vec<NoteProperty> {
    let Ok(source) = MarkdownSource::parse(text.as_bytes().to_vec()) else {
        return Vec::new();
    };
    source
        .frontmatter_properties()
        .into_iter()
        .filter_map(|property| {
            let value = text.get(property.value_span.start..property.value_span.end)?;
            Some(NoteProperty {
                key: property.key,
                value: value.trim().to_owned(),
            })
        })
        .collect()
}

/// Returns `text` with the value of property `key` replaced by `raw_value`.
///
/// Fails closed with a readable message when the property is not an editable inline value.
pub fn set_note_property(text: &str, key: &str, raw_value: &str) -> Result<String, String> {
    let source =
        MarkdownSource::parse(text.as_bytes().to_vec()).map_err(|error| error.to_string())?;
    let bytes = source
        .render_property_edit(key, raw_value)
        .map_err(|error| error.to_string())?;
    String::from_utf8(bytes).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOTE: &str = "---\ntitle: Old\nstatus: draft\n---\nBody text\n";

    #[test]
    fn lists_and_edits_inline_properties_without_touching_other_bytes() {
        let properties = note_properties(NOTE);
        let keys: Vec<&str> = properties.iter().map(|p| p.key.as_str()).collect();
        assert_eq!(keys, vec!["title", "status"]);
        assert_eq!(properties[0].value, "Old");

        let edited = set_note_property(NOTE, "status", "done").expect("edit renders");
        assert_eq!(edited, "---\ntitle: Old\nstatus: done\n---\nBody text\n");
    }

    #[test]
    fn missing_property_and_missing_frontmatter_fail_closed() {
        assert!(set_note_property(NOTE, "absent", "x").is_err());
        assert!(note_properties("no frontmatter\n").is_empty());
        assert!(set_note_property("no frontmatter\n", "a", "b").is_err());
    }
}
