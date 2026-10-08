//! Native eframe application shell. Product workflows are migrated in later phases.

use openobsidian_platform::{
    StorageProtectionReport, StorageProtectionStatus, inspect_storage_protection,
};

/// Creates the initial native desktop application.
pub fn run() -> eframe::Result {
    let options = eframe::NativeOptions::default();
    eframe::run_native(
        "OpenObsidian",
        options,
        Box::new(|_creation_context| Ok(Box::new(OpenObsidianApp::default()))),
    )
}

#[derive(Default)]
struct OpenObsidianApp {
    session: Option<openobsidian_engine::VaultSession>,
    storage_protection_report: Option<StorageProtectionReport>,
}

impl eframe::App for OpenObsidianApp {
    fn ui(&mut self, ui: &mut eframe::egui::Ui, _frame: &mut eframe::Frame) {
        ui.heading("OpenObsidian");
        ui.label("Native Rust migration is in progress.");
        match &self.session {
            Some(session) => {
                ui.label(format!("{} Markdown files found.", session.entries().len()));
            }
            None => {
                ui.label("No vault is open in this preview.");
            }
        }
        ui.separator();
        ui.heading("OS storage protection");
        if self.storage_protection_report.is_none() {
            self.storage_protection_report = Some(inspect_storage_protection());
        }
        if ui.button("Refresh storage status").clicked() {
            self.storage_protection_report = Some(inspect_storage_protection());
        }
        if let Some(report) = &self.storage_protection_report {
            ui.label(format!("Status: {}", storage_protection_label(report.status)));
            ui.label(format!("Check: {}", report.method));
            ui.label(&report.detail);
        }
        ui.small("This check covers only the reported system volume or root filesystem.");
        ui.label("Editing and plugin compatibility are not available in this preview.");
    }
}

fn storage_protection_label(status: StorageProtectionStatus) -> &'static str {
    match status {
        StorageProtectionStatus::Enabled => "Enabled (OS reported)",
        StorageProtectionStatus::Disabled => "Disabled (OS reported)",
        StorageProtectionStatus::Unknown => "Unknown (encryption not verified)",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_status_labels_keep_unknown_explicit() {
        assert_eq!(
            storage_protection_label(StorageProtectionStatus::Enabled),
            "Enabled (OS reported)"
        );
        assert_eq!(
            storage_protection_label(StorageProtectionStatus::Disabled),
            "Disabled (OS reported)"
        );
        assert_eq!(
            storage_protection_label(StorageProtectionStatus::Unknown),
            "Unknown (encryption not verified)"
        );
    }
}
