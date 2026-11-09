# MariaDB Schema Management (MSM)

The Explorer's **MariaDB Schema Management** submenu on folders: creating a
schema project, and on a `*.msm.project` folder its information, a release,
its deployment script, deploying it and adding it to the MSM Projects view.
The MSM Projects view lists the projects the user works on, with the same
operations on its rows. Each opens a dialog; each thing done is an action of
the Actions tab.

Part of [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md). The server side is the
MCP plugin's `msm` group (`mcp_plugin/lib/msm_functions.py`), which wraps
`msm_plugin/management.py`.

| File | Purpose |
| --- | --- |
| `src/mcp/msmApi.ts` | `IMsmApi` / `MsmApi`: the seventeen `msm.*` tools used, typed (the five of the schema diagrams - `list_` / `get_` / `set_schema_diagram(s)`, `get_schema_diagram_image`, `edit_schema` - are the diagram viewer's, see modeler.md) (the list's four, read with `listedProject`: an unknown color dropped, a missing `mcp_access` read as true, as the server reads an old entry); `msmToolArgs`, each tool's arguments by the server's names, which the Actions tab shows the call with (all but `connection_id`). `MSM_LICENSES` (no tool lists them: kept in step with `msm_plugin/templates/license`, which a test checks when a plugins checkout is beside this repo). Deploy gets 30 min. |
| `src/msm/msmFields.ts` | Pure, shared with the webview: per dialog its values, defaults and `*Problem` checks, version parsing / comparing (numbers, so 1.10 > 1.9), `projectFolderName` as the plugin names it. |
| `src/msm/msmProtocol.ts`, `msmDialogPanel.ts` | The dialog's messages and panel, a `DialogPanel` typed by the dialog's kind: one at a time, checks the values again (and `host.check`, the disk) before `host.submit`; a failure stays in the dialog, or is notified once it was closed. |
| `src/msm/msmCommands.ts` | `MsmCommands`: the dialogs' six commands and the list's four (`MSM_LIST_COMMANDS`), reading the project, the work as `ActionGroup`s (`src/restd/actionGroup.ts`); `changedDetails`, what an add or update sends. |
| `src/msm/msmProjectsCommands.ts` | The MSM Projects view's refresh and folder commands (`MSM_FOLDER_COMMANDS`): New / Rename Folder, Set Folder Color, Remove Folder. |
| `webview/src/MsmDialog.tsx`, `msm.tsx`, `msmStyles.css`, `vite.msm.config.ts` | The dialog, one component for the five kinds; its own bundle, on `dialogStyles.css` as Dump and Load's and New Sandbox's. |
| `src/tree/msmProjectsTreeProvider.ts` | The MSM Projects view: folders, projects, each project's schema row (its Diagrams folder from `msm.list_schema_diagrams`, a shell without it shows none and logs it; its tables, views and routines from msm's snapshot, see [object-details.md](object-details.md)) and files; drag and drop; the folders, collapsed folders and folder colors it keeps itself. |

## The MSM Projects view

Its own activity bar container, `mariadb-msm`, titled "MariaDB Schema
Management", with the icon `images/activityBar-msm.svg`; its one view is
MSM Projects (`mariadb.msmProjects`).

