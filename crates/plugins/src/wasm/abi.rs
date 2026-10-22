//! Versioned guest/host ABI `openobsidian:ext/1` and the host broker seam.
//!
//! # Guest contract
//!
//! A module built for this ABI:
//!
//! - imports functions only from the [`ABI_MODULE`] namespace and only the names in
//!   [`HOST_FUNCTIONS`] (no WASI, no other namespaces);
//! - exports its linear memory as [`EXPORT_MEMORY`];
//! - exports [`EXPORT_ABI_VERSION`] with signature `() -> i32` returning [`ABI_VERSION`];
//! - exports entry points with signature `() -> i32` that the host calls by name.
//!
//! # Host functions
//!
//! Every pointer/length pair addresses the guest's exported memory. All functions
//! return an `i32`: a non-negative value is success (for reads, the number of bytes
//! written), a negative value is one of the `STATUS_*` codes. Denials are ordinary
//! return values, never traps; the host traps only when a resource limit (host-call
//! budget, output bytes, wall-clock deadline) is breached.
//!
//! | Name | Signature | Capability |
//! | --- | --- | --- |
//! | `vault_read` | `(path_ptr, path_len, out_ptr, out_cap) -> i32` | `vault.read` |
//! | `vault_propose_change` | `(path_ptr, path_len, content_ptr, content_len) -> i32` | `vault.propose_change` |
//! | `log` | `(level, msg_ptr, msg_len) -> i32` | `log` |
//! | `command_register` | `(id_ptr, id_len, name_ptr, name_len) -> i32` | `command.register` |
//! | `settings_get` | `(key_ptr, key_len, out_ptr, out_cap) -> i32` | `settings.get` |
//! | `settings_set` | `(key_ptr, key_len, value_ptr, value_len) -> i32` | `settings.set` |
//! | `output_write` | `(ptr, len) -> i32` | none (bounded call output) |
//!
//! Capability-bearing calls are denied unless the extension manifest requested the
//! capability **and** the [`HostBroker`] grants it. The trait's default methods deny,
//! so a broker must opt in per capability.

use std::fmt;

/// Stable ABI identifier carried by `extension.json` and used as the import namespace.
pub const ABI_ID: &str = "openobsidian:ext/1";
/// Import module (namespace) every host function is defined under.
pub const ABI_MODULE: &str = ABI_ID;
/// Numeric ABI version that the guest's [`EXPORT_ABI_VERSION`] export must return.
pub const ABI_VERSION: i32 = 1;

/// Required guest memory export.
pub const EXPORT_MEMORY: &str = "memory";
/// Required guest export `() -> i32` returning [`ABI_VERSION`].
pub const EXPORT_ABI_VERSION: &str = "oo_abi_version";

/// Host function `vault_read`.
pub const FN_VAULT_READ: &str = "vault_read";
/// Host function `vault_propose_change`.
pub const FN_VAULT_PROPOSE_CHANGE: &str = "vault_propose_change";
/// Host function `log`.
pub const FN_LOG: &str = "log";
/// Host function `command_register`.
pub const FN_COMMAND_REGISTER: &str = "command_register";
/// Host function `settings_get`.
pub const FN_SETTINGS_GET: &str = "settings_get";
/// Host function `settings_set`.
pub const FN_SETTINGS_SET: &str = "settings_set";
/// Host function `output_write`.
pub const FN_OUTPUT_WRITE: &str = "output_write";

/// All host function names defined in [`ABI_MODULE`].
pub const HOST_FUNCTIONS: &[&str] = &[
    FN_VAULT_READ,
    FN_VAULT_PROPOSE_CHANGE,
    FN_LOG,
    FN_COMMAND_REGISTER,
    FN_SETTINGS_GET,
    FN_SETTINGS_SET,
    FN_OUTPUT_WRITE,
];

/// Success without a byte count.
pub const STATUS_OK: i32 = 0;
/// The capability was not requested by the manifest or was denied by the broker.
pub const STATUS_DENIED: i32 = -1;
/// A pointer/length was out of bounds, too large, not UTF-8, or a value was invalid.
pub const STATUS_INVALID_ARGUMENT: i32 = -2;
/// The provided output buffer is smaller than the value.
pub const STATUS_BUFFER_TOO_SMALL: i32 = -3;
/// The requested item does not exist.
pub const STATUS_NOT_FOUND: i32 = -4;
/// The broker could not complete the request.
pub const STATUS_UNAVAILABLE: i32 = -5;

/// A capability that a host function exercises.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum HostCapability {
    /// `vault.read`: read a vault file through the broker.
    VaultRead,
    /// `vault.propose_change`: propose a reviewable vault change (never a direct write).
    VaultProposeChange,
    /// `log`: emit a diagnostic log line.
    Log,
    /// `command.register`: register a command with the host.
    CommandRegister,
    /// `settings.get`: read an extension-scoped setting.
    SettingsGet,
    /// `settings.set`: write an extension-scoped setting.
    SettingsSet,
}

impl HostCapability {
    /// Every capability, in manifest order.
    pub const ALL: [Self; 6] = [
        Self::VaultRead,
        Self::VaultProposeChange,
        Self::Log,
        Self::CommandRegister,
        Self::SettingsGet,
        Self::SettingsSet,
    ];

