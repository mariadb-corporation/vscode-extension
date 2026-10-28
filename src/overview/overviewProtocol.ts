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
import type {
    IOverviewDeployment,
    IOverviewSnapshot,
} from "./overviewModel.js";

/**
 * What the MariaDB Workbench overview and its host say to each other.
 * The page walks the folders on its own; the host sends what there is to
 * show, and hears what was clicked.
 */

/** The connections and folders, sent on `ready` and whenever they change. */
export interface IOverviewConnectionsMessage extends IOverviewSnapshot {
    type: "connections";
}

/**
 * Whether the welcome text is shown, sent on `ready` and whenever its
 * setting changes. A message of its own: the connections can wait for the
 * server to start, and the page is not to be blank meanwhile.
 */
export interface IOverviewGreetingMessage {
    type: "greeting";
    showGreeting: boolean;
}

/** A section's listing failed: the connections, or the deployments. */
export interface IOverviewFailedMessage {
    type: "failed";
    section: "connections" | "deployments";
    message: string;
}

/**
 * The deployments, as the Deployments view lists them, sent on `ready`
 * and whenever they change - on their own, since a sandbox's listing has
 * nothing to do with the connections'.
 */
export interface IOverviewDeploymentsMessage {
    type: "deployments";
    deployments: IOverviewDeployment[];
}

export type OverviewHostMessage =
    | IOverviewGreetingMessage
    | IOverviewConnectionsMessage
    | IOverviewFailedMessage
    | IOverviewDeploymentsMessage;

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

/** Open the New Deployment wizard. */
export interface IOverviewNewDeploymentMessage {
    type: "newDeployment";
}

/**
 * Run one of the Deployments view's commands, from a deployment tile's
 * menu, on the row it names: the sandbox, or one of its REST Daemons.
 */
export interface IOverviewDeploymentCommandMessage {
    type: "deploymentCommand";
    command: string;
    /** The sandbox's port. */
    port: number;
    /** The REST Daemon's deployment folder, for a daemon's command. */
    directory?: string;
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
    | IOverviewNewDeploymentMessage
    | IOverviewDeploymentCommandMessage
    | IOverviewCloseGreetingMessage;
