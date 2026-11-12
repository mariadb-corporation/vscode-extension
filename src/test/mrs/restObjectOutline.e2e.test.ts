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

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ISchemaDefinition } from "../../modeler/modelFormat.js";
import { buildDocument } from "../../mrs/dataMapping.js";
import {
    objectDefaults, objectStatements, schemaDefaults, schemaStatements,
    serviceDefaults, serviceStatements,
} from "../../mrs/mrsDialogs.js";
import {
    REST_OBJECT_DETAILS,
    REST_SETTINGS,
    outlineRestObject,
    outlineRestSchema,
    outlineRestService,
    type IOutlineRest,
    type IOutlineRestSchema,
    type IOutlineRestService,
} from "../../mrs/restOutline.js";
import { projectRestSource } from "../../msm/projectRestSource.js";
import { LspEdit } from "../../tableEditor/lspEdit.js";

/**
 * Edit REST Object, Service and Schema on a project's REST statements
 * against a real mariadb-lsp. Edit REST Object:
 * the object is read from its outline (`rest_object_details`), built into
 * the dialog's document, written back with the dialog's own statement
 * builder, and that statement parsed by mariadb-lsp again, which must
 * report what it reported before. The same for a service and a schema,
 * read with `rest_settings`. Opt-in. Run with
 *
 *     MARIADB_LSP=/path/to/mariadb-lsp npx vitest run restObjectOutline.e2e
 */

const lspBinary = process.env.MARIADB_LSP;

const SCHEMA = `CREATE DATABASE shop;
USE shop;
CREATE TABLE customer (customer_id INT PRIMARY KEY, name VARCHAR(40),
    email VARCHAR(80));
CREATE TABLE orders (order_id INT PRIMARY KEY, placed_at DATETIME,
    note TEXT, customer_id INT,
    FOREIGN KEY (customer_id) REFERENCES customer (customer_id));
CREATE PROCEDURE close_order(IN p_order INT, IN p_reason TEXT,
    OUT p_closed INT) BEGIN END;
CREATE OR REPLACE REST SERVICE /svc;
CREATE OR REPLACE REST SCHEMA /shop ON SERVICE /svc FROM \`shop\`;
`;

/** Written otherwise than the dialog writes it: any valid notation. */
const ORDERS = `create or replace rest view /orders
  on service /svc schema /shop as orders class \`Order\` @insert @delete {
    id : order_id @key @sortable, -- the key
    placedAt: placed_at @nofiltering JSON SCHEMA {'type': 'string'},
    customer: customer @unnest @update { name: name }
  }
  comment 'Orders' private items per page 10
  options {"cache": true};`;

const CLOSE = `CREATE OR REPLACE REST PROCEDURE /close
    ON SERVICE /svc SCHEMA /shop AS close_order
    PARAMETERS CloseParams { pOrder: p_order @IN, pClosed: p_closed @OUT }
    RESULT CloseResult { total: total @DATATYPE(INT) }
    MEDIA TYPE AUTODETECT;`;

