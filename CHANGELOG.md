# Change Log

All notable changes to the "mariadb" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [26.10.1] - 2026-10-21

### Added

- **MariaDB Schema Management in the Explorer.** A **MariaDB Schema
  Management** submenu on Explorer folders: **New MSM Project...** on a
  folder, and on a `*.msm.project` folder **Show MSM Project
  Information...**, **Prepare MSM Release...**, **Generate MSM Deployment
  Script...** and **Deploy MSM Schema...**, each a dialog that checks what
  it is given beside its fields. Deploy Schema runs a deployment script on
  a configured connection, backing the schema up first if asked. Every
  operation - reading a project included - is a row of the MariaDB
  panel's Actions tab, with a row per call under it. The commands are in
  the Command Palette too.

- **SQL language server.** SQL files get diagnostics, completion, hover,
  go to definition, references, rename, signature help, the outline and
  folding from `mariadb-lsp`, the MariaDB SQL language server, which the
  MariaDB Shell's installation carries (or found on the `PATH`, or at
  `mariadb.lsp.path`). Completion knows
  the tables and columns of the file's connection, read through the
  extension's MCP server and read again after a script that changes them,
  a load or a copy, or a refresh of the Connections view. Queries are laid
  out by Format Document, Format Selection and a format button in the SQL
  editor's toolbar. A large file shows how far its check has got
  in the status bar. Settings `mariadb.lsp.enabled`, `.path`, `.threads`,
  `.catalogFiles` (SQL files whose tables every file sees),
  `.catalogRefreshSeconds`, `.keywordCase`, `.indentation`, `.lineWidth`,
  `.sqlMode`, `.serverVersion`, `.debounceMs`, `.maxDiagnostics`,
  `.progressThresholdMB` and `.trace.server`; command **MariaDB: Restart
  SQL Language Server**.

- **MSM `SOURCE` includes.** In a MariaDB Schema Management development
  script, the files `SOURCE '<path>'[<start>:<end>];` includes are read
  with it:
  - Their objects show in the Outline, each naming its file and line.
  - Go to definition, hover, references and rename reach into them.
  - Each path is a link, and completion lists the folders and `.sql` files while a path is typed.
  - Problems with a directive are marked: a missing file, a bad slice, a nested `SOURCE` that msm does not expand.
  - A section file opened on its own takes the schema, `sql_mode` and delimiter of an open script that includes it.

  Running such a script expands its `SOURCE` lines, as MariaDB Shell's `db.execute_sql_script` does from 26.10.3.

