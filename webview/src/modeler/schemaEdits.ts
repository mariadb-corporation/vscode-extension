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

import type { IMsmSchemaEdit } from "../../../src/mcp/msmApi.js";
import type {
    IOutlineColumn,
    IOutlineForeignKey,
    IOutlineIndex,
    IOutlineRoutine,
    IOutlineTable,
    IOutlineView,
} from "../../../src/modeler/modelFormat.js";
import { primaryKeyColumns, sameName } from "./catalog.js";

/**
 * The schema edits the diagram's tools make, as `mariadb-lsp edit` takes
 * them (`docs/edit-format.md` of the language server): what each tool
 * sends, what undoes it, and what it does to the viewer's snapshot until
 * msm sends the one it made of the SQL.
 *
 * The names and the columns a relationship adds are Workbench's: a new
 * table is `table1`, a foreign key column `<referenced table>_<column>`,
 * a foreign key `fk_<table>_<referenced table>`, an n:m relationship's
 * table `<table>_has_<table>`.
 */

/** A change of the schema: what it sends, and what puts it back. */
export interface ISchemaChange {
    /** What the history calls it. */
    label: string;
    edits: IMsmSchemaEdit[];
    /** The edits that undo it, in the order they are made. */
    inverse: IMsmSchemaEdit[];
}

/** The snapshot's objects, which the edits change in place. */
export interface ISchemaObjectLists {
    tables: IOutlineTable[];
    views: IOutlineView[];
    routines: IOutlineRoutine[];
}

/** What a relationship tool makes. */
export interface IRelationshipKind {
    /** Whether a parent can have many children: 1:n, else 1:1. */
    many: boolean;
    /** Whether the foreign key's columns join the child's primary key. */
    identifying: boolean;
}

/**
 * @param base A name's stem: `table`.
 * @param taken The names in use, in any case.
 *
 * @returns The stem with the smallest number from 1 that is free:
 *          `table1`, `table2`.
 */
export const numberedName = (base: string, taken: Iterable<string>): string => {
    const used = new Set([...taken].map((name) => { return name.toLowerCase(); }));
    for (let number = 1; ; number += 1) {
        const name = `${base}${String(number)}`;
        if (!used.has(name.toLowerCase())) {
            return name;
        }
    }
};

/**
 * @param name A name.
 * @param taken The names in use, in any case.
 *
 * @returns The name where it is free, else it with the smallest number
 *          from 1 that makes it so.
 */
export const freeName = (name: string, taken: Iterable<string>): string => {
    const used = new Set([...taken].map((entry) => { return entry.toLowerCase(); }));

    return used.has(name.toLowerCase()) ? numberedName(name, used) : name;
};

/**
 * @param tables The schema's tables.
 *
 * @returns The names of every foreign key and index of the schema: a
 *          foreign key's name is the schema's (InnoDB keeps them per
 *          schema).
 */
const constraintNames = (tables: readonly IOutlineTable[]): string[] => {
    return tables.flatMap((table) => {
        return [
            ...(table.foreign_keys ?? []).map((key) => { return key.name; }),
            ...(table.indexes ?? []).flatMap((index) => {
                return index.name === null ? [] : [index.name];
            }),
        ];
    });
};

/**
 * @param table A table.
 *
 * @returns Its primary key's columns, in the key's order.
 */
const primaryKeyOf = (table: IOutlineTable): string[] => {
    return (table.indexes ?? []).find((index) => {
        return index.kind === "primary";
    })?.columns ?? [];
};

/**
 * @param type A column's type as the snapshot has it.
 *
 * @returns The type a column referencing it gets: `SERIAL` stands for
 *          `BIGINT UNSIGNED` (with keys and AUTO_INCREMENT the copy must
 *          not have).
 */
const referencingType = (type: string): string => {
    return type.trim().toUpperCase() === "SERIAL" ? "BIGINT UNSIGNED" : type;
};

