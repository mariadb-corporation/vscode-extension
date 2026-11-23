# UI tests (ExTester)

The ExTester UI tests: the runner and its suites, the helpers, the
DevTools-protocol drags and their traps.

Part of [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md). The unit tests and
the F5 launch are in [testing-and-debugging.md](testing-and-debugging.md).

`MARIADB_SHELL=<path to mariadb-shell> npm run ui-test [suite...]`
drives a real VS Code through WebDriver. The shell loads `mcp_plugin`,
`rest_plugin` and `msm_plugin` from a mariadb-shell-plugins checkout:
`MARIADB_SHELL_PLUGINS`, or by default `../mariadb-shell-plugins` next to
this repository (so does `mrsShell.e2e.test.ts`). Before the extension
moved out of that repository the runner took its parent folder, which a
standalone checkout doesn't have. It uses vscode-extension-tester
8.28.1 and Mocha, on the newest VS Code (`--code_version max`).
`mariadbd` must be on the PATH.

**The VS Code under test** is the newest one the installed
vscode-extension-tester supports (`vscode-max` in its `package.json`), not
the newest release; `UI_TEST_CODE_VERSION` picks another. ExTester
downloads it once into `.vscode-test/extest/` (gitignored) and reuses it
while `Visual Studio Code.app` (`VSCode-<platform>` elsewhere) there
reports that version. Its download starts over on each retry and gives up
after five 5-minute timeouts, which a slow link to Microsoft's server hits.
Then fetch it with a resumable download -
`curl -fL -C - --speed-limit 10000 --speed-time 30` in a loop on
`https://update.code.visualstudio.com/<version>/darwin-universal/stable`
(other platforms' names alike) - and unpack it into `.vscode-test/extest/`
(`ditto -x -k` on macOS, which keeps the app's signature); ExTester then
skips the download.

**Split into suites by area** (the user's call: a change in one area
should not need the full run). `SUITES` in `ui-test/run.ts`:

| Suite | Files, between `01-sandbox` and `99-cleanup` | npm script |
| --- | --- | --- |
| `core` | `00-startup` (before the setup), `03-connections`, `04-sql-results`, `05-lifecycle` | `ui-test:core` |
| `mrs` | `02-mrs` | `ui-test:mrs` |
| `dump-load` | `06-dump-load` | `ui-test:dump-load` |
| `lsp` | `08-lsp`: a syntax error in the Problems view until it is fixed, completion of the sandbox's tables, which `mariadb-lsp` reads through the extension's MCP server (`mariadb/dbCall`), the walk from `SELECT ` through schema, table and column to the FROM clause and a foreign-key join, each on a line of its own one level deeper, as mariadb-lsp lays them out since lsp-server #11 (`pickCompletion` opens the list and clicks an item; a dotted item reopens it by itself), and of a catalog file named in `mariadb.lsp.catalogFiles` while the server runs (`updateUserSettings` writes the test instance's settings.json, which VS Code watches); Format Document and the toolbar's format button with and without a selection (the clauses one level deeper too); the Explorer's Outline (schema > table > columns and key, a view, a function) and a click on a symbol moving the cursor; an MSM script's `SOURCE` section in the Outline and in path completion. Needs a `mariadb-lsp` on the PATH, or `MARIADB_LSP=<path>` | `ui-test:lsp` |
| `msm` | `10-msm-projects` first, as a project created in the Explorer is listed in the view: the MSM Projects view - empty with its New / Open buttons, a project created from the toolbar (the save dialog names it, New MSM Project files and captions it, with a custom license found in the development script), its files opened with a click, the Explorer's operations on its row (the information from its inline icon), Edit MSM Project's tabs (version, the copyright's first year moved back and the notice following it, folder, MCP access: the row then says `0.1.0 · MCP`; an online schema change default, checked in `msm.project.json`), removed and added back from the Explorer, removed and opened with the open dialog. Then `09-msm`: MariaDB Schema Management from the Explorer, a project created (the side bar staying on the Explorer), released (Rename Schema... on its row then refused before a name is asked), scripted and deployed onto the sandbox, through the dialogs (see [msm.md](msm.md)). Its VS Code opens `files/workspace` (`WORKSPACE_FILES`, `--open_resource`); `UI_TEST_WORKSPACE` names it | `ui-test:msm` |
| `msm-diagrams` | `10-msm-projects` then `11-msm-diagrams`, without the sandbox: the project's snapshot from tables written into its script, New Schema Diagram, Add to Diagram, a table dragged from the tree placed where the pointer comes back (the figures checked in the saved script), and Auto Layout from the diagram's row and from the toolbar's menu (the saved places changing, a second action), Dump REST Client SDK Files... on a project's REST service row (a service written into Section 180, the view refreshed, no server: the setting's URL in the dialog, `msmProject` in `mrs.config.json`; the statements taken out again), and Rename Schema... with the diagram open: from the schema row (the rows, the folder, the script's file name and `msm.project.json` following, the viewer reopened as `Main (<new schema>)`, the script's editor on its new file, the rename an action), back from the project row, and the same name doing nothing. `11-msm-diagrams` also runs in `msm`, after `10-msm-projects` | `ui-test:msm-diagrams` |
| `restd` | `07-restd`: a second sandbox with the REST Service, its daemon serving and following it, Set Up MariaDB REST Daemon on the suite's sandbox, both deleted. Needs a mariadb-restd in the PATH, `~/.local/bin` or `~/.local/share/mariadb-restd` | `ui-test:restd` |

Each suite is one `extest setup-and-run` of its own: a fresh VS Code
profile, a work dir, shell home, ports and sandbox of its own. The
runner empties `.vscode-test/extest/extensions` before each suite:
ExTester installs the build under test there but never removes older
ones, and an older build with the same view containers (such as a
`mariadb-dev` build from before the extension's rename) registers them
first and hides the views under test - a UI test then times out waiting
for an activity bar entry.
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
    `sandboxDir` + `credentialStore.helper: login-path`. The keychain is
    the whole user's, so with it the test VS Code would show the user's
    own connections. The login-path helper keeps the secrets in the login
    file `MYSQL_TEST_LOGIN_FILE` names, the home's `.mylogin.cnf` (without
    it, the user's `~/.mylogin.cnf`). Release packages ship it; the
    plaintext helper, used before, is a development build's only, so a
    released shell could not be tested.
  - A `mariadb-shell` wrapper first on the PATH, setting
    `MARIADB_SHELL_USER_CONFIG_HOME` and `MYSQL_TEST_LOGIN_FILE`.
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
  - `03-connections`: the connection editor's connection, edited, then
    duplicated with `uitest` as its default schema (an unchanged copy
    refused first). On the duplicate: `uitest` drawn as the current
    schema (`schemaCurrent.svg`, read from the row icon's CSS
    `background-image`) without Set As Current Schema in its menu, the
    system schemas hidden and shown, Set As Current Schema on `mysql`
    and a new editor's `SELECT DATABASE()` answering `mysql`, a `USE
    uitest` run moving the marker back, Copy to Clipboard and Send to SQL
    Editor (Name, Create Statement) on a table and the schema, Drop Table
    / Drop Schema on a schema the test creates (`uidrop`, a Cancel
    first), Load SQL Script from Disk (its `SELECT DATABASE()` answering
    `uitest`), and the duplicate deleted. Then the default, the URI copy,
    folders, Disconnect and Delete on the original.
  - `04-sql-results`
  - `05-lifecycle`: sandbox stop/start, MCP restart and log
  - `10-msm-projects`: the MSM Projects view, before `09-msm` in the
    same suite, as it starts with the view empty
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
- **Webview frames are picked by the helpers**, not by ExTester:
  `FrontWebView` (dialogs, a maximized result) and `PanelWebviewView` (the
  MariaDB panel) take the frame that is displayed and centred in the editor
  area or the bottom panel (`frameShownIn`). ExTester's choice went into
  the MariaDB Overview (see overview.md), which `ui-test/settings.json`
  now keeps from opening with the view; `00-startup` opens it by command.
- **Drags go through the DevTools protocol** (`ui-test/lib/cdp.ts`):
  ChromeDriver's pointer actions start no HTML5 drag. `shiftDrag` presses
  and moves the mouse on the row with `Input.setInterceptDrags` on, takes
  the drag Chromium hands back (`Input.dragIntercepted`, the data VS Code
  put on it) and moves and drops it with `Input.dispatchDragEvent`;
  `moveMouse` moves the pointer. It talks to the workbench page found at
  ChromeDriver's `debuggerAddress` (`/json/list`) with Node's own
  `WebSocket`; Selenium's `createCDPConnection` takes the first page
  target, which need not be the workbench. The drag is held over the
  target with Shift (what VS Code asks for a drag into a webview) but
  **dropped on the title bar**, outside the webview: Electron refuses a
  drop into a webview, the drag Chromium handed over then never ends, and
  no input at all - mouse or keys, ChromeDriver's or the protocol's -
  reaches the workbench after it (scripts still run), so every test after
  a drag failed. Neither `Input.cancelDragging`, a `dragCancel` drag event,
  a `dragend` on the row nor a press and release frees it. The diagram
  does not need the drop: it places the table where the pointer next moves.
- **`ViewTitlePart.getAction(label)` never answers undefined**: it makes a
  button from the label whether there is one or not, and its click then
  fails with `NoSuchElementError`. A view that shares its container (MSM
  Projects with Object Details) has its toolbar in its section header, so
  match the label among `getTitlePart().getActions()` (`getTitle()`) and
  fall back to the section's `getAction`: `viewAction(section, label)` in
  `ui-test/lib/ui.ts` does.
- A dialog's tabs are picked with `selectTab` (`button[role='tab']`, what
  `TabStrip` renders), not `clickButton`, which takes any button of that
  text. A webview with no `h1` (the diagram viewer) is not an `inDialog`:
  open its editor and switch to it with `FrontWebView` yourself; a modal
  it raises (`showWarningMessage` with `modal`) is answered with
  `answerModal` after switching back.
- Helpers live in `ui-test/lib/ui.ts`, the SQL editors' among them: `sqlEditor(section, path, text)` (New SQL Editor on a connection's row, the text below its header), `setEditorBody` and `discardEditors(titled)` (each brought to the front, then reverted and closed). `08-lsp` keeps its own, whose body has no trailing newline. `openSection` collapses the
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
- **The test VS Code opens on a display of its own** where the Mac has a
  second one (`ui-test/lib/window.ts`; `UI_TEST_DISPLAY`: unset the
  second display, `main` the main one, a number that display, 1 being
  main). ExTester deletes the user data folder and writes it anew in one
  function right before launching, so the window's bounds
  (`windowsState.lastActiveWindow.uiState` in
  `User/globalStorage/storage.json`) are written from a wrapper around the
  one call in between, `codeUtil.getDefaultSettings`, installed as the
  test files load (`placeWindow`, from `ui.ts`). Both are internals: a
  version changing either leaves the window where VS Code puts it.
- **The focus goes back to the app that had it** (macOS): macOS gives the
  test VS Code the focus as it opens, so keys typed into another app
  landed in it. `rememberFrontApp` notes the front app (`lsappinfo`, no
  permission needed) as the test files load, and a root `before` hook of
  `ui.ts`, which runs after ExTester's has VS Code up, activates it again
  by its path (`open -a`), twice, 1.5 s apart. `UI_TEST_FOCUS=vscode`
  leaves the focus with VS Code.
- ExTester traps:
  - Now and then a suite fails in its first test with no
    `.monaco-workbench` element (`NoSuchElementError`), before anything
    of the extension's ran; a rerun passes. The cause is not known.
  - The simple file dialog completes a path being typed to an existing
    entry of the same start (`uitest.mrs.sql` to the `uitest.mrs.sdk`
    folder) and says it exists; confirmed before it checks the path as
    typed, it refuses it. `answerFileDialog` waits for the path and no
    such message before it confirms.
  - The tests drive the real window: typing or clicking in it while
    they run makes them fail. Keys and clicks go through
    ChromeDriver, not the OS, so another app may have focus meanwhile -
    but each suite's VS Code takes focus as it starts. One thing does go
    by the window's focus: VS Code closes a quick input - the command
    palette, `answerInput`, `pickQuick`, the simple file dialog
    `openResources` and `answerFileDialog` use - once its window loses
    focus, which was the "element not interactable" in the palette while
    the user worked in another app. `ui-test/settings.json` turns
    `workbench.quickOpen.closeOnFocusLost` off. The clipboard is
    the machine's: `03-connections` and `02-mrs` clear it and read what a
    Copy command put there (`clipboard()`), so copying meanwhile fails
    them. The runner keeps the clipboard's text and gives it back on exit
    (`saveClipboard` / `restoreClipboard` in `run.ts`; text only). A
    completion timeout that passes on a rerun is a flake of that kind,
    not a defect.
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
  - `inputUp` / `modalUp` (`ui-test/lib/ui.ts`) tell whether an input box or
    a modal is up; an input box left open by an earlier test is still
    found, so a test that expects none must not leave one. `answerInput("")`
    clears the box before confirming: with a `validateInput` that refuses
    an empty value, the box stays open. Type the value to accept it.
  - Palette commands do not reach a focused webview: bring an editor
    tab to the front first.
  - A command hidden from the palette (`menus.commandPalette` `when:
    false`, such as Refresh Connections) cannot be run with
    `runCommand`: ExTester types its title and presses Enter on whatever
    matches instead. Click the view's toolbar button (`viewAction`).
  - New Sandbox draws its fields empty at once and replaces them all when
    the host's load arrives (after reading the server versions, the
    connections and the certificate): typing before that is lost, or hits
    a stale element, and a lost port falls back to the suggested 3310,
    which a server of the machine's own may hold. `inSandboxDialog` opens
    it and waits for the suggested port, which the load always brings;
    every test opening New Sandbox goes through it.
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
    (`isGoneWebviewError`: no such element, a stale one, a detached frame,
    a script timeout),
    but a dialog still open must show the bar.
  - The Explorer compacts a folder holding one folder into one row
    (`projects / msm_shop.msm.project`); `ui-test/settings.json` turns
    `explorer.compactFolders` off so each folder is a row to right-click.
