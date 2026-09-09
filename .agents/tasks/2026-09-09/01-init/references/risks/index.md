# Risk register

Working specification · v0.3 · 9 September 2026. Confirmed decisions, proposals and untested requirements remain distinguished.

[Back to plan](../../plan.md) · [Decision register](../decisions/index.md)

## Risk register

| Risk | Response / decision trigger |
| --- | --- |
| Plugin relies on private internals | Fixture evidence, adapter cost, compatibility tier; revisit release contract with user if infeasible |
| Theme parity constrains redesign | Stable legacy surface plus additive AI UI; prototype actual themes before choosing DOM architecture |
| Legacy code has broad filesystem/network access | Explicit trusted mode or stronger isolation feasibility; never claim permission enforcement against code that bypasses it |
| File normalization destroys syntax | Lossless representations, surgical edits, unknown-field retention and golden tests |
| External writer/sync races | Revision checks, preserved versions, transaction recovery and supported-tool matrix |
| AI leaks or invents knowledge | Enforced exclusions, citations/evals, provider visibility and controlled changes |
| Managed AI economics fail | Usage metering, caps, provider cost scenarios and pricing validation before unlimited offers |
| Upstream changes outpace team | Pin certified versions, regression automation, periodic maintenance capacity |
| Ecosystem licensing/distribution constraints | Per-artifact license and brand review before redistribution; no assumption that public API types license proprietary implementation |
| Scope prevents launch | Phase functionality transparently; user decides changes to confirmed requirements |
