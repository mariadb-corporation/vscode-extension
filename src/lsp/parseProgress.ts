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
 * The status bar entry that shows how far the server has got checking a
 * large SQL file, from its `mariadb/parseProgress` notifications.
 */

import * as vscode from "vscode";

/** The server's notification of how far a check has got. */
export const PARSE_PROGRESS_NOTIFICATION = "mariadb/parseProgress";

/** What `mariadb/parseProgress` carries. */
export interface IParseProgress {
    /** The document. */
    uri: string;
    /** The version of it being checked. */
    version: number;
    /** The statements checked so far. */
    checked: number;
    /** All of its statements. */
    total: number;
    /** Whether the check is over. */
    done: boolean;
}

/**
 * Says how far the check of the active editor's file has got, or of
 * another file when the active one is not being checked.
 */
export class ParseProgressStatus implements vscode.Disposable {
    /** Document URI -> its check under way. */
    readonly #checks = new Map<string, IParseProgress>();
    /** Made for the first check reported: most windows never see one. */
    #item?: vscode.StatusBarItem;
    readonly #disposables: vscode.Disposable[] = [];

    public constructor() {
        this.#disposables.push(
            vscode.window.onDidChangeActiveTextEditor(() => {
                this.#show();
            }),
        );
    }

    /**
     * Takes a notification.
     *
     * @param progress What the server sent.
     *
     * @returns Nothing.
     */
    public update(progress: IParseProgress): void {
        if (progress.done) {
            this.#checks.delete(progress.uri);
        } else {
            this.#checks.set(progress.uri, progress);
        }
        this.#show();
    }

    /**
     * Drops a document's check: it was closed.
     *
     * @param uri The document.
     *
     * @returns Nothing.
     */
    public forget(uri: string): void {
        if (this.#checks.delete(uri)) {
            this.#show();
        }
    }

    /**
     * Drops every check: the server stopped.
     *
     * @returns Nothing.
     */
    public clear(): void {
        this.#checks.clear();
        this.#show();
    }

    public dispose(): void {
        for (const disposable of this.#disposables) {
            disposable.dispose();
        }
        this.#item?.dispose();
        this.#item = undefined;
    }

    /** Shows the check that matters most, or hides the entry. */
    #show(): void {
        const active = vscode.window.activeTextEditor?.document.uri.toString();
        const check = (active === undefined
            ? undefined
            : this.#checks.get(active))
            ?? this.#checks.values().next().value;
        if (check === undefined) {
            this.#item?.hide();

            return;
        }
        if (this.#item === undefined) {
            this.#item = vscode.window.createStatusBarItem(
                vscode.StatusBarAlignment.Left, 0);
            this.#item.name = "MariaDB SQL check";
        }
        const percent = check.total === 0
            ? 100
            : Math.floor(check.checked * 100 / check.total);
        const others = this.#checks.size - 1;
        const item = this.#item;
        item.text = `$(sync~spin) Checking SQL ${String(percent)}%`
            + (others > 0 ? ` (+${String(others)})` : "");
        const name = vscode.Uri.parse(check.uri).path.split("/").pop() ?? "";
        item.tooltip = `The MariaDB SQL language server has checked `
            + `${check.checked.toLocaleString()} of `
            + `${check.total.toLocaleString()} statements of ${name}`
            + (others > 0
                ? `, and is checking ${String(others)} more `
                + (others === 1 ? "file" : "files")
                : "")
            + ".";
        item.show();
    }
}
