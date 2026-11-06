# Schema objects in the trees, on diagrams, and in Object Details

Back to [`../PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md). The diagram
viewer is [`modeler.md`](modeler.md), its palette
[`modeler-tools.md`](modeler-tools.md), the MSM Projects view
[`msm.md`](msm.md).

## What the user asked for

- A project's schema in MSM Projects where the Diagrams row was, with the
  Connections view's schema icon and its rows (Diagrams, Tables, Views,
  ...), the data from the development script (`_next.sql`) instead of a
  live connection, "most of the existing code for the Connection Treeview
  reused".
- Tables, views and routines dragged from it onto the diagram canvas. The
  user first asked for VS Code's Outline view for a Diagram Viewer editor:
  VS Code has no API for that (the Outline follows text editors only,
  through `DocumentSymbolProvider`; custom editors and webviews get none),
  which is why the schema went into the tree.
- An Object Details webview view below MSM Projects showing the object
  selected on a diagram in full, editable; the same view below Connections
  for live objects, read only for now, on the same code.
- Then a compressed, read-only view for the side bars, the editing going
  to a dedicated object editor, still to come. A tab of the MariaDB
  panel (wider, one implementation) was tried for it and dropped.

## Where it lives

| File | Role |
| --- | --- |
| `src/tree/schemaTree.ts` | A schema's rows for both trees: row shapes (`ISchemaRow`, `IObjectGroupRow`, `IObjectRow`, ...) a tree's nodes extend with where they are (`uri` or `projectPath`), `objectGroupsOf` / `objectsOf`, the icons and labels, the item classes with a context-value prefix (`mariadb` / `mariadbMsm`: `mariadbObject.table`, `mariadbMsmObject.table`, so the live-only menus stay off MSM rows), `outlineObjects` (the snapshot's objects as `db.list_objects` lists them), `objectUriList` for drags, `ADD_TO_DIAGRAM_COMMAND` |
| `src/tree/msmProjectsTreeProvider.ts` | A project's schema row, its Diagrams and object folders; the listing and snapshot read once per project until `refresh()`, `snapshot()` for the details view |
| `src/modeler/modelerProtocol.ts` | `ISchemaObjectRef`, the `mariadb-schema-object:` URIs a drag carries (`schemaObjectUri`, `parseSchemaObjectUris`, `isPlaceOf`), and the messages `placeObjects`, `applySchemaChange`, `selection` |
| `webview/src/modeler/placeObjects.ts` | Pure: the figures and connections placing objects adds (`placementOf`), the objects of selected figures (`objectsOfFigures`) |
| `src/details/detailEdits.ts` | Pure: a table change of the view (`TableDetailChange`) as edits and their inverse (`tableDetailEdits`) |
| `src/details/objectDetails.ts` | Pure: what the view shows (`IObjectDetailsView`), its messages, a project's object from the snapshot, a live one from `db.get_object_details` |
| `src/details/objectDetailsProvider.ts` | One provider for both views (`mariadb.msmObjectDetails`, `mariadb.objectDetails`): the selection and the reads |
| `webview/src/details/ObjectDetails.tsx`, `details.tsx`, `detailsStyles.css`, `vite.details.config.ts` | The page, its own build (`dist/webview/details.{js,css}`): read only, a row a line |

## How it behaves

- **The schema row** reads msm's snapshot (`msm.get_schema_diagrams`, the
  `msm-schema/1` row), which is what the diagrams draw and edit against.
  It has all seven kinds of the Connections view (msm keeps the outline's
  `triggers`, `events`, `sequences`); a routine without a kind is a
  procedure. Shown by name. Where `msm.list_schema_diagrams` says the snapshot is not
  current, or there is none, the row says so; **Update Schema Snapshot**
  (`msm.update_schema_definition`) makes it again and reloads the project's
  open viewer (`ModelerPanel.reload`). Not done on expand: making the
  snapshot writes the script's Section 160.
- **Saving the script** in an editor (`onDidSaveTextDocument`, any `.sql`
  under `<project>.msm.project/development/`, `projectOfScriptFile`) makes
  the snapshot again where msm says it is stale, then refreshes the tree,
  Object Details and the open viewer. `SettledSaves` waits 300 ms so Save
  All makes one. `ProjectModelSource.updateSnapshot` runs after the
  diagrams' waiting saves and in the project's queue, so a viewer edit
  never runs against the old snapshot (the command uses it too). No cycle:
  msm writes the script on disk for every viewer edit and for the
  snapshot itself, which fires no save (a `FileSystemWatcher` would see
  them), and a current snapshot is never made again (msm's hash leaves
  Section 160 out). A project without a snapshot waits for the command. A
  failure is logged, not notified; the row then says the snapshot is
  older. Not handled: an editor of the script left dirty while msm
  rewrites it gets VS Code's "file is newer" on its next save.
- **The tree refreshes** after every schema edit a viewer makes
  (`IModelerHost.schemaChanged`).
- **Placing**: a table or view is shown once per diagram (Workbench); a
  table comes with a connection for each foreign key between it and a
  table shown (its own to itself too), in either direction, that has none.
  Routines placed together go on one new routine group, events on one new
  event group; a sequence gets a figure; a trigger is shown on its table's
  card, so placing one places its table where that is not shown. Figures go in rows
  of four, 240 apart. One undoable action; what was left out is said on
  the status line. Objects of another schema are refused.
- **Dragging** cannot drop into a diagram: Electron refuses a drop from
  the workbench into a cross-site frame, which every webview is
  (electron#53669, in VS Code since about 1.141; a Shift drag of a file
  from the Explorer fails the same way). So both trees keep the drag's
  objects (`draggedObjects`: 15 s, taken once, cleared by a drop on a
  tree) and the page, which gets no pointer events during a drag, posts
  `pointerArrived` on its first move after a 400 ms pause; the panel
  answers with `treeDropped` only right after such a drag, and the
  objects are placed where the pointer came back (one undoable action).
  A drag cancelled with Esc over the diagram places too. A real drop, if
  a VS Code ever lets one through, still works (`treeDrop`). The trees
  list no `text/uri-list` drag type: with it VS Code marks the drag as
  one of resources and lays the editor area's drop overlay over the
  webview. **Add to Diagram** (object rows of both trees) sends
  `placeObjects` to the schema's open viewer, in the middle of the view; for
  a project it opens one of its diagrams first if none is open, the
  objects waiting for the model (`ModelerPanel.place`). A live schema's
  needs its diagram open.
- **Object Details** follows the last selection: a tree row (both trees),
  or figures selected on a diagram (the viewer posts `selection`; a routine
  group's routines). It is read only and compressed for a side bar, a row
  a line as the trees above it: a table's comment, columns (the diagram
  card's key / NOT NULL / column icons, drawn as masks in the theme's
  colour; name; then, as on the card, the type with AI and the default in
  dimmed italics, cut short with the whole row as a tooltip), indexes and foreign keys; a view's columns;
  a routine's parameters and what it returns; a trigger's, an event's and
  a sequence's settings; SQL (a view's SELECT, a body) folded away in a
  `<details>`. Changing an object is the object editor's: the view sends
  only `ready`. `detailEdits.ts` (a table change as edits and their
  inverse) stays for it, and the diagram uses it
  (`ModelerPanel.applySchemaChange`). After a schema edit, refused or
  made, the view reads the object again (`refreshed`).
- **Live objects** come from `db.get_object_details`: columns with their
  flags, the primary key from `is_primary`, the comment. It has no
  indexes or foreign keys; the view says so.
- Edits sent back carry the outline's members only: lsp-server refuses an
  unknown member, so a foreign key loses msm's derived `many` /
  `mandatory`, and a column is sent whole (a member left out of
  `modify_column` takes the outline's default).

- A trigger's `events` is one string (`"INSERT"`, `"UPDATE OR DELETE"`),
  shown as written on the card's row and in the details.

## Not yet tried in VS Code

The compressed Object Details view at the side bars' widths.
