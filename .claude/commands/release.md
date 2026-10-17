---
description: Cut a release of the extension, suggesting its next YY.MM.x version and moving the MariaDB Shell floor and the ai-plugins skills release to newer releases where there are any, PR it, tag it, attach the .vsix to a GitHub release, and hand it over for upload to the VS Code Marketplace. Usage: /release [version|-] [shell-version|-] [ai-plugins-version|-] [--stable]
---

# Release Command

Arguments as typed: `$ARGUMENTS`

Split that string on whitespace. `--stable`, wherever it stands, is a
flag and not a position; take it out first. So is `--pre-release`, which
only says what is the default anyway. Of the rest:

1. **The version**: the extension's version, `version` in
   `package.json`.
2. **The shell floor**: `MINIMUM_SHELL_VERSION` in
   `src/shell/constants.ts`, the oldest MariaDB Shell the extension accepts
   and the one it installs when there is none.
3. **The skills release**: `aiPlugins.release` in
   `package.json`, the mariadb-corporation/ai-plugins release whose skills
   the extension contributes to Copilot.

All three are optional, so a bare `/release` works. A `-` in a position
means "not given", so a later position can be given without an earlier one
(`/release - - 26.10.3`). What is not given is suggested in step 2:

- the version: the next `YY.MM.x` version (see step 2);
- the floor and the skills release: the latest published release, when it
  is newer than the current one. Otherwise they stay where they are.

So with no newer shell or ai-plugins release, a bare `/release` only bumps
the extension's version. If a fourth word is left over, stop and ask what
it means.

Every version is a bare `MAJOR.MINOR.PATCH` such as `26.10.0`. Strip a
leading `v` if one was given and say so. The extension's version and the
shell floor are bare everywhere in this repository. Only the git tag
(`v26.10.0`) and the skills pin (`"release": "v26.10.2"`, an ai-plugins tag)
carry the `v`.

**The three versions are independent.** The extension's version is the
Marketplace version and the tag. The floor and the skills release are
inputs it ships with. When one of them is not given it stays where it is,
unless a newer release of it exists. Then step 2 suggests moving it to that
release.

**A release is a pre-release unless `--stable` is given.** A pre-release
goes on the Marketplace's pre-release channel, and its GitHub release is a
prerelease. A stable release goes on the Marketplace's main channel, which
every user gets, and only `--stable` produces one. Never infer it from
anything else: not from the version, not from wording such as "the final
release", and not from an earlier stable release. If the user's words
suggest stable but the flag is missing, ask. Do not assume. vsce records the
channel in the `.vsix` when it packages it, so the channel must be settled
before anything is built.

A pre-release cannot be promoted later. Making it stable means a new
release with a new version and `--stable`. Give that release a version above
the last pre-release, so that users on the pre-release channel move to it.

Read `.claude/PROJECT_CONTEXT.md`, then `.claude/context/toolchain.md` and
`.claude/context/copilot.md` before starting. The index's **Known gaps**
section says which features need which shell, and that matters when the
floor moves.

The remote is `origin` = `mariadb-corporation/vscode-extension`. Check
`git remote -v`. If it is missing, stop and report it.

## 1. Preconditions

- `git status --short` must be clean and the current branch must be `main`,
  level with `origin/main` after `git fetch --tags origin`. If not, stop and
  report. Do not stash or reset anything.
- `v<version>` must not exist as a tag, locally or on `origin`
  (`git ls-remote --tags origin v<version>`). If it does, stop. When the
  version is suggested, check this in step 2, once it is known.
- `gh auth status` must succeed. If it fails, stop: every later step needs
  it.

## 2. Check the versions

Do all of this before changing anything, and report what you find in one
summary: each of the three versions, its current value, the value this
release ships, and whether that was given or suggested. That way the user
sees the whole release, including its channel, before it starts.

**When anything was suggested, stop and ask the user to confirm the
summary.** They may accept it, or change any of the three versions, for
example to keep the current floor although a newer shell exists. Run the
checks below again for what they changed. With `--stable`, also **ask the
user to confirm** that this release goes to every user as stable. Name the
version, and the pre-release it supersedes if there is one. Go on only on a
yes. When everything was given and the release is a pre-release, report
the summary and go on.

**The extension's version.** Take the highest of:

