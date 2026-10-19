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

/**
 * The MariaDB SQL language server (`mariadb-lsp`): started the first time
 * a SQL document is open, told which connection each document runs on,
 * restarted when its settings change.
 */

import * as vscode from "vscode";

import { isSqlDocument } from "../editor/sqlLanguage.js";
import type { ShellEnvironment } from "../shell/locator.js";
import { errorText } from "../text.js";
import type { IDbCallParams } from "./dbCall.js";
import {
    describeLspLocation,
    locateLanguageServer,
    type LspLocation,
} from "./locator.js";
import { ParseProgressStatus, type IParseProgress } from "./parseProgress.js";
import {
    LIVE_SERVER_SETTINGS,
    RESTART_SERVER_SETTINGS,
    serverSettings,
} from "./settings.js";

/** The notification that tells the server about a document's connection. */
export const DOCUMENT_CONTEXT_NOTIFICATION = "mariadb/documentContext";

/** The request that makes the server read a connection's catalog again. */
export const REFRESH_CATALOG_REQUEST = "mariadb/refreshCatalog";

/** Formats a whole document. */
export const FORMATTING_REQUEST = "textDocument/formatting";

/** Formats the statements a range touches. */
export const RANGE_FORMATTING_REQUEST = "textDocument/rangeFormatting";

/**
 * Whether a script may have changed what a catalog holds. A plain word
 * match: one read too many is cheap, a stale catalog is not.
 */
const CHANGES_CATALOG = /\b(CREATE|ALTER|DROP|RENAME)\b/i;

/** The notification that hands the server changed settings. */
export const DID_CHANGE_CONFIGURATION_NOTIFICATION =
    "workspace/didChangeConfiguration";

/** The section all of the server's settings are in. */
const SECTION = "mariadb.lsp";

/**
 * @param event A configuration change.
 * @param names Settings below `mariadb.lsp`.
 *
 * @returns Whether any of them changed.
 */
const affects = (
    event: vscode.ConfigurationChangeEvent,
    names: readonly string[],
): boolean => {
    return names.some((name) => {
        return event.affectsConfiguration(`${SECTION}.${name}`);
    });
};

/** An LSP TextEdit, as the server sends it. */
interface ILspTextEdit {
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    newText: string;
}

/** What {@link LanguageServer.format} did. */
export type FormatResult =
    /** The edits were applied. */
    | "formatted"
    /** The server had nothing to change. */
    | "unchanged"
    /** The document changed while the server was laying it out. */
    | "outdated"
    /** No server is running, or it failed. */
    | "unavailable";

/** A running language client, as far as the controller needs it. */
export interface ILanguageClientHandle {
    /** Starts the server and completes the initialize handshake. */
    start(): Promise<void>;
    /** Shuts the server down. */
    stop(): Promise<void>;
    /**
     * @param method The notification.
     * @param params Its parameters.
     *
     * @returns Once it was written.
     */
    sendNotification(method: string, params: unknown): Promise<void>;
    /**
     * @param method The request.
     * @param params Its parameters.
     *
     * @returns Its result.
     */
    sendRequest(method: string, params: unknown): Promise<unknown>;
}

/** What a language client is built from. */
export interface ILanguageClientOptions {
    /** The executable. */
    command: string;
    /** Its arguments. */
    args: string[];
    /** The `initializationOptions` of the `initialize` request. */
    initializationOptions: Record<string, unknown>;
    /**
     * Called after the server was told a document opened, which is when
     * it takes a `mariadb/documentContext` for it.
     */
    onDidOpen(document: vscode.TextDocument): void;
    /** Called after the server was told a document closed. */
    onDidClose(document: vscode.TextDocument): void;
    /** Called with each `mariadb/parseProgress` from the server. */
    onParseProgress(progress: IParseProgress): void;
    /**
     * Answers a `mariadb/dbCall`: the server reads a connection's
     * catalog through the extension's MCP server.
     */
    onDbCall(params: IDbCallParams): Promise<unknown>;
}

/** Builds a language client; `nodeClient.ts` has the real one. */
export type LanguageClientFactory = (
    options: ILanguageClientOptions,
) => ILanguageClientHandle;

