//! Hash-pinned extension packages: `extension.json` plus one `.wasm` module.
//!
//! ```json
//! {
//!   "id": "example-extension",
//!   "version": "1.0.0",
//!   "abi": "openobsidian:ext/1",
//!   "capabilities": ["log", "vault.read"],
//!   "module": "extension.wasm",
//!   "sha256": "<64 lowercase hex digits of the module bytes>"
//! }
//! ```

use std::collections::BTreeSet;

use serde::Deserialize;
use sha2::{Digest, Sha256};

use super::abi::{ABI_ID, HostCapability};

/// File name of the manifest inside an extension package directory.
pub const MANIFEST_FILE_NAME: &str = "extension.json";
/// Maximum accepted manifest size in bytes.
pub const MAX_MANIFEST_BYTES: usize = 64 * 1024;
const MAX_ID_LEN: usize = 128;
const MAX_VERSION_LEN: usize = 64;

/// Raw `extension.json` contents. Unknown fields are rejected.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ExtensionManifest {
    /// Stable identifier: lowercase ASCII letters, digits, `-`, `_` and `.`.
    pub id: String,
    /// Extension version string.
    pub version: String,
    /// ABI identifier; must equal [`ABI_ID`].
    pub abi: String,
    /// Requested capability names (see [`HostCapability::as_str`]).
    #[serde(default)]
    pub capabilities: Vec<String>,
    /// Module file name next to the manifest; a plain `*.wasm` file name.
    pub module: String,
    /// Lowercase hex SHA-256 of the module bytes.
    pub sha256: String,
}

/// Why a package was rejected.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum PackageError {
    /// The manifest exceeded [`MAX_MANIFEST_BYTES`].
    #[error("extension manifest is {size} bytes; the limit is {limit}")]
    ManifestTooLarge {
        /// Actual size.
        size: usize,
        /// Limit.
        limit: usize,
    },
    /// The manifest is not valid JSON for [`ExtensionManifest`].
    #[error("extension manifest is malformed: {0}")]
    MalformedManifest(String),
    /// A manifest field failed validation.
    #[error("extension manifest field `{field}` is invalid: {reason}")]
    InvalidField {
        /// Field name.
        field: &'static str,
        /// Why it is invalid.
        reason: &'static str,
    },
    /// The manifest names an ABI this host does not implement.
    #[error("extension ABI `{found}` is not supported; expected `{expected}`")]
    UnsupportedAbi {
        /// Supported ABI.
        expected: &'static str,
        /// ABI named by the manifest.
        found: String,
    },
    /// The manifest requests a capability this ABI does not define.
    #[error("extension requests unknown capability `{0}`")]
    UnknownCapability(String),
    /// The manifest lists a capability twice.
    #[error("extension requests capability `{0}` more than once")]
    DuplicateCapability(String),
    /// The module bytes do not match the pinned hash.
    #[error("extension module hash mismatch: expected {expected}, found {actual}")]
    HashMismatch {
        /// Hash pinned in the manifest.
        expected: String,
        /// Hash of the supplied bytes.
        actual: String,
    },
}

/// A verified package: validated manifest, parsed capabilities and hash-checked module.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExtensionPackage {
    manifest: ExtensionManifest,
    capabilities: BTreeSet<HostCapability>,
    wasm: Vec<u8>,
}

impl ExtensionPackage {
    /// Parses and validates `extension.json`, then verifies `wasm` against its pin.
    pub fn from_parts(manifest_json: &[u8], wasm: Vec<u8>) -> Result<Self, PackageError> {
        let manifest = ExtensionManifest::parse(manifest_json)?;
        Self::new(manifest, wasm)
    }

    /// Validates an already-parsed manifest and verifies `wasm` against its pin.
    pub fn new(manifest: ExtensionManifest, wasm: Vec<u8>) -> Result<Self, PackageError> {
        let capabilities = manifest.validate()?;
        let actual = sha256_hex(&wasm);
        if actual != manifest.sha256 {
            return Err(PackageError::HashMismatch {
                expected: manifest.sha256,
                actual,
            });
        }
        Ok(Self {
            manifest,
            capabilities,
            wasm,
        })
    }

    /// The validated manifest.
    pub fn manifest(&self) -> &ExtensionManifest {
        &self.manifest
    }

    /// Capabilities requested by the manifest.
    pub fn capabilities(&self) -> &BTreeSet<HostCapability> {
        &self.capabilities
    }

    /// The hash-verified module bytes.
    pub fn wasm(&self) -> &[u8] {
        &self.wasm
    }
}

impl ExtensionManifest {
    /// Parses manifest JSON without validating field contents.
    pub fn parse(json: &[u8]) -> Result<Self, PackageError> {
        if json.len() > MAX_MANIFEST_BYTES {
            return Err(PackageError::ManifestTooLarge {
                size: json.len(),
                limit: MAX_MANIFEST_BYTES,
            });
        }
        serde_json::from_slice(json)
            .map_err(|error| PackageError::MalformedManifest(error.to_string()))
    }

