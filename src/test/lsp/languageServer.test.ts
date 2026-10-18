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
import type * as vscode from "vscode";

import {
    DID_CHANGE_CONFIGURATION_NOTIFICATION,
    DOCUMENT_CONTEXT_NOTIFICATION,
    LanguageServer,
    REFRESH_CATALOG_REQUEST,
    type ILanguageClientOptions,
} from "../../lsp/languageServer.js";
import { createFakeEnvironment } from "../helpers.js";
import {
    configuration,
    fireConfigurationChange,
    fireDocumentChange,
    fireDocumentOpen,
    MockTextDocument,
    resetVscodeMock,
    statusBarItems,
    Uri,
} from "../mocks/vscode.js";

/** A language client that records what it was asked to do. */
interface FakeClient {
    options: ILanguageClientOptions;
    started: boolean;
    stopped: boolean;
    notifications: Array<{ method: string; params: unknown }>;
    requests: Array<{ method: string; params: unknown }>;
}

/** What one test built. */
interface Fixture {
    server: LanguageServer;
    clients: FakeClient[];
    lines: string[];
    connections: Map<string, string>;
    changed: () => void;
    ran: (connection: string, script: string) => void;
}

const sqlDocument = (name: string): MockTextDocument => {
    return new MockTextDocument(Uri.parse(`file:///work/${name}`),
        "mariadb-sql", "SELECT 1;");
};

/** The mock document as the client hands it over. */
const asDocument = (document: MockTextDocument): vscode.TextDocument => {
    return document as unknown as vscode.TextDocument;
};

/**
 * Builds a controller over fakes; `mariadb-lsp` is on the PATH unless
 * `versions` says otherwise.
 */
const build = (options: {
    versions?: Record<string, string>;
    shellBinary?: string;
    /** Makes looking for the shell fail. */
    failShell?: boolean;
    failStart?: boolean;
    /** Holds the client's start until it settles. */
    startGate?: Promise<void>;
} = {}): Fixture => {
    const clients: FakeClient[] = [];
    const lines: string[] = [];
    const connections = new Map<string, string>();
    let listener = (): void => { /* set below */ };
    let runListener = (connection: string, script: string): void => {
        void connection;
        void script;
    };
    const server = new LanguageServer({
        createClient: (clientOptions) => {
            const client: FakeClient = {
                options: clientOptions,
                started: false,
                stopped: false,
                notifications: [],
                requests: [],
            };
            clients.push(client);

            return {
                start: async () => {
                    await options.startGate;
                    if (options.failStart) {
                        throw new Error("spawn failed");
                    }
                    client.started = true;
                },
                stop: () => {
                    client.stopped = true;

                    return Promise.resolve();
                },
                sendNotification: (method, params) => {
                    client.notifications.push({ method, params });

                    return Promise.resolve();
                },
                sendRequest: (method, params) => {
                    client.requests.push({ method, params });

                    return Promise.resolve(null);
                },
            };
        },
        environment: createFakeEnvironment({
            versions: options.versions
                ?? { "mariadb-lsp": "mariadb-lsp 26.9.4\n" },
        }),
        log: (line) => {
            lines.push(line);
        },
        connectionFor: (document) => {
            return connections.get(document.uri.toString());
        },
        onDidChangeConnections: (changed) => {
            listener = changed;

            return () => { /* nothing to undo */ };
        },
        onDidRunScript: (ran) => {
            runListener = ran;

            return () => { /* nothing to undo */ };
        },
        shellBinary: () => {
            return options.failShell
                ? Promise.reject(new Error("shell lookup failed"))
                : Promise.resolve(options.shellBinary);
        },
    });

    return {
        server, clients, lines, connections, changed: () => {
            listener();
        }, ran: (connection, script) => {
            runListener(connection, script);
        },
    };
};

/** Lets the controller's start, which awaits a few promises, finish. */
const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
};

