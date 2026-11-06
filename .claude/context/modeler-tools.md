# The diagram viewer's tool palette

Back to [`../PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md); the viewer as a
whole is [`modeler.md`](modeler.md).

## What the user asked for

A floating vertical Diagram Toolbar, built like the Navigator, carrying
the canvas's pointer, hand and zoom (moved off the horizontal toolbar)
and Workbench's EER tools: placing tables, views, routine groups, layers
(an area dragged out), images and notes, and the relationship tools,
including "Place a Relationship Using Existing Columns", which picks
columns. Workbench's behaviour was copied from its source
(`res/wbdata/tools_toolbar*.xml`, `wb_component_physical_relationship.cpp`,
`relationship_canvas_floater.cpp`, `db_object_helpers.cpp`), with one
change the user asked for: placing a table opens its name's inline editor,
and Enter moves on to a chain of column editors.

## Where it lives

| File | Role |
| --- | --- |
| `webview/src/modeler/diagramTools.ts` | `DIAGRAM_TOOLS` (palette order, groups, keys, Workbench's hints) and `DiagramTools`, the tools' state machine, on the figure set seen through `IToolTarget` (tested with a fake target) |
| `webview/src/modeler/schemaEdits.ts` | Pure: the edits each tool sends and their inverses (`newTableChange`, `relationshipChange`, `associativeTableChange`, `existingColumnsChange`, `newViewChange`, `newRoutineChange`), Workbench's names, and `applyEdits`, the snapshot as the edits leave it until msm's arrives |
| `webview/src/modeler/DiagramToolbar.tsx` | The palette, and `ToolPanel` (the existing-columns floater) |
| `src/sql/columnTypes.ts` | `COLUMN_TYPES`, every MariaDB type in the order the column editor lists them, Workbench's default lengths, and `ENUM(` / `SET(` / `VECTOR(` left open |
| `EerFigureSet.ts` | Implements `IToolTarget`: adding and removing figures, layers and connections, highlight marks, the layer band, editors over card items |
| `Canvas.ts` | Tools other than pointer, hand and zoom go to the set (`toolDown` / `toolHover` / `toolCancel`); `host.toolDone()`, `host.hint()` |

## How the tools behave

- **Every tool goes back to the pointer** once it has placed something,
  as in Workbench. The exception is a layer area too small to count
  (under 5 units: "Please select a larger area."), which keeps the tool.
  Keys, no modifier, never while typing: Esc pointer, H hand, D eraser,
  L layer, N text, I image, T table, V view, G routine group, 1 to 5 the
  relationships, 6 existing columns. Zoom has no key; Z held still zooms.
  The hints go to the start of the status line.
- **Diagram-only tools** (eraser, layer, note, image, routine group) are
  history actions saved like any change. The eraser removes a figure (and
  its connections) or a layer from the diagram, never the object from
  the SQL. A new layer, "New Layer", Workbench's `#F0F1FE`, takes the
  figures lying fully on it (`#refile`). An image is picked from a file
  dialog (PNG, JPEG, GIF, WebP, SVG; at most 512 KB, msm's Workbench
  import cap) and placed at its size, at most 400 units on its longer
  side. The same picture can be placed on several diagrams: each figure
  carries its own copy of the data URL, its own size and place, and the
  viewer keeps pictures per diagram and figure. msm has no shared
  picture store. A routine group starts empty; its menu's "Add Routine"
  adds a procedure through `add_routine`.
- **A new table**: a click places `table1` (numbered past every table and
  view name) with an empty row; its name is edited in place (Esc or an
  empty name drops it), then each column in a `name TYPE` editor. The
  first column is prefilled `id`; Space or Enter after a name opens the
  type list with UUID picked, typing filters it from the start, Enter
  takes the one picked, and an open type (`ENUM(`) keeps the editor for
  its values. Enter after a type opens the next column's editor; Enter on
  an empty name, Esc, or leaving the input ends the table. The first
  column is the primary key and NOT NULL. Nothing is sent until the table
  ends: one `add_table` with every column (lsp-server refuses a table
  without one).
- **A new view** is named in place, then made with `add_view` and the
  placeholder `SELECT 1`: the SELECT is the user's to write in the SQL.
- **Relationships** (Workbench's): pick the table that receives the
  foreign key, then the referenced table (the same one references itself).
  The referenced table needs a primary key. Each of its key columns gets
  a column `<referenced>_<column>` in the child (its type, `SERIAL` as
  `BIGINT UNSIGNED`, NOT NULL). The foreign key is
  `fk_<child>_<referenced>`, free in the schema. Identifying ones add the
  new columns to the child's primary key (`set_primary_key`); 1:1 ones get
  a unique index `<fk>_UNIQUE` unless the new columns are the whole key.
  n:m makes `<a>_has_<b>`, its key the copied columns, with a foreign key
  to each, placed halfway between the two tables' corners. The
  connection is drawn from the child's figure (`startFigure`, crow's foot
  end).
- **Existing columns**: click column rows of one table (the floater lists
  them), then "Pick Referenced Columns" and the referenced columns in the
  same order; the foreign key is made once the counts match. One column
  followed by a column of another table makes it at once. A table clicked
  outside its rows, before any column, works as 1:n with new columns.
  Types are not compared (Workbench does not either, and lsp-server
  leaves it to the deploy).

## How a schema change travels

The tool shows it at once (`catalog.edit` runs `applyEdits`, the figures
are added), then `IToolTarget.schemaEdit` posts `schemaEdit` with
`documents`, the shown diagram as it is now. Those documents are marked
as sent, so `onHistory` does not post them again as `diagramChanged`.
`ProjectModelSource.edit` saves what waits, makes the edit, and only then
saves the documents (unless newer changes of that diagram wait). If the
edit fails, it drops their pending changes and drafts: a figure of a table
that was never made is not saved, nor taken up again from a draft. The
panel then reads the project again. Undo sends the inverse with the
documents again: drop the foreign key first, then restore the primary
key, then drop the columns (the server refuses to change a key a foreign
key relies on, error 1553).

## The edit ops it needs (`mariadb-lsp edit`)

Agreed with the lsp-server session on 2026-11-06. PR 2 brings
`add_table`, `drop_table`, `add_column`, `modify_column`, `drop_column`,
`set_table_options`, `add_view`, `drop_view`, `add_routine` and
`drop_routine`; PR 3 brings `add_index`, `drop_index`, `add_foreign_key`,
`drop_foreign_key` and `set_primary_key`. Until then they answer
`unsupported`, which the viewer reports before reading the project again.
Shapes are the outline's structs: `add_table {table}`, `add_column
{table, column, after?, first?}`, `add_foreign_key {table, foreign_key}`,
`add_index {table, index}`, `set_primary_key {table, columns}`, `add_view
{view: {name, definition}}` (the SELECT alone), `add_routine {routine}`,
`drop_table {table}`, `drop_column {table, column}`, `drop_foreign_key
{table, name}`, `drop_index {table, name}` or `{table, kind: "primary"}`,
`drop_view {view}`, `drop_routine {routine, kind?}`. A binary lists the
ops it has on an `edit ops:` line of `--help`. The viewer does not read
it yet: msm does not pass it on, so every tool is offered in a project.

## Rendering it without VS Code

The headless recipe in `modeler.md` works for the tools too, when Chrome
is driven over the DevTools protocol (`--remote-debugging-port`; Node's
own `WebSocket` sends `Input.dispatchMouseEvent` / `dispatchKeyEvent` /
`insertText`, `Page.captureScreenshot`). Real input events matter:
pointer capture refuses synthetic ones. Checked that way: the palette,
placing a table with its name, columns and the type list, a 1:n
relationship with its hover outline, the existing-columns floater and
row marks, a layer dragged around two tables.
