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

import { readdir, stat } from "node:fs/promises";
import * as path from "node:path";

import * as vscode from "vscode";

import { connectionLabel } from "../connections/connectionUri.js";
import type {
    ConnectionsNode,
    IConnectionNode,
    IObjectNode,
    ISchemaNode,
} from "../tree/connectionsModel.js";
import type { ITaskStarted } from "../mcp/taskApi.js";
import type { IUtilApi, UtilOptions } from "../mcp/utilApi.js";
import { errorText } from "../text.js";
import { isZipDump, quoteName, withZipSuffix } from "./dumpSelection.js";
import {
    canResume,
    type IResumeLoad,
    type ITrackedTask,
    type TaskMonitor,
} from "./taskMonitor.js";
import { pickDump, UtilDialogPanel } from "./utilDialogPanel.js";
import {
    utilOperationSpec,
    type IUtilProblem,
    type UtilOperation,
    type UtilValues,
} from "./utilFields.js";

/**
 * The `workspaceState` key of whether the last dump went to one ZIP file
 * (`IUtilCommandsHost.zipDumps`).
 */
export const ZIP_DUMPS_KEY = "mariadb.zipDumps";

/** What the dump, load, copy, export and import commands need. */
export interface IUtilCommandsHost {
    extensionUri: vscode.Uri;
    /** Opens the tree's session on a connection; returns its id. */
    connect(uri: string): Promise<string>;
    /** The configured connections, which a copy can go to. */
    connectionUris(): Promise<string[]>;
    utilApi(): Promise<IUtilApi>;
    monitor: TaskMonitor;
    /**
     * Reads the Connections view again, after a load or a copy changed a
     * server.
     *
     * @param uri The connection whose server changed.
     */
    refresh(uri: string): void;
    /** Where a new dump goes, unless the user picks another place. */
    defaultFolder(): string;
    /**
     * Checks where a dump goes, a folder or a zip; {@link dumpPathProblem}
     * where not given.
     */
    checkDumpFolder?(folder: string | undefined):
        Promise<IUtilProblem | undefined>;
    /**
     * Whether the last dump started went to one ZIP file, which the next
     * dump dialog starts with; kept per workspace.
     */
    zipDumps?: { get(): boolean; set(zip: boolean): void };
    /** Picks a dump to load; {@link pickDump} where not given. */
    pickDump?(title: string, current?: string): Promise<string | undefined>;
    /**
     * Puts up a task that did not start, as a row of its connection's
     * Actions (see `TaskActionLog.startFailed`).
     */
    startFailed?(connection: string, title: string, call: string,
        error: string): void;
    /**
     * Brings up the panel on a connection's Actions: at what failed, or,
     * with `atFailure` false, as a dump or load starts, at its row.
     */
    showActions?(uri: string, atFailure?: boolean): void;
    log(message: string): void;
}

/** The rows a command applies to: the one it was opened on, or the selection. */
const selected = <T extends ConnectionsNode>(
    node: T,
    selection: ConnectionsNode[] | undefined,
    matches: (candidate: ConnectionsNode) => candidate is T,
): T[] => {
    const picked = (selection ?? []).filter(matches);
    // By what the row is, not which object: a selection made before the
    // tree redrew holds other objects for the same rows.
    const key = (candidate: ConnectionsNode): string => {
        return JSON.stringify([candidate.kind,
            "uri" in candidate ? candidate.uri : "",
            "schema" in candidate ? candidate.schema : "",
            "name" in candidate ? candidate.name : ""]);
    };
    const opened = key(node);

    return picked.some((candidate) => { return key(candidate) === opened; })
        ? picked : [node];
};

const isSchema = (candidate: ConnectionsNode): candidate is ISchemaNode => {
    return candidate.kind === "schema";
};

const isTable = (candidate: ConnectionsNode): candidate is IObjectNode => {
    return candidate.kind === "object"
        && (candidate.objectType === "table" || candidate.objectType === "view");
};