- this repository's tags (`git tag -l 'v*' | sort -V`);
- the versions on the Marketplace
  (`npx vsce show MariaDB.mariadb-dev --json`, its `versions[].version`).
  The command prints `undefined` while the extension has never been
  published.

Report it, or that there is neither a tag nor a Marketplace version (the
first release).

- **None given:** suggest `YY.MM.x`, from today's date
  (`date +%y.%-m`): `YY` is the year's last two digits, `MM` the month
  without a leading zero (`26.9.0`, never `26.09.0`: semver forbids leading
  zeros), and `x` counts the releases of that month. It is `0` for the
  month's first release, and one more than the highest `x` among the tags
  and Marketplace versions that start with `YY.MM.` otherwise. For the
  first release, when `version` in `package.json` already is a `YY.MM.x`
  of this month, suggest that version as it is. If the suggestion does not
  sort above the highest version (one from a later month exists), stop and
  report it. Check that `v<suggestion>` is not a tag, locally or on
  `origin`.
- **One given:** it must sort above the highest version, or stop. A
  Marketplace version can never be reused, not even after an unpublish.
  For the first release, it must not sort below `version` in
  `package.json`, and it may equal it. If it does not follow `YY.MM.x` for
  this month, say so and ask whether to use it anyway.

**The shell floor.** The current floor is `MINIMUM_SHELL_VERSION` in
`src/shell/constants.ts`. Report it. List the published shell releases:

```bash
gh release list --repo mariadb-corporation/mariadb-shell --exclude-drafts --limit 30 --json tagName,isPrerelease,publishedAt
```

Every MariaDB Shell release is a **prerelease**, so `releases/latest` 404s.
Do not use it. Sort the `tagName`s as versions (strip the `v`, then
`sort -V`), not by date.

First check that the current floor is a base version the extension can
ship with: the oldest shell it requires, and one a user can install.

- **The current floor itself is not in the list** (it was raised ahead of
  the shell release, which `update_version.py` without `--version` does) →
  stop, whatever was given. A release must not ship a floor that cannot be
  installed. Say whether the floor's release is still to come or whether the
  floor should go back to a published one, and let the user decide. A floor
  given here that *is* published resolves it.
- **The current floor is below the hard floor** that the comment on
  `MINIMUM_SHELL_VERSION` names → stop and report it.
- **No floor given:** check whether the current floor is still the highest
  published shell release. If it is, the floor stays unchanged. If a newer
  one exists, suggest raising the floor to the latest release, naming both
  versions and the latest one's publish date, and continue with it as if it
  had been given. The confirmation of the summary settles it.
- **A floor given:**
  - `v<floor>` is not in the list → stop. The extension *installs* the floor
    when a user has no shell, so a floor above every published release
    breaks the first start for everyone without a shell.
  - It is below the current floor → stop and ask. Lowering the floor is not
    a normal release step, and the comment on `MINIMUM_SHELL_VERSION` names
    a hard floor that must never be crossed.
  - It equals the current floor → nothing to move. Continue as if no floor
    was given.
  - A version higher than it exists → say so, and ask whether to use the
    given floor anyway.
  - Otherwise continue, and report the publish date of `v<floor>`.

When the floor moves, read the index's **Known gaps** and report any feature
they say waits for a shell release, and whether the new floor brings it.
One example is the REST Service tree, which needs the MRS module. Do not
change behaviour for it in this command. Just say so.

**The skills release.** The current one is `aiPlugins.release` in
`package.json`. Report it. List the published ai-plugins releases:

```bash
gh release list --repo mariadb-corporation/ai-plugins --exclude-drafts --limit 30 --json tagName,isPrerelease,publishedAt
```

Every ai-plugins release so far is a prerelease too: the same rules, and the
same sorting, apply.

- **None given:** if the pin is the highest release, keep it. If a newer one
  exists, suggest moving the pin to the latest release, naming both and the
  latest one's publish date, and continue with it as if it had been given.
  The confirmation of the summary settles it.
- **One given:** not in the list → stop. Below the current pin → stop and
  ask. Equal → nothing to move. A higher one exists → say so and ask.
  Otherwise continue, and report its publish date.

The pin itself must be in the list too. If it is not, stop, as for the
floor.

Whichever skills release is chosen, read the shell floor it was built
against:

```bash
gh api "repos/mariadb-corporation/ai-plugins/contents/docs/_config.yml?ref=v<skills>" -H "Accept: application/vnd.github.raw" | grep shell_floor
```

