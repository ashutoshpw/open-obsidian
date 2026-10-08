//! Shared deterministic helpers for Rust migration tests.

/// A controllable monotonic clock for repeatable expiry and recovery tests.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct FakeClock {
    now_millis: u64,
}

impl FakeClock {
    /// Creates a clock at the requested millisecond offset.
    pub const fn at(now_millis: u64) -> Self {
        Self { now_millis }
    }

    /// Returns the current millisecond offset.
    pub const fn now_millis(self) -> u64 {
        self.now_millis
    }

    /// Advances the clock by the requested duration.
    pub fn advance(&mut self, millis: u64) {
        self.now_millis = self.now_millis.saturating_add(millis);
    }
}

#[cfg(test)]
mod rename_plan_fixture_tests {
    use openobsidian_doc::{
        LinkRenameAction, LinkResolutionStatus, MarkdownSource, RenamePlanFile,
        build_link_rename_plan, render_link_rename_preview,
    };
    use serde_json::Value;

    const RENAME_PLAN_FIXTURE: &str = include_str!("../../../fixtures/rename-plan.json");

    #[test]
    fn c03_rename_move_fixture_matches_the_rust_planner_without_changing_unplanned_bytes() {
        let fixture: Value = serde_json::from_str(RENAME_PLAN_FIXTURE)
            .expect("rename-plan fixture must be valid JSON");
        assert_eq!(fixture["schema_version"], 1);
        assert_eq!(fixture["id"], "fixture:c03-rename-move");
        assert_eq!(
            fixture["actions"],
            serde_json::json!(["update", "skip-ambiguous", "skip-unresolved"])
        );
        assert!(fixture["invariants"]
            .as_object()
            .expect("fixture invariants must be an object")
            .values()
            .all(|value| value.as_bool() == Some(true)));

        let cases = fixture["cases"]
            .as_array()
            .expect("fixture cases must be an array");
        assert!(!cases.is_empty());

        for case in cases {
            let case_id = case["id"]
                .as_str()
                .expect("fixture case must have an id");
            let old_path = case["old_path"]
                .as_str()
                .expect("fixture case must have an old path");
            let new_path = case["new_path"]
                .as_str()
                .expect("fixture case must have a new path");
            let file_cases = case["files"]
                .as_array()
                .expect("fixture files must be an array");
            let mut originals = Vec::with_capacity(file_cases.len());
            let mut files = Vec::with_capacity(file_cases.len());

            for file in file_cases {
                let relative_path = file["relative_path"]
                    .as_str()
                    .expect("fixture file must have a relative path")
                    .to_owned();
                let source_text = file["source"]
                    .as_str()
                    .expect("fixture file must have source text")
                    .to_owned();
                let source = MarkdownSource::parse(source_text.as_bytes().to_vec())
                    .expect("fixture Markdown must be UTF-8");
                originals.push((relative_path.clone(), source_text, source.clone()));
                files.push(RenamePlanFile {
                    relative_path,
                    source,
                });
            }

            let plan = build_link_rename_plan(&files, old_path, new_path)
                .unwrap_or_else(|error| panic!("{case_id}: {error}"));
            assert_eq!(
                plan.update_count,
                usize::try_from(
                    case["expected_update_count"]
                    .as_u64()
                    .expect("fixture must state expected update count"),
                )
                .expect("fixture update count must fit usize"),
                "{case_id}: update count"
            );
            assert_eq!(
                plan.skipped_count,
                usize::try_from(
                    case["expected_skipped_count"]
                    .as_u64()
                    .expect("fixture must state expected skipped count"),
                )
                .expect("fixture skipped count must fit usize"),
                "{case_id}: skipped count"
            );

            let expected_edits = case["expected_edits"]
                .as_array()
                .expect("fixture expected edits must be an array");
            assert_eq!(
                plan.edits.len(),
                expected_edits.len(),
                "{case_id}: edit count"
            );
            for (edit, expected) in plan.edits.iter().zip(expected_edits) {
                assert_eq!(
                    edit.source_path,
                    expected["source_path"].as_str().expect("fixture source path"),
                    "{case_id}: source"
                );
                assert_eq!(
                    edit.target,
                    expected["target"].as_str().expect("fixture target"),
                    "{case_id}: target"
                );
                assert_eq!(
                    resolution_name(edit.resolution),
                    expected["resolution"].as_str().expect("fixture resolution"),
                    "{case_id}: resolution"
                );
                assert_eq!(
                    action_name(edit.action),
                    expected["action"].as_str().expect("fixture action"),
                    "{case_id}: action"
                );
                assert_eq!(
                    edit.replacement.as_deref(),
                    expected["replacement"].as_str(),
                    "{case_id}: replacement"
                );
            }

            let expected_warnings: Vec<&str> = case["expected_warnings"]
                .as_array()
                .expect("fixture expected warnings must be an array")
                .iter()
                .map(|warning| warning.as_str().expect("fixture warning must be text"))
                .collect();
            assert_eq!(
                plan.warnings
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>(),
                expected_warnings,
                "{case_id}: warnings"
            );

            let expected_sources = case["expected_sources"]
                .as_object()
                .expect("fixture expected sources must be an object");
            assert_eq!(
                expected_sources.len(),
                originals.len(),
                "{case_id}: output count"
            );
            for (relative_path, source_text, source) in &originals {
                assert_eq!(
                    source.as_bytes(),
                    source_text.as_bytes(),
                    "{case_id}: planning must leave original source untouched"
                );
                let rendered = render_link_rename_preview(source, relative_path, &plan)
                    .unwrap_or_else(|error| panic!("{case_id}/{relative_path}: {error}"));
                let expected = expected_sources
                    .get(relative_path.as_str())
                    .expect("fixture must include every rendered source")
                    .as_str()
                    .expect("fixture expected source must be text");
                assert_eq!(
                    rendered,
                    expected.as_bytes(),
                    "{case_id}/{relative_path}: rendered bytes"
                );
            }
        }
    }

    fn action_name(action: LinkRenameAction) -> &'static str {
        match action {
            LinkRenameAction::Update => "update",
            LinkRenameAction::SkipAmbiguous => "skip-ambiguous",
            LinkRenameAction::SkipUnresolved => "skip-unresolved",
        }
    }

    fn resolution_name(resolution: LinkResolutionStatus) -> &'static str {
        match resolution {
            LinkResolutionStatus::Resolved => "resolved",
            LinkResolutionStatus::Unresolved => "unresolved",
            LinkResolutionStatus::Ambiguous => "ambiguous",
            LinkResolutionStatus::External => "external",
        }
    }
}
