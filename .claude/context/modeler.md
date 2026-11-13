# The schema model viewer

An EER diagram canvas on three.js that switches between a 2D and a 3D
view, showing the diagrams of an MSM project (saved, and its tables and
columns renamed in the SQL, through msm) or of a live schema (shown only).
It began from a saved design discussion of an EER modeler on three.js,
kept outside the repository.

## Where the diagrams come from

- **MSM Section 160, the `msm_schema_diagrams` VIEW** (`name`, `format`,
  `document`), which msm writes (mariadb-shell-plugins
  `msm_plugin/lib/diagrams.py` is the format; its PROJECT_CONTEXT "Schema
  diagrams (Section 160)" the rules): one row `schema_definition` in
  `msm-schema/1`, the snapshot of the objects the CREATE statements define
  in the language server's outline shape (snake_case: a table's `columns`
  with `nullable`, `indexes` with `kind`, `foreign_keys` with
  `references: {table, columns}`, `many`, `mandatory`,
  `referenced_mandatory`; `views` with their declared `columns`;
  `routines` with `parameters` and `returns`; `source_hash`), and one row
  per EER diagram in `msm-diagram/1` (layers, figures, connections,
  Workbench's camelCase keys). `assembleSchemaModel`
  (`src/modeler/modelFormat.ts`) puts them together into the viewer's
  `ISchemaModel` (`tables`, `views`, `routines`, `sourceHash`); a diagram
  is named by its row, other formats are skipped, a figure without `left`
  / `top` (not placed by `msm.layout_schema_diagram` yet) sits at the
  corner. The `mwb-*` formats never shipped and are gone: no
  compatibility. The MRS metadata schema's project in the mariadb-shell
  repo (`mysqlshdk/libs/mrs/db_schema/mariadb_rest_service.msm.project`,
  section `development/sections/160_schema_diagrams.sql`, made from its
  Workbench model with msm's import, mariadb-shell #125) is the test
  project: two diagrams, MRS (30 tables, 36 connections, 8 layers) and
  MRS Status, tables only. Releases do not carry `development/`, so the
  deployed metadata schema has no such VIEW.
- **Where a viewer reads from and writes to** is its `IModelSource`
  (`src/modeler/modelSources.ts`): `ConnectionModelSource`, a live
  schema's VIEW on the Diagram session, read only (msm writes the VIEW);
  `ProjectModelSource`, an MSM project through the msm tools (below). A
  panel is one per source (`key`), titled "diagram (schema)".
- **The Connections view.** Expanding a schema looks for the view
  (`hasDiagramsSql`: one `information_schema.TABLES` lookup, on the UI
  Backend session; a failure just means no folder) and, where it is there,
  puts a **Diagrams** folder first, before the object groups
  (`IDiagramsNode`, `mariadbDiagrams`). Expanding it lists
  `SELECT name ... WHERE format LIKE '%diagram%'` (`IDiagramNode`,
  `mariadbDiagram`). A diagram opens by its inline button, its menu, or a
  double-click (`DoubleClick`, `src/tree/doubleClick.ts`: the row's
  command reports every click; the second on the same row within 500 ms
  opens).
- **The Diagram session.** Listing a schema's diagrams and reading them
  run on a session of their own, "Diagram" (`DiagramService`,
  `src/modeler/diagramService.ts`), and every such query is a row in the
  connection's Actions: the spinner while it runs, then what it read or
  its error, the statement beside it, "Diagram" in the Conn column (the
  user's wish: "log the queries in the Action tab, as Diagram").
- **The viewer** is one panel per source
  (`ModelerPanel.show(extensionUri, source, diagram, host)`), titled
  "diagram (schema)" (escaped in the page's `<title>` by
  `buildWebviewHtml`: a diagram's name is the database's). It reads the
  model when its page is ready and opens on the diagram asked for
  (`load.diagram`, with `editable` and the `target` it is restored from);
  opening another diagram of that schema reuses it (`showDiagram`), and
  the viewer's own Diagram list retitles it (`diagramShown`). A spinner
  shows in the middle of the canvas where loading takes longer than 0.3 s.
- **An MSM project's diagrams** open from the MSM Projects view (a
  **Diagrams** folder first under each project, listed with
  `msm.list_schema_diagrams`, a row per diagram with its figure count,
  opened by its inline button, its menu or a double-click through
  `ProjectNavigation`, as the other rows (see object-details.md)) and from the Explorer's MariaDB Schema
  Management submenu on a `*.msm.project` folder: **Open Schema
  Diagram...** (`mariadb.msm.openSchemaDiagram`, also on a project row and
  the palette, where it asks for the folder) quick-picks where the project
  has several. `ProjectModelSource` reads with `msm.get_schema_diagrams`
  (pictures elided to `image_size`), asks `msm.get_schema_diagram_image`
  for each picture an image figure shows, saves with
  `msm.set_schema_diagram` and edits the schema with `msm.edit_schema`;
  every call is an action of the Actions tab under General Actions
  (`ActionGroup`, the call as its row shows it, a document by its name;
  an `msm.edit_schema` row is titled by its edits, `editTitle` in
  `editTitles.ts`: the first two in words, as "Added the column email to
  orders", then "and N more changes", falling back to "Edited the schema
  of `<schema>`" for an op it has no words for)
  but reading the diagrams and the auto-store's saves, which flooded it
  (the user: "do not log those on the Action tab"; `#quietCall`: a
  failure goes to the log, the viewer showing it as before), and they run
  one at a time per project (msm reads and writes the
  project's files, the connector does not serialize). One source per
  project (`projectSources` in `extension.ts`).
- **Auto Layout** (a project's diagram only: a live schema's is not
  saved): msm lays the diagram out again, `msm.layout_schema_diagram` with
  `keep_placed: false` (every table, view, sequence and group figure; ones
  on a layer, notes and images keep their place; foreign keys not drawn get
  a connection). From the diagram row's menu in the MSM Projects view
  (**Auto Layout Schema Diagram...**, `MSM_DIAGRAM_COMMANDS.layout`, after
  Rename) and the toolbar's hamburger (**Auto Layout...**, shown where the
  model is `editable`; the page posts `layoutDiagram`). Both go through
  `layOutDiagram` in `modelerPanel.ts`: a modal first, as the places it
  replaces cannot be restored (no undo: the panel reads the model again),
  then `ProjectModelSource.layoutDiagram` (saves what waits, then the msm
  call, an action of its own: "N figures placed, M connections added"),
  then `ModelerPanel.reload`. The UI test lays it out both ways (the end of
  `11-msm-diagrams`).
- **The auto-store (the user's decision: "auto-store to a temporary
  location after each major change, so when VS Code is closed and
  re-opened, the edited diagrams can be restored").** After every history
  change (the canvas's `onHistory`: a move, resize, raise, menu command,
  rename, undo) the viewer posts `diagramChanged` for each diagram whose
  saved document (`diagramDocument`: no pictures, the notations) differs
  from what it sent last. The source writes a draft at once
  (`DiagramDrafts`, `globalStorage/diagramDrafts/<hash(project)>-<hash(diagram)>.json`,
  written to a temp file and renamed, with the hash of the project's
  diagram it was made from, `diagramHash`: canonical JSON without pictures
  and notations), then saves to the project once changes settle
  (`SAVE_DELAY_MS`, 1 s) and drops the draft; a failed save keeps it. The
  status line says Changed / Saving… / Saved / Not saved: why
  (`saveState`). A panel closed saves what waits (`flush`). Reading a
  project takes its drafts up: kept and saved where the project's diagram
  is still the one they were made from, else a modal asks (Keep My
  Changes / Use the Project's); a draft of a diagram the project no longer
  has is dropped. A `WebviewPanelSerializer` (activation event
  `onWebviewPanel:mariadb.modelViewer`) restores open viewers after a
  restart from the `target` the page keeps in its state (kept current as
  the diagram shown changes); a connection's viewer reads its schema
  again.

Part of [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md).

## The split: a canvas, and figure sets

The user wants the canvas used for different purposes with different
figure sets, so the canvas knows nothing of tables or layers:

- **`webview/src/canvas/`, the base.** `Canvas.ts`: the camera and its
  2D / 3D views, Cmd + drag orbiting, zoom and pan, the paper and its
  grid, rendering on demand, the keyboard, undo / redo, selection with
  its outline and resize handles (drawn by the canvas for any item), moves
  and resizes, hover, the menu buttons, context menus, editing text in
  place, the Navigator's overview. `canvasTypes.ts` is the contract;
  `geometry.ts` (views, presets, orbit, grid spacing, `affineTransform`),
  `threeHelpers.ts` (`DRAW_ORDER`, shapes, `disposeGroup`), `screen.ts`,
  `undoStack.ts`, `theme.ts`, and the UI: `CanvasToolbar.tsx` (with
  `ToolbarSection` for a set's own sections as children),
  `SplitButton.tsx`, `CanvasMenu.tsx` (`CanvasMenu`, `MenuButton`),
  `Navigator.tsx`.
- **A figure set** (`IFigureSet`) draws into the canvas's two groups -
  `base` on the page, `lifted` rising in 3D - and answers for its items:
  `itemAt(probe)`, `item(id)` (an `ICanvasItem`: id, plane, `rect()`,
  `resizable`, least size, `elevation()`, `elevatable`, `menuBand`,
  `outlined: false` for an item the set marks selected itself, such as a
  line),
  `beginMove` / `beginResize` / `beginElevate` sessions (the set decides
  what moves along), `snapshot` / `sameSnapshot` / `restore` (the canvas
  records every move, resize, raise and `host.change(...)` as one undo
  step from them), `menu` / `runCommand`, `doubleClick` (which may call
  `host.startEdit(spec)`), `viewChanged`, `zoomSettled`;
  `selectionChanged(ids)`, `grabAt(probe)` (a handle the set draws, the
  canvas recording its drag as one undo step) and `beforeRender` (sizes
  kept in screen pixels).
- **`webview/src/modeler/`, the EER diagram.** `EerFigureSet.ts` (one per
  model; `show(diagram)` picks the diagram, `canvas.load(set, paper)`
  draws it; history kept across a model's diagrams, cleared for another
  set), `tableCard.ts`, `connectionGeometry.ts` (routes, crow's foot,
  split stubs), `layerRules.ts`, `catalog.ts`, and `ModelViewer.tsx`,
  which puts canvas, set, toolbar, Navigator, menus and the input
  together.

## What the user decided

- **three.js, not Pixi.** One scene, one `OrthographicCamera`; the 2D view
  looks straight down, the 3D one is the same camera turned and tilted
  (`TOP_VIEW`, `isoQuaternion`, slerped over 400 ms). Presets
  (`ISO_PRESETS`): True Isometric (35.26° tilt, 45° turn, the default,
  `DEFAULT_ISO_PRESET`), Steep (45°, 45°), Upright (50°, 30°). True
  isometric keeps 58% of the page's depth, the others 71% and 77%; the
  preset picked is the webview's, kept in its state, so the default is
  what a viewer without one opens with.
- **Three projections** (the toolbar's Projection section, the user's
  names): **2D Top**, the page from above; **Isometric**, the 3D view;
  **2D Front** (`ViewMode` `front`), level from the page's bottom edge
  (`FRONT_VIEW`, tilt 0 and turn 0), so REST object figures, standing
  upright, show in full and what lies flat only its slab's front side,
  the view the 2D one turned round. The canvas blends the camera from
  above (`#viewT` 0) to a 3D target (1), the target itself blended from
  the Isometric angles to the front (`#frontT`), so every switch turns
  animated; the lift is full there (`liftFactor` of the tilt, 0). The
  items' tops are edge-on: their menu buttons are not shown, an upright
  card's front one is. The relationship lines' end markers (crow's foot,
  bars) are turned up about their line as the view turns to the front
  (`turnedMarker`, by `host.front()` x 90°: the user's request), else
  they would be edge-on there; flat in the other two views. Kept per
  diagram as any view (`mode: "front"`).
  An orbit from it starts at the lowest tilt. **Selecting, sizing and
  moving in it** (the user's request: the selection rectangle and handles
  flipped, figures moved up / down on Z and left / right on X): an item
  with `frontSpan` (every figure: an upright card foot to top, a lying
  one its slab's side) has its outline and handles stood up on the face
  it shows (`#updateDecorations`, turned 90° about x, `FRONT_DECORATION_OUT`
  in front of it); the pointer is read across and up (`#frontAt`, an
  upright plane, heights as an item's `elevation`), as the page is never
  met. Handles: an upright card's eight (`frontHeightResizable`: its top
  or foot moves, the other stays, its height then sized by hand), a lying
  one's left and right (`resizeFrontTo`). A drag moves across
  (`moveBy(dx, 0)`) and up (`IMoveSession.elevateBy`: a selected layer
  with what lies on it, a selected figure its own Z, both in
  0..`MAX_ELEVATION`, `inElevationRange` in modelFormat.ts, which the
  MSM Projects rows use too). A lying card's side label is a hit target
  there (`#figureHit`), its UV not taken for a row (`face`). A layer
  shows its slab there (`frontSpan`: its elevation to its face): picked
  within `LAYER_FRONT_REACH_PX` of it (`#layerInFront`, from the probe's
  `frontOn`, as `pointOn` meets no plane seen edge-on; the nearest, the
  inner one on a tie), outlined, moved across and up with what lies on
  it (the move session's `elevateBy`), sized across only by its left and
  right handles (`resizeFrontTo`: left and width, its depth kept). Lines
  have no front outline.
- **The Isometric button is a split button**: the main part goes to the
  3D view last chosen, only the chevron opens the list; a pick also goes
  to the 3D view. Kept in the webview's state (`saveState` / `loadState`).
- **Cmd + drag orbits freely** (canvas `#orbit`, `orbitAngles`): across
  turns, down tilts towards straight above, 0.4° per pixel, tilt 10°..90°.
  Starting in 2D tips the camera over from straight above (the view turns
  3D at once; `onViewMode`). The figures' lift follows the tilt
  (`liftFactor`: none at 90°, full from 60° down, so every preset lifts
  fully). Orbiting makes "Custom (x° tilt, y° turn)" in the Isometric
  list, selected and updated as the drag goes, kept with its angles.
  Cmd + click without moving still toggles an item's selection; Shift +
  click does too.
- **The figure design and the toolbar are the MySQL Shell's**
  (`mysql-shell-plugins/gui/frontend/src/modules/db-editor/DiagramDesigner`):
  header strip in the figure's colour with the table icon and name,
  columns with key / not-null / nullable icons and italic dimmed types,
  Indexes and Foreign Keys where expanded; View (reset, grid, rulers =
  pages, lock, the Tools and Navigator switches) with the same icons. The
  tools (pointer, hand, zoom and Workbench's EER tools) are on a floating
  palette at the top left (see [`modeler-tools.md`](modeler-tools.md)).
- **Names are edited in place on a double-click** (table, column, layer).
  The input is sized as the text is in 2D at the zoom and laid onto its
  plane by one CSS `matrix()` (`affineTransform`; the camera is
  orthographic, so a page rectangle lands on the screen as a
  parallelogram), at the item's elevation, re-placed after every render.
  Drawn as the Explorer's rename box: `outline: 1px solid
  var(--vscode-focusBorder)`, `outline-offset: -1px`, radius
  `var(--vscode-cornerRadius-small, 4px)` (checked in the installed VS
  Code's workbench CSS).
- **The pages are kept** for printing / PDF: `src/modeler/pageSettings.ts`
  (pure, shared): the page's coordinate space is the sheets' printable
  areas tiled from its origin. Defaults are the model's `app.PageSettings`
  (read from the `.mwb`): A4 portrait, margins 6.35 / 6.35 / 6.35 / 14.46
  mm, 5 units per mm - the MRS diagram is exactly two sheets wide. The
  model JSON does not carry the page settings yet.
- **100% is life size** on the user's Apple Studio Display (`screen.ts`:
  218 ppi constant, divided by `devicePixelRatio`; 297 mm = 1274.5 CSS px
  at 2x).
- **The objects come from the CREATE statements**: msm's snapshot is made
  by the language server's `mariadb-lsp outline`. The set reads them
  through `ISchemaCatalog` only (`catalog.ts`: tables, views and routines
  by lower-cased name, `primaryKeyColumns`, `foreignKeyOf`).
- **Object changes go to msm, which changes the SQL** (the user: "we need
  a proper pipeline to communicate object changes back to the msm plugin,
  so it can update the SQL in sync"). A rename of a table or a column (in
  place, or Rename Table) is one history action: the viewer shows it at
  once (catalog, and every figure and connection of every diagram, as
  msm's `rename_in_diagram` does) and posts `schemaEdit`
  (`rename_table` / `rename_column`, the language server's edit format);
  the panel calls `msm.edit_schema` against the snapshot's `sourceHash`
  (after saving what waits, as msm renames the stored diagrams), and
  sends the new snapshot back (`schemaEdited.objects`, `replaceObjects`:
  the catalog replaced, every card laid out again). Undo sends the
  reverse rename. A failed edit is notified and taken back where it
  stands, its name opened again as typed (see
  [`modeler-tools.md`](modeler-tools.md)); a stale snapshot, or a refused
  undo or redo, has the panel read the project again. Notes msm
  returns (what the binary could not rewrite) are a warning. Renames are
  offered in projects only (`editable`): a live schema's VIEW is msm's.
  msm keeps each edit's migration for the next release's update script
  (mariadb-shell-plugins #86). msm has the binary's `mariadb-lsp edit`
  (lsp-server) work the edits out; a shell whose binary lacks it refuses
  the edit ("Update the MariaDB Shell"), which the viewer reports and
  takes back like any refusal.

## Figure kinds

What each kind of figure is drawn as, its menu, connections between them
and figures sized to their content: see [modeler-figures.md](modeler-figures.md).

## The view

The Navigator, where a diagram opens (the views VS Code keeps), and the
shortcuts: see [modeler-view.md](modeler-view.md).

## Tables and layers

- **Workbench's rules** (`layerRules.ts`, pure, tested): a table lies ON
  a layer when fully inside it, and is filed (`figure.layer`) under the
  SMALLEST layer it lies on, its `left` / `top` relative to that layer.
  A dropped or resized table is filed again (`#fileUnderLayer`), keeping
  its place on the page.
- **Layers are items** on the base plane: selectable (the inner one where
  they overlap), movable, resizable (least 80 x 40). Moving a layer moves
  every table lying fully on it, whatever it is filed under; tables only
  partly on it stay (their relative position is compensated). Resizing
  from the left or top keeps the filed tables in place on the page.
- **Option + drag raises or lowers a layer** in the 3D view
  (`beginElevate`; `layer.elevation`, the viewer's own field, 0..240),
  with the tables filed under it. So does **the elevation handle** a
  selected elevatable item (a layer) shows in Isometric only: a handle
  square turned 90° about y (`IDecoration.elevator`), stood up on the
  left edge `ELEVATION_HANDLE_GAP` handles below the top left one (at
  most a quarter of the height down, clear of the middle handle), its
  middle at the outline's height and a hair outside it
  (`FRONT_DECORATION_OUT`, so the outline does not cross it), so it
  reads as "up and down"; `ns-resize`, hit where its middle lands on the
  screen (`#elevationHandleAt`), one undo step as Option + drag. Hidden in
  2D Top and 2D Front, where it would be seen edge-on (2D Front moves up
  and down by a plain drag). Elevation scales with the lift, so 2D
  stays flat; a foreign key between tables at different heights keeps
  its first and last segments at their tables' heights and spans the
  difference in its middle segment alone. Lines meet each table halfway
  down its slab (`#lineElevation`). A figure can also stand above its
  layer (`figure.elevation`, the viewer's own, 0..240, set from Object
  Details' Z). Everything the canvas places (outline, handles, menu
  button, input, hit tests, drags) uses an item's own height.
- **Menus.** A table's: Edit Table... (the table editor, see
  [`table-editor.md`](table-editor.md); `onEditTable` → `editTable`), Collapse / Expand, Show Indexes, Show Foreign
  Keys, Auto-Size Height, Rename Table. A layer's: Rename Layer, Select
  Tables on Layer, Fit to Tables (`fitAround`: 20 around, 26 above for the
  name). Opened by a right-click, or the hamburger an item shows while
  selected OR under the pointer (`menuBand`: the header for a table; for
  a layer a band as high as a card's header centred on the name's line,
  so both buttons are one size), 60% of the band's height (so it scales with
  the zoom; not drawn under 8px), its right edge a fixed distance from the
  item's in page units - what half a handle and 4px are at 200%, where it
  looked best (`MENU_BUTTON_REFERENCE_ZOOM`) - so it keeps its place on the
  item at every zoom, its three bars drawn as shares
  of it, kept clear of the corner handle. The Navigator's and the toolbar's
  hamburgers (20px, `MENU_BUTTON_SIZE`) draw the same bars (`menuBarStyle`).
  The button and its bars are in whole DEVICE pixels (`menuBars` in
  `CanvasMenu.tsx`: 8% thick, 16% apart, 56% wide, at least a device
  pixel clear between bars), and in 2D the button is moved by a
  `translate` rounded to device pixels rather than a matrix: percentage
  bars at subpixel offsets came out uneven, and whole CSS pixels made a
  small button's bars too thin and too far apart on a Retina screen. Buttons
  whose screen box (`ICanvasOverlay.bounds`) touches the Navigator panel
  are not drawn - its overview area is transparent, so they would show
  through it.
- **Heights follow `manualSizing`** (Workbench's flag): content height,
  written back to `figure.height`, unless sized by hand from the top or
  bottom edge; cut-off content is not hit.
- **Undo.** Snapshot-based for moves, resizes, raises and menu changes
  (`FigureState` incl. `layer`, `elevation`; `LayerState` incl. `name`,
  `elevation`; `ConnectionState`: `middleSegmentOffset`, `drawSplit`);
  renames of tables and columns are actions of their own, covering every
  diagram and connection of the model. Cmd+Z / Cmd+Shift+Z (Ctrl
  elsewhere); the history is kept (`entries`, `onHistory`) for a list the
  user wants later.

## Rendering notes

Cards as canvas textures, slabs, draw order, fat connection lines, layer
plates, the grid, the paper and the printable area: see
[modeler-rendering.md](modeler-rendering.md).

## Known gaps / next steps

- Pictures (kept per diagram and figure, `pictureKey`): an erased image
  figure's decoded picture stays in `#pictures` / `#picturesAsked`; a
  picture request that failed is not asked again; an `image` reply from
  before a reload reaches the new figure set, so a picture can be fetched
  and decoded twice.
- **Rendering the viewer without VS Code**: see
  [testing-and-debugging.md](testing-and-debugging.md).
- Not yet tried in a running VS Code: a project's diagrams opened from
  MSM Projects or the Explorer, the saves and drafts, the restore after a
  restart, a rename through `msm.edit_schema`. Nor (the rendering was:
  cards, menu
  buttons, grid, paper, Navigator and the 3D view, on the MRS model):
  the Connections view's Diagrams folder against a live schema with the
  view, the double-click, the pre-selected diagram, the Actions rows on
  the "Diagram" session, the Navigator's zoom list, layer moves with
  their tables and Option + drag; the elevation handle, layers in 2D
  Front, Show in Diagram and a tree row's `selectItem` were checked
  headless only.
- A project's diagrams are saved; a live schema's never are (their
  changes last the panel). The history is not shown anywhere yet. Tables
  and columns are renamed; new tables, views, procedures and foreign keys
  come from the palette (`modeler-tools.md`), through `mariadb-lsp
  edit`'s ops; an empty diagram to start from comes from the `+` on a
  project's Diagrams folder in the MSM Projects view (`msm.md`). Adding a
  column to an existing table, editing a column's type and editing notes
  in place are for later.
- No rubber-band selection, no connection captions, no mark on a card
  that cuts content off.
- PDF export / printing per page: the page model is there, nothing
  renders it yet. `DISPLAY_PPI` should become a setting.
- The grid's spacing ignores the 3D view's foreshortening.
