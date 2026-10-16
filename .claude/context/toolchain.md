# Toolchain

How the extension is built, tested and shipped: the Vite builds, the two
Vitest projects, the pinned Node, the Marketplace icon, packaging and CI.

Part of [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md).

- **Build**: [Vite](https://vite.dev), twice. `vite.config.ts` bundles
  `src/extension.ts` into a single CommonJS `dist/extension.js` for the
  extension host, with `vscode` and the Node built-ins external.
  `vite.webview.config.ts` builds the Preact frontend into
  `dist/webview/main.js` and `main.css` for the browser. The two dialogs
  are a build each as well - `vite.editor.config.ts` (the connection
  editor, `editor.js`/`editor.css`) and `vite.sandbox.config.ts` (New
  Sandbox, `sandbox.js`/`sandbox.css`) - because one build with several
  entries hoists a shared chunk that a webview's script nonce refuses (see
  [connection-editor.md](connection-editor.md)). `build:webview` runs all three. The extension
  build has `emptyOutDir: false` on purpose: it runs again on every change
  in watch mode, and emptying `dist/` would delete the panel's assets out
  from under a running extension host. `npm run clean` wipes `dist/`, and
  `npm run build` runs it first.
- **Tests**: [Vitest](https://vitest.dev), in two projects, because the
  two halves run in different places. The **extension** project runs
  `src/test/` in plain Node with the `vscode` module aliased onto
  `src/test/mocks/vscode.ts`, so no extension host is needed. The
  **webview** project runs `webview/test/` under jsdom with the Preact
  plugin. Either can be run alone with `--project extension` or
  `--project webview`.
- **Type checking**: `tsc --noEmit` against two configs — `tsconfig.json`
  for the extension (Node) and `tsconfig.webview.json` for the frontend
  (DOM + Preact JSX).
- **Lint**: ESLint with `typescript-eslint`, over `src` and `webview`.
- **Webview assets are files, never inlined**: `vite.webview.config.ts`
  has `assetsInlineLimit: 0`, and `assetFileNames` puts an icon from
  `images/light/` or `images/dark/` under `dist/webview/icons/light|dark/`
  (the two variants share a name; without the folder Rollup would append
  a number to one). The stylesheet references them relatively, as it does
  the codicon font; `src/test/webview/assets.test.ts` pins both rules.
  Most toolbar and data icons are drawn as CSS masks from the LIGHT file.

| Script | What it does |
| --- | --- |
| `npm run build` | Clean `dist/`, fetch the Copilot skills, then bundle the extension and the webview. |
| `npm run sync:skills` | Fill the `skills/` cache from the ai-plugins release `aiPlugins.release` pins and match `contributes.chatSkills` to it (`--latest` moves the pin to the newest release first). See [copilot.md](copilot.md). |
| `npm run clean` | Remove `dist/`. |
| `npm run watch` | Rebuild the extension on change. |
| `npm run watch:webview` | Rebuild the webview on change. |
| `npm test` | Run both Vitest projects once. |
| `npm run coverage` | Run the suite with a V8 coverage report. |
| `npm run typecheck` | Type check both configs. |
| `npm run lint` | Lint `src` and `webview`. |
| `npm run pretest` | `typecheck` + `lint`. |
| `npm run grammar:sync -- --server <path> --shell <path>` | Read the SQL keyword, function and REST word lists out of the two checkouts into `syntaxes/words.json`. |
| `npm run grammar:build` | Build the two MariaDB SQL grammars from the template and the lists. |
| `npm run grammar:check` | The same, failing if the checked-in grammars differ (CI, and `words.test.ts`). |

## Node version, and why the lockfile keeps churning

**Node is pinned exactly, in `.nvmrc` (currently `24.21.0`)**, with
`engines.node` in `package.json` as the documented floor (`>=24.15.0`). Both
numbers are load bearing:

- The jsdom stack the webview tests run on (`jsdom`, `@asamuzakjp/dom-selector`,
  `@asamuzakjp/css-color`) requires `^22.22.2 || ^24.15.0 || >=26.0.0`. Node 22.19
  produces three `EBADENGINE` warnings and runs the suite on an unsupported
  runtime; Node 24.21 produces none.
- Node 24 ships **npm 11**, and npm 11 writes the `libc` fields that
  `package-lock.json` carries for the optional rollup binaries. **npm 10 silently
  strips them**, so a contributor on Node 22 rewrites the lockfile just by
  installing. That is the churn — it is not noise to be ignored, it is two npm
  majors disagreeing about the file's format.

`package-lock.json` **is** checked in, and should be: this is an application
(shipped as a `.vsix`, with the four runtime deps bundled into
`dist/extension.js` by Vite), not a library whose consumers resolve their own
tree. What the lockfile pins is literally what ships — which matters most for
`@modelcontextprotocol/sdk`, since `src/mcp/protocol.ts` decodes shapes read off
the running server and a floating minor could change them underneath a release
build. `package.json` also carries `"private": true`, since the extension is
never published to npm.

**Always `npm ci`, never `npm install`, in CI.** `npm ci` installs exactly the
locked tree and never writes the lockfile back.

## Packaging

`npm run package` runs `vsce package --no-dependencies` (`@vscode/vsce` is a
devDependency), which first runs `vscode:prepublish`, the build, and writes
`mariadb-dev-<version>.vsix` into the repository root (gitignored). The
extension identifier is `MariaDB.mariadb-dev`: `publisher` and `name` in
`package.json`. The settings namespace and every command id stay `mariadb.*`,
since those come from `contributes`, not from the name.

- **`--no-dependencies` is required.** The four runtime dependencies are
  bundled into `dist/` by Vite; without the flag vsce ships their
  `node_modules` as well, thousands of files for nothing.
- **`.vscodeignore` decides what ships**, and it is an allow-by-exception
  list: sources, tests, configs, the grammar tooling, the context notes, the
  workspace file and the CI workflow stay out; `dist/` (without its source
  maps) and `images/` go in. A file added at the repository root ships
  unless it is listed there - check with `npx vsce ls --no-dependencies`.
- **The README's links are absolute** on purpose: vsce rewrites relative
  links against the repository root, and in the plugins monorepo that
  pointed them at the wrong directory. `LICENSE` is packaged as
  `extension/LICENSE.txt` and rendered as the Marketplace's License tab.

## Releasing

`/release <version> [shell-version|-] [ai-plugins-version|-] [--stable]`
(`.claude/commands/release.md`) cuts a release: it checks the three versions
against what is published, sets them on a `wip/release-<version>` branch
(`update_version.py --version`, `sync:skills -- --release`, `npm version`),
and opens the PR. After the merge it builds the merge commit's `.vsix`,
tags it and attaches it to a GitHub release, then hands that same file to
the user. The rules it rests on:

- **Every input must be published.** The extension installs
  `MINIMUM_SHELL_VERSION` when there is no shell, so a floor above the newest
  shell release breaks the first start; the skills pin must be an ai-plugins
  release. Both repositories publish only prereleases, so `releases/latest`
  finds nothing: the releases are listed and sorted as versions.
- **A Marketplace version is used once**, even after an unpublish, and must
  be a bare `X.Y.Z` (vsce refuses `-rc` suffixes).
- **Pre-release by default.** A release is stable only with `--stable`,
  which the command confirms before starting, so a pre-release is never
  declared ready by accident. The channel is fixed at packaging time:
  `vsce package --pre-release` records it in the `.vsix`, and the upload
  takes it from there. A pre-release is never promoted: going stable is a
  new release, with a version above the last pre-release so the
  pre-release channel's users move to it. Versions are calendar-like and
  ignore the Marketplace's even/odd minor suggestion; it only advises
  separate version numbers per channel, and uniqueness is all it enforces.
- **The Marketplace upload is manual**, in the browser at
  `marketplace.visualstudio.com/manage`, signed in with a Microsoft account
  that is a member of the `MariaDB` publisher. No credential is kept for
  it. Publishing by token ends on December 1, 2026, when Azure DevOps
  retires global PATs (the only kind the Marketplace accepts). The Entra ID
  route (`--azure-credential`) needs an Azure subscription and a managed
  identity, and was passed over in favour of trusted publishing
  (`vsce publish --oidc`). vsce has that already, hidden from `--help`;
  the token exchange matching the Marketplace's contract arrived after
  4.0.0, in 4.0.1-1. The Marketplace backend still refuses it, and it has
  no page to set up the trusted publisher yet. Once it does, the upload
  becomes a GitHub Actions job started by the release tag, with
  `id-token: write` and no stored secret.

## The Marketplace icon

`images/marketplace-icon.png`, declared by `icon` in `package.json`. It is a
**256x256** PNG: the manifest reference asks for "at least 128x128 pixels
(256x256 for Retina screens)". Two traps:

- **`icon` may not be an SVG.** vsce rejects it outright, and that is the only
  icon rule vsce enforces - it checks no dimensions at all, so an undersized
  PNG packages happily and is only rejected at the Marketplace end. The SVG ban
  applies to this field alone; the `contributes` icons (`mariadb-code-ext.svg`, the
  `light/` and `dark/` trees) stay vectors.
- **There is no light/dark variant.** The one image sits on both Marketplace
  card backgrounds, so the artwork is a tile with an opaque body and alpha only
  in the rounded corners - a transparent logo would vanish on one of them.

vsce publishes it as the `Microsoft.VisualStudio.Services.Icons.Default` asset.
The source artwork lives outside the repo, under
`Work/Artwork/Logos/MariaDB VS Code Extension/`; copying from there carries the
volume's mode and xattrs, so `chmod 644` and `xattr -c` afterwards or git
records the file executable.

## CI

`.github/workflows/code-ext-ci.yml` has a `Code-Ext-CI-Verification` job
running `npm ci` -> `npm run sync:skills` -> `npm run pretest` -> `npm test`
-> `npm run package`, on
the Node that `.nvmrc` names and on a hosted runner, since the extension
needs Node and nothing else. The last step builds (through
`vscode:prepublish`) and packs: the build because the extension ships as a
bundle, where an import that only resolves under the test aliases, or an
asset that is not copied, is invisible to the type check and the tests
alike; the packing so that what `.vscodeignore` lets through is seen on
every change. The `.vsix` is kept as the run's `mariadb-dev-vsix` artifact.
`skills/` is restored by `actions/cache`, keyed on the pinned release, so
the sync downloads only when the pin is new to the cache - from codeload,
not GitHub's rate-limited API. It runs before the tests, which hold
`chatSkills` against the cached release
(`src/test/tools/syncAiSkills.test.ts`), and after packaging
`git diff --exit-code package.json` fails a run whose pin moved without its
`chatSkills`.

Between the lint and the tests it runs `tools/check_openapi_ui_pins.py`,
which fetches `mrs_plugin/lib/open_api_ui.py` from the public
mariadb-shell-plugins repository (`--ref`, `main` by default) and compares
the Swagger UI release and request path pinned there with the extension's
copies in `src/mrs/mrsDialogs.ts`. The copies are not a test: the plugin
does not expose them, and a Vitest check would need the plugins repository
checked out next to this one.
