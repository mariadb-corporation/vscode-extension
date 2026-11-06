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

/**
 * The changes the Object Details view makes to a table, as `mariadb-lsp
 * edit` ops (lsp-server `docs/edit-format.md`) with the ops that take them
 * back: what a diagram's history undoes, and what is applied to the
 * diagram's snapshot while msm makes them. Pure, shared by the extension
 * and the webviews.
 *
 * A column is sent whole: a member `modify_column` leaves out takes the
 * outline's default, so the column's comment would go with a type change.
 */

import type { IMsmSchemaEdit } from "../mcp/msmApi.js";
import type {
    IOutlineColumn,
    IOutlineForeignKey,
    IOutlineIndex,
    IOutlineTable,
} from "../modeler/modelFormat.js";

/** One change asked for in the view, to a table. */
export type TableDetailChange =
    | { kind: "renameTable"; name: string }
    | { kind: "setComment"; comment: string }
    | { kind: "renameColumn"; column: string; name: string }
    | { kind: "modifyColumn"; column: string; definition: IOutlineColumn }
    | { kind: "addColumn"; definition: IOutlineColumn }
    | { kind: "dropColumn"; column: string }
    | { kind: "setPrimaryKey"; columns: string[] }
    | { kind: "addIndex"; index: IOutlineIndex }
    | { kind: "dropIndex"; name: string }
    | { kind: "dropForeignKey"; name: string };

/** A change as edits, with the edits that take it back. */
export interface IDetailEdits {
    /** For the history: "Rename Column customer.name to title". */
    label: string;
    edits: IMsmSchemaEdit[];
    inverse: IMsmSchemaEdit[];
}

/**
 * @param column A column of the snapshot.
 *
 * @returns It as an edit's Column: the outline's members alone.
 */
export const columnDefinition = (column: IOutlineColumn): IOutlineColumn => {
    const definition: IOutlineColumn = { name: column.name, type: column.type };
    if (column.nullable !== undefined) {
        definition.nullable = column.nullable;
    }
    if (column.default !== undefined) {
        definition.default = column.default;
    }
    if (column.auto_increment !== undefined) {
        definition.auto_increment = column.auto_increment;
    }
    if (column.comment !== undefined) {
        definition.comment = column.comment;
    }

    return definition;
};

/**
 * @param key A foreign key of the snapshot.
 *
 * @returns It as an edit's ForeignKey: without what msm works out of it
 *          (`many`, `mandatory`), which lsp-server would refuse.
 */
const foreignKeyDefinition = (
    key: IOutlineForeignKey,
): Record<string, unknown> => {
    return {
        name: key.name,
        columns: key.columns,
        references: { table: key.references.table,
            columns: key.references.columns },
        ...(key.on_delete ? { on_delete: key.on_delete } : {}),
        ...(key.on_update ? { on_update: key.on_update } : {}),
    };
};

/**
 * @param index An index of the snapshot.
 *
 * @returns It as an edit's Index.
 */
const indexDefinition = (index: IOutlineIndex): Record<string, unknown> => {
    return { ...(index.name === null ? {} : { name: index.name }),
        kind: index.kind, columns: index.columns };
};

/**
 * @param table The table as the snapshot has it.
 *
 * @returns The columns of its primary key; none where it has none.
 */
const primaryKeyColumns = (table: IOutlineTable): string[] => {
    return table.indexes?.find((index) => {
        return index.kind === "primary";
    })?.columns ?? [];
};

/**
 * @param table The table as the snapshot has it.
 * @param columns Its primary key's columns; none drops the key.
 *
 * @returns The edit that makes it so.
 */
const primaryKeyEdit = (table: string, columns: string[]): IMsmSchemaEdit => {
    return columns.length === 0
        ? { op: "drop_index", table, kind: "primary" }
        : { op: "set_primary_key", table, columns };
};

/**
 * @param table The table as the snapshot has it.
 * @param change The change asked for.
 *
 * @returns The change's edits and their inverse; an error where the
 *          change does not fit the table (a column it has not).
 */
