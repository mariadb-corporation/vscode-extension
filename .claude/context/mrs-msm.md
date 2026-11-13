# REST in MSM projects

Part of [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md); the MariaDB REST
Service as a whole is [mrs.md](mrs.md), the MSM Projects view
[msm.md](msm.md).

The user's request: a project's REST service, schemas and objects made
with the very same dialogs as a server's, written to MSM Section 180 of
its development script, sharing the editors and re-implementing as little
as possible.

- **One set of commands and dialogs.** `addService`, `addSchema` and
  `addDbObject` (the handler of `MRS_ADD_OBJECT_COMMANDS`, one command per
  kind) take a project's row too (`projectPath` on the node) and
  ask `IMrsCommandsHost.projectRest` for the project as an `IRestSource`;
  a server's rows get `liveRestSource`. The dialogs' code is unchanged but
  for `forScript` on their contexts (`IScriptContext`).
- **`forScript`** makes every statement `CREATE OR REPLACE` (`createRest`),
  the REST service's too: msm's deployment script runs Section 180 on every
  deploy, first install and update alike. mariadb-shell #137 updates what is there in place, for
  every REST object type: the service, schema or object keeps its id, a service its
  schemas, content sets, roles and auth app links (ADD links what is not
  linked; links not named are kept), a schema its objects, an object its
  grants; an option left out goes back to its default, the script being
  the source of truth. An older shell deletes and re-creates. No `USE REST
  SERVICE` (a script has no session; the service dialog hides its Default
  flag), and a view with no column known (a project view without a column
  list) gets no field list, which the server fills.
