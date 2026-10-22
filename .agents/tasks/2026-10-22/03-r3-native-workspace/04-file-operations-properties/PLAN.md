# 04 — File operations UI and properties pane

**Rows:** D03, C10 (file workflows), PROD-010 (organization, preserved versions).

## Goal
Create, rename, move and delete from the explorer, each with a visible preview and explicit confirmation; edit frontmatter properties safely.

## Scope
- Create note/folder (`VaultSession::create_note` / `create_folder`, confined to vault), delete -> `.trash` via `trash_note` (restore listed), rename/move with link-update preview.
- Rename/move: use `crates/vault` `apply_rename_preview` (rename_transaction.rs); the UI shows files and edit counts (there is a `MAX_RENAME_PREVIEW_EDITS` cap in the inspector — reuse its approach) before apply.
- Properties pane: list/edit frontmatter via `doc::render_property_edit(key, raw_value)` producing a revision-checked write; invalid YAML shown, never rewritten silently.

## Design
- One `FileOperationPlan` type in workspace code: `{kind, affected paths, edits, expected revisions}`; UI renders it, user confirms, backend applies, result journaled. Cancel = no disk change.
- Engine does not yet expose a rename/move facade (only the vault-level transaction; verify) — add `VaultSession::rename_note` in this task if absent.
- Open tabs follow renames; deleted notes close tabs with a notice.

## Steps
1. Engine facade check/add: rename/move plan + apply, with unit tests.
2. Explorer context menus and keyboard actions; confirm dialogs (modal only for destructive/multi-file).
3. Properties pane with type-aware editors (text, list, checkbox, date as raw if unsure).
4. Tab/index refresh after each operation.

## Acceptance / CI evidence
- E2E synthetic vault: create, rename with backlinks updated, move, trash, restore; byte-diff assertions; stale-revision refusal.
- Path traversal / outside-vault attempts refused.

## Risks
- Rename over case-insensitive filesystems (macOS/Windows CI legs). Date/list property typing against fixtures is unverified.
