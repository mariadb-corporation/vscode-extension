# The SQL language server

`mariadb-lsp`, the MariaDB SQL language server from the
[lsp-server](https://github.com/mariadb-corporation/lsp-server) repository:
how the extension finds it, starts it, and tells it which connection a
document runs on. What the server itself does (diagnostics, completion,
hover, outline, live catalogs, `mariadb/*` messages) is in that
repository's `docs/language-server.md`.

Part of [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md).

## `src/lsp/`

| File | Purpose |
| --- | --- |
| `locator.ts` | Finds the binary: `mariadb.lsp.path` alone when set, else `mariadb-lsp` on the PATH, else `~/.local/bin/mariadb-lsp` (`.exe` on Windows, under the home directory there too). Each candidate is probed with `--version`, which has to print `mariadb-lsp <x.y.z>` at least `MINIMUM_LSP_VERSION` (26.9.4, the first with `--version`). Shares `ShellEnvironment` and the version helpers with the shell lookup. |
| `languageServer.ts` | `LanguageServer`, the controller: states `stopped` / `starting` / `running` / `unavailable`, the restart on settings changes, the `mariadb/documentContext` notifications. Talks to the client through `ILanguageClientHandle`, so it is tested with a fake. |
| `dbCall.ts` | `answerDbCall`: the server's `mariadb/dbCall` requests (`{connection, tool, arguments}`) made as typed `db.*` calls on the MCP server, on the tree's session (`UI_BACKEND_SESSION`) on that URI, opened if need be. Only `db.list_schemas`, `db.list_objects`, `db.get_object_details` and `db.execute_sql`, the last only for the statements in `ALLOWED_SQL` (compared with runs of blanks as one space and no `;` at the end; see PROJECT_CONTEXT.md, "Kept in sync with lsp-server"); anything else, and a bad argument, is refused for good (`DbCallError.permanent`), before anything is opened. A refused statement is logged in the MariaDB channel, the one place a server newer than the list shows. A URI that is not a configured connection is refused but may be asked again: it may be added later. |
| `settings.ts` | `serverSettings`: the `mariadb.lsp.*` settings under the server's option names (`progressThresholdMB` becomes bytes; values the server would refuse are left out), and which settings restart the server and which are sent to it. |
| `parseProgress.ts` | `ParseProgressStatus`: the status bar entry for `mariadb/parseProgress`. |
| `nodeClient.ts` | The only file importing `vscode-languageclient/node`: the `LanguageClient` (id `mariadb.lsp`, output channel **MariaDB SQL Language Server**), the document selector (`mariadb-sql` and `sql`, `file` and `untitled`), and the middleware. `extension.test.ts` mocks this module, since the library needs the real `vscode`. The server process is spawned here (server options as a function) rather than by the library, which keeps its process private and, after a failed start, neither stops nor kills it: the handle kills it after a failed start and after `stop()`. All clients share one output channel; the library's own is not disposed on `stop()`, so every restart left another behind. |

## Lifecycle

- **Started lazily**, like the MCP server: when the first SQL document
  opens, or at activation when one is already open. Nothing is spawned
  for a window without SQL.
- **Not found** means a log line in the MariaDB channel and the state
  `unavailable`: no notification, and no new lookup on every file opened.
  `MariaDB: Restart SQL Language Server` (`mariadb.lsp.restart`), or a
  change of `mariadb.lsp.enabled` / `path` / `threads`, looks again.
  Downloading the server when it is missing, as `ensureShell` installs
  the shell, is planned and not built.
- **Arguments**: `lsp --stdio --mcp`, plus `--threads N` when
  `mariadb.lsp.threads` is above 0. `--mcp` makes the server read every
  connection's catalog through the extension (below) instead of
  connecting itself. `mariadb.lsp.trace.server` is read
  by the client library itself (it follows the client id).
- **Formatting**: the server advertises `documentFormattingProvider` and
  `documentRangeFormattingProvider` (queries only; lsp-server plan P8), so
  "Format Document" works through the language client; `keywordCase` and
  `lineWidth` apply; `indentation` (`editor`, the default: the editor's
  `tabSize`/`insertSpaces`; or `tab`, `2 spaces`, `4 spaces`) sets one
  level of indentation, also for the lines completion adds. The
  editor toolbar's format button (`mariadb.formatSql`, icon
  `toolbar-format.svg`, shown while `mariadb.lsp.enabled`) calls
  `LanguageServer.format`, which starts the server and runs VS Code's
  `editor.action.formatSelection` for a selection, else
  `editor.action.formatDocument`: one formatting path for the button,
  the commands and format-on-save. Another SQL formatter set as
  `editor.defaultFormatter` takes the button too, for `sql` files above
  all. A warning when no server runs; nothing done when another editor
  became active while the server started (`"skipped"`); a status bar note
  when the document did not change, which says only that: a request that
  failed is reported by the language client, in its output channel.
  UI tests: Format Document, the button with and without a selection.
