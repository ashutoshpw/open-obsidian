//! The bounded `wasmi` host: compilation, ABI checks, instantiation and limited calls.

use std::collections::BTreeSet;
use std::fmt;
use std::sync::Arc;
use std::time::{Duration, Instant};

use wasmi::errors::{ErrorKind, HostError, InstantiationError};
use wasmi::{
    Caller, CompilationMode, Config, EnforcedLimits, Engine, Extern, ExternType, Instance, Linker,
    Memory, Module, Store, StoreLimits, TrapCode, TypedResumableCall, ValType,
};

use super::abi::{
    ABI_MODULE, ABI_VERSION, EXPORT_ABI_VERSION, EXPORT_MEMORY, FN_COMMAND_REGISTER, FN_LOG,
    FN_OUTPUT_WRITE, FN_SETTINGS_GET, FN_SETTINGS_SET, FN_VAULT_PROPOSE_CHANGE, FN_VAULT_READ,
    HOST_FUNCTIONS, HostBroker, HostCallContext, HostCapability, HostDenial, HostDenialKind,
    HostDenialRecord, LogLevel, STATUS_BUFFER_TOO_SMALL, STATUS_DENIED, STATUS_INVALID_ARGUMENT,
    STATUS_NOT_FOUND, STATUS_OK,
};
use super::limits::{ExtensionLimits, LimitsError};
use super::package::ExtensionPackage;

/// A typed failure from loading or calling an extension. Never a panic.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ExtensionError {
    /// The configured limits are unusable.
    #[error(transparent)]
    Limits(#[from] LimitsError),
    /// The module exceeds the accepted byte size.
    #[error("extension module is {size} bytes; the limit is {limit}")]
    ModuleTooLarge {
        /// Actual size.
        size: usize,
        /// Limit.
        limit: usize,
    },
    /// The bytes are not a valid WebAssembly module for this engine.
    #[error("extension module is invalid: {0}")]
    InvalidModule(String),
    /// The module imports something outside the `openobsidian:ext/1` host functions.
    #[error("extension imports unsupported `{module}`.`{name}`")]
    UnsupportedImport {
        /// Import namespace.
        module: String,
        /// Import name.
        name: String,
    },
    /// An ABI rule was violated (import signature, version export, export types).
    #[error("extension does not implement ABI {abi}: {reason}")]
    AbiMismatch {
        /// ABI identifier.
        abi: &'static str,
        /// Reason.
        reason: String,
    },
    /// A required or requested export is missing.
    #[error("extension does not export `{0}`")]
    MissingExport(String),
    /// Instantiation failed for a non-limit reason.
    #[error("extension instantiation failed: {0}")]
    Instantiation(String),
    /// The fuel budget for the call (or instantiation) was exhausted.
    #[error("extension exhausted its fuel budget of {budget}")]
    FuelExhausted {
        /// Fuel budget.
        budget: u64,
    },
    /// The wall-clock deadline passed.
    #[error("extension exceeded its wall-clock limit of {limit:?}")]
    DeadlineExceeded {
        /// Wall-clock limit.
        limit: Duration,
    },
    /// The Wasm call stack exceeded the recursion limit.
    #[error("extension exceeded its call-stack limit")]
    StackOverflow,
    /// Memory or table limits were exceeded.
    #[error("extension exceeded a memory or table limit: {0}")]
    ResourceLimit(String),
    /// The call wrote more than the output limit.
    #[error("extension output exceeded {limit} bytes")]
    OutputLimit {
        /// Output limit.
        limit: usize,
    },
    /// The call made more host calls than allowed.
    #[error("extension exceeded its budget of {limit} host calls")]
    HostCallBudget {
        /// Host-call limit.
        limit: u32,
    },
    /// The guest trapped (unreachable, out-of-bounds access, division by zero, ...).
    #[error("extension trapped: {0}")]
    Trap(String),
    /// Any other runtime failure reported by the engine.
    #[error("extension runtime failure: {0}")]
    Runtime(String),
    /// The instance trapped earlier and must be reloaded before it is called again.
    #[error("extension instance is poisoned by an earlier failure; reload it")]
    Poisoned,
}

/// Host-side abort raised from a host function; surfaces as a typed [`ExtensionError`].
#[derive(Clone, Debug, Eq, PartialEq)]
enum HostAbort {
    HostCallBudget(u32),
    OutputLimit(usize),
    Deadline(Duration),
}

