//! Limit-breach, ABI and broker-denial tests. Modules are built from inline WAT.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::abi::{
    STATUS_BUFFER_TOO_SMALL, STATUS_DENIED, STATUS_INVALID_ARGUMENT, STATUS_NOT_FOUND, STATUS_OK,
};
use super::limits::WASM_PAGE_BYTES;
use super::package::sha256_hex;
use super::*;

const IMPORTS_ALL: &str = r#"
  (import "openobsidian:ext/1" "vault_read" (func $vault_read (param i32 i32 i32 i32) (result i32)))
  (import "openobsidian:ext/1" "vault_propose_change" (func $propose (param i32 i32 i32 i32) (result i32)))
  (import "openobsidian:ext/1" "log" (func $log (param i32 i32 i32) (result i32)))
  (import "openobsidian:ext/1" "command_register" (func $command (param i32 i32 i32 i32) (result i32)))
  (import "openobsidian:ext/1" "settings_get" (func $settings_get (param i32 i32 i32 i32) (result i32)))
  (import "openobsidian:ext/1" "settings_set" (func $settings_set (param i32 i32 i32 i32) (result i32)))
  (import "openobsidian:ext/1" "output_write" (func $output (param i32 i32) (result i32)))
"#;

/// Exports one entry point per host function. Data: path at 0 (10 bytes), text at 32.
const CALL_EVERY_HOST_FUNCTION: &str = r#"
  (data (i32.const 0) "notes/a.md")
  (data (i32.const 32) "hello")
  (func (export "vault_read") (result i32)
    (call $vault_read (i32.const 0) (i32.const 10) (i32.const 1024) (i32.const 256)))
  (func (export "vault_propose_change") (result i32)
    (call $propose (i32.const 0) (i32.const 10) (i32.const 32) (i32.const 5)))
  (func (export "log") (result i32)
    (call $log (i32.const 2) (i32.const 32) (i32.const 5)))
  (func (export "command_register") (result i32)
    (call $command (i32.const 32) (i32.const 5) (i32.const 32) (i32.const 5)))
  (func (export "settings_get") (result i32)
    (call $settings_get (i32.const 32) (i32.const 5) (i32.const 1024) (i32.const 256)))
  (func (export "settings_set") (result i32)
    (call $settings_set (i32.const 32) (i32.const 5) (i32.const 32) (i32.const 5)))
"#;

const ENTRY_POINTS: [(&str, HostCapability); 6] = [
    ("vault_read", HostCapability::VaultRead),
    ("vault_propose_change", HostCapability::VaultProposeChange),
    ("log", HostCapability::Log),
    ("command_register", HostCapability::CommandRegister),
    ("settings_get", HostCapability::SettingsGet),
    ("settings_set", HostCapability::SettingsSet),
];

/// A conforming module: imports, one-page exported memory, ABI version export, `body`.
fn ext(imports: &str, body: &str) -> String {
    format!(
        r#"(module {imports}
  (memory (export "memory") 1)
  (func (export "oo_abi_version") (result i32) i32.const 1)
  {body})"#
    )
}

fn package_from_bytes(wasm: Vec<u8>, capabilities: &[&str]) -> ExtensionPackage {
    let manifest = ExtensionManifest {
        id: "test-ext".to_owned(),
        version: "1.0.0".to_owned(),
        abi: ABI_ID.to_owned(),
        capabilities: capabilities.iter().map(|name| (*name).to_owned()).collect(),
        module: "test.wasm".to_owned(),
        sha256: sha256_hex(&wasm),
    };
    ExtensionPackage::new(manifest, wasm).expect("valid test package")
}

fn package(wat: &str, capabilities: &[&str]) -> ExtensionPackage {
    package_from_bytes(wat::parse_str(wat).expect("valid WAT"), capabilities)
}

fn host(limits: ExtensionLimits) -> ExtensionHost {
    ExtensionHost::new(limits).expect("valid limits")
}

