//! Read-only projections of supported Obsidian configuration values.

use serde_json::{Map, Value};
use std::collections::HashSet;

/// A small, data-only projection of supported fields in an Obsidian `app.json` file.
///
/// The original JSON object and bytes remain authoritative. This type does not
/// apply these preferences to OpenObsidian's current UI.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct AppSettings {
    /// An explicitly stored line-number preference, if it is a JSON boolean.
    pub show_line_number: Option<bool>,
}

/// Projects the explicitly supported `app.json` fields from a parsed object.
///
/// Missing and non-boolean values remain absent from the typed view and are
/// still available in the source object held by the caller.
pub fn parse_app_settings(raw: &Map<String, Value>) -> AppSettings {
    AppSettings {
        show_line_number: raw.get("showLineNumber").and_then(Value::as_bool),
    }
}

/// A data-only projection of the configured templates folder.
///
/// The source JSON object and bytes remain authoritative. `folder` follows the
/// legacy parser's lexical path check and is inert data; it is not sufficient
/// authorization for filesystem access.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct TemplateSettings {
    /// Legacy-validated folder value, or an empty string for the vault root.
    pub folder: String,
    /// Configuration issues reported by the legacy parser's supported fields.
    pub issues: Vec<String>,
}

/// Projects the supported folder field from a parsed `templates.json` object.
///
/// Missing and empty folder values select the vault root. Unknown fields stay
/// available in the source object held by the caller.
pub fn parse_template_settings(raw: &Map<String, Value>) -> TemplateSettings {
    let Some(value) = raw.get("folder") else {
        return TemplateSettings::default();
    };
    let Some(folder) = safe_relative_path(value, true) else {
        return TemplateSettings {
            folder: String::new(),
            issues: vec!["Template folder must be a safe relative path".to_owned()],
        };
    };
    TemplateSettings {
        folder,
        issues: Vec::new(),
    }
}

/// A data-only projection of supported daily-note configuration fields.
///
/// The source JSON object and bytes remain authoritative. `folder` and
/// `template` follow the legacy parser's lexical path check and are inert data;
/// they are not sufficient authorization for filesystem access.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DailyNoteSettings {
    /// Legacy-validated folder value, or an empty string for the vault root.
    pub folder: String,
    /// Configured date format, defaulting to `YYYY-MM-DD`.
    pub format: String,
    /// Optional legacy-validated template value.
    pub template: Option<String>,
    /// Configuration issues reported by the legacy parser's supported fields.
    pub issues: Vec<String>,
}

impl Default for DailyNoteSettings {
    fn default() -> Self {
        Self {
            folder: String::new(),
            format: "YYYY-MM-DD".to_owned(),
            template: None,
            issues: Vec::new(),
        }
    }
}

/// Projects supported fields from a parsed `daily-notes.json` object.
///
/// Blank or non-string formats use the legacy `YYYY-MM-DD` default. Unknown
/// fields stay available in the source object held by the caller.
pub fn parse_daily_note_settings(raw: &Map<String, Value>) -> DailyNoteSettings {
    let mut settings = DailyNoteSettings::default();

    if let Some(value) = raw.get("folder") {
        if let Some(folder) = safe_relative_path(value, true) {
            settings.folder = folder;
        } else {
            settings
                .issues
                .push("Daily-note folder must be a safe relative path".to_owned());
        }
    }

    if let Some(format) = raw
        .get("format")
        .and_then(Value::as_str)
        .map(|value| value.trim_matches(is_ecmascript_whitespace))
        .filter(|value| !value.is_empty())
    {
        settings.format = format.to_owned();
    }

    match raw.get("template") {
        None | Some(Value::Null) => {}
        Some(Value::String(value)) if value.is_empty() => {}
        Some(value) => match safe_relative_path(value, false) {
            Some(template) => settings.template = Some(template),
            None => settings
                .issues
                .push("Daily-note template must be a safe relative path".to_owned()),
        },
    }

    settings
}

fn safe_relative_path(value: &Value, allow_empty: bool) -> Option<String> {
    let value = value.as_str()?;
    if (!allow_empty && value.is_empty())
        || value.starts_with('/')
        || value.contains('\\')
        || value.contains('\0')
    {
        return None;
    }
    if value.is_empty() {
        return Some(String::new());
    }
    if value
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return None;
    }
    Some(value.to_owned())
}

