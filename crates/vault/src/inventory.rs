//! Bounded, no-follow, stat-only vault file inventory and bounded file reads.

use super::{
    CapabilityDir, CapabilityOpenOptions, FollowSymlinks, IoRead, OpenOptionsFollowExt, VaultError,
    VaultRoot, normalize_relative_path,
};
use crate::configuration::{VaultConfigurationFile, is_configuration_folder};
use cap_fs_ext::DirExt;
use serde_json::Value;
use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

/// Maximum regular-file rows returned by the bounded stat-only vault inventory.
pub const MAX_VAULT_INVENTORY_FILE_ROWS: usize = 10_000;
/// Maximum filesystem entries inspected by the bounded stat-only vault inventory.
pub const MAX_VAULT_INVENTORY_ENTRIES: usize = 100_000;
/// Maximum relative path components reopened while traversing inventory directories.
pub const MAX_VAULT_INVENTORY_COMPONENT_WALKS: usize = 100_000;
/// Maximum cumulative path bytes considered while building a bounded inventory.
pub const MAX_VAULT_INVENTORY_PATH_BYTES: usize = 16 * 1024 * 1024;
/// Maximum bytes read from one configuration JSON file during discovery.
pub const MAX_VAULT_CONFIGURATION_FILE_BYTES: u64 = 4 * 1024 * 1024;

/// Stat-only information about one regular file in a vault inventory.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultFileStat {
    pub relative_path: PathBuf,
    pub size_bytes: u64,
}

/// Bounded, no-follow inventory of regular vault files as observed during one pass.
///
/// This is a discovery result, not an atomic snapshot; concurrent namespace
/// changes may occur while or after the traversal runs.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultFileInventory {
    /// Regular-file stats sorted by relative path. If a cap truncates traversal,
    /// the selected subset can depend on filesystem iteration order.
    pub files: Vec<VaultFileStat>,
    /// Directory entries encountered during traversal. Directories and symlinks
    /// count toward this limit; the vault root itself does not.
    pub inspected_entry_count: usize,
    /// Relative path components reopened while enumerating directories.
    pub directory_component_walk_count: usize,
    /// True when the component-walk budget was exhausted or stopped traversal.
    pub directory_component_walk_limit_reached: bool,
    /// Exact number of regular files omitted by the row limit when traversal
    /// completed. `None` means a limit stopped traversal before the count could
    /// be established.
    pub omitted_file_count: Option<u64>,
    /// Cumulative encoded path bytes considered across encountered entries.
    pub path_storage_bytes: usize,
    /// True when the path-storage cap stopped traversal.
    pub path_storage_limit_reached: bool,
    /// False when any configured cap was reached, even if no rows were omitted.
    pub complete: bool,
}

/// Outcome of reading a regular file under an explicit byte cap.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VaultBoundedRead {
    /// The whole file fit within the cap.
    Read { bytes: Vec<u8>, size_bytes: u64 },
    /// The file exceeds the cap; no body bytes are returned.
    TooLarge { size_bytes: u64 },
}

#[derive(Clone, Copy, Debug)]
struct InventoryLimits {
    max_file_rows: usize,
    max_entries: usize,
    max_component_walks: usize,
    max_path_bytes: usize,
}

fn default_limits() -> InventoryLimits {
    InventoryLimits {
        max_file_rows: MAX_VAULT_INVENTORY_FILE_ROWS,
        max_entries: MAX_VAULT_INVENTORY_ENTRIES,
        max_component_walks: MAX_VAULT_INVENTORY_COMPONENT_WALKS,
        max_path_bytes: MAX_VAULT_INVENTORY_PATH_BYTES,
    }
}

fn joined_path_storage_bytes(directory: &Path, name: &OsStr) -> usize {
    directory
        .as_os_str()
        .as_encoded_bytes()
        .len()
        .saturating_add(name.as_encoded_bytes().len())
        .saturating_add(usize::from(!directory.as_os_str().is_empty()))
}

impl VaultRoot {
    /// Lists bounded regular-file metadata without opening or hashing file bodies.
    ///
    /// Directory entries and symlinks count against the traversal bound. Symlinks
    /// are omitted and never traversed. Paths are sorted by vault-relative path.
    /// Reaching any cap sets `complete` to false; nothing is silently truncated.
    pub fn inventory_regular_files(&self) -> Result<VaultFileInventory, VaultError> {
        self.inventory_from(vec![PathBuf::new()], default_limits())
    }

