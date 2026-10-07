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
if len(ids) != len(set(ids)) or set(ids) != set(legacy_by_id):
    errors.append("Migration requirements must cover each legacy ID exactly once")

for row in requirements:
    old = legacy_by_id.get(row["id"])
    if old is None:
        continue
    if row["source"] != old["source"]:
        errors.append(f"{row['id']}: original requirement source changed")
    if row["legacy_status"] != old["status"]:
        errors.append(f"{row['id']}: historical status was not retained")
    if row["migration_phase"] not in state["phases"] or not row["rust_owner"]:
        errors.append(f"{row['id']}: missing phase or Rust owner")
    if row["status"] == "passing" and not row["evidence_paths"]:
        errors.append(f"{row['id']}: Rust pass lacks migration evidence")

directories = ("src", "tests", "fixtures", "config", "scripts", ".github/workflows")
actual = {
    str(path)
    for directory in directories
    for path in Path(directory).rglob("*")
    if path.is_file()
}
recorded = {item["path"] for item in inventory["files"]}
# This new acceptance workflow is tooling added after the legacy inventory.
actual.discard(".github/workflows/rust-migration-inventory.yml")
if actual != recorded:
    errors.append(f"File inventory differs: added={actual-recorded}, missing={recorded-actual}")
for item in inventory["files"]:
    path = root / item["path"]
    if not path.is_file():
        continue
    if hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
        errors.append(f"Baseline file changed without inventory reconciliation: {item['path']}")

for name in ("goal.md", "state.json", "requirements.json", "inventory.json", "journal.md", "release-handoff.md", "preflight.md"):
    if not (task / name).is_file():
        errors.append(f"Missing progress artifact: {name}")

if errors:
    raise SystemExit("\n".join(errors))
print(f"R0 inventory: {len(requirements)} requirements and {len(recorded)} files accounted for")
print("Inventory integrity does not certify Rust implementation or plugin compatibility")
