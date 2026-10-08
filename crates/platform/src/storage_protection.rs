use std::process::Command;

/// Operating system whose storage protection was inspected.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StorageProtectionPlatform {
    /// Apple macOS, inspected through FileVault status.
    MacOS,
    /// Microsoft Windows, inspected through BitLocker status for the system drive.
    Windows,
    /// Linux, inspected through the mounted root device and cryptsetup status.
    Linux,
    /// A platform without a supported storage protection probe.
    Unsupported,
}

/// Evidence-backed storage protection result.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StorageProtectionStatus {
    /// The operating system reported active encryption for its system storage.
    Enabled,
    /// The operating system explicitly reported that encryption is off.
    Disabled,
    /// The platform could not be checked or its output was inconclusive.
    Unknown,
}

/// Report returned by [`inspect_storage_protection`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StorageProtectionReport {
    /// Platform that was inspected.
    pub platform: StorageProtectionPlatform,
    /// Checked encryption state. Unknown never implies enabled.
    pub status: StorageProtectionStatus,
    /// Command or command sequence used as evidence.
    pub method: String,
    /// Short explanation of the result without secrets or raw volume identifiers.
    pub detail: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CommandOutput {
    success: bool,
    stdout: String,
}

/// Inspect the current operating system's protection of system storage.
///
/// This is a read-only probe. It does not change encryption settings and reports
/// `Unknown` whenever the OS response does not establish the state.
pub fn inspect_storage_protection() -> StorageProtectionReport {
    let platform = current_platform();
    let system_drive = std::env::var("SystemDrive").ok();
    inspect_storage_protection_with(platform, system_drive.as_deref(), &mut run_system_command)
}

fn current_platform() -> StorageProtectionPlatform {
    #[cfg(target_os = "macos")]
    {
        StorageProtectionPlatform::MacOS
    }
    #[cfg(target_os = "windows")]
    {
        StorageProtectionPlatform::Windows
    }
    #[cfg(target_os = "linux")]
    {
        StorageProtectionPlatform::Linux
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        StorageProtectionPlatform::Unsupported
    }
}

fn inspect_storage_protection_with(
    platform: StorageProtectionPlatform,
    system_drive: Option<&str>,
    runner: &mut impl FnMut(&str, &[&str]) -> Result<CommandOutput, String>,
) -> StorageProtectionReport {
    match platform {
        StorageProtectionPlatform::MacOS => inspect_macos(runner),
        StorageProtectionPlatform::Windows => inspect_windows(system_drive, runner),
        StorageProtectionPlatform::Linux => inspect_linux(runner),
        StorageProtectionPlatform::Unsupported => unknown(
            platform,
            "unsupported platform probe",
            "No supported OS storage protection check is available.",
        ),
    }
}

fn inspect_macos(
    runner: &mut impl FnMut(&str, &[&str]) -> Result<CommandOutput, String>,
) -> StorageProtectionReport {
    let platform = StorageProtectionPlatform::MacOS;
    let method = "fdesetup status";
    let output = match successful_command(runner, "fdesetup", &["status"]) {
        Ok(output) => output.stdout,
        Err(detail) => return unknown(platform, method, detail),
    };
    let lower = output.to_ascii_lowercase();
    if lower.contains("filevault is on") {
        enabled(platform, method, "FileVault reports enabled for system storage.")
    } else if lower.contains("filevault is off") {
        disabled(platform, method, "FileVault reports disabled for system storage.")
    } else {
        unknown(platform, method, "FileVault status was inconclusive.")
    }
}

fn inspect_windows(
    system_drive: Option<&str>,
    runner: &mut impl FnMut(&str, &[&str]) -> Result<CommandOutput, String>,
) -> StorageProtectionReport {
    let platform = StorageProtectionPlatform::Windows;
    let method = "manage-bde -status <system drive>";
    let Some(system_drive) = system_drive.filter(|drive| is_windows_drive_root(drive)) else {
        return unknown(
            platform,
            method,
            "The Windows system drive could not be identified safely.",
        );
    };
    let output = match successful_command(runner, "manage-bde", &["-status", system_drive]) {
        Ok(output) => output.stdout,
        Err(detail) => return unknown(platform, method, detail),
    };
    let protection = output_field(&output, "Protection Status");
    let conversion = output_field(&output, "Conversion Status");
    if matches_ignore_ascii_case(protection, "Protection On")
        && matches_ignore_ascii_case(conversion, "Fully Encrypted")
    {
        enabled(platform, method, "BitLocker reports the system drive fully encrypted and protected.")
    } else if matches_ignore_ascii_case(protection, "Protection Off")
        || matches_ignore_ascii_case(conversion, "Fully Decrypted")
    {
        disabled(platform, method, "BitLocker reports the system drive unprotected or fully decrypted.")
    } else {
        unknown(
            platform,
            method,
            "BitLocker status for the system drive was inconclusive.",
        )
    }
}

