#!/usr/bin/env python3
# Copyright (c) 2026, MariaDB plc.
#
# Bumps the MariaDB Shell version the extension requires, as part of preparing
# a release -- that is, BEFORE the shell release is published. The version is
# read from MYSQL_VERSION on the shell repo's main branch, where the shell
# version is bumped for the release.
#
# This is the extension's share of tools/update_version/update_version.py in
# mariadb-shell-plugins, which bumps the plugin suite the same way and from
# the same source; the two are run together when a release is prepared.
#
# Add or remove an entry in SHELL_TARGETS below to change which files are
# updated -- each entry is a regex that must match exactly once in the file,
# plus a template for the replacement text ("{v}" is substituted with the new
# version string).
#
# Needs the GitHub CLI (gh), logged in with read access to the shell repo.

import argparse
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

SHELL_REPO = "mariadb-corporation/mariadb-shell"
SHELL_VERSION_BRANCH = "main"

# One entry per file that names the shell release the extension goes out with.
SHELL_TARGETS = [
    {
        # The shell the extension requires, and installs when there is none.
        "file": "src/shell/constants.ts",
        "pattern": re.compile(r'^export const MINIMUM_SHELL_VERSION = "[^"]+";$', re.MULTILINE),
        "replacement": 'export const MINIMUM_SHELL_VERSION = "{v}";',
    },
]


def plan_update(target: dict, new_version: str):
    abs_path = REPO_ROOT / target["file"]
    content = abs_path.read_text(encoding="utf-8")
    matches = target["pattern"].findall(content)
    count = len(matches)
    if count != 1:
        reason = "pattern not found" if count == 0 else f"pattern matched {count} times, expected exactly 1"
        return {"file": target["file"], "ok": False, "reason": reason}

    old_text = target["pattern"].search(content).group(0)
    new_text = target["replacement"].format(v=new_version)
    new_content = target["pattern"].sub(lambda m: new_text, content, count=1)
    return {
        "file": target["file"],
        "abs_path": abs_path,
        "ok": True,
        "old_text": old_text,
        "new_text": new_text,
        "new_content": new_content,
    }


def run(command: list, **kwargs) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(command, check=True, capture_output=True, **kwargs)
    except FileNotFoundError:
        raise SystemExit(f"'{command[0]}' is needed but was not found. For gh, install it and run 'gh auth login'.")
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.decode(errors="replace") if isinstance(exc.stderr, bytes) else exc.stderr
        raise SystemExit(f"{' '.join(command)} failed:\n{stderr.strip()}")


def gh(*args: str) -> str:
    return run(["gh", *args], text=True).stdout


def read_shell_version(branch: str) -> str:
    """Returns the shell version on a branch, as publish-release derives it."""
    raw = gh(
        "api",
        f"repos/{SHELL_REPO}/contents/MYSQL_VERSION?ref={branch}",
        "-H",
        "Accept: application/vnd.github.raw",
    )
    fields = {}
    for key in ("MAJOR", "MINOR", "PATCH", "EXTRA"):
        match = re.search(rf"^MYSQL_VERSION_{key}=(.*)$", raw, re.MULTILINE)
        fields[key] = match.group(1).strip() if match else ""
    if not (fields["MAJOR"] and fields["MINOR"] and fields["PATCH"]):
        raise SystemExit(f"MYSQL_VERSION on {SHELL_REPO}@{branch} is missing MAJOR/MINOR/PATCH -- got:\n{raw}")
    return f"{fields['MAJOR']}.{fields['MINOR']}.{fields['PATCH']}{fields['EXTRA']}"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bump the MariaDB Shell version the extension requires to the one it is released with."
    )
    parser.add_argument(
        "--shell-branch", default=SHELL_VERSION_BRANCH,
        help=f"Shell repo branch to read MYSQL_VERSION from (default: {SHELL_VERSION_BRANCH}).",
    )
    parser.add_argument("--dry-run", action="store_true", help="Show what would change without writing files.")
    args = parser.parse_args()

    print(f"Reading the shell version from {SHELL_REPO}@{args.shell_branch}...")
    shell_version = read_shell_version(args.shell_branch)
    print(f"Shell version: {shell_version}")

    plans = [plan_update(target, shell_version) for target in SHELL_TARGETS]
    failed = [p for p in plans if not p["ok"]]
    if failed:
        print("Refusing to write anything -- some files didn't match as expected:")
        for p in failed:
            print(f"  {p['file']}: {p['reason']}")
        return 1

    print()
    for p in plans:
        print(f"  {p['file']}: {p['old_text']}  ->  {p['new_text']}")

    if args.dry_run:
        print("\nDry run, no files written.")
        return 0

    written = 0
    for p in plans:
        if p["abs_path"].read_text(encoding="utf-8") != p["new_content"]:
            p["abs_path"].write_text(p["new_content"], encoding="utf-8")
            written += 1

    print(f"\nUpdated {written} files: shell {shell_version}.")
    print(f"Review with \"git diff\", then commit as: Updating version to {shell_version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
