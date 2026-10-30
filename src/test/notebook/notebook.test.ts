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

import { beforeEach, describe, expect, it } from "vitest";

import { ConnectionManager } from "../../connections/connectionManager.js";
import { SqlModes } from "../../connections/sqlModes.js";
import { SqlEditorBinding } from "../../editor/sqlEditorBinding.js";
import {
    notebookOf,
    openNewNotebook,
} from "../../notebook/notebookConnection.js";
import { NotebookController } from "../../notebook/notebookController.js";
import {
    NOTEBOOK_TYPE,
    RESULT_SET_MIME,
    STDERR_MIME,
    STDOUT_MIME,
} from "../../notebook/notebookFormat.js";
import { NotebookSerializer } from "../../notebook/notebookSerializer.js";
import {
    ResultViewProvider,
} from "../../webview/resultViewProvider.js";
import { createFakeApi, createFakeSettings, createRecordingLog } from
    "../helpers.js";
import {
    fireActiveNotebookChange,
    MockTextDocument,
    NotebookCellData,
    NotebookCellKind,
    NotebookCellOutput,
    NotebookCellOutputItem,
    NotebookData,
    notebookControllers,
    notebookDocuments,
    openMockNotebook,
    quickPickAnswers,
    resetVscodeMock,
    shownNotebooks,
    statusBarItems,
    Uri,
} from "../mocks/vscode.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * @param defaultConnection The default connection, if any.
 *
 * @returns A binding and the notebook controller over a fake server.
 */
const createController = (defaultConnection?: string) => {
    const api = createFakeApi({
        connections: ["dba@localhost:3310", "app@localhost:3311"],
        connectionIds: {
            "dba@localhost:3310": "uuid-dba",
            "app@localhost:3311": "uuid-app",
        },
        results: {
            "SELECT 1;": [{
                affected_items_count: 0,
                warnings_count: 0,
                result_sets: [{ columns: ["1"], rows: [{ 1: 1 }] }],
            }],
            "DO 1;": [{ affected_items_count: 0, warnings_count: 0 }],
            "SELECT nope;": [{ error: "Unknown column 'nope'" }],
        },
    });
    const connections = new ConnectionManager(
        () => { return Promise.resolve(api); },
        createFakeSettings(defaultConnection),
    );
    const log = createRecordingLog();
    const resultView = new ResultViewProvider(Uri.file("/ext") as never, log);
    const binding = new SqlEditorBinding(connections, resultView, log,
        new SqlModes(connections, log));
    const controller = new NotebookController(binding, log);

    return { api, binding, controller, log, kernel: notebookControllers[0] };
};

/** Gives each notebook a file of its own, and so its cells their URIs. */
let notebookCount = 0;

/**
 * @param sources The SQL of each cell.
 * @param connection The connection the notebook names, if any.
 *
 * @returns An open MariaDB Notebook of those cells.
 */
const notebookOfCells = (sources: string[], connection?: string) => {
    const data = new NotebookData(sources.map((source) => {
        return new NotebookCellData(
            NotebookCellKind.Code, source, "mariadb-sql");
    }));
    data.metadata = connection === undefined ? {} : { connection };

    notebookCount += 1;

    return openMockNotebook(NOTEBOOK_TYPE, data,
        Uri.file(`/work/report${notebookCount}.mariadb-notebook`));
};

/**
 * @param output A cell output.
 *
 * @returns Its items' types and contents.
 */
const itemsOf = (output: NotebookCellOutput) => {
    return output.items.map((item) => {
        return { mime: item.mime, text: decoder.decode(item.data) };
    });
};

