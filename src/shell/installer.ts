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

import { installScriptUrl } from "./constants.js";
import { errorText } from "../text.js";

export interface InstallCommand {
    /** The interpreter to spawn. */
    command: string;
    /** Its arguments, already split - nothing is passed through a shell. */
    args: string[];
    /** Variables set for it, beside the extension host's own. */
    env?: Record<string, string>;
}

/** An install script in a file of its own, for as long as it runs. */
export interface SavedScript {
    path: string;
    /** Deletes the file, and the folder made for it. */
    remove(): Promise<void>;
}

/**
 * Fetching the install script into a file, behind an interface so the
 * install flow can be tested without a network.
 */
export interface InstallScripts {
    /**
     * Downloads a script into a folder of its own, the file named as the
     * URL names it.
     *
     * @param url The script's URL.
     * @param signal Ends the download when aborted.
     *
     * @returns The file. Rejects where the script could not be fetched,
     *          leaving nothing behind.
     */
    fetch(url: string, signal: AbortSignal): Promise<SavedScript>;
}

/**
 * A spawned command, reduced to what the installer needs.
 */
export interface ProcessRunner {
    /**
     * Runs a command to completion, streaming its output line by line.
     *
     * @param command The command to run.
     * @param onOutput Called once per line of stdout or stderr.
     * @param signal Ends the command, and everything it started, when
     *               aborted. The returned promise then rejects.
     *
     * @returns The exit code.
     */
    run(
        command: InstallCommand,
        onOutput: (line: string) => void,
        signal?: AbortSignal,
    ): Promise<number>;
}

/**
 * The progress UI, kept behind an interface so the install flow can be
 * tested without an extension host.
 */
export interface ProgressHost {
    /**
     * Shows a progress notification for the lifetime of a task.
     *
     * @param title The notification title.
     * @param task Receives a callback that updates the notification's
     *             message, and a signal that is aborted when the user
     *             cancels the notification.
     *
     * @returns Whatever the task returned.
     */
    withProgress<T>(
        title: string,
        task: (
            report: (message: string) => void,
            signal: AbortSignal,
        ) => Promise<T>,
    ): Promise<T>;
}

/**
 * Builds the command that runs a release's install script, downloaded to
 * a file, with the release pinned by `MARIADB_SHELL_TAG`.
 *
 * The script runs as a file, not piped into an interpreter: what the
 * MariaDB Shell's documentation has users paste - curl into bash,
 * `irm | iex` - is what malware does, and the Marketplace refuses an
 * extension carrying it (`tools/checkPackage.mts` keeps it out). The file
 * is the script of the release's own tag (see {@link installScriptUrl}).
 * On Windows PowerShell's default policy runs no script at all;
 * `RemoteSigned` lets a local one run, and a file the extension wrote
 * carries no mark of having come from the internet.
 *
 * @param platform The platform to install on.
 * @param version The release to install, without the leading `v`.
 * @param scriptPath The file the script is in.
 *
 * @returns The command to run.
 */
export const buildInstallCommand = (
    platform: NodeJS.Platform,
    version: string,
    scriptPath: string,
): InstallCommand => {
    const env = { MARIADB_SHELL_TAG: `v${version}` };

    if (platform === "win32") {
        return {
            command: "powershell.exe",
            args: [
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "RemoteSigned",
                "-File",
                scriptPath,
            ],
            env,
        };
    }

    // install.sh is a POSIX sh script (`#!/bin/sh`).
    return { command: "/bin/sh", args: [scriptPath], env };
};

/**
 * Both installers prefix their progress messages with `==> `. Anything else
 * they print is noise for a notification, so only the marked lines are
 * surfaced.
 *
 * @param line One line of installer output.
 *
 * @returns The message to show, or undefined if the line is not one.
 */
export const installerProgressMessage = (
    line: string,
): string | undefined => {
    const match = /^\s*==>\s*(.+?)\s*$/.exec(line);

    return match ? match[1] : undefined;
};

/**
 * Reduces one line of installer output to what is worth keeping.
 *
 * curl draws its progress bar by rewriting one line with carriage returns,
 * so a line can hold dozens of redraws; only the last one is what the
 * terminal would show, and a bare bar says nothing a log reader needs.
 *
 * @param line One line as the process runner delivered it.
 *
 * @returns The line to keep, or undefined if there is nothing in it.
 */