fn load(wat: &str) -> Result<ExtensionInstance, ExtensionError> {
    host(ExtensionLimits::default()).load(&package(wat, &[]), Arc::new(DenyAllBroker))
}

fn all_capabilities() -> Vec<&'static str> {
    HostCapability::ALL
        .into_iter()
        .map(HostCapability::as_str)
        .collect()
}

#[test]
fn runs_a_trivial_entry_point() {
    let mut instance = load(&ext(
        "",
        r#"(func (export "run") (result i32) i32.const 42)"#,
    ))
    .expect("load");
    let outcome = instance.call("run").expect("call");
    assert_eq!(outcome.status, 42);
    assert!(outcome.output.is_empty());
    assert_eq!(outcome.host_calls, 0);
    assert!(!instance.is_poisoned());
    assert_eq!(instance.call("run").expect("second call").status, 42);
}

#[test]
fn infinite_loop_exhausts_fuel_and_poisons_the_instance() {
    let limits = ExtensionLimits {
        fuel_per_call: 2_000_000,
        fuel_slice: 100_000,
        wall_clock: Duration::from_secs(30),
        ..ExtensionLimits::default()
    };
    let wat = ext(
        "",
        r#"(func (export "spin") (result i32) (loop $l (br $l)) i32.const 0)"#,
    );
    let mut instance = host(limits)
        .load(&package(&wat, &[]), Arc::new(DenyAllBroker))
        .expect("load");
    assert_eq!(
        instance.call("spin"),
        Err(ExtensionError::FuelExhausted { budget: 2_000_000 })
    );
    assert!(instance.is_poisoned());
    assert_eq!(instance.call("spin"), Err(ExtensionError::Poisoned));
}

#[test]
fn infinite_loop_hits_the_wall_clock_deadline() {
    let limits = ExtensionLimits {
        fuel_per_call: u64::MAX / 4,
        fuel_slice: 50_000,
        wall_clock: Duration::from_millis(50),
        ..ExtensionLimits::default()
    };
    let wat = ext(
        "",
        r#"(func (export "spin") (result i32) (loop $l (br $l)) i32.const 0)"#,
    );
    let mut instance = host(limits)
        .load(&package(&wat, &[]), Arc::new(DenyAllBroker))
        .expect("load");
    let started = Instant::now();
    assert_eq!(
        instance.call("spin"),
        Err(ExtensionError::DeadlineExceeded {
            limit: Duration::from_millis(50)
        })
    );
    assert!(started.elapsed() < Duration::from_secs(20));
}

#[test]
fn infinite_start_function_is_bounded_during_load() {
    let limits = ExtensionLimits {
        fuel_per_call: 1_000_000,
        fuel_slice: 100_000,
        ..ExtensionLimits::default()
    };
    let wat = ext("", r#"(func $start (loop $l (br $l))) (start $start)"#);
    let result = host(limits).load(&package(&wat, &[]), Arc::new(DenyAllBroker));
    assert!(
        matches!(result, Err(ExtensionError::FuelExhausted { .. })),
        "{result:?}"
    );
}

#[test]
fn memory_growth_beyond_the_limit_is_refused() {
    let limits = ExtensionLimits {
        max_memory_bytes: 2 * WASM_PAGE_BYTES,
        ..ExtensionLimits::default()
    };
    let wat = ext(
        "",
        r#"
  (func (export "grow_one") (result i32) (memory.grow (i32.const 1)))
  (func (export "grow_many") (result i32) (memory.grow (i32.const 1000)))
  (func (export "size") (result i32) (memory.size))"#,
    );
    let mut instance = host(limits)
        .load(&package(&wat, &[]), Arc::new(DenyAllBroker))
        .expect("load");
    assert_eq!(instance.call("grow_many").expect("grow").status, -1);
    assert_eq!(instance.call("grow_one").expect("grow").status, 1);
    assert_eq!(instance.call("grow_one").expect("grow").status, -1);
    assert_eq!(instance.call("size").expect("size").status, 2);
}

#[test]
fn memory_bomb_in_initial_size_fails_to_load() {
    let limits = ExtensionLimits {
        max_memory_bytes: 2 * WASM_PAGE_BYTES,
        ..ExtensionLimits::default()
    };
    let wat = r#"(module
  (memory (export "memory") 1000)
  (func (export "oo_abi_version") (result i32) i32.const 1))"#;
    let result = host(limits).load(&package(wat, &[]), Arc::new(DenyAllBroker));
    assert!(
        matches!(result, Err(ExtensionError::ResourceLimit(_))),
        "{result:?}"
    );
}

