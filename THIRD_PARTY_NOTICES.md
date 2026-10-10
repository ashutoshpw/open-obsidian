# Third-party notices

OpenObsidian is distributed under `AGPL-3.0-only`; see [LICENSE](LICENSE).

This tree contains the P0.2 contracts and the initial Electron shell. The
dependency inventory below is the current development surface; it is not a
claim that plugin bundles are being redistributed by this repository.

| Package/tool | Version | Purpose | License/source status |
| --- | --- | --- | --- |
| `@types/bun` | 1.4.2 | Bun type declarations | MIT; package metadata and lockfile |
| `@types/node` | 26.5.0 | Node.js type declarations | MIT; package metadata and lockfile |
| `typescript` | 7.0.2 | Type checking | Apache-2.0; package metadata and lockfile |
| `electron` | 44.3.0 | Desktop runtime | MIT; package metadata and lockfile; bundled runtime notices remain a release gate |
| `electron-builder` | 26.16.1 | Unpacked/package build | MIT; package metadata and lockfile |
| `knip` | 6.35.1 | unused-code audit | ISC; package metadata and lockfile |
| `fallow` | 3.24.0 | complexity and changed-code audit | invoked with signed `bunx`; not bundled; recheck before distribution |

## Rust runtime addition: native Markdown math

`latex-rust` 1.0.2 is used by the Rust UI for standard Markdown math preview.
The application selects the `std` and `png` features; its optional egui 0.28
integration is disabled. The pinned crates.io archive has SHA-256
`002bcaf7505b3516103424d8211b44cc4eb401cec17d35283402882b403c11fc`, matching
`Cargo.lock`, and records upstream source commit
[`b5391dd`](https://github.com/jscarr64/LaTeX-Rust/tree/b5391dd306a792a7327a0a76bfa84fb9827d77c5).
The crate is licensed under MIT OR Apache-2.0; copies of both license texts and
the package `NOTICE` are in [`licenses/latex-rust/`](licenses/latex-rust/).

The crate embeds STIX Two Math 2.13, copyright The STIX Fonts Project Authors,
with portions copyright MicroPress, Inc., Elsevier, Inc., and Adobe Systems
Incorporated. The font is licensed under SIL Open Font License 1.1. Its complete
copyright and license text is included at
[`licenses/latex-rust/STIX-Two-Math-OFL-1.1.txt`](licenses/latex-rust/STIX-Two-Math-OFL-1.1.txt).
The font license applies to the font software, not documents rendered with it.

This entry records the new direct Rust runtime dependency for this migration
slice. The Rust application dependency and packaged-artifact notice audit is
still in progress and remains a release gate.

The planned Electron and plugin release pins are recorded separately in
[`config/dependency-pins.json`](config/dependency-pins.json) and
[`fixtures/compatibility-manifest.json`](fixtures/compatibility-manifest.json).
Each shipped third-party artifact requires a license, source, brand and
redistribution review before a release status can become `passing`.

The direct package metadata and notice inventory is machine-checked with
[`config/distribution-audit.json`](config/distribution-audit.json) by running
`bun run verify:distribution`. The check confirms the package versions,
declared licenses, local license files, HTTPS sources and notice entries. After
packaging, run `bun run release:gate -- --artifacts-dir out`, followed by
`bun run audit:packaged -- --artifacts-dir out` and
`bun run audit:dependencies -- --artifacts-dir out` for each platform artifact.
The packaged checks validate the release manifest, Electron/Chromium/Node
notice assets and the `app.asar` dependency boundary. The transitive audit
records license/source metadata for the installed graph, treats Electron's
runtime separately from install-only tooling edges, and requires every
package path inside `app.asar` to be represented by that graph. Unsigned
preview validation does not replace per-artifact brand/legal review,
signing/notarization, publication or offline installation gates.
