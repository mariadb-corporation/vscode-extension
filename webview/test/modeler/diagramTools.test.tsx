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

import { beforeEach, describe, expect, it } from "vitest";

import type { IMsmSchemaEdit } from "../../../src/mcp/msmApi.js";
import type {
    IModelConnection,
    IModelDiagram,
    IModelFigure,
    IModelLayer,
    ISchemaModel,
} from "../../../src/modeler/modelFormat.js";
import type { IRect } from "../../../src/modeler/pageSettings.js";
import type { IProbe } from "../../src/canvas/canvasTypes.js";
import type { IPoint } from "../../src/canvas/geometry.js";
import { UndoStack } from "../../src/canvas/undoStack.js";
import { catalogFromModel, type ISchemaCatalog } from "../../src/modeler/catalog.js";
import {
    DiagramTools,
    parseColumnText,
    type IPickedImage,
    type IToolEdit,
    type IToolHighlight,
    type IToolHit,
    type IToolPanel,
    type IToolTarget,
} from "../../src/modeler/diagramTools.js";

/** A figure set for the tools: the diagram and catalog, and what is asked. */
class FakeTarget implements IToolTarget {
    public readonly catalog: ISchemaCatalog;
    public readonly history = new UndoStack();
    public readonly shown: IModelDiagram = {
        name: "main", width: 2000, height: 1000,
        layers: [], figures: [], connections: [],
    };
    public next?: IToolHit;
    public point: IPoint = { x: 100.4, y: 50.6 };
    public edits: IToolEdit[] = [];
    public sent: IMsmSchemaEdit[][] = [];
    /** What takes back each request sent, where the tool gave one. */
    public failures: Array<((message: string) => void) | undefined> = [];
    public sentFigures: string[][] = [];
    public hints: string[] = [];
    public doneCount = 0;
    public panelShown?: IToolPanel;
    public highlighted?: IToolHighlight;
    public picked?: IPickedImage;

    public constructor(model: ISchemaModel) {
        this.catalog = catalogFromModel(model);
    }

    public diagram(): IModelDiagram { return this.shown; }
    public hit(): IToolHit | undefined { return this.next; }
    public pointOf(): IPoint | undefined { return this.point; }

    public figureRect(id: string): IRect | undefined {
        const figure = this.figure(id);

        return figure === undefined ? undefined
            : { left: figure.left, top: figure.top, width: 100, height: 60 };
    }

    public figure(id: string): IModelFigure | undefined {
        return this.shown.figures.find((figure) => { return figure.id === id; });
    }

    public addFigure(figure: IModelFigure): void {
        if (!this.shown.figures.includes(figure)) {
            this.shown.figures.push(figure);
        }
    }

    public removeFigure(id: string): IModelConnection[] {
        const gone = this.shown.connections.filter((connection) => {
            return connection.startFigure === id || connection.endFigure === id;
        });
        this.shown.connections = this.shown.connections.filter((connection) => {
            return !gone.includes(connection);
        });
        this.shown.figures = this.shown.figures.filter((figure) => {
            return figure.id !== id;
        });

        return gone;
    }

    public addLayer(layer: IModelLayer): void { this.shown.layers.push(layer); }

    public removeLayer(id: string): void {
        this.shown.layers = this.shown.layers.filter((layer) => {
            return layer.id !== id;
        });
    }

    public addConnection(connection: IModelConnection): void {
        if (!this.shown.connections.includes(connection)) {
            this.shown.connections.push(connection);
        }
    }

    public removeConnection(id: string): void {
        this.shown.connections = this.shown.connections.filter((connection) => {
            return connection.id !== id;
        });
    }

    public refresh(): void { /* nothing drawn */ }

    public editItem(_figureId: string, _find: unknown, edit: IToolEdit): void {
        this.edits.push(edit);
    }

    public highlight(highlight?: IToolHighlight): void {
        this.highlighted = highlight;
    }

    public band(_rect?: IRect): void { /* nothing drawn */ }
    public select(): void { /* nothing selected */ }
    public hint(text: string): void { this.hints.push(text); }
    public done(): void { this.doneCount += 1; }

