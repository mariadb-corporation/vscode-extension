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

import { camelCase } from "./dataMapping.js";
import { restObjectIds, restSchemaIds, restServiceId } from "./restScript.js";
import { samePath, servicePathParts } from "./restSql.js";
import {
    ENABLED_STATE,
    type IMrsColumns,
    type IMrsDataMapping,
    type IMrsDataMappingField,
    type IMrsDataMappingOptions,
    type IMrsObject,
    type IMrsReferenceMapping,
    type IMrsSchema,
    type IMrsService,
    type JsonObject,
} from "./mrsTypes.js";

/**
 * A REST object of a project as the REST Object dialog edits it. A server
 * reports its objects with `SHOW CREATE REST VIEW ... FORMAT=JSON`; a
 * project has only the statement in its MSM Section 180, whose parse is
 * mariadb-lsp's (its outline's REST object details, `rest_object_details`:
 * this extension parses no SQL itself). This builds the server's shape
 * from those details. Free of `vscode`.
 */

// --- mariadb-lsp's outline (lsp-server `docs/outline-format.md`) --------

/** The feature of mariadb-lsp's outline that reports REST objects' details. */
export const REST_OBJECT_DETAILS = "rest_object_details";

/** A field of a REST object's block, as the outline reports it. */
export interface IOutlineRestField {
    /** The JSON key. */
    name: string;
    /** The column or parameter it is of; null for a reference. */
    column: string | null;
    /** A reference: the table it joins, and its own block. */
    reference: { schema: string | null; table: string;
        fields: IOutlineRestField[]; } | null;
    /** Its `@` options, upper-case without `@`, as written; no DATATYPE. */
    options: string[];
    /** `@DATATYPE(...)`: a routine result's column type. */
    datatype: string | null;
    json_schema: JsonObject | null;
}

/** A routine's PARAMETERS or one of its RESULTs, as the outline has it. */
export interface IOutlineRestMapping {
    name: string | null;
    fields: IOutlineRestField[];
}

/** A REST object of the outline's `rest` member, its details with it. */
export interface IOutlineRestObject {
    kind: string;
    path: string;
    /** The database object, unquoted: its schema where it names one. */
    object_schema: string | null;
    object_name: string;
    /** A view's `CLASS`. */
    class: string | null;
    /** A view's own `@INSERT`, `@UPDATE`, `@DELETE` and `@NOCHECK`. */
    crud: string[];
    /** A view's block; null where it has none (the server's default). */
    fields: IOutlineRestField[] | null;
    parameters: IOutlineRestMapping | null;
    results: IOutlineRestMapping[];
    enabled: "ENABLED" | "DISABLED" | "PRIVATE" | null;
    requires_auth: boolean | null;
    items_per_page: number | null;
    comment: string | null;
    media_type: string | null;
    media_type_autodetect: boolean;
    format: "FEED" | "ITEM" | "MEDIA" | null;
    auth_procedure: string | null;
    options: JsonObject | null;
    /** The OPTIONS were written MERGE OPTIONS: a patch, not the whole. */
    merge_options: boolean;
    metadata: JsonObject | null;
    /** A routine's FORCE, which a server does not store. */
    force: boolean;
}

/** The feature of mariadb-lsp's outline that reports services' and schemas' settings. */
export const REST_SETTINGS = "rest_settings";

/** A REST schema of the outline's `rest` member. */
export interface IOutlineRestSchema {
    path: string;
    /** The database schema it exposes; null where only named. */
    schema?: string | null;
    objects?: IOutlineRestObject[];
    // With `rest_settings`, null where not written:
    enabled?: "ENABLED" | "DISABLED" | "PRIVATE" | null;
    requires_auth?: boolean | null;
    items_per_page?: number | null;
    comment?: string | null;
    options?: JsonObject | null;
    merge_options?: boolean;
    metadata?: JsonObject | null;
}