export const cleanInstallerLine = (line: string): string | undefined => {
    const shown = line.split("\r").at(-1)?.trim() ?? "";
    if (shown.length === 0 || /^[#O=\-\s]*(\d+(\.\d+)?%)?$/.test(shown)) {
        return undefined;
    }

    return shown;
};

/** How both installers begin the message they die with. */
const INSTALLER_ERROR_PATTERN = /^\s*install\.(sh|ps1):\s*/;

/** The transport's own complaint, e.g. `curl: (6) Could not resolve host`. */
const CURL_ERROR_PATTERN = /^\s*curl:\s*\(\d+\)/;

/** What PowerShell and the tools below it say when something went wrong. */
const GENERIC_ERROR_PATTERN =
    /\b(error|failed|could not|cannot|unable|denied|not found)\b/i;

/**
 * Picks the reason a failed installer run gave, out of everything it
 * printed that was not a progress marker.
 *
 * Both installers end on one message of their own, `install.sh: ...` or
 * `install.ps1: ...`, which can run over a line or two before the advice
 * that follows it; the transport's error, if there was one, is printed
 * above it. Either is more use in a notification than an exit code.
 *
 * @param lines The installer's non-progress output, in order.
 *
 * @returns A one line reason, or undefined if the output holds none.
 */
export const summarizeInstallerFailure = (
    lines: readonly string[],
): string | undefined => {
    const curl = lines.findLast((line) => {
        return CURL_ERROR_PATTERN.test(line);
    })?.trim();

    const start = lines.findLastIndex((line) => {
        return INSTALLER_ERROR_PATTERN.test(line);
    });
    if (start !== -1) {
        let message = lines[start].replace(INSTALLER_ERROR_PATTERN, "");
        // A message is wrapped onto indented lines until its sentence ends.
        for (let i = start + 1; i < lines.length && i <= start + 2; ++i) {
            if (/[.?!:]$/.test(message.trim())
                || !/^\s/.test(lines[i])) {
                break;
            }
            message += ` ${lines[i].trim()}`;
        }
        message = message.replace(/\s+/g, " ").trim();

        return curl ? `${message} (${curl})` : message;
    }

    return curl ?? lines.findLast((line) => {
        return GENERIC_ERROR_PATTERN.test(line);
    })?.trim();
};

/**
 * Renders a command for the log.
 *
 * @param command The command to render.
 *
 * @returns The command and its arguments on one line.
 */
const formatCommand = (command: InstallCommand): string => {
    const env = Object.entries(command.env ?? {}).map(([name, value]) => {
        return `${name}=${value}`;
    });

    return [...env, command.command, ...command.args].map((part) => {
        return /\s/.test(part) ? JSON.stringify(part) : part;
    }).join(" ");
};

export interface InstallDependencies {
    platform: NodeJS.Platform;
    runner: ProcessRunner;
    scripts: InstallScripts;
    progress: ProgressHost;
    /** Receives the command, every line it prints and how it ended. */
    log?: (message: string) => void;
}

/**
 * Downloads the pinned MariaDB Shell release's install script and runs
 * it, which downloads and unpacks the release, reporting the installer's
 * own progress messages into a notification.
 *
 * Everything the installer prints goes to the log, since a failure is only
 * ever explained there; the reason it gave is also what the error says.
 *
 * @param dependencies The platform, process runner, install scripts,
 *                     progress UI and log.
 * @param version The release to install, without the leading `v`.
 *
 * @returns Nothing; it throws if the installer fails or is cancelled.
 */
export const installShell = async (
    dependencies: InstallDependencies,
    version: string,
): Promise<void> => {
    const log = dependencies.log ?? (() => { /* not wanted */ });
    const url = installScriptUrl(dependencies.platform, version);
    const diagnostics: string[] = [];
    const started = Date.now();
    let cancelled = false;

    log(`Installing MariaDB Shell ${version} with ${url}.`);

    let exitCode: number;
    try {
        exitCode = await dependencies.progress.withProgress(
            `Installing MariaDB Shell ${version}`,
            async (report, signal) => {
                signal.addEventListener("abort", () => {
                    cancelled = true;
                });
                report("Downloading the installer...");
                const script = await dependencies.scripts.fetch(url, signal)
                    .catch((error: unknown) => {
                        throw new Error("The MariaDB Shell installer could "
                            + `not be downloaded from ${url}: `
                            + errorText(error));
                    });
                try {
                    return await runScript(dependencies, log,
                        buildInstallCommand(dependencies.platform, version,
                            script.path),
                        report, signal, diagnostics);
                } finally {
                    await script.remove().catch(() => {
                        // A file in the temporary folder: the system's.
                    });
                }
            },
        );
    } catch (error) {
        if (cancelled) {
            log("The installation was cancelled.");
            throw new Error(
                `Installing MariaDB Shell ${version} was cancelled.`,
            );
        }
        log(errorText(error));
        throw error;
    }

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    log(`The installer exited with code ${exitCode} after ${seconds}s.`);

    if (exitCode !== 0) {
        const reason = summarizeInstallerFailure(diagnostics);
        throw new Error(
            `MariaDB Shell ${version} could not be installed: `
            + (reason
                ? `${reason} (the installer exited with code ${exitCode}).`
                : `the installer exited with code ${exitCode}.`),
        );
    }
};

/**
 * Runs the installer, reporting its progress markers and keeping the rest
 * of what it prints for the reason it gives should it fail.
 *
 * @param dependencies The process runner.
 * @param log Where everything it prints goes.
 * @param command The installer's command.
 * @param report Shows a progress marker in the notification.
 * @param signal Ends it when aborted.
 * @param diagnostics Receives what it printed that was not a marker.
 *
 * @returns Its exit code.
 */
const runScript = async (
    dependencies: InstallDependencies,
    log: (message: string) => void,
    command: InstallCommand,
    report: (message: string) => void,
    signal: AbortSignal,
    diagnostics: string[],
): Promise<number> => {
    log(`Running the installer: ${formatCommand(command)}`);
    report("Starting the installer...");
    try {
        return await dependencies.runner.run(command, (raw) => {
            const line = cleanInstallerLine(raw);
            if (line === undefined) {
                return;
            }

            log(`  installer: ${line}`);
            const message = installerProgressMessage(line);
            if (message) {
                report(message);
            } else {
                diagnostics.push(raw.split("\r").at(-1) ?? raw);
            }
        }, signal);
    } catch (error) {
        if (signal.aborted) {
            throw error;
        }
        throw new Error(`The MariaDB Shell installer could not be run `
            + `(${command.command}): ${errorText(error)}`);
    }
};
