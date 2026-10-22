//! Confined folder creation and non-destructive "local trash" deletion.

use super::{
    CapabilityDir, Component, VaultError, VaultStore, json_string, next_operation_id,
    normalize_relative_path, path_to_slashes, timestamp,
};
use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};

/// Name of the vault-root folder that receives trashed files.
pub const VAULT_TRASH_DIRECTORY: &str = ".trash";

const MAX_TRASH_COLLISION_SUFFIX: u32 = 10_000;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultTrashResult {
    /// Normalized vault-relative path the file had before it was trashed.
    pub original_path: PathBuf,
    /// Vault-relative path of the file beneath `.trash/`.
    pub trashed_path: PathBuf,
}

/// Opens each component beneath `base` without following symlinks, creating
/// missing directories. Existing symlinks and files are refused.
pub(crate) fn ensure_directory_nofollow(
    base: &CapabilityDir,
    components: &[Component<'_>],
    relative_path: &Path,
) -> Result<CapabilityDir, VaultError> {
    let mut current = base.try_clone()?;
    for component in components {
        let name = component.as_os_str();
        match current.symlink_metadata(name) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(VaultError::Symlink(relative_path.to_path_buf()));
            }
            Ok(metadata) if !metadata.is_dir() => {
                return Err(VaultError::NotAFile(relative_path.to_path_buf()));
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                match current.create_dir(name) {
                    Ok(()) => {}
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                    Err(error) => return Err(error.into()),
                }
            }
            Err(error) => return Err(error.into()),
        }
        current = current.open_dir_nofollow(name)?;
    }
    Ok(current)
}

fn trash_candidate_name(name: &Path, attempt: u32) -> Result<OsString, VaultError> {
    if attempt == 0 {
        return Ok(name.as_os_str().to_os_string());
    }
    let stem = name
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or(VaultError::InvalidPath)?;
    let candidate = match name.extension().and_then(|extension| extension.to_str()) {
        Some(extension) => format!("{stem} {attempt}.{extension}"),
        None => format!("{stem} {attempt}"),
    };
    Ok(candidate.into())
}

impl VaultStore {
    /// Creates a vault folder and any missing parents without following
    /// symlinks. Succeeds when the folder already exists; fails when a
    /// component exists as a file or symlink. Returns the normalized path.
    pub fn create_folder(&self, relative_path: impl AsRef<Path>) -> Result<PathBuf, VaultError> {
        let relative_path = normalize_relative_path(relative_path.as_ref())?;
        let components = relative_path.components().collect::<Vec<_>>();
        ensure_directory_nofollow(&self.root.capability_root, &components, &relative_path)?;
        Ok(relative_path)
    }

