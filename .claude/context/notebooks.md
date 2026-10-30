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
with the old runtime's `print` and `runSql`, and its graphs (`Graph`,
`PieGraph`); a TypeScript server plugin giving the cells the runtime's
typings; the REST client SDK of the connection's current REST service,
run in the cells, its typings in the editor, built again as the REST
metadata changes. None of it needs Monaco.

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
| `src/notebook/scriptSandbox.ts` | The worker's runtime: the cell compiled (sucrase), run in a `vm` context kept across cells, `print` / `runSql` / `console`. Free of the worker API. |
| `src/notebook/scriptWorker.ts` | The worker's entry, wiring its port to the sandbox; built to `dist/notebookWorker.js` by `vite.worker.config.ts`. |
| `src/notebook/scriptProtocol.ts` | What the runner and a worker say to each other: the cells, their SQL, the REST SDK (`INotebookSdk`) and the host calls (`HostCall`). |
| `src/notebook/notebookSdk.ts` | `NotebookSdk`: a connection's REST client SDK, built and kept; making a service current; asking for a login; `publishSdkTypings`. |
| `src/notebook/trustingFetch.ts` | The `fetch` a cell has once the SDK is loaded: HTTPS to this machine trusting the shell's local certificate authority. |
| `webview/src/graphs/renderGraph.ts` | `renderGraph`: a graph's options, as a cell sent them, drawn as plain SVG - pie, line and bar series. |
| `webview/src/graphs/graphMath.ts` | Their arithmetic: round ticks and domains, linear and time scales, bands, pie angles and arc paths, line curves, number formats. Free of the DOM. |
| `ts-plugin/` | The TypeScript server plugin (`mariadb-notebook-ts-plugin`), its own package: `index.js`, and `typings.js`, the runtime's typings as the editor knows them. |
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
`runSql`, ...), a literal, a block or a name starting with `$` say
TypeScript; a statement keyword says SQL. The words both start with are told apart by what
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
TypeScript compiler's size) and the parser (**acorn**) are only loaded
once a TypeScript cell runs. A
cell's code is the body of an async function opened on its first line
(`compileCell`): it can `await` and `return` at the top, and a stack's
lines are the cell's; frames past its last line - the wrapper's call - and
outside it are cut. What compiling put in front on a line - the wrapper on
the first, `return (` on the last expression's - is taken back out of a
frame's column (`ICompiledCell.shifts`), and out of a syntax error's on
the first line. Sucrase keeps the lines but not the columns where it
strips a type, so a column after a type annotation on its line is off.

`rewriteCell` reworks the compiled cell, parsed with **acorn**, in two
ways, on the lines it was on:

- **What a cell declares at its top is the notebook's**, for the cells
  run after it, as in the Node REPL: a variable is declared once with
  `var` after the cell's function (hoisted to the top of the script) and
  its declaration becomes an assignment - `const a = 1` runs as
  `;(    a = 1)`, the keyword's place taken by as many characters so the
  columns after it stay the cell's, destructuring and all; `let a;` sets
  it to `undefined` again. A function or a class is handed over with
  `globalThis.name = name` once declared. Running a cell again assigns
  again, rather than failing as a second `const` would; the price is that
  a `const` can be reassigned by a later cell. What a cell sees is what
  the cells run before it declared, not what is written above it.
- **Its last statement, where it is an expression, is shown** once the
  cell is over, as the MySQL Shell's notebooks showed a block's value: it
  is made the function's `return`. An assignment (`obj.x = 1`) is not
  echoed, and `undefined` - a `print(...)` call's - shows nothing. So
  `await runSql("SELECT 1")` alone in a cell shows its rows.

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
- No `$`: the MySQL Shell's notebooks shared values through that object;
  here a cell's declarations are shared, so it was dropped.
- `console.log/info/debug` to stdout, `console.warn/error` to stderr;
  timers, `fetch`, `URL`, `TextEncoder`/`Decoder`, `structuredClone`.

**Interrupt** ends the notebook's worker: the cell is told so, and the next
one starts on a fresh worker, nothing declared. A closed notebook's worker goes
too. The context is no sandbox: the code is the user's own, with Node a
constructor away, and the extension runs only in trusted workspaces.

## Graphs

