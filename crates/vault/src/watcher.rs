//! Filesystem change hints. Callers must reconcile every hint from disk.

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher as NotifyWatcher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use thiserror::Error;

const ROOT_WATCH_RETRY_INTERVAL: Duration = Duration::from_secs(5);
static NEXT_WATCH_EVENT_BATCH_ID: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(1);

/// A filesystem event is only an invalidation signal; its payload is never treated as state.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VaultWatchHint {
    Changed,
    RescanRequired,
}

/// Identifies relevant filesystem callbacks coalesced before a caller polls the watcher.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct VaultWatchEventBatch {
    /// Process-local monotonically increasing identifier for the coalesced callback batch.
    pub id: u64,
    /// Number of relevant notify callbacks represented by this batch.
    pub event_count: u64,
    /// Number of callbacks that reported a `notify::Error` in this batch.
    pub notify_error_callbacks: u64,
    /// Time of the first callback represented by this batch.
    pub enqueued_at: Instant,
}

/// A polled invalidation hint and its optional notify callback batch.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct VaultWatchPoll {
    pub hint: VaultWatchHint,
    /// `None` means the hint came from an explicit rescan/recovery request.
    pub event_batch: Option<VaultWatchEventBatch>,
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
/// application must rescan the vault from disk after polling a hint. Callers can use
/// [`request_rescan`](Self::request_rescan) to recover after sleep or reconnect, and
/// [`request_root_rewatch`](Self::request_root_rewatch) when they need to rebuild the watch
/// without manufacturing a content-change hint.
pub struct VaultWatcher {
    root: PathBuf,
    watcher: RecommendedWatcher,
    receiver: Receiver<()>,
    sender: SyncSender<()>,
    rescan_pending: Arc<AtomicBool>,
    root_change_pending: Arc<AtomicBool>,
    pending_event_batch: Arc<Mutex<Option<VaultWatchEventBatch>>>,
    root_watched: bool,
    receiver_disconnected: bool,
    next_root_watch_attempt: Instant,
}

impl VaultWatcher {
    /// Watches the existing root recursively and watches its parent for root replacement.
    pub fn watch(root: impl AsRef<Path>) -> Result<Self, VaultWatchError> {
        Self::watch_with_wakeup(root, || {})
    }