describe("NotebookSerializer", () => {
    it("reads and writes the connection, the cells and their outputs",
        () => {
            const serializer = new NotebookSerializer();
            const text = JSON.stringify({
                version: 1,
                connection: "dba@localhost:3310",
                cells: [
                    { kind: "markdown", source: "# Report" },
                    { kind: "code", language: "mariadb-sql",
                        source: "SELECT 1;",
                        outputs: [{ items: [
                            { mime: RESULT_SET_MIME, json: { id: "r" } },
                            { mime: STDOUT_MIME, text: "done\n" },
                        ] }] },
                ],
            });

            const data = serializer.deserializeNotebook(
                encoder.encode(text)) as unknown as NotebookData;

            expect(data.metadata).toEqual({ connection: "dba@localhost:3310" });
            expect(data.cells.map((cell) => {
                return [cell.kind, cell.languageId, cell.value];
            })).toEqual([
                [NotebookCellKind.Markup, "markdown", "# Report"],
                [NotebookCellKind.Code, "mariadb-sql", "SELECT 1;"],
            ]);
            expect(itemsOf(data.cells[1].outputs![0])).toEqual([
                { mime: RESULT_SET_MIME, text: '{"id":"r"}' },
                { mime: STDOUT_MIME, text: "done\n" },
            ]);

            // A result set is saved as JSON, not as a string of it.
            const written = JSON.parse(decoder.decode(
                serializer.serializeNotebook(data as never))) as unknown;
            expect(written).toEqual(JSON.parse(text));
        });

    it("writes a cell's language as it is, and no outputs where none",
        () => {
            const data = new NotebookData([
                new NotebookCellData(NotebookCellKind.Code, "x", "typescript"),
            ]);
            const cell = data.cells[0];
            cell.outputs = [new NotebookCellOutput([
                new NotebookCellOutputItem(encoder.encode("{"),
                    RESULT_SET_MIME),
            ])];
            const plain = new NotebookData([
                new NotebookCellData(NotebookCellKind.Code, "y", "mariadb-sql"),
            ]);
            const serializer = new NotebookSerializer();

            expect(JSON.parse(decoder.decode(
                serializer.serializeNotebook(data as never)))).toEqual({
                version: 1,
                cells: [{ kind: "code", language: "typescript", source: "x",
                    // Not JSON after all: kept as the text it is.
                    outputs: [{ items: [{ mime: RESULT_SET_MIME,
                        text: "{" }] }] }],
            });
            expect(JSON.parse(decoder.decode(
                serializer.serializeNotebook(plain as never))).cells)
                .toEqual([{ kind: "code", language: "mariadb-sql",
                    source: "y" }]);
        });
});

describe("the notebook's connection", () => {
    beforeEach(() => {
        resetVscodeMock();
    });

    it("is the one its metadata names, for every cell, else the default",
        () => {
            const { binding } = createController("dba@localhost:3310");
            const named = notebookOfCells(["SELECT 1;"], "app@localhost:3311");
            const unnamed = notebookOfCells(["SELECT 1;"]);
            const cell = named.getCells()[0].document;

            expect(notebookOf(cell as never)).toBe(named);
            expect(binding.connectionFor(cell as never))
                .toBe("app@localhost:3311");
            expect(binding.connectionFor(
                unnamed.getCells()[0].document as never))
                .toBe("dba@localhost:3310");
            // A SQL file is not a cell of anything.
            expect(notebookOf(new MockTextDocument(Uri.file("/a.sql"),
                "mariadb-sql", "") as never)).toBeUndefined();

            binding.dispose();
        });

    it("is picked into the notebook, and shown in the status bar",
        async () => {
            const { binding } = createController("dba@localhost:3310");
            const notebook = notebookOfCells(["SELECT 1;"]);
            fireActiveNotebookChange(notebook);
            let bound = 0;
            binding.onDidBindConnection(() => { bound += 1; });

            expect(statusBarItems[0].visible).toBe(true);
            expect(statusBarItems[0].text).toContain("dba@localhost:3310");

            quickPickAnswers.push("app@localhost:3311");
            // Picking from a cell picks for its notebook.
            await expect(binding.selectConnection(
                notebook.getCells()[0].document as never))
                .resolves.toBe("app@localhost:3311");

            expect(notebook.metadata).toEqual(
                { connection: "app@localhost:3311" });
            expect(statusBarItems[0].text).toContain("app@localhost:3311");
            expect(bound).toBeGreaterThan(0);

            binding.dispose();
        });

    it("opens a new notebook with an empty SQL cell on a connection",
        async () => {
            await openNewNotebook("app@localhost:3311");

            const [notebook] = notebookDocuments;
            expect(notebook.notebookType).toBe(NOTEBOOK_TYPE);
            expect(notebook.metadata).toEqual(
                { connection: "app@localhost:3311" });
            expect(notebook.getCells().map((cell) => {
                return [cell.document.languageId, cell.document.getText()];
            })).toEqual([["mariadb-sql", ""]]);
            expect(shownNotebooks).toEqual([notebook]);
        });
});

