//! Portable, byte-preserving export of notes and Canvas files to a folder.
//!
//! The export needs no application database: it reads the vault through the
//! confined no-follow APIs, previews every decision before any write, and only
//! ever creates new files (it never overwrites or follows symlinks).

use super::{
    CapabilityDir, CapabilityOpenOptions, Component, FollowSymlinks, IoWrite, OpenOptionsFollowExt,
    VaultBoundedRead, VaultError, VaultRoot, normalize_relative_path,
};
use crate::trash::ensure_directory_nofollow;
use cap_fs_ext::DirExt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Default maximum number of files one export plans to write or report as colliding.
pub const MAX_VAULT_EXPORT_FILES: usize = 10_000;
/// Default maximum size of one exported file.
pub const MAX_VAULT_EXPORT_FILE_BYTES: u64 = 64 * 1024 * 1024;
/// Default maximum cumulative bytes planned by one export.
pub const MAX_VAULT_EXPORT_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
/// Default maximum skipped rows listed individually; the rest are only counted.
pub const MAX_VAULT_EXPORT_LISTED_SKIPS: usize = 1_000;

/// Caps applied to one export preview and apply.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct VaultExportLimits {
    pub max_files: usize,
    pub max_file_bytes: u64,
    pub max_total_bytes: u64,
    pub max_listed_skips: usize,
}

impl Default for VaultExportLimits {
    fn default() -> Self {
        Self {
            max_files: MAX_VAULT_EXPORT_FILES,
            max_file_bytes: MAX_VAULT_EXPORT_FILE_BYTES,
            max_total_bytes: MAX_VAULT_EXPORT_TOTAL_BYTES,
            max_listed_skips: MAX_VAULT_EXPORT_LISTED_SKIPS,
        }
    }
}

/// Why a vault file is not part of the export.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VaultExportSkipReason {
    /// Not a Markdown note or Canvas file.
    UnsupportedType,
    /// Inside a dot-folder (such as `.obsidian` or `.trash`) or a dot-file.
    Hidden,
    /// The path cannot be represented portably (non-UTF-8 or reserved name).
    InvalidPath,
    /// The file is larger than the per-file cap.
    TooLarge,
    /// The file-count cap was reached.
    OverFileLimit,
    /// The cumulative byte cap would be exceeded.
    OverByteLimit,
}

/// One file the export would write, or that already exists at the destination.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultExportEntry {
    pub relative_path: PathBuf,
    pub size_bytes: u64,
    /// True when the destination already holds an entry at this path (or a
    /// parent component blocks it); such a file is never written.
    pub collision: bool,
}

/// One vault file left out of the export.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultExportSkip {
    pub relative_path: PathBuf,
    pub size_bytes: u64,
    pub reason: VaultExportSkipReason,
}

/// What an export would do. Building it writes nothing.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultExportPreview {
    /// Canonical destination folder path.
    pub destination: PathBuf,
    pub destination_exists: bool,
    pub limits: VaultExportLimits,
    /// Planned files sorted by relative path, including collisions.
    pub entries: Vec<VaultExportEntry>,
    pub write_count: u64,
    pub write_bytes: u64,
    pub collision_count: u64,
    /// Skipped files listed individually (at most `limits.max_listed_skips`).
    pub skipped: Vec<VaultExportSkip>,
    /// All skipped files, listed or not.
    pub skipped_total: u64,
    /// Skipped files counted but not listed because of the listing cap.
    pub skipped_unlisted: u64,
    /// False when the vault inventory hit a cap, so the vault may hold more
    /// files than were considered.
    pub inventory_complete: bool,
    /// Files the inventory dropped, when known.
    pub inventory_omitted_file_count: Option<u64>,
}

/// A planned file that could not be written.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultExportFailure {
    pub relative_path: PathBuf,
    pub reason: String,
}

/// Outcome of applying an export.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultExportResult {
    /// The plan that was applied (recomputed immediately before writing).
    pub preview: VaultExportPreview,
    pub written: Vec<PathBuf>,
    pub written_bytes: u64,
    pub failed: Vec<VaultExportFailure>,
}

struct ExportTarget {
    path: PathBuf,
    exists: bool,
}

