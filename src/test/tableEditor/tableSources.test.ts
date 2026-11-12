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

import type { IMsmOnlineAlterSettings, IMsmSchemaEdit } from "../../mcp/msmApi.js";
import type { ITaskState } from "../../mcp/taskApi.js";
import type { ISchemaDefinition } from "../../modeler/modelFormat.js";
import {
    type ILspMigrationStatement,
    type ILspRun,
    LspEdit,
} from "../../tableEditor/lspEdit.js";
import type { IOnlineAlterEntry } from "../../tableEditor/onlineAlter.js";
import {
    LiveTableSource,
    ONLINE_ALTER_COMMENT,
    onlineAlterOutcome,
    PartlyAppliedError,
    projectOnlineAlter,
    ProjectTableSource,
    type IOnlineAlterOutcome,
} from "../../tableEditor/tableSources.js";

const DEFAULTS = { maxRebuildBytes: 10 * 1024 ** 3,
    galeraMaxBytes: 256 * 1024 ** 2, nboLock: null, maxLockedBytes: null,
    lockWait: 5, maxRetries: 10 };

/**
 * @param migration What the binary answers an edit with.
 *
 * @returns An LspEdit whose binary answers so, and the requests it got.
 */
const fakeLsp = (migration: ILspMigrationStatement[], merges = true) => {
    const requests: string[][] = [];
    const run = (_binary: string, args: string[]): Promise<ILspRun> => {
        requests.push(args);
        if (args.includes("--ops")) {
            return Promise.resolve({ code: 0, stderr: "", stdout:
                JSON.stringify({ format: 1, ops: [],
                    ...(merges ? { merge_alters: true } : {}) }) });
        }

        return Promise.resolve({ code: 0, stderr: "", stdout: JSON.stringify(
            { migration, notes: [], outline: { schemas: [{ name: null,
                tables: [{ name: "orders", columns: [] }] }] } }) });
    };

    return { lsp: new LspEdit(() => { return Promise.resolve("lsp"); }, run),
        requests };
};

const RENAME: IMsmSchemaEdit = { op: "rename_table", table: "orders",
    new_name: "purchases" };

/** A live table whose online ALTERs answer as told. */
const liveSetUp = (migration: ILspMigrationStatement[], options: {
    entry?: IOnlineAlterEntry;
    outcome?: IOnlineAlterOutcome;
    defaults?: () => Promise<typeof DEFAULTS>;
} = {}) => {
    const executed: string[] = [];
    const runs: Array<[string, string, unknown]> = [];
    const entries = new Map<string, IOnlineAlterEntry>(options.entry
        === undefined ? [] : [["orders", options.entry]]);
    const source = new LiveTableSource("shop", "orders", {
        query: (sql) => {
            return Promise.resolve(sql.startsWith("SHOW CREATE TABLE")
                ? [{ "Create Table": "CREATE TABLE `orders` (`id` INT)" }]
                : sql.includes("TRIGGERS") ? []
                    : [{ TABLE_NAME: "purchases" }]);
        },
        execute: (sql) => {
            executed.push(sql);

            return Promise.resolve();
        },
        lsp: fakeLsp(migration).lsp,
        onlineAlter: {
            defaults: options.defaults
                ?? (() => { return Promise.resolve(DEFAULTS); }),
            get: (table) => { return entries.get(table) ?? {}; },
            set: (table, entry) => {
                entries.set(table, entry);

                return Promise.resolve();
            },
            rename: (table, name) => {
                const entry = entries.get(table);
                entries.delete(table);
                if (entry !== undefined) {
                    entries.set(name, entry);
                }

                return Promise.resolve();
            },
            run: (table, spec, limits) => {
                runs.push([table, spec, limits]);

                return Promise.resolve(options.outcome
                    ?? { applied: true, method: "INSTANT" });
            },
        },
    });

    return { source, executed, runs, entries };
};

const ALTER: ILspMigrationStatement = {
    sql: "ALTER TABLE `orders` ADD COLUMN `qty` INT, ADD INDEX `ix` (`qty`)",
    action: "alter", object: "table", table: "orders",
    spec: "ADD COLUMN `qty` INT, ADD INDEX `ix` (`qty`)" };
