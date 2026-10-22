//! Read-only plugin discovery and pinned-artifact comparison.
//!
//! Discovery is pure over [`VaultFileSource`], so the vault adapter (confined, no-follow
//! inventory) and in-memory test sources share one code path. It never executes plugin
//! code, never writes, never follows symlinks, and never reads `data.json` contents
//! because plugin settings may hold secrets; only its presence and size are reported.
//! Every file read is bounded by [`DiscoveryLimits`], and every omission or anomaly is
//! returned as a [`DiscoveryIssue`] instead of being dropped.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::manifest::{DEFAULT_MAX_MANIFEST_DEPTH, IssueSeverity, PluginManifest, parse_manifest};

/// Vault-relative directory that holds one sub-directory per installed plugin.
pub const PLUGINS_DIR: &str = ".obsidian/plugins";
/// Vault-relative file listing the ids of enabled community plugins.
pub const COMMUNITY_PLUGINS_FILE: &str = ".obsidian/community-plugins.json";

/// Kind of a directory entry as reported by a [`VaultFileSource`], without following links.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EntryKind {
    /// A regular file.
    File,
    /// A directory.
    Directory,
    /// A symbolic link (never followed).
    Symlink,
    /// Any other file type.
    Other,
}

/// One entry returned by [`VaultFileSource::list_dir`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceEntry {
    /// File name without any directory component.
    pub name: String,
    /// Entry kind, determined without following symlinks.
    pub kind: EntryKind,
    /// Size in bytes for regular files; zero otherwise.
    pub size: u64,
}

/// Failure reading from a [`VaultFileSource`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SourceError {
    /// The path does not exist.
    NotFound,
    /// The file is larger than the byte limit supplied by the caller.
    TooLarge,
    /// Any other failure, with a displayable description.
    Io(String),
}

impl fmt::Display for SourceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound => formatter.write_str("not found"),
            Self::TooLarge => formatter.write_str("file exceeds the byte limit"),
            Self::Io(message) => formatter.write_str(message),
        }
    }
}

/// Read-only, confined view of a vault used by discovery.
///
/// Paths are vault-relative and `/`-separated. Implementations must not follow symlinks
/// and must reject paths that would leave the vault.
pub trait VaultFileSource {
    /// Lists the direct children of a directory, reporting entry kinds without following links.
    fn list_dir(&self, path: &str) -> Result<Vec<SourceEntry>, SourceError>;

    /// Reads a regular file, failing with [`SourceError::TooLarge`] beyond `max_bytes`.
    fn read_file(&self, path: &str, max_bytes: u64) -> Result<Vec<u8>, SourceError>;
}

/// Caps that bound discovery work and memory.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DiscoveryLimits {
    /// Maximum number of plugin directories examined; the rest are reported as omitted.
    pub max_plugins: usize,
    /// Maximum bytes read from any single file.
    pub max_file_bytes: u64,
    /// Maximum JSON nesting depth accepted in a manifest.
    pub max_manifest_depth: usize,
}

impl Default for DiscoveryLimits {
    fn default() -> Self {
        Self {
            max_plugins: 512,
            max_file_bytes: 32 * 1024 * 1024,
            max_manifest_depth: DEFAULT_MAX_MANIFEST_DEPTH,
        }
    }
}

/// Category of a [`DiscoveryIssue`].
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DiscoveryIssueKind {
    /// A symlink was found where a file or directory was expected and was not followed.
    SymlinkSkipped,
    /// An entry that must be a regular file or directory had another type.
    UnexpectedEntryType,
    /// A file exceeded the byte limit and was not read.
    FileTooLarge,
    /// A file or directory could not be read.
    ReadFailed,
    /// `manifest.json` is absent.
    ManifestMissing,
    /// `manifest.json` could not be parsed or has a deviating field.
    ManifestInvalid,
    /// `main.js` is absent.
    MainJsMissing,
    /// The manifest `id` differs from the plugin directory name.
    IdMismatch,
    /// Two plugin directories resolve to the same id ignoring case.
    DuplicateId,
    /// `community-plugins.json` is not a JSON array of strings.
    CommunityListInvalid,
    /// More plugin directories exist than `max_plugins`; the remainder were not examined.
    PluginLimitExceeded,
}

/// A visible discovery anomaly.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DiscoveryIssue {
    /// Issue category.
    pub kind: DiscoveryIssueKind,
    /// Plugin directory name the issue belongs to, or `None` for vault-level issues.
    pub plugin_dir: Option<String>,
    /// Vault-relative path involved.
    pub path: String,
    /// Human-readable description.
    pub message: String,
}

/// Identity of an installed plugin's artifacts, used for pin comparison.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArtifactIdentity {
    /// Plugin id from the manifest.
    pub id: String,
    /// Plugin version from the manifest.
    pub version: String,
    /// Lowercase hex SHA-256 of `main.js`.
    pub main_js_sha256: String,
    /// Size in bytes of `main.js`.
    pub size: u64,
    /// Lowercase hex SHA-256 of `styles.css`, when present.
    pub styles_sha256: Option<String>,
}

/// Result of comparing an [`ArtifactIdentity`] with the pinned table.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PinStatus {
    /// Version and every pinned hash match.
    MatchesPinned,
    /// The id is pinned but the installed version differs.
    DifferentVersion,
    /// The version matches but `main.js`, its size or `styles.css` differ from the pin.
    HashMismatch,
    /// No pin exists for the id.
    Unpinned,
}

