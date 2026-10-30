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

import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { posted } from "./setup.js";

import type {
    IOverviewConnection,
    IOverviewDeployment,
} from "../../src/overview/overviewModel.js";
import type { OverviewHostMessage }
    from "../../src/overview/overviewProtocol.js";
import { closeCopyMenu } from "../src/contextMenu.js";
import { GREETING, OverviewPage } from "../src/OverviewPage.js";
import { saveState } from "../src/vscodeApi.js";

let host: HTMLDivElement;

const LOCAL: IOverviewConnection = {
    uri: "mariadb://root@localhost:3306",
    kind: "gui",
    path: "/",
    address: "root@localhost:3306",
    isDefault: true,
    icon: "connectionMariaDBDefault",
};

const SHOP: IOverviewConnection = {
    uri: "mariadb://app@db:3307/shop",
    kind: "mcp",
    path: "/Production",
    caption: "Shop",
    color: "red",
    address: "app@db:3307/shop",
    isDefault: false,
    icon: "connectionMariaDB",
};

const send = async (message: OverviewHostMessage): Promise<void> => {
    await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data: message }));
        await Promise.resolve();
    });
};

const mount = async (showGreeting = true): Promise<void> => {
    await act(async () => {
        render(<OverviewPage />, host);
        await Promise.resolve();
    });
    await send({ type: "greeting", showGreeting });
    await send({
        type: "connections",
        connections: [LOCAL, SHOP],
        customFolders: ["/Empty"],
        folderColors: { "/Production": "blue" },
    });
};

/** @returns Each tile: its kind and caption. */
const tiles = (): string[] => {
    return [...host.querySelectorAll(".overview-tile")].map((tile) => {
        const kind = [...tile.classList].find((name) => {
            return name.startsWith("overview-tile-");
        })!.replace("overview-tile-", "");

        return `${kind}: ${tile.querySelector(".overview-tile-caption")
            ?.textContent ?? ""}`;
    });
};

const tile = (caption: string): HTMLElement => {
    const found = [...host.querySelectorAll<HTMLElement>(".overview-tile")]
        .find((node) => {
            return node.querySelector(".overview-tile-caption")
                ?.textContent === caption;
        });
    if (!found) {
        throw new Error(`No tile '${caption}'.`);
    }

    return found;
};

const click = async (element: Element): Promise<void> => {
    await act(async () => {
        (element as HTMLElement).click();
        await Promise.resolve();
    });
};

/** @returns The breadcrumb's steps. */
const crumbs = (section = 0): string[] => {
    const breadcrumb = host.querySelectorAll(".overview-breadcrumb")[section];

    return [...breadcrumb?.querySelectorAll(".overview-crumb") ?? []]
        .map((crumb) => { return crumb.textContent ?? ""; });
};

beforeEach(() => {
    posted.length = 0;
    saveState(undefined);
    host = document.createElement("div");
    document.body.append(host);
});

afterEach(() => {
    closeCopyMenu();
    render(null, host);
    host.remove();
});