`Graph.render(options)` and `PieGraph.render(rows, layout?, keys?)`, as
in the MySQL Shell's notebooks, print a graph: its options go out as JSON
(`kind: "graph"`, a `Date` as its ISO text), an output of their own
(`application/vnd.mariadb.graph+json`), which the notebook renderer draws
with `renderGraph` - an SVG scaled to the output's width, no taller than
300px, saved with the notebook like any output. The viewport is 1200 by
450 unless the graph says otherwise (the MySQL Shell's was 1200 by 900):
half as high, so a graph as wide as a cell's output is about 300px high
with its text at the editor's size, rather than half a screen; the
`PieGraph` radii are scaled to it. **No charting library**:
three simple kinds of graph need little of one, so `graphMath.ts` does
the arithmetic - ticks on 1, 2 or 5 times a power of ten, time ticks on
round steps (whole minutes, local midnights, the first of a month)
labeled with `Intl.DateTimeFormat`, the natural and basis curves as d3
solves them - and `renderGraph` writes the SVG elements itself.

- **The series**: `pie` (slices, a label each beside the pie with a line
  to it, `radius` making it a donut), `line` (a line per `group`, against
  a time axis where the x values are dates, a legend where there is more
  than one group, the `curve` one of `Linear`, `Step`, `StepBefore`,
  `StepAfter`, `Natural`, `Basis`, `Bundle` drawn as `Basis`), `bar` (a
  bar per category, from
  tabular data or rows). A tooltip is SVG's own `<title>`. A series goes in
  its `transformation` box of the viewport (default 0 0 1200 450); a title
  gets room of its own above the viewport.
- **`PieGraph`** takes rows: the columns `keys` names, or `name` and
  `value`, or a row's two columns in turn; `PieGraphLayout` (an enum, its
  names and numbers both ways) picks the radii the MySQL Shell's did.
- **What the old API had and this does not**: functions among the options
  (a tooltip's `format`, `xTitle`, `yFormat` as a function) - they never
  crossed the old worker's `postMessage` either - a pie's `borderRadius`;
  `yFormat` as a d3 specifier only as far as `,`, `.N`, `f`, `d` and `%`
  go; and animations, which
  moved a graph from one rendering to the next; under a cell each
  rendering is an output of its own. The options are read as untrusted
  JSON: a value of the wrong kind is left out, at most 100 slices or bars.
- The renderer bundle is some 510 kB, the result view's Tabulator above
  all; one module, so `vite.notebook.config.ts` raises the size warning
  to 600 kB.

## IntelliSense in TypeScript cells

VS Code drops a notebook cell's semantic diagnostics (the TypeScript
extension skips them for `vscode-notebook-cell`), so a cell is never
marked for an unknown name; what it lacks without typings is completion,
hover and signature help. **`mariadb-notebook-ts-plugin`**
(`ts-plugin/`), a TypeScript server plugin
(`contributes.typescriptServerPlugins`), gives them:

- VS Code opens a cell in the server as an in-memory file named
  `^/vscode-notebook-cell/<authority>/<notebook path>#<cell>`, in the
  inferred project of its workspace folder; a MariaDB Notebook's path ends
  in `.mariadb-notebook`, an untitled one's too. The plugin appends the
  typings' file to the file names any project holding such a cell gives
  its language service. A plugin's `getExternalFiles` would not do: it
  only reaches a configured project's program.
- **The cells see each other's declarations** already: they are scripts
  in one project, which shares their global scope - as the runtime has it.
  Redeclaring a name in two cells would be an error, but a cell shows no
  semantic errors. A Jupyter notebook's cells in the same folder see a
  MariaDB Notebook's names, and the other way round; another folder's do
  not get the typings.
- **The typings** are `typings.js`, a string: the Marketplace refuses a
  .d.ts in a package (`check:package`). The plugin writes them once to
  `<tmp>/mariadb-notebook-ts-plugin/notebook-<hash>.d.ts` (written whole,
  then renamed) and serves that file, so the server reads it as any file.
  `typings.js` describes the runtime by hand: kept in step with
  `scriptSandbox.ts`; `tsPlugin.test.ts` compiles cell code against it.
- **Where the server finds it**: only as a package name, under
  `node_modules` beside the extension (`--pluginProbeLocations`). The
  plugin is a `file:` dependency, so npm links `node_modules/mariadb-
  notebook-ts-plugin` to `ts-plugin/`, and the package carries it from
  there - see Packaging in [toolchain.md](toolchain.md).
- Checked against a real TypeScript server started as VS Code starts it:
  hover on `runSql` and on a cell's `rows`, another cell's `rows`,
  completion offering the runtime, and a Jupyter cell of another folder
  without it.

## The REST Service SDK

