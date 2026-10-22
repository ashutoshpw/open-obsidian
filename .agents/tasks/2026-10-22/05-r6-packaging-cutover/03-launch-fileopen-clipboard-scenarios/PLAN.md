# 03 — Launch, file-open and clipboard scenarios

**Rows:** MIG-010 (equivalent workflows), PROD-001 (open in place from the installed app), Q-014.

## Goal
Show the packaged app, not just the dev build, launches, opens vaults/files from the OS and exchanges clipboard data correctly.

## Scope
- Launch scenarios: cold start, second-instance forwarding, open a vault passed on the command line or via OS file-open, missing/denied vault errors.
- File-open: OS-level open of `.md` through `crates/platform/src/external_open.rs` path (`open_external_file`) and inbound association handling; no unsolicited `obsidian://` registration (C13).
- Clipboard: copy/paste of text, wikilinks and attachments (images) using the egui/platform clipboard; synthetic vault only.

## Design
- Automation harness is open: headless scenario runner using a test-mode flag in `apps/openobsidian` that emits structured events (new), plus per-OS drivers (`xvfb` on Linux; native runners on macOS/Windows). UI-level GUI automation on macOS/Windows runners is a known fragile area; prefer in-process kittest-style checks where possible and label real-OS checks separately.
- Keep human accessibility/input validation external-pending (see handoff).

## Steps
1. Test-mode event stream and CLI argument contract documented.
2. Scenario matrix (launch, file-open, clipboard) with per-OS expected results, including recorded platform limitations.
3. CI job runs scenarios against the installed or unpacked package from task 02.

## Acceptance / CI evidence
- Scenario report JSON per OS for the exact SHA; failures are red, unsupported combinations listed as limitations with reasons.

## Risks
Clipboard and file-open automation on hosted runners may be unreliable; do not turn gaps into passes.
