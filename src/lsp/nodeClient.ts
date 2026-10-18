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

/** The real language client, on `vscode-languageclient`. */

import { spawn, type ChildProcess } from "node:child_process";

import * as vscode from "vscode";
import {
    LanguageClient,
    type LanguageClientOptions,
    type ServerOptions,
} from "vscode-languageclient/node";

import { SQL_LANGUAGE_IDS } from "../editor/sqlLanguage.js";
import type { LanguageClientFactory } from "./languageServer.js";
import {
    PARSE_PROGRESS_NOTIFICATION,
    type IParseProgress,
} from "./parseProgress.js";

/**
 * The client's id: its settings are `mariadb.lsp.*`, and
 * `mariadb.lsp.trace.server` is the one the library reads itself.
 */
const CLIENT_ID = "mariadb.lsp";
const CLIENT_NAME = "MariaDB SQL Language Server";

/**
 * The one output channel every client writes to. A client makes one of
 * its own unless given one, and stopping it does not dispose it, so each
 * restart would leave another channel of the same name behind.
 */
let outputChannel: vscode.LogOutputChannel | undefined;

/**
 * Kills a server process that is still there.
 *
 * @param child The process, if one was spawned.
 *
 * @returns Nothing.
 */
const killIfAlive = (child: ChildProcess | undefined): void => {
    if (child !== undefined && child.exitCode === null
        && child.signalCode === null) {
        child.kill();
    }
};

/**
 * Builds a client that spawns the server and talks to it over stdio.
 *
 * @param options What to start and what to tell it.
 *
 * @returns The client, not started yet.
 */
export const createNodeLanguageClient: LanguageClientFactory = (options) => {
    // Spawned here rather than by the library, which keeps the process to
    // itself: after a failed start it neither stops nor kills it, and the
    // extension has to.
    let child: ChildProcess | undefined;
    const serverOptions: ServerOptions = async () => {
        return await new Promise<ChildProcess>((resolve, reject) => {
            const spawned = spawn(options.command, options.args,
                { stdio: "pipe", windowsHide: true });
            child = spawned;
            spawned.once("spawn", () => {
                resolve(spawned);
            });
            spawned.once("error", reject);
        });
    };
    const clientOptions: LanguageClientOptions = {
        documentSelector: SQL_LANGUAGE_IDS.flatMap((language) => {
            return [
                { language, scheme: "file" },
                { language, scheme: "untitled" },
            ];
        }),
        initializationOptions: options.initializationOptions,
        outputChannel: outputChannel
            ??= vscode.window.createOutputChannel(CLIENT_NAME, { log: true }),
        middleware: {
            didOpen: async (document, next) => {
                await next(document);
                options.onDidOpen(document);
            },
            didClose: async (document, next) => {
                await next(document);
                options.onDidClose(document);
            },
            // VS Code takes one semantic token provider's answer, the
            // newest registered first, so the server's tokens would hide
            // the extension's ANSI_QUOTES marks. They add nothing over the
            // TextMate grammar until the server classifies identifiers;
            // answering nothing leaves the extension's provider in charge.
            provideDocumentSemanticTokens: () => {
                return undefined;
            },
            provideDocumentSemanticTokensEdits: () => {
                return undefined;
            },
            provideDocumentRangeSemanticTokens: () => {
                return undefined;
            },
        },
    };
    const client = new LanguageClient(CLIENT_ID, CLIENT_NAME, serverOptions,
        clientOptions);
    client.onNotification(PARSE_PROGRESS_NOTIFICATION,
        (progress: IParseProgress) => {
            options.onParseProgress(progress);
        });
    // The server reports a large file's check as work done progress too,
    // when the client says it takes that; the status bar entry built on
    // mariadb/parseProgress says the same, so the client says it does not.
    client.registerFeature({
        fillClientCapabilities: (capabilities) => {
            (capabilities.window ??= {}).workDoneProgress = false;
        },
        initialize: () => { /* nothing to set up */ },
        getState: () => {
            return { kind: "static" };
        },
        clear: () => { /* nothing to undo */ },
    });

    return {
        start: async () => {
            try {
                await client.start();
            } catch (error) {
                killIfAlive(child);
                throw error;
            }
        },
        stop: async () => {
            try {
                if (client.isRunning()) {
                    await client.stop();
                }
            } finally {
                // Stopped, it exits by itself; one that would not answer
                // the shutdown, or never started, is ended here.
                killIfAlive(child);
            }
        },
        sendNotification: async (method, params) => {
            await client.sendNotification(method, params);
        },
        sendRequest: async (method, params) => {
            return await client.sendRequest(method, params);
        },
    };
};
