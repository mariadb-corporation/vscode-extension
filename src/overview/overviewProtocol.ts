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

import type { IReadyMessage } from "../webview/dialogProtocol.js";
import type { ConnectionKind } from "../mcp/types.js";
import type { IOverviewSnapshot } from "./overviewModel.js";

/**
 * What the MariaDB Workbench overview and its host say to each other.
 * The page walks the folders on its own; the host sends what there is to
 * show, and hears what was clicked.
 */

/** Everything to show, sent on `ready` and whenever it changes. */
export interface IOverviewConnectionsMessage extends IOverviewSnapshot {
    type: "connections";
    /** Whether the welcome text is shown above the tiles. */
    showGreeting: boolean;
}

/** The connections could not be listed. */
export interface IOverviewFailedMessage {
    type: "failed";
    message: string;
}

export type OverviewHostMessage =
    | IOverviewConnectionsMessage
    | IOverviewFailedMessage;

/** One connection: the two halves of what identifies it. */
export interface IOverviewConnectionRef {
    uri: string;
    kind: ConnectionKind;
}

/**
 * Open a connection. `script` is a SQL editor; `notebook` is to come,
 * and refused until it does.
 */
export interface IOverviewOpenMessage {
    type: "open";
    connection: IOverviewConnectionRef;
    editor: "script" | "notebook";
}

/** Add a connection, filed in the folder the page shows. */
export interface IOverviewNewConnectionMessage {
    type: "newConnection";
    folder: string;
}

/** What a connection tile's More Actions menu offers. */
export type OverviewConnectionAction = "edit" | "copyUri" | "delete";

/** Act on one connection, from its tile's menu. */
export interface IOverviewConnectionActionMessage {
    type: "connectionAction";
    action: OverviewConnectionAction;
    connection: IOverviewConnectionRef;
}

/** The welcome text was closed: keep it closed. */
export interface IOverviewCloseGreetingMessage {
    type: "closeGreeting";
}

export type OverviewWebviewMessage =
    | IReadyMessage
    | IOverviewOpenMessage
    | IOverviewNewConnectionMessage
    | IOverviewConnectionActionMessage
    | IOverviewCloseGreetingMessage;
