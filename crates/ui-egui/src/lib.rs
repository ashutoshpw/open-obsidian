//! Native eframe application shell. Product workflows are migrated in later phases.

use openobsidian_engine::{
    VaultConflictAction, VaultConflictRead, VaultConflictResolution, VaultHistoryCleanup,
    VaultHistoryKind, VaultHistoryPlan, VaultHistoryPolicy, VaultHistoryRecord, VaultSession,
    plan_history_retention,
};
use std::sync::{
    Arc,
    mpsc::{self, Receiver, TryRecvError},
};
use std::time::{Duration, SystemTime};

const GIBIBYTE: u64 = 1024 * 1024 * 1024;
const GIBIBYTE_F64: f64 = GIBIBYTE as f64;

/// Receives the result of opening a user-selected vault on a background worker.
pub type VaultOpenReceiver = Receiver<Result<VaultSession, String>>;
type VaultOpenAction = dyn Fn() -> Option<VaultOpenReceiver> + Send + Sync;
type HistoryReceiver = Receiver<HistoryTaskMessage>;

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
    let options = eframe::NativeOptions::default();
    eframe::run_native(
        "OpenObsidian",
        options,
        Box::new(move |_creation_context| {
            Ok(Box::new(OpenObsidianApp {
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
    history_policy: VaultHistoryPolicy,
    history_records: Vec<VaultHistoryRecord>,
    history_plan: Option<VaultHistoryPlan>,
    history_receiver: Option<HistoryReceiver>,
    history_error: Option<String>,
    history_status: Option<String>,
    cleanup_confirmation: bool,
    conflict_inspection: Option<ConflictInspection>,
    pending_conflict_action: Option<VaultConflictAction>,
}

impl eframe::App for OpenObsidianApp {
    fn ui(&mut self, ui: &mut eframe::egui::Ui, _frame: &mut eframe::Frame) {
        ui.heading("OpenObsidian");
        ui.label("Native Rust migration is in progress.");
        let open_vault_requested = self.open_vault_action.as_ref().is_some_and(|_| {
            ui.add_enabled(!self.vault_opening, eframe::egui::Button::new("Open vault"))
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
                self.session = Some(Arc::new(session));
                self.vault_open_receiver = None;
                self.vault_opening = false;
                self.vault_open_error = None;
                self.history_records.clear();
                self.history_plan = None;
                self.history_receiver = None;
                self.history_error = None;
                self.history_status = None;
                self.cleanup_confirmation = false;
                self.conflict_inspection = None;
                self.pending_conflict_action = None;
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
        if self.vault_opening {
            ui.label("Opening vault safely…");
        }
        if let Some(error) = &self.vault_open_error {
            ui.colored_label(eframe::egui::Color32::RED, error);
        }
        match &self.session {
            Some(session) => {
                let vault_name = session
                    .root_path()
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("Selected vault");
                ui.label(format!("Vault: {vault_name}"));
                ui.label(format!("{} Markdown files found.", session.entries().len()));
            }
            None => {
                ui.label("No vault is open. Choose an existing vault folder to continue.");
            }
        }
        if self.session.is_some() {
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
        ui.label("Editing and plugin compatibility are not available in this preview.");
    }
}

impl OpenObsidianApp {
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

        let history_busy = self.history_receiver.is_some();
        if ui
            .add_enabled(
                !history_busy,
                eframe::egui::Button::new("Refresh history and retention preview"),
            )
            .clicked()
        {
            self.start_history_preview();
        }
        if history_busy {
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

        if let Some(plan) = &plan && !plan.pruneable.is_empty() {
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
                        .add_enabled(
                            !history_busy,
                            eframe::egui::Button::new("Confirm cleanup"),
                        )
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

        let history_busy = self.history_receiver.is_some();
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

    fn start_history_task(&mut self, task: impl FnOnce() -> HistoryTaskMessage + Send + 'static) {
        let (sender, receiver) = mpsc::channel();
        rayon::spawn(move || {
            let _ = sender.send(task());
        });
        self.history_receiver = Some(receiver);
        self.history_error = None;
        self.history_status = None;
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
