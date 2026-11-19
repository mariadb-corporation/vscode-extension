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

import type { IDumpInfo, IDumpSchemaInfo } from "../../mcp/utilApi.js";
import { DumpInspection } from "../../util/dumpInspection.js";
import { groupKey, USERS_KEY } from "../../util/dumpSelection.js";

const schema = (name: string, tables: string[],
    count = tables.length): IDumpSchemaInfo => {
    return {
        name, tables, table_count: count, views: [], view_count: 0,
        functions: [], function_count: 0, procedures: [], procedure_count: 0,
        events: [], event_count: 0,
    };
};

const dump = (schemas: IDumpSchemaInfo[]): IDumpInfo => {
    return {
        url: "/d", format: "folder", kind: "dumpSchemas", complete: true,
        source: { server: null, server_version: null, user: null },
        begin: null, end: null, options: {}, includes_users: false,
        users: [], user_count: 0, schema_count: schemas.length, schemas,
        data_file_bytes: 0, size_bytes: 0,
    };
};

/** Two schemas, each listing one of its two tables. */
const CAPPED = dump([schema("a", ["a1"], 2), schema("b", ["b1"], 2)]);

/**
 * An inspection over a fake util.inspect_dump whose answers wait until
 * released.
 */
const setUp = () => {
    const calls: string[] = [];
    const pending: Array<() => void> = [];
    const inspection = new DumpInspection(async (url, name) => {
        calls.push(name === undefined ? url : `${url} ${name}`);
        await new Promise<void>((resolve) => { pending.push(resolve); });

        return name === undefined ? CAPPED
            : dump([schema(name, [`${name}1`, `${name}2`])]);
    }, undefined, () => { /* no log */ });
    const release = async (): Promise<void> => {
        while (pending.length > 0) {
            pending.shift()!();
            await new Promise((resolve) => { setTimeout(resolve, 0); });
        }
    };

    return { calls, inspection, release };
};

describe("DumpInspection", () => {
    it("reads a dump, with the boxes to start with", async () => {
        const { inspection, release } = setUp();
        const read = inspection.read("/d");
        await release();

        expect(await read).toEqual({ type: "inspected", path: "/d",
            info: CAPPED, excluded: [USERS_KEY] });
    });

    it("keeps only the newest read", async () => {
        const { inspection, release } = setUp();
        const first = inspection.read("/old");
        const second = inspection.read("/d");
        await release();

        expect(await first).toBeUndefined();
        expect((await second)?.path).toBe("/d");
    });

    it("reads a schema once, and keeps two read at once", async () => {
        const { calls, inspection, release } = setUp();
        const read = inspection.read("/d");
        await release();
        await read;

        const a = inspection.readSchema("a");
        const again = inspection.readSchema("a");
        const b = inspection.readSchema("b");
        await release();
        await Promise.all([a, again]);
        const last = await b;

        expect(calls).toEqual(["/d", "/d a", "/d b"]);
        expect(last?.info?.schemas.map((entry) => { return entry.tables; }))
            .toEqual([["a1", "a2"], ["b1", "b2"]]);
        // the same dump read again: the boxes stay as they are
        expect(last?.excluded).toBeUndefined();
    });

    it("reads every name a whole kind unticked needs, at once", async () => {
        const { calls, inspection, release } = setUp();
        const read = inspection.read("/d");
        await release();
        await read;

        const options = inspection.loadOptions("/d", [USERS_KEY,
            groupKey("a", "tables"), groupKey("b", "tables")]);
        await release();

        expect(calls).toEqual(["/d", "/d a", "/d b"]);
        expect(await options).toEqual({ options: {
            excludeTables: ["a.a1", "a.a2", "b.b1", "b.b2"] } });
    });
});
