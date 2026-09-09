# Quality, testing and release operations

Working specification · v0.3 · 9 September 2026. Confirmed decisions, proposals and untested requirements remain distinguished.

[Back to plan](../../plan.md) · [Decision register](../decisions/index.md)

## Quality and superiority scorecard

Targets below are proposals, not measured results. Benchmark on pinned reference hardware/OS and identical corpora. Separate stock runs, certified plugin-profile runs and AI workloads. Report distribution and regressions, not only averages.

| Area | Proposed release gate |
| --- | --- |
| No-op fidelity | 100% fixture files byte-identical after open/index/close; no unintended content/config writes |
| Edit fidelity | Approved edits only; all unrelated bytes/unknown fields preserved; round trip back into reference Obsidian |
| Required extensions | Every declared launch-critical plugin/theme workflow passes on each applicable version/OS in the pinned support matrix; documented upstream-intrinsic restrictions must match reference Obsidian; exceptions block certification |
| Reliability | No unacknowledged content loss in failure-injection suite; complete recoverable versions for unresolved conflicts |
| Startup | p95 ≤2 seconds to editable prior note on 10k-note reference vault, full indexing not required first |
| Responsiveness | Input-to-paint p95 ≤16 ms, p99 ≤50 ms on agreed editing fixture; large-file behavior separately measured |
| Search | Warm keyword results p95 ≤150 ms; external edit reflected within 2 seconds under normal watch operation |
| Resource use | Establish RAM/CPU/battery budgets at 1k/10k/100k notes in prototype; local model memory reported separately |
| AI evidence | ≥95% supported factual claims in adjudicated answer set; citations correct and navigable; zero excluded-file disclosures in test suite |
| Practical advantage | Pilot users complete agreed find/synthesize/organize tasks ≥25% faster than their plugin-equipped Obsidian setup, with no decrease in answer accuracy |
| Accessibility | Core journeys pass keyboard and screen-reader review; no launch-blocking focus, contrast or input issues |

Use counterbalanced pilot tasks to reduce familiarity bias. Define corpus composition, plugin versions, hardware, network/model conditions, number of runs, failure budget and evaluation rubrics before claiming success. Compare AI quality by task and model; selecting a stronger model is not evidence that our application architecture is superior.

## Test and release program

Create synthetic golden vaults first, then consented real-vault fixtures. Include Markdown dialect edge cases, malformed files, huge notes, attachment-heavy vaults, Canvas and Bases, duplicate names, Unicode, conflicting configs and plugin-owned data. Never upload private pilot vault contents for diagnostics by default.

Test layers: parser/link differential tests against reference behavior; byte-level round trips; extension API contracts; screenshots and interaction traces for themes; end-to-end workflows; crash/disk/network fault injection; long-running resource tests; prompt-injection and exclusion tests; upgrade/downgrade and uninstall. Reference implementation behavior discrepancies become tracked decisions.

Distribution: signed/notarized macOS build, signed Windows installer, selected Linux packages; architecture matrix decided in prototype. Release channels, updater integrity, rollback, schema migrations, offline installer behavior and extension compatibility checks are mandatory. Security updates must not wait indefinitely for all legacy extensions to adapt.

Operations: privacy-preserving opt-in diagnostics, local exportable support bundle, crash safe mode, extension bisect/disable, known-issues matrix, recovery documentation, vulnerability reporting, release notes and rollback runbook. No note content or provider secrets in default telemetry.

## Additional release details to resolve

Additional release details to resolve: proxy/firewall support, minimum OS and architecture versions, update channels, plugin update rollback, app crash-free-session target, adoption/retention measures and AI change acceptance rate. Pilot data should set credible targets rather than inventing business forecasts.
