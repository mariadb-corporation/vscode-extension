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

import { Color } from "three";
import { describe, expect, it } from "vitest";

import { opaqueColor, paperColor } from "../../src/canvas/theme.js";

describe("paperColor", () => {
    it("drops a hex colour's alpha, which three.js cannot read", () => {
        expect(opaqueColor("#0000005c")).toBe("#000000");
        expect(opaqueColor("#0003")).toBe("#000");
        expect(opaqueColor("#1e1e1e")).toBe("#1e1e1e");
        expect(opaqueColor("#abc")).toBe("#abc");
        expect(opaqueColor("rgba(0, 0, 0, 0.36)"))
            .toBe("rgba(0, 0, 0, 0.36)");
        // What three.js reads without a warning.
        expect(new Color(opaqueColor("#0000005c")).getHexString())
            .toBe("000000");
    });

    it("lifts a dark theme's background a little towards white", () => {
        expect(paperColor("#1e1e1e", true)).toBe("#303030");
        expect(paperColor("#000000", true)).toBe("#141414");
    });

    it("keeps a light theme's background as it is", () => {
        expect(paperColor("#ffffff", false)).toBe("#ffffff");
    });
});
