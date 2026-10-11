//! Read-only discovery of Obsidian-compatible vault configuration files.

use super::{VaultError, VaultRoot, path_to_slashes};
use openobsidian_doc::{AppearanceSettings, parse_appearance_settings};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

/// One valid JSON object discovered inside a vault configuration folder.
///
/// `raw_bytes` retains the exact file contents while `object` exposes its
/// parsed fields without dropping unknown keys.
#[derive(Clone, Debug, PartialEq)]
pub struct VaultConfigurationFile {
    pub raw_bytes: Vec<u8>,
    pub object: Map<String, Value>,
}

/// A stable, read-only inventory of root configuration folders and JSON files.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct VaultConfiguration {
    /// Root-level `.obsidian` and `.obsidian-*` directories, sorted by name.
    pub folders: Vec<String>,
    /// Valid top-level JSON objects keyed by vault-relative paths using `/`.
    pub json: BTreeMap<String, VaultConfigurationFile>,
    /// Supported fields from valid `appearance.json` objects, keyed by vault-relative path.
    pub appearance: BTreeMap<String, AppearanceSettings>,
}

impl VaultRoot {
    /// Discovers existing Obsidian configuration without creating or modifying files.
    ///
    /// Only real root-level `.obsidian` and `.obsidian-*` directories are
    /// considered. Symlinks are skipped at every level. Like the legacy
    /// discovery, malformed JSON and non-object JSON values are omitted.
    pub fn discover_configuration(&self) -> Result<VaultConfiguration, VaultError> {
        let mut directories = fs::read_dir(self.path())?.collect::<Result<Vec<_>, _>>()?;
        directories.sort_by_key(|entry| entry.file_name());

        let mut result = VaultConfiguration::default();
        for entry in directories {
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if !is_configuration_folder(&name) || !entry.file_type()?.is_dir() {
                continue;
            }

            let Some(directory) = confined_directory(self, &entry.path())? else {
                continue;
            };
            result.folders.push(name);
            discover_directory(self, &directory, &mut result.json, &mut result.appearance)?;
        }
        Ok(result)
    }
}

fn is_configuration_folder(name: &str) -> bool {
    name == ".obsidian" || name.starts_with(".obsidian-")
}

fn discover_directory(
    vault: &VaultRoot,
    directory: &Path,
    json: &mut BTreeMap<String, VaultConfigurationFile>,
    appearance: &mut BTreeMap<String, AppearanceSettings>,
) -> Result<(), VaultError> {
    let Some(directory) = confined_directory(vault, directory)? else {
        return Ok(());
    };
    let mut entries = fs::read_dir(&directory)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            if let Some(child_directory) = confined_directory(vault, &path)? {
                discover_directory(vault, &child_directory, json, appearance)?;
            }
            continue;
        }
        if !file_type.is_file() || path.extension() != Some(OsStr::new("json")) {
            continue;
        }

        let relative_path = path
            .strip_prefix(vault.path())
            .map_err(|_| VaultError::OutsideRoot(path.clone()))?;
        let resolved_path = vault.resolve_regular_file_path(relative_path)?;
        let raw_bytes = fs::read(resolved_path)?;
        let Ok(Value::Object(object)) = serde_json::from_slice::<Value>(&raw_bytes) else {
            continue;
        };
        let relative_path = path_to_slashes(relative_path)?;
        if relative_path.ends_with("/appearance.json") {
            appearance.insert(relative_path.clone(), parse_appearance_settings(&object));
        }
        json.insert(relative_path, VaultConfigurationFile { raw_bytes, object });
    }
    Ok(())
}

fn confined_directory(vault: &VaultRoot, directory: &Path) -> Result<Option<PathBuf>, VaultError> {
    let metadata = fs::symlink_metadata(directory)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Ok(None);
    }
    let canonical = fs::canonicalize(directory)?;
    if !canonical.starts_with(vault.path()) {
        return Err(VaultError::OutsideRoot(directory.to_path_buf()));
    }
    Ok(Some(canonical))
}
