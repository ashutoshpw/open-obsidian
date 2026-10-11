//! Application services that compose document and vault behavior without UI dependencies.

use openobsidian_doc::{encode_canvas, parse_canvas};
pub use openobsidian_vault::{
    LinkKind, LinkReference, LinkRenameAction, LinkResolution, LinkResolutionStatus,
    LinkSubpathSlice, LinkSubpathStatus, MAX_NOTE_SOURCE_PREVIEW_BYTES, MarkdownPreviewAnalysis,
    MarkdownPreviewDisposition, MarkdownUnsupportedSyntax, TransclusionBlockReason,
    TransclusionGuard, VaultConflictAction, VaultConflictRead, VaultConflictResolution, VaultError,
    VaultHistoryCleanup, VaultHistoryKind, VaultHistoryPlan, VaultHistoryPolicy,
    VaultHistoryRecord, VaultInlineImage, VaultLinkResolution, VaultNoteEmbedDisposition,
    VaultNoteEmbedNode, VaultNoteEmbedReport, VaultNoteEmbedResolution, VaultReadPreview,
    VaultRenamePreview, VaultRenameRecoveryIssue, VaultRenameRecoveryReport, VaultRenameResult,
    VaultWatchError, VaultWatchHint, VaultWatcher, VaultWriteRecoveryIssue,
    VaultWriteRecoveryReport, VaultWriteRequest, VaultWriteResult, analyze_markdown_preview,
    plan_history_retention,
};
use openobsidian_vault::{VaultEntry, VaultRead, VaultStore};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Application session for a vault and its app-owned history directory.
#[derive(Clone, Debug)]
pub struct VaultSession {
    store: VaultStore,
    entries: Vec<VaultEntry>,
    write_recovery: VaultWriteRecoveryReport,
    rename_recovery: VaultRenameRecoveryReport,
}

impl VaultSession {
    /// Opens a vault with a separately managed app-data directory.
    pub fn open(
        root: impl AsRef<Path>,
        app_data_root: impl AsRef<Path>,
    ) -> Result<Self, VaultError> {
        let store = VaultStore::open(root, app_data_root)?;
        let write_recovery = store.recover_pending_writes()?;
        let rename_recovery = store.recover_pending_rename_transactions()?;
        let entries = store.root().scan_markdown()?;
        Ok(Self {
            store,
            entries,
            write_recovery,
            rename_recovery,
        })
    }

    /// Returns the current Markdown listing captured when the session opened or refreshed.
    pub fn entries(&self) -> &[VaultEntry] {
        &self.entries
    }

    /// Returns the recovery outcome processed before the Markdown listing was scanned.
    pub fn rename_recovery_report(&self) -> &VaultRenameRecoveryReport {
        &self.rename_recovery
    }

    /// Returns the interrupted single-file write recovery outcome from open.
    pub fn write_recovery_report(&self) -> &VaultWriteRecoveryReport {
        &self.write_recovery
    }

    /// Returns the canonical vault root path.
    pub fn root_path(&self) -> &Path {
        self.store.root().path()
    }

    /// Resolves an existing regular file beneath the vault without following symlinks.
    pub fn resolve_regular_file_path(
        &self,
        relative_path: impl AsRef<Path>,
    ) -> Result<std::path::PathBuf, VaultError> {
        let relative_path = normalize_portable_path(relative_path.as_ref())?;
        self.store.root().resolve_regular_file_path(relative_path)
    }

    /// Reads a vault file through the root-confinement and revision-hashing boundary.
    /// Portable path separators are normalized to match journaled writes.
    pub fn read(&self, relative_path: impl AsRef<Path>) -> Result<VaultRead, VaultError> {
        let relative_path = normalize_portable_path(relative_path.as_ref())?;
        self.store.root().read(relative_path)
    }

    /// Reads a bounded, lossless source prefix and its full revision when the note fits the limit.
    pub fn read_preview(
        &self,
        relative_path: impl AsRef<Path>,
    ) -> Result<VaultReadPreview, VaultError> {
        let relative_path = normalize_portable_path(relative_path.as_ref())?;
        self.store.root().read_preview(relative_path)
    }

