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

import * as vscode from "vscode";

import { stopOnError } from "../connections/settings.js";
import type { SqlEditorBinding } from "../editor/sqlEditorBinding.js";
import { MARIADB_SQL_LANGUAGE_ID } from "../editor/sqlLanguage.js";
import {
    NOTEBOOK_TYPE,
    outputsOf,
    STDERR_MIME,
    succeeded,
} from "./notebookFormat.js";
import { toCellOutput } from "./notebookSerializer.js";
import { errorText } from "../text.js";

/** The controller's id: the one kernel a MariaDB Notebook has. */
export const NOTEBOOK_CONTROLLER_ID = "mariadb-notebook-kernel";

/**
 * Runs the cells of a MariaDB Notebook on the notebook's connection, one
 * after the other, and puts what each produced under it: result sets as
 * grids, what the other statements said as text, errors in red.
 *
 * A cell runs as a script, the way a SQL file does: every statement in it,
 * stopping at the first that fails where stop-on-error is set. Nothing of
 * it goes to the MariaDB panel.
 */
export class NotebookController implements vscode.Disposable {
    readonly #controller: vscode.NotebookController;
    /** Counts the runs, so each cell's run has an order number. */
    #executionOrder = 0;

    /**
     * @param editors Which connection a notebook runs on, and running a
     *                script on it.
     * @param log Where failures are noted.
     */
    public constructor(
        private readonly editors: SqlEditorBinding,
        private readonly log: (message: string) => void,
    ) {
        this.#controller = vscode.notebooks.createNotebookController(
            NOTEBOOK_CONTROLLER_ID, NOTEBOOK_TYPE, "MariaDB");
        this.#controller.supportedLanguages = [MARIADB_SQL_LANGUAGE_ID];
        this.#controller.supportsExecutionOrder = true;
        this.#controller.description = "Runs SQL on the notebook's connection";
        this.#controller.executeHandler = async (cells, notebook) => {
            for (const cell of cells) {
                await this.#run(cell, notebook);
            }
        };
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

        const script = cell.document.getText();
        if (script.trim().length === 0) {
            execution.end(true, Date.now());

            return;
        }

        const uri = this.editors.notebookConnectionFor(notebook)
            ?? await this.editors.selectNotebookConnection(notebook);
        if (uri === undefined) {
            await execution.replaceOutput(toCellOutput({
                items: [{
                    mime: STDERR_MIME,
                    text: "No connection: pick one for the notebook with "
                        + "Select Connection in its toolbar.\n",
                }],
            }));
            execution.end(false, Date.now());

            return;
        }

        try {
            const { report } = await this.editors.executeScript(uri, script, {
                runId: this.editors.nextRunId(),
                stopOnError: stopOnError(),
                source: {
                    uri: cell.document.uri.toString(),
                    positionAt: (offset) => {
                        const position = cell.document.positionAt(offset);

                        return {
                            line: position.line,
                            character: position.character,
                        };
                    },
                },
            });
            await execution.replaceOutput(
                outputsOf(report).map(toCellOutput));
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
     * Drops the controller.
     *
     * @returns Nothing.
     */
    public dispose(): void {
        this.#controller.dispose();
    }
}
