//! Read-only discovery of Obsidian-compatible vault configuration files.

use super::{VaultError, VaultRoot, path_to_slashes, sha256_hex};
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

/// The kind of root configuration folder containing a CSS style asset.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VaultStyleAssetKind {
    Theme,
    Snippet,
}

/// One raw CSS file discovered in a theme or CSS snippets folder.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultStyleAsset {
    pub relative_path: String,
    pub kind: VaultStyleAssetKind,
    pub raw_bytes: Vec<u8>,
    pub sha256: String,
}

/// A stable, read-only inventory of root configuration folders, JSON files, and styles.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct VaultConfiguration {
    /// Root-level `.obsidian` and `.obsidian-*` directories, sorted by name.
    pub folders: Vec<String>,
    /// Valid top-level JSON objects keyed by vault-relative paths using `/`.
    pub json: BTreeMap<String, VaultConfigurationFile>,
    /// Supported fields from valid `appearance.json` objects, keyed by vault-relative path.
    pub appearance: BTreeMap<String, AppearanceSettings>,
    /// Raw CSS theme and snippet assets, sorted by vault-relative path.
    pub styles: Vec<VaultStyleAsset>,
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
            discover_style_assets(self, &directory, &mut result.styles)?;
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

fn discover_style_assets(
    vault: &VaultRoot,
    configuration_directory: &Path,
    styles: &mut Vec<VaultStyleAsset>,
) -> Result<(), VaultError> {
    for (directory_name, kind) in [
        ("themes", VaultStyleAssetKind::Theme),
        ("snippets", VaultStyleAssetKind::Snippet),
    ] {
        let directory = configuration_directory.join(directory_name);
        let Some(directory) = optional_confined_directory(vault, &directory)? else {
            continue;
        };
        let mut entries = fs::read_dir(directory)?.collect::<Result<Vec<_>, _>>()?;
        entries.sort_by_key(|entry| entry.file_name());

        for entry in entries {
            let path = entry.path();
            let file_type = entry.file_type()?;
            if file_type.is_file() && has_css_suffix(&path) {
                push_style_asset(vault, &path, kind, styles)?;
            } else if kind == VaultStyleAssetKind::Theme && file_type.is_dir() {
                let Some(theme_directory) = confined_directory(vault, &path)? else {
                    continue;
                };
                let theme_stylesheet = theme_directory.join("theme.css");
                let metadata = match fs::symlink_metadata(&theme_stylesheet) {
                    Ok(metadata) => metadata,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(error) => return Err(error.into()),
                };
                if metadata.is_file() && !metadata.file_type().is_symlink() {
                    push_style_asset(vault, &theme_stylesheet, kind, styles)?;
                }
            }
        }
    }

    styles.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(())
}

fn optional_confined_directory(
    vault: &VaultRoot,
    directory: &Path,
) -> Result<Option<PathBuf>, VaultError> {
    let metadata = match fs::symlink_metadata(directory) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Ok(None);
    }
    confined_directory(vault, directory)
}

fn has_css_suffix(path: &Path) -> bool {
    path.file_name()
        .and_then(OsStr::to_str)
        .and_then(|name| name.get(name.len().saturating_sub(".css".len())..))
        .is_some_and(|suffix| suffix.eq_ignore_ascii_case(".css"))
}

fn push_style_asset(
    vault: &VaultRoot,
    path: &Path,
    kind: VaultStyleAssetKind,
    styles: &mut Vec<VaultStyleAsset>,
) -> Result<(), VaultError> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Ok(());
    }
    let relative_path = path
        .strip_prefix(vault.path())
        .map_err(|_| VaultError::OutsideRoot(path.to_path_buf()))?;
    let resolved_path = vault.resolve_regular_file_path(relative_path)?;
    let raw_bytes = fs::read(resolved_path)?;
    styles.push(VaultStyleAsset {
        relative_path: path_to_slashes(relative_path)?,
        kind,
        sha256: sha256_hex(&raw_bytes),
        raw_bytes,
    });
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
