use super::{VaultError, VaultStore, normalize_relative_path};
use serde_json::Value;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const HISTORY_CATEGORIES: [VaultHistoryKind; 3] = [
    VaultHistoryKind::Recovery,
    VaultHistoryKind::Failed,
    VaultHistoryKind::Conflict,
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VaultHistoryKind {
    Recovery,
    Failed,
    Conflict,
}

impl VaultHistoryKind {
    fn directory(self) -> &'static str {
        match self {
            Self::Recovery => "recovery",
            Self::Failed => "failed",
            Self::Conflict => "conflicts",
        }
    }

    fn artifact_extension(self) -> &'static str {
        match self {
            Self::Recovery | Self::Failed => ".bin",
            Self::Conflict => ".incoming",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultHistoryRecord {
    pub id: String,
    pub relative_path: PathBuf,
    pub revision_sha256: String,
    pub bytes: u64,
    pub captured_at: SystemTime,
    pub kind: VaultHistoryKind,
    pub protected: bool,
    pub expected_revision_sha256: Option<String>,
    pub current_revision_sha256: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct VaultHistoryPolicy {
    pub max_age_days: u64,
    pub max_bytes: u64,
}

impl VaultHistoryPolicy {
    pub const DEFAULT: Self = Self {
        max_age_days: 30,
        max_bytes: 5 * 1024 * 1024 * 1024,
    };
}

impl Default for VaultHistoryPolicy {
    fn default() -> Self {
        Self::DEFAULT
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct VaultHistoryPlan {
    pub retained: Vec<VaultHistoryRecord>,
    pub pruneable: Vec<VaultHistoryRecord>,
    pub protected: Vec<VaultHistoryRecord>,
    pub retained_bytes: u64,
    pub pruneable_bytes: u64,
    pub warning: bool,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct VaultHistoryCleanup {
    pub removed: Vec<String>,
    pub protected: Vec<String>,
    pub warning: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VaultConflictAction {
    KeepCurrent,
    KeepIncoming,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultConflictRead {
    pub record: VaultHistoryRecord,
    pub bytes: Vec<u8>,
    pub revision_sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultConflictResolution {
    pub id: String,
    pub relative_path: PathBuf,
    pub action: VaultConflictAction,
    pub read: Option<super::VaultRead>,
}

/// Plan age- and size-based retention without modifying history files.
/// Protected records are retained even when that exceeds the configured cap.
pub fn plan_history_retention(
    records: &[VaultHistoryRecord],
    policy: VaultHistoryPolicy,
    now: SystemTime,
) -> VaultHistoryPlan {
    let age = Duration::from_secs(policy.max_age_days.saturating_mul(24 * 60 * 60));
    let cutoff = now.checked_sub(age).unwrap_or(UNIX_EPOCH);
    let mut sorted = records.to_vec();
    sorted.sort_by(|left, right| {
        right
            .captured_at
            .cmp(&left.captured_at)
            .then_with(|| left.id.cmp(&right.id))
    });

    let mut plan = VaultHistoryPlan::default();
    let mut protected_bytes = 0_u64;
    for record in sorted {
        let within_budget = plan.retained_bytes.saturating_add(record.bytes) <= policy.max_bytes;
        if record.protected || (record.captured_at >= cutoff && within_budget) {
            plan.retained_bytes = plan.retained_bytes.saturating_add(record.bytes);
            if record.protected {
                protected_bytes = protected_bytes.saturating_add(record.bytes);
                plan.protected.push(record.clone());
            }
            plan.retained.push(record);
        } else {
            plan.pruneable_bytes = plan.pruneable_bytes.saturating_add(record.bytes);
            plan.pruneable.push(record);
        }
    }
    plan.warning = protected_bytes > policy.max_bytes;
    plan
}

impl VaultStore {
    /// List validated recovery, failed-write and conflict records outside the vault.
    pub fn history_records(&self) -> Result<Vec<VaultHistoryRecord>, VaultError> {
        let mut records = Vec::new();
        for kind in HISTORY_CATEGORIES {
            let Some(directory) = managed_history_directory(&self.app_data_root, kind)? else {
                continue;
            };
            for entry in fs::read_dir(&directory)? {
                let entry = entry?;
                let path = entry.path();
                if path.extension() != Some(OsStr::new("json")) {
                    continue;
                }
                let metadata = fs::symlink_metadata(&path)?;
                if metadata.file_type().is_symlink() || !metadata.is_file() {
                    return Err(VaultError::InvalidHistoryRecord(path));
                }
                records.push(read_history_record(&directory, &path, kind)?);
            }
        }
        records.sort_by(|left, right| {
            right
                .captured_at
                .cmp(&left.captured_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(records)
    }

    /// Return a fresh retention plan. This method is read-only.
    pub fn history_retention_plan(
        &self,
        policy: VaultHistoryPolicy,
        now: SystemTime,
    ) -> Result<VaultHistoryPlan, VaultError> {
        let records = self.history_records()?;
        Ok(plan_history_retention(&records, policy, now))
    }

    /// Remove only pruneable records after an explicit caller request.
    /// Conflict records and any other protected records are never removed.
    pub fn cleanup_history(
        &self,
        policy: VaultHistoryPolicy,
    ) -> Result<VaultHistoryCleanup, VaultError> {
        self.cleanup_history_at(policy, SystemTime::now())
    }

    fn cleanup_history_at(
        &self,
        policy: VaultHistoryPolicy,
        now: SystemTime,
    ) -> Result<VaultHistoryCleanup, VaultError> {
        let plan = self.history_retention_plan(policy, now)?;
        let mut removed = Vec::with_capacity(plan.pruneable.len());
        for record in &plan.pruneable {
            self.remove_history_record(record)?;
            removed.push(record.id.clone());
        }
        Ok(VaultHistoryCleanup {
            removed,
            protected: plan
                .protected
                .iter()
                .map(|record| record.id.clone())
                .collect(),
            warning: plan.warning,
        })
    }

    /// Read the incoming bytes of one validated conflict without changing the vault.
    pub fn read_conflict(
        &self,
        id: &str,
        relative_path: impl AsRef<Path>,
    ) -> Result<VaultConflictRead, VaultError> {
        let record = self.conflict_record(id, relative_path.as_ref())?;
        let directory = managed_history_directory(&self.app_data_root, VaultHistoryKind::Conflict)?
            .ok_or_else(|| VaultError::InvalidHistoryRecord(PathBuf::from(id)))?;
        let metadata_path = directory.join(format!("{}.json", record.id));
        let current = read_history_record(&directory, &metadata_path, VaultHistoryKind::Conflict)?;
        if current != record {
            return Err(VaultError::InvalidHistoryRecord(metadata_path));
        }
        let artifact_path = directory.join(format!("{}.incoming", record.id));
        let artifact_metadata = fs::symlink_metadata(&artifact_path)?;
        if artifact_metadata.file_type().is_symlink()
            || !artifact_metadata.is_file()
            || artifact_metadata.len() != record.bytes
        {
            return Err(VaultError::InvalidHistoryRecord(artifact_path));
        }
        let bytes = fs::read(&artifact_path)?;
        if bytes.len() as u64 != record.bytes {
            return Err(VaultError::InvalidHistoryRecord(artifact_path));
        }
        let revision_sha256 = super::sha256_hex(&bytes);
        Ok(VaultConflictRead {
            record,
            bytes,
            revision_sha256,
        })
    }

    /// Resolve a conflict only after the caller explicitly chooses which version to keep.
    /// Keeping incoming bytes still uses the recorded current revision as a write precondition.
    pub fn resolve_conflict(
        &self,
        id: &str,
        relative_path: impl AsRef<Path>,
        action: VaultConflictAction,
    ) -> Result<VaultConflictResolution, VaultError> {
        let conflict = self.read_conflict(id, relative_path)?;
        let read = match action {
            VaultConflictAction::KeepCurrent => None,
            VaultConflictAction::KeepIncoming => {
                let current = match self.root.read(&conflict.record.relative_path) {
                    Ok(read) => Some(read),
                    Err(VaultError::Root(error))
                        if error.kind() == std::io::ErrorKind::NotFound =>
                    {
                        None
                    }
                    Err(error) => return Err(error),
                };
                if current
                    .as_ref()
                    .is_some_and(|read| read.revision_sha256 == conflict.revision_sha256)
                {
                    current
                } else {
                    Some(
                        self.write(super::VaultWriteRequest {
                            relative_path: conflict.record.relative_path.clone(),
                            expected_revision_sha256: conflict
                                .record
                                .current_revision_sha256
                                .clone(),
                            bytes: conflict.bytes,
                        })?
                        .read,
                    )
                }
            }
        };
        self.remove_resolved_conflict(&conflict.record)?;
        Ok(VaultConflictResolution {
            id: conflict.record.id,
            relative_path: conflict.record.relative_path,
            action,
            read,
        })
    }

    fn conflict_record(
        &self,
        id: &str,
        relative_path: &Path,
    ) -> Result<VaultHistoryRecord, VaultError> {
        let relative_path = normalize_relative_path(relative_path)?;
        self.history_records()?
            .into_iter()
            .find(|record| {
                record.kind == VaultHistoryKind::Conflict
                    && record.id == id
                    && record.relative_path == relative_path
            })
            .ok_or_else(|| VaultError::InvalidHistoryRecord(PathBuf::from(id)))
    }

    fn remove_history_record(&self, record: &VaultHistoryRecord) -> Result<(), VaultError> {
        if record.protected {
            return Err(VaultError::InvalidHistoryRecord(PathBuf::from(
                record.id.as_str(),
            )));
        }
        self.remove_validated_history_record(record)
    }

    fn remove_resolved_conflict(&self, record: &VaultHistoryRecord) -> Result<(), VaultError> {
        if record.kind != VaultHistoryKind::Conflict || !record.protected {
            return Err(VaultError::InvalidHistoryRecord(PathBuf::from(
                record.id.as_str(),
            )));
        }
        self.remove_validated_history_record(record)
    }

    fn remove_validated_history_record(
        &self,
        record: &VaultHistoryRecord,
    ) -> Result<(), VaultError> {
        let directory = managed_history_directory(&self.app_data_root, record.kind)?
            .ok_or_else(|| VaultError::InvalidHistoryRecord(PathBuf::from(record.id.as_str())))?;
        let artifact_path =
            directory.join(format!("{}{}", record.id, record.kind.artifact_extension()));
        let metadata_path = directory.join(format!("{}.json", record.id));
        for path in [&artifact_path, &metadata_path] {
            match fs::symlink_metadata(path) {
                Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                    return Err(VaultError::InvalidHistoryRecord(path.to_path_buf()));
                }
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    return Err(VaultError::InvalidHistoryRecord(path.to_path_buf()));
                }
                Err(error) => return Err(error.into()),
            }
        }
        let current = read_history_record(&directory, &metadata_path, record.kind)?;
        if &current != record {
            return Err(VaultError::InvalidHistoryRecord(metadata_path));
        }
        fs::remove_file(&artifact_path)?;
        fs::remove_file(&metadata_path)?;
        Ok(())
    }
}

fn managed_history_directory(
    app_data_root: &Path,
    kind: VaultHistoryKind,
) -> Result<Option<PathBuf>, VaultError> {
    let path = app_data_root.join(kind.directory());
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(VaultError::InvalidDataDirectory(path));
    }
    let canonical = fs::canonicalize(&path)?;
    if !canonical.starts_with(app_data_root) {
        return Err(VaultError::InvalidDataDirectory(path));
    }
    Ok(Some(canonical))
}

fn read_history_record(
    directory: &Path,
    metadata_path: &Path,
    kind: VaultHistoryKind,
) -> Result<VaultHistoryRecord, VaultError> {
    let invalid = || VaultError::InvalidHistoryRecord(metadata_path.to_path_buf());
    let value: Value = serde_json::from_slice(&fs::read(metadata_path).map_err(|_| invalid())?)
        .map_err(|_| invalid())?;
    let id = string_field(&value, &["id"])
        .ok_or_else(invalid)?
        .to_owned();
    if id.is_empty()
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        || metadata_path.file_stem().and_then(OsStr::to_str) != Some(id.as_str())
    {
        return Err(invalid());
    }
    let relative_path =
        string_field(&value, &["relative_path", "relativePath"]).ok_or_else(invalid)?;
    let relative_path = normalize_relative_path(Path::new(relative_path))?;
    let revision_sha256 = string_field(&value, &["revision"])
        .ok_or_else(invalid)?
        .to_owned();
    let bytes = value
        .get("bytes")
        .and_then(Value::as_u64)
        .ok_or_else(invalid)?;
    let captured_at_text =
        string_field(&value, &["captured_at", "capturedAt"]).ok_or_else(invalid)?;
    let captured_at = parse_history_timestamp(captured_at_text).ok_or_else(invalid)?;
    let expected_revision_sha256 =
        optional_string_field(&value, &["expected_revision", "expectedRevision"])
            .ok_or_else(invalid)?;
    let current_revision_sha256 =
        optional_string_field(&value, &["current_revision", "currentRevision"])
            .ok_or_else(invalid)?;
    let artifact_path = directory.join(format!("{id}{}", kind.artifact_extension()));
    let artifact_metadata = fs::symlink_metadata(&artifact_path).map_err(|_| invalid())?;
    if artifact_metadata.file_type().is_symlink()
        || !artifact_metadata.is_file()
        || artifact_metadata.len() != bytes
    {
        return Err(invalid());
    }
    let protected = kind == VaultHistoryKind::Conflict
        || value.get("protected").and_then(Value::as_bool) == Some(true);
    Ok(VaultHistoryRecord {
        id,
        relative_path,
        revision_sha256,
        bytes,
        captured_at,
        kind,
        protected,
        expected_revision_sha256,
        current_revision_sha256,
    })
}

fn string_field<'a>(value: &'a Value, names: &[&str]) -> Option<&'a str> {
    names
        .iter()
        .find_map(|name| value.get(*name).and_then(Value::as_str))
}

fn optional_string_field(value: &Value, names: &[&str]) -> Option<Option<String>> {
    for name in names {
        if let Some(value) = value.get(*name) {
            return match value {
                Value::Null => Some(None),
                Value::String(value) => Some(Some(value.clone())),
                _ => None,
            };
        }
    }
    Some(None)
}

fn parse_history_timestamp(value: &str) -> Option<SystemTime> {
    if let Ok(seconds) = value.parse::<u64>() {
        return UNIX_EPOCH.checked_add(Duration::from_secs(seconds));
    }

    let (date_time, offset_seconds) = if let Some(date_time) = value.strip_suffix('Z') {
        (date_time, 0_i64)
    } else {
        let time_start = value.find('T')? + 1;
        let offset_start = value[time_start..].rfind(['+', '-'])? + time_start;
        let (date_time, offset) = value.split_at(offset_start);
        let sign = if offset.starts_with('+') {
            1_i64
        } else {
            -1_i64
        };
        let mut parts = offset[1..].split(':');
        let hours = parts.next()?.parse::<i64>().ok()?;
        let minutes = parts.next()?.parse::<i64>().ok()?;
        if parts.next().is_some() || !(0..=23).contains(&hours) || !(0..=59).contains(&minutes) {
            return None;
        }
        (date_time, sign * (hours * 60 + minutes) * 60)
    };

    let (date, time) = date_time.split_once('T')?;
    let mut date_parts = date.split('-');
    let year = date_parts.next()?.parse::<i64>().ok()?;
    let month = date_parts.next()?.parse::<i64>().ok()?;
    let day = date_parts.next()?.parse::<i64>().ok()?;
    if date_parts.next().is_some() || !(0..=9999).contains(&year) || !(1..=12).contains(&month) {
        return None;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days_in_month = match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    if !(1..=days_in_month).contains(&day) {
        return None;
    }

    let (clock, fraction) = time
        .split_once('.')
        .map_or((time, None), |(clock, fraction)| (clock, Some(fraction)));
    let mut clock_parts = clock.split(':');
    let hour = clock_parts.next()?.parse::<i64>().ok()?;
    let minute = clock_parts.next()?.parse::<i64>().ok()?;
    let second = clock_parts.next()?.parse::<i64>().ok()?;
    if clock_parts.next().is_some()
        || !(0..=23).contains(&hour)
        || !(0..=59).contains(&minute)
        || !(0..=59).contains(&second)
    {
        return None;
    }
    let nanos = if let Some(fraction) = fraction {
        if fraction.is_empty() || !fraction.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        let digits = &fraction[..fraction.len().min(9)];
        let value = digits.parse::<u32>().ok()?;
        value * 10_u32.pow((9 - digits.len()) as u32)
    } else {
        0
    };

    let days = days_from_civil(year, month, day);
    let seconds = days
        .checked_mul(86_400)?
        .checked_add(hour * 3_600 + minute * 60 + second)?
        .checked_sub(offset_seconds)?;
    if seconds >= 0 {
        UNIX_EPOCH.checked_add(Duration::new(seconds as u64, nanos))
    } else {
        let before_epoch = seconds.unsigned_abs();
        if nanos == 0 {
            UNIX_EPOCH.checked_sub(Duration::from_secs(before_epoch))
        } else {
            UNIX_EPOCH.checked_sub(Duration::new(before_epoch - 1, 1_000_000_000 - nanos))
        }
    }
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let adjusted_year = if month <= 2 { year - 1 } else { year };
    let era = adjusted_year.div_euclid(400);
    let year_of_era = adjusted_year - era * 400;
    let adjusted_month = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * adjusted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEMP_DIR_ID: AtomicU64 = AtomicU64::new(0);

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "openobsidian-history-{}-{}",
                std::process::id(),
                NEXT_TEMP_DIR_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn fixture() -> (TempDir, VaultStore, PathBuf) {
        let temp = TempDir::new();
        let vault_path = temp.0.join("vault");
        let app_data_path = temp.0.join("app-data");
        fs::create_dir(&vault_path).unwrap();
        fs::create_dir(&app_data_path).unwrap();
        fs::write(vault_path.join("note.md"), b"before\n").unwrap();
        let store = VaultStore::open(&vault_path, &app_data_path).unwrap();
        (temp, store, app_data_path)
    }

    fn create_conflict_record(store: &VaultStore, bytes: &[u8]) -> VaultHistoryRecord {
        let error = store
            .write(super::super::VaultWriteRequest {
                relative_path: PathBuf::from("note.md"),
                expected_revision_sha256: Some("0".repeat(64)),
                bytes: bytes.to_vec(),
            })
            .unwrap_err();
        assert!(matches!(error, VaultError::RevisionConflict { .. }));
        store
            .history_records()
            .unwrap()
            .into_iter()
            .find(|record| record.kind == VaultHistoryKind::Conflict)
            .unwrap()
    }

    fn record(
        id: &str,
        captured_at: SystemTime,
        bytes: u64,
        kind: VaultHistoryKind,
        protected: bool,
    ) -> VaultHistoryRecord {
        VaultHistoryRecord {
            id: id.to_owned(),
            relative_path: PathBuf::from(format!("{id}.md")),
            revision_sha256: "a".repeat(64),
            bytes,
            captured_at,
            kind,
            protected,
            expected_revision_sha256: None,
            current_revision_sha256: None,
        }
    }

    #[test]
    fn default_policy_matches_the_existing_thirty_day_five_gib_policy() {
        assert_eq!(
            VaultHistoryPolicy::default(),
            VaultHistoryPolicy {
                max_age_days: 30,
                max_bytes: 5 * 1024 * 1024 * 1024,
            }
        );
    }

    #[test]
    fn plans_age_and_byte_pruning_without_pruning_protected_conflicts() {
        let now = UNIX_EPOCH + Duration::from_secs(500 * 24 * 60 * 60);
        let plan = plan_history_retention(
            &[
                record(
                    "new",
                    now - Duration::from_secs(24 * 60 * 60),
                    4,
                    VaultHistoryKind::Recovery,
                    false,
                ),
                record(
                    "recent_over_budget",
                    now - Duration::from_secs(2 * 24 * 60 * 60),
                    3,
                    VaultHistoryKind::Recovery,
                    false,
                ),
                record(
                    "old",
                    now - Duration::from_secs(40 * 24 * 60 * 60),
                    4,
                    VaultHistoryKind::Recovery,
                    false,
                ),
                record(
                    "conflict",
                    now - Duration::from_secs(200 * 24 * 60 * 60),
                    20,
                    VaultHistoryKind::Conflict,
                    true,
                ),
            ],
            VaultHistoryPolicy {
                max_age_days: 30,
                max_bytes: 5,
            },
            now,
        );

        assert_eq!(
            plan.retained
                .iter()
                .map(|record| record.id.as_str())
                .collect::<Vec<_>>(),
            vec!["new", "conflict"]
        );
        assert_eq!(
            plan.pruneable
                .iter()
                .map(|record| record.id.as_str())
                .collect::<Vec<_>>(),
            vec!["recent_over_budget", "old"]
        );
        assert_eq!(plan.retained_bytes, 24);
        assert_eq!(plan.pruneable_bytes, 7);
        assert!(plan.warning);
    }

    #[test]
    fn lists_validated_history_from_each_managed_category() {
        let (_temp, store, _app_data_path) = fixture();
        let before = store.root.read("note.md").unwrap();
        store
            .write(super::super::VaultWriteRequest {
                relative_path: PathBuf::from("note.md"),
                expected_revision_sha256: Some(before.revision_sha256),
                bytes: b"after\n".to_vec(),
            })
            .unwrap();
        let error = store
            .write(super::super::VaultWriteRequest {
                relative_path: PathBuf::from("note.md"),
                expected_revision_sha256: Some("0".repeat(64)),
                bytes: b"external\n".to_vec(),
            })
            .unwrap_err();
        assert!(matches!(error, VaultError::RevisionConflict { .. }));

        let records = store.history_records().unwrap();
        assert_eq!(records.len(), 2);
        assert!(
            records
                .iter()
                .any(|record| { record.kind == VaultHistoryKind::Recovery && !record.protected })
        );
        assert!(
            records
                .iter()
                .any(|record| { record.kind == VaultHistoryKind::Conflict && record.protected })
        );
    }

    #[test]
    fn reads_and_explicitly_keeps_current_conflict_bytes() {
        let (_temp, store, app_data_path) = fixture();
        let incoming = b"incoming bytes\n";
        let record = create_conflict_record(&store, incoming);

        let conflict = store
            .read_conflict(&record.id, &record.relative_path)
            .unwrap();
        assert_eq!(conflict.bytes, incoming);
        assert_eq!(
            conflict.revision_sha256,
            super::super::sha256_hex(incoming)
        );
        assert!(conflict.record.protected);

        let resolution = store
            .resolve_conflict(
                &record.id,
                &record.relative_path,
                VaultConflictAction::KeepCurrent,
            )
            .unwrap();
        assert_eq!(resolution.action, VaultConflictAction::KeepCurrent);
        assert!(resolution.read.is_none());
        assert_eq!(
            store.root.read("note.md").unwrap().document.as_bytes(),
            b"before\n"
        );
        assert!(store.history_records().unwrap().is_empty());
        assert_eq!(fs::read_dir(app_data_path.join("conflicts")).unwrap().count(), 0);
    }

    #[test]
    fn keeps_incoming_conflict_only_when_the_recorded_current_revision_matches() {
        let (_temp, store, _app_data_path) = fixture();
        let incoming = b"incoming bytes\n";
        let record = create_conflict_record(&store, incoming);

        let resolution = store
            .resolve_conflict(
                &record.id,
                &record.relative_path,
                VaultConflictAction::KeepIncoming,
            )
            .unwrap();
        assert_eq!(resolution.action, VaultConflictAction::KeepIncoming);
        assert_eq!(
            resolution
                .read
                .as_ref()
                .unwrap()
                .document
                .as_bytes(),
            incoming
        );
        assert_eq!(
            store.root.read("note.md").unwrap().document.as_bytes(),
            incoming
        );
        let records = store.history_records().unwrap();
        assert!(records.iter().any(|entry| entry.kind == VaultHistoryKind::Recovery));
        assert!(!records.iter().any(|entry| entry.kind == VaultHistoryKind::Conflict));
    }

    #[test]
    fn preserves_conflict_when_the_vault_changes_before_resolution() {
        let (temp, store, _app_data_path) = fixture();
        let record = create_conflict_record(&store, b"incoming bytes\n");
        fs::write(temp.0.join("vault").join("note.md"), b"external edit\n").unwrap();

        let error = store
            .resolve_conflict(
                &record.id,
                &record.relative_path,
                VaultConflictAction::KeepIncoming,
            )
            .unwrap_err();
        assert!(matches!(error, VaultError::RevisionConflict { .. }));
        assert_eq!(
            store.root.read("note.md").unwrap().document.as_bytes(),
            b"external edit\n"
        );
        assert_eq!(
            store
                .history_records()
                .unwrap()
                .iter()
                .filter(|entry| entry.kind == VaultHistoryKind::Conflict)
                .count(),
            2
        );
        assert_eq!(store.read_conflict(&record.id, &record.relative_path).unwrap().bytes, b"incoming bytes\n");
    }

    #[test]
    fn refuses_to_inspect_or_resolve_a_conflict_for_another_path() {
        let (_temp, store, _app_data_path) = fixture();
        let record = create_conflict_record(&store, b"incoming bytes\n");
        let wrong_path = PathBuf::from("other.md");

        assert!(store.read_conflict(&record.id, &wrong_path).is_err());
        assert!(
            store
                .resolve_conflict(&record.id, &wrong_path, VaultConflictAction::KeepCurrent)
                .is_err()
        );
        assert_eq!(store.history_records().unwrap().len(), 1);
        assert_eq!(
            store.root.read("note.md").unwrap().document.as_bytes(),
            b"before\n"
        );
    }

    #[test]
    fn reads_legacy_camel_case_history_manifests() {
        let (_temp, store, app_data_path) = fixture();
        let recovery_dir = app_data_path.join("recovery");
        fs::create_dir(&recovery_dir).unwrap();
        let id = "legacy-history-id";
        let bytes = b"legacy recovery\n";
        fs::write(recovery_dir.join(format!("{id}.bin")), bytes).unwrap();
        let metadata = serde_json::json!({
            "id": id,
            "relativePath": "note.md",
            "revision": "a".repeat(64),
            "bytes": bytes.len(),
            "path": "/ignored/by/rust/recovery/legacy-history-id.bin",
            "capturedAt": "2026-10-08T00:00:00.500Z"
        });
        fs::write(
            recovery_dir.join(format!("{id}.json")),
            serde_json::to_vec(&metadata).unwrap(),
        )
        .unwrap();

        let records = store.history_records().unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].id, id);
        assert_eq!(records[0].relative_path, PathBuf::from("note.md"));
        assert_eq!(records[0].kind, VaultHistoryKind::Recovery);
        assert!(!records[0].protected);
        assert_eq!(records[0].bytes, bytes.len() as u64);
    }

    #[test]
    fn explicit_cleanup_removes_expired_recovery_but_preserves_conflicts_over_cap() {
        let (temp, store, app_data_path) = fixture();
        let before = store.root.read("note.md").unwrap();
        store
            .write(super::super::VaultWriteRequest {
                relative_path: PathBuf::from("note.md"),
                expected_revision_sha256: Some(before.revision_sha256),
                bytes: b"after\n".to_vec(),
            })
            .unwrap();
        let error = store
            .write(super::super::VaultWriteRequest {
                relative_path: PathBuf::from("note.md"),
                expected_revision_sha256: Some("0".repeat(64)),
                bytes: b"incoming conflict\n".to_vec(),
            })
            .unwrap_err();
        assert!(matches!(error, VaultError::RevisionConflict { .. }));

        let recovery_dir = app_data_path.join("recovery");
        let recovery_record = fs::read_dir(&recovery_dir)
            .unwrap()
            .map(Result::unwrap)
            .find(|entry| entry.path().extension() == Some(OsStr::new("json")))
            .unwrap();
        let recovery_id = recovery_record
            .path()
            .file_stem()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let outside_path = temp.0.join("outside-history.bin");
        fs::write(&outside_path, b"keep outside managed history\n").unwrap();
        let mut metadata: Value =
            serde_json::from_slice(&fs::read(recovery_record.path()).unwrap()).unwrap();
        metadata["captured_at"] = Value::String("1".to_owned());
        metadata["path"] = Value::String(outside_path.to_string_lossy().into_owned());
        fs::write(
            recovery_record.path(),
            serde_json::to_vec(&metadata).unwrap(),
        )
        .unwrap();

        let plan = store
            .history_retention_plan(
                VaultHistoryPolicy {
                    max_age_days: 30,
                    max_bytes: 0,
                },
                UNIX_EPOCH + Duration::from_secs(500 * 24 * 60 * 60),
            )
            .unwrap();
        assert_eq!(plan.pruneable.len(), 1);
        assert_eq!(plan.pruneable[0].id, recovery_id);
        assert_eq!(plan.protected.len(), 1);
        assert!(plan.warning);
        assert!(recovery_dir.join(format!("{recovery_id}.bin")).exists());
        assert!(recovery_dir.join(format!("{recovery_id}.json")).exists());

        let cleanup = store
            .cleanup_history_at(
                VaultHistoryPolicy {
                    max_age_days: 30,
                    max_bytes: 0,
                },
                UNIX_EPOCH + Duration::from_secs(500 * 24 * 60 * 60),
            )
            .unwrap();
        assert_eq!(cleanup.removed, vec![recovery_id.clone()]);
        assert_eq!(cleanup.protected.len(), 1);
        assert!(cleanup.warning);
        assert!(!recovery_dir.join(format!("{recovery_id}.bin")).exists());
        assert!(!recovery_dir.join(format!("{recovery_id}.json")).exists());
        assert_eq!(
            fs::read(&outside_path).unwrap(),
            b"keep outside managed history\n"
        );
        assert_eq!(store.history_records().unwrap().len(), 1);
        assert_eq!(
            fs::read_dir(app_data_path.join("conflicts"))
                .unwrap()
                .count(),
            2
        );
    }

    #[test]
    fn parses_rust_epoch_and_legacy_iso_timestamps() {
        assert_eq!(
            parse_history_timestamp("1791417600"),
            UNIX_EPOCH.checked_add(Duration::from_secs(1_791_417_600))
        );
        assert_eq!(
            parse_history_timestamp("2026-10-08T00:00:00.500Z"),
            Some(UNIX_EPOCH + Duration::from_secs(1_791_417_600) + Duration::from_millis(500))
        );
        assert_eq!(
            parse_history_timestamp("2026-10-08T02:00:00+02:00"),
            parse_history_timestamp("2026-10-08T00:00:00Z")
        );
        assert!(parse_history_timestamp("not-a-timestamp").is_none());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinked_history_directories() {
        use std::os::unix::fs::symlink;

        let temp = TempDir::new();
        let vault_path = temp.0.join("vault");
        let app_data_path = temp.0.join("app-data");
        let external = temp.0.join("external");
        fs::create_dir(&vault_path).unwrap();
        fs::create_dir(&app_data_path).unwrap();
        fs::create_dir(&external).unwrap();
        symlink(&external, app_data_path.join("recovery")).unwrap();
        let store = VaultStore::open(&vault_path, &app_data_path).unwrap();

        assert!(matches!(
            store.history_records(),
            Err(VaultError::InvalidDataDirectory(_))
        ));
    }
}
