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

import type { ISchemaDefinition } from "../../modeler/modelFormat.js";
import { withRestStatements } from "../../mrs/restScript.js";
import {
    BUILT_IN_AUTH_APPS,
    projectRestSource,
    snapshotColumns,
    snapshotDbObjects,
} from "../../msm/projectRestSource.js";

const SNAPSHOT: ISchemaDefinition = {
    format: "msm-schema/1",
    schema: "shop",
    tables: [
        {
            name: "item",
            columns: [
                { name: "id", type: "INT UNSIGNED", auto_increment: true },
                { name: "sku", type: "VARCHAR(45)", nullable: false,
                    comment: "Stock number" },
                { name: "price", type: "DECIMAL(8,2)", nullable: true,
                    generated: "(1)" },
            ],
            indexes: [
                { name: null, kind: "primary", columns: ["id"] },
                { name: "sku_UNIQUE", kind: "unique", columns: ["sku"] },
            ],
            options: { engine: "InnoDB", comment: "What is sold" },
        },
        {
            name: "part",
            columns: [
                { name: "id", type: "INT" },
                { name: "item_id", type: "INT", nullable: false },
            ],
            indexes: [{ name: null, kind: "primary", columns: ["id"] }],
            foreign_keys: [{
                name: "fk_item", columns: ["item_id"],
                references: { schema: null, table: "item", columns: ["id"] },
                many: true,
            }],
        },
    ],
    views: [{ name: "items", columns: ["id", "sku"] }, { name: "all_parts" }],
    routines: [
        { name: "tidy", parameters: [
            { mode: "IN", name: "days", type: "INT" },
            { mode: "out", name: "gone", type: "BIGINT" }] },
        { name: "total", kind: "function", returns: "DECIMAL(10,2)",
            parameters: [{ name: "item", type: "INT" }] },
    ],
};

/** A project whose REST SQL is kept in memory. */
const project = (hasSnapshot = true) => {
    const sql = "\n-- Create a REST service\n\n\n";
    const snapshot = hasSnapshot ? SNAPSHOT : undefined;
    const state = { sql, saved: 0, failed: 0 };
    const source = projectRestSource({
        snapshot: () => { return Promise.resolve(snapshot); },
        restSql: () => { return Promise.resolve(state.sql); },
        write: (statements) => {
            state.sql = withRestStatements(state.sql, statements);

            return Promise.resolve();
        },
        saved: () => { state.saved += 1; },
        failed: () => { state.failed += 1; },
    });

    return { source, state };
};