const OTHER: ILspMigrationStatement = {
    sql: "ALTER TABLE `lines` DROP FOREIGN KEY `fk`",
    action: "drop", object: "foreign_key", table: "lines",
    spec: "DROP FOREIGN KEY `fk`" };

describe("LspEdit", () => {
    it("asks for merged ALTERs only where the binary says it merges them",
        async () => {
            const merging = fakeLsp([]);
            await merging.lsp.edit({ text: "" }, null, [], true);
            expect(merging.requests[0]).toEqual(["edit", "--ops"]);

            const older = fakeLsp([], false);
            expect(await older.lsp.mergesAlters()).toBe(false);
            // Asked once.
            await older.lsp.mergesAlters();
            expect(older.requests).toHaveLength(1);
        });

    it("reads the outline's features once, and a file's outline", async () => {
        const requests: string[][] = [];
        const lsp = new LspEdit(() => { return Promise.resolve("lsp"); },
            (_binary, args) => {
                requests.push(args);

                return Promise.resolve(args.includes("--features")
                    ? { code: 0, stderr: "", stdout: JSON.stringify({
                        format: 1, features: ["rest_object_details", 7] }) }
                    : { code: 0, stderr: "", stdout: "{\"rest\": {}}" });
            });

        expect(await lsp.outlineFeatures()).toEqual(["rest_object_details"]);
        await lsp.outlineFeatures();
        expect(await lsp.outline("/p/dev.sql")).toEqual({ rest: {} });
        expect(requests).toEqual([["outline", "--features"],
            ["outline", "/p/dev.sql"]]);

        // A binary before the list exits 2: no features.
        const older = new LspEdit(() => { return Promise.resolve("lsp"); },
            () => {
                return Promise.resolve({ code: 2, stderr: "usage",
                    stdout: "" });
            });
        expect(await older.outlineFeatures()).toEqual([]);
    });

    it("asks again where no binary was found yet", async () => {
        let binary: string | undefined;
        const lsp = new LspEdit(() => { return Promise.resolve(binary); },
            () => {
                return Promise.resolve({ code: 0, stderr: "", stdout:
                    JSON.stringify({ format: 1, ops: [],
                        merge_alters: true }) });
            });
        expect(await lsp.mergesAlters()).toBe(false);
        binary = "lsp";
        expect(await lsp.mergesAlters()).toBe(true);
    });
});

describe("LiveTableSource, online ALTER TABLE", () => {
    it("runs the table's ALTERs online and the others as written, in "
        + "order", async () => {
        const live = liveSetUp([OTHER, ALTER], { entry: { maxRebuildBytes: 0,
            enabled: true } });
        const applied = await live.source.apply([{ op: "add_column" }]);

        expect(live.executed).toEqual(["USE `shop`", OTHER.sql]);
        expect(live.runs).toEqual([["orders", ALTER.spec,
            { maxRebuildBytes: 0 }]]);
        expect(applied.notes).toEqual(["ALTER TABLE ran online: INSTANT."]);
    });

    it("runs every statement as written where the table has it off",
        async () => {
            const live = liveSetUp([ALTER], { entry: { enabled: false } });
            await live.source.apply([{ op: "add_column" }]);

            expect(live.runs).toEqual([]);
            expect(live.executed).toEqual(["USE `shop`", ALTER.sql]);
        });

    it("stops where no allowed step can run an ALTER, what ran before kept",
        async () => {
            const live = liveSetUp([OTHER, ALTER], { outcome: {
                applied: false, method: "NEEDS_EXTERNAL",
                reason: "online rebuilds (INPLACE, COPY) skipped: table size "
                    + "20 > max_rebuild_bytes 10" } });

            const failed = await live.source.apply([{ op: "add_column" }])
                .catch((error: unknown) => { return error; });
            expect(failed).toBeInstanceOf(PartlyAppliedError);
            expect((failed as PartlyAppliedError).done).toEqual([OTHER.sql]);
            expect((failed as Error).message).toContain(
                "nothing was changed");
            expect((failed as Error).message).toContain("max_rebuild_bytes");
        });

    it("keeps settings changed alone, and follows a rename with them",
        async () => {
            const live = liveSetUp([{ sql: "RENAME TABLE `orders` TO "
                + "`purchases`" }, { ...ALTER, table: "purchases" }]);
            expect(await live.source.apply([], { lockWait: 30 }))
                .toEqual({ notes: [] });
            expect(live.entries.get("orders")).toEqual({ lockWait: 30 });

            await live.source.apply([RENAME, { op: "add_column" }]);
            // The ALTER names the table as it is by then.
            expect(live.runs[0][0]).toBe("purchases");
            expect(live.entries.get("purchases")).toEqual({ lockWait: 30 });
            expect(live.source.table).toBe("purchases");
        });
});

