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

import { connectionLabel, schemeOf } from "../connections/connectionUri.js";
import type { ConnectionColor } from "../mcp/types.js";
import { colorUriOf } from "./connectionColors.js";
import { isMrsNode } from "./mrsModel.js";
import { MrsTreeItem } from "./mrsTreeItems.js";
import {
    type ConnectionsNode,
    type IConnectionNode,
    type IConnectionStatusNode,
    type IFolderNode,
} from "./connectionsModel.js";

import {
    DiagramsTreeItem,
    DiagramTreeItem,
    ObjectGroupTreeItem,
    ObjectTreeItem,
    SchemaTreeItem,
    type IconResolver,
} from "./schemaTree.js";

export { createIconResolver, type IconResolver } from "./schemaTree.js";

/**
 * The icon shown for a connection, by the scheme of its URI, without its
 * extension. `mysqlx` has no picture of its own; it is MySQL's protocol,
 * so it borrows MySQL's.
 */
const CONNECTION_ICONS: Record<string, string> = {
    "mariadb": "connectionMariaDB",
    "mariadb+ssh": "connectionMariaDBSSH",
    "mysql": "connectionMySQL",
    "mysql+ssh": "connectionMySQLSSH",
    "mysqlx": "connectionMySQL",
};

/**
 * @param uri The connection's URI.
 * @param isDefault Whether it is the default connection.
 *
 * @returns Its icon file: the one for its scheme, in the variant marked
 *          as the default where it is.
 */
export const connectionIconFor = (uri: string, isDefault: boolean): string => {
    const base = CONNECTION_ICONS[schemeOf(uri)] ?? "connectionMariaDB";

    return `${base}${isDefault ? "Default" : ""}.svg`;
};

/**
 * The base of every item in the Connections tree, holding the node it
 * stands for and the icon lookup they all share.
 */
export class ConnectionBaseTreeItem<T extends ConnectionsNode>
    extends vscode.TreeItem {

    public constructor(
        public readonly node: T,
        label: string,
        icon: string | vscode.ThemeIcon,
        hasChildren: boolean,
        resolveIcon: IconResolver,
    ) {
        super(
            label,
            hasChildren
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None,
        );

        this.iconPath = typeof icon === "string" ? resolveIcon(icon) : icon;
    }
}

/**
 * A folder of connections.
 *
 * Drawn open by default: folders came to an existing tree - a sandbox now
 * files its connection in `/Sandboxes` - and a connection that used to be in
 * sight must not vanish into a closed folder.
 *
 * The icon follows the state, `folder-opened` or `folder`. VS Code does not
 * swap it by itself, so the tree provider tracks which folders the user
 * collapsed and redraws a folder when that changes.
 */
export class FolderTreeItem extends vscode.TreeItem {
    /**
     * @param node The folder.
     * @param open Whether it is expanded.
     * @param color The color the user gave it, if any.
     * @param view What the view's folder rows are told apart by: the
     *             prefix of their ids and their context value. The MSM
     *             Projects view's folders have menus of their own.
     */
    public constructor(
        public readonly node: IFolderNode,
        open = true,
        color?: ConnectionColor,
        view: { id: string; contextValue: string } =
        { id: "folder", contextValue: "mariadbFolder" },
    ) {
        super(node.name, open
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed);

        // `.empty` is what offers Remove Folder; the menus match the rest
        // with a prefix, so both forms get New Connection and New Folder.
        this.contextValue = node.empty
            ? `${view.contextValue}.empty` : view.contextValue;
        // Folder paths are unique, so VS Code can tell folders apart by it
        // across refreshes rather than by label and position. Connection
        // rows get none: two of them can read the same.
        this.id = `${view.id}:${node.path}`;
        this.iconPath = new vscode.ThemeIcon(open ? "folder-opened" : "folder");
        this.tooltip = node.path;
        // Drawn by `ConnectionColorDecorations`, as a connection's color is.
        if (color !== undefined) {
            this.resourceUri = colorUriOf(color, "folder", node.path);
        }
    }
}

/**
 * A configured connection.
 *
 * Its context value carries both whether it is open and whether it is the
 * default, because that is what the context menu switches its entries on.
 * Which LIST the connection is in is deliberately not in there: the commands
 * that need it - edit and delete - are handed the node itself, and adding a
 * fourth segment would break the `when` clauses that anchor on the third
 * (`/notDefault$/` and `/\.default$/`).
 */
