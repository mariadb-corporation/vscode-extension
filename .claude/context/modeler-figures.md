# Schema diagram figure kinds

Part of [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md), the viewer's
figures; the viewer itself is [modeler.md](modeler.md).

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
