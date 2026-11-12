# MSM: projects from live schemas, and adding schema objects

New MSM Project from Schema (a schema on a server made into a project) and
the Add commands on a project's object group rows. Part of
[PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md); the rest of MariaDB Schema
Management is in [msm.md](msm.md).

## New MSM Project from Schema

The reverse of a deploy (mariadb-shell-plugins #103): a project made from
a schema on a server. On a Connections view schema row only
(`MSM_IMPORT_COMMAND`, `mariadb.msm.importLiveSchema`, group `6_msm@1`;
hidden from the palette, as it needs the row). Both tools come with the db
group only.

- **The listing** (`MsmCommands.importLiveSchema`): an action of the
  connection's, "Read schema <s> for an MSM project", with `db.connect`
  and `msm.list_live_schema_objects` as its steps, on a session of its own
  (`MSM Import <n>`, as Deploy's), closed once listed: the wizard may stay
  open a long while. A failure (no such schema) opens no wizard.
- **The wizard** is New MSM Project's (kind `import`, `IMsmImportValues`:
  the create values plus `connection` and `objects`), with a first page,
  **Schema Objects**: a box per kind the schema has (tables, sequences,
  views, procedures, functions, events), each object ticked by default and
  the box's legend ticking the kind as a whole (`tickedObjects`, in the
  listing's order). A table's triggers are named under it as information
  only: msm imports them with their table, so they are never ticked nor
  sent. The page says the version msm deployed of the schema
  (`schema_version`) and names msm's own objects it leaves out
  (`left_out`). Under a ticked view, a note names what it reads that is
  not ticked (`unticked`, the view's `reads` of mariadb-shell-plugins
  #104: tables, views, sequences and stored functions; null where msm
  could not read the definition, missing from an older msm, either way
  no note): the project would not deploy the view without them. A note,
  not a problem: Create Project is not held back, and msm warns again
  after the import with the same detection. The schema name is the
  schema's, shown disabled; no Allow
  Special Characters (msm takes the name as it is). `importProblem`: none
  ticked is refused (an empty project is New MSM Project's), then
  `createProblem`; `#checkCreate` checks the folder as for New.
- **Create Project** connects a second `MSM Import <n>` session and starts
  `msm.import_live_schema`. `objects` is left out where everything is
  ticked, so objects made meanwhile come too (`importedObjects`); else
  every kind is sent, an empty list for none, never a `triggers` key. msm
  refuses what it would refuse (folder, license, selection, no
  mariadb-lsp) before a task starts: the refusal stays in the wizard and
  is a row of its own (`startFailed`), the session closed. Started, the
  wizard closes and the task is followed (`followTask`, the
  `TaskMonitor`: Tasks view, notification, its Actions row); its session
  is closed once it ended. Completed: the MSM Projects view reads the list
  (msm added the project, folder, caption and color), a custom license is
  set as New sets it, the development script opens and the project is
  revealed in the MSM Projects view. msm's `warnings` (a foreign key to a
  table not imported, a definition the account cannot read) are one
  warning notification, the first with a count of the rest. A failed or
  cancelled import leaves no project (msm removes it); nothing opens.

## Adding schema objects

Each object group row of a project's schema in the MSM Projects view
(`mariadbMsmObjectGroup.<type>`) has an Add of its kind: a `$(add)` inline
and the first entry of its menu (`MSM_ADD_COMMANDS` in
`src/msm/schemaObjects.ts`, `mariadb.msm.addTable` ... `addSequence`;
hidden from the palette: they need the row).

- **Add Table...** opens the table editor on a new table of the project
  (target `table: ""`, see table-editor.md).
- **The other kinds** (`SchemaObjectCommands.add`): a name asked for
  (`objectNameProblem`: not empty, 64 at most, no backtick, not taken in
  the kind's namespace - tables, views and sequences share one; a
  procedure and a function may share a name), a trigger's table picked
  from the snapshot's tables. The extension fills the kind's template
  (`fillTemplate`: Python string.Template's rules and msm's messages - `$$`,
  `$name`, `${name}`, only the kind's placeholders, the trailing `;`
  dropped; the SQL itself is not read) and sends the statement to
  `msm.set_schema_statements(statements, base_hash, expect)` with
  `expect: [{kind, name, table?}]`, through
  `ProjectModelSource.setSchemaStatements`, in the project's queue after
  the diagrams' changes (as `edit`), against the snapshot's `source_hash`.
  msm refuses a statement that creates anything else before writing,
  places it where it keeps that kind (its section, or the section's
  breakout file), and answers with each statement's `file` and `line`:
  the editor opens there for the body to be written, and the tree, Object
  Details and diagrams follow (`snapshotUpdated`). A shell without the
  tool is refused with an Update the MariaDB Shell message (`msmTool` in
  extension.ts). A project with no snapshot yet has msm make its first.
  The diagrams' own adds and drops stay `msm.edit_schema` ops: their undo
  needs the ops' inverses.
- **Templates** are msm's (`msm.get_object_templates`: a plain CREATE per
  kind, string.Template placeholders `${name}`, a trigger's `${table}`,
  `${schema}`), unless the user changed one: `ObjectTemplates` keeps the
  user's as `<kind>.sql` in the extension's global storage
  (`msm-object-templates/`), filled in place of msm's; a kind without a
  file takes msm's. **Edit Template...** on a group row
  (every kind but tables) opens the kind's file, made from msm's template
  the first time; saving it is changing it; a notification names the
  placeholders filled in. **Reset Template to msm's Default** deletes the
  file.