/**
 * @param table A table.
 * @param columns Some of its columns.
 *
 * @returns Whether a unique key or the primary key is made of exactly
 *          those columns: a foreign key over them is 1:1.
 */
const uniquelyKeyed = (table: IOutlineTable, columns: readonly string[]): boolean => {
    return (table.indexes ?? []).some((index) => {
        return (index.kind === "primary" || index.kind === "unique")
            && index.columns.length === columns.length
            && index.columns.every((column) => {
                return columns.some((other) => { return sameName(column, other); });
            });
    });
};

/**
 * A new table: the columns entered, the first one its primary key.
 *
 * @param name The table's name.
 * @param columns Its columns, at least one.
 *
 * @returns The change.
 */
export const newTableChange = (
    name: string,
    columns: readonly IOutlineColumn[],
): ISchemaChange => {
    const [first] = columns;
    const table: IOutlineTable = {
        name,
        columns: columns.map((column, index) => {
            return index === 0 ? { ...column, nullable: false } : { ...column };
        }),
        indexes: first === undefined
            ? []
            : [{ name: null, kind: "primary", columns: [first.name] }],
    };

    return {
        label: `Place Table ${name}`,
        edits: [{ op: "add_table", table: tableEditMembers(table) }],
        inverse: [{ op: "drop_table", table: name }],
    };
};

/**
 * @param table A table of the snapshot.
 *
 * @returns It as `add_table` takes it: the outline's members, without
 *          those the snapshot derives (a foreign key's cardinality).
 */
const tableEditMembers = (table: IOutlineTable): Record<string, unknown> => {
    return {
        name: table.name,
        columns: table.columns.map(columnEditMembers),
        indexes: (table.indexes ?? []).map((index) => {
            return { ...(index.name === null ? {} : { name: index.name }),
                kind: index.kind, columns: [...index.columns] };
        }),
        foreign_keys: (table.foreign_keys ?? []).map(foreignKeyEditMembers),
    };
};

/**
 * @param column A column.
 *
 * @returns It as the edits take it.
 */
const columnEditMembers = (column: IOutlineColumn): Record<string, unknown> => {
    return {
        name: column.name,
        type: column.type,
        ...(column.nullable === undefined ? {} : { nullable: column.nullable }),
    };
};

/**
 * @param key A foreign key.
 *
 * @returns It as the edits take it.
 */
const foreignKeyEditMembers = (key: IOutlineForeignKey): Record<string, unknown> => {
    return {
        name: key.name,
        columns: [...key.columns],
        references: { table: key.references.table,
            columns: [...key.references.columns] },
    };
};

/**
 * A new view, with a placeholder for its SELECT.
 *
 * @param name The view's name.
 *
 * @returns The change.
 */
export const newViewChange = (name: string): ISchemaChange => {
    return {
        label: `Place View ${name}`,
        edits: [{ op: "add_view", view: { name, definition: "SELECT 1" } }],
        inverse: [{ op: "drop_view", view: name }],
    };
};

/**
 * A new procedure with an empty body.
 *
 * @param name The routine's name.
 *
 * @returns The change.
 */
export const newRoutineChange = (name: string): ISchemaChange => {
    return {
        label: `Add Routine ${name}`,
        edits: [{
            op: "add_routine",
            routine: { name, kind: "procedure", parameters: [],
                body: "BEGIN\nEND" },
        }],
        inverse: [{ op: "drop_routine", routine: name, kind: "procedure" }],
    };
};

/** A relationship worked out, or why there can be none. */
export type RelationshipResult =
    | { change: ISchemaChange; foreignKey: IOutlineForeignKey }
    | { error: string };

/**
 * A relationship drawn from a table to the one it references: a column
 * per column of the referenced table's primary key added to the table,
 * and the foreign key over them; an identifying one adds them to the
 * table's primary key, a 1:1 one makes them unique.
 *
 * @param child The table that receives the foreign key.
 * @param parent The table it references; the same table for one that
 *               references itself.
 * @param kind What the relationship is.
 * @param tables Every table of the schema, for free names.
 *
 * @returns The change and the foreign key, or why there is none.
 */
