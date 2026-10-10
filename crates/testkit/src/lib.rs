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

#[cfg(test)]
mod existing_vault_no_op_tests {
    use openobsidian_vault::{
        LinkKind, LinkResolutionStatus, VaultNoteEmbedDisposition, VaultRoot, VaultSnapshot,
    };
    use serde_json::Value;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    const EXISTING_VAULT_FIXTURE: &str = include_str!("../../../fixtures/existing-vault.json");
    static NEXT_TEMP_DIR_ID: AtomicU64 = AtomicU64::new(0);

    struct ExistingVaultTempDir(PathBuf);

    impl ExistingVaultTempDir {
        fn new() -> Self {
            let root = std::env::temp_dir();
            loop {
                let id = NEXT_TEMP_DIR_ID.fetch_add(1, Ordering::Relaxed);
                let path = root.join(format!(
                    "openobsidian-testkit-existing-vault-{}-{id}",
                    std::process::id()
                ));
                match fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => {
                        panic!(
                            "creating existing-vault test directory {}: {error}",
                            path.display()
                        )
                    }
                }
            }
        }
    }

    impl Drop for ExistingVaultTempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn fixture_bytes(file: &Value) -> Vec<u8> {
        if let Some(source) = file["source"].as_str() {
            return source.as_bytes().to_vec();
        }
        file["bytes"]
            .as_array()
            .expect("binary fixture file must contain byte values")
            .iter()
            .map(|value| {
                u8::try_from(
                    value
                        .as_u64()
                        .expect("binary fixture values must be unsigned"),
                )
                .expect("binary fixture values must fit in one byte")
            })
            .collect()
    }

    fn materialize_fixture(root: &Path, fixture: &Value) {
        for file in fixture["files"]
            .as_array()
            .expect("existing-vault fixture must list its files")
        {
            let relative_path = PathBuf::from(
                file["relative_path"]
                    .as_str()
                    .expect("fixture file must have a relative path"),
            );
            assert!(relative_path.is_relative());
            assert!(
                relative_path
                    .components()
                    .all(|component| { !matches!(component, std::path::Component::ParentDir) })
            );
            let path = root.join(relative_path);
            fs::create_dir_all(path.parent().expect("fixture file must have a parent"))
                .expect("create existing-vault fixture parents");
            fs::write(path, fixture_bytes(file)).expect("write existing-vault fixture bytes");
        }
    }

    fn append_tree(root: &Path, directory: &Path, entries: &mut Vec<(String, u8, Vec<u8>)>) {
        let mut children = fs::read_dir(directory)
            .expect("read existing-vault fixture directory")
            .map(|entry| entry.expect("read existing-vault fixture entry"))
            .collect::<Vec<_>>();
        children.sort_by_key(std::fs::DirEntry::file_name);

        for child in children {
            let path = child.path();
            let relative_path = path
                .strip_prefix(root)
                .expect("fixture path must remain under its root")
                .to_string_lossy()
                .replace('\\', "/");
            let file_type = child
                .file_type()
                .expect("inspect existing-vault fixture entry type");
            if file_type.is_dir() {
                entries.push((relative_path, 0, Vec::new()));
                append_tree(root, &path, entries);
            } else if file_type.is_file() {
                entries.push((
                    relative_path,
                    1,
                    fs::read(path).expect("read existing-vault fixture file bytes"),
                ));
            } else {
                panic!("existing-vault fixture contains an unsupported filesystem entry");
            }
        }
    }

    fn tree_snapshot(root: &Path) -> Vec<(String, u8, Vec<u8>)> {
        let mut entries = Vec::new();
        append_tree(root, root, &mut entries);
        entries.sort_by(|left, right| left.0.cmp(&right.0));
        entries
    }

    fn assert_unchanged(
        vault: &VaultRoot,
        root: &Path,
        expected_snapshot: &VaultSnapshot,
        expected_tree: &[(String, u8, Vec<u8>)],
    ) {
        assert_eq!(
            &vault
                .snapshot()
                .expect("snapshot after a read-only operation"),
            expected_snapshot
        );
        assert_eq!(tree_snapshot(root), expected_tree);
    }

    fn link_kind_name(kind: LinkKind) -> &'static str {
        match kind {
            LinkKind::WikiLink => "wiki",
            LinkKind::Markdown => "markdown",
            LinkKind::Embed => "embed",
        }
    }

    fn resolution_name(status: LinkResolutionStatus) -> &'static str {
        match status {
            LinkResolutionStatus::Resolved => "resolved",
            LinkResolutionStatus::Unresolved => "unresolved",
            LinkResolutionStatus::Ambiguous => "ambiguous",
            LinkResolutionStatus::External => "external",
        }
    }

    #[test]
    fn c01_existing_vault_read_only_operations_preserve_every_path_and_byte() {
        let fixture: Value = serde_json::from_str(EXISTING_VAULT_FIXTURE)
            .expect("existing-vault fixture must be valid JSON");
        assert_eq!(fixture["id"], "fixture:existing-vault");

        let temporary = ExistingVaultTempDir::new();
        let vault_path = temporary.0.join("vault");
        fs::create_dir(&vault_path).expect("create existing-vault fixture root");
        materialize_fixture(&vault_path, &fixture);
        let before_tree = tree_snapshot(&vault_path);
        let expected_tree_paths = fixture["expected"]["tree_paths"]
            .as_array()
            .expect("fixture must list every path")
            .iter()
            .map(|path| path.as_str().expect("fixture path must be text").to_owned())
            .collect::<Vec<_>>();
        assert_eq!(
            before_tree
                .iter()
                .map(|(path, _, _)| path.clone())
                .collect::<Vec<_>>(),
            expected_tree_paths
        );

        let vault = VaultRoot::open(&vault_path).expect("open existing fixture vault");
        let before_snapshot = vault.snapshot().expect("snapshot fixture before reads");
        assert_eq!(tree_snapshot(&vault_path), before_tree);
        let markdown_paths = vault
            .scan_markdown()
            .expect("scan existing Markdown files")
            .into_iter()
            .map(|entry| entry.relative_path.to_string_lossy().replace('\\', "/"))
            .collect::<Vec<_>>();
        let expected_markdown_paths = fixture["expected"]["markdown_paths"]
            .as_array()
            .expect("fixture must list Markdown paths")
            .iter()
            .map(|path| {
                path.as_str()
                    .expect("Markdown path must be text")
                    .to_owned()
            })
            .collect::<Vec<_>>();
        assert_eq!(markdown_paths, expected_markdown_paths);
        assert_unchanged(&vault, &vault_path, &before_snapshot, &before_tree);

        let revision_path = fixture["expected"]["revision_path"]
            .as_str()
            .expect("fixture must identify its revision note");
        for relative_path in &markdown_paths {
            let read = vault
                .read(relative_path)
                .unwrap_or_else(|error| panic!("read existing note {relative_path}: {error}"));
            let source = fixture["files"]
                .as_array()
                .unwrap()
                .iter()
                .find(|file| file["relative_path"].as_str() == Some(relative_path.as_str()))
                .map(fixture_bytes)
                .expect("every scanned note must be present in the fixture");
            assert_eq!(read.document.as_bytes(), source);
            if relative_path == revision_path {
                assert_eq!(
                    read.revision_sha256,
                    fixture["expected"]["revision_sha256"]
                        .as_str()
                        .expect("fixture must record the note SHA-256")
                );
            }
            assert_unchanged(&vault, &vault_path, &before_snapshot, &before_tree);
        }

        let operations = &fixture["expected"]["read_only_operations"];
        let link_source = operations["link_source"]
            .as_str()
            .expect("fixture must identify the link source note");
        let links = vault
            .resolve_links_for_note(link_source)
            .expect("resolve links through the existing vault snapshot");
        let expected_links = operations["links"]
            .as_array()
            .expect("fixture must state expected link resolutions");
        assert_eq!(links.len(), expected_links.len());
        for (actual, expected) in links.iter().zip(expected_links) {
            assert_eq!(
                link_kind_name(actual.reference.kind),
                expected["kind"]
                    .as_str()
                    .expect("fixture must state link kind")
            );
            assert_eq!(
                actual.reference.target,
                expected["target"]
                    .as_str()
                    .expect("fixture must state link target")
            );
            assert_eq!(
                actual.reference.alias.as_deref(),
                expected["alias"].as_str()
            );
            assert_eq!(
                actual.reference.subpath.as_deref(),
                expected["subpath"].as_str()
            );
            assert_eq!(
                resolution_name(actual.resolution.status),
                expected["status"]
                    .as_str()
                    .expect("fixture must state resolution status")
            );
            assert_eq!(
                actual.resolution.target.as_deref(),
                expected["resolved_path"].as_str()
            );
        }
        assert_unchanged(&vault, &vault_path, &before_snapshot, &before_tree);

        let embeds = vault
            .resolve_note_embeds_for_note(link_source)
            .expect("resolve note embeds from the existing vault");
        let expected_embed_count = usize::try_from(
            operations["embed_count"]
                .as_u64()
                .expect("fixture must state the embed count"),
        )
        .expect("embed count must fit usize");
        assert_eq!(embeds.embeds.len(), expected_embed_count);
        assert!(!embeds.truncated);
        assert_eq!(embeds.snapshot_sha256, before_snapshot.revision_sha256);
        assert!(matches!(
            &embeds.embeds[0].resolution.disposition,
            VaultNoteEmbedDisposition::Included(_)
        ));
        assert_eq!(
            resolution_name(embeds.embeds[0].resolution.resolution.status),
            expected_links[1]["status"]
                .as_str()
                .expect("fixture must state embed resolution status")
        );
        assert_eq!(
            embeds.embeds[0].resolution.resolution.target.as_deref(),
            expected_links[1]["resolved_path"].as_str()
        );
        assert_unchanged(&vault, &vault_path, &before_snapshot, &before_tree);

        let rename = &operations["rename_preview"];
        let preview = vault
            .build_rename_preview(
                rename["old_path"]
                    .as_str()
                    .expect("fixture must state the old rename path"),
                rename["new_path"]
                    .as_str()
                    .expect("fixture must state the new rename path"),
            )
            .expect("prepare read-only rename preview");
        assert_eq!(
            preview.plan.update_count,
            usize::try_from(
                rename["update_count"]
                    .as_u64()
                    .expect("fixture must state the preview update count")
            )
            .expect("preview update count must fit usize")
        );
        assert_unchanged(&vault, &vault_path, &before_snapshot, &before_tree);
        vault
            .verify_rename_preview(&preview)
            .expect("revalidate read-only rename preview");
        assert_unchanged(&vault, &vault_path, &before_snapshot, &before_tree);
    }
}

