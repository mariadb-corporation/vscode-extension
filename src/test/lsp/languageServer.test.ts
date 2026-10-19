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

import type { ISessionState } from "../../connections/sqlModes.js";
import type { IDbCallParams } from "../../lsp/dbCall.js";
import {
    DID_CHANGE_CONFIGURATION_NOTIFICATION,
    DOCUMENT_CONTEXT_NOTIFICATION,
    LanguageServer,
    REFRESH_CATALOG_REQUEST,
    type ILanguageClientOptions,
} from "../../lsp/languageServer.js";
import { createFakeEnvironment } from "../helpers.js";
import {
    commands,
    configuration,
    fireConfigurationChange,
    fireDocumentChange,
    fireDocumentOpen,
    MockTextDocument,
    MockTextEditor,
    Position,
    resetVscodeMock,
    Selection,
    setActiveTextEditor,
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
    /** What each connection's editors' session reported. */
    sessions: Map<string, ISessionState>;
    /** Says a session's report changed. */
    sessionChanged: () => void;
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
    /** What `dbCall` answers. */
    dbCall?: (params: IDbCallParams) => Promise<unknown>;
    /** Makes looking for the shell fail. */
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
    const sessions = new Map<string, ISessionState>();
    let sessionListener = (): void => { /* set below */ };
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
        sessionOf: (connection) => {
            return sessions.get(connection) ?? {};
        },
        onDidChangeSession: (changed) => {
            sessionListener = changed;

            return () => { /* nothing to undo */ };
        },
        dbCall: (params) => {
            return options.dbCall
                ? options.dbCall(params)
                : Promise.reject(new Error("no catalog in this test"));
        },
    });

    return {
        server, clients, lines, connections, changed: () => {
            listener();
        }, ran: (connection, script) => {
            runListener(connection, script);
        }, sessions, sessionChanged: () => {
            sessionListener();
        },
    };
};

/** Lets the controller's start, which awaits a few promises, finish. */
const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
};

