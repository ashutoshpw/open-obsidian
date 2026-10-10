//! Native eframe application shell. Product workflows are migrated in later phases.

mod markdown_math;

use egui_commonmark::{CommonMarkCache, CommonMarkViewer};
use markdown_math::{MathRendererCache, math_render_callback};
use openobsidian_engine::{
    LinkKind, LinkRenameAction, LinkResolutionStatus, MAX_NOTE_SOURCE_PREVIEW_BYTES,
    MarkdownPreviewDisposition, TransclusionBlockReason, VaultConflictAction, VaultConflictRead,
    VaultConflictResolution, VaultError, VaultHistoryCleanup, VaultHistoryKind, VaultHistoryPlan,
    VaultHistoryPolicy, VaultHistoryRecord, VaultInlineImage, VaultLinkResolution,
    VaultNoteEmbedDisposition, VaultNoteEmbedNode, VaultNoteEmbedReport, VaultRenamePreview,
    VaultRenameRecoveryReport, VaultRenameResult, VaultSession, VaultWatcher,
    VaultWriteRecoveryReport, VaultWriteRequest, analyze_markdown_preview, plan_history_retention,
};
use std::cell::RefCell;
use std::collections::HashMap;
use std::path::Path;
use std::rc::Rc;
use std::sync::{
    Arc,
    atomic::{AtomicU16, Ordering},
    mpsc::{self, Receiver, TryRecvError},
};
use std::time::{Duration, Instant, SystemTime};

const GIBIBYTE: u64 = 1024 * 1024 * 1024;
const GIBIBYTE_F64: f64 = GIBIBYTE as f64;
const MAX_RENAME_PREVIEW_EDITS: usize = 100;
const MAX_LINK_STATUS_ROWS: usize = 100;
const MAX_TRANSCLUSION_PREVIEW_BYTES: usize = MAX_NOTE_SOURCE_PREVIEW_BYTES;
const VAULT_RECONCILIATION_INTERVAL: Duration = Duration::from_secs(60);
#[cfg(test)]
const C03_RENAME_FIXTURE: &str = include_str!("../../../fixtures/rename-plan.json");
#[cfg(test)]
const C03_LINK_RESOLUTION_FIXTURE: &str = include_str!("../../../fixtures/link-resolution.json");
#[cfg(test)]
const MARKDOWN_DIALECT_FIXTURE: &str = include_str!("../../../fixtures/markdown-dialects.json");
#[cfg(test)]
const HISTORY_RETENTION_FIXTURE: &str = include_str!("../../../fixtures/history-retention.json");
#[cfg(test)]
const SYNC_UNINSTALL_FIXTURE: &str = include_str!("../../../fixtures/uninstall-preservation.json");
#[cfg(test)]
const SYNC_WATCHER_RECOVERY_FIXTURE: &str =
    include_str!("../../../fixtures/sync-watcher-recovery.json");
#[cfg(test)]
const EXISTING_VAULT_FIXTURE: &str = include_str!("../../../fixtures/existing-vault.json");
#[cfg(test)]
const VAULT_SAFETY_FIXTURE: &str = include_str!("../../../fixtures/vault-safety.json");

/// Receives the result of opening a user-selected vault on a background worker.
pub type VaultOpenReceiver = Receiver<Result<VaultSession, String>>;
type VaultOpenAction = dyn Fn() -> Option<VaultOpenReceiver> + Send + Sync;
type HistoryReceiver = Receiver<HistoryTaskMessage>;
type LinkReceiver = Receiver<LinkTaskMessage>;
type NotePreviewReceiver = Receiver<Result<NoteSourcePreview, String>>;
type NotePreviewWriteReceiver = Receiver<Result<String, String>>;
type VaultRefreshReceiver = Receiver<Result<VaultRefreshOutcome, String>>;
type RenameReceiver = Receiver<RenameTaskMessage>;

struct LinkTaskMessage {
    resolutions: Result<Vec<VaultLinkResolution>, String>,
    note_embeds: Result<VaultNoteEmbedReport, String>,
}

struct NoteSourcePreview {
    relative_path: std::path::PathBuf,
    text: String,
    source_draft: Option<String>,
    total_size_bytes: u64,
    truncated: bool,
    revision_sha256: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum NotePreviewWriteKind {
    TaskCheckbox,
    MarkdownSource,
}

struct HistoryPreview {
    records: Vec<VaultHistoryRecord>,
    plan: VaultHistoryPlan,
}

struct ConflictVersionPreview {
    revision_sha256: String,
    text: String,
}

struct ConflictInspection {
    record: VaultHistoryRecord,
    current: Option<ConflictVersionPreview>,
    incoming: ConflictVersionPreview,
}

enum HistoryTaskMessage {
    Preview(Result<HistoryPreview, ()>),
    Cleanup(Result<(VaultHistoryCleanup, HistoryPreview), ()>),
    ConflictInspection(Result<ConflictInspection, ()>),
    ConflictResolution(Result<(VaultConflictResolution, HistoryPreview), ()>),
}

struct RenameApplyOutcome {
    session: VaultSession,
    result: VaultRenameResult,
    listing_refreshed: bool,
}

struct VaultRefreshOutcome {
    session: VaultSession,
    preserve_note_preview: bool,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct UninstallCleanupSelection {
    app_cache: bool,
    credentials: bool,
    recovery_history: bool,
}

enum RenameTaskMessage {
    Preview(Result<VaultRenamePreview, String>),
    Applied(Result<Box<RenameApplyOutcome>, String>),
}

/// Display-safe storage state passed from the desktop composition boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StorageProtectionDisplayStatus {
    Enabled,
    Disabled,
    Unknown,
}

/// Storage-protection result formatted for the native shell.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StorageProtectionDisplay {
    pub status: StorageProtectionDisplayStatus,
    pub method: String,
    pub detail: String,
}

/// Creates the initial native desktop application.
pub fn run() -> eframe::Result {
    run_with_desktop_services(
        || StorageProtectionDisplay {
            status: StorageProtectionDisplayStatus::Unknown,
            method: "unconfigured storage protection probe".to_owned(),
            detail: "OS storage protection has not been checked.".to_owned(),
        },
        || None,
    )
}

/// Creates the desktop shell with a probe supplied by the application boundary.
pub fn run_with_storage_protection_probe(
    probe: impl Fn() -> StorageProtectionDisplay + Send + Sync + 'static,
) -> eframe::Result {
    run_with_desktop_services(probe, || None)
}

/// Creates the desktop shell with platform services supplied by the application boundary.
pub fn run_with_desktop_services(
    probe: impl Fn() -> StorageProtectionDisplay + Send + Sync + 'static,
    open_vault: impl Fn() -> Option<VaultOpenReceiver> + Send + Sync + 'static,
) -> eframe::Result {
    run_with_desktop_services_and_session(probe, open_vault, None)
}

/// Creates the desktop shell with an existing vault session selected at launch.
pub fn run_with_desktop_services_and_session(
    probe: impl Fn() -> StorageProtectionDisplay + Send + Sync + 'static,
    open_vault: impl Fn() -> Option<VaultOpenReceiver> + Send + Sync + 'static,
    initial_session: Option<VaultSession>,
) -> eframe::Result {
    let options = eframe::NativeOptions::default();
    eframe::run_native(
        "OpenObsidian",
        options,
        Box::new(move |_creation_context| {
            Ok(Box::new(OpenObsidianApp {
                session: initial_session.map(Arc::new),
                storage_protection_probe: Some(Box::new(probe)),
                open_vault_action: Some(Box::new(open_vault)),
                ..OpenObsidianApp::default()
            }))
        }),
    )
}

#[derive(Default)]
struct OpenObsidianApp {
    session: Option<Arc<VaultSession>>,
    storage_protection_report: Option<StorageProtectionDisplay>,
    storage_protection_probe: Option<Box<dyn Fn() -> StorageProtectionDisplay + Send + Sync>>,
    open_vault_action: Option<Box<VaultOpenAction>>,
    vault_open_receiver: Option<VaultOpenReceiver>,
    vault_opening: bool,
    vault_open_error: Option<String>,
    vault_refresh_receiver: Option<VaultRefreshReceiver>,
    vault_refresh_error: Option<String>,
    vault_refresh_status: Option<String>,
    vault_watcher: Option<VaultWatcher>,
    vault_watch_error: Option<String>,
    vault_rescan_pending: bool,
    next_vault_reconciliation: Option<Instant>,
    history_policy: VaultHistoryPolicy,
    history_records: Vec<VaultHistoryRecord>,
    history_plan: Option<VaultHistoryPlan>,
    history_receiver: Option<HistoryReceiver>,
    history_error: Option<String>,
    history_status: Option<String>,
    cleanup_confirmation: bool,
    conflict_inspection: Option<ConflictInspection>,
    pending_conflict_action: Option<VaultConflictAction>,
    link_source_path: Option<std::path::PathBuf>,
    link_resolutions: Vec<VaultLinkResolution>,
    link_receiver: Option<LinkReceiver>,
    link_error: Option<String>,
    link_status: Option<String>,
    note_source_preview: Option<NoteSourcePreview>,
    note_preview_receiver: Option<NotePreviewReceiver>,
    note_preview_write_receiver: Option<NotePreviewWriteReceiver>,
    note_preview_write_kind: Option<NotePreviewWriteKind>,
    note_preview_error: Option<String>,
    note_preview_status: Option<String>,
    last_note_preview_write: Option<(std::path::PathBuf, String)>,
    note_embed_report: Option<VaultNoteEmbedReport>,
    note_embed_error: Option<String>,
    markdown_cache: CommonMarkCache,
    math_renderer_cache: Rc<RefCell<MathRendererCache>>,
    inline_image_textures: HashMap<String, eframe::egui::TextureHandle>,
    rename_source_path: Option<std::path::PathBuf>,
    rename_destination_path: String,
    rename_preview: Option<VaultRenamePreview>,
    rename_receiver: Option<RenameReceiver>,
    rename_error: Option<String>,
    rename_status: Option<String>,
    rename_confirmation: bool,
    uninstall_cleanup: UninstallCleanupSelection,
}

impl eframe::App for OpenObsidianApp {
    fn ui(&mut self, ui: &mut eframe::egui::Ui, _frame: &mut eframe::Frame) {
        self.show_ui(ui);
    }
}

impl OpenObsidianApp {
    fn show_ui(&mut self, ui: &mut eframe::egui::Ui) {
        self.poll_vault_refresh_task(ui);
        self.poll_vault_change_hints(ui);
        self.log_ci_open_vault_availability();
        ui.heading("OpenObsidian");
        ui.label("Native Rust migration is in progress.");
        let vault_operation_busy = self.history_receiver.is_some()
            || self.link_receiver.is_some()
            || self.note_preview_receiver.is_some()
            || self.note_preview_write_receiver.is_some()
            || self.vault_refresh_receiver.is_some()
            || self.rename_receiver.is_some()
            || self.note_source_editing();
        let open_vault_button = self.open_vault_action.as_ref().map(|_| {
            ui.add_enabled(
                !self.vault_opening && !vault_operation_busy,
                eframe::egui::Button::new("Open vault"),
            )
        });
        let open_vault_requested = open_vault_button
            .as_ref()
            .is_some_and(eframe::egui::Response::clicked);
        if std::env::var_os("OPENOBSIDIAN_CI_DIAGNOSTICS").is_some() {
            let pointer_button_events = ui.input(|input| {
                input
                    .events
                    .iter()
                    .filter(|event| {
                        matches!(
                            event,
                            eframe::egui::Event::PointerButton { .. }
                                | eframe::egui::Event::PointerMoved(_)
                                | eframe::egui::Event::Key { .. }
                        )
                    })
                    .map(|event| format!("{event:?}"))
                    .collect::<Vec<_>>()
            });
            if !pointer_button_events.is_empty() {
                let pointer_position = ui.input(|input| input.pointer.interact_pos());
                let response_rect = open_vault_button.as_ref().map(|response| response.rect);
                let hovered = open_vault_button
                    .as_ref()
                    .is_some_and(eframe::egui::Response::hovered);
                let focused = open_vault_button
                    .as_ref()
                    .is_some_and(|response| response.has_focus());
                eprintln!(
                    "OpenObsidian CI pointer input: response_rect={response_rect:?}, pointer={pointer_position:?}, hovered={hovered}, focused={focused}, clicked={open_vault_requested}, events={pointer_button_events:?}"
                );
            }
        }
        if open_vault_requested {
            if std::env::var_os("OPENOBSIDIAN_CI_DIAGNOSTICS").is_some() {
                eprintln!(
                    "OpenObsidian CI action: Open vault click received; session={}",
                    self.session.is_some()
                );
            }
            self.vault_open_error = None;
            if let Some(receiver) = self.open_vault_action.as_ref().and_then(|action| action()) {
                self.vault_open_receiver = Some(receiver);
                self.vault_opening = true;
            }
        }
        let open_result = self.vault_open_receiver.as_ref().map(Receiver::try_recv);
        match open_result {
            Some(Ok(Ok(session))) => {
                let watcher = VaultWatcher::watch(session.root_path());
                self.vault_watch_error = watcher.as_ref().err().map(|_| {
                    "Automatic vault notifications are unavailable; periodic disk reconciliation remains active."
                        .to_owned()
                });
                self.vault_watcher = watcher.ok();
                self.vault_rescan_pending = false;
                self.next_vault_reconciliation =
                    Some(Instant::now() + VAULT_RECONCILIATION_INTERVAL);
                self.rename_source_path = session
                    .entries()
                    .first()
                    .map(|entry| entry.relative_path.clone());
                self.link_source_path = self.rename_source_path.clone();
                self.session = Some(Arc::new(session));
                self.vault_open_receiver = None;
                self.vault_opening = false;
                self.vault_open_error = None;
                self.vault_refresh_receiver = None;
                self.vault_refresh_error = None;
                self.vault_refresh_status = None;
                self.history_records.clear();
                self.history_plan = None;
                self.history_receiver = None;
                self.history_error = None;
                self.history_status = None;
                self.cleanup_confirmation = false;
                self.conflict_inspection = None;
                self.pending_conflict_action = None;
                self.link_resolutions.clear();
                self.link_receiver = None;
                self.link_error = None;
                self.link_status = None;
                self.note_source_preview = None;
                self.note_preview_receiver = None;
                self.note_preview_write_receiver = None;
                self.note_preview_write_kind = None;
                self.note_preview_error = None;
                self.note_preview_status = None;
                self.last_note_preview_write = None;
                self.note_embed_report = None;
                self.note_embed_error = None;
                self.inline_image_textures.clear();
                self.rename_destination_path.clear();
                self.rename_preview = None;
                self.rename_receiver = None;
                self.rename_error = None;
                self.rename_status = None;
                self.rename_confirmation = false;
            }
            Some(Ok(Err(error))) => {
                self.vault_open_receiver = None;
                self.vault_opening = false;
                self.vault_open_error = Some(error);
            }
            Some(Err(TryRecvError::Empty)) => {
                ui.ctx().request_repaint_after(Duration::from_millis(100));
            }
            Some(Err(TryRecvError::Disconnected)) => {
                self.vault_open_receiver = None;
                self.vault_opening = false;
                self.vault_open_error = Some("Vault opening stopped unexpectedly.".to_owned());
            }
            None => {}
        }
        self.poll_history_task(ui);
        self.poll_link_task(ui);
        self.poll_note_preview_task(ui);
        self.poll_note_preview_write_task(ui);
        self.poll_rename_task(ui);
        if self.vault_opening {
            ui.label("Opening vault safely…");
        }
        if let Some(error) = &self.vault_open_error {
            ui.colored_label(eframe::egui::Color32::RED, error);
        }
        let mut refresh_note_list_requested = false;
        match &self.session {
            Some(session) => {
                let vault_name = session
                    .root_path()
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("Selected vault");
                ui.horizontal_wrapped(|ui| {
                    ui.label(format!("Vault: {vault_name}"));
                    ui.add_enabled_ui(!vault_operation_busy, |ui| {
                        refresh_note_list_requested = ui
                            .small_button("Refresh note list")
                            .on_hover_text("Rescan Markdown paths without changing vault files.")
                            .clicked();
                    });
                    ui.label(format!("{} Markdown files found.", session.entries().len()));
                });
                if let Some(summary) = rename_recovery_summary(session.rename_recovery_report()) {
                    if session.rename_recovery_report().needs_attention.is_empty() {
                        ui.label(summary);
                    } else {
                        ui.colored_label(eframe::egui::Color32::YELLOW, summary);
                        for issue in &session.rename_recovery_report().needs_attention {
                            ui.small(format!("{}: {}", issue.operation_id, issue.reason));
                        }
                    }
                }
                if let Some(summary) = write_recovery_summary(session.write_recovery_report()) {
                    if session.write_recovery_report().needs_attention.is_empty() {
                        ui.label(summary);
                    } else {
                        ui.colored_label(eframe::egui::Color32::YELLOW, summary);
                        for issue in &session.write_recovery_report().needs_attention {
                            ui.small(format!("{}: {}", issue.operation_id, issue.reason));
                        }
                    }
                }
            }
            None => {
                ui.label("No vault is open. Choose an existing vault folder to continue.");
            }
        }
        if self.vault_refresh_receiver.is_some() {
            ui.small("Refreshing the note list without changing vault files…");
        }
        if let Some(error) = &self.vault_refresh_error {
            ui.colored_label(eframe::egui::Color32::YELLOW, error);
        }
        if let Some(status) = &self.vault_refresh_status {
            ui.small(status);
        }
        if let Some(error) = &self.vault_watch_error {
            ui.colored_label(eframe::egui::Color32::YELLOW, error);
        }
        if refresh_note_list_requested {
            self.start_vault_refresh();
        }
        if self.session.is_some() {
            self.show_links(ui);
            self.show_rename(ui);
            self.show_history(ui);
        }
        ui.separator();
        ui.heading("OS storage protection");
        let refresh_requested = ui.button("Refresh storage status").clicked();
        if self.storage_protection_report.is_none() || refresh_requested {
            let report = self.storage_protection_probe.as_ref().map(|probe| probe());
            if let Some(report) = report {
                self.storage_protection_report = Some(report);
            }
        }
        if let Some(report) = &self.storage_protection_report {
            ui.label(format!(
                "Status: {}",
                storage_protection_label(report.status)
            ));
            ui.label(format!("Check: {}", report.method));
            ui.label(&report.detail);
        }
        ui.small("This check covers only the reported system volume or root filesystem.");
        self.show_uninstall_cleanup(ui);
        ui.label("Full-featured Markdown editing and plugin compatibility are not available in this preview.");
    }

    fn log_ci_open_vault_availability(&self) {
        if std::env::var_os("OPENOBSIDIAN_CI_DIAGNOSTICS").is_none() {
            return;
        }

        static LAST_STATE: AtomicU16 = AtomicU16::new(u16::MAX);
        let state = [
            self.session.is_some(),
            self.vault_opening,
            self.vault_open_receiver.is_some(),
            self.history_receiver.is_some(),
            self.link_receiver.is_some(),
            self.note_preview_receiver.is_some(),
            self.note_preview_write_receiver.is_some(),
            self.vault_refresh_receiver.is_some(),
            self.rename_receiver.is_some(),
        ]
        .into_iter()
        .enumerate()
        .fold(0_u16, |state, (bit, enabled)| {
            if enabled {
                state | (1_u16 << bit)
            } else {
                state
            }
        });

        if LAST_STATE.swap(state, Ordering::Relaxed) == state {
            return;
        }

        let vault_operation_busy = self.history_receiver.is_some()
            || self.link_receiver.is_some()
            || self.note_preview_receiver.is_some()
            || self.note_preview_write_receiver.is_some()
            || self.vault_refresh_receiver.is_some()
            || self.rename_receiver.is_some()
            || self.note_source_editing();
        eprintln!(
            "OpenObsidian CI UI state: session={}, vault_opening={}, vault_open_receiver={}, history_receiver={}, link_receiver={}, note_preview_receiver={}, note_preview_write_receiver={}, vault_refresh_receiver={}, rename_receiver={}, open_vault_enabled={}",
            self.session.is_some(),
            self.vault_opening,
            self.vault_open_receiver.is_some(),
            self.history_receiver.is_some(),
            self.link_receiver.is_some(),
            self.note_preview_receiver.is_some(),
            self.note_preview_write_receiver.is_some(),
            self.vault_refresh_receiver.is_some(),
            self.rename_receiver.is_some(),
            !self.vault_opening && !vault_operation_busy,
        );
    }

    fn show_uninstall_cleanup(&mut self, ui: &mut eframe::egui::Ui) {
        ui.separator();
        ui.heading("Uninstall cleanup");
        ui.label(
            "Preview optional app-data cleanup choices for the operating-system uninstaller. Package integration is pending; changing these choices here does not delete data. Vaults are never cleanup targets.",
        );
        ui.checkbox(&mut self.uninstall_cleanup.app_cache, "App cache");
        ui.small("Derived indexes, UI state and disposable runtime cache.");
        ui.checkbox(
            &mut self.uninstall_cleanup.credentials,
            "Stored credentials",
        );
        ui.small("Provider credentials kept in OS-backed credential storage.");
        ui.checkbox(
            &mut self.uninstall_cleanup.recovery_history,
            "Clean up recovery history",
        );
        ui.small("Managed recovery snapshots; unresolved conflicts remain protected.");
        ui.label(uninstall_cleanup_summary(self.uninstall_cleanup));
    }
}

impl OpenObsidianApp {
    fn note_source_editing(&self) -> bool {
        self.note_source_preview
            .as_ref()
            .is_some_and(|preview| preview.source_draft.is_some())
    }

    fn show_links(&mut self, ui: &mut eframe::egui::Ui) {
        ui.separator();
        ui.heading("Link status");
        ui.small(
            "Resolve wiki links, Markdown links and embeds against a stable vault snapshot. This check does not change vault files.",
        );

        let note_paths: Vec<std::path::PathBuf> = self
            .session
            .as_ref()
            .map(|session| {
                session
                    .entries()
                    .iter()
                    .map(|entry| entry.relative_path.clone())
                    .collect()
            })
            .unwrap_or_default();
        if self
            .link_source_path
            .as_ref()
            .is_none_or(|selected| !note_paths.contains(selected))
        {
            self.link_source_path = note_paths.first().cloned();
            self.link_resolutions.clear();
            self.note_embed_report = None;
            self.note_embed_error = None;
            self.inline_image_textures.clear();
        }

        let operation_busy = self.history_receiver.is_some()
            || self.link_receiver.is_some()
            || self.note_preview_receiver.is_some()
            || self.note_preview_write_receiver.is_some()
            || self.vault_refresh_receiver.is_some()
            || self.rename_receiver.is_some();
        let note_navigation_busy = operation_busy || self.note_source_editing();
        let selected_index = note_paths
            .iter()
            .position(|path| self.link_source_path.as_ref() == Some(path))
            .unwrap_or_default();
        let previous_path = (note_paths.len() > 1).then(|| {
            note_paths[(selected_index + note_paths.len() - 1) % note_paths.len()].clone()
        });
        let next_path = (note_paths.len() > 1)
            .then(|| note_paths[(selected_index + 1) % note_paths.len()].clone());
        let selected_label = self.link_source_path.as_ref().map_or_else(
            || "Choose a note".to_owned(),
            |path| path.display().to_string(),
        );
        let mut previous_requested = false;
        let mut next_requested = false;
        let mut source_changed = false;
        ui.horizontal(|ui| {
            ui.add_enabled_ui(!note_navigation_busy, |ui| {
                if previous_path.is_some() {
                    previous_requested = ui.small_button("Previous note").clicked();
                }
                let note_menu = ui.menu_button("Note to inspect", |ui| {
                    for path in &note_paths {
                        if ui
                            .radio_value(
                                &mut self.link_source_path,
                                Some(path.clone()),
                                path.display().to_string(),
                            )
                            .changed()
                        {
                            source_changed = true;
                        }
                    }
                });
                let note_menu_open = note_menu.inner.is_some();
                ui.ctx()
                    .accesskit_node_builder(note_menu.response.id, |node| {
                        node.set_label("Note to inspect");
                        node.set_value(selected_label.clone());
                        node.set_has_popup(eframe::egui::accesskit::HasPopup::Menu);
                        if note_menu_open {
                            node.set_expanded(true);
                        } else {
                            node.clear_expanded();
                        }
                        node.add_action(eframe::egui::accesskit::Action::Click);
                    });
                ui.label(&selected_label);
                if next_path.is_some() {
                    next_requested = ui.small_button("Next note").clicked();
                }
            });
            let can_resolve = !note_navigation_busy && self.link_source_path.is_some();
            if ui
                .add_enabled(
                    can_resolve,
                    eframe::egui::Button::new("Resolve link status"),
                )
                .clicked()
            {
                self.start_link_resolution();
            }
        });
        if previous_requested {
            self.link_source_path = previous_path;
            source_changed = true;
        } else if next_requested {
            self.link_source_path = next_path;
            source_changed = true;
        }
        if source_changed {
            self.link_resolutions.clear();
            self.link_error = None;
            self.link_status = None;
            self.note_source_preview = None;
            self.note_preview_error = None;
            self.note_preview_status = None;
            self.last_note_preview_write = None;
            self.note_embed_report = None;
            self.note_embed_error = None;
            self.inline_image_textures.clear();
        }

        self.show_note_source_preview(ui, operation_busy);

        if note_paths.is_empty() {
            ui.label("This vault has no Markdown notes to inspect.");
        } else if self.note_source_editing() {
            ui.label("Finish or cancel Markdown source editing before changing notes or starting other vault work.");
        } else if operation_busy {
            ui.label("Wait for the current vault operation to finish before checking link status.");
        }
        if let Some(error) = &self.link_error {
            ui.colored_label(eframe::egui::Color32::RED, error);
        }
        if let Some(status) = &self.link_status {
            ui.label(status);
        }
        if self.link_receiver.is_some() {
            ui.label("Resolving links against a stable vault snapshot…");
        }

        if self.link_status.is_some() {
            if self.link_resolutions.is_empty() {
                ui.label("No Markdown links or embeds were found in this note.");
            } else {
                ui.horizontal_wrapped(|ui| {
                    for status in [
                        LinkResolutionStatus::Resolved,
                        LinkResolutionStatus::Unresolved,
                        LinkResolutionStatus::Ambiguous,
                        LinkResolutionStatus::External,
                    ] {
                        let count = self
                            .link_resolutions
                            .iter()
                            .filter(|resolved| resolved.resolution.status == status)
                            .count();
                        ui.label(format!("{}: {count}", link_resolution_status_label(status)));
                    }
                });
                ui.label(format!(
                    "{} Markdown reference(s) checked.",
                    self.link_resolutions.len()
                ));
                eframe::egui::ScrollArea::vertical()
                    .max_height(260.0)
                    .show(ui, |ui| {
                        for resolved in self.link_resolutions.iter().take(MAX_LINK_STATUS_ROWS) {
                            ui.group(|ui| {
                                ui.horizontal_wrapped(|ui| {
                                    ui.colored_label(
                                        link_status_color(resolved.resolution.status),
                                        format!(
                                            "{} · {}",
                                            link_resolution_status_label(
                                                resolved.resolution.status
                                            ),
                                            link_kind_label(resolved.reference.kind),
                                        ),
                                    );
                                    ui.monospace(&resolved.reference.raw);
                                });
                                ui.small(format!("Source target: {}", resolved.reference.target));
                                if let Some(target) = &resolved.resolution.target {
                                    ui.small(format!("Resolved target: {target}"));
                                }
                                if !resolved.resolution.candidates.is_empty() {
                                    ui.small(format!(
                                        "Candidate paths: {}",
                                        resolved.resolution.candidates.join(", ")
                                    ));
                                }
                                if let Some(alias) = &resolved.reference.alias {
                                    ui.small(format!("Alias: {alias}"));
                                }
                                if let Some(subpath) = &resolved.reference.subpath {
                                    ui.small(format!("Heading or block: {subpath}"));
                                }
                            });
                        }
                    });
                if self.link_resolutions.len() > MAX_LINK_STATUS_ROWS {
                    ui.small(format!(
                        "Showing the first {MAX_LINK_STATUS_ROWS} of {} references.",
                        self.link_resolutions.len()
                    ));
                }
            }
        }

        if self.link_status.is_some()
            || self.note_embed_report.is_some()
            || self.note_embed_error.is_some()
        {
            ui.separator();
            ui.heading("Note transclusions");
            if let Some(error) = &self.note_embed_error {
                ui.colored_label(eframe::egui::Color32::YELLOW, error);
            } else if let Some(report) = &self.note_embed_report {
                if report.embeds.is_empty() {
                    ui.label("No note embeds were found in this note.");
                } else {
                    eframe::egui::ScrollArea::vertical()
                        .max_height(320.0)
                        .show(ui, |ui| {
                            for embed in &report.embeds {
                                show_note_embed_node(
                                    ui,
                                    embed,
                                    &mut self.markdown_cache,
                                    &self.math_renderer_cache,
                                    &mut self.inline_image_textures,
                                );
                            }
                            if report.truncated {
                                ui.small("Additional note embeds were omitted to keep this preview bounded.");
                            }
                        });
                }
            }
        }
    }

    fn show_note_source_preview(&mut self, ui: &mut eframe::egui::Ui, operation_busy: bool) {
        let mut request_preview = false;
        let mut close_preview = false;
        let mut begin_source_edit = false;
        let mut cancel_source_edit = false;
        let mut task_write = None;
        let mut source_write = None;
        let write_busy = self.note_preview_write_receiver.is_some();
        eframe::egui::CollapsingHeader::new("Note source preview")
            .id_salt("note-source-preview")
            .default_open(false)
            .show(ui, |ui| {
                ui.small(format!(
                    "Read up to {} KiB of the selected note's UTF-8 source. Task checkbox and source edits are saved only if the note revision still matches.",
                    MAX_NOTE_SOURCE_PREVIEW_BYTES / 1024
                ));

                let can_preview = !operation_busy
                    && !write_busy
                    && !self.note_source_editing()
                    && self.link_source_path.is_some();
                if ui
                    .add_enabled(
                        can_preview,
                        eframe::egui::Button::new("Read note source preview"),
                    )
                    .clicked()
                {
                    request_preview = true;
                }

                if self.note_preview_receiver.is_some() {
                    ui.label("Reading a bounded note source preview…");
                }
                if let Some(error) = &self.note_preview_error {
                    ui.colored_label(eframe::egui::Color32::YELLOW, error);
                }
                if let Some(status) = &self.note_preview_status {
                    ui.small(status);
                }

                if let Some(preview) = &mut self.note_source_preview {
                    ui.label(format!("Source: {}", preview.relative_path.display()));
                    let source_editing = preview.source_draft.is_some();
                    close_preview = ui
                        .add_enabled(
                            !operation_busy && !write_busy && !source_editing,
                            eframe::egui::Button::new("Close source preview"),
                        )
                        .clicked();

                    if preview.truncated {
                        ui.small("This truncated preview is read-only.");
                        ui.small("Original Markdown source");
                        ui.add(
                            eframe::egui::TextEdit::multiline(&mut preview.text)
                                .font(eframe::egui::TextStyle::Monospace)
                                .desired_rows(8)
                                .desired_width(f32::INFINITY)
                                .interactive(false),
                        );
                    } else if source_editing {
                        ui.small(format!(
                            "Edit the complete note as plain UTF-8 source. The draft must fit within the {} KiB write limit; unsupported Markdown remains literal source.",
                            MAX_NOTE_SOURCE_PREVIEW_BYTES / 1024
                        ));
                        if let (Some(draft), Some(revision_sha256)) = (
                            preview.source_draft.as_mut(),
                            preview.revision_sha256.as_ref(),
                        ) {
                            ui.label("Markdown source editor");
                            ui.add(
                                eframe::egui::TextEdit::multiline(draft)
                                    .id_salt("markdown-source-editor")
                                    .font(eframe::egui::TextStyle::Monospace)
                                    .desired_rows(16)
                                    .desired_width(f32::INFINITY)
                                    .cursor_at_end(true),
                            );
                            let source_bytes = draft.as_bytes().to_vec();
                            let draft_fits_limit = source_bytes.len()
                                <= MAX_NOTE_SOURCE_PREVIEW_BYTES;
                            if !draft_fits_limit {
                                ui.colored_label(
                                    eframe::egui::Color32::YELLOW,
                                    "The edited source exceeds the 16 KiB write limit.",
                                );
                            }
                            ui.horizontal(|ui| {
                                let save_enabled = !operation_busy
                                    && !write_busy
                                    && draft_fits_limit
                                    && preview.revision_sha256.is_some();
                                if ui
                                    .add_enabled(
                                        save_enabled,
                                        eframe::egui::Button::new("Save source edits"),
                                    )
                                    .clicked()
                                {
                                    source_write = Some((
                                        preview.relative_path.clone(),
                                        source_bytes,
                                        revision_sha256.clone(),
                                    ));
                                }
                                if ui
                                    .add_enabled(
                                        !write_busy,
                                        eframe::egui::Button::new("Cancel source edits"),
                                    )
                                    .clicked()
                                {
                                    cancel_source_edit = true;
                                }
                            });
                        } else {
                            ui.colored_label(
                                eframe::egui::Color32::YELLOW,
                                "This preview no longer has a current revision. Read it again before editing.",
                            );
                        }
                    } else {
                        if !operation_busy
                            && !write_busy
                            && preview.revision_sha256.is_some()
                            && ui.button("Edit Markdown source").clicked()
                        {
                            begin_source_edit = true;
                        }
                        if preview.revision_sha256.is_none() {
                            ui.small("Read the preview again before editing its source.");
                        }

                        if analyze_markdown_preview(&preview.text).disposition()
                            == MarkdownPreviewDisposition::RenderMarkdown
                        {
                            ui.small("Markdown preview");
                            ui.small(
                                "Task checkbox changes save only when this complete preview has a current revision and other vault work is idle.",
                            );
                            eframe::egui::ScrollArea::vertical()
                                .id_salt("note-source-markdown-preview")
                                .max_height(280.0)
                                .show(ui, |ui| {
                                    if !operation_busy
                                        && !write_busy
                                        && let Some(revision_sha256) =
                                            preview.revision_sha256.as_ref()
                                    {
                                        let math_callback =
                                            math_render_callback(Rc::clone(&self.math_renderer_cache));
                                        let response = CommonMarkViewer::new()
                                            .render_math_fn(Some(&math_callback))
                                            .show_mut(
                                                ui,
                                                &mut self.markdown_cache,
                                                &mut preview.text,
                                            )
                                            .response;
                                        if response.changed() {
                                            task_write = Some((
                                                preview.relative_path.clone(),
                                                preview.text.as_bytes().to_vec(),
                                                revision_sha256.clone(),
                                            ));
                                        }
                                    } else {
                                        let math_callback =
                                            math_render_callback(Rc::clone(&self.math_renderer_cache));
                                        CommonMarkViewer::new()
                                            .render_math_fn(Some(&math_callback))
                                            .show(
                                                ui,
                                                &mut self.markdown_cache,
                                                &preview.text,
                                            );
                                    }
                                });
                        } else {
                            let unsupported = analyze_markdown_preview(&preview.text)
                                .unsupported()
                                .iter()
                                .map(|syntax| syntax.label())
                                .collect::<Vec<_>>()
                                .join(", ");
                            ui.colored_label(
                                eframe::egui::Color32::YELLOW,
                                format!(
                                    "Unsupported Markdown ({unsupported}); showing the source as written."
                                ),
                            );
                        }

                        ui.small("Original Markdown source");
                        ui.add(
                            eframe::egui::TextEdit::multiline(&mut preview.text)
                                .font(eframe::egui::TextStyle::Monospace)
                                .desired_rows(8)
                                .desired_width(f32::INFINITY)
                                .interactive(false),
                        );
                    }

                    if preview.truncated {
                        ui.small(format!(
                            "Showing the first {} of {} source bytes.",
                            MAX_NOTE_SOURCE_PREVIEW_BYTES, preview.total_size_bytes
                        ));
                    } else {
                        ui.small(format!("Showing all {} source bytes.", preview.total_size_bytes));
                    }
                }
            });
        if request_preview {
            self.start_note_source_preview();
        }
        if begin_source_edit && let Some(preview) = &mut self.note_source_preview {
            preview.source_draft = Some(preview.text.clone());
        }
        if cancel_source_edit && let Some(preview) = &mut self.note_source_preview {
            preview.source_draft = None;
        }
        if let Some((relative_path, bytes, expected_revision_sha256)) = task_write {
            self.start_note_task_write(relative_path, bytes, expected_revision_sha256);
        }
        if let Some((relative_path, bytes, expected_revision_sha256)) = source_write {
            if let Some(preview) = &mut self.note_source_preview {
                preview.text = String::from_utf8(bytes.clone())
                    .expect("source editor contents must remain valid UTF-8");
                preview.total_size_bytes = bytes.len() as u64;
                preview.source_draft = None;
            }
            self.start_note_preview_write(
                relative_path,
                bytes,
                expected_revision_sha256,
                NotePreviewWriteKind::MarkdownSource,
            );
        }
        if close_preview {
            self.note_source_preview = None;
            self.note_preview_error = None;
            self.note_preview_status = None;
            self.last_note_preview_write = None;
        }
    }

