# Privacy and diagnostics

OpenObsidian keeps the selected vault authoritative and local by default. The application does not upload private vault files, send note content as telemetry, or include provider secrets in diagnostics.

The in-app diagnostics control returns a local manifest containing only application version, platform, architecture, vault file count/type, provider mode/id and credential state. It deliberately excludes note content, provider secrets and absolute paths. The manifest destination is `local-export-only`; no network destination is configured by this contract.

Safe mode and extension-bisect are documented controls for isolating a reproduction. Plugin runtime certification, packaged crash-report behavior and managed-service retention remain separate handoffs and are not represented as completed by the local checks.