- **Outline**: the server's `textDocument/documentSymbol` (schema >
  tables with columns and keys, views, routines, ...) reaches VS Code's
  Outline view, breadcrumbs and Go to Symbol through the language client
  as it is; the extension adds nothing. UI test: the Explorer's Outline
  for a table, a view and a function, and a click on a symbol moving the
  cursor to it.
- **MSM `SOURCE` includes** (lsp-server plan P9,
  `docs/plans/source-includes.md` there): the server reads the files a
  development script's `SOURCE '<path>'[<start>:<end>];` lines include, as
  msm's `prepare_release` does. The extension adds nothing; all of it comes
  through the language client as it is:
  - **Outline:** included objects sit on their directive, `· file:line` in the description.
  - **Links and completion:** `textDocument/documentLink` on the paths; path completion, with `/` added to the trigger characters, the server answering an empty list for `/` outside a `SOURCE` path.
  - **File watcher:** the server registers a `**/*.sql` watcher through `client/registerCapability`, which the library honours, so a section changed on disk is read again.
  - **Navigation and diagnostics:** definition, hover, references and rename across the files; diagnostics with code `source`.
  - **Section files opened alone:** a section opened on its own takes an open including script's schema, `sql_mode` and delimiter. That comes below `mariadb/documentContext`: a `sqlMode`, `delimiter` or `currentSchema` the extension sends wins.

  UI test: a script on disk with one section, its table in the Outline under the script's schema with `140_tables.sql:2`, and path completion listing the section.

  Not done:
  - **Running a script with `SOURCE` lines:** `executeScript` sends the editor's text inline, so they reach the server as they are. Once MariaDB Shell's `db.execute_sql_script` expands them (a `source_dir` argument for inline scripts was proposed to the shell-plugins session), `executeScript` should pass the document's folder for a file-backed editor, left out for a shell that does not have the argument.
  - **`mariadb/outline`:** the extension does not read it. A future reader must take `source` positions as positions in the included files.
- **Settings**: `catalogFiles`, `catalogRefreshSeconds`, `keywordCase`,
  `indentation`, `lineWidth`, `sqlMode`, `serverVersion`, `debounceMs`, `maxDiagnostics` and
  `progressThresholdMB` go to the server as initialization options. A
  change is sent as `workspace/didChangeConfiguration`
  (`{settings: {mariadb: ...}}`, every key each time, so one put back to
  its default reaches the server too), except for `serverVersion`, which
  restarts it like `enabled`, `path` and `threads`: the server ignores a
  version it cannot read, so an emptied setting could not take it back to
  its own. The settings' defaults are the server's.
