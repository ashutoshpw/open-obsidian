# 09 — Exit portability and export

**Rows:** C14.

## Goal
Files edited here reopen and behave correctly in reference Obsidian; AI-style outputs default to ordinary Markdown/Canvas; chat export exists; notes need no proprietary database.

## Scope
- Back-and-forth reference tests: edit in Rust, open in Obsidian 1.14.4, edit there, reopen here.
- Exported notes and Canvas are portable without the app database (the vault index in `crates/engine/src/index.rs` is in-memory and rebuildable; verify nothing is stored only in app data).
- Chat/AI output export as Markdown/Canvas. The AI producer is R5; here only the export format contract and fixtures.

## Design
- Existing: `fixtures/exit-portability.json`, `ai-changes.json`, `golden-edit-fidelity.json`; reference tooling from task 06.
- New: an `export` module (likely `crates/engine/src/export.rs`) writing Markdown/Canvas via existing revision-checked writers and `CanvasDocument`. Chat export UI hook is new; chat itself is not built yet, so export tests use fixture transcripts.
- Verify the "no database" claim by deleting app data in a test and reopening the vault.

## Steps
1. Define the export format (frontmatter, links, attachments) in a short doc.
2. Implement exporters with fixtures; reuse task 06's snapshot helper.
3. Add the delete-app-data reopen test.
4. Extend the reference workflow with a back-and-forth step.

## Acceptance / CI evidence
- Exact-SHA evidence of the back-and-forth runs on 3 OSes; export byte fixtures.

## Risks
C14 spans R5 (AI outputs); the AI half may have to stay pending with a recorded dependency. Rewrites by Obsidian on edit are expected and not failures.
