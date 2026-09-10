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

P7 is a separately authorized expansion phase. Nothing in this section authorizes
mobile, own sync, autonomy, collaboration or publishing implementation in the
v1 desktop release. Each expansion needs its own product decision, threat model,
data-portability plan, owner and release gate.

### Mobile / future Expo client

- Separate decision: decide whether a native/Expo client is a read-only companion,
  a full editor or a separately scoped product. Reuse of the platform-neutral
  contracts in src/shared/ui may be evaluated after that decision; no mobile
  runtime or app-store target is part of v1.
- Prerequisites: mobile PRD and platform matrix, consented fixture vaults,
  offline/open-edit-save semantics, a synchronization decision, physical iOS
  and Android test devices, permission/privacy review, app identifiers,
  signing credentials and an accessibility/language test plan.
- Security and release gates: no arbitrary filesystem access, no secrets in the
  bundle, explicit keychain/keystore policy, least-privilege permissions,
  encrypted transport/storage decisions, conflict and recovery proof,
  screen-reader/IME/RTL coverage, signed install/update/rollback and data
  deletion/export verification.
- Verification: run the frozen vault portability corpus on each supported
  device/OS, compare bytes and revisions against the desktop contract, execute
  interrupted-write and conflict fixtures, then complete store-review and
  signed-artifact checks.

### Own encrypted sync service

- Separate decision: decide whether OpenObsidian should operate a sync service,
  which devices/accounts it serves, and whether end-to-end encryption is
  mandatory. Existing external sync compatibility does not make this a v1
  service.
- Prerequisites: protocol specification, threat model, server/storage design,
  device membership model, key generation/recovery/revocation design, offline
  replay and tombstone rules, binary/large-file policy, retention/deletion
  policy, incident owner and an authorized staging environment.
- Security and release gates: authenticated device enrollment, forward-secure
  key handling, no server plaintext, scoped authorization, replay protection,
  conflict/partial-sync correctness, quota isolation, audit logging without
  note-content leakage, backup/restore and account deletion proof.
- Verification: run multi-device offline and concurrent-edit fixtures with
  revoked keys, missing chunks, cloud placeholders and interrupted transfers;
  inspect redacted transport/storage evidence and complete an independent
  security review before any production operation.

### Scoped autonomy

- Separate decision: define which actions may be proposed, which require
  per-file approval, whether execution is local-only or provider-backed, and
  who can change those policies. v1 retains preview-only reviewed changes.
- Prerequisites: threat model and abuse cases, capability/consent model,
  evaluation corpus, model/provider policy, cancellation and kill-switch
  behavior, audit/recovery retention policy and a human escalation owner.
- Security and release gates: prompt-injection and untrusted-content isolation,
  bounded vault scope, no plugin or model bypass of approval, revision checks
  immediately before writes, undo/recovery, secret redaction, rate/cost caps
  and an independently reproducible evaluation result.
- Verification: replay adversarial fixtures, stale-revision and partial-failure
  cases, denied-capability probes and human review samples; publish only after
  the measured safety and accuracy thresholds are met.

### Collaboration

- Separate decision: decide whether collaboration is live co-editing, review/
  suggestion exchange or asynchronous change transfer, including actor,
  ownership and presence semantics. A CRDT alone does not reconcile arbitrary
  external file edits.
- Prerequisites: collaboration PRD, identity/authentication, roles and
  workspace membership, transport/service choice, revision/conflict protocol,
  presence/privacy policy, moderation/support owner and retention/deletion
  requirements.
- Security and release gates: tenant/workspace isolation, authorization on
  every read/write, encrypted transport and appropriate server storage,
  auditability, invitation/revocation, malicious-client handling, conflict
  recovery, no private-note leakage and a clear export/leave-workspace path.
- Verification: test concurrent edits, offline reconnect, revoked members,
  malformed events, duplicate/reordered events and workspace deletion on all
  supported clients; require independent security and usability sign-off.

### Publishing

- Separate decision: decide whether publishing is a static export, a hosted
  service or a user-operated target, what content is eligible, and whether
  publishing is one-way or supports a managed update/revoke lifecycle.
- Prerequisites: publishing PRD, destination/ownership, domain and hosting
  decision, content-selection and redaction rules, authentication/roles,
  asset/link handling, search/indexing policy, billing/support owner and a
  rollback/takedown plan.
- Security and release gates: private/excluded notes cannot be published,
  secrets and credentials never enter output, authenticated preview/deploy,
  immutable artifact hashes, access-control and cache invalidation proof,
  abuse/takedown process, backups and signed production artifacts.
- Verification: run an exclusion and secret-scanning corpus, compare exported
  links/assets and Unicode/RTL rendering, test preview-to-publish rollback and
  revocation, then record the authorized staging and publication evidence.
