//! Read-only, heuristic analysis of untrusted theme and snippet CSS.
//!
//! This module reports source metadata and static precheck findings. It does not
//! parse the full CSS grammar, sanitize a stylesheet, or authorize CSS execution.

use std::collections::BTreeMap;

/// Whether a stylesheet has been executed by the analyzer.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ThemeCssExecution {
    /// Analysis is text-only; the source has not been executed.
    NotExecuted,
}

/// Policy for imports and URL based resources found in a stylesheet.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ThemeCssResourcePolicy {
    /// Imports and URL assets are not fetched or resolved.
    Denied,
}

/// Policy for selectors that target privileged application controls.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ThemeCssPrivilegedSelectorPolicy {
    /// Such selectors require a host review before any renderer can apply them.
    HostReviewRequired,
}

/// Light and dark mode hints detected in a stylesheet.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ThemeStyleModeSupport {
    pub light: bool,
    pub dark: bool,
}

/// Static safety metadata for a stylesheet.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ThemeStyleSafety {
    pub raw_css_execution: ThemeCssExecution,
    pub external_imports: ThemeCssResourcePolicy,
    pub url_assets: ThemeCssResourcePolicy,
    pub privileged_selector_policy: ThemeCssPrivilegedSelectorPolicy,
    pub privileged_selectors: Vec<String>,
    /// Whether the current text-only precheck found any of its known blockers.
    /// This is not renderer certification or a guarantee that CSS is safe.
    pub static_precheck_passed: bool,
}

/// Deterministic metadata extracted from a theme or CSS snippet.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ThemeStyleAnalysis {
    /// CSS custom properties, sorted by name; later declarations replace earlier values.
    pub variables: BTreeMap<String, String>,
    /// Unique selector candidates in first-seen order.
    pub selectors: Vec<String>,
    pub mode_support: ThemeStyleModeSupport,
    pub layout_contracts: Vec<String>,
    pub plugin_view_contracts: Vec<String>,
    pub popout_contracts: Vec<String>,
    pub accessibility_contracts: Vec<String>,
    pub safety: ThemeStyleSafety,
    pub issues: Vec<String>,
}

