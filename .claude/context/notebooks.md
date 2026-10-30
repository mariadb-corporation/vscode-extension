# MariaDB Notebooks

Notebooks on VS Code's own notebook API: a `.mariadb-notebook` file, one
kernel that runs SQL and TypeScript cells - a cell's language following
what is typed in it - on the notebook's connection, and a renderer that
draws a cell's result sets under it as the MariaDB panel does - a tab
each, with the result set toolbar: paging, editing, the SQL preview,
refresh, the values.

Part of [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md). How a script runs is
in [running-sql.md](running-sql.md); the grid itself in
[result-grid.md](result-grid.md).

They replace the MySQL Shell's DB Notebooks, which were a Monaco editor
with its blocks hacked in: SQL and TypeScript blocks, the language
switched by hand; result sets, JSON and graphs under each block; the
current REST service's TypeScript SDK fed to Monaco. Here SQL cells show
their result sets in the panel's own view, and TypeScript cells run in a
worker with the old runtime - `print`, `runSql`, the graphs, the REST
client SDK - typed in the editor by a TypeScript server plugin. None of it
needs Monaco. The TypeScript side - a cell's language, the runtime, the
graphs, the editor's typings, the SDK - is in
[notebook-typescript.md](notebook-typescript.md).

## Files

| File | What it is |
| --- | --- |
| `src/notebook/notebookFormat.ts` | The file's JSON shape, `parseNotebook` / `serializeNotebook`, and `outputsOf`: a run's report turned into a cell's outputs. Free of `vscode`. |
| `src/notebook/notebookSerializer.ts` | The `NotebookSerializer`, and `toCellOutput`, which the controller shares. |
| `src/notebook/notebookConnection.ts` | `cellOf` / `notebookOf` (the MariaDB Notebook cell a document is, found by the notebook's path first: asked on every keystroke in a SQL cell), the connection in the metadata, setting it, and `openNewNotebook`. |
| `src/notebook/notebookController.ts` | The one kernel, `mariadb-notebook-kernel`, labelled **MariaDB**: SQL cells, and TypeScript cells through the `ScriptRunner`. |
| `src/notebook/notebookProtocol.ts` | The result output's payload (`INotebookResultPayload`), the messages between a view and the extension, and `notebookViewState`, the state a view shows, which the extension and the renderer both build. Free of `vscode`. |
| `src/notebook/notebookResults.ts` | `NotebookResults`: the renderer messaging, the views of this session's cells, taking up a reopened notebook's, and refresh. |
| `webview/src/notebookRenderer.tsx` | The renderer (`mariadb.resultSetRenderer`) for `application/vnd.mariadb.resultset+json`: the panel's `App` per output. |
| `webview/src/notebookRenderer.css` | `styles.css` and `resultGrid.css`, as the panel loads them, plus the frame around a view. |
| `vite.notebook.config.ts` | Its build: `dist/webview/notebookRenderer.js` / `.css`, the assets under `dist/webview/notebook/`, and `styles.css` scoped to the view. |

## The file

Indented JSON with a trailing newline, so a saved notebook diffs line by
line: `{ version: 1, connection?, cells: [{ kind: "code" | "markdown",
language?, source, languagePinned?, outputs? }] }`; `languagePinned` is
a cell's metadata in the notebook (see
[notebook-typescript.md](notebook-typescript.md)). An empty file is an empty notebook (a
file created on disk); one of a later `version` is refused. Outputs are
saved (`transientOutputs: false`), so a reopened notebook shows its last
results: an output item of a JSON type is saved as JSON - a result set
reads as one in the file - anything else as text. The execution order and
timing are not saved. Saved outputs are read as untrusted: an output
without an `items` array, or an item without a string `mime` and either
string `text` or a `json` key, is left out, so a hand-edited or
merge-damaged file still opens.

## The connection

**One per notebook**, in its metadata (`connection`), so it is saved with
it and picking it is an edit that can be undone. Without one, the
notebook runs on the default connection; with neither, the first run asks
and records the answer. Picked with **Select Connection** (`$(database)`)
in the notebook toolbar or from the status bar entry, which shows the
notebook's connection while a MariaDB Notebook is the active editor.

`SqlEditorBinding.connectionFor` answers a cell's document with its
notebook's connection, which is what the language server, the ANSI_QUOTES
highlighting and the status bar all ask: so a SQL cell gets completion
against the notebook's connection without anything of its own.
`selectConnection` on a cell picks for its notebook. A change of the
metadata - a pick, or undoing one - fires `onDidBindConnection`, which the
language server re-sends each document's connection on.

## Running a cell

The kernel supports `mariadb-sql` only, so far. A cell runs as a script,
as a SQL file does - every statement, stopping at the first that fails
where `mariadb.stopOnError` is set - through
`SqlEditorBinding.executeScript`: the part of a run the panel and a cell
share (open the connection, split by its sql_mode, follow a `USE`, tell
the run listeners - so DDL in a cell redraws the Connections view). Nothing
goes to the MariaDB panel.