/** A REST service of the outline's `rest` member. */
export interface IOutlineRestService {
    /** `[devs@]/path`, as written, blanks collapsed. */
    path: string;
    /** With `rest_settings`: its request path, `/svc`. */
    request_path?: string;
    /** With `rest_settings`: its developers, unquoted, sorted. */
    developers?: string[];
    schemas?: IOutlineRestSchema[];
    /** The names of the auth apps linked to it. */
    auth_apps?: Array<{ name: string }>;
    // With `rest_settings`, null where not written:
    enabled?: boolean | null;
    published?: boolean | null;
    protocol?: "HTTP" | "HTTPS" | null;
    comment?: string | null;
    auth_path?: string | null;
    auth_redirection?: string | null;
    auth_validation?: string | null;
    auth_page_content?: string | null;
    options?: JsonObject | null;
    merge_options?: boolean;
    metadata?: JsonObject | null;
}

/** The outline's `rest` member, as far as the REST dialogs go. */
export interface IOutlineRest {
    services?: IOutlineRestService[];
}

/**
 * @param service A REST service as mariadb-lsp's outline reports it.
 *
 * @returns Its `[devs@]/path` as the dialog edits it: built from its
 *          developers and request path (`rest_settings`), else as its
 *          first statement wrote it.
 */
const dialogPath = (service: IOutlineRestService): string => {
    if (service.request_path === undefined) {
        return service.path;
    }
    const developers = service.developers ?? [];

    return developers.length === 0 ? service.request_path
        : `${developers.join(",")}@${service.request_path}`;
};

/**
 * @param rest The outline's `rest` member.
 * @param servicePath A REST service, as its first statement wrote it or as
 *        the dialog edits it.
 *
 * @returns It, its path compared as on the server.
 */
export const outlineRestService = (
    rest: IOutlineRest | undefined,
    servicePath: string,
): IOutlineRestService | undefined => {
    return rest?.services?.find((service) => {
        return samePath(service.path, servicePath)
            || samePath(dialogPath(service), servicePath);
    });
};

/**
 * @param rest The outline's `rest` member.
 * @param servicePath A REST service.
 * @param schemaPath One of its REST schemas.
 *
 * @returns That schema, paths compared as on the server.
 */
export const outlineRestSchema = (
    rest: IOutlineRest | undefined,
    servicePath: string,
    schemaPath: string,
): IOutlineRestSchema | undefined => {
    return outlineRestService(rest, servicePath)?.schemas?.find((schema) => {
        return samePath(schema.path, schemaPath);
    });
};

/**
 * @param service A REST service as mariadb-lsp's outline reports it
 *        (`rest_settings`).
 *
 * @returns It as `SHOW REST SERVICES FORMAT=JSON` reports it, what its
 *          statements do not write at the server's defaults.
 */
export const storedService = (service: IOutlineRestService): IMrsService => {
    const path = service.request_path
        ?? servicePathParts(service.path).path;
    const developers = service.developers ?? [];
    const fullPath = dialogPath(service);

    return {
        id: restServiceId(fullPath),
        url_context_root: path,
        full_service_path: fullPath,
        url_protocol: service.protocol === null
            || service.protocol === undefined ? null : [service.protocol],
        name: path,
        developers,
        enabled: service.enabled === false ? 0 : 1,
        published: service.published === true,
        comments: service.comment ?? null,
        options: service.options ?? null,
        metadata: service.metadata ?? null,
        auth_path: service.auth_path ?? null,
        auth_completed_url: service.auth_redirection ?? null,
        auth_completed_url_validation: service.auth_validation ?? null,
        auth_completed_page_content: service.auth_page_content ?? null,
        in_development: null,
        auth_apps: (service.auth_apps ?? []).map((app) => { return app.name; }),
    };
};

/**
 * @param servicePath The REST service it is on.
 * @param schema A REST schema as mariadb-lsp's outline reports it
 *        (`rest_settings`).
 *
 * @returns It as `SHOW REST SCHEMAS FORMAT=JSON` reports it, what its
 *          statements do not write at the server's defaults.
 */
