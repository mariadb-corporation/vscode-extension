#!/usr/bin/env python3
# Copyright (c) 2026, MariaDB plc.
#
# Checks the extension's copies of what the mrs plugin pins for the OpenAPI
# UI: the Swagger UI release it downloads and the request path it serves it
# at. The dialog shows the release and prefills the path before anything is
# asked of the plugin, and the plugin exposes neither, so the extension keeps
# its own copies in src/mrs/mrsDialogs.ts. This fetches the plugin's source
# from mariadb-shell-plugins on GitHub and fails when the copies differ.
#
# Run by CI on every change; runs by hand too, with no login needed, since
# the plugins repository is public. --ref picks the branch or tag to compare
# with, main by default.

import argparse
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
EXTENSION_PATH = "src/mrs/mrsDialogs.ts"
EXTENSION_FILE = REPO_ROOT / EXTENSION_PATH

PLUGINS_REPO = "mariadb-corporation/mariadb-shell-plugins"
PLUGIN_FILE = "mrs_plugin/lib/open_api_ui.py"
DEFAULT_REF = "main"

# (what it is, the extension's constant, the plugin's constant)
PINS = [
    ("Swagger UI release", "OPEN_API_UI_VERSION", "SWAGGER_UI_VERSION"),
    ("request path", "OPEN_API_UI_PATH", "DEFAULT_REQUEST_PATH"),
]


def constant(source: str, where: str, name: str, pattern: str) -> str:
    matches = re.findall(pattern.format(name=re.escape(name)), source, re.MULTILINE)
    if len(matches) != 1:
        raise SystemExit(f"{where}: expected exactly one {name} = \"...\" line, found {len(matches)}")
    return matches[0]


def fetch_plugin_source(ref: str) -> str:
    url = f"https://raw.githubusercontent.com/{PLUGINS_REPO}/{ref}/{PLUGIN_FILE}"
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            return response.read().decode("utf-8")
    except urllib.error.URLError as exc:
        raise SystemExit(f"Could not fetch {url}: {exc}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check the extension's OpenAPI UI pins against the mrs plugin's."
    )
    parser.add_argument(
        "--ref", default=DEFAULT_REF,
        help=f"Branch or tag of {PLUGINS_REPO} to compare with (default: {DEFAULT_REF}).",
    )
    args = parser.parse_args()

    extension = EXTENSION_FILE.read_text(encoding="utf-8")
    plugin = fetch_plugin_source(args.ref)

    mismatches = []
    for what, ours, theirs in PINS:
        here = constant(extension, EXTENSION_FILE.name, ours,
                        r'^export const {name} = "([^"]*)";$')
        there = constant(plugin, f"{PLUGIN_FILE}@{args.ref}", theirs,
                         r'^{name} = "([^"]*)"$')
        state = "ok" if here == there else "MISMATCH"
        print(f"  {what}: extension {here}, plugin {there}  ({state})")
        if here != there:
            mismatches.append(what)

    if mismatches:
        print(f"\nThe extension's {' and '.join(mismatches)} differ from {PLUGIN_FILE} on "
              f"{PLUGINS_REPO}@{args.ref}. Update the constants in {EXTENSION_PATH}.")
        return 1
    print(f"\nThe OpenAPI UI pins match {PLUGINS_REPO}@{args.ref}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
