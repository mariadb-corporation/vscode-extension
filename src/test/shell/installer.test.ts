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

import { describe, expect, it } from "vitest";

import {
    createFakeInstallScripts,
    createFakeRunner,
    createRecordingLog,
    createRecordingProgress,
    fakeScriptPath,
} from "../helpers.js";
import { installScriptUrl } from "../../shell/constants.js";
import {
    buildInstallCommand,
    cleanInstallerLine,
    summarizeInstallerFailure,
    installerProgressMessage,
    installShell,
    type InstallDependencies,
    type ProgressHost,
} from "../../shell/installer.js";

const SCRIPT = fakeScriptPath();

describe("installScriptUrl", () => {
    it("takes the script of the release's own tag", () => {
        expect(installScriptUrl("darwin", "26.10.3")).toBe(
            "https://github.com/mariadb-corporation/mariadb-shell/raw/"
            + "v26.10.3/install.sh");
        expect(installScriptUrl("linux", "26.10.3"))
            .toBe(installScriptUrl("darwin", "26.10.3"));
        expect(installScriptUrl("win32", "26.10.3")).toBe(
            "https://github.com/mariadb-corporation/mariadb-shell/raw/"
            + "v26.10.3/install.ps1");
    });
});

describe("buildInstallCommand", () => {
    it("runs the downloaded install.sh with sh on macOS and Linux", () => {
        const command = buildInstallCommand("darwin", "26.9.2", SCRIPT);

        expect(command).toEqual({
            command: "/bin/sh",
            args: [SCRIPT],
            env: { MARIADB_SHELL_TAG: "v26.9.2" },
        });
        expect(buildInstallCommand("linux", "26.9.2", SCRIPT))
            .toEqual(command);
    });

    it("runs the downloaded install.ps1 as a file on Windows", () => {
        const script = "C:\\Temp\\install.ps1";

        expect(buildInstallCommand("win32", "26.9.2", script)).toEqual({
            command: "powershell.exe",
            args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy",
                "RemoteSigned", "-File", script],
            env: { MARIADB_SHELL_TAG: "v26.9.2" },
        });
    });
});

describe("installerProgressMessage", () => {
    it("picks up the installer's own progress markers", () => {
        expect(installerProgressMessage("==> Downloading"))
            .toBe("Downloading");
        expect(installerProgressMessage("==> Unpacking into /opt/x"))
            .toBe("Unpacking into /opt/x");
        expect(installerProgressMessage("  ==> Verifying checksum  "))
            .toBe("Verifying checksum");
    });

    it("ignores everything else", () => {
        expect(installerProgressMessage("plain output")).toBeUndefined();
        expect(installerProgressMessage("")).toBeUndefined();
        expect(installerProgressMessage("install.sh: failed"))
            .toBeUndefined();
    });
});

