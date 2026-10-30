# MariaDB Notebooks: TypeScript cells

A MariaDB Notebook's TypeScript side: telling a cell's language from what
is typed, the runtime a TypeScript cell runs in (a worker per notebook),
its graphs, the editor's typings for it (a TypeScript server plugin), and
the REST client SDK of the notebook's connection.

Part of [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md). The notebook itself -
its file, its connection, SQL cells and the result view under a cell - is
in [notebooks.md](notebooks.md).

## Files

| File | What it is |
| --- | --- |
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
  A host call like the SDK's below (`host` / `hostResult`, `HostCall`
  `runSql`): the worker has one way to ask the extension anything.
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
  only reaches a configured project's program. The server asks for those
  names on every update of every project, so one without such a cell gets
  its own list back, untouched; only the projects holding one are kept,
  to be looked at again for a new SDK, and let go of as they are disposed.
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
  session (`queryRows`, `quiet`: the run listeners are not told), so
  reading them drops nothing. The steps that do not wait on each other -
  the session, the tools, the daemon's URL, the certificate authority -
  are asked for together.
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
  `trustingFetch`: HTTPS to a loopback address goes through Node's `https`,
  one agent trusting that authority - the only one a daemon's certificate
  is signed by - and keeping its connections open; everything else is
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
  time: the last one built - its file written once, the ones before it
  deleted. `typings.js` declares the host functions and `mrsLoginResult`.
- Checked against the real thing: a sandbox's REST Daemon serving a
  service, its SDK fetched over MCP and loaded into the built worker - a
  cell's `getMetadata()` and `getAuthApps()` reached the daemon over HTTPS -
  and named to a real TypeScript server, which then completed
  `myServiceV1.` with the SDK's methods.

## Known gaps

- The editor sees every cell's declarations, not only the cells run
  before it, and another notebook's in the same folder too.
- `runSql` takes no parameters yet.
- The REST SDK's dialogs (edit a service, export its SDK, add a content
  set, edit a schema or an object) are not in a notebook; the editor knows
  one SDK at a time, the last built.
- The watch task does not rebuild the worker; `npm run build` (and F5)
  does.
