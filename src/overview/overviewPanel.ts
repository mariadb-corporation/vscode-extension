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

import * as vscode from "vscode";

import { normalizeFolder } from "../connections/connectionFolders.js";
import type { IStoredConnection } from "../connections/connectionStore.js";
import {
    connectionLabel,
    isDefaultConnection,
} from "../connections/connectionUri.js";
import type { ConnectionColor } from "../mcp/types.js";
import { errorText } from "../text.js";
import type { IDeploymentFolderNode } from "../tree/deploymentsTreeProvider.js";
import {
    restdCommandIds,
    restdState,
    type IRestdNode,
} from "../tree/restdTreeProvider.js";
import {
    sandboxCommandIds,
    sandboxDescription,
    sandboxIcon,
} from "../tree/sandboxesTreeProvider.js";
import { connectionIconFor } from "../tree/treeItems.js";
import { DialogPanel } from "../webview/dialogPanel.js";
import { buildWebviewHtml } from "../webview/html.js";
import type {
    IOverviewDeployment,
    IOverviewSnapshot,
} from "./overviewModel.js";
import type {
    IOverviewConnectionRef,
    OverviewConnectionAction,
    OverviewHostMessage,
    OverviewWebviewMessage,
} from "./overviewProtocol.js";

/** What the overview needs from the extension, so a test can supply it. */
export interface IOverviewHost {
    /** Everything to show; rejects where the connections cannot be listed. */
    list(): Promise<IOverviewSnapshot>;
    /** Fires whenever what `list` answers may have changed. */
    readonly onDidChange: vscode.Event<unknown>;
    /** Fires whenever what `showGreeting` answers may have changed. */
    readonly onDidChangeGreeting: vscode.Event<unknown>;
    /** Whether the welcome text is shown. */
    showGreeting(): boolean;
    /** Keeps the welcome text closed from now on. */
    closeGreeting(): Promise<void>;
    /** Opens a new SQL editor on the connection. */
    openSqlEditor(connection: IOverviewConnectionRef): Promise<void>;
    /** Opens a new MariaDB Notebook on the connection. */
    openNotebook(connection: IOverviewConnectionRef): Promise<void>;
    /** Opens the connection editor for a new one, filed in the folder. */
    newConnection(folder: string): void;
    /** Does what a tile's More Actions menu asked for. */
    connectionAction(
        action: OverviewConnectionAction,
        connection: IOverviewConnectionRef,
    ): Promise<void>;
    /** The deployments; rejects where they cannot be listed. */
    listDeployments(): Promise<IOverviewDeployment[]>;
    /** Fires whenever what `listDeployments` answers may have changed. */
    readonly onDidChangeDeployments: vscode.Event<unknown>;
    /** Opens the New Deployment wizard. */
    newDeployment(): void;
    /**
     * Runs a deployment tile's menu entry: one of the Deployments view's
     * commands on the sandbox, or on one of its REST Daemons.
     */
    deploymentCommand(
        command: string,
        port: number,
        directory?: string,
    ): Promise<void>;
    log(message: string): void;
}

/** The view type the panel is registered under. */
export const OVERVIEW_VIEW_TYPE = "mariadb.overview";

/** The tab's title. */
const TITLE = "Overview";

/**
 * Turns the configured connections into what the overview shows.
 *
 * @param stored Every configured connection.
 * @param customFolders The folders the user made and has not filled.
 * @param defaultConnection The default connection's URI, if there is one.
 * @param folderColors The colors the user gave folders, by path.
 *
 * @returns The snapshot.
 */
export const overviewSnapshot = (
    stored: IStoredConnection[],
    customFolders: string[],
    defaultConnection: string | undefined,
    folderColors: Record<string, ConnectionColor> = {},
): IOverviewSnapshot => {
    return {
        connections: stored.map((connection) => {
            const isDefault =
                isDefaultConnection(connection.uri, defaultConnection);

            return {
                uri: connection.uri,
                kind: connection.kind,
                path: normalizeFolder(connection.path ?? "/"),
                ...(connection.caption === undefined
                    ? {} : { caption: connection.caption }),
                ...(connection.color === undefined
                    ? {} : { color: connection.color }),
                address: connectionLabel(connection.uri),
                isDefault,
                icon: connectionIconFor(connection.uri, isDefault)
                    .replace(/\.svg$/u, ""),
            };
        }),
        customFolders,
        folderColors,
    };
};

/**
 * @param daemons A sandbox's REST Daemons.
 *
 * @returns What its tile says of them: the one's state, or how many.
 */
const daemonSummary = (daemons: IRestdNode[]): string | undefined => {
    if (daemons.length === 1) {
        return `REST Daemon ${restdState(daemons[0]!)}`;
    }

    return daemons.length > 1
        ? `${String(daemons.length)} REST Daemons` : undefined;
};

/**
 * Turns the Deployments view's folders into what the overview shows: each
 * sandbox as its row says it, with its icon, and its menu - the commands
 * that apply to it and its REST Daemons now, by the view's own rules.
 *
 * @param folders The folders, as `DeploymentsTreeProvider.listFolders`
 *                gives them.
 * @param titleOf A command's title, as the view's menus show it.
 *
 * @returns Each sandbox, filed in its folder.
 */
