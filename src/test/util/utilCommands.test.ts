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

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { ITaskApi, ITaskState } from "../../mcp/taskApi.js";
import type { IDumpInfo, IUtilApi } from "../../mcp/utilApi.js";
import type { IObjectNode, ISchemaNode } from "../../tree/connectionsModel.js";
import { TaskMonitor } from "../../util/taskMonitor.js";
import {
    UtilCommands,
    dumpFolderName,
    dumpPathProblem,
} from "../../util/utilCommands.js";
import {
    groupKey,
    objectKey,
    schemaKey,
    USERS_KEY,
} from "../../util/dumpSelection.js";
import {
    PICK_FOLDER,
    PICK_ZIP,
    pickDump,
    UTIL_DIALOG_VIEW_TYPE,
} from "../../util/utilDialogPanel.js";
import type {
    IUtilLoadMessage,
    UtilHostMessage,
    UtilWebviewMessage,
} from "../../util/utilProtocol.js";
import {
    errorMessages,
    fileDialogs,
    quickPickAnswers,
    quickPickCalls,
    MockOutputChannel,
    registeredCommands,
    resetVscodeMock,
    Uri,
    webviewPanels,
    type MockWebviewPanel,
} from "../mocks/vscode.js";

const URI = "root@localhost:3306";

interface IRecorded {
    monitor?: TaskMonitor;
    connected: string[];
    started: Array<{ name: string; args: unknown[] }>;
    /** The connections refresh was called for, in order. */
    refreshed: string[];
    logs: string[];
    /** The tasks that did not start: connection, title, call, error. */
    failedStarts: string[][];
    /**
     * The connections the panel was brought up on: `uri` at a failure,
     * `uri (start)` as a dump or load started.
     */
    shownActions: string[];
    /** The calls to util.inspect_dump: url, and schema where given. */
    inspected: string[];
    /** Whether the last dump went to one file, as kept. */
    zip: boolean;
}

/** A dump of two schemas, the first with more tables than it lists. */
const dumpInfo = (over: Partial<IDumpInfo> = {}): IDumpInfo => {
    return {
        url: "/dumps/shop.mariadb.dump.zip", format: "zip",
        kind: "dumpSchemas", complete: true,
        source: { server: "db1", server_version: "11.8.2", user: "root" },
        begin: "2026-11-10 14:05:00", end: "2026-11-10 14:06:00",
        options: {}, includes_users: false, users: [], user_count: 0,
        schema_count: 2,
        schemas: [
            {
                name: "shop", tables: ["orders", "items"], table_count: 3,
                views: ["v_orders"], view_count: 1,
                functions: ["total"], function_count: 1,
                procedures: [], procedure_count: 0,
                events: ["nightly"], event_count: 1,
                rows: 1200, data_bytes: 4096,
            },
            {
                name: "crm", tables: ["leads"], table_count: 1,
                views: [], view_count: 0, functions: [], function_count: 0,
                procedures: [], procedure_count: 0, events: [], event_count: 0,
                rows: 10, data_bytes: 100,
            },
        ],
        data_file_bytes: 2048, size_bytes: 3000, extracted_bytes: 5000,
        disk_needed_bytes: 1 << 30, rows: 1210, data_bytes: 4196,
        ...over,
    };
};

const done = (taskId: string): ITaskState => {
    return {
        task_id: taskId, task_type: "util", kind: "dump_schemas", title: "",
        connection_id: "c1",
        status: "completed", cancel_requested: false, created_at: "",
        started_at: "", finished_at: "", stage: null, progress: null,
        stages: [], messages: [], next_since: 0, result: null, error: null,
    };
};

