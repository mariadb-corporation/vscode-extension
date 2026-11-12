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

import { execFileSync } from "node:child_process";
import {
    mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MsmApi, type IMsmSchemaEditResult } from "../../mcp/msmApi.js";
import { createSdkConnector } from "../../mcp/sdkConnector.js";
import type { IMcpConnection } from "../../mcp/session.js";
import {
    documentOf, type ISchemaDefinition,
} from "../../modeler/modelFormat.js";
import { buildDocument } from "../../mrs/dataMapping.js";
import { objectDefaults, objectStatements } from "../../mrs/mrsDialogs.js";
import {
    outlineRestObject, outlineRestSchema, outlineRestService,
    type IOutlineRest,
} from "../../mrs/restOutline.js";
import { projectRestSource } from "../../msm/projectRestSource.js";
import { fillTemplate } from "../../msm/schemaObjects.js";
import { MCP_SERVER_ARGS } from "../../shell/constants.js";
import { LspEdit } from "../../tableEditor/lspEdit.js";

/**
 * A project's statements written by msm, not by the extension: what the
 * REST dialogs save goes to `msm.set_rest_statements`, Delete REST
 * Service, Schema or Object to `msm.drop_rest_object`, and a schema
 * object's filled template from its Add to `msm.set_schema_statements`.
 * msm places them; mariadb-lsp's outline reads back where they went.
 * Opt-in. Run with
 *
 *     MARIADB_SHELL_E2E=/path/to/mariadb-shell \
 *     MARIADB_LSP=/path/to/mariadb-lsp npx vitest run msmStatements.e2e
 *
 * The shell runs with a configuration home of its own, whose plugins are a
 * mariadb-shell-plugins checkout (MARIADB_SHELL_PLUGINS, else the one next
 * to this repository). MARIADB_LSP is a mariadb-lsp with `rest_statements`,
 * and the replace_* edit ops, set with `mcp setup --lspPath` for msm to
 * use: without it msm takes the one next to the shell, and refuses one
 * without them.
 */

const shell = process.env.MARIADB_SHELL_E2E;
const lspBinary = process.env.MARIADB_LSP;

const TABLES = `
CREATE TABLE IF NOT EXISTS \`customer\` (\`customer_id\` INT PRIMARY KEY,
    \`name\` VARCHAR(40));
CREATE TABLE IF NOT EXISTS \`orders\` (\`order_id\` INT PRIMARY KEY,
    \`placed_at\` DATETIME, \`customer_id\` INT);
`;

/** As the REST dialogs write them for a project. */
const SERVICE = "CREATE OR REPLACE REST SERVICE /svc COMMENT 'The shop';";
const SCHEMA = "CREATE OR REPLACE REST SCHEMA /shop ON SERVICE /svc "
    + "FROM `shop`;";
const ORDERS = "CREATE OR REPLACE REST VIEW /orders "
    + "ON SERVICE /svc SCHEMA /shop AS `shop`.`orders` CLASS `Order` {\n"
    + "    orderId: order_id @KEY,\n    placedAt: placed_at\n};";
const CUSTOMERS = "CREATE OR REPLACE REST VIEW /customers "
    + "ON SERVICE /svc SCHEMA /shop AS `shop`.`customer` CLASS `Customer` {\n"
    + "    customerId: customer_id @KEY,\n    name: name\n};";