impl VaultExportPreview {
    fn record_skip(
        &mut self,
        relative_path: PathBuf,
        size_bytes: u64,
        reason: VaultExportSkipReason,
    ) {
        self.skipped_total = self.skipped_total.saturating_add(1);
        if self.skipped.len() < self.limits.max_listed_skips {
            self.skipped.push(VaultExportSkip {
                relative_path,
                size_bytes,
                reason,
            });
        } else {
            self.skipped_unlisted = self.skipped_unlisted.saturating_add(1);
        }
    }
}

fn export_skip_reason(path: &Path) -> Option<VaultExportSkipReason> {
    if normalize_relative_path(path).is_err() {
        return Some(VaultExportSkipReason::InvalidPath);
    }
    let hidden = path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .is_some_and(|name| name.starts_with('.'))
    });
    if hidden {
        return Some(VaultExportSkipReason::Hidden);
    }
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);
    if matches!(extension.as_deref(), Some("md" | "canvas")) {
        None
    } else {
        Some(VaultExportSkipReason::UnsupportedType)
    }
}

/// True when anything (file, directory or symlink) occupies `relative_path`
/// in the destination, or a parent component blocks creating it.
fn destination_occupied(
    destination: &CapabilityDir,
    relative_path: &Path,
) -> Result<bool, VaultError> {
    let mut current = destination.try_clone()?;
    let components = relative_path.components().collect::<Vec<_>>();
    let last = components.len().saturating_sub(1);
    for (index, component) in components.iter().enumerate() {
        let name = component.as_os_str();
        let metadata = match current.symlink_metadata(name) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error.into()),
        };
        if index == last || !metadata.is_dir() {
            return Ok(true);
        }
        current = current.open_dir_nofollow(name)?;
    }
    Ok(false)
}

impl VaultRoot {
    /// Plans an export of Markdown notes and Canvas files to `destination`
    /// without writing anything (the destination is not even created).
    ///
    /// Paths are preserved relative to the vault. Hidden folders, other file
    /// types and over-cap files are reported as skipped; existing destination
    /// entries are reported as collisions. Symlinks are never followed and
    /// are not part of the vault inventory, so they are not listed.
    pub fn preview_export(
        &self,
        destination: impl AsRef<Path>,
        limits: &VaultExportLimits,
    ) -> Result<VaultExportPreview, VaultError> {
        let target = self.resolve_export_destination(destination.as_ref())?;
        if target.exists {
            let directory =
                CapabilityDir::open_ambient_dir(&target.path, cap_std::ambient_authority())?;
            self.plan_export(&target, Some(&directory), limits)
        } else {
            self.plan_export(&target, None, limits)
        }
    }

