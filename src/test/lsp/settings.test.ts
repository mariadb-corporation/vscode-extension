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

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
    LIVE_SERVER_SETTINGS, serverSettings, type ISettingsReader,
} from "../../lsp/settings.js";

/** The defaults package.json gives the keys below `mariadb.lsp`. */
const DEFAULTS = new Map(Object.entries((JSON.parse(readFileSync(
    new URL("../../../package.json", import.meta.url), "utf8")) as {
    contributes: {
        configuration: { properties: Record<string, { default?: unknown; }>; };
    };
}).contributes.configuration.properties).filter(([key]) => {
    return key.startsWith("mariadb.lsp.");
}).map(([key, property]) => {
    return [key.slice("mariadb.lsp.".length), property.default];
}));

/**
 * A settings section holding the given values, package.json's defaults for
 * the rest, as VS Code's is. A key package.json does not have, or a
 * default that is not package.json's, fails the test.
 *
 * @param values The values set.
 * @param read Where the keys read are added.
 *
 * @returns The section.
 */
const reader = (
    values: Record<string, unknown> = {},
    read = new Set<string>(),
): ISettingsReader => {
    return {
        get: <T>(key: string, defaultValue: T): T => {
            read.add(key);
            expect(DEFAULTS.has(key), key).toBe(true);
            expect(defaultValue, key).toEqual(DEFAULTS.get(key));

            return (key in values ? values[key] : DEFAULTS.get(key)) as T;
        },
    };
};

describe("serverSettings", () => {
    it("sends the server's own defaults when nothing is set", () => {
        expect(serverSettings(reader())).toEqual({
            catalogFiles: [],
            catalogRefreshSeconds: 0,
            keywordCase: "upper",
            indentation: "editor",
            lineWidth: 80,
            indentClauses: true,
            indentRoutineClauses: true,
            completionAddsTables: true,
            sqlMode: "",
            debounceMs: 150,
            maxDiagnostics: 1000,
            progressThreshold: 4 * 1024 * 1024,
        });
    });

    it("maps the settings to the server's names and units", () => {
        expect(serverSettings(reader({
            catalogFiles: ["schema/", " ", "seed.sql", 3],
            catalogRefreshSeconds: 60,
            keywordCase: "lower",
            indentation: "tab",
            lineWidth: 0,
            indentClauses: false,
            indentRoutineClauses: false,
            completionAddsTables: false,
            sqlMode: "ANSI_QUOTES",
            serverVersion: " 11.4.2 ",
            debounceMs: 0,
            maxDiagnostics: 50,
            progressThresholdMB: 0.5,
        }))).toEqual({
            catalogFiles: ["schema/", "seed.sql"],
            catalogRefreshSeconds: 60,
            keywordCase: "lower",
            indentation: "tab",
            lineWidth: 0,
            indentClauses: false,
            indentRoutineClauses: false,
            completionAddsTables: false,
            sqlMode: "ANSI_QUOTES",
            serverVersion: "11.4.2",
            debounceMs: 0,
            maxDiagnostics: 50,
            progressThreshold: 512 * 1024,
        });
    });

    it("leaves out what the server would refuse", () => {
        const options = serverSettings(reader({
            catalogFiles: "schema.sql",
            catalogRefreshSeconds: -1,
            keywordCase: "Title",
            indentation: "3 spaces",
            lineWidth: -1,
            indentClauses: "yes",
            indentRoutineClauses: 1,
            completionAddsTables: null,
            debounceMs: 1.5,
            maxDiagnostics: "many",
            progressThresholdMB: -2,
        }));
        expect(options).toEqual({
            catalogFiles: [],
            keywordCase: "upper",
            indentation: "editor",
            indentClauses: true,
            indentRoutineClauses: true,
            completionAddsTables: true,
            sqlMode: "",
        });
    });

    it("reads every live setting, and of the others serverVersion only",
        () => {
            const read = new Set<string>();
            serverSettings(reader({}, read));

            expect([...read].sort()).toEqual(
                [...LIVE_SERVER_SETTINGS, "serverVersion"].sort());
        });
});