- **In place never prunes**: what a new version removes from Section 180
  stays on servers deployed before, unless a `DROP REST ... IF EXISTS` /
  `REMOVE AUTH APP ... IF EXISTS` says otherwise. The user's decision:
  msm writes them, as for removed routines (#106's Section 260) - a new
  update-script Section 280 (Removal of REST Endpoints) that
  `prepare_release` fills from the previous release's Section 180, run for
  every updatable version in a new deployment Section 380 before Section
  180, a drop of what the target defines again commented out. A removed
  service also lists the drops of its schemas, objects and auth app links,
  and a removed schema those of its objects, so a service or schema
  defined again by a later version loses what it no longer has. Only a
  service or schema Section 180 creates is dropped, not one it only names
  with ON SERVICE. A REST schema a release moves to another database
  (which mariadb-shell #137 refuses in place while it has objects) is
  dropped with a conditional `DROP REST SCHEMA IF EXISTS ... FOR DATABASE
  <old>`, a no-op on servers already moved; its objects then get new ids.
  mariadb-shell-plugins #112, which reads Section 180
  through mariadb-lsp's outline (lsp-server #39: `rest_auth_app_links`,
  `rest_current_schema`, `rest_declared`). The extension writes nothing
  for it.
- **Writing** (`extension.ts`, `writeRestStatements`): msm's
  `msm.set_rest_statements(statements, base_hash, replaces)`
  (mariadb-shell-plugins, agreed 2026-11-12; user's decision: "only the
  MSM project should know where exactly in the MSM project to add/modify
  them"). The extension sends each CREATE the dialog built, each naming
  its service and schema (`ON SERVICE ... SCHEMA ...`), against the
  snapshot's `source_hash` (`restBaseHash`, made first where there is
  none); msm places it - an item the section creates replaced where it
  stands, its later ALTERs gone but for auth app links, a new one after
  its siblings or parent, in the section's breakout file where it has one
  - writes CREATE OR REPLACE, self-checks through mariadb-lsp's outline
  (`rest_statements`, lsp-server PR #43: every statement of each REST
  item) and makes the snapshot again. Through `ProjectModelSource
  .setRestStatements`, after the diagrams' waiting saves and in turn with
  their edits, as an action of the General Actions; then
  `snapshotUpdated`. An editor with unsaved changes on the script is
  refused (msm writes the file on disk). A MariaDB Shell without the tool
  (`isUnknownTool`) gets a message to update it, and one whose
  mariadb-lsp has no `rest_statements` gets msm's own. The extension
  parses no REST SQL to place a statement.
- **Deleting** a project's REST service, schema or object: the Connections
  view's Delete commands on the MSM Projects rows, confirmed, then
  `msm.drop_rest_object(kind, service, schema, object, base_hash)`
  (`IProjectRestSource.drop`, `dropRestItem`): msm removes every statement
  of it and of what is on it, their leading comments too, and writes no
  DROP (a release's Section 280 drops it from servers); an item the
  section only names keeps it, with a note shown. Gated as writing is.
- **Opt-in end-to-end**: `src/test/msm/msmStatements.e2e.test.ts` runs a
  real shell (this repo's plugins linked in, as `mrsShell.e2e`) on a new
  project: REST items added, replaced, renamed and deleted, schema objects
  added from msm's templates and replaced, a mismatched `expect` refused
  with the file untouched. `MARIADB_SHELL_E2E=<mariadb-shell>
  MARIADB_LSP=<mariadb-lsp> npx vitest run msmStatements.e2e`. msm's MCP
  tools take mariadb-lsp from `mcp setup --lspPath` (the test runs it in
  its own shell home), else the one next to the shell, never from a tool
  argument: a shell whose bundled lsp is older than the plugins is
  refused.
- **The source of a project**: auth apps are `BUILT_IN_AUTH_APPS`
  (MariaDB, MRS), as every metadata has them. A click on a REST row opens
  the script on its statement.
- **Editing a project's REST object** (the user's request: Edit REST
  Object... on its MSM Projects row and in its figure's hamburger menu,
  opening the dialog as Edit Table opens the table editor): the same
  `editDbObject` and dialog. `object()` reads the object from
  **mariadb-lsp's outline** of the development script on disk
  (`IProjectRestHost.restOutline`, `LspEdit.outline`), never from a parser
  here (see "SQL is parsed by mariadb-lsp, never here" in
  [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md); a TypeScript parser written
  for this was deleted). The details are lsp-server's feature
  `rest_object_details` (lsp-server PR #41): on each
  `rest.services[].schemas[].objects[]`, `class`, `crud`, `fields`
  (Field: `name`, `column`, `reference {schema, table, fields}`,
  `options`, `datatype`, `json_schema`), `parameters`, `results`,
  `enabled`, `requires_auth`, `items_per_page`, `comment`, `media_type`,
  `media_type_autodetect`, `format`, `auth_procedure`, `options`,
  `merge_options`, `metadata`, `force`, and the database object unquoted
  (`object_schema`, null where unqualified, and `object_name`); the last
  of a repeated option wins.
  A binary whose `outline --features` lacks it gets the edit refused with
  a message; so does an object with `merge_options` (a patch the dialog
  would save as the whole). `restOutline.ts` maps them
  (`objectStatementOf`, `outlineRestObject`) to what `SHOW CREATE REST ...
  FORMAT=JSON` reports (`storedMappings`: the columns a block leaves out
  stored disabled, a reference's join the foreign key to the table it
  names, from the snapshot; `listedObjectOf`, `storedObject`); `force` is
  not kept. The database schema is the object's own, else its REST
  schema's (`schema`). A REST VIEW serves a table or a view
  (`restColumns`). `restObjectOutline.e2e.test.ts` (opt-in,
  `MARIADB_LSP=...`) reads objects written in another notation through the
  real outline, saves them with the dialog's `objectStatements`, and has
  mariadb-lsp read the result the same (but for the defaults the dialog
  writes out). Finding a figure's object (`objects()`) and the tree still
  go through `restScript.ts` (debt). Saved, a script's object is `CREATE OR REPLACE`
  (no ALTER: `objectSql` with `forScript`); a renamed one is sent with
  `replaces` (its old paths), and msm puts it where the old one stood
  (where the script creates what it now names, that is replaced and the
  old removed). The
  figure's entry (a project's diagrams only, `onEditRestObject`) posts
  `editRestObject` with its paths, which `editProjectRestObject` finds
  through `objects()`.
- **Editing a project's REST service or schema** (the user's request: the
  dialogs Add already uses, sharing the code with the Connections view's
  Edit): `editService` / `editSchema` take a project's row too and run the
  same `#serviceDialog` / `#schemaDialog`, the source's new `service()` /
  `schema()` reading what is stored (a server's from its lists, a
  project's from mariadb-lsp's outline: feature `rest_settings`, agreed
  with lsp-server 2026-11-12, lsp-server PR #42 stacked on #41 - `enabled`,
  `published`, `protocol`, `comment`, `auth_path`, `auth_redirection`,
  `auth_validation`, `auth_page_content`, `options`, `merge_options`,
  `metadata`, `request_path`, `developers` on a service; `enabled`,
  `requires_auth`, `items_per_page`, `comment`, `options`, `merge_options`,
  `metadata` on a schema; null where not written, folded as the shell
  does: CREATE OR REPLACE resets what it does not write, ALTER changes what
  it writes; `storedService` / `storedSchema` in `restOutline.ts`). A
  project's linked auth apps are the outline's (none without the feature).
  `IProjectRestHost.restOutline(feature)` checks the binary's features.
  Saved in a script, `serviceStatements` / `schemaStatements` write `CREATE
  OR REPLACE` again (no ALTER), which replaces the statement where it
  stands; a service's unlinked apps get `REMOVE AUTH APP ... IF EXISTS`
  (the links a CREATE OR REPLACE does not name are kept). A rename, or a
  schema moved to another service (`existingService`), is refused: the
  statements created on it name its path. MERGE OPTIONS (`merge_options`,
  true only for an ALTER on what the file does not declare) is refused.
  mariadb-lsp matches services ignoring quotes and spacing in developers
  and request path (`mike, \`anna\`@/svc` is `anna,mike@/svc`); its `path`
  stays as first written, so `outlineRestService` accepts that or the
  dialog's `developers@request_path`. msm matches the saved statement to
  the one there the same way (`rest_paths.path_key`).
  `restObjectOutline.e2e.test.ts` round-trips objects, services and
  schemas through the real outline (`MARIADB_LSP=...`).
- **The tree**: a project's **MariaDB REST Service** row below its schema
  (`restRoot`, `mariadbMsmRestRoot`, Add REST Service... inline and in its
  menu), its services, their REST schemas and objects looking as a
  server's (`serviceLook` / `schemaLook` / `objectLook` of
  `mrsTreeItems.ts`, which `MrsTreeItem` uses too), with context values of their own
  (`mariadbMsmRest*`, no server menus); a click opens the script on the
  statement. Read with `IMsmProjectsHost.restDefinition` once per refresh.
