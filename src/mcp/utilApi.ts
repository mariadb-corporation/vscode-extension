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

    public async loadDump(connectionId: string, url: string,
        options?: UtilOptions): Promise<ITaskStarted> {
        return await this.#start("util.load_dump", {
            connection_id: connectionId, url,
        }, options);
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
