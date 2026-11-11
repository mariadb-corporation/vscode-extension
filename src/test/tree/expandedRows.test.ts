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

import { memoryMemento } from "../../tree/customFolders.js";
import { ExpandedRows } from "../../tree/expandedRows.js";

describe("the rows left open", () => {
    it("follow what they show to new ids", async () => {
        const rows = new ExpandedRows(memoryMemento(), "rows");
        await rows.add("msmProject:/work/shop.msm.project");
        await rows.add("msmDiagrams:/work/shop.msm.project");
        await rows.add("msmProject:/work/other.msm.project");

        await rows.rename((id) => {
            return id.replace("/work/shop.msm.project", "/work/store.msm.project");
        });

        expect(rows.has("msmProject:/work/store.msm.project")).toBe(true);
        expect(rows.has("msmDiagrams:/work/store.msm.project")).toBe(true);
        expect(rows.has("msmProject:/work/shop.msm.project")).toBe(false);
        expect(rows.has("msmProject:/work/other.msm.project")).toBe(true);
    });
});
