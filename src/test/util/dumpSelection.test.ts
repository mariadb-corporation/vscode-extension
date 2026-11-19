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

import type { IDumpInfo, IDumpSchemaInfo } from "../../mcp/utilApi.js";
import {
    dumpProblem,
    dumpSummary,
    groupKey,
    filterName,
    initialExcluded,
    loadFilters,
    objectKey,
    partlyTicked,
    schemaKey,
    schemasToComplete,
    selectionProblem,
    userKey,
    USERS_KEY,
    withFullSchema,
    withZipSuffix,
} from "../../util/dumpSelection.js";

const schemaInfo = (name: string,
    over: Partial<IDumpSchemaInfo> = {}): IDumpSchemaInfo => {
    return {
        name, tables: [], table_count: 0, views: [], view_count: 0,
        functions: [], function_count: 0, procedures: [], procedure_count: 0,
        events: [], event_count: 0, ...over,
    };
};

const info = (over: Partial<IDumpInfo> = {}): IDumpInfo => {
    return {
        url: "/d", format: "folder", kind: "dumpInstance", complete: true,
        source: { server: "db1", server_version: "11.8.2", user: "root" },
        begin: "2026-11-10 14:05:00", end: null, options: {},
        includes_users: true, users: ["'app'@'%'", "'ro'@'localhost'"],
        user_count: 2, schema_count: 2,
        schemas: [
            schemaInfo("shop", {
                tables: ["orders", "order lines"], table_count: 2,
                views: ["v"], view_count: 1,
                functions: ["f"], function_count: 1,
                procedures: ["p"], procedure_count: 1,
                events: ["e"], event_count: 1,
            }),
            schemaInfo("crm", { tables: ["leads"], table_count: 1 }),
        ],
        data_file_bytes: 10, size_bytes: 2048, rows: 5, data_bytes: 1536,
        ...over,
    };
};

describe("withZipSuffix", () => {
    it("names the path a zip, and back", () => {
        expect(withZipSuffix("/d/shop-2026", true))
            .toBe("/d/shop-2026.mariadb.dump.zip");
        expect(withZipSuffix("/d/shop/", true)).toBe("/d/shop.mariadb.dump.zip");
        expect(withZipSuffix("/d/a.mariadb.dump.zip", true))
            .toBe("/d/a.mariadb.dump.zip");
        expect(withZipSuffix("/d/a.mariadb.dump.zip", false)).toBe("/d/a");
        expect(withZipSuffix("/d/a", false)).toBe("/d/a");
        expect(withZipSuffix("", true)).toBe("");
    });
});

describe("dumpProblem", () => {
    it("loads a table dump only into a schema", () => {
        const tables = info({ kind: "dumpTables", schema_count: 1,
            schemas: [schemaInfo("crm")] });
        expect(dumpProblem(tables)).toContain("Load Table Dump from Disk");
        expect(dumpProblem(tables, "sales")).toBeUndefined();
    });

    it("loads one schema's dump into another schema, but no more", () => {
        const one = info({ kind: "dumpSchemas", schema_count: 1,
            schemas: [schemaInfo("crm")] });
        expect(dumpProblem(one, "sales")).toBeUndefined();
        expect(dumpProblem(info({ kind: "dumpSchemas" }), "sales"))
            .toContain("dump of 2 schemas");
        expect(dumpProblem(info(), "sales")).toContain("a whole server");
        expect(dumpProblem(info())).toBeUndefined();
    });

    it("loads a dump of one schema that does not name its utility", () => {
        expect(dumpProblem(info({ kind: null, schema_count: 1,
            schemas: [schemaInfo("crm")] }), "sales")).toBeUndefined();
        expect(dumpProblem(info({ kind: null }), "sales"))
            .toContain("dump of 2 schemas");
    });

    it("refuses a dump that is not complete", () => {
        expect(dumpProblem(info({ complete: false }))).toContain("not complete");
    });
});

describe("the boxes", () => {
    it("start with the users unticked, and a schema's routines into another",
        () => {
            expect(initialExcluded(info())).toEqual([USERS_KEY]);
            const one = info({ kind: "dumpSchemas", schema_count: 1,
                schemas: [schemaInfo("crm")] });
            expect(initialExcluded(one, "sales")).toEqual([USERS_KEY,
                groupKey("crm", "functions"), groupKey("crm", "procedures"),
                groupKey("crm", "events")]);
        });

    it("show partly ticked above what is unticked", () => {
        expect(partlyTicked([schemaKey("crm"),
            objectKey("shop", "tables", "orders"),
            groupKey("crm", "events"), userKey("'ro'@'%'")]))
            .toEqual(new Set([schemaKey("shop"), groupKey("shop", "tables"),
                schemaKey("crm"), USERS_KEY]));
    });
});