describe("LiveTableSource, SQL Preview", () => {
    it("says above the table's ALTERs that they run online, as the tab "
        + "sets it", async () => {
        const live = liveSetUp([OTHER, ALTER]);
        const preview = await live.source.preview([{ op: "add_column" }]);
        expect(preview.statements).toEqual([OTHER.sql,
            ONLINE_ALTER_COMMENT + ALTER.sql]);

        // Off in the tab, not saved yet: as written.
        const off = await live.source.preview([{ op: "add_column" }],
            { enabled: false });
        expect(off.statements).toEqual([OTHER.sql, ALTER.sql]);
    });

    it("runs every statement as written where msm has no online ALTER "
        + "TABLE", async () => {
        const live = liveSetUp([ALTER], { defaults: () => {
            return Promise.reject(new Error("unknown tool"));
        } });
        const data = await live.source.read();
        expect(data.onlineAlterProblem).toContain("unknown tool");
        expect((await live.source.preview([{ op: "add_column" }]))
            .statements).toEqual([ALTER.sql]);
        await live.source.apply([{ op: "add_column" }]);
        expect(live.runs).toEqual([]);
        expect(live.executed).toContain(ALTER.sql);
    });
});

describe("onlineAlterOutcome", () => {
    const state = (patch: Partial<ITaskState>): ITaskState => {
        return { task_id: "t", task_type: "msm", kind: "online_alter_table",
            title: "", status: "completed", cancel_requested: false,
            created_at: "", started_at: null, finished_at: null, stage: null,
            progress: null, stages: [], next_since: 0, result: null,
            error: null, ...patch };
    };

    it("reads what the task came to", () => {
        expect(onlineAlterOutcome(state({ result: { method: "COPY",
            applied: true, reason: "" } })))
            .toEqual({ applied: true, method: "COPY" });
        expect(onlineAlterOutcome(state({ result: {
            method: "NEEDS_EXTERNAL", applied: false, reason: "too big" } })))
            .toEqual({ applied: false, method: "NEEDS_EXTERNAL",
                reason: "too big" });
        expect(() => {
            return onlineAlterOutcome(state({ status: "cancelled" }));
        }).toThrow(/cancelled/u);
        expect(() => {
            return onlineAlterOutcome(state({ status: "failed",
                error: "Lock wait timeout" }));
        }).toThrow("Lock wait timeout");
    });
});

