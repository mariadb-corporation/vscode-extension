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
  to a dedicated object editor: for tables, the table editor
  ([`table-editor.md`](table-editor.md)); the other kinds still to come. A tab of the MariaDB
  panel (wider, one implementation) was tried for it and dropped.

## Where it lives

| File | Role |
| --- | --- |
| `src/tree/schemaTree.ts` | A schema's rows for both trees: row shapes (`ISchemaRow`, `IObjectGroupRow`, `IObjectRow`, ...) a tree's nodes extend with where they are (`uri` or `projectPath`), `objectGroupsOf` / `objectsOf`, the icons and labels, the item classes with a context-value prefix (`mariadb` / `mariadbMsm`: `mariadbObject.table`, `mariadbMsmObject.table`, so the live-only menus stay off MSM rows), `outlineObjects` (the snapshot's objects as `db.list_objects` lists them), `objectUriList` for drags, `ADD_TO_DIAGRAM_COMMAND` |
| `src/tree/msmProjectsTreeProvider.ts` | A project's schema row, its Diagrams and object folders; the listing, snapshot and each diagram's document read once per project until `refresh()` (a diagram's also handed over by `diagramSaved`), `snapshot()` for the details view |
| `src/tree/diagramRows.ts` | Pure: a diagram's rows below it (`diagramRowsOf`: layers with their figures, then figures on none; `figureKindOf`), the object a row shows for Object Details (`diagramRowObject`) |
| `src/modeler/modelerProtocol.ts` | `ISchemaObjectRef`, the `mariadb-schema-object:` URIs a drag carries (`schemaObjectUri`, `parseSchemaObjectUris`, `isPlaceOf`), and the messages `placeObjects`, `applySchemaChange`, `selection` |
| `webview/src/modeler/placeObjects.ts` | Pure: the figures and connections placing objects adds (`placementOf`), the objects of selected figures (`objectsOfFigures`) |
| `src/details/detailEdits.ts` | Pure: a table change of the view (`TableDetailChange`) as edits and their inverse (`tableDetailEdits`) |
| `src/details/objectDetails.ts` | Pure: what the view shows (`IObjectDetailsView`), its messages, a project's object from the snapshot, a live one from `db.get_object_details` |
| `src/details/objectDetailsProvider.ts` | One provider for both views (`mariadb.msmObjectDetails`, `mariadb.objectDetails`): the selection and the reads |
| `webview/src/details/ObjectDetails.tsx`, `details.tsx`, `detailsStyles.css`, `vite.details.config.ts` | The page, its own build (`dist/webview/details.{js,css}`): the object read only, a row a line |
| `webview/src/details/DiagramItemFields.tsx` | The diagram item selected: a figure's or a layer's place and size, a figure's Upright, a figure's or a layer's color, a layer's tables, a line's tables, kind, offset and split |

## How it behaves

- **A diagram row of MSM Projects expands** into the diagram's structure
  (`diagramRows.ts`): its layers by name (`layers` codicon, "N figures"),
  each with the figures filed under it (a figure's `layer`, else the
  layer's `figures` list), then the figures on no layer; figures sorted
  by kind (table, view, sequence, routine group, event group, REST
  object), then by label. A routine or event group lists its routines
  (procedure or function, as the snapshot has them) or events. A REST
  object figure is labelled by its REST schema's and its own path, its
  service as the description. Notes and images show no object and are
  left out. Context values `mariadbMsmDiagramLayer`,
  `mariadbMsmDiagramFigure.<kind>`, `mariadbMsmDiagramMember.<type>` (no
  menus yet). The document is read with `msm.get_schema_diagrams(path,
  name)` once until the project is refreshed; a viewer's save hands the
  saved document over (`IProjectSourceHost.diagramSaved` ->
  `MsmProjectsTreeProvider.diagramSaved`, which also updates the cached
  listing's figure count), so the rows and the diagram's figure count
  follow moves onto layers and placed objects without a read. Reading a
  diagram's document also keeps the snapshot msm sends with it, so
  expanding a diagram is one `msm.get_schema_diagrams` call. Selecting a layer or figure row shows it in Object Details as a
  click on the diagram does (`showDiagramRow` in extension.ts): where its
  diagram is open in a viewer, by selecting it there
  (`ModelerPanel.select`, `selectItem`, `Canvas.selectItems`; the view
  stays put), whose selection comes back editable; else read only, from
  the diagram as saved (`diagramRowItem`, which mirrors
  `EerFigureSet.itemProps`: the figure's place with its layer's, sizes as
  stored, a REST figure's paths but not what it serves), with the
  object a table's, view's or sequence's figure shows. A group's routine
  or event shows its object alone.
- **Going to what a row stands for** (`src/msm/projectNavigation.ts`,
  `MSM_NAVIGATION_COMMANDS`; MSM Projects only, a live schema has no
  source): a `$(go-to-file)` button (and the menu's Open Definition) on
  the schema, object and REST service / schema / object rows opens the
  statement in its file, the name selected; a `$(eye)` button (Show in
  Diagram) on a diagram's layer, figure and group member rows opens the
  diagram, centred on the item (a member's group figure) and selected.
  A double-click on those rows does the same, and on a diagram row opens
  the diagram (`ProjectNavigation`, through one `DoubleClick` keyed by the
  row's `rowIdOf`), so no row opens on a single click. A single click
  selects, which Object Details follows. VS Code expands a row with a
  `command` only on its twistie (`expandOnlyOnTwistieClick` in its
  `treeView.ts`), so only rows that cannot be expanded get
  `mariadb.msm.rowClicked` (`rowClick`). A click on one that can (a
  schema, a REST service or schema, a diagram, a layer or a group
  figure with something under it) expands or collapses it. Its
  double-click is two toggles, which `onDidExpandElement` /
  `onDidCollapseElement` hand to `ProjectNavigation.toggled`; the row is
  left as it was.
  Schema and objects are found in a fresh `mariadb-lsp outline` of the
  development script (`definitions.ts`, `definitionOf`: `range` /
  `selection_range`, `source` into `includes` for an included file; the
  schema by name, else every schema, as a script may name it through a
  placeholder; a schema the script does not declare opens the script),
  not in the snapshot, which may be older. REST rows keep the file and
  line their row has (`restScript.ts`). Show in Diagram:
  `ModelerPanel.reveal` (kept until the page has the model) posts
  `revealItem`; the viewer keeps it until `Canvas.load` has put the view
  in place (`readyRef`), then `Canvas.reveal(id)` centres the view on the
  item at its zoom (across only in 2D Front) and selects it.

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
- **The tree refreshes** after every schema edit a viewer makes, and
  after one msm refused as the project changed meanwhile
  (`IModelerHost.schemaChanged`, with the viewer's target): only that
  project's listing and snapshot are read again (`refreshProject`), the
  list of projects is kept. The snapshot is read with one diagram's row,
  not all of them.
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
  webview. A project's REST object rows are dragged and added the same
  way, as REST object figures (see [mrs-msm.md](mrs-msm.md)).
  **Add to Diagram** (object rows of both trees) sends
  `placeObjects` to the schema's open viewer, in the middle of the view; for
  a project it opens one of its diagrams first if none is open, the
  objects waiting for the model (`ModelerPanel.place`). A live schema's
  needs its diagram open.
- **First-start layout of the MSM side bar**: `initialSize` MSM Projects
  60, Object Details 40, so Object Details opens on 2/5 of the height
  (the weights work as in [connections.md](connections.md)'s first-start
  layout; a height the user dragged is kept by VS Code over them).
- **Object Details** follows the last selection of its own side bar,
  kept apart: below MSM Projects a project's object (its tree, or a
  project's diagram), below Connections a live one (its tree, or a live
  schema's diagram); `ObjectDetailsProvider` keeps one state per side,
  and a view is empty until something is selected on its side. Figures
  selected on a diagram post `selection` (a routine group's routines).
  The object is read only and compressed for a side bar, a row
  a line as the trees above it. Its header: the type's icon as the trees
  draw it (`TypeIcon`, the light and dark SVG of `images/` inlined, the
  body's `vscode-dark` / high-contrast class picking one), the name, then
  the type ("Table") muted, on one line cut short with "…" (never
  wrapped, the whole as its tooltip); a rule below it from where the name
  starts - 20px in, where the column names start and about where the
  inputs do (`--details-indent`) - to the right edge; under it, right-aligned
  within the rule's span, the schema (where it is, project or connection, as its
  tooltip), or a REST object's full path (what it serves as its tooltip).
  A layer's or line's header is the name, then "Layer" / "Relationship",
  and the rule, nothing under it. One component draws them all
  (`DetailsHeader` in `DiagramItemFields.tsx`). Then a table's comment, columns (the diagram
  card's key / NOT NULL / column icons, drawn as masks in the theme's
  colour; name; then, as on the card, the type with AI and the default in
  dimmed italics, cut short with the whole row as a tooltip), indexes and foreign keys; a view's columns;
  a routine's parameters and what it returns; a trigger's, an event's and
  a sequence's settings; SQL (a view's SELECT, a body) folded away in a
  `<details>`. Changing an object is the object editor's;
  `detailEdits.ts` (a table change as edits and their inverse) stays for
  it, and the diagram uses it (`ModelerPanel.applySchemaChange`). After a
  schema edit, made or refused as the project changed, the view reads the
  object again (`refreshed`). Nothing is read while a side's view does
  not show: the object selected meanwhile is read once it does.
- **The diagram item selected** (exactly one, `DiagramItem`), last, after
  the object's details, editable (read only on a live schema's diagram,
  as the diagram is), `DiagramItemFields.tsx`:
  - a card figure: X / Y (on the page, its layer's position included),
    Z (its own `elevation` above its layer), W / H and Auto-Height
    (height from content, `manualSizing` off), laid out as a design
    tool's transform panel (X / W, Y / H, Z / Auto-Height under H's
    input), and Upright under it, pulled up (`itemCheckFollows`) as its
    row has no input (stands
    on the page or lies on it; H is then how high it stands, see
    [modeler-figures.md](modeler-figures.md));
  - a layer (no schema object): its tables (filed under it) and
    X / Y / Z / W / H, changed as a drag would, so its tables follow;
  - below either, its Color: the editors' `ColorSwatches` over
    `FIGURE_PALETTE`, stored in the diagram (None a figure's kind's
    color, a new layer's for a layer), its caption styled as the
    sections' `h3` titles; a hint only for a colour no swatch shows; a REST object figure has no schema
    object: its item carries `rest` (the figure's service, schema and
    object paths, and what Section 180 serves, from `EerFigureSet.itemProps`),
    which heads its fields as an object is headed (`RestHeader`: the trees'
    REST object icon, the request path, "REST View" / "REST Procedure" /
    "REST Function", else "REST Object"; the service and schema paths and
    the database object below);
  - a relationship line (no schema object): headed by the toolbar's
    relationship tool icon of its kind (1:1 / 1:n, identifying or not;
    `RelationshipIcon`, a mask in the theme's colour; 1:n where the key is
    not in the snapshot), then its source and target tables, kind, middle
    segment offset and Split.
  A field commits on Enter or blur; Escape puts it back. The viewer posts
  the item with `selection` and again as `item` after every history change
  (moves, undo); the provider keeps it per side with the panel's editor
  (`ISelectedItem`) and sends the view's `changeItem` to that diagram,
  where `EerFigureSet.changeItem` makes it one undoable action. A tree row
  selected drops it; a diagram selection with no object (cleared by a
  click on the canvas, or several items) empties the view, the object
  with the item (`ObjectDetailsProvider.showSelection` -> `clear`): the
  viewer posts an empty `selection` for it (`onSelection` in
  `ModelViewer.tsx`), not an item-only `item`, which would drop the item
  and keep the object.
- **A relationship's kind** (1:1 / 1:n, identifying or not:
  `relationshipKindOf`, as msm derives `many`) is changed as a schema
  change (`relationshipKindChange`, sent through
  `DiagramTools.changeSchema`, undone and taken back as the tools'
  changes): identifying adds the key's columns to the child's primary key
  after its own columns, 1:1 adds a `<fk>_UNIQUE` index, 1:n drops the
  unique indexes over exactly the key's columns. A unique index the key
  relies on cannot be dropped while the key is there (MariaDB 1553;
  `mariadb-lsp edit` refuses `referenced`), so 1:n and the undo of 1:1
  drop the key, the index, and add the key again; with `merge_alters`
  the two drops merge into one ALTER and the key comes back in its own.
  Refused: the key's columns are the child's whole primary key; or an
  unnamed column UNIQUE makes it 1:1, which the binary would drop by its
  columns with no migration, so deployed schemas would keep it.
- **Live objects** come from `db.get_object_details`, mapped into the
  outline's shapes (`liveDetails`): a table's columns, its primary and
  unique keys (`constraints`), the foreign keys it holds (`references`
  of kind `n:1`; those onto it are left out); a routine's parameters and
  `returns`; a trigger's, event's and sequence's INFORMATION_SCHEMA row
  (`details`), an event's schedule written as `CREATE EVENT` does. The
  server has no plain indexes, foreign key actions, routine bodies or a
  sequence's min / max / cache / cycle; the view shows what there is,
  without a note.
- Edits sent back carry the outline's members only: lsp-server refuses an
  unknown member, so a foreign key loses msm's derived `many` /
  `mandatory`, and a column is sent whole (a member left out of
  `modify_column` takes the outline's default).

- A trigger's `events` is one string (`"INSERT"`, `"UPDATE OR DELETE"`),
  shown as written on the card's row and in the details.

## Open questions and leftovers

- `detailEdits.ts` → `ModelerPanel.applySchemaChange` → `ModelViewer` →
  `EerFigureSet.applySchemaChange` has no caller outside tests while the
  view is read only. Kept for the object editor; to decide: drop it until
  then, or keep it. Before using it: `dropColumn`'s inverse re-adds the
  column only, not the primary key, indexes or foreign keys MariaDB
  dropped with it; its `primaryKeyColumns` (exact case, array) differs
  from the catalog's (`webview/src/modeler/catalog.ts`, lower case, Set),
  and its column / index / foreign key builders copy `schemaEdits.ts`'s.
- No tree sets `text/uri-list` on a drag, so `onDrop`'s `getData` branch
  in `ModelViewer.tsx` and the `mariadb-schema-object:` URIs only carry
  `draggedObjects` inside the extension; kept for a real drop should
  Electron ever let one through.
- Duplication worth folding: `#placeSequence` / `#placeView` and
  `#addTrigger` / `#addMember` in `diagramTools.ts`; the object type →
  outline list lookup in `schemaTree.ts` (`outlineObjects`),
  `objectDetails.ts` (`outlineDetails`) and `placeObjects.ts`
  (`placementOf`); both trees' `handleDrag` filling `draggedObjects`.

## Not yet tried in VS Code

The compressed Object Details view at the side bars' widths, the
diagram item's fields among them.
