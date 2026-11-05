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
  opened by its inline button, its menu or a double-click,
  `MSM_DIAGRAM_CLICK_COMMAND`) and from the Explorer's MariaDB Schema
  Management submenu on a `*.msm.project` folder: **Open Schema
  Diagram...** (`mariadb.msm.openSchemaDiagram`, also on a project row and
  the palette, where it asks for the folder) quick-picks where the project
  has several. `ProjectModelSource` reads with `msm.get_schema_diagrams`
  (pictures elided to `image_size`), asks `msm.get_schema_diagram_image`
  for each picture an image figure shows, saves with
  `msm.set_schema_diagram` and edits the schema with `msm.edit_schema`;
  every call is an action of the Actions tab under General Actions
  (`ActionGroup`, the call as its row shows it, a document by its name),
  and they run one at a time per project (msm reads and writes the
  project's files, the connector does not serialize). One source per
  project (`projectSources` in `extension.ts`).
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
  `resizable`, least size, `elevation()`, `elevatable`, `menuBand`),
  `beginMove` / `beginResize` / `beginElevate` sessions (the set decides
  what moves along), `snapshot` / `sameSnapshot` / `restore` (the canvas
  records every move, resize, raise and `host.change(...)` as one undo
  step from them), `menu` / `runCommand`, `doubleClick` (which may call
  `host.startEdit(spec)`), `viewChanged`, `zoomSettled`.
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
  (`ISO_PRESETS`): True Isometric (35.26° tilt, 45° turn), Steep (45°,
  45°), Upright (50°, 30°, the default). True isometric looked pinched to
  the user (58% of the page's depth kept; the others 71% and 77%).
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
  Indexes and Foreign Keys where expanded; Tools (pointer, hand, zoom) and
  View (reset, grid, rulers = pages, lock, Navigator) with the same icons.
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
  reverse rename. A failed edit is notified and the panel reads the
  project again (the viewer showed the change already). Notes msm
  returns (what the binary could not rewrite) are a warning. Renames are
  offered in projects only (`editable`): a live schema's VIEW is msm's.
  msm keeps each edit's migration for the next release's update script
  (mariadb-shell-plugins #86); the binary's `mariadb-lsp edit` is being
  written in lsp-server, and until a shell has it a rename fails with
  msm's "Update the MariaDB Shell".

## Figure kinds

`kindOf` in `EerFigureSet.ts`; the cards' layout is `tableCard.ts`
(`tableCardContent`, `viewCardContent`, `routineCardContent`, then one
`layoutCard`), notes and pictures `noteCard.ts`. Workbench's colours by
type (`FIGURE_COLORS`) where a figure has none.

- **TableFigure** (the default type): header, Columns (primary key from
  the index of kind `primary`, not null from `nullable`), Indexes (an
  unnamed one as `PRIMARY` or its columns) and Foreign Keys where
  expanded.
- **ViewFigure**: the view icon (`schemaView.svg`, the MySQL Shell's msm
  set) and its declared columns, the only ones the outline has; Collapse /
  Expand and Auto-Size Height.
- **RoutineGroupFigure**: ONE card for the group (its `name`), a row per
  routine the snapshot has, `name(param types): returns` (`routineLabel`,
  msm's `routine_label`), the routine icon (`schemaRoutine.svg`, the MySQL
  Shell's `schemaProcedure.svg`); Auto-Size Height.
- **NoteFigure**: a sheet in its colour, `text` wrapped at blanks
  (keeping line breaks) in `font` as Workbench writes it
  (`parseWorkbenchFont`: family, Bold / Italic, size in px; a PostScript
  `Arial-BoldMT` too) and `textColor`, cut off at the figure's size.
- **ImageFigure**: the picture, a data URL, filling the figure or fitted
  and centred with `keepAspectRatio`; no slab or shadow (a card under a
  transparent picture would show). From a project the picture is asked
  for (`imageWanted`, once per figure, kept on the figure so another
  diagram's mount has it; a save leaves it out). An SVG without a
  `viewBox` or a width and height draws at nothing, so `sizedPicture`
  gives its root the figure's size; an SVG drawn as an image loads
  nothing it refers to, and the CSP (`img-src data:`) refuses it anyway.
  Until it is there, a dashed frame says why.
- Any other type is a frame saying the viewer does not show it.
- **Connections** are drawn between table figures only (views and
  routines have none, as Workbench); the foreign key is found by name,
  case-insensitive; a key that is not `many` gets a bar at its start
  instead of a crow's foot.
- **A figure without a width** gets its content's (`cardWidth`: msm's
  rule, the longest row or the title rounded up to 10, 120..360, measured
  in the card fonts on a canvas, `estimateText` = msm's per-character
  estimate where none can measure), a note its text's, a picture
  Workbench's 160 x 60, written back to the figure so a save keeps it.
  Notes and pictures have no menu band and no menu.

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
  with the tables filed under it. Elevation scales with the lift, so 2D
  stays flat; a foreign key between tables at different heights keeps
  its first and last segments at their tables' heights and spans the
  difference in its middle segment alone. Everything the canvas places (outline, handles, menu
  button, input, hit tests, drags) uses an item's own height.
- **Menus.** A table's: Collapse / Expand, Show Indexes, Show Foreign
  Keys, Auto-Size Height, Rename Table. A layer's: Rename Layer, Select
  Tables on Layer, Fit to Tables (`fitAround`: 20 around, 26 above for the
  name). Opened by a right-click, or the hamburger an item shows while
  selected OR under the pointer (`menuBand`: the header for a table, the
  name's band for a layer), 60% of the band's height (so it scales with
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
  (`FigureState` incl. `layer`; `LayerState` incl. `name`, `elevation`);
  renames of tables and columns are actions of their own, covering every
  diagram and connection of the model. Cmd+Z / Cmd+Shift+Z (Ctrl
  elsewhere); the history is kept (`entries`, `onHistory`) for a list the
  user wants later.

## The Navigator

A panel 15px in from the canvas's top right corner, 192px wide (`Navigator.tsx`;
20% under the first 240px, to cover less of the diagram):
title "Navigator" with a hamburger (Fit Diagram, Actual Size, Hide
Navigator; the toolbar's Navigator button brings it back, kept in the
webview state), a zoom slider (log scale over `ZOOM_RANGE`) with the zoom's value as a
split button (`SplitButton`, as the Isometric one: the value goes to the
zoom last picked, 100% at first; its chevron lists 50 / 75 / 100 / 150%,
`ZOOM_PRESETS`) and the
overview. The panel draws no overview: its area is transparent and the
canvas renders the scene into that part of its own WebGL canvas with a
second, top-down camera (`#renderNavigator`, scissor + viewport), so it
stays 2D in a 3D view without a second WebGL context. The part in view is
the four screen corners on the page (`INavigatorState.view`): a rectangle
in 2D, a quadrilateral in 3D, drawn as an SVG polygon in
`--vscode-focusBorder`, 1px, over black at 7%. Dragging pans
(`navigatorPan`); a press outside it centres the view there first
(`navigatorCenter`).

## Rendering notes

- **Grid** like Illustrator's (`gridSpacing`): 10 mm main / 2 mm sub at
  the base level, five per cell; sublines closer than 6 px are dropped and
  the main lines become the sublines of a grid five times wider; they fade
  in over 8 px. Rebuilt only on a level change.
- **Cards are Canvas2D textures**, not troika-three-text: troika's CDN
  font, blob worker and missing font file do not pass the webview's CSP.
  Redrawn at a step of device pixels per unit 150 ms after the zoom
  settles (`zoomSettled`).
- **Each card has a slab** (8 units, shaded by baked vertex colours from
  a light at the upper left), flat in 2D, growing with the lift. It is
  inset a unit inside the card (`SLAB_INSET`): as large as the card, its
  light top showed through the card's anti-aliased corners as a fringe.
  Rounded rectangles (`roundedRect`) use circular arcs, as Canvas2D's
  `roundRect` does; quadratic corners bulged past the card's.
- **Draw order is fixed** (`DRAW_ORDER`: pages, grid, base, shadows,
  lifted, connections, decorations), since three.js sorts transparent
  meshes by distance, which put tilted plates over shadows.
- **Connections are fat lines** (`LineSegments2` / `LineMaterial`, 0.8 CSS
  px, `CONNECTION_WIDTH`): WebGL's own lines are a pixel wide whatever is
  asked. Their material needs the canvas's size (`host.viewport()`, set
  in `viewChanged`); in the Navigator they come out thinner.
- Connections ignore `middleSegmentOffset`; `drawSplit` ones are a 40-unit
  stub out of each table.

- **Layer plates are solid**: the layer's tint over the paper, mixed in
  sRGB as the old 35% / 60% see-through plate was blended (`tintOver`),
  so the grid lies under the layers rather than showing through. Nested
  plates would fight in one plane, so a smaller layer lies a little
  higher (`#stackHeight`, 0.003 per larger layer).
- **The grid's main lines** are at 38%, the sublines at 40% (before
  their fade, which at 100% leaves about a third of it).
- **The printable areas' dashed lines are hidden by default**
  (`Canvas.marginsVisible`); the toolbar's hamburger at its right end
  (`CanvasToolbar` `onMenu`) offers "Show Printable Area", kept in the
  webview state (`margins`).
- **Sheet edges:** the paper's outline in full, the sheets' edges where
  they overlap (inside the diagram) dotted (1.5 on, 4 off) at 30%
  (`INNER_EDGE_OPACITY`).
- **The paper** is the editor's background, lifted 8% towards white on a
  dark theme (`paperColor` in `theme.ts`; `#1e1e1e` gives `#303030`), so
  it does not look black; the layer tints and handles take it from there.
- **Around the paper** is the theme's widget background darkened to 60%
  (dark themes) or 80% (light) in sRGB (`outsideColor`), the Navigator's
  margin too.

## Shortcuts

Space + drag pans (hand tool too); Space + Cmd + click zooms in, with Alt
out; Z + click zooms in, Alt + Z out (zoom tool too); Cmd/Ctrl + wheel or
a pinch zooms about the cursor, a plain wheel pans; Cmd/Ctrl + 0 fits,
Cmd/Ctrl + 1 is 100%; Cmd + drag orbits; Option + drag on a layer (3D)
raises it; Shift or Cmd + click toggles the selection. Modifiers are read
off every event (macOS swallows keyups while Cmd is down); Space and Z
are dropped when Cmd goes up, on blur and when hidden.

## Known gaps / next steps

- The figure kinds and the MRS project's diagrams were rendered in
  headless Chrome from the built bundle with a stand-in for the webview
  API (the page inlined, as `file://` refuses module scripts); a
  running VS Code has not shown a project's diagrams yet.
- Not yet tried in a running VS Code (the rendering was: cards, menu
  buttons, grid, paper, Navigator and the 3D view, on the MRS model):
  the Connections view's Diagrams folder against a live schema with the
  view, the double-click, the pre-selected diagram, the Actions rows on
  the "Diagram" session, the Navigator's zoom list, layer moves with
  their tables and Option + drag.
- A diagram row has the Diagrams folder's icon (`type-hierarchy-sub`)
  until the user designs one of its own.
- A project's diagrams are saved; a live schema's never are (their
  changes last the panel). The history is not shown anywhere yet. Only
  tables and columns are renamed; adding columns or tables, foreign keys
  drawn as connections, notes edited in place are for later (the edit
  ops are in msm's and the language server's format already).
- No rubber-band selection, no connection captions, no mark on a card
  that cuts content off.
- PDF export / printing per page: the page model is there, nothing
  renders it yet. `DISPLAY_PPI` should become a setting.
- The grid's spacing ignores the 3D view's foreshortening.
