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
    withDefaultScheme,
} from "../connections/connectionUri.js";
import type { ConnectionColor } from "../mcp/types.js";
import { errorText } from "../text.js";
import { connectionIconFor } from "../tree/treeItems.js";
import { DialogPanel } from "../webview/dialogPanel.js";
import { buildWebviewHtml } from "../webview/html.js";
import type { IOverviewSnapshot } from "./overviewModel.js";
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
    /** Whether the welcome text is shown. */
    showGreeting(): boolean;
    /** Keeps the welcome text closed from now on. */
    closeGreeting(): Promise<void>;
    /** Opens a new SQL editor on the connection. */
    openSqlEditor(connection: IOverviewConnectionRef): Promise<void>;
    /** Opens the connection editor for a new one, filed in the folder. */
    newConnection(folder: string): void;
    /** Does what a tile's More Actions menu asked for. */
    connectionAction(
        action: OverviewConnectionAction,
        connection: IOverviewConnectionRef,
    ): Promise<void>;
    log(message: string): void;
}

/** The view type the panel is registered under. */
export const OVERVIEW_VIEW_TYPE = "mariadb.overview";

/** The tab's title. */
const TITLE = "MariaDB Overview";

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
    // The setting may predate URIs carrying their scheme; both sides go
    // through the same fill-in, as the Connections view's rows do.
    const defaultUri = defaultConnection === undefined
        ? undefined
        : withDefaultScheme(defaultConnection);

    return {
        connections: stored.map((connection) => {
            const isDefault =
                withDefaultScheme(connection.uri) === defaultUri;

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
 * The MariaDB Workbench overview: a welcome text and a tile per
 * connection and folder, in an editor tab. A click on a connection's tile
 * opens a SQL editor on it; one on a folder's goes into it.
 *
 * One at a time: asking again reveals the one that is up.
 */
export class OverviewPanel
    extends DialogPanel<OverviewHostMessage, OverviewWebviewMessage> {
    static #current: OverviewPanel | undefined;

    readonly #listening: vscode.Disposable;
    /** The listing being sent; a newer one makes it stale. */
    #sending = 0;

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
        this.#listening = host.onDidChange(() => { void this.#send(); });
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
        this.#listening.dispose();
        OverviewPanel.#current = undefined;
    }

    /**
     * Lists the connections and sends them, unless a newer listing has
     * started meanwhile.
     *
     * @returns Nothing.
     */
    async #send(): Promise<void> {
        const sending = ++this.#sending;
        try {
            const snapshot = await this.host.list();
            if (sending === this.#sending) {
                this.post({
                    type: "connections",
                    ...snapshot,
                    showGreeting: this.host.showGreeting(),
                });
            }
        } catch (error) {
            this.host.log(`The overview could not list the connections: ${
                errorText(error)}`);
            if (sending === this.#sending) {
                this.post({ type: "failed", message: errorText(error) });
            }
        }
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
                this.post({
                    type: "greeting",
                    showGreeting: this.host.showGreeting(),
                });
                await this.#send();
                break;
            }

            case "open": {
                // The page shows the notebook's button disabled; refused
                // again here, as every dialog's host does.
                if (message.editor !== "script") {
                    this.host.log("DB Notebooks are not available yet.");
                    break;
                }
                await this.host.openSqlEditor(message.connection);
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
