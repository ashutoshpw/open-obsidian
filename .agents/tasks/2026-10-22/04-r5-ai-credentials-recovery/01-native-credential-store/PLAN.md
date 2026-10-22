# 01 — Native credential store and migration

**Rows:** MIG-009, A06 (secret-separation half), AI-004, D07 (BYOK key handling).

## Goal
An OS-keychain `CredentialStore` implementation and a safe migration from the legacy Electron `safeStorage` blob, with honest unavailable and key-loss states.

## Scope
- Implement the existing `CredentialStore` trait (`crates/platform/src/lib.rs`) for macOS Keychain, Windows Credential Manager and Linux Secret Service; implement `delete_all_for_application` where the backend can enumerate the app namespace (the R6 cleanup adapter depends on it).
- Detect the legacy encrypted store written by `src/electron/provider-credentials.ts` (base64 `safeStorage` values keyed by reference); migrate only when decryption is possible, never log values, delete the legacy entry only after a verified read-back.
- Key-loss/unavailable: legacy entries that cannot be decrypted are reported, left untouched and offered for re-entry.

## Design
- New `crates/platform/src/credentials.rs`; backend crate choice (`keyring` or direct OS crates) is **undecided**, record it in `decisions.md` with license review (feeds R6 RISK-009). Test-only `MemoryCredentialStore` stays in a test module, behind `cfg(test)`/feature, never selectable at runtime.
- No fallback to a file: an unavailable keychain returns `CredentialStoreError` with a stable reason.
- Keys are opaque references (`provider:<id>`); the vault and `.obsidian` never hold references to secret values.

## Steps
1. Backend selection record; trait conformance suite parameterized over backends.
2. OS implementations behind `cfg(target_os)`; unavailable-path tests via an injectable backend.
3. Legacy-store detector + migrator over a synthetic fixture (fake blob, injected decryptor) — no real secrets.
4. Secret-leak scan: assert sentinel secrets never appear in logs, errors, vault tree or app-data files.

## Acceptance / CI evidence
- Conformance, migration (success, partial, key-loss) and unavailable tests pass on 3 OSes with synthetic sentinels; real-keychain smoke tests run only where the runner supports it and are labelled as such.

## Risks
CI runners (esp. Linux without a Secret Service daemon) may not offer a keychain; plan for a runner-provisioned `gnome-keyring` step, else record the platform limitation honestly rather than faking coverage.
