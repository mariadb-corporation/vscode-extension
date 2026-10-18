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
| `settings.ts` | `serverSettings`: the `mariadb.lsp.*` settings under the server's option names (`progressThresholdMB` becomes bytes; values the server would refuse are left out), and which settings restart the server and which are sent to it. |
| `parseProgress.ts` | `ParseProgressStatus`: the status bar entry for `mariadb/parseProgress`. |
| `nodeClient.ts` | The only file importing `vscode-languageclient/node`: the `LanguageClient` (id `mariadb.lsp`, output channel **MariaDB SQL Language Server**), the document selector (`mariadb-sql` and `sql`, `file` and `untitled`), and the middleware. `extension.test.ts` mocks this module, since the library needs the real `vscode`. |

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
- **Arguments**: `lsp --stdio`, plus `--threads N` when
  `mariadb.lsp.threads` is above 0. `mariadb.lsp.trace.server` is read
  by the client library itself (it follows the client id).
- **Settings**: `catalogFiles`, `catalogRefreshSeconds`, `keywordCase`,
  `sqlMode`, `serverVersion`, `debounceMs`, `maxDiagnostics` and
  `progressThresholdMB` go to the server as initialization options. A
  change is sent as `workspace/didChangeConfiguration`
  (`{settings: {mariadb: ...}}`, every key each time, so one put back to
  its default reaches the server too), except for `serverVersion`, which
  restarts it like `enabled`, `path` and `threads`: the server ignores a
  version it cannot read, so an emptied setting could not take it back to
  its own. The settings' defaults are the server's.
- **The shell's secret store helpers.** The server reads passwords
  through `mariadb-secret-store-<helper>` next to the `mariadb-shell` on
  its PATH. A shell the extension installed under
  `~/.local/share/mariadb-shell/<version>` is not on the PATH, so the
  controller passes it as the `shellBinary` initialization option; it
  is found with `locateShell` (never the installer) when the server starts.
- Stopped in `deactivate()` before the connections and the MCP session.

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
The UI test's completion of the sandbox's tables depends on this: the
schema is created after the first SQL editor opened.

The `sqlMode` of the message is not sent: `SqlModes` knows only whether
ANSI_QUOTES is on, and the server reads the full mode from the
connection.

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
