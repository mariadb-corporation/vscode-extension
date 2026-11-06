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


import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { projectOfScriptFile } from "../../msm/msmFields.js";
import { SettledSaves } from "../../msm/settledSaves.js";

describe("projectOfScriptFile", () => {
    it("finds the project of its development script and section files",
        () => {
            expect(projectOfScriptFile(
                "/work/shop.msm.project/development/shop_next.sql"))
                .toBe("/work/shop.msm.project");
            expect(projectOfScriptFile("/work/shop.msm.project/development/"
                + "sections/160_schema_diagrams.sql"))
                .toBe("/work/shop.msm.project");
            expect(projectOfScriptFile(
                "C:\\work\\Shop.MSM.project\\development\\shop_next.sql"))
                .toBe("C:\\work\\Shop.MSM.project");
        });

    it("leaves out releases, other files and other folders", () => {
        expect(projectOfScriptFile("/work/shop.msm.project/releases/"
            + "versions/shop_1.0.0.sql")).toBeUndefined();
        expect(projectOfScriptFile(
            "/work/shop.msm.project/development/README.md")).toBeUndefined();
        expect(projectOfScriptFile("/work/shop/development/shop_next.sql"))
            .toBeUndefined();
    });
});

describe("SettledSaves", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("runs once per key after its saves settle", () => {
        const ran: string[] = [];
        const saves = new SettledSaves((key) => {
            ran.push(key);

            return Promise.resolve();
        }, 300);

        saves.run("a");
        vi.advanceTimersByTime(200);
        saves.run("a");
        saves.run("b");
        vi.advanceTimersByTime(299);
        expect(ran).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(ran).toEqual(["a", "b"]);

        saves.run("a");
        saves.dispose();
        vi.advanceTimersByTime(1_000);
        expect(ran).toEqual(["a", "b"]);
    });
});
