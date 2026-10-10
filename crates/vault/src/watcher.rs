//! Filesystem change hints. Callers must reconcile every hint from disk.

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher as NotifyWatcher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TryRecvError};
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;

const ROOT_WATCH_RETRY_INTERVAL: Duration = Duration::from_secs(5);

/// A filesystem event is only an invalidation signal; its payload is never treated as state.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VaultWatchHint {
    Changed,
    RescanRequired,
}

#[derive(Debug, Error)]
pub enum VaultWatchError {
    #[error("could not initialize a filesystem watcher for {path}: {source}")]
    Initialize {
        path: PathBuf,
        #[source]
        source: notify::Error,
    },
    #[error("could not watch filesystem path {path}: {source}")]
    Watch {
        path: PathBuf,
        #[source]
        source: notify::Error,
    },
    #[error("vault root is not an available directory: {0}")]
    RootUnavailable(PathBuf),
}

/// Watches a vault and its parent while keeping only one coalesced invalidation signal.
///
/// Filesystem events, including overflow events, do not contain authoritative state. The
/// application must rescan the vault from disk after polling a hint. Periodic callers can use
/// [`request_rescan`](Self::request_rescan) to recover after sleep, reconnect, or filesystems
/// that do not reliably emit notifications.
pub struct VaultWatcher {
    root: PathBuf,
    watcher: RecommendedWatcher,
    receiver: Receiver<()>,
    sender: SyncSender<()>,
    rescan_pending: Arc<AtomicBool>,
    root_change_pending: Arc<AtomicBool>,
    root_watched: bool,
    receiver_disconnected: bool,
    next_root_watch_attempt: Instant,
}

impl VaultWatcher {
    /// Watches the existing root recursively and watches its parent for root replacement.
    pub fn watch(root: impl AsRef<Path>) -> Result<Self, VaultWatchError> {
        let root = root.as_ref().to_path_buf();
        if !root.is_dir() {
            return Err(VaultWatchError::RootUnavailable(root));
        }

        let (sender, receiver) = mpsc::sync_channel(1);
        let rescan_pending = Arc::new(AtomicBool::new(false));
        let root_change_pending = Arc::new(AtomicBool::new(false));
        let callback_sender = sender.clone();
        let callback_rescan_pending = Arc::clone(&rescan_pending);
        let callback_root_change_pending = Arc::clone(&root_change_pending);
        let callback_root = root.clone();
        let mut watcher = notify::recommended_watcher(move |result: Result<Event, notify::Error>| {
            match result {
                Ok(event) => {
                    if let Some(hint) = classify_event(&event, &callback_root) {
                        if hint == VaultWatchHint::RescanRequired {
                            callback_root_change_pending.store(true, Ordering::Release);
                        }
                        if event.paths.iter().any(|path| path == &callback_root) {
                            callback_root_change_pending.store(true, Ordering::Release);
                        }
                        enqueue_hint(
                            &callback_sender,
                            &callback_rescan_pending,
                            hint,
                        );
                    }
                }
                Err(_) => {
                    callback_root_change_pending.store(true, Ordering::Release);
                    enqueue_hint(
                        &callback_sender,
                        &callback_rescan_pending,
                        VaultWatchHint::RescanRequired,
                    );
                }
            }
        })
        .map_err(|source| VaultWatchError::Initialize {
            path: root.clone(),
            source,
        })?;

        if let Some(parent) = root.parent() {
            watcher
                .watch(parent, RecursiveMode::NonRecursive)
                .map_err(|source| VaultWatchError::Watch {
                    path: parent.to_path_buf(),
                    source,
                })?;
        }
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|source| VaultWatchError::Watch {
                path: root.clone(),
                source,
            })?;

        Ok(Self {
            root,
            watcher,
            receiver,
            sender,
            rescan_pending,
            root_change_pending,
            root_watched: true,
            receiver_disconnected: false,
            next_root_watch_attempt: Instant::now(),
        })
    }

    /// Requests a full disk reconciliation, for example after sleep or reconnect.
    pub fn request_rescan(&self) {
        self.root_change_pending.store(true, Ordering::Release);
        self.queue_rescan();
    }

    /// Drains coalesced notifications and repairs the recursive watch after root replacement.
    pub fn poll(&mut self) -> Option<VaultWatchHint> {
        let mut signaled = false;
        loop {
            match self.receiver.try_recv() {
                Ok(()) => signaled = true,
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    if !self.receiver_disconnected {
                        self.receiver_disconnected = true;
                        self.rescan_pending.store(true, Ordering::Release);
                    }
                    break;
                }
            }
        }

        if self.root_change_pending.swap(false, Ordering::AcqRel) && self.root_watched {
            let _ = self.watcher.unwatch(&self.root);
            self.root_watched = false;
        }

        let now = Instant::now();
        if !self.root_watched && now >= self.next_root_watch_attempt && self.root.is_dir() {
            match self.watcher.watch(&self.root, RecursiveMode::Recursive) {
                Ok(()) => self.root_watched = true,
                Err(_) => self.next_root_watch_attempt = now + ROOT_WATCH_RETRY_INTERVAL,
            }
        }

        if self.rescan_pending.swap(false, Ordering::AcqRel) {
            Some(VaultWatchHint::RescanRequired)
        } else if signaled {
            Some(VaultWatchHint::Changed)
        } else {
            None
        }
    }

    fn queue_rescan(&self) {
        self.rescan_pending.store(true, Ordering::Release);
        let _ = self.sender.try_send(());
    }
}

