# Rust migration external handoff

| Item | Prerequisite and verification | Status |
| --- | --- | --- |
| Repository write access | Repository owner grants the connected identity write access or reconnects an authorized account; push R0.1 to origin/main and inspect exact-SHA CI. | Blocking CI |
| CI capacity | Check repository Actions policy/quota and confirm Linux/macOS/Windows jobs can start. Recent successful jobs establish past availability only. | Pending |
| Human accessibility/input | Test native screen readers, IME/RTL and focus/multiwindow behavior on supported hardware using consented synthetic vaults. | External pending |
| Signing/notarization | Configure platform signing credentials; validate installer signatures and update/rollback. Unsigned preview is not production acceptance. | External pending |
| Managed/live provider | Separate service authorization, endpoint and credentials; deterministic CI mocks do not certify live inference. | External pending |
| Publication and pilots | Separate release authority and consented real-vault/user validation; preserve no-content telemetry policy. | External pending |
