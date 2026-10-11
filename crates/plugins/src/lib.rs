//! Extension compatibility and capability-policy boundary.

/// A shared plugin configuration write requested by the legacy plugin host.
///
/// This request is evaluated without accessing the target path. This contract is
/// deny-only and provides no enablement or write path.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ConfigurationWriteRequest<'a> {
    /// Stable identifier of the plugin making the request.
    pub plugin_id: &'a str,
    /// Optional vault-relative target path requested by the plugin.
    pub target: Option<&'a str>,
    /// Optional caller-provided reproduction detail.
    pub detail: Option<&'a str>,
}

/// A D15 record describing a denied plugin capability request.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct D15Record {
    /// Stable record identity for this plugin and capability pair.
    pub id: String,
    /// Plugin identifier associated with the request.
    pub plugin_id: String,
    /// The capability named by the request.
    pub capability: &'static str,
    /// D15 status for this unsupported security capability.
    pub status: &'static str,
    /// Whether this record should be surfaced to the user.
    pub visible: bool,
    /// Reproduction detail for the denied request.
    pub reproduction: String,
    /// Legacy D15 alternatives recorded for this denial; this policy does not invoke them.
    pub safe_alternatives_attempted: &'static [&'static str],
    /// Scope of this compatibility record.
    pub scope: &'static str,
}

/// The deny-only result of a shared plugin configuration write request.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfigurationWriteDenial {
    /// Policy decision. This API currently returns only `"deny"`.
    pub decision: &'static str,
    /// D15 record marked for host visibility; this crate does not render the record.
    pub record: D15Record,
}

const CONFIGURATION_WRITE_CAPABILITY: &str = "configuration.write";
const D15_STATUS_UNSUPPORTED_SECURITY: &str = "unsupported_security";
const PLUGIN_RUNTIME_SCOPE: &str = "plugin-runtime";
const CONFIGURATION_WRITE_SAFE_ALTERNATIVES: &[&str] = &["mediated vault read", "preview broker", "workflow disabled"];

/// Denies a request to write shared plugin configuration and returns its D15 record.
///
/// The reproduction string follows the existing TypeScript policy: caller detail
/// takes precedence; otherwise it names the capability and, for a non-empty target,
/// includes that target. No filesystem access or mutation occurs here.
pub fn deny_configuration_write(
    request: ConfigurationWriteRequest<'_>,
) -> ConfigurationWriteDenial {
    let reproduction = request.detail.map(str::to_owned).unwrap_or_else(|| {
        match request.target.filter(|target| !target.is_empty()) {
            Some(target) => format!("{CONFIGURATION_WRITE_CAPABILITY} requested for {target}"),
            None => format!("{CONFIGURATION_WRITE_CAPABILITY} requested"),
        }
    });
    let record = D15Record {
        id: format!("D15:{}:{CONFIGURATION_WRITE_CAPABILITY}", request.plugin_id),
        plugin_id: request.plugin_id.to_owned(),
        capability: CONFIGURATION_WRITE_CAPABILITY,
        status: D15_STATUS_UNSUPPORTED_SECURITY,
        visible: true,
        reproduction,
        safe_alternatives_attempted: CONFIGURATION_WRITE_SAFE_ALTERNATIVES,
        scope: PLUGIN_RUNTIME_SCOPE,
    };

    ConfigurationWriteDenial {
        decision: "deny",
        record,
    }
}

/// Result state for the unchanged JavaScript/DOM compatibility feasibility gate.
///
/// The initial state is deliberately pending. A native Rust workspace build does not certify
/// execution of existing Obsidian plugin bundles.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LegacyCompatibility {
    /// No runtime has yet passed the required unchanged-artifact workflows.
    Pending,
    /// The unchanged artifact passed the complete, recorded compatibility cohort.
    Compatible,
    /// The path was disabled after the approved security and alternatives review.
    DisabledWithEvidence,
}
