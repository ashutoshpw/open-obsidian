use openobsidian_plugins::LegacyCompatibility;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    borrow::Cow,
    env,
    fmt::Write as _,
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use winit::{
    application::ApplicationHandler,
    event::WindowEvent,
    event_loop::{ActiveEventLoop, ControlFlow, EventLoop, EventLoopProxy},
    window::{Window, WindowId},
};
use wry::{NewWindowResponse, PermissionResponse, WebView, WebViewBuilder, http::header};

const HTML: &str = r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>OpenObsidian plugin runtime probe</title>
  <link rel="stylesheet" href="/theme.css">
  <script defer src="/runner.js"></script>
</head>
<body><main id="openobsidian-plugin-root" class="workspace"></main></body>
</html>"#;

const CSP: &str = "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src 'none'; connect-src 'none'; frame-src 'none'; frame-ancestors 'none'; child-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
const INTERNAL_SCHEME: &str = "openobsidian-plugin";
const RUNNER_JS: &str = include_str!("runner.js");
const MAX_IPC_MESSAGE_BYTES: usize = 256 * 1024;
const MAX_IPC_MESSAGES: u32 = 128;
const MAX_IPC_TOTAL_BYTES: usize = 1024 * 1024;
const MAX_PROGRESS_ELAPSED_MS: u64 = 30_000;

#[derive(Clone)]
struct RuntimeAssets {
    runner: Arc<Vec<u8>>,
    stylesheet: Arc<Vec<u8>>,
    runner_served: Arc<AtomicBool>,
}

#[derive(Debug)]
struct Arguments {
    plugin_id: String,
    plugin_version: String,
    bundle_path: PathBuf,
    bundle_sha256: String,
    manifest_path: PathBuf,
    manifest_sha256: String,
    stylesheet_path: Option<PathBuf>,
    stylesheet_sha256: Option<String>,
    theme_settings_sha256: Option<String>,
    workflow_fixture: PathBuf,
}

#[derive(Debug)]
enum ProbeEvent {
    IpcMessage(String),
}

#[derive(Clone, Default)]
struct IpcDiagnostics {
    received_messages: u32,
    received_bytes: usize,
    budget_exceeded_messages: u32,
    budget_exhausted: bool,
    oversized_messages: u32,
    send_failures: u32,
    malformed_messages: u32,
    token_mismatches: u32,
    unknown_messages: u32,
    invalid_progress: u32,
}

#[derive(Clone)]
struct ProbeProgress {
    stage: String,
    phase: String,
    elapsed_ms: u64,
    callback_index: Option<u64>,
    invoked_callbacks: Option<u64>,
    completed_callbacks: Option<u64>,
}

struct ProbeApp {
    proxy: EventLoopProxy<ProbeEvent>,
    assets: RuntimeAssets,
    ipc_diagnostics: Arc<Mutex<IpcDiagnostics>>,
    window: Option<Window>,
    _webview: Option<WebView>,
    session_token: String,
    probe_context: Value,
    started_at: Instant,
    deadline: Instant,
    last_progress: Option<ProbeProgress>,
    result: Option<Value>,
}