/// Extracts compatibility hints and static safety findings without executing CSS.
///
/// The source is scanned with intentionally small heuristics for compatibility
/// with the legacy analyzer. CSS strings, escapes, nesting, and malformed rules
/// can make these hints incomplete or misleading; a renderer must still apply
/// its own scoping and rule filtering before previewing any stylesheet.
pub fn analyze_theme_stylesheet(source: &str) -> ThemeStyleAnalysis {
    // The default JavaScript TextDecoder used by the legacy configuration reader
    // strips an initial UTF-8 BOM. Keep that behavior for analysis only; callers
    // retain the original bytes as the authoritative asset.
    let source = source.strip_prefix('\u{feff}').unwrap_or(source);
    let clean = strip_css_comments(source);
    let lower = clean.to_ascii_lowercase();
    let selectors = css_selectors(&clean);
    let variables = css_variables(&clean);

    let dark_hint = has_property_value_prefix(&lower, "prefers-color-scheme", "dark")
        || has_theme_mode_hint(&lower, "dark")
        || has_quoted_property(&lower, "data-theme", "dark");
    let light_hint = has_property_value_prefix(&lower, "prefers-color-scheme", "light")
        || has_theme_mode_hint(&lower, "light")
        || has_quoted_property(&lower, "data-theme", "light");
    let mode_support = if dark_hint || light_hint {
        ThemeStyleModeSupport {
            light: light_hint,
            dark: dark_hint,
        }
    } else {
        ThemeStyleModeSupport {
            light: true,
            dark: true,
        }
    };

    let layout_contracts = matching_contracts(&[
        ("workspace-shell", workspace_shell_match(&selectors)),
        (
            "workspace-leaf",
            selectors.iter().any(|selector| {
                selector_has_class_word(selector, ".workspace-leaf")
                    || selector_has_class_word(selector, ".workspace-tab-container")
            }),
        ),
        (
            "view-header",
            selectors_have_class_word(&selectors, ".view-header"),
        ),
        (
            "file-explorer",
            [".nav-files-container", ".nav-folder", ".nav-file"]
                .iter()
                .any(|class| selectors_have_class_word(&selectors, class)),
        ),
        (
            "titlebar",
            selectors_have_class_word(&selectors, ".titlebar"),
        ),
        (
            "status-bar",
            selectors_have_class_word(&selectors, ".status-bar"),
        ),
    ]);
    let plugin_view_contracts = matching_contracts(&[
        (
            "data-view",
            selectors
                .iter()
                .any(|value| has_attribute_equals(value, "data-type")),
        ),
        (
            "workspace-leaf-content",
            selectors_have_class_word(&selectors, ".workspace-leaf-content"),
        ),
        (
            "view-content",
            selectors_have_class_word(&selectors, ".view-content"),
        ),
    ]);
    let popout_contracts = matching_contracts(&[(
        "popout-surface",
        selectors.iter().any(|selector| {
            selector_has_class_word(selector, ".mod-popout")
                || selector_has_class_word(selector, ".is-popout")
                || selector_has_body_popout(selector)
        }),
    )]);

    let mut accessibility_contracts = Vec::new();
    if contains_focus_selector(&lower) {
        accessibility_contracts.push("focus-visible".to_owned());
    }
    if lower.contains("prefers-reduced-motion") {
        accessibility_contracts.push("reduced-motion".to_owned());
    }
    if lower.contains("forced-colors")
        || lower.contains("prefers-contrast")
        || has_aria_attribute(&lower)
        || has_role_equals(&lower)
    {
        accessibility_contracts.push("high-contrast-or-semantic-controls".to_owned());
    }
    if has_property(&lower, "font-size", ':') {
        accessibility_contracts.push("font-scaling".to_owned());
    }

    let external_imports = contains_word(&lower, "@import");
    // All URL assets stay denied, including relative paths that might otherwise
    // escape the vault or trigger an unreviewed fetch in a renderer.
    let url_assets = has_function_call(&lower, "url");
    let executable_expressions = has_function_call(&lower, "expression")
        || lower.contains("javascript:")
        || lower.contains("-moz-binding")
        || has_property(&lower, "behavior", ':');
    let privileged_selectors = selectors
        .iter()
        .filter(|selector| has_privileged_selector(selector))
        .cloned()
        .collect::<Vec<_>>();

    let mut issues = Vec::new();
    if external_imports {
        issues.push("CSS @import is not resolved during a safe preview".to_owned());
    }
    if url_assets {
        issues.push(
            "remote, file and data URL assets are not fetched during a safe preview".to_owned(),
        );
    }
    if executable_expressions {
        issues.push("executable CSS expressions are not accepted".to_owned());
    }
    if !privileged_selectors.is_empty() {
        issues.push("selectors targeting privileged or AI controls require host review".to_owned());
    }

    let static_precheck_passed = !external_imports
        && !url_assets
        && !executable_expressions
        && privileged_selectors.is_empty();

    ThemeStyleAnalysis {
        variables,
        selectors,
        mode_support,
        layout_contracts,
        plugin_view_contracts,
        popout_contracts,
        accessibility_contracts,
        safety: ThemeStyleSafety {
            raw_css_execution: ThemeCssExecution::NotExecuted,
            external_imports: ThemeCssResourcePolicy::Denied,
            url_assets: ThemeCssResourcePolicy::Denied,
            privileged_selector_policy: ThemeCssPrivilegedSelectorPolicy::HostReviewRequired,
            privileged_selectors,
            static_precheck_passed,
        },
        issues,
    }
}

fn strip_css_comments(source: &str) -> String {
    let characters = source.char_indices().collect::<Vec<_>>();
    let mut output = String::with_capacity(source.len());
    let mut index = 0;
    while index < characters.len() {
        let (byte_index, character) = characters[index];
        if character == '/'
            && characters
                .get(index + 1)
                .is_some_and(|(_, next)| *next == '*')
        {
            index += 2;
            while index + 1 < characters.len()
                && !(characters[index].1 == '*' && characters[index + 1].1 == '/')
            {
                index += 1;
            }
            if index + 1 < characters.len() {
                index += 2;
            } else {
                index = characters.len();
            }
            continue;
        }
        let next_byte_index = characters
            .get(index + 1)
            .map_or(source.len(), |(next, _)| *next);
        output.push_str(&source[byte_index..next_byte_index]);
        index += 1;
    }
    output
}