/// The appearance mode requested by an Obsidian vault configuration file.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AppearanceMode {
    /// Use the light appearance.
    Light,
    /// Use the dark appearance.
    Dark,
    /// Follow the operating system appearance.
    System,
    /// The source value is absent or is not a supported mode.
    Unknown,
}

/// Supported appearance settings projected from an Obsidian `appearance.json` file.
///
/// The original JSON object and bytes remain authoritative. This type contains only
/// the known settings that OpenObsidian can interpret without rewriting the source.
#[derive(Clone, Debug, PartialEq)]
pub struct AppearanceSettings {
    /// Requested light, dark, system, or unknown mode.
    pub mode: AppearanceMode,
    /// Optional name of a selected CSS theme.
    pub css_theme: Option<String>,
    /// Enabled CSS snippet names, trimmed and deduplicated in source order.
    pub enabled_css_snippets: Vec<String>,
    /// Optional accent color string.
    pub accent_color: Option<String>,
    /// Optional positive finite base font size.
    pub base_font_size: Option<f64>,
}

/// Projects the explicitly supported appearance fields from a parsed JSON object.
///
/// Unknown keys are ignored by this projection and remain available in the source
/// object held by the caller. Mode aliases use nullish precedence in the order
/// `mode`, `themeMode`, `colorScheme`, then `theme`.
pub fn parse_appearance_settings(raw: &Map<String, Value>) -> AppearanceSettings {
    let raw_theme = optional_string(raw.get("theme"));
    let mode_value = ["mode", "themeMode", "colorScheme", "theme"]
        .into_iter()
        .find_map(|key| raw.get(key).filter(|value| !value.is_null()));
    let mode = match mode_value
        .and_then(Value::as_str)
        .map(|value| value.trim_matches(is_ecmascript_whitespace))
    {
        Some(value) if value.eq_ignore_ascii_case("light") => AppearanceMode::Light,
        Some(value) if value.eq_ignore_ascii_case("dark") => AppearanceMode::Dark,
        Some(value) if value.eq_ignore_ascii_case("system") => AppearanceMode::System,
        _ => AppearanceMode::Unknown,
    };

    let css_theme = optional_string(raw.get("cssTheme")).or_else(|| {
        raw_theme.filter(|theme| {
            !["light", "dark", "system"]
                .iter()
                .any(|mode| theme.eq_ignore_ascii_case(mode))
        })
    });

    let mut seen_snippets = HashSet::new();
    let enabled_css_snippets = raw
        .get("enabledCssSnippets")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| optional_string(Some(value)))
        .filter(|snippet| seen_snippets.insert(snippet.clone()))
        .collect();

    let base_font_size = raw
        .get("baseFontSize")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0);

    AppearanceSettings {
        mode,
        css_theme,
        enabled_css_snippets,
        accent_color: optional_string(raw.get("accentColor")),
        base_font_size,
    }
}

