# MSM: links that open a project's diagram

Part of [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md); the rest of MariaDB
Schema Management is in [msm.md](msm.md).

So a user can check an MSM project a coding agent made, the agent writes a
link into its answer that adds the project to the MSM Projects view and
opens one of its diagrams:

`<scheme>://mariadb.mariadb-shell/msm/openDiagram?project=<folder>&diagram=<name>`

`src/msm/msmLinks.ts`, a `vscode.window.registerUriHandler` (activation
event `onUri`). `project` is the absolute project folder, `diagram` the
diagram's name (`diagramNamed`: exact, else in any case, as names are
unique in any case); `pickProjectDiagram(project, wanted)` opens it, or,
left out or not found (told so), lets the user pick one, offering New
Schema Diagram... where there is none. Adding is `addToProjects`, an
action, where a listed project keeps its place.

- **The scheme is the editor's**, `vscode.env.uriScheme`: `vscode`,
  `vscode-insiders`, or the Theia app's `electron.uriScheme` (default
  `theia`, which mariadb-shell-workbench's `theia.frontend.config` can change). An agent
  cannot know it, so the skill writes `vscode://` and the agent's client
  rewrites it (mariadb-shell-agent's extension does, see below).
- **Registered before `activate` returns**: Theia's opener activates the
  extension for a link (`onUri:<scheme>://<id>`) and looks for the handler
  right after, with no queue; VS Code queues.
- **Anyone can write such a link**, a web page too, so it goes only as far
  as the user could by hand: the folder must be a `*.msm.project` one
  (`isProjectFolder`, as the dialogs want) and hold `msm.project.json`, nothing runs, nothing in the project changes, MCP
  access is not touched. VS Code asks the user before handing an outside
  link to an extension; Theia does not ask.
- **Opening one from code, in Theia, is `vscode.open`**, never
  `env.openExternal`: that passes `openExternalApp`, whose
  `ExternalAppOpenHandler` (600) outranks plugin-ext's `uri-main` handler
  (500), so the link goes to the OS and comes back only where the packaged
  app registered its scheme; it also decodes the query and `encodeURI`
  does not encode `&` `=` `#` again. `vscode.open` reaches `uri-main`,
  encoding intact. Theia finds the handler by the lowercased plugin id in a
  case-sensitive map, so the authority must be `mariadb.mariadb-shell`.
- **The query arrives decoded once** (VS Code's and Theia's `Uri.query`),
  so an encoded `&` or `=` in a folder name is back as is, and
  `URLSearchParams` would split there (and turn `+` into a space). Only the
  keys `project=` and `diagram=` start a parameter (`linkParameters`), so
  a parameter of any other name runs into the value before it. The folder
  is `resolve`d (no trailing separator, no `..`), as a Uri's `fsPath` is,
  so a listed project is found again and keeps its place.
- **Where a link can be clicked**: Copilot Chat and Claude Code show
  `vscode://` links. mariadb-shell-agent's chat (the web-shell's
  `Markdown.tsx`) passes hrefs through react-markdown's `defaultUrlTransform`,
  which blanks every scheme but `http(s)`, `irc(s)`, `mailto`, `xmpp`. The
  fork's agreed change (a `mariadb/patches/` patch, fork build 26.11.1):
  an href whose authority is exactly `mariadb.mariadb-shell` is rendered
  inert (`href="#"`) and posted to its extension (`openExtensionLink`),
  which checks the authority again, puts in `vscode.env.uriScheme` and
  opens it with `env.openExternal` in VS Code, `vscode.open` in Theia, the
  query byte for byte. Links the `msa` CLI prints in a terminal are not
  covered. The skill telling agents to write the link is ai-plugins'.

## Gaps

- Links printed by the `msa` CLI in a terminal are left as they are:
  whether one can be clicked is up to the terminal's link detection.
- A link clicked outside the editor (a browser) reaches a Theia app only
  where its packaging registers its `uriScheme` with the OS; Theia does
  so by itself on Windows only.
- Agents write the link only when a skill tells them to: the skill is
  ai-plugins', pinned by `aiPlugins.release` (see [copilot.md](copilot.md)).