- **Checked end to end** with the shell (26.11.1) and mariadb-lsp: msm
  makes the snapshot of a script with these statements in Section 180.
  Not yet checked: deploying such a script, i.e. the REST SQL run by the
  shell.

## REST objects on a project's diagrams

A REST object row of the MSM Projects view goes onto the project's
diagram shown by a drag or its **Add to Diagram** (`mariadbMsmRestObject`,
`0_msm@0`), as a `RestObjectFigure` (drawn upright: see
[modeler-figures.md](modeler-figures.md)). A drag carries
`mariadb-schema-object:/rest/<service>/<schema>/<object>?project=...`
(`IRestObjectRef`, `DiagramObjectRef`; `restObjectRefOf` on a row). The
figure keeps paths only: what it shows is read from Section 180 by the
extension (`restObjectDefinitions`, through `ProjectModelSource.restObjects`
and the host's `restObjects`), sent in the `load` (`model.restObjects`)
and again after a save of the script that did not make the snapshot
again (a dialog's save is one; `ModelerPanel.restChanged`, posting a
`restObjects` message only where they changed,
`EerFigureSet.replaceRestObjects`). Paths are matched by
`showsRestObject` (`modelFormat.ts`), a drag's URIs made by
`objectUriList` for both kinds of row. msm (mariadb-shell-plugins #113) keeps the figure, its layout never moves it and keeps
`width x depth` clear (20 where `depth` is missing), and
`reconcile_diagram` drops one whose (service, schema, object) the
msm-schema/1 snapshot's `rest` member (mariadb-lsp's outline:
`rest.services[].path`, `.schemas[].path`, `.objects[].path`, as Section
180 writes them) no longer has, compared case-insensitively without
quotes; a snapshot from a mariadb-lsp before lsp-server #39 (services
without `declared`) keeps every REST figure. The viewer does not read
that member: the outline has no field lists, so Section 180 is parsed for
them anyway, and is the one source of what a figure shows, a gone
object's figure saying so.