export const tableDetailEdits = (
    table: IOutlineTable,
    change: TableDetailChange,
): IDetailEdits | { error: string } => {
    const name = table.name;
    const column = (columnName: string): IOutlineColumn | undefined => {
        return table.columns.find((entry) => {
            return entry.name === columnName;
        });
    };

    switch (change.kind) {
        case "renameTable": {
            return {
                label: `Rename Table ${name} to ${change.name}`,
                edits: [{ op: "rename_table", table: name,
                    new_name: change.name }],
                inverse: [{ op: "rename_table", table: change.name,
                    new_name: name }],
            };
        }

        case "setComment": {
            const old = table.options?.comment;

            return {
                label: `Change the Comment of ${name}`,
                edits: [{ op: "set_table_options", table: name,
                    options: { comment: change.comment === ""
                        ? null : change.comment } }],
                inverse: [{ op: "set_table_options", table: name,
                    options: { comment: typeof old === "string" && old !== ""
                        ? old : null } }],
            };
        }

        case "renameColumn": {
            if (column(change.column) === undefined) {
                return { error: `${name} has no column ${change.column}.` };
            }

            return {
                label: `Rename Column ${name}.${change.column} to `
                    + change.name,
                edits: [{ op: "rename_column", table: name,
                    column: change.column, new_name: change.name }],
                inverse: [{ op: "rename_column", table: name,
                    column: change.name, new_name: change.column }],
            };
        }

        case "modifyColumn": {
            const old = column(change.column);
            if (old === undefined) {
                return { error: `${name} has no column ${change.column}.` };
            }

            return {
                label: `Change Column ${name}.${change.column}`,
                edits: [{ op: "modify_column", table: name,
                    column: change.column,
                    new_column: columnDefinition(change.definition) }],
                inverse: [{ op: "modify_column", table: name,
                    column: change.definition.name,
                    new_column: columnDefinition(old) }],
            };
        }

        case "addColumn": {
            return {
                label: `Add Column ${name}.${change.definition.name}`,
                edits: [{ op: "add_column", table: name,
                    column: columnDefinition(change.definition) }],
                inverse: [{ op: "drop_column", table: name,
                    column: change.definition.name }],
            };
        }

        case "dropColumn": {
            const index = table.columns.findIndex((entry) => {
                return entry.name === change.column;
            });
            if (index < 0) {
                return { error: `${name} has no column ${change.column}.` };
            }
            const before = table.columns[index - 1];

            return {
                label: `Drop Column ${name}.${change.column}`,
                edits: [{ op: "drop_column", table: name,
                    column: change.column }],
                // Back where it was.
                inverse: [{ op: "add_column", table: name,
                    column: columnDefinition(table.columns[index]),
                    ...(before === undefined
                        ? { first: true } : { after: before.name }) }],
            };
        }

        case "setPrimaryKey": {
            return {
                label: `Change the Primary Key of ${name}`,
                edits: [primaryKeyEdit(name, change.columns)],
                inverse: [primaryKeyEdit(name, primaryKeyColumns(table))],
            };
        }

        case "addIndex": {
            const indexName = change.index.name;
            if (indexName === null || indexName === "") {
                return { error: "An index needs a name." };
            }

            return {
                label: `Add Index ${name}.${indexName}`,
                edits: [{ op: "add_index", table: name,
                    index: indexDefinition(change.index) }],
                inverse: [{ op: "drop_index", table: name, name: indexName }],
            };
        }

        case "dropIndex": {
            const old = table.indexes?.find((index) => {
                return index.name === change.name;
            });
            if (old === undefined) {
                return { error: `${name} has no index ${change.name}.` };
            }

            return {
                label: `Drop Index ${name}.${change.name}`,
                edits: [{ op: "drop_index", table: name, name: change.name }],
                inverse: [{ op: "add_index", table: name,
                    index: indexDefinition(old) }],
            };
        }

        case "dropForeignKey": {
            const old = table.foreign_keys?.find((key) => {
                return key.name === change.name;
            });
            if (old === undefined) {
                return { error: `${name} has no foreign key ${change.name}.` };
            }

            return {
                label: `Drop Foreign Key ${name}.${change.name}`,
                edits: [{ op: "drop_foreign_key", table: name,
                    name: change.name }],
                inverse: [{ op: "add_foreign_key", table: name,
                    foreign_key: foreignKeyDefinition(old) }],
            };
        }

        default: {
            return { error: "The change is not known." };
        }
    }
};