impl ApplicationHandler<ProbeEvent> for ProbeApp {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }

        let window = match event_loop.create_window(
            Window::default_attributes()
                .with_title("OpenObsidian isolated plugin probe")
                .with_visible(false),
        ) {
            Ok(window) => window,
            Err(error) => {
                self.finish_error(
                    event_loop,
                    "window_creation_failed",
                    format!("window creation failed: {error}"),
                );
                return;
            }
        };

        let assets = self.assets.clone();
        let ipc_proxy = self.proxy.clone();
        let ipc_diagnostics = Arc::clone(&self.ipc_diagnostics);
        let builder = WebViewBuilder::new()
            .with_custom_protocol(INTERNAL_SCHEME.to_owned(), move |_webview_id, request| {
                serve_request(request, &assets)
            })
            .with_url(format!("{INTERNAL_SCHEME}://localhost/index.html"))
            .with_ipc_handler(move |request| {
                let body = request.body();
                let mut diagnostics = ipc_diagnostics
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                diagnostics.received_messages = diagnostics.received_messages.saturating_add(1);
                if diagnostics.budget_exhausted {
                    diagnostics.budget_exceeded_messages =
                        diagnostics.budget_exceeded_messages.saturating_add(1);
                    return;
                }
                if diagnostics.received_messages > MAX_IPC_MESSAGES {
                    diagnostics.budget_exhausted = true;
                    diagnostics.budget_exceeded_messages =
                        diagnostics.budget_exceeded_messages.saturating_add(1);
                    return;
                }
                let remaining_bytes =
                    MAX_IPC_TOTAL_BYTES.saturating_sub(diagnostics.received_bytes);
                if body.len() > remaining_bytes {
                    diagnostics.received_bytes = MAX_IPC_TOTAL_BYTES;
                    diagnostics.budget_exhausted = true;
                    diagnostics.budget_exceeded_messages =
                        diagnostics.budget_exceeded_messages.saturating_add(1);
                    return;
                }
                diagnostics.received_bytes += body.len();
                if body.len() > MAX_IPC_MESSAGE_BYTES {
                    diagnostics.oversized_messages =
                        diagnostics.oversized_messages.saturating_add(1);
                    return;
                }
                drop(diagnostics);
                if ipc_proxy
                    .send_event(ProbeEvent::IpcMessage(body.clone()))
                    .is_err()
                {
                    let mut diagnostics = ipc_diagnostics
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    diagnostics.send_failures = diagnostics.send_failures.saturating_add(1);
                }
            })
            .with_navigation_handler(|url| is_internal_document(&url))
            .with_new_window_req_handler(|_, _| NewWindowResponse::Deny)
            .with_download_started_handler(|_, _| false)
            .with_permission_handler(|_| PermissionResponse::Deny)
            .with_drag_drop_handler(|_| true)
            .with_clipboard(false)
            .with_general_autofill_enabled(false)
            .with_incognito(true)
            .with_devtools(false)
            .with_visible(false);

        match builder.build_as_child(&window) {
            Ok(webview) => {
                self.window = Some(window);
                self._webview = Some(webview);
            }
            Err(error) => self.finish_error(
                event_loop,
                "webview_creation_failed",
                format!("webview creation failed: {error}"),
            ),
        }
    }

    fn user_event(&mut self, event_loop: &ActiveEventLoop, event: ProbeEvent) {
        if Instant::now() >= self.deadline {
            self.finish_error(
                event_loop,
                "webview_probe_timeout",
                "WebView probe timed out before IPC event handling completed".to_owned(),
            );
            return;
        }
        let budget_exhausted = self
            .ipc_diagnostics
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .budget_exhausted;
        if budget_exhausted {
            self.finish_error(
                event_loop,
                "ipc_message_budget_exceeded",
                "WebView probe exceeded its bounded IPC message budget".to_owned(),
            );
            return;
        }
        match event {
            ProbeEvent::IpcMessage(message) => {
                let Ok(value) = serde_json::from_str::<Value>(&message) else {
                    self.record_ipc_failure(|diagnostics| {
                        diagnostics.malformed_messages =
                            diagnostics.malformed_messages.saturating_add(1);
                    });
                    return;
                };
                if value["token"].as_str() != Some(self.session_token.as_str()) {
                    self.record_ipc_failure(|diagnostics| {
                        diagnostics.token_mismatches =
                            diagnostics.token_mismatches.saturating_add(1);
                    });
                    return;
                }
                match value["type"].as_str() {
                    Some("progress") => {
                        if let Some(progress) = parse_progress(&value) {
                            self.last_progress = Some(progress);
                        } else {
                            self.record_ipc_failure(|diagnostics| {
                                diagnostics.invalid_progress =
                                    diagnostics.invalid_progress.saturating_add(1);
                            });
                        }
                    }
                    Some("report") => {
                        if !value["report"].is_object() {
                            self.record_ipc_failure(|diagnostics| {
                                diagnostics.malformed_messages =
                                    diagnostics.malformed_messages.saturating_add(1);
                            });
                            return;
                        }
                        if Instant::now() >= self.deadline {
                            self.finish_error(
                                event_loop,
                                "webview_probe_timeout",
                                "WebView report arrived after the probe deadline".to_owned(),
                            );
                            return;
                        }
                        let report_post_started =
                            self.last_progress.as_ref().is_some_and(|progress| {
                                progress.stage == "report-post" && progress.phase == "start"
                            });
                        if !report_post_started {
                            self.finish_error(
                                event_loop,
                                "missing_report_post_progress",
                                "WebView final report arrived without host-observed report IPC progress".to_owned(),
                            );
                            return;
                        }
                        let mut report = value["report"].clone();
                        if let Some(report_object) = report.as_object_mut() {
                            let diagnostics = report_object
                                .entry("probeDiagnostics".to_owned())
                                .or_insert_with(|| json!({}));
                            if let Some(diagnostics) = diagnostics.as_object_mut() {
                                diagnostics.insert(
                                    "host".to_owned(),
                                    host_diagnostics(
                                        self.started_at,
                                        &self.last_progress,
                                        &self.ipc_diagnostics,
                                    ),
                                );
                            }
                        }
                        if Instant::now() >= self.deadline {
                            self.finish_error(
                                event_loop,
                                "webview_probe_timeout",
                                "WebView report processing exceeded the probe deadline".to_owned(),
                            );
                            return;
                        }
                        let budget_exhausted = self
                            .ipc_diagnostics
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner())
                            .budget_exhausted;
                        if budget_exhausted {
                            self.finish_error(
                                event_loop,
                                "ipc_message_budget_exceeded",
                                "WebView probe exceeded its bounded IPC message budget".to_owned(),
                            );
                            return;
                        }
                        self.result = Some(report);
                        event_loop.exit();
                    }
                    _ => self.record_ipc_failure(|diagnostics| {
                        diagnostics.unknown_messages =
                            diagnostics.unknown_messages.saturating_add(1);
                    }),
                }
            }
        }
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        event: WindowEvent,
    ) {
        if matches!(event, WindowEvent::CloseRequested) {
            self.finish_error(
                event_loop,
                "window_closed_before_report",
                "probe window closed before report".to_owned(),
            );
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        #[cfg(target_os = "linux")]
        while gtk::events_pending() {
            gtk::main_iteration_do(false);
        }

        if Instant::now() >= self.deadline && self.result.is_none() {
            self.finish_error(
                event_loop,
                "webview_probe_timeout",
                "WebView probe timed out".to_owned(),
            );
        }
        #[cfg(target_os = "linux")]
        event_loop.set_control_flow(ControlFlow::WaitUntil(
            (Instant::now() + Duration::from_millis(10)).min(self.deadline),
        ));
        #[cfg(not(target_os = "linux"))]
        event_loop.set_control_flow(ControlFlow::WaitUntil(self.deadline));
    }
}

