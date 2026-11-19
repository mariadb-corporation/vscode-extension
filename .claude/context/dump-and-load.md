# Dump and Load

The Dump and Load submenu on connection, schema and table rows, its dialog,
the background tasks and the Tasks view.

Part of [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md). The server side is in
the MCP plugin's own `context/util.md` (the `util.*` tools, which start the
tasks) and `context/dba.md` (the `task.*` tools, which follow them), and in
the shell's `context/task-manager.md` (`mysqlsh.task_manager`, the task
library every plugin shares). The server runs each `util` task in a MariaDB
Shell process of its own.

**Tasks are the shell's, not the util group's.** One set of tools follows
every task, whichever group started it: `task.get`, `task.list` and
`task.cancel`. A task has a `task_type`: `util` for a dump, load, copy,
export or import, `dba` for a cloud deployment or deletion (kinds
`deploy_object`, `delete_object`; no `connection_id`, but `vendor`,
`project` and `object_type`). The `util.*` start calls still answer
`{task_id, status}`. There is no fallback to the `util.get_task`,
`util.list_tasks` and `util.cancel_task` of older servers; the shell floor,
26.11.0, is the first release with the `task.*` tools (see
[shell-and-mcp.md](shell-and-mcp.md)).

| File | Purpose |
| --- | --- |
| `src/mcp/utilApi.ts` | `IUtilApi` / `UtilApi`: the nine `util.*` tools that start a task, typed, and `util.inspect_dump` (`inspectDump(url, schema?)` → `IDumpInfo`), which reads a dump's metadata at once, without a task. Start calls get a 2 min timeout (they check the connection first). `loadDump` takes `extraction_budget_mb` out of the options and sends it as the tool's own argument (zip only). |
| `src/util/dumpSelection.ts` | Zip dumps and the Load dialog's Objects tab, pure and shared with the webview: `withZipSuffix` (`.mariadb.dump.zip` on or off the path), `dumpProblem` (where a dump may be loaded), the boxes' keys (`schemaKey`, `groupKey`, `objectKey`, `USERS_KEY`, `userKey`), `initialExcluded`, `partlyTicked` (the rows to show partly ticked, from the unticked keys alone), `loadFilters` (unticked boxes → `excludeSchemas`/`excludeTables` (views too)/`excludeRoutines`/`excludeEvents`, `loadUsers` + `excludeUsers`, and `schema` for Load Table Dump; names via `filterName`, quoted only where needed), `schemasToComplete` / `withFullSchema` (names cut at 100), `dumpSummary`. `ZIP_SUFFIX` / `isZipDump` live in `utilApi.ts`, the tools' own rule. |
| `src/util/dumpInspection.ts` | `DumpInspection`: a load dialog's dump, which `UtilCommands` gives the panel (`IUtilDialogHost.inspection`) - the reads (only the newest counts; a new dump's message carries the boxes to start with), a schema's every name read once per dump and merged into the dump as it is then, and `loadOptions` (the checks, the schemas to complete read in parallel, `loadFilters`). The panel only forwards the dialog's messages to it. |
| `src/mcp/taskApi.ts` | `ITaskApi` / `TaskApi` (`McpSession.taskApi`): `task.get`, `task.list` and `task.cancel`, and the task state of either type (`ITaskState`, `TaskKind`, `isFinished`). `getTask` asks the server to wait `WAIT_MS` (2 s) and gives the call 30 s more than that. `listTasks(taskType?)` leaves `task_type` out for all; nothing calls it yet. Generic, for the dba UI to come too. |
| `src/util/utilFields.ts` | Per operation: the dialog's title, path or target, and the utility's options with the shell's own defaults. `buildUtilOptions` sends only what differs from a default, so the shell stays the one deciding defaults. Pure, shared with the webview. |
| `src/util/utilProtocol.ts`, `utilDialogPanel.ts` | The dialog's messages and panel. Browse opens the folder or file picker. Start checks the values again, calls the host's `start` and closes once the task runs; a failed start stays in the dialog with the reason. One dialog at a time; a new one replaces it. |
| `webview/src/UtilDialog.tsx`, `DumpObjects.tsx`, `util.tsx`, `utilStyles.css`, `vite.util.config.ts` | The dialog: path with Browse, or the copy's target; Basic and Advanced tabs, and a load's Objects tab first (`DumpObjects`: the dump's tree of boxes) under a summary of the dump; a progress bar and disabled buttons while the start call runs. Its own bundle. `dialogStyles.css` holds what it shares with MSM and New Sandbox: the path row, the boxes' columns, a hint turning into its problem. |
| `src/util/taskMonitor.ts` | `TaskMonitor.follow`: polls `getTask` (`task.get`) until the task ends, writes its messages to the *MariaDB Tasks* channel, and drives a cancellable notification (Cancel calls `task.cancel`). It takes an `ITaskApi`, not the util one. The server answers as soon as a task changes, and a dump reports progress many times a second, so the monitor waits out the rest of `POLL_INTERVAL_MS` (1 s) after a quicker answer: asking again at once redrew the Tasks view so often that a click on a row's Cancel was lost (found by the UI test). A task keeps its dialog's title; the server's names the path. The bar only moves for stages that carry `items` (bytes or rows); counting stages show just their name. A task the server forgot (restart) ends as failed, "Lost track of the task": `task.get` answers a tool error ("There is no task with the id ..."), which is final, where a call that goes unanswered is asked again. It only follows the tasks it started, all `util` ones, so a `dba` task never reaches it, the Tasks view or the Actions tab. |
| `src/util/tasksTreeProvider.ts` | The Tasks view (`mariadb.tasks`, third in the MariaDB container): newest first, state or stage plus percent, the stages in the tooltip (✓ completed, ↷ skipped: a stage that did not do its work, such as an online ALTER step the server refused or a limit ruled out, from mariadb-shell #130 on); Cancel inline on running rows, Resume on resumable ones, Remove on finished ones, Show Output and Clear Finished on the title bar; a click (and Show Log in the menu) opens the task's own log. `showRunningTasks` sets the view's message ("Closing or reloading this window stops the running tasks...") and a badge with the count while tasks run. |
| `src/util/taskActions.ts` | `TaskActionLog`: each task as a row of its connection's Actions in the panel (`ResultViewProvider.putAction`, which replaces a row by id and does not reveal the panel). A `run` row, filed under `UI Backend`: the dialog's title, the stage and percent (or how it ended) as its summary, `pending` while it runs. Under it only what it came to: every warning and error as a row of its own, and the totals the shell ends with (`resultText`: total duration, schemas/tables dumped, rows written, data size, "... were loaded in", "N warnings were reported", "Total rows affected") gathered into ONE row with a line each, `multiline` - shown in full, the row as tall as its lines, like a failed statement's error (`.fullRow` in the grid); the steps along the way and the `util.*` call are left to the log, after the user found the panel far too verbose. A failure ends with its error as a child, pointed at by `jumpToRowId`, as a failed SQL run does. Times are the extension's own (the server's have whole seconds). Fed by `TaskMonitor.onDidReport` (`first` on its start), which strips the terminal colour codes a copy puts on its SRC:/TGT: prefixes. |
| `src/util/taskLogs.ts` | `TaskLogs`: a log file per task in `<storage>/task-logs/<task id>.log`, `<storage>` being the workspace's own storage (`context.storageUri`, as the task list is in `workspaceState`), or the global storage in a window without a workspace - a header (title, connection, call, start), each message as it comes, and how it ended. Survives a reload, where the output channel and the server's messages do not; an open editor follows the file as it grows. Deleted when the task leaves the Tasks view: `prune`, on every change of the list, deletes only the logs of tasks this window listed or wrote, so windows sharing the global storage keep each other's; `sweep`, on activation and only in the workspace's own storage, deletes every log whose task is not listed (those the list lost when cut to its newest 50). The failure notification's button is Show Log (`TaskMonitor.openLog`). |
| `src/util/utilCommands.ts` | The ten commands (Load Table Dump, `mariadb.loadTableDump`, on schemas) and the four task commands. The connection id is the tree's own session (`UI_BACKEND_SESSION`). The server runs each task in a shell process of its own, so the tree keeps working while it runs. Multi-select: the schemas or tables of the selection on the same connection (and schema); the selection is matched by row, not object. Load, import and copy refresh the tree once done, unless they failed, and have the SQL language server read the changed connection's catalog again (`refresh(uri)`: the target's for a copy). |

Notes:
- Start checks a dump folder first (`dumpFolderProblem`): one that is not
  empty, or a file, keeps the dialog open with the reason, rather than letting the dump
  start and fail after the dialog closed. Copy targets are shown
  by address (`IUtilTarget`), sent by URI.
- Dump folders default to `<first workspace folder or home>/<name>-<YYYY-MM-DD-HHMM>`,
  an export to `<schema>.<table>.tsv` there. `exportTable` quotes names that
  need it.
- Copy targets are the configured connections other than the source; the
  target is connected (tree session) only when Start is pressed.
- **Tasks end with the window.**
  - The MCP server is a stdio child of the extension host, and a task is a
    thread in that server, so a reload or close stops every running task: a
    dump is left incomplete, a load partway (resumable), and a copy cannot
    resume.
  - The server's one-hour retention only helps a server that keeps running
    (HTTP).
  - VS Code gives no chance to warn before a window closes, so the view
    says it while tasks run.
- **The task list survives a reload.**
  - `TaskMonitor` keeps it in `workspaceState` (`TASKS_KEY`, the newest 50,
    without messages): at once when a task comes or goes, or its status,
    cancelling or interrupted changes; a change of progress only at most
    every `SAVE_INTERVAL_MS` (5 s), and a pending one on `dispose`.
  - On activation, a task that had not ended is marked `interrupted` (icon
    `debug-disconnect`) and counts as over: Remove, Clear Finished.
- **Resume Load** (`mariadb.resumeTask`):
  - offered for a load that did not complete (interrupted, failed or
    cancelled; context `mariadbTask.finished.resumable`);
  - starts `util.load_dump` again with the same folder and options, minus
    `resetProgress`, so the shell resumes from the dump's progress file;
  - the new task takes the old row's place.
- Not done: copying between connections from the palette.
- **UI tests**: `ui-test/tests/06-dump-load.test.ts`. They cover dump, load
  into another schema, zip dumps and loads (see below), export, import, cancelling a slow dump from the
  Tasks view, a dump into a folder that is not empty, a copy to a second
  sandbox, and Clear Finished Tasks. The MRS tests of the same run need
  shell 26.10.3 or later (mariadb-shell #71).
- Tests:
  - `src/test/util/` (fields, selection, monitor + view, commands driven
    through the dialog panel);
  - `src/test/mcp/utilApi.test.ts`;
  - `webview/test/UtilDialog.test.tsx`;
- A one-off run against a real `mcp start-server --gui` deploys its sandbox
  in `~/.mariadb-shell/sandboxes` and stores its password in the real secret
  store even with `MYSQLSH_USER_CONFIG_HOME` pointing elsewhere; both have
  to be removed by hand. The plugin's `run_tests.py` isolates the secret
  store, which a one-off run does not.

## Zip dumps and what a load takes

The server side is the MCP plugin's `util.md` (zip dumps, `util.inspect_dump`).

- **Dump to Self-Contained ZIP File** is a `local` option of the three dump
  specs: never sent (`buildUtilOptions` skips it). Ticking it puts
  `.mariadb.dump.zip` on the path (the webview, `withZipSuffix`), switches
  the path's label to Output File and Browse to a save dialog; the path
  alone tells the tool it is a zip. The choice is kept per workspace
  (`IUtilCommandsHost.zipDumps`, `workspaceState` key `ZIP_DUMPS_KEY`), set
  when a dump starts, and the next dump dialog starts with it.
  `dumpPathProblem` refuses a zip that exists (the server would too, but
  only after the dialog closed).
- **Load Dump / Load Table Dump pick the dump first** (`pickDump`): one
  open dialog for files and folders on macOS; elsewhere VS Code's open
  dialog takes either, so a quick pick (ZIP File... / Dump Folder...) asks
  first. Nothing opens when nothing is picked.
- **The dialog reads the dump** (`spec.inspects`; `DumpInspection`): on
  open, after Browse and after a typed path's `change`, `util.inspect_dump`
  is called and `inspected` posted; only the newest read's answer is kept.
  Load stays disabled until the path's dump is read and `dumpProblem` has
  nothing against it: a dump not complete; a table dump from a connection
  (it says to use Load Table Dump); into a schema, anything but a table
  dump or a dump of ONE schema (an instance dump never; a dump whose
  `@.json` names no utility is taken when it holds one schema) (the shell's `schema` option takes nothing
  else - confirmed by the folder load UI test, a schema dump loaded under
  another name).
- **Load is disabled for what is ticked** (`selectionProblem`, said under
  the tree): nothing ticked, or a schema ticked with everything under it
  unticked (untick the schema itself to leave it out). A schema without
  objects, and names a list cut short did not show, count as ticked.
- **The Objects tab keeps what is UNticked** (`excluded`), sent with
  `start`; `DumpInspection.loadOptions` turns it into exclude filters (`loadFilters`), so names
  the inspection did not list (100 per kind) still load. Defaults: user
  accounts unticked (the shell's `loadUsers` default); loading one schema's
  dump into a schema, its functions, procedures and events unticked too. A
  whole kind unticked where its names were cut short: that schema is read
  with `schema=` first for every name (`schemasToComplete`), once per dump.
  Opening a cut-short list in the tree does the same, to show them. The
  shell's filters name the dump's schema, also under `schema`.
- `extraction_budget_mb` (Advanced) is moved to the tool's own argument by
  `UtilApi.loadDump`, and dropped there for a folder, which the tool
  refuses; `isZipDump(url)` decides, as it does for the tools.
- The Dump to Self-Contained ZIP File box starts as the path says
  (`initialUtilValues`), and the choice kept is the path's (`isZipDump`).
  `IStart.writesDump` / `revealOnStart` say what a dump and a load do in
  `#open`, rather than sets of operations.
- A zip partly loaded into another server fails with the shell's progress
  file mismatch: Start over (`resetProgress`) is the way out; its hint says
  so.
- **The Actions tab comes up as a dump or load starts** (and on Resume),
  `showActions(uri, false)`: at the task's row, which `TaskMonitor.follow`
  puts up at once, not at an older failure.
- UI tests: a schema dumped to a zip, the zip existing, the repository's
  `ui-test/assets/nations.mariadb.dump.zip` (zipped with a top folder, as
  Finder does) loaded with a table unticked, a table dump refused from the
  connection and loaded into a new schema, a folder with no dump in it
  refused. The asset is copied to the run's files first: a zip is
  extracted next to itself. The failed-task test dumps uitest afresh and
  loads it back under its own name: the first dump's folder holds the
  progress of the load into uitest_copy, and a load that resumes does not
  check for objects that exist. A box's input is named by its key, so
  `setChecked` finds it (`byName` quotes any name).

## A task that does not start

When the start call itself fails - no task id to follow - the failure is
a row of the connection's Actions of its own (`TaskActionLog.startFailed`:
the task's title, summary "Did not start", the call and the error as the
row under it), and the panel comes up on it (`IUtilCommandsHost.showActions`
via the dialog's `onFailed`). A dialog closed meanwhile notifies it too;
one still open shows it as before. Closing the dialog never stops a task:
the dialog closes itself once the task runs, and the task runs on in the
server's thread until it ends or is cancelled.

