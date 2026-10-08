"""R0 inventory acceptance check. Execute in GitHub Actions only."""

import hashlib
import json
from pathlib import Path


root = Path(__file__).resolve().parents[3]
task = Path(__file__).resolve().parent
legacy_path = root / ".agents/tasks/2026-09-09/01-init/requirements.json"
legacy = json.loads(legacy_path.read_text())["rows"]
requirements = json.loads((task / "requirements.json").read_text())["rows"]
inventory = json.loads((task / "inventory.json").read_text())
state = json.loads((task / "state.json").read_text())
errors = []

legacy_by_id = {row["id"]: row for row in legacy}
ids = [row["id"] for row in requirements]
if len(ids) != len(set(ids)) or not set(legacy_by_id).issubset(ids):
    errors.append("Migration requirements must cover each legacy ID exactly once and add unique Rust requirements")

valid_phases = {f"R{index}" for index in range(8)}
valid_owners = {
    "crates/doc", "crates/vault", "crates/engine", "crates/platform",
    "crates/plugins", "crates/ui-egui", "crates/testkit", "apps/openobsidian",
    "apps/openobsidian-cli", "xtask", "release-handoff",
}
valid_dispositions = {"retained", "superseded", "release_external"}
if len(requirements) != len(legacy_by_id) + 16:
    errors.append("Migration inventory must include all legacy requirements and 16 goal-specific requirements")
if state.get("milestones", {}).get("R0.1", {}).get("status") != "complete":
    errors.append("R0.1 must have passed GitHub CI before R0.2")

for row in requirements:
    old = legacy_by_id.get(row["id"])
    if old is None:
        continue
    if row["source"] != old["source"]:
        errors.append(f"{row['id']}: original requirement source changed")
    if row["legacy_status"] != old["status"]:
        errors.append(f"{row['id']}: historical status was not retained")
    if row.get("migration_phase") not in valid_phases or row.get("rust_owner") not in valid_owners:
        errors.append(f"{row['id']}: missing phase or Rust owner")
    if row.get("mapping_status") != "reviewed":
        errors.append(f"{row['id']}: Rust owner and phase mapping is not reviewed")
    if row.get("migration_disposition") not in valid_dispositions:
        errors.append(f"{row['id']}: missing migration disposition")
    if not row.get("migration_acceptance", "").strip():
        errors.append(f"{row['id']}: missing migration acceptance criteria")
    if row.get("migration_disposition") == "superseded" and row.get("status") != "superseded":
        errors.append(f"{row['id']}: superseded Electron-era requirement is still active")
    if row.get("migration_disposition") == "release_external" and row.get("status") != "external_pending":
        errors.append(f"{row['id']}: external requirement must remain external_pending")
    if row.get("status") == "passing" and not row.get("evidence_paths"):
        errors.append(f"{row['id']}: Rust pass lacks migration evidence")

new_rows = [row for row in requirements if row["id"] not in legacy_by_id]
expected_new = {f"MIG-{index:03d}" for index in range(1, 17)}
if {row["id"] for row in new_rows} != expected_new:
    errors.append("Goal-specific acceptance rows must cover MIG-001 through MIG-016")
for row in new_rows:
    if row.get("source", {}).get("path") != ".agents/tasks/2026-10-07/goal.md":
        errors.append(f"{row['id']}: migration requirement must cite this goal")
    if row["id"] == "MIG-015" and (row.get("migration_phase"), row.get("rust_owner")) != ("R1", "crates/plugins"):
        errors.append("MIG-015 must gate broad UI work with an R1 plugin feasibility spike")

directories = ("src", "tests", "fixtures", "config", "scripts", ".github/workflows")
actual = {
    str(path)
    for directory in directories
    for path in Path(directory).rglob("*")
    if path.is_file()
}
recorded = {item["path"] for item in inventory["files"]}
# These Rust migration workflows are tooling added after the legacy inventory.
actual.discard(".github/workflows/rust-migration-inventory.yml")
actual.discard(".github/workflows/rust.yml")
# This manually dispatched reference-app runner probe is migration evidence tooling.
actual.discard(".github/workflows/obsidian-reference-feasibility.yml")
# The pinned Linux vault author/open/reopen workflow is migration acceptance tooling.
actual.discard(".github/workflows/obsidian-vault-roundtrip.yml")
if actual != recorded:
    errors.append(f"File inventory differs: added={actual-recorded}, missing={recorded-actual}")
for item in inventory["files"]:
    path = root / item["path"]
    if not path.is_file():
        continue
    if hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
        errors.append(f"Baseline file changed without inventory reconciliation: {item['path']}")
    if item.get("mapping_status") != "reviewed" or item.get("rust_owner") not in valid_owners:
        errors.append(f"{item['path']}: source inventory mapping is incomplete")

for name in ("goal.md", "state.json", "requirements.json", "inventory.json", "journal.md", "release-handoff.md", "preflight.md", "decisions.md"):
    if not (task / name).is_file():
        errors.append(f"Missing progress artifact: {name}")

if errors:
    raise SystemExit("\n".join(errors))
print(f"R0 inventory: {len(requirements)} requirements and {len(recorded)} files accounted for")
print("Inventory integrity does not certify Rust implementation or plugin compatibility")