impl fmt::Display for HostAbort {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::HostCallBudget(limit) => write!(f, "host-call budget {limit} exceeded"),
            Self::OutputLimit(limit) => write!(f, "output limit {limit} exceeded"),
            Self::Deadline(limit) => write!(f, "deadline {limit:?} exceeded"),
        }
    }
}

impl HostError for HostAbort {}

impl From<HostAbort> for ExtensionError {
    fn from(abort: HostAbort) -> Self {
        match abort {
            HostAbort::HostCallBudget(limit) => Self::HostCallBudget { limit },
            HostAbort::OutputLimit(limit) => Self::OutputLimit { limit },
            HostAbort::Deadline(limit) => Self::DeadlineExceeded { limit },
        }
    }
}

/// Per-store state visible to host functions.
struct HostState {
    extension_id: String,
    extension_version: String,
    requested: BTreeSet<HostCapability>,
    broker: Arc<dyn HostBroker>,
    store_limits: StoreLimits,
    max_host_calls: u32,
    max_output_bytes: usize,
    max_host_arg_bytes: usize,
    wall_clock: Duration,
    deadline: Instant,
    host_calls: u32,
    output: Vec<u8>,
    denials: Vec<HostDenialRecord>,
}

impl HostState {
    fn start_call(&mut self) {
        self.host_calls = 0;
        self.output.clear();
        self.deadline = deadline_from_now(self.wall_clock);
    }

    fn context(&self) -> HostCallContext<'_> {
        HostCallContext {
            extension_id: &self.extension_id,
            extension_version: &self.extension_version,
        }
    }

    fn record_denial(&mut self, capability: HostCapability, requested: bool, reason: String) {
        self.denials.push(HostDenialRecord {
            extension_id: self.extension_id.clone(),
            capability,
            requested_by_manifest: requested,
            reason,
        });
    }
}

fn deadline_from_now(limit: Duration) -> Instant {
    let now = Instant::now();
    now.checked_add(limit).unwrap_or(now)
}

/// The result of a successful bounded call.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CallOutcome {
    /// The `i32` returned by the entry point.
    pub status: i32,
    /// Bytes written through `output_write`, at most `max_output_bytes`.
    pub output: Vec<u8>,
    /// Fuel consumed by the call.
    pub fuel_consumed: u64,
    /// Host calls made by the call.
    pub host_calls: u32,
}

/// Compiles and instantiates extensions under one set of [`ExtensionLimits`].
pub struct ExtensionHost {
    engine: Engine,
    linker: Linker<HostState>,
    limits: ExtensionLimits,
}

impl fmt::Debug for ExtensionHost {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ExtensionHost")
            .field("limits", &self.limits)
            .finish_non_exhaustive()
    }
}

impl ExtensionHost {
    /// Creates a host; fails if `limits` is unusable.
    pub fn new(limits: ExtensionLimits) -> Result<Self, ExtensionError> {
        limits.validate()?;
        let mut config = Config::default();
        config
            .consume_fuel(true)
            .set_max_recursion_depth(limits.max_recursion_depth)
            .compilation_mode(CompilationMode::Eager)
            .enforced_limits(EnforcedLimits::strict());
        let engine = Engine::new(&config);
        let linker = build_linker(&engine)?;
        Ok(Self {
            engine,
            linker,
            limits,
        })
    }

    /// The limits applied to every instance.
    pub fn limits(&self) -> &ExtensionLimits {
        &self.limits
    }

