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

import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it } from "vitest";

import { posted } from "./setup.js";
import {
    activate,
    type IRendererContext,
    seedState,
    viewHeight,
    VIEW_CLASS,
} from "../src/notebookRenderer.js";
import type {
    INotebookResultPayload,
} from "../../src/notebook/notebookProtocol.js";
import type { IResultSet } from "../../src/webview/protocol.js";

/**
 * @param id The result set's id.
 * @param rows How many rows it has.
 *
 * @returns An editable result set.
 */
const resultSet = (id: string, rows = 2): IResultSet => {
    return {
        id,
        caption: `Result ${id}`,
        statement: "SELECT id FROM t",
        columns: [{ name: "id", isPrimary: true }],
        rows: Array.from({ length: rows }, (_, index) => {
            return { id: index + 1 };
        }),
        editable: true,
        status: `${rows} rows in set`,
    };
};

/**
 * @param viewId The view's id.
 *
 * @returns An output of two result sets.
 */
const payload = (viewId = "view-1"): INotebookResultPayload => {
    return {
        viewId,
        connection: "dba@localhost:3310",
        resultSets: [resultSet("r1"), resultSet("r2", 5)],
    };
};

/**
 * A renderer context recording what the views sent, with a way to
 * answer them as the extension would.
 *
 * @returns The context, what it was sent, and the answer.
 */
const createContext = () => {
    const sent: unknown[] = [];
    let listener: ((message: unknown) => void) | undefined;
    const context: IRendererContext = {
        postMessage: (message) => { sent.push(message); },
        onDidReceiveMessage: (received) => {
            listener = received;

            return { dispose: () => { listener = undefined; } };
        },
    };
    const answer = async (message: unknown): Promise<void> => {
        await act(async () => {
            listener?.(message);
            await Promise.resolve();
        });
    };

    return { context, sent, answer };
};

/**
 * @param renderer The renderer.
 * @param output What the output holds.
 * @param id The output's id.
 *
 * @returns The element it was drawn in, its effects run.
 */
const draw = async (
    renderer: ReturnType<typeof activate>,
    output: INotebookResultPayload,
    id = "output-1",
): Promise<HTMLElement> => {
    const element = document.createElement("div");
    document.body.append(element);
    await act(async () => {
        renderer.renderOutputItem({
            id,
            mime: "application/vnd.mariadb.resultset+json",
            json: () => { return output; },
        }, element);
        await Promise.resolve();
    });

    return element;
};

/**
 * @param element Where a view was drawn.
 *
 * @returns Its tabs' captions.
 */
const tabsOf = (element: HTMLElement): string[] => {
    return [...element.querySelectorAll(".tab")].map((tab) => {
        return tab.textContent ?? "";
    });
};

beforeEach(() => {
    posted.length = 0;
    document.body.innerHTML = "";
});

describe("the notebook renderer", () => {
    it("starts a view as tall as its longest result set, within bounds",
        () => {
            expect(viewHeight([resultSet("a", 0)])).toBe(42 + 24 + 64);
            expect(viewHeight([resultSet("a", 2), resultSet("b", 4)]))
                .toBe(42 + 4 * 24 + 64);
            expect(viewHeight([resultSet("a", 1000)])).toBe(240);
        });

    it("makes nothing editable where it cannot reach the extension", () => {
        expect(seedState(payload(), true).resultSets[0].editable).toBe(true);
        const offline = seedState(payload(), false);
        expect(offline.notebook).toBe(true);
        expect(offline.resultSets.map((set) => {
            return set.editable;
        })).toEqual([false, false]);
    });

    it("draws the panel's view, a tab per result set, from the output",
        async () => {
            const { context, sent } = createContext();
            const renderer = activate(context);
            activate(context);
            // The stylesheet goes in once, however often it is activated.
            expect(document.head.querySelectorAll("link[rel=stylesheet]"))
                .toHaveLength(1);

            const element = await draw(renderer, payload());

            const view = element.querySelector<HTMLElement>(`.${VIEW_CLASS}`);
            expect(view?.style.height).toBe(
                `${viewHeight(payload().resultSets)}px`);
            expect(tabsOf(element)).toEqual(["Result r1", "Result r2"]);
            expect(element.querySelector(".statusBar")).not.toBeNull();
            // Its ready went to the extension with what it holds; nothing
            // went through the window.
            expect(sent).toEqual([{
                viewId: "view-1",
                message: { type: "ready" },
                seed: payload(),
            }]);
            expect(posted).toEqual([]);

            renderer.disposeOutputItem("output-1");
            expect(element.innerHTML).toBe("");
        });

    it("tells each view only what is meant for it", async () => {
        const { context, sent, answer } = createContext();
        const renderer = activate(context);
        const first = await draw(renderer, payload("view-1"), "output-1");
        const second = await draw(renderer, payload("view-2"), "output-2");

        await answer({
            viewId: "view-2",
            message: {
                type: "state",
                state: seedState({
                    ...payload("view-2"),
                    resultSets: [resultSet("r9")],
                }, true),
            },
        });

        expect(tabsOf(first)).toEqual(["Result r1", "Result r2"]);
        expect(tabsOf(second)).toEqual(["Result r9"]);

        // And what a view sends says which it is.
        sent.length = 0;
        await act(async () => {
            second.querySelector<HTMLButtonElement>(
                "button[aria-label='Refresh']")!.click();
            await Promise.resolve();
        });
        expect(sent).toEqual([{
            viewId: "view-2",
            message: { type: "refresh", resultId: "r9" },
        }]);
    });
});
