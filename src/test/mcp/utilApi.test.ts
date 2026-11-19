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

import { START_TIMEOUT_MS, UtilApi } from "../../mcp/utilApi.js";
import { createFakeToolCaller } from "../helpers.js";

const STARTED = { task_id: "t1", status: "running" };

describe("UtilApi", () => {
    it("starts every utility with its arguments, and options only when given",
        async () => {
            const { caller: c, calls } = createFakeToolCaller([STARTED]);
            const api = new UtilApi(c);

            expect(await api.dumpInstance("c1", "/d")).toEqual(STARTED);
            await api.dumpSchemas("c1", ["a"], "/d", { threads: 2 });
            await api.dumpTables("c1", "a", ["t"], "/d", {});
            await api.exportTable("c1", "a.t", "/f.tsv");
            await api.loadDump("c1", "/d", { schema: "b" });
            await api.importTable("c1", ["/a", "/b"]);
            await api.copyInstance("c1", "c2");
            await api.copySchemas("c1", ["a"], "c2");
            await api.copyTables("c1", "a", ["t"], "c2", { schema: "z" });

            expect(calls).toEqual([
                { name: "util.dump_instance", args: { connection_id: "c1", output_url: "/d" }, timeoutMs: START_TIMEOUT_MS },
                { name: "util.dump_schemas", args: { connection_id: "c1", schemas: ["a"], output_url: "/d", options: { threads: 2 } }, timeoutMs: START_TIMEOUT_MS },
                { name: "util.dump_tables", args: { connection_id: "c1", schema: "a", tables: ["t"], output_url: "/d" }, timeoutMs: START_TIMEOUT_MS },
                { name: "util.export_table", args: { connection_id: "c1", table: "a.t", output_url: "/f.tsv" }, timeoutMs: START_TIMEOUT_MS },
                { name: "util.load_dump", args: { connection_id: "c1", url: "/d", options: { schema: "b" } }, timeoutMs: START_TIMEOUT_MS },
                { name: "util.import_table", args: { connection_id: "c1", urls: ["/a", "/b"] }, timeoutMs: START_TIMEOUT_MS },
                { name: "util.copy_instance", args: { connection_id: "c1", target_connection_id: "c2" }, timeoutMs: START_TIMEOUT_MS },
                { name: "util.copy_schemas", args: { connection_id: "c1", schemas: ["a"], target_connection_id: "c2" }, timeoutMs: START_TIMEOUT_MS },
                { name: "util.copy_tables", args: { connection_id: "c1", schema: "a", tables: ["t"], target_connection_id: "c2", options: { schema: "z" } }, timeoutMs: START_TIMEOUT_MS },
            ]);
        });

    it("gives load_dump its extraction budget as an argument of its own",
        async () => {
            const { caller: c, calls } = createFakeToolCaller([STARTED, STARTED]);
            await new UtilApi(c).loadDump("c1", "/d.mariadb.dump.zip",
                { extraction_budget_mb: 512, threads: 2 });

            expect(calls[0].args).toEqual({ connection_id: "c1",
                url: "/d.mariadb.dump.zip", extraction_budget_mb: 512,
                options: { threads: 2 } });

            // a folder: the tool refuses it, so it is not sent
            await new UtilApi(c).loadDump("c1", "/d",
                { extraction_budget_mb: 512 });
            expect(calls[1].args).toEqual({ connection_id: "c1", url: "/d" });
        });

    it("inspects a dump, all of it or one schema", async () => {
        const answer = { url: "/d", kind: "dumpSchemas", schemas: [] };
        const { caller: c, calls } = createFakeToolCaller([answer, answer]);
        const api = new UtilApi(c);

        expect(await api.inspectDump("/d")).toEqual(answer);
        await api.inspectDump("/d", "shop");

        expect(calls.map((call) => { return [call.name, call.args]; }))
            .toEqual([["util.inspect_dump", { url: "/d" }],
                ["util.inspect_dump", { url: "/d", schema: "shop" }]]);
    });
});