    /// Moves one regular file into `<vault>/.trash/`, preserving its relative
    /// path and adding a numeric suffix (`name 1.md`) on collision. The file's
    /// current revision must equal `expected_revision_sha256`. Nothing is
    /// deleted: the file is hard-linked into the trash (never overwriting an
    /// existing entry) and only then unlinked from its old location.
    /// Directories and symlinks are refused.
    pub fn trash_file(
        &self,
        relative_path: impl AsRef<Path>,
        expected_revision_sha256: &str,
    ) -> Result<VaultTrashResult, VaultError> {
        let relative_path = normalize_relative_path(relative_path.as_ref())?;
        let components = relative_path.components().collect::<Vec<_>>();
        if components
            .first()
            .is_some_and(|first| first.as_os_str() == VAULT_TRASH_DIRECTORY)
        {
            return Err(VaultError::InvalidPath);
        }
        let relative_path_text = path_to_slashes(&relative_path)?;
        let (parent, leaf) = self.root.open_parent_nofollow(&relative_path)?;
        let current = self
            .read_create_target_at(&parent, &leaf, &relative_path)?
            .ok_or_else(|| VaultError::Root(io::ErrorKind::NotFound.into()))?;
        if current.revision_sha256 != expected_revision_sha256 {
            return Err(VaultError::StaleRevision {
                relative_path,
                expected_revision: expected_revision_sha256.to_owned(),
                current_revision: current.revision_sha256,
            });
        }

        let mut trash_components = vec![Component::Normal(VAULT_TRASH_DIRECTORY.as_ref())];
        let parent_count = components.len() - 1;
        trash_components.extend_from_slice(&components[..parent_count]);
        let trash_directory = ensure_directory_nofollow(
            &self.root.capability_root,
            &trash_components,
            &relative_path,
        )?;

        let operation_id = next_operation_id();
        self.append_trash_journal(
            &operation_id,
            "prepared",
            &relative_path_text,
            expected_revision_sha256,
            None,
        )?;

        let leaf_path = Path::new(&leaf);
        let mut trashed_name = None;
        for attempt in 0..=MAX_TRASH_COLLISION_SUFFIX {
            let candidate = trash_candidate_name(leaf_path, attempt)?;
            match parent.hard_link(&leaf, &trash_directory, &candidate) {
                Ok(()) => {
                    trashed_name = Some(candidate);
                    break;
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                Err(error) => {
                    let _ = self.append_trash_journal(
                        &operation_id,
                        "failed",
                        &relative_path_text,
                        expected_revision_sha256,
                        Some(&error.to_string()),
                    );
                    return Err(VaultError::WriteFailed {
                        relative_path,
                        source: error,
                    });
                }
            }
        }
        let Some(trashed_name) = trashed_name else {
            let error = io::Error::new(io::ErrorKind::AlreadyExists, "no free trash name");
            let _ = self.append_trash_journal(
                &operation_id,
                "failed",
                &relative_path_text,
                expected_revision_sha256,
                Some(&error.to_string()),
            );
            return Err(VaultError::WriteFailed {
                relative_path,
                source: error,
            });
        };

        // Re-check the source right before unlinking so a concurrent edit is
        // never moved away under a revision the caller did not see.
        let latest = self
            .read_create_target_at(&parent, &leaf, &relative_path)
            .ok()
            .flatten();
        if latest
            .as_ref()
            .is_none_or(|read| read.revision_sha256 != expected_revision_sha256)
        {
            let _ = trash_directory.remove_file(&trashed_name);
            let _ = self.append_trash_journal(
                &operation_id,
                "failed",
                &relative_path_text,
                expected_revision_sha256,
                Some("source changed before it could be trashed"),
            );
            return Err(VaultError::StaleRevision {
                relative_path,
                expected_revision: expected_revision_sha256.to_owned(),
                current_revision: latest
                    .map(|read| read.revision_sha256)
                    .unwrap_or_default(),
            });
        }
        if let Err(error) = parent.remove_file(&leaf) {
            let _ = trash_directory.remove_file(&trashed_name);
            let _ = self.append_trash_journal(
                &operation_id,
                "failed",
                &relative_path_text,
                expected_revision_sha256,
                Some(&error.to_string()),
            );
            return Err(VaultError::WriteFailed {
                relative_path,
                source: error,
            });
        }

        // The move is complete; a lost "committed" record must not report it as failed.
        let _ = self.append_trash_journal(
            &operation_id,
            "committed",
            &relative_path_text,
            expected_revision_sha256,
            None,
        );

        let mut trashed_path = PathBuf::from(VAULT_TRASH_DIRECTORY);
        for component in &components[..parent_count] {
            trashed_path.push(component.as_os_str());
        }
        trashed_path.push(&trashed_name);
        Ok(VaultTrashResult {
            original_path: relative_path,
            trashed_path,
        })
    }

    fn append_trash_journal(
        &self,
        operation_id: &str,
        state: &str,
        relative_path: &str,
        revision: &str,
        error: Option<&str>,
    ) -> Result<(), VaultError> {
        let error_json = error.map_or_else(|| "null".to_owned(), json_string);
        let line = format!(
            "{{\"id\":{},\"operation\":\"trash\",\"state\":{},\"relative_path\":{},\"expected_revision\":{},\"next_revision\":null,\"recorded_at\":{},\"error\":{}}}\n",
            json_string(operation_id),
            json_string(state),
            json_string(relative_path),
            json_string(revision),
            json_string(&timestamp()),
            error_json,
        );
        self.append_journal_line(&line)
    }
}

#[cfg(test)]
mod tests {
    use super::VAULT_TRASH_DIRECTORY;
    use crate::{VaultCreateRequest, VaultError, VaultStore, sha256_hex};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TRASH_TEST_DIR_ID: AtomicU64 = AtomicU64::new(0);

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            loop {
                let id = NEXT_TRASH_TEST_DIR_ID.fetch_add(1, Ordering::Relaxed);
                let name = format!("openobsidian-trash-{}-{id}", std::process::id());
                let path = std::env::temp_dir().join(name);
                match fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("creating test dir {}: {error}", path.display()),
                }
            }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn open_store(vault: &TempDir, app_data: &TempDir) -> VaultStore {
        VaultStore::open(&vault.0, &app_data.0).unwrap()
    }