fn inspect_linux(
    runner: &mut impl FnMut(&str, &[&str]) -> Result<CommandOutput, String>,
) -> StorageProtectionReport {
    let platform = StorageProtectionPlatform::Linux;
    let method = "findmnt root source; cryptsetup status";
    let root_source = match successful_command(
        runner,
        "findmnt",
        &["--noheadings", "--output", "SOURCE", "--target", "/"],
    ) {
        Ok(output) => output.stdout.trim().to_owned(),
        Err(detail) => return unknown(platform, method, detail),
    };
    let Some(mapping) = linux_mapper_name(&root_source) else {
        return unknown(
            platform,
            method,
            "The Linux root source alone does not establish full-disk encryption.",
        );
    };
    let output = match successful_command(runner, "cryptsetup", &["status", mapping]) {
        Ok(output) => output.stdout,
        Err(detail) => return unknown(platform, method, detail),
    };
    if !has_active_encryption_parameters(&output) {
        return unknown(
            platform,
            method,
            "The root device mapper did not report an active encrypted mapping.",
        );
    }
    enabled(
        platform,
        method,
        "The root filesystem uses an active encrypted mapping.",
    )
}

fn run_system_command(command: &str, arguments: &[&str]) -> Result<CommandOutput, String> {
    let output = Command::new(command)
        .args(arguments)
        .output()
        .map_err(|error| error.to_string())?;
    Ok(CommandOutput {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
    })
}

fn successful_command(
    runner: &mut impl FnMut(&str, &[&str]) -> Result<CommandOutput, String>,
    command: &str,
    arguments: &[&str],
) -> Result<CommandOutput, String> {
    match runner(command, arguments) {
        Ok(output) if output.success => Ok(output),
        Ok(_) => Err(format!("{command} did not complete successfully.")),
        Err(_) => Err(format!("{command} could not be started.")),
    }
}

fn output_field<'a>(output: &'a str, name: &str) -> Option<&'a str> {
    output.lines().find_map(|line| {
        let (field, value) = line.split_once(':')?;
        field
            .trim()
            .eq_ignore_ascii_case(name)
            .then_some(value.trim())
    })
}

fn matches_ignore_ascii_case(value: Option<&str>, expected: &str) -> bool {
    value.is_some_and(|value| value.eq_ignore_ascii_case(expected))
}

fn is_windows_drive_root(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn linux_mapper_name(source: &str) -> Option<&str> {
    let source = source.split('[').next().unwrap_or(source);
    let name = source.strip_prefix("/dev/mapper/")?;
    let mut bytes = name.bytes();
    let first = bytes.next()?;
    if !first.is_ascii_alphanumeric()
        || !bytes.all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'+')
        })
    {
        return None;
    }
    Some(name)
}

fn has_active_encryption_parameters(output: &str) -> bool {
    let active = output
        .lines()
        .any(|line| line.to_ascii_lowercase().contains(" is active"));
    let Some(cipher) = output_field(output, "cipher") else {
        return false;
    };
    let Some(key_size) = output_field(output, "keysize")
        .and_then(|value| value.split_whitespace().next())
        .and_then(|value| value.parse::<u64>().ok())
    else {
        return false;
    };
    active && !cipher.is_empty() && !cipher.eq_ignore_ascii_case("none") && key_size > 0
}

fn enabled(
    platform: StorageProtectionPlatform,
    method: &str,
    detail: &str,
) -> StorageProtectionReport {
    report(platform, StorageProtectionStatus::Enabled, method, detail)
}

fn disabled(
    platform: StorageProtectionPlatform,
    method: &str,
    detail: &str,
) -> StorageProtectionReport {
    report(platform, StorageProtectionStatus::Disabled, method, detail)
}

fn unknown(
    platform: StorageProtectionPlatform,
    method: &str,
    detail: &str,
) -> StorageProtectionReport {
    report(platform, StorageProtectionStatus::Unknown, method, detail)
}

