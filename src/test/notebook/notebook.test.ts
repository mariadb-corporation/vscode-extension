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
    GRAPH_MIME,
    type INotebookResultPayload,
} from "../../notebook/notebookProtocol.js";
import { NotebookResults } from "../../notebook/notebookResults.js";
import { LanguageSwitcher } from "../../notebook/languageSwitcher.js";
import { ScriptRunner } from "../../notebook/scriptRunner.js";
import { createInProcessWorker } from "./inProcessWorker.js";
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
    fireDocumentEdit,
    fireNotebookClose,
    languageSwitches,
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
    rendererMessagings,
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
            "SELECT 1; SELECT 2;": [
                { result_sets: [{ columns: ["1"], rows: [{ 1: 1 }] }] },
                { result_sets: [{ columns: ["2"], rows: [{ 2: 2 }] }] },
            ],
            "SELECT n FROM t;": [{
                result_sets: [{ columns: ["n"], rows: [{ n: 1 }],
                    has_more_pages: true }],
            }],
        },
        pagedRows: [{ n: 1 }, { n: 2 }],
    });
    const connections = new ConnectionManager(
        () => { return Promise.resolve(api); },
        createFakeSettings(defaultConnection),
    );
    const log = createRecordingLog();
    const resultView = new ResultViewProvider(Uri.file("/ext") as never, log);
    const binding = new SqlEditorBinding(connections, resultView, log,
        new SqlModes(connections, log));
    const results = new NotebookResults(resultView, binding, connections,
        log);
    const languages = new LanguageSwitcher(log, 0);
    const controller = new NotebookController(binding, results,
        new ScriptRunner(createInProcessWorker), languages, log);

    return {
        api,
        binding,
        controller,
        results,
        languages,
        log,
        kernel: notebookControllers[0],
        messaging: rendererMessagings[0],
    };
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
                        languagePinned: true,
                        outputs: [{ items: [
                            { mime: RESULT_SET_MIME, json: { id: "r" } },
                            { mime: STDOUT_MIME, text: "done\n" },
                        ] }] },
                ],
            });

            const data = serializer.deserializeNotebook(
                encoder.encode(text)) as unknown as NotebookData;

            expect(data.metadata).toEqual({ connection: "dba@localhost:3310" });
            expect(data.cells[1].metadata).toEqual({ languagePinned: true });
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
        expect(kernel.supportedLanguages)
            .toEqual(["mariadb-sql", "typescript"]);

        await kernel.executeHandler!(notebook.getCells(), notebook);

        expect(api.scripts).toEqual(["SELECT 1;", "DO 1;"]);
        const [select, statement] = kernel.executions;
        expect([select.executionOrder, statement.executionOrder])
            .toEqual([1, 2]);
        expect([select.success, statement.success]).toEqual([true, true]);
        expect(select.outputs).toHaveLength(1);
        const [item] = itemsOf(select.outputs[0]);
        expect(item.mime).toBe(RESULT_SET_MIME);
        const payload = JSON.parse(item.text) as INotebookResultPayload;
        expect(payload.connection).toBe("app@localhost:3311");
        expect(payload.viewId).toMatch(/^[0-9a-f-]{36}$/);
        expect(payload.resultSets).toHaveLength(1);
        expect(payload.resultSets[0]).toMatchObject({
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

/**
 * Runs one cell and hands back its view's id and payload.
 *
 * @param source The cell's SQL.
 *
 * @returns The controller's parts, the notebook, and the cell's payload.
 */
const runCell = async (source: string) => {
    const parts = createController("dba@localhost:3310");
    const notebook = notebookOfCells([source]);
    await parts.kernel.executeHandler!(notebook.getCells(), notebook);
    const outputs = parts.kernel.executions[0].outputs;
    const item = itemsOf(outputs[outputs.length - 1]).at(-1)!;

    return {
        ...parts,
        notebook,
        payload: JSON.parse(item.text) as INotebookResultPayload,
    };
};

describe("NotebookResults", () => {
    beforeEach(() => {
        resetVscodeMock();
    });

    /** The notebook editor a renderer's messages come from. */
    const editorOf = (notebook: unknown) => { return { notebook }; };

    it("puts a cell's result sets in one output, a tab each", async () => {
        const { payload, controller } = await runCell("SELECT 1; SELECT 2;");

        expect(payload.resultSets.map((set) => {
            return set.caption;
        })).toEqual(["Result #1", "Result #2"]);

        controller.dispose();
    });

    it("answers a view's ready with its state, as a notebook's", async () => {
        const { payload, messaging, notebook, controller } =
            await runCell("SELECT 1;");
        const editor = editorOf(notebook);

        await messaging.receive(editor, {
            viewId: payload.viewId,
            message: { type: "ready" },
        });

        expect(messaging.sent).toHaveLength(1);
        expect(messaging.sent[0].editor).toBe(editor);
        expect(messaging.sent[0].message).toMatchObject({
            viewId: payload.viewId,
            message: {
                type: "state",
                state: {
                    notebook: true,
                    connection: "dba@localhost:3310",
                    actions: [],
                    resultSets: payload.resultSets,
                },
            },
        });

        controller.dispose();
    });

    it("fetches another page into the same tab", async () => {
        const { api, payload, messaging, notebook, results, controller } =
            await runCell("SELECT n FROM t;");
        const [set] = payload.resultSets;
        expect(set.page).toMatchObject({ index: 0, hasMore: true });

        await messaging.receive(editorOf(notebook), {
            viewId: payload.viewId,
            message: { type: "page", resultId: set.id, page: 1 },
        });

        expect(api.statements.at(-1)).toMatchObject({ sql: "SELECT n FROM t" });
        const [next] = results.view(payload.viewId)!.resultSets;
        expect(next.id).toBe(set.id);
        expect(next.page).toMatchObject({ index: 1 });
        expect(messaging.sent.at(-1)!.message).toMatchObject({
            message: { type: "state", state: { resultSets: [next] } },
        });

        controller.dispose();
    });

    it("tells the grid why its edits cannot be written back", async () => {
        const { payload, messaging, notebook, controller } =
            await runCell("SELECT 1;");
        const [set] = payload.resultSets;

        await messaging.receive(editorOf(notebook), {
            viewId: payload.viewId,
            message: {
                type: "applyChanges",
                resultId: set.id,
                changes: [{ kind: "delete", rowIndex: 0, keys: { 1: 1 } }],
            },
        });

        expect(messaging.sent.at(-1)!.message).toMatchObject({
            message: {
                type: "applied",
                resultId: set.id,
                error: expect.stringMatching(/not bound to a single table/),
            },
        });

        controller.dispose();
    });

    it("refreshes a result set in its tab by running it again", async () => {
        const { api, payload, messaging, notebook, results, controller } =
            await runCell("SELECT 1;");
        const [set] = payload.resultSets;
        // The refresh runs the statement as it was split out.
        api.scripts.length = 0;

        await messaging.receive(editorOf(notebook), {
            viewId: payload.viewId,
            message: { type: "refresh", resultId: set.id },
        });

        expect(api.scripts).toEqual(["SELECT 1;"]);
        const [fresh] = results.view(payload.viewId)!.resultSets;
        expect(fresh.id).not.toBe(set.id);
        expect(fresh.caption).toBe(set.caption);
        expect(messaging.sent.at(-1)!.message).toMatchObject({
            message: { type: "state", state: { resultSets: [fresh] } },
        });

        controller.dispose();
    });

    it("takes up a reopened notebook's view from what its ready sends",
        async () => {
            const { messaging, controller, results } =
                createController("dba@localhost:3310");
            const notebook = notebookOfCells(["SELECT n FROM t;"]);
            const seed: INotebookResultPayload = {
                viewId: "view-from-a-saved-file",
                connection: "dba@localhost:3310",
                resultSets: [{
                    id: "run7-result-0",
                    caption: "Result #1",
                    statement: "SELECT n FROM t",
                    columns: [{ name: "n" }],
                    rows: [{ n: 1 }],
                    editable: false,
                    status: "1 row in set (page 1)",
                    page: { index: 0, size: 1, hasMore: true, loads: 1 },
                }],
            };

            await messaging.receive(editorOf(notebook), {
                viewId: seed.viewId,
                message: { type: "ready" },
                seed,
            });
            expect(results.view(seed.viewId)?.applyContext).toBeUndefined();

            // Paging connects it first.
            await messaging.receive(editorOf(notebook), {
                viewId: seed.viewId,
                message: { type: "page", resultId: "run7-result-0", page: 1 },
            });

            const view = results.view(seed.viewId)!;
            expect(view.applyContext?.connectionUri)
                .toBe("dba@localhost:3310");
            expect(view.resultSets[0].rows).toEqual([{ n: 2 }]);

            controller.dispose();
        });

    it("lets go of a cell's view when it runs again, or its notebook "
        + "closes", async () => {
        const { payload, kernel, notebook, results, controller } =
            await runCell("SELECT 1;");
        expect(results.view(payload.viewId)).toBeDefined();

        await kernel.executeHandler!(notebook.getCells(), notebook);
        expect(results.view(payload.viewId)).toBeUndefined();

        const again = itemsOf(kernel.executions[1].outputs[0])[0];
        const { viewId } = JSON.parse(again.text) as INotebookResultPayload;
        expect(results.view(viewId)).toBeDefined();

        fireNotebookClose(notebook);
        expect(results.view(viewId)).toBeUndefined();

        controller.dispose();
    });
});

/**
 * @param sources Each cell's text and language.
 *
 * @returns An open MariaDB Notebook of those cells.
 */
const notebookOfLanguages = (sources: Array<[string, string]>) => {
    const data = new NotebookData(sources.map(([source, language]) => {
        return new NotebookCellData(NotebookCellKind.Code, source, language);
    }));
    data.metadata = { connection: "dba@localhost:3310" };
    notebookCount += 1;

    return openMockNotebook(NOTEBOOK_TYPE, data,
        Uri.file(`/work/script${notebookCount}.mariadb-notebook`));
};

describe("TypeScript cells", () => {
    beforeEach(() => {
        resetVscodeMock();
    });

    it("run in the notebook's worker, printing as they go, sharing what they declare",
        async () => {
            const { api, kernel, controller } = createController();
            const notebook = notebookOfLanguages([
                ["const rows = await runSql(\"SELECT 1;\");\n"
                    + "print(`${rows.length} row`);\nprint(rows);\n"
                    + "const answer = 42;", "typescript"],
                ["print(\"one\"); print(\"two\"); console.error(\"bad\");\n"
                    + "print(answer);", "typescript"],
            ]);

            await kernel.executeHandler!(notebook.getCells(), notebook);

            expect(api.scripts).toEqual(["SELECT 1;"]);
            const [first, second] = kernel.executions;
            expect([first.success, second.success]).toEqual([true, true]);
            expect(first.outputs.map(itemsOf)).toEqual([
                [{ mime: STDOUT_MIME, text: "1 row\n" }],
                [
                    { mime: "application/json",
                        text: JSON.stringify([{ 1: 1 }], null, 2) },
                    { mime: "text/plain",
                        text: JSON.stringify([{ 1: 1 }], null, 2) },
                ],
            ]);
            // One stream output for as long as the stream goes on.
            expect(second.outputs.map(itemsOf)).toEqual([
                [
                    { mime: STDOUT_MIME, text: "one\n" },
                    { mime: STDOUT_MIME, text: "two\n" },
                ],
                [{ mime: STDERR_MIME, text: "bad\n" }],
                [{ mime: STDOUT_MIME, text: "42\n" }],
            ]);

            controller.dispose();
        });

    it("say where they failed, in the cell's own lines", async () => {
        const { kernel, controller } = createController();
        const notebook = notebookOfLanguages([
            ["print(\"before\");\nconst o: any = null;\no.boom;",
                "typescript"],
            ["const x = ;", "typescript"],
            ["await runSql(\"SELECT nope;\");", "typescript"],
        ]);

        await kernel.executeHandler!(notebook.getCells(), notebook);

        const [thrown, unparsed, failedSql] = kernel.executions;
        expect(thrown.success).toBe(false);
        expect(itemsOf(thrown.outputs[1])[0].text).toBe(
            "TypeError: Cannot read properties of null (reading 'boom')\n"
            + "    at cell.ts:3:3\n");
        expect(itemsOf(unparsed.outputs[0])[0]).toEqual({
            mime: STDERR_MIME,
            text: "SyntaxError: Unexpected token (1:11)\n",
        });
        expect(itemsOf(failedSql.outputs[0])[0].text)
            .toMatch(/^Error: Unknown column 'nope'/);

        controller.dispose();
    });

    it("show what a cell came to, as the MySQL Shell's notebooks did",
        async () => {
            const { kernel, controller } = createController();
            const notebook = notebookOfLanguages([
                ["await runSql(\"SELECT 1;\")", "typescript"],
                ["const answer = 42;\nconst o = { x: 1 };\no.x = 2;",
                    "typescript"],
                ["print(\"only this\")", "typescript"],
            ]);

            await kernel.executeHandler!(notebook.getCells(), notebook);

            const [rows, assigned, printed] = kernel.executions;
            expect(itemsOf(rows.outputs[0])[0]).toEqual({
                mime: "application/json",
                text: JSON.stringify([{ 1: 1 }], null, 2),
            });
            expect(assigned.outputs).toEqual([]);
            expect(printed.outputs.map(itemsOf)).toEqual(
                [[{ mime: STDOUT_MIME, text: "only this\n" }]]);

            controller.dispose();
        });

    it("share what they declare with the cells run after them", async () => {
        const { kernel, controller } = createController();
        const notebook = notebookOfLanguages([
            ["const rows = await runSql(\"SELECT 1;\");\n"
                + "function count(r: unknown[]) { return r.length; }",
                "typescript"],
            ["count(rows)", "typescript"],
        ]);

        await kernel.executeHandler!(notebook.getCells(), notebook);
        // Run again, its `const` is assigned again rather than refused.
        await kernel.executeHandler!(notebook.getCells(), notebook);

        expect(kernel.executions.map((execution) => {
            return execution.success;
        })).toEqual([true, true, true, true]);
        expect(itemsOf(kernel.executions[3].outputs[0])[0].text)
            .toBe("1\n");

        controller.dispose();
    });

    it("draw the graphs they ask for", async () => {
        const { kernel, controller } = createController();
        const notebook = notebookOfLanguages([
            ["PieGraph.render([{ name: \"a\", value: 1 }], "
                + "PieGraphLayout.ThinDonut);\n"
                + "Graph.render({ series: [{ type: \"bar\", data: [] }] });",
                "typescript"],
        ]);

        await kernel.executeHandler!(notebook.getCells(), notebook);

        const [execution] = kernel.executions;
        expect(execution.success).toBe(true);
        const items = execution.outputs.map((output) => {
            return itemsOf(output)[0];
        });
        expect(items.map((item) => { return item.mime; }))
            .toEqual([GRAPH_MIME, GRAPH_MIME]);
        expect(JSON.parse(items[0].text)).toEqual({ series: [{
            type: "pie", data: [{ name: "a", value: 1 }], radius: [150, 200],
        }] });

        controller.dispose();
    });

    it("ask for a connection only once they run SQL", async () => {
        const { kernel, controller } = createController();
        const data = new NotebookData([
            new NotebookCellData(NotebookCellKind.Code, "print(1 + 1);",
                "typescript"),
            new NotebookCellData(NotebookCellKind.Code,
                "await runSql(\"SELECT 1;\");", "typescript"),
        ]);
        const notebook = openMockNotebook(NOTEBOOK_TYPE, data,
            Uri.file("/work/unbound.mariadb-notebook"));

        await kernel.executeHandler!(notebook.getCells(), notebook);

        const [plain, sql] = kernel.executions;
        expect(plain.success).toBe(true);
        expect(itemsOf(plain.outputs[0])[0].text).toBe("2\n");
        expect(sql.success).toBe(false);
        expect(itemsOf(sql.outputs[0])[0].text).toMatch(/No connection/);

        controller.dispose();
    });

    it("start afresh once interrupted", async () => {
        const { kernel, controller } = createController();
        const notebook = notebookOfLanguages([
            ["const kept = 1;\nawait new Promise(() => {});", "typescript"],
            ["print(typeof kept === \"undefined\" ? \"gone\" : kept);",
                "typescript"],
        ]);
        const [hanging, after] = notebook.getCells();

        const running = kernel.executeHandler!([hanging], notebook);
        await new Promise((resolve) => { setTimeout(resolve, 10); });
        kernel.interruptHandler!(notebook);
        await running;
        await kernel.executeHandler!([after], notebook);

        const [stopped, next] = kernel.executions;
        expect(stopped.success).toBe(false);
        expect(itemsOf(stopped.outputs[0])[0].text).toMatch(/^Interrupted/);
        expect(itemsOf(next.outputs[0])[0].text).toBe("gone\n");

        controller.dispose();
    });
});

describe("LanguageSwitcher", () => {
    beforeEach(() => {
        resetVscodeMock();
    });

    it("switches a cell to what is typed in it", async () => {
        const { controller } = createController();
        const notebook = notebookOfLanguages([["", "mariadb-sql"]]);
        const document = notebook.getCells()[0].document;

        fireDocumentEdit(document, "const a = 1;");
        await new Promise((resolve) => { setTimeout(resolve, 5); });
        expect(document.languageId).toBe("typescript");

        fireDocumentEdit(document, "SELECT * FROM t");
        await new Promise((resolve) => { setTimeout(resolve, 5); });
        expect(document.languageId).toBe("mariadb-sql");

        // Undecided so far: left as it is.
        fireDocumentEdit(document, "foo");
        await new Promise((resolve) => { setTimeout(resolve, 5); });
        expect(languageSwitches.map((each) => {
            return each.language;
        })).toEqual(["typescript", "mariadb-sql"]);
        expect(notebook.getCells()[0].metadata.languagePinned)
            .toBeUndefined();

        controller.dispose();
    });

    it("leaves a cell alone once its language was picked by hand",
        async () => {
            const { controller } = createController();
            const notebook = notebookOfLanguages([
                ["SELECT 1", "mariadb-sql"]]);
            const cell = notebook.getCells()[0];
            fireDocumentEdit(cell.document, "SELECT 1;");
            await new Promise((resolve) => { setTimeout(resolve, 5); });

            // The user picks TypeScript in the cell's language picker.
            const { languages: vscodeLanguages } =
                await import("../mocks/vscode.js");
            await vscodeLanguages.setTextDocumentLanguage(
                cell.document, "typescript");
            expect(cell.metadata.languagePinned).toBe(true);

            fireDocumentEdit(cell.document, "SELECT 2;");
            await new Promise((resolve) => { setTimeout(resolve, 5); });
            expect(cell.document.languageId).toBe("typescript");

            controller.dispose();
        });

    it("settles a cell's language before it runs", async () => {
        const { kernel, controller } = createController();
        const notebook = notebookOfLanguages([
            ["print(\"typed fast\");", "mariadb-sql"]]);

        await kernel.executeHandler!(notebook.getCells(), notebook);

        expect(notebook.getCells()[0].document.languageId).toBe("typescript");
        expect(itemsOf(kernel.executions[0].outputs[0])[0].text)
            .toBe("typed fast\n");

        controller.dispose();
    });
});
