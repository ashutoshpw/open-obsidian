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
    use openobsidian_vault::VaultStore;
    use serde_json::Value;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    const RENAME_PLAN_FIXTURE: &str = include_str!("../../../fixtures/rename-plan.json");
    static NEXT_TEMP_DIR_ID: AtomicU64 = AtomicU64::new(0);

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let temp_root = std::env::temp_dir();
            loop {
                let id = NEXT_TEMP_DIR_ID.fetch_add(1, Ordering::Relaxed);
                let path = temp_root.join(format!(
                    "openobsidian-testkit-rename-{}-{id}",
                    std::process::id()
                ));
                match fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("creating test directory {}: {error}", path.display()),
                }
            }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

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
        assert!(
            fixture["invariants"]
                .as_object()
                .expect("fixture invariants must be an object")
                .values()
                .all(|value| value.as_bool() == Some(true))
        );

        let cases = fixture["cases"]
            .as_array()
            .expect("fixture cases must be an array");
        assert!(!cases.is_empty());

        for case in cases {
            let case_id = case["id"].as_str().expect("fixture case must have an id");
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
                    expected["source_path"]
                        .as_str()
                        .expect("fixture source path"),
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
                plan.warnings.iter().map(String::as_str).collect::<Vec<_>>(),
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

    #[test]
    fn c03_rename_move_fixture_matches_vault_store_apply_bytes_and_journal() {
        let fixture: Value = serde_json::from_str(RENAME_PLAN_FIXTURE)
            .expect("rename-plan fixture must be valid JSON");
        let cases = fixture["cases"]
            .as_array()
            .expect("fixture cases must be an array");

        for case in cases {
            let case_id = case["id"].as_str().expect("fixture case must have an id");
            let old_path = PathBuf::from(
                case["old_path"]
                    .as_str()
                    .expect("fixture case must have an old path"),
            );
            let new_path = PathBuf::from(
                case["new_path"]
                    .as_str()
                    .expect("fixture case must have a new path"),
            );
            let temporary = TempDir::new();
            let vault_path = temporary.0.join("vault");
            let app_data_path = temporary.0.join("app-data");
            fs::create_dir(&vault_path).expect("create fixture vault");
            fs::create_dir(&app_data_path).expect("create fixture application data");

            for file in case["files"]
                .as_array()
                .expect("fixture files must be an array")
            {
                let relative_path = Path::new(
                    file["relative_path"]
                        .as_str()
                        .expect("fixture file must have a relative path"),
                );
                let path = vault_path.join(relative_path);
                fs::create_dir_all(path.parent().expect("fixture file has a parent"))
                    .expect("create fixture file parents");
                fs::write(
                    path,
                    file["source"]
                        .as_str()
                        .expect("fixture file must have source text")
                        .as_bytes(),
                )
                .expect("write fixture source");
            }
            fs::create_dir_all(
                vault_path
                    .join(&new_path)
                    .parent()
                    .expect("rename destination must have a parent"),
            )
            .expect("create rename destination parent");

            let store = VaultStore::open(&vault_path, &app_data_path)
                .unwrap_or_else(|error| panic!("{case_id}: open fixture vault: {error}"));
            let preview = store
                .root()
                .build_rename_preview(&old_path, &new_path)
                .unwrap_or_else(|error| panic!("{case_id}: build rename preview: {error}"));
            let result = store
                .apply_rename_preview(&preview)
                .unwrap_or_else(|error| panic!("{case_id}: apply rename preview: {error}"));

            assert_eq!(
                result.updated_references,
                usize::try_from(
                    case["expected_update_count"]
                        .as_u64()
                        .expect("fixture must state expected update count"),
                )
                .expect("fixture update count must fit usize"),
                "{case_id}: applied reference count"
            );
            assert_eq!(
                result.skipped_references,
                usize::try_from(
                    case["expected_skipped_count"]
                        .as_u64()
                        .expect("fixture must state expected skipped count"),
                )
                .expect("fixture skipped count must fit usize"),
                "{case_id}: skipped reference count"
            );
            let expected_warnings: Vec<&str> = case["expected_warnings"]
                .as_array()
                .expect("fixture expected warnings must be an array")
                .iter()
                .map(|warning| warning.as_str().expect("fixture warning must be text"))
                .collect();
            assert_eq!(
                result
                    .warnings
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>(),
                expected_warnings,
                "{case_id}: applied warning list"
            );

            let expected_sources = case["expected_sources"]
                .as_object()
                .expect("fixture expected sources must be an object");
            for (relative_path, expected) in expected_sources {
                let relative_path = Path::new(relative_path);
                let actual_relative_path: &Path = if relative_path == old_path.as_path() {
                    new_path.as_path()
                } else {
                    relative_path
                };
                let expected_bytes = expected
                    .as_str()
                    .expect("fixture expected source must be text")
                    .as_bytes();
                assert_eq!(
                    fs::read(vault_path.join(actual_relative_path)).unwrap_or_else(|error| {
                        panic!("{case_id}/{actual_relative_path:?}: {error}")
                    }),
                    expected_bytes,
                    "{case_id}/{actual_relative_path:?}: applied bytes"
                );
            }
            assert!(
                !vault_path.join(old_path).exists(),
                "{case_id}: old source path must be gone after apply"
            );
            assert_eq!(
                result.read.document.as_bytes(),
                fs::read(vault_path.join(&new_path))
                    .expect("renamed note must remain readable")
                    .as_slice(),
                "{case_id}: returned renamed note bytes"
            );

            let journal = fs::read_to_string(app_data_path.join("journal.jsonl"))
                .expect("rename apply must write its journal");
            assert!(
                journal.contains("\"operation\":\"rename\",\"state\":\"prepared\""),
                "{case_id}: journal must record preparation"
            );
            assert!(
                journal.contains("\"operation\":\"rename\",\"state\":\"committed\""),
                "{case_id}: journal must record commit"
            );
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

#[cfg(test)]
mod link_resolution_fixture_tests {
    use openobsidian_doc::{
        LinkKind, LinkResolutionStatus, MarkdownSource, resolve_link_with_sources,
    };
    use openobsidian_vault::VaultRoot;
    use serde_json::Value;
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    const LINK_RESOLUTION_FIXTURE: &str = include_str!("../../../fixtures/link-resolution.json");
    static NEXT_TEMP_DIR_ID: AtomicU64 = AtomicU64::new(0);

    struct LinkFixtureTempDir(PathBuf);

    impl LinkFixtureTempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "openobsidian-testkit-link-resolution-{}-{}",
                std::process::id(),
                NEXT_TEMP_DIR_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).expect("create link-resolution fixture temp directory");
            Self(path)
        }
    }

    impl Drop for LinkFixtureTempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn c03_link_forms_fixture_matches_source_aware_resolution() {
        let fixture: Value = serde_json::from_str(LINK_RESOLUTION_FIXTURE)
            .expect("link-resolution fixture must be valid JSON");
        assert_eq!(fixture["schema_version"], 1);
        assert_eq!(fixture["id"], "fixture:c03-link-forms");
        assert!(
            fixture["invariants"]
                .as_object()
                .expect("fixture invariants must be an object")
                .values()
                .all(|value| value.as_bool() == Some(true))
        );

        let cases = fixture["cases"]
            .as_array()
            .expect("fixture cases must be an array");
        assert!(!cases.is_empty());

        for case in cases {
            let case_id = case["id"].as_str().expect("fixture case must have an id");
            let current_path = case["current_path"]
                .as_str()
                .expect("fixture case must identify the current note");
            let file_cases = case["files"]
                .as_array()
                .expect("fixture files must be an array");
            let mut files = Vec::with_capacity(file_cases.len());
            let mut sources = HashMap::new();

            for file in file_cases {
                let path = file["path"]
                    .as_str()
                    .expect("fixture file must have a path")
                    .to_owned();
                files.push(path.clone());
                if let Some(source_text) = file["source"].as_str() {
                    let source = MarkdownSource::parse(source_text.as_bytes().to_vec())
                        .unwrap_or_else(|error| panic!("{case_id}/{path}: {error}"));
                    sources.insert(path, source);
                }
            }

            let current_source = sources
                .get(current_path)
                .expect("fixture current note must have Markdown source");
            let original_bytes = current_source.as_bytes().to_vec();
            let references = current_source.extract_links();
            let expected_references = case["expected_references"]
                .as_array()
                .expect("fixture must state expected references");
            assert_eq!(
                references.len(),
                expected_references.len(),
                "{case_id}: reference count"
            );

            for (reference, expected) in references.iter().zip(expected_references) {
                assert_eq!(
                    reference.raw,
                    expected["raw"].as_str().expect("expected raw reference"),
                    "{case_id}: raw reference"
                );
                assert_eq!(
                    link_kind_name(reference.kind),
                    expected["kind"].as_str().expect("expected link kind"),
                    "{case_id}/{}: kind",
                    reference.raw
                );
                assert_eq!(
                    reference.target,
                    expected["target"].as_str().expect("expected link target"),
                    "{case_id}/{}: target",
                    reference.raw
                );
                assert_eq!(
                    reference.alias.as_deref(),
                    expected["alias"].as_str(),
                    "{case_id}/{}: alias",
                    reference.raw
                );
                assert_eq!(
                    reference.subpath.as_deref(),
                    expected["subpath"].as_str(),
                    "{case_id}/{}: subpath",
                    reference.raw
                );

                let resolution =
                    resolve_link_with_sources(reference, &files, current_path, &sources);
                assert_eq!(
                    resolution_name(resolution.status),
                    expected["status"]
                        .as_str()
                        .expect("expected resolution status"),
                    "{case_id}/{}: status",
                    reference.raw
                );
                assert_eq!(
                    resolution.target.as_deref(),
                    expected["resolved_path"].as_str(),
                    "{case_id}/{}: resolved path",
                    reference.raw
                );
                let expected_candidates = expected["candidates"]
                    .as_array()
                    .expect("fixture must state resolution candidates")
                    .iter()
                    .map(|candidate| {
                        candidate
                            .as_str()
                            .expect("candidate path must be text")
                            .to_owned()
                    })
                    .collect::<Vec<_>>();
                assert_eq!(
                    resolution.candidates, expected_candidates,
                    "{case_id}/{}: candidates",
                    reference.raw
                );
            }

            assert_eq!(
                sources.get(current_path).unwrap().as_bytes(),
                original_bytes,
                "{case_id}: resolution must not modify source bytes"
            );
        }
    }

    #[test]
    fn c03_link_forms_fixture_resolves_through_the_confined_vault_snapshot() {
        let fixture: Value = serde_json::from_str(LINK_RESOLUTION_FIXTURE)
            .expect("link-resolution fixture must be valid JSON");
        let cases = fixture["cases"]
            .as_array()
            .expect("fixture cases must be an array");

        for case in cases {
            let case_id = case["id"].as_str().expect("fixture case must have an id");
            let current_path = case["current_path"]
                .as_str()
                .expect("fixture must identify the current note");
            let temporary = LinkFixtureTempDir::new();
            let vault_path = temporary.0.join("vault");
            fs::create_dir(&vault_path).expect("create fixture vault");
            let mut original_files = Vec::new();

            for file in case["files"]
                .as_array()
                .expect("fixture files must be an array")
            {
                let relative_path = PathBuf::from(
                    file["path"]
                        .as_str()
                        .expect("fixture file must have a path"),
                );
                let source = file["source"].as_str().unwrap_or("").as_bytes().to_vec();
                let path = vault_path.join(&relative_path);
                fs::create_dir_all(path.parent().unwrap()).expect("create fixture parents");
                fs::write(&path, &source).expect("write fixture bytes");
                original_files.push((relative_path, source));
            }

            let root = VaultRoot::open(&vault_path)
                .unwrap_or_else(|error| panic!("{case_id}: open fixture vault: {error}"));
            let before = root
                .snapshot()
                .unwrap_or_else(|error| panic!("{case_id}: snapshot fixture vault: {error}"));
            let resolved = root
                .resolve_links_for_note(current_path)
                .unwrap_or_else(|error| panic!("{case_id}: resolve fixture links: {error}"));
            let expected_references = case["expected_references"]
                .as_array()
                .expect("fixture must state expected references");
            assert_eq!(
                resolved.len(),
                expected_references.len(),
                "{case_id}: resolved reference count"
            );

            for (actual, expected) in resolved.iter().zip(expected_references) {
                assert_eq!(
                    actual.reference.raw,
                    expected["raw"].as_str().expect("expected raw reference"),
                    "{case_id}: raw reference"
                );
                assert_eq!(
                    link_kind_name(actual.reference.kind),
                    expected["kind"].as_str().expect("expected link kind"),
                    "{case_id}/{}: kind",
                    actual.reference.raw
                );
                assert_eq!(
                    actual.reference.target,
                    expected["target"].as_str().expect("expected link target"),
                    "{case_id}/{}: target",
                    actual.reference.raw
                );
                assert_eq!(
                    actual.reference.alias.as_deref(),
                    expected["alias"].as_str(),
                    "{case_id}/{}: alias",
                    actual.reference.raw
                );
                assert_eq!(
                    actual.reference.subpath.as_deref(),
                    expected["subpath"].as_str(),
                    "{case_id}/{}: subpath",
                    actual.reference.raw
                );
                assert_eq!(
                    resolution_name(actual.resolution.status),
                    expected["status"]
                        .as_str()
                        .expect("expected resolution status"),
                    "{case_id}/{}: status",
                    actual.reference.raw
                );
                assert_eq!(
                    actual.resolution.target.as_deref(),
                    expected["resolved_path"].as_str(),
                    "{case_id}/{}: target path",
                    actual.reference.raw
                );
                let expected_candidates = expected["candidates"]
                    .as_array()
                    .expect("fixture must state candidate paths")
                    .iter()
                    .map(|candidate| {
                        candidate
                            .as_str()
                            .expect("candidate path must be text")
                            .to_owned()
                    })
                    .collect::<Vec<_>>();
                assert_eq!(
                    actual.resolution.candidates, expected_candidates,
                    "{case_id}/{}: candidate paths",
                    actual.reference.raw
                );
            }

            assert_eq!(
                root.snapshot().unwrap_or_else(|error| panic!(
                    "{case_id}: re-snapshot fixture vault: {error}"
                )),
                before,
                "{case_id}: resolution must not change the vault snapshot"
            );
            for (relative_path, original) in &original_files {
                assert_eq!(
                    fs::read(vault_path.join(relative_path)).unwrap(),
                    *original,
                    "{case_id}: resolution must preserve {}",
                    relative_path.display()
                );
            }
        }
    }

    fn link_kind_name(kind: LinkKind) -> &'static str {
        match kind {
            LinkKind::WikiLink => "wiki",
            LinkKind::Markdown => "markdown",
            LinkKind::Embed => "embed",
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
