//! Application services that compose document and vault behavior without UI dependencies.

pub use openobsidian_vault::{
    VaultConflictAction, VaultConflictRead, VaultConflictResolution, VaultHistoryCleanup,
    VaultError, VaultHistoryPlan, VaultHistoryPolicy, VaultHistoryRecord,
};
use openobsidian_vault::{VaultEntry, VaultRead, VaultStore};
use std::path::Path;
use std::time::SystemTime;

/// Application session for a vault and its app-owned history directory.
#[derive(Debug)]
pub struct VaultSession {
    store: VaultStore,
    entries: Vec<VaultEntry>,
}

impl VaultSession {
    /// Opens a vault with a separately managed app-data directory.
    pub fn open(
        root: impl AsRef<Path>,
        app_data_root: impl AsRef<Path>,
    ) -> Result<Self, VaultError> {
        let store = VaultStore::open(root, app_data_root)?;
        let entries = store.root().scan_markdown()?;
        Ok(Self { store, entries })
    }

    /// Returns the current Markdown listing captured when the session was opened.
    pub fn entries(&self) -> &[VaultEntry] {
        &self.entries
    }

    /// Returns the canonical vault root path.
    pub fn root_path(&self) -> &Path {
        self.store.root().path()
    }

    /// Reads a note through the vault's root-confinement and revision-hashing boundary.
    pub fn read(&self, relative_path: impl AsRef<Path>) -> Result<VaultRead, VaultError> {
        self.store.root().read(relative_path)
    }

    /// Lists validated recovery, failed-write and conflict records.
    pub fn history_records(&self) -> Result<Vec<VaultHistoryRecord>, VaultError> {
        self.store.history_records()
    }

    /// Builds a fresh, read-only age and size retention plan.
    pub fn history_retention_plan(
        &self,
        policy: VaultHistoryPolicy,
    ) -> Result<VaultHistoryPlan, VaultError> {
        self.store.history_retention_plan(policy, SystemTime::now())
    }

    /// Cleans only records made pruneable by the selected policy.
    pub fn cleanup_history(
        &self,
        policy: VaultHistoryPolicy,
    ) -> Result<VaultHistoryCleanup, VaultError> {
        self.store.cleanup_history(policy)
    }

    /// Reads incoming conflict bytes after validating the record and relative path.
    pub fn read_conflict(
        &self,
        id: &str,
        relative_path: impl AsRef<Path>,
    ) -> Result<VaultConflictRead, VaultError> {
        self.store.read_conflict(id, relative_path)
    }

    /// Resolves one conflict after the caller explicitly chooses which version to keep.
    pub fn resolve_conflict(
        &self,
        id: &str,
        relative_path: impl AsRef<Path>,
        action: VaultConflictAction,
    ) -> Result<VaultConflictResolution, VaultError> {
        self.store.resolve_conflict(id, relative_path, action)
    }
}
