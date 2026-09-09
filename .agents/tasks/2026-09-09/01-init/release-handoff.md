# OpenObsidian release handoff

Implementation readiness and external release readiness are separate. This document records work that is intentionally not claimed as complete by the implementation goal.

## Human validation — external-pending

Owner: product/QA. Prerequisites: a consented synthetic-to-real-vault pilot, pinned macOS/Windows/Linux hardware, screen-reader access, representative Hindi/IME and RTL users, and the frozen comparison scorecard. Procedure: run the counterbalanced find/synthesize/organize tasks against stock Obsidian, the certified plugin profile and OpenObsidian; record task time, answer accuracy, citation correctness, accessibility findings and recovery outcomes in a dated evidence file. Gate: no launch-blocking accessibility or data-loss/security issue and the practical-benefit target is met without accuracy loss.

## Managed service and billing — external-pending

Owner: managed-service/backend operations. Prerequisites: an authorized OpenRouter-proxy endpoint, server-side secret/configuration, account/entitlement contract, regional/provider retention terms, quota/billing/reconciliation policy and incident owner. Procedure: configure a non-production endpoint, run the deterministic proxy contract suite plus a live request with a test account, verify scope/destination/usage/caps/cancellation/error behavior, and record response/artifact hashes without storing secrets. Gate: live evidence is labeled separately from fixtures; no pricing or paid entitlement is inferred from this repository.

## Signing and live platform access — external-pending

Owner: release operations. Prerequisites: Apple signing/notarization credentials, Windows signing certificate, any Linux signing/repository credentials and available GitHub Actions runner access. Procedure: run the tag workflow against a verified `main` commit, verify each signature/notarization/package checksum and test install/update/rollback/offline/uninstall on each available OS. If credentials are absent, retain clearly labeled unsigned preview artifacts and a failed/blocked production signing gate; never publish an unsigned production artifact silently.

## Hosted staging and public publication — external-pending

Owner: release operations/project maintainer. Prerequisites: an authorized staging target in the assigned GitHub project and an explicit production release decision. Procedure: push a phased commit to `origin/main`, inspect the resulting Actions run and staging deployment, then only after signed artifacts and a valid non-duplicate `vYYYY-MM-DD` tag exist, execute the publication workflow and record URLs, run IDs and artifact hashes. Creating a production tag or public release is outside this implementation goal.

## P7 expansion handoff — outside v1

Mobile, own encrypted sync, autonomy, collaboration and publishing require separate product/security decisions, threat models, data portability plans and release gates. No implementation of those expansions is authorized by this goal.
