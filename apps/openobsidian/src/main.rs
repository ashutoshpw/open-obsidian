use openobsidian_engine::VaultSession;
use openobsidian_platform::{
    StorageProtectionStatus, inspect_storage_protection, prepare_vault_app_data,
};
use openobsidian_ui_egui::{
    StorageProtectionDisplay, StorageProtectionDisplayStatus, run_with_desktop_services,
};
use rfd::FileDialog;
use std::sync::mpsc;

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
    let open_vault = || {
        let root = FileDialog::new()
            .set_title("Open an existing vault")
            .pick_folder()?;
        let (sender, receiver) = mpsc::channel();
        rayon::spawn(move || {
            let result = prepare_vault_app_data(&root)
                .map_err(|_| "Private per-vault storage could not be prepared.".to_owned())
                .and_then(|app_data_root| {
                    VaultSession::open(&root, app_data_root)
                        .map_err(|_| "The selected vault could not be opened safely.".to_owned())
                });
            let _ = sender.send(result);
        });
        Some(receiver)
    };
    if let Err(error) = run_with_desktop_services(probe, open_vault) {
        eprintln!("OpenObsidian could not start: {error}");
        std::process::exit(1);
    }
}
