use openobsidian_platform::{StorageProtectionStatus, inspect_storage_protection};
use openobsidian_ui_egui::{
    StorageProtectionDisplay, StorageProtectionDisplayStatus, run_with_storage_protection_probe,
};

fn main() {
    let probe = || {
        let report = inspect_storage_protection();
        let status = match report.status {
            StorageProtectionStatus::Enabled => StorageProtectionDisplayStatus::Enabled,
            StorageProtectionStatus::Disabled => StorageProtectionDisplayStatus::Disabled,
            StorageProtectionStatus::Unknown => StorageProtectionDisplayStatus::Unknown,
        };
        StorageProtectionDisplay {
            status,
            method: report.method,
            detail: report.detail,
        }
    };
    if let Err(error) = run_with_storage_protection_probe(probe) {
        eprintln!("OpenObsidian could not start: {error}");
        std::process::exit(1);
    }
}
