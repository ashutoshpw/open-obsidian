//! Bounded, read-only evaluation of a Bases file against a vault snapshot.

use openobsidian_doc::{
    BaseDocument, BaseEvaluation, BaseParseError, BaseRow, MarkdownSource, YamlMappingEntry,
    YamlValue, evaluate_base, evaluate_base_by_view_index, parse_base,
};
use openobsidian_vault::{
    VaultError, VaultRoot, VaultSnapshot, VaultSnapshotEntry, VaultSnapshotEntryKind,
};
use serde_json::{Map, Number, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::str::FromStr;

/// Maximum `.base` source parsed by the engine service.
pub const MAX_BASE_FILE_SOURCE_BYTES: usize = 4 * 1024 * 1024;
/// Maximum Markdown source prefix read for each note's frontmatter.
pub const MAX_BASE_NOTE_SOURCE_BYTES: usize = 512 * 1024;
/// Maximum number of Markdown notes collected for one evaluation.
pub const MAX_BASE_NOTE_COUNT: usize = 10_000;
/// Maximum number of `.base` paths returned by the discovery API.
pub const MAX_BASE_FILE_COUNT: usize = 10_000;
/// Maximum combined `.base` and Markdown source bytes read for one evaluation.
pub const MAX_BASE_TOTAL_SOURCE_BYTES: usize = 16 * 1024 * 1024;

/// A path-attributed problem that prevented complete note collection.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BaseCollectionIssue {
    /// Vault-relative path of the note that could not be projected.
    pub relative_path: PathBuf,
    /// Why the note was skipped or omitted.
    pub message: String,
}

/// One regular `.base` definition discovered in a vault snapshot.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BaseFilePath {
    /// Vault-relative path to the definition.
    pub relative_path: PathBuf,
    /// SHA-256 of the definition in the captured snapshot.
    pub revision_sha256: String,
    /// Complete source size in bytes.
    pub size_bytes: u64,
}

/// Bounded `.base` discovery result from one stable vault snapshot.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BaseFileListing {
    /// Vault snapshot hash shared by every returned path.
    pub snapshot_sha256: String,
    /// Sorted `.base` paths; symlinks are omitted.
    pub files: Vec<BaseFilePath>,
    /// False when the vault contains more than the listing bound.
    pub complete: bool,
}

