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
    DIAGRAM_VIEWS_KEY,
    DiagramViews,
} from "../../modeler/diagramViews.js";
import type { IDiagramView } from "../../modeler/modelerProtocol.js";
import { memoryMemento } from "../../tree/customFolders.js";

/** A memento, holding what an older version may have kept. */
const memento = (start?: unknown) => {
    const kept = memoryMemento();
    if (start !== undefined) {
        void kept.update(DIAGRAM_VIEWS_KEY, start);
    }

    return kept;
};

const VIEW: IDiagramView = { zoom: 0.75, x: 10, y: 20, mode: "2d",
    isoPreset: "iso", tilt: 0.6, turn: 0.8 };

describe("the diagrams' views", () => {
    it("keeps each source's diagrams apart", async () => {
        const store = memento();
        const views = new DiagramViews(store);
        await views.keep("a", "Main", VIEW);
        await views.keep("a", "Other", { ...VIEW, zoom: 2 });
        await views.keep("b", "Main", { ...VIEW, mode: "iso" });

        expect(views.of("a")).toEqual({ Main: VIEW,
            Other: { ...VIEW, zoom: 2 } });
        expect(views.of("b").Main.mode).toBe("iso");
        expect(views.of("c")).toEqual({});
        expect(store.get(DIAGRAM_VIEWS_KEY, undefined)).toBeDefined();
    });

    it("leaves out what is not a view, kept or offered", async () => {
        const views = new DiagramViews(memento({ a: {
            Main: VIEW,
            Broken: { zoom: "big" },
            Nan: { ...VIEW, x: Number.NaN },
        } }));
        expect(views.of("a")).toEqual({ Main: VIEW });

        await views.keep("a", "Bad", { ...VIEW, mode: "3d" } as never);
        expect(Object.keys(views.of("a"))).toEqual(["Main"]);
        expect(new DiagramViews(memento("junk")).of("a")).toEqual({});
    });
});