    fn show_rename(&mut self, ui: &mut eframe::egui::Ui) {
        ui.separator();
        ui.heading("Rename Markdown note");
        ui.small(
            "Review every planned reference change before applying. Ambiguous and unresolved references stay unchanged.",
        );

        let note_paths: Vec<std::path::PathBuf> = self
            .session
            .as_ref()
            .map(|session| {
                session
                    .entries()
                    .iter()
                    .map(|entry| entry.relative_path.clone())
                    .collect()
            })
            .unwrap_or_default();
        if self
            .rename_source_path
            .as_ref()
            .is_none_or(|selected| !note_paths.contains(selected))
        {
            self.rename_source_path = note_paths.first().cloned();
        }

        let operation_busy = self.history_receiver.is_some()
            || self.link_receiver.is_some()
            || self.note_preview_receiver.is_some()
            || self.note_preview_write_receiver.is_some()
            || self.vault_refresh_receiver.is_some()
            || self.rename_receiver.is_some()
            || self.note_source_editing();
        let selected_label = self.rename_source_path.as_ref().map_or_else(
            || "Choose a note".to_owned(),
            |path| path.display().to_string(),
        );
        let mut source_changed = false;
        let mut destination_changed = false;
        ui.horizontal(|ui| {
            ui.add_enabled_ui(!operation_busy, |ui| {
                eframe::egui::ComboBox::from_label("Note to rename")
                    .selected_text(selected_label)
                    .show_ui(ui, |ui| {
                        for path in &note_paths {
                            if ui
                                .selectable_value(
                                    &mut self.rename_source_path,
                                    Some(path.clone()),
                                    path.display().to_string(),
                                )
                                .changed()
                            {
                                source_changed = true;
                            }
                        }
                    });
            });
            ui.label("Destination path");
            destination_changed = ui
                .add_enabled(
                    !operation_busy,
                    eframe::egui::TextEdit::singleline(&mut self.rename_destination_path)
                        .desired_width(240.0),
                )
                .changed();
        });
        if source_changed || destination_changed {
            self.rename_preview = None;
            self.rename_confirmation = false;
            self.rename_error = None;
            self.rename_status = None;
        }

        if note_paths.is_empty() {
            ui.label("This vault has no Markdown notes to rename.");
        } else if operation_busy {
            ui.label(
                "Wait for the current vault operation to finish before creating a rename preview.",
            );
        }
        if let Some(error) = &self.rename_error {
            ui.colored_label(eframe::egui::Color32::RED, error);
        }
        if let Some(status) = &self.rename_status {
            ui.label(status);
        }

        let can_preview = !operation_busy
            && self.rename_source_path.is_some()
            && !self.rename_destination_path.trim().is_empty();
        let request_preview = ui
            .add_enabled(
                can_preview,
                eframe::egui::Button::new("Build rename preview"),
            )
            .clicked();
        if request_preview {
            self.start_rename_preview();
        }
        if self.rename_receiver.is_some() {
            ui.label("Building the snapshot-bound rename preview…");
        }

        let mut request_review = false;
        let mut confirm_apply = false;
        let mut cancel_review = false;
        if let Some(preview) = self.rename_preview.as_ref() {
            let plan = &preview.plan;
            ui.group(|ui| {
                ui.label(format!(
                    "{} → {} · {} references will be updated · {} will stay unchanged",
                    plan.old_path, plan.new_path, plan.update_count, plan.skipped_count,
                ));
                for warning in &plan.warnings {
                    ui.colored_label(eframe::egui::Color32::YELLOW, warning);
                }
                if plan.edits.is_empty() {
                    ui.label("No references to this note were found.");
                } else {
                    eframe::egui::ScrollArea::vertical()
                        .max_height(220.0)
                        .show(ui, |ui| {
                            for edit in plan.edits.iter().take(MAX_RENAME_PREVIEW_EDITS) {
                                ui.horizontal_wrapped(|ui| {
                                    ui.label(format!("{} · {}", edit.source_path, edit.raw));
                                    ui.small(rename_action_label(edit.action));
                                    if edit.action == LinkRenameAction::Update
                                        && let Some(replacement) = &edit.replacement
                                    {
                                        ui.small(format!("Target becomes {replacement}"));
                                    }
                                });
                            }
                        });
                    if plan.edits.len() > MAX_RENAME_PREVIEW_EDITS {
                        ui.small(format!(
                            "Showing the first {MAX_RENAME_PREVIEW_EDITS} of {} affected references.",
                            plan.edits.len(),
                        ));
                    }
                }

                if self.rename_confirmation {
                    ui.separator();
                    ui.label(format!(
                        "Confirm moving {} to {} and applying {} reference update(s). Skipped ambiguous or unresolved references will remain unchanged.",
                        plan.old_path, plan.new_path, plan.update_count,
                    ));
                    ui.horizontal(|ui| {
                        confirm_apply = ui
                            .add_enabled(
                                !operation_busy,
                                eframe::egui::Button::new("Confirm and apply rename"),
                            )
                            .clicked();
                        cancel_review = ui.button("Cancel review").clicked();
                    });
                } else {
                    request_review = ui
                        .add_enabled(
                            !operation_busy,
                            eframe::egui::Button::new("Review and confirm rename"),
                        )
                        .clicked();
                }
            });
        }
        if request_review {
            self.rename_confirmation = true;
        } else if confirm_apply {
            self.start_rename_apply();
        } else if cancel_review {
            self.rename_confirmation = false;
        }
    }

    fn show_history(&mut self, ui: &mut eframe::egui::Ui) {
        ui.separator();
        ui.heading("Recovery history");
        ui.small("History is stored in private application data outside the vault.");

        let mut policy_changed = false;
        ui.horizontal(|ui| {
            ui.label("Retain days:");
            policy_changed |= ui
                .add(
                    eframe::egui::DragValue::new(&mut self.history_policy.max_age_days)
                        .range(1..=3650),
                )
                .changed();

            ui.label("Maximum size (GiB):");
            let mut max_gib = self.history_policy.max_bytes as f64 / GIBIBYTE_F64;
            if ui
                .add(
                    eframe::egui::DragValue::new(&mut max_gib)
                        .range(0.1..=1024.0)
                        .speed(0.1),
                )
                .changed()
            {
                self.history_policy.max_bytes = (max_gib * GIBIBYTE_F64).round() as u64;
                policy_changed = true;
            }
        });
        if policy_changed {
            self.history_plan = None;
            self.cleanup_confirmation = false;
        }

        let history_busy = self.history_receiver.is_some()
            || self.link_receiver.is_some()
            || self.note_preview_receiver.is_some()
            || self.note_preview_write_receiver.is_some()
            || self.vault_refresh_receiver.is_some()
            || self.rename_receiver.is_some()
            || self.note_source_editing();
        if ui
            .add_enabled(
                !history_busy,
                eframe::egui::Button::new("Refresh history and retention preview"),
            )
            .clicked()
        {
            self.start_history_preview();
        }
        if self.history_receiver.is_some() {
            ui.label("Working with history safely…");
        }
        if let Some(error) = &self.history_error {
            ui.colored_label(eframe::egui::Color32::RED, error);
        }
        if let Some(status) = &self.history_status {
            ui.label(status);
        }

        let plan = self.history_plan.clone();
        if let Some(plan) = &plan {
            ui.label(format!(
                "Retained: {} items ({}); eligible for cleanup: {} items ({}); protected: {} items.",
                plan.retained.len(),
                format_bytes(plan.retained_bytes),
                plan.pruneable.len(),
                format_bytes(plan.pruneable_bytes),
                plan.protected.len(),
            ));
            if plan.warning {
                ui.colored_label(
                    eframe::egui::Color32::YELLOW,
                    "Protected history exceeds the configured size limit and will be kept.",
                );
            }
        } else {
            ui.small(
                "Refresh the preview to apply the selected retention settings to the listing.",
            );
        }

        if let Some(plan) = &plan
            && !plan.pruneable.is_empty()
        {
            if self.cleanup_confirmation {
                ui.group(|ui| {
                    ui.label(format!(
                        "Confirm permanent removal of {} eligible items ({}). Unresolved conflicts are protected.",
                        plan.pruneable.len(),
                        format_bytes(plan.pruneable_bytes),
                    ));
                });
                let mut confirm_cleanup = false;
                let mut cancel_cleanup = false;
                ui.horizontal(|ui| {
                    confirm_cleanup = ui
                        .add_enabled(!history_busy, eframe::egui::Button::new("Confirm cleanup"))
                        .clicked();
                    cancel_cleanup = ui.button("Cancel").clicked();
                });
                if confirm_cleanup {
                    self.start_history_cleanup();
                } else if cancel_cleanup {
                    self.cleanup_confirmation = false;
                }
            } else if ui
                .add_enabled(
                    !history_busy,
                    eframe::egui::Button::new("Review eligible cleanup"),
                )
                .clicked()
            {
                self.cleanup_confirmation = true;
            }
        }

        let history_busy = self.history_receiver.is_some()
            || self.note_preview_receiver.is_some()
            || self.note_preview_write_receiver.is_some()
            || self.vault_refresh_receiver.is_some()
            || self.rename_receiver.is_some()
            || self.note_source_editing();
        if self.history_records.is_empty() && self.history_plan.is_some() {
            ui.label("No recovery, failed-write, or conflict history records were found.");
        } else if !self.history_records.is_empty() {
            let records = self.history_records.clone();
            let mut inspect_conflict = None;
            eframe::egui::ScrollArea::vertical()
                .max_height(220.0)
                .show(ui, |ui| {
                    for record in &records {
                        ui.horizontal_wrapped(|ui| {
                            let protection = if record.protected {
                                " · protected"
                            } else {
                                ""
                            };
                            ui.label(format!(
                                "{} · {} · {} · {} · {}{}",
                                history_kind_label(record.kind),
                                record.relative_path.display(),
                                format_bytes(record.bytes),
                                history_age_label(record.captured_at),
                                record.id,
                                protection,
                            ));
                            if record.kind == VaultHistoryKind::Conflict
                                && ui
                                    .add_enabled(
                                        !history_busy,
                                        eframe::egui::Button::new("Inspect conflict"),
                                    )
                                    .clicked()
                            {
                                inspect_conflict =
                                    Some((record.id.clone(), record.relative_path.clone()));
                            }
                        });
                    }
                });
            if let Some((id, relative_path)) = inspect_conflict {
                self.start_conflict_inspection(id, relative_path);
            }
        }

        let mut requested_action = None;
        let mut close_inspection = false;
        if let Some(inspection) = self.conflict_inspection.as_mut() {
            ui.separator();
            ui.heading(format!(
                "Conflict inspection: {}",
                inspection.record.relative_path.display()
            ));
            ui.small("Text preview is limited to 16 KiB; binary content is not shown.");
            ui.label(format!(
                "Expected current revision: {}",
                inspection
                    .record
                    .expected_revision_sha256
                    .as_deref()
                    .unwrap_or("none")
            ));
            ui.label(format!(
                "Recorded current revision: {}",
                inspection
                    .record
                    .current_revision_sha256
                    .as_deref()
                    .unwrap_or("none")
            ));
            ui.columns(2, |columns| {
                columns[0].label("Current version");
                if let Some(current) = inspection.current.as_mut() {
                    columns[0].small(format!("SHA-256 {}", current.revision_sha256));
                    columns[0].add(
                        eframe::egui::TextEdit::multiline(&mut current.text)
                            .desired_rows(8)
                            .interactive(false),
                    );
                } else {
                    columns[0].label("Current file could not be read.");
                }

                columns[1].label("Incoming version");
                columns[1].small(format!("SHA-256 {}", inspection.incoming.revision_sha256));
                columns[1].add(
                    eframe::egui::TextEdit::multiline(&mut inspection.incoming.text)
                        .desired_rows(8)
                        .interactive(false),
                );
            });
            ui.horizontal(|ui| {
                if ui
                    .add_enabled(
                        !history_busy,
                        eframe::egui::Button::new("Choose Keep Current…"),
                    )
                    .clicked()
                {
                    requested_action = Some(VaultConflictAction::KeepCurrent);
                }
                if ui
                    .add_enabled(
                        !history_busy,
                        eframe::egui::Button::new("Choose Keep Incoming…"),
                    )
                    .clicked()
                {
                    requested_action = Some(VaultConflictAction::KeepIncoming);
                }
                close_inspection = ui.button("Close inspection").clicked();
            });
        }
        if let Some(action) = requested_action {
            self.pending_conflict_action = Some(action);
        }
        if close_inspection {
            self.conflict_inspection = None;
            self.pending_conflict_action = None;
        }

        let resolution_request = self.pending_conflict_action.and_then(|action| {
            self.conflict_inspection.as_ref().map(|inspection| {
                (
                    action,
                    inspection.record.id.clone(),
                    inspection.record.relative_path.clone(),
                )
            })
        });
        if let Some((action, record_id, relative_path)) = resolution_request {
            let action_label = conflict_action_label(action);
            ui.group(|ui| {
                ui.label(format!(
                    "Confirm {action_label} for {}? Keep Incoming writes only if the recorded current revision still matches.",
                    relative_path.display(),
                ));
            });
            let mut confirm_resolution = false;
            let mut cancel_resolution = false;
            ui.horizontal(|ui| {
                confirm_resolution = ui
                    .add_enabled(
                        !history_busy,
                        eframe::egui::Button::new(format!("Confirm {action_label}")),
                    )
                    .clicked();
                cancel_resolution = ui.button("Cancel").clicked();
            });
            if confirm_resolution {
                self.start_conflict_resolution(record_id, relative_path, action);
            } else if cancel_resolution {
                self.pending_conflict_action = None;
            }
        }
    }

    fn start_history_preview(&mut self) {
        let Some(session) = self.session.as_ref().cloned() else {
            return;
        };
        let policy = self.history_policy;
        self.cleanup_confirmation = false;
        self.start_history_task(move || {
            HistoryTaskMessage::Preview(load_history_preview(&session, policy))
        });
    }

    fn start_history_cleanup(&mut self) {
        let Some(session) = self.session.as_ref().cloned() else {
            return;
        };
        let policy = self.history_policy;
        self.cleanup_confirmation = false;
        self.start_history_task(move || {
            let result = session
                .cleanup_history(policy)
                .map_err(|_| ())
                .and_then(|cleanup| {
                    load_history_preview(&session, policy).map(|preview| (cleanup, preview))
                });
            HistoryTaskMessage::Cleanup(result)
        });
    }

    fn start_conflict_inspection(&mut self, id: String, relative_path: std::path::PathBuf) {
        let Some(session) = self.session.as_ref().cloned() else {
            return;
        };
        self.conflict_inspection = None;
        self.pending_conflict_action = None;
        self.start_history_task(move || {
            let result = session
                .read_conflict(&id, &relative_path)
                .map_err(|_| ())
                .map(|incoming| build_conflict_inspection(&session, incoming));
            HistoryTaskMessage::ConflictInspection(result)
        });
    }

    fn start_conflict_resolution(
        &mut self,
        id: String,
        relative_path: std::path::PathBuf,
        action: VaultConflictAction,
    ) {
        let Some(session) = self.session.as_ref().cloned() else {
            return;
        };
        let policy = self.history_policy;
        self.pending_conflict_action = None;
        self.start_history_task(move || {
            let result = session
                .resolve_conflict(&id, &relative_path, action)
                .map_err(|_| ())
                .and_then(|resolution| {
                    load_history_preview(&session, policy).map(|preview| (resolution, preview))
                });
            HistoryTaskMessage::ConflictResolution(result)
        });
    }

    fn start_rename_preview(&mut self) {
        let Some(session) = self.session.as_ref().cloned() else {
            return;
        };
        let Some(old_path) = self.rename_source_path.clone() else {
            return;
        };
        let new_path = std::path::PathBuf::from(self.rename_destination_path.trim());
        self.rename_preview = None;
        self.rename_confirmation = false;
        self.rename_error = None;
        self.rename_status = None;
        let (sender, receiver) = mpsc::channel();
        rayon::spawn(move || {
            let result = session
                .build_rename_preview(old_path, new_path)
                .map_err(rename_preview_error);
            let _ = sender.send(RenameTaskMessage::Preview(result));
        });
        self.rename_receiver = Some(receiver);
    }

    fn start_link_resolution(&mut self) {
        let Some(session) = self.session.as_ref().cloned() else {
            return;
        };
        let Some(relative_path) = self.link_source_path.clone() else {
            return;
        };
        self.link_resolutions.clear();
        self.link_error = None;
        self.link_status = None;
        self.note_embed_report = None;
        self.note_embed_error = None;
        self.inline_image_textures.clear();
        let (sender, receiver) = mpsc::channel();
        rayon::spawn(move || {
            let resolutions = session
                .resolve_links_for_note(&relative_path)
                .map_err(link_resolution_error);
            let note_embeds = session
                .resolve_note_embeds_for_note(&relative_path)
                .map_err(note_embed_error);
            let _ = sender.send(LinkTaskMessage {
                resolutions,
                note_embeds,
            });
        });
        self.link_receiver = Some(receiver);
    }

    fn start_note_source_preview(&mut self) {
        let Some(session) = self.session.as_ref().cloned() else {
            return;
        };
        let Some(relative_path) = self.link_source_path.clone() else {
            return;
        };
        self.note_source_preview = None;
        self.note_preview_error = None;
        self.note_preview_status = None;
        self.last_note_preview_write = None;
        let (sender, receiver) = mpsc::channel();
        rayon::spawn(move || {
            let result = session
                .read_preview(&relative_path)
                .map_err(note_source_preview_error)
                .and_then(|preview| {
                    let source = preview.source.as_bytes();
                    let text = match std::str::from_utf8(source) {
                        Ok(text) => text.to_owned(),
                        Err(error) if preview.truncated && error.error_len().is_none() => {
                            std::str::from_utf8(&source[..error.valid_up_to()])
                                .expect("the validated source prefix must be UTF-8")
                                .to_owned()
                        }
                        Err(_) => {
                            return Err(
                                "The selected note preview contains invalid UTF-8; its original bytes remain unchanged and were not displayed."
                                    .to_owned(),
                            );
                        }
                    };
                    Ok(NoteSourcePreview {
                        relative_path,
                        text,
                        source_draft: None,
                        total_size_bytes: preview.total_size_bytes,
                        truncated: preview.truncated,
                        revision_sha256: preview.revision_sha256,
                    })
                });
            let _ = sender.send(result);
        });
        self.note_preview_receiver = Some(receiver);
    }

    fn start_note_task_write(
        &mut self,
        relative_path: std::path::PathBuf,
        bytes: Vec<u8>,
        expected_revision_sha256: String,
    ) {
        self.start_note_preview_write(
            relative_path,
            bytes,
            expected_revision_sha256,
            NotePreviewWriteKind::TaskCheckbox,
        );
    }

    fn start_note_preview_write(
        &mut self,
        relative_path: std::path::PathBuf,
        bytes: Vec<u8>,
        expected_revision_sha256: String,
        kind: NotePreviewWriteKind,
    ) {
        let Some(session) = self.session.as_ref().cloned() else {
            return;
        };
        self.note_preview_error = None;
        self.note_preview_status = Some(match kind {
            NotePreviewWriteKind::TaskCheckbox => "Saving task checkbox change…".to_owned(),
            NotePreviewWriteKind::MarkdownSource => "Saving Markdown source edits…".to_owned(),
        });
        self.note_preview_write_kind = Some(kind);
        let (sender, receiver) = mpsc::channel();
        rayon::spawn(move || {
            let result = session
                .write(VaultWriteRequest {
                    relative_path,
                    expected_revision_sha256: Some(expected_revision_sha256),
                    bytes,
                })
                .map(|result| result.read.revision_sha256)
                .map_err(|error| note_preview_write_error(error, kind));
            let _ = sender.send(result);
        });
        self.note_preview_write_receiver = Some(receiver);
    }

    fn start_vault_refresh(&mut self) {
        let Some(mut session) = self.session.as_ref().map(|session| (**session).clone()) else {
            return;
        };
        let note_preview_guard = self
            .last_note_preview_write
            .clone()
            .filter(|(path, revision)| {
                self.note_source_preview.as_ref().is_some_and(|preview| {
                    preview.relative_path == *path
                        && preview.revision_sha256.as_deref() == Some(revision.as_str())
                })
            });
        self.vault_refresh_error = None;
        self.vault_refresh_status = None;
        let (sender, receiver) = mpsc::channel();
        rayon::spawn(move || {
            let result = match session.refresh_entries() {
                Ok(()) => {
                    let preserve_note_preview = note_preview_guard.as_ref().is_some_and(
                        |(path, expected_revision)| {
                            session
                                .read_preview(path)
                                .ok()
                                .and_then(|preview| preview.revision_sha256)
                                .as_deref()
                                == Some(expected_revision.as_str())
                        },
                    );
                    Ok(VaultRefreshOutcome {
                        session,
                        preserve_note_preview,
                    })
                }
                Err(_) => Err(
                    "The note list could not be refreshed safely. The existing listing remains available."
                        .to_owned(),
                ),
            };
            let _ = sender.send(result);
        });
        self.vault_refresh_receiver = Some(receiver);
    }

    fn poll_vault_change_hints(&mut self, ui: &mut eframe::egui::Ui) {
        if self
            .vault_watcher
            .as_mut()
            .and_then(VaultWatcher::poll)
            .is_some()
        {
            self.vault_rescan_pending = true;
        }

        if self.session.is_none() {
            self.next_vault_reconciliation = None;
            return;
        }

        let now = Instant::now();
        let next_reconciliation = self
            .next_vault_reconciliation
            .get_or_insert(now + VAULT_RECONCILIATION_INTERVAL);
        if now >= *next_reconciliation {
            self.vault_rescan_pending = true;
            if let Some(watcher) = &mut self.vault_watcher {
                watcher.request_rescan();
                let _ = watcher.poll();
            }
            *next_reconciliation = now + VAULT_RECONCILIATION_INTERVAL;
        }
        ui.ctx()
            .request_repaint_after(next_reconciliation.saturating_duration_since(now));

        let operation_busy = self.vault_opening
            || self.vault_open_receiver.is_some()
            || self.history_receiver.is_some()
            || self.link_receiver.is_some()
            || self.note_preview_receiver.is_some()
            || self.note_preview_write_receiver.is_some()
            || self.vault_refresh_receiver.is_some()
            || self.rename_receiver.is_some()
            || self.note_source_editing();
        if self.vault_rescan_pending && !operation_busy {
            self.vault_rescan_pending = false;
            self.start_vault_refresh();
        } else if self.vault_rescan_pending {
            ui.ctx().request_repaint_after(Duration::from_millis(100));
        }
    }

    fn start_rename_apply(&mut self) {
        let Some(mut session) = self.session.as_ref().map(|session| (**session).clone()) else {
            return;
        };
        let Some(preview) = self.rename_preview.clone() else {
            return;
        };
        self.rename_confirmation = false;
        self.rename_error = None;
        self.rename_status = None;
        let (sender, receiver) = mpsc::channel();
        rayon::spawn(move || {
            let result = match session.apply_rename_preview(&preview) {
                Ok(result) => {
                    let listing_refreshed = session.refresh_entries().is_ok();
                    Ok(Box::new(RenameApplyOutcome {
                        session,
                        result,
                        listing_refreshed,
                    }))
                }
                Err(error) => Err(rename_apply_error(error)),
            };
            let _ = sender.send(RenameTaskMessage::Applied(result));
        });
        self.rename_receiver = Some(receiver);
    }

    fn start_history_task(&mut self, task: impl FnOnce() -> HistoryTaskMessage + Send + 'static) {
        let (sender, receiver) = mpsc::channel();
        rayon::spawn(move || {
            let _ = sender.send(task());
        });
        self.history_receiver = Some(receiver);
        self.history_error = None;
        self.history_status = None;
    }

    fn poll_rename_task(&mut self, ui: &mut eframe::egui::Ui) {
        let result = self.rename_receiver.as_ref().map(Receiver::try_recv);
        match result {
            Some(Ok(RenameTaskMessage::Preview(Ok(preview)))) => {
                self.rename_receiver = None;
                self.rename_preview = Some(preview);
                self.rename_error = None;
                self.rename_status = Some(
                    "Preview ready. Review the listed changes before confirming the rename."
                        .to_owned(),
                );
            }
            Some(Ok(RenameTaskMessage::Preview(Err(error)))) => {
                self.rename_receiver = None;
                self.rename_preview = None;
                self.rename_confirmation = false;
                self.rename_error = Some(error);
            }
            Some(Ok(RenameTaskMessage::Applied(Ok(outcome)))) => {
                self.rename_receiver = None;
                let RenameApplyOutcome {
                    session,
                    result,
                    listing_refreshed,
                } = *outcome;
                let result = &result;
                self.rename_source_path = Some(result.new_path.clone());
                if self.link_source_path.as_ref() == Some(&result.old_path) {
                    self.link_source_path = Some(result.new_path.clone());
                }
                self.link_resolutions.clear();
                self.link_error = None;
                self.link_status = None;
                self.note_source_preview = None;
                self.note_preview_error = None;
                self.note_preview_status = None;
                self.last_note_preview_write = None;
                self.note_embed_report = None;
                self.note_embed_error = None;
                self.inline_image_textures.clear();
                self.session = Some(Arc::new(session));
                self.rename_destination_path.clear();
                self.rename_preview = None;
                self.rename_confirmation = false;
                self.rename_error = if listing_refreshed {
                    None
                } else {
                    Some(
                        "The rename committed, but the note list could not be refreshed. Reopen the vault to refresh it."
                            .to_owned(),
                    )
                };
                self.rename_status = Some(format!(
                    "Renamed {} to {}. Updated {} reference(s); {} ambiguous or unresolved reference(s) were left unchanged.",
                    result.old_path.display(),
                    result.new_path.display(),
                    result.updated_references,
                    result.skipped_references,
                ));
            }
            Some(Ok(RenameTaskMessage::Applied(Err(error)))) => {
                self.rename_receiver = None;
                self.rename_preview = None;
                self.rename_confirmation = false;
                self.rename_error = Some(error);
            }
            Some(Err(TryRecvError::Disconnected)) => {
                self.rename_receiver = None;
                self.rename_error = Some("Rename operation stopped unexpectedly.".to_owned());
                self.rename_preview = None;
                self.rename_confirmation = false;
            }
            Some(Err(TryRecvError::Empty)) => {
                ui.ctx().request_repaint_after(Duration::from_millis(100));
            }
            None => {}
        }
    }

    fn poll_link_task(&mut self, ui: &mut eframe::egui::Ui) {
        let result = self.link_receiver.as_ref().map(Receiver::try_recv);
        match result {
            Some(Ok(message)) => {
                self.link_receiver = None;
                match message.resolutions {
                    Ok(resolutions) => {
                        let source_label = self.link_source_path.as_deref().map_or_else(
                            || "the selected note".to_owned(),
                            |path| path.display().to_string(),
                        );
                        self.link_status =
                            Some(format!("Link status refreshed for {source_label}."));
                        self.link_resolutions = resolutions;
                        self.link_error = None;
                    }
                    Err(error) => {
                        self.link_resolutions.clear();
                        self.link_status = None;
                        self.link_error = Some(error);
                    }
                }
                match message.note_embeds {
                    Ok(report) => {
                        self.note_embed_report = Some(report);
                        self.note_embed_error = None;
                    }
                    Err(error) => {
                        self.note_embed_report = None;
                        self.note_embed_error = Some(error);
                    }
                }
            }
            Some(Err(TryRecvError::Disconnected)) => {
                self.link_receiver = None;
                self.link_resolutions.clear();
                self.link_status = None;
                self.link_error = Some("Link status check stopped unexpectedly.".to_owned());
                self.note_embed_report = None;
                self.note_embed_error =
                    Some("Note transclusion preview stopped unexpectedly.".to_owned());
            }
            Some(Err(TryRecvError::Empty)) => {
                ui.ctx().request_repaint_after(Duration::from_millis(100));
            }
            None => {}
        }
    }

    fn poll_note_preview_task(&mut self, ui: &mut eframe::egui::Ui) {
        let result = self.note_preview_receiver.as_ref().map(Receiver::try_recv);
        match result {
            Some(Ok(Ok(preview))) => {
                self.note_preview_receiver = None;
                self.note_source_preview = Some(preview);
                self.note_preview_error = None;
            }
            Some(Ok(Err(error))) => {
                self.note_preview_receiver = None;
                self.note_source_preview = None;
                self.note_preview_error = Some(error);
            }
            Some(Err(TryRecvError::Disconnected)) => {
                self.note_preview_receiver = None;
                self.note_source_preview = None;
                self.note_preview_error =
                    Some("The note source preview stopped unexpectedly.".to_owned());
            }
            Some(Err(TryRecvError::Empty)) => {
                ui.ctx().request_repaint_after(Duration::from_millis(100));
            }
            None => {}
        }
    }

    fn poll_note_preview_write_task(&mut self, ui: &mut eframe::egui::Ui) {
        let result = self
            .note_preview_write_receiver
            .as_ref()
            .map(Receiver::try_recv);
        match result {
            Some(Ok(Ok(revision_sha256))) => {
                self.note_preview_write_receiver = None;
                let kind = self
                    .note_preview_write_kind
                    .take()
                    .unwrap_or(NotePreviewWriteKind::TaskCheckbox);
                let preview_path = self
                    .note_source_preview
                    .as_ref()
                    .map(|preview| preview.relative_path.clone());
                if let Some(preview) = &mut self.note_source_preview {
                    preview.revision_sha256 = Some(revision_sha256.clone());
                }
                self.last_note_preview_write = preview_path.map(|path| (path, revision_sha256));
                self.note_preview_error = None;
                self.note_preview_status = Some(match kind {
                    NotePreviewWriteKind::TaskCheckbox => {
                        "Task checkbox saved to the vault.".to_owned()
                    }
                    NotePreviewWriteKind::MarkdownSource => {
                        "Markdown source edits saved to the vault.".to_owned()
                    }
                });
            }
            Some(Ok(Err(error))) => {
                self.note_preview_write_receiver = None;
                self.note_preview_write_kind = None;
                self.last_note_preview_write = None;
                if let Some(preview) = &mut self.note_source_preview {
                    preview.revision_sha256 = None;
                }
                self.note_preview_status = None;
                self.note_preview_error = Some(error);
            }
            Some(Err(TryRecvError::Disconnected)) => {
                self.note_preview_write_receiver = None;
                let kind = self
                    .note_preview_write_kind
                    .take()
                    .unwrap_or(NotePreviewWriteKind::TaskCheckbox);
                self.last_note_preview_write = None;
                if let Some(preview) = &mut self.note_source_preview {
                    preview.revision_sha256 = None;
                }
                self.note_preview_status = None;
                self.note_preview_error = Some(match kind {
                    NotePreviewWriteKind::TaskCheckbox => "The task change could not be confirmed. The edited source remains visible; reopen the preview before editing again.".to_owned(),
                    NotePreviewWriteKind::MarkdownSource => "The source edit could not be confirmed. The edited source remains visible; reopen the preview before editing again.".to_owned(),
                });
            }
            Some(Err(TryRecvError::Empty)) => {
                ui.ctx().request_repaint_after(Duration::from_millis(100));
            }
            None => {}
        }
    }

    fn poll_vault_refresh_task(&mut self, ui: &mut eframe::egui::Ui) {
        let result = self.vault_refresh_receiver.as_ref().map(Receiver::try_recv);
        match result {
            Some(Ok(Ok(outcome))) => {
                self.vault_refresh_receiver = None;
                let VaultRefreshOutcome {
                    session,
                    preserve_note_preview,
                } = outcome;
                let note_paths: Vec<_> = session
                    .entries()
                    .iter()
                    .map(|entry| entry.relative_path.clone())
                    .collect();
                if self
                    .link_source_path
                    .as_ref()
                    .is_none_or(|selected| !note_paths.contains(selected))
                {
                    self.link_source_path = note_paths.first().cloned();
                }
                if self
                    .rename_source_path
                    .as_ref()
                    .is_none_or(|selected| !note_paths.contains(selected))
                {
                    self.rename_source_path = note_paths.first().cloned();
                }
                self.session = Some(Arc::new(session));
                self.link_resolutions.clear();
                self.link_error = None;
                self.link_status = None;
                if !preserve_note_preview {
                    self.note_source_preview = None;
                    self.note_preview_error = None;
                    self.note_preview_status = None;
                    self.last_note_preview_write = None;
                }
                self.note_embed_report = None;
                self.note_embed_error = None;
                self.inline_image_textures.clear();
                self.rename_preview = None;
                self.rename_error = None;
                self.rename_status = None;
                self.rename_confirmation = false;
                self.vault_refresh_error = None;
                self.vault_refresh_status = Some(format!(
                    "Note list refreshed: {} Markdown files found.",
                    note_paths.len()
                ));
            }
            Some(Ok(Err(error))) => {
                self.vault_refresh_receiver = None;
                self.vault_refresh_status = None;
                self.vault_refresh_error = Some(error);
            }
            Some(Err(TryRecvError::Disconnected)) => {
                self.vault_refresh_receiver = None;
                self.vault_refresh_status = None;
                self.vault_refresh_error =
                    Some("The note-list refresh stopped unexpectedly.".to_owned());
            }
            Some(Err(TryRecvError::Empty)) => {
                ui.ctx().request_repaint_after(Duration::from_millis(100));
            }
            None => {}
        }
    }

    fn poll_history_task(&mut self, ui: &mut eframe::egui::Ui) {
        let result = self.history_receiver.as_ref().map(Receiver::try_recv);
        match result {
            Some(Ok(message)) => {
                self.history_receiver = None;
                match message {
                    HistoryTaskMessage::Preview(Ok(preview)) => {
                        self.apply_history_preview(preview);
                    }
                    HistoryTaskMessage::Preview(Err(())) => {
                        self.history_error = Some("History could not be read safely.".to_owned());
                    }
                    HistoryTaskMessage::Cleanup(Ok((cleanup, preview))) => {
                        let removed = cleanup.removed.len();
                        let protected = cleanup.protected.len();
                        self.apply_history_preview(preview);
                        self.cleanup_confirmation = false;
                        self.history_status = Some(format!(
                            "Removed {removed} eligible history items; {protected} protected items remain.",
                        ));
                    }
                    HistoryTaskMessage::Cleanup(Err(())) => {
                        self.history_plan = None;
                        self.history_error = Some(
                            "Cleanup stopped early; refresh history to inspect the remaining records."
                                .to_owned(),
                        );
                    }
                    HistoryTaskMessage::ConflictInspection(Ok(inspection)) => {
                        self.conflict_inspection = Some(inspection);
                        self.pending_conflict_action = None;
                    }
                    HistoryTaskMessage::ConflictInspection(Err(())) => {
                        self.history_error = Some(
                            "Conflict could not be read safely; its stored record was left unchanged."
                                .to_owned(),
                        );
                    }
                    HistoryTaskMessage::ConflictResolution(Ok((resolution, preview))) => {
                        self.apply_history_preview(preview);
                        self.conflict_inspection = None;
                        self.pending_conflict_action = None;
                        self.history_status = Some(format!(
                            "Conflict resolved: {}.",
                            conflict_action_label(resolution.action)
                        ));
                    }
                    HistoryTaskMessage::ConflictResolution(Err(())) => {
                        self.history_plan = None;
                        self.conflict_inspection = None;
                        self.pending_conflict_action = None;
                        self.history_error = Some(
                            "Conflict resolution failed; refresh history before trying again."
                                .to_owned(),
                        );
                    }
                }
            }
            Some(Err(TryRecvError::Disconnected)) => {
                self.history_receiver = None;
                self.history_error = Some("History operation stopped unexpectedly.".to_owned());
            }
            Some(Err(TryRecvError::Empty)) => {
                ui.ctx().request_repaint_after(Duration::from_millis(100));
            }
            None => {}
        }
    }