#[cfg(test)]
mod c02_byte_roundtrip_fixture_tests {
    use openobsidian_doc::{MarkdownPropertyEditError, MarkdownSource};
    use serde_json::Value;

    const C02_BYTE_ROUNDTRIP_FIXTURE: &str =
        include_str!("../../../fixtures/c02-byte-roundtrip.json");

    #[test]
    fn c02_markdown_property_edits_change_only_fixture_approved_bytes() {
        let fixture: Value = serde_json::from_str(C02_BYTE_ROUNDTRIP_FIXTURE)
            .expect("C02 byte-roundtrip fixture must be valid JSON");
        assert_eq!(fixture["schema_version"], 1);
        assert_eq!(fixture["id"], "fixture:c02-byte-roundtrip");
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
            let case_id = case["id"].as_str().expect("fixture case must have an id");
            let before = case["before"]
                .as_str()
                .expect("fixture case must have source bytes");
            let after = case["after"]
                .as_str()
                .expect("fixture case must have expected source bytes");
            let key = case["edit"]["key"]
                .as_str()
                .expect("fixture edit must name a property");
            let raw_value = case["edit"]["raw_value"]
                .as_str()
                .expect("fixture edit must name a raw value");
            let span = &case["approved_span"];
            let start = usize::try_from(
                span["start_byte"]
                    .as_u64()
                    .expect("fixture approved span must state its byte offset"),
            )
            .expect("fixture byte offset must fit usize");
            let deleted = span["delete"]
                .as_str()
                .expect("fixture approved span must state deleted bytes")
                .as_bytes();
            let inserted = span["insert"]
                .as_str()
                .expect("fixture approved span must state inserted bytes")
                .as_bytes();
            let before_bytes = before.as_bytes();
            assert_eq!(
                before_bytes.get(start..start + deleted.len()),
                Some(deleted),
                "{case_id}: approved span must match the source bytes"
            );

            let source = MarkdownSource::parse(before_bytes.to_vec())
                .unwrap_or_else(|error| panic!("{case_id}: fixture must be UTF-8: {error}"));
            let rendered = source
                .render_property_edit(key, raw_value)
                .unwrap_or_else(|error| panic!("{case_id}: render property edit: {error}"));
            assert_eq!(rendered, after.as_bytes(), "{case_id}: exact output bytes");
            assert_eq!(
                rendered.get(..start),
                before_bytes.get(..start),
                "{case_id}: bytes before the approved span must remain identical"
            );
            assert_eq!(
                rendered.get(start + inserted.len()..),
                before_bytes.get(start + deleted.len()..),
                "{case_id}: bytes after the approved span must remain identical"
            );
        }
    }

    #[test]
    fn c02_markdown_property_edit_rejects_unrepresented_and_multiline_values() {
        let source = MarkdownSource::parse(b"---\r\nstatus: open\r\n---\r\n".to_vec()).unwrap();
        assert_eq!(
            source.render_property_edit("missing", "value"),
            Err(MarkdownPropertyEditError::PropertyNotRepresented)
        );
        assert_eq!(
            source.render_property_edit("status", "first\nsecond"),
            Err(MarkdownPropertyEditError::MultilineValue)
        );

        let block_scalar =
            MarkdownSource::parse(b"---\nsummary: |\n  retained block\n---\n".to_vec())
                .unwrap();
        assert_eq!(
            block_scalar.render_property_edit("summary", "inline"),
            Err(MarkdownPropertyEditError::StructuredValue)
        );
    }
}
