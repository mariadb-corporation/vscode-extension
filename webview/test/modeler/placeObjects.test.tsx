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
    isPlaceOf,
    parseSchemaObjectUris,
    schemaObjectUri,
} from "../../../src/modeler/modelerProtocol.js";
import type { IModelDiagram } from "../../../src/modeler/modelFormat.js";
import {
    objectsOfFigures,
    placementOf,
} from "../../src/modeler/placeObjects.js";
import type { ISchemaObjectLists } from "../../src/modeler/schemaEdits.js";

const objects = (): ISchemaObjectLists => {
    return {
        tables: [
            { name: "customer", columns: [{ name: "id", type: "INT" }] },
            { name: "orders", columns: [{ name: "id", type: "INT" }],
                foreign_keys: [
                    { name: "fk_orders_customer", columns: ["customer_id"],
                        references: { schema: null, table: "customer",
                            columns: ["id"] } },
                    { name: "fk_orders_parent", columns: ["parent_id"],
                        references: { schema: null, table: "orders",
                            columns: ["id"] } },
                ] },
            { name: "audit", columns: [{ name: "id", type: "INT" }],
                foreign_keys: [{ name: "fk_audit_customer",
                    columns: ["customer_id"], references: { schema: null,
                        table: "customer", columns: ["id"] } }] },
        ],
        views: [{ name: "customer_ids" }],
        routines: [
            { name: "tidy", kind: "procedure" },
            { name: "total", kind: "function" },
        ],
    };
};

const diagram = (): IModelDiagram => {
    return {
        name: "Main", width: 1000, height: 800,
        layers: [],
        figures: [{ id: "c", type: "TableFigure", name: "customer",
            table: "customer", left: 0, top: 0 }],
        connections: [],
    };
};

/** @returns Ids 1, 2, 3, ... */
const ids = (): () => string => {
    let next = 0;

    return () => { next += 1; return String(next); };
};

describe("placing the schema's objects", () => {
    it("places a table with its foreign keys to the tables shown, its own "
        + "to itself too", () => {
        const placed = placementOf([{ type: "table", name: "orders" }],
            diagram(), objects(), { x: 100.4, y: 50 }, ids());

        expect(placed.figures).toEqual([{ id: "1", type: "TableFigure",
            name: "orders", table: "orders", left: 100, top: 50 }]);
        expect(placed.connections).toEqual([
            { id: "2", foreignKey: "fk_orders_customer", table: "orders",
                startFigure: "1", endFigure: "c", visible: true },
            { id: "3", foreignKey: "fk_orders_parent", table: "orders",
                startFigure: "1", endFigure: "1", visible: true },
        ]);
        expect(placed.skipped).toEqual([]);
    });

    it("draws the foreign keys between tables placed together, in rows",
        () => {
        const empty = { ...diagram(), figures: [] };
        const placed = placementOf([{ type: "table", name: "audit" },
            { type: "table", name: "customer" }], empty, objects(),
            { x: 0, y: 0 }, ids());

        expect(placed.figures.map((figure) => {
            return [figure.name, figure.left, figure.top];
        })).toEqual([["audit", 0, 0], ["customer", 240, 0]]);
        expect(placed.connections.map((connection) => {
            return connection.foreignKey;
        })).toEqual(["fk_audit_customer"]);
    });

    it("shows a table or view once, and says what it left out", () => {
        const placed = placementOf([{ type: "table", name: "customer" },
            { type: "view", name: "customer_ids" },
            { type: "view", name: "customer_ids" },
            { type: "table", name: "nope" }], diagram(), objects(),
            { x: 0, y: 0 }, ids());

        expect(placed.figures.map((figure) => { return figure.view; }))
            .toEqual(["customer_ids"]);
        expect(placed.skipped).toEqual(["customer is shown already",
            "customer_ids is shown already",
            "nope is not a table of the schema"]);
    });

    it("puts the routines dropped together on one new routine group", () => {
        const placed = placementOf([{ type: "procedure", name: "tidy" },
            { type: "function", name: "total" },
            { type: "function", name: "tidy" }], diagram(), objects(),
            { x: 0, y: 0 }, ids());

        expect(placed.figures).toEqual([{ id: "1",
            type: "RoutineGroupFigure", name: "routines1",
            routines: ["tidy", "total"], left: 0, top: 0 }]);
        expect(placed.skipped).toEqual(["tidy is not a function of the "
            + "schema"]);
    });
});

describe("placing sequences, events and triggers", () => {
    it("gives a sequence a figure, the events one group, and a trigger its "
        + "table", () => {
        const lists = { ...objects(),
            sequences: [{ name: "order_no" }],
            events: [{ name: "purge" }, { name: "report" }],
            triggers: [{ name: "orders_bi", timing: "BEFORE",
                events: "INSERT", table: "orders" },
            { name: "customer_bi", timing: "BEFORE", events: "INSERT",
                table: "customer" }] };
        const placed = placementOf([
            { type: "sequence", name: "order_no" },
            { type: "event", name: "purge" },
            { type: "event", name: "report" },
            { type: "trigger", name: "orders_bi" },
            { type: "trigger", name: "customer_bi" },
        ], diagram(), lists, { x: 0, y: 0 }, ids());

        expect(placed.figures.map((figure) => {
            return [figure.type, figure.name];
        })).toEqual([["SequenceFigure", "order_no"],
            ["TableFigure", "orders"],
            ["EventGroupFigure", "events1"]]);
        expect(placed.figures[2]?.events).toEqual(["purge", "report"]);
        // customer is shown: its card lists its trigger.
        expect(placed.skipped).toEqual(["customer_bi is shown on customer"]);
        expect(objectsOfFigures({ ...diagram(), figures: placed.figures },
            placed.figures.map((figure) => { return figure.id; }), lists))
            .toEqual([{ type: "sequence", name: "order_no" },
                { type: "table", name: "orders" },
                { type: "event", name: "purge" },
                { type: "event", name: "report" }]);
    });
});

describe("the objects of the figures selected", () => {
    it("names a table's, a view's and a routine group's routines", () => {
        const shown = diagram();
        shown.figures.push(
            { id: "v", type: "ViewFigure", name: "ids", view: "customer_ids",
                left: 0, top: 0 },
            { id: "r", type: "RoutineGroupFigure", name: "routines",
                routines: ["total", "gone"], left: 0, top: 0 });

        expect(objectsOfFigures(shown, ["c", "v", "r", "x"], objects()))
            .toEqual([{ type: "table", name: "customer" },
                { type: "view", name: "customer_ids" },
                { type: "function", name: "total" }]);
    });
});

describe("schema objects in a drag", () => {
    it("reads back the objects a tree's drag carries, with their schema",
        () => {
        const project = { projectPath: "/work/a b.msm.project" };
        const live = { connection: "mariadb://root@localhost:3306",
            schema: "shop" };
        const list = [
            schemaObjectUri(project, { type: "table", name: "order items" }),
            "# a comment",
            "file:///somewhere/else.sql",
            schemaObjectUri(live, { type: "function", name: "total" }),
        ].join("\r\n");

        const parsed = parseSchemaObjectUris(list);
        expect(parsed).toEqual([
            { place: project, ref: { type: "table", name: "order items" } },
            { place: live, ref: { type: "function", name: "total" } },
        ]);
        expect(isPlaceOf(project, { kind: "project",
            projectPath: "/work/a b.msm.project", diagram: "Main" }))
            .toBe(true);
        expect(isPlaceOf(live, { kind: "connection",
            connection: live.connection, schema: "other", diagram: "Main" }))
            .toBe(false);
    });
});
