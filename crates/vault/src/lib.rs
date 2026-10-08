//! Source-preserving vault reads and revision-bound rename previews.

use openobsidian_doc::{
    LinkRenameAction, LinkRenamePlan, LinkRenamePlanError, MarkdownSource, RawDocument,
    RenamePlanFile, build_link_rename_plan,
};
use sha2::{Digest, Sha256};
use std::fmt::Write as _;
use std::fs::{self, OpenOptions};
use std::io::{self, Write as IoWrite};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("vault root is unavailable: {0}")]
    Root(#[from] std::io::Error),
    #[error("vault paths must be non-empty and relative")]
    InvalidPath,
    #[error("vault path escapes the selected root: {0}")]
    OutsideRoot(PathBuf),
    #[error("vault entry is not a regular file: {0}")]
    NotAFile(PathBuf),
    #[error("vault path traverses a symbolic link: {0}")]
    Symlink(PathBuf),
    #[error("vault contains an unsupported filesystem entry: {0}")]
    UnsupportedEntry(PathBuf),
    #[error("vault changed while its rename preview was being prepared")]
    SnapshotChanged,
    #[error("rename preview is stale; prepare it again before applying")]
    StaleRenamePreview,
    #[error("application data directory is invalid or inside the vault: {0}")]
    InvalidDataDirectory(PathBuf),
    #[error("history record is invalid or unsafe: {0}")]
    InvalidHistoryRecord(PathBuf),
    #[error(
        "revision conflict for {relative_path}; incoming bytes were preserved at {preserved_path}"
    )]
    RevisionConflict {
        relative_path: PathBuf,
        expected_revision: Option<String>,
        current_revision: Option<String>,
        preserved_path: PathBuf,
    },
    #[error("write for {relative_path} needs recovery: {reason}")]
    RecoveryRequired {
        relative_path: PathBuf,
        reason: String,
    },
    #[error("could not write vault entry {relative_path}: {source}")]
    WriteFailed {
        relative_path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("rename destination already exists: {0}")]
    RenameDestinationExists(PathBuf),
    #[error("rename transaction for {old_path} to {new_path} needs recovery: {reason}")]
    RenameTransactionRecoveryRequired {
        old_path: PathBuf,
        new_path: PathBuf,
        reason: String,
    },
    #[error("could not append transaction journal: {0}")]
    Journal(#[source] io::Error),
    #[error(transparent)]
    RenamePlan(#[from] LinkRenamePlanError),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultEntry {
    pub relative_path: PathBuf,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultRead {
    pub document: RawDocument,
    pub revision_sha256: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VaultSnapshotEntryKind {
    File,
    Symlink,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultSnapshotEntry {
    pub relative_path: PathBuf,
    pub kind: VaultSnapshotEntryKind,
    pub size_bytes: u64,
    pub revision_sha256: String,
    pub symlink_target: Option<PathBuf>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultSnapshot {
    pub entries: Vec<VaultSnapshotEntry>,
    pub revision_sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultRenamePreview {
    pub plan: LinkRenamePlan,
    pub snapshot_sha256: String,
    pub plan_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultWriteRequest {
    pub relative_path: PathBuf,
    pub expected_revision_sha256: Option<String>,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultWriteResult {
    pub read: VaultRead,
    pub operation_id: String,
}

#[derive(Clone, Debug)]
pub struct VaultStore {
    root: VaultRoot,
    app_data_root: PathBuf,
    #[cfg(test)]
    fail_before_replace: bool,
    #[cfg(test)]
    fail_committed_journal: bool,
    #[cfg(test)]
    fail_rename_committed_journal: bool,
    #[cfg(test)]
    fail_replace_path: Option<PathBuf>,
    #[cfg(test)]
    external_change_on_failure: Option<(PathBuf, Vec<u8>)>,
}

mod history;
mod rename_transaction;
pub use history::{
    VaultConflictAction, VaultConflictRead, VaultConflictResolution, VaultHistoryCleanup,
    VaultHistoryKind, VaultHistoryPlan, VaultHistoryPolicy, VaultHistoryRecord,
    plan_history_retention,
};
pub use rename_transaction::{
    VaultRenameRecoveryIssue, VaultRenameRecoveryReport, VaultRenameResult,
};

#[derive(Clone, Debug)]
pub struct VaultRoot {
    canonical_root: PathBuf,
}

impl VaultRoot {
    /// Opens an existing vault without modifying it.
    pub fn open(root: impl AsRef<Path>) -> Result<Self, VaultError> {
        let canonical_root = fs::canonicalize(root)?;
        if !canonical_root.is_dir() {
            return Err(VaultError::NotAFile(canonical_root));
        }
        Ok(Self { canonical_root })
    }

    pub fn scan_markdown(&self) -> Result<Vec<VaultEntry>, VaultError> {
        let mut entries = Vec::new();
        scan_directory(&self.canonical_root, &self.canonical_root, &mut entries)?;
        entries.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        Ok(entries)
    }

    pub fn read(&self, relative_path: impl AsRef<Path>) -> Result<VaultRead, VaultError> {
        let relative_path = relative_path.as_ref();
        let canonical = self.resolve_vault_path(relative_path, false)?;
        let bytes = fs::read(canonical)?;
        let revision_sha256 = sha256_hex(&bytes);
        Ok(VaultRead {
            document: RawDocument::from_bytes(bytes),
            revision_sha256,
        })
    }

    /// Capture a sorted, content-addressed view of regular files and symlinks.
    /// Symlink targets are recorded without following them.
    pub fn snapshot(&self) -> Result<VaultSnapshot, VaultError> {
        let mut entries = Vec::new();
        snapshot_directory(&self.canonical_root, &self.canonical_root, &mut entries)?;
        entries.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        let revision_sha256 = snapshot_revision(&entries);
        Ok(VaultSnapshot {
            entries,
            revision_sha256,
        })
    }

    /// Build a read-only rename plan bound to the exact vault snapshot used to
    /// resolve its references. The source tree is sampled again after reading
    /// note contents so concurrent changes fail closed.
    pub fn build_rename_preview(
        &self,
        old_path: impl AsRef<Path>,
        new_path: impl AsRef<Path>,
    ) -> Result<VaultRenamePreview, VaultError> {
        let old_path = normalize_relative_path(old_path.as_ref())?;
        let new_path = normalize_relative_path(new_path.as_ref())?;
        if old_path == new_path {
            return Err(LinkRenamePlanError::SamePath.into());
        }

        let before = self.snapshot()?;
        if !before.entries.iter().any(|entry| {
            entry.relative_path == old_path && entry.kind == VaultSnapshotEntryKind::File
        }) {
            return Err(VaultError::NotAFile(old_path));
        }

        let files = self.read_rename_files(&before)?;
        let after = self.snapshot()?;
        if before.revision_sha256 != after.revision_sha256 {
            return Err(VaultError::SnapshotChanged);
        }

        let old_path_text = path_to_slashes(&old_path)?;
        let new_path_text = path_to_slashes(&new_path)?;
        let plan = build_link_rename_plan(&files, &old_path_text, &new_path_text)?;
        let plan_id =
            rename_preview_identity(&before.revision_sha256, &old_path_text, &new_path_text);
        Ok(VaultRenamePreview {
            plan,
            snapshot_sha256: before.revision_sha256,
            plan_id,
        })
    }

    /// Reject a preview if any vault file, symlink or reference decision changed.
    pub fn verify_rename_preview(&self, preview: &VaultRenamePreview) -> Result<(), VaultError> {
        let current = self.build_rename_preview(&preview.plan.old_path, &preview.plan.new_path)?;
        if current == *preview {
            Ok(())
        } else {
            Err(VaultError::StaleRenamePreview)
        }
    }

    fn read_rename_files(
        &self,
        snapshot: &VaultSnapshot,
    ) -> Result<Vec<RenamePlanFile>, VaultError> {
        let mut files = Vec::new();
        for entry in &snapshot.entries {
            if entry.kind != VaultSnapshotEntryKind::File
                || !entry
                    .relative_path
                    .extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
            {
                continue;
            }

            let read = self.read(&entry.relative_path)?;
            if read.revision_sha256 != entry.revision_sha256 {
                return Err(VaultError::SnapshotChanged);
            }
            let Ok(source) = MarkdownSource::parse(read.document.as_bytes().to_vec()) else {
                continue;
            };
            files.push(RenamePlanFile {
                relative_path: path_to_slashes(&entry.relative_path)?,
                source,
            });
        }
        Ok(files)
    }

    fn resolve_vault_path(
        &self,
        relative_path: &Path,
        allow_missing_leaf: bool,
    ) -> Result<PathBuf, VaultError> {
        validate_relative_path(relative_path)?;
        let components: Vec<_> = relative_path.components().collect();
        let mut candidate = self.canonical_root.clone();
        for (index, component) in components.iter().enumerate() {
            candidate.push(component.as_os_str());
            let metadata = match fs::symlink_metadata(&candidate) {
                Ok(metadata) => metadata,
                Err(error)
                    if allow_missing_leaf
                        && index + 1 == components.len()
                        && error.kind() == io::ErrorKind::NotFound =>
                {
                    return Ok(candidate);
                }
                Err(error) => return Err(error.into()),
            };
            if metadata.file_type().is_symlink() {
                return Err(VaultError::Symlink(relative_path.to_path_buf()));
            }
            if index + 1 < components.len() && !metadata.is_dir() {
                return Err(VaultError::NotAFile(relative_path.to_path_buf()));
            }
            if index + 1 == components.len() && !metadata.is_file() {
                return Err(VaultError::NotAFile(relative_path.to_path_buf()));
            }
        }
        let canonical = fs::canonicalize(&candidate)?;
        if !canonical.starts_with(&self.canonical_root) {
            return Err(VaultError::OutsideRoot(relative_path.to_path_buf()));
        }
        Ok(canonical)
    }
}

static NEXT_OPERATION_ID: AtomicU64 = AtomicU64::new(0);

impl VaultStore {
    /// Open an existing vault and an existing app-owned data directory.
    /// Recovery history and journals are always kept outside the vault.
    pub fn open(
        vault_root: impl AsRef<Path>,
        app_data_root: impl AsRef<Path>,
    ) -> Result<Self, VaultError> {
        let root = VaultRoot::open(vault_root)?;
        let app_data_root = fs::canonicalize(app_data_root)?;
        if !app_data_root.is_dir() || app_data_root.starts_with(&root.canonical_root) {
            return Err(VaultError::InvalidDataDirectory(app_data_root));
        }
        Ok(Self {
            root,
            app_data_root,
            #[cfg(test)]
            fail_before_replace: false,
            #[cfg(test)]
            fail_committed_journal: false,
            #[cfg(test)]
            fail_rename_committed_journal: false,
            #[cfg(test)]
            fail_replace_path: None,
            #[cfg(test)]
            external_change_on_failure: None,
        })
    }

    pub fn root(&self) -> &VaultRoot {
        &self.root
    }

    /// Write a file only when its current SHA-256 revision matches the caller's
    /// expectation. Previous, conflicting and failed incoming bytes are stored
    /// under app-owned data; each operation is appended to `journal.jsonl`.
    pub fn write(&self, request: VaultWriteRequest) -> Result<VaultWriteResult, VaultError> {
        let relative_path = normalize_relative_path(&request.relative_path)?;
        let relative_path_text = path_to_slashes(&relative_path)?;
        let target_path = self.root.resolve_vault_path(&relative_path, true)?;
        let operation_id = next_operation_id();
        let before = self.read_if_present(&relative_path, &target_path)?;
        let current_revision = before.as_ref().map(|read| read.revision_sha256.clone());
        if current_revision.as_deref() != request.expected_revision_sha256.as_deref() {
            let preserved_path = self.preserve_bytes(
                "conflicts",
                &operation_id,
                ".incoming",
                &relative_path_text,
                &request.bytes,
                &sha256_hex(&request.bytes),
                request.expected_revision_sha256.as_deref(),
                current_revision.as_deref(),
            )?;
            self.append_journal(
                &operation_id,
                "conflict",
                &relative_path_text,
                request.expected_revision_sha256.as_deref(),
                &sha256_hex(&request.bytes),
                None,
            )?;
            return Err(VaultError::RevisionConflict {
                relative_path,
                expected_revision: request.expected_revision_sha256,
                current_revision,
                preserved_path,
            });
        }

        let next_revision = sha256_hex(&request.bytes);
        self.append_journal(
            &operation_id,
            "prepared",
            &relative_path_text,
            request.expected_revision_sha256.as_deref(),
            &next_revision,
            None,
        )?;

        if let Some(previous) = &before
            && let Err(error) = self.preserve_bytes(
                "recovery",
                &format!("{operation_id}-previous"),
                ".bin",
                &relative_path_text,
                previous.document.as_bytes(),
                &previous.revision_sha256,
                request.expected_revision_sha256.as_deref(),
                current_revision.as_deref(),
            )
        {
            let _ = self.append_journal(
                &operation_id,
                "failed",
                &relative_path_text,
                request.expected_revision_sha256.as_deref(),
                &next_revision,
                Some(&error.to_string()),
            );
            return Err(error);
        }

        let latest_revision = match self.read_if_present(&relative_path, &target_path) {
            Ok(read) => read.map(|read| read.revision_sha256),
            Err(error) => {
                let _ = self.preserve_bytes(
                    "failed",
                    &operation_id,
                    ".bin",
                    &relative_path_text,
                    &request.bytes,
                    &next_revision,
                    request.expected_revision_sha256.as_deref(),
                    current_revision.as_deref(),
                );
                let _ = self.append_journal(
                    &operation_id,
                    "failed",
                    &relative_path_text,
                    request.expected_revision_sha256.as_deref(),
                    &next_revision,
                    Some(&error.to_string()),
                );
                return Err(error);
            }
        };
        if latest_revision.as_deref() != current_revision.as_deref() {
            let preserved_path = self.preserve_bytes(
                "conflicts",
                &format!("{operation_id}-late-conflict"),
                ".incoming",
                &relative_path_text,
                &request.bytes,
                &next_revision,
                request.expected_revision_sha256.as_deref(),
                latest_revision.as_deref(),
            )?;
            let message = "vault file changed after the write was prepared";
            let _ = self.append_journal(
                &operation_id,
                "failed",
                &relative_path_text,
                request.expected_revision_sha256.as_deref(),
                &next_revision,
                Some(message),
            );
            return Err(VaultError::RevisionConflict {
                relative_path,
                expected_revision: request.expected_revision_sha256,
                current_revision: latest_revision,
                preserved_path,
            });
        }

        if let Err(error) =
            self.atomic_replace(&target_path, &relative_path, &operation_id, &request.bytes)
        {
            let preservation = self.preserve_bytes(
                "failed",
                &operation_id,
                ".bin",
                &relative_path_text,
                &request.bytes,
                &next_revision,
                request.expected_revision_sha256.as_deref(),
                current_revision.as_deref(),
            );
            let _ = self.append_journal(
                &operation_id,
                "failed",
                &relative_path_text,
                request.expected_revision_sha256.as_deref(),
                &next_revision,
                Some(&error.to_string()),
            );
            if let Err(preservation_error) = preservation {
                return Err(VaultError::RecoveryRequired {
                    relative_path,
                    reason: format!(
                        "write failed: {error}; preserving incoming bytes failed: {preservation_error}"
                    ),
                });
            }
            return Err(error);
        }

        if let Err(journal_error) = self.append_journal(
            &operation_id,
            "committed",
            &relative_path_text,
            request.expected_revision_sha256.as_deref(),
            &next_revision,
            None,
        ) {
            let rollback = self.rollback_single_write(
                &target_path,
                &relative_path,
                &operation_id,
                before.as_ref(),
                &next_revision,
            );
            let _ = self.append_journal(
                &operation_id,
                "failed",
                &relative_path_text,
                request.expected_revision_sha256.as_deref(),
                &next_revision,
                Some(&journal_error.to_string()),
            );
            if let Err(rollback_error) = rollback {
                return Err(VaultError::RecoveryRequired {
                    relative_path,
                    reason: format!(
                        "journal commit failed: {journal_error}; rollback failed: {rollback_error}"
                    ),
                });
            }
            return Err(journal_error);
        }

        Ok(VaultWriteResult {
            read: VaultRead {
                document: RawDocument::from_bytes(request.bytes),
                revision_sha256: next_revision,
            },
            operation_id,
        })
    }

    fn read_if_present(
        &self,
        relative_path: &Path,
        target_path: &Path,
    ) -> Result<Option<VaultRead>, VaultError> {
        match fs::symlink_metadata(target_path) {
            Ok(_) => self.root.read(relative_path).map(Some),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    fn atomic_replace(
        &self,
        target_path: &Path,
        relative_path: &Path,
        operation_id: &str,
        bytes: &[u8],
    ) -> Result<(), VaultError> {
        let parent = target_path.parent().ok_or(VaultError::InvalidPath)?;
        let file_name = target_path
            .file_name()
            .ok_or(VaultError::InvalidPath)?
            .to_string_lossy();
        let temporary_path = parent.join(format!(".{file_name}.{operation_id}.tmp"));
        let result = (|| -> io::Result<()> {
            let mut temporary = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary_path)?;
            temporary.write_all(bytes)?;
            temporary.sync_all()?;
            drop(temporary);
            #[cfg(test)]
            if self.fail_before_replace || self.fail_replace_path.as_deref() == Some(relative_path)
            {
                if let Some((external_path, external_bytes)) = &self.external_change_on_failure {
                    let external_path = self
                        .root
                        .resolve_vault_path(external_path, false)
                        .map_err(|error| io::Error::other(error.to_string()))?;
                    fs::write(external_path, external_bytes)?;
                }
                return Err(io::Error::other("injected atomic replace failure"));
            }
            replace_temporary(&temporary_path, target_path, operation_id)
        })();

        if temporary_path.exists() {
            let _ = fs::remove_file(&temporary_path);
        }
        result.map_err(|source| VaultError::WriteFailed {
            relative_path: relative_path.to_path_buf(),
            source,
        })
    }

    fn rollback_single_write(
        &self,
        target_path: &Path,
        relative_path: &Path,
        operation_id: &str,
        before: Option<&VaultRead>,
        next_revision: &str,
    ) -> Result<(), String> {
        let current = match self.root.read(relative_path) {
            Ok(current) => Some(current),
            Err(VaultError::Root(error)) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.to_string()),
        };
        if current.as_ref().map(|read| read.revision_sha256.as_str()) != Some(next_revision) {
            if current.is_none() && before.is_none() {
                return Ok(());
            }
            return Err("file changed after the write; rollback left it untouched".to_owned());
        }
        match before {
            Some(previous) => self
                .atomic_replace(
                    target_path,
                    relative_path,
                    &format!("{operation_id}-rollback"),
                    previous.document.as_bytes(),
                )
                .map_err(|error| error.to_string()),
            None => fs::remove_file(target_path).map_err(|error| error.to_string()),
        }
    }

    fn append_journal(
        &self,
        operation_id: &str,
        state: &str,
        relative_path: &str,
        expected_revision: Option<&str>,
        next_revision: &str,
        error: Option<&str>,
    ) -> Result<(), VaultError> {
        #[cfg(test)]
        if state == "committed" && self.fail_committed_journal {
            return Err(VaultError::Journal(io::Error::other(
                "injected committed journal failure",
            )));
        }
        let error_json = error.map_or_else(|| "null".to_owned(), json_string);
        let line = format!(
            "{{\"id\":{},\"operation\":\"write\",\"state\":{},\"relative_path\":{},\"expected_revision\":{},\"next_revision\":{},\"recorded_at\":{},\"error\":{}}}\n",
            json_string(operation_id),
            json_string(state),
            json_string(relative_path),
            json_option_string(expected_revision),
            json_string(next_revision),
            json_string(&timestamp()),
            error_json,
        );
        self.append_journal_line(&line)
    }

    fn append_journal_line(&self, line: &str) -> Result<(), VaultError> {
        let journal_path = self.app_data_root.join("journal.jsonl");
        match fs::symlink_metadata(&journal_path) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(VaultError::InvalidDataDirectory(journal_path));
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        let mut journal = OpenOptions::new()
            .create(true)
            .append(true)
            .open(journal_path)
            .map_err(VaultError::Journal)?;
        journal
            .write_all(line.as_bytes())
            .map_err(VaultError::Journal)?;
        journal.sync_all().map_err(VaultError::Journal)?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn preserve_bytes(
        &self,
        category: &str,
        record_id: &str,
        extension: &str,
        relative_path: &str,
        bytes: &[u8],
        revision: &str,
        expected_revision: Option<&str>,
        current_revision: Option<&str>,
    ) -> Result<PathBuf, VaultError> {
        let directory = self.app_data_root.join(category);
        match fs::symlink_metadata(&directory) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(VaultError::InvalidDataDirectory(directory));
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => fs::create_dir(&directory)?,
            Err(error) => return Err(error.into()),
        }
        let canonical_directory = fs::canonicalize(&directory)?;
        if !canonical_directory.starts_with(&self.app_data_root) {
            return Err(VaultError::InvalidDataDirectory(directory));
        }
        let artifact_path = canonical_directory.join(format!("{record_id}{extension}"));
        let record_path = canonical_directory.join(format!("{record_id}.json"));
        write_new_file(&artifact_path, bytes)?;
        let record = format!(
            "{{\"id\":{},\"relative_path\":{},\"revision\":{},\"bytes\":{},\"path\":{},\"captured_at\":{},\"expected_revision\":{},\"current_revision\":{}}}\n",
            json_string(record_id),
            json_string(relative_path),
            json_string(revision),
            bytes.len(),
            json_string(&artifact_path.to_string_lossy()),
            json_string(&timestamp()),
            json_option_string(expected_revision),
            json_option_string(current_revision),
        );
        if let Err(error) = write_new_file(&record_path, record.as_bytes()) {
            let _ = fs::remove_file(&artifact_path);
            return Err(error.into());
        }
        Ok(artifact_path)
    }
}

fn replace_temporary(
    temporary_path: &Path,
    target_path: &Path,
    operation_id: &str,
) -> io::Result<()> {
    #[cfg(windows)]
    {
        if fs::symlink_metadata(target_path).is_ok() {
            let file_name = target_path
                .file_name()
                .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing target name"))?
                .to_string_lossy();
            let backup_path = target_path
                .parent()
                .ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidInput, "missing target parent")
                })?
                .join(format!(".{file_name}.{operation_id}.backup"));
            fs::rename(target_path, &backup_path)?;
            if let Err(error) = fs::rename(temporary_path, target_path) {
                if let Err(restore_error) = fs::rename(&backup_path, target_path) {
                    return Err(io::Error::other(format!(
                        "replace failed: {error}; restoring previous file failed: {restore_error}"
                    )));
                }
                return Err(error);
            }
            // The previous bytes are already preserved in app-owned recovery
            // history. If Windows refuses to remove this backup, keep the new
            // target and treat the replacement as committed; reporting failure
            // here would leave callers believing the old bytes were restored.
            let _ = fs::remove_file(&backup_path);
            return Ok(());
        }
    }
    #[cfg(not(windows))]
    let _ = operation_id;
    fs::rename(temporary_path, target_path)
}

fn write_new_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    let result = file.write_all(bytes).and_then(|()| file.sync_all());
    drop(file);
    if let Err(error) = result {
        let _ = fs::remove_file(path);
        return Err(error);
    }
    Ok(())
}

fn next_operation_id() -> String {
    let ticks = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = NEXT_OPERATION_ID.fetch_add(1, Ordering::Relaxed);
    format!("{}-{ticks}-{sequence}", std::process::id())
}

fn timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

fn json_option_string(value: Option<&str>) -> String {
    value.map_or_else(|| "null".to_owned(), json_string)
}

fn json_string(value: &str) -> String {
    let mut output = String::from("\"");
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            character if character <= '\u{1f}' => {
                write!(output, "\\u{:04x}", character as u32)
                    .expect("writing into a String cannot fail");
            }
            character => output.push(character),
        }
    }
    output.push('"');
    output
}

fn normalize_relative_path(path: &Path) -> Result<PathBuf, VaultError> {
    let text = path.to_str().ok_or(VaultError::InvalidPath)?;
    let portable = text.replace('\\', "/");
    let normalized = PathBuf::from(portable);
    validate_relative_path(&normalized)?;
    Ok(normalized)
}

fn path_to_slashes(path: &Path) -> Result<String, VaultError> {
    Ok(path
        .to_str()
        .ok_or(VaultError::InvalidPath)?
        .replace('\\', "/"))
}

fn snapshot_directory(
    root: &Path,
    directory: &Path,
    output: &mut Vec<VaultSnapshotEntry>,
) -> Result<(), VaultError> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let relative_path = path
            .strip_prefix(root)
            .map_err(|_| VaultError::OutsideRoot(path.clone()))?
            .to_path_buf();
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            let target = fs::read_link(&path)?;
            let target_bytes = target.as_os_str().as_encoded_bytes();
            output.push(VaultSnapshotEntry {
                relative_path,
                kind: VaultSnapshotEntryKind::Symlink,
                size_bytes: target_bytes.len() as u64,
                revision_sha256: sha256_hex(target_bytes),
                symlink_target: Some(target),
            });
        } else if file_type.is_dir() {
            snapshot_directory(root, &path, output)?;
        } else if file_type.is_file() {
            let bytes = fs::read(&path)?;
            output.push(VaultSnapshotEntry {
                relative_path,
                kind: VaultSnapshotEntryKind::File,
                size_bytes: bytes.len() as u64,
                revision_sha256: sha256_hex(&bytes),
                symlink_target: None,
            });
        } else {
            return Err(VaultError::UnsupportedEntry(relative_path));
        }
    }
    Ok(())
}