The skills are written for the server that floor brings. If it sits above
the extension's floor (after this release), say so and ask whether to go
on: Copilot would be taught tools that the shell the extension installs may
not have.

## 3. Branch and set the versions

```bash
git switch -c wip/release-<version>
```

Make each change that applies, in this order, and commit each step on its
own so the PR can be reviewed one step at a time. Skip a step whose version
is not moving. Stop at the first non-zero exit. After each step, list the
files it changed (`git status --short`). A different set from the one named
here is worth looking into before going on.

1. **The shell floor.**

   ```bash
   python3 tools/update_version/update_version.py --version <floor>
   ```

   This changes `src/shell/constants.ts` and the README's Requirements: two
   files. Then update what the index's Known gaps says about the floor, if
   the new one changes it. Commit as `Require MariaDB Shell <floor>`.
2. **The skills release.** First note the cached `skills/skills-source.json`
   (run `npm run sync:skills` first if there is no cache yet), so the old
   upstream is on record. Then run:

   ```bash
   npm run sync:skills -- --release v<skills>
   ```

   This changes `package.json` alone: the pin and, when the set of skills
   changed, `contributes.chatSkills`. `skills/` is not committed. Record,
   for the release notes and the PR:

   - the skills added and removed (the `chatSkills` diff);
   - the skill count;
   - the old and new upstream (`upstream.commit` in the stamp, before and
     after).

   Commit as `Contribute the skills of ai-plugins v<skills>`.
3. **The version.**

   ```bash
   npm version <version> --no-git-tag-version --allow-same-version
   ```

   This changes `package.json` and `package-lock.json`. When the version
   already is `<version>` (the first release can be), it changes nothing,
   and there is nothing to commit. Otherwise commit as `Version <version>`.

## 4. CHANGELOG

In `CHANGELOG.md`, turn `## [Unreleased]` into `## [<version>] - <today>`
and put a new, empty `## [Unreleased]` above it. Then reread the section
against what this release actually ships:

- An entry that names a version (the shell version the startup check wants,
  for example) must name the floor this release requires.
- When the floor moved, say so and name it.
- When the skills release moved, name it, with the skill count and the
  skills added or removed.

Keep the existing structure (`### Added`, `### Changed`, `### Fixed`). The
Marketplace shows this file as the extension's Changelog tab, so write it
for users. Commit.

## 5. Verify

Run what CI runs, in its order, from a clean install:

```bash
npm ci
npm run sync:skills
npm run pretest
python3 tools/check_openapi_ui_pins.py
npm test
npm run package -- --pre-release    # plain npm run package with --stable
git diff --exit-code package.json
```

Then check the package:

- `mariadb-dev-<version>.vsix` exists.
- `unzip -l mariadb-dev-<version>.vsix | grep -c 'extension/skills/.*/SKILL.md'`
  equals the number of `chatSkills` entries.
- `extension/skills/skills-source.json` in it names `v<skills>`.
- The channel is the one intended:
  `unzip -p mariadb-dev-<version>.vsix extension.vsixmanifest | grep -c 'Microsoft.VisualStudio.Code.PreRelease" Value="true"'`
  prints `1` for a pre-release and `0` with `--stable`.

If anything fails, stop and show the failure. Do not open the PR on a red
run. Give the user the `.vsix` path, so they can install it
(`code --install-extension <path>`) and try it before the merge.

## 6. Open the PR

```bash
git push -u origin wip/release-<version>
gh pr create --repo mariadb-corporation/vscode-extension --base main --head wip/release-<version> --title "Release <version>: …" --body-file <file>
```

The title names what the release contains, for example
`Release 26.11.0: shell 26.10.3, skills v26.10.3, and the version`. Leave out
a part that did not move. The release changes `package.json`, so the title
never carries `[bypass-ci]`. The body lists each step with the files it
changed, the skill sync's findings, the channel (pre-release, or stable with `--stable`), and
the verification. It ends with the PR attribution line.

Wait for the PR's checks (`gh pr checks <N> --watch`) and report them. Then
**stop and ask the user to review and merge the PR**, giving its URL. Do not
merge it yourself. When the user says it is merged, confirm with
`gh pr view <N> --json state,mergeCommit,headRefOid` that `state` is
`MERGED`, and note the merge commit.

## 7. Build the release package

