//! Read-only projection of `.obsidian/bookmarks.json`.
//!
//! Only the fields the workspace shows are read. Groups are flattened into `Group / Title`
//! labels, and entries that are not files (folders, searches, URLs) carry no openable path.

use serde_json::Value;

/// Maximum nesting of bookmark groups that is followed.
pub const MAX_BOOKMARK_DEPTH: usize = 8;
/// Maximum bookmarks returned.
pub const MAX_BOOKMARKS: usize = 1_000;

/// One flattened bookmark.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Bookmark {
    /// Display label, including group names.
    pub title: String,
    /// Vault-relative slash path when the bookmark points at a file.
    pub path: Option<String>,
}

/// Parses the bytes of a `bookmarks.json` file. Malformed input yields no bookmarks.
pub fn parse_bookmarks(bytes: &[u8]) -> Vec<Bookmark> {
    let mut out = Vec::new();
    if let Ok(value) = serde_json::from_slice::<Value>(bytes)
        && let Some(items) = value.get("items").and_then(Value::as_array)
    {
        collect(items, "", 0, &mut out);
    }
    out
}

fn collect(items: &[Value], prefix: &str, depth: usize, out: &mut Vec<Bookmark>) {
    for item in items {
        if out.len() >= MAX_BOOKMARKS {
            return;
        }
        let text = |key: &str| {
            item.get(key)
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
        };
        let kind = text("type").unwrap_or("");
        if kind == "group" {
            if depth < MAX_BOOKMARK_DEPTH
                && let Some(children) = item.get("items").and_then(Value::as_array)
            {
                let name = text("title").unwrap_or("Group");
                collect(children, &format!("{prefix}{name} / "), depth + 1, out);
            }
            continue;
        }
        let label = text("title")
            .or_else(|| text("path"))
            .or_else(|| text("query"))
            .or_else(|| text("url"));
        let Some(label) = label else {
            continue;
        };
        let path = if kind == "file" {
            text("path").map(str::to_owned)
        } else {
            None
        };
        out.push(Bookmark {
            title: format!("{prefix}{label}"),
            path,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flattens_groups_and_marks_only_files_openable() {
        let json = br#"{"items":[
            {"type":"file","path":"a/b.md","title":"B"},
            {"type":"group","title":"G","items":[
                {"type":"file","path":"c.md"},
                {"type":"search","query":"todo"},
                {"type":"folder","path":"f"}]},
            {"type":"url","url":"https://example.com"},
            {"type":"file"}]}"#;
        let bookmarks = parse_bookmarks(json);
        assert_eq!(
            bookmarks,
            vec![
                Bookmark {
                    title: "B".into(),
                    path: Some("a/b.md".into())
                },
                Bookmark {
                    title: "G / c.md".into(),
                    path: Some("c.md".into())
                },
                Bookmark {
                    title: "G / todo".into(),
                    path: None
                },
                Bookmark {
                    title: "G / f".into(),
                    path: None
                },
                Bookmark {
                    title: "https://example.com".into(),
                    path: None
                },
            ]
        );
    }

    #[test]
    fn malformed_json_is_empty() {
        assert!(parse_bookmarks(b"{not json").is_empty());
        assert!(parse_bookmarks(b"[]").is_empty());
    }
}
