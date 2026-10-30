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

import { changesCatalog } from "../../sql/catalogChange.js";

describe("changesCatalog", () => {
    it("matches a statement that creates, alters, drops or renames", () => {
        expect(changesCatalog("CREATE SCHEMA shop")).toBe(true);
        expect(changesCatalog("create or replace view v as select 1"))
            .toBe(true);
        expect(changesCatalog("ALTER TABLE t ADD c INT")).toBe(true);
        expect(changesCatalog("DROP DATABASE IF EXISTS shop")).toBe(true);
        expect(changesCatalog("RENAME TABLE a.t TO b.t")).toBe(true);
        expect(changesCatalog("CREATE REST SERVICE /shop")).toBe(true);
    });

    it("looks past blanks and comments, and into executable ones", () => {
        expect(changesCatalog("\n  -- the table\nCREATE TABLE t (id INT)"))
            .toBe(true);
        expect(changesCatalog("# note\n/* a\n   b */ DROP TABLE t"))
            .toBe(true);
        expect(changesCatalog(
            "/*!50001 CREATE ALGORITHM=UNDEFINED */ /*!50001 VIEW v */"))
            .toBe(true);
        expect(changesCatalog("/*M!100100 DROP TABLE t */")).toBe(true);
    });

    it("leaves everything else alone", () => {
        expect(changesCatalog("SELECT 'CREATE TABLE t'")).toBe(false);
        expect(changesCatalog("INSERT INTO created VALUES (1)")).toBe(false);
        expect(changesCatalog("-- DROP TABLE t\nSELECT 1")).toBe(false);
        expect(changesCatalog("/* CREATE */ SELECT 1")).toBe(false);
        expect(changesCatalog("CREATED")).toBe(false);
        expect(changesCatalog("TRUNCATE TABLE t")).toBe(false);
        expect(changesCatalog("")).toBe(false);
    });
});
