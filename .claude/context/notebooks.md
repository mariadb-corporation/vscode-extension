# MariaDB Notebooks

Notebooks on VS Code's own notebook API: a `.mariadb-notebook` file, one
kernel that runs SQL cells on the notebook's connection, and a renderer
that draws a result set under its cell with the panel's result grid.

Part of [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md). How a script runs is
in [running-sql.md](running-sql.md); the grid itself in
[result-grid.md](result-grid.md).

They replace the MySQL Shell's DB Notebooks, which were a Monaco editor
with its blocks hacked in. That one ran SQL and TypeScript blocks, the
language switched by hand; drew result sets, JSON and graphs under each
block; and fed the current REST service's TypeScript SDK to Monaco. This
is **step 1** of rebuilding it: SQL cells and read-only result sets. Still
to come, in order: telling SQL from TypeScript as it is typed (a cell
switched with `languages.setTextDocumentLanguage`, and left alone once the
user picked its language); TypeScript run in a worker with the old
runtime's `print`, `runSql`, `$`; a TypeScript server plugin giving the
cells the runtime's and the REST SDK's typings, and one another's
declarations; a graph renderer; the REST SDK generated and reloaded live;
editing in the grid through renderer messaging. None of it needs Monaco.

## Files

| File | What it is |
| --- | --- |
| `src/notebook/notebookFormat.ts` | The file's JSON shape, `parseNotebook` / `serializeNotebook`, and `outputsOf`: a run's report turned into a cell's outputs. Free of `vscode`. |
| `src/notebook/notebookSerializer.ts` | The `NotebookSerializer`, and `toCellOutput`, which the controller shares. |
| `src/notebook/notebookConnection.ts` | `notebookOf` (the MariaDB Notebook a cell document is in), the connection in the metadata, setting it, and `openNewNotebook`. |
| `src/notebook/notebookController.ts` | The one kernel, `mariadb-notebook-kernel`, labelled **MariaDB**. |
| `webview/src/notebookRenderer.tsx` | The renderer (`mariadb.resultSetRenderer`) for `application/vnd.mariadb.resultset+json`. |
| `webview/src/notebookRenderer.css` | Tabulator's stylesheet, the codicons and `resultGrid.css`, plus the frame around a grid. |
| `vite.notebook.config.ts` | Its build: `dist/webview/notebookRenderer.js` / `.css`, the assets under `dist/webview/notebook/`. |

## The file

Indented JSON with a trailing newline, so a saved notebook diffs line by
line: `{ version: 1, connection?, cells: [{ kind: "code" | "markdown",
language?, source, outputs? }] }`. An empty file is an empty notebook (a
file created on disk); one of a later `version` is refused. Outputs are
saved (`transientOutputs: false`), so a reopened notebook shows its last
results: an output item of a JSON type is saved as JSON - a result set
reads as one in the file - anything else as text. The execution order and
timing are not saved.

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

`outputsOf` turns the report into outputs in statement order: each result
set an output of its own (a procedure's every set); what the statements
between them said - `Query OK, 1 row affected`, and each warning as
`Warning 1265: ...` - gathered into one `stdout` stream; an error a
`stderr` stream. A cell with a failing statement ends unsuccessful. A
failure to run at all (no shell, a connection that will not open) is the
cell's `stderr` and is logged, not notified: the cell already says it.

## The renderer

VS Code imports the module into the notebook's output webview and calls
its `activate` export, so the build keeps the entry's exports
(`preserveEntrySignatures: "exports-only"`) - an app build drops them.
There is no page of ours: the stylesheet is linked into the webview's head
from beside the module (`new URL("notebookRenderer.css",
import.meta.url)`), once, and the icons and codicon font resolve beside it.
Nothing in it may style the page: the output webview is shared by every
output of the notebook.

Each result set is the panel's `ResultGrid`, with `editable` forced off,
in a frame of a fixed height - Tabulator draws rows lazily and needs one -
grown with its rows (header 42px, a row 24px) up to 360px, past which the
rows scroll. Under it the result set's status, and "the first N rows"
where the server holds more; paging is not there yet.

`resultGrid.css` is the tail that was `styles.css` - Tabulator retyped in
the theme and the grid's cells - split off so the renderer can load it
without the panel's `html` and `body` rules. The panel imports it right
after `styles.css`, so its `main.css` came out byte for byte the same.

## Keybindings

The run commands' keybindings and their editor context menu items carry
`!notebookEditorFocused`: in a SQL cell, `editorLangId` is `mariadb-sql`,
and the extension's bindings - which win over VS Code's - would take
Cmd/Ctrl+Enter and Shift+Enter from the notebook's own Execute Cell and
send the cell to the panel. `keybindings.test.ts` checks every one.

## Known gaps

- Read only: the grid's menu and its Open / Save buttons do nothing.
- No paging, and no maximizing a result into a tab.
- No interrupt: a running cell runs to its end.
- SQL cells only; the TypeScript steps above.
- Not yet exercised in a real VS Code: the unit tests cover the format,
  the kernel, the binding and the renderer's output, but not that the
  output webview loads the stylesheet and Tabulator lays out in it.