/// Why bounded `.base` discovery could not return a stable snapshot.
#[derive(Debug, thiserror::Error)]
pub enum BaseFileListingError {
    /// A confined vault operation failed.
    #[error(transparent)]
    Vault(#[from] VaultError),
    /// The vault changed while the listing was being prepared.
    #[error("vault changed while Bases files were being listed")]
    SnapshotChanged,
}

/// One stable, read-only evaluation of a `.base` file over bounded note metadata.
#[derive(Clone, Debug, PartialEq)]
pub struct BaseFileEvaluation {
    /// The normalized vault-relative Bases path.
    pub relative_path: PathBuf,
    /// SHA-256 of the complete `.base` source used for parsing.
    pub base_revision_sha256: String,
    /// Vault content hash captured before collecting sources.
    pub snapshot_before_sha256: String,
    /// Vault content hash captured after collecting and evaluating sources.
    pub snapshot_after_sha256: String,
    /// Parsed Bases definition retaining its original source.
    pub base: BaseDocument,
    /// Evaluation of the requested view over all safely collected note rows.
    pub evaluation: BaseEvaluation,
    /// Notes omitted from the evaluation because their metadata was not safely representable.
    pub collection_issues: Vec<BaseCollectionIssue>,
    /// Whether every candidate note was safely accounted for within the collection bounds.
    pub complete: bool,
}

impl BaseFileEvaluation {
    /// Returns the total evaluator and collection issue count.
    pub fn issue_count(&self) -> usize {
        self.evaluation.issues.len() + self.collection_issues.len()
    }
}

/// Why a Bases file could not be evaluated safely.
#[derive(Debug, thiserror::Error)]
pub enum BaseFileEvaluationError {
    /// The requested path does not have a `.base` extension.
    #[error("vault path is not a Bases file: {0}")]
    NotBaseFile(PathBuf),
    /// The complete Bases source exceeds the supported bound.
    #[error("Bases source exceeds the {limit_bytes}-byte limit: {relative_path}")]
    TooLarge {
        relative_path: PathBuf,
        limit_bytes: usize,
    },
    /// The `.base` source could not be parsed.
    #[error(transparent)]
    Parse(#[from] openobsidian_doc::BaseParseError),
    /// A confined vault operation failed.
    #[error(transparent)]
    Vault(#[from] VaultError),
    /// The vault changed while the evaluation was being prepared.
    #[error("vault changed while Bases evaluation was being prepared")]
    SnapshotChanged,
}

/// Discover `.base` paths without walking the vault from a UI caller.
pub(crate) fn list_base_files(root: &VaultRoot) -> Result<BaseFileListing, BaseFileListingError> {
    let before = root.snapshot().map_err(map_listing_vault_error)?;
    let (files, complete) = base_paths_from_snapshot(&before);
    let after = root.snapshot().map_err(map_listing_vault_error)?;
    if before.revision_sha256 != after.revision_sha256 {
        return Err(BaseFileListingError::SnapshotChanged);
    }
    Ok(BaseFileListing {
        snapshot_sha256: before.revision_sha256,
        files,
        complete,
    })
}

fn base_paths_from_snapshot(snapshot: &VaultSnapshot) -> (Vec<BaseFilePath>, bool) {
    let mut base_count = 0;
    let mut files = Vec::with_capacity(snapshot.entries.len().min(MAX_BASE_FILE_COUNT));
    for entry in &snapshot.entries {
        if entry.kind != VaultSnapshotEntryKind::File
            || !entry
                .relative_path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("base"))
        {
            continue;
        }
        base_count += 1;
        if files.len() < MAX_BASE_FILE_COUNT {
            files.push(BaseFilePath {
                relative_path: entry.relative_path.clone(),
                revision_sha256: entry.revision_sha256.clone(),
                size_bytes: entry.size_bytes,
            });
        }
    }
    (files, base_count <= MAX_BASE_FILE_COUNT)
}

/// Evaluate one `.base` file against a bounded, fresh Markdown listing.
pub(crate) fn evaluate_base_file(
    root: &VaultRoot,
    relative_path: &Path,
    view_name: &str,
) -> Result<BaseFileEvaluation, BaseFileEvaluationError> {
    evaluate_base_file_with_selector(root, relative_path, BaseViewSelector::Name(view_name))
}

pub(crate) fn evaluate_base_file_by_view_index(
    root: &VaultRoot,
    relative_path: &Path,
    view_index: usize,
) -> Result<BaseFileEvaluation, BaseFileEvaluationError> {
    evaluate_base_file_with_selector(root, relative_path, BaseViewSelector::Index(view_index))
}

enum BaseViewSelector<'a> {
    Name(&'a str),
    Index(usize),
}

fn evaluate_base_file_with_selector(
    root: &VaultRoot,
    relative_path: &Path,
    selector: BaseViewSelector<'_>,
) -> Result<BaseFileEvaluation, BaseFileEvaluationError> {
    if !relative_path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("base"))
    {
        return Err(BaseFileEvaluationError::NotBaseFile(
            relative_path.to_path_buf(),
        ));
    }

    let before = root.snapshot().map_err(map_vault_error)?;
    let before_entries = snapshot_entry_map(&before);
    let Some(base_snapshot_entry) = before_entries.get(relative_path) else {
        // Read through VaultRoot below to preserve its precise missing-file and symlink errors.
        let preview = root
            .read_preview_with_limit(relative_path, MAX_BASE_FILE_SOURCE_BYTES)
            .map_err(map_vault_error)?;
        if preview.truncated {
            return Err(BaseFileEvaluationError::TooLarge {
                relative_path: relative_path.to_path_buf(),
                limit_bytes: MAX_BASE_FILE_SOURCE_BYTES,
            });
        }
        return Err(BaseFileEvaluationError::SnapshotChanged);
    };

