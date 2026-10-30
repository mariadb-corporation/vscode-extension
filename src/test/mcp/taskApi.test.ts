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

import type { IToolCaller } from "../../mcp/mariaDbApi.js";
import { McpToolError, type IToolResult } from "../../mcp/protocol.js";
import { TaskApi, isFinished, type ITaskState } from "../../mcp/taskApi.js";

interface ICall {
    name: string;
    args: Record<string, unknown>;
    timeoutMs?: number;
}

const caller = (answer: unknown[], isError = false):
    { caller: IToolCaller; calls: ICall[] } => {
    const calls: ICall[] = [];

    return {
        calls,
        caller: {
            callTool: (name, args, timeoutMs) => {
                calls.push({ name, args, ...(timeoutMs === undefined ? {}
                    : { timeoutMs }) });
                const result: IToolResult = {
                    content: answer.map((value) => {
                        return { type: "text", text: typeof value === "string"
                            ? value : JSON.stringify(value) };
                    }),
                    ...(isError ? { isError } : {}),
                };

                return Promise.resolve(result);
            },
        },
    };
};

/** A cloud deployment, as `task.get` reports it: no connection. */
const DBA_STATE: ITaskState = {
    task_id: "d1", task_type: "dba", kind: "deploy_object",
    title: "Deploy server db1", vendor: "hetzner", project: null,
    object_type: "server", status: "running", cancel_requested: false,
    created_at: "2026-10-30T10:00:00Z", started_at: "2026-10-30T10:00:01Z",
    finished_at: null, stage: "Waiting for the server", progress: null,
    stages: [{ name: "Waiting for the server", status: "running",
        seconds: null }],
    messages: [{ seq: 1, time: "2026-10-30T10:00:01Z", level: "info",
        text: "Creating server db1" }],
    messages_dropped: 0, next_since: 1, result: null, error: null,
};

describe("TaskApi", () => {
    it("waits longer than the server for a task", async () => {
        const state = { task_id: "t1", status: "running", next_since: 3 };
        const { caller: c, calls } = caller([state]);

        expect(await new TaskApi(c).getTask("t1", 2, 2000)).toEqual(state);
        expect(calls).toEqual([{
            name: "task.get",
            args: { task_id: "t1", since: 2, wait_ms: 2000 },
            timeoutMs: 32_000,
        }]);
    });

    it("lists the tasks of one type, or all", async () => {
        const { caller: c, calls } = caller([{ task_id: "a" }, { task_id: "b" }]);
        const api = new TaskApi(c);

        expect(await api.listTasks("util"))
            .toEqual([{ task_id: "a" }, { task_id: "b" }]);
        await api.listTasks("dba");
        await api.listTasks();
        expect(calls).toEqual([
            { name: "task.list", args: { task_type: "util" } },
            { name: "task.list", args: { task_type: "dba" } },
            // left out, rather than sent as null
            { name: "task.list", args: {} },
        ]);
    });

    it("cancels a task", async () => {
        const { caller: c, calls } = caller([{ task_id: "a" }]);

        await new TaskApi(c).cancelTask("a");
        expect(calls).toEqual([{ name: "task.cancel", args: { task_id: "a" } }]);
    });

    it("decodes a dba task, which has no connection", async () => {
        const { caller: c } = caller([DBA_STATE]);
        const state = await new TaskApi(c).getTask("d1");

        expect(state).toEqual(DBA_STATE);
        expect(state.connection_id).toBeUndefined();
        expect(state.vendor).toBe("hetzner");
        expect(state.object_type).toBe("server");
    });

    it("lists dba tasks beside util ones", async () => {
        const { messages: _m, messages_dropped: _d, ...summary } = DBA_STATE;
        const util = { task_id: "t1", task_type: "util", kind: "dump_schemas",
            connection_id: "c1" };
        const { caller: c } = caller([util, summary]);

        const listed = await new TaskApi(c).listTasks();
        expect(listed.map((task) => { return task.task_type; }))
            .toEqual(["util", "dba"]);
        expect(listed[1]).toEqual(summary);
    });

    it("rejects an unknown task as the server's answer", async () => {
        const { caller: c } = caller(["There is no task with the id 'x'. "
            + "Use task.list to see the tasks."], true);

        const failed = new TaskApi(c).getTask("x");
        await expect(failed).rejects.toBeInstanceOf(McpToolError);
        await expect(failed).rejects.toThrow("There is no task with the id 'x'");
    });

    it("tells finished states apart", () => {
        expect(["completed", "failed", "cancelled"].every((status) => {
            return isFinished(status as never);
        })).toBe(true);
        expect(isFinished("running")).toBe(false);
        expect(isFinished("pending")).toBe(false);
    });
});
