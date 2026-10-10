//! Source-preserving vault reads and revision-bound rename previews.

use image::{ImageFormat, ImageReader, Limits as ImageLimits};
pub use openobsidian_doc::{
    LinkKind, LinkReference, LinkRenameAction, LinkResolution, LinkResolutionStatus,
    LinkSubpathSlice, LinkSubpathStatus, TransclusionBlockReason, TransclusionGuard,
};
use openobsidian_doc::{
    LinkRenamePlan, LinkRenamePlanError, MAX_NOTE_TRANSCLUSION_SOURCE_BYTES, MarkdownSource,
    RawDocument, RenamePlanFile, build_link_rename_plan, guard_note_transclusion, resolve_link,
    resolve_link_with_sources, resolve_link_with_subpath_statuses, slice_markdown_subpath,
};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fmt::Write as _;
use std::fs::{self, OpenOptions};
use std::io::{self, Cursor, Read as IoRead, Write as IoWrite};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

/// Maximum source bytes returned by a read-only note preview.
pub const MAX_NOTE_SOURCE_PREVIEW_BYTES: usize = 16 * 1024;

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
    #[error("vault changed while link resolutions were being prepared")]
    LinkResolutionSnapshotChanged,
    #[error("note transclusion source exceeds the 512 KiB limit: {0}")]
    TransclusionSourceTooLarge(PathBuf),
    #[error("link reference is not an embed")]
    NotEmbedReference,
    #[error("vault path is not a Markdown note: {0}")]
    NotMarkdownNote(PathBuf),
    #[error("Markdown note is not valid UTF-8: {0}")]
    InvalidMarkdownNote(PathBuf),
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

/// A bounded prefix of a note source for read-only inspection.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultReadPreview {
    pub source: RawDocument,
    pub total_size_bytes: u64,
    pub truncated: bool,
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

/// A source reference and its read-only resolution against one stable vault snapshot.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultLinkResolution {
    pub reference: LinkReference,
    pub resolution: LinkResolution,
}

/// A raster attachment decoded through bounded reads from a stable vault snapshot.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultInlineImage {
    pub revision_sha256: String,
    pub width: u32,
    pub height: u32,
    pub rgba_bytes: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VaultNoteEmbedDisposition {
    NotRendered,
    Blocked(TransclusionBlockReason),
    Included(TransclusionGuard),
    Attachment(VaultInlineImage),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultNoteEmbedResolution {
    pub reference: LinkReference,
    pub resolution: LinkResolution,
    pub slice: Option<LinkSubpathSlice>,
    pub disposition: VaultNoteEmbedDisposition,
    pub snapshot_sha256: String,
}

/// A resolved note embed and any nested note embeds found in its selected source.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultNoteEmbedNode {
    pub resolution: VaultNoteEmbedResolution,
    pub children: Vec<Self>,
    pub omitted_children: bool,
}

/// Snapshot-bound transclusions discovered in one Markdown note.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultNoteEmbedReport {
    pub embeds: Vec<VaultNoteEmbedNode>,
    pub truncated: bool,
    pub snapshot_sha256: String,
}

const MAX_NOTE_TRANSCLUSION_TREE_NODES: usize = 32;
const MAX_INLINE_IMAGE_SOURCE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_INLINE_IMAGE_DIMENSION: u32 = 4096;
const MAX_INLINE_IMAGE_PIXELS: u64 = 4_194_304;
const MAX_INLINE_IMAGE_DECODER_ALLOCATION: u64 = 64 * 1024 * 1024;
const MAX_REPORT_INLINE_IMAGES: usize = 8;
const MAX_REPORT_INLINE_IMAGE_SOURCE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_REPORT_INLINE_IMAGE_PIXELS: u64 = 8_388_608;

#[derive(Clone, Copy, Debug)]
struct InlineImageBudget {
    remaining_images: usize,
    remaining_source_bytes: u64,
    remaining_pixels: u64,
}

struct NoteEmbedTreeBudget<'a> {
    expected_snapshot: &'a str,
    remaining_nodes: usize,
    image_budget: InlineImageBudget,
}

impl InlineImageBudget {
    fn single() -> Self {
        Self {
            remaining_images: 1,
            remaining_source_bytes: MAX_INLINE_IMAGE_SOURCE_BYTES,
            remaining_pixels: MAX_INLINE_IMAGE_PIXELS,
        }
    }

    fn for_report() -> Self {
        Self {
            remaining_images: MAX_REPORT_INLINE_IMAGES,
            remaining_source_bytes: MAX_REPORT_INLINE_IMAGE_SOURCE_BYTES,
            remaining_pixels: MAX_REPORT_INLINE_IMAGE_PIXELS,
        }
    }
}

