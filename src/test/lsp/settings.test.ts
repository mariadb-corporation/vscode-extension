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

import { serverSettings, type ISettingsReader } from "../../lsp/settings.js";

/** A settings section holding the given values, defaults for the rest. */
const reader = (values: Record<string, unknown> = {}): ISettingsReader => {
    return {
        get: <T>(key: string, defaultValue: T): T => {
            return (key in values ? values[key] : defaultValue) as T;
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
            sqlMode: "",
        });
    });
});
