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

import { beforeEach, describe, expect, it } from "vitest";

import { ParseProgressStatus } from "../../lsp/parseProgress.js";
import {
    fireActiveEditorChange,
    MockTextDocument,
    resetVscodeMock,
    statusBarItems,
    Uri,
} from "../mocks/vscode.js";

const A = "file:///work/a.sql";
const B = "file:///work/b.sql";

const progress = (uri: string, checked: number, total: number,
    done = false) => {
    return { uri, version: 1, checked, total, done };
};

const editorOn = (uri: string): unknown => {
    return { document: new MockTextDocument(Uri.parse(uri), "mariadb-sql", "") };
};

describe("ParseProgressStatus", () => {
    beforeEach(() => {
        resetVscodeMock();
    });

    it("shows a check under way and hides once it is done", () => {
        const status = new ParseProgressStatus();
        expect(statusBarItems).toHaveLength(0);

        status.update(progress(A, 250, 1000));
        const item = statusBarItems[0];
        expect(item.visible).toBe(true);
        expect(item.text).toBe("$(sync~spin) Checking SQL 25%");
        expect(item.tooltip).toContain("250 of 1,000 statements of a.sql");

        status.update(progress(A, 1000, 1000, true));
        expect(item.visible).toBe(false);
        status.dispose();
        expect(item.disposed).toBe(true);
    });

    it("prefers the active editor's file and counts the others", () => {
        const status = new ParseProgressStatus();
        status.update(progress(A, 1, 10));
        const item = statusBarItems[0];
        status.update(progress(B, 0, 0));
        expect(item.text).toBe("$(sync~spin) Checking SQL 10% (+1)");
        expect(item.tooltip).toContain("checking 1 more file.");

        fireActiveEditorChange(editorOn(B));
        expect(item.text).toBe("$(sync~spin) Checking SQL 100% (+1)");

        status.forget(B);
        expect(item.text).toBe("$(sync~spin) Checking SQL 10%");
        status.clear();
        expect(item.visible).toBe(false);
    });
});
