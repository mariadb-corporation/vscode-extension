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

import { definitionOf } from "../../msm/definitions.js";

const SCRIPT = "/p/development/shop_next.sql";

/** A range on one line, from a character to another. */
const on = (line: number, from: number, to: number) => {
    return { start: { line, character: from }, end: { line, character: to } };
};

const OUTLINE = {
    format: 1,
    file: SCRIPT,
    includes: [{ file: "/p/development/sections/140-10_tables.sql",
        range: on(40, 0, 30), slice: null }],
    schemas: [{
        name: "shop", declared: true, range: on(10, 0, 40),
        selection_range: on(10, 16, 22),
        tables: [
            { name: "orders", range: on(3, 0, 80), selection_range: on(3, 13, 21),
                source: 0 },
        ],
        views: [{ name: "open_orders", range: on(60, 0, 50) }],
        routines: [
            { name: "total", kind: "procedure", range: on(70, 0, 9),
                selection_range: on(70, 17, 22) },
            { name: "total", kind: "function", range: on(80, 0, 9),
                selection_range: on(80, 16, 21) },
        ],
        triggers: [], events: [], sequences: [],
    }],
};

describe("definitionOf", () => {
    it("finds the schema's CREATE DATABASE, its name selected", () => {
        expect(definitionOf(OUTLINE, { kind: "schema", schema: "shop" },
            SCRIPT)).toEqual({ file: SCRIPT, range: on(10, 0, 40),
            selection: on(10, 16, 22) });
    });

    it("finds an object in the file it was included from", () => {
        expect(definitionOf(OUTLINE, { kind: "object", schema: "shop",
            type: "table", name: "ORDERS" }, SCRIPT)).toEqual({
            file: "/p/development/sections/140-10_tables.sql",
            range: on(3, 0, 80), selection: on(3, 13, 21) });
    });

    it("tells a procedure from a function of the same name", () => {
        expect(definitionOf(OUTLINE, { kind: "object", schema: "shop",
            type: "function", name: "total" }, SCRIPT)?.range)
            .toEqual(on(80, 0, 9));
    });

    it("takes the statement where there is no name range", () => {
        expect(definitionOf(OUTLINE, { kind: "object", schema: "shop",
            type: "view", name: "open_orders" }, SCRIPT)?.selection)
            .toEqual(on(60, 0, 50));
    });

    it("looks in every schema where the script names it otherwise", () => {
        const placeholder = { ...OUTLINE, schemas: [{ ...OUTLINE.schemas[0],
            name: "${schema_name}" }] };

        expect(definitionOf(placeholder, { kind: "object", schema: "shop",
            type: "view", name: "open_orders" }, SCRIPT)?.file).toBe(SCRIPT);
        expect(definitionOf(placeholder, { kind: "schema", schema: "shop" },
            SCRIPT)?.selection).toEqual(on(10, 16, 22));
    });

    it("finds nothing the script does not create or declare", () => {
        expect(definitionOf(OUTLINE, { kind: "object", schema: "shop",
            type: "event", name: "purge" }, SCRIPT)).toBeUndefined();
        expect(definitionOf({ schemas: [{ name: "shop", declared: false }] },
            { kind: "schema", schema: "shop" }, SCRIPT)).toBeUndefined();
        expect(definitionOf(undefined, { kind: "schema", schema: "shop" },
            SCRIPT)).toBeUndefined();
    });
});
