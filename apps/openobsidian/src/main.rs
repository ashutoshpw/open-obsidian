use openobsidian_engine::VaultSession;
use openobsidian_platform::{
    StorageProtectionStatus, UserDataCleanupOutcome, UserDataCleanupSelection, cleanup_user_data,
    inspect_storage_protection, prepare_vault_app_data,
};
use openobsidian_ui_egui::{
    StorageProtectionDisplay, StorageProtectionDisplayStatus, run_with_desktop_services,
};
use rfd::FileDialog;
use std::process::ExitCode;
use std::sync::mpsc;

fn main() -> ExitCode {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    if let Some(exit_code) = run_uninstall_cleanup_command(&arguments) {
        return exit_code;
    }

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
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

fn run_uninstall_cleanup_command(arguments: &[String]) -> Option<ExitCode> {
    let selection = match parse_uninstall_cleanup_selection(arguments) {
        Ok(Some(selection)) => selection,
        Ok(None) => return None,
        Err(error) => {
            eprintln!("Uninstall cleanup arguments are invalid: {error}");
            return Some(ExitCode::FAILURE);
        }
    };

    let report = match cleanup_user_data(selection, None) {
        Ok(report) => report,
        Err(error) => {
            eprintln!("Uninstall cleanup stopped safely: {error}");
            return Some(ExitCode::FAILURE);
        }
    };
    print_cleanup_outcome("App cache", report.app_cache);
    print_cleanup_outcome("Stored credentials", report.credentials);
    print_cleanup_outcome("Recovery history", report.recovery_history);
    if report.preserved_journal_recovery_directories > 0 {
        eprintln!(
            "Recovery history: preserved {} directory(s) referenced by pending, failed, or unreadable operation journals",
            report.preserved_journal_recovery_directories
        );
    }
    Some(if report.is_complete() {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    })
}

fn parse_uninstall_cleanup_selection(
    arguments: &[String],
) -> Result<Option<UserDataCleanupSelection>, &'static str> {
    if arguments.first().map(String::as_str) != Some("--uninstall-cleanup") {
        return Ok(None);
    }

    let mut selection = UserDataCleanupSelection::default();
    for argument in &arguments[1..] {
        match argument.as_str() {
            "--remove-app-cache" => selection.app_cache = true,
            "--remove-credentials" => selection.credentials = true,
            "--remove-recovery-history" => selection.recovery_history = true,
            _ => return Err("unknown cleanup option"),
        }
    }
    Ok(Some(selection))
}

fn print_cleanup_outcome(label: &str, outcome: UserDataCleanupOutcome) {
    match outcome {
        UserDataCleanupOutcome::NotSelected => println!("{label}: not selected"),
        UserDataCleanupOutcome::Completed {
            removed_directories: _,
        } if label == "Stored credentials" => println!("{label}: completed"),
        UserDataCleanupOutcome::Completed {
            removed_directories,
        } => println!("{label}: completed ({removed_directories} directories removed)"),
        UserDataCleanupOutcome::Failed {
            removed_directories: _,
            reason,
        } if label == "Stored credentials" => eprintln!("{label}: failed ({reason:?})"),
        UserDataCleanupOutcome::Failed {
            removed_directories,
            reason,
        } => eprintln!(
            "{label}: failed ({removed_directories} directories removed before {reason:?})"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uninstall_cleanup_command_requires_explicit_category_flags() {
        let arguments = vec!["--uninstall-cleanup".to_owned()];
        assert_eq!(
            parse_uninstall_cleanup_selection(&arguments),
            Ok(Some(UserDataCleanupSelection::default()))
        );
    }

    #[test]
    fn uninstall_cleanup_command_accepts_only_known_categories() {
        let arguments = vec![
            "--uninstall-cleanup".to_owned(),
            "--remove-app-cache".to_owned(),
            "--remove-credentials".to_owned(),
            "--remove-recovery-history".to_owned(),
        ];
        assert_eq!(
            parse_uninstall_cleanup_selection(&arguments),
            Ok(Some(UserDataCleanupSelection {
                app_cache: true,
                credentials: true,
                recovery_history: true,
            }))
        );
        assert_eq!(
            parse_uninstall_cleanup_selection(&[
                "--uninstall-cleanup".to_owned(),
                "--remove-everything".to_owned(),
            ]),
            Err("unknown cleanup option")
        );
    }
}
