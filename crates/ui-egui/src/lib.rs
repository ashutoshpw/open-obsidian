//! Native eframe application shell. Product workflows are migrated in later phases.

use openobsidian_engine::VaultSession;
use std::sync::mpsc::{Receiver, TryRecvError};
use std::time::Duration;

/// Receives the result of opening a user-selected vault on a background worker.
pub type VaultOpenReceiver = Receiver<Result<VaultSession, String>>;
type VaultOpenAction = dyn Fn() -> Option<VaultOpenReceiver> + Send + Sync;

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
    session: Option<openobsidian_engine::VaultSession>,
    storage_protection_report: Option<StorageProtectionDisplay>,
    storage_protection_probe: Option<Box<dyn Fn() -> StorageProtectionDisplay + Send + Sync>>,
    open_vault_action: Option<Box<VaultOpenAction>>,
    vault_open_receiver: Option<VaultOpenReceiver>,
    vault_opening: bool,
    vault_open_error: Option<String>,
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
        let open_result = self
            .vault_open_receiver
            .as_ref()
            .map(Receiver::try_recv);
        match open_result {
            Some(Ok(Ok(session))) => {
                self.session = Some(session);
                self.vault_open_receiver = None;
                self.vault_opening = false;
                self.vault_open_error = None;
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
