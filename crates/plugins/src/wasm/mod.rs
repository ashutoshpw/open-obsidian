//! Bounded `wasmi` host for Rust-era (WASM) extensions.
//!
//! Results from this runtime are "WASM projection" evidence. They never count toward
//! unchanged legacy JavaScript bundle certification.
//!
//! - [`package`]: `extension.json` manifest and hash-pinned module verification.
//! - [`abi`]: the versioned `openobsidian:ext/1` guest/host contract and the
//!   [`HostBroker`] seam through which every capability is mediated (deny by default).
//! - [`limits`]: fuel, wall-clock, memory, table, recursion, output and host-call limits.
//! - [`host`]: compilation, ABI checks, instantiation and limited calls. Traps and
//!   malformed modules become typed [`ExtensionError`]s; nothing here panics on guest
//!   behaviour, and there is no WASI, filesystem or network access.

pub mod abi;
pub mod host;
pub mod limits;
pub mod package;

pub use abi::{
    ABI_ID, ABI_VERSION, DenyAllBroker, HostBroker, HostCallContext, HostCapability, HostDenial,
    HostDenialKind, HostDenialRecord, LogLevel,
};
pub use host::{CallOutcome, ExtensionError, ExtensionHost, ExtensionInstance};
pub use limits::{ExtensionLimits, LimitsError};
pub use package::{ExtensionManifest, ExtensionPackage, PackageError};

#[cfg(test)]
mod tests;
