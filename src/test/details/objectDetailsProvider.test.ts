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

import { describe, expect, it } from "vitest";

import type {
    DetailsHostMessage,
    DetailsWebviewMessage,
} from "../../details/objectDetails.js";
import {
    ObjectDetailsProvider,
    type IObjectDetailsHost,
} from "../../details/objectDetailsProvider.js";
import type { ISchemaDefinition } from "../../modeler/modelFormat.js";
import { Uri } from "../mocks/vscode.js";

/** A webview view that keeps what it is sent. */
const fakeView = (viewType: string, visible: boolean) => {
    const posted: DetailsHostMessage[] = [];
    let receive: (message: DetailsWebviewMessage) => void = () => { /* */ };
    let visibilityChanged = () => { /* */ };
    const view = {
        viewType,
        webview: {
            options: {},
            html: "",
            cspSource: "vscode-resource:",
            asWebviewUri: (uri: Uri) => { return uri; },
            postMessage: (message: DetailsHostMessage) => {
                posted.push(message);

                return Promise.resolve(true);
            },
            onDidReceiveMessage: (
                listener: (message: DetailsWebviewMessage) => void) => {
                receive = listener;
            },
        },
        visible,
        onDidDispose: () => { /* kept */ },
        onDidChangeVisibility: (listener: () => void) => {
            visibilityChanged = listener;
        },
    };

    return { view, posted, send: (message: DetailsWebviewMessage) => {
        receive(message);
    }, shown: () => {
        view.visible = true;
        visibilityChanged();
    } };
};

const definition = (): ISchemaDefinition => {
    return {
        format: "msm-schema/1",
        schema: "shop",
        source_hash: "sha256:a",
        tables: [{ name: "orders", columns: [{ name: "id", type: "INT" }] }],
    };
};

/** Lets the provider's reads and writes run. */
const settle = async (): Promise<void> => {
    for (let round = 0; round < 5; round += 1) {
        await Promise.resolve();
    }
};

const PROJECT = { projectPath: "/p/shop.msm.project" };
const LIVE = { connection: "mariadb://localhost", schema: "shop" };
const ORDERS = { type: "table", name: "orders" } as const;

const setUp = (visible = true) => {
    let reads = 0;
    const host: IObjectDetailsHost = {
        extensionUri: Uri.file("/ext") as never,
        log: () => { /* not looked at */ },
        snapshot: () => { reads += 1; return Promise.resolve(definition()); },
        liveDetails: () => {
            return Promise.resolve({
                basic: { schema: "shop", name: "orders", type: "BASE TABLE" },
                columns: [],
            });
        },
        connectionLabel: () => { return "local"; },
    };
    const provider = new ObjectDetailsProvider(host);
    const live = fakeView("mariadb.objectDetails", true);
    const msm = fakeView("mariadb.msmObjectDetails", visible);
    provider.resolveWebviewView(live.view as never);
    provider.resolveWebviewView(msm.view as never);

    return { provider, live, msm, reads: () => { return reads; } };
};

