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
with its blocks hacked in. That one ran SQL and TypeScript blocks, the
language switched by hand; drew result sets, JSON and graphs under each
block; and fed the current REST service's TypeScript SDK to Monaco. Done
so far: SQL cells and their result sets in the panel's own view; a cell's
language told from what is typed in it; TypeScript cells run in a worker
with the old runtime's `print`, `runSql` and `$`. Still to come, in
order: a TypeScript server plugin giving the cells the runtime's and the
REST SDK's typings, and one another's declarations; a graph renderer
(`Graph`, `PieGraph`); the REST SDK generated and reloaded live. None of it
needs Monaco.

## Files

| File | What it is |
| --- | --- |
| `src/notebook/notebookFormat.ts` | The file's JSON shape, `parseNotebook` / `serializeNotebook`, and `outputsOf`: a run's report turned into a cell's outputs. Free of `vscode`. |
| `src/notebook/notebookSerializer.ts` | The `NotebookSerializer`, and `toCellOutput`, which the controller shares. |
| `src/notebook/notebookConnection.ts` | `notebookOf` (the MariaDB Notebook a cell document is in), the connection in the metadata, setting it, and `openNewNotebook`. |
| `src/notebook/notebookController.ts` | The one kernel, `mariadb-notebook-kernel`, labelled **MariaDB**: SQL cells, and TypeScript cells through the `ScriptRunner`. |
| `src/notebook/languageDetection.ts` | `detectLanguage`: SQL or TypeScript from how a cell starts, or undecided. Free of `vscode`. |
| `src/notebook/languageSwitcher.ts` | `LanguageSwitcher`: switches a cell as it is typed, and pins one whose language was picked by hand. |
| `src/notebook/scriptRunner.ts` | `ScriptRunner`: a worker thread per notebook, one cell at a time, interrupting. |
| `src/notebook/scriptSandbox.ts` | The worker's runtime: the cell compiled (sucrase), run in a `vm` context kept across cells, `print` / `runSql` / `$` / `console`. Free of the worker API. |
| `src/notebook/scriptWorker.ts` | The worker's entry, wiring its port to the sandbox; built to `dist/notebookWorker.js` by `vite.worker.config.ts`. |
| `src/notebook/scriptProtocol.ts` | What the runner and a worker say to each other. |
| `src/notebook/notebookProtocol.ts` | The result output's payload (`INotebookResultPayload`) and the messages between a view and the extension. Free of `vscode`. |
| `src/notebook/notebookResults.ts` | `NotebookResults`: the renderer messaging, the views of this session's cells, taking up a reopened notebook's, and refresh. |
| `webview/src/notebookRenderer.tsx` | The renderer (`mariadb.resultSetRenderer`) for `application/vnd.mariadb.resultset+json`: the panel's `App` per output. |
| `webview/src/notebookRenderer.css` | `styles.css` and `resultGrid.css`, as the panel loads them, plus the frame around a view. |
| `vite.notebook.config.ts` | Its build: `dist/webview/notebookRenderer.js` / `.css`, the assets under `dist/webview/notebook/`, and `styles.css` scoped to the view. |

## The file

Indented JSON with a trailing newline, so a saved notebook diffs line by
line: `{ version: 1, connection?, cells: [{ kind: "code" | "markdown",
language?, source, languagePinned?, outputs? }] }`; `languagePinned` is
a cell's metadata in the notebook (see below). An empty file is an empty notebook (a
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

`outputsOf` turns the report into outputs: what the statements without a
result set said - `Query OK, 1 row affected`, and each warning as
`Warning 1265: ...` - gathered into one `stdout` stream; each error a
`stderr` stream; and then, where there were any, **all the result sets in
one output** (`INotebookResultPayload`: a view id, the connection, the
sets), which the renderer draws with a tab each. A cell with a failing
statement ends unsuccessful. A failure to run at all (no shell, a
connection that will not open) is the cell's `stderr` and is logged, not
notified: the cell already says it.

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
sets), replacing the one the cell's last run left; a closed notebook's go.
Each message is handed to `ResultViewProvider.onNotebookMessage`, which
does what the panel and a maximized tab do - `#applyChanges`, `#fetchPage`,
`#onShared` - so an apply or a page is a row of the connection's actions
in the panel too. **Refresh** is the notebook's own: it re-runs the
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

