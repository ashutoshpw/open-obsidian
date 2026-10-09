//! Private per-user directories for app-owned vault history and recovery data.

use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write;
#[cfg(not(windows))]
use std::path::Component;
use std::path::{Path, PathBuf};
use thiserror::Error;

const PRODUCT_NAME: &str = "OpenObsidian";
const APP_DATA_ROOT_MARKER: &str = ".openobsidian-user-data-root";
const APP_DATA_ROOT_MARKER_CONTENT: &[u8] = b"openobsidian-user-data-root-v1\n";
const VAULT_DATA_MARKER: &str = ".openobsidian-vault-data";
const VAULT_DATA_MARKER_CONTENT: &[u8] = b"openobsidian-vault-data-v1\n";
const VAULT_DATA_ID_LENGTH: usize = 24;
const MAX_CLEANUP_JOURNAL_BYTES: u64 = 64 * 1024 * 1024;
const MAX_PENDING_JOURNAL_OPERATIONS: usize = 100_000;

#[derive(Debug, Error)]
pub enum UserDataError {
    #[error("the current user's application data directory is unavailable")]
    Unavailable,
    #[error("the selected vault path cannot be represented using the legacy path identity")]
    InvalidVaultPath,
    #[error("the managed application data directory would be inside the selected vault")]
    DataDirectoryInsideVault,
    #[error("the managed application data path must be a real directory")]
    NotDirectory,
    #[error("the managed application data access controls could not be restricted to this user")]
    AccessControl,
    #[error("the application data directory is not marked as OpenObsidian-owned")]
    UnownedDataDirectory,
    #[error("application data cleanup found an unsafe path or unexpected file type")]
    UnsafeCleanupPath,
    #[error("application data filesystem operation failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("application data preparation failed during {operation}: {source}")]
    OperationFailed {
        operation: &'static str,
        #[source]
        source: Box<UserDataError>,
    },
}

/// Explicit categories an OS uninstaller may pass after its cleanup choices are confirmed.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct UserDataCleanupSelection {
    pub app_cache: bool,
    pub credentials: bool,
    pub recovery_history: bool,
}

/// Outcome for one selected uninstall cleanup category.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum UserDataCleanupOutcome {
    #[default]
    NotSelected,
    Completed {
        removed_directories: usize,
    },
    Failed {
        removed_directories: usize,
        reason: UserDataCleanupFailure,
    },
}

/// Cleanup failure class safe to show without exposing local paths.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UserDataCleanupFailure {
    CredentialStoreUnavailable,
    CredentialStoreFailed,
    FileSystemFailed,
}

/// Per-category result returned to the host uninstaller adapter.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct UserDataCleanupReport {
    pub app_cache: UserDataCleanupOutcome,
    pub credentials: UserDataCleanupOutcome,
    pub recovery_history: UserDataCleanupOutcome,
    /// Per-vault recovery directories retained because their journals may need them.
    pub preserved_journal_recovery_directories: usize,
}

impl UserDataCleanupReport {
    /// Whether every requested category completed successfully.
    pub fn is_complete(self) -> bool {
        !matches!(self.app_cache, UserDataCleanupOutcome::Failed { .. })
            && !matches!(self.credentials, UserDataCleanupOutcome::Failed { .. })
            && !matches!(self.recovery_history, UserDataCleanupOutcome::Failed { .. })
    }
}

/// Return the product-specific user-data root used by Electron's `userData` path.
pub fn app_user_data_directory() -> Result<PathBuf, UserDataError> {
    #[cfg(target_os = "windows")]
    {
        let app_data = env::var_os("APPDATA").map(PathBuf::from);
        return require_absolute_user_data_directory(app_user_data_directory_for(
            "windows",
            None,
            None,
            app_data.as_deref(),
        )?);
    }

    #[cfg(target_os = "macos")]
    {
        let home = env::var_os("HOME").map(PathBuf::from);
        return require_absolute_user_data_directory(app_user_data_directory_for(
            "macos",
            None,
            home.as_deref(),
            None,
        )?);
    }

    #[cfg(target_os = "linux")]
    {
        let xdg = env::var_os("XDG_CONFIG_HOME").map(PathBuf::from);
        let home = env::var_os("HOME").map(PathBuf::from);
        return require_absolute_user_data_directory(app_user_data_directory_for(
            "linux",
            xdg.as_deref(),
            home.as_deref(),
            None,
        )?);
    }

    #[allow(unreachable_code)]
    Err(UserDataError::Unavailable)
}

/// Compute the legacy Electron per-vault data directory without touching disk.
///
/// The first 24 lowercase hexadecimal digits of SHA-256 over the lexically resolved
/// root string match `sha256(resolve(root)).slice(0, 24)` in the Electron host.
pub fn vault_app_data_directory_under(
    user_data_root: &Path,
    vault_root: &Path,
) -> Result<PathBuf, UserDataError> {
    let resolved_root = resolve_legacy_path(vault_root)?;
    let resolved_text = resolved_root
        .to_str()
        .ok_or(UserDataError::InvalidVaultPath)?;
    let digest = format!("{:x}", Sha256::digest(resolved_text.as_bytes()));
    Ok(user_data_root.join("vaults").join(&digest[..24]))
}