describe("LanguageServer.format", () => {
    beforeEach(() => {
        resetVscodeMock();
    });

    /** The active editor, on a SQL document. */
    const sqlEditor = (name = "q.sql"): MockTextEditor => {
        const editor = new MockTextEditor(new MockTextDocument(
            Uri.parse(`file:///work/${name}`), "mariadb-sql",
            "select a from t;\nselect b from u;\n"));
        setActiveTextEditor(editor);

        return editor;
    };

    const asEditor = (editor: MockTextEditor): vscode.TextEditor => {
        return editor as unknown as vscode.TextEditor;
    };

    /**
     * Stands in for VS Code's formatting commands.
     *
     * @param editor The editor they work on.
     * @param text What a command leaves in it; none leaves it as it is.
     *
     * @returns The commands run, in order.
     */
    const formatCommands = (editor: MockTextEditor, text?: string): string[] => {
        const ran: string[] = [];
        for (const command of ["editor.action.formatDocument",
            "editor.action.formatSelection"]) {
            commands.registerCommand(command, () => {
                ran.push(command);
                if (text !== undefined) {
                    editor.document.setText(text);
                }
            });
        }

        return ran;
    };

    it("formats the whole document when nothing is selected", async () => {
        const { server } = build({});
        const editor = sqlEditor();
        const ran = formatCommands(editor, "SELECT a FROM t;\n");

        expect(await server.format(asEditor(editor))).toBe("formatted");
        expect(ran).toEqual(["editor.action.formatDocument"]);
    });

    it("formats the selection when something is selected", async () => {
        const { server } = build({});
        const editor = sqlEditor();
        editor.selection = new Selection(new Position(1, 2), new Position(1, 8));
        const ran = formatCommands(editor, "SELECT b FROM u;\n");

        expect(await server.format(asEditor(editor))).toBe("formatted");
        expect(ran).toEqual(["editor.action.formatSelection"]);
    });

    it("says when there was nothing to change", async () => {
        const { server } = build({});
        const editor = sqlEditor();
        formatCommands(editor);

        expect(await server.format(asEditor(editor))).toBe("unchanged");
    });

    it("formats nothing when another editor became active", async () => {
        const { server } = build({});
        const editor = sqlEditor();
        const ran = formatCommands(editor, "SELECT 1;");
        sqlEditor("other.sql");

        expect(await server.format(asEditor(editor))).toBe("skipped");
        expect(ran).toEqual([]);
    });

    it("cannot format without a server", async () => {
        const { lines, server } = build({ versions: {} });
        const editor = sqlEditor();
        const ran = formatCommands(editor, "SELECT 1;");

        expect(await server.format(asEditor(editor))).toBe("unavailable");
        expect(ran).toEqual([]);
        expect(lines.join("\n")).toContain("No usable mariadb-lsp");
    });
});

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
        expect(clients[0].options.args).toEqual(["lsp", "--stdio", "--mcp"]);
        expect(server.running).toBe(true);
    });

    it("starts once however often it is asked", async () => {
        const { clients, server } = build();
        fireDocumentOpen(sqlDocument("a.sql"));
        fireDocumentOpen(sqlDocument("b.sql"));
        await Promise.all([server.start(), server.start()]);
        expect(clients).toHaveLength(1);
    });

    it("runs the server in MCP mode, with the threads asked for", async () => {
        configuration.set("mariadb.lsp.threads", 3);
        const { clients, server } = build();
        await server.start();

        expect(clients[0].options.args)
            .toEqual(["lsp", "--stdio", "--mcp", "--threads", "3"]);
        expect(clients[0].options.initializationOptions)
            .toMatchObject({ keywordCase: "upper" });
    });

    it("hands the server's db calls on", async () => {
        const asked: IDbCallParams[] = [];
        const { clients, server } = build({
            dbCall: (params) => {
                asked.push(params);

                return Promise.resolve([{ schema_name: "store" }]);
            },
        });
        await server.start();
        const params: IDbCallParams = {
            connection: "mariadb://root@h:1",
            tool: "db.list_schemas",
            arguments: {},
        };
        await expect(clients[0].options.onDbCall(params))
            .resolves.toEqual([{ schema_name: "store" }]);
        expect(asked).toEqual([params]);
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

    it("sends what the editors' session reported of its mode and schema",
        async () => {
            const { clients, connections, server, sessions, sessionChanged }
                = build();
            const document = sqlDocument("q.sql");
            connections.set(document.uri.toString(), "mariadb://root@h:1");
            await server.start();
            fireDocumentOpen(document);
            clients[0].options.onDidOpen(asDocument(document));
            const context = (extra: Record<string, string>) => {
                return {
                    method: DOCUMENT_CONTEXT_NOTIFICATION,
                    params: {
                        textDocument: { uri: document.uri.toString() },
                        connection: "mariadb://root@h:1",
                        ...extra,
                    },
                };
            };
            // Nothing reported yet: the server reads the connection's own.
            expect(clients[0].notifications).toEqual([context({})]);

            // A run reported the mode, then a USE.
            sessions.set("mariadb://root@h:1", { sqlMode: "ANSI_QUOTES" });
            sessionChanged();
            sessions.set("mariadb://root@h:1",
                { sqlMode: "ANSI_QUOTES", schema: "shop" });
            sessionChanged();
            // Nothing new: nothing sent.
            sessionChanged();
            // No schema in use: the server takes the connection's again.
            sessions.set("mariadb://root@h:1",
                { sqlMode: "ANSI_QUOTES", schema: null });
            sessionChanged();
            expect(clients[0].notifications).toEqual([
                context({}),
                context({ sqlMode: "ANSI_QUOTES" }),
                context({ sqlMode: "ANSI_QUOTES", currentSchema: "shop" }),
                context({ sqlMode: "ANSI_QUOTES" }),
            ]);
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

    it("has catalogs read again when asked", async () => {
        const { clients, connections, server } = build();
        const document = sqlDocument("q.sql");
        connections.set(document.uri.toString(), "mariadb://root@h:1");
        // Not running: nothing to ask.
        server.refreshCatalog();
        await server.start();
        clients[0].options.onDidOpen(asDocument(document));

        // A load or a copy names the connection as the tree has it.
        server.refreshCatalog("root@h:1");
        server.refreshCatalog("root@other:1");
        // The tree's refresh asks for every one.
        server.refreshCatalog();
        expect(clients[0].requests).toEqual([
            {
                method: REFRESH_CATALOG_REQUEST,
                params: { textDocument: { uri: document.uri.toString() } },
            },
            { method: REFRESH_CATALOG_REQUEST, params: {} },
        ]);
    });

    it("ignores what a stopped client still reports", async () => {
        const { clients, connections, server, changed } = build();
        const document = sqlDocument("q.sql");
        connections.set(document.uri.toString(), "mariadb://root@h:1");
        await server.start();
        await server.stop();
        await server.start();
        clients[1].options.onDidOpen(asDocument(document));

        clients[0].options.onDidClose(asDocument(document));
        clients[0].options.onDidOpen(asDocument(sqlDocument("old.sql")));
        // The document is still the new client's: a moved connection is sent.
        connections.set(document.uri.toString(), "mariadb://root@h:2");
        fireDocumentOpen(document);
        changed();
        expect(clients[1].notifications.at(-1)).toEqual({
            method: DOCUMENT_CONTEXT_NOTIFICATION,
            params: {
                textDocument: { uri: document.uri.toString() },
                connection: "mariadb://root@h:2",
            },
        });
        expect(clients[0].notifications).toEqual([]);
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

    it("stops the client", async () => {
        const { clients, server } = build();
        await server.start();
        server.dispose();
        await settle();
        expect(clients[0].stopped).toBe(true);
    });
});