fn snapshot_revision(entries: &[VaultSnapshotEntry]) -> String {
    let mut digest = Sha256::new();
    digest.update(b"openobsidian-vault-snapshot-v1");
    for entry in entries {
        digest.update([match entry.kind {
            VaultSnapshotEntryKind::File => 1,
            VaultSnapshotEntryKind::Symlink => 2,
        }]);
        update_hash_field(
            &mut digest,
            entry.relative_path.as_os_str().as_encoded_bytes(),
        );
        update_hash_field(&mut digest, &entry.size_bytes.to_be_bytes());
        update_hash_field(&mut digest, entry.revision_sha256.as_bytes());
        if let Some(target) = &entry.symlink_target {
            update_hash_field(&mut digest, target.as_os_str().as_encoded_bytes());
        }
    }
    sha256_digest_hex(digest)
}

fn update_hash_field(digest: &mut Sha256, bytes: &[u8]) {
    digest.update((bytes.len() as u64).to_be_bytes());
    digest.update(bytes);
}

fn rename_preview_identity(snapshot: &str, old_path: &str, new_path: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(b"openobsidian-rename-preview-v1");
    update_hash_field(&mut digest, snapshot.as_bytes());
    update_hash_field(&mut digest, old_path.as_bytes());
    update_hash_field(&mut digest, new_path.as_bytes());
    sha256_digest_hex(digest)
}