    /// Lists bounded regular-file metadata beneath root `.obsidian` and
    /// `.obsidian-*` directories only, using the same no-follow walk and caps.
    pub fn inventory_configuration_files(&self) -> Result<VaultFileInventory, VaultError> {
        let starts = self
            .discover_configuration_folders()?
            .into_iter()
            .map(PathBuf::from)
            .collect();
        self.inventory_from(starts, default_limits())
    }

    /// Returns sorted real root-level `.obsidian` and `.obsidian-*` directory
    /// names. Symlinks and non-UTF-8 names are skipped; nothing is written.
    pub fn discover_configuration_folders(&self) -> Result<Vec<String>, VaultError> {
        let mut folders = Vec::new();
        for entry in self.capability_root.read_dir(".")? {
            let entry = entry?;
            let file_name = entry.file_name();
            let Some(name) = file_name.to_str() else {
                continue;
            };
            if !is_configuration_folder(name) {
                continue;
            }
            let metadata = self.capability_root.symlink_metadata(&file_name)?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                continue;
            }
            folders.push(name.to_owned());
        }
        folders.sort();
        Ok(folders)
    }

    /// Reads a regular file without following symlinks, refusing to return more
    /// than `max_bytes`. The size is checked before any body byte is read and
    /// the read itself is capped, so a file growing mid-read stays bounded.
    pub fn read_regular_file_bounded(
        &self,
        relative_path: impl AsRef<Path>,
        max_bytes: u64,
    ) -> Result<VaultBoundedRead, VaultError> {
        let relative_path = normalize_relative_path(relative_path.as_ref())?;
        let name = relative_path
            .file_name()
            .ok_or(VaultError::InvalidPath)?
            .to_owned();
        let parent_path = relative_path.parent().unwrap_or(Path::new(""));
        let parent = self.open_inventory_directory_nofollow(parent_path)?;
        let metadata = parent.symlink_metadata(&name)?;
        if metadata.file_type().is_symlink() {
            return Err(VaultError::Symlink(relative_path));
        }
        if !metadata.is_file() {
            return Err(VaultError::NotAFile(relative_path));
        }
        let mut options = CapabilityOpenOptions::new();
        options.read(true).follow(FollowSymlinks::No);
        let mut file = parent.open_with(&name, &options)?;
        let opened = file.metadata()?;
        if !opened.is_file() {
            return Err(VaultError::NotAFile(relative_path));
        }
        let size_bytes = opened.len();
        if size_bytes > max_bytes {
            return Ok(VaultBoundedRead::TooLarge { size_bytes });
        }
        let mut bytes = Vec::new();
        IoRead::take(&mut file, max_bytes.saturating_add(1)).read_to_end(&mut bytes)?;
        let read_bytes = bytes.len() as u64;
        if read_bytes > max_bytes {
            return Ok(VaultBoundedRead::TooLarge {
                size_bytes: read_bytes,
            });
        }
        Ok(VaultBoundedRead::Read {
            bytes,
            size_bytes: read_bytes,
        })
    }

    /// Reads one configuration JSON file under a root `.obsidian*` folder with
    /// exact bytes, no-follow and the 4 MiB cap. Returns `None` for paths outside
    /// configuration folders, non-`.json` names, oversized files, malformed JSON
    /// and non-object JSON. Never writes.
    pub fn read_configuration_file_bounded(
        &self,
        relative_path: impl AsRef<Path>,
    ) -> Result<Option<VaultConfigurationFile>, VaultError> {
        let relative_path = normalize_relative_path(relative_path.as_ref())?;
        let mut components = relative_path.components();
        let in_configuration_folder = components
            .next()
            .and_then(|component| component.as_os_str().to_str())
            .is_some_and(is_configuration_folder);
        let has_json_name = relative_path
            .extension()
            .is_some_and(|extension| extension == "json");
        if !in_configuration_folder || components.next().is_none() || !has_json_name {
            return Ok(None);
        }
        let read =
            self.read_regular_file_bounded(&relative_path, MAX_VAULT_CONFIGURATION_FILE_BYTES)?;
        let VaultBoundedRead::Read { bytes, .. } = read else {
            return Ok(None);
        };
        match serde_json::from_slice::<Value>(&bytes) {
            Ok(Value::Object(object)) => Ok(Some(VaultConfigurationFile {
                raw_bytes: bytes,
                object,
            })),
            _ => Ok(None),
        }
    }

    fn inventory_from(
        &self,
        starts: Vec<PathBuf>,
        limits: InventoryLimits,
    ) -> Result<VaultFileInventory, VaultError> {
        let mut pending_directories = starts;
        pending_directories.reverse();
        let mut files: BTreeMap<PathBuf, u64> = BTreeMap::new();
        let mut inspected_entry_count = 0usize;
        let mut directory_component_walk_count = 0usize;
        let mut path_storage_bytes = 0usize;
        let mut observed_omitted_files = 0u64;
        let mut row_cap_reached = limits.max_file_rows == 0;
        let mut entry_cap_reached = false;
        let mut directory_component_walk_limit_reached = false;
        let mut path_storage_limit_reached = false;
        let mut traversal_truncated = false;

        'inventory: while let Some(relative_directory) = pending_directories.pop() {
            // Retain paths, not open handles, for sibling directories so a wide
            // tree does not consume one descriptor per child.
            let component_walk_cost = relative_directory.components().count();
            if directory_component_walk_count.saturating_add(component_walk_cost)
                > limits.max_component_walks
            {
                directory_component_walk_limit_reached = true;
                traversal_truncated = true;
                break 'inventory;
            }
            directory_component_walk_count += component_walk_cost;
            if component_walk_cost > 0
                && directory_component_walk_count == limits.max_component_walks
            {
                directory_component_walk_limit_reached = true;
            }
            let directory = self.open_inventory_directory_nofollow(&relative_directory)?;
            let mut entries = directory.read_dir(".")?;
            loop {
                if inspected_entry_count == limits.max_entries {
                    entry_cap_reached = true;
                    // Do not read another directory entry after the inspection cap.
                    traversal_truncated = true;
                    break 'inventory;
                }
                let Some(entry) = entries.next() else {
                    break;
                };
                let entry = entry?;
                inspected_entry_count += 1;
                let name = entry.file_name();
                let path_cost = joined_path_storage_bytes(&relative_directory, &name);
                if path_storage_bytes.saturating_add(path_cost) >= limits.max_path_bytes {
                    path_storage_limit_reached = true;
                    traversal_truncated = true;
                    break 'inventory;
                }
                path_storage_bytes = path_storage_bytes.saturating_add(path_cost);
                let relative_path = relative_directory.join(&name);
                let metadata = directory.symlink_metadata(&name)?;

                let file_type = metadata.file_type();
                if file_type.is_symlink() {
                    continue;
                }
                if file_type.is_dir() {
                    pending_directories.push(relative_path);
                    continue;
                }
                if !file_type.is_file() {
                    continue;
                }

                let size_bytes = metadata.len();
                if files.len() < limits.max_file_rows {
                    files.insert(relative_path, size_bytes);
                    if files.len() == limits.max_file_rows {
                        row_cap_reached = true;
                    }
                } else {
                    row_cap_reached = true;
                    observed_omitted_files = observed_omitted_files.saturating_add(1);
                    let replace_largest = files
                        .last_key_value()
                        .is_some_and(|(largest_path, _)| relative_path < *largest_path);
                    if replace_largest {
                        let _ = files.pop_last();
                        files.insert(relative_path, size_bytes);
                    }
                }
            }
        }

        let complete = !row_cap_reached
            && !entry_cap_reached
            && !directory_component_walk_limit_reached
            && !path_storage_limit_reached;
        Ok(VaultFileInventory {
            files: files
                .into_iter()
                .map(|(relative_path, size_bytes)| VaultFileStat {
                    relative_path,
                    size_bytes,
                })
                .collect(),
            inspected_entry_count,
            directory_component_walk_count,
            directory_component_walk_limit_reached,
            omitted_file_count: (!traversal_truncated).then_some(observed_omitted_files),
            path_storage_bytes,
            path_storage_limit_reached,
            complete,
        })
    }

    fn open_inventory_directory_nofollow(
        &self,
        relative_directory: &Path,
    ) -> Result<CapabilityDir, VaultError> {
        let mut directory = self.capability_root.try_clone()?;
        for component in relative_directory.components() {
            let name = component.as_os_str();
            let metadata = directory.symlink_metadata(name)?;
            if metadata.file_type().is_symlink() {
                return Err(VaultError::Symlink(relative_directory.to_path_buf()));
            }
            if !metadata.is_dir() {
                return Err(VaultError::NotAFile(relative_directory.to_path_buf()));
            }
            directory = directory.open_dir_nofollow(name)?;
        }
        Ok(directory)
    }
}