    fn create_note(store: &VaultStore, path: &str, bytes: &[u8]) -> String {
        let result = store
            .create_new(VaultCreateRequest {
                relative_path: PathBuf::from(path),
                bytes: bytes.to_vec(),
            })
            .unwrap();
        result.read.revision_sha256
    }

    #[test]
    fn create_folder_makes_missing_parents_and_refuses_files() {
        let vault = TempDir::new();
        let app_data = TempDir::new();
        let store = open_store(&vault, &app_data);

        let created = store.create_folder("A/B/C").unwrap();
        assert_eq!(created, PathBuf::from("A/B/C"));
        assert!(vault.0.join("A/B/C").is_dir());
        store.create_folder("A/B").unwrap();

        fs::write(vault.0.join("file.md"), b"x").unwrap();
        let error = store.create_folder("file.md").unwrap_err();
        assert!(matches!(error, VaultError::NotAFile(_)));
        let error = store.create_folder("file.md/sub").unwrap_err();
        assert!(matches!(error, VaultError::NotAFile(_)));
        let error = store.create_folder("../outside").unwrap_err();
        assert!(matches!(error, VaultError::InvalidPath));
        let error = store.create_folder("/abs").unwrap_err();
        assert!(matches!(error, VaultError::InvalidPath));
    }

    #[test]
    fn create_then_trash_round_trip_preserves_bytes() {
        let vault = TempDir::new();
        let app_data = TempDir::new();
        let store = open_store(&vault, &app_data);
        store.create_folder("Notes").unwrap();
        let bytes = b"\xef\xbb\xbf# Title\r\nbody\r\n";
        let revision = create_note(&store, "Notes/Idea.md", bytes);

        let result = store.trash_file("Notes/Idea.md", &revision).unwrap();

        assert_eq!(result.original_path, PathBuf::from("Notes/Idea.md"));
        assert_eq!(result.trashed_path, Path::new(".trash/Notes/Idea.md"));
        assert!(!vault.0.join("Notes/Idea.md").exists());
        assert_eq!(fs::read(vault.0.join(&result.trashed_path)).unwrap(), bytes);
        assert_eq!(sha256_hex(bytes), revision);
        let journal = fs::read_to_string(app_data.0.join("journal.jsonl")).unwrap();
        assert!(journal.contains("\"operation\":\"trash\""));
        assert!(journal.contains("\"state\":\"committed\""));
        let entries = store.root().scan_markdown().unwrap();
        for entry in &entries {
            assert!(!entry.relative_path.starts_with(".trash"));
        }
    }