    /// Compiles, ABI-checks and instantiates a verified package.
    ///
    /// Instantiation (including any Wasm start function) and the ABI-version probe are
    /// bounded by the same fuel and memory limits as a call.
    pub fn load(
        &self,
        package: &ExtensionPackage,
        broker: Arc<dyn HostBroker>,
    ) -> Result<ExtensionInstance, ExtensionError> {
        let module = self.compile(package.wasm())?;
        check_imports(&module)?;
        let manifest = package.manifest();
        let state = HostState {
            extension_id: manifest.id.clone(),
            extension_version: manifest.version.clone(),
            requested: package.capabilities().clone(),
            broker,
            store_limits: self.limits.store_limits(),
            max_host_calls: self.limits.max_host_calls,
            max_output_bytes: self.limits.max_output_bytes,
            max_host_arg_bytes: self.limits.max_host_arg_bytes,
            wall_clock: self.limits.wall_clock,
            deadline: deadline_from_now(self.limits.wall_clock),
            host_calls: 0,
            output: Vec::new(),
            denials: Vec::new(),
        };
        let mut store = Store::new(&self.engine, state);
        store.limiter(|state| &mut state.store_limits);
        store
            .set_fuel(self.limits.fuel_per_call)
            .map_err(|error| ExtensionError::Runtime(error.to_string()))?;
        let instance = self
            .linker
            .instantiate_and_start(&mut store, &module)
            .map_err(|error| classify_instantiation_error(&error, &self.limits))?;
        if instance.get_memory(&store, EXPORT_MEMORY).is_none() {
            return Err(ExtensionError::MissingExport(EXPORT_MEMORY.to_owned()));
        }
        let mut loaded = ExtensionInstance {
            store,
            instance,
            limits: self.limits.clone(),
            poisoned: false,
        };
        let version = loaded.call(EXPORT_ABI_VERSION)?.status;
        if version != ABI_VERSION {
            return Err(ExtensionError::AbiMismatch {
                abi: ABI_MODULE,
                reason: format!(
                    "`{EXPORT_ABI_VERSION}` returned {version}, expected {ABI_VERSION}"
                ),
            });
        }
        Ok(loaded)
    }

    fn compile(&self, wasm: &[u8]) -> Result<Module, ExtensionError> {
        if wasm.len() > self.limits.max_module_bytes {
            return Err(ExtensionError::ModuleTooLarge {
                size: wasm.len(),
                limit: self.limits.max_module_bytes,
            });
        }
        Module::new(&self.engine, wasm)
            .map_err(|error| ExtensionError::InvalidModule(error.to_string()))
    }
}

/// A live, isolated extension instance with its own store and limits.
pub struct ExtensionInstance {
    store: Store<HostState>,
    instance: Instance,
    limits: ExtensionLimits,
    poisoned: bool,
}

impl fmt::Debug for ExtensionInstance {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ExtensionInstance")
            .field("extension_id", &self.store.data().extension_id)
            .field("poisoned", &self.poisoned)
            .finish_non_exhaustive()
    }
}

impl ExtensionInstance {
    /// Manifest `id` of the loaded extension.
    pub fn extension_id(&self) -> &str {
        &self.store.data().extension_id
    }

    /// Whether an earlier failure poisoned the instance (it must be reloaded).
    pub fn is_poisoned(&self) -> bool {
        self.poisoned
    }

    /// Denied host calls recorded since load, for user-visible reporting.
    pub fn denials(&self) -> &[HostDenialRecord] {
        &self.store.data().denials
    }

    /// Calls an exported `() -> i32` entry point under the instance limits.
    ///
    /// Any failure poisons the instance: linear memory may be inconsistent after a trap,
    /// so the reset policy is to reload from the verified package.
    pub fn call(&mut self, export: &str) -> Result<CallOutcome, ExtensionError> {
        if self.poisoned {
            return Err(ExtensionError::Poisoned);
        }
        let result = self.call_inner(export);
        if result.is_err() {
            self.poisoned = true;
        }
        result
    }

    fn call_inner(&mut self, export: &str) -> Result<CallOutcome, ExtensionError> {
        if self.instance.get_func(&self.store, export).is_none() {
            return Err(ExtensionError::MissingExport(export.to_owned()));
        }
        let func = self
            .instance
            .get_typed_func::<(), i32>(&self.store, export)
            .map_err(|error| ExtensionError::AbiMismatch {
                abi: ABI_MODULE,
                reason: format!("export `{export}` is not `() -> i32`: {error}"),
            })?;
        self.store.data_mut().start_call();
        let deadline = self.store.data().deadline;
        let budget = self.limits.fuel_per_call;
        let slice = self.limits.fuel_slice;
        let mut reserve = budget - slice;
        self.set_fuel(slice)?;
        let mut state = func
            .call_resumable(&mut self.store, ())
            .map_err(|error| classify_runtime_error(&error, &self.limits))?;
        let status = loop {
            match state {
                TypedResumableCall::Finished(status) => break status,
                TypedResumableCall::HostTrap(trap) => {
                    return Err(classify_runtime_error(trap.host_error(), &self.limits));
                }
                TypedResumableCall::OutOfFuel(pending) => {
                    if Instant::now() >= deadline {
                        return Err(ExtensionError::DeadlineExceeded {
                            limit: self.limits.wall_clock,
                        });
                    }
                    let available = reserve.saturating_add(self.fuel_left()?);
                    let required = pending.required_fuel();
                    if available == 0 || required > available {
                        return Err(ExtensionError::FuelExhausted { budget });
                    }
                    let grant = slice.max(required).min(available);
                    reserve = available - grant;
                    self.set_fuel(grant)?;
                    state = pending
                        .resume(&mut self.store)
                        .map_err(|error| classify_runtime_error(&error, &self.limits))?;
                }
            }
        };
        let fuel_consumed = budget.saturating_sub(reserve.saturating_add(self.fuel_left()?));
        let data = self.store.data_mut();
        Ok(CallOutcome {
            status,
            output: std::mem::take(&mut data.output),
            fuel_consumed,
            host_calls: data.host_calls,
        })
    }

