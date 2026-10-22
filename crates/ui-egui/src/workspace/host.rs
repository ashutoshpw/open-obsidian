//! Connects the workspace UI to a real vault session.
//!
//! The host owns the [`Workspace`], an engine-backed [`WorkspaceBackend`], and one text buffer
//! per open note. Vault indexing runs on the rayon pool and is polled each frame; note reads,
//! revision-checked saves, creation, and trashing go through [`VaultSession`] so every change
//! keeps the journaling, history, and stale-revision protections of the vault layer.

use super::{
    BacklinkRow, BookmarkRow, HeadingRow, LinkRow, SearchRow, Workspace, WorkspaceAction,
    WorkspaceBackend, tabs::tab_title,
};
use eframe::egui;
use egui_commonmark::{CommonMarkCache, CommonMarkViewer};
use openobsidian_engine::{
    IndexedLinkResolution, VaultError, VaultIndex, VaultRenamePreview, VaultSession,
    VaultWriteRequest, note_properties, parse_bookmarks, set_note_property,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{
    Arc,
    mpsc::{self, Receiver, TryRecvError},
};
use std::time::Duration;

type IndexResult = Result<VaultIndex, String>;

/// [`WorkspaceBackend`] answering from a built [`VaultIndex`].
pub struct EngineBackend {
    index: Arc<VaultIndex>,
    generation: u64,
    bookmarks: Arc<Vec<BookmarkRow>>,
}

impl EngineBackend {
    fn new(index: Arc<VaultIndex>, generation: u64, bookmarks: Arc<Vec<BookmarkRow>>) -> Self {
        Self {
            index,
            generation,
            bookmarks,
        }
    }
}

impl WorkspaceBackend for EngineBackend {
    fn revision(&self) -> u64 {
        self.generation
    }

    fn list_paths(&self) -> Vec<String> {
        self.index.files().to_vec()
    }

    fn backlinks(&self, path: &str) -> Vec<BacklinkRow> {
        self.index
            .backlinks(path)
            .into_iter()
            .map(|backlink| BacklinkRow {
                source: backlink.source,
                line: backlink.line,
            })
            .collect()
    }

    fn outgoing_links(&self, path: &str) -> Vec<LinkRow> {
        self.index
            .outgoing_links(path)
            .iter()
            .map(|link| LinkRow {
                target_label: link.target.clone(),
                resolved: match &link.resolution {
                    IndexedLinkResolution::Resolved(target) => Some(target.clone()),
                    _ => None,
                },
            })
            .collect()
    }

    fn search(&self, query: &str, limit: usize) -> Vec<SearchRow> {
        self.index
            .search(query, limit)
            .into_iter()
            .map(|hit| SearchRow {
                path: hit.path,
                score: hit.score as f32,
                preview: hit.preview,
            })
            .collect()
    }

    fn quick_switch(&self, query: &str, limit: usize) -> Vec<String> {
        self.index.quick_switcher(query, limit)
    }

    fn tags(&self) -> Vec<(String, usize)> {
        self.index.tag_counts().into_iter().collect()
    }

    fn notes_with_tag(&self, tag: &str) -> Vec<String> {
        self.index.notes_with_tag(tag)
    }

    fn headings(&self, path: &str) -> Vec<HeadingRow> {
        self.index
            .note(path)
            .map(|note| {
                note.headings
                    .iter()
                    .map(|heading| HeadingRow {
                        level: heading.level,
                        text: heading.text.clone(),
                        line: heading.line,
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    fn bookmarks(&self) -> Vec<BookmarkRow> {
        self.bookmarks.as_ref().clone()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum EditorMode {
    Source,
    Reading,
}

/// The editable text of one open note.
struct EditorBuffer {
    text: String,
    /// The text as last read from or written to the vault.
    saved_text: String,
    revision_sha256: Option<String>,
    mode: EditorMode,
    /// Pending text for the property being edited in the Properties panel: `(key, value)`.
    property_edit: Option<(String, String)>,
    /// Set when the note cannot be edited (unreadable or not UTF-8); the text is then empty.
    read_only_reason: Option<String>,
    error: Option<String>,
}

impl EditorBuffer {
    fn dirty(&self) -> bool {
        self.read_only_reason.is_none() && self.text != self.saved_text
    }
}

/// An open rename request: the new path is previewed before anything is written.
struct RenameDialog {
    from: String,
    to: String,
    preview: Option<VaultRenamePreview>,
    error: Option<String>,
}

/// Everything the app needs to show and drive the native workspace.
pub struct WorkspaceHost {
    pub workspace: Workspace,
    session: Option<Arc<VaultSession>>,
    vault_root: Option<PathBuf>,
    index: Arc<VaultIndex>,
    generation: u64,
    bookmarks: Arc<Vec<BookmarkRow>>,
    index_receiver: Option<Receiver<IndexResult>>,
    reindex_requested: bool,
    index_error: Option<String>,
    editors: HashMap<String, EditorBuffer>,
    markdown_cache: CommonMarkCache,
    status: Option<String>,
    rename: Option<RenameDialog>,
}

impl Default for WorkspaceHost {
    fn default() -> Self {
        Self {
            workspace: Workspace::new(),
            session: None,
            vault_root: None,
            index: Arc::new(VaultIndex::default()),
            generation: 0,
            bookmarks: Arc::new(Vec::new()),
            index_receiver: None,
            reindex_requested: false,
            index_error: None,
            editors: HashMap::new(),
            markdown_cache: CommonMarkCache::default(),
            status: None,
            rename: None,
        }
    }
}

impl WorkspaceHost {
    /// Renders the workspace for `session`, rebuilding the index when the session changes.
    pub fn show(&mut self, ui: &mut egui::Ui, session: Option<&Arc<VaultSession>>) {
        self.sync_session(session);
        self.poll_index(ui.ctx());
        let Some(session) = self.session.clone() else {
            ui.add_space(16.0);
            ui.heading("No vault is open");
            ui.label("Switch to the Inspector view and choose Open vault to start.");
            return;
        };
        let backend =
            EngineBackend::new(self.index.clone(), self.generation, self.bookmarks.clone());
        self.show_status_bar(ui);
        let editors = &mut self.editors;
        let cache = &mut self.markdown_cache;
        let mut rename_request = None;
        let actions = self.workspace.show_with_editor(ui, &backend, |ui, path| {
            show_editor(ui, editors, cache, path, &mut rename_request);
        });
        for action in actions {
            self.apply_action(&session, &backend, action);
        }
        if let Some(from) = rename_request {
            self.rename = Some(RenameDialog {
                to: from.clone(),
                from,
                preview: None,
                error: None,
            });
        }
        self.show_rename_dialog(ui.ctx(), &session);
    }

    fn show_rename_dialog(&mut self, ctx: &egui::Context, session: &VaultSession) {
        let Some(dialog) = &mut self.rename else {
            return;
        };
        let unsaved = self.editors.values().any(EditorBuffer::dirty);
        let mut preview_requested = false;
        let mut apply_requested = false;
        let mut cancel = false;
        egui::Window::new("Rename note")
            .collapsible(false)
            .show(ctx, |ui| {
                ui.label(format!("Rename {}", dialog.from));
                if ui.text_edit_singleline(&mut dialog.to).changed() {
                    dialog.preview = None;
                    dialog.error = None;
                }
                if unsaved {
                    ui.colored_label(
                        ui.visuals().error_fg_color,
                        "Save or reload every open note first; renaming rewrites links.",
                    );
                }
                if let Some(error) = &dialog.error {
                    ui.colored_label(ui.visuals().error_fg_color, error);
                }
                ui.horizontal(|ui| {
                    preview_requested = ui
                        .add_enabled(!unsaved, egui::Button::new("Preview"))
                        .clicked();
                    apply_requested = ui
                        .add_enabled(
                            !unsaved && dialog.preview.is_some(),
                            egui::Button::new("Apply rename"),
                        )
                        .clicked();
                    cancel = ui.button("Cancel").clicked();
                });
                if dialog.preview.is_some() {
                    ui.label("Preview ready. Links to this note will be updated.");
                }
            });
        if cancel {
            self.rename = None;
        } else if preview_requested {
            match session.build_rename_preview(&dialog.from, &dialog.to) {
                Ok(preview) => dialog.preview = Some(preview),
                Err(error) => dialog.error = Some(error.to_string()),
            }
        } else if apply_requested && let Some(preview) = dialog.preview.clone() {
            match session.apply_rename_preview(&preview) {
                Ok(result) => {
                    let from = dialog.from.clone();
                    let to = result.new_path.to_string_lossy().replace('\\', "/");
                    self.status = Some(format!(
                        "Renamed to {to}; updated {} link(s), skipped {}",
                        result.updated_references, result.skipped_references
                    ));
                    self.workspace.rename_path(&from, &to);
                    // Linking notes were rewritten, so every buffer is re-read on demand.
                    self.editors.clear();
                    self.rename = None;
                    self.request_index();
                    if let Some(active) = self.workspace.tabs.active_path().map(str::to_owned) {
                        self.ensure_loaded(session, &active);
                    }
                }
                Err(error) => dialog.error = Some(error.to_string()),
            }
        }
    }

    /// Whether any open note has unsaved edits.
    pub fn has_unsaved_changes(&self) -> bool {
        self.editors.values().any(EditorBuffer::dirty)
    }

    fn sync_session(&mut self, session: Option<&Arc<VaultSession>>) {
        let unchanged = match (&self.session, session) {
            (Some(current), Some(next)) => Arc::ptr_eq(current, next),
            (None, None) => true,
            _ => false,
        };
        if unchanged {
            return;
        }
        let next_root = session.map(|session| session.root_path().to_path_buf());
        if next_root != self.vault_root {
            self.workspace = Workspace::new();
            self.editors.clear();
            self.index = Arc::new(VaultIndex::default());
            self.generation += 1;
            self.status = None;
        }
        self.vault_root = next_root;
        self.session = session.cloned();
        self.request_index();
    }

    fn request_index(&mut self) {
        let Some(session) = self.session.clone() else {
            return;
        };
        if self.index_receiver.is_some() {
            self.reindex_requested = true;
            return;
        }
        let (sender, receiver) = mpsc::channel();
        rayon::spawn(move || {
            let _ = sender.send(session.build_index().map_err(|error| error.to_string()));
        });
        self.index_receiver = Some(receiver);
    }

    fn poll_index(&mut self, ctx: &egui::Context) {
        let result = self.index_receiver.as_ref().map(Receiver::try_recv);
        match result {
            Some(Ok(outcome)) => {
                self.index_receiver = None;
                match outcome {
                    Ok(index) => {
                        self.index = Arc::new(index);
                        self.bookmarks = Arc::new(self.load_bookmarks());
                        self.generation += 1;
                        self.index_error = None;
                    }
                    Err(error) => self.index_error = Some(error),
                }
                if std::mem::take(&mut self.reindex_requested) {
                    self.request_index();
                }
            }
            Some(Err(TryRecvError::Disconnected)) => {
                self.index_receiver = None;
                self.index_error = Some("Vault indexing stopped unexpectedly.".to_owned());
            }
            Some(Err(TryRecvError::Empty)) => {
                ctx.request_repaint_after(Duration::from_millis(100));
            }
            None => {}
        }
    }

    fn load_bookmarks(&self) -> Vec<BookmarkRow> {
        let Some(session) = &self.session else {
            return Vec::new();
        };
        match session.read(".obsidian/bookmarks.json") {
            Ok(read) => parse_bookmarks(read.document.as_bytes())
                .into_iter()
                .map(|bookmark| BookmarkRow {
                    title: bookmark.title,
                    path: bookmark.path,
                })
                .collect(),
            Err(_) => Vec::new(),
        }
    }

    fn show_status_bar(&self, ui: &mut egui::Ui) {
        egui::Panel::bottom(egui::Id::new("openobsidian-workspace-status")).show(ui, |ui| {
            ui.horizontal(|ui| {
                let index = if self.index_receiver.is_some() {
                    "Indexing…".to_owned()
                } else if let Some(error) = &self.index_error {
                    format!("Index unavailable: {error}")
                } else {
                    format!("{} files indexed", self.index.files().len())
                };
                ui.label(index);
                if let Some(path) = self.workspace.tabs.active_path()
                    && let Some(buffer) = self.editors.get(path)
                {
                    ui.separator();
                    ui.label(if buffer.dirty() {
                        "Unsaved changes"
                    } else {
                        "Saved"
                    });
                }
                if let Some(status) = &self.status {
                    ui.separator();
                    ui.label(status);
                }
            });
        });
    }

    fn apply_action(
        &mut self,
        session: &Arc<VaultSession>,
        backend: &EngineBackend,
        action: WorkspaceAction,
    ) {
        match action {
            WorkspaceAction::OpenNote(path) => self.ensure_loaded(session, &path),
            WorkspaceAction::TabClosed(path) => self.close_buffer(session, &path),
            WorkspaceAction::SaveNote(path) => self.save(session, &path),
            WorkspaceAction::CreateNote { folder } => {
                let path = unique_note_path(backend, &folder);
                self.create(session, path);
            }
            WorkspaceAction::CreateNoteAt(path) => {
                let path = if path.to_ascii_lowercase().ends_with(".md") {
                    path
                } else {
                    format!("{path}.md")
                };
                self.create(session, path);
            }
            WorkspaceAction::TrashNote(path) => self.trash(session, &path),
            WorkspaceAction::RunCommand(id) => {
                self.status = Some(format!("The command {id} is not available yet."));
            }
        }
    }

    fn ensure_loaded(&mut self, session: &VaultSession, path: &str) {
        if self.editors.contains_key(path) {
            return;
        }
        let buffer = match session.read(path) {
            Ok(read) => match String::from_utf8(read.document.as_bytes().to_vec()) {
                Ok(text) => EditorBuffer {
                    saved_text: text.clone(),
                    text,
                    revision_sha256: Some(read.revision_sha256),
                    mode: EditorMode::Source,
                    property_edit: None,
                    read_only_reason: None,
                    error: None,
                },
                Err(_) => {
                    read_only_buffer("This file is not valid UTF-8 text, so it is not edited.")
                }
            },
            Err(error) => read_only_buffer(&format!("This file could not be read: {error}")),
        };
        self.editors.insert(path.to_owned(), buffer);
    }

    fn save(&mut self, session: &VaultSession, path: &str) {
        let Some(buffer) = self.editors.get_mut(path) else {
            return;
        };
        if buffer.read_only_reason.is_some() || !buffer.dirty() {
            return;
        }
        let request = VaultWriteRequest {
            relative_path: PathBuf::from(path),
            expected_revision_sha256: buffer.revision_sha256.clone(),
            bytes: buffer.text.as_bytes().to_vec(),
        };
        match session.write(request) {
            Ok(result) => {
                buffer.saved_text = buffer.text.clone();
                buffer.revision_sha256 = Some(result.read.revision_sha256);
                buffer.error = None;
                self.status = Some(format!("Saved {}", tab_title(path)));
                self.request_index();
            }
            Err(VaultError::StaleRevision { .. }) => {
                buffer.error = Some(
                    "This note changed on disk after you opened it. Your edits are kept here; \
                     reload to take the disk version."
                        .to_owned(),
                );
            }
            Err(error) => buffer.error = Some(format!("Save failed: {error}")),
        }
    }

    /// Saves a closed tab's edits; if that fails the tab is reopened so nothing is lost.
    fn close_buffer(&mut self, session: &VaultSession, path: &str) {
        if self.workspace.tabs.position(path).is_some() {
            return;
        }
        self.save(session, path);
        if self.editors.get(path).is_some_and(EditorBuffer::dirty) {
            self.workspace.open_note(path);
            self.status = Some(format!(
                "{} has unsaved changes that could not be saved.",
                tab_title(path)
            ));
        } else {
            self.editors.remove(path);
        }
    }

    fn create(&mut self, session: &VaultSession, path: String) {
        match session.create_note(&path, b"") {
            Ok(_) => {
                self.status = Some(format!("Created {}", tab_title(&path)));
                self.request_index();
                self.workspace.open_note(&path);
                self.ensure_loaded(session, &path);
            }
            Err(error) => self.status = Some(format!("Could not create {path}: {error}")),
        }
    }

    fn trash(&mut self, session: &VaultSession, path: &str) {
        if self.editors.get(path).is_some_and(EditorBuffer::dirty) {
            self.status =
                Some("Save or reload this note before moving it to the trash.".to_owned());
            return;
        }
        let revision = match session.read(path) {
            Ok(read) => read.revision_sha256,
            Err(error) => {
                self.status = Some(format!("Could not read {path}: {error}"));
                return;
            }
        };
        match session.trash_note(path, &revision) {
            Ok(_) => {
                self.status = Some(format!("Moved {} to the vault trash", tab_title(path)));
                self.editors.remove(path);
                self.workspace.remove_path(path);
                self.request_index();
            }
            Err(error) => self.status = Some(format!("Could not trash {path}: {error}")),
        }
    }
}

fn read_only_buffer(reason: &str) -> EditorBuffer {
    EditorBuffer {
        text: String::new(),
        saved_text: String::new(),
        revision_sha256: None,
        mode: EditorMode::Source,
        property_edit: None,
        read_only_reason: Some(reason.to_owned()),
        error: None,
    }
}

fn show_editor(
    ui: &mut egui::Ui,
    editors: &mut HashMap<String, EditorBuffer>,
    cache: &mut CommonMarkCache,
    path: &str,
    rename_request: &mut Option<String>,
) {
    ui.horizontal(|ui| {
        ui.heading(tab_title(path));
        ui.weak(path);
        if path.to_ascii_lowercase().ends_with(".md") && ui.button("Rename…").clicked() {
            *rename_request = Some(path.to_owned());
        }
    });
    let Some(buffer) = editors.get_mut(path) else {
        ui.label("Loading…");
        return;
    };
    if let Some(reason) = &buffer.read_only_reason {
        ui.label(reason);
        return;
    }
    ui.horizontal(|ui| {
        ui.selectable_value(&mut buffer.mode, EditorMode::Source, "Source");
        ui.selectable_value(&mut buffer.mode, EditorMode::Reading, "Reading");
    });
    if let Some(error) = &buffer.error {
        ui.colored_label(ui.visuals().error_fg_color, error);
    }
    show_properties(ui, buffer, path);
    egui::ScrollArea::vertical()
        .id_salt(("openobsidian-workspace-editor", path))
        .auto_shrink([false, false])
        .show(ui, |ui| match buffer.mode {
            EditorMode::Source => {
                ui.add_sized(
                    ui.available_size(),
                    egui::TextEdit::multiline(&mut buffer.text)
                        .id_salt(("openobsidian-workspace-source", path))
                        .code_editor()
                        .desired_width(f32::INFINITY),
                );
            }
            EditorMode::Reading => {
                CommonMarkViewer::new().show(ui, cache, &buffer.text);
            }
        });
}

/// Collapsible list of the note's frontmatter properties; edits change the buffer, not the disk.
fn show_properties(ui: &mut egui::Ui, buffer: &mut EditorBuffer, path: &str) {
    let properties = note_properties(&buffer.text);
    if properties.is_empty() {
        return;
    }
    let mut commit = None;
    egui::CollapsingHeader::new("Properties")
        .id_salt(("openobsidian-workspace-properties", path))
        .show(ui, |ui| {
            for property in &properties {
                ui.horizontal(|ui| {
                    ui.label(property.key.as_str());
                    let editing = buffer
                        .property_edit
                        .as_ref()
                        .is_some_and(|(key, _)| key == &property.key);
                    if editing {
                        if let Some((_, value)) = &mut buffer.property_edit {
                            let response = ui.text_edit_singleline(value);
                            let accept = ui.button("Set").clicked()
                                || (response.lost_focus()
                                    && ui.input(|input| input.key_pressed(egui::Key::Enter)));
                            if accept {
                                commit = Some((property.key.clone(), value.clone()));
                            }
                        }
                        if ui.button("Cancel").clicked() {
                            buffer.property_edit = None;
                        }
                    } else {
                        ui.weak(property.value.as_str());
                        if ui.small_button("Edit").clicked() {
                            buffer.property_edit =
                                Some((property.key.clone(), property.value.clone()));
                        }
                    }
                });
            }
        });
    if let Some((key, value)) = commit {
        match set_note_property(&buffer.text, &key, &value) {
            Ok(text) => {
                buffer.text = text;
                buffer.property_edit = None;
                buffer.error = None;
            }
            Err(error) => buffer.error = Some(format!("Could not edit {key}: {error}")),
        }
    }
}

/// `Untitled.md`, `Untitled 1.md`, … in `folder`, skipping names already in the index.
fn unique_note_path(backend: &EngineBackend, folder: &str) -> String {
    let prefix = if folder.is_empty() {
        String::new()
    } else {
        format!("{}/", folder.trim_end_matches('/'))
    };
    let existing: std::collections::HashSet<String> = backend.list_paths().into_iter().collect();
    let first = format!("{prefix}Untitled.md");
    if !existing.contains(&first) {
        return first;
    }
    (1..)
        .map(|n| format!("{prefix}Untitled {n}.md"))
        .find(|candidate| !existing.contains(candidate))
        .unwrap_or(first)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::Instant;

    static NEXT_ID: AtomicU64 = AtomicU64::new(0);

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
            let path =
                std::env::temp_dir().join(format!("openobsidian-host-{}-{id}", std::process::id()));
            std::fs::create_dir_all(&path).expect("create temp dir");
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    struct Fixture {
        _dir: TempDir,
        vault: PathBuf,
        session: Arc<VaultSession>,
        host: WorkspaceHost,
        ctx: egui::Context,
    }

    fn fixture() -> Fixture {
        let dir = TempDir::new();
        let vault = dir.0.join("vault");
        let app_data = dir.0.join("app-data");
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::create_dir_all(&app_data).unwrap();
        std::fs::write(vault.join("a.md"), "Links to [[b]] #alpha\n").unwrap();
        std::fs::write(vault.join("b.md"), "# B\nplain\n").unwrap();
        let session = Arc::new(VaultSession::open(&vault, &app_data).unwrap());
        let mut fixture = Fixture {
            _dir: dir,
            vault,
            session,
            host: WorkspaceHost::default(),
            ctx: egui::Context::default(),
        };
        let session = fixture.session.clone();
        fixture.host.sync_session(Some(&session));
        fixture.wait_for_index();
        fixture
    }

    impl Fixture {
        fn wait_for_index(&mut self) {
            let deadline = Instant::now() + Duration::from_secs(10);
            while self.host.index_receiver.is_some() {
                assert!(Instant::now() < deadline, "index build did not finish");
                std::thread::sleep(Duration::from_millis(10));
                self.host.poll_index(&self.ctx);
            }
        }

        fn act(&mut self, action: WorkspaceAction) {
            let backend = EngineBackend::new(
                self.host.index.clone(),
                self.host.generation,
                self.host.bookmarks.clone(),
            );
            let session = self.session.clone();
            self.host.apply_action(&session, &backend, action);
            self.wait_for_index();
        }

        fn on_disk(&self, path: &str) -> String {
            std::fs::read_to_string(self.vault.join(path)).unwrap()
        }
    }

    #[test]
    fn index_feeds_the_backend() {
        let fixture = fixture();
        let backend = EngineBackend::new(
            fixture.host.index.clone(),
            fixture.host.generation,
            fixture.host.bookmarks.clone(),
        );
        assert_eq!(backend.list_paths(), vec!["a.md", "b.md"]);
        assert_eq!(
            backend.backlinks("b.md"),
            vec![BacklinkRow {
                source: "a.md".to_owned(),
                line: 1
            }]
        );
        assert_eq!(backend.tags(), vec![("alpha".to_owned(), 1)]);
        assert_eq!(
            backend.outgoing_links("a.md")[0].resolved.as_deref(),
            Some("b.md")
        );
    }

    #[test]
    fn outline_and_bookmarks_come_from_the_vault() {
        let dir = TempDir::new();
        let vault = dir.0.join("vault");
        let app_data = dir.0.join("app-data");
        std::fs::create_dir_all(vault.join(".obsidian")).unwrap();
        std::fs::create_dir_all(&app_data).unwrap();
        std::fs::write(vault.join("n.md"), "# Top\n## Sub\n").unwrap();
        std::fs::write(
            vault.join(".obsidian/bookmarks.json"),
            r#"{"items":[{"type":"file","path":"n.md","title":"N"}]}"#,
        )
        .unwrap();
        let session = Arc::new(VaultSession::open(&vault, &app_data).unwrap());
        let mut host = WorkspaceHost::default();
        host.sync_session(Some(&session));
        let ctx = egui::Context::default();
        let deadline = Instant::now() + Duration::from_secs(10);
        while host.index_receiver.is_some() {
            assert!(Instant::now() < deadline, "index build did not finish");
            std::thread::sleep(Duration::from_millis(10));
            host.poll_index(&ctx);
        }
        let backend =
            EngineBackend::new(host.index.clone(), host.generation, host.bookmarks.clone());
        let headings = backend.headings("n.md");
        assert_eq!(headings.len(), 2);
        assert_eq!((headings[1].level, headings[1].text.as_str()), (2, "Sub"));
        assert_eq!(
            backend.bookmarks(),
            vec![BookmarkRow {
                title: "N".to_owned(),
                path: Some("n.md".to_owned())
            }]
        );
    }

    #[test]
    fn edit_and_save_writes_through_the_vault() {
        let mut fixture = fixture();
        fixture.act(WorkspaceAction::OpenNote("b.md".to_owned()));
        let buffer = fixture.host.editors.get_mut("b.md").unwrap();
        assert!(!buffer.dirty());
        buffer.text.push_str("added\n");
        assert!(buffer.dirty());
        fixture.act(WorkspaceAction::SaveNote("b.md".to_owned()));
        assert_eq!(fixture.on_disk("b.md"), "# B\nplain\nadded\n");
        assert!(!fixture.host.has_unsaved_changes());
    }

    #[test]
    fn stale_save_keeps_edits_and_leaves_disk_untouched() {
        let mut fixture = fixture();
        fixture.act(WorkspaceAction::OpenNote("b.md".to_owned()));
        std::fs::write(fixture.vault.join("b.md"), "changed elsewhere\n").unwrap();
        fixture.host.editors.get_mut("b.md").unwrap().text = "my edit\n".to_owned();
        fixture.act(WorkspaceAction::SaveNote("b.md".to_owned()));
        let buffer = &fixture.host.editors["b.md"];
        assert!(buffer.error.is_some());
        assert_eq!(buffer.text, "my edit\n");
        assert_eq!(fixture.on_disk("b.md"), "changed elsewhere\n");
    }

    #[test]
    fn create_picks_unique_names_and_opens_the_note() {
        let mut fixture = fixture();
        fixture.act(WorkspaceAction::CreateNote {
            folder: String::new(),
        });
        fixture.act(WorkspaceAction::CreateNote {
            folder: String::new(),
        });
        assert!(fixture.vault.join("Untitled.md").is_file());
        assert!(fixture.vault.join("Untitled 1.md").is_file());
        assert_eq!(
            fixture.host.workspace.tabs.active_path(),
            Some("Untitled 1.md")
        );
        assert!(
            fixture
                .host
                .index
                .files()
                .contains(&"Untitled.md".to_owned())
        );
    }

    #[test]
    fn trash_moves_the_note_and_refuses_unsaved_edits() {
        let mut fixture = fixture();
        fixture.act(WorkspaceAction::OpenNote("b.md".to_owned()));
        fixture.host.editors.get_mut("b.md").unwrap().text.push('x');
        fixture.act(WorkspaceAction::TrashNote("b.md".to_owned()));
        assert!(fixture.vault.join("b.md").is_file());
        fixture.act(WorkspaceAction::SaveNote("b.md".to_owned()));
        fixture.act(WorkspaceAction::TrashNote("b.md".to_owned()));
        assert!(!fixture.vault.join("b.md").exists());
        assert!(fixture.vault.join(".trash").is_dir());
        assert!(!fixture.host.index.files().contains(&"b.md".to_owned()));
    }

    #[test]
    fn closing_a_dirty_tab_saves_it() {
        let mut fixture = fixture();
        fixture.host.workspace.open_note("b.md");
        fixture.act(WorkspaceAction::OpenNote("b.md".to_owned()));
        fixture.host.editors.get_mut("b.md").unwrap().text = "closed\n".to_owned();
        fixture.host.workspace.tabs.close_active();
        fixture.act(WorkspaceAction::TabClosed("b.md".to_owned()));
        assert_eq!(fixture.on_disk("b.md"), "closed\n");
        assert!(!fixture.host.editors.contains_key("b.md"));
    }
}
