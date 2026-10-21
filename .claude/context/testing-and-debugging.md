# Testing and debugging

How the suite is kept host-free, and what is load bearing in the F5 launch
configuration.

Part of [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md). The scripts and the
Vitest projects themselves are in [toolchain.md](toolchain.md).

## Testing approach

Everything that touches the outside world sits behind a small interface —
`ShellEnvironment`, `ProcessRunner`, `ProgressHost`, `IMcpConnector`,
`IMariaDbApi`, `IConnectionSettings` — so the lookup, install, connection,
tree, execution and panel behaviour are all tested with fakes, for every
platform, from a single host. `src/test/shell/nodeRuntime.test.ts` covers
the real process adapter by spawning actual processes against a temporary
directory.

`src/test/mocks/vscode.ts` also stands in for file dialogs and files
(`fileDialogs` answers `showSaveDialog` / `showOpenDialog`, `files` backs
`workspace.fs`), records `vscode.open` calls (`openedWith`) and registered
file system providers (`fileSystemProviders`), and has `FileType`,
`FilePermission`, `FileChangeType`, `FileSystemError` and `Uri.from`; all
are reset by `resetVscodeMock`. Its `Disposable` is only an interface, so
code must return `{ dispose }` objects rather than `new vscode.Disposable`.

The MCP decoding fixtures in `src/test/mcp/protocol.test.ts` are the shapes
the running server actually answers with, so the mapping is pinned to the
server rather than to an idea of it. The shared fake API in
`src/test/helpers.ts` rejects a missing object with the real API's
`ObjectNotFoundError`, since the execution service and the logging
wrapper tell it apart by type, not by message.

Two typing traps in the grid tests: Tabulator's `headerTooltip` typing
says the function returns a `string` while the runtime takes an element,
so a test calls it (`as unknown as () => HTMLElement`) and reads
`textContent`; and `formatValue` / `formatCell` return elements, so
their tests read `textContent` rather than comparing strings.

The grammar tests (`src/test/grammar/`) tokenize with `vscode-textmate`
on `vscode-oniguruma`, VS Code's own engine, so they need no VS Code and
see exactly what the editor colours: generated coverage of every word
in `syntaxes/words.json`, a case per lexer token class, and snapshots of
real SQL corpora (`corpus/*.tokens`, rewritten with `vitest -u` after a
deliberate change). See [sql-grammar.md](sql-grammar.md).

## UI tests (ExTester)

`MARIADB_SHELL=<path to mariadb-shell> npm run ui-test [suite...]`
drives a real VS Code through WebDriver. The shell loads `mcp_plugin`,
`rest_plugin` and `msm_plugin` from a mariadb-shell-plugins checkout:
`MARIADB_SHELL_PLUGINS`, or by default `../mariadb-shell-plugins` next to
this repository (so does `mrsShell.e2e.test.ts`). Before the extension
moved out of that repository the runner took its parent folder, which a
standalone checkout doesn't have. It uses vscode-extension-tester
8.28.1 and Mocha, on the newest VS Code (`--code_version max`).
`mariadbd` must be on the PATH.

**Split into suites by area** (the user's call: a change in one area
should not need the full run). `SUITES` in `ui-test/run.ts`:

