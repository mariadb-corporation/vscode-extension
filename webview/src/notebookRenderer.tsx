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
 * The notebook renderer for a cell's result sets: the MariaDB panel's
 * result view - a tab per result set, its toolbar, paging, editing, the
 * SQL preview - under the cell that produced them.
 *
 * VS Code loads this module into the notebook's output webview and calls
 * `activate`; each output of the result type is then handed to
 * `renderOutputItem` with an element of its own to draw into. The view
 * talks to the extension through the renderer's messaging, each message
 * carrying the output's view id, since every output of the notebook hears
 * every message. There is no page of ours around it, so the stylesheet is
 * linked into the webview's head from beside this module, once.
 */

import { render } from "preact";

import type {
    IHostRendererMessage,
    INotebookResultPayload,
    IRendererMessage,
} from "../../src/notebook/notebookProtocol.js";
import type {
    HostMessage,
    IResultSet,
    IViewState,
} from "../../src/webview/protocol.js";
import { App } from "./App.js";
import type { IHostTransport } from "./transport.js";
import "./notebookRenderer.css";

/** An output item, as far as this renderer reads one. */
export interface IOutputItem {
    readonly id: string;
    readonly mime: string;
    json(): unknown;
}

/** The part of VS Code's renderer context this renderer uses. */
export interface IRendererContext {
    /** Missing where the notebook gives the renderer no messaging. */
    postMessage?(message: unknown): void;
    onDidReceiveMessage?(
        listener: (message: unknown) => void,
    ): { dispose(): void };
}

/** What `activate` returns to VS Code. */
export interface IRenderer {
    renderOutputItem(item: IOutputItem, element: HTMLElement): void;
    disposeOutputItem(id?: string): void;
}

/** The stylesheet the build writes beside this module. */
const STYLESHEET = "notebookRenderer.css";

/** The class the result view's stylesheet is scoped to here. */
export const VIEW_CLASS = "mariadbResultView";

/** The header's height, with a column's type under its name. */
const HEADER_HEIGHT = 42;
/** One row's height. */
const ROW_HEIGHT = 24;
/** The result set's own bar and the row of tabs under it. */
const BARS_HEIGHT = 64;
/** The most an output starts out as; it can be dragged taller. */
const MAX_HEIGHT = 240;
/** The least: the header, one row, the toolbar and the tabs. */
const MIN_HEIGHT = HEADER_HEIGHT + ROW_HEIGHT + BARS_HEIGHT;

/**
 * How tall a cell's view starts out: its longest result set whole while
 * that fits, so switching tabs does not make the cell jump.
 *
 * @param resultSets The result sets.
 *
 * @returns The height in pixels.
 */
export const viewHeight = (resultSets: IResultSet[]): number => {
    const rows = Math.max(0, ...resultSets.map((set) => {
        return set.rows.length;
    }));

    return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT,
        HEADER_HEIGHT + rows * ROW_HEIGHT + BARS_HEIGHT));
};

/** Why a result set cannot be edited where nothing can reach the extension. */
const NO_MESSAGING = "Read only: this notebook cannot reach the extension.";

/**
 * The state a cell's view starts from: what its output holds. The
 * extension answers the view's `ready` with the same, or with what it has
 * moved on to - another page, say.
 *
 * @param payload The output.
 * @param connected Whether the view can reach the extension; where not,
 *                  nothing in it can be edited.
 *
 * @returns The state.
 */
export const seedState = (
    payload: INotebookResultPayload,
    connected: boolean,
): IViewState => {
    return {
        connections: [],
        connection: payload.connection,
        sessions: [],
        actions: [],
        resultSets: connected
            ? payload.resultSets
            : payload.resultSets.map((set) => {
                return { ...set, editable: false, readOnlyReason: NO_MESSAGING };
            }),
        notebook: true,
    };
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
 * Called by VS Code when the first output of a result type is shown.
 *
 * @param context The renderer's context, with its messaging.
 *
 * @returns The renderer.
 */
export const activate = (context: IRendererContext = {}): IRenderer => {
    addStylesheet(import.meta.url);
    const drawn = new Map<string, HTMLElement>();
    /** Each view's listeners, by its id. */
    const listeners = new Map<string, Set<(message: HostMessage) => void>>();
    const connected = context.postMessage !== undefined;

    context.onDidReceiveMessage?.((received) => {
        const { viewId, message } = received as IHostRendererMessage;
        for (const listener of listeners.get(viewId) ?? []) {
            listener(message);
        }
    });

    /**
     * @param payload An output's result sets.
     *
     * @returns How its view talks to the extension.
     */
    const transportFor = (payload: INotebookResultPayload): IHostTransport => {
        const { viewId } = payload;
        const tell = (message: HostMessage): void => {
            for (const listener of listeners.get(viewId) ?? []) {
                listener(message);
            }
        };

        return {
            post: (message) => {
                const sent: IRendererMessage = { viewId, message };
                if (message.type === "ready") {
                    // Shown from the output at once, whether or not the
                    // extension answers; sent along, so a view it does not
                    // know - a reopened notebook's - can be taken up.
                    tell({ type: "state", state: seedState(payload, connected) });
                    sent.seed = payload;
                }
                context.postMessage?.(sent);
            },
            listen: (listener) => {
                let own = listeners.get(viewId);
                if (own === undefined) {
                    own = new Set();
                    listeners.set(viewId, own);
                }
                own.add(listener);

                return () => {
                    own.delete(listener);
                };
            },
        };
    };

    return {
        renderOutputItem: (item, element) => {
            const payload = item.json() as INotebookResultPayload;
            drawn.set(item.id, element);
            render(
                <div
                    class={VIEW_CLASS}
                    style={{ height: `${viewHeight(payload.resultSets)}px` }}
                >
                    <App transport={transportFor(payload)} />
                </div>,
                element,
            );
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