export const relationshipChange = (
    child: IOutlineTable,
    parent: IOutlineTable,
    kind: IRelationshipKind,
    tables: readonly IOutlineTable[],
): RelationshipResult => {
    const parentKey = primaryKeyOf(parent);
    if (parentKey.length === 0) {
        return { error: `'${parent.name}' has no Primary Key. Please add a PK `
            + "or select another Table." };
    }
    const taken = child.columns.map((column) => { return column.name; });
    const columns: IOutlineColumn[] = parentKey.map((name) => {
        const referenced = parent.columns.find((column) => {
            return sameName(column.name, name);
        });
        const column: IOutlineColumn = {
            name: freeName(`${parent.name}_${name}`, taken),
            type: referencingType(referenced?.type ?? "INT"),
            nullable: false,
        };
        taken.push(column.name);

        return column;
    });
    const constraints = constraintNames(tables);
    const foreignKey: IOutlineForeignKey = {
        name: freeName(`fk_${child.name}_${parent.name}`, constraints),
        columns: columns.map((column) => { return column.name; }),
        references: { schema: null, table: parent.name, columns: parentKey },
    };
    constraints.push(foreignKey.name);
    const edits: IMsmSchemaEdit[] = columns.map((column) => {
        return { op: "add_column", table: child.name,
            column: columnEditMembers(column) };
    });
    const inverse: IMsmSchemaEdit[] = [{
        op: "drop_foreign_key", table: child.name, name: foreignKey.name,
    }];
    const oldKey = primaryKeyOf(child);
    if (kind.identifying) {
        edits.push({ op: "set_primary_key", table: child.name,
            columns: [...oldKey, ...foreignKey.columns] });
        inverse.push(oldKey.length === 0
            ? { op: "drop_index", table: child.name, kind: "primary" }
            : { op: "set_primary_key", table: child.name, columns: oldKey });
    }
    // 1:1: the foreign key's columns are unique, unless they are the
    // whole primary key already.
    if (!kind.many && !(kind.identifying && oldKey.length === 0)) {
        const unique = freeName(`${foreignKey.name}_UNIQUE`, constraints);
        edits.push({ op: "add_index", table: child.name, index: {
            name: unique, kind: "unique", columns: foreignKey.columns } });
        inverse.splice(1, 0, { op: "drop_index", table: child.name,
            name: unique });
    }
    edits.push({ op: "add_foreign_key", table: child.name,
        foreign_key: foreignKeyEditMembers(foreignKey) });
    inverse.push(...[...columns].reverse().map((column) => {
        return { op: "drop_column", table: child.name, column: column.name };
    }));

    return {
        change: {
            label: `Create Relationship between ${child.name} and `
                + `${parent.name}`,
            edits,
            inverse,
        },
        foreignKey,
    };
};

/** An n:m relationship worked out, or why there can be none. */
export type AssociativeResult =
    | { change: ISchemaChange; table: IOutlineTable }
    | { error: string };

/**
 * An n:m relationship: a table joining two others, with a foreign key to
 * each over columns copying their primary keys, all of them its own
 * primary key.
 *
 * @param first The first table picked.
 * @param second The second.
 * @param tables Every table of the schema, for free names.
 *
 * @returns The change and the new table, or why there is none.
 */
