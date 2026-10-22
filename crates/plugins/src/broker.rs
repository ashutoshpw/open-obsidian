//! Pure capability broker policy for plugin runtimes.
//!
//! Every decision is computed from in-memory grants and lexical path checks. There
//! is no I/O here: the engine supplies the executor that applies approved changes
//! through its revision-checked writer. Path checks are lexical, so the executor
//! must still refuse to follow symlinks that leave the vault.

use std::collections::{BTreeMap, BTreeSet};

use crate::{ConfigurationWriteRequest, D15Record, deny_configuration_write};

const CONFIG_DIR: &str = ".obsidian";
const SHA256_HEX_LEN: usize = 64;

const PROCESS_CAPABILITY: &str = "process.spawn";
const CREDENTIAL_CAPABILITY: &str = "credential.read";

/// Denial test id for the process denial.
pub const TEST_ID_PROCESS: &str = "plugins::broker::tests::process_is_always_denied_with_d15";
/// Denial test id for the credential denial.
pub const TEST_ID_CREDENTIAL: &str = "plugins::broker::tests::credential_is_always_denied_with_d15";
/// Denial test id for configuration writes.
pub const TEST_ID_CONFIGURATION_WRITE: &str =
    "plugins::broker::tests::configuration_write_capability_uses_existing_policy";

const PROCESS_ALTERNATIVES: &[&str] = &["mediated vault read", "workflow disabled"];
const CREDENTIAL_ALTERNATIVES: &[&str] = &["user-entered value at use time", "workflow disabled"];

/// Reference to a specific plugin artifact. Grants are bound to both fields.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct PluginRef {
    /// Stable plugin identifier.
    pub id: String,
    /// Hex SHA-256 of the verified plugin artifact (case-insensitive).
    pub artifact_sha256: String,
}

impl PluginRef {
    /// Creates a plugin reference.
    pub fn new(id: impl Into<String>, artifact_sha256: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            artifact_sha256: artifact_sha256.into(),
        }
    }

    fn key(&self) -> Option<(String, String)> {
        let id_ok = !self.id.is_empty() && !self.id.chars().any(char::is_control);
        if id_ok && is_sha256_hex(&self.artifact_sha256) {
            Some((self.id.clone(), self.artifact_sha256.to_ascii_lowercase()))
        } else {
            None
        }
    }
}

/// A capability a plugin may ask for.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum Capability {
    /// Read vault paths under a vault-relative scope (empty string is the whole vault).
    VaultRead(String),
    /// Stage writes under a vault-relative scope. Never allowed directly.
    VaultWrite(String),
    /// Network access to one exact origin such as `https://example.com`.
    Network(String),
    /// Process spawning. Always denied.
    Process,
    /// Credential access. Always denied.
    Credential,
    /// Clipboard access.
    Clipboard,
    /// Shared plugin configuration writes. Always denied.
    ConfigurationWrite,
    /// A named workspace UI surface.
    Workspace(String),
}

/// Why a path or scope was rejected.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PathError {
    /// The path was empty.
    Empty,
    /// The path was absolute, a drive path or a UNC path.
    Absolute,
    /// The path contained a `..` component.
    Traversal,
    /// The path contained a control character, `:` or a trailing dot or space.
    InvalidCharacter,
}

/// Normalizes a vault-relative path. The result is non-empty and `/`-separated.
pub fn normalize_vault_path(raw: &str) -> Result<String, PathError> {
    let normalized = normalize_segments(raw)?;
    if normalized.is_empty() {
        Err(PathError::Empty)
    } else {
        Ok(normalized)
    }
}

/// Normalizes a scope. An empty result means the whole vault.
pub fn normalize_scope(raw: &str) -> Result<String, PathError> {
    normalize_segments(raw)
}

fn normalize_segments(raw: &str) -> Result<String, PathError> {
    if raw.chars().any(char::is_control) {
        return Err(PathError::InvalidCharacter);
    }
    let unified = raw.replace('\\', "/");
    if unified.starts_with('/') {
        return Err(PathError::Absolute);
    }
    let mut chars = unified.chars();
    if let (Some(first), Some(':')) = (chars.next(), chars.next())
        && first.is_ascii_alphabetic()
    {
        return Err(PathError::Absolute);
    }
    let mut segments: Vec<&str> = Vec::new();
    for segment in unified.split('/') {
        match segment {
            "" | "." => {}
            ".." => return Err(PathError::Traversal),
            other => {
                if other.contains(':') || other.ends_with('.') || other.ends_with(' ') {
                    return Err(PathError::InvalidCharacter);
                }
                segments.push(other);
            }
        }
    }
    Ok(segments.join("/"))
}

/// Returns true when any segment is the `.obsidian` configuration directory.
pub fn is_configuration_path(normalized: &str) -> bool {
    normalized
        .split('/')
        .any(|segment| segment.eq_ignore_ascii_case(CONFIG_DIR))
}

fn scope_contains(scope: &str, path: &str) -> bool {
    scope.is_empty()
        || path == scope
        || path
            .strip_prefix(scope)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// Normalizes an origin to `scheme://host[:port]` in lowercase. Only `http` and
/// `https` are accepted; paths, queries, userinfo and wildcards are rejected.
pub fn normalize_origin(raw: &str) -> Option<String> {
    let lower = raw.to_ascii_lowercase();
    let (scheme, rest) = lower.split_once("://")?;
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let (host, port) = match rest.split_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (rest, None),
    };
    let host_ok = !host.is_empty()
        && !host.starts_with(['.', '-'])
        && !host.ends_with(['.', '-'])
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    let port_ok =
        port.is_none_or(|p| !p.is_empty() && p.len() <= 5 && p.chars().all(|c| c.is_ascii_digit()));
    if host_ok && port_ok {
        Some(lower)
    } else {
        None
    }
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == SHA256_HEX_LEN && value.chars().all(|c| c.is_ascii_hexdigit())
}

