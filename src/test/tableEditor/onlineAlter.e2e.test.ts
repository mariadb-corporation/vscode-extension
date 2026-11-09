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

import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MariaDbApi } from "../../mcp/mariaDbApi.js";
import { MsmApi } from "../../mcp/msmApi.js";
import { SandboxApi } from "../../mcp/sandboxApi.js";
import { createSdkConnector } from "../../mcp/sdkConnector.js";
import type { IMcpConnection } from "../../mcp/session.js";
import {
    isFinished,
    TaskApi,
    WAIT_MS,
    type ITaskState,
} from "../../mcp/taskApi.js";
import { MCP_SERVER_ARGS } from "../../shell/constants.js";
import { LspEdit } from "../../tableEditor/lspEdit.js";
import type { IOnlineAlterEntry } from "../../tableEditor/onlineAlter.js";
import {
    LiveTableSource,
    ONLINE_ALTER_COMMENT,
    onlineAlterOutcome,
    PartlyAppliedError,
} from "../../tableEditor/tableSources.js";

/**
 * The table editor's online ALTER TABLE against a real MariaDB Shell and
 * mariadb-lsp: a live table's Saves run through msm.online_alter_table on
 * a sandbox. Opt-in, like mrsShell.e2e.test.ts. Run with
 *
 *     MARIADB_SHELL_E2E=/path/to/mariadb-shell \
 *     MARIADB_LSP=/path/to/mariadb-lsp npx vitest run onlineAlter.e2e
 *
 * with `mariadbd` on the PATH. The plugins are MARIADB_SHELL_PLUGINS's,
 * or the mariadb-shell-plugins checkout next to this repository.
 */

const shell = process.env.MARIADB_SHELL_E2E;
const lspBinary = process.env.MARIADB_LSP;
const PASSWORD = "Oat_e2e_root_1";

const freePort = async (): Promise<number> => {
    return await new Promise((done) => {
        const server = createServer();
        server.listen(0, () => {
            const address = server.address();
            const port = typeof address === "object" && address !== null
                ? address.port : 0;
            server.close(() => { done(port); });
        });
    });
};

const column = (name: string, type: string): Record<string, unknown> => {
    return { name, type, nullable: true, default: null,
        auto_increment: false, comment: null, charset: null,
        collation: null, generated: null, generated_storage: null,
        on_update: null, invisible: false };
};

