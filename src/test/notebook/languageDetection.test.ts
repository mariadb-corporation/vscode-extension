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

import { detectLanguage } from "../../notebook/languageDetection.js";

const SQL = "mariadb-sql";
const TS = "typescript";

describe("detectLanguage", () => {
    it.each([
        ["SELECT * FROM t", SQL],
        ["select 1", SQL],
        ["  \n  INSERT INTO t VALUES (1)", SQL],
        ["WITH x AS (SELECT 1) SELECT * FROM x", SQL],
        ["with recursive r AS (SELECT 1) SELECT * FROM r", SQL],
        ["SHOW TABLES", SQL],
        ["CREATE TABLE t (id INT)", SQL],
        ["CALL p()", SQL],
        ["USE world", SQL],
        ["SET @a = 1", SQL],
        ["set names utf8mb4", SQL],
        ["SET GLOBAL max_connections = 10", SQL],
        ["DELETE FROM t", SQL],
        ["delete low_priority from t", SQL],
        ["DO SLEEP(1)", SQL],
        ["DELIMITER //", SQL],
        ["(SELECT 1) UNION (SELECT 2)", SQL],
        ["-- a comment\nanything", SQL],
        ["# a comment", SQL],
        ["/*! SELECT 1 */", SQL],
        ["/* either */ SELECT 1", SQL],
        ["DESCRIBE t", SQL],
    ])("reads %j as SQL", (text, language) => {
        expect(detectLanguage(text)).toBe(language);
    });

    it.each([
        ["const a = 1", TS],
        ["let rows = await runSql('SELECT 1')", TS],
        ["await runSql('SELECT 1')", TS],
        ["print(1)", TS],
        ["runSql(\"SELECT 1\")", TS],
        ["$.x = 1", TS],
        ["console.log('x')", TS],
        ["import x from 'y'", TS],
        ["function f() {}", TS],
        ["interface I { a: number }", TS],
        ["if (x) {}", TS],
        ["for (const r of rows) {}", TS],
        ["// a comment\nanything", TS],
        ["\"text\"", TS],
        ["[1, 2].map((n) => n)", TS],
        ["{ }", TS],
        ["42", TS],
        ["(async () => {})()", TS],
        ["delete obj.key", TS],
        ["delete obj[key]", TS],
        ["set(1)", TS],
        ["do { } while (x)", TS],
        ["rows.length", TS],
        ["x = 1", TS],
        ["select(1)", TS],
        ["update.count", TS],
    ])("reads %j as TypeScript", (text, language) => {
        expect(detectLanguage(text)).toBe(language);
    });

    it.each([
        "",
        "   \n ",
        "foo",
        "set",
        "/* a comment that says nothing about either */",
    ])("leaves %j undecided", (text) => {
        expect(detectLanguage(text)).toBeUndefined();
    });
});