/// Why a grant was refused.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GrantError {
    /// The plugin id or artifact hash is malformed.
    InvalidPluginRef,
    /// The scope path is invalid.
    InvalidScope(PathError),
    /// A write scope may not include the configuration directory.
    ConfigurationScope,
    /// The origin is not a plain http(s) origin.
    InvalidOrigin,
    /// The workspace surface name is empty.
    InvalidWorkspace,
    /// Process, credential and configuration-write capabilities cannot be granted.
    NeverGrantable,
}

fn canonicalize(capability: &Capability) -> Result<Capability, GrantError> {
    match capability {
        Capability::VaultRead(scope) => normalize_scope(scope)
            .map(Capability::VaultRead)
            .map_err(GrantError::InvalidScope),
        Capability::VaultWrite(scope) => {
            let scope = normalize_scope(scope).map_err(GrantError::InvalidScope)?;
            if is_configuration_path(&scope) {
                Err(GrantError::ConfigurationScope)
            } else {
                Ok(Capability::VaultWrite(scope))
            }
        }
        Capability::Network(origin) => normalize_origin(origin)
            .map(Capability::Network)
            .ok_or(GrantError::InvalidOrigin),
        Capability::Clipboard => Ok(Capability::Clipboard),
        Capability::Workspace(ui) => {
            let ui = ui.trim();
            if ui.is_empty() {
                Err(GrantError::InvalidWorkspace)
            } else {
                Ok(Capability::Workspace(ui.to_owned()))
            }
        }
        Capability::Process | Capability::Credential | Capability::ConfigurationWrite => {
            Err(GrantError::NeverGrantable)
        }
    }
}

/// In-memory grants keyed by plugin id and artifact hash.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct GrantStore {
    grants: BTreeMap<(String, String), BTreeSet<Capability>>,
}

impl GrantStore {
    /// Creates an empty store.
    pub fn new() -> Self {
        Self::default()
    }

    /// Grants a capability to this exact plugin artifact.
    pub fn grant(&mut self, plugin: &PluginRef, capability: Capability) -> Result<(), GrantError> {
        let key = plugin.key().ok_or(GrantError::InvalidPluginRef)?;
        let capability = canonicalize(&capability)?;
        self.grants.entry(key).or_default().insert(capability);
        Ok(())
    }

    /// Revokes one grant. Returns whether a grant was removed.
    pub fn revoke(&mut self, plugin: &PluginRef, capability: &Capability) -> bool {
        let (Some(key), Ok(capability)) = (plugin.key(), canonicalize(capability)) else {
            return false;
        };
        let Some(set) = self.grants.get_mut(&key) else {
            return false;
        };
        let removed = set.remove(&capability);
        if set.is_empty() {
            self.grants.remove(&key);
        }
        removed
    }

    /// Revokes every grant held by this exact plugin artifact; returns the count.
    pub fn revoke_all(&mut self, plugin: &PluginRef) -> usize {
        plugin
            .key()
            .and_then(|key| self.grants.remove(&key))
            .map_or(0, |set| set.len())
    }

    /// Lists grants held by the current artifact of this plugin.
    pub fn list(&self, plugin: &PluginRef) -> Vec<Capability> {
        plugin
            .key()
            .and_then(|key| self.grants.get(&key))
            .map(|set| set.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Lists grants for a plugin id across all artifact hashes, as `(hash, capability)`.
    /// Entries under other hashes are stale and inert until pruned.
    pub fn list_for_plugin_id(&self, id: &str) -> Vec<(String, Capability)> {
        let mut out = Vec::new();
        for ((plugin_id, hash), set) in &self.grants {
            if plugin_id == id {
                out.extend(set.iter().map(|c| (hash.clone(), c.clone())));
            }
        }
        out
    }

    /// Removes grants held under any other artifact hash for this plugin id.
    pub fn prune_stale(&mut self, plugin: &PluginRef) -> usize {
        let Some(current) = plugin.key() else {
            return 0;
        };
        let mut removed = 0;
        self.grants.retain(|key, set| {
            let stale = key.0 == current.0 && key.1 != current.1;
            if stale {
                removed += set.len();
            }
            !stale
        });
        removed
    }

    fn holds(&self, plugin: &PluginRef, predicate: impl Fn(&Capability) -> bool) -> bool {
        plugin
            .key()
            .and_then(|key| self.grants.get(&key))
            .is_some_and(|set| set.iter().any(predicate))
    }
}

/// Why a D15 record could not be built.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum D15BuildError {
    /// The plugin id was empty.
    MissingPluginId,
    /// The capability name was empty.
    MissingCapability,
    /// The reproduction was missing or blank.
    MissingReproduction,
    /// No safe alternatives were recorded.
    MissingSafeAlternatives,
    /// No denial test id was supplied.
    MissingDenialTestId,
}

/// A D15 record together with the test that proves the denial.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct D15Denial {
    /// The visible D15 record.
    pub record: D15Record,
    /// Identifier of the test that reproduces this denial.
    pub denial_test_id: String,
}