describe("LanguageServer", () => {
    beforeEach(() => {
        resetVscodeMock();
    });

    it("starts nothing until a SQL file is open", async () => {
        const { clients, server } = build();
        fireDocumentOpen(new MockTextDocument(Uri.parse("file:///a.txt"),
            "plaintext", ""));
        await settle();
        expect(clients).toHaveLength(0);

        fireDocumentOpen(sqlDocument("a.sql"));
        await server.start();
        expect(clients).toHaveLength(1);
        expect(clients[0].started).toBe(true);
        expect(clients[0].options.command).toBe("mariadb-lsp");
        expect(clients[0].options.args).toEqual(["lsp", "--stdio"]);
        expect(server.running).toBe(true);
    });

    it("starts once however often it is asked", async () => {
        const { clients, server } = build();
        fireDocumentOpen(sqlDocument("a.sql"));
        fireDocumentOpen(sqlDocument("b.sql"));
        await Promise.all([server.start(), server.start()]);
        expect(clients).toHaveLength(1);
    });

    it("passes the threads and a shell the PATH does not have", async () => {
        configuration.set("mariadb.lsp.threads", 3);
        const shell = "/Users/me/.local/share/mariadb-shell/26.10.2/bin/"
            + "mariadb-shell";
        const { clients, server } = build({ shellBinary: shell });
        await server.start();

        expect(clients[0].options.args)
            .toEqual(["lsp", "--stdio", "--threads", "3"]);
        expect(clients[0].options.initializationOptions)
            .toMatchObject({ shellBinary: shell, keywordCase: "upper" });
    });

    it("tells the server each document's connection", async () => {
        const { clients, connections, server, changed } = build();
        const bound = sqlDocument("bound.sql");
        const loose = sqlDocument("loose.sql");
        connections.set(bound.uri.toString(), "mariadb://root@localhost:3310");
        await server.start();
        clients[0].options.onDidOpen(asDocument(bound));
        clients[0].options.onDidOpen(asDocument(loose));

        // Nothing for a document without one: the server starts there.
        expect(clients[0].notifications).toEqual([{
            method: DOCUMENT_CONTEXT_NOTIFICATION,
            params: {
                textDocument: { uri: bound.uri.toString() },
                connection: "mariadb://root@localhost:3310",
            },
        }]);

        // A pick or a new default: only what moved is sent.
        connections.set(loose.uri.toString(), "mariadb://dba@db:3306");
        connections.delete(bound.uri.toString());
        fireDocumentOpen(bound);
        fireDocumentOpen(loose);
        changed();
        expect(clients[0].notifications.slice(1)).toEqual([
            {
                method: DOCUMENT_CONTEXT_NOTIFICATION,
                params: {
                    textDocument: { uri: bound.uri.toString() },
                    connection: null,
                },
            },
            {
                method: DOCUMENT_CONTEXT_NOTIFICATION,
                params: {
                    textDocument: { uri: loose.uri.toString() },
                    connection: "mariadb://dba@db:3306",
                },
            },
        ]);

        // An edit of the header line is followed; other edits send nothing.
        fireDocumentChange(loose);
        expect(clients[0].notifications).toHaveLength(3);
        connections.set(loose.uri.toString(), "mariadb://dba@db:3307");
        fireDocumentChange(loose);
        expect(clients[0].notifications).toHaveLength(4);

        // A closed document is forgotten.
        clients[0].options.onDidClose(asDocument(loose));
        connections.set(loose.uri.toString(), "mariadb://dba@db:3308");
        changed();
        expect(clients[0].notifications).toHaveLength(4);
    });

    it("has the catalog read again after a script that may change it",
        async () => {
            const { clients, connections, server, ran } = build();
            const document = sqlDocument("ddl.sql");
            connections.set(document.uri.toString(), "mariadb://root@h:1");
            await server.start();
            clients[0].options.onDidOpen(asDocument(document));

            ran("mariadb://root@h:1", "SELECT * FROM t;");
            expect(clients[0].requests).toHaveLength(0);
            ran("mariadb://root@h:1", "create table t (id int);");
            expect(clients[0].requests).toEqual([{
                method: REFRESH_CATALOG_REQUEST,
                params: { textDocument: { uri: document.uri.toString() } },
            }]);
            // No document of the server's runs on it: nothing was read.
            ran("mariadb://root@other:1", "DROP TABLE t;");
            expect(clients[0].requests).toHaveLength(1);
        });

    it("sends what was opened while it was starting", async () => {
        let open = (): void => { /* set below */ };
        const startGate = new Promise<void>((resolve) => {
            open = resolve;
        });
        const { clients, connections, server } = build({ startGate });
        const document = sqlDocument("early.sql");
        connections.set(document.uri.toString(), "mariadb://root@h:1");
        fireDocumentOpen(document);
        // The client reports the open before its start has settled.
        const starting = server.start();
        await settle();
        clients[0].options.onDidOpen(asDocument(document));
        expect(clients[0].notifications).toHaveLength(0);
        open();
        await starting;
        expect(clients[0].notifications).toHaveLength(1);
    });

    it("says so when no mariadb-lsp is found, and looks again on a restart",
        async () => {
            const versions: Record<string, string> = {};
            const { clients, lines, server } = build({ versions });
            fireDocumentOpen(sqlDocument("a.sql"));
            await server.start();
            expect(clients).toHaveLength(0);
            expect(server.running).toBe(false);
            expect(lines.join("\n")).toContain("No usable mariadb-lsp");

            // Not looked for on every file opened.
            fireDocumentOpen(sqlDocument("b.sql"));
            await settle();
            expect(lines.filter((line) => {
                return line.includes("No usable");
            })).toHaveLength(1);

            versions["mariadb-lsp"] = "mariadb-lsp 26.9.4";
            await server.restart();
            expect(clients).toHaveLength(1);
            expect(server.running).toBe(true);
        });

    it("restarts when its settings change", async () => {
        const { clients, server } = build();
        fireDocumentOpen(sqlDocument("a.sql"));
        await server.start();
        configuration.set("mariadb.lsp.threads", 2);
        fireConfigurationChange("mariadb.lsp.threads");
        await settle();
        await server.start();
        expect(clients).toHaveLength(2);
        expect(clients[0].stopped).toBe(true);
        expect(clients[1].options.args).toContain("2");

        // The trace setting is the client library's own business.
        fireConfigurationChange("mariadb.lsp.trace.server");
        await settle();
        expect(clients).toHaveLength(2);
    });

    it("starts with the settings and sends them when they change",
        async () => {
            configuration.set("mariadb.lsp.catalogFiles", ["schema.sql"]);
            const { clients, server } = build();
            fireDocumentOpen(sqlDocument("a.sql"));
            await server.start();
            expect(clients[0].options.initializationOptions).toMatchObject({
                catalogFiles: ["schema.sql"],
                catalogRefreshSeconds: 0,
            });

            configuration.set("mariadb.lsp.catalogRefreshSeconds", 30);
            fireConfigurationChange("mariadb.lsp.catalogRefreshSeconds");
            await settle();
            expect(clients).toHaveLength(1);
            expect(clients[0].notifications).toEqual([{
                method: DID_CHANGE_CONFIGURATION_NOTIFICATION,
                params: {
                    settings: {
                        mariadb: expect.objectContaining({
                            catalogFiles: ["schema.sql"],
                            catalogRefreshSeconds: 30,
                        }) as unknown,
                    },
                },
            }]);

            // The server cannot go back to its own version: restarted.
            configuration.set("mariadb.lsp.serverVersion", "11.4.2");
            fireConfigurationChange("mariadb.lsp.serverVersion");
            await settle();
            await server.start();
            expect(clients).toHaveLength(2);
            expect(clients[1].options.initializationOptions)
                .toMatchObject({ serverVersion: "11.4.2" });
        });

    it("shows a large file's check in the status bar", async () => {
        const { clients, server } = build();
        fireDocumentOpen(sqlDocument("a.sql"));
        await server.start();
        const uri = "file:///work/a.sql";
        clients[0].options.onDidOpen(asDocument(sqlDocument("a.sql")));
        clients[0].options.onParseProgress(
            { uri, version: 1, checked: 5, total: 10, done: false });
        const item = statusBarItems.find((candidate) => {
            return candidate.name === "MariaDB SQL check";
        });
        expect(item?.visible).toBe(true);
        expect(item?.text).toContain("50%");

        // Closing the file ends it; so does a restart, and what the old
        // server still says after it is not shown.
        clients[0].options.onDidClose(asDocument(sqlDocument("a.sql")));
        expect(item?.visible).toBe(false);
        // One still on its way when the file closed is not shown.
        clients[0].options.onParseProgress(
            { uri, version: 1, checked: 6, total: 10, done: false });
        expect(item?.visible).toBe(false);
        clients[0].options.onDidOpen(asDocument(sqlDocument("a.sql")));
        await server.restart();
        expect(item?.visible).toBe(false);
        clients[0].options.onParseProgress(
            { uri, version: 1, checked: 7, total: 10, done: false });
        expect(item?.visible).toBe(false);
        clients[1].options.onDidOpen(asDocument(sqlDocument("a.sql")));
        clients[1].options.onParseProgress(
            { uri, version: 1, checked: 7, total: 10, done: false });
        expect(item?.visible).toBe(true);
    });

    it("stays off when disabled", async () => {
        configuration.set("mariadb.lsp.enabled", false);
        const { clients, lines, server } = build();
        fireDocumentOpen(sqlDocument("a.sql"));
        await server.start();
        expect(clients).toHaveLength(0);
        expect(lines.join("\n")).toContain("mariadb.lsp.enabled");
    });

    it("reports a server that does not start", async () => {
        const { lines, server } = build({ failStart: true });
        await server.start();
        expect(server.running).toBe(false);
        expect(lines.join("\n"))
            .toContain("did not start: spawn failed");
    });

    it("starts without the shell when looking for it fails", async () => {
        const { clients, lines, server } = build({ failShell: true });
        await server.start();
        expect(server.running).toBe(true);
        expect(clients[0].options.initializationOptions.shellBinary)
            .toBeUndefined();
        expect(lines.join("\n")).toContain("shell lookup failed");
    });

    it("stops the client", async () => {
        const { clients, server } = build();
        await server.start();
        server.dispose();
        await settle();
        expect(clients[0].stopped).toBe(true);
    });
});