    public schemaEdit(edits: IMsmSchemaEdit[],
        failed?: (message: string) => void): void {
        this.sent.push(edits);
        this.failures.push(failed);
        this.sentFigures.push(this.shown.figures.map((figure) => {
            return figure.name;
        }));
    }

    public pickImage(): Promise<IPickedImage | undefined> {
        return Promise.resolve(this.picked);
    }

    public panel(panel?: IToolPanel): void { this.panelShown = panel; }

    /** @returns The edit opened last. */
    public get edit(): IToolEdit {
        return this.edits[this.edits.length - 1]!;
    }

    /** @returns The ops of every request sent. */
    public get ops(): string[][] {
        return this.sent.map((edits) => {
            return edits.map((edit) => { return edit.op; });
        });
    }
}

const probe = {} as IProbe;

const model = (): ISchemaModel => {
    return {
        schema: "shop",
        tables: [
            {
                name: "customer",
                columns: [{ name: "id", type: "UUID", nullable: false },
                    { name: "name", type: "VARCHAR(45)" }],
                indexes: [{ name: null, kind: "primary", columns: ["id"] }],
            },
            {
                name: "order",
                columns: [{ name: "id", type: "INT", nullable: false },
                    { name: "buyer", type: "UUID" },
                    { name: "seller", type: "UUID" }],
                indexes: [{ name: null, kind: "primary", columns: ["id"] }],
            },
            { name: "log", columns: [{ name: "line", type: "TEXT" }] },
        ],
        views: [],
        routines: [],
        diagrams: [],
    };
};