    if base_snapshot_entry.kind == VaultSnapshotEntryKind::File
        && base_snapshot_entry.size_bytes > MAX_BASE_FILE_SOURCE_BYTES as u64
    {
        return Err(BaseFileEvaluationError::TooLarge {
            relative_path: relative_path.to_path_buf(),
            limit_bytes: MAX_BASE_FILE_SOURCE_BYTES,
        });
    }

    let base_preview = root
        .read_preview_with_limit(relative_path, MAX_BASE_FILE_SOURCE_BYTES)
        .map_err(map_vault_error)?;
    if base_preview.truncated {
        return Err(BaseFileEvaluationError::TooLarge {
            relative_path: relative_path.to_path_buf(),
            limit_bytes: MAX_BASE_FILE_SOURCE_BYTES,
        });
    }
    let base_revision_sha256 = base_preview
        .revision_sha256
        .ok_or(BaseFileEvaluationError::SnapshotChanged)?;
    if base_revision_sha256 != base_snapshot_entry.revision_sha256 {
        return Err(BaseFileEvaluationError::SnapshotChanged);
    }
    let base = parse_base(base_preview.source.as_bytes())?;
    if let BaseViewSelector::Index(view_index) = &selector {
        let view_count = base.views().len();
        if *view_index >= view_count {
            return Err(BaseParseError::InvalidViewIndex {
                index: *view_index,
                view_count,
            }
            .into());
        }
    }

    // Take a fresh listing for every call; the session's cached note list can be stale.
    let notes = root.scan_markdown().map_err(map_vault_error)?;
    let mut total_source_bytes = base_preview.source.as_bytes().len();
    let mut rows = Vec::new();
    let mut collection_issues = Vec::new();
    let mut complete = true;

    for (index, note) in notes.iter().enumerate() {
        if index >= MAX_BASE_NOTE_COUNT {
            collection_issues.push(BaseCollectionIssue {
                relative_path: note.relative_path.clone(),
                message: format!(
                    "note collection exceeds the {MAX_BASE_NOTE_COUNT}-note limit; remaining notes were omitted"
                ),
            });
            complete = false;
            break;
        }

        let Some(note_snapshot_entry) = before_entries.get(&note.relative_path) else {
            return Err(BaseFileEvaluationError::SnapshotChanged);
        };
        if note_snapshot_entry.kind != VaultSnapshotEntryKind::File {
            return Err(BaseFileEvaluationError::SnapshotChanged);
        }

        let remaining_bytes = MAX_BASE_TOTAL_SOURCE_BYTES.saturating_sub(total_source_bytes);
        if remaining_bytes == 0 {
            collection_issues.push(BaseCollectionIssue {
                relative_path: note.relative_path.clone(),
                message: format!(
                    "note collection exceeds the {MAX_BASE_TOTAL_SOURCE_BYTES}-byte source limit; this and remaining notes were omitted"
                ),
            });
            complete = false;
            break;
        }

        let read_limit = MAX_BASE_NOTE_SOURCE_BYTES.min(remaining_bytes);
        let note_preview = match root.read_preview_with_limit(&note.relative_path, read_limit) {
            Ok(preview) => preview,
            Err(error) => return Err(map_vault_error(error)),
        };
        if note_preview.total_size_bytes != note_snapshot_entry.size_bytes {
            return Err(BaseFileEvaluationError::SnapshotChanged);
        }
        total_source_bytes = total_source_bytes
            .checked_add(note_preview.source.as_bytes().len())
            .ok_or(BaseFileEvaluationError::SnapshotChanged)?;
        if let Some(revision) = note_preview.revision_sha256.as_deref()
            && revision != note_snapshot_entry.revision_sha256
        {
            return Err(BaseFileEvaluationError::SnapshotChanged);
        }

        match note_properties(note_preview.source.as_bytes(), note_preview.truncated) {
            Ok(properties) => {
                let Some(path) = note.relative_path.to_str() else {
                    collection_issues.push(BaseCollectionIssue {
                        relative_path: note.relative_path.clone(),
                        message: "note path cannot be represented as UTF-8 for Bases evaluation"
                            .to_owned(),
                    });
                    complete = false;
                    continue;
                };
                rows.push(BaseRow {
                    path: path.replace('\\', "/"),
                    properties,
                });
            }
            Err(message) => {
                collection_issues.push(BaseCollectionIssue {
                    relative_path: note.relative_path.clone(),
                    message,
                });
                complete = false;
            }
        }
    }

