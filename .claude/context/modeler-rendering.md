# The diagram viewer's rendering

Part of [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md); the viewer as a
whole is [modeler.md](modeler.md).

- **Grid** like Illustrator's (`gridSpacing`): 10 mm main / 2 mm sub at
  the base level, five per cell; sublines closer than 6 px are dropped and
  the main lines become the sublines of a grid five times wider; they fade
  in over 8 px. Rebuilt only on a level change.
- **Cards are Canvas2D textures**, not troika-three-text: troika's CDN
  font, blob worker and missing font file do not pass the webview's CSP.
  Redrawn at a step of device pixels per unit 150 ms after the zoom
  settles (`zoomSettled`).
- **Each card has a slab** (`CARD_THICKNESS` 20 units: just room for the
  header's icon and bold title, which its front side shows in the
  header's text colour - `drawSideLabel`, a plane that is the slab's
  child so it grows with it; shaded by baked vertex colours from
  a light at the upper left), flat in 2D, growing with the lift. It is
  inset a unit inside the card (`SLAB_INSET`): as large as the card, its
  light top showed through the card's anti-aliased corners as a fringe.
  Rounded rectangles (`roundedRect`) use circular arcs, as Canvas2D's
  `roundRect` does; quadratic corners bulged past the card's.
- **Draw order is fixed** (`DRAW_ORDER`: pages, grid, base, shadows,
  lifted, connections, decorations), since three.js sorts transparent
  meshes by distance, which put tilted plates over shadows.
- **Figure shadows** are `--vscode-widget-shadow` at 18% on a dark theme
  and 8% on a light one (`SHADOW_OPACITY`; the user's request: lighter in
  light mode), set when the figure is built, which a theme change redoes.
  VS Code's themes write that colour with alpha (`#0000005c`), which
  `THREE.Color` cannot read (it warns and keeps white, which draws every
  shadow white): `readTheme` passes each colour through `opaqueColor`,
  which drops a hex colour's alpha. Headless renders need the same form
  in their stand-in variables to show the problem.
- **A raised layer casts a shadow on the page** (`ILayerNode.shadow`):
  the figures' shadow style around the layer's rounded outline
  (`shadowGeometry(..., LAYER_RADIUS)`), offset as theirs, at `Z.shadow`
  on the page (a hair above the paper, wherever the layer stands), shown
  only while its elevation is above 0 and the view has lift: in 2D it
  would lie in the plate's plane and darken it. A layer over another
  layer has its shadow under that one's plate.
- **Connections are fat lines** (`LineSegments2` / `LineMaterial`, 1.6 CSS
  px, `CONNECTION_WIDTH`): WebGL's own lines are a pixel wide whatever is
  asked. Their material needs the canvas's size (`host.viewport()`, set
  in `viewChanged`). In the Navigator's overview they are drawn at
  `NAVIGATOR_CONNECTION_WIDTH` (0.5; the user's request: the main view's
  width made a relationship a blot between two tiny cards): the canvas
  calls the set's `navigatorRender(true)` / `(false)` around that render
  (`IFigureSet.navigatorRender`, optional), which sets the lines' and
  markers' `linewidth` and puts it back.
  Each connection is two of them: the route, dashed (5 on, 4 off,
  `CONNECTION_DASH`) for a non-identifying relationship as Workbench
  draws it, and its end markers, always solid (a dashed material dashes
  every segment it holds). `identifying` is read from the catalog
  (`relationshipKindOf`) when built and on `#refresh`.
- **A connection is an item** (`outlined: false`): a click selects it as
  it does a table, and the canvas leaves its marking to the set
  (`selectionChanged`) - the line in the selection colour and, on a Z, a
  handle in the middle of the middle segment (`grabAt`, sized in pixels in
  `beforeRender`). Dragging it moves the segment towards either table,
  kept `MIDDLE_CLEARANCE` (two markers) clear of both, and stores
  Workbench's `middleSegmentOffset` (from halfway), which the snapshot
  undoes. `drawSplit` ones are a 40-unit stub out of each table, no handle.

- **Layer plates are solid**: the layer's tint over the paper, mixed in
  sRGB as the old 35% / 60% see-through plate was blended (`tintOver`),
  so the grid lies under the layers rather than showing through. Nested
  plates would fight in one plane, so a smaller layer lies a little
  higher (`#stackHeight`, 0.003 per larger layer).
- **Layers and the paper are a little thick** (the user's request:
  extruded "a tiny bit"): a slab under each, `slabUnder` in
  `threeHelpers.ts` (the shape extruded down, its sides shaded as the
  cards' are, `shadeSlab`, which the card slabs use too), scaled in z by
  the lift, so flat in 2D. A layer's is `LAYER_THICKNESS` (3) in its
  tint, its face, border and name on top (`#layerTop`: the layer's item
  elevation and its hit plane; a figure filed under it casts its shadow
  there); the stored `elevation` is the slab's foot. The paper's is
  `PAPER_THICKNESS` (3) in the paper's colour, hanging under the sheets
  (`#paperSlab`, its scale set in `#applyView`).
- **A figure's slab is unshaded in 2D Front** (the user's request: a
  lying card's side, all that view shows of it, in the figure's colour):
  `#shadeSlab` blends the baked vertex colours (kept in the geometry's
  `userData.shaded`) towards the figure's colour by `host.front()`, so
  the turn animates; redone where the front share changes
  (`builtFront`) or the slab is built again. Layer and paper slabs stay
  shaded.
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
