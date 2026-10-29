# MariaDB Overview

The MariaDB Overview editor tab (its tab says just "Overview"): a welcome text headed "MariaDB Workbench"
and a tile per connection and folder, after the MySQL Shell for VS Code's
DB Connection Overview (`gui/frontend/src/modules/db-editor/ConnectionBrowser.tsx`
and `components/ui/ConnectionTile/` in mysql-shell-plugins).

Part of [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md).

| File | Purpose |
| --- | --- |
| `src/overview/overviewModel.ts` | The snapshot the page shows (every connection, the folders made with New Folder) and the deployments, and walking either: `folderContents`, `existingFolder` (generic over anything with a `path`), `folderTrail`. Pure; shared by the webview and the host. |
| `src/overview/overviewProtocol.ts` | The messages: `greeting`, `connections`, `deployments`, `failed` (with its `section`) to the page; `ready`, `open`, `newConnection`, `connectionAction`, `newDeployment`, `deploymentCommand`, `closeGreeting` from it. |
| `src/overview/overviewPanel.ts` | `OverviewPanel` (one at a time, on `DialogPanel`), `IOverviewHost`, and `overviewSnapshot`, which turns the stored connections into the snapshot. |
| `webview/src/OverviewPage.tsx` | The page; `overview.tsx` is its entry (not `Overview.tsx`: macOS's file system is case-insensitive), `overviewStyles.css` its styles, `assets/overview/` the MySQL Shell's icons, `vite.overview.config.ts` its build. |

## What the user decided

- **It opens with the view**, as the MySQL Shell's did: the first time the
  Connections view is shown in a window - its activity bar entry opened,
  or the window coming up with it open - and only then.
  `mariadb.overview.showOnStartup` (default true) turns that off; the
  view's toolbar (`$(home)`) and **MariaDB: Show MariaDB Overview**
  (`mariadb.showOverview`) open it any time.
- **The welcome text** is the first line of the MySQL Shell's alone,
  "Welcome to the MariaDB Shell for VS Code extension." (the user dropped
  the rest); logo
  `images/mariadb-shell-ext.svg`, title "MariaDB Workbench". Its × sets
  `mariadb.overview.showGreeting` to false (globally); the setting turns it
  back on, on an open page too. The MySQL Shell's Learn More /
  Documentation links are left out: there is no public documentation to
  link to yet.
- **The tiles** are the MySQL Shell's: 270 x 80, its colors (dark and
  light, by VS Code's `vscode-light` body class, since VS Code's themes
  have no tile colors). Folders are not the MySQL Shell's bright orange
  (the user's call): an uncolored folder is plain grey, as Back is, so it
  can never be mistaken for a colored one - a yellow default, tried first,
  looked like a folder colored Yellow. A folder the user gave a color is a
  TINT: that chart color mixed into the editor background with `color-mix`
  (15% fill, 50% border), the text in the theme's foreground, so it is calm
  in any theme; the page sets it as `--tile-color` on the tile. New
  Connection is an outline: a dashed border over a faint grey (25%, mixed
  with `transparent`), so it blends into the window. A
  Back tile in a folder, folders first, then connections, then New
  Connection, which files the new one in the folder shown. Above them,
  "Database Connections" and a breadcrumb, `/` and a step per folder.
- **A click on a connection's tile opens a SQL editor** on it
  (`mariadb.newSqlEditor`). Hovering shows the actions column at its right:
  More Actions, Create New Notebook - drawn at 35% and disabled until DB
  Notebooks exist (the host refuses `editor: "notebook"` too) - and Open
  New SQL Editor. More Actions has Edit Connection…, Copy Connection URI
  and Delete Connection…, the Connections view's own commands.

- **Database Deployments**, a second section below the connections: the
  Deployments view's folders and sandboxes, walked the same way (its own
  breadcrumb and Back, its folder kept in the webview state too) and a
  New Deployment tile that opens the wizard (`mariadb.newDeployment`). A
  sandbox's tile is `localhost:<port>` with its version and state, and its
  REST Daemon's (`REST Daemon running`; `2 REST Daemons` for more) - the
  daemons get no tiles of their own (the user's call). Its icon is its
  row's (`sandboxIcon`: `vm-running` in `testing.iconPassed`,
  `vm-outline`, `loading~spin` while busy). **A click opens its menu**
  (the user's call), below the tile: the commands its row's menu has now,
  then each REST Daemon's, a group apiece, titled as in the view (a port
  added where a sandbox has several daemons). **The host works the menu
  out**, from `sandboxCommandIds` / `restdCommandIds` beside the rows'
  `contextValue` (`rowCommands.test.ts` holds them to package.json's
  `when` clauses) and the manifest's titles; the page only draws it. A
  pick sends `deploymentCommand` with the command id; the host finds the
  row in the same listing, runs the command only if the row offers it
  now (the page may be older than the row's state), on that row.

## Decisions

- **The page is never blank while it waits.** On `ready` the host sends
  `greeting` (whether the welcome text is shown) before it lists the
  connections, which can wait for the server to start; the welcome text
  and the "Database Connections" heading show at once, with "Looking for
  MariaDB connections..." under them until the tiles come. `greeting` is
  the only message that carries it, sent again when
  `mariadb.overview.showGreeting` changes - with no listing.
- **The deployments are a listing of their own**:
  `DeploymentsTreeProvider.listFolders()` (which the view's own listing
  wraps, its welcome content saying what failed), turned into tiles by
  `overviewDeployments`. The host sends `deployments` on `ready`, beside
  the connections and not after them, and whenever the Deployments view
  redraws; `failed` with `section: "deployments"` says why it could not.
  One routine (`#sendListing`) lists and sends either section, a newer
  listing of it winning. On the page both are one `Section` component
  (heading and breadcrumb, messages, Back, folders, the items, the "New"
  tile), a `<section aria-label>` the UI test finds by name.
- **The page walks the folders itself.** The host sends every connection
  and folder at once, so going into a folder costs no message. It sends
  again on `ready`, whenever the whole Connections view is redrawn (a
  row's own redraw - a folder opening, a connection connecting - changes
  nothing it shows, so it is ignored) and when the default connection
  changes; a listing overtaken by a newer one is dropped.
- **A section starts in its one item's folder** (the user's call): until
  the user picks a folder in it (a folder tile, Back, the breadcrumb), a
  section with exactly one connection or deployment shows that one's
  folder (`startingFolder`), so the sandbox a first deployment made and
  its connection, both under `/Sandboxes`, are a click away. Once it has
  landed there it stays, as if the user had picked it, so a second item
  does not throw it back to the top level. An unpicked folder is saved
  as none in the webview state.
