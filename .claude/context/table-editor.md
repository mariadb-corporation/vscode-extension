# The table editor

Back to [`../PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md). The trees and
Object Details are [`object-details.md`](object-details.md), the diagram's
card menu [`modeler.md`](modeler.md), the edit ops
[`modeler-tools.md`](modeler-tools.md).

## What the user asked for

A table editor for a live connection's tables and an MSM project's, with
DBX's layout (github.com/t8y2/dbx, `TableStructureEditor.vue`): a header
with the table's path and comment, then tabs, in VS Code's controls; the
Columns grid in Tabulator. Opened by **Edit Table...** on a table row of
the Connections view and of MSM Projects, and from a diagram's table card
menu, in the lower half of a vertical split of the main editor. The
read-only Object Details view left editing to this editor.

## Where it lives

| File | Role |
| --- | --- |
| `src/tableEditor/tableDraft.ts` | Pure, shared with the page: the draft (`draftOf`; each row's `origin`, its place in the table as read, so a rename is not a drop and an add, and an unnamed index can still be dropped; `dropped` rows), `tableEdits` (draft → ops), `draftProblems`, the type and key-part text helpers |
| `src/tableEditor/lspEdit.ts` | `LspEdit`: `mariadb-lsp edit` on a script's text (stdin) or a file, the request in a temp file; no edits reads the outline |
| `src/tableEditor/tableSources.ts` | `LiveTableSource`, `ProjectTableSource` (read, preview, apply), `COMMON_COLLATIONS` |
| `src/tableEditor/tableEditorPanel.ts`, `tableEditorProtocol.ts` | The panel (one per table, `tableEditorKey`) and its messages |
| `webview/src/tableEditor/TableEditor.tsx`, `ControlGrid.tsx`, `tableEditor.tsx`, `tableEditorStyles.css`, `vite.tableEditor.config.ts` | The page, its own build (`dist/webview/tableEditor.{js,css}`) |

## How it behaves

- **Where it opens**: beside the table editors already open; else
  `workbench.action.newGroupBelow` and the new group (in an empty editor
  area, the active group). Asking for an open table's editor reveals it.
- **Layout (DBX's)**: path bar (database icon, `connection / schema /
  table`, a badge: the server's version or "MSM Project", Refresh
  Structure, which asks again before it throws changes away); Table name
  and Comment; tabs DDL, Columns, Indexes, Foreign Keys, Triggers as a
  segmented control, the tab's actions to their right (View Data, live
  only, through `selectRows`; density Compact / Standard / Comfortable;
  Columns: search, Add Column, Copy Column Names); under the tab the SQL
  Preview with Copy SQL, Discard Changes, and Apply Changes (Save to
  Project for a project).
- **The grids** (`ControlGrid`) are Tabulator with cells of controls
  that always show (inputs, checkboxes, selects; a text input with a ▾
  of choices, `comboInput`), as DBX's. New rows `replaceData` the grid;
  the control that had the focus is found again by `data-key` /
  `data-field`, so Tab survives the commit of the input left. Formatters
  call the page's column specs of the latest render (not the first).
- **Row bars are index membership**, DBX's colours: primary amber, unique
  red, index green, fulltext purple, spatial cyan; not "changed". A
  dropped row stays, struck out, with Restore; a new row removed goes.
- **Columns**: #, Actions (Copy Column, Drop / Restore), Column, Type (the
  type without its parentheses, `smallint unsigned`), Length (what is in
  them), Nullable, Primary Key (ticking it clears Nullable; the primary
  key comes from these boxes, not the Indexes tab), Default (presets),
  Comment, Charset, Collation, Extended (Virtual: the generated
  expression and its storage; Auto Increment; Auto Update Time: `ON
  UPDATE CURRENT_TIMESTAMP`). Indexes: name, kind, key parts as text
  (`col(10) DESC, col`; the ▾ adds a column), USING, comment. Foreign
  keys: a grid (DBX has cards), referenced table and columns from the
  schema. Triggers: a grid of name, timing, event; the selected one's
  body in a text area below.
- **Save** works out the edits from the draft (`tableEdits`): rename the
  table first, drop changed / gone foreign keys, triggers, indexes and
  columns, modify changed columns (whole: a member left out takes the
  outline's default), add new columns after the one before them (or
  `first`), then the primary key, indexes, foreign keys, the comment,
  trigger renames and (re)creates. A changed trigger is dropped and
  created. Existing columns cannot be reordered (no op for it).
- **The preview** posts the edits 250 ms after the draft settles; the
  extension answers with the migration statements.
- **A live table** is read as its `SHOW CREATE TABLE`, the tables a
  foreign key joins it to (same schema), and its triggers' `SHOW CREATE
  TRIGGER` (in `DELIMITER $$`), which `mariadb-lsp edit` with no edits
  reads into the outline; the schema's columns
  (`information_schema.COLUMNS`) and collations for the pickers. The
  preview and Apply run the same script with the edits: the other tables
  in it make a changed column that their foreign keys use come with the
  DROP / ADD CONSTRAINT MariaDB needs (error 1833). Apply runs `USE` and
  then each statement through `db.execute_sql` on the UI backend
  session, stopping at the first error: the ones before it stay run
  (`PartlyAppliedError`), the table is read again and the page says how
  many ran. msm's `trigger-created` notes are dropped there.
- **A project's table** is msm's snapshot's; Save calls
  `ProjectModelSource.edit` (the diagrams' source, so in the project's
  queue) with the snapshot's `source_hash`. The DDL tab and the preview
  run the binary on the development script
  (`development/<schemaFileName>_next.sql`, from `msm.project.json`),
  reading nothing msm does not; the DDL is the table's range of the file
  (or of the included file its `source` names).
- After a Save: Object Details, the tree (a project's `refreshProject`,
  a connection's `refreshServer`) and the open diagram read again.
- The binary is found as the language server is (`mariadb.lsp.path`,
  PATH, the shell's installations), once; none found is looked for again.

## Not done yet

- DBX's Copy Fields from Another Table, Paste fields, Insert Preset
  Fields, the column settings gear, the table's engine / charset /
  collation, column reordering by drag, an ENUM values popover, a
  multi-select column picker for indexes, the DDL tab being editable.
- Apply asks nothing first (DBX asks for production connections only).
- A live Apply is not on the Actions tab; it is logged.
- An AUTO_INCREMENT column that only becomes a key in the same Save fails
  (MODIFY runs before `set_primary_key`).

## Checked

- `tableDraft` unit tests; the page around the grids
  (`webview/test/TableEditor.test.tsx`; Tabulator never builds in jsdom).
- `LiveTableSource` against the real binary with canned query answers
  (sakila's actor and film_actor, a trigger): the ALTERs, the foreign
  key dropped and added back around a column change, no edit for
  unchanged columns. `ProjectTableSource`'s DDL and preview on a real
  project's script.
- The page rendered in headless Chrome with a dark theme's variables.
- **Not yet tried in a running VS Code**: opening below the editor, a
  live Apply against a server, a project's Save through msm, the diagram
  menu entry.