/** A name for a new dump folder: what is dumped and when. */
export const dumpFolderName = (name: string, now = new Date()): string => {
    const pad = (value: number): string => { return String(value).padStart(2, "0"); };
    const stamp = `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-`
        + `${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

    return `${name.replace(/[^\w.-]+/gu, "_")}-${stamp}`;
};

interface IStart {
    operation: UtilOperation;
    uri: string;
    schemas?: string[];
    tables?: string[];
    initialPath?: string;
    /** Values the dialog starts with in place of the defaults. */
    initialValues?: UtilValues;
    /** Whether the server's contents change, so the tree is read again. */
    changes: boolean;
    /** How to start it again, for a load. */
    resume?(options: UtilOptions, paths: string[]): IResumeLoad;
    run(api: IUtilApi, connectionId: string, options: UtilOptions,
        paths: string[], targetId?: string): Promise<ITaskStarted>;
}

export class UtilCommands {
    public constructor(private readonly host: IUtilCommandsHost) { }

    public register(): vscode.Disposable[] {
        const commands: Record<string, (...args: never[]) => unknown> = {
            "mariadb.dumpInstance": (node?: IConnectionNode) => {
                return this.#connectionCommand(node, "dumpInstance");
            },
            "mariadb.loadDump": (node?: IConnectionNode) => {
                return this.#connectionCommand(node, "loadDump");
            },
            "mariadb.loadTableDump": (node?: ISchemaNode) => {
                return this.#schemaCommand(node, undefined, "loadTableDump");
            },
            "mariadb.copyInstance": (node?: IConnectionNode) => {
                return this.#connectionCommand(node, "copyInstance");
            },
            "mariadb.dumpSchemas": (node?: ISchemaNode,
                selection?: ConnectionsNode[]) => {
                return this.#schemaCommand(node, selection, "dumpSchemas");
            },
            "mariadb.copySchemas": (node?: ISchemaNode,
                selection?: ConnectionsNode[]) => {
                return this.#schemaCommand(node, selection, "copySchemas");
            },
            "mariadb.dumpTables": (node?: IObjectNode,
                selection?: ConnectionsNode[]) => {
                return this.#tableCommand(node, selection, "dumpTables");
            },
            "mariadb.copyTables": (node?: IObjectNode,
                selection?: ConnectionsNode[]) => {
                return this.#tableCommand(node, selection, "copyTables");
            },
            "mariadb.exportTable": (node?: IObjectNode) => {
                return this.#tableCommand(node, undefined, "exportTable");
            },
            "mariadb.importTable": (node?: IObjectNode) => {
                return this.#tableCommand(node, undefined, "importTable");
            },
            "mariadb.cancelTask": (item?: ITrackedTask) => {
                if (item !== undefined) {
                    void this.host.monitor.cancel(item.state.task_id);
                }
            },
            "mariadb.resumeTask": (item?: ITrackedTask) => {
                if (item !== undefined && canResume(item)) {
                    void this.#resume(item);
                }
            },
            "mariadb.removeTask": (item?: ITrackedTask) => {
                if (item !== undefined) {
                    this.host.monitor.remove(item.state.task_id);
                }
            },
            "mariadb.clearFinishedTasks": () => {
                this.host.monitor.clearFinished();
            },
            "mariadb.showTaskLog": (item?: ITrackedTask) => {
                if (item !== undefined) {
                    this.host.monitor.openLog?.(item);
                }
            },
            "mariadb.showTaskOutput": () => {
                this.host.monitor.showOutput();
            },
        };

        return Object.entries(commands).map(([id, handler]) => {
            return vscode.commands.registerCommand(id, handler);
        });
    }

    #connectionCommand(node: IConnectionNode | undefined,
        operation: UtilOperation): void {
        if (node?.kind !== "connection") {
            return;
        }
        const name = connectionLabel(node.uri);

        switch (operation) {
            case "dumpInstance": {
                this.#open({
                    operation, uri: node.uri, changes: false,
                    ...this.#dumpTo(dumpFolderName(name.replace(/^.*@/u, ""))),
                    run: (api, id, options, paths) => {
                        return api.dumpInstance(id, paths[0], options);
                    },
                });
                break;
            }

            case "loadDump": {
                void this.#openLoad({ operation, uri: node.uri });
                break;
            }

            default: {
                this.#open({
                    operation, uri: node.uri, changes: true,
                    run: (api, id, options, _paths, target) => {
                        return api.copyInstance(id, target!, options);
                    },
                });
            }
        }
    }

    #schemaCommand(node: ISchemaNode | undefined,
        selection: ConnectionsNode[] | undefined,
        operation: UtilOperation): void {
        if (node?.kind !== "schema") {
            return;
        }
        const schemas = selected(node, selection, isSchema)
            .filter((candidate) => { return candidate.uri === node.uri; })
            .map((candidate) => { return candidate.schema; });

        if (operation === "loadTableDump") {
            void this.#openLoad({ operation, uri: node.uri,
                schemas: [node.schema] });

            return;
        }

        if (operation === "dumpSchemas") {
            this.#open({
                operation, uri: node.uri, schemas, changes: false,
                ...this.#dumpTo(dumpFolderName(schemas.length === 1
                    ? schemas[0] : "schemas")),
                run: (api, id, options, paths) => {
                    return api.dumpSchemas(id, schemas, paths[0], options);
                },
            });

            return;
        }

        this.#open({
            operation, uri: node.uri, schemas, changes: true,
            run: (api, id, options, _paths, target) => {
                return api.copySchemas(id, schemas, target!, options);
            },
        });
    }

    #tableCommand(node: IObjectNode | undefined,
        selection: ConnectionsNode[] | undefined,
        operation: UtilOperation): void {
        if (node === undefined || !isTable(node)) {
            return;
        }
        const tables = selected(node, selection, isTable)
            .filter((candidate) => {
                return candidate.uri === node.uri
                    && candidate.schema === node.schema;
            })
            .map((candidate) => { return candidate.name; });
        const schema = node.schema;
        const subject = { uri: node.uri, schemas: [schema], tables };

        switch (operation) {
            case "dumpTables": {
                this.#open({
                    ...subject, operation, changes: false,
                    ...this.#dumpTo(dumpFolderName(tables.length === 1
                        ? `${schema}.${tables[0]}` : schema)),
                    run: (api, id, options, paths) => {
                        return api.dumpTables(id, schema, tables, paths[0],
                            options);
                    },
                });
                break;
            }

            case "copyTables": {
                this.#open({
                    ...subject, operation, changes: true,
                    run: (api, id, options, _paths, target) => {
                        return api.copyTables(id, schema, tables, target!,
                            options);
                    },
                });
                break;
            }

            case "exportTable": {
                this.#open({
                    ...subject, tables: [node.name], operation, changes: false,
                    initialPath: path.join(this.host.defaultFolder(),
                        `${schema}.${node.name}.tsv`),
                    run: (api, id, options, paths) => {
                        return api.exportTable(id,
                            `${quoteName(schema)}.${quoteName(node.name)}`,
                            paths[0], options);
                    },
                });
                break;
            }

            default: {
                this.#open({
                    ...subject, tables: [node.name], operation, changes: true,
                    run: (api, id, options, paths) => {
                        return api.importTable(id,
                            paths.length === 1 ? paths[0] : paths, options);
                    },
                });
            }
        }
    }

    /**
     * Starts a load that stopped again, in place of its row: it loads what
     * the first one had not, from the progress file in the dump folder.
     */
    async #resume(tracked: ITrackedTask): Promise<void> {
        const resume = tracked.resume!;
        try {
            const id = await this.host.connect(resume.uri);
            const started = await (await this.host.utilApi()).loadDump(id,
                resume.url, resume.options);
            this.host.log(`Resumed ${tracked.state.title}.`);
            this.host.monitor.remove(tracked.state.task_id);
            this.host.showActions?.(resume.uri, false);

            void this.host.monitor.follow(started, {
                title: tracked.state.title,
                connection: resume.uri,
                call: utilCall("loadDump", {}, [resume.url], resume.options),
                resume,
                onDone: (state) => {
                    if (state.status !== "failed") {
                        this.host.refresh(resume.uri);
                    }
                },
            });
        } catch (error) {
            void vscode.window.showErrorMessage(
                `Could not resume ${tracked.state.title}: ${errorText(error)}`);
        }
    }

    /**
     * Where a new dump goes, and whether to one file, as the last dump
     * started did.
     *
     * @param name The folder's name.
     *
     * @returns The dialog's path and its Dump to Self-Contained ZIP File.
     */
    #dumpTo(name: string): Pick<IStart, "initialPath" | "initialValues"> {
        const zip = this.host.zipDumps?.get() === true;

        return {
            initialPath: withZipSuffix(
                path.join(this.host.defaultFolder(), name), zip),
            initialValues: { zip },
        };
    }

    /**
     * Picks the dump, then opens the Load dialog on it, which reads what it
     * holds. Nothing opens where no dump is picked.
     */
    async #openLoad(load: { operation: "loadDump" | "loadTableDump";
        uri: string; schemas?: string[] }): Promise<void> {
        const title = load.operation === "loadDump"
            ? "Load a Dump from Disk"
            : `Load a Table Dump into ${load.schemas?.[0] ?? ""}`;
        const picked = await (this.host.pickDump ?? pickDump)(title);
        if (picked === undefined) {
            return;
        }

        this.#open({
            ...load, changes: true, initialPath: picked,
            run: (api, id, options, paths) => {
                return api.loadDump(id, paths[0], options);
            },
            resume: (options, paths) => {
                // Starting over would load everything again.
                const { resetProgress: _reset, ...kept } = options;

                return { operation: "loadDump", uri: load.uri,
                    url: paths[0], options: kept };
            },
        });
    }

    /** Opens the dialog for an operation, which then starts and follows it. */
    #open(start: IStart): void {
        const spec = utilOperationSpec(start.operation, {
            connection: connectionLabel(start.uri),
            schemas: start.schemas,
            tables: start.tables,
        });
        const needsTarget = spec.target === true;

        void (async () => {
            const targets = needsTarget
                ? (await this.host.connectionUris()).filter((uri) => {
                    return uri !== start.uri;
                })
                : [];

            UtilDialogPanel.show(this.host.extensionUri, spec, {
                initialPath: start.initialPath,
                initialValues: start.initialValues,
                targets,
                ...(spec.inspects === true
                    ? { inspect: async (url: string, schema?: string) => {
                        return await (await this.host.utilApi())
                            .inspectDump(url, schema);
                    } }
                    : {}),
                log: this.host.log,
                ...(DUMPS.has(start.operation)
                    ? { check: async (paths: string[]) => {
                        return await (this.host.checkDumpFolder
                            ?? dumpPathProblem)(paths[0]);
                    } }
                    : {}),
                start: async (options, paths, target, values) => {
                    const call = utilCall(start.operation, start,
                        target === undefined ? paths
                            : [connectionLabel(target)], options);
                    let started;
                    try {
                        const id = await this.host.connect(start.uri);
                        const targetId = target === undefined ? undefined
                            : await this.host.connect(target);
                        const api = await this.host.utilApi();
                        started = await start.run(api, id, options, paths,
                            targetId);
                    } catch (error) {
                        // No task to follow, so its row says so itself -
                        // also where the dialog was closed meanwhile.
                        this.host.startFailed?.(start.uri, spec.title, call,
                            errorText(error));
                        throw error;
                    }
                    this.host.log(`Started ${spec.title}.`);
                    if (DUMPS.has(start.operation)) {
                        this.host.zipDumps?.set(values?.zip === true);
                    }

                    // Followed from here on, not awaited: the dialog closes
                    // as soon as the work runs.
                    void this.host.monitor.follow(started, {
                        title: spec.title,
                        connection: start.uri,
                        call,
                        ...(start.resume === undefined ? {}
                            : { resume: start.resume(options, paths) }),
                        onDone: (state) => {
                            // A copy changes the server it goes to.
                            if (start.changes && state.status !== "failed") {
                                this.host.refresh(target ?? start.uri);
                            }
                        },
                    });
                    // A dump or load shows its row as it starts.
                    if (DUMPS.has(start.operation)
                        || LOADS.has(start.operation)) {
                        this.host.showActions?.(start.uri, false);
                    }
                },
                onFailed: () => {
                    this.host.showActions?.(start.uri);
                },
            });
        })();
    }
}

/** The `util.*` tool behind each operation. */
const TOOLS: Record<UtilOperation, string> = {
    dumpInstance: "util.dump_instance",
    dumpSchemas: "util.dump_schemas",
    dumpTables: "util.dump_tables",
    exportTable: "util.export_table",
    loadDump: "util.load_dump",
    loadTableDump: "util.load_dump",
    importTable: "util.import_table",
    copyInstance: "util.copy_instance",
    copySchemas: "util.copy_schemas",
    copyTables: "util.copy_tables",
};

/**
 * The call a task was started with, as the Actions tab and the task's log
 * name it: the tool, what it works on, where to, and the options that
 * differ from the shell's defaults.
 *
 * @param operation What was started.
 * @param names The schemas and tables it works on.
 * @param where The paths, or the target connection's address.
 * @param options The options sent.
 *
 * @returns `util.dump_schemas(shop, crm, /home/me/dump, {"threads":8})`.
 */
export const utilCall = (
    operation: UtilOperation,
    names: { schemas?: string[]; tables?: string[] },
    where: string[],
    options: UtilOptions,
): string => {
    const subject = operation === "dumpInstance" || operation === "loadDump"
        || operation === "loadTableDump" || operation === "importTable" || operation === "copyInstance"
        ? []
        : operation === "exportTable"
            ? [`${names.schemas?.[0] ?? ""}.${names.tables?.[0] ?? ""}`]
            : operation === "dumpTables" || operation === "copyTables"
                ? [names.schemas?.[0] ?? "", ...(names.tables ?? [])]
                : names.schemas ?? [];
    const args = [...subject, ...where];
    if (Object.keys(options).length > 0) {
        args.push(JSON.stringify(options));
    }

    return `${TOOLS[operation]}(${args.join(", ")})`;
};

/** The operations that write a dump: a folder or one zip. */
const DUMPS: ReadonlySet<UtilOperation> = new Set<UtilOperation>([
    "dumpInstance", "dumpSchemas", "dumpTables",
]);

/** The operations that load a dump. */
const LOADS: ReadonlySet<UtilOperation> = new Set<UtilOperation>([
    "loadDump", "loadTableDump",
]);

/**
 * Says what the shell would refuse about where a dump goes, before the dump
 * is started: a folder that holds something already, a file in its place,
 * or a `.mariadb.dump.zip` that exists. The server runs on this machine, so
 * the extension sees the same files.
 *
 * @param target The folder or zip the dump is to go to.
 *
 * @returns The problem, or undefined where the dump can go there.
 */
export const dumpPathProblem = async (
    target: string | undefined,
): Promise<IUtilProblem | undefined> => {
    if (target === undefined) {
        return undefined;
    }
    if (isZipDump(target)) {
        try {
            await stat(target);

            return {
                field: "path",
                message: "This file exists already. Pick a new name: a dump "
                    + "never writes over another.",
            };
        } catch {
            // ENOENT: the dump makes it. Anything else, the shell reports.
            return undefined;
        }
    }
    try {
        const entries = await readdir(target);
        if (entries.length > 0) {
            return {
                field: "path",
                message: "This folder is not empty. Pick a new or an empty "
                    + "one: a dump never writes over another.",
            };
        }
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOTDIR") {
            return { field: "path", message: "This is a file, not a folder." };
        }
        // ENOENT: the dump makes it. Anything else, the shell reports.
    }

    return undefined;
};