    /// Exports Markdown notes and Canvas files byte for byte to `destination`,
    /// creating the destination folder (one level) if needed. Existing
    /// destination entries are never overwritten and are reported as
    /// collisions; per-file failures are reported and do not stop the export.
    pub fn export_notes_and_canvas(
        &self,
        destination: impl AsRef<Path>,
        limits: &VaultExportLimits,
    ) -> Result<VaultExportResult, VaultError> {
        let target = self.resolve_export_destination(destination.as_ref())?;
        if !target.exists {
            match fs::create_dir(&target.path) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error.into()),
            }
        }
        let directory =
            CapabilityDir::open_ambient_dir(&target.path, cap_std::ambient_authority())?;
        let preview = self.plan_export(&target, Some(&directory), limits)?;
        let mut written = Vec::new();
        let mut written_bytes = 0u64;
        let mut failed = Vec::new();
        for entry in &preview.entries {
            if entry.collision {
                continue;
            }
            match self.export_one_file(&directory, &entry.relative_path, limits.max_file_bytes) {
                Ok(length) => {
                    written.push(entry.relative_path.clone());
                    written_bytes = written_bytes.saturating_add(length);
                }
                Err(error) => failed.push(VaultExportFailure {
                    relative_path: entry.relative_path.clone(),
                    reason: error.to_string(),
                }),
            }
        }
        Ok(VaultExportResult {
            preview,
            written,
            written_bytes,
            failed,
        })
    }

    fn resolve_export_destination(&self, destination: &Path) -> Result<ExportTarget, VaultError> {
        let target = match fs::symlink_metadata(destination) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(VaultError::Symlink(destination.to_path_buf()));
            }
            Ok(metadata) if !metadata.is_dir() => {
                return Err(VaultError::NotAFile(destination.to_path_buf()));
            }
            Ok(_) => ExportTarget {
                path: fs::canonicalize(destination)?,
                exists: true,
            },
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                let name = destination.file_name().ok_or(VaultError::InvalidPath)?;
                let parent = match destination.parent() {
                    Some(parent) if !parent.as_os_str().is_empty() => parent,
                    _ => Path::new("."),
                };
                ExportTarget {
                    path: fs::canonicalize(parent)?.join(name),
                    exists: false,
                }
            }
            Err(error) => return Err(error.into()),
        };
        if target.path.starts_with(&self.canonical_root)
            || self.canonical_root.starts_with(&target.path)
        {
            return Err(VaultError::InvalidDataDirectory(target.path));
        }
        Ok(target)
    }

    fn plan_export(
        &self,
        target: &ExportTarget,
        destination: Option<&CapabilityDir>,
        limits: &VaultExportLimits,
    ) -> Result<VaultExportPreview, VaultError> {
        let inventory = self.inventory_regular_files()?;
        let mut preview = VaultExportPreview {
            destination: target.path.clone(),
            destination_exists: target.exists,
            limits: *limits,
            entries: Vec::new(),
            write_count: 0,
            write_bytes: 0,
            collision_count: 0,
            skipped: Vec::new(),
            skipped_total: 0,
            skipped_unlisted: 0,
            inventory_complete: inventory.complete,
            inventory_omitted_file_count: inventory.omitted_file_count,
        };
        let mut planned_bytes = 0u64;
        for file in inventory.files {
            let path = file.relative_path;
            let size = file.size_bytes;
            if let Some(reason) = export_skip_reason(&path) {
                preview.record_skip(path, size, reason);
                continue;
            }
            if size > limits.max_file_bytes {
                preview.record_skip(path, size, VaultExportSkipReason::TooLarge);
                continue;
            }
            if preview.entries.len() >= limits.max_files {
                preview.record_skip(path, size, VaultExportSkipReason::OverFileLimit);
                continue;
            }
            if planned_bytes.saturating_add(size) > limits.max_total_bytes {
                preview.record_skip(path, size, VaultExportSkipReason::OverByteLimit);
                continue;
            }
            let collision = match destination {
                Some(directory) => destination_occupied(directory, &path)?,
                None => false,
            };
            planned_bytes = planned_bytes.saturating_add(size);
            if collision {
                preview.collision_count = preview.collision_count.saturating_add(1);
            } else {
                preview.write_count = preview.write_count.saturating_add(1);
                preview.write_bytes = preview.write_bytes.saturating_add(size);
            }
            preview.entries.push(VaultExportEntry {
                relative_path: path,
                size_bytes: size,
                collision,
            });
        }
        Ok(preview)
    }

    fn export_one_file(
        &self,
        destination: &CapabilityDir,
        relative_path: &Path,
        max_bytes: u64,
    ) -> Result<u64, VaultError> {
        let bytes = match self.read_regular_file_bounded(relative_path, max_bytes)? {
            VaultBoundedRead::Read { bytes, .. } => bytes,
            VaultBoundedRead::TooLarge { size_bytes } => {
                return Err(VaultError::Root(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("file is now {size_bytes} bytes, above the export limit"),
                )));
            }
        };
        let components = relative_path.components().collect::<Vec<Component<'_>>>();
        let name = relative_path.file_name().ok_or(VaultError::InvalidPath)?;
        let parent_count = components.len().saturating_sub(1);
        let parent =
            ensure_directory_nofollow(destination, &components[..parent_count], relative_path)?;
        let mut options = CapabilityOpenOptions::new();
        options
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        let mut file = parent.open_with(name, &options)?;
        let written = file.write_all(&bytes);
        let finished = written.and_then(|()| file.sync_all());
        drop(file);
        if let Err(source) = finished {
            let _ = parent.remove_file(name);
            return Err(VaultError::WriteFailed {
                relative_path: relative_path.to_path_buf(),
                source,
            });
        }
        Ok(bytes.len() as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::{VaultExportLimits, VaultExportSkipReason};
    use crate::VaultRoot;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_EXPORT_TEST_DIR_ID: AtomicU64 = AtomicU64::new(0);

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            loop {
                let id = NEXT_EXPORT_TEST_DIR_ID.fetch_add(1, Ordering::Relaxed);
                let path = std::env::temp_dir()
                    .join(format!("openobsidian-export-{}-{id}", std::process::id()));
                match fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("creating test dir {}: {error}", path.display()),
                }
            }
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const NOTE_BYTES: &[u8] = b"---\r\ntags: [a]\r\n---\r\n# Title\r\n[[Other]] \xff\xfe trailing";
    const CANVAS_BYTES: &[u8] = b"{\n  \"nodes\": [],\n\t\"edges\": []\n}";

    fn build_vault(vault: &Path) {
        fs::create_dir_all(vault.join("Folder/Deep")).unwrap();
        fs::create_dir_all(vault.join(".obsidian")).unwrap();
        fs::write(vault.join("Note.md"), NOTE_BYTES).unwrap();
        fs::write(vault.join("Folder/Deep/Board.canvas"), CANVAS_BYTES).unwrap();
        fs::write(vault.join("Folder/Inner.md"), b"inner").unwrap();
        fs::write(vault.join("image.png"), b"png").unwrap();
        fs::write(vault.join(".obsidian/app.json"), b"{}").unwrap();
        fs::write(vault.join(".obsidian/hidden.md"), b"cfg").unwrap();
    }

    fn setup() -> (TempDir, PathBuf, VaultRoot, PathBuf) {
        let temp = TempDir::new();
        let vault = temp.path().join("vault");
        fs::create_dir(&vault).unwrap();
        build_vault(&vault);
        let root = VaultRoot::open(&vault).unwrap();
        let destination = temp.path().join("export");
        (temp, vault, root, destination)
    }

    #[test]
    fn preview_reports_plan_and_writes_nothing() {
        let (_temp, _vault, root, destination) = setup();
        let preview = root
            .preview_export(&destination, &VaultExportLimits::default())
            .unwrap();
        assert!(!destination.exists());
        assert!(!preview.destination_exists);
        assert_eq!(preview.write_count, 3);
        assert_eq!(preview.collision_count, 0);
        assert_eq!(
            preview.write_bytes,
            (NOTE_BYTES.len() + CANVAS_BYTES.len() + 5) as u64
        );
        let paths = preview
            .entries
            .iter()
            .map(|entry| entry.relative_path.clone())
            .collect::<Vec<_>>();
        assert_eq!(
            paths,
            vec![
                PathBuf::from("Folder/Deep/Board.canvas"),
                PathBuf::from("Folder/Inner.md"),
                PathBuf::from("Note.md"),
            ]
        );
        assert_eq!(preview.skipped_total, 3);
        assert!(preview.skipped.iter().any(|skip| {
            skip.relative_path == Path::new("image.png")
                && skip.reason == VaultExportSkipReason::UnsupportedType
        }));
        let hidden = preview
            .skipped
            .iter()
            .filter(|skip| skip.reason == VaultExportSkipReason::Hidden)
            .count();
        assert_eq!(hidden, 2);
        assert!(preview.inventory_complete);
    }

    #[test]
    fn export_round_trips_bytes_exactly() {
        let (temp, vault, root, destination) = setup();
        let result = root
            .export_notes_and_canvas(&destination, &VaultExportLimits::default())
            .unwrap();
        assert!(result.failed.is_empty());
        assert_eq!(result.written.len(), 3);
        for relative in ["Note.md", "Folder/Inner.md", "Folder/Deep/Board.canvas"] {
            assert_eq!(
                fs::read(vault.join(relative)).unwrap(),
                fs::read(destination.join(relative)).unwrap(),
                "{relative}"
            );
        }
        assert!(!destination.join("image.png").exists());
        assert!(!destination.join(".obsidian").exists());
        // The exported folder is itself a vault that exports identically.
        let second = VaultRoot::open(&destination).unwrap();
        let again = temp.path().join("export2");
        let result = second
            .export_notes_and_canvas(&again, &VaultExportLimits::default())
            .unwrap();
        assert_eq!(result.written.len(), 3);
        assert_eq!(fs::read(again.join("Note.md")).unwrap(), NOTE_BYTES);
        assert_eq!(
            fs::read(again.join("Folder/Deep/Board.canvas")).unwrap(),
            CANVAS_BYTES
        );
    }

    #[test]
    fn export_never_overwrites_existing_destination_files() {
        let (_temp, _vault, root, destination) = setup();
        fs::create_dir_all(&destination).unwrap();
        fs::write(destination.join("Note.md"), b"keep me").unwrap();
        let preview = root
            .preview_export(&destination, &VaultExportLimits::default())
            .unwrap();
        assert_eq!(preview.collision_count, 1);
        assert_eq!(preview.write_count, 2);
        let result = root
            .export_notes_and_canvas(&destination, &VaultExportLimits::default())
            .unwrap();
        assert_eq!(result.written.len(), 2);
        assert_eq!(fs::read(destination.join("Note.md")).unwrap(), b"keep me");
        let again = root
            .export_notes_and_canvas(&destination, &VaultExportLimits::default())
            .unwrap();
        assert!(again.written.is_empty());
        assert_eq!(again.preview.collision_count, 3);
    }

    #[test]
    fn caps_are_reported_as_skips() {
        let (_temp, _vault, root, destination) = setup();
        let limits = VaultExportLimits {
            max_files: 1,
            max_file_bytes: 100,
            max_total_bytes: 1_000,
            max_listed_skips: 1,
        };
        let preview = root.preview_export(&destination, &limits).unwrap();
        assert_eq!(preview.entries.len(), 1);
        // The image, two hidden files and two over-count files are skipped.
        assert_eq!(preview.skipped_total, 5);
        assert_eq!(preview.skipped.len(), 1);
        assert_eq!(preview.skipped_unlisted, 4);
        let tiny = VaultExportLimits {
            max_files: 10,
            max_file_bytes: 10,
            max_total_bytes: 1_000,
            max_listed_skips: 100,
        };
        let preview = root.preview_export(&destination, &tiny).unwrap();
        assert!(
            preview
                .skipped
                .iter()
                .any(|skip| skip.reason == VaultExportSkipReason::TooLarge)
        );
        let budget = VaultExportLimits {
            max_files: 10,
            max_file_bytes: 1_000,
            max_total_bytes: 10,
            max_listed_skips: 100,
        };
        let preview = root.preview_export(&destination, &budget).unwrap();
        assert!(
            preview
                .skipped
                .iter()
                .any(|skip| skip.reason == VaultExportSkipReason::OverByteLimit)
        );
    }

    #[test]
    fn destination_overlapping_the_vault_is_refused() {
        let (_temp, vault, root, _destination) = setup();
        let limits = VaultExportLimits::default();
        assert!(root.preview_export(vault.join("inside"), &limits).is_err());
        assert!(root.preview_export(&vault, &limits).is_err());
        assert!(
            root.export_notes_and_canvas(vault.join("Folder"), &limits)
                .is_err()
        );
        assert!(!vault.join("inside").exists());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_not_followed_in_source_or_destination() {
        let (temp, vault, root, destination) = setup();
        let outside = temp.path().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("Secret.md"), b"secret").unwrap();
        std::os::unix::fs::symlink(&outside, vault.join("Linked")).unwrap();
        std::os::unix::fs::symlink(outside.join("Secret.md"), vault.join("Link.md")).unwrap();
        let result = root
            .export_notes_and_canvas(&destination, &VaultExportLimits::default())
            .unwrap();
        assert_eq!(result.written.len(), 3);
        assert!(!destination.join("Linked").exists());
        assert!(!destination.join("Link.md").exists());

        // A destination symlink is refused, and a symlinked folder inside it
        // blocks writes beneath it.
        let limits = VaultExportLimits::default();
        let link_destination = temp.path().join("dest-link");
        std::os::unix::fs::symlink(&outside, &link_destination).unwrap();
        assert!(root.preview_export(&link_destination, &limits).is_err());
        let guarded = temp.path().join("guarded");
        fs::create_dir(&guarded).unwrap();
        std::os::unix::fs::symlink(&outside, guarded.join("Folder")).unwrap();
        let result = root.export_notes_and_canvas(&guarded, &limits).unwrap();
        assert!(!outside.join("Inner.md").exists());
        assert!(!outside.join("Deep").exists());
        assert_eq!(result.preview.collision_count, 2);
        assert_eq!(result.written.len(), 1);
    }
}
