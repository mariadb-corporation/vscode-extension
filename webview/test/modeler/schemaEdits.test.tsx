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

import type { IOutlineTable } from "../../../src/modeler/modelFormat.js";
import {
    COLUMN_TYPES,
    matchingTypes,
    DEFAULT_COLUMN_TYPE,
    KEY_COLUMN_TYPE,
} from "../../../src/sql/columnTypes.js";
import {
    applyEdits,
    associativeTableChange,
    existingColumnsChange,
    freeName,
    newEventChange,
    newSequenceChange,
    newTableChange,
    newTriggerChange,
    newViewChange,
    numberedName,
    relationshipChange,
    relationshipKindChange,
    relationshipKindOf,
    type ISchemaObjectLists,
} from "../../src/modeler/schemaEdits.js";

const customer = (): IOutlineTable => {
    return {
        name: "customer",
        columns: [
            { name: "id", type: "UUID", nullable: false },
            { name: "name", type: "VARCHAR(45)" },
        ],
        indexes: [{ name: null, kind: "primary", columns: ["id"] }],
        foreign_keys: [],
    };
};

const order = (): IOutlineTable => {
    return {
        name: "order",
        columns: [{ name: "id", type: "INT", nullable: false }],
        indexes: [{ name: null, kind: "primary", columns: ["id"] }],
        foreign_keys: [],
    };
};

const objects = (...tables: IOutlineTable[]): ISchemaObjectLists => {
    return { tables, views: [], routines: [], triggers: [], events: [],
        sequences: [] };
};

describe("names", () => {
    it("numbers a new object's name from 1, past the names in use", () => {
        expect(numberedName("table", [])).toBe("table1");
        expect(numberedName("table", ["Table1", "table2"])).toBe("table3");
    });

    it("keeps a name that is free, and numbers one that is not", () => {
        expect(freeName("fk_a_b", ["fk_x"])).toBe("fk_a_b");
        expect(freeName("fk_a_b", ["FK_A_B"])).toBe("fk_a_b1");
    });
});

describe("column types", () => {
    it("offers every type, the key's and the default one among them", () => {
        expect(matchingTypes("")).toHaveLength(COLUMN_TYPES.length);
        for (const type of [KEY_COLUMN_TYPE, DEFAULT_COLUMN_TYPE]) {
            expect(COLUMN_TYPES.some((entry) => {
                return entry.label === type;
            })).toBe(true);
        }
    });

    it("matches what is typed from the start, in any case", () => {
        expect(matchingTypes("var").map((entry) => { return entry.label; }))
            .toEqual(["VARBINARY(255)", "VARCHAR(45)"]);
        expect(matchingTypes("int u").map((entry) => { return entry.label; }))
            .toEqual(["INT UNSIGNED"]);
    });

    it("leaves the types that need values open", () => {
        const enumType = matchingTypes("enum")[0];
        expect(enumType?.insert).toBe("ENUM(");
        expect(enumType?.complete).toBe(false);
    });
});