    /// Watches a vault and calls a thread-safe wake callback after each relevant notify event
    /// has been recorded and queued. The callback runs on the filesystem notification thread;
    /// it should be quick and non-blocking. This generic hook lets UI crates request a repaint
    /// without adding a UI dependency to the vault crate.
    pub fn watch_with_wakeup(
        root: impl AsRef<Path>,
        wake_callback: impl Fn() + Send + Sync + 'static,
    ) -> Result<Self, VaultWatchError> {
        let root = root.as_ref().to_path_buf();
        if !root.is_dir() {
            return Err(VaultWatchError::RootUnavailable(root));
        }

        let (sender, receiver) = mpsc::sync_channel(1);
        let rescan_pending = Arc::new(AtomicBool::new(false));
        let root_change_pending = Arc::new(AtomicBool::new(false));
        let pending_event_batch = Arc::new(Mutex::new(None));
        let wake_callback: Arc<dyn Fn() + Send + Sync> = Arc::new(wake_callback);
        let callback_sender = sender.clone();
        let callback_rescan_pending = Arc::clone(&rescan_pending);
        let callback_root_change_pending = Arc::clone(&root_change_pending);
        let callback_event_batch = Arc::clone(&pending_event_batch);
        let callback_wake = Arc::clone(&wake_callback);
        let callback_root = root.clone();
        let mut watcher =
            notify::recommended_watcher(move |result: Result<Event, notify::Error>| match result {
                Ok(event) => {
                    if let Some(hint) = classify_event(&event, &callback_root) {
                        let root_change = hint == VaultWatchHint::RescanRequired
                            || event.paths.iter().any(|path| path == &callback_root);
                        enqueue_event_hint(
                            &callback_sender,
                            &callback_rescan_pending,
                            &callback_event_batch,
                            &callback_root_change_pending,
                            &callback_wake,
                            EventHintMetadata {
                                hint,
                                root_change,
                                notify_error: false,
                            },
                        );
                    }
                }
                Err(_) => {
                    enqueue_event_hint(
                        &callback_sender,
                        &callback_rescan_pending,
                        &callback_event_batch,
                        &callback_root_change_pending,
                        &callback_wake,
                        EventHintMetadata {
                            hint: VaultWatchHint::RescanRequired,
                            root_change: true,
                            notify_error: true,
                        },
                    );
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
            pending_event_batch,
            root_watched: true,
            receiver_disconnected: false,
            next_root_watch_attempt: Instant::now(),
        })
    }

    /// Requests a full disk reconciliation, for example after sleep or reconnect.
    pub fn request_rescan(&self) {
        let _pending = self
            .pending_event_batch
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        self.root_change_pending.store(true, Ordering::Release);
        self.queue_rescan();
    }

    /// Requests a root-watch rebuild on the next poll without a synthetic change hint.
    pub fn request_root_rewatch(&self) {
        let _pending = self
            .pending_event_batch
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        self.root_change_pending.store(true, Ordering::Release);
    }

    /// Drains coalesced notifications and repairs the recursive watch after root replacement.
    pub fn poll(&mut self) -> Option<VaultWatchHint> {
        self.poll_with_batch().map(|notification| notification.hint)
    }

    /// Drains coalesced notifications and returns the callback batch that produced the hint.
    pub fn poll_with_batch(&mut self) -> Option<VaultWatchPoll> {
        let mut pending_event_batch = self
            .pending_event_batch
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
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
        let event_batch = pending_event_batch.take();
        let hint = if self.rescan_pending.swap(false, Ordering::AcqRel) {
            Some(VaultWatchHint::RescanRequired)
        } else if signaled {
            Some(VaultWatchHint::Changed)
        } else {
            None
        };
        let root_change_pending = self.root_change_pending.swap(false, Ordering::AcqRel);
        drop(pending_event_batch);

        if root_change_pending && self.root_watched {
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

        hint.map(|hint| VaultWatchPoll { hint, event_batch })
    }

    fn queue_rescan(&self) {
        self.rescan_pending.store(true, Ordering::Release);
        let _ = self.sender.try_send(());
    }
}

fn enqueue_hint(sender: &SyncSender<()>, rescan_pending: &AtomicBool, hint: VaultWatchHint) {
    if hint == VaultWatchHint::RescanRequired {
        rescan_pending.store(true, Ordering::Release);
    }
    let _ = sender.try_send(());
}

struct EventHintMetadata {
    hint: VaultWatchHint,
    root_change: bool,
    notify_error: bool,
}

fn enqueue_event_hint(
    sender: &SyncSender<()>,
    rescan_pending: &AtomicBool,
    pending_event_batch: &Mutex<Option<VaultWatchEventBatch>>,
    root_change_pending: &AtomicBool,
    wake_callback: &Arc<dyn Fn() + Send + Sync>,
    metadata: EventHintMetadata,
) {
    let now = Instant::now();
    let mut pending = pending_event_batch
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let batch = match *pending {
        Some(mut batch) => {
            batch.event_count = batch.event_count.saturating_add(1);
            if metadata.notify_error {
                batch.notify_error_callbacks = batch.notify_error_callbacks.saturating_add(1);
            }
            batch
        }
        None => VaultWatchEventBatch {
            id: NEXT_WATCH_EVENT_BATCH_ID.fetch_add(1, Ordering::Relaxed),
            event_count: 1,
            notify_error_callbacks: if metadata.notify_error { 1 } else { 0 },
            enqueued_at: now,
        },
    };
    *pending = Some(batch);
    if metadata.root_change {
        root_change_pending.store(true, Ordering::Release);
    }
    enqueue_hint(sender, rescan_pending, metadata.hint);
    drop(pending);
    if std::env::var_os("OPENOBSIDIAN_CI_DIAGNOSTICS").is_some() {
        eprintln!(
            "OpenObsidian CI vault watcher callback enqueued: batch_id={}, event_count={}, callback_kind={}",
            batch.id,
            batch.event_count,
            if metadata.notify_error {
                "notify_error"
            } else {
                "filesystem_event"
            }
        );
    }
    wake_callback();
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

        assert_eq!(classify_event(&event, root), Some(VaultWatchHint::Changed));
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
        assert_eq!(
            root.read("After.md").unwrap().document.as_bytes(),
            b"after\r\n"
        );
    }

    #[test]
    fn root_rewatch_does_not_synthesize_or_consume_a_real_change_hint() {
        let temp = TempDir::new();
        let mut watcher = VaultWatcher::watch(&temp.0).unwrap();

        watcher.request_root_rewatch();
        let _ = watcher.poll();
        assert!(watcher.root_watched);

        fs::write(temp.0.join("After.md"), b"after rewatch\n").unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let hint = loop {
            if let Some(hint) = watcher.poll() {
                break hint;
            }
            assert!(
                Instant::now() < deadline,
                "filesystem change hint was not delivered"
            );
            std::thread::sleep(Duration::from_millis(10));
        };
        assert!(matches!(
            hint,
            VaultWatchHint::Changed | VaultWatchHint::RescanRequired
        ));
        assert!(watcher.root_watched);
    }

    #[test]
    fn root_rewatch_returns_a_change_hint_that_was_already_queued() {
        let temp = TempDir::new();
        fs::create_dir_all(&temp.0).unwrap();
        let (sender, receiver) = mpsc::sync_channel(1);
        let rescan_pending = Arc::new(AtomicBool::new(false));
        let root_change_pending = Arc::new(AtomicBool::new(false));
        let pending_event_batch = Arc::new(Mutex::new(None));
        let backend = notify::recommended_watcher(|_: Result<Event, notify::Error>| {}).unwrap();
        let mut watcher = VaultWatcher {
            root: temp.0.clone(),
            watcher: backend,
            receiver,
            sender,
            rescan_pending: Arc::clone(&rescan_pending),
            root_change_pending,
            pending_event_batch,
            root_watched: true,
            receiver_disconnected: false,
            next_root_watch_attempt: Instant::now(),
        };

        enqueue_hint(&watcher.sender, &rescan_pending, VaultWatchHint::Changed);
        watcher.request_root_rewatch();

        assert_eq!(watcher.poll(), Some(VaultWatchHint::Changed));
        assert!(watcher.root_watched);
        assert!(!watcher.rescan_pending.load(Ordering::Acquire));
    }

    #[test]
    fn two_callbacks_before_poll_keep_one_batch_id_and_count_both_events() {
        let temp = TempDir::new();
        let (sender, receiver) = mpsc::sync_channel(1);
        let rescan_pending = Arc::new(AtomicBool::new(false));
        let root_change_pending = Arc::new(AtomicBool::new(false));
        let pending_event_batch = Arc::new(Mutex::new(None));
        let wake_count = Arc::new(AtomicU64::new(0));
        let callback_count = Arc::clone(&wake_count);
        let wake_callback: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            callback_count.fetch_add(1, Ordering::Relaxed);
        });
        let backend = notify::recommended_watcher(|_: Result<Event, notify::Error>| {}).unwrap();
        let mut watcher = VaultWatcher {
            root: temp.0.clone(),
            watcher: backend,
            receiver,
            sender,
            rescan_pending: Arc::clone(&rescan_pending),
            root_change_pending: Arc::clone(&root_change_pending),
            pending_event_batch: Arc::clone(&pending_event_batch),
            root_watched: true,
            receiver_disconnected: false,
            next_root_watch_attempt: Instant::now(),
        };