    fn set_fuel(&mut self, fuel: u64) -> Result<(), ExtensionError> {
        self.store
            .set_fuel(fuel)
            .map_err(|error| ExtensionError::Runtime(error.to_string()))
    }

    fn fuel_left(&self) -> Result<u64, ExtensionError> {
        self.store
            .get_fuel()
            .map_err(|error| ExtensionError::Runtime(error.to_string()))
    }
}

fn check_imports(module: &Module) -> Result<(), ExtensionError> {
    for import in module.imports() {
        if import.module() != ABI_MODULE || !HOST_FUNCTIONS.contains(&import.name()) {
            return Err(ExtensionError::UnsupportedImport {
                module: import.module().to_owned(),
                name: import.name().to_owned(),
            });
        }
        let ExternType::Func(signature) = import.ty() else {
            return Err(ExtensionError::AbiMismatch {
                abi: ABI_MODULE,
                reason: format!("import `{}` is not a function", import.name()),
            });
        };
        let expected = expected_param_count(import.name());
        if signature.params().len() != expected
            || signature
                .params()
                .iter()
                .any(|param| *param != ValType::I32)
            || signature.results() != [ValType::I32].as_slice()
        {
            return Err(ExtensionError::AbiMismatch {
                abi: ABI_MODULE,
                reason: format!(
                    "import `{}` must have {expected} i32 parameters and one i32 result",
                    import.name()
                ),
            });
        }
    }
    Ok(())
}

/// Number of `i32` parameters each `openobsidian:ext/1` host function takes.
fn expected_param_count(name: &str) -> usize {
    match name {
        FN_OUTPUT_WRITE => 2,
        FN_LOG => 3,
        _ => 4,
    }
}

fn classify_instantiation_error(error: &wasmi::Error, limits: &ExtensionLimits) -> ExtensionError {
    match error.kind() {
        ErrorKind::Linker(_) => ExtensionError::AbiMismatch {
            abi: ABI_MODULE,
            reason: error.to_string(),
        },
        ErrorKind::Memory(_) | ErrorKind::Table(_) => {
            ExtensionError::ResourceLimit(error.to_string())
        }
        ErrorKind::Instantiation(
            InstantiationError::FailedToInstantiateMemory(_)
            | InstantiationError::FailedToInstantiateTable(_)
            | InstantiationError::TooManyInstances
            | InstantiationError::TooManyMemories
            | InstantiationError::TooManyTables,
        ) => ExtensionError::ResourceLimit(error.to_string()),
        ErrorKind::Instantiation(_) => ExtensionError::Instantiation(error.to_string()),
        _ => classify_runtime_error(error, limits),
    }
}

fn classify_runtime_error(error: &wasmi::Error, limits: &ExtensionLimits) -> ExtensionError {
    if let Some(abort) = error.downcast_ref::<HostAbort>() {
        return abort.clone().into();
    }
    match error.as_trap_code() {
        Some(TrapCode::OutOfFuel) => ExtensionError::FuelExhausted {
            budget: limits.fuel_per_call,
        },
        Some(TrapCode::StackOverflow) => ExtensionError::StackOverflow,
        Some(TrapCode::GrowthOperationLimited) => ExtensionError::ResourceLimit(error.to_string()),
        Some(_) => ExtensionError::Trap(error.to_string()),
        None => match error.kind() {
            ErrorKind::Memory(_) | ErrorKind::Table(_) => {
                ExtensionError::ResourceLimit(error.to_string())
            }
            _ => ExtensionError::Runtime(error.to_string()),
        },
    }
}

type HostResult = Result<i32, wasmi::Error>;