fn inline_image_format(path: &Path) -> Option<ImageFormat> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "bmp" => Some(ImageFormat::Bmp),
        "gif" => Some(ImageFormat::Gif),
        "ico" => Some(ImageFormat::Ico),
        "jpg" | "jpeg" => Some(ImageFormat::Jpeg),
        "png" => Some(ImageFormat::Png),
        "webp" => Some(ImageFormat::WebP),
        _ => None,
    }
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
mod watcher;
pub use history::{
    VaultConflictAction, VaultConflictRead, VaultConflictResolution, VaultHistoryCleanup,
    VaultHistoryKind, VaultHistoryPlan, VaultHistoryPolicy, VaultHistoryRecord,
    plan_history_retention,
};
pub use rename_transaction::{
    VaultRenameRecoveryIssue, VaultRenameRecoveryReport, VaultRenameResult,
};
pub use watcher::{VaultWatchError, VaultWatchHint, VaultWatcher};

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

    /// Returns the canonical path of the opened vault root.
    pub fn path(&self) -> &Path {
        &self.canonical_root
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

    /// Reads a bounded source prefix without normalizing or writing the note.
    pub fn read_preview(
        &self,
        relative_path: impl AsRef<Path>,
    ) -> Result<VaultReadPreview, VaultError> {
        let canonical = self.resolve_vault_path(relative_path.as_ref(), false)?;
        let mut file = fs::File::open(canonical)?;
        let before = file.metadata()?;
        let total_size_bytes = before.len();
        let read_limit = total_size_bytes.min(MAX_NOTE_SOURCE_PREVIEW_BYTES as u64);
        let mut bytes = Vec::with_capacity(read_limit as usize);
        IoRead::by_ref(&mut file)
            .take(read_limit)
            .read_to_end(&mut bytes)?;
        let after = file.metadata()?;
        if bytes.len() as u64 != read_limit
            || before.len() != after.len()
            || before.modified().ok() != after.modified().ok()
        {
            return Err(VaultError::SnapshotChanged);
        }
        Ok(VaultReadPreview {
            source: RawDocument::from_bytes(bytes),
            total_size_bytes,
            truncated: total_size_bytes > MAX_NOTE_SOURCE_PREVIEW_BYTES as u64,
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

    /// Extract and resolve links from one note against a stable, vault-confined snapshot.
    ///
    /// Regular files, including non-Markdown embeds, participate in file resolution.
    /// Markdown source is read without changing bytes; symlinks are not followed or
    /// treated as candidate targets. A concurrent vault change fails closed.
    pub fn resolve_links_for_note(
        &self,
        relative_path: impl AsRef<Path>,
    ) -> Result<Vec<VaultLinkResolution>, VaultError> {
        let relative_path = normalize_relative_path(relative_path.as_ref())?;
        if !relative_path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            return Err(VaultError::NotMarkdownNote(relative_path));
        }

        let before = self.snapshot()?;
        if !before.entries.iter().any(|entry| {
            entry.relative_path == relative_path && entry.kind == VaultSnapshotEntryKind::File
        }) {
            return Err(VaultError::NotAFile(relative_path));
        }

        let relative_path_text = path_to_slashes(&relative_path)?;
        let markdown_sources = self.read_markdown_sources(&before)?;
        let sources: HashMap<String, MarkdownSource> = markdown_sources.into_iter().collect();
        let current_source = sources
            .get(&relative_path_text)
            .ok_or_else(|| VaultError::InvalidMarkdownNote(relative_path.clone()))?;
        let files = before
            .entries
            .iter()
            .filter(|entry| entry.kind == VaultSnapshotEntryKind::File)
            .filter_map(|entry| path_to_slashes(&entry.relative_path).ok())
            .collect::<Vec<_>>();

        let after = self.snapshot()?;
        if before.revision_sha256 != after.revision_sha256 {
            return Err(VaultError::LinkResolutionSnapshotChanged);
        }

        Ok(current_source
            .extract_links()
            .into_iter()
            .map(|reference| {
                let resolution =
                    resolve_link_with_sources(&reference, &files, &relative_path_text, &sources);
                VaultLinkResolution {
                    reference,
                    resolution,
                }
            })
            .collect())
    }

    /// Resolve one Markdown note embed against a stable snapshot, reading only
    /// bounded Markdown sources that can become the rendered target.
    pub fn resolve_note_embed(
        &self,
        current_path: impl AsRef<Path>,
        reference: &LinkReference,
        depth: usize,
        chain: &[String],
    ) -> Result<VaultNoteEmbedResolution, VaultError> {
        self.resolve_note_embed_with_budget(
            current_path.as_ref(),
            reference,
            depth,
            chain,
            &mut InlineImageBudget::single(),
        )
    }

    fn resolve_note_embed_with_budget(
        &self,
        current_path: &Path,
        reference: &LinkReference,
        depth: usize,
        chain: &[String],
        image_budget: &mut InlineImageBudget,
    ) -> Result<VaultNoteEmbedResolution, VaultError> {
        if reference.kind != LinkKind::Embed {
            return Err(VaultError::NotEmbedReference);
        }

        let current_path = normalize_relative_path(current_path)?;
        if !current_path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            return Err(VaultError::NotMarkdownNote(current_path));
        }

        let before = self.snapshot()?;
        if !before.entries.iter().any(|entry| {
            entry.relative_path == current_path && entry.kind == VaultSnapshotEntryKind::File
        }) {
            return Err(VaultError::NotAFile(current_path));
        }

        let current_path_text = path_to_slashes(&current_path)?;
        let markdown_entries = before
            .entries
            .iter()
            .filter(|entry| {
                entry.kind == VaultSnapshotEntryKind::File
                    && entry
                        .relative_path
                        .extension()
                        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
            })
            .collect::<Vec<_>>();
        let files = markdown_entries
            .iter()
            .map(|entry| path_to_slashes(&entry.relative_path))
            .collect::<Result<Vec<_>, _>>()?;

        // A present but empty fragment has the same whole-note behavior as no
        // fragment in the renderer's embed path.
        let mut effective_reference = reference.clone();
        if effective_reference
            .subpath
            .as_deref()
            .is_some_and(|subpath| subpath.trim().is_empty())
        {
            effective_reference.subpath = None;
        }

        let path_resolution = resolve_link(&effective_reference, &files, &current_path_text);
        if path_resolution.status == LinkResolutionStatus::Unresolved {
            let all_file_paths = before
                .entries
                .iter()
                .filter(|entry| entry.kind == VaultSnapshotEntryKind::File)
                .filter_map(|entry| {
                    path_to_slashes(&entry.relative_path)
                        .ok()
                        .map(|path| (entry, path))
                })
                .collect::<Vec<_>>();
            let all_files = all_file_paths
                .iter()
                .map(|(_, path)| path.clone())
                .collect::<Vec<_>>();
            let attachment_resolution =
                resolve_link(&effective_reference, &all_files, &current_path_text);
            if attachment_resolution.status != LinkResolutionStatus::Unresolved {
                let image = if attachment_resolution.status == LinkResolutionStatus::Resolved
                    && effective_reference.subpath.is_none()
                {
                    let target = attachment_resolution
                        .target
                        .as_deref()
                        .expect("resolved link has target");
                    let entry = all_file_paths
                        .iter()
                        .find(|(_, path)| path.as_str() == target)
                        .map(|(entry, _)| *entry)
                        .ok_or(VaultError::SnapshotChanged)?;
                    if let Some(format) = inline_image_format(&entry.relative_path) {
                        self.decode_inline_image(entry, format, image_budget)?
                    } else {
                        None
                    }
                } else {
                    None
                };
                let disposition = image
                    .map(VaultNoteEmbedDisposition::Attachment)
                    .unwrap_or(VaultNoteEmbedDisposition::NotRendered);
                return self.finish_note_embed(
                    &before,
                    reference,
                    attachment_resolution,
                    None,
                    disposition,
                );
            }
        }
        let (resolution, slice, disposition) = match path_resolution.status {
            LinkResolutionStatus::External | LinkResolutionStatus::Unresolved => (
                path_resolution,
                None,
                VaultNoteEmbedDisposition::NotRendered,
            ),
            LinkResolutionStatus::Ambiguous if effective_reference.subpath.is_none() => (
                path_resolution,
                None,
                VaultNoteEmbedDisposition::NotRendered,
            ),
            LinkResolutionStatus::Ambiguous => {
                // Depth is independent of the eventual duplicate-basename
                // choice, so reject before inspecting any candidate source.
                if let Some(candidate) = path_resolution.candidates.first()
                    && let Err(TransclusionBlockReason::Depth) =
                        guard_note_transclusion(depth, chain, candidate)
                {
                    return self.finish_note_embed(
                        &before,
                        reference,
                        path_resolution.clone(),
                        None,
                        VaultNoteEmbedDisposition::Blocked(TransclusionBlockReason::Depth),
                    );
                }

                let mut statuses = HashMap::new();
                let mut selected_slice = None;
                let mut selected_path = None;
                for candidate in &path_resolution.candidates {
                    match guard_note_transclusion(depth, chain, candidate) {
                        Err(TransclusionBlockReason::Depth) => {
                            return self.finish_note_embed(
                                &before,
                                reference,
                                path_resolution.clone(),
                                None,
                                VaultNoteEmbedDisposition::Blocked(TransclusionBlockReason::Depth),
                            );
                        }
                        Err(TransclusionBlockReason::Cycle) => {
                            statuses.insert(candidate.clone(), LinkSubpathStatus::Unresolved);
                            continue;
                        }
                        Ok(_) => {}
                    }

                    let Some(entry) = markdown_entries.iter().find(|entry| {
                        path_to_slashes(&entry.relative_path).ok().as_deref()
                            == Some(candidate.as_str())
                    }) else {
                        statuses.insert(candidate.clone(), LinkSubpathStatus::Unresolved);
                        continue;
                    };
                    let bytes = self.read_transclusion_source(entry)?;
                    let Ok(source) = MarkdownSource::parse(bytes) else {
                        statuses.insert(candidate.clone(), LinkSubpathStatus::Unresolved);
                        continue;
                    };
                    let candidate_slice = slice_markdown_subpath(
                        &source,
                        effective_reference.subpath.as_deref().unwrap_or_default(),
                    );
                    statuses.insert(candidate.clone(), candidate_slice.status);
                    if candidate_slice.status == LinkSubpathStatus::Resolved
                        && selected_slice.is_none()
                    {
                        selected_path = Some(candidate.clone());
                        selected_slice = Some(candidate_slice);
                    }
                }

                let resolution = resolve_link_with_subpath_statuses(
                    &effective_reference,
                    &files,
                    &current_path_text,
                    &statuses,
                );
                if resolution.status != LinkResolutionStatus::Resolved
                    || resolution.target.as_deref() != selected_path.as_deref()
                {
                    (resolution, None, VaultNoteEmbedDisposition::NotRendered)
                } else {
                    let target = resolution
                        .target
                        .as_deref()
                        .expect("resolved link has target");
                    match guard_note_transclusion(depth, chain, target) {
                        Ok(guard) => (
                            resolution,
                            selected_slice,
                            VaultNoteEmbedDisposition::Included(guard),
                        ),
                        Err(reason) => {
                            (resolution, None, VaultNoteEmbedDisposition::Blocked(reason))
                        }
                    }
                }
            }
            LinkResolutionStatus::Resolved => {
                let target = path_resolution
                    .target
                    .as_deref()
                    .expect("resolved link has target");
                match guard_note_transclusion(depth, chain, target) {
                    Err(reason) => (
                        path_resolution,
                        None,
                        VaultNoteEmbedDisposition::Blocked(reason),
                    ),
                    Ok(guard) => {
                        let entry = markdown_entries
                            .iter()
                            .find(|entry| {
                                path_to_slashes(&entry.relative_path).ok().as_deref()
                                    == Some(target)
                            })
                            .ok_or(VaultError::SnapshotChanged)?;
                        let bytes = self.read_transclusion_source(entry)?;
                        let source = MarkdownSource::parse(bytes).map_err(|_| {
                            VaultError::InvalidMarkdownNote(entry.relative_path.clone())
                        })?;
                        let selected = slice_markdown_subpath(
                            &source,
                            effective_reference.subpath.as_deref().unwrap_or_default(),
                        );
                        let resolution = if effective_reference.subpath.is_some() {
                            resolve_link_with_subpath_statuses(
                                &effective_reference,
                                &files,
                                &current_path_text,
                                &HashMap::from([(target.to_owned(), selected.status)]),
                            )
                        } else {
                            path_resolution
                        };
                        if resolution.status == LinkResolutionStatus::Resolved
                            && selected.status == LinkSubpathStatus::Resolved
                        {
                            (
                                resolution,
                                Some(selected),
                                VaultNoteEmbedDisposition::Included(guard),
                            )
                        } else {
                            (
                                resolution,
                                Some(selected),
                                VaultNoteEmbedDisposition::NotRendered,
                            )
                        }
                    }
                }
            }
        };

        self.finish_note_embed(&before, reference, resolution, slice, disposition)
    }

    /// Resolve and expand bounded note embeds from one Markdown note.
    ///
    /// Every node must match the same vault snapshot. Expansion stops at the
    /// shared depth/cycle guards or after a bounded number of nodes.
    pub fn resolve_note_embeds_for_note(
        &self,
        current_path: impl AsRef<Path>,
    ) -> Result<VaultNoteEmbedReport, VaultError> {
        let current_path = normalize_relative_path(current_path.as_ref())?;
        if !current_path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            return Err(VaultError::NotMarkdownNote(current_path));
        }

        let before = self.snapshot()?;
        let current_entry = before
            .entries
            .iter()
            .find(|entry| {
                entry.relative_path == current_path && entry.kind == VaultSnapshotEntryKind::File
            })
            .ok_or_else(|| VaultError::NotAFile(current_path.clone()))?;
        let current_source = MarkdownSource::parse(self.read_transclusion_source(current_entry)?)
            .map_err(|_| VaultError::InvalidMarkdownNote(current_path.clone()))?;
        let current_path_text = path_to_slashes(&current_path)?;
        let chain = vec![current_path_text];
        let references = current_source
            .extract_links()
            .into_iter()
            .filter(|reference| reference.kind == LinkKind::Embed)
            .collect::<Vec<_>>();

        let mut tree_budget = NoteEmbedTreeBudget {
            expected_snapshot: &before.revision_sha256,
            remaining_nodes: MAX_NOTE_TRANSCLUSION_TREE_NODES,
            image_budget: InlineImageBudget::for_report(),
        };
        let mut embeds = Vec::new();
        let mut truncated = false;
        for reference in references {
            if tree_budget.remaining_nodes == 0 {
                truncated = true;
                break;
            }
            embeds.push(self.resolve_note_embed_tree(
                &current_path,
                &reference,
                0,
                &chain,
                &mut tree_budget,
            )?);
        }

        let after = self.snapshot()?;
        if before.revision_sha256 != after.revision_sha256 {
            return Err(VaultError::LinkResolutionSnapshotChanged);
        }
        Ok(VaultNoteEmbedReport {
            embeds,
            truncated,
            snapshot_sha256: before.revision_sha256,
        })
    }

    fn resolve_note_embed_tree(
        &self,
        current_path: &Path,
        reference: &LinkReference,
        depth: usize,
        chain: &[String],
        tree_budget: &mut NoteEmbedTreeBudget<'_>,
    ) -> Result<VaultNoteEmbedNode, VaultError> {
        debug_assert!(tree_budget.remaining_nodes > 0);
        tree_budget.remaining_nodes -= 1;
        let resolution = self.resolve_note_embed_with_budget(
            current_path,
            reference,
            depth,
            chain,
            &mut tree_budget.image_budget,
        )?;
        if resolution.snapshot_sha256 != tree_budget.expected_snapshot {
            return Err(VaultError::LinkResolutionSnapshotChanged);
        }

        let mut children = Vec::new();
        let mut omitted_children = false;
        if let (VaultNoteEmbedDisposition::Included(guard), Some(slice), Some(target)) = (
            &resolution.disposition,
            &resolution.slice,
            resolution.resolution.target.as_deref(),
        ) && let Some(text) = slice.text.as_deref()
        {
            let source = MarkdownSource::parse(text.as_bytes().to_vec())
                .map_err(|_| VaultError::InvalidMarkdownNote(PathBuf::from(target)))?;
            for child in source
                .extract_links()
                .into_iter()
                .filter(|reference| reference.kind == LinkKind::Embed)
            {
                if tree_budget.remaining_nodes == 0 {
                    omitted_children = true;
                    break;
                }
                children.push(self.resolve_note_embed_tree(
                    Path::new(target),
                    &child,
                    guard.next_depth,
                    &guard.chain,
                    tree_budget,
                )?);
            }
        }

        Ok(VaultNoteEmbedNode {
            resolution,
            children,
            omitted_children,
        })
    }

    fn finish_note_embed(
        &self,
        before: &VaultSnapshot,
        reference: &LinkReference,
        resolution: LinkResolution,
        slice: Option<LinkSubpathSlice>,
        disposition: VaultNoteEmbedDisposition,
    ) -> Result<VaultNoteEmbedResolution, VaultError> {
        let after = self.snapshot()?;
        if before.revision_sha256 != after.revision_sha256 {
            return Err(VaultError::LinkResolutionSnapshotChanged);
        }
        Ok(VaultNoteEmbedResolution {
            reference: reference.clone(),
            resolution,
            slice,
            disposition,
            snapshot_sha256: before.revision_sha256.clone(),
        })
    }

    fn read_transclusion_source(&self, entry: &VaultSnapshotEntry) -> Result<Vec<u8>, VaultError> {
        if entry.size_bytes > MAX_NOTE_TRANSCLUSION_SOURCE_BYTES as u64 {
            return Err(VaultError::TransclusionSourceTooLarge(
                entry.relative_path.clone(),
            ));
        }
        let canonical = self.resolve_vault_path(&entry.relative_path, false)?;
        let mut file = fs::File::open(canonical)?;
        if file.metadata()?.len() != entry.size_bytes {
            return Err(VaultError::SnapshotChanged);
        }
        let mut bytes = Vec::with_capacity(entry.size_bytes as usize);
        IoRead::by_ref(&mut file)
            .take(MAX_NOTE_TRANSCLUSION_SOURCE_BYTES as u64 + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() > MAX_NOTE_TRANSCLUSION_SOURCE_BYTES {
            return Err(VaultError::TransclusionSourceTooLarge(
                entry.relative_path.clone(),
            ));
        }
        if bytes.len() as u64 != entry.size_bytes || sha256_hex(&bytes) != entry.revision_sha256 {
            return Err(VaultError::SnapshotChanged);
        }
        Ok(bytes)
    }

    fn decode_inline_image(
        &self,
        entry: &VaultSnapshotEntry,
        format: ImageFormat,
        budget: &mut InlineImageBudget,
    ) -> Result<Option<VaultInlineImage>, VaultError> {
        if entry.size_bytes > MAX_INLINE_IMAGE_SOURCE_BYTES
            || entry.size_bytes > budget.remaining_source_bytes
            || budget.remaining_images == 0
        {
            return Ok(None);
        }
        budget.remaining_images -= 1;
        budget.remaining_source_bytes -= entry.size_bytes;

        let bytes = self.read_inline_image_source(entry)?;
        let dimensions = catch_unwind(AssertUnwindSafe(|| {
            ImageReader::with_format(Cursor::new(bytes.as_slice()), format).into_dimensions()
        }))
        .ok()
        .and_then(Result::ok);
        let Some((width, height)) = dimensions else {
            return Ok(None);
        };
        if width == 0
            || height == 0
            || width > MAX_INLINE_IMAGE_DIMENSION
            || height > MAX_INLINE_IMAGE_DIMENSION
        {
            return Ok(None);
        }
        let pixel_count = u64::from(width) * u64::from(height);
        if pixel_count > MAX_INLINE_IMAGE_PIXELS || pixel_count > budget.remaining_pixels {
            return Ok(None);
        }
        budget.remaining_pixels -= pixel_count;

        let mut limits = ImageLimits::default();
        limits.max_image_width = Some(MAX_INLINE_IMAGE_DIMENSION);
        limits.max_image_height = Some(MAX_INLINE_IMAGE_DIMENSION);
        limits.max_alloc = Some(MAX_INLINE_IMAGE_DECODER_ALLOCATION);
        let decoded = catch_unwind(AssertUnwindSafe(|| {
            let mut reader = ImageReader::with_format(Cursor::new(bytes.as_slice()), format);
            reader.limits(limits);
            reader.decode()
        }))
        .ok()
        .and_then(Result::ok);
        let Some(decoded) = decoded else {
            return Ok(None);
        };
        let rgba_bytes = catch_unwind(AssertUnwindSafe(|| decoded.into_rgba8().into_raw())).ok();
        let Some(rgba_bytes) = rgba_bytes else {
            return Ok(None);
        };
        let Some(expected_bytes) = pixel_count
            .checked_mul(4)
            .and_then(|length| usize::try_from(length).ok())
        else {
            return Ok(None);
        };
        if rgba_bytes.len() != expected_bytes {
            return Ok(None);
        }

        Ok(Some(VaultInlineImage {
            revision_sha256: entry.revision_sha256.clone(),
            width,
            height,
            rgba_bytes,
        }))
    }

    fn read_inline_image_source(&self, entry: &VaultSnapshotEntry) -> Result<Vec<u8>, VaultError> {
        let canonical = self.resolve_vault_path(&entry.relative_path, false)?;
        let mut file = fs::File::open(canonical)?;
        if file.metadata()?.len() != entry.size_bytes {
            return Err(VaultError::SnapshotChanged);
        }
        let mut bytes = Vec::with_capacity(entry.size_bytes as usize);
        IoRead::by_ref(&mut file)
            .take(MAX_INLINE_IMAGE_SOURCE_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 != entry.size_bytes
            || bytes.len() as u64 > MAX_INLINE_IMAGE_SOURCE_BYTES
            || sha256_hex(&bytes) != entry.revision_sha256
        {
            return Err(VaultError::SnapshotChanged);
        }
        Ok(bytes)
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
        Ok(self
            .read_markdown_sources(snapshot)?
            .into_iter()
            .map(|(relative_path, source)| RenamePlanFile {
                relative_path,
                source,
            })
            .collect())
    }

    fn read_markdown_sources(
        &self,
        snapshot: &VaultSnapshot,
    ) -> Result<Vec<(String, MarkdownSource)>, VaultError> {
        let mut sources = Vec::new();
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
            sources.push((path_to_slashes(&entry.relative_path)?, source));
        }
        Ok(sources)
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
            let (size_bytes, revision_sha256) = hash_file_streaming(&path)?;
            output.push(VaultSnapshotEntry {
                relative_path,
                kind: VaultSnapshotEntryKind::File,
                size_bytes,
                revision_sha256,
                symlink_target: None,
            });
        } else {
            return Err(VaultError::UnsupportedEntry(relative_path));
        }
    }
    Ok(())
}