/// Prepare the matching per-vault user-data directory and restrict it to the current user.
pub fn prepare_vault_app_data(vault_root: &Path) -> Result<PathBuf, UserDataError> {
    let resolved_root = with_preparation_operation(
        "resolve selected vault path",
        resolve_legacy_path(vault_root),
    )?;
    let canonical_vault = with_preparation_operation(
        "canonicalize selected vault",
        fs::canonicalize(vault_root).map_err(UserDataError::from),
    )?;
    let user_data_root = with_preparation_operation(
        "resolve current user's app-data directory",
        app_user_data_directory(),
    )?;

    // Check the future location before creating any of its directories so selecting a
    // broad parent such as the home directory cannot put recovery data inside the vault.
    let prospective_user_data_root = with_preparation_operation(
        "resolve future app-data path",
        canonicalize_prospective_path(&user_data_root),
    )?;
    let prospective_app_data = with_preparation_operation(
        "compute future per-vault app-data path",
        vault_app_data_directory_under(&prospective_user_data_root, &resolved_root),
    )?;
    if prospective_app_data.starts_with(&canonical_vault) {
        return Err(UserDataError::DataDirectoryInsideVault);
    }

    with_preparation_operation(
        "create current user's app-data directory",
        ensure_real_directory(&user_data_root),
    )?;
    with_preparation_operation(
        "restrict current user's app-data access",
        restrict_directory_to_current_user(&user_data_root),
    )?;
    let canonical_user_data_root = with_preparation_operation(
        "canonicalize current user's app-data directory",
        fs::canonicalize(&user_data_root).map_err(UserDataError::from),
    )?;
    let app_data = with_preparation_operation(
        "compute per-vault app-data path",
        vault_app_data_directory_under(&canonical_user_data_root, &resolved_root),
    )?;
    if app_data.starts_with(&canonical_vault) {
        return Err(UserDataError::DataDirectoryInsideVault);
    }
    with_preparation_operation(
        "write app-data ownership marker",
        ensure_app_data_root_marker(&canonical_user_data_root),
    )?;

    let vaults_directory = canonical_user_data_root.join("vaults");
    with_preparation_operation(
        "create per-vault app-data container",
        ensure_real_directory(&vaults_directory),
    )?;
    with_preparation_operation(
        "restrict per-vault app-data container access",
        restrict_vault_data_access(&vaults_directory),
    )?;

    with_preparation_operation(
        "create per-vault app-data directory",
        ensure_real_directory(&app_data),
    )?;
    with_preparation_operation(
        "restrict per-vault app-data access",
        restrict_vault_data_access(&app_data),
    )?;

    // Resolve after creation and check again so a redirected data directory fails closed.
    let canonical_app_data = with_preparation_operation(
        "canonicalize per-vault app-data directory",
        fs::canonicalize(&app_data).map_err(UserDataError::from),
    )?;
    if canonical_app_data.starts_with(&canonical_vault) {
        return Err(UserDataError::DataDirectoryInsideVault);
    }
    with_preparation_operation(
        "write per-vault ownership marker",
        ensure_owned_data_marker(
            &canonical_app_data,
            VAULT_DATA_MARKER,
            VAULT_DATA_MARKER_CONTENT,
        ),
    )?;
    Ok(canonical_app_data)
}

fn with_preparation_operation<T>(
    operation: &'static str,
    result: Result<T, UserDataError>,
) -> Result<T, UserDataError> {
    result.map_err(|source| UserDataError::OperationFailed {
        operation,
        source: Box::new(source),
    })
}

/// Apply explicit cleanup choices to OpenObsidian-owned data in the current user's data root.
///
/// Only the root `cache` and per-vault `cache`, `recovery`, and `failed` directories are
/// eligible. Vault files, unresolved `conflicts`, operation journals and their required
/// recovery images, the ownership marker, and unknown paths are preserved. The OS
/// package/uninstaller should call this function only after its own explicit cleanup
/// confirmation and after the desktop process has exited.
pub fn cleanup_user_data(
    selection: UserDataCleanupSelection,
    credential_store: Option<&dyn super::CredentialStore>,
) -> Result<UserDataCleanupReport, UserDataError> {
    if !selection.app_cache && !selection.credentials && !selection.recovery_history {
        return Ok(UserDataCleanupReport::default());
    }
    cleanup_user_data_under(&app_user_data_directory()?, selection, credential_store)
}

#[derive(Default)]
struct UserDataCleanupPlan {
    app_cache: Vec<PathBuf>,
    recovery_history: Vec<PathBuf>,
    preserved_journal_recovery_directories: usize,
}