export class ConnectionTreeItem
    extends ConnectionBaseTreeItem<IConnectionNode> {

    public constructor(node: IConnectionNode, resolveIcon: IconResolver) {
        // The label leaves out what the icon and the tooltip already say -
        // the scheme and the options - so the row stays short. A caption
        // replaces it, and it moves into the description instead.
        const address = connectionLabel(node.uri);
        super(node, node.caption ?? address,
            connectionIconFor(node.uri, node.isDefault),
            node.expandable, resolveIcon);

        // The color is drawn by `ConnectionColorDecorations`, which a row
        // reaches through its resource URI.
        if (node.color !== undefined) {
            this.resourceUri = colorUriOf(
                node.color, node.connectionKind, node.uri);
        }

        this.contextValue = [
            "mariadbConnection",
            node.connected ? "connected" : "disconnected",
            node.isDefault ? "default" : "notDefault",
        ].join(".");

        // "MCP" marks a connection in the shared list, which every MCP client
        // on this machine can open - not just this extension. That is worth
        // seeing at a glance, since it is the difference the checkbox makes.
        const marks: string[] = [];
        if (node.connectionKind === "mcp") {
            marks.push("MCP");
        }
        if (node.isDefault) {
            marks.push("default");
        }

        const description = [
            ...(node.caption === undefined ? [] : [address]),
            ...(marks.length > 0 ? [marks.join(", ")] : []),
        ].join(" · ");
        this.description = description === "" ? undefined : description;

        const notes: string[] = [];
        if (node.connectionKind === "mcp") {
            notes.push("MCP access allowed");
        }
        if (node.isDefault) {
            notes.push("default connection");
        }
        const where = notes.length > 0
            ? `${node.uri} (${notes.join(", ")})`
            : node.uri;
        this.tooltip = node.caption === undefined
            ? where
            : `${node.caption}\n${where}`;
    }
}

/**
 * The row under a connection that is being opened, or failed to open.
 *
 * Connecting shows the spinning codicon VS Code's own views use, so an
 * expand that takes a while visibly does something. A failure shows the
 * reason's first line with the error icon - the whole of it is in the
 * tooltip - and its context value puts a Retry button beside it.
 */
export class ConnectionStatusTreeItem
    extends vscode.TreeItem {

    public constructor(public readonly node: IConnectionStatusNode) {
        const failed = node.state === "failed";
        const message = node.message ?? "The connection could not be opened.";
        super(
            failed ? message.split("\n")[0]!.trim() : "Connecting...",
            vscode.TreeItemCollapsibleState.None,
        );

        this.iconPath = failed
            ? new vscode.ThemeIcon("error",
                new vscode.ThemeColor("errorForeground"))
            : new vscode.ThemeIcon("loading~spin");
        this.contextValue = failed
            ? "mariadbConnectionStatus.failed"
            : "mariadbConnectionStatus.connecting";
        this.tooltip = failed ? message : `Opening ${node.uri}`;
    }
}

/** The command a click on a diagram runs: two quick ones open it. */
export const DIAGRAM_CLICK_COMMAND = "mariadb.diagramClicked";

/**
 * Builds the tree item for a node.
 *
 * @param node The node to show.
 * @param resolveIcon The icon lookup to use.
 *
 * @returns The item to put into the tree.
 */
export const createTreeItem = (
    node: ConnectionsNode,
    resolveIcon: IconResolver,
): vscode.TreeItem => {
    if (isMrsNode(node)) {
        return new MrsTreeItem(node, resolveIcon);
    }

    switch (node.kind) {
        case "folder": {
            return new FolderTreeItem(node);
        }

        case "connection": {
            return new ConnectionTreeItem(node, resolveIcon);
        }

        case "connectionStatus": {
            return new ConnectionStatusTreeItem(node);
        }

        case "schema": {
            return new SchemaTreeItem(node, resolveIcon);
        }

        case "diagrams": {
            return new DiagramsTreeItem(node, resolveIcon, "mariadb",
                `The diagrams of ${node.schema}, from its `
                + "msm_schema_diagrams view");
        }

        case "diagram": {
            return new DiagramTreeItem(node, resolveIcon, "mariadb",
                DIAGRAM_CLICK_COMMAND);
        }

        case "objectGroup": {
            return new ObjectGroupTreeItem(node, resolveIcon);
        }

        default: {
            return new ObjectTreeItem(node, resolveIcon);
        }
    }
};
