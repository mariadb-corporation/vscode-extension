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
    describeLspLocation,
    locateLanguageServer,
    shellInstallPath,
} from "../../lsp/locator.js";
import { createFakeEnvironment } from "../helpers.js";

const PREFIX = "/Users/mzinner/.local/share/mariadb-shell";
const NEWER = `${PREFIX}/26.10.3/bin/mariadb-lsp`;
const OLDER = `${PREFIX}/26.10.2/bin/mariadb-lsp`;

describe("shellInstallPath", () => {
    it("is next to mariadb-shell in an installation", () => {
        expect(shellInstallPath(createFakeEnvironment(), "26.10.3"))
            .toBe(NEWER);
    });

    it("is under LOCALAPPDATA, with the .exe, on Windows", () => {
        expect(shellInstallPath(createFakeEnvironment({
            platform: "win32",
            homeDir: "C:\\Users\\mz",
            env: { LOCALAPPDATA: "C:\\Users\\mz\\AppData\\Local" },
        }), "26.10.3")).toBe("C:\\Users\\mz\\AppData\\Local\\Programs\\"
            + "mariadb-shell\\26.10.3\\bin\\mariadb-lsp.exe");
    });
});

describe("locateLanguageServer", () => {
    it("takes the one on the PATH first", async () => {
        const environment = createFakeEnvironment({
            versions: {
                "mariadb-lsp": "mariadb-lsp 26.9.4\n",
                [NEWER]: "mariadb-lsp 27.1.0\n",
            },
            directories: { [PREFIX]: ["26.10.3"] },
            files: [NEWER],
        });
        const found = await locateLanguageServer(environment, "", () => {
            /* not read */
        });

        expect(found).toMatchObject({
            binaryPath: "mariadb-lsp",
            source: "path",
            version: { major: 26, minor: 9, patch: 4 },
        });
        expect(environment.probed).toEqual(["mariadb-lsp"]);
    });

    it("falls back to the newest MariaDB Shell installation that has one",
        async () => {
            const environment = createFakeEnvironment({
                versions: {
                    [NEWER]: "mariadb-lsp 26.10.0\n",
                    [OLDER]: "mariadb-lsp 26.9.4\n",
                },
                // Not a version: not one of the installer's.
                directories: { [PREFIX]: ["26.10.2", "bin", "26.10.3",
                    "26.9.0"] },
                files: [NEWER, OLDER],
            });
            const lines: string[] = [];
            const found = await locateLanguageServer(environment, "",
                (line) => { lines.push(line); });

            expect(found).toMatchObject({ binaryPath: NEWER,
                source: "shellInstall" });
            expect(environment.probed).toEqual(["mariadb-lsp", NEWER]);
            expect(lines.join("\n")).toContain("mariadb-lsp could not be run");
            // An installation from before the shell carried it.
            expect(lines.join("\n")).toContain(
                `No ${PREFIX}/26.9.0/bin/mariadb-lsp.`);
            expect(describeLspLocation(found!)).toBe("mariadb-lsp 26.10.0 "
                + `found in the MariaDB Shell installation at ${NEWER}`);
        });

    it("passes over an installation whose server is too old", async () => {
        const environment = createFakeEnvironment({
            versions: {
                [NEWER]: "mariadb-lsp 26.9.3\n",
                [OLDER]: "mariadb-lsp 26.9.4\n",
            },
            directories: { [PREFIX]: ["26.10.2", "26.10.3"] },
            files: [NEWER, OLDER],
        });
        const found = await locateLanguageServer(environment, "", () => {
            /* not read */
        });

        expect(found).toMatchObject({ binaryPath: OLDER });
    });

    it("finds the shell's under MARIADB_SHELL_PREFIX", async () => {
        const moved = "/opt/msh/26.10.3/bin/mariadb-lsp";
        const environment = createFakeEnvironment({
            env: { MARIADB_SHELL_PREFIX: "/opt/msh" },
            versions: { [moved]: "mariadb-lsp 26.10.0\n" },
            directories: { "/opt/msh": ["26.10.3"] },
            files: [moved],
        });

        expect(await locateLanguageServer(environment, "", () => {
            /* not read */
        })).toMatchObject({ binaryPath: moved });
    });

    it("passes over a binary that is too old or not mariadb-lsp", async () => {
        const environment = createFakeEnvironment({
            versions: {
                "mariadb-lsp": "mariadb-lsp 26.9.3\n",
                [NEWER]: "usage: something else 1.2.3\n",
            },
            directories: { [PREFIX]: ["26.10.3"] },
            files: [NEWER],
        });
        const lines: string[] = [];
        const found = await locateLanguageServer(environment, "", (line) => {
            lines.push(line);
        });

        expect(found).toBeUndefined();
        expect(lines.join("\n")).toContain("is 26.9.3, older than the 26.9.4");
        expect(lines.join("\n")).toContain("printed no version");
    });

    it("probes no installation that has no mariadb-lsp", async () => {
        const environment = createFakeEnvironment({
            directories: { [PREFIX]: ["26.10.3"] },
        });
        const found = await locateLanguageServer(environment, "", () => {
            /* not read */
        });

        expect(found).toBeUndefined();
        expect(environment.probed).toEqual(["mariadb-lsp"]);
    });

    it("looks only at mariadb.lsp.path when it is set", async () => {
        const environment = createFakeEnvironment({
            versions: {
                "mariadb-lsp": "mariadb-lsp 26.9.4\n",
                "/opt/lsp/mariadb-lsp": "mariadb-lsp 26.9.4\n",
            },
        });
        const found = await locateLanguageServer(environment,
            " /opt/lsp/mariadb-lsp ", () => { /* not read */ });

        expect(found).toMatchObject({
            binaryPath: "/opt/lsp/mariadb-lsp",
            source: "setting",
        });
        expect(environment.probed).toEqual(["/opt/lsp/mariadb-lsp"]);

        const missing = await locateLanguageServer(environment, "/nope",
            () => { /* not read */ });
        expect(missing).toBeUndefined();
    });
});
