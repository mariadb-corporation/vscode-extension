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

import type { McpServerCommand } from "../shell/mcpServer.js";
import { MariaDbApi, type IToolCaller } from "./mariaDbApi.js";
import type { IMrsAction } from "../mrs/mrsActions.js";
import { RestToolsApi } from "../mrs/mrsApi.js";
import { MsmApi, type IMsmApi } from "./msmApi.js";
import { RestdApi, type IRestdApi } from "./restdApi.js";
import { SandboxApi, type ISandboxApi } from "./sandboxApi.js";
import { TaskApi, type ITaskApi } from "./taskApi.js";
import { UtilApi, type IUtilApi } from "./utilApi.js";
import type { IMariaDbApi } from "./types.js";
import { errorText } from "../text.js";

/**
 * A live connection to a running MCP server: it answers tool calls and can
 * be closed, which also ends the server process.
 */
export interface IMcpConnection extends IToolCaller {
    close(): Promise<void>;
}

/**
 * Starts an MCP server and connects to it. Behind an interface so the
 * session's lifecycle can be tested without spawning a shell.
 */
export interface IMcpConnector {
    /**
     * @param command The shell command hosting the MCP server.
     * @param onLog Called once per line the server writes to stderr.
     *
     * @returns The connection, once the handshake has completed.
     */
    open(
        command: McpServerCommand,
        onLog: (line: string) => void,
    ): Promise<IMcpConnection>;
}

/**
 * Owns the MCP server connection for the lifetime of the extension, and
 * hands out the typed `db.*` API on top of it.
 *
 * Starting is serialized on a single promise: the tree, the editor toolbar
 * and the result panel all reach for the API independently, and without
 * this the first three of them would each start a server of their own.
 */
export class McpSession {
    #connection?: IMcpConnection;
    #starting?: Promise<IMariaDbApi>;
    #api?: IMariaDbApi;
    #sandboxApi?: ISandboxApi;
    #restdApi?: IRestdApi;
    #restTools?: RestToolsApi;

    /** Where what each `rest.*` tool call did is reported. */
    public onMrsAction?: (action: IMrsAction) => void;
    #utilApi?: IUtilApi;
    #taskApi?: ITaskApi;
    #msmApi?: IMsmApi;

    public constructor(
        private readonly connector: IMcpConnector,
        private readonly log: (message: string) => void,
    ) { }

    /**
     * @returns True while a server connection is up.
     */
    public get isRunning(): boolean {
        return this.#connection !== undefined;
    }

    /**
     * @returns The API, if a server is already running, else undefined.
     */
    public get api(): IMariaDbApi | undefined {
        return this.#api;
    }

    /**
     * @returns The `sandbox.*` API on the same server, if one is already
     *          running, else undefined. It comes up with `api` and goes
     *          with it: one server serves both.
     */
    public get sandboxApi(): ISandboxApi | undefined {
        return this.#sandboxApi;
    }

    /**
     * @returns The `restd.*` API on the same server, if one is already
     *          running, else undefined.
     */
    public get restdApi(): IRestdApi | undefined {
        return this.#restdApi;
    }

    /**
     * @returns The `rest.*` tools on the same server, if one is already
     *          running, else undefined.
     */
    public get restTools(): RestToolsApi | undefined {
        return this.#restTools;
    }

    /**
     * @returns The `util.*` tools on the same server, if one is already
     *          running, else undefined.
     */
    public get utilApi(): IUtilApi | undefined {
        return this.#utilApi;
    }

    /**
     * @returns The `task.*` tools on the same server, which follow the tasks
     *          `util.*` starts, if one is already running, else undefined.
     */
    public get taskApi(): ITaskApi | undefined {
        return this.#taskApi;
    }

    /**
     * @returns The `msm.*` tools on the same server, if one is already
     *          running, else undefined.
     */
    public get msmApi(): IMsmApi | undefined {
        return this.#msmApi;
    }

    /**
     * Starts the MCP server if it is not already running.
     *
     * @param command The shell command hosting the MCP server.
     *
     * @returns The typed API to call the server with.
     */
    public async start(command: McpServerCommand): Promise<IMariaDbApi> {
        if (this.#api) {
            return this.#api;
        }

        this.#starting ??= this.#open(command);

        try {
            return await this.#starting;
        } finally {
            this.#starting = undefined;
        }
    }

    /**
     * Stops the MCP server if one is running.
     *
     * @returns Nothing.
     */
    public async stop(): Promise<void> {
        const connection = this.#connection;
        this.#connection = undefined;
        this.#api = undefined;
        this.#sandboxApi = undefined;
        this.#restdApi = undefined;
        this.#restTools = undefined;
        this.#utilApi = undefined;
        this.#taskApi = undefined;
        this.#msmApi = undefined;
        if (!connection) {
            return;
        }

        this.log("Stopping MCP server.");
        try {
            await connection.close();
        } catch (error) {
            this.log(`Failed to stop the MCP server cleanly: `
                + errorText(error));
        }
    }

    /**
     * Opens the connection and builds the API on it.
     *
     * @param command The shell command hosting the MCP server.
     *
     * @returns The typed API.
     */
    async #open(command: McpServerCommand): Promise<IMariaDbApi> {
        this.log(`Starting MCP server: ${command.command} `
            + `${command.args.join(" ")}`);

        const connection = await this.connector.open(command, (line) => {
            this.log(line);
        });
        this.#connection = connection;
        this.#api = new MariaDbApi(connection);
        this.#sandboxApi = new SandboxApi(connection);
        this.#restdApi = new RestdApi(connection);
        this.#restTools = new RestToolsApi(connection, (action) => {
            this.onMrsAction?.(action);
        });
        this.#utilApi = new UtilApi(connection);
        this.#taskApi = new TaskApi(connection);
        this.#msmApi = new MsmApi(connection);
        this.log("MCP server ready.");

        return this.#api;
    }
}
