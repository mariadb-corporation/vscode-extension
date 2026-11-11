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
 * The editors open on an MSM project's files, closed while msm renames
 * and moves them, then opened again: left open, they would show the old
 * files as deleted.
 */

import { existsSync } from "node:fs";
import { sep } from "node:path";

import * as vscode from "vscode";

import type { IEditorPlace } from "./schemaRename.js";

/**
 * @param tab A tab.
 *
 * @returns The file it shows: a text editor's or a notebook's; nothing
 *          for a webview, a diff or anything else.
 */
const fileOf = (tab: vscode.Tab): vscode.Uri | undefined => {
    const input = tab.input;
    if (input instanceof vscode.TabInputText
        || input instanceof vscode.TabInputNotebook) {
        return input.uri.scheme === "file" ? input.uri : undefined;
    }

    return undefined;
};

/**
 * Saves and closes the editors open on files in a folder.
 *
 * @param folder The folder.
 *
 * @returns Where they were, in the order of their groups and tabs.
 * @throws Where a changed file cannot be saved: nothing is closed then.
 */
export const closeEditorsIn = async (
    folder: string,
): Promise<IEditorPlace[]> => {
    const inside = (uri: vscode.Uri): boolean => {
        return uri.fsPath.startsWith(folder + sep);
    };
    const tabs = vscode.window.tabGroups.all.flatMap((group) => {
        return group.tabs.filter((tab) => {
            const uri = fileOf(tab);

            return uri !== undefined && inside(uri);
        });
    });
    if (tabs.length === 0) {
        return [];
    }
    // Saved first, all of them: one that will not save stops the rename
    // before anything is closed.
    for (const document of [...vscode.workspace.textDocuments,
        ...vscode.workspace.notebookDocuments]) {
        if (document.isDirty && inside(document.uri)
            && !await document.save()) {
            throw new Error(`${document.uri.fsPath} could not be saved.`);
        }
    }
    const places = tabs.map((tab): IEditorPlace => {
        return { path: fileOf(tab)!.fsPath, column: tab.group.viewColumn };
    });
    await vscode.window.tabGroups.close(tabs);

    return places;
};

/**
 * Opens editors again, each in its group; a file no longer there, or one
 * that will not open, is left out: the rename is done, or its failure is
 * what to report.
 *
 * @param places Where they were.
 */
export const openEditorsAt = async (places: IEditorPlace[]): Promise<void> => {
    for (const { path, column } of places) {
        if (existsSync(path)) {
            await vscode.commands.executeCommand("vscode.open",
                vscode.Uri.file(path), { viewColumn: column,
                    preview: false, preserveFocus: true })
                .then(undefined, () => { /* left closed */ });
        }
    }
};