impl ProbeApp {
    fn record_ipc_failure(&self, update: impl FnOnce(&mut IpcDiagnostics)) {
        let mut diagnostics = self
            .ipc_diagnostics
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        update(&mut diagnostics);
    }

    fn finish_error(&mut self, event_loop: &ActiveEventLoop, code: &str, error: String) {
        self.result = Some(json!({
            "status":"failed",
            "error":error,
            "expectedArtifact": {
                "pluginId":self.probe_context["pluginId"].clone(),
                "pluginVersion":self.probe_context["pluginVersion"].clone(),
                "bundleSha256":self.probe_context["expectedBundleSha256"].clone(),
                "manifestSha256":self.probe_context["expectedManifestSha256"].clone(),
            },
            "expectedRuntime":self.probe_context["runtime"].clone(),
            "probeDiagnostics": {
                "status":"failed",
                "failureCode":code,
                "elapsedMs":self.started_at.elapsed().as_millis(),
                "lastStage":progress_value(&self.last_progress),
                "identity":self.probe_context,
                "host":ipc_diagnostics_value(&self.ipc_diagnostics),
            }
        }));
        event_loop.exit();
    }
}

fn main() {
    match run() {
        Ok(report) => println!("{}", report),
        Err(error) => {
            eprintln!("Rust plugin runtime probe: {error}");
            std::process::exit(2);
        }
    }
}

