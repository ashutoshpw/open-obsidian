//! Read-only projections of vault command hotkey overrides.

use serde_json::{Map, Value};
use std::collections::BTreeMap;

/// One stored shortcut combination for a vault command.
///
/// Modifier and key strings are retained exactly as found in the source. In
/// particular, this type does not resolve platform aliases or interpret a
/// keyboard layout.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HotkeyBinding {
    /// Modifier names in their original order, including unknown names.
    pub modifiers: Vec<String>,
    /// Main key string without normalization.
    pub key: String,
}

/// Supported command bindings projected from a vault `hotkeys.json` object.
///
/// Only command entries whose value is an array are projected. Valid binding
/// objects in each array are retained in source order; empty arrays remain
/// present. Unknown or malformed data stays available in the original JSON
/// object and bytes owned by the vault configuration inventory.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct HotkeysSettings {
    /// Command IDs and their ordered custom binding combinations.
    pub command_bindings: BTreeMap<String, Vec<HotkeyBinding>>,
}

/// Projects supported command binding arrays from a parsed JSON object.
///
/// This is a data-only view. It does not merge default bindings, validate
/// command IDs against installed plugins, normalize keys, or register
/// shortcuts with OpenObsidian.
pub fn parse_hotkeys_settings(raw: &Map<String, Value>) -> HotkeysSettings {
    let command_bindings = raw
        .iter()
        .filter_map(|(command_id, value)| {
            let bindings = value.as_array()?;
            let bindings = bindings.iter().filter_map(parse_binding).collect();
            Some((command_id.clone(), bindings))
        })
        .collect();

    HotkeysSettings { command_bindings }
}

fn parse_binding(value: &Value) -> Option<HotkeyBinding> {
    let object = value.as_object()?;
    let modifiers = object
        .get("modifiers")?
        .as_array()?
        .iter()
        .map(Value::as_str)
        .collect::<Option<Vec<_>>>()?
        .into_iter()
        .map(str::to_owned)
        .collect();
    let key = object.get("key")?.as_str()?.to_owned();

    Some(HotkeyBinding { modifiers, key })
}

#[cfg(test)]
mod tests {
    use super::{HotkeyBinding, parse_hotkeys_settings};
    use serde_json::{Map, Value};

    const CONFIGURATION_FIXTURE: &str =
        include_str!("../../../fixtures/configuration-inventory.json");

    #[test]
    fn projects_fixture_bindings_without_normalizing_or_mutating_source() {
        let fixture: Value = serde_json::from_str(CONFIGURATION_FIXTURE)
            .expect("configuration fixture must be valid JSON");

        for case in fixture["hotkeys_cases"]
            .as_array()
            .expect("hotkeys cases must be an array")
        {
            let raw: Map<String, Value> = case["source"]
                .as_object()
                .expect("hotkeys source must be a JSON object")
                .clone();
            let original = raw.clone();
            let projected = parse_hotkeys_settings(&raw);
            let expected = case["expected"]
                .as_object()
                .expect("hotkeys expected projection must be an object");

            assert_eq!(raw, original);
            assert_eq!(projected.command_bindings.len(), expected.len());
            for (command_id, expected_bindings) in expected {
                let expected_bindings = expected_bindings
                    .as_array()
                    .expect("expected command bindings must be an array");
                let actual_bindings = &projected.command_bindings[command_id];
                assert_eq!(actual_bindings.len(), expected_bindings.len());

                for (actual, expected) in actual_bindings.iter().zip(expected_bindings) {
                    let expected_modifiers = expected["modifiers"]
                        .as_array()
                        .expect("expected modifiers must be an array")
                        .iter()
                        .map(|modifier| modifier.as_str().unwrap().to_owned())
                        .collect::<Vec<_>>();
                    assert_eq!(
                        actual,
                        &HotkeyBinding {
                            modifiers: expected_modifiers,
                            key: expected["key"].as_str().unwrap().to_owned(),
                        }
                    );
                }
            }
        }
    }

    #[test]
    fn malformed_command_values_are_omitted_but_source_is_retained() {
        let raw: Map<String, Value> = serde_json::from_value(serde_json::json!({
            "malformed-command": "not-an-array",
            "malformed-binding": [{"modifiers": ["Shift", 7], "key": "K"}]
        }))
        .expect("inline hotkeys source must be an object");
        let projected = parse_hotkeys_settings(&raw);

        assert!(!projected.command_bindings.contains_key("malformed-command"));
        assert!(projected.command_bindings["malformed-binding"].is_empty());
        assert_eq!(raw["malformed-command"], "not-an-array");
        assert_eq!(raw["malformed-binding"][0]["modifiers"][1], 7);
    }
}