#[cfg(test)]
mod tests {
    use super::{InventoryLimits, VaultBoundedRead, default_limits};
    use crate::VaultRoot;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_INVENTORY_TEST_DIR_ID: AtomicU64 = AtomicU64::new(0);

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            loop {
                let id = NEXT_INVENTORY_TEST_DIR_ID.fetch_add(1, Ordering::Relaxed);
                let path = std::env::temp_dir().join(format!(
                    "openobsidian-inventory-{}-{id}",
                    std::process::id()
                ));
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

    fn paths(inventory: &super::VaultFileInventory) -> Vec<PathBuf> {
        inventory
            .files
            .iter()
            .map(|file| file.relative_path.clone())
            .collect()
    }

    #[cfg(unix)]
    #[test]
    fn inventory_is_sorted_and_skips_symlinks() {
        let temp = TempDir::new();
        let vault_path = temp.0.join("vault");
        let outside = temp.0.join("outside");
        fs::create_dir_all(vault_path.join("nested")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(vault_path.join("nested/file.bin"), b"opaque").unwrap();
        fs::write(vault_path.join("z.md"), [0, 255, 7]).unwrap();
        fs::write(outside.join("external.bin"), b"outside").unwrap();
        std::os::unix::fs::symlink(&outside, vault_path.join("linked")).unwrap();
        std::os::unix::fs::symlink(outside.join("external.bin"), vault_path.join("l.bin")).unwrap();

        let vault = VaultRoot::open(&vault_path).unwrap();
        let inventory = vault.inventory_regular_files().unwrap();
        assert_eq!(
            paths(&inventory),
            vec![PathBuf::from("nested/file.bin"), PathBuf::from("z.md")]
        );
        assert_eq!(inventory.files[0].size_bytes, 6);
        assert_eq!(inventory.files[1].size_bytes, 3);
        assert_eq!(inventory.inspected_entry_count, 5);
        assert_eq!(inventory.omitted_file_count, Some(0));
        assert!(inventory.complete);
    }

    #[test]
    fn inventory_row_entry_and_walk_caps_mark_incomplete() {
        let temp = TempDir::new();
        fs::create_dir_all(temp.0.join("nested")).unwrap();
        for name in ["a.bin", "b.bin", "c.bin", "nested/d.bin"] {
            fs::write(temp.0.join(name), name.as_bytes()).unwrap();
        }
        let vault = VaultRoot::open(&temp.0).unwrap();
        let limits = |rows: usize, entries: usize, walks: usize| InventoryLimits {
            max_file_rows: rows,
            max_entries: entries,
            max_component_walks: walks,
            ..default_limits()
        };

        let rows = vault
            .inventory_from(vec![PathBuf::new()], limits(2, 20, 100))
            .unwrap();
        assert_eq!(
            paths(&rows),
            vec![PathBuf::from("a.bin"), PathBuf::from("b.bin")]
        );
        assert_eq!(rows.omitted_file_count, Some(2));
        assert!(!rows.complete);

        let exact_rows = vault
            .inventory_from(vec![PathBuf::new()], limits(4, 20, 100))
            .unwrap();
        assert_eq!(exact_rows.files.len(), 4);
        assert_eq!(exact_rows.omitted_file_count, Some(0));
        assert!(!exact_rows.complete);

        let entries = vault
            .inventory_from(vec![PathBuf::new()], limits(10, 2, 100))
            .unwrap();
        assert_eq!(entries.inspected_entry_count, 2);
        assert_eq!(entries.omitted_file_count, None);
        assert!(!entries.complete);

        let walks = vault
            .inventory_from(vec![PathBuf::new()], limits(10, 100, 1))
            .unwrap();
        assert_eq!(walks.directory_component_walk_count, 1);
        assert!(walks.directory_component_walk_limit_reached);
        assert!(!walks.complete);

        let path_bytes = vault
            .inventory_from(
                vec![PathBuf::new()],
                InventoryLimits {
                    max_path_bytes: 4,
                    ..default_limits()
                },
            )
            .unwrap();
        assert!(path_bytes.path_storage_limit_reached);
        assert!(!path_bytes.complete);
    }

    #[test]
    fn inventory_writes_nothing() {
        let temp = TempDir::new();
        fs::create_dir_all(temp.0.join(".obsidian")).unwrap();
        fs::write(temp.0.join(".obsidian/app.json"), b"{}").unwrap();
        fs::write(temp.0.join("note.md"), b"x").unwrap();
        let vault = VaultRoot::open(&temp.0).unwrap();
        let before = vault.snapshot().unwrap().revision_sha256;
        let _ = vault.inventory_regular_files().unwrap();
        let _ = vault.inventory_configuration_files().unwrap();
        let _ = vault.discover_configuration_folders().unwrap();
        let _ = vault
            .read_configuration_file_bounded(".obsidian/app.json")
            .unwrap();
        assert_eq!(vault.snapshot().unwrap().revision_sha256, before);
    }

    #[test]
    fn bounded_read_enforces_cap_and_exact_bytes() {
        let temp = TempDir::new();
        fs::write(temp.0.join("a.bin"), [1u8, 2, 3, 4]).unwrap();
        let vault = VaultRoot::open(&temp.0).unwrap();
        assert_eq!(
            vault.read_regular_file_bounded("a.bin", 4).unwrap(),
            VaultBoundedRead::Read {
                bytes: vec![1, 2, 3, 4],
                size_bytes: 4
            }
        );
        assert_eq!(
            vault.read_regular_file_bounded("a.bin", 3).unwrap(),
            VaultBoundedRead::TooLarge { size_bytes: 4 }
        );
        assert!(vault.read_regular_file_bounded("missing.bin", 4).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn bounded_read_refuses_symlinks() {
        let temp = TempDir::new();
        let vault_path = temp.0.join("vault");
        fs::create_dir_all(&vault_path).unwrap();
        fs::write(temp.0.join("outside.bin"), b"outside").unwrap();
        std::os::unix::fs::symlink(temp.0.join("outside.bin"), vault_path.join("l.bin")).unwrap();
        let vault = VaultRoot::open(&vault_path).unwrap();
        assert!(vault.read_regular_file_bounded("l.bin", 100).is_err());
    }

    #[test]
    fn configuration_folders_and_files_are_discovered_with_exact_bytes() {
        let temp = TempDir::new();
        fs::create_dir_all(temp.0.join(".obsidian-mobile")).unwrap();
        fs::create_dir_all(temp.0.join(".obsidian/plugins/p")).unwrap();
        fs::create_dir_all(temp.0.join(".obsidianx")).unwrap();
        let bom = b"\xEF\xBB\xBF{\"a\":1}\r\n";
        fs::write(temp.0.join(".obsidian/app.json"), b"{\"a\":1,\"a\":2}").unwrap();
        fs::write(temp.0.join(".obsidian/plugins/p/data.json"), bom).unwrap();
        fs::write(temp.0.join(".obsidian/bad.json"), b"{nope").unwrap();
        fs::write(temp.0.join(".obsidian/list.json"), b"[1]").unwrap();
        fs::write(temp.0.join("outside.json"), b"{}").unwrap();
        let vault = VaultRoot::open(&temp.0).unwrap();
        assert_eq!(
            vault.discover_configuration_folders().unwrap(),
            vec![".obsidian".to_owned(), ".obsidian-mobile".to_owned()]
        );
        let inventory = vault.inventory_configuration_files().unwrap();
        assert_eq!(inventory.files.len(), 4);
        assert!(inventory.complete);

        let app = vault
            .read_configuration_file_bounded(".obsidian/app.json")
            .unwrap()
            .unwrap();
        assert_eq!(app.raw_bytes, b"{\"a\":1,\"a\":2}");
        assert!(
            vault
                .read_configuration_file_bounded(".obsidian/bad.json")
                .unwrap()
                .is_none()
        );
        assert!(
            vault
                .read_configuration_file_bounded(".obsidian/list.json")
                .unwrap()
                .is_none()
        );
        assert!(
            vault
                .read_configuration_file_bounded("outside.json")
                .unwrap()
                .is_none()
        );
        // A BOM makes the JSON invalid for serde_json, so it is skipped, not rewritten.
        assert!(
            vault
                .read_configuration_file_bounded(".obsidian/plugins/p/data.json")
                .unwrap()
                .is_none()
        );
        assert_eq!(
            fs::read(temp.0.join(".obsidian/plugins/p/data.json")).unwrap(),
            bom
        );
    }
}