export const overviewDeployments = (
    folders: IDeploymentFolderNode[],
    titleOf: (command: string) => string,
): IOverviewDeployment[] => {
    return folders.flatMap((folder) => {
        return folder.children.map((sandbox): IOverviewDeployment => {
            const summary = daemonSummary(sandbox.daemons);
            const icon = sandboxIcon(sandbox);
            // Which daemon an entry is for, where there is more than one.
            const which = (daemon: IRestdNode): string => {
                return sandbox.daemons.length > 1
                    ? ` (port ${String(daemon.port)})` : "";
            };

            return {
                port: sandbox.port,
                path: normalizeFolder(folder.label),
                description: [sandboxDescription(sandbox),
                    ...(summary === undefined ? [] : [summary])].join(" · "),
                icon: icon.id,
                ...(icon.color === undefined ? {} : { iconColor: icon.color }),
                menu: [
                    sandboxCommandIds(sandbox).map((command) => {
                        return { command, title: titleOf(command) };
                    }),
                    ...sandbox.daemons.map((daemon) => {
                        return restdCommandIds(daemon).map((command) => {
                            return {
                                command,
                                title: titleOf(command) + which(daemon),
                                directory: daemon.directory,
                            };
                        });
                    }),
                ],
            };
        });
    });
};

/**
 * The MariaDB Workbench overview: a welcome text and a tile per
 * connection and folder, in an editor tab, and below them the deployments
 * as the Deployments view lists them. A click on a connection's tile
 * opens a SQL editor on it, one on a deployment's its menu, one on a
 * folder's goes into it.
 *
 * One at a time: asking again reveals the one that is up.
 */
export class OverviewPanel
    extends DialogPanel<OverviewHostMessage, OverviewWebviewMessage> {
    static #current: OverviewPanel | undefined;

    readonly #listening: vscode.Disposable[];
    /** Each section's listing being sent; a newer one makes it stale. */
    readonly #sending = { connections: 0, deployments: 0 };

    private constructor(
        extensionUri: vscode.Uri,
        private readonly host: IOverviewHost,
    ) {
        super(OVERVIEW_VIEW_TYPE, TITLE, extensionUri);
        this.panel.iconPath = {
            light: vscode.Uri.joinPath(extensionUri, "images", "light",
                "connectionMariaDB.svg"),
            dark: vscode.Uri.joinPath(extensionUri, "images", "dark",
                "connectionMariaDB.svg"),
        };
        this.#listening = [
            host.onDidChange(() => { void this.#send(); }),
            host.onDidChangeGreeting(() => { this.#sendGreeting(); }),
            host.onDidChangeDeployments(() => {
                void this.#sendDeployments();
            }),
        ];
        this.panel.webview.html = buildWebviewHtml(this.panel.webview,
            extensionUri, "overview", TITLE);
    }

    /**
     * Shows the overview.
     *
     * @param extensionUri The root of the installed extension.
     * @param host What the overview needs from the extension.
     *
     * @returns Nothing.
     */
    public static show(extensionUri: vscode.Uri, host: IOverviewHost): void {
        if (OverviewPanel.#current) {
            OverviewPanel.#current.panel.reveal(vscode.ViewColumn.Active);

            return;
        }

        OverviewPanel.#current = new OverviewPanel(extensionUri, host);
    }

    /**
     * Closes the overview, if it is open. Used when the extension shuts
     * down.
     *
     * @returns Nothing.
     */
    public static disposeCurrent(): void {
        OverviewPanel.#current?.close();
    }

    protected onDisposed(): void {
        for (const listening of this.#listening) {
            listening.dispose();
        }
        OverviewPanel.#current = undefined;
    }

    /**
     * Sends whether the welcome text is shown.
     *
     * @returns Nothing.
     */
    #sendGreeting(): void {
        this.post({ type: "greeting", showGreeting: this.host.showGreeting() });
    }

    /**
     * Lists one section and sends it, unless a newer listing of it has
     * started meanwhile; says why where it could not.
     *
     * @param section Which.
     * @param list How it is listed, into the message that carries it.
     *
     * @returns Nothing.
     */
    async #sendListing(
        section: "connections" | "deployments",
        list: () => Promise<OverviewHostMessage>,
    ): Promise<void> {
        const sending = ++this.#sending[section];
        try {
            const message = await list();
            if (sending === this.#sending[section]) {
                this.post(message);
            }
        } catch (error) {
            this.host.log(`The overview could not list the ${section}: ${
                errorText(error)}`);
            if (sending === this.#sending[section]) {
                this.post({ type: "failed", section,
                    message: errorText(error) });
            }
        }
    }

    /**
     * Lists the connections and sends them.
     *
     * @returns Nothing.
     */
    async #send(): Promise<void> {
        await this.#sendListing("connections", async () => {
            return { type: "connections", ...await this.host.list() };
        });
    }

    /**
     * Lists the deployments and sends them.
     *
     * @returns Nothing.
     */
    async #sendDeployments(): Promise<void> {
        await this.#sendListing("deployments", async () => {
            return {
                type: "deployments",
                deployments: await this.host.listDeployments(),
            };
        });
    }

    /**
     * Handles one message from the webview.
     *
     * @param message The message that arrived.
     *
     * @returns Nothing.
     */
    protected async onMessage(message: OverviewWebviewMessage): Promise<void> {
        switch (message.type) {
            case "ready": {
                this.#sendGreeting();
                // Each as soon as it is listed: neither waits on the other.
                await Promise.all([this.#send(), this.#sendDeployments()]);
                break;
            }

            case "open": {
                if (message.editor === "notebook") {
                    await this.host.openNotebook(message.connection);
                } else {
                    await this.host.openSqlEditor(message.connection);
                }
                break;
            }

            case "newConnection": {
                this.host.newConnection(message.folder);
                break;
            }

            case "connectionAction": {
                await this.host.connectionAction(message.action,
                    message.connection);
                break;
            }

            case "newDeployment": {
                this.host.newDeployment();
                break;
            }

            case "deploymentCommand": {
                await this.host.deploymentCommand(message.command,
                    message.port, message.directory);
                break;
            }

            case "closeGreeting": {
                await this.host.closeGreeting();
                break;
            }

            default: {
                break;
            }
        }
    }
}
