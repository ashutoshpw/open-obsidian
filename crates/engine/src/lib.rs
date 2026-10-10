//! Application services that compose document and vault behavior without UI dependencies.

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
    VaultWriteRecoveryReport,
    analyze_markdown_preview, plan_history_retention,
};
use openobsidian_vault::{VaultEntry, VaultRead, VaultStore};
use std::path::Path;
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

    /// Reads a note through the vault's root-confinement and revision-hashing boundary.
    pub fn read(&self, relative_path: impl AsRef<Path>) -> Result<VaultRead, VaultError> {
        self.store.root().read(relative_path)
    }

    /// Reads a bounded, lossless source prefix for read-only note inspection.
    pub fn read_preview(
        &self,
        relative_path: impl AsRef<Path>,
    ) -> Result<VaultReadPreview, VaultError> {
        self.store.root().read_preview(relative_path)
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

#[cfg(test)]
mod tests {
    use super::*;
    use openobsidian_vault::VaultRoot;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

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
