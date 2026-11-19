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
import { decodeObject } from "./protocol.js";
import type { ITaskStarted } from "./taskApi.js";

/**
 * The `util.*` tools: the shell's dump, load, copy, export and import
 * utilities, each run by the server as a background task of type `util`. A
 * start call answers at once with the task's id; the `task.*` tools
 * (`ITaskApi`) follow it.
 */

/** Options of a utility, with the shell's camelCase names. */
export type UtilOptions = Record<string, unknown>;

/** How long a start call may take: it opens a session first. */
export const START_TIMEOUT_MS = 2 * 60 * 1000;

/** The dump utility that made a dump. */
export type DumpKind = "dumpInstance" | "dumpSchemas" | "dumpTables";

/**
 * A schema of a dump, as `util.inspect_dump` tells it. Without the call's
 * `schema` argument each list holds at most 100 names; the counts are
 * always whole.
 */
export interface IDumpSchemaInfo {
    name: string;
    tables: string[];
    table_count: number;
    views: string[];
    view_count: number;
    functions: string[];
    function_count: number;
    procedures: string[];
    procedure_count: number;
    events: string[];
    event_count: number;
    /** Exact, for a complete dump only. */
    rows?: number;
    data_bytes?: number;
}

/** What a dump folder or `.mariadb.dump.zip` holds: `util.inspect_dump`. */
export interface IDumpInfo {
    url: string;
    format: "folder" | "zip";
    /** Null where the dump's `@.json` names no utility. */
    kind: DumpKind | null;
    complete: boolean;
    source: {
        server: string | null;
        server_version: string | null;
        user: string | null;
    };
    begin: string | null;
    end: string | null;
    /** The options the dump was made with. */
    options: Record<string, unknown>;
    includes_users: boolean;
    /** The accounts, as the shell writes them: `'u'@'h'`. */
    users: string[];
    user_count: number;
    schema_count: number;
    schemas: IDumpSchemaInfo[];
    /** The data files as stored: compressed. */
    data_file_bytes: number;
    size_bytes: number;
    /** Every file of the dump, extracted. */
    extracted_bytes?: number;
    /** For a zip: the free space a load needs next to it. */
    disk_needed_bytes?: number;
    /** For a complete dump. */
    rows?: number;
    data_bytes?: number;
    /** For a dump that is not complete. */
    estimated_rows?: number | null;
    estimated_data_bytes?: number | null;
}

export interface IUtilApi {
    dumpInstance(connectionId: string, outputUrl: string,
        options?: UtilOptions): Promise<ITaskStarted>;
    dumpSchemas(connectionId: string, schemas: string[], outputUrl: string,
        options?: UtilOptions): Promise<ITaskStarted>;
    dumpTables(connectionId: string, schema: string, tables: string[],
        outputUrl: string, options?: UtilOptions): Promise<ITaskStarted>;
    exportTable(connectionId: string, table: string, outputUrl: string,
        options?: UtilOptions): Promise<ITaskStarted>;
    loadDump(connectionId: string, url: string,
        options?: UtilOptions): Promise<ITaskStarted>;
    importTable(connectionId: string, urls: string | string[],
        options?: UtilOptions): Promise<ITaskStarted>;
    copyInstance(connectionId: string, targetConnectionId: string,
        options?: UtilOptions): Promise<ITaskStarted>;
    /**
     * Reads a dump's metadata, at once and without a task.
     *
     * @param url The dump's folder or `.mariadb.dump.zip`.
     * @param schema Only this schema, with every name of its objects.
     */
    inspectDump(url: string, schema?: string): Promise<IDumpInfo>;
    copySchemas(connectionId: string, schemas: string[],
        targetConnectionId: string,
        options?: UtilOptions): Promise<ITaskStarted>;
    copyTables(connectionId: string, schema: string, tables: string[],
        targetConnectionId: string,
        options?: UtilOptions): Promise<ITaskStarted>;
}

export class UtilApi implements IUtilApi {
    public constructor(private readonly caller: IToolCaller) { }

    public async dumpInstance(connectionId: string, outputUrl: string,
        options?: UtilOptions): Promise<ITaskStarted> {
        return await this.#start("util.dump_instance", {
            connection_id: connectionId, output_url: outputUrl,
        }, options);
    }

    public async dumpSchemas(connectionId: string, schemas: string[],
        outputUrl: string, options?: UtilOptions): Promise<ITaskStarted> {
        return await this.#start("util.dump_schemas", {
            connection_id: connectionId, schemas, output_url: outputUrl,
        }, options);
    }

    public async dumpTables(connectionId: string, schema: string,
        tables: string[], outputUrl: string,
        options?: UtilOptions): Promise<ITaskStarted> {
        return await this.#start("util.dump_tables", {
            connection_id: connectionId, schema, tables, output_url: outputUrl,
        }, options);
    }

    public async exportTable(connectionId: string, table: string,
        outputUrl: string, options?: UtilOptions): Promise<ITaskStarted> {
        return await this.#start("util.export_table", {
            connection_id: connectionId, table, output_url: outputUrl,
        }, options);
    }

    /**
     * `options` may hold `extraction_budget_mb`, which the dialog takes as
     * an option and the tool as an argument of its own (for a zip only).
     */
    public async loadDump(connectionId: string, url: string,
        options?: UtilOptions): Promise<ITaskStarted> {
        const { extraction_budget_mb: budget, ...rest } = options ?? {};

        return await this.#start("util.load_dump", {
            connection_id: connectionId, url,
            ...(budget === undefined ? {} : { extraction_budget_mb: budget }),
        }, options === undefined ? undefined : rest);
    }

    public async importTable(connectionId: string, urls: string | string[],
        options?: UtilOptions): Promise<ITaskStarted> {
        return await this.#start("util.import_table", {
            connection_id: connectionId, urls,
        }, options);
    }

    public async copyInstance(connectionId: string, targetConnectionId: string,
        options?: UtilOptions): Promise<ITaskStarted> {
        return await this.#start("util.copy_instance", {
            connection_id: connectionId,
            target_connection_id: targetConnectionId,
        }, options);
    }

    public async inspectDump(url: string,
        schema?: string): Promise<IDumpInfo> {
        const name = "util.inspect_dump";

        return decodeObject<IDumpInfo>(name, await this.caller.callTool(name,
            schema === undefined ? { url } : { url, schema }));
    }

    public async copySchemas(connectionId: string, schemas: string[],
        targetConnectionId: string,
        options?: UtilOptions): Promise<ITaskStarted> {
        return await this.#start("util.copy_schemas", {
            connection_id: connectionId, schemas,
            target_connection_id: targetConnectionId,
        }, options);
    }

    public async copyTables(connectionId: string, schema: string,
        tables: string[], targetConnectionId: string,
        options?: UtilOptions): Promise<ITaskStarted> {
        return await this.#start("util.copy_tables", {
            connection_id: connectionId, schema, tables,
            target_connection_id: targetConnectionId,
        }, options);
    }

    async #start(name: string, args: Record<string, unknown>,
        options?: UtilOptions): Promise<ITaskStarted> {
        const withOptions = options === undefined
            || Object.keys(options).length === 0
            ? args : { ...args, options };

        return decodeObject<ITaskStarted>(name,
            await this.caller.callTool(name, withOptions, START_TIMEOUT_MS));
    }
}