#[test]
fn table_beyond_the_limit_fails_to_load_and_cannot_grow() {
    let limits = ExtensionLimits {
        max_table_elements: 16,
        ..ExtensionLimits::default()
    };
    let large = ext("", "(table 1000 funcref)");
    let result = host(limits.clone()).load(&package(&large, &[]), Arc::new(DenyAllBroker));
    assert!(
        matches!(result, Err(ExtensionError::ResourceLimit(_))),
        "{result:?}"
    );

    let growing = ext(
        "",
        r#"(table $t 1 funcref)
  (func (export "grow") (result i32) (table.grow $t (ref.null func) (i32.const 100)))"#,
    );
    let mut instance = host(limits)
        .load(&package(&growing, &[]), Arc::new(DenyAllBroker))
        .expect("load");
    assert_eq!(instance.call("grow").expect("grow").status, -1);
}

#[test]
fn deep_recursion_overflows_the_bounded_stack() {
    let wat = ext(
        "",
        r#"(func $recurse (export "recurse") (result i32) (call $recurse))"#,
    );
    let mut instance = load(&wat).expect("load");
    assert_eq!(instance.call("recurse"), Err(ExtensionError::StackOverflow));
    assert!(instance.is_poisoned());
}

#[test]
fn guest_traps_are_typed_errors() {
    let wat = ext(
        "",
        r#"
  (func (export "unreachable") (result i32) unreachable)
  (func (export "oob") (result i32) (i32.load (i32.const 70000)))
  (func (export "div") (result i32) (i32.div_s (i32.const 1) (i32.const 0)))"#,
    );
    for export in ["unreachable", "oob", "div"] {
        let mut instance = load(&wat).expect("load");
        let result = instance.call(export);
        assert!(
            matches!(result, Err(ExtensionError::Trap(_))),
            "{export}: {result:?}"
        );
    }
}

#[test]
fn malformed_wasm_is_rejected_without_panicking() {
    let host = host(ExtensionLimits::default());
    for bytes in [
        Vec::new(),
        b"not wasm".to_vec(),
        b"\0asm\x02\0\0\0".to_vec(),
        b"\0asm\x01\0\0\0\xff\xff\xff".to_vec(),
    ] {
        let result = host.load(&package_from_bytes(bytes, &[]), Arc::new(DenyAllBroker));
        assert!(
            matches!(result, Err(ExtensionError::InvalidModule(_))),
            "{result:?}"
        );
    }

    // Every truncation and single-byte corruption of a valid module either fails with a
    // typed error or yields a module that still runs within limits; none panics.
    let valid = wat::parse_str(ext(
        IMPORTS_ALL,
        &format!(
            "{CALL_EVERY_HOST_FUNCTION}\n(func (export \"run\") (result i32) (loop $l (br $l)) i32.const 0)"
        ),
    ))
    .expect("valid WAT");
    let limits = ExtensionLimits {
        fuel_per_call: 200_000,
        fuel_slice: 50_000,
        ..ExtensionLimits::default()
    };
    let bounded = ExtensionHost::new(limits).expect("limits");
    let mut candidates: Vec<Vec<u8>> = (0..valid.len()).map(|len| valid[..len].to_vec()).collect();
    for index in 0..valid.len() {
        let mut corrupted = valid.clone();
        corrupted[index] ^= 0x5a;
        candidates.push(corrupted);
    }
    for bytes in candidates {
        let package = package_from_bytes(bytes, &all_capabilities());
        if let Ok(mut instance) = bounded.load(&package, Arc::new(DenyAllBroker)) {
            let _ = instance.call("run");
        }
    }
}

