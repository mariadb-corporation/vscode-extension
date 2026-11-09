# The diagram viewer's view: the Navigator, where a diagram opens, the shortcuts

Back to [`../PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md). The canvas and
figure sets around it are [`modeler.md`](modeler.md).

## The Navigator

A panel 15px in from the canvas's top right corner, 192px wide (`Navigator.tsx`;
20% under the first 240px, to cover less of the diagram):
title "Navigator" with a hamburger (Fit Diagram, Actual Size, Hide
Navigator; the toolbar's Navigator button brings it back, kept in the
webview state), the overview, and below it (as in Workbench) a zoom
slider (log scale over `ZOOM_RANGE`), − and + right of it (a click's
zoom step, `ZOOM_STEP` in `canvasTypes.ts`, about the view's middle;
disabled at the range's ends), and the zoom's value as a split
button (`SplitButton`, as the Isometric one: the value does again what
was last picked, 100% at first; its chevron lists Fit the Pages, as the
toolbar's button, then 50 / 75 / 100 / 150%, `ZOOM_PRESETS`). The panel draws no overview: its area is transparent and the
canvas renders the scene into that part of its own WebGL canvas with a
second, top-down camera (`#renderNavigator`, scissor + viewport), so it
stays 2D in a 3D view without a second WebGL context. The part in view is
the four screen corners on the page (`INavigatorState.view`): a rectangle
in 2D, a quadrilateral in 3D, drawn as an SVG polygon in
`--vscode-focusBorder`, 1px, over black at 7%. Dragging pans
(`navigatorPan`); a press outside it centres the view there first
(`navigatorCenter`).

## Where a diagram opens

Each diagram opens as it was last left: zoom, the page point in the
middle of the view, the projection (2D / 3D), the 3D preset or the
user's own angles. Kept by VS Code in the workspace's state (key
`mariadb.diagramViews`, `src/modeler/diagramViews.ts`: by the model
source's `key`, then the diagram's name), never in the diagram, so
looking changes no file. The canvas reports every step (`onViewChanged`,
from `#applyView`); the viewer keeps the view 500 ms after it settles
(`keepView`, `viewChanged` to the panel) and as another diagram is
shown. The panel sends the kept views with every `load`; the canvas
restores one at once (`Canvas.load(set, settings, view)`, no turn
animated), else fits the pages. A reload of the diagram shown (a
schema edit) keeps the view it has. A renamed diagram starts fitted.

Pruned, so the state does not grow and a new diagram of an old name
starts fitted:
- every model read (`ModelerPanel.#load`, `DiagramViews.prune`) drops
  the views of diagrams the source no longer has - the extension has no
  delete or rename of a diagram, so this is where one made in msm or on
  disk shows;
- New Schema Diagram drops any view kept under the new name (`forget`);
- deleting a connection drops all its schemas' views, and taking a
  project off the MSM Projects list (`MsmCommands` host
  `projectRemoved`) drops the project's (`forgetSources`, with
  `isConnectionSourceKey` / `projectSourceKey` from `modelSources.ts`,
  which build the keys).

A diagram deleted and made again under its name outside VS Code, while
no viewer of its source reads the model, still opens as the old one was
left. Not done: a view changed in the last 500 ms before the panel
closes is not kept.

## Shortcuts

Space + drag pans (hand tool too); Space + Cmd + click zooms in, with Alt
out (by `ZOOM_STEP`, 1.25); Z + click zooms in, Alt + Z out (zoom tool too); Cmd/Ctrl + wheel or
a pinch zooms about the cursor, a plain wheel pans; Cmd/Ctrl + 0 fits,
Cmd/Ctrl + 1 is 100%; Cmd + drag orbits; Option + drag on a layer (3D)
raises it; Shift or Cmd + click toggles the selection. Modifiers are read
off every event (macOS swallows keyups while Cmd is down); Space and Z
are dropped when Cmd goes up, on blur and when hidden.
