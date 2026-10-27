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

import { beforeEach, describe, expect, it } from "vitest";

import {
    DeploymentsTreeProvider,
    DEPLOYMENTS_VIEW_STATE_CONTEXT_KEY,
    type IDeploymentFolderNode,
    type IDeploymentSandboxNode,
} from "../../tree/deploymentsTreeProvider.js";
import type { IRestdNode } from "../../tree/restdTreeProvider.js";
import type { ISandboxNode } from "../../tree/sandboxesTreeProvider.js";
import {
    contextKeys,
    EventEmitter,
    resetVscodeMock,
    TreeItemCollapsibleState,
} from "../mocks/vscode.js";

const running: ISandboxNode = {
    kind: "sandbox", port: 3310, version: "12.3.2", status: "running",
};
const stopped: ISandboxNode = {
    kind: "sandbox", port: 3320, version: "11.8.9", status: "stopped",
};
const daemon: IRestdNode = {
    kind: "restd",
    directory: "/sandboxes/3310/restd",
    port: 8443,
    url: "https://localhost:8443",
    status: "running",
    metadata_schema: "mysql_rest_service_metadata",
    log_path: "/sandboxes/3310/restd/log/mariadb-restd.log",
    host: "127.0.0.1",
    server_port: 3310,
    socket: null,
    sandbox_port: 3310,
} as unknown as IRestdNode;

/** A source of rows, as the Sandboxes and REST Daemons views are. */
interface IFakeSource<T> {
    rows: T[];
    /** Makes the listing reject. */
    failing: boolean;
    emitter: EventEmitter<unknown>;
    nodes(): Promise<T[]>;
    onDidChangeTreeData: EventEmitter<unknown>["event"];
}

const createSource = <T,>(rows: T[]): IFakeSource<T> => {
    const emitter = new EventEmitter<unknown>();
    const source: IFakeSource<T> = {
        rows,
        failing: false,
        emitter,
        nodes: () => {
            return source.failing
                ? Promise.reject(new Error("Unknown tool"))
                : Promise.resolve(source.rows);
        },
        onDidChangeTreeData: emitter.event,
    };

    return source;
};

describe("DeploymentsTreeProvider", () => {
    let logs: string[];

    beforeEach(() => {
        resetVscodeMock();
        logs = [];
    });

    const create = (
        sandboxes: IFakeSource<ISandboxNode>,
        daemons: IFakeSource<IRestdNode>,
    ): DeploymentsTreeProvider => {
        return new DeploymentsTreeProvider(
            { sandboxes, daemons } as never,
            (message) => { logs.push(message); },
        );
    };

    it("puts the sandboxes in a folder, each with its REST Daemons",
        async () => {
            const provider = create(createSource([running, stopped]),
                createSource([daemon]));

            const folders = await provider.getChildren();
            expect(folders).toHaveLength(1);
            const folder = folders[0] as IDeploymentFolderNode;
            const folderItem = provider.getTreeItem(folder);
            expect(folderItem.label).toBe("Sandboxes");
            expect(folderItem.collapsibleState)
                .toBe(TreeItemCollapsibleState.Expanded);

            const sandboxes = (await provider.getChildren(folder)) as
                IDeploymentSandboxNode[];
            expect(sandboxes).toEqual([
                { ...running, daemons: [daemon] },
                { ...stopped, daemons: [] },
            ]);
            // The Sandboxes view's commands take these rows as they are.
            expect(provider.getTreeItem(sandboxes[0]!).contextValue)
                .toBe("mariadbSandbox.running");
            expect(provider.getTreeItem(sandboxes[0]!).collapsibleState)
                .toBe(TreeItemCollapsibleState.Expanded);
            expect(provider.getTreeItem(sandboxes[1]!).collapsibleState)
                .toBe(TreeItemCollapsibleState.None);
            // A sandbox that gets a daemon is a new row to VS Code, which
            // then opens it rather than keeping the childless one's state.
            expect(provider.getTreeItem(sandboxes[0]!).id)
                .toBe("sandbox:3310:restd");
            expect(provider.getTreeItem(sandboxes[1]!).id)
                .toBe("sandbox:3320");

            const daemons = await provider.getChildren(sandboxes[0]);
            expect(daemons).toEqual([daemon]);
            expect(provider.getTreeItem(daemon).contextValue)
                .toBe("mariadbRestd.running");
            expect(await provider.getChildren(daemon)).toEqual([]);
        });

    it("shows no folder while nothing is deployed", async () => {
        const provider = create(createSource([]), createSource([daemon]));

        expect(await provider.getChildren()).toEqual([]);
        expect(contextKeys.get(DEPLOYMENTS_VIEW_STATE_CONTEXT_KEY))
            .toBe("listed");
    });

    it("redraws whenever the views it draws from do", () => {
        const sandboxes = createSource([running]);
        const daemons = createSource([daemon]);
        const provider = create(sandboxes, daemons);
        let redraws = 0;
        provider.onDidChangeTreeData(() => { redraws += 1; });

        sandboxes.emitter.fire(undefined);
        daemons.emitter.fire(undefined);

        expect(redraws).toBe(2);
        provider.dispose();
        sandboxes.emitter.fire(undefined);
        expect(redraws).toBe(2);
    });

    it("shows the sandboxes without daemons where those cannot be listed",
        async () => {
            const daemons = createSource([daemon]);
            daemons.failing = true;
            const provider = create(createSource([running]), daemons);

            const [folder] = await provider.getChildren();

            expect(await provider.getChildren(folder))
                .toEqual([{ ...running, daemons: [] }]);
            expect(logs).toEqual(
                ["Failed to list the REST Daemons: Unknown tool"]);
        });

    it("says the listing failed, logging why", async () => {
        const sandboxes = createSource([running]);
        sandboxes.failing = true;
        const provider = create(sandboxes, createSource([]));

        expect(await provider.getChildren()).toEqual([]);

        expect(provider.state).toBe("failed");
        expect(contextKeys.get(DEPLOYMENTS_VIEW_STATE_CONTEXT_KEY))
            .toBe("failed");
        expect(logs).toEqual(
            ["Failed to list the deployments: Unknown tool"]);
    });
});