/// A pinned release artifact derived from `fixtures/compatibility-manifest.json`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PinnedArtifact {
    /// Lookup key: manifest id, else registry id, else display name (themes).
    pub id: String,
    /// Display name.
    pub name: String,
    /// Released version (the release tag).
    pub version: String,
    /// Pinned `main.js` SHA-256 and byte count; `None` for themes.
    pub main_js: Option<(String, u64)>,
    /// Pinned `styles.css` SHA-256, when the release ships one.
    pub styles_sha256: Option<String>,
    /// Pinned `theme.css` SHA-256, for themes.
    pub theme_css_sha256: Option<String>,
}

/// Error building a [`PinnedArtifacts`] table.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PinTableError(pub String);

impl fmt::Display for PinTableError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "invalid pin table: {}", self.0)
    }
}

impl std::error::Error for PinTableError {}

/// Release tags that name a moving development branch rather than an immutable release.
const DEVELOPMENT_REFS: &[&str] = &[
    "main", "master", "head", "latest", "develop", "dev", "trunk", "nightly",
];

/// Table of pinned artifacts keyed by id.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct PinnedArtifacts {
    by_id: BTreeMap<String, PinnedArtifact>,
}

impl PinnedArtifacts {
    /// Builds the table from the checked-in `fixtures/compatibility-manifest.json`.
    pub fn bundled() -> Result<Self, PinTableError> {
        Self::from_manifest_json(include_str!(
            "../../../fixtures/compatibility-manifest.json"
        ))
    }

    /// Parses a compatibility manifest of the documented `artifacts[].release_assets[]` shape.
    ///
    /// Release tags naming a development branch, duplicate ids and malformed hashes are
    /// rejected so no moving reference can be treated as a release.
    pub fn from_manifest_json(text: &str) -> Result<Self, PinTableError> {
        let root: Value =
            serde_json::from_str(text).map_err(|error| PinTableError(error.to_string()))?;
        let artifacts = root
            .get("artifacts")
            .and_then(Value::as_array)
            .ok_or_else(|| PinTableError("missing `artifacts` array".into()))?;
        let mut by_id = BTreeMap::new();
        for artifact in artifacts {
            let pinned = parse_pinned(artifact)?;
            let id = pinned.id.clone();
            if by_id.insert(id.clone(), pinned).is_some() {
                return Err(PinTableError(format!("duplicate pinned id `{id}`")));
            }
        }
        Ok(Self { by_id })
    }

    /// Returns the pin for `id`, if any.
    pub fn get(&self, id: &str) -> Option<&PinnedArtifact> {
        self.by_id.get(id)
    }

    /// Number of pinned artifacts.
    pub fn len(&self) -> usize {
        self.by_id.len()
    }

    /// Whether the table is empty.
    pub fn is_empty(&self) -> bool {
        self.by_id.is_empty()
    }

    /// Compares an installed identity with its pin.
    pub fn compare(&self, identity: &ArtifactIdentity) -> PinStatus {
        let Some(pin) = self.get(&identity.id) else {
            return PinStatus::Unpinned;
        };
        if pin.version != identity.version {
            return PinStatus::DifferentVersion;
        }
        let main_matches = pin.main_js.as_ref().is_some_and(|(hash, bytes)| {
            *hash == identity.main_js_sha256 && *bytes == identity.size
        });
        if main_matches && pin.styles_sha256 == identity.styles_sha256 {
            PinStatus::MatchesPinned
        } else {
            PinStatus::HashMismatch
        }
    }
}

fn parse_pinned(artifact: &Value) -> Result<PinnedArtifact, PinTableError> {
    let text = |value: &Value, key: &str| value.get(key).and_then(Value::as_str).map(str::to_owned);
    let label = text(artifact, "id").unwrap_or_else(|| "<unknown>".into());
    let fail = |message: &str| PinTableError(format!("{label}: {message}"));

    let name = text(artifact, "name").ok_or_else(|| fail("missing `name`"))?;
    let tag = text(artifact, "tag").ok_or_else(|| fail("missing `tag`"))?;
    let lowered = tag.to_ascii_lowercase();
    if DEVELOPMENT_REFS.contains(&lowered.as_str()) || !tag.bytes().any(|b| b.is_ascii_digit()) {
        return Err(fail("`tag` is not an immutable release version"));
    }
    let assets = artifact
        .get("release_assets")
        .and_then(Value::as_array)
        .ok_or_else(|| fail("missing `release_assets`"))?;

    let mut manifest_id = None;
    let mut main_js = None;
    let mut styles_sha256 = None;
    let mut theme_css_sha256 = None;
    for asset in assets {
        let asset_name = text(asset, "name").unwrap_or_default();
        let hash = || -> Result<String, PinTableError> {
            let hash = text(asset, "sha256").ok_or_else(|| fail("asset missing `sha256`"))?;
            let valid = hash.len() == 64
                && hash
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
            if valid {
                Ok(hash)
            } else {
                Err(fail("asset `sha256` is not 64 lowercase hex digits"))
            }
        };
        match asset_name.as_str() {
            "main.js" => {
                let bytes = asset
                    .get("bytes")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| fail("`main.js` missing `bytes`"))?;
                main_js = Some((hash()?, bytes));
            }
            "styles.css" => styles_sha256 = Some(hash()?),
            "theme.css" => theme_css_sha256 = Some(hash()?),
            "manifest.json" => {
                manifest_id = asset
                    .get("manifest")
                    .and_then(|manifest| manifest.get("id"))
                    .and_then(Value::as_str)
                    .map(str::to_owned);
            }
            _ => {}
        }
    }

    let id = manifest_id
        .or_else(|| text(artifact, "registry_id"))
        .unwrap_or_else(|| name.clone());
    Ok(PinnedArtifact {
        id,
        name,
        version: tag,
        main_js,
        styles_sha256,
        theme_css_sha256,
    })
}

