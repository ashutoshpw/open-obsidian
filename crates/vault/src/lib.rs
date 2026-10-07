//! Read-only vault foundation. Transactional writes are added with the R2 migration slices.

use openobsidian_doc::RawDocument;
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
        let candidate = self.canonical_root.join(relative_path);
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
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut output, "{byte:02x}").expect("writing into a String cannot fail");
    }
    output
}

#[cfg(test)]
mod tests {
    use super::VaultRoot;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!("openobsidian-vault-{nonce}"));
            fs::create_dir_all(&path).unwrap();
            Self(path)
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
}
