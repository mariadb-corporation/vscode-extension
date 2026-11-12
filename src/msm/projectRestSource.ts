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

import type { IMsmRestItem } from "../mcp/msmApi.js";
import type {
    IOutlineRoutine,
    IOutlineTable,
    ISchemaDefinition,
} from "../modeler/modelFormat.js";
import type { IDbObject } from "../mrs/mrsDialogs.js";
import { outlineDetails } from "../details/objectDetails.js";
import type { ObjectType } from "../mcp/types.js";
import type { IObjectPlace } from "../mrs/dataMapping.js";
import {
    outlineRestObject,
    outlineRestSchema,
    outlineRestService,
    REST_SETTINGS,
    storedSchema,
    storedService,
    REST_OBJECT_DETAILS,
    storedMappings,
    storedObject,
    type IOutlineRest,
} from "../mrs/restOutline.js";
import {
    objectEntries,
    objectOf,
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

/** A project as a source of the REST dialogs, which can drop its items. */
export interface IProjectRestSource extends IRestSource {
    /**
     * Removes a REST service, schema or object from the project's MSM
     * Section 180, with what is on it.
     *
     * @param item The item, by its paths.
     */
    drop(item: IMsmRestItem): Promise<void>;
}

/** What the source needs of the project. */
export interface IProjectRestHost extends Pick<IRestSource, "saved" | "failed"> {
    /** msm's snapshot of the development script, made where there is none. */
    snapshot(): Promise<ISchemaDefinition | undefined>;
    /** The REST SQL of the development script: its MSM Section 180. */
    restSql(): Promise<string>;
    /**
     * Has msm put statements into that section, where it keeps them.
     *
     * @param statements One CREATE of a REST item each.
     * @param replaces The REST object a statement of another path stands
     *        in for: one renamed in its dialog.
     */
    write(statements: string[], replaces?: IObjectPlace): Promise<void>;
    /**
     * Has msm remove a REST item from that section, with what is on it.
     *
     * @param item The item.
     */
    drop(item: IMsmRestItem): Promise<void>;
    /**
     * mariadb-lsp's outline of the development script, its `rest` member:
     * undefined where the binary's outline lacks the feature.
     *
     * @param feature What the outline has to report: `rest_object_details`
     *        or `rest_settings`.
     */
    restOutline(feature: string): Promise<IOutlineRest | undefined>;
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
 *          none. A VIEW, as a REST object's type asks for one, is a table
 *          where the snapshot has no view of the name: a REST VIEW serves
 *          either, which a server tells apart itself.
 *
 * @throws Error where the snapshot has no such object.
 */
export const snapshotColumns = (
    definition: ISchemaDefinition,
    objectType: string,
    name: string,
): IMrsColumns => {
    const base = { schema: definition.schema, name };
    const type = objectType.toLowerCase() as ObjectType;
    const found = outlineDetails(definition, { type, name })
        ?? (type === "view"
            ? outlineDetails(definition, { type: "table", name }) : undefined);

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
 * @param item A service, schema or object the outline reports, if it does.
 * @param what What it is, to say it is not there.
 * @param path Its path, to say which.
 *
 * @returns It, where the dialog can edit it.
 *
 * @throws Error where the script has none, its OPTIONS are a patch, or
 *         it is a routine written with FORCE.
 */
const editable = <T extends { merge_options?: boolean; force?: boolean }>(
    item: T | undefined,
    what: string,
    path: string,
): T => {
    if (item === undefined) {
        throw new Error(`The project's development script creates no `
            + `${what}.`);
    }
    if (item.merge_options === true) {
        throw new Error(`${path} has MERGE OPTIONS, which the dialog cannot `
            + "keep. Edit its statement in the development script.");
    }
    // A routine's FORCE: the dialog's statement does not write it.
    if (item.force === true) {
        throw new Error(`${path} has FORCE, which the dialog cannot keep. `
            + "Edit its statement in the development script.");
    }

    return item;
};

/**
 * @param host What the source needs of the project.
 *
 * @returns The project as a source of the REST dialogs.
 */
export const projectRestSource = (
    host: IProjectRestHost,
): IProjectRestSource => {
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
    // A dialog lists the services, then each one's schemas, and reads
    // the outline for a service and its auth apps: each is read once,
    // until something is written to the script.
    const reads = new Map<string, Promise<unknown>>();
    const cached = <T>(key: string, load: () => Promise<T>): Promise<T> => {
        let reading = reads.get(key) as Promise<T> | undefined;
        if (reading === undefined) {
            const loading = load();
            // A failed read is tried again; a later one is not dropped.
            loading.catch(() => {
                if (reads.get(key) === loading) {
                    reads.delete(key);
                }
            });
            reads.set(key, loading);
            reading = loading;
        }

        return reading;
    };
    const entries = (): Promise<IRestScriptEntry[]> => {
        return cached("script", async () => {
            return parseRestScript(await host.restSql());
        });
    };
    const restOutline = (feature: string): Promise<IOutlineRest | undefined> => {
        return cached(`outline:${feature}`, () => {
            return host.restOutline(feature);
        });
    };

    /**
     * @param feature What the outline has to report.
     * @param what What is edited, to say what needs it.
     *
     * @returns mariadb-lsp's outline of the script, its `rest` member.
     */
    const outline = async (
        feature: string,
        what: string,
    ): Promise<IOutlineRest> => {
        const rest = await restOutline(feature);
        if (rest === undefined) {
            throw new Error(`Editing a ${what} of an MSM project needs a `
                + "mariadb-lsp whose outline reports it "
                + `(${feature}). Update the MariaDB Shell, or edit the `
                + "statement in the development script.");
        }

        return rest;
    };
    return {
        forScript: true,
        // A script links what a server will have: the built-in apps; which
        // of them a service is linked to, mariadb-lsp's outline says.
        // (none where it does not report them).
        authApps: async (servicePath) => {
            if (servicePath === undefined) {
                return [...BUILT_IN_AUTH_APPS];
            }
            const rest = await restOutline(REST_SETTINGS);
            const found = outlineRestService(rest, servicePath);

            return found === undefined ? [] : storedService(found).auth_apps ?? [];
        },
        services: async () => {
            return serviceEntries(await entries()).map(serviceOf);
        },
        schemas: async (servicePath) => {
            return schemaEntries(await entries(), servicePath).map(schemaOf);
        },
        service: async (servicePath) => {
            return storedService(editable(outlineRestService(
                await outline(REST_SETTINGS, "REST service"), servicePath),
            `REST service ${servicePath}`, servicePath));
        },
        schema: async (servicePath, schemaPath) => {
            return storedSchema(servicePath, editable(outlineRestSchema(
                await outline(REST_SETTINGS, "REST schema"), servicePath,
                schemaPath), `REST schema ${servicePath}${schemaPath}`,
            schemaPath));
        },
        // Read from mariadb-lsp's outline of the script: this extension
        // parses no SQL itself.
        object: async (objectType, servicePath, schemaPath, requestPath) => {
            const rest = await outline(REST_OBJECT_DETAILS, "REST object");
            const found = outlineRestObject(rest, servicePath, schemaPath,
                requestPath);
            const details = editable(found?.object,
                `REST object ${servicePath}${schemaPath}${requestPath}`,
                requestPath);
            const dbSchema = found!.dbSchema;
            const mappings = await storedMappings(objectType, dbSchema,
                details, async (type, schema, name) => {
                    return snapshotColumns(await definition(schema), type, name);
                });

            return storedObject(details, servicePath, schemaPath, dbSchema,
                mappings);
        },
        objects: async (servicePath, schemaPath) => {
            return objectEntries(await entries(), servicePath, schemaPath)
                .map(objectOf);
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
        run: async (statements, replaces) => {
            reads.clear();
            await host.write(statements, replaces);
        },
        drop: async (item) => {
            reads.clear();
            await host.drop(item);
        },
        saved: host.saved,
        failed: host.failed,
    };
};
