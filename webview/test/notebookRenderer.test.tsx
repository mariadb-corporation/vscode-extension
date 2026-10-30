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

import { describe, expect, it } from "vitest";

import "./setup.js";
import {
    activate,
    gridHeight,
    notebookStatusOf,
} from "../src/notebookRenderer.js";
import type { IResultSet } from "../../src/webview/protocol.js";

/**
 * @param overrides What differs from a small, editable result.
 *
 * @returns A result set.
 */
const resultSet = (overrides: Partial<IResultSet> = {}): IResultSet => {
    return {
        id: "run1-result-0",
        caption: "Result #1",
        statement: "SELECT id FROM t",
        columns: [{ name: "id", isPrimary: true }],
        rows: [{ id: 1 }, { id: 2 }],
        editable: true,
        status: "2 rows in set",
        ...overrides,
    };
};

describe("the notebook renderer", () => {
    it("grows a grid with its rows, up to a limit", () => {
        expect(gridHeight(0)).toBe(72);
        expect(gridHeight(2)).toBe(42 + 2 * 24 + 2);
        expect(gridHeight(1000)).toBe(360);
    });

    it("says where only the first page of rows is shown", () => {
        expect(notebookStatusOf(resultSet())).toBe("2 rows in set");
        expect(notebookStatusOf(resultSet({
            status: "200 rows in set (page 1)",
            page: { index: 0, size: 200, hasMore: true, loads: 1 },
        }))).toBe("200 rows in set (page 1) · the first 200 rows");
    });

    it("draws an output into its element, and takes it away again", () => {
        const renderer = activate();
        activate();
        // The stylesheet goes in once, however often it is activated.
        expect(document.head.querySelectorAll("link[rel=stylesheet]"))
            .toHaveLength(1);

        const element = document.createElement("div");
        renderer.renderOutputItem({
            id: "output-1",
            mime: "application/vnd.mariadb.resultset+json",
            json: () => { return resultSet(); },
        }, element);

        expect(element.querySelector(".notebookResultStatus")?.textContent)
            .toBe("2 rows in set");
        expect(element.querySelector<HTMLElement>(".notebookResultGrid")
            ?.style.height).toBe(`${gridHeight(2)}px`);
        expect(element.querySelector(".resultGridHost")).not.toBeNull();

        renderer.disposeOutputItem("output-1");
        expect(element.innerHTML).toBe("");
    });
});
