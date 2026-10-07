//! Application services that compose document and vault behavior without UI dependencies.

use openobsidian_vault::{VaultEntry, VaultError, VaultRead, VaultRoot};
use std::path::Path;

/// Read-only session for an opened vault.
#[derive(Debug)]
pub struct VaultSession {
    root: VaultRoot,
    entries: Vec<VaultEntry>,
}

impl VaultSession {
    /// Opens a vault and captures its initial Markdown listing without modifying it.
    pub fn open(root: impl AsRef<Path>) -> Result<Self, VaultError> {
        let root = VaultRoot::open(root)?;
        let entries = root.scan_markdown()?;
        Ok(Self { root, entries })
    }

    /// Returns the current Markdown listing captured when the session was opened.
    pub fn entries(&self) -> &[VaultEntry] {
        &self.entries
    }

    /// Reads a note through the vault's root-confinement and revision-hashing boundary.
    pub fn read(&self, relative_path: impl AsRef<Path>) -> Result<VaultRead, VaultError> {
        self.root.read(relative_path)
    }
}
