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

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { parentFolder } from "../../connections/connectionFolders.js";
import {
    existingFolder,
    folderContents,
    folderTrail,
    startingFolder,
    type IOverviewSnapshot,
} from "../../overview/overviewModel.js";
import {
    OVERVIEW_VIEW_TYPE,
    OverviewPanel,
    overviewDeployments,
    overviewSnapshot,
    type IOverviewHost,
} from "../../overview/overviewPanel.js";
import type {
    IOverviewConnectionRef,
    OverviewWebviewMessage,
} from "../../overview/overviewProtocol.js";
import { connectionIconFor } from "../../tree/treeItems.js";
import {
    EventEmitter,
    resetVscodeMock,
    Uri,
    webviewPanels,
    type MockWebviewPanel,
} from "../mocks/vscode.js";

const extensionUri = Uri.file("/ext");

const currentPanel = (): MockWebviewPanel => {
    return webviewPanels[webviewPanels.length - 1]!;
};

const settle = async (): Promise<void> => {
    await new Promise((resolve) => { setTimeout(resolve, 0); });
};

const receive = async (message: OverviewWebviewMessage): Promise<void> => {
    currentPanel().webview.receive(message);
    await settle();
};

const SNAPSHOT: IOverviewSnapshot = overviewSnapshot([
    { uri: "mariadb://root@localhost:3306", kind: "gui" },
    {
        uri: "mariadb://app@db:3307/shop?ssl-mode=REQUIRED",
        kind: "mcp",
        path: "/Production",
        caption: "Shop",
        color: "red",
    },
    { uri: "mysql://me@old:3306", kind: "gui", path: "/Production/Legacy" },
    { uri: "mariadb+ssh://root@db:3306?ssh=jump@gw", kind: "gui",
        path: "/Production" },
    { uri: "mysql+ssh://me@old:3307?ssh=jump@gw", kind: "gui",
        path: "/Production/Legacy" },
    { uri: "mariadb://root@localhost:3310", kind: "gui", path: "Sandboxes" },
], ["/Empty"], "root@localhost:3306", { "/Production": "blue" });

/** The titles the view's menus show, as the manifest has them. */
const TITLES: Record<string, string> = {
    "mariadb.startSandbox": "Start Sandbox",
    "mariadb.stopSandbox": "Stop Sandbox",
    "mariadb.deleteSandbox": "Delete Sandbox",
    "mariadb.restd.stop": "Stop REST Daemon",
    "mariadb.restd.openInBrowser": "Open in Browser",
    "mariadb.restd.openLog": "Open REST Daemon Log",
    "mariadb.restd.delete": "Delete REST Daemon",
};

const daemon = (port: number, extra: object = {}): never => {
    return {
        kind: "restd", directory: `/restd/${String(port)}`, port,
        status: "running", sandbox_port: 3310, ...extra,
    } as never;
};

const DEPLOYMENTS = overviewDeployments([{
    kind: "deploymentFolder",
    label: "Sandboxes",
    children: [
        {
            kind: "sandbox", port: 3310, version: "13.1.1", status: "running",
            daemons: [daemon(8443)],
        },
        {
            kind: "sandbox", port: 3311, version: null, status: "stopped",
            action: "starting", daemons: [],
        },
    ],
}], (command) => { return TITLES[command] ?? command; });

