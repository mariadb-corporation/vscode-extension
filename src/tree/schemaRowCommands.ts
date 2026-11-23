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

/**
 * The Connections view's commands on a connection's database: showing or
 * hiding its system schemas, loading a SQL script onto it, setting its
 * current schema, and on a schema or object, copying or sending its name
 * or CREATE statement and dropping it.
 */

import * as vscode from "vscode";

import {
    UI_BACKEND_SESSION,
    type ConnectionManager,
} from "../connections/connectionManager.js";
import type { CurrentSchemas } from "../connections/currentSchemas.js";
import { guard } from "../errorMessages.js";
import type { SqlEditorBinding } from "../editor/sqlEditorBinding.js";
import { isSqlDocument } from "../editor/sqlLanguage.js";
import { OBJECT_TYPES, type ObjectType } from "../mcp/types.js";
import {
    createStatementOf,
    dropSql,
    showCreateSql,
    type IObjectTarget,
} from "../sql/objectStatements.js";
import type {
    IConnectionNode,
    IObjectNode,
    ISchemaNode,
} from "./connectionsModel.js";
import { OBJECT_TYPE_LABELS } from "./schemaTree.js";
import type { SystemSchemaVisibility } from "./systemSchemas.js";

/** What the commands need from the extension. */
export interface ISchemaRowCommandsHost {
    connections: ConnectionManager;
    editors: Pick<SqlEditorBinding,
        "runScript" | "openSqlEditor" | "bindConnection">;
    currentSchemas: CurrentSchemas;
    systemSchemas: SystemSchemaVisibility;
    /** Redraws the whole Connections view. */
    refreshTree(): void;
    log(message: string): void;
}

/**
 * @param type An object type.
 *
 * @returns Its drop command, as package.json names it: `mariadb.dropTable`.
 */
export const dropCommandOf = (type: ObjectType): string => {
    return `mariadb.drop${OBJECT_TYPE_LABELS[type]}`;
};

type SchemaOrObject = ISchemaNode | IObjectNode;

const isSchemaOrObject = (node: unknown): node is SchemaOrObject => {
    const kind = (node as { kind?: unknown } | undefined)?.kind;

    return kind === "schema" || kind === "object";
};

/**
 * @param node A schema or object row.
 *
 * @returns What the row is called.
 */
const nameOf = (node: SchemaOrObject): string => {
    return node.kind === "schema" ? node.schema : node.name;
};

/**
 * @param node A schema or object row.
 *
 * @returns What the statements are built for.
 */
export const targetOf = (node: SchemaOrObject): IObjectTarget => {
    return node.kind === "schema"
        ? { schema: node.schema }
        : {
            schema: node.schema,
            object: { type: node.objectType, name: node.name },
        };
};

/**
 * @param node A schema or object row.
 *
 * @returns What it is called in a message: `the table world.city`.
 */
export const describeRow = (node: SchemaOrObject): string => {
    return node.kind === "schema"
        ? `the schema ${node.schema}`
        : `the ${OBJECT_TYPE_LABELS[node.objectType].toLowerCase()} `
        + `${node.schema}.${node.name}`;
};

/**
 * Registers the commands.
 *
 * @param host What they need.
 *
 * @returns Their registrations.
 */