describe("ProjectTableSource, online ALTER TABLE", () => {
    const settings: IMsmOnlineAlterSettings = {
        defaults: DEFAULTS,
        setting: { enabled: true, lockWait: 20,
            tables: { orders: { maxRebuildBytes: 0 } } },
    };

    it("shows the project's values over msm's defaults as inherited", () => {
        expect(projectOnlineAlter(settings, "orders")).toEqual({
            inherited: { ...DEFAULTS, lockWait: 20, enabled: true },
            table: { maxRebuildBytes: 0 },
            keptIn: "project",
        });
        expect(projectOnlineAlter({ defaults: DEFAULTS, setting: {} },
            "orders").inherited.enabled).toBe(true);
    });

    /** A project table whose msm calls are recorded. */
    const projectSetUp = (options: { failSet?: boolean } = {}) => {
        const calls: unknown[][] = [];
        const definition = { schema: "shop", source_hash: "sha256:x",
            tables: [] } as unknown as ISchemaDefinition;
        const source = new ProjectTableSource("shop", "orders", {
            snapshot: () => { return Promise.resolve(definition); },
            edit: (edits) => {
                calls.push(["edit", edits.length]);

                return Promise.resolve([]);
            },
            scriptFile: () => { return Promise.resolve(undefined); },
            lsp: fakeLsp([]).lsp,
            onlineAlter: {
                get: () => { return Promise.resolve(settings); },
                set: (table, entry) => {
                    calls.push(["set", table, entry]);

                    return options.failSet === true
                        ? Promise.reject(new Error("msm is busy"))
                        : Promise.resolve();
                },
            },
        });

        return { source, calls };
    };

    it("writes the entry after the edits, under the table's new name; msm "
        + "moves it on a rename", async () => {
        const changed = projectSetUp();
        await changed.source.apply([], { lockWait: 1 });
        expect(changed.calls).toEqual([["set", "orders", { lockWait: 1 }]]);

        const reset = projectSetUp();
        await reset.source.apply([], {});
        expect(reset.calls).toEqual([["set", "orders", null]]);

        const renamed = projectSetUp();
        await renamed.source.apply([RENAME]);
        expect(renamed.calls).toEqual([["edit", 1]]);
        const changedRenamed = projectSetUp();
        await changedRenamed.source.apply([RENAME], { lockWait: 2 });
        expect(changedRenamed.calls).toEqual([["edit", 1],
            ["set", "purchases", { lockWait: 2 }]]);

        const untouched = projectSetUp();
        await untouched.source.apply([{ op: "add_column" }]);
        expect(untouched.calls).toEqual([["edit", 1]]);
    });

    it("says a Save whose edits were saved but not its settings changed "
        + "the table", async () => {
        const failing = projectSetUp({ failSet: true });
        const failed = await failing.source.apply([RENAME], { lockWait: 2 })
            .catch((error: unknown) => { return error; });
        expect(failed).toBeInstanceOf(PartlyAppliedError);
        expect((failed as PartlyAppliedError).changed).toBe(true);
        expect((failed as Error).message).toContain("saved to the project");
        expect((failed as Error).message).toContain("msm is busy");
        // Followed to its new name, to be read again.
        expect(failing.source.table).toBe("purchases");

        // Settings alone: nothing changed.
        const alone = await projectSetUp({ failSet: true }).source
            .apply([], { lockWait: 2 })
            .catch((error: unknown) => { return error; });
        expect(alone).not.toBeInstanceOf(PartlyAppliedError);
    });
});

describe("ProjectTableSource, a new table", () => {
    const definition = { schema: "shop", source_hash: "sha256:x",
        tables: [{ name: "customers", columns: [{ name: "id",
            type: "uuid" }] }] } as unknown as ISchemaDefinition;

    const newSetUp = () => {
        const calls: unknown[][] = [];
        const source = new ProjectTableSource("shop", "", {
            snapshot: () => { return Promise.resolve(definition); },
            edit: (edits) => {
                calls.push(["edit", edits.map((edit) => { return edit.op; })]);

                return Promise.resolve([]);
            },
            scriptFile: () => { return Promise.resolve(undefined); },
            lsp: fakeLsp([]).lsp,
        });

        return { source, calls };
    };

    it("reads as an empty table with the schema's tables, for its keys",
        async () => {
            const { source } = newSetUp();
            const data = await source.read();

            expect(data).toMatchObject({ live: false, isNew: true,
                table: { name: "", columns: [] }, triggers: [], ddl: "",
                tables: { customers: ["id"] } });
            expect(data.onlineAlter).toBeUndefined();
        });

    it("is the table it made after its Save", async () => {
        const { source, calls } = newSetUp();
        await source.apply([{ op: "add_table", table: { name: "orders",
            columns: [] } }, { op: "set_table_options", table: "orders" }]);

        expect(calls).toEqual([["edit", ["add_table", "set_table_options"]]]);
        expect(source.table).toBe("orders");
    });
});
