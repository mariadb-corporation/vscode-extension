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

import type {
    IOutlineForeignKey,
    IOutlineEvent,
    IOutlineRoutine,
    IOutlineSequence,
    IOutlineTable,
    IOutlineTrigger,
    IOutlineView,
    ISchemaModel,
} from "../../../src/modeler/modelFormat.js";
import type { ISchemaObjects } from "../../../src/modeler/modelerProtocol.js";
import type { IMsmSchemaEdit } from "../../../src/mcp/msmApi.js";
import { applyEdits, type ISchemaObjectLists } from "./schemaEdits.js";

/**
 * Where the diagrams' figures get their database objects from: the schema
 * snapshot msm makes from the CREATE statements. A figure names its table,
 * view or routines; what they look like is the catalog's business. Names
 * compare without regard to case, as the outline's do.
 */
export interface ISchemaCatalog {
    /**
     * @param name A table's name.
     *
     * @returns The table, or nothing where the snapshot has none of that
     *          name.
     */
    table(name: string): IOutlineTable | undefined;
    view(name: string): IOutlineView | undefined;
    routine(name: string): IOutlineRoutine | undefined;
    event(name: string): IOutlineEvent | undefined;
    sequence(name: string): IOutlineSequence | undefined;
    /** @returns The triggers on a table, in the snapshot's order. */
    triggersOf(table: string): IOutlineTrigger[];
    /** @returns Every table, view and routine, as the snapshot has them. */
    objects(): ISchemaObjectLists;
    /** @returns The snapshot's schema, where known. */
    schema?(): string;
    /**
     * Renames a table, here and in the other tables' foreign keys: what
     * the viewer shows at once, while msm makes the change in the SQL.
     *
     * @param name The table's name.
     * @param newName Its new name.
     */
    renameTable(name: string, newName: string): void;
    /**
     * Renames a column of a table, in its keys too.
     *
     * @param table The table.
     * @param name The column.
     * @param newName Its new name.
     */
    renameColumn(table: string, name: string, newName: string): void;
    /**
     * Takes the snapshot msm made after a schema edit, which is what the
     * SQL says.
     *
     * @param objects The snapshot's objects.
     */
    replace(objects: ISchemaObjects): void;
    /**
     * Makes schema edits, as the SQL will have them once msm made them:
     * what the viewer shows until msm sends its snapshot.
     *
     * @param edits The edits, in order.
     */
    edit(edits: readonly IMsmSchemaEdit[]): void;
}

/**
 * @param items Named objects.
 *
 * @returns Them by their lower-cased name.
 */
const byName = <T extends { name: string }>(items: T[]): Map<string, T> => {
    return new Map(items.map((item) => { return [item.name.toLowerCase(), item]; }));
};

/**
 * @param a A name.
 * @param b Another.
 *
 * @returns Whether they name the same object.
 */
export const sameName = (a: string | undefined, b: string | undefined): boolean => {
    return a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();
};

/**
 * The catalog of a model's snapshot, which it changes in place.
 *
 * @param model The model.
 *
 * @returns The catalog.
 */
export const catalogFromModel = (model: ISchemaModel): ISchemaCatalog => {
    let tables = byName(model.tables);
    let views = byName(model.views);
    let routines = byName(model.routines);
    let events = byName(model.events);
    let sequences = byName(model.sequences);
    const index = (): void => {
        tables = byName(model.tables);
        views = byName(model.views);
        routines = byName(model.routines);
        events = byName(model.events);
        sequences = byName(model.sequences);
    };

    return {
        table: (name) => { return tables.get(name.toLowerCase()); },
        view: (name) => { return views.get(name.toLowerCase()); },
        routine: (name) => { return routines.get(name.toLowerCase()); },
        event: (name) => { return events.get(name.toLowerCase()); },
        sequence: (name) => { return sequences.get(name.toLowerCase()); },
        triggersOf: (table) => {
            return model.triggers.filter((trigger) => {
                return sameName(trigger.table, table);
            });
        },
        objects: () => { return model; },
        schema: () => { return model.schema; },
        renameTable: (name, newName) => {
            const table = tables.get(name.toLowerCase());
            if (table === undefined || newName === name) {
                return;
            }
            tables.delete(name.toLowerCase());
            table.name = newName;
            tables.set(newName.toLowerCase(), table);
            // Its triggers, and the other tables' foreign keys, point at
            // it by name too.
            for (const trigger of model.triggers) {
                if (sameName(trigger.table, name)) {
                    trigger.table = newName;
                }
            }
            for (const other of model.tables) {
                for (const foreignKey of other.foreign_keys ?? []) {
                    if (sameName(foreignKey.references.table, name)) {
                        foreignKey.references.table = newName;
                    }
                }
            }
        },
        renameColumn: (tableName, name, newName) => {
            const table = tables.get(tableName.toLowerCase());
            const column = table?.columns.find((candidate) => {
                return sameName(candidate.name, name);
            });
            if (table === undefined || column === undefined) {
                return;
            }
            column.name = newName;
            const rename = (columns: string[]): string[] => {
                return columns.map((entry) => {
                    return sameName(entry, name) ? newName : entry;
                });
            };
            for (const index of table.indexes ?? []) {
                index.columns = rename(index.columns);
            }
            for (const foreignKey of table.foreign_keys ?? []) {
                foreignKey.columns = rename(foreignKey.columns);
            }
            for (const other of model.tables) {
                for (const foreignKey of other.foreign_keys ?? []) {
                    if (sameName(foreignKey.references.table, tableName)) {
                        foreignKey.references.columns = rename(
                            foreignKey.references.columns);
                    }
                }
            }
        },
        replace: (objects) => {
            model.tables = objects.tables;
            model.views = objects.views;
            model.routines = objects.routines;
            model.triggers = objects.triggers;
            model.events = objects.events;
            model.sequences = objects.sequences;
            if (objects.sourceHash !== undefined) {
                model.sourceHash = objects.sourceHash;
            }
            index();
        },
        edit: (edits) => {
            applyEdits(model, edits);
            index();
        },
    };
};

/**
 * @param table A table.
 *
 * @returns The lower-cased names of its primary key's columns.
 */
export const primaryKeyColumns = (table: IOutlineTable): Set<string> => {
    return new Set((table.indexes ?? []).filter((index) => {
        return index.kind === "primary";
    }).flatMap((index) => {
        return index.columns.map((column) => { return column.toLowerCase(); });
    }));
};

/**
 * @param table A table.
 * @param name The name of one of its foreign keys.
 *
 * @returns The foreign key.
 */
export const foreignKeyOf = (
    table: IOutlineTable | undefined,
    name: string,
): IOutlineForeignKey | undefined => {
    return table?.foreign_keys?.find((foreignKey) => {
        return sameName(foreignKey.name, name);
    });
};