impl D15Denial {
    /// Validates an existing record and attaches its denial test id.
    pub fn new(record: D15Record, denial_test_id: &str) -> Result<Self, D15BuildError> {
        if record.plugin_id.is_empty() {
            return Err(D15BuildError::MissingPluginId);
        }
        if record.capability.is_empty() {
            return Err(D15BuildError::MissingCapability);
        }
        if record.reproduction.trim().is_empty() {
            return Err(D15BuildError::MissingReproduction);
        }
        if record.safe_alternatives_attempted.is_empty() {
            return Err(D15BuildError::MissingSafeAlternatives);
        }
        if denial_test_id.trim().is_empty() {
            return Err(D15BuildError::MissingDenialTestId);
        }
        Ok(Self {
            record,
            denial_test_id: denial_test_id.to_owned(),
        })
    }
}

/// Builder that refuses to produce a D15 record without all required evidence.
#[derive(Clone, Debug, Default)]
pub struct D15Builder {
    plugin_id: String,
    capability: &'static str,
    reproduction: String,
    safe_alternatives: &'static [&'static str],
    denial_test_id: String,
}

impl D15Builder {
    /// Starts a builder for a plugin and capability name.
    pub fn new(plugin_id: &str, capability: &'static str) -> Self {
        Self {
            plugin_id: plugin_id.to_owned(),
            capability,
            ..Self::default()
        }
    }

    /// Sets the reproduction detail.
    pub fn reproduction(mut self, reproduction: &str) -> Self {
        self.reproduction = reproduction.to_owned();
        self
    }

    /// Sets the safe alternatives that were attempted.
    pub fn safe_alternatives(mut self, alternatives: &'static [&'static str]) -> Self {
        self.safe_alternatives = alternatives;
        self
    }

    /// Sets the denial test id.
    pub fn denial_test_id(mut self, id: &str) -> Self {
        self.denial_test_id = id.to_owned();
        self
    }

    /// Builds the record, or reports the first missing required field.
    pub fn build(self) -> Result<D15Denial, D15BuildError> {
        let record = D15Record {
            id: format!("D15:{}:{}", self.plugin_id, self.capability),
            plugin_id: self.plugin_id,
            capability: self.capability,
            status: "unsupported_security",
            visible: true,
            reproduction: self.reproduction,
            safe_alternatives_attempted: self.safe_alternatives,
            scope: "plugin-runtime",
        };
        D15Denial::new(record, &self.denial_test_id)
    }
}

/// Reason a request was denied.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DenialReason {
    /// No matching grant exists (default deny).
    NotGranted,
    /// The plugin id or artifact hash is malformed.
    InvalidPluginRef,
    /// The requested path or scope is invalid.
    InvalidPath(PathError),
    /// The requested path is inside the configuration directory.
    ConfigurationPath,
    /// The origin is not a plain http(s) origin.
    InvalidOrigin,
    /// Process spawning is never allowed.
    Process,
    /// Credential access is never allowed.
    Credential,
    /// Shared configuration writes are never allowed.
    ConfigurationWrite,
    /// Writes must go through `request_write` with a full intent.
    WriteRequiresIntent,
    /// The write intent was malformed.
    InvalidWrite(WriteError),
    /// A D15 record could not be built; the request is denied regardless.
    RecordUnavailable(D15BuildError),
}

/// A denial with an optional D15 record.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Denial {
    /// Why the request was denied.
    pub reason: DenialReason,
    /// D15 evidence for unsupported security capabilities.
    pub d15: Option<D15Denial>,
}

impl Denial {
    fn plain(reason: DenialReason) -> Decision {
        Decision::Deny(Box::new(Self { reason, d15: None }))
    }

    fn with_d15(reason: DenialReason, built: Result<D15Denial, D15BuildError>) -> Decision {
        match built {
            Ok(d15) => Decision::Deny(Box::new(Self {
                reason,
                d15: Some(d15),
            })),
            Err(error) => Self::plain(DenialReason::RecordUnavailable(error)),
        }
    }
}

/// Kind of staged vault change.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ChangeKind {
    /// Replace an existing file; requires an expected revision.
    Replace,
    /// Create a new file; must not carry an expected revision.
    Create,
    /// Move a file to the trash; requires an expected revision.
    Trash,
}

/// Digest and length of the proposed bytes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentDigest {
    /// Hex SHA-256 of the proposed bytes.
    pub sha256: String,
    /// Length of the proposed bytes.
    pub len: u64,
}

/// A plugin's write request, before policy.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WriteIntent<'a> {
    /// Vault-relative target path.
    pub path: &'a str,
    /// What the plugin wants to do.
    pub kind: ChangeKind,
    /// Hex SHA-256 of the revision the plugin last saw (not for `Create`).
    pub expected_revision_sha256: Option<&'a str>,
    /// Hex SHA-256 and length of the new bytes (required for `Replace` and `Create`).
    pub content: Option<(&'a str, u64)>,
}

/// Why a write intent was malformed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WriteError {
    /// `Replace` and `Trash` need an expected revision.
    MissingExpectedRevision,
    /// `Create` must not name an expected revision.
    UnexpectedRevision,
    /// A revision or content digest was not 64 hex characters.
    InvalidDigest,
    /// `Replace` and `Create` need a content digest.
    MissingContent,
    /// `Trash` must not carry content.
    UnexpectedContent,
}

/// A staged change that needs user approval before the engine applies it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposedChange {
    /// Requesting plugin artifact.
    pub plugin: PluginRef,
    /// Normalized vault-relative path.
    pub path: String,
    /// Lowercase hex revision the change was based on; `None` for `Create`.
    pub expected_revision_sha256: Option<String>,
    /// Change kind.
    pub kind: ChangeKind,
    /// Digest and length of new bytes; `None` for `Trash`.
    pub content: Option<ContentDigest>,
}

