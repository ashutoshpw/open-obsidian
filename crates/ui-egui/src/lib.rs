//! Native eframe application shell. Product workflows are migrated in later phases.

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
    run_with_storage_protection_probe(|| StorageProtectionDisplay {
        status: StorageProtectionDisplayStatus::Unknown,
        method: "unconfigured storage protection probe".to_owned(),
        detail: "OS storage protection has not been checked.".to_owned(),
    })
}

/// Creates the desktop shell with a probe supplied by the application boundary.
pub fn run_with_storage_protection_probe(
    probe: impl Fn() -> StorageProtectionDisplay + Send + Sync + 'static,
) -> eframe::Result {
    let options = eframe::NativeOptions::default();
    eframe::run_native(
        "OpenObsidian",
        options,
        Box::new(move |_creation_context| {
            Ok(Box::new(OpenObsidianApp {
                storage_protection_probe: Some(Box::new(probe)),
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
