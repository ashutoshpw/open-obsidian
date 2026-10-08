# Rust migration external handoff

| Item | Prerequisite and verification | Status |
| --- | --- | --- |
| Repository write access | Repository owner grants the connected identity write access or reconnects an authorized account; push R0.1 to origin/main and inspect exact-SHA CI. | Resolved: push and exact-SHA CI succeeded |
| CI capacity | Check repository Actions policy/quota and confirm Linux/macOS/Windows jobs can start. Recent successful jobs establish past availability only. | Three-OS jobs executed successfully; quota not inspected |
| Human accessibility/input | Test native screen readers, IME/RTL and focus/multiwindow behavior on supported hardware using consented synthetic vaults. | External pending |
| Native package cleanup adapter | After R6 selects a package format and the desktop process exits, map confirmed cleanup choices to `openobsidian_platform::cleanup_user_data`, report preserved journal-recovery directories, and surface credential cleanup failures. No current package invokes this API. | Pending R6 package integration and exact-SHA CI coverage |
| Signing/notarization | Configure platform signing credentials; validate installer signatures and update/rollback. Unsigned preview is not production acceptance. | External pending |
| Managed/live provider | Separate service authorization, endpoint and credentials; deterministic CI mocks do not certify live inference. | External pending |
| Publication and pilots | Separate release authority and consented real-vault/user validation; preserve no-content telemetry policy. | External pending |
