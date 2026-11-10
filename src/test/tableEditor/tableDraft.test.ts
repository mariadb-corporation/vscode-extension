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

import type {
    IOutlineTable,
    IOutlineTrigger,
} from "../../modeler/modelFormat.js";
import {
    draftOf,
    draftProblems,
    firstColumn,
    joinType,
    keyPartsText,
    newTableEdits,
    newRowKey,
    parseKeyParts,
    renameColumn,
    splitType,
    typeChanged,
    tableEdits,
    type ITableDraft,
} from "../../tableEditor/tableDraft.js";

/** sakila's actor, as the outline reads it. */
const actor = (): IOutlineTable => {
    return {
        name: "actor",
        options: { engine: "InnoDB" },
        columns: [
            { name: "actor_id", type: "smallint(5) unsigned", nullable: false,
                default: null, auto_increment: true, comment: null },
            { name: "first_name", type: "varchar(45)", nullable: false,
                default: null, auto_increment: false, comment: null },
            { name: "last_name", type: "varchar(45)", nullable: false,
                default: null, auto_increment: false, comment: null },
            { name: "last_update", type: "timestamp", nullable: false,
                default: "current_timestamp()", auto_increment: false,
                comment: null, on_update: "current_timestamp()" },
        ],
        indexes: [
            { name: null, kind: "primary", columns: ["actor_id"] },
            { name: "idx_actor_last_name", kind: "index",
                columns: ["last_name"],
                key_parts: [{ column: "last_name", length: null,
                    order: null }] },
        ],
        foreign_keys: [],
    };
};

const triggers: IOutlineTrigger[] = [{ name: "upd_actor", timing: "BEFORE",
    events: "UPDATE", table: "actor", body: "SET NEW.a = 1" }];

/**
 * @param change What to change in the draft of the actor table.
 *
 * @returns The edits Save sends.
 */
const editsAfter = (change: (draft: ITableDraft) => void) => {
    const draft = draftOf(actor(), triggers);
    change(draft);

    return tableEdits(actor(), triggers, draft);
};

describe("tableEdits", () => {
    it("sends nothing for an unchanged table", () => {
        expect(editsAfter(() => { /* nothing */ })).toEqual([]);
    });

    it("modifies a changed column whole, keeping what it does not show", () => {
        const edits = editsAfter((draft) => {
            draft.columns[3].comment = "when";
        });
        expect(edits).toEqual([{ op: "modify_column", table: "actor",
            column: "last_update", new_column: expect.objectContaining({
                name: "last_update", type: "timestamp", nullable: false,
                default: "current_timestamp()",
                on_update: "current_timestamp()", comment: "when" }) }]);
    });

    it("renames through modify_column, by the name read", () => {
        const [edit] = editsAfter((draft) => {
            draft.columns[1].name = "given_name";
        });
        expect(edit).toMatchObject({ op: "modify_column",
            column: "first_name", new_column: { name: "given_name" } });
    });

    it("adds a new column after the one before it, or first", () => {
        const edits = editsAfter((draft) => {
            draft.columns.splice(2, 0, { key: newRowKey("c"), name: "email",
                type: "VARCHAR(120)", primary: false });
            draft.columns.unshift({ key: newRowKey("c"), name: "uid",
                type: "UUID", primary: false });
        });
        expect(edits).toEqual([
            expect.objectContaining({ op: "add_column", first: true,
                column: expect.objectContaining({ name: "uid" }) }),
            expect.objectContaining({ op: "add_column",
                after: "first_name",
                column: expect.objectContaining({ name: "email" }) }),
        ]);
    });

    it("drops columns marked to go, and nothing for a new one removed", () => {
        expect(editsAfter((draft) => {
            draft.columns[2].dropped = true;
        })).toEqual([{ op: "drop_column", table: "actor",
            column: "last_name" }]);
    });

    it("changes the primary key from the columns' checkboxes", () => {
        expect(editsAfter((draft) => {
            draft.columns[1].primary = true;
        }).at(-1)).toEqual({ op: "set_primary_key", table: "actor",
            columns: ["actor_id", "first_name"] });
        expect(editsAfter((draft) => {
            draft.columns[0].primary = false;
        })).toEqual([{ op: "drop_index", table: "actor", kind: "primary" }]);
    });

    it("drops and adds a changed index", () => {
        expect(editsAfter((draft) => {
            draft.indexes[0].keyParts = [{ column: "last_name", length: 10,
                order: "DESC" }];
        })).toEqual([
            { op: "drop_index", table: "actor", name: "idx_actor_last_name" },
            { op: "add_index", table: "actor", index: { kind: "index",
                name: "idx_actor_last_name", key_parts: [{
                    column: "last_name", length: 10, order: "DESC" }] } },
        ]);
    });

    it("renames the table first, and uses the new name after", () => {
        const edits = editsAfter((draft) => {
            draft.name = "actors";
            draft.comment = "People";
        });
        expect(edits).toEqual([
            { op: "rename_table", table: "actor", new_name: "actors" },
            { op: "set_table_options", table: "actors",
                options: { comment: "People" } },
        ]);
    });

    it("renames a trigger, and recreates one whose body changed", () => {
        expect(editsAfter((draft) => {
            draft.triggers[0].name = "actor_bu";
        })).toEqual([{ op: "rename_trigger", trigger: "upd_actor",
            new_name: "actor_bu" }]);
        expect(editsAfter((draft) => {
            draft.triggers[0].body = "SET NEW.b = 2";
        })).toEqual([
            { op: "drop_trigger", trigger: "upd_actor", table: "actor" },
            { op: "add_trigger", trigger: { name: "upd_actor",
                timing: "BEFORE", events: "UPDATE", table: "actor",
                body: "SET NEW.b = 2" } },
        ]);
    });

    it("adds a foreign key after dropping a changed one", () => {
        const table = actor();
        table.foreign_keys = [{ name: "fk_a", columns: ["first_name"],
            references: { schema: null, table: "names",
                columns: ["name"] } }];
        const draft = draftOf(table, []);
        draft.foreignKeys[0].onDelete = "CASCADE";
        expect(tableEdits(table, [], draft)).toEqual([
            { op: "drop_foreign_key", table: "actor", name: "fk_a" },
            { op: "add_foreign_key", table: "actor", foreign_key: {
                name: "fk_a", columns: ["first_name"],
                references: { table: "names", columns: ["name"] },
                on_delete: "CASCADE" } },
        ]);
    });
});