fn cleanup_user_data_under(
    user_data_root: &Path,
    selection: UserDataCleanupSelection,
    credential_store: Option<&dyn super::CredentialStore>,
) -> Result<UserDataCleanupReport, UserDataError> {
    if !selection.app_cache && !selection.credentials && !selection.recovery_history {
        return Ok(UserDataCleanupReport::default());
    }

    let owned_root = match fs::symlink_metadata(user_data_root) {
        Ok(metadata)
            if metadata.file_type().is_symlink()
                || !metadata.is_dir()
                || is_windows_reparse_point(&metadata) =>
        {
            return Err(UserDataError::UnsafeCleanupPath);
        }
        Ok(_) => {
            let canonical_root = fs::canonicalize(user_data_root)?;
            validate_app_data_root_marker(&canonical_root)?;
            Some(canonical_root)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };

    // Validate every selected filesystem target before deleting any category.
    let plan = match owned_root.as_deref() {
        Some(root) => collect_user_data_cleanup_plan(root, selection)?,
        None => UserDataCleanupPlan::default(),
    };

    let credentials = if !selection.credentials {
        UserDataCleanupOutcome::NotSelected
    } else {
        match credential_store {
            Some(store) => match store.delete_all_for_application() {
                Ok(()) => UserDataCleanupOutcome::Completed {
                    removed_directories: 0,
                },
                Err(_) => UserDataCleanupOutcome::Failed {
                    removed_directories: 0,
                    reason: UserDataCleanupFailure::CredentialStoreFailed,
                },
            },
            None => UserDataCleanupOutcome::Failed {
                removed_directories: 0,
                reason: UserDataCleanupFailure::CredentialStoreUnavailable,
            },
        }
    };

    Ok(UserDataCleanupReport {
        app_cache: if selection.app_cache {
            remove_cleanup_directories(&plan.app_cache)
        } else {
            UserDataCleanupOutcome::NotSelected
        },
        credentials,
        recovery_history: if selection.recovery_history {
            remove_cleanup_directories(&plan.recovery_history)
        } else {
            UserDataCleanupOutcome::NotSelected
        },
        preserved_journal_recovery_directories: plan.preserved_journal_recovery_directories,
    })
}

fn collect_user_data_cleanup_plan(
    user_data_root: &Path,
    selection: UserDataCleanupSelection,
) -> Result<UserDataCleanupPlan, UserDataError> {
    let mut plan = UserDataCleanupPlan::default();
    if selection.app_cache {
        collect_cleanup_directory(&user_data_root.join("cache"), &mut plan.app_cache)?;
    }

    if !selection.app_cache && !selection.recovery_history {
        return Ok(plan);
    }

    let vaults_directory = user_data_root.join("vaults");
    if !ensure_cleanup_directory(&vaults_directory)? {
        return Ok(plan);
    }

    for entry in fs::read_dir(&vaults_directory)? {
        let entry = entry?;
        if !is_vault_app_data_id(&entry.file_name().to_string_lossy()) {
            continue;
        }
        let vault_data_directory = entry.path();
        if !ensure_cleanup_directory(&vault_data_directory)? {
            continue;
        }
        if !validate_owned_data_marker(
            &vault_data_directory,
            VAULT_DATA_MARKER,
            VAULT_DATA_MARKER_CONTENT,
        )? {
            // A directory under the reserved name may still be a user vault. Only
            // per-vault roots created by OpenObsidian are eligible for cleanup.
            continue;
        }
        if selection.app_cache {
            collect_cleanup_directory(&vault_data_directory.join("cache"), &mut plan.app_cache)?;
        }
        if selection.recovery_history {
            let recovery_directory = vault_data_directory.join("recovery");
            if ensure_cleanup_directory(&recovery_directory)? {
                if journal_needs_recovery(&vault_data_directory) {
                    plan.preserved_journal_recovery_directories += 1;
                } else {
                    plan.recovery_history.push(recovery_directory);
                }
            }
            collect_cleanup_directory(
                &vault_data_directory.join("failed"),
                &mut plan.recovery_history,
            )?;
        }
    }
    Ok(plan)
}

fn collect_cleanup_directory(
    path: &Path,
    directories: &mut Vec<PathBuf>,
) -> Result<(), UserDataError> {
    if ensure_cleanup_directory(path)? {
        directories.push(path.to_path_buf());
    }
    Ok(())
}

fn ensure_cleanup_directory(path: &Path) -> Result<bool, UserDataError> {
    match fs::symlink_metadata(path) {
        Ok(metadata)
            if metadata.file_type().is_symlink()
                || !metadata.is_dir()
                || is_windows_reparse_point(&metadata) =>
        {
            Err(UserDataError::UnsafeCleanupPath)
        }
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

fn is_vault_app_data_id(value: &str) -> bool {
    value.len() == VAULT_DATA_ID_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn journal_needs_recovery(vault_data_directory: &Path) -> bool {
    let journal_path = vault_data_directory.join("journal.jsonl");
    let metadata = match fs::symlink_metadata(&journal_path) {
        Ok(metadata)
            if metadata.file_type().is_symlink()
                || !metadata.is_file()
                || is_windows_reparse_point(&metadata) =>
        {
            return true;
        }
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return false,
        Err(_) => return true,
    };
    if metadata.len() > MAX_CLEANUP_JOURNAL_BYTES {
        return true;
    }
    let bytes = match fs::read(journal_path) {
        Ok(bytes) => bytes,
        Err(_) => return true,
    };
    let Some(complete_length) = bytes
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map(|index| index + 1)
    else {
        return !bytes.is_empty();
    };
    let complete_text = match std::str::from_utf8(&bytes[..complete_length]) {
        Ok(text) => text,
        Err(_) => return true,
    };
    let mut pending_operations = HashSet::new();
    for line in complete_text.lines().filter(|line| !line.trim().is_empty()) {
        let value: serde_json::Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => return true,
        };
        let Some(operation) = value.get("operation").and_then(serde_json::Value::as_str) else {
            return true;
        };
        let Some(operation_id) = value
            .get("id")
            .and_then(serde_json::Value::as_str)
            .filter(|operation_id| !operation_id.is_empty())
        else {
            return true;
        };
        let Some(state) = value.get("state").and_then(serde_json::Value::as_str) else {
            return true;
        };
        let pending = match (operation, state) {
            ("write", "prepared" | "failed")
            | ("rename", "prepared" | "recovery_required" | "failed") => true,
            ("write", "committed" | "conflict") | ("rename", "committed" | "rolled_back") => false,
            _ => return true,
        };
        if pending {
            pending_operations.insert(operation_id.to_owned());
            if pending_operations.len() > MAX_PENDING_JOURNAL_OPERATIONS {
                return true;
            }
        } else {
            pending_operations.remove(operation_id);
        }
    }
    !pending_operations.is_empty()
}

#[cfg(windows)]
fn is_windows_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_windows_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

fn remove_cleanup_directories(directories: &[PathBuf]) -> UserDataCleanupOutcome {
    let mut removed_directories = 0;
    let mut failed = false;
    for directory in directories {
        match fs::remove_dir_all(directory) {
            Ok(()) => removed_directories += 1,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => failed = true,
        }
    }
    if failed {
        UserDataCleanupOutcome::Failed {
            removed_directories,
            reason: UserDataCleanupFailure::FileSystemFailed,
        }
    } else {
        UserDataCleanupOutcome::Completed {
            removed_directories,
        }
    }
}

fn ensure_app_data_root_marker(user_data_root: &Path) -> Result<(), UserDataError> {
    ensure_owned_data_marker(
        user_data_root,
        APP_DATA_ROOT_MARKER,
        APP_DATA_ROOT_MARKER_CONTENT,
    )
}

fn ensure_owned_data_marker(
    directory: &Path,
    marker_name: &str,
    marker_content: &[u8],
) -> Result<(), UserDataError> {
    let marker_path = directory.join(marker_name);
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&marker_path)
    {
        Ok(mut marker) => {
            if let Err(error) = marker
                .write_all(marker_content)
                .and_then(|()| marker.sync_all())
            {
                let _ = fs::remove_file(&marker_path);
                return Err(error.into());
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            if validate_owned_data_marker(directory, marker_name, marker_content)? {
                Ok(())
            } else {
                Err(UserDataError::UnownedDataDirectory)
            }
        }
        Err(error) => Err(error.into()),
    }
}

fn validate_app_data_root_marker(user_data_root: &Path) -> Result<(), UserDataError> {
    if validate_owned_data_marker(
        user_data_root,
        APP_DATA_ROOT_MARKER,
        APP_DATA_ROOT_MARKER_CONTENT,
    )? {
        Ok(())
    } else {
        Err(UserDataError::UnownedDataDirectory)
    }
}

fn validate_owned_data_marker(
    directory: &Path,
    marker_name: &str,
    marker_content: &[u8],
) -> Result<bool, UserDataError> {
    let marker_path = directory.join(marker_name);
    let metadata = match fs::symlink_metadata(&marker_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || is_windows_reparse_point(&metadata)
        || metadata.len() != marker_content.len() as u64
    {
        return Err(UserDataError::UnownedDataDirectory);
    }
    if fs::read(marker_path)? != marker_content {
        return Err(UserDataError::UnownedDataDirectory);
    }
    Ok(true)
}

fn app_user_data_directory_for(
    platform: &str,
    xdg_config_home: Option<&Path>,
    home: Option<&Path>,
    app_data: Option<&Path>,
) -> Result<PathBuf, UserDataError> {
    let base = match platform {
        "windows" => app_data.ok_or(UserDataError::Unavailable)?.to_path_buf(),
        "macos" => home
            .ok_or(UserDataError::Unavailable)?
            .join("Library")
            .join("Application Support"),
        "linux" => xdg_config_home
            .filter(|path| path.is_absolute())
            .map(Path::to_path_buf)
            .or_else(|| home.map(|path| path.join(".config")))
            .ok_or(UserDataError::Unavailable)?,
        _ => return Err(UserDataError::Unavailable),
    };
    Ok(base.join(PRODUCT_NAME))
}

fn require_absolute_user_data_directory(path: PathBuf) -> Result<PathBuf, UserDataError> {
    if path.is_absolute() {
        Ok(path)
    } else {
        Err(UserDataError::Unavailable)
    }
}

fn resolve_legacy_path(path: &Path) -> Result<PathBuf, UserDataError> {
    let absolute = std::path::absolute(path)?;
    #[cfg(windows)]
    {
        // GetFullPathNameW, used by std::path::absolute for regular Windows paths,
        // applies the same lexical `.`/`..` normalization as Node's path.resolve.
        Ok(absolute)
    }
    #[cfg(not(windows))]
    {
        let mut resolved = PathBuf::new();
        for component in absolute.components() {
            match component {
                Component::RootDir | Component::Prefix(_) => {
                    resolved.push(component.as_os_str());
                }
                Component::CurDir => {}
                Component::ParentDir => {
                    let _ = resolved.pop();
                }
                Component::Normal(segment) => resolved.push(segment),
            }
        }
        Ok(resolved)
    }
}

fn canonicalize_prospective_path(path: &Path) -> Result<PathBuf, UserDataError> {
    let mut existing = path;
    let mut missing_components = Vec::new();
    loop {
        match fs::symlink_metadata(existing) {
            Ok(_) => {
                let mut resolved = fs::canonicalize(existing)?;
                for component in missing_components.iter().rev() {
                    resolved.push(component);
                }
                return Ok(resolved);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let Some(name) = existing.file_name() else {
                    return Err(error.into());
                };
                missing_components.push(name.to_os_string());
                existing = existing.parent().ok_or(error)?;
            }
            Err(error) => return Err(error.into()),
        }
    }
}

fn ensure_real_directory(path: &Path) -> Result<(), UserDataError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(UserDataError::NotDirectory);
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(path)?;
        }
        Err(error) => return Err(error.into()),
    }
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(UserDataError::NotDirectory);
    }
    Ok(())
}