- **The list is the server's**: msm_plugin keeps it in
  `plugin_data/msm_plugin/projects.json` (mariadb-shell-plugins #80), read
  with `msm.list_projects` and changed with `msm.add_project` /
  `update_project` / `remove_project`. Each entry is the project folder's
  path with a list `folder`, `caption`, `color` (the connections' six) and
  `mcp_access`; the listing also carries each project's
  `development_version` (null where the server could not read it, which
  leaves it out of the row). The provider lists once per refresh - one call,
  no project read per row - and keeps the listing until the next; New
  Folder and Remove Folder change only what is kept here, so they redraw
  without listing again. A project's `folder` is put through
  `normalizeFolder` as it is listed: another client may write `Shop/`,
  and folder rows compare normalized paths. `folders()` (New MSM
  Project's folder list) answers from the listing kept, or with the New
  Folder folders alone where there is none yet, so opening the dialog
  from the Explorer never waits for the server to start. A project's
  files that cannot be read are reported as that folder's read, not as
  the listing failing (`whatFailed`).
- **Rows.** Folders first (sorted), then projects by label: the caption,
  else the schema, else the folder name without `.msm.project`. A project's
  description is its development version, and ` · MCP` after it where LLMs
  may work on it (the user's call: like a connection row's `· MCP`);
  `missing` for a folder that is gone, which then only offers Remove (inline
  and in the menu, `contextValue` `mariadbMsmProject.missing`). A colored
  project carries `colorUriOf(color, "msmProject", path)`, drawn by
  `ConnectionColorDecorations`. A project expands into its folder's files
  (folders first, `node:fs` `readdir`), each with its own `resourceUri` so
  the theme's file icons show, a file opening with `vscode.open` on a click;
  rows have `id`s (`msmFolder:`, `msmProject:`, `msmFile:` + path), and
  `getParent` serves `reveal`, which shows a project once it is added, or
  created from the view. `TreeView.reveal` opens the view's container, so a
  project created from the Explorer is revealed in the Explorer only
  (`createProject`'s `from`), keeping its side bar; Add to MSM Projects
  does switch to the view.
- **Folders work as the Connections view's** (see connection-folders.md):
  the server knows a folder only as where a project is filed, so New Folder,
  the collapsed folders and the folders' colors are `FolderSet` /
  `FolderColors` in `globalState` under `mariadb.msmProjects.*` keys of their
  own (`FolderColors` took a key argument for it). Every other row left
  expanded (project, schema, Diagrams, object groups, a project's files)
  is kept by item id (`ExpandedRows`, `mariadb.msmProjects.expandedRows`)
  and drawn expanded after a restart, which VS Code does not do for an
  extension's tree; the rows of projects no longer listed are forgotten
  on the next listing (`rowIdOf` makes the ids, `isRowOf` matches a
  project's, so `/a/p` is not taken for `/a/p2`). Drag and drop on a MIME of
  its own (`application/vnd.mariadb.msmprojects`) moves projects and whole
  folders with one `msm.update_project(new_folder=)` per project that moves,
  sent one at a time: each call rewrites the server's one `projects.json`
  and the MCP connector does not serialize calls, so parallel ones lose
  moves (`fileConnections` does the same for connections). Rename Folder
  goes through the same `#refile`. Remove Folder is on an
  empty folder only. No New Folder with Selection.
- **The toolbar**: New MSM Project... (`+`), Open MSM Project..., New
  Folder..., Refresh. New asks with `showSaveDialog` for the project
  folder - its folder is where it is created, its name (`.msm.project` taken
  off, `schemaNameOfFolder`) the schema - then opens New MSM Project on that,
  filed in the selected row's folder (a toolbar command gets the focused
  row). Open takes a folder, or on macOS its `msm.project.json` too: only
  macOS has a dialog that picks files and folders, so elsewhere
  `canSelectFiles` is off. Both are on a folder row's menu
  too, and the welcome content has them as buttons.
- **The welcome content** follows `ViewStateTracker` (`viewState.ts`), as
  the Connections, Sandboxes and Deployments views' does, on the context
  key `mariadb.msmProjectsView`: `looking` and `installing` while the
  server starts (the provider is given its `status`), `failed` when the
  listing failed (logged, not notified; Show Log and Retry), `listed`
  (New and Open as buttons), and `unsupported`, which the tracker has for
  this view: a shell without the list answers `Unknown tool:
  msm.list_projects` (`msm_list_projects` under `--toolNameSeparator=_`;
  `isUnsupportedShell` matches `msm[._]`). Logged without an error message,
  the welcome content asks for a newer MariaDB Shell; New, Open and New
  Folder leave the toolbar, Refresh stays. A server started again clears
  `unsupported` and `failed`, as it may be a newer shell.
- **New MSM Project's list settings**: Folder (a `<datalist>` of the view's
  folders), Caption, Color (the swatches of the connection editor) and Allow
  MCP Access, off by default. All of them go with `msm.create_project`, in
  the one call and the one Actions-tab step (the plugin checks them before
  the folder is made, mariadb-shell-plugins #80); only what differs from a
  new project's place - the top level, no caption or color - is sent. The
  Explorer's New MSM Project has them too.
- **Edit MSM Project** (a project row's menu; `MSM_COMMANDS.edit`, kind
  `edit`) shows the schema, license and copyright as read, and edits the
  development version (`msm.set_development_version`, not below the last
  release) and the list settings; Update sends only what changed
  (`changedDetails`, the folder through `normalizeFolder` and the caption
  through `normalizeCaption` on both sides, so `Shop/` against `/Shop` is
  no change). The entry comes from the row it was used on, else from the
  view's last listing (`listedProject`, the host's hook over `projectAt`):
  no second listing. It is not in the Explorer submenu: it edits a list
  entry, which an Explorer folder may not have.
- **MCP access**: the server refuses every path of a project whose entry
  says no to any MCP server without `--gui` (see mcp_plugin's
  `context/siblings.md`), so the `--gui` server of this extension is the
  only one that reaches it; only that server offers the argument.

## The commands

| Command | Shown on | Does |
| --- | --- | --- |
| `mariadb.msm.createProject` | A folder NOT named `*.msm.project` | New MSM Project: schema name, license, copyright holder, the folder (Browse), Create the Folder / Allow Special Characters / Replace Existing Project. Opens `development/<schema>_next.sql` and reveals the project folder in the Explorer. |
| `mariadb.msm.showProjectInformation` | `*.msm.project` | The project's information, with buttons to open the development script and to go on to the three dialogs below (in its place). Replaces the old extension's JSON document. |
| `mariadb.msm.prepareRelease` | `*.msm.project` | Release version (the development version) and next version (its patch + 1, following the first until typed into), Stay on the Same Version, Replace Existing Files. Opens the files written. |
| `mariadb.msm.generateDeploymentScript` | `*.msm.project` | A released version (newest first, marked where it has a script), Replace Existing File. Opens the script. |
| `mariadb.msm.deploySchema` | `*.msm.project` | Connection (the configured ones; the default connection, or the only one, preselected), version (those with a script), Back Up the Schema First (default on) and its folder (empty: the project's `backups`). Refreshes the tree and the language server's catalog after. |
| `mariadb.msm.openSchemaDiagram` | `*.msm.project`, a project row, its Diagrams folder and diagrams | Open Schema Diagram...: the diagram viewer on one of the project's schema diagrams (a pick where it has several; a project without any offers New Schema Diagram...), saved through msm as it is changed; see [modeler.md](modeler.md). |
| `mariadb.msm.newSchemaDiagram` | A project row, its schema row, and its Diagrams folder (inline `$(add)`, before Open) | New Schema Diagram...: asks for a name ("Diagram 1", numbered past the names in use; a taken one is refused), adds an empty diagram with `msm.create_schema_diagram` and `tables: []` (left out, msm would place every table), refreshes the view and opens the diagram to model on with the tool palette. msm makes the schema snapshot first where the script changed, so a brand-new project with no tables gets one too, and the palette's edits work at once. |
| `mariadb.msm.renameSchemaDiagram` | A diagram row (`1_edit@0`; not in the palette) | Rename Schema Diagram...: asks for the new name (`diagramNameProblem`, shared with New Schema Diagram: empty, `schema_definition` (the snapshot row's) or another diagram's in any case are refused; a case-only rename is one), then `ProjectModelSource.renameDiagram`: saves what waits, `msm.rename_schema_diagram` (one write, pictures kept: get + set + remove would lose them, `set_diagram` keeps pictures only under the same name), changes made meanwhile follow the name. Its kept view moves (`DiagramViews.rename`), the tree refreshes, an open viewer follows (`ModelerPanel.renamed`). Needs the msm tool; without it msm's unknown-tool error is reported. |
| `mariadb.msm.deleteSchemaDiagram` | A diagram row (`1_edit@1`; not in the palette) | Delete Schema Diagram...: a modal confirmation, then `ProjectModelSource.removeDiagram`: drops the diagram's pending save and draft (either would make it again), `msm.remove_schema_diagram` after a save under way. Its kept view goes, the tree refreshes; an open viewer reads the model again (showing the first diagram where the shown one went) or closes where none is left (`ModelerPanel.close`). |
| `mariadb.msm.updateSchemaSnapshot` | A project's schema row (inline `$(refresh)`, and its menu) | Update Schema Snapshot: `msm.update_schema_definition`, then the view and the project's open viewer read it again. Hidden from the palette. |

From the palette, create starts in the first workspace folder (or home),
and the others ask for the project folder with a folder picker. The old
MySQL Shell extension (`gui/extension/src/MsmCommandHandler.ts`) did the
first four with input boxes one after another; Deploy is new.

## Decisions

- **Every operation is an action**, the project read included (the user's
  request): `ActionGroup` puts a run row with a row per call under it,
  each showing the call (`msmCall`, through `callArguments` as every
  other call: `msm.prepare_release(version=0.0.1, next_version=0.0.2)`)
  and, once done, what it came to; `ActionGroup.run` ends the whole as its
  steps went. Reading a project is "Read MSM project <folder>" with three
  steps (information, released versions, deployment scripts). File work is filed under General Actions;
  a deploy under its connection, with `db.connect` as its first step.
- **A deploy runs on a session of its own** (`MSM Deploy <n>`, numbered as
  deploys may overlap), closed once it is done however it went, never on
  the tree's `UI Backend`: a deployment script can run for half an hour,
  a backup dump first, and changes the session's schema, which the
  Connections view and completion would otherwise wait behind and see.
- **What the work wrote is shown once its dialog closed** (`#afterwards`):
  a file that cannot be opened is a notification of its own, not the work
  failing - the work was done, and doing it again would be refused. A new
  project is read back the same way, as an action of its own ("Read the
  new MSM project ..."): the creation is done once the folder is.
- **A deploy has the tree and completion read the server again however it
  went**: a script that failed partway may have made the schema already,
  or a backup been loaded back.
- The `~` of a typed target folder is the home folder, as the plugin reads
  it; a relative one is the server's to resolve, so it is not checked.
  Versions with leading zeros are refused: the plugin names a release's
  files by the version text. A
  failure ends the group failed, brings the panel up on it
  (`showActions`), and is shown in the dialog.
- **Lists of versions come from `structuredContent`**: the version tools
  answer with a list of `[major, minor, patch]`, which the text items
  flatten, so `decodeList` reads the structured result where one is sent
  (see the wire format in [shell-and-mcp.md](shell-and-mcp.md)).
- **A project is read before each dialog**, its information first (it says
  whether the folder is a project at all), then its releases and its
  deployment scripts side by side. The information dialog's buttons go on
  with the project as read, not reading it again.
- **The dialog checks what the plugin would refuse**, beside its field,
  before calling it: a version below the last release, a next version not
  above it (unless staying), a version released or scripted already
  (unless replacing), a project folder that exists, a target folder that
  does not. The schema-name rule (basic Latin, digits, `$`, `_`; not digits
  only; 64 at most) is checked here too: a shell whose bundled plugin
  predates mariadb-shell-plugins #67 has `check_mysql_identifier` inverted
  (it checks only when special characters are allowed, so `123` passes
  it), and even a fixed one says so only after a round trip.
- A problem shows once its field is typed into, or for all on the button;
  a problem with no field (nothing released yet) at once.

## Known gaps

- **Releasing under another version than the development one** broke the
  schema's version in msm_plugin before mariadb-shell-plugins #67 / #68:
  `prepare_release(version='1.0.0')` on a 0.0.1 development script left
  `SELECT 0, 0, 1` in the released script's `msm_schema_version` view, so
  the deployed schema reported 0.0.1 and any later update was refused
  ("version 0.0.1 cannot be updated"). Fixed there (the release keeps the
  template's section 910); a shell whose bundled plugin predates it still
  has it. The dialog defaults to the development version, which works with
  either; the UI test keeps to it.
- The MCP tools take no `substitutions`, so a project declaring them cannot
  be deployed from here; `msm.set_development_version` is not offered.
- The scripts the plugin writes still carry MySQL settings
  (`utf8mb4_0900_ai_ci`, `NO_AUTO_CREATE_USER`); MariaDB 12.3 accepts them.

## Tests

- `src/test/mcp/msmApi.test.ts` (the answers of a real `--gui` server,
  word for word; the list tools' arguments and decoding), `src/test/mcp/protocol.test.ts` (`decodeList` with a structured result).
- `src/test/tree/msmProjectsTreeProvider.test.ts`: rows and their order,
  descriptions, colors, files, drag and drop, rename, collapsed folders,
  `getParent`.
- `src/test/msm/msmFields.test.ts`, `msmCommands.test.ts` (through the
  dialog panel: calls, every action row, failures, Browse, the palette; the
  list's commands, the file dialogs, Edit), `msmPackage.test.ts` (the
  submenu's `when` clauses judged per folder, the view's toolbar and row
  menus).
- `webview/test/MsmDialog.test.tsx`.
- UI: `ui-test/tests/10-msm-projects.test.ts`, in suite `msm` before
  `09-msm`, whose create lists its project, see testing-and-debugging.md.
- UI: `ui-test/tests/09-msm.test.ts`, suite `msm` (`npm run ui-test:msm`):
  create, the duplicate refused, the information, a release, a second one
  refused, the deployment script, the deploy onto the suite's sandbox (its
  table in the Connections view; backup unticked, as a new schema has
  nothing to dump), and an unreadable project reported (its
  `msm.project.json` moved aside, then back). The
  suite's VS Code opens `files/workspace` (`WORKSPACE_FILES` in
  `ui-test/run.ts`, passed as `--open_resource`; opening a folder later
  would reload the window); the Explorer helpers are `explorerItem`,
  `explorerSubmenuEntries`, `explorerMenuAction`, `openExplorerDialog`.
