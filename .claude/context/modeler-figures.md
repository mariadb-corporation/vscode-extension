# Schema diagram figure kinds

Part of [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md), the viewer's
figures; the viewer itself is [modeler.md](modeler.md).

**Any card figure stands upright or lies flat** (the user's request: "so
a REST object figure can be fully visible in 2D Top view and a table in
2D Front"): `figure.upright`, set by the menu's Stand Upright / Lay Flat
(`toggleUpright`) or Object Details' Upright check, both through
`#changeFigure` (re-filed under its layer, its footprint changing); left
out, a RestObjectFigure stands and every other kind lies flat
(`isUpright(kind, figure)`). An upright card is drawn as described for
RestObjectFigure below, whatever its kind: footprint `width x depth`
(`depth` written while it stands, dropped while it lies), sized across
only (the user's request: a handle on the left and right to adjust the
width; `widthOnly` on the item, which leaves the canvas's other six
handles out; in 2D Front all eight, up its face too: see
[modeler.md](modeler.md)), its width kept as sized, else its content's, a front menu
button; the item's fields that
depend on it are getters, and the geometry is built again with it (part
of the key). A lying card's side label is a hit target no more
(`#figureHit` skips it). Undoable (`upright`, `depth` in `FigureState`).
An upright card's foot is a slab (`CARD_THICKNESS`) below its Z, so at
the same Z it stands where the lying cards' slabs end, not on their faces
(the user's request); `#figureElevation` takes it off, so its top, its
lines and its marks follow. The stored `elevation` is unchanged. Its
shadow is not lowered with it: shadows lie in the base group, without
the lifted plane's offset, and a slab lower is under the paper, hidden
in 3D (`#placeFigure` places it at the figure's Z).
msm keeps `upright` and `depth` (mariadb-shell-plugins #114): a missing
or non-boolean `upright` is the kind's default, an upright figure's
footprint is `width x depth` (20 where missing), a flat one's `width x
height`; its layout places an upright table by that footprint, keeping
its card's size, and never moves REST object figures.

**A figure's or a layer's color** is picked in Object Details, at the
bottom of its place and size (the user's request: "the color selection
... that we also use for e.g. the MSM Project editor"): the shared
`ColorSwatches` with `FIGURE_PALETTE` (`modelFormat.ts`: the connection
colors' names, as Workbench's figure colors and a red, stored as hex in
the diagram's `color`). None drops a figure's own color (its kind's
then) and gives a layer `LAYER_COLOR`; a color of its own (Workbench's)
selects no swatch and stays until another is picked. One undoable
change (`color` is in `FigureState` / `LayerState`): the slab is built
again (its color is baked, so it is part of the geometry's key), the
card drawn again, the menu buttons' bars take the header's text color
(`menuBand` is read when drawn), a layer's plate and border are colored
as it is placed. The swatch styles are `webview/src/swatches.css`,
shared by the editors and Object Details.

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
- **RestObjectFigure** (`rest`, #6FBF73; the user's request, agreed with
  msm, see [mrs.md](mrs.md)): a REST object of the project's MSM Section
  180 (`restService`, `restSchema`, `restObject`, the paths as the section
  writes them, a developer's service `mike@/svc`), drawn **upright**
(`isUpright`): its face, slab and top label geometries are turned 90°
about x (`uprightGeometry`, before the slab's shading is baked, so it
lights the sides as they face), the face towards the 3D camera on the
footprint's front edge, the slab reaching back over the footprint, its
top carrying icon and title (`sideLabelGeometry(..., upright)`). One
`#placeFigure` places it, its z scale following the lift as a slab's
does, so 2D shows only the top, a title-only box. The footprint is
`width x depth` (`depth`, 20 = `CARD_THICKNESS`, written to the figure so
msm's layout keeps it clear) and is `#figureRect`; `height` is how high
it stands, the face's (`layout`, which a hit's uv maps onto). The item's
elevation is its top, where it is selected and its menu button sits
(its `menuBand` as high as a card's header, centred on the 20-deep top,
so the button is a table's and a layer's size: the user asked for that
after a slab-high band made it smaller). A second button sits on its
face's header in the 3D view (the user's request): the item's
`frontMenuBand`, which the canvas lays upright on the rectangle's bottom
edge, down from the item's top (`#menuOverlay(..., front)`, keyed
`<id>:front`), not in 2D, where the face is edge-on. It casts a shadow
under its footprint, square-cornered (`shadowGeometry(..., 0)`), on the
page below it as a table's does: the lifted plane stands `LIFT` above
the page in 3D, the card on it. The
top label is a hit target too (`#cardMeshes`), the face being edge-on
from above. Not resizable; menu Auto-Size Height only.
  Content `restObjectCardContent`: a heading `VIEW sakila.actor`, then the
  statement's field lines (`IRestObjectDefinition.lines`, from
  `fieldLinesOf`: the view's `{ ... }` block, a routine's `PARAMETERS` /
  `RESULT` blocks, OPTIONS and METADATA left out, the shared indent
  dropped) in the editor's font (`theme.codeFontFamily`, measured as
  `code`); none written says the server makes one per column, a figure
  Section 180 no longer creates says so. Placed where dropped, no line to
  its table; once per diagram, paths compared whatever their case.