| Suite | Files, between `01-sandbox` and `99-cleanup` | npm script |
| --- | --- | --- |
| `core` | `00-startup` (before the setup), `03-connections`, `04-sql-results`, `05-lifecycle` | `ui-test:core` |
| `mrs` | `02-mrs` | `ui-test:mrs` |
| `dump-load` | `06-dump-load` | `ui-test:dump-load` |
| `lsp` | `08-lsp`: a syntax error in the Problems view until it is fixed, completion of the sandbox's tables, which `mariadb-lsp` reads through the extension's MCP server (`mariadb/dbCall`), the walk from `SELECT ` through schema, table and column to the FROM clause and a foreign-key join (`pickCompletion` opens the list and clicks an item; a dotted item reopens it by itself), and of a catalog file named in `mariadb.lsp.catalogFiles` while the server runs (`updateUserSettings` writes the test instance's settings.json, which VS Code watches); Format Document and the toolbar's format button with and without a selection; the Explorer's Outline (schema > table > columns and key, a view, a function) and a click on a symbol moving the cursor; an MSM script's `SOURCE` section in the Outline and in path completion. Needs a `mariadb-lsp` on the PATH, or `MARIADB_LSP=<path>` | `ui-test:lsp` |
| `msm` | `09-msm`: MariaDB Schema Management from the Explorer, a project created, released, scripted and deployed onto the sandbox, through the dialogs (see [msm.md](msm.md)). Its VS Code opens `files/workspace` (`WORKSPACE_SUITES`, `--open_resource`), the one suite with a workspace folder; `UI_TEST_WORKSPACE` names it | `ui-test:msm` |
| `restd` | `07-restd`: a second sandbox with the REST Service, its daemon serving and following it, Set Up MariaDB REST Daemon on the suite's sandbox, both deleted. Needs a mariadb-restd in the PATH, `~/.local/bin` or `~/.local/share/mariadb-restd` | `ui-test:restd` |

Each suite is one `extest setup-and-run` of its own: a fresh VS Code
profile, a work dir, shell home, ports and sandbox of its own.
`01-sandbox` (New Sandbox dialog, the `uitest` schema) and `99-cleanup`
(delete it) wrap every suite, so a suite can count on nothing another
did. No suite named runs them all, one after the other; a failing one
does not stop the next, and a summary says which failed. The files are
passed one pattern each, because ExTester adds the matches of one
pattern in no set order (`globSync(...).reverse()`). Arguments naming no
suite go to `extest`; `UI_TEST_GLOB` runs its files as one run without
the setup and cleanup. A new test file goes into a suite's `files`.
A suite is stopped after `UI_TEST_SUITE_MINUTES` (default 20; a value
that is not a positive number ends the run before it starts): ExTester
never exits when ChromeDriver fails to start, which it does when its
port is taken between being picked and bound (`bind() failed: Address
already in use` in `.vscode-test/extest/chromedriver.log`, "Server
terminated early with status 1" in the run) - which holds
the whole run. ExTester runs in a process group of its own, killed as a
whole - ExTester, its VS Code and its ChromeDriver - when the time is up
or the run is interrupted (`runGroup`). Neither Ctrl-C nor a closed
terminal nor a task's SIGTERM reaches a detached group, so the runner
handles SIGINT, SIGHUP and SIGTERM for the whole run: each kills the
running suite's group, the suites after it are not started, and the
runner exits with 128 plus the signal number after cleaning up. The
handlers stay installed, so a second Ctrl-C cannot kill the runner
before its cleanup, and an `exit` hook kills the group should the
runner end anyway. A spawn that fails is reported with its error.

- `ui-test/run.ts` builds a temporary work dir per suite, which is
  removed at the end, also after a failure. Sandboxes left running are
  pkill'ed first.
  - A shell home with the plugins of `../mariadb-shell-plugins` (or
    `MARIADB_SHELL_PLUGINS`) linked in and options.json
    `sandboxDir` + `credentialStore.helper: plaintext`. The keychain is
    the whole user's, so without the plaintext helper the test VS Code
    would show the user's own connections.
  - A `mariadb-shell` wrapper first on the PATH, setting
    `MARIADB_SHELL_USER_CONFIG_HOME`.
  - `MARIADB_LSP`, when set, is linked beside the wrapper as
    `mariadb-lsp`; the extension runs it with `--mcp`, so it needs no
    secret store helpers of its own.
  - `VSCODE_CLI=1`. Without it, VS Code on macOS takes the login shell's
    PATH and finds the user's shell.
  - All `VSCODE_*` / `ELECTRON_*` variables are stripped. An inherited
    `ELECTRON_RUN_AS_NODE` makes the test VS Code exit at once.
- The files, by suite above; within a suite they run in order and lean
  on each other:
  - `00-startup`: the first-start layout and the empty views (`core`
    only, before the sandbox exists)
  - `01-sandbox`: New Sandbox dialog, test schema; waits for the
    workbench itself, as it is the first file of `mrs` and `dump-load`
  - `02-mrs`: MRS end to end
  - `03-connections`
  - `04-sql-results`
  - `05-lifecycle`: sandbox stop/start, MCP restart and log
  - `09-msm`: MSM from the Explorer's folder menu (see msm.md); the
    Explorer is a `DefaultTreeSection`, so it has helpers of its own
    (`explorerItem`, `explorerSubmenuEntries`, `explorerMenuAction`,
    `openExplorerDialog`)
  - `06-dump-load`: Dump and Load (see dump-and-load.md); a second
    sandbox on `UI_TEST_PORT2` to copy to, deleted again. It checks the
    server's state with the shell on the command line, outside the UI.
  - `99-cleanup`: drops the sandbox

  `.mocharc.json` has `bail`: a failure ends its suite, skipping
  `99-cleanup`, and the work dir removal and pkill clean up instead.
- Helpers live in `ui-test/lib/ui.ts`. `openSection` collapses the
  other MariaDB views and expands the one asked for: with three views
  sharing the side bar, deep Connections rows were out of sight (and
  collapsing only one view gives its height to the next, not to
  Connections). It takes another view container too
  (`openSection("Outline", "Explorer")`). `08-lsp`'s `sqlEditor` uses
  the Connections view opened once in `before`, so a test that shows
  another container puts the MariaDB view back in a `finally`; having
  `sqlEditor` open the view on every call instead made the completion
  tests fail now and then, for no cause that was found. Timeouts are short on purpose
  (TIMEOUT 10 s, SERVER_TIMEOUT 15 s, DEPLOY_TIMEOUT 90 s), and dialogs
  fail at once on an in-dialog `.message.error` or an error
  notification. Screenshots go to `.vscode-test/extest/screenshots`.
- ExTester traps:
  - The tests drive the real window: typing or clicking on the machine
    while they run makes them fail. An occasional "element not
    interactable" in the command palette, or a completion timeout, that
    passes on a rerun is that kind of flake, not a defect.
  - VS Code's Outline sorts by position: an inline `PRIMARY KEY` is
    listed right after its column, so a test that wants the keys last
    declares them in a clause of their own.
  - Tree rows are virtualized and their DOM is reused. Re-find a row by
    label and `aria-level` (`treeItem`); never hold on to one.
  - Context-menu clicks are sometimes lost when a tree refresh closes the
    menu. `menuAction`, `openDialog` and `menuConfirm` retry 3×, as the
    Explorer's `explorerMenuAction` does: one loop, `menuActionOn`, given
    how to find the row afresh.
  - A webview that has closed answers lookups with nothing, so
    `submitDialog` checks the editor tab from outside.
  - Palette commands do not reach a focused webview: bring an editor
    tab to the front first.
  - A command hidden from the palette (`menus.commandPalette` `when:
    false`, such as Refresh Connections) cannot be run with
    `runCommand`: ExTester types its title and presses Enter on whatever
    matches instead. Click the view's toolbar button (`getAction`).
  - New Sandbox in `01-sandbox` now and then fails with "stale element
    reference" while a field is typed into: the dialog redraws when its
    server version list arrives. A rerun passes; it is not the suite's
    own test failing.
  - Tabulator rebuilds its cell editor right after the click. Type into
    `switchTo().activeElement()`, not into an element found earlier.
  - Untitled SQL editors would ask "Save changes?" when VS Code closes.
    Use "View: Revert and Close Editor".
  - Elements hidden until hover (the data mapping flags) need
    `driver().actions().move({origin})` first.
  - VS Code ignores a context-menu pick that comes right after the menu
    opened; `contextMenu` waits 200 ms before selecting.
  - `WebView.findElements` is Selenium's element method. It searches under
    the frame's element in the workbench and fails with "element not
    found" once inside the frame. Use `findWebElements`.
  - A connection closed while its row is expanded keeps the row expanded
    and empty. `treeItem` collapses and expands it again to reconnect.
  - ExTester cannot read the rows of an empty tree: `getVisibleItems`
    throws "element not interactable". Wait for a row to be gone with
    `hasTreeItem` instead.
  - Quick work can close a dialog before its progress bar is seen, or
    while the bar and the buttons are being looked at (an MSM create
    takes 7 ms); `submitDialog` accepts both where the dialog has closed
    (`isGoneWebviewError`: no such element, a stale one, a detached frame),
    but a dialog still open must show the bar.
  - The Explorer compacts a folder holding one folder into one row
    (`projects / msm_shop.msm.project`); `ui-test/settings.json` turns
    `explorer.compactFolders` off so each folder is a row to right-click.

## Debugging in VS Code

`.vscode/launch.json` is folder scoped, so its `${workspaceFolder}` resolves
to the repository root both when it is opened as a plain folder and when
`Extension.code-workspace` is opened.

### F5 builds once; the watcher is asked for

`preLaunchTask` is the **`build`** task - `npm run build`, which cleans
`dist/` and rebuilds the extension and both webviews in under two
seconds. It names the task rather than using `${defaultBuildTask}`,
because other folders of the multi-root workspace declare a default build
task of their own.

It is not the **`watch`** task, although a watcher is the faster way to
iterate, because **a background task's problems outlive the build that
reported them.** VS Code holds a background matcher's collection until it
sees the task's `beginsPattern` again, and a rebuild does not reliably
retrigger that: an esbuild error from a half written file - which is what
a watcher sees of any save made part way through an edit - can sit in the
Problems panel long after the file is correct, pointing at lines that no
longer exist. `Tasks: Restart Running Task` is what clears it. The one
shot task reports through the same matcher with **no `background` block**,
so every run clears what the last one said.

Both tasks report under `owner: "vite"`, which is deliberate: they share
one collection, so building also clears whatever a watcher left behind.

The watcher is still there - it is in the build group, just not the
default one, so `Tasks: Run Task` -> `watch` starts it when a debug
session is going to be reloaded (`Developer: Reload Window` in the
extension host) rather than relaunched. Two things about it are
deliberate and easy to undo by accident:

- It depends on a separate `build: webview` task rather than chaining the
  webview build into the watch script. The webview build prints
  `built in ...`, which would satisfy the watcher's `endsPattern` and let
  the extension host launch before `dist/extension.js` had been written.
  (F5 does not launch behind it, but ending the task early would
  still report a build as finished before it was.)
- Its `endsPattern` matches the failure lines (`Transform failed`,
  `error during build`, `Could not resolve`) as well as `built in `. A
  failed rebuild never prints `built in `, so without them anything
  waiting on the task would wait for a build that never finishes. It
  deliberately does **not** match `watching for file changes`, which vite
  prints *before* the first build.

Note that the watcher rebuilds the **extension only**. The webviews are
built once by `build: webview`; `npm run watch:webview` watches those.

`webview/test/setup.ts` installs two sets of stubs, and the second is
easy to overlook: besides the `acquireVsCodeApi` bridge the frontend
takes at module load, it supplies `ResizeObserver` and the `scrollBy` /
`scrollIntoView` methods, which **jsdom does not implement at all**.
The page measures its tab strip and scrolls a tab into view; without
the stubs those calls throw inside an effect, where the failure is easy
to miss and every assertion after it is made against a page that never
finished rendering. They measure nothing - jsdom reports every element
as zero sized - so a test that needs a size states it itself, as
`App.test.tsx` does for the tab strip's paging.

The problem matcher parses esbuild's `<abs path>:<line>:<col>: ERROR: msg`
form, which is uppercase and absolute - hence `fileLocation: "absolute"`.

## F5 hangs with "Extension host did not start in 10 seconds"

That line, in the development window's `renderer.log`, together with
`Could not connect to debug target at http://localhost:<port>` from
`ms-vscode.js-debug` in the launching window's, means the debugger never
attached to the `--inspect-brk` extension host. None of the extension ran:
there is no MariaDB output channel and no install progress. It is not the
shell download - check the logs under
`~/Library/Application Support/Code/logs/<session>/window*/renderer.log`
before looking at `src/shell/`.

Seen on **VS Code 1.139.0** (js-debug 1.117.0): a known regression,
[vscode-js-debug#2420](https://github.com/microsoft/vscode-js-debug/issues/2420).
js-debug probes `127.0.0.1` and `[::1]` in parallel; the inspector listens
on IPv4 only, the IPv6 refusal comes back first as an error type it does
not expect, and that cancels the IPv4 probe that would have worked. No
launch.json setting avoids it. The fix is going back
to 1.138.0 (`https://update.code.visualstudio.com/1.138.0/darwin-arm64/stable`)
with `"update.mode": "none"`; Run Without Debugging (Ctrl+F5) also works
on 1.139.0, since nothing waits for a debugger.
