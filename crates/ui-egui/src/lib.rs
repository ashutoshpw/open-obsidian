//! Native eframe application shell. Product workflows are migrated in later phases.

use egui_commonmark::{CommonMarkCache, CommonMarkViewer};
use openobsidian_engine::{
    LinkKind, LinkRenameAction, LinkResolutionStatus, MAX_NOTE_SOURCE_PREVIEW_BYTES,
    TransclusionBlockReason, VaultConflictAction, VaultConflictRead, VaultConflictResolution,
    VaultError, VaultHistoryCleanup, VaultHistoryKind, VaultHistoryPlan, VaultHistoryPolicy,
    VaultHistoryRecord, VaultInlineImage, VaultLinkResolution, VaultNoteEmbedDisposition,
    VaultNoteEmbedNode, VaultNoteEmbedReport, VaultRenamePreview, VaultRenameRecoveryReport,
    VaultRenameResult, VaultSession, plan_history_retention,
};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{
    Arc,
    mpsc::{self, Receiver, TryRecvError},
};
use std::time::{Duration, SystemTime};

const GIBIBYTE: u64 = 1024 * 1024 * 1024;
const GIBIBYTE_F64: f64 = GIBIBYTE as f64;
const MAX_RENAME_PREVIEW_EDITS: usize = 100;
const MAX_LINK_STATUS_ROWS: usize = 100;
const MAX_TRANSCLUSION_PREVIEW_BYTES: usize = MAX_NOTE_SOURCE_PREVIEW_BYTES;
#[cfg(test)]
const C03_RENAME_FIXTURE: &str = include_str!("../../../fixtures/rename-plan.json");
#[cfg(test)]
const C03_LINK_RESOLUTION_FIXTURE: &str = include_str!("../../../fixtures/link-resolution.json");
#[cfg(test)]
const HISTORY_RETENTION_FIXTURE: &str = include_str!("../../../fixtures/history-retention.json");
#[cfg(test)]
const SYNC_UNINSTALL_FIXTURE: &str = include_str!("../../../fixtures/uninstall-preservation.json");
#[cfg(test)]
const EXISTING_VAULT_FIXTURE: &str = include_str!("../../../fixtures/existing-vault.json");

/// Receives the result of opening a user-selected vault on a background worker.
pub type VaultOpenReceiver = Receiver<Result<VaultSession, String>>;
type VaultOpenAction = dyn Fn() -> Option<VaultOpenReceiver> + Send + Sync;
type HistoryReceiver = Receiver<HistoryTaskMessage>;
type LinkReceiver = Receiver<LinkTaskMessage>;
type NotePreviewReceiver = Receiver<Result<NoteSourcePreview, String>>;
type VaultRefreshReceiver = Receiver<Result<VaultSession, String>>;
type RenameReceiver = Receiver<RenameTaskMessage>;

struct LinkTaskMessage {
    resolutions: Result<Vec<VaultLinkResolution>, String>,
    note_embeds: Result<VaultNoteEmbedReport, String>,
}