export const registerSchemaRowCommands = (
    host: ISchemaRowCommandsHost,
): vscode.Disposable[] => {
    /**
     * A command on a schema or object row, its failure reported; ignored
     * on anything else.
     */
    const onRow = (action: (node: SchemaOrObject) => Promise<void>) => {
        return async (node?: unknown): Promise<void> => {
            if (isSchemaOrObject(node)) {
                await guard(host.log, async () => { await action(node); });
            }
        };
    };

    /**
     * Reads a definition on the tree's session, which is open wherever the
     * row is shown.
     */
    const createStatement = async (node: SchemaOrObject): Promise<string> => {
        const connectionId = await host.connections.connect(node.uri,
            UI_BACKEND_SESSION);
        const api = await host.connections.api();
        const result = await api.executeSql(connectionId,
            showCreateSql(targetOf(node)));
        if (result.error !== undefined) {
            throw new Error(result.error);
        }
        const statement = createStatementOf(result.result_sets?.[0]?.rows[0]);
        if (statement === undefined) {
            throw new Error(`The definition of ${describeRow(node)} could not `
                + "be read. Seeing a routine's needs the privilege to see "
                + "its body.");
        }

        return statement;
    };

    const copy = async (text: string, what: string): Promise<void> => {
        await vscode.env.clipboard.writeText(text);
        vscode.window.setStatusBarMessage(`MariaDB: Copied ${what}.`, 3000);
    };

    /**
     * Inserts text where the caret is in the SQL editor last active, or
     * into a new one on the row's connection where none is.
     */
    const sendToEditor = async (uri: string, text: string): Promise<void> => {
        const active = vscode.window.activeTextEditor;
        let editor: vscode.TextEditor;
        if (active !== undefined && isSqlDocument(active.document)) {
            editor = await vscode.window.showTextDocument(active.document,
                active.viewColumn);
        } else {
            editor = await vscode.window.showTextDocument(
                await host.editors.openSqlEditor(uri));
        }
        await editor.edit((builder) => {
            for (const selection of editor.selections) {
                builder.replace(selection, text);
            }
        });
    };

    const drop = onRow(async (node) => {
        const what = describeRow(node);
        const detail = node.kind === "schema"
            ? "Every table, view, routine and event in it is dropped with "
            + "it. This cannot be undone."
            : "This cannot be undone.";
        const confirmed = await vscode.window.showWarningMessage(
            `Drop ${what}?`, { modal: true, detail }, "Drop");
        if (confirmed !== "Drop") {
            return;
        }

        // Run as any script is: it shows in the Actions, and a DROP that
        // succeeded redraws the connection and the language server's
        // catalog; a schema dropped is no longer the current one.
        await host.editors.runScript(node.uri, dropSql(targetOf(node)), {
            stopOnError: true,
        });
    });

    const setSystemSchemas = async (
        node: IConnectionNode | undefined,
        hidden: boolean,
    ): Promise<void> => {
        if (node?.kind !== "connection") {
            return;
        }
        await host.systemSchemas.set(node.uri, hidden);
        host.refreshTree();
    };

    return [
        vscode.commands.registerCommand("mariadb.showSystemSchemas",
            async (node?: IConnectionNode) => {
                await setSystemSchemas(node, false);
            }),

        vscode.commands.registerCommand("mariadb.hideSystemSchemas",
            async (node?: IConnectionNode) => {
                await setSystemSchemas(node, true);
            }),

        vscode.commands.registerCommand("mariadb.loadSqlScript",
            async (node?: IConnectionNode) => {
                if (node?.kind !== "connection") {
                    return;
                }
                await guard(host.log, async () => {
                    const picked = await vscode.window.showOpenDialog({
                        canSelectFiles: true,
                        canSelectFolders: false,
                        canSelectMany: false,
                        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
                        filters: {
                            "SQL Scripts": ["sql"],
                            "All Files": ["*"],
                        },
                        openLabel: "Load",
                        title: `Load SQL Script for ${node.uri}`,
                    });
                    const file = picked?.[0];
                    if (file === undefined) {
                        return;
                    }
                    const document =
                        await vscode.workspace.openTextDocument(file);
                    await vscode.window.showTextDocument(document);
                    // Picked, so it wins over a header naming another.
                    host.editors.bindConnection(document, node.uri);
                });
            }),

        vscode.commands.registerCommand("mariadb.setCurrentSchema",
            (node?: ISchemaNode) => {
                if (node?.kind !== "schema") {
                    return;
                }
                host.currentSchemas.set(node.uri, node.schema);
                vscode.window.setStatusBarMessage(
                    `MariaDB: ${node.schema} is the current schema.`, 3000);
            }),

        vscode.commands.registerCommand("mariadb.copyName",
            onRow(async (node) => { await copy(nameOf(node), "the name"); })),

        vscode.commands.registerCommand("mariadb.copyCreateStatement",
            onRow(async (node) => {
                await copy(await createStatement(node), "the CREATE statement");
            })),

        vscode.commands.registerCommand("mariadb.sendNameToEditor",
            onRow(async (node) => {
                await sendToEditor(node.uri, nameOf(node));
            })),

        vscode.commands.registerCommand("mariadb.sendCreateStatementToEditor",
            onRow(async (node) => {
                await sendToEditor(node.uri, await createStatement(node));
            })),

        vscode.commands.registerCommand("mariadb.dropSchema", drop),
        ...OBJECT_TYPES.map((type) => {
            return vscode.commands.registerCommand(dropCommandOf(type), drop);
        }),
    ];
};
