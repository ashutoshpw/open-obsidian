//! Native operating-system service interfaces.

mod storage_protection;

pub use storage_protection::{
    StorageProtectionPlatform, StorageProtectionReport, StorageProtectionStatus,
    inspect_storage_protection,
};

/// A credential store backed by an operating-system protected secret facility.
///
/// Implementations must return an error when protection is unavailable; they must never
/// silently persist a credential as plaintext.
pub trait CredentialStore {
    /// Reads a credential by its stable application key.
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>, CredentialStoreError>;

    /// Stores a credential using the platform's protected storage facility.
    fn set(&self, key: &str, value: &[u8]) -> Result<(), CredentialStoreError>;

    /// Removes a credential after an explicit caller request.
    fn delete(&self, key: &str) -> Result<(), CredentialStoreError>;
}

/// Failure reported by an operating-system credential backend.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CredentialStoreError {
    /// Stable machine-readable reason suitable for logs and recovery UI.
    pub reason: &'static str,
}