describe("loadFilters", () => {
    it("leaves out nothing when everything is ticked", () => {
        expect(loadFilters(info(), [USERS_KEY])).toEqual({});
    });

    it("excludes what is unticked, quoting names", () => {
        expect(loadFilters(info(), [schemaKey("crm"),
            objectKey("shop", "tables", "order lines"),
            objectKey("shop", "views", "v"),
            objectKey("shop", "functions", "f"),
            groupKey("shop", "procedures"),
            groupKey("shop", "events"),
            userKey("'ro'@'localhost'")])).toEqual({
            excludeSchemas: ["crm"],
            excludeTables: ["shop.`order lines`", "shop.v"],
            excludeRoutines: ["shop.f", "shop.p"],
            excludeEvents: ["shop.e"],
            loadUsers: true,
            excludeUsers: ["'ro'@'localhost'"],
        });
    });

    it("loads into a schema, without users", () => {
        expect(loadFilters(info({ kind: "dumpTables" }), [], "sales"))
            .toEqual({ schema: "sales" });
    });
});

describe("names cut short", () => {
    const capped = info({ schemas: [schemaInfo("shop", {
        tables: ["a"], table_count: 150 })] });

    it("are read in full only where a whole kind is unticked", () => {
        expect(schemasToComplete(capped, [objectKey("shop", "tables", "a")]))
            .toEqual([]);
        expect(schemasToComplete(capped, [groupKey("shop", "tables")]))
            .toEqual(["shop"]);
        expect(schemasToComplete(capped, [schemaKey("shop"),
            groupKey("shop", "tables")])).toEqual([]);
    });

    it("take a schema's every name, and the users'", () => {
        const full = info({ users: ["'a'@'%'", "'b'@'%'", "'c'@'%'"],
            schemas: [schemaInfo("shop", { tables: ["a", "b"],
                table_count: 150 })] });
        const merged = withFullSchema(capped, full);
        expect(merged.schemas[0].tables).toEqual(["a", "b"]);
        expect(merged.users).toHaveLength(3);
    });
});

describe("selectionProblem", () => {
    it("says when a ticked schema has nothing ticked under it", () => {
        const groups = ["tables", "views", "functions", "procedures",
            "events"] as const;
        const shopEmpty = groups.map((group) => {
            return groupKey("shop", group);
        });
        expect(selectionProblem(info(), shopEmpty))
            .toContain("Everything under shop is unticked");
        // its objects unticked one by one come to the same
        expect(selectionProblem(info(), [
            ...shopEmpty.filter((key) => { return key !== groupKey("shop",
                "tables"); }),
            objectKey("shop", "tables", "orders"),
            objectKey("shop", "tables", "order lines")]))
            .toContain("Everything under shop is unticked");
        // unticking the schema itself leaves it out instead
        expect(selectionProblem(info(), [schemaKey("shop"), ...shopEmpty]))
            .toBeUndefined();
    });

    it("loads names a list cut short, and a schema without objects", () => {
        const capped = info({ schemas: [schemaInfo("shop", {
            tables: ["a"], table_count: 150 })] });
        expect(selectionProblem(capped, [objectKey("shop", "tables", "a")]))
            .toBeUndefined();
        expect(selectionProblem(info({ schemas: [schemaInfo("empty")] }), []))
            .toBeUndefined();
    });

    it("says nothing is ticked loading into a schema", () => {
        const one = info({ kind: "dumpTables", schema_count: 1,
            schemas: [schemaInfo("crm", { tables: ["leads"],
                table_count: 1 })] });
        expect(selectionProblem(one, [groupKey("crm", "tables")], "sales"))
            .toContain("Nothing is ticked");
    });

    it("says when nothing is ticked", () => {
        expect(selectionProblem(info(), [USERS_KEY, schemaKey("shop"),
            schemaKey("crm")])).toContain("Nothing is ticked");
        // the users alone are something
        expect(selectionProblem(info(), [schemaKey("shop"),
            schemaKey("crm")])).toBeUndefined();
    });
});

describe("filterName and dumpSummary", () => {
    it("quote what needs it", () => {
        expect(filterName("orders")).toBe("orders");
        expect(filterName("a`b")).toBe("`a``b`");
    });

    it("say what the dump is and how big", () => {
        expect(dumpSummary(info({ format: "zip",
            disk_needed_bytes: 1 << 30 }))).toEqual([
            "Instance dump in a ZIP file, from db1 (11.8.2) by root, made "
                + "2026-11-10 14:05:00",
            "2 schemas · 3 tables · 5 rows · 1.5 KB of data · 2.0 KB on disk"
                + " · needs 1.0 GB free to load",
        ]);
    });
});
