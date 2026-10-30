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

import { randomUUID } from "node:crypto";

import * as vscode from "vscode";

import { stopOnError } from "../connections/settings.js";
import type { SqlEditorBinding } from "../editor/sqlEditorBinding.js";
import { MARIADB_SQL_LANGUAGE_ID } from "../editor/sqlLanguage.js";
import { TYPESCRIPT_LANGUAGE_ID } from "./languageDetection.js";
import type { LanguageSwitcher } from "./languageSwitcher.js";
import {
    NOTEBOOK_TYPE,
    outputsOf,
    STDERR_MIME,
    STDOUT_MIME,
    succeeded,
} from "./notebookFormat.js";
import type { NotebookResults } from "./notebookResults.js";
import { toCellOutput } from "./notebookSerializer.js";
import type { PrintedValue } from "./scriptProtocol.js";
import type { ScriptRunner } from "./scriptRunner.js";
import { errorText } from "../text.js";

const encoder = new TextEncoder();

/** What a cell is told where it needs a connection and there is none. */
const NO_CONNECTION = "No connection: pick one for the notebook with Select "
    + "Connection in its toolbar.";

/** The controller's id: the one kernel a MariaDB Notebook has. */
export const NOTEBOOK_CONTROLLER_ID = "mariadb-notebook-kernel";

/**
 * Runs the cells of a MariaDB Notebook on the notebook's connection, one
 * after the other, and puts what each produced under it: what the
 * statements said as text, errors in red, and the result sets as the
 * MariaDB panel shows them - a tab each, with their toolbar - kept live
 * by `NotebookResults`.
 *
 * A SQL cell runs as a script, the way a SQL file does: every statement in
 * it, stopping at the first that fails where stop-on-error is set. Nothing
 * of it goes to the MariaDB panel. A TypeScript cell runs in its
 * notebook's worker (`ScriptRunner`), what it prints shown as it prints
 * it; Interrupt ends that worker.
 */
export class NotebookController implements vscode.Disposable {
    readonly #controller: vscode.NotebookController;
    /** Counts the runs, so each cell's run has an order number. */
    #executionOrder = 0;
    /** Lets go of a closed notebook's worker. */
    readonly #closing: vscode.Disposable;

