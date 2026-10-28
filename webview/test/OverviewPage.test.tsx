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

import type { IOverviewConnection }
    from "../../src/overview/overviewModel.js";
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
    family: "mariadb",
};

const SHOP: IOverviewConnection = {
    uri: "mariadb://app@db:3307/shop",
    kind: "mcp",
    path: "/Production",
    caption: "Shop",
    color: "red",
    address: "app@db:3307/shop",
    isDefault: false,
    family: "mariadb",
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
    await send({
        type: "connections",
        connections: [LOCAL, SHOP],
        customFolders: ["/Empty"],
        showGreeting,
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
const crumbs = (): string[] => {
    return [...host.querySelectorAll(".overview-crumb")].map((crumb) => {
        return crumb.textContent ?? "";
    });
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

    it("greets, as MariaDB Workbench, until the greeting is closed",
        async () => {
            await mount();

            expect(host.querySelector(".overview-title")?.textContent)
                .toBe("MariaDB Workbench");
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

    it("offers a connection's actions, the notebook's not yet", async () => {
        await mount();
        const actions = [...tile("root@localhost:3306")
            .querySelectorAll<HTMLButtonElement>(".overview-tile-action")];

        expect(actions.map((button) => {
            return [button.getAttribute("aria-label"), button.disabled];
        })).toEqual([
            ["More Actions", false],
            ["Create New Notebook", true],
            ["Open New SQL Editor", false],
        ]);

        posted.length = 0;
        await click(actions[2]!);
        expect(posted).toEqual([{
            type: "open",
            connection: { uri: LOCAL.uri, kind: "gui" },
            editor: "script",
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
                showGreeting: false,
            });

            expect(crumbs()).toEqual(["/"]);
            expect(tiles()).toEqual([
                "connection: root@localhost:3306",
                "createNew: New Connection",
            ]);
        });

    it("says why the connections could not be listed", async () => {
        await act(async () => {
            render(<OverviewPage />, host);
            await Promise.resolve();
        });

        await send({ type: "failed", message: "no server" });

        expect(host.querySelector(".overview-failed")?.textContent)
            .toBe("The connections could not be listed: no server");
    });
});