/// One installed plugin directory and everything learned about it.
#[derive(Clone, Debug, PartialEq)]
pub struct DiscoveredPlugin {
    /// Directory name under [`PLUGINS_DIR`].
    pub dir_name: String,
    /// Parsed manifest, when usable.
    pub manifest: Option<PluginManifest>,
    /// Artifact identity; `None` without a usable manifest or readable `main.js`.
    pub identity: Option<ArtifactIdentity>,
    /// Pin comparison; `None` exactly when `identity` is `None`.
    pub pin_status: Option<PinStatus>,
    /// Whether `styles.css` is a regular file.
    pub has_styles: bool,
    /// Whether `data.json` is present as a regular file. Its contents are never read.
    pub has_data: bool,
    /// Size of `data.json` in bytes, when present.
    pub data_size: Option<u64>,
    /// Whether the directory name is listed in `community-plugins.json`.
    pub enabled_in_config: bool,
    /// Issues specific to this plugin.
    pub issues: Vec<DiscoveryIssue>,
}

/// Complete result of a discovery pass.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DiscoveryReport {
    /// Plugins in directory-name order.
    pub plugins: Vec<DiscoveredPlugin>,
    /// Ids listed in `community-plugins.json`, in file order.
    pub enabled_ids: Vec<String>,
    /// Enabled ids with no examined plugin directory.
    pub enabled_without_plugin: Vec<String>,
    /// Number of plugin directories not examined because of `max_plugins`.
    pub omitted_plugins: usize,
    /// Vault-level issues.
    pub issues: Vec<DiscoveryIssue>,
}

impl DiscoveryReport {
    /// Iterates over every issue, vault-level first, then per plugin.
    pub fn all_issues(&self) -> impl Iterator<Item = &DiscoveryIssue> {
        self.issues
            .iter()
            .chain(self.plugins.iter().flat_map(|plugin| plugin.issues.iter()))
    }
}

/// Discovers installed plugins and compares them with `pins`.
///
/// The result is deterministic for a given source: directories are processed in name order.
pub fn discover_plugins<S: VaultFileSource + ?Sized>(
    source: &S,
    limits: &DiscoveryLimits,
    pins: &PinnedArtifacts,
) -> DiscoveryReport {
    let mut report = DiscoveryReport::default();
    let enabled = read_enabled_ids(source, limits, &mut report.issues);
    report.enabled_ids = enabled;

    let mut dirs = match source.list_dir(PLUGINS_DIR) {
        Ok(entries) => entries,
        Err(SourceError::NotFound) => Vec::new(),
        Err(error) => {
            report.issues.push(vault_issue(
                DiscoveryIssueKind::ReadFailed,
                PLUGINS_DIR,
                format!("cannot list plugin directory: {error}"),
            ));
            Vec::new()
        }
    };
    dirs.retain(|entry| matches!(entry.kind, EntryKind::Directory | EntryKind::Symlink));
    dirs.sort_by(|a, b| a.name.cmp(&b.name));
    if dirs.len() > limits.max_plugins {
        report.omitted_plugins = dirs.len() - limits.max_plugins;
        dirs.truncate(limits.max_plugins);
        report.issues.push(vault_issue(
            DiscoveryIssueKind::PluginLimitExceeded,
            PLUGINS_DIR,
            format!(
                "{} plugin directories were not examined (limit {})",
                report.omitted_plugins, limits.max_plugins
            ),
        ));
    }

    let enabled_set: BTreeSet<&str> = report.enabled_ids.iter().map(String::as_str).collect();
    let mut seen_ids = BTreeSet::new();
    let mut plugins = Vec::with_capacity(dirs.len());
    for entry in &dirs {
        let mut plugin = inspect_plugin(source, limits, pins, entry);
        plugin.enabled_in_config = enabled_set.contains(plugin.dir_name.as_str());
        let key = plugin
            .manifest
            .as_ref()
            .map_or(plugin.dir_name.as_str(), |manifest| manifest.id.as_str())
            .to_lowercase();
        if !seen_ids.insert(key.clone()) {
            let path = format!("{PLUGINS_DIR}/{}", plugin.dir_name);
            plugin.issues.push(plugin_issue(
                DiscoveryIssueKind::DuplicateId,
                &plugin.dir_name,
                path,
                format!("id `{key}` is already used by another plugin directory"),
            ));
        }
        plugins.push(plugin);
    }

    report.enabled_without_plugin = report
        .enabled_ids
        .iter()
        .filter(|id| !plugins.iter().any(|plugin| &plugin.dir_name == *id))
        .cloned()
        .collect();
    report.plugins = plugins;
    report
}