describe.skipIf(lspBinary === undefined)("Edit REST Object with mariadb-lsp",
    () => {
        let folder = "";
        const lsp = new LspEdit(() => { return Promise.resolve(lspBinary); });

        /** The outline of a script, written to a file. */
        const outlineOf = async (sql: string): Promise<{
            rest: IOutlineRest;
            schemas: Array<ISchemaDefinition & { name: string }>;
        }> => {
            const file = path.join(folder, "dev.sql");
            await writeFile(file, sql);

            return await lsp.outline(file) as {
                rest: IOutlineRest;
                schemas: Array<ISchemaDefinition & { name: string }>;
            };
        };

        /** The project source over a script, as the extension makes it. */
        const sourceOf = async (sql: string) => {
            const outline = await outlineOf(sql);
            const snapshot: ISchemaDefinition = {
                ...outline.schemas[0]!, format: "msm-schema/1",
                schema: outline.schemas[0]!.name,
            };

            return projectRestSource({
                snapshot: () => { return Promise.resolve(snapshot); },
                restSql: () => { return Promise.resolve(sql); },
                write: () => { return Promise.resolve(); },
                drop: () => { return Promise.resolve(); },
                restOutline: () => { return Promise.resolve(outline.rest); },
                saved: () => { /* nothing to draw */ },
                failed: () => { /* nothing to show */ },
            });
        };

        beforeAll(async () => {
            folder = await mkdtemp(path.join(tmpdir(), "rest-outline-"));
        });

        afterAll(async () => {
            await rm(folder, { recursive: true, force: true });
        });

        it("reports REST object details", async () => {
            expect(await lsp.outlineFeatures()).toContain(REST_OBJECT_DETAILS);
        });

        /** Skips a test where the binary has no `rest_settings` yet. */
        const needsSettings = async (skip: (note: string) => void) => {
            if (!(await lsp.outlineFeatures()).includes(REST_SETTINGS)) {
                skip(`${lspBinary} has no ${REST_SETTINGS}`);
            }
        };

        for (const [objectType, path_, statement, dbObject] of [
            ["VIEW", "/orders", ORDERS, "orders"],
            ["PROCEDURE", "/close", CLOSE, "close_order"],
        ] as const) {
            it(`reads ${path_} and writes back what mariadb-lsp reads the same`,
                async () => {
                    const sql = `${SCHEMA}${statement}\n`;
                    const source = await sourceOf(sql);
                    const stored = await source.object(objectType, "/svc",
                        "/shop", path_);
                    const columns = await source.columns(objectType, "shop",
                        dbObject);
                    const document = buildDocument(objectType, "shop",
                        dbObject, columns, stored.data_mappings ?? [], "X");
                    const values = objectDefaults(stored, document, "/svc",
                        "/shop");
                    // Saved as the dialog saves it, unchanged.
                    const [rewritten] = objectStatements(values, {
                        services: ["/svc"], schemas: { "/svc": ["/shop"] },
                        existingPath: path_, forScript: true,
                    });

                    const before = outlineRestObject(
                        (await outlineOf(sql)).rest, "/svc", "/shop", path_)!;
                    const after = outlineRestObject(
                        (await outlineOf(`${SCHEMA}${rewritten}\n`)).rest,
                        "/svc", "/shop", path_)!;

                    // What the dialog writes out explicitly (the defaults,
                    // the routine's parameter not listed) is all it adds.
                    const keep = (object: typeof before.object) => {
                        return {
                            class: object.class,
                            crud: object.crud.filter((word) => {
                                return !word.startsWith("NO");
                            }),
                            fields: object.fields,
                            results: object.results,
                            // Unwritten is the default, which the dialog
                            // writes out.
                            enabled: object.enabled ?? "ENABLED",
                            items_per_page: object.items_per_page,
                            comment: object.comment ?? "",
                            media_type_autodetect:
                                object.media_type_autodetect,
                            options: object.options ?? {},
                        };
                    };
                    expect(after.dbSchema).toBe(before.dbSchema);
                    expect(keep(after.object)).toEqual({
                        ...keep(before.object),
                        // Listed in the written order of the columns.
                        fields: after.object.fields,
                    });
                    expect(after.object.fields?.map((field) => {
                        return [field.name, field.column];
                    })).toEqual(before.object.fields?.map((field) => {
                        return [field.name, field.column];
                    }));
                    expect(after.object.parameters?.fields.map((field) => {
                        return [field.name, field.options];
                    })).toEqual(before.object.parameters?.fields.map((field) => {
                        return [field.name, field.options];
                    }));
                });
        }

        /** What a service's statement says, as the outline reads it. */
        const serviceSettings = (service: IOutlineRestService) => {
            return {
                request_path: service.request_path,
                developers: service.developers,
                enabled: service.enabled ?? true,
                published: service.published ?? false,
                protocol: service.protocol ?? "HTTPS",
                comment: service.comment ?? "",
                auth_path: service.auth_path ?? "",
                auth_redirection: service.auth_redirection ?? "",
                auth_validation: service.auth_validation ?? "",
                auth_page_content: service.auth_page_content ?? "",
                options: service.options ?? null,
                metadata: service.metadata ?? null,
                auth_apps: service.auth_apps?.map((app) => {
                    return app.name;
                }),
            };
        };

        /** Written otherwise than the dialog writes it. */
        const SERVICE = `CREATE DATABASE shop;
create or replace rest service mike, \`anna\`@/svc disabled published
  protocol http comment 'The shop'
  authentication path '/auth' redirection '/done' validation '^/d'
    page content 'Hi'
  options {"cache": true} add auth app 'MRS' add auth app 'Other';
CREATE OR REPLACE REST SCHEMA /shop ON SERVICE anna,mike@/svc FROM \`shop\`
  private authentication required items per page 7 comment 'S'
  options {"b": [1, 2]};
`;

        for (const servicePath of ["mike, `anna`@/svc", "anna,mike@/svc"]) {
            it(`reads the service ${servicePath} and writes back what `
                + "mariadb-lsp reads the same", async ({ skip }) => {
                await needsSettings(skip);
                const source = await sourceOf(SERVICE);
                const stored = await source.service(servicePath);
                const linked = await source.authApps(servicePath);
                expect(stored.full_service_path).toBe("anna,mike@/svc");
                expect(linked).toEqual(["MRS", "Other"]);

                const values = serviceDefaults(stored, linked, linked);
                const [rewritten] = serviceStatements(values, {
                    allAuthApps: linked, linkedAuthApps: linked,
                    existingPath: stored.full_service_path, forScript: true,
                });

                const before = outlineRestService(
                    (await outlineOf(SERVICE)).rest, servicePath)!;
                const after = outlineRestService(
                    (await outlineOf(`${rewritten}\n`)).rest,
                    stored.full_service_path)!;
                expect(serviceSettings(before)).toMatchObject({
                    enabled: false, published: true, protocol: "HTTP",
                    auth_validation: "^/d", options: { cache: true },
                });
                expect(serviceSettings(after)).toEqual(
                    serviceSettings(before));
            });
        }

        it("unlinks an auth app the service dialog unticks", async ({ skip }) => {
            await needsSettings(skip);
            const source = await sourceOf(SERVICE);
            const stored = await source.service("anna,mike@/svc");
            const linked = await source.authApps("anna,mike@/svc");
            const values = {
                ...serviceDefaults(stored, linked, linked), authApps: ["MRS"],
            };
            const [rewritten] = serviceStatements(values, {
                allAuthApps: linked, linkedAuthApps: linked,
                existingPath: stored.full_service_path, forScript: true,
            });

            // After the original, as Section 180 keeps it: the old links
            // are there before it runs again.
            const after = outlineRestService((await outlineOf(
                `${SERVICE}${rewritten}\n`)).rest, "anna,mike@/svc")!;
            expect(after.auth_apps?.map((app) => {
                return app.name;
            })).toEqual(["MRS"]);
        });

        /** What a schema's statement says, as the outline reads it. */
        const schemaSettings = (schema: IOutlineRestSchema) => {
            return {
                schema: schema.schema,
                enabled: schema.enabled ?? "ENABLED",
                requires_auth: schema.requires_auth ?? false,
                items_per_page: schema.items_per_page ?? null,
                comment: schema.comment ?? "",
                options: schema.options ?? null,
                metadata: schema.metadata ?? null,
            };
        };

        it("reads a schema and writes back what mariadb-lsp reads the same",
            async ({ skip }) => {
                await needsSettings(skip);
                const source = await sourceOf(SERVICE);
                const service = await source.service("anna,mike@/svc");
                const stored = await source.schema("anna,mike@/svc", "/shop");
                const values = schemaDefaults([service], stored,
                    stored.name, service.full_service_path);
                const [rewritten] = schemaStatements(values, {
                    services: [service.full_service_path],
                    existingPath: stored.request_path,
                    existingService: service.full_service_path,
                    forScript: true,
                });

                const before = outlineRestSchema(
                    (await outlineOf(SERVICE)).rest, "anna,mike@/svc",
                    "/shop")!;
                const after = outlineRestSchema((await outlineOf(
                    `CREATE DATABASE shop;\n`
                    + "CREATE OR REPLACE REST SERVICE anna,mike@/svc;\n"
                    + `${rewritten}\n`)).rest, "anna,mike@/svc", "/shop")!;
                expect(schemaSettings(before)).toMatchObject({
                    enabled: "PRIVATE", requires_auth: true,
                    items_per_page: 7, options: { b: [1, 2] },
                });
                expect(schemaSettings(after)).toEqual(schemaSettings(before));
            });
    });
