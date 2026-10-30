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
    outputsOf,
    parseNotebook,
    RESULT_SET_MIME,
    serializeNotebook,
    STDERR_MIME,
    STDOUT_MIME,
    succeeded,
} from "../../notebook/notebookFormat.js";
import type {
    IActionRow,
    IExecutionReport,
    IResultSet,
} from "../../webview/protocol.js";

/**
 * @param id The row's id.
 * @param fields What else it carries.
 *
 * @returns A statement row.
 */
const row = (id: string, fields: Partial<IActionRow>): IActionRow => {
    return {
        id,
        time: "10:00:00.000",
        connection: "dba@localhost:3310",
        role: "statement",
        statement: "",
        message: "",
        kind: "info",
        ...fields,
    };
};

/**
 * @param id The result set's id.
 *
 * @returns A one-row result set.
 */
const resultSet = (id: string): IResultSet => {
    return {
        id,
        caption: "Result #1",
        statement: "SELECT 1",
        columns: [{ name: "1" }],
        rows: [{ 1: 1 }],
        editable: false,
        status: "1 row in set",
    };
};

/**
 * @param children The statement rows.
 * @param resultSets The result sets they point at.
 * @param kind How the run as a whole went.
 *
 * @returns A report of one run.
 */
const report = (
    children: IActionRow[],
    resultSets: IResultSet[] = [],
    kind: IActionRow["kind"] = "info",
): IExecutionReport => {
    return {
        connection: "dba@localhost:3310",
        startedAt: "10:00:00.000",
        elapsedMs: 3,
        actions: [row("run1", { role: "run", kind, children })],
        resultSets,
    };
};

describe("parseNotebook", () => {
    it("reads an empty file as an empty notebook", () => {
        expect(parseNotebook("")).toEqual({ version: 1, cells: [] });
        expect(parseNotebook("  \n")).toEqual({ version: 1, cells: [] });
    });

    it("reads the connection and the cells", () => {
        expect(parseNotebook(JSON.stringify({
            version: 1,
            connection: "dba@localhost:3310",
            cells: [
                { kind: "markdown", language: "ignored", source: "# Hi" },
                { kind: "code", language: "mariadb-sql", source: "SELECT 1;",
                    outputs: [{ items: [{ mime: STDOUT_MIME, text: "x" }] }] },
                { source: 42 },
            ],
        }))).toEqual({
            version: 1,
            connection: "dba@localhost:3310",
            cells: [
                { kind: "markdown", source: "# Hi" },
                { kind: "code", language: "mariadb-sql", source: "SELECT 1;",
                    outputs: [{ items: [{ mime: STDOUT_MIME, text: "x" }] }] },
                { kind: "code", source: "" },
            ],
        });
    });

    it("says what is wrong with a file that is not a notebook", () => {
        expect(() => { return parseNotebook("{"); })
            .toThrow(/not valid JSON/);
        expect(() => { return parseNotebook("{}"); })
            .toThrow(/not a MariaDB Notebook/);
        expect(() => { return parseNotebook('{"version": 2, "cells": []}'); })
            .toThrow(/format version 2/);
    });

    it("reads back what it writes", () => {
        const file = {
            version: 1,
            connection: "dba@localhost:3310",
            cells: [{ kind: "code" as const, language: "mariadb-sql",
                source: "SELECT 1;" }],
        };
        const text = serializeNotebook(file);

        expect(text.endsWith("}\n")).toBe(true);
        expect(text).toContain('\n  "cells": [');
        expect(parseNotebook(text)).toEqual(file);
    });
});

describe("outputsOf", () => {
    it("puts a result set out on its own, and the messages around it",
        () => {
            const outputs = outputsOf(report([
                row("run1-0", { message: "Query OK, 0 rows affected" }),
                row("run1-1", { message: "1 row in set",
                    resultId: "run1-result-0" }),
                row("run1-2", { message: "Query OK, 1 row affected",
                    kind: "warning",
                    children: [row("run1-2-warning-0", { role: "warning",
                        statement: "Warning 1265",
                        message: "Data truncated" })] }),
                row("run1-3", { message: "Query OK, 1 row affected" }),
            ], [resultSet("run1-result-0")]));

            expect(outputs).toEqual([
                { items: [{ mime: STDOUT_MIME,
                    text: "Query OK, 0 rows affected\n" }] },
                { items: [{ mime: RESULT_SET_MIME,
                    json: resultSet("run1-result-0") }] },
                { items: [{ mime: STDOUT_MIME,
                    text: "Query OK, 1 row affected\n"
                        + "Warning 1265: Data truncated\n"
                        + "Query OK, 1 row affected\n" }] },
            ]);
        });

    it("puts out each result set a procedure returned", () => {
        const outputs = outputsOf(report([
            row("run1-0", { message: "2 result sets",
                resultId: "run1-result-0",
                children: [
                    row("run1-0-set-0", { resultId: "run1-result-0" }),
                    row("run1-0-set-1", { resultId: "run1-result-1" }),
                ] }),
        ], [resultSet("run1-result-0"), resultSet("run1-result-1")]));

        expect(outputs.map((output) => {
            return output.items[0];
        })).toEqual([
            { mime: RESULT_SET_MIME, json: resultSet("run1-result-0") },
            { mime: RESULT_SET_MIME, json: resultSet("run1-result-1") },
        ]);
    });

    it("puts an error out as an error stream", () => {
        const failed = report([
            row("run1-0", { message: "Query OK, 0 rows affected" }),
            row("run1-1", { message: "Table 'x' doesn't exist",
                kind: "error" }),
        ], [], "error");

        expect(outputsOf(failed)).toEqual([
            { items: [{ mime: STDOUT_MIME,
                text: "Query OK, 0 rows affected\n" }] },
            { items: [{ mime: STDERR_MIME,
                text: "Table 'x' doesn't exist\n" }] },
        ]);
        expect(succeeded(failed)).toBe(false);
        expect(succeeded(report([]))).toBe(true);
    });
});