- **GitHub Copilot support.** The 85 MariaDB agent skills of the
  [ai-plugins](https://github.com/mariadb-corporation/ai-plugins) release
  v26.10.5 are contributed to Copilot (`contributes.chatSkills`), and the MariaDB
  Shell's MCP server is offered to it as the **MariaDB** server
  (`contributes.mcpServerDefinitionProviders`), started in agent mode -
  without `--gui` - and installing the shell first if there is none. The
  `mariadb.copilot.enabled` setting turns both off. `package.json` pins
  the release (`aiPlugins.release`); `npm run build` fetches its skills
  into the uncommitted `skills/` first (`npm run sync:skills`).

- Startup check for a MariaDB Shell of at least version 26.10.3, looking at
  the `PATH` first and at the local installation directory second, and
  running the official installer when neither has one. The download and
  extraction are reported in a progress notification.
- The MCP server is started from the located shell with
  `mariadb-shell -- mcp start-server --transport=stdio` and driven with the
  official MCP SDK. Its output is written to the *MariaDB* output channel.
- The MariaDB seal as the activity bar icon and as the connection icon in
  the tree, both as vectors.
- A **Connections** view in the primary sidebar, browsing the configured
  connections, their schemas and the tables, views, functions, procedures,
  sequences, triggers and events in each. The icons are taken from the
  MySQL Shell for VS Code extension.
- Connect and disconnect from a connection's context menu, and **Set as
  Default Connection**, stored in the `mariadb.defaultConnection` setting.
- Expanding a connection in the **Connections** view opens it, and the
  Connect button is left off the row. `mariadb.connections.connectMode`
  set to `explicit` brings the button back and stops the tree opening a
  connection on its own.
- A connection picker and a run button in the editor toolbar of `.sql`
  files, plus a status bar entry showing which connection the file runs on
  and a `Ctrl`/`Cmd`+`Enter` keybinding.
- **New SQL Editor**, beside Connect on a connection in the Connections
  view, opens an unsaved `.sql` file bound to that connection. The binding
  is also written into the file as a `-- MariaDB connection: ...` header,
  so it survives saving the file.
- A **MariaDB** result view, docked in the bottom panel beside Problems,
  Output, Debug Console and Ports. It is a Preact webview with a tab for
  the text output and one tab per result set; the tabs sit along the
  bottom and an error, when there is one, is shown below them.
- The result grids are [Tabulator](https://tabulator.info) tables, as in
  the MySQL Shell extension, themed with the editor's own colours.
- **Preview SQL** shows the `UPDATE`, `INSERT` and `DELETE` statements the
  pending edits would run, before running them. They are generated by the
  same code that executes them, and clicking one goes to the grid row it
  came from. A failed apply opens the preview with the error under the
  statement that caused it.
- The **MariaDB: Restart MCP Server** and **MariaDB: Show MCP Server Log**
  commands.
- **Deploy OpenAPI Web UI...** on a REST service's context menu: the
  service's OpenAPI UI as a content set at `/openApiUi`, served without
  authentication. The files of an uploaded content set take its **Requires
  Auth** setting, and follow it when the content set is edited.

- Blue dots in the editor gutter marking where each SQL statement starts.
  They are scanned in time slices, so the first dots appear almost
  immediately even in a very large file. The ranges come from the
  statement scanner for now, and are the same thing a language server
  would later provide.

### Changed

- **Requires MariaDB Shell 26.10.3** (was 26.10.2), the first release
  with the MariaDB REST Service module the REST Service tree uses, and the
  one the extension installs where there is none.

- The `LICENSE` file is updated to include the licenses of the latest
  third-party components.
- **The MCP server's REST groups are renamed.** The REST Service tree and
  dialogs call the REST Service tools as `rest.*` (were `mrs.*`), and the
  REST Daemon features call the daemon tools as `restd.*` (were `rest.*`),
  as mariadb-shell-plugins#57 renames them, which MariaDB Shell 26.10.3
  carries.
- The SQL splitter is now a port of the MySQL Shell's
  `determineStatementRanges`: an offset-based scanner that runs at about
  120 MB/s instead of accumulating each statement's text as it goes. It
  yields statements as it finds them, which is what lets the gutter dots
  appear progressively.

- A connection picker at the left of the result view's bottom bar, and a
  **Clear Output** button in the view's own toolbar. Output and results
  are kept per connection, so one connection's results can be read while
  another is being worked on, and clearing empties the output and the
  result tabs of the connection on show.
- The output tab is now a Tabulator grid with one row per statement,
  showing the time to the millisecond, the elapsed time, the rows
  returned or affected, the statement and the server's message. A row
  whose statement produced a result set offers an arrow that jumps to
  its tab, as long as that tab has not been replaced by a later run.
- Output now accumulates across executions; only the result set tabs are
  replaced by each run. A **Clear Output** button in the toolbar discards
  the output gathered for the connection on show.

- A second editor toolbar button that runs only the statement the cursor
  is in, and selects it. `Cmd`/`Ctrl`+`Enter` runs the whole script,
  `Shift`+`Enter` the statement at the cursor; both chords can be moved
  in the extension's settings.
- Every execution now opens and closes with a line in the output saying
  what is about to run and how it went, so a run reads as a block.
- Every output row that came from a file offers an arrow that puts the
  cursor on its statement. The closing line of a failed run points at
  that run's first error, in the output and in the editor.
- `mariadb.execute.stopOnError` chooses between ending a script at the
  first failing statement and running all of them. A third editor
  toolbar button toggles it for one file, starting from the setting and
  leaving it alone.

- Statement rows now show their own execution time, measured by the
  server, rather than the run's total repeated on every line. The total
  is on the closing line.

- The result view now uses the editor's UI font at the UI size
  throughout. The monospace editor font is kept for SQL alone: the
  output grid's Statement column and the SQL preview.
- Every output row shares one background, the Primary Sidebar's. What a
  row means is carried by an info, warning or error marker drawn with
  the codicon font in the Problems panel's colours, rather than by a
  different background. The marker and the message lead the row, with no
  rule between them.

- The extension is now bundled with Vite and tested with Vitest.

### Fixed

- The result grids came out with a white background in dark themes.
  Tabulator's stylesheet paints the table element behind the rows, and
  its placeholder text, sortable header hover and sort arrows, in fixed
  light colours; all of them now follow the editor's theme.

- A script whose first statement was preceded by a line comment had every
  result paired with the wrong statement, because the server counts such a
  comment as a statement of its own and the client's split did not. This
  lost the statement text of each result and made editable grids read
  only.
- An off-by-one carried over from the upstream scanner, where a word
  starting with `d` that is not DELIMITER reported its content as
  starting one character in (`delete from t` as `elete from t`).