describe("schema changes", () => {
    it("makes a new table with its first column as the primary key", () => {
        const change = newTableChange("table1", [
            { name: "id", type: "UUID" },
            { name: "title", type: "VARCHAR(45)" },
        ]);

        expect(change.edits).toEqual([{
            op: "add_table",
            table: {
                name: "table1",
                columns: [
                    { name: "id", type: "UUID", nullable: false },
                    { name: "title", type: "VARCHAR(45)" },
                ],
                indexes: [{ kind: "primary", columns: ["id"] }],
                foreign_keys: [],
            },
        }]);
        expect(change.inverse).toEqual([{ op: "drop_table", table: "table1" }]);
    });

    it("places a view with a placeholder SELECT", () => {
        expect(newViewChange("view1").edits).toEqual([{
            op: "add_view", view: { name: "view1", definition: "SELECT 1" },
        }]);
    });

    it("adds a column per referenced key column and a foreign key over them "
        + "for a 1:n relationship", () => {
        const child = order();
        const result = relationshipChange(child, customer(),
            { many: true, identifying: false }, [child, customer()]);
        if ("error" in result) {
            throw new Error(result.error);
        }

        expect(result.change.edits).toEqual([
            { op: "add_column", table: "order",
                column: { name: "customer_id", type: "UUID", nullable: false } },
            { op: "add_foreign_key", table: "order", foreign_key: {
                name: "fk_order_customer",
                columns: ["customer_id"],
                references: { table: "customer", columns: ["id"] },
            } },
        ]);
        expect(result.change.inverse).toEqual([
            { op: "drop_foreign_key", table: "order", name: "fk_order_customer" },
            { op: "drop_column", table: "order", column: "customer_id" },
        ]);
    });

    it("adds an identifying relationship's columns to the primary key, and "
        + "makes a 1:1 one's unique; undone foreign key first", () => {
        const child = order();
        const result = relationshipChange(child, customer(),
            { many: false, identifying: true }, [child, customer()]);
        if ("error" in result) {
            throw new Error(result.error);
        }

        expect(result.change.edits.map((edit) => { return edit.op; })).toEqual([
            "add_column", "set_primary_key", "add_index", "add_foreign_key"]);
        expect(result.change.edits[1]).toEqual({ op: "set_primary_key",
            table: "order", columns: ["id", "customer_id"] });
        expect(result.change.inverse).toEqual([
            { op: "drop_foreign_key", table: "order", name: "fk_order_customer" },
            { op: "drop_index", table: "order",
                name: "fk_order_customer_UNIQUE" },
            { op: "set_primary_key", table: "order", columns: ["id"] },
            { op: "drop_column", table: "order", column: "customer_id" },
        ]);
    });

    it("refuses a relationship to a table without a primary key", () => {
        const parent: IOutlineTable = { name: "log", columns: [
            { name: "line", type: "TEXT" }] };

        expect(relationshipChange(order(), parent,
            { many: true, identifying: false }, [])).toEqual({
            error: "'log' has no Primary Key. Please add a PK or select another "
                + "Table.",
        });
    });

    it("copies a SERIAL key as BIGINT UNSIGNED, and keeps new names free", () => {
        const parent: IOutlineTable = {
            name: "customer",
            columns: [{ name: "id", type: "SERIAL" }],
            indexes: [{ name: null, kind: "primary", columns: ["id"] }],
        };
        const child = order();
        child.columns.push({ name: "customer_id", type: "INT" });
        child.foreign_keys = [{ name: "fk_order_customer", columns: [],
            references: { schema: null, table: "x", columns: [] } }];
        const result = relationshipChange(child, parent,
            { many: true, identifying: false }, [child, parent]);
        if ("error" in result) {
            throw new Error(result.error);
        }

        expect(result.change.edits[0]).toEqual({ op: "add_column",
            table: "order", column: { name: "customer_id1",
                type: "BIGINT UNSIGNED", nullable: false } });
        expect(result.foreignKey.name).toBe("fk_order_customer1");
    });

    it("joins two tables through a new table for an n:m relationship", () => {
        const result = associativeTableChange(order(), customer(),
            [order(), customer()]);
        if ("error" in result) {
            throw new Error(result.error);
        }

        expect(result.table.name).toBe("order_has_customer");
        expect(result.table.columns.map((column) => { return column.name; }))
            .toEqual(["order_id", "customer_id"]);
        expect(result.table.indexes).toEqual([{ name: null, kind: "primary",
            columns: ["order_id", "customer_id"] }]);
        expect(result.table.foreign_keys?.map((key) => { return key.name; }))
            .toEqual(["fk_order_has_customer_order",
                "fk_order_has_customer_customer"]);
        expect(result.change.inverse).toEqual([{ op: "drop_table",
            table: "order_has_customer" }]);
    });

    it("makes a foreign key over columns picked in both tables", () => {
        const { change } = existingColumnsChange(order(), ["id"], customer(),
            ["id"], []);

        expect(change.edits).toEqual([{ op: "add_foreign_key", table: "order",
            foreign_key: { name: "fk_order_customer", columns: ["id"],
                references: { table: "customer", columns: ["id"] } } }]);
    });
});