    /**
     * @param editors Which connection a notebook runs on, and running a
     *                script on it.
     * @param results Where a run's result sets are kept for their view.
     * @param scripts Runs the TypeScript cells.
     * @param languages Settles a cell's language before it runs, where it
     *                  was run before typing paused.
     * @param log Where failures are noted.
     */
    public constructor(
        private readonly editors: SqlEditorBinding,
        private readonly results: NotebookResults,
        private readonly scripts: ScriptRunner,
        private readonly languages: LanguageSwitcher,
        private readonly log: (message: string) => void,
    ) {
        this.#controller = vscode.notebooks.createNotebookController(
            NOTEBOOK_CONTROLLER_ID, NOTEBOOK_TYPE, "MariaDB");
        this.#controller.supportedLanguages = [
            MARIADB_SQL_LANGUAGE_ID,
            TYPESCRIPT_LANGUAGE_ID,
        ];
        this.#controller.supportsExecutionOrder = true;
        this.#controller.description =
            "Runs SQL and TypeScript on the notebook's connection";
        this.#controller.executeHandler = async (cells, notebook) => {
            for (const cell of cells) {
                await this.#run(cell, notebook);
            }
        };
        this.#controller.interruptHandler = (notebook) => {
            this.scripts.interrupt(notebook.uri.toString());
        };
        this.#closing = vscode.workspace.onDidCloseNotebookDocument(
            (notebook) => {
                this.scripts.forget(notebook.uri.toString());
            });
    }


    /**
     * Runs one cell.
     *
     * @param cell The cell.
     * @param notebook The notebook it is in.
     *
     * @returns Nothing; a failure ends up as the cell's output.
     */
    async #run(
        cell: vscode.NotebookCell,
        notebook: vscode.NotebookDocument,
    ): Promise<void> {
        const execution = this.#controller.createNotebookCellExecution(cell);
        this.#executionOrder += 1;
        execution.executionOrder = this.#executionOrder;
        execution.start(Date.now());
        await execution.clearOutput();
        this.results.forgetCell(cell);

        const script = cell.document.getText();
        if (script.trim().length === 0) {
            execution.end(true, Date.now());

            return;
        }

        await this.languages.detectNow(cell.document);
        if (cell.document.languageId === TYPESCRIPT_LANGUAGE_ID) {
            await this.#runTypeScript(execution, notebook, script);

            return;
        }

        const uri = this.editors.notebookConnectionFor(notebook)
            ?? await this.editors.selectNotebookConnection(notebook);
        if (uri === undefined) {
            await execution.replaceOutput(toCellOutput({
                items: [{ mime: STDERR_MIME, text: `${NO_CONNECTION}\n` }],
            }));
            execution.end(false, Date.now());

            return;
        }

        try {
            const source = {
                uri: cell.document.uri.toString(),
                positionAt: (offset: number) => {
                    const position = cell.document.positionAt(offset);

                    return {
                        line: position.line,
                        character: position.character,
                    };
                },
            };
            const { report, connectionId, service } =
                await this.editors.executeScript(uri, script, {
                    runId: this.editors.nextRunId(),
                    stopOnError: stopOnError(),
                    source,
                });
            const viewId = randomUUID();
            if (report.resultSets.length > 0) {
                this.results.register({
                    viewId,
                    notebook,
                    cell,
                    connection: uri,
                    applyContext: { connectionUri: uri, connectionId, service },
                    resultSets: report.resultSets,
                });
            }
            await execution.replaceOutput(outputsOf(report,
                { viewId, connection: uri }).map(toCellOutput));
            execution.end(succeeded(report), Date.now());
        } catch (error) {
            // Logged, not notified: the cell's output already says it.
            const message = errorText(error);
            this.log(`Could not run the cell on ${uri}: ${message}`);
            await execution.replaceOutput(toCellOutput({
                items: [{ mime: STDERR_MIME, text: `${message}\n` }],
            }));
            execution.end(false, Date.now());
        }
    }

    /**
     * Runs a TypeScript cell in its notebook's worker, showing what it
     * prints as it prints it: text as a stream, one output for as long as
     * the stream goes on, and a value JSON can hold as JSON.
     *
     * @param execution The cell's execution.
     * @param notebook The notebook it is in.
     * @param code The cell's TypeScript.
     *
     * @returns Once it is over.
     */
    async #runTypeScript(
        execution: vscode.NotebookCellExecution,
        notebook: vscode.NotebookDocument,
        code: string,
    ): Promise<void> {
        // Printed in order: each append waits for the one before.
        let shown = Promise.resolve();
        let stream: {
            mime: string;
            output: vscode.NotebookCellOutput;
        } | undefined;

        const show = async (value: PrintedValue): Promise<void> => {
            if (value.kind === "json") {
                stream = undefined;
                await execution.appendOutput(new vscode.NotebookCellOutput([
                    new vscode.NotebookCellOutputItem(
                        encoder.encode(value.json), "application/json"),
                    new vscode.NotebookCellOutputItem(
                        encoder.encode(value.json), "text/plain"),
                ]));

                return;
            }

            const mime = value.stream === "stderr" ? STDERR_MIME : STDOUT_MIME;
            const item = new vscode.NotebookCellOutputItem(
                encoder.encode(`${value.text}\n`), mime);
            if (stream?.mime === mime) {
                await execution.appendOutputItems(item, stream.output);
            } else {
                const output = new vscode.NotebookCellOutput([item]);
                stream = { mime, output };
                await execution.appendOutput(output);
            }
        };

        // Asked for only once a cell runs SQL: one that does not needs none.
        let uri: string | undefined;
        const outcome = await this.scripts.run(notebook.uri.toString(), code, {
            print: (value) => {
                shown = shown.then(() => { return show(value); });
            },
            runSql: async (sql) => {
                uri ??= this.editors.notebookConnectionFor(notebook)
                    ?? await this.editors.selectNotebookConnection(notebook);
                if (uri === undefined) {
                    throw new Error(NO_CONNECTION);
                }

                return this.editors.queryRows(uri, sql);
            },
        });
        await shown;

        if (outcome.interrupted === true) {
            await show({
                kind: "text",
                stream: "stderr",
                text: "Interrupted. The notebook's TypeScript starts afresh: "
                    + "what its cells declared is gone.",
            });
        } else if (outcome.error !== undefined) {
            await show({ kind: "text", stream: "stderr", text: outcome.error });
        }
        execution.end(outcome.error === undefined
            && outcome.interrupted !== true, Date.now());
    }

    /**
     * Drops the controller, and every notebook's worker.
     *
     * @returns Nothing.
     */
    public dispose(): void {
        this.#closing.dispose();
        this.scripts.dispose();
        this.#controller.dispose();
    }
}
