"""R0 inventory acceptance check. Execute in GitHub Actions only."""

import hashlib
import json
from pathlib import Path


root = Path(__file__).resolve().parents[3]
task = Path(__file__).resolve().parent
legacy_path = root / ".agents/tasks/2026-09-09/01-init/requirements.json"
legacy = json.loads(legacy_path.read_text())["rows"]
requirement_manifest = json.loads((task / "requirements.json").read_text())
requirements = requirement_manifest["rows"]
inventory = json.loads((task / "inventory.json").read_text())
state = json.loads((task / "state.json").read_text())
errors = []

legacy_by_id = {row["id"]: row for row in legacy}
ids = [row["id"] for row in requirements]
if len(ids) != len(set(ids)) or not set(legacy_by_id).issubset(ids):
    errors.append("Migration requirements must cover each legacy ID exactly once and add unique Rust requirements or decomposed child rows")

valid_phases = {f"R{index}" for index in range(8)}
valid_owners = {
    "crates/doc", "crates/vault", "crates/engine", "crates/platform",
    "crates/plugins", "crates/ui-egui", "crates/testkit", "apps/openobsidian",
    "apps/openobsidian-cli", "xtask", "release-handoff",
}
valid_dispositions = {"retained", "superseded", "release_external"}
expected_new = {f"MIG-{index:03d}" for index in range(1, 17)}
expected_decomposed = {f"C07.{index}" for index in range(2, 10)}
expected_canvas = {"C06.2"}
new_rows = [row for row in requirements if row["id"] not in legacy_by_id]
goal_rows = [row for row in new_rows if row["id"].startswith("MIG-")]
decomposed_rows = [row for row in new_rows if row["id"].startswith("C07.")]
canvas_rows = [row for row in new_rows if row["id"].startswith("C06.")]
if {row["id"] for row in goal_rows} != expected_new:
    errors.append("Goal-specific acceptance rows must cover MIG-001 through MIG-016")
if len(goal_rows) != 16:
    errors.append("Goal-specific acceptance row count must remain 16")
if {row["id"] for row in decomposed_rows} != expected_decomposed:
    errors.append("C07 decomposition must include child requirements C07.2 through C07.9")
if {row["id"] for row in canvas_rows} != expected_canvas:
    errors.append("C06 decomposition must include the typed Canvas projection requirement C06.2")
if {row["id"] for row in new_rows} != expected_new | expected_decomposed | expected_canvas:
    errors.append("Migration requirements contain an unrecognized new requirement ID")

mapping_review = requirement_manifest["mapping_review"]
expected_reviewed_count = len(legacy_by_id) + len(new_rows)
if mapping_review.get("legacy_requirement_count") != len(legacy_by_id):
    errors.append("Legacy requirement count must match the inherited requirement IDs")
if mapping_review.get("reviewed_requirement_count") != expected_reviewed_count:
    errors.append("Mapping review count must include inherited requirements and every recognized new requirement row")
if mapping_review.get("new_migration_requirement_count") != len(new_rows):
    errors.append("New migration requirement count must include MIG and recognized C06/C07 decomposition rows")
goal_sha256 = hashlib.sha256((task / "goal.md").read_bytes()).hexdigest()
if mapping_review.get("goal_sha256") != goal_sha256:
    errors.append("Mapping review must record the current Rust migration goal SHA-256")

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

for row in goal_rows:
    if row.get("source", {}).get("path") != ".agents/tasks/2026-10-07/goal.md":
        errors.append(f"{row['id']}: migration requirement must cite this goal")
    if row["id"] == "MIG-015" and (row.get("migration_phase"), row.get("rust_owner")) != ("R1", "crates/plugins"):
        errors.append("MIG-015 must gate broad UI work with an R1 plugin feasibility spike")
for row in decomposed_rows:
    parent = legacy_by_id.get(row.get("parent_id"))
    if row.get("parent_id") != "C07" or parent is None or row.get("source", {}).get("path") != parent.get("source", {}).get("path") or row.get("source", {}).get("heading") != parent.get("source", {}).get("heading"):
        errors.append(f"{row['id']}: decomposed requirement must retain C07 parentage and legacy source")
for row in canvas_rows:
    if (
        row.get("parent_id") != "C06"
        or row.get("source", {}).get("path") != "https://jsoncanvas.org/spec/1.0/"
        or row.get("source", {}).get("heading") != "JSON Canvas Spec 1.0"
        or (row.get("migration_phase"), row.get("rust_owner")) != ("R2", "crates/doc")
        or row.get("mapping_status") != "reviewed"
    ):
        errors.append(f"{row['id']}: Canvas requirement must retain C06 parentage and the reviewed JSON Canvas 1.0 document-layer mapping")

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
# The manual Cargo.lock resolver is migration dependency tooling.
actual.discard(".github/workflows/resolve-cargo-lock.yml")
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
