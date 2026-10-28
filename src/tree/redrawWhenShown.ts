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

import type * as vscode from "vscode";

/** A tree provider that can be told to redraw. */
export interface IRedrawable {
    onDidChangeTreeData: vscode.Event<unknown>;
    refresh(): void;
}

/**
 * Redraws a view once it is shown again when it was asked to redraw while
 * hidden.
 *
 * The views of the two activity bar containers follow each other: a
 * sandbox deployed from the MariaDB Deployments view changes the
 * Sandboxes and REST Daemons views of the MariaDB Shell container, which
 * are hidden meanwhile. VS Code is meant to keep a hidden view's redraw
 * for when it is shown, but a REST Daemons view was seen still empty
 * after such a deploy until its Refresh was clicked. So the redraw is
 * made again here, once, when the view comes back.
 *
 * @param view The view.
 * @param provider What feeds it.
 *
 * @returns What stops it.
 */
export const redrawWhenShown = (
    view: Pick<vscode.TreeView<unknown>, "visible" | "onDidChangeVisibility">,
    provider: IRedrawable,
): vscode.Disposable => {
    let missed = false;
    const changed = provider.onDidChangeTreeData(() => {
        if (!view.visible) {
            missed = true;
        }
    });
    const shown = view.onDidChangeVisibility(({ visible }) => {
        if (visible && missed) {
            missed = false;
            provider.refresh();
        }
    });

    return {
        dispose: () => {
            changed.dispose();
            shown.dispose();
        },
    };
};
