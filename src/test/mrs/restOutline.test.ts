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
    buildDocument,
    loadReference,
    type IMappingDocument,
    type IMappingField,
} from "../../mrs/dataMapping.js";
import {
    ENABLED_STATE,
    type IMrsColumns,
    type IMrsReferenceMapping,
    type IMrsTableColumn,
} from "../../mrs/mrsTypes.js";
import {
    outlineRestObject,
    outlineRestSchema,
    outlineRestService,
    storedMappings,
    storedObject,
    storedSchema,
    storedService,
    type IOutlineRestField,
    type IOutlineRestObject,
} from "../../mrs/restOutline.js";

const column = (
    name: string,
    extra: Partial<IMrsTableColumn["db_column"]> = {},
): IMrsTableColumn => {
    return { position: 0, name, db_column: { name, ...extra },
        reference_mapping: null };
};

const reference = (name: string, table: string,
    base: string, ref: string): IMrsTableColumn => {
    const mapping: IMrsReferenceMapping = {
        kind: "n:1", to_many: false, referenced_schema: "shop",
        referenced_table: table, column_mapping: [{ base, ref }],
    };

    return { position: 0, name, db_column: null, reference_mapping: mapping };
};

const TABLES: Record<string, IMrsColumns> = {
    orders: {
        schema: "shop", name: "orders", type: "TABLE",
        columns: [
            column("order_id", { is_primary: true }),
            column("placed_at"),
            column("note"),
            reference("customer", "customer", "customer_id", "customer_id"),
        ],
    },
    customer: {
        schema: "shop", name: "customer", type: "TABLE",
        columns: [
            column("customer_id", { is_primary: true }),
            column("name"),
            column("email"),
        ],
    },
};

const PROCEDURE: IMrsColumns = {
    schema: "shop", name: "close_order", type: "PROCEDURE",
    parameters: [
        { position: 1, name: "p_order", mode: "IN", datatype: "int" },
        { position: 2, name: "p_reason", mode: "IN", datatype: "text" },
        { position: 3, name: "p_closed", mode: "OUT", datatype: "int" },
    ],
};

const columnsOf = (type: string, schema: string,
    name: string): Promise<IMrsColumns> => {
    const found = type === "PROCEDURE" ? PROCEDURE
        // A VIEW is a table where there is no view, as snapshotColumns has
        // it.
        : type === "TABLE" || type === "VIEW" ? TABLES[name] : undefined;

    return found === undefined
        ? Promise.reject(new Error(`no ${schema}.${name}`))
        : Promise.resolve(found);
};

/** A column's field as mariadb-lsp's outline reports it. */
const field = (
    name: string,
    column: string,
    ...options: string[]
): IOutlineRestField => {
    return { name, column, reference: null, options, datatype: null,
        json_schema: null };
};

/** A REST object as mariadb-lsp's outline reports it. */
const outlined = (
    kind: string,
    path: string,
    name: string,
    extra: Partial<IOutlineRestObject> = {},
): IOutlineRestObject => {
    return {
        kind, path, object_schema: null, object_name: name, class: null,
        crud: [], fields: null, parameters: null, results: [],
        enabled: null, requires_auth: null, items_per_page: null,
        comment: null, media_type: null, media_type_autodetect: false,
        format: null, auth_procedure: null, options: null,
        merge_options: false, metadata: null, force: false, ...extra,
    };
};

/** What a level of fields says, for comparing a document built. */
const shape = (fields: IMappingField[]): unknown[] => {
    return fields.map((entry) => {
        return {
            name: entry.name,
            enabled: entry.enabled,
            sorting: entry.allowSorting,
            filtering: entry.allowFiltering,
            noUpdate: entry.noUpdate,
            key: entry.isKey,
            owner: entry.rowOwnership,
            ...(entry.reference === undefined ? {} : {
                unnest: entry.reference.unnest,
                crud: entry.reference.crud,
                children: shape(entry.reference.children),
            }),
        };
    });
};

/**
 * Builds the editor's document of an object as the dialog does, its
 * references loaded.
 */
