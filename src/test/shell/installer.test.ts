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
    FAKE_SCRIPT_FOLDER,
} from "../helpers.js";
import { installScriptUrl } from "../../shell/constants.js";
import {
    buildInstallCommand,
    cleanInstallerLine,
    summarizeInstallerFailure,
    installerProgressMessage,
    installShell,
    type ProgressHost,
} from "../../shell/installer.js";

/**
 * Builds a progress host that records the titles and messages it was given.
 *
 * @returns The host and the recordings it collects.
 */
const createRecordingProgress = (): ProgressHost & {
    titles: string[];
    messages: string[];
} => {
    const titles: string[] = [];
    const messages: string[] = [];

    return {
        titles,
        messages,
        withProgress: async <T>(
            title: string,
            task: (
                report: (message: string) => void,
                signal: AbortSignal,
            ) => Promise<T>,
        ) => {
            titles.push(title);

            return await task((message) => {
                messages.push(message);
            }, new AbortController().signal);
        },
    };
};

const SCRIPT = `${FAKE_SCRIPT_FOLDER}/install.sh`;

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

    // What malware does - a download piped into an interpreter, a script
    // run from memory, the execution policy switched off - makes the
    // Marketplace refuse the extension, whatever it is for.
    it("pipes nothing into an interpreter and bypasses no policy", () => {
        for (const platform of ["darwin", "linux", "win32"] as const) {
            const command = buildInstallCommand(platform, "26.9.2", SCRIPT);
            const line = [command.command, ...command.args].join(" ");

            expect(line).not.toMatch(/\|\s*(ba)?sh|\biex\b|Invoke-Expression|irm\b|curl|Bypass/u);
        }
    });

    it("pins the tag that was asked for", () => {
        expect(buildInstallCommand("darwin", "27.0.0", SCRIPT).env)
            .toEqual({ MARIADB_SHELL_TAG: "v27.0.0" });
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

    it("downloads the release's script, runs it as a file and removes it",
        async () => {
            const runner = createFakeRunner(transcript);
            const scripts = createFakeInstallScripts();

            await installShell({
                platform: "darwin", runner, scripts,
                progress: createRecordingProgress(),
            }, "26.9.2");

            expect(scripts.downloads).toEqual([url]);
            expect(scripts.saved.get(SCRIPT)).toContain(url);
            expect(runner.calls).toEqual([
                buildInstallCommand("darwin", "26.9.2", SCRIPT),
            ]);
            expect(scripts.removed).toEqual([SCRIPT]);
        });

    it("saves install.ps1 on Windows", async () => {
        const scripts = createFakeInstallScripts();

        await installShell({
            platform: "win32", runner: createFakeRunner(), scripts,
            progress: createRecordingProgress(),
        }, "26.9.2");

        expect(scripts.downloads)
            .toEqual([installScriptUrl("win32", "26.9.2")]);
        expect([...scripts.saved.keys()])
            .toEqual([`${FAKE_SCRIPT_FOLDER}/install.ps1`]);
    });

    it("reports download and extraction progress", async () => {
        const progress = createRecordingProgress();

        await installShell({
            platform: "darwin", runner: createFakeRunner(transcript),
            scripts: createFakeInstallScripts(), progress,
        }, "26.9.2");

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

        await expect(installShell({
            platform: "darwin",
            runner: createFakeRunner(
                ["install.sh: required command not found: curl"], 1),
            scripts, progress: createRecordingProgress(),
        }, "26.9.2")).rejects.toThrow(
            "MariaDB Shell 26.9.2 could not be installed: required command "
            + "not found: curl (the installer exited with code 1).",
        );
        expect(scripts.removed).toEqual([SCRIPT]);
    });

    it("says only the exit code when the installer gave no reason",
        async () => {
            await expect(installShell(
                {
                    platform: "darwin",
                    runner: createFakeRunner(["==> Downloading"], 2),
                    scripts: createFakeInstallScripts(),
                    progress: createRecordingProgress(),
                },
                "26.9.2",
            )).rejects.toThrow("MariaDB Shell 26.9.2 could not be installed: "
                + "the installer exited with code 2.");
        });

    it("says the script could not be downloaded, running nothing", async () => {
        const runner = createFakeRunner();
        const log = createRecordingLog();

        await expect(installShell({
            platform: "darwin", runner,
            scripts: createFakeInstallScripts("HTTP 404 Not Found"),
            progress: createRecordingProgress(), log,
        }, "26.9.2")).rejects.toThrow("The MariaDB Shell installer could not "
            + `be downloaded from ${url}: HTTP 404 Not Found`);
        expect(runner.calls).toEqual([]);
        expect(log.lines.at(-1)).toBe(
            "The installer could not be downloaded: HTTP 404 Not Found");
    });

    it("logs the script, the command, everything it printed and how it ended",
        async () => {
            const log = createRecordingLog();

            await installShell(
                {
                    platform: "darwin",
                    runner: createFakeRunner([
                        "==> Downloading",
                        "\r###      12.0%\r##########  100.0%",
                        "some noise",
                    ]),
                    scripts: createFakeInstallScripts(),
                    progress: createRecordingProgress(),
                    log,
                },
                "26.9.2",
            );

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

        await expect(installShell(
            {
                platform: "darwin",
                runner,
                scripts: createFakeInstallScripts(),
                progress: createRecordingProgress(),
            },
            "26.9.2",
        )).rejects.toThrow("The MariaDB Shell installer could not be run "
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

        await expect(installShell({
            platform: "darwin", runner,
            scripts: createFakeInstallScripts(), progress,
        }, "26.9.2")).rejects.toThrow(
            "Installing MariaDB Shell 26.9.2 was cancelled.");
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