fn run() -> Result<Value, String> {
    let arguments = parse_arguments()?;
    let bundle = fs::read(&arguments.bundle_path)
        .map_err(|error| format!("could not read plugin bundle: {error}"))?;
    let bundle_sha256 = sha256(&bundle);
    if !bundle_sha256.eq_ignore_ascii_case(&arguments.bundle_sha256) {
        return Err(format!(
            "{} bundle integrity mismatch: expected {}, got {}",
            arguments.plugin_id, arguments.bundle_sha256, bundle_sha256
        ));
    }

    let manifest_bytes = fs::read(&arguments.manifest_path)
        .map_err(|error| format!("could not read plugin manifest: {error}"))?;
    let manifest_sha256 = sha256(&manifest_bytes);
    if !manifest_sha256.eq_ignore_ascii_case(&arguments.manifest_sha256) {
        return Err(format!(
            "{} manifest integrity mismatch: expected {}, got {}",
            arguments.plugin_id, arguments.manifest_sha256, manifest_sha256
        ));
    }
    let plugin_manifest: Value = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("could not parse plugin manifest: {error}"))?;
    if plugin_manifest["version"].as_str() != Some(arguments.plugin_version.as_str()) {
        return Err(format!(
            "manifest version {:?} does not match pinned release {}",
            plugin_manifest["version"].as_str(),
            arguments.plugin_version
        ));
    }

    let stylesheet = match &arguments.stylesheet_path {
        Some(path) => {
            let bytes =
                fs::read(path).map_err(|error| format!("could not read stylesheet: {error}"))?;
            let expected = arguments.stylesheet_sha256.as_deref().ok_or_else(|| {
                "stylesheet hash is required when a stylesheet is provided".to_owned()
            })?;
            let actual = sha256(&bytes);
            if !actual.eq_ignore_ascii_case(expected) {
                return Err(format!(
                    "stylesheet integrity mismatch: expected {expected}, got {actual}"
                ));
            }
            bytes
        }
        None => Vec::new(),
    };

    let workflow = read_pc05_workflow(&arguments.workflow_fixture)?;
    let (theme_settings_path, theme_settings_css) = if arguments.plugin_id == "PC08" {
        let (path, css) = read_pc08_theme_css(&arguments.workflow_fixture)?;
        (Some(path), Some(css))
    } else {
        (None, None)
    };
    let theme_settings_css_sha256 = match theme_settings_css.as_deref() {
        Some(css) => {
            let actual = sha256(css.as_bytes());
            let expected = arguments
                .theme_settings_sha256
                .as_deref()
                .ok_or_else(|| "PC08 theme settings stylesheet hash is required".to_owned())?;
            if !actual.eq_ignore_ascii_case(expected) {
                return Err(format!(
                    "PC08 theme settings stylesheet integrity mismatch: expected {expected}, got {actual}"
                ));
            }
            Some(actual)
        }
        None => None,
    };
    let theme_settings_fixture = theme_settings_css_sha256
        .as_ref()
        .zip(theme_settings_path.as_ref())
        .map(|(sha256, path)| json!({"path":path,"sha256":sha256}));
    let session_token = create_session_token(&bundle_sha256);
    let webview_engine_version = wry::webview_version().ok();
    let probe_context = json!({
        "pluginId": &arguments.plugin_id,
        "pluginVersion": &arguments.plugin_version,
        "expectedBundleSha256": &bundle_sha256,
        "expectedManifestSha256": &manifest_sha256,
        "runtime": {
            "host": "wry",
            "wryVersion": "0.57.0",
            "webviewEngineVersion": &webview_engine_version,
            "os": env::consts::OS,
            "architecture": env::consts::ARCH,
        },
    });
    let config = json!({
        "pluginId": arguments.plugin_id,
        "pluginVersion": arguments.plugin_version,
        "artifactSha256": bundle_sha256,
        "manifestSha256": manifest_sha256,
        "pluginManifest": plugin_manifest,
        "stylesheetSha256": arguments.stylesheet_sha256,
        "themeSettingsCss": theme_settings_css,
        "themeSettingsFixture": theme_settings_fixture,
        "runtime": {
            "host": "wry",
            "wryVersion": "0.57.0",
            "webviewEngineVersion": webview_engine_version,
            "os": env::consts::OS,
            "architecture": env::consts::ARCH,
        },
        "legacyCompatibilityState": format!("{:?}", LegacyCompatibility::Pending),
        "editorText": workflow,
        "sessionToken": session_token,
    });
    let config_literal = serde_json::to_string(&config)
        .map_err(|error| format!("could not encode probe config: {error}"))?;
    let bundle_source = std::str::from_utf8(&bundle)
        .map_err(|error| format!("plugin bundle is not valid UTF-8 JavaScript: {error}"))?;
    let bundle_literal = serde_json::to_string(bundle_source)
        .map_err(|error| format!("could not encode plugin bundle: {error}"))?;
    let runner = RUNNER_JS
        .replace("__OPENOBSIDIAN_PROBE_CONFIG__", &config_literal)
        .replace("__OPENOBSIDIAN_BUNDLE_SOURCE__", &bundle_literal);
    let assets = RuntimeAssets {
        runner: Arc::new(runner.into_bytes()),
        stylesheet: Arc::new(stylesheet),
        runner_served: Arc::new(AtomicBool::new(false)),
    };

    #[cfg(target_os = "linux")]
    gtk::init().map_err(|error| format!("GTK initialization failed: {error}"))?;

    let event_loop = EventLoop::<ProbeEvent>::with_user_event()
        .build()
        .map_err(|error| format!("event loop creation failed: {error}"))?;
    let proxy = event_loop.create_proxy();
    let started_at = Instant::now();
    let mut application = ProbeApp {
        proxy,
        assets,
        ipc_diagnostics: Arc::new(Mutex::new(IpcDiagnostics::default())),
        window: None,
        _webview: None,
        session_token,
        probe_context,
        started_at,
        deadline: started_at + Duration::from_secs(30),
        last_progress: None,
        result: None,
    };
    event_loop
        .run_app(&mut application)
        .map_err(|error| format!("event loop failed: {error}"))?;
    application
        .result
        .ok_or_else(|| "WebView exited without a probe report".to_owned())
}