The package that is published is built from the merged commit, not from the
branch. A squash merge makes a new commit, and the tag goes on that commit.

```bash
git switch main && git pull --ff-only origin main
git rev-parse HEAD          # must be the PR's merge commit
npm ci
npm run package -- --pre-release    # plain npm run package with --stable
git status --short          # must be empty: the build changed nothing
shasum -a 256 mariadb-dev-<version>.vsix
```

Check the package as in step 5. If `HEAD` is not the merge commit (`main`
moved on since), stop and ask: the release should be exactly what was
reviewed.

## 8. Tag and publish on GitHub

Create an annotated tag `v<version>` on the merge commit. The annotation's
body is the release notes: a short prose summary for users, covering:

- what is new;
- the MariaDB Shell the release requires, and whether that moved;
- the ai-plugins release its Copilot skills come from, with the skill count;
- the final line `See CHANGELOG.md, section [<version>], for details.`

```bash
git push origin v<version>
git ls-remote --tags origin v<version>      # the tag object you created
git tag -l --format='%(contents:body)' v<version> > <scratch>/notes.md
gh release create v<version> mariadb-dev-<version>.vsix --repo mariadb-corporation/vscode-extension --title v<version> --notes-file <scratch>/notes.md --verify-tag
```

Add `--prerelease` unless the release is `--stable`. `gh` refuses `--notes-from-tag` together
with `--repo`, which is why the notes go through a file. The `.vsix` is
attached to the release, so the release holds the same file that goes to the
Marketplace.

## 9. Upload to the VS Code Marketplace (by hand)

The extension is `MariaDB.mariadb-dev`: `publisher` and `name` in
`package.json`. **The user uploads the `.vsix` in the browser; this command
does not publish it.** Uploading through the web page signs in with the
user's Microsoft account, so no token or Azure identity is involved. Never
ask for a token, and never run `vsce publish` or `vsce login` here.

Stop and hand over:

- the file: the absolute path of `mariadb-dev-<version>.vsix` from step 7,
  the same file that is attached to the GitHub release;
- its SHA-256 from step 7, so the user can check that they pick the right
  file;
- the version and the channel (pre-release, or stable with `--stable`);
- the steps:
  1. Open `https://marketplace.visualstudio.com/manage` and sign in with an
     account that is a member of the `MariaDB` publisher.
  2. For the first release (step 2 found no Marketplace version), choose
     **New extension → Visual Studio Code** and upload the file. For later
     releases, open the extension's **…** menu, choose **Update**, and
     upload the file.

Remind the user of two things:

- A version that has been uploaded can never be reused, not even after an
  unpublish.
- The channel is recorded inside the `.vsix`, so the upload page does not
  ask for it. After an upload, check that the listing shows the channel
  intended: a pre-release must appear as one, and must not be the version
  that the main channel offers.

Wait until the user says the upload is done. The Marketplace verifies an
upload before listing it, which takes a few minutes. Then confirm that
`npx vsce show MariaDB.mariadb-dev --json` lists `<version>`. If it is still
missing after about ten minutes, report that, and ask the user what the
Manage page shows for it. Never upload again on the user's behalf.

This step is manual until the Marketplace supports trusted publishing
(`vsce publish --oidc`, with a trusted publisher policy set up on the
Marketplace). Then it moves into a GitHub Actions job that the release tag
starts. That job publishes the `.vsix` attached to the release and stores
no credential. Do not set up a PAT or an Azure identity in the meantime:
the PATs that publish are retired on December 1, 2026, and `--oidc` makes
the Azure route unnecessary.

## 10. Clean up and report

Delete the local `wip/release-<version>` branch. Delete it on `origin` too,
once its remote head matches the PR's `headRefOid`. Then tell the user the
release is published, with:

- the merged PR and its merge commit;
- the tag `v<version>` and its tag object;
- the GitHub release URL;
- the Marketplace page,
  `https://marketplace.visualstudio.com/items?itemName=MariaDB.mariadb-dev`,
  and the channel;
- the shell floor and the skills release it ships, and whether each moved;
- anything that did not go as expected.

If the release taught something that stays true, such as a step that has to
change or a Marketplace rule, record it with `/checkpoint` in
`.claude/context/toolchain.md` and open a small PR for it. The PR carries
`[bypass-ci]` when it changes only the context. Do not record the release
itself there: the context records no git state.
