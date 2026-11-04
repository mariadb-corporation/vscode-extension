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

/** The id the MSM Projects view is contributed under. */
export const MSM_PROJECTS_VIEW_ID = "mariadb.msmProjects";

/**
 * A row of the MSM Projects view: a MariaDB Schema Management project the
 * user added to it.
 */
export interface IMsmProjectNode {
    /** The project folder, which names the row. */
    folder: vscode.Uri;
}

/**
 * Feeds the MSM Projects view: the schema projects the user added to it.
 * Nothing adds one yet, so the view stays on its welcome content; the
 * list and the commands that manage it are to come.
 */
export class MsmProjectsTreeProvider
    implements vscode.TreeDataProvider<IMsmProjectNode>, vscode.Disposable {

    readonly #onDidChangeTreeData =
        new vscode.EventEmitter<IMsmProjectNode | undefined>();
    public readonly onDidChangeTreeData = this.#onDidChangeTreeData.event;

    public getTreeItem(node: IMsmProjectNode): vscode.TreeItem {
        return new vscode.TreeItem(node.folder,
            vscode.TreeItemCollapsibleState.None);
    }

    /**
     * @returns The projects: none, until they can be added.
     */
    public getChildren(): IMsmProjectNode[] {
        return [];
    }

    /**
     * Has the view draw its rows again.
     *
     * @returns Nothing.
     */
    public refresh(): void {
        this.#onDidChangeTreeData.fire(undefined);
    }

    public dispose(): void {
        this.#onDidChangeTreeData.dispose();
    }
}