#[cfg(unix)]
fn restrict_directory_to_current_user(path: &Path) -> Result<(), UserDataError> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(windows)]
fn restrict_directory_to_current_user(path: &Path) -> Result<(), UserDataError> {
    use std::process::Command;

    ensure_windows_tree_has_no_reparse_points(path)?;
    let system_directory = env::var_os("SystemRoot")
        .map(PathBuf::from)
        .ok_or(UserDataError::AccessControl)?
        .join("System32");
    let whoami = Command::new(system_directory.join("whoami.exe"))
        .args(["/user", "/fo", "csv", "/nh"])
        .output()
        .map_err(|_| UserDataError::AccessControl)?;
    if !whoami.status.success() {
        return Err(UserDataError::AccessControl);
    }
    let stdout = String::from_utf8_lossy(&whoami.stdout);
    let sid = current_user_sid(&stdout).ok_or(UserDataError::AccessControl)?;
    let icacls = system_directory.join("icacls.exe");

    let reset = Command::new(&icacls)
        .arg(path)
        .args(["/reset", "/T", "/Q"])
        .output()
        .map_err(|_| UserDataError::AccessControl)?;
    if !reset.status.success() {
        return Err(UserDataError::AccessControl);
    }

    let grant = format!("*{sid}:(OI)(CI)F");
    let restricted = Command::new(icacls)
        .arg(path)
        .args(["/inheritancelevel:r", "/grant:r"])
        .arg(grant)
        .args(["/T", "/Q"])
        .output()
        .map_err(|_| UserDataError::AccessControl)?;
    if !restricted.status.success() {
        return Err(UserDataError::AccessControl);
    }
    Ok(())
}