describe("OverviewPage", () => {
    it("asks for the connections, and says it is looking", async () => {
        await act(async () => {
            render(<OverviewPage />, host);
            await Promise.resolve();
        });

        expect(posted).toEqual([{ type: "ready" }]);
        expect(host.textContent).toContain("Looking for MariaDB connections");
    });

    it("greets and heads the tiles while the connections are looked for",
        async () => {
            await act(async () => {
                render(<OverviewPage />, host);
                await Promise.resolve();
            });

            await send({ type: "greeting", showGreeting: true });

            const order = [...host.querySelectorAll(
                ".overview-greeting, .overview-heading, .overview-message")]
                .map((element) => { return element.className; });
            // Each section's heading, with its own loading line under it.
            expect(order).toEqual([
                "overview-greeting",
                "overview-heading",
                "overview-message",
                "overview-heading",
                "overview-message",
            ]);
            expect(host.querySelector(".overview-content-title")?.textContent
                ?.trim()).toBe("Database Connections");
            expect(host.querySelector(".overview-message")?.textContent)
                .toBe("Looking for MariaDB connections...");
        });

    it("greets, as MariaDB Shell Workbench, until the greeting is closed",
        async () => {
            await mount();

            expect(host.querySelector(".overview-title")?.textContent)
                .toBe("MariaDB Shell Workbench");
            expect(host.querySelector(".overview-description")?.textContent)
                .toBe(GREETING);

            await click(host.querySelector(".overview-close")!);

            expect(host.querySelector(".overview-greeting")).toBeNull();
            expect(posted).toContainEqual({ type: "closeGreeting" });
        });

    it("leaves the greeting out where it was closed before", async () => {
        await mount(false);

        expect(host.querySelector(".overview-greeting")).toBeNull();
        expect(tiles()).toContain("connection: root@localhost:3306");
    });

    it("shows folders first, then connections, then New Connection",
        async () => {
            await mount();

            expect(tiles()).toEqual([
                "folder: Empty",
                "folder: Production",
                "connection: root@localhost:3306",
                "createNew: New Connection",
            ]);
            expect(tile("root@localhost:3306")
                .querySelector(".overview-tile-description")?.textContent)
                .toBe("default");
            expect(crumbs()).toEqual(["/"]);
        });

    it("tints a folder's tile with its color, a connection's left edge",
        async () => {
            await mount();

            // The whole tile, through the tint its stylesheet mixes in.
            const production = tile("Production");
            expect(production.style.getPropertyValue("--tile-color"))
                .toBe("var(--vscode-charts-blue)");
            expect(tile("Empty").style.getPropertyValue("--tile-color"))
                .toBe("");

            await click(production);
            expect(tile("Shop").classList.contains("colored")).toBe(true);
            expect(tile("Shop").style.getPropertyValue("--tile-color"))
                .toBe("var(--vscode-charts-red)");
            // The Connections view's icon for each.
            expect(tile("Shop").querySelector(".overview-tile-icon")
                ?.classList.contains("overview-icon-connectionMariaDB"))
                .toBe(true);
        });

    it("goes into a folder, and back up with Back or the breadcrumb",
        async () => {
            await mount();

            await click(tile("Production"));

            expect(tiles()).toEqual([
                "back: Back",
                "connection: Shop",
                "createNew: New Connection",
            ]);
            expect(tile("Shop").querySelector(".overview-tile-description")
                ?.textContent).toBe("app@db:3307/shop · MCP");
            expect(crumbs()).toEqual(["/", "Production /"]);

            await click(tile("Back"));
            expect(crumbs()).toEqual(["/"]);

            await click(tile("Production"));
            await click(host.querySelector(".overview-crumb")!);
            expect(tiles()[0]).toBe("folder: Empty");
        });

    it("opens a SQL editor on a connection's tile", async () => {
        await mount();

        await click(tile("root@localhost:3306"));

        expect(posted).toContainEqual({
            type: "open",
            connection: { uri: LOCAL.uri, kind: "gui" },
            editor: "script",
        });
    });

    it("adds a new connection in the folder shown", async () => {
        await mount();
        await click(tile("Production"));

        await click(tile("New Connection"));

        expect(posted).toContainEqual(
            { type: "newConnection", folder: "/Production" });
    });

    it("offers a connection's actions", async () => {
        await mount();
        const actions = [...tile("root@localhost:3306")
            .querySelectorAll<HTMLButtonElement>(".overview-tile-action")];

        expect(actions.map((button) => {
            return [button.getAttribute("aria-label"), button.disabled];
        })).toEqual([
            ["More Actions", false],
            ["Create New Notebook", false],
            ["Open New SQL Editor", false],
        ]);

        posted.length = 0;
        await click(actions[2]!);
        await click(actions[1]!);
        expect(posted).toEqual([{
            type: "open",
            connection: { uri: LOCAL.uri, kind: "gui" },
            editor: "script",
        }, {
            type: "open",
            connection: { uri: LOCAL.uri, kind: "gui" },
            editor: "notebook",
        }]);
    });

    it("acts on a connection from its More Actions menu", async () => {
        await mount();
        posted.length = 0;

        await click(tile("root@localhost:3306")
            .querySelector("[aria-label='More Actions']")!);
        const items = [...document.querySelectorAll(".copyMenuItem")];

        expect(items.map((item) => { return item.textContent; })).toEqual(
            ["Edit Connection…", "Copy Connection URI", "Delete Connection…"]);
        // The menu's own click opens no editor.
        expect(posted).toEqual([]);

        await click(items[0]!);
        expect(posted).toEqual([{
            type: "connectionAction",
            action: "edit",
            connection: { uri: LOCAL.uri, kind: "gui" },
        }]);
    });

    it("leaves a folder that is gone for the nearest one still there",
        async () => {
            await mount();
            await click(tile("Production"));

            await send({
                type: "connections",
                connections: [LOCAL],
                customFolders: [],
                folderColors: {},
            });

            expect(crumbs()).toEqual(["/"]);
            expect(tiles()).toEqual([
                "connection: root@localhost:3306",
                "createNew: New Connection",
            ]);
        });

    it("starts in the folder of its one connection", async () => {
        await act(async () => {
            render(<OverviewPage />, host);
            await Promise.resolve();
        });
        await send({ type: "connections", connections: [],
            customFolders: [], folderColors: {} });
        expect(crumbs()).toEqual(["/"]);

        // The connection a sandbox deployment made.
        await send({ type: "connections",
            connections: [{ ...SHOP, path: "/Sandboxes" }],
            customFolders: [], folderColors: {} });

        expect(crumbs()).toEqual(["/", "Sandboxes /"]);
        expect(tiles()).toEqual([
            "back: Back",
            "connection: Shop",
            "createNew: New Connection",
        ]);
    });

    it("keeps an unpicked folder unpicked, and a landed one, across a reload",
        async () => {
            await mount(false);
            render(null, host);

            // Saved as none: the reload starts in its one connection's folder.
            await act(async () => {
                render(<OverviewPage />, host);
                await Promise.resolve();
            });
            await send({ type: "connections",
                connections: [{ ...SHOP, path: "/Sandboxes" }],
                customFolders: [], folderColors: {} });
            expect(crumbs()).toEqual(["/", "Sandboxes /"]);
            render(null, host);

            // Saved as landed: a second connection does not throw it out.
            await act(async () => {
                render(<OverviewPage />, host);
                await Promise.resolve();
            });
            await send({ type: "connections",
                connections: [LOCAL, { ...SHOP, path: "/Sandboxes" }],
                customFolders: [], folderColors: {} });
            expect(crumbs()).toEqual(["/", "Sandboxes /"]);
        });

    it("says why the connections could not be listed", async () => {
        await act(async () => {
            render(<OverviewPage />, host);
            await Promise.resolve();
        });

        await send({ type: "failed", section: "connections",
            message: "no server" });

        expect(host.querySelector(".overview-failed")?.textContent)
            .toBe("The connections could not be listed: no server");
    });
});

