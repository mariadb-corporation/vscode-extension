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

/**
 * Which connection a MariaDB Notebook runs on: one for the whole
 * notebook, kept in its metadata and so saved with it.
 */

import * as vscode from "vscode";

import { MARIADB_SQL_LANGUAGE_ID } from "../editor/sqlLanguage.js";
import { NOTEBOOK_TYPE } from "./notebookFormat.js";

/** The scheme of a notebook cell's document. */
const CELL_SCHEME = "vscode-notebook-cell";

/**
 * @param notebook A notebook.
 *
 * @returns Whether it is a MariaDB Notebook.
 */
export const isMariaDbNotebook = (
    notebook: vscode.NotebookDocument | undefined,
): notebook is vscode.NotebookDocument => {
    return notebook?.notebookType === NOTEBOOK_TYPE;
};

/**
 * The MariaDB Notebook a document is a cell of.
 *
 * @param document Any document.
 *
 * @returns The notebook, or undefined for anything that is not a cell of
 *          one.
 */
export const notebookOf = (
    document: vscode.TextDocument,
): vscode.NotebookDocument | undefined => {
    if (document.uri.scheme !== CELL_SCHEME) {
        return undefined;
    }

    const key = document.uri.toString();

    return vscode.workspace.notebookDocuments.find((notebook) => {
        return isMariaDbNotebook(notebook)
            && notebook.getCells().some((cell) => {
                return cell.document.uri.toString() === key;
            });
    });
};

/**
 * @param notebook A MariaDB Notebook.
 *
 * @returns The connection its metadata names, if any.
 */
export const notebookConnection = (
    notebook: vscode.NotebookDocument,
): string | undefined => {
    const connection = notebook.metadata.connection as unknown;

    return typeof connection === "string" && connection.length > 0
        ? connection
        : undefined;
};

/**
 * Records the connection a notebook runs on. An edit of the notebook, so
 * it can be undone and is saved with it.
 *
 * @param notebook The notebook.
 * @param uri The connection.
 *
 * @returns Whether the edit was applied.
 */
export const setNotebookConnection = async (
    notebook: vscode.NotebookDocument,
    uri: string,
): Promise<boolean> => {
    const edit = new vscode.WorkspaceEdit();
    edit.set(notebook.uri, [vscode.NotebookEdit.updateNotebookMetadata({
        ...notebook.metadata,
        connection: uri,
    })]);

    return vscode.workspace.applyEdit(edit);
};

/**
 * Opens a new, untitled MariaDB Notebook with one empty SQL cell.
 *
 * @param uri The connection it runs on; left out, it runs on the default
 *            one until another is picked.
 *
 * @returns The notebook.
 */
export const openNewNotebook = async (
    uri?: string,
): Promise<vscode.NotebookDocument> => {
    const data = new vscode.NotebookData([
        new vscode.NotebookCellData(
            vscode.NotebookCellKind.Code, "", MARIADB_SQL_LANGUAGE_ID),
    ]);
    data.metadata = uri === undefined ? {} : { connection: uri };

    const notebook = await vscode.workspace.openNotebookDocument(
        NOTEBOOK_TYPE, data);
    await vscode.window.showNotebookDocument(notebook);

    return notebook;
};
