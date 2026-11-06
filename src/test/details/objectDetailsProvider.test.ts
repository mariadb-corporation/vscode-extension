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
const fakeView = (visible: boolean) => {
    const posted: DetailsHostMessage[] = [];
    let receive: (message: DetailsWebviewMessage) => void = () => { /* */ };
    let visibilityChanged = () => { /* */ };
    const view = {
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
    const fake = fakeView(visible);
    provider.resolveWebviewView(fake.view as never);

    return { provider, fake, reads: () => { return reads; },
        shown: fake.shown };
};

describe("the Object Details view", () => {
    it("shows a project's table and a live one, read only", async () => {
        const { provider, fake } = setUp();
        fake.send({ type: "ready" });
        expect(fake.posted[0]).toMatchObject({ type: "show",
            message: expect.stringContaining("Select") });

        provider.show({ projectPath: "/p/shop.msm.project" },
            { type: "table", name: "orders" });
        await settle();
        expect(fake.posted.at(-1)).toMatchObject({ type: "show", details: {
            schema: "shop", where: "Project",
            object: { type: "table", table: { name: "orders" } } } });

        provider.show({ connection: "mariadb://localhost", schema: "shop" },
            { type: "table", name: "orders" });
        await settle();
        expect(fake.posted.at(-1)).toMatchObject({ type: "show", details: {
            where: "local", partial: expect.stringContaining("Indexes") } });
    });

    it("reads the object again once the schema changed, and not the same "
        + "selection twice", async () => {
        const { provider, reads } = setUp();
        provider.show({ projectPath: "/p/shop.msm.project" },
            { type: "table", name: "orders" });
        provider.show({ projectPath: "/p/shop.msm.project" },
            { type: "table", name: "orders" });
        await settle();
        expect(reads()).toBe(1);

        provider.refreshed();
        await settle();
        expect(reads()).toBe(2);
    });

    it("reads nothing while no view shows, and the selection once one "
        + "does", async () => {
        const { provider, fake, reads, shown } = setUp(false);
        provider.show({ projectPath: "/p/shop.msm.project" },
            { type: "table", name: "orders" });
        provider.refreshed();
        await settle();
        expect(reads()).toBe(0);

        shown();
        await settle();
        expect(reads()).toBe(1);
        expect(fake.posted.at(-1)).toMatchObject({ type: "show",
            details: { object: { type: "table" } } });
    });
});