describe("a project's database objects", () => {
    it("lists tables, views, procedures and functions with what the "
        + "snapshot knows of each", () => {
        expect(snapshotDbObjects(SNAPSHOT)).toEqual([
            { name: "item", type: "TABLE",
                details: "InnoDB, 3 columns, What is sold" },
            { name: "part", type: "TABLE", details: "2 columns" },
            { name: "items", type: "VIEW", details: "2 columns" },
            { name: "all_parts", type: "VIEW", details: "" },
            { name: "tidy", type: "PROCEDURE",
                details: "(IN days INT, out gone BIGINT)" },
            { name: "total", type: "FUNCTION",
                details: "(item INT) RETURNS DECIMAL(10,2)" },
        ]);
    });

    it("reads a table's columns, then both sides of its foreign keys", () => {
        const item = snapshotColumns(SNAPSHOT, "TABLE", "item");

        expect(item.columns?.map((column) => { return column.name; }))
            .toEqual(["id", "sku", "price", "part"]);
        expect(item.columns![0]!.db_column).toEqual({
            name: "id", datatype: "int unsigned", not_null: true,
            is_primary: true, is_unique: true, is_generated: false,
            id_generation: "auto_inc", comment: null,
        });
        expect(item.columns![1]!.db_column).toMatchObject({
            not_null: true, is_primary: false, is_unique: true,
            comment: "Stock number",
        });
        expect(item.columns![2]!.db_column).toMatchObject({
            not_null: false, is_generated: true });
        expect(item.columns![3]!.reference_mapping).toEqual({
            kind: "1:n", constraint: "fk_item", to_many: true,
            referenced_schema: "shop", referenced_table: "part",
            column_mapping: [{ base: "id", ref: "item_id" }],
        });

        const part = snapshotColumns(SNAPSHOT, "TABLE", "part");
        expect(part.columns!.at(-1)).toMatchObject({
            name: "item", db_column: null,
            reference_mapping: {
                kind: "n:1", to_many: false, referenced_table: "item",
                column_mapping: [{ base: "item_id", ref: "id" }],
            },
        });
    });

    it("reads a view's named columns, and a routine's parameters", () => {
        expect(snapshotColumns(SNAPSHOT, "VIEW", "items").columns!.map(
            (column) => { return column.name; })).toEqual(["id", "sku"]);
        expect(snapshotColumns(SNAPSHOT, "VIEW", "all_parts").columns)
            .toEqual([]);
        expect(snapshotColumns(SNAPSHOT, "PROCEDURE", "tidy").parameters)
            .toEqual([
                { position: 1, name: "days", mode: "IN", datatype: "int" },
                { position: 2, name: "gone", mode: "OUT", datatype: "bigint" },
            ]);
        expect(snapshotColumns(SNAPSHOT, "FUNCTION", "total")).toMatchObject({
            type: "FUNCTION", return_type: "decimal(10,2)",
            parameters: [{ name: "item", mode: "IN" }],
        });
    });

    it("says where an object is not in the snapshot", () => {
        expect(() => { snapshotColumns(SNAPSHOT, "TABLE", "gone"); })
            .toThrow("The project's schema has no table `gone`.");
        // A procedure is not the function of its name.
        expect(() => { snapshotColumns(SNAPSHOT, "FUNCTION", "tidy"); })
            .toThrow("has no function `tidy`");
    });
});

describe("a project as the REST dialogs' source", () => {
    it("offers the built-in auth apps, and writes the script's forms",
        async () => {
            const { source } = project();

            expect(source.forScript).toBe(true);
            expect(await source.authApps()).toEqual(BUILT_IN_AUTH_APPS);
            expect(await source.authApps("/svc")).toEqual([]);
        });

    it("reads its services and REST schemas from what was written", async () => {
        const { source, state } = project();

        expect(await source.services()).toEqual([]);
        await source.run(["CREATE OR REPLACE REST SERVICE /svc;"]);
        await source.run([
            "CREATE OR REPLACE REST SCHEMA /shop ON SERVICE /svc FROM `shop`;"]);

        expect((await source.services()).map((service) => {
            return service.full_service_path;
        })).toEqual(["/svc"]);
        expect((await source.schemas("/svc")).map((schema) => {
            return [schema.request_path, schema.name];
        })).toEqual([["/shop", "shop"]]);
        expect(await source.schemas("/other")).toEqual([]);
        expect(state.sql).toBe("\n-- Create a REST service\n\n"
            + "CREATE OR REPLACE REST SERVICE /svc;\n\n"
            + "CREATE OR REPLACE REST SCHEMA /shop ON SERVICE /svc FROM "
            + "`shop`;\n\n\n");
    });

    it("reads objects of the project's schema only", async () => {
        const { source } = project();

        expect(await source.dbObjects("shop")).toHaveLength(6);
        expect((await source.columnsOfEach([
            { objectType: "TABLE", schema: "shop", name: "part" },
            { objectType: "VIEW", schema: "shop", name: "items" },
        ])).map((columns) => { return columns.name; }))
            .toEqual(["part", "items"]);
        await expect(source.columns("TABLE", "other", "t")).rejects.toThrow(
            "`other` is not the project's schema, `shop`");
        await expect(project(false).source.dbObjects("shop"))
            .rejects.toThrow("The project has no schema snapshot");
    });
});
