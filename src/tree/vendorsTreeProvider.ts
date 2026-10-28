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

/** The id the Deployment Vendors view is contributed under. */
export const VENDORS_VIEW_ID = "mariadb.deploymentVendors";

/**
 * The scheme of a vendor row's resource URI, which is what lets its label
 * be drawn grayed out: a tree item has no disabled state, but a file
 * decoration can color its label.
 */
export const VENDOR_SCHEME = "mariadb-vendor";

/**
 * A row of the Deployment Vendors view: where deployments can be made.
 * None can be configured yet, so every one is drawn as not configured.
 */
export interface IVendorNode {
    /** Names it in the row's id and resource URI. */
    id: string;
    label: string;
    /** The codicon it is drawn with. */
    icon: string;
}

/** The vendors, in the order the view lists them. */
export const VENDORS: IVendorNode[] = [
    { id: "container", label: "Local Container", icon: "package" },
    { id: "proxmox", label: "Proxmox", icon: "server-environment" },
    { id: "mariadb-cloud", label: "MariaDB Cloud", icon: "cloud" },
    { id: "aws", label: "AWS", icon: "cloud" },
    { id: "hetzner", label: "Hetzner", icon: "cloud" },
    { id: "scaleway", label: "Scaleway", icon: "cloud" },
    { id: "stackit", label: "STACKIT", icon: "cloud" },
    { id: "upcloud", label: "UpCloud", icon: "cloud" },
];

/** The color a vendor that is not configured is drawn in. */
const UNCONFIGURED_COLOR = "disabledForeground";

/**
 * The item drawn for one vendor, grayed out as not configured: its icon
 * in the disabled color, and its label through its resource URI, which
 * `VendorDecorations` colors.
 */
export class VendorTreeItem extends vscode.TreeItem {
    public constructor(public readonly node: IVendorNode) {
        super(node.label, vscode.TreeItemCollapsibleState.None);

        this.id = `vendor:${node.id}`;
        this.iconPath = new vscode.ThemeIcon(node.icon,
            new vscode.ThemeColor(UNCONFIGURED_COLOR));
        this.resourceUri = vscode.Uri.from({
            scheme: VENDOR_SCHEME,
            path: `/${node.id}`,
        });
        this.description = "not configured";
        this.tooltip = `${node.label}: not configured yet`;
    }
}

/** Grays out the label of a vendor that is not configured. */
export class VendorDecorations implements vscode.FileDecorationProvider {
    /**
     * @param uri A row's resource URI.
     *
     * @returns The disabled color for a vendor's row, otherwise nothing.
     */
    public provideFileDecoration(
        uri: vscode.Uri,
    ): vscode.FileDecoration | undefined {
        return uri.scheme === VENDOR_SCHEME
            ? new vscode.FileDecoration(undefined, undefined,
                new vscode.ThemeColor(UNCONFIGURED_COLOR))
            : undefined;
    }
}

/**
 * Feeds the Deployment Vendors view: the places a deployment can be made,
 * none of them configured yet. A fixed list, so there is nothing to ask
 * the server and nothing to refresh.
 */
export class VendorsTreeProvider
    implements vscode.TreeDataProvider<IVendorNode> {

    public getTreeItem(node: IVendorNode): vscode.TreeItem {
        return new VendorTreeItem(node);
    }

    /**
     * @param node Undefined for the root; a vendor has no children.
     *
     * @returns The vendors.
     */
    public getChildren(node?: IVendorNode): IVendorNode[] {
        return node === undefined ? VENDORS : [];
    }
}