    fn apply_history_preview(&mut self, preview: HistoryPreview) {
        self.history_records = preview.records;
        self.history_plan = Some(preview.plan);
        self.history_error = None;
    }
}

fn load_history_preview(
    session: &VaultSession,
    policy: VaultHistoryPolicy,
) -> Result<HistoryPreview, ()> {
    let records = session.history_records().map_err(|_| ())?;
    let plan = plan_history_retention(&records, policy, SystemTime::now());
    Ok(HistoryPreview { records, plan })
}

fn build_conflict_inspection(
    session: &VaultSession,
    incoming: VaultConflictRead,
) -> ConflictInspection {
    let current = session
        .read(&incoming.record.relative_path)
        .ok()
        .map(|current| ConflictVersionPreview {
            revision_sha256: current.revision_sha256,
            text: bounded_text_preview(current.document.as_bytes()),
        });
    ConflictInspection {
        record: incoming.record,
        current,
        incoming: ConflictVersionPreview {
            revision_sha256: incoming.revision_sha256,
            text: bounded_text_preview(&incoming.bytes),
        },
    }
}

fn bounded_text_preview(bytes: &[u8]) -> String {
    const MAX_PREVIEW_BYTES: usize = 16 * 1024;
    let Ok(text) = std::str::from_utf8(bytes) else {
        return format!("<Binary content; {} bytes; preview omitted>", bytes.len());
    };
    let mut end = text.len().min(MAX_PREVIEW_BYTES);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let mut preview = text[..end].to_owned();
    if end < text.len() {
        preview.push_str("\n… preview truncated …");
    }
    preview
}

fn conflict_action_label(action: VaultConflictAction) -> &'static str {
    match action {
        VaultConflictAction::KeepCurrent => "Keep Current",
        VaultConflictAction::KeepIncoming => "Keep Incoming",
    }
}

fn rename_action_label(action: LinkRenameAction) -> &'static str {
    match action {
        LinkRenameAction::Update => "Will update",
        LinkRenameAction::SkipAmbiguous => "Ambiguous; will stay unchanged",
        LinkRenameAction::SkipUnresolved => "Unresolved; will stay unchanged",
    }
}

fn rename_preview_error(error: VaultError) -> String {
    match error {
        VaultError::SnapshotChanged => {
            "The vault changed while the preview was being prepared. Build a fresh preview."
                .to_owned()
        }
        VaultError::NotAFile(_) => {
            "The selected note is no longer available. Reopen the vault and try again.".to_owned()
        }
        VaultError::InvalidPath | VaultError::OutsideRoot(_) => {
            "Choose a non-empty relative destination path inside the vault.".to_owned()
        }
        error => format!("A safe rename preview could not be prepared: {error}"),
    }
}

fn rename_apply_error(error: VaultError) -> String {
    match error {
        VaultError::StaleRenamePreview | VaultError::SnapshotChanged => {
            "The vault changed after this preview. Build and review a fresh preview before applying."
                .to_owned()
        }
        VaultError::RenameDestinationExists(_) => {
            "The destination already exists. Choose another path and build a fresh preview."
                .to_owned()
        }
        VaultError::RenameTransactionRecoveryRequired { reason, .. } => {
            format!("The rename needs recovery before another attempt: {reason}")
        }
        error => format!("The rename could not be completed: {error}"),
    }
}

fn link_resolution_error(error: VaultError) -> String {
    match error {
        VaultError::LinkResolutionSnapshotChanged => {
            "The vault changed while links were being checked. Refresh the status and try again."
                .to_owned()
        }
        VaultError::NotMarkdownNote(_) | VaultError::InvalidMarkdownNote(_) => {
            "The selected Markdown note could not be read safely.".to_owned()
        }
        VaultError::NotAFile(_) => {
            "The selected note is no longer available. Reopen the vault and try again.".to_owned()
        }
        _ => "Link status could not be read safely from the vault.".to_owned(),
    }
}

fn note_source_preview_error(error: VaultError) -> String {
    match error {
        VaultError::SnapshotChanged => {
            "The note changed while its preview was being read. Read the preview again.".to_owned()
        }
        VaultError::NotAFile(_) => {
            "The selected note is no longer available. Reopen the vault and try again.".to_owned()
        }
        _ => "The selected note source could not be read safely.".to_owned(),
    }
}

fn note_task_write_error(error: VaultError) -> String {
    match error {
        VaultError::RevisionConflict { .. } => {
            "The note changed after this preview was read. The task change was preserved in conflict recovery history; reload the preview before editing again."
                .to_owned()
        }
        VaultError::NotAFile(_) => {
            "The selected note is no longer available. The edited source remains visible; reopen the vault before continuing."
                .to_owned()
        }
        _ => {
            "The task change could not be saved safely. The edited source remains visible; inspect the vault and reopen the preview before editing again."
                .to_owned()
        }
    }
}

fn note_source_write_error(error: VaultError) -> String {
    match error {
        VaultError::RevisionConflict { .. } => {
            "The note changed after this preview was read. The source edit was preserved in conflict recovery history; reload the preview before editing again."
                .to_owned()
        }
        VaultError::NotAFile(_) => {
            "The selected note is no longer available. The edited source remains visible; reopen the vault before continuing."
                .to_owned()
        }
        _ => {
            "The source edit could not be saved safely. The edited source remains visible; inspect the vault and reopen the preview before editing again."
                .to_owned()
        }
    }
}

fn note_preview_write_error(error: VaultError, kind: NotePreviewWriteKind) -> String {
    match kind {
        NotePreviewWriteKind::TaskCheckbox => note_task_write_error(error),
        NotePreviewWriteKind::MarkdownSource => note_source_write_error(error),
    }
}

fn show_markdown_preview(
    ui: &mut eframe::egui::Ui,
    markdown_cache: &mut CommonMarkCache,
    math_renderer_cache: &Rc<RefCell<MathRendererCache>>,
    source: &str,
) {
    let analysis = analyze_markdown_preview(source);
    match analysis.disposition() {
        MarkdownPreviewDisposition::RenderMarkdown => {
            let math_callback = math_render_callback(Rc::clone(math_renderer_cache));
            CommonMarkViewer::new()
                .render_math_fn(Some(&math_callback))
                .show(ui, markdown_cache, source);
        }
        MarkdownPreviewDisposition::ShowSource => {
            let unsupported = analysis
                .unsupported()
                .iter()
                .map(|syntax| syntax.label())
                .collect::<Vec<_>>()
                .join(", ");
            ui.colored_label(
                eframe::egui::Color32::YELLOW,
                format!("Unsupported Markdown ({unsupported}); showing the source as written."),
            );
            ui.monospace(source);
        }
    }
}

fn note_embed_error(error: VaultError) -> String {
    match error {
        VaultError::LinkResolutionSnapshotChanged | VaultError::SnapshotChanged => {
            "The vault changed while note transclusions were being prepared. Refresh the preview and try again."
                .to_owned()
        }
        VaultError::TransclusionSourceTooLarge(path) => format!(
            "Note transclusion preview stopped because {} exceeds the 512 KiB source limit.",
            path.display()
        ),
        VaultError::NotMarkdownNote(_) | VaultError::InvalidMarkdownNote(_) => {
            "The selected Markdown note could not be read safely for transclusion preview.".to_owned()
        }
        VaultError::NotAFile(_) => {
            "The selected note is no longer available. Reopen the vault and try again.".to_owned()
        }
        _ => "Note transclusions could not be read safely from the vault.".to_owned(),
    }
}

fn show_note_embed_node(
    ui: &mut eframe::egui::Ui,
    node: &VaultNoteEmbedNode,
    markdown_cache: &mut CommonMarkCache,
    math_renderer_cache: &Rc<RefCell<MathRendererCache>>,
    inline_image_textures: &mut HashMap<String, eframe::egui::TextureHandle>,
) {
    let reference = &node.resolution.reference;
    ui.group(|ui| {
        ui.monospace(&reference.raw);
        match &node.resolution.disposition {
            VaultNoteEmbedDisposition::Included(_) => {
                let target = node
                    .resolution
                    .resolution
                    .target
                    .as_deref()
                    .unwrap_or("resolved note");
                ui.colored_label(
                    eframe::egui::Color32::from_rgb(72, 176, 112),
                    format!("Included note: {target}"),
                );
                if let Some(text) = node
                    .resolution
                    .slice
                    .as_ref()
                    .and_then(|slice| slice.text.as_deref())
                {
                    let mut end = text.len().min(MAX_TRANSCLUSION_PREVIEW_BYTES);
                    while !text.is_char_boundary(end) {
                        end -= 1;
                    }
                    show_markdown_preview(ui, markdown_cache, math_renderer_cache, &text[..end]);
                    if end < text.len() {
                        ui.small("Transcluded text preview shortened to 16 KiB.");
                    }
                }
            }
            VaultNoteEmbedDisposition::Attachment(image) => {
                let target = node
                    .resolution
                    .resolution
                    .target
                    .as_deref()
                    .unwrap_or("vault image attachment");
                ui.small(format!("Vault image: {target}"));
                show_inline_image(
                    ui,
                    image,
                    inline_image_alt_text(reference.alias.as_deref()),
                    inline_image_textures,
                );
            }
            VaultNoteEmbedDisposition::NotRendered => {
                let is_attachment = node
                    .resolution
                    .resolution
                    .target
                    .as_deref()
                    .is_some_and(|target| {
                        !Path::new(target)
                            .extension()
                            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
                    });
                let message = if is_attachment {
                    "Not rendered: this attachment type or size is outside the safe image preview limits."
                } else {
                    match node.resolution.resolution.status {
                        LinkResolutionStatus::Resolved => {
                            "Not rendered: the selected heading or block could not be resolved."
                        }
                        LinkResolutionStatus::Unresolved => {
                            "Not rendered: no matching Markdown note or vault attachment was found."
                        }
                        LinkResolutionStatus::Ambiguous => {
                            "Not rendered: multiple vault files match this embed."
                        }
                        LinkResolutionStatus::External => {
                            "Not rendered: external targets are not opened in this preview."
                        }
                    }
                };
                ui.colored_label(
                    eframe::egui::Color32::YELLOW,
                    format!("{message} {}", reference.raw),
                );
            }
            VaultNoteEmbedDisposition::Blocked(TransclusionBlockReason::Cycle) => {
                ui.colored_label(
                    eframe::egui::Color32::YELLOW,
                    format!(
                        "Not rendered: this embed would create a cycle. {}",
                        reference.raw
                    ),
                );
            }
            VaultNoteEmbedDisposition::Blocked(TransclusionBlockReason::Depth) => {
                ui.colored_label(
                    eframe::egui::Color32::YELLOW,
                    format!(
                        "Not rendered: the maximum note embed depth was reached. {}",
                        reference.raw
                    ),
                );
            }
        }
        if node.omitted_children {
            ui.small("Nested embeds were omitted to keep this preview bounded.");
        }
        for child in &node.children {
            show_note_embed_node(
                ui,
                child,
                markdown_cache,
                math_renderer_cache,
                inline_image_textures,
            );
        }
    });
}

fn show_inline_image(
    ui: &mut eframe::egui::Ui,
    image: &VaultInlineImage,
    alt_text: String,
    textures: &mut HashMap<String, eframe::egui::TextureHandle>,
) {
    let Some(expected_bytes) = u64::from(image.width)
        .checked_mul(u64::from(image.height))
        .and_then(|pixels| pixels.checked_mul(4))
        .and_then(|bytes| usize::try_from(bytes).ok())
    else {
        ui.small("Not rendered: this vault image has invalid pixel dimensions.");
        return;
    };
    if image.width == 0 || image.height == 0 || image.rgba_bytes.len() != expected_bytes {
        ui.small("Not rendered: this vault image has invalid pixel data.");
        return;
    }
    let texture = textures
        .entry(image.revision_sha256.clone())
        .or_insert_with(|| {
            ui.ctx().load_texture(
                format!("vault-image-{}", image.revision_sha256),
                eframe::egui::ColorImage::from_rgba_unmultiplied(
                    [image.width as usize, image.height as usize],
                    &image.rgba_bytes,
                ),
                eframe::egui::TextureOptions::LINEAR,
            )
        })
        .clone();
    let scale = (640.0 / image.width as f32)
        .min(480.0 / image.height as f32)
        .min(1.0);
    let size = eframe::egui::vec2(image.width as f32 * scale, image.height as f32 * scale);
    ui.add(
        eframe::egui::Image::new(&texture)
            .fit_to_exact_size(size)
            .alt_text(alt_text),
    );
}

fn inline_image_alt_text(alias: Option<&str>) -> String {
    alias
        .map(str::trim)
        .filter(|alias| {
            !alias.is_empty()
                && !alias.split_once('x').is_some_and(|(width, height)| {
                    !width.is_empty()
                        && !height.is_empty()
                        && width.chars().all(|character| character.is_ascii_digit())
                        && height.chars().all(|character| character.is_ascii_digit())
                })
        })
        .unwrap_or("Vault image attachment")
        .to_owned()
}

fn link_resolution_status_label(status: LinkResolutionStatus) -> &'static str {
    match status {
        LinkResolutionStatus::Resolved => "Resolved",
        LinkResolutionStatus::Unresolved => "Unresolved",
        LinkResolutionStatus::Ambiguous => "Ambiguous",
        LinkResolutionStatus::External => "External",
    }
}

fn link_kind_label(kind: LinkKind) -> &'static str {
    match kind {
        LinkKind::WikiLink => "Wiki link",
        LinkKind::Markdown => "Markdown link",
        LinkKind::Embed => "Embed",
    }
}

fn link_status_color(status: LinkResolutionStatus) -> eframe::egui::Color32 {
    match status {
        LinkResolutionStatus::Resolved => eframe::egui::Color32::from_rgb(72, 176, 112),
        LinkResolutionStatus::Unresolved => eframe::egui::Color32::from_rgb(224, 96, 96),
        LinkResolutionStatus::Ambiguous => eframe::egui::Color32::YELLOW,
        LinkResolutionStatus::External => eframe::egui::Color32::from_rgb(120, 170, 220),
    }
}

fn uninstall_cleanup_summary(selection: UninstallCleanupSelection) -> String {
    let mut selected = Vec::new();
    if selection.app_cache {
        selected.push("App cache");
    }
    if selection.credentials {
        selected.push("Stored credentials");
    }
    if selection.recovery_history {
        selected.push("Recovery history");
    }

    if selected.is_empty() {
        "No local cleanup selected; the vault remains preserved.".to_owned()
    } else {
        format!(
            "Selected local cleanup: {}. The vault remains preserved.",
            selected.join(", ")
        )
    }
}

fn history_kind_label(kind: VaultHistoryKind) -> &'static str {
    match kind {
        VaultHistoryKind::Recovery => "Recovery",
        VaultHistoryKind::Failed => "Failed write",
        VaultHistoryKind::Conflict => "Unresolved conflict",
    }
}

fn history_age_label(captured_at: SystemTime) -> String {
    match SystemTime::now().duration_since(captured_at) {
        Ok(age) if age.as_secs() >= 24 * 60 * 60 => {
            format!("{}d ago", age.as_secs() / (24 * 60 * 60))
        }
        Ok(age) if age.as_secs() >= 60 * 60 => format!("{}h ago", age.as_secs() / (60 * 60)),
        Ok(age) if age.as_secs() >= 60 => format!("{}m ago", age.as_secs() / 60),
        Ok(age) => format!("{}s ago", age.as_secs()),
        Err(_) => "captured in the future".to_owned(),
    }
}

fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KiB", "MiB", "GiB", "TiB"];
    let mut amount = bytes as f64;
    let mut unit = 0;
    while amount >= 1024.0 && unit < UNITS.len() - 1 {
        amount /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{amount:.1} {}", UNITS[unit])
    }
}

fn storage_protection_label(status: StorageProtectionDisplayStatus) -> &'static str {
    match status {
        StorageProtectionDisplayStatus::Enabled => "Enabled (OS reported)",
        StorageProtectionDisplayStatus::Disabled => "Disabled (OS reported)",
        StorageProtectionDisplayStatus::Unknown => "Unknown (encryption not verified)",
    }
}

fn rename_recovery_summary(report: &VaultRenameRecoveryReport) -> Option<String> {
    let recovered = report.recovered_operations.len();
    let needs_attention = report.needs_attention.len();
    match (recovered, needs_attention) {
        (0, 0) => None,
        (recovered, 0) => Some(format!(
            "Recovered {recovered} interrupted rename operation(s) before loading notes."
        )),
        (0, needs_attention) => Some(format!(
            "{needs_attention} interrupted rename operation(s) need attention."
        )),
        (recovered, needs_attention) => Some(format!(
            "Recovered {recovered} interrupted rename operation(s); {needs_attention} additional operation(s) need attention."
        )),
    }
}