fn report(
    platform: StorageProtectionPlatform,
    status: StorageProtectionStatus,
    method: &str,
    detail: &str,
) -> StorageProtectionReport {
    StorageProtectionReport {
        platform,
        status,
        method: method.to_owned(),
        detail: detail.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn output(success: bool, stdout: &str) -> CommandOutput {
        CommandOutput {
            success,
            stdout: stdout.to_owned(),
        }
    }

    #[test]
    fn macos_reports_only_explicit_filevault_states() {
        let enabled = inspect_storage_protection_with(
            StorageProtectionPlatform::MacOS,
            None,
            &mut |_, _| Ok(output(true, "FileVault is On.\n")),
        );
        let disabled = inspect_storage_protection_with(
            StorageProtectionPlatform::MacOS,
            None,
            &mut |_, _| Ok(output(true, "FileVault is Off.\n")),
        );
        let unknown = inspect_storage_protection_with(
            StorageProtectionPlatform::MacOS,
            None,
            &mut |_, _| Ok(output(true, "FileVault status pending.\n")),
        );

        assert_eq!(enabled.status, StorageProtectionStatus::Enabled);
        assert_eq!(disabled.status, StorageProtectionStatus::Disabled);
        assert_eq!(unknown.status, StorageProtectionStatus::Unknown);
    }

    #[test]
    fn macos_reports_unknown_when_the_probe_fails() {
        let report = inspect_storage_protection_with(
            StorageProtectionPlatform::MacOS,
            None,
            &mut |_, _| Err("permission denied".to_owned()),
        );

        assert_eq!(report.status, StorageProtectionStatus::Unknown);
        assert_eq!(report.detail, "fdesetup could not be started.");
    }

    #[test]
    fn windows_checks_only_the_validated_system_drive() {
        let mut observed = Vec::new();
        let report = inspect_storage_protection_with(
            StorageProtectionPlatform::Windows,
            Some("D:"),
            &mut |command, arguments| {
                observed.push((command.to_owned(), arguments.to_vec()));
                Ok(output(
                    true,
                    "Conversion Status: Fully Encrypted\nProtection Status: Protection On\n",
                ))
            },
        );

        assert_eq!(report.status, StorageProtectionStatus::Enabled);
        assert_eq!(observed, vec![("manage-bde".to_owned(), vec!["-status", "D:"])]);
    }

    #[test]
    fn windows_reports_disabled_or_unknown_from_bitlocker_output() {
        let disabled = inspect_storage_protection_with(
            StorageProtectionPlatform::Windows,
            Some("C:"),
            &mut |_, _| {
                Ok(output(
                    true,
                    "Conversion Status: Fully Encrypted\nProtection Status: Protection Off\n",
                ))
            },
        );
        let unknown = inspect_storage_protection_with(
            StorageProtectionPlatform::Windows,
            Some("C:"),
            &mut |_, _| Ok(output(true, "Conversion Status: Encryption in Progress\n")),
        );

        assert_eq!(disabled.status, StorageProtectionStatus::Disabled);
        assert_eq!(unknown.status, StorageProtectionStatus::Unknown);
        assert_eq!(
            unknown.detail,
            "BitLocker status for the system drive was inconclusive."
        );
    }

    #[test]
    fn windows_does_not_probe_when_system_drive_is_missing_or_invalid() {
        let mut called = false;
        let missing = inspect_storage_protection_with(
            StorageProtectionPlatform::Windows,
            None,
            &mut |_, _| {
                called = true;
                Ok(output(true, "Protection Status: Protection On"))
            },
        );
        let invalid = inspect_storage_protection_with(
            StorageProtectionPlatform::Windows,
            Some("C:\\outside"),
            &mut |_, _| {
                called = true;
                Ok(output(true, "Protection Status: Protection On"))
            },
        );

        assert!(!called);
        assert_eq!(missing.status, StorageProtectionStatus::Unknown);
        assert_eq!(invalid.status, StorageProtectionStatus::Unknown);
    }

    #[test]
    fn linux_requires_active_cryptsetup_evidence_for_mapper_roots() {
        let mut calls = Vec::new();
        let report = inspect_storage_protection_with(
            StorageProtectionPlatform::Linux,
            None,
            &mut |command, arguments| {
                calls.push((command.to_owned(), arguments.to_vec()));
                if command == "findmnt" {
                    Ok(output(true, "/dev/mapper/cryptroot[/@]\n"))
                } else {
                    Ok(output(
                        true,
                        "/dev/mapper/cryptroot is active and is in use.\n  type: LUKS2\n  cipher: aes-xts-plain64\n  keysize: 512 bits\n",
                    ))
                }
            },
        );

        assert_eq!(report.status, StorageProtectionStatus::Enabled);
        assert_eq!(
            calls,
            vec![
                (
                    "findmnt".to_owned(),
                    vec!["--noheadings", "--output", "SOURCE", "--target", "/"]
                ),
                (
                    "cryptsetup".to_owned(),
                    vec!["status", "cryptroot"]
                )
            ]
        );
    }

    #[test]
    fn linux_does_not_treat_a_mapper_path_alone_as_encryption_evidence() {
        let mut calls = 0;
        let report = inspect_storage_protection_with(
            StorageProtectionPlatform::Linux,
            None,
            &mut |command, _| {
                calls += 1;
                if command == "findmnt" {
                    Ok(output(true, "/dev/mapper/root\n"))
                } else {
                    Ok(output(true, "/dev/mapper/root is active\n  type: LVM2\n"))
                }
            },
        );

        assert_eq!(calls, 2);
        assert_eq!(report.status, StorageProtectionStatus::Unknown);
    }

    #[test]
    fn linux_returns_unknown_for_unresolved_root_sources() {
        let mut calls = 0;
        let report = inspect_storage_protection_with(
            StorageProtectionPlatform::Linux,
            None,
            &mut |_, _| {
                calls += 1;
                Ok(output(true, "/dev/nvme0n1p2\n"))
            },
        );

        assert_eq!(calls, 1);
        assert_eq!(report.status, StorageProtectionStatus::Unknown);
    }

    #[test]
    fn unsupported_platforms_are_unknown_without_running_commands() {
        let mut called = false;
        let report = inspect_storage_protection_with(
            StorageProtectionPlatform::Unsupported,
            None,
            &mut |_, _| {
                called = true;
                Ok(output(true, ""))
            },
        );

        assert!(!called);
        assert_eq!(report.status, StorageProtectionStatus::Unknown);
    }
}
