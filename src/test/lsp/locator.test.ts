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
    userBinPath,
} from "../../lsp/locator.js";
import { createFakeEnvironment } from "../helpers.js";

const LOCAL = "/Users/mzinner/.local/bin/mariadb-lsp";

describe("userBinPath", () => {
    it("is ~/.local/bin/mariadb-lsp on POSIX", () => {
        expect(userBinPath(createFakeEnvironment())).toBe(LOCAL);
    });

    it("has the .exe on Windows", () => {
        expect(userBinPath(createFakeEnvironment({
            platform: "win32",
            homeDir: "C:\\Users\\mz",
        }))).toBe("C:\\Users\\mz\\.local\\bin\\mariadb-lsp.exe");
    });
});

describe("locateLanguageServer", () => {
    it("takes the one on the PATH first", async () => {
        const environment = createFakeEnvironment({
            versions: {
                "mariadb-lsp": "mariadb-lsp 26.9.4\n",
                [LOCAL]: "mariadb-lsp 27.1.0\n",
            },
            files: [LOCAL],
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

    it("falls back to ~/.local/bin", async () => {
        const environment = createFakeEnvironment({
            versions: { [LOCAL]: "mariadb-lsp 26.10.0\n" },
            files: [LOCAL],
        });
        const lines: string[] = [];
        const found = await locateLanguageServer(environment, "", (line) => {
            lines.push(line);
        });

        expect(found).toMatchObject({ binaryPath: LOCAL, source: "userBin" });
        expect(lines.join("\n")).toContain("mariadb-lsp could not be run");
        expect(describeLspLocation(found!)).toBe(
            `mariadb-lsp 26.10.0 found in ~/.local/bin at ${LOCAL}`);
    });

    it("passes over a binary that is too old or not mariadb-lsp", async () => {
        const environment = createFakeEnvironment({
            versions: {
                "mariadb-lsp": "mariadb-lsp 26.9.3\n",
                [LOCAL]: "usage: something else 1.2.3\n",
            },
            files: [LOCAL],
        });
        const lines: string[] = [];
        const found = await locateLanguageServer(environment, "", (line) => {
            lines.push(line);
        });

        expect(found).toBeUndefined();
        expect(lines.join("\n")).toContain("is 26.9.3, older than the 26.9.4");
        expect(lines.join("\n")).toContain("printed no version");
    });

    it("does not probe ~/.local/bin when nothing is there", async () => {
        const environment = createFakeEnvironment();
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
