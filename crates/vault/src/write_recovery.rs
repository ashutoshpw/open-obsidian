use super::{
    CreateTemporaryCleanup, VaultError, VaultStore, normalize_relative_path, path_to_slashes,
    sha256_hex, sync_create_directory,
};
use cap_std::fs::Dir as CapabilityDir;
use serde_json::Value;
use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultWriteRecoveryIssue {
    pub operation_id: String,
    pub reason: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct VaultWriteRecoveryReport {
    pub recovered_operations: Vec<String>,
    pub needs_attention: Vec<VaultWriteRecoveryIssue>,
}

#[derive(Clone, Debug)]
struct WriteJournalRecord {
    operation: WriteJournalOperation,
    operation_id: String,
    relative_path: PathBuf,
    expected_revision: Option<String>,
    next_revision: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WriteJournalOperation {
    Write,
    Create,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum RecoveryOutcome {
    Recovered,
    NeedsAttention(String),
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum CreatePublishOutcome {
    Published,
    Conflict { current_revision: String },
}

impl VaultStore {
    /// Completes interrupted writes and creates without replacing an unexpected
    /// target. Incoming and previous bytes remain in app-owned recovery history
    /// until a later explicit cleanup.
    pub fn recover_pending_writes(&self) -> Result<VaultWriteRecoveryReport, VaultError> {
        let journal_path = self.app_data_root.join("journal.jsonl");
        match fs::symlink_metadata(&journal_path) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(VaultError::InvalidDataDirectory(journal_path));
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(VaultWriteRecoveryReport::default());
            }
            Err(error) => return Err(VaultError::Journal(error)),
        }
        let journal_bytes = fs::read(&journal_path).map_err(VaultError::Journal)?;
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
            if !matches!(
                value.get("operation").and_then(Value::as_str),
                Some("write" | "create")
            ) {
                continue;
            }
            let operation_id = value
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("<invalid-operation-id>")
                .to_owned();
            if !latest_by_id.contains_key(&operation_id) {
                order.push(operation_id.clone());
            }
            latest_by_id.insert(operation_id, value);
        }

        let mut report = VaultWriteRecoveryReport::default();
        for operation_id in order {
            let Some(value) = latest_by_id.get(&operation_id) else {
                continue;
            };
            let state = value.get("state").and_then(Value::as_str);
            if matches!(state, Some("committed" | "conflict"))
                && value.get("operation").and_then(Value::as_str) == Some("create")
            {
                let record = match parse_write_journal_record(value) {
                    Ok(record) => record,
                    Err(reason) => {
                        report.needs_attention.push(VaultWriteRecoveryIssue {
                            operation_id,
                            reason,
                        });
                        continue;
                    }
                };
                if let Err(reason) =
                    self.cleanup_terminal_create_staging(&record, state == Some("committed"))
                {
                    report.needs_attention.push(VaultWriteRecoveryIssue {
                        operation_id: record.operation_id,
                        reason,
                    });
                }
                continue;
            }
            match state {
                Some("prepared" | "recovery_required") => {}
                Some("committed" | "failed" | "conflict") => continue,
                _ => {
                    report.needs_attention.push(VaultWriteRecoveryIssue {
                        operation_id,
                        reason: "write/create journal entry has a missing or unknown state"
                            .to_owned(),
                    });
                    continue;
                }
            }
            let record = match parse_write_journal_record(value) {
                Ok(record) => record,
                Err(reason) => {
                    report.needs_attention.push(VaultWriteRecoveryIssue {
                        operation_id,
                        reason,
                    });
                    continue;
                }
            };
            let recovery = match record.operation {
                WriteJournalOperation::Write => self
                    .recover_interrupted_write(&record)
                    .map(|()| RecoveryOutcome::Recovered),
                WriteJournalOperation::Create => self.recover_interrupted_create(&record),
            };
            match recovery {
                Ok(RecoveryOutcome::Recovered) => {
                    report.recovered_operations.push(record.operation_id);
                }
                Ok(RecoveryOutcome::NeedsAttention(reason)) => {
                    report.needs_attention.push(VaultWriteRecoveryIssue {
                        operation_id: record.operation_id,
                        reason,
                    });
                }
                Err(reason) => {
                    let journal_result = match record.operation {
                        WriteJournalOperation::Write => self.append_journal(
                            &record.operation_id,
                            "recovery_required",
                            &path_to_slashes(&record.relative_path)?,
                            record.expected_revision.as_deref(),
                            &record.next_revision,
                            Some(&reason),
                        ),
                        WriteJournalOperation::Create => self.append_create_journal(
                            &record.operation_id,
                            "recovery_required",
                            &path_to_slashes(&record.relative_path)?,
                            record.expected_revision.as_deref(),
                            &record.next_revision,
                            Some(&reason),
                        ),
                    };
                    let reason = match journal_result {
                        Ok(()) => reason,
                        Err(error) => format!("{reason}; recovery journal append failed: {error}"),
                    };
                    report.needs_attention.push(VaultWriteRecoveryIssue {
                        operation_id: record.operation_id,
                        reason,
                    });
                }
            }
        }
        Ok(report)
    }

    fn recover_interrupted_write(&self, record: &WriteJournalRecord) -> Result<(), String> {
        let relative_path_text =
            path_to_slashes(&record.relative_path).map_err(|error| error.to_string())?;
        let incoming = self.read_recovery_image(
            &format!("{}-incoming", record.operation_id),
            &relative_path_text,
            &record.next_revision,
            record.expected_revision.as_deref(),
        )?;
        if let Some(expected_revision) = record.expected_revision.as_deref() {
            self.read_recovery_image(
                &format!("{}-previous", record.operation_id),
                &relative_path_text,
                expected_revision,
                Some(expected_revision),
            )?;
        }

        let target_path = self
            .root
            .resolve_vault_path(&record.relative_path, true)
            .map_err(|error| error.to_string())?;
        let current = self
            .read_if_present(&record.relative_path, &target_path)
            .map_err(|error| error.to_string())?;
        let current_revision = current.as_ref().map(|read| read.revision_sha256.as_str());

        if current_revision == Some(record.next_revision.as_str()) {
            self.append_journal(
                &record.operation_id,
                "committed",
                &relative_path_text,
                record.expected_revision.as_deref(),
                &record.next_revision,
                None,
            )
            .map_err(|error| error.to_string())?;
            #[cfg(windows)]
            if let Ok(backup_paths) = matching_windows_backups(
                &target_path,
                &record.operation_id,
                record.expected_revision.as_deref(),
                &record.next_revision,
            ) {
                for backup_path in backup_paths {
                    let _ = fs::remove_file(backup_path);
                }
            }
            return Ok(());
        }
        #[cfg(windows)]
        let backup_paths = if current_revision.is_none() && record.expected_revision.is_some() {
            matching_windows_backups(
                &target_path,
                &record.operation_id,
                record.expected_revision.as_deref(),
                &record.next_revision,
            )?
        } else {
            Vec::new()
        };
        #[cfg(not(windows))]
        let backup_paths: Vec<PathBuf> = Vec::new();
        if current_revision != record.expected_revision.as_deref() && backup_paths.is_empty() {
            return Err(format!(
                "target no longer has the expected revision; recovery left the path untouched and incoming bytes remain in recovery history at {}",
                self.app_data_root
                    .join("recovery")
                    .join(format!("{}-incoming.bin", record.operation_id))
                    .display()
            ));
        }

        let recovery_operation_id = format!(
            "{}-recovery-{}",
            record.operation_id,
            super::next_operation_id()
        );
        self.atomic_replace(
            &target_path,
            &record.relative_path,
            &recovery_operation_id,
            &incoming,
        )
        .map_err(|error| error.to_string())?;
        self.append_journal(
            &record.operation_id,
            "committed",
            &relative_path_text,
            record.expected_revision.as_deref(),
            &record.next_revision,
            None,
        )
        .map_err(|error| error.to_string())?;
        for backup_path in backup_paths {
            let _ = fs::remove_file(backup_path);
        }
        Ok(())
    }

    fn recover_interrupted_create(
        &self,
        record: &WriteJournalRecord,
    ) -> Result<RecoveryOutcome, String> {
        if record.expected_revision.is_some() {
            return Err("create journal entry unexpectedly has an existing revision".to_owned());
        }
        let relative_path_text =
            path_to_slashes(&record.relative_path).map_err(|error| error.to_string())?;
        let incoming = self.read_recovery_image(
            &format!("{}-incoming", record.operation_id),
            &relative_path_text,
            &record.next_revision,
            None,
        )?;
        let (parent, target_name) = self
            .root
            .open_parent_nofollow(&record.relative_path)
            .map_err(|error| error.to_string())?;
        let current = self
            .read_create_target_at(&parent, &target_name, &record.relative_path)
            .map_err(|error| error.to_string())?;
        let temporary_name = super::create_temporary_name(&record.operation_id);
        let (publish_outcome, temporary_identity) = match current {
            Some(current) if current.revision_sha256 == record.next_revision => {
                let identity = self
                    .open_create_entry_identity_at(&parent, &target_name, &record.relative_path)
                    .map_err(|error| error.to_string())?;
                let stage_matches = match identity.as_ref() {
                    Some(identity) => self
                        .create_entry_matches_handle_at(
                            &parent,
                            &temporary_name,
                            &record.relative_path,
                            identity,
                        )
                        .map_err(|error| error.to_string())?,
                    None => false,
                };
                if stage_matches {
                    (CreatePublishOutcome::Published, identity)
                } else {
                    (
                        CreatePublishOutcome::Conflict {
                            current_revision: current.revision_sha256,
                        },
                        None,
                    )
                }
            }
            Some(current) => (
                CreatePublishOutcome::Conflict {
                    current_revision: current.revision_sha256,
                },
                None,
            ),
            None => self.publish_recovered_create(record, &parent, &target_name, &incoming)?,
        };

        if let CreatePublishOutcome::Conflict { current_revision } = publish_outcome {
            self.preserve_create_recovery_conflict(
                record,
                &relative_path_text,
                &incoming,
                &current_revision,
            )?;
            self.remove_valid_create_temporary_at(CreateTemporaryCleanup {
                parent: &parent,
                temporary_name: &temporary_name,
                target_name: &target_name,
                relative_path: &record.relative_path,
                expected_revision: &record.next_revision,
                require_target_link: false,
                expected_file: temporary_identity.as_ref(),
            })?;
            sync_create_directory(&parent).map_err(|error| {
                format!("create conflict staging cleanup could not be synced: {error}")
            })?;
            self.append_create_journal(
                &record.operation_id,
                "conflict",
                &relative_path_text,
                None,
                &record.next_revision,
                Some("create destination already exists and publication provenance could not be verified"),
            )
            .map_err(|error| error.to_string())?;
            return Ok(RecoveryOutcome::NeedsAttention(format!(
                "create target was not verifiably published by this operation; it was left untouched and incoming bytes were preserved as a resolvable conflict at {}",
                self.app_data_root
                    .join("conflicts")
                    .join(format!("{}-incoming.incoming", record.operation_id))
                    .display()
            )));
        }

        sync_create_directory(&parent)
            .map_err(|error| format!("recovered create directory could not be synced: {error}"))?;

        let temporary_identity = temporary_identity
            .as_ref()
            .ok_or_else(|| "recovered create has no retained staging identity".to_owned())?;
        let published_after_sync = self
            .read_create_target_at(&parent, &target_name, &record.relative_path)
            .map_err(|error| error.to_string())?;
        let stage_matches_after_sync = self
            .create_entry_matches_handle_at(
                &parent,
                &temporary_name,
                &record.relative_path,
                temporary_identity,
            )
            .map_err(|error| error.to_string())?;
        let target_matches_after_sync = self
            .create_entry_matches_handle_at(
                &parent,
                &target_name,
                &record.relative_path,
                temporary_identity,
            )
            .map_err(|error| error.to_string())?;
        if published_after_sync
            .as_ref()
            .is_none_or(|read| read.revision_sha256 != record.next_revision)
            || !stage_matches_after_sync
            || !target_matches_after_sync
        {
            return Err("recovered create publication changed before its commit record".to_owned());
        }

        self.append_create_journal(
            &record.operation_id,
            "committed",
            &relative_path_text,
            None,
            &record.next_revision,
            None,
        )
        .map_err(|error| error.to_string())?;
        self.remove_valid_create_temporary_at(CreateTemporaryCleanup {
            parent: &parent,
            temporary_name: &temporary_name,
            target_name: &target_name,
            relative_path: &record.relative_path,
            expected_revision: &record.next_revision,
            require_target_link: true,
            expected_file: Some(temporary_identity),
        })?;
        sync_create_directory(&parent).map_err(|error| {
            format!("recovered create staging cleanup could not be synced: {error}")
        })?;
        Ok(RecoveryOutcome::Recovered)
    }

    fn publish_recovered_create(
        &self,
        record: &WriteJournalRecord,
        parent: &CapabilityDir,
        target_name: &OsStr,
        incoming: &[u8],
    ) -> Result<(CreatePublishOutcome, Option<super::SameFileHandle>), String> {
        let (temporary_name, temporary_identity) = self.prepare_create_temporary_at(
            parent,
            &record.operation_id,
            incoming,
            &record.next_revision,
        )?;
        let staged = self
            .read_create_target_at(parent, &temporary_name, &record.relative_path)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| {
                "create recovery staging file disappeared before publication".to_owned()
            })?;
        if staged.revision_sha256 != record.next_revision
            || !self
                .create_entry_matches_handle_at(
                    parent,
                    &temporary_name,
                    &record.relative_path,
                    &temporary_identity,
                )
                .map_err(|error| error.to_string())?
        {
            return Err(
                "create recovery staging file failed its identity or revision check".to_owned(),
            );
        }
        match parent.hard_link(&temporary_name, parent, target_name) {
            Ok(()) => {
                let current = self
                    .read_create_target_at(parent, target_name, &record.relative_path)
                    .map_err(|error| error.to_string())?;
                match current {
                    Some(read)
                        if read.revision_sha256 == record.next_revision
                            && self
                                .create_entry_matches_handle_at(
                                    parent,
                                    target_name,
                                    &record.relative_path,
                                    &temporary_identity,
                                )
                                .map_err(|error| error.to_string())? =>
                    {
                        Ok((CreatePublishOutcome::Published, Some(temporary_identity)))
                    }
                    Some(read) => Ok((
                        CreatePublishOutcome::Conflict {
                            current_revision: read.revision_sha256,
                        },
                        Some(temporary_identity),
                    )),
                    None => Err("create target disappeared during recovery publication".to_owned()),
                }
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                let current = self
                    .read_create_target_at(parent, target_name, &record.relative_path)
                    .map_err(|read_error| read_error.to_string())?;
                match current {
                    Some(read)
                        if read.revision_sha256 == record.next_revision
                            && self
                                .create_entry_matches_handle_at(
                                    parent,
                                    target_name,
                                    &record.relative_path,
                                    &temporary_identity,
                                )
                                .map_err(|same_file_error| same_file_error.to_string())? =>
                    {
                        Ok((CreatePublishOutcome::Published, Some(temporary_identity)))
                    }
                    Some(read) => Ok((
                        CreatePublishOutcome::Conflict {
                            current_revision: read.revision_sha256,
                        },
                        Some(temporary_identity),
                    )),
                    None => Err("create target disappeared during recovery publication".to_owned()),
                }
            }
            Err(error) => Err(format!(
                "create recovery could not publish without replacement: {error}"
            )),
        }
    }

    fn cleanup_terminal_create_staging(
        &self,
        record: &WriteJournalRecord,
        committed: bool,
    ) -> Result<(), String> {
        let (parent, target_name) = match self.root.open_parent_nofollow(&record.relative_path) {
            Ok(parent) => parent,
            Err(VaultError::Root(source)) if source.kind() == io::ErrorKind::NotFound => {
                return Ok(());
            }
            Err(error) => return Err(error.to_string()),
        };
        let temporary_name = super::create_temporary_name(&record.operation_id);
        self.remove_valid_create_temporary_at(CreateTemporaryCleanup {
            parent: &parent,
            temporary_name: &temporary_name,
            target_name: &target_name,
            relative_path: &record.relative_path,
            expected_revision: &record.next_revision,
            require_target_link: committed,
            expected_file: None,
        })?;
        sync_create_directory(&parent)
            .map_err(|error| format!("create staging directory could not be synced: {error}"))
    }

    fn preserve_create_recovery_conflict(
        &self,
        record: &WriteJournalRecord,
        relative_path_text: &str,
        incoming: &[u8],
        current_revision: &str,
    ) -> Result<(), String> {
        let conflict_id = format!("{}-incoming", record.operation_id);
        let conflict_directory = self.app_data_root.join("conflicts");
        let record_path = conflict_directory.join(format!("{conflict_id}.json"));
        let artifact_path = conflict_directory.join(format!("{conflict_id}.incoming"));
        let directory_metadata = match fs::symlink_metadata(&conflict_directory) {
            Ok(metadata) => Some(metadata),
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => {
                return Err(format!("conflict history cannot be checked: {error}"));
            }
        };

        match directory_metadata {
            Some(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err("conflict history is not a safe directory".to_owned());
            }
            Some(_) => {
                let record_exists = path_exists_without_following(&record_path)?;
                let artifact_exists = path_exists_without_following(&artifact_path)?;
                match (record_exists, artifact_exists) {
                    (false, false) => {
                        self.preserve_bytes(
                            "conflicts",
                            &conflict_id,
                            ".incoming",
                            relative_path_text,
                            incoming,
                            &record.next_revision,
                            None,
                            Some(current_revision),
                        )
                        .map_err(|error| error.to_string())?;
                    }
                    (true, true) => {
                        let existing = self
                            .read_conflict(&conflict_id, &record.relative_path)
                            .map_err(|error| {
                                format!("existing create conflict record is invalid: {error}")
                            })?;
                        if existing.bytes.as_slice() != incoming
                            || existing.revision_sha256 != record.next_revision
                            || existing.record.expected_revision_sha256.is_some()
                            || existing.record.current_revision_sha256.as_deref()
                                != Some(current_revision)
                        {
                            return Err(
                                "existing create conflict record does not match the interrupted operation"
                                    .to_owned(),
                            );
                        }
                    }
                    _ => {
                        return Err(
                            "create conflict history is only partially preserved".to_owned()
                        );
                    }
                }
            }
            None => {
                self.preserve_bytes(
                    "conflicts",
                    &conflict_id,
                    ".incoming",
                    relative_path_text,
                    incoming,
                    &record.next_revision,
                    None,
                    Some(current_revision),
                )
                .map_err(|error| error.to_string())?;
            }
        }

        Ok(())
    }

    fn read_recovery_image(
        &self,
        record_id: &str,
        relative_path: &str,
        revision: &str,
        expected_revision: Option<&str>,
    ) -> Result<Vec<u8>, String> {
        let directory = self.app_data_root.join("recovery");
        let metadata = fs::symlink_metadata(&directory)
            .map_err(|error| format!("recovery history is unavailable: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("recovery history directory is not a safe directory".to_owned());
        }
        let canonical_directory = fs::canonicalize(&directory)
            .map_err(|error| format!("recovery history directory cannot be verified: {error}"))?;
        if !canonical_directory.starts_with(&self.app_data_root) {
            return Err("recovery history directory escapes app-owned data".to_owned());
        }

        let artifact_path = canonical_directory.join(format!("{record_id}.bin"));
        let manifest_path = canonical_directory.join(format!("{record_id}.json"));
        for path in [&artifact_path, &manifest_path] {
            let metadata = fs::symlink_metadata(path)
                .map_err(|error| format!("required recovery image is unavailable: {error}"))?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err("recovery image or its record is not a regular file".to_owned());
            }
        }
        let bytes = fs::read(&artifact_path)
            .map_err(|error| format!("recovery image cannot be read: {error}"))?;
        let manifest: Value = serde_json::from_slice(
            &fs::read(&manifest_path)
                .map_err(|error| format!("recovery image record cannot be read: {error}"))?,
        )
        .map_err(|error| format!("recovery image record is invalid: {error}"))?;
        if manifest.get("id").and_then(Value::as_str) != Some(record_id)
            || manifest.get("relative_path").and_then(Value::as_str) != Some(relative_path)
            || manifest.get("revision").and_then(Value::as_str) != Some(revision)
            || manifest.get("bytes").and_then(Value::as_u64) != Some(bytes.len() as u64)
            || !optional_revision_matches(&manifest, "expected_revision", expected_revision)
            || !optional_revision_matches(&manifest, "current_revision", expected_revision)
            || sha256_hex(&bytes) != revision
        {
            return Err("recovery image does not match its journaled path and revision".to_owned());
        }
        Ok(bytes)
    }
}

