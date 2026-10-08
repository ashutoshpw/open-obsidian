use super::{
    LinkRenameAction, RawDocument, VaultError, VaultRead, VaultRenamePreview, VaultSnapshot,
    VaultSnapshotEntryKind, VaultStore, VaultWriteRequest, json_string, next_operation_id,
    normalize_relative_path, path_to_slashes, sha256_hex, timestamp,
};
use openobsidian_doc::SourceSpan;
use std::collections::{BTreeMap, BTreeSet};
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
        let journal_paths = journal_paths(&updates, &old_path, &new_path)?;
        self.append_rename_journal(
            &operation_id,
            "prepared",
            preview,
            &journal_paths,
            None,
        )?;

        for (index, update) in updates.iter().enumerate() {
            let relative_path_text = path_to_slashes(&update.source_path)?;
            if let Err(error) = self.preserve_bytes(
                "recovery",
                &format!("{operation_id}-rename-before-{index}"),
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
        }

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

            self.append_rename_journal(
                &operation_id,
                "committed",
                preview,
                &journal_paths,
                None,
            )?;
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
            if let Err(journal_error) = self.append_rename_journal(
                &operation_id,
                "failed",
                preview,
                &journal_paths,
                Some(&error.to_string()),
            ) {
                recovery_errors.push(format!("failed journal append: {journal_error}"));
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
        let current_revision = current
            .as_ref()
            .map(|read| read.revision_sha256.as_str());
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
                reason: format!("no vault files changed; failure journal append failed: {journal_error}"),
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

            if let Some(temporary_path) = move_state.temporary_path.as_ref() {
                match fs::symlink_metadata(temporary_path) {
                    Ok(_) => {
                        if let Err(error) = move_vault_file(
                            temporary_path,
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
                        errors.push(format!("original source path could not be checked: {error}"));
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

fn apply_target_edits(
    bytes: &[u8],
    edits: &[(SourceSpan, String)],
) -> Result<Vec<u8>, VaultError> {
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
