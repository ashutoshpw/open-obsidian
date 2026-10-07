//! Extension compatibility and capability-policy boundary.

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
