use super::{
    LinkRenameAction, RawDocument, VaultError, VaultRead, VaultRenamePreview, VaultSnapshot,
    VaultSnapshotEntryKind, VaultStore, VaultWriteRequest, json_string, next_operation_id,
    normalize_relative_path, path_to_slashes, sha256_hex, timestamp,
};
use openobsidian_doc::SourceSpan;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultRenameResult {
    pub operation_id: String,
    pub plan_id: String,
    pub old_path: PathBuf,
    pub new_path: PathBuf,
    pub updated_references: usize,
    pub skipped_references: usize,
    pub warnings: Vec<String>,
    pub read: VaultRead,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultRenameRecoveryIssue {
    pub operation_id: String,
    pub reason: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct VaultRenameRecoveryReport {
    pub recovered_operations: Vec<String>,
    pub needs_attention: Vec<VaultRenameRecoveryIssue>,
}

#[derive(Clone, Debug)]
struct RenameJournalFile {
    source_path: PathBuf,
    target_path: PathBuf,
    before_revision: String,
    after_revision: String,
    before_file: String,
}

#[derive(Clone, Debug)]
struct RenameJournalRecord {
    operation_id: String,
    plan_id: String,
    old_path: PathBuf,
    new_path: PathBuf,
    paths: Vec<String>,
    case_only: bool,
    temporary_path: Option<PathBuf>,
    files: Vec<RenameJournalFile>,
}

#[derive(Clone, Debug)]
struct RenameUpdate {
    source_path: PathBuf,
    target_path: PathBuf,
    before: VaultRead,
    next_bytes: Vec<u8>,
}

#[derive(Clone, Debug)]
struct WrittenRenameUpdate {
    target_path: PathBuf,
    before: VaultRead,
    written_revision: String,
}

#[derive(Default)]
struct RenameMoveState {
    moved: bool,
    temporary_path: Option<PathBuf>,
}

impl VaultStore {
    /// Apply a vault-bound rename preview as a journaled multi-file transaction.
    /// Each target is revision-checked before replacement. If a step fails,
    /// completed writes are rolled back only while their written revisions are
    /// still present; concurrent edits are preserved as conflicts.
    pub fn apply_rename_preview(
        &self,
        preview: &VaultRenamePreview,
    ) -> Result<VaultRenameResult, VaultError> {
        self.root.verify_rename_preview(preview)?;
        let old_path = normalize_relative_path(Path::new(preview.plan.old_path.as_str()))?;
        let new_path = normalize_relative_path(Path::new(preview.plan.new_path.as_str()))?;
        if old_path == new_path {
            return Err(VaultError::StaleRenamePreview);
        }
        let snapshot = self.root.snapshot()?;
        if snapshot.revision_sha256 != preview.snapshot_sha256 {
            return Err(VaultError::SnapshotChanged);
        }

        let old_path_text = path_to_slashes(&old_path)?;
        let new_path_text = path_to_slashes(&new_path)?;
        let case_only = cfg!(windows)
            && old_path_text != new_path_text
            && old_path_text.eq_ignore_ascii_case(&new_path_text);
        let source_absolute_path = self.root.resolve_vault_path(&old_path, false)?;
        let destination_candidate = self.root.resolve_vault_path(&new_path, true)?;
        match fs::symlink_metadata(&destination_candidate) {
            Ok(_) if !case_only => {
                return Err(VaultError::RenameDestinationExists(new_path));
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        let destination_absolute_path = self.root.canonical_root.join(&new_path);

        let updates = self.build_rename_updates(preview, &old_path, &new_path, &snapshot)?;
        let source_update = updates
            .iter()
            .find(|update| update.source_path == old_path)
            .ok_or(VaultError::StaleRenamePreview)?;
        let operation_id = next_operation_id();
        let mut journal_paths = journal_paths(&updates, &old_path, &new_path)?;
        let mut journal_files = Vec::with_capacity(updates.len());
        for (index, update) in updates.iter().enumerate() {
            let before_record = format!("{operation_id}-rename-before-{index}");
            let before_file = format!("{before_record}.bin");
            let relative_path_text = path_to_slashes(&update.source_path)?;
            if let Err(error) = self.preserve_bytes(
                "recovery",
                &before_record,
                ".bin",
                &relative_path_text,
                update.before.document.as_bytes(),
                &update.before.revision_sha256,
                Some(&update.before.revision_sha256),
                Some(&update.before.revision_sha256),
            ) {
                return Err(self.finish_pre_mutation_failure(
                    error,
                    &operation_id,
                    preview,
                    &journal_paths,
                ));
            }
            journal_files.push(RenameJournalFile {
                source_path: update.source_path.clone(),
                target_path: update.target_path.clone(),
                before_revision: update.before.revision_sha256.clone(),
                after_revision: sha256_hex(&update.next_bytes),
                before_file,
            });
        }
        let temporary_path = if case_only {
            let file_name = old_path
                .file_name()
                .ok_or(VaultError::InvalidPath)?
                .to_string_lossy();
            Some(
                old_path
                    .parent()
                    .unwrap_or_else(|| Path::new(""))
                    .join(format!(".{file_name}.{operation_id}.rename.tmp")),
            )
        } else {
            None
        };
        if let Some(path) = &temporary_path {
            journal_paths.push(path_to_slashes(path)?);
            journal_paths.sort();
            journal_paths.dedup();
        }
        let journal_record = RenameJournalRecord {
            operation_id: operation_id.clone(),
            plan_id: preview.plan_id.clone(),
            old_path: old_path.clone(),
            new_path: new_path.clone(),
            paths: journal_paths,
            case_only,
            temporary_path,
            files: journal_files,
        };
        self.append_rename_manifest(&journal_record, "prepared", None)?;

        let mut move_state = RenameMoveState::default();
        let mut written = Vec::new();
        let apply_result = (|| -> Result<(), VaultError> {
            self.verify_source_revision(
                &old_path,
                &source_absolute_path,
                source_update,
                &operation_id,
            )?;
            match fs::symlink_metadata(&destination_candidate) {
                Ok(_) if !case_only => {
                    return Err(VaultError::RenameDestinationExists(new_path.clone()));
                }
                Ok(_) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }

            move_vault_file(
                &source_absolute_path,
                &destination_absolute_path,
                &operation_id,
                case_only,
                &mut move_state,
            )
            .map_err(|source| VaultError::WriteFailed {
                relative_path: old_path.clone(),
                source,
            })?;

            for update in &updates {
                if update.next_bytes == update.before.document.as_bytes() {
                    continue;
                }
                let write_result = self.write(VaultWriteRequest {
                    relative_path: update.target_path.clone(),
                    expected_revision_sha256: Some(update.before.revision_sha256.clone()),
                    bytes: update.next_bytes.clone(),
                });
                let result = match write_result {
                    Ok(result) => result,
                    Err(error) => {
                        let next_revision = sha256_hex(&update.next_bytes);
                        if let Ok(current) = self.root.read(&update.target_path)
                            && current.revision_sha256 == next_revision
                        {
                            written.push(WrittenRenameUpdate {
                                target_path: update.target_path.clone(),
                                before: update.before.clone(),
                                written_revision: next_revision,
                            });
                        }
                        return Err(error);
                    }
                };
                written.push(WrittenRenameUpdate {
                    target_path: update.target_path.clone(),
                    before: update.before.clone(),
                    written_revision: result.read.revision_sha256,
                });
            }

            self.append_rename_manifest(&journal_record, "committed", None)?;
            Ok(())
        })();

        if let Err(error) = apply_result {
            let mut recovery_errors = self.rollback_rename(
                &old_path,
                &new_path,
                &source_absolute_path,
                &destination_absolute_path,
                case_only,
                &updates,
                &written,
                &mut move_state,
                &operation_id,
            );
            let state = if recovery_errors.is_empty() {
                "rolled_back"
            } else {
                "recovery_required"
            };
            if let Err(journal_error) =
                self.append_rename_manifest(&journal_record, state, Some(&error.to_string()))
            {
                recovery_errors.push(format!("{state} journal append: {journal_error}"));
            }
            if !recovery_errors.is_empty() {
                return Err(VaultError::RenameTransactionRecoveryRequired {
                    old_path,
                    new_path,
                    reason: format!(
                        "transaction failed: {error}; rollback/recovery: {}",
                        recovery_errors.join("; ")
                    ),
                });
            }
            return Err(error);
        }

        Ok(VaultRenameResult {
            operation_id,
            plan_id: preview.plan_id.clone(),
            old_path,
            new_path,
            updated_references: preview.plan.update_count,
            skipped_references: preview.plan.skipped_count,
            warnings: preview.plan.warnings.clone(),
            read: VaultRead {
                document: RawDocument::from_bytes(source_update.next_bytes.clone()),
                revision_sha256: sha256_hex(&source_update.next_bytes),
            },
        })
    }

    /// Restore any rename transaction whose journal has no terminal outcome.
    /// Recovery is idempotent and only restores a file when its current
    /// revision matches the transaction's recorded post-write revision.
    pub fn recover_pending_rename_transactions(
        &self,
    ) -> Result<VaultRenameRecoveryReport, VaultError> {
        let journal_path = self.app_data_root.join("journal.jsonl");
        match fs::symlink_metadata(&journal_path) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(VaultError::InvalidDataDirectory(journal_path));
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(VaultRenameRecoveryReport::default());
            }
            Err(error) => return Err(VaultError::Journal(error)),
        }
        let journal_bytes = match fs::read(&journal_path) {
            Ok(bytes) => bytes,
            Err(error) => return Err(VaultError::Journal(error)),
        };
        let complete_length = journal_bytes
            .iter()
            .rposition(|byte| *byte == b'\n')
            .map_or(0, |index| index + 1);
        let complete_text =
            std::str::from_utf8(&journal_bytes[..complete_length]).map_err(|error| {
                VaultError::Journal(io::Error::new(io::ErrorKind::InvalidData, error))
            })?;

        let mut order = Vec::new();
        let mut latest_by_id = HashMap::new();
        for line in complete_text.lines().filter(|line| !line.trim().is_empty()) {
            let value: Value = serde_json::from_str(line).map_err(|error| {
                VaultError::Journal(io::Error::new(io::ErrorKind::InvalidData, error))
            })?;
            if value.get("operation").and_then(Value::as_str) != Some("rename") {
                continue;
            }
            let operation_id = value
                .get("id")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    VaultError::Journal(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "rename journal entry is missing its operation id",
                    ))
                })?
                .to_owned();
            if !latest_by_id.contains_key(&operation_id) {
                order.push(operation_id.clone());
            }
            latest_by_id.insert(operation_id, value);
        }

        let mut report = VaultRenameRecoveryReport::default();
        for operation_id in order {
            let Some(value) = latest_by_id.get(&operation_id) else {
                continue;
            };
            let state = value.get("state").and_then(Value::as_str).ok_or_else(|| {
                VaultError::Journal(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "rename journal entry is missing its state",
                ))
            })?;
            if !matches!(state, "prepared" | "recovery_required") {
                continue;
            }
            let record = match parse_rename_journal_record(value) {
                Ok(Some(record)) => record,
                Ok(None) => {
                    report.needs_attention.push(VaultRenameRecoveryIssue {
                        operation_id,
                        reason: "prepared rename predates recovery manifests; inspect its paths and history manually".to_owned(),
                    });
                    continue;
                }
                Err(reason) => {
                    report.needs_attention.push(VaultRenameRecoveryIssue {
                        operation_id,
                        reason,
                    });
                    continue;
                }
            };
            let before_images = match self.load_rename_before_images(&record) {
                Ok(images) => images,
                Err(reason) => {
                    report.needs_attention.push(VaultRenameRecoveryIssue {
                        operation_id,
                        reason,
                    });
                    continue;
                }
            };
            let errors = self.recover_interrupted_rename(&record, &before_images);
            if errors.is_empty() {
                match self.append_rename_manifest(&record, "rolled_back", None) {
                    Ok(()) => report.recovered_operations.push(operation_id),
                    Err(error) => report.needs_attention.push(VaultRenameRecoveryIssue {
                        operation_id,
                        reason: format!("vault state was restored but its recovery journal could not be recorded: {error}"),
                    }),
                }
            } else {
                let reason = errors.join("; ");
                let journal_result =
                    self.append_rename_manifest(&record, "recovery_required", Some(&reason));
                let reason = match journal_result {
                    Ok(()) => reason,
                    Err(error) => format!("{reason}; recovery journal append failed: {error}"),
                };
                report.needs_attention.push(VaultRenameRecoveryIssue {
                    operation_id,
                    reason,
                });
            }
        }
        Ok(report)
    }

    fn build_rename_updates(
        &self,
        preview: &VaultRenamePreview,
        old_path: &Path,
        new_path: &Path,
        snapshot: &VaultSnapshot,
    ) -> Result<Vec<RenameUpdate>, VaultError> {
        let mut edits_by_source: BTreeMap<PathBuf, Vec<(SourceSpan, String)>> = BTreeMap::new();
        for edit in &preview.plan.edits {
            if edit.action != LinkRenameAction::Update {
                continue;
            }
            let source_path = normalize_relative_path(Path::new(edit.source_path.as_str()))?;
            let replacement = edit
                .replacement
                .as_ref()
                .ok_or(VaultError::StaleRenamePreview)?
                .clone();
            edits_by_source
                .entry(source_path)
                .or_default()
                .push((edit.target_span, replacement));
        }
        edits_by_source.entry(old_path.to_path_buf()).or_default();

        let mut updates = Vec::with_capacity(edits_by_source.len());
        for (source_path, edits) in edits_by_source {
            let snapshot_entry = snapshot
                .entries
                .iter()
                .find(|entry| entry.relative_path == source_path)
                .filter(|entry| entry.kind == VaultSnapshotEntryKind::File)
                .ok_or(VaultError::SnapshotChanged)?;
            let before = self.root.read(&source_path)?;
            if before.revision_sha256 != snapshot_entry.revision_sha256 {
                return Err(VaultError::SnapshotChanged);
            }
            let next_bytes = if edits.is_empty() {
                before.document.as_bytes().to_vec()
            } else {
                apply_target_edits(before.document.as_bytes(), &edits)?
            };
            let target_path = if source_path == old_path {
                new_path.to_path_buf()
            } else {
                source_path.clone()
            };
            updates.push(RenameUpdate {
                source_path,
                target_path,
                before,
                next_bytes,
            });
        }
        updates.sort_by(|left, right| left.target_path.cmp(&right.target_path));
        Ok(updates)
    }

    fn verify_source_revision(
        &self,
        old_path: &Path,
        source_absolute_path: &Path,
        source_update: &RenameUpdate,
        operation_id: &str,
    ) -> Result<(), VaultError> {
        let current = self.read_if_present(old_path, source_absolute_path)?;
        let current_revision = current.as_ref().map(|read| read.revision_sha256.as_str());
        if current_revision == Some(source_update.before.revision_sha256.as_str()) {
            return Ok(());
        }
        let old_path_text = path_to_slashes(old_path)?;
        let new_path_text = path_to_slashes(&source_update.target_path)?;
        let planned_revision = sha256_hex(&source_update.next_bytes);
        let preserved_path = self.preserve_bytes(
            "conflicts",
            &format!("{operation_id}-source-conflict"),
            ".incoming",
            &new_path_text,
            &source_update.next_bytes,
            &planned_revision,
            Some(&source_update.before.revision_sha256),
            current_revision,
        )?;
        Err(VaultError::RevisionConflict {
            relative_path: PathBuf::from(old_path_text),
            expected_revision: Some(source_update.before.revision_sha256.clone()),
            current_revision: current.map(|read| read.revision_sha256),
            preserved_path,
        })
    }

    fn append_rename_manifest(
        &self,
        record: &RenameJournalRecord,
        state: &str,
        error: Option<&str>,
    ) -> Result<(), VaultError> {
        #[cfg(test)]
        if state == "committed" && self.fail_rename_committed_journal {
            return Err(VaultError::Journal(io::Error::other(
                "injected rename commit journal failure",
            )));
        }
        let paths = record
            .paths
            .iter()
            .map(|path| json_string(path))
            .collect::<Vec<_>>()
            .join(",");
        let files = record
            .files
            .iter()
            .map(|file| {
                Ok(format!(
                    "{{\"source_path\":{},\"target_path\":{},\"before_revision\":{},\"after_revision\":{},\"before_file\":{}}}",
                    json_string(&path_to_slashes(&file.source_path)?),
                    json_string(&path_to_slashes(&file.target_path)?),
                    json_string(&file.before_revision),
                    json_string(&file.after_revision),
                    json_string(&file.before_file),
                ))
            })
            .collect::<Result<Vec<_>, VaultError>>()?
            .join(",");
        let temporary_path = record
            .temporary_path
            .as_deref()
            .map(path_to_slashes)
            .transpose()?;
        let error = error.map_or_else(|| "null".to_owned(), json_string);
        let temporary_path =
            temporary_path.map_or_else(|| "null".to_owned(), |path| json_string(&path));
        let line = format!(
            "{{\"schema_version\":2,\"id\":{},\"operation\":\"rename\",\"state\":{},\"paths\":[{}],\"old_path\":{},\"new_path\":{},\"plan_id\":{},\"case_only\":{},\"temporary_path\":{},\"files\":[{}],\"recorded_at\":{},\"error\":{}}}\n",
            json_string(&record.operation_id),
            json_string(state),
            paths,
            json_string(&path_to_slashes(&record.old_path)?),
            json_string(&path_to_slashes(&record.new_path)?),
            json_string(&record.plan_id),
            record.case_only,
            temporary_path,
            files,
            json_string(&timestamp()),
            error,
        );
        self.append_journal_line(&line)
    }

    fn load_rename_before_images(
        &self,
        record: &RenameJournalRecord,
    ) -> Result<Vec<Vec<u8>>, String> {
        let directory = self.app_data_root.join("recovery");
        let metadata = fs::symlink_metadata(&directory)
            .map_err(|error| format!("recovery history directory is unavailable: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("recovery history path is not a regular directory".to_owned());
        }
        let directory = fs::canonicalize(&directory).map_err(|error| {
            format!("recovery history directory could not be resolved: {error}")
        })?;
        if !directory.starts_with(&self.app_data_root) {
            return Err("recovery history directory escapes application data".to_owned());
        }

        let mut images = Vec::with_capacity(record.files.len());
        for (index, file) in record.files.iter().enumerate() {
            let expected_name = format!("{}-rename-before-{index}.bin", record.operation_id);
            if file.before_file != expected_name {
                return Err(format!("recovery image name is invalid for entry {index}"));
            }
            let path = directory.join(&file.before_file);
            let metadata = fs::symlink_metadata(&path).map_err(|error| {
                format!(
                    "recovery image {} is unavailable: {error}",
                    file.before_file
                )
            })?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(format!(
                    "recovery image {} is not a regular file",
                    file.before_file
                ));
            }
            let bytes = fs::read(&path).map_err(|error| {
                format!(
                    "recovery image {} could not be read: {error}",
                    file.before_file
                )
            })?;
            if sha256_hex(&bytes) != file.before_revision {
                return Err(format!(
                    "recovery image {} failed its revision check",
                    file.before_file
                ));
            }
            images.push(bytes);
        }
        Ok(images)
    }

    fn recover_interrupted_rename(
        &self,
        record: &RenameJournalRecord,
        before_images: &[Vec<u8>],
    ) -> Vec<String> {
        let Some(source_index) = record.files.iter().position(|file| {
            file.source_path == record.old_path && file.target_path == record.new_path
        }) else {
            return vec!["rename journal has no source before-image".to_owned()];
        };
        let mut errors = Vec::new();
        for (index, file) in record.files.iter().enumerate().rev() {
            if index == source_index {
                continue;
            }
            if let Err(error) =
                self.restore_interrupted_target(file, &before_images[index], record, index)
            {
                errors.push(error);
            }
        }
        if let Err(error) = self.recover_interrupted_source(
            record,
            &record.files[source_index],
            &before_images[source_index],
        ) {
            errors.push(error);
        }
        errors
    }

    fn restore_interrupted_target(
        &self,
        file: &RenameJournalFile,
        before_bytes: &[u8],
        record: &RenameJournalRecord,
        index: usize,
    ) -> Result<(), String> {
        let target_path = self
            .root
            .resolve_vault_path(&file.target_path, true)
            .map_err(|error| {
                format!(
                    "{} could not be resolved during recovery: {error}",
                    file.target_path.display()
                )
            })?;
        let current = self
            .read_if_present(&file.target_path, &target_path)
            .map_err(|error| {
                format!(
                    "{} could not be read during recovery: {error}",
                    file.target_path.display()
                )
            })?;
        let Some(current) = current else {
            return Err(format!(
                "{} disappeared during the interrupted rename",
                file.target_path.display()
            ));
        };
        if current.revision_sha256 == file.before_revision {
            return Ok(());
        }
        if current.revision_sha256 == file.after_revision {
            self.write(VaultWriteRequest {
                relative_path: file.target_path.clone(),
                expected_revision_sha256: Some(file.after_revision.clone()),
                bytes: before_bytes.to_vec(),
            })
            .map_err(|error| {
                format!(
                    "{} could not be restored: {error}",
                    file.target_path.display()
                )
            })?;
            return Ok(());
        }
        let path_text = path_to_slashes(&file.target_path)
            .unwrap_or_else(|_| file.target_path.to_string_lossy().into_owned());
        let preserved = self.preserve_external_rename_bytes(
            record,
            index,
            &path_text,
            &current,
            &file.after_revision,
        );
        Err(match preserved {
            Ok(path) => format!(
                "{} changed outside the transaction; current bytes were preserved at {}",
                path_text,
                path.display()
            ),
            Err(error) => format!(
                "{} changed outside the transaction and could not be preserved: {error}",
                path_text
            ),
        })
    }

    fn recover_interrupted_source(
        &self,
        record: &RenameJournalRecord,
        file: &RenameJournalFile,
        before_bytes: &[u8],
    ) -> Result<(), String> {
        if record.case_only && !cfg!(windows) {
            return Err("case-only rename recovery requires Windows path semantics".to_owned());
        }
        let old_entry = exact_vault_entry(&self.root, &record.old_path)
            .map_err(|error| format!("original source path could not be checked: {error}"))?;
        let new_entry = exact_vault_entry(&self.root, &record.new_path)
            .map_err(|error| format!("renamed source path could not be checked: {error}"))?;
        let initial_temporary = record
            .temporary_path
            .as_deref()
            .map(|path| exact_vault_entry(&self.root, path))
            .transpose()
            .map_err(|error| format!("rename temporary path could not be checked: {error}"))?
            .flatten();
        let recovery_temporary_path = if record.case_only {
            Some(case_rename_temporary_path(
                &record.new_path,
                &record.operation_id,
                Some("recovery"),
            )?)
        } else {
            None
        };
        let recovery_temporary = recovery_temporary_path
            .as_deref()
            .map(|path| exact_vault_entry(&self.root, path))
            .transpose()
            .map_err(|error| format!("recovery temporary path could not be checked: {error}"))?
            .flatten();

        let temporary_entry = initial_temporary.or(recovery_temporary);
        if let Some(temporary_entry) = temporary_entry {
            if old_entry.is_some() || new_entry.is_some() {
                return Err("rename temporary and a source/destination entry both exist; recovery left them untouched".to_owned());
            }
            self.restore_source_bytes_at(&temporary_entry, record, file, before_bytes)?;
            let old_path = if record.case_only {
                self.root.canonical_root.join(&record.old_path)
            } else {
                self.root
                    .resolve_vault_path(&record.old_path, true)
                    .map_err(|error| {
                        format!("original source path could not be resolved: {error}")
                    })?
            };
            fs::rename(&temporary_entry, &old_path).map_err(|error| {
                format!(
                    "rename temporary could not be restored to {}: {error}",
                    record.old_path.display()
                )
            })?;
            return Ok(());
        }

        match (old_entry, new_entry) {
            (Some(old_entry), None) => {
                self.restore_source_bytes_at(&old_entry, record, file, before_bytes)
            }
            (None, Some(new_entry)) => {
                self.restore_source_bytes_at(&new_entry, record, file, before_bytes)?;
                let old_path = if record.case_only {
                    self.root.canonical_root.join(&record.old_path)
                } else {
                    self.root
                        .resolve_vault_path(&record.old_path, true)
                        .map_err(|error| {
                            format!("original source path could not be resolved: {error}")
                        })?
                };
                let case_only = record.case_only;
                let mut move_state = RenameMoveState::default();
                move_vault_file(
                    &new_entry,
                    &old_path,
                    &format!("{}-recovery", record.operation_id),
                    case_only,
                    &mut move_state,
                )
                .map_err(|error| {
                    format!("renamed source could not be restored to its original path: {error}")
                })
            }
            (Some(_), Some(_)) => Err(
                "original and renamed source entries both exist; recovery left them untouched"
                    .to_owned(),
            ),
            (None, None) => {
                Err("original, renamed and temporary source entries are all missing".to_owned())
            }
        }
    }

    fn restore_source_bytes_at(
        &self,
        path: &Path,
        record: &RenameJournalRecord,
        file: &RenameJournalFile,
        before_bytes: &[u8],
    ) -> Result<(), String> {
        let relative_path = path
            .strip_prefix(&self.root.canonical_root)
            .map_err(|_| "source recovery path escaped the vault".to_owned())?;
        let current = self.root.read(relative_path).map_err(|error| {
            format!(
                "source {} could not be read during recovery: {error}",
                path.display()
            )
        })?;
        if current.revision_sha256 == file.before_revision {
            return Ok(());
        }
        if current.revision_sha256 == file.after_revision {
            self.write(VaultWriteRequest {
                relative_path: relative_path.to_path_buf(),
                expected_revision_sha256: Some(file.after_revision.clone()),
                bytes: before_bytes.to_vec(),
            })
            .map_err(|error| format!("source {} could not be restored: {error}", path.display()))?;
            return Ok(());
        }
        let path_text = path_to_slashes(relative_path)
            .unwrap_or_else(|_| relative_path.to_string_lossy().into_owned());
        let preserved = self.preserve_external_rename_bytes(
            record,
            0,
            &path_text,
            &current,
            &file.after_revision,
        );
        Err(match preserved {
            Ok(path) => format!(
                "source changed outside the transaction; it was left in place and preserved at {}",
                path.display()
            ),
            Err(error) => format!(
                "source changed outside the transaction and could not be preserved: {error}"
            ),
        })
    }

    fn preserve_external_rename_bytes(
        &self,
        record: &RenameJournalRecord,
        index: usize,
        relative_path: &str,
        current: &VaultRead,
        expected_revision: &str,
    ) -> Result<PathBuf, VaultError> {
        let record_id = format!(
            "{}-recovery-{index}-{}",
            record.operation_id,
            next_operation_id()
        );
        self.preserve_bytes(
            "conflicts",
            &record_id,
            ".incoming",
            relative_path,
            current.document.as_bytes(),
            &current.revision_sha256,
            Some(expected_revision),
            Some(&current.revision_sha256),
        )
    }

    fn append_rename_journal(
        &self,
        operation_id: &str,
        state: &str,
        preview: &VaultRenamePreview,
        paths: &[String],
        error: Option<&str>,
    ) -> Result<(), VaultError> {
        #[cfg(test)]
        if state == "committed" && self.fail_rename_committed_journal {
            return Err(VaultError::Journal(io::Error::other(
                "injected rename commit journal failure",
            )));
        }
        let paths = paths
            .iter()
            .map(|path| json_string(path))
            .collect::<Vec<_>>()
            .join(",");
        let error = error.map_or_else(|| "null".to_owned(), json_string);
        let line = format!(
            "{{\"id\":{},\"operation\":\"rename\",\"state\":{},\"paths\":[{}],\"old_path\":{},\"new_path\":{},\"plan_id\":{},\"recorded_at\":{},\"error\":{}}}\n",
            json_string(operation_id),
            json_string(state),
            paths,
            json_string(&preview.plan.old_path),
            json_string(&preview.plan.new_path),
            json_string(&preview.plan_id),
            json_string(&timestamp()),
            error,
        );
        self.append_journal_line(&line)
    }

    fn finish_pre_mutation_failure(
        &self,
        error: VaultError,
        operation_id: &str,
        preview: &VaultRenamePreview,
        paths: &[String],
    ) -> VaultError {
        if let Err(journal_error) = self.append_rename_journal(
            operation_id,
            "failed",
            preview,
            paths,
            Some(&error.to_string()),
        ) {
            return VaultError::RenameTransactionRecoveryRequired {
                old_path: PathBuf::from(&preview.plan.old_path),
                new_path: PathBuf::from(&preview.plan.new_path),
                reason: format!(
                    "no vault files changed; failure journal append failed: {journal_error}"
                ),
            };
        }
        error
    }

    #[allow(clippy::too_many_arguments)]
    fn rollback_rename(
        &self,
        old_path: &Path,
        new_path: &Path,
        source_absolute_path: &Path,
        destination_absolute_path: &Path,
        case_only: bool,
        updates: &[RenameUpdate],
        written: &[WrittenRenameUpdate],
        move_state: &mut RenameMoveState,
        operation_id: &str,
    ) -> Vec<String> {
        let mut errors = Vec::new();
        for (index, written_update) in written.iter().enumerate().rev() {
            let current = match self.root.read(&written_update.target_path) {
                Ok(current) => current,
                Err(error) => {
                    errors.push(format!(
                        "{} could not be read during rollback: {error}",
                        written_update.target_path.display()
                    ));
                    continue;
                }
            };
            if current.revision_sha256 != written_update.written_revision {
                let relative_path_text = path_to_slashes(&written_update.target_path)
                    .unwrap_or_else(|_| written_update.target_path.to_string_lossy().into_owned());
                let preserve_result = self.preserve_bytes(
                    "conflicts",
                    &format!("{operation_id}-external-change-{index}"),
                    ".incoming",
                    &relative_path_text,
                    current.document.as_bytes(),
                    &current.revision_sha256,
                    Some(&written_update.written_revision),
                    Some(&current.revision_sha256),
                );
                match preserve_result {
                    Ok(path) => errors.push(format!(
                        "{} changed externally during rollback; current bytes preserved at {}",
                        relative_path_text,
                        path.display()
                    )),
                    Err(error) => errors.push(format!(
                        "{} changed externally during rollback and preservation failed: {error}",
                        relative_path_text
                    )),
                }
                continue;
            }
            let relative_path_text = match path_to_slashes(&written_update.target_path) {
                Ok(path) => path,
                Err(error) => {
                    errors.push(error.to_string());
                    continue;
                }
            };
            if let Err(error) = self.write(VaultWriteRequest {
                relative_path: written_update.target_path.clone(),
                expected_revision_sha256: Some(current.revision_sha256),
                bytes: written_update.before.document.as_bytes().to_vec(),
            }) {
                errors.push(format!("{relative_path_text} restore failed: {error}"));
            }
        }

        if move_state.moved {
            let source_update = updates.iter().find(|update| update.source_path == old_path);
            let Some(source_update) = source_update else {
                errors.push("source revision was unavailable during rename rollback".to_owned());
                return errors;
            };

            if let Some(temporary_path) = move_state.temporary_path.clone() {
                match fs::symlink_metadata(&temporary_path) {
                    Ok(_) => {
                        if let Err(error) = move_vault_file(
                            &temporary_path,
                            source_absolute_path,
                            &format!("{operation_id}-rollback-temp"),
                            false,
                            move_state,
                        ) {
                            errors.push(format!(
                                "case-only rename temporary could not be restored to {}: {error}",
                                old_path.display()
                            ));
                        }
                        return errors;
                    }
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                    Err(error) => {
                        errors.push(format!("rename temporary could not be inspected: {error}"));
                        return errors;
                    }
                }
            }

            let current_source = match self.root.read(new_path) {
                Ok(current) => current,
                Err(error) => {
                    errors.push(format!(
                        "renamed source {} could not be read during rollback: {error}",
                        new_path.display()
                    ));
                    return errors;
                }
            };
            if current_source.revision_sha256 != source_update.before.revision_sha256 {
                let relative_path_text = path_to_slashes(new_path)
                    .unwrap_or_else(|_| new_path.to_string_lossy().into_owned());
                let preserve_result = self.preserve_bytes(
                    "conflicts",
                    &format!("{operation_id}-renamed-source-external"),
                    ".incoming",
                    &relative_path_text,
                    current_source.document.as_bytes(),
                    &current_source.revision_sha256,
                    Some(&source_update.before.revision_sha256),
                    Some(&current_source.revision_sha256),
                );
                match preserve_result {
                    Ok(path) => errors.push(format!(
                        "renamed source changed externally; left it in place and preserved bytes at {}",
                        path.display()
                    )),
                    Err(error) => errors.push(format!(
                        "renamed source changed externally and preservation failed: {error}"
                    )),
                }
                return errors;
            }

            if !case_only {
                match self.root.resolve_vault_path(old_path, true) {
                    Ok(path) if fs::symlink_metadata(&path).is_ok() => {
                        errors.push(format!(
                            "original source path {} was recreated externally; renamed source left in place",
                            old_path.display()
                        ));
                        return errors;
                    }
                    Err(error) => {
                        errors.push(format!(
                            "original source path could not be checked: {error}"
                        ));
                        return errors;
                    }
                    Ok(_) => {}
                }
            }

            if let Err(error) = move_vault_file(
                destination_absolute_path,
                source_absolute_path,
                &format!("{operation_id}-rollback"),
                case_only,
                move_state,
            ) {
                errors.push(format!("renamed source could not be moved back: {error}"));
            }
        }
        errors
    }
}