    /// Writes source bytes through the vault journal after checking the expected SHA-256 revision.
    pub fn write(&self, request: VaultWriteRequest) -> Result<VaultWriteResult, VaultError> {
        self.store.write(request)
    }

    /// Persists a text-card edit only when the Canvas still matches the caller's observed
    /// revision. The vault write repeats that revision check to catch changes between read
    /// and write. This operation never creates a Markdown note.
    pub fn edit_canvas_text_node(
        &self,
        relative_path: impl AsRef<Path>,
        expected_revision_sha256: &str,
        node_id: &str,
        text: &str,
    ) -> Result<VaultWriteResult, CanvasEditError> {
        let relative_path = normalize_portable_path(relative_path.as_ref())?;
        let current = self.read(&relative_path)?;
        if current.revision_sha256 != expected_revision_sha256 {
            return Err(CanvasEditError::StaleRevision {
                relative_path: relative_path.clone(),
                expected_revision: expected_revision_sha256.to_owned(),
                current_revision: current.revision_sha256,
            });
        }

        let mut document = parse_canvas(current.document.as_bytes())?;
        document.edit_text_node(node_id, text)?;
        let bytes = encode_canvas(&document)?;
        Ok(self.write(VaultWriteRequest {
            relative_path: relative_path.to_path_buf(),
            expected_revision_sha256: Some(expected_revision_sha256.to_owned()),
            bytes,
        })?)
    }

    /// Extracts a note's links and resolves them against a stable, confined vault snapshot.
    pub fn resolve_links_for_note(
        &self,
        relative_path: impl AsRef<Path>,
    ) -> Result<Vec<VaultLinkResolution>, VaultError> {
        self.store.root().resolve_links_for_note(relative_path)
    }

    /// Resolves a bounded note embed through the vault's snapshot and path guards.
    pub fn resolve_note_embed(
        &self,
        current_path: impl AsRef<Path>,
        reference: &LinkReference,
        depth: usize,
        chain: &[String],
    ) -> Result<VaultNoteEmbedResolution, VaultError> {
        self.store
            .root()
            .resolve_note_embed(current_path, reference, depth, chain)
    }

    /// Resolves bounded note embeds and their nested Markdown embeds from one stable snapshot.
    pub fn resolve_note_embeds_for_note(
        &self,
        relative_path: impl AsRef<Path>,
    ) -> Result<VaultNoteEmbedReport, VaultError> {
        self.store
            .root()
            .resolve_note_embeds_for_note(relative_path)
    }

    /// Builds a read-only rename preview bound to the current vault snapshot.
    pub fn build_rename_preview(
        &self,
        old_path: impl AsRef<Path>,
        new_path: impl AsRef<Path>,
    ) -> Result<VaultRenamePreview, VaultError> {
        self.store.root().build_rename_preview(old_path, new_path)
    }

    /// Applies a previously reviewed, vault-bound rename preview.
    pub fn apply_rename_preview(
        &self,
        preview: &VaultRenamePreview,
    ) -> Result<VaultRenameResult, VaultError> {
        self.store.apply_rename_preview(preview)
    }

    /// Refreshes the session's Markdown listing after a committed vault operation.
    pub fn refresh_entries(&mut self) -> Result<(), VaultError> {
        self.entries = self.store.root().scan_markdown()?;
        Ok(())
    }

    /// Lists validated recovery, failed-write and conflict records.
    pub fn history_records(&self) -> Result<Vec<VaultHistoryRecord>, VaultError> {
        self.store.history_records()
    }

    /// Builds a fresh, read-only age and size retention plan.
    pub fn history_retention_plan(
        &self,
        policy: VaultHistoryPolicy,
    ) -> Result<VaultHistoryPlan, VaultError> {
        self.store.history_retention_plan(policy, SystemTime::now())
    }

    /// Cleans only records made pruneable by the selected policy.
    pub fn cleanup_history(
        &self,
        policy: VaultHistoryPolicy,
    ) -> Result<VaultHistoryCleanup, VaultError> {
        self.store.cleanup_history(policy)
    }

