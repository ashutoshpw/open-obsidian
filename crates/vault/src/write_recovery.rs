use super::{VaultError, VaultStore, normalize_relative_path, path_to_slashes, sha256_hex};
use serde_json::Value;
use std::collections::HashMap;
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
    operation_id: String,
    relative_path: PathBuf,
    expected_revision: Option<String>,
    next_revision: String,
}

impl VaultStore {
    /// Completes interrupted writes only when the target still has the revision
    /// expected by the original operation. Incoming and previous bytes remain
    /// in app-owned recovery history until a later explicit cleanup.
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
            if value.get("operation").and_then(Value::as_str) != Some("write") {
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
            match state {
                Some("prepared" | "recovery_required") => {}
                Some("committed" | "failed" | "conflict") => continue,
                _ => {
                    report.needs_attention.push(VaultWriteRecoveryIssue {
                        operation_id,
                        reason: "write journal entry has a missing or unknown state".to_owned(),
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
            match self.recover_interrupted_write(&record) {
                Ok(()) => report.recovered_operations.push(record.operation_id),
                Err(reason) => {
                    let reason = match self.append_journal(
                        &record.operation_id,
                        "recovery_required",
                        &path_to_slashes(&record.relative_path)?,
                        record.expected_revision.as_deref(),
                        &record.next_revision,
                        Some(&reason),
                    ) {
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
        .ok_or_else(|| "write journal entry has an invalid operation id".to_owned())?
        .to_owned();
    let path = value
        .get("relative_path")
        .and_then(Value::as_str)
        .ok_or_else(|| "write journal entry is missing its relative path".to_owned())?;
    let relative_path = normalize_relative_path(Path::new(path))
        .map_err(|error| format!("write journal path is unsafe: {error}"))?;
    if path_to_slashes(&relative_path).map_err(|error| error.to_string())? != path {
        return Err("write journal path is not normalized".to_owned());
    }
    let expected_revision = match value.get("expected_revision") {
        Some(Value::Null) => None,
        Some(Value::String(revision)) if is_sha256(revision) => Some(revision.clone()),
        _ => return Err("write journal entry has an invalid expected revision".to_owned()),
    };
    let next_revision = value
        .get("next_revision")
        .and_then(Value::as_str)
        .filter(|revision| is_sha256(revision))
        .ok_or_else(|| "write journal entry has an invalid next revision".to_owned())?
        .to_owned();
    Ok(WriteJournalRecord {
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