fn sha256_digest_hex(digest: Sha256) -> String {
    let digest = digest.finalize();
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut output, "{byte:02x}").expect("writing into a String cannot fail");
    }
    output
}

fn scan_directory(
    root: &Path,
    directory: &Path,
    output: &mut Vec<VaultEntry>,
) -> Result<(), VaultError> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        // Do not follow symlinks during a vault scan.
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            scan_directory(root, &path, output)?;
        } else if file_type.is_file()
            && path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            output.push(VaultEntry {
                relative_path: path
                    .strip_prefix(root)
                    .map_err(|_| VaultError::OutsideRoot(path.clone()))?
                    .to_path_buf(),
            });
        }
    }
    Ok(())
}

fn validate_relative_path(path: &Path) -> Result<(), VaultError> {
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(VaultError::InvalidPath);
    }
    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(bytes);
    sha256_digest_hex(digest)
}

#[cfg(test)]
mod tests {
    use super::{VaultError, VaultRoot, VaultStore, VaultWriteRequest, sha256_hex};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEMP_DIR_ID: AtomicU64 = AtomicU64::new(0);

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let temp_root = std::env::temp_dir();
            loop {
                let id = NEXT_TEMP_DIR_ID.fetch_add(1, Ordering::Relaxed);
                let path =
                    temp_root.join(format!("openobsidian-vault-{}-{id}", std::process::id()));
                match fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("creating test vault {}: {error}", path.display()),
                }
            }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn scans_and_reads_without_changing_vault_bytes() {
        let temp = TempDir::new();
        let note = temp.0.join("nested").join("note.MD");
        fs::create_dir_all(note.parent().unwrap()).unwrap();
        let bytes = b"\xef\xbb\xbf# Note\r\nunknown: untouched\r\n";
        fs::write(&note, bytes).unwrap();

        let vault = VaultRoot::open(&temp.0).unwrap();
        let entries = vault.scan_markdown().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].relative_path, PathBuf::from("nested/note.MD"));
        assert_eq!(
            vault.read("nested/note.MD").unwrap().document.as_bytes(),
            bytes
        );
        assert_eq!(fs::read(note).unwrap(), bytes);
    }

    #[test]
    fn rejects_parent_traversal_before_reading() {
        let temp = TempDir::new();
        let vault = VaultRoot::open(&temp.0).unwrap();
        assert!(vault.read("../outside.md").is_err());
    }

    #[test]
    fn snapshots_hash_all_regular_files_and_notice_content_changes() {
        let temp = TempDir::new();
        let note = temp.0.join("note.md");
        let asset = temp.0.join("asset.bin");
        fs::write(&note, b"# Note\r\n").unwrap();
        fs::write(&asset, [0, 255, 7, 10]).unwrap();

        let vault = VaultRoot::open(&temp.0).unwrap();
        let before = vault.snapshot().unwrap();
        assert_eq!(before.entries.len(), 2);
        assert_ne!(
            before.entries[0].revision_sha256,
            before.entries[1].revision_sha256
        );

        fs::write(&asset, [0, 255, 7, 11]).unwrap();
        let after = vault.snapshot().unwrap();
        assert_ne!(before.revision_sha256, after.revision_sha256);
    }

    #[test]
    fn rename_preview_is_snapshot_bound_and_does_not_change_vault_bytes() {
        let temp = TempDir::new();
        let index = temp.0.join("Index.md");
        let original = b"\xef\xbb\xbf[[Old|alias]]\r\n";
        fs::write(&index, original).unwrap();
        fs::write(temp.0.join("Old.md"), b"# Old\n").unwrap();

        let vault = VaultRoot::open(&temp.0).unwrap();
        let preview = vault.build_rename_preview("Old.md", "New.md").unwrap();
        assert_eq!(preview.plan.update_count, 1);
        assert_eq!(preview.plan_id.len(), 64);
        vault.verify_rename_preview(&preview).unwrap();
        assert_eq!(fs::read(&index).unwrap(), original);

        fs::write(&index, b"external edit\n").unwrap();
        assert!(matches!(
            vault.verify_rename_preview(&preview),
            Err(super::VaultError::StaleRenamePreview)
        ));
        assert_eq!(fs::read(temp.0.join("Old.md")).unwrap(), b"# Old\n");
    }

    #[cfg(unix)]
    #[test]
    fn snapshots_symlinks_without_following_them_and_reads_reject_them() {
        use std::os::unix::fs::symlink;

        let temp = TempDir::new();
        fs::write(temp.0.join("target.md"), b"# Target\n").unwrap();
        symlink("target.md", temp.0.join("alias.md")).unwrap();

        let vault = VaultRoot::open(&temp.0).unwrap();
        let snapshot = vault.snapshot().unwrap();
        let alias = snapshot
            .entries
            .iter()
            .find(|entry| entry.relative_path == std::path::Path::new("alias.md"))
            .unwrap();
        assert_eq!(alias.kind, super::VaultSnapshotEntryKind::Symlink);
        assert_eq!(
            alias.symlink_target.as_deref(),
            Some(std::path::Path::new("target.md"))
        );
        assert!(matches!(
            vault.read("alias.md"),
            Err(super::VaultError::Symlink(_))
        ));
    }

    #[test]
    fn revision_checked_writes_preserve_previous_bytes_and_journal_the_operation() {
        let vault_temp = TempDir::new();
        let app_data_temp = TempDir::new();
        let note_path = vault_temp.0.join("note.md");
        let original = b"\xef\xbb\xbfstatus: old\r\n";
        let next = b"\xef\xbb\xbfstatus: new\r\n";
        fs::write(&note_path, original).unwrap();
        let store = VaultStore::open(&vault_temp.0, &app_data_temp.0).unwrap();
        let before = store.root().read("note.md").unwrap();

        let result = store
            .write(VaultWriteRequest {
                relative_path: PathBuf::from("note.md"),
                expected_revision_sha256: Some(before.revision_sha256),
                bytes: next.to_vec(),
            })
            .unwrap();

        assert_eq!(fs::read(&note_path).unwrap(), next);
        assert_eq!(result.read.document.as_bytes(), next);
        assert_ne!(result.read.revision_sha256, sha256_hex(original));
        let recovery_dir = app_data_temp.0.join("recovery");
        let recovery_bytes = fs::read_dir(recovery_dir)
            .unwrap()
            .map(Result::unwrap)
            .find(|entry| {
                entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == std::ffi::OsStr::new("bin"))
            })
            .map(|entry| fs::read(entry.path()).unwrap())
            .unwrap();
        assert_eq!(recovery_bytes, original);
        let journal = fs::read_to_string(app_data_temp.0.join("journal.jsonl")).unwrap();
        assert!(journal.contains("\"state\":\"prepared\""));
        assert!(journal.contains("\"state\":\"committed\""));
        assert!(journal.contains(&result.operation_id));
    }

    #[test]
    fn stale_writes_preserve_incoming_bytes_without_replacing_external_changes() {
        let vault_temp = TempDir::new();
        let app_data_temp = TempDir::new();
        let note_path = vault_temp.0.join("note.md");
        fs::write(&note_path, b"original\n").unwrap();
        let store = VaultStore::open(&vault_temp.0, &app_data_temp.0).unwrap();
        let stale = store.root().read("note.md").unwrap();
        let external = b"external edit\n";
        let incoming = b"agent edit\n";
        fs::write(&note_path, external).unwrap();

        let result = store.write(VaultWriteRequest {
            relative_path: PathBuf::from("note.md"),
            expected_revision_sha256: Some(stale.revision_sha256),
            bytes: incoming.to_vec(),
        });
        let preserved_path = match result {
            Err(VaultError::RevisionConflict { preserved_path, .. }) => preserved_path,
            _ => panic!("stale write did not return a preserved revision conflict"),
        };

        assert_eq!(fs::read(&note_path).unwrap(), external);
        assert_eq!(fs::read(preserved_path).unwrap(), incoming);
    }

    #[test]
    fn failed_atomic_write_keeps_original_and_preserves_incoming_bytes() {
        let vault_temp = TempDir::new();
        let app_data_temp = TempDir::new();
        let note_path = vault_temp.0.join("note.md");
        let original = b"original\n";
        let incoming = b"incoming\n";
        fs::write(&note_path, original).unwrap();
        let mut store = VaultStore::open(&vault_temp.0, &app_data_temp.0).unwrap();
        store.fail_before_replace = true;
        let expected = store.root().read("note.md").unwrap().revision_sha256;

        let error = store
            .write(VaultWriteRequest {
                relative_path: PathBuf::from("note.md"),
                expected_revision_sha256: Some(expected),
                bytes: incoming.to_vec(),
            })
            .unwrap_err();

        assert!(
            error
                .to_string()
                .contains("injected atomic replace failure")
        );
        assert_eq!(fs::read(&note_path).unwrap(), original);
        let failed_dir = app_data_temp.0.join("failed");
        let failed_bytes = fs::read_dir(failed_dir)
            .unwrap()
            .map(Result::unwrap)
            .find(|entry| {
                entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == std::ffi::OsStr::new("bin"))
            })
            .map(|entry| fs::read(entry.path()).unwrap())
            .unwrap();
        assert_eq!(failed_bytes, incoming);
        assert!(
            !fs::read_dir(&vault_temp.0)
                .unwrap()
                .map(Result::unwrap)
                .any(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
        );
        let journal = fs::read_to_string(app_data_temp.0.join("journal.jsonl")).unwrap();
        assert!(journal.contains("\"state\":\"failed\""));
    }

    #[test]
    fn failed_commit_journal_rolls_back_a_new_file() {
        let vault_temp = TempDir::new();
        let app_data_temp = TempDir::new();
        let note_path = vault_temp.0.join("new.md");
        let mut store = VaultStore::open(&vault_temp.0, &app_data_temp.0).unwrap();
        store.fail_committed_journal = true;

        let error = store
            .write(VaultWriteRequest {
                relative_path: PathBuf::from("new.md"),
                expected_revision_sha256: None,
                bytes: b"new note\n".to_vec(),
            })
            .unwrap_err();

        assert!(
            error
                .to_string()
                .contains("injected committed journal failure")
        );
        assert!(!note_path.exists());
        let journal = fs::read_to_string(app_data_temp.0.join("journal.jsonl")).unwrap();
        assert!(journal.contains("\"state\":\"prepared\""));
        assert!(journal.contains("\"state\":\"failed\""));
    }

    #[test]
    fn rename_transaction_moves_source_and_updates_only_planned_targets() {
        let vault_temp = TempDir::new();
        let app_data_temp = TempDir::new();
        fs::create_dir(vault_temp.0.join("Archive")).unwrap();
        let index_path = vault_temp.0.join("Index.md");
        let old_path = vault_temp.0.join("Old.md");
        let index = "\u{feff}🌱 [[Old|alias]] [Old](Old.md#Section) ![[Old#^block]]\r\n".as_bytes();
        let original = b"# Section\n\nOpening paragraph ^block\n\n[[Old#Section]]\n";
        fs::write(&index_path, index).unwrap();
        fs::write(&old_path, original).unwrap();
        let store = VaultStore::open(&vault_temp.0, &app_data_temp.0).unwrap();
        let preview = store
            .root()
            .build_rename_preview("Old.md", "Archive/New.md")
            .unwrap();

        let result = store.apply_rename_preview(&preview).unwrap();

        let new_path = vault_temp.0.join("Archive").join("New.md");
        assert!(!old_path.exists());
        assert_eq!(
            fs::read(&index_path).unwrap(),
            "\u{feff}🌱 [[Archive/New|alias]] [Old](Archive/New.md#Section) ![[Archive/New#^block]]\r\n"
                .as_bytes()
        );
        assert_eq!(
            fs::read(&new_path).unwrap(),
            b"# Section\n\nOpening paragraph ^block\n\n[[Archive/New#Section]]\n"
        );
        assert_eq!(result.old_path, PathBuf::from("Old.md"));
        assert_eq!(result.new_path, PathBuf::from("Archive/New.md"));
        assert_eq!(result.updated_references, 4);
        assert_eq!(
            result.read.document.as_bytes(),
            fs::read(new_path).unwrap().as_slice()
        );
        let journal = fs::read_to_string(app_data_temp.0.join("journal.jsonl")).unwrap();
        assert!(journal.contains("\"operation\":\"rename\",\"state\":\"prepared\""));
        assert!(journal.contains("\"operation\":\"rename\",\"state\":\"committed\""));
    }

    #[test]
    fn rename_refuses_an_existing_destination_without_changing_either_file() {
        let vault_temp = TempDir::new();
        let app_data_temp = TempDir::new();
        fs::create_dir(vault_temp.0.join("Archive")).unwrap();
        let original = b"# Old\n";
        let destination = b"destination stays\n";
        fs::write(vault_temp.0.join("Old.md"), original).unwrap();
        fs::write(vault_temp.0.join("Archive/New.md"), destination).unwrap();
        let store = VaultStore::open(&vault_temp.0, &app_data_temp.0).unwrap();
        let preview = store
            .root()
            .build_rename_preview("Old.md", "Archive/New.md")
            .unwrap();

        let error = store.apply_rename_preview(&preview).unwrap_err();

        assert!(matches!(error, VaultError::RenameDestinationExists(_)));
        assert_eq!(fs::read(vault_temp.0.join("Old.md")).unwrap(), original);
        assert_eq!(
            fs::read(vault_temp.0.join("Archive/New.md")).unwrap(),
            destination
        );
        assert!(!app_data_temp.0.join("journal.jsonl").exists());
    }

    #[test]
    fn failed_rename_restores_prior_writes_and_moves_source_back() {
        let vault_temp = TempDir::new();
        let app_data_temp = TempDir::new();
        fs::create_dir(vault_temp.0.join("Archive")).unwrap();
        for name in ["A.md", "B.md"] {
            fs::write(vault_temp.0.join(name), b"[[Old]]\n").unwrap();
        }
        let old_path = vault_temp.0.join("Old.md");
        fs::write(&old_path, b"# Old\n").unwrap();
        let mut store = VaultStore::open(&vault_temp.0, &app_data_temp.0).unwrap();
        store.fail_replace_path = Some(PathBuf::from("B.md"));
        let preview = store
            .root()
            .build_rename_preview("Old.md", "Archive/New.md")
            .unwrap();

        let error = store.apply_rename_preview(&preview).unwrap_err();

        assert!(
            error
                .to_string()
                .contains("injected atomic replace failure")
        );
        assert!(old_path.exists());
        assert!(!vault_temp.0.join("Archive/New.md").exists());
        assert_eq!(fs::read(vault_temp.0.join("A.md")).unwrap(), b"[[Old]]\n");
        assert_eq!(fs::read(vault_temp.0.join("B.md")).unwrap(), b"[[Old]]\n");
        let journal = fs::read_to_string(app_data_temp.0.join("journal.jsonl")).unwrap();
        assert!(journal.contains("\"operation\":\"rename\",\"state\":\"rolled_back\""));
    }

    #[test]
    fn failed_rename_commit_journal_rolls_back_reference_writes_and_source_move() {
        let vault_temp = TempDir::new();
        let app_data_temp = TempDir::new();
        fs::create_dir(vault_temp.0.join("Archive")).unwrap();
        let index_path = vault_temp.0.join("Index.md");
        let old_path = vault_temp.0.join("Old.md");
        let index = b"[[Old]]\n";
        let source = b"# Old\n";
        fs::write(&index_path, index).unwrap();
        fs::write(&old_path, source).unwrap();
        let mut store = VaultStore::open(&vault_temp.0, &app_data_temp.0).unwrap();
        store.fail_rename_committed_journal = true;
        let preview = store
            .root()
            .build_rename_preview("Old.md", "Archive/New.md")
            .unwrap();

        let error = store.apply_rename_preview(&preview).unwrap_err();

        assert!(
            error
                .to_string()
                .contains("injected rename commit journal failure")
        );
        assert_eq!(fs::read(&index_path).unwrap(), index);
        assert_eq!(fs::read(&old_path).unwrap(), source);
        assert!(!vault_temp.0.join("Archive/New.md").exists());
        let journal = fs::read_to_string(app_data_temp.0.join("journal.jsonl")).unwrap();
        assert!(journal.contains("\"operation\":\"rename\",\"state\":\"prepared\""));
        assert!(journal.contains("\"operation\":\"rename\",\"state\":\"rolled_back\""));
        assert!(!journal.contains("\"operation\":\"rename\",\"state\":\"committed\""));
    }

    #[test]
    fn rename_rollback_preserves_an_external_reference_edit() {
        let vault_temp = TempDir::new();
        let app_data_temp = TempDir::new();
        fs::create_dir(vault_temp.0.join("Archive")).unwrap();
        fs::write(vault_temp.0.join("A.md"), b"[[Old]]\n").unwrap();
        fs::write(vault_temp.0.join("B.md"), b"[[Old]]\n").unwrap();
        let old_path = vault_temp.0.join("Old.md");
        fs::write(&old_path, b"# Old\n").unwrap();
        let mut store = VaultStore::open(&vault_temp.0, &app_data_temp.0).unwrap();
        let external = b"external edit\n";
        store.fail_replace_path = Some(PathBuf::from("B.md"));
        store.external_change_on_failure = Some((PathBuf::from("A.md"), external.to_vec()));
        let preview = store
            .root()
            .build_rename_preview("Old.md", "Archive/New.md")
            .unwrap();

        let error = store.apply_rename_preview(&preview).unwrap_err();

        assert!(matches!(
            error,
            VaultError::RenameTransactionRecoveryRequired { .. }
        ));
        assert!(old_path.exists());
        assert!(!vault_temp.0.join("Archive/New.md").exists());
        assert_eq!(fs::read(vault_temp.0.join("A.md")).unwrap(), external);
        assert_eq!(fs::read(vault_temp.0.join("B.md")).unwrap(), b"[[Old]]\n");
        let preserved_external_edit = fs::read_dir(app_data_temp.0.join("conflicts"))
            .unwrap()
            .map(Result::unwrap)
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == std::ffi::OsStr::new("incoming"))
            })
            .any(|entry| fs::read(entry.path()).is_ok_and(|bytes| bytes.as_slice() == external));
        assert!(preserved_external_edit);
    }
}
