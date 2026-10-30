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

import { MARIADB_SQL_LANGUAGE_ID } from "../editor/sqlLanguage.js";
import {
    type INotebookCell,
    type INotebookOutput,
    NOTEBOOK_FORMAT_VERSION,
    type NotebookOutputItem,
    parseNotebook,
    serializeNotebook,
} from "./notebookFormat.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * @param output An output as the file holds it.
 *
 * @returns The same output for the notebook API.
 */
export const toCellOutput = (
    output: INotebookOutput,
): vscode.NotebookCellOutput => {
    return new vscode.NotebookCellOutput(output.items.map((item) => {
        const text = "json" in item
            ? JSON.stringify(item.json)
            : item.text;

        return new vscode.NotebookCellOutputItem(
            encoder.encode(text), item.mime);
    }));
};

/**
 * @param output An output of a cell.
 *
 * @returns The same output as the file holds it: JSON as JSON, so a saved
 *          result set reads as one, anything else as text.
 */
const fromCellOutput = (output: vscode.NotebookCellOutput): INotebookOutput => {
    return {
        items: output.items.map((item): NotebookOutputItem => {
            const text = decoder.decode(item.data);
            if (/[/+]json$/.test(item.mime)) {
                try {
                    return { mime: item.mime, json: JSON.parse(text) };
                } catch {
                    // Not JSON after all; kept as the text it is.
                }
            }

            return { mime: item.mime, text };
        }),
    };
};

/**
 * Reads and writes `.mariadb-notebook` files. The connection a notebook
 * runs on is the notebook's metadata, and is saved with it; a cell's
 * outputs are saved too, so a reopened notebook shows its last results.
 */
export class NotebookSerializer implements vscode.NotebookSerializer {
    /**
     * @param content The file's bytes.
     *
     * @returns The notebook.
     */
    public deserializeNotebook(content: Uint8Array): vscode.NotebookData {
        const file = parseNotebook(decoder.decode(content));
        const data = new vscode.NotebookData(file.cells.map((cell) => {
            const markdown = cell.kind === "markdown";
            const cellData = new vscode.NotebookCellData(
                markdown
                    ? vscode.NotebookCellKind.Markup
                    : vscode.NotebookCellKind.Code,
                cell.source,
                markdown
                    ? "markdown"
                    : cell.language ?? MARIADB_SQL_LANGUAGE_ID,
            );
            if (cell.outputs !== undefined) {
                cellData.outputs = cell.outputs.map(toCellOutput);
            }
            if (cell.languagePinned === true) {
                cellData.metadata = { languagePinned: true };
            }

            return cellData;
        }));
        data.metadata = file.connection === undefined
            ? {}
            : { connection: file.connection };

        return data;
    }

    /**
     * @param data The notebook.
     *
     * @returns The file's bytes.
     */
    public serializeNotebook(data: vscode.NotebookData): Uint8Array {
        const connection = data.metadata?.connection as unknown;

        return encoder.encode(serializeNotebook({
            version: NOTEBOOK_FORMAT_VERSION,
            ...typeof connection === "string" ? { connection } : {},
            cells: data.cells.map((cell): INotebookCell => {
                const markdown = cell.kind === vscode.NotebookCellKind.Markup;
                const outputs = (cell.outputs ?? []).map(fromCellOutput);
                const pinned = !markdown
                    && cell.metadata?.languagePinned === true;

                return {
                    kind: markdown ? "markdown" : "code",
                    ...markdown ? {} : { language: cell.languageId },
                    source: cell.value,
                    ...pinned ? { languagePinned: true } : {},
                    ...outputs.length > 0 ? { outputs } : {},
                };
            }),
        }));
    }
}
