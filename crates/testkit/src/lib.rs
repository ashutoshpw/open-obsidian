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