    #[test]
    fn stale_revision_is_refused_and_leaves_file_unchanged() {
        let vault = TempDir::new();
        let app_data = TempDir::new();
        let store = open_store(&vault, &app_data);
        create_note(&store, "Note.md", b"one");
        let stale = sha256_hex(b"other");

        let error = store.trash_file("Note.md", &stale).unwrap_err();

        assert!(matches!(error, VaultError::StaleRevision { .. }));
        assert_eq!(fs::read(vault.0.join("Note.md")).unwrap(), b"one");
        assert!(!vault.0.join(VAULT_TRASH_DIRECTORY).exists());
    }

    #[test]
    fn second_trash_of_same_path_gets_numeric_suffix() {
        let vault = TempDir::new();
        let app_data = TempDir::new();
        let store = open_store(&vault, &app_data);
        let first = create_note(&store, "Note.md", b"first");
        let first_result = store.trash_file("Note.md", &first).unwrap();
        let second = create_note(&store, "Note.md", b"second");
        let second_result = store.trash_file("Note.md", &second).unwrap();

        assert_eq!(first_result.trashed_path, Path::new(".trash/Note.md"));
        assert_eq!(second_result.trashed_path, Path::new(".trash/Note 1.md"));
        assert_eq!(fs::read(vault.0.join(".trash/Note.md")).unwrap(), b"first");
        assert_eq!(fs::read(vault.0.join(".trash/Note 1.md")).unwrap(), b"second");
    }

    #[test]
    fn directories_and_trash_contents_are_refused() {
        let vault = TempDir::new();
        let app_data = TempDir::new();
        let store = open_store(&vault, &app_data);
        store.create_folder("Folder.md").unwrap();
        let empty = sha256_hex(b"");

        let error = store.trash_file("Folder.md", &empty).unwrap_err();
        assert!(matches!(error, VaultError::NotAFile(_)));
        assert!(vault.0.join("Folder.md").is_dir());

        let revision = create_note(&store, "Note.md", b"x");
        store.trash_file("Note.md", &revision).unwrap();
        let error = store.trash_file(".trash/Note.md", &revision).unwrap_err();
        assert!(matches!(error, VaultError::InvalidPath));
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_refused_without_touching_targets() {
        let vault = TempDir::new();
        let app_data = TempDir::new();
        let outside = TempDir::new();
        let secret_path = outside.0.join("secret.md");
        fs::write(&secret_path, b"secret").unwrap();
        let link = vault.0.join("link.md");
        let dir_link = vault.0.join("dir-link");
        std::os::unix::fs::symlink(&secret_path, &link).unwrap();
        std::os::unix::fs::symlink(&outside.0, &dir_link).unwrap();
        let store = open_store(&vault, &app_data);
        let secret = sha256_hex(b"secret");

        let error = store.trash_file("link.md", &secret).unwrap_err();
        assert!(matches!(error, VaultError::Symlink(_)));
        let nested = store.trash_file("dir-link/secret.md", &secret);
        assert!(nested.is_err());
        let folder = store.create_folder("dir-link/new");
        assert!(folder.is_err());
        let link_type = fs::symlink_metadata(&link).unwrap().file_type();
        assert!(link_type.is_symlink());
        assert_eq!(fs::read(&secret_path).unwrap(), b"secret");
        assert!(!outside.0.join("new").exists());
    }

    #[test]
    fn path_traversal_is_refused() {
        let vault = TempDir::new();
        let app_data = TempDir::new();
        let store = open_store(&vault, &app_data);
        let revision = sha256_hex(b"x");

        let error = store.trash_file("../x", &revision).unwrap_err();
        assert!(matches!(error, VaultError::InvalidPath));
        let error = store.trash_file("A/../../x.md", &revision).unwrap_err();
        assert!(matches!(error, VaultError::InvalidPath));
        let error = store.trash_file("", &revision).unwrap_err();
        assert!(matches!(error, VaultError::InvalidPath));
    }
}