## A cell's language

A code cell is SQL (`mariadb-sql`) or TypeScript, and follows what is
typed in it: `LanguageSwitcher` looks at a cell once typing pauses
(300ms) and switches it with `languages.setTextDocumentLanguage` where
`detectLanguage` is sure, and leaves it as it is where it is not - a bare
word, `set` alone, an empty cell. A new cell starts in the language of the
one above it, which VS Code does itself. The kernel looks once more before
a cell runs, so one run before typing paused runs in its right language.

`detectLanguage` goes by how a cell starts, its leading comments dropped:
`--` and `#` comments say SQL, `//` TypeScript, `/*!` is SQL to run. A
word only TypeScript starts with (`const`, `await`, `import`, `print`,
`runSql`, ...) or a literal, a block, `$` say TypeScript; a statement
keyword says SQL. The words both start with are told apart by what
follows: `DELETE FROM` / `delete obj.key`, `SET @a` / `set(...)`, `DO 1` /
`do {`, and a statement keyword called or read as a property
(`select(...)`, `update.count`) is TypeScript. A name used - called, read,
assigned - is TypeScript; `(SELECT` is SQL, any other `(` TypeScript.

**Picked by hand, a cell is left alone**: its metadata gets
`languagePinned`, saved with the notebook. VS Code closes a cell's
document and opens it again when its language changes; one that comes back
in another language than the switcher last saw or switched it to was
changed in the language picker.

## TypeScript cells

Run in a **worker thread per notebook** (`ScriptRunner`), one cell at a
time: `dist/notebookWorker.js`, a bundle of its own so the transpiler
(**sucrase**, which strips the types - all a cell needs, a fraction of the
TypeScript compiler's size) is only loaded once a TypeScript cell runs. A
cell's code is the body of an async function opened on its first line
(`compileCell`): it can `await` and `return` at the top, and a stack's
lines are the cell's; frames past its last line - the wrapper's call - and
outside it are cut, and a syntax error's first-line column is the cell's.

It runs in a `vm` context kept across the notebook's cells, with:

- `print(...values)` - text as a stream, a value JSON can hold as JSON
  (`application/json`, with a `text/plain` copy), anything else as Node
  renders it. Shown as it is printed: consecutive text is one stream
  output.
- `runSql(sql)` - runs on the notebook's connection
  (`SqlEditorBinding.queryRows`) and answers the first result set's rows,
  an object a row, every one of them, not a page; rejects with the first
  failing statement's error. The connection is asked for only once a cell
  runs SQL. The run listeners are told, so DDL redraws the Connections view.
- `$` - an object the cells share, as in the MySQL Shell's notebooks. A
  cell's own declarations are its function's, so they do not carry over.
- `console.log/info/debug` to stdout, `console.warn/error` to stderr;
  timers, `fetch`, `URL`, `TextEncoder`/`Decoder`, `structuredClone`.

**Interrupt** ends the notebook's worker: the cell is told so, and the next
one starts on a fresh worker, `$` empty. A closed notebook's worker goes
too. The context is no sandbox: the code is the user's own, with Node a
constructor away, and the extension runs only in trusted workspaces.

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
- A TypeScript cell's editor does not know `print`, `runSql` or `$` yet,
  and marks them: their typings are the next step.
- `runSql` takes no parameters yet.
- The watch task does not rebuild the worker; `npm run build` (and F5)
  does.
- Not yet exercised in a real VS Code: the unit tests cover the format,
  the kernel, the views' messages, the renderer's output under jsdom, the
  language switching against a mock, and the worker's runtime in-process
  (and the built worker was run from Node), but not the output webview's
  layout or how a switched cell's editor behaves.
