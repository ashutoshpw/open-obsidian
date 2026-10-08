use openobsidian_engine::VaultSession;
use openobsidian_platform::{
    StorageProtectionStatus, UserDataCleanupOutcome, UserDataCleanupSelection, cleanup_user_data,
    inspect_storage_protection, prepare_vault_app_data,
};
use openobsidian_ui_egui::{
    StorageProtectionDisplay, StorageProtectionDisplayStatus,
    run_with_desktop_services_and_session,
};
use rfd::FileDialog;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::mpsc;

fn main() -> ExitCode {
    let arguments = std::env::args_os().skip(1).collect::<Vec<_>>();
    if let Some(exit_code) = run_uninstall_cleanup_command(&arguments) {
        return exit_code;
    }
    let initial_vault_path = match parse_open_vault_path(&arguments) {
        Ok(path) => path,
        Err(error) => {
            eprintln!("OpenObsidian could not open the selected vault: {error}");
            return ExitCode::FAILURE;
        }
    };
    let initial_session = match initial_vault_path {
        Some(path) => match open_selected_vault(path) {
            Ok(session) => Some(session),
            Err(error) => {
                eprintln!("OpenObsidian could not open the selected vault safely: {error}");
                return ExitCode::FAILURE;
            }
        },
        None => None,
    };

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
    if let Err(error) = run_with_desktop_services_and_session(probe, open_vault, initial_session) {
        eprintln!("OpenObsidian could not start: {error}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

fn run_uninstall_cleanup_command(arguments: &[OsString]) -> Option<ExitCode> {
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
    arguments: &[OsString],
) -> Result<Option<UserDataCleanupSelection>, &'static str> {
    if arguments.first().and_then(|argument| argument.to_str()) != Some("--uninstall-cleanup") {
        return Ok(None);
    }

    let mut selection = UserDataCleanupSelection::default();
    for argument in &arguments[1..] {
        match argument.to_str() {
            Some("--remove-app-cache") => selection.app_cache = true,
            Some("--remove-credentials") => selection.credentials = true,
            Some("--remove-recovery-history") => selection.recovery_history = true,
            _ => return Err("unknown cleanup option"),
        }
    }
    Ok(Some(selection))
}

fn parse_open_vault_path(arguments: &[OsString]) -> Result<Option<PathBuf>, &'static str> {
    if arguments.first().and_then(|argument| argument.to_str()) != Some("--open-vault") {
        return Ok(None);
    }
    if arguments.len() != 2 || arguments[1].is_empty() {
        return Err("--open-vault requires exactly one folder path");
    }
    Ok(Some(PathBuf::from(&arguments[1])))
}

fn open_selected_vault(root: PathBuf) -> Result<VaultSession, &'static str> {
    if !root.is_dir() {
        return Err("the selected path is not an existing folder");
    }
    let app_data_root =
        prepare_vault_app_data(&root).map_err(|_| "private application storage is unavailable")?;
    VaultSession::open(&root, app_data_root).map_err(|_| "the selected folder is not a safe vault")
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
        let arguments = vec![OsString::from("--uninstall-cleanup")];
        assert_eq!(
            parse_uninstall_cleanup_selection(&arguments),
            Ok(Some(UserDataCleanupSelection::default()))
        );
    }

    #[test]
    fn uninstall_cleanup_command_accepts_only_known_categories() {
        let arguments = vec![
            OsString::from("--uninstall-cleanup"),
            OsString::from("--remove-app-cache"),
            OsString::from("--remove-credentials"),
            OsString::from("--remove-recovery-history"),
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
                OsString::from("--uninstall-cleanup"),
                OsString::from("--remove-everything"),
            ]),
            Err("unknown cleanup option")
        );
    }

    #[test]
    fn open_vault_arguments_preserve_paths_and_reject_ambiguous_invocations() {
        assert_eq!(parse_open_vault_path(&[]).unwrap(), None);
        assert_eq!(
            parse_open_vault_path(&[
                OsString::from("--open-vault"),
                OsString::from("/tmp/Existing Vault café"),
            ])
            .unwrap(),
            Some(PathBuf::from("/tmp/Existing Vault café"))
        );
        assert_eq!(
            parse_open_vault_path(&[OsString::from("--open-vault")]),
            Err("--open-vault requires exactly one folder path")
        );
        assert_eq!(
            parse_open_vault_path(&[
                OsString::from("--open-vault"),
                OsString::from("/tmp/Vault"),
                OsString::from("/tmp/Other"),
            ]),
            Err("--open-vault requires exactly one folder path")
        );
    }
}