describe("overviewDeployments", () => {
    it("says what each sandbox's row says, with its icon and menu", () => {
        expect(DEPLOYMENTS).toEqual([
            {
                port: 3310,
                path: "/Sandboxes",
                description: "13.1.1 · running · REST Daemon running",
                icon: "vm-running",
                iconColor: "testing.iconPassed",
                menu: [
                    [
                        { command: "mariadb.stopSandbox",
                            title: "Stop Sandbox" },
                        { command: "mariadb.deleteSandbox",
                            title: "Delete Sandbox" },
                    ],
                    [
                        "mariadb.restd.stop", "mariadb.restd.openInBrowser",
                        "mariadb.restd.openLog", "mariadb.restd.delete",
                    ].map((command) => {
                        return { command, title: TITLES[command],
                            directory: "/restd/8443" };
                    }),
                ],
            },
            {
                port: 3311,
                path: "/Sandboxes",
                description: "unknown version · starting…",
                icon: "loading~spin",
                // Nothing while something is done to it.
                menu: [[]],
            },
        ]);
    });

    it("names each daemon by its port where there are several", () => {
        const [sandbox] = overviewDeployments([{
            kind: "deploymentFolder",
            label: "Sandboxes",
            children: [{
                kind: "sandbox", port: 3310, version: "13.1.1",
                status: "stopped",
                daemons: [daemon(8443, { action: "stopping" }),
                    daemon(8444, { status: "stopped" })],
            }],
        }], (command) => { return TITLES[command] ?? command; });

        expect(sandbox!.description)
            .toBe("13.1.1 · stopped · 2 REST Daemons");
        expect(sandbox!.icon).toBe("vm-outline");
        // A busy daemon keeps its log; a stopped one starts.
        expect(sandbox!.menu.map((group) => {
            return group.map((entry) => { return entry.title; });
        })).toEqual([
            ["Start Sandbox", "Delete Sandbox"],
            ["Open REST Daemon Log (port 8443)"],
            ["mariadb.restd.start (port 8444)",
                "Open REST Daemon Log (port 8444)",
                "Delete REST Daemon (port 8444)"],
        ]);
    });

    it("walks the deployment folders as the connections'", () => {
        expect(folderContents(DEPLOYMENTS, "/")).toEqual({
            folders: [{ path: "/Sandboxes", name: "Sandboxes" }],
            items: [],
        });
        expect(folderContents(DEPLOYMENTS, "/Sandboxes").items
            .map((deployment) => { return deployment.port; }))
            .toEqual([3310, 3311]);
        expect(existingFolder([], "/Sandboxes")).toBe("/");
    });
});

describe("overviewSnapshot", () => {
    it("shows each connection by its address, picture and folder", () => {
        expect(SNAPSHOT.connections.map((connection) => {
            return [connection.address, connection.icon, connection.path,
                connection.isDefault];
        })).toEqual([
            // The Connections view's icons, the default's marked.
            ["root@localhost:3306", "connectionMariaDBDefault", "/", true],
            ["app@db:3307/shop", "connectionMariaDB", "/Production", false],
            ["me@old:3306", "connectionMySQL", "/Production/Legacy", false],
            ["root@db:3306", "connectionMariaDBSSH", "/Production", false],
            ["me@old:3307", "connectionMySQLSSH", "/Production/Legacy",
                false],
            ["root@localhost:3310", "connectionMariaDB", "/Sandboxes", false],
        ]);
        expect(SNAPSHOT.connections[1]).toMatchObject(
            { caption: "Shop", color: "red", kind: "mcp" });
        expect(SNAPSHOT.customFolders).toEqual(["/Empty"]);
        expect(SNAPSHOT.folderColors).toEqual({ "/Production": "blue" });
    });
});

describe("the connection icons", () => {
    it("has a picture for every icon the Connections view can show", () => {
        // A tile's icon is a class of the overview's stylesheet, one per
        // file; one missing would leave the tile without a picture.
        const css = readFileSync(
            join(import.meta.dirname, "..", "..", "..", "webview", "src",
                "overviewStyles.css"), "utf8");
        const schemes = ["mariadb", "mariadb+ssh", "mysql", "mysql+ssh",
            "mysqlx", "other"];
        for (const scheme of schemes) {
            for (const isDefault of [false, true]) {
                const icon = connectionIconFor(`${scheme}://u@h:1`, isDefault)
                    .replace(/\.svg$/u, "");
                expect(css).toContain(`.overview-icon-${icon} {`);
                expect(css).toContain(`/images/light/${icon}.svg`);
            }
        }
    });
});

