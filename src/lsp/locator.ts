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
 * Finds the `mariadb-lsp` binary: the one the settings name, else the
 * first on the PATH, else the one in `~/.local/bin`. Downloading it when
 * none is there, as the MariaDB Shell is, comes later.
 */

import * as path from "node:path";

import type { LocatorLog, ShellEnvironment } from "../shell/locator.js";
import {
    formatVersion,
    meetsMinimum,
    parseVersion,
    type ShellVersion,
} from "../shell/version.js";

/** The language server's executable, without the Windows extension. */
export const LSP_BINARY_NAME = "mariadb-lsp";

/**
 * The oldest language server this extension talks to: the first whose
 * command line answers `--version`.
 */
export const MINIMUM_LSP_VERSION = "26.9.4";

/** Where a usable language server was found. */
export type LspSource = "setting" | "path" | "userBin";

export interface LspLocation {
    /** The executable to spawn. */
    binaryPath: string;
    /** The version it reported. */
    version: ShellVersion;
    /** How it was found. */
    source: LspSource;
}

/**
 * @param platform The target platform.
 *
 * @returns `mariadb-lsp.exe` on Windows, `mariadb-lsp` elsewhere.
 */
export const lspBinaryName = (platform: NodeJS.Platform): string => {
    return platform === "win32" ? `${LSP_BINARY_NAME}.exe` : LSP_BINARY_NAME;
};

/**
 * The language server in the user's own binary directory, `~/.local/bin`,
 * on every platform.
 *
 * @param environment The environment to resolve against.
 *
 * @returns The absolute path it would be at.
 */
export const userBinPath = (environment: ShellEnvironment): string => {
    const p = environment.platform === "win32" ? path.win32 : path.posix;

    return p.join(environment.homeDir, ".local", "bin",
        lspBinaryName(environment.platform));
};

/**
 * Runs `<binary> --version` and says whether it is new enough.
 *
 * @param environment The environment to probe with.
 * @param binaryPath The executable.
 * @param minimum The lowest acceptable version.
 *
 * @returns The version, or why the binary cannot be used.
 */
const probe = async (
    environment: ShellEnvironment,
    binaryPath: string,
    minimum: ShellVersion,
): Promise<{ version?: ShellVersion; problem?: string }> => {
    const output = await environment.probeVersion(binaryPath);
    if (output === undefined) {
        return { problem: "could not be run" };
    }

    // `mariadb-lsp 26.9.4`; anything else is not this program.
    const match = /^mariadb-lsp\s+(\S+)/m.exec(output);
    const version = match ? parseVersion(match[1]) : undefined;
    if (!version) {
        const first = output.trim().split("\n")[0];

        return {
            problem: `printed no version that could be read ("${first}")`,
        };
    }

    if (!meetsMinimum(version, minimum)) {
        return {
            problem: `is ${formatVersion(version)}, older than the `
                + `${formatVersion(minimum)} this extension needs`,
        };
    }

    return { version };
};

/**
 * Finds a language server that is new enough.
 *
 * @param environment The environment to search in.
 * @param configuredPath `mariadb.lsp.path`; when set, the only place
 *                       looked at, so a setting that is wrong says so
 *                       rather than being passed over.
 * @param log Where to say what was looked at and why it was passed over.
 * @param minimumVersion The lowest acceptable version.
 *
 * @returns The location, or undefined when there is none.
 */
export const locateLanguageServer = async (
    environment: ShellEnvironment,
    configuredPath: string,
    log: LocatorLog,
    minimumVersion: string = MINIMUM_LSP_VERSION,
): Promise<LspLocation | undefined> => {
    const minimum = parseVersion(minimumVersion);
    if (!minimum) {
        throw new Error(`Invalid minimum language server version: `
            + `${minimumVersion}`);
    }

    const candidates: { binaryPath: string; source: LspSource }[] = [];
    if (configuredPath.trim() !== "") {
        candidates.push({ binaryPath: configuredPath.trim(), source: "setting" });
    } else {
        const name = lspBinaryName(environment.platform);
        log(`Looking for ${name} on the PATH: `
            + `${environment.env.PATH ?? environment.env.Path ?? ""}`);
        candidates.push({ binaryPath: name, source: "path" });

        const local = userBinPath(environment);
        if (await environment.pathExists(local)) {
            candidates.push({ binaryPath: local, source: "userBin" });
        } else {
            log(`  No ${local}.`);
        }
    }

    for (const candidate of candidates) {
        const outcome = await probe(environment, candidate.binaryPath, minimum);
        if (outcome.version) {
            return { ...candidate, version: outcome.version };
        }
        log(`  ${candidate.binaryPath} ${outcome.problem ?? ""}; not used.`);
    }

    return undefined;
};

/**
 * Renders a location for a log line.
 *
 * @param location The location to describe.
 *
 * @returns A human readable one liner.
 */
export const describeLspLocation = (location: LspLocation): string => {
    const origin = {
        setting: "named by mariadb.lsp.path",
        path: "found on the PATH",
        userBin: "found in ~/.local/bin",
    }[location.source];

    return `mariadb-lsp ${formatVersion(location.version)} ${origin} `
        + `at ${location.binaryPath}`;
};
