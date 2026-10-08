//! Native operating-system service interfaces.

mod storage_protection;
mod user_data;

pub use storage_protection::{
    StorageProtectionPlatform, StorageProtectionReport, StorageProtectionStatus,
    inspect_storage_protection,
};
pub use user_data::{
    UserDataCleanupFailure, UserDataCleanupOutcome, UserDataCleanupReport,
    UserDataCleanupSelection, UserDataError, app_user_data_directory, cleanup_user_data,
    prepare_vault_app_data, vault_app_data_directory_under,
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

    /// Removes only credentials owned by OpenObsidian after an explicit uninstall choice.
    ///
    /// Backends that cannot enumerate and clear the application's own credential namespace
    /// must retain this default error instead of claiming cleanup succeeded.
    fn delete_all_for_application(&self) -> Result<(), CredentialStoreError> {
        Err(CredentialStoreError {
            reason: "application credential cleanup is unavailable",
        })
    }
}

/// Failure reported by an operating-system credential backend.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CredentialStoreError {
    /// Stable machine-readable reason suitable for logs and recovery UI.
    pub reason: &'static str,
}