    /// Validates every field and returns the parsed capability set.
    pub fn validate(&self) -> Result<BTreeSet<HostCapability>, PackageError> {
        if self.id.is_empty() || self.id.len() > MAX_ID_LEN {
            return Err(invalid("id", "must be 1 to 128 bytes"));
        }
        if !self.id.bytes().all(is_id_byte) || !self.id.as_bytes()[0].is_ascii_alphanumeric() {
            return Err(invalid(
                "id",
                "must start with a lowercase letter or digit and contain only [a-z0-9._-]",
            ));
        }
        if self.version.trim().is_empty() || self.version.len() > MAX_VERSION_LEN {
            return Err(invalid("version", "must be 1 to 64 non-blank bytes"));
        }
        if self.abi != ABI_ID {
            return Err(PackageError::UnsupportedAbi {
                expected: ABI_ID,
                found: self.abi.clone(),
            });
        }
        if !is_module_file_name(&self.module) {
            return Err(invalid(
                "module",
                "must be a plain `.wasm` file name without path separators",
            ));
        }
        if self.sha256.len() != 64
            || !self
                .sha256
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(invalid("sha256", "must be 64 lowercase hex digits"));
        }
        let mut capabilities = BTreeSet::new();
        for name in &self.capabilities {
            let capability = HostCapability::parse(name)
                .ok_or_else(|| PackageError::UnknownCapability(name.clone()))?;
            if !capabilities.insert(capability) {
                return Err(PackageError::DuplicateCapability(name.clone()));
            }
        }
        Ok(capabilities)
    }
}

/// Lowercase hex SHA-256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn invalid(field: &'static str, reason: &'static str) -> PackageError {
    PackageError::InvalidField { field, reason }
}

fn is_id_byte(byte: u8) -> bool {
    byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_' | b'.')
}

fn is_module_file_name(name: &str) -> bool {
    name.len() > ".wasm".len()
        && name.len() <= 255
        && name.ends_with(".wasm")
        && !name.starts_with('.')
        && !name.contains(['/', '\\', ':'])
        && !name.chars().any(char::is_control)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest_json(abi: &str, capabilities: &str, sha256: &str) -> Vec<u8> {
        format!(
            r#"{{"id":"sample-ext","version":"1.0.0","abi":"{abi}","capabilities":{capabilities},"module":"sample.wasm","sha256":"{sha256}"}}"#
        )
        .into_bytes()
    }

    #[test]
    fn accepts_hash_pinned_package() {
        let wasm = b"\0asm\x01\0\0\0".to_vec();
        let json = manifest_json(ABI_ID, r#"["log","vault.read"]"#, &sha256_hex(&wasm));
        let package = ExtensionPackage::from_parts(&json, wasm).expect("valid package");
        assert_eq!(package.manifest().id, "sample-ext");
        assert!(package.capabilities().contains(&HostCapability::Log));
        assert!(package.capabilities().contains(&HostCapability::VaultRead));
        assert_eq!(package.capabilities().len(), 2);
    }

    #[test]
    fn rejects_hash_mismatch() {
        let wasm = b"\0asm\x01\0\0\0".to_vec();
        let json = manifest_json(ABI_ID, "[]", &sha256_hex(b"other"));
        assert!(matches!(
            ExtensionPackage::from_parts(&json, wasm),
            Err(PackageError::HashMismatch { .. })
        ));
    }

    #[test]
    fn rejects_wrong_abi_unknown_and_duplicate_capabilities() {
        let wasm = b"\0asm\x01\0\0\0".to_vec();
        let hash = sha256_hex(&wasm);
        assert!(matches!(
            ExtensionPackage::from_parts(
                &manifest_json("openobsidian:ext/2", "[]", &hash),
                wasm.clone()
            ),
            Err(PackageError::UnsupportedAbi { .. })
        ));
        assert_eq!(
            ExtensionPackage::from_parts(
                &manifest_json(ABI_ID, r#"["network"]"#, &hash),
                wasm.clone()
            ),
            Err(PackageError::UnknownCapability("network".to_owned()))
        );
        assert_eq!(
            ExtensionPackage::from_parts(&manifest_json(ABI_ID, r#"["log","log"]"#, &hash), wasm),
            Err(PackageError::DuplicateCapability("log".to_owned()))
        );
    }

    #[test]
    fn rejects_malformed_manifests_and_unsafe_module_names() {
        assert!(matches!(
            ExtensionManifest::parse(b"{not json"),
            Err(PackageError::MalformedManifest(_))
        ));
        assert!(matches!(
            ExtensionManifest::parse(
                br#"{"id":"a","version":"1","abi":"x","module":"a.wasm","sha256":"0","extra":1}"#
            ),
            Err(PackageError::MalformedManifest(_))
        ));
        let oversized = vec![b' '; MAX_MANIFEST_BYTES + 1];
        assert!(matches!(
            ExtensionManifest::parse(&oversized),
            Err(PackageError::ManifestTooLarge { .. })
        ));
        for module in ["../escape.wasm", "dir/a.wasm", "a.js", ".wasm", "C:a.wasm"] {
            let manifest = ExtensionManifest {
                id: "sample".to_owned(),
                version: "1".to_owned(),
                abi: ABI_ID.to_owned(),
                capabilities: Vec::new(),
                module: module.to_owned(),
                sha256: "0".repeat(64),
            };
            assert!(
                matches!(
                    manifest.validate(),
                    Err(PackageError::InvalidField {
                        field: "module",
                        ..
                    })
                ),
                "{module}"
            );
        }
    }
}