fn hash_file_streaming(path: &Path) -> Result<(u64, String), VaultError> {
    let mut file = fs::File::open(path)?;
    let initial_size = file.metadata()?.len();
    let mut digest = Sha256::new();
    let mut size_bytes = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        size_bytes = size_bytes
            .checked_add(count as u64)
            .ok_or(VaultError::SnapshotChanged)?;
        digest.update(&buffer[..count]);
    }
    if size_bytes != initial_size || file.metadata()?.len() != initial_size {
        return Err(VaultError::SnapshotChanged);
    }
    Ok((size_bytes, sha256_digest_hex(digest)))
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
    use super::{
        LinkKind, LinkReference, MAX_NOTE_SOURCE_PREVIEW_BYTES, MAX_NOTE_TRANSCLUSION_SOURCE_BYTES,
        MarkdownSource, TransclusionBlockReason, VaultError, VaultNoteEmbedDisposition, VaultRoot,
        VaultStore, VaultWriteRequest, sha256_hex,
    };
    use serde_json::Value;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    const C03_RENAME_FIXTURE: &str = include_str!("../../../fixtures/rename-plan.json");

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

    fn embed_reference(source: &str, target: &str) -> LinkReference {
        MarkdownSource::parse(source.as_bytes().to_vec())
            .unwrap()
            .extract_links()
            .into_iter()
            .find(|reference| reference.kind == LinkKind::Embed && reference.target == target)
            .unwrap_or_else(|| panic!("expected embed reference to {target}"))
    }

    fn rgba_png(rgba: [u8; 4]) -> Vec<u8> {
        use image::ImageEncoder as _;

        let mut bytes = Vec::new();
        image::codecs::png::PngEncoder::new(&mut bytes)
            .write_image(&rgba, 1, 1, image::ExtendedColorType::Rgba8)
            .unwrap();
        bytes
    }

    #[test]
    fn note_source_preview_is_bounded_and_preserves_the_original_prefix() {
        let temp = TempDir::new();
        let vault_path = temp.0.join("vault");
        fs::create_dir(&vault_path).unwrap();
        let original = (0..MAX_NOTE_SOURCE_PREVIEW_BYTES + 37)
            .map(|index| (index % 251) as u8)
            .collect::<Vec<_>>();
        fs::write(vault_path.join("Large.md"), &original).unwrap();
        let vault = VaultRoot::open(&vault_path).unwrap();
        let before = vault.snapshot().unwrap();

        let preview = vault.read_preview("Large.md").unwrap();

        assert_eq!(
            preview.source.as_bytes(),
            &original[..MAX_NOTE_SOURCE_PREVIEW_BYTES]
        );
        assert_eq!(preview.total_size_bytes, original.len() as u64);
        assert!(preview.truncated);
        assert_eq!(vault.snapshot().unwrap(), before);
    }

    #[test]
    fn note_embed_resolution_slices_markdown_and_decodes_bounded_raster_attachments() {
        let temp = TempDir::new();
        let index_bytes = b"![[Notes/Target#Details]]\n![[Images/photo.png]]\n";
        let target_bytes = b"# Target\r\n\r\n## Details\r\nbody\r\n## End\r\nignored\r\n";
        fs::create_dir_all(temp.0.join("Notes")).unwrap();
        fs::create_dir_all(temp.0.join("Images")).unwrap();
        fs::write(temp.0.join("Index.md"), index_bytes).unwrap();
        fs::write(temp.0.join("Notes/Target.md"), target_bytes).unwrap();
        let image_bytes = rgba_png([255, 0, 0, 255]);
        fs::write(temp.0.join("Images/photo.png"), &image_bytes).unwrap();

        let vault = VaultRoot::open(&temp.0).unwrap();
        let index = std::str::from_utf8(index_bytes).unwrap();
        let target_reference = embed_reference(index, "Notes/Target");
        let target = vault
            .resolve_note_embed("Index.md", &target_reference, 0, &["Index.md".to_owned()])
            .unwrap();

        assert_eq!(
            target.resolution.status,
            super::LinkResolutionStatus::Resolved
        );
        assert_eq!(
            target.disposition,
            VaultNoteEmbedDisposition::Included(super::TransclusionGuard {
                next_depth: 1,
                chain: vec!["Index.md".to_owned(), "Notes/Target.md".to_owned()],
            })
        );
        assert_eq!(
            target.slice.unwrap().text.as_deref(),
            Some("## Details\nbody")
        );

        let attachment_reference = embed_reference(index, "Images/photo.png");
        let attachment = vault
            .resolve_note_embed(
                "Index.md",
                &attachment_reference,
                0,
                &["Index.md".to_owned()],
            )
            .unwrap();
        assert_eq!(
            attachment.resolution.status,
            super::LinkResolutionStatus::Resolved
        );
        assert_eq!(
            attachment.resolution.target.as_deref(),
            Some("Images/photo.png")
        );
        let VaultNoteEmbedDisposition::Attachment(image) = attachment.disposition else {
            panic!("a valid in-budget PNG should produce a decoded attachment preview");
        };
        assert_eq!(image.revision_sha256, sha256_hex(&image_bytes));
        assert_eq!((image.width, image.height), (1, 1));
        assert_eq!(image.rgba_bytes, vec![255, 0, 0, 255]);
        assert_eq!(fs::read(temp.0.join("Index.md")).unwrap(), index_bytes);
        assert_eq!(
            fs::read(temp.0.join("Notes/Target.md")).unwrap(),
            target_bytes
        );
    }

    #[test]
    fn note_embed_report_limits_raster_attachment_count() {
        let temp = TempDir::new();
        let mut index_bytes = String::new();
        for _ in 0..=super::MAX_REPORT_INLINE_IMAGES {
            index_bytes.push_str("![[Images/photo.png]]\n");
        }
        fs::create_dir_all(temp.0.join("Images")).unwrap();
        fs::write(temp.0.join("Index.md"), index_bytes).unwrap();
        fs::write(temp.0.join("Images/photo.png"), rgba_png([0, 255, 0, 255])).unwrap();

        let vault = VaultRoot::open(&temp.0).unwrap();
        let report = vault.resolve_note_embeds_for_note("Index.md").unwrap();

        assert_eq!(report.embeds.len(), super::MAX_REPORT_INLINE_IMAGES + 1);
        assert!(
            report.embeds[..super::MAX_REPORT_INLINE_IMAGES]
                .iter()
                .all(|node| matches!(
                    node.resolution.disposition,
                    VaultNoteEmbedDisposition::Attachment(_)
                ))
        );
        let last = report.embeds.last().unwrap();
        assert_eq!(
            last.resolution.resolution.status,
            super::LinkResolutionStatus::Resolved
        );
        assert_eq!(
            last.resolution.disposition,
            VaultNoteEmbedDisposition::NotRendered
        );
    }

    #[test]
    fn oversized_raster_attachment_remains_resolved_but_is_not_decoded() {
        let temp = TempDir::new();
        fs::create_dir(temp.0.join("Images")).unwrap();
        fs::write(temp.0.join("Index.md"), b"![[Images/large.png]]\n").unwrap();
        fs::write(
            temp.0.join("Images/large.png"),
            vec![0; super::MAX_INLINE_IMAGE_SOURCE_BYTES as usize + 1],
        )
        .unwrap();

        let vault = VaultRoot::open(&temp.0).unwrap();
        let reference = embed_reference("![[Images/large.png]]", "Images/large.png");
        let result = vault
            .resolve_note_embed("Index.md", &reference, 0, &["Index.md".to_owned()])
            .unwrap();

        assert_eq!(
            result.resolution.status,
            super::LinkResolutionStatus::Resolved
        );
        assert_eq!(
            result.resolution.target.as_deref(),
            Some("Images/large.png")
        );
        assert_eq!(result.disposition, VaultNoteEmbedDisposition::NotRendered);
    }

    #[test]
    fn note_embed_guards_run_before_bounded_target_reads() {
        let temp = TempDir::new();
        let index_bytes = b"![[Huge]]\n";
        let oversized = vec![b'x'; MAX_NOTE_TRANSCLUSION_SOURCE_BYTES + 1];
        fs::write(temp.0.join("Index.md"), index_bytes).unwrap();
        fs::write(temp.0.join("Huge.md"), &oversized).unwrap();

        let vault = VaultRoot::open(&temp.0).unwrap();
        let reference = embed_reference(std::str::from_utf8(index_bytes).unwrap(), "Huge");
        let cyclic = vault
            .resolve_note_embed(
                "Index.md",
                &reference,
                0,
                &["Index.md".to_owned(), "Huge.md".to_owned()],
            )
            .unwrap();
        assert_eq!(
            cyclic.disposition,
            VaultNoteEmbedDisposition::Blocked(TransclusionBlockReason::Cycle)
        );

        let too_deep = vault
            .resolve_note_embed("Index.md", &reference, 3, &["Index.md".to_owned()])
            .unwrap();
        assert_eq!(
            too_deep.disposition,
            VaultNoteEmbedDisposition::Blocked(TransclusionBlockReason::Depth)
        );

        assert!(matches!(
            vault.resolve_note_embed("Index.md", &reference, 0, &["Index.md".to_owned()]),
            Err(VaultError::TransclusionSourceTooLarge(path)) if path == std::path::Path::new("Huge.md")
        ));
    }

    #[test]
    fn ambiguous_markdown_embeds_are_disambiguated_by_subpath() {
        let temp = TempDir::new();
        fs::create_dir_all(temp.0.join("Notes")).unwrap();
        fs::create_dir_all(temp.0.join("Archive")).unwrap();
        fs::write(temp.0.join("Index.md"), b"![[Target#Details]]\n").unwrap();
        fs::write(
            temp.0.join("Notes/Target.md"),
            b"# Target\n## Details\nselected\n",
        )
        .unwrap();
        fs::write(
            temp.0.join("Archive/Target.md"),
            b"# Target\n## Other\nnot selected\n",
        )
        .unwrap();

        let vault = VaultRoot::open(&temp.0).unwrap();
        let reference = embed_reference("![[Target#Details]]", "Target");
        let result = vault
            .resolve_note_embed("Index.md", &reference, 0, &["Index.md".to_owned()])
            .unwrap();

        assert_eq!(
            result.resolution.status,
            super::LinkResolutionStatus::Resolved
        );
        assert_eq!(result.resolution.target.as_deref(), Some("Notes/Target.md"));
        assert_eq!(
            result.slice.unwrap().text.as_deref(),
            Some("## Details\nselected\n")
        );
    }

    #[test]
    fn note_embed_tree_omits_entries_after_its_node_budget() {
        let temp = TempDir::new();
        let mut index_source = String::new();
        for number in 0..=super::MAX_NOTE_TRANSCLUSION_TREE_NODES {
            index_source.push_str(&format!("![[Target{number}]]\n"));
            fs::write(
                temp.0.join(format!("Target{number}.md")),
                format!("# Target {number}\n"),
            )
            .unwrap();
        }
        fs::write(temp.0.join("Index.md"), index_source).unwrap();

        let vault = VaultRoot::open(&temp.0).unwrap();
        let report = vault.resolve_note_embeds_for_note("Index.md").unwrap();

        assert_eq!(report.embeds.len(), super::MAX_NOTE_TRANSCLUSION_TREE_NODES);
        assert!(report.truncated);
        assert_eq!(
            report.snapshot_sha256,
            vault.snapshot().unwrap().revision_sha256
        );
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
    fn c03_fixture_failed_apply_restores_prior_reference_write_and_source_move() {
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
        let rollback = case["rollback"]
            .as_object()
            .expect("fixture rollback contract");
        let fail_on_path = PathBuf::from(rollback["fail_on_path"].as_str().unwrap());
        let prior_write_path = rollback["must_restore_prior_write_to"].as_str().unwrap();
        fs::create_dir_all(vault_path.join(&new_path).parent().unwrap()).unwrap();

        let mut store = VaultStore::open(&vault_path, &app_data_path).unwrap();
        store.fail_replace_path = Some(fail_on_path);
        let preview = store
            .root()
            .build_rename_preview(&old_path, &new_path)
            .unwrap();

        let error = store.apply_rename_preview(&preview).unwrap_err();

        assert!(
            error
                .to_string()
                .contains("injected atomic replace failure")
        );
        for (relative_path, original) in &originals {
            assert_eq!(fs::read(vault_path.join(relative_path)).unwrap(), *original);
        }
        assert!(vault_path.join(&old_path).exists());
        assert!(!vault_path.join(&new_path).exists());

        let journal = fs::read_to_string(app_data_path.join("journal.jsonl")).unwrap();
        let records: Vec<Value> = journal
            .lines()
            .map(|line| serde_json::from_str(line).expect("journal line must be valid JSON"))
            .collect();
        let committed_prior_writes = records
            .iter()
            .filter(|record| {
                record["operation"].as_str() == Some("write")
                    && record["relative_path"].as_str() == Some(prior_write_path)
                    && record["state"].as_str() == Some("committed")
            })
            .count();
        assert_eq!(
            committed_prior_writes, 2,
            "the earlier fixture reference write must commit and then be restored"
        );
        assert!(records.iter().any(|record| {
            record["operation"].as_str() == Some("rename")
                && record["state"].as_str() == Some("prepared")
        }));
        assert!(records.iter().any(|record| {
            record["operation"].as_str() == Some("rename")
                && record["state"].as_str() == Some("rolled_back")
        }));
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
