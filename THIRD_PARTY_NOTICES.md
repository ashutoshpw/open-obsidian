# Third-party notices

OpenObsidian is distributed under `AGPL-3.0-only`; see [LICENSE](LICENSE).

This tree contains the P0.2 contracts and the initial Electron shell. The
dependency inventory below is the current development surface; it is not a
claim that plugin bundles are being redistributed by this repository.

| Package/tool | Version | Purpose | License/source status |
| --- | --- | --- | --- |
| `@types/node` | 26.5.0 | Node.js type declarations | MIT; package metadata and lockfile |
| `typescript` | 7.0.2 | Type checking | Apache-2.0; package metadata and lockfile |
| `electron` | 44.3.0 | Desktop runtime | MIT; package metadata and lockfile; bundled runtime notices remain a release gate |
| `electron-builder` | 26.16.1 | Unpacked/package build | MIT; package metadata and lockfile |
| `knip` | 6.35.1 | unused-code audit | ISC; package metadata and lockfile |
| `fallow` | 3.24.0 | complexity and changed-code audit | invoked with signed `bunx`; not bundled; recheck before distribution |

The planned Electron and plugin release pins are recorded separately in
[`config/dependency-pins.json`](config/dependency-pins.json) and
[`fixtures/compatibility-manifest.json`](fixtures/compatibility-manifest.json).
Each shipped third-party artifact requires a license, source, brand and
redistribution review before a release status can become `passing`.