describe("the Object Details view", () => {
    it("is empty in a side bar where nothing was selected yet", () => {
        const { live, msm } = setUp();
        live.send({ type: "ready" });
        msm.send({ type: "ready" });

        expect(live.posted).toEqual([{ type: "show" }]);
        expect(msm.posted).toEqual([{ type: "show" }]);
    });

    it("shows a project's object below MSM Projects and a live one below "
        + "Connections, each kept apart", async () => {
        const { provider, live, msm } = setUp();
        provider.show(PROJECT, ORDERS);
        await settle();
        expect(msm.posted.at(-1)).toMatchObject({ type: "show", details: {
            schema: "shop", where: "Project",
            object: { type: "table", table: { name: "orders" } } } });
        expect(live.posted).toEqual([]);

        provider.show(LIVE, ORDERS);
        await settle();
        expect(live.posted.at(-1)).toMatchObject({ type: "show", details: {
            where: "local", object: { type: "table" } } });
        expect(msm.posted).toHaveLength(1);

        // A view opened again gets its own side's object.
        msm.send({ type: "ready" });
        expect(msm.posted.at(-1)).toMatchObject({ details: {
            where: "Project" } });
    });

    it("reads the object again once the schema changed, and not the same "
        + "selection twice", async () => {
        const { provider, reads } = setUp();
        provider.show(PROJECT, ORDERS);
        provider.show(PROJECT, ORDERS);
        await settle();
        expect(reads()).toBe(1);

        provider.refreshed();
        await settle();
        expect(reads()).toBe(2);
    });

    it("follows a rename of the object it shows, in its own side bar only",
        async () => {
            const { provider, msm, live } = setUp();
            provider.show(PROJECT, ORDERS);
            provider.show(LIVE, ORDERS);
            await settle();
            provider.renamed(PROJECT, ORDERS, "purchases");
            // Another object's rename leaves it as it is.
            provider.renamed(PROJECT, { type: "table", name: "items" }, "lines");
            provider.refreshed();
            await settle();
            expect(msm.posted.at(-1)).toMatchObject({ type: "show",
                message: "purchases is not in the project's schema snapshot." });
            expect(live.posted.at(-1)).toMatchObject({ details: {
                where: "local" } });
        });

    it("reads nothing while its view does not show, and the selection once "
        + "it does", async () => {
        const { provider, msm, reads } = setUp(false);
        provider.show(PROJECT, ORDERS);
        provider.refreshed();
        await settle();
        expect(reads()).toBe(0);

        msm.shown();
        await settle();
        expect(reads()).toBe(1);
        expect(msm.posted.at(-1)).toMatchObject({ type: "show",
            details: { object: { type: "table" } } });
    });
});

describe("a diagram item in the Object Details view", () => {
    const FIGURE = {
        kind: "figure", id: "f1", x: 10, y: 20, z: 0, width: 200,
        height: 120, autoHeight: true, upright: false, color: "", editable: true,
    } as const;
    const LINE = {
        kind: "connection", id: "c1", source: "orders", target: "customers",
        offset: 0, split: false, editable: true,
    } as const;

    it("shows a table figure's place with its table", async () => {
        const { provider, msm } = setUp();
        provider.show(PROJECT, ORDERS, { item: FIGURE });
        await settle();

        expect(msm.posted.at(-1)).toMatchObject({
            type: "show",
            details: { object: { type: "table" } },
            item: FIGURE,
        });
    });

    it("shows a relationship line alone, and follows its changes", () => {
        const { provider, msm } = setUp();
        provider.showItem(PROJECT, { item: LINE });
        expect(msm.posted.at(-1)).toEqual({ type: "show", item: LINE });

        provider.itemChanged(PROJECT, { ...LINE, offset: -40 });
        expect(msm.posted.at(-1)).toEqual({ type: "item",
            item: { ...LINE, offset: -40 } });

        // Another item's change is not the one shown.
        provider.itemChanged(PROJECT, { ...LINE, id: "c2" });
        expect(msm.posted).toHaveLength(2);
    });

    it("sends the view's changes to the diagram the item is on", () => {
        const { provider, msm } = setUp();
        const changes: unknown[] = [];
        provider.showItem(PROJECT, { item: LINE, edit: (id, change) => {
            changes.push([id, change]);
        } });
        msm.send({ type: "changeItem", id: "c1", change: { split: true } });
        // No longer the item shown: dropped.
        msm.send({ type: "changeItem", id: "c9", change: { split: true } });

        expect(changes).toEqual([["c1", { split: true }]]);
    });

    it("empties its view, the object with the item, once the diagram's "
        + "selection is cleared", async () => {
        const { provider, live, msm } = setUp();
        provider.show(LIVE, ORDERS);
        provider.show(PROJECT, ORDERS, { item: FIGURE });
        await settle();
        provider.clear(PROJECT);

        expect(msm.posted.at(-1)).toEqual({ type: "show" });
        // The other side bar's object stays.
        expect(live.posted.at(-1)).toMatchObject({ type: "show",
            details: { object: { type: "table" } } });
    });

    it("drops the item once a tree row is selected", async () => {
        const { provider, msm } = setUp();
        provider.show(PROJECT, ORDERS, { item: FIGURE });
        await settle();
        provider.show(PROJECT, { type: "table", name: "customers" });
        await settle();

        expect(msm.posted.at(-1)).toMatchObject({ type: "show" });
        expect((msm.posted.at(-1) as { item?: unknown }).item).toBeUndefined();
    });
});