describe.runIf(shell !== undefined && lspBinary !== undefined)(
    "a project's statements written by msm", () => {
        let home: string;
        let connection: IMcpConnection;
        let msm: MsmApi;
        let project: string;
        let script: string;
        let baseHash: string;
        const lsp = new LspEdit(() => { return Promise.resolve(lspBinary); });

        /** The snapshot's hash in an edit's rows, for the next edit. */
        const next = (result: IMsmSchemaEditResult): void => {
            const hash = documentOf(result.rows[0]!).source_hash;
            expect(typeof hash).toBe("string");
            baseHash = hash as string;
        };

        /** The project's schema snapshot, the first of its rows. */
        const snapshotOf = async (): Promise<Record<string, unknown>> => {
            const [row] = await msm.getSchemaDiagrams(project);
            expect(row?.format).toBe("msm-schema/1");

            return documentOf(row!);
        };

        const restOf = async (): Promise<IOutlineRest> => {
            return (await lsp.outline(script) as { rest: IOutlineRest }).rest;
        };

        beforeAll(async () => {
            home = mkdtempSync(join(tmpdir(), "msm_rest_e2e_"));
            const plugins = join(home, "plugins");
            mkdirSync(plugins, { recursive: true });
            const repo = resolve(process.env.MARIADB_SHELL_PLUGINS
                ?? join(__dirname, "../../../..", "mariadb-shell-plugins"));
            for (const plugin of ["mcp_plugin", "rest_plugin", "msm_plugin"]) {
                symlinkSync(join(repo, plugin), join(plugins, plugin));
            }
            // The mariadb-lsp msm uses, as the user sets it.
            execFileSync(shell!, ["--", "mcp", "setup",
                `--lspPath=${lspBinary!}`], { env: { ...process.env,
                MARIADB_SHELL_USER_CONFIG_HOME: home } });
            connection = await createSdkConnector().open({
                command: "/usr/bin/env",
                args: [`MARIADB_SHELL_USER_CONFIG_HOME=${home}`, shell!,
                    ...MCP_SERVER_ARGS],
            }, () => { /* the shell's log is not checked */ });
            msm = new MsmApi(connection);
            project = await msm.createProject({ schemaName: "shop",
                targetPath: join(home, "projects"), enforceTargetPath: true,
                copyrightHolder: "MariaDB plc", mcpAccess: true });
            // The tables, as a user writes them in Section 140.
            script = join(project, "development", "shop_next.sql");
            const text = readFileSync(script, "utf8");
            const end = text.indexOf("*/", text.indexOf("MSM Section 140")) + 2;
            writeFileSync(script, `${text.slice(0, end)}\n${TABLES}`
                + text.slice(end));
            await msm.updateSchemaDefinition(project);
            baseHash = (await snapshotOf()).source_hash as string;
        }, 120_000);

        afterAll(async () => {
            await connection?.close();
            rmSync(home, { recursive: true, force: true });
        });

        it("adds a service, its schema and two objects", async () => {
            const result = await msm.setRestStatements(project,
                [SERVICE, SCHEMA, ORDERS, CUSTOMERS], baseHash);
            next(result);
            expect(result.statements.map((statement) => {
                return [statement.kind, statement.object ?? statement.schema
                    ?? statement.service, statement.replaced];
            })).toEqual([["service", "/svc", false], ["schema", "/shop", false],
                ["view", "/orders", false], ["view", "/customers", false]]);
            expect(result.files).toContain(script);

            const text = readFileSync(script, "utf8");
            const section = text.slice(text.indexOf("MSM Section 180"));
            for (const path of ["SERVICE /svc", "SCHEMA /shop", "VIEW /orders",
                "VIEW /customers"]) {
                expect(section).toContain(`CREATE OR REPLACE REST ${path}`);
            }
            const rest = await restOf();
            expect(outlineRestService(rest, "/svc")?.comment).toBe("The shop");
            expect(outlineRestSchema(rest, "/svc", "/shop")).toBeDefined();
            expect(outlineRestObject(rest, "/svc", "/shop", "/customers"))
                .toBeDefined();
        }, 60_000);

        it("refuses an edit made against an older snapshot", async () => {
            const stale = "0".repeat(baseHash.length);
            await expect(msm.setRestStatements(project, [SERVICE], stale))
                .rejects.toThrow();
        }, 60_000);

        it("replaces an object where it stands with what its dialog saves",
            async () => {
                const rest = await restOf();
                const source = projectRestSource({
                    snapshot: async (): Promise<ISchemaDefinition> => {
                        return await snapshotOf() as unknown as ISchemaDefinition;
                    },
                    restSql: () => { return Promise.resolve(""); },
                    write: () => { return Promise.resolve(); },
                    drop: () => { return Promise.resolve(); },
                    restOutline: () => { return Promise.resolve(rest); },
                    saved: () => { /* nothing to draw */ },
                    failed: () => { /* nothing to show */ },
                });
                const stored = await source.object("VIEW", "/svc", "/shop",
                    "/orders");
                const columns = await source.columns("VIEW", "shop", "orders");
                const document = buildDocument("VIEW", "shop", "orders",
                    columns, stored.data_mappings ?? [], "Order");
                const values = { ...objectDefaults(stored, document, "/svc",
                    "/shop"), itemsPerPage: "7" };
                const statements = objectStatements(values, {
                    services: ["/svc"], schemas: { "/svc": ["/shop"] },
                    existingPath: "/orders", forScript: true,
                });
                const before = readFileSync(script, "utf8").split("\n")
                    .findIndex((line) => { return line.includes("VIEW /orders"); });

                const result = await msm.setRestStatements(project, statements,
                    baseHash);
                next(result);
                expect(result.statements).toEqual([expect.objectContaining({
                    kind: "view", object: "/orders", replaced: true,
                    line: before + 1 })]);
                const after = outlineRestObject(await restOf(), "/svc", "/shop",
                    "/orders");
                expect(after?.object.items_per_page).toBe(7);
            }, 60_000);

        it("renames an object in place of the old one", async () => {
            const result = await msm.setRestStatements(project,
                [ORDERS.replace("VIEW /orders", "VIEW /order")], baseHash,
                { kind: "object", service: "/svc", schema: "/shop",
                    object: "/orders" });
            next(result);
            expect(result.statements[0]).toMatchObject({ object: "/order",
                replaced: true });
            const rest = await restOf();
            expect(outlineRestObject(rest, "/svc", "/shop", "/orders"))
                .toBeUndefined();
            expect(outlineRestObject(rest, "/svc", "/shop", "/order"))
                .toBeDefined();
        }, 60_000);

        it("deletes an object, then the service with what is on it",
            async () => {
                const object = await msm.dropRestObject(project, { kind: "object",
                    service: "/svc", schema: "/shop", object: "/customers" },
                baseHash);
                next(object);
                expect(object.removed).toHaveLength(1);
                expect(outlineRestObject(await restOf(), "/svc", "/shop",
                    "/customers")).toBeUndefined();

                const service = await msm.dropRestObject(project,
                    { kind: "service", service: "/svc" }, baseHash);
                next(service);
                // The service, its schema and the object left on it.
                expect(service.removed).toHaveLength(3);
                const text = readFileSync(script, "utf8");
                expect(text).not.toMatch(/REST (SERVICE|SCHEMA|VIEW)/u);
                expect(text).not.toMatch(/DROP REST/u);
                expect(outlineRestService(await restOf(), "/svc"))
                    .toBeUndefined();
            }, 60_000);

        /** An Add of the MSM Projects view, with msm's own template. */
        const addFromTemplate = async (kind: "view" | "trigger", name: string,
            table?: string) => {
            const defaults = await msm.getObjectTemplates();
            const statement = fillTemplate(kind, defaults.templates[kind],
                defaults.placeholders[kind], { name, schema: "shop",
                    ...(table === undefined ? {} : { table }) });

            return await msm.setSchemaStatements(project, [statement],
                baseHash, [{ kind, name,
                    ...(table === undefined ? {} : { table }) }]);
        };

        it("adds a view and a trigger from msm's templates", async () => {
            const view = await addFromTemplate("view", "recent");
            next(view);
            const [added] = view.statements;
            expect(added).toMatchObject({ kind: "view", name: "recent",
                replaced: false });
            const lines = readFileSync(added!.file, "utf8").split("\n");
            expect(lines[added!.line - 1]).toMatch(/VIEW `recent`/u);

            const trigger = await addFromTemplate("trigger", "orders_bi",
                "orders");
            next(trigger);
            expect(trigger.statements[0]).toMatchObject({ kind: "trigger",
                name: "orders_bi", replaced: false });
            const outline = await lsp.outline(script) as {
                schemas: Array<{ views: Array<{ name: string }>;
                    triggers: Array<{ name: string; table: string }> }>;
            };
            expect(outline.schemas[0]!.views.map((v) => { return v.name; }))
                .toContain("recent");
            expect(outline.schemas[0]!.triggers).toContainEqual(
                expect.objectContaining({ name: "orders_bi" }));
        }, 60_000);

        it("refuses a template that creates something else, writing "
            + "nothing", async () => {
            const before = readFileSync(script, "utf8");
            await expect(msm.setSchemaStatements(project,
                ["CREATE TABLE `other` (id INT)"], baseHash,
                [{ kind: "view", name: "other" }])).rejects.toThrow(/Statement 1/u);
            expect(readFileSync(script, "utf8")).toBe(before);
        }, 60_000);

        it("replaces a view where it stands", async () => {
            const result = await msm.setSchemaStatements(project,
                ["CREATE VIEW `recent` AS SELECT 2 AS two"], baseHash,
                [{ kind: "view", name: "recent" }]);
            next(result);
            expect(result.statements[0]).toMatchObject({ kind: "view",
                name: "recent", replaced: true, changed: true });
            expect(readFileSync(script, "utf8")).toMatch(/SELECT 2 AS two/u);
        }, 60_000);
    });