fn read_enabled_ids<S: VaultFileSource + ?Sized>(
    source: &S,
    limits: &DiscoveryLimits,
    issues: &mut Vec<DiscoveryIssue>,
) -> Vec<String> {
    let bytes = match source.read_file(COMMUNITY_PLUGINS_FILE, limits.max_file_bytes) {
        Ok(bytes) => bytes,
        Err(SourceError::NotFound) => return Vec::new(),
        Err(error) => {
            let kind = if error == SourceError::TooLarge {
                DiscoveryIssueKind::FileTooLarge
            } else {
                DiscoveryIssueKind::ReadFailed
            };
            issues.push(vault_issue(
                kind,
                COMMUNITY_PLUGINS_FILE,
                format!("cannot read enabled plugin list: {error}"),
            ));
            return Vec::new();
        }
    };
    let body = bytes
        .strip_prefix(&[0xEF, 0xBB, 0xBF][..])
        .unwrap_or(&bytes);
    let parsed = serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|value| {
            value.as_array().and_then(|items| {
                items
                    .iter()
                    .map(|item| item.as_str().map(str::to_owned))
                    .collect::<Option<Vec<_>>>()
            })
        });
    parsed.unwrap_or_else(|| {
        issues.push(vault_issue(
            DiscoveryIssueKind::CommunityListInvalid,
            COMMUNITY_PLUGINS_FILE,
            "enabled plugin list must be a JSON array of strings".into(),
        ));
        Vec::new()
    })
}

fn vault_issue(kind: DiscoveryIssueKind, path: &str, message: String) -> DiscoveryIssue {
    DiscoveryIssue {
        kind,
        plugin_dir: None,
        path: path.to_owned(),
        message,
    }
}

fn plugin_issue(
    kind: DiscoveryIssueKind,
    dir_name: &str,
    path: String,
    message: String,
) -> DiscoveryIssue {
    DiscoveryIssue {
        kind,
        plugin_dir: Some(dir_name.to_owned()),
        path,
        message,
    }
}

/// Outcome of locating and reading one expected file inside a plugin directory.
enum FileRead {
    Absent,
    Bytes(Vec<u8>),
    /// File exists but was not read; the reason is already recorded as an issue.
    Unusable,
}

fn inspect_plugin<S: VaultFileSource + ?Sized>(
    source: &S,
    limits: &DiscoveryLimits,
    pins: &PinnedArtifacts,
    dir: &SourceEntry,
) -> DiscoveredPlugin {
    let dir_path = format!("{PLUGINS_DIR}/{}", dir.name);
    let mut plugin = DiscoveredPlugin {
        dir_name: dir.name.clone(),
        manifest: None,
        identity: None,
        pin_status: None,
        has_styles: false,
        has_data: false,
        data_size: None,
        enabled_in_config: false,
        issues: Vec::new(),
    };
    if dir.kind == EntryKind::Symlink {
        plugin.issues.push(plugin_issue(
            DiscoveryIssueKind::SymlinkSkipped,
            &dir.name,
            dir_path,
            "plugin directory is a symlink and was not followed".into(),
        ));
        return plugin;
    }
    let entries = match source.list_dir(&dir_path) {
        Ok(entries) => entries,
        Err(error) => {
            plugin.issues.push(plugin_issue(
                DiscoveryIssueKind::ReadFailed,
                &dir.name,
                dir_path,
                format!("cannot list plugin directory: {error}"),
            ));
            return plugin;
        }
    };

    let manifest_bytes = read_expected(
        source,
        limits,
        &dir_path,
        &entries,
        "manifest.json",
        &mut plugin.issues,
        &dir.name,
    );
    let main_bytes = read_expected(
        source,
        limits,
        &dir_path,
        &entries,
        "main.js",
        &mut plugin.issues,
        &dir.name,
    );
    let styles_bytes = read_expected(
        source,
        limits,
        &dir_path,
        &entries,
        "styles.css",
        &mut plugin.issues,
        &dir.name,
    );
    plugin.has_styles = matches!(styles_bytes, FileRead::Bytes(_));

    // `data.json` is only stat-ed from the directory listing; its contents are never read.
    if let Some(data) = entries.iter().find(|entry| entry.name == "data.json") {
        if data.kind == EntryKind::File {
            plugin.has_data = true;
            plugin.data_size = Some(data.size);
        } else {
            plugin
                .issues
                .push(unexpected_entry(&dir.name, &dir_path, data));
        }
    }

    match manifest_bytes {
        FileRead::Absent => plugin.issues.push(plugin_issue(
            DiscoveryIssueKind::ManifestMissing,
            &dir.name,
            format!("{dir_path}/manifest.json"),
            "manifest.json is missing".into(),
        )),
        FileRead::Unusable => {}
        FileRead::Bytes(bytes) => {
            let parsed = parse_manifest(&bytes, limits.max_manifest_depth);
            for issue in parsed.issues {
                let severity = match issue.severity {
                    IssueSeverity::Error => "error",
                    IssueSeverity::Warning => "warning",
                };
                let field = issue.field.map(|f| format!(" ({f})")).unwrap_or_default();
                plugin.issues.push(plugin_issue(
                    DiscoveryIssueKind::ManifestInvalid,
                    &dir.name,
                    format!("{dir_path}/manifest.json"),
                    format!("{severity}{field}: {}", issue.message),
                ));
            }
            plugin.manifest = parsed.manifest;
        }
    }

    if let Some(manifest) = &plugin.manifest
        && manifest.id != dir.name
    {
        plugin.issues.push(plugin_issue(
            DiscoveryIssueKind::IdMismatch,
            &dir.name,
            format!("{dir_path}/manifest.json"),
            format!(
                "manifest id `{}` differs from directory name `{}`",
                manifest.id, dir.name
            ),
        ));
    }

    match main_bytes {
        FileRead::Absent => plugin.issues.push(plugin_issue(
            DiscoveryIssueKind::MainJsMissing,
            &dir.name,
            format!("{dir_path}/main.js"),
            "main.js is missing".into(),
        )),
        FileRead::Unusable => {}
        FileRead::Bytes(main) => {
            if let Some(manifest) = &plugin.manifest {
                let styles = match &styles_bytes {
                    FileRead::Bytes(bytes) => Some(sha256_hex(bytes)),
                    _ => None,
                };
                let identity = ArtifactIdentity {
                    id: manifest.id.clone(),
                    version: manifest.version.clone(),
                    main_js_sha256: sha256_hex(&main),
                    size: main.len() as u64,
                    styles_sha256: styles,
                };
                plugin.pin_status = Some(pins.compare(&identity));
                plugin.identity = Some(identity);
            }
        }
    }
    plugin
}

