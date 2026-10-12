//! Bounded, read-only evaluation of Bases definitions against a vault snapshot.

use openobsidian_doc::{
    BaseDocument, BaseEvaluation, BaseParseError, BaseRow, EmbeddedBaseDefinition, MarkdownSource,
    YamlMappingEntry, YamlValue, evaluate_base, evaluate_base_by_view_index, parse_base,
    parse_embedded_bases,
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

/// Embedded Bases definitions parsed from one complete Markdown note revision.
#[derive(Clone, Debug, PartialEq)]
pub struct EmbeddedBaseListing {
    /// Normalized vault-relative Markdown path.
    pub relative_path: PathBuf,
    /// SHA-256 of the complete note source used to extract these definitions.
    pub note_revision_sha256: String,
    /// Vault content hash captured before reading the note.
    pub snapshot_before_sha256: String,
    /// Vault content hash captured after parsing the note.
    pub snapshot_after_sha256: String,
    /// Embedded definitions in source order, retaining source offsets and diagnostics.
    pub definitions: Vec<EmbeddedBaseDefinition>,
}

/// One stable, read-only evaluation of an embedded Bases view.
#[derive(Clone, Debug, PartialEq)]
pub struct EmbeddedBaseEvaluation {
    /// Normalized vault-relative Markdown path.
    pub relative_path: PathBuf,
    /// SHA-256 of the complete note source used for parsing and row metadata.
    pub note_revision_sha256: String,
    /// Vault content hash captured before reading sources.
    pub snapshot_before_sha256: String,
    /// Vault content hash captured after collecting and evaluating sources.
    pub snapshot_after_sha256: String,
    /// Selected embedded definition's source-order index.
    pub definition_index: usize,
    /// Selected view's source-order index.
    pub view_index: usize,
    /// Parsed embedded definition, including its original source and source offsets.
    pub definition: EmbeddedBaseDefinition,
    /// Evaluation of the selected view over bounded note metadata.
    pub evaluation: BaseEvaluation,
    /// Notes omitted because their metadata could not be safely represented.
    pub collection_issues: Vec<BaseCollectionIssue>,
    /// Whether every candidate note was accounted for within collection bounds.
    pub complete: bool,
}

impl EmbeddedBaseEvaluation {
    /// Returns the total evaluator and collection issue count.
    pub fn issue_count(&self) -> usize {
        self.evaluation.issues.len() + self.collection_issues.len()
    }
}

/// Why embedded Bases definitions could not be listed safely.
#[derive(Debug, thiserror::Error)]
pub enum EmbeddedBaseListingError {
    /// The requested path does not have a `.md` extension.
    #[error("vault path is not a Markdown note: {0}")]
    NotMarkdownNote(PathBuf),
    /// The selected snapshot entry is not a regular Markdown file.
    #[error("vault path is not a regular Markdown file: {0}")]
    NotRegularMarkdownNote(PathBuf),
    /// The complete note exceeds the supported source bound.
    #[error("Markdown source exceeds the {limit_bytes}-byte limit: {relative_path}")]
    TooLarge {
        relative_path: PathBuf,
        limit_bytes: usize,
    },
    /// The selected Markdown note is not valid UTF-8.
    #[error("Markdown note is not valid UTF-8: {0}")]
    InvalidUtf8(PathBuf),
    /// A confined vault operation failed.
    #[error(transparent)]
    Vault(#[from] VaultError),
    /// The vault changed while the definitions were being listed.
    #[error("vault changed while embedded Bases definitions were being listed")]
    SnapshotChanged,
}

/// Why an embedded Bases definition could not be evaluated safely.
#[derive(Debug, thiserror::Error)]
pub enum EmbeddedBaseEvaluationError {
    /// The listing no longer describes the current note and vault snapshot.
    #[error("embedded Bases listing is stale for {relative_path}; refresh it before evaluating")]
    StaleListing { relative_path: PathBuf },
    /// A source or vault revision changed during evaluation.
    #[error("vault changed while embedded Bases evaluation was being prepared")]
    SnapshotChanged,
    /// The complete note exceeds the supported source bound.
    #[error("Markdown source exceeds the {limit_bytes}-byte limit: {relative_path}")]
    TooLarge {
        relative_path: PathBuf,
        limit_bytes: usize,
    },
    /// The selected Markdown note is not valid UTF-8.
    #[error("Markdown note is not valid UTF-8: {0}")]
    InvalidUtf8(PathBuf),
    /// The requested definition index is not present in the listing.
    #[error(
        "embedded Bases definition index {definition_index} is outside {definition_count} definitions"
    )]
    InvalidDefinitionIndex {
        definition_index: usize,
        definition_count: usize,
    },
    /// The selected definition did not produce a document that can be evaluated.
    #[error("embedded Bases definition {definition_index} is invalid: {message}")]
    InvalidDefinition {
        definition_index: usize,
        message: String,
    },
    /// The requested view index is not present in the selected definition.
    #[error(
        "view index {view_index} is outside {view_count} views in embedded definition {definition_index}"
    )]
    InvalidViewIndex {
        definition_index: usize,
        view_index: usize,
        view_count: usize,
    },
    /// The selected document could not be evaluated.
    #[error(transparent)]
    Parse(#[from] BaseParseError),
    /// A confined vault operation failed.
    #[error(transparent)]
    Vault(#[from] VaultError),
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

/// Parse embedded Bases definitions from one complete Markdown note revision.
pub(crate) fn list_embedded_bases(
    root: &VaultRoot,
    relative_path: &Path,
) -> Result<EmbeddedBaseListing, EmbeddedBaseListingError> {
    if !relative_path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
    {
        return Err(EmbeddedBaseListingError::NotMarkdownNote(
            relative_path.to_path_buf(),
        ));
    }

    let before = root.snapshot().map_err(map_embedded_listing_vault_error)?;
    let before_entries = snapshot_entry_map(&before);
    let Some(note_entry) = before_entries.get(relative_path) else {
        // Read through VaultRoot to preserve its precise missing-file error.
        let _ = root
            .read_preview_with_limit(relative_path, MAX_BASE_NOTE_SOURCE_BYTES)
            .map_err(map_embedded_listing_vault_error)?;
        return Err(EmbeddedBaseListingError::SnapshotChanged);
    };
    if note_entry.kind != VaultSnapshotEntryKind::File {
        return Err(EmbeddedBaseListingError::NotRegularMarkdownNote(
            relative_path.to_path_buf(),
        ));
    }
    if note_entry.size_bytes > MAX_BASE_NOTE_SOURCE_BYTES as u64 {
        return Err(EmbeddedBaseListingError::TooLarge {
            relative_path: relative_path.to_path_buf(),
            limit_bytes: MAX_BASE_NOTE_SOURCE_BYTES,
        });
    }

    let preview = root
        .read_preview_with_limit(relative_path, MAX_BASE_NOTE_SOURCE_BYTES)
        .map_err(map_embedded_listing_vault_error)?;
    if preview.truncated {
        return Err(EmbeddedBaseListingError::TooLarge {
            relative_path: relative_path.to_path_buf(),
            limit_bytes: MAX_BASE_NOTE_SOURCE_BYTES,
        });
    }
    if preview.total_size_bytes != note_entry.size_bytes {
        return Err(EmbeddedBaseListingError::SnapshotChanged);
    }
    let note_revision_sha256 = preview
        .revision_sha256
        .ok_or(EmbeddedBaseListingError::SnapshotChanged)?;
    if note_revision_sha256 != note_entry.revision_sha256 {
        return Err(EmbeddedBaseListingError::SnapshotChanged);
    }
    let source = std::str::from_utf8(preview.source.as_bytes())
        .map_err(|_| EmbeddedBaseListingError::InvalidUtf8(relative_path.to_path_buf()))?;
    let definitions = parse_embedded_bases(source);

    let after = root.snapshot().map_err(map_embedded_listing_vault_error)?;
    if before.revision_sha256 != after.revision_sha256 {
        return Err(EmbeddedBaseListingError::SnapshotChanged);
    }

    Ok(EmbeddedBaseListing {
        relative_path: relative_path.to_path_buf(),
        note_revision_sha256,
        snapshot_before_sha256: before.revision_sha256,
        snapshot_after_sha256: after.revision_sha256,
        definitions,
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

/// Evaluate one view from a previously listed embedded Bases definition.
pub(crate) fn evaluate_embedded_base_by_view_index(
    root: &VaultRoot,
    listing: &EmbeddedBaseListing,
    definition_index: usize,
    view_index: usize,
) -> Result<EmbeddedBaseEvaluation, EmbeddedBaseEvaluationError> {
    let relative_path = listing.relative_path.as_path();
    if !relative_path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
    {
        return Err(EmbeddedBaseEvaluationError::StaleListing {
            relative_path: relative_path.to_path_buf(),
        });
    }

    let before = root
        .snapshot()
        .map_err(map_embedded_evaluation_vault_error)?;
    if listing.snapshot_before_sha256 != listing.snapshot_after_sha256
        || before.revision_sha256 != listing.snapshot_after_sha256
    {
        return Err(EmbeddedBaseEvaluationError::StaleListing {
            relative_path: relative_path.to_path_buf(),
        });
    }
    let before_entries = snapshot_entry_map(&before);
    let Some(note_entry) = before_entries.get(relative_path) else {
        return Err(EmbeddedBaseEvaluationError::StaleListing {
            relative_path: relative_path.to_path_buf(),
        });
    };
    if note_entry.kind != VaultSnapshotEntryKind::File
        || note_entry.revision_sha256 != listing.note_revision_sha256
    {
        return Err(EmbeddedBaseEvaluationError::StaleListing {
            relative_path: relative_path.to_path_buf(),
        });
    }
    if note_entry.size_bytes > MAX_BASE_NOTE_SOURCE_BYTES as u64 {
        return Err(EmbeddedBaseEvaluationError::TooLarge {
            relative_path: relative_path.to_path_buf(),
            limit_bytes: MAX_BASE_NOTE_SOURCE_BYTES,
        });
    }

    let preview = root
        .read_preview_with_limit(relative_path, MAX_BASE_NOTE_SOURCE_BYTES)
        .map_err(map_embedded_evaluation_vault_error)?;
    if preview.truncated {
        return Err(EmbeddedBaseEvaluationError::TooLarge {
            relative_path: relative_path.to_path_buf(),
            limit_bytes: MAX_BASE_NOTE_SOURCE_BYTES,
        });
    }
    if preview.total_size_bytes != note_entry.size_bytes {
        return Err(EmbeddedBaseEvaluationError::SnapshotChanged);
    }
    let note_revision_sha256 = preview
        .revision_sha256
        .ok_or(EmbeddedBaseEvaluationError::SnapshotChanged)?;
    if note_revision_sha256 != listing.note_revision_sha256 {
        return Err(EmbeddedBaseEvaluationError::SnapshotChanged);
    }
    let source = std::str::from_utf8(preview.source.as_bytes())
        .map_err(|_| EmbeddedBaseEvaluationError::InvalidUtf8(relative_path.to_path_buf()))?;
    let definitions = parse_embedded_bases(source);
    if definitions != listing.definitions {
        return Err(EmbeddedBaseEvaluationError::StaleListing {
            relative_path: relative_path.to_path_buf(),
        });
    }
    let Some(definition) = definitions.get(definition_index).cloned() else {
        return Err(EmbeddedBaseEvaluationError::InvalidDefinitionIndex {
            definition_index,
            definition_count: definitions.len(),
        });
    };
    let Some(document) = definition.document.as_ref() else {
        let message = definition
            .issues
            .iter()
            .map(|issue| issue.message.as_str())
            .collect::<Vec<_>>()
            .join("; ");
        return Err(EmbeddedBaseEvaluationError::InvalidDefinition {
            definition_index,
            message: if message.is_empty() {
                "definition did not produce a parsed Bases document".to_owned()
            } else {
                message
            },
        });
    };
    let view_count = document.views().len();
    if view_index >= view_count {
        return Err(EmbeddedBaseEvaluationError::InvalidViewIndex {
            definition_index,
            view_index,
            view_count,
        });
    }

    // The selected note is read completely for parsing and reused for its metadata row.
    let notes = root
        .scan_markdown()
        .map_err(map_embedded_evaluation_vault_error)?;
    if !notes.iter().any(|note| note.relative_path == relative_path) {
        return Err(EmbeddedBaseEvaluationError::SnapshotChanged);
    }
    let collection = collect_embedded_note_rows(
        root,
        &notes,
        &before_entries,
        relative_path,
        preview.source.as_bytes(),
    )
    .map_err(map_embedded_evaluation_vault_error)?;
    let evaluation = evaluate_base_by_view_index(document, view_index, &collection.rows)?;

    let after = root
        .snapshot()
        .map_err(map_embedded_evaluation_vault_error)?;
    if before.revision_sha256 != after.revision_sha256 {
        return Err(EmbeddedBaseEvaluationError::SnapshotChanged);
    }

    Ok(EmbeddedBaseEvaluation {
        relative_path: relative_path.to_path_buf(),
        note_revision_sha256,
        snapshot_before_sha256: before.revision_sha256,
        snapshot_after_sha256: after.revision_sha256,
        definition_index,
        view_index,
        definition,
        evaluation,
        collection_issues: collection.collection_issues,
        complete: collection.complete,
    })
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

struct EmbeddedNoteCollection {
    rows: Vec<BaseRow>,
    collection_issues: Vec<BaseCollectionIssue>,
    complete: bool,
}

fn collect_embedded_note_rows(
    root: &VaultRoot,
    notes: &[openobsidian_vault::VaultEntry],
    snapshot_entries: &HashMap<PathBuf, &VaultSnapshotEntry>,
    embedded_note_path: &Path,
    embedded_note_source: &[u8],
) -> Result<EmbeddedNoteCollection, VaultError> {
    let mut total_source_bytes = embedded_note_source.len();
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

        let Some(note_snapshot_entry) = snapshot_entries.get(&note.relative_path) else {
            return Err(VaultError::SnapshotChanged);
        };
        if note_snapshot_entry.kind != VaultSnapshotEntryKind::File {
            return Err(VaultError::SnapshotChanged);
        }

        if note.relative_path == embedded_note_path {
            if note_snapshot_entry.size_bytes != embedded_note_source.len() as u64 {
                return Err(VaultError::SnapshotChanged);
            }
            match note_properties(embedded_note_source, false) {
                Ok(properties) => {
                    let Some(path) = note.relative_path.to_str() else {
                        collection_issues.push(BaseCollectionIssue {
                            relative_path: note.relative_path.clone(),
                            message:
                                "note path cannot be represented as UTF-8 for Bases evaluation"
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
            continue;
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
        let note_preview = root.read_preview_with_limit(&note.relative_path, read_limit)?;
        if note_preview.total_size_bytes != note_snapshot_entry.size_bytes {
            return Err(VaultError::SnapshotChanged);
        }
        total_source_bytes = total_source_bytes
            .checked_add(note_preview.source.as_bytes().len())
            .ok_or(VaultError::SnapshotChanged)?;
        if let Some(revision) = note_preview.revision_sha256.as_deref()
            && revision != note_snapshot_entry.revision_sha256
        {
            return Err(VaultError::SnapshotChanged);
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

    Ok(EmbeddedNoteCollection {
        rows,
        collection_issues,
        complete,
    })
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

fn map_embedded_listing_vault_error(error: VaultError) -> EmbeddedBaseListingError {
    match error {
        VaultError::SnapshotChanged => EmbeddedBaseListingError::SnapshotChanged,
        error => EmbeddedBaseListingError::Vault(error),
    }
}

fn map_embedded_evaluation_vault_error(error: VaultError) -> EmbeddedBaseEvaluationError {
    match error {
        VaultError::SnapshotChanged => EmbeddedBaseEvaluationError::SnapshotChanged,
        error => EmbeddedBaseEvaluationError::Vault(error),
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
    const EMBEDDED_BASE_EVALUATION_FIXTURE: &str =
        include_str!("../../../fixtures/c07-embedded-base-evaluation.json");
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
    fn embedded_base_fixture_lists_and_evaluates_a_stable_note() {
        let fixture: JsonValue = serde_json::from_str(EMBEDDED_BASE_EVALUATION_FIXTURE)
            .expect("C07 embedded Bases fixture must be valid JSON");
        assert_eq!(fixture["schema_version"], 1);
        assert_eq!(fixture["id"], "fixture:c07-embedded-base-evaluation");

        let tree = TempTree::new();
        let (vault, app_data) = tree.layout();
        let note_path = "Notes/Embedded.md";
        let embedded_source = fixture["source"].as_str().unwrap();
        write_file(&vault, note_path, embedded_source.as_bytes());
        for row in fixture["rows"].as_array().unwrap() {
            let path = row["path"].as_str().unwrap();
            let properties = &row["properties"];
            let note_source = format!(
                "---\nstatus: {}\npriority: {}\nteam: {}\n---\nfixture row\n",
                properties["status"].as_str().unwrap(),
                properties["priority"].as_u64().unwrap(),
                properties["team"].as_str().unwrap(),
            );
            write_file(&vault, path, note_source.as_bytes());
        }

        let session = session_for(&vault, &app_data);
        let root = VaultRoot::open(&vault).unwrap();
        let before = root.snapshot().unwrap();
        let listing = session
            .list_embedded_bases(note_path)
            .expect("embedded definitions must list from a complete note");
        let after_listing = root.snapshot().unwrap();
        assert_eq!(listing.relative_path, PathBuf::from(note_path));
        assert_eq!(listing.snapshot_before_sha256, before.revision_sha256);
        assert_eq!(listing.snapshot_after_sha256, after_listing.revision_sha256);
        assert_eq!(before, after_listing, "listing must not write to the vault");
        assert_eq!(
            listing.note_revision_sha256,
            before
                .entries
                .iter()
                .find(|entry| entry.relative_path == Path::new(note_path))
                .unwrap()
                .revision_sha256
        );
        assert_eq!(listing.definitions.len(), 1);
        let definition = &listing.definitions[0];
        assert_eq!(
            &embedded_source[definition.start..definition.end],
            definition.source
        );
        assert_eq!(
            definition.source,
            parse_embedded_bases(embedded_source)[0].source
        );
        assert_eq!(
            definition
                .document
                .as_ref()
                .expect("fixture definition must parse")
                .source_bytes(),
            definition.source.as_bytes(),
            "the parsed document must retain the exact fenced definition source"
        );

        let result = session
            .evaluate_embedded_base_by_view_index(
                &listing,
                0,
                fixture["view_index"].as_u64().unwrap() as usize,
            )
            .expect("embedded Bases view must evaluate");
        let after_evaluation = root.snapshot().unwrap();
        assert_eq!(result.snapshot_before_sha256, before.revision_sha256);
        assert_eq!(
            result.snapshot_after_sha256,
            after_evaluation.revision_sha256
        );
        assert_eq!(
            before, after_evaluation,
            "evaluation must not write to the vault"
        );
        assert!(result.complete);
        assert!(result.collection_issues.is_empty());
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
            fixture["expected"]["group_names"]
                .as_array()
                .unwrap()
                .iter()
                .map(JsonValue::as_str)
                .collect::<Option<Vec<_>>>()
                .unwrap()
        );
        for group in &result.evaluation.groups {
            assert_eq!(
                group
                    .rows
                    .iter()
                    .map(|row| row.path.as_str())
                    .collect::<Vec<_>>(),
                fixture["expected"]["group_paths"][group.key.as_str()]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(JsonValue::as_str)
                    .collect::<Option<Vec<_>>>()
                    .unwrap()
            );
        }
        for row in &result.evaluation.rows {
            assert_eq!(
                row.values["sourcePath"].as_str(),
                fixture["expected"]["formula_values"][row.path.as_str()].as_str()
            );
            assert!(
                !row.values.contains_key("unsupportedDate"),
                "unsupported formulas must not fabricate a value"
            );
        }
        let unsupported_issue = result
            .evaluation
            .issues
            .iter()
            .find(|issue| issue.expression.as_deref() == Some("date(today)"))
            .expect("unsupported formula must remain visible as an evaluator issue");
        assert_eq!(
            unsupported_issue.message,
            fixture["expected"]["issue_message"].as_str().unwrap()
        );
    }

    #[test]
    fn embedded_base_listing_rejects_stale_snapshots_and_oversized_notes() {
        let tree = TempTree::new();
        let (vault, app_data) = tree.layout();
        let source =
            serde_json::from_str::<JsonValue>(EMBEDDED_BASE_EVALUATION_FIXTURE).unwrap()["source"]
                .as_str()
                .unwrap()
                .to_owned();
        write_file(&vault, "Notes/Embedded.md", source.as_bytes());
        let session = session_for(&vault, &app_data);

        let listing = session.list_embedded_bases("Notes/Embedded.md").unwrap();
        write_file(&vault, "Notes/Other.md", b"changed vault snapshot\n");
        assert!(matches!(
            session.evaluate_embedded_base_by_view_index(&listing, 0, 0),
            Err(EmbeddedBaseEvaluationError::StaleListing { .. })
        ));

        let fresh_listing = session.list_embedded_bases("Notes/Embedded.md").unwrap();
        let changed_source = format!("{source}\nchanged after listing\n");
        write_file(&vault, "Notes/Embedded.md", changed_source.as_bytes());
        assert!(matches!(
            session.evaluate_embedded_base_by_view_index(&fresh_listing, 0, 0),
            Err(EmbeddedBaseEvaluationError::StaleListing { .. })
        ));

        write_file(
            &vault,
            "Notes/Large.md",
            &vec![b'x'; MAX_BASE_NOTE_SOURCE_BYTES + 1],
        );
        assert!(matches!(
            session.list_embedded_bases("Notes/Large.md"),
            Err(EmbeddedBaseListingError::TooLarge { .. })
        ));
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