    /// Reads incoming conflict bytes after validating the record and relative path.
    pub fn read_conflict(
        &self,
        id: &str,
        relative_path: impl AsRef<Path>,
    ) -> Result<VaultConflictRead, VaultError> {
        self.store.read_conflict(id, relative_path)
    }

    /// Resolves one conflict after the caller explicitly chooses which version to keep.
    pub fn resolve_conflict(
        &self,
        id: &str,
        relative_path: impl AsRef<Path>,
        action: VaultConflictAction,
    ) -> Result<VaultConflictResolution, VaultError> {
        self.store.resolve_conflict(id, relative_path, action)
    }
}

fn normalize_portable_path(relative_path: &Path) -> Result<PathBuf, VaultError> {
    let relative_path = relative_path.to_str().ok_or(VaultError::InvalidPath)?;
    Ok(PathBuf::from(relative_path.replace('\\', "/")))
}

/// Failure to apply a revision-checked Canvas text-card edit.
#[derive(Debug, thiserror::Error)]
pub enum CanvasEditError {
    /// The caller's Canvas snapshot became stale before the edit started.
    #[error("Canvas revision changed for {relative_path}; reopen it before editing")]
    StaleRevision {
        relative_path: PathBuf,
        expected_revision: String,
        current_revision: String,
    },
    /// The Canvas could not be parsed, edited, or encoded.
    #[error(transparent)]
    Canvas(#[from] openobsidian_doc::CanvasError),
    /// The confined vault read or revision-checked journal write failed.
    #[error(transparent)]
    Vault(#[from] VaultError),
}

#[cfg(test)]
mod tests {
    use super::*;
    use openobsidian_doc::CanvasError;
    use openobsidian_vault::VaultRoot;
    use serde_json::Value;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    const C06_TEXT_CARD_VAULT_FIXTURE: &str =
        include_str!("../../../fixtures/c06-text-card-vault.json");

    static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(0);

    struct TempTree(PathBuf);

    impl TempTree {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "openobsidian-engine-{}-{}",
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

    #[test]
    fn fixture_edit_persists_only_the_selected_canvas_text_without_creating_a_note() {
        let fixture: Value = serde_json::from_str(C06_TEXT_CARD_VAULT_FIXTURE)
            .expect("C06.1 vault edit fixture must be valid JSON");
        assert_eq!(fixture["schema_version"], 1);
        assert_eq!(fixture["id"], "fixture:c06-text-card-vault");
        assert!(fixture["invariants"]["text_card_edit_never_creates_a_markdown_note"]
            .as_bool()
            .expect("fixture note-creation invariant must be a boolean"));

        for case in fixture["valid_edits"]
            .as_array()
            .expect("C06.1 fixture must contain valid edits")
        {
            let case_id = case["id"].as_str().expect("valid edit case must have an id");
            let canvas_path = case["canvas_path"]
                .as_str()
                .expect("valid edit case must have a Canvas path");
            let storage_path = case["storage_path"].as_str().unwrap_or(canvas_path);
            let note_path = case["note_path"]
                .as_str()
                .expect("valid edit case must identify the note that must not be created");
            let node_id = case["node_id"]
                .as_str()
                .expect("valid edit case must have a node ID");
            let new_text = case["new_text"]
                .as_str()
                .expect("valid edit case must have replacement text");
            let source = serde_json::to_vec(&case["before"])
                .unwrap_or_else(|error| panic!("{case_id}: Canvas before value must encode: {error}"));

            let temporary = TempTree::new();
            let (vault, app_data) = temporary.layout();
            fs::create_dir_all(vault.join("Notes"))
                .unwrap_or_else(|error| panic!("{case_id}: create Notes folder: {error}"));
            if let Some(parent) = PathBuf::from(storage_path).parent() {
                fs::create_dir_all(vault.join(parent))
                    .unwrap_or_else(|error| panic!("{case_id}: create Canvas folder: {error}"));
            }
            for untouched in case["untouched_files"]
                .as_array()
                .expect("valid edit case must list files that must remain unchanged")
            {
                let path = untouched["path"]
                    .as_str()
                    .expect("untouched file must have a relative path");
                let text = untouched["text"]
                    .as_str()
                    .expect("untouched file fixture must contain UTF-8 text");
                fs::write(vault.join(path), text.as_bytes())
                    .unwrap_or_else(|error| panic!("{case_id}: seed {path}: {error}"));
            }
            fs::write(vault.join(storage_path), &source)
                .unwrap_or_else(|error| panic!("{case_id}: seed Canvas: {error}"));

            let session = VaultSession::open(&vault, &app_data)
                .unwrap_or_else(|error| panic!("{case_id}: open fixture vault: {error}"));
            let observed = session
                .read(canvas_path)
                .unwrap_or_else(|error| panic!("{case_id}: read Canvas: {error}"));
            let result = session
                .edit_canvas_text_node(
                    canvas_path,
                    &observed.revision_sha256,
                    node_id,
                    new_text,
                )
                .unwrap_or_else(|error| panic!("{case_id}: persist Canvas edit: {error}"));
            let persisted = session
                .read(canvas_path)
                .unwrap_or_else(|error| panic!("{case_id}: read persisted Canvas: {error}"));
            let actual: Value = serde_json::from_slice(persisted.document.as_bytes())
                .unwrap_or_else(|error| panic!("{case_id}: persisted Canvas must be JSON: {error}"));

            assert_eq!(actual, case["after"], "{case_id}: only expected Canvas JSON is persisted");
            assert_eq!(result.read, persisted, "{case_id}: write result matches vault readback");
            assert_ne!(
                persisted.revision_sha256, observed.revision_sha256,
                "{case_id}: persisted text edit has a new revision"
            );
            assert!(
                !vault.join(note_path).exists(),
                "{case_id}: editing a card must not create a Markdown note"
            );
            for untouched in case["untouched_files"].as_array().unwrap() {
                let path = untouched["path"].as_str().unwrap();
                let text = untouched["text"].as_str().unwrap();
                assert_eq!(
                    fs::read(vault.join(path)).unwrap(),
                    text.as_bytes(),
                    "{case_id}: edit must leave {path} unchanged"
                );
            }
        }
    }

    #[test]
    fn fixture_invalid_canvas_edits_and_stale_revisions_do_not_write_or_create_notes() {
        let fixture: Value = serde_json::from_str(C06_TEXT_CARD_VAULT_FIXTURE)
            .expect("C06.1 vault edit fixture must be valid JSON");

        for case in fixture["invalid_edits"]
            .as_array()
            .expect("C06.1 fixture must contain invalid edits")
        {
            let case_id = case["id"].as_str().expect("invalid edit case must have an id");
            let canvas_path = case["canvas_path"].as_str().unwrap();
            let node_id = case["node_id"].as_str().unwrap();
            let expected_error = case["error"].as_str().unwrap();
            let source = serde_json::to_vec(&case["before"])
                .unwrap_or_else(|error| panic!("{case_id}: Canvas before value must encode: {error}"));
            let temporary = TempTree::new();
            let (vault, app_data) = temporary.layout();
            fs::write(vault.join(canvas_path), &source)
                .unwrap_or_else(|error| panic!("{case_id}: seed Canvas: {error}"));
            let session = VaultSession::open(&vault, &app_data)
                .unwrap_or_else(|error| panic!("{case_id}: open fixture vault: {error}"));
            let observed = session.read(canvas_path).unwrap();
            let error = session
                .edit_canvas_text_node(canvas_path, &observed.revision_sha256, node_id, "changed")
                .expect_err("invalid fixture edit must fail");

            let expected_error_matches = match expected_error {
                "node_not_found" => matches!(
                    &error,
                    CanvasEditError::Canvas(CanvasError::NodeNotFound(_))
                ),
                "ambiguous_node_id" => matches!(
                    &error,
                    CanvasEditError::Canvas(CanvasError::AmbiguousNodeId(_))
                ),
                "not_text_node" => matches!(
                    &error,
                    CanvasEditError::Canvas(CanvasError::NotTextNode(_))
                ),
                other => panic!("{case_id}: unsupported error fixture {other}"),
            };
            assert!(expected_error_matches, "{case_id}: received {error:?}");
            assert_eq!(
                fs::read(vault.join(canvas_path)).unwrap(),
                source,
                "{case_id}: rejected edit must preserve Canvas bytes"
            );
            assert!(
                !vault.join("Notes/Created.md").exists(),
                "{case_id}: rejected edit must not create a Markdown note"
            );
        }

        for case in fixture["stale_edits"]
            .as_array()
            .expect("C06.1 fixture must contain stale-revision cases")
        {
            let case_id = case["id"].as_str().expect("stale case must have an id");
            let canvas_path = case["canvas_path"].as_str().unwrap();
            let node_id = case["node_id"].as_str().unwrap();
            let note_path = case["note_path"].as_str().unwrap();
            let source = serde_json::to_vec(&case["before"]).unwrap();
            let external_bytes = serde_json::to_vec(&case["external_after"]).unwrap();
            let temporary = TempTree::new();
            let (vault, app_data) = temporary.layout();
            fs::write(vault.join(canvas_path), &source)
                .unwrap_or_else(|error| panic!("{case_id}: seed Canvas: {error}"));
            let session = VaultSession::open(&vault, &app_data)
                .unwrap_or_else(|error| panic!("{case_id}: open fixture vault: {error}"));
            let observed = session.read(canvas_path).unwrap();
            fs::write(vault.join(canvas_path), &external_bytes)
                .unwrap_or_else(|error| panic!("{case_id}: simulate an external Canvas edit: {error}"));
            let external_revision = session.read(canvas_path).unwrap().revision_sha256;
            let error = session
                .edit_canvas_text_node(
                    canvas_path,
                    &observed.revision_sha256,
                    node_id,
                    case["new_text"].as_str().unwrap(),
                )
                .expect_err("stale Canvas edit must be rejected");

            match error {
                CanvasEditError::StaleRevision {
                    relative_path,
                    expected_revision,
                    current_revision,
                } => {
                    assert_eq!(relative_path, PathBuf::from(canvas_path), "{case_id}: stale path");
                    assert_eq!(expected_revision, observed.revision_sha256, "{case_id}: observed revision");
                    assert_eq!(current_revision, external_revision, "{case_id}: current revision");
                }
                other => panic!("{case_id}: expected stale revision error, received {other:?}"),
            }
            assert_eq!(
                fs::read(vault.join(canvas_path)).unwrap(),
                external_bytes,
                "{case_id}: stale edit must preserve the external Canvas bytes"
            );
            assert!(
                !vault.join(note_path).exists(),
                "{case_id}: stale edit must not create a Markdown note"
            );
        }
    }

    #[test]
    fn malformed_and_unsafe_canvas_paths_fail_without_writing() {
        let fixture: Value = serde_json::from_str(C06_TEXT_CARD_VAULT_FIXTURE)
            .expect("C06.1 vault edit fixture must be valid JSON");

        for case in fixture["malformed_documents"]
            .as_array()
            .expect("C06.1 fixture must contain malformed documents")
        {
            let case_id = case["id"].as_str().expect("malformed case must have an id");
            let canvas_path = case["canvas_path"].as_str().unwrap();
            let source = case["source"].as_str().unwrap().as_bytes().to_vec();
            let temporary = TempTree::new();
            let (vault, app_data) = temporary.layout();
            fs::write(vault.join(canvas_path), &source)
                .unwrap_or_else(|error| panic!("{case_id}: seed malformed Canvas: {error}"));
            let session = VaultSession::open(&vault, &app_data)
                .unwrap_or_else(|error| panic!("{case_id}: open fixture vault: {error}"));
            let observed = session.read(canvas_path).unwrap();
            let error = session
                .edit_canvas_text_node(canvas_path, &observed.revision_sha256, "text-1", "changed")
                .expect_err("malformed Canvas document must be rejected");
            let expected_error_matches = match case["error"].as_str().unwrap() {
                "malformed_json" => matches!(
                    &error,
                    CanvasEditError::Canvas(CanvasError::MalformedJson(_))
                ),
                "invalid_document_shape" => matches!(
                    &error,
                    CanvasEditError::Canvas(CanvasError::InvalidDocumentShape)
                ),
                other => panic!("{case_id}: unsupported error fixture {other}"),
            };
            assert!(expected_error_matches, "{case_id}: received {error:?}");
            assert_eq!(
                fs::read(vault.join(canvas_path)).unwrap(),
                source,
                "{case_id}: malformed Canvas bytes must remain unchanged"
            );
            assert!(!vault.join("Notes/Created.md").exists());
        }

        let temporary = TempTree::new();
        let (vault, app_data) = temporary.layout();
        let session = VaultSession::open(&vault, &app_data).unwrap();
        for case in fixture["unsafe_paths"]
            .as_array()
            .expect("C06.1 fixture must contain unsafe paths")
        {
            let case_id = case["id"].as_str().expect("unsafe path case must have an id");
            let expected_error = case["error"].as_str().unwrap();
            let error = session
                .edit_canvas_text_node(
                    case["canvas_path"].as_str().unwrap(),
                    "observed-revision",
                    "text-1",
                    "changed",
                )
                .expect_err("outside-vault Canvas path must be rejected");
            let expected_error_matches = match expected_error {
                "invalid_path" => matches!(
                    &error,
                    CanvasEditError::Vault(VaultError::InvalidPath)
                ),
                other => panic!("{case_id}: unsupported error fixture {other}"),
            };
            assert!(expected_error_matches, "{case_id}: received {error:?}");
            assert!(!vault.join("Notes/Created.md").exists());
        }
    }

    #[test]
    fn session_exposes_snapshot_bound_rename_and_refreshes_listing_explicitly() {
        let temporary = TempTree::new();
        let (vault, app_data) = temporary.layout();
        fs::write(vault.join("Old.md"), b"# Old\r\n").unwrap();
        fs::write(vault.join("Index.md"), b"[[Old]]\r\n").unwrap();

        let mut session = VaultSession::open(&vault, &app_data).unwrap();
        assert_eq!(
            session.rename_recovery_report(),
            &VaultRenameRecoveryReport::default()
        );
        assert_eq!(
            session.write_recovery_report(),
            &VaultWriteRecoveryReport::default()
        );
        let preview = session.build_rename_preview("Old.md", "New.md").unwrap();
        let result = session.apply_rename_preview(&preview).unwrap();

        assert_eq!(result.updated_references, 1);
        assert_eq!(result.read.document.as_bytes(), b"# Old\r\n");
        assert_eq!(fs::read(vault.join("Index.md")).unwrap(), b"[[New]]\r\n");
        assert!(
            session
                .entries()
                .iter()
                .any(|entry| entry.relative_path == *"Old.md")
        );

        session.refresh_entries().unwrap();
        assert!(
            session
                .entries()
                .iter()
                .any(|entry| entry.relative_path == *"New.md")
        );
        assert!(
            !session
                .entries()
                .iter()
                .any(|entry| entry.relative_path == *"Old.md")
        );
    }

    #[test]
    fn opening_session_recovers_interrupted_rename_before_scanning_notes() {
        let temporary = TempTree::new();
        let (vault, app_data) = temporary.layout();
        let original = b"# Existing\r\n";
        fs::write(vault.join("Old.md"), original).unwrap();
        let before_revision = VaultRoot::open(&vault)
            .unwrap()
            .read("Old.md")
            .unwrap()
            .revision_sha256;

        let operation_id = "startup-recovery";
        let before_file = format!("{operation_id}-rename-before-0.bin");
        let recovery = app_data.join("recovery");
        fs::create_dir_all(&recovery).unwrap();
        fs::write(recovery.join(&before_file), original).unwrap();
        let after_revision = "a".repeat(64);
        let manifest = format!(
            "{{\"schema_version\":2,\"id\":\"{operation_id}\",\"operation\":\"rename\",\"state\":\"prepared\",\"paths\":[\"Old.md\",\"New.md\"],\"old_path\":\"Old.md\",\"new_path\":\"New.md\",\"plan_id\":\"seeded-plan\",\"case_only\":false,\"temporary_path\":null,\"files\":[{{\"source_path\":\"Old.md\",\"target_path\":\"New.md\",\"before_revision\":\"{before_revision}\",\"after_revision\":\"{after_revision}\",\"before_file\":\"{before_file}\"}}],\"recorded_at\":\"2026-10-08T00:00:00Z\",\"error\":null}}\n"
        );
        fs::write(app_data.join("journal.jsonl"), manifest).unwrap();

        let session = VaultSession::open(&vault, &app_data).unwrap();

        assert_eq!(
            session.rename_recovery_report().recovered_operations,
            vec![operation_id]
        );
        assert!(session.rename_recovery_report().needs_attention.is_empty());
        assert_eq!(fs::read(vault.join("Old.md")).unwrap(), original);
        assert!(!vault.join("New.md").exists());
        assert!(
            session
                .entries()
                .iter()
                .any(|entry| entry.relative_path == *"Old.md")
        );
    }

    #[test]
    fn opening_session_recovers_interrupted_write_before_scanning_notes() {
        let temporary = TempTree::new();
        let (vault, app_data) = temporary.layout();
        fs::create_dir(vault.join("Notes")).unwrap();
        let relative_path = "Notes/Prepared.md";
        let previous = b"\xef\xbb\xbfstatus: old\r\n";
        let incoming = b"\xef\xbb\xbfstatus: recovered\r\n";
        fs::write(vault.join(relative_path), previous).unwrap();
        let expected_revision = VaultRoot::open(&vault)
            .unwrap()
            .read(relative_path)
            .unwrap()
            .revision_sha256;
        let seed_path = "Notes/IncomingSeed";
        fs::write(vault.join(seed_path), incoming).unwrap();
        let next_revision = VaultRoot::open(&vault)
            .unwrap()
            .read(seed_path)
            .unwrap()
            .revision_sha256;
        fs::remove_file(vault.join(seed_path)).unwrap();

        let operation_id = "123-456-0";
        let recovery = app_data.join("recovery");
        fs::create_dir(&recovery).unwrap();
        fs::write(
            recovery.join(format!("{operation_id}-previous.bin")),
            previous,
        )
        .unwrap();
        fs::write(
            recovery.join(format!("{operation_id}-previous.json")),
            format!(
                "{{\"id\":\"{operation_id}-previous\",\"relative_path\":\"{relative_path}\",\"revision\":\"{expected_revision}\",\"bytes\":{},\"path\":\"ignored\",\"captured_at\":\"1\",\"expected_revision\":\"{expected_revision}\",\"current_revision\":\"{expected_revision}\"}}\n",
                previous.len()
            ),
        )
        .unwrap();
        fs::write(
            recovery.join(format!("{operation_id}-incoming.bin")),
            incoming,
        )
        .unwrap();
        fs::write(
            recovery.join(format!("{operation_id}-incoming.json")),
            format!(
                "{{\"id\":\"{operation_id}-incoming\",\"relative_path\":\"{relative_path}\",\"revision\":\"{next_revision}\",\"bytes\":{},\"path\":\"ignored\",\"captured_at\":\"1\",\"expected_revision\":\"{expected_revision}\",\"current_revision\":\"{expected_revision}\"}}\n",
                incoming.len()
            ),
        )
        .unwrap();
        fs::write(
            app_data.join("journal.jsonl"),
            format!(
                "{{\"id\":\"{operation_id}\",\"operation\":\"write\",\"state\":\"prepared\",\"relative_path\":\"{relative_path}\",\"expected_revision\":\"{expected_revision}\",\"next_revision\":\"{next_revision}\",\"recorded_at\":\"1\",\"error\":null}}\n"
            ),
        )
        .unwrap();

        let session = VaultSession::open(&vault, &app_data).unwrap();

        assert_eq!(
            session.write_recovery_report().recovered_operations,
            vec![operation_id.to_owned()]
        );
        assert!(session.write_recovery_report().needs_attention.is_empty());
        assert_eq!(
            session.read(relative_path).unwrap().document.as_bytes(),
            incoming
        );
        assert!(
            session
                .entries()
                .iter()
                .any(|entry| entry.relative_path == *relative_path)
        );
    }
}
