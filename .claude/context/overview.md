# MariaDB Overview

The MariaDB Overview editor tab: a welcome text headed "MariaDB Workbench"
and a tile per connection and folder, after the MySQL Shell for VS Code's
DB Connection Overview (`gui/frontend/src/modules/db-editor/ConnectionBrowser.tsx`
and `components/ui/ConnectionTile/` in mysql-shell-plugins).

Part of [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md).

| File | Purpose |
| --- | --- |
| `src/overview/overviewModel.ts` | The snapshot the page shows (every connection, the folders made with New Folder), and walking it: `folderContents`, `existingFolder`, `parentFolder`, `folderTrail`. Pure; shared by the webview and the host. |
| `src/overview/overviewProtocol.ts` | The messages: `connections` / `failed` to the page; `ready`, `open`, `newConnection`, `connectionAction`, `closeGreeting` from it. |
| `src/overview/overviewPanel.ts` | `OverviewPanel` (one at a time, on `DialogPanel`), `IOverviewHost`, and `overviewSnapshot`, which turns the stored connections into the snapshot. |
| `webview/src/OverviewPage.tsx` | The page; `overview.tsx` is its entry (not `Overview.tsx`: macOS's file system is case-insensitive), `overviewStyles.css` its styles, `assets/overview/` the MySQL Shell's icons, `vite.overview.config.ts` its build. |

## What the user decided

- **It opens with the view**, as the MySQL Shell's did: the first time the
  Connections view is shown in a window - its activity bar entry opened,
  or the window coming up with it open - and only then.
  `mariadb.overview.showOnStartup` (default true) turns that off; the
  view's toolbar (`$(home)`) and **MariaDB: Show MariaDB Overview**
  (`mariadb.showOverview`) open it any time.
- **The welcome text** is the MySQL Shell's, its DB Notebook paragraph
  dropped and "a new DB Notebook" made "a new SQL editor"; logo
  `images/mariadb-shell-ext.svg`, title "MariaDB Workbench". Its × sets
  `mariadb.overview.showGreeting` to false (globally); the setting turns it
  back on, on an open page too. The MySQL Shell's Learn More /
  Documentation links are left out: there is no public documentation to
  link to yet.
- **The tiles** are the MySQL Shell's: 270 x 80, its colors (dark and
  light, by VS Code's `vscode-light` body class, since VS Code's themes
  have no tile colors), folders orange, Back and New Connection grey. A
  Back tile in a folder, folders first, then connections, then New
  Connection, which files the new one in the folder shown. Above them,
  "Database Connections" and a breadcrumb, `/` and a step per folder.
- **A click on a connection's tile opens a SQL editor** on it
  (`mariadb.newSqlEditor`). Hovering shows the actions column at its right:
  More Actions, Create New Notebook - drawn at 35% and disabled until DB
  Notebooks exist (the host refuses `editor: "notebook"` too) - and Open
  New SQL Editor. More Actions has Edit Connection…, Copy Connection URI
  and Delete Connection…, the Connections view's own commands.

## Decisions

- **The page walks the folders itself.** The host sends every connection
  and folder at once, so going into a folder costs no message. It sends
  again on `ready` and whenever the Connections view redraws, the default
  connection changes or a `mariadb.overview` setting does; a listing
  overtaken by a newer one is dropped.
- **A folder that goes away** (moved, renamed, emptied) leaves the page in
  the nearest folder above it still there. The folder shown is kept with
  the webview's state, across a reload of it.
- **Tiles are `div role=button`**, not buttons: their actions are buttons,
  and a button cannot hold another. A click is ignored for 200 ms after
  one, as the MySQL Shell did, so a double click opens one editor. A
  focused tile opens on Enter or Space, and `A` opens its menu.
- **The host acts through the Connections view's commands**, handed a
  node it builds from the stored connection (`overviewNode` in
  `extension.ts`); a connection that is gone by then is reported, as a
  command's failure is.
- **A connection's color** is its tile's left edge, in
  `--vscode-charts-<color>`.

## UI tests

`00-startup` checks the overview opens with the view, with its greeting
and only New Connection. `01-sandbox`, first in every other suite, starts
with `dismissOverview`: it shows the Connections view, waits for the
overview and closes it. Left to itself, the overview opened whenever a
test first showed that view - in `lsp`, over the New Sandbox dialog the
test was in. Where it is open, the helpers
enter a webview by the frame that is shown in the area asked for
(`frameShownIn` in `ui-test/lib/ui.ts`): ExTester's own `WebView` went into
the hidden overview's frame instead of a dialog's, and its `WebviewView`
measures the whole workbench, so the result panel's view went into the
overview too.

## Known gaps

- No DB Notebooks: the notebook action is a placeholder.
- No dragging: the MySQL Shell's tiles were draggable, but its reordering
  was switched off and its drop only made SQLite connections.
- No Duplicate Connection, which the MySQL Shell's menu had: the
  connection editor cannot start from a copy yet.
