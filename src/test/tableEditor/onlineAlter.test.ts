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
    entryKey,
    generalOf,
    optionsOf,
    parseCount,
    parseSize,
    readTexts,
    sizeText,
    textsOf,
    withGeneral,
    withTable,
} from "../../tableEditor/onlineAlter.js";
import {
    ONLINE_ALTER_KEY,
    OnlineAlterStore,
} from "../../tableEditor/onlineAlterStore.js";
import { memoryMemento } from "../../tree/customFolders.js";

const GIB = 1024 ** 3;

describe("online ALTER TABLE settings", () => {
    it("writes a size in the largest whole unit, and reads it back", () => {
        expect(sizeText(10 * GIB)).toBe("10 GiB");
        expect(sizeText(256 * 1024 ** 2)).toBe("256 MiB");
        expect(sizeText(1536)).toBe("1536 B");
        expect(sizeText(0)).toBe("0");
        expect(sizeText(null)).toBe("unlimited");

        expect(parseSize("10 GiB")).toBe(10 * GIB);
        expect(parseSize("512M")).toBe(512 * 1024 ** 2);
        expect(parseSize("1.5g")).toBe(1.5 * GIB);
        expect(parseSize(" 4096 ")).toBe(4096);
        expect(parseSize("0")).toBe(0);
        expect(parseSize("Unlimited")).toBeNull();
        expect(parseSize("no limit")).toBeNull();
        expect(parseSize("lots")).toBeUndefined();
        expect(parseCount("12")).toBe(12);
        expect(parseCount("-1")).toBeUndefined();
        expect(parseCount("2.5")).toBeUndefined();
    });

    it("reads the tab's fields as an entry, an empty one taking the "
        + "inherited value", () => {
        const texts = textsOf({ enabled: false, maxRebuildBytes: 0,
            nboLock: null, lockWait: 30 });
        expect(texts).toEqual({ enabled: "off", maxRebuildBytes: "0",
            galeraMaxBytes: "", nboLock: "off", maxLockedBytes: "",
            lockWait: "30", maxRetries: "" });
        expect(readTexts(texts)).toEqual({ entry: { enabled: false,
            maxRebuildBytes: 0, nboLock: null, lockWait: 30 }, problems: [] });

        const empty = readTexts(textsOf({}));
        expect(empty.entry).toEqual({});

        const bad = readTexts({ ...texts, galeraMaxBytes: "big",
            maxRetries: "x", maxLockedBytes: "unlimited", nboLock: "SHARED" });
        expect(bad.entry).toMatchObject({ maxLockedBytes: null,
            nboLock: "SHARED" });
        expect(bad.problems).toHaveLength(2);
        expect(bad.problems[0]).toContain("Galera tables up to");
    });

    it("tells entries apart by their values, not their key order", () => {
        expect(entryKey({ lockWait: 5, enabled: true }))
            .toBe(entryKey({ enabled: true, lockWait: 5 }));
        expect(entryKey({ maxRebuildBytes: null }))
            .not.toBe(entryKey({}));
        expect(optionsOf({ enabled: true, lockWait: 5 }))
            .toEqual({ lockWait: 5 });
    });

    it("changes one part of the whole setting, keeping the rest", () => {
        const setting = { enabled: true, lockWait: 9,
            tables: { orders: { enabled: false } } };

        expect(generalOf(setting)).toEqual({ enabled: true, lockWait: 9 });
        expect(withGeneral(setting, { maxRetries: 1 })).toEqual(
            { maxRetries: 1, tables: { orders: { enabled: false } } });
        expect(withTable(setting, "items", { lockWait: 1 })).toEqual({
            enabled: true, lockWait: 9,
            tables: { orders: { enabled: false }, items: { lockWait: 1 } } });
        // The last table's entry dropped leaves no tables at all.
        expect(withTable(setting, "orders", null))
            .toEqual({ enabled: true, lockWait: 9 });
        expect(withTable(setting, "orders", {}))
            .toEqual({ enabled: true, lockWait: 9 });
    });
});

describe("OnlineAlterStore", () => {
    it("keeps a live table's entry by connection, schema and table, and "
        + "moves it on a rename", async () => {
        const memento = memoryMemento();
        const store = new OnlineAlterStore(memento);
        const orders = { connection: "dba@db:3306", schema: "shop",
            table: "orders" };
        expect(store.get(orders)).toEqual({});

        await store.set(orders, { maxRebuildBytes: 0 });
        await store.set({ ...orders, schema: "other" }, { enabled: false });
        expect(store.get(orders)).toEqual({ maxRebuildBytes: 0 });

        await store.rename(orders, "purchases");
        expect(store.get(orders)).toEqual({});
        expect(store.get({ ...orders, table: "purchases" }))
            .toEqual({ maxRebuildBytes: 0 });

        // Emptied, it goes.
        await store.set({ ...orders, table: "purchases" }, {});
        expect(Object.keys(memento.get(ONLINE_ALTER_KEY, {}))).toHaveLength(1);
    });
});