fn parse_progress(value: &Value) -> Option<ProbeProgress> {
    let stage = value["stage"].as_str()?;
    if !matches!(
        stage,
        "runner-bootstrap"
            | "capability-probe"
            | "bundle-evaluation"
            | "plugin-constructor"
            | "plugin-load"
            | "startup-settle"
            | "settings-render"
            | "style-settings-expand"
            | "view-open"
            | "editor-callback"
            | "report-build"
            | "report-post"
    ) {
        return None;
    }
    let phase = value["phase"].as_str()?;
    if !matches!(phase, "start" | "complete" | "failed") {
        return None;
    }
    let elapsed_ms = value["elapsedMs"].as_u64()?;
    if elapsed_ms > MAX_PROGRESS_ELAPSED_MS {
        return None;
    }
    let callback_index = bounded_optional_u64(value, "callbackIndex", 7)?;
    Some(ProbeProgress {
        stage: stage.to_owned(),
        phase: phase.to_owned(),
        elapsed_ms,
        callback_index,
        invoked_callbacks: bounded_optional_u64(value, "invokedCallbacks", 8)?,
        completed_callbacks: bounded_optional_u64(value, "completedCallbacks", 8)?,
    })
}

fn bounded_optional_u64(value: &Value, key: &str, maximum: u64) -> Option<Option<u64>> {
    match value.get(key) {
        None => Some(None),
        Some(_) => value[key]
            .as_u64()
            .filter(|number| *number <= maximum)
            .map(Some),
    }
}

fn progress_value(progress: &Option<ProbeProgress>) -> Value {
    match progress {
        Some(progress) => json!({
            "stage":progress.stage,
            "phase":progress.phase,
            "elapsedMs":progress.elapsed_ms,
            "callbackIndex":progress.callback_index,
            "invokedCallbacks":progress.invoked_callbacks,
            "completedCallbacks":progress.completed_callbacks,
        }),
        None => Value::Null,
    }
}