`outputsOf` turns the report into outputs: what the statements without a
result set said - `Query OK, 1 row affected`, and each warning as
`Warning 1265: ...` - gathered into one `stdout` stream; each error a
`stderr` stream; and then, where there were any, **all the result sets in
one output** (`INotebookResultPayload`: a view id, the connection, the
sets), which the renderer draws with a tab each. A cell with a failing
statement ends unsuccessful. A failure to run at all (no shell, a
connection that will not open) is the cell's `stderr` and is logged, not
notified: the cell already says it. `#run` starts the execution and wraps
everything after it (`#runCell`): whatever throws around the run - the
connection pick, the worker's start, an output that cannot be appended -
ends the cell with the error, never leaves it spinning.

**One run at a time per notebook.** VS Code calls `executeHandler` for
each run gesture as it is made, even while another still runs; `#queue`
chains each call after the notebook's run under way, so a cell run during
another waits rather than failing (the `ScriptRunner` refuses a second
cell) or sharing the session with it. An interrupt bumps the notebook's
counter, and cells that were still waiting end unrun (`end(undefined)`).

## The result view under a cell

It is the panel's `App`, a third time after the panel and a maximized tab
(see [result-set.md](result-set.md)): `IViewState.notebook` drops the
Actions tab, the pickers and Clear, and the result set toolbar loses
Maximize and Close Result Set - a result set stays with its cell. Paging,
Start Editing / Add Row / the SQL preview / Apply / Rollback, Refresh,
Freeze Primary Key Columns, Show Column Data Types and the values (open
in an editor beside the notebook, save, load) all work as in the panel.

**The messaging.** `App` takes an `IHostTransport`; under a cell it is the
renderer's (`requiresMessaging: "optional"`). Every output of a notebook
hears every message, so each says which view it is for - the payload's
`viewId`, a random UUID: a reopened notebook's outputs carry the ids of a
session long gone, and run ids start again at `run1`. On `ready` the
renderer shows the output's own state at once and sends it along as the
`seed`; the extension answers with the state it holds.

**The extension side.** A run registers its view with `NotebookResults`
(the connection, the session it ran on as its apply context, the result
sets), replacing the one the cell's last run left; a deleted cell's and a
closed notebook's go. Each message is handed to
`ResultViewProvider.onNotebookMessage`, which does what the panel and a
maximized tab do - `#applyChanges`, `#fetchPage`, `#onShared` - so an
apply or a page is a row of the connection's actions in the panel too;
what is the view's own it asks of the view (`INotebookResultView`:
`connect`, `refresh`). **Refresh** is the notebook's own: it re-runs the
statement through `executeScript` and puts the result in the same tab
under its caption, with a new id so the grid starts afresh; a failure is
the grid's error bar. A view the extension does not know - a reopened
notebook's - is taken up from its seed, and connects (`connections.connect`
on the URI, so the editors' session) the first time it applies or pages.
Without messaging - a notebook that gives the renderer none - the view
shows the result sets read only.

**Its stylesheet.** The output webview is VS Code's page, shared by every
output of the notebook, so `styles.css` cannot go in as it is: it styles
`html`, `body` and every `button`. The renderer build scopes it with a
small PostCSS step (`scopeResultView`, `vite.notebook.config.ts`): a rule
for `html`, `body` or `#root` lands on the view's element
(`.mariadbResultView`), every other one only applies inside it, both
under `:where()` so no rule weighs more against another than in the
panel. Only styles.css's own rules are touched, not Tabulator's or the
codicons'. The panel's `main.css` is not built through it.

**Its height.** The view starts as tall as its longest result set
(header 42px, 24px a row, 64px for the toolbar and the tabs), between
130px - the header, one row and the bars - and 240px, so switching tabs
does not make the cell jump; it can be
dragged taller or shorter (`resize: vertical`), and Tabulator follows.

`resultGrid.css` is the tail that was `styles.css` - Tabulator retyped in
the theme and the grid's cells - split off in step 1; the panel imports
it right after `styles.css`, so its `main.css` came out byte for byte the
same.

## Keybindings

The run commands' keybindings and their editor context menu items carry
`!notebookEditorFocused`: in a SQL cell, `editorLangId` is `mariadb-sql`,
and the extension's bindings - which win over VS Code's - would take
Cmd/Ctrl+Enter and Shift+Enter from the notebook's own Execute Cell and
send the cell to the panel. `keybindings.test.ts` checks every one.

## Known gaps

- The saved output keeps the result sets as the cell's run left them:
  another page, a refresh or applied edits show until the notebook is
  closed, and it reopens on the run's first page.
- No maximizing a result set into a tab of its own.
- A SQL cell cannot be interrupted: it runs to its end.
- A reopened notebook's view taken up from its seed has no cell, so
  re-running or deleting that cell does not forget it: it stays (with its
  connected session) until the notebook closes. Fixing it needs the
  renderer to send its cell with `ready`.
- Not yet exercised in a real VS Code: the unit tests cover the format,
  the kernel, the views' messages, the renderer's output under jsdom, the
  language switching against a mock, the worker's runtime in-process (and
  the built worker was run from Node), the graphs under jsdom, and the
  plugin in a real TypeScript server, but not the output webview's layout
  or how a switched cell's editor behaves.