/// Broker outcome.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Decision {
    /// The capability is granted and needs no further approval.
    Allow,
    /// The request is denied.
    Deny(Box<Denial>),
    /// The change is staged and needs explicit user approval.
    NeedsApproval(Box<ProposedChange>),
}

fn digest(value: &str) -> Result<String, WriteError> {
    if is_sha256_hex(value) {
        Ok(value.to_ascii_lowercase())
    } else {
        Err(WriteError::InvalidDigest)
    }
}

type ShapedWrite = (Option<String>, Option<ContentDigest>);

fn shape_write(intent: &WriteIntent<'_>) -> Result<ShapedWrite, WriteError> {
    let revision = intent.expected_revision_sha256.map(digest).transpose()?;
    let content = intent
        .content
        .map(|(sha, len)| digest(sha).map(|sha256| ContentDigest { sha256, len }))
        .transpose()?;
    match intent.kind {
        ChangeKind::Create => {
            if revision.is_some() {
                return Err(WriteError::UnexpectedRevision);
            }
            if content.is_none() {
                return Err(WriteError::MissingContent);
            }
        }
        ChangeKind::Replace => {
            if revision.is_none() {
                return Err(WriteError::MissingExpectedRevision);
            }
            if content.is_none() {
                return Err(WriteError::MissingContent);
            }
        }
        ChangeKind::Trash => {
            if revision.is_none() {
                return Err(WriteError::MissingExpectedRevision);
            }
            if content.is_some() {
                return Err(WriteError::UnexpectedContent);
            }
        }
    }
    Ok((revision, content))
}

/// Default-deny capability broker.
#[derive(Clone, Debug, Default)]
pub struct CapabilityBroker {
    grants: GrantStore,
}

impl CapabilityBroker {
    /// Creates a broker with no grants.
    pub fn new() -> Self {
        Self::default()
    }

    /// Creates a broker over an existing grant store.
    pub fn with_grants(grants: GrantStore) -> Self {
        Self { grants }
    }

    /// Read access to the grant store.
    pub fn grants(&self) -> &GrantStore {
        &self.grants
    }

    /// Mutable access to the grant store.
    pub fn grants_mut(&mut self) -> &mut GrantStore {
        &mut self.grants
    }

    /// Decides a capability request. Writes never return `Allow`.
    pub fn request(&self, plugin: &PluginRef, capability: Capability) -> Decision {
        if plugin.key().is_none() {
            return Denial::plain(DenialReason::InvalidPluginRef);
        }
        match capability {
            Capability::Process => Denial::with_d15(
                DenialReason::Process,
                D15Builder::new(&plugin.id, PROCESS_CAPABILITY)
                    .reproduction(&format!("{PROCESS_CAPABILITY} requested"))
                    .safe_alternatives(PROCESS_ALTERNATIVES)
                    .denial_test_id(TEST_ID_PROCESS)
                    .build(),
            ),
            Capability::Credential => Denial::with_d15(
                DenialReason::Credential,
                D15Builder::new(&plugin.id, CREDENTIAL_CAPABILITY)
                    .reproduction(&format!("{CREDENTIAL_CAPABILITY} requested"))
                    .safe_alternatives(CREDENTIAL_ALTERNATIVES)
                    .denial_test_id(TEST_ID_CREDENTIAL)
                    .build(),
            ),
            Capability::ConfigurationWrite => Self::deny_configuration(plugin, None),
            Capability::VaultWrite(_) => Denial::plain(DenialReason::WriteRequiresIntent),
            Capability::VaultRead(path) => {
                let path = match normalize_scope(&path) {
                    Ok(path) => path,
                    Err(error) => return Denial::plain(DenialReason::InvalidPath(error)),
                };
                if is_configuration_path(&path) {
                    return Denial::plain(DenialReason::ConfigurationPath);
                }
                let granted = self.grants.holds(plugin, |cap| {
                    matches!(cap, Capability::VaultRead(scope) if scope_contains(scope, &path))
                });
                Self::allow_if(granted)
            }
            Capability::Network(origin) => {
                let Some(origin) = normalize_origin(&origin) else {
                    return Denial::plain(DenialReason::InvalidOrigin);
                };
                let granted = self.grants.holds(
                    plugin,
                    |cap| matches!(cap, Capability::Network(o) if *o == origin),
                );
                Self::allow_if(granted)
            }
            Capability::Clipboard => Self::allow_if(
                self.grants
                    .holds(plugin, |cap| *cap == Capability::Clipboard),
            ),
            Capability::Workspace(ui) => {
                let ui = ui.trim();
                let granted = self.grants.holds(
                    plugin,
                    |cap| matches!(cap, Capability::Workspace(g) if g == ui),
                );
                Self::allow_if(granted)
            }
        }
    }

    /// Decides a vault write. A granted, well-formed write becomes a
    /// [`ProposedChange`] that needs approval; it is never allowed directly.
    pub fn request_write(&self, plugin: &PluginRef, intent: WriteIntent<'_>) -> Decision {
        let Some((id, hash)) = plugin.key() else {
            return Denial::plain(DenialReason::InvalidPluginRef);
        };
        let path = match normalize_vault_path(intent.path) {
            Ok(path) => path,
            Err(error) => return Denial::plain(DenialReason::InvalidPath(error)),
        };
        if is_configuration_path(&path) {
            return Self::deny_configuration(plugin, Some(&path));
        }
        let granted = self.grants.holds(
            plugin,
            |cap| matches!(cap, Capability::VaultWrite(scope) if scope_contains(scope, &path)),
        );
        if !granted {
            return Denial::plain(DenialReason::NotGranted);
        }
        match shape_write(&intent) {
            Ok((expected_revision_sha256, content)) => {
                Decision::NeedsApproval(Box::new(ProposedChange {
                    plugin: PluginRef::new(id, hash),
                    path,
                    expected_revision_sha256,
                    kind: intent.kind,
                    content,
                }))
            }
            Err(error) => Denial::plain(DenialReason::InvalidWrite(error)),
        }
    }

