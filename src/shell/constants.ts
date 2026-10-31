/*
 * Copyright (c) 2026, MariaDB plc.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License, version 2.0,
 * as published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See
 * the GNU General Public License, version 2.0, for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software Foundation, Inc.,
 * 51 Franklin St, Fifth Floor, Boston, MA 02110-1301 USA
 */

/**
 * The oldest MariaDB Shell this extension can talk to. The MCP plugin's
 * stdio transport and the tool set the extension relies on only exist from
 * this release onwards.
 *
 * 26.9.3 is the floor because of the connection URI. Its parser is the first
 * to accept the `mariadb://` scheme, and the MCP plugin now stores connections
 * with their scheme - which is the only way to ask for a `mariadb+ssh://`
 * tunnel. An older shell cannot parse the URIs this one stores.
 *
 * 26.9.4 is the first release whose MCP plugin carries what this extension
 * asked of it: `db.test_connection` for the connection editor, and the
 * per-statement results of `db.execute_sql_script` - `statement_index`,
 * `execution_time`, `error`, `warnings` and `stop_on_error`.
 *
 * 26.10.5 is the first that ships `mysqlsh.task_manager` and the MCP
 * plugin's `task.get`, `task.list` and `task.cancel`, which follow the dumps
 * and loads; it has no `util.get_task` any more, and the extension does not
 * fall back to it, so an older server cannot follow or cancel a task.
 *
 * Beyond that floor it tracks the shell release the plugins go out with:
 * `tools/update_version` sets it to the version on the shell repo's
 * `main` branch, where it is bumped for a release - which is also the shell
 * the extension installs when there is none. Never set it below 26.10.5 by
 * hand.
 */
export const MINIMUM_SHELL_VERSION = "26.10.5";

/** Name of the shell executable, without a platform specific extension. */
export const SHELL_BINARY_NAME = "mariadb-shell";

/**
 * Arguments that make the shell host the MCP server over stdin/stdout for an
 * autonomous agent - Copilot. It is the same server the MariaDB AI plugins
 * start for the other coding agents.
 *
 * That server keeps the allowed-path list and asks, by MCP elicitation,
 * before touching a path outside it; it opens only the connections that
 * allow MCP access; and it serves none of the tools that write the
 * connection list or try credentials against any host.
 */
export const AGENT_MCP_SERVER_ARGS = [
    "--",
    "mcp",
    "start-server",
    "--transport=stdio",
];

/**
 * Arguments that make the shell host the MCP server for this extension:
 * {@link AGENT_MCP_SERVER_ARGS} plus `--gui`.
 *
 * `--gui` tells the server its client is this extension rather than an
 * autonomous agent, which is what gives it access to every local path - the
 * user picks those in VS Code's own dialogs, so the server's allowed-path
 * list has nothing left to confirm - and what makes the connection list
 * writable, through the `db.add_connection` and `db.delete_connection` tools
 * that only a `--gui` server serves.
 *
 * A shell whose MCP plugin predates the option ignores it rather than
 * failing, because the plugin function takes its options as a dictionary and
 * only reads the ones it knows. Such a server simply comes up without GUI
 * mode, so connection management is unavailable and paths go back to being
 * confirmed - which is why {@link MINIMUM_SHELL_VERSION} is the real gate.
 */
export const MCP_SERVER_ARGS = [...AGENT_MCP_SERVER_ARGS, "--gui"];

/**
 * Where a release's install script is: the one in the shell repository at
 * that release's tag, so the script is the one released with the shell it
 * installs rather than whatever `main` holds today.
 *
 * @param platform The platform it installs on.
 * @param version The release, without the leading `v`.
 *
 * @returns The script's URL: `install.ps1` on Windows, `install.sh`
 *          elsewhere.
 */
export const installScriptUrl = (
    platform: NodeJS.Platform,
    version: string,
): string => {
    return "https://github.com/mariadb-corporation/mariadb-shell/raw/"
        + `v${version}/${platform === "win32" ? "install.ps1" : "install.sh"}`;
};