describe("NotebookController", () => {
    beforeEach(() => {
        resetVscodeMock();
    });

    it("runs SQL cells on the notebook's connection", async () => {
        const { api, controller, kernel } = createController();
        const notebook = notebookOfCells(["SELECT 1;", "DO 1;"],
            "app@localhost:3311");

        expect(kernel.notebookType).toBe(NOTEBOOK_TYPE);
        expect(kernel.supportedLanguages).toEqual(["mariadb-sql"]);

        await kernel.executeHandler!(notebook.getCells(), notebook);

        expect(api.scripts).toEqual(["SELECT 1;", "DO 1;"]);
        const [select, statement] = kernel.executions;
        expect([select.executionOrder, statement.executionOrder])
            .toEqual([1, 2]);
        expect([select.success, statement.success]).toEqual([true, true]);
        expect(select.outputs).toHaveLength(1);
        const [item] = itemsOf(select.outputs[0]);
        expect(item.mime).toBe(RESULT_SET_MIME);
        expect(JSON.parse(item.text)).toMatchObject({
            rows: [{ 1: 1 }],
            status: "1 row in set",
        });
        expect(itemsOf(statement.outputs[0])).toEqual([
            { mime: STDOUT_MIME, text: "Query OK, 0 rows affected\n" },
        ]);

        controller.dispose();
        expect(kernel.disposed).toBe(true);
    });

    it("marks a cell whose statement failed, and says why", async () => {
        const { controller, kernel } = createController("dba@localhost:3310");
        const notebook = notebookOfCells(["SELECT nope;"]);

        await kernel.executeHandler!(notebook.getCells(), notebook);

        const [execution] = kernel.executions;
        expect(execution.success).toBe(false);
        expect(itemsOf(execution.outputs[0])).toEqual([
            { mime: STDERR_MIME, text: "Unknown column 'nope'\n" },
        ]);

        controller.dispose();
    });

    it("asks for a connection where there is none, and says so if not given",
        async () => {
            const { api, controller, kernel } = createController();
            const notebook = notebookOfCells(["SELECT 1;"]);

            await kernel.executeHandler!(notebook.getCells(), notebook);

            expect(api.scripts).toEqual([]);
            const [execution] = kernel.executions;
            expect(execution.success).toBe(false);
            expect(itemsOf(execution.outputs[0])[0].text)
                .toMatch(/^No connection/);

            quickPickAnswers.push("dba@localhost:3310");
            await kernel.executeHandler!(notebook.getCells(), notebook);

            expect(api.scripts).toEqual(["SELECT 1;"]);
            expect(notebook.metadata).toEqual(
                { connection: "dba@localhost:3310" });

            controller.dispose();
        });

    it("leaves an empty cell be", async () => {
        const { api, controller, kernel } = createController(
            "dba@localhost:3310");
        const notebook = notebookOfCells(["  \n"]);

        await kernel.executeHandler!(notebook.getCells(), notebook);

        expect(api.scripts).toEqual([]);
        expect(kernel.executions[0].success).toBe(true);
        expect(kernel.executions[0].outputs).toEqual([]);

        controller.dispose();
    });
});
