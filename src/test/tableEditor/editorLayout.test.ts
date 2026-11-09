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

import { belowActive } from "../../tableEditor/editorLayout.js";

const SIDE_BY_SIDE = 0;
const STACKED = 1;

describe("where a table editor goes below the active group", () => {
    it("splits a group alone, or one only beside others", () => {
        // A group alone, as VS Code reports it: stacked.
        expect(belowActive({ orientation: STACKED, groups: [{}] }, 1))
            .toBe("split");
        expect(belowActive({ orientation: SIDE_BY_SIDE, groups: [{}] }, 1))
            .toBe("split");
        expect(belowActive({ orientation: SIDE_BY_SIDE,
            groups: [{}, {}] }, 2)).toBe("split");
    });

    it("takes the group below where the active one is split already", () => {
        const layout = { orientation: STACKED, groups: [{}, {}] };
        expect(belowActive(layout, 1)).toEqual({ column: 2 });
        // The lowest of the stack is the one to go in.
        expect(belowActive(layout, 2)).toBe("active");
    });

    it("counts the view columns through branches", () => {
        // Left: one group; right: split top and bottom, the top one split
        // side by side again.
        const layout = { orientation: SIDE_BY_SIDE, groups: [
            {},
            { groups: [{ groups: [{}, {}] }, {}] },
        ] };
        expect(belowActive(layout, 1)).toBe("split");
        // Columns 2 and 3 are side by side: column 2 is split again.
        expect(belowActive(layout, 2)).toBe("split");
        expect(belowActive(layout, 4)).toBe("active");
        const stacked = { orientation: SIDE_BY_SIDE, groups: [
            { groups: [{}, {}] },
            {},
        ] };
        expect(belowActive(stacked, 1)).toEqual({ column: 2 });
        expect(belowActive(stacked, 3)).toBe("split");
    });
});