fn enqueue_hint(
    sender: &SyncSender<()>,
    rescan_pending: &AtomicBool,
    hint: VaultWatchHint,
) {
    if hint == VaultWatchHint::RescanRequired {
        rescan_pending.store(true, Ordering::Release);
    }
    let _ = sender.try_send(());
}

fn classify_event(event: &Event, root: &Path) -> Option<VaultWatchHint> {
    if event.need_rescan() || event.paths.is_empty() {
        return Some(VaultWatchHint::RescanRequired);
    }
    if matches!(event.kind, EventKind::Access(_)) {
        return None;
    }
    if event.paths.iter().any(|path| path == root) {
        return Some(VaultWatchHint::RescanRequired);
    }
    event
        .paths
        .iter()
        .any(|path| path.starts_with(root))
        .then_some(VaultWatchHint::Changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::VaultRoot;
    use notify::event::Flag;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(0);
    const SYNC_WATCHER_RECOVERY_FIXTURE: &str =
        include_str!("../../../fixtures/sync-watcher-recovery.json");

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "openobsidian-watch-{}-{}",
                std::process::id(),
                NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed),
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn assert_disk_rescan_case(case_id: &str) {
        let fixture: serde_json::Value =
            serde_json::from_str(SYNC_WATCHER_RECOVERY_FIXTURE).unwrap();
        assert_eq!(fixture["fixture_id"], "fixture:sync-watcher-recovery");
        let case = fixture["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["id"] == case_id)
            .unwrap_or_else(|| panic!("missing watcher recovery fixture case {case_id}"));
        assert_eq!(case["expected"], "verified_rescan_from_disk");
    }

    #[test]
    fn overflow_event_requires_a_disk_rescan_even_without_paths() {
        assert_disk_rescan_case("overflow");
        let event = Event::new(EventKind::Other).set_flag(Flag::Rescan);

        assert_eq!(
            classify_event(&event, Path::new("/vault")),
            Some(VaultWatchHint::RescanRequired)
        );
    }

    #[test]
    fn relevant_file_events_are_hints_without_becoming_authoritative_state() {
        let root = Path::new("/vault");
        let event = Event::new(EventKind::Any).add_path(root.join("Note.md"));

        assert_eq!(
            classify_event(&event, root),
            Some(VaultWatchHint::Changed)
        );
    }

    #[test]
    fn sleep_or_reconnect_rescan_reconciles_the_listing_from_disk() {
        assert_disk_rescan_case("sleep");
        let temp = TempDir::new();
        fs::write(temp.0.join("Before.md"), b"before\n").unwrap();
        let mut watcher = VaultWatcher::watch(&temp.0).unwrap();

        fs::write(temp.0.join("After.md"), b"after\r\n").unwrap();
        watcher.request_rescan();
        assert_eq!(watcher.poll(), Some(VaultWatchHint::RescanRequired));

        let root = VaultRoot::open(&temp.0).unwrap();
        let entries = root.scan_markdown().unwrap();
        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.relative_path.as_path())
                .collect::<Vec<_>>(),
            [Path::new("After.md"), Path::new("Before.md")]
        );
        assert_eq!(root.read("After.md").unwrap().document.as_bytes(), b"after\r\n");
    }

    #[test]
    fn reconnect_after_root_replacement_rearms_watch_and_rescans_disk() {
        assert_disk_rescan_case("reconnect");
        let temp = TempDir::new();
        fs::write(temp.0.join("Before.md"), b"before\n").unwrap();
        let mut watcher = VaultWatcher::watch(&temp.0).unwrap();

        fs::remove_dir_all(&temp.0).unwrap();
        fs::create_dir(&temp.0).unwrap();
        fs::write(temp.0.join("After.md"), b"restored after reconnect\n").unwrap();
        watcher.request_rescan();

        assert_eq!(watcher.poll(), Some(VaultWatchHint::RescanRequired));
        assert!(watcher.root_watched);
        let root = VaultRoot::open(&temp.0).unwrap();
        assert_eq!(
            root.scan_markdown()
                .unwrap()
                .iter()
                .map(|entry| entry.relative_path.as_path())
                .collect::<Vec<_>>(),
            [Path::new("After.md")]
        );
        assert_eq!(
            root.read("After.md").unwrap().document.as_bytes(),
            b"restored after reconnect\n"
        );
    }
}