export const storedSchema = (
    servicePath: string,
    schema: IOutlineRestSchema,
): IMrsSchema => {
    return {
        ...restSchemaIds(servicePath, schema.path),
        name: schema.schema ?? "",
        schema_type: "DATABASE_SCHEMA",
        request_path: schema.path,
        requires_auth: schema.requires_auth ?? false,
        enabled: ENABLED_STATES[schema.enabled ?? "ENABLED"],
        items_per_page: schema.items_per_page ?? null,
        comments: schema.comment ?? null,
        options: schema.options ?? null,
        metadata: schema.metadata ?? null,
    };
};

/**
 * @param rest The outline's `rest` member.
 * @param servicePath A REST service.
 * @param schemaPath One of its REST schemas.
 * @param requestPath One of its objects.
 *
 * @returns That object, and the database schema it is of - its own, else
 *          its REST schema's - paths compared as on the server; undefined
 *          where the outline has none.
 */
export const outlineRestObject = (
    rest: IOutlineRest | undefined,
    servicePath: string,
    schemaPath: string,
    requestPath: string,
): { object: IOutlineRestObject; dbSchema: string } | undefined => {
    const schema = outlineRestSchema(rest, servicePath, schemaPath);
    const object = schema?.objects?.find((candidate) => {
        return samePath(candidate.path, requestPath);
    });

    return object === undefined ? undefined
        : { object, dbSchema: object.object_schema ?? schema?.schema ?? "" };
};

/** The outline's ENABLED keywords as a server stores them. */
const ENABLED_STATES: Record<"ENABLED" | "DISABLED" | "PRIVATE",
    IMrsObject["enabled"]> = {
    ENABLED: ENABLED_STATE.enabled,
    DISABLED: ENABLED_STATE.disabled,
    PRIVATE: ENABLED_STATE.private,
};

/**
 * @param options A mapping's or a reference's `@` options.
 *
 * @returns Its CRUD flags as a server stores them in its options.
 */
const crudOptions = (options: readonly string[]): IMrsDataMappingOptions => {
    return {
        dataMappingViewInsert: options.includes("INSERT"),
        dataMappingViewUpdate: options.includes("UPDATE"),
        dataMappingViewDelete: options.includes("DELETE"),
        dataMappingViewNoCheck: options.includes("NOCHECK"),
    };
};

/**
 * @param field A field as the outline reports it.
 *
 * @returns What its `@` options and JSON schema say, as a server stores a
 *          field: on, with its flags.
 */
const fieldFlags = (field: IOutlineRestField): Pick<IMrsDataMappingField,
    "enabled" | "allow_filtering" | "allow_sorting" | "no_check" | "no_update"
    | "json_schema"> => {
    return {
        enabled: true,
        allow_filtering: !field.options.includes("NOFILTERING"),
        allow_sorting: field.options.includes("SORTABLE"),
        no_check: field.options.includes("NOCHECK"),
        no_update: field.options.includes("NOUPDATE"),
        ...(field.json_schema === null ? {} : { json_schema: field.json_schema }),
    };
};

/** Reads a database object's columns, as `IRestSource.columns` does. */
export type ColumnsReader = (objectType: string, schema: string,
    name: string) => Promise<IMrsColumns>;

/**
 * Builds the stored data mappings of a REST object, as `SHOW CREATE REST
 * VIEW ... FORMAT=JSON` reports a live object's: the fields flat, each
 * below a reference naming it. A block lists the fields a mapping has, so
 * the columns it leaves out are stored disabled (the editor enables a
 * column it knows nothing of); a reference's join is the foreign key of
 * the table holding it that leads to the table it names, read with the
 * columns (where two do, the one whose field name it has).
 *
 * @param objectType The REST object's: VIEW, PROCEDURE or FUNCTION.
 * @param dbSchema The database schema of what it serves.
 * @param object The object as mariadb-lsp's outline reports it.
 * @param columnsOf Reads a database object's columns; one it cannot read
 *        leaves the block as reported.
 *
 * @returns The mappings.
 */
