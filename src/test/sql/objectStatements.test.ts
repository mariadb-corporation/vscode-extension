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
    createStatementOf,
    dropSql,
    showCreateSql,
    useSchemaSql,
} from "../../sql/objectStatements.js";

describe("the statements on a schema or object", () => {
    it("quotes every name", () => {
        expect(useSchemaSql("my`db")).toBe("USE `my``db`");
        expect(dropSql({ schema: "world" })).toBe("DROP DATABASE `world`;");
        expect(dropSql({
            schema: "world",
            object: { type: "table", name: "city" },
        })).toBe("DROP TABLE `world`.`city`;");
    });

    it.each([
        ["table", "TABLE"],
        ["view", "VIEW"],
        ["function", "FUNCTION"],
        ["procedure", "PROCEDURE"],
        ["sequence", "SEQUENCE"],
        ["trigger", "TRIGGER"],
        ["event", "EVENT"],
    ] as const)("drops and shows a %s with its keyword", (type, keyword) => {
        const target = { schema: "s", object: { type, name: "o" } };

        expect(dropSql(target)).toBe(`DROP ${keyword} \`s\`.\`o\`;`);
        expect(showCreateSql(target)).toBe(`SHOW CREATE ${keyword} \`s\`.\`o\``);
    });

    it("shows a schema as a database", () => {
        expect(showCreateSql({ schema: "world" }))
            .toBe("SHOW CREATE DATABASE `world`");
    });
});

describe("createStatementOf", () => {
    it("picks the definition out of what SHOW CREATE answers", () => {
        expect(createStatementOf({
            "Table": "city",
            "Create Table": "CREATE TABLE `city` (...)",
        })).toBe("CREATE TABLE `city` (...)");
        expect(createStatementOf({
            "Function": "f",
            "sql_mode": "",
            "Create Function": "CREATE FUNCTION `f`() ...",
            "character_set_client": "utf8mb4",
        })).toBe("CREATE FUNCTION `f`() ...");
        expect(createStatementOf({
            "Trigger": "t",
            "sql_mode": "",
            "SQL Original Statement": "CREATE TRIGGER `t` ...",
        })).toBe("CREATE TRIGGER `t` ...");
    });

    it("has none where the server withheld it", () => {
        // A routine's body is NULL to a user not allowed to see it.
        expect(createStatementOf({
            "Procedure": "p",
            "Create Procedure": null,
        })).toBeUndefined();
        expect(createStatementOf(undefined)).toBeUndefined();
    });
});