fn css_selectors(source: &str) -> Vec<String> {
    let mut selectors = Vec::new();
    let mut segment_start = 0;
    for (brace_index, _) in source.match_indices('{') {
        let segment = &source[segment_start..brace_index];
        segment_start = brace_index + 1;
        let candidate = segment.rsplit(['}', ';']).next().unwrap_or_default().trim();
        if candidate.is_empty() || candidate.starts_with('@') {
            continue;
        }
        for selector in candidate
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if !selectors.iter().any(|existing| existing == selector) {
                selectors.push(selector.to_owned());
            }
        }
    }
    selectors
}

fn css_variables(source: &str) -> BTreeMap<String, String> {
    let bytes = source.as_bytes();
    let mut variables = BTreeMap::new();
    let mut offset = 0;
    while offset + 2 <= bytes.len() {
        if bytes.get(offset..offset + 2) != Some(&b"--"[..]) {
            offset += 1;
            continue;
        }
        let start = offset;
        offset += 2;
        let name_start = offset;
        while bytes
            .get(offset)
            .is_some_and(|byte| is_css_variable_byte(*byte))
        {
            offset += 1;
        }
        if offset == name_start {
            offset = start + 2;
            continue;
        }
        let name_end = offset;
        skip_css_whitespace(source, &mut offset);
        if bytes.get(offset) != Some(&b':') {
            offset = start + 2;
            continue;
        }
        offset += 1;
        skip_css_whitespace(source, &mut offset);
        let value_start = offset;
        while let Some(character) = source.get(offset..).and_then(|tail| tail.chars().next()) {
            if matches!(character, ';' | '{' | '}') {
                break;
            }
            offset += character.len_utf8();
        }
        let value = source[value_start..offset].trim_matches(is_ecmascript_whitespace);
        if !value.is_empty() {
            let terminated_by_semicolon = bytes.get(offset) == Some(&b';');
            let terminated_at_end = offset == source.len();
            if terminated_by_semicolon || terminated_at_end {
                variables.insert(source[start..name_end].to_owned(), value.to_owned());
            }
        }
    }
    variables
}

fn matching_contracts(tests: &[(&str, bool)]) -> Vec<String> {
    tests
        .iter()
        .copied()
        .filter(|(_, matched)| *matched)
        .map(|(id, _)| id.to_owned())
        .collect()
}

fn selectors_have_class_word(selectors: &[String], class: &str) -> bool {
    selectors
        .iter()
        .any(|selector| selector_has_class_word(selector, class))
}

fn selector_has_class_word(selector: &str, class: &str) -> bool {
    let lower = selector.to_ascii_lowercase();
    let class = class.to_ascii_lowercase();
    lower.match_indices(&class).any(|(start, _)| {
        let after = start + class.len();
        lower
            .as_bytes()
            .get(after)
            .is_none_or(|byte| !is_ascii_word(*byte))
    })
}

fn workspace_shell_match(selectors: &[String]) -> bool {
    selectors.iter().any(|selector| {
        let lower = selector.to_ascii_lowercase();
        lower.match_indices(".workspace").any(|(start, _)| {
            let before = lower[..start].chars().next_back();
            let after = start + ".workspace".len();
            let before_ok = before
                .is_none_or(|character| is_ecmascript_whitespace(character) || character == '>');
            let after_ok = lower
                .as_bytes()
                .get(after)
                .is_none_or(|byte| !is_ascii_word(*byte));
            before_ok && after_ok
        })
    })
}

fn contains_word(source: &str, word: &str) -> bool {
    source.match_indices(word).any(|(start, _)| {
        let after = start + word.len();
        source
            .as_bytes()
            .get(after)
            .is_none_or(|byte| !is_ascii_word(*byte))
    })
}

