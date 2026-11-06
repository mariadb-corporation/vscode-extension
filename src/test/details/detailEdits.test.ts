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

import {
    tableDetailEdits,
    type IDetailEdits,
} from "../../details/detailEdits.js";
import { liveDetails, outlineDetails } from "../../details/objectDetails.js";
import type { IOutlineTable } from "../../modeler/modelFormat.js";

const orders = (): IOutlineTable => {
    return {
        name: "orders",
        columns: [
            { name: "id", type: "INT", nullable: false, auto_increment: true },
            { name: "customer_id", type: "INT", nullable: false },
            { name: "note", type: "VARCHAR(45)", comment: "Free text" },
        ],
        indexes: [{ name: null, kind: "primary", columns: ["id"] },
            { name: "by_note", kind: "index", columns: ["note"] }],
        foreign_keys: [{ name: "fk_orders_customer", columns: ["customer_id"],
            references: { schema: null, table: "customer", columns: ["id"] },
            on_delete: "CASCADE", many: true, mandatory: true }],
        options: { comment: "Orders" },
    };
};

const edits = (result: IDetailEdits | { error: string }): IDetailEdits => {
    if ("error" in result) {
        throw new Error(result.error);
    }

    return result;
};

describe("the Object Details view's changes", () => {
    it("sends a changed column whole, and the old one back on undo", () => {
        const result = edits(tableDetailEdits(orders(), { kind: "modifyColumn",
            column: "note", definition: { name: "note", type: "TEXT",
                comment: "Free text" } }));

        expect(result.label).toBe("Change Column orders.note");
        expect(result.edits).toEqual([{ op: "modify_column", table: "orders",
            column: "note", new_column: { name: "note", type: "TEXT",
                comment: "Free text" } }]);
        expect(result.inverse).toEqual([{ op: "modify_column",
            table: "orders", column: "note", new_column: { name: "note",
                type: "VARCHAR(45)", comment: "Free text" } }]);
    });

    it("puts a dropped column back where it was", () => {
        const result = edits(tableDetailEdits(orders(),
            { kind: "dropColumn", column: "customer_id" }));

        expect(result.inverse).toEqual([{ op: "add_column", table: "orders",
            column: { name: "customer_id", type: "INT", nullable: false },
            after: "id" }]);
        expect(edits(tableDetailEdits(orders(),
            { kind: "dropColumn", column: "id" })).inverse[0])
            .toMatchObject({ first: true });
    });

    it("drops the primary key where no column is left in it, and sets the "
        + "old one back", () => {
        const result = edits(tableDetailEdits(orders(),
            { kind: "setPrimaryKey", columns: [] }));

        expect(result.edits).toEqual([{ op: "drop_index", table: "orders",
            kind: "primary" }]);
        expect(result.inverse).toEqual([{ op: "set_primary_key",
            table: "orders", columns: ["id"] }]);
    });

    it("adds a dropped foreign key back without what msm works out", () => {
        const result = edits(tableDetailEdits(orders(),
            { kind: "dropForeignKey", name: "fk_orders_customer" }));

        expect(result.inverse).toEqual([{ op: "add_foreign_key",
            table: "orders", foreign_key: { name: "fk_orders_customer",
                columns: ["customer_id"], references: { table: "customer",
                    columns: ["id"] }, on_delete: "CASCADE" } }]);
    });

    it("clears a comment with null, and renames both ways", () => {
        expect(edits(tableDetailEdits(orders(),
            { kind: "setComment", comment: "" })).edits).toEqual([{
            op: "set_table_options", table: "orders",
            options: { comment: null } }]);
        expect(edits(tableDetailEdits(orders(),
            { kind: "renameTable", name: "purchase" })).inverse).toEqual([{
            op: "rename_table", table: "purchase", new_name: "orders" }]);
    });

    it("refuses a change to what the table has not", () => {
        expect(tableDetailEdits(orders(), { kind: "dropIndex", name: "x" }))
            .toEqual({ error: "orders has no index x." });
        expect(tableDetailEdits(orders(), { kind: "addIndex",
            index: { name: "", kind: "index", columns: ["note"] } }))
            .toEqual({ error: "An index needs a name." });
    });
});

describe("what the view shows", () => {
    it("finds a project's object in its snapshot, a routine by its kind",
        () => {
        const definition = { format: "msm-schema/1" as const, schema: "shop",
            tables: [orders()],
            routines: [{ name: "total", kind: "function" as const }] };

        expect(outlineDetails(definition, { type: "table", name: "orders" }))
            .toEqual({ type: "table", table: orders() });
        expect(outlineDetails(definition, { type: "procedure",
            name: "total" })).toBeUndefined();
    });

    it("finds a project's trigger, event and sequence", () => {
        const definition = { format: "msm-schema/1" as const, schema: "shop",
            tables: [orders()],
            triggers: [{ name: "orders_bi", timing: "BEFORE",
                events: "INSERT", table: "orders" }],
            events: [{ name: "purge", schedule: "EVERY 1 DAY" }],
            sequences: [{ name: "order_no", start: "1000" }] };

        expect(outlineDetails(definition, { type: "trigger",
            name: "orders_bi" })).toMatchObject({ type: "trigger",
            trigger: { table: "orders" } });
        expect(outlineDetails(definition, { type: "event", name: "purge" }))
            .toMatchObject({ type: "event", event: { schedule: "EVERY 1 DAY" } });
        expect(outlineDetails(definition, { type: "sequence",
            name: "order_no" })).toMatchObject({ type: "sequence",
            sequence: { start: "1000" } });
    });

    it("reads a live table's columns and primary key", () => {
        const body = liveDetails({
            basic: { schema: "shop", name: "orders", type: "BASE TABLE",
                comment: "Orders" },
            columns: [{ name: "id", datatype: "int", not_null: 1,
                is_primary: 1, is_unique: 1, is_generated: 0,
                id_generation: "auto_inc", comment: "", column_default: null }],
        }, { type: "table", name: "orders" });

        expect(body).toEqual({ type: "table", table: {
            name: "orders",
            columns: [{ name: "id", type: "int", nullable: false,
                default: null, auto_increment: true, comment: null }],
            indexes: [{ name: null, kind: "primary", columns: ["id"] }],
            options: { comment: "Orders" },
        } });
    });
});
