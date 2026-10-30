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
 * What a notebook cell's result output holds, and what its renderer and
 * the extension say to each other about it. Shared with the renderer, so
 * free of `vscode`.
 */

import type {
    HostMessage,
    IResultSet,
    IViewState,
    WebviewMessage,
} from "../webview/protocol.js";

/** The renderer's id, as `contributes.notebookRenderer` declares it. */
export const NOTEBOOK_RENDERER_ID = "mariadb.resultSetRenderer";

/** The output type of a graph a TypeScript cell drew: `IGraphOptions`. */
export const GRAPH_MIME = "application/vnd.mariadb.graph+json";

/**
 * The output a cell's result sets are: one, with a tab each, drawn by the
 * result view. Saved with the notebook.
 */
export interface INotebookResultPayload {
    /**
     * Tells this output's view from every other's: the renderer's
     * messaging reaches every output of the notebook, so each message
     * says which one it is for. Made up at random, because a reopened
     * notebook's outputs carry the ids of a session long gone.
     */
    viewId: string;
    /** The connection the cell ran on. */
    connection: string;
    resultSets: IResultSet[];
}

/**
 * The state a cell's view shows: its result sets as tabs, and nothing of
 * the panel's pickers or actions. The extension sends it, and the renderer
 * starts a view from it before the extension answers.
 *
 * @param connection The connection the cell ran on.
 * @param resultSets The cell's result sets.
 * @param settings The grid settings, where the extension knows them.
 *
 * @returns The state.
 */
export const notebookViewState = (
    connection: string,
    resultSets: IResultSet[],
    settings: Pick<IViewState, "freezeKeyColumns" | "showColumnTypes"> = {},
): IViewState => {
    return {
        connections: [],
        connection,
        sessions: [],
        actions: [],
        resultSets,
        notebook: true,
        ...settings,
    };
};

/** A message from an output's view to the extension. */
export interface IRendererMessage {
    viewId: string;
    message: WebviewMessage;
    /**
     * Sent with `ready`: what the output holds, so a view the extension
     * does not know - a reopened notebook's - can be taken up.
     */
    seed?: INotebookResultPayload;
}

/** A message from the extension to an output's view. */
export interface IHostRendererMessage {
    viewId: string;
    message: HostMessage;
}
