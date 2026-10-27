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

import type { IServerStatus } from "../mcp/serverStarter.js";
import { errorText } from "../text.js";
import { RestdTreeItem, type IRestdNode } from "./restdTreeProvider.js";
import { SandboxTreeItem, type ISandboxNode } from "./sandboxesTreeProvider.js";
import { ViewStateTracker, type ViewState } from "./viewState.js";

/** The id the Deployments view is contributed under. */
export const DEPLOYMENTS_VIEW_ID = "mariadb.deployments";

/**
 * The context key the Deployments view's welcome content switches on, as
 * the Sandboxes view's does.
 */
export const DEPLOYMENTS_VIEW_STATE_CONTEXT_KEY = "mariadb.deploymentsView";

/** A folder of the Deployments view: one kind of deployment. */
export interface IDeploymentFolderNode {
    kind: "deploymentFolder";
    /** What it is captioned. */
    label: string;
    /** What is in it, as listed for the redraw that drew it. */
    children: IDeploymentSandboxNode[];
}

/**
 * A sandbox in the Deployments view: a Sandboxes view row, so the same
 * Start / Stop / Delete commands take it, with its REST Daemons under it.
 */
export interface IDeploymentSandboxNode extends ISandboxNode {
    daemons: IRestdNode[];
}

/** A row of the Deployments view. */
export type DeploymentNode =
    | IDeploymentFolderNode
    | IDeploymentSandboxNode
    | IRestdNode;

/** Where the rows come from: the views that already list them. */
export interface IDeploymentSources {
    /** The sandboxes, as the Sandboxes view shows them. */
    sandboxes: {
        nodes(): Promise<ISandboxNode[]>;
        onDidChangeTreeData: vscode.Event<unknown>;
    };
    /** The REST Daemons, as the REST Daemons view shows them. */
    daemons: {
        nodes(): Promise<IRestdNode[]>;
        onDidChangeTreeData: vscode.Event<unknown>;
    };
}

/**
 * Feeds the Deployments view: every MariaDB deployment the user manages,
 * grouped by kind. Sandboxes are the one kind so far, each with the REST
 * Daemons that serve it under it.
 *
 * It lists nothing of its own: the Sandboxes and REST Daemons views keep
 * their lists and know what is being done to each row, so this draws from
 * them and redraws whenever either does - a start, a stop or a deploy
 * shows here as it does there.
 */
export class DeploymentsTreeProvider
    implements vscode.TreeDataProvider<DeploymentNode>, vscode.Disposable {

    readonly #onDidChangeTreeData =
        new vscode.EventEmitter<DeploymentNode | undefined>();
    readonly #viewState: ViewStateTracker;
    readonly #subscriptions: vscode.Disposable[];

    public readonly onDidChangeTreeData = this.#onDidChangeTreeData.event;

    /**
     * @param sources Where the rows come from.
     * @param log Where to write a failure.
     * @param status How the server's startup is going.
     */
    public constructor(
        private readonly sources: IDeploymentSources,
        private readonly log: (message: string) => void,
        status?: IServerStatus,
    ) {
        this.#viewState =
            new ViewStateTracker(DEPLOYMENTS_VIEW_STATE_CONTEXT_KEY, status);
        this.#subscriptions = [
            sources.sandboxes.onDidChangeTreeData(() => { this.refresh(); }),
            sources.daemons.onDidChangeTreeData(() => { this.refresh(); }),
        ];
    }

    /**
     * Redraws the view from what the other views keep.
     *
     * @returns Nothing.
     */
    public refresh(): void {
        this.#onDidChangeTreeData.fire(undefined);
    }

    /**
     * @param node The node to show.
     *
     * @returns The item VS Code should draw for it.
     */
    public getTreeItem(node: DeploymentNode): vscode.TreeItem {
        switch (node.kind) {
            case "deploymentFolder": {
                const item = new vscode.TreeItem(node.label,
                    vscode.TreeItemCollapsibleState.Expanded);
                item.id = `deployments:${node.label}`;
                item.iconPath = new vscode.ThemeIcon("folder");
                item.contextValue = "mariadbDeploymentFolder";

                return item;
            }

            case "sandbox": {
                if (node.daemons.length === 0) {
                    return new SandboxTreeItem(node);
                }

                const item = new SandboxTreeItem(node,
                    vscode.TreeItemCollapsibleState.Expanded);
                // VS Code keeps a row's state by its id and ignores the one
                // given for a row it has drawn: a sandbox drawn with no
                // daemon while it deployed would stay closed once its
                // daemon came. A row of its own, from the first daemon on,
                // opens; one the user closes stays closed after that.
                item.id = `${item.id!}:restd`;

                return item;
            }

            default: {
                return new RestdTreeItem(node);
            }
        }
    }

    /**
     * @param node Undefined for the root.
     *
     * @returns The folders at the root, a folder's deployments, or a
     *          sandbox's REST Daemons.
     */
    public async getChildren(node?: DeploymentNode): Promise<DeploymentNode[]> {
        switch (node?.kind) {
            case undefined: {
                return await this.#folders();
            }

            case "deploymentFolder": {
                return node.children;
            }

            case "sandbox": {
                return node.daemons;
            }

            default: {
                return [];
            }
        }
    }

    /**
     * @returns The folders that have something in them: none, while
     *          nothing is deployed, which is what the welcome content is
     *          for.
     */
    async #folders(): Promise<IDeploymentFolderNode[]> {
        let sandboxes: ISandboxNode[];
        try {
            sandboxes = await this.sources.sandboxes.nodes();
            this.#viewState.listed();
        } catch (error) {
            // Logged, not notified, as in the Sandboxes view.
            this.log(`Failed to list the deployments: ${errorText(error)}`);
            this.#viewState.failed();

            return [];
        }

        if (sandboxes.length === 0) {
            return [];
        }

        const daemons = await this.#daemons();

        return [{
            kind: "deploymentFolder",
            label: "Sandboxes",
            children: sandboxes.map((sandbox): IDeploymentSandboxNode => {
                return {
                    ...sandbox,
                    daemons: daemons.filter((daemon) => {
                        return daemon.sandbox_port === sandbox.port;
                    }),
                };
            }),
        }];
    }

    /**
     * @returns The REST Daemons, or none where they cannot be listed: the
     *          sandboxes are still worth showing without them.
     */
    async #daemons(): Promise<IRestdNode[]> {
        try {
            return await this.sources.daemons.nodes();
        } catch (error) {
            this.log(`Failed to list the REST Daemons: ${errorText(error)}`);

            return [];
        }
    }

    /** @returns What the view should say while it has no rows. */
    public get state(): ViewState {
        return this.#viewState.state;
    }

    /**
     * Stops listening to the other views and the server's startup.
     *
     * @returns Nothing.
     */
    public dispose(): void {
        for (const subscription of this.#subscriptions) {
            subscription.dispose();
        }
        this.#viewState.dispose();
        this.#onDidChangeTreeData.dispose();
    }
}