#[cfg(windows)]
fn ensure_windows_tree_has_no_reparse_points(path: &Path) -> Result<(), UserDataError> {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    {
        return Err(UserDataError::NotDirectory);
    }
    if metadata.is_dir() {
        for entry in fs::read_dir(path)? {
            ensure_windows_tree_has_no_reparse_points(&entry?.path())?;
        }
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn restrict_directory_to_current_user(_path: &Path) -> Result<(), UserDataError> {
    Err(UserDataError::AccessControl)
}

#[cfg(unix)]
fn restrict_vault_data_access(path: &Path) -> Result<(), UserDataError> {
    restrict_directory_to_current_user(path)
}

#[cfg(windows)]
fn restrict_vault_data_access(_path: &Path) -> Result<(), UserDataError> {
    // The user-data root's inheritable current-user ACE covers newly created vault data.
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn restrict_vault_data_access(_path: &Path) -> Result<(), UserDataError> {
    Err(UserDataError::AccessControl)
}

#[cfg(windows)]
fn current_user_sid(output: &str) -> Option<&str> {
    let sid = output.lines().find_map(|line| {
        let candidate = line.rsplit(',').next()?.trim().trim_matches('"');
        is_sid(candidate).then_some(candidate)
    })?;
    Some(sid)
}

#[cfg(windows)]
fn is_sid(value: &str) -> bool {
    let mut parts = value.split('-');
    parts.next() == Some("S")
        && parts
            .next()
            .is_some_and(|version| version.parse::<u8>().is_ok())
        && parts.all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SYNC_UNINSTALL_FIXTURE: &str =
        include_str!("../../../fixtures/uninstall-preservation.json");

    #[test]
    fn matches_electron_user_data_location_for_this_platform() {
        #[cfg(target_os = "windows")]
        {
            assert_eq!(
                app_user_data_directory_for(
                    "windows",
                    None,
                    None,
                    Some(Path::new(r"C:\Users\Ada\AppData\Roaming")),
                )
                .unwrap(),
                PathBuf::from(r"C:\Users\Ada\AppData\Roaming\OpenObsidian")
            );
        }

        #[cfg(target_os = "macos")]
        {
            assert_eq!(
                app_user_data_directory_for("macos", None, Some(Path::new("/Users/ada")), None,)
                    .unwrap(),
                PathBuf::from("/Users/ada/Library/Application Support/OpenObsidian")
            );
        }

        #[cfg(target_os = "linux")]
        {
            assert_eq!(
                app_user_data_directory_for(
                    "linux",
                    Some(Path::new("/home/ada/.config-custom")),
                    Some(Path::new("/home/ada")),
                    None,
                )
                .unwrap(),
                PathBuf::from("/home/ada/.config-custom/OpenObsidian")
            );
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn ignores_relative_xdg_home_and_uses_the_home_config_directory() {
        assert_eq!(
            app_user_data_directory_for(
                "linux",
                Some(Path::new("relative-config")),
                Some(Path::new("/home/ada")),
                None,
            )
            .unwrap(),
            PathBuf::from("/home/ada/.config/OpenObsidian")
        );
    }

    #[cfg(unix)]
    #[test]
    fn matches_node_resolve_and_hashes_only_the_first_twenty_four_sha256_digits() {
        let root = Path::new("/var/tmp/Vault/../Vault/.");
        let directory =
            vault_app_data_directory_under(Path::new("/user-data/OpenObsidian"), root).unwrap();
        assert_eq!(
            directory,
            PathBuf::from("/user-data/OpenObsidian/vaults/f37dd519f426bfdfeb4dbc3e")
        );
    }

    #[cfg(windows)]
    #[test]
    fn matches_windows_node_resolve_for_drive_paths() {
        let root = Path::new(r"C:\Users\Test\Vault\..\Case");
        let directory =
            vault_app_data_directory_under(Path::new(r"C:\AppData\OpenObsidian"), root).unwrap();
        assert_eq!(
            directory,
            PathBuf::from(r"C:\AppData\OpenObsidian\vaults\21e3a7e70213929e99aaceb9")
        );
    }

    #[cfg(unix)]
    #[test]
    fn creates_private_app_data_directories_with_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let path = unique_test_directory();
        ensure_real_directory(&path).unwrap();
        restrict_directory_to_current_user(&path).unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o700
        );
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn cleanup_fixture_removes_only_selected_app_data_and_preserves_vault_conflicts_and_journals() {
        use std::cell::Cell;

        struct FixtureCredentialStore(Cell<bool>);

        impl super::super::CredentialStore for FixtureCredentialStore {
            fn get(
                &self,
                _key: &str,
            ) -> Result<Option<Vec<u8>>, super::super::CredentialStoreError> {
                Ok(None)
            }

            fn set(
                &self,
                _key: &str,
                _value: &[u8],
            ) -> Result<(), super::super::CredentialStoreError> {
                Ok(())
            }

            fn delete(&self, _key: &str) -> Result<(), super::super::CredentialStoreError> {
                Ok(())
            }

            fn delete_all_for_application(&self) -> Result<(), super::super::CredentialStoreError> {
                self.0.set(true);
                Ok(())
            }
        }

        let fixture: serde_json::Value = serde_json::from_str(SYNC_UNINSTALL_FIXTURE).unwrap();
        let scenario = &fixture["scenarios"][0];
        let temporary = unique_test_directory();
        let workspace = temporary.join("workspace");
        let vault_root = workspace.join(scenario["vault"]["path"].as_str().unwrap());
        let user_data_root = workspace.join(scenario["app_data"]["path"].as_str().unwrap());
        fs::create_dir_all(&vault_root).unwrap();
        fs::create_dir_all(&user_data_root).unwrap();

        let materialize = |root: &Path, files: &serde_json::Value| {
            files
                .as_array()
                .unwrap()
                .iter()
                .map(|file| {
                    let relative = PathBuf::from(file["relative_path"].as_str().unwrap());
                    let bytes = file["source"].as_str().unwrap().as_bytes().to_vec();
                    let path = root.join(&relative);
                    fs::create_dir_all(path.parent().unwrap()).unwrap();
                    fs::write(path, &bytes).unwrap();
                    (relative, bytes)
                })
                .collect::<Vec<_>>()
        };
        let original_vault_files = materialize(&vault_root, &scenario["vault"]["files"]);
        let original_user_data_files = materialize(&user_data_root, &scenario["app_data"]["files"]);
        let selected = &scenario["selected_options"];
        let selection = UserDataCleanupSelection {
            app_cache: selected
                .as_array()
                .unwrap()
                .iter()
                .any(|value| value == "app-cache"),
            credentials: selected
                .as_array()
                .unwrap()
                .iter()
                .any(|value| value == "credentials"),
            recovery_history: selected
                .as_array()
                .unwrap()
                .iter()
                .any(|value| value == "recovery-history"),
        };
        let credentials = FixtureCredentialStore(Cell::new(false));
        let report =
            cleanup_user_data_under(&user_data_root, selection, Some(&credentials)).unwrap();

        assert!(report.is_complete());
        assert_eq!(
            report.app_cache,
            UserDataCleanupOutcome::Completed {
                removed_directories:
                    scenario["expected"]["selected_cleanup"]["app_cache_directories_removed"]
                        .as_u64()
                        .unwrap() as usize,
            }
        );
        assert_eq!(
            report.recovery_history,
            UserDataCleanupOutcome::Completed {
                removed_directories:
                    scenario["expected"]["selected_cleanup"]["recovery_history_directories_removed"]
                        .as_u64()
                        .unwrap() as usize,
            }
        );
        assert_eq!(
            report.preserved_journal_recovery_directories,
            scenario["expected"]["selected_cleanup"]["journal_recovery_directories_preserved"]
                .as_u64()
                .unwrap() as usize
        );
        assert!(credentials.0.get());

        for relative in [
            Path::new("cache"),
            Path::new("vaults/f37dd519f426bfdfeb4dbc3e/cache"),
            Path::new("vaults/f37dd519f426bfdfeb4dbc3e/failed"),
        ] {
            assert!(
                !user_data_root.join(relative).exists(),
                "{}",
                relative.display()
            );
        }
        for relative in [
            Path::new(".openobsidian-user-data-root"),
            Path::new("vaults/f37dd519f426bfdfeb4dbc3e/.openobsidian-vault-data"),
            Path::new("vaults/f37dd519f426bfdfeb4dbc3e/recovery/record.bin"),
            Path::new(
                "vaults/f37dd519f426bfdfeb4dbc3e/recovery/fixture-rename-rename-before-0.bin",
            ),
            Path::new("vaults/f37dd519f426bfdfeb4dbc3e/conflicts/unresolved.bin"),
            Path::new("vaults/f37dd519f426bfdfeb4dbc3e/journal.jsonl"),
            Path::new("vaults/0123456789abcdef01234567/cache/vault-owned.json"),
            Path::new("user-notes.txt"),
        ] {
            assert!(
                user_data_root.join(relative).exists(),
                "{}",
                relative.display()
            );
        }
        for (relative, original) in original_vault_files {
            assert_eq!(fs::read(vault_root.join(relative)).unwrap(), original);
        }
        for relative in [
            Path::new(".openobsidian-user-data-root"),
            Path::new("vaults/f37dd519f426bfdfeb4dbc3e/.openobsidian-vault-data"),
            Path::new("vaults/f37dd519f426bfdfeb4dbc3e/recovery/record.bin"),
            Path::new(
                "vaults/f37dd519f426bfdfeb4dbc3e/recovery/fixture-rename-rename-before-0.bin",
            ),
            Path::new("vaults/f37dd519f426bfdfeb4dbc3e/conflicts/unresolved.bin"),
            Path::new("vaults/f37dd519f426bfdfeb4dbc3e/journal.jsonl"),
            Path::new("vaults/0123456789abcdef01234567/cache/vault-owned.json"),
            Path::new("user-notes.txt"),
        ] {
            let original = original_user_data_files
                .iter()
                .find(|(path, _)| path.as_path() == relative)
                .unwrap()
                .1
                .as_slice();
            assert_eq!(fs::read(user_data_root.join(relative)).unwrap(), original);
        }
        let _ = fs::remove_dir_all(temporary);
    }

    #[test]
    fn cleanup_refuses_unmarked_data_roots_without_deleting_user_files() {
        let root = unique_test_directory();
        fs::create_dir_all(root.join("cache")).unwrap();
        fs::write(root.join("cache/keep.txt"), b"user data").unwrap();

        assert!(matches!(
            cleanup_user_data_under(
                &root,
                UserDataCleanupSelection {
                    app_cache: true,
                    ..UserDataCleanupSelection::default()
                },
                None,
            ),
            Err(UserDataError::UnownedDataDirectory)
        ));
        assert_eq!(fs::read(root.join("cache/keep.txt")).unwrap(), b"user data");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn unavailable_credential_cleanup_is_reported_without_claiming_success() {
        let root = unique_test_directory();
        fs::create_dir_all(root.join("cache")).unwrap();
        ensure_app_data_root_marker(&root).unwrap();

        let report = cleanup_user_data_under(
            &root,
            UserDataCleanupSelection {
                app_cache: true,
                credentials: true,
                recovery_history: false,
            },
            None,
        )
        .unwrap();

        assert_eq!(
            report.credentials,
            UserDataCleanupOutcome::Failed {
                removed_directories: 0,
                reason: UserDataCleanupFailure::CredentialStoreUnavailable,
            }
        );
        assert!(!report.is_complete());
        assert!(!root.join("cache").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cleanup_only_preserves_recovery_for_unfinished_or_unreadable_journals() {
        let root = unique_test_directory();
        fs::create_dir_all(&root).unwrap();
        let journal = root.join("journal.jsonl");
        fs::write(
            &journal,
            concat!(
                "{\"id\":\"op-1\",\"operation\":\"write\",\"state\":\"prepared\"}\n",
                "{\"id\":\"op-1\",\"operation\":\"write\",\"state\":\"committed\"}\n",
                "{\"id\":\"op-2\",\"operation\":\"rename\",\"state\":\"recovery_required\"}\n",
            ),
        )
        .unwrap();
        assert!(journal_needs_recovery(&root));

        fs::write(
            &journal,
            concat!(
                "{\"id\":\"op-1\",\"operation\":\"write\",\"state\":\"prepared\"}\n",
                "{\"id\":\"op-1\",\"operation\":\"write\",\"state\":\"committed\"}\n",
                "{\"id\":\"op-2\",\"operation\":\"rename\",\"state\":\"prepared\"}\n",
                "{\"id\":\"op-2\",\"operation\":\"rename\",\"state\":\"rolled_back\"}\n",
            ),
        )
        .unwrap();
        assert!(!journal_needs_recovery(&root));

        fs::write(&journal, b"not-json\n").unwrap();
        assert!(journal_needs_recovery(&root));
        fs::write(&journal, b"incomplete-entry").unwrap();
        assert!(journal_needs_recovery(&root));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cleanup_removes_recovery_history_after_journal_operations_are_terminal() {
        let root = unique_test_directory();
        let vault_data = root.join("vaults/f37dd519f426bfdfeb4dbc3e");
        fs::create_dir_all(vault_data.join("recovery")).unwrap();
        ensure_app_data_root_marker(&root).unwrap();
        ensure_owned_data_marker(&vault_data, VAULT_DATA_MARKER, VAULT_DATA_MARKER_CONTENT)
            .unwrap();
        fs::write(
            vault_data.join("journal.jsonl"),
            concat!(
                "{\"id\":\"op-1\",\"operation\":\"write\",\"state\":\"prepared\"}\n",
                "{\"id\":\"op-1\",\"operation\":\"write\",\"state\":\"committed\"}\n",
            ),
        )
        .unwrap();
        fs::write(vault_data.join("recovery/before.bin"), b"old bytes").unwrap();

        let report = cleanup_user_data_under(
            &root,
            UserDataCleanupSelection {
                recovery_history: true,
                ..UserDataCleanupSelection::default()
            },
            None,
        )
        .unwrap();

        assert_eq!(
            report.recovery_history,
            UserDataCleanupOutcome::Completed {
                removed_directories: 1,
            }
        );
        assert_eq!(report.preserved_journal_recovery_directories, 0);
        assert!(!vault_data.join("recovery").exists());
        assert!(vault_data.join("journal.jsonl").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn cleanup_rejects_symlink_targets_before_removing_any_selected_data() {
        use std::os::unix::fs::symlink;

        let root = unique_test_directory();
        let outside = unique_test_directory();
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        ensure_app_data_root_marker(&root).unwrap();
        let vault_data_directory = root.join("vaults/f37dd519f426bfdfeb4dbc3e");
        fs::create_dir_all(&vault_data_directory).unwrap();
        ensure_owned_data_marker(
            &vault_data_directory,
            VAULT_DATA_MARKER,
            VAULT_DATA_MARKER_CONTENT,
        )
        .unwrap();
        fs::create_dir_all(root.join("cache")).unwrap();
        fs::write(root.join("cache/keep.bin"), b"cache bytes").unwrap();
        fs::write(outside.join("external.bin"), b"external bytes").unwrap();
        symlink(&outside, vault_data_directory.join("recovery")).unwrap();

        assert!(matches!(
            cleanup_user_data_under(
                &root,
                UserDataCleanupSelection {
                    app_cache: true,
                    recovery_history: true,
                    credentials: false,
                },
                None,
            ),
            Err(UserDataError::UnsafeCleanupPath)
        ));
        assert!(root.join("cache/keep.bin").exists());
        assert_eq!(
            fs::read(outside.join("external.bin")).unwrap(),
            b"external bytes"
        );
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[cfg(windows)]
    #[test]
    fn creates_app_data_directories_with_current_user_acl() {
        let path = unique_test_directory();
        ensure_real_directory(&path).unwrap();
        restrict_directory_to_current_user(&path).unwrap();
        assert!(path.is_dir());
        fs::remove_dir_all(path).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn extracts_the_current_user_sid_from_whoami_csv() {
        assert_eq!(
            current_user_sid("\"DOMAIN\\\\Ada\",\"S-1-5-21-123-456-789-1001\"\r\n"),
            Some("S-1-5-21-123-456-789-1001")
        );
        assert_eq!(current_user_sid("not a SID\r\n"), None);
    }

    fn unique_test_directory() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};

        static NEXT: AtomicU64 = AtomicU64::new(0);
        env::temp_dir().join(format!(
            "openobsidian-user-data-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ))
    }
}
