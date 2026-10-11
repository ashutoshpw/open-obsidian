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
        AppSettings, AppearanceMode, AppearanceSettings, parse_app_settings,
        parse_appearance_settings,
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