fn build_linker(engine: &Engine) -> Result<Linker<HostState>, ExtensionError> {
    let mut linker = Linker::new(engine);
    let link_error = |error: wasmi::errors::LinkerError| ExtensionError::Runtime(error.to_string());
    linker
        .func_wrap(
            ABI_MODULE,
            FN_VAULT_READ,
            |mut caller: Caller<'_, HostState>,
             path_ptr: i32,
             path_len: i32,
             out_ptr: i32,
             out_cap: i32|
             -> HostResult {
                begin_host_call(&mut caller)?;
                let Some(path) = read_str(&caller, path_ptr, path_len) else {
                    return Ok(STATUS_INVALID_ARGUMENT);
                };
                let response = broker_call(&mut caller, HostCapability::VaultRead, |broker, cx| {
                    broker.vault_read(cx, &path)
                });
                Ok(match response {
                    Ok(bytes) => write_out(&mut caller, out_ptr, out_cap, &bytes),
                    Err(status) => status,
                })
            },
        )
        .map_err(link_error)?
        .func_wrap(
            ABI_MODULE,
            FN_VAULT_PROPOSE_CHANGE,
            |mut caller: Caller<'_, HostState>,
             path_ptr: i32,
             path_len: i32,
             content_ptr: i32,
             content_len: i32|
             -> HostResult {
                begin_host_call(&mut caller)?;
                let (Some(path), Some(content)) = (
                    read_str(&caller, path_ptr, path_len),
                    read_bytes(&caller, content_ptr, content_len),
                ) else {
                    return Ok(STATUS_INVALID_ARGUMENT);
                };
                Ok(status_of(broker_call(
                    &mut caller,
                    HostCapability::VaultProposeChange,
                    |broker, cx| broker.vault_propose_change(cx, &path, &content),
                )))
            },
        )
        .map_err(link_error)?
        .func_wrap(
            ABI_MODULE,
            FN_LOG,
            |mut caller: Caller<'_, HostState>,
             level: i32,
             msg_ptr: i32,
             msg_len: i32|
             -> HostResult {
                begin_host_call(&mut caller)?;
                let (Some(level), Some(message)) = (
                    LogLevel::from_abi(level),
                    read_str(&caller, msg_ptr, msg_len),
                ) else {
                    return Ok(STATUS_INVALID_ARGUMENT);
                };
                Ok(status_of(broker_call(
                    &mut caller,
                    HostCapability::Log,
                    |broker, cx| broker.log(cx, level, &message),
                )))
            },
        )
        .map_err(link_error)?
        .func_wrap(
            ABI_MODULE,
            FN_COMMAND_REGISTER,
            |mut caller: Caller<'_, HostState>,
             id_ptr: i32,
             id_len: i32,
             name_ptr: i32,
             name_len: i32|
             -> HostResult {
                begin_host_call(&mut caller)?;
                let (Some(id), Some(name)) = (
                    read_str(&caller, id_ptr, id_len),
                    read_str(&caller, name_ptr, name_len),
                ) else {
                    return Ok(STATUS_INVALID_ARGUMENT);
                };
                Ok(status_of(broker_call(
                    &mut caller,
                    HostCapability::CommandRegister,
                    |broker, cx| broker.command_register(cx, &id, &name),
                )))
            },
        )
        .map_err(link_error)?
        .func_wrap(
            ABI_MODULE,
            FN_SETTINGS_GET,
            |mut caller: Caller<'_, HostState>,
             key_ptr: i32,
             key_len: i32,
             out_ptr: i32,
             out_cap: i32|
             -> HostResult {
                begin_host_call(&mut caller)?;
                let Some(key) = read_str(&caller, key_ptr, key_len) else {
                    return Ok(STATUS_INVALID_ARGUMENT);
                };
                let response =
                    broker_call(&mut caller, HostCapability::SettingsGet, |broker, cx| {
                        broker.settings_get(cx, &key)
                    });
                Ok(match response {
                    Ok(Some(bytes)) => write_out(&mut caller, out_ptr, out_cap, &bytes),
                    Ok(None) => STATUS_NOT_FOUND,
                    Err(status) => status,
                })
            },
        )
        .map_err(link_error)?
        .func_wrap(
            ABI_MODULE,
            FN_SETTINGS_SET,
            |mut caller: Caller<'_, HostState>,
             key_ptr: i32,
             key_len: i32,
             value_ptr: i32,
             value_len: i32|
             -> HostResult {
                begin_host_call(&mut caller)?;
                let (Some(key), Some(value)) = (
                    read_str(&caller, key_ptr, key_len),
                    read_bytes(&caller, value_ptr, value_len),
                ) else {
                    return Ok(STATUS_INVALID_ARGUMENT);
                };
                Ok(status_of(broker_call(
                    &mut caller,
                    HostCapability::SettingsSet,
                    |broker, cx| broker.settings_set(cx, &key, &value),
                )))
            },
        )
        .map_err(link_error)?
        .func_wrap(
            ABI_MODULE,
            FN_OUTPUT_WRITE,
            |mut caller: Caller<'_, HostState>, ptr: i32, len: i32| -> HostResult {
                begin_host_call(&mut caller)?;
                let Some(bytes) = read_bytes(&caller, ptr, len) else {
                    return Ok(STATUS_INVALID_ARGUMENT);
                };
                let state = caller.data_mut();
                if state.output.len().saturating_add(bytes.len()) > state.max_output_bytes {
                    return Err(wasmi::Error::host(HostAbort::OutputLimit(
                        state.max_output_bytes,
                    )));
                }
                state.output.extend_from_slice(&bytes);
                Ok(STATUS_OK)
            },
        )
        .map_err(link_error)?;
    Ok(linker)
}