- **A folder that goes away** (moved, renamed, emptied) leaves the page in
  the nearest folder above it still there. The folder shown is kept with
  the webview's state, across a reload of it.
- **Tiles are `div role=button`**, not buttons: their actions are buttons,
  and a button cannot hold another. A click is ignored for 200 ms after
  one, as the MySQL Shell did, so a double click opens one editor. A
  focused tile opens on Enter or Space, and `A` opens its menu.
- **The host acts through the Connections view's commands**, handed the
  node the view itself would build (`connectionNodeOf` in
  `connectionsModel.ts`, called by `overviewNode` in `extension.ts`); a
  connection that is gone by then is reported, as a command's failure is.
  What a folder holds is `subfoldersOf` (`connectionFolders.ts`), the
  view's own test.
- **A connection's picture is the Connections view's icon**:
  `overviewSnapshot` takes `connectionIconFor(uri, isDefault)`, so a tile
  has the MariaDB or MySQL icon, its SSH variant for `mariadb+ssh://` and
  `mysql+ssh://`, MySQL's for `mysqlx://`, and the default connection's
  marked one. The page draws it as a mask (`overview-icon-<file>`, one
  class per file under `images/light`) in the tile's text color. A test
  fails where `connectionIconFor` can give an icon with no class. An
  inline `mask-image` with the file's URL was weighed: an inline style's
  URL resolves against the page, not `dist/webview`, so it would work
  only while Vite inlines the files.
- **A tile's color** is one CSS variable, `--tile-color`, set to
  `--vscode-charts-<color>`: a connection draws it down its left edge, a
  folder tints its whole tile with it (above).
  Folder colors come with the snapshot (`folderColors`), from the
  extension's `FolderColors`.

## UI tests

`ui-test/settings.json` sets `mariadb.overview.showOnStartup` to false:
left to itself, the overview opened whenever a test first showed the
Connections view - in `lsp`, over the New Sandbox dialog the test was in.
`00-startup` opens it by its command and checks its greeting and the lone
New Connection tile, then closes it; opening with the view is a unit
test's. Where an editor webview and another are open, the helpers
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
