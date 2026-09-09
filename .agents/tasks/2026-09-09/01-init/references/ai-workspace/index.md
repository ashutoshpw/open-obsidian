# AI workspace and provider data flows

Working specification · v0.3 · 9 September 2026. Confirmed decisions, proposals and untested requirements remain distinguished.

[Back to plan](../../plan.md) · [Decision register](../decisions/index.md)

## AI requirements

| ID | Capability | Acceptance contract |
| --- | --- | --- |
| A01 | Hybrid retrieval | Exact/full-text plus semantic retrieval; file/folder/tag/date filters; exclusions honored before indexing and inference. Incremental indexing and visible progress. Local keyword search works without AI. |
| A02 | Grounded answers | Citations resolve to the actual source revision/passage; distinguish source content from inference; expose missing/conflicting evidence; prevent cross-vault context leakage. |
| A03 | Editing | Draft, rewrite, summarize, outline and structured changes; reviewable changeset; per-file accept/reject; disk revision validation before apply; undo and recovery. |
| A04 | Organization | Link suggestions, property suggestions, duplicate analysis, rename/move plans, Canvas and Bases assistance. Never execute arbitrary model-generated formulas or code without the appropriate runtime boundary. |
| A05 | Provider modes | Managed service, BYOK and local endpoint/model. Explicit model/provider selection, credentials validation, timeouts, cancellation and readable error states. Never silently fall back from local to cloud. |
| A06 | Context/privacy | Show selected scope and provider destination. Per-vault/folder exclusions; sensitive files excluded by policy. Keys in OS credential storage. Configured remote inference necessarily exposes selected plaintext to that provider. |
| A07 | Costs | Preflight estimate where feasible, request/token usage, hard spending caps, quotas and transparent managed billing. Cancellation stops additional work where provider permits; disclose already incurred usage. |
| A08 | Lifecycle | Model download/version/storage management, hardware capability checks, offline state, stale embedding detection, model-change reindexing, deletion of derivatives, portable conversation export. |
| A09 | Agent boundaries | Retrieved notes and plugin output are untrusted data. They cannot grant tool permissions. Approved scope, preview and recoverable writes govern actions. Shell/network/connectors are separate opt-in capabilities. |

MCP/CLI integration is a proposed extension point: scoped read/search/propose/apply operations using the same broker and change journal. Do not bypass vault permissions through another integration path. Exact transport/authentication design is a later technical specification.

Managed operations and billing are explicitly deferred by D13. This goal implements the configurable OpenRouter-proxy client interface, scope/provider visibility, credential separation, cancellation, timeouts, errors and deterministic contract tests. Keep upstream proxy secrets server-side; never embed them in the desktop bundle. The proxy endpoint/authentication deployment contract is supplied later. A missing endpoint displays an honest unavailable/setup state, with no cloud fallback from local mode.

Operate accounts, entitlements, billing/pricing/reconciliation, production quotas and incident response in a later managed-service task. Preserve typed interfaces and usage/cap handling in the client without building a billing service now. Run provisioned live tests only when access exists; otherwise record live verification as external-pending, not passed. No paid provisioning or inference spend is authorized by this specification. BYOK/local implementations and available automated checks remain in scope. Do not promise provider retention/training terms without current evidence.

## AI data-flow specification checklist

| Mode | Credentials and context | Required open specification |
| --- | --- | --- |
| Managed | App account authorizes backend inference; only selected context sent | Provider/subprocessors, actual retention/training terms, regional routing, usage/billing, deletion, service failure behavior |
| BYOK | User key in OS credential storage; selected context sent to configured provider | Endpoint trust, provider-specific capabilities/terms, redacted errors, key rotation, quota handling |
| Local | Selected context sent only to configured local runtime | Model source/license/integrity, download/storage/RAM, local endpoint trust, offline operation, no remote fallback |

All modes need exclusion enforcement, embedding-storage/deletion policy, conversation export, provenance and model-switch behavior. A user-configured endpoint labeled local must be verified as local before making an on-device privacy claim.

Provider connectivity and AI acceptance metrics must align with the [release requirements](../quality-release/index.md).
