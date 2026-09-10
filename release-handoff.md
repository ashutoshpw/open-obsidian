# Release handoff

OpenObsidian reports implementation readiness separately from release readiness. Run `bun run final:audit` for the phase and acceptance-row breakdown, `bun run quality` for local checks, and `bun run release:check` to confirm that mandatory work is not being mistaken for a release approval.

## External gates

- Managed service: `operations-handoff` must provide an operated endpoint, retention/billing policy and live credentials. Verify selected-scope requests, redacted errors and retention behavior.
- Human validation: `product-ux` must obtain consented participants, fixture vaults and macOS/Windows/Linux hardware. Record counterbalanced find/synthesize/organize times, accuracy, keyboard/focus and screen-reader results.
- Signed artifacts: `desktop-release` must configure macOS notarization/signing, Windows signing and staging. Use a valid `vYYYY-MM-DD` tag, verify `release-manifest.json` hashes and inspect platform signatures.
- Publication: `operations-handoff` must authorize the hosted staging target only after the production gate passes. Verify the hosted artifact and rollback path; unsigned previews are not release-ready.
- Reference vault: `vault-filesystem` must run open-edit-save-reopen against Obsidian Desktop 1.13.7 and 1.14.1 and compare Markdown/Canvas bytes.
- Plugin runtime: `compatibility-runtime` must run the PC01-PC25 unchanged-artifact matrix on matching runtimes, retain hashes and record D15 outcomes. Missing implementation is not an unsupported-security exception.
- Updater/rollback: `desktop-release` must use signed update artifacts and a previous-version fixture to verify update manifests, downgrade and restoration.

No production release tag or public publication is created by the implementation goal. The current Actions artifacts are labeled preview and are not evidence of signed staging or release readiness.