export const storedMappings = async (
    objectType: string,
    dbSchema: string,
    object: IOutlineRestObject,
    columnsOf: ColumnsReader,
): Promise<IMrsDataMapping[]> => {
    let count = 0;
    const id = (prefix: string): string => {
        count += 1;

        return `${prefix}${String(count)}`;
    };
    const columnsOrNone = async (type: string, schema: string,
        name: string): Promise<IMrsColumns | undefined> => {
        try {
            return await columnsOf(type, schema, name);
        } catch {
            return undefined;
        }
    };
    const columnOf = (field: IOutlineRestField): string => {
        return field.column ?? field.name;
    };

    /** A level of a table or view's block, and what is below it. */
    const level = async (
        fields: IOutlineRestField[],
        schema: string,
        columns: IMrsColumns | undefined,
        parentReferenceId: string | null,
        out: IMrsDataMappingField[],
    ): Promise<string | null> => {
        // @KEY names the keys; without one, the primary key is.
        const keyed = fields.some((field) => {
            return field.options.includes("KEY");
        });
        const taken = new Set<IMrsReferenceMapping>();
        let rowOwnership: string | null = null;
        for (const [position, field] of fields.entries()) {
            const base = { id: id("f"), parent_reference_id: parentReferenceId,
                name: field.name, position, ...fieldFlags(field) };
            if (field.options.includes("ROWOWNERSHIP")) {
                rowOwnership = base.id;
            }
            const reference = field.reference;
            if (reference === null) {
                out.push({ ...base, represents_reference_id: null,
                    db_column: {
                        name: columnOf(field),
                        ...(keyed
                            ? { is_primary: field.options.includes("KEY") }
                            : {}),
                        ...(field.datatype === null
                            ? {} : { datatype: field.datatype }),
                    }, data_mapping_reference: null });
                continue;
            }
            const refSchema = reference.schema ?? schema;
            const candidates = (columns?.columns ?? []).filter((column) => {
                const mapping = column.reference_mapping;

                return mapping !== null && !taken.has(mapping)
                    && samePath(mapping.referenced_table, reference.table)
                    && samePath(mapping.referenced_schema, refSchema);
            });
            const column = candidates.find((candidate) => {
                return camelCase(candidate.name) === field.name;
            }) ?? candidates[0];
            const mapping: IMrsReferenceMapping = column?.reference_mapping
                ?? { kind: "n:1", to_many: false, referenced_schema: refSchema,
                    referenced_table: reference.table, column_mapping: [] };
            taken.add(mapping);
            const referenceId = id("r");
            const referenceField: IMrsDataMappingField = { ...base,
                represents_reference_id: referenceId, db_column: null,
                data_mapping_reference: {
                    id: referenceId,
                    reduce_to_value_of_field_id: null,
                    row_ownership_field_id: null,
                    reference_mapping: mapping,
                    unnest: field.options.includes("UNNEST"),
                    options: crudOptions(field.options),
                } };
            out.push(referenceField);
            const referenced = await columnsOrNone("TABLE",
                mapping.referenced_schema, mapping.referenced_table);
            referenceField.data_mapping_reference!.row_ownership_field_id
                = await level(reference.fields, mapping.referenced_schema,
                    referenced, referenceId, out);
        }
        // The columns the block leaves out: off, after this level's own.
        let next = fields.length;
        for (const column of columns?.columns ?? []) {
            if (column.db_column === null || fields.some((field) => {
                return field.reference === null
                    && samePath(columnOf(field), column.name);
            })) {
                continue;
            }
            out.push(disabled(id("f"), parentReferenceId, column.name,
                next));
            next += 1;
        }

        return rowOwnership;
    };

    if (objectType !== "PROCEDURE" && objectType !== "FUNCTION") {
        if (object.fields === null) {
            return [];
        }
        // A REST view serves a table or a view (`snapshotColumns`).
        const columns = await columnsOrNone("VIEW", dbSchema,
            object.object_name);
        const fields: IMrsDataMappingField[] = [];
        const rowOwnership = await level(object.fields, dbSchema, columns,
            null, fields);

        return [{
            id: id("m"),
            name: object.class ?? "",
            kind: "RESULT",
            position: 0,
            row_ownership_field_id: rowOwnership,
            options: crudOptions(object.crud),
            fields,
        }];
    }

    const mappings: IMrsDataMapping[] = [];
    if (object.parameters !== null) {
        const columns = await columnsOrNone(objectType, dbSchema,
            object.object_name);
        const listed = object.parameters.fields;
        const fields = listed.map((field, position) => {
            return plain(id("f"), field, position);
        });
        for (const parameter of columns?.parameters ?? []) {
            if (!listed.some((field) => {
                return samePath(columnOf(field), parameter.name);
            })) {
                fields.push(disabled(id("f"), null, parameter.name,
                    fields.length));
            }
        }
        mappings.push({ id: id("m"), name: object.parameters.name ?? "",
            kind: "PARAMETERS", position: 0, row_ownership_field_id: null,
            options: null, fields });
    }
    object.results.forEach((result, index) => {
        mappings.push({ id: id("m"), name: result.name ?? "", kind: "RESULT",
            position: index + 1, row_ownership_field_id: null, options: null,
            fields: result.fields.map((field, position) => {
                return plain(id("f"), field, position);
            }) });
    });

    return mappings;
};

