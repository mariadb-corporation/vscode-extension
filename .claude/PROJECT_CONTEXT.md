# MariaDB Shell for VS Code — Project Context

The **MariaDB** VS Code extension. Written in TypeScript, it talks to the
MariaDB Shell backend through the [`mcp_plugin`](https://github.com/mariadb-corporation/mariadb-shell-plugins/tree/main/mcp_plugin), which
exposes the backend functions over the Model Context Protocol (MCP).

This file is the map: what the project is, where the code lives, and which
context file covers which area. It is the one to read first, and the detail
is a link away. Keep it and the file the change belongs to up to date as the
extension grows.

## Layout

| Path | Purpose |
| --- | --- |
| `src/extension.ts` | Activation entry point. Wires everything together and registers the commands. |
| `src/shell/` | Finding, installing and launching the MariaDB Shell; `shellResolver.ts`, the one lookup both servers share. |
| `src/lsp/` | The MariaDB SQL language server, `mariadb-lsp`: finding it, the language client, telling it each document's connection, answering its `db.*` calls (see [`context/language-server.md`](context/language-server.md)). |
| `src/copilot/` | The MCP server definition provider that gives Copilot the shell's MCP server (see [`context/copilot.md`](context/copilot.md)). |
| `skills/` | The MariaDB agent skills contributed to Copilot - a gitignored cache of the ai-plugins release `aiPlugins.release` in `package.json` pins, filled by `tools/syncAiSkills.mts`. |
| `src/mcp/` | The MCP client: the one-at-a-time server startup, session lifecycle, wire decoding, typed `db.*` and `sandbox.*` APIs. |
| `src/errorMessages.ts` | The error notification every failure uses, with its Show Log button, and `reportError` (log it, then notify). |
| `src/text.ts` | `errorText`, `counted` and `stripAnsi`: text helpers shared with the webviews, so free of `vscode`. |
| `src/connections/` | Which connections are open on which URI and which is the default, what happens on each one, what each one's `sql_mode` says about double quotes and what its editors' session reported of its `sql_mode` and schema for the language server (`sqlModes.ts`), plus the connection editor: URI building, the store, the panel and its protocol. |
| `src/tree/` | The Connections view: its data model and its tree items; the Sandboxes, REST Daemons, Deployments and MSM Projects views; `schemaTree.ts`, a schema's rows both the Connections and MSM Projects views draw (see [`context/object-details.md`](context/object-details.md)); `viewState.ts`, the welcome-content state machine they share; `expandedRows.ts`, the MSM Projects rows kept open across a restart. |
| `src/details/` | The Object Details view below MSM Projects and below Connections: the object selected, read only and compressed, and the diagram item selected, editable; `detailEdits.ts`, a table change as edits and their inverse, which the diagram applies (see [`context/object-details.md`](context/object-details.md)). |
| `src/tableEditor/` | The table editor: a table's draft and the `mariadb-lsp edit` ops it comes to (`tableDraft.ts`), running the binary (`lspEdit.ts`), a live or a project's table (`tableSources.ts`), the panel below the main editor and its protocol (see [`context/table-editor.md`](context/table-editor.md)). |
| `src/mrs/` | The MariaDB REST Service: REST SQL builders, the data mapping model, the dialogs' fields, the API, the dialog panel and the commands, and what goes to the Actions tab (`mrsActions.ts`, `mrsActivity.ts`) (see [`context/mrs.md`](context/mrs.md)). |
| `src/util/` | Dump and Load: the operations' fields, the dialog, the commands, the task monitor, the Tasks view, a task's Actions row (`taskActions.ts`) and its log file (`taskLogs.ts`) (see [`context/dump-and-load.md`](context/dump-and-load.md)). |
| `src/sandboxes/` | The New Sandbox dialog: its fields, protocol and panel. |
| `src/deployments/` | The New Deployment wizard: its choices, protocol and panel (see [`context/deployments.md`](context/deployments.md)). |
| `ts-plugin/` | The TypeScript server plugin of MariaDB Notebooks, a package of its own that npm links into `node_modules`: the runtime's typings for TypeScript cells (see [`context/notebook-typescript.md`](context/notebook-typescript.md)). |
| `src/notebook/` | MariaDB Notebooks: the `.mariadb-notebook` format and serializer, the notebook's connection, the kernel that runs SQL and TypeScript cells (a worker per notebook), telling a cell's language from what is typed, and the live views of their result sets (see [`context/notebooks.md`](context/notebooks.md)). |
| `src/overview/` | The MariaDB Overview editor tab: the snapshot it shows and its folder walking, its protocol and panel (see [`context/overview.md`](context/overview.md)). |
| `src/msm/` | MariaDB Schema Management from the Explorer's folder menu and the MSM Projects view: the dialogs' fields, protocol and panel, the commands, each an action of the Actions tab, the view's folder commands (`msmProjectsCommands.ts`), and the links an agent writes to open a project's diagram (`msmLinks.ts`) (see [`context/msm.md`](context/msm.md)). |
| `src/restd/` | The MariaDB REST Daemon: a sandbox deployed with the REST Service, its daemon following it, the REST Daemons view's commands, and `ActionGroup`, one Actions row with a row per step (see [`context/restd.md`](context/restd.md)). |
| `src/modeler/` | The schema diagram viewer's extension side: the `msm_schema_diagrams` rows (`msm-schema/1`, `msm-diagram/1`) and their queries, the Diagram session's service, where a viewer's model comes from and goes (`modelSources.ts`: a live schema read only, an MSM project through msm, saved and its schema edited), the drafts that outlive VS Code (`diagramDrafts.ts`), the page model (A4 sheets the diagram is printed on), and the panel (see [`context/modeler.md`](context/modeler.md)). |
| `src/sql/` | The statement scanner, statement splitting, single-table detection, which statements change the catalog (`catalogChange.ts`), the edit query builder and the execution service. |
| `src/editor/` | The SQL editor toolbar, status bar entry and run command; `sqlLanguage.ts`, which documents are SQL; `ansiQuotes.ts`, the semantic tokens that mark `"..."` as an identifier where the connection has ANSI_QUOTES. |
| `syntaxes/` | The MariaDB SQL TextMate grammar: the hand-written template, the generated `words.json`, and the built grammar (see [`context/sql-grammar.md`](context/sql-grammar.md)). |
| `tools/syncAiSkills.mts` | `sync:skills`, run by `build`: fetches the pinned ai-plugins release into `skills/` and matches `contributes.chatSkills` to it. |
| `tools/grammar.mts` | `grammar:sync` reads the word lists out of the mariadb-server and mariadb-shell checkouts; `grammar:build` makes the grammar from the template. |
| `language-configuration.json` | Comments, brackets and auto-closing pairs of the MariaDB SQL language. |
| `src/webview/` | The result view host, its message protocol and the edit-collection logic; a maximized result set's editor tab (`maximizedResult.ts`); grid values as files - saved / loaded (`valueFiles.ts`) and opened in editors (`valueDocuments.ts`); what every webview shares - the HTML, CSP and options (`html.ts`), the hold-until-`ready` queue (`readyQueue.ts`), the dialogs' common messages (`dialogProtocol.ts`), and `DialogPanel` (`dialogPanel.ts`), the base of every dialog's panel - the webview, the guarded post, dispose, and `runBusy`: the progress bar, closing once done, a failure in the dialog or as a notification once it was closed - with `pickFolder`. |
| `webview/src/` | The Preact frontends: the result view, the connection editor, New Sandbox, the New Deployment wizard, the MariaDB Overview, the Dump and Load dialog, the MRS dialogs, the MSM dialogs and the schema model viewer. |
| `webview/src/canvas/` | The three.js canvas: 2D / 3D views, paper and grid, selection, moves, undo, the Navigator - generic, showing a figure set (see [`context/modeler.md`](context/modeler.md), [`context/modeler-view.md`](context/modeler-view.md)). |
| `webview/src/modeler/` | The EER diagram as a figure set of the canvas (table, view, routine group, REST object, note and image figures, layers, connections), and the model viewer. |
| `src/test/` | The extension-side test suite, mirroring the source layout; `grammar/` tokenizes with VS Code's own TextMate engine (word coverage, token classes, corpus snapshots). |
| `webview/test/` | The frontend test suite, run under jsdom. |
| `ui-test/` | The ExTester UI tests: the runner and its suites (`core`, `mrs`, `dump-load`, `lsp`, `restd`, `msm`, each with a sandbox of its own, and `msm-diagrams` without one), the helpers and the DevTools-protocol drags (`lib/cdp.ts`), the test files (see [`context/testing-and-debugging.md`](context/testing-and-debugging.md)). |
| `images/` | Icons: `light/` and `dark/` variants, the activity bar icons `activityBar-shell.svg` (MariaDB Shell), `activityBar-dba.svg` (MariaDB Deployments) and `activityBar-msm.svg` (MariaDB Schema Management), and `marketplace-icon.png`. |

## Context files

The detail lives in [`context/`](context/), one file per area, so a task
that touches one of them does not have to read the rest. Keep the file the
change belongs to up to date, and this table with it.

| File | What is in it |
| --- | --- |
| [`context/toolchain.md`](context/toolchain.md) | The two Vite builds and two Vitest projects, the npm scripts, the pinned Node and the lockfile churn, packaging, releasing with `/release` (GitHub and the Marketplace), the Marketplace icon, CI. |
| [`context/language-server.md`](context/language-server.md) | `mariadb-lsp`: the lookup (setting, PATH, the MariaDB Shell's installation), the lazy start and restarts, `mariadb/documentContext`, catalogs read through this extension's MCP server (`--mcp`, `mariadb/dbCall`, details on demand), settings and the progress entry, why the server's semantic tokens are switched off, what P6 still lacks. |
| [`context/copilot.md`](context/copilot.md) | GitHub Copilot: the skills (`chatSkills`, the pinned ai-plugins release and the uncommitted cache) and the MCP server definition provider, agent mode without `--gui`, the shared shell lookup, the setting. |
| [`context/shell-and-mcp.md`](context/shell-and-mcp.md) | `src/shell/` and `src/mcp/` file by file, the lazy startup and shell lookup, GUI mode (`--gui`) and the two connection lists, the MCP wire format. |
| [`context/connection-editor.md`](context/connection-editor.md) | The connection editor: its files and tabs, what it deliberately leaves out, the URI box and its rules, its own vite build. |
| [`context/connections.md`](context/connections.md) | The several connections one URI can have open and the one the Connections view keeps, what is reported on them (General Actions; browsing only on failure or with `logAllCalls`), the cached connection list, the tree, opening, the default connection. |
| [`context/connection-folders.md`](context/connection-folders.md) | Folders, captions and colors of connections: what the server keeps, the helpers mirroring its rules, New Folder, moving, collapsed folders kept across a restart. |
| [`context/running-sql.md`](context/running-sql.md) | The two run commands and stop on error, which connection a file runs on, the MariaDB SQL language and its ANSI_QUOTES highlight, the statement scanner, splitting agreeing with the server, what makes a result set editable, the gutter markers. |
| [`context/sql-grammar.md`](context/sql-grammar.md) | The MariaDB SQL TextMate grammar: one language, ANSI_QUOTES as semantic tokens (and why not two languages), what a tokenizer can and cannot do and the policy for each, the generated word lists and the sync workflow, the three test layers. |
| [`context/dump-and-load.md`](context/dump-and-load.md) | The Dump and Load submenu, its dialog, the background tasks (`util.*` tools) with their notification and the Tasks view, each task as a row of the Actions tab, and a log file per task. |
| [`context/msm.md`](context/msm.md) | MariaDB Schema Management: the Explorer submenu on folders and `*.msm.project` folders, the MSM Projects view (the server's project list, folders, colors, MCP access, a project's files), the six dialogs (New MSM Project as a wizard, Edit MSM Project in tabs: copyrights and their years, a custom license, the online schema change defaults, all of msm.project.json through one `msm.set_project_settings`), Rename Schema (the flow, what follows a moved project folder), the `<scheme>://mariadb.mariadb-shell/msm/openDiagram` links an agent writes (the URI handler, the scheme, what a link may do, where it is clickable), the `msm.*` tools (and why version lists are read from `structuredContent`), every operation as an action, the checks made before calling the plugin, the release-version and schema-name bugs older plugins have. |
| [`context/msm-schema-objects.md`](context/msm-schema-objects.md) | New MSM Project from Schema (a live schema's objects into a project, as a task: listing, the wizard's Schema Objects page, the import) and the Add commands on a project's object group rows (the template filled, sent to `msm.set_schema_statements`). |
| [`context/object-details.md`](context/object-details.md) | A schema's rows shared by the Connections and MSM Projects views (a project's schema from its script's snapshot, Update Schema Snapshot), placing tables, views and routines on a diagram (Add to Diagram; a drag from a tree, placed where the pointer comes back, as Electron refuses drops into webviews), the Object Details view (selection, read only, compressed; the diagram item selected - a figure's or a layer's place, size and color, a figure's Upright, a relationship line's kind, offset and split - editable), why not VS Code's Outline. |
| [`context/table-editor.md`](context/table-editor.md) | The table editor (DBX's layout): where it opens, its tabs and grids (Tabulator cells of controls), the draft and the edits Save works out, a live table changed by the migration `mariadb-lsp edit` answers with, a project's through msm, the Online Alter Table tab (msm's online ALTER TABLE), the grids' keys, what is left out. |
| [`context/restd.md`](context/restd.md) | The MariaDB REST Daemon: New Sandbox's REST Service option and its steps, Set Up MariaDB REST Daemon, the REST Daemons view, the sub-rows and the log button. |
| [`context/deployments.md`](context/deployments.md) | The MariaDB Deployments view in its own activity bar container (sandboxes in a folder, each with its REST Daemons) and the New Deployment wizard, which so far leads to New Sandbox. |
| [`context/notebooks.md`](context/notebooks.md) | MariaDB Notebooks on VS Code's notebook API: the file, the connection in its metadata (and how a cell answers `connectionFor`), running a SQL cell through `executeScript`, its outputs, the panel's result view under a cell (its messaging, the third host in `ResultViewProvider`, refresh, a reopened notebook), its scoped stylesheet, why the run keybindings stay out of cells. |
| [`context/notebook-typescript.md`](context/notebook-typescript.md) | A notebook's TypeScript cells: telling a cell's language from what is typed, the worker and its runtime (`print`, `runSql`, shared declarations, the last expression shown), the graphs drawn without a charting library, the TypeScript server plugin and why it ships from `node_modules`, the REST client SDK of the connection's current REST service. |
| [`context/overview.md`](context/overview.md) | The MariaDB Overview editor tab: opening with the Connections view (and its two settings), the welcome text, the connection and folder tiles with their hover actions and menu (New Notebook among them), and why the UI test helpers pick webview frames themselves. |
| [`context/sandboxes.md`](context/sandboxes.md) | The Sandboxes view, its Start / Stop / Delete, the New Sandbox dialog, the per-call timeouts, and what it needs from the shell. |
| [`context/result-view.md`](context/result-view.md) | The panel webview: layout, per-connection state, the two pickers (and when General Actions is shown), fonts and surfaces, the SQL preview, the shared code. |
| [`context/result-grid.md`](context/result-grid.md) | The result grid: Tabulator and its traps, value display (hex, data icons, NULL), the cell menu and Delete Row, freezing the primary key, saving / loading a BLOB, opening any value in a VS Code editor. |
| [`context/result-set.md`](context/result-set.md) | One result set: its toolbar (the MySQL Shell's layout and icons), paging, maximizing into an editor tab. |
| [`context/actions-grid.md`](context/actions-grid.md) | The actions grid: run rows and their statements, errors and popups, scrolling, the jump arrows, and what the server had to report for it. |
| [`context/commands.md`](context/commands.md) | Every contributed command and where it appears. |
| [`context/mrs.md`](context/mrs.md) | The MariaDB REST Service tree and dialogs: REST SQL FORMAT=JSON reads, the `rest.*` tools, several metadata schemas, the files, what was left out of the MySQL Shell's support, the opt-in end-to-end test, and every MRS action in the Actions tab. |
| [`context/mrs-msm.md`](context/mrs-msm.md) | REST in MSM projects: a project's REST service, schemas and objects made with the server's dialogs (`IRestSource`, live or project), read from mariadb-lsp's outline (`restOutline.ts`) and written or deleted by msm (`msm.set_rest_statements`, `msm.drop_rest_object`), what msm prunes at deploy (Sections 280 / 380), REST objects on a project's diagrams (drag, Add to Diagram, `RestObjectFigure` as agreed with msm), and the real-shell e2e test. |
| [`context/modeler.md`](context/modeler.md) | The schema model viewer (preview): the split between the generic canvas and figure sets, the 2D / 3D views and orbiting, tables and layers (moves, elevation), the three projections (2D Top, Isometric, 2D Front), the Workbench figure design and toolbar, in-place editing of names, the A4 page model, life-size 100%, the msm formats and where a viewer reads and saves (live schema, MSM project), the auto-store and drafts, Auto Layout through msm, schema renames through `msm.edit_schema`, the catalog interface, and what is still missing (rendering: [`context/modeler-rendering.md`](context/modeler-rendering.md)). |
| [`context/modeler-rendering.md`](context/modeler-rendering.md) | The diagram viewer's rendering: the grid, cards as Canvas2D textures, slabs and their side labels, the fixed draw order, connections as fat lines (dashed, markers, the middle-segment handle), layer plates, the paper and the printable area. |
| [`context/modeler-view.md`](context/modeler-view.md) | The diagram viewer's view: the Navigator (overview, zoom slider, − / + steps, presets), each diagram opening as it was left (views kept in VS Code's workspace state, never in the diagram), the shortcuts. |
| [`context/modeler-figures.md`](context/modeler-figures.md) | The diagram viewer's figure kinds: table, view and routine group cards, REST object figures, any card standing upright or lying flat (`upright`, its footprint), figure and layer colors from Object Details, notes (Workbench fonts), images (data URLs, SVG sizing, pictures asked of msm), unknown types, connections between tables (matched to the foreign keys by definition, not name), sizing to content. |
| [`context/modeler-tools.md`](context/modeler-tools.md) | The diagram viewer's tool palette: Workbench's EER tools and keys, placing tables with chained name / column / type editors, views, routine groups, notes, images, layers by area, the relationship tools and the existing-columns floater, the edits each sends and undoes, why a create's diagram is saved only after its edit, the `mariadb-lsp edit` ops agreed with lsp-server, driving headless Chrome over CDP. |
| [`context/testing-and-debugging.md`](context/testing-and-debugging.md) | The interfaces everything external sits behind, the UI tests (ExTester), their suites, drags through the DevTools protocol and their traps, and the F5 launch and watch task. |

## Known gaps

- `MINIMUM_SHELL_VERSION` (`src/shell/constants.ts`) is set by the release
  tooling (`tools/update_version`, the shell repo's `main` version); the hard
  floor is 26.11.0 (`mariadb://` URIs from 26.9.3, `db.test_connection` and
  per-statement script results from 26.9.4, the `task.*` tools from
  26.11.0). 26.10.0 is the first release
  whose bundled `mcp_plugin` has connection folders / captions / colors,
  `sandbox.list_instances` and `mcp_access`, paging (`has_more_pages`) and
  `column_metadata`. 26.10.3 is the first with the MRS module
  (mariadb-shell #71) and mcp_plugin's `rest` group, which the REST Service
  tree needs. 26.11.0 is the first whose background tasks are the shell's
  own (`mysqlsh.task_manager`), followed with `task.get` / `task.list` /
  `task.cancel` rather than `util.get_task` and the like, which Dump and
  Load now needs - see [`context/dump-and-load.md`](context/dump-and-load.md).
  The server runs each util task in a shell process of its own.
  The MSM Projects view needs the msm plugin's project list and
  mcp_plugin's `msm.list_projects` / `add_project` / `update_project` /
  `remove_project` with `mcp_access` (mariadb-shell-plugins #80), which
  26.11.1 is the first to ship: with an older shell its welcome content
  asks for a newer MariaDB Shell.
- The result grid edits every value as text; there is no type-aware editor
  (date picker, BLOB viewer) yet. Its cell menu has Save / Load Value and
  Set Field to Null only - none of the MySQL Shell's Copy items.
- A VECTOR is recognised only from the table's own column type (the
  server reports it as `BYTES`, like VARBINARY), so outside an editable
  single-table result it shows as hex.
- Tabulator measures the DOM to lay itself out, and jsdom reports every
  element as zero sized, so it never finishes building under test. The
  grid's mapping, formatters and cell callbacks are tested directly
  (`webview/test/ResultGrid.test.tsx`); its rendering is not.
- The webview CSP allows inline STYLES (`style-src 'unsafe-inline'`,
  `src/webview/html.ts`). Harmless now that every grid cell and header
  tooltip is built as an element (see [`context/result-grid.md`](context/result-grid.md)),
  and left as a security review's one defence-in-depth
  suggestion: dropping it needs a check that the bundled CSS does not rely
  on it.
- **CI runs nothing that needs a shell.** `code-ext-ci.yml` runs the unit
  tests, which sit behind fakes, and no UI test: those need a MariaDB Shell
  with the MRS module (mariadb-shell #71), which releases carry from
  26.10.3. Options weighed, none done: download a shell release in CI; let
  a PR name the shell build it needs and download it (shell PR CI would
  have to upload its Linux package; `rocky-linux.yml` can build one on
  dispatch); skip tests whose feature the shell lacks.
- The UI tests need shell 26.11.0 or later, or a local build of the
  shell's `main`, named with `MARIADB_SHELL=...`.
- **Highlighting is lexical.** Non-reserved keywords used as names are
  coloured as keywords, data types have no scope of their own, and the
  ANSI_QUOTES identifiers are semantic tokens, so a theme with semantic
  highlighting off shows them as strings and they appear a moment after
  the grammar's colours. See [`context/sql-grammar.md`](context/sql-grammar.md).

## SQL is parsed by mariadb-lsp, never here

**The user's rule: no hand-written SQL parser in this extension, ever.**
Whatever the extension needs to know from SQL text - a statement's
parts, a REST object's data mapping, a table's columns, what a script
creates - comes from lsp-server's `mariadb-lsp` (its outline,
`mariadb-lsp outline FILE` / `mariadb/outline`, its `edit` and its other
ops), whose grammar parses any valid notation. A tokenizer or parser of
our own reads only the notation we expected, so a valid statement written
otherwise comes back incomplete and a save writes that loss back.

- **When the extension needs something mariadb-lsp does not report**, ask
  the lsp-server session for it (the cross-repo routine: check its
  `docs/outline-format.md` and `docs/edit-format.md` on `origin/main`,
  propose the members and a feature name, wait for the confirmation, then
  build against it). Until it is released, the feature is refused with a
  message, never bridged by a parser here. Gate it on the feature
  (`mariadb-lsp outline --features`).
- **Building SQL is fine** (the REST SQL builders, `objectSql`, the DDL
  the editors send): writing a statement is not parsing one.
- **What predates the rule**, to move over rather than extend:
  `restScript.ts` (`parseRestScript`, `entryOf`, `fieldLinesOf`: Section
  180's REST statements, which the outline's `rest` member reports),
  `statementSpans.ts` / `splitStatements.ts` / `statementAtOffset.ts`
  (statement boundaries for running SQL), `statementTarget.ts` (whether a
  SELECT's result is editable), `catalogChange.ts` (whether a statement
  changes the catalog). A change to one of them is a cue to ask lsp-server
  instead.
- An example: Edit REST Object on a project's REST object reads the
  object's details from mariadb-lsp's outline (`rest_object_details`,
  requested of lsp-server; see [`context/mrs-msm.md`](context/mrs-msm.md)),
  after a TypeScript parser written for it was deleted.

## Kept in sync with lsp-server

- **The SQL the language server may run.** `ALLOWED_SQL` in
  `src/lsp/dbCall.ts` lists the statements the extension runs for the
  server's `db.execute_sql` calls, compared with runs of blanks as one
  space and no `;` at the end (a new layout is fine, any other change is
  not); anything else is refused, and logged in the MariaDB channel, so
  the server cannot run arbitrary SQL on the user's credentials. It
  mirrors `k_server_sql` in lsp-server's
  `libs/mariadblanguageserver/src/mcp_catalog.cc` (today the one
  `SELECT @@sql_mode AS sql_mode, VERSION() AS version, DATABASE() AS
  schema_name`). A statement added or changed there has to be added here,
  in a release no later than the server's, or its catalog readings fail;
  only read-only SELECTs belong on the list. lsp-server's
  `.claude/PROJECT_CONTEXT.md` carries the same note, and its
  `tests/e2e/test_allowed_sql.py` fails when a statement the server sends
  is not on the list: it reads this file from `$VSCODE_EXTENSION_DIR`,
  else `../vscode-extension`, else GitHub at `$VSCODE_EXTENSION_REF`
  (default `main`). Nothing on this side checks it, so a change to the
  list is best tried against that test.

## Origin, and re-syncing from mariadb-shell-plugins

The extension was developed as `code_ext/` of
[mariadb-shell-plugins](https://github.com/mariadb-corporation/mariadb-shell-plugins)
and moved here with its history: `git subtree split --prefix=code_ext`
run on that repository, whose result is commit `e32debd6` here. Until the
folder is removed there, a commit that lands in it can be brought over:

1. In a plugins checkout, `git subtree split --prefix=code_ext main`
   prints the new tip. The split is deterministic, so it contains
   `e32debd6` as an ancestor with only the new commits on top.
2. `git fetch <plugins checkout> <tip>` here, then cherry-pick
   `e32debd6..<tip>` (or the newer base, once some have been taken).
   Messages, authors and dates come through unchanged; a commit that also
   touched the other plugins arrives with its `code_ext` part only.
3. Expect conflicts where this repository diverged: `README.md`,
   `package.json`, `.vscode/launch.json` and `.claude/` (references to the
   old home, and the context cleaned of git state and dates), and
   `src/test/mrs/mrsDialogs.test.ts` (the OpenAPI UI pins test, replaced
   by `tools/check_openapi_ui_pins.py`). A context update arriving in the
   old style is a cue to carry its facts over, not its wording.

This holds only while the plugins history is not rewritten; after a
force-push or squash over those commits, the new ones have to be picked by
content.

## Conventions

- Four space indentation, double quotes, trailing semicolons, 80 columns.
- Arrow function consts for exported functions; JSDoc with `@param` and
  `@returns` on everything exported.
- Comments explain *why*, not *what*.
- Relative imports carry the `.js` extension.
