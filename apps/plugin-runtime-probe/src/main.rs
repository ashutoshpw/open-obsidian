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
        Arc,
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
    Report(String),
}

struct ProbeApp {
    proxy: EventLoopProxy<ProbeEvent>,
    assets: RuntimeAssets,
    window: Option<Window>,
    _webview: Option<WebView>,
    session_token: String,
    deadline: Instant,
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
                self.finish_error(event_loop, format!("window creation failed: {error}"));
                return;
            }
        };

        let assets = self.assets.clone();
        let ipc_proxy = self.proxy.clone();
        let builder = WebViewBuilder::new()
            .with_custom_protocol(INTERNAL_SCHEME.to_owned(), move |_webview_id, request| {
                serve_request(request, &assets)
            })
            .with_url(format!("{INTERNAL_SCHEME}://localhost/index.html"))
            .with_ipc_handler(move |request| {
                let body = request.body();
                if body.len() <= 256 * 1024 {
                    let _ = ipc_proxy.send_event(ProbeEvent::Report(body.clone()));
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
            Err(error) => {
                self.finish_error(event_loop, format!("webview creation failed: {error}"))
            }
        }
    }

    fn user_event(&mut self, event_loop: &ActiveEventLoop, event: ProbeEvent) {
        match event {
            ProbeEvent::Report(message) => {
                let Ok(value) = serde_json::from_str::<Value>(&message) else {
                    return;
                };
                if value["token"].as_str() != Some(self.session_token.as_str()) {
                    return;
                }
                self.result = Some(value["report"].clone());
                event_loop.exit();
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
            self.finish_error(event_loop, "probe window closed before report".to_owned());
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        #[cfg(target_os = "linux")]
        while gtk::events_pending() {
            gtk::main_iteration_do(false);
        }

        if Instant::now() >= self.deadline && self.result.is_none() {
            self.finish_error(event_loop, "WebView probe timed out".to_owned());
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
    fn finish_error(&mut self, event_loop: &ActiveEventLoop, error: String) {
        self.result = Some(json!({"status":"failed","error":error}));
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
            "webviewEngineVersion": wry::webview_version().ok(),
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
    let mut application = ProbeApp {
        proxy,
        assets,
        window: None,
        _webview: None,
        session_token,
        deadline: Instant::now() + Duration::from_secs(30),
        result: None,
    };
    event_loop
        .run_app(&mut application)
        .map_err(|error| format!("event loop failed: {error}"))?;
    application
        .result
        .ok_or_else(|| "WebView exited without a probe report".to_owned())
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