describe("the snapshot meanwhile", () => {
    it("shows a relationship's columns and foreign key, and takes them back "
        + "with its inverse", () => {
        const lists = objects(order(), customer());
        const result = relationshipChange(lists.tables[0]!, lists.tables[1]!,
            { many: true, identifying: true }, lists.tables);
        if ("error" in result) {
            throw new Error(result.error);
        }

        applyEdits(lists, result.change.edits);
        const changed = lists.tables[0]!;
        expect(changed.columns.map((column) => { return column.name; }))
            .toEqual(["id", "customer_id"]);
        expect(changed.indexes?.[0]?.columns).toEqual(["id", "customer_id"]);
        expect(changed.foreign_keys?.[0]).toMatchObject({
            name: "fk_order_customer", many: true, referenced_mandatory: true,
        });

        applyEdits(lists, result.change.inverse);
        expect(lists.tables[0]).toEqual(order());
    });

    it("adds and drops tables, views and routines", () => {
        const lists = objects();
        applyEdits(lists, newTableChange("t", [{ name: "id", type: "UUID" }]).edits);
        applyEdits(lists, newViewChange("v").edits);
        applyEdits(lists, [{ op: "add_routine", routine: { name: "r",
            kind: "procedure", parameters: [], body: "BEGIN\nEND" } }]);

        expect(lists.tables[0]?.indexes).toEqual([{ name: null, kind: "primary",
            columns: ["id"] }]);
        expect(lists.views.map((view) => { return view.name; })).toEqual(["v"]);
        expect(lists.routines[0]).toMatchObject({ name: "r", kind: "procedure" });

        applyEdits(lists, [...newTriggerChange("t", "t_bi").edits,
            ...newEventChange("e").edits, ...newSequenceChange("s").edits]);
        expect(lists.triggers).toEqual([{ name: "t_bi", timing: "BEFORE",
            events: "INSERT", table: "t", body: "BEGIN\nEND" }]);
        expect(lists.events?.map((event) => { return event.schedule; }))
            .toEqual(["EVERY 1 DAY"]);
        expect(lists.sequences).toEqual([{ name: "s" }]);

        // A table's triggers go with it.
        applyEdits(lists, [{ op: "drop_table", table: "T" },
            { op: "drop_view", view: "v" }, { op: "drop_routine", routine: "r" },
            ...newEventChange("e").inverse, ...newSequenceChange("s").inverse]);
        expect(lists).toEqual(objects());
    });

    it("changes a column and a table's options, and adds a column where "
        + "it is asked for", () => {
        const lists = objects(customer());
        applyEdits(lists, [
            { op: "modify_column", table: "customer", column: "name",
                new_column: { name: "name", type: "TEXT" } },
            { op: "set_table_options", table: "customer",
                options: { comment: "Buyers", engine: null } },
            { op: "add_column", table: "customer",
                column: { name: "code", type: "INT" }, first: true },
            { op: "add_column", table: "customer",
                column: { name: "email", type: "TEXT" }, after: "code" },
        ]);

        const table = lists.tables[0]!;
        expect(table.columns.map((column) => {
            return `${column.name} ${column.type}`;
        })).toEqual(["code INT", "email TEXT", "id UUID", "name TEXT"]);
        expect(table.options).toEqual({ comment: "Buyers" });
    });

    it("makes a 1:1 foreign key over a unique key one", () => {
        const lists = objects(order(), customer());
        const result = relationshipChange(lists.tables[0]!, lists.tables[1]!,
            { many: false, identifying: false }, lists.tables);
        if ("error" in result) {
            throw new Error(result.error);
        }
        applyEdits(lists, result.change.edits);

        expect(lists.tables[0]?.foreign_keys?.[0]?.many).toBe(false);
    });
});

