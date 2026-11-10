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

    it("sets the table's online ALTER TABLE, saved on its own", async () => {
        await send({ type: "load", data: { ...DATA, onlineAlter: {
            inherited: { enabled: true, maxRebuildBytes: 10 * 1024 ** 3,
                galeraMaxBytes: 256 * 1024 ** 2, nboLock: null,
                maxLockedBytes: null, lockWait: 5, maxRetries: 10 },
            table: { lockWait: 30 },
            keptIn: "workspace",
        } } });
        await act(async () => { button("Online Alter Table").click(); });
        const copy = host.querySelector<HTMLInputElement>(
            "#online-alter-maxRebuildBytes")!;
        // Empty, it shows what it takes.
        expect(copy.placeholder).toBe("10 GiB");
        expect(host.querySelector<HTMLInputElement>(
            "#online-alter-lockWait")?.value).toBe("30");
        expect(host.querySelector<HTMLInputElement>(
            "#online-alter-maxLockedBytes")?.placeholder).toBe("unlimited");

        await act(async () => {
            copy.value = "lots";
            copy.dispatchEvent(new Event("input"));
        });
        expect(host.querySelector(".sql-preview .badge")?.textContent)
            .toBe("Not ready");
        expect(button("Apply Changes").disabled).toBe(true);

        await act(async () => {
            copy.value = "0";
            copy.dispatchEvent(new Event("input"));
        });
        expect(host.querySelector(".sql-preview .badge")?.textContent)
            .toBe("Online ALTER settings");
        await act(async () => { button("Apply Changes").click(); });
        expect(posted).toContainEqual({ type: "apply", edits: [],
            onlineAlter: { maxRebuildBytes: 0, lockWait: 30 } });
    });

    it("previews with the tab's settings, and shows 'default' where msm "
        + "gave none", async () => {
        const inherited = { enabled: true, galeraMaxBytes: 256 * 1024 ** 2,
            nboLock: null, maxLockedBytes: null, lockWait: 5 };
        await send({ type: "load", data: { ...DATA, onlineAlter: {
            // An older msm without maxRebuildBytes and maxRetries.
            inherited: inherited as never, table: {}, keptIn: "workspace",
        } } });
        await act(async () => { button("Online Alter Table").click(); });
        expect(host.querySelector<HTMLInputElement>(
            "#online-alter-maxRebuildBytes")?.placeholder).toBe("default");
        expect(host.querySelector<HTMLInputElement>(
            "#online-alter-maxRetries")?.placeholder).toBe("default");

        vi.useFakeTimers();
        const enabled = host.querySelector<HTMLSelectElement>(
            "#online-alter-enabled")!;
        await act(async () => {
            enabled.value = "off";
            enabled.dispatchEvent(new Event("change"));
        });
        const comment = host.querySelector<HTMLInputElement>("#table-comment")!;
        await act(async () => {
            comment.value = "Actors";
            comment.dispatchEvent(new Event("change"));
        });
        await act(async () => { vi.advanceTimersByTime(300); });
        expect(posted.filter((message) => {
            return (message as { type: string }).type === "preview";
        }).at(-1)).toMatchObject({ onlineAlter: { enabled: false } });
    });

    it("says why a table has no online ALTER TABLE settings", async () => {
        await send({ type: "load", data: { ...DATA,
            onlineAlterProblem: "Online ALTER TABLE needs a newer msm." } });
        await act(async () => { button("Online Alter Table").click(); });
        expect(host.querySelector(".online-alter .warning")?.textContent)
            .toBe("Online ALTER TABLE needs a newer msm.");
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

    describe("a new table", () => {
        const NEW: ITableEditorData = { ...DATA, live: false, isNew: true,
            table: { name: "", columns: [] }, ddl: "" };

        const key = async (id: string, which: string): Promise<void> => {
            const input = host.querySelector<HTMLInputElement>(`#${id}`)!;
            await act(async () => {
                input.dispatchEvent(new KeyboardEvent("keydown",
                    { key: which, bubbles: true, cancelable: true }));
            });
        };

        it("starts on the table's name", async () => {
            await send({ type: "load", data: NEW });

            expect(document.activeElement?.id).toBe("table-name");
            expect(host.querySelector<HTMLInputElement>("#table-name")
                ?.placeholder).toBe("Enter table name…");
        });

        it("gets its first column, id, the key, on Enter in the name or "
            + "comment, and saves it with add_table", async () => {
            await send({ type: "load", data: NEW });
            vi.useFakeTimers();
            const name = host.querySelector<HTMLInputElement>("#table-name")!;
            await act(async () => {
                name.value = "orders";
                name.dispatchEvent(new Event("change"));
            });
            await key("table-name", "Enter");
            await act(async () => { vi.advanceTimersByTime(300); });

            const asked = posted.filter((message) => {
                return (message as { type: string }).type === "preview";
            }).pop() as unknown as { edits: Array<{ op: string; table: unknown }> };
            expect(asked.edits).toEqual([{ op: "add_table", table:
                expect.objectContaining({ name: "orders",
                    columns: [expect.objectContaining({ name: "id",
                        type: "uuid", default: "UUID()", nullable: false })],
                    indexes: [{ name: null, kind: "primary",
                        columns: ["id"] }] }) }]);
            await act(async () => { button("Save to Project").click(); });
            expect(posted).toContainEqual({ type: "apply",
                edits: asked.edits });

            // A second Enter adds no second id.
            await key("table-comment", "Enter");
            await act(async () => { vi.advanceTimersByTime(300); });
            const again = posted.filter((message) => {
                return (message as { type: string }).type === "preview";
            }).pop() as unknown as {
                edits: Array<{ table: { columns: unknown[] } }>; };
            expect(again.edits[0].table.columns).toHaveLength(1);
        });
    });
});
