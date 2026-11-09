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

import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { posted } from "./setup.js";
import { TableEditor } from "../src/tableEditor/TableEditor.js";
import type {
    ITableEditorData,
    TableEditorHostMessage,
} from "../../src/tableEditor/tableEditorProtocol.js";

// Tabulator never finishes building under jsdom (it measures the DOM), so
// the grids' cells are not tested here; the page around them is.

let host: HTMLDivElement;

const DATA: ITableEditorData = {
    live: true,
    table: {
        name: "actor",
        columns: [{ name: "actor_id", type: "smallint(5) unsigned",
            nullable: false, auto_increment: true }],
        indexes: [{ name: null, kind: "primary", columns: ["actor_id"] }],
    },
    triggers: [],
    ddl: "CREATE TABLE `actor` (...)",
    tables: { actor: ["actor_id"] },
    collations: [{ charset: "utf8mb4", collation: "utf8mb4_bin" }],
};

const send = async (message: TableEditorHostMessage): Promise<void> => {
    await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data: message }));
        await Promise.resolve();
    });
};

const button = (text: string): HTMLButtonElement => {
    const found = [...host.querySelectorAll("button")].find((candidate) => {
        return candidate.textContent?.includes(text) === true;
    });
    if (found === undefined) {
        throw new Error(`No button ${text}`);
    }

    return found;
};

describe("TableEditor", () => {
    beforeEach(async () => {
        host = document.createElement("div");
        document.body.append(host);
        posted.length = 0;
        await act(async () => {
            render(<TableEditor />, host);
            await Promise.resolve();
        });
    });

    afterEach(() => {
        render(null, host);
        host.remove();
        vi.useRealTimers();
    });

    it("asks for the table, then shows its name and DDL", async () => {
        expect(posted).toContainEqual({ type: "ready" });
        await send({ type: "load", data: DATA });
        expect(host.querySelector<HTMLInputElement>("#table-name")?.value)
            .toBe("actor");
        await act(async () => { button("DDL").click(); });
        expect(host.querySelector(".ddl")?.textContent).toBe(DATA.ddl);
        expect(button("Apply Changes").disabled).toBe(true);
    });

    it("previews a changed comment, and applies its edits", async () => {
        await send({ type: "load", data: DATA });
        vi.useFakeTimers();
        const comment = host.querySelector<HTMLInputElement>("#table-comment")!;
        await act(async () => {
            comment.value = "Actors";
            comment.dispatchEvent(new Event("change"));
        });
        await act(async () => { vi.advanceTimersByTime(300); });
        const edits = [{ op: "set_table_options", table: "actor",
            options: { comment: "Actors" } }];
        const asked = posted.find((message) => {
            return (message as { type: string }).type === "preview";
        }) as { request: number } | undefined;
        expect(asked).toMatchObject({ type: "preview", edits });
        await send({ type: "preview", request: asked!.request,
            statements: ["ALTER TABLE `actor` COMMENT='Actors'"], notes: [] });
        expect(host.querySelector(".sql")?.textContent).toBe(
            "ALTER TABLE `actor` COMMENT='Actors';");
        await act(async () => { button("Apply Changes").click(); });
        expect(posted).toContainEqual({ type: "apply", edits });
    });

    it("asks before a refresh throws changes away", async () => {
        await send({ type: "load", data: DATA });
        const name = host.querySelector<HTMLInputElement>("#table-name")!;
        await act(async () => {
            name.value = "actors";
            name.dispatchEvent(new Event("change"));
        });
        const refresh = host.querySelector<HTMLButtonElement>(
            "[title='Refresh Structure']")!;
        // Left of the menu, an icon alone until it asks.
        expect(refresh.nextElementSibling?.getAttribute("aria-label"))
            .toBe("More Actions");
        expect(refresh.textContent).toBe("");
        await act(async () => { refresh.click(); });
        expect(posted.filter((message) => {
            return (message as { type: string }).type === "refresh";
        })).toHaveLength(0);
        await act(async () => { button("Discard Changes and Refresh?").click(); });
        expect(posted).toContainEqual({ type: "refresh" });
    });

    it("keeps Copy Column Names and the spacing in the menu beside Add Column",
        async () => {
            await send({ type: "load", data: DATA });
            await act(async () => { button("Columns").click(); });
            expect(() => { return button("Copy Column Names"); }).toThrow();
            expect(host.querySelector("select.density")).toBeNull();
            const menu = host.querySelector<HTMLButtonElement>(
                "[aria-label='More Actions']")!;
            expect(menu.previousElementSibling?.previousElementSibling?.textContent)
                .toContain("Add Column");
            await act(async () => { menu.click(); });
            const items = [...document.querySelectorAll<HTMLButtonElement>(
                ".copyMenu .copyMenuItem")];
            expect(items.map((item) => { return item.textContent; })).toEqual(
                ["Copy Column Names", "Compact", "Standard", "Comfortable"]);
            expect(items[1].getAttribute("aria-checked")).toBe("true");
            await act(async () => { items[3].click(); });
            expect(host.querySelector(".table-editor")?.classList
                .contains("density-comfortable")).toBe(true);
        });

    it("says why the table could not be read", async () => {
        await send({ type: "loadFailed", message: "No such table." });
        expect(host.textContent).toContain("No such table.");
    });
});