fn optional_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(|value| value.trim_matches(is_ecmascript_whitespace))
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn is_ecmascript_whitespace(character: char) -> bool {
    matches!(
        character,
        '\u{0009}'..='\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

#[cfg(test)]
mod tests {
    use super::{
        AppSettings, AppearanceMode, AppearanceSettings, DailyNoteSettings, TemplateSettings,
        parse_app_settings, parse_appearance_settings, parse_daily_note_settings,
        parse_template_settings,
    };
    use serde_json::{Map, Value};

    const CONFIGURATION_FIXTURE: &str =
        include_str!("../../../fixtures/configuration-inventory.json");

    #[test]
    fn projects_only_supported_app_settings_from_fixture_cases() {
        let fixture: Value = serde_json::from_str(CONFIGURATION_FIXTURE)
            .expect("configuration fixture must be valid JSON");

        for case in fixture["app_settings_cases"]
            .as_array()
            .expect("app settings cases must be an array")
        {
            let raw: Map<String, Value> = case["source"]
                .as_object()
                .expect("app settings source must be a JSON object")
                .clone();
            let original = raw.clone();
            let projected = parse_app_settings(&raw);

            assert_eq!(
                projected.show_line_number,
                case["expected"]["showLineNumber"].as_bool()
            );
            assert_eq!(raw, original);
        }

        assert_eq!(parse_app_settings(&Map::new()), AppSettings::default());
    }

    #[test]
    fn projects_only_supported_template_settings_from_fixture_cases() {
        let fixture: Value = serde_json::from_str(CONFIGURATION_FIXTURE)
            .expect("configuration fixture must be valid JSON");

        for case in fixture["template_settings_cases"]
            .as_array()
            .expect("template settings cases must be an array")
        {
            let raw: Map<String, Value> = case["source"]
                .as_object()
                .expect("template settings source must be a JSON object")
                .clone();
            let original = raw.clone();
            let projected = parse_template_settings(&raw);
            let expected = &case["expected"];
            let expected_issues = expected["issues"]
                .as_array()
                .expect("expected template settings issues must be an array")
                .iter()
                .map(|issue| {
                    issue
                        .as_str()
                        .expect("expected template settings issue must be a string")
                        .to_owned()
                })
                .collect::<Vec<_>>();

            assert_eq!(
                projected,
                TemplateSettings {
                    folder: expected["folder"]
                        .as_str()
                        .expect("expected template folder must be a string")
                        .to_owned(),
                    issues: expected_issues,
                }
            );
            assert_eq!(raw, original);
        }

        assert_eq!(
            parse_template_settings(&Map::new()),
            TemplateSettings::default()
        );
    }

    #[test]
    fn projects_only_supported_daily_note_settings_from_fixture_cases() {
        let fixture: Value = serde_json::from_str(CONFIGURATION_FIXTURE)
            .expect("configuration fixture must be valid JSON");

        for case in fixture["daily_note_settings_cases"]
            .as_array()
            .expect("daily-note settings cases must be an array")
        {
            let raw: Map<String, Value> = case["source"]
                .as_object()
                .expect("daily-note settings source must be a JSON object")
                .clone();
            let original = raw.clone();
            let projected = parse_daily_note_settings(&raw);
            let expected = &case["expected"];
            let expected_issues = expected["issues"]
                .as_array()
                .expect("expected daily-note settings issues must be an array")
                .iter()
                .map(|issue| {
                    issue
                        .as_str()
                        .expect("expected daily-note settings issue must be a string")
                        .to_owned()
                })
                .collect::<Vec<_>>();

            assert_eq!(
                projected,
                DailyNoteSettings {
                    folder: expected["folder"]
                        .as_str()
                        .expect("expected daily-note folder must be a string")
                        .to_owned(),
                    format: expected["format"]
                        .as_str()
                        .expect("expected daily-note format must be a string")
                        .to_owned(),
                    template: expected["template"].as_str().map(str::to_owned),
                    issues: expected_issues,
                }
            );
            assert_eq!(raw, original);
        }

        assert_eq!(
            parse_daily_note_settings(&Map::new()),
            DailyNoteSettings::default()
        );
    }

    #[test]
    fn projects_only_supported_appearance_fields_from_fixture_cases() {
        let fixture: Value = serde_json::from_str(CONFIGURATION_FIXTURE)
            .expect("configuration fixture must be valid JSON");

        for case in fixture["appearance_cases"]
            .as_array()
            .expect("appearance cases must be an array")
        {
            let raw: Map<String, Value> = case["source"]
                .as_object()
                .expect("appearance source must be a JSON object")
                .clone();
            let original = raw.clone();
            let projected = parse_appearance_settings(&raw);
            let expected = &case["expected"];

            let expected_mode = match expected["mode"].as_str().unwrap() {
                "light" => AppearanceMode::Light,
                "dark" => AppearanceMode::Dark,
                "system" => AppearanceMode::System,
                "unknown" => AppearanceMode::Unknown,
                _ => panic!("fixture contains an unsupported expected mode"),
            };
            let expected_snippets = expected["enabledCssSnippets"]
                .as_array()
                .unwrap()
                .iter()
                .map(|value| value.as_str().unwrap().to_owned())
                .collect::<Vec<_>>();

            assert_eq!(projected.mode, expected_mode);
            assert_eq!(
                projected.css_theme.as_deref(),
                expected["cssTheme"].as_str()
            );
            assert_eq!(projected.enabled_css_snippets, expected_snippets);
            assert_eq!(
                projected.accent_color.as_deref(),
                expected["accentColor"].as_str()
            );
            assert_eq!(projected.base_font_size, expected["baseFontSize"].as_f64());
            assert_eq!(raw, original);
        }
    }

    #[test]
    fn missing_appearance_settings_project_to_empty_defaults() {
        assert_eq!(
            parse_appearance_settings(&Map::new()),
            AppearanceSettings {
                mode: AppearanceMode::Unknown,
                css_theme: None,
                enabled_css_snippets: Vec::new(),
                accent_color: None,
                base_font_size: None,
            }
        );
    }
}
