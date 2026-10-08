//! Source-preserving vault reads and revision-bound rename previews.

use openobsidian_doc::{
    LinkRenamePlan, LinkRenamePlanError, MarkdownSource, RawDocument, RenamePlanFile,
    build_link_rename_plan,
};
use sha2::{Digest, Sha256};
use std::fmt::Write as _;
use std::fs;
use std::path::{Component, Path, PathBuf};
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
        validate_relative_path(relative_path)?;
        let components: Vec<_> = relative_path.components().collect();
        let mut candidate = self.canonical_root.clone();
        for (index, component) in components.iter().enumerate() {
            candidate.push(component.as_os_str());
            let metadata = fs::symlink_metadata(&candidate)?;
            if metadata.file_type().is_symlink() {
                return Err(VaultError::Symlink(relative_path.to_path_buf()));
            }
            if index + 1 < components.len() && !metadata.is_dir() {
                return Err(VaultError::NotAFile(relative_path.to_path_buf()));
            }
        }
        let canonical = fs::canonicalize(&candidate)?;
        if !canonical.starts_with(&self.canonical_root) {
            return Err(VaultError::OutsideRoot(relative_path.to_path_buf()));
        }
        if !canonical.is_file() {
            return Err(VaultError::NotAFile(relative_path.to_path_buf()));
        }
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
        let plan_id = rename_preview_identity(
            &before.revision_sha256,
            &old_path_text,
            &new_path_text,
        );
        Ok(VaultRenamePreview {
            plan,
            snapshot_sha256: before.revision_sha256,
            plan_id,
        })
    }

    /// Reject a preview if any vault file, symlink or reference decision changed.
    pub fn verify_rename_preview(
        &self,
        preview: &VaultRenamePreview,
    ) -> Result<(), VaultError> {
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
    use super::VaultRoot;
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
        assert_ne!(before.entries[0].revision_sha256, before.entries[1].revision_sha256);

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
            .find(|entry| entry.relative_path == PathBuf::from("alias.md"))
            .unwrap();
        assert_eq!(alias.kind, super::VaultSnapshotEntryKind::Symlink);
        assert_eq!(alias.symlink_target.as_deref(), Some(std::path::Path::new("target.md")));
        assert!(matches!(
            vault.read("alias.md"),
            Err(super::VaultError::Symlink(_))
        ));
    }
}