fn has_function_call(source: &str, name: &str) -> bool {
    source.match_indices(name).any(|(start, _)| {
        let mut offset = start + name.len();
        skip_css_whitespace(source, &mut offset);
        source.as_bytes().get(offset) == Some(&b'(')
    })
}

fn has_property(source: &str, name: &str, delimiter: char) -> bool {
    source.match_indices(name).any(|(start, _)| {
        let before_ok = start
            .checked_sub(1)
            .and_then(|index| source.as_bytes().get(index))
            .is_none_or(|byte| !is_ascii_word(*byte));
        if !before_ok {
            return false;
        }
        let mut offset = start + name.len();
        skip_css_whitespace(source, &mut offset);
        source.as_bytes().get(offset) == Some(&(delimiter as u8))
    })
}

fn has_property_value_prefix(source: &str, name: &str, value: &str) -> bool {
    source.match_indices(name).any(|(start, _)| {
        let mut offset = start + name.len();
        skip_css_whitespace(source, &mut offset);
        if source.as_bytes().get(offset) != Some(&b':') {
            return false;
        }
        offset += 1;
        skip_css_whitespace(source, &mut offset);
        source
            .get(offset..)
            .is_some_and(|tail| tail.starts_with(value))
    })
}

fn has_quoted_property(source: &str, name: &str, value: &str) -> bool {
    source.match_indices(name).any(|(start, _)| {
        let mut offset = start + name.len();
        skip_css_whitespace(source, &mut offset);
        if source.as_bytes().get(offset) != Some(&b'=') {
            return false;
        }
        offset += 1;
        skip_css_whitespace(source, &mut offset);
        let Some(quote) = source.as_bytes().get(offset).copied() else {
            return false;
        };
        if quote != b'\'' && quote != b'"' {
            return false;
        }
        offset += 1;
        source.get(offset..).is_some_and(|tail| {
            tail.starts_with(value) && tail.as_bytes().get(value.len()) == Some(&quote)
        })
    })
}

fn has_theme_mode_hint(source: &str, mode: &str) -> bool {
    ["theme", "mode"].iter().any(|name| {
        source.match_indices(name).any(|(start, _)| {
            let before_ok = start == 0
                || source
                    .as_bytes()
                    .get(start - 1)
                    .is_some_and(|byte| !is_ascii_word(*byte) && *byte != b'-');
            if !before_ok {
                return false;
            }
            let delimiter_index = start + name.len();
            if !source
                .as_bytes()
                .get(delimiter_index)
                .is_some_and(|byte| matches!(*byte, b'-' | b'_' | b' '))
            {
                return false;
            }
            let mode_start = delimiter_index + 1;
            source.get(mode_start..).is_some_and(|tail| {
                tail.starts_with(mode)
                    && tail
                        .as_bytes()
                        .get(mode.len())
                        .is_none_or(|byte| !is_ascii_word(*byte))
            })
        })
    })
}

fn contains_focus_selector(source: &str) -> bool {
    source.match_indices(":focus").any(|(start, _)| {
        let mut end = start + ":focus".len();
        if source
            .get(end..)
            .is_some_and(|tail| tail.starts_with("-visible"))
        {
            end += "-visible".len();
        }
        source
            .as_bytes()
            .get(end)
            .is_none_or(|byte| !is_ascii_word(*byte))
    })
}

fn has_aria_attribute(source: &str) -> bool {
    source.match_indices("[aria-").any(|(start, _)| {
        let mut offset = start + "[aria-".len();
        let name_start = offset;
        while source
            .as_bytes()
            .get(offset)
            .is_some_and(|byte| is_ascii_word(*byte) || *byte == b'-')
        {
            offset += 1;
        }
        offset > name_start && source.as_bytes().get(offset) == Some(&b']')
    })
}

fn has_role_equals(source: &str) -> bool {
    source.match_indices("role").any(|(start, _)| {
        let before_ok = start == 0 || !is_ascii_word(source.as_bytes()[start - 1]);
        if !before_ok {
            return false;
        }
        let mut offset = start + "role".len();
        skip_css_whitespace(source, &mut offset);
        source.as_bytes().get(offset) == Some(&b'=')
    })
}