fn ipc_diagnostics_value(diagnostics: &Arc<Mutex<IpcDiagnostics>>) -> Value {
    let diagnostics = diagnostics
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    json!({
        "receivedMessages":diagnostics.received_messages,
        "receivedBytes":diagnostics.received_bytes,
        "budgetExceededMessages":diagnostics.budget_exceeded_messages,
        "budgetExhausted":diagnostics.budget_exhausted,
        "oversizedMessages":diagnostics.oversized_messages,
        "sendFailures":diagnostics.send_failures,
        "malformedMessages":diagnostics.malformed_messages,
        "tokenMismatches":diagnostics.token_mismatches,
        "unknownMessages":diagnostics.unknown_messages,
        "invalidProgress":diagnostics.invalid_progress,
    })
}

fn host_diagnostics(
    started_at: Instant,
    last_progress: &Option<ProbeProgress>,
    diagnostics: &Arc<Mutex<IpcDiagnostics>>,
) -> Value {
    json!({
        "hostElapsedMs":started_at.elapsed().as_millis(),
        "lastStage":progress_value(last_progress),
        "ipc":ipc_diagnostics_value(diagnostics),
    })
}

fn parse_arguments() -> Result<Arguments, String> {
    let mut values = std::collections::BTreeMap::new();
    for argument in env::args().skip(1) {
        let Some((key, value)) = argument.split_once('=') else {
            continue;
        };
        values.insert(key.trim_start_matches('-').to_owned(), value.to_owned());
    }

    let required = |key: &str| {
        values
            .get(key)
            .cloned()
            .ok_or_else(|| format!("missing --{key}= argument"))
    };
    Ok(Arguments {
        plugin_id: required("plugin-id")?,
        plugin_version: required("plugin-version")?,
        bundle_path: PathBuf::from(required("bundle")?),
        bundle_sha256: required("sha256")?,
        manifest_path: PathBuf::from(required("manifest")?),
        manifest_sha256: required("manifest-sha256")?,
        stylesheet_path: values.get("stylesheet").map(PathBuf::from),
        stylesheet_sha256: values.get("stylesheet-sha256").cloned(),
        theme_settings_sha256: values.get("theme-settings-sha256").cloned(),
        workflow_fixture: values
            .get("workflow-fixture")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("fixtures/plugin-loaded-workflows.json")),
    })
}

fn read_pc05_workflow(path: &Path) -> Result<Value, String> {
    let bytes =
        fs::read(path).map_err(|error| format!("could not read workflow fixture: {error}"))?;
    let fixture: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("could not parse workflow fixture: {error}"))?;
    let scenario = &fixture["scenarios"]["PC05"];
    let content = scenario["files"]
        .as_array()
        .and_then(|files| {
            files.iter().find_map(|file| {
                (file["path"].as_str() == Some("Notes/Table.md"))
                    .then(|| file["content"].as_str())
                    .flatten()
            })
        })
        .ok_or_else(|| "PC05 table editor fixture is missing Notes/Table.md".to_owned())?;
    Ok(json!({
        "value": content,
        "activeFile": "Notes/Table.md",
        "initialData": scenario["initial_data"],
    }))
}

fn read_pc08_theme_css(path: &Path) -> Result<(String, String), String> {
    let bytes =
        fs::read(path).map_err(|error| format!("could not read workflow fixture: {error}"))?;
    let fixture: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("could not parse workflow fixture: {error}"))?;
    let scenario = &fixture["scenarios"]["PC08"];
    let theme_path = scenario["style_settings_workflow"]["theme_path"]
        .as_str()
        .ok_or_else(|| "PC08 theme settings fixture is missing its theme_path".to_owned())?;
    let content = scenario["files"]
        .as_array()
        .and_then(|files| {
            files.iter().find_map(|file| {
                (file["path"].as_str() == Some(theme_path))
                    .then(|| file["content"].as_str())
                    .flatten()
            })
        })
        .map(str::to_owned)
        .ok_or_else(|| format!("PC08 theme settings fixture is missing {theme_path}"))?;
    Ok((theme_path.to_owned(), content))
}