fn parse_rename_journal_record(value: &Value) -> Result<Option<RenameJournalRecord>, String> {
    if value.get("schema_version").and_then(Value::as_u64) != Some(2) {
        return Ok(None);
    }
    let required_string = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| format!("rename journal manifest is missing {key}"))
    };
    let operation_id = required_string("id")?;
    if !operation_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err("rename operation id contains unsupported characters".to_owned());
    }
    let plan_id = required_string("plan_id")?;
    let old_path = normalize_relative_path(Path::new(&required_string("old_path")?))
        .map_err(|error| format!("rename source path is invalid: {error}"))?;
    let new_path = normalize_relative_path(Path::new(&required_string("new_path")?))
        .map_err(|error| format!("rename destination path is invalid: {error}"))?;
    if old_path == new_path {
        return Err("rename journal source and destination paths are identical".to_owned());
    }
    let case_only = value
        .get("case_only")
        .and_then(Value::as_bool)
        .ok_or_else(|| "rename journal manifest is missing case_only".to_owned())?;
    let temporary_path = match value.get("temporary_path") {
        Some(Value::String(path)) => Some(
            normalize_relative_path(Path::new(path))
                .map_err(|error| format!("rename temporary path is invalid: {error}"))?,
        ),
        Some(Value::Null) if !case_only => None,
        _ => {
            return Err(
                "rename journal temporary path does not match its case-only flag".to_owned(),
            );
        }
    };
    let paths = value
        .get("paths")
        .and_then(Value::as_array)
        .ok_or_else(|| "rename journal manifest is missing paths".to_owned())?
        .iter()
        .map(|path| {
            let path = path
                .as_str()
                .ok_or_else(|| "rename journal path entry is not a string".to_owned())?;
            let path = normalize_relative_path(Path::new(path))
                .map_err(|error| format!("rename journal path is invalid: {error}"))?;
            path_to_slashes(&path)
                .map_err(|error| format!("rename journal path is invalid: {error}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let raw_files = value
        .get("files")
        .and_then(Value::as_array)
        .filter(|files| !files.is_empty())
        .ok_or_else(|| "rename journal manifest has no file entries".to_owned())?;
    let mut files = Vec::with_capacity(raw_files.len());
    for (index, raw_file) in raw_files.iter().enumerate() {
        let string = |key: &str| {
            raw_file
                .get(key)
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .ok_or_else(|| format!("rename journal file entry {index} is missing {key}"))
        };
        let source_path = normalize_relative_path(Path::new(&string("source_path")?))
            .map_err(|error| format!("rename journal source path {index} is invalid: {error}"))?;
        let target_path = normalize_relative_path(Path::new(&string("target_path")?))
            .map_err(|error| format!("rename journal target path {index} is invalid: {error}"))?;
        let before_revision = string("before_revision")?;
        let after_revision = string("after_revision")?;
        if !is_sha256(&before_revision) || !is_sha256(&after_revision) {
            return Err(format!(
                "rename journal file entry {index} has an invalid revision"
            ));
        }
        let before_file = string("before_file")?;
        let expected_before_file = format!("{operation_id}-rename-before-{index}.bin");
        if before_file != expected_before_file {
            return Err(format!(
                "rename journal file entry {index} has an invalid before-image name"
            ));
        }
        files.push(RenameJournalFile {
            source_path,
            target_path,
            before_revision,
            after_revision,
            before_file,
        });
    }
    let source_count = files
        .iter()
        .filter(|file| file.source_path == old_path && file.target_path == new_path)
        .count();
    if source_count != 1 {
        return Err("rename journal manifest must have one source file entry".to_owned());
    }
    if case_only {
        let expected_temporary = case_rename_temporary_path(&old_path, &operation_id, None)?;
        if temporary_path.as_ref() != Some(&expected_temporary) {
            return Err("case-only rename journal has an invalid temporary path".to_owned());
        }
    }
    Ok(Some(RenameJournalRecord {
        operation_id,
        plan_id,
        old_path,
        new_path,
        paths,
        case_only,
        temporary_path,
        files,
    }))
}

fn exact_vault_entry(
    root: &super::VaultRoot,
    relative_path: &Path,
) -> Result<Option<PathBuf>, VaultError> {
    let relative_path = normalize_relative_path(relative_path)?;
    let file_name = relative_path.file_name().ok_or(VaultError::InvalidPath)?;
    let parent = relative_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty());
    let parent_path = match parent {
        Some(parent) => root.resolve_vault_path(parent, false)?,
        None => root.canonical_root.clone(),
    };
    for entry in fs::read_dir(parent_path)? {
        let entry = entry?;
        let entry_name = entry.file_name();
        if entry_name.as_encoded_bytes() != file_name.as_encoded_bytes() {
            continue;
        }
        let relative_path = relative_path.clone();
        let entry_type = entry.file_type()?;
        if entry_type.is_symlink() {
            return Err(VaultError::Symlink(relative_path));
        }
        if !entry_type.is_file() {
            return Err(VaultError::NotAFile(relative_path));
        }
        return Ok(Some(entry.path()));
    }
    Ok(None)
}

fn case_rename_temporary_path(
    source_path: &Path,
    operation_id: &str,
    suffix: Option<&str>,
) -> Result<PathBuf, String> {
    let file_name = source_path
        .file_name()
        .ok_or_else(|| "rename temporary source has no file name".to_owned())?
        .to_string_lossy();
    let parent = source_path.parent().unwrap_or_else(|| Path::new(""));
    let operation_id = suffix.map_or_else(
        || operation_id.to_owned(),
        |suffix| format!("{operation_id}-{suffix}"),
    );
    Ok(parent.join(format!(".{file_name}.{operation_id}.rename.tmp")))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn apply_target_edits(bytes: &[u8], edits: &[(SourceSpan, String)]) -> Result<Vec<u8>, VaultError> {
    let source = std::str::from_utf8(bytes).map_err(|_| VaultError::StaleRenamePreview)?;
    let mut ordered = edits.to_vec();
    ordered.sort_by_key(|(span, _)| span.start);
    let mut previous_end = 0;
    for (span, _) in &ordered {
        if span.start > span.end
            || span.end > source.len()
            || !source.is_char_boundary(span.start)
            || !source.is_char_boundary(span.end)
            || span.start < previous_end
        {
            return Err(VaultError::StaleRenamePreview);
        }
        previous_end = span.end;
    }
    let mut transformed = source.to_owned();
    for (span, replacement) in ordered.iter().rev() {
        transformed.replace_range(span.start..span.end, replacement);
    }
    Ok(transformed.into_bytes())
}

fn journal_paths(
    updates: &[RenameUpdate],
    old_path: &Path,
    new_path: &Path,
) -> Result<Vec<String>, VaultError> {
    let mut paths = BTreeSet::new();
    paths.insert(path_to_slashes(old_path)?);
    paths.insert(path_to_slashes(new_path)?);
    for update in updates {
        paths.insert(path_to_slashes(&update.source_path)?);
        paths.insert(path_to_slashes(&update.target_path)?);
    }
    Ok(paths.into_iter().collect())
}

fn move_vault_file(
    source_path: &Path,
    destination_path: &Path,
    operation_id: &str,
    case_only: bool,
    state: &mut RenameMoveState,
) -> io::Result<()> {
    #[cfg(windows)]
    if case_only {
        let file_name = source_path
            .file_name()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing source name"))?
            .to_string_lossy();
        let temporary_path = source_path
            .parent()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing source parent"))?
            .join(format!(".{file_name}.{operation_id}.rename.tmp"));
        fs::rename(source_path, &temporary_path)?;
        state.moved = true;
        state.temporary_path = Some(temporary_path.clone());
        if let Err(error) = fs::rename(&temporary_path, destination_path) {
            if let Err(restore_error) = fs::rename(&temporary_path, source_path) {
                return Err(io::Error::other(format!(
                    "case-only rename failed: {error}; restoring temporary failed: {restore_error}"
                )));
            }
            state.moved = false;
            state.temporary_path = None;
            return Err(error);
        }
        state.temporary_path = None;
        return Ok(());
    }
    #[cfg(not(windows))]
    let _ = (operation_id, case_only);
    fs::rename(source_path, destination_path)?;
    state.moved = true;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::sync::atomic::{AtomicU64, Ordering};

    const C03_RENAME_FIXTURE: &str = include_str!("../../../fixtures/rename-plan.json");

    static NEXT_TEMP_DIR_ID: AtomicU64 = AtomicU64::new(0);

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let temp_root = std::env::temp_dir();
            loop {
                let id = NEXT_TEMP_DIR_ID.fetch_add(1, Ordering::Relaxed);
                let path = temp_root.join(format!(
                    "openobsidian-rename-recovery-{}-{id}",
                    std::process::id()
                ));
                match fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("creating test directory {}: {error}", path.display()),
                }
            }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn fixture() -> (TempDir, PathBuf, PathBuf, VaultStore) {
        let temporary = TempDir::new();
        let vault_path = temporary.0.join("vault");
        let app_data_path = temporary.0.join("app-data");
        fs::create_dir(&vault_path).unwrap();
        fs::create_dir(&app_data_path).unwrap();
        fs::write(vault_path.join("Old.md"), b"# Old\r\n").unwrap();
        fs::write(vault_path.join("Index.md"), b"[[Old]]\r\n").unwrap();
        let store = VaultStore::open(&vault_path, &app_data_path).unwrap();
        (temporary, vault_path, app_data_path, store)
    }

    fn simulate_interrupted_rename(store: &VaultStore, new_path: &str) -> String {
        simulate_interrupted_rename_between(store, Path::new("Old.md"), Path::new(new_path))
    }

    fn simulate_interrupted_rename_between(
        store: &VaultStore,
        old_path: &Path,
        new_path: &Path,
    ) -> String {
        let old_path = old_path.to_path_buf();
        let new_path = new_path.to_path_buf();
        let preview = store
            .root
            .build_rename_preview(&old_path, &new_path)
            .unwrap();
        let snapshot = store.root.snapshot().unwrap();
        let updates = store
            .build_rename_updates(&preview, &old_path, &new_path, &snapshot)
            .unwrap();
        let operation_id = next_operation_id();
        let old_text = path_to_slashes(&old_path).unwrap();
        let new_text = path_to_slashes(&new_path).unwrap();
        let case_only =
            cfg!(windows) && old_text != new_text && old_text.eq_ignore_ascii_case(&new_text);
        let mut paths = journal_paths(&updates, &old_path, &new_path).unwrap();
        let mut files = Vec::new();
        for (index, update) in updates.iter().enumerate() {
            let before_record = format!("{operation_id}-rename-before-{index}");
            let before_file = format!("{before_record}.bin");
            store
                .preserve_bytes(
                    "recovery",
                    &before_record,
                    ".bin",
                    &path_to_slashes(&update.source_path).unwrap(),
                    update.before.document.as_bytes(),
                    &update.before.revision_sha256,
                    Some(&update.before.revision_sha256),
                    Some(&update.before.revision_sha256),
                )
                .unwrap();
            files.push(RenameJournalFile {
                source_path: update.source_path.clone(),
                target_path: update.target_path.clone(),
                before_revision: update.before.revision_sha256.clone(),
                after_revision: sha256_hex(&update.next_bytes),
                before_file,
            });
        }
        let temporary_path = if case_only {
            let file_name = old_path.file_name().unwrap().to_string_lossy();
            let temporary_path = old_path
                .parent()
                .unwrap_or_else(|| Path::new(""))
                .join(format!(".{file_name}.{operation_id}.rename.tmp"));
            paths.push(path_to_slashes(&temporary_path).unwrap());
            paths.sort();
            paths.dedup();
            Some(temporary_path)
        } else {
            None
        };
        let record = RenameJournalRecord {
            operation_id: operation_id.clone(),
            plan_id: preview.plan_id,
            old_path: old_path.clone(),
            new_path: new_path.clone(),
            paths,
            case_only,
            temporary_path,
            files: files.clone(),
        };
        store
            .append_rename_manifest(&record, "prepared", None)
            .unwrap();

        let source_path = store.root.resolve_vault_path(&old_path, false).unwrap();
        let destination_path = store.root.canonical_root.join(&new_path);
        let mut move_state = RenameMoveState::default();
        move_vault_file(
            &source_path,
            &destination_path,
            &operation_id,
            case_only,
            &mut move_state,
        )
        .unwrap();
        for file in &files {
            if file.target_path == new_path {
                continue;
            }
            let update = updates
                .iter()
                .find(|update| update.target_path == file.target_path)
                .unwrap();
            if update.next_bytes == update.before.document.as_bytes() {
                continue;
            }
            store
                .write(VaultWriteRequest {
                    relative_path: update.target_path.clone(),
                    expected_revision_sha256: Some(update.before.revision_sha256.clone()),
                    bytes: update.next_bytes.clone(),
                })
                .unwrap();
        }
        operation_id
    }

    #[test]
    fn recovers_interrupted_rename_after_source_move_and_reference_write() {
        let (_temporary, vault_path, app_data_path, store) = fixture();
        let original_index = fs::read(vault_path.join("Index.md")).unwrap();
        let operation_id = simulate_interrupted_rename(&store, "New.md");
        drop(store);

        let store = VaultStore::open(&vault_path, &app_data_path).unwrap();
        let report = store.recover_pending_rename_transactions().unwrap();
        assert_eq!(report.recovered_operations, vec![operation_id]);
        assert!(report.needs_attention.is_empty());
        assert_eq!(fs::read(vault_path.join("Old.md")).unwrap(), b"# Old\r\n");
        assert_eq!(
            fs::read(vault_path.join("Index.md")).unwrap(),
            original_index
        );
        assert!(!vault_path.join("New.md").exists());

        let repeated = store.recover_pending_rename_transactions().unwrap();
        assert!(repeated.recovered_operations.is_empty());
        assert!(repeated.needs_attention.is_empty());
    }

    #[test]
    fn recovers_interrupted_c03_fixture_rename_and_restores_every_original_byte() {
        let fixture: Value = serde_json::from_str(C03_RENAME_FIXTURE)
            .expect("rename-plan fixture must be valid JSON");
        let case = fixture["cases"]
            .as_array()
            .expect("fixture cases must be an array")
            .iter()
            .find(|case| {
                case["id"].as_str() == Some("resolved-wiki-markdown-embed-and-unrelated-targets")
            })
            .expect("fixture must contain the resolved rename case");

        let temporary = TempDir::new();
        let vault_path = temporary.0.join("vault");
        let app_data_path = temporary.0.join("app-data");
        fs::create_dir(&vault_path).unwrap();
        fs::create_dir(&app_data_path).unwrap();
        let mut originals = Vec::new();
        for file in case["files"].as_array().expect("fixture files") {
            let relative_path = PathBuf::from(file["relative_path"].as_str().unwrap());
            let source = file["source"].as_str().unwrap().as_bytes().to_vec();
            let path = vault_path.join(&relative_path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, &source).unwrap();
            originals.push((relative_path, source));
        }

        let old_path = PathBuf::from(case["old_path"].as_str().unwrap());
        let new_path = PathBuf::from(case["new_path"].as_str().unwrap());
        fs::create_dir_all(vault_path.join(&new_path).parent().unwrap()).unwrap();
        let store = VaultStore::open(&vault_path, &app_data_path).unwrap();
        let operation_id = simulate_interrupted_rename_between(&store, &old_path, &new_path);
        assert!(!vault_path.join(&old_path).exists());
        assert!(vault_path.join(&new_path).exists());
        assert_eq!(
            fs::read(vault_path.join("Index.md")).unwrap(),
            case["expected_sources"]["Index.md"]
                .as_str()
                .unwrap()
                .as_bytes()
        );
        assert_eq!(
            fs::read(vault_path.join("Notes/Second.md")).unwrap(),
            case["expected_sources"]["Notes/Second.md"]
                .as_str()
                .unwrap()
                .as_bytes()
        );
        drop(store);

        let store = VaultStore::open(&vault_path, &app_data_path).unwrap();
        let report = store.recover_pending_rename_transactions().unwrap();

        assert!(
            report.needs_attention.is_empty(),
            "fixture recovery reported issues: {:?}",
            report.needs_attention
        );
        assert_eq!(report.recovered_operations, vec![operation_id]);
        for (relative_path, original) in &originals {
            assert_eq!(fs::read(vault_path.join(relative_path)).unwrap(), *original);
        }
        assert!(!vault_path.join(&new_path).exists());
        let journal = fs::read_to_string(app_data_path.join("journal.jsonl")).unwrap();
        assert!(journal.contains("\"operation\":\"rename\",\"state\":\"rolled_back\""));

        let repeated = store.recover_pending_rename_transactions().unwrap();
        assert!(repeated.recovered_operations.is_empty());
        assert!(repeated.needs_attention.is_empty());
    }

    #[test]
    fn preserves_external_reference_edit_during_crash_recovery() {
        let (_temporary, vault_path, app_data_path, store) = fixture();
        let operation_id = simulate_interrupted_rename(&store, "New.md");
        let external = b"external edit\r\n";
        fs::write(vault_path.join("Index.md"), external).unwrap();
        drop(store);

        let store = VaultStore::open(&vault_path, &app_data_path).unwrap();
        let report = store.recover_pending_rename_transactions().unwrap();
        assert!(report.recovered_operations.is_empty());
        assert_eq!(report.needs_attention.len(), 1);
        assert_eq!(report.needs_attention[0].operation_id, operation_id);
        assert!(report.needs_attention[0].reason.contains("changed outside"));
        assert_eq!(fs::read(vault_path.join("Index.md")).unwrap(), external);
        assert_eq!(fs::read(vault_path.join("Old.md")).unwrap(), b"# Old\r\n");
        assert!(!vault_path.join("New.md").exists());
        let conflict_dir = app_data_path.join("conflicts");
        assert!(
            fs::read_dir(conflict_dir)
                .unwrap()
                .filter_map(Result::ok)
                .any(|entry| entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == "incoming")
                    && fs::read(entry.path()).is_ok_and(|bytes| bytes.as_slice() == external))
        );
    }

    #[test]
    fn ignores_an_incomplete_unterminated_journal_tail() {
        let (_temporary, vault_path, app_data_path, store) = fixture();
        fs::write(
            app_data_path.join("journal.jsonl"),
            b"{\"id\":\"truncated\",\"operation\":\"rename\"",
        )
        .unwrap();

        let report = store.recover_pending_rename_transactions().unwrap();
        assert_eq!(report, VaultRenameRecoveryReport::default());
        assert!(vault_path.join("Old.md").exists());
    }

    #[cfg(windows)]
    #[test]
    fn recovers_interrupted_case_only_rename_on_windows() {
        let (_temporary, vault_path, app_data_path, store) = fixture();
        let operation_id = simulate_interrupted_rename(&store, "old.md");
        drop(store);

        let store = VaultStore::open(&vault_path, &app_data_path).unwrap();
        let report = store.recover_pending_rename_transactions().unwrap();
        assert_eq!(report.recovered_operations, vec![operation_id]);
        assert!(report.needs_attention.is_empty());
        let names = fs::read_dir(&vault_path)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name())
            .collect::<Vec<_>>();
        assert!(
            names
                .iter()
                .any(|name| name.as_encoded_bytes() == b"Old.md")
        );
        assert!(
            !names
                .iter()
                .any(|name| name.as_encoded_bytes() == b"old.md")
        );
    }
}