    fn allow_if(granted: bool) -> Decision {
        if granted {
            Decision::Allow
        } else {
            Denial::plain(DenialReason::NotGranted)
        }
    }

    fn deny_configuration(plugin: &PluginRef, target: Option<&str>) -> Decision {
        let denial = deny_configuration_write(ConfigurationWriteRequest {
            plugin_id: &plugin.id,
            target,
            detail: None,
        });
        let reason = if target.is_some() {
            DenialReason::ConfigurationPath
        } else {
            DenialReason::ConfigurationWrite
        };
        Denial::with_d15(
            reason,
            D15Denial::new(denial.record, TEST_ID_CONFIGURATION_WRITE),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const HASH_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const REV: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    const NEW: &str = "2222222222222222222222222222222222222222222222222222222222222222";

    fn plugin(id: &str, hash: &str) -> PluginRef {
        PluginRef::new(id, hash)
    }

    fn denied(decision: Decision) -> Denial {
        match decision {
            Decision::Deny(denial) => *denial,
            other => panic!("expected deny, got {other:?}"),
        }
    }

    fn reason(decision: Decision) -> DenialReason {
        denied(decision).reason
    }

    fn replace(path: &str) -> WriteIntent<'_> {
        WriteIntent {
            path,
            kind: ChangeKind::Replace,
            expected_revision_sha256: Some(REV),
            content: Some((NEW, 12)),
        }
    }

    fn writer(scope: &str) -> (CapabilityBroker, PluginRef) {
        let p = plugin("writer", HASH_A);
        let mut broker = CapabilityBroker::new();
        broker
            .grants_mut()
            .grant(&p, Capability::VaultWrite(scope.to_owned()))
            .unwrap();
        (broker, p)
    }

    #[test]
    fn default_is_deny_for_every_capability() {
        let broker = CapabilityBroker::new();
        let p = plugin("a", HASH_A);
        for cap in [
            Capability::VaultRead("notes".into()),
            Capability::Network("https://example.com".into()),
            Capability::Clipboard,
            Capability::Workspace("ribbon".into()),
        ] {
            assert_eq!(reason(broker.request(&p, cap)), DenialReason::NotGranted);
        }
        assert_eq!(
            reason(broker.request_write(&p, replace("notes/a.md"))),
            DenialReason::NotGranted
        );
    }

    #[test]
    fn granted_capabilities_allow() {
        let mut broker = CapabilityBroker::new();
        let p = plugin("a", HASH_A);
        let grants = broker.grants_mut();
        grants
            .grant(&p, Capability::VaultRead("notes".into()))
            .unwrap();
        grants.grant(&p, Capability::Clipboard).unwrap();
        grants
            .grant(&p, Capability::Workspace("ribbon".into()))
            .unwrap();
        grants
            .grant(&p, Capability::Network("HTTPS://Example.com".into()))
            .unwrap();
        assert_eq!(
            broker.request(&p, Capability::VaultRead("notes/sub/a.md".into())),
            Decision::Allow
        );
        assert_eq!(broker.request(&p, Capability::Clipboard), Decision::Allow);
        assert_eq!(
            broker.request(&p, Capability::Workspace("ribbon".into())),
            Decision::Allow
        );
        assert_eq!(
            broker.request(&p, Capability::Network("https://example.com".into())),
            Decision::Allow
        );
    }

    #[test]
    fn read_scope_is_segment_bounded() {
        let mut broker = CapabilityBroker::new();
        let p = plugin("a", HASH_A);
        broker
            .grants_mut()
            .grant(&p, Capability::VaultRead("notes".into()))
            .unwrap();
        for path in ["notes2/a.md", "other/notes/a.md", ""] {
            assert_eq!(
                reason(broker.request(&p, Capability::VaultRead(path.into()))),
                DenialReason::NotGranted,
                "{path}"
            );
        }
    }

    #[test]
    fn plugins_are_isolated() {
        let mut broker = CapabilityBroker::new();
        let a = plugin("a", HASH_A);
        let b = plugin("b", HASH_A);
        broker
            .grants_mut()
            .grant(&a, Capability::Clipboard)
            .unwrap();
        assert_eq!(broker.request(&a, Capability::Clipboard), Decision::Allow);
        assert_eq!(
            reason(broker.request(&b, Capability::Clipboard)),
            DenialReason::NotGranted
        );
        assert!(broker.grants().list(&b).is_empty());
    }

    #[test]
    fn hash_change_loses_grants() {
        let mut broker = CapabilityBroker::new();
        let old = plugin("a", HASH_A);
        let new = plugin("a", HASH_B);
        broker
            .grants_mut()
            .grant(&old, Capability::Clipboard)
            .unwrap();
        broker
            .grants_mut()
            .grant(&old, Capability::VaultWrite("notes".into()))
            .unwrap();
        assert_eq!(
            reason(broker.request(&new, Capability::Clipboard)),
            DenialReason::NotGranted
        );
        assert_eq!(
            reason(broker.request_write(&new, replace("notes/a.md"))),
            DenialReason::NotGranted
        );
        assert_eq!(broker.grants().list_for_plugin_id("a").len(), 2);
        assert_eq!(broker.grants_mut().prune_stale(&new), 2);
        assert!(broker.grants().list_for_plugin_id("a").is_empty());
    }

    #[test]
    fn hash_case_is_not_a_bypass_or_a_split() {
        let mut broker = CapabilityBroker::new();
        let lower = plugin("a", HASH_A);
        let upper = plugin("a", &HASH_A.to_ascii_uppercase());
        broker
            .grants_mut()
            .grant(&lower, Capability::Clipboard)
            .unwrap();
        assert_eq!(
            broker.request(&upper, Capability::Clipboard),
            Decision::Allow
        );
    }

    #[test]
    fn revoke_and_list() {
        let mut store = GrantStore::new();
        let p = plugin("a", HASH_A);
        store.grant(&p, Capability::Clipboard).unwrap();
        store
            .grant(&p, Capability::VaultRead("./notes/".into()))
            .unwrap();
        assert_eq!(
            store.list(&p),
            vec![Capability::VaultRead("notes".into()), Capability::Clipboard]
        );
        assert!(store.revoke(&p, &Capability::VaultRead("notes".into())));
        assert!(!store.revoke(&p, &Capability::VaultRead("notes".into())));
        assert_eq!(store.revoke_all(&p), 1);
        assert!(store.list(&p).is_empty());
        assert_eq!(store, GrantStore::new());
    }

    #[test]
    fn revoked_grant_denies_again() {
        let mut broker = CapabilityBroker::new();
        let p = plugin("a", HASH_A);
        broker
            .grants_mut()
            .grant(&p, Capability::Clipboard)
            .unwrap();
        assert!(broker.grants_mut().revoke(&p, &Capability::Clipboard));
        assert_eq!(
            reason(broker.request(&p, Capability::Clipboard)),
            DenialReason::NotGranted
        );
    }

    #[test]
    fn malformed_plugin_refs_are_rejected() {
        let mut broker = CapabilityBroker::new();
        let long_bad = "g".repeat(64);
        for bad in [
            plugin("", HASH_A),
            plugin("a", "abc"),
            plugin("a", &long_bad),
        ] {
            assert_eq!(
                broker.grants_mut().grant(&bad, Capability::Clipboard),
                Err(GrantError::InvalidPluginRef)
            );
            assert_eq!(
                reason(broker.request(&bad, Capability::Clipboard)),
                DenialReason::InvalidPluginRef
            );
            assert_eq!(
                reason(broker.request_write(&bad, replace("a.md"))),
                DenialReason::InvalidPluginRef
            );
        }
    }

    #[test]
    fn never_grantable_capabilities() {
        let mut store = GrantStore::new();
        let p = plugin("a", HASH_A);
        for cap in [
            Capability::Process,
            Capability::Credential,
            Capability::ConfigurationWrite,
        ] {
            assert_eq!(store.grant(&p, cap), Err(GrantError::NeverGrantable));
        }
        assert_eq!(
            store.grant(&p, Capability::VaultWrite(".obsidian".into())),
            Err(GrantError::ConfigurationScope)
        );
        assert_eq!(
            store.grant(&p, Capability::VaultWrite("a/.OBSIDIAN/plugins".into())),
            Err(GrantError::ConfigurationScope)
        );
        assert_eq!(
            store.grant(&p, Capability::VaultRead("../x".into())),
            Err(GrantError::InvalidScope(PathError::Traversal))
        );
        assert_eq!(
            store.grant(&p, Capability::Workspace("  ".into())),
            Err(GrantError::InvalidWorkspace)
        );
        assert!(store.list(&p).is_empty());
    }

    #[test]
    fn process_is_always_denied_with_d15() {
        let mut broker = CapabilityBroker::new();
        let p = plugin("shell", HASH_A);
        broker
            .grants_mut()
            .grant(&p, Capability::Clipboard)
            .unwrap();
        let denial = denied(broker.request(&p, Capability::Process));
        assert_eq!(denial.reason, DenialReason::Process);
        let d15 = denial.d15.unwrap();
        assert_eq!(d15.denial_test_id, TEST_ID_PROCESS);
        assert_eq!(d15.record.capability, "process.spawn");
        assert_eq!(d15.record.plugin_id, "shell");
        assert!(d15.record.visible);
        assert!(!d15.record.reproduction.is_empty());
        assert!(!d15.record.safe_alternatives_attempted.is_empty());
    }

    #[test]
    fn credential_is_always_denied_with_d15() {
        let broker = CapabilityBroker::new();
        let denial = denied(broker.request(&plugin("a", HASH_A), Capability::Credential));
        assert_eq!(denial.reason, DenialReason::Credential);
        let d15 = denial.d15.unwrap();
        assert_eq!(d15.denial_test_id, TEST_ID_CREDENTIAL);
        assert_eq!(d15.record.capability, "credential.read");
    }

    #[test]
    fn configuration_write_capability_uses_existing_policy() {
        let broker = CapabilityBroker::new();
        let p = plugin("cfg", HASH_A);
        let denial = denied(broker.request(&p, Capability::ConfigurationWrite));
        assert_eq!(denial.reason, DenialReason::ConfigurationWrite);
        let expected = deny_configuration_write(ConfigurationWriteRequest {
            plugin_id: "cfg",
            target: None,
            detail: None,
        });
        let d15 = denial.d15.unwrap();
        assert_eq!(d15.record, expected.record);
        assert_eq!(d15.denial_test_id, TEST_ID_CONFIGURATION_WRITE);
    }

    #[test]
    fn network_only_for_granted_origins() {
        let mut broker = CapabilityBroker::new();
        let p = plugin("net", HASH_A);
        broker
            .grants_mut()
            .grant(&p, Capability::Network("https://api.example.com".into()))
            .unwrap();
        for origin in [
            "https://example.com",
            "http://api.example.com",
            "https://api.example.com:8443",
            "https://api.example.com.evil.test",
            "https://evil.test/https://api.example.com",
            "https://user@api.example.com",
            "https://*.example.com",
            "https://api.example.com/path",
        ] {
            let result = reason(broker.request(&p, Capability::Network(origin.into())));
            assert!(
                matches!(
                    result,
                    DenialReason::NotGranted | DenialReason::InvalidOrigin
                ),
                "{origin}: {result:?}"
            );
        }
        for origin in [
            "ftp://api.example.com",
            "file:///etc/passwd",
            "api.example.com",
            "",
        ] {
            assert_eq!(
                reason(broker.request(&p, Capability::Network(origin.into()))),
                DenialReason::InvalidOrigin,
                "{origin}"
            );
        }
        assert_eq!(
            broker
                .grants_mut()
                .grant(&p, Capability::Network("https://*.x.com".into())),
            Err(GrantError::InvalidOrigin)
        );
        let other = plugin("other", HASH_A);
        assert_eq!(
            reason(broker.request(
                &other,
                Capability::Network("https://api.example.com".into())
            )),
            DenialReason::NotGranted
        );
    }

    #[test]
    fn writes_never_allow_directly() {
        let (broker, p) = writer("notes");
        assert_eq!(
            reason(broker.request(&p, Capability::VaultWrite("notes/a.md".into()))),
            DenialReason::WriteRequiresIntent
        );
        match broker.request_write(&p, replace("notes/a.md")) {
            Decision::NeedsApproval(change) => {
                assert_eq!(change.path, "notes/a.md");
                assert_eq!(change.kind, ChangeKind::Replace);
                assert_eq!(change.expected_revision_sha256.as_deref(), Some(REV));
                assert_eq!(
                    change.content,
                    Some(ContentDigest {
                        sha256: NEW.into(),
                        len: 12
                    })
                );
                assert_eq!(change.plugin, p);
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn create_and_trash_shapes() {
        let (broker, p) = writer("");
        let create = WriteIntent {
            path: "new.md",
            kind: ChangeKind::Create,
            expected_revision_sha256: None,
            content: Some((NEW, 0)),
        };
        assert!(matches!(
            broker.request_write(&p, create),
            Decision::NeedsApproval(_)
        ));
        let trash = WriteIntent {
            path: "old.md",
            kind: ChangeKind::Trash,
            expected_revision_sha256: Some(REV),
            content: None,
        };
        match broker.request_write(&p, trash) {
            Decision::NeedsApproval(change) => {
                assert_eq!(change.kind, ChangeKind::Trash);
                assert!(change.content.is_none());
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn malformed_write_intents_are_denied() {
        let (broker, p) = writer("");
        let cases = [
            (
                WriteIntent {
                    expected_revision_sha256: None,
                    ..replace("a.md")
                },
                WriteError::MissingExpectedRevision,
            ),
            (
                WriteIntent {
                    content: None,
                    ..replace("a.md")
                },
                WriteError::MissingContent,
            ),
            (
                WriteIntent {
                    expected_revision_sha256: Some("zz"),
                    ..replace("a.md")
                },
                WriteError::InvalidDigest,
            ),
            (
                WriteIntent {
                    content: Some(("short", 1)),
                    ..replace("a.md")
                },
                WriteError::InvalidDigest,
            ),
            (
                WriteIntent {
                    kind: ChangeKind::Create,
                    ..replace("a.md")
                },
                WriteError::UnexpectedRevision,
            ),
            (
                WriteIntent {
                    kind: ChangeKind::Trash,
                    ..replace("a.md")
                },
                WriteError::UnexpectedContent,
            ),
            (
                WriteIntent {
                    kind: ChangeKind::Trash,
                    content: None,
                    expected_revision_sha256: None,
                    path: "a.md",
                },
                WriteError::MissingExpectedRevision,
            ),
        ];
        for (intent, error) in cases {
            assert_eq!(
                reason(broker.request_write(&p, intent)),
                DenialReason::InvalidWrite(error)
            );
        }
    }

    #[test]
    fn write_outside_scope_is_denied() {
        let (broker, p) = writer("notes");
        for path in ["other/a.md", "notes2/a.md", "a.md"] {
            assert_eq!(
                reason(broker.request_write(&p, replace(path))),
                DenialReason::NotGranted,
                "{path}"
            );
        }
    }

    #[test]
    fn traversal_and_absolute_paths_are_denied() {
        let (broker, p) = writer("notes");
        let cases = [
            ("notes/../../etc/passwd", PathError::Traversal),
            ("../secret.md", PathError::Traversal),
            ("notes/..\\..\\x", PathError::Traversal),
            ("/etc/passwd", PathError::Absolute),
            ("\\\\server\\share\\a", PathError::Absolute),
            ("C:\\Windows\\a", PathError::Absolute),
            ("c:/a", PathError::Absolute),
            ("notes/a.md:stream", PathError::InvalidCharacter),
            ("notes/a\0.md", PathError::InvalidCharacter),
            ("notes/..", PathError::Traversal),
            ("notes/.. /x", PathError::InvalidCharacter),
            ("notes/a.", PathError::InvalidCharacter),
            (".obsidian./app.json", PathError::InvalidCharacter),
            ("", PathError::Empty),
            (".", PathError::Empty),
            ("./", PathError::Empty),
        ];
        for (path, error) in cases {
            assert_eq!(
                reason(broker.request_write(&p, replace(path))),
                DenialReason::InvalidPath(error),
                "{path:?}"
            );
            assert!(matches!(
                broker.request(&p, Capability::VaultRead(path.into())),
                Decision::Deny(_)
            ));
        }
    }

    #[test]
    fn dotted_segments_normalize_inside_scope() {
        let (broker, p) = writer("notes");
        match broker.request_write(&p, replace("./notes//sub/./a.md")) {
            Decision::NeedsApproval(change) => assert_eq!(change.path, "notes/sub/a.md"),
            other => panic!("unexpected {other:?}"),
        }
        match broker.request_write(&p, replace("notes\\sub\\a.md")) {
            Decision::NeedsApproval(change) => assert_eq!(change.path, "notes/sub/a.md"),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn obsidian_writes_are_denied_even_with_whole_vault_scope() {
        let (broker, p) = writer("");
        let expected = deny_configuration_write(ConfigurationWriteRequest {
            plugin_id: "writer",
            target: Some(".obsidian/plugins/x/data.json"),
            detail: None,
        });
        for path in [
            ".obsidian/plugins/x/data.json",
            ".OBSIDIAN/app.json",
            "./.obsidian/app.json",
            "sub/.obsidian/app.json",
            ".obsidian\\app.json",
            "notes/../.obsidian/app.json",
        ] {
            let denial = denied(broker.request_write(&p, replace(path)));
            assert!(
                matches!(
                    denial.reason,
                    DenialReason::ConfigurationPath | DenialReason::InvalidPath(_)
                ),
                "{path}"
            );
        }
        let denial = denied(broker.request_write(&p, replace(".obsidian/plugins/x/data.json")));
        assert_eq!(denial.reason, DenialReason::ConfigurationPath);
        assert_eq!(denial.d15.unwrap().record, expected.record);
        // Not granted at all still reports the configuration denial.
        let none = CapabilityBroker::new();
        assert_eq!(
            reason(none.request_write(&plugin("writer", HASH_A), replace(".obsidian/app.json"))),
            DenialReason::ConfigurationPath
        );
        // Paths that merely resemble the directory are fine.
        assert!(matches!(
            broker.request_write(&p, replace("obsidian/app.json")),
            Decision::NeedsApproval(_)
        ));
        assert!(matches!(
            broker.request_write(&p, replace(".obsidian-notes/a.md")),
            Decision::NeedsApproval(_)
        ));
    }

    #[test]
    fn obsidian_reads_are_denied() {
        let mut broker = CapabilityBroker::new();
        let p = plugin("a", HASH_A);
        broker
            .grants_mut()
            .grant(&p, Capability::VaultRead(String::new()))
            .unwrap();
        assert_eq!(
            reason(broker.request(
                &p,
                Capability::VaultRead(".obsidian/plugins/x/data.json".into())
            )),
            DenialReason::ConfigurationPath
        );
        assert_eq!(
            broker.request(&p, Capability::VaultRead("notes/a.md".into())),
            Decision::Allow
        );
    }

    #[test]
    fn stale_hash_cannot_write() {
        let (broker, _) = writer("notes");
        let changed = plugin("writer", HASH_B);
        assert_eq!(
            reason(broker.request_write(&changed, replace("notes/a.md"))),
            DenialReason::NotGranted
        );
    }

    #[test]
    fn d15_builder_rejects_missing_fields() {
        let full = || {
            D15Builder::new("p", "process.spawn")
                .reproduction("spawned sh")
                .safe_alternatives(PROCESS_ALTERNATIVES)
                .denial_test_id("t::id")
        };
        assert!(full().build().is_ok());
        assert_eq!(
            full().reproduction("   ").build(),
            Err(D15BuildError::MissingReproduction)
        );
        assert_eq!(
            full().reproduction("").build(),
            Err(D15BuildError::MissingReproduction)
        );
        assert_eq!(
            full().safe_alternatives(&[]).build(),
            Err(D15BuildError::MissingSafeAlternatives)
        );
        assert_eq!(
            full().denial_test_id("").build(),
            Err(D15BuildError::MissingDenialTestId)
        );
        assert_eq!(
            full().denial_test_id("  ").build(),
            Err(D15BuildError::MissingDenialTestId)
        );
        assert_eq!(
            D15Builder::new("", "process.spawn")
                .reproduction("r")
                .safe_alternatives(PROCESS_ALTERNATIVES)
                .denial_test_id("t")
                .build(),
            Err(D15BuildError::MissingPluginId)
        );
        assert_eq!(
            D15Builder::new("p", "")
                .reproduction("r")
                .safe_alternatives(PROCESS_ALTERNATIVES)
                .denial_test_id("t")
                .build(),
            Err(D15BuildError::MissingCapability)
        );
    }

    #[test]
    fn d15_builder_output_shape() {
        let built = D15Builder::new("p", "process.spawn")
            .reproduction("spawned sh")
            .safe_alternatives(PROCESS_ALTERNATIVES)
            .denial_test_id("t::id")
            .build()
            .unwrap();
        assert_eq!(built.record.id, "D15:p:process.spawn");
        assert_eq!(built.record.status, "unsupported_security");
        assert!(built.record.visible);
        assert_eq!(built.denial_test_id, "t::id");
    }

    #[test]
    fn existing_configuration_write_policy_is_unchanged() {
        let denial = deny_configuration_write(ConfigurationWriteRequest {
            plugin_id: "p",
            target: Some("x"),
            detail: None,
        });
        assert_eq!(denial.decision, "deny");
        assert_eq!(
            denial.record.reproduction,
            "configuration.write requested for x"
        );
    }
}
