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

import { OBJECT_TREE_DRAG_MIMES } from "../../modeler/modelerProtocol.js";
import { CONNECTIONS_VIEW_ID } from "../../tree/connectionsTreeProvider.js";
import { MSM_PROJECTS_VIEW_ID } from "../../tree/msmProjectsTreeProvider.js";
import { DraggedObjects } from "../../tree/schemaTree.js";

describe("DraggedObjects", () => {
    it("hands a drag's objects to one drop, while the drag is recent",
        () => {
            let now = 1_000;
            const dragged = new DraggedObjects(60_000, () => { return now; });

            dragged.remember("a");
            expect(dragged.take()).toBe("a");
            expect(dragged.take()).toBeUndefined();

            dragged.remember("b");
            now += 60_001;
            expect(dragged.take()).toBeUndefined();

            dragged.remember("c");
            dragged.remember(undefined);
            expect(dragged.take()).toBeUndefined();
        });

    it("knows the trees' drag types by their view ids, as VS Code makes them",
        () => {
            expect(OBJECT_TREE_DRAG_MIMES).toEqual(
                [CONNECTIONS_VIEW_ID, MSM_PROJECTS_VIEW_ID].map((id) => {
                    return `application/vnd.code.tree.${id.toLowerCase()}`;
                }));
        });
});
