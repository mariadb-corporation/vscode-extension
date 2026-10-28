# Deployments

The Deployments view - every MariaDB deployment the user manages -
in an activity bar container of its own, and the New Deployment wizard its
`+` opens.

Part of [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md).

| File | Purpose |
| --- | --- |
| `src/tree/deploymentsTreeProvider.ts` | The view: folders by kind of deployment, a sandbox's REST Daemons under it, the welcome state. |
| `src/tree/vendorsTreeProvider.ts` | The Deployment Vendors view: the fixed vendor list, its grayed-out rows, and the file decoration that grays their labels. |
| `src/deployments/deploymentChoices.ts` | What each wizard page offers, and which options it can go on from yet. Pure; shared by the webview and the host. |
| `src/deployments/deploymentProtocol.ts` | The wizard's messages: `new` with the deployment type, `cancel`. |
| `src/deployments/deploymentWizardPanel.ts` | The wizard's panel; hands on to the dialog of the deployment picked. |
| `webview/src/DeploymentWizard.tsx` | The wizard itself; `deployment.tsx` is its entry, `deploymentStyles.css` its styles, `vite.deployment.config.ts` its build. |

## What the user decided

- **Its own activity bar icon**, `images/mariadb-dba-ext.svg`, container
  `mariadb-deployments`, titled "MariaDB Deployments"; its views are
  Deployments and Deployment Vendors. The
  first container is titled "MariaDB Shell" (it was "MariaDB"; the panel
  container still is) and its icon is `images/mariadb-shell-ext.svg` (it
  was `mariadb-code-ext.svg`).
- **Sandboxes only, for now**: a "Sandboxes" folder holding every sandbox
  instance, as the Sandboxes view lists them, each with the REST Daemons
  serving it (`sandbox_port`) as child rows. Standalone instances and
  clusters are to come.
- **The `+` opens a wizard.** Page 1: Create a New Deployment, or Import
  an Existing Deployment. Page 2 of a new one: MariaDB Sandbox Instance,
  MariaDB Standalone Instance (`images/light/connectionMariaDB.svg`), or
  MariaDB Cluster (`images/light/cluster.svg`), the images drawn as CSS
  masks in the text color. The step list above the page reads 1. Start,
  2. Deployment Type, 3. Deploy; Deploy is never a wizard page, it is the
  deployment's own dialog. Sandbox -> Next closes
  the wizard and opens New Sandbox (`mariadb.addSandbox`), which deploys
  it. Only that path exists so far; the other options are shown,
  disabled, badged "Not available yet", and the host refuses them again.
- **A second view, Deployment Vendors**, below Deployments,
  sized 1/4 to its 3/4 (`initialSize` 25 and 75). It lists Local
  Container, Proxmox, MariaDB Cloud, AWS, Hetzner, Scaleway, STACKIT and
  UpCloud, every one grayed out with "not configured", since none can be
  set up yet.
- **The view shows the sandbox while it deploys**, then updates once done
  (see sandboxes.md: `SandboxesTreeProvider.deploying`).

## Decisions

- **It lists nothing of its own.** The Sandboxes view (`nodes()`, which
  its own `getChildren` uses too) and the REST Daemons view (`nodes()`,
  over its kept `deployments()`) keep the lists and know what is being
  done to each row; this view draws from them and redraws whenever either
  fires. So a start or stop's spinner shows in both, with no second
  listing. Refresh (`mariadb.refreshDeployments`) is the two views'
  reloads.
- **The rows are the other views' rows**: a sandbox is an `ISandboxNode`
  (plus `daemons`), a daemon an `IRestdNode`, drawn with the same tree
  items, so the same `contextValue`s and commands apply. Their menus'
  `when` clauses name only the `viewItem` (`mariadbSandbox.*`,
  `mariadbRestd.*`), which only those items produce, so they show in
  whichever view the rows are in.
- **A REST Daemons listing that fails** is logged and the sandboxes are
  shown without daemons; a sandbox listing that fails puts the view's
  welcome content on failed, as the Sandboxes view's.
- **No folder while nothing is deployed**: the welcome content (context
  key `mariadb.deploymentsView`) says "None has been deployed or
  registered yet" and offers Create or Import a Deployment... instead.
- **A sandbox opens when its first REST Daemon arrives.** Its row is
  Expanded once it has one, under the id `sandbox:<port>:restd` instead of
  `sandbox:<port>`: VS Code keeps a row's state by id and ignores the
  state given for a row it has already drawn, so the sandbox drawn without
  a daemon while it deployed stayed closed. One the user closes stays
  closed while the daemon is there.
- **A view hidden in the other container is redrawn once shown**
  (`src/tree/redrawWhenShown.ts`, on the Sandboxes, REST Daemons and
  Deployments views): a redraw asked for while it was hidden is made again
  when it becomes visible. A sandbox deployed with its REST Daemon from
  the Deployments view left the MariaDB Shell container's REST Daemons
  view empty until Refresh, although VS Code is meant to keep a hidden
  view's redraw. Collapsed counts as hidden.
- **Grayed out through a file decoration**: a tree item has no disabled
  state, so a vendor row not configured gets the icon in
  `disabledForeground` and a `mariadb-vendor:/<id>` resource URI, which
  `VendorDecorations` colors `disabledForeground` - the mechanism the
  connection colors use. The list is fixed: nothing to list or refresh.
- **The wizard keeps its pages in the webview**; the host only hears where
  they led. One wizard at a time; asking again reveals it.

## Known gaps

- Import, Standalone and Cluster are placeholders, and so is every vendor:
  no command acts on one yet.
- No UI test drives the view or the wizard yet.