describe.runIf(shell !== undefined && lspBinary !== undefined)(
    "online ALTER TABLE against a real shell", () => {
        let home: string;
        let connection: IMcpConnection;
        let db: MariaDbApi;
        let msm: MsmApi;
        let tasks: TaskApi;
        let sandbox: SandboxApi;
        let port: number;
        let connectionId: string;
        const lsp = new LspEdit(() => { return Promise.resolve(lspBinary); });
        const entries = new Map<string, IOnlineAlterEntry>();
        const followed: ITaskState[] = [];

        beforeAll(async () => {
            home = mkdtempSync(join(tmpdir(), "oat_e2e_"));
            const plugins = join(home, "plugins");
            mkdirSync(plugins, { recursive: true });
            const repo = resolve(process.env.MARIADB_SHELL_PLUGINS
                ?? join(__dirname, "../../../..", "mariadb-shell-plugins"));
            for (const plugin of ["mcp_plugin", "rest_plugin", "msm_plugin"]) {
                symlinkSync(join(repo, plugin), join(plugins, plugin));
            }
            connection = await createSdkConnector().open({
                command: "/usr/bin/env",
                args: [`MARIADB_SHELL_USER_CONFIG_HOME=${home}`, shell!,
                    ...MCP_SERVER_ARGS],
            }, () => { /* The server's log is not checked. */ });
            db = new MariaDbApi(connection);
            msm = new MsmApi(connection);
            tasks = new TaskApi(connection);
            sandbox = new SandboxApi(connection);

            port = await freePort();
            await sandbox.deploy({ port, password: PASSWORD,
                mcpAccess: false });
            connectionId = await db.connect(`mariadb://root@127.0.0.1:${port}`);
            await sql("CREATE DATABASE shop");
            await sql("CREATE TABLE shop.orders (id INT PRIMARY KEY, "
                + "amount INT, note VARCHAR(20))");
            await sql("INSERT INTO shop.orders VALUES (1, 10, 'a'), "
                + "(2, 20, 'b')");
        }, 600_000);

        afterAll(async () => {
            try {
                await sandbox?.stop(port);
                await sandbox?.delete(port);
            } finally {
                await connection?.close();
                rmSync(home, { recursive: true, force: true });
            }
        }, 300_000);

        const sql = async (statement: string): Promise<void> => {
            const result = await db.executeSql(connectionId, statement);
            expect(result.error).toBeUndefined();
        };

        const query = async (statement: string):
            Promise<Array<Record<string, unknown>>> => {
            const result = await db.executeSql(connectionId, statement,
                { limit: 1000, offset: 0 });
            if (result.error !== undefined) {
                throw new Error(result.error);
            }

            return (result.result_sets?.[0]?.rows ?? []) as
                Array<Record<string, unknown>>;
        };

        /** The task to its end, as TaskMonitor.follow waits for it. */
        const follow = async (taskId: string): Promise<ITaskState> => {
            let state = await tasks.getTask(taskId, 0, WAIT_MS);
            while (!isFinished(state.status)) {
                state = await tasks.getTask(taskId, state.next_since, WAIT_MS);
            }
            followed.push(state);

            return state;
        };

        /** A live table source wired as extension.ts wires it. */
        const source = (table: string): LiveTableSource => {
            return new LiveTableSource("shop", table, {
                query,
                execute: async (statement) => {
                    const result = await db.executeSql(connectionId,
                        statement);
                    if (result.error !== undefined) {
                        throw new Error(result.error);
                    }
                },
                lsp,
                onlineAlter: {
                    defaults: () => { return msm.onlineAlterDefaults(); },
                    get: (name) => { return entries.get(name) ?? {}; },
                    set: (name, entry) => {
                        entries.set(name, entry);

                        return Promise.resolve();
                    },
                    rename: (name, newName) => {
                        const entry = entries.get(name);
                        entries.delete(name);
                        if (entry !== undefined) {
                            entries.set(newName, entry);
                        }

                        return Promise.resolve();
                    },
                    run: async (name, spec, options) => {
                        const started = await msm.onlineAlterTable(
                            connectionId, "shop", name, spec, options);

                        return onlineAlterOutcome(
                            await follow(started.task_id));
                    },
                },
            });
        };

        const columns = async (table: string): Promise<string[]> => {
            return (await query("SELECT COLUMN_NAME, COLUMN_TYPE FROM "
                + "information_schema.COLUMNS WHERE TABLE_SCHEMA = 'shop' "
                + `AND TABLE_NAME = '${table}' ORDER BY ORDINAL_POSITION`))
                .map((row) => {
                    return `${String(row.COLUMN_NAME)} ${
                        String(row.COLUMN_TYPE)}`;
                });
        };

        it("reads msm's defaults into the tab", async () => {
            const data = await source("orders").read();
            expect(data.onlineAlterProblem).toBeUndefined();
            expect(data.onlineAlter?.keptIn).toBe("workspace");
            expect(data.onlineAlter?.inherited).toMatchObject({
                enabled: true, maxRebuildBytes: 10 * 1024 ** 3 });
            expect(Object.keys(data.onlineAlter!.inherited).sort()).toEqual([
                "enabled", "galeraMaxBytes", "lockWait", "maxLockedBytes",
                "maxRebuildBytes", "maxRetries", "nboLock"]);
        }, 120_000);

        it("runs an added column and index as one ALTER, INSTANT or "
            + "in place", async () => {
            const orders = source("orders");
            await orders.read();
            const applied = await orders.apply([
                { op: "add_column", table: "orders",
                    column: column("qty", "INT") },
                { op: "add_index", table: "orders", index: { name: "ix_qty",
                    kind: "index", key_parts: [{ column: "qty",
                        length: null, order: null }] } },
            ]);
            expect(followed).toHaveLength(1);
            expect(followed[0].result).toMatchObject({ applied: true });
            expect(["INSTANT", "NOCOPY", "INPLACE"])
                .toContain((followed[0].result as { method: string }).method);
            expect(applied.notes.join("\n"))
                .toMatch(/ALTER TABLE ran online: (INSTANT|NOCOPY|INPLACE)/u);
            expect(await columns("orders")).toContain("qty int(11)");
        }, 300_000);

        it("says in the SQL Preview which ALTERs run online", async () => {
            const orders = source("orders");
            await orders.read();
            const edits = [{ op: "add_column", table: "orders",
                column: column("tmp", "INT") }];
            const preview = await orders.preview(edits);
            expect(preview.statements).toHaveLength(1);
            expect(preview.statements[0].startsWith(ONLINE_ALTER_COMMENT))
                .toBe(true);
            expect((await orders.preview(edits, { enabled: false }))
                .statements[0]).toMatch(/^ALTER TABLE/u);
        }, 120_000);

        it("runs a column type change with COPY", async () => {
            followed.length = 0;
            const orders = source("orders");
            await orders.read();
            const applied = await orders.apply([{ op: "modify_column",
                table: "orders", column: "amount",
                new_column: column("amount", "BIGINT") }]);
            expect((followed[0].result as { method: string }).method)
                .toBe("COPY");
            expect(applied.notes).toContain("ALTER TABLE ran online: COPY.");
            expect(await columns("orders")).toContain("amount bigint(20)");
        }, 300_000);

        it("stops with nothing changed where no rebuild is allowed and no "
            + "lock may be taken", async () => {
            followed.length = 0;
            const orders = source("orders");
            await orders.read();
            const failed = await orders.apply([{ op: "modify_column",
                table: "orders", column: "note",
                new_column: column("note", "VARCHAR(10)") }],
            { maxRebuildBytes: 0, maxLockedBytes: 0 })
                .catch((error: unknown) => { return error; });
            expect(failed).toBeInstanceOf(PartlyAppliedError);
            expect((failed as PartlyAppliedError).done).toEqual([]);
            expect((failed as Error).message).toContain("nothing was changed");
            expect((failed as Error).message).toContain("max_rebuild_bytes");
            expect(await columns("orders")).toContain("note varchar(20)");
            entries.delete("orders");
        }, 300_000);

        it("runs the ALTERs as written where the table has it off",
            async () => {
                followed.length = 0;
                const orders = source("orders");
                await orders.read();
                await orders.apply([{ op: "add_column", table: "orders",
                    column: column("flag", "TINYINT") }], { enabled: false });
                expect(followed).toEqual([]);
                expect(await columns("orders")).toContain("flag tinyint(4)");
                entries.delete("orders");
            }, 300_000);

        it("runs the ALTER under the new name of a renamed table, its "
            + "settings following it", async () => {
            followed.length = 0;
            const orders = source("orders");
            await orders.read();
            await orders.apply([], { lockWait: 7 });
            await orders.apply([
                { op: "rename_table", table: "orders", new_name: "purchases" },
                { op: "add_column", table: "purchases",
                    column: column("ref", "VARCHAR(8)") },
            ]);
            expect(orders.table).toBe("purchases");
            expect(entries.get("purchases")).toEqual({ lockWait: 7 });
            expect(followed).toHaveLength(1);
            expect(followed[0].result).toMatchObject({ applied: true });
            expect(await columns("purchases")).toContain("ref varchar(8)");
        }, 300_000);
    });