describe("installShell", () => {
    const transcript = [
        "==> Detected: macos 15, arm64",
        "==> Fetching package list from the v26.9.2 release",
        "some noise that is not a progress marker",
        "==> Downloading",
        "==> Verifying checksum",
        "==> Unpacking into /Users/mzinner/.local/share/mariadb-shell",
    ];
    const url = installScriptUrl("darwin", "26.9.2");

    /** An install on macOS where nothing goes wrong, but what is changed. */
    const deps = (
        changes: Partial<InstallDependencies> = {},
    ): InstallDependencies => {
        return {
            platform: "darwin",
            runner: createFakeRunner(),
            scripts: createFakeInstallScripts(),
            progress: createRecordingProgress(),
            ...changes,
        };
    };

    it("downloads the release's script, runs it as a file and removes it",
        async () => {
            const runner = createFakeRunner(transcript);
            const scripts = createFakeInstallScripts();

            await installShell(deps({ runner, scripts }), "26.9.2");

            expect(scripts.downloads).toEqual([url]);
            expect(runner.calls).toEqual([
                buildInstallCommand("darwin", "26.9.2", SCRIPT),
            ]);
            expect(scripts.removed).toEqual([SCRIPT]);
        });

    it("runs install.ps1 on Windows", async () => {
        const runner = createFakeRunner();
        const scripts = createFakeInstallScripts();

        await installShell(deps({ platform: "win32", runner, scripts }),
            "26.9.2");

        expect(scripts.downloads)
            .toEqual([installScriptUrl("win32", "26.9.2")]);
        expect(runner.calls[0].args.at(-1))
            .toBe(fakeScriptPath("install.ps1"));
    });

    it("reports download and extraction progress", async () => {
        const progress = createRecordingProgress();

        await installShell(deps({
            runner: createFakeRunner(transcript), progress,
        }), "26.9.2");

        expect(progress.titles).toEqual(["Installing MariaDB Shell 26.9.2"]);
        expect(progress.messages).toEqual([
            "Downloading the installer...",
            "Starting the installer...",
            "Detected: macos 15, arm64",
            "Fetching package list from the v26.9.2 release",
            "Downloading",
            "Verifying checksum",
            "Unpacking into /Users/mzinner/.local/share/mariadb-shell",
        ]);
    });

    it("throws when the installer fails, and removes its file", async () => {
        const scripts = createFakeInstallScripts();

        await expect(installShell(deps({
            runner: createFakeRunner(
                ["install.sh: required command not found: curl"], 1),
            scripts,
        }), "26.9.2")).rejects.toThrow(
            "MariaDB Shell 26.9.2 could not be installed: required command "
            + "not found: curl (the installer exited with code 1).",
        );
        expect(scripts.removed).toEqual([SCRIPT]);
    });

    it("says only the exit code when the installer gave no reason",
        async () => {
            await expect(installShell(deps({
                runner: createFakeRunner(["==> Downloading"], 2),
            }), "26.9.2")).rejects.toThrow("MariaDB Shell 26.9.2 could not "
                + "be installed: the installer exited with code 2.");
        });

    it("says the script could not be downloaded, running nothing", async () => {
        const runner = createFakeRunner();
        const log = createRecordingLog();
        const said = "The MariaDB Shell installer could not be downloaded "
            + `from ${url}: HTTP 404 Not Found`;

        await expect(installShell(deps({
            runner, scripts: createFakeInstallScripts("HTTP 404 Not Found"),
            log,
        }), "26.9.2")).rejects.toThrow(said);
        expect(runner.calls).toEqual([]);
        expect(log.lines.at(-1)).toBe(said);
    });

    it("logs the script, the command, everything it printed and how it ended",
        async () => {
            const log = createRecordingLog();

            await installShell(deps({
                runner: createFakeRunner([
                    "==> Downloading",
                    "\r###      12.0%\r##########  100.0%",
                    "some noise",
                ]),
                log,
            }), "26.9.2");

            expect(log.lines[0])
                .toBe(`Installing MariaDB Shell 26.9.2 with ${url}.`);
            expect(log.lines[1]).toBe("Running the installer: "
                + `MARIADB_SHELL_TAG=v26.9.2 /bin/sh ${SCRIPT}`);
            // The progress bar is not worth a log line of its own.
            expect(log.lines.slice(2, -1)).toEqual([
                "  installer: ==> Downloading",
                "  installer: some noise",
            ]);
            expect(log.lines.at(-1))
                .toMatch(/^The installer exited with code 0 after \d/);
        });

    it("says the installer could not be run", async () => {
        const runner = {
            run: () => {
                return Promise.reject(new Error("spawn /bin/sh ENOENT"));
            },
        };

        await expect(installShell(deps({ runner }), "26.9.2")).rejects
            .toThrow("The MariaDB Shell installer could not be run "
                + "(/bin/sh): spawn /bin/sh ENOENT");
    });

    it("says it was cancelled when the user cancelled it", async () => {
        const controller = new AbortController();
        const progress: ProgressHost = {
            withProgress: async (_title, task) => {
                return await task(() => { /* not recorded */ },
                    controller.signal);
            },
        };
        const runner = {
            run: (
                _command: unknown,
                _onOutput: unknown,
                signal?: AbortSignal,
            ) => {
                return new Promise<number>((_resolve, reject) => {
                    signal?.addEventListener("abort", () => {
                        reject(new Error("Cancelled."));
                    });
                    controller.abort();
                });
            },
        };

        await expect(installShell(deps({ runner, progress }), "26.9.2"))
            .rejects.toThrow("Installing MariaDB Shell 26.9.2 was cancelled.");
    });
});

describe("cleanInstallerLine", () => {
    it("keeps what a terminal would show last", () => {
        expect(cleanInstallerLine("\r##  10.0%\rcurl: (6) no host"))
            .toBe("curl: (6) no host");
    });

    it("drops a bare progress bar", () => {
        expect(cleanInstallerLine("\r######  45.2%")).toBeUndefined();
        expect(cleanInstallerLine("#=#=#")).toBeUndefined();
        expect(cleanInstallerLine("   ")).toBeUndefined();
    });

    it("leaves an ordinary line alone", () => {
        expect(cleanInstallerLine("==> Downloading")).toBe("==> Downloading");
    });
});

describe("summarizeInstallerFailure", () => {
    it("takes the installer's own message, joined across its lines", () => {
        expect(summarizeInstallerFailure([
            "==> Fetching package list",
            "install.sh: could not download SHA256SUMS from the v26.9.9 "
                + "release",
            "  of mariadb-corporation/mariadb-shell.",
            "  The repository may be private, or that release may not exist.",
        ])).toBe("could not download SHA256SUMS from the v26.9.9 release "
            + "of mariadb-corporation/mariadb-shell.");
    });

    it("adds what curl said", () => {
        expect(summarizeInstallerFailure([
            "  curl: (22) The requested URL returned error: 404",
            "install.sh: could not download SHA256SUMS.",
        ])).toBe("could not download SHA256SUMS. "
            + "(curl: (22) The requested URL returned error: 404)");
    });

    it("reads the Windows installer's message too", () => {
        expect(summarizeInstallerFailure([
            "install.ps1: no compatible package for windows / arm-64bit.",
        ])).toBe("no compatible package for windows / arm-64bit.");
    });

    it("falls back to curl when the script itself could not be fetched",
        () => {
            expect(summarizeInstallerFailure([
                "curl: (6) Could not resolve host: github.com",
            ])).toBe("curl: (6) Could not resolve host: github.com");
        });

    it("falls back to a line that reads like an error", () => {
        expect(summarizeInstallerFailure([
            "irm : The remote name could not be resolved: 'github.com'",
            "At line:1 char:40",
        ])).toBe("irm : The remote name could not be resolved: 'github.com'");
    });

    it("finds nothing in output that gives no reason", () => {
        expect(summarizeInstallerFailure(["some noise"])).toBeUndefined();
    });
});