describe("a relationship's kind", () => {
    const KEY = {
        name: "fk_orders_customers",
        columns: ["customer_id"],
        references: { schema: null, table: "customers", columns: ["id"] },
    };
    const orders = (indexes: IOutlineTable["indexes"]): IOutlineTable => {
        return {
            name: "orders",
            columns: [{ name: "id", type: "INT" },
                { name: "customer_id", type: "INT" }],
            indexes,
            foreign_keys: [{ ...KEY }],
        };
    };
    const PRIMARY = { name: null, kind: "primary", columns: ["id"] };

    it("is read off the child's keys", () => {
        expect(relationshipKindOf(orders([PRIMARY]), KEY))
            .toEqual({ many: true, identifying: false });
        expect(relationshipKindOf(orders([{ ...PRIMARY,
            columns: ["id", "customer_id"] }]), KEY))
            .toEqual({ many: true, identifying: true });
        expect(relationshipKindOf(orders([PRIMARY, { name: "u",
            kind: "unique", columns: ["customer_id"] }]), KEY))
            .toEqual({ many: false, identifying: false });
    });

    it("turns identifying by joining the primary key, and back", () => {
        const table = orders([PRIMARY]);
        const result = relationshipKindChange(table, KEY,
            { many: true, identifying: true }, [table]);
        expect(result).toEqual({ change: {
            label: "Make fk_orders_customers 1:n, identifying",
            edits: [{ op: "set_primary_key", table: "orders",
                columns: ["id", "customer_id"] }],
            inverse: [{ op: "set_primary_key", table: "orders",
                columns: ["id"] }],
        } });

        const tables = { tables: [table], views: [], routines: [],
            triggers: [], events: [], sequences: [] };
        applyEdits(tables, "change" in result ? result.change.edits : []);
        expect(relationshipKindOf(table, KEY).identifying).toBe(true);
        const back = relationshipKindChange(table, KEY,
            { many: true, identifying: false }, [table]);
        expect("change" in back && back.change.edits).toEqual([
            { op: "set_primary_key", table: "orders", columns: ["id"] }]);
    });

    it("turns 1:1 with a unique index, and 1:n by dropping it", () => {
        const table = orders([PRIMARY]);
        const one = relationshipKindChange(table, KEY,
            { many: false, identifying: false }, [table]);
        const index = { name: "fk_orders_customers_UNIQUE", kind: "unique",
            columns: ["customer_id"] };
        // The key relies on the unique index: mariadb-lsp refuses to drop
        // it while the key is there, so the key goes and comes back.
        const withoutKey = [
            { op: "drop_foreign_key", table: "orders",
                name: "fk_orders_customers" },
            { op: "drop_index", table: "orders",
                name: "fk_orders_customers_UNIQUE" },
            { op: "add_foreign_key", table: "orders",
                foreign_key: expect.objectContaining({
                    name: "fk_orders_customers",
                    columns: ["customer_id"] }) },
        ];
        expect("change" in one && one.change).toMatchObject({
            edits: [{ op: "add_index", table: "orders", index }],
            inverse: withoutKey,
        });

        const unique = orders([PRIMARY, index]);
        const many = relationshipKindChange(unique, KEY,
            { many: true, identifying: false }, [unique]);
        expect("change" in many && many.change).toMatchObject({
            edits: withoutKey,
            inverse: [{ op: "add_index", table: "orders", index }],
        });
    });

    it("refuses to drop an unnamed UNIQUE, which deployed schemas keep", () => {
        const table = orders([PRIMARY, { name: null, kind: "unique",
            columns: ["customer_id"] }]);

        expect(relationshipKindChange(table, KEY,
            { many: true, identifying: false }, [table]))
            .toHaveProperty("error");
    });

    it("refuses what the keys cannot be", () => {
        // The foreign key is the whole primary key: always 1:1, and it
        // cannot leave the key without leaving none.
        const keyed = orders([{ name: null, kind: "primary",
            columns: ["customer_id"] }]);
        expect(relationshipKindChange(keyed, KEY,
            { many: true, identifying: true }, [keyed]))
            .toHaveProperty("error");
        expect(relationshipKindChange(keyed, KEY,
            { many: false, identifying: false }, [keyed]))
            .toHaveProperty("error");
    });
});