describe("overviewModel", () => {
    it("lists a folder's subfolders first, then its connections", () => {
        const contentsOf = (folder: string) => {
            return folderContents(SNAPSHOT.connections, folder,
                SNAPSHOT.customFolders, SNAPSHOT.folderColors);
        };
        const top = contentsOf("/");

        expect(top.folders).toEqual([
            { path: "/Empty", name: "Empty" },
            { path: "/Production", name: "Production", color: "blue" },
            { path: "/Sandboxes", name: "Sandboxes" },
        ]);
        expect(top.items.map((connection) => { return connection.uri; }))
            .toEqual(["mariadb://root@localhost:3306"]);

        const production = contentsOf("/Production");
        expect(production.folders).toEqual(
            [{ path: "/Production/Legacy", name: "Legacy" }]);
        expect(production.items).toHaveLength(2);
        expect(contentsOf("/Empty")).toEqual({ folders: [], items: [] });
    });

    it("falls back to the nearest folder still there", () => {
        expect(existingFolder(SNAPSHOT.connections, "/Production/Legacy"))
            .toBe("/Production/Legacy");
        expect(existingFolder(SNAPSHOT.connections,
            "/Production/Gone/Deeper")).toBe("/Production");
        // A folder made with New Folder holds the page there, empty.
        expect(existingFolder(SNAPSHOT.connections, "/Empty",
            SNAPSHOT.customFolders)).toBe("/Empty");
        expect(existingFolder(SNAPSHOT.connections, "/Gone")).toBe("/");
    });

    it("starts in the folder of the one item there is", () => {
        expect(startingFolder([{ path: "/Sandboxes" }])).toBe("/Sandboxes");
        expect(startingFolder([])).toBe("/");
        expect(startingFolder(SNAPSHOT.connections)).toBe("/");
    });

    it("walks up, and spells the way down as a trail", () => {
        expect(parentFolder("/Production/Legacy")).toBe("/Production");
        expect(parentFolder("/Production")).toBe("/");
        expect(parentFolder("/")).toBe("/");
        expect(folderTrail("/Production/Legacy")).toEqual([
            { path: "/Production", name: "Production" },
            { path: "/Production/Legacy", name: "Legacy" },
        ]);
        expect(folderTrail("/")).toEqual([]);
    });
});

