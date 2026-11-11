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
    IOutlineRoutine,
    IOutlineTable,
    ISchemaDefinition,
} from "../modeler/modelFormat.js";
import type { IDbObject } from "../mrs/mrsDialogs.js";
import { outlineDetails } from "../details/objectDetails.js";
import type { ObjectType } from "../mcp/types.js";
import {
    parseRestScript,
    schemaEntries,
    schemaOf,
    serviceEntries,
    serviceOf,
    type IRestScriptEntry,
} from "../mrs/restScript.js";
import type { IRestSource } from "../mrs/restSource.js";
import type {
    IMrsColumns,
    IMrsRoutineParameter,
    IMrsTableColumn,
} from "../mrs/mrsTypes.js";
import { counted } from "../text.js";

/**
 * An MSM project as the REST dialogs' source: its REST services and
 * schemas are those its development script creates in MSM Section 180,
 * its database objects those of msm's schema snapshot, and what a dialog
 * saves is written to that section. Free of `vscode`.
 */

/**
 * The auth apps every REST metadata comes with, which a project's services
 * can be linked to without the project creating them.
 */
export const BUILT_IN_AUTH_APPS = ["MariaDB", "MRS"];

/** What the source needs of the project. */
export interface IProjectRestHost extends Pick<IRestSource, "saved" | "failed"> {
    /** msm's snapshot of the development script, made where there is none. */
    snapshot(): Promise<ISchemaDefinition | undefined>;
    /** The REST SQL of the development script: its MSM Section 180. */
    restSql(): Promise<string>;
    /** Puts statements into that section. */
    write(statements: string[]): Promise<void>;
}

/**
 * @param routine A routine of the snapshot.
 *
 * @returns Whether it is a function; one without a kind is a procedure.
 */
const isFunction = (routine: IOutlineRoutine): boolean => {
    return routine.kind === "function";
};

/**
 * @param definition The snapshot.
 *
 * @returns Its tables, views, procedures and functions as the REST Objects
 *          tab lists a live schema's, with what the snapshot knows of each.
 */
export const snapshotDbObjects = (
    definition: ISchemaDefinition,
): IDbObject[] => {
    const details = (...parts: Array<string | undefined>): string => {
        return parts.filter((part) => {
            return part !== undefined && part !== "";
        }).join(", ");
    };
    const routines = (functions: boolean): IDbObject[] => {
        return (definition.routines ?? []).filter((routine) => {
            return isFunction(routine) === functions;
        }).map((routine) => {
            const parameters = (routine.parameters ?? []).map((parameter) => {
                return [parameter.mode, parameter.name, parameter.type]
                    .filter(Boolean).join(" ");
            }).join(", ");

            return {
                name: routine.name,
                type: functions ? "FUNCTION" : "PROCEDURE",
                details: `(${parameters})` + (functions && routine.returns
                    ? ` RETURNS ${routine.returns}` : ""),
            };
        });
    };

    return [
        ...definition.tables.map((table): IDbObject => {
            const engine = table.options?.engine;

            return {
                name: table.name,
                type: "TABLE",
                details: details(typeof engine === "string" ? engine : undefined,
                    counted(table.columns.length, "column"),
                    table.options?.comment),
            };
        }),
        ...(definition.views ?? []).map((view): IDbObject => {
            return {
                name: view.name,
                type: "VIEW",
                details: details((view.columns ?? []).length === 0
                    ? undefined : counted(view.columns!.length, "column")),
            };
        }),
        ...routines(false),
        ...routines(true),
    ];
};

/**
 * @param definition The snapshot.
 * @param table One of its tables.
 *
 * @returns Its columns, then its relationships as `SHOW REST COLUMNS`
 *          reports a live table's: the tables its foreign keys refer to,
 *          and the tables whose foreign keys refer to it.
 */
const tableColumns = (
    definition: ISchemaDefinition,
    table: IOutlineTable,
): IMrsTableColumn[] => {
    const indexes = table.indexes ?? [];
    const primary = indexes.find((index) => { return index.kind === "primary"; })
        ?.columns ?? [];
    const unique = indexes.filter((index) => {
        return (index.kind === "unique" || index.kind === "primary")
            && index.columns.length === 1;
    }).map((index) => { return index.columns[0]!; });
    const columns: IMrsTableColumn[] = table.columns.map((column, index) => {
        return {
            position: index + 1,
            name: column.name,
            db_column: {
                name: column.name,
                datatype: column.type.toLowerCase(),
                not_null: column.nullable === false
                    || primary.includes(column.name),
                is_primary: primary.includes(column.name),
                is_unique: unique.includes(column.name),
                is_generated: column.generated !== undefined
                    && column.generated !== null,
                id_generation: column.auto_increment === true
                    ? "auto_inc" : null,
                comment: column.comment ?? null,
            },
            reference_mapping: null,
        };
    });
    const reference = (
        name: string,
        mapping: NonNullable<IMrsTableColumn["reference_mapping"]>,
    ): void => {
        columns.push({
            position: columns.length + 1, name, db_column: null,
            reference_mapping: mapping,
        });
    };
    const sameSchema = (schema: string | null): boolean => {
        return schema === null || schema === definition.schema;
    };

    for (const key of table.foreign_keys ?? []) {
        reference(key.references.table, {
            kind: key.many === false ? "1:1" : "n:1",
            constraint: key.name,
            to_many: false,
            referenced_schema: key.references.schema ?? definition.schema,
            referenced_table: key.references.table,
            column_mapping: key.columns.map((base, index) => {
                return { base, ref: key.references.columns[index] ?? base };
            }),
        });
    }
    for (const other of definition.tables) {
        for (const key of other.foreign_keys ?? []) {
            if (key.references.table !== table.name
                || !sameSchema(key.references.schema)) {
                continue;
            }
            reference(other.name, {
                kind: key.many === false ? "1:1" : "1:n",
                constraint: key.name,
                to_many: key.many !== false,
                referenced_schema: definition.schema,
                referenced_table: other.name,
                column_mapping: key.columns.map((ref, index) => {
                    return { base: key.references.columns[index] ?? ref, ref };
                }),
            });
        }
    }

    return columns;
};