fn path_exists_without_following(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("history path cannot be checked: {error}")),
    }
}

fn optional_revision_matches(value: &Value, field: &str, expected: Option<&str>) -> bool {
    match (value.get(field), expected) {
        (Some(Value::Null), None) => true,
        (Some(Value::String(actual)), Some(expected)) => actual == expected,
        _ => false,
    }
}

#[cfg(windows)]
fn matching_windows_backups(
    target_path: &Path,
    operation_id: &str,
    expected_revision: Option<&str>,
    next_revision: &str,
) -> Result<Vec<PathBuf>, String> {
    let file_name = target_path
        .file_name()
        .ok_or_else(|| "target has no filename for its Windows replacement backup".to_owned())?
        .to_string_lossy();
    let parent = target_path
        .parent()
        .ok_or_else(|| "target has no parent for its Windows replacement backup".to_owned())?;
    let backup_prefix = format!(".{file_name}.{operation_id}");
    let recovery_prefix = format!("{backup_prefix}-recovery-");
    let rollback_name = format!("{backup_prefix}-rollback.backup");
    let mut backups = Vec::new();
    for entry in fs::read_dir(parent)
        .map_err(|error| format!("Windows replacement backups cannot be listed: {error}"))?
    {
        let entry = entry
            .map_err(|error| format!("Windows replacement backup entry cannot be read: {error}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let expected_backup_revision = if name == format!("{backup_prefix}.backup")
            || (name.starts_with(&recovery_prefix) && name.ends_with(".backup"))
        {
            expected_revision
        } else if name == rollback_name {
            Some(next_revision)
        } else {
            continue;
        };
        let Some(expected_backup_revision) = expected_backup_revision else {
            return Err("unexpected Windows replacement backup for a new file".to_owned());
        };
        let backup_path = entry.path();
        let metadata = fs::symlink_metadata(&backup_path)
            .map_err(|error| format!("Windows replacement backup cannot be checked: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("Windows replacement backup is not a regular file".to_owned());
        }
        let bytes = fs::read(&backup_path)
            .map_err(|error| format!("Windows replacement backup cannot be read: {error}"))?;
        if sha256_hex(&bytes) != expected_backup_revision {
            return Err("Windows replacement backup revision does not match the write".to_owned());
        }
        backups.push(backup_path);
    }
    Ok(backups)
}

fn parse_write_journal_record(value: &Value) -> Result<WriteJournalRecord, String> {
    let operation = match value.get("operation").and_then(Value::as_str) {
        Some("write") => WriteJournalOperation::Write,
        Some("create") => WriteJournalOperation::Create,
        _ => return Err("write journal entry has an unsupported operation".to_owned()),
    };
    let operation_id = value
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| {
            !id.is_empty()
                && id.len() <= 128
                && id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
        .ok_or_else(|| "write/create journal entry has an invalid operation id".to_owned())?
        .to_owned();
    let path = value
        .get("relative_path")
        .and_then(Value::as_str)
        .ok_or_else(|| "write/create journal entry is missing its relative path".to_owned())?;
    let relative_path = normalize_relative_path(Path::new(path))
        .map_err(|error| format!("write journal path is unsafe: {error}"))?;
    if path_to_slashes(&relative_path).map_err(|error| error.to_string())? != path {
        return Err("write/create journal path is not normalized".to_owned());
    }
    let expected_revision = match value.get("expected_revision") {
        Some(Value::Null) => None,
        Some(Value::String(revision)) if is_sha256(revision) => Some(revision.clone()),
        _ => return Err("write/create journal entry has an invalid expected revision".to_owned()),
    };
    if operation == WriteJournalOperation::Create && expected_revision.is_some() {
        return Err("create journal entry unexpectedly has an existing revision".to_owned());
    }
    let next_revision = value
        .get("next_revision")
        .and_then(Value::as_str)
        .filter(|revision| is_sha256(revision))
        .ok_or_else(|| "write/create journal entry has an invalid next revision".to_owned())?
        .to_owned();
    Ok(WriteJournalRecord {
        operation,
        operation_id,
        relative_path,
        expected_revision,
        next_revision,
    })
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
