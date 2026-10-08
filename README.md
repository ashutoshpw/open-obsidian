# OpenObsidian

OpenObsidian is an in-progress migration to a native Rust desktop application using egui/eframe. The Rust preview opens existing Obsidian vault folders in place; the full product migration and compatibility acceptance remain in progress. The earlier Electron implementation and its CI workflows are retained as behavioral references until their Rust replacements pass.

## Run the native preview

After obtaining the Rust preview executable from a successful GitHub Actions run, launch it normally to choose a vault folder, or pass an existing vault path directly:

```sh
openobsidian --open-vault "/path/to/Existing Vault"
```

The selected folder remains the authoritative vault. OpenObsidian stores its private per-vault data outside that folder.

## Migration validation

GitHub Actions is the only validation environment for the Rust migration. Run tests, builds, formatting checks, Clippy, fixture audits and runtime probes through the repository workflows. Do not substitute local test, build, lint, format or application-launch results for CI. Work is committed in small slices to `main`; exact-SHA workflow results and evidence are recorded under `.agents/tasks/2026-10-07/`.

The migration workflow retains the Electron quality and packaging jobs as reference checks while adding the Rust three-platform workspace matrix and migration-inventory validation. A green workflow validates only the checks it contains; unsupported or untested product workflows remain explicitly pending.