/** Commands over a fake API whose every task completes at once. */
const setUp = (failStart?: string, dump: IDumpInfo = dumpInfo(),
    /** What the dump picker answers; "" for nothing picked. */
    picked = "/dumps/shop.mariadb.dump.zip"): IRecorded => {
    const recorded: IRecorded = {
        connected: [], started: [], refreshed: [], logs: [], failedStarts: [],
        shownActions: [], inspected: [], zip: false,
    };
    const start = (name: string) => {
        return (...args: unknown[]) => {
            if (failStart !== undefined) {
                return Promise.reject(new Error(failStart));
            }
            recorded.started.push({ name, args });

            return Promise.resolve({ task_id: `t${String(recorded.started.length)}`,
                status: "running" });
        };
    };
    const api = {
        dumpInstance: start("dumpInstance"), dumpSchemas: start("dumpSchemas"),
        dumpTables: start("dumpTables"), exportTable: start("exportTable"),
        loadDump: start("loadDump"), importTable: start("importTable"),
        copyInstance: start("copyInstance"), copySchemas: start("copySchemas"),
        copyTables: start("copyTables"),
        inspectDump: (url: string, schemaName?: string) => {
            recorded.inspected.push(schemaName === undefined ? url
                : `${url} ${schemaName}`);
            if (schemaName === undefined) {
                return Promise.resolve(dump);
            }
            // With a schema: that one, with every name.
            const full = dump.schemas.find((candidate) => {
                return candidate.name === schemaName;
            })!;

            return Promise.resolve({ ...dump, schemas: [{ ...full,
                tables: [...full.tables, "zz_last"] }] });
        },
    } as unknown as IUtilApi;
    const taskApi: ITaskApi = {
        getTask: (taskId) => { return Promise.resolve(done(taskId)); },
        cancelTask: (taskId) => { return Promise.resolve(done(taskId)); },
        listTasks: () => { return Promise.resolve([]); },
    };
    const monitor = new TaskMonitor(() => { return Promise.resolve(taskApi); },
        new MockOutputChannel("MariaDB Tasks"), (message) => {
            recorded.logs.push(message);
        }, undefined, 0);

    recorded.monitor = monitor;
    new UtilCommands({
        extensionUri: Uri.file("/ext") as never,
        connect: (uri) => {
            recorded.connected.push(uri);

            return Promise.resolve(`id-of-${uri}`);
        },
        connectionUris: () => {
            return Promise.resolve([URI, "root@other:3306"]);
        },
        utilApi: () => { return Promise.resolve(api); },
        monitor,
        refresh: (uri) => { recorded.refreshed.push(uri); },
        defaultFolder: () => { return "/home/me"; },
        // The real look at the disk has its own test below.
        checkDumpFolder: (folder) => {
            return Promise.resolve(folder === "/home/me/full"
                ? { field: "path", message: "This folder is not empty." }
                : undefined);
        },
        startFailed: (...args) => { recorded.failedStarts.push(args); },
        showActions: (uri, atFailure) => {
            recorded.shownActions.push(atFailure === false ? `${uri} (start)`
                : uri);
        },
        zipDumps: {
            get: () => { return recorded.zip; },
            set: (zip) => { recorded.zip = zip; },
        },
        pickDump: () => {
            return Promise.resolve(picked === "" ? undefined : picked);
        },
        log: (message) => { recorded.logs.push(message); },
    }).register();

    return recorded;
};

const monitorOf = (recorded: IRecorded): TaskMonitor => {
    return recorded.monitor!;
};

const panel = (): MockWebviewPanel => {
    return webviewPanels[webviewPanels.length - 1]!;
};

const posted = (): UtilHostMessage[] => {
    return panel().webview.posted as UtilHostMessage[];
};

const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => { setTimeout(resolve, 0); });
    }
};

const receive = async (message: UtilWebviewMessage): Promise<void> => {
    panel().webview.receive(message);
    await settle();
};

const run = async (command: string, ...args: unknown[]): Promise<void> => {
    registeredCommands.get(command)!(...args);
    await settle();
};

const loaded = async (): Promise<IUtilLoadMessage> => {
    await receive({ type: "ready" });

    return posted().find((message) => {
        return message.type === "load";
    }) as IUtilLoadMessage;
};

const schema = (name: string): ISchemaNode => {
    return { kind: "schema", uri: URI, schema: name, schemaType: "user", comment: "" };
};

const table = (name: string, schemaName = "shop"): IObjectNode => {
    return { kind: "object", uri: URI, schema: schemaName, objectType: "table", name };
};