        enqueue_event_hint(
            &watcher.sender,
            &rescan_pending,
            &pending_event_batch,
            &root_change_pending,
            &wake_callback,
            EventHintMetadata {
                hint: VaultWatchHint::Changed,
                root_change: false,
                notify_error: false,
            },
        );
        let first_batch = pending_event_batch
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
            .copied()
            .expect("the first callback opens a coalesced batch");

        enqueue_event_hint(
            &watcher.sender,
            &rescan_pending,
            &pending_event_batch,
            &root_change_pending,
            &wake_callback,
            EventHintMetadata {
                hint: VaultWatchHint::RescanRequired,
                root_change: true,
                notify_error: true,
            },
        );
        let coalesced_batch = pending_event_batch
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
            .copied()
            .expect("two callbacks remain pending as one coalesced batch");
        assert_eq!(coalesced_batch.id, first_batch.id);
        assert_eq!(coalesced_batch.event_count, 2);
        assert_eq!(coalesced_batch.notify_error_callbacks, 1);

        let notification = watcher
            .poll_with_batch()
            .expect("queued notify callbacks produce one polled hint");
        let batch = notification
            .event_batch
            .expect("notify callbacks share one coalesced event batch");
        assert_eq!(batch.id, first_batch.id);
        assert_eq!(batch.event_count, 2);
        assert_eq!(batch.notify_error_callbacks, 1);
        assert_eq!(wake_count.load(Ordering::Relaxed), 2);
        assert_eq!(watcher.poll_with_batch(), None);
    }

    #[test]
    fn notify_callback_wakes_the_caller_and_poll_returns_its_coalesced_batch() {
        let temp = TempDir::new();
        let (wake_sender, wake_receiver) = mpsc::channel();
        let mut watcher = VaultWatcher::watch_with_wakeup(&temp.0, move || {
            let _ = wake_sender.send(());
        })
        .unwrap();

        fs::write(temp.0.join("First.md"), b"first\n").unwrap();
        fs::write(temp.0.join("Second.md"), b"second\n").unwrap();
        wake_receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("the notify callback wakes the caller after enqueue");

        let deadline = Instant::now() + Duration::from_secs(5);
        let notification = loop {
            if let Some(notification) = watcher.poll_with_batch() {
                break notification;
            }
            assert!(
                Instant::now() < deadline,
                "filesystem change hint was not delivered"
            );
            std::thread::sleep(Duration::from_millis(10));
        };
        let batch = notification
            .event_batch
            .expect("a notify callback batch accompanies its polled hint");
        assert!(matches!(
            notification.hint,
            VaultWatchHint::Changed | VaultWatchHint::RescanRequired
        ));
        assert!(batch.id > 0);
        assert!(batch.event_count > 0);
        assert_eq!(batch.notify_error_callbacks, 0);
        assert!(batch.enqueued_at <= Instant::now());
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