describe("diagram tools", () => {
    let target: FakeTarget;
    let tools: DiagramTools;

    /** Shows a figure for each table, at its own place. */
    const figuresOfTables = (): void => {
        ["customer", "order", "log"].forEach((name, index) => {
            target.shown.figures.push({ id: `f-${name}`, name, table: name,
                left: index * 300, top: 100 });
        });
    };

    /** Points at a table's figure, or one of its columns. */
    const at = (table: string, column?: string): void => {
        target.next = { figureId: `f-${table}`, table, column };
    };

    beforeEach(() => {
        target = new FakeTarget(model());
        tools = new DiagramTools(target);
    });

    it("splits a column's text into its name and its type", () => {
        expect(parseColumnText("  id  ")).toEqual({ name: "id", type: "" });
        expect(parseColumnText("price  decimal(10,2)"))
            .toEqual({ name: "price", type: "decimal(10,2)" });
        expect(parseColumnText("n INT   UNSIGNED"))
            .toEqual({ name: "n", type: "INT UNSIGNED" });
    });

    describe("a new table", () => {
        it("takes its name, then column after column, and is made once "
            + "an empty name ends it", () => {
            tools.down("table", probe);

            // Shown at once, with a row for the first column.
            expect(target.shown.figures[0]).toMatchObject({ name: "table1",
                table: "table1", left: 100, top: 51 });
            expect(target.catalog.table("table1")?.columns).toEqual([
                { name: "", type: "" }]);
            expect(target.doneCount).toBe(1);
            expect(target.edit.label).toBe("Table name");
            expect(target.edit.text).toBe("table1");

            target.edit.commit("orders", "enter");
            expect(target.shown.figures[0]?.table).toBe("orders");
            // The first column: the key, `id UUID`.
            expect(target.edit.text).toBe("id UUID");
            expect(target.edit.choices?.preferred).toBe("UUID");

            target.edit.commit("id UUID", "enter");
            // The next ones: VARCHAR(45) offered first.
            expect(target.edit.text).toBe("");
            expect(target.edit.choices?.preferred).toBe("VARCHAR(45)");
            target.edit.commit("title VARCHAR(45)", "enter");
            expect(target.catalog.table("orders")?.columns.map((column) => {
                return column.name;
            })).toEqual(["id", "title", ""]);
            expect(target.sent).toEqual([]);

            target.edit.commit("", "enter");
            expect(target.sent).toEqual([[{
                op: "add_table",
                table: {
                    name: "orders",
                    columns: [{ name: "id", type: "UUID", nullable: false },
                        { name: "title", type: "VARCHAR(45)" }],
                    indexes: [{ kind: "primary", columns: ["id"] }],
                    foreign_keys: [],
                },
            }]]);
            // Sent with the figure, which is saved with the edit.
            expect(target.sentFigures).toEqual([["orders"]]);
            expect(target.catalog.table("orders")?.columns).toHaveLength(2);
            expect(target.history.entries).toEqual([
                { label: "Place Table orders", done: true }]);
        });

        it("goes on undo, sending the inverse, and comes back on redo", () => {
            tools.down("table", probe);
            target.edit.commit("t", "enter");
            target.edit.commit("id", "enter");
            target.edit.cancel?.();

            target.history.undo();
            expect(target.shown.figures).toEqual([]);
            expect(target.catalog.table("t")).toBeUndefined();
            expect(target.sent[1]).toEqual([{ op: "drop_table", table: "t" }]);

            target.history.redo();
            expect(target.shown.figures).toHaveLength(1);
            expect(target.ops[2]).toEqual(["add_table"]);
        });

        it("is dropped when its name is escaped, or no column is entered", () => {
            tools.down("table", probe);
            target.edit.cancel?.();
            expect(target.shown.figures).toEqual([]);
            expect(target.catalog.table("table1")).toBeUndefined();

            tools.down("table", probe);
            target.edit.commit("t", "enter");
            target.edit.commit("", "enter");
            expect(target.shown.figures).toEqual([]);
            expect(target.sent).toEqual([]);
        });

        it("ends with the column typed when its input loses the focus", () => {
            tools.down("table", probe);
            target.edit.commit("t", "enter");
            target.edit.commit("code", "enter");
            const editsBefore = target.edits.length;
            target.edit.commit("label", "blur");

            // No next column; a type left out is the key's UUID first,
            // VARCHAR(45) after it.
            expect(target.edits).toHaveLength(editsBefore);
            expect(target.sent[0]?.[0]).toMatchObject({ table: { columns: [
                { name: "code", type: "UUID", nullable: false },
                { name: "label", type: "VARCHAR(45)" }] } });
        });

        it("takes a table msm refused up again at the column it names, "
            + "and sends it again once fixed", () => {
            tools.down("table", probe);
            target.edit.commit("product", "enter");
            target.edit.commit("id UUID", "enter");
            target.edit.commit("price VARCHR(45)", "enter");
            target.edit.commit("note TEXT", "enter");
            target.edit.commit("", "enter");
            expect(target.history.entries).toHaveLength(1);

            target.failures[0]?.("The edits to `shop` could not be made "
                + "(bad-request): column `price`: `VARCHR(45)` is not a MariaDB "
                + "data type");

            // Out of the history, nothing sent to undo; the columns kept.
            expect(target.history.entries).toEqual([]);
            expect(target.sent).toHaveLength(1);
            expect(target.figure(target.shown.figures[0]!.id)).toBeDefined();
            expect(target.catalog.table("product")?.columns.map((column) => {
                return column.name;
            })).toEqual(["id", "price", "note", ""]);
            expect(target.hints.at(-1)).toContain("is not a MariaDB data type");
            expect(target.edit.text).toBe("price VARCHR(45)");

            target.edit.commit("price DECIMAL(10,2)", "enter");
            // On to the empty row, where Enter sends it again.
            expect(target.edit.text).toBe("");
            target.edit.commit("", "enter");
            expect(target.sent[1]?.[0]).toMatchObject({ table: { columns: [
                { name: "id", type: "UUID" },
                { name: "price", type: "DECIMAL(10,2)" },
                { name: "note", type: "TEXT" }] } });
            expect(target.history.entries).toHaveLength(1);
        });

        it("takes a refused table up at its name where msm names no column",
            () => {
                tools.down("table", probe);
                target.edit.commit("t", "enter");
                target.edit.commit("id UUID", "enter");
                target.edit.commit("", "enter");

                target.failures[0]?.("The edits could not be made "
                    + "(name-taken): `t` exists already");
                expect(target.edit.label).toBe("Table name");
                target.edit.commit("t2", "enter");
                target.edit.commit("", "enter");

                expect(target.sent[1]?.[0]).toMatchObject({ table: {
                    name: "t2", columns: [{ name: "id", type: "UUID" }] } });
            });

        it("asks again for a name taken, or a column entered twice", () => {
            tools.down("table", probe);
            target.edit.commit("Customer", "enter");
            expect(target.hints.at(-1)).toBe(
                "A table or view named Customer exists already.");
            expect(target.edit.label).toBe("Table name");

            target.edit.commit("t", "enter");
            target.edit.commit("id", "enter");
            target.edit.commit("ID INT", "enter");
            expect(target.hints.at(-1)).toBe("The table has a column ID already.");
        });
    });

    describe("relationships", () => {
        beforeEach(figuresOfTables);

        it("adds a 1:n relationship's column and foreign key, and draws it "
            + "from the table that has it", () => {
            at("order");
            tools.down("rel1n", probe);
            expect(target.hints.at(-1)).toBe(
                "'order' selected. Please select the Referenced Table.");
            expect(target.highlighted?.figures).toEqual(["f-order"]);

            at("customer");
            tools.down("rel1n", probe);
            expect(target.ops).toEqual([["add_column", "add_foreign_key"]]);
            expect(target.shown.connections).toEqual([expect.objectContaining({
                foreignKey: "fk_order_customer", table: "order",
                startFigure: "f-order", endFigure: "f-customer" })]);
            expect(target.catalog.table("order")?.columns.at(-1)?.name)
                .toBe("customer_id");
            expect(target.hints.at(-1)).toBe(
                "Relationship between 'order' and 'customer' created.");
            expect(target.doneCount).toBe(1);

            target.history.undo();
            expect(target.shown.connections).toEqual([]);
            expect(target.ops[1]).toEqual(["drop_foreign_key", "drop_column"]);
        });

        it("asks for another table where the referenced one has no key", () => {
            at("order");
            tools.down("rel11", probe);
            at("log");
            tools.down("rel11", probe);

            expect(target.hints.at(-1)).toBe("'log' has no Primary Key. Please "
                + "add a PK or select another Table.");
            expect(target.sent).toEqual([]);
            // Still waiting for the referenced table.
            at("customer");
            tools.down("rel11", probe);
            expect(target.ops[0]).toEqual(["add_column", "add_index",
                "add_foreign_key"]);
        });

        it("joins two tables through a new table placed between them", () => {
            at("order");
            tools.down("relnm", probe);
            at("customer");
            tools.down("relnm", probe);

            const joining = target.shown.figures.at(-1)!;
            expect(joining).toMatchObject({ name: "order_has_customer",
                left: 150, top: 100 });
            expect(target.shown.connections.map((connection) => {
                return [connection.startFigure, connection.endFigure];
            })).toEqual([[joining.id, "f-order"], [joining.id, "f-customer"]]);
            expect(target.ops).toEqual([["add_table"]]);
        });

        it("picks existing columns, then the referenced ones", () => {
            at("order", "buyer");
            tools.down("relpick", probe);
            at("order", "seller");
            tools.down("relpick", probe);
            expect(target.panelShown).toMatchObject({
                title: "Foreign Key Columns",
                columns: ["buyer UUID", "seller UUID"],
                button: true,
            });
            expect(target.highlighted?.rows).toEqual([
                { figureId: "f-order", column: "buyer" },
                { figureId: "f-order", column: "seller" },
            ]);

            // Another table's column: one foreign key has one table.
            at("customer", "id");
            tools.down("relpick", probe);
            expect(target.hints.at(-1)).toBe(
                "Foreign Key columns must belong to the same table.");

            tools.pickReferenced();
            expect(target.panelShown).toMatchObject({
                title: "Referenced Columns", current: 0, button: false });
            at("customer", "id");
            tools.down("relpick", probe);
            at("order", "id");
            tools.down("relpick", probe);
            expect(target.hints.at(-1)).toBe(
                "Referenced columns must belong to the same table.");
            at("customer", "name");
            tools.down("relpick", probe);

            expect(target.sent).toEqual([[{ op: "add_foreign_key",
                table: "order", foreign_key: { name: "fk_order_customer",
                    columns: ["buyer", "seller"],
                    references: { table: "customer", columns: ["id", "name"] },
                } }]]);
            expect(target.panelShown).toBeUndefined();
        });

        it("takes one column and then another table's as the reference", () => {
            at("order", "buyer");
            tools.down("relpick", probe);
            at("customer", "id");
            tools.down("relpick", probe);

            expect(target.ops).toEqual([["add_foreign_key"]]);
            expect(target.shown.connections).toHaveLength(1);
        });

        it("adds new columns where the table, not a column, is picked", () => {
            at("order");
            tools.down("relpick", probe);
            at("customer");
            tools.down("relpick", probe);

            expect(target.ops).toEqual([["add_column", "add_foreign_key"]]);
        });

        it("says it is cancelled once the tool is put down half-way", () => {
            at("order");
            tools.down("rel1n", probe);
            tools.cancel();

            expect(target.hints.at(-1)).toBe("Cancelled.");
            expect(target.highlighted).toBeUndefined();
        });
    });

    describe("diagram objects", () => {
        it("places a text object, and goes back to the pointer", () => {
            tools.down("note", probe);

            expect(target.shown.figures[0]).toMatchObject({ type: "NoteFigure",
                name: "text1", text: "Text", left: 100, top: 51 });
            expect(target.history.entries[0]?.label).toBe("Place Text Object text1");
            expect(target.doneCount).toBe(1);
            expect(target.sent).toEqual([]);
        });

        it("places a picture picked, at most 400 wide", async () => {
            target.picked = { dataUrl: "data:image/png;base64,AA", width: 800,
                height: 400 };
            tools.down("image", probe);
            await Promise.resolve();
            await Promise.resolve();

            expect(target.shown.figures[0]).toMatchObject({ type: "ImageFigure",
                name: "image1", width: 400, height: 200,
                image: "data:image/png;base64,AA" });
        });

        it("drags out a layer, but not a tiny one", () => {
            let session = tools.down("layer", probe)!;
            target.point = { x: 102, y: 52 };
            session.finish?.(probe);
            expect(target.hints.at(-1)).toBe("Please select a larger area.");
            expect(target.shown.layers).toEqual([]);

            target.point = { x: 0, y: 0 };
            session = tools.down("layer", probe)!;
            target.point = { x: 300, y: 200 };
            session.move?.(probe);
            session.finish?.(probe);
            expect(target.shown.layers[0]).toMatchObject({ name: "New Layer",
                left: 0, top: 0, width: 300, height: 200, color: "#F0F1FE" });

            target.history.undo();
            expect(target.shown.layers).toEqual([]);
        });

        it("erases a figure and its connections, which undo brings back", () => {
            figuresOfTables();
            target.shown.connections.push({ id: "c", foreignKey: "fk",
                table: "order", startFigure: "f-order", endFigure: "f-customer",
                visible: true });
            at("customer");
            tools.down("eraser", probe);

            expect(target.figure("f-customer")).toBeUndefined();
            expect(target.shown.connections).toEqual([]);
            expect(target.sent).toEqual([]);

            target.history.undo();
            expect(target.figure("f-customer")).toBeDefined();
            expect(target.shown.connections).toHaveLength(1);
        });

        it("places a routine group named as entered", () => {
            tools.down("routineGroup", probe);
            target.edit.commit("billing", "enter");

            expect(target.shown.figures[0]).toMatchObject({
                type: "RoutineGroupFigure", name: "billing", routines: [] });
            expect(target.history.entries[0]?.label)
                .toBe("Place Routine Group billing");
        });

        it("adds a procedure to a routine group, made in the SQL", () => {
            target.shown.figures.push({ id: "g", type: "RoutineGroupFigure",
                name: "billing", routines: [], left: 0, top: 0 });
            tools.addRoutine("g");
            target.edit.commit("charge", "enter");

            expect(target.figure("g")?.routines).toEqual(["charge"]);
            expect(target.sent).toEqual([[{ op: "add_routine", routine: {
                name: "charge", kind: "procedure", parameters: [],
                body: "BEGIN\nEND" } }]]);
            expect(target.catalog.routine("charge")).toBeDefined();
        });

        it("places a view named as entered, with a placeholder SELECT", () => {
            tools.down("view", probe);
            target.edit.commit("open_orders", "enter");

            expect(target.shown.figures[0]).toMatchObject({ type: "ViewFigure",
                name: "open_orders", view: "open_orders" });
            expect(target.sent).toEqual([[{ op: "add_view", view: {
                name: "open_orders", definition: "SELECT 1" } }]]);
            expect(target.catalog.view("view1")).toBeUndefined();
        });
    });
});
