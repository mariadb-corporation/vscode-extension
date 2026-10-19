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

import { describe, expect, it, vi } from "vitest";

import type { IActivityEvent } from "../../connections/connectionActivity.js";
import {
    ConnectionManager,
    UI_BACKEND_SESSION,
} from "../../connections/connectionManager.js";
import { createFakeApi, createFakeSettings } from "../helpers.js";

/**
 * @param defaultConnection The default to start with.
 *
 * @returns A manager over a fake server with two configured connections.
 */
const createManager = (defaultConnection?: string) => {
    const api = createFakeApi({
        connections: ["dba@localhost:3310", "app@localhost:3311"],
        connectionIds: {
            "dba@localhost:3310": "uuid-dba",
            "app@localhost:3311": "uuid-app",
        },
    });
    const settings = createFakeSettings(defaultConnection);
    const reported: IActivityEvent[] = [];
    const manager = new ConnectionManager(() => {
        return Promise.resolve(api);
    }, settings, (event) => {
        reported.push(event);
    });

    return { api, settings, manager, reported };
};

describe("ConnectionManager", () => {
    it("lists the configured connections", async () => {
        const { manager } = createManager();

        await expect(manager.listConnections()).resolves.toEqual([
            "dba@localhost:3310",
            "app@localhost:3311",
        ]);
    });

    it("opens a connection and remembers its UUID", async () => {
        const { manager } = createManager();

        await expect(manager.connect("dba@localhost:3310"))
            .resolves.toBe("uuid-dba");
        expect(manager.isConnected("dba@localhost:3310")).toBe(true);
        expect(manager.connectionIdFor("dba@localhost:3310"))
            .toBe("uuid-dba");
        expect(manager.openConnections).toEqual(["dba@localhost:3310"]);
    });

    it("opens a connection only once", async () => {
        const { api, manager } = createManager();
        const connect = vi.spyOn(api, "connect");

        await manager.connect("dba@localhost:3310");
        await manager.connect("dba@localhost:3310");

        expect(connect).toHaveBeenCalledTimes(1);
    });

    it("reports an unknown connection", async () => {
        const { manager } = createManager();

        await expect(manager.connect("nope"))
            .rejects.toThrow(/not a configured connection/);
        expect(manager.isConnected("nope")).toBe(false);
    });

    it("closes a connection", async () => {
        const { api, manager } = createManager();

        await manager.connect("dba@localhost:3310");
        await manager.disconnect("dba@localhost:3310");

        expect(api.closed).toEqual(["uuid-dba"]);
        expect(manager.isConnected("dba@localhost:3310")).toBe(false);
    });

    /** Holds the fake server's connect until `open()` lets it answer. */
    const gateConnect = (api: ReturnType<typeof createManager>["api"]) => {
        const connect = api.connect.bind(api);
        let open = (): void => { /* set below */ };
        const gate = new Promise<void>((resolve) => { open = resolve; });
        let calls = 0;
        api.connect = async (uri: string) => {
            calls += 1;
            await gate;

            return await connect(uri);
        };

        return { open, calls: () => { return calls; } };
    };

    it("shares an open under way with whoever asks meanwhile", async () => {
        const { api, manager } = createManager();
        const gate = gateConnect(api);

        const first = manager.connect("dba@localhost:3310");
        const second = manager.connect("dba@localhost:3310");
        gate.open();

        expect(await first).toBe("uuid-dba");
        expect(await second).toBe("uuid-dba");
        expect(gate.calls()).toBe(1);
        expect(manager.sessionsOf("dba@localhost:3310")).toHaveLength(1);
    });

    it("closes what an open under way brings when a disconnect came first",
        async () => {
            const { api, manager } = createManager();
            const gate = gateConnect(api);

            const opening = manager.connect("dba@localhost:3310",
                UI_BACKEND_SESSION);
            await manager.disconnect("dba@localhost:3310");
            gate.open();

            await expect(opening).rejects.toThrow(
                "Disconnected from dba@localhost:3310 while it was being "
                + "opened.");
            expect(api.closed).toEqual(["uuid-dba"]);
            expect(manager.isConnected("dba@localhost:3310")).toBe(false);

            // Asked again later, it opens as usual.
            expect(await manager.connect("dba@localhost:3310",
                UI_BACKEND_SESSION)).toBe("uuid-dba-2");
        });

    it("opens anew for a connect made after the disconnect", async () => {
        const { api, manager } = createManager();
        const gate = gateConnect(api);

        const abandoned = manager.connect("dba@localhost:3310");
        await manager.disconnect("dba@localhost:3310");
        const fresh = manager.connect("dba@localhost:3310");
        gate.open();

        await expect(abandoned).rejects.toThrow("while it was being opened");
        // Its own open, not the abandoned one's failure.
        expect(await fresh).toBe("uuid-dba-2");
        expect(gate.calls()).toBe(2);
        expect(manager.isConnected("dba@localhost:3310")).toBe(true);
    });

    it("remembers a connection disconnected as a whole until it is opened",
        async () => {
            const { manager } = createManager();
            await manager.connect("dba@localhost:3310");
            await manager.connect("dba@localhost:3310", UI_BACKEND_SESSION);

            // One session of it: not the connection.
            await manager.disconnect("dba@localhost:3310", UI_BACKEND_SESSION);
            expect(manager.wasDisconnected("dba@localhost:3310")).toBe(false);

            await manager.disconnect("dba@localhost:3310");
            expect(manager.wasDisconnected("dba@localhost:3310")).toBe(true);

            await manager.connect("dba@localhost:3310");
            expect(manager.wasDisconnected("dba@localhost:3310")).toBe(false);
        });

    it("closes what was only being opened when everything is closed",
        async () => {
            const { api, manager } = createManager();
            const gate = gateConnect(api);

            const opening = manager.connect("dba@localhost:3310");
            await manager.disconnectAll();
            gate.open();

            await expect(opening).rejects.toThrow("while it was being opened");
            expect(api.closed).toEqual(["uuid-dba"]);
            expect(manager.openConnections).toEqual([]);
        });

    it("leaves an open under way of another name alone", async () => {
        const { api, manager } = createManager();
        const gate = gateConnect(api);

        const opening = manager.connect("dba@localhost:3310");
        await manager.disconnect("dba@localhost:3310", UI_BACKEND_SESSION);
        gate.open();

        expect(await opening).toBe("uuid-dba");
        expect(manager.isConnected("dba@localhost:3310", "1")).toBe(true);
    });

    it("is a no-op when closing something that is not open", async () => {
        const { api, manager } = createManager();

        await manager.disconnect("dba@localhost:3310");

        expect(api.closed).toEqual([]);
    });

    it("forgets a connection even if the server refuses to close it",
        async () => {
            const { api, manager } = createManager();
            await manager.connect("dba@localhost:3310");
            api.close = () => {
                return Promise.reject(new Error("already gone"));
            };

            await expect(manager.disconnect("dba@localhost:3310"))
                .rejects.toThrow("already gone");
            // The tree must not keep showing it as open.
            expect(manager.isConnected("dba@localhost:3310")).toBe(false);
        });

    it("closes every connection at once", async () => {
        const { api, manager } = createManager();

        await manager.connect("dba@localhost:3310");
        await manager.connect("app@localhost:3311");
        await manager.disconnectAll();

        expect(api.closed.sort()).toEqual(["uuid-app", "uuid-dba"]);
        expect(manager.openConnections).toEqual([]);
    });

    it("swallows failures while closing everything", async () => {
        const { api, manager } = createManager();
        await manager.connect("dba@localhost:3310");
        api.close = () => {
            return Promise.reject(new Error("the server is going down"));
        };

        await expect(manager.disconnectAll()).resolves.toBeUndefined();
    });

    describe("several connections on one URI", () => {
        it("numbers an unnamed connection and names a named one",
            async () => {
                const { manager } = createManager();

                await manager.connect("dba@localhost:3310");
                await manager.connect(
                    "dba@localhost:3310", UI_BACKEND_SESSION);

                expect(manager.sessionsOf("dba@localhost:3310")).toEqual([
                    {
                        uri: "dba@localhost:3310",
                        label: "1",
                        connectionId: "uuid-dba",
                    },
                    {
                        uri: "dba@localhost:3310",
                        label: UI_BACKEND_SESSION,
                        connectionId: "uuid-dba-2",
                    },
                ]);
                // One URI, however many connections are open on it.
                expect(manager.openConnections)
                    .toEqual(["dba@localhost:3310"]);
            });

        it("reuses a connection by name", async () => {
            const { api, manager } = createManager();
            const connect = vi.spyOn(api, "connect");

            const first = await manager.connect(
                "dba@localhost:3310", UI_BACKEND_SESSION);
            const second = await manager.connect(
                "dba@localhost:3310", UI_BACKEND_SESSION);

            expect(second).toBe(first);
            expect(connect).toHaveBeenCalledTimes(1);
        });

        it("says what a connection opened now would be called", () => {
            const { manager } = createManager();

            // The result view puts a run up before its connection has
            // been opened, so this has to answer before there is one.
            expect(manager.labelFor("dba@localhost:3310")).toBe("1");
            expect(manager.labelFor("dba@localhost:3310", UI_BACKEND_SESSION))
                .toBe(UI_BACKEND_SESSION);
        });

        it("keeps answering with the connection an editor is running on",
            async () => {
                const { manager } = createManager();
                await manager.connect(
                    "dba@localhost:3310", UI_BACKEND_SESSION);
                await manager.connect("dba@localhost:3310");

                // The named one is not an editor's to run on, and the
                // numbered one is already there to be reused.
                expect(manager.labelFor("dba@localhost:3310")).toBe("1");
            });

        it("looks a connection up by name", async () => {
            const { manager } = createManager();
            await manager.connect("dba@localhost:3310");
            await manager.connect("dba@localhost:3310", UI_BACKEND_SESSION);

            expect(manager.connectionIdFor(
                "dba@localhost:3310", UI_BACKEND_SESSION))
                .toBe("uuid-dba-2");
            expect(manager.isConnected(
                "dba@localhost:3310", UI_BACKEND_SESSION)).toBe(true);
            expect(manager.isConnected("app@localhost:3311",
                UI_BACKEND_SESSION)).toBe(false);
            // With no name, any connection on the URI answers.
            expect(manager.connectionIdFor("dba@localhost:3310"))
                .toBe("uuid-dba");
        });

        it("closes every connection on a URI at once", async () => {
            const { api, manager } = createManager();
            await manager.connect("dba@localhost:3310");
            await manager.connect("dba@localhost:3310", UI_BACKEND_SESSION);

            await manager.disconnect("dba@localhost:3310");

            expect(api.closed).toEqual(["uuid-dba", "uuid-dba-2"]);
            expect(manager.isConnected("dba@localhost:3310")).toBe(false);
        });

        it("closes one connection by name", async () => {
            const { api, manager } = createManager();
            await manager.connect("dba@localhost:3310");
            await manager.connect("dba@localhost:3310", UI_BACKEND_SESSION);

            await manager.disconnect(
                "dba@localhost:3310", UI_BACKEND_SESSION);

            expect(api.closed).toEqual(["uuid-dba-2"]);
            expect(manager.isConnected("dba@localhost:3310")).toBe(true);
        });
    });

    describe("the cached connection list", () => {
        /**
         * @param api The fake behind the manager.
         *
         * @returns A counter of the list reads that reach the fake.
         */
        const countReads = (api: ReturnType<typeof createManager>["api"]) => {
            const reads = { count: 0 };
            const list = api.listConnectionEntries.bind(api);
            api.listConnectionEntries = (kind) => {
                reads.count += 1;

                return list(kind);
            };

            return reads;
        };

        it("reads the list once, however often it is asked for", async () => {
            const { api, manager } = createManager();
            const reads = countReads(api);

            await Promise.all([
                manager.listStoredConnections(),
                manager.listStoredConnections(),
            ]);
            await manager.listConnections();

            // One call for both lists, and never again.
            expect(reads.count).toBe(1);
        });

        it("reads it again after a change made through it, or when told",
            async () => {
                const { api, manager } = createManager();
                const reads = countReads(api);
                await manager.listStoredConnections();

                await (await manager.api()).addConnection("a@b:1", "pw");
                await manager.listStoredConnections();
                expect(reads.count).toBe(2);

                await (await manager.api()).updateConnection("a@b:1");
                await (await manager.api()).deleteConnection("a@b:1");
                await manager.listStoredConnections();
                expect(reads.count).toBe(3);

                // Testing changes nothing.
                await (await manager.api()).testConnection("a@b:1", "pw");
                await manager.listStoredConnections();
                expect(reads.count).toBe(3);

                manager.invalidateStoredConnections();
                await manager.listStoredConnections();
                expect(reads.count).toBe(4);
            });

        it("reads it again after a change that failed", async () => {
            const { api, manager } = createManager();
            const reads = countReads(api);
            await manager.listStoredConnections();
            api.deleteConnection = () => {
                return Promise.reject(new Error("half done"));
            };

            await expect((await manager.api()).deleteConnection("a@b:1"))
                .rejects.toThrow("half done");
            await manager.listStoredConnections();

            expect(reads.count).toBe(2);
        });

        it("asks twice, once per list, where the server refuses 'all'",
            async () => {
                const api = createFakeApi({
                    connections: ["shared@localhost:1"],
                    guiConnections: ["mine@localhost:2"],
                    paths: { "mine@localhost:2": "/Mine" },
                    noAllKind: true,
                });
                const manager = new ConnectionManager(
                    () => { return Promise.resolve(api); },
                    createFakeSettings(),
                );

                await expect(manager.listStoredConnections()).resolves.toEqual([
                    { uri: "shared@localhost:1", kind: "mcp", path: "/" },
                    { uri: "mine@localhost:2", kind: "gui", path: "/Mine" },
                ]);
            });

        it("does not keep a read that failed", async () => {
            const { api, manager } = createManager();
            const list = api.listConnectionEntries.bind(api);
            api.listConnectionEntries = () => {
                return Promise.reject(new Error("not up yet"));
            };

            await expect(manager.listStoredConnections())
                .rejects.toThrow("not up yet");

            api.listConnectionEntries = list;
            await expect(manager.listStoredConnections())
                .resolves.toHaveLength(2);
        });
    });

    describe("what it reports", () => {
        it("reports the connection list only where the setting says so",
            async () => {
                const { manager, settings, reported } = createManager();
                let logAll = false;
                Object.assign(settings, {
                    logAllCalls: () => { return logAll; },
                });

                await manager.listStoredConnections();
                expect(reported).toEqual([]);

                // Read on every call: turning it on needs no restart.
                logAll = true;
                manager.invalidateStoredConnections();
                await manager.listStoredConnections();
                expect(reported.map((event) => {
                    return [event.connection, event.call];
                })).toEqual([
                    ["General Actions", "db.list_connections(kind=all)"],
                ]);
            });

        it("reports a connection being opened", async () => {
            const { manager, reported } = createManager();

            await manager.connect("dba@localhost:3310", UI_BACKEND_SESSION);

            expect(reported).toHaveLength(1);
            expect(reported[0]).toMatchObject({
                connection: "dba@localhost:3310",
                label: UI_BACKEND_SESSION,
                call: "db.connect(dba@localhost:3310)",
                message: `Opened Session ${UI_BACKEND_SESSION} for `
                    + "dba@localhost:3310",
            });
        });

        it("reports a connection being closed", async () => {
            const { manager, reported } = createManager();
            await manager.connect("dba@localhost:3310");

            await manager.disconnect("dba@localhost:3310");

            expect(reported.at(-1)).toMatchObject({
                connection: "dba@localhost:3310",
                label: "1",
                call: "db.close()",
                message: "Closed Session 1 for dba@localhost:3310",
            });
        });

        it("says nothing about a connection it did not open", async () => {
            const { manager, reported } = createManager();

            await expect(manager.connect("nope")).rejects.toThrow();

            expect(reported).toEqual([]);
        });

        it("reports what is done on an open connection", async () => {
            const { manager, reported, settings } = createManager();
            // Browsing is reported only where every call is asked for.
            settings.logAllCalls = () => { return true; };
            const connectionId = await manager.connect("dba@localhost:3310");
            const api = await manager.api();

            await api.listSchemas(connectionId);

            expect(reported.at(-1)).toMatchObject({
                connection: "dba@localhost:3310",
                label: "1",
                call: "db.list_schemas()",
                message: "Listed 0 schemas",
            });
        });
    });

    it("reads the default connection from the settings", () => {
        const { manager } = createManager("app@localhost:3311");

        expect(manager.defaultConnection).toBe("app@localhost:3311");
    });

    it("writes the default connection to the settings", async () => {
        const { settings, manager } = createManager();

        await manager.setDefaultConnection("dba@localhost:3310");

        expect(settings.value).toBe("dba@localhost:3310");
        expect(manager.defaultConnection).toBe("dba@localhost:3310");
    });

    it("clears the default connection", async () => {
        const { settings, manager } = createManager("dba@localhost:3310");

        await manager.setDefaultConnection(undefined);

        expect(settings.value).toBeUndefined();
        expect(manager.defaultConnection).toBeUndefined();
    });

    it("tells listeners when a connection opens or closes", async () => {
        const { manager } = createManager();
        const listener = vi.fn();
        manager.onDidChange(listener);

        await manager.connect("dba@localhost:3310");
        expect(listener).toHaveBeenCalledTimes(1);

        await manager.disconnect("dba@localhost:3310");
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("tells listeners when the default changes", async () => {
        const { manager } = createManager();
        const listener = vi.fn();
        manager.onDidChange(listener);

        await manager.setDefaultConnection("dba@localhost:3310");

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("stops telling a listener that unsubscribed", async () => {
        const { manager } = createManager();
        const listener = vi.fn();
        const unsubscribe = manager.onDidChange(listener);

        unsubscribe();
        await manager.connect("dba@localhost:3310");

        expect(listener).not.toHaveBeenCalled();
    });
});