fn unexpected_entry(dir_name: &str, dir_path: &str, entry: &SourceEntry) -> DiscoveryIssue {
    let (kind, message) = if entry.kind == EntryKind::Symlink {
        (
            DiscoveryIssueKind::SymlinkSkipped,
            format!("{} is a symlink and was not followed", entry.name),
        )
    } else {
        (
            DiscoveryIssueKind::UnexpectedEntryType,
            format!("{} is not a regular file", entry.name),
        )
    };
    plugin_issue(
        kind,
        dir_name,
        format!("{dir_path}/{}", entry.name),
        message,
    )
}

/// Locates `name` in `entries` and reads it within the byte limit, recording issues.
fn read_expected<S: VaultFileSource + ?Sized>(
    source: &S,
    limits: &DiscoveryLimits,
    dir_path: &str,
    entries: &[SourceEntry],
    name: &str,
    issues: &mut Vec<DiscoveryIssue>,
    dir_name: &str,
) -> FileRead {
    let Some(entry) = entries.iter().find(|entry| entry.name == name) else {
        return FileRead::Absent;
    };
    if entry.kind != EntryKind::File {
        issues.push(unexpected_entry(dir_name, dir_path, entry));
        return FileRead::Unusable;
    }
    let path = format!("{dir_path}/{name}");
    if entry.size > limits.max_file_bytes {
        issues.push(plugin_issue(
            DiscoveryIssueKind::FileTooLarge,
            dir_name,
            path,
            format!(
                "{name} is {} bytes, above the {} byte limit",
                entry.size, limits.max_file_bytes
            ),
        ));
        return FileRead::Unusable;
    }
    match source.read_file(&path, limits.max_file_bytes) {
        Ok(bytes) => FileRead::Bytes(bytes),
        Err(SourceError::NotFound) => FileRead::Absent,
        Err(error) => {
            let kind = if error == SourceError::TooLarge {
                DiscoveryIssueKind::FileTooLarge
            } else {
                DiscoveryIssueKind::ReadFailed
            };
            issues.push(plugin_issue(
                kind,
                dir_name,
                path,
                format!("cannot read {name}: {error}"),
            ));
            FileRead::Unusable
        }
    }
}