struct NoteSourcePreview {
    relative_path: std::path::PathBuf,
    text: String,
    total_size_bytes: u64,
    truncated: bool,
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

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct UninstallCleanupSelection {
    app_cache: bool,
    credentials: bool,
    recovery_history: bool,
}

enum RenameTaskMessage {
    Preview(Result<VaultRenamePreview, String>),
    Applied(Result<RenameApplyOutcome, String>),
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
    note_preview_error: Option<String>,
    note_embed_report: Option<VaultNoteEmbedReport>,
    note_embed_error: Option<String>,
    markdown_cache: CommonMarkCache,
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
        ui.heading("OpenObsidian");
        ui.label("Native Rust migration is in progress.");
        let vault_operation_busy = self.history_receiver.is_some()
            || self.link_receiver.is_some()
            || self.note_preview_receiver.is_some()
            || self.vault_refresh_receiver.is_some()
            || self.rename_receiver.is_some();
        let open_vault_requested = self.open_vault_action.as_ref().is_some_and(|_| {
            ui.add_enabled(
                !self.vault_opening && !vault_operation_busy,
                eframe::egui::Button::new("Open vault"),
            )
            .clicked()
        });
        if open_vault_requested {
            self.vault_open_error = None;
            if let Some(receiver) = self.open_vault_action.as_ref().and_then(|action| action()) {
                self.vault_open_receiver = Some(receiver);
                self.vault_opening = true;
            }
        }
        let open_result = self.vault_open_receiver.as_ref().map(Receiver::try_recv);
        match open_result {
            Some(Ok(Ok(session))) => {
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
                self.note_preview_error = None;
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
        self.poll_vault_refresh_task(ui);
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
        ui.label("Editing and plugin compatibility are not available in this preview.");
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
            || self.vault_refresh_receiver.is_some()
            || self.rename_receiver.is_some();
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
            ui.add_enabled_ui(!operation_busy, |ui| {
                if previous_path.is_some() {
                    previous_requested = ui.small_button("Previous note").clicked();
                }
                eframe::egui::ComboBox::from_label("Note to inspect")
                    .selected_text(selected_label)
                    .show_ui(ui, |ui| {
                        for path in &note_paths {
                            if ui
                                .selectable_value(
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
                if next_path.is_some() {
                    next_requested = ui.small_button("Next note").clicked();
                }
            });
            let can_resolve = !operation_busy && self.link_source_path.is_some();
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
            self.note_embed_report = None;
            self.note_embed_error = None;
            self.inline_image_textures.clear();
        }

        self.show_note_source_preview(ui, operation_busy);

        if note_paths.is_empty() {
            ui.label("This vault has no Markdown notes to inspect.");
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
        eframe::egui::CollapsingHeader::new("Note source preview")
            .id_salt("note-source-preview")
            .default_open(false)
            .show(ui, |ui| {
                ui.small(format!(
                    "Read up to {} KiB of the selected note's original UTF-8 source. This preview never edits the vault.",
                    MAX_NOTE_SOURCE_PREVIEW_BYTES / 1024
                ));

                let can_preview = !operation_busy && self.link_source_path.is_some();
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

                if let Some(preview) = &mut self.note_source_preview {
                    ui.label(format!("Source: {}", preview.relative_path.display()));
                    close_preview = ui.button("Close source preview").clicked();
                    ui.add(
                        eframe::egui::TextEdit::multiline(&mut preview.text)
                            .font(eframe::egui::TextStyle::Monospace)
                            .desired_rows(8)
                            .desired_width(f32::INFINITY)
                            .interactive(false),
                    );
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
        if close_preview {
            self.note_source_preview = None;
            self.note_preview_error = None;
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
            || self.vault_refresh_receiver.is_some()
            || self.rename_receiver.is_some();
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
            || self.vault_refresh_receiver.is_some()
            || self.rename_receiver.is_some();
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
            || self.vault_refresh_receiver.is_some()
            || self.rename_receiver.is_some();
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
                        total_size_bytes: preview.total_size_bytes,
                        truncated: preview.truncated,
                    })
                });
            let _ = sender.send(result);
        });
        self.note_preview_receiver = Some(receiver);
    }

    fn start_vault_refresh(&mut self) {
        let Some(mut session) = self.session.as_ref().map(|session| (**session).clone()) else {
            return;
        };
        self.vault_refresh_error = None;
        self.vault_refresh_status = None;
        let (sender, receiver) = mpsc::channel();
        rayon::spawn(move || {
            let result = match session.refresh_entries() {
                Ok(()) => Ok(session),
                Err(_) => Err(
                    "The note list could not be refreshed safely. The existing listing remains available."
                        .to_owned(),
                ),
            };
            let _ = sender.send(result);
        });
        self.vault_refresh_receiver = Some(receiver);
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
                    Ok(RenameApplyOutcome {
                        session,
                        result,
                        listing_refreshed,
                    })
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
                let result = &outcome.result;
                self.rename_source_path = Some(result.new_path.clone());
                if self.link_source_path.as_ref() == Some(&result.old_path) {
                    self.link_source_path = Some(result.new_path.clone());
                }
                self.link_resolutions.clear();
                self.link_error = None;
                self.link_status = None;
                self.note_source_preview = None;
                self.note_preview_error = None;
                self.note_embed_report = None;
                self.note_embed_error = None;
                self.inline_image_textures.clear();
                self.session = Some(Arc::new(outcome.session));
                self.rename_destination_path.clear();
                self.rename_preview = None;
                self.rename_confirmation = false;
                self.rename_error = if outcome.listing_refreshed {
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

    fn poll_vault_refresh_task(&mut self, ui: &mut eframe::egui::Ui) {
        let result = self.vault_refresh_receiver.as_ref().map(Receiver::try_recv);
        match result {
            Some(Ok(Ok(session))) => {
                self.vault_refresh_receiver = None;
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
                self.note_source_preview = None;
                self.note_preview_error = None;
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
                    CommonMarkViewer::new().show(ui, markdown_cache, &text[..end]);
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
            show_note_embed_node(ui, child, markdown_cache, inline_image_textures);
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
        let readme_path = PathBuf::from("README.md");
        let welcome_path = PathBuf::from("Notes/Welcome.md");
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

        harness.get_by_label("Note to inspect").click();
        harness.step();
        harness.get_by_label("Notes/Welcome.md").click();
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
    fn egui_link_status_displays_fixture_resolution_without_changing_vault_bytes() {
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
        let mut original_files = Vec::new();
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
            original_files.push((relative_path, source));
        }

        let session = VaultSession::open(&vault_path, &app_data_path).unwrap();
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
        harness.get_by_label("formatted paragraph");
        harness.get_by_label("Not rendered: this embed would create a cycle. ![[Unique]]");
        harness.get_by_label(
            "Not rendered: this attachment type or size is outside the safe image preview limits. ![[Assets/plot.svg]]",
        );
        for (relative_path, original) in &original_files {
            assert_eq!(
                std::fs::read(vault_path.join(relative_path)).unwrap(),
                *original,
                "link resolution must not change {}",
                relative_path.display()
            );
        }
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