fn write_recovery_summary(report: &VaultWriteRecoveryReport) -> Option<String> {
    let recovered = report.recovered_operations.len();
    let needs_attention = report.needs_attention.len();
    match (recovered, needs_attention) {
        (0, 0) => None,
        (recovered, 0) => Some(format!(
            "Recovered {recovered} interrupted write operation(s) before loading notes."
        )),
        (0, needs_attention) => Some(format!(
            "{needs_attention} interrupted write operation(s) need attention."
        )),
        (recovered, needs_attention) => Some(format!(
            "Recovered {recovered} interrupted write operation(s); {needs_attention} additional operation(s) need attention."
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use egui_kittest::{Harness, kittest::Queryable as _};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};

    static NEXT_UI_TEMP_DIR_ID: AtomicU64 = AtomicU64::new(0);

    struct UiTempDir(PathBuf);

    impl UiTempDir {
        fn new() -> Self {
            let temp_root = std::env::temp_dir();
            loop {
                let id = NEXT_UI_TEMP_DIR_ID.fetch_add(1, Ordering::Relaxed);
                let path = temp_root.join(format!(
                    "openobsidian-ui-rename-{}-{id}",
                    std::process::id()
                ));
                match std::fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("creating test directory {}: {error}", path.display()),
                }
            }
        }
    }

    impl Drop for UiTempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn materialize_existing_vault_fixture(root: &Path, fixture: &serde_json::Value) {
        for file in fixture["files"]
            .as_array()
            .expect("fixture files must be an array")
        {
            let relative_path = PathBuf::from(
                file["relative_path"]
                    .as_str()
                    .expect("fixture file must have a relative path"),
            );
            assert!(
                relative_path.is_relative(),
                "fixture paths must be relative"
            );
            assert!(
                relative_path
                    .components()
                    .all(|component| !matches!(component, std::path::Component::ParentDir)),
                "fixture paths must remain inside the selected folder"
            );
            let bytes = if let Some(source) = file["source"].as_str() {
                source.as_bytes().to_vec()
            } else {
                file["bytes"]
                    .as_array()
                    .expect("binary fixture file must contain byte values")
                    .iter()
                    .map(|byte| {
                        u8::try_from(
                            byte.as_u64()
                                .expect("binary fixture values must be unsigned"),
                        )
                        .expect("binary fixture values must fit in one byte")
                    })
                    .collect()
            };
            let path = root.join(relative_path);
            std::fs::create_dir_all(path.parent().expect("fixture file must have a parent"))
                .expect("create fixture file parents");
            std::fs::write(path, bytes).expect("write fixture bytes");
        }
    }

    fn task_preview_test_app(
        vault_path: &Path,
        app_data_path: &Path,
        source: &[u8],
    ) -> OpenObsidianApp {
        std::fs::create_dir_all(vault_path).expect("create task-preview vault");
        std::fs::create_dir_all(app_data_path).expect("create task-preview app data");
        std::fs::write(vault_path.join("Tasks.md"), source).expect("write task-preview note");
        let session =
            VaultSession::open(vault_path, app_data_path).expect("open task-preview vault");
        let preview = session
            .read_preview("Tasks.md")
            .expect("read bounded task-preview source");
        let text = std::str::from_utf8(preview.source.as_bytes())
            .expect("task-preview source must be valid UTF-8")
            .to_owned();
        OpenObsidianApp {
            session: Some(Arc::new(session)),
            note_source_preview: Some(NoteSourcePreview {
                relative_path: PathBuf::from("Tasks.md"),
                text,
                source_draft: None,
                total_size_bytes: preview.total_size_bytes,
                truncated: preview.truncated,
                revision_sha256: preview.revision_sha256,
            }),
            ..OpenObsidianApp::default()
        }
    }

    fn existing_vault_tree_snapshot(root: &Path) -> Vec<(PathBuf, u8, Vec<u8>)> {
        fn collect(root: &Path, directory: &Path, entries: &mut Vec<(PathBuf, u8, Vec<u8>)>) {
            for entry in std::fs::read_dir(directory).expect("read fixture directory") {
                let entry = entry.expect("read fixture directory entry");
                let path = entry.path();
                let relative_path = path
                    .strip_prefix(root)
                    .expect("fixture entry must remain beneath its root")
                    .to_path_buf();
                let file_type = entry.file_type().expect("inspect fixture entry type");
                if file_type.is_dir() {
                    entries.push((relative_path, 0, Vec::new()));
                    collect(root, &path, entries);
                } else if file_type.is_file() {
                    entries.push((
                        relative_path,
                        1,
                        std::fs::read(path).expect("read fixture file bytes"),
                    ));
                } else if file_type.is_symlink() {
                    entries.push((
                        relative_path,
                        2,
                        std::fs::read_link(path)
                            .expect("read fixture symlink target")
                            .to_string_lossy()
                            .as_bytes()
                            .to_vec(),
                    ));
                } else {
                    panic!("fixture contains an unsupported filesystem entry");
                }
            }
        }

        let mut entries = Vec::new();
        collect(root, root, &mut entries);
        entries.sort_by(|left, right| left.0.cmp(&right.0));
        entries
    }

    fn wait_for_rename(harness: &mut Harness<'_, OpenObsidianApp>) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            harness.step();
            if harness.state().rename_receiver.is_none() {
                return;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "rename worker did not finish within five seconds"
            );
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
    }

    fn wait_for_links(harness: &mut Harness<'_, OpenObsidianApp>) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            harness.step();
            if harness.state().link_receiver.is_none() {
                return;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "link resolver worker did not finish within five seconds"
            );
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
    }

    fn wait_for_note_preview(harness: &mut Harness<'_, OpenObsidianApp>) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            harness.step();
            if harness.state().note_preview_receiver.is_none() {
                return;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "note preview worker did not finish within five seconds"
            );
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
    }

    fn wait_for_note_preview_write(harness: &mut Harness<'_, OpenObsidianApp>) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            harness.step();
            if harness.state().note_preview_write_receiver.is_none() {
                return;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "note preview write did not finish within five seconds"
            );
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
    }

    fn click_first_task_checkbox(harness: &Harness<'_, OpenObsidianApp>) {
        harness
            .query_all_by_role(eframe::egui::accesskit::Role::CheckBox)
            .next()
            .expect("task preview should render at least one task checkbox")
            .click();
    }

    fn wait_for_vault_refresh(harness: &mut Harness<'_, OpenObsidianApp>) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            harness.step();
            if harness.state().vault_refresh_receiver.is_none() {
                return;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "vault refresh worker did not finish within five seconds"
            );
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
    }

    fn wait_for_history(harness: &mut Harness<'_, OpenObsidianApp>) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            harness.step();
            if harness.state().history_receiver.is_none() {
                return;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "history worker did not finish within five seconds"
            );
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
    }

    #[test]
    fn egui_shows_original_source_and_reason_for_unsupported_markdown_preview() {
        let source = "<script>unsafe()</script>";
        let mut markdown_cache = CommonMarkCache::default();
        let math_renderer_cache = Rc::new(RefCell::new(MathRendererCache::default()));
        let mut harness = Harness::new_ui_state(
            |ui, _app| show_markdown_preview(ui, &mut markdown_cache, &math_renderer_cache, source),
            OpenObsidianApp::default(),
        );

        harness.step();
        harness.get_by_label("Unsupported Markdown (raw HTML); showing the source as written.");
        harness.get_by_label(source);
    }

    #[test]
    fn egui_renders_markdown_footnotes_without_source_fallback() {
        let source = "A footnote reference[^one].\n\n[^one]: The original footnote body.";
        assert_eq!(
            analyze_markdown_preview(source).disposition(),
            MarkdownPreviewDisposition::RenderMarkdown
        );

        let mut markdown_cache = CommonMarkCache::default();
        let math_renderer_cache = Rc::new(RefCell::new(MathRendererCache::default()));
        let mut harness = Harness::new_ui_state(
            |ui, _app| show_markdown_preview(ui, &mut markdown_cache, &math_renderer_cache, source),
            OpenObsidianApp::default(),
        );

        harness.step();
        harness.get_by_label("A footnote reference");
        harness.get_by_label("The original footnote body.");
    }

    #[test]
    fn egui_renders_markdown_tables_without_source_fallback() {
        let source = "| Name | Value |\n| --- | ---: |\n| note | 3 |";
        let original = source.as_bytes().to_vec();
        assert_eq!(
            analyze_markdown_preview(source).disposition(),
            MarkdownPreviewDisposition::RenderMarkdown
        );

        let mut markdown_cache = CommonMarkCache::default();
        let math_renderer_cache = Rc::new(RefCell::new(MathRendererCache::default()));
        let mut harness = Harness::new_ui_state(
            |ui, _app| show_markdown_preview(ui, &mut markdown_cache, &math_renderer_cache, source),
            OpenObsidianApp::default(),
        );

        harness.step();
        harness.get_by_label("Name");
        harness.get_by_label("Value");
        harness.get_by_label("note");
        harness.get_by_label("3");
        assert_eq!(source.as_bytes(), original.as_slice());
    }

    #[test]
    fn egui_renders_inline_and_display_math_through_the_preview_callback() {
        let source = "Inline $a + b$ and a display formula:\n\n$$\n\\frac{1}{2}\n$$";
        assert_eq!(
            analyze_markdown_preview(source).disposition(),
            MarkdownPreviewDisposition::RenderMarkdown
        );

        let mut markdown_cache = CommonMarkCache::default();
        let math_renderer_cache = Rc::new(RefCell::new(MathRendererCache::default()));
        let mut harness = Harness::new_ui_state(
            |ui, _app| show_markdown_preview(ui, &mut markdown_cache, &math_renderer_cache, source),
            OpenObsidianApp::default(),
        );

        harness.step();
        harness.get_by_label("Rendered math formula: a + b");
        harness.get_by_label("Rendered math formula: \n\\frac{1}{2}\n");
    }

    #[test]
    fn egui_math_renderer_errors_show_the_formula_source_and_keep_markdown_visible() {
        let expression = r"\begin{tikzpicture}\draw (0,0) -- (1,1);\end{tikzpicture}";
        let source = format!("Before the formula:\n\n$$\n{expression}\n$$\n\nAfter the formula.");
        let mut markdown_cache = CommonMarkCache::default();
        let math_renderer_cache = Rc::new(RefCell::new(MathRendererCache::default()));
        let mut harness = Harness::new_ui_state(
            |ui, _app| {
                show_markdown_preview(ui, &mut markdown_cache, &math_renderer_cache, &source)
            },
            OpenObsidianApp::default(),
        );

        harness.step();
        harness.get_by_label("Math rendering failed or exceeded image limits; showing the source.");
        harness.get_by_label(&format!("$$\n\n{expression}\n\n$$"));
        harness.get_by_label("Before the formula:");
        harness.get_by_label("After the formula.");
    }

    #[test]
    fn egui_math_preview_bounds_expression_size_and_per_pass_formula_count() {
        let oversized = format!("${}$", "x".repeat(513));
        let mut markdown_cache = CommonMarkCache::default();
        let math_renderer_cache = Rc::new(RefCell::new(MathRendererCache::default()));
        let mut oversized_harness = Harness::new_ui_state(
            |ui, _app| {
                show_markdown_preview(ui, &mut markdown_cache, &math_renderer_cache, &oversized)
            },
            OpenObsidianApp::default(),
        );
        oversized_harness.step();
        oversized_harness.get_by_label(
            "Math expression exceeds the preview size or nesting limit; showing the source.",
        );
        drop(oversized_harness);

        let source = (0..33)
            .map(|index| format!("$x_{{{index}}}$"))
            .collect::<Vec<_>>()
            .join(" ");
        let mut markdown_cache = CommonMarkCache::default();
        let math_renderer_cache = Rc::new(RefCell::new(MathRendererCache::default()));
        let mut count_harness = Harness::new_ui_state(
            |ui, _app| {
                show_markdown_preview(ui, &mut markdown_cache, &math_renderer_cache, &source)
            },
            OpenObsidianApp::default(),
        );
        count_harness.step();
        count_harness
            .get_by_label("Math preview limit reached for this UI pass; showing the source.");
        count_harness.get_by_label("$x_{32}$");
    }

    #[test]
    fn egui_task_checkbox_toggle_saves_only_its_source_marker() {
        let fixture: serde_json::Value = serde_json::from_str(MARKDOWN_DIALECT_FIXTURE)
            .expect("Markdown dialect fixture must be valid JSON");
        let editing = &fixture["task_editing"];
        let source = editing["source"]
            .as_str()
            .expect("task editing fixture must include source");
        let expected = editing["expected_after_toggle"]
            .as_str()
            .expect("task editing fixture must include expected source");
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("vault");
        let app_data_path = temporary.0.join("app-data");
        let app = task_preview_test_app(&vault_path, &app_data_path, source.as_bytes());
        let mut harness = Harness::new_ui_state(
            |ui, app| {
                app.poll_vault_refresh_task(ui);
                app.poll_note_preview_write_task(ui);
                app.show_note_source_preview(ui, false);
            },
            app,
        );

        harness.get_by_label("Note source preview").click();
        harness.step();
        click_first_task_checkbox(&harness);
        harness.step();
        assert!(harness.state().note_preview_write_receiver.is_some());
        wait_for_note_preview_write(&mut harness);

        assert!(harness.state().note_preview_error.is_none());
        assert_eq!(
            harness.state().note_preview_status.as_deref(),
            Some("Task checkbox saved to the vault.")
        );
        assert_eq!(
            std::fs::read(vault_path.join("Tasks.md")).unwrap(),
            expected.as_bytes().to_vec()
        );
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("task preview remains visible after save");
        assert_eq!(preview.text.as_bytes(), expected.as_bytes());
        assert!(preview.revision_sha256.is_some());

        harness.state_mut().start_vault_refresh();
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().note_source_preview.is_some());

        let external_bytes = b"# Later external update\r\n- [ ] Keep this version\r\n";
        std::fs::write(vault_path.join("Tasks.md"), external_bytes)
            .expect("write external note update after saved preview");
        harness.state_mut().start_vault_refresh();
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().note_source_preview.is_none());
    }

    #[test]
    fn egui_task_checkbox_inside_standard_callout_saves_only_its_source_marker() {
        let fixture: serde_json::Value = serde_json::from_str(MARKDOWN_DIALECT_FIXTURE)
            .expect("Markdown dialect fixture must be valid JSON");
        let editing = &fixture["callout_task_editing"];
        let source = editing["source"]
            .as_str()
            .expect("callout task fixture must include source");
        let expected = editing["expected_after_toggle"]
            .as_str()
            .expect("callout task fixture must include expected source");
        assert_eq!(
            analyze_markdown_preview(source).disposition(),
            MarkdownPreviewDisposition::RenderMarkdown
        );

        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("vault");
        let app_data_path = temporary.0.join("app-data");
        let app = task_preview_test_app(&vault_path, &app_data_path, source.as_bytes());
        let mut harness = Harness::new_ui_state(
            |ui, app| {
                app.poll_vault_refresh_task(ui);
                app.poll_note_preview_write_task(ui);
                app.show_note_source_preview(ui, false);
            },
            app,
        );

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Markdown preview");
        click_first_task_checkbox(&harness);
        harness.step();
        wait_for_note_preview_write(&mut harness);

        assert!(harness.state().note_preview_error.is_none());
        assert_eq!(
            harness.state().note_preview_status.as_deref(),
            Some("Task checkbox saved to the vault.")
        );
        assert_eq!(
            std::fs::read(vault_path.join("Tasks.md")).unwrap(),
            expected.as_bytes().to_vec()
        );
        assert_eq!(
            harness
                .state()
                .note_source_preview
                .as_ref()
                .expect("callout task preview remains visible after save")
                .text
                .as_bytes(),
            expected.as_bytes()
        );
    }

    #[test]
    fn egui_source_edit_saves_exact_bom_crlf_and_unsupported_markdown_bytes() {
        let fixture: serde_json::Value = serde_json::from_str(MARKDOWN_DIALECT_FIXTURE)
            .expect("Markdown dialect fixture must be valid JSON");
        let editing = &fixture["source_editing"];
        let source = editing["source"]
            .as_str()
            .expect("source editing fixture must include source");
        let expected = editing["expected_after_edit"]
            .as_str()
            .expect("source editing fixture must include expected source");
        assert_eq!(
            analyze_markdown_preview(source).disposition(),
            MarkdownPreviewDisposition::ShowSource
        );

        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("vault");
        let app_data_path = temporary.0.join("app-data");
        let app = task_preview_test_app(&vault_path, &app_data_path, source.as_bytes());
        let mut harness = Harness::new_ui_state(
            |ui, app| {
                app.poll_vault_refresh_task(ui);
                app.poll_note_preview_write_task(ui);
                app.show_note_source_preview(ui, false);
            },
            app,
        );

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Edit Markdown source").click();
        harness.step();
        assert_eq!(
            harness
                .state()
                .note_source_preview
                .as_ref()
                .and_then(|preview| preview.source_draft.as_deref()),
            Some(source)
        );
        harness
            .state_mut()
            .note_source_preview
            .as_mut()
            .expect("source preview remains visible while editing")
            .source_draft = Some(expected.to_owned());
        harness.step();
        assert_eq!(
            harness
                .state()
                .note_source_preview
                .as_ref()
                .and_then(|preview| preview.source_draft.as_deref()),
            Some(expected)
        );
        harness.get_by_label("Save source edits").click();
        harness.step();
        assert!(harness.state().note_preview_write_receiver.is_some());
        wait_for_note_preview_write(&mut harness);

        assert!(harness.state().note_preview_error.is_none());
        assert_eq!(
            harness.state().note_preview_status.as_deref(),
            Some("Markdown source edits saved to the vault.")
        );
        assert_eq!(
            std::fs::read(vault_path.join("Tasks.md")).unwrap(),
            expected.as_bytes().to_vec()
        );
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("source preview remains visible after save");
        assert_eq!(preview.text.as_bytes(), expected.as_bytes());
        assert!(preview.revision_sha256.is_some());
        assert!(preview.source_draft.is_none());

        harness.state_mut().start_vault_refresh();
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().note_source_preview.is_some());

        let external_bytes = b"# Later external source\r\n- [ ] Keep this version\r\n";
        std::fs::write(vault_path.join("Tasks.md"), external_bytes)
            .expect("write external note update after source edit");
        harness.state_mut().start_vault_refresh();
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().note_source_preview.is_none());
    }

    #[test]
    fn egui_source_edit_saves_a_table_cell_without_normalizing_markdown() {
        let fixture: serde_json::Value = serde_json::from_str(MARKDOWN_DIALECT_FIXTURE)
            .expect("Markdown dialect fixture must be valid JSON");
        let editing = &fixture["table_editing"];
        let source = editing["source"]
            .as_str()
            .expect("table editing fixture must include source");
        let expected = editing["expected_after_edit"]
            .as_str()
            .expect("table editing fixture must include expected source");
        assert_eq!(editing["preserves_bom_crlf_and_table_delimiters"], true);
        assert_eq!(
            analyze_markdown_preview(source).disposition(),
            MarkdownPreviewDisposition::RenderMarkdown
        );

        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("vault");
        let app_data_path = temporary.0.join("app-data");
        let app = task_preview_test_app(&vault_path, &app_data_path, source.as_bytes());
        let mut harness = Harness::new_ui_state(
            |ui, app| {
                app.poll_vault_refresh_task(ui);
                app.poll_note_preview_write_task(ui);
                app.show_note_source_preview(ui, false);
            },
            app,
        );

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Markdown preview");
        harness.get_by_label("Name");
        harness.get_by_label("Value");
        harness.get_by_label("before");
        harness.get_by_label("Edit Markdown source").click();
        harness.step();
        assert_eq!(
            harness
                .state()
                .note_source_preview
                .as_ref()
                .and_then(|preview| preview.source_draft.as_deref()),
            Some(source)
        );
        harness
            .state_mut()
            .note_source_preview
            .as_mut()
            .expect("source preview remains visible while editing the table")
            .source_draft = Some(expected.to_owned());
        harness.step();
        harness.get_by_label("Save source edits").click();
        harness.step();
        wait_for_note_preview_write(&mut harness);

        assert!(harness.state().note_preview_error.is_none());
        assert_eq!(
            harness.state().note_preview_status.as_deref(),
            Some("Markdown source edits saved to the vault.")
        );
        assert_eq!(
            std::fs::read(vault_path.join("Tasks.md")).unwrap(),
            expected.as_bytes().to_vec()
        );
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("table preview remains visible after save");
        assert_eq!(preview.text.as_bytes(), expected.as_bytes());
        assert!(preview.revision_sha256.is_some());
        assert!(preview.source_draft.is_none());
        harness.get_by_label("after");
    }

    #[test]
    fn egui_stale_source_edit_preserves_external_note_and_disables_retry() {
        let fixture: serde_json::Value = serde_json::from_str(MARKDOWN_DIALECT_FIXTURE)
            .expect("Markdown dialect fixture must be valid JSON");
        let editing = &fixture["source_editing"];
        let source = editing["source"]
            .as_str()
            .expect("source editing fixture must include source");
        let expected = editing["expected_after_edit"]
            .as_str()
            .expect("source editing fixture must include expected source");
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("vault");
        let app_data_path = temporary.0.join("app-data");
        let app = task_preview_test_app(&vault_path, &app_data_path, source.as_bytes());
        let mut harness = Harness::new_ui_state(
            |ui, app| {
                app.poll_note_preview_write_task(ui);
                app.show_note_source_preview(ui, false);
            },
            app,
        );

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Edit Markdown source").click();
        harness.step();
        harness
            .state_mut()
            .note_source_preview
            .as_mut()
            .expect("source preview remains visible while editing")
            .source_draft = Some(expected.to_owned());
        harness.step();

        let external_bytes = b"# External update\r\nKeep this version.\r\n";
        std::fs::write(vault_path.join("Tasks.md"), external_bytes)
            .expect("write external note update after source preview");
        harness.get_by_label("Save source edits").click();
        harness.step();
        wait_for_note_preview_write(&mut harness);

        assert_eq!(
            std::fs::read(vault_path.join("Tasks.md")).unwrap(),
            external_bytes.to_vec()
        );
        assert!(
            harness
                .state()
                .note_preview_error
                .as_deref()
                .is_some_and(|error| {
                    error.contains("source edit was preserved in conflict recovery history")
                })
        );
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("failed source draft stays visible");
        assert_eq!(preview.text.as_bytes(), expected.as_bytes());
        assert!(preview.revision_sha256.is_none());
        assert!(preview.source_draft.is_none());
    }

    #[test]
    fn egui_keeps_task_checkbox_read_only_for_unsupported_markdown() {
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("vault");
        let app_data_path = temporary.0.join("app-data");
        let source = b"<script>unsafe()</script>\n\n- [ ] Keep this source-only task\n";
        let app = task_preview_test_app(&vault_path, &app_data_path, source);
        let mut harness = Harness::new_ui_state(
            |ui, app| {
                app.poll_note_preview_write_task(ui);
                app.show_note_source_preview(ui, false);
            },
            app,
        );

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Unsupported Markdown (raw HTML); showing the source as written.");
        assert!(
            harness
                .query_by_role(eframe::egui::accesskit::Role::CheckBox)
                .is_none()
        );
        assert_eq!(std::fs::read(vault_path.join("Tasks.md")).unwrap(), source);
    }

    #[test]
    fn egui_keeps_task_checkbox_read_only_for_truncated_note_previews() {
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("vault");
        let app_data_path = temporary.0.join("app-data");
        let source = format!(
            "- [ ] Keep this bounded task read-only\r\n{}",
            "x".repeat(MAX_NOTE_SOURCE_PREVIEW_BYTES)
        );
        let app = task_preview_test_app(&vault_path, &app_data_path, source.as_bytes());
        assert!(
            app.note_source_preview
                .as_ref()
                .is_some_and(|preview| preview.truncated && preview.revision_sha256.is_none())
        );
        let mut harness = Harness::new_ui_state(
            |ui, app| {
                app.poll_note_preview_write_task(ui);
                app.show_note_source_preview(ui, false);
            },
            app,
        );

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("This truncated preview is read-only.");
        assert!(harness.query_by_label("Edit Markdown source").is_none());
        assert!(
            harness
                .query_by_role(eframe::egui::accesskit::Role::CheckBox)
                .is_none()
        );
        assert_eq!(
            std::fs::read(vault_path.join("Tasks.md")).unwrap(),
            source.as_bytes().to_vec()
        );
    }

    #[test]
    fn egui_stale_task_checkbox_write_preserves_the_external_note_version() {
        let fixture: serde_json::Value = serde_json::from_str(MARKDOWN_DIALECT_FIXTURE)
            .expect("Markdown dialect fixture must be valid JSON");
        let source = fixture["task_editing"]["source"]
            .as_str()
            .expect("task editing fixture must include source");
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("vault");
        let app_data_path = temporary.0.join("app-data");
        let app = task_preview_test_app(&vault_path, &app_data_path, source.as_bytes());
        let external_bytes = b"# External update\r\n- [ ] Keep the external version\r\n";
        std::fs::write(vault_path.join("Tasks.md"), external_bytes)
            .expect("write external note update after preview");
        let mut harness = Harness::new_ui_state(
            |ui, app| {
                app.poll_note_preview_write_task(ui);
                app.show_note_source_preview(ui, false);
            },
            app,
        );

        harness.get_by_label("Note source preview").click();
        harness.step();
        click_first_task_checkbox(&harness);
        harness.step();
        wait_for_note_preview_write(&mut harness);

        assert_eq!(
            std::fs::read(vault_path.join("Tasks.md")).unwrap(),
            external_bytes.to_vec()
        );
        assert!(
            harness
                .state()
                .note_preview_error
                .as_deref()
                .is_some_and(|error| error.contains("note changed after this preview"))
        );
        assert!(
            harness
                .state()
                .note_source_preview
                .as_ref()
                .is_some_and(|preview| preview.revision_sha256.is_none())
        );
    }

    #[test]
    fn egui_opens_an_existing_vault_in_place_without_changing_its_tree() {
        let fixture: serde_json::Value = serde_json::from_str(EXISTING_VAULT_FIXTURE)
            .expect("existing-vault fixture must be valid JSON");
        assert_eq!(fixture["schema_version"], 1);
        assert_eq!(fixture["id"], "fixture:existing-vault");
        assert_eq!(
            fixture["invariants"]["opens_existing_directory_in_place"],
            true
        );
        assert_eq!(
            fixture["invariants"]["requires_import_or_conversion"],
            false
        );
        assert_eq!(
            fixture["invariants"]["preserves_unknown_paths_and_binary_bytes"],
            true
        );
        assert_eq!(
            fixture["invariants"]["read_only_open_preserves_vault_tree"],
            true
        );
        assert_eq!(
            fixture["invariants"]["app_state_is_outside_the_vault"],
            true
        );
        assert_eq!(fixture["invariants"]["note_revisions_use_sha256"], true);

        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(&vault_path).expect("create existing vault directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        materialize_existing_vault_fixture(&vault_path, &fixture);

        let before = existing_vault_tree_snapshot(&vault_path);
        let before_paths = before
            .iter()
            .map(|(path, _, _)| path.to_string_lossy().replace('\\', "/"))
            .collect::<Vec<_>>();
        let expected_paths = fixture["expected"]["tree_paths"]
            .as_array()
            .expect("fixture must list every original path")
            .iter()
            .map(|path| {
                path.as_str()
                    .expect("fixture paths must be text")
                    .to_owned()
            })
            .collect::<Vec<_>>();
        assert_eq!(before_paths, expected_paths);

        let canonical_vault = std::fs::canonicalize(&vault_path).expect("canonicalize vault path");
        let canonical_app_data =
            std::fs::canonicalize(&app_data_path).expect("canonicalize app-data path");
        assert!(!canonical_app_data.starts_with(&canonical_vault));
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open selected existing folder directly");
        assert_eq!(session.root_path(), canonical_vault);

        let markdown_paths = session
            .entries()
            .iter()
            .map(|entry| entry.relative_path.to_string_lossy().replace('\\', "/"))
            .collect::<Vec<_>>();
        let expected_markdown_paths = fixture["expected"]["markdown_paths"]
            .as_array()
            .expect("fixture must list Markdown entries")
            .iter()
            .map(|path| {
                path.as_str()
                    .expect("Markdown paths must be text")
                    .to_owned()
            })
            .collect::<Vec<_>>();
        assert_eq!(markdown_paths, expected_markdown_paths);

        let revision_path = fixture["expected"]["revision_path"]
            .as_str()
            .expect("fixture must identify a note for revision checking");
        let expected_source = fixture["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|file| file["relative_path"] == revision_path)
            .and_then(|file| file["source"].as_str())
            .expect("revision fixture file must have a text source");
        let read = session
            .read(revision_path)
            .expect("read selected note without conversion");
        assert_eq!(read.document.as_bytes(), expected_source.as_bytes());
        assert_eq!(
            read.revision_sha256,
            fixture["expected"]["revision_sha256"]
                .as_str()
                .expect("fixture must state the SHA-256 revision")
        );

        let selected_vault = vault_path.clone();
        let selected_app_data = app_data_path.clone();
        let app = OpenObsidianApp {
            open_vault_action: Some(Box::new(move || {
                let (sender, receiver) = std::sync::mpsc::channel();
                let result = VaultSession::open(&selected_vault, &selected_app_data)
                    .map_err(|_| "The selected vault could not be opened safely.".to_owned());
                sender
                    .send(result)
                    .expect("UI must receive the selected vault session");
                Some(receiver)
            })),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);
        harness.get_by_label("Open vault").click();
        harness.step();
        assert!(harness.state().session.is_some());
        assert!(!harness.state().vault_opening);
        assert!(harness.state().vault_open_error.is_none());
        harness.get_by_label("Vault: Existing Vault");
        harness.get_by_label("2 Markdown files found.");

        drop(harness);
        drop(session);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before);
        assert!(existing_vault_tree_snapshot(&app_data_path).is_empty());
    }

    #[test]
    fn egui_displays_an_existing_vault_session_selected_at_launch_without_changing_its_tree() {
        let fixture: serde_json::Value = serde_json::from_str(EXISTING_VAULT_FIXTURE)
            .expect("existing-vault fixture must be valid JSON");
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(&vault_path).expect("create existing vault directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        materialize_existing_vault_fixture(&vault_path, &fixture);

        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing vault before showing the desktop shell");
        assert_eq!(session.entries().len(), 2);
        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            ..OpenObsidianApp::default()
        };
        let harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);
        harness.get_by_label("Vault: Existing Vault");
        harness.get_by_label("2 Markdown files found.");

        drop(harness);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_reconciles_from_disk_after_a_sleep_or_reconnect_gap() {
        let fixture: serde_json::Value = serde_json::from_str(SYNC_WATCHER_RECOVERY_FIXTURE)
            .expect("watcher recovery fixture must be valid JSON");
        assert_eq!(fixture["fixture_id"], "fixture:sync-watcher-recovery");
        assert!(
            fixture["cases"]
                .as_array()
                .unwrap()
                .iter()
                .any(|case| case["id"] == "sleep")
        );
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Resumed Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(&vault_path).expect("create existing vault directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        std::fs::write(vault_path.join("Before.md"), b"before\n")
            .expect("write initial vault note");

        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open vault before simulating a missed notification interval");
        assert_eq!(session.entries().len(), 1);
        let source_after_resume = b"# Changed while asleep\r\n";
        std::fs::write(vault_path.join("After.md"), source_after_resume)
            .expect("simulate a file appearing while notifications are missed");

        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            vault_watcher: Some(
                VaultWatcher::watch(&vault_path).expect("watch resumed test vault"),
            ),
            next_vault_reconciliation: Some(Instant::now() - Duration::from_secs(1)),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.step();
        assert!(
            harness.state().vault_refresh_receiver.is_some()
                || harness.state().vault_refresh_status.is_some(),
            "periodic reconciliation should be running or already complete"
        );
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().vault_refresh_error.is_none());
        let session = harness
            .state()
            .session
            .as_ref()
            .expect("resumed session remains open");
        assert!(
            session
                .entries()
                .iter()
                .any(|entry| entry.relative_path.as_path() == Path::new("After.md"))
        );
        assert_eq!(
            session.read("After.md").unwrap().document.as_bytes(),
            source_after_resume
        );
    }

    #[test]
    fn egui_reconciles_an_external_note_change_from_the_watcher_without_manual_refresh() {
        let fixture: serde_json::Value = serde_json::from_str(SYNC_WATCHER_RECOVERY_FIXTURE)
            .expect("watcher recovery fixture must be valid JSON");
        assert_eq!(fixture["fixture_id"], "fixture:sync-watcher-recovery");
        assert!(
            fixture["cases"]
                .as_array()
                .unwrap()
                .iter()
                .any(|case| case["id"] == "event")
        );

        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Watched Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(&vault_path).expect("create watched vault directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        std::fs::write(vault_path.join("Before.md"), b"before\n")
            .expect("write initial vault note");

        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open vault before applying an external filesystem change");
        assert_eq!(session.entries().len(), 1);
        let watcher = VaultWatcher::watch(session.root_path()).expect("watch the open test vault");
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            vault_watcher: Some(watcher),
            next_vault_reconciliation: Some(Instant::now() + Duration::from_secs(60)),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);
        harness.step();
        harness.get_by_label("1 Markdown files found.");

        let external_source = b"# Added outside OpenObsidian\r\n";
        std::fs::write(vault_path.join("After.md"), external_source)
            .expect("create a note outside OpenObsidian");
        let expected_vault = existing_vault_tree_snapshot(&vault_path);
        let expected_app_data = existing_vault_tree_snapshot(&app_data_path);
        let expected_status = "Note list refreshed: 2 Markdown files found.";
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            harness.step();
            if harness.state().vault_refresh_status.as_deref() == Some(expected_status) {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "filesystem watcher did not reconcile the external note within fifteen seconds"
            );
            std::thread::sleep(Duration::from_millis(10));
        }

        assert!(harness.state().vault_refresh_error.is_none());
        let session = harness
            .state()
            .session
            .as_ref()
            .expect("watched vault remains open");
        assert_eq!(session.entries().len(), 2);
        assert_eq!(
            session.read("After.md").unwrap().document.as_bytes(),
            external_source
        );
        assert_eq!(existing_vault_tree_snapshot(&vault_path), expected_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            expected_app_data
        );

        drop(harness);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), expected_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            expected_app_data
        );
    }

    #[test]
    fn egui_opens_and_refreshes_an_existing_empty_vault_without_changing_its_tree() {
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Empty Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(vault_path.join(".obsidian"))
            .expect("create existing vault configuration directory");
        std::fs::create_dir_all(vault_path.join("Assets"))
            .expect("create existing vault assets directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        std::fs::write(
            vault_path.join(".obsidian/app.json"),
            b"{\"unknownEmptyVaultOption\":{\"keep\":true}}\n",
        )
        .expect("seed opaque Obsidian configuration");
        std::fs::write(
            vault_path.join("Assets/opaque.bin"),
            [0x00, 0xff, 0x42, 0x80],
        )
        .expect("seed arbitrary binary content");
        std::fs::write(
            vault_path.join("README.txt"),
            b"This is not a Markdown note.\n",
        )
        .expect("seed a non-Markdown text file");

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let canonical_vault = std::fs::canonicalize(&vault_path).expect("canonicalize vault");
        let selected_vault = vault_path.clone();
        let selected_app_data = app_data_path.clone();
        let app = OpenObsidianApp {
            open_vault_action: Some(Box::new(move || {
                let (sender, receiver) = std::sync::mpsc::channel();
                let result = VaultSession::open(&selected_vault, &selected_app_data)
                    .map_err(|_| "The selected vault could not be opened safely.".to_owned());
                sender
                    .send(result)
                    .expect("UI must receive the selected empty vault session");
                Some(receiver)
            })),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Open vault").click();
        harness.step();
        assert!(harness.state().session.is_some());
        assert!(!harness.state().vault_opening);
        assert!(harness.state().vault_open_error.is_none());
        let session = harness
            .state()
            .session
            .as_ref()
            .expect("vault session is open");
        assert_eq!(session.root_path(), canonical_vault);
        assert!(session.entries().is_empty());
        harness.get_by_label("Vault: Existing Empty Vault");
        harness.get_by_label("0 Markdown files found.");
        harness.get_by_label("This vault has no Markdown notes to inspect.");
        harness.get_by_label("This vault has no Markdown notes to rename.");
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Refresh note list").click();
        harness.step();
        assert!(harness.state().vault_refresh_receiver.is_some());
        wait_for_vault_refresh(&mut harness);
        harness.get_by_label("Note list refreshed: 0 Markdown files found.");
        assert!(
            harness
                .state()
                .session
                .as_ref()
                .expect("empty vault remains open after refresh")
                .entries()
                .is_empty()
        );
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_keeps_the_open_vault_unchanged_when_another_selection_cannot_open() {
        let fixture: serde_json::Value = serde_json::from_str(EXISTING_VAULT_FIXTURE)
            .expect("existing-vault fixture must be valid JSON");
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        let unopenable_path = temporary.0.join("Selected File");
        std::fs::create_dir_all(&vault_path).expect("create existing vault directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        materialize_existing_vault_fixture(&vault_path, &fixture);
        std::fs::write(
            &unopenable_path,
            b"This selected path is a file, not a vault.",
        )
        .expect("seed unopenable selected path");

        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing vault before attempting another selection");
        let canonical_vault =
            std::fs::canonicalize(&vault_path).expect("canonicalize current vault");
        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let before_unopenable =
            std::fs::read(&unopenable_path).expect("read selected file before failed open");
        let selected_path = unopenable_path.clone();
        let selected_app_data = app_data_path.clone();
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            open_vault_action: Some(Box::new(move || {
                let (sender, receiver) = std::sync::mpsc::channel();
                let result = VaultSession::open(&selected_path, &selected_app_data)
                    .map_err(|_| "The selected vault could not be opened safely.".to_owned());
                sender
                    .send(result)
                    .expect("UI must receive the failed vault-open result");
                Some(receiver)
            })),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Open vault").click();
        harness.step();
        assert!(!harness.state().vault_opening);
        assert!(harness.state().vault_open_receiver.is_none());
        assert_eq!(
            harness.state().vault_open_error.as_deref(),
            Some("The selected vault could not be opened safely.")
        );
        let session = harness
            .state()
            .session
            .as_ref()
            .expect("the current vault remains open after the failed selection");
        assert_eq!(session.root_path(), canonical_vault);
        assert_eq!(session.entries().len(), 2);
        harness.get_by_label("Vault: Existing Vault");
        harness.get_by_label("2 Markdown files found.");
        harness.get_by_label("The selected vault could not be opened safely.");
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
        assert_eq!(
            std::fs::read(&unopenable_path).expect("failed selection remains untouched"),
            before_unopenable
        );

        drop(harness);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
        assert_eq!(
            std::fs::read(&unopenable_path).expect("failed selection remains untouched"),
            before_unopenable
        );
    }

    #[test]
    fn egui_switches_between_existing_vaults_without_changing_either_tree() {
        let fixture: serde_json::Value = serde_json::from_str(EXISTING_VAULT_FIXTURE)
            .expect("existing-vault fixture must be valid JSON");
        let temporary = UiTempDir::new();
        let first_vault_path = temporary.0.join("First Vault");
        let second_vault_path = temporary.0.join("Second Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(&first_vault_path).expect("create first vault directory");
        std::fs::create_dir_all(&second_vault_path).expect("create second vault directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        materialize_existing_vault_fixture(&first_vault_path, &fixture);
        std::fs::create_dir_all(second_vault_path.join(".obsidian"))
            .expect("create second vault configuration directory");
        std::fs::write(
            second_vault_path.join(".obsidian/app.json"),
            b"{\"unknownSecondVaultOption\":{\"keep\":true}}\n",
        )
        .expect("seed opaque second-vault configuration");
        std::fs::create_dir_all(second_vault_path.join("Assets"))
            .expect("create second vault assets directory");
        std::fs::write(
            second_vault_path.join("Assets/opaque.bin"),
            [0x00, 0xff, 0x42, 0x80],
        )
        .expect("seed second-vault binary asset");
        let second_note_path = std::path::PathBuf::from("Only in Second.md");
        std::fs::write(
            second_vault_path.join(&second_note_path),
            "\u{feff}# Second vault\r\n\r\nThis note belongs only to the second vault.\r\n",
        )
        .expect("seed second-vault note");
        std::fs::write(
            app_data_path.join("open-state.bin"),
            [0xa5, 0x00, 0x7e, 0xff],
        )
        .expect("seed separate app-data sentinel");

        let before_first_vault = existing_vault_tree_snapshot(&first_vault_path);
        let before_second_vault = existing_vault_tree_snapshot(&second_vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let canonical_second_vault =
            std::fs::canonicalize(&second_vault_path).expect("canonicalize second vault");
        let first_session = VaultSession::open(&first_vault_path, &app_data_path)
            .expect("open first vault before switching");
        let old_preview_path = PathBuf::from(
            fixture["expected"]["revision_path"]
                .as_str()
                .expect("fixture must identify a note for preview checking"),
        );
        let selected_vault = second_vault_path.clone();
        let selected_app_data = app_data_path.clone();
        let app = OpenObsidianApp {
            session: Some(Arc::new(first_session)),
            link_source_path: Some(old_preview_path.clone()),
            rename_source_path: Some(old_preview_path),
            open_vault_action: Some(Box::new(move || {
                let (sender, receiver) = std::sync::mpsc::channel();
                let result = VaultSession::open(&selected_vault, &selected_app_data)
                    .map_err(|_| "The selected vault could not be opened safely.".to_owned());
                sender
                    .send(result)
                    .expect("UI must receive the second vault session");
                Some(receiver)
            })),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        assert!(harness.state().note_source_preview.is_some());
        harness.get_by_label("Open vault").click();
        harness.step();

        assert!(!harness.state().vault_opening);
        assert!(harness.state().vault_open_receiver.is_none());
        assert!(harness.state().vault_open_error.is_none());
        let session = harness
            .state()
            .session
            .as_ref()
            .expect("second vault remains open after switching");
        assert_eq!(session.root_path(), canonical_second_vault);
        assert_eq!(session.entries().len(), 1);
        assert_eq!(
            session.entries()[0].relative_path,
            second_note_path,
            "the active note list belongs to the newly selected vault"
        );
        assert_eq!(
            harness.state().link_source_path.as_ref(),
            Some(&second_note_path)
        );
        assert_eq!(
            harness.state().rename_source_path.as_ref(),
            Some(&second_note_path)
        );
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_receiver.is_none());
        assert!(harness.state().note_preview_error.is_none());
        assert!(harness.state().link_resolutions.is_empty());
        harness.get_by_label("Vault: Second Vault");
        harness.get_by_label("1 Markdown files found.");
        assert_eq!(
            existing_vault_tree_snapshot(&first_vault_path),
            before_first_vault
        );
        assert_eq!(
            existing_vault_tree_snapshot(&second_vault_path),
            before_second_vault
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(
            existing_vault_tree_snapshot(&first_vault_path),
            before_first_vault
        );
        assert_eq!(
            existing_vault_tree_snapshot(&second_vault_path),
            before_second_vault
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_previews_existing_note_source_without_changing_its_tree() {
        let fixture: serde_json::Value = serde_json::from_str(EXISTING_VAULT_FIXTURE)
            .expect("existing-vault fixture must be valid JSON");
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(&vault_path).expect("create existing vault directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        materialize_existing_vault_fixture(&vault_path, &fixture);

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let source_path = fixture["expected"]["revision_path"]
            .as_str()
            .expect("fixture must identify a note for preview checking");
        let expected_source = fixture["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|file| file["relative_path"] == source_path)
            .and_then(|file| file["source"].as_str())
            .expect("preview fixture note must have text source");
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open selected existing vault without conversion");
        let expected_revision = session
            .read_preview(source_path)
            .expect("read selected note revision")
            .revision_sha256;
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(PathBuf::from(source_path)),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        assert!(harness.state().note_preview_receiver.is_some());
        wait_for_note_preview(&mut harness);
        assert!(harness.state().note_preview_error.is_none());
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the selected note source should be visible");
        assert_eq!(preview.relative_path, PathBuf::from(source_path));
        assert_eq!(preview.text.as_bytes(), expected_source.as_bytes());
        assert_eq!(preview.total_size_bytes, expected_source.len() as u64);
        assert!(!preview.truncated);
        assert_eq!(preview.revision_sha256, expected_revision);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Close source preview").click();
        harness.step();
        assert!(harness.state().note_source_preview.is_none());
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_next_and_previous_note_navigation_wraps_and_clears_previews_without_writes() {
        let fixture: serde_json::Value = serde_json::from_str(EXISTING_VAULT_FIXTURE)
            .expect("existing-vault fixture must be valid JSON");
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(&vault_path).expect("create existing vault directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        materialize_existing_vault_fixture(&vault_path, &fixture);

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let readme_path = PathBuf::from("README.md");
        let welcome_path = PathBuf::from("Notes/Welcome.md");
        let readme_source = fixture["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|file| file["relative_path"] == "README.md")
            .and_then(|file| file["source"].as_str())
            .expect("fixture must include the README source");
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing vault without conversion");
        assert_eq!(session.entries().len(), 2);
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(readme_path.clone()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert_eq!(harness.state().link_resolutions.len(), 2);
        assert!(harness.state().note_embed_report.is_some());

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the selected README source should be visible");
        assert_eq!(preview.relative_path, readme_path);
        assert_eq!(preview.text.as_bytes(), readme_source.as_bytes());

        harness.get_by_label("Next note").click();
        harness.step();
        assert_eq!(
            harness.state().link_source_path.as_ref(),
            Some(&welcome_path)
        );
        assert!(harness.state().link_status.is_none());
        assert!(harness.state().link_resolutions.is_empty());
        assert!(harness.state().note_embed_report.is_none());
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_receiver.is_none());
        assert!(harness.state().note_preview_error.is_none());

        harness.get_by_label("Previous note").click();
        harness.step();
        assert_eq!(
            harness.state().link_source_path.as_ref(),
            Some(&readme_path)
        );
        assert!(harness.state().link_status.is_none());
        assert!(harness.state().link_resolutions.is_empty());
        assert!(harness.state().note_embed_report.is_none());
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_receiver.is_none());
        assert!(harness.state().note_preview_error.is_none());

        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the wrapped README source should be previewable again");
        assert_eq!(preview.relative_path, readme_path);
        assert_eq!(preview.text.as_bytes(), readme_source.as_bytes());
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_note_inspect_combobox_selects_a_note_and_clears_previews_without_writes() {
        let fixture: serde_json::Value = serde_json::from_str(EXISTING_VAULT_FIXTURE)
            .expect("existing-vault fixture must be valid JSON");
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(&vault_path).expect("create existing vault directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        materialize_existing_vault_fixture(&vault_path, &fixture);

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let readme_source = fixture["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|file| file["relative_path"] == "README.md")
            .and_then(|file| file["source"].as_str())
            .expect("fixture must include the README source");
        let welcome_source = fixture["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|file| file["relative_path"] == "Notes/Welcome.md")
            .and_then(|file| file["source"].as_str())
            .expect("fixture must include the welcome note source");
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing vault without conversion");
        let note_path = |file_name: &str| {
            session
                .entries()
                .iter()
                .find(|entry| {
                    entry
                        .relative_path
                        .file_name()
                        .and_then(|name| name.to_str())
                        == Some(file_name)
                })
                .map(|entry| entry.relative_path.clone())
                .expect("existing-vault fixture must include the requested note")
        };
        let readme_path = note_path("README.md");
        let welcome_path = note_path("Welcome.md");
        let welcome_label = welcome_path.display().to_string();
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(readme_path.clone()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert_eq!(harness.state().link_resolutions.len(), 2);
        assert!(harness.state().note_embed_report.is_some());

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the selected README source should be visible");
        assert_eq!(preview.relative_path, readme_path);
        assert_eq!(preview.text.as_bytes(), readme_source.as_bytes());

        harness.get_by_label("Note to inspect").click_accesskit();
        harness.step();
        harness.get_by_label(&welcome_label).click();
        harness.step();
        assert_eq!(
            harness.state().link_source_path.as_ref(),
            Some(&welcome_path)
        );
        assert!(harness.state().link_status.is_none());
        assert!(harness.state().link_resolutions.is_empty());
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().link_receiver.is_none());
        assert!(harness.state().note_embed_report.is_none());
        assert!(harness.state().note_embed_error.is_none());
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_receiver.is_none());
        assert!(harness.state().note_preview_error.is_none());
        assert!(harness.state().inline_image_textures.is_empty());

        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the selected welcome note source should be visible");
        assert_eq!(preview.relative_path, welcome_path);
        assert_eq!(preview.text.as_bytes(), welcome_source.as_bytes());
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_note_inspect_combobox_disambiguates_duplicate_basenames_without_writes() {
        let fixture: serde_json::Value = serde_json::from_str(EXISTING_VAULT_FIXTURE)
            .expect("existing-vault fixture must be valid JSON");
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(&vault_path).expect("create existing vault directory");
        std::fs::create_dir_all(app_data_path.join("state"))
            .expect("create separate app-data directory");
        materialize_existing_vault_fixture(&vault_path, &fixture);

        let archive_welcome_path = vault_path.join("Archive/Welcome.md");
        std::fs::create_dir_all(
            archive_welcome_path
                .parent()
                .expect("duplicate-basename note must have a parent directory"),
        )
        .expect("create duplicate-basename note directory");
        let archive_source = "\u{feff}# Archived welcome\r\n\r\nSame basename, distinct path.\r\n";
        std::fs::write(&archive_welcome_path, archive_source.as_bytes())
            .expect("seed second Welcome.md before the no-op baseline");
        std::fs::write(
            app_data_path.join("state/open-state.bin"),
            [0xa5, 0x00, 0x7e, 0xff],
        )
        .expect("seed separate app-data sentinel");

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let readme_source = fixture["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|file| file["relative_path"] == "README.md")
            .and_then(|file| file["source"].as_str())
            .expect("fixture must include the README source");
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing vault without conversion");
        let note_path = |normalized_path: &str| {
            session
                .entries()
                .iter()
                .find(|entry| {
                    entry.relative_path.to_string_lossy().replace('\\', "/") == normalized_path
                })
                .map(|entry| entry.relative_path.clone())
                .expect("existing-vault fixture must include the requested note")
        };
        let readme_path = note_path("README.md");
        let notes_welcome_path = note_path("Notes/Welcome.md");
        let archive_welcome_path = note_path("Archive/Welcome.md");
        assert_ne!(notes_welcome_path, archive_welcome_path);
        assert_eq!(
            notes_welcome_path.file_name(),
            archive_welcome_path.file_name()
        );
        let notes_welcome_label = notes_welcome_path.display().to_string();
        let archive_welcome_label = archive_welcome_path.display().to_string();
        assert_ne!(notes_welcome_label, archive_welcome_label);
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(readme_path.clone()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Resolve link status").click();
        harness.step();
        wait_for_links(&mut harness);
        assert_eq!(harness.state().link_resolutions.len(), 2);
        assert!(harness.state().note_embed_report.is_some());

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the selected README source should be visible");
        assert_eq!(preview.relative_path, readme_path);
        assert_eq!(preview.text.as_bytes(), readme_source.as_bytes());

        harness.get_by_label("Note to inspect").click_accesskit();
        harness.step();
        harness.get_by_label(&notes_welcome_label);
        harness.get_by_label(&archive_welcome_label).click();
        harness.step();
        assert_eq!(
            harness.state().link_source_path.as_ref(),
            Some(&archive_welcome_path)
        );
        assert!(harness.state().link_status.is_none());
        assert!(harness.state().link_resolutions.is_empty());
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().link_receiver.is_none());
        assert!(harness.state().note_embed_report.is_none());
        assert!(harness.state().note_embed_error.is_none());
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_receiver.is_none());
        assert!(harness.state().note_preview_error.is_none());
        assert!(harness.state().inline_image_textures.is_empty());

        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the selected Archive/Welcome.md source should be visible");
        assert_eq!(preview.relative_path, archive_welcome_path);
        assert_eq!(preview.text.as_bytes(), archive_source.as_bytes());
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_note_inspect_combobox_preserves_unicode_and_spaced_paths_without_writes() {
        let fixture: serde_json::Value = serde_json::from_str(EXISTING_VAULT_FIXTURE)
            .expect("existing-vault fixture must be valid JSON");
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(&vault_path).expect("create existing vault directory");
        std::fs::create_dir_all(app_data_path.join("state"))
            .expect("create separate app-data directory");
        materialize_existing_vault_fixture(&vault_path, &fixture);

        let unicode_note_path = vault_path.join("Guides/日本語 intro.md");
        std::fs::create_dir_all(
            unicode_note_path
                .parent()
                .expect("Unicode note must have a parent directory"),
        )
        .expect("create Unicode note directory");
        let note_source = "\u{feff}# 日本語ガイド\r\n\r\nPath with spaces and Unicode: 日本語.\r\n";
        std::fs::write(&unicode_note_path, note_source.as_bytes())
            .expect("seed Unicode note before the no-op baseline");
        std::fs::write(
            app_data_path.join("state/open-state.bin"),
            [0xa5, 0x00, 0x7e, 0xff],
        )
        .expect("seed separate app-data sentinel");

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let readme_source = fixture["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|file| file["relative_path"] == "README.md")
            .and_then(|file| file["source"].as_str())
            .expect("fixture must include the README source");
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing vault without conversion");
        let note_path = |normalized_path: &str| {
            session
                .entries()
                .iter()
                .find(|entry| {
                    entry.relative_path.to_string_lossy().replace('\\', "/") == normalized_path
                })
                .map(|entry| entry.relative_path.clone())
                .expect("existing-vault fixture must include the requested note")
        };
        let readme_path = note_path("README.md");
        let selected_note_path = note_path("Guides/日本語 intro.md");
        let selected_note_label = selected_note_path.display().to_string();
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(readme_path.clone()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Resolve link status").click();
        harness.step();
        wait_for_links(&mut harness);
        assert_eq!(harness.state().link_resolutions.len(), 2);
        assert!(harness.state().note_embed_report.is_some());

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the selected README source should be visible");
        assert_eq!(preview.relative_path, readme_path);
        assert_eq!(preview.text.as_bytes(), readme_source.as_bytes());

        harness.get_by_label("Note to inspect").click_accesskit();
        harness.step();
        harness.get_by_label(&selected_note_label).click();
        harness.step();
        assert_eq!(
            harness.state().link_source_path.as_ref(),
            Some(&selected_note_path)
        );
        assert!(harness.state().link_status.is_none());
        assert!(harness.state().link_resolutions.is_empty());
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().link_receiver.is_none());
        assert!(harness.state().note_embed_report.is_none());
        assert!(harness.state().note_embed_error.is_none());
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_receiver.is_none());
        assert!(harness.state().note_preview_error.is_none());
        assert!(harness.state().inline_image_textures.is_empty());

        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the selected Unicode note source should be visible");
        assert_eq!(preview.relative_path, selected_note_path);
        assert_eq!(preview.text.as_bytes(), note_source.as_bytes());
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_invalid_utf8_note_preview_fails_closed_without_changing_vault_or_app_data() {
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(&vault_path).expect("create existing vault directory");
        std::fs::create_dir_all(app_data_path.join("state"))
            .expect("create separate app-data directory");
        std::fs::write(
            vault_path.join("README.md"),
            b"\xef\xbb\xbf# Valid note\r\n",
        )
        .expect("seed valid note");
        let invalid_source = b"\xef\xbb\xbf# Invalid byte: \xff\r\n";
        let invalid_note_path = vault_path.join("Notes/Invalid UTF-8.md");
        std::fs::create_dir_all(
            invalid_note_path
                .parent()
                .expect("invalid note must have a parent directory"),
        )
        .expect("create invalid note directory");
        std::fs::write(&invalid_note_path, invalid_source)
            .expect("seed invalid UTF-8 note before the no-op baseline");
        std::fs::write(
            app_data_path.join("state/open-state.bin"),
            [0xa5, 0x00, 0x7e, 0xff],
        )
        .expect("seed separate app-data sentinel");

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing vault containing arbitrary Markdown bytes");
        let selected_note_path = session
            .entries()
            .iter()
            .find(|entry| {
                entry.relative_path.to_string_lossy().replace('\\', "/") == "Notes/Invalid UTF-8.md"
            })
            .map(|entry| entry.relative_path.clone())
            .expect("invalid UTF-8 Markdown path remains available for inspection");
        let selected_note_label = selected_note_path.display().to_string();
        let readme_path = session
            .entries()
            .iter()
            .find(|entry| entry.relative_path == Path::new("README.md"))
            .map(|entry| entry.relative_path.clone())
            .expect("valid README note remains available for inspection");
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(readme_path),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Note to inspect").click_accesskit();
        harness.step();
        harness.get_by_label(&selected_note_label).click();
        harness.step();
        assert_eq!(
            harness.state().link_source_path.as_ref(),
            Some(&selected_note_path)
        );
        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);

        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_receiver.is_none());
        assert!(
            harness
                .state()
                .note_preview_error
                .as_deref()
                .is_some_and(|error| {
                    error.starts_with("The selected note preview contains invalid UTF-8;")
                })
        );
        assert_eq!(
            std::fs::read(&invalid_note_path).expect("read original invalid note bytes"),
            invalid_source
        );
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_refresh_after_external_note_edit_replaces_stale_preview_without_writing() {
        let fixture: serde_json::Value = serde_json::from_str(EXISTING_VAULT_FIXTURE)
            .expect("existing-vault fixture must be valid JSON");
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(&vault_path).expect("create existing vault directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        materialize_existing_vault_fixture(&vault_path, &fixture);

        let source_path = PathBuf::from("Notes/Welcome.md");
        let original_source = fixture["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|file| file["relative_path"] == "Notes/Welcome.md")
            .and_then(|file| file["source"].as_str())
            .expect("fixture must contain the original note source");
        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open selected existing vault without conversion");
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(source_path.clone()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        assert!(harness.state().note_preview_receiver.is_some());
        wait_for_note_preview(&mut harness);
        assert!(harness.state().note_preview_error.is_none());
        let initial_preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the original note preview should be visible");
        assert_eq!(initial_preview.relative_path, source_path);
        assert_eq!(initial_preview.text.as_bytes(), original_source.as_bytes());

        let external_source = concat!(
            "\u{feff}# Updated externally\r\n",
            "The same path changed outside the app. This external replacement is intentionally longer ",
            "so the refreshed UI must read the new file contents.\r\n",
        )
        .as_bytes()
        .to_vec();
        let mut expected_after_external_edit = before_vault.clone();
        let expected_note = expected_after_external_edit
            .iter_mut()
            .find(|(path, _, _)| path == &source_path)
            .expect("expected snapshot must contain the edited note");
        expected_note.2 = external_source.clone();
        std::fs::write(vault_path.join(&source_path), &external_source)
            .expect("simulate an external editor changing the note in place");
        let after_external_edit = existing_vault_tree_snapshot(&vault_path);
        assert_eq!(after_external_edit, expected_after_external_edit);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Refresh note list").click();
        harness.step();
        assert!(harness.state().vault_refresh_receiver.is_some());
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().vault_refresh_error.is_none());
        let session = harness
            .state()
            .session
            .as_ref()
            .expect("the refreshed vault session should remain open");
        assert_eq!(session.entries().len(), 2);
        assert!(
            session
                .entries()
                .iter()
                .any(|entry| entry.relative_path == source_path)
        );
        assert_eq!(
            harness.state().link_source_path.as_deref(),
            Some(source_path.as_path())
        );
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_error.is_none());
        harness.get_by_label("2 Markdown files found.");
        harness.get_by_label("Note list refreshed: 2 Markdown files found.");
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_edit
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Read note source preview").click();
        harness.step();
        assert!(harness.state().note_preview_receiver.is_some());
        wait_for_note_preview(&mut harness);
        assert!(harness.state().note_preview_error.is_none());
        let updated_preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the updated note source should be visible after refresh");
        assert_eq!(updated_preview.relative_path, source_path);
        assert_eq!(updated_preview.text.as_bytes(), external_source.as_slice());
        assert_eq!(
            updated_preview.total_size_bytes,
            external_source.len() as u64
        );
        assert!(!updated_preview.truncated);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_edit
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Close source preview").click();
        harness.step();
        assert!(harness.state().note_source_preview.is_none());
        drop(harness);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_edit
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_refresh_after_external_invalid_utf8_note_edit_clears_stale_preview_without_writing() {
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        let note_path = PathBuf::from("Notes/Welcome.md");
        let note_file_path = vault_path.join(&note_path);
        let original_source = b"\xef\xbb\xbf# Valid note\r\n";
        let invalid_source = b"\xef\xbb\xbf# Invalid byte: \xff\r\n";
        std::fs::create_dir_all(
            note_file_path
                .parent()
                .expect("note must have a parent directory"),
        )
        .expect("create existing vault note directory");
        std::fs::create_dir_all(app_data_path.join("state"))
            .expect("create separate app-data directory");
        std::fs::write(&note_file_path, original_source).expect("seed valid note source");
        std::fs::write(
            app_data_path.join("state/open-state.bin"),
            [0xa5, 0x00, 0x7e, 0xff],
        )
        .expect("seed separate app-data sentinel");

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open the existing vault without conversion");
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(note_path.clone()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        assert!(harness.state().note_preview_receiver.is_some());
        wait_for_note_preview(&mut harness);
        assert!(harness.state().note_preview_error.is_none());
        let initial_preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the valid source preview should be visible");
        assert_eq!(initial_preview.relative_path, note_path);
        assert_eq!(initial_preview.text.as_bytes(), original_source);

        std::fs::write(&note_file_path, invalid_source)
            .expect("simulate an external editor writing invalid UTF-8");
        let after_external_edit = existing_vault_tree_snapshot(&vault_path);
        assert_ne!(after_external_edit, before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
        assert_eq!(
            std::fs::read(&note_file_path).expect("read external invalid note bytes"),
            invalid_source
        );

        harness.get_by_label("Refresh note list").click();
        harness.step();
        assert!(harness.state().vault_refresh_receiver.is_some());
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().vault_refresh_error.is_none());
        let refreshed_session = harness
            .state()
            .session
            .as_ref()
            .expect("the refreshed vault session should remain open");
        assert_eq!(refreshed_session.entries().len(), 1);
        assert_eq!(refreshed_session.entries()[0].relative_path, note_path);
        assert_eq!(
            harness.state().link_source_path.as_deref(),
            Some(note_path.as_path())
        );
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_error.is_none());
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_edit
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Read note source preview").click();
        harness.step();
        assert!(harness.state().note_preview_receiver.is_some());
        wait_for_note_preview(&mut harness);
        assert!(harness.state().note_source_preview.is_none());
        assert!(
            harness.state().note_preview_error.as_deref().is_some_and(
                |error| error.starts_with("The selected note preview contains invalid UTF-8;")
            )
        );
        assert_eq!(
            std::fs::read(&note_file_path).expect("read invalid note after failed preview"),
            invalid_source
        );
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_edit
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_edit
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_refresh_after_external_invalid_utf8_note_repair_recovers_preview_without_writing() {
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        let note_path = PathBuf::from("Notes/Welcome.md");
        let note_file_path = vault_path.join(&note_path);
        let original_source = b"\xef\xbb\xbf# Initial valid note\r\n";
        let invalid_source = b"\xef\xbb\xbf# Invalid byte: \xff\r\n";
        let repaired_source = b"\xef\xbb\xbf# Repaired externally\r\nRecovered.\r\n";
        std::fs::create_dir_all(
            note_file_path
                .parent()
                .expect("note must have a parent directory"),
        )
        .expect("create existing vault note directory");
        std::fs::create_dir_all(app_data_path.join("state"))
            .expect("create separate app-data directory");
        std::fs::write(&note_file_path, original_source).expect("seed valid note source");
        std::fs::write(
            app_data_path.join("state/open-state.bin"),
            [0xa5, 0x00, 0x7e, 0xff],
        )
        .expect("seed separate app-data sentinel");

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open the existing vault without conversion");
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(note_path.clone()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        assert!(harness.state().note_preview_receiver.is_some());
        wait_for_note_preview(&mut harness);
        assert!(harness.state().note_preview_receiver.is_none());
        let initial_preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the initial valid source preview should be visible");
        assert_eq!(initial_preview.relative_path, note_path);
        assert_eq!(initial_preview.text.as_bytes(), original_source);

        std::fs::write(&note_file_path, invalid_source)
            .expect("simulate an external editor writing invalid UTF-8");
        let after_invalid_edit = existing_vault_tree_snapshot(&vault_path);
        let mut expected_after_invalid_edit = before_vault.clone();
        expected_after_invalid_edit
            .iter_mut()
            .find(|(path, _, _)| path == &note_path)
            .expect("vault snapshot must contain the note")
            .2 = invalid_source.to_vec();
        assert_eq!(after_invalid_edit, expected_after_invalid_edit);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Refresh note list").click();
        harness.step();
        assert!(harness.state().vault_refresh_receiver.is_some());
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().vault_refresh_receiver.is_none());
        let refreshed_session = harness
            .state()
            .session
            .as_ref()
            .expect("the refreshed vault session should remain open");
        assert_eq!(refreshed_session.entries().len(), 1);
        assert_eq!(refreshed_session.entries()[0].relative_path, note_path);
        assert_eq!(
            harness.state().link_source_path.as_deref(),
            Some(note_path.as_path())
        );
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_error.is_none());
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_invalid_edit
        );

        harness.get_by_label("Read note source preview").click();
        harness.step();
        assert!(harness.state().note_preview_receiver.is_some());
        wait_for_note_preview(&mut harness);
        assert!(harness.state().note_preview_receiver.is_none());
        assert!(harness.state().note_source_preview.is_none());
        assert!(
            harness.state().note_preview_error.as_deref().is_some_and(
                |error| error.starts_with("The selected note preview contains invalid UTF-8;")
            )
        );
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_invalid_edit
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        std::fs::write(&note_file_path, repaired_source)
            .expect("simulate an external editor repairing the note source");
        let after_external_repair = existing_vault_tree_snapshot(&vault_path);
        let mut expected_after_external_repair = expected_after_invalid_edit;
        expected_after_external_repair
            .iter_mut()
            .find(|(path, _, _)| path == &note_path)
            .expect("repaired vault snapshot must contain the note")
            .2 = repaired_source.to_vec();
        assert_eq!(after_external_repair, expected_after_external_repair);
        assert!(harness.state().note_preview_error.is_some());
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Refresh note list").click();
        harness.step();
        assert!(harness.state().vault_refresh_receiver.is_some());
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().vault_refresh_receiver.is_none());
        assert!(harness.state().note_preview_receiver.is_none());
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_error.is_none());
        let repaired_session = harness
            .state()
            .session
            .as_ref()
            .expect("the repaired vault session should remain open");
        assert_eq!(repaired_session.entries().len(), 1);
        assert_eq!(repaired_session.entries()[0].relative_path, note_path);
        assert_eq!(
            harness.state().link_source_path.as_deref(),
            Some(note_path.as_path())
        );

        harness.get_by_label("Read note source preview").click();
        harness.step();
        assert!(harness.state().note_preview_receiver.is_some());
        wait_for_note_preview(&mut harness);
        assert!(harness.state().note_preview_receiver.is_none());
        assert!(harness.state().note_preview_error.is_none());
        let repaired_preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the repaired source preview should be visible");
        assert_eq!(repaired_preview.relative_path, note_path);
        assert_eq!(repaired_preview.text.as_bytes(), repaired_source);
        assert_eq!(
            repaired_preview.total_size_bytes,
            repaired_source.len() as u64
        );
        assert!(!repaired_preview.truncated);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_repair
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_repair
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_failed_vault_refresh_retains_listing_and_recovers_after_root_returns_without_writing() {
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let relocated_vault_path = temporary.0.join("Temporarily Relocated Vault");
        let app_data_path = temporary.0.join("App Data");
        let note_path = PathBuf::from("Notes/Welcome.md");
        let note_file_path = vault_path.join(&note_path);
        let initial_source = b"\xef\xbb\xbf# Original note\r\n";
        let recovered_source = b"\xef\xbb\xbf# Restored externally\r\nThe vault is back.\r\n";
        std::fs::create_dir_all(
            note_file_path
                .parent()
                .expect("note must have a parent directory"),
        )
        .expect("create existing vault note directory");
        std::fs::create_dir_all(app_data_path.join("state"))
            .expect("create separate app-data directory");
        std::fs::write(&note_file_path, initial_source).expect("seed existing note source");
        std::fs::write(
            app_data_path.join("state/open-state.bin"),
            [0xa5, 0x00, 0x7e, 0xff],
        )
        .expect("seed separate app-data sentinel");

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open the existing vault without conversion");
        let canonical_vault = session.root_path().to_path_buf();
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(note_path.clone()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        assert!(harness.state().note_preview_receiver.is_some());
        wait_for_note_preview(&mut harness);
        let initial_preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the initial valid source preview should be visible");
        assert_eq!(initial_preview.relative_path, note_path);
        assert_eq!(initial_preview.text.as_bytes(), initial_source);

        std::fs::rename(&vault_path, &relocated_vault_path)
            .expect("simulate the selected vault root becoming unavailable");
        let relocated_vault = existing_vault_tree_snapshot(&relocated_vault_path);
        assert_eq!(relocated_vault, before_vault);
        assert!(!vault_path.exists());
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Refresh note list").click();
        harness.step();
        assert!(harness.state().vault_refresh_receiver.is_some());
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().vault_refresh_receiver.is_none());
        assert_eq!(
            harness.state().vault_refresh_error.as_deref(),
            Some(
                "The note list could not be refreshed safely. The existing listing remains available."
            )
        );
        assert!(harness.state().vault_refresh_status.is_none());
        let retained_session = harness
            .state()
            .session
            .as_ref()
            .expect("a failed refresh should retain the existing session");
        assert_eq!(retained_session.root_path(), canonical_vault);
        assert_eq!(retained_session.entries().len(), 1);
        assert_eq!(retained_session.entries()[0].relative_path, note_path);
        assert_eq!(
            harness.state().link_source_path.as_deref(),
            Some(note_path.as_path())
        );
        assert_eq!(
            existing_vault_tree_snapshot(&relocated_vault_path),
            relocated_vault
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Read note source preview").click();
        harness.step();
        assert!(harness.state().note_preview_receiver.is_some());
        wait_for_note_preview(&mut harness);
        assert!(harness.state().note_preview_receiver.is_none());
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_error.is_some());
        assert_eq!(
            existing_vault_tree_snapshot(&relocated_vault_path),
            relocated_vault
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        std::fs::write(relocated_vault_path.join(&note_path), recovered_source)
            .expect("simulate an external note update while the vault root is relocated");
        let mut expected_recovered_vault = before_vault.clone();
        expected_recovered_vault
            .iter_mut()
            .find(|(path, _, _)| path == &note_path)
            .expect("vault snapshot must contain the note")
            .2 = recovered_source.to_vec();
        let recovered_vault = existing_vault_tree_snapshot(&relocated_vault_path);
        assert_eq!(recovered_vault, expected_recovered_vault);
        std::fs::rename(&relocated_vault_path, &vault_path)
            .expect("restore the selected vault root at its original path");
        assert_eq!(existing_vault_tree_snapshot(&vault_path), recovered_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Refresh note list").click();
        harness.step();
        assert!(harness.state().vault_refresh_receiver.is_some());
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().vault_refresh_receiver.is_none());
        assert!(harness.state().vault_refresh_error.is_none());
        assert_eq!(
            harness.state().vault_refresh_status.as_deref(),
            Some("Note list refreshed: 1 Markdown files found.")
        );
        assert!(harness.state().note_preview_receiver.is_none());
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_error.is_none());
        let recovered_session = harness
            .state()
            .session
            .as_ref()
            .expect("the restored vault session should remain open");
        assert_eq!(recovered_session.root_path(), canonical_vault);
        assert_eq!(recovered_session.entries().len(), 1);
        assert_eq!(recovered_session.entries()[0].relative_path, note_path);
        assert_eq!(
            harness.state().link_source_path.as_deref(),
            Some(note_path.as_path())
        );

        harness.get_by_label("Read note source preview").click();
        harness.step();
        assert!(harness.state().note_preview_receiver.is_some());
        wait_for_note_preview(&mut harness);
        assert!(harness.state().note_preview_receiver.is_none());
        assert!(harness.state().note_preview_error.is_none());
        let recovered_preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the restored note source preview should be visible");
        assert_eq!(recovered_preview.relative_path, note_path);
        assert_eq!(recovered_preview.text.as_bytes(), recovered_source);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), recovered_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), recovered_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_bounds_oversized_note_preview_at_utf8_boundary_without_writing() {
        let fixture: serde_json::Value = serde_json::from_str(EXISTING_VAULT_FIXTURE)
            .expect("existing-vault fixture must be valid JSON");
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(&vault_path).expect("create existing vault directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        materialize_existing_vault_fixture(&vault_path, &fixture);

        let source_path = PathBuf::from("Notes/Welcome.md");
        let mut large_source = b"# Large note\n".to_vec();
        large_source.resize(MAX_NOTE_SOURCE_PREVIEW_BYTES - 2, b'x');
        large_source.extend_from_slice(
            "\n😀\nThe remaining source is beyond the preview bound.\n".as_bytes(),
        );
        std::fs::write(vault_path.join(&source_path), &large_source)
            .expect("write oversized fixture note before opening the vault");

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing vault without conversion");
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(source_path.clone()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        assert!(harness.state().note_preview_receiver.is_some());
        wait_for_note_preview(&mut harness);
        assert!(harness.state().note_preview_error.is_none());
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the bounded source preview should be visible");
        assert_eq!(preview.relative_path, source_path);
        assert_eq!(
            preview.text.as_bytes(),
            &large_source[..MAX_NOTE_SOURCE_PREVIEW_BYTES - 1]
        );
        assert_eq!(preview.total_size_bytes, large_source.len() as u64);
        assert!(preview.truncated);
        harness.get_by_label(&format!(
            "Showing the first {} of {} source bytes.",
            MAX_NOTE_SOURCE_PREVIEW_BYTES,
            large_source.len()
        ));
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Close source preview").click();
        harness.step();
        assert!(harness.state().note_source_preview.is_none());
        drop(harness);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_refreshes_and_previews_an_external_note_without_changing_its_tree() {
        let fixture: serde_json::Value = serde_json::from_str(EXISTING_VAULT_FIXTURE)
            .expect("existing-vault fixture must be valid JSON");
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(&vault_path).expect("create existing vault directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        materialize_existing_vault_fixture(&vault_path, &fixture);

        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open selected existing vault without conversion");
        assert_eq!(session.entries().len(), 2);
        let external_source = b"\xEF\xBB\xBF# External note\r\nSecond line\r\n".to_vec();
        std::fs::write(vault_path.join("Notes/External.md"), &external_source)
            .expect("simulate an external Obsidian note before refresh");
        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(PathBuf::from("Notes/Welcome.md")),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Refresh note list").click();
        harness.step();
        assert!(harness.state().vault_refresh_receiver.is_some());
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().vault_refresh_error.is_none());
        assert_eq!(
            harness
                .state()
                .session
                .as_ref()
                .expect("the refreshed vault session should remain open")
                .entries()
                .len(),
            3
        );
        assert!(
            harness
                .state()
                .session
                .as_ref()
                .unwrap()
                .entries()
                .iter()
                .any(|entry| entry.relative_path.as_path() == Path::new("Notes/External.md"))
        );
        harness.get_by_label("3 Markdown files found.");
        harness.get_by_label("Note list refreshed: 3 Markdown files found.");
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Previous note").click();
        harness.step();
        assert_eq!(
            harness.state().link_source_path.as_deref(),
            Some(Path::new("Notes/External.md"))
        );
        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        assert!(harness.state().note_preview_receiver.is_some());
        wait_for_note_preview(&mut harness);
        assert!(harness.state().note_preview_error.is_none());
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the refreshed external note source should be visible");
        assert_eq!(preview.relative_path, PathBuf::from("Notes/External.md"));
        assert_eq!(preview.text.as_bytes(), external_source.as_slice());
        assert_eq!(preview.total_size_bytes, external_source.len() as u64);
        assert!(!preview.truncated);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Close source preview").click();
        harness.step();
        assert!(harness.state().note_source_preview.is_none());
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_refresh_after_external_note_removal_clears_stale_preview_without_writing() {
        let fixture: serde_json::Value = serde_json::from_str(EXISTING_VAULT_FIXTURE)
            .expect("existing-vault fixture must be valid JSON");
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(&vault_path).expect("create existing vault directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        materialize_existing_vault_fixture(&vault_path, &fixture);

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open selected existing vault without conversion");
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(PathBuf::from("Notes/Welcome.md")),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        assert!(harness.state().note_preview_receiver.is_some());
        wait_for_note_preview(&mut harness);
        assert!(harness.state().note_preview_error.is_none());
        assert_eq!(
            harness
                .state()
                .note_source_preview
                .as_ref()
                .expect("the selected note preview should be open")
                .relative_path,
            PathBuf::from("Notes/Welcome.md")
        );

        let removed_path = PathBuf::from("Notes/Welcome.md");
        let mut expected_after_external_removal = before_vault.clone();
        expected_after_external_removal.retain(|(path, _, _)| path != &removed_path);
        std::fs::remove_file(vault_path.join(&removed_path))
            .expect("simulate an external removal while the vault is open");
        let after_external_removal = existing_vault_tree_snapshot(&vault_path);
        assert_eq!(after_external_removal, expected_after_external_removal);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Refresh note list").click();
        harness.step();
        assert!(harness.state().vault_refresh_receiver.is_some());
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().vault_refresh_error.is_none());
        let session = harness
            .state()
            .session
            .as_ref()
            .expect("the refreshed vault session should remain open");
        assert_eq!(session.entries().len(), 1);
        assert_eq!(
            session.entries()[0].relative_path,
            PathBuf::from("README.md")
        );
        assert_eq!(
            harness.state().link_source_path.as_deref(),
            Some(Path::new("README.md"))
        );
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_error.is_none());
        harness.get_by_label("1 Markdown files found.");
        harness.get_by_label("Note list refreshed: 1 Markdown files found.");
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_removal
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Read note source preview").click();
        harness.step();
        assert!(harness.state().note_preview_receiver.is_some());
        wait_for_note_preview(&mut harness);
        assert!(harness.state().note_preview_error.is_none());
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the fallback note preview should be available");
        assert_eq!(preview.relative_path, PathBuf::from("README.md"));
        let expected_source = fixture["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|file| file["relative_path"] == "README.md")
            .and_then(|file| file["source"].as_str())
            .expect("fixture must contain the README source");
        assert_eq!(preview.text.as_bytes(), expected_source.as_bytes());

        harness.get_by_label("Close source preview").click();
        harness.step();
        assert!(harness.state().note_source_preview.is_none());
        drop(harness);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_removal
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_refresh_after_external_removal_of_last_note_clears_stale_state_without_writing() {
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Single Note Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(vault_path.join(".obsidian"))
            .expect("create existing vault configuration directory");
        std::fs::create_dir_all(vault_path.join("Attachments"))
            .expect("create existing vault attachment directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        std::fs::write(
            app_data_path.join("private-state.bin"),
            [0x71, 0x00, 0xfe, 0x08],
        )
        .expect("seed separate app-data sentinel");
        std::fs::write(
            vault_path.join(".obsidian/app.json"),
            b"{\"unknownOption\":{\"keep\":true}}\n",
        )
        .expect("seed opaque Obsidian configuration");
        std::fs::write(
            vault_path.join("Attachments/opaque.bin"),
            [0x00, 0xff, 0x42, 0x80],
        )
        .expect("seed opaque attachment data");
        let source_path = PathBuf::from("README.md");
        let source = b"\xef\xbb\xbf# Single note\r\n[[README]]\r\n![[README]]\r\n";
        std::fs::write(vault_path.join(&source_path), source).expect("seed the only Markdown note");

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let canonical_vault = std::fs::canonicalize(&vault_path).expect("canonicalize vault");
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open the single-note vault without conversion");
        assert_eq!(session.entries().len(), 1);
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(source_path.clone()),
            rename_source_path: Some(source_path.clone()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert!(harness.state().link_error.is_none());
        assert_eq!(harness.state().link_resolutions.len(), 2);
        assert_eq!(
            harness
                .state()
                .note_embed_report
                .as_ref()
                .expect("the self-embed report should be present")
                .embeds
                .len(),
            1
        );
        assert!(harness.state().note_embed_error.is_none());

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the only note preview should be open");
        assert_eq!(preview.relative_path, source_path);
        assert_eq!(preview.text.as_bytes(), source);

        std::fs::remove_file(vault_path.join(&source_path))
            .expect("simulate an external removal of the only Markdown note");
        let mut expected_after_external_removal = before_vault.clone();
        expected_after_external_removal.retain(|(path, _, _)| path != &source_path);
        let after_external_removal = existing_vault_tree_snapshot(&vault_path);
        assert_eq!(after_external_removal, expected_after_external_removal);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Refresh note list").click();
        harness.step();
        assert!(harness.state().vault_refresh_receiver.is_some());
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().vault_refresh_error.is_none());
        assert!(harness.state().vault_refresh_receiver.is_none());
        let session = harness
            .state()
            .session
            .as_ref()
            .expect("the empty vault session should remain open");
        assert_eq!(session.root_path(), canonical_vault);
        assert!(session.entries().is_empty());
        assert!(harness.state().link_source_path.is_none());
        assert!(harness.state().rename_source_path.is_none());
        assert!(harness.state().link_resolutions.is_empty());
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().link_status.is_none());
        assert!(harness.state().link_receiver.is_none());
        assert!(harness.state().note_embed_report.is_none());
        assert!(harness.state().note_embed_error.is_none());
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_receiver.is_none());
        assert!(harness.state().note_preview_error.is_none());
        assert!(harness.state().inline_image_textures.is_empty());
        assert!(harness.state().rename_preview.is_none());
        assert!(harness.state().rename_error.is_none());
        assert!(harness.state().rename_status.is_none());
        harness.get_by_label("0 Markdown files found.");
        harness.get_by_label("This vault has no Markdown notes to inspect.");
        harness.get_by_label("This vault has no Markdown notes to rename.");
        harness.get_by_label("Note list refreshed: 0 Markdown files found.");
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_removal
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_removal
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_refresh_after_external_note_rename_clears_stale_state_without_writing() {
        let mut fixture: serde_json::Value = serde_json::from_str(EXISTING_VAULT_FIXTURE)
            .expect("existing-vault fixture must be valid JSON");
        let welcome_file = fixture["files"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|file| file["relative_path"] == "Notes/Welcome.md")
            .expect("existing-vault fixture must include the welcome note");
        let fixture_welcome_source = welcome_file["source"]
            .as_str()
            .expect("welcome note must have a text source");
        let welcome_source = format!("{fixture_welcome_source}\r\n[[Notes/Welcome]]\r\n");
        welcome_file["source"] = serde_json::Value::String(welcome_source.clone());

        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(&vault_path).expect("create existing vault directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        materialize_existing_vault_fixture(&vault_path, &fixture);

        let source_path = PathBuf::from("Notes/Welcome.md");
        let renamed_path = PathBuf::from("Zzz-Welcome-renamed.md");
        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open selected existing vault without conversion");
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(source_path.clone()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert!(harness.state().link_error.is_none());
        assert_eq!(harness.state().link_resolutions.len(), 1);
        assert!(harness.state().note_embed_report.is_some());

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the selected welcome note preview should be open");
        assert_eq!(preview.relative_path, source_path);
        assert_eq!(preview.text.as_bytes(), welcome_source.as_bytes());

        std::fs::rename(
            vault_path.join(&source_path),
            vault_path.join(&renamed_path),
        )
        .expect("simulate an external editor renaming the selected note");
        let mut expected_after_external_rename = before_vault.clone();
        let renamed_entry = expected_after_external_rename
            .iter_mut()
            .find(|(path, _, _)| path == &source_path)
            .expect("expected snapshot must contain the renamed note");
        renamed_entry.0 = renamed_path.clone();
        expected_after_external_rename.sort_by(|left, right| left.0.cmp(&right.0));
        let after_external_rename = existing_vault_tree_snapshot(&vault_path);
        assert_eq!(after_external_rename, expected_after_external_rename);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Refresh note list").click();
        harness.step();
        assert!(harness.state().vault_refresh_receiver.is_some());
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().vault_refresh_error.is_none());
        let session = harness
            .state()
            .session
            .as_ref()
            .expect("the refreshed vault session should remain open");
        assert_eq!(session.entries().len(), 2);
        assert!(
            session
                .entries()
                .iter()
                .any(|entry| entry.relative_path == renamed_path)
        );
        assert!(
            !session
                .entries()
                .iter()
                .any(|entry| entry.relative_path == source_path)
        );
        assert_eq!(
            harness.state().link_source_path.as_deref(),
            Some(Path::new("README.md"))
        );
        assert!(harness.state().link_resolutions.is_empty());
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().link_status.is_none());
        assert!(harness.state().note_embed_report.is_none());
        assert!(harness.state().note_embed_error.is_none());
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_error.is_none());
        harness.get_by_label("2 Markdown files found.");
        harness.get_by_label("Note list refreshed: 2 Markdown files found.");
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_rename
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        let fallback_preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the deterministic fallback note preview should be available");
        assert_eq!(fallback_preview.relative_path, PathBuf::from("README.md"));
        let readme_source = fixture["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|file| file["relative_path"] == "README.md")
            .and_then(|file| file["source"].as_str())
            .expect("fixture must include the README source");
        assert_eq!(fallback_preview.text.as_bytes(), readme_source.as_bytes());

        harness.get_by_label("Next note").click();
        harness.step();
        assert_eq!(
            harness.state().link_source_path.as_deref(),
            Some(renamed_path.as_path())
        );
        assert!(harness.state().note_source_preview.is_none());
        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        let renamed_preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the renamed note source should remain previewable");
        assert_eq!(renamed_preview.relative_path, renamed_path);
        assert_eq!(renamed_preview.text.as_bytes(), welcome_source.as_bytes());
        assert_eq!(
            renamed_preview.total_size_bytes,
            welcome_source.len() as u64
        );
        assert!(!renamed_preview.truncated);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_rename
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Close source preview").click();
        harness.step();
        assert!(harness.state().note_source_preview.is_none());
        drop(harness);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_rename
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_refresh_after_external_attachment_removal_clears_stale_embed_without_writing() {
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Image Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(vault_path.join(".obsidian"))
            .expect("create existing vault configuration directory");
        std::fs::create_dir_all(vault_path.join("Attachments"))
            .expect("create existing vault attachment directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        std::fs::write(
            app_data_path.join("private-state.bin"),
            [0x71, 0x00, 0xfe, 0x08],
        )
        .expect("seed separate app-data sentinel");
        std::fs::write(
            vault_path.join(".obsidian/app.json"),
            b"{\"unknownOption\":{\"keep\":true}}\n",
        )
        .expect("seed opaque Obsidian configuration");
        std::fs::write(
            vault_path.join("Attachments/opaque.bin"),
            [0x00, 0xff, 0x42, 0x80],
        )
        .expect("seed unrelated opaque attachment data");
        let note_path = PathBuf::from("Notes/Image.md");
        let attachment_path = PathBuf::from("Attachments/photo.png");
        std::fs::create_dir_all(vault_path.join("Notes"))
            .expect("create existing vault note directory");
        let note_source = b"# Image note\n\n![[Attachments/photo.png|Accessible red dot]]\n";
        std::fs::write(vault_path.join(&note_path), note_source)
            .expect("seed Markdown note with an embedded image");
        let image_source = include_bytes!("../../../assets/openobsidian-icon.png");
        std::fs::write(vault_path.join(&attachment_path), image_source)
            .expect("seed the embedded image attachment");

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing image vault without conversion");
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(note_path.clone()),
            rename_source_path: Some(note_path.clone()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_error.is_none());
        let report = harness
            .state()
            .note_embed_report
            .as_ref()
            .expect("the existing image attachment should resolve");
        assert_eq!(report.embeds.len(), 1);
        assert!(matches!(
            &report.embeds[0].resolution.disposition,
            VaultNoteEmbedDisposition::Attachment(image)
                if image.width > 0
                    && image.height > 0
                    && image.rgba_bytes.len() == (image.width * image.height * 4) as usize
        ));
        harness.get_by_label("Accessible red dot");
        assert_eq!(harness.state().inline_image_textures.len(), 1);

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the image note source preview should be open");
        assert_eq!(preview.relative_path, note_path);
        assert_eq!(preview.text.as_bytes(), note_source);

        std::fs::remove_file(vault_path.join(&attachment_path))
            .expect("simulate external removal of the embedded image");
        let mut expected_after_removal = before_vault.clone();
        expected_after_removal.retain(|(path, _, _)| path != &attachment_path);
        let after_external_removal = existing_vault_tree_snapshot(&vault_path);
        assert_eq!(after_external_removal, expected_after_removal);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Refresh note list").click();
        harness.step();
        assert!(harness.state().vault_refresh_receiver.is_some());
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().vault_refresh_error.is_none());
        let session = harness
            .state()
            .session
            .as_ref()
            .expect("the vault session should remain open after attachment removal");
        assert_eq!(session.entries().len(), 1);
        assert_eq!(session.entries()[0].relative_path, note_path);
        assert_eq!(
            harness.state().link_source_path.as_deref(),
            Some(note_path.as_path())
        );
        assert_eq!(
            harness.state().rename_source_path.as_deref(),
            Some(note_path.as_path())
        );
        assert!(harness.state().link_resolutions.is_empty());
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_report.is_none());
        assert!(harness.state().note_embed_error.is_none());
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_error.is_none());
        assert!(harness.state().inline_image_textures.is_empty());
        harness.get_by_label("1 Markdown files found.");
        harness.get_by_label("Note list refreshed: 1 Markdown files found.");
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_removal
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert!(harness.state().link_error.is_none());
        let report = harness
            .state()
            .note_embed_report
            .as_ref()
            .expect("the missing attachment should produce a fresh embed report");
        assert_eq!(report.embeds.len(), 1);
        assert_eq!(
            report.embeds[0].resolution.resolution.status,
            LinkResolutionStatus::Unresolved
        );
        assert!(report.embeds[0].resolution.resolution.target.is_none());
        assert_eq!(
            report.embeds[0].resolution.disposition,
            VaultNoteEmbedDisposition::NotRendered
        );
        harness.get_by_label("Unresolved: 1");
        harness.get_by_label(
            "Not rendered: no matching Markdown note or vault attachment was found. ![[Attachments/photo.png|Accessible red dot]]",
        );
        assert!(harness.state().inline_image_textures.is_empty());
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_removal
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_removal
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_refresh_after_external_attachment_creation_resolves_stale_embed_without_writing() {
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Image Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(vault_path.join(".obsidian"))
            .expect("create existing vault configuration directory");
        std::fs::create_dir_all(vault_path.join("Attachments"))
            .expect("create existing vault attachment directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        std::fs::write(
            app_data_path.join("private-state.bin"),
            [0x71, 0x00, 0xfe, 0x08],
        )
        .expect("seed separate app-data sentinel");
        std::fs::write(
            vault_path.join(".obsidian/app.json"),
            b"{\"unknownOption\":{\"keep\":true}}\n",
        )
        .expect("seed opaque Obsidian configuration");
        std::fs::write(
            vault_path.join("Attachments/opaque.bin"),
            [0x00, 0xff, 0x42, 0x80],
        )
        .expect("seed unrelated opaque attachment data");
        let note_path = PathBuf::from("Notes/Image.md");
        let attachment_path = PathBuf::from("Attachments/photo.png");
        std::fs::create_dir_all(vault_path.join("Notes"))
            .expect("create existing vault note directory");
        let note_source = b"# Image note\n\n![[Attachments/photo.png|Accessible red dot]]\n";
        std::fs::write(vault_path.join(&note_path), note_source)
            .expect("seed Markdown note with a missing embedded image");

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing image vault without conversion");
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(note_path.clone()),
            rename_source_path: Some(note_path.clone()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_error.is_none());
        let report = harness
            .state()
            .note_embed_report
            .as_ref()
            .expect("the missing image should produce an initial embed report");
        assert_eq!(report.embeds.len(), 1);
        assert_eq!(
            report.embeds[0].resolution.resolution.status,
            LinkResolutionStatus::Unresolved
        );
        assert!(report.embeds[0].resolution.resolution.target.is_none());
        assert_eq!(
            report.embeds[0].resolution.disposition,
            VaultNoteEmbedDisposition::NotRendered
        );
        harness.get_by_label("Unresolved: 1");
        harness.get_by_label(
            "Not rendered: no matching Markdown note or vault attachment was found. ![[Attachments/photo.png|Accessible red dot]]",
        );
        assert!(harness.state().inline_image_textures.is_empty());

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the image note source preview should be open");
        assert_eq!(preview.relative_path, note_path);
        assert_eq!(preview.text.as_bytes(), note_source);

        let image_source = include_bytes!("../../../assets/openobsidian-icon.png");
        std::fs::write(vault_path.join(&attachment_path), image_source)
            .expect("simulate external creation of the embedded image");
        let mut expected_after_creation = before_vault.clone();
        expected_after_creation.push((attachment_path.clone(), 1, image_source.to_vec()));
        expected_after_creation.sort_by(|left, right| left.0.cmp(&right.0));
        let after_external_creation = existing_vault_tree_snapshot(&vault_path);
        assert_eq!(after_external_creation, expected_after_creation);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Refresh note list").click();
        harness.step();
        assert!(harness.state().vault_refresh_receiver.is_some());
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().vault_refresh_error.is_none());
        let session = harness
            .state()
            .session
            .as_ref()
            .expect("the vault session should remain open after attachment creation");
        assert_eq!(session.entries().len(), 1);
        assert_eq!(session.entries()[0].relative_path, note_path);
        assert_eq!(
            harness.state().link_source_path.as_deref(),
            Some(note_path.as_path())
        );
        assert_eq!(
            harness.state().rename_source_path.as_deref(),
            Some(note_path.as_path())
        );
        assert!(harness.state().link_resolutions.is_empty());
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_report.is_none());
        assert!(harness.state().note_embed_error.is_none());
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_error.is_none());
        assert!(harness.state().inline_image_textures.is_empty());
        harness.get_by_label("1 Markdown files found.");
        harness.get_by_label("Note list refreshed: 1 Markdown files found.");
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_creation
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_error.is_none());
        let report = harness
            .state()
            .note_embed_report
            .as_ref()
            .expect("the newly created attachment should resolve in a fresh report");
        assert_eq!(report.embeds.len(), 1);
        assert_eq!(
            report.embeds[0].resolution.resolution.status,
            LinkResolutionStatus::Resolved
        );
        assert_eq!(
            report.embeds[0].resolution.resolution.target.as_deref(),
            Some("Attachments/photo.png")
        );
        assert!(matches!(
            &report.embeds[0].resolution.disposition,
            VaultNoteEmbedDisposition::Attachment(image)
                if image.width > 0
                    && image.height > 0
                    && image.rgba_bytes.len() == (image.width * image.height * 4) as usize
        ));
        harness.get_by_label("Accessible red dot");
        assert_eq!(harness.state().inline_image_textures.len(), 1);
        harness.get_by_label("Resolved: 1");
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_creation
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_creation
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_refresh_after_external_attachment_edit_reloads_image_without_writing() {
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Image Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(vault_path.join(".obsidian"))
            .expect("create existing vault configuration directory");
        std::fs::create_dir_all(vault_path.join("Attachments"))
            .expect("create existing vault attachment directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        std::fs::write(
            app_data_path.join("private-state.bin"),
            [0x71, 0x00, 0xfe, 0x08],
        )
        .expect("seed separate app-data sentinel");
        std::fs::write(
            vault_path.join(".obsidian/app.json"),
            b"{\"unknownOption\":{\"keep\":true}}\n",
        )
        .expect("seed opaque Obsidian configuration");
        std::fs::write(
            vault_path.join("Attachments/opaque.bin"),
            [0x00, 0xff, 0x42, 0x80],
        )
        .expect("seed unrelated opaque attachment data");
        let note_path = PathBuf::from("Notes/Image.md");
        let attachment_path = PathBuf::from("Attachments/photo.png");
        std::fs::create_dir_all(vault_path.join("Notes"))
            .expect("create existing vault note directory");
        let note_source = b"# Image note\n\n![[Attachments/photo.png|Accessible updated image]]\n";
        std::fs::write(vault_path.join(&note_path), note_source)
            .expect("seed Markdown note with an embedded image");
        let initial_image_source = include_bytes!("../../../assets/openobsidian-icon.png");
        std::fs::write(vault_path.join(&attachment_path), initial_image_source)
            .expect("seed the embedded image attachment");

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing image vault without conversion");
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(note_path.clone()),
            rename_source_path: Some(note_path.clone()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_error.is_none());
        let report = harness
            .state()
            .note_embed_report
            .as_ref()
            .expect("the initial image attachment should resolve");
        assert_eq!(report.embeds.len(), 1);
        let (initial_width, initial_height, initial_rgba) =
            match &report.embeds[0].resolution.disposition {
                VaultNoteEmbedDisposition::Attachment(image) => {
                    (image.width, image.height, image.rgba_bytes.clone())
                }
                other => panic!("expected decoded initial image, got {other:?}"),
            };
        assert!(initial_width > 0 && initial_height > 0);
        assert_eq!(
            initial_rgba.len(),
            (initial_width * initial_height * 4) as usize
        );
        harness.get_by_label("Accessible updated image");
        assert_eq!(harness.state().inline_image_textures.len(), 1);

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the image note source preview should be open");
        assert_eq!(preview.relative_path, note_path);
        assert_eq!(preview.text.as_bytes(), note_source);

        use image::ImageEncoder as _;
        let replacement_rgba = [0x02, 0x80, 0xf0, 0xff, 0xf4, 0x02, 0x50, 0xff];
        let mut replacement_source = Vec::new();
        image::codecs::png::PngEncoder::new(&mut replacement_source)
            .write_image(&replacement_rgba, 2, 1, image::ExtendedColorType::Rgba8)
            .expect("encode replacement image fixture");
        assert_ne!(
            replacement_source.as_slice(),
            initial_image_source.as_slice()
        );
        std::fs::write(vault_path.join(&attachment_path), &replacement_source)
            .expect("simulate an external in-place image edit");
        let mut expected_after_edit = before_vault.clone();
        expected_after_edit.retain(|(path, _, _)| path != &attachment_path);
        expected_after_edit.push((attachment_path.clone(), 1, replacement_source.clone()));
        expected_after_edit.sort_by(|left, right| left.0.cmp(&right.0));
        let after_external_edit = existing_vault_tree_snapshot(&vault_path);
        assert_eq!(after_external_edit, expected_after_edit);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Refresh note list").click();
        harness.step();
        assert!(harness.state().vault_refresh_receiver.is_some());
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().vault_refresh_error.is_none());
        let session = harness
            .state()
            .session
            .as_ref()
            .expect("the vault session should remain open after attachment edit");
        assert_eq!(session.entries().len(), 1);
        assert_eq!(session.entries()[0].relative_path, note_path);
        assert_eq!(
            harness.state().link_source_path.as_deref(),
            Some(note_path.as_path())
        );
        assert_eq!(
            harness.state().rename_source_path.as_deref(),
            Some(note_path.as_path())
        );
        assert!(harness.state().link_resolutions.is_empty());
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_report.is_none());
        assert!(harness.state().note_embed_error.is_none());
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_error.is_none());
        assert!(harness.state().inline_image_textures.is_empty());
        harness.get_by_label("1 Markdown files found.");
        harness.get_by_label("Note list refreshed: 1 Markdown files found.");
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_edit
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_error.is_none());
        let report = harness
            .state()
            .note_embed_report
            .as_ref()
            .expect("the edited attachment should resolve in a fresh report");
        assert_eq!(report.embeds.len(), 1);
        assert_eq!(
            report.embeds[0].resolution.resolution.status,
            LinkResolutionStatus::Resolved
        );
        assert_eq!(
            report.embeds[0].resolution.resolution.target.as_deref(),
            Some("Attachments/photo.png")
        );
        assert!(matches!(
            &report.embeds[0].resolution.disposition,
            VaultNoteEmbedDisposition::Attachment(image)
                if image.width == 2
                    && image.height == 1
                    && image.rgba_bytes.as_slice() == replacement_rgba.as_slice()
        ));
        assert_ne!(initial_rgba.as_slice(), replacement_rgba.as_slice());
        harness.get_by_label("Accessible updated image");
        assert_eq!(harness.state().inline_image_textures.len(), 1);
        harness.get_by_label("Resolved: 1");
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_edit
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_edit
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_refresh_after_external_attachment_corruption_stops_rendering_without_writing() {
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Image Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(vault_path.join(".obsidian"))
            .expect("create existing vault configuration directory");
        std::fs::create_dir_all(vault_path.join("Attachments"))
            .expect("create existing vault attachment directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        std::fs::write(
            app_data_path.join("private-state.bin"),
            [0x71, 0x00, 0xfe, 0x08],
        )
        .expect("seed separate app-data sentinel");
        std::fs::write(
            vault_path.join(".obsidian/app.json"),
            b"{\"unknownOption\":{\"keep\":true}}\n",
        )
        .expect("seed opaque Obsidian configuration");
        std::fs::write(
            vault_path.join("Attachments/opaque.bin"),
            [0x00, 0xff, 0x42, 0x80],
        )
        .expect("seed unrelated opaque attachment data");
        let note_path = PathBuf::from("Notes/Image.md");
        let attachment_path = PathBuf::from("Attachments/photo.png");
        std::fs::create_dir_all(vault_path.join("Notes"))
            .expect("create existing vault note directory");
        let note_source =
            b"# Image note\n\n![[Attachments/photo.png|Accessible corrupted image]]\n";
        std::fs::write(vault_path.join(&note_path), note_source)
            .expect("seed Markdown note with an embedded image");
        let initial_image_source = include_bytes!("../../../assets/openobsidian-icon.png");
        std::fs::write(vault_path.join(&attachment_path), initial_image_source)
            .expect("seed the embedded image attachment");

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing image vault without conversion");
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(note_path.clone()),
            rename_source_path: Some(note_path.clone()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_error.is_none());
        let report = harness
            .state()
            .note_embed_report
            .as_ref()
            .expect("the initial image attachment should resolve");
        assert_eq!(report.embeds.len(), 1);
        assert!(matches!(
            &report.embeds[0].resolution.disposition,
            VaultNoteEmbedDisposition::Attachment(image)
                if image.width > 0
                    && image.height > 0
                    && image.rgba_bytes.len() == (image.width * image.height * 4) as usize
        ));
        harness.get_by_label("Accessible corrupted image");
        assert_eq!(harness.state().inline_image_textures.len(), 1);

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the image note source preview should be open");
        assert_eq!(preview.relative_path, note_path);
        assert_eq!(preview.text.as_bytes(), note_source);

        use image::ImageEncoder as _;
        let replacement_rgba = [0x02, 0x80, 0xf0, 0xff];
        let mut corrupted_source = Vec::new();
        image::codecs::png::PngEncoder::new(&mut corrupted_source)
            .write_image(&replacement_rgba, 1, 1, image::ExtendedColorType::Rgba8)
            .expect("encode deterministic PNG fixture before truncation");
        const PNG_HEADER_AND_IHDR_BYTES: usize = 33;
        assert!(corrupted_source.len() > PNG_HEADER_AND_IHDR_BYTES);
        corrupted_source.truncate(PNG_HEADER_AND_IHDR_BYTES);
        assert_eq!(&corrupted_source[..8], b"\x89PNG\r\n\x1a\n");
        assert_eq!(&corrupted_source[12..16], b"IHDR");
        std::fs::write(vault_path.join(&attachment_path), &corrupted_source)
            .expect("simulate an external in-place attachment corruption");
        let mut expected_after_corruption = before_vault.clone();
        expected_after_corruption.retain(|(path, _, _)| path != &attachment_path);
        expected_after_corruption.push((attachment_path.clone(), 1, corrupted_source.clone()));
        expected_after_corruption.sort_by(|left, right| left.0.cmp(&right.0));
        let after_external_corruption = existing_vault_tree_snapshot(&vault_path);
        assert_eq!(after_external_corruption, expected_after_corruption);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Refresh note list").click();
        harness.step();
        assert!(harness.state().vault_refresh_receiver.is_some());
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().vault_refresh_error.is_none());
        let session = harness
            .state()
            .session
            .as_ref()
            .expect("the vault session should remain open after attachment corruption");
        assert_eq!(session.entries().len(), 1);
        assert_eq!(session.entries()[0].relative_path, note_path);
        assert_eq!(
            harness.state().link_source_path.as_deref(),
            Some(note_path.as_path())
        );
        assert_eq!(
            harness.state().rename_source_path.as_deref(),
            Some(note_path.as_path())
        );
        assert!(harness.state().link_resolutions.is_empty());
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_report.is_none());
        assert!(harness.state().note_embed_error.is_none());
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_error.is_none());
        assert!(harness.state().inline_image_textures.is_empty());
        harness.get_by_label("1 Markdown files found.");
        harness.get_by_label("Note list refreshed: 1 Markdown files found.");
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_corruption
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_error.is_none());
        let report = harness
            .state()
            .note_embed_report
            .as_ref()
            .expect("the corrupted attachment should produce a fresh embed report");
        assert_eq!(report.embeds.len(), 1);
        assert_eq!(
            report.embeds[0].resolution.resolution.status,
            LinkResolutionStatus::Resolved
        );
        assert_eq!(
            report.embeds[0].resolution.resolution.target.as_deref(),
            Some("Attachments/photo.png")
        );
        assert_eq!(
            report.embeds[0].resolution.disposition,
            VaultNoteEmbedDisposition::NotRendered
        );
        harness.get_by_label("Resolved: 1");
        harness.get_by_label(
            "Not rendered: this attachment type or size is outside the safe image preview limits. ![[Attachments/photo.png|Accessible corrupted image]]",
        );
        assert!(harness.state().inline_image_textures.is_empty());
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_corruption
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_corruption
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_refresh_after_external_attachment_rename_clears_stale_embed_without_writing() {
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Image Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(vault_path.join(".obsidian"))
            .expect("create existing vault configuration directory");
        std::fs::create_dir_all(vault_path.join("Attachments"))
            .expect("create existing vault attachment directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        std::fs::write(
            app_data_path.join("private-state.bin"),
            [0x71, 0x00, 0xfe, 0x08],
        )
        .expect("seed separate app-data sentinel");
        std::fs::write(
            vault_path.join(".obsidian/app.json"),
            b"{\"unknownOption\":{\"keep\":true}}\n",
        )
        .expect("seed opaque Obsidian configuration");
        std::fs::write(
            vault_path.join("Attachments/opaque.bin"),
            [0x00, 0xff, 0x42, 0x80],
        )
        .expect("seed unrelated opaque attachment data");
        let note_path = PathBuf::from("Notes/Image.md");
        let attachment_path = PathBuf::from("Attachments/photo.png");
        let renamed_attachment_path = PathBuf::from("Attachments/renamed-photo.png");
        std::fs::create_dir_all(vault_path.join("Notes"))
            .expect("create existing vault note directory");
        let note_source =
            b"# Image note\n\n![[Attachments/photo.png|Accessible renamed attachment]]\n";
        std::fs::write(vault_path.join(&note_path), note_source)
            .expect("seed Markdown note with an embedded image");
        let image_source = include_bytes!("../../../assets/openobsidian-icon.png");
        std::fs::write(vault_path.join(&attachment_path), image_source)
            .expect("seed the embedded image attachment");

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing image vault without conversion");
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(note_path.clone()),
            rename_source_path: Some(note_path.clone()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_error.is_none());
        let report = harness
            .state()
            .note_embed_report
            .as_ref()
            .expect("the initial image attachment should resolve");
        assert_eq!(report.embeds.len(), 1);
        assert_eq!(
            report.embeds[0].resolution.resolution.status,
            LinkResolutionStatus::Resolved
        );
        assert_eq!(
            report.embeds[0].resolution.resolution.target.as_deref(),
            Some("Attachments/photo.png")
        );
        assert!(matches!(
            &report.embeds[0].resolution.disposition,
            VaultNoteEmbedDisposition::Attachment(image)
                if image.width > 0
                    && image.height > 0
                    && image.rgba_bytes.len() == (image.width * image.height * 4) as usize
        ));
        harness.get_by_label("Accessible renamed attachment");
        assert_eq!(harness.state().inline_image_textures.len(), 1);

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the image note source preview should be open");
        assert_eq!(preview.relative_path, note_path);
        assert_eq!(preview.text.as_bytes(), note_source);

        std::fs::rename(
            vault_path.join(&attachment_path),
            vault_path.join(&renamed_attachment_path),
        )
        .expect("simulate an external in-vault attachment rename");
        let mut expected_after_rename = before_vault.clone();
        expected_after_rename.retain(|(path, _, _)| path != &attachment_path);
        expected_after_rename.push((renamed_attachment_path.clone(), 1, image_source.to_vec()));
        expected_after_rename.sort_by(|left, right| left.0.cmp(&right.0));
        let after_external_rename = existing_vault_tree_snapshot(&vault_path);
        assert_eq!(after_external_rename, expected_after_rename);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Refresh note list").click();
        harness.step();
        assert!(harness.state().vault_refresh_receiver.is_some());
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().vault_refresh_error.is_none());
        let session = harness
            .state()
            .session
            .as_ref()
            .expect("the vault session should remain open after attachment rename");
        assert_eq!(session.entries().len(), 1);
        assert_eq!(session.entries()[0].relative_path, note_path);
        assert_eq!(
            harness.state().link_source_path.as_deref(),
            Some(note_path.as_path())
        );
        assert_eq!(
            harness.state().rename_source_path.as_deref(),
            Some(note_path.as_path())
        );
        assert!(harness.state().link_resolutions.is_empty());
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_report.is_none());
        assert!(harness.state().note_embed_error.is_none());
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_error.is_none());
        assert!(harness.state().inline_image_textures.is_empty());
        harness.get_by_label("1 Markdown files found.");
        harness.get_by_label("Note list refreshed: 1 Markdown files found.");
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_rename
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_error.is_none());
        let report = harness
            .state()
            .note_embed_report
            .as_ref()
            .expect("the renamed attachment should produce a fresh embed report");
        assert_eq!(report.embeds.len(), 1);
        assert_eq!(
            report.embeds[0].resolution.resolution.status,
            LinkResolutionStatus::Unresolved
        );
        assert!(report.embeds[0].resolution.resolution.target.is_none());
        assert_eq!(
            report.embeds[0].resolution.disposition,
            VaultNoteEmbedDisposition::NotRendered
        );
        harness.get_by_label("Unresolved: 1");
        harness.get_by_label(
            "Not rendered: no matching Markdown note or vault attachment was found. ![[Attachments/photo.png|Accessible renamed attachment]]",
        );
        assert!(harness.state().inline_image_textures.is_empty());
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_rename
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_rename
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_refresh_after_external_attachment_move_does_not_match_same_basename_elsewhere() {
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Image Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(vault_path.join(".obsidian"))
            .expect("create existing vault configuration directory");
        std::fs::create_dir_all(vault_path.join("Attachments"))
            .expect("create existing vault attachment directory");
        std::fs::create_dir_all(vault_path.join("Images"))
            .expect("create existing vault image directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        std::fs::write(
            app_data_path.join("private-state.bin"),
            [0x71, 0x00, 0xfe, 0x08],
        )
        .expect("seed separate app-data sentinel");
        std::fs::write(
            vault_path.join(".obsidian/app.json"),
            b"{\"unknownOption\":{\"keep\":true}}\n",
        )
        .expect("seed opaque Obsidian configuration");
        std::fs::write(
            vault_path.join("Attachments/opaque.bin"),
            [0x00, 0xff, 0x42, 0x80],
        )
        .expect("seed unrelated opaque attachment data");
        let note_path = PathBuf::from("Notes/Image.md");
        let attachment_path = PathBuf::from("Attachments/photo.png");
        let moved_attachment_path = PathBuf::from("Images/photo.png");
        std::fs::create_dir_all(vault_path.join("Notes"))
            .expect("create existing vault note directory");
        let note_source =
            b"# Image note\n\n![[Attachments/photo.png|Accessible moved attachment]]\n";
        std::fs::write(vault_path.join(&note_path), note_source)
            .expect("seed Markdown note with an embedded image");
        let image_source = include_bytes!("../../../assets/openobsidian-icon.png");
        std::fs::write(vault_path.join(&attachment_path), image_source)
            .expect("seed the embedded image attachment");

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing image vault without conversion");
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(note_path.clone()),
            rename_source_path: Some(note_path.clone()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_error.is_none());
        let report = harness
            .state()
            .note_embed_report
            .as_ref()
            .expect("the initial image attachment should resolve");
        assert_eq!(report.embeds.len(), 1);
        assert_eq!(
            report.embeds[0].resolution.resolution.status,
            LinkResolutionStatus::Resolved
        );
        assert_eq!(
            report.embeds[0].resolution.resolution.target.as_deref(),
            Some("Attachments/photo.png")
        );
        assert!(matches!(
            &report.embeds[0].resolution.disposition,
            VaultNoteEmbedDisposition::Attachment(image)
                if image.width > 0
                    && image.height > 0
                    && image.rgba_bytes.len() == (image.width * image.height * 4) as usize
        ));
        harness.get_by_label("Accessible moved attachment");
        assert_eq!(harness.state().inline_image_textures.len(), 1);

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the image note source preview should be open");
        assert_eq!(preview.relative_path, note_path);
        assert_eq!(preview.text.as_bytes(), note_source);

        std::fs::rename(
            vault_path.join(&attachment_path),
            vault_path.join(&moved_attachment_path),
        )
        .expect("simulate an external in-vault attachment move");
        let mut expected_after_move = before_vault.clone();
        expected_after_move.retain(|(path, _, _)| path != &attachment_path);
        expected_after_move.push((moved_attachment_path.clone(), 1, image_source.to_vec()));
        expected_after_move.sort_by(|left, right| left.0.cmp(&right.0));
        let after_external_move = existing_vault_tree_snapshot(&vault_path);
        assert_eq!(after_external_move, expected_after_move);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Refresh note list").click();
        harness.step();
        assert!(harness.state().vault_refresh_receiver.is_some());
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().vault_refresh_error.is_none());
        let session = harness
            .state()
            .session
            .as_ref()
            .expect("the vault session should remain open after attachment move");
        assert_eq!(session.entries().len(), 1);
        assert_eq!(session.entries()[0].relative_path, note_path);
        assert_eq!(
            harness.state().link_source_path.as_deref(),
            Some(note_path.as_path())
        );
        assert_eq!(
            harness.state().rename_source_path.as_deref(),
            Some(note_path.as_path())
        );
        assert!(harness.state().link_resolutions.is_empty());
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_report.is_none());
        assert!(harness.state().note_embed_error.is_none());
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_error.is_none());
        assert!(harness.state().inline_image_textures.is_empty());
        harness.get_by_label("1 Markdown files found.");
        harness.get_by_label("Note list refreshed: 1 Markdown files found.");
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_move
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_error.is_none());
        let report = harness
            .state()
            .note_embed_report
            .as_ref()
            .expect("the moved attachment should produce a fresh embed report");
        assert_eq!(report.embeds.len(), 1);
        assert_eq!(
            report.embeds[0].resolution.resolution.status,
            LinkResolutionStatus::Unresolved
        );
        assert!(report.embeds[0].resolution.resolution.target.is_none());
        assert_eq!(
            report.embeds[0].resolution.disposition,
            VaultNoteEmbedDisposition::NotRendered
        );
        harness.get_by_label("Unresolved: 1");
        harness.get_by_label(
            "Not rendered: no matching Markdown note or vault attachment was found. ![[Attachments/photo.png|Accessible moved attachment]]",
        );
        assert!(harness.state().inline_image_textures.is_empty());
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_move
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_move
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_refresh_after_external_duplicate_attachment_creation_marks_embed_ambiguous() {
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Image Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(vault_path.join(".obsidian"))
            .expect("create existing vault configuration directory");
        std::fs::create_dir_all(vault_path.join("Attachments"))
            .expect("create existing vault attachment directory");
        std::fs::create_dir_all(vault_path.join("Images"))
            .expect("create existing vault image directory");
        std::fs::create_dir_all(vault_path.join("Notes"))
            .expect("create existing vault note directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        std::fs::write(
            app_data_path.join("private-state.bin"),
            [0x71, 0x00, 0xfe, 0x08],
        )
        .expect("seed separate app-data sentinel");
        std::fs::write(
            vault_path.join(".obsidian/app.json"),
            b"{\"unknownOption\":{\"keep\":true}}\n",
        )
        .expect("seed opaque Obsidian configuration");
        std::fs::write(
            vault_path.join("Attachments/opaque.bin"),
            [0x00, 0xff, 0x42, 0x80],
        )
        .expect("seed unrelated opaque attachment data");

        let note_path = PathBuf::from("Notes/Image.md");
        let attachment_path = PathBuf::from("Attachments/photo.png");
        let duplicate_attachment_path = PathBuf::from("Images/photo.png");
        let note_source = b"# Image note\n\n![[photo.png|Accessible ambiguous attachment]]\n";
        std::fs::write(vault_path.join(&note_path), note_source)
            .expect("seed Markdown note with a basename-only image embed");
        let image_source = include_bytes!("../../../assets/openobsidian-icon.png");
        std::fs::write(vault_path.join(&attachment_path), image_source)
            .expect("seed the uniquely matching image attachment");

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing image vault without conversion");
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(note_path.clone()),
            rename_source_path: Some(note_path.clone()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_error.is_none());
        let initial_report = harness
            .state()
            .note_embed_report
            .as_ref()
            .expect("the initial unique image attachment should resolve");
        assert_eq!(initial_report.embeds.len(), 1);
        assert_eq!(
            initial_report.embeds[0].resolution.resolution.status,
            LinkResolutionStatus::Resolved
        );
        assert_eq!(
            initial_report.embeds[0]
                .resolution
                .resolution
                .target
                .as_deref(),
            Some("Attachments/photo.png")
        );
        assert!(matches!(
            &initial_report.embeds[0].resolution.disposition,
            VaultNoteEmbedDisposition::Attachment(image)
                if image.width > 0
                    && image.height > 0
                    && image.rgba_bytes.len() == (image.width * image.height * 4) as usize
        ));
        harness.get_by_label("Accessible ambiguous attachment");
        assert_eq!(harness.state().inline_image_textures.len(), 1);

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the image note source preview should be open");
        assert_eq!(preview.relative_path, note_path);
        assert_eq!(preview.text.as_bytes(), note_source);

        let duplicate_image_source = {
            use image::ImageEncoder as _;

            let mut bytes = Vec::new();
            image::codecs::png::PngEncoder::new(&mut bytes)
                .write_image(&[0, 0, 255, 255], 1, 1, image::ExtendedColorType::Rgba8)
                .expect("encode the externally added duplicate image");
            bytes
        };
        std::fs::write(
            vault_path.join(&duplicate_attachment_path),
            &duplicate_image_source,
        )
        .expect("simulate an external duplicate-basename attachment creation");
        let mut expected_after_creation = before_vault.clone();
        expected_after_creation.push((
            duplicate_attachment_path.clone(),
            1,
            duplicate_image_source,
        ));
        expected_after_creation.sort_by(|left, right| left.0.cmp(&right.0));
        let after_external_creation = existing_vault_tree_snapshot(&vault_path);
        assert_eq!(after_external_creation, expected_after_creation);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Refresh note list").click();
        harness.step();
        assert!(harness.state().vault_refresh_receiver.is_some());
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().vault_refresh_error.is_none());
        let session = harness
            .state()
            .session
            .as_ref()
            .expect("the vault session should remain open after duplicate attachment creation");
        assert_eq!(session.entries().len(), 1);
        assert_eq!(session.entries()[0].relative_path, note_path);
        assert_eq!(
            harness.state().link_source_path.as_deref(),
            Some(note_path.as_path())
        );
        assert_eq!(
            harness.state().rename_source_path.as_deref(),
            Some(note_path.as_path())
        );
        assert!(harness.state().link_resolutions.is_empty());
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_report.is_none());
        assert!(harness.state().note_embed_error.is_none());
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_error.is_none());
        assert!(harness.state().inline_image_textures.is_empty());
        harness.get_by_label("1 Markdown files found.");
        harness.get_by_label("Note list refreshed: 1 Markdown files found.");
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_creation
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_error.is_none());
        let report = harness
            .state()
            .note_embed_report
            .as_ref()
            .expect("the duplicate image basename should produce a fresh embed report");
        assert_eq!(report.embeds.len(), 1);
        let resolution = &report.embeds[0].resolution.resolution;
        assert_eq!(resolution.status, LinkResolutionStatus::Ambiguous);
        assert!(resolution.target.is_none());
        assert_eq!(
            resolution.candidates,
            vec![
                "Attachments/photo.png".to_owned(),
                "Images/photo.png".to_owned()
            ]
        );
        assert_eq!(
            report.embeds[0].resolution.disposition,
            VaultNoteEmbedDisposition::NotRendered
        );
        harness.get_by_label("Not rendered: multiple vault files match this embed. ![[photo.png|Accessible ambiguous attachment]]");
        assert!(harness.state().inline_image_textures.is_empty());
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_creation
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_creation
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_refresh_after_external_duplicate_attachment_removal_resolves_embed_without_writing() {
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Image Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(vault_path.join(".obsidian"))
            .expect("create existing vault configuration directory");
        std::fs::create_dir_all(vault_path.join("Attachments"))
            .expect("create existing vault attachment directory");
        std::fs::create_dir_all(vault_path.join("Images"))
            .expect("create existing vault image directory");
        std::fs::create_dir_all(vault_path.join("Notes"))
            .expect("create existing vault note directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        std::fs::write(
            app_data_path.join("private-state.bin"),
            [0x71, 0x00, 0xfe, 0x08],
        )
        .expect("seed separate app-data sentinel");
        std::fs::write(
            vault_path.join(".obsidian/app.json"),
            b"{\"unknownOption\":{\"keep\":true}}\n",
        )
        .expect("seed opaque Obsidian configuration");
        std::fs::write(
            vault_path.join("Attachments/opaque.bin"),
            [0x00, 0xff, 0x42, 0x80],
        )
        .expect("seed unrelated opaque attachment data");

        let note_path = PathBuf::from("Notes/Image.md");
        let attachment_path = PathBuf::from("Attachments/photo.png");
        let duplicate_attachment_path = PathBuf::from("Images/photo.png");
        let note_source = b"# Image note\n\n![[photo.png|Accessible restored attachment]]\n";
        std::fs::write(vault_path.join(&note_path), note_source)
            .expect("seed Markdown note with a basename-only image embed");
        let image_source = include_bytes!("../../../assets/openobsidian-icon.png");
        std::fs::write(vault_path.join(&attachment_path), image_source)
            .expect("seed the attachment that will become the unique match");
        let duplicate_image_source = {
            use image::ImageEncoder as _;

            let mut bytes = Vec::new();
            image::codecs::png::PngEncoder::new(&mut bytes)
                .write_image(&[0, 0, 255, 255], 1, 1, image::ExtendedColorType::Rgba8)
                .expect("encode the duplicate image that will be removed externally");
            bytes
        };
        std::fs::write(
            vault_path.join(&duplicate_attachment_path),
            &duplicate_image_source,
        )
        .expect("seed a second image with the same basename");

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing image vault without conversion");
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(note_path.clone()),
            rename_source_path: Some(note_path.clone()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_error.is_none());
        let initial_report = harness
            .state()
            .note_embed_report
            .as_ref()
            .expect("the duplicate image basename should produce an initial report");
        assert_eq!(initial_report.embeds.len(), 1);
        let initial_resolution = &initial_report.embeds[0].resolution.resolution;
        assert_eq!(initial_resolution.status, LinkResolutionStatus::Ambiguous);
        assert!(initial_resolution.target.is_none());
        assert_eq!(
            initial_resolution.candidates,
            vec![
                "Attachments/photo.png".to_owned(),
                "Images/photo.png".to_owned()
            ]
        );
        assert_eq!(
            initial_report.embeds[0].resolution.disposition,
            VaultNoteEmbedDisposition::NotRendered
        );
        harness.get_by_label("Not rendered: multiple vault files match this embed. ![[photo.png|Accessible restored attachment]]");
        assert!(harness.state().inline_image_textures.is_empty());

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the image note source preview should be open");
        assert_eq!(preview.relative_path, note_path);
        assert_eq!(preview.text.as_bytes(), note_source);

        std::fs::remove_file(vault_path.join(&duplicate_attachment_path))
            .expect("simulate external removal of one ambiguous attachment");
        let mut expected_after_removal = before_vault.clone();
        expected_after_removal.retain(|(path, _, _)| path != &duplicate_attachment_path);
        let after_external_removal = existing_vault_tree_snapshot(&vault_path);
        assert_eq!(after_external_removal, expected_after_removal);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Refresh note list").click();
        harness.step();
        assert!(harness.state().vault_refresh_receiver.is_some());
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().vault_refresh_error.is_none());
        let session = harness
            .state()
            .session
            .as_ref()
            .expect("the vault session should remain open after duplicate removal");
        assert_eq!(session.entries().len(), 1);
        assert_eq!(session.entries()[0].relative_path, note_path);
        assert_eq!(
            harness.state().link_source_path.as_deref(),
            Some(note_path.as_path())
        );
        assert_eq!(
            harness.state().rename_source_path.as_deref(),
            Some(note_path.as_path())
        );
        assert!(harness.state().link_resolutions.is_empty());
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_report.is_none());
        assert!(harness.state().note_embed_error.is_none());
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_error.is_none());
        assert!(harness.state().inline_image_textures.is_empty());
        harness.get_by_label("1 Markdown files found.");
        harness.get_by_label("Note list refreshed: 1 Markdown files found.");
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_removal
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_error.is_none());
        let report = harness
            .state()
            .note_embed_report
            .as_ref()
            .expect("removing the duplicate should produce a fresh embed report");
        assert_eq!(report.embeds.len(), 1);
        let resolution = &report.embeds[0].resolution.resolution;
        assert_eq!(resolution.status, LinkResolutionStatus::Resolved);
        assert_eq!(resolution.target.as_deref(), Some("Attachments/photo.png"));
        let expected_pixels = image::load_from_memory(image_source)
            .expect("decode the unique attachment for an exact pixel comparison")
            .into_rgba8();
        assert!(matches!(
            &report.embeds[0].resolution.disposition,
            VaultNoteEmbedDisposition::Attachment(image)
                if image.width == expected_pixels.width()
                    && image.height == expected_pixels.height()
                    && image.rgba_bytes.as_slice() == expected_pixels.as_raw().as_slice()
        ));
        harness.get_by_label("Accessible restored attachment");
        assert_eq!(harness.state().inline_image_textures.len(), 1);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_removal
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_removal
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_refresh_after_external_duplicate_attachment_rename_resolves_remaining_embed_without_writing()
     {
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Image Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(vault_path.join(".obsidian"))
            .expect("create existing vault configuration directory");
        std::fs::create_dir_all(vault_path.join("Attachments"))
            .expect("create existing vault attachment directory");
        std::fs::create_dir_all(vault_path.join("Images"))
            .expect("create existing vault image directory");
        std::fs::create_dir_all(vault_path.join("Notes"))
            .expect("create existing vault note directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        std::fs::write(
            app_data_path.join("private-state.bin"),
            [0x71, 0x00, 0xfe, 0x08],
        )
        .expect("seed separate app-data sentinel");
        std::fs::write(
            vault_path.join(".obsidian/app.json"),
            b"{\"unknownOption\":{\"keep\":true}}\n",
        )
        .expect("seed opaque Obsidian configuration");
        std::fs::write(
            vault_path.join("Attachments/opaque.bin"),
            [0x00, 0xff, 0x42, 0x80],
        )
        .expect("seed unrelated opaque attachment data");

        let note_path = PathBuf::from("Notes/Image.md");
        let attachment_path = PathBuf::from("Attachments/photo.png");
        let duplicate_attachment_path = PathBuf::from("Images/photo.png");
        let renamed_attachment_path = PathBuf::from("Images/renamed-photo.png");
        let note_source = b"# Image note\n\n![[photo.png|Accessible retained attachment]]\n";
        std::fs::write(vault_path.join(&note_path), note_source)
            .expect("seed Markdown note with a basename-only image embed");
        let image_source = include_bytes!("../../../assets/openobsidian-icon.png");
        std::fs::write(vault_path.join(&attachment_path), image_source)
            .expect("seed the attachment that will become the unique match");
        let duplicate_image_source = {
            use image::ImageEncoder as _;

            let mut bytes = Vec::new();
            image::codecs::png::PngEncoder::new(&mut bytes)
                .write_image(&[0, 0, 255, 255], 1, 1, image::ExtendedColorType::Rgba8)
                .expect("encode the duplicate image that will be renamed externally");
            bytes
        };
        std::fs::write(
            vault_path.join(&duplicate_attachment_path),
            &duplicate_image_source,
        )
        .expect("seed a second image with the same basename");

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing image vault without conversion");
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(note_path.clone()),
            rename_source_path: Some(note_path.clone()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_error.is_none());
        let initial_report = harness
            .state()
            .note_embed_report
            .as_ref()
            .expect("the duplicate image basename should produce an initial report");
        assert_eq!(initial_report.embeds.len(), 1);
        let initial_resolution = &initial_report.embeds[0].resolution.resolution;
        assert_eq!(initial_resolution.status, LinkResolutionStatus::Ambiguous);
        assert!(initial_resolution.target.is_none());
        assert_eq!(
            initial_resolution.candidates,
            vec![
                "Attachments/photo.png".to_owned(),
                "Images/photo.png".to_owned()
            ]
        );
        assert_eq!(
            initial_report.embeds[0].resolution.disposition,
            VaultNoteEmbedDisposition::NotRendered
        );
        harness.get_by_label("Not rendered: multiple vault files match this embed. ![[photo.png|Accessible retained attachment]]");
        assert!(harness.state().inline_image_textures.is_empty());

        harness.get_by_label("Note source preview").click();
        harness.step();
        harness.get_by_label("Read note source preview").click();
        harness.step();
        wait_for_note_preview(&mut harness);
        let preview = harness
            .state()
            .note_source_preview
            .as_ref()
            .expect("the image note source preview should be open");
        assert_eq!(preview.relative_path, note_path);
        assert_eq!(preview.text.as_bytes(), note_source);

        std::fs::rename(
            vault_path.join(&duplicate_attachment_path),
            vault_path.join(&renamed_attachment_path),
        )
        .expect("simulate an external rename of one ambiguous attachment");
        let mut expected_after_rename = before_vault.clone();
        expected_after_rename.retain(|(path, _, _)| path != &duplicate_attachment_path);
        expected_after_rename.push((renamed_attachment_path.clone(), 1, duplicate_image_source));
        expected_after_rename.sort_by(|left, right| left.0.cmp(&right.0));
        let after_external_rename = existing_vault_tree_snapshot(&vault_path);
        assert_eq!(after_external_rename, expected_after_rename);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Refresh note list").click();
        harness.step();
        assert!(harness.state().vault_refresh_receiver.is_some());
        wait_for_vault_refresh(&mut harness);
        assert!(harness.state().vault_refresh_error.is_none());
        let session = harness
            .state()
            .session
            .as_ref()
            .expect("the vault session should remain open after duplicate rename");
        assert_eq!(session.entries().len(), 1);
        assert_eq!(session.entries()[0].relative_path, note_path);
        assert_eq!(
            harness.state().link_source_path.as_deref(),
            Some(note_path.as_path())
        );
        assert_eq!(
            harness.state().rename_source_path.as_deref(),
            Some(note_path.as_path())
        );
        assert!(harness.state().link_resolutions.is_empty());
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_report.is_none());
        assert!(harness.state().note_embed_error.is_none());
        assert!(harness.state().note_source_preview.is_none());
        assert!(harness.state().note_preview_error.is_none());
        assert!(harness.state().inline_image_textures.is_empty());
        harness.get_by_label("1 Markdown files found.");
        harness.get_by_label("Note list refreshed: 1 Markdown files found.");
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_rename
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_error.is_none());
        let report = harness
            .state()
            .note_embed_report
            .as_ref()
            .expect("renaming the duplicate should produce a fresh embed report");
        assert_eq!(report.embeds.len(), 1);
        let resolution = &report.embeds[0].resolution.resolution;
        assert_eq!(resolution.status, LinkResolutionStatus::Resolved);
        assert_eq!(resolution.target.as_deref(), Some("Attachments/photo.png"));
        let expected_pixels = image::load_from_memory(image_source)
            .expect("decode the unique attachment for an exact pixel comparison")
            .into_rgba8();
        assert!(matches!(
            &report.embeds[0].resolution.disposition,
            VaultNoteEmbedDisposition::Attachment(image)
                if image.width == expected_pixels.width()
                    && image.height == expected_pixels.height()
                    && image.rgba_bytes.as_slice() == expected_pixels.as_raw().as_slice()
        ));
        harness.get_by_label("Accessible retained attachment");
        assert_eq!(harness.state().inline_image_textures.len(), 1);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_rename
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            after_external_rename
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_existing_vault_link_and_rename_previews_preserve_every_path_and_byte() {
        let fixture: serde_json::Value = serde_json::from_str(EXISTING_VAULT_FIXTURE)
            .expect("existing-vault fixture must be valid JSON");
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(&vault_path).expect("create existing vault directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        materialize_existing_vault_fixture(&vault_path, &fixture);
        let before_tree = existing_vault_tree_snapshot(&vault_path);

        let operations = &fixture["expected"]["read_only_operations"];
        let link_source = operations["link_source"]
            .as_str()
            .expect("fixture must identify the source note");
        let rename = &operations["rename_preview"];
        let old_path = PathBuf::from(
            rename["old_path"]
                .as_str()
                .expect("fixture must identify the original note path"),
        );
        let new_path = rename["new_path"]
            .as_str()
            .expect("fixture must identify the preview destination")
            .to_owned();
        let expected_link_count = operations["links"]
            .as_array()
            .expect("fixture must list resolved links")
            .len();
        let expected_embed_count = usize::try_from(
            operations["embed_count"]
                .as_u64()
                .expect("fixture must identify its embed count"),
        )
        .expect("embed count must fit usize");
        let expected_rename_updates = usize::try_from(
            rename["update_count"]
                .as_u64()
                .expect("fixture must identify preview updates"),
        )
        .expect("preview update count must fit usize");

        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open selected existing vault without conversion");
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(PathBuf::from(link_source)),
            rename_source_path: Some(old_path.clone()),
            rename_destination_path: new_path.clone(),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);

        let app = harness.state();
        assert!(app.link_error.is_none());
        assert!(app.note_embed_error.is_none());
        assert_eq!(app.link_resolutions.len(), expected_link_count);
        let embed_report = app
            .note_embed_report
            .as_ref()
            .expect("the UI should resolve the fixture's note embeds");
        assert_eq!(embed_report.embeds.len(), expected_embed_count);
        harness.get_by_label("Resolved: 2");
        harness.get_by_label("Note transclusions");
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_tree);

        harness.get_by_label("Build rename preview").click();
        harness.step();
        assert!(harness.state().rename_receiver.is_some());
        wait_for_rename(&mut harness);

        let preview = harness
            .state()
            .rename_preview
            .as_ref()
            .expect("the UI should build a read-only rename preview");
        assert_eq!(preview.plan.update_count, expected_rename_updates);
        assert!(vault_path.join(&old_path).is_file());
        assert!(!vault_path.join(&new_path).exists());
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_tree);

        drop(harness);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_tree);
        assert!(existing_vault_tree_snapshot(&app_data_path).is_empty());
    }

    #[test]
    fn history_labels_distinguish_protected_conflicts() {
        assert_eq!(history_kind_label(VaultHistoryKind::Recovery), "Recovery");
        assert_eq!(history_kind_label(VaultHistoryKind::Failed), "Failed write");
        assert_eq!(
            history_kind_label(VaultHistoryKind::Conflict),
            "Unresolved conflict"
        );
        assert_eq!(format_bytes(1024), "1.0 KiB");
    }

    #[test]
    fn egui_existing_vault_nested_transclusions_preserve_full_snapshots() {
        let fixture: serde_json::Value = serde_json::from_str(C03_LINK_RESOLUTION_FIXTURE)
            .expect("C03 link-resolution fixture must be valid");
        assert_eq!(fixture["id"], "fixture:c03-link-forms");
        let case = fixture["cases"]
            .as_array()
            .expect("C03 fixture must contain cases")
            .iter()
            .find(|case| case["id"] == "wiki-markdown-embed-and-relative-link-forms")
            .expect("C03 fixture must contain the mixed-link case");
        let current_path = std::path::PathBuf::from(
            case["current_path"]
                .as_str()
                .expect("C03 fixture must identify the current note"),
        );
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("vault");
        let app_data_path = temporary.0.join("app-data");
        std::fs::create_dir_all(&vault_path).unwrap();
        std::fs::create_dir_all(&app_data_path).unwrap();
        for file in case["files"]
            .as_array()
            .expect("C03 fixture must list the vault files")
        {
            let relative_path = std::path::PathBuf::from(
                file["path"]
                    .as_str()
                    .expect("C03 fixture file must have a path"),
            );
            let source = file["source"].as_str().unwrap_or("").as_bytes().to_vec();
            let path = vault_path.join(&relative_path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, &source).unwrap();
        }
        let app_data_sentinel = [0xa5, 0x00, 0x7e, 0xff];
        let app_data_sentinel_path = app_data_path.join("state/open-state.bin");
        std::fs::create_dir_all(app_data_sentinel_path.parent().unwrap()).unwrap();
        std::fs::write(&app_data_sentinel_path, app_data_sentinel).unwrap();
        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);

        let session = VaultSession::open(&vault_path, &app_data_path).unwrap();
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(current_path.clone()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);

        let app = harness.state();
        assert!(app.link_error.is_none());
        assert_eq!(
            app.link_resolutions.len(),
            case["expected_references"].as_array().unwrap().len()
        );
        assert!(
            app.link_status
                .as_deref()
                .is_some_and(|status| { status.contains(current_path.to_str().unwrap()) })
        );
        for (actual, expected) in app
            .link_resolutions
            .iter()
            .zip(case["expected_references"].as_array().unwrap())
        {
            let expected_kind = match expected["kind"].as_str().unwrap() {
                "wiki" => LinkKind::WikiLink,
                "markdown" => LinkKind::Markdown,
                "embed" => LinkKind::Embed,
                kind => panic!("unknown fixture link kind: {kind}"),
            };
            assert_eq!(actual.reference.kind, expected_kind);
            assert_eq!(
                actual.reference.raw,
                expected["raw"].as_str().unwrap(),
                "fixture reference text"
            );
            assert_eq!(
                actual.reference.target,
                expected["target"].as_str().unwrap(),
                "fixture reference target"
            );
            assert_eq!(
                actual.reference.alias.as_deref(),
                expected["alias"].as_str()
            );
            assert_eq!(
                actual.reference.subpath.as_deref(),
                expected["subpath"].as_str()
            );
            assert_eq!(
                actual.resolution.target.as_deref(),
                expected["resolved_path"].as_str()
            );
            let expected_candidates: Vec<String> = expected["candidates"]
                .as_array()
                .unwrap()
                .iter()
                .map(|candidate| candidate.as_str().unwrap().to_owned())
                .collect();
            assert_eq!(actual.resolution.candidates, expected_candidates);
            let expected_status = match expected["status"].as_str().unwrap() {
                "resolved" => LinkResolutionStatus::Resolved,
                "unresolved" => LinkResolutionStatus::Unresolved,
                "ambiguous" => LinkResolutionStatus::Ambiguous,
                "external" => LinkResolutionStatus::External,
                status => panic!("unknown fixture link status: {status}"),
            };
            assert_eq!(actual.resolution.status, expected_status);
        }

        harness.get_by_label("Resolved: 8");
        harness.get_by_label("Unresolved: 2");
        harness.get_by_label("Ambiguous: 1");
        harness.get_by_label("External: 1");
        harness.get_by_label("[[#Overview]]");
        harness.get_by_label("[[Missing]]");
        harness.get_by_label("Source target: Missing");
        assert!(app.note_embed_error.is_none());
        let report = app
            .note_embed_report
            .as_ref()
            .expect("fixture note embeds should be rendered");
        assert_eq!(report.embeds.len(), 4);
        let unique = report
            .embeds
            .iter()
            .find(|embed| embed.resolution.reference.raw == "![[Unique#^intro]]")
            .expect("fixture should render the selected block embed");
        assert!(matches!(
            unique.resolution.disposition,
            VaultNoteEmbedDisposition::Included(_)
        ));
        assert_eq!(unique.children.len(), 1);
        assert!(matches!(
            unique.children[0].resolution.disposition,
            VaultNoteEmbedDisposition::Blocked(TransclusionBlockReason::Cycle)
        ));
        assert!(report.embeds.iter().any(|embed| {
            embed.resolution.reference.raw == "![[Assets/plot.svg]]"
                && embed.resolution.disposition == VaultNoteEmbedDisposition::NotRendered
                && embed.resolution.resolution.target.as_deref() == Some("Assets/plot.svg")
        }));
        harness.get_by_label("Note transclusions");
        harness.get_by_label("Rendered transcluded heading");
        harness.get_by_label("Unsupported Markdown (wiki links); showing the source as written.");
        harness.get_by_label("Opening **formatted paragraph** ![[Unique]]");
        harness.get_by_label("Not rendered: this embed would create a cycle. ![[Unique]]");
        harness.get_by_label(
            "Not rendered: this attachment type or size is outside the safe image preview limits. ![[Assets/plot.svg]]",
        );
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            before_vault,
            "nested note transclusion must not change any vault path or byte"
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            before_vault,
            "nested note transclusion teardown must preserve the full vault snapshot"
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data,
            "nested note transclusion teardown must preserve separate app data"
        );
    }

    #[test]
    fn egui_does_not_render_note_embeds_that_escape_the_vault() {
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        let outside_path = temporary.0.join("Outside.md");
        let note_path = vault_path.join("Notes/Containment.md");
        std::fs::create_dir_all(
            note_path
                .parent()
                .expect("containment note must have a parent directory"),
        )
        .expect("create existing vault directory");
        std::fs::create_dir_all(app_data_path.join("state"))
            .expect("create separate app-data directory");

        let note_source = b"# Containment\n\n[Outside note](../../Outside.md)\n\n![[../../Outside.md|outside note]]\n";
        let outside_source = b"# Private outside note\nThis content must not be rendered.\n";
        let app_data_sentinel = [0xa5, 0x00, 0x7e, 0xff];
        std::fs::write(&note_path, note_source).expect("seed vault note before the baseline");
        std::fs::write(&outside_path, outside_source)
            .expect("seed outside target before the baseline");
        std::fs::write(
            app_data_path.join("state/open-state.bin"),
            app_data_sentinel,
        )
        .expect("seed separate app-data sentinel");

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let before_outside = std::fs::read(&outside_path).expect("read outside target baseline");
        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing vault without conversion");
        assert_eq!(session.entries().len(), 1);
        assert_eq!(
            session.entries()[0].relative_path,
            PathBuf::from("Notes/Containment.md")
        );

        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(PathBuf::from("Notes/Containment.md")),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);
        harness.get_by_label("Resolve link status").click();
        harness.step();
        wait_for_links(&mut harness);

        {
            let app = harness.state();
            assert!(app.link_error.is_none());
            assert_eq!(app.link_resolutions.len(), 2);
            assert!(app.link_resolutions.iter().all(|resolution| {
                resolution.reference.target == "../../Outside.md"
                    && resolution.resolution.status == LinkResolutionStatus::Unresolved
                    && resolution.resolution.target.is_none()
                    && resolution.resolution.candidates == vec!["../../Outside.md".to_owned()]
            }));

            let report = app
                .note_embed_report
                .as_ref()
                .expect("outside-vault embed should produce a read-only report");
            assert_eq!(report.embeds.len(), 1);
            let embed = &report.embeds[0];
            assert_eq!(
                embed.resolution.resolution.status,
                LinkResolutionStatus::Unresolved
            );
            assert!(embed.resolution.resolution.target.is_none());
            assert_eq!(
                embed.resolution.disposition,
                VaultNoteEmbedDisposition::NotRendered
            );
            assert!(embed.children.is_empty());
            assert!(!format!("{report:?}").contains("This content must not be rendered."));
        }

        harness.get_by_label("Unresolved: 2");
        let not_rendered_label = "Not rendered: no matching Markdown note or vault attachment was found. ![[../../Outside.md|outside note]]";
        harness.get_by_label(not_rendered_label);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
        assert_eq!(
            std::fs::read(&outside_path).expect("read outside target after preview"),
            before_outside
        );

        drop(harness);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
        assert_eq!(
            std::fs::read(&outside_path).expect("read outside target after teardown"),
            before_outside
        );
    }

    #[test]
    fn egui_does_not_follow_vault_symlinks_to_outside_targets() {
        let fixture: serde_json::Value = serde_json::from_str(VAULT_SAFETY_FIXTURE)
            .expect("vault-safety fixture must be valid JSON");
        let symlink_profile = fixture["profiles"]
            .as_array()
            .expect("vault-safety fixture must contain profiles")
            .iter()
            .find(|profile| profile["id"] == "fixture:symlink-boundary")
            .expect("vault-safety fixture must define the symlink boundary");
        assert!(
            symlink_profile["assertions"]
                .as_array()
                .expect("symlink profile must list assertions")
                .iter()
                .any(|assertion| assertion == "symlink metadata is recorded")
        );

        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        let outside_path = temporary.0.join("Outside");
        let outside_note_path = outside_path.join("Secret.md");
        let note_relative_path = PathBuf::from("Notes/Containment.md");
        let note_path = vault_path.join(&note_relative_path);
        let file_symlink_path = vault_path.join("Notes/Alias.md");
        let directory_symlink_path = vault_path.join("Notes/linked-dir");
        std::fs::create_dir_all(note_path.parent().unwrap())
            .expect("create existing vault note directory");
        std::fs::create_dir_all(&outside_path).expect("create outside target directory");
        std::fs::create_dir_all(app_data_path.join("state"))
            .expect("create separate app-data directory");

        let note_source = b"# Containment\n\n[Outside file](Alias.md)\n\n![[Alias]]\n\n[Outside directory](linked-dir/Secret.md)\n\n![[linked-dir/Secret]]\n";
        let outside_source = b"# Private outside note\nOUTSIDE_SYMLINK_SENTINEL_R269\n";
        let app_data_sentinel = [0xa5, 0x00, 0x7e, 0xff];
        std::fs::write(&note_path, note_source).expect("seed vault note before the baseline");
        std::fs::write(&outside_note_path, outside_source)
            .expect("seed outside target before the baseline");
        std::fs::write(
            app_data_path.join("state/open-state.bin"),
            app_data_sentinel,
        )
        .expect("seed separate app-data sentinel");

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("../../Outside/Secret.md", &file_symlink_path)
                .expect("create outside-target file symlink");
            std::os::unix::fs::symlink("../../Outside", &directory_symlink_path)
                .expect("create outside-target directory symlink");
        }
        #[cfg(windows)]
        {
            std::os::windows::fs::symlink_file("../../Outside/Secret.md", &file_symlink_path)
                .expect("create outside-target file symlink");
            std::os::windows::fs::symlink_dir("../../Outside", &directory_symlink_path)
                .expect("create outside-target directory symlink");
        }

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let before_outside = existing_vault_tree_snapshot(&outside_path);
        assert!(
            before_vault
                .iter()
                .any(|(path, kind, _)| { path == Path::new("Notes/Alias.md") && *kind == 2 })
        );
        assert!(
            before_vault
                .iter()
                .any(|(path, kind, _)| { path == Path::new("Notes/linked-dir") && *kind == 2 })
        );

        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing vault without following symlinks");
        assert_eq!(session.entries().len(), 1);
        assert_eq!(session.entries()[0].relative_path, note_relative_path);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
        assert_eq!(existing_vault_tree_snapshot(&outside_path), before_outside);

        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(PathBuf::from("Notes/Containment.md")),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);
        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);

        {
            let app = harness.state();
            assert!(app.link_error.is_none());
            assert_eq!(app.link_resolutions.len(), 4);
            assert!(app.link_resolutions.iter().all(|resolution| {
                resolution.resolution.status == LinkResolutionStatus::Unresolved
                    && resolution.resolution.target.is_none()
            }));

            let report = app
                .note_embed_report
                .as_ref()
                .expect("outside-target embeds should produce a read-only report");
            assert_eq!(report.embeds.len(), 2);
            assert!(report.embeds.iter().all(|embed| {
                embed.resolution.resolution.status == LinkResolutionStatus::Unresolved
                    && embed.resolution.resolution.target.is_none()
                    && embed.resolution.disposition == VaultNoteEmbedDisposition::NotRendered
                    && embed.children.is_empty()
            }));
            let report_debug = format!("{report:?}");
            assert!(!report_debug.contains("OUTSIDE_SYMLINK_SENTINEL_R269"));
        }

        harness.get_by_label("Unresolved: 4");
        harness.get_by_label("Note transclusions");
        harness.get_by_label(
            "Not rendered: no matching Markdown note or vault attachment was found. ![[Alias]]",
        );
        harness.get_by_label(
            "Not rendered: no matching Markdown note or vault attachment was found. ![[linked-dir/Secret]]",
        );
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
        assert_eq!(existing_vault_tree_snapshot(&outside_path), before_outside);

        drop(harness);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
        assert_eq!(existing_vault_tree_snapshot(&outside_path), before_outside);
    }

    #[test]
    fn egui_keeps_dangling_vault_symlinks_unresolved() {
        let fixture: serde_json::Value = serde_json::from_str(VAULT_SAFETY_FIXTURE)
            .expect("vault-safety fixture must be valid JSON");
        let symlink_profile = fixture["profiles"]
            .as_array()
            .expect("vault-safety fixture must contain profiles")
            .iter()
            .find(|profile| profile["id"] == "fixture:symlink-boundary")
            .expect("vault-safety fixture must define the symlink boundary");
        assert!(
            symlink_profile["assertions"]
                .as_array()
                .expect("symlink profile must list assertions")
                .iter()
                .any(|assertion| assertion == "symlink metadata is recorded")
        );

        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        let outside_path = temporary.0.join("Outside");
        let note_relative_path = PathBuf::from("Notes/Containment.md");
        let note_path = vault_path.join(&note_relative_path);
        let file_symlink_path = vault_path.join("Notes/Missing.md");
        let directory_symlink_path = vault_path.join("Notes/missing-dir");
        std::fs::create_dir_all(note_path.parent().unwrap())
            .expect("create existing vault note directory");
        std::fs::create_dir_all(&outside_path).expect("create outside target directory");
        std::fs::create_dir_all(app_data_path.join("state"))
            .expect("create separate app-data directory");

        let note_source = b"# Dangling links\n\n[Missing file](Missing.md)\n\n![[Missing]]\n\n[Missing directory](missing-dir/Secret.md)\n\n![[missing-dir/Secret]]\n";
        let outside_source = b"# Outside sentinel\nOUTSIDE_DANGLING_SYMLINK_SENTINEL_R270\n";
        let app_data_sentinel = [0xa5, 0x00, 0x7e, 0xff];
        std::fs::write(&note_path, note_source).expect("seed vault note before the baseline");
        std::fs::write(outside_path.join("Secret.md"), outside_source)
            .expect("seed unrelated outside sentinel before the baseline");
        std::fs::write(
            app_data_path.join("state/open-state.bin"),
            app_data_sentinel,
        )
        .expect("seed separate app-data sentinel");

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("../../Outside/Missing.md", &file_symlink_path)
                .expect("create dangling outside-target file symlink");
            std::os::unix::fs::symlink("../../Outside/Missing Directory", &directory_symlink_path)
                .expect("create dangling outside-target directory symlink");
        }
        #[cfg(windows)]
        {
            std::os::windows::fs::symlink_file("../../Outside/Missing.md", &file_symlink_path)
                .expect("create dangling outside-target file symlink");
            std::os::windows::fs::symlink_dir(
                "../../Outside/Missing Directory",
                &directory_symlink_path,
            )
            .expect("create dangling outside-target directory symlink");
        }

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        let before_outside = existing_vault_tree_snapshot(&outside_path);
        assert!(
            before_vault
                .iter()
                .any(|(path, kind, _)| { path == Path::new("Notes/Missing.md") && *kind == 2 })
        );
        assert!(
            before_vault
                .iter()
                .any(|(path, kind, _)| { path == Path::new("Notes/missing-dir") && *kind == 2 })
        );

        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing vault without following dangling symlinks");
        assert_eq!(session.entries().len(), 1);
        assert_eq!(session.entries()[0].relative_path, note_relative_path);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
        assert_eq!(existing_vault_tree_snapshot(&outside_path), before_outside);

        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(PathBuf::from("Notes/Containment.md")),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);
        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);

        {
            let app = harness.state();
            assert!(app.link_error.is_none());
            assert_eq!(app.link_resolutions.len(), 4);
            assert!(app.link_resolutions.iter().all(|resolution| {
                resolution.resolution.status == LinkResolutionStatus::Unresolved
                    && resolution.resolution.target.is_none()
            }));

            let report = app
                .note_embed_report
                .as_ref()
                .expect("dangling-target embeds should produce a read-only report");
            assert_eq!(report.embeds.len(), 2);
            assert!(report.embeds.iter().all(|embed| {
                embed.resolution.resolution.status == LinkResolutionStatus::Unresolved
                    && embed.resolution.resolution.target.is_none()
                    && embed.resolution.disposition == VaultNoteEmbedDisposition::NotRendered
                    && embed.children.is_empty()
            }));
            let report_debug = format!("{report:?}");
            assert!(!report_debug.contains("OUTSIDE_DANGLING_SYMLINK_SENTINEL_R270"));
        }

        harness.get_by_label("Unresolved: 4");
        harness.get_by_label("Note transclusions");
        harness.get_by_label(
            "Not rendered: no matching Markdown note or vault attachment was found. ![[Missing]]",
        );
        harness.get_by_label(
            "Not rendered: no matching Markdown note or vault attachment was found. ![[missing-dir/Secret]]",
        );
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
        assert_eq!(existing_vault_tree_snapshot(&outside_path), before_outside);

        drop(harness);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
        assert_eq!(existing_vault_tree_snapshot(&outside_path), before_outside);
    }

    #[test]
    fn egui_does_not_follow_in_vault_symlink_targets() {
        let fixture: serde_json::Value = serde_json::from_str(VAULT_SAFETY_FIXTURE)
            .expect("vault-safety fixture must be valid JSON");
        let symlink_profile = fixture["profiles"]
            .as_array()
            .expect("vault-safety fixture must contain profiles")
            .iter()
            .find(|profile| profile["id"] == "fixture:symlink-boundary")
            .expect("vault-safety fixture must define the symlink boundary");
        assert!(
            symlink_profile["assertions"]
                .as_array()
                .expect("symlink profile must list assertions")
                .iter()
                .any(|assertion| assertion == "symlink metadata is recorded")
        );

        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        let note_relative_path = PathBuf::from("Notes/Containment.md");
        let note_path = vault_path.join(&note_relative_path);
        let file_symlink_path = vault_path.join("Notes/Alias.md");
        let directory_symlink_path = vault_path.join("Notes/linked-dir");
        let file_target_path = vault_path.join("Notes/Secret.md");
        let directory_target_path = vault_path.join("Notes/Real Directory/Secret.md");
        std::fs::create_dir_all(note_path.parent().unwrap())
            .expect("create existing vault note directory");
        std::fs::create_dir_all(directory_target_path.parent().unwrap())
            .expect("create in-vault symlink target directory");
        std::fs::create_dir_all(app_data_path.join("state"))
            .expect("create separate app-data directory");

        let note_source = b"# In-vault symlinks\n\n[File alias](Alias.md)\n\n![[Alias]]\n\n[Directory alias](linked-dir/Secret.md)\n\n![[linked-dir/Secret]]\n";
        let target_source = b"# Private target\nIN_VAULT_SYMLINK_TARGET_SENTINEL_R271\n";
        let app_data_sentinel = [0xa5, 0x00, 0x7e, 0xff];
        std::fs::write(&note_path, note_source).expect("seed source note before the baseline");
        std::fs::write(&file_target_path, target_source)
            .expect("seed in-vault file target before the baseline");
        std::fs::write(&directory_target_path, target_source)
            .expect("seed in-vault directory target before the baseline");
        std::fs::write(
            app_data_path.join("state/open-state.bin"),
            app_data_sentinel,
        )
        .expect("seed separate app-data sentinel");

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("Secret.md", &file_symlink_path)
                .expect("create in-vault file symlink");
            std::os::unix::fs::symlink("Real Directory", &directory_symlink_path)
                .expect("create in-vault directory symlink");
        }
        #[cfg(windows)]
        {
            std::os::windows::fs::symlink_file("Secret.md", &file_symlink_path)
                .expect("create in-vault file symlink");
            std::os::windows::fs::symlink_dir("Real Directory", &directory_symlink_path)
                .expect("create in-vault directory symlink");
        }

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        assert_eq!(
            std::fs::read_link(&file_symlink_path).expect("read file symlink metadata"),
            PathBuf::from("Secret.md")
        );
        assert_eq!(
            std::fs::read_link(&directory_symlink_path).expect("read directory symlink metadata"),
            PathBuf::from("Real Directory")
        );
        assert!(
            before_vault
                .iter()
                .any(|(path, kind, _)| { path == Path::new("Notes/Alias.md") && *kind == 2 })
        );
        assert!(
            before_vault
                .iter()
                .any(|(path, kind, _)| { path == Path::new("Notes/linked-dir") && *kind == 2 })
        );

        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing vault without following in-vault symlinks");
        assert_eq!(session.entries().len(), 3);
        assert!(
            session
                .entries()
                .iter()
                .any(|entry| entry.relative_path == note_relative_path)
        );
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(PathBuf::from("Notes/Containment.md")),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);
        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);

        {
            let app = harness.state();
            assert!(app.link_error.is_none());
            assert_eq!(app.link_resolutions.len(), 4);
            assert!(app.link_resolutions.iter().all(|resolution| {
                resolution.resolution.status == LinkResolutionStatus::Unresolved
                    && resolution.resolution.target.is_none()
            }));

            let report = app
                .note_embed_report
                .as_ref()
                .expect("in-vault symlink embeds should produce a read-only report");
            assert_eq!(report.embeds.len(), 2);
            assert!(report.embeds.iter().all(|embed| {
                embed.resolution.resolution.status == LinkResolutionStatus::Unresolved
                    && embed.resolution.resolution.target.is_none()
                    && embed.resolution.disposition == VaultNoteEmbedDisposition::NotRendered
                    && embed.children.is_empty()
            }));
            let report_debug = format!("{report:?}");
            assert!(!report_debug.contains("IN_VAULT_SYMLINK_TARGET_SENTINEL_R271"));
        }

        harness.get_by_label("Unresolved: 4");
        harness.get_by_label("Note transclusions");
        harness.get_by_label(
            "Not rendered: no matching Markdown note or vault attachment was found. ![[Alias]]",
        );
        harness.get_by_label(
            "Not rendered: no matching Markdown note or vault attachment was found. ![[linked-dir/Secret]]",
        );
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_does_not_recurse_or_follow_directory_symlink_cycles() {
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        let note_relative_path = PathBuf::from("Notes/Containment.md");
        let note_path = vault_path.join(&note_relative_path);
        let target_path = vault_path.join("Notes/Secret.md");
        let cycle_symlink_path = vault_path.join("Notes/loop");
        std::fs::create_dir_all(note_path.parent().unwrap())
            .expect("create existing vault note directory");
        std::fs::create_dir_all(app_data_path.join("state"))
            .expect("create separate app-data directory");

        let note_source = b"# Symlink cycle\n\n[Directory alias](Notes/loop/Secret.md)\n\n![[Notes/loop/Secret]]\n\n[Repeated cycle](Notes/loop/loop/Secret.md)\n\n![[Notes/loop/loop/Secret]]\n";
        let target_source = b"# Cycle target\nDIRECTORY_SYMLINK_CYCLE_TARGET_SENTINEL_R272\n";
        let app_data_sentinel = [0xa5, 0x00, 0x7e, 0xff];
        std::fs::write(&note_path, note_source).expect("seed source note before the baseline");
        std::fs::write(&target_path, target_source).expect("seed cycle target before the baseline");
        std::fs::write(
            app_data_path.join("state/open-state.bin"),
            app_data_sentinel,
        )
        .expect("seed separate app-data sentinel");

        #[cfg(unix)]
        std::os::unix::fs::symlink(".", &cycle_symlink_path)
            .expect("create directory symlink cycle");
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(".", &cycle_symlink_path)
            .expect("create directory symlink cycle");

        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path);
        assert_eq!(
            std::fs::read_link(&cycle_symlink_path).expect("read cycle symlink metadata"),
            PathBuf::from(".")
        );
        assert!(
            before_vault
                .iter()
                .any(|(path, kind, _)| { path == Path::new("Notes/loop") && *kind == 2 })
        );

        let session = VaultSession::open(&vault_path, &app_data_path)
            .expect("open existing vault without recursing into a symlink cycle");
        assert_eq!(session.entries().len(), 2);
        assert!(
            session
                .entries()
                .iter()
                .any(|entry| entry.relative_path == note_relative_path)
        );
        assert!(
            session
                .entries()
                .iter()
                .any(|entry| entry.relative_path.as_path() == Path::new("Notes/Secret.md"))
        );
        assert!(matches!(
            session.read("Notes/loop/Secret.md"),
            Err(VaultError::Symlink(_))
        ));
        assert!(matches!(
            session.read_preview("Notes/loop/loop/Secret.md"),
            Err(VaultError::Symlink(_))
        ));
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(note_relative_path),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);
        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);

        {
            let app = harness.state();
            assert!(app.link_error.is_none());
            assert_eq!(app.link_resolutions.len(), 4);
            assert!(app.link_resolutions.iter().all(|resolution| {
                resolution.resolution.status == LinkResolutionStatus::Unresolved
                    && resolution.resolution.target.is_none()
            }));

            let report = app
                .note_embed_report
                .as_ref()
                .expect("symlink-cycle embeds should produce a read-only report");
            assert_eq!(report.embeds.len(), 2);
            assert!(report.embeds.iter().all(|embed| {
                embed.resolution.resolution.status == LinkResolutionStatus::Unresolved
                    && embed.resolution.resolution.target.is_none()
                    && embed.resolution.disposition == VaultNoteEmbedDisposition::NotRendered
                    && embed.children.is_empty()
            }));
            let report_debug = format!("{report:?}");
            assert!(!report_debug.contains("DIRECTORY_SYMLINK_CYCLE_TARGET_SENTINEL_R272"));
        }

        harness.get_by_label("Unresolved: 4");
        harness.get_by_label("Note transclusions");
        harness.get_by_label(
            "Not rendered: no matching Markdown note or vault attachment was found. ![[Notes/loop/Secret]]",
        );
        harness.get_by_label(
            "Not rendered: no matching Markdown note or vault attachment was found. ![[Notes/loop/loop/Secret]]",
        );
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );

        drop(harness);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            before_app_data
        );
    }

    #[test]
    fn egui_previews_existing_vault_attachment_without_changing_its_tree() {
        let fixture: serde_json::Value = serde_json::from_str(EXISTING_VAULT_FIXTURE)
            .expect("existing-vault fixture must be valid JSON");
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = UiTempDir::new();
        std::fs::create_dir_all(&vault_path).unwrap();
        materialize_existing_vault_fixture(&vault_path, &fixture);
        std::fs::create_dir_all(vault_path.join("Attachments")).unwrap();
        std::fs::create_dir_all(vault_path.join("Notes")).unwrap();
        std::fs::write(
            vault_path.join("Notes/Image Preview.md"),
            b"![[Attachments/photo.png|Accessible red dot]]\n",
        )
        .unwrap();
        let source_image = include_bytes!("../../../assets/openobsidian-icon.png");
        std::fs::write(vault_path.join("Attachments/photo.png"), source_image).unwrap();
        let before_vault = existing_vault_tree_snapshot(&vault_path);
        let before_app_data = existing_vault_tree_snapshot(&app_data_path.0);
        let session = VaultSession::open(&vault_path, &app_data_path.0).unwrap();
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path.0),
            before_app_data
        );
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            link_source_path: Some(Path::new("Notes/Image Preview.md").to_path_buf()),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Resolve link status").click();
        harness.step();
        assert!(harness.state().link_receiver.is_some());
        wait_for_links(&mut harness);
        assert!(harness.state().link_error.is_none());
        assert!(harness.state().note_embed_error.is_none());
        let report = harness
            .state()
            .note_embed_report
            .as_ref()
            .expect("the existing-vault attachment should be previewed");
        assert_eq!(report.embeds.len(), 1);
        assert!(matches!(
            &report.embeds[0].resolution.disposition,
            VaultNoteEmbedDisposition::Attachment(image)
                if image.width > 0
                    && image.height > 0
                    && image.rgba_bytes.len() == (image.width * image.height * 4) as usize
        ));
        harness.get_by_label("Accessible red dot");
        assert_eq!(harness.state().inline_image_textures.len(), 1);
        assert_eq!(harness.state().link_resolutions.len(), 1);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            before_vault,
            "opening and rendering an embedded attachment must not change any existing-vault path or byte"
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path.0),
            before_app_data
        );

        drop(harness);
        assert_eq!(existing_vault_tree_snapshot(&vault_path), before_vault);
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path.0),
            before_app_data
        );
    }

    #[test]
    fn egui_history_review_requires_confirmation_and_preserves_protected_conflicts() {
        let fixture: serde_json::Value = serde_json::from_str(HISTORY_RETENTION_FIXTURE)
            .expect("history retention fixture must be valid");
        assert_eq!(fixture["id"], "fixture:history-retention");
        let scenario = &fixture["scenario"];
        let expected = &scenario["expected"];
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("vault");
        let app_data_path = temporary.0.join("app-data");
        std::fs::create_dir_all(&vault_path).unwrap();
        std::fs::create_dir_all(&app_data_path).unwrap();
        let existing_vault_fixture: serde_json::Value =
            serde_json::from_str(EXISTING_VAULT_FIXTURE)
                .expect("existing-vault fixture must be valid JSON");
        materialize_existing_vault_fixture(&vault_path, &existing_vault_fixture);

        let mut original_vault_files = Vec::new();
        for file in scenario["vault"]["files"]
            .as_array()
            .expect("fixture vault files must be an array")
        {
            let relative_path = std::path::PathBuf::from(
                file["relative_path"]
                    .as_str()
                    .expect("fixture vault file must state a path"),
            );
            let source = file["source"]
                .as_str()
                .expect("fixture vault file must state its source")
                .as_bytes()
                .to_vec();
            let path = vault_path.join(&relative_path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, &source).unwrap();
            original_vault_files.push((relative_path, source));
        }
        let original_vault_tree = existing_vault_tree_snapshot(&vault_path);

        let mut original_history_files = Vec::new();
        for record in scenario["history_records"]
            .as_array()
            .expect("fixture history records must be an array")
        {
            let kind = record["kind"]
                .as_str()
                .expect("fixture history record must state a kind");
            let id = record["id"]
                .as_str()
                .expect("fixture history record must state an id");
            let relative_path = record["relative_path"]
                .as_str()
                .expect("fixture history record must state a vault path");
            let captured_at = record["captured_at"]
                .as_str()
                .expect("fixture history record must state a capture time");
            let revision = record["revision"]
                .as_str()
                .expect("fixture history record must state a revision");
            let source = record["artifact_source"]
                .as_str()
                .expect("fixture history record must state artifact bytes")
                .as_bytes()
                .to_vec();
            let (directory, extension) = match kind {
                "recovery" => ("recovery", ".bin"),
                "conflict" => ("conflicts", ".incoming"),
                other => panic!("unknown history kind in fixture: {other}"),
            };
            let history_directory = app_data_path.join(directory);
            std::fs::create_dir_all(&history_directory).unwrap();
            let artifact_path = history_directory.join(format!("{id}{extension}"));
            let metadata_path = history_directory.join(format!("{id}.json"));
            std::fs::write(&artifact_path, &source).unwrap();
            let metadata = serde_json::json!({
                "id": id,
                "relative_path": relative_path,
                "revision": revision,
                "bytes": source.len(),
                "path": artifact_path.to_string_lossy(),
                "captured_at": captured_at,
                "expected_revision": record["expected_revision"],
                "current_revision": record["current_revision"],
            });
            std::fs::write(&metadata_path, serde_json::to_vec(&metadata).unwrap()).unwrap();
            original_history_files.push((artifact_path, source));
            original_history_files
                .push((metadata_path.clone(), std::fs::read(metadata_path).unwrap()));
        }

        let session = VaultSession::open(&vault_path, &app_data_path).unwrap();
        let listed_records = session.history_records().unwrap_or_else(|error| {
            panic!("fixture history must be readable through VaultSession: {error:?}")
        });
        let original_app_data_tree = existing_vault_tree_snapshot(&app_data_path);
        assert_eq!(
            listed_records.len(),
            usize::try_from(expected["initial_record_count"].as_u64().unwrap()).unwrap()
        );
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            history_policy: VaultHistoryPolicy {
                max_age_days: scenario["policy"]["max_age_days"]
                    .as_u64()
                    .expect("fixture must state a retention age"),
                max_bytes: scenario["policy"]["max_bytes"]
                    .as_u64()
                    .expect("fixture must state a retention cap"),
            },
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness
            .get_by_label("Refresh history and retention preview")
            .click();
        harness.step();
        assert!(
            harness.state().history_receiver.is_some(),
            "refresh interaction must start the background history task"
        );
        wait_for_history(&mut harness);

        let app = harness.state();
        assert!(
            app.history_error.is_none(),
            "history preview failed: {:?}",
            app.history_error
        );
        let preview = app
            .history_plan
            .as_ref()
            .expect("the refresh interaction should produce a retention plan");
        assert_eq!(
            app.history_records.len(),
            usize::try_from(expected["initial_record_count"].as_u64().unwrap()).unwrap()
        );
        assert_eq!(
            preview
                .pruneable
                .iter()
                .map(|record| record.id.as_str())
                .collect::<Vec<_>>(),
            expected["eligible_ids"]
                .as_array()
                .unwrap()
                .iter()
                .map(|id| id.as_str().unwrap())
                .collect::<Vec<_>>()
        );
        assert_eq!(
            preview
                .protected
                .iter()
                .map(|record| record.id.as_str())
                .collect::<Vec<_>>(),
            expected["protected_ids"]
                .as_array()
                .unwrap()
                .iter()
                .map(|id| id.as_str().unwrap())
                .collect::<Vec<_>>()
        );
        assert_eq!(preview.warning, expected["warning"].as_bool().unwrap());
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            original_vault_tree
        );
        for (path, source) in &original_history_files {
            assert_eq!(std::fs::read(path).unwrap(), *source);
        }
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            original_app_data_tree
        );

        harness.get_by_label("Review eligible cleanup").click();
        harness.step();
        assert!(harness.state().cleanup_confirmation);
        harness.step();
        assert!(std::fs::exists(app_data_path.join("recovery/old-recovery.bin")).unwrap());
        assert!(std::fs::exists(app_data_path.join("conflicts/open-conflict.incoming")).unwrap());
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            original_vault_tree
        );

        harness.get_by_label("Confirm cleanup").click();
        harness.step();
        wait_for_history(&mut harness);

        let app = harness.state();
        assert_eq!(
            app.history_status.as_deref(),
            expected["cleanup_status"].as_str()
        );
        assert_eq!(
            app.history_records
                .iter()
                .map(|record| record.id.as_str())
                .collect::<Vec<_>>(),
            expected["remaining_record_ids"]
                .as_array()
                .unwrap()
                .iter()
                .map(|id| id.as_str().unwrap())
                .collect::<Vec<_>>()
        );
        assert_eq!(
            app.history_plan.as_ref().unwrap().protected.len(),
            expected["protected_ids"].as_array().unwrap().len()
        );
        assert!(app.history_plan.as_ref().unwrap().pruneable.is_empty());
        assert!(!std::fs::exists(app_data_path.join("recovery/old-recovery.bin")).unwrap());
        assert!(!std::fs::exists(app_data_path.join("recovery/old-recovery.json")).unwrap());
        assert!(expected["vault_bytes_remain_identical"].as_bool() == Some(true));
        assert!(expected["protected_conflict_bytes_remain_identical"].as_bool() == Some(true));
        assert!(std::fs::exists(app_data_path.join("conflicts/open-conflict.incoming")).unwrap());
        assert!(std::fs::exists(app_data_path.join("conflicts/open-conflict.json")).unwrap());
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            original_vault_tree
        );
        for (relative_path, source) in &original_vault_files {
            assert_eq!(
                std::fs::read(vault_path.join(relative_path)).unwrap(),
                *source
            );
        }
        for (path, source) in original_history_files
            .iter()
            .filter(|(path, _)| path.starts_with(app_data_path.join("conflicts")))
        {
            assert_eq!(std::fs::read(path).unwrap(), *source);
        }
        let post_cleanup_app_data_tree = existing_vault_tree_snapshot(&app_data_path);

        harness.get_by_label("Inspect conflict").click();
        harness.step();
        wait_for_history(&mut harness);
        let inspection = harness
            .state()
            .conflict_inspection
            .as_ref()
            .expect("the conflict inspection action should load both versions");
        assert_eq!(inspection.record.id, "open-conflict");
        assert_eq!(
            inspection.record.relative_path.to_string_lossy(),
            "notes/current.md"
        );
        assert_eq!(
            inspection
                .current
                .as_ref()
                .map(|current| current.text.as_str()),
            Some("Current vault bytes.\r\n")
        );
        assert_eq!(inspection.incoming.text, "Incoming conflicted bytes.\r\n");
        harness.get_by_label("Conflict inspection: notes/current.md");
        harness.get_by_label("Current version");
        harness.get_by_label("Incoming version");
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            original_vault_tree
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            post_cleanup_app_data_tree
        );
        for (path, source) in original_history_files
            .iter()
            .filter(|(path, _)| path.starts_with(app_data_path.join("conflicts")))
        {
            assert_eq!(std::fs::read(path).unwrap(), *source);
        }
        harness.fit_contents();
        harness.get_by_label("Close inspection").click();
        harness.step();
        assert!(harness.state().conflict_inspection.is_none());
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            original_vault_tree
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            post_cleanup_app_data_tree
        );
        drop(harness);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            original_vault_tree
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            post_cleanup_app_data_tree
        );
    }

    #[test]
    fn egui_over_cap_history_warning_does_not_start_cleanup() {
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("vault");
        let app_data_path = temporary.0.join("app-data");
        std::fs::create_dir(&vault_path).unwrap();
        std::fs::create_dir(&app_data_path).unwrap();
        let session = VaultSession::open(&vault_path, &app_data_path).unwrap();

        let now = SystemTime::now();
        let policy = VaultHistoryPolicy {
            max_age_days: 30,
            max_bytes: GIBIBYTE / 10 + 1,
        };
        let protected_bytes = policy.max_bytes + 1;
        let records = vec![
            VaultHistoryRecord {
                id: "over-cap-conflict".to_owned(),
                relative_path: PathBuf::from("notes/current.md"),
                revision_sha256: "a".repeat(64),
                bytes: protected_bytes,
                captured_at: now,
                kind: VaultHistoryKind::Conflict,
                protected: true,
                expected_revision_sha256: Some("b".repeat(64)),
                current_revision_sha256: Some("c".repeat(64)),
            },
            VaultHistoryRecord {
                id: "aged-recovery".to_owned(),
                relative_path: PathBuf::from("notes/current.md"),
                revision_sha256: "d".repeat(64),
                bytes: 64,
                captured_at: SystemTime::UNIX_EPOCH,
                kind: VaultHistoryKind::Recovery,
                protected: false,
                expected_revision_sha256: None,
                current_revision_sha256: None,
            },
        ];
        let plan = plan_history_retention(&records, policy, now);
        assert!(plan.warning);
        assert_eq!(plan.pruneable.len(), 1);

        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            history_policy: policy,
            history_records: records,
            history_plan: Some(plan),
            ..OpenObsidianApp::default()
        };
        let harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness
            .get_by_label("Protected history exceeds the configured size limit and will be kept.");
        harness.get_by_label("Review eligible cleanup");
        let app = harness.state();
        assert!(app.history_plan.as_ref().unwrap().warning);
        assert!(!app.cleanup_confirmation);
        assert!(app.history_receiver.is_none());
        assert!(app.history_status.is_none());
        assert_eq!(app.history_records.len(), 2);
    }

    #[test]
    fn conflict_preview_is_bounded_and_omits_binary_bytes() {
        let long_text = "é".repeat(10_000);
        let preview = bounded_text_preview(long_text.as_bytes());
        assert!(preview.starts_with("é"));
        assert!(preview.ends_with("… preview truncated …"));
        assert_eq!(
            bounded_text_preview(&[0xff, 0x00]),
            "<Binary content; 2 bytes; preview omitted>"
        );
    }

    #[test]
    fn conflict_action_labels_are_explicit() {
        assert_eq!(
            conflict_action_label(VaultConflictAction::KeepCurrent),
            "Keep Current"
        );
        assert_eq!(
            conflict_action_label(VaultConflictAction::KeepIncoming),
            "Keep Incoming"
        );
    }

    #[test]
    fn rename_action_labels_explain_which_references_remain_unchanged() {
        assert_eq!(rename_action_label(LinkRenameAction::Update), "Will update");
        assert_eq!(
            rename_action_label(LinkRenameAction::SkipAmbiguous),
            "Ambiguous; will stay unchanged"
        );
        assert_eq!(
            rename_action_label(LinkRenameAction::SkipUnresolved),
            "Unresolved; will stay unchanged"
        );
    }

    #[test]
    fn storage_status_labels_keep_unknown_explicit() {
        assert_eq!(
            storage_protection_label(StorageProtectionDisplayStatus::Enabled),
            "Enabled (OS reported)"
        );
        assert_eq!(
            storage_protection_label(StorageProtectionDisplayStatus::Disabled),
            "Disabled (OS reported)"
        );
        assert_eq!(
            storage_protection_label(StorageProtectionDisplayStatus::Unknown),
            "Unknown (encryption not verified)"
        );
    }

    #[test]
    fn egui_storage_status_refresh_reports_enabled_disabled_and_unknown() {
        let probe_calls = std::sync::Arc::new(AtomicUsize::new(0));
        let calls_from_probe = std::sync::Arc::clone(&probe_calls);
        let app = OpenObsidianApp {
            storage_protection_probe: Some(Box::new(move || {
                let call = calls_from_probe.fetch_add(1, Ordering::SeqCst);
                let (status, detail) = match call {
                    0 => (
                        StorageProtectionDisplayStatus::Enabled,
                        "The OS reported storage protection enabled.",
                    ),
                    1 => (
                        StorageProtectionDisplayStatus::Disabled,
                        "The OS reported storage protection disabled.",
                    ),
                    _ => (
                        StorageProtectionDisplayStatus::Unknown,
                        "Encryption could not be verified by the OS.",
                    ),
                };
                StorageProtectionDisplay {
                    status,
                    method: "fixture OS probe".to_owned(),
                    detail: detail.to_owned(),
                }
            })),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        assert_eq!(probe_calls.load(Ordering::SeqCst), 1);
        harness.get_by_label("Status: Enabled (OS reported)");
        harness.get_by_label("Check: fixture OS probe");
        harness.get_by_label("The OS reported storage protection enabled.");

        harness.step();
        assert_eq!(
            probe_calls.load(Ordering::SeqCst),
            1,
            "ordinary redraws must not re-run the storage probe"
        );

        harness.get_by_label("Refresh storage status").click();
        harness.step();
        assert_eq!(probe_calls.load(Ordering::SeqCst), 2);
        assert_eq!(
            harness
                .state()
                .storage_protection_report
                .as_ref()
                .unwrap()
                .status,
            StorageProtectionDisplayStatus::Disabled
        );
        harness.get_by_label("Status: Disabled (OS reported)");
        harness.get_by_label("The OS reported storage protection disabled.");

        harness.get_by_label("Refresh storage status").click();
        harness.step();
        assert_eq!(probe_calls.load(Ordering::SeqCst), 3);
        assert_eq!(
            harness
                .state()
                .storage_protection_report
                .as_ref()
                .unwrap()
                .status,
            StorageProtectionDisplayStatus::Unknown
        );
        harness.get_by_label("Status: Unknown (encryption not verified)");
        harness.get_by_label("Encryption could not be verified by the OS.");
    }

    #[test]
    fn rename_recovery_summary_reports_restored_and_attention_counts() {
        let recovered = VaultRenameRecoveryReport {
            recovered_operations: vec!["rename-1".to_owned()],
            needs_attention: Vec::new(),
        };
        assert_eq!(
            rename_recovery_summary(&recovered).as_deref(),
            Some("Recovered 1 interrupted rename operation(s) before loading notes.")
        );

        let attention = VaultRenameRecoveryReport {
            recovered_operations: Vec::new(),
            needs_attention: vec![openobsidian_engine::VaultRenameRecoveryIssue {
                operation_id: "rename-2".to_owned(),
                reason: "a source file needs review".to_owned(),
            }],
        };
        assert_eq!(
            rename_recovery_summary(&attention).as_deref(),
            Some("1 interrupted rename operation(s) need attention.")
        );
    }

    #[test]
    fn write_recovery_summary_reports_completed_and_attention_counts() {
        let recovered = VaultWriteRecoveryReport {
            recovered_operations: vec!["write-1".to_owned()],
            needs_attention: Vec::new(),
        };
        assert_eq!(
            write_recovery_summary(&recovered).as_deref(),
            Some("Recovered 1 interrupted write operation(s) before loading notes.")
        );

        let attention = VaultWriteRecoveryReport {
            recovered_operations: Vec::new(),
            needs_attention: vec![openobsidian_engine::VaultWriteRecoveryIssue {
                operation_id: "write-2".to_owned(),
                reason: "incoming bytes need review".to_owned(),
            }],
        };
        assert_eq!(
            write_recovery_summary(&attention).as_deref(),
            Some("1 interrupted write operation(s) need attention.")
        );
    }

    #[test]
    fn egui_rename_flow_applies_fixture_wiki_markdown_and_embed_references() {
        let fixture: serde_json::Value =
            serde_json::from_str(C03_RENAME_FIXTURE).expect("C03 rename fixture must be valid");
        let case = fixture["cases"]
            .as_array()
            .expect("C03 rename fixture must contain cases")
            .iter()
            .find(|case| case["id"] == "resolved-wiki-markdown-embed-and-unrelated-targets")
            .expect("C03 rename fixture must contain the resolved link-form case");
        let old_path = std::path::PathBuf::from(
            case["old_path"]
                .as_str()
                .expect("fixture case must state its source path"),
        );
        let new_path = std::path::PathBuf::from(
            case["new_path"]
                .as_str()
                .expect("fixture case must state its destination path"),
        );
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("vault");
        let app_data_path = temporary.0.join("app-data");
        std::fs::create_dir(&vault_path).unwrap();
        std::fs::create_dir(&app_data_path).unwrap();
        let mut original_files = Vec::new();
        for file in case["files"]
            .as_array()
            .expect("fixture case must list its files")
        {
            let relative_path = std::path::PathBuf::from(
                file["relative_path"]
                    .as_str()
                    .expect("fixture file must state its relative path"),
            );
            let source = file["source"]
                .as_str()
                .expect("fixture file must state its source")
                .as_bytes()
                .to_vec();
            let path = vault_path.join(&relative_path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, &source).unwrap();
            original_files.push((relative_path, source));
        }
        std::fs::create_dir_all(vault_path.join(new_path.parent().unwrap())).unwrap();
        let session = VaultSession::open(&vault_path, &app_data_path).unwrap();
        let app = OpenObsidianApp {
            session: Some(std::sync::Arc::new(session)),
            rename_source_path: Some(old_path.clone()),
            rename_destination_path: new_path.to_string_lossy().into_owned(),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Build rename preview").click();
        harness.step();
        assert!(harness.state().rename_receiver.is_some());
        wait_for_rename(&mut harness);

        let preview = harness
            .state()
            .rename_preview
            .as_ref()
            .expect("the build-preview interaction should produce a preview");
        assert_eq!(preview.plan.update_count, 4);
        assert_eq!(preview.plan.skipped_count, 0);
        assert_eq!(preview.plan.edits.len(), 4);
        assert!(
            preview
                .plan
                .edits
                .iter()
                .all(|edit| edit.action == LinkRenameAction::Update)
        );
        assert!(vault_path.join(&old_path).exists());
        assert!(!vault_path.join(&new_path).exists());
        for (relative_path, original) in &original_files {
            assert_eq!(
                std::fs::read(vault_path.join(relative_path)).unwrap(),
                *original,
                "preview must not mutate {}",
                relative_path.display()
            );
        }

        harness.get_by_label("Review and confirm rename").click();
        harness.step();
        assert!(harness.state().rename_confirmation);
        harness.step();
        harness.get_by_label("Confirm and apply rename").click();
        harness.step();
        assert!(harness.state().rename_receiver.is_some());
        wait_for_rename(&mut harness);

        let app = harness.state();
        assert!(!app.rename_confirmation);
        assert!(app.rename_status.as_deref().is_some_and(|status| {
            status.contains("Updated 4 reference(s)")
                && status.contains("0 ambiguous or unresolved reference(s) were left unchanged")
        }));
        assert!(
            app.session
                .as_ref()
                .unwrap()
                .entries()
                .iter()
                .any(|entry| { entry.relative_path.as_path() == new_path.as_path() })
        );
        assert!(!vault_path.join(&old_path).exists());
        assert!(vault_path.join(&new_path).exists());
        let expected_sources = case["expected_sources"]
            .as_object()
            .expect("fixture must state every expected source");
        for (relative_path, _) in &original_files {
            let actual_path = if relative_path == &old_path {
                &new_path
            } else {
                relative_path
            };
            let expected = expected_sources
                .get(relative_path.to_str().unwrap())
                .expect("fixture must include every expected source")
                .as_str()
                .expect("fixture expected source must be text");
            assert_eq!(
                std::fs::read(vault_path.join(actual_path)).unwrap(),
                expected.as_bytes(),
                "applied fixture bytes at {}",
                actual_path.display()
            );
        }
    }

    #[test]
    fn egui_uninstall_fixture_preserves_vault_and_conflict_bytes() {
        let fixture: serde_json::Value = serde_json::from_str(SYNC_UNINSTALL_FIXTURE)
            .expect("SYNC-007 uninstall fixture must be valid");
        assert_eq!(fixture["id"], "fixture:sync-uninstall");
        let scenario = fixture["scenarios"]
            .as_array()
            .and_then(|scenarios| scenarios.first())
            .expect("SYNC-007 fixture must contain a scenario");
        let expected = &scenario["expected"];
        let temporary = UiTempDir::new();
        let fixture_root = temporary.0.join("fixture");
        let vault_path = fixture_root.join(
            scenario["vault"]["path"]
                .as_str()
                .expect("fixture must name the vault path"),
        );
        let app_data_path = fixture_root.join(
            scenario["app_data"]["path"]
                .as_str()
                .expect("fixture must name the app-data path"),
        );
        std::fs::create_dir_all(&vault_path).unwrap();
        std::fs::create_dir_all(&app_data_path).unwrap();

        let materialize_files = |root: &std::path::Path, files: &serde_json::Value| {
            files
                .as_array()
                .expect("fixture files must be an array")
                .iter()
                .map(|file| {
                    let relative_path = std::path::PathBuf::from(
                        file["relative_path"]
                            .as_str()
                            .expect("fixture file must state its relative path"),
                    );
                    let source = file["source"]
                        .as_str()
                        .expect("fixture file must state its source")
                        .as_bytes()
                        .to_vec();
                    let path = root.join(&relative_path);
                    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                    std::fs::write(path, &source).unwrap();
                    (relative_path, source)
                })
                .collect::<Vec<_>>()
        };
        let original_vault_files = materialize_files(&vault_path, &scenario["vault"]["files"]);
        let original_app_data_files =
            materialize_files(&app_data_path, &scenario["app_data"]["files"]);
        let session = VaultSession::open(&vault_path, &app_data_path).unwrap();
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        assert_eq!(
            uninstall_cleanup_summary(harness.state().uninstall_cleanup),
            expected["initial_summary"]
                .as_str()
                .expect("fixture must state the initial summary")
        );
        for option in scenario["selected_options"]
            .as_array()
            .expect("fixture must list selected cleanup choices")
        {
            let label = match option.as_str().expect("cleanup choice must be a string") {
                "app-cache" => "App cache",
                "credentials" => "Stored credentials",
                "recovery-history" => "Clean up recovery history",
                other => panic!("unknown cleanup choice in fixture: {other}"),
            };
            harness.get_by_label(label).click();
            harness.step();
        }

        let selection = harness.state().uninstall_cleanup;
        assert!(selection.app_cache);
        assert!(selection.credentials);
        assert!(selection.recovery_history);
        assert_eq!(
            uninstall_cleanup_summary(selection),
            expected["selected_summary"]
                .as_str()
                .expect("fixture must state the selected summary")
        );
        assert!(expected["selection_does_not_delete_files"].as_bool() == Some(true));
        assert!(expected["vault_bytes_remain_identical"].as_bool() == Some(true));
        assert!(expected["unresolved_conflict_bytes_remain_identical"].as_bool() == Some(true));
        for (root, files) in [
            (&vault_path, &original_vault_files),
            (&app_data_path, &original_app_data_files),
        ] {
            for (relative_path, original) in files {
                assert_eq!(
                    std::fs::read(root.join(relative_path)).unwrap(),
                    *original,
                    "cleanup-choice selection must preserve {}",
                    relative_path.display()
                );
            }
        }
    }

    #[test]
    fn egui_existing_vault_uninstall_cleanup_selection_preserves_every_path_and_byte() {
        let fixture: serde_json::Value = serde_json::from_str(EXISTING_VAULT_FIXTURE)
            .expect("existing-vault fixture must be valid JSON");
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("Existing Vault");
        let app_data_path = temporary.0.join("App Data");
        std::fs::create_dir_all(&vault_path).expect("create existing vault directory");
        std::fs::create_dir_all(&app_data_path).expect("create separate app-data directory");
        materialize_existing_vault_fixture(&vault_path, &fixture);

        let session = VaultSession::open(&vault_path, &app_data_path).unwrap();
        let original_vault_tree = existing_vault_tree_snapshot(&vault_path);
        let original_app_data_tree = existing_vault_tree_snapshot(&app_data_path);
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        assert_eq!(
            uninstall_cleanup_summary(harness.state().uninstall_cleanup),
            "No local cleanup selected; the vault remains preserved."
        );
        for label in [
            "App cache",
            "Stored credentials",
            "Clean up recovery history",
        ] {
            harness.get_by_label(label).click();
            harness.step();
            assert_eq!(
                existing_vault_tree_snapshot(&vault_path),
                original_vault_tree,
                "selecting {label} must preserve every vault path and byte"
            );
            assert_eq!(
                existing_vault_tree_snapshot(&app_data_path),
                original_app_data_tree,
                "selecting {label} must not perform app-data cleanup"
            );
        }

        let selection = harness.state().uninstall_cleanup;
        assert!(selection.app_cache);
        assert!(selection.credentials);
        assert!(selection.recovery_history);
        assert_eq!(
            uninstall_cleanup_summary(selection),
            "Selected local cleanup: App cache, Stored credentials, Recovery history. The vault remains preserved."
        );
        drop(harness);
        assert_eq!(
            existing_vault_tree_snapshot(&vault_path),
            original_vault_tree
        );
        assert_eq!(
            existing_vault_tree_snapshot(&app_data_path),
            original_app_data_tree
        );
    }

    #[test]
    fn egui_rename_flow_keeps_ambiguous_and_unresolved_fixture_references_unchanged() {
        let fixture: serde_json::Value =
            serde_json::from_str(C03_RENAME_FIXTURE).expect("C03 rename fixture must be valid");
        let case = fixture["cases"]
            .as_array()
            .expect("C03 rename fixture must contain cases")
            .iter()
            .find(|case| case["id"] == "ambiguous-unresolved-and-unrelated-targets")
            .expect("C03 rename fixture must contain the ambiguous/unresolved case");
        let old_path = case["old_path"]
            .as_str()
            .expect("fixture case must state its source path");
        let new_path = case["new_path"]
            .as_str()
            .expect("fixture case must state its destination path");
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("vault");
        let app_data_path = temporary.0.join("app-data");
        std::fs::create_dir(&vault_path).unwrap();
        std::fs::create_dir(&app_data_path).unwrap();
        std::fs::create_dir_all(vault_path.join(std::path::Path::new(new_path).parent().unwrap()))
            .unwrap();

        let mut original_files = Vec::new();
        for file in case["files"]
            .as_array()
            .expect("fixture case must list its files")
        {
            let relative_path = file["relative_path"]
                .as_str()
                .expect("fixture file must state its path");
            let source = file["source"]
                .as_str()
                .expect("fixture file must state its source");
            let path = vault_path.join(relative_path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, source.as_bytes()).unwrap();
            original_files.push((
                std::path::PathBuf::from(relative_path),
                source.as_bytes().to_vec(),
            ));
        }

        let session = VaultSession::open(&vault_path, &app_data_path).unwrap();
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            rename_source_path: Some(std::path::PathBuf::from(old_path)),
            rename_destination_path: new_path.to_owned(),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Build rename preview").click();
        harness.step();
        assert!(harness.state().rename_receiver.is_some());
        wait_for_rename(&mut harness);
        let preview = harness
            .state()
            .rename_preview
            .as_ref()
            .expect("the fixture case should produce a rename preview");
        assert_eq!(preview.plan.update_count, 0);
        assert_eq!(preview.plan.skipped_count, 2);
        assert!(
            preview
                .plan
                .edits
                .iter()
                .any(|edit| edit.action == LinkRenameAction::SkipAmbiguous)
        );
        assert!(
            preview
                .plan
                .edits
                .iter()
                .any(|edit| edit.action == LinkRenameAction::SkipUnresolved)
        );
        harness.get_by_label("Index.md · [[Target#Duplicate]]");
        harness.get_by_label("Ambiguous; will stay unchanged");
        harness.get_by_label("Index.md · [[Folder/Target#Missing]]");
        harness.get_by_label("Unresolved; will stay unchanged");
        for (relative_path, original) in &original_files {
            assert_eq!(
                std::fs::read(vault_path.join(relative_path)).unwrap(),
                *original,
                "preview must not mutate {}",
                relative_path.display()
            );
        }

        harness.get_by_label("Review and confirm rename").click();
        harness.step();
        harness.step();
        harness.get_by_label(
            "Confirm moving Folder/Target.md to Moved/Target.md and applying 0 reference update(s). Skipped ambiguous or unresolved references will remain unchanged.",
        );
        harness.get_by_label("Confirm and apply rename").click();
        harness.step();
        assert!(harness.state().rename_receiver.is_some());
        wait_for_rename(&mut harness);

        let app = harness.state();
        assert!(app.rename_status.as_deref().is_some_and(|status| {
            status.contains("Updated 0 reference(s)")
                && status.contains("2 ambiguous or unresolved reference(s) were left unchanged")
        }));
        assert!(!vault_path.join(old_path).exists());
        assert!(vault_path.join(new_path).exists());
        for (relative_path, original) in &original_files {
            if relative_path == std::path::Path::new(old_path) {
                continue;
            }
            assert_eq!(
                std::fs::read(vault_path.join(relative_path)).unwrap(),
                *original,
                "apply must preserve {}",
                relative_path.display()
            );
        }
        assert!(
            app.session
                .as_ref()
                .unwrap()
                .entries()
                .iter()
                .any(|entry| { entry.relative_path.as_path() == std::path::Path::new(new_path) })
        );
    }

    #[test]
    fn egui_rename_flow_resolves_fixture_subpath_with_duplicate_basename() {
        let fixture: serde_json::Value =
            serde_json::from_str(C03_RENAME_FIXTURE).expect("C03 rename fixture must be valid");
        let case = fixture["cases"]
            .as_array()
            .expect("C03 rename fixture must contain cases")
            .iter()
            .find(|case| case["id"] == "subpath-disambiguates-same-basename")
            .expect("C03 rename fixture must contain the subpath case");
        let old_path = case["old_path"]
            .as_str()
            .expect("fixture case must state its source path");
        let new_path = case["new_path"]
            .as_str()
            .expect("fixture case must state its destination path");
        let temporary = UiTempDir::new();
        let vault_path = temporary.0.join("vault");
        let app_data_path = temporary.0.join("app-data");
        std::fs::create_dir(&vault_path).unwrap();
        std::fs::create_dir(&app_data_path).unwrap();
        std::fs::create_dir_all(vault_path.join(std::path::Path::new(new_path).parent().unwrap()))
            .unwrap();

        let mut original_files = Vec::new();
        for file in case["files"]
            .as_array()
            .expect("fixture case must list its files")
        {
            let relative_path = file["relative_path"]
                .as_str()
                .expect("fixture file must state its path");
            let source = file["source"]
                .as_str()
                .expect("fixture file must state its source")
                .as_bytes()
                .to_vec();
            let path = vault_path.join(relative_path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, &source).unwrap();
            original_files.push((PathBuf::from(relative_path), source));
        }

        let session = VaultSession::open(&vault_path, &app_data_path).unwrap();
        let app = OpenObsidianApp {
            session: Some(Arc::new(session)),
            rename_source_path: Some(PathBuf::from(old_path)),
            rename_destination_path: new_path.to_owned(),
            ..OpenObsidianApp::default()
        };
        let mut harness = Harness::new_ui_state(|ui, app| app.show_ui(ui), app);

        harness.get_by_label("Build rename preview").click();
        harness.step();
        assert!(harness.state().rename_receiver.is_some());
        wait_for_rename(&mut harness);
        let preview = harness
            .state()
            .rename_preview
            .as_ref()
            .expect("the fixture case should produce a rename preview");
        assert_eq!(preview.plan.update_count, 1);
        assert_eq!(preview.plan.skipped_count, 0);
        assert_eq!(preview.plan.edits.len(), 1);
        assert_eq!(preview.plan.edits[0].source_path, "Index.md");
        assert_eq!(preview.plan.edits[0].target, "Target");
        assert_eq!(preview.plan.edits[0].action, LinkRenameAction::Update);
        assert_eq!(
            preview.plan.edits[0].replacement.as_deref(),
            Some("Moved/Target")
        );
        harness.get_by_label("Will update");
        assert_eq!(
            std::fs::read(vault_path.join("Index.md")).unwrap(),
            b"[[Target#Overview]] [[Other]]\n"
        );
        for (relative_path, original) in &original_files {
            assert_eq!(
                std::fs::read(vault_path.join(relative_path)).unwrap(),
                *original,
                "preview must not mutate {}",
                relative_path.display()
            );
        }
        assert!(vault_path.join(old_path).exists());
        assert!(!vault_path.join(new_path).exists());

        harness.get_by_label("Review and confirm rename").click();
        harness.step();
        harness.step();
        harness.get_by_label("Confirm and apply rename").click();
        harness.step();
        assert!(harness.state().rename_receiver.is_some());
        wait_for_rename(&mut harness);

        let app = harness.state();
        assert!(app.rename_status.as_deref().is_some_and(|status| {
            status.contains("Updated 1 reference(s)")
                && status.contains("0 ambiguous or unresolved reference(s) were left unchanged")
        }));
        assert!(!vault_path.join(old_path).exists());
        assert!(vault_path.join(new_path).exists());
        for (relative_path, original) in &original_files {
            let output_path = if relative_path == Path::new(old_path) {
                Path::new(new_path)
            } else {
                relative_path.as_path()
            };
            let expected = case["expected_sources"][relative_path.to_str().unwrap()]
                .as_str()
                .expect("fixture must state every expected source")
                .as_bytes();
            assert_eq!(
                std::fs::read(vault_path.join(output_path)).unwrap(),
                expected,
                "applied fixture bytes at {}",
                output_path.display()
            );
            if relative_path == Path::new("Archive/Target.md") {
                assert_eq!(
                    std::fs::read(vault_path.join(relative_path)).unwrap(),
                    *original,
                    "same-basename unrelated note must stay unchanged"
                );
            }
        }
        assert!(
            app.session
                .as_ref()
                .unwrap()
                .entries()
                .iter()
                .any(|entry| { entry.relative_path.as_path() == Path::new(new_path) })
        );
    }
}
