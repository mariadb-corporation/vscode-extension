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

## Where it lives

| File | Role |
| --- | --- |
| `src/tree/schemaTree.ts` | A schema's rows for both trees: row shapes (`ISchemaRow`, `IObjectGroupRow`, `IObjectRow`, ...) a tree's nodes extend with where they are (`uri` or `projectPath`), `objectGroupsOf` / `objectsOf`, the icons and labels, the item classes with a context-value prefix (`mariadb` / `mariadbMsm`: `mariadbObject.table`, `mariadbMsmObject.table`, so the live-only menus stay off MSM rows), `outlineObjects` (the snapshot's objects as `db.list_objects` lists them), `objectUriList` for drags, `ADD_TO_DIAGRAM_COMMAND` |
| `src/tree/msmProjectsTreeProvider.ts` | A project's schema row, its Diagrams and object folders; the listing and snapshot read once per project until `refresh()`, `snapshot()` for the details view |
| `src/modeler/modelerProtocol.ts` | `ISchemaObjectRef`, the `mariadb-schema-object:` URIs a drag carries (`schemaObjectUri`, `parseSchemaObjectUris`, `isPlaceOf`), and the messages `placeObjects`, `applySchemaChange`, `selection` |
| `webview/src/modeler/placeObjects.ts` | Pure: the figures and connections placing objects adds (`placementOf`), the objects of selected figures (`objectsOfFigures`) |
| `src/details/detailEdits.ts` | Pure: a table change of the view (`TableDetailChange`) as edits and their inverse (`tableDetailEdits`) |
| `src/details/objectDetails.ts` | Pure: what the view shows (`IObjectDetailsView`), its messages, a project's object from the snapshot, a live one from `db.get_object_details` |
| `src/details/objectDetailsProvider.ts` | One provider for both views (`mariadb.msmObjectDetails`, `mariadb.objectDetails`): the selection, reads, changes |
| `webview/src/details/ObjectDetails.tsx`, `details.tsx`, `detailsStyles.css`, `vite.details.config.ts` | The page, its own build (`dist/webview/details.{js,css}`) |

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
- **Dragging** puts the rows' `mariadb-schema-object:` URIs in
  `text/uri-list` (both trees). VS Code hands a drop into a webview only
  with Shift held. **Add to Diagram** (object rows of both trees) sends
  `placeObjects` to the schema's open viewer, in the middle of the view; for
  a project it opens one of its diagrams first if none is open, the
  objects waiting for the model (`ModelerPanel.place`). A live schema's
  needs its diagram open.
- **Object Details** follows the last selection: a tree row (both trees),
  or figures selected on a diagram (the viewer posts `selection`; a routine
  group's routines). A project's table is editable: name, comment, columns
  (name, type with the column type list, NN, AI, default, comment, primary
  key, drop, add), indexes (add, drop), foreign keys (drop). A field sends
  its change when left or on Enter. Views, routines, triggers, events and
  sequences are shown only (no op changes a view's SELECT or a body).
- **A change** is turned into edits and their inverse from the snapshot.
  With the project's diagram open it goes to the viewer
  (`applySchemaChange`): shown, recorded in the history, sent with
  `recover`, taken back where msm refuses it (`schemaEditFailed` tells the
  view, which shows why and reads again). Otherwise it goes straight to
  `ProjectModelSource.edit`. A rename makes the view follow the new name,
  and go back where refused.
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

Whether a tree drag's `text/uri-list` reaches the webview's drop with
Shift held; the views' sizes in the two sidebars.