/**
 * @param definition The snapshot.
 * @param objectType TABLE, VIEW, PROCEDURE or FUNCTION.
 * @param name The object.
 *
 * @returns What `SHOW REST COLUMNS` reports of a live object, from the
 *          snapshot. A view's columns are those its statement names: the
 *          snapshot has no others, and a view without a column list has
 *          none.
 *
 * @throws Error where the snapshot has no such object.
 */
export const snapshotColumns = (
    definition: ISchemaDefinition,
    objectType: string,
    name: string,
): IMrsColumns => {
    const base = { schema: definition.schema, name };
    const found = outlineDetails(definition,
        { type: objectType.toLowerCase() as ObjectType, name });

    switch (found?.type) {
        case "procedure":
        case "function": {
            const { routine } = found;
            const parameters: IMrsRoutineParameter[] = (routine.parameters
                ?? []).map((parameter, index) => {
                const mode = (parameter.mode ?? "IN").toUpperCase();

                return {
                    position: index + 1,
                    name: parameter.name,
                    mode: mode === "OUT" || mode === "INOUT" ? mode : "IN",
                    datatype: (parameter.type ?? "text").toLowerCase(),
                };
            });

            return {
                ...base, type: objectType as "PROCEDURE" | "FUNCTION",
                parameters,
                ...(routine.returns
                    ? { return_type: routine.returns.toLowerCase() } : {}),
            };
        }

        case "view": {
            return {
                ...base, type: "VIEW",
                columns: (found.view.columns ?? []).map((column, index) => {
                    return {
                        position: index + 1, name: column,
                        db_column: { name: column }, reference_mapping: null,
                    };
                }),
            };
        }

        case "table": {
            return { ...base, type: "TABLE",
                columns: tableColumns(definition, found.table) };
        }

        default: {
            throw new Error(`The project's schema has no `
                + `${objectType.toLowerCase()} \`${name}\`. Update Schema `
                + "Snapshot reads the development script again.");
        }
    }
};

/**
 * @param host What the source needs of the project.
 *
 * @returns The project as a source of the REST dialogs.
 */
export const projectRestSource = (host: IProjectRestHost): IRestSource => {
    const definition = async (schema: string): Promise<ISchemaDefinition> => {
        const snapshot = await host.snapshot();
        if (snapshot === undefined) {
            throw new Error("The project has no schema snapshot to read its "
                + "objects from.");
        }
        // A reference into another schema leads out of the project.
        if (schema !== snapshot.schema) {
            throw new Error(`\`${schema}\` is not the project's schema, `
                + `\`${snapshot.schema}\`, so its objects are not known.`);
        }

        return snapshot;
    };
    // A dialog lists the services, then each one's schemas: the section
    // is read once, until something is written to it.
    let read: Promise<IRestScriptEntry[]> | undefined;
    const entries = (): Promise<IRestScriptEntry[]> => {
        read ??= host.restSql().then(parseRestScript);
        read.catch(() => { read = undefined; });

        return read;
    };

    return {
        forScript: true,
        // A script links what a server will have: the built-in apps. Which
        // of them a service is linked to is not read back from it.
        authApps: (servicePath) => {
            return Promise.resolve(servicePath === undefined
                ? [...BUILT_IN_AUTH_APPS] : []);
        },
        services: async () => {
            return serviceEntries(await entries()).map(serviceOf);
        },
        schemas: async (servicePath) => {
            return schemaEntries(await entries(), servicePath).map(schemaOf);
        },
        object: () => {
            return Promise.reject(new Error("A project's REST objects are "
                + "edited in its development script."));
        },
        dbObjects: async (dbSchema) => {
            return snapshotDbObjects(await definition(dbSchema));
        },
        columns: async (objectType, schema, name) => {
            return snapshotColumns(await definition(schema), objectType, name);
        },
        // The snapshot once for all of them: a project without one would
        // have msm make it for each.
        columnsOfEach: async (objects) => {
            const schemas = new Map<string, Promise<ISchemaDefinition>>();
            for (const object of objects) {
                if (!schemas.has(object.schema)) {
                    schemas.set(object.schema, definition(object.schema));
                }
            }

            return await Promise.all(objects.map(async (object) => {
                return snapshotColumns(await schemas.get(object.schema)!,
                    object.objectType, object.name);
            }));
        },
        run: async (statements) => {
            read = undefined;
            await host.write(statements);
        },
        saved: host.saved,
        failed: host.failed,
    };
};