    /// Manifest spelling of the capability.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::VaultRead => "vault.read",
            Self::VaultProposeChange => "vault.propose_change",
            Self::Log => "log",
            Self::CommandRegister => "command.register",
            Self::SettingsGet => "settings.get",
            Self::SettingsSet => "settings.set",
        }
    }

    /// Parses a manifest capability name.
    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|capability| capability.as_str() == name)
    }
}

impl fmt::Display for HostCapability {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Guest log level passed to `log`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LogLevel {
    /// `0`
    Error,
    /// `1`
    Warn,
    /// `2`
    Info,
    /// `3`
    Debug,
    /// `4`
    Trace,
}

impl LogLevel {
    /// Decodes the ABI value; returns `None` for unknown levels.
    pub const fn from_abi(value: i32) -> Option<Self> {
        match value {
            0 => Some(Self::Error),
            1 => Some(Self::Warn),
            2 => Some(Self::Info),
            3 => Some(Self::Debug),
            4 => Some(Self::Trace),
            _ => None,
        }
    }
}

/// Identity of the calling extension, passed to every broker method.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct HostCallContext<'a> {
    /// Manifest `id` of the extension.
    pub extension_id: &'a str,
    /// Manifest `version` of the extension.
    pub extension_version: &'a str,
}

/// Why a broker refused or could not complete a host call.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum HostDenialKind {
    /// The capability is not granted (policy denial). Maps to [`STATUS_DENIED`].
    Denied,
    /// The target does not exist. Maps to [`STATUS_NOT_FOUND`].
    NotFound,
    /// The broker failed for a non-policy reason. Maps to [`STATUS_UNAVAILABLE`].
    Unavailable,
}

/// A broker refusal returned to the host function, then to the guest as a status code.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostDenial {
    /// Capability the call exercised.
    pub capability: HostCapability,
    /// Kind of refusal.
    pub kind: HostDenialKind,
    /// Human-readable reason recorded for visibility.
    pub reason: String,
}

impl HostDenial {
    /// The default policy denial used by every [`HostBroker`] method.
    pub fn denied_by_default(capability: HostCapability) -> Self {
        Self {
            capability,
            kind: HostDenialKind::Denied,
            reason: format!("{capability} is not granted by the host broker"),
        }
    }

    /// The ABI status code for this refusal.
    pub const fn status(&self) -> i32 {
        match self.kind {
            HostDenialKind::Denied => STATUS_DENIED,
            HostDenialKind::NotFound => STATUS_NOT_FOUND,
            HostDenialKind::Unavailable => STATUS_UNAVAILABLE,
        }
    }
}

/// The capability broker seam used by the WASM host.
///
/// Every method denies by default. The capability broker (R4 task 02) implements this
/// trait to grant individual capabilities with revision checks and previews; this
/// module does not depend on it. Implementations must not block for long: the host's
/// wall-clock deadline is only checked between host calls and fuel slices.
pub trait HostBroker: Send + Sync {
    /// Reads a vault-relative file.
    fn vault_read(&self, cx: &HostCallContext<'_>, path: &str) -> Result<Vec<u8>, HostDenial> {
        let _ = (cx, path);
        Err(HostDenial::denied_by_default(HostCapability::VaultRead))
    }

    /// Records a proposed vault change for user review. Never writes directly.
    fn vault_propose_change(
        &self,
        cx: &HostCallContext<'_>,
        path: &str,
        content: &[u8],
    ) -> Result<(), HostDenial> {
        let _ = (cx, path, content);
        Err(HostDenial::denied_by_default(
            HostCapability::VaultProposeChange,
        ))
    }

    /// Emits a log line.
    fn log(
        &self,
        cx: &HostCallContext<'_>,
        level: LogLevel,
        message: &str,
    ) -> Result<(), HostDenial> {
        let _ = (cx, level, message);
        Err(HostDenial::denied_by_default(HostCapability::Log))
    }

    /// Registers a command.
    fn command_register(
        &self,
        cx: &HostCallContext<'_>,
        command_id: &str,
        name: &str,
    ) -> Result<(), HostDenial> {
        let _ = (cx, command_id, name);
        Err(HostDenial::denied_by_default(
            HostCapability::CommandRegister,
        ))
    }

    /// Reads an extension-scoped setting; `Ok(None)` means unset.
    fn settings_get(
        &self,
        cx: &HostCallContext<'_>,
        key: &str,
    ) -> Result<Option<Vec<u8>>, HostDenial> {
        let _ = (cx, key);
        Err(HostDenial::denied_by_default(HostCapability::SettingsGet))
    }

    /// Writes an extension-scoped setting.
    fn settings_set(
        &self,
        cx: &HostCallContext<'_>,
        key: &str,
        value: &[u8],
    ) -> Result<(), HostDenial> {
        let _ = (cx, key, value);
        Err(HostDenial::denied_by_default(HostCapability::SettingsSet))
    }
}

/// A broker that grants nothing: every method keeps the denying default.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct DenyAllBroker;

impl HostBroker for DenyAllBroker {}

/// A visible record of a denied host call.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostDenialRecord {
    /// Manifest `id` of the extension.
    pub extension_id: String,
    /// Capability the call exercised.
    pub capability: HostCapability,
    /// Whether the manifest requested the capability (if not, the broker was not asked).
    pub requested_by_manifest: bool,
    /// Reason recorded for the denial.
    pub reason: String,
}
