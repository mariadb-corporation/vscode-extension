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

import { compareVersions, newestFirst } from "../versionOrder.js";

describe("compareVersions", () => {
    it("compares part by part, as numbers, not as text", () => {
        expect(compareVersions("26.10.0", "26.9.4")).toBeGreaterThan(0);
        expect(compareVersions("26.9.4", "26.10.0")).toBeLessThan(0);
        expect(compareVersions("26.10.0", "26.10.0")).toBe(0);
        expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
    });

    it("takes a missing part as 0", () => {
        expect(compareVersions("26.10", "26.10.0")).toBe(0);
        expect(compareVersions("26.10.1", "26.10")).toBeGreaterThan(0);
    });

    it("reads a dash as a separator, a part's leading digits, and text as 0",
        () => {
            expect(compareVersions("26.10.0-1", "26.10.0")).toBeGreaterThan(0);
            expect(compareVersions("1.2.3beta", "1.2.3")).toBe(0);
            expect(compareVersions("x.1", "0.1")).toBe(0);
        });

    it("allows a leading v", () => {
        expect(compareVersions("v12.3.2", "12.3.2")).toBe(0);
    });
});

describe("newestFirst", () => {
    it("orders versions by their numbers, not their text", () => {
        expect(newestFirst(["11.9.4", "12.3.2", "11.10.1", "10.6.21"]))
            .toEqual(["12.3.2", "11.10.1", "11.9.4", "10.6.21"]);
        expect(newestFirst([])).toEqual([]);
    });

    it("sorts a copy, leaving what it was given", () => {
        const given = ["1.0.0", "1.10.0", "1.9.0"];

        expect(newestFirst(given)).toEqual(["1.10.0", "1.9.0", "1.0.0"]);
        expect(given).toEqual(["1.0.0", "1.10.0", "1.9.0"]);
    });
});
