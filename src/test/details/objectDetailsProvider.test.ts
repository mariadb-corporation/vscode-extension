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

import type { IDetailEdits } from "../../details/detailEdits.js";
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
const fakeView = () => {
    const posted: DetailsHostMessage[] = [];
    let receive: (message: DetailsWebviewMessage) => void = () => { /* */ };
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
        onDidDispose: () => { /* kept */ },
    };

    return { view, posted, send: (message: DetailsWebviewMessage) => {
        receive(message);
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

const setUp = (how: "viewer" | "made") => {
    const changes: Array<[string, IDetailEdits, string | undefined]> = [];
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
        change: (projectPath, change, baseHash) => {
            changes.push([projectPath, change, baseHash]);

            return Promise.resolve(how);
        },
    };
    const provider = new ObjectDetailsProvider(host);
    const fake = fakeView();
    provider.resolveWebviewView(fake.view as never);

    return { provider, fake, changes, reads: () => { return reads; } };
};

describe("the Object Details view", () => {
    it("shows a project's table, to be changed, and a live one only",
        async () => {
        const { provider, fake } = setUp("made");
        fake.send({ type: "ready" });
        expect(fake.posted[0]).toMatchObject({ type: "show",
            message: expect.stringContaining("Select") });

        provider.show({ projectPath: "/p/shop.msm.project" },
            { type: "table", name: "orders" });
        await settle();
        expect(fake.posted.at(-1)).toMatchObject({ type: "show", details: {
            schema: "shop", where: "Project", editable: true,
            object: { type: "table", table: { name: "orders" } } } });

        provider.show({ connection: "mariadb://localhost", schema: "shop" },
            { type: "table", name: "orders" });
        await settle();
        expect(fake.posted.at(-1)).toMatchObject({ type: "show", details: {
            where: "local", editable: false,
            partial: expect.stringContaining("Indexes") } });
    });

    it("makes a change against the snapshot's hash, then reads again",
        async () => {
        const { provider, fake, changes, reads } = setUp("made");
        provider.show({ projectPath: "/p/shop.msm.project" },
            { type: "table", name: "orders" });
        await settle();
        const before = reads();

        fake.send({ type: "change", change: { kind: "addColumn",
            definition: { name: "note", type: "TEXT" } } });
        await settle();

        expect(changes).toEqual([["/p/shop.msm.project", {
            label: "Add Column orders.note",
            edits: [{ op: "add_column", table: "orders",
                column: { name: "note", type: "TEXT" } }],
            inverse: [{ op: "drop_column", table: "orders",
                column: "note" }],
        }, "sha256:a"]]);
        expect(fake.posted).toContainEqual({ type: "status", busy: true });
        // The change's snapshot read, and the read after it.
        expect(reads()).toBe(before + 2);
    });

    it("follows a table renamed in the open diagram, and takes the name "
        + "back where msm refused it", async () => {
        const { provider, fake, changes } = setUp("viewer");
        provider.show({ projectPath: "/p/shop.msm.project" },
            { type: "table", name: "orders" });
        await settle();

        fake.send({ type: "change", change: { kind: "renameTable",
            name: "purchase" } });
        await settle();
        expect(changes[0]?.[1].edits).toEqual([{ op: "rename_table",
            table: "orders", new_name: "purchase" }]);

        provider.failed("The name is taken.");
        await settle();
        expect(fake.posted).toContainEqual({ type: "status",
            error: "The name is taken." });
        // Shown under its old name again.
        expect(fake.posted.at(-1)).toMatchObject({ type: "show", details: {
            object: { table: { name: "orders" } } } });
    });
});
