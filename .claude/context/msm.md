# MariaDB Schema Management (MSM)

The Explorer's **MariaDB Schema Management** submenu on folders: creating a
schema project, and on a `*.msm.project` folder its information, a release,
its deployment script and deploying it. Each opens a dialog; each thing done
is an action of the Actions tab.

Part of [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md). The server side is the
MCP plugin's `msm` group (`mcp_plugin/lib/msm_functions.py`), which wraps
`msm_plugin/management.py`.

| File | Purpose |
| --- | --- |
| `src/mcp/msmApi.ts` | `IMsmApi` / `MsmApi`: the seven `msm.*` tools used, typed. `MSM_LICENSES` (no tool lists them: kept in step with `msm_plugin/templates/license`, which a test checks when a plugins checkout is beside this repo). Deploy gets 30 min. |
| `src/msm/msmFields.ts` | Pure, shared with the webview: per dialog its values, defaults and `*Problem` checks, version parsing / comparing (numbers, so 1.10 > 1.9), `projectFolderName` as the plugin names it. |
| `src/msm/msmProtocol.ts`, `msmDialogPanel.ts` | The dialog's messages and panel: one at a time, checks the values again (and `host.check`, the disk) before `host.submit`; a failure stays in the dialog, or is notified once it was closed. |
| `src/msm/msmCommands.ts` | `MsmCommands`: the five commands, reading the project, the work as `ActionGroup`s (`src/restd/actionGroup.ts`). |
| `webview/src/MsmDialog.tsx`, `msm.tsx`, `msmStyles.css`, `vite.msm.config.ts` | The dialog, one component for the five kinds; its own bundle. |

## The commands

| Command | Shown on | Does |
| --- | --- | --- |
| `mariadb.msm.createProject` | A folder NOT named `*.msm.project` | New MSM Project: schema name, license, copyright holder, the folder (Browse), Create the Folder / Allow Special Characters / Replace Existing Project. Opens `development/<schema>_next.sql` and reveals the project folder. |
| `mariadb.msm.showProjectInformation` | `*.msm.project` | The project's information, with buttons to open the development script and to go on to the three dialogs below (in its place). Replaces the old extension's JSON document. |
| `mariadb.msm.prepareRelease` | `*.msm.project` | Release version (the development version) and next version (its patch + 1, following the first until typed into), Stay on the Same Version, Replace Existing Files. Opens the files written. |
| `mariadb.msm.generateDeploymentScript` | `*.msm.project` | A released version (newest first, marked where it has a script), Replace Existing File. Opens the script. |
| `mariadb.msm.deploySchema` | `*.msm.project` | Connection (the configured ones; the default connection, or the only one, preselected), version (those with a script), Back Up the Schema First (default on) and its folder (empty: the project's `backups`). Refreshes the tree and the language server's catalog after. |

From the palette, create starts in the first workspace folder (or home),
and the others ask for the project folder with a folder picker. The old
MySQL Shell extension (`gui/extension/src/MsmCommandHandler.ts`) did the
first four with input boxes one after another; Deploy is new.

## Decisions

- **Every operation is an action**, the project read included (the user's
  request): `ActionGroup` puts a run row with a row per call under it,
  each showing the call (`msmCall`: `msm.prepare_release(version='0.0.1',
  next_version='0.0.2')`) and, once done, what it came to. Reading a project
  is "Read MSM project <folder>" with three steps (information, released
  versions, deployment scripts). File work is filed under General Actions;
  a deploy under its connection, with `db.connect` as its first step. A
  failure ends the group failed, brings the panel up on it
  (`showActions`), and is shown in the dialog.
- **Lists of versions are read from `structuredContent`**
  (`decodeStructured` in `protocol.ts`): FastMCP flattens a list of lists in
  `content` - `[[1, 0, 0]]` arrives as the text items "1", "0", "0" - and
  sends no items at all for both `[]` and None. Read off the running server.
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
  word for word), `src/test/mcp/protocol.test.ts` (`decodeStructured`).
- `src/test/msm/msmFields.test.ts`, `msmCommands.test.ts` (through the
  dialog panel: calls, every action row, failures, Browse, the palette),
  `msmPackage.test.ts` (the submenu's `when` clauses judged per folder).
- `webview/test/MsmDialog.test.tsx`.
- UI: `ui-test/tests/09-msm.test.ts`, suite `msm` (`npm run ui-test:msm`):
  create, the duplicate refused, the information, a release, a second one
  refused, the deployment script, the deploy onto the suite's sandbox (its
  table in the Connections view; backup unticked, as a new schema has
  nothing to dump), and an unreadable project reported (its
  `msm.project.json` moved aside, then back). The
  suite's VS Code opens `files/workspace` (`WORKSPACE_SUITES` in
  `ui-test/run.ts`, passed as `--open_resource`; opening a folder later
  would reload the window); the Explorer helpers are `explorerItem`,
  `explorerSubmenuEntries`, `explorerMenuAction`, `openExplorerDialog`.