A TypeScript cell runs with the REST client SDK of its notebook's
connection, as the MySQL Shell's notebooks had it: `myServiceV1` - an
object per service, named after it - and `mrs`, typed in the editor.

- **What it is** (`NotebookSdk`): the SDK's base classes
  (`rest.get_sdk_base_classes`, asked for once) and the classes of the
  session's current REST service, else of the only one
  (`rest.get_sdk_service_classes`, `prepare_for_runtime`), as TypeScript.
  The service is reached at the URL of the REST Daemon serving the
  connection's server (`restdFor`) plus its path. With no service at all,
  the REST Service management code (`rest.get_runtime_management_code`);
  with several and none current, or no REST metadata, no SDK. The services
  are read with `SHOW REST SERVICES FORMAT=JSON` on the connection's
  session, not as an action, so reading them drops nothing.
- **When**: built the first time a TypeScript cell runs on a connection -
  a notebook with no connection gets none, and is not asked for one -
  and kept. Dropped when a run on the connection changes the catalog or
  says REST (`onDidRunScript`), so REST DDL in a SQL cell has the next
  TypeScript cell build it again; `mrs.refreshSdkCode()` builds it now.
- **In the worker**: the runner sends a notebook's SDK before a cell when
  the worker has not loaded that version (`INotebookSdk.version`, a hash of
  the code). The sandbox compiles it as a cell, so its classes and objects
  are the notebook's - loaded again, they are replaced - and a failure is
  said once, in the next cell, which runs all the same. The cells get what
  the SDK runs on: `AbortSignal`, Web Crypto, `btoa`/`atob`, `Request`,
  `Response`, `Headers`.
- **HTTPS to the daemon**: Node's `fetch` trusts its own roots, not the
  system's store, so the daemon's certificate - signed by the shell's local
  certificate authority (`restd.get_certificate_status`, `ca_path`) - is
  refused even once the system trusts it. With an SDK, `fetch` in a cell is
  `trustingFetch`: HTTPS to a loopback address goes through Node's `https`
  with that authority trusted beside the usual roots; everything else is
  `fetch` as it is.
- **What the generated code calls** (the old runtime's functions):
  `mrsPrintSdkCode` prints the SDK; `mrsRefreshSdkCode` builds it again;
  `mrsSetCurrentService(id)` runs `USE REST SERVICE` on the session and
  builds it for that service; `mrsAuthenticate` - a service's static
  `authenticate` - asks for the authentication app (where the service has
  several), the user (where the cell named none) and the password, logs in
  with the SDK's `MrsBaseService`, sets `mrsLoginResult` and loads the SDK
  again, so the service objects carry the token. These are host calls
  (`host` / `hostResult`): the extension answers, with a new SDK where it
  built one. A cell is over once what it set off without waiting is - the
  generated `authenticate` does not return its promise. The functions that
  open the old dialogs (`mrsEditService`, `mrsExportServiceSdk`,
  `mrsAddContentSet`, `mrsEditSchema`, `mrsEditDbObject`,
  `mrsSetServiceUrl`) say they are not in a notebook yet.
- **In the editor**: the SDK's source is written to
  `<global storage>/notebook-sdk/mrs-sdk-<version>.ts` and named to the
  TypeScript server plugin (`configurePlugin`, `{ sdkFile }`), which adds it
  to the cells' projects and marks them to be looked at again. One SDK at a
  time: the last one built. `typings.js` declares the host functions and
  `mrsLoginResult`.
- Checked against the real thing: a sandbox's REST Daemon serving a
  service, its SDK fetched over MCP and loaded into the built worker - a
  cell's `getMetadata()` and `getAuthApps()` reached the daemon over HTTPS -
  and named to a real TypeScript server, which then completed
  `myServiceV1.` with the SDK's methods.

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
- The editor sees every cell's declarations, not only the cells run
  before it, and another notebook's in the same folder too.
- `runSql` takes no parameters yet.
- The REST SDK's dialogs (edit a service, export its SDK, add a content
  set, edit a schema or an object) are not in a notebook; the editor knows
  one SDK at a time, the last built.
- The watch task does not rebuild the worker; `npm run build` (and F5)
  does.
- Not yet exercised in a real VS Code: the unit tests cover the format,
  the kernel, the views' messages, the renderer's output under jsdom, the
  language switching against a mock, the worker's runtime in-process (and
  the built worker was run from Node), the graphs under jsdom, and the
  plugin in a real TypeScript server, but not the output webview's layout
  or how a switched cell's editor behaves.