- **Catalogs through the MCP server (`--mcp`).** The server connects to
  no database: for a connection's tables, columns, routines and
  `sql_mode` it sends `mariadb/dbCall` requests, which `nodeClient.ts`
  hands to `answerDbCall`. The extension's one stdio MCP server serves
  both, the credentials never leave the extension, and no localhost port
  is opened (the HTTP transport was weighed for a second MCP client and
  rejected for that). The calls go to the connection open on the URI,
  on the tree's session (`UI_BACKEND_SESSION`), opened if need be, as
  the Connections view reads it: on an editor's session completion would
  wait for whatever the editor runs. A file bound to a connection opens
  it when the server first reads its catalog. Collapsing the connection
  in the tree does not close that session; Disconnect closes every one,
  and one still being opened is closed as it arrives
  (`ConnectionManager`'s abandoned opens). That session does not follow
  a `SET sql_mode` or `USE` run in an editor, so the editors' session's
  state goes with each document's context (below). A reading lists names only; the details of a
  table, view or routine are one `db.get_object_details` call each, made
  when a completion, hover or signature help first needs them. A failed call is a JSON-RPC error with
  `data.permanent`; the server retries the others with its back-off, and
  `mariadb/refreshCatalog` reads again at once.
- Stopped in `deactivate()` before the connections and the MCP session.
- A start that throws past its own handling leaves the state
  `unavailable`, never `starting`, which every later `start()` and
  `stop()` would wait on.

## Which connection a document runs on

The server reads a connection's catalog, `sql_mode` and version itself,
from the URI. The controller sends `mariadb/documentContext` with
`{textDocument: {uri}, connection}`, `connection` being
`SqlEditorBinding.connectionFor` (picked, header, default):

- after the client's `didOpen` (middleware), since the server ignores a
  context for a document it does not have open; a document opened while
  the server was starting gets it once the start has settled;
- when the binding binds a document by hand (`onDidBindConnection`),
  when the connections change (the default among them), and on an edit of
  the document, which may have changed its header line;
- only when it differs from what was last sent for that document, and
  `null` when a document lost its connection. Nothing is sent for a
  document that never had one: the server starts without.

**After a run.** The server reads a connection's catalog when a document
first names it and then only when asked (`catalogRefreshSeconds` is not
set), so a table created from an editor would never be completed. The
binding tells listeners every script it ran (`onDidRunScript`, failed runs
too), and when the script has `CREATE`, `ALTER`, `DROP` or `RENAME` in it
the controller sends `mariadb/refreshCatalog` naming a document the
server has open on that connection; none open on it, nothing is sent.
`LanguageServer.refreshCatalog` does the same for a load, a copy (the
target's connection) or an import that finished (`UtilCommands`' host
`refresh(uri)`), and with no connection, for every catalog, from the
Connections view's refresh button. Changes from other clients, or from
an agent through the MCP server, are seen only after that button or with
`catalogRefreshSeconds`.
The UI test's completion of the sandbox's tables depends on this: the
schema is created after the first SQL editor opened.

**The editors' session.** `SqlModes` also keeps what the editors' session
on a connection reported (`sessionOf`, `onDidChangeSession`): the full
`sql_mode` every run reports, and after a run whose script has `USE`,
`SELECT DATABASE()` read on that session (`SqlEditorBinding`). The
controller sends them as `sqlMode` and `currentSchema` with the document's
context, and again when they change. Each message is whole: until a run
reported something, or once the connection closed, they are left out and
the server takes the connection's own, which a new session shares. Kept
per connection, like the ANSI_QUOTES state: two editor sessions on one
connection share the last report.

## Progress of a large file's check

For a file of at least `progressThresholdMB` (4 MB by default) the server
sends `mariadb/parseProgress` while it checks it. `ParseProgressStatus`
shows `Checking SQL 42%` on the left of the status bar: the active
editor's file if it is being checked, else any, with `(+N)` for the
others; hidden when no check is under way. The item is created on the
first report (the activation test counts status bar items). Reports from
a client that has been stopped are dropped (`#generation`), and a closed
file or a stopped server clears its entries.

The client tells the server it does not take work done progress
(`window.workDoneProgress: false`, a static feature registered after the
library's own, so it has the last word); otherwise the server would also
report "Checking SQL" through VS Code's own progress, twice in the status
bar. The checks of a few megabytes are over in milliseconds, too quick for
a UI test to catch; the unit tests cover it.

## Semantic tokens are switched off on the client

VS Code takes the answer of one semantic token provider, newest
registered first, so the server's tokens would hide the extension's
ANSI_QUOTES marks (`src/editor/ansiQuotes.ts`). The server's tokens add
nothing over the TextMate grammar until it classifies identifiers, so
the middleware answers `undefined` for all three semantic token requests
and no request is sent. Drop that middleware, and the ANSI_QUOTES
provider, once the server's tokens cover both.

## Not done yet (plan P6 in lsp-server)

- Downloading `mariadb-lsp` when it is not found.
- The gutter's statement markers and the run commands still use the
  TypeScript scanner (`src/sql/statementSpans.ts`), not the server's
  statements.
- No setting for the server's `delimiter` default or
  `semanticTokensFullLimit` (the tokens are off).