describe("the dump and load commands", () => {
    beforeEach(() => { resetVscodeMock(); });

    it("dumps the selected schemas, from the dialog", async () => {
        const recorded = setUp();
        await run("mariadb.dumpSchemas", schema("shop"),
            [schema("shop"), schema("crm"), table("orders")]);

        expect(panel().viewType).toBe(UTIL_DIALOG_VIEW_TYPE);
        const load = await loaded();
        expect(load.spec.title).toBe("Dump shop, crm to Disk");
        expect(String(load.values.path)).toMatch(/^\/home\/me\/schemas-\d{4}-/u);

        await receive({ type: "start", values: { ...load.values, path: "/d",
            threads: "8" } });

        expect(recorded.connected).toEqual([URI]);
        expect(recorded.started).toEqual([{ name: "dumpSchemas",
            args: [`id-of-${URI}`, ["shop", "crm"], "/d", { threads: 8 }] }]);
        expect(panel().disposed).toBe(true);
        // a dump changes nothing the tree shows
        expect(recorded.refreshed).toEqual([]);
    });

    it("reads the tree again after a load", async () => {
        const recorded = setUp(undefined, dumpInfo({ url: "/dump",
            format: "folder" }), "/dump");
        await run("mariadb.loadDump", { kind: "connection", uri: URI,
            connected: true, isDefault: false });
        const load = await loaded();
        expect(load.values.path).toBe("/dump");

        await receive({ type: "start", values: { ...load.values,
            schema: "copy_of_shop", extraction_budget_mb: "512" },
        excluded: [USERS_KEY] });

        // UtilApi drops the budget for a folder (see its test).
        expect(recorded.started[0]).toEqual({ name: "loadDump",
            args: [`id-of-${URI}`, "/dump", { schema: "copy_of_shop",
                extraction_budget_mb: 512 }] });
        expect(recorded.refreshed).toEqual([URI]);
    });

    it("picks the dump first, reads it, and loads what stays ticked",
        async () => {
            const recorded = setUp();
            await run("mariadb.loadDump", { kind: "connection", uri: URI,
                connected: true, isDefault: false });
            await loaded();

            expect(recorded.inspected).toEqual(["/dumps/shop.mariadb.dump.zip"]);
            // with the boxes to start with: the users unticked
            expect(posted()).toContainEqual({ type: "inspected",
                path: "/dumps/shop.mariadb.dump.zip", info: dumpInfo(),
                excluded: [USERS_KEY] });

            await receive({ type: "start", values: { ...(await loaded()).values,
                extraction_budget_mb: "512" },
            excluded: [USERS_KEY, schemaKey("crm"),
                objectKey("shop", "tables", "items"),
                groupKey("shop", "events")] });

            expect(recorded.started[0]).toEqual({ name: "loadDump",
                args: [`id-of-${URI}`, "/dumps/shop.mariadb.dump.zip", {
                    extraction_budget_mb: 512,
                    excludeSchemas: ["crm"],
                    excludeTables: ["shop.items"],
                    excludeEvents: ["shop.nightly"],
                }] });
            // the Actions tab comes up at the load's row
            expect(recorded.shownActions).toEqual([`${URI} (start)`]);
            expect(monitorOf(recorded).tasks[0].resume?.options).toMatchObject({
                excludeSchemas: ["crm"] });
        });

    it("reads every name of a schema whose whole tables are unticked",
        async () => {
            const recorded = setUp();
            await run("mariadb.loadDump", { kind: "connection", uri: URI,
                connected: true, isDefault: false });
            const load = await loaded();

            await receive({ type: "start", values: load.values,
                excluded: [USERS_KEY, groupKey("shop", "tables")] });

            expect(recorded.inspected).toEqual(["/dumps/shop.mariadb.dump.zip",
                "/dumps/shop.mariadb.dump.zip shop"]);
            expect(recorded.started[0].args[2]).toEqual({
                excludeTables: ["shop.orders", "shop.items", "shop.zz_last"] });
        });

    it("does not open the dialog when no dump is picked", async () => {
        const recorded = setUp(undefined, dumpInfo(), "");
        await run("mariadb.loadDump", { kind: "connection", uri: URI,
            connected: true, isDefault: false });

        expect(webviewPanels).toEqual([]);
        expect(recorded.inspected).toEqual([]);
    });

    it("refuses a table dump from the connection's Load Dump", async () => {
        const recorded = setUp(undefined, dumpInfo({ kind: "dumpTables",
            schema_count: 1, schemas: [dumpInfo().schemas[1]] }));
        await run("mariadb.loadDump", { kind: "connection", uri: URI,
            connected: true, isDefault: false });
        const load = await loaded();

        await receive({ type: "start", values: load.values,
            excluded: [USERS_KEY] });

        expect(recorded.started).toEqual([]);
        expect(panel().disposed).toBe(false);
        expect(posted()).toContainEqual({ type: "startError", field: "path",
            message: expect.stringContaining(
                "Load Table Dump from Disk") as string });
    });

    it("loads a table dump into the schema it was opened on", async () => {
        const recorded = setUp(undefined, dumpInfo({ kind: "dumpTables",
            schema_count: 1, schemas: [dumpInfo().schemas[1]] }));
        await run("mariadb.loadTableDump", schema("sales"));
        const load = await loaded();
        expect(load.spec.title).toBe("Load a Table Dump into sales");
        expect(load.spec.intoSchema).toBe("sales");

        await receive({ type: "start", values: load.values, excluded: [] });

        expect(recorded.started[0]).toEqual({ name: "loadDump",
            args: [`id-of-${URI}`, "/dumps/shop.mariadb.dump.zip",
                { schema: "sales" }] });
        expect(recorded.refreshed).toEqual([URI]);
    });

    it("refuses a dump of several schemas from a schema's Load Table Dump",
        async () => {
            const recorded = setUp();
            await run("mariadb.loadTableDump", schema("sales"));
            const load = await loaded();

            await receive({ type: "start", values: load.values,
                excluded: [] });

            expect(recorded.started).toEqual([]);
            expect(posted()).toContainEqual({ type: "startError",
                field: "path", message: expect.stringContaining(
                    "dump of 2 schemas") as string });
        });

    it("remembers a dump to one ZIP file for the next dump dialog",
        async () => {
            const recorded = setUp();
            await run("mariadb.dumpSchemas", schema("shop"));
            let load = await loaded();
            expect(load.values.zip).toBe(false);
            expect(String(load.values.path)).not.toContain(".zip");

            await receive({ type: "start", values: { ...load.values,
                zip: true, path: "/d/shop.mariadb.dump.zip" } });
            // sent as the path alone: the shell knows no zip option
            expect(recorded.started[0].args).toEqual([`id-of-${URI}`,
                ["shop"], "/d/shop.mariadb.dump.zip", {}]);
            expect(recorded.zip).toBe(true);
            expect(recorded.shownActions).toEqual([`${URI} (start)`]);

            await run("mariadb.dumpTables", table("orders"));
            load = await loaded();
            expect(load.values.zip).toBe(true);
            expect(String(load.values.path))
                .toMatch(/^\/home\/me\/shop\.orders-.*\.mariadb\.dump\.zip$/u);
        });

    it("resumes a load that stopped, without starting over", async () => {
        const recorded = setUp(undefined, dumpInfo({ url: "/dump",
            format: "folder" }), "/dump");
        await run("mariadb.loadDump", { kind: "connection", uri: URI,
            connected: true, isDefault: false });
        const load = await loaded();
        await receive({ type: "start", values: { ...load.values,
            resetProgress: true, threads: "2" }, excluded: [USERS_KEY] });
        const [first] = monitorOf(recorded).tasks;
        expect(first.resume).toEqual({ operation: "loadDump", uri: URI,
            url: "/dump", options: { threads: 2 } });

        // as a reload leaves it: still running when the window closed
        first.interrupted = true;
        first.state = { ...first.state, status: "running" };
        await run("mariadb.resumeTask", first);

        expect(recorded.started[1]).toEqual({ name: "loadDump",
            args: [`id-of-${URI}`, "/dump", { threads: 2 }] });
        expect(recorded.shownActions.at(-1)).toBe(`${URI} (start)`);
        // the resumed load takes the stopped one's place
        expect(monitorOf(recorded).tasks.map((task) => { return task.state.task_id; }))
            .toEqual(["t2"]);
    });

    it("does not resume what cannot be", async () => {
        const recorded = setUp();
        await run("mariadb.dumpSchemas", schema("shop"));
        const load = await loaded();
        await receive({ type: "start", values: load.values });
        const [dump] = monitorOf(recorded).tasks;

        await run("mariadb.resumeTask", { ...dump, interrupted: true });

        expect(recorded.started).toHaveLength(1);
    });

    it("copies to another connection, opened for the task", async () => {
        const recorded = setUp();
        await run("mariadb.copyTables", table("orders"),
            [table("orders"), table("items"), table("x", "other")]);
        const load = await loaded();
        // the source is not offered as the target
        expect(load.targets).toEqual([
            { uri: "root@other:3306", label: "root@other:3306" },
        ]);

        await receive({ type: "start", values: { ...load.values,
            target: "root@other:3306" } });

        expect(recorded.connected).toEqual([URI, "root@other:3306"]);
        expect(recorded.started[0]).toEqual({ name: "copyTables",
            args: [`id-of-${URI}`, "shop", ["orders", "items"],
                "id-of-root@other:3306", {}] });
        // what changed is the target's server, not the source's
        expect(recorded.refreshed).toEqual(["root@other:3306"]);
    });

    it("exports a table under a quoted name, and imports into it", async () => {
        const recorded = setUp();
        await run("mariadb.exportTable", table("order lines"));
        let load = await loaded();
        expect(load.values.path).toBe("/home/me/shop.order lines.tsv");
        await receive({ type: "start", values: load.values });
        expect(recorded.started[0].args.slice(1, 3))
            .toEqual(["shop.`order lines`", "/home/me/shop.order lines.tsv"]);

        await run("mariadb.importTable", table("orders"));
        load = await loaded();
        await receive({ type: "start", values: { ...load.values,
            path: "/in/a.tsv, /in/b.tsv", skipRows: "1" } });
        expect(recorded.started[1]).toEqual({ name: "importTable",
            args: [`id-of-${URI}`, ["/in/a.tsv", "/in/b.tsv"],
                { schema: "shop", table: "orders", skipRows: 1 }] });
    });

    it("fills the path in from Browse", async () => {
        setUp();
        await run("mariadb.dumpInstance", { kind: "connection", uri: URI,
            connected: true, isDefault: false });
        await loaded();
        fileDialogs.openAnswer = [Uri.file("/picked") as never];

        await receive({ type: "browse", current: "" });

        expect(posted().at(-1)).toEqual({ type: "browsed", path: "/picked" });
        expect(fileDialogs.openCalls[0]).toMatchObject({ canSelectFolders: true,
            canSelectMany: false });
    });

    it("browses for a dump zip with a save dialog", async () => {
        setUp();
        await run("mariadb.dumpSchemas", schema("shop"));
        await loaded();
        fileDialogs.saveAnswer = Uri.file("/picked/shop") as never;

        await receive({ type: "browse", current: "", zip: true });

        expect(posted().at(-1)).toEqual({ type: "browsed",
            path: "/picked/shop.mariadb.dump.zip" });
        expect(fileDialogs.saveCalls[0]).toMatchObject({
            filters: { "MariaDB Dump": ["zip"] } });

        // a plain .zip the save dialog added is replaced, not kept
        fileDialogs.saveAnswer = Uri.file("/picked/shop.zip") as never;
        await receive({ type: "browse", current: "", zip: true });
        expect(posted().at(-1)).toEqual({ type: "browsed",
            path: "/picked/shop.mariadb.dump.zip" });
    });

    it("keeps the dialog open with the reason when the work does not start",
        async () => {
            const recorded = setUp("Access denied for user 'root'");
            await run("mariadb.dumpSchemas", schema("shop"));
            const load = await loaded();

            await receive({ type: "start", values: load.values });

            expect(panel().disposed).toBe(false);
            expect(posted()).toContainEqual({ type: "startError",
                message: "Access denied for user 'root'" });
            expect(recorded.logs.at(-1)).toContain("did not start");
            // A row of the connection's Actions, which comes up on it.
            expect(recorded.failedStarts).toEqual([[URI, load.spec.title,
                expect.stringContaining("util.dump_schemas") as string,
                "Access denied for user 'root'"]]);
            expect(recorded.shownActions).toEqual([URI]);
            expect(errorMessages).toEqual([]);
        });

    it("notifies a start that failed after the dialog was closed",
        async () => {
            setUp("Access denied for user 'root'");
            await run("mariadb.dumpSchemas", schema("shop"));
            const load = await loaded();
            const dialog = panel();
            dialog.dispose();

            await receive({ type: "start", values: load.values });

            expect(errorMessages).toEqual([`MariaDB: ${load.spec.title} did `
                + "not start: Access denied for user 'root'"]);
        });

    it("keeps the dialog open when the dump folder is not empty",
        async () => {
            const folder = "/home/me/full";
            const recorded = setUp();
            await run("mariadb.dumpSchemas", schema("shop"));
            const load = await loaded();

            await receive({ type: "start", values: { ...load.values,
                path: folder } });

            expect(recorded.started).toEqual([]);
            expect(panel().disposed).toBe(false);
            expect(posted()).toContainEqual({ type: "startError",
                field: "path", message: expect.stringContaining(
                    "not empty") as string });
        });

    it("refuses values the dialog should not have sent", async () => {
        const recorded = setUp();
        await run("mariadb.dumpSchemas", schema("shop"));
        const load = await loaded();

        await receive({ type: "start", values: { ...load.values, path: "" } });

        expect(recorded.started).toEqual([]);
        expect(posted()).toContainEqual({ type: "startError", field: "path",
            message: "Output Folder must be given." });
    });

    it("ignores rows it does not apply to", async () => {
        const recorded = setUp();
        await run("mariadb.dumpSchemas", table("orders"));
        await run("mariadb.exportTable", { ...table("v"), objectType: "procedure" });
        await run("mariadb.dumpInstance");

        expect(webviewPanels).toEqual([]);
        expect(recorded.started).toEqual([]);
    });
});

