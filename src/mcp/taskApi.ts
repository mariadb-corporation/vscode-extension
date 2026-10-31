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

import type { IToolCaller } from "./mariaDbApi.js";
import { decodeList, decodeObject } from "./protocol.js";

/**
 * The `task.*` tools: the shell's background tasks (`mysqlsh.task_manager`),
 * whichever tool group started them - a dump, load, copy, export or import
 * from `util.*`, a cloud deployment or deletion from `dba.*`. A start call
 * answers at once with the task's id; `getTask` follows it.
 */

export type TaskStatus =
    | "pending" | "running" | "completed" | "failed" | "cancelled";

/** The tool group that started a task. */
export type TaskType = "util" | "dba";

/** The utilities a `util` task can run, as the server names them. */
export type UtilTaskKind =
    | "dump_instance" | "dump_schemas" | "dump_tables" | "export_table"
    | "load_dump" | "import_table"
    | "copy_instance" | "copy_schemas" | "copy_tables";

/** What a `dba` task does with a cloud vendor's object. */
export type DbaTaskKind = "deploy_object" | "delete_object";

export type TaskKind = UtilTaskKind | DbaTaskKind;

/** The progress of a task's current stage. */
export interface ITaskProgress {
    current: number;
    total: number;
    /** 0 to 100, or null where the total is not known yet. */
    percent: number | null;
    /** Items per second, for a stage that measures throughput. */
    throughput?: number;
    eta_seconds?: number;
    /** What is counted: `bytes` or `rows`. */
    items?: string;
    total_is_approximate?: boolean;
    total_known?: boolean;
}

export interface ITaskStage {
    name: string;
    status: TaskStatus;
    /** How long it took, once it finished. */
    seconds: number | null;
}

export interface ITaskMessage {
    seq: number;
    time: string;
    /** output, info, status, note, warning, error or diag. */
    level: string;
    text: string;
}

/** A task as `task.get` reports it. */
export interface ITaskState {
    task_id: string;
    task_type: TaskType;
    kind: TaskKind;
    title: string;
    /** The connection a `util` task works on; none for a `dba` task. */
    connection_id?: string | null;
    /** The cloud vendor of a `dba` task. */
    vendor?: string;
    /** The vendor's project of a `dba` task. */
    project?: string | null;
    /** What a `dba` task deploys or deletes. */
    object_type?: string;
    status: TaskStatus;
    cancel_requested: boolean;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
    stage: string | null;
    progress: ITaskProgress | null;
    stages: ITaskStage[];
    /** The messages after the `since` asked for; none from `listTasks`. */
    messages?: ITaskMessage[];
    messages_dropped?: number;
    /** The `since` of the next call. */
    next_since: number;
    result: Record<string, unknown> | null;
    /** Why it failed; a cancelled task can carry one too. */
    error: string | null;
}

/** What a call that starts a task answers. */
export interface ITaskStarted {
    task_id: string;
    status: TaskStatus;
}

/** How long `getTask` asks the server to wait for a change. */
export const WAIT_MS = 2000;

export const isFinished = (status: TaskStatus): boolean => {
    return status === "completed" || status === "failed"
        || status === "cancelled";
};

export interface ITaskApi {
    getTask(taskId: string, since?: number,
        waitMs?: number): Promise<ITaskState>;
    /** This client's tasks, oldest first, of one type or all. */
    listTasks(taskType?: TaskType): Promise<ITaskState[]>;
    cancelTask(taskId: string): Promise<ITaskState>;
}

export class TaskApi implements ITaskApi {
    public constructor(private readonly caller: IToolCaller) { }

    public async getTask(taskId: string, since = 0,
        waitMs = 0): Promise<ITaskState> {
        const name = "task.get";
        // Longer than the server's own wait, which is capped at 30 seconds.
        return decodeObject<ITaskState>(name, await this.caller.callTool(
            name, { task_id: taskId, since, wait_ms: waitMs },
            waitMs + 30_000));
    }

    public async listTasks(taskType?: TaskType): Promise<ITaskState[]> {
        const name = "task.list";
        return decodeList<ITaskState>(name, await this.caller.callTool(name,
            taskType === undefined ? {} : { task_type: taskType }));
    }

    public async cancelTask(taskId: string): Promise<ITaskState> {
        const name = "task.cancel";
        return decodeObject<ITaskState>(name,
            await this.caller.callTool(name, { task_id: taskId }));
    }
}