fn selector_has_attribute_equals(selector: &str, name: &str) -> bool {
    let lower = selector.to_ascii_lowercase();
    let pattern = format!("[{name}");
    lower.match_indices(&pattern).any(|(start, _)| {
        let mut offset = start + pattern.len();
        skip_css_whitespace(&lower, &mut offset);
        lower.as_bytes().get(offset) == Some(&b'=')
    })
}

fn has_attribute_equals(selector: &str, name: &str) -> bool {
    selector_has_attribute_equals(selector, name)
}

fn selector_has_body_popout(selector: &str) -> bool {
    let lower = selector.to_ascii_lowercase();
    lower.match_indices("body").any(|(start, _)| {
        let mut offset = start + "body".len();
        skip_css_whitespace(&lower, &mut offset);
        let class = ".mod-popout";
        lower.get(offset..).is_some_and(|tail| {
            tail.starts_with(class)
                && lower
                    .as_bytes()
                    .get(offset + class.len())
                    .is_none_or(|byte| !is_ascii_word(*byte))
        })
    })
}

fn has_privileged_selector(selector: &str) -> bool {
    let lower = selector.to_ascii_lowercase();
    [
        "#extension-trust",
        "#provider-mode",
        "#account-billing",
        "#model-management",
        "#safe-mode",
        "#source-inspector",
    ]
    .iter()
    .any(|id| {
        lower.match_indices(id).any(|(start, _)| {
            let end = start + id.len();
            lower
                .as_bytes()
                .get(end)
                .is_none_or(|byte| !is_ascii_word(*byte))
        })
    })
}

fn skip_css_whitespace(source: &str, offset: &mut usize) {
    while let Some(character) = source.get(*offset..).and_then(|tail| tail.chars().next()) {
        if !is_ecmascript_whitespace(character) {
            break;
        }
        *offset += character.len_utf8();
    }
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

fn is_css_variable_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'
}

fn is_ascii_word(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

#[cfg(test)]
mod tests {
    use super::{
        ThemeCssExecution, ThemeCssPrivilegedSelectorPolicy, ThemeCssResourcePolicy,
        analyze_theme_stylesheet,
    };
    use serde_json::{Value, json};

    const CONFIGURATION_FIXTURE: &str =
        include_str!("../../../fixtures/configuration-inventory.json");

    #[test]
    fn analyzes_css_from_fixture_cases_without_executing_source() {
        let fixture: Value = serde_json::from_str(CONFIGURATION_FIXTURE)
            .expect("configuration inventory fixture must be valid JSON");
        for case in fixture["theme_analysis_cases"]
            .as_array()
            .expect("theme analysis cases must be an array")
        {
            let analysis = analyze_theme_stylesheet(
                case["source"]
                    .as_str()
                    .expect("theme analysis source must be a string"),
            );
            let actual = json!({
                "variables": &analysis.variables,
                "selectors": &analysis.selectors,
                "mode_support": {
                    "light": analysis.mode_support.light,
                    "dark": analysis.mode_support.dark,
                },
                "layout_contracts": &analysis.layout_contracts,
                "plugin_view_contracts": &analysis.plugin_view_contracts,
                "popout_contracts": &analysis.popout_contracts,
                "accessibility_contracts": &analysis.accessibility_contracts,
                "safety": {
                    "raw_css_execution": match analysis.safety.raw_css_execution {
                        ThemeCssExecution::NotExecuted => "not-executed",
                    },
                    "external_imports": match analysis.safety.external_imports {
                        ThemeCssResourcePolicy::Denied => "denied",
                    },
                    "url_assets": match analysis.safety.url_assets {
                        ThemeCssResourcePolicy::Denied => "denied",
                    },
                    "privileged_selector_policy": match analysis.safety.privileged_selector_policy {
                        ThemeCssPrivilegedSelectorPolicy::HostReviewRequired => "host-review-required",
                    },
                    "privileged_selectors": &analysis.safety.privileged_selectors,
                    "static_precheck_passed": analysis.safety.static_precheck_passed,
                },
                "issues": &analysis.issues,
            });
            assert_eq!(actual, case["expected"], "fixture case {}", case["id"]);
        }
    }
}