/// Lowercase hex SHA-256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push(char::from(HEX[usize::from(byte >> 4)]));
        out.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    out
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;

    /// In-memory vault; records every path read so tests can prove `data.json` is untouched.
    #[derive(Default)]
    struct MemorySource {
        files: BTreeMap<String, Vec<u8>>,
        symlinks: BTreeSet<String>,
        reads: RefCell<Vec<String>>,
    }

    impl MemorySource {
        fn file(mut self, path: &str, bytes: &[u8]) -> Self {
            self.files.insert(path.to_owned(), bytes.to_vec());
            self
        }

        fn symlink(mut self, path: &str) -> Self {
            self.symlinks.insert(path.to_owned());
            self
        }

        fn plugin(self, id: &str, version: &str, main: &[u8]) -> Self {
            let manifest = format!(
                r#"{{"id":"{id}","name":"{id}","version":"{version}","minAppVersion":"1.0.0"}}"#
            );
            self.file(
                &format!("{PLUGINS_DIR}/{id}/manifest.json"),
                manifest.as_bytes(),
            )
            .file(&format!("{PLUGINS_DIR}/{id}/main.js"), main)
        }
    }

    impl VaultFileSource for MemorySource {
        fn list_dir(&self, path: &str) -> Result<Vec<SourceEntry>, SourceError> {
            let prefix = format!("{path}/");
            let mut children: BTreeMap<String, SourceEntry> = BTreeMap::new();
            let all = self
                .files
                .iter()
                .map(|(p, b)| (p, EntryKind::File, b.len() as u64))
                .chain(self.symlinks.iter().map(|p| (p, EntryKind::Symlink, 0)));
            for (full, kind, size) in all {
                let Some(rest) = full.strip_prefix(&prefix) else {
                    continue;
                };
                let (name, nested) = match rest.split_once('/') {
                    Some((head, _)) => (head, true),
                    None => (rest, false),
                };
                let entry = if nested {
                    SourceEntry {
                        name: name.into(),
                        kind: EntryKind::Directory,
                        size: 0,
                    }
                } else {
                    SourceEntry {
                        name: name.into(),
                        kind,
                        size,
                    }
                };
                children.entry(name.to_owned()).or_insert(entry);
            }
            if children.is_empty() {
                Err(SourceError::NotFound)
            } else {
                Ok(children.into_values().collect())
            }
        }

        fn read_file(&self, path: &str, max_bytes: u64) -> Result<Vec<u8>, SourceError> {
            self.reads.borrow_mut().push(path.to_owned());
            let bytes = self.files.get(path).ok_or(SourceError::NotFound)?;
            if bytes.len() as u64 > max_bytes {
                return Err(SourceError::TooLarge);
            }
            Ok(bytes.clone())
        }
    }

    fn pin_json(tag: &str, main_hash: &str, main_bytes: u64, styles: Option<&str>) -> String {
        let styles_asset = styles
            .map(|hash| format!(r#",{{"name":"styles.css","bytes":1,"sha256":"{hash}"}}"#))
            .unwrap_or_default();
        format!(
            r#"{{"artifacts":[{{"id":"PC99","registry_id":"alpha","name":"Alpha","tag":"{tag}",
            "release_assets":[{{"name":"main.js","bytes":{main_bytes},"sha256":"{main_hash}"}},
            {{"name":"manifest.json","bytes":9,"sha256":"{main_hash}","manifest":{{"id":"alpha"}}}}{styles_asset}]}}]}}"#
        )
    }

    fn pins_for(main: &[u8], tag: &str, styles: Option<&[u8]>) -> PinnedArtifacts {
        let styles_hash = styles.map(sha256_hex);
        PinnedArtifacts::from_manifest_json(&pin_json(
            tag,
            &sha256_hex(main),
            main.len() as u64,
            styles_hash.as_deref(),
        ))
        .expect("pins")
    }

    fn run(source: &MemorySource, pins: &PinnedArtifacts) -> DiscoveryReport {
        discover_plugins(source, &DiscoveryLimits::default(), pins)
    }

    #[test]
    fn sha256_hex_matches_known_vector() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn bundled_fixture_pins_all_artifacts() {
        let pins = PinnedArtifacts::bundled().expect("bundled fixture");
        assert_eq!(pins.len(), 27);
        assert!(!pins.is_empty());
        let calendar = pins.get("calendar").expect("calendar");
        assert_eq!(calendar.version, "1.5.10");
        assert!(calendar.main_js.is_some());
        assert!(calendar.styles_sha256.is_none());
        let minimal = pins.get("Minimal").expect("minimal theme");
        assert!(minimal.main_js.is_none());
        assert!(minimal.theme_css_sha256.is_some());
        assert!(pins.get("text-extractor").is_some());
        assert!(pins.get("obsidian-excalidraw-plugin").is_some());
    }

    #[test]
    fn pin_table_rejects_development_refs_and_bad_data() {
        let hash = "a".repeat(64);
        for tag in ["main", "Master", "latest", "HEAD", "dev", "release"] {
            assert!(
                PinnedArtifacts::from_manifest_json(&pin_json(tag, &hash, 1, None)).is_err(),
                "{tag}"
            );
        }
        assert!(PinnedArtifacts::from_manifest_json(&pin_json("1.0.0", &hash, 1, None)).is_ok());
        assert!(PinnedArtifacts::from_manifest_json(&pin_json("1.0.0", "ABC", 1, None)).is_err());
        assert!(PinnedArtifacts::from_manifest_json("{}").is_err());
        assert!(PinnedArtifacts::from_manifest_json("nope").is_err());
        let duplicate = format!(
            r#"{{"artifacts":[{a},{a}]}}"#,
            a = r#"{"id":"P","registry_id":"x","name":"X","tag":"1.0","release_assets":[]}"#
        );
        let error = PinnedArtifacts::from_manifest_json(&duplicate).expect_err("duplicate");
        assert!(error.to_string().contains("duplicate"));
    }

    #[test]
    fn compare_covers_every_status() {
        let main = b"console.log(1)";
        let styles = b"body{}";
        let pins = pins_for(main, "1.2.3", Some(styles));
        let identity = ArtifactIdentity {
            id: "alpha".into(),
            version: "1.2.3".into(),
            main_js_sha256: sha256_hex(main),
            size: main.len() as u64,
            styles_sha256: Some(sha256_hex(styles)),
        };
        assert_eq!(pins.compare(&identity), PinStatus::MatchesPinned);

        let mut other = identity.clone();
        other.id = "beta".into();
        assert_eq!(pins.compare(&other), PinStatus::Unpinned);

        let mut other = identity.clone();
        other.version = "1.2.4".into();
        assert_eq!(pins.compare(&other), PinStatus::DifferentVersion);

        let mut other = identity.clone();
        other.main_js_sha256 = sha256_hex(b"tampered");
        assert_eq!(pins.compare(&other), PinStatus::HashMismatch);

        let mut other = identity.clone();
        other.size += 1;
        assert_eq!(pins.compare(&other), PinStatus::HashMismatch);

        let mut other = identity.clone();
        other.styles_sha256 = None;
        assert_eq!(pins.compare(&other), PinStatus::HashMismatch);

        let mut other = identity;
        other.styles_sha256 = Some(sha256_hex(b"x"));
        assert_eq!(pins.compare(&other), PinStatus::HashMismatch);
    }

    #[test]
    fn extra_local_styles_when_pin_has_none_is_a_mismatch() {
        let main = b"m";
        let pins = pins_for(main, "1.0.0", None);
        let identity = ArtifactIdentity {
            id: "alpha".into(),
            version: "1.0.0".into(),
            main_js_sha256: sha256_hex(main),
            size: 1,
            styles_sha256: Some(sha256_hex(b"s")),
        };
        assert_eq!(pins.compare(&identity), PinStatus::HashMismatch);
    }

    #[test]
    fn empty_vault_yields_empty_report() {
        let report = run(&MemorySource::default(), &PinnedArtifacts::default());
        assert!(report.plugins.is_empty());
        assert!(report.issues.is_empty());
        assert_eq!(report.omitted_plugins, 0);
    }

    #[test]
    fn matching_plugin_is_reported_with_identity() {
        let main = b"main";
        let source = MemorySource::default()
            .plugin("alpha", "1.2.3", main)
            .file(".obsidian/plugins/alpha/styles.css", b"body{}")
            .file(COMMUNITY_PLUGINS_FILE, br#"["alpha","ghost"]"#);
        let pins = pins_for(main, "1.2.3", Some(b"body{}"));
        let report = run(&source, &pins);
        assert_eq!(report.plugins.len(), 1);
        let plugin = &report.plugins[0];
        assert_eq!(plugin.pin_status, Some(PinStatus::MatchesPinned));
        assert!(plugin.has_styles);
        assert!(plugin.enabled_in_config);
        assert_eq!(plugin.identity.as_ref().expect("identity").size, 4);
        assert_eq!(report.enabled_ids, ["alpha", "ghost"]);
        assert_eq!(report.enabled_without_plugin, ["ghost"]);
        assert_eq!(report.all_issues().count(), 0);
    }

    #[test]
    fn tampered_main_js_is_a_hash_mismatch() {
        let source = MemorySource::default().plugin("alpha", "1.2.3", b"evil");
        let report = run(&source, &pins_for(b"good", "1.2.3", None));
        assert_eq!(report.plugins[0].pin_status, Some(PinStatus::HashMismatch));
    }

    #[test]
    fn different_version_and_unpinned_plugins() {
        let source = MemorySource::default()
            .plugin("alpha", "9.9.9", b"main")
            .plugin("zeta", "1.0.0", b"main");
        let report = run(&source, &pins_for(b"main", "1.2.3", None));
        assert_eq!(
            report.plugins[0].pin_status,
            Some(PinStatus::DifferentVersion)
        );
        assert_eq!(report.plugins[1].pin_status, Some(PinStatus::Unpinned));
    }

    #[test]
    fn data_json_contents_are_never_read() {
        let source = MemorySource::default()
            .plugin("alpha", "1.0.0", b"main")
            .file(
                ".obsidian/plugins/alpha/data.json",
                b"{\"token\":\"secret\"}",
            );
        let report = run(&source, &PinnedArtifacts::default());
        let plugin = &report.plugins[0];
        assert!(plugin.has_data);
        assert_eq!(plugin.data_size, Some(18));
        assert!(
            source
                .reads
                .borrow()
                .iter()
                .all(|path| !path.ends_with("data.json"))
        );
    }

    #[test]
    fn symlinked_plugin_directory_is_skipped_and_reported() {
        let source = MemorySource::default()
            .plugin("alpha", "1.0.0", b"main")
            .symlink(".obsidian/plugins/linked");
        let report = run(&source, &PinnedArtifacts::default());
        assert_eq!(report.plugins.len(), 2);
        let linked = &report.plugins[1];
        assert_eq!(linked.dir_name, "linked");
        assert!(linked.manifest.is_none());
        assert_eq!(linked.issues[0].kind, DiscoveryIssueKind::SymlinkSkipped);
        assert!(source.reads.borrow().iter().all(|p| !p.contains("linked")));
    }

    #[test]
    fn symlinked_artifact_file_is_not_read() {
        let source = MemorySource::default()
            .file(
                ".obsidian/plugins/alpha/manifest.json",
                br#"{"id":"alpha","name":"A","version":"1"}"#,
            )
            .symlink(".obsidian/plugins/alpha/main.js");
        let report = run(&source, &PinnedArtifacts::default());
        let plugin = &report.plugins[0];
        assert!(plugin.identity.is_none());
        assert!(plugin.pin_status.is_none());
        assert!(
            plugin
                .issues
                .iter()
                .any(|issue| issue.kind == DiscoveryIssueKind::SymlinkSkipped)
        );
        assert!(
            source
                .reads
                .borrow()
                .iter()
                .all(|p| !p.ends_with("main.js"))
        );
    }

    #[test]
    fn missing_files_are_reported() {
        let source = MemorySource::default()
            .file(".obsidian/plugins/nomani/main.js", b"x")
            .file(
                ".obsidian/plugins/nomain/manifest.json",
                br#"{"id":"nomain","name":"N","version":"1"}"#,
            );
        let report = run(&source, &PinnedArtifacts::default());
        let nomain = &report.plugins[0];
        assert!(
            nomain
                .issues
                .iter()
                .any(|i| i.kind == DiscoveryIssueKind::MainJsMissing)
        );
        assert!(nomain.manifest.is_some());
        let nomani = &report.plugins[1];
        assert!(
            nomani
                .issues
                .iter()
                .any(|i| i.kind == DiscoveryIssueKind::ManifestMissing)
        );
        assert!(nomani.identity.is_none());
    }

    #[test]
    fn malformed_manifest_is_a_visible_issue() {
        let source = MemorySource::default()
            .file(".obsidian/plugins/bad/manifest.json", b"{ not json")
            .file(".obsidian/plugins/bad/main.js", b"x");
        let report = run(&source, &PinnedArtifacts::default());
        let plugin = &report.plugins[0];
        assert!(plugin.manifest.is_none());
        assert!(plugin.identity.is_none());
        assert_eq!(plugin.issues.len(), 1);
        assert_eq!(plugin.issues[0].kind, DiscoveryIssueKind::ManifestInvalid);
    }

    #[test]
    fn id_mismatch_is_reported_and_manifest_id_is_used_for_pins() {
        let source = MemorySource::default()
            .file(
                ".obsidian/plugins/folder/manifest.json",
                br#"{"id":"alpha","name":"A","version":"1.2.3"}"#,
            )
            .file(".obsidian/plugins/folder/main.js", b"main");
        let report = run(&source, &pins_for(b"main", "1.2.3", None));
        let plugin = &report.plugins[0];
        assert_eq!(plugin.pin_status, Some(PinStatus::MatchesPinned));
        assert!(
            plugin
                .issues
                .iter()
                .any(|i| i.kind == DiscoveryIssueKind::IdMismatch)
        );
    }

    #[test]
    fn oversized_files_are_not_read() {
        let source = MemorySource::default()
            .plugin("alpha", "1.0.0", &[0u8; 64])
            .file(".obsidian/plugins/huge/manifest.json", &[b' '; 200]);
        let limits = DiscoveryLimits {
            max_file_bytes: 100,
            ..DiscoveryLimits::default()
        };
        let report = discover_plugins(&source, &limits, &PinnedArtifacts::default());
        let huge = report
            .plugins
            .iter()
            .find(|p| p.dir_name == "huge")
            .expect("huge");
        assert!(
            huge.issues
                .iter()
                .any(|i| i.kind == DiscoveryIssueKind::FileTooLarge)
        );
        assert!(
            source
                .reads
                .borrow()
                .iter()
                .all(|path| !path.contains("huge"))
        );
        let alpha = report
            .plugins
            .iter()
            .find(|p| p.dir_name == "alpha")
            .expect("alpha");
        assert!(alpha.identity.is_some());
    }

    #[test]
    fn plugin_count_cap_reports_omissions_deterministically() {
        let mut source = MemorySource::default();
        for id in ["c", "a", "d", "b"] {
            source = source.plugin(id, "1.0.0", b"m");
        }
        let limits = DiscoveryLimits {
            max_plugins: 2,
            ..DiscoveryLimits::default()
        };
        let report = discover_plugins(&source, &limits, &PinnedArtifacts::default());
        let names: Vec<_> = report.plugins.iter().map(|p| p.dir_name.as_str()).collect();
        assert_eq!(names, ["a", "b"]);
        assert_eq!(report.omitted_plugins, 2);
        assert!(
            report
                .issues
                .iter()
                .any(|i| i.kind == DiscoveryIssueKind::PluginLimitExceeded)
        );
    }

    #[test]
    fn case_variant_duplicate_ids_are_flagged() {
        let source = MemorySource::default()
            .plugin("Alpha", "1.0.0", b"m")
            .plugin("alpha", "1.0.0", b"m");
        let report = run(&source, &PinnedArtifacts::default());
        let flagged = report
            .plugins
            .iter()
            .filter(|p| {
                p.issues
                    .iter()
                    .any(|i| i.kind == DiscoveryIssueKind::DuplicateId)
            })
            .count();
        assert_eq!(flagged, 1);
    }

    #[test]
    fn invalid_community_list_is_reported() {
        for content in [&b"{}"[..], b"[1,2]", b"nope"] {
            let source = MemorySource::default()
                .plugin("alpha", "1.0.0", b"m")
                .file(COMMUNITY_PLUGINS_FILE, content);
            let report = run(&source, &PinnedArtifacts::default());
            assert!(report.enabled_ids.is_empty());
            assert!(
                report
                    .issues
                    .iter()
                    .any(|i| i.kind == DiscoveryIssueKind::CommunityListInvalid)
            );
            assert!(!report.plugins[0].enabled_in_config);
        }
    }

    #[test]
    fn community_list_with_bom_is_accepted() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(br#"["alpha"]"#);
        let source = MemorySource::default()
            .plugin("alpha", "1.0.0", b"m")
            .file(COMMUNITY_PLUGINS_FILE, &bytes);
        let report = run(&source, &PinnedArtifacts::default());
        assert!(report.plugins[0].enabled_in_config);
        assert!(report.issues.is_empty());
    }

    #[test]
    fn discovery_is_deterministic() {
        let source = MemorySource::default()
            .plugin("b", "1.0.0", b"m")
            .plugin("a", "1.0.0", b"m");
        let pins = PinnedArtifacts::default();
        assert_eq!(run(&source, &pins), run(&source, &pins));
    }

    #[test]
    fn source_error_display_is_descriptive() {
        assert_eq!(SourceError::NotFound.to_string(), "not found");
        assert!(SourceError::TooLarge.to_string().contains("limit"));
        assert_eq!(SourceError::Io("boom".into()).to_string(), "boom");
    }
}
