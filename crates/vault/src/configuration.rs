//! Read-only discovery of Obsidian-compatible vault configuration files.

use super::{VaultError, VaultRoot, path_to_slashes, sha256_hex};
use openobsidian_doc::{
    AppSettings, AppearanceSettings, HotkeysSettings, ThemeStyleAnalysis, analyze_theme_stylesheet,
    parse_app_settings, parse_appearance_settings, parse_hotkeys_settings,
};
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
    /// Canonical identity for this discovered asset, relative to the vault root.
    pub relative_path: String,
    pub kind: VaultStyleAssetKind,
    pub raw_bytes: Vec<u8>,
    pub sha256: String,
    /// Inert metadata derived from a lossy text decoding of `raw_bytes`.
    pub analysis: ThemeStyleAnalysis,
}

impl VaultStyleAsset {
    /// A user-facing name derived from the path without replacing path identity.
    ///
    /// Folder themes use the directory name for their `theme.css` entrypoint;
    /// direct themes and snippets use the CSS filename stem.
    pub fn display_name(&self) -> String {
        let segments = self.relative_path.split('/').collect::<Vec<_>>();
        let Some(file_name) = segments.last().copied() else {
            return String::new();
        };
        if self.kind == VaultStyleAssetKind::Theme
            && file_name.eq_ignore_ascii_case("theme.css")
            && segments.len() >= 4
            && segments[segments.len() - 3] == "themes"
        {
            return segments[segments.len() - 2].to_owned();
        }
        file_name
            .rsplit_once('.')
            .filter(|(_, extension)| extension.eq_ignore_ascii_case("css"))
            .map(|(stem, _)| stem)
            .unwrap_or(file_name)
            .to_owned()
    }

    /// Compares a requested name using deterministic, locale-independent case folding.
    pub fn matches_display_name(&self, requested_name: &str) -> bool {
        let requested_name = requested_name.trim_matches(is_ecmascript_whitespace);
        !requested_name.is_empty()
            && self.display_name().to_lowercase() == requested_name.to_lowercase()
    }
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
    /// Supported fields from root `app.json` objects, keyed by vault-relative path.
    pub app_settings: BTreeMap<String, AppSettings>,
    /// Data-only command bindings from root `hotkeys.json` files, keyed by vault-relative path.
    pub hotkeys: BTreeMap<String, HotkeysSettings>,
    /// Raw CSS theme and snippet assets, sorted by vault-relative path.
    pub styles: Vec<VaultStyleAsset>,
}

impl VaultConfiguration {
    /// Returns every style matching a name within one discovered configuration folder.
    ///
    /// Returning all matches keeps same-name assets explicit instead of silently
    /// choosing the first path. `configuration_folder` must be one of `folders`.
    pub fn matching_styles(
        &self,
        configuration_folder: &str,
        kind: VaultStyleAssetKind,
        requested_name: &str,
    ) -> Vec<&VaultStyleAsset> {
        if !self
            .folders
            .iter()
            .any(|folder| folder == configuration_folder)
        {
            return Vec::new();
        }
        let prefix = format!("{configuration_folder}/");
        self.styles
            .iter()
            .filter(|style| {
                style.kind == kind
                    && style.relative_path.starts_with(&prefix)
                    && style.matches_display_name(requested_name)
            })
            .collect()
    }
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
            discover_directory(
                self,
                &directory,
                &mut result.json,
                &mut result.appearance,
                &mut result.app_settings,
                &mut result.hotkeys,
            )?;
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
    app_settings: &mut BTreeMap<String, AppSettings>,
    hotkeys: &mut BTreeMap<String, HotkeysSettings>,
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
                discover_directory(
                    vault,
                    &child_directory,
                    json,
                    appearance,
                    app_settings,
                    hotkeys,
                )?;
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
        if is_root_configuration_file(&relative_path, "app.json") {
            app_settings.insert(relative_path.clone(), parse_app_settings(&object));
        }
        if is_root_configuration_file(&relative_path, "hotkeys.json") {
            hotkeys.insert(relative_path.clone(), parse_hotkeys_settings(&object));
        }
        json.insert(relative_path, VaultConfigurationFile { raw_bytes, object });
    }
    Ok(())
}

fn is_root_configuration_file(relative_path: &str, expected_file_name: &str) -> bool {
    let Some((configuration_folder, actual_file_name)) = relative_path.split_once('/') else {
        return false;
    };
    is_configuration_folder(configuration_folder) && actual_file_name == expected_file_name
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
    let analysis = {
        let decoded_source = String::from_utf8_lossy(&raw_bytes);
        analyze_theme_stylesheet(decoded_source.as_ref())
    };
    styles.push(VaultStyleAsset {
        relative_path: path_to_slashes(relative_path)?,
        kind,
        sha256: sha256_hex(&raw_bytes),
        raw_bytes,
        analysis,
    });
    Ok(())
}

fn is_ecmascript_whitespace(character: char) -> bool {
    matches!(
        character,
        '\u{0009}'..='\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
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
