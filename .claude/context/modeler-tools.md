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
  L layer, N text, I image, T table, V view, G routine group, R trigger,
  E event group, Q sequence, 1 to 5 the relationships, 6 existing
  columns. Zoom has no key; Z held still zooms.
  The hints go to the start of the status line.
- **The relationship icons** (`images/light/toolbar-diagram-rel*.svg`,
  used as CSS masks) use Workbench's notation, drawn anew at 16 px: the
  relationship's line across the top, dashed where it does not identify,
  a crow's foot at a many end, and the cardinality written below,
  right-aligned (`1:1`, `1:n`, `n:m`); Existing Columns (`relpick`) adds a
  pipette. The characters are strokes, not SVG text, as a mask image
  cannot count on a font. Two tables joined by an elbow line, with crow's
  feet, read worse at 16 px.
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
  first column is prefilled `id UUID` (the user: "suggesting id with
  PRIMARY KEY is great, just make it UUID type"); the next ones default
  to VARCHAR(45), which the type list picks first. Space or Enter after a
  name opens the type list, typing filters it from the start, Enter takes
  the one picked, and an open type (`ENUM(`) keeps the editor for its
  values. Enter after a type opens the next column's editor; Enter on an
  empty name, Esc, or leaving the input ends the table. The first column
  is the primary key and NOT NULL. Nothing is sent until the table ends:
  one `add_table` with every column (lsp-server refuses a table without
  one).
- **A change msm refuses is taken back where it stands** (the user
  agreed: not by reading the project again, which cleared the history and
  fitted the view). msm edits whole or not at all, so a refused edit left
  the SQL as it was. Every first send of a tool's change and of a rename
  carries `recover`. The viewer drops the action from the history
  (`UndoStack.discard`), takes back what it showed (`#takeBack`: the
  figures and connections go, the catalog takes the inverse locally, with
  nothing sent) and puts msm's message on the status line. Where something
  was typed, it is opened again as typed:
  - a new table at the column msm names ("column `price`: ... is not a
    MariaDB data type", inside msm's own wording), else at its name, all
    columns kept;
  - a view's or a routine's name, placed again;
  - a table's or column's new name, over the old one again.

  The relationship tools only take back: the fix is another pick, not
  another text. The panel still reads the project again where msm says
  the snapshot is stale (`isStaleSnapshot`, msm's `StaleSchemaError`
  wording), and for a refused undo or redo, which carries no `recover`.
  The viewer matches each `schemaEdited` to its request by order, since
  the panel answers them one at a time.
- **Triggers, events and sequences** (not Workbench's; the user's
  choices): a trigger is a "Triggers" section of its table's card (shown
  unless `triggersExpanded` is false; the table menu's Show Triggers).
  The Trigger tool is clicked on a table: `<table>_BEFORE_INSERT`, named
  in place in that section, then `add_trigger` (BEFORE INSERT, body
  `BEGIN\nEND`). Events are listed on an `EventGroupFigure` (`events`,
  #F5C39A) like routines on a routine group, placed empty and filled from
  its menu's Add Event (`add_event`, EVERY 1 DAY). A sequence is a
  `SequenceFigure` (`sequence`, #C9B8E8) placed and named like a view
  (`add_sequence`), its name free of tables' and views'. Its card shows
  msm's three rows (`diagrams.sequence_rows`): the type (BIGINT where none
  is written), `START WITH n`, `INCREMENT BY n` (1 where not written), so
  msm's layout and pictures size it as the viewer draws it. The ops are
  lsp-server's, the figure kinds and the Triggers section's count msm's
  (both agreed with those repos' sessions; see the ops below). Where a
  binary or a shell lacks them, msm refuses and the viewer takes the
  change back.
  The sequence icon `schemaSequence.svg` is the extension's own (the
  upstream set has none).
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
edit fails, it drops their pending changes, drafts and save timers: a
figure of a table that was never made is not saved, nor taken up again
from a draft. Where msm made the edit but saving the documents then
fails, that is a failed save (the save state says so); the edit counts as
made, so the viewer keeps it and the next edit is made against its
snapshot. The viewer matches each `schemaEdited` to its request by order,
and keeps a slot for every request still waiting across a reload. Undo
sends the inverse with the
documents again: drop the foreign key first, then restore the primary
key, then drop the columns (the server refuses to change a key a foreign
key relies on, error 1553).

`DiagramTools.changeSchema` sends a change that places nothing (a
relationship's new kind, from Object Details) the same way: shown at once,
recorded, taken back where msm refuses it.

## The edit ops it needs (`mariadb-lsp edit`)

The ops come from lsp-server #26 (`add_table`, `drop_table`,
`add_column`, `modify_column`, `drop_column`, `set_table_options`,
`add_view`, `drop_view`, `add_routine`, `drop_routine`) and #27
(`add_index`, `drop_index`, `add_foreign_key`, `drop_foreign_key`,
`set_primary_key`); since #28 a procedure and a function may share a
name, with the format unchanged. A binary without them answers
`unsupported`, which the viewer takes back like any refusal. Every tool's
change goes through msm whole and its inverse brings the snapshot back
exactly (checked for a table, a view, a routine, the four 1:1 / 1:n
kinds, n:m, existing columns and a table referencing itself). An
identifying relationship on an AUTO_INCREMENT key is accepted: the key
column stays first in the primary key.
Shapes are the outline's structs: `add_table {table}`, `add_column
{table, column, after?, first?}`, `add_foreign_key {table, foreign_key}`,
`add_index {table, index}`, `set_primary_key {table, columns}`, `add_view
{view: {name, definition}}` (the SELECT alone), `add_routine {routine}`,
`drop_table {table}`, `drop_column {table, column}`, `drop_foreign_key
{table, name}`, `drop_index {table, name}` or `{table, kind: "primary"}`,
`drop_view {view}`, `drop_routine {routine, kind?}`. For triggers, events
and sequences: `add_trigger {trigger}` (`name`, `timing`, `events`,
`table`, `body`; `events` is one string as the outline writes it,
`"INSERT"` or `"UPDATE OR DELETE"`, an array is refused), `drop_trigger
{trigger, table?}`, `rename_trigger {trigger, new_name}`; `add_event
{event}` (`name`, `schedule`, `body`), `drop_event {event}`,
`rename_event`; `add_sequence {sequence}` (`name`), `drop_sequence
{sequence}`, `rename_sequence`; a rename takes `{<kind>: old, new_name}`
and each op refuses any other member (`bad-request`). `add_sequence`
places the CREATE after the last sequence, else before the first table
(Section 140), so a column's `DEFAULT NEXT VALUE FOR` can use it; tables,
views and sequences share one namespace (`name-taken`). A trigger goes in
Section 150 after the last trigger (never after the first event), else
the last routine or view; an event after the last event, trigger, routine
or view. `drop_trigger` is refused (`referenced`) while another trigger
FOLLOWS or PRECEDES it, `drop_sequence` while a column default uses it;
`drop_trigger`'s `table` is only checked. A trigger's or event's CREATE
cannot run inside the update procedure (MariaDB 1303 / 1576): the binary
notes `trigger-created`, `trigger-recreated` (a rename is a drop and a
create) and `event-created`, and msm leaves those CREATEs to Section 150.
A table's triggers go with `drop_table`; undoing that needs
`add_trigger` for each. A binary lists the
ops it has on an `edit ops:` line of `--help`. The viewer does not read
it yet: msm does not pass it on, so every tool is offered in a project.

## Running the tools' edits through msm without VS Code

msm's code imports `mysqlsh`, so it runs only inside the shell:
`mariadb-shell --py --file script.py`, the script putting a
mariadb-shell-plugins checkout first on `sys.path` and passing `lsp_path`
to the binary to test. Bundle a small TS script importing
`webview/src/modeler/schemaEdits.ts` with `node_modules/.bin/esbuild
--bundle --platform=node --format=esm` to make the changes exactly as the
viewer does from the project's snapshot (`read_diagram_rows(path)[0]`),
then run `editing.edit_schema` with the edits, the inverse and the edits
again, comparing the snapshot after the inverse with the one before.
msm's own tests (`msm_plugin/tests/unit/test_editing.py`, `real_project`)
show how to make a project.

## Rendering it without VS Code

The headless recipe in `modeler.md` works for the tools too, when Chrome
is driven over the DevTools protocol (`--remote-debugging-port`; Node's
own `WebSocket` sends `Input.dispatchMouseEvent` / `dispatchKeyEvent` /
`insertText`, `Page.captureScreenshot`). Real input events matter:
pointer capture refuses synthetic ones. Checked that way: the palette,
placing a table with its name, columns and the type list, a 1:n
relationship with its hover outline, the existing-columns floater and
row marks, a layer dragged around two tables.

## Known gaps

Found by the code reviews, each left open as it needs a decision:

- A redraw of the figures (a reload) while a new table's column editor is
  open runs the editor's `cancel`, which ends the table and can send
  `add_table` from figures being thrown away: `cancel` means both Esc and
  "the figures went away".
- Undoing a change before msm answers, then msm refusing it, takes it back
  twice: no rule yet for undo while an edit waits on msm.
- Leaving the new table's name editor (a click elsewhere) still opens the
  first column's editor, which takes the focus back.
- Removing a figure clears the whole selection.
- A refused edit drops its diagrams' changes made while it ran (a figure
  moved meanwhile), with the figures of objects msm did not make.