describe("dumpFolderName", () => {
    it("tells a dump folder that would be refused", async () => {
        const empty = mkdtempSync(join(tmpdir(), "util-test-"));
        const full = mkdtempSync(join(tmpdir(), "util-test-"));
        writeFileSync(join(full, "x"), "");

        expect(await dumpPathProblem(empty)).toBeUndefined();
        expect(await dumpPathProblem(join(empty, "new"))).toBeUndefined();
        expect((await dumpPathProblem(full))?.message)
            .toContain("not empty");
        expect((await dumpPathProblem(join(full, "x")))?.message)
            .toContain("not a folder");
    });

    it("tells a dump zip that exists already", async () => {
        const folder = mkdtempSync(join(tmpdir(), "util-test-"));
        const zip = join(folder, "shop.mariadb.dump.zip");

        expect(await dumpPathProblem(zip)).toBeUndefined();
        writeFileSync(zip, "");
        expect((await dumpPathProblem(zip))?.message)
            .toContain("exists already");
    });

    it("names the folder by what is dumped and when", () => {
        expect(dumpFolderName("shop/x y", new Date(2026, 9, 10, 9, 5)))
            .toBe("shop_x_y-2026-10-10-0905");
    });
});

describe("pickDump", () => {
    beforeEach(() => { resetVscodeMock(); });

    it("takes a zip or a folder in one picker on macOS", async () => {
        fileDialogs.openAnswer = [Uri.file("/d/shop.mariadb.dump.zip") as never];

        expect(await pickDump("Load", "", "darwin"))
            .toBe("/d/shop.mariadb.dump.zip");
        expect(quickPickCalls).toEqual([]);
        expect(fileDialogs.openCalls[0]).toMatchObject({
            canSelectFiles: true, canSelectFolders: true });
    });

    it("asks which first where one picker cannot take both", async () => {
        quickPickAnswers.push(PICK_FOLDER);
        fileDialogs.openAnswer = [Uri.file("/d/shop") as never];

        expect(await pickDump("Load", "", "linux")).toBe("/d/shop");
        expect(quickPickCalls[0].map((item) => { return item.label; }))
            .toEqual([PICK_ZIP, PICK_FOLDER]);
        expect(fileDialogs.openCalls[0]).toMatchObject({
            canSelectFiles: false, canSelectFolders: true });
    });

    it("picks nothing where the question is dismissed", async () => {
        expect(await pickDump("Load", "", "win32")).toBeUndefined();
        expect(fileDialogs.openCalls).toEqual([]);
    });
});