fn serve_request(
    request: wry::http::Request<Vec<u8>>,
    assets: &RuntimeAssets,
) -> wry::http::Response<Cow<'static, [u8]>> {
    let method = request.method();
    let uri = request.uri();
    let host = uri.host().unwrap_or_default();
    let host_allowed = host.eq_ignore_ascii_case("localhost")
        || host.eq_ignore_ascii_case("openobsidian-plugin.localhost");
    let path = uri.path();
    let (status, content_type, body) = if !host_allowed {
        (
            wry::http::StatusCode::FORBIDDEN,
            "text/plain; charset=utf-8",
            b"host denied".to_vec(),
        )
    } else if method != wry::http::Method::GET {
        (
            wry::http::StatusCode::METHOD_NOT_ALLOWED,
            "text/plain",
            b"method denied".to_vec(),
        )
    } else {
        match path {
            "/index.html" | "/" => (
                wry::http::StatusCode::OK,
                "text/html; charset=utf-8",
                HTML.as_bytes().to_vec(),
            ),
            "/runner.js" => {
                if assets
                    .runner_served
                    .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                    .is_ok()
                {
                    (
                        wry::http::StatusCode::OK,
                        "text/javascript; charset=utf-8",
                        assets.runner.as_ref().clone(),
                    )
                } else {
                    (
                        wry::http::StatusCode::NOT_FOUND,
                        "text/plain; charset=utf-8",
                        b"one-shot probe script already served".to_vec(),
                    )
                }
            }
            "/theme.css" => (
                wry::http::StatusCode::OK,
                "text/css; charset=utf-8",
                assets.stylesheet.as_ref().clone(),
            ),
            _ => (
                wry::http::StatusCode::NOT_FOUND,
                "text/plain; charset=utf-8",
                b"resource denied".to_vec(),
            ),
        }
    };

    wry::http::Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header("Content-Security-Policy", CSP)
        .header("X-Content-Type-Options", "nosniff")
        .header("X-Frame-Options", "DENY")
        .header("Referrer-Policy", "no-referrer")
        .body(Cow::Owned(body))
        .expect("static protocol response is valid")
}

fn is_internal_document(url: &str) -> bool {
    let Some((scheme, remainder)) = url.split_once("://") else {
        return false;
    };
    let Some((host, path)) = remainder.split_once('/') else {
        return false;
    };
    let host_allowed = match scheme {
        INTERNAL_SCHEME => host.eq_ignore_ascii_case("localhost"),
        "http" | "https" => host.eq_ignore_ascii_case("openobsidian-plugin.localhost"),
        _ => false,
    };
    let document_path = path.split(['?', '#']).next().unwrap_or_default();
    host_allowed && (document_path.is_empty() || document_path == "index.html")
}

fn sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(output, "{byte:02x}").expect("writing to a String cannot fail");
    }
    output
}

fn create_session_token(bundle_sha256: &str) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let input = format!("{bundle_sha256}:{}:{timestamp}", std::process::id());
    sha256(input.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_bounded_allowlisted_progress() {
        let progress = parse_progress(&json!({
            "stage":"editor-callback",
            "phase":"start",
            "elapsedMs":1200,
            "callbackIndex":7,
            "invokedCallbacks":8,
            "completedCallbacks":6,
        }))
        .expect("bounded editor callback progress is accepted");

        assert_eq!(progress.stage, "editor-callback");
        assert_eq!(progress.phase, "start");
        assert_eq!(progress.elapsed_ms, 1200);
        assert_eq!(progress.callback_index, Some(7));
        assert_eq!(progress.invoked_callbacks, Some(8));
        assert_eq!(progress.completed_callbacks, Some(6));
    }

    #[test]
    fn rejects_unrecognized_or_out_of_range_progress() {
        assert!(
            parse_progress(&json!({
                "stage":"plugin-invented-stage",
                "phase":"start",
                "elapsedMs":10,
            }))
            .is_none()
        );
        assert!(
            parse_progress(&json!({
                "stage":"plugin-load",
                "phase":"running",
                "elapsedMs":10,
            }))
            .is_none()
        );
        assert!(
            parse_progress(&json!({
                "stage":"editor-callback",
                "phase":"start",
                "elapsedMs":30_001,
                "callbackIndex":0,
            }))
            .is_none()
        );
        assert!(
            parse_progress(&json!({
                "stage":"editor-callback",
                "phase":"start",
                "elapsedMs":10,
                "callbackIndex":8,
            }))
            .is_none()
        );
    }
}