/** What the controller needs from the rest of the extension. */
export interface ILanguageServerDependencies {
    /** Builds the client. */
    createClient: LanguageClientFactory;
    /** Where the binary is looked for. */
    environment: ShellEnvironment;
    /** The MariaDB output channel. */
    log: (message: string) => void;
    /**
     * @param document A SQL document.
     *
     * @returns The connection URI it runs on, if any.
     */
    connectionFor(document: vscode.TextDocument): string | undefined;
    /**
     * Listens for anything that may change which connection a document
     * runs on: a pick, the default connection.
     *
     * @param listener Called on each.
     *
     * @returns A function that stops listening.
     */
    onDidChangeConnections(listener: () => void): () => void;
    /**
     * Listens for scripts run on a connection.
     *
     * @param listener Called with the connection URI and the script.
     *
     * @returns A function that stops listening.
     */
    onDidRunScript(
        listener: (connection: string, script: string) => void,
    ): () => void;
    /**
     * Makes a `db.*` tool call on the MCP server for the language
     * server, which runs with `--mcp` and connects to nothing itself.
     *
     * @param params The connection, the tool and its arguments.
     *
     * @returns The tool's result.
     */
    dbCall(params: IDbCallParams): Promise<unknown>;
}

/** Where the server is in its life. */
type State =
    | { kind: "stopped" }
    | { kind: "starting"; done: Promise<void> }
    | { kind: "running"; client: ILanguageClientHandle }
    | { kind: "unavailable" };

/** Starts, feeds and stops the language server. */
export class LanguageServer implements vscode.Disposable {
    #state: State = { kind: "stopped" };
    /**
     * Document URI -> the connection last sent for it (null for none),
     * for every document the server has open.
     */
    readonly #sent = new Map<string, string | null>();
    /**
     * Counts the clients started, so what a stopped one still reports is
     * told from what the current one does.
     */
    #generation = 0;
    readonly #progress = new ParseProgressStatus();
    readonly #disposables: vscode.Disposable[] = [this.#progress];