describe("types and key parts", () => {
    it("takes a type apart and puts it back", () => {
        expect(splitType("smallint(5) unsigned")).toEqual({ base: "smallint",
            length: "5", rest: "unsigned" });
        expect(splitType("enum('a)','b')")).toEqual({ base: "enum",
            length: "'a)','b'", rest: "" });
        expect(splitType("INT UNSIGNED")).toEqual({ base: "INT", length: "",
            rest: "UNSIGNED" });
        expect(joinType({ base: "decimal", length: "10,2", rest: "" }))
            .toBe("decimal(10,2)");
    });

    it("sets a changed type's default length, and clears it for a type "
        + "that has none", () => {
        const varchar = splitType("varchar(45)");
        expect(typeChanged(varchar, "int")).toBe("int");
        expect(typeChanged(varchar, "decimal")).toBe("decimal(10,2)");
        expect(typeChanged(splitType("int"), "varchar")).toBe("varchar(45)");
        expect(typeChanged(splitType("int"), "enum")).toBe("enum");
        // The same type keeps its length; one typed with it is taken.
        expect(typeChanged(splitType("varchar(100)"), "VARCHAR"))
            .toBe("VARCHAR(100)");
        expect(typeChanged(varchar, "char(3)")).toBe("char(3)");
        expect(typeChanged(varchar, "int unsigned")).toBe("int unsigned");
    });

    it("reads and writes key parts", () => {
        const parts = parseKeyParts("last_name(10) desc, `odd name`");
        expect(parts).toEqual([
            { column: "last_name", length: 10, order: "DESC" },
            { column: "odd name", length: null, order: null },
        ]);
        expect(keyPartsText(parts as never)).toBe(
            "last_name(10) DESC, `odd name`");
        expect(typeof parseKeyParts("a b c")).toBe("string");
    });
});

describe("draftProblems", () => {
    it("names duplicate columns and unknown index columns", () => {
        const draft = draftOf(actor(), []);
        draft.columns[1].name = "LAST_NAME";
        draft.indexes[0].keyParts = [{ column: "nope" }];
        expect(draftProblems(draft)).toEqual([
            "There are two columns named last_name.",
            "The index idx_actor_last_name names nope, which the table has "
                + "no column of.",
        ]);
    });
});

describe("renameColumn", () => {
    it("takes the column's indexes along, and only renames the column", () => {
        const draft = draftOf(actor(), []);
        const lastName = draft.columns[2].key;
        let renamed = renameColumn(draft, lastName, "surname");
        expect(renamed.indexes[0].keyParts[0].column).toBe("surname");
        expect(draftProblems(renamed)).toEqual([]);
        expect(tableEdits(actor(), [], renamed).map((edit) => {
            return edit.op;
        })).toEqual(["modify_column"]);
        renamed = renameColumn(renamed, lastName, "last_name");
        expect(tableEdits(actor(), [], renamed)).toEqual([]);
    });
});

describe("a new table", () => {
    it("starts its first column as id, a UUID the server makes, the key",
        () => {
            expect(firstColumn()).toMatchObject({ name: "id", type: "uuid",
                nullable: false, default: "UUID()", primary: true });
        });

    it("is made with add_table, its key and columns in it, the rest after",
        () => {
            const draft = { ...draftOf({ name: "", columns: [] }, []),
                name: " orders ", comment: "Orders",
                columns: [firstColumn(), { key: "c2", name: "total",
                    type: "decimal(10,2)", nullable: true, primary: false }],
                indexes: [{ key: "i1", name: "", kind: "index",
                    keyParts: [{ column: "total", length: null, order: null }],
                    using: null, comment: null }] };

            expect(newTableEdits(draft)).toEqual([
                { op: "add_table", table: { name: "orders",
                    columns: [
                        expect.objectContaining({ name: "id", type: "uuid",
                            nullable: false, default: "UUID()" }),
                        expect.objectContaining({ name: "total",
                            type: "decimal(10,2)", nullable: true })],
                    indexes: [{ name: null, kind: "primary",
                        columns: ["id"] }] } },
                { op: "add_index", table: "orders", index: { kind: "index",
                    key_parts: [{ column: "total", length: null,
                        order: null }] } },
                { op: "set_table_options", table: "orders",
                    options: { comment: "Orders" } },
            ]);
        });

    it("makes no edits before it has a name and a column", () => {
        const empty = draftOf({ name: "", columns: [] }, []);

        expect(newTableEdits(empty)).toEqual([]);
        expect(newTableEdits({ ...empty, name: "t" })).toEqual([]);
        expect(newTableEdits({ ...empty, columns: [firstColumn()] }))
            .toEqual([]);
    });
});