    let evaluation = match selector {
        BaseViewSelector::Name(view_name) => evaluate_base(&base, view_name, &rows)?,
        BaseViewSelector::Index(view_index) => {
            evaluate_base_by_view_index(&base, view_index, &rows)?
        }
    };
    let after = root.snapshot().map_err(map_vault_error)?;
    if before.revision_sha256 != after.revision_sha256 {
        return Err(BaseFileEvaluationError::SnapshotChanged);
    }

    Ok(BaseFileEvaluation {
        relative_path: relative_path.to_path_buf(),
        base_revision_sha256,
        snapshot_before_sha256: before.revision_sha256,
        snapshot_after_sha256: after.revision_sha256,
        base,
        evaluation,
        collection_issues,
        complete,
    })
}

fn snapshot_entry_map(snapshot: &VaultSnapshot) -> HashMap<PathBuf, &VaultSnapshotEntry> {
    snapshot
        .entries
        .iter()
        .map(|entry| (entry.relative_path.clone(), entry))
        .collect()
}

fn map_vault_error(error: VaultError) -> BaseFileEvaluationError {
    match error {
        VaultError::SnapshotChanged => BaseFileEvaluationError::SnapshotChanged,
        error => BaseFileEvaluationError::Vault(error),
    }
}

fn map_listing_vault_error(error: VaultError) -> BaseFileListingError {
    match error {
        VaultError::SnapshotChanged => BaseFileListingError::SnapshotChanged,
        error => BaseFileListingError::Vault(error),
    }
}

fn note_properties(source_bytes: &[u8], truncated: bool) -> Result<Map<String, Value>, String> {
    let source = match MarkdownSource::parse(source_bytes.to_vec()) {
        Ok(source) => source,
        Err(error) if truncated && error.error_len().is_none() => {
            let valid_bytes = source_bytes.get(..error.valid_up_to()).ok_or_else(|| {
                "Markdown note contains invalid UTF-8 in its bounded source prefix".to_owned()
            })?;
            MarkdownSource::parse(valid_bytes.to_vec()).map_err(|_| {
                "Markdown note contains invalid UTF-8 in its bounded source prefix".to_owned()
            })?
        }
        Err(_) => {
            return Err("Markdown note contains invalid UTF-8 in its bounded source prefix".into());
        }
    };

    if source.frontmatter_bounds().is_none() {
        if has_frontmatter_opener(source.as_bytes()) {
            return Err(
                "Markdown note has an unclosed frontmatter block in the bounded prefix".into(),
            );
        }
        // A note without frontmatter has a complete empty property map, even when its body is
        // longer than the bounded read prefix.
        return Ok(Map::new());
    }

    let parsed = source.parse_frontmatter_yaml();
    if !parsed.issues.is_empty() {
        return Err(format!(
            "Markdown frontmatter is malformed or unsupported: {}",
            parsed.issues.join("; ")
        ));
    }

    yaml_mapping_to_json(&parsed.entries)
        .map_err(|message| format!("Markdown frontmatter cannot be represented safely: {message}"))
}

fn has_frontmatter_opener(source: &[u8]) -> bool {
    let start = if source.starts_with(&[0xef, 0xbb, 0xbf]) {
        3
    } else {
        0
    };
    source.get(start..start + 3) == Some(&b"---"[..])
        && source
            .get(start + 3)
            .is_some_and(|byte| matches!(*byte, b'\r' | b'\n'))
}

fn yaml_mapping_to_json(entries: &[YamlMappingEntry]) -> Result<Map<String, Value>, String> {
    let mut properties = Map::new();
    for entry in entries {
        if properties.contains_key(&entry.key) {
            return Err(format!("duplicate mapping key {:?}", entry.key));
        }
        properties.insert(entry.key.clone(), yaml_value_to_json(&entry.value)?);
    }
    Ok(properties)
}

fn yaml_value_to_json(value: &YamlValue) -> Result<Value, String> {
    match value {
        YamlValue::Null => Ok(Value::Null),
        YamlValue::Boolean(value) => Ok(Value::Bool(*value)),
        YamlValue::Number(value) => Number::from_str(value)
            .map(Value::Number)
            .map_err(|_| format!("number {value:?} is not JSON-compatible")),
        YamlValue::String(value) => Ok(Value::String(value.clone())),
        YamlValue::Sequence(values) => values
            .iter()
            .map(yaml_value_to_json)
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        YamlValue::Mapping(entries) => yaml_mapping_to_json(entries).map(Value::Object),
        YamlValue::Unsupported(_) => Err("unsupported YAML value".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value as JsonValue;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    const BASE_VAULT_EVALUATION_FIXTURE: &str =
        include_str!("../../../fixtures/c07-base-vault-evaluation.json");
    const SIMPLE_BASE: &str = "{\"version\":1,\"views\":[{\"type\":\"table\",\"name\":\"All\"}]}";
    static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(0);

    struct TempTree(PathBuf);

    impl TempTree {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "openobsidian-bases-engine-{}-{}",
                std::process::id(),
                NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed),
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn layout(&self) -> (PathBuf, PathBuf) {
            let vault = self.0.join("vault");
            let app_data = self.0.join("app-data");
            fs::create_dir_all(&vault).unwrap();
            fs::create_dir_all(&app_data).unwrap();
            (vault, app_data)
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write_file(root: &Path, relative_path: &str, source: &[u8]) {
        let path = root.join(relative_path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, source).unwrap();
    }

    fn session_for(root: &Path, app_data: &Path) -> super::super::VaultSession {
        super::super::VaultSession::open(root, app_data).unwrap()
    }

    #[test]
    fn fixture_evaluates_a_stable_vault_without_writing_sources() {
        let fixture: JsonValue = serde_json::from_str(BASE_VAULT_EVALUATION_FIXTURE)
            .expect("C07 Bases vault evaluation fixture must be valid JSON");
        assert_eq!(fixture["schema_version"], 1);
        assert_eq!(fixture["id"], "fixture:c07-base-vault-evaluation");

        let tree = TempTree::new();
        let (vault, app_data) = tree.layout();
        let base_path = fixture["base_path"].as_str().unwrap();
        write_file(
            &vault,
            base_path,
            fixture["base_source"].as_str().unwrap().as_bytes(),
        );
        for note in fixture["notes"].as_array().unwrap() {
            write_file(
                &vault,
                note["path"].as_str().unwrap(),
                note["source"].as_str().unwrap().as_bytes(),
            );
        }

        let session = session_for(&vault, &app_data);
        let root = VaultRoot::open(&vault).unwrap();
        let before = root.snapshot().unwrap();
        let result = session
            .evaluate_base_file(base_path, fixture["view"].as_str().unwrap())
            .expect("fixture Bases view must evaluate");
        let after = root.snapshot().unwrap();

        assert!(result.complete);
        assert_eq!(result.snapshot_before_sha256, before.revision_sha256);
        assert_eq!(result.snapshot_after_sha256, after.revision_sha256);
        assert_eq!(before, after, "evaluation must not write to the vault");
        let base_entry = before
            .entries
            .iter()
            .find(|entry| {
                entry.relative_path.as_path() == Path::new(base_path)
                    && entry.kind == VaultSnapshotEntryKind::File
            })
            .unwrap();
        assert_eq!(result.base_revision_sha256, base_entry.revision_sha256);
        assert_eq!(
            result
                .evaluation
                .rows
                .iter()
                .map(|row| row.path.as_str())
                .collect::<Vec<_>>(),
            fixture["expected"]["paths"]
                .as_array()
                .unwrap()
                .iter()
                .map(JsonValue::as_str)
                .collect::<Option<Vec<_>>>()
                .unwrap()
        );
        assert_eq!(
            result
                .evaluation
                .groups
                .iter()
                .map(|group| group.key.as_str())
                .collect::<Vec<_>>(),
            fixture["expected"]["groups"]
                .as_array()
                .unwrap()
                .iter()
                .map(JsonValue::as_str)
                .collect::<Option<Vec<_>>>()
                .unwrap()
        );
        assert_eq!(
            result.issue_count(),
            usize::try_from(fixture["expected"]["issue_count"].as_u64().unwrap()).unwrap()
        );
        assert!(result.collection_issues.is_empty());
    }

    #[test]
    fn session_selects_unnamed_empty_and_duplicate_views_by_index() {
        let tree = TempTree::new();
        let (vault, app_data) = tree.layout();
        let source = br#"{"version":1,"views":[{"type":"table","limit":1},{"type":"table","name":"","limit":2},{"type":"table","name":"Duplicate","limit":3},{"type":"table","name":"Duplicate","limit":4}]}"#;
        write_file(&vault, "views.base", source);
        for index in 0..4 {
            write_file(&vault, &format!("Notes/{index}.md"), b"note body\n");
        }
        let session = session_for(&vault, &app_data);

        for (view_index, expected_limit) in [1, 2, 3, 4].into_iter().enumerate() {
            let result = session
                .evaluate_base_file_by_view_index(Path::new("views.base"), view_index)
                .expect("view index must select a parsed view");
            assert_eq!(result.evaluation.view.limit, Some(expected_limit));
            assert_eq!(result.evaluation.rows.len(), expected_limit);
        }
        let explicit_empty = session
            .evaluate_base_file(Path::new("views.base"), "")
            .expect("an explicit empty name must keep name-based selection");
        assert_eq!(explicit_empty.evaluation.view.name.as_deref(), Some(""));
        assert_eq!(explicit_empty.evaluation.view.limit, Some(2));
        let first_duplicate = session
            .evaluate_base_file(Path::new("views.base"), "Duplicate")
            .expect("name lookup must retain its first duplicate behavior");
        assert_eq!(first_duplicate.evaluation.view.limit, Some(3));
    }

    #[test]
    fn base_listing_is_sorted_snapshot_bound_and_excludes_symlinks() {
        let tree = TempTree::new();
        let (vault, app_data) = tree.layout();
        write_file(&vault, "z-last.base", SIMPLE_BASE.as_bytes());
        write_file(&vault, "a-first.base", SIMPLE_BASE.as_bytes());
        write_file(&vault, "not-a-base.md", b"ignored");

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let target = tree.0.join("symlink-target.base");
            fs::write(&target, SIMPLE_BASE).unwrap();
            symlink(&target, vault.join("linked.base")).unwrap();
        }

        let session = session_for(&vault, &app_data);
        let root = VaultRoot::open(&vault).unwrap();
        let snapshot = root.snapshot().unwrap();
        let listing = session
            .list_base_files()
            .expect("base listing must be stable");

        assert!(listing.complete);
        assert_eq!(listing.snapshot_sha256, snapshot.revision_sha256);
        assert_eq!(
            listing
                .files
                .iter()
                .map(|file| file.relative_path.as_path())
                .collect::<Vec<_>>(),
            vec![Path::new("a-first.base"), Path::new("z-last.base")]
        );
    }

    #[test]
    fn base_listing_marks_the_bounded_path_count_incomplete() {
        let entries = (0..=MAX_BASE_FILE_COUNT)
            .map(|index| VaultSnapshotEntry {
                relative_path: PathBuf::from(format!("{index:05}.base")),
                kind: VaultSnapshotEntryKind::File,
                size_bytes: 0,
                revision_sha256: "0".repeat(64),
                symlink_target: None,
            })
            .collect();
        let snapshot = VaultSnapshot {
            entries,
            revision_sha256: "snapshot".to_owned(),
        };

        let (files, complete) = base_paths_from_snapshot(&snapshot);
        assert!(!complete);
        assert_eq!(files.len(), MAX_BASE_FILE_COUNT);
    }

    #[test]
    fn wrong_extension_escape_and_symlink_are_rejected() {
        let tree = TempTree::new();
        let (vault, app_data) = tree.layout();
        write_file(&vault, "ok.base", SIMPLE_BASE.as_bytes());
        let session = session_for(&vault, &app_data);

        assert!(matches!(
            session.evaluate_base_file("ok.md", "All"),
            Err(BaseFileEvaluationError::NotBaseFile(_))
        ));
        assert!(matches!(
            session.evaluate_base_file("../outside.base", "All"),
            Err(BaseFileEvaluationError::Vault(VaultError::InvalidPath))
        ));

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let outside = tree.0.join("outside.base");
            fs::write(&outside, SIMPLE_BASE).unwrap();
            symlink(&outside, vault.join("linked.base")).unwrap();
            assert!(matches!(
                session.evaluate_base_file("linked.base", "All"),
                Err(BaseFileEvaluationError::Vault(VaultError::Symlink(_)))
            ));
        }
    }

    #[test]
    fn oversized_and_unparseable_bases_return_typed_errors() {
        let tree = TempTree::new();
        let (vault, app_data) = tree.layout();
        write_file(
            &vault,
            "large.base",
            &vec![b'x'; MAX_BASE_FILE_SOURCE_BYTES + 1],
        );
        write_file(&vault, "invalid.base", b"{}");
        let session = session_for(&vault, &app_data);

        assert!(matches!(
            session.evaluate_base_file("large.base", "All"),
            Err(BaseFileEvaluationError::TooLarge { .. })
        ));
        assert!(matches!(
            session.evaluate_base_file("invalid.base", "All"),
            Err(BaseFileEvaluationError::Parse(_))
        ));
    }

    #[test]
    fn unsafe_frontmatter_is_skipped_with_path_issues_and_marks_result_incomplete() {
        let tree = TempTree::new();
        let (vault, app_data) = tree.layout();
        write_file(&vault, "all.base", SIMPLE_BASE.as_bytes());
        write_file(&vault, "Notes/invalid-utf8.md", b"---\nname: \xff\n---\n");
        write_file(&vault, "Notes/unclosed.md", b"---\nstatus: open\n");
        write_file(&vault, "Notes/malformed.md", b"---\n- not-a-mapping\n---\n");
        write_file(
            &vault,
            "Notes/unsupported.md",
            b"---\nvalue: !custom tagged\n---\n",
        );
        let session = session_for(&vault, &app_data);

        let result = session
            .evaluate_base_file("all.base", "All")
            .expect("collection issues are non-fatal");
        assert!(!result.complete);
        assert!(result.evaluation.rows.is_empty());
        assert_eq!(result.collection_issues.len(), 4);
        assert_eq!(
            result
                .collection_issues
                .iter()
                .map(|issue| issue.relative_path.as_path())
                .collect::<Vec<_>>(),
            vec![
                Path::new("Notes/invalid-utf8.md"),
                Path::new("Notes/malformed.md"),
                Path::new("Notes/unclosed.md"),
                Path::new("Notes/unsupported.md")
            ]
        );
    }

    #[test]
    fn bounded_large_note_keeps_closed_frontmatter_but_skips_open_frontmatter() {
        let tree = TempTree::new();
        let (vault, app_data) = tree.layout();
        write_file(&vault, "all.base", SIMPLE_BASE.as_bytes());
        let mut complete_frontmatter = b"---\nstatus: open\n---\n".to_vec();
        complete_frontmatter.resize(MAX_BASE_NOTE_SOURCE_BYTES + 100, b'x');
        write_file(&vault, "Notes/large-body.md", &complete_frontmatter);

        let mut open_frontmatter = b"---\nstatus: open\n".to_vec();
        open_frontmatter.resize(MAX_BASE_NOTE_SOURCE_BYTES + 100, b'x');
        write_file(&vault, "Notes/open-block.md", &open_frontmatter);

        let session = session_for(&vault, &app_data);
        let result = session
            .evaluate_base_file("all.base", "All")
            .expect("oversized note bodies are collected from bounded prefixes");
        assert!(!result.complete);
        assert_eq!(result.evaluation.rows.len(), 1);
        assert_eq!(result.evaluation.rows[0].path, "Notes/large-body.md");
        assert_eq!(result.collection_issues.len(), 1);
        assert_eq!(
            result.collection_issues[0].relative_path,
            PathBuf::from("Notes/open-block.md")
        );
    }
}
