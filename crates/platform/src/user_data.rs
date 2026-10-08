//! Private per-user directories for app-owned vault history and recovery data.

use sha2::{Digest, Sha256};
use std::env;
use std::fs;
#[cfg(not(windows))]
use std::path::Component;
use std::path::{Path, PathBuf};
use thiserror::Error;

const PRODUCT_NAME: &str = "OpenObsidian";

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
    #[error("application data filesystem operation failed: {0}")]
    Io(#[from] std::io::Error),
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
    let resolved_root = resolve_legacy_path(vault_root)?;
    let canonical_vault = fs::canonicalize(vault_root)?;
    let user_data_root = app_user_data_directory()?;

    // Check the future location before creating any of its directories so selecting a
    // broad parent such as the home directory cannot put recovery data inside the vault.
    let prospective_user_data_root = canonicalize_prospective_path(&user_data_root)?;
    let prospective_app_data =
        vault_app_data_directory_under(&prospective_user_data_root, &resolved_root)?;
    if prospective_app_data.starts_with(&canonical_vault) {
        return Err(UserDataError::DataDirectoryInsideVault);
    }

    ensure_real_directory(&user_data_root)?;
    restrict_directory_to_current_user(&user_data_root)?;
    let canonical_user_data_root = fs::canonicalize(&user_data_root)?;
    let app_data = vault_app_data_directory_under(&canonical_user_data_root, &resolved_root)?;
    if app_data.starts_with(&canonical_vault) {
        return Err(UserDataError::DataDirectoryInsideVault);
    }

    let vaults_directory = canonical_user_data_root.join("vaults");
    ensure_real_directory(&vaults_directory)?;
    restrict_vault_data_access(&vaults_directory)?;

    ensure_real_directory(&app_data)?;
    restrict_vault_data_access(&app_data)?;

    // Resolve after creation and check again so a redirected data directory fails closed.
    let canonical_app_data = fs::canonicalize(&app_data)?;
    if canonical_app_data.starts_with(&canonical_vault) {
        return Err(UserDataError::DataDirectoryInsideVault);
    }
    Ok(canonical_app_data)
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
