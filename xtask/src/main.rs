use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::process::Command;

fn main() {
    let task = std::env::args().nth(1);
    let result = match task.as_deref() {
        Some("layers") => check_layers(),
        _ => Err("usage: cargo xtask layers".to_owned()),
    };

    if let Err(error) = result {
        eprintln!("xtask: {error}");
        std::process::exit(1);
    }
}

fn check_layers() -> Result<(), String> {
    let output = Command::new("cargo")
        .args(["metadata", "--format-version", "1", "--locked"])
        .output()
        .map_err(|error| format!("could not run cargo metadata: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "cargo metadata failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let metadata: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("could not parse cargo metadata: {error}"))?;

    let members: BTreeSet<String> = metadata["workspace_members"]
        .as_array()
        .ok_or_else(|| "cargo metadata omitted workspace members".to_owned())?
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect();
    let names: BTreeMap<String, String> = metadata["packages"]
        .as_array()
        .ok_or_else(|| "cargo metadata omitted packages".to_owned())?
        .iter()
        .filter(|package| {
            package["id"]
                .as_str()
                .is_some_and(|id| members.contains(id))
        })
        .filter_map(|package| {
            Some((
                package["id"].as_str()?.to_owned(),
                package["name"].as_str()?.to_owned(),
            ))
        })
        .collect();

    let allowed: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::from([
        ("openobsidian-doc", BTreeSet::from([])),
        ("openobsidian-vault", BTreeSet::from(["openobsidian-doc"])),
        (
            "openobsidian-engine",
            BTreeSet::from(["openobsidian-vault"]),
        ),
        ("openobsidian-platform", BTreeSet::from([])),
        (
            "openobsidian-plugins",
            BTreeSet::from(["openobsidian-doc", "openobsidian-engine"]),
        ),
        (
            "openobsidian-ui-egui",
            BTreeSet::from(["openobsidian-engine"]),
        ),
        (
            "openobsidian-testkit",
            BTreeSet::from([
                "openobsidian-doc",
                "openobsidian-engine",
                "openobsidian-plugins",
                "openobsidian-vault",
            ]),
        ),
        (
            "openobsidian",
            BTreeSet::from([
                "openobsidian-engine",
                "openobsidian-platform",
                "openobsidian-plugins",
                "openobsidian-ui-egui",
            ]),
        ),
        ("openobsidian-cli", BTreeSet::from(["openobsidian-engine"])),
        ("xtask", BTreeSet::from([])),
    ]);

    let mut violations = Vec::new();
    for node in metadata["resolve"]["nodes"]
        .as_array()
        .ok_or_else(|| "cargo metadata omitted resolved dependency nodes".to_owned())?
    {
        let Some(package_id) = node["id"].as_str() else {
            continue;
        };
        let Some(source_name) = names.get(package_id) else {
            continue;
        };
        for dependency in node["deps"].as_array().into_iter().flatten() {
            let Some(target_id) = dependency["pkg"].as_str() else {
                continue;
            };
            let Some(target_name) = names.get(target_id) else {
                continue;
            };
            let permitted = allowed
                .get(source_name.as_str())
                .is_some_and(|targets| targets.contains(target_name.as_str()));
            if !permitted {
                violations.push(format!("{source_name} -> {target_name}"));
            }
        }
    }

    if violations.is_empty() {
        println!("workspace crate dependencies follow the approved layer map");
        Ok(())
    } else {
        violations.sort();
        Err(format!(
            "forbidden workspace dependencies: {}",
            violations.join(", ")
        ))
    }
}
