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
import {
    connectionSourceKey,
    isConnectionSourceKey,
    projectSourceKey,
} from "../../modeler/modelSources.js";
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
        // The REST view, level from the page's front.
        await views.keep("b", "Rest", { ...VIEW, mode: "front" });

        expect(views.of("a")).toEqual({ Main: VIEW,
            Other: { ...VIEW, zoom: 2 } });
        expect(views.of("b").Main.mode).toBe("iso");
        expect(views.of("b").Rest.mode).toBe("front");
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

    it("drops the views of the diagrams a source no longer has", async () => {
        const store = memento();
        const views = new DiagramViews(store);
        await views.keep("a", "Main", VIEW);
        await views.keep("a", "Old", VIEW);
        await views.keep("b", "Main", VIEW);

        await views.prune("a", ["Main", "New"]);
        expect(Object.keys(views.of("a"))).toEqual(["Main"]);

        // A source left with none goes; the others stay.
        await views.prune("a", []);
        expect(store.get(DIAGRAM_VIEWS_KEY, {})).toEqual({ b: { Main: VIEW } });
    });

    it("drops one diagram's view, for a new diagram of its name",
        async () => {
            const views = new DiagramViews(memento());
            await views.keep("a", "Main", VIEW);
            await views.keep("a", "Other", VIEW);
            await views.forget("a", "Main");
            await views.forget("c", "Main");

            expect(Object.keys(views.of("a"))).toEqual(["Other"]);
        });

    it("moves a renamed diagram's view to its new name", async () => {
        const views = new DiagramViews(memento());
        await views.keep("a", "Main", VIEW);
        await views.keep("a", "Other", { ...VIEW, zoom: 2 });
        await views.rename("a", "Main", "Overview");
        await views.rename("a", "Gone", "Else");

        expect(views.of("a")).toEqual({ Other: { ...VIEW, zoom: 2 },
            Overview: VIEW });
    });

    it("drops a stale view of the new name where the renamed one has none",
        async () => {
            const views = new DiagramViews(memento());
            await views.keep("a", "Overview", VIEW);
            await views.keep("a", "Other", VIEW);
            await views.rename("a", "Main", "Overview");

            expect(Object.keys(views.of("a"))).toEqual(["Other"]);
        });

    it("drops a deleted connection's and a removed project's views",
        async () => {
            const views = new DiagramViews(memento());
            const world = connectionSourceKey("dba@db:3306", "world");
            const sakila = connectionSourceKey("dba@db:3306", "sakila");
            const other = connectionSourceKey("dba@db:3307", "world");
            const project = projectSourceKey("/work/shop");
            for (const key of [world, sakila, other, project]) {
                await views.keep(key, "Main", VIEW);
            }

            await views.forgetSources((key) => {
                return isConnectionSourceKey(key, "dba@db:3306");
            });
            await views.forgetSources((key) => { return key === project; });

            expect(views.of(world)).toEqual({});
            expect(views.of(sakila)).toEqual({});
            expect(views.of(project)).toEqual({});
            expect(views.of(other)).toEqual({ Main: VIEW });
            expect(isConnectionSourceKey("junk", "dba@db:3306")).toBe(false);
        });

    it("moves a project's views with its folder", async () => {
        const views = new DiagramViews(memento());
        const before = projectSourceKey("/work/shop.msm.project");
        const after = projectSourceKey("/work/store.msm.project");
        await views.keep(before, "Main", VIEW);
        await views.keep("other", "Main", { ...VIEW, zoom: 2 });

        await views.moveSource(before, after);

        expect(views.of(after)).toEqual({ Main: VIEW });
        expect(views.of(before)).toEqual({});
        expect(views.of("other").Main.zoom).toBe(2);
    });
});