describe("Database Deployments", () => {
    const SANDBOX: IOverviewDeployment = {
        port: 3310,
        path: "/Sandboxes",
        description: "13.1.1 · running · REST Daemon running",
        icon: "vm-running",
        iconColor: "testing.iconPassed",
        // What the host worked out the sandbox and its daemon offer now.
        menu: [
            [
                { command: "mariadb.stopSandbox", title: "Stop Sandbox" },
                { command: "mariadb.deleteSandbox", title: "Delete Sandbox" },
            ],
            [
                { command: "mariadb.restd.stop", title: "Stop REST Daemon",
                    directory: "/restd/8443" },
                { command: "mariadb.restd.openLog",
                    title: "Open REST Daemon Log", directory: "/restd/8443" },
            ],
        ],
    };

    const mountDeployments = async (): Promise<void> => {
        await mount(false);
        await send({ type: "deployments", deployments: [SANDBOX] });
    };

    /** @returns The captions of the Database Deployments section's tiles. */
    const deploymentTiles = (): string[] => {
        const [, section] = host.querySelectorAll(".overview-tiles");

        return [...section?.querySelectorAll(".overview-tile-caption") ?? []]
            .map((caption) => { return caption.textContent ?? ""; });
    };

    it("is looked for below the connections, until listed", async () => {
        await mount(false);

        const titles = [...host.querySelectorAll(".overview-content-title")]
            .map((title) => { return title.textContent?.trim(); });
        expect(titles).toEqual(["Database Connections",
            "Database Deployments"]);
        expect(host.textContent).toContain("Looking for MariaDB deployments");
    });

    it("files the sandboxes in their folder, with New Deployment",
        async () => {
            await mountDeployments();
            await click(tile("Back"));

            expect(deploymentTiles()).toEqual(["Sandboxes", "New Deployment"]);

            await click(tile("Sandboxes"));

            expect(deploymentTiles()).toEqual(
                ["Back", "localhost:3310", "New Deployment"]);
            expect(crumbs(1)).toEqual(["/", "Sandboxes /"]);
            // The connections' section stays where it was.
            expect(crumbs(0)).toEqual(["/"]);
            const sandbox = tile("localhost:3310");
            expect(sandbox.querySelector(".overview-tile-description")
                ?.textContent).toBe("13.1.1 · running · REST Daemon running");
            // Its row's codicon, in its row's color.
            const icon = sandbox.querySelector<HTMLElement>(
                ".codicon-vm-running")!;
            expect(icon.style.color).toBe("var(--vscode-testing-iconPassed)");
        });

    it("opens a sandbox's menu on its tile: what the host sent, by group",
        async () => {
            await mountDeployments();
            posted.length = 0;

            await click(tile("localhost:3310"));
            const menu = [...document.querySelectorAll(
                ".copyMenuItem, .copyMenuSeparator")];

            expect(menu.map((item) => { return item.textContent; })).toEqual([
                "Stop Sandbox",
                "Delete Sandbox",
                "",
                "Stop REST Daemon",
                "Open REST Daemon Log",
            ]);
            expect(posted).toEqual([]);

            await click(menu[3]!);
            expect(posted).toEqual([{
                type: "deploymentCommand",
                command: "mariadb.restd.stop",
                port: 3310,
                directory: "/restd/8443",
            }]);
        });

    it("opens no menu where nothing applies, and spins while busy",
        async () => {
            await mount(false);
            await send({ type: "deployments", deployments: [
                { ...SANDBOX, icon: "loading~spin", menu: [[]] },
            ] });

            await click(tile("localhost:3310"));

            expect(document.querySelectorAll(".copyMenuItem")).toHaveLength(0);
            expect(tile("localhost:3310").querySelector(
                ".codicon-loading.codicon-modifier-spin")).not.toBeNull();
        });

    it("starts in the folder of its one sandbox, and stays there",
        async () => {
            await mount(false);
            await send({ type: "deployments", deployments: [] });
            expect(deploymentTiles()).toEqual(["New Deployment"]);

            // The first sandbox, made from the overview.
            await send({ type: "deployments", deployments: [SANDBOX] });
            expect(crumbs(1)).toEqual(["/", "Sandboxes /"]);

            await send({ type: "deployments", deployments: [
                SANDBOX, { ...SANDBOX, port: 3311 },
            ] });
            expect(deploymentTiles()).toEqual(
                ["Back", "localhost:3310", "localhost:3311", "New Deployment"]);
        });

    it("stays at the top level once the user went back to it", async () => {
        await mountDeployments();
        await click(tile("Back"));

        await send({ type: "deployments", deployments: [SANDBOX] });

        expect(crumbs(1)).toEqual(["/"]);
    });

    it("opens the New Deployment wizard", async () => {
        await mountDeployments();
        posted.length = 0;

        await click(tile("New Deployment"));

        expect(posted).toEqual([{ type: "newDeployment" }]);
    });

    it("says why the deployments could not be listed", async () => {
        await mount(false);

        await send({ type: "failed", section: "deployments",
            message: "no sandboxes" });

        expect(host.textContent)
            .toContain("The deployments could not be listed: no sandboxes");
    });
});