const documentOf = async (
    objectType: string,
    object: IOutlineRestObject,
): Promise<IMappingDocument> => {
    const mappings = await storedMappings(objectType, "shop", object,
        columnsOf);
    const dbObject = object.object_name;
    const columns = await columnsOf(objectType === "VIEW" ? "TABLE"
        : objectType, "shop", dbObject);
    const document = buildDocument(objectType, "shop", dbObject, columns,
        mappings, "Ignored");
    const stored = mappings.flatMap((mapping) => { return mapping.fields; });
    const fields = await Promise.all(document.fields.map(async (entry) => {
        if (entry.reference === undefined || !entry.enabled) {
            return entry;
        }
        const referenced = await columnsOf("TABLE", "shop",
            entry.reference.mapping.referenced_table);

        return loadReference(entry, referenced.columns ?? [], stored,
            [`shop.${dbObject}`]);
    }));

    return { ...document, fields };
};

describe("storedMappings", () => {
    it("builds a view's mappings, the columns its block leaves out off and "
        + "its reference joined on the foreign key", async () => {
        const document = await documentOf("VIEW", outlined("view", "/orders",
            "orders", {
                class: "Order",
                crud: ["INSERT", "DELETE"],
                fields: [
                    field("id", "order_id", "SORTABLE", "KEY"),
                    field("placedAt", "placed_at", "NOFILTERING", "NOUPDATE",
                        "ROWOWNERSHIP"),
                    { ...field("customer", ""), column: null,
                        options: ["UNNEST", "NOINSERT", "UPDATE", "NODELETE"],
                        reference: { schema: "shop", table: "customer",
                            fields: [field("customerId", "customer_id"),
                                field("name", "name")] } },
                ],
            }));

        expect(document.className).toBe("Order");
        expect(document.crud).toEqual({ insert: true, update: false,
            delete: true, noCheck: false });
        const join = document.fields[3]!.reference!.mapping;
        expect(join.column_mapping).toEqual([{ base: "customer_id",
            ref: "customer_id" }]);
        expect(shape(document.fields)).toEqual([
            { name: "id", enabled: true, sorting: true, filtering: true,
                noUpdate: false, key: true, owner: false },
            { name: "placedAt", enabled: true, sorting: false,
                filtering: false, noUpdate: true, key: false, owner: true },
            { name: "note", enabled: false, sorting: false, filtering: true,
                noUpdate: false, key: false, owner: false },
            { name: "customer", enabled: true, sorting: false,
                filtering: true, noUpdate: false, key: false, owner: false,
                unnest: true,
                crud: { insert: false, update: true, delete: false,
                    noCheck: false },
                children: [
                    expect.objectContaining({ name: "customerId",
                        enabled: true }),
                    expect.objectContaining({ name: "name", enabled: true }),
                    expect.objectContaining({ name: "email",
                        enabled: false }),
                ] },
        ]);
    });

    it("builds a procedure's parameters and results", async () => {
        const document = await documentOf("PROCEDURE", outlined("procedure",
            "/close", "close_order", {
                parameters: { name: "CloseParams", fields: [
                    field("pOrder", "p_order", "IN"),
                    field("pClosed", "p_closed", "OUT")] },
                results: [{ name: "CloseResult", fields: [
                    { ...field("total", "total"), datatype: "int" }] }],
            }));

        expect(document.parameters!.name).toBe("CloseParams");
        expect(document.parameters!.fields.map((entry) => {
            return [entry.name, entry.enabled];
        })).toEqual([["pOrder", true], ["pReason", false],
            ["pClosed", true]]);
        expect(document.results!.map((result) => {
            return [result.name, result.fields.map((entry) => {
                return [entry.name, entry.column?.datatype];
            })];
        })).toEqual([["CloseResult", [["total", "int"]]]]);
    });

    it("leaves a view without a block to the server's default", async () => {
        expect(await storedMappings("VIEW", "shop",
            outlined("view", "/orders", "orders"), columnsOf)).toEqual([]);
    });

    it("keeps a block as reported where the columns cannot be read",
        async () => {
            const [mapping] = await storedMappings("VIEW", "shop",
                outlined("view", "/x", "gone", { class: "X",
                    fields: [field("a", "a", "KEY")] }), columnsOf);
            expect(mapping!.fields.map((entry) => {
                return [entry.name, entry.db_column, entry.enabled];
            })).toEqual([["a", { name: "a", is_primary: true }, true]]);
        });
});

