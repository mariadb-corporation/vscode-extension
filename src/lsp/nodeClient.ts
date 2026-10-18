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

import {
    LanguageClient,
    type LanguageClientOptions,
    type ServerOptions,
} from "vscode-languageclient/node";

import { SQL_LANGUAGE_IDS } from "../editor/sqlLanguage.js";
import type { LanguageClientFactory } from "./languageServer.js";

/**
 * The client's id: its settings are `mariadb.lsp.*`, and
 * `mariadb.lsp.trace.server` is the one the library reads itself.
 */
const CLIENT_ID = "mariadb.lsp";
const CLIENT_NAME = "MariaDB SQL Language Server";

/**
 * Builds a client that spawns the server and talks to it over stdio.
 *
 * @param options What to start and what to tell it.
 *
 * @returns The client, not started yet.
 */
export const createNodeLanguageClient: LanguageClientFactory = (options) => {
    const serverOptions: ServerOptions = {
        command: options.command,
        args: options.args,
    };
    const clientOptions: LanguageClientOptions = {
        documentSelector: SQL_LANGUAGE_IDS.flatMap((language) => {
            return [
                { language, scheme: "file" },
                { language, scheme: "untitled" },
            ];
        }),
        initializationOptions: options.initializationOptions,
        outputChannelName: CLIENT_NAME,
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

    return {
        start: async () => {
            await client.start();
        },
        stop: async () => {
            if (client.isRunning()) {
                await client.stop();
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