    /**
     * @param deps What the controller needs from the rest of the extension.
     */
    public constructor(private readonly deps: ILanguageServerDependencies) {
        this.#disposables.push(
            vscode.workspace.onDidOpenTextDocument((document) => {
                if (isSqlDocument(document)) {
                    void this.start();
                }
            }),
            // The connection header may have been typed or edited.
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (this.#sent.has(event.document.uri.toString())) {
                    this.#sendContext(event.document);
                }
            }),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (affects(event, RESTART_SERVER_SETTINGS)) {
                    void this.restart();
                } else if (affects(event, LIVE_SERVER_SETTINGS)) {
                    this.#sendSettings();
                }
            }),
            {
                dispose: deps.onDidChangeConnections(() => {
                    this.#syncAll();
                }),
            },
            {
                dispose: deps.onDidRunScript((connection, script) => {
                    this.#refreshAfterRun(connection, script);
                }),
            },
        );

        // A SQL file open before the extension was activated is as good a
        // reason to start as one opened after.
        if (vscode.workspace.textDocuments.some(isSqlDocument)) {
            void this.start();
        }
    }

    /** Whether the server is up. */
    public get running(): boolean {
        return this.#state.kind === "running";
    }

    /**
     * Starts the server unless it is up, coming up, disabled or missing.
     *
     * @returns Once it is up, or it was found it cannot be.
     */
    public async start(): Promise<void> {
        switch (this.#state.kind) {
            case "starting":
                return await this.#state.done;
            case "stopped": {
                const done = this.#start().catch((error: unknown) => {
                    // Never left "starting", or every later start and
                    // stop would wait on this one for good.
                    this.deps.log(`The SQL language server did not start: `
                        + `${errorText(error)}`);
                    this.#state = { kind: "unavailable" };
                    this.#progress.clear();
                });
                this.#state = { kind: "starting", done };

                return await done;
            }
            default:
                return;
        }
    }

    /**
     * Lays out the queries of an editor's document through the server: the
     * statements the selection touches when something is selected, else
     * the whole document. The editor's tab size and spaces/tabs choice set
     * one level of indentation.
     *
     * @param editor The editor.
     *
     * @returns What was done.
     */
    public async format(editor: vscode.TextEditor): Promise<FormatResult> {
        await this.start();
        if (this.#state.kind !== "running") {
            return "unavailable";
        }
        const { document, selection } = editor;
        const tabSize = editor.options.tabSize;
        const params: Record<string, unknown> = {
            textDocument: { uri: document.uri.toString() },
            options: {
                tabSize: typeof tabSize === "number" ? tabSize : 4,
                insertSpaces: editor.options.insertSpaces !== false,
            },
        };
        if (!selection.isEmpty) {
            params.range = {
                start: {
                    line: selection.start.line,
                    character: selection.start.character,
                },
                end: {
                    line: selection.end.line,
                    character: selection.end.character,
                },
            };
        }
        const version = document.version;
        let edits: ILspTextEdit[];
        try {
            const result = await this.#state.client.sendRequest(
                selection.isEmpty ? FORMATTING_REQUEST
                    : RANGE_FORMATTING_REQUEST,
                params);
            edits = Array.isArray(result) ? result as ILspTextEdit[] : [];
        } catch (error) {
            this.deps.log(`Formatting failed: ${errorText(error)}`);

            return "unavailable";
        }
        if (document.version !== version) {
            return "outdated";
        }
        if (edits.length === 0) {
            return "unchanged";
        }
        let applied: boolean;
        try {
            applied = await editor.edit((builder) => {
                for (const edit of edits) {
                    const { start, end } = edit.range;
                    builder.replace(new vscode.Range(start.line,
                        start.character, end.line, end.character),
                    edit.newText);
                }
            });
        } catch (error) {
            // Overlapping edits, or an editor that was closed meanwhile.
            this.deps.log(`Formatting failed: ${errorText(error)}`);

            return "unavailable";
        }

        return applied ? "formatted" : "outdated";
    }

    /**
     * Stops the server and starts it again, looking for the binary anew.
     *
     * @returns Once it is up again, or it was found it cannot be.
     */
    public async restart(): Promise<void> {
        await this.stop();
        if (vscode.workspace.textDocuments.some(isSqlDocument)) {
            await this.start();
        }
    }

    /**
     * Stops the server.
     *
     * @returns Once it is down.
     */
    public async stop(): Promise<void> {
        if (this.#state.kind === "starting") {
            await this.#state.done;
        }
        const state = this.#state;
        this.#state = { kind: "stopped" };
        this.#generation += 1;
        this.#sent.clear();
        this.#progress.clear();
        if (state.kind === "running") {
            try {
                await state.client.stop();
            } catch (error) {
                this.deps.log(`The SQL language server did not stop `
                    + `cleanly: ${errorText(error)}`);
            }
        }
    }

    public dispose(): void {
        for (const disposable of this.#disposables) {
            disposable.dispose();
        }
        void this.stop();
    }

    /**
     * Looks for the binary and starts it.
     *
     * @returns Once the state is settled.
     */
    async #start(): Promise<void> {
        const settings = vscode.workspace.getConfiguration(SECTION);
        if (!settings.get<boolean>("enabled", true)) {
            this.deps.log("The SQL language server is off "
                + "(mariadb.lsp.enabled).");
            this.#state = { kind: "unavailable" };

            return;
        }

        let location: LspLocation | undefined;
        try {
            location = await locateLanguageServer(this.deps.environment,
                settings.get<string>("path", ""), this.deps.log);
        } catch (error) {
            this.deps.log(`Looking for the SQL language server failed: `
                + `${errorText(error)}`);
        }
        if (!location) {
            this.deps.log("No usable mariadb-lsp was found, so SQL files "
                + "get no diagnostics or completion. Install it on the "
                + "PATH or in ~/.local/bin, then run MariaDB: Restart SQL "
                + "Language Server.");
            this.#state = { kind: "unavailable" };

            return;
        }
        this.deps.log(describeLspLocation(location));

        // --mcp: the server reads catalogs through this extension's MCP
        // server (mariadb/dbCall) and needs no credentials of its own.
        const args = ["lsp", "--stdio", "--mcp"];
        const threads = settings.get<number>("threads", 0);
        if (Number.isInteger(threads) && threads > 0) {
            args.push("--threads", String(threads));
        }
        const initializationOptions = serverSettings(settings);

        const generation = this.#generation;
        const client = this.deps.createClient({
            command: location.binaryPath,
            args,
            initializationOptions,
            onDidOpen: (document) => {
                // Opened again after the client restarted a crashed
                // server: a check the old one had under way never ends.
                this.#progress.forget(document.uri.toString());
                this.#sent.set(document.uri.toString(), null);
                this.#sendContext(document);
            },
            onDidClose: (document) => {
                this.#sent.delete(document.uri.toString());
                this.#progress.forget(document.uri.toString());
            },
            onDbCall: async (params) => {
                return await this.deps.dbCall(params);
            },
            onParseProgress: (progress) => {
                // One still on its way when the document closed would
                // otherwise stay in the status bar.
                if (generation === this.#generation
                    && this.#sent.has(progress.uri)) {
                    this.#progress.update(progress);
                }
            },
        });
        try {
            await client.start();
        } catch (error) {
            this.deps.log(`The SQL language server did not start: `
                + `${errorText(error)}`);
            this.#state = { kind: "unavailable" };
            this.#progress.clear();

            return;
        }
        this.#state = { kind: "running", client };
        this.#syncAll();
    }

    /**
     * Hands the running server the settings as they are now; one that
     * is not running reads them when it starts.
     *
     * @returns Nothing.
     */
    #sendSettings(): void {
        if (this.#state.kind !== "running") {
            return;
        }
        this.#state.client.sendNotification(
            DID_CHANGE_CONFIGURATION_NOTIFICATION, {
                settings: {
                    mariadb: serverSettings(
                        vscode.workspace.getConfiguration(SECTION)),
                },
            }).catch((error: unknown) => {
            this.deps.log(`Could not send the changed settings to the SQL `
                + `language server: ${errorText(error)}`);
        });
    }

    /**
     * Has the server read a connection's catalog again after a script
     * that may have changed it, so completion and hover see the new
     * objects. The server reads it once and then only when asked.
     *
     * @param connection The connection the script ran on.
     * @param script The script.
     *
     * @returns Nothing.
     */
    #refreshAfterRun(connection: string, script: string): void {
        if (this.#state.kind !== "running" || !CHANGES_CATALOG.test(script)) {
            return;
        }
        // The request names a document, and the server refreshes that
        // document's connection; with none it would read every one.
        const document = [...this.#sent].find(([, sent]) => {
            return sent === connection;
        })?.[0];
        if (document === undefined) {
            // No document uses it, so the server never read it.
            return;
        }
        this.#state.client.sendRequest(REFRESH_CATALOG_REQUEST, {
            textDocument: { uri: document },
        }).catch((error: unknown) => {
            this.deps.log(`Could not have the SQL language server read `
                + `${connection} again: ${errorText(error)}`);
        });
    }

    /** Sends the context of every open document whose connection moved. */
    #syncAll(): void {
        for (const document of vscode.workspace.textDocuments) {
            if (this.#sent.has(document.uri.toString())) {
                this.#sendContext(document);
            }
        }
    }

    /**
     * Tells the server the connection a document runs on, if that is not
     * what it was told last.
     *
     * @param document A document the server has open.
     *
     * @returns Nothing.
     */
    #sendContext(document: vscode.TextDocument): void {
        if (this.#state.kind !== "running") {
            // Sent for every open document once it is.
            return;
        }
        const key = document.uri.toString();
        const connection = this.deps.connectionFor(document) ?? null;
        if (this.#sent.get(key) === connection) {
            return;
        }
        this.#sent.set(key, connection);
        this.#state.client.sendNotification(DOCUMENT_CONTEXT_NOTIFICATION, {
            textDocument: { uri: key },
            connection,
        }).catch((error: unknown) => {
            this.deps.log(`Could not send the connection of ${key} to the `
                + `SQL language server: ${errorText(error)}`);
        });
    }
}