describe("storedObject", () => {
    it("carries the outline's settings, the unwritten at their defaults",
        () => {
            const object = storedObject(outlined("view", "/o", "orders", {
                items_per_page: 7, format: "MEDIA", media_type: "image/png",
                options: { a: 1 }, enabled: "DISABLED" }), "/svc", "/shop",
            "shop", []);
            expect(object).toMatchObject({ id: "object:/svc:/shop:/o",
                rest_schema_id: "schema:/svc:/shop", name: "orders",
                schema_name: "shop", object_type: "VIEW", items_per_page: 7,
                format: "MEDIA", media_type: "image/png", options: { a: 1 },
                metadata: null, enabled: ENABLED_STATE.disabled,
                requires_auth: false, comments: null, data_mappings: [] });
            expect(storedObject(outlined("view", "/o", "orders"), "/svc",
                "/shop", "shop", [])).toMatchObject({
                format: "FEED", enabled: ENABLED_STATE.enabled });
        });
});

describe("outlineRestObject", () => {
    it("finds an object by its paths, whatever their case, and its "
        + "database schema", () => {
        const object = outlined("view", "/orders", "orders");
        const rest = { services: [{ path: "/svc", schemas: [{ path: "/shop",
            schema: "shop", objects: [object, { ...object, path: "/other",
                object_schema: "sales" }] }] }] };
        // Its database schema: its own where it names one, else its REST
        // schema's.
        expect(outlineRestObject(rest, "/SVC", "/Shop", "/ORDERS"))
            .toEqual({ object, dbSchema: "shop" });
        expect(outlineRestObject(rest, "/svc", "/shop", "/other")?.dbSchema)
            .toBe("sales");
        expect(outlineRestObject(rest, "/svc", "/shop", "/gone"))
            .toBeUndefined();
        expect(outlineRestObject(undefined, "/svc", "/shop", "/orders"))
            .toBeUndefined();
    });
});

describe("storedService and storedSchema", () => {
    const rest = { services: [{
        path: "mike, `anna`@/svc", request_path: "/svc",
        developers: ["anna", "mike"], enabled: false, published: null,
        protocol: "HTTP" as const, comment: null, auth_path: "/login",
        auth_redirection: null, auth_validation: null,
        auth_page_content: null, options: { a: 1 }, merge_options: false,
        metadata: null, auth_apps: [{ name: "MRS" }],
        schemas: [{ path: "/shop", schema: "shop", enabled: "PRIVATE" as const,
            requires_auth: null, items_per_page: 30, comment: "Shop",
            options: null, merge_options: false, metadata: { m: 1 } }],
    }] };

    it("builds a service as a server reports it, its developers in its "
        + "path", () => {
        const service = outlineRestService(rest, "MIKE, `ANNA`@/SVC")!;
        expect(storedService(service)).toMatchObject({
            full_service_path: "anna,mike@/svc", url_context_root: "/svc",
            developers: ["anna", "mike"], url_protocol: ["HTTP"],
            enabled: 0, published: false, comments: null,
            auth_path: "/login", options: { a: 1 }, auth_apps: ["MRS"] });
    });

    it("finds a service by the path the dialog edits too", () => {
        expect(outlineRestService(rest, "Anna,Mike@/svc")).toBe(
            rest.services[0]);
        expect(outlineRestService(rest, "anna@/svc")).toBeUndefined();
    });

    it("builds a REST schema as a server reports it", () => {
        const schema = outlineRestSchema(rest, "mike, `anna`@/svc", "/SHOP")!;
        expect(storedSchema("anna,mike@/svc", schema)).toMatchObject({
            name: "shop", request_path: "/shop",
            enabled: ENABLED_STATE.private, requires_auth: false,
            items_per_page: 30, comments: "Shop", metadata: { m: 1 } });
        expect(outlineRestSchema(rest, "/svc", "/shop")).toBeUndefined();
    });
});