export const associativeTableChange = (
    first: IOutlineTable,
    second: IOutlineTable,
    tables: readonly IOutlineTable[],
): AssociativeResult => {
    for (const table of [first, second]) {
        if (primaryKeyOf(table).length === 0) {
            return { error: `'${table.name}' has no Primary Key. Please add a `
                + "PK or select another Table." };
        }
    }
    const name = freeName(`${first.name}_has_${second.name}`,
        tables.map((table) => { return table.name; }));
    const table: IOutlineTable = { name, columns: [], indexes: [],
        foreign_keys: [] };
    const constraints = constraintNames(tables);
    for (const parent of [first, second]) {
        const key = primaryKeyOf(parent);
        const columns = key.map((column) => {
            const referenced = parent.columns.find((candidate) => {
                return sameName(candidate.name, column);
            });

            return {
                name: freeName(`${parent.name}_${column}`,
                    table.columns.map((entry) => { return entry.name; })),
                type: referencingType(referenced?.type ?? "INT"),
                nullable: false,
            };
        });
        table.columns.push(...columns);
        const foreignKey: IOutlineForeignKey = {
            name: freeName(`fk_${name}_${parent.name}`, constraints),
            columns: columns.map((column) => { return column.name; }),
            references: { schema: null, table: parent.name, columns: key },
        };
        constraints.push(foreignKey.name);
        table.foreign_keys!.push(foreignKey);
    }
    table.indexes = [{ name: null, kind: "primary",
        columns: table.columns.map((column) => { return column.name; }) }];

    return {
        change: {
            label: `Create Relationship between ${first.name} and `
                + `${second.name}`,
            edits: [{ op: "add_table", table: tableEditMembers(table) }],
            inverse: [{ op: "drop_table", table: name }],
        },
        table,
    };
};

/**
 * A relationship over columns the tables have: a foreign key from the
 * columns picked in one table to those picked in the other, in order.
 *
 * @param child The table that receives the foreign key.
 * @param columns Its columns picked.
 * @param parent The table referenced.
 * @param referenced Its columns picked, as many.
 * @param tables Every table of the schema, for a free name.
 *
 * @returns The change and the foreign key.
 */
export const existingColumnsChange = (
    child: IOutlineTable,
    columns: readonly string[],
    parent: IOutlineTable,
    referenced: readonly string[],
    tables: readonly IOutlineTable[],
): { change: ISchemaChange; foreignKey: IOutlineForeignKey } => {
    const foreignKey: IOutlineForeignKey = {
        name: freeName(`fk_${child.name}_${parent.name}`,
            constraintNames(tables)),
        columns: [...columns],
        references: { schema: null, table: parent.name,
            columns: [...referenced] },
    };

    return {
        change: {
            label: `Create Relationship between ${child.name} and `
                + `${parent.name}`,
            edits: [{ op: "add_foreign_key", table: child.name,
                foreign_key: foreignKeyEditMembers(foreignKey) }],
            inverse: [{ op: "drop_foreign_key", table: child.name,
                name: foreignKey.name }],
        },
        foreignKey,
    };
};

/**
 * @param edit An edit.
 * @param member One of its members.
 *
 * @returns The member, as a string.
 */
const text = (edit: IMsmSchemaEdit, member: string): string => {
    return String(edit[member] ?? "");
};

/**
 * @param list Named objects.
 * @param name A name.
 *
 * @returns The list without the object of that name.
 */
const without = <T extends { name: string }>(list: T[], name: string): T[] => {
    return list.filter((entry) => { return !sameName(entry.name, name); });
};

/**
 * Works out what the snapshot derives of a table's foreign keys - whether
 * a parent can have many children, whether every row needs one - as msm
 * does, after its columns or keys changed.
 *
 * @param table The table.
 */
const deriveForeignKeys = (table: IOutlineTable): void => {
    for (const key of table.foreign_keys ?? []) {
        key.many = !uniquelyKeyed(table, key.columns);
        key.mandatory = true;
        key.referenced_mandatory = key.columns.every((name) => {
            const column = table.columns.find((entry) => {
                return sameName(entry.name, name);
            });

            return column?.nullable === false
                || primaryKeyColumns(table).has(name.toLowerCase());
        });
    }
};

