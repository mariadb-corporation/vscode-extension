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
    IModelConnection,
    IModelDiagram,
    IOutlineTable,
} from "../../../src/modeler/modelFormat.js";
import { syncConnections } from "../../src/modeler/connectionSync.js";

const key = (name: string, column: string, parent: string) => {
    return { name, columns: [column],
        references: { schema: null, table: parent, columns: ["id"] } };
};

/** The notes_app project: an n:m table between cart and product. */
const tables = (cartKey = "fk_cart_has_product_cart"): IOutlineTable[] => {
    return [
        { name: "product", columns: [{ name: "id", type: "UUID" }] },
        { name: "cart", columns: [{ name: "id", type: "UUID" }] },
        { name: "cart_has_product", columns: [
            { name: "cart_id", type: "UUID" },
            { name: "product_id", type: "UUID" }],
        foreign_keys: [key(cartKey, "cart_id", "cart"),
            key("fk_cart_has_product_product", "product_id", "product")] },
    ];
};

const diagram = (connections: IModelConnection[]): IModelDiagram => {
    const figure = (id: string, table: string) => {
        return { id, type: "TableFigure", name: table, table, left: 0, top: 0 };
    };

    return {
        name: "Diagram 1", width: 1000, height: 1000, layers: [],
        figures: [figure("p", "product"), figure("c", "cart"),
            figure("j", "cart_has_product")],
        connections,
    };
};

const line = (id: string, foreignKey: string, end: string,
    extra: Partial<IModelConnection> = {}): IModelConnection => {
    return { id, foreignKey, table: "cart_has_product", startFigure: "j",
        endFigure: end, visible: true, ...extra };
};

let ids = 0;
const newId = (): string => { ids += 1; return `new${ids}`; };

describe("syncConnections", () => {
    it("draws every foreign key between two tables shown", () => {
        // The project as found: both of cart_has_product's lines gone.
        const shown = diagram([]);

        expect(syncConnections(shown, tables(), newId)).toBe(true);
        expect(shown.connections.map((connection) => {
            return [connection.foreignKey, connection.startFigure,
                connection.endFigure];
        })).toEqual([
            ["fk_cart_has_product_cart", "j", "c"],
            ["fk_cart_has_product_product", "j", "p"],
        ]);
    });

    it("keeps a line and its settings when its key is renamed", () => {
        const kept = line("l1", "fk_order_has_product_order", "c",
            { middleSegmentOffset: -30, drawSplit: true });
        const shown = diagram([kept,
            line("l2", "fk_cart_has_product_product", "p")]);

        expect(syncConnections(shown, tables(), newId)).toBe(true);
        expect(shown.connections).toHaveLength(2);
        expect(shown.connections[0]).toBe(kept);
        expect(kept).toMatchObject({ id: "l1",
            foreignKey: "fk_cart_has_product_cart",
            middleSegmentOffset: -30, drawSplit: true });
    });

    it("changes nothing where the lines are the keys", () => {
        const shown = diagram([
            line("l1", "FK_CART_HAS_PRODUCT_CART", "c"),
            line("l2", "fk_cart_has_product_product", "p")]);

        expect(syncConnections(shown, tables("fk_cart_has_product_cart"),
            newId)).toBe(true);
        // Only the case of the name followed.
        expect(shown.connections[0].foreignKey)
            .toBe("fk_cart_has_product_cart");
        expect(syncConnections(shown, tables(), newId)).toBe(false);
    });

    it("drops a line whose key is gone, and a second line of one key", () => {
        const withoutCart = tables();
        withoutCart[2].foreign_keys = [withoutCart[2].foreign_keys![1]];
        const shown = diagram([
            line("l1", "fk_cart_has_product_cart", "c"),
            line("l2", "fk_cart_has_product_product", "p"),
            line("l3", "fk_cart_has_product_product", "p")]);

        expect(syncConnections(shown, withoutCart, newId)).toBe(true);
        expect(shown.connections.map((connection) => { return connection.id; }))
            .toEqual(["l2"]);
    });

    it("drops a line whose figure is gone", () => {
        const shown = diagram([line("l1", "fk_cart_has_product_cart", "x"),
            line("l2", "fk_cart_has_product_product", "p")]);
        syncConnections(shown, tables(), newId);

        // The cart key gets a line of its own again, to the cart's figure.
        expect(shown.connections.map((connection) => {
            return [connection.id, connection.endFigure];
        })).toEqual([["l2", "p"], [expect.stringMatching(/^new/), "c"]]);
    });

    it("re-points a name onto another table, by what the keys are", () => {
        // The name now belongs to the key onto product: the cart line
        // takes the key onto cart, not the card it does not point at.
        const swapped = tables("fk_cart_has_product_cart");
        const keys = swapped[2].foreign_keys!;
        keys[0] = { ...keys[0], name: "fk_x" };
        keys[1] = { ...keys[1], name: "fk_cart_has_product_cart" };
        const cartLine = line("l1", "fk_cart_has_product_cart", "c");
        const shown = diagram([cartLine]);
        syncConnections(shown, swapped, newId);

        expect(cartLine.foreignKey).toBe("fk_x");
    });

    it("keeps a line on each of two figures of one table", () => {
        const shown = diagram([line("l1", "fk_cart_has_product_cart", "c"),
            line("l2", "fk_cart_has_product_product", "p")]);
        shown.figures.push({ id: "c2", type: "TableFigure", name: "cart",
            table: "cart", left: 0, top: 0 });
        shown.connections.push(line("l3", "fk_cart_has_product_cart", "c2"));
        syncConnections(shown, tables(), newId);

        expect(shown.connections.map((connection) => { return connection.id; }))
            .toEqual(["l1", "l2", "l3"]);
    });

    it("leaves out keys onto another schema's tables", () => {
        const other = tables();
        other[2].foreign_keys![0].references.schema = "archive";
        const shown = diagram([line("l1", "fk_cart_has_product_cart", "c")]);
        syncConnections(shown, other, newId, "notes_app");

        expect(shown.connections.map((connection) => {
            return connection.foreignKey;
        })).toEqual(["fk_cart_has_product_product"]);

        const same = tables();
        same[2].foreign_keys![0].references.schema = "NOTES_APP";
        const kept = diagram([line("l1", "fk_cart_has_product_cart", "c")]);
        syncConnections(kept, same, newId, "notes_app");
        expect(kept.connections[0].id).toBe("l1");
    });
});