#[test]
fn oversized_module_is_rejected_before_compilation() {
    let limits = ExtensionLimits {
        max_module_bytes: 16,
        ..ExtensionLimits::default()
    };
    let wat = ext("", "");
    let result = host(limits).load(&package(&wat, &[]), Arc::new(DenyAllBroker));
    assert!(
        matches!(
            result,
            Err(ExtensionError::ModuleTooLarge { limit: 16, .. })
        ),
        "{result:?}"
    );
}

#[test]
fn wrong_abi_is_rejected() {
    // Wrong ABI version export.
    let wrong_version = r#"(module
  (memory (export "memory") 1)
  (func (export "oo_abi_version") (result i32) i32.const 2))"#;
    assert!(matches!(
        load(wrong_version),
        Err(ExtensionError::AbiMismatch { .. })
    ));

    // Wrong ABI version export type.
    let wrong_type = r#"(module
  (memory (export "memory") 1)
  (func (export "oo_abi_version") (result i64) i64.const 1))"#;
    assert!(matches!(
        load(wrong_type),
        Err(ExtensionError::AbiMismatch { .. })
    ));

    // Missing ABI version export and missing memory export.
    assert_eq!(
        load(r#"(module (memory (export "memory") 1))"#).map(|_| ()),
        Err(ExtensionError::MissingExport("oo_abi_version".to_owned()))
    );
    assert_eq!(
        load(r#"(module (func (export "oo_abi_version") (result i32) i32.const 1))"#).map(|_| ()),
        Err(ExtensionError::MissingExport("memory".to_owned()))
    );

    // Imports from another ABI namespace, WASI, or an unknown host function.
    for (module, name) in [
        ("openobsidian:ext/2", "log"),
        ("wasi_snapshot_preview1", "fd_write"),
        ("openobsidian:ext/1", "network_fetch"),
    ] {
        let wat = ext(
            &format!(r#"(import "{module}" "{name}" (func (param i32 i32 i32) (result i32)))"#),
            "",
        );
        assert_eq!(
            load(&wat).map(|_| ()),
            Err(ExtensionError::UnsupportedImport {
                module: module.to_owned(),
                name: name.to_owned(),
            })
        );
    }

    // Known host function with the wrong signature.
    let wrong_signature = ext(
        r#"(import "openobsidian:ext/1" "log" (func (param i32) (result i32)))"#,
        "",
    );
    assert!(matches!(
        load(&wrong_signature),
        Err(ExtensionError::AbiMismatch { .. })
    ));

    // Entry point with the wrong signature.
    let mut instance = load(&ext(
        "",
        r#"(func (export "run") (param i32) (result i32) local.get 0)"#,
    ))
    .expect("load");
    assert!(matches!(
        instance.call("run"),
        Err(ExtensionError::AbiMismatch { .. })
    ));

    let mut instance = load(&ext("", "")).expect("load");
    assert_eq!(
        instance.call("absent"),
        Err(ExtensionError::MissingExport("absent".to_owned()))
    );
}

#[test]
fn host_call_budget_is_enforced() {
    let limits = ExtensionLimits {
        max_host_calls: 5,
        ..ExtensionLimits::default()
    };
    let wat = ext(
        r#"(import "openobsidian:ext/1" "log" (func $log (param i32 i32 i32) (result i32)))"#,
        r#"
  (func (export "chatty") (result i32)
    (local $i i32)
    (loop $l
      (drop (call $log (i32.const 2) (i32.const 0) (i32.const 0)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $l (i32.lt_u (local.get $i) (i32.const 10))))
    (local.get $i))
  (func (export "quiet") (result i32)
    (call $log (i32.const 2) (i32.const 0) (i32.const 0)))"#,
    );
    let host = host(limits);
    let package = package(&wat, &["log"]);
    let mut instance = host.load(&package, Arc::new(DenyAllBroker)).expect("load");
    assert_eq!(
        instance.call("chatty"),
        Err(ExtensionError::HostCallBudget { limit: 5 })
    );

    // The budget is per call: a fresh instance can make calls up to the budget.
    let mut instance = host
        .load(&package, Arc::new(DenyAllBroker))
        .expect("reload");
    for _ in 0..3 {
        let outcome = instance.call("quiet").expect("within budget");
        assert_eq!(outcome.status, STATUS_DENIED);
        assert_eq!(outcome.host_calls, 1);
    }
}

#[test]
fn every_host_call_is_denied_by_default() {
    let wat = ext(IMPORTS_ALL, CALL_EVERY_HOST_FUNCTION);
    let mut instance = host(ExtensionLimits::default())
        .load(&package(&wat, &all_capabilities()), Arc::new(DenyAllBroker))
        .expect("load");
    for (export, _) in ENTRY_POINTS {
        assert_eq!(
            instance.call(export).expect("call").status,
            STATUS_DENIED,
            "{export}"
        );
    }
    let denials = instance.denials();
    assert_eq!(denials.len(), ENTRY_POINTS.len());
    for (record, (_, capability)) in denials.iter().zip(ENTRY_POINTS) {
        assert_eq!(record.capability, capability);
        assert_eq!(record.extension_id, "test-ext");
        assert!(record.requested_by_manifest);
        assert!(record.reason.contains(capability.as_str()));
    }
}

/// Grants everything and records what it was asked.
#[derive(Default)]
struct GrantingBroker {
    calls: AtomicU32,
    log: Mutex<Vec<String>>,
}

impl HostBroker for GrantingBroker {
    fn vault_read(&self, _cx: &HostCallContext<'_>, path: &str) -> Result<Vec<u8>, HostDenial> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(format!("content of {path}").into_bytes())
    }

    fn vault_propose_change(
        &self,
        _cx: &HostCallContext<'_>,
        _path: &str,
        _content: &[u8],
    ) -> Result<(), HostDenial> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    fn log(
        &self,
        cx: &HostCallContext<'_>,
        _level: LogLevel,
        message: &str,
    ) -> Result<(), HostDenial> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut log) = self.log.lock() {
            log.push(format!("{}: {message}", cx.extension_id));
        }
        Ok(())
    }

    fn command_register(
        &self,
        _cx: &HostCallContext<'_>,
        _command_id: &str,
        _name: &str,
    ) -> Result<(), HostDenial> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    fn settings_get(
        &self,
        _cx: &HostCallContext<'_>,
        _key: &str,
    ) -> Result<Option<Vec<u8>>, HostDenial> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(None)
    }

    fn settings_set(
        &self,
        _cx: &HostCallContext<'_>,
        _key: &str,
        _value: &[u8],
    ) -> Result<(), HostDenial> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

#[test]
fn capabilities_not_requested_by_the_manifest_never_reach_the_broker() {
    let broker = Arc::new(GrantingBroker::default());
    let wat = ext(IMPORTS_ALL, CALL_EVERY_HOST_FUNCTION);
    let mut instance = host(ExtensionLimits::default())
        .load(&package(&wat, &[]), broker.clone())
        .expect("load");
    for (export, _) in ENTRY_POINTS {
        assert_eq!(
            instance.call(export).expect("call").status,
            STATUS_DENIED,
            "{export}"
        );
    }
    assert_eq!(broker.calls.load(Ordering::SeqCst), 0);
    assert_eq!(instance.denials().len(), ENTRY_POINTS.len());
    assert!(
        instance
            .denials()
            .iter()
            .all(|record| !record.requested_by_manifest)
    );
}

#[test]
fn granted_calls_reach_the_broker_and_return_bounded_output() {
    let broker = Arc::new(GrantingBroker::default());
    let body = format!(
        r#"{CALL_EVERY_HOST_FUNCTION}
  (func (export "read_and_echo") (result i32)
    (local $n i32)
    (local.set $n (call $vault_read (i32.const 0) (i32.const 10) (i32.const 1024) (i32.const 256)))
    (drop (call $output (i32.const 1024) (local.get $n)))
    (local.get $n))
  (func (export "read_too_small") (result i32)
    (call $vault_read (i32.const 0) (i32.const 10) (i32.const 1024) (i32.const 4)))
  (func (export "read_out_of_bounds") (result i32)
    (call $vault_read (i32.const 0) (i32.const 10) (i32.const 65530) (i32.const 256)))
  (func (export "bad_path_pointer") (result i32)
    (call $vault_read (i32.const 65530) (i32.const 100) (i32.const 1024) (i32.const 256)))
  (func (export "bad_log_level") (result i32)
    (call $log (i32.const 99) (i32.const 32) (i32.const 5)))"#
    );
    let wat = ext(IMPORTS_ALL, &body);
    let mut instance = host(ExtensionLimits::default())
        .load(&package(&wat, &all_capabilities()), broker.clone())
        .expect("load");

    let outcome = instance.call("read_and_echo").expect("call");
    assert_eq!(outcome.output, b"content of notes/a.md");
    assert_eq!(outcome.status, 21);
    assert_eq!(outcome.host_calls, 2);
    assert!(outcome.fuel_consumed > 0);

    assert_eq!(
        instance.call("vault_propose_change").expect("call").status,
        STATUS_OK
    );
    assert_eq!(instance.call("log").expect("call").status, STATUS_OK);
    assert_eq!(
        instance.call("command_register").expect("call").status,
        STATUS_OK
    );
    assert_eq!(
        instance.call("settings_get").expect("call").status,
        STATUS_NOT_FOUND
    );
    assert_eq!(
        instance.call("settings_set").expect("call").status,
        STATUS_OK
    );
    assert_eq!(
        instance.call("read_too_small").expect("call").status,
        STATUS_BUFFER_TOO_SMALL
    );
    assert_eq!(
        instance.call("read_out_of_bounds").expect("call").status,
        STATUS_INVALID_ARGUMENT
    );
    assert_eq!(
        instance.call("bad_path_pointer").expect("call").status,
        STATUS_INVALID_ARGUMENT
    );
    assert_eq!(
        instance.call("bad_log_level").expect("call").status,
        STATUS_INVALID_ARGUMENT
    );
    assert!(instance.denials().is_empty());
    assert_eq!(
        broker.log.lock().map(|log| log.clone()).unwrap_or_default(),
        vec!["test-ext: hello".to_owned()]
    );
}

#[test]
fn output_beyond_the_limit_aborts_the_call() {
    let limits = ExtensionLimits {
        max_output_bytes: 4,
        ..ExtensionLimits::default()
    };
    let wat = ext(
        IMPORTS_ALL,
        r#"
  (func (export "small") (result i32) (call $output (i32.const 0) (i32.const 4)))
  (func (export "large") (result i32) (call $output (i32.const 0) (i32.const 8)))"#,
    );
    let host = host(limits);
    let package = package(&wat, &[]);
    let mut instance = host.load(&package, Arc::new(DenyAllBroker)).expect("load");
    let outcome = instance.call("small").expect("within limit");
    assert_eq!(outcome.output.len(), 4);
    assert_eq!(
        instance.call("large"),
        Err(ExtensionError::OutputLimit { limit: 4 })
    );
}

#[test]
fn unusable_limits_are_rejected() {
    for limits in [
        ExtensionLimits {
            fuel_per_call: 0,
            ..ExtensionLimits::default()
        },
        ExtensionLimits {
            fuel_slice: 0,
            ..ExtensionLimits::default()
        },
        ExtensionLimits {
            fuel_per_call: 10,
            fuel_slice: 20,
            ..ExtensionLimits::default()
        },
        ExtensionLimits {
            wall_clock: Duration::ZERO,
            ..ExtensionLimits::default()
        },
    ] {
        assert!(matches!(
            ExtensionHost::new(limits),
            Err(ExtensionError::Limits(_))
        ));
    }
}
