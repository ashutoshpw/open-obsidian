//! Resource limits for one extension instance.

use std::time::Duration;

use wasmi::{StoreLimits, StoreLimitsBuilder};

/// One WebAssembly page in bytes.
pub const WASM_PAGE_BYTES: usize = 64 * 1024;

/// Hard limits enforced on every extension instance and every call into it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExtensionLimits {
    /// Total fuel available to one call (and to instantiation, including any start function).
    pub fuel_per_call: u64,
    /// Fuel granted per slice; the wall-clock deadline is checked between slices.
    pub fuel_slice: u64,
    /// Wall-clock budget for one call, checked between fuel slices and at every host call.
    pub wall_clock: Duration,
    /// Maximum linear memory size in bytes (initial and grown).
    pub max_memory_bytes: usize,
    /// Maximum number of elements in any table (initial and grown).
    pub max_table_elements: usize,
    /// Maximum nested Wasm call depth before a stack-overflow trap.
    pub max_recursion_depth: usize,
    /// Maximum bytes a call may emit through `output_write`.
    pub max_output_bytes: usize,
    /// Maximum host-function calls during one call.
    pub max_host_calls: u32,
    /// Maximum bytes the host copies out of guest memory for one argument.
    pub max_host_arg_bytes: usize,
    /// Maximum size of a module's `.wasm` bytes accepted for compilation.
    pub max_module_bytes: usize,
}

impl Default for ExtensionLimits {
    fn default() -> Self {
        Self {
            fuel_per_call: 50_000_000,
            fuel_slice: 1_000_000,
            wall_clock: Duration::from_millis(250),
            max_memory_bytes: 16 * 1024 * 1024,
            max_table_elements: 10_000,
            max_recursion_depth: 1_024,
            max_output_bytes: 1024 * 1024,
            max_host_calls: 1_000,
            max_host_arg_bytes: 1024 * 1024,
            max_module_bytes: 8 * 1024 * 1024,
        }
    }
}

/// A limit value that cannot be used.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
#[error("invalid extension limit `{field}`: {reason}")]
pub struct LimitsError {
    /// Field name.
    pub field: &'static str,
    /// Why it is invalid.
    pub reason: &'static str,
}

impl ExtensionLimits {
    /// Rejects zero budgets and a fuel slice larger than the per-call budget.
    pub fn validate(&self) -> Result<(), LimitsError> {
        let zero = |field| LimitsError {
            field,
            reason: "must be greater than zero",
        };
        if self.fuel_per_call == 0 {
            return Err(zero("fuel_per_call"));
        }
        if self.fuel_slice == 0 {
            return Err(zero("fuel_slice"));
        }
        if self.fuel_slice > self.fuel_per_call {
            return Err(LimitsError {
                field: "fuel_slice",
                reason: "must not exceed fuel_per_call",
            });
        }
        if self.wall_clock.is_zero() {
            return Err(zero("wall_clock"));
        }
        if self.max_recursion_depth == 0 {
            return Err(zero("max_recursion_depth"));
        }
        if self.max_module_bytes == 0 {
            return Err(zero("max_module_bytes"));
        }
        Ok(())
    }

    /// Store limiter: one instance, one memory, one table, capped sizes.
    ///
    /// Growth beyond a cap makes `memory.grow`/`table.grow` return `-1` (standard Wasm
    /// semantics); an initial size beyond a cap fails instantiation.
    pub(crate) fn store_limits(&self) -> StoreLimits {
        StoreLimitsBuilder::new()
            .memory_size(self.max_memory_bytes)
            .table_elements(self.max_table_elements)
            .instances(1)
            .memories(1)
            .tables(1)
            .build()
    }
}
