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

import { editPhrase, editTitle } from "../../modeler/editTitles.js";

const done = (edit: Record<string, unknown>): string | undefined => {
    return editPhrase(edit as { op: string })?.done;
};

describe("editPhrase", () => {
    it("names the object and its table", () => {
        expect(done({ op: "add_column", table: "orders",
            column: { name: "email", type: "TEXT" } }))
            .toBe("Added the column email to orders");
        expect(done({ op: "drop_column", table: "orders", column: "email" }))
            .toBe("Dropped the column email of orders");
        expect(done({ op: "modify_column", table: "orders", column: "total",
            new_column: {} })).toBe("Changed the column total of orders");
        expect(done({ op: "rename_column", table: "orders", column: "a",
            new_name: "b" })).toBe("Renamed the column a of orders to b");
    });

    it("names tables and the other objects, and renames", () => {
        expect(done({ op: "add_table", table: { name: "orders" } }))
            .toBe("Added the table orders");
        expect(done({ op: "rename_table", table: "orders",
            new_name: "purchases" }))
            .toBe("Renamed the table orders to purchases");
        expect(done({ op: "drop_routine", routine: "total",
            kind: "function" })).toBe("Dropped the function total");
        expect(done({ op: "add_routine", routine: { name: "refresh",
            kind: "procedure" } })).toBe("Added the procedure refresh");
        expect(done({ op: "drop_trigger", trigger: "orders_bi",
            table: "orders" })).toBe("Dropped the trigger orders_bi");
        expect(done({ op: "add_sequence", sequence: { name: "seq" } }))
            .toBe("Added the sequence seq");
    });

    it("names keys by name, kind or columns", () => {
        expect(done({ op: "add_index", table: "orders", index: {
            name: "orders_UNIQUE", kind: "unique", columns: ["id"] } }))
            .toBe("Added the unique index orders_UNIQUE to orders");
        expect(done({ op: "drop_index", table: "orders", columns: ["a", "b"] }))
            .toBe("Dropped the index on (a, b) of orders");
        expect(done({ op: "drop_index", table: "orders", kind: "primary" }))
            .toBe("Dropped the primary key of orders");
        expect(done({ op: "set_primary_key", table: "orders",
            columns: ["id", "line"] }))
            .toBe("Set the primary key of orders to (id, line)");
        expect(done({ op: "add_foreign_key", table: "orders",
            foreign_key: { name: "fk_orders_customer" } }))
            .toBe("Added the foreign key fk_orders_customer to orders");
        expect(done({ op: "set_table_options", table: "orders",
            options: { comment: "x" } }))
            .toBe("Set the comment of orders");
    });

    it("knows no op it has no words for", () => {
        expect(editPhrase({ op: "split_table", table: "t" })).toBeUndefined();
    });
});

describe("editTitle", () => {
    it("says what one edit did, in the schema", () => {
        expect(editTitle([{ op: "drop_table", table: "orders" }], "webshop"))
            .toEqual({ doing: "Dropping the table orders in webshop",
                done: "Dropped the table orders in webshop" });
    });

    it("names two edits and counts the rest", () => {
        const edits = [
            { op: "add_column", table: "orders", column: { name: "a" } },
            { op: "drop_index", table: "orders", name: "idx" },
            { op: "add_index", table: "orders", index: { name: "i2" } },
            { op: "add_foreign_key", table: "orders",
                foreign_key: { name: "fk" } },
        ];
        expect(editTitle(edits, "webshop").done).toBe("Added the column a "
            + "to orders, dropped the index idx of orders and 2 more changes "
            + "in webshop");
        expect(editTitle(edits.slice(0, 3), "webshop").done)
            .toMatch(/ and 1 more change in webshop$/u);
    });

    it("falls back to the schema where it has no words for an edit", () => {
        expect(editTitle([{ op: "split_table" }], "webshop").done)
            .toBe("Edited the schema of webshop");
    });
});
