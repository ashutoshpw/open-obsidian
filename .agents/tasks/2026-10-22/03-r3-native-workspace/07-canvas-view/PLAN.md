# 07 — Canvas viewer, text-card editing and explicit note creation

**Rows:** PROD-010 (Canvas journey), D03, C10 (Canvas workflow).

## Goal
Open `.canvas` files, render nodes and edges, edit text cards safely, and create notes only on explicit request.

## Scope
- Render projected nodes/edges (`CanvasDocument::project_nodes`, `project_edges`) with pan/zoom; text, file (opens note), link, group nodes; malformed/missing fields shown as issues, not dropped (`CanvasField::is_malformed`).
- Edit text card via `edit_text_node` then `encode_canvas`, saved with revision check; unknown JSON fields preserved by those APIs (verify with round-trip fixture).
- "Create note from card" is an explicit command with preview of path and content (`create_note`); never automatic.
- Embedded Bases in cards use task 08's `this.file` context.

## Design
- Same tab/dirty/save/conflict machinery as the editor (task 02): a `Canvas` tab kind with `{revision, document, dirty}`.
- Moving/resizing/adding edges is out of scope unless `crates/doc` grows mutation APIs; state this as a documented limit, not silent.

## Steps
1. Tab kind + viewer painter.
2. Text-card editor, save, conflict.
3. Create-note-from-card flow.
4. Fixtures: unknown fields, malformed nodes, large canvas.

## Acceptance / CI evidence
- Round-trip: open, edit one card, save -> only that node's text differs in bytes.
- Opening a canvas writes nothing; create-note requires confirmation (PROD-010 explicit approval).

## Risks
- Pinned Canvas feature surface is broader than viewer + text edit; list gaps as `failing`, not passing.
