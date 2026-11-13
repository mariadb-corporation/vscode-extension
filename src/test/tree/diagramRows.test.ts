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

import type {
    IModelFigure,
    IModelLayer,
    ISchemaDefinition,
} from "../../modeler/modelFormat.js";
import {
    diagramRowObject,
    diagramRowsOf,
    figureKindOf,
    type IDiagramFigureNode,
    type IDiagramLayerNode,
} from "../../tree/diagramRows.js";

const PLACE = { projectPath: "/p", diagram: "Main" };

const figure = (id: string, members: Partial<IModelFigure>): IModelFigure => {
    return { id, name: id, left: 0, top: 0, ...members };
};

const layer = (id: string, name: string,
    figures: string[] = []): IModelLayer => {
    return { id, name, left: 0, top: 0, width: 100, height: 100,
        color: "#fff", figures };
};

describe("figureKindOf", () => {
    it("takes a figure without a type for a table's, and knows no note", () => {
        expect(figureKindOf(figure("a", {}))).toBe("table");
        expect(figureKindOf(figure("b", { type: "SequenceFigure" })))
            .toBe("sequence");
        expect(figureKindOf(figure("c", { type: "NoteFigure" })))
            .toBeUndefined();
        expect(figureKindOf(figure("d", { type: "ImageFigure" })))
            .toBeUndefined();
    });
});

describe("diagramRowsOf", () => {
    it("lists the layers by name with their figures, then the others by "
        + "kind and name", () => {
        const rows = diagramRowsOf(PLACE, {
            layers: [layer("L2", "Zeta"), layer("L1", "Alpha", ["f3"])],
            figures: [
                figure("f1", { type: "ViewFigure", view: "v" }),
                figure("f2", { type: "TableFigure", table: "b" }),
                figure("f3", { type: "TableFigure", table: "a" }),
                figure("f4", { type: "TableFigure", table: "c", layer: "L2" }),
                figure("f5", { type: "TableFigure", table: "a2" }),
                figure("f6", { type: "NoteFigure", text: "hi" }),
            ],
        });

        expect(rows.map((row) => {
            return row.kind === "diagramLayer" ? row.layer.name : row.label;
        })).toEqual(["Alpha", "Zeta", "a2", "b", "v"]);
        // By the layer's list, or by the figure's own layer.
        expect((rows[0] as IDiagramLayerNode).figures.map((row) => {
            return row.label;
        })).toEqual(["a"]);
        expect((rows[1] as IDiagramLayerNode).figures.map((row) => {
            return row.label;
        })).toEqual(["c"]);
    });

    it("takes a figure naming a layer the diagram has not for one on none",
        () => {
            const rows = diagramRowsOf(PLACE, { layers: [], figures: [
                figure("f1", { table: "t", layer: "gone" })] });

            expect(rows).toMatchObject([{ kind: "diagramFigure", label: "t" }]);
        });

    it("lists a group's routines with their kinds, and its events", () => {
        const definition = ({
            routines: [{ name: "Total", kind: "function" }],
        }) as unknown as ISchemaDefinition;
        const [routines, events] = diagramRowsOf(PLACE, { layers: [], figures: [
            figure("g1", { type: "RoutineGroupFigure", name: "Routines",
                routines: ["total", "tidy"] }),
            figure("g2", { type: "EventGroupFigure", name: "Events",
                events: ["purge"] }),
        ] }, definition) as IDiagramFigureNode[];

        expect(routines.members).toEqual([
            { ...PLACE, kind: "diagramMember", figureId: "g1",
                objectType: "function", name: "total" },
            { ...PLACE, kind: "diagramMember", figureId: "g1",
                objectType: "procedure", name: "tidy" },
        ]);
        expect(events.members.map((member) => {
            return [member.objectType, member.name];
        })).toEqual([["event", "purge"]]);
    });

    it("labels a REST object by its REST schema's and its own path", () => {
        const [rest] = diagramRowsOf(PLACE, { layers: [], figures: [
            figure("r1", { type: "RestObjectFigure", restService: "/svc",
                restSchema: "/shop", restObject: "/orders" }),
        ] }) as IDiagramFigureNode[];

        expect(rest).toMatchObject({ figureKind: "rest",
            label: "/shop/orders" });
    });
});

describe("diagramRowObject", () => {
    it("gives the object of a single object's figure or a group's member",
        () => {
            const [table, group, rest] = diagramRowsOf(PLACE, { layers: [],
                figures: [
                    figure("f1", { table: "orders" }),
                    figure("g1", { type: "EventGroupFigure",
                        events: ["purge"] }),
                    figure("r1", { type: "RestObjectFigure",
                        restObject: "/o" }),
                ] }) as IDiagramFigureNode[];

            expect(diagramRowObject(table))
                .toEqual({ type: "table", name: "orders" });
            expect(diagramRowObject(group)).toBeUndefined();
            expect(diagramRowObject(group.members[0]))
                .toEqual({ type: "event", name: "purge" });
            expect(diagramRowObject(rest)).toBeUndefined();
        });
});