- Any other type is a frame saying the viewer does not show it.
- **Connections** are drawn between table figures only (views and
  routines have none, as Workbench); a key that is not `many` gets a bar
  at its start instead of a crow's foot. **Lines sharing a side spread
  over it** (`spreadAnchors`, the user's rule): the side's straight part
  (the corner radius left out at each end, so none docks on a rounded
  corner) is split into n + 2 parts for n lines, which meet it at the
  middles of the inner n - one in the middle, two at 3/8 and 5/8, three
  at 3/10, 5/10, 7/10 - in the order of their other tables along the
  side, so they do not cross; a self reference takes a spot on the right
  side (first) and the top (last); hidden lines take none. Both ends of a
  line are spread, so a Z's ends need not be level. `routeConnection`
  and the spread pick sides with one function (`sidesOf`). Moving tables
  reroutes their lines and every line whose spot changed (`#routeOf`).
  **An end can be placed by hand**: a selected line has a handle on each
  end; dragging one docks it on the side of its table the pointer is
  beyond (inside the card, the nearest edge; `nearestDock`), its `at`
  (0..1 along the straight part) its place in the order there, the side
  still spread evenly - so a drop between two lines swaps it in. Kept as
  `startDock` / `endDock` on the connection (the viewer's own; msm keeps
  them), undoable, shown in Object Details with a reset button
  (`resetDock`). While dragging, the places it could take show on every
  side (`#showFreeDocks`, `sideSlots`). Ends on sides that do not face
  each other go 20 out (`STUB`) and join at right angles: an L where the
  corner lies ahead of both, a U for the same way out, an S across the
  middle for sides facing away; the middle-segment handle is the facing
  Z's only. **Docking points**: a disc (radius `DOCK_RADIUS` 4) in its
  table's colour darkened (`DOCK_SHADE`, `dockColor`) where each line
  meets its table, upright on the slab's
  side face at the line's height and growing with the lift (`placeDock`),
  so none shows in 2D. **On an upright card** (the user's request: the
  docks "re-calculated to fit the new vertical positioning") the lines
  on its left and right edges spread up its height, top to foot, as a
  lying card's spread down its side (`standAnchors`, after
  `spreadAnchors`): each meets the footprint in its side's middle, at its
  own height, ordered by how high the figure at the other end is (a
  hand-placed one by its `at`, 0 at the top), so they do not cross in 2D
  Front; dragging an end there reads its height off the upright plane
  through the footprint (`#heightOn`; `atOfHeight`), and the free places
  shown run up the edge (`standingSlots`). Lines into its face or back
  run half a slab above its foot (`#lineElevation`). Every connection
  height goes through `#endElevation` (`#heights`).
  **Lines follow the foreign key
  definitions, not their names** (the user's rule: a key the table
  editor drops and adds again under another name, or one renamed in the
  SQL, must keep its line and the line's settings): `connectionSync.ts` matches each stored connection (child =
  start figure's table, parent = end figure's) to the child's key of its
  name that references the parent, else to the child's first key onto
  the parent no other connection between those two figures has (keys had
  per figure pair; keys onto another schema's tables match nothing);
  re-points `foreignKey` / `table`, keeping offset, split and visibility;
  drops one with no key left; adds a line for each key between two
  table figures shown that has none. Run on mount and on every `#refresh`
  (any catalog change); a change is saved (`onConnectionsSynced`).
  msm's `reconcile_diagram` follows the same rule, but never adds
  (mariadb-shell-plugins #109, `diagrams._match_connections` and
  `foreign_key_parent`). A MariaDB Shell whose bundled msm predates it
  still drops a line whose key was renamed; the viewer then draws it
  again with default settings.
- **A figure without a width** gets its content's (`cardWidth`: msm's
  rule, the longest row or the title rounded up to 10, 120..360, measured
  in the card fonts on a canvas, `estimateText` = msm's per-character
  estimate where none can measure), a note its text's, a picture
  Workbench's 160 x 60, written back to the figure so a save keeps it.
  Notes and pictures have no menu band and no menu.