describe("OverviewPanel", () => {
    let host: IOverviewHost & {
        changed: EventEmitter<void>;
        greetingChanged: EventEmitter<void>;
        deploymentsChanged: EventEmitter<void>;
        greeting: boolean;
        failure?: Error;
        deploymentsFailure?: Error;
        calls: unknown[][];
        logs: string[];
    };

    beforeEach(() => {
        OverviewPanel.disposeCurrent();
        resetVscodeMock();
        const changed = new EventEmitter<void>();
        const greetingChanged = new EventEmitter<void>();
        const deploymentsChanged = new EventEmitter<void>();
        host = {
            changed,
            greetingChanged,
            deploymentsChanged,
            greeting: true,
            calls: [],
            logs: [],
            list: () => {
                return host.failure === undefined
                    ? Promise.resolve(SNAPSHOT)
                    : Promise.reject(host.failure);
            },
            onDidChange: changed.event as never,
            onDidChangeGreeting: greetingChanged.event as never,
            showGreeting: () => { return host.greeting; },
            closeGreeting: () => {
                host.calls.push(["closeGreeting"]);

                return Promise.resolve();
            },
            openSqlEditor: (connection: IOverviewConnectionRef) => {
                host.calls.push(["openSqlEditor", connection]);

                return Promise.resolve();
            },
            openNotebook: (connection: IOverviewConnectionRef) => {
                host.calls.push(["openNotebook", connection]);

                return Promise.resolve();
            },
            newConnection: (folder) => {
                host.calls.push(["newConnection", folder]);
            },
            connectionAction: (action, connection) => {
                host.calls.push(["connectionAction", action, connection]);

                return Promise.resolve();
            },
            listDeployments: () => {
                return host.deploymentsFailure === undefined
                    ? Promise.resolve(DEPLOYMENTS)
                    : Promise.reject(host.deploymentsFailure);
            },
            onDidChangeDeployments: deploymentsChanged.event as never,
            newDeployment: () => { host.calls.push(["newDeployment"]); },
            deploymentCommand: (command, port, directory) => {
                host.calls.push(["deploymentCommand", command, port,
                    directory]);

                return Promise.resolve();
            },
            log: (message) => { host.logs.push(message); },
        };
    });

    it("loads its own bundle, one overview at a time", () => {
        OverviewPanel.show(extensionUri as never, host);
        OverviewPanel.show(extensionUri as never, host);

        expect(webviewPanels).toHaveLength(1);
        expect(currentPanel().viewType).toBe(OVERVIEW_VIEW_TYPE);
        expect(currentPanel().title).toBe("Overview");
        expect(currentPanel().revealed).toBe(1);
        expect(currentPanel().webview.html)
            .toContain("/ext/dist/webview/overview.js");
    });

    it("sends the connections when ready, and again on a change", async () => {
        OverviewPanel.show(extensionUri as never, host);

        await receive({ type: "ready" });
        // The greeting first, which needs no listing; then each listing.
        expect(currentPanel().webview.posted).toEqual([
            { type: "greeting", showGreeting: true },
            { type: "connections", ...SNAPSHOT },
            { type: "deployments", deployments: DEPLOYMENTS },
        ]);

        // Each on its own change, without listing the other.
        host.changed.fire();
        await settle();
        expect(currentPanel().webview.posted.slice(3))
            .toEqual([{ type: "connections", ...SNAPSHOT }]);
        host.deploymentsChanged.fire();
        await settle();
        expect(currentPanel().webview.posted.slice(4))
            .toEqual([{ type: "deployments", deployments: DEPLOYMENTS }]);

        // The greeting on its own, without listing again.
        host.greeting = false;
        host.greetingChanged.fire();
        await settle();
        expect(currentPanel().webview.posted.slice(5))
            .toEqual([{ type: "greeting", showGreeting: false }]);
    });

    it("says why the connections could not be listed", async () => {
        host.failure = new Error("no server");
        OverviewPanel.show(extensionUri as never, host);

        await receive({ type: "ready" });

        expect(currentPanel().webview.posted).toEqual([
            { type: "greeting", showGreeting: true },
            { type: "failed", section: "connections", message: "no server" },
            { type: "deployments", deployments: DEPLOYMENTS },
        ]);
        expect(host.logs).toEqual(
            ["The overview could not list the connections: no server"]);
    });

    it("says why the deployments could not be listed", async () => {
        host.deploymentsFailure = new Error("no sandboxes");
        OverviewPanel.show(extensionUri as never, host);

        await receive({ type: "ready" });

        expect(currentPanel().webview.posted).toContainEqual(
            { type: "failed", section: "deployments",
                message: "no sandboxes" });
        expect(host.logs).toEqual(
            ["The overview could not list the deployments: no sandboxes"]);
    });

    it("stops listening once closed", async () => {
        OverviewPanel.show(extensionUri as never, host);
        OverviewPanel.disposeCurrent();

        host.changed.fire();
        await settle();

        expect(currentPanel().webview.posted).toEqual([]);
    });

    it("hands the tiles' clicks on to the host", async () => {
        OverviewPanel.show(extensionUri as never, host);
        const connection = { uri: "mariadb://root@localhost:3306",
            kind: "gui" } as const;

        await receive({ type: "open", connection, editor: "script" });
        await receive({ type: "newConnection", folder: "/Production" });
        await receive({ type: "connectionAction", action: "edit",
            connection });
        await receive({ type: "closeGreeting" });
        await receive({ type: "newDeployment" });
        await receive({ type: "deploymentCommand",
            command: "mariadb.restd.stop", port: 3310,
            directory: "/restd/8443" });

        expect(host.calls).toEqual([
            ["openSqlEditor", connection],
            ["newConnection", "/Production"],
            ["connectionAction", "edit", connection],
            ["closeGreeting"],
            ["newDeployment"],
            ["deploymentCommand", "mariadb.restd.stop", 3310, "/restd/8443"],
        ]);
    });

    it("opens a notebook on a connection", async () => {
        OverviewPanel.show(extensionUri as never, host);
        const connection = {
            uri: "mariadb://root@localhost:3306",
            kind: "gui" as const,
        };

        await receive({ type: "open", connection, editor: "notebook" });

        expect(host.calls).toEqual([["openNotebook", connection]]);
    });
});