/**
 * Makes edits to the snapshot's objects, as the SQL will have them once
 * msm made them: what the viewer shows meanwhile. Only the ops the tools
 * send are known; any other changes nothing.
 *
 * @param objects The snapshot's objects, changed in place.
 * @param edits The edits, in order.
 */
export const applyEdits = (
    objects: ISchemaObjectLists,
    edits: readonly IMsmSchemaEdit[],
): void => {
    const tableOf = (edit: IMsmSchemaEdit): IOutlineTable | undefined => {
        return objects.tables.find((table) => {
            return sameName(table.name, text(edit, "table"));
        });
    };
    for (const edit of edits) {
        const table = tableOf(edit);
        switch (edit.op) {
            case "add_table": {
                const added = structuredClone(edit.table) as IOutlineTable;
                added.indexes = (added.indexes ?? []).map((index) => {
                    return { ...index, name: index.name ?? null };
                });
                added.foreign_keys = (added.foreign_keys ?? []).map((key) => {
                    return { ...key, references: { ...key.references,
                        schema: key.references.schema ?? null } };
                });
                deriveForeignKeys(added);
                objects.tables.push(added);
                break;
            }

            case "drop_table": {
                objects.tables = without(objects.tables, text(edit, "table"));
                break;
            }

            case "add_column": {
                table?.columns.push(
                    structuredClone(edit.column) as IOutlineColumn);
                break;
            }

            case "drop_column": {
                if (table !== undefined) {
                    const column = text(edit, "column");
                    table.columns = without(table.columns, column);
                    // An index loses the column, and goes with its last.
                    table.indexes = (table.indexes ?? []).map((index) => {
                        return { ...index, columns: index.columns.filter(
                            (entry) => { return !sameName(entry, column); }) };
                    }).filter((index) => { return index.columns.length > 0; });
                    deriveForeignKeys(table);
                }
                break;
            }

            case "add_foreign_key": {
                if (table !== undefined) {
                    const key = structuredClone(edit.foreign_key) as IOutlineForeignKey;
                    key.references.schema ??= null;
                    table.foreign_keys = [...table.foreign_keys ?? [], key];
                    deriveForeignKeys(table);
                }
                break;
            }

            case "drop_foreign_key": {
                if (table !== undefined) {
                    table.foreign_keys = without(table.foreign_keys ?? [],
                        text(edit, "name"));
                }
                break;
            }

            case "set_primary_key": {
                if (table !== undefined) {
                    table.indexes = [
                        { name: null, kind: "primary",
                            columns: [...edit.columns as string[]] },
                        ...(table.indexes ?? []).filter((index) => {
                            return index.kind !== "primary";
                        }),
                    ];
                    deriveForeignKeys(table);
                }
                break;
            }

            case "add_index": {
                if (table !== undefined) {
                    const index = structuredClone(edit.index) as IOutlineIndex;
                    index.name ??= null;
                    table.indexes = [...table.indexes ?? [], index];
                    deriveForeignKeys(table);
                }
                break;
            }

            case "drop_index": {
                if (table !== undefined) {
                    table.indexes = (table.indexes ?? []).filter((index) => {
                        return edit.kind === "primary"
                            ? index.kind !== "primary"
                            : !sameName(index.name ?? undefined,
                                text(edit, "name"));
                    });
                    deriveForeignKeys(table);
                }
                break;
            }

            case "add_view": {
                const view = edit.view as { name: string; definition: string };
                objects.views.push({ name: view.name, columns: [],
                    definition: view.definition });
                break;
            }

            case "drop_view": {
                objects.views = without(objects.views, text(edit, "view"));
                break;
            }

            case "add_routine": {
                const routine = edit.routine as IOutlineRoutine;
                objects.routines.push({ name: routine.name,
                    kind: routine.kind, parameters: routine.parameters ?? [],
                    returns: routine.returns ?? null });
                break;
            }

            case "drop_routine": {
                objects.routines = without(objects.routines,
                    text(edit, "routine"));
                break;
            }

            default:
        }
    }
};
