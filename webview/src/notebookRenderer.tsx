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
 * The notebook renderer for a result set: the panel's result grid, read
 * only, under the cell that produced it.
 *
 * VS Code loads this module into the notebook's output webview and calls
 * `activate`; each output of the result set type is then handed to
 * `renderOutputItem` with an element of its own to draw into. There is no
 * page of ours around it, so the stylesheet is added to the webview's head
 * from beside this module, once.
 */

import { render, type JSX } from "preact";
import { useMemo } from "preact/hooks";

import { initialRows } from "../../src/webview/changes.js";
import type { IResultSet } from "../../src/webview/protocol.js";
import { ResultGrid } from "./ResultGrid.js";
import "./notebookRenderer.css";

/** An output item, as far as this renderer reads one. */
export interface IOutputItem {
    readonly id: string;
    readonly mime: string;
    json(): unknown;
}

/** What `activate` returns to VS Code. */
export interface IRenderer {
    renderOutputItem(item: IOutputItem, element: HTMLElement): void;
    disposeOutputItem(id?: string): void;
}

/** The stylesheet the build writes beside this module. */
const STYLESHEET = "notebookRenderer.css";

/** The header's height, with a column's type under its name. */
const HEADER_HEIGHT = 42;
/** One row's height. */
const ROW_HEIGHT = 24;
/** The most an output grows to before its rows scroll. */
const MAX_GRID_HEIGHT = 360;
/** The least, which leaves room for Tabulator's "no rows" placeholder. */
const MIN_GRID_HEIGHT = 72;

/**
 * How tall a grid of so many rows is drawn: all of them while they fit,
 * scrolling past `MAX_GRID_HEIGHT`.
 *
 * @param rowCount How many rows it has.
 *
 * @returns The height in pixels.
 */
export const gridHeight = (rowCount: number): number => {
    return Math.min(MAX_GRID_HEIGHT,
        Math.max(MIN_GRID_HEIGHT, HEADER_HEIGHT + rowCount * ROW_HEIGHT + 2));
};

/**
 * What the line under a grid says: its rows, and that only the first page
 * of them is here where the server holds more.
 *
 * @param resultSet The result set.
 *
 * @returns The line.
 */
export const notebookStatusOf = (resultSet: IResultSet): string => {
    return resultSet.page?.hasMore === true
        ? `${resultSet.status} · the first ${resultSet.page.size} rows`
        : resultSet.status;
};

/** Edits are not taken in a notebook; the grid is read only. */
const ignore = (): void => { /* read only */ };

/**
 * One result set under its cell.
 *
 * @param props The result set.
 * @param props.resultSet The result set.
 *
 * @returns The grid, and the line saying what is in it.
 */
export const NotebookResult = (
    { resultSet }: { resultSet: IResultSet },
): JSX.Element => {
    const shown = useMemo((): IResultSet => {
        return { ...resultSet, editable: false };
    }, [resultSet]);
    const rows = useMemo(() => {
        return initialRows(shown);
    }, [shown]);

    return (
        <div class="notebookResult">
            <div
                class="notebookResultGrid"
                style={{ height: `${gridHeight(rows.length)}px` }}
            >
                <ResultGrid
                    resultSet={shown}
                    rows={rows}
                    onCellEdited={ignore}
                    onToggleDeleted={ignore}
                />
            </div>
            <div class="notebookResultStatus">{notebookStatusOf(resultSet)}</div>
        </div>
    );
};

/**
 * Adds the stylesheet to the output webview, once.
 *
 * @param base Where this module was loaded from.
 *
 * @returns Nothing.
 */
const addStylesheet = (base: string): void => {
    const href = new URL(STYLESHEET, base).href;
    const present = [...document.head.querySelectorAll("link")]
        .some((link) => {
            return link.href === href;
        });
    if (present) {
        return;
    }

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.append(link);
};

/**
 * Called by VS Code when the first output of a result set is shown.
 *
 * @returns The renderer.
 */
export const activate = (): IRenderer => {
    addStylesheet(import.meta.url);
    const drawn = new Map<string, HTMLElement>();

    return {
        renderOutputItem: (item, element) => {
            drawn.set(item.id, element);
            render(<NotebookResult resultSet={item.json() as IResultSet} />,
                element);
        },
        disposeOutputItem: (id) => {
            const ids = id === undefined ? [...drawn.keys()] : [id];
            for (const each of ids) {
                const element = drawn.get(each);
                if (element !== undefined) {
                    render(null, element);
                    drawn.delete(each);
                }
            }
        },
    };
};