/**
 * @param id Its id.
 * @param field A routine's parameter or result column, as reported.
 * @param position Its place.
 *
 * @returns It, stored.
 */
const plain = (
    id: string,
    field: IOutlineRestField,
    position: number,
): IMrsDataMappingField => {
    const inOut = field.options.includes("INOUT");

    return {
        id,
        parent_reference_id: null,
        represents_reference_id: null,
        name: field.name,
        position,
        db_column: {
            name: field.column ?? field.name,
            ...(field.datatype === null ? {} : { datatype: field.datatype }),
            ...(inOut || field.options.includes("IN") ? { in: true } : {}),
            ...(inOut || field.options.includes("OUT") ? { out: true } : {}),
        },
        ...fieldFlags(field),
        data_mapping_reference: null,
    };
};

/**
 * @param id Its id.
 * @param parentReferenceId The reference it is below, if any.
 * @param column The column or parameter.
 * @param position Its place.
 *
 * @returns A field a block leaves out, stored disabled.
 */
const disabled = (
    id: string,
    parentReferenceId: string | null,
    column: string,
    position: number,
): IMrsDataMappingField => {
    return {
        id,
        parent_reference_id: parentReferenceId,
        represents_reference_id: null,
        name: camelCase(column) || column,
        position,
        db_column: { name: column },
        enabled: false,
        allow_filtering: true,
        allow_sorting: false,
        no_check: false,
        no_update: false,
        data_mapping_reference: null,
    };
};

/**
 * @param object A REST object as mariadb-lsp's outline reports it.
 * @param servicePath Its REST service.
 * @param schemaPath Its REST schema.
 * @param dbSchema The database schema of what it serves.
 * @param mappings Its stored data mappings (`storedMappings`).
 *
 * @returns It as `SHOW CREATE REST ... FORMAT=JSON` reports it, what its
 *          statement does not write at the server's defaults.
 */
export const storedObject = (
    object: IOutlineRestObject,
    servicePath: string,
    schemaPath: string,
    dbSchema: string,
    mappings: IMrsDataMapping[],
): IMrsObject => {
    return {
        ...restObjectIds(servicePath, schemaPath, object.path),
        name: object.object_name,
        schema_name: dbSchema,
        request_path: object.path,
        object_type: object.kind.toUpperCase() as IMrsObject["object_type"],
        crud_operations: [],
        enabled: ENABLED_STATES[object.enabled ?? "ENABLED"],
        requires_auth: object.requires_auth ?? false,
        comments: object.comment,
        format: object.format ?? "FEED",
        items_per_page: object.items_per_page,
        media_type: object.media_type,
        auto_detect_media_type: object.media_type_autodetect,
        auth_stored_procedure: object.auth_procedure,
        options: object.options,
        metadata: object.metadata,
        data_mappings: mappings,
    };
};