/// Counts the host call and enforces the host-call budget and the wall-clock deadline.
fn begin_host_call(caller: &mut Caller<'_, HostState>) -> Result<(), wasmi::Error> {
    let state = caller.data_mut();
    state.host_calls = state.host_calls.saturating_add(1);
    if state.host_calls > state.max_host_calls {
        return Err(wasmi::Error::host(HostAbort::HostCallBudget(
            state.max_host_calls,
        )));
    }
    if Instant::now() >= state.deadline {
        return Err(wasmi::Error::host(HostAbort::Deadline(state.wall_clock)));
    }
    Ok(())
}

/// Applies the manifest gate, then asks the broker; records every policy denial.
fn broker_call<R>(
    caller: &mut Caller<'_, HostState>,
    capability: HostCapability,
    call: impl FnOnce(&dyn HostBroker, &HostCallContext<'_>) -> Result<R, HostDenial>,
) -> Result<R, i32> {
    let state = caller.data_mut();
    if !state.requested.contains(&capability) {
        let reason = format!("{capability} was not requested by the extension manifest");
        state.record_denial(capability, false, reason);
        return Err(STATUS_DENIED);
    }
    let result = call(state.broker.as_ref(), &state.context());
    result.map_err(|denial| {
        let status = denial.status();
        if denial.kind == HostDenialKind::Denied {
            state.record_denial(capability, true, denial.reason);
        }
        status
    })
}

fn status_of(result: Result<(), i32>) -> i32 {
    result.err().unwrap_or(STATUS_OK)
}

fn guest_memory(caller: &Caller<'_, HostState>) -> Option<Memory> {
    caller
        .get_export(EXPORT_MEMORY)
        .and_then(Extern::into_memory)
}

fn read_bytes(caller: &Caller<'_, HostState>, ptr: i32, len: i32) -> Option<Vec<u8>> {
    let offset = usize::try_from(u32::try_from(ptr).ok()?).ok()?;
    let len = usize::try_from(u32::try_from(len).ok()?).ok()?;
    if len > caller.data().max_host_arg_bytes {
        return None;
    }
    let memory = guest_memory(caller)?;
    let mut buffer = vec![0; len];
    memory.read(caller, offset, &mut buffer).ok()?;
    Some(buffer)
}

fn read_str(caller: &Caller<'_, HostState>, ptr: i32, len: i32) -> Option<String> {
    String::from_utf8(read_bytes(caller, ptr, len)?).ok()
}

/// Writes `bytes` to guest memory; returns the byte count or a negative status.
fn write_out(caller: &mut Caller<'_, HostState>, ptr: i32, cap: i32, bytes: &[u8]) -> i32 {
    let (Ok(offset), Ok(cap)) = (u32::try_from(ptr), u32::try_from(cap)) else {
        return STATUS_INVALID_ARGUMENT;
    };
    let Ok(written) = i32::try_from(bytes.len()) else {
        return STATUS_BUFFER_TOO_SMALL;
    };
    if bytes.len() > cap as usize {
        return STATUS_BUFFER_TOO_SMALL;
    }
    let Some(memory) = guest_memory(caller) else {
        return STATUS_INVALID_ARGUMENT;
    };
    match memory.write(caller, offset as usize, bytes) {
        Ok(()) => written,
        Err(_) => STATUS_INVALID_ARGUMENT,
    }
}
